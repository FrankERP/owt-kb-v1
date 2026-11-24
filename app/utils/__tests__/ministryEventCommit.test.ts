// G4 — the write matrix of `ministryEvent` (ADR-0081; plan §5 W1–W8, §6 G4).
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
  deleteMinistryEvent,
  updateMinistryEvent,
  updateMinistryEventProgram,
} from "../ministryEventCommit";
import { MinistryEventReadUnavailable } from "../ministryEventReads";

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
const program = (actor: string, t: string, body: Record<string, unknown>) =>
  updateMinistryEventProgram(actor, "jovenes", t, { _rev: rev(t), ...body });
const remove = (actor: string, t: string, body: Record<string, unknown> = {}) =>
  deleteMinistryEvent(actor, "jovenes", t, { _rev: rev(t), ...body });

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

// ── Rows ────────────────────────────────────────────────────────────────────

describe("G4: a leader's joint meeting", () => {
  it("a leader of Otro Nivel creates a joint meeting with Emprendedores; createdBy is the actor, whatever the body says", async () => {
    const t = await eventBy("leaderON", { audience: groups("otro-nivel", "emprendedores"), createdBy: "admin" });
    const doc = stored(t)!;
    expect(doc.createdBy).toEqual({ _type: "reference", _ref: "leaderON", _weak: true });
    expect(doc.kind).toBe("joint");
    expect(doc.published).toBe(false);
    expect(revalidate).toHaveBeenCalledWith("jovenes");
  });

  it("its creator edits, publishes, adds Invencibles and deletes it", async () => {
    const t = await eventBy("leaderON", { audience: groups("otro-nivel", "emprendedores") });
    expect((await update("leaderON", t, { title: "Junta" })).status).toBe(200);
    expect((await update("leaderON", t, { published: true })).status).toBe(200);
    expect((await update("leaderON", t, { audience: groups("otro-nivel", "emprendedores", "invencibles") })).status).toBe(200);
    expect(stored(t)!.published).toBe(true);
    expect((await remove("leaderON", t)).status).toBe(200);
    expect(stored(t)).toBeUndefined();
  });

  it("its creator cannot leave it to Emprendedores alone (403)", async () => {
    const t = await eventBy("leaderON", { audience: groups("otro-nivel", "emprendedores") });
    const out = await update("leaderON", t, { audience: groups("emprendedores") });
    expect([out.status, out.body]).toEqual([403, { error: EVENT_ERROR.forbidden }]);
  });

  it("an Emprendedores leader reads it but answers 403 on edit, publish and delete", async () => {
    const t = await eventBy("leaderON", { audience: groups("otro-nivel", "emprendedores") });
    for (const out of [
      await update("leaderEM", t, { title: "x" }),
      await update("leaderEM", t, { published: true }),
      await remove("leaderEM", t),
    ]) expect(out.status).toBe(403);
    expect(stored(t)).toBeDefined();
  });

  it("a joint meeting an admin created is the admins' (403 to every leader)", async () => {
    const t = await eventBy("admin", { audience: groups("otro-nivel", "emprendedores") });
    expect((await update("leaderON", t, { title: "x" })).status).toBe(403);
    expect((await update("admin", t, { title: "x" })).status).toBe(200);
    expect((await update("super", t, { title: "y" })).status).toBe(200);
  });

  it("a demoted creator: 403 while they still read it (published), 404 once they cannot (draft)", async () => {
    const pub = await eventBy("leaderON", { audience: groups("otro-nivel", "emprendedores"), published: true });
    const draft = await eventBy("leaderON", { audience: groups("otro-nivel", "emprendedores") });
    setPerson("leaderON", J("member", ["otro-nivel"]));
    expect((await update("leaderON", pub, { title: "x" })).status).toBe(403);
    expect((await update("leaderON", draft, { title: "x" })).status).toBe(404);
  });

  it("a creator moved out of every stored group: 404 on the draft", async () => {
    const draft = await eventBy("leaderON", { audience: groups("otro-nivel", "emprendedores") });
    setPerson("leaderON", J("leader", ["invencibles"]));
    expect((await update("leaderON", draft, { title: "x" })).status).toBe(404);
  });

  it("a dangling createdBy leaves the joint meeting to the admins", async () => {
    const t = await eventBy("leaderON", { audience: groups("otro-nivel", "emprendedores") });
    db.docs.set(idOf(t), { ...stored(t)!, createdBy: { _type: "reference", _ref: "gone", _weak: true } });
    expect((await update("leaderON", t, { title: "x" })).status).toBe(403);
    expect((await update("admin", t, { title: "x" })).status).toBe(200);
  });

  it("a PATCH carrying createdBy never changes it", async () => {
    const t = await eventBy("leaderON", { audience: groups("otro-nivel", "emprendedores") });
    expect((await update("admin", t, { title: "x", createdBy: { _ref: "admin" } })).status).toBe(200);
    expect((stored(t)!.createdBy as { _ref: string })._ref).toBe("leaderON");
  });
});

