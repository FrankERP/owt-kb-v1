// Server-authoritative publish-ready / override / recover + narrow unpublish
// (Plan B item 3) at the route level.
//
// Same conventions as `roleWriteRoutes.test.ts`: the Sanity clients are fully
// mocked, reads are served by an in-memory store dispatched off the bound GROQ,
// and every transaction is recorded as an operation list so each test can assert
// exactly what would have been committed — or that NOTHING was.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

// The operational client and the publish-ready helpers are `import "server-only"`
// guarded; neutralize the marker so the route modules load under node.
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

import { POST as publishReadyPOST } from "@/app/api/admin/roles/publish-ready/route";
import { POST as unpublishPOST } from "@/app/api/admin/roles/unpublish/route";

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

/**
 * The BUSINESS transactions. The post-commit outbox upsert runs on the same
 * `writeClient`, but never as part of the business transaction (spec §2) — it is
 * the only writer here that uses `createIfNotExists`, so the two are told apart
 * by shape rather than by call order.
 */
function committed() {
  return transactions.filter(
    (t) => t.committed && !t.ops.some((o) => o.kind === "createIfNotExists"),
  );
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

function patches(tx: RecordedTx): PatchOp[] {
  return tx.ops.filter((o): o is PatchOp => o.kind === "patch");
}

function patchFor(tx: RecordedTx, id: string): PatchOp | undefined {
  return patches(tx).find((o) => o.id === id);
}

// ── In-memory store, dispatched off the bound GROQ ──────────────────────────

interface Store {
  roles: Record<string, unknown>[];
  locks: Record<string, unknown>[];
  members: Record<string, unknown>[];
  setlists: Record<string, unknown>[];
  proposals: Record<string, unknown>[];
  rawRoleDrafts: Record<string, unknown>[];
  rawSetlistDrafts: Record<string, unknown>[];
  rawProposalDrafts: Record<string, unknown>[];
}

let store: Store;
/** Substrings of a bound GROQ query whose fetch must fail (a failed A1 domain). */
let failQueries: string[] = [];
/** Every canonical query the request actually issued, for "never read" assertions. */
let canonicalQueries: string[] = [];

function emptyStore(): Store {
  return {
    roles: [],
    locks: [],
    members: [],
    setlists: [],
    proposals: [],
    rawRoleDrafts: [],
    rawSetlistDrafts: [],
    rawProposalDrafts: [],
  };
}

function canonicalRead(query: string, params: Record<string, unknown>): unknown[] {
  canonicalQueries.push(query);
  if (query.includes('_type == "roleTargetLock"')) {
    if (query.includes("_id in $ids")) {
      return store.locks.filter((l) => (params.ids as string[]).includes(l._id as string));
    }
    return store.locks;
  }
  if (query.includes('_type == "teamMembers"')) {
    return store.members.filter((m) => (params.ids as string[]).includes(m._id as string));
  }
  if (query.includes('_type == "setlistProposal"')) return store.proposals;
  if (query.includes("$setlistTypes")) return store.setlists;
  if (query.includes("$roleTypes")) {
    if (query.includes("_id == $id")) return store.roles.filter((r) => r._id === params.id);
    if (query.includes("_id in $ids")) {
      return store.roles.filter((r) => (params.ids as string[]).includes(r._id as string));
    }
    return store.roles;
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
  if (query.includes('_type == "setlistProposal"')) return store.rawProposalDrafts;
  if (query.includes("$setlistTypes")) return store.rawSetlistDrafts;
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
  if (query.includes("$roleTypes")) return store.rawRoleDrafts;
  throw new Error(`unmocked raw query: ${query}`);
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const ADMIN = { user: { role: "admin" } };
const WEEK = "2026-08-09";
const LOCK_ID = `roleTarget.sunday_role.${WEEK}`;

function role(over: Record<string, unknown> = {}) {
  return {
    _id: "role-1",
    _rev: "rev-1",
    _type: "sunday_role",
    week: WEEK,
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
    _id: LOCK_ID,
    _rev: "lock-rev-1",
    _type: "roleTargetLock",
    targetKey: `sunday_role:${WEEK}`,
    state: "claimed",
    roleId: "role-1",
    roleType: "sunday_role",
    date: WEEK,
    claimNonce: "n1",
    generation: 2,
    ...over,
  };
}

function member(over: Record<string, unknown> = {}) {
  return {
    _id: "mem-1",
    _rev: "mem-rev-1",
    member_name: "Ana",
    unavailableDates: [],
    ...over,
  };
}

function song(key = "s1", playKey = "G", ref = "song-1") {
  return { _key: key, play_key: playKey, song: { _type: "reference", _ref: ref } };
}

function setlist(over: Record<string, unknown> = {}) {
  return {
    _id: "set-1",
    _rev: "set-rev-1",
    _type: "featuredSongs",
    week: WEEK,
    songs: [song()],
    ...over,
  };
}

function proposal(over: Record<string, unknown> = {}) {
  return {
    _id: "prop-1",
    _rev: "prop-rev-1",
    _createdAt: "2026-07-01T00:00:00Z",
    service_type: "sunday",
    service_ref: "role-1",
    service_date: WEEK,
    status: "pending",
    songs: [song()],
    contributors: [],
    lead: "mem-1",
    ...over,
  };
}

/** A fully clean, ready-to-publish Sunday draft. */
function seedReady() {
  store.roles = [role()];
  store.locks = [lock()];
  store.members = [member()];
  store.setlists = [setlist()];
}

function req(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

async function json(res: Response) {
  return (await res.json()) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  transactions.length = 0;
  commitOutcomes.length = 0;
  afterCallbacks.length = 0;
  failQueries = [];
  canonicalQueries = [];
  store = emptyStore();
  requireActiveManagerMock.mockResolvedValue(ADMIN);
  operationalFetch.mockImplementation(async (q: string, p: Record<string, unknown> = {}) => {
    if (failQueries.some((s) => q.includes(s))) throw new Error("domain read failed");
    return canonicalRead(q, p);
  });
  rawFetch.mockImplementation(async (q: string, p: Record<string, unknown> = {}) => {
    if (failQueries.some((s) => q.includes(s))) throw new Error("domain read failed");
    return rawRead(q, p);
  });
});

// ── Auth + request contract ─────────────────────────────────────────────────

describe("publish-ready auth and request contract", () => {
  it("rejects an unauthenticated caller and a content-editor", async () => {
    requireActiveManagerMock.mockResolvedValue(null);
    expect((await publishReadyPOST(req({ mode: "ready", roles: [] }))).status).toBe(403);
    requireActiveManagerMock.mockResolvedValue({ user: { role: "content-editor" } });
    expect((await publishReadyPOST(req({ mode: "ready", roles: [] }))).status).toBe(403);
    expect(transactions).toHaveLength(0);
  });

  it("rejects a malformed payload before any read", async () => {
    const bodies: unknown[] = [
      null,
      { roles: [{ id: "role-1", rev: "rev-1" }] }, // no mode
      { mode: "publish", roles: [{ id: "role-1", rev: "rev-1" }] },
      { mode: "ready", roles: [] },
      { mode: "ready", roles: [{ id: "role-1" }] }, // no rev
      { mode: "ready", roles: [{ id: "drafts.role-1", rev: "rev-1" }] },
      { mode: "ready", roles: [{ id: "role-1", rev: "rev-1" }, { id: "role-1", rev: "rev-1" }] },
      // A bulk submission acknowledges nothing.
      { mode: "ready", roles: [{ id: "role-1", rev: "rev-1", acknowledgedBlockers: ["team_empty"] }] },
      // Override is the individual button: exactly one service.
      {
        mode: "override",
        roles: [
          { id: "role-1", rev: "rev-1", acknowledgedBlockers: [] },
          { id: "role-2", rev: "rev-2", acknowledgedBlockers: [] },
        ],
      },
      // A hard blocker code is never an acknowledgeable workflow blocker.
      {
        mode: "override",
        roles: [{ id: "role-1", rev: "rev-1", acknowledgedBlockers: ["invalid_record"] }],
      },
      { mode: "recover", roles: [{ id: "role-1" }] }, // no `published`
    ];
    for (const body of bodies) {
      const res = await publishReadyPOST(req(body));
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect((await json(res)).error).toBe("invalid_request");
    }
    expect(operationalFetch).not.toHaveBeenCalled();
    expect(transactions).toHaveLength(0);
  });
});

// ── Ready mode: the guard bundle ────────────────────────────────────────────

describe("publish-ready ready mode", () => {
  it("publishes a clean draft in ONE transaction that asserts every observed revision", async () => {
    seedReady();
    const res = await publishReadyPOST(req({ mode: "ready", roles: [{ id: "role-1", rev: "rev-1" }] }));
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ ok: true, mode: "ready", published: 1 });

    expect(committed()).toHaveLength(1);
    const tx = committed()[0];
    // role + lock + setlist + member, each guarded, and NOTHING else.
    expect(patches(tx)).toHaveLength(4);
    expect(patchFor(tx, "role-1")).toEqual({
      kind: "patch",
      id: "role-1",
      rev: "rev-1",
      // The role's own assertion carries the publication flip: one document, one
      // revision guard. `_type` is never written.
      set: { week: WEEK, published: true },
      unset: [],
    });
    expect(patchFor(tx, LOCK_ID)).toMatchObject({ rev: "lock-rev-1", set: {} });
    expect(patchFor(tx, "set-1")).toMatchObject({ rev: "set-rev-1", set: { week: WEEK } });
    expect(patchFor(tx, "mem-1")).toEqual({
      kind: "patch",
      id: "mem-1",
      rev: "mem-rev-1",
      set: { unavailableDates: [] },
      unset: [],
    });
    expect(revalidatePathMock).toHaveBeenCalled();
  });

  it("asserts an ABSENT member availability field by unsetting it, changing no data", async () => {
    seedReady();
    store.members = [{ _id: "mem-1", _rev: "mem-rev-1", member_name: "Ana" }];
    const res = await publishReadyPOST(req({ mode: "ready", roles: [{ id: "role-1", rev: "rev-1" }] }));
    expect(res.status).toBe(200);
    expect(patchFor(committed()[0], "mem-1")).toEqual({
      kind: "patch",
      id: "mem-1",
      rev: "mem-rev-1",
      set: {},
      unset: ["unavailableDates"],
    });
  });

  it("covers every one of the five seat paths in the member guard bundle", async () => {
    seedReady();
    store.roles = [
      role({
        Lead: [{ _key: "k1", _type: "reference", _ref: "mem-1" }],
        BGVs: [{ _key: "k2", _type: "reference", _ref: "mem-2" }],
        Chorus: [{ _key: "k3", _type: "reference", _ref: "mem-3" }],
        instruments: [
          {
            _key: "k4",
            _type: "instrument_slot",
            instrument: "Bajo",
            person: { _type: "reference", _ref: "mem-4" },
          },
        ],
        foh_team: [
          {
            _key: "k5",
            _type: "foh_slot",
            role: "Audio",
            person: { _type: "reference", _ref: "mem-5" },
          },
        ],
      }),
    ];
    store.members = [1, 2, 3, 4, 5].map((n) =>
      member({ _id: `mem-${n}`, _rev: `mem-rev-${n}` }),
    );
    const res = await publishReadyPOST(req({ mode: "ready", roles: [{ id: "role-1", rev: "rev-1" }] }));
    expect(res.status).toBe(200);
    const memberOps = patches(committed()[0]).filter((o) => o.id.startsWith("mem-"));
    expect(memberOps.map((o) => `${o.id}@${o.rev}`).sort()).toEqual([
      "mem-1@mem-rev-1",
      "mem-2@mem-rev-2",
      "mem-3@mem-rev-3",
      "mem-4@mem-rev-4",
      "mem-5@mem-rev-5",
    ]);
  });

  it("takes no weekend lock for a special service and needs no separate setlist op", async () => {
    store.roles = [
      {
        _id: "sp-1",
        _rev: "sp-rev-1",
        _type: "special_role",
        date: "2026-08-15",
        service_name: "Bautismos",
        published: false,
        songs: [song()],
        Lead: [{ _key: "k1", _type: "reference", _ref: "mem-1" }],
        BGVs: [],
        Chorus: [],
        instruments: [],
        foh_team: [],
      },
    ];
    store.members = [member()];
    const res = await publishReadyPOST(req({ mode: "ready", roles: [{ id: "sp-1", rev: "sp-rev-1" }] }));
    expect(res.status).toBe(200);
    const tx = committed()[0];
    expect(patches(tx)).toHaveLength(2);
    expect(patchFor(tx, "sp-1")).toMatchObject({
      rev: "sp-rev-1",
      set: { date: "2026-08-15", published: true },
    });
    expect(patchFor(tx, "mem-1")).toBeDefined();
  });

  it("notifies every current assignee of a real false -> true transition, once", async () => {
    seedReady();
    await publishReadyPOST(req({ mode: "ready", roles: [{ id: "role-1", rev: "rev-1" }] }));
    // Two deliberately separate deferred blocks (spec §2): the immediate publish
    // fan-out, and the post-commit outbox upsert asserted in the next test.
    expect(afterCallbacks).toHaveLength(2);
    for (const cb of afterCallbacks) await cb();
    expect(sendPushMock).toHaveBeenCalledTimes(1);
    expect(sendPushMock.mock.calls[0][0]).toEqual(["mem-1"]);
    expect(sendAssignmentEmailsBatchMock).toHaveBeenCalledTimes(1);
  });

  it("queues a setlist notice with an EMPTY before-snapshot, like the other publish surface", async () => {
    // This is the second publish surface. Without this rule a service built as a
    // draft and then published sends no setlist email at all, and the member's
    // first one would be "El setlist cambió" on the next edit.
    seedReady();
    await publishReadyPOST(req({ mode: "ready", roles: [{ id: "role-1", rev: "rev-1" }] }));
    for (const cb of afterCallbacks) await cb();
    const notices = outboxUpserts().filter((d) => d.kind === "setlist");
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      _type: "notificationOutbox",
      subjectKey: "role-1",
      roleId: "role-1",
      roleType: "sunday_role",
      serviceDate: WEEK,
      knownRecipients: ["mem-1"],
    });
    expect((notices[0].before as { beforeSongs: unknown[] }).beforeSongs).toEqual([]);
  });

  it("queues no setlist notice when the published service has no songs", async () => {
    seedReady();
    store.setlists = [];
    const res = await publishReadyPOST(
      req({
        mode: "override",
        roles: [{ id: "role-1", rev: "rev-1", acknowledgedBlockers: ["incomplete_setlist"] }],
      }),
    );
    expect(res.status).toBe(200);
    for (const cb of afterCallbacks) await cb();
    expect(outboxUpserts().filter((d) => d.kind === "setlist")).toHaveLength(0);
  });
});

