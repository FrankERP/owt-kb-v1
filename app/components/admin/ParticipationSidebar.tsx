// app/components/admin/ParticipationSidebar.tsx
"use client";
import { useMemo, useState } from "react";
import { computeParticipation, type ParticipantRole, type MemberParticipation } from "@/app/utils/computeParticipation";
import { themeColour } from "@/app/utils/themeColour";

// Six CATEGORICAL hues, keyed by seat. These are consumed as inline `background:`
// values, so they must be COMPLETE colours — a bare triplet would need wrapping and
// `rgb(rgb(...))` is invalid and silently dropped.
const COLORS = {
  lead:      themeColour("--chart-lead-rgb"),
  bgv:       themeColour("--chart-bgv-rgb"),
  coro:      themeColour("--chart-coro-rgb"),
  especial:  themeColour("--chart-especial-rgb"),
  instr:     themeColour("--chart-instr-rgb"),
  foh:       themeColour("--chart-foh-rgb"),
};
type View = "voces" | "instrumentos";

export function ParticipationSidebar({ roles, monthLabel }: { roles: ParticipantRole[]; monthLabel: string }) {
  const [view, setView] = useState<View>("voces");
  const all = useMemo(() => computeParticipation(roles), [roles]);

  const rows = useMemo(() => {
    if (view === "voces") {
      return all.filter(r => r.total > 0).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    }
    return all
      .filter(r => r.instrWeeks > 0 || r.fohWeeks > 0)
      .sort((a, b) => (b.instrWeeks + b.fohWeeks) - (a.instrWeeks + a.fohWeeks) || a.name.localeCompare(b.name));
  }, [all, view]);

  const max = view === "voces"
    ? Math.max(1, ...rows.map(r => r.total))
    : Math.max(1, ...rows.map(r => r.instrWeeks + r.fohWeeks));

  const legend: readonly (readonly [string, string])[] = view === "voces"
    ? [["Líder", COLORS.lead], ["BGV", COLORS.bgv], ["Coro", COLORS.coro], ["Especial", COLORS.especial]]
    : [["Instr", COLORS.instr], ["FOH", COLORS.foh]];

  return (
    <aside className="rounded-xl border border-accent/20 bg-surface-ink-l40-d100-base p-3 lg:sticky lg:top-4 self-start">
      {/*
        The header is a COLUMN, and the select is `w-full`. Both are load-bearing
        for the gutter placement, not styling.

        Side by side (the original `flex justify-between`) the header demanded
        the title's ~131px PLUS the select's intrinsic width — a `<select>` is as
        wide as its widest option, and "Instrumentos" makes that 112px. Measured
        in a real browser that came to 262px of content inside a 216px column:
        the select's right edge landed 47px past it and printed itself over the
        planner grid — the exact overlap the column's width floor exists to
        prevent.

        Stacked, each row asks for the WIDER of the two rather than their sum
        (~131px), and `w-full` caps the select at the content box instead of
        letting its longest option set the width. See `CHART_COLUMN_WIDTH` in
        `PlannerGrid.tsx`, whose floor is derived from this file's own rows —
        this header is the half of that derivation no arithmetic can see, and
        `participationAlongside.test.tsx` pins it structurally for that reason.

        `min-h-[44px]`: below the gutter threshold this chart stacks inline on an
        iPad and in the Capacitor wrap, where this is a touch target.
      */}
      <div data-rail-header className="mb-1">
        <p className="font-label text-xs uppercase tracking-widest text-accent">Participaciones</p>
        <p className="text-xs text-gray-500">{monthLabel}</p>
        <select value={view} onChange={e => setView(e.target.value as View)}
          aria-label="Ver participaciones por"
          className="mt-2 w-full min-h-[44px] text-xs bg-transparent border border-accent/20 rounded-lg px-2 py-1">
          <option value="voces">Voces</option>
          <option value="instrumentos">Instrumentos</option>
        </select>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 py-2 border-b border-accent/15 mb-1">
        {legend.map(([l, c]) => (
          <span key={l} className="text-xs text-gray-500 inline-flex items-center gap-1">
            <span style={{ width: 9, height: 9, borderRadius: 2, background: c, display: "inline-block" }} />{l}
          </span>
        ))}
      </div>

      {rows.length === 0 && (
        <p className="text-xs text-gray-500 py-3 text-center">
          {view === "voces" ? "Sin participaciones en voces." : "Sin participaciones en instrumentos / FOH."}
        </p>
      )}

      <div className="space-y-0 max-h-[60vh] overflow-y-auto pr-0.5">
        {rows.map(r => <Row key={r.id} r={r} max={max} view={view} />)}
      </div>
    </aside>
  );
}

function Row({ r, max, view }: { r: MemberParticipation; max: number; view: View }) {
  const value = view === "voces" ? r.total : r.instrWeeks + r.fohWeeks;
  const barW = Math.round((value / max) * 150);
  const u = value > 0 ? barW / value : 0;
  const seg = (n: number, c: string) => n > 0
    ? <span style={{ display: "inline-block", height: 8, width: Math.round(n * u), background: c }} /> : null;

  return (
    <div className="flex items-center gap-2.5 py-1.5 border-b border-accent/10">
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-ink-muted truncate">{r.name}</div>
        <div className="text-xs text-gray-500">
          {view === "voces"
            ? <>Líder {r.sunLead}·{r.satLead}  ·  BGV {r.sunBGV}·{r.satBGV}  ·  Coro {r.coro}  ·  Especial {r.especial}</>
            : <>Instrumentos {r.instrWeeks} sem  ·  FOH {r.fohWeeks} sem</>}
        </div>
        <div className="mt-1 rounded overflow-hidden flex" style={{ width: 150, background: themeColour("--accent-rgb", 0.08) }}>
          {view === "voces"
            ? <>{seg(r.sunLead + r.satLead, COLORS.lead)}{seg(r.sunBGV + r.satBGV, COLORS.bgv)}{seg(r.coro, COLORS.coro)}{seg(r.especial, COLORS.especial)}</>
            : <>{seg(r.instrWeeks, COLORS.instr)}{seg(r.fohWeeks, COLORS.foh)}</>}
        </div>
      </div>
      <div className="text-xl font-medium text-ink-muted min-w-[24px] text-right">{value}</div>
    </div>
  );
}
