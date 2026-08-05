// Shared error model for protected service mutations (Service Readiness A2).
//
// Every protected writer (roles, live setlists, proposals) rejects stale or
// ambiguous state with the SAME typed code + HTTP status, so a client can branch
// on `body.error` instead of parsing prose, and a `409` always means "your view
// is stale — reload, keep the modal open, do not close as success".
//
// Pure: no Sanity client, no I/O, no framework types. Route handlers wrap the
// returned `{ status, body }` in `NextResponse.json(body, { status })`.

/**
 * Conflict codes. All map to HTTP 409. `bootstrap_completed_reload` is the one
 * conflict where documented maintenance state (a legacy lock plus an advanced
 * role revision) intentionally persists; business fields are still unchanged and
 * no notification/revalidation runs.
 */
export const SERVICE_CONFLICT_CODES = [
  /** Same creation request id, different canonical payload fingerprint. */
  "idempotency_mismatch",
  /** Creation request id belongs to a receipt whose role was deleted. */
  "idempotency_key_retired",
  /** Legacy lock bootstrap committed, then a later business conflict occurred. */
  "bootstrap_completed_reload",
  /** Legacy lock bootstrap persistence could not be proved either way. */
  "bootstrap_outcome_unknown",
  /** Create target already carries orphaned setlist/proposal history. */
  "target_has_orphaned_dependencies",
  /** Old or destination date of a move carries dependent history. */
  "role_date_has_dependencies",
  /** Deletion target carries dependent history. */
  "role_has_dependencies",
  /** Approved proposal with no valid approval receipt. */
  "legacy_approval_unverified",
  /** Client-observed document/lock revision no longer matches stored state. */
  "stale_revision",
  /** Target resolves to zero-or-many canonical documents, or duplicate groups. */
  "ambiguous_target",
  /** Malformed/dangling/wrong-owner state that must never be repaired implicitly. */
  "integrity_conflict",
] as const;

export type ServiceConflictCode = (typeof SERVICE_CONFLICT_CODES)[number];

/** Non-conflict rejections that share the same body shape. */
const NON_CONFLICT_CODES = ["invalid_request", "forbidden", "not_found"] as const;

export const SERVICE_ERROR_CODES = [...SERVICE_CONFLICT_CODES, ...NON_CONFLICT_CODES] as const;

export type ServiceErrorCode = (typeof SERVICE_ERROR_CODES)[number];

/** The three dependency-refusal codes of plan §3. */
export const DEPENDENCY_CODES = [
  "target_has_orphaned_dependencies",
  "role_date_has_dependencies",
  "role_has_dependencies",
] as const;

export type DependencyErrorCode = (typeof DEPENDENCY_CODES)[number];

const CONFLICT_SET: ReadonlySet<string> = new Set(SERVICE_CONFLICT_CODES);

const NON_CONFLICT_STATUS: Record<(typeof NON_CONFLICT_CODES)[number], number> = {
  invalid_request: 400,
  forbidden: 403,
  not_found: 404,
};

const DEFAULT_MESSAGES: Record<ServiceErrorCode, string> = {
  idempotency_mismatch:
    "This creation request id was already used with a different payload. Start a new request.",
  idempotency_key_retired:
    "This creation request id belongs to a deleted service and cannot be reused.",
  bootstrap_completed_reload:
    "Legacy coordination state was repaired, but your change did not apply. Reload and retry.",
  bootstrap_outcome_unknown:
    "Legacy coordination persistence could not be verified. Stop writes and reconcile before retrying.",
  target_has_orphaned_dependencies:
    "This target already has setlist or proposal history and will not be adopted automatically.",
  role_date_has_dependencies:
    "The current or destination date has dependent setlist or proposal history.",
  role_has_dependencies: "This service has dependent setlist or proposal history.",
  legacy_approval_unverified:
    "This proposal is approved but has no verifiable approval receipt.",
  stale_revision: "Someone else changed this first. Reload and retry.",
  ambiguous_target: "This target does not resolve to exactly one document.",
  integrity_conflict: "Stored state failed an integrity check and was not modified.",
  invalid_request: "The request was rejected before any write.",
  forbidden: "Not allowed.",
  not_found: "Not found.",
};

/** True only for a registered conflict code. */
export function isServiceConflictCode(code: string): code is ServiceConflictCode {
  return CONFLICT_SET.has(code);
}

/**
 * HTTP status for a code. Every conflict is 409. An unregistered code fails
 * closed to 409 rather than a success-shaped status.
 */
export function serviceErrorStatus(code: ServiceErrorCode): number {
  if (isServiceConflictCode(code)) return 409;
  return NON_CONFLICT_STATUS[code as (typeof NON_CONFLICT_CODES)[number]] ?? 409;
}

export interface ServiceErrorBody {
  /** Stable machine code — clients branch on this, never on `message`. */
  error: ServiceErrorCode;
  message: string;
  /** True when the caller's view is stale and must be reloaded. */
  conflict: boolean;
  details?: Record<string, unknown>;
}

export interface ServiceErrorResponse {
  status: number;
  body: ServiceErrorBody;
}

/** Build a consistent error body + HTTP status. `details` is omitted when absent. */
export function serviceError(
  code: ServiceErrorCode,
  opts: { message?: string; details?: Record<string, unknown> } = {},
): ServiceErrorResponse {
  return {
    status: serviceErrorStatus(code),
    body: {
      error: code,
      message: opts.message ?? DEFAULT_MESSAGES[code] ?? "Request rejected.",
      conflict: isServiceConflictCode(code),
      ...(opts.details ? { details: opts.details } : {}),
    },
  };
}

/** One dependent document that blocks a create/move/delete. */
export interface DependencyRef {
  id: string;
  type: string;
  kind: string;
  scope: "target" | "old" | "new" | "role";
  detail?: string;
}

/**
 * Dependency refusal carrying the EXACT ids/types found by the inventory, so the
 * operator can act on them without a second query. Never cascades, adopts,
 * migrates, archives, or deletes anything.
 */
export function serviceDependencyError(
  code: DependencyErrorCode,
  dependencies: readonly DependencyRef[],
  opts: { message?: string } = {},
): ServiceErrorResponse {
  return serviceError(code, {
    ...opts,
    details: { dependencies: [...dependencies] },
  });
}
