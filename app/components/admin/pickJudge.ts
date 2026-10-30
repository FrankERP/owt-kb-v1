// app/components/admin/pickJudge.ts
//
// The manual pick's judgement, ONE definition for two surfaces: the planner grid's picker
// (`PlannerGrid`'s candidate list, «Asignar» and «Asignar de todos modos») and the MCP proposal
// editor's `place` gate on the server (plan T2.3 (2)). Neutral — no React, no `"use client"` — so a
// server module may call it (ADR-0028).
//
// Both halves used to live inline in `PlannerGrid`: `rankFor` assembled the inputs of
// `rankCandidates` (the seat, the column's seats, the column, its Sunday spine, the rules) and
// `toggleCandidate`/`overrideCandidate` read its verdict. Sharing only the verdict would not have
// been enough: `rankCandidates` enforces no rule when the column or the config is missing, and no
// week exclusion without the right spine, so a second assembly could judge the same pick
// differently and nothing would say so. The ASSEMBLY moved here with the verdict.
//
// What it does not own: WHERE the spine and the config come from. The grid passes its props (the
// config may be absent while the rules load — absent means "no rules", as `rankCandidates` says);
// the server passes `columnRuleInputs`' answer, which refuses rather than judge with one missing.

import type { ParticipantRole } from "@/app/utils/computeParticipation";
import { rankCandidates, type RankedCandidate, type RankMember } from "./candidateRanking";
import { assignedForColumn, seatDefForRow, type GridCell, type GridColumn, type GridRow, type SolverConfig } from "./plannerModel";
import { ruleRefusals, type RuleRefusal } from "./ruleEnforcement";

export interface PickContext {
  cells: GridCell[];
  rows: GridRow[];
  column: GridColumn;
  row: GridRow;
  members: RankMember[];
  /**
   * What ORDERS the list and gives `load`: the grid passes `[...savedWindow, ...inGridRoles]`
   * (D12). The verdict never reads it.
   */
  windowRoles: ParticipantRole[];
  /** What gives the `recent` strip: the grid passes `savedWindow` alone (D12). */
  recentRoles: ParticipantRole[];
  /** The column's Sunday spine (`sundaySpineForColumn`); week exclusions only. */
  sundayDates?: string[];
  /** Absent ⇒ no rules (never the defaults). */
  config?: SolverConfig;
}

/**
 * The candidate list of one seat, in the picker's order — `PlannerGrid`'s former `rankFor`. Two
 * `rankCandidates` calls merged (D12): order, `load` and every verdict from the first; `recent`
 * from the second. Both get the same `column`, spine and config, so the second's verdict, which
 * the merge discards, cannot disagree.
 */
export function pickCandidates(ctx: PickContext): RankedCandidate[] {
  const seat = seatDefForRow(ctx.row);
  const assigned = assignedForColumn(ctx.cells, ctx.rows, ctx.column.columnId);
  const common = { seat, date: ctx.column.date, members: ctx.members, assigned, column: ctx.column, sundayDates: ctx.sundayDates, config: ctx.config };
  const order = rankCandidates({ ...common, windowRoles: ctx.windowRoles });
  const recentOnly = rankCandidates({ ...common, windowRoles: ctx.recentRoles });
  const recentById = new Map(recentOnly.map((c) => [c.id, c.recent]));
  return order.map((c) => ({ ...c, recent: recentById.get(c.id) ?? c.recent }));
}

export type PickVerdict =
  /** The member already sits in this cell: the grid's toggle takes them OUT; the editor refuses (C1). */
  | { kind: "seated" }
  | { kind: "refused"; code: "C2" | "C3" | "unknown-member"; reason: string }
  | {
      kind: "prompt";
      code: "C4";
      /** The first rule's sentence, as the picker shows it. */
      reason: string;
      /** What the grid records on «Asignar de todos modos» — the only sanctioned way to build it. */
      addOverride: { memberId: string; reason: string };
      /** EVERY rule refusing the pick, by identity (the editor's cross-check reads these). */
      rules: RuleRefusal[];
    }
  | { kind: "clean" };

/**
 * The verdict on seating `memberId` in the context's cell. Order is the picker's: already seated,
 * then C3 (an ABSENCE from the list — the `memberType` filter runs before the ranking), then C2
 * (a seat clash — `seatsClash` — never forceable), then C4 (a hard rule, the only forceable refusal).
 * Unavailability is never a refusal: it is a sort penalty (fact 19).
 */
export function judgePick(ctx: PickContext, memberId: string, candidates: RankedCandidate[] = pickCandidates(ctx)): PickVerdict {
  const current = ctx.cells.find((c) => c.columnId === ctx.column.columnId && c.rowId === ctx.row.id);
  if (current?.occupants.some((o) => o.memberId === memberId)) return { kind: "seated" };
  const candidate = candidates.find((c) => c.id === memberId);
  if (!candidate) {
    const seat = seatDefForRow(ctx.row);
    return ctx.members.some((m) => m._id === memberId)
      ? { kind: "refused", code: "C3", reason: `No puede ocupar ${seat.label}: requiere tipo ${seat.memberType}` }
      : { kind: "refused", code: "unknown-member", reason: "Miembro desconocido" };
  }
  if (candidate.blockedReason) return { kind: "refused", code: "C2", reason: candidate.blockedReason };
  if (candidate.ruleBlockedReason) {
    const member = ctx.members.find((m) => m._id === memberId)!;
    const rules = ruleRefusals({
      member,
      row: ctx.row,
      column: ctx.column,
      sundayDates: ctx.sundayDates,
      assigned: assignedForColumn(ctx.cells, ctx.rows, ctx.column.columnId),
      members: ctx.members,
      config: ctx.config,
    });
    return {
      kind: "prompt",
      code: "C4",
      reason: candidate.ruleBlockedReason,
      addOverride: { memberId, reason: candidate.ruleBlockedReason },
      rules,
    };
  }
  return { kind: "clean" };
}
