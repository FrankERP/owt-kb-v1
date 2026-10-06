// app/components/admin/fairnessToggleModel.ts
//
// «Cuenta para equidad» on the planner's surfaces (solver v3 C1 §6): the copy, the
// past-month rule (§6.0) and the effective-value helpers that every surface and
// every request body go through. Pure and NEUTRAL (no "use client"), so the save
// model, the draft-create body and the components share one definition.
//
// The read rule itself is NOT here: app/utils/countsForFairness.ts is the one
// definition of the GROQ fragment, its twin and the type default.
//
// «Past» (§6.0, C1-D7): a service whose month is before the current CDMX month,
// serviceTodayIso().slice(0, 7) — the split ServicesPanel already uses for «Roles
// previos». It is evaluated when a surface renders AND again when a request body is
// built, never cached across a save, so every helper takes `todayIso` with a default
// of "now". The rule is client-side only: neither roles route refuses on the month.

import { countsForFairnessDefault, type FairnessRoleType } from "@/app/utils/countsForFairness";
import type { GridColumn } from "./plannerModel";
import { serviceTodayIso } from "./serviceReadiness";

export const FAIRNESS_LABEL = "Cuenta para equidad";
/** Shown once per surface while the engine is v2 (parent U7). C6 CTL-1 rewires its condition. */
export const FAIRNESS_ENGINE_NOTE = "Cuenta para equidad: aplica con el nuevo solver. Hoy Auto no lo usa.";
export const FAIRNESS_PAST_REASON = "Mes pasado: ya no se cambia.";
export const FAIRNESS_SPECIAL_HELP =
  "Si cuenta, su Lead suma como Dom Lead en domingo y como Sáb Lead en otro día; BGV y Coro suman igual.";

const DAY_RE = /^\d{4}-\d{2}-\d{2}/;

/**
 * True when `date` (YYYY-MM-DD, a datetime prefix allowed) falls in a month before
 * the current CDMX month. A malformed date is not a month at all and answers false:
 * no surface can send a body for one (the composer refuses it, the server refuses
 * the PATCH), and a stored column also checks its stored date.
 */
export function isPastServiceMonth(date: string, todayIso: string = serviceTodayIso()): boolean {
  if (!DAY_RE.test(date)) return false;
  return date.slice(0, 7) < todayIso.slice(0, 7);
}

/**
 * A create target's effective value (§6.0, §6.1): the admin's choice — unless the
 * date falls in a past month, where it is the type default whatever was chosen.
 */
export function effectiveCreateCounts(
  type: FairnessRoleType,
  date: string,
  chosen: boolean,
  todayIso: string = serviceTodayIso(),
): boolean {
  return isPastServiceMonth(date, todayIso) ? countsForFairnessDefault(type) : chosen;
}

/** The grid Switch's accessible name: it identifies the column the way «Omitir» does. */
export function fairnessSwitchLabel(target: { date: string; serviceName?: string }): string {
  return target.serviceName
    ? `${FAIRNESS_LABEL} ${target.date} · ${target.serviceName}`
    : `${FAIRNESS_LABEL} ${target.date}`;
}

/**
 * Create mode (§6.1): the admin's header edits, by `columnId`, over the columns
 * `buildColumns` made — each column's EFFECTIVE value, the past-month rule applied.
 * Idempotent: applying it to columns it already produced changes nothing.
 */
export function applyCreateCountsEdits(
  columns: readonly GridColumn[],
  edits: ReadonlyMap<string, boolean>,
  todayIso: string = serviceTodayIso(),
): GridColumn[] {
  return columns.map((column) => ({
    ...column,
    countsForFairness: effectiveCreateCounts(
      column.type,
      column.date,
      edits.get(column.columnId) ?? column.countsForFairness,
      todayIso,
    ),
  }));
}

/**
 * Drop one column's held edit (§6.1: deselecting the weekend date or removing the
 * special discards its value). Returns the SAME map when there is nothing to drop,
 * so a state update with it re-renders nothing.
 */
export function withoutCountsEdit(edits: Map<string, boolean>, columnId: string): Map<string, boolean> {
  if (!edits.has(columnId)) return edits;
  const next = new Map(edits);
  next.delete(columnId);
  return next;
}
