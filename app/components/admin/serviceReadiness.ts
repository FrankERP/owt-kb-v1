// Pure service-readiness model for `/admin -> Servicios` (Plan B item 2).
//
// This module answers exactly two questions per service card — "is it ready to
// publish?" and "what is the one thing to do next?" — plus "which controls may
// be enabled right now?". It is deliberately free of React, fetch, Sanity and
// `server-only`, so the same functions run in the client, in a server route that
// recomputes readiness authoritatively, and in tests.
//
// It CONSUMES the shipped A1/A2 contracts and never re-derives them:
//  - `serviceReadModel`      — role/proposal validation, member resolution,
//                              canonical/public target states.
//  - `setlistReadContract`   — the A1 admin setlist GET union and its
//                              fail-closed `canEditSetlistResponse` gate.
//  - `roleTargetLock`        — the A2 §1 lock issue vocabulary.
// The client never rebuilds proposal target keys, re-groups records, picks a
// winner among an ambiguous group, or invents a state A1 did not report.
//
// Invariants held here:
//  - Only `published === false` is a draft; a missing field is grandfathered
//    published (legacy services stay member-visible).
//  - `dataConfidence` is derived ONLY from the five source states and is never
//    stored, cached or updated independently.
//  - A source that is loading/failed is `unknown` — never "clear", "none",
//    "empty" or "single".
//  - Any dangling assignment reference is a blocking integrity issue and can
//    never collapse to `empty` or `assigned`.
//  - Controls are gated per control from the individual source states, NEVER
//    from aggregate `dataConfidence`.

import type { RoleTargetLockIssue } from "@/app/utils/roleTargetLock";
import { isValidServiceDate, type CanonicalMember } from "@/app/utils/serviceReadModel";
import {
  canEditSetlistResponse,
  type SetlistReadIssue,
} from "@/app/utils/setlistReadContract";

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

// ── Independently tracked sources ─────────────────────────────────────────────

/** The five independently loaded read domains (plan §"Data loading"). */
export const SERVICE_SOURCE_KEYS = [
  "roles",
  "members",
  "proposals",
  "roleTargets",
  "setlistTargets",
] as const;

export type ServiceSourceKey = (typeof SERVICE_SOURCE_KEYS)[number];

export type SourceState = "loading" | "ready" | "error";

export type ServiceSourceStates = Record<ServiceSourceKey, SourceState>;

export interface UnreadySource {
  source: ServiceSourceKey;
  state: "loading" | "error";
}

/**
 * The required sources that are not `ready`, in the caller's declared order. A
 * failure in a source the caller does not require is not reported — one blocked
 * flow must never disable an unrelated one.
 */
export function unreadySources(
  sources: ServiceSourceStates,
  required: readonly ServiceSourceKey[],
): UnreadySource[] {
  const out: UnreadySource[] = [];
  for (const source of required) {
    const state = sources[source];
    if (state !== "ready") out.push({ source, state });
  }
  return out;
}

export type DataConfidence = "complete" | "partial" | "error";

/**
 * Aggregate honesty label for the whole card. Derived ONLY from the five source
 * states: `complete` when all are ready, `error` when the roles source failed
 * (no card can be rendered from it), `partial` for any other loading/error
 * combination. This value is presentational — it must never gate a control.
 */
export function deriveDataConfidence(sources: ServiceSourceStates): DataConfidence {
  if (sources.roles === "error") return "error";
  for (const key of SERVICE_SOURCE_KEYS) {
    if (sources[key] !== "ready") return "partial";
  }
  return "complete";
}

// ── Publication state ────────────────────────────────────────────────────────

export type PublishState = "draft" | "published";

/**
 * Only an explicit `published === false` is a draft. A missing/legacy field is
 * grandfathered as published, matching every member-facing read.
 */
export function derivePublishState(published: unknown): PublishState {
  return published === false ? "draft" : "published";
}

// ── Record + role-target status ──────────────────────────────────────────────

export type RecordStatus = "valid" | "invalid";

export type RoleTargetStatus = "single" | "duplicate" | "draft_conflict" | "invalid" | "unknown";

/** A1's observed public target state (canonical cardinality plus raw-draft overlay). */
export type ObservedTargetState = "none" | "single" | "duplicate" | "invalid" | "draft_conflict";

/**
 * Map A1's observed role-target state for THIS card. A loading/failed source or
 * an unproven observation is `unknown`, never `single`. An observed `none`
 * contradicts the card's own existence (a card exists only for an observed
 * canonical role), so it fails closed to `invalid` rather than inventing a
 * clean target.
 */
export function deriveRoleTargetStatus(
  source: SourceState,
  observed: ObservedTargetState | null | undefined,
): RoleTargetStatus {
  if (source !== "ready" || !observed) return "unknown";
  switch (observed) {
    case "single":
      return "single";
    case "duplicate":
      return "duplicate";
    case "draft_conflict":
      return "draft_conflict";
    case "invalid":
    case "none":
      return "invalid";
    default:
      return "unknown";
  }
}

