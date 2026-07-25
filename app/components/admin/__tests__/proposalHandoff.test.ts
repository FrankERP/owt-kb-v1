// Transient proposal/integrity handoff tests (Plan B item 6, §"Proposal handoff").
process.env.TZ = "Pacific/Honolulu";

import { describe, expect, it } from "vitest";

import {
  HANDOFF_NOTICE,
  HANDOFF_TAB,
  buildProposalHandoff,
  isProposalReviewStatus,
  reduceReviewTarget,
  resolveProposalHandoff,
  type AdminReviewTarget,
  type ProposalHandoffInput,
  type ProposalReviewTarget,
  type ReviewTargetState,
} from "../proposalHandoff";
import { deriveProposalPresentation, type ProposalObservation } from "../serviceReadiness";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const EMPTY_OBS: ProposalObservation = {
  validated: [],
  conflicts: [],
  recordIssues: [],
  draftIds: [],
};

function obs(over: Partial<ProposalObservation> = {}): ProposalObservation {
  return { ...EMPTY_OBS, ...over };
}

function handoff(over: Partial<ProposalHandoffInput> = {}): AdminReviewTarget | null {
  return buildProposalHandoff({
    serviceRef: "role-a",
    serviceType: "sunday_role",
    serviceDate: "2026-08-02",
    presentation: "pending",
    observation: obs({ validated: [{ id: "prop-1", status: "pending" }] }),
    ...over,
  });
}

/** Build the target from A1's response through the SHIPPED presentation mapping. */
function fromObservation(observation: ProposalObservation, source: "ready" | "error" = "ready") {
  return buildProposalHandoff({
    serviceRef: "role-a",
    serviceType: "sunday_role",
    serviceDate: "2026-08-02",
    presentation: deriveProposalPresentation(source, observation),
    observation,
  });
}

// ── Target construction ──────────────────────────────────────────────────────

describe("buildProposalHandoff: validated singletons", () => {
  for (const status of ["draft", "pending", "changes_requested", "approved"] as const) {
    it(`hands off a validated ${status} singleton as a ProposalReviewTarget`, () => {
      const target = fromObservation(obs({ validated: [{ id: "prop-1", status }] }));
      expect(target).toEqual({
        kind: "proposal_review",
        serviceRef: "role-a",
        serviceDate: "2026-08-02",
        serviceType: "sunday_role",
        proposalIds: ["prop-1"],
        conflict: null,
        status,
      });
    });
  }

  it("hands off nothing when there is no proposal", () => {
    expect(fromObservation(obs())).toBeNull();
  });

  it("hands off nothing when the proposal source failed (unknown, not not-found)", () => {
    expect(fromObservation(obs({ validated: [{ id: "prop-1", status: "pending" }] }), "error")).toBeNull();
  });

  it("fails closed when a stored status is unusable", () => {
    // A1 maps an unrecognized status to `invalid`, so this becomes an integrity
    // target with the explicit id, never a proposal search.
    const target = handoff({
      presentation: "invalid",
      observation: obs({ recordIssues: [{ id: "prop-1", issues: ["status"] }] }),
    });
    expect(target).toMatchObject({ kind: "integrity_issue", ids: ["prop-1"], reasons: ["status"] });
  });

  it("refuses to guess when a singleton status has no validated record", () => {
    expect(handoff({ presentation: "pending", observation: obs() })).toBeNull();
  });

  it("keeps a null service date rather than inventing one", () => {
    expect(handoff({ serviceDate: null })).toMatchObject({ serviceDate: null });
  });
});

describe("buildProposalHandoff: explicit A1 grouping conflicts", () => {
  it("carries a single serviceRef conflict group verbatim", () => {
    const target = fromObservation(
      obs({ conflicts: [{ key: "role-a", ids: ["prop-1", "prop-2"] }] }),
    );
    expect(target).toEqual({
      kind: "proposal_review",
      serviceRef: "role-a",
      serviceDate: "2026-08-02",
      serviceType: "sunday_role",
      proposalIds: ["prop-1", "prop-2"],
      conflict: { index: "serviceRef", key: "role-a", ids: ["prop-1", "prop-2"] },
      status: null,
    });
  });

  it("labels a target-key conflict group by its own key", () => {
    const target = fromObservation(
      obs({ conflicts: [{ key: "sunday:2026-08-02", ids: ["prop-1", "prop-2"] }] }),
    );
    expect(target).toMatchObject({
      kind: "proposal_review",
      conflict: { index: "targetKey", key: "sunday:2026-08-02" },
    });
  });

  it("fails closed to integrity details when A1 reported several groups", () => {
    const target = fromObservation(
      obs({
        conflicts: [
          { key: "role-a", ids: ["prop-1", "prop-2"] },
          { key: "sunday:2026-08-02", ids: ["prop-1", "prop-3"] },
        ],
      }),
    );
    expect(target).toMatchObject({
      kind: "integrity_issue",
      ids: ["prop-1", "prop-2", "prop-3"],
      reasons: ["ambiguous_group"],
    });
  });

  it("fails closed when several validated records carry no explicit conflict", () => {
    // `deriveProposalPresentation` maps this contradiction to `conflict`; the
    // handoff must not pick a winner among them.
    const observation = obs({
      validated: [
        { id: "prop-1", status: "pending" },
        { id: "prop-2", status: "pending" },
      ],
    });
    expect(deriveProposalPresentation("ready", observation)).toBe("conflict");
    const target = fromObservation(observation);
    expect(target).toMatchObject({
      kind: "integrity_issue",
      ids: ["prop-1", "prop-2"],
      reasons: ["ambiguous_group"],
    });
  });
});

