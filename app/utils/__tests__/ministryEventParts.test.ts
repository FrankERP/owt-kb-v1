// The fixed parts of a Jóvenes meeting on the one writer (ADR-0089; plan
// `docs/superpowers/plans/2026-11-17-jovenes-meeting-parts.md` M2–M5): what `parseProgram` stores
// and refuses for a part line, who is re-validated when a line holds two people, the whole matrix
// of W10 («Mi parte»), and the notices each write answers. The harness is G4's
// (`ministryEventCommit.test.ts`): the writer's own GROQ on groq-js, and a fake writer with Content
// Lake's two refusals that matter (an id that exists, a revision that does not match).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evaluate, parse } from "groq-js";

vi.mock("server-only", () => ({}));

type Doc = Record<string, unknown> & { _id: string; _type: string; _rev?: string };
const db = vi.hoisted(() => ({ docs: new Map<string, Record<string, unknown>>(), rev: 0 }));

async function groq(query: string, params: Record<string, unknown> = {}) {
  const value = await evaluate(parse(query), { dataset: [...db.docs.values()], params });
  return (await value.get()) as unknown;
}

function conflict(type: string) {
  return Object.assign(new Error(type), {
    statusCode: 409,
    details: { type: "mutationError", items: [{ error: { type } }] },
  });
}
const nextRev = () => `r${++db.rev}`;

/** The mutations the writer uses, with Content Lake's id and revision checks. */
function patchBuilder(id: string) {
  const ops: { rev?: string; set: Record<string, unknown>; unset: string[] } = { set: {}, unset: [] };
  const b = {
    ifRevisionId(rev: string) { ops.rev = rev; return b; },
    set(o: Record<string, unknown>) { Object.assign(ops.set, o); return b; },
    unset(keys: string[]) { ops.unset.push(...keys); return b; },
    apply() {
      const doc = db.docs.get(id);
      if (!doc) throw Object.assign(new Error("missing"), { statusCode: 404 });
      if (ops.rev !== undefined && doc._rev !== ops.rev) throw conflict("documentRevisionIDDoesNotMatchError");
      const next: Record<string, unknown> = { ...doc, ...ops.set, _rev: nextRev() };
      for (const k of ops.unset) delete next[k];
      return next;
    },
    async commit() {
      const next = b.apply();
      db.docs.set(id, next);
      return next;
    },
  };
  return b;
}

vi.mock("@/sanity/lib/operationalClient", () => ({ operationalClient: { fetch: groq } }));
vi.mock("@/sanity/lib/serverClient", () => ({
  serverClient: { fetch: groq },
  writeClient: {
    async create(doc: Doc) {
      if (db.docs.has(doc._id)) throw conflict("documentAlreadyExistsError");
      const stored = { ...doc, _rev: nextRev() };
      db.docs.set(doc._id, stored);
      return stored;
    },
    patch: (id: string) => patchBuilder(id),
    transaction() {
      const steps: Array<() => void> = [];
      const t = {
        patch(id: string, fn: (p: ReturnType<typeof patchBuilder>) => ReturnType<typeof patchBuilder>) {
          const p = fn(patchBuilder(id));
          steps.push(() => db.docs.set(id, p.apply()));
          return t;
        },
        delete(id: string) { steps.push(() => db.docs.delete(id)); return t; },
        create(doc: Doc) {
          steps.push(() => {
            if (db.docs.has(doc._id)) throw conflict("documentAlreadyExistsError");
            db.docs.set(doc._id, { ...doc, _rev: nextRev() });
          });
          return t;
        },
        async commit() {
          const before = new Map(db.docs);
          try { for (const s of steps) s(); } catch (e) { db.docs = before; throw e; }
          return { transactionId: "t" };
        },
      };
      return t;
    },
  },
}));
const revalidate = vi.hoisted(() => vi.fn());
vi.mock("@/app/utils/revalidate", () => ({ revalidateMinistryViews: revalidate }));

import {
  EVENT_ERROR,
  LIMITS,
  createMinistryEvent,
  deleteMinistryEvent,
  updateMinistryEvent,
  updateMinistryEventPart,
  updateMinistryEventProgram,
} from "../ministryEventCommit";
import { PART_LIMITS } from "../ministryParts";

// ── People ──────────────────────────────────────────────────────────────────

const J = (level: string, groups: string[]) => ({
  ministries: ["jovenes"],
  ministryRoles: [{ _key: "jovenes", ministry: "jovenes", level, groups, ...(level === "leader" ? { leaderOf: groups } : {}) }],
});
const JL = (groups: string[], leaderOf: string[]) => ({
  ministries: ["jovenes"],
  ministryRoles: [{ _key: "jovenes", ministry: "jovenes", level: "leader", groups, leaderOf }],
});
const PEOPLE: Record<string, Record<string, unknown>> = {
  admin: J("admin", []),
  enc: J("member", ["otro-nivel"]),
  pau: J("member", ["otro-nivel"]),
  mkz: J("member", ["invencibles"]),
  lali: J("member", ["emprendedores"]),
  goma: J("member", ["otro-nivel"]),
  leaderON: J("leader", ["otro-nivel"]),
  // Leads Otro Nivel, is only IN Invencibles.
  jacob: JL(["otro-nivel", "invencibles"], ["otro-nivel"]),
  worship: { ministries: ["worship"] },
};