// ── Team status across the five seat paths ───────────────────────────────────

export type TeamStatus = "assigned" | "empty" | "unknown";

export interface TeamSummary {
  /** raw assignment references observed across all five seat paths (unique). */
  assignedRefCount: number;
  resolvedCount: number;
  danglingCount: number;
}

export interface TeamObservation {
  membersSource: SourceState;
  /** A1 `validateRole().assignedRefs` — Lead/BGVs/Chorus/instruments/foh_team. */
  assignedRefs: readonly string[];
  /** A1 `resolveMembers().danglingRefs` — refs with no canonical member. */
  danglingRefs: readonly string[];
}

export interface TeamDerivation {
  status: TeamStatus;
  danglingRefs: string[];
  summary: TeamSummary;
}

/**
 * `assigned` requires a ready members source, at least one raw assignment, and
 * every non-empty reference resolving. `empty` requires a ready members source
 * and zero references across all five paths. Anything unresolved — a loading or
 * failed members source, or ANY dangling reference — stays `unknown`: a dangling
 * assignment is a blocking integrity issue and must never read as a clean empty
 * or a clean assigned team.
 */
export function deriveTeam(observation: TeamObservation): TeamDerivation {
  const assignedRefs = [...new Set((observation.assignedRefs ?? []).filter(nonEmptyString))];
  const danglingRefs = [...new Set((observation.danglingRefs ?? []).filter(nonEmptyString))];
  const summary: TeamSummary = {
    assignedRefCount: assignedRefs.length,
    resolvedCount: Math.max(assignedRefs.length - danglingRefs.length, 0),
    danglingCount: danglingRefs.length,
  };
  if (observation.membersSource !== "ready") {
    return { status: "unknown", danglingRefs, summary };
  }
  if (danglingRefs.length > 0) return { status: "unknown", danglingRefs, summary };
  if (assignedRefs.length === 0) return { status: "empty", danglingRefs, summary };
  return { status: "assigned", danglingRefs, summary };
}

// ── Setlist status (the A1 collapse matrix) ──────────────────────────────────

export type SetlistStatus =
  | "none"
  | "incomplete"
  | "ready"
  | "duplicate"
  | "draft_conflict"
  | "invalid"
  | "unknown";

export interface SetlistDerivation {
  status: SetlistStatus;
  /** True only for the rows the plan marks "editor allowed". */
  editable: boolean;
  issue: SetlistReadIssue | null;
}

/**
 * Map A1's setlist GET response exactly (plan §"A1 setlist collapse matrix"):
 *
 * | A1 response                      | status         | editable |
 * |----------------------------------|----------------|----------|
 * | target `none`                    | `none`         | yes      |
 * | `single` + content `empty`       | `incomplete`   | yes      |
 * | `single` + content `incomplete`  | `incomplete`   | yes      |
 * | `single` + content `ready`       | `ready`        | yes      |
 * | `single` + content `invalid`     | `invalid`      | no       |
 * | target `duplicate`               | `duplicate`    | no       |
 * | target `draft_conflict`          | `draft_conflict` | no     |
 * | target/source `invalid`          | `invalid`      | no       |
 * | source not loaded/failed         | `unknown`      | no       |
 *
 * Editability comes from A1's own fail-closed `canEditSetlistResponse`, so a
 * malformed/dangling/duplicate-key payload is `invalid` (integrity details) and
 * never an ordinary empty setlist the admin could overwrite.
 */
export function deriveSetlist(source: SourceState, body: unknown): SetlistDerivation {
  if (source !== "ready" || body === null || body === undefined) {
    return { status: "unknown", editable: false, issue: null };
  }
  const decision = canEditSetlistResponse(body);
  if (decision.editable) {
    const read = decision.read;
    if (read.targetState === "none") {
      return { status: "none", editable: true, issue: null };
    }
    if (read.targetState === "single") {
      // `empty` and `incomplete` both present as one editable "incomplete" row.
      return {
        status: read.contentState === "ready" ? "ready" : "incomplete",
        editable: true,
        issue: null,
      };
    }
    // Unreachable: A1's gate opens only `none` and `single`. Fail closed.
    return { status: "invalid", editable: false, issue: "malformed" };
  }
  const status: SetlistStatus =
    decision.issue === "duplicate"
      ? "duplicate"
      : decision.issue === "draft_conflict"
        ? "draft_conflict"
        : "invalid";
  return { status, editable: false, issue: decision.issue };
}

/** Explicit ids A1 attached to a non-editable setlist branch, for integrity details. */
function setlistIssueIds(body: unknown): string[] {
  if (!isObj(body)) return [];
  const out: string[] = [];
  for (const field of ["conflictingIds", "draftIds", "canonicalIds", "recordIds"]) {
    const value = body[field];
    if (Array.isArray(value)) {
      for (const item of value) if (nonEmptyString(item)) out.push(item);
    }
  }
  return [...new Set(out)];
}

