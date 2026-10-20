// Transient proposal / integrity handoff contract (Plan B item 6, plan
// §"Proposal handoff").
//
// `AdminPanel` owns the active tab and ONE transient target. This module is the
// pure contract plus every decision the panels make about it, so the whole flow
// is testable without a DOM:
//
//   card sets target -> switch to `Propuestas` -> `ProposalsPanel` resolves the
//   target's EXACT ids in its already-loaded response -> change filter if needed,
//   reveal the exact A1 conflict group when present, scroll, highlight -> clear.
//
// Hard rules held here:
//  - Only A1-validated singleton proposals and EXPLICIT A1 grouping-conflict
//    results become a `ProposalReviewTarget`. Invalid, dangling, malformed and
//    raw-draft-conflict states become an `IntegrityIssueTarget` carrying explicit
//    document/draft ids and reasons, and open read-only integrity details instead
//    of proposal search.
//  - Resolution is an EXACT-ID LOOKUP. It never rebuilds a proposal target key,
//    re-groups records, or chooses a canonical proposal among an ambiguous group;
//    an ambiguous input fails closed to integrity details.
//  - A load failure is a distinct outcome from "not found".
//  - The target is cleared after a successful focus/highlight, and on ANY manual
//    tab change, so a remount cannot resurrect an obsolete filter/highlight.

import type { RoleType } from "@/app/utils/serviceReadModel";
import type {
  ProposalObservation,
  ProposalPresentation,
} from "./serviceReadiness";
import type { IntegrityDomain } from "./serviceIntegrityQueue";

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

// ── Statuses and filter ──────────────────────────────────────────────────────

/** The four stored proposal statuses `ProposalsPanel` renders and filters by. */
export const PROPOSAL_REVIEW_STATUSES = [
  "draft",
  "pending",
  "changes_requested",
  "approved",
] as const;

export type ProposalReviewStatus = (typeof PROPOSAL_REVIEW_STATUSES)[number];

export type ProposalFilter = ProposalReviewStatus | "all";

export function isProposalReviewStatus(v: unknown): v is ProposalReviewStatus {
  return typeof v === "string" && (PROPOSAL_REVIEW_STATUSES as readonly string[]).includes(v);
}

// ── The two transient target shapes ──────────────────────────────────────────

/** A1's explicit grouping-conflict result, carried verbatim. */
export interface ProposalGroupingConflict {
  /** Which A1 index reported it. */
  index: "serviceRef" | "targetKey";
  /** A1's own conflict key — never recomputed on the client. */
  key: string;
  /** The exact proposal ids A1 grouped together. */
  ids: string[];
}

export interface ProposalReviewTarget {
  kind: "proposal_review";
  /** Canonical role document id of the card (= the proposal's `service_ref`). */
  serviceRef: string;
  /** The card's current role date (`YYYY-MM-DD`), or null when unusable. */
  serviceDate: string | null;
  /** The card's current role type. */
  serviceType: RoleType;
  /** The exact A1-validated proposal id(s). One for a singleton; the group's ids for a conflict. */
  proposalIds: string[];
  /** Explicit grouping-conflict metadata, when A1 reported one. */
  conflict: ProposalGroupingConflict | null;
  /** Stored status of the validated singleton; null for a conflict group. */
  status: ProposalReviewStatus | null;
}

export interface IntegrityIssueTarget {
  kind: "integrity_issue";
  /** Which A1 domain the ids come from. */
  domain: IntegrityDomain;
  /** Explicit document/draft ids. Read-only details open by id, never by search. */
  ids: string[];
  /** A1/A2 machine reason tags. */
  reasons: string[];
  /** Related ids when known. */
  relatedIds: string[];
  /** Card context, when the issue came from a card. */
  serviceRef: string | null;
  serviceDate: string | null;
}

export type AdminReviewTarget = ProposalReviewTarget | IntegrityIssueTarget;

// ── Building a target from the card's A1 observation ──────────────────────────

export interface ProposalHandoffInput {
  serviceRef: string;
  serviceType: RoleType;
  serviceDate: string | null;
  /** The card's `proposalPresentation`, from `deriveServiceReadiness`. */
  presentation: ProposalPresentation;
  /** A1's already-grouped proposal response for this ONE service. */
  observation: ProposalObservation | null;
}

/**
 * Decide which transient target a card's `Revisar propuesta(s)` action sets, from
 * A1's explicit response only.
 *
 * `null` means "nothing provable to hand off" (`none`, a load failure, or a
 * contradictory response). `pending` / `changes_requested` are both supported, as
 * are `draft` and `approved`.
 */
