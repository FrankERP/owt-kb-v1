"use client";

import {
  bothPriorMonthLeadVisibilities,
  type PriorMonthLeadVisibility,
} from "./leadPoolHistory";
import type { RankMember } from "./candidateRanking";
import type { SolverConfig, SolverHistoryEntry } from "./plannerModel";

function LeadColumn({ info }: { info: PriorMonthLeadVisibility }) {
  return (
    <div className="rounded-lg border border-accent/15 bg-surface-raised-alt/40 p-3 space-y-1.5">
      <p className="font-label text-[10px] uppercase tracking-widest text-mono-500">
        {info.serviceLabel} — sin Lead en {info.priorMonthLabel}
      </p>
      {!info.hasPriorMonthEntry && (
        <p className="font-body text-[11px] text-mono-500">
          Sin historial guardado para ese mes; se asume que nadie del pool lideró.
        </p>
      )}
      {info.names.length === 0 ? (
        <p className="font-body text-xs text-mono-500">
          {info.hasPriorMonthEntry
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
}: {
  config: SolverConfig;
  members: RankMember[];
  history: SolverHistoryEntry[];
  year: number;
  month: number;
}) {
  const { sunday, saturday } = bothPriorMonthLeadVisibilities({
    config,
    members,
    history,
    year,
    month,
  });

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <LeadColumn info={sunday} />
      <LeadColumn info={saturday} />
    </div>
  );
}
