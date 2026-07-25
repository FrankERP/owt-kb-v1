// The guarded live-setlist writer (Service Readiness A2 §5) at the route level.
//
// The Sanity clients are fully mocked — no network, no dataset. Reads are served
// by a tiny in-memory store dispatched off the bound GROQ, and every transaction
// is recorded as an operation list (and applied to the store on a successful
// commit), so each test asserts exactly what would have been committed — and that
// a rejected save commits NOTHING.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

// operationalClient is `import "server-only"` guarded; neutralize the marker so
// the route module loads under vitest's node environment.
vi.mock("server-only", () => ({}));

const requireActiveManagerMock = vi.fn();
const operationalFetch = vi.fn();
const rawFetch = vi.fn();
const sendPushMock = vi.fn();
const revalidateServiceViewsMock = vi.fn();

vi.mock("@/app/utils/authGuards", () => ({
  requireActiveManager: () => requireActiveManagerMock(),
  requireActiveSession: vi.fn(),
}));

vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: (...a: unknown[]) => operationalFetch(...a) },
  rawIntegrityClient: { fetch: (...a: unknown[]) => rawFetch(...a) },
}));

vi.mock("@/sanity/lib/serverClient", () => ({
  serverClient: { fetch: vi.fn() },
  writeClient: { transaction: () => makeTransaction() },
}));

vi.mock("@/app/utils/revalidate", () => ({
  revalidateServiceViews: (...a: unknown[]) => revalidateServiceViewsMock(...a),
}));
vi.mock("@/app/utils/push", () => ({ sendPush: (...a: unknown[]) => sendPushMock(...a) }));

import { PUT } from "@/app/api/admin/setlists/route";

// ── Transaction recorder ────────────────────────────────────────────────────

interface PatchOp {
  kind: "patch";
  id: string;
  rev: string | null;
  set: Record<string, unknown>;
  unset: string[];
}
type TxOp =
  | PatchOp
  | { kind: "create"; doc: Record<string, unknown> }
  | { kind: "delete"; id: string };

interface RecordedTx {
  ops: TxOp[];
  committed: boolean;
}

const transactions: RecordedTx[] = [];
/** Per-commit outcomes, consumed in order. `undefined` = resolve. */
const commitOutcomes: (Error | undefined)[] = [];

function conflictError(type = "documentRevisionIDDoesNotMatchError") {
  return Object.assign(new Error("conflict"), {
    statusCode: 409,
    details: { type: "mutationError", items: [{ error: { type } }] },
  });
}

function makeTransaction() {
  const record: RecordedTx = { ops: [], committed: false };
  transactions.push(record);
  const tx = {
    create(doc: Record<string, unknown>) {
      record.ops.push({ kind: "create", doc });
      return tx;
    },
    delete(id: string) {
      record.ops.push({ kind: "delete", id });
      return tx;
    },
    patch(id: string, fn: (p: unknown) => unknown) {
      const op: PatchOp = { kind: "patch", id, rev: null, set: {}, unset: [] };
      const p = {
        ifRevisionId(rev: string) { op.rev = rev; return p; },
        set(values: Record<string, unknown>) { Object.assign(op.set, values); return p; },
        unset(fields: string[]) { op.unset.push(...fields); return p; },
        inc() { return p; },
      };
      fn(p);
      record.ops.push(op);
      return tx;
    },
    async commit() {
      const outcome = commitOutcomes.shift();
      if (outcome) throw outcome;
      record.committed = true;
      applyToStore(record);
      return { transactionId: "t1" };
    },
  };
  return tx;
}

function committedTransactions() {
  return transactions.filter((t) => t.committed);
}

function patches(tx: RecordedTx): PatchOp[] {
  return tx.ops.filter((o): o is PatchOp => o.kind === "patch");
}

function creates(tx: RecordedTx): Record<string, unknown>[] {
  return tx.ops.filter((o): o is { kind: "create"; doc: Record<string, unknown> } => o.kind === "create")
    .map((o) => o.doc);
}

// ── In-memory store, dispatched off the bound GROQ ──────────────────────────

interface Store {
  roles: Record<string, unknown>[];
  setlists: Record<string, unknown>[];
  locks: Record<string, unknown>[];
  members: Record<string, unknown>[];
  rawRoleDrafts: Record<string, unknown>[];
  rawSetlistDrafts: Record<string, unknown>[];
  assigned: string[];
}

let store: Store;

function emptyStore(): Store {
  return {
    roles: [],
    setlists: [],
    locks: [],
    members: [],
    rawRoleDrafts: [],
    rawSetlistDrafts: [],
    assigned: [],
  };
}

