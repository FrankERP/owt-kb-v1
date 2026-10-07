// scripts/lib/reconstructTypes.ts
//
// Shared shapes of the fairness-record reconstruction (solver v3 C4; spec
// docs/superpowers/specs/2026-10-05-solver-v3-c4-record-reconstruction-design.md).
// Types, constant tables and one error class: no I/O, no Sanity client and no import
// of C2's write-request module, so every other `reconstruct*` module may import it
// without joining that module's importer pin (C2 IF2-23: only `reconstructDecide.ts`
// and the CLI file import the write-request module).

import type { EligibilityMember } from "../../app/utils/fairnessEligibility";
import type { FairnessMonthBody, RoleKey } from "../../app/utils/fairnessVocabulary";

/** The four role lines a join month is kept for (R5). Presence sub-lines have none. */
export type Line = "DL" | "SL" | "BGV" | "CORO";
export const LINES: readonly Line[] = ["DL", "SL", "BGV", "CORO"];

/** The role keys of each line — C2 IF2-1's role → line map, inverted. */
export const LINE_ROLES: Readonly<Record<Line, readonly RoleKey[]>> = {
  DL: ["Sun.Lead"],
  SL: ["Sat.Lead"],
  BGV: ["Sun.BGV", "Sat.BGV"],
  CORO: ["Sun.Choir", "Sat.Choir"],
};

/** One row of C2 IF2-27 (the worship roster) exactly as read; handed to IF2-15 and C3 unaltered (R3, R4). */
export type RosterRow = EligibilityMember;

/** A reconstruction write entry: IF2-15's body plus the revision it asserts — IF2-18 requires `expectedRev` for either actor. */
export type ReconstructionBody = FairnessMonthBody & { expectedRev: string | null };

/** Why a cell has its status (R11's reason code; Spanish labels in `reconstructReport.ts`). */
export type CellReason = "tipo" | "sin_tipo" | "regla" | "fija" | "linea" | "partida" | "correccion";
export interface CellInfo {
  reason: CellReason;
  corrected: boolean;
}
export type PersonCells = Record<RoleKey, CellInfo>;

/** One «corregido» mark (R8, R11). Kept beside the body in the plan, never inside it: IF2-18 is strict. */
export interface Correction {
  memberId: string;
  field: RoleKey | "exempt" | "sundayCadence" | "blocks" | "added";
}

/** A month's planned action (spec «Decision per month», plus R1's skip). */
export type MonthAction = "create" | "replace" | "unchanged" | "skip" | "not_reconstruction_owned" | "record_edited";
/** A rollback month's planned action (R18; C2 WR-14 D1–D3). */
export type RollbackAction = "delete" | "none" | "not_reconstruction_owned" | "record_edited";

/** R13's anomaly types, in the order the spec lists them (also the table's order). */
export const ANOMALY_CODES = [
  "seat_while_out",
  "seat_unavailable",
  "seat_rule_excluded",
  "join_mid_month",
  "exact_mismatch",
  "cadence_not_in",
  "not_ticked_today",
  "ticked_never_seated",
  "presence_no_seat",
  "presence_outside",
  "person_added",
  "member_gone",
  "duplicate_target",
  "second_seat",
  "rule_split",
  "lost_block",
] as const;
export type AnomalyCode = (typeof ANOMALY_CODES)[number];

/**
 * One anomaly (R13): listed, never resolved. `memberId`, `ruleKey` and `roleIds` are
 * private — an anomaly reaches only the private table and the plan; stdout prints a
 * count per month (R12).
 */
export interface Anomaly {
  code: AnomalyCode;
  /** null for the per-person pool anomalies, which span the whole run. */
  month: string | null;
  memberId?: string;
  line?: Line;
  roleKey?: RoleKey;
  date?: string;
  serviceId?: string;
  ruleKey?: string;
  ruleOrdinal?: string;
  roles?: RoleKey[];
  count?: number;
  held?: number;
  months?: string[];
  firstServiceDate?: string;
  type?: string;
  roleIds?: string[];
  dates?: string[];
}

export type RefusalKind =
  | "restricción"
  | "conflicto"
  | "presencia"
  | "regla fija"
  | "mes por medio"
  | "personas"
  | "corrección"
  | "plan";

/**
 * One refusal (R13). Only `reason`, `kind`, `rules[].ordinal`, `month`, `roleKey` and
 * `issues` (C2's index-based issues, IF2-18) may reach stdout; `rules[].key`,
 * `person`, `memberIds`, `detail` and `fix` go to the private refusal report only.
 */
export interface RunRefusal {
  reason: string;
  kind: RefusalKind;
  rules: Array<{ ordinal: string; key: string | null }>;
  month?: string;
  roleKey?: RoleKey;
  issues?: Array<{ path: string; message: string }>;
  person?: string;
  memberIds?: string[];
  detail: string;
  fix: string;
}

/** A failed or malformed read (R3): the run stops with exit 1 before any file is written. */
export class ReadFailure extends Error {
  constructor(
    readonly step: string,
    readonly causeClass: string = "",
  ) {
    super(`read failed: ${step}`);
    this.name = "ReadFailure";
  }
}
