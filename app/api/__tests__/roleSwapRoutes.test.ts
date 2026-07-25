// Atomic swap and copy-instruments writers (Service Readiness A2 §4) at the
// route level.
//
// The Sanity clients are fully mocked — no network, no dataset. Reads are served
// by a tiny in-memory store dispatched off the bound GROQ, and every transaction
// is recorded as an operation list, so each test asserts exactly what would have
// been committed (and that a rejected request commits NOTHING).

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

// operationalClient is `import "server-only"` guarded; neutralize the marker so
// the route modules load under vitest's node environment.
vi.mock("server-only", () => ({}));

const requireActiveManagerMock = vi.fn();
const operationalFetch = vi.fn();
const rawFetch = vi.fn();
const sendPushMock = vi.fn();
const sendAssignmentEmailsMock = vi.fn();
const revalidateServiceViewsMock = vi.fn();
const revalidatePathMock = vi.fn();
const afterCallbacks: (() => unknown)[] = [];

vi.mock("@/app/utils/authGuards", () => ({
  requireActiveManager: () => requireActiveManagerMock(),
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
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePathMock(...a) }));
vi.mock("@/app/utils/push", () => ({ sendPush: (...a: unknown[]) => sendPushMock(...a) }));
vi.mock("@/app/utils/assignmentEmail", () => ({
  sendAssignmentEmails: (...a: unknown[]) => sendAssignmentEmailsMock(...a),
  sendAssignmentEmailsBatch: vi.fn(),
  assigneesOf: () => [],
}));
vi.mock("next/server", async (importOriginal) => {
  const mod = await importOriginal<typeof import("next/server")>();
  return { ...mod, after: (fn: () => unknown) => void afterCallbacks.push(fn) };
});

import { POST as swapPOST } from "@/app/api/admin/roles/swap/route";
import { POST as copyPOST } from "@/app/api/admin/roles/copy-instruments/route";

// ── Transaction recorder ────────────────────────────────────────────────────

interface PatchOp {
  kind: "patch";
  id: string;
  rev: string | null;
  set: Record<string, unknown>;
  unset: string[];
}
type TxOp = PatchOp | { kind: "create"; doc: Record<string, unknown> } | { kind: "delete"; id: string };

interface RecordedTx {
  ops: TxOp[];
  committed: boolean;
}

const transactions: RecordedTx[] = [];
/** Per-commit outcomes, consumed in order. `undefined` = resolve. */
const commitOutcomes: (Error | undefined)[] = [];

