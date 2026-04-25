"use client";

import { useState } from "react";
import type { SolveRequest, SolveResponse } from "@/app/api/admin/solve/route";

// ─── Types ────────────────────────────────────────────────────────────────────

type ServiceType = "sunday_role" | "saturday_role";

interface MemberOption { _id: string; member_name: string; alias?: string; memberType?: string[]; }

const dn = (m: MemberOption) => m.alias?.trim() || m.member_name;
interface ExistingRole  { _id: string; _type: string; date: string; }
interface InstrSlot     { id: string; instrument: string; personId: string; }
interface FohSlot       { id: string; role: string; personId: string; }

interface DraftCard {
  localId: string;
  _type: ServiceType;
  date: string;
  exists: boolean;
  skipped: boolean;
  leads: string[];
  bgvs: string[];
  chorus: string[];
  instruments: InstrSlot[];
  foh: FohSlot[];
}

interface Props {
  members: MemberOption[];
  existingRoles: ExistingRole[];
  onClose: () => void;
  onCreated: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MONTHS = ["Enero","Febrero","Marzo","Abril","Mayo","Junio",
                "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const uid = () => Math.random().toString(36).slice(2, 9);

function getDates(year: number, month: number, day: 0 | 6): string[] {
  const dates: string[] = [];
  const d = new Date(year, month - 1, 1);
  while (d.getMonth() === month - 1) {
    if (d.getDay() === day) {
      dates.push(`${year}-${String(month).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`);
    }
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

function fmtDate(iso: string) {
  return new Date(iso + "T12:00:00").toLocaleDateString("es-MX", {
    weekday: "short", day: "numeric", month: "short",
  });
}

function subtractDay(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function nameToId(name: string, members: MemberOption[]): string | null {
  const lo = name.toLowerCase().trim();
  return members.find(m => m.member_name.toLowerCase().trim() === lo)?._id ?? null;
}

// ─── Shared form sub-components ───────────────────────────────────────────────

const sel2Cls = "w-full px-2 py-1.5 rounded border border-[#00bfff]/15 bg-[#0a1929] font-body text-xs focus:outline-none focus:border-[#00bfff]";
const in2Cls  = "w-full px-2 py-1.5 rounded border border-[#00bfff]/15 bg-transparent font-body text-xs focus:outline-none focus:border-[#00bfff]";

function MemberCheckboxes({ label, members, selected, onChange }: {
  label: string; members: MemberOption[]; selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
  return (
    <div>
      <p className="font-label text-[10px] uppercase tracking-widest text-gray-500 mb-1">{label}</p>
      <div className="max-h-24 overflow-y-auto rounded border border-[#00bfff]/10 divide-y divide-[#00bfff]/5">
        {members.map(m => (
          <label key={m._id} className={`flex items-center gap-2 px-2 py-1 cursor-pointer text-xs transition-colors ${selected.includes(m._id) ? "bg-[#00bfff]/10" : "hover:bg-[#00bfff]/5"}`}>
            <input type="checkbox" checked={selected.includes(m._id)} onChange={() => toggle(m._id)} className="accent-[#00bfff]" />
            <span className="font-body">{dn(m)}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function SlotEditor2({ label, nameKey, slots, members, onChange }: {
  label: string; nameKey: "instrument" | "role";
  slots: (InstrSlot | FohSlot)[]; members: MemberOption[];
  onChange: (s: any[]) => void;
}) {
  return (
    <div>
      <p className="font-label text-[10px] uppercase tracking-widest text-gray-500 mb-1">{label}</p>
      <div className="space-y-1">
        {slots.map(s => (
          <div key={s.id} className="flex gap-1.5">
            <input className={`${in2Cls} flex-1`} placeholder={nameKey === "instrument" ? "Instrumento" : "Rol"} value={(s as any)[nameKey] ?? ""} onChange={e => onChange(slots.map(x => x.id === s.id ? { ...x, [nameKey]: e.target.value } : x))} />
            <select className={`${sel2Cls} flex-1`} value={s.personId} onChange={e => onChange(slots.map(x => x.id === s.id ? { ...x, personId: e.target.value } : x))}>
              <option value="">— Persona —</option>
              {members.map(m => <option key={m._id} value={m._id}>{dn(m)}</option>)}
            </select>
            <button type="button" onClick={() => onChange(slots.filter(x => x.id !== s.id))} className="text-gray-500 hover:text-red-400 transition-colors px-1 text-sm">×</button>
          </div>
        ))}
        <button type="button" onClick={() => onChange([...slots, { id: uid(), [nameKey]: "", personId: "" }])} className="font-label text-[10px] uppercase tracking-widest text-[#00bfff]/50 hover:text-[#00bfff] transition-colors">
          + {nameKey === "instrument" ? "Instrumento" : "Rol"}
        </button>
      </div>
    </div>
  );
}

// ─── Draft card editor ────────────────────────────────────────────────────────

function DraftCardEditor({ draft, members, onChange, onToggleSkip, swapSelected, onSwapSelect }: {
  draft: DraftCard; members: MemberOption[];
  onChange: (d: DraftCard) => void; onToggleSkip: () => void;
  swapSelected: boolean; onSwapSelect: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isSun = draft._type === "sunday_role";
  const badgeCls = isSun
    ? "bg-orange-500/15 text-orange-400 border border-orange-500/30"
    : "bg-yellow-500/15 text-yellow-400 border border-yellow-400/30";

  const total = draft.leads.length + draft.bgvs.length + draft.chorus.length +
    draft.instruments.filter(s => s.personId).length + draft.foh.filter(s => s.personId).length;

  return (
    <div className={`rounded-xl border transition-all ${
      draft.skipped ? "border-gray-700/30 opacity-40" :
      swapSelected ? "border-[#00bfff] ring-1 ring-[#00bfff]/30 bg-[#00bfff]/5 dark:bg-[#00bfff]/5" :
      "border-[#003572]/15 dark:border-[#00bfff]/10 bg-[#003572]/5 dark:bg-[#00bfff]/5"
    }`}>
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="shrink-0 text-center min-w-[36px]">
          <p className="font-display text-lg leading-none">{new Date(draft.date + "T12:00:00").getDate()}</p>
          <p className="font-label text-[9px] uppercase tracking-widest text-gray-500">
            {new Date(draft.date + "T12:00:00").toLocaleDateString("es-MX", { month: "short" })}
          </p>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`font-label text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full ${badgeCls}`}>
              {isSun ? "Domingo" : "Sábado"}
            </span>
            {draft.exists && (
              <span className="font-label text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-500 border border-yellow-500/30">
                Ya existe
              </span>
            )}
          </div>
          <p className="font-label text-[10px] uppercase tracking-widest text-gray-600 mt-0.5">
            {total > 0 ? `${total} asignado${total !== 1 ? "s" : ""}` : "Sin asignar"}
          </p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {!draft.skipped && (
            <button
              type="button"
              onClick={onSwapSelect}
              title="Intercambiar equipo"
              className={`px-2 py-1 rounded font-label text-xs transition-colors ${
                swapSelected ? "bg-[#00bfff]/20 text-[#00bfff]" : "text-gray-500 hover:text-[#00bfff] hover:bg-[#00bfff]/10"
              }`}
            >
              ⇄
            </button>
          )}
          {!draft.exists && (
            <button
              type="button"
              onClick={onToggleSkip}
              className={`px-2 py-1 rounded font-label text-[10px] uppercase tracking-widest transition-colors ${
                draft.skipped ? "text-[#00bfff] hover:bg-[#00bfff]/10" : "text-gray-500 hover:text-red-400 hover:bg-red-500/10"
              }`}
            >
              {draft.skipped ? "+ Incluir" : "Omitir"}
            </button>
          )}
          {!draft.skipped && (
            <button type="button" onClick={() => setExpanded(v => !v)} className="px-1.5 py-1 rounded text-gray-500 hover:text-[#00bfff] hover:bg-[#00bfff]/10 transition-colors text-xs">
              {expanded ? "▲" : "▼"}
            </button>
          )}
        </div>
      </div>

      {expanded && !draft.skipped && (
        <div className="px-4 pb-4 pt-2 space-y-3 border-t border-[#00bfff]/10">
          <MemberCheckboxes label="Líderes"  members={members} selected={draft.leads}  onChange={leads  => onChange({ ...draft, leads  })} />
          <MemberCheckboxes label="BGVs"     members={members} selected={draft.bgvs}   onChange={bgvs   => onChange({ ...draft, bgvs   })} />
          <MemberCheckboxes label="Coro"     members={members} selected={draft.chorus} onChange={chorus => onChange({ ...draft, chorus })} />
          <SlotEditor2 label="Instrumentos" nameKey="instrument" slots={draft.instruments} members={members} onChange={s => onChange({ ...draft, instruments: s })} />
          <SlotEditor2 label="FOH / Técnicos" nameKey="role"   slots={draft.foh}        members={members} onChange={s => onChange({ ...draft, foh: s })} />
        </div>
      )}
    </div>
  );
}

// ─── Solver config section ────────────────────────────────────────────────────

interface SolverConfig {
  sundayLeads: string[];
  saturdayLeads: string[];
  support: string[];
  dslRules: string;
}

function SolverConfigPanel({ members, config, onChange }: {
  members: MemberOption[];
  config: SolverConfig;
  onChange: (c: SolverConfig) => void;
}) {
  const [searches, setSearches] = useState<Record<string, string>>({});
  const inCls = "w-full px-3 py-2 rounded-lg border border-[#00bfff]/20 bg-transparent font-body text-sm focus:outline-none focus:border-[#00bfff] transition-colors";

  // Only Voz members are valid for vocal pools
  const vozMembers = members.filter(m => m.memberType?.includes("voz"));

  const toggleMember = (field: "sundayLeads" | "saturdayLeads" | "support", id: string) => {
    const cur = config[field];
    onChange({ ...config, [field]: cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id] });
  };

  const selectAll = (field: "sundayLeads" | "saturdayLeads" | "support", pool: MemberOption[]) => {
    const allIds = pool.map(m => m._id);
    const allSelected = allIds.every(id => config[field].includes(id));
    onChange({ ...config, [field]: allSelected ? config[field].filter(id => !allIds.includes(id)) : [...new Set([...config[field], ...allIds])] });
  };

  const MemberPool = ({ field, label }: { field: "sundayLeads" | "saturdayLeads" | "support"; label: string }) => {
    const q = searches[field] ?? "";
    const pool = vozMembers;
    const visible = q.trim() ? pool.filter(m => dn(m).toLowerCase().includes(q.toLowerCase())) : pool;
    const allSelected = pool.length > 0 && pool.every(m => config[field].includes(m._id));
    return (
      <div>
        <div className="flex items-center justify-between mb-1">
          <p className="font-label text-[10px] uppercase tracking-widest text-gray-500">{label}</p>
          <button
            type="button"
            onClick={() => selectAll(field, pool)}
            className="font-label text-[9px] uppercase tracking-widest text-[#00bfff]/60 hover:text-[#00bfff] transition-colors"
          >
            {allSelected ? "Ninguno" : "Todos"}
          </button>
        </div>
        <input
          className="w-full px-2 py-1 mb-1 rounded border border-[#00bfff]/15 bg-transparent font-body text-xs focus:outline-none focus:border-[#00bfff] placeholder-gray-600"
          placeholder="Buscar..."
          value={q}
          onChange={e => setSearches(s => ({ ...s, [field]: e.target.value }))}
        />
        <div className="max-h-32 overflow-y-auto rounded border border-[#00bfff]/10 divide-y divide-[#00bfff]/5">
          {visible.length === 0 && <p className="px-2 py-1 font-body text-xs text-gray-600 italic">Sin resultados</p>}
          {visible.map(m => (
            <label key={m._id} className={`flex items-center gap-2 px-2 py-1 cursor-pointer text-xs transition-colors ${config[field].includes(m._id) ? "bg-[#00bfff]/10" : "hover:bg-[#00bfff]/5"}`}>
              <input type="checkbox" checked={config[field].includes(m._id)} onChange={() => toggleMember(field, m._id)} className="accent-[#00bfff]" />
              <span className="font-body">{dn(m)}</span>
            </label>
          ))}
        </div>
        {config[field].length > 0 && (
          <p className="font-label text-[9px] uppercase tracking-widest text-[#00bfff] mt-0.5">{config[field].length} seleccionado{config[field].length !== 1 ? "s" : ""}</p>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3 p-3 rounded-xl border border-[#00bfff]/20 bg-[#00bfff]/5">
      <p className="font-label text-[10px] uppercase tracking-widest text-[#00bfff]">Configuración del Solver</p>
      <div className="grid grid-cols-3 gap-3">
        <MemberPool field="sundayLeads" label="Líderes Domingo" />
        <MemberPool field="saturdayLeads" label="Líderes Sábado" />
        <MemberPool field="support" label="Soporte" />
      </div>
      <div>
        <p className="font-label text-[10px] uppercase tracking-widest text-gray-500 mb-1">Reglas DSL</p>
        <textarea
          className={`${inCls} h-28 resize-none font-mono text-xs`}
          placeholder={`Ejemplos:\nFrank !in Sat.* & fairness_exempt\nany_of(Hugo,Jakey) on Sun.BGV each_week\nGaby Sun.BGV <= 2`}
          value={config.dslRules}
          onChange={e => onChange({ ...config, dslRules: e.target.value })}
        />
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MonthGenerator({ members, existingRoles, onClose, onCreated }: Props) {
  const now = new Date();
  const [step, setStep]      = useState<"config" | "preview">("config");
  const [year, setYear]      = useState(now.getFullYear());
  const [month, setMonth]    = useState(now.getMonth() + 1);
  const [sundays, setSundays]    = useState(true);
  const [saturdays, setSaturdays] = useState(true);
  const [drafts, setDrafts]  = useState<DraftCard[]>([]);
  const [swapSel, setSwapSel] = useState<string | null>(null);
  const [pushing, setPushing] = useState(false);
  const [swapToast, setSwapToast] = useState<string | null>(null);
  const [useSolver, setUseSolver] = useState(false);
  const [solving, setSolving] = useState(false);
  const [solverError, setSolverError] = useState<string | null>(null);
  const [solverConfig, setSolverConfig] = useState<SolverConfig>({
    sundayLeads: [],
    saturdayLeads: [],
    support: [],
    dslRules: "",
  });

  const inCls  = "w-full px-3 py-2 rounded-lg border border-[#00bfff]/20 bg-transparent font-body text-sm focus:outline-none focus:border-[#00bfff] transition-colors";
  const selCls = "w-full px-3 py-2 rounded-lg border border-[#00bfff]/20 bg-[#0a1929] font-body text-sm focus:outline-none focus:border-[#00bfff] transition-colors";

  function buildEmptyDrafts(): DraftCard[] {
    const existing = new Set(existingRoles.map(r => `${r._type}__${r.date}`));
    const all: DraftCard[] = [];
    if (sundays) {
      getDates(year, month, 0).forEach(date => all.push({
        localId: uid(), _type: "sunday_role", date,
        exists: existing.has(`sunday_role__${date}`),
        skipped: existing.has(`sunday_role__${date}`),
        leads: [], bgvs: [], chorus: [], instruments: [], foh: [],
      }));
    }
    if (saturdays) {
      getDates(year, month, 6).forEach(date => all.push({
        localId: uid(), _type: "saturday_role", date,
        exists: existing.has(`saturday_role__${date}`),
        skipped: existing.has(`saturday_role__${date}`),
        leads: [], bgvs: [], chorus: [], instruments: [], foh: [],
      }));
    }
    return all.sort((a, b) => a.date.localeCompare(b.date));
  }

  async function handlePreview() {
    setSolverError(null);

    if (!useSolver) {
      setDrafts(buildEmptyDrafts());
      setStep("preview");
      return;
    }

    // Solver mode: build request and call API
    const sundayDates = getDates(year, month, 0);
    const saturdayDates = getDates(year, month, 6);
    const weeks = sundayDates.length;

    // Which "week numbers" (1-based) have Saturday service
    // We assume: each Sunday date may have a Saturday (day before it) — include it if user wants saturdays
    // Build a list of 1-based week indexes that have Saturday service
    const weekendsWithSaturday: number[] = [];
    if (saturdays) {
      sundayDates.forEach((sunDate, i) => {
        const prevDay = subtractDay(sunDate);
        if (saturdayDates.includes(prevDay)) {
          weekendsWithSaturday.push(i + 1);
        }
      });
      // If no Saturday is directly before a Sunday, include all available Saturdays
      if (weekendsWithSaturday.length === 0 && saturdayDates.length > 0) {
        saturdayDates.forEach((_, i) => weekendsWithSaturday.push(i + 1));
      }
    }

    // Map member IDs → names for solver, names → IDs for result mapping
    const idToName = (id: string) => members.find(m => m._id === id)?.member_name ?? id;

    const payload: SolveRequest = {
      weeks,
      weekends_with_saturday: weekendsWithSaturday,
      sunday_leads: solverConfig.sundayLeads.map(idToName),
      saturday_leads: solverConfig.saturdayLeads.map(idToName),
      support: solverConfig.support.map(idToName),
      dsl_rules: solverConfig.dslRules
        .split("\n")
        .map(l => l.trim())
        .filter(Boolean),
      history: [],
    };

    if (!payload.sunday_leads.length) {
      setSolverError("Debes seleccionar al menos un líder de domingo.");
      return;
    }

    setSolving(true);
    let result: SolveResponse;
    try {
      const res = await fetch("/api/admin/solve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      result = await res.json();
    } catch (e) {
      setSolverError("Error de red al llamar al solver.");
      setSolving(false);
      return;
    }
    setSolving(false);

    if (!result.ok || !result.schedule) {
      setSolverError(result.error ?? "El solver no encontró solución.");
      return;
    }

    // Map solver output → draft cards
    const existing = new Set(existingRoles.map(r => `${r._type}__${r.date}`));
    const allDrafts: DraftCard[] = [];

    for (let w = 1; w <= weeks; w++) {
      const weekData = result.schedule[String(w)];
      if (!weekData) continue;
      const sunDate = sundayDates[w - 1];

      if (sundays && sunDate) {
        const sun = weekData.Sunday ?? { Lead: [], BGV: [], Choir: [] };
        allDrafts.push({
          localId: uid(),
          _type: "sunday_role",
          date: sunDate,
          exists: existing.has(`sunday_role__${sunDate}`),
          skipped: existing.has(`sunday_role__${sunDate}`),
          leads: sun.Lead.map(n => nameToId(n, members)).filter(Boolean) as string[],
          bgvs: sun.BGV.map(n => nameToId(n, members)).filter(Boolean) as string[],
          chorus: sun.Choir.map(n => nameToId(n, members)).filter(Boolean) as string[],
          instruments: [],
          foh: [],
        });
      }

      if (saturdays && weekData.Saturday) {
        // Saturday date = day before this Sunday
        const satDate = subtractDay(sunDate);
        if (saturdayDates.includes(satDate)) {
          const sat = weekData.Saturday;
          allDrafts.push({
            localId: uid(),
            _type: "saturday_role",
            date: satDate,
            exists: existing.has(`saturday_role__${satDate}`),
            skipped: existing.has(`saturday_role__${satDate}`),
            leads: sat.Lead.map(n => nameToId(n, members)).filter(Boolean) as string[],
            bgvs: sat.BGV.map(n => nameToId(n, members)).filter(Boolean) as string[],
            chorus: [],
            instruments: [],
            foh: [],
          });
        }
      }
    }

    setDrafts(allDrafts.sort((a, b) => a.date.localeCompare(b.date)));
    setStep("preview");
  }

  function handleCardSwap(localId: string) {
    if (!swapSel) { setSwapSel(localId); return; }
    if (swapSel === localId) { setSwapSel(null); return; }
    const a = drafts.find(d => d.localId === swapSel)!;
    const b = drafts.find(d => d.localId === localId)!;
    setDrafts(drafts.map(d => {
      if (d.localId === swapSel) return { ...d, leads: b.leads, bgvs: b.bgvs, chorus: b.chorus, instruments: b.instruments, foh: b.foh };
      if (d.localId === localId) return { ...d, leads: a.leads, bgvs: a.bgvs, chorus: a.chorus, instruments: a.instruments, foh: a.foh };
      return d;
    }));
    setSwapSel(null);
    setSwapToast(`⇄ ${fmtDate(a.date)} ↔ ${fmtDate(b.date)}`);
    setTimeout(() => setSwapToast(null), 2500);
  }

  async function handleConfirm() {
    const toCreate = drafts.filter(d => !d.skipped && !d.exists);
    if (!toCreate.length) return;
    setPushing(true);
    for (const d of toCreate) {
      await fetch("/api/admin/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          _type: d._type, date: d.date,
          leads: d.leads, bgvs: d.bgvs, chorus: d.chorus,
          instruments: d.instruments.filter(s => s.instrument && s.personId),
          foh: d.foh.filter(s => s.role && s.personId),
        }),
      });
    }
    setPushing(false);
    onCreated();
    onClose();
  }

  const toCreate = drafts.filter(d => !d.skipped && !d.exists);
  const skipped  = drafts.filter(d => d.skipped).length;

  // ── Step 1: Configure ────────────────────────────────────────────────────────
  if (step === "config") return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="font-label text-xs uppercase tracking-widest text-gray-500">Mes</label>
          <select className={selCls} value={month} onChange={e => setMonth(Number(e.target.value))}>
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="font-label text-xs uppercase tracking-widest text-gray-500">Año</label>
          <input className={inCls} type="number" value={year} min={2024} max={2035} onChange={e => setYear(Number(e.target.value))} />
        </div>
      </div>

      <div className="space-y-2">
        <label className="font-label text-xs uppercase tracking-widest text-gray-500">Generar</label>
        {([["Domingos", sundays, setSundays], ["Sábados", saturdays, setSaturdays]] as const).map(([label, val, set]) => (
          <label key={label} className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={val} onChange={e => (set as any)(e.target.checked)} className="accent-[#00bfff] w-4 h-4" />
            <span className="font-body text-sm">{label}</span>
          </label>
        ))}
      </div>

      {/* Solver toggle */}
      <div className="space-y-3">
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={useSolver} onChange={e => setUseSolver(e.target.checked)} className="accent-[#00bfff] w-4 h-4" />
          <span className="font-body text-sm">🤖 Auto-asignar con Solver</span>
        </label>
        {useSolver && (
          <SolverConfigPanel
            members={members}
            config={solverConfig}
            onChange={setSolverConfig}
          />
        )}
      </div>

      {solverError && (
        <p className="font-body text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
          {solverError}
        </p>
      )}

      <div className="flex gap-3">
        <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg border border-[#003572]/30 dark:border-[#00bfff]/20 font-label text-xs uppercase tracking-widest hover:border-[#00bfff] transition-colors">
          Cancelar
        </button>
        <button type="button" onClick={handlePreview} disabled={(!sundays && !saturdays) || solving} className="flex-1 py-2 rounded-lg bg-[#003572] dark:bg-[#00bfff]/20 hover:bg-[#003572]/80 dark:hover:bg-[#00bfff]/30 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50">
          {solving ? "Calculando..." : "Previsualizar →"}
        </button>
      </div>
    </div>
  );

  // ── Step 2: Preview ──────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-label text-xs uppercase tracking-widest text-gray-500">{MONTHS[month - 1]} {year}</p>
          <p className="font-body text-sm">
            <span className="text-[#00bfff] font-semibold">{toCreate.length}</span> por crear
            {skipped > 0 && <span className="text-gray-500"> · {skipped} omitido{skipped !== 1 ? "s" : ""}</span>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {swapSel && (
            <span className="font-label text-[10px] uppercase tracking-widest text-[#00bfff] animate-pulse">
              Selecciona otro ⇄
            </span>
          )}
          <button type="button" onClick={() => { setStep("config"); setSwapSel(null); }} className="font-label text-xs uppercase tracking-widest text-gray-500 hover:text-[#00bfff] transition-colors">
            ← Volver
          </button>
        </div>
      </div>

      {swapToast && (
        <p className="font-label text-[10px] uppercase tracking-widest text-[#00bfff] text-center bg-[#00bfff]/10 rounded-lg py-1.5">
          {swapToast}
        </p>
      )}

      <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-0.5">
        {drafts.map(d => (
          <DraftCardEditor
            key={d.localId}
            draft={d}
            members={members}
            onChange={updated => setDrafts(drafts.map(x => x.localId === updated.localId ? updated : x))}
            onToggleSkip={() => setDrafts(drafts.map(x => x.localId === d.localId ? { ...x, skipped: !x.skipped } : x))}
            swapSelected={swapSel === d.localId}
            onSwapSelect={() => handleCardSwap(d.localId)}
          />
        ))}
      </div>

      <div className="flex gap-3">
        <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg border border-[#003572]/30 dark:border-[#00bfff]/20 font-label text-xs uppercase tracking-widest hover:border-[#00bfff] transition-colors">
          Cancelar
        </button>
        <button type="button" onClick={handleConfirm} disabled={pushing || toCreate.length === 0} className="flex-1 py-2 rounded-lg bg-[#003572] dark:bg-[#00bfff]/20 hover:bg-[#003572]/80 dark:hover:bg-[#00bfff]/30 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50">
          {pushing ? "Creando..." : `Crear ${toCreate.length} servicio${toCreate.length !== 1 ? "s" : ""}`}
        </button>
      </div>
    </div>
  );
}