// ── Proposal presentation (display mapping over A1's response) ────────────────

export type ProposalPresentation =
  | "none"
  | "draft"
  | "pending"
  | "changes_requested"
  | "approved"
  | "conflict"
  | "invalid"
  | "draft_conflict"
  | "unknown";

const STORED_PROPOSAL_STATUSES: readonly ProposalPresentation[] = [
  "draft",
  "pending",
  "changes_requested",
  "approved",
];

/**
 * A1's already-grouped proposal response for exactly ONE service. Every field is
 * server-decided: the client supplies no target key, does no grouping, and picks
 * no winner.
 */
export interface ProposalObservation {
  /** A1's validated, conflict-free records associated with this service. */
  validated: readonly { id: string; status: string | null }[];
  /** A1's explicit grouping-conflict results (serviceRef and/or targetKey). */
  conflicts: readonly { key: string; ids: readonly string[] }[];
  /** A1 record issues associated with this service (invalid/dangling/malformed). */
  recordIssues: readonly { id: string; issues?: readonly string[] }[];
  /** Raw proposal draft ids A1 associated with this service. */
  draftIds: readonly string[];
}

/**
 * Display/readiness mapping over A1's explicit response, in the plan's order:
 * load failure -> `unknown`, associated record issues -> `invalid`, associated
 * raw draft ids -> `draft_conflict`, either grouping-conflict result ->
 * `conflict`, an empty validated group -> `none`, and exactly one conflict-free
 * validated record -> its stored status.
 *
 * More than one validated record with no explicit conflict is contradictory
 * input; it fails closed to `conflict` rather than selecting a winner. `stale`
 * and other invented states do not exist here.
 */
export function deriveProposalPresentation(
  source: SourceState,
  observed: ProposalObservation | null | undefined,
): ProposalPresentation {
  if (source !== "ready" || !observed) return "unknown";
  if ((observed.recordIssues ?? []).length > 0) return "invalid";
  if ((observed.draftIds ?? []).length > 0) return "draft_conflict";
  if ((observed.conflicts ?? []).length > 0) return "conflict";
  const validated = observed.validated ?? [];
  if (validated.length === 0) return "none";
  if (validated.length > 1) return "conflict";
  const status = validated[0]?.status;
  return STORED_PROPOSAL_STATUSES.includes(status as ProposalPresentation)
    ? (status as ProposalPresentation)
    : "invalid";
}

// ── Availability over the resolved seats ─────────────────────────────────────

export type AvailabilityStatus = "clear" | "conflict" | "unknown";

export interface AvailabilityConflict {
  memberId: string;
  memberName: string;
  note?: string;
}

/** Member fields availability needs; `CanonicalMember` satisfies it. */
export interface AvailabilityMember {
  _id: string;
  member_name?: string;
  alias?: string;
  unavailableDates?: readonly string[];
  /** Stored as `{ date, note }[]`; read defensively (see the note in the report). */
  unavailabilityNotes?: unknown;
}

function displayName(member: AvailabilityMember): string {
  return member.alias?.trim() || member.member_name || member._id;
}

function noteForDate(member: AvailabilityMember, date: string): string | undefined {
  const notes = member.unavailabilityNotes;
  if (Array.isArray(notes)) {
    for (const entry of notes) {
      if (isObj(entry) && entry.date === date && nonEmptyString(entry.note)) return entry.note;
    }
    return undefined;
  }
  return nonEmptyString(notes) ? notes : undefined;
}

/**
 * Members assigned to this service (already resolved across all five seat paths)
 * who marked the exact service day unavailable. A missing date computes nothing —
 * the caller reports `unknown`, never `clear`.
 */
export function computeAvailabilityConflicts(
  members: readonly (AvailabilityMember | CanonicalMember)[],
  serviceDate: string | null | undefined,
): AvailabilityConflict[] {
  if (!nonEmptyString(serviceDate)) return [];
  const out: AvailabilityConflict[] = [];
  const seen = new Set<string>();
  for (const raw of members ?? []) {
    const member = raw as AvailabilityMember;
    if (!member || !nonEmptyString(member._id) || seen.has(member._id)) continue;
    const dates = member.unavailableDates;
    if (!Array.isArray(dates) || !dates.includes(serviceDate)) continue;
    seen.add(member._id);
    const note = noteForDate(member, serviceDate);
    out.push({
      memberId: member._id,
      memberName: displayName(member),
      ...(note ? { note } : {}),
    });
  }
  return out;
}

/**
 * `unknown` whenever availability cannot honestly be computed: the members
 * source is loading/failed, the team itself is unresolved, or the service has no
 * usable date. A failure never means "clear".
 */
