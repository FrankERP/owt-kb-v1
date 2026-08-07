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
const serverFetch = vi.fn();
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
  serverClient: { fetch: (...a: unknown[]) => serverFetch(...a) },
  writeClient: { transaction: () => makeTransaction() },
}));

vi.mock("@/app/utils/revalidate", () => ({
  revalidateServiceViews: (...a: unknown[]) => revalidateServiceViewsMock(...a),
}));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePathMock(...a) }));
vi.mock("@/app/utils/push", () => ({ sendPush: (...a: unknown[]) => sendPushMock(...a) }));
// PARTIAL: the send paths are spied, but `rolesForMember` stays real — it is the
// seat-label vocabulary the queued outbox snapshot records.
vi.mock("@/app/utils/email", () => ({ sendEmail: vi.fn(), SEND_CONCURRENCY: 8 }));
vi.mock("@/app/utils/assignmentEmail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/utils/assignmentEmail")>()),
  sendAssignmentEmails: (...a: unknown[]) => sendAssignmentEmailsMock(...a),
  sendAssignmentEmailsBatch: (...a: unknown[]) => sendAssignmentEmailsBatchMock(...a),
  assigneesOf: () => [],
}));
vi.mock("next/server", async (importOriginal) => {
  const mod = await importOriginal<typeof import("next/server")>();
  return { ...mod, after: (fn: () => unknown) => void afterCallbacks.push(fn) };
});

