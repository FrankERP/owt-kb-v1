// Pure bulk-publish selection + blocker classification (Plan B item 3).
//
// No React, no fetch, no Sanity: every case here is a total function over the
// shipped `deriveServiceReadiness` output, so the SAME vocabulary the client
// renders is the vocabulary the server recomputes with.

import { describe, expect, it } from "vitest";

import {
  deriveServiceReadiness,
  type ServiceReadinessInput,
  type ServiceSourceStates,
} from "../serviceReadiness";
import {
  BULK_OVERRIDE_BLOCKERS,
  PUBLISH_HARD_BLOCKERS,
  PUBLISH_WORKFLOW_BLOCKERS,
  classifyPublishBlockers,
  isBulkOverridable,
  isOverrideEligible,
  overrideAcknowledgement,
  sameBlockerSet,
  selectBulkOverride,
  selectPublishReady,
  type PublishCandidate,
} from "../publishSelection";

const READY_SOURCES: ServiceSourceStates = {
  roles: "ready",
  members: "ready",
  proposals: "ready",
  roleTargets: "ready",
  setlistTargets: "ready",
};

const WEEK = "2026-08-09";

function setlistBody(over: Record<string, unknown> = {}) {
  return {
    targetState: "single",
    contentState: "ready",
    observed: { state: "single", id: "set-1", rev: "sr-1" },
    setlistId: "set-1",
    songs: [{ _key: "k1" }],
    recentSongs: {},
    ...over,
  };
}

function readinessInput(over: Partial<ServiceReadinessInput> = {}): ServiceReadinessInput {
  return {
    sources: READY_SOURCES,
    published: false,
    recordValid: true,
    roleId: "role-1",
    roleTarget: "single",
    team: { assignedRefs: ["mem-1"], danglingRefs: [] },
    setlistResponse: setlistBody(),
    proposal: { validated: [], conflicts: [], recordIssues: [], draftIds: [] },
    serviceDate: WEEK,
    members: [{ _id: "mem-1", member_name: "Ana", unavailableDates: [] }],
    ...over,
  };
}

function candidate(over: Partial<ServiceReadinessInput> = {}, id = "role-1"): PublishCandidate {
  return {
    id,
    rev: `${id}-rev`,
    readiness: deriveServiceReadiness(readinessInput({ roleId: id, ...over })),
  };
}

// ── Blocker classification ──────────────────────────────────────────────────

