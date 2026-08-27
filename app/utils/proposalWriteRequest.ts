// Request validation, approval receipts and transition fingerprints for the
// protected proposal writers (Service Readiness A2 §6).
//
// Pure decision logic over already-fetched values (Node `crypto` only, like
// `roleCreationReceipt`): no Sanity client, no I/O, no framework types, so every
// idempotency and staleness rule is exhaustively unit-testable in memory.
//
// Two mutexes/guards live here:
//  1. A deterministic proposal id (`setlistProposal.<roleId>`) is the FIRST-CREATE
//     mutex: two co-leads who both observed "no proposal" race on one id, and the
//     loser is told (409) instead of creating a second shared proposal.
//  2. An approval receipt fingerprints the exact inputs that were published, so a
//     lost-response retry is a no-write success, an approved proposal with no
//     receipt is `409 legacy_approval_unverified`, and a transition that already
//     committed can be replayed without writing twice.

import { createHash } from "node:crypto";

import { PROPOSAL_NOTES_MAX } from "./proposalNotesLimit";
import { PROPOSAL_STATUSES, SERVICE_KINDS, isValidServiceDate } from "./serviceReadModel";
import {
  isCanonicalDocumentId,
  isRevisionString,
  type ParseResult,
} from "./roleWriteRequest";
import {
  parseObservedTarget,
  parseSongRows,
  type NormalizedSongRow,
  type ObservedTarget,
} from "./setlistWriteRequest";

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function fail(issues: string[]): { ok: false; issues: string[] } {
  return { ok: false, issues };
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Deterministic JSON with sorted object keys; array ORDER is preserved. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isObj(value)) {
    const keys = Object.keys(value).sort(compareStrings);
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Text normalization for fingerprinted free text: NFC, trimmed, collapsed. */
function normalizeText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.normalize("NFC").trim().replace(/\s+/g, " ");
}

// ── Deterministic proposal identity ────────────────────────────────────────

export const PROPOSAL_TYPE = "setlistProposal";

/**
 * The ONE id a first create may use for a service's shared proposal. Legacy
 * random-id proposals still resolve through A1's two indexes; this id only ever
 * governs a NEW proposal, and being deterministic is what serializes co-leads.
 */
export function deterministicProposalId(roleId: unknown): string | null {
  if (!isCanonicalDocumentId(roleId)) return null;
  return `${PROPOSAL_TYPE}.${roleId}`;
}

// ── Member save/resubmit request ───────────────────────────────────────────

export const PROPOSAL_SAVE_STATUSES = ["draft", "pending"] as const;
export type ProposalSaveStatus = (typeof PROPOSAL_SAVE_STATUSES)[number];

export { PROPOSAL_NOTES_MAX } from "./proposalNotesLimit";

export interface ParsedProposalSaveRequest {
  roleId: string;
  status: ProposalSaveStatus;
  /** The state the client observed for this service's shared proposal. */
  observed: ObservedTarget;
  songs: NormalizedSongRow[];
  leadNotes: string;
  teamNotes: string;
}

/**
 * Parse the §6 member contract:
 * `{ roleId, observed, songs, leadNotes?, teamNotes?, status: "draft" | "pending" }`
 *
 * `observed` is REQUIRED. Service type and date are deliberately NOT accepted
 * from the client: the writer refreshes them from the authorized canonical role.
 */
export function parseProposalSaveRequest(body: unknown): ParseResult<ParsedProposalSaveRequest> {
  if (!isObj(body)) return fail(["payload"]);
  if (!isCanonicalDocumentId(body.roleId)) return fail(["roleId"]);
  if (!(PROPOSAL_SAVE_STATUSES as readonly unknown[]).includes(body.status)) return fail(["status"]);
  const observed = parseObservedTarget(body.observed);
  if (!observed.ok) return observed;
  const songs = parseSongRows(body.songs);
  if (!songs.ok) return songs;
  if (body.leadNotes != null && typeof body.leadNotes !== "string") return fail(["leadNotes"]);
  if (body.teamNotes != null && typeof body.teamNotes !== "string") return fail(["teamNotes"]);
  const leadNotes = typeof body.leadNotes === "string" ? body.leadNotes : "";
  const teamNotes = typeof body.teamNotes === "string" ? body.teamNotes : "";
  if (leadNotes.length > PROPOSAL_NOTES_MAX || teamNotes.length > PROPOSAL_NOTES_MAX) {
    return fail(["notes_length"]);
  }
  return {
    ok: true,
    value: {
      roleId: body.roleId,
      status: body.status as ProposalSaveStatus,
      observed: observed.value,
      songs: songs.value,
      leadNotes,
      teamNotes,
    },
  };
}

// ── Admin transition request ───────────────────────────────────────────────