function collectionFor(type: unknown): Record<string, unknown>[] {
  if (type === "roleTargetLock") return store.locks;
  if (type === "featuredSongs" || type === "saturdarSongs") return store.setlists;
  return store.roles;
}

/** Apply a committed transaction, so a follow-up read sees the new state. */
function applyToStore(record: RecordedTx) {
  for (const op of record.ops) {
    if (op.kind === "create") {
      collectionFor(op.doc._type).push({ ...op.doc, _rev: `${String(op.doc._id)}-rev1` });
      continue;
    }
    if (op.kind === "delete") {
      for (const list of [store.roles, store.setlists, store.locks]) {
        const at = list.findIndex((d) => d._id === op.id);
        if (at >= 0) list.splice(at, 1);
      }
      continue;
    }
    const doc = [...store.roles, ...store.setlists, ...store.locks].find((d) => d._id === op.id);
    if (!doc) continue;
    Object.assign(doc, op.set);
    for (const field of op.unset) delete doc[field];
    doc._rev = `${String(doc._rev)}+`;
  }
}

function canonicalRead(query: string, params: Record<string, unknown>): unknown {
  if (query.includes("roleTargetLock")) {
    return store.locks.filter((l) => (params.ids as string[]).includes(l._id as string));
  }
  if (query.includes("array::unique")) return store.assigned;
  if (query.includes("teamMembers")) return store.members;
  if (query.includes("$setlistType") && query.includes("week == $week")) {
    return store.setlists.filter((s) => s._type === params.setlistType && s.week === params.week);
  }
  if (query.includes("$roleType") && query.includes("week == $week")) {
    return store.roles.filter((r) => r._type === params.roleType && r.week === params.week);
  }
  if (query.includes("_id == $id")) return store.roles.filter((r) => r._id === params.id);
  throw new Error(`unmocked canonical query: ${query}`);
}