describe("classifyPublishBlockers", () => {
  it("reports nothing for a clean draft", () => {
    const d = deriveServiceReadiness(readinessInput());
    expect(d.isReadyToPublish).toBe(true);
    expect(classifyPublishBlockers(d)).toEqual({ workflow: [], hard: [] });
  });

  it("keeps the two vocabularies disjoint", () => {
    for (const code of PUBLISH_WORKFLOW_BLOCKERS) {
      expect(PUBLISH_HARD_BLOCKERS as readonly string[]).not.toContain(code);
    }
  });

  it("classifies exactly the four plan workflow blockers as override-eligible", () => {
    const cases: [string, Partial<ServiceReadinessInput>][] = [
      ["team_empty", { team: { assignedRefs: [], danglingRefs: [] }, members: [] }],
      [
        "availability_conflict",
        { members: [{ _id: "mem-1", member_name: "Ana", unavailableDates: [WEEK] }] },
      ],
      [
        "active_proposal",
        {
          proposal: {
            validated: [{ id: "prop-1", status: "pending" }],
            conflicts: [],
            recordIssues: [],
            draftIds: [],
          },
        },
      ],
      ["incomplete_setlist", { setlistResponse: setlistBody({ contentState: "incomplete" }) }],
    ];
    for (const [code, over] of cases) {
      const d = deriveServiceReadiness(readinessInput(over));
      const blockers = classifyPublishBlockers(d);
      expect(blockers.hard, code).toEqual([]);
      expect(blockers.workflow, code).toEqual([code]);
      expect(isOverrideEligible(d), code).toBe(true);
      expect(d.isReadyToPublish, code).toBe(false);
    }
  });

  it("treats an absent setlist as an override-eligible workflow blocker", () => {
    const d = deriveServiceReadiness(
      readinessInput({
        setlistResponse: {
          targetState: "none",
          observed: { state: "none" },
          setlistId: null,
          songs: [],
          recentSongs: {},
        },
      }),
    );
    expect(classifyPublishBlockers(d)).toEqual({ workflow: ["incomplete_setlist"], hard: [] });
  });

  it("classifies every integrity failure as a HARD blocker that is never override-eligible", () => {
    const cases: [string, Partial<ServiceReadinessInput>][] = [
      ["invalid_record", { recordValid: false }],
      ["role_target_duplicate", { roleTarget: "duplicate", roleTargetIds: ["role-1", "role-2"] }],
      ["role_target_draft_conflict", { roleTarget: "draft_conflict" }],
      ["role_target_invalid", { roleTarget: "invalid" }],
      ["role_target_unknown", { roleTarget: null }],
      ["dangling_assignment", { team: { assignedRefs: ["mem-1", "gone"], danglingRefs: ["gone"] } }],
      [
        "setlist_duplicate",
        {
          setlistResponse: {
            targetState: "duplicate",
            conflictingIds: ["set-1", "set-2"],
            draftIds: [],
            setlistId: null,
            songs: [],
            recentSongs: {},
          },
        },
      ],
      [
        "setlist_draft_conflict",
        {
          setlistResponse: {
            targetState: "draft_conflict",
            draftIds: ["drafts.set-1"],
            canonicalIds: ["set-1"],
            setlistId: null,
            songs: [],
            recentSongs: {},
          },
        },
      ],
      [
        "setlist_invalid",
        {
          setlistResponse: {
            targetState: "invalid",
            reason: "malformed_canonical_record",
            recordIds: ["set-1"],
            setlistId: null,
            songs: [],
            recentSongs: {},
          },
        },
      ],
      ["setlist_unknown", { setlistResponse: null }],
      [
        "proposal_invalid",
        {
          proposal: {
            validated: [],
            conflicts: [],
            recordIssues: [{ id: "prop-bad" }],
            draftIds: [],
          },
        },
      ],
      [
        "proposal_draft_conflict",
        { proposal: { validated: [], conflicts: [], recordIssues: [], draftIds: ["drafts.prop-1"] } },
      ],
      [
        "proposal_conflict",
        {
          proposal: {
            validated: [],
            conflicts: [{ key: "sunday:2026-08-09", ids: ["a", "b"] }],
            recordIssues: [],
            draftIds: [],
          },
        },
      ],
      [
        "cleanup_required",
        {
          integrityIssues: [{ kind: "lock", blocking: true, ids: ["roleTarget.sunday_role.x"] }],
        },
      ],
    ];
    for (const [code, over] of cases) {
      const d = deriveServiceReadiness(readinessInput(over));
      const blockers = classifyPublishBlockers(d);
      expect(blockers.hard, code).toContain(code);
      expect(isOverrideEligible(d), code).toBe(false);
      expect(d.isReadyToPublish, code).toBe(false);
    }
  });

  it("reports an unready source as a hard blocker, never as a clean or workflow state", () => {
    for (const key of ["roles", "members", "proposals", "roleTargets", "setlistTargets"] as const) {
      for (const state of ["loading", "error"] as const) {
        const d = deriveServiceReadiness(
          readinessInput({ sources: { ...READY_SOURCES, [key]: state } }),
        );
        const blockers = classifyPublishBlockers(d);
        expect(blockers.hard, `${key}:${state}`).toContain("source_unready");
        expect(blockers.workflow, `${key}:${state}`).toEqual([]);
        expect(isOverrideEligible(d), `${key}:${state}`).toBe(false);
      }
    }
  });

  it("agrees with the shipped readiness predicate: no blockers iff ready to publish", () => {
    const variants: Partial<ServiceReadinessInput>[] = [
      {},
      { recordValid: false },
      { team: { assignedRefs: [], danglingRefs: [] }, members: [] },
      { setlistResponse: setlistBody({ contentState: "incomplete" }) },
      { sources: { ...READY_SOURCES, proposals: "error" } },
      { members: [{ _id: "mem-1", unavailableDates: [WEEK] }] },
    ];
    for (const over of variants) {
      const d = deriveServiceReadiness(readinessInput(over));
      const blockers = classifyPublishBlockers(d);
      const none = blockers.hard.length === 0 && blockers.workflow.length === 0;
      expect(none, JSON.stringify(over)).toBe(d.isReadyToPublish);
    }
  });

  it("returns a deterministic, duplicate-free order", () => {
    const d = deriveServiceReadiness(
      readinessInput({
        recordValid: false,
        roleTarget: "duplicate",
        team: { assignedRefs: ["a", "b"], danglingRefs: ["b"] },
        setlistResponse: { targetState: "invalid" },
      }),
    );
    const first = classifyPublishBlockers(d);
    const second = classifyPublishBlockers(d);
    expect(first).toEqual(second);
    expect(new Set(first.hard).size).toBe(first.hard.length);
  });
});