export function deriveAvailabilityStatus(input: {
  membersSource: SourceState;
  teamStatus: TeamStatus;
  serviceDate: string | null | undefined;
  conflicts: readonly AvailabilityConflict[];
}): AvailabilityStatus {
  if (input.membersSource !== "ready") return "unknown";
  if (input.teamStatus === "unknown") return "unknown";
  if (!nonEmptyString(input.serviceDate)) return "unknown";
  return (input.conflicts ?? []).length > 0 ? "conflict" : "clear";
}

// ── Integrity issues ─────────────────────────────────────────────────────────

export type ServiceIntegrityIssueKind =
  | "invalid_record"
  | "role_target_duplicate"
  | "role_target_draft_conflict"
  | "role_target_invalid"
  | "dangling_assignment"
  | "setlist_duplicate"
  | "setlist_draft_conflict"
  | "setlist_invalid"
  | "proposal_invalid"
  | "proposal_draft_conflict"
  | "proposal_conflict"
  /** An A2 §1 weekend target-lock issue supplied by the caller. */
  | "lock"
  /** Any other blocking A1/A2 issue associated with this card. */
  | "legacy";

export interface ServiceIntegrityIssue {
  kind: ServiceIntegrityIssueKind;
  /** True when the issue blocks readiness and outranks ordinary workflow actions. */
  blocking: boolean;
  /** Explicit document/draft ids, so `Revisar datos` can name them. */
  ids: string[];
  reason?: string;
}

/**
 * Adapt A2 §1 lock issues into blocking card issues. Every reported lock issue
 * is blocking: A2's publish-ready planner refuses a weekend assertion whose
 * coordination token is missing or unsafe, so a publish computed over one could
 * not commit anyway.
 */
export function lockIssuesToIntegrity(
  issues: readonly RoleTargetLockIssue[],
): ServiceIntegrityIssue[] {
  return (issues ?? []).map((issue) => ({
    kind: "lock" as const,
    blocking: true,
    ids: [issue.lockId, issue.roleId].filter(nonEmptyString),
    reason: issue.detail ? `${issue.kind}: ${issue.detail}` : issue.kind,
  }));
}

// ── The definitive readiness predicate ───────────────────────────────────────

export interface ReadinessDimensions {
  sources: ServiceSourceStates;
  publishState: PublishState;
  recordStatus: RecordStatus;
  roleTargetStatus: RoleTargetStatus;
  teamStatus: TeamStatus;
  /** Dangling assignment references; any at all is a blocking integrity issue. */
  danglingRefCount: number;
  setlistStatus: SetlistStatus;
  proposalPresentation: ProposalPresentation;
  availabilityStatus: AvailabilityStatus;
  /**
   * Blocking A1/A2 issues that are NOT one of the dimensions above (weekend lock
   * issues, legacy integrity issues associated with this card). The dimension
   * rows carry their own ordering, so they are counted separately.
   */
  blockingIssueCount: number;
}

/** Proposal states that do not block: absence is a workflow, not a missing artifact. */
const CLEAN_PROPOSAL_STATES: readonly ProposalPresentation[] = ["none", "approved"];

/**
 * True only when every row of the plan's readiness table is clean: all five
 * sources ready, a valid record, a single role target, an `assigned` team with
 * no dangling refs, a `ready` setlist, no active proposal, clear availability,
 * and no blocking integrity issue.
 *
 * Publication state is deliberately NOT part of it — a published service uses
 * this as a health signal.
 */
export function isOperationallyReady(d: ReadinessDimensions): boolean {
  for (const key of SERVICE_SOURCE_KEYS) {
    if (d.sources[key] !== "ready") return false;
  }
  if (d.recordStatus !== "valid") return false;
  if (d.roleTargetStatus !== "single") return false;
  if (d.teamStatus !== "assigned") return false;
  if (d.danglingRefCount > 0) return false;
  if (d.setlistStatus !== "ready") return false;
  if (!CLEAN_PROPOSAL_STATES.includes(d.proposalPresentation)) return false;
  if (d.availabilityStatus !== "clear") return false;
  if (d.blockingIssueCount > 0) return false;
  return true;
}

/** Drafts only: a published service never enters the ready-to-publish count. */
export function isReadyToPublish(d: ReadinessDimensions): boolean {
  return d.publishState === "draft" && isOperationallyReady(d);
}

// ── Total primary-action priority ────────────────────────────────────────────

export type PrimaryActionKind =
  | "review_data"
  | "review_duplicate_roles"
  | "review_setlist_data"
  | "loading"
  | "retry_load"
  | "resolve_conflict"
  | "review_proposals"
  | "review_proposal"
  | "complete_setlist"
  | "edit_team"
  | "publish"
  | "edit_setlist"
  | "edit_service";

