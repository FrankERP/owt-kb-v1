// Pure bulk-publish selection and blocker vocabulary (Plan B item 3).
//
// One vocabulary, two consumers. The admin panel uses these functions to decide
// which visible drafts `Publicar listos` may submit and to render the
// skipped-with-reason confirmation list; the server-authoritative
// `publish-ready` route reruns the SAME classification over its own freshly
// reloaded A1 sources and refuses anything that disagrees. Nothing here fetches,
// imports `server-only`, or re-derives readiness — it consumes the shipped
// `deriveServiceReadiness` output.
//
// The split that matters:
//  - WORKFLOW blockers are the only codes an explicit individual override may
//    acknowledge (plan §"Readiness-aware bulk publishing"): an empty team, an
//    availability conflict, an active proposal, a missing/incomplete setlist.
//    Each is a decision an admin is entitled to make knowingly.
//  - HARD blockers are integrity/observation failures — invalid or
//    draft-conflicted records, duplicate targets, dangling assignments, unknown
//    or failed sources, and A2 cleanup requirements. They are NEVER
//    override-eligible, because no acknowledgement makes a publish computed over
//    unproven state safe.
//
// Both lists are derived from the readiness dimensions only, so "no blockers"
// and `isReadyToPublish` can never drift apart (proven in the tests).

import {
  SERVICE_SOURCE_KEYS,
  type PublishState,
  type ReadinessDimensions,
  type ServiceReadiness,
} from "./serviceReadiness";

/** Override-eligible workflow blockers, in the plan's primary-action priority order. */
export const PUBLISH_WORKFLOW_BLOCKERS = [
  "availability_conflict",
  "active_proposal",
  "incomplete_setlist",
  "team_empty",
] as const;

export type PublishWorkflowBlocker = (typeof PUBLISH_WORKFLOW_BLOCKERS)[number];

/** Hard integrity blockers. Never override-eligible, in any mode, ever. */
export const PUBLISH_HARD_BLOCKERS = [
  "source_unready",
  "invalid_record",
  "role_target_duplicate",
  "role_target_draft_conflict",
  "role_target_invalid",
  "role_target_unknown",
  "dangling_assignment",
  "team_unknown",
  "setlist_duplicate",
  "setlist_draft_conflict",
  "setlist_invalid",
  "setlist_unknown",
  "proposal_invalid",
  "proposal_draft_conflict",
  "proposal_conflict",
  "proposal_unknown",
  "availability_unknown",
  /** A blocking A1/A2 issue (weekend lock, legacy integrity) needing A2 cleanup. */
  "cleanup_required",
] as const;

export type PublishHardBlocker = (typeof PUBLISH_HARD_BLOCKERS)[number];

export type PublishBlocker = PublishWorkflowBlocker | PublishHardBlocker;

/** Reasons a candidate is excluded from a bulk submission but is not a readiness blocker. */
export const PUBLISH_SELECTION_SKIPS = [
  "already_published",
  "unusable_identity",
  "duplicate_candidate",
  /** Fail-closed catch-all: the dimensions look clean but the predicate disagrees. */
  "not_ready",
] as const;

export type PublishSelectionSkip = (typeof PUBLISH_SELECTION_SKIPS)[number];

export type PublishSkipReason = PublishBlocker | PublishSelectionSkip;

export interface PublishBlockers {
  workflow: PublishWorkflowBlocker[];
  hard: PublishHardBlocker[];
}

const WORKFLOW_SET: ReadonlySet<string> = new Set(PUBLISH_WORKFLOW_BLOCKERS);

/** True only for a registered override-eligible workflow blocker code. */
export function isPublishWorkflowBlocker(code: unknown): code is PublishWorkflowBlocker {
  return typeof code === "string" && WORKFLOW_SET.has(code);
}