describe("G4: a one-group meeting", () => {
  it("a second leader of the group edits it and adds Emprendedores; createdBy stays, and from then on that leader is refused", async () => {
    const t = await eventBy("leaderON", { audience: groups("otro-nivel") });
    expect((await update("leaderON2", t, { title: "x" })).status).toBe(200);
    expect((await update("leaderON2", t, { audience: groups("otro-nivel", "emprendedores") })).status).toBe(200);
    expect((stored(t)!.createdBy as { _ref: string })._ref).toBe("leaderON");
    expect(stored(t)!.kind).toBe("joint");
    expect((await update("leaderON2", t, { title: "y" })).status).toBe(403);
  });

  it("a leader cannot create an Emprendedores-only meeting, nor a whole-ministry one", async () => {
    expect((await create("leaderON", { audience: groups("emprendedores") })).out.status).toBe(403);
    expect((await create("leaderON", { audience: MINISTRY })).out.status).toBe(403);
    expect((await create("pastorON", { audience: groups("otro-nivel") })).out.status).toBe(403);
    expect((await create("admin", { audience: MINISTRY })).out.status).toBe(200);
  });

  it("any write by an Otro Nivel leader to an Emprendedores-only meeting is a 404, drafted or published", async () => {
    const draft = await eventBy("leaderEM", { audience: groups("emprendedores") });
    const pub = await eventBy("leaderEM", { audience: groups("emprendedores"), published: true });
    for (const t of [draft, pub]) {
      expect((await update("leaderON", t, { title: "x" })).status).toBe(404);
      expect((await program("leaderON", t, { program: [] })).status).toBe(404);
      expect((await remove("leaderON", t)).status).toBe(404);
    }
  });

  it("a leader cannot turn their group's meeting into the whole ministry's", async () => {
    const t = await eventBy("leaderON", { audience: groups("otro-nivel") });
    expect((await update("leaderON", t, { audience: MINISTRY })).status).toBe(403);
  });
});

describe("G4: the create token", () => {
  it("a token colliding with a meeting the actor cannot read answers 404, not 409", async () => {
    const t = await eventBy("leaderEM", { audience: groups("emprendedores") });
    const { out } = await create("leaderON", { token: t, audience: groups("otro-nivel") });
    expect([out.status, out.body]).toEqual([404, { error: EVENT_ERROR.notFound }]);
  });

  it("a retry of the same token answers 409 already_created and leaves one document", async () => {
    const t = await eventBy("leaderON", { audience: groups("otro-nivel") });
    const before = db.docs.size;
    const { out } = await create("leaderON", { token: t.toUpperCase(), audience: groups("otro-nivel") });
    expect([out.status, out.body]).toEqual([409, { error: EVENT_ERROR.alreadyCreated, id: idOf(t) }]);
    expect(db.docs.size).toBe(before);
  });

  it("refuses a token that is not a v4 UUID", async () => {
    const out = await createMinistryEvent("admin", "jovenes", { token: "abc", audience: MINISTRY, date: "2026-11-14" });
    expect(out.status).toBe(400);
  });
});