describe("buildProposalHandoff: integrity states", () => {
  it("routes invalid records to integrity details by explicit id", () => {
    const target = fromObservation(
      obs({ recordIssues: [{ id: "prop-bad", issues: ["identity", "date"] }] }),
    );
    expect(target).toEqual({
      kind: "integrity_issue",
      domain: "proposals",
      ids: ["prop-bad"],
      reasons: ["identity", "date"],
      relatedIds: ["role-a"],
      serviceRef: "role-a",
      serviceDate: "2026-08-02",
    });
  });

  it("routes a raw draft conflict to integrity details by explicit draft id", () => {
    const target = fromObservation(obs({ draftIds: ["drafts.prop-1"] }));
    expect(target).toMatchObject({
      kind: "integrity_issue",
      ids: ["drafts.prop-1"],
      reasons: ["draft_conflict"],
    });
  });

  it("prefers the integrity route over proposal search when both are reported", () => {
    const target = fromObservation(
      obs({
        validated: [{ id: "prop-1", status: "pending" }],
        recordIssues: [{ id: "prop-2", issues: ["date"] }],
      }),
    );
    expect(target?.kind).toBe("integrity_issue");
  });
});

// ── Resolution inside ProposalsPanel ─────────────────────────────────────────

const SINGLETON: ProposalReviewTarget = {
  kind: "proposal_review",
  serviceRef: "role-a",
  serviceDate: "2026-08-02",
  serviceType: "sunday_role",
  proposalIds: ["prop-1"],
  conflict: null,
  status: "pending",
};

describe("resolveProposalHandoff", () => {
  it("waits while the panel is still loading", () => {
    expect(
      resolveProposalHandoff(SINGLETON, { state: "loading", records: [], currentFilter: "pending" }),
    ).toEqual({ outcome: "waiting" });
  });

  it("reports a load failure distinctly from not found", () => {
    expect(
      resolveProposalHandoff(SINGLETON, { state: "error", records: [], currentFilter: "pending" }),
    ).toEqual({ outcome: "load_failed" });
    expect(
      resolveProposalHandoff(SINGLETON, { state: "ready", records: [], currentFilter: "pending" }),
    ).toEqual({ outcome: "not_found", missingIds: ["prop-1"] });
    expect(HANDOFF_NOTICE.load_failed).not.toBe(HANDOFF_NOTICE.not_found);
  });

  it("focuses the exact id and keeps a filter that already reveals it", () => {
    expect(
      resolveProposalHandoff(SINGLETON, {
        state: "ready",
        records: [{ id: "prop-1", status: "pending" }],
        currentFilter: "pending",
      }),
    ).toEqual({
      outcome: "focus",
      ids: ["prop-1"],
      nextFilter: "pending",
      conflictKey: null,
      missingIds: [],
      changed: false,
    });
  });

  it("changes the filter when the current one hides the target", () => {
    const result = resolveProposalHandoff(
      { ...SINGLETON, status: "changes_requested" },
      {
        state: "ready",
        records: [{ id: "prop-1", status: "changes_requested" }],
        currentFilter: "pending",
      },
    );
    expect(result).toMatchObject({ outcome: "focus", nextFilter: "changes_requested" });
  });

  it("never narrows an explicit `all` filter", () => {
    const result = resolveProposalHandoff(SINGLETON, {
      state: "ready",
      records: [{ id: "prop-1", status: "pending" }],
      currentFilter: "all",
    });
    expect(result).toMatchObject({ nextFilter: "all" });
  });

  it("reveals a whole A1 conflict group and widens to `all` for mixed statuses", () => {
    const target: ProposalReviewTarget = {
      ...SINGLETON,
      proposalIds: ["prop-1", "prop-2"],
      conflict: { index: "serviceRef", key: "role-a", ids: ["prop-1", "prop-2"] },
      status: null,
    };
    const result = resolveProposalHandoff(target, {
      state: "ready",
      records: [
        { id: "prop-1", status: "pending" },
        { id: "prop-2", status: "approved" },
      ],
      currentFilter: "pending",
    });
    expect(result).toEqual({
      outcome: "focus",
      ids: ["prop-1", "prop-2"],
      nextFilter: "all",
      conflictKey: "role-a",
      missingIds: [],
      changed: false,
    });
  });

  it("flags a changed status without refusing to focus", () => {
    const result = resolveProposalHandoff(SINGLETON, {
      state: "ready",
      records: [{ id: "prop-1", status: "approved" }],
      currentFilter: "all",
    });
    expect(result).toMatchObject({ outcome: "focus", changed: true });
  });

  it("flags a changed group when one member vanished", () => {
    const target: ProposalReviewTarget = {
      ...SINGLETON,
      proposalIds: ["prop-1", "prop-2"],
      conflict: { index: "serviceRef", key: "role-a", ids: ["prop-1", "prop-2"] },
      status: null,
    };
    const result = resolveProposalHandoff(target, {
      state: "ready",
      records: [{ id: "prop-1", status: "pending" }],
      currentFilter: "all",
    });
    expect(result).toMatchObject({ outcome: "focus", missingIds: ["prop-2"], changed: true });
  });

  it("resolves by exact id only — never by target key, date or regrouping", () => {
    // Two same-service proposals are loaded; only the target's exact id is focused.
    const result = resolveProposalHandoff(SINGLETON, {
      state: "ready",
      records: [
        { id: "prop-0", status: "pending" },
        { id: "prop-1", status: "pending" },
        { id: "prop-2", status: "pending" },
      ],
      currentFilter: "all",
    });
    expect(result).toMatchObject({ outcome: "focus", ids: ["prop-1"] });
  });

  it("waits on a null target rather than focusing something arbitrary", () => {
    expect(
      resolveProposalHandoff(null, {
        state: "ready",
        records: [{ id: "prop-1", status: "pending" }],
        currentFilter: "all",
      }),
    ).toEqual({ outcome: "waiting" });
  });

  it("ignores blank ids in a target", () => {
    expect(
      resolveProposalHandoff(
        { ...SINGLETON, proposalIds: ["", "prop-1"] },
        { state: "ready", records: [{ id: "prop-1", status: "pending" }], currentFilter: "all" },
      ),
    ).toMatchObject({ outcome: "focus", ids: ["prop-1"], missingIds: [] });
  });
});