function rawRead(query: string, params: Record<string, unknown>): unknown[] {
  if (query.includes("$draftId")) {
    return store.rawRoleDrafts.filter((d) => d._id === params.draftId);
  }
  if (query.includes("$setlistType")) {
    return store.rawSetlistDrafts.filter(
      (d) => d._type === params.setlistType && d.week === params.week,
    );
  }
  if (query.includes("$roleType")) {
    return store.rawRoleDrafts.filter((d) => d._type === params.roleType && d.week === params.week);
  }
  throw new Error(`unmocked raw query: ${query}`);
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const ADMIN = { user: { role: "admin", sanityId: "admin-1" } };
const WEEK = "2026-08-09";

function ref(key: string, id: string) {
  return { _key: key, _type: "reference", _ref: id };
}

function sundayRole(over: Record<string, unknown> = {}) {
  return {
    _id: "role-1",
    _rev: "role-rev-1",
    _type: "sunday_role",
    week: WEEK,
    published: true,
    Lead: [ref("a1", "mem-1")],
    BGVs: [],
    Chorus: [],
    instruments: [],
    foh_team: [],
    ...over,
  };
}

function specialRole(over: Record<string, unknown> = {}) {
  return {
    _id: "role-sp",
    _rev: "role-rev-sp",
    _type: "special_role",
    date: "2026-08-20",
    service_name: "Bautizos",
    published: true,
    Lead: [ref("c1", "mem-1")],
    BGVs: [],
    Chorus: [],
    instruments: [],
    foh_team: [],
    ...over,
  };
}

function lock(over: Record<string, unknown> = {}) {
  return {
    _id: `roleTarget.sunday_role.${WEEK}`,
    _rev: "lock-rev-1",
    _type: "roleTargetLock",
    targetKey: `sunday_role:${WEEK}`,
    state: "claimed",
    roleId: "role-1",
    roleType: "sunday_role",
    date: WEEK,
    claimNonce: "n1",
    generation: 1,
    ...over,
  };
}

function setlist(over: Record<string, unknown> = {}) {
  return {
    _id: `featuredSongs.${WEEK}`,
    _rev: "set-rev-1",
    _type: "featuredSongs",
    week: WEEK,
    songs: [{ _key: "s1", play_key: "G", song: { _type: "reference", _ref: "song-1" } }],
    ...over,
  };
}

function req(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function body(over: Record<string, unknown> = {}) {
  return {
    type: "sunday",
    week: WEEK,
    observed: { state: "none" },
    songs: [{ songId: "song-1", play_key: "G" }],
    ...over,
  };
}

function seedWeekendService() {
  store.roles.push(sundayRole());
  store.locks.push(lock());
  store.members.push({ _id: "mem-1" }, { _id: "mem-2", setlist: "assigned" });
  store.assigned = ["mem-1"];
}

beforeEach(() => {
  vi.clearAllMocks();
  transactions.length = 0;
  commitOutcomes.length = 0;
  store = emptyStore();
  requireActiveManagerMock.mockResolvedValue(ADMIN);
  operationalFetch.mockImplementation(async (q: string, p: Record<string, unknown> = {}) =>
    canonicalRead(q, p),
  );
  rawFetch.mockImplementation(async (q: string, p: Record<string, unknown> = {}) => rawRead(q, p));
});

// ── Authorization and prevalidation ─────────────────────────────────────────

describe("PUT /api/admin/setlists — authorization and prevalidation", () => {
  it("denies a non-manager and a content-editor without reading anything", async () => {
    requireActiveManagerMock.mockResolvedValueOnce(null);
    expect((await PUT(req(body()))).status).toBe(403);
    requireActiveManagerMock.mockResolvedValueOnce({ user: { role: "content-editor" } });
    expect((await PUT(req(body()))).status).toBe(403);
    expect(operationalFetch).not.toHaveBeenCalled();
    expect(transactions).toHaveLength(0);
  });

  it.each([
    ["no observed state (a blind overwrite is not expressible)", { observed: undefined }],
    ["an observed none carrying an id", { observed: { state: "none", id: "x" } }],
    ["an unknown service kind", { type: "midweek" }],
    ["a malformed week", { week: "09-08-2026" }],
    ["a special save with no roleId", { type: "special", roleId: undefined }],
    ["a malformed song row", { songs: [{ play_key: "G" }] }],
  ])("rejects %s with 400 before any read or write", async (_label, over) => {
    const res = await PUT(req(body(over)));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_request");
    expect(operationalFetch).not.toHaveBeenCalled();
    expect(transactions).toHaveLength(0);
  });
});

// ── Observed none: deterministic creation ───────────────────────────────────

describe("PUT /api/admin/setlists — observed none", () => {
  it("creates at the deterministic id and heartbeats the owned lock in ONE transaction", async () => {
    seedWeekendService();
    const res = await PUT(req(body()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      created: true,
      setlistId: `featuredSongs.${WEEK}`,
    });
    expect(committedTransactions()).toHaveLength(1);
    const tx = committedTransactions()[0];
    expect(creates(tx)).toEqual([
      {
        _id: `featuredSongs.${WEEK}`,
        _type: "featuredSongs",
        week: WEEK,
        songs: [
          {
            _type: "setlist_song",
            _key: expect.any(String),
            play_key: "G",
            song: { _type: "reference", _ref: "song-1" },
          },
        ],
      },
    ]);
    // The weekend target lock is asserted in the SAME transaction.
    expect(patches(tx)).toEqual([
      {
        kind: "patch",
        id: `roleTarget.sunday_role.${WEEK}`,
        rev: "lock-rev-1",
        set: { updatedAt: expect.any(String) },
        unset: [],
      },
    ]);
    expect(revalidateServiceViewsMock).toHaveBeenCalled();
    // The existing setlist audience is preserved: "all" members plus assigned
    // "assigned"-preference members, derived from committed server state.
    expect(sendPushMock).toHaveBeenCalledWith(["mem-1"], "setlist", expect.anything());
  });

  it("creates the Saturday setlist at the deliberate saturdarSongs id", async () => {
    store.roles.push(sundayRole({ _id: "role-sat", _type: "saturday_role", week: "2026-08-08" }));
    store.locks.push(
      lock({
        _id: "roleTarget.saturday_role.2026-08-08",
        targetKey: "saturday_role:2026-08-08",
        roleType: "saturday_role",
        roleId: "role-sat",
        date: "2026-08-08",
      }),
    );
    const res = await PUT(req(body({ type: "saturday", week: "2026-08-08" })));
    expect(res.status).toBe(200);
    expect(creates(committedTransactions()[0])[0]).toMatchObject({
      _id: "saturdarSongs.2026-08-08",
      _type: "saturdarSongs",
    });
  });

  it("refuses when a setlist already exists (someone created it first)", async () => {
    seedWeekendService();
    store.setlists.push(setlist());
    const res = await PUT(req(body()));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: "stale_revision",
      conflict: true,
      details: { detail: "concurrent_creation" },
    });
    expect(transactions).toHaveLength(0);
  });

  it("reports a losing deterministic create as a 409 with nothing committed", async () => {
    seedWeekendService();
    commitOutcomes.push(conflictError("documentAlreadyExistsError"));
    const res = await PUT(req(body()));
    expect(res.status).toBe(409);
    expect((await res.json()).details).toMatchObject({ detail: "concurrent_creation" });
    expect(committedTransactions()).toHaveLength(0);
  });

  it("saves a weekend setlist for a week with no service role (no token to assert)", async () => {
    const res = await PUT(req(body()));
    expect(res.status).toBe(200);
    const tx = committedTransactions()[0];
    expect(creates(tx)).toHaveLength(1);
    expect(patches(tx)).toHaveLength(0);
  });
});