describe("G4: revision and precedence", () => {
  it("missing _rev is a 400, a stale one a 409, and a stale one on an unreadable meeting a 404", async () => {
    const t = await eventBy("leaderON", { audience: groups("otro-nivel") });
    const em = await eventBy("leaderEM", { audience: groups("emprendedores") });
    expect((await updateMinistryEvent("leaderON", "jovenes", t, { title: "x" })).body).toEqual({ error: EVENT_ERROR.revRequired });
    expect((await updateMinistryEvent("leaderON", "jovenes", t, { _rev: "old", title: "x" })).status).toBe(409);
    expect((await updateMinistryEvent("leaderON", "jovenes", em, { _rev: "old", title: "x" })).status).toBe(404);
    expect((await deleteMinistryEvent("leaderON", "jovenes", t, {})).status).toBe(400);
  });

  it("an actor whose fresh read says inactive (or is gone) is refused on every write", async () => {
    const t = await eventBy("admin", { audience: MINISTRY, published: true });
    setPerson("admin", { disabled: true });
    expect((await create("admin", { audience: MINISTRY })).out.status).toBe(403);
    expect((await update("admin", t, { title: "x" })).status).toBe(403);
    expect((await program("admin", t, { program: [] })).status).toBe(403);
    expect((await remove("admin", t)).status).toBe(403);
    expect((await update("nobody", t, { title: "x" })).body).toEqual({ error: EVENT_ERROR.inactive });
  });

  it("a foreign type, another ministry, a malformed token or a missing id is a 404 on every route", async () => {
    const t = token();
    db.docs.set(idOf(t), { _id: idOf(t), _type: "kidsSchedule", _rev: "r", ministry: "jovenes", audience: MINISTRY, published: true });
    const k = token();
    db.docs.set(idOf(k), { _id: idOf(k), _type: "ministryEvent", _rev: "r", ministry: "kids", audience: MINISTRY, published: true });
    for (const id of [t, k, token(), "not-a-token", "ministryEvent.x"]) {
      expect((await updateMinistryEvent("super", "jovenes", id, { _rev: "r", title: "x" })).status).toBe(404);
      expect((await updateMinistryEventProgram("super", "jovenes", id, { _rev: "r", program: [] })).status).toBe(404);
      expect((await deleteMinistryEvent("super", "jovenes", id, { _rev: "r" })).status).toBe(404);
    }
    expect((await createMinistryEvent("super", "kids", { token: token(), audience: MINISTRY, date: "2026-11-14" })).status).toBe(404);
  });

  it("every answer carries no meeting content", async () => {
    const { t, out } = await create("admin", { audience: MINISTRY, title: "Secreto", notes: "Nota" });
    expect(Object.keys(out.body).sort()).toEqual(["id", "ok", "rev"]);
    expect(Object.keys((await update("admin", t, { title: "x" })).body).sort()).toEqual(["id", "ok", "rev"]);
    expect(Object.keys((await program("admin", t, { program: [] })).body).sort()).toEqual(["id", "ok", "rev"]);
  });

  it("without the read token the writer throws instead of answering a misleading 404", async () => {
    vi.stubEnv("SANITY_API_READ_TOKEN", "");
    await expect(createMinistryEvent("admin", "jovenes", { token: token(), audience: MINISTRY, date: "2026-11-14" })).rejects.toBeInstanceOf(MinistryEventReadUnavailable);
  });
});