function conflictError(type = "documentRevisionIDDoesNotMatchError", id = "doc") {
  return Object.assign(new Error("conflict"), {
    statusCode: 409,
    details: { type: "mutationError", items: [{ error: { type, id } }] },
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
        ifRevisionId(rev: string) {
          op.rev = rev;
          return p;
        },
        set(values: Record<string, unknown>) {
          Object.assign(op.set, values);
          return p;
        },
        unset(fields: string[]) {
          op.unset.push(...fields);
          return p;
        },
        inc() {
          return p;
        },
      };
      fn(p);
      record.ops.push(op);
      return tx;
    },
    async commit() {
      const outcome = commitOutcomes.shift();
      if (outcome) throw outcome;
      record.committed = true;
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

// ── In-memory store, dispatched off the bound GROQ ──────────────────────────

interface Store {
  roles: Record<string, unknown>[];
  locks: Record<string, unknown>[];
  members: Record<string, unknown>[];
  rawRoleDrafts: Record<string, unknown>[];
}

let store: Store;

function emptyStore(): Store {
  return { roles: [], locks: [], members: [], rawRoleDrafts: [] };
}

function canonicalRead(query: string, params: Record<string, unknown>): unknown[] {
  if (query.includes("roleTargetLock")) {
    return store.locks.filter((l) => (params.ids as string[]).includes(l._id as string));
  }
  if (query.includes("teamMembers")) {
    return store.members.filter((m) => (params.ids as string[]).includes(m._id as string));
  }
  if (query.includes("_id == $id")) return store.roles.filter((r) => r._id === params.id);
  throw new Error(`unmocked canonical query: ${query}`);
}

function rawRead(query: string, params: Record<string, unknown>): unknown[] {
  if (query.includes("_id == $draftId")) {
    return store.rawRoleDrafts.filter((d) => d._id === params.draftId);
  }
  throw new Error(`unmocked raw query: ${query}`);
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const ADMIN = { user: { role: "admin" } };

function ref(key: string, id: string) {
  return { _key: key, _type: "reference", _ref: id };
}
function instrumentSlot(key: string, instrument: string, id: string) {
  return { _key: key, _type: "instrument_slot", instrument, person: { _type: "reference", _ref: id } };
}
function fohSlot(key: string, role: string, id: string) {
  return { _key: key, _type: "foh_slot", role, person: { _type: "reference", _ref: id } };
}

function role(over: Record<string, unknown> = {}) {
  return {
    _id: "role-1",
    _rev: "rev-1",
    _type: "sunday_role",
    week: "2026-08-09",
    published: true,
    Lead: [ref("a1", "mem-1")],
    BGVs: [ref("a2", "mem-2")],
    Chorus: [],
    instruments: [instrumentSlot("ai", "Bajo", "mem-3")],
    foh_team: [fohSlot("af", "Audio", "mem-4")],
    ...over,
  };
}

function otherRole(over: Record<string, unknown> = {}) {
  return role({
    _id: "role-2",
    _rev: "rev-2",
    week: "2026-08-16",
    Lead: [ref("b1", "mem-5")],
    BGVs: [],
    Chorus: [ref("b3", "mem-6")],
    instruments: [instrumentSlot("bi", "Teclado", "mem-7")],
    foh_team: [fohSlot("bf", "Video", "mem-8")],
    ...over,
  });
}

function specialRole(over: Record<string, unknown> = {}) {
  return role({
    _id: "role-sp",
    _rev: "rev-sp",
    _type: "special_role",
    week: undefined,
    date: "2026-08-20",
    service_name: "Bautizos",
    songs: [{ _key: "s1", play_key: "G", song: { _type: "reference", _ref: "post-1" } }],
    Lead: [ref("c1", "mem-9")],
    BGVs: [],
    Chorus: [],
    instruments: [instrumentSlot("ci", "Bateria", "mem-10")],
    foh_team: [],
    ...over,
  });
}

function lock(over: Record<string, unknown> = {}) {
  return {
    _id: "roleTarget.sunday_role.2026-08-09",
    _rev: "lock-rev-1",
    _type: "roleTargetLock",
    targetKey: "sunday_role:2026-08-09",
    state: "claimed",
    roleId: "role-1",
    roleType: "sunday_role",
    date: "2026-08-09",
    claimNonce: "n1",
    generation: 2,
    ...over,
  };
}

function lockFor(roleId: string, week: string, rev: string) {
  return lock({
    _id: `roleTarget.sunday_role.${week}`,
    _rev: rev,
    targetKey: `sunday_role:${week}`,
    date: week,
    roleId,
  });
}

function seedMembers(...ids: string[]) {
  for (const id of ids) store.members.push({ _id: id, _rev: `m-${id}`, member_name: id });
}

/** Every member id the fixtures reference, so nothing looks dangling by default. */
function seedAllMembers() {
  seedMembers(
    "mem-1", "mem-2", "mem-3", "mem-4", "mem-5", "mem-6", "mem-7", "mem-8", "mem-9", "mem-10",
  );
}

function req(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function seat(roleId: string, rev: string, path: string, itemKey: string) {
  return { roleId, rev, path, itemKey };
}

beforeEach(() => {
  vi.clearAllMocks();
  transactions.length = 0;
  commitOutcomes.length = 0;
  afterCallbacks.length = 0;
  store = emptyStore();
  requireActiveManagerMock.mockResolvedValue(ADMIN);
  operationalFetch.mockImplementation(async (q: string, p: Record<string, unknown> = {}) =>
    canonicalRead(q, p),
  );
  rawFetch.mockImplementation(async (q: string, p: Record<string, unknown> = {}) => rawRead(q, p));
});

// ── Seat swap ───────────────────────────────────────────────────────────────

describe("POST /api/admin/roles/swap — seat swap", () => {
  function seedTwoWeekendRoles() {
    store.roles.push(role(), otherRole());
    store.locks.push(lockFor("role-1", "2026-08-09", "lock-rev-1"), lockFor("role-2", "2026-08-16", "lock-rev-2"));
    seedAllMembers();
  }

  it("denies a non-manager and a content-editor without reading anything", async () => {
    requireActiveManagerMock.mockResolvedValueOnce(null);
    expect((await swapPOST(req({}))).status).toBe(403);
    requireActiveManagerMock.mockResolvedValueOnce({ user: { role: "content-editor" } });
    expect((await swapPOST(req({}))).status).toBe(403);
    expect(operationalFetch).not.toHaveBeenCalled();
    expect(transactions).toHaveLength(0);
  });

  it("moves the person by stored _key, preserving destination key and labels", async () => {
    seedTwoWeekendRoles();
    const res = await swapPOST(
      req({
        kind: "seat",
        source: seat("role-1", "rev-1", "Lead", "a1"),
        target: seat("role-2", "rev-2", "instruments", "bi"),
      }),
    );
    expect(res.status).toBe(200);
    expect(committedTransactions()).toHaveLength(1);
    const ops = patches(committedTransactions()[0]);
    const roleOps = ops.filter((o) => !o.id.startsWith("roleTarget"));
    expect(roleOps).toHaveLength(2);
    // Only the PERSON reference of each addressed item is set: the item `_key`,
    // the instrument label and the FOH label are never rewritten.
    expect(roleOps[0]).toMatchObject({ id: "role-1", rev: "rev-1" });
    expect(roleOps[0].set).toEqual({ 'Lead[_key=="a1"]._ref': "mem-7" });
    expect(roleOps[1]).toMatchObject({ id: "role-2", rev: "rev-2" });
    expect(roleOps[1].set).toEqual({ 'instruments[_key=="bi"].person._ref': "mem-1" });
    // Both coordination tokens are asserted in the SAME transaction.
    const lockOps = ops.filter((o) => o.id.startsWith("roleTarget"));
    expect(lockOps.map((o) => o.rev).sort()).toEqual(["lock-rev-1", "lock-rev-2"]);
    expect(revalidateServiceViewsMock).toHaveBeenCalled();
  });

  it("swaps the same seat path across two services (two leads trading dates)", async () => {
    seedTwoWeekendRoles();
    const res = await swapPOST(
      req({
        kind: "seat",
        source: seat("role-1", "rev-1", "Lead", "a1"),
        target: seat("role-2", "rev-2", "Lead", "b1"),
      }),
    );
    expect(res.status).toBe(200);
    const roleOps = patches(committedTransactions()[0]).filter((o) => !o.id.startsWith("roleTarget"));
    expect(roleOps[0].set).toEqual({ 'Lead[_key=="a1"]._ref': "mem-5" });
    expect(roleOps[1].set).toEqual({ 'Lead[_key=="b1"]._ref': "mem-1" });
  });

  it("swaps two seats of the same path inside ONE role", async () => {
    store.roles.push(role({ Lead: [ref("a1", "mem-1"), ref("a9", "mem-2")] }));
    store.locks.push(lockFor("role-1", "2026-08-09", "lock-rev-1"));
    seedAllMembers();
    const res = await swapPOST(
      req({
        kind: "seat",
        source: seat("role-1", "rev-1", "Lead", "a1"),
        target: seat("role-1", "rev-1", "Lead", "a9"),
      }),
    );
    expect(res.status).toBe(200);
    const roleOps = patches(committedTransactions()[0]).filter((o) => !o.id.startsWith("roleTarget"));
    expect(roleOps).toHaveLength(1);
    expect(roleOps[0].set).toEqual({
      'Lead[_key=="a1"]._ref': "mem-2",
      'Lead[_key=="a9"]._ref': "mem-1",
    });
  });

  it("swaps two seats inside ONE role in a single guarded patch", async () => {
    seedTwoWeekendRoles();
    const res = await swapPOST(
      req({
        kind: "seat",
        source: seat("role-1", "rev-1", "Lead", "a1"),
        target: seat("role-1", "rev-1", "foh_team", "af"),
      }),
    );
    expect(res.status).toBe(200);
    const ops = patches(committedTransactions()[0]);
    const roleOps = ops.filter((o) => !o.id.startsWith("roleTarget"));
    expect(roleOps).toHaveLength(1);
    expect(roleOps[0]).toMatchObject({ id: "role-1", rev: "rev-1" });
    expect(roleOps[0].set).toEqual({
      'Lead[_key=="a1"]._ref': "mem-4",
      'foh_team[_key=="af"].person._ref': "mem-1",
    });
    expect(ops.filter((o) => o.id.startsWith("roleTarget"))).toHaveLength(1);
  });

  it("asserts both revisions for weekend↔special and for special↔special", async () => {
    store.roles.push(role(), specialRole(), specialRole({ _id: "role-sp2", _rev: "rev-sp2", date: "2026-08-21", Lead: [ref("d1", "mem-2")] }));
    store.locks.push(lockFor("role-1", "2026-08-09", "lock-rev-1"));
    seedAllMembers();

    let res = await swapPOST(
      req({
        kind: "seat",
        source: seat("role-1", "rev-1", "Lead", "a1"),
        target: seat("role-sp", "rev-sp", "Lead", "c1"),
      }),
    );
    expect(res.status).toBe(200);
    let ops = patches(committedTransactions()[0]);
    expect(ops.map((o) => `${o.id}@${o.rev}`)).toEqual([
      "role-1@rev-1",
      "role-sp@rev-sp",
      // The special service takes no weekend lock; its own revision serializes it.
      "roleTarget.sunday_role.2026-08-09@lock-rev-1",
    ]);

    transactions.length = 0;
    res = await swapPOST(
      req({
        kind: "seat",
        source: seat("role-sp", "rev-sp", "instruments", "ci"),
        target: seat("role-sp2", "rev-sp2", "Lead", "d1"),
      }),
    );
    expect(res.status).toBe(200);
    ops = patches(committedTransactions()[0]);
    expect(ops.map((o) => `${o.id}@${o.rev}`)).toEqual(["role-sp@rev-sp", "role-sp2@rev-sp2"]);
  });

  it("refuses a stale source revision and a stale target revision, writing nothing", async () => {
    seedTwoWeekendRoles();
    for (const [srcRev, tgtRev] of [["moved", "rev-2"], ["rev-1", "moved"]]) {
      transactions.length = 0;
      const res = await swapPOST(
        req({
          kind: "seat",
          source: seat("role-1", srcRev, "Lead", "a1"),
          target: seat("role-2", tgtRev, "instruments", "bi"),
        }),
      );
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe("stale_revision");
      expect(transactions).toHaveLength(0);
    }
  });

  it("refuses an identical selection", async () => {
    seedTwoWeekendRoles();
    const res = await swapPOST(
      req({
        kind: "seat",
        source: seat("role-1", "rev-1", "Lead", "a1"),
        target: seat("role-1", "rev-1", "Lead", "a1"),
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).details.issues).toContain("identical_selection");
    expect(transactions).toHaveLength(0);
  });

  it("refuses an unknown or missing item _key", async () => {
    seedTwoWeekendRoles();
    for (const key of ["nope", undefined]) {
      transactions.length = 0;
      const res = await swapPOST(
        req({
          kind: "seat",
          source: seat("role-1", "rev-1", "Lead", "a1"),
          target: { roleId: "role-2", rev: "rev-2", path: "instruments", itemKey: key },
        }),
      );
      expect(res.status).toBe(400);
      expect(transactions).toHaveLength(0);
    }
  });

  it("refuses a path that is not one of the five seat paths", async () => {
    seedTwoWeekendRoles();
    for (const path of ["songs", "published", "week", "team_notes"]) {
      transactions.length = 0;
      const res = await swapPOST(
        req({
          kind: "seat",
          source: seat("role-1", "rev-1", path, "a1"),
          target: seat("role-2", "rev-2", "instruments", "bi"),
        }),
      );
      expect(res.status).toBe(400);
      expect((await res.json()).details.issues).toContain("source.path");
      expect(transactions).toHaveLength(0);
    }
  });

  it("refuses a dangling assignment reference", async () => {
    store.roles.push(role(), otherRole());
    store.locks.push(lockFor("role-1", "2026-08-09", "lock-rev-1"), lockFor("role-2", "2026-08-16", "lock-rev-2"));
    // mem-7 (the target instrument's person) resolves to no canonical member.
    seedMembers("mem-1", "mem-2", "mem-3", "mem-4", "mem-5", "mem-6", "mem-8");
    const res = await swapPOST(
      req({
        kind: "seat",
        source: seat("role-1", "rev-1", "Lead", "a1"),
        target: seat("role-2", "rev-2", "instruments", "bi"),
      }),
    );
    expect(res.status).toBe(409);
    const bodyJson = await res.json();
    expect(bodyJson.error).toBe("integrity_conflict");
    expect(bodyJson.details.danglingRefs).toEqual(["mem-7"]);
    expect(transactions).toHaveLength(0);
  });

  it("refuses a coordination token owned by another role", async () => {
    store.roles.push(role(), otherRole());
    store.locks.push(lockFor("role-other", "2026-08-09", "lock-rev-1"), lockFor("role-2", "2026-08-16", "lock-rev-2"));
    seedAllMembers();
    const res = await swapPOST(
      req({
        kind: "seat",
        source: seat("role-1", "rev-1", "Lead", "a1"),
        target: seat("role-2", "rev-2", "instruments", "bi"),
      }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).details.detail).toBe("lock_wrong_owner");
    expect(transactions).toHaveLength(0);
  });

  it("refuses when a raw draft overlay exists for either role", async () => {
    seedTwoWeekendRoles();
    store.rawRoleDrafts.push({ _id: "drafts.role-2", _type: "sunday_role", week: "2026-08-16" });
    const res = await swapPOST(
      req({
        kind: "seat",
        source: seat("role-1", "rev-1", "Lead", "a1"),
        target: seat("role-2", "rev-2", "instruments", "bi"),
      }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("integrity_conflict");
    expect(transactions).toHaveLength(0);
  });

  it("reports a conflicting commit as stale_revision and notifies nothing", async () => {
    seedTwoWeekendRoles();
    commitOutcomes.push(conflictError());
    const res = await swapPOST(
      req({
        kind: "seat",
        source: seat("role-1", "rev-1", "Lead", "a1"),
        target: seat("role-2", "rev-2", "instruments", "bi"),
      }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("stale_revision");
    expect(committedTransactions()).toHaveLength(0);
    expect(revalidateServiceViewsMock).not.toHaveBeenCalled();
    expect(afterCallbacks).toHaveLength(0);
  });

  it("notifies the newly added assignee of each destination role, drafts stay silent", async () => {
    seedTwoWeekendRoles();
    await swapPOST(
      req({
        kind: "seat",
        source: seat("role-1", "rev-1", "Lead", "a1"),
        target: seat("role-2", "rev-2", "instruments", "bi"),
      }),
    );
    expect(afterCallbacks).toHaveLength(1);
    await afterCallbacks[0]();
    // Per destination role: role-1 receives mem-7, role-2 receives mem-1.
    expect(sendPushMock).toHaveBeenCalledTimes(2);
    expect(sendPushMock.mock.calls[0][0]).toEqual(["mem-7"]);
    expect(sendPushMock.mock.calls[1][0]).toEqual(["mem-1"]);
    expect(sendAssignmentEmailsMock).toHaveBeenCalledTimes(2);

    afterCallbacks.length = 0;
    transactions.length = 0;
    store = emptyStore();
    store.roles.push(role({ published: false }), otherRole({ published: false }));
    store.locks.push(lockFor("role-1", "2026-08-09", "lock-rev-1"), lockFor("role-2", "2026-08-16", "lock-rev-2"));
    seedAllMembers();
    await swapPOST(
      req({
        kind: "seat",
        source: seat("role-1", "rev-1", "Lead", "a1"),
        target: seat("role-2", "rev-2", "instruments", "bi"),
      }),
    );
    expect(committedTransactions()).toHaveLength(1);
    expect(afterCallbacks).toHaveLength(0);
  });
});

// ── Team swap ───────────────────────────────────────────────────────────────

describe("POST /api/admin/roles/swap — team swap", () => {
  it("exchanges exactly the five seat fields and preserves everything else", async () => {
    const a = role();
    const b = otherRole();
    store.roles.push(a, b);
    store.locks.push(lockFor("role-1", "2026-08-09", "lock-rev-1"), lockFor("role-2", "2026-08-16", "lock-rev-2"));
    seedAllMembers();
    const res = await swapPOST(
      req({ kind: "team", roles: [{ id: "role-1", rev: "rev-1" }, { id: "role-2", rev: "rev-2" }] }),
    );
    expect(res.status).toBe(200);
    const ops = patches(committedTransactions()[0]);
    const roleOps = ops.filter((o) => !o.id.startsWith("roleTarget"));
    expect(roleOps).toHaveLength(2);
    for (const op of roleOps) {
      expect(Object.keys(op.set).sort()).toEqual(
        ["BGVs", "Chorus", "Lead", "foh_team", "instruments"].sort(),
      );
      // Identity, date, service name, publication state and songs are never set.
      for (const field of ["_id", "_type", "week", "date", "service_name", "published", "songs", "team_notes"]) {
        expect(op.set[field]).toBeUndefined();
      }
    }
    // Each role receives the OTHER role's stored items, `_key`s intact.
    expect(roleOps[0]).toMatchObject({ id: "role-1", rev: "rev-1" });
    expect(roleOps[0].set.Lead).toEqual(b.Lead);
    expect(roleOps[0].set.instruments).toEqual(b.instruments);
    expect(roleOps[1]).toMatchObject({ id: "role-2", rev: "rev-2" });
    expect(roleOps[1].set.Chorus).toEqual(a.Chorus);
    expect(roleOps[1].set.foh_team).toEqual(a.foh_team);
    // Every involved coordination token is asserted in the same transaction.
    expect(ops.filter((o) => o.id.startsWith("roleTarget")).map((o) => o.rev).sort()).toEqual([
      "lock-rev-1",
      "lock-rev-2",
    ]);
  });

  it("swaps a weekend team with a special-service team", async () => {
    store.roles.push(role(), specialRole());
    store.locks.push(lockFor("role-1", "2026-08-09", "lock-rev-1"));
    seedAllMembers();
    const res = await swapPOST(
      req({ kind: "team", roles: [{ id: "role-1", rev: "rev-1" }, { id: "role-sp", rev: "rev-sp" }] }),
    );
    expect(res.status).toBe(200);
    const ops = patches(committedTransactions()[0]);
    expect(ops.map((o) => `${o.id}@${o.rev}`)).toEqual([
      "role-1@rev-1",
      "role-sp@rev-sp",
      "roleTarget.sunday_role.2026-08-09@lock-rev-1",
    ]);
    // The special service keeps its embedded songs and its name.
    const specialPatch = ops.find((o) => o.id === "role-sp") as PatchOp;
    expect(specialPatch.set.songs).toBeUndefined();
    expect(specialPatch.set.service_name).toBeUndefined();
  });

  it("notifies the newly added assignees per destination role", async () => {
    store.roles.push(role(), otherRole());
    store.locks.push(lockFor("role-1", "2026-08-09", "lock-rev-1"), lockFor("role-2", "2026-08-16", "lock-rev-2"));
    seedAllMembers();
    await swapPOST(
      req({ kind: "team", roles: [{ id: "role-1", rev: "rev-1" }, { id: "role-2", rev: "rev-2" }] }),
    );
    await afterCallbacks[0]();
    expect(sendPushMock).toHaveBeenCalledTimes(2);
    expect(sendPushMock.mock.calls[0][0]).toEqual(["mem-5", "mem-6", "mem-7", "mem-8"]);
    expect(sendPushMock.mock.calls[1][0]).toEqual(["mem-1", "mem-2", "mem-3", "mem-4"]);
  });

  it("refuses a stale entry, the same role twice, and a replacement team payload", async () => {
    store.roles.push(role(), otherRole());
    store.locks.push(lockFor("role-1", "2026-08-09", "lock-rev-1"), lockFor("role-2", "2026-08-16", "lock-rev-2"));
    seedAllMembers();

    let res = await swapPOST(
      req({ kind: "team", roles: [{ id: "role-1", rev: "rev-1" }, { id: "role-2", rev: "moved" }] }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("stale_revision");
    expect(transactions).toHaveLength(0);

    res = await swapPOST(
      req({ kind: "team", roles: [{ id: "role-1", rev: "rev-1" }, { id: "role-1", rev: "rev-1" }] }),
    );
    expect(res.status).toBe(400);
    expect(transactions).toHaveLength(0);

    // A client-supplied team is ignored entirely: only stored seats are written.
    res = await swapPOST(
      req({
        kind: "team",
        roles: [{ id: "role-1", rev: "rev-1" }, { id: "role-2", rev: "rev-2" }],
        leads: ["mem-hacker"],
        instruments: [{ instrument: "Bajo", personId: "mem-hacker" }],
      }),
    );
    expect(res.status).toBe(200);
    expect(JSON.stringify(committedTransactions()[0].ops)).not.toContain("mem-hacker");
  });

  it("refuses a role whose seat arrays are structurally invalid", async () => {
    store.roles.push(role({ instruments: undefined }), otherRole());
    store.locks.push(lockFor("role-1", "2026-08-09", "lock-rev-1"), lockFor("role-2", "2026-08-16", "lock-rev-2"));
    seedAllMembers();
    const res = await swapPOST(
      req({ kind: "team", roles: [{ id: "role-1", rev: "rev-1" }, { id: "role-2", rev: "rev-2" }] }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("integrity_conflict");
    expect(transactions).toHaveLength(0);
  });

  it("bootstraps a legacy weekend lock, then swaps from the produced revisions", async () => {
    store.roles.push(role(), otherRole());
    // role-2 owns no lock yet (legacy weekend target).
    store.locks.push(lockFor("role-1", "2026-08-09", "lock-rev-1"));
    seedAllMembers();
    let roleReads = 0;
    operationalFetch.mockImplementation(async (q: string, p: Record<string, unknown> = {}) => {
      if (q.includes("_id == $id") && p.id === "role-2") {
        roleReads++;
        if (roleReads > 1) {
          store.locks.push(lockFor("role-2", "2026-08-16", "lock-rev-boot"));
          return [otherRole({ _rev: "rev-2-after-boot" })];
        }
      }
      return canonicalRead(q, p);
    });
    const res = await swapPOST(
      req({ kind: "team", roles: [{ id: "role-1", rev: "rev-1" }, { id: "role-2", rev: "rev-2" }] }),
    );
    expect(res.status).toBe(200);
    expect(committedTransactions()).toHaveLength(2);
    // 1) maintenance: guarded heartbeat of the unchanged target field + the lock.
    const boot = committedTransactions()[0].ops;
    expect(boot[0]).toMatchObject({ kind: "patch", id: "role-2", rev: "rev-2" });
    expect(boot[1]).toMatchObject({ kind: "create" });
    // 2) business: continues ONLY from the produced revision.
    const business = patches(committedTransactions()[1]);
    expect(business.find((o) => o.id === "role-2")?.rev).toBe("rev-2-after-boot");
    expect(business.some((o) => o.id === "roleTarget.sunday_role.2026-08-16" && o.rev === "lock-rev-boot")).toBe(true);
  });

  it("reports bootstrap_completed_reload when the business commit then conflicts", async () => {
    store.roles.push(role(), otherRole());
    store.locks.push(lockFor("role-1", "2026-08-09", "lock-rev-1"));
    seedAllMembers();
    let roleReads = 0;
    operationalFetch.mockImplementation(async (q: string, p: Record<string, unknown> = {}) => {
      if (q.includes("_id == $id") && p.id === "role-2") {
        roleReads++;
        if (roleReads > 1) {
          store.locks.push(lockFor("role-2", "2026-08-16", "lock-rev-boot"));
          return [otherRole({ _rev: "rev-2-after-boot" })];
        }
      }
      return canonicalRead(q, p);
    });
    commitOutcomes.push(undefined, conflictError());
    const res = await swapPOST(
      req({ kind: "team", roles: [{ id: "role-1", rev: "rev-1" }, { id: "role-2", rev: "rev-2" }] }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("bootstrap_completed_reload");
    expect(committedTransactions()).toHaveLength(1);
    expect(revalidateServiceViewsMock).not.toHaveBeenCalled();
    expect(afterCallbacks).toHaveLength(0);
  });
});

// ── Copy instruments ────────────────────────────────────────────────────────

describe("POST /api/admin/roles/copy-instruments", () => {
  function seed() {
    store.roles.push(role(), otherRole());
    store.locks.push(lockFor("role-1", "2026-08-09", "lock-rev-1"), lockFor("role-2", "2026-08-16", "lock-rev-2"));
    seedAllMembers();
  }
  const copyBody = (over: Record<string, unknown> = {}) => ({
    source: { id: "role-1", rev: "rev-1" },
    target: { id: "role-2", rev: "rev-2" },
    ...over,
  });

  it("denies a content-editor", async () => {
    requireActiveManagerMock.mockResolvedValueOnce({ user: { role: "content-editor" } });
    expect((await copyPOST(req(copyBody()))).status).toBe(403);
    expect(transactions).toHaveLength(0);
  });

  it("patches ONLY the target's instruments while asserting both revisions", async () => {
    seed();
    const res = await copyPOST(req(copyBody()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, copied: 1 });
    const ops = patches(committedTransactions()[0]);
    expect(ops).toHaveLength(4);
    // Destination: only `instruments`, carrying the source's stored items.
    expect(ops[0]).toMatchObject({ id: "role-2", rev: "rev-2" });
    expect(Object.keys(ops[0].set)).toEqual(["instruments"]);
    expect(ops[0].set.instruments).toEqual(role().instruments);
    // Source: a revision-asserting no-op heartbeat of its own unchanged date.
    expect(ops[1]).toMatchObject({ id: "role-1", rev: "rev-1" });
    expect(ops[1].set).toEqual({ week: "2026-08-09" });
    // Both coordination tokens, one transaction.
    expect(ops.slice(2).map((o) => o.rev).sort()).toEqual(["lock-rev-1", "lock-rev-2"]);
    expect(revalidateServiceViewsMock).toHaveBeenCalled();
  });

  it("ignores a cached client instrument payload and copies stored source state", async () => {
    seed();
    const res = await copyPOST(
      req(
        copyBody({
          instruments: [{ instrument: "Trompeta", personId: "mem-hacker" }],
          sourceInstruments: [{ instrument: "Trompeta", personId: "mem-hacker" }],
        }),
      ),
    );
    expect(res.status).toBe(200);
    const ops = patches(committedTransactions()[0]);
    expect(ops[0].set.instruments).toEqual(role().instruments);
    expect(JSON.stringify(committedTransactions()[0].ops)).not.toContain("mem-hacker");
  });

  it("leaves the target unchanged for a stale source revision", async () => {
    seed();
    const res = await copyPOST(req(copyBody({ source: { id: "role-1", rev: "moved" } })));
    expect(res.status).toBe(409);
    const bodyJson = await res.json();
    expect(bodyJson.error).toBe("stale_revision");
    expect(bodyJson.details.side).toBe("source");
    expect(transactions).toHaveLength(0);
  });

  it("leaves the target unchanged for a deleted source", async () => {
    store.roles.push(otherRole());
    store.locks.push(lockFor("role-2", "2026-08-16", "lock-rev-2"));
    seedAllMembers();
    const res = await copyPOST(req(copyBody()));
    expect(res.status).toBe(404);
    expect(transactions).toHaveLength(0);
  });

  it("leaves the target unchanged for a stale target revision", async () => {
    seed();
    const res = await copyPOST(req(copyBody({ target: { id: "role-2", rev: "moved" } })));
    expect(res.status).toBe(409);
    const bodyJson = await res.json();
    expect(bodyJson.error).toBe("stale_revision");
    expect(bodyJson.details.side).toBe("target");
    expect(transactions).toHaveLength(0);
  });

  it("leaves the target unchanged for an invalid target, a dangling assignment, and a conflict", async () => {
    // Invalid target: a structurally broken seat array.
    store.roles.push(role(), otherRole({ Chorus: "nope" }));
    store.locks.push(lockFor("role-1", "2026-08-09", "lock-rev-1"), lockFor("role-2", "2026-08-16", "lock-rev-2"));
    seedAllMembers();
    let res = await copyPOST(req(copyBody()));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("integrity_conflict");
    expect(transactions).toHaveLength(0);

    // Dangling: the source instrument's person resolves to no canonical member.
    store = emptyStore();
    seed();
    store.members = store.members.filter((m) => m._id !== "mem-3");
    res = await copyPOST(req(copyBody()));
    expect(res.status).toBe(409);
    expect((await res.json()).details.danglingRefs).toEqual(["mem-3"]);
    expect(transactions).toHaveLength(0);

    // Conflict at commit time.
    store = emptyStore();
    seed();
    commitOutcomes.push(conflictError());
    res = await copyPOST(req(copyBody()));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("stale_revision");
    expect(committedTransactions()).toHaveLength(0);
    expect(revalidateServiceViewsMock).not.toHaveBeenCalled();
    expect(afterCallbacks).toHaveLength(0);
  });

  it("refuses the same role as source and target", async () => {
    seed();
    const res = await copyPOST(req(copyBody({ target: { id: "role-1", rev: "rev-1" } })));
    expect(res.status).toBe(400);
    expect((await res.json()).details.issues).toContain("identical_selection");
    expect(transactions).toHaveLength(0);
  });

  it("notifies only the destination role's newly added assignees", async () => {
    seed();
    await copyPOST(req(copyBody()));
    expect(afterCallbacks).toHaveLength(1);
    await afterCallbacks[0]();
    expect(sendPushMock).toHaveBeenCalledTimes(1);
    expect(sendPushMock.mock.calls[0][0]).toEqual(["mem-3"]);
    expect(sendAssignmentEmailsMock.mock.calls[0][1]).toMatchObject({
      type: "sunday_role",
      date: "2026-08-16",
    });
  });

  it("copies from a weekend service onto a special service", async () => {
    store.roles.push(role(), specialRole());
    store.locks.push(lockFor("role-1", "2026-08-09", "lock-rev-1"));
    seedAllMembers();
    const res = await copyPOST(req(copyBody({ target: { id: "role-sp", rev: "rev-sp" } })));
    expect(res.status).toBe(200);
    const ops = patches(committedTransactions()[0]);
    expect(ops.map((o) => `${o.id}@${o.rev}`)).toEqual([
      "role-sp@rev-sp",
      "role-1@rev-1",
      "roleTarget.sunday_role.2026-08-09@lock-rev-1",
    ]);
    expect(Object.keys(ops[0].set)).toEqual(["instruments"]);
  });
});