function seedPeople() {
  for (const [id, fields] of Object.entries(PEOPLE)) {
    db.docs.set(id, { _id: id, _type: "teamMembers", _rev: nextRev(), member_name: id, ...fields });
  }
}
function setPerson(id: string, fields: Record<string, unknown>) {
  db.docs.set(id, { ...(db.docs.get(id) ?? { _id: id, _type: "teamMembers" }), ...fields, _rev: nextRev() });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

let n = 0;
const token = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const idOf = (t: string) => `ministryEvent.${t}`;
const groups = (...g: string[]) => ({ kind: "groups", groups: g });
const MINISTRY = { kind: "ministry" };
const stored = (t: string) => db.docs.get(idOf(t)) as Record<string, unknown> | undefined;
const rev = (t: string) => stored(t)?._rev as string;
type Item = Record<string, unknown> & { _key: string };
const lines = (t: string) => stored(t)!.program as Item[];
const lineOf = (t: string, part: string) => lines(t).find((l) => l.part === part);
const ref = (id: string) => ({ _type: "reference", _ref: id, _weak: true });

/** Saturday 2026-11-21, a week after the clock below. */
const SATURDAY = "2026-11-21";

async function create(actor: string, body: Record<string, unknown>) {
  const t = token();
  const out = await createMinistryEvent(actor, "jovenes", { date: SATURDAY, ...body, token: t });
  return { t, out };
}
async function eventBy(by: string, body: Record<string, unknown>) {
  const { t, out } = await create(by, body);
  expect(out.status, JSON.stringify(out.body)).toBe(200);
  return t;
}
const update = (actor: string, t: string, body: Record<string, unknown>) =>
  updateMinistryEvent(actor, "jovenes", t, { _rev: rev(t), ...body });
const program = (actor: string, t: string, items: unknown) =>
  updateMinistryEventProgram(actor, "jovenes", t, { _rev: rev(t), program: items });
const part = (actor: string, t: string, id: string, body: Record<string, unknown>) =>
  updateMinistryEventPart(actor, "jovenes", t, id, { _rev: rev(t), ...body });

/** The Saturday meeting Frank described: published, for all of Jóvenes, every part assigned. */
const saturday = (over: Record<string, unknown> = {}) =>
  eventBy("admin", {
    audience: MINISTRY,
    published: true,
    time: "18:10",
    arrival: "17:30",
    place: "Oasis Tlalpan",
    seats: [
      { role: "encargado", member: "enc" },
      { role: "comparte", member: "goma" },
    ],
    program: [
      { part: "oracion", member: "pau" },
      { part: "dinamica1", member: "mkz", member2: "lali" },
      { label: "Anuncios", member: "enc", note: "Campamento" },
    ],
    ...over,
  });

const noticesOf = (out: { ok: boolean; effects?: { notices: unknown } }) => (out.ok ? out.effects!.notices : undefined) as
  | null
  | {
      assigned: Array<{ memberId: string; roles: Array<{ kind: string; id: string; partners: string[] }> }>;
      moved: boolean;
      music: Array<{ part: string; asks: boolean; note: string | null; members: string[]; names: string[] }>;
      meeting: Record<string, unknown>;
      ministry: string;
      actorId: string;
    };

beforeEach(() => {
  db.docs.clear();
  db.rev = 0;
  revalidate.mockReset();
  seedPeople();
  vi.stubEnv("SANITY_API_READ_TOKEN", "test-read-token");
  // Saturday 14 November 2026, noon in Mexico City: «today» for what is past and what is not.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-14T18:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

// ── M2: what a part line is ─────────────────────────────────────────────────

describe("M2: a part line as it is stored", () => {
  it("stores the table's label, both people weak, and only the fields it was given", async () => {
    const t = await eventBy("admin", {
      audience: MINISTRY,
      program: [
        { part: "dinamica1", label: "Lo que sea", member: "mkz", member2: "lali", note: "  Sillas  ", helpers: " Dani y Sofi " },
        { part: "oracion", member: "pau", music: "track" },
        { part: "platica", note: "La fe", music: "alabanza" },
      ],
    });
    const [d1, oracion, platica] = lines(t);
    expect(d1).toEqual({
      _key: d1._key,
      _type: "ministryEventProgramLine",
      label: "Dinámica 1",
      part: "dinamica1",
      member: ref("mkz"),
      member2: ref("lali"),
      note: "Sillas",
      helpers: "Dani y Sofi",
    });
    expect(oracion).toEqual({ _key: oracion._key, _type: "ministryEventProgramLine", label: "Oración", part: "oracion", member: ref("pau"), music: "track" });
    expect(platica).toEqual({ _key: platica._key, _type: "ministryEventProgramLine", label: "Plática", part: "platica", note: "La fe", music: "alabanza" });
  });

  it("a lone second person is stored as the first; an empty music is none", async () => {
    const t = await eventBy("admin", { audience: MINISTRY, program: [{ part: "dinamica2", member2: "mkz", music: "" }] });
    expect(lines(t)[0]).toEqual({ _key: lines(t)[0]._key, _type: "ministryEventProgramLine", label: "Dinámica 2", part: "dinamica2", member: ref("mkz") });
  });

  it("a free line is stored exactly as before", async () => {
    const t = await eventBy("admin", { audience: MINISTRY, program: [{ label: "Anuncios", member: "enc", note: "x" }] });
    expect(lines(t)[0]).toEqual({ _key: lines(t)[0]._key, _type: "ministryEventProgramLine", label: "Anuncios", member: ref("enc"), note: "x" });
  });

  const refused: Array<[string, unknown[]]> = [
    ["an unknown part", [{ part: "alabanza" }]],
    ["a part that is an inherited key", [{ part: "constructor" }]],
    ["a part that is not a string", [{ part: 1, label: "x" }]],
    ["the same part twice", [{ part: "oracion" }, { part: "oracion" }]],
    ["a person on Plática", [{ part: "platica", member: "goma" }]],
    ["two people on Oración", [{ part: "oracion", member: "pau", member2: "mkz" }]],
    ["the same person twice on a dinámica", [{ part: "dinamica1", member: "mkz", member2: "mkz" }]],
    ["music on a dinámica", [{ part: "dinamica1", music: "track" }]],
    ["a music that is no choice", [{ part: "oracion", music: "banda" }]],
    ["helpers on Oración", [{ part: "oracion", helpers: "Dani" }]],
    ["helpers on two lines", [{ part: "dinamica1", helpers: "Dani\nSofi" }]],
    ["helpers too long", [{ part: "dinamica1", helpers: "x".repeat(PART_LIMITS.helpers + 1) }]],
    ["a description too long", [{ part: "dinamica1", note: "x".repeat(LIMITS.note + 1) }]],
    ["a malformed second person", [{ part: "dinamica1", member2: { _ref: "mkz" } }]],
    ["a second person on a free line", [{ label: "Anuncios", member2: "mkz" }]],
    ["music on a free line", [{ label: "Anuncios", music: "track" }]],
    ["helpers on a free line", [{ label: "Anuncios", helpers: "Dani" }]],
    ["a free line with no label", [{ member: "enc" }]],
  ];
  it.each(refused)("refuses %s, on create and on the program PATCH alike", async (_name, items) => {
    const { out } = await create("admin", { audience: MINISTRY, program: items });
    expect([out.status, out.body]).toEqual([400, { error: EVENT_ERROR.invalidProgram }]);
    const t = await eventBy("admin", { audience: MINISTRY });
    expect((await program("admin", t, items)).body).toEqual({ error: EVENT_ERROR.invalidProgram });
    expect(lines(t)).toEqual([]);
  });

  it("the description's limit is the one the form shows", () => {
    expect(LIMITS.note).toBe(PART_LIMITS.note);
    expect(LIMITS.note).toBe(300);
  });
});

// ── M3: people with two slots ───────────────────────────────────────────────

describe("M3: people on a line with two slots (W5)", () => {
  it("swapping the two slots of a kept line re-validates nobody", async () => {
    const t = await saturday();
    setPerson("lali", { ministries: ["worship"], ministryRoles: [] });
    const d1 = lineOf(t, "dinamica1")!;
    const out = await program("enc", t, [{ _key: d1._key, part: "dinamica1", member: "lali", member2: "mkz" }]);
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(lines(t)).toEqual([{ _key: d1._key, _type: "ministryEventProgramLine", label: "Dinámica 1", part: "dinamica1", member: ref("lali"), member2: ref("mkz") }]);
  });

  it("an added second person must be an active member of Jóvenes", async () => {
    const t = await saturday();
    const o = lineOf(t, "oracion")!;
    const d1 = lineOf(t, "dinamica1")!;
    const out = await program("enc", t, [
      { _key: o._key, part: "oracion", member: "pau" },
      { _key: d1._key, part: "dinamica1", member: "mkz", member2: "worship" },
    ]);
    expect([out.status, out.body]).toEqual([400, { error: EVENT_ERROR.invalidMember }]);
  });

  it("a line that names someone who left stays editable while they stay on it", async () => {
    const t = await saturday();
    setPerson("mkz", { disabled: true });
    const d1 = lineOf(t, "dinamica1")!;
    const out = await program("enc", t, [{ _key: d1._key, part: "dinamica1", member: "lali", member2: "mkz" }, { label: "Cierre" }]);
    expect(out.status).toBe(200);
    expect(lines(t).map((l) => l.label)).toEqual(["Dinámica 1", "Cierre"]);
    expect([lineOf(t, "dinamica1")!.member, lineOf(t, "dinamica1")!.member2]).toEqual([ref("lali"), ref("mkz")]);
  });

  it("for a group's meeting, a second person must be in one of its groups", async () => {
    const t = await eventBy("leaderON", { audience: groups("otro-nivel") });
    const out = await program("leaderON", t, [{ part: "dinamica1", member: "pau", member2: "mkz" }]);
    expect(out.body).toEqual({ error: EVENT_ERROR.invalidMember });
  });
});

// ── M2a: a kept part line keeps what its responsable filled ─────────────────

describe("M2a: a kept part line keeps what its responsable filled (both program writers)", () => {
  /** A Saturday whose three parts are filled by their responsables, through W10. */
  async function filled() {
    const t = await saturday();
    expect((await part("pau", t, "oracion", { music: "alabanza", note: "Algo suave" })).status).toBe(200);
    expect((await part("mkz", t, "dinamica1", { note: "Sillas musicales", helpers: "Dani y Sofi" })).status).toBe(200);
    expect((await part("goma", t, "platica", { note: "Daniel 3", music: "track" })).status).toBe(200);
    return t;
  }
  const filledOf = (t: string) => lines(t).filter((l) => l.part).map((l) => [l.part, l.note ?? null, l.music ?? null, l.helpers ?? null]);
  const FILLED = [
    ["oracion", "Algo suave", "alabanza", null],
    ["dinamica1", "Sillas musicales", null, "Dani y Sofi"],
    ["platica", "Daniel 3", "track", null],
  ];
  /** The body an editor sends for the stored program: every line by its key, people as stored. */
  const echo = (t: string, change: (l: Item) => Record<string, unknown> = () => ({})) =>
    lines(t).map((l) => {
      const person = (x: unknown) => (x as { _ref: string } | undefined)?._ref;
      const base: Record<string, unknown> = { _key: l._key, member: person(l.member), member2: person(l.member2) };
      if (l.part) base.part = l.part;
      else Object.assign(base, { label: l.label, note: l.note });
      return { ...base, ...change(l) };
    });

  it("a body that sends the three fields changed, emptied or not at all stores the STORED ones", async () => {
    const t = await filled();
    for (const change of [
      () => ({}),
      (l: Item) => (l.part ? { note: "Pisada", music: l.part === "dinamica1" ? undefined : "track", helpers: l.part === "dinamica1" ? "Otros" : undefined } : {}),
      (l: Item) => (l.part ? { note: null, music: null, helpers: null } : {}),
    ]) {
      const out = await program("enc", t, echo(t, change));
      expect(out.status, JSON.stringify(out.body)).toBe(200);
      expect(filledOf(t)).toEqual(FILLED);
      // Nothing about the request changed, so nobody is told anything.
      expect(noticesOf(out)).toBeNull();
    }
  });

  it("the meeting PATCH with `program` keeps them too", async () => {
    const t = await filled();
    const out = await update("admin", t, { notes: "Traer Biblia", program: echo(t, (l) => (l.part ? { note: "Pisada" } : {})) });
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(filledOf(t)).toEqual(FILLED);
  });

  it("the body still decides a kept line's people, which lines remain and their order", async () => {
    const t = await filled();
    const [o, d1, anuncios, platica] = lines(t);
    const out = await program("enc", t, [
      { _key: platica._key, part: "platica" },
      { _key: d1._key, part: "dinamica1", member: "lali" },
      { _key: o._key, part: "oracion", member: "goma" },
    ]);
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(anuncios.label).toBe("Anuncios");
    expect(lines(t).map((l) => [l.part, l.member ?? null, l.member2 ?? null, l.note])).toEqual([
      ["platica", null, null, "Daniel 3"],
      ["dinamica1", ref("lali"), null, "Sillas musicales"],
      ["oracion", ref("goma"), null, "Algo suave"],
    ]);
  });

  it("a body that does not know parts can never turn one into a free line: 400, nothing written", async () => {
    const t = await filled();
    const before = JSON.stringify(stored(t));
    // What a tab loaded before the deploy sends for the same keys: `_key, label, member, note`.
    const old = lines(t).map((l) => ({ _key: l._key, label: l.label, member: (l.member as { _ref: string } | undefined)?._ref, note: l.note }));
    expect((await program("enc", t, old)).body).toEqual({ error: EVENT_ERROR.invalidProgram });
    expect((await update("admin", t, { program: old })).body).toEqual({ error: EVENT_ERROR.invalidProgram });
    // Nor may a kept part line become another part.
    const swapped = echo(t, (l) => (l.part === "dinamica1" ? { part: "dinamica2" } : {}));
    expect((await program("enc", t, swapped)).body).toEqual({ error: EVENT_ERROR.invalidProgram });
    expect(JSON.stringify(stored(t))).toBe(before);
  });

  it("a stale tab answers 409 before the part check", async () => {
    const t = await filled();
    const old = lines(t).map((l) => ({ _key: l._key, label: l.label }));
    const out = await updateMinistryEventProgram("enc", "jovenes", t, { _rev: "r-old", program: old });
    expect(out.status).toBe(409);
  });

  it("a part line that is NEW takes its three fields from the body: no key, an unknown key, or a free line's key", async () => {
    const t = await saturday({ program: [{ label: "Anuncios" }] });
    const [anuncios] = lines(t);
    const out = await program("enc", t, [
      { part: "oracion", member: "pau", music: "track", note: "Corta" },
      { _key: "nope", part: "dinamica1", member: "mkz", helpers: "Dani" },
      { _key: anuncios._key, part: "dinamica2", member: "lali", note: "Antes fue anuncios" },
    ]);
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(lines(t).map((l) => [l.part, l.note ?? null, l.music ?? null, l.helpers ?? null])).toEqual([
      ["oracion", "Corta", "track", null],
      ["dinamica1", null, null, "Dani"],
      ["dinamica2", "Antes fue anuncios", null, null],
    ]);
    expect(lines(t)[2]._key).toBe(anuncios._key);
  });

  it("any kind of meeting round-trips its part lines byte for byte", async () => {
    const t = await eventBy("admin", { audience: MINISTRY, kind: "ministry", published: true, date: "2026-11-20", seats: [{ role: "comparte", member: "goma" }, { role: "encargado", member: "enc" }] });
    expect((await part("goma", t, "platica", { note: "Daniel 3", music: "alabanza" })).status).toBe(200);
    const before = JSON.stringify(lines(t));
    const out = await program("enc", t, echo(t));
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(JSON.stringify(lines(t))).toBe(before);
    expect(noticesOf(out)).toBeNull();
  });

  it("a stored value that no longer passes the part's rules is dropped, not written back", async () => {
    const t = await filled();
    const id = idOf(t);
    const doc = db.docs.get(id)!;
    // A hand-edited document: music on a dinámica, an unknown choice on Oración.
    db.docs.set(id, {
      ...doc,
      program: (doc.program as Item[]).map((l) => (l.part === "dinamica1" ? { ...l, music: "track" } : l.part === "oracion" ? { ...l, music: "banda" } : l)),
    });
    expect((await program("enc", t, echo(t))).status).toBe(200);
    expect(filledOf(t)).toEqual([
      ["oracion", "Algo suave", null, null],
      ["dinamica1", "Sillas musicales", null, "Dani y Sofi"],
      ["platica", "Daniel 3", "track", null],
    ]);
  });

  it("removing a line with a standing request withdraws it, naming who had asked", async () => {
    const t = await filled();
    const out = await program("enc", t, echo(t).filter((l) => l.part !== "oracion"));
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(lineOf(t, "oracion")).toBeUndefined();
    expect(noticesOf(out)!.music).toEqual([{ part: "oracion", asks: false, note: null, members: ["pau"], names: [] }]);
  });
});

// ── M4: W10, «Mi parte» ─────────────────────────────────────────────────────

describe("W10: shape, with no I/O", () => {
  it("an unknown ministry, a token it could not have minted or a part that is none answers 404", async () => {
    const t = await saturday();
    for (const [ministry, tok, id] of [
      ["kids", t, "oracion"],
      ["nope", t, "oracion"],
      ["jovenes", "not-a-token", "oracion"],
      ["jovenes", t, "alabanza"],
      ["jovenes", t, "constructor"],
      ["jovenes", t, ""],
    ] as const) {
      const out = await updateMinistryEventPart("admin", ministry, tok, id, { _rev: rev(t), note: "x" });
      expect([out.status, out.body], `${ministry}/${tok}/${id}`).toEqual([404, { error: EVENT_ERROR.notFound }]);
    }
  });

  it("refuses a body that is no object, has no revision, or names none of the three fields", async () => {
    const t = await saturday();
    expect((await updateMinistryEventPart("pau", "jovenes", t, "oracion", null)).body).toEqual({ error: EVENT_ERROR.invalidBody });
    expect((await updateMinistryEventPart("pau", "jovenes", t, "oracion", { note: "x" })).body).toEqual({ error: EVENT_ERROR.revRequired });
    expect((await part("pau", t, "oracion", {})).body).toEqual({ error: EVENT_ERROR.nothingToUpdate });
    expect((await part("pau", t, "oracion", { label: "x", member: "mkz" })).body).toEqual({ error: EVENT_ERROR.nothingToUpdate });
  });

  const bad: Array<[string, string, Record<string, unknown>]> = [
    ["a description over 300", "dinamica1", { note: "x".repeat(301) }],
    ["a description that is no text", "dinamica1", { note: 5 }],
    ["music on a dinámica", "dinamica1", { music: "track" }],
    ["a music that is no choice", "oracion", { music: "banda" }],
    ["helpers on Oración", "oracion", { helpers: "Dani" }],
    ["helpers on two lines", "dinamica1", { helpers: "Dani\nSofi" }],
    ["helpers over 120", "dinamica1", { helpers: "x".repeat(121) }],
  ];
  it.each(bad)("refuses %s with invalid_part, before reading anything", async (_name, id, body) => {
    const t = await saturday();
    const before = stored(t);
    // «nobody» does not exist: a 400 here proves the body was judged before the actor was read.
    const out = await part("nobody", t, id, body);
    expect([out.status, out.body]).toEqual([400, { error: EVENT_ERROR.invalidPart }]);
    expect(stored(t)).toBe(before);
  });
});

describe("W10: who may fill a part", () => {
  it("the responsable of each part fills it: the line's first person, its second, and whoever shares", async () => {
    const t = await saturday();
    expect((await part("pau", t, "oracion", { music: "track", note: "Breve" })).status).toBe(200);
    expect((await part("mkz", t, "dinamica1", { note: "Sillas" })).status).toBe(200);
    expect((await part("lali", t, "dinamica1", { helpers: "Dani" })).status).toBe(200);
    expect((await part("goma", t, "platica", { note: "La fe", music: "alabanza" })).status).toBe(200);
    expect(lineOf(t, "oracion")).toMatchObject({ member: ref("pau"), music: "track", note: "Breve" });
    expect(lineOf(t, "dinamica1")).toMatchObject({ member: ref("mkz"), member2: ref("lali"), note: "Sillas", helpers: "Dani" });
    expect(lineOf(t, "platica")).toMatchObject({ label: "Plática", note: "La fe", music: "alabanza" });
  });

  it("a member of Jóvenes who is not that part's responsable is refused (403), whatever else they hold", async () => {
    const t = await saturday();
    for (const [actor, id] of [
      ["pau", "dinamica1"], // responsable of ANOTHER part
      ["mkz", "oracion"],
      ["pau", "platica"],
      ["goma", "oracion"], // shares, so Plática is theirs and nothing else
      ["jacob", "dinamica2"], // a leader holds no right on the whole ministry's meeting
      ["mkz", "dinamica2"], // nobody is on Dinámica 2 yet
    ] as const) {
      const out = await part(actor, t, id, { note: "x" });
      expect([out.status, out.body], `${actor}/${id}`).toEqual([403, { error: EVENT_ERROR.partForbidden }]);
    }
  });

  it("a typed name is no person: it grants nothing", async () => {
    const t = await saturday({ seats: [{ role: "comparte", name: "goma" }] });
    expect((await part("goma", t, "platica", { note: "x" })).status).toBe(403);
  });

  it("the encargado, the apoyo and an admin fill any part, also one with no line yet", async () => {
    const t = await saturday({ seats: [{ role: "encargado", member: "enc" }, { role: "apoyo", member: "lali" }] });
    expect((await part("enc", t, "oracion", { music: "alabanza" })).status).toBe(200);
    expect((await part("lali", t, "dinamica2", { note: "Por definir" })).status).toBe(200);
    expect((await part("admin", t, "platica", { note: "Tema" })).status).toBe(200);
    expect(lineOf(t, "dinamica2")).toMatchObject({ label: "Dinámica 2", note: "Por definir" });
    expect(lineOf(t, "dinamica2")!.member).toBeUndefined();
  });

  it("a seat is a reason to write, never to read: a DRAFT answers 404 to its responsable", async () => {
    const t = await saturday({ published: false });
    expect((await part("pau", t, "oracion", { note: "x" })).status).toBe(404);
    expect((await part("goma", t, "platica", { note: "x" })).status).toBe(404);
    // The admin reads drafts, so they still write it.
    expect((await part("admin", t, "oracion", { note: "x" })).status).toBe(200);
  });

  it("a responsable who left Jóvenes reads the meeting in neither mode: 404, never 403", async () => {
    const t = await saturday();
    setPerson("pau", { ministries: ["worship"], ministryRoles: [] });
    const out = await part("pau", t, "oracion", { note: "x" });
    expect([out.status, out.body]).toEqual([404, { error: EVENT_ERROR.notFound }]);
  });

  it("an inactive responsable is refused before the meeting is read (403)", async () => {
    const t = await saturday();
    setPerson("pau", { disabled: true });
    expect((await part("pau", t, "oracion", { note: "x" })).body).toEqual({ error: EVENT_ERROR.inactive });
  });

  it("another group's meeting is a 404 to a pastor outside it, even named on its line", async () => {
    const t = await eventBy("leaderON", { audience: groups("otro-nivel"), published: true, program: [{ part: "oracion", member: "pau" }] });
    // Stored by hand: the writer would refuse to add someone outside the group.
    const next = lines(t).map((l) => ({ ...l, member: ref("lali") }));
    db.docs.set(idOf(t), { ...stored(t)!, program: next });
    expect((await part("lali", t, "oracion", { note: "x" })).status).toBe(404);
  });

  it("a joint DRAFT its responsable reads only as a leader: 403, the member-read clause", async () => {
    // Created by leaderON, so jacob (who leads Otro Nivel too) reads the draft but may not edit it.
    const t = await eventBy("leaderON", { audience: groups("otro-nivel", "invencibles"), program: [{ part: "oracion", member: "jacob" }] });
    const out = await part("jacob", t, "oracion", { note: "x" });
    expect([out.status, out.body]).toEqual([403, { error: EVENT_ERROR.partForbidden }]);
    // Published, the same person on the same line writes.
    expect((await update("leaderON", t, { published: true })).status).toBe(200);
    expect((await part("jacob", t, "oracion", { note: "x" })).status).toBe(200);
  });

  it("a part line on a GROUP's meeting is filled by its responsable too, and announces nothing", async () => {
    const t = await eventBy("leaderON", { audience: groups("otro-nivel"), published: true, program: [{ part: "oracion", member: "pau" }] });
    const out = await part("pau", t, "oracion", { music: "alabanza", note: "x" });
    expect(out.status).toBe(200);
    expect(noticesOf(out)).toBeNull();
    expect((await part("goma", t, "oracion", { note: "y" })).status).toBe(403);
  });

  it("a moved revision is a 409, after the 404 and the 403", async () => {
    const t = await saturday();
    const old = rev(t);
    expect((await part("pau", t, "oracion", { note: "uno" })).status).toBe(200);
    const stale = await updateMinistryEventPart("pau", "jovenes", t, "oracion", { _rev: old, note: "dos" });
    expect([stale.status, stale.body]).toEqual([409, { error: EVENT_ERROR.stale }]);
    expect((await updateMinistryEventPart("mkz", "jovenes", t, "oracion", { _rev: old, note: "x" })).status).toBe(403);
    expect(lineOf(t, "oracion")!.note).toBe("uno");
  });
});

describe("W10: what it writes", () => {
  it("changes only that part's three fields: every other line, the seats and the meeting are the stored ones", async () => {
    const t = await saturday();
    const before = structuredClone(stored(t)!);
    const out = await part("mkz", t, "dinamica1", { note: "Sillas", helpers: "Dani" });
    expect(out.status).toBe(200);
    const after = stored(t)!;
    const [o0, d0, a0] = before.program as Item[];
    expect(after.program).toEqual([o0, { ...d0, note: "Sillas", helpers: "Dani" }, a0]);
    const { program: _p, _rev: _r, ...restBefore } = before;
    const { program: _q, _rev: _s, ...restAfter } = after;
    expect(restAfter).toEqual(restBefore);
    expect(out.body).toEqual({ ok: true, id: idOf(t), rev: after._rev });
    expect(revalidate).toHaveBeenCalledWith("jovenes");
  });

  it("never writes a person, a label, the seats or `published`, whatever the body says", async () => {
    const t = await saturday();
    const before = structuredClone(stored(t)!);
    const out = await part("pau", t, "oracion", {
      note: "Mía",
      member: "mkz",
      member2: "lali",
      label: "Otra cosa",
      part: "platica",
      published: false,
      seats: [],
      program: [],
      audience: groups("otro-nivel"),
      date: "2027-01-01",
    });
    expect(out.status).toBe(200);
    const after = stored(t)!;
    expect(lineOf(t, "oracion")).toEqual({ ...(before.program as Item[])[0], note: "Mía" });
    expect([after.seats, after.published, after.audience, after.date]).toEqual([before.seats, true, before.audience, before.date]);
  });

  it("`null` (or blank) removes a field; an absent key leaves it", async () => {
    const t = await saturday();
    await part("pau", t, "oracion", { note: "Nota", music: "alabanza" });
    await part("pau", t, "oracion", { note: "   " });
    expect(lineOf(t, "oracion")).toMatchObject({ music: "alabanza" });
    expect(lineOf(t, "oracion")).not.toHaveProperty("note");
    await part("pau", t, "oracion", { music: null });
    expect(lineOf(t, "oracion")).toEqual({ _key: lineOf(t, "oracion")!._key, _type: "ministryEventProgramLine", label: "Oración", part: "oracion", member: ref("pau") });
  });

  it("with no line and nothing to store it writes nothing and answers the current revision", async () => {
    const t = await saturday();
    const before = stored(t);
    const out = await part("goma", t, "platica", { note: null, music: "" });
    expect([out.status, out.body]).toEqual([200, { ok: true, id: idOf(t), rev: rev(t) }]);
    expect(stored(t)).toBe(before);
    expect(noticesOf(out)).toBeNull();
  });

  it("appends the Plática line with a fresh key, the table's label and no person", async () => {
    const t = await saturday();
    const keys = lines(t).map((l) => l._key);
    await part("goma", t, "platica", { note: "La fe" });
    const added = lines(t)[3];
    expect(lines(t).slice(0, 3).map((l) => l._key)).toEqual(keys);
    expect(added).toEqual({ _key: added._key, _type: "ministryEventProgramLine", label: "Plática", part: "platica", note: "La fe" });
    expect(keys).not.toContain(added._key);
  });

  it("a full program admits no new part line", async () => {
    const t = await eventBy("admin", {
      audience: MINISTRY,
      published: true,
      seats: [{ role: "comparte", member: "goma" }],
      program: Array.from({ length: LIMITS.lines }, (_, i) => ({ label: `Línea ${i + 1}` })),
    });
    const out = await part("goma", t, "platica", { note: "La fe" });
    expect([out.status, out.body]).toEqual([400, { error: EVENT_ERROR.invalidProgram }]);
    expect(lines(t)).toHaveLength(LIMITS.lines);
  });

  it("fills the FIRST line of a part when a hand-made document holds two", async () => {
    const t = await saturday();
    const extra = { _key: "dup", _type: "ministryEventProgramLine", label: "Oración", part: "oracion", member: ref("mkz") };
    db.docs.set(idOf(t), { ...stored(t)!, program: [...lines(t), extra] });
    // The second line's person is not the responsable the writer reads.
    expect((await part("mkz", t, "oracion", { note: "x" })).status).toBe(403);
    expect((await part("pau", t, "oracion", { note: "x" })).status).toBe(200);
    expect(lines(t).at(-1)).toEqual(extra);
  });
});

// ── M5: the notices each write answers ──────────────────────────────────────

describe("M5: the notices a write answers (pre-commit `before`)", () => {
  it("creating a published meeting announces everyone on it but the actor, with the meeting as the email shows it", async () => {
    const { t, out } = await create("admin", {
      audience: MINISTRY,
      published: true,
      time: "18:10",
      arrival: "17:30",
      place: "Oasis Tlalpan",
      title: "Noche especial",
      seats: [{ role: "encargado", member: "admin" }, { role: "comparte", member: "goma" }, { role: "comparte", name: "Invitado" }],
      program: [{ part: "dinamica1", member: "mkz", member2: "lali" }],
    });
    const n = noticesOf(out)!;
    expect(n.assigned.map((a) => a.memberId).sort()).toEqual(["goma", "lali", "mkz"]);
    expect(n.assigned.find((a) => a.memberId === "mkz")!.roles).toEqual([{ kind: "part", id: "dinamica1", label: "Dinámica 1", partners: ["lali"] }]);
    expect(n).toMatchObject({ moved: false, music: [], ministry: "jovenes", actorId: "admin" });
    expect(n.meeting).toEqual({ id: idOf(t), date: SATURDAY, time: "18:10", arrival: "17:30", place: "Oasis Tlalpan", title: "Noche especial", kind: "saturday" });
  });

  it("a draft, a past meeting and a group's meeting announce nobody", async () => {
    const people = { seats: [{ role: "encargado", member: "enc" }] };
    expect(noticesOf((await create("admin", { audience: MINISTRY, ...people })).out)).toBeNull();
    expect(noticesOf((await create("admin", { audience: MINISTRY, published: true, date: "2026-11-13", ...people })).out)).toBeNull();
    expect(noticesOf((await create("leaderON", { audience: groups("otro-nivel"), published: true, seats: [{ role: "encargado", member: "pau" }] })).out)).toBeNull();
  });

  it("today still announces (the day is Mexico City's)", async () => {
    const { out } = await create("admin", { audience: MINISTRY, published: true, date: "2026-11-14", seats: [{ role: "encargado", member: "enc" }] });
    expect(noticesOf(out)!.assigned.map((a) => a.memberId)).toEqual(["enc"]);
  });

  it("the program PATCH announces only the person it adds, with the stored arrival and title", async () => {
    const t = await saturday({ title: "Noche especial" });
    const o = lineOf(t, "oracion")!;
    const d1 = lineOf(t, "dinamica1")!;
    const out = await program("enc", t, [
      { _key: o._key, part: "oracion", member: "pau" },
      { _key: d1._key, part: "dinamica1", member: "mkz", member2: "lali" },
      { part: "dinamica2", member: "goma" },
    ]);
    const n = noticesOf(out)!;
    expect(n.assigned).toEqual([{ memberId: "goma", roles: [{ kind: "part", id: "dinamica2", label: "Dinámica 2", partners: [] }] }]);
    expect(n.meeting).toMatchObject({ arrival: "17:30", title: "Noche especial", time: "18:10", place: "Oasis Tlalpan", kind: "saturday" });
    expect(n.actorId).toBe("enc");
  });

  it("publishing announces everyone; saving it again announces nobody", async () => {
    const t = await saturday({ published: false });
    const out = await update("admin", t, { published: true });
    expect(noticesOf(out)!.assigned.map((a) => a.memberId).sort()).toEqual(["enc", "goma", "lali", "mkz", "pau"]);
    expect(noticesOf(await update("admin", t, { notes: "Traer Biblia" }))).toBeNull();
  });

  it("a new date announces everyone again, as moved", async () => {
    const t = await saturday();
    const n = noticesOf(await update("admin", t, { date: "2026-11-28" }))!;
    expect(n.moved).toBe(true);
    expect(n.assigned).toHaveLength(5);
    expect(n.meeting.date).toBe("2026-11-28");
  });

  it("asking for the worship team, and withdrawing it, is said once each — with the note and who asks", async () => {
    const t = await saturday();
    const asked = noticesOf(await part("pau", t, "oracion", { music: "alabanza", note: "Algo suave" }))!;
    expect(asked.assigned).toEqual([]);
    expect(asked.music).toEqual([{ part: "oracion", asks: true, note: "Algo suave", members: ["pau"], names: [] }]);
    // The same choice again, or only a new note, is not a new request.
    expect(noticesOf(await part("pau", t, "oracion", { note: "Otra nota" }))).toBeNull();
    const gone = noticesOf(await part("pau", t, "oracion", { music: "track" }))!;
    expect(gone.music).toEqual([{ part: "oracion", asks: false, note: null, members: ["pau"], names: [] }]);
  });

  it("Plática's request names whoever shares, members and typed names", async () => {
    const t = await saturday({ seats: [{ role: "comparte", member: "goma" }, { role: "comparte", name: "Pastor invitado" }] });
    const n = noticesOf(await part("goma", t, "platica", { music: "alabanza" }))!;
    expect(n.music).toEqual([{ part: "platica", asks: true, note: null, members: ["goma"], names: ["Pastor invitado"] }]);
  });

  it("unpublishing a meeting with a request withdraws it; deleting announces nothing", async () => {
    const t = await saturday();
    await part("pau", t, "oracion", { music: "alabanza" });
    const n = noticesOf(await update("admin", t, { published: false }))!;
    expect(n.assigned).toEqual([]);
    expect(n.music.map((m) => [m.part, m.asks])).toEqual([["oracion", false]]);
    await update("admin", t, { published: true });
    const out = await deleteMinistryEvent("admin", "jovenes", t, { _rev: rev(t) });
    expect(out.status).toBe(200);
    expect(noticesOf(out)).toBeNull();
  });

  it("a refused write answers no notices at all", async () => {
    const t = await saturday();
    const out = await part("mkz", t, "oracion", { music: "alabanza" });
    expect(out.ok).toBe(false);
    expect("effects" in out).toBe(false);
  });
});
