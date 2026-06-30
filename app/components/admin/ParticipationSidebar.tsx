// app/components/admin/ParticipationSidebar.tsx
"use client";
import { useMemo, useState } from "react";
import { computeParticipation, type ParticipantRole, type MemberParticipation } from "@/app/utils/computeParticipation";

const COLORS = { lead: "#378ADD", bgv: "#1D9E75", coro: "#7F77DD", instr: "#BA7517", foh: "#888780" };
type SortKey = "total" | "sunLead" | "satLead" | "sunBGV" | "satBGV" | "coro";

export function ParticipationSidebar({ roles, monthLabel }: { roles: ParticipantRole[]; monthLabel: string }) {
  const [sort, setSort] = useState<SortKey>("total");
  const rows = useMemo(() => {
    const data = computeParticipation(roles);
    return [...data].sort((a, b) => (b[sort] as number) - (a[sort] as number) || a.name.localeCompare(b.name));
  }, [roles, sort]);
  const maxTotal = Math.max(1, ...rows.map(r => r.total));

  return (
    <aside className="rounded-xl border border-[#00bfff]/20 bg-[#C8D8EB]/40 dark:bg-[#010b17] p-3 lg:sticky lg:top-4 self-start">
      <div className="flex items-center justify-between mb-1">
        <div>
          <p className="font-label text-xs uppercase tracking-widest text-[#003572] dark:text-[#00bfff]">Participaciones</p>
          <p className="text-[11px] text-gray-500">{monthLabel}</p>
        </div>
        <select value={sort} onChange={e => setSort(e.target.value as SortKey)}
          className="text-xs bg-transparent border border-[#00bfff]/20 rounded-lg px-2 py-1">
          <option value="total">Total</option>
          <option value="sunLead">Líder dom</option>
          <option value="satLead">Líder sáb</option>
          <option value="sunBGV">BGV dom</option>
          <option value="satBGV">BGV sáb</option>
          <option value="coro">Coro</option>
        </select>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 py-2 border-b border-[#00bfff]/15 mb-1">
        {([["Líder", COLORS.lead], ["BGV", COLORS.bgv], ["Coro", COLORS.coro], ["Instr", COLORS.instr], ["FOH", COLORS.foh]] as const).map(([l, c]) => (
          <span key={l} className="text-[11px] text-gray-500 inline-flex items-center gap-1">
            <i style={{ width: 9, height: 9, borderRadius: 2, background: c, display: "inline-block" }} />{l}
          </span>
        ))}
      </div>

      {rows.length === 0 && <p className="text-xs text-gray-500 py-3 text-center">Sin participaciones en este filtro.</p>}

      <div className="space-y-0 max-h-[60vh] overflow-y-auto pr-0.5">
        {rows.map(r => <Row key={r.id} r={r} maxTotal={maxTotal} />)}
      </div>
    </aside>
  );
}

function Row({ r, maxTotal }: { r: MemberParticipation; maxTotal: number }) {
  const barW = Math.round((r.total / maxTotal) * 150);
  const u = r.total > 0 ? barW / r.total : 0;
  const seg = (n: number, c: string) => n > 0
    ? <span style={{ display: "inline-block", height: 8, width: Math.round(n * u), background: c }} /> : null;
  return (
    <div className="flex items-center gap-2.5 py-1.5 border-b border-[#00bfff]/10">
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-[#003572] dark:text-[#C8D8EB] truncate">{r.name}</div>
        <div className="text-[11px] text-gray-500">
          L {r.sunLead}·{r.satLead}  B {r.sunBGV}·{r.satBGV}  C {r.coro}
          {(r.instrWeeks > 0 || r.fohWeeks > 0) && <>  ·  Instr {r.instrWeeks} · FOH {r.fohWeeks}</>}
        </div>
        <div className="mt-1 rounded overflow-hidden flex" style={{ width: 150, background: "rgba(0,191,255,0.08)" }}>
          {seg(r.sunLead + r.satLead, COLORS.lead)}{seg(r.sunBGV + r.satBGV, COLORS.bgv)}{seg(r.coro, COLORS.coro)}
        </div>
      </div>
      <div className="text-xl font-medium text-[#003572] dark:text-[#C8D8EB] min-w-[24px] text-right">{r.total}</div>
    </div>
  );
}
