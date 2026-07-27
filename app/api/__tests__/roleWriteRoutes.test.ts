// Protected role writers (Service Readiness A2 §2/§3) at the route level.
//
// The Sanity clients are fully mocked — no network, no dataset. Reads are served
// by a tiny in-memory store dispatched off the bound GROQ, and every transaction
// is recorded as an operation list so each test can assert exactly what would have
// been committed (and that a rejected request commits nothing).

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
const sendAssignmentEmailsBatchMock = vi.fn();
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
  sendAssignmentEmailsBatch: (...a: unknown[]) => sendAssignmentEmailsBatchMock(...a),
  assigneesOf: () => [],
}));
vi.mock("next/server", async (importOriginal) => {
  const mod = await importOriginal<typeof import("next/server")>();
  return { ...mod, after: (fn: () => unknown) => void afterCallbacks.push(fn) };
});

import { payloadFingerprint, receiptIdForRequestId } from "@/app/utils/roleCreationReceipt";
import { POST as createPOST } from "@/app/api/admin/roles/route";
import { PATCH as rolePATCH, DELETE as roleDELETE } from "@/app/api/admin/roles/[id]/route";
import { POST as publishPOST } from "@/app/api/admin/roles/publish/route";

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

function conflictError(type = "documentAlreadyExistsError", id = "doc") {
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
      // Opt-in hook (default: no effect) so a test can move the store to the
      // state the Content Lake would hold AFTER the transaction — the only way
      // to observe what a route reads back post-commit.
      onCommit?.();
      return { transactionId: "t1" };
    },
  };
  return tx;
}

/** Set by a test that needs the store to change at commit time. */
let onCommit: (() => void) | null = null;

function committedTransactions() {
  return transactions.filter((t) => t.committed);
}

// ── In-memory store, dispatched off the bound GROQ ──────────────────────────

interface Store {
  roles: Record<string, unknown>[];
  locks: Record<string, unknown>[];
  receipts: Record<string, unknown>[];
  setlists: Record<string, unknown>[];
  proposals: Record<string, unknown>[];
  references: Record<string, unknown>[];
  rawRoleDrafts: Record<string, unknown>[];
  rawSetlistDrafts: Record<string, unknown>[];
  rawProposalDrafts: Record<string, unknown>[];
}

let store: Store;
/** Receipts revealed only on the SECOND receipt read (a racing same-key winner). */
let lateReceipts: Record<string, unknown>[] = [];
/** Roles that land in the store at the same moment the late receipt appears. */
let lateRoles: Record<string, unknown>[] = [];
let receiptReads = 0;

function emptyStore(): Store {
  return {
    roles: [],
    locks: [],
    receipts: [],
    setlists: [],
    proposals: [],
    references: [],
    rawRoleDrafts: [],
    rawSetlistDrafts: [],
    rawProposalDrafts: [],
  };
}

function canonicalRead(query: string, params: Record<string, unknown>): unknown[] {
  if (query.includes("roleCreationReceipt")) {
    receiptReads++;
    if (receiptReads > 1 && lateRoles.length) {
      store.roles.push(...lateRoles);
      lateRoles = [];
    }
    const pool = receiptReads > 1 ? [...store.receipts, ...lateReceipts] : store.receipts;
    if (query.includes("_id == $id")) return pool.filter((r) => r._id === params.id);
    return pool.filter((r) => r.roleId === params.roleId);
  }
  if (query.includes("roleTargetLock")) {
    return store.locks.filter((l) => (params.ids as string[]).includes(l._id as string));
  }
  if (query.includes("$setlistTypes")) {
    return store.setlists.filter((s) => (params.weeks as string[]).includes(s.week as string));
  }
  if (query.includes("setlistProposal")) {
    return store.proposals.filter(
      (p) =>
        (params.roleId && p.service_ref === params.roleId) ||
        (params.dates as string[]).includes(p.service_date as string),
    );
  }
  if (query.includes("references($roleId)")) return store.references;
  // Role reads
  if (query.includes("_id == $id")) return store.roles.filter((r) => r._id === params.id);
  if (query.includes("_id in $ids")) {
    return store.roles.filter((r) => (params.ids as string[]).includes(r._id as string));
  }
  if (query.includes("$roleType") && query.includes("week == $week")) {
    return store.roles.filter((r) => r._type === params.roleType && r.week === params.week);
  }
  if (query.includes('_type == "special_role"')) {
    return store.roles.filter((r) => r._type === "special_role" && r.date === params.date);
  }
  throw new Error(`unmocked canonical query: ${query}`);
}