// ── Races between compute and commit ────────────────────────────────────────

describe("publish-ready races", () => {
  async function submitReady(id = "role-1", rev = "rev-1") {
    return publishReadyPOST(req({ mode: "ready", roles: [{ id, rev }] }));
  }

  it("refuses when a proposal appeared after the client's clean observation", async () => {
    seedReady();
    store.proposals = [proposal()];
    const res = await submitReady();
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body.error).toBe("stale_revision");
    expect(body.conflict).toBe(true);
    const services = (body.details as { services: Record<string, unknown>[] }).services;
    expect(services[0]).toMatchObject({
      id: "role-1",
      reasons: ["not_ready"],
      workflowBlockers: ["active_proposal"],
    });
    expect(committed()).toHaveLength(0);
  });

  it("refuses when a raw proposal draft appeared — a hard integrity blocker", async () => {
    seedReady();
    store.rawProposalDrafts = [proposal({ _id: "drafts.prop-1" })];
    const res = await submitReady();
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body.error).toBe("integrity_conflict");
    expect(
      (body.details as { services: { hardBlockers: string[] }[] }).services[0].hardBlockers,
    ).toContain("proposal_draft_conflict");
    expect(committed()).toHaveLength(0);
  });

  it("refuses when the setlist changed to incomplete after readiness was computed", async () => {
    seedReady();
    store.setlists = [setlist({ _rev: "set-rev-2", songs: [song("s1", "")] })];
    const res = await submitReady();
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(
      (body.details as { services: { workflowBlockers: string[] }[] }).services[0].workflowBlockers,
    ).toEqual(["incomplete_setlist"]);
    expect(committed()).toHaveLength(0);
  });

  it("refuses when the setlist became duplicated — never an arbitrary pick", async () => {
    seedReady();
    store.setlists = [setlist(), setlist({ _id: "set-2", _rev: "set-rev-2" })];
    const res = await submitReady();
    expect(res.status).toBe(409);
    expect((await json(res)).error).toBe("integrity_conflict");
    expect(committed()).toHaveLength(0);
  });

  it("refuses when a member marked the service day unavailable after selection", async () => {
    seedReady();
    store.members = [member({ _rev: "mem-rev-2", unavailableDates: [WEEK] })];
    const res = await submitReady();
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(
      (body.details as { services: { workflowBlockers: string[] }[] }).services[0].workflowBlockers,
    ).toEqual(["availability_conflict"]);
    expect(committed()).toHaveLength(0);
  });

  it("refuses when the role itself was edited (observed revision moved)", async () => {
    seedReady();
    store.roles = [role({ _rev: "rev-2" })];
    const res = await submitReady("role-1", "rev-1");
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body.error).toBe("stale_revision");
    expect((body.details as { services: Record<string, unknown>[] }).services[0]).toMatchObject({
      reasons: ["stale_revision"],
      storedRev: "rev-2",
      observedRev: "rev-1",
    });
    expect(committed()).toHaveLength(0);
  });

  it("answers 404 when the role was deleted between compute and submit", async () => {
    seedReady();
    store.roles = [];
    const res = await submitReady();
    expect(res.status).toBe(404);
    expect((await json(res)).error).toBe("not_found");
    expect(committed()).toHaveLength(0);
  });

  it("refuses when a member reference went dangling", async () => {
    seedReady();
    store.members = [];
    const res = await submitReady();
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body.error).toBe("integrity_conflict");
    expect(
      (body.details as { services: { hardBlockers: string[] }[] }).services[0].hardBlockers,
    ).toContain("dangling_assignment");
    expect(committed()).toHaveLength(0);
  });

  it("refuses a duplicate role target instead of publishing one of them", async () => {
    seedReady();
    store.roles = [role(), role({ _id: "role-2", _rev: "rev-2" })];
    const res = await submitReady();
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(
      (body.details as { services: { hardBlockers: string[] }[] }).services[0].hardBlockers,
    ).toContain("role_target_duplicate");
    expect(committed()).toHaveLength(0);
  });

  it("refuses a draft-conflicted role identity", async () => {
    seedReady();
    store.rawRoleDrafts = [role({ _id: "drafts.role-1" })];
    const res = await submitReady();
    expect(res.status).toBe(409);
    expect((await json(res)).error).toBe("integrity_conflict");
    expect(committed()).toHaveLength(0);
  });

  it("refuses a weekend role whose coordination token is missing — an A2 cleanup requirement", async () => {
    seedReady();
    store.locks = [];
    const res = await submitReady();
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body.error).toBe("integrity_conflict");
    expect(
      (body.details as { services: { hardBlockers: string[] }[] }).services[0].hardBlockers,
    ).toContain("cleanup_required");
    expect(committed()).toHaveLength(0);
  });

  it("refuses a weekend role whose token is claimed by another role", async () => {
    seedReady();
    store.roles = [role(), role({ _id: "role-9", _rev: "r9", week: "2026-08-16" })];
    store.locks = [lock({ roleId: "role-9" })];
    const res = await submitReady();
    expect(res.status).toBe(409);
    expect((await json(res)).error).toBe("integrity_conflict");
    expect(committed()).toHaveLength(0);
  });

  it("refuses when an A1 source failed to reload — an unknown source is never `clear`", async () => {
    seedReady();
    failQueries = ['_type == "setlistProposal"'];
    const res = await submitReady();
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body.error).toBe("integrity_conflict");
    expect(
      (body.details as { services: { hardBlockers: string[] }[] }).services[0].hardBlockers,
    ).toContain("source_unready");
    expect(committed()).toHaveLength(0);
  });

  it("refuses a service that is already published", async () => {
    seedReady();
    store.roles = [role({ published: true })];
    const res = await submitReady();
    expect(res.status).toBe(409);
    expect(
      ((await json(res)).details as { services: { reasons: string[] }[] }).services[0].reasons,
    ).toContain("already_published");
    expect(committed()).toHaveLength(0);
  });

  it("reports a guard conflict at commit as 409 and commits nothing", async () => {
    seedReady();
    commitOutcomes.push(conflictError());
    const res = await submitReady();
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body.error).toBe("stale_revision");
    expect((body.details as { guard: string }).guard).toBe("publish_ready_assertions");
    expect(transactions).toHaveLength(1);
    expect(committed()).toHaveLength(0);
    // A failed commit runs no side effects at all.
    expect(afterCallbacks).toHaveLength(0);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("rethrows a non-conflict transport failure instead of reporting a stale view", async () => {
    seedReady();
    commitOutcomes.push(new Error("network down"));
    await expect(submitReady()).rejects.toThrow("network down");
    expect(committed()).toHaveLength(0);
  });
});