// ── Blocker-set comparison ──────────────────────────────────────────────────

describe("sameBlockerSet", () => {
  it("is order-insensitive and duplicate-insensitive", () => {
    expect(sameBlockerSet(["team_empty", "active_proposal"], ["active_proposal", "team_empty"])).toBe(
      true,
    );
    expect(sameBlockerSet(["team_empty", "team_empty"], ["team_empty"])).toBe(true);
  });

  it("rejects a changed set in either direction", () => {
    expect(sameBlockerSet(["team_empty"], ["team_empty", "active_proposal"])).toBe(false);
    expect(sameBlockerSet(["team_empty", "active_proposal"], ["team_empty"])).toBe(false);
    expect(sameBlockerSet([], ["team_empty"])).toBe(false);
    expect(sameBlockerSet(["team_empty"], [])).toBe(false);
  });

  it("treats two empty sets as equal", () => {
    expect(sameBlockerSet([], [])).toBe(true);
  });
});

// ── Override acknowledgement ────────────────────────────────────────────────

describe("overrideAcknowledgement", () => {
  it("acknowledges only the workflow blockers of an override-eligible draft", () => {
    const c = candidate({
      team: { assignedRefs: [], danglingRefs: [] },
      members: [],
      setlistResponse: setlistBody({ contentState: "incomplete" }),
    });
    expect(overrideAcknowledgement(c)).toEqual({
      id: "role-1",
      rev: "role-1-rev",
      acknowledgedBlockers: ["incomplete_setlist", "team_empty"],
    });
  });

  it("refuses to build an acknowledgement when any hard blocker is present", () => {
    expect(overrideAcknowledgement(candidate({ recordValid: false }))).toBeNull();
    expect(
      overrideAcknowledgement(candidate({ sources: { ...READY_SOURCES, setlistTargets: "error" } })),
    ).toBeNull();
  });

  it("refuses a published service — override publishes drafts, it never re-publishes", () => {
    expect(overrideAcknowledgement(candidate({ published: true }))).toBeNull();
  });
});

// ── Bulk selection ──────────────────────────────────────────────────────────

