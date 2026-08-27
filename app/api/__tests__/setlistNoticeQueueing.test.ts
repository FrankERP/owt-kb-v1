// The `setlist` and `leadNotes` outbox notices (spec §2/§4), at the route level.
//
// Same conventions as `setlistWriteRoute.test.ts` / `proposalWriteRoutes.test.ts`:
// the Sanity clients are fully mocked, reads are served by an in-memory store
// dispatched off the bound GROQ, and every transaction is recorded — and APPLIED
// to the store on a successful commit. That last part is what makes the
// pre-commit-capture rule testable: by the time a deferred `after()` block runs,
// the store already holds POST-write state, so a `before` snapshot read there
// would equal the after-state and every notice would silently say nothing.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const requireActiveManagerMock = vi.fn();
const requireMinistryMemberMock = vi.fn();
const operationalFetch = vi.fn();
const rawFetch = vi.fn();
const sendPushMock = vi.fn();
const sendAssignmentEmailsBatchMock = vi.fn();
const notifyProposalSubmittedMock = vi.fn();
const revalidateServiceViewsMock = vi.fn();
const revalidatePathMock = vi.fn();
const afterCallbacks: (() => unknown)[] = [];

vi.mock("@/app/utils/authGuards", () => ({
  requireActiveManager: () => requireActiveManagerMock(),
  requireMinistryMember: () => requireMinistryMemberMock(),
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
vi.mock("@/app/utils/email", () => ({ sendEmail: vi.fn(), SEND_CONCURRENCY: 8, SEND_TIMEOUT_MS: 20_000 }));
vi.mock("@/app/utils/proposalNotify", () => ({
  notifyProposalSubmitted: (...a: unknown[]) => notifyProposalSubmittedMock(...a),
}));
// PARTIAL: only the send paths are spied — `rolesForMember` and the allowlist
// helpers stay real, exactly as the role-notice suites keep them.
vi.mock("@/app/utils/assignmentEmail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/utils/assignmentEmail")>()),
  sendAssignmentEmails: vi.fn(),
  sendAssignmentEmailsBatch: (...a: unknown[]) => sendAssignmentEmailsBatchMock(...a),
}));
vi.mock("next/server", async (importOriginal) => {
  const mod = await importOriginal<typeof import("next/server")>();
  return { ...mod, after: (fn: () => unknown) => void afterCallbacks.push(fn) };
});

import { PUT as setlistPUT } from "@/app/api/admin/setlists/route";
import { POST as meProposalPOST } from "@/app/api/me/proposals/route";
import { PATCH as adminProposalPATCH } from "@/app/api/admin/proposals/[id]/route";
import { POST as publishPOST } from "@/app/api/admin/roles/publish/route";
import { outboxId, songRowsFrom } from "@/app/utils/outboxNotice";
// The surviving pure classifier — this is what PRODUCTION's old sweep runs
// during the release window, and composing the seam row with it is what makes
// that row test the seam rather than restate an assertion outboxClassify already
// makes on hand-written strings.
import { classifyLeadNotes } from "@/app/utils/outboxClassify";

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
const commitOutcomes: (Error | undefined)[] = [];

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
        ifRevisionId(rev: string) { op.rev = rev; return p; },
        set(values: Record<string, unknown>) { Object.assign(op.set, values); return p; },
        unset(fields: string[]) { op.unset.push(...fields); return p; },
        // The transition appends its own thread message (Child A §4). This suite
        // is about NOTICE QUEUEING, not about the message, so the chain is
        // completed rather than recorded — `proposalWriteRoutes.test.ts` is where
        // the append and its `setIfMissing` ordering are asserted.
        setIfMissing() { return p; },
        append() { return p; },
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

/** The post-commit `notificationOutbox` upserts (spec §2). */
function outboxUpserts(): Record<string, unknown>[] {
  return transactions
    .filter((t) => t.committed)
    .flatMap((t) => t.ops)
    .filter(
      (o): o is { kind: "createIfNotExists"; doc: Record<string, unknown> } =>
        o.kind === "createIfNotExists",
    )
    .map((o) => o.doc);
}