// ── Atomic batches ──────────────────────────────────────────────────────────

describe("publish-ready atomic batches", () => {
  function seedSecondService(over: Record<string, unknown> = {}) {
    const week2 = "2026-08-16";
    store.roles.push(
      role({ _id: "role-2", _rev: "rev-2", week: week2, ...over }),
    );
    store.locks.push(
      lock({
        _id: `roleTarget.sunday_role.${week2}`,
        _rev: "lock-rev-2",
        targetKey: `sunday_role:${week2}`,
        roleId: "role-2",
        date: week2,
      }),
    );
    store.setlists.push(setlist({ _id: "set-2", _rev: "set-rev-2", week: week2 }));
    return week2;
  }

  it("publishes a whole ready batch in ONE transaction", async () => {
    seedReady();
    const week2 = seedSecondService();
    const res = await publishReadyPOST(
      req({
        mode: "ready",
        roles: [
          { id: "role-1", rev: "rev-1" },
          { id: "role-2", rev: "rev-2" },
        ],
      }),
    );
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ published: 2 });
    expect(committed()).toHaveLength(1);
    const tx = committed()[0];
    expect(patchFor(tx, "role-1")?.set).toEqual({ week: WEEK, published: true });
    expect(patchFor(tx, "role-2")?.set).toEqual({ week: week2, published: true });
    // Both services share one member: exactly ONE guarded member op, because two
    // `ifRevisionId` patches on one document in one transaction cannot both hold.
    expect(patches(tx).filter((o) => o.id === "mem-1")).toHaveLength(1);
    // 2 roles + 2 locks + 2 setlists + 1 shared member.
    expect(patches(tx)).toHaveLength(7);
    expect(patches(tx).every((o) => typeof o.rev === "string" && o.rev.length > 0)).toBe(true);
  });

  it("publishes NONE of the batch when any one service is no longer ready", async () => {
    seedReady();
    seedSecondService();
    // role-2's setlist is now incomplete.
    store.setlists = store.setlists.map((s) =>
      s._id === "set-2" ? setlist({ _id: "set-2", _rev: "set-rev-2", week: "2026-08-16", songs: [song("s1", "")] }) : s,
    );
    const res = await publishReadyPOST(
      req({
        mode: "ready",
        roles: [
          { id: "role-1", rev: "rev-1" },
          { id: "role-2", rev: "rev-2" },
        ],
      }),
    );
    expect(res.status).toBe(409);
    const services = ((await json(res)).details as { services: { id: string }[] }).services;
    expect(services.map((s) => s.id)).toEqual(["role-2"]);
    expect(committed()).toHaveLength(0);
    expect(transactions).toHaveLength(0);
  });

  it("publishes NONE of the batch when one submitted role vanished", async () => {
    seedReady();
    const res = await publishReadyPOST(
      req({
        mode: "ready",
        roles: [
          { id: "role-1", rev: "rev-1" },
          { id: "role-gone", rev: "rev-x" },
        ],
      }),
    );
    expect(res.status).toBe(409);
    const services = ((await json(res)).details as { services: { id: string; reasons: string[] }[] })
      .services;
    expect(services).toEqual([{ id: "role-gone", reasons: ["not_found"] }]);
    expect(transactions).toHaveLength(0);
  });

  it("rolls the whole batch back on a single guard conflict", async () => {
    seedReady();
    seedSecondService();
    commitOutcomes.push(conflictError("documentRevisionIDDoesNotMatchError", "mem-1"));
    const res = await publishReadyPOST(
      req({
        mode: "ready",
        roles: [
          { id: "role-1", rev: "rev-1" },
          { id: "role-2", rev: "rev-2" },
        ],
      }),
    );
    expect(res.status).toBe(409);
    expect(committed()).toHaveLength(0);
    expect(afterCallbacks).toHaveLength(0);
  });
});

