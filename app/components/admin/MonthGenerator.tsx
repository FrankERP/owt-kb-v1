"use client";

import { useState, useEffect } from "react";
import type { SolveRequest, SolveResponse } from "@/app/api/admin/solve/route";
import { summarizeUnfilledSeats } from "@/app/utils/unfilledSeats";
import { DayCard } from "@/app/components/DayCard";
import { draftToDayCardProps } from "@/app/utils/draftToDayCardProps";

// ─── Types ────────────────────────────────────────────────────────────────────

type ServiceType = "sunday_role" | "saturday_role";

interface MemberOption { _id: string; member_name: string; alias?: string; memberType?: string[]; unavailableDates?: string[]; }

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

// ─── Rule types ───────────────────────────────────────────────────────────────

interface PersonRestriction {
  id: string;
  person: string;
  excludedPatterns: string[];
  fairness: "none" | "exempt" | "slack";
  fairnessSlack: number;
  weekExclusions: Array<{ id: string; week: number; pattern: string }>;
  caps: Array<{
    id: string; pattern: string; op: "<=" | ">=" | "==";
    value: number;
    relative: boolean;  // true → serialize as {weeks-relOffset}
    relOffset: number;
  }>;
}

interface ConflictRule {
  id: string;
  personA: string;
  personB: string;
  pattern: string;
}

interface PresenceRule {
  id: string;
  persons: string[];
  pattern: string;
}

