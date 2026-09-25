// Parity between the MCP service snapshot (Decision D1) and the readiness loader
// the publish-ready route decides with.
//
// `loadServiceSnapshot()` is a second copy of `loadServiceReadinessSources()`'s
// orchestration — it exists only because that loader discards the raw rows and
// the member map, and widening its return value would change an export a writer
// imports. A copy is safe only while it is provably the same thing, so this file
// runs BOTH loaders over the same mocked client responses and demands:
//
//   - `snapshot.readiness` deep-equals the original, Map contents included;
//   - `assembleService` gives the same answer for every role id;
//   - the same reads, on the same clients, with the same params;
//   - with any ONE domain failing, the same `failedSources` and empty rows —
//     never a failed domain presented as an empty one.
//
// A second test pins spec I7's precondition: within one snapshot a document has
// ONE revision wherever it appears, so an observation always matches the
// content it was shown beside.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({ operational: vi.fn(), raw: vi.fn() }));

vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: (...a: unknown[]) => h.operational(...a) },
  rawIntegrityClient: { fetch: (...a: unknown[]) => h.raw(...a) },
}));

import {
  assembleService,
  loadServiceReadinessSources,
  type ServiceReadinessSources,
} from "@/app/utils/publishReadyBundle";
import { loadMemberNames, loadServiceSnapshot, type ServiceSnapshot } from "../serviceSnapshot";
import {
  FIXTURE_FAILURE_SECRET,
  READINESS_DOMAINS,
  SERVICE_FIXTURE_CASES,
  SERVICE_FIXTURE_EXTRA_IDS,
  SERVICE_FIXTURE_ROLE_IDS,
  UNSEATED_MEMBER_ID,
  createFixtureResponder,
  emptyFixtureStore,
  serviceFixtureStore,
  type FixtureCall,
  type FixtureResponder,
  type FixtureResponderOptions,
  type ReadinessDomain,
  type ServiceFixtureStore,
} from "./serviceFixtures";

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.operational.mockReset();
  h.raw.mockReset();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

function wire(responder: FixtureResponder) {
  h.operational.mockImplementation(responder.operational);
  h.raw.mockImplementation(responder.raw);
}

interface Run {
  original: ServiceReadinessSources;
  snapshot: ServiceSnapshot;
  originalCalls: FixtureCall[];
  snapshotCalls: FixtureCall[];
}

/** Each loader gets its OWN responder over the same store, so neither sees the other's reads. */
async function runBoth(store: ServiceFixtureStore, options: FixtureResponderOptions = {}): Promise<Run> {
  const a = createFixtureResponder(store, options);
  wire(a);
  const original = await loadServiceReadinessSources();
  const b = createFixtureResponder(store, options);
  wire(b);
  const snapshot = await loadServiceSnapshot();
  return { original, snapshot, originalCalls: a.calls, snapshotCalls: b.calls };
}

const byKey = <T>([a]: [string, T], [b]: [string, T]) => (a < b ? -1 : a > b ? 1 : 0);

/** Maps compared as sorted entries, so both their keys and their values must agree. */
function comparable(sources: ServiceReadinessSources) {
  return {
    ...sources,
    rolesById: [...sources.rolesById.entries()].sort(byKey),
    proposalsById: [...sources.proposalsById.entries()].sort(byKey),
  };
}

function callSignature(calls: FixtureCall[]): string[] {
  return calls.map((c) => `${c.client}:${c.domain}:${JSON.stringify(c.params)}`).sort();
}

/** Every id `assembleService` can be asked about: each role, each record issue, and unknowns. */
function everyServiceId(sources: ServiceReadinessSources): string[] {
  return [
    ...new Set([
      ...SERVICE_FIXTURE_ROLE_IDS,
      ...SERVICE_FIXTURE_EXTRA_IDS,
      ...sources.rolesById.keys(),
      ...sources.roleSummary.recordIssues.map((r) => r.id),
    ]),
  ];
}

function expectParity(run: Run) {
  expect(run.snapshot.readiness.rolesById).toBeInstanceOf(Map);
  expect(run.snapshot.readiness.proposalsById).toBeInstanceOf(Map);
  expect(comparable(run.snapshot.readiness)).toStrictEqual(comparable(run.original));
  for (const id of everyServiceId(run.original)) {
    expect(assembleService(run.snapshot.readiness, id), id).toStrictEqual(assembleService(run.original, id));
  }
  expect(callSignature(run.snapshotCalls)).toEqual(callSignature(run.originalCalls));
}