// ── Transient-target lifecycle ───────────────────────────────────────────────

describe("reduceReviewTarget", () => {
  const start: ReviewTargetState = { tab: "services", target: null };

  it("opens a proposal target on the Propuestas tab", () => {
    const next = reduceReviewTarget(start, { type: "open_target", target: SINGLETON });
    expect(next).toEqual({ tab: "proposals", target: SINGLETON });
    expect(HANDOFF_TAB.proposal_review).toBe("proposals");
  });

  it("opens an integrity target beside Servicios", () => {
    const target: AdminReviewTarget = {
      kind: "integrity_issue",
      domain: "proposals",
      ids: ["drafts.prop-1"],
      reasons: ["draft_conflict"],
      relatedIds: [],
      serviceRef: "role-a",
      serviceDate: "2026-08-02",
    };
    expect(reduceReviewTarget(start, { type: "open_target", target })).toEqual({
      tab: "services",
      target,
    });
  });

  it("clears the target after a successful focus", () => {
    const opened = reduceReviewTarget(start, { type: "open_target", target: SINGLETON });
    expect(reduceReviewTarget(opened, { type: "resolved", outcome: "focus" })).toEqual({
      tab: "proposals",
      target: null,
    });
  });

  it("keeps the target for a non-focus outcome, so the notice stays visible", () => {
    const opened = reduceReviewTarget(start, { type: "open_target", target: SINGLETON });
    for (const outcome of ["waiting", "not_found", "load_failed"]) {
      expect(reduceReviewTarget(opened, { type: "resolved", outcome })).toBe(opened);
    }
  });

  it("clears the target on a manual tab change, so a remount cannot resurrect it", () => {
    const opened = reduceReviewTarget(start, { type: "open_target", target: SINGLETON });
    expect(reduceReviewTarget(opened, { type: "select_tab", tab: "availability" })).toEqual({
      tab: "availability",
      target: null,
    });
    // Even re-selecting the same tab drops the transient target.
    expect(reduceReviewTarget(opened, { type: "select_tab", tab: "proposals" })).toEqual({
      tab: "proposals",
      target: null,
    });
  });

  it("clears on an explicit clear and ignores unknown events", () => {
    const opened = reduceReviewTarget(start, { type: "open_target", target: SINGLETON });
    expect(reduceReviewTarget(opened, { type: "clear" })).toEqual({ tab: "proposals", target: null });
    // @ts-expect-error — an out-of-contract event must not change state.
    expect(reduceReviewTarget(opened, { type: "nonsense" })).toBe(opened);
  });
});

describe("status helpers", () => {
  it("recognizes only the four stored statuses", () => {
    expect(isProposalReviewStatus("pending")).toBe(true);
    expect(isProposalReviewStatus("changes_requested")).toBe(true);
    expect(isProposalReviewStatus("stale")).toBe(false);
    expect(isProposalReviewStatus(null)).toBe(false);
  });
});