/** Spanish, admin-facing labels — verbatim from the plan. */
export const PRIMARY_ACTION_LABELS: Record<PrimaryActionKind, string> = {
  review_data: "Revisar datos",
  review_duplicate_roles: "Revisar roles duplicados",
  review_setlist_data: "Revisar datos del setlist",
  loading: "Cargando datos",
  retry_load: "Reintentar carga",
  resolve_conflict: "Resolver conflicto",
  review_proposals: "Revisar propuestas",
  review_proposal: "Revisar propuesta",
  complete_setlist: "Completar setlist",
  edit_team: "Editar equipo",
  publish: "Publicar",
  edit_setlist: "Editar setlist",
  edit_service: "Editar servicio",
};

export interface PrimaryAction {
  kind: PrimaryActionKind;
  label: string;
  /** Only the `loading` rule renders a disabled control. */
  disabled: boolean;
  /** The 1-based ordered rule that matched, for tests and diagnostics. */
  rule: number;
  /** Machine-readable "why", e.g. which sources failed. */
  reason?: string;
}

function action(kind: PrimaryActionKind, rule: number, reason?: string): PrimaryAction {
  return {
    kind,
    label: PRIMARY_ACTION_LABELS[kind],
    disabled: kind === "loading",
    rule,
    ...(reason ? { reason } : {}),
  };
}

const SETLIST_INTEGRITY_STATUSES: readonly SetlistStatus[] = [
  "duplicate",
  "draft_conflict",
  "invalid",
];

/**
 * The plan's single ordered list; the FIRST matching rule wins. Data-integrity
 * blockers (1-3) outrank load state, and `loading` (4) outranks `error` (5), so a
 * card never invites a retry while a fetch is still in flight.
 */
export function resolvePrimaryAction(d: ReadinessDimensions): PrimaryAction {
  // 1 — invalid record, proposal integrity, role-target draft conflict/invalid,
  //     dangling assignment, or a blocking legacy/lock issue.
  if (
    d.recordStatus === "invalid" ||
    d.proposalPresentation === "invalid" ||
    d.proposalPresentation === "draft_conflict" ||
    d.roleTargetStatus === "draft_conflict" ||
    d.roleTargetStatus === "invalid" ||
    d.danglingRefCount > 0 ||
    d.blockingIssueCount > 0
  ) {
    return action("review_data", 1);
  }

  // 2 — duplicate role target.
  if (d.roleTargetStatus === "duplicate") return action("review_duplicate_roles", 2);

  // 3 — setlist duplicate / draft conflict / invalid.
  if (SETLIST_INTEGRITY_STATUSES.includes(d.setlistStatus)) {
    return action("review_setlist_data", 3);
  }

  // 4 — any required source still loading (outranks error).
  const loading = SERVICE_SOURCE_KEYS.filter((k) => d.sources[k] === "loading");
  if (loading.length > 0) return action("loading", 4, loading.join(","));

  // 5 — any required source failed.
  const failed = SERVICE_SOURCE_KEYS.filter((k) => d.sources[k] === "error");
  if (failed.length > 0) return action("retry_load", 5, failed.join(","));

  // 6 — sources ready but a required derived status cannot be proven.
  if (
    d.roleTargetStatus === "unknown" ||
    d.teamStatus === "unknown" ||
    d.setlistStatus === "unknown" ||
    d.proposalPresentation === "unknown" ||
    d.availabilityStatus === "unknown"
  ) {
    return action("review_data", 6);
  }

  // 7 — availability conflict.
  if (d.availabilityStatus === "conflict") return action("resolve_conflict", 7);

  // 8 — proposal grouping conflict.
  if (d.proposalPresentation === "conflict") return action("review_proposals", 8);

  // 9 — proposal pending / changes requested.
  if (d.proposalPresentation === "pending" || d.proposalPresentation === "changes_requested") {
    return action("review_proposal", 9);
  }

  // 10 — proposal draft.
  if (d.proposalPresentation === "draft") return action("review_proposal", 10);

  // 11 — setlist missing or incomplete.
  if (d.setlistStatus === "none" || d.setlistStatus === "incomplete") {
    return action("complete_setlist", 11);
  }

  // 12 — empty team.
  if (d.teamStatus === "empty") return action("edit_team", 12);

  // 13 — clean draft.
  if (d.publishState === "draft" && isOperationallyReady(d)) return action("publish", 13);

  // 14 — published.
  if (d.publishState === "published") return action("edit_setlist", 14);

  // 15 — fallback. Unreachable from any valid combination of the typed model
  //      (every unclean dimension above matches an earlier rule); kept so an
  //      out-of-contract value degrades to a safe, non-destructive action.
  return action("edit_service", 15);
}

// ── The assembled card model ─────────────────────────────────────────────────