function upsertedKinds(): unknown[] {
  return outboxUpserts().map((d) => d.kind);
}

function upsertsOfKind(kind: string): Record<string, unknown>[] {
  return outboxUpserts().filter((d) => d.kind === kind);
}

function beforeOf(doc: Record<string, unknown>) {
  return doc.before as { beforeSongs?: unknown[]; beforeNotes?: string; beforeMessageCount?: number };
}

/** Run every registered `after()` callback, including ones they register. */
async function drainAfter(): Promise<void> {
  for (let guard = 0; guard < 10 && afterCallbacks.length; guard++) {
    const batch = afterCallbacks.splice(0);
    for (const cb of batch) await cb();
  }
}

// ── In-memory store ─────────────────────────────────────────────────────────

interface Store {
  roles: Record<string, unknown>[];
  setlists: Record<string, unknown>[];
  proposals: Record<string, unknown>[];
  locks: Record<string, unknown>[];
  members: Record<string, unknown>[];
  rawRoleDrafts: Record<string, unknown>[];
  rawSetlistDrafts: Record<string, unknown>[];
  rawProposalDrafts: Record<string, unknown>[];
  assigned: string[];
}

let store: Store;

function emptyStore(): Store {
  return {
    roles: [],
    setlists: [],
    proposals: [],
    locks: [],
    members: [],
    rawRoleDrafts: [],
    rawSetlistDrafts: [],
    rawProposalDrafts: [],
    assigned: [],
  };
}

function collectionFor(type: unknown): Record<string, unknown>[] {
  if (type === "roleTargetLock") return store.locks;
  if (type === "setlistProposal") return store.proposals;
  if (type === "featuredSongs" || type === "saturdarSongs") return store.setlists;
  if (type === "notificationOutbox") return [];
  return store.roles;
}

function allDocs() {
  return [...store.roles, ...store.setlists, ...store.proposals, ...store.locks];
}

/**
 * Apply a committed transaction, so a follow-up read sees the NEW state. This
 * is deliberate: it is what proves the `before` snapshot was taken pre-commit.
 */