// ── The matrix says what it claims ──────────────────────────────────────────

describe("the fixture matrix", () => {
  it("covers every case it names, as the real readiness chain sees it", async () => {
    const { original } = await runBoth(serviceFixtureStore());
    expect(original.failedSources).toEqual([]);

    for (const c of SERVICE_FIXTURE_CASES) {
      const service = assembleService(original, c.roleId);
      expect(service, c.roleId).not.toBeNull();
      expect(service!.readiness.isReadyToPublish, `${c.roleId}: ${c.covers}`).toBe(c.readyToPublish);
    }

    const readiness = (id: string) => assembleService(original, id)!.readiness;
    expect(readiness("role-sun-1004").publishState).toBe("published");
    expect(readiness("role-sun-1004").isOperationallyReady).toBe(true);
    expect(original.rolesById.get("role-sun-1011")!.published).toBeNull();
    expect(readiness("role-sun-1011").publishState).toBe("published");
    expect(readiness("role-sun-1011").availabilityStatus).toBe("conflict");
    expect(readiness("role-sun-1011").proposalPresentation).toBe("pending");
    expect(readiness("role-sp-1017-a").setlistStatus).toBe("incomplete");
    expect(readiness("role-sp-1017-b").setlistStatus).toBe("none");
    expect(readiness("role-sun-1018").setlistStatus).toBe("draft_conflict");
    expect(readiness("role-sun-1025").setlistStatus).toBe("duplicate");
    expect(readiness("role-sun-1025").danglingRefCount).toBe(1);
    expect(readiness("role-sun-1025").proposalPresentation).toBe("draft_conflict");
    expect(readiness("role-sun-1108-invalid").recordStatus).toBe("invalid");
    expect(assembleService(original, "drafts.role-sp-draftonly")).not.toBeNull();
    expect(assembleService(original, "role-missing")).toBeNull();

    const lockKinds = original.roleSummary.lockIssues.map((i) => i.kind).sort();
    expect(lockKinds).toEqual(["missing_lock", "orphan_lock"]);
    expect(assembleService(original, "role-sat-1010")!.observation!.unsafe).toContain("lock");

    const wn = original.rolesById.get("role-sp-1024-wn")!;
    expect(wn.format).toBe("worship_night");
    expect((wn.songs as { leads: unknown[] }[]).every((s) => s.leads.length > 0)).toBe(true);
  });
});

// ── Parity ──────────────────────────────────────────────────────────────────

describe("loadServiceSnapshot — readiness parity with loadServiceReadinessSources", () => {
  it("deep-equals the original over the whole matrix, and assembles every service identically", async () => {
    const run = await runBoth(serviceFixtureStore());
    expectParity(run);
    expect(run.snapshotCalls).toHaveLength(8);
  });

  it("keeps parity on an empty catalogue, with no members round trip", async () => {
    const run = await runBoth(emptyFixtureStore());
    expectParity(run);
    expect(run.snapshot.readiness.failedSources).toEqual([]);
    expect(run.snapshotCalls.map((c) => c.domain)).not.toContain("members");
  });

  // Where each domain's raw rows surface in the snapshot, and the source that reports them failed.
  const RAW_ROWS: Record<ReadinessDomain, (s: ServiceSnapshot) => readonly unknown[]> = {
    roles: (s) => s.roles,
    roleDrafts: (s) => s.roleDraftIds,
    locks: (s) => s.readiness.roleSummary.lockIssues,
    setlists: (s) => s.setlists,
    setlistDrafts: (s) => s.setlistDraftIds,
    proposals: (s) => s.proposals,
    proposalDrafts: (s) => s.readiness.rawProposalDrafts,
    members: (s) => [...s.membersById.values()],
  };

  it.each(READINESS_DOMAINS)("reports a failed %s read as failed, never as empty", async (domain) => {
    const clean = await loadCleanSnapshot();
    expect(RAW_ROWS[domain](clean).length, `${domain} must carry rows when it succeeds`).toBeGreaterThan(0);

    const run = await runBoth(serviceFixtureStore(), { fail: [domain] });
    expectParity(run);
    expect(run.snapshot.readiness.failedSources).toEqual(run.original.failedSources);
    expect(run.snapshot.readiness.failedSources.length).toBeGreaterThan(0);
    expect(RAW_ROWS[domain](run.snapshot)).toEqual([]);
    for (const id of everyServiceId(run.original)) {
      expect(assembleService(run.snapshot.readiness, id)?.readiness.isReadyToPublish ?? false, id).toBe(false);
    }
  });

  it("logs a failed read with a fixed tag, never the error's text", async () => {
    wire(createFixtureResponder(serviceFixtureStore(), { fail: ["setlists"] }));
    await loadServiceSnapshot();
    expect(errorSpy).toHaveBeenCalled();
    const logged = JSON.stringify(errorSpy.mock.calls, (_k, v) => (v instanceof Error ? v.message : v));
    expect(logged).not.toContain(FIXTURE_FAILURE_SECRET);
  });
});