// ── Observed singleton ──────────────────────────────────────────────────────

describe("PUT /api/admin/setlists — observed singleton", () => {
  it("patches the observed document under its observed revision, never sending _type", async () => {
    seedWeekendService();
    store.setlists.push(setlist());
    const res = await PUT(
      req(body({ observed: { state: "single", id: `featuredSongs.${WEEK}`, rev: "set-rev-1" } })),
    );
    expect(res.status).toBe(200);
    const ops = patches(committedTransactions()[0]);
    expect(ops[0]).toMatchObject({ id: `featuredSongs.${WEEK}`, rev: "set-rev-1" });
    expect(Object.keys(ops[0].set)).toEqual(["songs"]);
    expect(ops[1]).toMatchObject({ id: `roleTarget.sunday_role.${WEEK}`, rev: "lock-rev-1" });
  });

  it("refuses a stale observed revision with no mutation", async () => {
    seedWeekendService();
    store.setlists.push(setlist());
    const res = await PUT(
      req(body({ observed: { state: "single", id: `featuredSongs.${WEEK}`, rev: "set-rev-OLD" } })),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).details).toMatchObject({ detail: "revision_mismatch" });
    expect(transactions).toHaveLength(0);
  });

  it("refuses an observed identity that is not the canonical singleton", async () => {
    seedWeekendService();
    store.setlists.push(setlist({ _id: "legacy-setlist" }));
    const res = await PUT(
      req(body({ observed: { state: "single", id: `featuredSongs.${WEEK}`, rev: "set-rev-1" } })),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).details).toMatchObject({ detail: "identity_mismatch" });
    expect(transactions).toHaveLength(0);
  });

  it("refuses when the observed setlist has vanished", async () => {
    seedWeekendService();
    const res = await PUT(
      req(body({ observed: { state: "single", id: `featuredSongs.${WEEK}`, rev: "set-rev-1" } })),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).details).toMatchObject({ detail: "target_vanished" });
    expect(transactions).toHaveLength(0);
  });

  it("reports a revision that moved between the read and the commit", async () => {
    seedWeekendService();
    store.setlists.push(setlist());
    commitOutcomes.push(conflictError());
    const res = await PUT(
      req(body({ observed: { state: "single", id: `featuredSongs.${WEEK}`, rev: "set-rev-1" } })),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).details).toMatchObject({ detail: "revision_moved" });
    expect(committedTransactions()).toHaveLength(0);
    expect(revalidateServiceViewsMock).not.toHaveBeenCalled();
    expect(sendPushMock).not.toHaveBeenCalled();
  });
});

// ── Ambiguous / draft / invalid targets ─────────────────────────────────────

describe("PUT /api/admin/setlists — refused targets", () => {
  it("refuses a duplicate setlist group", async () => {
    seedWeekendService();
    store.setlists.push(setlist(), setlist({ _id: "dup-setlist", _rev: "set-rev-2" }));
    const res = await PUT(req(body()));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "ambiguous_target" });
    expect(transactions).toHaveLength(0);
  });

  it("refuses a raw draft overlay of the setlist target", async () => {
    seedWeekendService();
    store.rawSetlistDrafts.push({ _id: `drafts.featuredSongs.${WEEK}`, _type: "featuredSongs", week: WEEK });
    const res = await PUT(req(body()));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: "integrity_conflict",
      details: { detail: "setlist_draft_conflict" },
    });
    expect(transactions).toHaveLength(0);
  });

  it("refuses a duplicate service-role group at the weekend target", async () => {
    seedWeekendService();
    store.roles.push(sundayRole({ _id: "role-dup", _rev: "role-rev-2" }));
    const res = await PUT(req(body()));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "ambiguous_target" });
    expect(transactions).toHaveLength(0);
  });

  it("refuses a raw draft overlay of the service role", async () => {
    seedWeekendService();
    store.rawRoleDrafts.push({ _id: "drafts.role-1", _type: "sunday_role", week: WEEK });
    const res = await PUT(req(body()));
    expect(res.status).toBe(409);
    expect((await res.json()).details).toMatchObject({ detail: "role_draft_conflict" });
    expect(transactions).toHaveLength(0);
  });

  it("refuses a lock claimed by another role instead of repairing it", async () => {
    seedWeekendService();
    store.locks[0].roleId = "role-other";
    const res = await PUT(req(body()));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: "integrity_conflict",
      details: { detail: "lock_wrong_owner" },
    });
    expect(transactions).toHaveLength(0);
  });
});

