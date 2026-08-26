// The guarded proposal writers (Service Readiness A2 §6) at the route level:
// the member save/resubmit path and every admin transition, including the atomic
// approval and its receipt.
//
// The Sanity clients are fully mocked — no network, no dataset. Reads are served
// by a tiny in-memory store dispatched off the bound GROQ, and every transaction
// is recorded as an operation list (and applied to the store on a successful
// commit), so each test asserts exactly what would have been committed — and that
// a rejected request commits NOTHING.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const requireMinistryMemberMock = vi.fn();
const requireActiveManagerMock = vi.fn();
const operationalFetch = vi.fn();
const rawFetch = vi.fn();
const sendPushMock = vi.fn();
const notifyProposalSubmittedMock = vi.fn();
const revalidateServiceViewsMock = vi.fn();

vi.mock("@/app/utils/authGuards", () => ({
  requireMinistryMember: () => requireMinistryMemberMock(),
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

vi.mock("@/app/utils/push", () => ({ sendPush: (...a: unknown[]) => sendPushMock(...a) }));
vi.mock("@/app/utils/proposalNotify", () => ({
  notifyProposalSubmitted: (...a: unknown[]) => notifyProposalSubmittedMock(...a),
}));
vi.mock("@/app/utils/revalidate", () => ({
  revalidateServiceViews: (...a: unknown[]) => revalidateServiceViewsMock(...a),
}));

import { POST } from "@/app/api/me/proposals/route";
import { PATCH } from "@/app/api/admin/proposals/[id]/route";
import {
  approvalInputFingerprint,
  buildApprovalReceipt,
  buildTransitionRecord,
} from "@/app/utils/proposalWriteRequest";

// ── Transaction recorder ────────────────────────────────────────────────────

interface PatchOp {
  kind: "patch";
  id: string;
  rev: string | null;
  set: Record<string, unknown>;
  unset: string[];
  /** Appended array items, by field. The transition appends its own message. */
  appended: Record<string, unknown[]>;
  /** Chain calls IN ORDER — `setIfMissing` must precede `append`, and a mocked
   *  chain succeeds either way, so order is the only thing that proves it. */
  calls: string[];
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
      const op: PatchOp = { kind: "patch", id, rev: null, set: {}, unset: [], appended: {}, calls: [] };
      const p = {
        ifRevisionId(rev: string) { op.calls.push("ifRevisionId"); op.rev = rev; return p; },
        set(values: Record<string, unknown>) { op.calls.push("set"); Object.assign(op.set, values); return p; },
        unset(fields: string[]) { op.calls.push("unset"); op.unset.push(...fields); return p; },
        setIfMissing(values: Record<string, unknown>) {
          op.calls.push("setIfMissing");
          for (const [k, v] of Object.entries(values)) if (!(k in op.set)) op.set[k] = v;
          return p;
        },
        append(field: string, items: unknown[]) {
          op.calls.push("append");
          (op.appended[field] ??= []).push(...items);
          return p;
        },
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

/**
 * A patch without the chain bookkeeping (`calls`, `appended`), for the
 * assertions that deep-equal the WHOLE op list.
 *
 * Those stay exhaustive on purpose — their value is "these operations and no
 * others" — so they are normalized rather than loosened to `toMatchObject`,
 * which would stop them noticing an operation nobody intended.
 */
function patchShapes(tx: RecordedTx) {
  return patches(tx).map(({ calls: _calls, appended: _appended, ...rest }) => rest);
}

function creates(tx: RecordedTx): Record<string, unknown>[] {
  return tx.ops
    .filter((o): o is { kind: "create"; doc: Record<string, unknown> } => o.kind === "create")
    .map((o) => o.doc);
}

function deletes(): string[] {
  return transactions.flatMap((t) =>
    t.ops.filter((o): o is { kind: "delete"; id: string } => o.kind === "delete").map((o) => o.id),
  );
}

// ── In-memory store ─────────────────────────────────────────────────────────

interface Store {
  roles: Record<string, unknown>[];
  proposals: Record<string, unknown>[];
  setlists: Record<string, unknown>[];
  locks: Record<string, unknown>[];
  rawRoleDrafts: Record<string, unknown>[];
  rawSetlistDrafts: Record<string, unknown>[];
  rawProposalDrafts: Record<string, unknown>[];
}

let store: Store;

function emptyStore(): Store {
  return {
    roles: [],
    proposals: [],
    setlists: [],
    locks: [],
    rawRoleDrafts: [],
    rawSetlistDrafts: [],
    rawProposalDrafts: [],
  };
}

function collectionFor(type: unknown): Record<string, unknown>[] {
  if (type === "roleTargetLock") return store.locks;
  if (type === "setlistProposal") return store.proposals;
  if (type === "featuredSongs" || type === "saturdarSongs") return store.setlists;
  return store.roles;
}

function allDocs() {
  return [...store.roles, ...store.proposals, ...store.setlists, ...store.locks];
}

function applyToStore(record: RecordedTx) {
  for (const op of record.ops) {
    if (op.kind === "create") {
      collectionFor(op.doc._type).push({ ...op.doc, _rev: `${String(op.doc._id)}-rev1` });
      continue;
    }
    if (op.kind === "delete") {
      for (const list of [store.roles, store.proposals, store.setlists, store.locks]) {
        const at = list.findIndex((d) => d._id === op.id);
        if (at >= 0) list.splice(at, 1);
      }
      continue;
    }
    const doc = allDocs().find((d) => d._id === op.id);
    if (!doc) continue;
    Object.assign(doc, op.set);
    for (const [field, items] of Object.entries(op.appended)) {
      const current = Array.isArray(doc[field]) ? (doc[field] as unknown[]) : [];
      doc[field] = [...current, ...items];
    }
    for (const field of op.unset) delete doc[field];
    doc._rev = `${String(doc._rev)}+`;
  }
}

function canonicalRead(query: string, params: Record<string, unknown>): unknown {
  if (query.includes("roleTargetLock")) {
    return store.locks.filter((l) => (params.ids as string[]).includes(l._id as string));
  }
  if (query.includes("setlistProposal")) {
    if (query.includes("_id == $id")) return store.proposals.filter((p) => p._id === params.id);
    // Both indexes at once: the role reference OR an affected date.
    return store.proposals.filter(
      (p) => p.service_ref === params.roleId || (params.dates as string[]).includes(p.service_date as string),
    );
  }
  if (query.includes("$setlistType") && query.includes("week == $week")) {
    return store.setlists.filter((s) => s._type === params.setlistType && s.week === params.week);
  }
  if (query.includes("$roleType") && query.includes("week == $week")) {
    return store.roles.filter((r) => r._type === params.roleType && r.week === params.week);
  }
  if (query.includes("_id == $id")) return store.roles.filter((r) => r._id === params.id);
  if (query.includes("_id in $ids")) {
    return store.roles.filter((r) => (params.ids as string[]).includes(r._id as string));
  }
  throw new Error(`unmocked canonical query: ${query}`);
}

function rawRead(query: string, params: Record<string, unknown>): unknown[] {
  if (query.includes("setlistProposal")) {
    if (query.includes("$draftId")) {
      return store.rawProposalDrafts.filter((d) => d._id === params.draftId);
    }
    return store.rawProposalDrafts.filter(
      (d) => d.service_ref === params.roleId || (params.dates as string[]).includes(d.service_date as string),
    );
  }
  if (query.includes("$draftId")) return store.rawRoleDrafts.filter((d) => d._id === params.draftId);
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

const LEAD = { user: { sanityId: "mem-1", role: "member" } };
const ADMIN = { user: { role: "admin", sanityId: "admin-1" } };
const WEEK = "2026-08-09";
const PROPOSAL_ID = "setlistProposal.role-1";

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

/** A stored proposal in the canonical projection shape. */
function proposal(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: PROPOSAL_ID,
    _rev: "prop-rev-1",
    _createdAt: "2026-07-01T00:00:00.000Z",
    _type: "setlistProposal",
    service_type: "sunday",
    service_ref: "role-1",
    service_date: WEEK,
    status: "pending",
    lead: "mem-1",
    contributors: [{ _key: "c1", person: "mem-1" }],
    lead_notes: "Solo para admins",
    team_notes: "Salmo 100:2",
    songs: [
      { _key: "p1", play_key: "D", song: { _type: "reference", _ref: "song-1" } },
      { _key: "p2", play_key: "G", medley_tag: "m", song: { _type: "reference", _ref: "song-2" } },
    ],
    ...over,
  };
}

function req(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function saveBody(over: Record<string, unknown> = {}) {
  return {
    roleId: "role-1",
    status: "draft",
    observed: { state: "none" },
    songs: [{ songId: "song-1", play_key: "G" }],
    leadNotes: "Solo para admins",
    teamNotes: "Salmo 100:2",
    ...over,
  };
}

function patchAdmin(id: string, body: unknown) {
  return PATCH(req(body), { params: Promise.resolve({ id }) });
}

/** The approval input fingerprint of a stored weekend proposal. */
function fingerprintOf(doc: Record<string, unknown>, setlistTargetKey = `featuredSongs:${WEEK}`) {
  return approvalInputFingerprint({
    serviceType: String(doc.service_type),
    serviceDate: String(doc.service_date),
    serviceRef: String(doc.service_ref),
    setlistTargetKey,
    songs: (doc.songs as { play_key?: string; medley_tag?: string; song: { _ref: string } }[]).map(
      (s) => ({ songId: s.song._ref, playKey: s.play_key ?? "", medleyTag: s.medley_tag ?? null }),
    ),
    teamNotes: String(doc.team_notes ?? ""),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  transactions.length = 0;
  commitOutcomes.length = 0;
  store = emptyStore();
  requireMinistryMemberMock.mockResolvedValue(LEAD);
  requireActiveManagerMock.mockResolvedValue(ADMIN);
  operationalFetch.mockImplementation(async (q: string, p: Record<string, unknown> = {}) =>
    canonicalRead(q, p),
  );
  rawFetch.mockImplementation(async (q: string, p: Record<string, unknown> = {}) => rawRead(q, p));
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/me/proposals — create / save / resubmit
// ════════════════════════════════════════════════════════════════════════════

describe("POST /api/me/proposals — authorization and prevalidation", () => {
  // The guard is `requireMinistryMember("worship")`: no session, a disabled
  // member and a kids-only member are all one `null` here, and all 403.
  it("403s without worship membership, before any read", async () => {
    requireMinistryMemberMock.mockResolvedValueOnce(null);
    expect((await POST(req(saveBody()))).status).toBe(403);
    expect(operationalFetch).not.toHaveBeenCalled();
  });

  it.each([
    ["no observed state", { observed: undefined }],
    ["an unknown status", { status: "approved" }],
    ["a missing roleId", { roleId: undefined }],
    ["a malformed song row", { songs: [{ play_key: "G" }] }],
  ])("rejects %s with 400 before any read or write", async (_label, over) => {
    const res = await POST(req(saveBody(over)));
    expect(res.status).toBe(400);
    expect(operationalFetch).not.toHaveBeenCalled();
    expect(transactions).toHaveLength(0);
  });

  it("403s a caller who is not a Lead, an unresolved role, and a draft service", async () => {
    // Unresolved
    expect((await POST(req(saveBody()))).status).toBe(403);
    // Not a Lead
    store.roles.push(sundayRole({ Lead: [ref("a1", "mem-9")] }));
    expect((await POST(req(saveBody()))).status).toBe(403);
    // Admin-only draft service
    store.roles = [sundayRole({ published: false })];
    expect((await POST(req(saveBody()))).status).toBe(403);
    expect(transactions).toHaveLength(0);
  });

  it("refuses a duplicate role group and a draft-overlaid role", async () => {
    store.roles.push(sundayRole(), sundayRole({ _id: "role-dup", _rev: "r2" }));
    expect((await POST(req(saveBody()))).status).toBe(409);
    store.roles = [sundayRole()];
    store.rawRoleDrafts.push({ _id: "drafts.role-1", _type: "sunday_role", week: WEEK });
    expect((await POST(req(saveBody()))).status).toBe(409);
    expect(transactions).toHaveLength(0);
  });
});

describe("POST /api/me/proposals — first create", () => {
  function seed() {
    store.roles.push(sundayRole());
    store.locks.push(lock());
  }

  it("creates at the deterministic id and heartbeats the lock in ONE transaction", async () => {
    seed();
    const res = await POST(req(saveBody()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ _id: PROPOSAL_ID, status: "draft" });
    expect(committedTransactions()).toHaveLength(1);
    const tx = committedTransactions()[0];
    const created = creates(tx)[0];
    expect(created).toMatchObject({
      _id: PROPOSAL_ID,
      _type: "setlistProposal",
      // Target metadata derived from the AUTHORIZED canonical role.
      service_type: "sunday",
      service_date: WEEK,
      service_ref: { _type: "reference", _ref: "role-1" },
      status: "draft",
      // The team message stays separate from the private review note.
      lead_notes: "Solo para admins",
      team_notes: "Salmo 100:2",
    });
    expect(created.submitted_at).toBeUndefined();
    expect(patchShapes(tx)).toEqual([
      {
        kind: "patch",
        id: `roleTarget.sunday_role.${WEEK}`,
        rev: "lock-rev-1",
        set: { updatedAt: expect.any(String) },
        unset: [],
      },
    ]);
    expect(notifyProposalSubmittedMock).not.toHaveBeenCalled();
  });

  it("notifies admins and co-leads only when the save submits for review", async () => {
    seed();
    const res = await POST(req(saveBody({ status: "pending" })));
    expect(res.status).toBe(200);
    expect(creates(committedTransactions()[0])[0]).toMatchObject({
      status: "pending",
      submitted_at: expect.any(String),
      submitted_by: { _type: "reference", _ref: "mem-1" },
    });
    expect(notifyProposalSubmittedMock).toHaveBeenCalledWith({
      leadId: "mem-1",
      roleId: "role-1",
      proposalId: PROPOSAL_ID,
      serviceType: "sunday",
      serviceDate: WEEK,
    });
  });

  it("tells the co-lead who loses the deterministic-id race (nothing committed)", async () => {
    seed();
    commitOutcomes.push(conflictError("documentAlreadyExistsError"));
    const res = await POST(req(saveBody()));
    expect(res.status).toBe(409);
    expect((await res.json()).details).toMatchObject({ detail: "concurrent_creation" });
    expect(committedTransactions()).toHaveLength(0);
    expect(notifyProposalSubmittedMock).not.toHaveBeenCalled();
  });

  it("refuses an observed none when a proposal already exists", async () => {
    seed();
    store.proposals.push(proposal({ status: "draft" }));
    const res = await POST(req(saveBody()));
    expect(res.status).toBe(409);
    expect((await res.json()).details).toMatchObject({ detail: "concurrent_creation" });
    expect(transactions).toHaveLength(0);
  });

  it("asserts the special role's own revision instead of a weekend lock", async () => {
    store.roles.push(specialRole());
    const res = await POST(req(saveBody({ roleId: "role-sp" })));
    expect(res.status).toBe(200);
    const tx = committedTransactions()[0];
    expect(creates(tx)[0]).toMatchObject({
      _id: "setlistProposal.role-sp",
      service_type: "special",
      service_date: "2026-08-20",
    });
    expect(patchShapes(tx)).toEqual([
      {
        kind: "patch",
        id: "role-sp",
        rev: "role-rev-sp",
        set: { date: "2026-08-20" },
        unset: [],
      },
    ]);
  });
});

describe("POST /api/me/proposals — save / resubmit an existing proposal", () => {
  function seed(over: Record<string, unknown> = {}) {
    store.roles.push(sundayRole());
    store.locks.push(lock());
    store.proposals.push(proposal({ status: "draft", ...over }));
  }

  it("patches under the observed revision, refreshing target metadata and merging contributors", async () => {
    seed({ contributors: [{ _key: "c1", person: "mem-9" }] });
    const res = await POST(
      req(
        saveBody({
          observed: { state: "single", id: PROPOSAL_ID, rev: "prop-rev-1" },
          status: "pending",
        }),
      ),
    );
    expect(res.status).toBe(200);
    const ops = patches(committedTransactions()[0]);
    expect(ops[0]).toMatchObject({ id: PROPOSAL_ID, rev: "prop-rev-1" });
    // `_type` is never sent: it is immutable per document id.
    expect(ops[0].set).not.toHaveProperty("_type");
    expect(ops[0].set).toMatchObject({
      status: "pending",
      service_type: "sunday",
      service_date: WEEK,
      lead_notes: "Solo para admins",
      team_notes: "Salmo 100:2",
      contributors: [
        { _type: "contributor", _key: "c1", person: { _type: "reference", _ref: "mem-9" } },
        { _type: "contributor", _key: expect.any(String), person: { _type: "reference", _ref: "mem-1" } },
      ],
    });
    // The coordination token is heartbeated in the same transaction.
    expect(ops[1]).toMatchObject({ id: `roleTarget.sunday_role.${WEEK}`, rev: "lock-rev-1" });
  });

  it("refuses a stale observed revision with no mutation", async () => {
    seed();
    const res = await POST(
      req(saveBody({ observed: { state: "single", id: PROPOSAL_ID, rev: "prop-rev-OLD" } })),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).details).toMatchObject({ detail: "revision_mismatch" });
    expect(transactions).toHaveLength(0);
  });

  it("refuses an observed id that is not the shared proposal", async () => {
    seed();
    const res = await POST(
      req(saveBody({ observed: { state: "single", id: "setlistProposal.other", rev: "prop-rev-1" } })),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).details).toMatchObject({ detail: "identity_mismatch" });
    expect(transactions).toHaveLength(0);
  });

  it("never lets a member mutate an approved proposal", async () => {
    seed({ status: "approved" });
    const res = await POST(
      req(saveBody({ observed: { state: "single", id: PROPOSAL_ID, rev: "prop-rev-1" } })),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).details).toMatchObject({ detail: "approved" });
    expect(transactions).toHaveLength(0);
  });

  it("refuses an ambiguous group instead of picking one (never an arbitrary [0])", async () => {
    seed();
    // A second valid proposal on the SAME weekend target key, via another role.
    store.roles.push(sundayRole({ _id: "role-2", _rev: "role-rev-2", week: WEEK }));
    store.proposals.push(
      proposal({ _id: "setlistProposal.role-2", _rev: "p2", service_ref: "role-2", status: "draft" }),
    );
    const res = await POST(
      req(saveBody({ observed: { state: "single", id: PROPOSAL_ID, rev: "prop-rev-1" } })),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "ambiguous_target" });
    expect(transactions).toHaveLength(0);
  });

  it("refuses a structurally invalid proposal for this service rather than shadowing it", async () => {
    store.roles.push(sundayRole());
    store.locks.push(lock());
    store.proposals.push(proposal({ _id: "legacy-proposal", status: "weird" }));
    const res = await POST(req(saveBody()));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: "integrity_conflict",
      details: { detail: "proposal_malformed" },
    });
    expect(transactions).toHaveLength(0);
  });

  it("refuses a raw draft proposal overlay for this service", async () => {
    store.roles.push(sundayRole());
    store.locks.push(lock());
    store.rawProposalDrafts.push({
      _id: `drafts.${PROPOSAL_ID}`,
      service_ref: "role-1",
      service_date: WEEK,
      service_type: "sunday",
    });
    const res = await POST(req(saveBody()));
    expect(res.status).toBe(409);
    expect((await res.json()).details).toMatchObject({ detail: "proposal_draft_conflict" });
    expect(transactions).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PATCH /api/admin/proposals/[id] — review transitions
// ════════════════════════════════════════════════════════════════════════════

describe("PATCH /api/admin/proposals/[id] — authorization and prevalidation", () => {
  it("denies a non-manager and a content-editor without reading anything", async () => {
    requireActiveManagerMock.mockResolvedValueOnce(null);
    expect((await patchAdmin(PROPOSAL_ID, { action: "approve", rev: "r" })).status).toBe(403);
    requireActiveManagerMock.mockResolvedValueOnce({ user: { role: "content-editor" } });
    expect((await patchAdmin(PROPOSAL_ID, { action: "approve", rev: "r" })).status).toBe(403);
    expect(operationalFetch).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing reviewed revision", { action: "approve" }],
    ["an unknown action", { action: "delete", rev: "prop-rev-1" }],
  ])("rejects %s with 400 before any read", async (_label, body) => {
    const res = await patchAdmin(PROPOSAL_ID, body);
    expect(res.status).toBe(400);
    expect(operationalFetch).not.toHaveBeenCalled();
    expect(transactions).toHaveLength(0);
  });

  it("404s an unresolved proposal and refuses a draft-overlaid one", async () => {
    expect((await patchAdmin(PROPOSAL_ID, { action: "approve", rev: "r" })).status).toBe(404);
    store.roles.push(sundayRole());
    store.proposals.push(proposal());
    store.rawProposalDrafts.push({ _id: `drafts.${PROPOSAL_ID}` });
    expect((await patchAdmin(PROPOSAL_ID, { action: "approve", rev: "prop-rev-1" })).status).toBe(409);
    expect(transactions).toHaveLength(0);
  });
});

describe("PATCH /api/admin/proposals/[id] — approval", () => {
  function seed(over: Record<string, unknown> = {}) {
    store.roles.push(sundayRole());
    store.locks.push(lock());
    store.proposals.push(proposal(over));
  }

  it("writes the live setlist, marks approved and records a receipt in ONE transaction", async () => {
    seed();
    const res = await patchAdmin(PROPOSAL_ID, { action: "approve", rev: "prop-rev-1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      status: "approved",
      setlistId: `featuredSongs.${WEEK}`,
    });
    expect(committedTransactions()).toHaveLength(1);
    const tx = committedTransactions()[0];

    // The proposal is claimed under the REVIEWED revision, with its receipt.
    const proposalOp = patches(tx).find((o) => o.id === PROPOSAL_ID)!;
    expect(proposalOp.rev).toBe("prop-rev-1");
    expect(proposalOp.set.status).toBe("approved");
    expect(proposalOp.set.approval_receipt).toMatchObject({
      fingerprint: fingerprintOf(proposal()),
      serviceRef: "role-1",
      setlistTargetKey: `featuredSongs:${WEEK}`,
      setlistId: `featuredSongs.${WEEK}`,
      songCount: 2,
      approvedAt: expect.any(String),
      approvedBy: "admin-1",
    });

    // The live setlist is created at the deterministic id, in the same transaction,
    // publishing ONLY the team message (never the private lead note).
    const created = creates(tx)[0];
    expect(created).toMatchObject({
      _id: `featuredSongs.${WEEK}`,
      _type: "featuredSongs",
      week: WEEK,
      team_notes: "Salmo 100:2",
    });
    expect(created).not.toHaveProperty("lead_notes");
    expect((created.songs as unknown[])).toHaveLength(2);

    // The weekend token is asserted too.
    expect(patches(tx).some((o) => o.id === `roleTarget.sunday_role.${WEEK}`)).toBe(true);

    expect(revalidateServiceViewsMock).toHaveBeenCalledOnce();
    expect(sendPushMock).toHaveBeenCalledWith(["mem-1"], "proposals", expect.anything());
  });

  it("swallows a thrown review push without failing the committed approval (§7)", async () => {
    seed();
    sendPushMock.mockImplementation(() => {
      throw new Error("fcm down");
    });
    const res = await patchAdmin(PROPOSAL_ID, { action: "approve", rev: "prop-rev-1" });
    expect(res.status).toBe(200);
    // The approval transaction stands and the caches were still refreshed.
    expect(committedTransactions()).toHaveLength(1);
    expect(revalidateServiceViewsMock).toHaveBeenCalledOnce();
  });

  it("patches an existing live setlist under its observed revision", async () => {
    seed();
    store.setlists.push({
      _id: "legacy-setlist",
      _rev: "set-rev-1",
      _type: "featuredSongs",
      week: WEEK,
      songs: [],
    });
    const res = await patchAdmin(PROPOSAL_ID, { action: "approve", rev: "prop-rev-1" });
    expect(res.status).toBe(200);
    const tx = committedTransactions()[0];
    expect(creates(tx)).toHaveLength(0);
    const setlistOp = patches(tx).find((o) => o.id === "legacy-setlist")!;
    expect(setlistOp.rev).toBe("set-rev-1");
    expect(Object.keys(setlistOp.set).sort()).toEqual(["songs", "team_notes"]);
  });

  it("does NOT delete sibling proposals for the same service", async () => {
    seed();
    store.proposals.push(
      proposal({ _id: "setlistProposal.sibling", _rev: "p2", status: "draft", service_ref: "role-1" }),
    );
    // Two valid proposals on one target is an ambiguity, so use a sibling that is
    // reached only through the date index of ANOTHER service.
    store.proposals.pop();
    store.roles.push(specialRole({ date: WEEK, _id: "role-sp2", _rev: "rsp2" }));
    store.proposals.push(
      proposal({
        _id: "setlistProposal.role-sp2",
        _rev: "p3",
        status: "draft",
        service_type: "special",
        service_ref: "role-sp2",
        service_date: WEEK,
      }),
    );
    const res = await patchAdmin(PROPOSAL_ID, { action: "approve", rev: "prop-rev-1" });
    expect(res.status).toBe(200);
    expect(deletes()).toEqual([]);
    expect(store.proposals.some((p) => p._id === "setlistProposal.role-sp2")).toBe(true);
  });

  it("treats a matching approved receipt as a no-write success (lost response)", async () => {
    const doc = proposal({ status: "approved" });
    doc.approval_receipt = buildApprovalReceipt({
      approval: {
        serviceType: "sunday",
        serviceDate: WEEK,
        serviceRef: "role-1",
        setlistTargetKey: `featuredSongs:${WEEK}`,
        songs: [
          { songId: "song-1", playKey: "D", medleyTag: null },
          { songId: "song-2", playKey: "G", medleyTag: "m" },
        ],
        teamNotes: "Salmo 100:2",
      },
      setlistId: `featuredSongs.${WEEK}`,
      now: "2026-07-24T10:00:00.000Z",
    })!;
    store.roles.push(sundayRole());
    store.locks.push(lock());
    store.proposals.push(doc);

    // The reviewed revision is necessarily stale after the first commit; the
    // receipt is the proof, so the replay still succeeds without writing.
    const res = await patchAdmin(PROPOSAL_ID, { action: "approve", rev: "whatever-old-rev" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "approved", idempotent: true });
    expect(transactions).toHaveLength(0);
    expect(revalidateServiceViewsMock).not.toHaveBeenCalled();
    expect(sendPushMock).not.toHaveBeenCalled();
  });

  it("refuses an approved proposal with no verifiable receipt", async () => {
    seed({ status: "approved" });
    const res = await patchAdmin(PROPOSAL_ID, { action: "approve", rev: "prop-rev-1" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: "legacy_approval_unverified",
      conflict: true,
    });
    expect(transactions).toHaveLength(0);
  });

  it("refuses an approved proposal whose content drifted from its receipt", async () => {
    const doc = proposal({ status: "approved" });
    doc.approval_receipt = buildApprovalReceipt({
      approval: {
        serviceType: "sunday",
        serviceDate: WEEK,
        serviceRef: "role-1",
        setlistTargetKey: `featuredSongs:${WEEK}`,
        songs: [{ songId: "song-1", playKey: "D", medleyTag: null }],
        teamNotes: "Salmo 100:2",
      },
      setlistId: `featuredSongs.${WEEK}`,
      now: "2026-07-24T10:00:00.000Z",
    })!;
    store.roles.push(sundayRole());
    store.locks.push(lock());
    store.proposals.push(doc);
    const res = await patchAdmin(PROPOSAL_ID, { action: "approve", rev: "prop-rev-1" });
    expect(res.status).toBe(409);
    expect((await res.json()).details).toMatchObject({ detail: "approval_fingerprint_mismatch" });
    expect(transactions).toHaveLength(0);
  });

  it("refuses a revision the admin did not review, and a disallowed source state", async () => {
    seed();
    let res = await patchAdmin(PROPOSAL_ID, { action: "approve", rev: "prop-rev-STALE" });
    expect(res.status).toBe(409);
    expect((await res.json()).details).toMatchObject({ observedRev: "prop-rev-STALE" });

    store = emptyStore();
    seed({ status: "draft" });
    res = await patchAdmin(PROPOSAL_ID, { action: "approve", rev: "prop-rev-1" });
    expect(res.status).toBe(409);
    expect((await res.json()).details).toMatchObject({ detail: "source_status" });
    expect(transactions).toHaveLength(0);
  });

  it("refuses content that is not ready to publish", async () => {
    seed({ songs: [{ _key: "p1", song: { _type: "reference", _ref: "song-1" } }] });
    const res = await patchAdmin(PROPOSAL_ID, { action: "approve", rev: "prop-rev-1" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: "integrity_conflict",
      details: { contentState: "incomplete" },
    });
    expect(transactions).toHaveLength(0);
  });

  it("refuses to publish when the service has an ambiguous proposal group", async () => {
    seed();
    // A second valid proposal on the SAME weekend target key (another role, same
    // date+type): which one is "the" shared proposal is no longer decidable.
    store.roles.push(sundayRole({ _id: "role-2", _rev: "role-rev-2" }));
    store.proposals.push(
      proposal({ _id: "setlistProposal.role-2", _rev: "p2", service_ref: "role-2", status: "draft" }),
    );
    const res = await patchAdmin(PROPOSAL_ID, { action: "approve", rev: "prop-rev-1" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "ambiguous_target" });
    expect(transactions).toHaveLength(0);
  });

  it("refuses a duplicate live setlist target and a draft overlay of it", async () => {
    seed();
    store.setlists.push(
      { _id: "a", _rev: "1", _type: "featuredSongs", week: WEEK, songs: [] },
      { _id: "b", _rev: "2", _type: "featuredSongs", week: WEEK, songs: [] },
    );
    expect((await patchAdmin(PROPOSAL_ID, { action: "approve", rev: "prop-rev-1" })).status).toBe(409);
    store.setlists = [];
    store.rawSetlistDrafts.push({ _id: "drafts.x", _type: "featuredSongs", week: WEEK });
    expect((await patchAdmin(PROPOSAL_ID, { action: "approve", rev: "prop-rev-1" })).status).toBe(409);
    expect(transactions).toHaveLength(0);
  });

  it("rolls everything back when the transaction conflicts", async () => {
    seed();
    commitOutcomes.push(conflictError());
    const res = await patchAdmin(PROPOSAL_ID, { action: "approve", rev: "prop-rev-1" });
    expect(res.status).toBe(409);
    expect(committedTransactions()).toHaveLength(0);
    expect(revalidateServiceViewsMock).not.toHaveBeenCalled();
    expect(sendPushMock).not.toHaveBeenCalled();
  });

  it("publishes a special service onto its own role document", async () => {
    store.roles.push(specialRole());
    store.proposals.push(
      proposal({
        _id: "setlistProposal.role-sp",
        service_type: "special",
        service_ref: "role-sp",
        service_date: "2026-08-20",
      }),
    );
    const res = await patchAdmin("setlistProposal.role-sp", { action: "approve", rev: "prop-rev-1" });
    expect(res.status).toBe(200);
    const tx = committedTransactions()[0];
    expect(creates(tx)).toHaveLength(0);
    const roleOp = patches(tx).find((o) => o.id === "role-sp")!;
    expect(roleOp.rev).toBe("role-rev-sp");
    expect(Object.keys(roleOp.set).sort()).toEqual(["songs", "team_notes"]);
    // A special service takes no weekend lock.
    expect(patches(tx).some((o) => o.id.startsWith("roleTarget."))).toBe(false);
  });
});

describe("PATCH /api/admin/proposals/[id] — request_changes and reopen", () => {
  function seed(over: Record<string, unknown> = {}) {
    store.roles.push(sundayRole());
    store.locks.push(lock());
    store.proposals.push(proposal(over));
  }

  it("records the transition fingerprint and heartbeats the token", async () => {
    seed();
    const res = await patchAdmin(PROPOSAL_ID, {
      action: "request_changes",
      rev: "prop-rev-1",
      adminNotes: "Cambia la última",
    });
    expect(res.status).toBe(200);
    const tx = committedTransactions()[0];
    const op = patches(tx).find((o) => o.id === PROPOSAL_ID)!;
    expect(op.rev).toBe("prop-rev-1");
    expect(op.set).toMatchObject({
      status: "changes_requested",
      admin_notes: "Cambia la última",
      last_transition: {
        action: "request_changes",
        toStatus: "changes_requested",
        fingerprint: expect.any(String),
        by: "admin-1",
      },
    });
    expect(patches(tx).some((o) => o.id === `roleTarget.sunday_role.${WEEK}`)).toBe(true);
    expect(sendPushMock).toHaveBeenCalledWith(["mem-1"], "proposals", expect.anything());
  });

  it("replays an already-committed transition as an explicit no-write retry", async () => {
    const intent = {
      action: "request_changes" as const,
      proposalId: PROPOSAL_ID,
      toStatus: "changes_requested",
      adminNotes: "Cambia la última",
      targetIdentity: null,
    };
    seed({
      status: "changes_requested",
      last_transition: buildTransitionRecord({ intent, now: "2026-07-24T10:00:00.000Z" }),
    });
    const res = await patchAdmin(PROPOSAL_ID, {
      action: "request_changes",
      rev: "already-stale",
      adminNotes: "Cambia la última",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "changes_requested", idempotent: true });
    expect(transactions).toHaveLength(0);
    expect(sendPushMock).not.toHaveBeenCalled();
  });

  it("commits a genuinely different transition on an already-changed proposal", async () => {
    const intent = {
      action: "request_changes" as const,
      proposalId: PROPOSAL_ID,
      toStatus: "changes_requested",
      adminNotes: "Cambia la última",
      targetIdentity: null,
    };
    seed({
      status: "changes_requested",
      last_transition: buildTransitionRecord({ intent, now: "2026-07-24T10:00:00.000Z" }),
    });
    const res = await patchAdmin(PROPOSAL_ID, {
      action: "request_changes",
      rev: "prop-rev-1",
      adminNotes: "Otra observación",
    });
    expect(res.status).toBe(200);
    expect(committedTransactions()).toHaveLength(1);
  });

  it("refuses a stale reviewed revision on a fingerprint mismatch", async () => {
    seed();
    const res = await patchAdmin(PROPOSAL_ID, {
      action: "request_changes",
      rev: "prop-rev-OLD",
      adminNotes: "Cambia la última",
    });
    expect(res.status).toBe(409);
    expect(transactions).toHaveLength(0);
  });

  // ── The transition's own thread message (Child A §4) ────────────────────

  it("appends the change-request note as a message, inside the SAME patch", async () => {
    seed();
    const res = await patchAdmin(PROPOSAL_ID, {
      action: "request_changes",
      rev: "prop-rev-1",
      adminNotes: "Cambia la última",
    });
    expect(res.status).toBe(200);

    const op = patches(committedTransactions()[0])[0];
    const [msg] = op.appended.messages as Record<string, unknown>[];
    expect(msg).toMatchObject({
      _type: "proposal_message",
      kind: "admin_change_request",
      author_role: "admin",
      body: "Cambia la última",
      author: { _ref: "admin-1", _type: "reference" },
    });
    // Still mirrored into the legacy archive by the TRANSITION, and only by it.
    expect(op.set).toMatchObject({ admin_notes: "Cambia la última" });
  });

  it("inherits ifRevisionId — UNLIKE the standalone message routes", async () => {
    seed();
    await patchAdmin(PROPOSAL_ID, {
      action: "request_changes",
      rev: "prop-rev-1",
      adminNotes: "Cambia la última",
    });
    const op = patches(committedTransactions()[0])[0];
    // The asymmetry is the point: this note is part of a reviewed decision, so it
    // must not land if the decision does not. A chat message asserts nothing.
    expect(op.rev).toBe("prop-rev-1");
    expect(op.calls.indexOf("setIfMissing")).toBeLessThan(op.calls.indexOf("append"));
  });

  it("a reopen with NO note appends nothing and still commits the status change", async () => {
    seed({ status: "approved" });
    const res = await patchAdmin(PROPOSAL_ID, { action: "reopen", rev: "prop-rev-1" });
    expect(res.status).toBe(200);
    const op = patches(committedTransactions()[0])[0];
    expect(op.appended.messages).toBeUndefined();
    expect(op.calls).not.toContain("append");
    // "Exempt from the cap" is NOT "always appends".
    expect(op.set).toMatchObject({ status: "changes_requested" });
  });

  it("appends even when the thread is FULL — a decision is never blocked", async () => {
    const full = Array.from({ length: 200 }, (_, i) => ({ _key: `k${i}`, kind: "lead_note", body: `m${i}` }));
    seed({ messages: full });
    const res = await patchAdmin(PROPOSAL_ID, {
      action: "request_changes",
      rev: "prop-rev-1",
      adminNotes: "Aun así hay que cambiarla",
    });
    expect(res.status).toBe(200);
    // The standalone routes refuse at 200; the transition is exempt, because a
    // committed `changes_requested` with no reason shown anywhere is worse than
    // a thread one message over its growth bound.
    expect((patches(committedTransactions()[0])[0].appended.messages as unknown[])).toHaveLength(1);
  });

  it("re-opens only an approved proposal", async () => {
    seed({ status: "approved" });
    const res = await patchAdmin(PROPOSAL_ID, { action: "reopen", rev: "prop-rev-1" });
    expect(res.status).toBe(200);
    expect(patches(committedTransactions()[0])[0].set).toMatchObject({
      status: "changes_requested",
      last_transition: { action: "reopen" },
    });

    store = emptyStore();
    seed({ status: "pending" });
    const denied = await patchAdmin(PROPOSAL_ID, { action: "reopen", rev: "prop-rev-1" });
    expect(denied.status).toBe(409);
    expect((await denied.json()).details).toMatchObject({ detail: "source_status" });
  });

  it("replays an already-committed reopen without writing", async () => {
    const intent = {
      action: "reopen" as const,
      proposalId: PROPOSAL_ID,
      toStatus: "changes_requested",
      adminNotes: "",
      targetIdentity: null,
    };
    seed({
      status: "changes_requested",
      last_transition: buildTransitionRecord({ intent, now: "2026-07-24T10:00:00.000Z" }),
    });
    const res = await patchAdmin(PROPOSAL_ID, { action: "reopen", rev: "stale" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ idempotent: true });
    expect(transactions).toHaveLength(0);
  });
});

describe("PATCH /api/admin/proposals/[id] — reconcile_target", () => {
  it("repairs drifted target metadata from the authorized canonical role", async () => {
    store.roles.push(sundayRole());
    store.locks.push(lock());
    // Stored date drifted away from the role's own week.
    store.proposals.push(proposal({ status: "draft", service_date: "2026-08-02" }));
    const res = await patchAdmin(PROPOSAL_ID, { action: "reconcile_target", rev: "prop-rev-1" });
    expect(res.status).toBe(200);
    const op = patches(committedTransactions()[0]).find((o) => o.id === PROPOSAL_ID)!;
    expect(op.rev).toBe("prop-rev-1");
    expect(op.set).toMatchObject({
      service_type: "sunday",
      service_date: WEEK,
      last_transition: { action: "reconcile_target", toStatus: "draft" },
    });
    // Status and review fields are untouched by a retarget.
    expect(op.set).not.toHaveProperty("status");
    expect(op.set).not.toHaveProperty("admin_notes");
    // And it appends NO message: metadata repair is not a decision, so it must
    // not put a bubble in the leads' conversation.
    expect(op.appended.messages).toBeUndefined();
    expect(op.calls).not.toContain("append");
  });

  it("never retargets approved history", async () => {
    store.roles.push(sundayRole());
    store.locks.push(lock());
    store.proposals.push(proposal({ status: "approved", service_date: "2026-08-02" }));
    const res = await patchAdmin(PROPOSAL_ID, { action: "reconcile_target", rev: "prop-rev-1" });
    expect(res.status).toBe(409);
    expect((await res.json()).details).toMatchObject({ detail: "source_status" });
    expect(transactions).toHaveLength(0);
  });

  it("refuses target drift on every other action instead of publishing it", async () => {
    store.roles.push(sundayRole());
    store.locks.push(lock());
    store.proposals.push(proposal({ service_date: "2026-08-02" }));
    const res = await patchAdmin(PROPOSAL_ID, { action: "approve", rev: "prop-rev-1" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "integrity_conflict" });
    expect(transactions).toHaveLength(0);
  });

  it("replays an already-reconciled target without writing", async () => {
    store.roles.push(sundayRole());
    store.locks.push(lock());
    const intent = {
      action: "reconcile_target" as const,
      proposalId: PROPOSAL_ID,
      toStatus: "draft",
      adminNotes: "",
      targetIdentity: `sunday:${WEEK}`,
    };
    store.proposals.push(
      proposal({
        status: "draft",
        last_transition: buildTransitionRecord({ intent, now: "2026-07-24T10:00:00.000Z" }),
      }),
    );
    const res = await patchAdmin(PROPOSAL_ID, { action: "reconcile_target", rev: "stale" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ idempotent: true });
    expect(transactions).toHaveLength(0);
  });
});