export const PROPOSAL_ACTIONS = [
  "approve",
  "request_changes",
  "reopen",
  "reconcile_target",
] as const;
export type ProposalAction = (typeof PROPOSAL_ACTIONS)[number];

export interface ParsedProposalTransitionRequest {
  action: ProposalAction;
  /** The proposal revision the admin ACTUALLY reviewed — never a server refetch. */
  rev: string;
  adminNotes: string;
}

/**
 * Parse the §6 admin contract: `{ action, rev, adminNotes? }`. The reviewed
 * revision is required for every action: a freshly fetched server revision is not
 * a substitute, because it would re-authorize a decision made against content the
 * reviewer never saw.
 */
export function parseProposalTransitionRequest(
  body: unknown,
): ParseResult<ParsedProposalTransitionRequest> {
  if (!isObj(body)) return fail(["payload"]);
  if (!(PROPOSAL_ACTIONS as readonly unknown[]).includes(body.action)) return fail(["action"]);
  if (!isRevisionString(body.rev)) return fail(["rev"]);
  if (body.adminNotes != null && typeof body.adminNotes !== "string") return fail(["adminNotes"]);
  const adminNotes = typeof body.adminNotes === "string" ? body.adminNotes : "";
  if (adminNotes.length > PROPOSAL_NOTES_MAX) return fail(["notes_length"]);
  return {
    ok: true,
    value: { action: body.action as ProposalAction, rev: body.rev, adminNotes },
  };
}

// ── Approval receipt ───────────────────────────────────────────────────────

/**
 * Bump when the FINGERPRINTED shape changes, so old digests can never collide.
 *
 * "Fingerprinted" means what `canonicalizeApprovalInput` covers, NOT what the
 * document holds. Release 2 added `messages[]` to `setlistProposal` and did not
 * bump this — see **ADR-0023**, which is the answer to "surely the thread was a
 * shape change?". Bumping invalidates every `approval_receipt` in production at
 * once, and the receipt is what makes a retried approval a no-write success
 * rather than a second publish.
 */
export const APPROVAL_RECEIPT_VERSION = 1;
/** App/version marker recorded and fingerprinted with every approval. */
export const APPROVAL_APP_MARKER = "owt-kb-v1/a2-approval-1";

/** The exact inputs an approval publishes into the live setlist. */
export interface ApprovalInput {
  serviceType: string;
  serviceDate: string;
  /** The canonical role the proposal targets. */
  serviceRef: string;
  /** Live-setlist target key (weekend setlist type + week, or the special role id). */
  setlistTargetKey: string;
  /** Ordered song rows exactly as they will be written. */
  songs: readonly { songId: string; playKey: string; medleyTag: string | null }[];
  teamNotes: string;
}

export interface CanonicalApprovalInput {
  v: number;
  marker: string;
  serviceType: string;
  serviceDate: string;
  serviceRef: string;
  setlistTargetKey: string;
  songs: { songId: string; playKey: string; medleyTag: string }[];
  teamNotes: string;
}

/**
 * Canonicalize the approval inputs: normalized target, ORDERED song refs / play
 * keys / medley tags, team notes, and the app/version marker. Order is
 * significant (a reordered setlist is a different setlist), unlike the
 * order-insensitive role create fingerprint.
 */
export function canonicalizeApprovalInput(input: ApprovalInput): CanonicalApprovalInput {
  return {
    v: APPROVAL_RECEIPT_VERSION,
    marker: APPROVAL_APP_MARKER,
    serviceType: normalizeText(input.serviceType),
    serviceDate: normalizeText(input.serviceDate),
    serviceRef: normalizeText(input.serviceRef),
    setlistTargetKey: normalizeText(input.setlistTargetKey),
    songs: (input.songs ?? []).map((s) => ({
      songId: normalizeText(s.songId),
      playKey: normalizeText(s.playKey),
      medleyTag: normalizeText(s.medleyTag),
    })),
    teamNotes: normalizeText(input.teamNotes),
  };
}

/**
 * Deterministic approval-input fingerprint. Deliberately EXCLUDES the approval
 * timestamp, so recomputing it from the stored proposal after a lost response
 * matches the recorded receipt and the retry is a no-write success.
 */
export function approvalInputFingerprint(input: ApprovalInput): string {
  return sha256(stableStringify(canonicalizeApprovalInput(input)));
}

export interface ApprovalReceipt {
  v: number;
  marker: string;
  fingerprint: string;
  serviceType: string;
  serviceDate: string;
  serviceRef: string;
  setlistTargetKey: string;
  /** The live setlist document this approval wrote. */
  setlistId: string;
  songCount: number;
  approvedAt: string;
  approvedBy?: string;
}

/**
 * The receipt an approval records in the SAME transaction that writes the live
 * setlist and marks the proposal approved. It carries the input fingerprint, the
 * published target/document, the timestamp and the app/version marker — enough to
 * prove afterwards that this exact content was published by this code.
 */