describe("selectPublishReady", () => {
  it("selects only visible drafts that are ready to publish", () => {
    const result = selectPublishReady([
      candidate({}, "ready-1"),
      candidate({}, "ready-2"),
      candidate({ team: { assignedRefs: [], danglingRefs: [] }, members: [] }, "empty-team"),
    ]);
    expect(result.selected).toEqual([
      { id: "ready-1", rev: "ready-1-rev" },
      { id: "ready-2", rev: "ready-2-rev" },
    ]);
    expect(result.skipped).toEqual([
      { id: "empty-team", publishState: "draft", reasons: ["team_empty"] },
    ]);
  });

  it("skips a published service instead of re-publishing it", () => {
    const result = selectPublishReady([candidate({ published: true }, "live")]);
    expect(result.selected).toEqual([]);
    expect(result.skipped).toEqual([
      { id: "live", publishState: "published", reasons: ["already_published"] },
    ]);
  });

  it("skips a legacy grandfathered service (missing `published`) as already published", () => {
    const result = selectPublishReady([candidate({ published: undefined }, "legacy")]);
    expect(result.selected).toEqual([]);
    expect(result.skipped[0]).toMatchObject({
      id: "legacy",
      publishState: "published",
      reasons: ["already_published"],
    });
  });

  it("never silently includes a blocked, invalid, unknown, conflicted or incomplete card", () => {
    const blocked: [string, Partial<ServiceReadinessInput>][] = [
      ["invalid", { recordValid: false }],
      ["dup-role", { roleTarget: "duplicate" }],
      ["draft-conflict", { roleTarget: "draft_conflict" }],
      ["unknown-source", { sources: { ...READY_SOURCES, members: "error" } }],
      [
        "proposal-grouping",
        {
          proposal: {
            validated: [],
            conflicts: [{ key: "sunday:2026-08-09", ids: ["a", "b"] }],
            recordIssues: [],
            draftIds: [],
          },
        },
      ],
      ["incomplete-setlist", { setlistResponse: setlistBody({ contentState: "incomplete" }) }],
      ["dangling", { team: { assignedRefs: ["a", "gone"], danglingRefs: ["gone"] } }],
    ];
    const result = selectPublishReady(blocked.map(([id, over]) => candidate(over, id)));
    expect(result.selected).toEqual([]);
    expect(result.skipped).toHaveLength(blocked.length);
    for (const entry of result.skipped) {
      expect(entry.reasons.length, entry.id).toBeGreaterThan(0);
    }
  });

  it("carries every reason for a card with more than one problem", () => {
    const result = selectPublishReady([
      candidate(
        {
          team: { assignedRefs: [], danglingRefs: [] },
          members: [],
          setlistResponse: setlistBody({ contentState: "incomplete" }),
          proposal: {
            validated: [{ id: "prop-1", status: "draft" }],
            conflicts: [],
            recordIssues: [],
            draftIds: [],
          },
        },
        "messy",
      ),
    ]);
    expect(result.selected).toEqual([]);
    expect([...result.skipped[0].reasons].sort()).toEqual([
      "active_proposal",
      "incomplete_setlist",
      "team_empty",
    ]);
  });

  it("orders hard blockers before workflow blockers in the skipped reasons", () => {
    const result = selectPublishReady([
      candidate(
        {
          recordValid: false,
          team: { assignedRefs: [], danglingRefs: [] },
          members: [],
        },
        "both",
      ),
    ]);
    expect(result.skipped[0].reasons[0]).toBe("invalid_record");
    expect(result.skipped[0].reasons).toContain("team_empty");
  });

  it("skips an entry with an unusable id or revision rather than submitting it", () => {
    const good = candidate({}, "ok");
    const result = selectPublishReady([
      { ...good, id: "" },
      { ...good, rev: "" },
      good,
    ]);
    expect(result.selected).toEqual([{ id: "ok", rev: "ok-rev" }]);
    expect(result.skipped.map((s) => s.reasons)).toEqual([
      ["unusable_identity"],
      ["unusable_identity"],
    ]);
  });

  it("never submits the same id twice", () => {
    const dup = candidate({}, "same");
    const result = selectPublishReady([dup, dup]);
    expect(result.selected).toEqual([{ id: "same", rev: "same-rev" }]);
    expect(result.skipped).toEqual([
      { id: "same", publishState: "draft", reasons: ["duplicate_candidate"] },
    ]);
  });

  it("fails closed when a candidate claims readiness that its dimensions contradict", () => {
    const c = candidate({ recordValid: false }, "liar");
    const tampered: PublishCandidate = {
      ...c,
      readiness: { ...c.readiness, isReadyToPublish: true },
    };
    const result = selectPublishReady([tampered]);
    expect(result.selected).toEqual([]);
    expect(result.skipped[0].reasons).toContain("invalid_record");
  });

  it("fails closed when dimensions look clean but the predicate says not ready", () => {
    const c = candidate({}, "shy");
    const tampered: PublishCandidate = {
      ...c,
      readiness: { ...c.readiness, isReadyToPublish: false },
    };
    const result = selectPublishReady([tampered]);
    expect(result.selected).toEqual([]);
    expect(result.skipped[0].reasons).toEqual(["not_ready"]);
  });

  it("keeps optional labels on both sides for the confirmation dialog", () => {
    const result = selectPublishReady([
      { ...candidate({}, "a"), label: "Domingo 9 ago" },
      { ...candidate({ recordValid: false }, "b"), label: "Sábado 8 ago" },
    ]);
    expect(result.selected[0].label).toBe("Domingo 9 ago");
    expect(result.skipped[0].label).toBe("Sábado 8 ago");
  });

  it("returns empty lists for no candidates", () => {
    expect(selectPublishReady([])).toEqual({ selected: [], skipped: [] });
  });
});

// ── Bulk override (`Publicar todos`) ────────────────────────────────────────