export interface ServiceReadinessInput {
  sources: ServiceSourceStates;
  /** The stored `published` field exactly as read (missing = legacy published). */
  published?: unknown;
  /** A1 `validateRole().groupable` for this card's canonical role. */
  recordValid: boolean;
  /** Canonical role id, for integrity details. */
  roleId?: string;
  /** A1's observed public role-target state for this card's target. */
  roleTarget: ObservedTargetState | null;
  /** Explicit ids A1 reported for a non-single role target. */
  roleTargetIds?: readonly string[];
  /** A1 raw refs + resolution result across all five seat paths. */
  team: { assignedRefs: readonly string[]; danglingRefs: readonly string[] };
  /** The exact A1 admin setlist GET body, or null when not observed. */
  setlistResponse?: unknown;
  /** A1's already-grouped proposal response for this service, or null. */
  proposal?: ProposalObservation | null;
  /** `week` for a weekend service, `date` for a special one. */
  serviceDate: string | null;
  /** Canonical members resolved for this service's seats. */
  members?: readonly (AvailabilityMember | CanonicalMember)[];
  /** Blocking/non-blocking A1/A2 issues associated with this card (locks, legacy). */
  integrityIssues?: readonly ServiceIntegrityIssue[];
}

export interface ServiceReadiness extends ReadinessDimensions {
  dataConfidence: DataConfidence;
  setlistEditable: boolean;
  conflicts: AvailabilityConflict[];
  teamSummary: TeamSummary;
  /** Derived dimension issues plus the caller's supplied A1/A2 issues. */
  integrityIssues: ServiceIntegrityIssue[];
  isOperationallyReady: boolean;
  isReadyToPublish: boolean;
  primaryAction: PrimaryAction;
}

/** Assemble one card's readiness from the A1/A2 observations. Pure and total. */
export function deriveServiceReadiness(input: ServiceReadinessInput): ServiceReadiness {
  const sources = input.sources;
  const publishState = derivePublishState(input.published);
  const recordStatus: RecordStatus = input.recordValid ? "valid" : "invalid";
  const roleTargetStatus = deriveRoleTargetStatus(sources.roleTargets, input.roleTarget);

  const team = deriveTeam({
    membersSource: sources.members,
    assignedRefs: input.team?.assignedRefs ?? [],
    danglingRefs: input.team?.danglingRefs ?? [],
  });

  const setlist = deriveSetlist(sources.setlistTargets, input.setlistResponse ?? null);
  const proposalPresentation = deriveProposalPresentation(sources.proposals, input.proposal);

  const conflicts =
    sources.members === "ready" && team.status !== "unknown"
      ? computeAvailabilityConflicts(input.members ?? [], input.serviceDate)
      : [];
  const availabilityStatus = deriveAvailabilityStatus({
    membersSource: sources.members,
    teamStatus: team.status,
    serviceDate: input.serviceDate,
    conflicts,
  });

  const supplied = [...(input.integrityIssues ?? [])];
  const derived: ServiceIntegrityIssue[] = [];
  const push = (kind: ServiceIntegrityIssueKind, ids: string[], reason?: string) =>
    derived.push({ kind, blocking: true, ids, ...(reason ? { reason } : {}) });

  if (recordStatus === "invalid") {
    push("invalid_record", input.roleId ? [input.roleId] : []);
  }
  const roleTargetIds = [...(input.roleTargetIds ?? [])].filter(nonEmptyString);
  if (roleTargetStatus === "duplicate") push("role_target_duplicate", roleTargetIds);
  if (roleTargetStatus === "draft_conflict") push("role_target_draft_conflict", roleTargetIds);
  if (roleTargetStatus === "invalid" && recordStatus === "valid") {
    push("role_target_invalid", roleTargetIds);
  }
  if (team.danglingRefs.length > 0) push("dangling_assignment", team.danglingRefs);
  if (setlist.status === "duplicate") {
    push("setlist_duplicate", setlistIssueIds(input.setlistResponse));
  }
  if (setlist.status === "draft_conflict") {
    push("setlist_draft_conflict", setlistIssueIds(input.setlistResponse));
  }
  if (setlist.status === "invalid") {
    push("setlist_invalid", setlistIssueIds(input.setlistResponse), setlist.issue ?? undefined);
  }
  if (proposalPresentation === "invalid") {
    push(
      "proposal_invalid",
      (input.proposal?.recordIssues ?? []).map((r) => r.id).filter(nonEmptyString),
    );
  }
  if (proposalPresentation === "draft_conflict") {
    push("proposal_draft_conflict", [...(input.proposal?.draftIds ?? [])].filter(nonEmptyString));
  }
  if (proposalPresentation === "conflict") {
    push(
      "proposal_conflict",
      (input.proposal?.conflicts ?? []).flatMap((c) => [...c.ids]).filter(nonEmptyString),
    );
  }

  const dimensions: ReadinessDimensions = {
    sources,
    publishState,
    recordStatus,
    roleTargetStatus,
    teamStatus: team.status,
    danglingRefCount: team.danglingRefs.length,
    setlistStatus: setlist.status,
    proposalPresentation,
    availabilityStatus,
    blockingIssueCount: supplied.filter((i) => i.blocking).length,
  };

  return {
    ...dimensions,
    dataConfidence: deriveDataConfidence(sources),
    setlistEditable: setlist.editable,
    conflicts,
    teamSummary: team.summary,
    integrityIssues: [...derived, ...supplied],
    isOperationallyReady: isOperationallyReady(dimensions),
    isReadyToPublish: isReadyToPublish(dimensions),
    primaryAction: resolvePrimaryAction(dimensions),
  };
}