describe("G4: body validation (W5)", () => {
  it.each([
    [{ audience: { kind: "ministry", groups: ["otro-nivel"] } }, EVENT_ERROR.invalidAudience],
    [{ audience: groups("otro-nivel", "otro-nivel") }, EVENT_ERROR.invalidAudience],
    [{ audience: groups("foo") }, EVENT_ERROR.invalidAudience],
    [{ audience: groups() }, EVENT_ERROR.invalidAudience],
    [{ audience: groups("otro-nivel"), kind: "joint" }, EVENT_ERROR.invalidKind],
    [{ audience: MINISTRY, kind: "group" }, EVENT_ERROR.invalidKind],
    [{ audience: MINISTRY, date: "2026-02-30" }, EVENT_ERROR.invalidDate],
    [{ audience: MINISTRY, time: "25:00" }, EVENT_ERROR.invalidTime],
    [{ audience: MINISTRY, published: "true" }, EVENT_ERROR.invalidPublished],
    [{ audience: MINISTRY, seats: [{ role: "jefe" }] }, EVENT_ERROR.invalidSeats],
    [{ audience: MINISTRY, seats: Array.from({ length: 7 }, () => ({ role: "apoyo" })) }, EVENT_ERROR.invalidSeats],
    [{ audience: MINISTRY, program: [{ label: "" }] }, EVENT_ERROR.invalidProgram],
    [{ audience: MINISTRY, program: [{ _key: "a", label: "x" }, { _key: "a", label: "y" }] }, EVENT_ERROR.duplicateKey],
  ])("%j → %s", async (body, error) => {
    const { out } = await create("admin", body);
    expect([out.status, out.body]).toEqual([400, { error }]);
  });

  it("a whole-ministry meeting defaults to the Saturday; groups derive their kind", async () => {
    expect(stored((await create("admin", { audience: MINISTRY })).t)!.kind).toBe("saturday");
    expect(stored((await create("admin", { audience: MINISTRY, kind: "ministry" })).t)!.kind).toBe("ministry");
    expect(stored((await create("admin", { audience: groups("invencibles") })).t)!.kind).toBe("group");
  });

  it("an added person must be an active Jóvenes member, and of one of the meeting's groups", async () => {
    expect((await create("admin", { audience: MINISTRY, seats: [{ role: "apoyo", member: "worship" }] })).out.body).toEqual({ error: EVENT_ERROR.invalidMember });
    expect((await create("admin", { audience: groups("otro-nivel"), seats: [{ role: "apoyo", member: "pastorEM" }] })).out.body).toEqual({ error: EVENT_ERROR.invalidMember });
    expect((await create("admin", { audience: groups("otro-nivel"), seats: [{ role: "apoyo", member: "pastorON" }] })).out.status).toBe(200);
    expect((await create("admin", { audience: MINISTRY, program: [{ label: "Oración", member: "ghost" }] })).out.body).toEqual({ error: EVENT_ERROR.invalidMember });
  });

  it("every stored person reference is weak", async () => {
    const { t } = await create("admin", {
      audience: MINISTRY,
      seats: [{ role: "encargado", member: "pastorON" }],
      program: [{ label: "Oración", member: "pastorEM", note: "5 min" }],
    });
    const doc = stored(t)! as { seats: { member: unknown; _key: string }[]; program: { member: unknown }[]; createdBy: unknown };
    for (const ref of [doc.seats[0].member, doc.program[0].member, doc.createdBy]) {
      expect(ref).toMatchObject({ _type: "reference", _weak: true });
    }
    expect(doc.seats[0]._key).toMatch(/^[0-9a-f]{12}$/);
  });

  it("a meeting keeping a departed person's seat and program line still saves, with their keys", async () => {
    const { t } = await create("admin", {
      audience: MINISTRY,
      seats: [{ role: "encargado", member: "pastorON" }],
      program: [{ label: "Oración", member: "pastorON" }],
    });
    const before = stored(t)! as { seats: { _key: string }[]; program: { _key: string }[] };
    db.docs.delete("pastorON");
    const seatKey = before.seats[0]._key;
    const lineKey = before.program[0]._key;
    const out = await update("admin", t, {
      title: "Nuevo",
      seats: [{ _key: seatKey, role: "encargado", member: "pastorON" }],
      program: [{ _key: lineKey, label: "Oración larga", member: "pastorON" }, { _key: "client-made", label: "Dinámica" }],
    });
    expect(out.status).toBe(200);
    const after = stored(t)! as { seats: { _key: string }[]; program: { _key: string }[] };
    expect(after.seats[0]._key).toBe(seatKey);
    expect(after.program[0]._key).toBe(lineKey);
    // A key the stored meeting does not hold is never the client's to choose.
    expect(after.program[1]._key).not.toBe("client-made");
    // Changing the departed person's seat role re-validates them, and they are gone.
    const changed = await update("admin", t, { seats: [{ _key: seatKey, role: "apoyo", member: "pastorON" }] });
    expect(changed.body).toEqual({ error: EVENT_ERROR.invalidMember });
  });

  it("null clears an optional field", async () => {
    const { t } = await create("admin", { audience: MINISTRY, title: "Hola", time: "18:10" });
    expect((await update("admin", t, { title: null, time: null })).status).toBe(200);
    expect(stored(t)!.title).toBeUndefined();
    expect(stored(t)!.time).toBeUndefined();
  });
});

