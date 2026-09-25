// app/utils/solverHistoryTypes.ts
//
// The shapes `loadSolverHistory` returns — the result and R11's diff evidence —
// as TYPES ONLY, in a NEUTRAL module (ruling P2-R2; ADR-0028). The builder and
// the evidence module are `server-only`, but the admin route's callers and the
// diff CLI (which may import only neutral modules) must be able to name these
// shapes without pulling either in.
//
// Not in `solverHistory.ts` on purpose: that module pins that it never names the
// publication field (R3), and the evidence below has to.
//
// Spec: `docs/superpowers/specs/2026-09-23-solver-history-derivation-design.md`
// (R8, R11). Plan: `docs/superpowers/plans/2026-09-25-owt-mcp-p2-solver-history.md`
// (step 3).

import type { DerivedSolverHistory, SolverHistoryTarget, WeekendRoleType } from "./solverHistory";

/** member_name → role key → seats: the shape of an entry's `role_counts`. */
export type SolverHistoryRoleCounts = Record<string, Record<string, number>>;

/** A receipt's lifecycle, mirrored from `roleCreationReceipt.ts` (which this module may not import). */
export type SolverHistoryReceiptState = "committed" | "role_deleted";

/**
 * Which creation-time publication value, if either, makes the payload rebuilt
 * from the stored document reproduce its creation fingerprint (plan D7). The
 * flag is hashed, so a draft published later is unchanged `as: "draft"`.
 */
export type SolverHistoryUnchangedAs = "published" | "draft";

/** Why a window document fed nothing into `entries`. */
export type SolverHistoryExclusion =
  /** Two or more documents of its type on its day: R7 counts neither copy. */
  | "duplicate_target"
  /** Its stored `week` is not a valid calendar day, so it has no month. */
  | "invalid_date";

/**
 * The link between a window document and its creation receipt. Receipts are
 * matched by their own `roleId` — the authoritative reverse link.
 *
 * - `found`: exactly one receipt names the document (or several do, and one of
 *   them is the id the document itself records).
 * - `not_found`: the document carries a creation stamp (`creationReceiptId` or
 *   `creationFingerprint`) but no single receipt could be matched — deleted, or
 *   ambiguous. This is NOT R11 rule 4's "no receipt" arm (plan step 6).
 * - `unstamped`: the document carries neither stamp and no receipt names it —
 *   rule 4's "no receipt" arm: it was created outside the guarded create route.
 */
export type SolverHistoryReceiptLink =
  | {
      status: "found";
      receiptId: string;
      state: SolverHistoryReceiptState | null;
      /** The day of the receipt's immutable `targetIdentity`: where the document was CREATED. */
      targetDay: string | null;
      createdAt: string | null;
    }
  | { status: "not_found"; receiptId: string | null }
  | { status: "unstamped" };

/** One weekend role document in the window, as R11's rule 4 needs it. */
export interface SolverHistoryDocumentEvidence {
  roleId: string;
  type: WeekendRoleType;
  /** `serviceDayKey(week)`; null when the stored `week` is not a valid day. */
  day: string | null;
  /** The stored publication flag NOW; null when absent. */
  publishedRaw: boolean | null;
  receipt: SolverHistoryReceiptLink;
  /**
   * Non-null means the stored seats equal what was created (plan D7). Compared
   * against the found receipt's fingerprint, or the document's own
   * `creationFingerprint` when no receipt was found; null when neither exists.
   */
  unchangedAs: SolverHistoryUnchangedAs | null;
  /**
   * The FOUND receipt's fingerprint equals an empty-seat payload's for its own
   * target, under either publication value — stored mode's «+ Nuevo servicio».
   * Always false without a found receipt (rule 4 admits that arm only on one).
   */
  emptySeatCreate: boolean;
  excluded: SolverHistoryExclusion | null;
  /**
   * What this document fed into `entries`, under the derivation's own seat rule
   * (`roleSeatContributions`). Empty when `excluded` is set: a duplicate copy
   * is counted by neither copy, so it contributes nothing to explain.
   */
  contributes: SolverHistoryRoleCounts;
}

/**
 * A receipt whose target day is in the window while its role is not among the
 * window's documents: deleted since creation (`state: "role_deleted"`, or a
 * missing role) or moved out of the window.
 */
export interface SolverHistoryOutOfWindowReceipt {
  receiptId: string;
  state: SolverHistoryReceiptState | null;
  /** The receipt's target type — rule 4 attributes a cell only to a document of the matching type. */
  type: WeekendRoleType;
  targetDay: string;
  createdAt: string | null;
  roleId: string | null;
  /** The role's current day; null when it no longer exists (a missing role means deleted). */
  roleCurrentDay: string | null;
}

export interface SolverHistoryEvidenceMember {
  id: string;
  /** The current `member_name`; null when it is not a string. */
  name: string | null;
}

/** R11's positive control, the report's match rate: `unchanged / withReceipt`. */
export interface SolverHistoryEvidenceControl {
  /** Window documents whose receipt was found. */
  withReceipt: number;
  /** Of those, the ones whose rebuilt payload reproduces the receipt's fingerprint. */
  unchanged: number;
}

export interface SolverHistoryEvidence {
  /** Every weekend window document, sorted by day, type, id. */
  documents: SolverHistoryDocumentEvidence[];
  /** Sorted by target day, type, receipt id. */
  outOfWindowReceipts: SolverHistoryOutOfWindowReceipt[];
  /** EVERY member, kids-only included — which is why the route gates evidence to super-admin. */
  members: SolverHistoryEvidenceMember[];
  control: SolverHistoryEvidenceControl;
}

/** `loadSolverHistory`'s result. `evidence` is present only when asked for. */
export interface SolverHistoryResult extends DerivedSolverHistory {
  target: SolverHistoryTarget;
  evidence?: SolverHistoryEvidence;
}