export function buildProposalHandoff(
  input: ProposalHandoffInput,
): AdminReviewTarget | null {
  const serviceRef = nonEmptyString(input?.serviceRef) ? input.serviceRef : "";
  const serviceDate = nonEmptyString(input?.serviceDate) ? input.serviceDate : null;
  const observation = input?.observation ?? null;
  const issue = (
    domain: IntegrityDomain,
    ids: readonly (string | null | undefined)[],
    reasons: readonly (string | null | undefined)[],
    relatedIds: readonly (string | null | undefined)[] = [],
  ): IntegrityIssueTarget => ({
    kind: "integrity_issue",
    domain,
    ids: [...new Set(ids.filter(nonEmptyString))],
    reasons: [...new Set(reasons.filter(nonEmptyString))],
    relatedIds: [...new Set(relatedIds.filter(nonEmptyString))],
    serviceRef: serviceRef || null,
    serviceDate,
  });

  const presentation: ProposalPresentation | undefined = input?.presentation;

  switch (presentation) {
    // A failed/loading proposal source is `unknown`: there is no id to open, and
    // guessing one would be exactly the client canonicalization the plan forbids.
    case "unknown":
    case "none":
    case undefined:
      return null;

    case "invalid":
      return issue(
        "proposals",
        (observation?.recordIssues ?? []).map((r) => r?.id),
        (observation?.recordIssues ?? []).flatMap((r) => [...(r?.issues ?? [])]),
        [serviceRef],
      );

    case "draft_conflict":
      return issue("proposals", observation?.draftIds ?? [], ["draft_conflict"], [serviceRef]);

    case "conflict": {
      const conflicts = observation?.conflicts ?? [];
      // Exactly ONE explicit A1 conflict group can be revealed as itself. Zero
      // groups (a contradictory multi-record response) or several groups are
      // ambiguous: fail closed to read-only integrity details by explicit id
      // rather than picking a winner.
      if (conflicts.length !== 1) {
        return issue(
          "proposals",
          [
            ...conflicts.flatMap((c) => [...(c?.ids ?? [])]),
            ...(observation?.validated ?? []).map((v) => v?.id),
          ],
          ["ambiguous_group"],
          [serviceRef, ...conflicts.map((c) => c?.key)],
        );
      }
      const group = conflicts[0];
      const ids = [...new Set((group?.ids ?? []).filter(nonEmptyString))];
      if (!nonEmptyString(group?.key) || ids.length === 0) {
        return issue("proposals", ids, ["ambiguous_group"], [serviceRef]);
      }
      return {
        kind: "proposal_review",
        serviceRef,
        serviceDate,
        serviceType: input.serviceType,
        proposalIds: ids,
        conflict: {
          // A1's proposal summary keys `serviceRefConflicts` by the service ref
          // itself; anything else came from the target-key index.
          index: group.key === serviceRef ? "serviceRef" : "targetKey",
          key: group.key,
          ids,
        },
        status: null,
      };
    }

    default: {
      // A stored singleton status: exactly one validated, conflict-free record.
      const validated = (observation?.validated ?? []).filter((v) => nonEmptyString(v?.id));
      if (validated.length !== 1) return null;
      const status = presentation;
      if (!isProposalReviewStatus(status)) return null;
      return {
        kind: "proposal_review",
        serviceRef,
        serviceDate,
        serviceType: input.serviceType,
        proposalIds: [validated[0].id],
        conflict: null,
        status,
      };
    }
  }
}

// ── Resolving the target inside `ProposalsPanel` ──────────────────────────────

export type ProposalLoadState = "loading" | "ready" | "error";

/** One already-loaded proposal row. Only the id and the stored status are read. */
export interface LoadedProposal {
  id: string;
  status: string | null;
}

export interface ProposalHandoffContext {
  state: ProposalLoadState;
  /** The panel's own loaded records — matched by EXACT id, never regrouped. */
  records: readonly LoadedProposal[];
  /** The filter currently applied in the panel. */
  currentFilter: ProposalFilter;
}

export type ProposalHandoffResolution =
  | { outcome: "waiting" }
  | { outcome: "load_failed" }
  | { outcome: "not_found"; missingIds: string[] }
  | {
      outcome: "focus";
      /** Exact ids to reveal / scroll to / highlight, in the target's order. */
      ids: string[];
      /** Filter to apply; unchanged when the current one already reveals them. */
      nextFilter: ProposalFilter;
      /** A1's conflict key when the target carried a group, else null. */
      conflictKey: string | null;
      /** Target ids no longer present — the group changed under the admin. */
      missingIds: string[];
      /** True when a found status differs from the target's, or an id vanished. */
      changed: boolean;
    };