function rawRead(query: string, params: Record<string, unknown>): unknown[] {
  if (query.includes("$setlistTypes")) {
    return store.rawSetlistDrafts.filter((s) => (params.weeks as string[]).includes(s.week as string));
  }
  if (query.includes("setlistProposal")) return store.rawProposalDrafts;
  if (query.includes("_id == $draftId")) {
    return store.rawRoleDrafts.filter((d) => d._id === params.draftId);
  }
  if (query.includes("_id in $draftIds")) {
    return store.rawRoleDrafts.filter((d) => (params.draftIds as string[]).includes(d._id as string));
  }
  if (query.includes("week == $week")) {
    return store.rawRoleDrafts.filter((d) => d._type === params.roleType && d.week === params.week);
  }
  if (query.includes("date == $date")) {
    return store.rawRoleDrafts.filter((d) => d._type === "special_role" && d.date === params.date);
  }
  throw new Error(`unmocked raw query: ${query}`);
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const ADMIN = { user: { role: "admin" } };
const REQ = "req-sunday-00000001";
const RECEIPT_ID = receiptIdForRequestId(REQ) as string;

function createBody(over: Record<string, unknown> = {}) {
  return {
    creationRequestId: REQ,
    _type: "sunday_role",
    date: "2026-08-09",
    published: false,
    leads: ["mem-1"],
    bgvs: [],
    chorus: [],
    instruments: [{ instrument: "Bajo", personId: "mem-2" }],
    foh: [],
    ...over,
  };
}

function role(over: Record<string, unknown> = {}) {
  return {
    _id: "role-1",
    _rev: "rev-1",
    _type: "sunday_role",
    week: "2026-08-09",
    published: false,
    Lead: [{ _key: "k1", _type: "reference", _ref: "mem-1" }],
    BGVs: [],
    Chorus: [],
    instruments: [],
    foh_team: [],
    ...over,
  };
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

function receipt(over: Record<string, unknown> = {}) {
  return {
    _id: RECEIPT_ID,
    _rev: "receipt-rev-1",
    _type: "roleCreationReceipt",
    requestId: REQ,
    fingerprint: payloadFingerprint(createBody()),
    roleId: "role-1",
    roleType: "sunday_role",
    targetIdentity: "sunday_role:2026-08-09",
    state: "committed",
    ...over,
  };
}

function proposal(over: Record<string, unknown> = {}) {
  return {
    _id: "prop-1",
    _rev: "p1",
    _createdAt: "2026-07-01T00:00:00Z",
    service_type: "sunday",
    service_ref: "role-1",
    service_date: "2026-08-09",
    status: "pending",
    songs: [],
    ...over,
  };
}

function req(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  transactions.length = 0;
  commitOutcomes.length = 0;
  afterCallbacks.length = 0;
  lateReceipts = [];
  lateRoles = [];
  receiptReads = 0;
  onCommit = null;
  store = emptyStore();
  requireActiveManagerMock.mockResolvedValue(ADMIN);
  operationalFetch.mockImplementation(async (q: string, p: Record<string, unknown> = {}) =>
    canonicalRead(q, p),
  );
  rawFetch.mockImplementation(async (q: string, p: Record<string, unknown> = {}) => rawRead(q, p));
});

// ── Create ──────────────────────────────────────────────────────────────────

describe("POST /api/admin/roles — create", () => {
  it("denies a non-manager and a content-editor without reading anything", async () => {
    requireActiveManagerMock.mockResolvedValueOnce(null);
    expect((await createPOST(req(createBody()))).status).toBe(403);
    requireActiveManagerMock.mockResolvedValueOnce({ user: { role: "content-editor" } });
    expect((await createPOST(req(createBody()))).status).toBe(403);
    expect(operationalFetch).not.toHaveBeenCalled();
  });

  it("requires a bounded creationRequestId", async () => {
    const res = await createPOST(req(createBody({ creationRequestId: undefined })));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_request");
    expect(transactions).toHaveLength(0);
  });

  it("commits receipt + role + weekend lock in ONE transaction", async () => {
    const res = await createPOST(req(createBody()));
    expect(res.status).toBe(201);
    expect(committedTransactions()).toHaveLength(1);
    const ops = committedTransactions()[0].ops;
    expect(ops).toHaveLength(3);
    const created = ops.filter((o) => o.kind === "create") as { doc: Record<string, unknown> }[];
    expect(created).toHaveLength(3);
    const receiptDoc = created.find((c) => c.doc._type === "roleCreationReceipt")!.doc;
    const roleDoc = created.find((c) => c.doc._type === "sunday_role")!.doc;
    const lockDoc = created.find((c) => c.doc._type === "roleTargetLock")!.doc;
    expect(receiptDoc._id).toBe(RECEIPT_ID);
    expect(receiptDoc.requestId).toBe(REQ);
    expect(receiptDoc.roleId).toBe(roleDoc._id);
    expect(roleDoc.week).toBe("2026-08-09");
    expect(roleDoc.creationReceiptId).toBe(RECEIPT_ID);
    expect(lockDoc._id).toBe("roleTarget.sunday_role.2026-08-09");
    expect(lockDoc.roleId).toBe(roleDoc._id);
    expect(lockDoc.state).toBe("claimed");
    expect(revalidateServiceViewsMock).toHaveBeenCalled();
  });

  it("notifies every initial assignee only when the create is published", async () => {
    await createPOST(req(createBody({ published: true, leads: ["mem-1"] })));
    expect(afterCallbacks).toHaveLength(1);
    await afterCallbacks[0]();
    expect(sendPushMock).toHaveBeenCalledWith(["mem-1", "mem-2"], "assignments", expect.anything());
    expect(sendAssignmentEmailsMock).toHaveBeenCalled();

    afterCallbacks.length = 0;
    transactions.length = 0;
    store = emptyStore();
    await createPOST(req(createBody({ creationRequestId: "req-sunday-00000009" })));
    expect(afterCallbacks).toHaveLength(0);
  });

  it("swallows a thrown notification without failing the committed create (§7)", async () => {
    sendPushMock.mockRejectedValue(new Error("fcm down"));
    sendAssignmentEmailsMock.mockRejectedValue(new Error("smtp down"));
    const res = await createPOST(req(createBody({ published: true })));
    expect(res.status).toBe(201);
    expect(committedTransactions()).toHaveLength(1);
    await expect(afterCallbacks[0]()).resolves.toBeUndefined();
    // Both channels were still attempted, and the create stands.
    expect(sendPushMock).toHaveBeenCalledTimes(1);
    expect(sendAssignmentEmailsMock).toHaveBeenCalledTimes(1);
    expect(committedTransactions()).toHaveLength(1);
  });

  it("creates a special role with NO weekend lock", async () => {
    const res = await createPOST(
      req(createBody({ _type: "special_role", service_name: "Bautizos", creationRequestId: "req-special-0000001" })),
    );
    expect(res.status).toBe(201);
    const ops = committedTransactions()[0].ops;
    expect(ops).toHaveLength(2);
    expect(ops.some((o) => o.kind === "create" && o.doc._type === "roleTargetLock")).toBe(false);
    const roleDoc = (ops.find((o) => o.kind === "create" && o.doc._type === "special_role") as {
      doc: Record<string, unknown>;
    }).doc;
    expect(roleDoc.date).toBe("2026-08-09");
    expect(roleDoc.service_name).toBe("Bautizos");
    expect(roleDoc.week).toBeUndefined();
  });

  it("re-claims an existing VACANT lock under its observed revision", async () => {
    store.locks.push(lock({ state: "vacant", roleId: undefined, _rev: "lock-rev-9", generation: 4 }));
    const res = await createPOST(req(createBody()));
    expect(res.status).toBe(201);
    const patches = committedTransactions()[0].ops.filter((o) => o.kind === "patch") as PatchOp[];
    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({ id: "roleTarget.sunday_role.2026-08-09", rev: "lock-rev-9" });
    expect(patches[0].set.state).toBe("claimed");
  });

  it("replays a lost response as idempotent success with NO writes or side effects", async () => {
    store.receipts.push(receipt());
    store.roles.push(role());
    const res = await createPOST(req(createBody()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.replay).toBe(true);
    expect(body._id).toBe("role-1");
    expect(transactions).toHaveLength(0);
    expect(revalidateServiceViewsMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
    expect(afterCallbacks).toHaveLength(0);
  });

  it.each([
    ["changed date", { date: "2026-08-16" }],
    ["changed role type", { _type: "saturday_role" }],
    ["changed assignments", { leads: ["mem-9"] }],
    ["changed publication", { published: true }],
  ])("rejects the same key with a %s as idempotency_mismatch", async (_label, over) => {
    store.receipts.push(receipt());
    store.roles.push(role());
    const res = await createPOST(req(createBody(over)));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("idempotency_mismatch");
    expect(transactions).toHaveLength(0);
  });

  it("rejects reusing a weekend key for a special service (identity change)", async () => {
    store.receipts.push(receipt());
    store.roles.push(role());
    const res = await createPOST(req(createBody({ _type: "special_role", service_name: "Bautizos" })));
    expect((await res.json()).error).toBe("idempotency_mismatch");
    expect(res.status).toBe(409);
  });

  it("refuses a retired key and never recreates its role", async () => {
    store.receipts.push(receipt({ state: "role_deleted" }));
    const res = await createPOST(req(createBody()));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("idempotency_key_retired");
    expect(transactions).toHaveLength(0);
  });

  it("fails closed when the receipt's result role is missing or the wrong type", async () => {
    store.receipts.push(receipt());
    let res = await createPOST(req(createBody()));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("integrity_conflict");

    store.roles.push(role({ _type: "saturday_role" }));
    res = await createPOST(req(createBody()));
    expect((await res.json()).error).toBe("integrity_conflict");
    expect(transactions).toHaveLength(0);
  });

  it("refuses a different key racing an already-occupied weekend target", async () => {
    store.roles.push(role());
    store.locks.push(lock());
    const res = await createPOST(req(createBody({ creationRequestId: "req-other-00000002" })));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("ambiguous_target");
    // No receipt is left behind for the loser.
    expect(transactions).toHaveLength(0);
  });

  it("refuses a target that already carries orphaned setlist history", async () => {
    store.setlists.push({ _id: "sl-1", _type: "featuredSongs", week: "2026-08-09", songs: [] });
    const res = await createPOST(req(createBody()));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("target_has_orphaned_dependencies");
    expect(body.details.dependencies[0].id).toBe("sl-1");
    expect(transactions).toHaveLength(0);
  });

  it("refuses a raw draft occupying the target", async () => {
    store.rawRoleDrafts.push({ _id: "drafts.role-x", _type: "sunday_role", week: "2026-08-09" });
    const res = await createPOST(req(createBody()));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("integrity_conflict");
  });

  it("on a transaction conflict refetches the RECEIPT first and replays the winner", async () => {
    commitOutcomes.push(conflictError());
    // The racing same-key winner's receipt+role appear after the failed commit.
    lateReceipts.push(receipt());
    lateRoles.push(role());
    const res = await createPOST(req(createBody()));
    expect(res.status).toBe(200);
    expect((await res.json()).replay).toBe(true);
    expect(committedTransactions()).toHaveLength(0);
  });

  it("on a transaction conflict with no receipt reports the occupied target, never a retry", async () => {
    commitOutcomes.push(conflictError());
    // A different key won the weekend target between the inventory and the commit.
    let seen = 0;
    operationalFetch.mockImplementation(async (q: string, p: Record<string, unknown> = {}) => {
      if (q.includes("week == $week")) {
        seen++;
        return seen > 1 ? [role({ _id: "role-winner" })] : [];
      }
      return canonicalRead(q, p);
    });
    const res = await createPOST(req(createBody()));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("ambiguous_target");
    expect(transactions).toHaveLength(1);
    expect(committedTransactions()).toHaveLength(0);
  });
});

// ── Edit ────────────────────────────────────────────────────────────────────

describe("PATCH /api/admin/roles/[id] — edit", () => {
  function editBody(over: Record<string, unknown> = {}) {
    return {
      rev: "rev-1",
      _type: "sunday_role",
      date: "2026-08-09",
      leads: ["mem-1", "mem-5"],
      bgvs: [],
      chorus: [],
      instruments: [],
      foh: [],
      ...over,
    };
  }

  it("requires the client-observed revision", async () => {
    store.roles.push(role());
    const res = await rolePATCH(req(editBody({ rev: undefined })), ctx("role-1"));
    expect(res.status).toBe(400);
    expect(transactions).toHaveLength(0);
  });

  it("refuses a stale observed revision with no business mutation", async () => {
    store.roles.push(role({ _rev: "rev-moved" }));
    store.locks.push(lock());
    const res = await rolePATCH(req(editBody()), ctx("role-1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("stale_revision");
    expect(transactions).toHaveLength(0);
  });

  it("asserts the role revision and heartbeats the owned lock on a same-date edit", async () => {
    store.roles.push(role());
    store.locks.push(lock());
    const res = await rolePATCH(req(editBody()), ctx("role-1"));
    expect(res.status).toBe(200);
    const ops = committedTransactions()[0].ops as PatchOp[];
    expect(ops).toHaveLength(2);
    expect(ops[0]).toMatchObject({ id: "role-1", rev: "rev-1" });
    expect(ops[0].set._type).toBeUndefined();
    expect((ops[0].set.Lead as { _ref: string }[]).map((l) => l._ref)).toEqual(["mem-1", "mem-5"]);
    expect(ops[1]).toMatchObject({ id: "roleTarget.sunday_role.2026-08-09", rev: "lock-rev-1" });
  });

  it("answers with the REFRESHED stored read at the committed revision, not an echo", async () => {
    store.roles.push(role());
    store.locks.push(lock());
    // What the Content Lake holds once the transaction lands.
    onCommit = () => {
      store.roles = [
        role({
          _rev: "rev-2",
          Lead: [
            { _key: "k1", _type: "reference", _ref: "mem-1" },
            { _key: "k2", _type: "reference", _ref: "mem-5" },
          ],
        }),
      ];
    };

    const res = await rolePATCH(req(editBody()), ctx("role-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    // The COMMITTED revision, so the caller can keep editing without a refetch —
    // never the revision it observed before the write.
    expect(body._rev).toBe("rev-2");
    expect(body._rev).not.toBe("rev-1");
    expect(body._id).toBe("role-1");
    expect(body._type).toBe("sunday_role");
    expect(body.ok).toBe(true);
    // Seat content comes from storage, not from the request body.
    expect((body.Lead as { _ref: string }[]).map((l) => l._ref)).toEqual(["mem-1", "mem-5"]);
  });

  it("still reports the committed edit as success when the refresh read cannot resolve", async () => {
    store.roles.push(role());
    store.locks.push(lock());
    // The role is gone (or ambiguous) by the time the response is assembled: the
    // business transaction already committed, so this must NOT become a failure.
    onCommit = () => {
      store.roles = [];
    };

    const res = await rolePATCH(req(editBody()), ctx("role-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ _id: "role-1", _type: "sunday_role", date: "2026-08-09", ok: true });
    expect(body._rev).toBeUndefined();
    expect(committedTransactions()).toHaveLength(1);
  });

  it("never converts a stored document to another type", async () => {
    store.roles.push(role());
    store.locks.push(lock());
    const res = await rolePATCH(req(editBody({ _type: "special_role" })), ctx("role-1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("integrity_conflict");
    expect(transactions).toHaveLength(0);
  });

  it("hands the lock over atomically on a permitted date move", async () => {
    store.roles.push(role());
    store.locks.push(lock());
    const res = await rolePATCH(req(editBody({ date: "2026-08-16" })), ctx("role-1"));
    expect(res.status).toBe(200);
    const ops = committedTransactions()[0].ops;
    expect(ops).toHaveLength(3);
    const rolePatch = ops[0] as PatchOp;
    expect(rolePatch).toMatchObject({ id: "role-1", rev: "rev-1" });
    expect(rolePatch.set.week).toBe("2026-08-16");
    const vacate = ops[1] as PatchOp;
    expect(vacate).toMatchObject({ id: "roleTarget.sunday_role.2026-08-09", rev: "lock-rev-1" });
    expect(vacate.set.state).toBe("vacant");
    expect(vacate.set.generation).toBe(3);
    expect(vacate.unset).toEqual(["roleId", "claimNonce"]);
    const created = ops[2] as { kind: "create"; doc: Record<string, unknown> };
    expect(created.kind).toBe("create");
    expect(created.doc._id).toBe("roleTarget.sunday_role.2026-08-16");
    expect(created.doc.roleId).toBe("role-1");
  });

  it("refuses a date move whose destination carries dependent history", async () => {
    store.roles.push(role());
    store.locks.push(lock());
    store.setlists.push({ _id: "sl-dest", _type: "featuredSongs", week: "2026-08-16", songs: [] });
    const res = await rolePATCH(req(editBody({ date: "2026-08-16" })), ctx("role-1"));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("role_date_has_dependencies");
    expect(body.details.dependencies.map((d: { id: string }) => d.id)).toContain("sl-dest");
    expect(transactions).toHaveLength(0);
  });

  it("refuses a date move onto an occupied destination target", async () => {
    store.roles.push(role(), role({ _id: "role-2", _rev: "r2", week: "2026-08-16" }));
    store.locks.push(lock());
    const res = await rolePATCH(req(editBody({ date: "2026-08-16" })), ctx("role-1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("ambiguous_target");
    expect(transactions).toHaveLength(0);
  });

  it("refuses a lock owned by another role and never reclaims it", async () => {
    store.roles.push(role());
    store.locks.push(lock({ roleId: "role-other" }));
    const res = await rolePATCH(req(editBody()), ctx("role-1"));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("integrity_conflict");
    expect(body.details.detail).toBe("lock_wrong_owner");
    expect(transactions).toHaveLength(0);
  });

  it("refuses when a raw draft overlay exists for the role id", async () => {
    store.roles.push(role());
    store.locks.push(lock());
    store.rawRoleDrafts.push({ _id: "drafts.role-1", _type: "sunday_role", week: "2026-08-09" });
    const res = await rolePATCH(req(editBody()), ctx("role-1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("integrity_conflict");
    expect(transactions).toHaveLength(0);
  });

  it("notifies only newly added assignees, and stays silent for a draft", async () => {
    store.roles.push(role({ published: true }));
    store.locks.push(lock());
    await rolePATCH(req(editBody()), ctx("role-1"));
    expect(afterCallbacks).toHaveLength(1);
    await afterCallbacks[0]();
    expect(sendPushMock).toHaveBeenCalledWith(["mem-5"], "assignments", expect.anything());

    afterCallbacks.length = 0;
    store = emptyStore();
    store.roles.push(role({ published: false }));
    store.locks.push(lock());
    await rolePATCH(req(editBody()), ctx("role-1"));
    expect(afterCallbacks).toHaveLength(0);
  });

  it("bootstraps a legacy weekend role with no lock, then applies the edit", async () => {
    store.roles.push(role({ _rev: "rev-legacy" }));
    // The refetch after the maintenance commit sees the advanced revision + lock.
    let roleReads = 0;
    operationalFetch.mockImplementation(async (q: string, p: Record<string, unknown> = {}) => {
      if (q.includes("roleTargetLock")) {
        return store.locks.length ? canonicalRead(q, p) : [];
      }
      if (q.includes("_id == $id") && !q.includes("roleCreationReceipt")) {
        roleReads++;
        if (roleReads > 1) {
          store.locks.push(lock({ _rev: "lock-rev-boot" }));
          return [role({ _rev: "rev-after-boot" })];
        }
        return [role({ _rev: "rev-legacy" })];
      }
      return canonicalRead(q, p);
    });
    const res = await rolePATCH(req(editBody({ rev: "rev-legacy" })), ctx("role-1"));
    expect(res.status).toBe(200);
    expect(committedTransactions()).toHaveLength(2);
    // 1) maintenance: revision-guarded heartbeat of the unchanged target field
    //    plus the created lock.
    const boot = committedTransactions()[0].ops;
    expect(boot[0]).toMatchObject({ kind: "patch", id: "role-1", rev: "rev-legacy" });
    expect((boot[0] as PatchOp).set.week).toBe("2026-08-09");
    expect(boot[1]).toMatchObject({ kind: "create" });
    // 2) business: continues ONLY from the produced revisions.
    const business = committedTransactions()[1].ops as PatchOp[];
    expect(business[0]).toMatchObject({ id: "role-1", rev: "rev-after-boot" });
    expect(business[1]).toMatchObject({ id: "roleTarget.sunday_role.2026-08-09", rev: "lock-rev-boot" });
  });

  it("reports bootstrap_completed_reload when the business write then conflicts", async () => {
    store.roles.push(role({ _rev: "rev-legacy" }));
    let roleReads = 0;
    operationalFetch.mockImplementation(async (q: string, p: Record<string, unknown> = {}) => {
      if (q.includes("roleTargetLock")) return store.locks.length ? canonicalRead(q, p) : [];
      if (q.includes("_id == $id") && !q.includes("roleCreationReceipt")) {
        roleReads++;
        if (roleReads > 1) {
          store.locks.push(lock({ _rev: "lock-rev-boot" }));
          return [role({ _rev: "rev-after-boot" })];
        }
        return [role({ _rev: "rev-legacy" })];
      }
      return canonicalRead(q, p);
    });
    // First commit (maintenance) succeeds; the business commit conflicts.
    commitOutcomes.push(undefined, conflictError("documentRevisionIDDoesNotMatchError", "role-1"));
    const res = await rolePATCH(req(editBody({ rev: "rev-legacy" })), ctx("role-1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("bootstrap_completed_reload");
    // The maintenance lock/revision intentionally persist; no business state did.
    expect(committedTransactions()).toHaveLength(1);
    expect(revalidateServiceViewsMock).not.toHaveBeenCalled();
    expect(afterCallbacks).toHaveLength(0);
  });
});

// ── Delete ──────────────────────────────────────────────────────────────────

describe("DELETE /api/admin/roles/[id]", () => {
  it("requires the client-observed revision", async () => {
    store.roles.push(role());
    const res = await roleDELETE(req({}), ctx("role-1"));
    expect(res.status).toBe(400);
    expect(transactions).toHaveLength(0);
  });

  it("refuses a role with dependent proposal history, before any maintenance", async () => {
    store.roles.push(role());
    store.proposals.push(proposal());
    const res = await roleDELETE(req({ rev: "rev-1" }), ctx("role-1"));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("role_has_dependencies");
    expect(body.details.dependencies[0].id).toBe("prop-1");
    expect(transactions).toHaveLength(0);
  });

  it("vacates its own lock, retires its receipt, and deletes the role atomically", async () => {
    store.roles.push(role({ creationReceiptId: RECEIPT_ID }));
    store.locks.push(lock());
    store.receipts.push(receipt());
    const res = await roleDELETE(req({ rev: "rev-1" }), ctx("role-1"));
    expect(res.status).toBe(200);
    expect(committedTransactions()).toHaveLength(1);
    const ops = committedTransactions()[0].ops;
    const vacate = ops.find((o) => o.kind === "patch" && o.id.startsWith("roleTarget")) as PatchOp;
    expect(vacate).toMatchObject({ rev: "lock-rev-1" });
    expect(vacate.set.state).toBe("vacant");
    expect(vacate.set.generation).toBe(3);
    expect(vacate.unset).toEqual(["roleId", "claimNonce"]);
    const retire = ops.find((o) => o.kind === "patch" && o.id === RECEIPT_ID) as PatchOp;
    expect(retire).toMatchObject({ rev: "receipt-rev-1" });
    expect(retire.set.state).toBe("role_deleted");
    const guard = ops.find((o) => o.kind === "patch" && o.id === "role-1") as PatchOp;
    expect(guard.rev).toBe("rev-1");
    expect(ops.at(-1)).toEqual({ kind: "delete", id: "role-1" });
    expect(revalidateServiceViewsMock).toHaveBeenCalled();
  });

  it("never vacates a lock owned by another role", async () => {
    store.roles.push(role());
    store.locks.push(lock({ roleId: "role-other" }));
    const res = await roleDELETE(req({ rev: "rev-1" }), ctx("role-1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("integrity_conflict");
    expect(transactions).toHaveLength(0);
  });

  it("deletes a legacy special role with no receipt and no lock", async () => {
    store.roles.push(
      role({ _id: "role-sp", _type: "special_role", week: undefined, date: "2026-08-09", service_name: "X" }),
    );
    const res = await roleDELETE(req({ rev: "rev-1" }), ctx("role-sp"));
    expect(res.status).toBe(200);
    const ops = committedTransactions()[0].ops;
    expect(ops).toHaveLength(2);
    expect((ops[0] as PatchOp).set.date).toBe("2026-08-09");
    expect(ops[1]).toEqual({ kind: "delete", id: "role-sp" });
  });

  it("treats a special role's embedded songs as a dependency", async () => {
    store.roles.push(
      role({
        _id: "role-sp",
        _type: "special_role",
        week: undefined,
        date: "2026-08-09",
        songs: [{ _key: "s1", play_key: "G", song: { _ref: "post-1" } }],
      }),
    );
    const res = await roleDELETE(req({ rev: "rev-1" }), ctx("role-sp"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("role_has_dependencies");
    expect(transactions).toHaveLength(0);
  });

  it("refuses when another role's receipt claims this role id", async () => {
    store.roles.push(role());
    store.locks.push(lock());
    store.receipts.push(receipt(), receipt({ _id: "roleCreate.other" }));
    const res = await roleDELETE(req({ rev: "rev-1" }), ctx("role-1"));
    expect(res.status).toBe(409);
    expect((await res.json()).details.detail).toBe("multiple_receipts");
    expect(transactions).toHaveLength(0);
  });
});

// ── Publish ─────────────────────────────────────────────────────────────────

describe("POST /api/admin/roles/publish", () => {
  it("rejects anything but the exact contract", async () => {
    for (const body of [
      { ids: ["role-1"], published: true },
      { roles: [{ id: "role-1", rev: "rev-1" }] },
      { roles: [], published: true },
      { roles: [{ id: "drafts.role-1", rev: "rev-1" }], published: true },
      { roles: [{ id: "role-1", rev: "a" }, { id: "role-1", rev: "b" }], published: true },
    ]) {
      const res = await publishPOST(req(body));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(transactions).toHaveLength(0);
  });

  it("publishes a batch atomically and notifies only false -> true transitions", async () => {
    store.roles.push(
      role({ _id: "role-1", _rev: "r1", published: false }),
      role({ _id: "role-2", _rev: "r2", week: "2026-08-16", published: undefined }),
      role({
        _id: "role-3",
        _rev: "r3",
        week: "2026-08-23",
        published: false,
        Lead: [{ _key: "k9", _type: "reference", _ref: "mem-9" }],
      }),
    );
    store.locks.push(
      lock({ roleId: "role-1" }),
      lock({
        _id: "roleTarget.sunday_role.2026-08-16",
        targetKey: "sunday_role:2026-08-16",
        date: "2026-08-16",
        roleId: "role-2",
        _rev: "lock-rev-2",
      }),
      lock({
        _id: "roleTarget.sunday_role.2026-08-23",
        targetKey: "sunday_role:2026-08-23",
        date: "2026-08-23",
        roleId: "role-3",
        _rev: "lock-rev-3",
      }),
    );
    const res = await publishPOST(
      req({
        roles: [
          { id: "role-1", rev: "r1" },
          { id: "role-2", rev: "r2" },
          { id: "role-3", rev: "r3" },
        ],
        published: true,
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, published: 2, unpublished: 0 });
    expect(committedTransactions()).toHaveLength(1);
    const ops = committedTransactions()[0].ops as PatchOp[];
    // role-2 has no `published` field: grandfathered published, so not patched.
    const rolePatches = ops.filter((o) => !o.id.startsWith("roleTarget"));
    expect(rolePatches.map((o) => o.id)).toEqual(["role-1", "role-3"]);
    expect(rolePatches[0]).toMatchObject({ rev: "r1", set: { published: true } });
    // Every involved coordination token is heartbeated under its own revision.
    const lockPatches = ops.filter((o) => o.id.startsWith("roleTarget"));
    expect(lockPatches.map((o) => o.rev).sort()).toEqual(["lock-rev-1", "lock-rev-2", "lock-rev-3"]);

    await afterCallbacks[0]();
    expect(sendPushMock).toHaveBeenCalledTimes(2);
    expect(sendPushMock.mock.calls[1][0]).toEqual(["mem-9"]);
    expect(sendAssignmentEmailsBatchMock).toHaveBeenCalledTimes(1);
  });

  it("unpublishes without notifying", async () => {
    store.roles.push(role({ published: true }));
    store.locks.push(lock());
    const res = await publishPOST(req({ roles: [{ id: "role-1", rev: "rev-1" }], published: false }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ published: 0, unpublished: 1 });
    expect(afterCallbacks).toHaveLength(0);
  });

  it("rejects the WHOLE batch for one stale entry", async () => {
    store.roles.push(role({ _id: "role-1", _rev: "r1" }), role({ _id: "role-2", _rev: "moved", week: "2026-08-16" }));
    store.locks.push(lock({ roleId: "role-1" }));
    const res = await publishPOST(
      req({ roles: [{ id: "role-1", rev: "r1" }, { id: "role-2", rev: "r2" }], published: true }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("stale_revision");
    expect(transactions).toHaveLength(0);
  });

  it("rejects the WHOLE batch for one missing entry", async () => {
    store.roles.push(role({ _id: "role-1", _rev: "r1" }));
    const res = await publishPOST(
      req({ roles: [{ id: "role-1", rev: "r1" }, { id: "role-nope", rev: "r2" }], published: true }),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("ambiguous_target");
    expect(body.details.issues).toContain("missing:role-nope");
    expect(transactions).toHaveLength(0);
  });

  it("rejects the WHOLE batch when any entry has a raw draft overlay", async () => {
    store.roles.push(role({ _id: "role-1", _rev: "r1" }));
    store.rawRoleDrafts.push({ _id: "drafts.role-1", _type: "sunday_role", week: "2026-08-09" });
    const res = await publishPOST(req({ roles: [{ id: "role-1", rev: "r1" }], published: true }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("integrity_conflict");
    expect(transactions).toHaveLength(0);
  });

  it("rejects the WHOLE batch when a coordination token has the wrong owner", async () => {
    store.roles.push(role({ _id: "role-1", _rev: "r1" }));
    store.locks.push(lock({ roleId: "role-other" }));
    const res = await publishPOST(req({ roles: [{ id: "role-1", rev: "r1" }], published: true }));
    expect(res.status).toBe(409);
    expect((await res.json()).details.detail).toBe("lock_wrong_owner");
    expect(transactions).toHaveLength(0);
  });

  it("revalidates ONCE per affected batch, not once per role (§7)", async () => {
    store.roles.push(
      role({ _id: "role-1", _rev: "r1", published: false }),
      role({ _id: "role-3", _rev: "r3", week: "2026-08-23", published: false }),
    );
    store.locks.push(
      lock({ roleId: "role-1" }),
      lock({
        _id: "roleTarget.sunday_role.2026-08-23",
        targetKey: "sunday_role:2026-08-23",
        date: "2026-08-23",
        roleId: "role-3",
        _rev: "lock-rev-3",
      }),
    );
    const res = await publishPOST(
      req({ roles: [{ id: "role-1", rev: "r1" }, { id: "role-3", rev: "r3" }], published: true }),
    );
    expect(res.status).toBe(200);
    // Exactly one revalidation pass for the whole batch.
    expect(revalidatePathMock.mock.calls.map((c) => c[0])).toEqual(["/", "/schedule", "/me"]);
  });

  it("swallows a thrown notification without failing the committed batch (§7)", async () => {
    store.roles.push(role({ _id: "role-1", _rev: "r1", published: false }));
    store.locks.push(lock({ roleId: "role-1" }));
    sendPushMock.mockRejectedValue(new Error("fcm down"));
    sendAssignmentEmailsBatchMock.mockRejectedValue(new Error("smtp down"));
    const res = await publishPOST(req({ roles: [{ id: "role-1", rev: "r1" }], published: true }));
    expect(res.status).toBe(200);
    expect(committedTransactions()).toHaveLength(1);
    // The deferred delivery attempt resolves rather than rejecting into the
    // platform, and the committed publish is never rolled back.
    await expect(afterCallbacks[0]()).resolves.toBeUndefined();
    expect(committedTransactions()).toHaveLength(1);
  });

  it("refuses a stale batch commit without notifying", async () => {
    store.roles.push(role({ _id: "role-1", _rev: "r1", published: false }));
    store.locks.push(lock({ roleId: "role-1" }));
    commitOutcomes.push(conflictError("documentRevisionIDDoesNotMatchError", "role-1"));
    const res = await publishPOST(req({ roles: [{ id: "role-1", rev: "r1" }], published: true }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("stale_revision");
    expect(committedTransactions()).toHaveLength(0);
    expect(afterCallbacks).toHaveLength(0);
  });
});
