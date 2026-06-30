// app/components/admin/ParticipationSidebar.tsx
"use client";
import { useMemo, useState } from "react";
import { computeParticipation, type ParticipantRole, type MemberParticipation } from "@/app/utils/computeParticipation";

const COLORS = { lead: "#378ADD", bgv: "#1D9E75", coro: "#7F77DD", instr: "#BA7517", foh: "#888780" };
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
    ? [["Líder", COLORS.lead], ["BGV", COLORS.bgv], ["Coro", COLORS.coro]]
    : [["Instr", COLORS.instr], ["FOH", COLORS.foh]];

  return (
    <aside className="rounded-xl border border-[#00bfff]/20 bg-[#C8D8EB]/40 dark:bg-[#010b17] p-3 lg:sticky lg:top-4 self-start">
      <div className="flex items-center justify-between mb-1 gap-2">
        <div>
          <p className="font-label text-xs uppercase tracking-widest text-[#003572] dark:text-[#00bfff]">Participaciones</p>
          <p className="text-[11px] text-gray-500">{monthLabel}</p>
        </div>
        <select value={view} onChange={e => setView(e.target.value as View)}
          className="text-xs bg-transparent border border-[#00bfff]/20 rounded-lg px-2 py-1">
          <option value="voces">Voces</option>
          <option value="instrumentos">Instrumentos</option>
        </select>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 py-2 border-b border-[#00bfff]/15 mb-1">
        {legend.map(([l, c]) => (
          <span key={l} className="text-[11px] text-gray-500 inline-flex items-center gap-1">
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
    <div className="flex items-center gap-2.5 py-1.5 border-b border-[#00bfff]/10">
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-[#003572] dark:text-[#C8D8EB] truncate">{r.name}</div>
        <div className="text-[11px] text-gray-500">
          {view === "voces"
            ? <>Líder {r.sunLead}·{r.satLead}  ·  BGV {r.sunBGV}·{r.satBGV}  ·  Coro {r.coro}</>
            : <>Instrumentos {r.instrWeeks} sem  ·  FOH {r.fohWeeks} sem</>}
        </div>
        <div className="mt-1 rounded overflow-hidden flex" style={{ width: 150, background: "rgba(0,191,255,0.08)" }}>
          {view === "voces"
            ? <>{seg(r.sunLead + r.satLead, COLORS.lead)}{seg(r.sunBGV + r.satBGV, COLORS.bgv)}{seg(r.coro, COLORS.coro)}</>
            : <>{seg(r.instrWeeks, COLORS.instr)}{seg(r.fohWeeks, COLORS.foh)}</>}
        </div>
      </div>
      <div className="text-xl font-medium text-[#003572] dark:text-[#C8D8EB] min-w-[24px] text-right">{value}</div>
    </div>
  );
}