/**
 * The filter that reveals every found record. `all` is never narrowed; a filter
 * that already shows them is kept; otherwise switch to their shared status, or to
 * `all` when they differ.
 */
function nextFilterFor(
  found: readonly LoadedProposal[],
  currentFilter: ProposalFilter,
): ProposalFilter {
  if (currentFilter === "all") return "all";
  if (found.every((r) => r.status === currentFilter)) return currentFilter;
  const statuses = new Set(found.map((r) => r.status));
  if (statuses.size === 1) {
    const only = [...statuses][0];
    return isProposalReviewStatus(only) ? only : "all";
  }
  return "all";
}

/**
 * Resolve a `ProposalReviewTarget` against the panel's already-loaded response.
 * Exact-id lookup only: no target-key rebuilding, no regrouping, no canonical
 * winner. A load failure is distinct from not-found, and a still-loading panel
 * simply waits.
 */
export function resolveProposalHandoff(
  target: ProposalReviewTarget | null | undefined,
  ctx: ProposalHandoffContext,
): ProposalHandoffResolution {
  if (ctx?.state === "error") return { outcome: "load_failed" };
  if (!target || ctx?.state !== "ready") return { outcome: "waiting" };

  const wanted = [...new Set((target.proposalIds ?? []).filter(nonEmptyString))];
  const byId = new Map<string, LoadedProposal>();
  for (const record of ctx.records ?? []) {
    if (nonEmptyString(record?.id)) byId.set(record.id, record);
  }

  const found: LoadedProposal[] = [];
  const missingIds: string[] = [];
  for (const id of wanted) {
    const record = byId.get(id);
    if (record) found.push(record);
    else missingIds.push(id);
  }

  if (found.length === 0) return { outcome: "not_found", missingIds };

  const statusChanged =
    target.status !== null && found.some((r) => r.status !== target.status);
  return {
    outcome: "focus",
    ids: found.map((r) => r.id),
    nextFilter: nextFilterFor(found, ctx.currentFilter),
    conflictKey: target.conflict?.key ?? null,
    missingIds,
    changed: statusChanged || missingIds.length > 0,
  };
}

/** Spanish notice for a handoff that could not focus anything. */
export const HANDOFF_NOTICE: Record<"load_failed" | "not_found" | "changed", string> = {
  load_failed: "No se pudieron cargar las propuestas. Intenta de nuevo.",
  not_found:
    "La propuesta ya no está en la lista cargada. Recarga las propuestas para ver su estado actual.",
  changed: "La propuesta cambió desde que abriste el servicio. Revisa su estado actual.",
};

// ── The transient target reducer (tab + target in one place) ──────────────────

export type AdminTabId =
  | "members"
  | "services"
  | "proposals"
  | "availability"
  | "activity"
  | "content";

/** Which tab each target kind opens in. Integrity details live beside Servicios. */
export const HANDOFF_TAB: Record<AdminReviewTarget["kind"], AdminTabId> = {
  proposal_review: "proposals",
  integrity_issue: "services",
};

export interface ReviewTargetState {
  tab: AdminTabId;
  target: AdminReviewTarget | null;
}

export type ReviewTargetEvent =
  /** The user pressed a tab. Always clears the transient target. */
  | { type: "select_tab"; tab: AdminTabId }
  /** A card handed off: set the target and switch to its tab programmatically. */
  | { type: "open_target"; target: AdminReviewTarget }
  /** A panel finished resolving; only a successful focus consumes the target. */
  | { type: "resolved"; outcome: string }
  | { type: "clear" };

/**
 * Single owner of `{ tab, target }`. Because the tab lives in the same reducer, a
 * manual tab change CANNOT leave a stale target behind, and a successful focus
 * consumes it — so a remount never resurrects an obsolete filter/highlight.
 */
export function reduceReviewTarget(
  state: ReviewTargetState,
  event: ReviewTargetEvent,
): ReviewTargetState {
  switch (event?.type) {
    case "select_tab":
      return { tab: event.tab, target: null };
    case "open_target":
      return { tab: HANDOFF_TAB[event.target.kind], target: event.target };
    case "resolved":
      return event.outcome === "focus" ? { ...state, target: null } : state;
    case "clear":
      return { ...state, target: null };
    default:
      return state;
  }
}