describe("G4: the encargado's program (W3a, W4)", () => {
  async function saturday(published: boolean, seats: { role: string; member: string }[]) {
    return eventBy("admin", { audience: MINISTRY, published, seats });
  }

  it("the encargado and the apoyo of a published Saturday write its program, and only its program", async () => {
    const t = await saturday(true, [{ role: "encargado", member: "pastorON" }, { role: "apoyo", member: "pastorEM" }]);
    const out = await program("pastorON", t, { program: [{ label: "Oración", member: "pastorINV" }], title: "Hackeado", published: false });
    expect(out.status).toBe(200);
    expect(stored(t)!.title).toBeUndefined();
    expect(stored(t)!.published).toBe(true);
    expect((await program("pastorEM", t, { program: [{ label: "Dinámica" }] })).status).toBe(200);
  });

  it("the encargado cannot edit anything else of it (403)", async () => {
    const t = await saturday(true, [{ role: "encargado", member: "pastorON" }]);
    expect((await update("pastorON", t, { title: "x" })).status).toBe(403);
  });

  it("removed from Jóvenes, or seated on an unpublished Saturday: 404", async () => {
    const pub = await saturday(true, [{ role: "encargado", member: "pastorON" }]);
    const draft = await saturday(false, [{ role: "encargado", member: "pastorEM" }]);
    expect((await program("pastorEM", draft, { program: [] })).status).toBe(404);
    setPerson("pastorON", { ministries: ["worship"], ministryRoles: [] });
    expect((await program("pastorON", pub, { program: [] })).status).toBe(404);
  });

  it("moved to another group: still allowed on a Saturday", async () => {
    const t = await saturday(true, [{ role: "encargado", member: "pastorON" }]);
    setPerson("pastorON", J("member", ["emprendedores"]));
    expect((await program("pastorON", t, { program: [] })).status).toBe(200);
  });

  it("a seat on a group meeting they read, a «comparte» seat, or no seat: 403", async () => {
    const group = await eventBy("admin", { audience: groups("otro-nivel"), published: true, seats: [{ role: "encargado", member: "pastorON" }] });
    const sat = await saturday(true, [{ role: "comparte", member: "pastorON" }]);
    expect((await program("pastorON", group, { program: [] })).body).toEqual({ error: EVENT_ERROR.programForbidden });
    expect((await program("pastorON", sat, { program: [] })).status).toBe(403);
    expect((await program("pastorEM", sat, { program: [] })).status).toBe(403);
  });

  it("a stale revision on the program is a 409", async () => {
    const t = await saturday(true, [{ role: "encargado", member: "pastorON" }]);
    const out = await updateMinistryEventProgram("pastorON", "jovenes", t, { _rev: "old", program: [] });
    expect([out.status, out.body]).toEqual([409, { error: EVENT_ERROR.stale }]);
  });
});