// ── Override mode ───────────────────────────────────────────────────────────

describe("publish-ready override mode", () => {
  function override(acknowledged: string[], id = "role-1", rev = "rev-1") {
    return publishReadyPOST(
      req({ mode: "override", roles: [{ id, rev, acknowledgedBlockers: acknowledged }] }),
    );
  }

  it("publishes over an acknowledged empty team", async () => {
    seedReady();
    store.roles = [role({ Lead: [] })];
    const res = await override(["team_empty"]);
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ ok: true, mode: "override", published: 1 });
    const tx = committed()[0];
    expect(patchFor(tx, "role-1")?.set).toEqual({ week: WEEK, published: true });
    // No assigned members, so no member ops — only role + lock + setlist.
    expect(patches(tx)).toHaveLength(3);
  });

  it("publishes over an acknowledged ABSENT setlist, with the token protecting the absence", async () => {
    seedReady();
    store.setlists = [];
    const res = await override(["incomplete_setlist"]);
    expect(res.status).toBe(200);
    const tx = committed()[0];
    // An explicit `none`: no setlist op, but the weekend coordination token IS
    // asserted, so a setlist created after that observation makes this refuse.
    expect(patches(tx).map((o) => o.id).sort()).toEqual([LOCK_ID, "mem-1", "role-1"].sort());
    expect(patchFor(tx, LOCK_ID)).toMatchObject({ rev: "lock-rev-1" });
  });

  it("publishes over an acknowledged availability conflict and active proposal together", async () => {
    seedReady();
    store.members = [member({ unavailableDates: [WEEK] })];
    store.proposals = [proposal()];
    const res = await override(["availability_conflict", "active_proposal"]);
    expect(res.status).toBe(200);
    const tx = committed()[0];
    // The acknowledged proposal's own revision is still asserted.
    expect(patchFor(tx, "prop-1")).toMatchObject({
      rev: "prop-rev-1",
      set: { service_date: WEEK },
    });
    // Availability is written back unchanged under its revision — a data no-op.
    expect(patchFor(tx, "mem-1")).toMatchObject({
      rev: "mem-rev-1",
      set: { unavailableDates: [WEEK] },
    });
  });

  it("rejects the override when the server's blocker set grew", async () => {
    seedReady();
    store.roles = [role({ Lead: [] })];
    store.proposals = [proposal()]; // the client never saw this
    const res = await override(["team_empty"]);
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body.error).toBe("stale_revision");
    const service = (body.details as { services: Record<string, unknown>[] }).services[0];
    expect(service.reasons).toEqual(["blocker_set_changed"]);
    expect(service.workflowBlockers).toEqual(["active_proposal", "team_empty"]);
    expect(committed()).toHaveLength(0);
  });

  it("rejects the override when the server's blocker set shrank", async () => {
    seedReady();
    const res = await override(["team_empty"]); // already resolved server-side
    expect(res.status).toBe(409);
    expect(
      ((await json(res)).details as { services: { reasons: string[] }[] }).services[0].reasons,
    ).toEqual(["blocker_set_changed"]);
    expect(committed()).toHaveLength(0);
  });

  it("rejects the override when a workflow blocker was swapped for another", async () => {
    seedReady();
    store.setlists = [setlist({ songs: [song("s1", "")] })];
    const res = await override(["team_empty"]);
    expect(res.status).toBe(409);
    expect(committed()).toHaveLength(0);
  });

  it("never lets an override past a hard integrity blocker, however acknowledged", async () => {
    for (const seed of [
      () => {
        store.roles = [role(), role({ _id: "role-2", _rev: "rev-2" })];
      },
      () => {
        store.members = [];
      },
      () => {
        store.rawRoleDrafts = [role({ _id: "drafts.role-1" })];
      },
      () => {
        store.setlists = [setlist(), setlist({ _id: "set-2", _rev: "set-rev-2" })];
      },
      () => {
        store.locks = [];
      },
      () => {
        failQueries = ["$setlistTypes"];
      },
    ]) {
      transactions.length = 0;
      failQueries = [];
      store = emptyStore();
      seedReady();
      seed();
      const res = await override(["team_empty", "incomplete_setlist", "active_proposal"]);
      expect(res.status).toBe(409);
      expect((await json(res)).error).toBe("integrity_conflict");
      expect(committed()).toHaveLength(0);
    }
  });

  it("accepts an empty acknowledgement set for an already-clean draft", async () => {
    seedReady();
    const res = await override([]);
    expect(res.status).toBe(200);
    expect(committed()).toHaveLength(1);
  });
});