describe("bulk override selection", () => {
  const NO_SETLIST = {
    setlistResponse: setlistBody({
      targetState: "none",
      contentState: "none",
      observed: { state: "none" },
      setlistId: null,
      songs: [],
    }),
  };
  const ACTIVE_PROPOSAL = {
    proposal: {
      validated: [{ id: "p1", status: "pending" }],
      conflicts: [],
      recordIssues: [],
      draftIds: [],
    },
  };

  it("acknowledges only a strict subset of the workflow blockers", () => {
    for (const code of BULK_OVERRIDE_BLOCKERS) {
      expect(PUBLISH_WORKFLOW_BLOCKERS).toContain(code);
    }
    // The two that need a per-service look stay on the individual override.
    expect([...BULK_OVERRIDE_BLOCKERS]).not.toContain("availability_conflict");
    expect([...BULK_OVERRIDE_BLOCKERS]).not.toContain("team_empty");
  });

  it("treats a clean draft as vacuously overridable", () => {
    expect(isBulkOverridable([])).toBe(true);
  });

  it("selects a draft with no setlist, acknowledging exactly that", () => {
    const result = selectBulkOverride([candidate(NO_SETLIST, "sin-setlist")]);
    expect(result.skipped).toEqual([]);
    expect(result.selected).toEqual([
      { id: "sin-setlist", rev: "sin-setlist-rev", acknowledgedBlockers: ["incomplete_setlist"] },
    ]);
  });

  it("selects a draft with an active proposal, and both blockers together", () => {
    const both = selectBulkOverride([
      candidate({ ...NO_SETLIST, ...ACTIVE_PROPOSAL }, "ambos"),
    ]);
    expect(both.selected[0].acknowledgedBlockers).toEqual([
      "active_proposal",
      "incomplete_setlist",
    ]);
  });

  it("includes a clean draft with an EMPTY acknowledgement, so one batch covers both", () => {
    const result = selectBulkOverride([candidate({}, "limpio")]);
    expect(result.selected).toEqual([
      { id: "limpio", rev: "limpio-rev", acknowledgedBlockers: [] },
    ]);
  });

  it("skips an availability conflict and an empty team — never batched", () => {
    const conflicted = selectBulkOverride([
      candidate({ members: [{ _id: "mem-1", member_name: "Ana", unavailableDates: [WEEK] }] }, "ocupada"),
    ]);
    expect(conflicted.selected).toEqual([]);
    expect(conflicted.skipped[0].reasons).toContain("availability_conflict");

    const empty = selectBulkOverride([
      candidate({ team: { assignedRefs: [], danglingRefs: [] }, members: [] }, "vacio"),
    ]);
    expect(empty.selected).toEqual([]);
    expect(empty.skipped[0].reasons).toContain("team_empty");
  });

  it("never selects past a hard blocker, whatever the workflow set looks like", () => {
    const result = selectBulkOverride([
      candidate({ ...NO_SETLIST, recordValid: false }, "roto"),
    ]);
    expect(result.selected).toEqual([]);
    expect(result.skipped[0].reasons).toContain("invalid_record");
  });

  it("applies the same identity, duplicate and already-published guards", () => {
    const published = selectBulkOverride([candidate({ published: true }, "ya")]);
    expect(published.selected).toEqual([]);
    expect(published.skipped[0].reasons).toEqual(["already_published"]);

    const dupe = selectBulkOverride([candidate({}, "a"), candidate({}, "a")]);
    expect(dupe.selected).toHaveLength(1);
    expect(dupe.skipped[0].reasons).toEqual(["duplicate_candidate"]);

    const noRev = selectBulkOverride([{ ...candidate({}, "a"), rev: "" }]);
    expect(noRev.selected).toEqual([]);
    expect(noRev.skipped[0].reasons).toEqual(["unusable_identity"]);
  });

  it("every acknowledged code is one the server accepts as a workflow blocker", () => {
    const result = selectBulkOverride([
      candidate(NO_SETLIST, "a"),
      candidate(ACTIVE_PROPOSAL, "b"),
      candidate({}, "c"),
    ]);
    for (const entry of result.selected) {
      for (const code of entry.acknowledgedBlockers) {
        expect(PUBLISH_WORKFLOW_BLOCKERS).toContain(code);
        expect(BULK_OVERRIDE_BLOCKERS).toContain(code);
      }
    }
  });

  it("returns empty lists for no candidates", () => {
    expect(selectBulkOverride([])).toEqual({ selected: [], skipped: [] });
  });
});