// ── Per-control source gating ────────────────────────────────────────────────

export const SERVICE_CONTROLS = [
  "monthFilters",
  "createService",
  "generateMonth",
  "editTeam",
  "changeServiceDate",
  "deleteService",
  "swap",
  "copyInstruments",
  "editSetlist",
  "participationSidebar",
  "proposalHandoff",
  "publishReady",
  "unpublish",
] as const;

export type ServiceControl = (typeof SERVICE_CONTROLS)[number];

const ALL_SOURCES: readonly ServiceSourceKey[] = SERVICE_SOURCE_KEYS;

/**
 * The plan's per-control matrix. A mutation control is enabled only when EVERY
 * source needed to populate its choices and enforce its client preconditions is
 * `ready`; the server still repeats all guards.
 */
export const CONTROL_REQUIRED_SOURCES: Record<ServiceControl, readonly ServiceSourceKey[]> = {
  monthFilters: ["roles"],
  createService: ALL_SOURCES,
  generateMonth: ALL_SOURCES,
  editTeam: ["roles", "members", "roleTargets"],
  changeServiceDate: ALL_SOURCES,
  deleteService: ALL_SOURCES,
  swap: ["roles", "members", "roleTargets"],
  copyInstruments: ["roles", "members", "roleTargets"],
  editSetlist: ["roles", "roleTargets", "setlistTargets"],
  participationSidebar: ["roles", "members"],
  proposalHandoff: ["roles", "proposals"],
  publishReady: ALL_SOURCES,
  // Safe unpublish deliberately needs neither members, setlist nor proposals: a
  // published service may be hidden even when those are unsafe or unavailable.
  unpublish: ["roles", "roleTargets"],
};

export interface ControlCapability {
  control: ServiceControl;
  enabled: boolean;
  /** Every required source that is not ready, for source-specific retry copy. */
  blockedBy: UnreadySource[];
}

export type ServiceCapabilities = Record<ServiceControl, ControlCapability>;

/**
 * Pure capability snapshot. Deliberately reads the five individual source states
 * — NOT aggregate `dataConfidence` — so one failed domain never disables an
 * unrelated control whose own dependencies are ready.
 */
export function selectServiceCapabilities(sources: ServiceSourceStates): ServiceCapabilities {
  const out = {} as ServiceCapabilities;
  for (const control of SERVICE_CONTROLS) {
    const blockedBy = unreadySources(sources, CONTROL_REQUIRED_SOURCES[control]);
    out[control] = { control, enabled: blockedBy.length === 0, blockedBy };
  }
  return out;
}

/** Single-control check for handler entry points (render AND submit). */
export function isControlEnabled(
  sources: ServiceSourceStates,
  control: ServiceControl,
): boolean {
  return unreadySources(sources, CONTROL_REQUIRED_SOURCES[control]).length === 0;
}

// ── Per-target create/month preflight presentation ───────────────────────────

export type TargetPreflightState = "checking" | "unknown" | "exists" | "blocked" | "creatable";

export interface TargetPreflightInput {
  /** The exact normalized target key this state describes. */
  targetKey: string;
  sources: ServiceSourceStates;
  /** A1's observed canonical/raw role state at this target; null = unproven. */
  role: ObservedTargetState | null;
  /** True for weekend targets; a special target takes no weekend lock. */
  expectsLock: boolean;
  /** The weekend lock observation; null = unproven (when `expectsLock`). */
  lock: { eligible: boolean; issues?: readonly RoleTargetLockIssue[] } | null;
  /** Canonical + raw setlist history observed at the target; null = unproven. */
  setlistHistory: { canonicalIds: readonly string[]; draftIds: readonly string[] } | null;
  /** Canonical + raw proposal history observed at the target; null = unproven. */
  proposalHistory: { canonicalIds: readonly string[]; draftIds: readonly string[] } | null;
  /** Explicit A1/A2 issues associated with this exact target. */
  targetIssues?: readonly ServiceIntegrityIssue[];
}

export interface TargetPreflight {
  targetKey: string;
  state: TargetPreflightState;
  reasons: string[];
  /** Explicit document/draft ids behind the reasons, when A1/A2 supplied them. */
  ids: string[];
  blockedBy: UnreadySource[];
}