// ── Lost-outcome recovery (publish-ready) ───────────────────────────────────

describe("publish-ready recover mode", () => {
  it("reports recovered success without any second mutation", async () => {
    seedReady();
    store.roles = [role({ published: true })];
    const res = await publishReadyPOST(
      req({ mode: "recover", published: true, roles: [{ id: "role-1" }] }),
    );
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ ok: true, outcome: "recovered" });
    expect(transactions).toHaveLength(0);
  });

  it("keeps the outcome explicit and requires a fresh retry when nothing committed", async () => {
    seedReady();
    const res = await publishReadyPOST(
      req({ mode: "recover", published: true, roles: [{ id: "role-1" }] }),
    );
    expect(res.status).toBe(409);
    const body = await json(res);
    expect((body.details as { outcome: string }).outcome).toBe("not_in_requested_state");
    expect(transactions).toHaveLength(0);
  });

  it("does not infer success from a partially committed batch", async () => {
    seedReady();
    store.roles = [role({ published: true }), role({ _id: "role-2", _rev: "rev-2", week: "2026-08-16" })];
    store.locks.push(
      lock({
        _id: "roleTarget.sunday_role.2026-08-16",
        _rev: "lock-rev-2",
        targetKey: "sunday_role:2026-08-16",
        roleId: "role-2",
        date: "2026-08-16",
      }),
    );
    const res = await publishReadyPOST(
      req({ mode: "recover", published: true, roles: [{ id: "role-1" }, { id: "role-2" }] }),
    );
    expect(res.status).toBe(409);
    expect(transactions).toHaveLength(0);
  });

  it("stays `unknown` when the recovery refetch itself fails", async () => {
    seedReady();
    failQueries = ["$roleTypes"];
    const res = await publishReadyPOST(
      req({ mode: "recover", published: true, roles: [{ id: "role-1" }] }),
    );
    expect(res.status).toBe(503);
    expect(await json(res)).toMatchObject({ error: "unknown_outcome", outcome: "unknown" });
    expect(transactions).toHaveLength(0);
  });

  it("reports a vanished role as `missing`, never as recovered", async () => {
    seedReady();
    store.roles = [];
    const res = await publishReadyPOST(
      req({ mode: "recover", published: true, roles: [{ id: "role-1" }] }),
    );
    expect(res.status).toBe(409);
    const services = ((await json(res)).details as { services: { publishState: string }[] }).services;
    expect(services[0].publishState).toBe("missing");
    expect(transactions).toHaveLength(0);
  });
});