function applyToStore(record: RecordedTx) {
  for (const op of record.ops) {
    if (op.kind === "create" || op.kind === "createIfNotExists") {
      collectionFor(op.doc._type).push({ ...op.doc, _rev: `${String(op.doc._id)}-rev1` });
      continue;
    }
    if (op.kind === "delete") {
      for (const list of [store.roles, store.setlists, store.proposals, store.locks]) {
        const at = list.findIndex((d) => d._id === op.id);
        if (at >= 0) list.splice(at, 1);
      }
      continue;
    }
    const doc = allDocs().find((d) => d._id === op.id);
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
  if (query.includes("setlistProposal")) {
    if (query.includes("_id == $id")) return store.proposals.filter((p) => p._id === params.id);
    return store.proposals.filter(
      (p) =>
        p.service_ref === params.roleId ||
        ((params.dates as string[]) ?? []).includes(p.service_date as string),
    );
  }
  if (query.includes("$setlistTypes") && query.includes("week in $weeks")) {
    return store.setlists.filter((s) => ((params.weeks as string[]) ?? []).includes(s.week as string));
  }
  if (query.includes("$setlistType") && query.includes("week == $week")) {
    return store.setlists.filter((s) => s._type === params.setlistType && s.week === params.week);
  }
  if (query.includes("$roleType") && query.includes("week == $week")) {
    return store.roles.filter((r) => r._type === params.roleType && r.week === params.week);
  }
  if (query.includes("_id == $id")) return store.roles.filter((r) => r._id === params.id);
  if (query.includes("_id in $ids")) {
    return store.roles.filter((r) => ((params.ids as string[]) ?? []).includes(r._id as string));
  }
  throw new Error(`unmocked canonical query: ${query}`);
}

function rawRead(query: string, params: Record<string, unknown>): unknown[] {
  if (query.includes("setlistProposal")) {
    if (query.includes("$draftId")) {
      return store.rawProposalDrafts.filter((d) => d._id === params.draftId);
    }
    return store.rawProposalDrafts;
  }
  if (query.includes("$setlistType")) {
    return store.rawSetlistDrafts.filter(
      (d) => d._type === params.setlistType && d.week === params.week,
    );
  }
  if (query.includes("_id == $draftId")) {
    return store.rawRoleDrafts.filter((d) => d._id === params.draftId);
  }
  if (query.includes("_id in $draftIds")) {
    return store.rawRoleDrafts.filter((d) => ((params.draftIds as string[]) ?? []).includes(d._id as string));
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

const ADMIN = { user: { role: "admin", sanityId: "admin-1" } };
const LEAD = { user: { role: "member", sanityId: "mem-1" } };
const WEEK = "2026-08-09";
const SPECIAL_DATE = "2026-08-20";
const PROPOSAL_ID = "setlistProposal.role-1";

function ref(key: string, id: string) {
  return { _key: key, _type: "reference", _ref: id };
}

function song(key: string, playKey: string, id: string) {
  return { _key: key, play_key: playKey, song: { _type: "reference", _ref: id } };
}

function sundayRole(over: Record<string, unknown> = {}) {
  return {
    _id: "role-1",
    _rev: "role-rev-1",
    _type: "sunday_role",
    week: WEEK,
    published: true,
    Lead: [ref("a1", "mem-1")],
    BGVs: [ref("a2", "mem-2")],
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
    date: SPECIAL_DATE,
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
    songs: [song("s1", "G", "song-1")],
    ...over,
  };
}

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
    lead_notes: "Nota original",
    team_notes: "Salmo 100:2",
    songs: [song("p1", "D", "song-7")],
    ...over,
  };
}

function req(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function setlistBody(over: Record<string, unknown> = {}) {
  return {
    type: "sunday",
    week: WEEK,
    observed: { state: "single", id: `featuredSongs.${WEEK}`, rev: "set-rev-1" },
    songs: [{ songId: "song-2", play_key: "A" }],
    ...over,
  };
}

function saveBody(over: Record<string, unknown> = {}) {
  return {
    roleId: "role-1",
    status: "draft",
    observed: { state: "none" },
    songs: [{ songId: "song-1", play_key: "G" }],
    leadNotes: "Nota original",
    teamNotes: "Salmo 100:2",
    ...over,
  };
}

function patchAdmin(id: string, body: unknown) {
  return adminProposalPATCH(req(body), { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  transactions.length = 0;
  commitOutcomes.length = 0;
  afterCallbacks.length = 0;
  store = emptyStore();
  requireActiveManagerMock.mockResolvedValue(ADMIN);
  requireMinistryMemberMock.mockResolvedValue(LEAD);
  operationalFetch.mockImplementation(async (q: string, p: Record<string, unknown> = {}) =>
    canonicalRead(q, p),
  );
  rawFetch.mockImplementation(async (q: string, p: Record<string, unknown> = {}) => rawRead(q, p));
});

// ════════════════════════════════════════════════════════════════════════════
// The manual live-setlist writer
// ════════════════════════════════════════════════════════════════════════════

describe("PUT /api/admin/setlists — setlist notice", () => {
  function seedWeekend(over: Record<string, unknown> = {}) {
    store.roles.push(sundayRole(over));
    store.locks.push(lock());
    store.setlists.push(setlist());
    store.members.push({ _id: "mem-1" });
    store.assigned = ["mem-1"];
  }

  it("queues a setlist notice with the pre-commit songs", async () => {
    seedWeekend();
    const res = await setlistPUT(req(setlistBody()));
    expect(res.status).toBe(200);
    await drainAfter();

    const notices = upsertsOfKind("setlist");
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      _id: outboxId("setlist", "role-1"),
      _type: "notificationOutbox",
      subjectKey: "role-1",
      roleId: "role-1",
      roleType: "sunday_role",
      memberId: null,
      proposalId: null,
      serviceDate: WEEK,
      status: "pending",
    });
    // song-1 is the PRE-COMMIT list; the store now holds song-2. Reading inside
    // `after()` would have produced song-2 and a notice that says nothing.
    expect(beforeOf(notices[0]).beforeSongs).toEqual(
      songRowsFrom([song("s1", "G", "song-1")]),
    );
    // Participants known at queue time, across the five seat paths.
    expect(notices[0].knownRecipients).toEqual(["mem-1", "mem-2"]);
  });

  it("captures the special role's own stored songs pre-commit", async () => {
    store.roles.push(specialRole({ songs: [song("x1", "E", "song-5")] }));
    store.members.push({ _id: "mem-1" });
    const res = await setlistPUT(
      req(
        setlistBody({
          type: "special",
          roleId: "role-sp",
          week: SPECIAL_DATE,
          observed: { state: "single", id: "role-sp", rev: "role-rev-sp" },
        }),
      ),
    );
    expect(res.status).toBe(200);
    await drainAfter();

    const notices = upsertsOfKind("setlist");
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ subjectKey: "role-sp", roleType: "special_role" });
    expect(beforeOf(notices[0]).beforeSongs).toEqual(
      songRowsFrom([song("x1", "E", "song-5")]),
    );
  });

  it("queues nothing for a draft service", async () => {
    seedWeekend({ published: false });
    expect((await setlistPUT(req(setlistBody()))).status).toBe(200);
    await drainAfter();
    expect(upsertedKinds()).not.toContain("setlist");
  });

  it("queues nothing when no role owns the weekend target", async () => {
    // No role at all: there are no participants to notify, and no id to key on.
    store.setlists.push(setlist());
    store.members.push({ _id: "mem-1" });
    expect((await setlistPUT(req(setlistBody()))).status).toBe(200);
    await drainAfter();
    expect(upsertedKinds()).not.toContain("setlist");
  });

  it("queues nothing when the save leaves the service with no songs", async () => {
    seedWeekend();
    expect((await setlistPUT(req(setlistBody({ songs: [] })))).status).toBe(200);
    await drainAfter();
    expect(upsertedKinds()).not.toContain("setlist");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Publish — the setlist a draft service already carries
// ════════════════════════════════════════════════════════════════════════════

describe("POST /api/admin/roles/publish — setlist notice", () => {
  it("queues on the publish transition with an EMPTY before-snapshot", async () => {
    // Build the setlist while the service is a draft, then publish: without this
    // the member never gets a setlist email at all, and their first one would be
    // "El setlist cambió" on the next edit.
    store.roles.push(sundayRole({ published: false }));
    store.locks.push(lock());
    store.setlists.push(setlist());
    const res = await publishPOST(req({ roles: [{ id: "role-1", rev: "role-rev-1" }], published: true }));
    expect(res.status).toBe(200);
    await drainAfter();

    const notices = upsertsOfKind("setlist");
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ subjectKey: "role-1", roleId: "role-1", roleType: "sunday_role" });
    expect(beforeOf(notices[0]).beforeSongs).toEqual([]);
  });

  it("queues nothing when a published service has no songs", async () => {
    store.roles.push(sundayRole({ published: false }));
    store.locks.push(lock());
    const res = await publishPOST(req({ roles: [{ id: "role-1", rev: "role-rev-1" }], published: true }));
    expect(res.status).toBe(200);
    await drainAfter();
    expect(upsertedKinds()).not.toContain("setlist");
  });

  it("queues nothing on an unpublish", async () => {
    store.roles.push(sundayRole({ published: true }));
    store.locks.push(lock());
    store.setlists.push(setlist());
    const res = await publishPOST(req({ roles: [{ id: "role-1", rev: "role-rev-1" }], published: false }));
    expect(res.status).toBe(200);
    await drainAfter();
    expect(upsertedKinds()).not.toContain("setlist");
  });

  it("carries a special service's inline songs without a setlist document", async () => {
    store.roles.push(specialRole({ published: false, songs: [song("x1", "E", "song-5")] }));
    const res = await publishPOST(req({ roles: [{ id: "role-sp", rev: "role-rev-sp" }], published: true }));
    expect(res.status).toBe(200);
    await drainAfter();

    const notices = upsertsOfKind("setlist");
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ subjectKey: "role-sp", roleType: "special_role" });
    expect(beforeOf(notices[0]).beforeSongs).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// One subject key per service, from BOTH setlist writers
// ════════════════════════════════════════════════════════════════════════════

describe("setlist subject key", () => {
  it("uses the same subject key from the manual writer and the approve path", async () => {
    // Two keys would mean two outbox documents and two emails for one change.
    store.roles.push(sundayRole());
    store.locks.push(lock());
    store.setlists.push(setlist());
    store.members.push({ _id: "mem-1" });
    expect((await setlistPUT(req(setlistBody()))).status).toBe(200);
    await drainAfter();
    const manual = upsertsOfKind("setlist");
    expect(manual).toHaveLength(1);
    const manualKey = manual[0].subjectKey;
    const manualId = manual[0]._id;

    // A second request, on the same service, through the approve path.
    transactions.length = 0;
    afterCallbacks.length = 0;
    store = emptyStore();
    store.roles.push(sundayRole());
    store.locks.push(lock());
    store.proposals.push(proposal());
    const res = await patchAdmin(PROPOSAL_ID, { action: "approve", rev: "prop-rev-1" });
    expect(res.status).toBe(200);
    await drainAfter();
    const approved = upsertsOfKind("setlist");
    expect(approved).toHaveLength(1);
    const approveKey = approved[0].subjectKey;

    expect(manualKey).toBe(approveKey);
    expect(approved[0]._id).toBe(manualId);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// The approve path
// ════════════════════════════════════════════════════════════════════════════

describe("PATCH /api/admin/proposals/[id] — approve queues a setlist notice", () => {
  it("snapshots the live setlist it is about to overwrite, pre-commit", async () => {
    store.roles.push(sundayRole());
    store.locks.push(lock());
    store.setlists.push(setlist());
    store.proposals.push(proposal());
    const res = await patchAdmin(PROPOSAL_ID, { action: "approve", rev: "prop-rev-1" });
    expect(res.status).toBe(200);
    await drainAfter();

    const notices = upsertsOfKind("setlist");
    expect(notices).toHaveLength(1);
    expect(beforeOf(notices[0]).beforeSongs).toEqual(songRowsFrom([song("s1", "G", "song-1")]));
    expect(notices[0].knownRecipients).toEqual(["mem-1", "mem-2"]);
  });

  it("queues nothing when the service is a draft", async () => {
    store.roles.push(sundayRole({ published: false }));
    store.locks.push(lock());
    store.proposals.push(proposal());
    // A draft service is not proposable for a member, but an admin approval of a
    // pre-existing proposal must stay silent all the same.
    const res = await patchAdmin(PROPOSAL_ID, { action: "approve", rev: "prop-rev-1" });
    expect(res.status).toBe(200);
    await drainAfter();
    expect(upsertedKinds()).not.toContain("setlist");
  });

  it("queues nothing for a request_changes transition", async () => {
    store.roles.push(sundayRole());
    store.locks.push(lock());
    store.proposals.push(proposal());
    const res = await patchAdmin(PROPOSAL_ID, {
      action: "request_changes",
      rev: "prop-rev-1",
      adminNotes: "Cambien la tercera",
    });
    expect(res.status).toBe(200);
    await drainAfter();
    expect(outboxUpserts()).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Lead notes
// ════════════════════════════════════════════════════════════════════════════

describe("POST /api/me/proposals — leadNotes notice", () => {
  function seedService() {
    store.roles.push(sundayRole());
    store.locks.push(lock());
  }

  it("queues no leadNotes notice on a first submission", async () => {
    // draft -> pending already sends admins "Nueva propuesta"; queueing here too
    // would mail them twice about one submission.
    seedService();
    const res = await meProposalPOST(req(saveBody({ status: "pending", leadNotes: "Primera nota" })));
    expect(res.status).toBe(200);
    await drainAfter();
    expect(upsertedKinds()).not.toContain("leadNotes");
    expect(notifyProposalSubmittedMock).toHaveBeenCalledTimes(1);
  });

  it("queues no leadNotes notice when an existing DRAFT proposal is submitted", async () => {
    seedService();
    store.proposals.push(proposal({ status: "draft" }));
    const res = await meProposalPOST(
      req(
        saveBody({
          status: "pending",
          leadNotes: "Nota nueva",
          observed: { state: "single", id: PROPOSAL_ID, rev: "prop-rev-1" },
        }),
      ),
    );
    expect(res.status).toBe(200);
    await drainAfter();
    expect(upsertedKinds()).not.toContain("leadNotes");
  });

  it("queues leadNotes when an already-pending proposal's notes change", async () => {
    seedService();
    // MIXED: one lead note and one admin change request. On an all-lead-note
    // thread the whole-array count and the lead-note count agree, so the
    // `beforeMessageCount` assertion below would pass by construction — and the
    // failure it exists to catch only appears on a proposal that has been
    // through a review cycle, which is the normal shape of a `changes_requested`
    // one.
    store.proposals.push(
      proposal({
        status: "pending",
        lead_notes: "Nota original",
        messages: [
          { _key: "m1", _type: "proposal_message", kind: "lead_note", body: "Nota original", author: { _ref: "mem-1" }, author_role: "lead", at: "2026-08-01T10:00:00.000Z" },
          { _key: "m2", _type: "proposal_message", kind: "admin_change_request", body: "Cambia el cierre", author: { _ref: "adm-1" }, author_role: "admin", at: "2026-08-02T10:00:00.000Z" },
        ],
      }),
    );
    const res = await meProposalPOST(
      req(
        saveBody({
          status: "pending",
          leadNotes: "Nota corregida",
          observed: { state: "single", id: PROPOSAL_ID, rev: "prop-rev-1" },
        }),
      ),
    );
    expect(res.status).toBe(200);
    await drainAfter();

    const notices = upsertsOfKind("leadNotes");
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      _id: outboxId("leadNotes", PROPOSAL_ID),
      subjectKey: PROPOSAL_ID,
      proposalId: PROPOSAL_ID,
      memberId: null,
      roleId: null,
      roleType: null,
      serviceDate: WEEK,
    });
    expect(beforeOf(notices[0]).beforeNotes).toBe("Nota original");
    // The compat path snapshots the count too, over the pre-commit thread. This
    // proposal carries a lead note and an admin change request, so the two
    // candidate counts differ and only the lead-note one passes.
    expect(beforeOf(notices[0]).beforeMessageCount).toBe(1);
  });

  it("closes the cutover seam: the snapshot still matches the stored value", async () => {
    // THE SEAM, end to end, and it only became testable when the mirror went
    // away. During the preview→main window production runs the OLD sweep, which
    // compares the notice's `beforeNotes` against the live `lead_notes`. Nothing
    // moves that field any more, so the two agree and `classifyLeadNotes`
    // returns null — silence rather than a stale-content email.
    //
    // The stored value MUST be non-empty. With an empty one both sides are `""`
    // and this passes whether or not the route wrote anything.
    seedService();
    store.proposals.push(
      proposal({
        status: "pending",
        lead_notes: "Nota original",
        messages: [
          { _key: "migleadnote01", _type: "proposal_message", kind: "lead_note", body: "Nota original", author: { _ref: "mem-1" }, author_role: "lead", at: "2026-07-01T00:00:00.000Z" },
        ],
      }),
    );
    const res = await meProposalPOST(
      req(
        saveBody({
          status: "pending",
          leadNotes: "Algo completamente distinto",
          observed: { state: "single", id: PROPOSAL_ID, rev: "prop-rev-1" },
        }),
      ),
    );
    expect(res.status).toBe(200);
    await drainAfter();

    const notices = upsertsOfKind("leadNotes");
    expect(notices).toHaveLength(1);
    const snapshot = beforeOf(notices[0]).beforeNotes;
    expect(snapshot).toBe("Nota original");
    // The route appended a message and left `lead_notes` alone, so the value the
    // old sweep would read is still the value the notice snapshotted.
    const live = store.proposals.find((p) => p._id === PROPOSAL_ID)!.lead_notes as string;
    expect(live).toBe("Nota original");
    // Composed with the surviving pure function, which is what production runs.
    // This fails the moment anything starts writing the mirror again.
    expect(
      classifyLeadNotes({
        before: snapshot ?? "",
        after: live,
        serviceDate: WEEK,
        today: "2026-08-01",
        reviewable: true,
      }),
    ).toBeNull();
  });

  it("queues leadNotes on a changes_requested proposal too", async () => {
    seedService();
    // Carries its migrated message like the others — a document with
    // `lead_notes` and an empty thread does not exist after Child A's --apply,
    // and the append predicate reads the thread now.
    store.proposals.push(
      proposal({
        status: "changes_requested",
        lead_notes: "Nota original",
        messages: [
          { _key: "migleadnote01", _type: "proposal_message", kind: "lead_note", body: "Nota original", author: { _ref: "mem-1" }, author_role: "lead", at: "2026-07-01T00:00:00.000Z" },
        ],
      }),
    );
    const res = await meProposalPOST(
      req(
        saveBody({
          status: "pending",
          leadNotes: "Nota corregida",
          observed: { state: "single", id: PROPOSAL_ID, rev: "prop-rev-1" },
        }),
      ),
    );
    expect(res.status).toBe(200);
    await drainAfter();
    expect(upsertsOfKind("leadNotes")).toHaveLength(1);
  });

  // NOTE for Child B: as of Child A §2 this passes for TWO independent reasons —
  // the save route now declines to append (and so declines to queue) when the
  // note is unchanged, AND `queueLeadNotesNotice` still applies its own
  // trimmed-equal guard. Child B removes the second one. If this test is ever
  // the only evidence for "an unchanged note queues nothing", it will still be
  // green then — but for one reason instead of two, and the caller-side
  // predicate becomes load-bearing on its own.
  it("queues nothing when the notes did not change", async () => {
    seedService();
    // The predicate now compares against the NEWEST `lead_note` message, not the
    // stored `lead_notes` — which nothing writes any more and which is therefore
    // frozen. The migrated message is what a post-`--apply` document actually
    // carries, and it is what makes this an unchanged note rather than a first
    // one. Seeding only the legacy field would test a shape production does not
    // have, and would pass for the wrong reason.
    store.proposals.push(
      proposal({
        status: "pending",
        lead_notes: "Nota original",
        messages: [
          { _key: "migleadnote01", _type: "proposal_message", kind: "lead_note", body: "Nota original", author: { _ref: "mem-1" }, author_role: "lead", at: "2026-07-01T00:00:00.000Z" },
        ],
      }),
    );
    const res = await meProposalPOST(
      req(
        saveBody({
          status: "pending",
          leadNotes: "Nota original",
          observed: { state: "single", id: PROPOSAL_ID, rev: "prop-rev-1" },
        }),
      ),
    );
    expect(res.status).toBe(200);
    await drainAfter();
    expect(upsertedKinds()).not.toContain("leadNotes");
  });
});