/**
 * Provisional UI capability for ONE create/month target, over an observed A1/A2
 * bundle. It copies no mutation decision: the create endpoint still reruns A2's
 * full preflight and may answer `409`.
 *
 * `checking` (still loading) is never rendered as vacant or creatable, and
 * `unknown` (failed domain or unproven observation) is blocked with
 * source-specific retry. `creatable` requires every source ready AND explicit
 * proof of no canonical role, no conflicting raw role, an eligible lock when
 * applicable, no canonical/raw setlist or proposal history, and no associated
 * integrity issue.
 */
export function deriveTargetPreflight(input: TargetPreflightInput): TargetPreflight {
  const blockedBy = unreadySources(input.sources, ALL_SOURCES);
  const base = { targetKey: input.targetKey, blockedBy };

  const loading = blockedBy.filter((b) => b.state === "loading");
  if (loading.length > 0) {
    return { ...base, state: "checking", reasons: loading.map((b) => `loading:${b.source}`), ids: [] };
  }
  const failed = blockedBy.filter((b) => b.state === "error");
  if (failed.length > 0) {
    return { ...base, state: "unknown", reasons: failed.map((b) => `error:${b.source}`), ids: [] };
  }

  const unproven: string[] = [];
  if (!input.role) unproven.push("role_unobserved");
  if (input.expectsLock && !input.lock) unproven.push("lock_unobserved");
  if (!input.setlistHistory) unproven.push("setlist_unobserved");
  if (!input.proposalHistory) unproven.push("proposal_unobserved");
  if (unproven.length > 0) return { ...base, state: "unknown", reasons: unproven, ids: [] };

  if (input.role === "single") {
    return { ...base, state: "exists", reasons: ["role_single"], ids: [] };
  }

  const reasons: string[] = [];
  const ids: string[] = [];

  if (input.role && input.role !== "none") reasons.push(`role_${input.role}`);

  if (input.expectsLock && input.lock) {
    if (!input.lock.eligible) reasons.push("lock_not_eligible");
    for (const issue of input.lock.issues ?? []) {
      reasons.push(`lock_${issue.kind}`);
      if (nonEmptyString(issue.lockId)) ids.push(issue.lockId);
      if (nonEmptyString(issue.roleId)) ids.push(issue.roleId);
    }
  }

  const history: [string, { canonicalIds: readonly string[]; draftIds: readonly string[] }][] = [
    ["setlist_history", input.setlistHistory!],
    ["proposal_history", input.proposalHistory!],
  ];
  for (const [reason, observed] of history) {
    const found = [...observed.canonicalIds, ...observed.draftIds].filter(nonEmptyString);
    if (found.length > 0) {
      reasons.push(reason);
      ids.push(...found);
    }
  }

  for (const issue of input.targetIssues ?? []) {
    reasons.push(`issue_${issue.kind}`);
    ids.push(...issue.ids.filter(nonEmptyString));
  }

  if (reasons.length > 0) {
    return { ...base, state: "blocked", reasons, ids: [...new Set(ids)] };
  }
  return { ...base, state: "creatable", reasons: [], ids: [] };
}

/** Only targets A1/A2 proved creatable may be posted by month generation. */
export function creatableTargets(results: readonly TargetPreflight[]): TargetPreflight[] {
  return (results ?? []).filter((r) => r.state === "creatable");
}

// ── Service dates (America/Mexico_City) ──────────────────────────────────────

export const SERVICE_TIME_ZONE = "America/Mexico_City";

/**
 * Parse a stored service date at LOCAL NOON, so rendering never day-flips in any
 * timezone. Accepts a legacy datetime prefix and returns null for a malformed or
 * non-calendar value — a bad date is an integrity issue, not a crash.
 */
export function parseServiceDateAtNoon(iso: unknown): Date | null {
  if (typeof iso !== "string") return null;
  const day = iso.slice(0, 10);
  if (!isValidServiceDate(day)) return null;
  return new Date(`${day}T12:00:00`);
}

/** "Today" as a `YYYY-MM-DD` calendar day in America/Mexico_City. */
export function serviceTodayIso(now: Date = new Date()): string {
  return now.toLocaleDateString("sv", { timeZone: SERVICE_TIME_ZONE });
}

const MS_PER_DAY = 86_400_000;

/**
 * Calendar-day difference (`service - today`), computed at local noon so a DST
 * transition or an elapsed-hours rounding error can never shift the count.
 * Returns null when either day is unusable.
 */
export function serviceDayOffset(serviceIso: unknown, todayIso: unknown): number | null {
  const service = parseServiceDateAtNoon(serviceIso);
  const today = parseServiceDateAtNoon(todayIso);
  if (!service || !today) return null;
  return Math.round((service.getTime() - today.getTime()) / MS_PER_DAY);
}

/** Past = strictly before today's Mexico City calendar day (safe string compare). */
export function isPastServiceDate(serviceIso: unknown, todayIso: string): boolean {
  const offset = serviceDayOffset(serviceIso, todayIso);
  return offset !== null && offset < 0;
}