async function loadCleanSnapshot(): Promise<ServiceSnapshot> {
  wire(createFixtureResponder(serviceFixtureStore()));
  return loadServiceSnapshot();
}

// ── Raw rows ────────────────────────────────────────────────────────────────

describe("loadServiceSnapshot — the rows the readiness bundle discards", () => {
  it("keeps the raw role, setlist and proposal rows, the draft ids and the member map", async () => {
    const store = serviceFixtureStore();
    const snapshot = await loadCleanSnapshot();
    expect(snapshot.roles).toStrictEqual(store.roles);
    expect(snapshot.setlists).toStrictEqual(store.setlists);
    expect(snapshot.proposals).toStrictEqual(store.proposals);
    expect(snapshot.setlistDraftIds).toEqual(["drafts.set-sun-1018"]);
    expect(snapshot.roleDraftIds).toEqual(["drafts.role-sun-1108-invalid", "drafts.role-sp-draftonly"]);
    // Seated members only — a proposal-only member is `loadMemberNames`' job.
    expect([...snapshot.membersById.keys()].sort()).toEqual(["mem-ana", "mem-luis", "mem-sofia"]);
    expect(snapshot.membersById.get("mem-luis")).toMatchObject({
      member_name: "Luis",
      alias: "Lucho",
      unavailableDates: ["2026-10-11"],
    });
  });

  it("types those shared rows read-only, so an in-place edit does not compile", () => {
    // Never called: `tsc --noEmit` is the assertion. Each line would change what
    // `assembleService` sees if it compiled, because the objects are shared.
    const inPlaceEdits = (s: ServiceSnapshot) => {
      // @ts-expect-error — a read-only array has no in-place sort.
      s.roles.sort();
      // @ts-expect-error — a row's fields are read-only.
      s.roles[0]._rev = "edited";
      // @ts-expect-error — a read-only array has no push.
      s.proposals.push({});
      // @ts-expect-error — a read-only id list has no push.
      s.setlistDraftIds.push("drafts.x");
      // @ts-expect-error — a read-only map has no set.
      s.membersById.set("mem-x", { _id: "mem-x", _rev: "r" });
    };
    expect(typeof inPlaceEdits).toBe("function");
  });

  it("serves the raw rows and the readiness from the SAME row objects", async () => {
    const snapshot = await loadCleanSnapshot();
    for (const row of snapshot.roles) {
      expect(snapshot.readiness.rolesById.get(row._id as string)).toBe(row);
    }
    for (const row of snapshot.proposals) {
      expect(snapshot.readiness.proposalsById.get(row._id as string)).toBe(row);
    }
    for (const target of snapshot.readiness.roleSummary.targets) {
      for (const record of target.records) {
        for (const m of record.members) expect(snapshot.membersById.get(m._id)).toBe(m);
      }
    }
  });
});

// ── One revision per document ───────────────────────────────────────────────