/**
 * Total classification of one service's readiness dimensions into the two
 * vocabularies. Deterministic order (hard first, each list in its declared
 * priority), duplicate-free, and never empty when the shipped predicate says the
 * service is not operationally ready.
 */
export function classifyPublishBlockers(d: ReadinessDimensions): PublishBlockers {
  const hard: PublishHardBlocker[] = [];
  const workflow: PublishWorkflowBlocker[] = [];

  // A loading or failed source is `unknown`, never "clear" — one code covers all
  // five domains; the per-source detail belongs to the retry copy, not here.
  for (const key of SERVICE_SOURCE_KEYS) {
    if (d.sources[key] !== "ready") {
      hard.push("source_unready");
      break;
    }
  }

  if (d.recordStatus !== "valid") hard.push("invalid_record");

  switch (d.roleTargetStatus) {
    case "single":
      break;
    case "duplicate":
      hard.push("role_target_duplicate");
      break;
    case "draft_conflict":
      hard.push("role_target_draft_conflict");
      break;
    case "invalid":
      hard.push("role_target_invalid");
      break;
    default:
      hard.push("role_target_unknown");
  }

  // Any dangling assignment reference is a blocking integrity issue in its own
  // right, and it also keeps the team status `unknown` — both are reported.
  if (d.danglingRefCount > 0) hard.push("dangling_assignment");
  if (d.teamStatus === "unknown") hard.push("team_unknown");

  switch (d.setlistStatus) {
    case "ready":
    case "none":
    case "incomplete":
      break;
    case "duplicate":
      hard.push("setlist_duplicate");
      break;
    case "draft_conflict":
      hard.push("setlist_draft_conflict");
      break;
    case "invalid":
      hard.push("setlist_invalid");
      break;
    default:
      hard.push("setlist_unknown");
  }

  switch (d.proposalPresentation) {
    case "none":
    case "approved":
    case "draft":
    case "pending":
    case "changes_requested":
      break;
    case "invalid":
      hard.push("proposal_invalid");
      break;
    case "draft_conflict":
      hard.push("proposal_draft_conflict");
      break;
    case "conflict":
      hard.push("proposal_conflict");
      break;
    default:
      hard.push("proposal_unknown");
  }

  if (d.availabilityStatus === "unknown") hard.push("availability_unknown");
  if (d.blockingIssueCount > 0) hard.push("cleanup_required");

  // ── Workflow blockers, in primary-action priority order ───────────────────
  if (d.availabilityStatus === "conflict") workflow.push("availability_conflict");
  if (
    d.proposalPresentation === "draft" ||
    d.proposalPresentation === "pending" ||
    d.proposalPresentation === "changes_requested"
  ) {
    workflow.push("active_proposal");
  }
  if (d.setlistStatus === "none" || d.setlistStatus === "incomplete") {
    workflow.push("incomplete_setlist");
  }
  if (d.teamStatus === "empty") workflow.push("team_empty");

  return { workflow, hard };
}

/** Every blocker, hard first — the exact order used for skipped-reason copy. */
export function publishBlockerReasons(d: ReadinessDimensions): PublishBlocker[] {
  const { hard, workflow } = classifyPublishBlockers(d);
  return [...hard, ...workflow];
}

/**
 * An individual publish may be overridden only when every remaining blocker is a
 * workflow decision. One hard blocker disqualifies the whole service.
 */
export function isOverrideEligible(d: ReadinessDimensions): boolean {
  return classifyPublishBlockers(d).hard.length === 0;
}

/** Set equality over blocker codes: order- and duplicate-insensitive. */
export function sameBlockerSet(
  a: readonly string[],
  b: readonly string[],
): boolean {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size !== right.size) return false;
  for (const code of left) if (!right.has(code)) return false;
  return true;
}

// ── Bulk selection ──────────────────────────────────────────────────────────