import { payloadFingerprint, receiptIdForRequestId } from "@/app/utils/roleCreationReceipt";
import { GET as membersGET } from "@/app/api/admin/members/route";
import { GET as rolesGET, POST as createPOST } from "@/app/api/admin/roles/route";
import { PATCH as rolePATCH, DELETE as roleDELETE } from "@/app/api/admin/roles/[id]/route";
import { POST as publishPOST } from "@/app/api/admin/roles/publish/route";
import type { RoleDomainSummary, RoleTarget } from "@/app/utils/serviceReadSummary";
import {
  buildStoredGridRows,
  joinStoredRoleInventory,
  translateStoredRole,
} from "@/app/components/admin/storedRoleReadModel";
import { serializeStoredColumn } from "@/app/components/admin/plannerSaveModel";

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
  | { kind: "createIfNotExists"; doc: Record<string, unknown> }
  | { kind: "delete"; id: string };

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
    createIfNotExists(doc: Record<string, unknown>) {
      record.ops.push({ kind: "createIfNotExists", doc });
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

/**
 * The BUSINESS transactions. The post-commit outbox upsert runs on the same
 * `writeClient`, but never as part of the business transaction (spec §2) — it is
 * the only writer here that uses `createIfNotExists`, so the two are told apart
 * by shape rather than by call order.
 */
function committedTransactions() {
  return transactions.filter(
    (t) => t.committed && !t.ops.some((o) => o.kind === "createIfNotExists"),
  );
}

/** The post-commit `notificationOutbox` upserts (spec §2). */
function outboxUpserts(): Record<string, unknown>[] {
  return transactions
    .filter((t) => t.committed)
    .flatMap((t) => t.ops)
    .filter((o): o is { kind: "createIfNotExists"; doc: Record<string, unknown> } =>
      o.kind === "createIfNotExists",
    )
    .map((o) => o.doc);
}

/** Member ids the outbox now owes a debounced email, in queue order. */
function queuedMemberIds(): unknown[] {
  return outboxUpserts().map((d) => d.memberId);
}

// ── In-memory store, dispatched off the bound GROQ ──────────────────────────

interface Store {
  members: Record<string, unknown>[];
  coordinators: Record<string, unknown>[];
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
    members: [],
    coordinators: [],
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
  if (query.includes('_type == "teamMembers"')) {
    if (Array.isArray(params.ids)) {
      return store.members.filter((member) => (params.ids as string[]).includes(member._id as string));
    }
    return store.members;
  }
  if (query.includes('_type == "specialIdentityCoordinator"')) {
    return store.coordinators.filter((coordinator) => coordinator._id === params.id);
  }
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

function coordinator(over: Record<string, unknown> = {}) {
  return {
    _id: "specialIdentityCoordinator.global",
    _rev: "coord-rev-1",
    _type: "specialIdentityCoordinator",
    version: 1,
    claimNonce: "coord-nonce-1",
    updatedAt: "2026-08-04T18:00:00.000Z",
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

/**
 * Run every registered `after()` callback. A committed write now registers more
 * than one — the immediate push fan-out and the post-commit outbox upsert are
 * deliberately separate deferred blocks (spec §2), so indexing `afterCallbacks[0]`
 * would silently skip whichever ran second.
 */
async function drainAfter(): Promise<void> {
  for (let guard = 0; guard < 10 && afterCallbacks.length; guard++) {
    const batch = afterCallbacks.splice(0);
    for (const cb of batch) await cb();
  }
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
  store.members.push(
    { _id: "mem-1", member_name: "Uno", memberType: ["vocals"] },
    { _id: "mem-2", member_name: "Dos", memberType: ["instruments"] },
    { _id: "mem-5", member_name: "Cinco", memberType: ["foh"] },
  );
  requireActiveManagerMock.mockResolvedValue(ADMIN);
  operationalFetch.mockImplementation(async (q: string, p: Record<string, unknown> = {}) =>
    canonicalRead(q, p),
  );
  rawFetch.mockImplementation(async (q: string, p: Record<string, unknown> = {}) => rawRead(q, p));
});

describe("GET /api/admin/members — canonical candidates", () => {
  it("keeps auth, projection, and order while reading the published operational perspective", async () => {
    const res = await membersGET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(store.members);
    expect(serverFetch).not.toHaveBeenCalled();
    expect(rawFetch).not.toHaveBeenCalled();
    expect(operationalFetch).toHaveBeenCalledOnce();
    const query = operationalFetch.mock.calls[0][0] as string;
    expect(query).toContain('*[_type == "teamMembers"] | order(member_name asc)');
    expect(query).toContain("_id, member_name, alias, email, role, memberType, notifPrefs");
    expect(query).toContain('"hasPassword": defined(passwordHash) && passwordHash != ""');
  });

  it("still denies content-editors before reading candidates", async () => {
    requireActiveManagerMock.mockResolvedValue({ user: { role: "content-editor" } });

    expect((await membersGET()).status).toBe(403);
    expect(operationalFetch).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/roles — stored editor projection", () => {
  it("requests a grandfathered boolean projection for a missing legacy publication flag", async () => {
    operationalFetch.mockResolvedValueOnce([]);
    expect((await rolesGET()).status).toBe(200);

    const query = operationalFetch.mock.calls[0][0] as string;
    expect(query).toContain('"published": coalesce(published, true)');
  });
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

  it.each([
    ["Lead", { leads: ["missing-lead"] }, "missing-lead"],
    ["BGVs", { bgvs: ["missing-bgvs"] }, "missing-bgvs"],
    ["Chorus", { chorus: ["missing-chorus"] }, "missing-chorus"],
    [
      "instruments",
      { instruments: [{ instrument: "Piano", personId: "missing-instrument" }] },
      "missing-instrument",
    ],
    ["foh_team", { foh: [{ role: "Audio", personId: "missing-foh" }] }, "missing-foh"],
  ])("refuses an unresolved %s assignee before occupancy or writes", async (_field, over, missing) => {
    const res = await createPOST(req(createBody(over)));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: "integrity_conflict",
      details: { danglingRefs: [missing] },
    });
    expect(transactions).toHaveLength(0);
    expect(afterCallbacks).toHaveLength(0);
    expect(revalidateServiceViewsMock).not.toHaveBeenCalled();
    const queries = operationalFetch.mock.calls.map(([query]) => query as string);
    expect(queries.filter((query) => query.includes('_type == "teamMembers"'))).toHaveLength(1);
    expect(queries.some((query) => query.includes("week == $week"))).toBe(false);
  });

  it("reports one sorted missing set after de-duplicating all five submitted paths", async () => {
    const res = await createPOST(
      req(
        createBody({
          leads: ["missing-z", "mem-1"],
          bgvs: ["missing-b", "missing-z"],
          chorus: ["missing-c"],
          instruments: [
            { instrument: "Piano", personId: "missing-a" },
            { instrument: "Bajo", personId: "missing-b" },
          ],
          foh: [{ role: "Audio", personId: "missing-d" }],
        }),
      ),
    );

    expect((await res.json()).details.danglingRefs).toEqual([
      "missing-a",
      "missing-b",
      "missing-c",
      "missing-d",
      "missing-z",
    ]);
    const memberCall = operationalFetch.mock.calls.find(([query]) =>
      (query as string).includes('_type == "teamMembers"'),
    );
    expect(memberCall?.[1].ids).toEqual([
      "missing-z",
      "mem-1",
      "missing-b",
      "missing-c",
      "missing-a",
      "missing-d",
    ]);
    expect(transactions).toHaveLength(0);
  });

  it("accepts a canonical member even when memberType would not suggest the submitted seat", async () => {
    const res = await createPOST(
      req(createBody({ leads: ["mem-5"], instruments: [], creationRequestId: "req-types-00000001" })),
    );

    expect(res.status).toBe(201);
    expect(committedTransactions()).toHaveLength(1);
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

  it("pushes to every initial assignee and QUEUES their notices, only when published", async () => {
    await createPOST(req(createBody({ published: true, leads: ["mem-1"] })));
    // Two deferred blocks: the immediate push fan-out, then the outbox upsert.
    expect(afterCallbacks).toHaveLength(2);
    await drainAfter();
    expect(sendPushMock).toHaveBeenCalledWith(["mem-1", "mem-2"], "assignments", expect.anything());
    // The immediate assignment email is gone — the outbox absorbed it (§7).
    expect(sendAssignmentEmailsMock).not.toHaveBeenCalled();
    // …and every initial assignee is owed a debounced one instead.
    expect(queuedMemberIds()).toEqual(["mem-1", "mem-2"]);
    expect(outboxUpserts()[0]).toMatchObject({
      _type: "notificationOutbox",
      kind: "role",
      roleType: "sunday_role",
      serviceDate: "2026-08-09",
      before: { beforeRoles: [] },
    });

    afterCallbacks.length = 0;
    transactions.length = 0;
    store = emptyStore();
    await createPOST(req(createBody({ creationRequestId: "req-sunday-00000009" })));
    expect(afterCallbacks).toHaveLength(0);
    expect(outboxUpserts()).toHaveLength(0);
  });

  it("swallows a thrown notification without failing the committed create (§7)", async () => {
    sendPushMock.mockRejectedValue(new Error("fcm down"));
    const res = await createPOST(req(createBody({ published: true })));
    expect(res.status).toBe(201);
    expect(committedTransactions()).toHaveLength(1);
    await expect(drainAfter()).resolves.toBeUndefined();
    // The channel was still attempted, and the create stands.
    expect(sendPushMock).toHaveBeenCalledTimes(1);
    expect(committedTransactions()).toHaveLength(1);
  });

  it("commits the outbox upsert OUTSIDE the business transaction (§2)", async () => {
    await createPOST(req(createBody({ published: true })));
    // The business transaction is committed and closed before anything queues.
    expect(committedTransactions()).toHaveLength(1);
    expect(outboxUpserts()).toHaveLength(0);
    await drainAfter();
    expect(committedTransactions()).toHaveLength(1);
    expect(outboxUpserts()).toHaveLength(2);
    // No outbox op ever landed in the transaction that wrote the content.
    expect(committedTransactions()[0].ops.some((o) => o.kind === "createIfNotExists")).toBe(false);
  });

  it("creates a special role with NO weekend lock", async () => {
    const res = await createPOST(
      req(createBody({ _type: "special_role", service_name: "Bautizos", creationRequestId: "req-special-0000001" })),
    );
    expect(res.status).toBe(201);
    const ops = committedTransactions()[0].ops;
    expect(ops).toHaveLength(3);
    expect(ops.some((o) => o.kind === "create" && o.doc._type === "roleTargetLock")).toBe(false);
    expect(ops).toContainEqual({
      kind: "create",
      doc: expect.objectContaining({
        _id: "specialIdentityCoordinator.global",
        _type: "specialIdentityCoordinator",
        version: 1,
      }),
    });
    const roleDoc = (ops.find((o) => o.kind === "create" && o.doc._type === "special_role") as {
      doc: Record<string, unknown>;
    }).doc;
    expect(roleDoc.date).toBe("2026-08-09");
    expect(roleDoc.service_name).toBe("Bautizos");
    expect(roleDoc.week).toBeUndefined();
  });

  it("advances an existing special identity coordinator in the create transaction", async () => {
    store.coordinators.push(coordinator({ _rev: "coord-rev-7", version: 7 }));

    const res = await createPOST(
      req(
        createBody({
          _type: "special_role",
          service_name: "Bautizos",
          creationRequestId: "req-special-0000002",
        }),
      ),
    );

    expect(res.status).toBe(201);
    const coordPatch = committedTransactions()[0].ops.find(
      (op) => op.kind === "patch" && op.id === "specialIdentityCoordinator.global",
    ) as PatchOp;
    expect(coordPatch).toMatchObject({ rev: "coord-rev-7", set: { version: 8 } });
    expect(coordPatch.set.claimNonce).not.toBe("coord-nonce-1");
  });

  it.each([
    ["matching", "  Bautizos\n", 409, "integrity_conflict"],
    ["different-name", "Vigilia", 201, null],
    ["case-distinct", "bautizos", 201, null],
  ])(
    "%s same-date raw special evidence is filtered by normalized identity",
    async (_case, rawName, status, error) => {
      store.rawRoleDrafts.push({
        _id: "drafts.role-other",
        _type: "special_role",
        date: "2026-08-09",
        service_name: rawName,
      });

      const res = await createPOST(
        req(
          createBody({
            _type: "special_role",
            service_name: "Bautizos",
            creationRequestId: `req-special-${_case}-1`,
          }),
        ),
      );

      expect(res.status).toBe(status);
      if (error) expect((await res.json()).error).toBe(error);
      expect(committedTransactions()).toHaveLength(status === 201 ? 1 : 0);
    },
  );

  it.each([
    ["same normalized identity", " Bautizos ", 409],
    ["different name", "Vigilia", 201],
    ["case-distinct name", "bautizos", 201],
  ])("classifies a %s canonical special on the create date", async (_case, storedName, status) => {
    store.roles.push(
      role({
        _id: "role-existing-special",
        _rev: "existing-rev",
        _type: "special_role",
        week: undefined,
        date: "2026-08-09",
        service_name: storedName,
      }),
    );

    const res = await createPOST(
      req(
        createBody({
          _type: "special_role",
          service_name: "Bautizos",
          creationRequestId: `req-special-canonical-${status}`,
        }),
      ),
    );

    expect(res.status).toBe(status);
    expect(committedTransactions()).toHaveLength(status === 201 ? 1 : 0);
  });

  it("reconciles a special coordinator conflict without retrying the business transaction", async () => {
    let coordinatorReads = 0;
    operationalFetch.mockImplementation(async (q: string, p: Record<string, unknown> = {}) => {
      if (q.includes('_type == "specialIdentityCoordinator"')) {
        coordinatorReads++;
        return [
          coordinator({
            _rev: coordinatorReads > 1 ? "coord-rev-2" : "coord-rev-1",
            version: coordinatorReads > 1 ? 2 : 1,
          }),
        ];
      }
      return canonicalRead(q, p);
    });
    commitOutcomes.push(conflictError("documentRevisionIDDoesNotMatchError", "coord"));

    const res = await createPOST(
      req(
        createBody({
          _type: "special_role",
          service_name: "Bautizos",
          creationRequestId: "req-special-conflict-1",
        }),
      ),
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: "stale_revision",
      details: { coordinatorRev: "coord-rev-2", coordinatorVersion: 2 },
    });
    expect(coordinatorReads).toBe(2);
    expect(transactions).toHaveLength(1);
    expect(committedTransactions()).toHaveLength(0);
  });

  it("checks a racing special receipt before occupancy or coordinator reconciliation", async () => {
    const requestId = "req-special-receipt-race";
    const body = createBody({
      _type: "special_role",
      service_name: "Bautizos",
      creationRequestId: requestId,
    });
    const receiptId = receiptIdForRequestId(requestId) as string;
    const fingerprint = payloadFingerprint(body);
    let coordinatorReads = 0;
    let occupancyReads = 0;
    operationalFetch.mockImplementation(async (q: string, p: Record<string, unknown> = {}) => {
      if (q.includes('_type == "specialIdentityCoordinator"')) coordinatorReads++;
      if (q.includes('_type == "special_role" && date == $date')) occupancyReads++;
      return canonicalRead(q, p);
    });
    commitOutcomes.push(conflictError());
    lateReceipts.push(
      receipt({
        _id: receiptId,
        requestId,
        fingerprint,
        roleId: "role-special-winner",
        roleType: "special_role",
        targetIdentity: "special_role:2026-08-09:Bautizos",
      }),
    );
    lateRoles.push(
      role({
        _id: "role-special-winner",
        _type: "special_role",
        week: undefined,
        date: "2026-08-09",
        service_name: "Bautizos",
        creationReceiptId: receiptId,
        creationFingerprint: fingerprint,
      }),
    );

    const res = await createPOST(req(body));

    expect(res.status).toBe(200);
    expect((await res.json()).replay).toBe(true);
    expect(coordinatorReads).toBe(1);
    expect(occupancyReads).toBe(1);
    expect(transactions).toHaveLength(1);
    expect(committedTransactions()).toHaveLength(0);
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
    expect(
      operationalFetch.mock.calls.some(([query]) =>
        (query as string).includes('_type == "teamMembers"'),
      ),
    ).toBe(false);
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

  function specialRole(over: Record<string, unknown> = {}) {
    return role({
      _id: "role-sp",
      _type: "special_role",
      week: undefined,
      date: "2026-08-09",
      service_name: "Bautizos",
      ...over,
    });
  }

  function specialEditBody(over: Record<string, unknown> = {}) {
    return editBody({ _type: "special_role", service_name: "Bautizos", ...over });
  }

  it("requires the client-observed revision", async () => {
    store.roles.push(role());
    const res = await rolePATCH(req(editBody({ rev: undefined })), ctx("role-1"));
    expect(res.status).toBe(400);
    expect(transactions).toHaveLength(0);
  });

  it.each([
    ["Lead", { leads: ["missing-lead"] }, "missing-lead"],
    ["BGVs", { bgvs: ["missing-bgvs"] }, "missing-bgvs"],
    ["Chorus", { chorus: ["missing-chorus"] }, "missing-chorus"],
    [
      "instruments",
      { instruments: [{ instrument: "Piano", personId: "missing-instrument" }] },
      "missing-instrument",
    ],
    ["foh_team", { foh: [{ role: "Audio", personId: "missing-foh" }] }, "missing-foh"],
  ])("refuses an unresolved %s assignee before legacy bootstrap or writes", async (_field, over, missing) => {
    store.roles.push(role());

    const res = await rolePATCH(req(editBody(over)), ctx("role-1"));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: "integrity_conflict",
      details: { danglingRefs: [missing] },
    });
    expect(transactions).toHaveLength(0);
    expect(afterCallbacks).toHaveLength(0);
    expect(revalidateServiceViewsMock).not.toHaveBeenCalled();
    expect(operationalFetch).toHaveBeenCalledOnce();
    expect(operationalFetch.mock.calls[0][0]).toContain('_type == "teamMembers"');
  });

  it("returns PATCH missing member ids in sorted order", async () => {
    store.roles.push(role());
    const res = await rolePATCH(
      req(editBody({ leads: ["missing-z"], chorus: ["missing-a"] })),
      ctx("role-1"),
    );

    expect((await res.json()).details.danglingRefs).toEqual(["missing-a", "missing-z"]);
    expect(transactions).toHaveLength(0);
  });

  it("rejects a normalized-empty name from the stored special type even when _type is omitted", async () => {
    store.roles.push(
      role({
        _id: "role-sp",
        _type: "special_role",
        week: undefined,
        date: "2026-08-09",
        service_name: "Bautizos",
      }),
    );

    const res = await rolePATCH(
      req(editBody({ _type: undefined, service_name: "  \n  " })),
      ctx("role-sp"),
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: "integrity_conflict",
      details: { id: "role-sp", storedType: "special_role", issues: ["service_name"] },
    });
    expect(transactions).toHaveLength(0);
    expect(afterCallbacks).toHaveLength(0);
    expect(revalidateServiceViewsMock).not.toHaveBeenCalled();
  });

  it("checks normalized occupancy on a roster-only special PATCH without claiming the coordinator", async () => {
    store.roles.push(specialRole());
    store.coordinators.push(coordinator());

    const res = await rolePATCH(
      req(specialEditBody({ leads: ["mem-5"], service_name: " Bautizos\n" })),
      ctx("role-sp"),
    );

    expect(res.status).toBe(200);
    expect(committedTransactions()).toHaveLength(1);
    expect(committedTransactions()[0].ops).toHaveLength(1);
    expect(
      committedTransactions()[0].ops.some(
        (op) => op.kind === "patch" && op.id === "specialIdentityCoordinator.global",
      ),
    ).toBe(false);
    expect(
      operationalFetch.mock.calls.some(([query]) =>
        (query as string).includes('_type == "special_role" && date == $date'),
      ),
    ).toBe(true);
    expect(
      operationalFetch.mock.calls.some(([query]) =>
        (query as string).includes('_type == "specialIdentityCoordinator"'),
      ),
    ).toBe(false);
  });

  it("refuses normalized-identical canonical occupancy on a roster-only special PATCH", async () => {
    store.roles.push(
      specialRole(),
      specialRole({ _id: "role-other", _rev: "rev-other", service_name: "Bautizos" }),
    );

    const res = await rolePATCH(req(specialEditBody()), ctx("role-sp"));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: "ambiguous_target",
      details: { roleIds: ["role-other"] },
    });
    expect(transactions).toHaveLength(0);
  });

  it("allows a differently named canonical special on the same date", async () => {
    store.roles.push(
      specialRole(),
      specialRole({ _id: "role-other", _rev: "rev-other", service_name: "Vigilia" }),
    );

    expect((await rolePATCH(req(specialEditBody()), ctx("role-sp"))).status).toBe(200);
    expect(committedTransactions()).toHaveLength(1);
  });

  it.each([
    ["matching other draft", "drafts.role-other", " Bautizos\n", 409],
    ["different other draft", "drafts.role-other", "Vigilia", 200],
    ["same-role overlay with another name", "drafts.role-sp", "Vigilia", 409],
  ])(
    "%s is classified against the requested special identity",
    async (_case, draftId, rawName, status) => {
      store.roles.push(specialRole());
      store.rawRoleDrafts.push({
        _id: draftId,
        _type: "special_role",
        date: "2026-08-09",
        service_name: rawName,
      });

      const res = await rolePATCH(req(specialEditBody()), ctx("role-sp"));

      expect(res.status).toBe(status);
      if (status === 409) expect((await res.json()).error).toBe("integrity_conflict");
      expect(committedTransactions()).toHaveLength(status === 200 ? 1 : 0);
    },
  );

  it("claims the coordinator in the same transaction as a special identity rename", async () => {
    store.roles.push(specialRole());
    store.coordinators.push(coordinator({ _rev: "coord-rev-7", version: 7 }));

    const res = await rolePATCH(
      req(specialEditBody({ service_name: "Vigilia" })),
      ctx("role-sp"),
    );

    expect(res.status).toBe(200);
    const ops = committedTransactions()[0].ops;
    expect(ops).toHaveLength(2);
    expect(ops[0]).toMatchObject({ kind: "patch", id: "role-sp", rev: "rev-1" });
    expect(ops[1]).toMatchObject({
      kind: "patch",
      id: "specialIdentityCoordinator.global",
      rev: "coord-rev-7",
      set: { version: 8 },
    });
  });

  it("reconciles special rename conflicts through occupancy and coordinator without retry", async () => {
    let coordinatorReads = 0;
    let occupancyReads = 0;
    store.roles.push(specialRole());
    operationalFetch.mockImplementation(async (q: string, p: Record<string, unknown> = {}) => {
      if (q.includes('_type == "specialIdentityCoordinator"')) {
        coordinatorReads++;
        return [
          coordinator({
            _rev: coordinatorReads > 1 ? "coord-rev-2" : "coord-rev-1",
            version: coordinatorReads > 1 ? 2 : 1,
          }),
        ];
      }
      if (q.includes('_type == "special_role" && date == $date')) occupancyReads++;
      return canonicalRead(q, p);
    });
    commitOutcomes.push(conflictError("documentRevisionIDDoesNotMatchError", "coord"));

    const res = await rolePATCH(
      req(specialEditBody({ service_name: "Vigilia" })),
      ctx("role-sp"),
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: "stale_revision",
      details: { coordinatorRev: "coord-rev-2", coordinatorVersion: 2 },
    });
    expect(coordinatorReads).toBe(2);
    expect(occupancyReads).toBe(2);
    expect(transactions).toHaveLength(1);
    expect(committedTransactions()).toHaveLength(0);
    expect(revalidateServiceViewsMock).not.toHaveBeenCalled();
    expect(afterCallbacks).toHaveLength(0);
  });

  it("reports the normalized occupancy winner observed after a special rename conflict", async () => {
    let coordinatorReads = 0;
    let occupancyReads = 0;
    store.roles.push(specialRole());
    operationalFetch.mockImplementation(async (q: string, p: Record<string, unknown> = {}) => {
      if (q.includes('_type == "specialIdentityCoordinator"')) {
        coordinatorReads++;
        return [coordinator({ _rev: `coord-rev-${coordinatorReads}`, version: coordinatorReads })];
      }
      if (q.includes('_type == "special_role" && date == $date')) {
        occupancyReads++;
        return occupancyReads > 1
          ? [specialRole(), specialRole({ _id: "role-winner", service_name: "Vigilia" })]
          : [specialRole()];
      }
      return canonicalRead(q, p);
    });
    commitOutcomes.push(conflictError("documentRevisionIDDoesNotMatchError", "coord"));

    const res = await rolePATCH(
      req(specialEditBody({ service_name: "Vigilia" })),
      ctx("role-sp"),
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: "ambiguous_target",
      details: { roleIds: ["role-winner"] },
    });
    expect(occupancyReads).toBe(2);
    expect(coordinatorReads).toBe(2);
    expect(transactions).toHaveLength(1);
    expect(committedTransactions()).toHaveLength(0);
  });

  it("refuses a stale observed revision with no business mutation", async () => {
    store.roles.push(role({ _rev: "rev-moved" }));
    store.locks.push(lock());
    const res = await rolePATCH(req(editBody()), ctx("role-1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("stale_revision");
    expect(transactions).toHaveLength(0);
  });

  it("asserts the role revision and heartbeats the owned lock without enforcing memberType", async () => {
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

  it("preserves the complete production-shaped role through grid edit and the real PATCH transaction", async () => {
    const projectedMember = (id: string, key: string) => ({
      _id: id,
      _key: key,
      member_name: id,
    });
    const targetProjected = {
      _id: "role-1",
      _rev: "rev-1",
      _type: "sunday_role",
      date: "2026-08-09",
      published: false,
      leads: [
        projectedMember("lead-old", "lead-old-key"),
        projectedMember("lead-2", "lead-2-key"),
      ],
      bgvs: [
        projectedMember("bgv-1", "bgv-1-key"),
        projectedMember("bgv-2", "bgv-2-key"),
      ],
      chorus: [
        projectedMember("chorus-1", "chorus-1-key"),
        projectedMember("chorus-2", "chorus-2-key"),
      ],
      instruments: [
        { _key: "bass-upper-1", instrument: "Bass", person: projectedMember("bass-dup", "ignored-1") },
        { _key: "bass-upper-2", instrument: "Bass", person: projectedMember("bass-dup", "ignored-2") },
        { _key: "bass-lower", instrument: "bass", person: projectedMember("bass-lower", "ignored-3") },
      ],
      foh: [
        { _key: "console-upper-1", role: "Console", person: projectedMember("console-1", "ignored-4") },
        { _key: "console-upper-2", role: "Console", person: projectedMember("console-2", "ignored-5") },
        { _key: "console-lower", role: "console", person: projectedMember("console-lower", "ignored-6") },
      ],
    };
    const decoyProjected = {
      _id: "role-decoy",
      _rev: "rev-decoy",
      _type: "special_role",
      date: "2026-08-09",
      service_name: "Vigilia",
      published: false,
      leads: [projectedMember("decoy-lead", "decoy-lead-key")],
      bgvs: [],
      chorus: [],
      instruments: [],
      foh: [],
    };
    const targetRefs = [
      "lead-old", "lead-2", "bgv-1", "bgv-2", "chorus-1", "chorus-2",
      "bass-dup", "bass-lower", "console-1", "console-2", "console-lower",
    ];
    const integrityTarget = (
      id: string,
      rev: string,
      type: "sunday_role" | "special_role",
      assignedRefs: string[],
    ): RoleTarget => ({
      targetKey: type === "special_role" ? `special_role:${id}` : "sunday_role:2026-08-09",
      type,
      canonicalCount: 1,
      canonicalIds: [id],
      canonicalState: "single",
      publicState: "single",
      memberVisibleCount: 0,
      draftIds: [],
      records: [{
        id,
        rev,
        type,
        serviceDate: "2026-08-09",
        published: false,
        assignedRefs,
        members: [],
        danglingRefs: [],
      }],
      expectsLock: type !== "special_role",
      lock: type === "special_role" ? null : {
        id: "roleTarget.sunday_role.2026-08-09",
        rev: "lock-rev-1",
        state: "claimed",
        roleId: "role-1",
        generation: 2,
      },
      lockIssues: [],
    });
    const integrity: RoleDomainSummary = {
      targets: [
        integrityTarget("role-1", "rev-1", "sunday_role", targetRefs),
        integrityTarget("role-decoy", "rev-decoy", "special_role", ["decoy-lead"]),
      ],
      recordIssues: [],
      lockIssues: [],
    };

    operationalFetch.mockImplementation(async (query: string, params: Record<string, unknown> = {}) =>
      query.includes('*[_type in ["sunday_role", "saturday_role", "special_role"]]')
        ? [targetProjected, decoyProjected]
        : canonicalRead(query, params),
    );
    const rolesResponse = await rolesGET();
    expect(rolesResponse.status).toBe(200);
    const rolesRows = await rolesResponse.json();
    const rolesQuery = operationalFetch.mock.calls.find(([query]) =>
      typeof query === "string" && query.includes('*[_type in ["sunday_role", "saturday_role", "special_role"]]'),
    )?.[0] as string;
    expect(rolesQuery).toContain('"leads": Lead[defined(@->)]{ _key, ...@->{_id, member_name, alias} }');
    expect(rolesQuery).toContain('"bgvs": BGVs[defined(@->)]{ _key, ...@->{_id, member_name, alias} }');
    expect(rolesQuery).toContain('"chorus": Chorus[defined(@->)]{ _key, ...@->{_id, member_name, alias} }');
    expect(rolesQuery).toContain('"instruments": instruments[]{_key, instrument, "person": person->{_id, member_name, alias}}');
    expect(rolesQuery).toContain('"foh": foh_team[]{_key, role, "person": person->{_id, member_name, alias}}');

    const joined = joinStoredRoleInventory(rolesRows, integrity);
    expect(joined).toMatchObject({ coherent: true });
    expect(joined.roles.map((entry) => entry.admission)).toEqual(["approved", "approved"]);
    const translations = joined.roles.map(translateStoredRole);
    expect(translations.every((entry) => entry !== null)).toBe(true);
    const translated = translations.find((entry) => entry?.column.roleId === "role-1");
    if (!translated) throw new Error("target translation missing");
    const cells = translations.flatMap((entry) => entry?.cells ?? []).map((cell) =>
      cell.columnId === "role-1" && cell.rowId === "lead"
        ? {
            ...cell,
            occupants: cell.occupants.map((occupant, index) =>
              index === 0 ? { ...occupant, memberId: "lead-new" } : occupant),
          }
        : cell,
    );
    const serialized = serializeStoredColumn(
      translated.column,
      buildStoredGridRows(translations.filter((entry) => entry !== null)),
      cells,
    );
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) throw new Error(serialized.reasons.join(","));
    expect(serialized.body).toEqual({
      rev: "rev-1",
      lockRev: "lock-rev-1",
      _type: "sunday_role",
      date: "2026-08-09",
      leads: ["lead-new", "lead-2"],
      bgvs: ["bgv-1", "bgv-2"],
      chorus: ["chorus-1", "chorus-2"],
      instruments: [
        { instrument: "Bass", personId: "bass-dup" },
        { instrument: "Bass", personId: "bass-dup" },
        { instrument: "bass", personId: "bass-lower" },
      ],
      foh: [
        { role: "Console", personId: "console-1" },
        { role: "Console", personId: "console-2" },
        { role: "console", personId: "console-lower" },
      ],
    });

    const targetRaw = role({
      Lead: targetProjected.leads.map((item) => ({ _key: item._key, _type: "reference", _ref: item._id })),
      BGVs: targetProjected.bgvs.map((item) => ({ _key: item._key, _type: "reference", _ref: item._id })),
      Chorus: targetProjected.chorus.map((item) => ({ _key: item._key, _type: "reference", _ref: item._id })),
      instruments: targetProjected.instruments.map((item) => ({
        _key: item._key,
        _type: "instrument_slot",
        instrument: item.instrument,
        person: { _type: "reference", _ref: item.person._id },
      })),
      foh_team: targetProjected.foh.map((item) => ({
        _key: item._key,
        _type: "foh_slot",
        role: item.role,
        person: { _type: "reference", _ref: item.person._id },
      })),
    });
    const decoyRaw = role({
      _id: "role-decoy",
      _rev: "rev-decoy",
      _type: "special_role",
      week: undefined,
      date: "2026-08-09",
      service_name: "Vigilia",
      Lead: [{ _key: "decoy-lead-key", _type: "reference", _ref: "decoy-lead" }],
    });
    store.roles.push(targetRaw, decoyRaw);
    store.locks.push(lock());
    for (const id of [...new Set([...targetRefs, "lead-new"])]) {
      store.members.push({ _id: id, member_name: id });
    }
    onCommit = () => {
      const patch = committedTransactions()[0]?.ops.find(
        (op): op is PatchOp => op.kind === "patch" && op.id === "role-1",
      );
      if (!patch) throw new Error("committed role patch missing");
      store.roles = store.roles.map((document) =>
        document._id === "role-1" ? { ...document, ...patch.set, _rev: "rev-2" } : document,
      );
    };

    const response = await rolePATCH(req(serialized.body), ctx("role-1"));
    const responseBody = await response.json();
    if (response.status !== 200) throw new Error(JSON.stringify(responseBody));
    const rolePatch = committedTransactions()[0]?.ops.find(
      (op): op is PatchOp => op.kind === "patch" && op.id === "role-1",
    );
    expect(rolePatch).toMatchObject({ id: "role-1", rev: "rev-1" });
    expect(rolePatch?.set._type).toBeUndefined();

    const committed = store.roles.find((document) => document._id === "role-1");
    const refsOf = (value: unknown) =>
      (value as { _ref: string }[]).map((item) => item._ref);
    const labeledRefs = (value: unknown, label: "instrument" | "role") =>
      (value as Record<string, unknown>[]).map((item) => [
        item[label],
        (item.person as { _ref: string })._ref,
      ]);
    expect(committed).toMatchObject({ _id: "role-1", _rev: "rev-2", week: "2026-08-09" });
    expect(refsOf(committed?.Lead)).toEqual(["lead-new", "lead-2"]);
    expect(refsOf(committed?.BGVs)).toEqual(["bgv-1", "bgv-2"]);
    expect(refsOf(committed?.Chorus)).toEqual(["chorus-1", "chorus-2"]);
    expect(labeledRefs(committed?.instruments, "instrument")).toEqual([
      ["Bass", "bass-dup"],
      ["Bass", "bass-dup"],
      ["bass", "bass-lower"],
    ]);
    expect(labeledRefs(committed?.foh_team, "role")).toEqual([
      ["Console", "console-1"],
      ["Console", "console-2"],
      ["console", "console-lower"],
    ]);
    expect(store.roles.find((document) => document._id === "role-decoy")).toEqual(decoyRaw);
    const validationCall = operationalFetch.mock.calls.find(
      ([query, params]) =>
        typeof query === "string" &&
        query.includes('_type == "teamMembers"') &&
        Array.isArray((params as Record<string, unknown>).ids),
    );
    expect(new Set((validationCall?.[1] as { ids: string[] }).ids)).toEqual(
      new Set([...targetRefs.filter((id) => id !== "lead-old"), "lead-new"]),
    );
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

  it("pushes only to newly added assignees, and stays silent for a draft", async () => {
    store.roles.push(role({ published: true }));
    store.locks.push(lock());
    await rolePATCH(req(editBody()), ctx("role-1"));
    expect(afterCallbacks).toHaveLength(2);
    await drainAfter();
    expect(sendPushMock).toHaveBeenCalledWith(["mem-5"], "assignments", expect.anything());

    afterCallbacks.length = 0;
    store = emptyStore();
    store.roles.push(role({ published: false }));
    store.locks.push(lock());
    await rolePATCH(req(editBody()), ctx("role-1"));
    expect(afterCallbacks).toHaveLength(0);
  });

  it("queues the UNION of before- and after-assignees, from a PRE-COMMIT snapshot", async () => {
    // Stored Lead is mem-1; the edit replaces the lineup with mem-5 alone. The
    // dropped member is the whole point: `addedAssignees` diffed member ids, so
    // mem-1 heard nothing at all before this.
    store.roles.push(role({ published: true }));
    store.locks.push(lock());
    await rolePATCH(req(editBody({ leads: ["mem-5"] })), ctx("role-1"));
    await drainAfter();
    expect(queuedMemberIds().sort()).toEqual(["mem-1", "mem-5"]);
    const byMember = new Map(outboxUpserts().map((d) => [d.memberId, d]));
    // Each member's snapshot holds their OWN pre-commit seat labels. Read back
    // inside after() this would be the POST-write state and both would be empty
    // vs empty — a system that queues and then says nothing.
    expect(byMember.get("mem-1")!.before).toEqual({ beforeRoles: ["Líder"] });
    expect(byMember.get("mem-5")!.before).toEqual({ beforeRoles: [] });
    expect(byMember.get("mem-1")!.knownRecipients).toEqual(["mem-1"]);
  });

  it("REGRESSION GUARD: the queued `before` snapshot survives even when the store already reflects the post-commit state by the time after() drains", async () => {
    // This test exists to catch someone moving the `before` capture from
    // pre-commit (a value threaded into queueRoleNotices as an argument) to a
    // live read inside after(). If that ever happens, live state at that point
    // is already the POST-write state, so `before` would collapse onto `after`
    // and a dropped member like mem-1 below would receive NO notice at all —
    // silently. `onCommit` here simulates the Content Lake already holding the
    // new (mem-5-only) lineup by the time the deferred block runs, which is
    // exactly what a real re-read would observe.
    store.roles.push(role({ published: true }));
    store.locks.push(lock());
    onCommit = () => {
      store.roles = [
        role({
          published: true,
          _rev: "rev-2",
          Lead: [{ _key: "k2", _type: "reference", _ref: "mem-5" }],
        }),
      ];
    };
    await rolePATCH(req(editBody({ leads: ["mem-5"] })), ctx("role-1"));
    await drainAfter();
    const byMember = new Map(outboxUpserts().map((d) => [d.memberId, d]));
    // mem-1 was dropped by this edit. Their pre-commit label ("Líder") must
    // still be what got queued, even though the store — by the time after()
    // drains — already reflects the NEW lineup.
    expect(queuedMemberIds().sort()).toEqual(["mem-1", "mem-5"]);
    expect(byMember.get("mem-1")!.before).toEqual({ beforeRoles: ["Líder"] });
  });

  it("a draft edit queues nothing at all", async () => {
    store.roles.push(role({ published: false }));
    store.locks.push(lock());
    await rolePATCH(req(editBody()), ctx("role-1"));
    await drainAfter();
    expect(outboxUpserts()).toHaveLength(0);
  });

  it("stops after successful legacy bootstrap maintenance and requires reload", async () => {
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
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: "bootstrap_completed_reload",
      details: { cause: "commit_succeeded", attemptedRoleRev: "rev-legacy" },
    });
    expect(committedTransactions()).toHaveLength(1);
    // Maintenance only: revision-guarded heartbeat of the unchanged target
    // field plus the created lock. No business transaction follows it.
    const boot = committedTransactions()[0].ops;
    expect(boot[0]).toMatchObject({ kind: "patch", id: "role-1", rev: "rev-legacy" });
    expect((boot[0] as PatchOp).set.week).toBe("2026-08-09");
    expect(boot[1]).toMatchObject({ kind: "create" });
    expect(revalidateServiceViewsMock).not.toHaveBeenCalled();
    expect(afterCallbacks).toHaveLength(0);
  });

  it("reports bootstrap_outcome_unknown when rejected maintenance readback has a moved revision", async () => {
    store.roles.push(role({ _rev: "rev-legacy" }));
    let roleReads = 0;
    operationalFetch.mockImplementation(async (q: string, p: Record<string, unknown> = {}) => {
      if (q.includes("roleTargetLock")) return [];
      if (q.includes("_id == $id") && !q.includes("roleCreationReceipt")) {
        roleReads++;
        return [role({ _rev: roleReads > 1 ? "rev-moved" : "rev-legacy" })];
      }
      return canonicalRead(q, p);
    });
    commitOutcomes.push(conflictError("documentRevisionIDDoesNotMatchError", "role-1"));
    const res = await rolePATCH(req(editBody({ rev: "rev-legacy" })), ctx("role-1"));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: "bootstrap_outcome_unknown",
      details: { cause: "inconclusive_readback", observedRoleRev: "rev-moved" },
    });
    expect(committedTransactions()).toHaveLength(0);
    expect(transactions).toHaveLength(1);
    expect(revalidateServiceViewsMock).not.toHaveBeenCalled();
    expect(afterCallbacks).toHaveLength(0);
  });

  it("maps a conclusively rejected bootstrap to stale_revision without a business write", async () => {
    store.roles.push(role({ _rev: "rev-legacy" }));
    commitOutcomes.push(conflictError("documentRevisionIDDoesNotMatchError", "role-1"));

    const res = await rolePATCH(req(editBody({ rev: "rev-legacy" })), ctx("role-1"));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: "stale_revision",
      details: { cause: "prebootstrap_state_observed", attemptedRoleRev: "rev-legacy" },
    });
    expect(committedTransactions()).toHaveLength(0);
    expect(transactions).toHaveLength(1);
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

  it("stops a delete after successful legacy bootstrap maintenance", async () => {
    store.roles.push(role({ _rev: "rev-legacy" }));

    const res = await roleDELETE(req({ rev: "rev-legacy" }), ctx("role-1"));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: "bootstrap_completed_reload",
      details: { cause: "commit_succeeded", attemptedRoleRev: "rev-legacy" },
    });
    expect(committedTransactions()).toHaveLength(1);
    expect(committedTransactions()[0].ops.some((op) => op.kind === "delete")).toBe(false);
    expect(revalidateServiceViewsMock).not.toHaveBeenCalled();
    expect(afterCallbacks).toHaveLength(0);
  });

  it("maps inconclusive rejected delete bootstrap to bootstrap_outcome_unknown", async () => {
    store.roles.push(role({ _rev: "rev-legacy" }));
    let roleReads = 0;
    operationalFetch.mockImplementation(async (q: string, p: Record<string, unknown> = {}) => {
      if (q.includes("roleTargetLock")) return [];
      if (q.includes("_id == $id") && !q.includes("roleCreationReceipt")) {
        roleReads++;
        return [role({ _rev: roleReads > 1 ? "rev-moved" : "rev-legacy" })];
      }
      return canonicalRead(q, p);
    });
    commitOutcomes.push(conflictError("documentRevisionIDDoesNotMatchError", "role-1"));

    const res = await roleDELETE(req({ rev: "rev-legacy" }), ctx("role-1"));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: "bootstrap_outcome_unknown",
      details: { cause: "inconclusive_readback", observedRoleRev: "rev-moved" },
    });
    expect(committedTransactions()).toHaveLength(0);
    expect(transactions).toHaveLength(1);
    expect(revalidateServiceViewsMock).not.toHaveBeenCalled();
  });

  it("maps conclusively rejected delete bootstrap to stale_revision", async () => {
    store.roles.push(role({ _rev: "rev-legacy" }));
    commitOutcomes.push(conflictError("documentRevisionIDDoesNotMatchError", "role-1"));

    const res = await roleDELETE(req({ rev: "rev-legacy" }), ctx("role-1"));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: "stale_revision",
      details: { cause: "prebootstrap_state_observed", attemptedRoleRev: "rev-legacy" },
    });
    expect(committedTransactions()).toHaveLength(0);
    expect(transactions).toHaveLength(1);
    expect(revalidateServiceViewsMock).not.toHaveBeenCalled();
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

  it("queues a notice per CURRENT assignee, snapshotted before the delete", async () => {
    // Sends nothing immediately — there is no "te asignaron" for a service that
    // has ceased to exist — but the assignees are still owed "Ya no participas",
    // and after the commit no document can answer for who they were.
    store.roles.push(role({ published: true }));
    store.locks.push(lock());
    const res = await roleDELETE(req({ rev: "rev-1" }), ctx("role-1"));
    expect(res.status).toBe(200);
    await drainAfter();
    expect(sendPushMock).not.toHaveBeenCalled();
    expect(queuedMemberIds()).toEqual(["mem-1"]);
    expect(outboxUpserts()[0]).toMatchObject({
      kind: "role",
      roleId: "role-1",
      // The identity a vanished role can no longer supply.
      serviceDate: "2026-08-09",
      roleType: "sunday_role",
      before: { beforeRoles: ["Líder"] },
    });
  });

  it("a draft delete queues nothing", async () => {
    store.roles.push(role({ published: false }));
    store.locks.push(lock());
    expect((await roleDELETE(req({ rev: "rev-1" }), ctx("role-1"))).status).toBe(200);
    await drainAfter();
    expect(outboxUpserts()).toHaveLength(0);
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