export function buildApprovalReceipt(input: {
  approval: ApprovalInput;
  setlistId: string;
  now: string;
  approvedBy?: string | null;
}): ApprovalReceipt | null {
  if (!nonEmptyString(input.setlistId) || !nonEmptyString(input.now)) return null;
  const canonical = canonicalizeApprovalInput(input.approval);
  if (!canonical.serviceRef || !canonical.setlistTargetKey) return null;
  return {
    v: APPROVAL_RECEIPT_VERSION,
    marker: APPROVAL_APP_MARKER,
    fingerprint: approvalInputFingerprint(input.approval),
    serviceType: canonical.serviceType,
    serviceDate: canonical.serviceDate,
    serviceRef: canonical.serviceRef,
    setlistTargetKey: canonical.setlistTargetKey,
    setlistId: input.setlistId,
    songCount: canonical.songs.length,
    approvedAt: input.now,
    ...(nonEmptyString(input.approvedBy) ? { approvedBy: input.approvedBy } : {}),
  };
}

export type ApprovalReceiptDecision =
  /** A structurally valid receipt for exactly these inputs: replay is a no-write success. */
  | "verified"
  /** A valid receipt, but for different content: reopen is the only honest path. */
  | "fingerprint_mismatch"
  /** Missing/malformed/foreign receipt on an approved proposal (§6 legacy case). */
  | "unverified";

/**
 * What a stored receipt means for an already-approved proposal. Fails closed:
 * anything that is not a structurally complete receipt for THIS target is
 * `unverified`, never treated as a successful approval.
 */
export function decideApprovalReceipt(input: {
  receipt: unknown;
  fingerprint: string;
  serviceRef: string;
  setlistTargetKey: string;
}): ApprovalReceiptDecision {
  const receipt = input.receipt;
  if (!isObj(receipt)) return "unverified";
  // Our own marker + version, not a caller-supplied `_type`: a receipt written by
  // anything else (or by an older shape) can never verify an approval.
  if (receipt.marker !== APPROVAL_APP_MARKER) return "unverified";
  if (receipt.v !== APPROVAL_RECEIPT_VERSION) return "unverified";
  if (!nonEmptyString(receipt.fingerprint)) return "unverified";
  if (!nonEmptyString(receipt.approvedAt)) return "unverified";
  if (!nonEmptyString(receipt.setlistId)) return "unverified";
  if (receipt.serviceRef !== input.serviceRef) return "unverified";
  if (receipt.setlistTargetKey !== input.setlistTargetKey) return "unverified";
  return receipt.fingerprint === input.fingerprint ? "verified" : "fingerprint_mismatch";
}

// ── Transition fingerprints (request_changes / reopen / reconcile_target) ───

export interface TransitionIntent {
  action: ProposalAction;
  proposalId: string;
  /** The status this transition commits. */
  toStatus: string;
  adminNotes: string;
  /** Normalized target identity, for `reconcile_target`. */
  targetIdentity?: string | null;
}

/**
 * Fingerprint of a transition INTENT — action, proposal, resulting status,
 * admin notes and (for a retarget) the normalized target. Deliberately excludes
 * the source status and any timestamp, so a lost-response replay of the same
 * intent matches the record the first attempt committed.
 */
export function transitionFingerprint(intent: TransitionIntent): string {
  return sha256(
    stableStringify({
      v: APPROVAL_RECEIPT_VERSION,
      marker: APPROVAL_APP_MARKER,
      action: intent.action,
      proposalId: normalizeText(intent.proposalId),
      toStatus: normalizeText(intent.toStatus),
      adminNotes: normalizeText(intent.adminNotes),
      targetIdentity: normalizeText(intent.targetIdentity ?? ""),
    }),
  );
}

export interface StoredTransition {
  v: number;
  marker: string;
  action: string;
  fingerprint: string;
  toStatus: string;
  at: string;
  by?: string;
}

export function buildTransitionRecord(input: {
  intent: TransitionIntent;
  now: string;
  by?: string | null;
}): StoredTransition {
  return {
    v: APPROVAL_RECEIPT_VERSION,
    marker: APPROVAL_APP_MARKER,
    action: input.intent.action,
    fingerprint: transitionFingerprint(input.intent),
    toStatus: input.intent.toStatus,
    at: input.now,
    ...(nonEmptyString(input.by) ? { by: input.by } : {}),
  };
}

export type TransitionRetryDecision =
  /** This exact transition already committed: an explicit no-write retry. */
  | "no_write_retry"
  /** Not yet committed: validate source state and commit. */
  | "proceed";

/**
 * Decide whether an admin transition already committed. Both the resulting status
 * AND the recorded intent fingerprint must match; a matching status with a
 * different intent (e.g. different notes) is a genuine new transition, and a
 * matching fingerprint under a different status is not a completed retry.
 */
