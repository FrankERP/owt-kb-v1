/**
 * Member hard-delete helpers (P2): referential-integrity classification,
 * solver-pool cleanup fields, and client outcome parsing for AdminPanel.
 */

import { sanityConflictKind } from "./roleWriteRequest";

export const MEMBER_DELETE_ERROR = {
  HAS_REFERENCES: "member_has_references",
  POOL_CLEANUP_FAILED: "member_deleted_pool_cleanup_failed",
} as const;

export type MemberDeleteErrorCode =
  (typeof MEMBER_DELETE_ERROR)[keyof typeof MEMBER_DELETE_ERROR];

export const MEMBER_HAS_REFERENCES_MESSAGE =
  "No se puede eliminar porque tiene historial en el sistema (servicios, propuestas u otros registros). Puedes retirarlo de Alabanza en su lugar.";

export const MEMBER_POOL_CLEANUP_FAILED_MESSAGE =
  "El miembro fue eliminado, pero su id puede seguir en los pools del planificador. Reintenta la eliminación o limpia los pools manualmente.";

const REF_INTEGRITY_RE =
  /cannot be deleted|references to it|referenced by|reference constraint|referenc/i;

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

/**
 * True when Sanity rejected a delete because other documents still reference
 * the target. Revision conflicts from `sanityConflictKind` are excluded.
 */
export function isSanityReferentialIntegrityError(err: unknown): boolean {
  if (!isObj(err)) return false;

  const message = typeof err.message === "string" ? err.message : "";
  if (REF_INTEGRITY_RE.test(message)) return true;

  const details = isObj(err.details) ? err.details : null;
  if (details) {
    const description = typeof details.description === "string" ? details.description : "";
    if (REF_INTEGRITY_RE.test(description)) return true;

    const items = Array.isArray(details.items) ? details.items : [];
    for (const item of items) {
      const inner = isObj(item) && isObj(item.error) ? item.error : null;
      if (!inner) continue;
      if (typeof inner.type === "string" && /reference/i.test(inner.type)) return true;
      if (typeof inner.description === "string" && REF_INTEGRITY_RE.test(inner.description)) {
        return true;
      }
    }
  }

  const kind = err.statusCode === 409 ? sanityConflictKind(err) : null;
  if (kind === "revision_mismatch" || kind === "already_exists") return false;
  return false;
}

export interface StoredSolverPools {
  sundayLeads?: unknown;
  saturdayLeads?: unknown;
  support?: unknown;
}

export function memberIdInSolverPools(doc: StoredSolverPools, memberId: string): boolean {
  for (const field of ["sundayLeads", "saturdayLeads", "support"] as const) {
    const arr = doc[field];
    if (Array.isArray(arr) && arr.some((id) => id === memberId)) return true;
  }
  return false;
}

/** Pool arrays with `memberId` removed, or null when no pool contained it. */
export function solverPoolCleanupPatch(
  doc: StoredSolverPools,
  memberId: string,
): { sundayLeads: string[]; saturdayLeads: string[]; support: string[] } | null {
  if (!memberIdInSolverPools(doc, memberId)) return null;
  const without = (raw: unknown) =>
    Array.isArray(raw)
      ? raw.filter((id): id is string => typeof id === "string" && id !== memberId)
      : [];
  return {
    sundayLeads: without(doc.sundayLeads),
    saturdayLeads: without(doc.saturdayLeads),
    support: without(doc.support),
  };
}

export type MemberDeleteClientOutcome =
  | { kind: "success" }
  | { kind: "references"; message: string }
  | { kind: "partial"; message: string; refreshList: true }
  | { kind: "generic" };

/** Maps a DELETE response into the modal/toast contract AdminPanel uses. */
export function interpretMemberDeleteResponse(
  ok: boolean,
  body: { error?: string; message?: string; deleted?: boolean },
): MemberDeleteClientOutcome {
  if (ok) return { kind: "success" };
  if (
    body.error === MEMBER_DELETE_ERROR.POOL_CLEANUP_FAILED ||
    body.deleted === true
  ) {
    return {
      kind: "partial",
      message: body.message ?? MEMBER_POOL_CLEANUP_FAILED_MESSAGE,
      refreshList: true,
    };
  }
  if (body.error === MEMBER_DELETE_ERROR.HAS_REFERENCES) {
    return {
      kind: "references",
      message: body.message ?? MEMBER_HAS_REFERENCES_MESSAGE,
    };
  }
  return { kind: "generic" };
}