interface SolverConfig {
  sundayLeads: string[];
  saturdayLeads: string[];
  support: string[];
  restrictions: PersonRestriction[];
  conflicts: ConflictRule[];
  presence: PresenceRule[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MONTHS = ["Enero","Febrero","Marzo","Abril","Mayo","Junio",
                "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

const PATTERNS: Array<{ value: string; label: string }> = [
  { value: "Sun.*",     label: "Domingo (todo)"   },
  { value: "Sat.*",     label: "Sábado (todo)"    },
  { value: "*.*",       label: "Ambos servicios"  },
  { value: "Sun.Lead",  label: "Dom Lead"         },
  { value: "Sat.Lead",  label: "Sáb Lead"         },
  { value: "Sun.BGV",   label: "Dom BGV"          },
  { value: "Sat.BGV",   label: "Sáb BGV"          },
  { value: "Sun.Choir", label: "Dom Coro"         },
  { value: "*.Lead",    label: "Lead (ambos)"     },
  { value: "*.BGV",     label: "BGV (ambos)"      },
  { value: "*.LeadBGV", label: "Lead+BGV (ambos)" },
];

// Ordered list for the exclusion pill grid
const EXCL_PATTERNS = [
  "Sat.*", "Sun.*", "*.*",
  "Sun.Lead", "Sun.BGV", "Sun.Choir",
  "Sat.Lead", "Sat.BGV",
  "*.Lead", "*.BGV", "*.LeadBGV",
];

const PAT_LABEL: Record<string, string> = {
  "Sat.*": "Sáb.*",    "Sun.*": "Dom.*",       "*.*": "*.*",
  "Sun.Lead": "Dom Lead", "Sun.BGV": "Dom BGV", "Sun.Choir": "Dom Coro",
  "Sat.Lead": "Sáb Lead", "Sat.BGV": "Sáb BGV",
  "*.Lead": "*.Lead",  "*.BGV": "*.BGV",       "*.LeadBGV": "*.LeadBGV",
};

const STORAGE_KEY   = "owt_solver_config_v3";
const HISTORY_KEY   = "owt_solver_history_v2";
const MAX_HISTORY   = 6;

interface SolverHistoryEntry {
  key: string;   // "YYYY-M"
  year: number;
  month: number;
  total_counts: Record<string, number>;
  role_counts:  Record<string, Record<string, number>>;
}

// Pre-loaded defaults — mirrors the production rules in CGPT_owt_roles.py.
// Used on first open (no localStorage). Subsequent opens load from localStorage.
const DEFAULT_SOLVER_CONFIG: SolverConfig = {
  sundayLeads: [], saturdayLeads: [], support: [],
  restrictions: [
    {
      id: "d-frank", person: "Frank",
      excludedPatterns: ["Sat.*", "Sun.BGV", "Sun.Choir"],
      fairness: "exempt", fairnessSlack: 1,
      weekExclusions: [], caps: [],
    },
    {
      id: "d-mkz", person: "Mkz",
      excludedPatterns: ["Sat.*", "Sun.BGV", "Sun.Choir"],
      fairness: "exempt", fairnessSlack: 1,
      weekExclusions: [], caps: [],
    },
    {
      id: "d-gaby", person: "Gaby",
      // Merges both Gaby lines: !in Sat.* + !in Sun.Choir + slack 1 + Sun.BGV <= {weeks-2}
      excludedPatterns: ["Sat.*", "Sun.Choir"],
      fairness: "slack", fairnessSlack: 1,
      weekExclusions: [],
      caps: [{ id: "d-gaby-cap", pattern: "Sun.BGV", op: "<=", value: 0, relative: true, relOffset: 2 }],
    },
    {
      id: "d-lucia-week", person: "Lucía",
      excludedPatterns: [], fairness: "none", fairnessSlack: 1,
      weekExclusions: [{ id: "d-lucia-w3", week: 3, pattern: "*.*" }], caps: [],
    },
    {
      id: "d-liu-week", person: "Liu",
      excludedPatterns: [], fairness: "none", fairnessSlack: 1,
      weekExclusions: [{ id: "d-liu-w3", week: 3, pattern: "*.*" }], caps: [],
    },
    {
      id: "d-marianne-week", person: "Marianne",
      excludedPatterns: [], fairness: "none", fairnessSlack: 1,
      weekExclusions: [{ id: "d-marianne-w1", week: 1, pattern: "*.*" }], caps: [],
    },
  ],
  conflicts: [
    { id: "d-lucia-niza",     personA: "Lucía", personB: "Niza",  pattern: "*.LeadBGV" },
    { id: "d-hugo-lucia",     personA: "Hugo",  personB: "Lucía", pattern: "*.Lead"    },
    { id: "d-niza-hugo",      personA: "Niza",  personB: "Hugo",  pattern: "*.Lead"    },
    { id: "d-jakey-hugo-bgv", personA: "Jakey", personB: "Hugo",  pattern: "*.BGV"     },
    { id: "d-jakey-hugo-lead",personA: "Jakey", personB: "Hugo",  pattern: "*.Lead"    },
  ],
  presence: [
    { id: "d-hugo-jakey", persons: ["Hugo", "Jakey"], pattern: "Sun.BGV" },
  ],
};

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

function buildUnavailabilityNotices(
  sundayDates: string[],
  activeSatDates: string[],
  allMembers: MemberOption[]
): { name: string; date: string; service: string }[] {
  const out: { name: string; date: string; service: string }[] = [];
  for (const m of allMembers) {
    if (!m.unavailableDates?.length) continue;
    const unavailable = new Set(m.unavailableDates);
    const name = m.alias?.trim() || m.member_name;
    for (const d of sundayDates)    if (unavailable.has(d)) out.push({ name, date: d, service: "Dom" });
    for (const d of activeSatDates) if (unavailable.has(d)) out.push({ name, date: d, service: "Sáb" });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

function subtractDay(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function nameToId(name: string, members: MemberOption[]): string | null {
  const lo = name.toLowerCase().trim();
  return members.find(m =>
    m.member_name.toLowerCase().trim() === lo ||
    (m.alias?.trim().toLowerCase() === lo)
  )?._id ?? null;
}

function resolveToMemberName(name: string, members: MemberOption[]): string {
  const lo = name.toLowerCase().trim();
  const m = members.find(m =>
    m.member_name.toLowerCase().trim() === lo ||
    (m.alias?.trim().toLowerCase() === lo)
  );
  return m?.member_name ?? name;
}

// ─── DSL serialization ────────────────────────────────────────────────────────

function restrictionToDs(r: PersonRestriction): string | null {
  if (!r.person) return null;
  const clauses: string[] = [];
  for (const pat of r.excludedPatterns)  clauses.push(`!in ${pat}`);
  for (const we of r.weekExclusions)     clauses.push(`!in week ${we.week} ${we.pattern}`);
  for (const cap of r.caps) {
    const val = cap.relative ? `{weeks-${cap.relOffset}}` : String(cap.value);
    clauses.push(`${cap.pattern} ${cap.op} ${val}`);
  }
  if (r.fairness === "exempt")           clauses.push("fairness_exempt");
  if (r.fairness === "slack" && r.fairnessSlack > 0) clauses.push(`fairness_slack ${r.fairnessSlack}`);
  if (clauses.length === 0) return null;
  return `${r.person} ${clauses.join(" & ")}`;
}

function allRulesToDs(config: SolverConfig, members: MemberOption[]): string[] {
  const res = (name: string) => resolveToMemberName(name, members);
  const out: string[] = [];
  for (const r of config.restrictions) {
    const resolved = { ...r, person: res(r.person) };
    const ds = restrictionToDs(resolved);
    if (ds) out.push(ds);
  }
  for (const r of config.conflicts)
    out.push(`${res(r.personA)} !with ${res(r.personB)} on ${r.pattern}`);
  for (const r of config.presence)
    out.push(`any_of(${r.persons.map(res).join(",")}) on ${r.pattern} each_week`);
  return out;
}

// ─── Shared sub-components ────────────────────────────────────────────────────

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
      <p className="font-label text-[11px] uppercase tracking-widest text-gray-500 mb-1">{label}</p>
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
      <p className="font-label text-[11px] uppercase tracking-widest text-gray-500 mb-1">{label}</p>
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
        <button type="button" onClick={() => onChange([...slots, { id: uid(), [nameKey]: "", personId: "" }])} className="font-label text-[11px] uppercase tracking-widest text-[#00bfff]/50 hover:text-[#00bfff] transition-colors">
          + {nameKey === "instrument" ? "Instrumento" : "Rol"}
        </button>
      </div>
    </div>
  );
}

// ─── MemberPool — extracted to module level to prevent scroll-reset on remount ──

function MemberPool({ field, label, pool, config, onToggle, onSelectAll, search, onSearch }: {
  field: "sundayLeads" | "saturdayLeads" | "support";
  label: string;
  pool: MemberOption[];
  config: SolverConfig;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  search: string;
  onSearch: (q: string) => void;
}) {
  const visible = search.trim()
    ? pool.filter(m => dn(m).toLowerCase().includes(search.toLowerCase()))
    : pool;
  const allSelected = pool.length > 0 && pool.every(m => config[field].includes(m._id));

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <p className="font-label text-[11px] uppercase tracking-widest text-gray-500">{label}</p>
        <button
          type="button" onClick={onSelectAll}
          className="font-label text-[10px] uppercase tracking-widest text-[#00bfff]/60 hover:text-[#00bfff] transition-colors"
        >
          {allSelected ? "Ninguno" : "Todos"}
        </button>
      </div>
      <input
        className="w-full px-2 py-1 mb-1 rounded border border-[#00bfff]/15 bg-transparent font-body text-xs focus:outline-none focus:border-[#00bfff] placeholder-gray-600"
        placeholder="Buscar..." value={search} onChange={e => onSearch(e.target.value)}
      />
      <div className="max-h-32 overflow-y-auto rounded border border-[#00bfff]/10 divide-y divide-[#00bfff]/5">
        {visible.length === 0 && <p className="px-2 py-1 font-body text-xs text-gray-600 italic">Sin resultados</p>}
        {visible.map(m => (
          <label key={m._id} className={`flex items-center gap-2 px-2 py-1 cursor-pointer text-xs transition-colors ${config[field].includes(m._id) ? "bg-[#00bfff]/10" : "hover:bg-[#00bfff]/5"}`}>
            <input type="checkbox" checked={config[field].includes(m._id)} onChange={() => onToggle(m._id)} className="accent-[#00bfff]" />
            <span className="font-body">{dn(m)}</span>
          </label>
        ))}
      </div>
      {config[field].length > 0 && (
        <p className="font-label text-[10px] uppercase tracking-widest text-[#00bfff] mt-0.5">
          {config[field].length} seleccionado{config[field].length !== 1 ? "s" : ""}
        </p>
      )}
    </div>
  );
}

// ─── Rule builder — display cards ─────────────────────────────────────────────

function RestrictionCard({ r, onDelete, onEdit }: { r: PersonRestriction; onDelete: () => void; onEdit: () => void }) {
  return (
    <div className="rounded-lg border border-[#00bfff]/10 bg-[#001830]/40 px-3 py-2 flex items-start gap-2">
      <div className="flex-1 min-w-0 space-y-1">
        <span className="font-label text-[11px] uppercase tracking-widest text-[#00bfff]/80 font-semibold">{r.person}</span>
        <div className="flex flex-wrap gap-1">
          {r.excludedPatterns.map(p => (
            <span key={p} className="font-label text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/30">
              !{p}
            </span>
          ))}
          {r.weekExclusions.map(we => (
            <span key={we.id} className="font-label text-[10px] px-1.5 py-0.5 rounded-full bg-orange-500/15 text-orange-400 border border-orange-500/30">
              sem.{we.week} {we.pattern}
            </span>
          ))}
          {r.caps.map(cap => (
            <span key={cap.id} className="font-label text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/30">
              {cap.pattern} {cap.op} {cap.relative ? `sem−${cap.relOffset}` : cap.value}
            </span>
          ))}
          {r.fairness === "exempt" && (
            <span className="font-label text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-500/15 text-yellow-400 border border-yellow-500/30">
              fairness_exempt
            </span>
          )}
          {r.fairness === "slack" && (
            <span className="font-label text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-500/15 text-yellow-400 border border-yellow-500/30">
              slack {r.fairnessSlack}
            </span>
          )}
        </div>
      </div>
      <button type="button" onClick={onEdit} className="text-gray-600 hover:text-[#00bfff] transition-colors shrink-0 text-xs leading-none mt-0.5 px-0.5" title="Editar">✎</button>
      <button type="button" onClick={onDelete} className="text-gray-600 hover:text-red-400 transition-colors shrink-0 text-sm leading-none mt-0.5">×</button>
    </div>
  );
}

function ConflictCard({ r, onDelete, onEdit }: { r: ConflictRule; onDelete: () => void; onEdit: () => void }) {
  return (
    <div className="rounded-lg border border-[#00bfff]/10 bg-[#001830]/40 px-3 py-2 flex items-center gap-2">
      <span className="font-label text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-purple-500/15 text-purple-400 border border-purple-500/30 shrink-0">≠</span>
      <span className="font-body text-xs flex-1">
        <span className="text-gray-200">{r.personA}</span>
        <span className="text-gray-500 mx-1">≠</span>
        <span className="text-gray-200">{r.personB}</span>
        <span className="text-gray-500 mx-1">en</span>
        <span className="text-[#00bfff]/70">{r.pattern}</span>
      </span>
      <button type="button" onClick={onEdit} className="text-gray-600 hover:text-[#00bfff] transition-colors shrink-0 text-xs leading-none px-0.5" title="Editar">✎</button>
      <button type="button" onClick={onDelete} className="text-gray-600 hover:text-red-400 transition-colors shrink-0 text-sm leading-none">×</button>
    </div>
  );
}

function PresenceCard({ r, onDelete, onEdit }: { r: PresenceRule; onDelete: () => void; onEdit: () => void }) {
  return (
    <div className="rounded-lg border border-[#00bfff]/10 bg-[#001830]/40 px-3 py-2 flex items-center gap-2">
      <span className="font-label text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/30 shrink-0">≥1</span>
      <span className="font-body text-xs flex-1">
        <span className="text-gray-200">{r.persons.join(", ")}</span>
        <span className="text-gray-500 mx-1">en</span>
        <span className="text-[#00bfff]/70">{r.pattern}</span>
        <span className="text-gray-500 ml-1">c/sem</span>
      </span>
      <button type="button" onClick={onEdit} className="text-gray-600 hover:text-[#00bfff] transition-colors shrink-0 text-xs leading-none px-0.5" title="Editar">✎</button>
      <button type="button" onClick={onDelete} className="text-gray-600 hover:text-red-400 transition-colors shrink-0 text-sm leading-none">×</button>
    </div>
  );
}

// ─── Rule builder — add forms ─────────────────────────────────────────────────

const rbSel = "px-2 py-1 rounded border border-[#00bfff]/15 bg-[#0a1929] font-body text-xs focus:outline-none focus:border-[#00bfff] w-full";
const rbIn  = "px-2 py-1 rounded border border-[#00bfff]/15 bg-transparent font-body text-xs focus:outline-none focus:border-[#00bfff]";

function PersonRestrictionForm({ members, onAdd, onCancel, initialValues }: {
  members: MemberOption[];
  onAdd: (r: PersonRestriction) => void;
  onCancel: () => void;
  initialValues?: PersonRestriction;
}) {
  const names = members.map(dn);
  const [person,   setPerson]   = useState(initialValues?.person ?? (names[0] ?? ""));
  const [excl,     setExcl]     = useState<string[]>(initialValues?.excludedPatterns ?? []);
  const [fairness, setFairness] = useState<PersonRestriction["fairness"]>(initialValues?.fairness ?? "none");
  const [slack,    setSlack]    = useState(initialValues?.fairnessSlack ?? 1);
  const [weekEx,   setWeekEx]   = useState<Array<{ id: string; week: number; pattern: string }>>(initialValues?.weekExclusions ?? []);
  const [caps,     setCaps]     = useState<PersonRestriction["caps"]>(initialValues?.caps ?? []);

  const toggleExcl = (pat: string) =>
    setExcl(e => e.includes(pat) ? e.filter(x => x !== pat) : [...e, pat]);

  const canAdd = !!person && (excl.length > 0 || weekEx.length > 0 || caps.length > 0 || fairness !== "none");

  const handleAdd = () => {
    if (!canAdd) return;
    onAdd({ id: uid(), person, excludedPatterns: excl, fairness, fairnessSlack: slack, weekExclusions: weekEx, caps });
  };

  return (
    <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 space-y-3">
      {/* Person */}
      <div>
        <p className="font-label text-[10px] uppercase tracking-widest text-gray-500 mb-1">Persona</p>
        <select className={rbSel} value={person} onChange={e => setPerson(e.target.value)}>
          {names.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>

      {/* Exclusion pattern pills */}
      <div>
        <p className="font-label text-[10px] uppercase tracking-widest text-gray-500 mb-1.5">Excluir de</p>
        <div className="flex flex-wrap gap-1.5">
          {EXCL_PATTERNS.map(pat => (
            <button
              key={pat} type="button" onClick={() => toggleExcl(pat)}
              className={`font-label text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full border transition-colors ${
                excl.includes(pat)
                  ? "bg-red-500/20 text-red-400 border-red-500/40"
                  : "text-gray-500 border-[#00bfff]/15 hover:border-red-500/30 hover:text-red-400"
              }`}
            >
              {PAT_LABEL[pat] ?? pat}
            </button>
          ))}
        </div>
        {excl.length > 0 && (
          <p className="font-label text-[10px] text-red-400/70 mt-1">{excl.join(" · ")}</p>
        )}
      </div>

      {/* Fairness */}
      <div>
        <p className="font-label text-[10px] uppercase tracking-widest text-gray-500 mb-1">Fairness</p>
        <div className="flex items-center gap-3 flex-wrap">
          {(["none", "exempt", "slack"] as const).map(f => (
            <label key={f} className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" name={`fairness-${person}`} value={f} checked={fairness === f} onChange={() => setFairness(f)} className="accent-[#00bfff]" />
              <span className="font-body text-xs text-gray-400">
                {f === "none" ? "Normal" : f === "exempt" ? "Exempt" : "Slack"}
              </span>
            </label>
          ))}
          {fairness === "slack" && (
            <input
              type="number" min={1} max={5}
              className={`${rbIn} w-12`}
              value={slack}
              onChange={e => setSlack(Number(e.target.value))}
            />
          )}
        </div>
      </div>

      {/* Week exclusions */}
      <div>
        <p className="font-label text-[10px] uppercase tracking-widest text-gray-500 mb-1">Semanas excluidas</p>
        <div className="space-y-1">
          {weekEx.map(we => (
            <div key={we.id} className="flex gap-1.5 items-center">
              <select
                className={`${rbSel} w-20 flex-none`}
                value={we.week}
                onChange={e => setWeekEx(ws => ws.map(x => x.id === we.id ? { ...x, week: Number(e.target.value) } : x))}
              >
                {[1,2,3,4,5].map(n => <option key={n} value={n}>Sem {n}</option>)}
              </select>
              <select
                className={`${rbSel} flex-1`}
                value={we.pattern}
                onChange={e => setWeekEx(ws => ws.map(x => x.id === we.id ? { ...x, pattern: e.target.value } : x))}
              >
                {PATTERNS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
              <button type="button" onClick={() => setWeekEx(ws => ws.filter(x => x.id !== we.id))} className="text-gray-600 hover:text-red-400 text-sm flex-none">×</button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setWeekEx(ws => [...ws, { id: uid(), week: 1, pattern: "*.*" }])}
          className="font-label text-[10px] uppercase tracking-widest text-[#00bfff]/60 hover:text-[#00bfff] transition-colors mt-1"
        >
          + Semana
        </button>
      </div>

      {/* Caps */}
      <div>
        <p className="font-label text-[10px] uppercase tracking-widest text-gray-500 mb-1">Caps</p>
        <div className="space-y-1">
          {caps.map(cap => (
            <div key={cap.id} className="flex gap-1.5 items-center">
              <select
                className={`${rbSel} flex-1`}
                value={cap.pattern}
                onChange={e => setCaps(cs => cs.map(x => x.id === cap.id ? { ...x, pattern: e.target.value } : x))}
              >
                {PATTERNS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
              <select
                className={`${rbSel} w-14 flex-none`}
                value={cap.op}
                onChange={e => setCaps(cs => cs.map(x => x.id === cap.id ? { ...x, op: e.target.value as any } : x))}
              >
                <option value="<=">≤</option>
                <option value=">=">≥</option>
                <option value="==">= </option>
              </select>
              {cap.relative ? (
                <div className="flex items-center gap-0.5 flex-none">
                  <span className="font-label text-[10px] text-[#00bfff]/70">sem−</span>
                  <input
                    type="number" min={0} max={4}
                    className={`${rbIn} w-8 text-center`}
                    value={cap.relOffset}
                    onChange={e => setCaps(cs => cs.map(x => x.id === cap.id ? { ...x, relOffset: Number(e.target.value) } : x))}
                  />
                </div>
              ) : (
                <input
                  type="number" min={0} max={10}
                  className={`${rbIn} w-10 flex-none text-center`}
                  value={cap.value}
                  onChange={e => setCaps(cs => cs.map(x => x.id === cap.id ? { ...x, value: Number(e.target.value) } : x))}
                />
              )}
              <button
                type="button"
                title={cap.relative ? "Cambiar a número fijo" : "Relativo al nº de semanas"}
                onClick={() => setCaps(cs => cs.map(x => x.id === cap.id ? { ...x, relative: !x.relative } : x))}
                className={`font-label text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded flex-none border transition-colors ${
                  cap.relative
                    ? "border-[#00bfff]/40 bg-[#00bfff]/10 text-[#00bfff]"
                    : "border-[#00bfff]/15 text-gray-600 hover:text-[#00bfff]"
                }`}
              >sem</button>
              <button type="button" onClick={() => setCaps(cs => cs.filter(x => x.id !== cap.id))} className="text-gray-600 hover:text-red-400 text-sm flex-none">×</button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setCaps(cs => [...cs, { id: uid(), pattern: "Sun.*", op: "<=", value: 2, relative: false, relOffset: 2 }])}
          className="font-label text-[10px] uppercase tracking-widest text-[#00bfff]/60 hover:text-[#00bfff] transition-colors mt-1"
        >
          + Cap
        </button>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onCancel} className="flex-1 py-1 rounded font-label text-[11px] uppercase tracking-widest border border-[#00bfff]/20 text-gray-500 hover:text-[#00bfff] hover:border-[#00bfff] transition-colors">
          Cancelar
        </button>
        <button type="button" onClick={handleAdd} disabled={!canAdd} className="flex-1 py-1 rounded font-label text-[11px] uppercase tracking-widest bg-red-500/20 hover:bg-red-500/30 text-red-400 transition-colors disabled:opacity-40">
          {initialValues ? "Guardar cambios" : "Agregar restricción"}
        </button>
      </div>
    </div>
  );
}

function ConflictForm({ members, onAdd, onCancel, initialValues }: {
  members: MemberOption[];
  onAdd: (r: ConflictRule) => void;
  onCancel: () => void;
  initialValues?: ConflictRule;
}) {
  const names = members.map(dn);
  const [personA,  setPersonA]  = useState(initialValues?.personA ?? (names[0] ?? ""));
  const [personB,  setPersonB]  = useState(initialValues?.personB ?? (names[1] ?? ""));
  const [pattern,  setPattern]  = useState(initialValues?.pattern ?? "*.Lead");

  const canAdd = personA && personB && personA !== personB;

  return (
    <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="font-label text-[10px] uppercase tracking-widest text-gray-500 mb-1">Persona A</p>
          <select className={rbSel} value={personA} onChange={e => setPersonA(e.target.value)}>
            {names.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div>
          <p className="font-label text-[10px] uppercase tracking-widest text-gray-500 mb-1">Persona B</p>
          <select className={rbSel} value={personB} onChange={e => setPersonB(e.target.value)}>
            {names.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>
      <div>
        <p className="font-label text-[10px] uppercase tracking-widest text-gray-500 mb-1">Patrón — no pueden coincidir en</p>
        <select className={rbSel} value={pattern} onChange={e => setPattern(e.target.value)}>
          {PATTERNS.map(p => <option key={p.value} value={p.value}>{p.label} ({p.value})</option>)}
        </select>
      </div>
      {personA === personB && personA && (
        <p className="font-label text-[10px] text-red-400">Selecciona dos personas distintas</p>
      )}
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onCancel} className="flex-1 py-1 rounded font-label text-[11px] uppercase tracking-widest border border-[#00bfff]/20 text-gray-500 hover:text-[#00bfff] hover:border-[#00bfff] transition-colors">
          Cancelar
        </button>
        <button type="button" disabled={!canAdd} onClick={() => onAdd({ id: initialValues?.id ?? uid(), personA, personB, pattern })} className="flex-1 py-1 rounded font-label text-[11px] uppercase tracking-widest bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 transition-colors disabled:opacity-40">
          {initialValues ? "Guardar cambios" : "Agregar conflicto"}
        </button>
      </div>
    </div>
  );
}

function PresenceForm({ members, onAdd, onCancel, initialValues }: {
  members: MemberOption[];
  onAdd: (r: PresenceRule) => void;
  onCancel: () => void;
  initialValues?: PresenceRule;
}) {
  const [selected, setSelected] = useState<string[]>(initialValues?.persons ?? []);
  const [pattern,  setPattern]  = useState(initialValues?.pattern ?? "Sun.BGV");

  const canAdd = selected.length >= 2;

  return (
    <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-3 space-y-2">
      <div>
        <p className="font-label text-[10px] uppercase tracking-widest text-gray-500 mb-1">Al menos uno de (mín. 2)</p>
        <div className="max-h-28 overflow-y-auto rounded border border-[#00bfff]/10 divide-y divide-[#00bfff]/5">
          {members.map(m => {
            const name    = dn(m);
            const checked = selected.includes(name);
            return (
              <label key={m._id} className={`flex items-center gap-2 px-2 py-1 cursor-pointer text-xs transition-colors ${checked ? "bg-[#00bfff]/10" : "hover:bg-[#00bfff]/5"}`}>
                <input
                  type="checkbox" checked={checked} className="accent-[#00bfff]"
                  onChange={() => setSelected(s => checked ? s.filter(p => p !== name) : [...s, name])}
                />
                <span className="font-body">{name}</span>
              </label>
            );
          })}
        </div>
        {selected.length > 0 && (
          <p className="font-label text-[10px] text-green-400 mt-0.5">{selected.join(", ")}</p>
        )}
      </div>
      <div>
        <p className="font-label text-[10px] uppercase tracking-widest text-gray-500 mb-1">Debe aparecer en</p>
        <select className={rbSel} value={pattern} onChange={e => setPattern(e.target.value)}>
          {PATTERNS.map(p => <option key={p.value} value={p.value}>{p.label} ({p.value})</option>)}
        </select>
      </div>
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onCancel} className="flex-1 py-1 rounded font-label text-[11px] uppercase tracking-widest border border-[#00bfff]/20 text-gray-500 hover:text-[#00bfff] hover:border-[#00bfff] transition-colors">
          Cancelar
        </button>
        <button type="button" disabled={!canAdd} onClick={() => onAdd({ id: initialValues?.id ?? uid(), persons: selected, pattern })} className="flex-1 py-1 rounded font-label text-[11px] uppercase tracking-widest bg-green-500/20 hover:bg-green-500/30 text-green-400 transition-colors disabled:opacity-40">
          {initialValues ? "Guardar cambios" : "Agregar presencia"}
        </button>
      </div>
    </div>
  );
}

// ─── Rule builder — main orchestrator ────────────────────────────────────────

function RuleBuilder({ config, onChange, members }: {
  config: SolverConfig;
  onChange: (c: SolverConfig) => void;
  members: MemberOption[];
}) {
  const [adding,    setAdding]    = useState<"restriction" | "conflict" | "presence" | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const rmRestriction = (id: string) => onChange({ ...config, restrictions: config.restrictions.filter(r => r.id !== id) });
  const rmConflict    = (id: string) => onChange({ ...config, conflicts:    config.conflicts.filter(r => r.id !== id) });
  const rmPresence    = (id: string) => onChange({ ...config, presence:     config.presence.filter(r => r.id !== id) });

  const saveRestriction = (r: PersonRestriction) => {
    onChange({ ...config, restrictions: config.restrictions.map(x => x.id === r.id ? r : x) });
    setEditingId(null);
  };
  const saveConflict = (r: ConflictRule) => {
    onChange({ ...config, conflicts: config.conflicts.map(x => x.id === r.id ? r : x) });
    setEditingId(null);
  };
  const savePresence = (r: PresenceRule) => {
    onChange({ ...config, presence: config.presence.map(x => x.id === r.id ? r : x) });
    setEditingId(null);
  };

  const cancelEdit = () => setEditingId(null);

  const total = config.restrictions.length + config.conflicts.length + config.presence.length;
  const isFormOpen = !!adding || !!editingId;

  return (
    <div className="space-y-2">
      <p className="font-label text-[11px] uppercase tracking-widest text-gray-500">
        Reglas{total > 0 ? ` (${total})` : ""}
      </p>

      {/* Restriction cards / edit forms */}
      {config.restrictions.map(r =>
        editingId === r.id ? (
          <PersonRestrictionForm key={r.id} members={members} initialValues={r}
            onAdd={saveRestriction} onCancel={cancelEdit} />
        ) : (
          <RestrictionCard key={r.id} r={r}
            onDelete={() => rmRestriction(r.id)}
            onEdit={() => { setEditingId(r.id); setAdding(null); }} />
        )
      )}

      {/* Conflict cards / edit forms */}
      {config.conflicts.map(r =>
        editingId === r.id ? (
          <ConflictForm key={r.id} members={members} initialValues={r}
            onAdd={saveConflict} onCancel={cancelEdit} />
        ) : (
          <ConflictCard key={r.id} r={r}
            onDelete={() => rmConflict(r.id)}
            onEdit={() => { setEditingId(r.id); setAdding(null); }} />
        )
      )}

      {/* Presence cards / edit forms */}
      {config.presence.map(r =>
        editingId === r.id ? (
          <PresenceForm key={r.id} members={members} initialValues={r}
            onAdd={savePresence} onCancel={cancelEdit} />
        ) : (
          <PresenceCard key={r.id} r={r}
            onDelete={() => rmPresence(r.id)}
            onEdit={() => { setEditingId(r.id); setAdding(null); }} />
        )
      )}

      {total === 0 && !isFormOpen && (
        <p className="font-body text-xs text-gray-600 italic px-1">Sin reglas configuradas</p>
      )}

      {/* Inline add forms */}
      {adding === "restriction" && (
        <PersonRestrictionForm
          members={members}
          onAdd={r => { onChange({ ...config, restrictions: [...config.restrictions, r] }); setAdding(null); }}
          onCancel={() => setAdding(null)}
        />
      )}
      {adding === "conflict" && (
        <ConflictForm
          members={members}
          onAdd={r => { onChange({ ...config, conflicts: [...config.conflicts, r] }); setAdding(null); }}
          onCancel={() => setAdding(null)}
        />
      )}
      {adding === "presence" && (
        <PresenceForm
          members={members}
          onAdd={r => { onChange({ ...config, presence: [...config.presence, r] }); setAdding(null); }}
          onCancel={() => setAdding(null)}
        />
      )}

      {/* Add buttons — hidden while any form is open */}
      {!isFormOpen && (
        <div className="flex gap-2 pt-1 flex-wrap">
          <button
            type="button" onClick={() => setAdding("restriction")}
            className="font-label text-[10px] uppercase tracking-widest px-2 py-1 rounded-full border border-red-500/30 text-red-400/70 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            + Persona
          </button>
          <button
            type="button" onClick={() => setAdding("conflict")}
            className="font-label text-[10px] uppercase tracking-widest px-2 py-1 rounded-full border border-purple-500/30 text-purple-400/70 hover:text-purple-400 hover:bg-purple-500/10 transition-colors"
          >
            ≠ Conflicto
          </button>
          <button
            type="button" onClick={() => setAdding("presence")}
            className="font-label text-[10px] uppercase tracking-widest px-2 py-1 rounded-full border border-green-500/30 text-green-400/70 hover:text-green-400 hover:bg-green-500/10 transition-colors"
          >
            ≥1 Presencia
          </button>
        </div>
      )}
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
  const vozMembers = members.filter(m => m.memberType?.includes("voz"));
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
          <p className="font-label text-[10px] uppercase tracking-widest text-gray-500">
            {new Date(draft.date + "T12:00:00").toLocaleDateString("es-MX", { month: "short" })}
          </p>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`font-label text-[11px] uppercase tracking-widest px-2 py-0.5 rounded-full ${badgeCls}`}>
              {isSun ? "Domingo" : "Sábado"}
            </span>
            {draft.exists && (
              <span className="font-label text-[11px] uppercase tracking-widest px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-500 border border-yellow-500/30">
                Ya existe
              </span>
            )}
          </div>
          <p className="font-label text-[11px] uppercase tracking-widest text-gray-600 mt-0.5">
            {total > 0 ? `${total} asignado${total !== 1 ? "s" : ""}` : "Sin asignar"}
          </p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {!draft.skipped && (
            <button type="button" onClick={onSwapSelect} title="Intercambiar equipo"
              className={`px-2 py-1 rounded font-label text-xs transition-colors ${swapSelected ? "bg-[#00bfff]/20 text-[#00bfff]" : "text-gray-500 hover:text-[#00bfff] hover:bg-[#00bfff]/10"}`}
            >⇄</button>
          )}
          {!draft.exists && (
            <button type="button" onClick={onToggleSkip}
              className={`px-2 py-1 rounded font-label text-[11px] uppercase tracking-widest transition-colors ${draft.skipped ? "text-[#00bfff] hover:bg-[#00bfff]/10" : "text-gray-500 hover:text-red-400 hover:bg-red-500/10"}`}
            >{draft.skipped ? "+ Incluir" : "Omitir"}</button>
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
          <MemberCheckboxes label="Líderes"   members={vozMembers} selected={draft.leads}  onChange={leads  => onChange({ ...draft, leads  })} />
          <MemberCheckboxes label="BGVs"      members={vozMembers} selected={draft.bgvs}   onChange={bgvs   => onChange({ ...draft, bgvs   })} />
          <MemberCheckboxes label="Coro"      members={vozMembers} selected={draft.chorus} onChange={chorus => onChange({ ...draft, chorus })} />
          <SlotEditor2 label="Instrumentos"   nameKey="instrument" slots={draft.instruments} members={members} onChange={s => onChange({ ...draft, instruments: s })} />
          <SlotEditor2 label="FOH / Técnicos" nameKey="role"       slots={draft.foh}         members={members} onChange={s => onChange({ ...draft, foh: s })} />
        </div>
      )}
    </div>
  );
}

// ─── Solver config panel ──────────────────────────────────────────────────────

function SolverConfigPanel({ members, config, onChange, history, onRemoveHistory }: {
  members: MemberOption[];
  config: SolverConfig;
  onChange: (c: SolverConfig) => void;
  history: SolverHistoryEntry[];
  onRemoveHistory: (key: string) => void;
}) {
  const [searches, setSearches] = useState<Record<string, string>>({});

  const sundayPool   = members.filter(m => m.memberType?.includes("voz") && m.memberType?.includes("sunday_lead"));
  const saturdayPool = members.filter(m => m.memberType?.includes("voz") && m.memberType?.includes("saturday_lead"));
  const supportPool  = members.filter(m => m.memberType?.includes("voz") && m.memberType?.includes("support"));

  const toggleMember = (field: "sundayLeads" | "saturdayLeads" | "support", id: string) => {
    const cur = config[field];
    onChange({ ...config, [field]: cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id] });
  };

  const selectAll = (field: "sundayLeads" | "saturdayLeads" | "support", pool: MemberOption[]) => {
    const allIds = pool.map(m => m._id);
    const allSelected = allIds.every(id => config[field].includes(id));
    onChange({
      ...config,
      [field]: allSelected
        ? config[field].filter(id => !allIds.includes(id))
        : [...new Set([...config[field], ...allIds])],
    });
  };

  return (
    <div className="space-y-3 p-3 rounded-xl border border-[#00bfff]/20 bg-[#00bfff]/5">
      <p className="font-label text-[11px] uppercase tracking-widest text-[#00bfff]">Configuración del Solver</p>

      <div className="grid grid-cols-3 gap-3">
        <MemberPool
          field="sundayLeads" label="Líderes Domingo"
          pool={sundayPool} config={config}
          onToggle={id => toggleMember("sundayLeads", id)}
          onSelectAll={() => selectAll("sundayLeads", sundayPool)}
          search={searches.sundayLeads ?? ""}
          onSearch={q => setSearches(s => ({ ...s, sundayLeads: q }))}
        />
        <MemberPool
          field="saturdayLeads" label="Líderes Sábado"
          pool={saturdayPool} config={config}
          onToggle={id => toggleMember("saturdayLeads", id)}
          onSelectAll={() => selectAll("saturdayLeads", saturdayPool)}
          search={searches.saturdayLeads ?? ""}
          onSearch={q => setSearches(s => ({ ...s, saturdayLeads: q }))}
        />
        <MemberPool
          field="support" label="Soporte"
          pool={supportPool} config={config}
          onToggle={id => toggleMember("support", id)}
          onSelectAll={() => selectAll("support", supportPool)}
          search={searches.support ?? ""}
          onSearch={q => setSearches(s => ({ ...s, support: q }))}
        />
      </div>

      <RuleBuilder config={config} onChange={onChange} members={members.filter(m => m.memberType?.includes("voz"))} />

      {/* Solver history indicator */}
      {history.length > 0 && (
        <div>
          <p className="font-label text-[11px] uppercase tracking-widest text-gray-500 mb-1">
            Historial ({history.length})
            <span className="ml-1 text-[#00bfff]/50 normal-case">— últimas {Math.min(history.length, 3)} ejecuciones usadas</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {[...history].reverse().map(h => (
              <span key={h.key} className="flex items-center gap-1 font-label text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full border border-[#00bfff]/20 bg-[#00bfff]/5 text-[#00bfff]/70">
                {MONTHS[h.month - 1].slice(0, 3)} {h.year}
                <button
                  type="button"
                  onClick={() => onRemoveHistory(h.key)}
                  className="text-gray-600 hover:text-red-400 transition-colors leading-none ml-0.5"
                  title="Eliminar del historial"
                >×</button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MonthGenerator({ members, existingRoles, onClose, onCreated }: Props) {
  const now = new Date();
  const [step, setStep]           = useState<"config" | "preview">("config");
  const [year, setYear]           = useState(now.getFullYear());
  const [month, setMonth]         = useState(now.getMonth() + 1);
  const [sundays, setSundays]     = useState(true);
  const [saturdays, setSaturdays] = useState(true);
  const [drafts, setDrafts]       = useState<DraftCard[]>([]);
  const [swapSel, setSwapSel]     = useState<string | null>(null);
  const [viewMode, setViewMode]   = useState<"edit" | "view">("edit");
  const [pushing, setPushing]     = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [swapToast, setSwapToast] = useState<string | null>(null);
  const [useSolver, setUseSolver] = useState(false);
  const [solving, setSolving]     = useState(false);
  const [solverError, setSolverError] = useState<string | null>(null);
  const [solverConfig, setSolverConfig] = useState<SolverConfig>(DEFAULT_SOLVER_CONFIG);
  const [activeSatDates, setActiveSatDates] = useState<string[]>([]);
  const [solverHistory, setSolverHistory] = useState<SolverHistoryEntry[]>([]);
  const [unavailabilityNotices, setUnavailabilityNotices] = useState<{ name: string; date: string; service: string }[]>([]);
  const [unfilledSeats, setUnfilledSeats] = useState<string[]>([]);

  useEffect(() => {
    if (!saturdays) { setActiveSatDates([]); return; }
    setActiveSatDates(getDates(year, month, 6));
  }, [year, month, saturdays]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved) as SolverConfig;
      if (Array.isArray(parsed.sundayLeads) && Array.isArray(parsed.restrictions)) {
        setSolverConfig(parsed);
      }
    } catch {}
    try {
      const hist = localStorage.getItem(HISTORY_KEY);
      if (hist) setSolverHistory(JSON.parse(hist) as SolverHistoryEntry[]);
    } catch {}
  }, []);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(solverConfig)); } catch {}
  }, [solverConfig]);

  function saveHistoryEntry(year: number, month: number, total_counts: Record<string, number>, role_counts: Record<string, Record<string, number>>) {
    const key = `${year}-${month}`;
    setSolverHistory(prev => {
      const next = [
        ...prev.filter(h => h.key !== key),
        { key, year, month, total_counts, role_counts },
      ].slice(-MAX_HISTORY);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  function removeHistoryEntry(key: string) {
    setSolverHistory(prev => {
      const next = prev.filter(h => h.key !== key);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }

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
      getDates(year, month, 6).filter(d => activeSatDates.includes(d)).forEach(date => all.push({
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
      const sunDates = sundays ? getDates(year, month, 0) : [];
      setUnavailabilityNotices(buildUnavailabilityNotices(sunDates, saturdays ? activeSatDates : [], members));
      setDrafts(buildEmptyDrafts());
      setStep("preview");
      return;
    }

    const sundayDates   = getDates(year, month, 0);
    const saturdayDates = getDates(year, month, 6);
    const weeks         = sundayDates.length;

    const weekendsWithSaturday: number[] = [];
    if (saturdays && activeSatDates.length > 0) {
      sundayDates.forEach((sunDate, i) => {
        const prevDay = subtractDay(sunDate);
        if (activeSatDates.includes(prevDay)) weekendsWithSaturday.push(i + 1);
      });
      // Fallback: if no Saturday is adjacent to a Sunday, assign by position
      if (weekendsWithSaturday.length === 0) {
        activeSatDates.forEach((_, i) => weekendsWithSaturday.push(i + 1));
      }
    }

    const idToName = (id: string) => members.find(m => m._id === id)?.member_name ?? id;

    // Deduplicate pools: sunday_leads takes priority, then saturday_leads, then support.
    // The solver requires mutual exclusivity; sunday_leads members are already eligible
    // for Saturday lead slots (see solver pool definition), so removing duplicates is safe.
    const sundayLeadNames   = solverConfig.sundayLeads.map(idToName);
    const sundaySet         = new Set(sundayLeadNames);
    const saturdayLeadNames = solverConfig.saturdayLeads.map(idToName).filter(n => !sundaySet.has(n));
    const satSet            = new Set([...sundayLeadNames, ...saturdayLeadNames]);
    const supportNames      = solverConfig.support.map(idToName).filter(n => !satSet.has(n));
    const poolNames         = new Set([...sundayLeadNames, ...saturdayLeadNames, ...supportNames]);

    // Any person referenced in a DSL rule but not in any pool must be added to support
    // so the solver knows about them. The solver validates all DSL persons against known people.
    const extraSupport: string[] = [];
    const allDslPersons = [
      ...solverConfig.restrictions.map(r => r.person),
      ...solverConfig.conflicts.flatMap(r => [r.personA, r.personB]),
      ...solverConfig.presence.flatMap(r => r.persons),
    ];
    for (const name of allDslPersons) {
      const resolved = resolveToMemberName(name, members);
      if (!poolNames.has(resolved) && !extraSupport.includes(resolved)) {
        extraSupport.push(resolved);
      }
    }

    // Auto-generate week-exclusion DSL rules from member unavailableDates
    const availabilityRules: string[] = [];
    const allPoolIds = new Set([
      ...solverConfig.sundayLeads,
      ...solverConfig.saturdayLeads,
      ...solverConfig.support,
    ]);
    for (const memberId of allPoolIds) {
      const m = members.find(x => x._id === memberId);
      if (!m?.unavailableDates?.length) continue;
      const unavailable = new Set(m.unavailableDates);
      sundayDates.forEach((sunDate, i) => {
        const weekNum = i + 1;
        if (unavailable.has(sunDate)) {
          availabilityRules.push(`${m.member_name} !in week ${weekNum} Sun.*`);
        }
        const prevDay = subtractDay(sunDate);
        if (unavailable.has(prevDay)) {
          availabilityRules.push(`${m.member_name} !in week ${weekNum} Sat.*`);
        }
      });
    }

    const payload: SolveRequest = {
      weeks,
      weekends_with_saturday: weekendsWithSaturday,
      sunday_leads:   sundayLeadNames,
      saturday_leads: saturdayLeadNames,
      support:        [...supportNames, ...extraSupport],
      dsl_rules:      [...allRulesToDs(solverConfig, members), ...availabilityRules],
      history: solverHistory.slice(-3).map(h => ({
        total_counts: h.total_counts,
        role_counts:  h.role_counts,
      })),
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
    } catch {
      setSolverError("Error de red al llamar al solver.");
      setSolving(false);
      return;
    }
    setSolving(false);

    if (!result.ok || !result.schedule) {
      setSolverError(result.error ?? "El solver no encontró solución.");
      return;
    }

    const existing  = new Set(existingRoles.map(r => `${r._type}__${r.date}`));
    const allDrafts: DraftCard[] = [];

    for (let w = 1; w <= weeks; w++) {
      const weekData = result.schedule[String(w)];
      if (!weekData) continue;
      const sunDate = sundayDates[w - 1];

      if (sundays && sunDate) {
        const sun = weekData.Sunday ?? { Lead: [], BGV: [], Choir: [] };
        allDrafts.push({
          localId: uid(), _type: "sunday_role", date: sunDate,
          exists:  existing.has(`sunday_role__${sunDate}`),
          skipped: existing.has(`sunday_role__${sunDate}`),
          leads:  sun.Lead.map(n => nameToId(n, members)).filter(Boolean) as string[],
          bgvs:   sun.BGV.map(n  => nameToId(n, members)).filter(Boolean) as string[],
          chorus: sun.Choir.map(n => nameToId(n, members)).filter(Boolean) as string[],
          instruments: [], foh: [],
        });
      }

      if (saturdays && weekData.Saturday) {
        const satDate = subtractDay(sunDate);
        if (saturdayDates.includes(satDate)) {
          const sat = weekData.Saturday;
          allDrafts.push({
            localId: uid(), _type: "saturday_role", date: satDate,
            exists:  existing.has(`saturday_role__${satDate}`),
            skipped: existing.has(`saturday_role__${satDate}`),
            leads: sat.Lead.map(n => nameToId(n, members)).filter(Boolean) as string[],
            bgvs:  sat.BGV.map(n  => nameToId(n, members)).filter(Boolean) as string[],
            chorus: [], instruments: [], foh: [],
          });
        }
      }
    }

    setUnavailabilityNotices(buildUnavailabilityNotices(sundayDates, activeSatDates, members));
    setUnfilledSeats(result.unfilled_seats ?? []);
    setDrafts(allDrafts.sort((a, b) => a.date.localeCompare(b.date)));
    if (result.total_counts && result.role_counts) {
      saveHistoryEntry(year, month, result.total_counts, result.role_counts);
    }
    setStep("preview");
  }

  function handleCardSwap(localId: string) {
    if (!swapSel) { setSwapSel(localId); return; }
    if (swapSel === localId) { setSwapSel(null); return; }
    const a = drafts.find(d => d.localId === swapSel)!;
    const b = drafts.find(d => d.localId === localId)!;
    setDrafts(drafts.map(d => {
      if (d.localId === swapSel)  return { ...d, leads: b.leads, bgvs: b.bgvs, chorus: b.chorus, instruments: b.instruments, foh: b.foh };
      if (d.localId === localId)  return { ...d, leads: a.leads, bgvs: a.bgvs, chorus: a.chorus, instruments: a.instruments, foh: a.foh };
      return d;
    }));
    setSwapSel(null);
    setSwapToast(`⇄ ${fmtDate(a.date)} ↔ ${fmtDate(b.date)}`);
    setTimeout(() => setSwapToast(null), 2500);
  }

  async function handleConfirm(publish: boolean) {
    const toCreate = drafts.filter(d => !d.skipped && !d.exists);
    if (!toCreate.length) return;
    setPushing(true);
    setPushError(null);
    let failed = 0;
    const created = new Set<string>();
    try {
      for (const d of toCreate) {
        try {
          const res = await fetch("/api/admin/roles", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              _type: d._type, date: d.date,
              leads: d.leads, bgvs: d.bgvs, chorus: d.chorus,
              instruments: d.instruments.filter(s => s.instrument && s.personId),
              foh: d.foh.filter(s => s.role && s.personId),
              published: publish,
            }),
          });
          if (res.ok) created.add(d.localId);
          else failed++;
        } catch {
          failed++;
        }
      }
    } finally {
      setPushing(false);
    }
    // Mark the ones that succeeded as existing so a retry only re-attempts the
    // failures (never re-POSTs an already-created service).
    if (created.size) setDrafts(prev => prev.map(d => created.has(d.localId) ? { ...d, exists: true } : d));
    // Refresh so the list reflects whatever actually got created.
    onCreated();
    if (failed === 0) {
      onClose();
    } else {
      // Keep the dialog open and report the partial failure instead of closing
      // as if the whole month was created successfully.
      setPushError(`No se pudieron crear ${failed} de ${toCreate.length} servicios. Intenta de nuevo.`);
    }
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
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={sundays} onChange={e => setSundays(e.target.checked)} className="accent-[#00bfff] w-4 h-4" />
          <span className="font-body text-sm">Domingos</span>
        </label>
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={saturdays} onChange={e => setSaturdays(e.target.checked)} className="accent-[#00bfff] w-4 h-4" />
          <span className="font-body text-sm">Sábados</span>
        </label>
        {saturdays && (
          <div className="ml-7 flex flex-wrap gap-1.5">
            {getDates(year, month, 6).map(date => {
              const active = activeSatDates.includes(date);
              return (
                <label key={date} className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] cursor-pointer transition-colors font-label uppercase tracking-widest ${
                  active
                    ? "border-yellow-400/50 bg-yellow-400/10 text-yellow-400"
                    : "border-[#00bfff]/15 text-gray-500 hover:border-yellow-400/30 hover:text-yellow-400/60"
                }`}>
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => setActiveSatDates(prev =>
                      active ? prev.filter(d => d !== date) : [...prev, date]
                    )}
                    className="accent-yellow-400 w-3 h-3"
                  />
                  {fmtDate(date)}
                </label>
              );
            })}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={useSolver} onChange={e => setUseSolver(e.target.checked)} className="accent-[#00bfff] w-4 h-4" />
          <span className="font-body text-sm">🤖 Auto-asignar con Solver</span>
        </label>
        {useSolver && (
          <SolverConfigPanel members={members} config={solverConfig} onChange={setSolverConfig} history={solverHistory} onRemoveHistory={removeHistoryEntry} />
        )}
      </div>

      {solverError && (
        <p className="font-body text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{solverError}</p>
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
          {swapSel && <span className="font-label text-[11px] uppercase tracking-widest text-[#00bfff] animate-pulse">Selecciona otro ⇄</span>}
          <button type="button" onClick={() => { setStep("config"); setSwapSel(null); }} className="font-label text-xs uppercase tracking-widest text-gray-500 hover:text-[#00bfff] transition-colors">
            ← Volver
          </button>
        </div>
      </div>

      <div className="flex justify-center">
        <div className="flex rounded-lg border border-[#003572]/30 dark:border-[#00bfff]/20 overflow-hidden">
          <button type="button" onClick={() => setViewMode("edit")}
            className={`px-5 py-2 font-label text-xs uppercase tracking-widest transition-colors ${
              viewMode === "edit" ? "bg-[#003572] dark:bg-[#00bfff]/20 text-[#C8D8EB]" : "text-gray-500 hover:text-[#C8D8EB]"}`}>
            Editar
          </button>
          <button type="button" onClick={() => setViewMode("view")}
            className={`px-5 py-2 font-label text-xs uppercase tracking-widest transition-colors border-l border-[#003572]/30 dark:border-[#00bfff]/20 ${
              viewMode === "view" ? "bg-[#003572] dark:bg-[#00bfff]/20 text-[#C8D8EB]" : "text-gray-500 hover:text-[#C8D8EB]"}`}>
            Vista
          </button>
        </div>
      </div>

      {swapToast && (
        <p className="font-label text-[11px] uppercase tracking-widest text-[#00bfff] text-center bg-[#00bfff]/10 rounded-lg py-1.5">{swapToast}</p>
      )}

      {unavailabilityNotices.length > 0 && (() => {
        // Group by person name
        const byPerson = new Map<string, { date: string; service: string }[]>();
        for (const n of unavailabilityNotices) {
          if (!byPerson.has(n.name)) byPerson.set(n.name, []);
          byPerson.get(n.name)!.push({ date: n.date, service: n.service });
        }
        return (
          <div className="rounded-lg border border-orange-500/25 bg-orange-500/10 px-3 py-2.5 space-y-1.5">
            <p className="font-label text-[11px] uppercase tracking-widest text-orange-400">
              No disponibles este mes
            </p>
            {Array.from(byPerson.entries()).map(([name, items]) => (
              <p key={name} className="font-body text-xs text-gray-400">
                <span className="text-orange-300 font-semibold">{name}</span>
                {" — "}
                {items.map(i => `${i.service} ${new Date(i.date + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "short" })}`).join(", ")}
              </p>
            ))}
          </div>
        );
      })()}

      {unfilledSeats.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 space-y-1.5">
          <p className="font-label text-[11px] uppercase tracking-widest text-amber-400">
            Lugares sin cubrir (faltó gente)
          </p>
          {summarizeUnfilledSeats(unfilledSeats).map(s => (
            <p key={`${s.week}-${s.service}`} className="font-body text-xs text-gray-400">
              <span className="text-amber-300 font-semibold">Semana {s.week} · {s.service}</span>
              {" — "}
              {s.labels.join(", ")}
            </p>
          ))}
          <p className="font-body text-xs text-gray-500 italic">
            El líder siempre se asigna; primero queda vacío el coro, luego BGV.
          </p>
        </div>
      )}

      {viewMode === "edit" ? (
        <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-0.5">
          {drafts.map(d => (
            <DraftCardEditor
              key={d.localId} draft={d} members={members}
              onChange={updated => setDrafts(drafts.map(x => x.localId === updated.localId ? updated : x))}
              onToggleSkip={() => setDrafts(drafts.map(x => x.localId === d.localId ? { ...x, skipped: !x.skipped } : x))}
              swapSelected={swapSel === d.localId}
              onSwapSelect={() => handleCardSwap(d.localId)}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-0.5">
          {drafts.filter(d => !d.skipped).map(d => {
            const p = draftToDayCardProps(d, members);
            return <DayCard key={d.localId} day={p.day} date={p.date} leads={p.leads}
                      bgvs={p.bgvs} chorus={p.chorus} instruments={p.instruments} fohTeam={p.fohTeam} />;
          })}
        </div>
      )}

      {pushError && (
        <p className="font-label text-xs uppercase tracking-widest text-red-400 text-center bg-red-500/10 rounded-lg py-1.5">{pushError}</p>
      )}

      <div className="flex gap-3">
        <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg border border-[#003572]/30 dark:border-[#00bfff]/20 font-label text-xs uppercase tracking-widest hover:border-[#00bfff] transition-colors">
          Cancelar
        </button>
        <button type="button" onClick={() => handleConfirm(false)} disabled={pushing || toCreate.length === 0} className="flex-1 py-2 rounded-lg bg-[#003572] dark:bg-[#00bfff]/20 hover:bg-[#003572]/80 dark:hover:bg-[#00bfff]/30 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50">
          {pushing ? "Creando..." : `Crear ${toCreate.length} borrador${toCreate.length !== 1 ? "es" : ""}`}
        </button>
        <button type="button" onClick={() => handleConfirm(true)} disabled={pushing || toCreate.length === 0} className="flex-1 py-2 rounded-lg bg-[#003572] dark:bg-[#00bfff]/20 hover:bg-[#003572]/80 dark:hover:bg-[#00bfff]/30 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50">
          Crear y publicar
        </button>
      </div>
    </div>
  );
}