export function decideTransitionRetry(input: {
  storedStatus: unknown;
  storedTransition: unknown;
  intent: TransitionIntent;
}): TransitionRetryDecision {
  if (input.storedStatus !== input.intent.toStatus) return "proceed";
  const stored = input.storedTransition;
  if (!isObj(stored)) return "proceed";
  if (stored.marker !== APPROVAL_APP_MARKER || stored.v !== APPROVAL_RECEIPT_VERSION) {
    return "proceed";
  }
  if (stored.action !== input.intent.action) return "proceed";
  if (stored.toStatus !== input.intent.toStatus) return "proceed";
  if (!nonEmptyString(stored.fingerprint)) return "proceed";
  return stored.fingerprint === transitionFingerprint(input.intent) ? "no_write_retry" : "proceed";
}

// ── Source-state policy ────────────────────────────────────────────────────

/** Source states an approval may be granted from (§6). */
export const APPROVABLE_SOURCE_STATUSES = ["pending", "changes_requested"] as const;
/** Source states `request_changes` may be applied from. */
export const REQUEST_CHANGES_SOURCE_STATUSES = ["pending", "changes_requested"] as const;
/** Only an approved proposal can be re-opened. */
export const REOPEN_SOURCE_STATUSES = ["approved"] as const;
/** A retarget never touches approved history. */
export const RECONCILE_SOURCE_STATUSES = ["draft", "pending", "changes_requested"] as const;

const SOURCE_POLICY: Record<ProposalAction, readonly string[]> = {
  approve: APPROVABLE_SOURCE_STATUSES,
  request_changes: REQUEST_CHANGES_SOURCE_STATUSES,
  reopen: REOPEN_SOURCE_STATUSES,
  reconcile_target: RECONCILE_SOURCE_STATUSES,
};

/** True when `status` is a permitted source state for `action`. */
export function isAllowedSourceStatus(action: ProposalAction, status: unknown): boolean {
  if (!(PROPOSAL_STATUSES as readonly unknown[]).includes(status)) return false;
  return SOURCE_POLICY[action].includes(status as string);
}

/** The status each transition commits. */
export function transitionTargetStatus(action: ProposalAction): string {
  if (action === "approve") return "approved";
  if (action === "reconcile_target") return "";
  return "changes_requested";
}

// ── Canonical target metadata (refreshed from the authorized role) ─────────

export interface CanonicalProposalTarget {
  serviceType: string;
  serviceDate: string;
  serviceRef: string;
  /** `sunday:<date>` / `saturday:<date>` / `special:<roleId>`. */
  targetKey: string;
  /** Live-setlist target: `featuredSongs:<week>` / `saturdarSongs:<week>` / role id. */
  setlistTargetKey: string;
}

/**
 * Derive proposal target metadata from a canonical role document — never from the
 * client. Returns null when the role cannot be targeted, so a writer fails closed
 * instead of storing a guessed type/date.
 */
export function targetFromCanonicalRole(role: unknown): CanonicalProposalTarget | null {
  if (!isObj(role)) return null;
  const roleId = nonEmptyString(role._id) ? role._id : null;
  if (!roleId) return null;
  const serviceType =
    role._type === "sunday_role"
      ? "sunday"
      : role._type === "saturday_role"
        ? "saturday"
        : role._type === "special_role"
          ? "special"
          : null;
  if (!serviceType || !(SERVICE_KINDS as readonly unknown[]).includes(serviceType)) return null;
  const rawDate = serviceType === "special" ? role.date : role.week;
  if (!isValidServiceDate(rawDate)) return null;
  const serviceDate = rawDate;
  return {
    serviceType,
    serviceDate,
    serviceRef: roleId,
    targetKey: serviceType === "special" ? `special:${roleId}` : `${serviceType}:${serviceDate}`,
    setlistTargetKey:
      serviceType === "sunday"
        ? `featuredSongs:${serviceDate}`
        : serviceType === "saturday"
          ? `saturdarSongs:${serviceDate}`
          : roleId,
  };
}

/** Ordered approval song rows from a STORED proposal projection. */
export function storedProposalSongRows(
  songs: unknown,
): { songId: string; playKey: string; medleyTag: string | null }[] | null {
  if (!Array.isArray(songs)) return null;
  const out: { songId: string; playKey: string; medleyTag: string | null }[] = [];
  for (const raw of songs) {
    if (!isObj(raw)) return null;
    const song = raw.song;
    const ref = isObj(song) && nonEmptyString(song._ref) ? song._ref : null;
    if (!ref) return null;
    out.push({
      songId: ref,
      playKey: typeof raw.play_key === "string" ? raw.play_key : "",
      medleyTag: nonEmptyString(raw.medley_tag) ? raw.medley_tag : null,
    });
  }
  return out;
}