// ── Narrow unpublish ────────────────────────────────────────────────────────

describe("unpublish is a separate, narrow safety capability", () => {
  /** A published service whose team, availability, setlist AND proposal are unsafe. */
  function seedUnsafePublished() {
    store.roles = [
      role({
        published: true,
        Lead: [{ _key: "k1", _type: "reference", _ref: "mem-gone" }],
      }),
    ];
    store.locks = [lock()];
    store.members = [];
    store.setlists = [setlist(), setlist({ _id: "set-2", _rev: "set-rev-2" })];
    store.proposals = [proposal(), proposal({ _id: "prop-2", _rev: "prop-rev-2" })];
    store.rawProposalDrafts = [proposal({ _id: "drafts.prop-3" })];
    store.rawSetlistDrafts = [setlist({ _id: "drafts.set-1" })];
  }

  it("rejects an unauthenticated caller and a content-editor", async () => {
    requireActiveManagerMock.mockResolvedValue(null);
    expect((await unpublishPOST(req({ roles: [] }))).status).toBe(403);
    requireActiveManagerMock.mockResolvedValue({ user: { role: "content-editor" } });
    expect((await unpublishPOST(req({ roles: [] }))).status).toBe(403);
    expect(transactions).toHaveLength(0);
  });

  it("refuses blocker acknowledgements and refuses to publish", async () => {
    for (const body of [
      { roles: [{ id: "role-1", rev: "rev-1" }], published: true },
      { roles: [{ id: "role-1", rev: "rev-1" }], acknowledgedBlockers: ["team_empty"] },
      { roles: [{ id: "role-1", rev: "rev-1", acknowledgedBlockers: [] }] },
      { roles: [{ id: "role-1" }] },
      { mode: "override", roles: [{ id: "role-1", rev: "rev-1" }] },
    ]) {
      const res = await unpublishPOST(req(body));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(transactions).toHaveLength(0);
  });

  it("hides a published service whose readiness is deeply unsafe", async () => {
    seedUnsafePublished();
    const res = await unpublishPOST(req({ roles: [{ id: "role-1", rev: "rev-1" }] }));
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ ok: true, unpublished: 1 });
    const tx = committed()[0];
    expect(patchFor(tx, "role-1")).toEqual({
      kind: "patch",
      id: "role-1",
      rev: "rev-1",
      set: { published: false },
      unset: [],
    });
    // The weekend token is heartbeated under its observed revision.
    expect(patchFor(tx, LOCK_ID)?.rev).toBe("lock-rev-1");
    // No member, setlist or proposal observation is required — or read.
    expect(canonicalQueries.some((q) => q.includes("$setlistTypes"))).toBe(false);
    expect(canonicalQueries.some((q) => q.includes('_type == "setlistProposal"'))).toBe(false);
    expect(canonicalQueries.some((q) => q.includes('_type == "teamMembers"'))).toBe(false);
    // Hiding a service is silent (A2 §7): only a real false -> true notifies.
    expect(afterCallbacks).toHaveLength(0);
    expect(revalidatePathMock).toHaveBeenCalled();
  });

  it("hides a legacy service whose `published` field is absent", async () => {
    store.roles = [role({ published: undefined })];
    store.locks = [lock()];
    const res = await unpublishPOST(req({ roles: [{ id: "role-1", rev: "rev-1" }] }));
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ unpublished: 1 });
    expect(patchFor(committed()[0], "role-1")?.set).toEqual({ published: false });
  });

  it("is a silent no-op for a service that is already hidden", async () => {
    store.roles = [role({ published: false })];
    store.locks = [lock()];
    const res = await unpublishPOST(req({ roles: [{ id: "role-1", rev: "rev-1" }] }));
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ unpublished: 0 });
    expect(transactions).toHaveLength(0);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("is unaffected by an unrelated A1 source failure", async () => {
    seedUnsafePublished();
    failQueries = ['_type == "setlistProposal"', "$setlistTypes", '_type == "teamMembers"'];
    const res = await unpublishPOST(req({ roles: [{ id: "role-1", rev: "rev-1" }] }));
    expect(res.status).toBe(200);
    expect(committed()).toHaveLength(1);
  });

  it("fails closed on a stale observed role revision", async () => {
    seedUnsafePublished();
    const res = await unpublishPOST(req({ roles: [{ id: "role-1", rev: "rev-stale" }] }));
    expect(res.status).toBe(409);
    expect((await json(res)).error).toBe("stale_revision");
    expect(transactions).toHaveLength(0);
  });

  it("fails closed on a draft-conflicted role identity", async () => {
    seedUnsafePublished();
    store.rawRoleDrafts = [role({ _id: "drafts.role-1" })];
    const res = await unpublishPOST(req({ roles: [{ id: "role-1", rev: "rev-1" }] }));
    expect(res.status).toBe(409);
    expect((await json(res)).error).toBe("integrity_conflict");
    expect(transactions).toHaveLength(0);
  });

  it("fails closed on a duplicate service target", async () => {
    seedUnsafePublished();
    store.roles.push(role({ _id: "role-2", _rev: "rev-2", published: true }));
    const res = await unpublishPOST(req({ roles: [{ id: "role-1", rev: "rev-1" }] }));
    expect(res.status).toBe(409);
    expect((await json(res)).error).toBe("ambiguous_target");
    expect(transactions).toHaveLength(0);
  });

  it("fails closed on a raw draft occupying the same target", async () => {
    seedUnsafePublished();
    store.rawRoleDrafts = [role({ _id: "drafts.role-9" })];
    const res = await unpublishPOST(req({ roles: [{ id: "role-1", rev: "rev-1" }] }));
    expect(res.status).toBe(409);
    expect((await json(res)).error).toBe("integrity_conflict");
    expect(transactions).toHaveLength(0);
  });

  it("fails closed when the weekend token is owned by another role", async () => {
    seedUnsafePublished();
    store.roles.push(role({ _id: "role-9", _rev: "r9", week: "2026-08-16", published: true }));
    store.locks = [lock({ roleId: "role-9" })];
    const res = await unpublishPOST(req({ roles: [{ id: "role-1", rev: "rev-1" }] }));
    expect(res.status).toBe(409);
    expect((await json(res)).error).toBe("integrity_conflict");
    expect(transactions).toHaveLength(0);
  });

  it("fails closed when the role id resolves to nothing", async () => {
    const res = await unpublishPOST(req({ roles: [{ id: "role-1", rev: "rev-1" }] }));
    expect(res.status).toBe(404);
    expect(transactions).toHaveLength(0);
  });

  it("reports a commit conflict as 409 and commits nothing", async () => {
    seedUnsafePublished();
    commitOutcomes.push(conflictError());
    const res = await unpublishPOST(req({ roles: [{ id: "role-1", rev: "rev-1" }] }));
    expect(res.status).toBe(409);
    expect((await json(res)).error).toBe("stale_revision");
    expect(committed()).toHaveLength(0);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("hides a batch atomically, refusing all of it when one target is unsafe", async () => {
    seedUnsafePublished();
    store.roles.push(role({ _id: "role-2", _rev: "rev-2", week: "2026-08-16", published: true }));
    // role-2 has no coordination token at all → nothing may be written.
    const res = await unpublishPOST(
      req({
        roles: [
          { id: "role-1", rev: "rev-1" },
          { id: "role-2", rev: "rev-stale" },
        ],
      }),
    );
    expect(res.status).toBe(409);
    expect(transactions).toHaveLength(0);
  });
});

