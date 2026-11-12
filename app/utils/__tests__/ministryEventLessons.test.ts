// A group's classes on the one writer (plan 2026-11-12 L0–L4, ADR-0081 addendum): the `lesson`
// field, «Recorrer» and «Cambiar con…». The harness is G4's (`ministryEventCommit.test.ts`): the
// writer's own GROQ on groq-js, and a fake writer with Content Lake's two refusals that matter.
//
// The writer's own GROQ (the stored read under R1's identity filters, the fresh access read, the
// people check) runs on groq-js over an in-memory dataset, and a small fake writer applies its
// mutations with Content Lake's two refusals that matter here: an id that already exists, and a
// revision that does not match. So each row exercises the real refusal order — body, inactive,
// unreadable (404), not allowed (403), stale (409) — on documents the writer itself created.

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
  createMinistryEvent,
  shiftMinistryLesson,
  swapMinistryLessons,
  updateMinistryEvent,
} from "../ministryEventCommit";
import { buildMinistryEventQuery, readMinistryEvents } from "../ministryEventReads";

// ── People ──────────────────────────────────────────────────────────────────

// A leader leads every group they are in unless `JL` says otherwise (§11 N10: the fixtures store the
// `leaderOf` every stored leader has, so each test keeps its intent under L2).
const J = (level: string, groups: string[]) => ({
  ministries: ["jovenes"],
  ministryRoles: [{ _key: "jovenes", ministry: "jovenes", level, groups, ...(level === "leader" ? { leaderOf: groups } : {}) }],
});
/** A leader who LEADS `leaderOf` and is only IN the rest of `groups` (plan 2026-11-11 §4.1). */
const JL = (groups: string[], leaderOf: unknown) => ({
  ministries: ["jovenes"],
  ministryRoles: [{ _key: "jovenes", ministry: "jovenes", level: "leader", groups, leaderOf }],
});
const PEOPLE: Record<string, Record<string, unknown>> = {
  admin: J("admin", []),
  // Leads Otro Nivel (A), is only IN Invencibles (B) — Jacob's shape before his roster is set.
  jacob: JL(["otro-nivel", "invencibles"], ["otro-nivel"]),
  // Leads Invencibles, is only IN Otro Nivel.
  andy: JL(["invencibles", "otro-nivel"], ["invencibles"]),
  // `level: "leader"` with an empty leaderOf: for every check, a member.
  leadsNone: JL(["otro-nivel"], []),
  super: { role: "super-admin", ministries: ["worship"] },
  leaderON: J("leader", ["otro-nivel"]),
  leaderON2: J("leader", ["otro-nivel"]),
  leaderEM: J("leader", ["emprendedores"]),
  pastorON: J("member", ["otro-nivel"]),
  pastorEM: J("member", ["emprendedores"]),
  pastorINV: J("member", ["invencibles"]),
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

async function create(actor: string, body: Record<string, unknown>) {
  const t = (body.token as string) ?? token();
  const out = await createMinistryEvent(actor, "jovenes", { date: "2026-11-14", ...body, token: t });
  return { t, out };
}
const update = (actor: string, t: string, body: Record<string, unknown>) =>
  updateMinistryEvent(actor, "jovenes", t, { _rev: rev(t), ...body });

/** An event created by `by`, then shaped by an admin (publish etc.) so the row starts where it needs to. */
async function eventBy(by: string, body: Record<string, unknown>) {
  const { t, out } = await create(by, body);
  expect(out.status, JSON.stringify(out.body)).toBe(200);
  return t;
}

beforeEach(() => {
  db.docs.clear();
  db.rev = 0;
  revalidate.mockReset();
  seedPeople();
  vi.stubEnv("SANITY_API_READ_TOKEN", "test-read-token");
});
afterEach(() => vi.unstubAllEnvs());


// ── Classes ─────────────────────────────────────────────────────────────────

const ON = groups("otro-nivel");
const lesson = (over: Record<string, unknown> = {}) => ({ series: "El Caos Dentro de Mi", track: "libro", done: false, ...over });
const seat = (member: string) => [{ role: "encargado", member }];

/** A class of Otro Nivel, created by an admin. */
const cls = (date: string, over: Record<string, unknown> = {}) =>
  eventBy("admin", { audience: ON, date, lesson: lesson(), published: true, ...over });

const shift = (actor: string, t: string, body: Record<string, unknown> = {}) =>
  shiftMinistryLesson(actor, "jovenes", t, { _rev: rev(t), token: token(), ...body });
const swap = (actor: string, a: string, b: string, body: Record<string, unknown> = {}) =>
  swapMinistryLessons(actor, "jovenes", a, { _rev: rev(a), with: { token: b, _rev: rev(b) }, ...body });

describe("L1/L2: the lesson field", () => {
  it("stores the lesson it built, trimmed, with its own _type", async () => {
    const t = await cls("2026-11-15", { lesson: { series: "  El Caos Dentro de Mi ", track: "corazon", done: false } });
    expect(stored(t)!.lesson).toEqual({ _type: "ministryEventLesson", series: "El Caos Dentro de Mi", track: "corazon", done: false });
  });

  it.each([
    [{ series: "", track: "libro", done: false }],
    [{ series: "a\nb", track: "libro", done: false }],
    [{ series: "x".repeat(81), track: "libro", done: false }],
    [{ series: "x", track: "otro", done: false }],
    [{ series: "x", track: "libro", done: "no" }],
    [{ series: "x", track: "libro" }],
    [{ series: "x", track: "libro", done: false, extra: 1 }],
    [{ series: "x", track: "libro", done: false, _type: "other" }],
    ["libro"],
  ])("refuses a malformed lesson %j (400, nothing written)", async (bad) => {
    const before = db.docs.size;
    const { out } = await create("admin", { audience: ON, lesson: bad });
    expect([out.status, out.body]).toEqual([400, { error: EVENT_ERROR.invalidLesson }]);
    expect(db.docs.size).toBe(before);
  });

  it("refuses a lesson on a shared or whole-ministry meeting (L0)", async () => {
    for (const audience of [groups("otro-nivel", "invencibles"), MINISTRY]) {
      const { out } = await create("admin", { audience, lesson: lesson(), ...(audience === MINISTRY ? { kind: "saturday" } : {}) });
      expect([out.status, out.body]).toEqual([400, { error: EVENT_ERROR.invalidLesson }]);
    }
  });

  it("a leader of the group ticks «Hecho»; a leader of another group gets 403, an outsider 404 on a draft", async () => {
    const t = await cls("2026-11-15", { published: false });
    expect((await update("leaderON", t, { lesson: lesson({ done: true }) })).status).toBe(200);
    expect((stored(t)!.lesson as { done: boolean }).done).toBe(true);
    expect((await update("leaderEM", t, { lesson: lesson() })).status).toBe(404);
    await update("admin", t, { published: true });
    expect((await update("leaderEM", t, { lesson: lesson() })).status).toBe(404);
    expect((await update("andy", t, { lesson: lesson() })).status).toBe(403);
  });

  it("refuses a lesson when the PATCH makes the meeting shared, after the 403 and before the 409", async () => {
    const t = await cls("2026-11-15");
    const out = await update("admin", t, { audience: groups("otro-nivel", "invencibles"), lesson: lesson() });
    expect([out.status, out.body]).toEqual([400, { error: EVENT_ERROR.invalidLesson }]);
    const stale = await updateMinistryEvent("admin", "jovenes", t, { _rev: "old", audience: groups("otro-nivel", "invencibles"), lesson: lesson() });
    expect(stale.status).toBe(400);
  });

  it("unsets the lesson when the meeting ends up shared and the body is silent, or on lesson: null", async () => {
    const a = await cls("2026-11-15");
    expect((await update("admin", a, { audience: groups("otro-nivel", "invencibles") })).status).toBe(200);
    expect(stored(a)!.lesson).toBeUndefined();
    const b = await cls("2026-11-22");
    expect((await update("admin", b, { lesson: null })).status).toBe(200);
    expect(stored(b)!.lesson).toBeUndefined();
    const c = await cls("2026-11-29");
    expect((await update("admin", c, { title: "Cap 7" })).status).toBe(200);
    expect(stored(c)!.lesson).toBeDefined();
  });

  it("a dormant lesson left on a shared meeting by older code stays editable and is not read as a class", async () => {
    const t = await eventBy("admin", { audience: groups("otro-nivel", "invencibles"), published: true });
    db.docs.set(idOf(t), { ...stored(t)!, lesson: lesson() });
    const [view] = await readMinistryEvents({ active: true, role: "member", ministries: ["jovenes"], managesMinistries: [], ministryRoles: [{ ministry: "jovenes", level: "admin", groups: [], leaderOf: [] }] } as never, { me: "admin", ministry: "jovenes", from: "2026-01-01", to: "2026-12-31", mode: "editor" });
    expect(view.lesson).toBeNull();
    expect((await update("admin", t, { title: "Junta" })).status).toBe(200);
    expect(stored(t)!.lesson).toBeUndefined();
  });
});

describe("L6: the reader", () => {
  it("projects lesson, and the projection is the only change to the query", () => {
    const q = buildMinistryEventQuery(
      { active: true, role: "member", ministries: ["jovenes"], managesMinistries: [], ministryRoles: [{ ministry: "jovenes", level: "member", groups: ["otro-nivel"], leaderOf: [] }] } as never,
      { me: "m", ministry: "jovenes", from: "2026-01-01", to: "9999-12-31", mode: "member" },
    )!;
    expect(q.query).toContain("lesson,");
    expect(q.query).not.toMatch(/lesson[^,]*==/);
  });
});

describe("L3: «Recorrer»", () => {
  async function roster() {
    const c5 = await cls("2026-11-15", { title: "Cap 5", seats: seat("leaderON") });
    const c6 = await cls("2026-11-22", { title: "Cap 6" });
    const c7 = await cls("2026-11-29", { title: "Cap 7" });
    const c8 = await cls("2026-12-06", { title: "Cap 8" });
    return { c5, c6, c7, c8 };
  }
  const ids = (...ts: string[]) => ts.map(idOf);

  it("moves the class and every later one a week, and leaves a DRAFT «No hubo clase» on its date", async () => {
    const { c5, c6, c7, c8 } = await roster();
    const marker = token();
    const out = await shift("leaderON", c6, { token: marker, ids: ids(c6, c7, c8) });
    expect([out.status, out.body]).toEqual([200, { ok: true, id: idOf(c6), rev: null, moved: 3 }]);
    expect([c5, c6, c7, c8].map((t) => stored(t)!.date)).toEqual(["2026-11-15", "2026-11-29", "2026-12-06", "2026-12-13"]);
    const m = stored(marker)!;
    expect(m).toMatchObject({
      date: "2026-11-22",
      title: "No hubo clase",
      published: false,
      kind: "group",
      audience: { kind: "groups", groups: ["otro-nivel"] },
      lesson: { _type: "ministryEventLesson", series: "El Caos Dentro de Mi", track: "sin_clase", done: false },
      seats: [],
      createdBy: { _ref: "leaderON" },
    });
    expect(m.time).toBeUndefined();
    expect(m.place).toBeUndefined();
    expect(revalidate).toHaveBeenCalledWith("jovenes");
  });

  it("never moves a «No hubo clase» date; classes hop over it, in order", async () => {
    const { c6, c7, c8 } = await roster();
    const camp = await cls("2026-12-13", { title: "Campamento", lesson: lesson({ track: "sin_clase" }) });
    const c9 = await cls("2026-12-20", { title: "Cap 9" });
    const out = await shift("admin", c7, { ids: ids(c7, c8, c9) });
    expect(out.status).toBe(200);
    expect(stored(c6)!.date).toBe("2026-11-22");
    expect([c7, c8, c9].map((t) => stored(t)!.date)).toEqual(["2026-12-06", "2026-12-20", "2026-12-27"]);
    expect(stored(camp)!.date).toBe("2026-12-13");
  });

  it("crosses a year end in calendar arithmetic", async () => {
    const a = await cls("2026-12-27");
    expect((await shift("admin", a, { ids: ids(a) })).status).toBe(200);
    expect(stored(a)!.date).toBe("2027-01-03");
  });

  it("leaves other rosters, other groups, plain meetings and earlier classes alone", async () => {
    const { c5, c6, c7, c8 } = await roster();
    const other = await cls("2026-11-29", { lesson: lesson({ series: "Otro libro" }) });
    const inv = await eventBy("admin", { audience: groups("invencibles"), date: "2026-11-29", lesson: lesson(), published: true });
    const plain = await eventBy("admin", { audience: ON, date: "2026-11-29", published: true });
    expect((await shift("admin", c6, { ids: ids(c6, c7, c8) })).status).toBe(200);
    expect([c5, other, inv, plain].map((t) => stored(t)!.date)).toEqual(["2026-11-15", "2026-11-29", "2026-11-29", "2026-11-29"]);
  });

  it("refuses when the screen's list is not the stored roster (409), and nothing moves", async () => {
    const { c6, c7, c8 } = await roster();
    const out = await shift("admin", c6, { ids: ids(c6, c7) });
    expect([out.status, out.body]).toEqual([409, { error: EVENT_ERROR.shiftChanged }]);
    expect([c6, c7, c8].map((t) => stored(t)!.date)).toEqual(["2026-11-22", "2026-11-29", "2026-12-06"]);
  });

  it("refuses when a later class is already done (409)", async () => {
    const { c6, c7, c8 } = await roster();
    await update("admin", c8, { lesson: lesson({ done: true }) });
    const out = await shift("admin", c6, { ids: ids(c6, c7, c8) });
    expect([out.status, out.body]).toEqual([409, { error: EVENT_ERROR.shiftDone }]);
  });

  it("refuses a done anchor, a «No hubo clase» anchor and a meeting that is not a class (400)", async () => {
    const done = await cls("2026-11-15", { lesson: lesson({ done: true }) });
    const gap = await cls("2026-11-22", { lesson: lesson({ track: "sin_clase" }) });
    const plain = await eventBy("admin", { audience: ON, date: "2026-11-29" });
    for (const t of [done, gap, plain]) {
      const out = await shift("admin", t, { ids: ids(t) });
      expect([out.status, out.body]).toEqual([400, { error: EVENT_ERROR.invalidShift }]);
    }
  });

  it("answers 404 to a leader of another group on a draft, 403 on a published class, and 409 on a stale revision", async () => {
    const t = await cls("2026-11-15", { published: false });
    expect((await shift("leaderEM", t, { ids: ids(t) })).status).toBe(404);
    await update("admin", t, { published: true });
    expect((await shift("andy", t, { ids: ids(t) })).status).toBe(403);
    const stale = await shiftMinistryLesson("admin", "jovenes", t, { _rev: "old", token: token(), ids: ids(t) });
    expect([stale.status, stale.body]).toEqual([409, { error: EVENT_ERROR.stale }]);
  });

  it.each([
    [{ ids: [] }],
    [{ ids: "x" }],
    [{ ids: ["ministryEvent.nope"] }],
    [{ token: "nope" }],
    [{ _rev: "" }],
  ])("refuses a malformed body %j with 400 and no write", async (bad) => {
    const t = await cls("2026-11-15");
    const out = await shift("admin", t, { ids: ids(t), ...bad });
    expect(out.status).toBe(400);
    expect(stored(t)!.date).toBe("2026-11-15");
  });

  it("a retry with the same marker token after success is a 409, never a double move", async () => {
    const { c8 } = await roster();
    const marker = token();
    expect((await shift("admin", c8, { token: marker, ids: ids(c8) })).status).toBe(200);
    const again = await shiftMinistryLesson("admin", "jovenes", c8, { _rev: rev(c8), token: marker, ids: ids(c8) });
    expect([again.status, again.body]).toEqual([409, { error: EVENT_ERROR.stale }]);
    expect(stored(c8)!.date).toBe("2026-12-13");
  });

  it("refuses a roster of more than 60 rows (400)", async () => {
    const all: string[] = [];
    for (let i = 0; i < 61; i++) {
      const d = new Date(Date.UTC(2026, 10, 15 + 7 * i)).toISOString().slice(0, 10);
      all.push(await cls(d));
    }
    const out = await shift("admin", all[0], { ids: ids(...all.slice(0, 60)) });
    expect([out.status, out.body]).toEqual([400, { error: EVENT_ERROR.invalidShift }]);
  });
});

describe("L4: «Cambiar con…»", () => {
  it("trades every seat of two classes of one group, in one write", async () => {
    const a = await cls("2026-11-15", { seats: [{ role: "encargado", member: "jacob" }, { role: "apoyo", name: "Todos" }] });
    const b = await cls("2026-11-22", { seats: seat("pastorON") });
    const out = await swap("leaderON", a, b);
    expect(out.status).toBe(200);
    expect((stored(a)!.seats as Array<Record<string, unknown>>).map((s) => s.member)).toEqual([{ _type: "reference", _ref: "pastorON", _weak: true }]);
    expect((stored(b)!.seats as Array<Record<string, unknown>>).map((s) => [s.role, s.name ?? (s.member as { _ref: string })._ref])).toEqual([
      ["encargado", "jacob"],
      ["apoyo", "Todos"],
    ]);
    expect([stored(a)!.date, stored(b)!.date]).toEqual(["2026-11-15", "2026-11-22"]);
  });

  it("refuses classes of two groups, a done class, a «No hubo clase» row, or the same class twice (400)", async () => {
    const a = await cls("2026-11-15");
    const inv = await eventBy("admin", { audience: groups("invencibles"), date: "2026-11-22", lesson: lesson() });
    const done = await cls("2026-11-29", { lesson: lesson({ done: true }) });
    const gap = await cls("2026-12-06", { lesson: lesson({ track: "sin_clase" }) });
    for (const b of [inv, done, gap]) expect((await swap("admin", a, b)).status).toBe(400);
    expect((await swap("admin", a, a)).status).toBe(400);
  });

  it("refuses moving someone who has left the group (400 invalid_member)", async () => {
    const a = await cls("2026-11-15", { seats: seat("pastorON") });
    const b = await cls("2026-11-22");
    setPerson("pastorON", J("member", ["emprendedores"]));
    const out = await swap("admin", a, b);
    expect([out.status, out.body]).toEqual([400, { error: EVENT_ERROR.invalidMember }]);
  });

  it("answers 404 when either class is unreadable, 403 to a leader of another group, 409 when one moved", async () => {
    const a = await cls("2026-11-15", { published: false });
    const b = await cls("2026-11-22");
    expect((await swap("leaderEM", a, b)).status).toBe(404);
    expect((await swap("andy", b, a)).status).toBe(404);
    await update("admin", a, { published: true });
    expect((await swap("andy", a, b)).status).toBe(403);
    const stale = await swapMinistryLessons("admin", "jovenes", a, { _rev: rev(a), with: { token: b, _rev: "old" } });
    expect(stale.status).toBe(409);
  });
});