export interface PublishCandidate {
  /** Canonical role document id. */
  id: string;
  /** The canonical role revision this card was rendered from. */
  rev: string;
  /** The assembled readiness for this card, from `deriveServiceReadiness`. */
  readiness: ServiceReadiness;
  /** Optional admin-facing label for the confirmation list. */
  label?: string;
}

export interface PublishSelectionEntry {
  id: string;
  rev: string;
  label?: string;
}

export interface PublishSkippedEntry {
  id: string;
  label?: string;
  publishState: PublishState;
  reasons: PublishSkipReason[];
}

export interface PublishSelection {
  /** Exactly what may be submitted to the server-authoritative endpoint. */
  selected: PublishSelectionEntry[];
  /** Every excluded candidate with its explicit reasons — never a silent drop. */
  skipped: PublishSkippedEntry[];
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/**
 * Split the visible cards into "submit these" and "skipped, because". A candidate
 * is selected ONLY when it has a usable identity, is a first occurrence, is a
 * draft, has zero blockers of either kind, AND the shipped predicate independently
 * says `isReadyToPublish`. Anything else is skipped with reasons — a blocked,
 * invalid, unknown, proposal-conflicted, duplicate-role, draft-conflicted or
 * incomplete-setlist card can never be included silently.
 */
export function selectPublishReady(
  candidates: readonly PublishCandidate[],
): PublishSelection {
  const selected: PublishSelectionEntry[] = [];
  const skipped: PublishSkippedEntry[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates ?? []) {
    const label = candidate?.label;
    const withLabel = <T extends object>(v: T): T => (label ? { ...v, label } : v);
    const id = candidate?.id;
    const publishState = candidate?.readiness?.publishState ?? "published";

    if (!nonEmptyString(id) || !nonEmptyString(candidate?.rev) || !candidate?.readiness) {
      skipped.push(
        withLabel({
          id: nonEmptyString(id) ? id : "(unknown)",
          publishState,
          reasons: ["unusable_identity"] as PublishSkipReason[],
        }),
      );
      continue;
    }
    if (seen.has(id)) {
      skipped.push(withLabel({ id, publishState, reasons: ["duplicate_candidate"] as PublishSkipReason[] }));
      continue;
    }
    seen.add(id);

    if (publishState !== "draft") {
      skipped.push(withLabel({ id, publishState, reasons: ["already_published"] as PublishSkipReason[] }));
      continue;
    }

    const reasons = publishBlockerReasons(candidate.readiness);
    if (reasons.length > 0) {
      skipped.push(withLabel({ id, publishState, reasons: reasons as PublishSkipReason[] }));
      continue;
    }
    // Belt and braces: a supplied readiness object whose predicate contradicts its
    // own clean dimensions is never submitted.
    if (candidate.readiness.isReadyToPublish !== true) {
      skipped.push(withLabel({ id, publishState, reasons: ["not_ready"] as PublishSkipReason[] }));
      continue;
    }

    selected.push(withLabel({ id, rev: candidate.rev }));
  }

  return { selected, skipped };
}

export interface PublishOverrideAcknowledgement {
  id: string;
  rev: string;
  /** The exact workflow blocker codes the admin acknowledged, in priority order. */
  acknowledgedBlockers: PublishWorkflowBlocker[];
}

/**
 * The override payload for ONE draft, or null when the override is not available:
 * a published service, an unusable identity, or any hard integrity blocker. The
 * server recomputes this same set and refuses the publish if it changed.
 */
export function overrideAcknowledgement(
  candidate: PublishCandidate,
): PublishOverrideAcknowledgement | null {
  if (!candidate || !nonEmptyString(candidate.id) || !nonEmptyString(candidate.rev)) return null;
  const readiness = candidate.readiness;
  if (!readiness || readiness.publishState !== "draft") return null;
  const { hard, workflow } = classifyPublishBlockers(readiness);
  if (hard.length > 0) return null;
  return { id: candidate.id, rev: candidate.rev, acknowledgedBlockers: workflow };
}