describe("place and typed seat names (plan 2026-11-10, P1–P2)", () => {
  it("stores a trimmed place on create, leaves a blank one out, and refuses a long or multi-line one", async () => {
    expect(stored((await create("admin", { audience: MINISTRY, place: "  Oasis Tlalpan " })).t)!.place).toBe("Oasis Tlalpan");
    expect(stored((await create("admin", { audience: MINISTRY, place: "   " })).t)!).not.toHaveProperty("place");
    for (const place of ["x".repeat(121), "Oasis\nTlalpan", "Oasis Tlalpan", 7]) {
      const { out } = await create("admin", { audience: MINISTRY, place });
      expect([out.status, out.body]).toEqual([400, { error: EVENT_ERROR.invalidPlace }]);
    }
  });

  it("a PATCH sets the place, null unsets it, and absent leaves it", async () => {
    const { t } = await create("admin", { audience: MINISTRY });
    expect((await update("admin", t, { place: "Casa Fam Varela" })).status).toBe(200);
    expect(stored(t)!.place).toBe("Casa Fam Varela");
    expect((await update("admin", t, { title: "Posada" })).status).toBe(200);
    expect(stored(t)!.place).toBe("Casa Fam Varela");
    expect((await update("admin", t, { place: null })).status).toBe(200);
    expect(stored(t)!).not.toHaveProperty("place");
  });

  it("the program route never touches the place", async () => {
    const t = await eventBy("admin", { audience: MINISTRY, published: true, place: "Oasis Tlalpan", seats: [{ role: "encargado", member: "pastorON" }] });
    expect((await program("pastorON", t, { program: [], place: "Otro" })).status).toBe(200);
    expect(stored(t)!.place).toBe("Oasis Tlalpan");
  });

  it("a seat stores a typed name as text, with no member and no validation against the members", async () => {
    // «worship» is a real person who is NOT in Jóvenes: as a member it is refused, as text it is just text.
    const { t, out } = await create("admin", {
      audience: MINISTRY,
      seats: [{ role: "encargado", name: " Emprendedores " }, { role: "comparte", name: "worship" }],
    });
    expect(out.status).toBe(200);
    const seats = stored(t)!.seats as Record<string, unknown>[];
    expect(seats.map((s) => [s.role, s.name, s.member])).toEqual([
      ["encargado", "Emprendedores", undefined],
      ["comparte", "worship", undefined],
    ]);
  });

  it.each([
    [{ role: "comparte", member: "pastorON", name: "Ana" }],
    [{ role: "comparte", name: "x".repeat(61) }],
    [{ role: "comparte", name: "Ana\nMaría" }],
    [{ role: "comparte", name: 3 }],
  ])("refuses the seat %j", async (seat) => {
    const { out } = await create("admin", { audience: MINISTRY, seats: [seat] });
    expect([out.status, out.body]).toEqual([400, { error: EVENT_ERROR.invalidSeats }]);
  });

  it("a PATCH turns a member seat into a typed name and back; the member is validated only when added", async () => {
    const { t } = await create("admin", { audience: MINISTRY, seats: [{ role: "comparte", member: "pastorON" }] });
    const key = (stored(t)!.seats as { _key: string }[])[0]._key;
    expect((await update("admin", t, { seats: [{ _key: key, role: "comparte", name: "Ana" }] })).status).toBe(200);
    expect((stored(t)!.seats as Record<string, unknown>[])[0]).toMatchObject({ _key: key, name: "Ana" });
    expect((stored(t)!.seats as Record<string, unknown>[])[0]).not.toHaveProperty("member");
    expect((await update("admin", t, { seats: [{ _key: key, role: "comparte", member: "worship" }] })).body).toEqual({ error: EVENT_ERROR.invalidMember });
  });

  it("a typed name that reads like a pastor's id grants no program right", async () => {
    const t = await eventBy("admin", { audience: MINISTRY, published: true, seats: [{ role: "encargado", name: "pastorON" }] });
    expect((await program("pastorON", t, { program: [] })).body).toEqual({ error: EVENT_ERROR.programForbidden });
  });
});

// ── Per-group leadership (plan 2026-11-11-jovenes-per-group-leadership §5.2, §5.3) ──────────────