describe("loadServiceSnapshot — one revision per document", () => {
  it("gives a document the same _rev wherever it appears in one snapshot", async () => {
    // Revisions drift between reads here, so a second read of any domain
    // would put two revisions of one document into the snapshot.
    wire(createFixtureResponder(serviceFixtureStore(), { revisionDrift: true }));
    const snapshot = await loadServiceSnapshot();
    const { readiness } = snapshot;

    const seen = new Map<string, { rev: unknown; where: string }[]>();
    const note = (id: unknown, rev: unknown, where: string) => {
      if (typeof id !== "string" || !id) return;
      seen.set(id, [...(seen.get(id) ?? []), { rev, where }]);
    };

    for (const r of snapshot.roles) note(r._id, r._rev, "roles");
    for (const [id, r] of readiness.rolesById) note(id, r._rev, "rolesById");
    for (const r of snapshot.setlists) note(r._id, r._rev, "setlists");
    for (const r of snapshot.proposals) note(r._id, r._rev, "proposals");
    for (const [id, r] of readiness.proposalsById) note(id, r._rev, "proposalsById");
    for (const [id, m] of snapshot.membersById) note(id, m._rev, "membersById");
    for (const t of readiness.roleSummary.targets) {
      if (t.lock) note(t.lock.id, t.lock.rev, "roleSummary.lock");
      for (const r of t.records) {
        note(r.id, r.rev, "roleSummary.record");
        for (const m of r.members) note(m._id, m._rev, "roleSummary.member");
      }
    }
    for (const t of readiness.setlistSummary.targets) {
      for (const r of t.records) note(r.id, r.rev, "setlistSummary.record");
    }
    for (const r of readiness.proposalSummary.records) note(r.id, r.rev, "proposalSummary.record");
    for (const id of SERVICE_FIXTURE_ROLE_IDS) {
      const obs = assembleService(readiness, id)?.observation;
      if (!obs) continue;
      note(obs.roleId, obs.roleRev, "observation.role");
      if (obs.lock) note(obs.lock.id, obs.lock.rev, "observation.lock");
      if (obs.setlist.state === "single") note(obs.setlist.id, obs.setlist.rev, "observation.setlist");
      if (obs.proposal.state === "single") note(obs.proposal.id, obs.proposal.rev, "observation.proposal");
      for (const m of obs.members) note(m.id, m.rev, "observation.member");
    }

    for (const [id, sightings] of seen) {
      const revs = new Set(sightings.map((s) => s.rev));
      expect(revs.size, `${id}: ${JSON.stringify(sightings)}`).toBe(1);
    }
    // Not vacuous: every role is seen in the raw rows, the map, the summary and an observation
    // (or its record issue), and a special's embedded setlist is the role document itself.
    expect(seen.get("role-sat-1003")!.length).toBeGreaterThanOrEqual(4);
    expect(seen.get("role-sp-1024-wn")!.map((s) => s.where)).toContain("setlistSummary.record");
    expect(seen.get("mem-ana")!.length).toBeGreaterThanOrEqual(3);
  });
});

// ── Member names beyond the seats ───────────────────────────────────────────

describe("loadMemberNames", () => {
  it("fetches only the ids the snapshot does not already hold, in one canonical read", async () => {
    const snapshot = await loadCleanSnapshot();
    const responder = createFixtureResponder(serviceFixtureStore());
    wire(responder);

    const names = await loadMemberNames(["mem-ana", UNSEATED_MEMBER_ID, UNSEATED_MEMBER_ID, "", "mem-nobody"], snapshot.membersById);

    expect(responder.calls).toEqual([
      { client: "operational", domain: "members", params: { ids: [UNSEATED_MEMBER_ID, "mem-nobody"] } },
    ]);
    expect(names.ok).toBe(true);
    expect(names.byId.get("mem-ana")).toBe(snapshot.membersById.get("mem-ana"));
    expect(names.byId.get(UNSEATED_MEMBER_ID)).toMatchObject({ member_name: "Pablo" });
    // An id that resolves to nothing is absent — reported missing by the caller, never invented.
    expect(names.byId.has("mem-nobody")).toBe(false);
  });

  it("makes no round trip when every id is already known", async () => {
    const snapshot = await loadCleanSnapshot();
    const responder = createFixtureResponder(serviceFixtureStore());
    wire(responder);
    const names = await loadMemberNames(["mem-ana", "mem-luis"], snapshot.membersById);
    expect(responder.calls).toEqual([]);
    expect(names.ok).toBe(true);
    expect([...names.byId.keys()]).toEqual(["mem-ana", "mem-luis"]);
  });

  it("reports a failed lookup as not ok, keeps the known names, and logs no error text", async () => {
    const snapshot = await loadCleanSnapshot();
    errorSpy.mockClear();
    wire(createFixtureResponder(serviceFixtureStore(), { fail: ["members"] }));
    const names = await loadMemberNames(["mem-ana", UNSEATED_MEMBER_ID], snapshot.membersById);
    expect(names.ok).toBe(false);
    expect([...names.byId.keys()]).toEqual(["mem-ana"]);
    const logged = JSON.stringify(errorSpy.mock.calls, (_k, v) => (v instanceof Error ? v.message : v));
    expect(logged).not.toContain(FIXTURE_FAILURE_SECRET);
  });
});