describe("unpublish recover mode", () => {
  it("treats an observed draft state as recovered success, sending no repeat", async () => {
    store.roles = [role({ published: false })];
    const res = await unpublishPOST(req({ mode: "recover", roles: [{ id: "role-1" }] }));
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ ok: true, outcome: "recovered" });
    expect(transactions).toHaveLength(0);
  });

  it("requires an explicit retry when the service is still published", async () => {
    store.roles = [role({ published: true })];
    const res = await unpublishPOST(req({ mode: "recover", roles: [{ id: "role-1" }] }));
    expect(res.status).toBe(409);
    expect(
      ((await json(res)).details as { outcome: string }).outcome,
    ).toBe("not_in_requested_state");
    expect(transactions).toHaveLength(0);
  });

  it("stays `unknown` when the identity refetch fails", async () => {
    store.roles = [role({ published: false })];
    failQueries = ["$roleTypes"];
    const res = await unpublishPOST(req({ mode: "recover", roles: [{ id: "role-1" }] }));
    expect(res.status).toBe(503);
    expect(await json(res)).toMatchObject({ outcome: "unknown" });
    expect(transactions).toHaveLength(0);
  });

  it("reports a raw draft overlay alongside the observed state", async () => {
    store.roles = [role({ published: false })];
    store.rawRoleDrafts = [role({ _id: "drafts.role-1" })];
    const res = await unpublishPOST(req({ mode: "recover", roles: [{ id: "role-1" }] }));
    expect(res.status).toBe(200);
    const services = (await json(res)).services as { rawDrafts: string[] }[];
    expect(services[0].rawDrafts).toEqual(["drafts.role-1"]);
    expect(transactions).toHaveLength(0);
  });
});