describe("G4: per-group leadership — leads A, only IN B", () => {
  it("cannot create a meeting of B alone, nor a joint one of B and C", async () => {
    expect((await create("jacob", { audience: groups("invencibles") })).out.status).toBe(403);
    expect((await create("jacob", { audience: groups("invencibles", "emprendedores") })).out.status).toBe(403);
    expect((await create("jacob", { audience: groups("otro-nivel") })).out.status).toBe(200);
  });

  it("B's meeting: 404 on every write while a draft (cannot read it), 403 once published", async () => {
    const draft = await eventBy("andy", { audience: groups("invencibles") });
    const pub = await eventBy("andy", { audience: groups("invencibles"), published: true });
    for (const out of [await update("jacob", draft, { title: "x" }), await update("jacob", draft, { published: true }), await remove("jacob", draft)]) {
      expect(out.status).toBe(404);
    }
    for (const out of [await update("jacob", pub, { title: "x" }), await update("jacob", pub, { published: false }), await remove("jacob", pub)]) {
      expect(out.status).toBe(403);
    }
    expect(stored(draft)).toBeDefined();
    expect(stored(pub)!.published).toBe(true);
  });

  it("a joint A+B meeting they created: they edit, publish and delete it (§5.3: one led group suffices)", async () => {
    const t = await eventBy("jacob", { audience: groups("otro-nivel", "invencibles") });
    expect((await update("jacob", t, { title: "Junta" })).status).toBe(200);
    expect((await update("jacob", t, { published: true })).status).toBe(200);
    expect((await remove("jacob", t)).status).toBe(200);
  });

  it("a joint A+B meeting someone else created: they read the draft but answer 403", async () => {
    const t = await eventBy("andy", { audience: groups("invencibles", "otro-nivel") });
    expect((await update("jacob", t, { title: "x" })).status).toBe(403);
    expect((await remove("jacob", t)).status).toBe(403);
  });

  it("a stored joint B+C meeting: never theirs, even as its creator (they lead none of its groups)", async () => {
    const draft = await eventBy("admin", { audience: groups("invencibles", "emprendedores") });
    const pub = await eventBy("admin", { audience: groups("invencibles", "emprendedores"), published: true });
    for (const t of [draft, pub]) {
      db.docs.set(idOf(t), { ...stored(t)!, createdBy: { _type: "reference", _ref: "jacob", _weak: true } });
    }
    expect((await update("jacob", draft, { title: "x" })).status).toBe(404);
    expect((await update("jacob", pub, { title: "x" })).status).toBe(403);
  });

  it("cannot move their group's meeting to B alone, nor to B+C", async () => {
    const t = await eventBy("jacob", { audience: groups("otro-nivel") });
    expect((await update("jacob", t, { audience: groups("invencibles") })).status).toBe(403);
    expect((await update("jacob", t, { audience: groups("invencibles", "emprendedores") })).status).toBe(403);
    expect(stored(t)!.audience).toEqual(groups("otro-nivel"));
  });

  it("A's meeting, not its creator: may widen it to A+B once; afterwards it is its creator's", async () => {
    const t = await eventBy("leaderON", { audience: groups("otro-nivel") });
    expect((await update("jacob", t, { audience: groups("otro-nivel", "invencibles") })).status).toBe(200);
    expect((await update("jacob", t, { title: "y" })).status).toBe(403);
    expect((await update("leaderON", t, { title: "y" })).status).toBe(200);
  });

  it("a whole-ministry meeting: 403 to create or edit", async () => {
    expect((await create("jacob", { audience: MINISTRY })).out.status).toBe(403);
    const t = await eventBy("admin", { audience: MINISTRY, published: true });
    expect((await update("jacob", t, { title: "x" })).status).toBe(403);
  });
});

describe("G4: a `leader` who leads no group is a member", () => {
  it("empty or unusable leaderOf: 403 to create, 404 on a draft of their group, 403 on its published meeting", async () => {
    const draft = await eventBy("leaderON", { audience: groups("otro-nivel") });
    const pub = await eventBy("leaderON", { audience: groups("otro-nivel"), published: true });
    for (const leaderOf of [[], "otro-nivel", ["emprendedores"]]) {
      setPerson("leadsNone", JL(["otro-nivel"], leaderOf));
      expect((await create("leadsNone", { audience: groups("otro-nivel") })).out.status).toBe(403);
      expect((await update("leadsNone", draft, { title: "x" })).status).toBe(404);
      expect((await update("leadsNone", pub, { title: "x" })).status).toBe(403);
    }
  });

  it("a legacy leader (no leaderOf, or null) leads nothing — L2, ADR-0085", async () => {
    const draft = await eventBy("leaderON", { audience: groups("otro-nivel") });
    for (const leaderOf of [undefined, null]) {
      setPerson("leadsNone", JL(["otro-nivel"], leaderOf));
      expect((await create("leadsNone", { audience: groups("otro-nivel") })).out.status).toBe(403);
      expect((await update("leadsNone", draft, { title: "x" })).status).toBe(404);
    }
  });
});

describe("G4: per-group demotion of a joint meeting's creator (W1's fresh read)", () => {
  it("keeps it while they still lead one of its groups; loses it once they lead none", async () => {
    setPerson("jacob", JL(["otro-nivel", "invencibles", "emprendedores"], ["otro-nivel", "emprendedores"]));
    const pub = await eventBy("jacob", { audience: groups("otro-nivel", "emprendedores"), published: true });
    const draft = await eventBy("jacob", { audience: groups("otro-nivel", "emprendedores") });
    setPerson("jacob", JL(["otro-nivel", "invencibles", "emprendedores"], ["emprendedores"]));
    expect((await update("jacob", pub, { title: "x" })).status).toBe(200);
    expect((await update("jacob", draft, { title: "x" })).status).toBe(200);
    setPerson("jacob", JL(["otro-nivel", "invencibles", "emprendedores"], ["invencibles"]));
    expect((await update("jacob", pub, { title: "y" })).status).toBe(403);
    expect((await update("jacob", draft, { title: "y" })).status).toBe(404);
  });
});