// ── Legacy lock bootstrap ───────────────────────────────────────────────────

describe("PUT /api/admin/setlists — legacy weekend lock", () => {
  it("bootstraps the missing lock, then saves in a second guarded transaction", async () => {
    store.roles.push(sundayRole());
    const res = await PUT(req(body()));
    expect(res.status).toBe(200);
    expect(committedTransactions()).toHaveLength(2);
    // 1) maintenance: heartbeat the unchanged target field + create the claimed lock
    const boot = committedTransactions()[0];
    expect(patches(boot)).toEqual([
      { kind: "patch", id: "role-1", rev: "role-rev-1", set: { week: WEEK }, unset: [] },
    ]);
    expect(creates(boot)[0]).toMatchObject({
      _id: `roleTarget.sunday_role.${WEEK}`,
      _type: "roleTargetLock",
      state: "claimed",
      roleId: "role-1",
    });
    // 2) business: the setlist create plus the freshly produced lock revision
    const business = committedTransactions()[1];
    expect(creates(business)[0]).toMatchObject({ _id: `featuredSongs.${WEEK}` });
    expect(patches(business)[0]).toMatchObject({
      id: `roleTarget.sunday_role.${WEEK}`,
      rev: `roleTarget.sunday_role.${WEEK}-rev1`,
    });
  });

  it("reports bootstrap_completed_reload when the business commit then conflicts", async () => {
    store.roles.push(sundayRole());
    commitOutcomes.push(undefined, conflictError());
    const res = await PUT(req(body()));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "bootstrap_completed_reload" });
    // Only the documented maintenance state persisted.
    expect(committedTransactions()).toHaveLength(1);
    expect(revalidateServiceViewsMock).not.toHaveBeenCalled();
  });
});

// ── Special services ────────────────────────────────────────────────────────

describe("PUT /api/admin/setlists — special service", () => {
  const specialBody = (over: Record<string, unknown> = {}) =>
    body({ type: "special", week: "2026-08-20", roleId: "role-sp", ...over });

  it("patches the role's songs guarded by the role revision, with no weekend lock", async () => {
    store.roles.push(specialRole());
    const res = await PUT(req(specialBody()));
    expect(res.status).toBe(200);
    const tx = committedTransactions()[0];
    expect(creates(tx)).toHaveLength(0);
    expect(patches(tx)).toEqual([
      {
        kind: "patch",
        id: "role-sp",
        rev: "role-rev-sp",
        set: { songs: [expect.objectContaining({ _type: "setlist_song" })] },
        unset: [],
      },
    ]);
  });

  it("requires the observed songs state to match (an existing setlist is a singleton)", async () => {
    store.roles.push(specialRole({ songs: [] }));
    const res = await PUT(req(specialBody()));
    expect(res.status).toBe(409);
    expect((await res.json()).details).toMatchObject({ detail: "concurrent_creation" });
    expect(transactions).toHaveLength(0);
  });

  it("accepts the observed singleton for a role that already stores songs", async () => {
    store.roles.push(specialRole({ songs: [] }));
    const res = await PUT(
      req(specialBody({ observed: { state: "single", id: "role-sp", rev: "role-rev-sp" } })),
    );
    expect(res.status).toBe(200);
    expect(patches(committedTransactions()[0])[0]).toMatchObject({ id: "role-sp", rev: "role-rev-sp" });
  });

  it("rejects a roleId that is not a special_role, and a date mismatch", async () => {
    store.roles.push(sundayRole());
    expect((await PUT(req(specialBody({ roleId: "role-1" })))).status).toBe(400);
    store.roles.push(specialRole());
    expect((await PUT(req(specialBody({ week: "2026-08-21" })))).status).toBe(400);
    expect(transactions).toHaveLength(0);
  });

  it("404s an unresolved special role and refuses a draft-overlaid one", async () => {
    expect((await PUT(req(specialBody()))).status).toBe(404);
    store.roles.push(specialRole());
    store.rawRoleDrafts.push({ _id: "drafts.role-sp", _type: "special_role" });
    expect((await PUT(req(specialBody()))).status).toBe(409);
    expect(transactions).toHaveLength(0);
  });
});
