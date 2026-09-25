"use client";

import {
  bothPriorMonthLeadVisibilities,
  priorCalendarMonth,
  type PriorMonthLeadVisibility,
} from "./leadPoolHistory";
import type { RankMember } from "./candidateRanking";
import type { SolverConfig, SolverHistoryEntry } from "./plannerModel";

function LeadColumn({ info, derived, priorMonthEmpty }: {
  info: PriorMonthLeadVisibility;
  derived: boolean;
  priorMonthEmpty: boolean;
}) {
  return (
    <div className="rounded-lg border border-accent/15 bg-surface-raised-alt/40 p-3 space-y-1.5">
      <p className="font-label text-[10px] uppercase tracking-widest text-mono-500">
        {info.serviceLabel} — sin Lead en {info.priorMonthLabel}
      </p>
      {/*
        A derived history always carries the prior month, so «Sin historial
        guardado» cannot be true there; what CAN be is a month with no weekend
        services, which is said by name.
      */}
      {derived ? (
        priorMonthEmpty && (
          <p className="font-body text-[11px] text-mono-500">
            Sin servicios de fin de semana en {info.priorMonthLabel}.
          </p>
        )
      ) : !info.hasPriorMonthEntry && (
        <p className="font-body text-[11px] text-mono-500">
          Sin historial guardado para ese mes; se asume que nadie del pool lideró.
        </p>
      )}
      {info.names.length === 0 ? (
        <p className="font-body text-xs text-mono-500">
          {info.hasPriorMonthEntry && !priorMonthEmpty
            ? "Todos los líderes elegibles ya lideraron ese mes."
            : "Nadie en el pool de líderes (o todos están excluidos por reglas)."}
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {info.names.map((name) => (
            <li
              key={name}
              className="font-label text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full border border-accent/25 bg-accent/10 text-accent"
            >
              {name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function LeadPoolHistoryPanel({
  config,
  members,
  history,
  year,
  month,
  emptyMonthKeys,
}: {
  config: SolverConfig;
  members: RankMember[];
  history: SolverHistoryEntry[];
  year: number;
  month: number;
  /**
   * Derived fairness history only (`SOLVER_HISTORY_SOURCE === "derived"`): the
   * `${year}-${month}` keys of window months that had no weekend services.
   * Its PRESENCE is what marks the derived copy — «Sin historial guardado…» is
   * never shown then, and an empty prior month is named instead. Absent, the
   * panel is the per-browser one, unchanged.
   */
  emptyMonthKeys?: readonly string[];
}) {
  const { sunday, saturday } = bothPriorMonthLeadVisibilities({
    config,
    members,
    history,
    year,
    month,
  });
  const derived = emptyMonthKeys !== undefined;
  const priorMonthEmpty = derived && emptyMonthKeys.includes(priorCalendarMonth(year, month).key);

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <LeadColumn info={sunday} derived={derived} priorMonthEmpty={priorMonthEmpty} />
      <LeadColumn info={saturday} derived={derived} priorMonthEmpty={priorMonthEmpty} />
    </div>
  );
}
