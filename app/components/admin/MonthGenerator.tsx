"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SolveResponse } from "@/app/api/admin/solve/route";
import { DayCard } from "@/app/components/DayCard";
import { draftToDayCardProps } from "@/app/utils/draftToDayCardProps";
import { runDraftCreateBatch } from "@/app/utils/monthDraftCreate";
import { creatableTargets, type TargetPreflight } from "./serviceReadiness";
import type { ParticipantRole } from "@/app/utils/computeParticipation";
import PlannerGrid, { type AutoState, type SolveDiagnostics } from "./PlannerGrid";
import MonthCalendar from "./MonthCalendar";
import { SERVICE_LABEL } from "./serviceCardModel";
import { fillColumn } from "./localFill";
import { unresolvedRuleNames } from "./ruleEnforcement";
import { ParticipationRail } from "./ParticipationRail";
import {
  editableConfig,
  sameSolverConfig,
  type SolverConfigController,
  type SolverConfigSource,
} from "./solverConfigSource";
import {
  buildColumns,
  buildRows,
  buildSolveRequest,
  applySolveResponse,
  cellsToDrafts,
  draftTargetKey,
  historyEntryFromDrafts,
  mapUnfilledSeats,
  namelessSpecial,
  plannerParticipationRoles,
  unaddressableDates as computeUnaddressableDates,
  type DraftCard,
  type GridCell,
  type GridRow,
  type PersonRestriction,
  type ConflictRule,
  type PresenceRule,
  type SolverConfig,
  type SolverHistoryEntry,
} from "./plannerModel";

// ─── Types ────────────────────────────────────────────────────────────────────

// A local shadow with exactly one use — the `preflight` prop below. The
// GOVERNING declaration is `ColumnType` in `plannerModel.ts`; widening this line
// alone changes nothing at all.
type ServiceType = "sunday_role" | "saturday_role" | "special_role";

interface MemberOption { _id: string; member_name: string; alias?: string; memberType?: string[]; unavailableDates?: string[]; }

const dn = (m: MemberOption) => m.alias?.trim() || m.member_name;

// `service_name` is what `cellsToDrafts` needs to tell one stored special on a
// date from another (E17). `ServiceRole` — what `ServicesPanel` actually passes
// — already carries it; this local shape used to drop it on the floor.
interface ExistingRole { _id: string; _type: string; date: string; service_name?: string; }

interface Props {
  members: MemberOption[];
  existingRoles: ExistingRole[];
  onClose: () => void;
  onCreated: () => void;
  /**
   * The shared rule set, fetched and written by `ServicesPanel`'s
   * `useSolverConfig` (P6). **Required, and deliberately not optional with a
   * default** — an optional prop falling back to `DEFAULT_SOLVER_CONFIG` is the
   * same "a failed read looks like the defaults" collapse the whole cutover
   * exists to prevent, wearing a prop's clothes.
   *
   * It is owned by the panel rather than fetched here so that this component
   * and `SeatBoard` read ONE object: a rule saved on this screen is what the
   * Tablero refuses on, with no second copy to go stale.
   */
  rules: SolverConfigController;
  /**
   * Current capability snapshot for the `generateMonth` row of Plan B's matrix,
   * passed in by `ServicesPanel` and RE-CHECKED at preview and at confirmation:
   * a source that fails while this dialog is open must block the post, not be
   * treated as an empty inventory. Optional so the dialog still renders
   * standalone (defaults to enabled).
   */
  capability?: { enabled: boolean; reason: string | null };
  /**
   * Per-target A1/A2 preflight for the `generateMonth` row of Plan B's matrix
   * (plan §"Data loading and validation consumption"). Every previewed target is
   * labelled `checking | unknown | exists | blocked | creatable` from the observed
   * bundle, and ONLY still-`creatable` targets are posted — a re-check runs again
   * at confirmation, because a source or observation can change while the dialog
   * is open. Optional so the dialog still renders standalone, in which case it
   * falls back to the plain `existingRoles` date check.
   */
  preflight?: (type: ServiceType, date: string) => TargetPreflight;
  /**
   * Full role history (with resolved assignments), for D12's `savedWindow` —
   * `recent` and (unioned with the in-grid drafts) `load` both derive from it.
   * `MonthGenerator` slices this to 56 days anchored at the target month's
   * first Sunday once year/month are chosen (fact 24) — `ServicesPanel` cannot
   * pre-slice it, since it does not know which month will be picked until the
   * config step runs. Optional so the dialog still renders standalone with an
   * empty (honest "sin historial reciente") window.
   */
  allRoles?: ParticipantRole[];
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

const HISTORY_KEY   = "owt_solver_history_v2";
const MAX_HISTORY   = 6;

/** 56 days — matches `ServicesPanel`'s `CANDIDATE_LOAD_WINDOW_DAYS` for SeatBoard. */
const SAVED_WINDOW_DAYS = 56;

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

/**
 * Who is unavailable on a date this month will actually GENERATE.
 *
 * Fed the SELECTED Sundays (never `sundayDatesFull`) plus the specials, per
 * work item 6: once Sundays are individually deselectable, the full spine would
 * report notices for dates that produce no column at all — and a special, which
 * does produce one, would go unreported. The rule is "one entry per column",
 * which is why the three arguments here mirror `buildColumns`' three inputs.
 */
function buildUnavailabilityNotices(
  sundayDates: string[],
  activeSatDates: string[],
  specials: { date: string; name: string }[],
  allMembers: MemberOption[]
): { name: string; date: string; service: string }[] {
  const out: { name: string; date: string; service: string }[] = [];
  for (const m of allMembers) {
    if (!m.unavailableDates?.length) continue;
    const unavailable = new Set(m.unavailableDates);
    const name = m.alias?.trim() || m.member_name;
    for (const d of sundayDates)    if (unavailable.has(d)) out.push({ name, date: d, service: "Dom" });
    for (const d of activeSatDates) if (unavailable.has(d)) out.push({ name, date: d, service: "Sáb" });
    for (const s of specials)       if (unavailable.has(s.date)) out.push({ name, date: s.date, service: s.name });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

/**
 * `allRoles` bounded to `SAVED_WINDOW_DAYS` days ending at the target month's
 * first Sunday (D12's `savedWindow`, fact 24) — both compared at local noon.
 * Empty when the month has no first Sunday (defensive; `getDates` always
 * returns at least one for a real calendar month) or when the caller has no
 * history to offer.
 */
function savedWindowFor(year: number, month: number, allRoles: ParticipantRole[]): ParticipantRole[] {
  const firstSunday = getDates(year, month, 0)[0];
  if (!firstSunday) return [];
  const noon = (iso: string) => new Date(iso.slice(0, 10) + "T12:00:00").getTime();
  const anchor = noon(firstSunday);
  const start = anchor - SAVED_WINDOW_DAYS * 86_400_000;
  return allRoles.filter(r => {
    const t = noon(r.date);
    return t >= start && t <= anchor;
  });
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
      {/*
        D17: this list used to be `max-h-32 overflow-y-auto` — a keyhole onto up
        to 10 members. The full-width panel D10 buys has room for the whole
        list without a nested scroller.
      */}
      <div className="rounded border border-[#00bfff]/10 divide-y divide-[#00bfff]/5">
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
            <div key={we.id} className="flex flex-wrap gap-1.5 items-center">
              {/*
                `rbSel` bakes in `w-full` for its many full-width callers
                elsewhere in this file. Tailwind emits `.w-full` AFTER `.w-20`
                in the generated stylesheet, so on equal specificity `w-full`
                silently wins the cascade and this select renders at
                container width — an explicit `max-w` is required to actually
                pin it narrow (same reasoning as the pattern selects' cap).
              */}
              <select
                className={`${rbSel} w-20 max-w-[80px] flex-none`}
                value={we.week}
                onChange={e => setWeekEx(ws => ws.map(x => x.id === we.id ? { ...x, week: Number(e.target.value) } : x))}
              >
                {[1,2,3,4,5].map(n => <option key={n} value={n}>Sem {n}</option>)}
              </select>
              {/*
                D-defect-1: this used to be `flex-1` with no cap, so at the
                full-width panel it absorbed all free space and pushed the
                delete button off the card's right edge. Capped and allowed
                to wrap instead — same fix as the Caps row below.
              */}
              <select
                className={`${rbSel} flex-1 min-w-[140px] max-w-[220px]`}
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
            // D-defect-1: at full panel width an unconstrained `flex-1` on the
            // pattern select absorbed all free space, clipping the number
            // input and pushing the sem/delete controls past the card's right
            // edge (no `flex-wrap` either). Capped and wrapped instead of
            // truncated — the row now folds onto a second line rather than
            // spilling out of the card.
            <div key={cap.id} className="flex flex-wrap gap-1.5 items-center">
              <select
                className={`${rbSel} flex-1 min-w-[140px] max-w-[220px]`}
                value={cap.pattern}
                onChange={e => setCaps(cs => cs.map(x => x.id === cap.id ? { ...x, pattern: e.target.value } : x))}
              >
                {PATTERNS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
              {/* Same `w-full`-vs-fixed-width cascade issue as the week select above. */}
              <select
                className={`${rbSel} w-14 max-w-[56px] flex-none`}
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
        {/*
          D17: this list used to be `max-h-28 overflow-y-auto` — the one that
          keyholed all 16 `voz` members. Same fix as `MemberPool` above.
        */}
        <div className="rounded border border-[#00bfff]/10 divide-y divide-[#00bfff]/5">
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

function RuleBuilder({ config, onChange, members, source }: {
  config: SolverConfig;
  onChange: (c: SolverConfig) => void;
  members: MemberOption[];
  /**
   * The WHOLE source state, not a `shared` boolean.
   *
   * A boolean here was the last place `absent` and `error` still collapsed into
   * one another: "no document exists" and "we could not read the document" both
   * answered `false` and both printed the `absent` sentence — which claims, of a
   * document that does exist, that it does not. See the copy at the foot of this
   * component: four states, three sentences, and no state borrowing another's.
   */
  source: SolverConfigSource;
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
      {/*
        The three "add" buttons live in the HEADER, not under the list. The
        default config seeds twelve rules, so at the foot of the section they sat
        below twelve cards inside a scrolling panel and were effectively
        undiscoverable — the reason this section reads as having no way to add a
        rule at all. While a form is open they are disabled rather than hidden:
        a control that vanishes is the same discoverability bug in miniature, and
        switching forms mid-edit would throw away what was typed.
      */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <p className="font-label text-[11px] uppercase tracking-widest text-gray-500">
          Reglas{total > 0 ? ` (${total})` : ""}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-label text-[10px] uppercase tracking-widest text-gray-600">
            Añadir regla
          </span>
          <AddRuleButton
            label="+ Persona"
            title="Restringir a una persona: patrones excluidos, semanas, topes y equidad"
            tone="border-red-500/40 text-red-400 hover:bg-red-500/10"
            disabled={isFormOpen}
            onClick={() => setAdding("restriction")}
          />
          <AddRuleButton
            label="≠ Conflicto"
            title="Impedir que dos personas coincidan en el mismo patrón"
            tone="border-purple-500/40 text-purple-400 hover:bg-purple-500/10"
            disabled={isFormOpen}
            onClick={() => setAdding("conflict")}
          />
          <AddRuleButton
            label="≥1 Presencia"
            title="Exigir al menos una persona de un grupo en el patrón"
            tone="border-green-500/40 text-green-400 hover:bg-green-500/10"
            disabled={isFormOpen}
            onClick={() => setAdding("presence")}
          />
        </div>
      </div>

      {/*
        The add form opens directly UNDER its button. Rendered after the rule
        list it landed ~770px below the click with twelve rules seeded, i.e. off
        screen — pressing "+ Persona" would look like nothing happened.
      */}
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

      {/*
        Where the rules live, and how far they actually reach — said plainly,
        because both are easy to assume wrongly and expensive to discover late.

        1. THE CUTOVER LANDED. The rules are one Sanity document
           (`sanity/schemas/solverConfig.ts`), read through `useSolverConfig`,
           shared by every admin and by both surfaces. `localStorage` is no
           longer read or written for them — only `owt_solver_history_v2`, the
           fairness history, stays per-browser (ADR-0010).
        2. The saved document is what the TABLERO enforces; the edits on this
           screen are not, until "Guardar reglas" lands them. That gap is the
           price of an explicit save (a POST per keystroke would thrash the
           route's `_rev` check and lose edits to its own concurrency guard), so
           it is stated rather than hidden.
        3. Exclusions and conflicts are hard on BOTH surfaces. Week exclusions
           are hard on the grid ONLY — the Tablero edits one service at a time
           and has no Sunday spine, so there is no week to match
           (`ruleEnforcement.ts`, `weekForColumn`). Caps and presence are not
           hard anywhere: they reach CP-SAT for Sundays and Saturdays and
           nothing checks them elsewhere — a special never goes to the solver,
           and neither does a manual pick. All of it stated because a rule that
           looks enforced and is not is worse than one that is plainly not
           offered (`ruleEnforcement.ts` lists both as deliberate non-goals).

        The branch is NOT the old per-browser one wearing new clothes: it is
        `SolverConfigSource`, i.e. what we actually know about the document.
        With no document there is nothing to share and nothing to save, and the
        Tablero enforces nothing (`enforceableConfig`) — so that state gets its
        own sentence rather than a softened version of the other.

        THREE sentences, not two, and this is the point of taking the whole
        source rather than a `shared` boolean: `absent` ("there is no shared
        document") and `error`/`loading` ("we could not read the shared
        document") are different facts, and printing the first while the second
        is true tells an admin their team's rules do not exist — an invitation
        to re-run the seed script or retype the rule set over a document that is
        sitting there intact. `loading` shares the sentence because it is the
        same claim in the present tense, and because it is the state EVERY
        reload passes through: the `absent` copy used to flash there too.
      */}
      {source.status === "ready" ? (
        <>
          <p className="font-body text-[11px] text-gray-500 px-1 pt-1">
            Las reglas se guardan en el <span className="text-[#00bfff]">servidor</span> y las
            comparten todos los administradores. Los cambios de esta pantalla no valen en el{" "}
            <span className="text-gray-400">Tablero</span> hasta que pulses{" "}
            <span className="text-gray-400">Guardar reglas</span>.
          </p>
          <p className="font-body text-[11px] text-gray-500 px-1">
            Se aplican como bloqueo duro los patrones excluidos y los conflictos entre dos personas,
            tanto aquí como al editar un servicio en el{" "}
            <span className="text-gray-400">Tablero</span>. Las{" "}
            <span className="text-gray-400">semanas excluidas</span> solo se verifican aquí: el editor
            del Tablero trabaja sobre un servicio suelto y no sabe en qué semana del mes cae.
          </p>
        </>
      ) : source.status === "absent" ? (
        <p className="font-body text-[11px] text-gray-500 px-1 pt-1">
          Todavía no hay reglas compartidas en el servidor: estas son las de{" "}
          <span className="text-amber-400">ejemplo</span> con las que llega la app y no se pueden
          guardar desde aquí. Mientras tanto, los patrones excluidos y los conflictos se aplican
          como bloqueo duro <span className="text-amber-400">solo aquí</span> — al editar un servicio
          en el <span className="text-gray-400">Tablero</span> no bloquean nada. Las{" "}
          <span className="text-gray-400">semanas excluidas</span> solo se verifican aquí en
          cualquier caso: el editor del Tablero trabaja sobre un servicio suelto y no sabe en qué
          semana del mes cae.
        </p>
      ) : (
        <p className="font-body text-[11px] text-gray-500 px-1 pt-1">
          <span className="text-amber-400">
            {source.status === "error"
              ? "No se pudieron cargar las reglas compartidas del servidor."
              : "Se están cargando las reglas compartidas del servidor."}
          </span>{" "}
          Estas son las reglas que quedaron en pantalla, no necesariamente las que el servidor
          tiene ahora, y no se pueden guardar hasta que vuelvan a cargar. Mientras tanto, los
          patrones excluidos y los conflictos se aplican como bloqueo duro{" "}
          <span className="text-amber-400">solo aquí</span> — al editar un servicio en el{" "}
          <span className="text-gray-400">Tablero</span> no bloquean nada. Las{" "}
          <span className="text-gray-400">semanas excluidas</span> solo se verifican aquí en
          cualquier caso: el editor del Tablero trabaja sobre un servicio suelto y no sabe en qué
          semana del mes cae.
        </p>
      )}
      <p className="font-body text-[11px] text-gray-500 px-1">
        Los <span className="text-gray-400">topes</span> y la{" "}
        <span className="text-gray-400">presencia</span> solo los resuelve el solver en domingos y
        sábados: en servicios especiales y al asignar a mano no se verifican.
      </p>
    </div>
  );
}

/** One "add a rule of this kind" pill, in the `Reglas` header. */
function AddRuleButton({ label, title, tone, disabled, onClick }: {
  label: string;
  title: string;
  tone: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? "Termina la regla que estás editando primero" : title}
      className={`font-label text-[11px] uppercase tracking-widest px-2.5 py-1.5 rounded-full border transition-colors disabled:opacity-30 disabled:hover:bg-transparent ${tone}`}
    >
      {label}
    </button>
  );
}

const MIN_YEAR = 2024;
const MAX_YEAR = 2035;

/**
 * The year field — which never hands out a half-typed year.
 *
 * `min`/`max` on a number input are advisory: they stop no keystroke, so
 * `Number(e.target.value)` sees 2, 20, 202 while "2026" is being retyped, and
 * the WHOLE setup step is derived from that number. `new Date("202-08-01T12:00:00")`
 * is an Invalid Date, so every calendar cell renders `NaN`, every cell's
 * `aria-label` reads "Invalid Date", and clicking one opens the special composer
 * on a date that does not exist.
 *
 * So the FIELD holds the raw text and the YEAR only ever accepts a complete,
 * clamped four-digit value; blur puts the text back in step with what was
 * accepted. Clamping on every keystroke instead — the one-line version — fights
 * the typist: "2027" typed over a selection lands on 2024 at the first digit and
 * cannot recover.
 */
function YearInput({ value, onChange, className }: {
  value: number;
  onChange: (year: number) => void;
  className?: string;
}) {
  const [text, setText] = useState(String(value));
  const complete = (raw: string) => /^\d{4}$/.test(raw);
  const clamp = (n: number) => Math.min(MAX_YEAR, Math.max(MIN_YEAR, n));
  return (
    <input
      className={className}
      type="number"
      value={text}
      min={MIN_YEAR}
      max={MAX_YEAR}
      onChange={e => {
        setText(e.target.value);
        if (complete(e.target.value)) onChange(clamp(Number(e.target.value)));
      }}
      // Whatever is half-typed or out of range becomes the year that was
      // actually accepted, so the field never disagrees with the calendar.
      onBlur={() => setText(String(complete(text) ? clamp(Number(text)) : value))}
    />
  );
}

// ─── Solver config panel ──────────────────────────────────────────────────────

/**
 * The explicit save control — **there was none before the cutover.**
 *
 * Persistence used to be an unconditional effect on every `solverConfig`
 * change. Against a shared server document that shape is not merely wasteful:
 * a POST per keystroke thrashes the route's `_rev` check, so an admin loses
 * their own edits to their own concurrency guard, one race per character.
 *
 * The button is therefore the ONLY writer, and it is reachable only from
 * `ready` — the `rev` a save needs exists on no other state
 * (`SolverConfigSource`), so "the defaults get written over the team's rules"
 * is not a bug to avoid here but a call that cannot be spelled.
 *
 * CLAUDE.md's client-mutation invariant is honoured on both sides: the fetch
 * lives in `useSolverConfig` (try/catch, `res.ok` checked), and this component
 * resets `saving` in a `finally` and reports a failure AS a failure — the
 * edits stay on screen, nothing closes, nothing goes green.
 */
function SolverConfigSaveBar({ config, rules }: {
  config: SolverConfig;
  rules: SolverConfigController;
}) {
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<
    { message: string; stale: boolean; against: SolverConfigSource } | null
  >(null);

  const source = rules.source;
  // A failure describes ONE attempt against ONE observed document. Once the
  // source moves — a reload, or a later successful save — that message is about
  // a world that no longer exists, and leaving "alguien más lo cambió primero"
  // on screen beside a freshly reloaded rule set is its own small lie. Derived
  // rather than cleared in an effect, so there is no render where both are true.
  const error = failure && failure.against === source ? failure : null;
  const rev = source.status === "ready" ? source.rev : null;
  const savedConfig = editableConfig(source);
  // By CONTENT: an edit undone by hand settles back to "Guardado" instead of
  // offering to write a document that would not change.
  const dirty = savedConfig === null || !sameSolverConfig(savedConfig, config);

  const onSave = async () => {
    if (rev === null) return;
    setSaving(true);
    setFailure(null);
    // `useSolverConfig.save` owns its own try/catch and RESOLVES on every
    // failure, so this `try` is an unreachable backstop, not the guard — verified
    // by mutation: unwrapping it (plain `await`, then `setSaving(false)`) fails
    // no test, while deleting the `finally`'s reset fails "reports a FAILURE as a
    // failure". It is kept because CLAUDE.md's client-mutation invariant says the
    // loading flag resets in a `finally`, and a controller that ever rejected
    // would otherwise park this button on "Guardando…" for good.
    try {
      const result = await rules.save(config, rev);
      if (!result.ok) setFailure({ ...result, against: source });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
      {error && (
        <p role="alert" className="font-body text-[11px] text-red-400 mr-auto">
          {error.message}
        </p>
      )}
      {error?.stale && (
        <button
          type="button"
          onClick={rules.reload}
          className="font-label text-[11px] uppercase tracking-widest px-3 py-2 rounded-lg border border-[#00bfff]/30 text-[#00bfff] hover:bg-[#00bfff]/10 transition-colors"
        >
          Recargar reglas
        </button>
      )}
      <button
        type="button"
        onClick={onSave}
        disabled={rev === null || !dirty || saving}
        // `rev === null` is ONE reason the button is dead and THREE different
        // facts about the world. Saying "solo el script de siembra puede
        // crearlas" while a read is merely failing tells an admin the team's
        // rules do not exist, which is how a seed script gets re-run over a
        // document that is sitting there intact. Same distinction the copy at
        // the foot of `RuleBuilder` makes, on the control that acts on it.
        title={
          source.status === "absent"
            ? "Todavía no hay reglas compartidas en el servidor; solo el script de siembra puede crearlas."
            : source.status === "error"
              ? "No se pudieron cargar las reglas compartidas; no se puede guardar hasta que vuelvan a cargar."
              : source.status === "loading"
                ? "Cargando las reglas compartidas…"
                : dirty
                  ? "Guardar estas reglas para todos los administradores"
                  : undefined
        }
        className="font-label text-[11px] uppercase tracking-widest px-3 py-2 rounded-lg border border-[#00bfff]/40 text-[#00bfff] hover:bg-[#00bfff]/10 transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
      >
        {saving ? "Guardando…" : dirty ? "Guardar reglas" : "Guardado"}
      </button>
    </div>
  );
}

/**
 * The rule panel has nothing honest to show — the read has not finished, or it
 * failed.
 *
 * **Never the defaults.** Rendering `DEFAULT_SOLVER_CONFIG` here is the exact
 * collapse `SolverConfigSource` exists to prevent: a transient fetch failure
 * would present a rule set nobody wrote as this team's, and the save control
 * would then offer to make it so. There is no `rev` in either state, so saving
 * is impossible; this says why instead of pretending.
 */
function SolverConfigUnavailable({ source, onReload }: {
  source: SolverConfigSource;
  onReload: () => void;
}) {
  const failed = source.status === "error";
  return (
    <div className="space-y-3 p-3 rounded-xl border border-[#00bfff]/20 bg-[#00bfff]/5">
      <p className="font-label text-[11px] uppercase tracking-widest text-[#00bfff]">Configuración del Solver</p>
      <p role={failed ? "alert" : undefined} className={`font-body text-xs ${failed ? "text-red-400" : "text-gray-500"}`}>
        {failed ? source.message : "Cargando las reglas compartidas…"}
      </p>
      {failed && (
        <button
          type="button"
          onClick={onReload}
          className="font-label text-[11px] uppercase tracking-widest px-3 py-2 rounded-lg border border-[#00bfff]/30 text-[#00bfff] hover:bg-[#00bfff]/10 transition-colors"
        >
          Reintentar
        </button>
      )}
    </div>
  );
}

/**
 * A read that failed (or is in flight) UNDER a panel that already has rules on
 * screen — the state `SolverConfigUnavailable` never sees.
 *
 * Once `solverConfig` holds a rule set it is never dropped back to `null`, so a
 * panel that was `ready` does not fall back to `SolverConfigUnavailable` when a
 * later read fails; it keeps the admin's draft, which is the right call (a
 * transient GET is no reason to discard unsaved work) and was, until this
 * notice existed, completely silent. The concrete path: lose a `_rev` race →
 * take the "Recargar reglas" the conflict message itself offers → the GET fails
 * → the conflict message disappears (correctly — it described a world that is
 * gone) and NOTHING replaces it. The reload reads as having worked.
 *
 * So: an alert, and the retry, above the retained draft.
 */
function SolverConfigReloadNotice({ source, onReload }: {
  source: SolverConfigSource;
  onReload: () => void;
}) {
  if (source.status !== "error" && source.status !== "loading") return null;
  if (source.status === "loading") {
    return <p className="font-body text-xs text-gray-500">Cargando las reglas compartidas…</p>;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p role="alert" className="font-body text-xs text-red-400 mr-auto">
        {source.message}
      </p>
      <button
        type="button"
        onClick={onReload}
        className="font-label text-[11px] uppercase tracking-widest px-3 py-2 rounded-lg border border-[#00bfff]/30 text-[#00bfff] hover:bg-[#00bfff]/10 transition-colors"
      >
        Reintentar
      </button>
    </div>
  );
}

function SolverConfigPanel({ members, config, onChange, rules, history, onRemoveHistory }: {
  members: MemberOption[];
  config: SolverConfig;
  onChange: (c: SolverConfig) => void;
  rules: SolverConfigController;
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

      <SolverConfigReloadNotice source={rules.source} onReload={rules.reload} />

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

      <RuleBuilder
        config={config}
        onChange={onChange}
        members={members.filter(m => m.memberType?.includes("voz"))}
        source={rules.source}
      />

      {/*
        Below the pools AND the rules, because it saves the whole document —
        `sundayLeads`/`saturdayLeads`/`support` as well as the three rule kinds.
        The per-rule "Guardar cambios" buttons inside `RuleBuilder` commit one
        form into local state and have never written anything; this is the write.
      */}
      <SolverConfigSaveBar config={config} rules={rules} />

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

export default function MonthGenerator({
  members, existingRoles, onClose, onCreated, rules, capability, preflight, allRoles,
}: Props) {
  const gateBlocked = capability && !capability.enabled ? capability.reason ?? "Datos incompletos." : null;
  const now = new Date();
  const [step, setStep]           = useState<"config" | "grid">("config");
  const [year, setYear]           = useState(now.getFullYear());
  const [month, setMonth]         = useState(now.getMonth() + 1);
  /**
   * E1's per-date Sunday picker, stored as DESELECTIONS rather than as the
   * selected dates. Two reasons, both bugs the other shape invites:
   *  - a stale date from a month the admin navigated away from can never leak
   *    into `columns` — the selection is always DERIVED by filtering the month's
   *    own `sundayDatesFull` (work item 1a's hazard, from the Sunday side);
   *  - "nothing deselected" is the default without an effect having to seed it.
   * Reset on month change anyway (below), so the two guards are independent.
   */
  const [deselectedSundays, setDeselectedSundays] = useState<string[]>([]);
  const [activeSatDates, setActiveSatDates] = useState<string[]>([]);
  /** E2's weekday specials for THIS month — reset whenever year/month changes. */
  const [specials, setSpecials] = useState<{ date: string; name: string }[]>([]);
  /**
   * The rules ON SCREEN — the fetched document plus whatever the admin has
   * typed since, not yet saved.
   *
   * **`null` is a real state and never means "use the defaults".** It is what
   * the read has not finished, or has failed, looks like; the config step
   * renders `SolverConfigUnavailable` and "Previsualizar →" is gated on it, so
   * the grid can never enforce (or fail to enforce) rules nobody has seen.
   */
  const [solverConfig, setSolverConfig] = useState<SolverConfig | null>(() =>
    editableConfig(rules.source),
  );
  /**
   * The last thing the SERVER said, by identity — a new object on load and on
   * every successful save, and only then. Syncing on it means a save's
   * canonical round trip lands on screen (the write path de-duplicates pools
   * and drops blanks, so what is stored is not always what was typed), without
   * a re-render of the panel silently reverting an edit in progress.
   *
   * **A reload therefore DISCARDS unsaved edits, and that is the stated
   * contract.** It is reachable from exactly two buttons: "Reintentar", in a
   * state where nothing is on screen to lose, and "Recargar reglas" after a
   * lost race — whose message says "recarga las reglas y vuelve a aplicar tu
   * cambio" for this reason. Merging two rule sets is not something to invent
   * silently under an admin who is being told someone else wrote first.
   */
  const loadedConfig = editableConfig(rules.source);
  useEffect(() => {
    if (loadedConfig) setSolverConfig(loadedConfig);
  }, [loadedConfig]);
  /**
   * Why the grid cannot be entered, when the rules are the reason.
   *
   * SEPARATE from `gateBlocked` (Plan B's capability matrix) on purpose: this
   * one gates "Previsualizar →" alone. It does NOT gate creating services — a
   * month can be built entirely by hand and a failed rules read is no reason to
   * refuse that — but the grid is the surface where a rule becomes a hard
   * refusal, and entering it with none would enforce nothing while looking
   * exactly like enforcing everything.
   *
   * Keyed on `solverConfig`, NOT on `source.status`, and that is the difference
   * between "we have no rules" and "we could not re-read the rules". A panel
   * that was `ready` keeps its rule set through a failed reload, so the grid
   * still has something real to enforce and is still entered. Blocking on
   * `source.status === "error"` here would NOT protect grid work either way —
   * `handlePreview` re-checks this same gate at handler entry, and resets
   * `rows`/`cells`/`drafts` on every entry regardless, so there is no work in
   * progress to discard. The actual cost of blocking is AVAILABILITY: an admin
   * who already has a real rule set would be locked out of the planner for as
   * long as one network blip on the reload lasts. And the retained config is a
   * genuine server read — unlike `DEFAULT_SOLVER_CONFIG` in the never-`ready`
   * case, this is not a fabricated rule set — while the Tablero already
   * enforces nothing in this state (`enforceableConfig`), so the grid keeping
   * last-known-good is strictly more enforcement than that surface gets. What
   * this state owes the admin is to SAY the read failed
   * (`SolverConfigReloadNotice`, and the third branch of the copy in
   * `RuleBuilder`), not to lock the surface.
   */
  const rulesBlocked =
    solverConfig === null
      ? rules.source.status === "error"
        ? rules.source.message
        : "Cargando las reglas compartidas…"
      : null;
  const [solverHistory, setSolverHistory] = useState<SolverHistoryEntry[]>([]);
  const [unavailabilityNotices, setUnavailabilityNotices] = useState<{ name: string; date: string; service: string }[]>([]);

  // ── Grid state (Task 2/3's shape; `MonthGenerator` owns it per the brief) ──
  const [rows, setRows]           = useState<GridRow[]>(() => buildRows());
  const [cells, setCells]         = useState<GridCell[]>([]);
  const [skippedDates, setSkippedDates] = useState<Set<string>>(new Set());
  const [drafts, setDrafts]       = useState<DraftCard[]>([]);
  /**
   * **P2: the one thing standing between a rename and a duplicate
   * `special_role`.** The TARGETS (`draftTargetKey` — `type__date`, the same
   * string `cellsToDrafts` keys identity by) this dialog instance has itself
   * confirmed-created, across every confirm it makes.
   *
   * Session-scoped: never persisted, never derived from props, so an
   * `existingRoles` refresh after `onCreated()` can neither pollute it nor
   * erase it.
   *
   * **Keyed by target, NOT by `localId`.** `handlePreview` rebuilds the drafts
   * with `previous: []`, which re-mints every `localId`, so a `localId`-keyed
   * set goes blind the moment the admin walks "← Volver → rename → Previsualizar
   * →" — precisely the path that produces a second document on the same date.
   *
   * **And never `d.exists`.** `exists` survives a rename while `isExisting`
   * does not, and after `onCreated()` refreshes `existingRoles` a date this
   * session created is indistinguishable from one that predates it. Reading
   * either here would refuse a legitimately-new special ("Crear 0 borradores",
   * no error, no explanation) or miss the duplicate outright.
   */
  const createdTargets = useRef<Set<string>>(new Set());
  const [unresolvedNames, setUnresolvedNames] = useState<string[]>([]);
  const [unfilled, setUnfilled]   = useState<{ date: string; rowId: string }[]>([]);
  const [diagnostics, setDiagnostics] = useState<SolveDiagnostics | null>(null);
  const [autoPending, setAutoPending] = useState(false);
  const [autoError, setAutoError]     = useState<string | null>(null);

  const [viewMode, setViewMode]   = useState<"edit" | "view">("edit");
  const [swapSel, setSwapSel]     = useState<string | null>(null);
  const [swapToast, setSwapToast] = useState<string | null>(null);
  // Shared by "← Volver" and Escape (below): the ONE state that gates
  // discarding grid work, naming which action is pending so the two exits
  // can never end up with different rules about what counts as "unsaved" —
  // see `assignmentCount` and the effect below.
  const [pendingDiscard, setPendingDiscard] = useState<"back" | "close" | null>(null);
  const [pushing, setPushing]     = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  /**
   * Total occupied seats across the whole grid — what "← Volver" (and Escape,
   * via the shared `pendingDiscard` guard below) would discard. Counted as
   * assignment SLOTS (one person in two seats counts twice), matching what
   * the admin would actually have to redo. Computed up here, ahead of both
   * effects that read it, rather than down near the JSX that used to be its
   * only reader.
   */
  const assignmentCount = cells.reduce((n, c) => n + c.memberIds.length, 0);

  /**
   * Every per-date pick is scoped to ONE (year, month) and is dropped when
   * either changes (work item 1a). The shipped code already guarded exactly
   * this for Saturdays; the calendar adds two more date-bearing states and both
   * need the same treatment.
   *
   * Without the `specials` reset: pick August, add "Bautizos" on 2026-08-12,
   * switch to September — `buildColumns` emits an August-dated column among the
   * September ones, INVISIBLE on the now-September calendar, and `handleConfirm`
   * posts it. The date is well-formed so the server accepts it and a
   * `special_role` is created for a month the admin navigated away from.
   * `buildColumns`' dedupe is per-date and does not catch it; nothing does.
   */
  useEffect(() => {
    setActiveSatDates(getDates(year, month, 6));
    setDeselectedSundays([]);
    setSpecials([]);
  }, [year, month]);

  /**
   * D10: moving out of `CueDialog` into a full-width panel silently dropped
   * Escape-to-close (along with the focus trap and `aria-modal`, which
   * `CueDialog` also provided). Escape-to-close is restored here, matching
   * `ServiceReadinessCard`'s kebab menu (`document.addEventListener("keydown", …)`).
   * A full focus trap is judged OUT OF SCOPE: `CueDialog` traps focus because
   * it is an overlay stacked on top of still-present page content the user
   * must not tab into; this panel instead REPLACES the whole `ServicesPanel`
   * view (see the early `return` in `ServicesPanel.tsx`), so there is no
   * "content behind it" a trap would be protecting against — the only thing
   * above it in the tab order is the app's own header/nav, same as any other
   * full page. Focus-return-to-opener is handled by `ServicesPanel`, which
   * owns the "Generar mes" trigger button this panel itself has no reference to.
   *
   * Escape must NOT bypass the same discard guard "← Volver" uses: pools and
   * rules live on the config step while Auto lives on the grid step, so the
   * config<->grid round trip is common, and the grid holds real manual
   * effort. `ServicesPanel` unmounts this component on `onClose`, so a bare
   * `onClose()` here would let one keystroke silently destroy a month of
   * hand-assigned cells — the exact loss "← Volver" confirms before allowing.
   * Gated on `step === "grid"` because `assignmentCount` only reflects real,
   * currently-visible grid work while on that step; on "config" there is
   * nothing on screen for Escape to discard.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (step === "grid" && assignmentCount > 0) { setPendingDiscard("close"); return; }
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, step, assignmentCount]);

  useEffect(() => {
    // ─── The rule set is NOT read here any more ──────────────────────────────
    //
    // Before the cutover this effect hydrated `solverConfig` from
    // `owt_solver_config_v3`, and a second effect wrote every change straight
    // back. Both are gone, in the SAME change that landed the fetch, because
    // they could not coexist with it: both call `setSolverConfig`, so the
    // fetched document would have been mirrored into `localStorage` and the
    // load order — different on a cold load than on a re-render — would have
    // decided which rule set won.
    //
    // `owt_solver_history_v2` below stays per-browser on purpose (ADR-0010):
    // P6 shares the RULES, not the fairness history.
    try {
      const hist = localStorage.getItem(HISTORY_KEY);
      if (hist) setSolverHistory(JSON.parse(hist) as SolverHistoryEntry[]);
    } catch {}
  }, []);

  function saveHistoryEntry(y: number, m: number, total_counts: Record<string, number>, role_counts: Record<string, Record<string, number>>) {
    const key = `${y}-${m}`;
    setSolverHistory(prev => {
      const next = [
        ...prev.filter(h => h.key !== key),
        { key, year: y, month: m, total_counts, role_counts },
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

  // Unconditional (D9/E21): the solve always addresses the full month's
  // Sundays — only RENDERING/CREATION is gated by `columns` below.
  const sundayDatesFull = useMemo(() => getDates(year, month, 0), [year, month]);

  /**
   * **E21's whole point.** The calendar's Sunday picks are a RENDER/CREATE
   * filter, never a spine. Exactly one consumer takes them as its Sunday list
   * — `buildColumns` — plus `mapUnfilledSeats`, which takes them as a separate
   * FOURTH argument purely to discard markers for columns that aren't on
   * screen. All four spine consumers keep receiving `sundayDatesFull`:
   * `buildSolveRequest`, `applySolveResponse`, `computeUnaddressableDates` and
   * `mapUnfilledSeats`' 2nd argument. (`ruleEnforcement` used to be named here
   * and never belonged: it is reached only from `candidateRanking`, is not
   * imported by this file, and takes no Sunday list at all.)
   *
   * The reason is that the week number is POSITIONAL over the full month's
   * Sunday list. Feed the selected subset to the spine and week 3 stops meaning
   * the third Sunday: the seeded week-1/week-3 exclusions land on the wrong
   * dates and produce rosters that silently violate stated rules, or the solve
   * 400s outright below three Sundays.
   *
   * All four are pinned in `MonthGenerator.create.test.tsx` — swapping any one
   * of them for `selectedSundays` fails a test there.
   */
  const selectedSundays = useMemo(
    () => sundayDatesFull.filter(d => !deselectedSundays.includes(d)),
    [sundayDatesFull, deselectedSundays],
  );

  // D9's EXPLICIT column set — never inferred from `sundayDatesFull`.
  const columns = useMemo(
    () => buildColumns({ sundayDates: selectedSundays, activeSatDates, specials }),
    [selectedSundays, activeSatDates, specials],
  );

  const unaddressableDatesList = useMemo(
    () => computeUnaddressableDates(sundayDatesFull, activeSatDates),
    [sundayDatesFull, activeSatDates],
  );

  const savedWindow = useMemo(
    () => savedWindowFor(year, month, allRoles ?? []),
    [year, month, allRoles],
  );

  /**
   * The SAVED half of the participation rail: D12's lookback window PLUS
   * anything already stored in the month being planned.
   *
   * `savedWindow` on its own is the wrong baseline here, even though it is the
   * right one for ranking. It ends AT the month's first Sunday, so services the
   * admin saved earlier in this same month — half a month generated last week,
   * a special created by hand — would be invisible to a panel whose whole job is
   * "is this month's load fair". Ranking can afford that (it measures a rolling
   * recent load); a fairness read-out cannot.
   *
   * Filtered from `allRoles` in ONE pass and compared by object identity against
   * `savedWindow`, rather than concatenating two lists and de-duplicating them:
   * `ParticipantRole` has no `_id` and no `service_name`, so any key built from
   * its fields would collapse two same-day specials into one.
   */
  const participationSaved = useMemo(() => {
    const inWindow = new Set(savedWindow);
    const prefix = `${year}-${String(month).padStart(2, "0")}`;
    return (allRoles ?? []).filter(r => inWindow.has(r) || r.date.slice(0, 7) === prefix);
  }, [allRoles, savedWindow, year, month]);


  /**
   * Two independent sources of "this name matches nobody", MERGED — never one
   * replacing the other.
   *
   *  • `unresolvedNames` (state) is what the SOLVER's response named and
   *    `applySolveResponse` could not resolve. It exists only after a solve.
   *  • `unresolvedRuleNames` reads the admin's own rules, right now, with no
   *    solve having run at all.
   *
   * The second is the only one a SPECIAL ever gets: no solve runs there, so a
   * conflict naming a person who no longer exists would enforce nothing, seat
   * the pair the admin wrote a rule to separate, and report a perfectly normal
   * auto-fill. Replacing rather than merging would also mean a solve wiped the
   * rule report, or the rule report hid the solver's — each hiding the other on
   * exactly the screen that needs both.
   *
   * Deduplicated case-insensitively, solver names first (they belong to the run
   * the admin just triggered), each string kept as it was written.
   */
  const allUnresolvedNames = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    // No config loaded ⇒ no rules to check names against. NOT an empty config:
    // there is nothing to report, rather than nothing to report ABOUT.
    const ruleNames = solverConfig ? unresolvedRuleNames(solverConfig, members) : [];
    for (const name of [...unresolvedNames, ...ruleNames]) {
      const key = name.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
    return out;
  }, [unresolvedNames, solverConfig, members]);

  /**
   * Per-target A1/A2 observation for every drafted target, snapshotted at
   * render time. This is a SNAPSHOT, not a live lookup: it only recomputes
   * when `drafts` (or the `preflight` function identity) changes, so a source
   * that fails while this dialog is open and no React render has happened
   * since (e.g. between "Previsualizar →" and the very next click) is caught
   * by `handleConfirm`'s explicit FRESH re-check below, not silently reflected
   * here. Losing this snapshot (calling `preflight` live everywhere) would
   * make the confirm-time re-check a no-op — the "preview-time" and
   * "confirm-time" observations would always be identical, since a plain
   * function call has no notion of when it was last read.
   */
  const preflights = useMemo(() => {
    const map = new Map<string, TargetPreflight>();
    if (!preflight) return map;
    for (const draft of drafts) map.set(draft.localId, preflight(draft._type, draft.date));
    return map;
  }, [drafts, preflight]);

  /**
   * **THE create-gate predicate — one definition, three consumers.** It used to
   * be written out three times (`candidates` in `handleConfirm`, `toCreate` and
   * `notCreatable` at render), which is how a fix can land on the post path and
   * miss the buttons: `toCreate` gates BOTH "Crear N borrador(es)" (its label
   * AND its disabled state) and "Crear y publicar", so a draft this dialog has
   * already created but which still passes `toCreate` produces a live button
   * offering to create something `handleConfirm` will then decline to post —
   * and `handleConfirm`'s `if (!toCreateNow.length) return` sets no
   * `pushError`, so the admin is told nothing at all. Three surfaces, three
   * different answers. Deriving all three from this one function is what makes
   * that state unrepresentable.
   *
   * The three refusals, in order:
   *  - `skipped`: the admin's own Omitir toggle, or a stored document already
   *    occupying this exact target (`cellsToDrafts`).
   *  - `createdTargets`: THIS session already created this target. The only
   *    signal that survives a rename (`previous: []` re-mints `localId`) and an
   *    `existingRoles` refresh (`exists`/`isExisting` both go untrustworthy),
   *    and the only defence against a second `special_role` on a date — the
   *    preflight's special branch is name-blind and can answer nothing but
   *    `creatable` (`serviceCardModel.ts`).
   *  - the A1/A2 preflight when there is one; `!d.exists` only as the
   *    standalone dialog's fallback, where it also carries the retry semantics
   *    (a failed draft keeps `exists: false` and stays postable).
   */
  function isCreatable(d: DraftCard): boolean {
    if (d.skipped) return false;
    if (createdTargets.current.has(draftTargetKey(d._type, d.date))) return false;
    return preflight ? preflights.get(d.localId)?.state === "creatable" : !d.exists;
  }

  function requestBack() {
    if (assignmentCount > 0) { setPendingDiscard("back"); return; }
    goBackToConfig();
  }

  function goBackToConfig() {
    setPendingDiscard(null);
    setStep("config");
    setSwapSel(null);
  }

  function handlePreview() {
    // Preview re-check: never build a roster/date preview from an incomplete
    // inventory (a missing source is not "no existing service"). Mirrors
    // today's guard at the old `handlePreview` (:1226-1228) — Auto is not the
    // only thing `gateBlocked` refuses.
    if (gateBlocked) return;
    // The grid is where the rules become HARD BLOCKS, so it must never be
    // entered without them. Same predicate as the button's `disabled` below,
    // re-checked at handler entry rather than trusted from render.
    if (rulesBlocked) return;
    // "NO COLUMNS AT ALL" — not "no Sundays and no Saturdays". A month whose
    // only service is a weekday special is exactly what E2 exists for, and a
    // weekend-only predicate here (or on the button below) would leave that
    // capability dead on the main gate with no message. `columns` already
    // counts specials, so the two gates ask the same question the grid answers.
    if (columns.length === 0) return;

    setUnavailabilityNotices(
      buildUnavailabilityNotices(selectedSundays, activeSatDates, specials, members),
    );
    setRows(buildRows());
    setCells([]);
    setSkippedDates(new Set());
    setUnresolvedNames([]);
    setUnfilled([]);
    setDiagnostics(null);
    setAutoError(null);
    setDrafts(cellsToDrafts([], columns, new Set(), [], existingRoles));
    setStep("grid");
  }

  function handleCellsChange(next: GridCell[]) {
    setCells(next);
    setDrafts(prev => cellsToDrafts(next, columns, skippedDates, prev, existingRoles));
  }

  function handleToggleSkip(date: string) {
    setSkippedDates(prev => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date); else next.add(date);
      setDrafts(prevDrafts => cellsToDrafts(cells, columns, next, prevDrafts, existingRoles));
      return next;
    });
  }

  /** Whole-day swap, carried over as a COLUMN swap (2026-07-30 decision):
   *  pick two date columns and exchange every row's cell between them. */
  function handleColumnSwap(date: string) {
    if (!swapSel) { setSwapSel(date); return; }
    if (swapSel === date) { setSwapSel(null); return; }
    const a = swapSel;
    const b = date;
    // A Sunday column and a Saturday column have different seats (a Saturday
    // has no Coro row at all in the write path — `cellsToDrafts` zeroes
    // `chorus` for `saturday_role` unconditionally). Swapping across types
    // would carry a Coro cell onto a Saturday and lose it silently on create,
    // under a success toast with no warning. Refuse instead.
    const typeOf = (d: string) => columns.find(c => c.date === d)?.type;
    const typeA = typeOf(a);
    const typeB = typeOf(b);
    // P4: a special is never swappable, not even with another special. The swap
    // exchanges CELLS between two date columns and moves nothing else — the
    // `service_name` stays with its date (it comes from `specials`, which this
    // handler does not touch). So "swap Bautizos with Vigilia" would silently
    // leave each roster under the other service's name, which is the opposite
    // of what the admin just asked for. Checked BEFORE the cross-type refusal
    // below so a special↔weekend attempt names the more specific reason.
    if (typeA === "special_role" || typeB === "special_role") {
      setSwapSel(null);
      setSwapToast("No se puede intercambiar un servicio especial: su nombre se queda en su fecha.");
      setTimeout(() => setSwapToast(null), 2500);
      return;
    }
    if (typeA !== typeB) {
      setSwapSel(null);
      // Named from the shared `SERVICE_LABEL`, not hardcoded: specials are
      // columns now, so "Domingo con un Sábado" was about to become wrong copy
      // on a real refusal. For the Sunday/Saturday pair it reads identically.
      setSwapToast(
        `No se puede intercambiar un ${typeA ? SERVICE_LABEL[typeA] : "servicio"} con un ${typeB ? SERVICE_LABEL[typeB] : "servicio"}.`,
      );
      setTimeout(() => setSwapToast(null), 2500);
      return;
    }
    const byRowA = new Map(cells.filter(c => c.date === a).map(c => [c.rowId, c]));
    const byRowB = new Map(cells.filter(c => c.date === b).map(c => [c.rowId, c]));
    const rowIds = new Set([...byRowA.keys(), ...byRowB.keys()]);
    const next = cells.filter(c => c.date !== a && c.date !== b);
    for (const rowId of rowIds) {
      const ca = byRowA.get(rowId);
      const cb = byRowB.get(rowId);
      if (cb) next.push({ ...cb, date: a });
      if (ca) next.push({ ...ca, date: b });
    }
    setCells(next);
    setDrafts(prev => cellsToDrafts(next, columns, skippedDates, prev, existingRoles));
    setSwapSel(null);
    setSwapToast(`⇄ ${fmtDate(a)} ↔ ${fmtDate(b)}`);
    setTimeout(() => setSwapToast(null), 2500);
  }

  /**
   * E5's LOCAL fill for every `special_role` column, merged into all three
   * pieces of grid state.
   *
   * A special is never sent to CP-SAT (E4/E5), so this is the ONLY thing that
   * auto-fills one — and the only thing that keeps a forbidden pair apart while
   * doing it (`localFill.ts`). It is a different mechanism from the solver, not
   * an extension of it: greedy, single-column, no caps, no backtracking.
   *
   * **All three setters, at every exit.** `handleAuto` writes cells directly
   * rather than routing through `handleCellsChange`, so a caller that sets
   * `cells` and forgets `drafts` renders a populated special in the grid while
   * posting an EMPTY document. And `setUnfilled` must MERGE: `mapUnfilledSeats`
   * resolves a date only through the Sunday spine or `saturdayForWeek`, so a
   * weekday special's date is unreachable through it by construction — the
   * filler's own report is the only channel a special's empty seat has.
   *
   * **Every `special_role` column, `skippedDates` and `isExisting` included —
   * deliberately, and reviewed.** A skipped or already-existing special is
   * filled like any other, so the grid renders auto seats for a service that
   * will never be created and those seats count as load against the month's
   * OTHER specials (`cellsToParticipantRoles` iterates every column). Weighed
   * and kept, for four reasons:
   *
   *  1. `applySolveResponse` writes the solver's roster into every weekend
   *     column with a week, skipped and existing alike (`plannerModel.ts:693`).
   *     Guarding here alone would make Auto behave differently for a skipped
   *     Sunday than for a skipped special, with nothing on screen to explain it.
   *  2. Nothing wrong reaches Sanity: `cellsToDrafts` marks the draft `skipped`
   *     for both reasons and `handleConfirm` posts no skipped draft. The column
   *     header is dimmed and already says *why* it will not be created.
   *  3. The load argument does not favour skipping. An existing mid-month
   *     service's REAL assignments are unavailable to the grid — `savedWindowFor`
   *     ends at the month's FIRST SUNDAY and `existingRoles` carries collision
   *     refs, no people — so skipping trades "five invented people carry load"
   *     for "nobody carries load". A different wrong number, not a right one.
   *  4. `skippedDates` is a live toggle and this runs once, at Auto. A guard
   *     would only bite on skips made BEFORE Auto; a skip made after would leave
   *     the seats standing anyway. A half-working guard reads as a bug.
   *
   * If the weekend path ever learns to respect a skip, this must follow it.
   *
   * @param baseCells the array the fill starts from. On the SUCCESS path this
   *   must be `applied.cells` — passing the pre-solve `cells` here discards the
   *   entire weekend solve that was just committed.
   * @param solverUnfilled the solve's own unfilled seats, present on the success
   *   path only. Absent ⇒ this is a failure exit, and the previous run's
   *   special entries are dropped (by date) before the new ones are appended, so
   *   pressing Auto twice cannot double-count the same empty seat.
   */
  function applySpecialFill(
    config: SolverConfig,
    baseCells: GridCell[],
    solverUnfilled?: { date: string; rowId: string }[],
  ) {
    const specialDates = new Set(
      columns.filter(c => c.type === "special_role").map(c => c.date),
    );
    let next = baseCells;
    const filled: { date: string; rowId: string }[] = [];
    for (const column of columns) {
      if (column.type !== "special_role") continue;
      // Fed the ACCUMULATED cells, so the second special of a month ranks
      // against the load the first one just created (`cellsToParticipantRoles`
      // iterates `columns`), instead of re-picking the same people.
      const out = fillColumn({
        column,
        columns,
        rows,
        cells: next,
        members,
        savedWindow,
        config,
      });
      next = out.cells;
      filled.push(...out.unfilled);
    }
    setCells(next);
    setUnfilled(prev => [
      ...(solverUnfilled ?? prev.filter(u => !specialDates.has(u.date))),
      ...filled,
    ]);
    setDrafts(prev => cellsToDrafts(next, columns, skippedDates, prev, existingRoles));
  }

  /**
   * Auto — the ONLY caller of `/api/admin/solve` (D13). Owns the fetch per
   * CLAUDE.md's client-mutation invariant: try/catch/finally, check `res.ok`,
   * reset the loading flag in `finally`, never close-as-success on failure. A
   * short-staffed month returning `ok:false` is the solver's NORMAL failure
   * (D15), not an edge case.
   *
   * It is also the only caller of `applySpecialFill`, which runs at EVERY exit
   * — the solve failing has no bearing on a special, which was never sent.
   */
  async function handleAuto() {
    // The rules must be LOADED before anything solves or fills.
    //
    // **This refusal is an UNREACHABLE BACKSTOP, not the enforcement.**
    // `solverConfig` starts at `editableConfig(rules.source)` and is only ever
    // re-set to a non-null value, so it never returns to `null` once it holds a
    // rule set; and while it IS `null`, `rulesBlocked` disables "Previsualizar
    // →" and `handlePreview` re-checks it at handler entry, so the grid this
    // button lives on cannot be reached. Verified by mutation: replacing the
    // whole branch with `solverConfig ?? DEFAULT_SOLVER_CONFIG` fails no test.
    // It is kept because this function is the only caller of
    // `/api/admin/solve` and of `applySpecialFill`, and the alternative it
    // guards against is the cutover's headline failure — an Auto run against
    // rules nobody has seen, seating people a hard block exists to keep apart,
    // under a normal success toast. The line that must never be weakened is
    // `rulesBlocked`, which is what actually keeps the grid shut.
    const config = solverConfig;
    if (!config) {
      setAutoError("No se pudieron cargar las reglas compartidas. Recárgalas antes de usar Auto.");
      return;
    }
    const built = buildSolveRequest({
      config,
      members,
      sundayDates: sundayDatesFull,
      activeSatDates,
      historyEntries: solverHistory,
      year,
      month,
    });
    if (!built.ok) {
      // Pre-flight refusal (fact 14) — never reaches the network. EXIT 1, and
      // the one E5 names outright: "a month with no Sunday leads must still
      // fill its specials". The specials never needed the solver.
      setAutoError(built.reason);
      applySpecialFill(config, cells);
      return;
    }

    setAutoPending(true);
    setAutoError(null);
    try {
      const res = await fetch("/api/admin/solve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(built.request),
      });
      let response: SolveResponse | null = null;
      if (res.ok) {
        response = await res.json();
      }
      if (!res.ok || !response || !response.ok || !response.schedule) {
        // EXIT 2 — the solver answered, and said no. A short-staffed month is
        // the solver's NORMAL failure (D15); the specials still fill.
        setAutoError(response?.error ?? "El solver no encontró solución.");
        applySpecialFill(config, cells);
        return;
      }

      const applied = applySolveResponse({
        response,
        previousCells: cells,
        columns,
        rows,
        sundayDates: sundayDatesFull,
        activeSatDates,
        members,
      });
      setUnresolvedNames(applied.unresolvedNames);
      setDiagnostics({
        fairness_relaxed: response.fairness_relaxed,
        sun_lead_fairness_relaxed: response.sun_lead_fairness_relaxed,
        sun_bgv_fairness_relaxed: response.sun_bgv_fairness_relaxed,
        history_runs_used: response.history_runs_used,
      });
      // EXIT 3 — success. `applied.cells`, never the pre-solve `cells`: the
      // latter would throw away the weekend roster this call just produced.
      // `applySpecialFill` owns all three of `setCells`/`setUnfilled`/`setDrafts`
      // from here, so the special seats and the solver's own cannot diverge.
      //
      // `sundayDatesFull` resolves the solver's positional week number (E21);
      // `selectedSundays` then filters the result down to columns that exist —
      // otherwise an unfilled marker from a week that was never staffed renders
      // on a date the admin deselected, or on a column that is now a special.
      applySpecialFill(
        config,
        applied.cells,
        mapUnfilledSeats(response.unfilled_seats ?? [], sundayDatesFull, activeSatDates, selectedSundays),
      );
      // Fairness history is NOT persisted here — a solve merely proposes a
      // schedule. Recording it now would count services that may never be
      // created (close the panel without confirming and next month's solve
      // would still be penalised for them). `handleConfirm` below persists it
      // instead, derived from whatever the create batch actually committed.
    } catch {
      // EXIT 4 — the network threw. A throw is a solve failure like any other,
      // and E5 says the specials fill even when the solve fails; exits 1 and 2
      // both satisfy a loosely-written test and neither reaches this line.
      setAutoError("Error de red al llamar al solver.");
      applySpecialFill(config, cells);
    } finally {
      setAutoPending(false);
    }
  }

  async function handleConfirm(publish: boolean) {
    // Confirmation re-check: a source that failed since the preview blocks the
    // whole post rather than creating against a stale observation.
    if (gateBlocked) { setPushError(gateBlocked); return; }

    // The SHARED predicate — same one `toCreate` and `notCreatable` use below,
    // so the button's label, the button's enabled state and what actually gets
    // posted can never disagree.
    const candidates = drafts.filter(isCreatable);

    // Work item 9: a nameless special is a guaranteed `400 invalid_request`
    // (`canonicalizeCreatePayload` files issue "service_name" for a
    // `special_role` whose name normalizes to empty), and `runDraftCreateBatch`
    // would report it as an anonymous "no se pudo crear" among the rest. The
    // admin can fix it in one action — name it — so say that instead of posting
    // it. Normalized through the SAME `normalizeLabel` the server validates
    // with, never a bare `.trim()`, so client and server agree on what "empty"
    // means. A second lock: `MonthCalendar`'s composer already refuses to ADD a
    // nameless special (`submitSpecial`), which is why this guard is stated as
    // a pure predicate and pinned there rather than through the calendar.
    const nameless = candidates.filter(namelessSpecial);
    if (nameless.length > 0) {
      setPushError(
        `${nameless.length} servicio(s) especial(es) no tienen nombre. Ponles nombre antes de crear.`,
      );
      return;
    }

    let toCreateNow = candidates;
    if (preflight) {
      // Re-observe every candidate NOW: a target that stopped being `creatable`
      // while this dialog was open is never posted, and a changed observation
      // aborts the batch instead of racing A2's create preflight.
      const fresh = candidates.map(d => ({ draft: d, result: preflight(d._type, d.date) }));
      const stillCreatable = new Set(
        creatableTargets(fresh.map(f => f.result)).map(r => r.targetKey),
      );
      toCreateNow = fresh.filter(f => stillCreatable.has(f.result.targetKey)).map(f => f.draft);
      const dropped = candidates.length - toCreateNow.length;
      if (dropped > 0) {
        setPushError(
          `${dropped} fecha(s) dejaron de estar disponibles para crear. Revisa la vista previa y vuelve a intentar.`,
        );
        return;
      }
    }
    // Silent by design, and now UNREACHABLE from an enabled button: `candidates`
    // and `toCreate` are the same predicate, so an empty `candidates` means both
    // Crear buttons were already disabled and this handler was never entered by
    // a click. The only way past it is the preflight re-check above, which
    // returns with its own `pushError` first. This used to be the exit for
    // "the button offered a create the confirm path had already ruled out" —
    // pressed, told nothing, given nothing.
    if (!toCreateNow.length) return;
    setPushing(true);
    setPushError(null);
    let result;
    try {
      // Each draft POSTs its own stable creationRequestId, so a retry after a
      // lost response replays idempotently instead of creating a duplicate.
      result = await runDraftCreateBatch({
        drafts: toCreateNow,
        published: publish,
        post: async (body) => {
          const res = await fetch("/api/admin/roles", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          let error: string | undefined;
          if (!res.ok) {
            try {
              error = (await res.json())?.error;
            } catch {
              error = undefined;
            }
          }
          return { ok: res.ok, status: res.status, error };
        },
      });
    } finally {
      setPushing(false);
    }
    // Mark only confirmed successes as existing, so a retry re-attempts exactly
    // the failed/unknown drafts — with their original request ids.
    const created = new Set(result.createdLocalIds);
    if (created.size) setDrafts(prev => prev.map(d => created.has(d.localId) ? { ...d, exists: true } : d));
    // Accumulate this confirm's successes into the SESSION-scoped ref, keyed by
    // TARGET (see `createdTargets`). This is the write that closes P2: from
    // here on `isCreatable` refuses every one of these targets, so no second
    // confirm — and no rename in between — can post them again.
    for (const draft of toCreateNow) {
      if (created.has(draft.localId)) createdTargets.current.add(draftTargetKey(draft._type, draft.date));
    }
    // Fairness history is recomputed from the UNION of what this batch just
    // created and what this dialog session has created across ALL its
    // confirms — never from `d.exists`. `d.exists` conflates two different
    // things: "created by this session" (should count) and "existed before
    // this session, surfaced via the `existingRoles` prop" (must not count —
    // this generator didn't create it, so it must never take credit for its
    // seats). Those look identical on a `DraftCard` once `onCreated()` →
    // `loadSources()` → `setRoles(...)` refreshes `existingRoles`: a partial
    // failure leaves the dialog open, the prop refresh lands mid-session, and
    // the dates THIS session just created become `isExisting` too. A grid
    // interaction after that re-runs `cellsToDrafts` with the refreshed prop
    // and `d.exists` is then true for both old and new dates alike — there is
    // no way to tell them apart from the draft alone. `createdTargets` is
    // the one signal that survives the refresh, because it is never derived
    // from props: it only grows when THIS component instance's own confirms
    // succeed. Recomputing the whole month's union on every confirm and
    // replacing is idempotent — it reconstructs the same entry a single
    // successful confirm would have written, however many partial retries it
    // took to get there. A fully failed batch with no prior successes records
    // nothing; `historyEntryFromDrafts` returns `null` for an empty list, so
    // this stays a no-op either way.
    //
    // **P1's SECOND LOCK: no `special_role` ever reaches the fairness history.**
    // The first is `HISTORY_ROLE_KEYS`' all-null entry for `special_role`
    // (`plannerModel.ts`), which zeroes a special's seats. That alone is not
    // enough: `historyEntryFromDrafts` only returns `null` for an EMPTY list, so
    // a special-only confirm hands it a non-empty list and gets back a real
    // entry with empty counts — and `saveHistoryEntry` replaces by
    // `${year}-${month}`, so creating one Vigilia would WIPE that month's real
    // Sunday counts and consume one of the six `MAX_HISTORY` slots
    // `buildSolveRequest` feeds the solver. Filtering here means
    // `saveHistoryEntry` is not called at all on a special-only confirm.
    const historyDrafts = drafts.filter(d =>
      d._type !== "special_role" &&
      (created.has(d.localId) || createdTargets.current.has(draftTargetKey(d._type, d.date))),
    );
    const entry = historyEntryFromDrafts(historyDrafts, members, year, month);
    if (entry) saveHistoryEntry(entry.year, entry.month, entry.total_counts, entry.role_counts);
    // Refresh so the list reflects whatever actually got created.
    onCreated();
    if (result.failed.length === 0) {
      onClose();
    } else {
      // Keep the dialog open and report the partial failure instead of closing
      // as if the whole month was created successfully.
      const conflicts = result.failed.filter(f => f.status === 409).length;
      setPushError(
        `No se pudieron crear ${result.failed.length} de ${toCreateNow.length} servicios.` +
        (conflicts ? " Alguien más cambió esas fechas: recarga y revisa." : " Intenta de nuevo."),
      );
    }
  }

  // All three derive from `isCreatable` — see its doc comment for why writing
  // the predicate out again here is the specific bug this shape prevents.
  // `toCreate` gates both footer buttons AND the "Crear N borrador(es)" label;
  // `notCreatable` is its exact complement among non-skipped drafts, so nothing
  // can fall between them and go uncounted.
  const toCreate = drafts.filter(isCreatable);
  const skippedCount = drafts.filter(d => d.skipped).length;
  const notCreatable = drafts.filter(d => !d.skipped && !isCreatable(d)).length;

  /**
   * The participation rail's draft half — the SAME `isCreatable` verdict the
   * footer buttons use, not the columns on screen.
   *
   * Both fillers seat people into columns that will never be created (see
   * `applySpecialFill`'s comment and `applySolveResponse`'s unconditional
   * loop). Feeding those to the panel would report invented people as serving
   * and — where the column exists because a REAL service already occupies that
   * date — let the invention displace the real roster `participationSaved`
   * carries. Derived here, beside `toCreate`, so the two can never disagree
   * about what this grid is going to create.
   *
   * Plain consts, not `useMemo`: `drafts.filter(...)` above already allocates a
   * new array every render, so a memo keyed on it would recompute every time
   * anyway while reading as though it did not.
   */
  const creatingKeys = new Set(toCreate.map(d => `${d._type}|${d.date.slice(0, 10)}`));
  const creatableColumns = columns.filter(c => creatingKeys.has(`${c.type}|${c.date.slice(0, 10)}`));
  const participationRoles = plannerParticipationRoles({
    saved: participationSaved,
    creatableColumns,
    cells,
    members,
  });

  /**
   * E17's missing channel. `PlannerGrid` gets `skipped: Set<string>` (the
   * admin's own toggle) and `preflightFor` — and neither can say "this column
   * will not be created because something already occupies it". The preflight
   * cannot: its special branch is name-blind and answers `creatable` for a date
   * that already holds that very special. `skippedDates` cannot: the
   * exists-driven skip never enters it, so the checkbox rendered UNCHECKED
   * while `handleConfirm` posted nothing. Both reasons are carried on the draft
   * (`isExisting`) or in this session's own ref, so they are resolved here and
   * handed over as one explicit answer per column.
   */
  const draftByTarget = new Map(drafts.map(d => [draftTargetKey(d._type, d.date), d]));
  const createBlockFor = (col: { type: ServiceType; date: string }): "existing" | "created" | null => {
    const key = draftTargetKey(col.type, col.date);
    if (createdTargets.current.has(key)) return "created";
    return draftByTarget.get(key)?.isExisting ? "existing" : null;
  };

  const autoState: AutoState = { pending: autoPending, error: autoError, disabledReason: gateBlocked };

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
          <YearInput className={inCls} value={year} onChange={setYear} />
        </div>
      </div>

      {/*
        E1/E2/P3: the calendar REPLACES the Domingos/Sábados checkboxes and the
        Saturday pill row, and lives on this setup step only. `key` remounts it
        per month so no composer state (or refusal notice) can survive a month
        change and offer a date that is no longer on screen.
      */}
      <MonthCalendar
        key={`${year}-${month}`}
        year={year}
        month={month}
        selectedSundays={selectedSundays}
        selectedSaturdays={activeSatDates}
        specials={specials}
        existingRoles={existingRoles}
        /*
          E17: the SAME session-local created-set that gates `handleConfirm` and
          `PlannerGrid`'s per-column reason, so the composer cannot accept a
          special the next screen will refuse ("Crear 0 borradores"). Read-only
          on the calendar's side.

          Passing `.current` rather than the ref is deliberate and safe here:
          this step only renders after `setStep("config")`, and the calendar
          reads the set during ITS render, so the value it sees is always the
          one `handleConfirm` last wrote. Nothing here needs a re-render to be
          triggered BY the mutation — the mutation and the step change happen in
          the same confirm.
        */
        createdTargets={createdTargets.current}
        onToggleWeekend={date => {
          // Local noon, never a bare `new Date(iso)` — a UTC parse day-flips and
          // would route a Sunday's toggle into the Saturday branch.
          const dow = new Date(date.slice(0, 10) + "T12:00:00").getDay();
          if (dow === 0) {
            setDeselectedSundays(prev =>
              prev.includes(date) ? prev.filter(d => d !== date) : [...prev, date],
            );
          } else {
            setActiveSatDates(prev =>
              prev.includes(date) ? prev.filter(d => d !== date) : [...prev, date],
            );
          }
        }}
        onAddSpecial={(date, name) => setSpecials(prev => [...prev.filter(s => s.date !== date), { date, name }])}
        onRemoveSpecial={date => setSpecials(prev => prev.filter(s => s.date !== date))}
      />

      {/*
        D13: the `useSolver` toggle is retired — the grid always offers Auto,
        so `SolverConfigPanel` renders unconditionally. Auto is unusable
        without pools, and gating this panel behind an opt-in left every admin
        who wanted Auto meeting the keyholed panel D17 fixes for the first time.
      */}
      {/*
        Two renders, never one with a fallback. With no rules loaded there is
        nothing true to put in the pools or the rule list, and drawing
        `DEFAULT_SOLVER_CONFIG` there would present a rule set nobody wrote as
        this team's — with a save control underneath offering to make it so.
      */}
      {solverConfig ? (
        <SolverConfigPanel
          members={members}
          config={solverConfig}
          onChange={setSolverConfig}
          rules={rules}
          history={solverHistory}
          onRemoveHistory={removeHistoryEntry}
        />
      ) : (
        <SolverConfigUnavailable source={rules.source} onReload={rules.reload} />
      )}

      {gateBlocked && (
        <p className="font-body text-xs text-amber-400 bg-amber-500/10 rounded-lg px-3 py-2">{gateBlocked}</p>
      )}

      <div className="flex gap-3">
        <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg border border-[#003572]/30 dark:border-[#00bfff]/20 font-label text-xs uppercase tracking-widest hover:border-[#00bfff] transition-colors">
          Cancelar
        </button>
        {/*
          `disabled` uses the SAME predicate as `handlePreview`'s own gate: no
          columns at all, specials included. A weekend-only predicate
          (`!selectedSundays.length && !activeSatDates.length`) would disable
          this button on a specials-only month — the headline capability of E2 —
          with nothing shown to explain why.
        */}
        <button
          type="button"
          onClick={handlePreview}
          disabled={columns.length === 0 || !!gateBlocked || !!rulesBlocked}
          title={gateBlocked ?? rulesBlocked ?? undefined}
          className="flex-1 py-2 rounded-lg bg-[#003572] dark:bg-[#00bfff]/20 hover:bg-[#003572]/80 dark:hover:bg-[#00bfff]/30 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50"
        >
          Previsualizar →
        </button>
      </div>
    </div>
  );

  // ── Step 2: Grid ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-label text-xs uppercase tracking-widest text-gray-500">{MONTHS[month - 1]} {year}</p>
          <p className="font-body text-sm">
            <span className="text-[#00bfff] font-semibold">{toCreate.length}</span> por crear
            {skippedCount > 0 && <span className="text-gray-500"> · {skippedCount} omitido{skippedCount !== 1 ? "s" : ""}</span>}
            {notCreatable > 0 && (
              <span className="text-amber-400"> · {notCreatable} no disponible{notCreatable !== 1 ? "s" : ""}</span>
            )}
          </p>
        </div>
        <button type="button" onClick={requestBack} className="font-label text-xs uppercase tracking-widest text-gray-500 hover:text-[#00bfff] transition-colors">
          ← Volver
        </button>
      </div>

      {/*
        Task 3 could not implement this — it lives on the wizard shell, not on
        `PlannerGridProps`. D13 makes "Auto failed → fix the pools → go back"
        a common round trip (pools/rules live on step 1, Auto lives on step
        2), so silently rebuilding an empty grid on every "← Volver" would lose
        real work far more often than the old preview ever did.

        One `pendingDiscard` state (and this one banner) serves BOTH "← Volver"
        and Escape — see the guard's doc comment near the top of the
        component. Sharing the state, not just the `assignmentCount > 0`
        check, means the two exits can never drift into asking different
        questions or discarding different things.
      */}
      {pendingDiscard && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 space-y-2">
          <p className="font-body text-xs text-amber-300">
            {pendingDiscard === "back" ? "Volver a configuración" : "Cerrar"} descarta {assignmentCount} asignación{assignmentCount !== 1 ? "es" : ""} en este mes. ¿Continuar?
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={pendingDiscard === "back" ? goBackToConfig : onClose}
              className="min-h-[44px] rounded-lg bg-[#003572] px-3 font-label text-xs uppercase tracking-widest dark:bg-[#00bfff]/20"
            >
              {pendingDiscard === "back" ? "Volver de todos modos" : "Cerrar de todos modos"}
            </button>
            <button type="button" onClick={() => setPendingDiscard(null)} className="min-h-[44px] rounded-lg border border-[#00bfff]/20 px-3 font-label text-xs uppercase tracking-widest">
              Cancelar
            </button>
          </div>
        </div>
      )}

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

      {viewMode === "edit" && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-label text-[11px] uppercase tracking-widest text-gray-500">⇄ Intercambiar columnas:</span>
          {columns.map(col => (
            <button
              key={col.date}
              type="button"
              data-swap-date={col.date}
              onClick={() => handleColumnSwap(col.date)}
              className={`min-h-[44px] px-2 py-1 rounded-full border text-[10px] font-label uppercase tracking-widest transition-colors ${
                swapSel === col.date
                  ? "border-[#00bfff] bg-[#00bfff]/20 text-[#00bfff]"
                  : "border-[#00bfff]/15 text-gray-500 hover:text-[#00bfff]"
              }`}
            >
              {fmtDate(col.date)}
            </button>
          ))}
          {swapSel && <span className="font-label text-[11px] uppercase tracking-widest text-[#00bfff] animate-pulse">Selecciona otra columna ⇄</span>}
        </div>
      )}

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

      {viewMode === "edit" ? (
        <PlannerGrid
          rows={rows}
          columns={columns}
          cells={cells}
          members={members}
          savedWindow={savedWindow}
          preflightFor={col => (preflight ? preflight(col.type, col.date) : null)}
          createBlockFor={createBlockFor}
          skipped={skippedDates}
          unaddressableDates={unaddressableDatesList}
          unresolvedNames={allUnresolvedNames}
          unfilled={unfilled}
          onCellsChange={handleCellsChange}
          onRowsChange={setRows}
          onToggleSkip={handleToggleSkip}
          onAuto={handleAuto}
          autoState={autoState}
          diagnostics={diagnostics}
          config={solverConfig ?? undefined}
          sundayDates={sundayDatesFull}
        />
      ) : (
        // D17/D10: this used to be `max-h-[50vh] overflow-y-auto` — a keyhole
        // sized for the old `CueDialog` overlay. The full-width panel this
        // section now lives in has no competing content to keep on screen, so
        // it uses the page's own scroll like the rest of the panel, instead of
        // nesting a second scroller inside it.
        <div className="space-y-3 pr-0.5">
          {drafts.filter(d => !d.skipped).map(d => {
            const p = draftToDayCardProps(d, members);
            return <DayCard key={d.localId} day={p.day} date={p.date} leads={p.leads}
                      bgvs={p.bgvs} chorus={p.chorus} instruments={p.instruments} fohTeam={p.fohTeam} />;
          })}
        </div>
      )}

      {/*
        The participation rail. Mounted HERE, inside the generator's own step-2
        column, rather than beside `MonthGenerator` in `ServicesPanel`: the
        counts have to move with `cells`, and `cells` is this component's state.
        Lifting it to the panel to gain a layout slot would export the grid's
        draft state to a component that has no other use for it.

        It costs the grid no width. Above 1780px it is `position: fixed` in the
        page's left gutter (`ParticipationRail`), so D10's full-width panel is
        exactly as wide as it was; below that it stacks here, under the grid.
        Placed before the footer so the confirm buttons stay last in tab order.
      */}
      <ParticipationRail
        placement="panel"
        roles={participationRoles}
        // Both halves named. "Febrero 2026" alone would head a column of
        // numbers that also carry D12's 56-day lookback into January — a
        // member reading 2 off one January service and one February draft,
        // under a heading that claims to be February.
        monthLabel={`${MONTHS[month - 1]} ${year} · borradores + carga reciente`}
      />

      {/* In "edit" mode `PlannerGrid` already surfaces this via `autoState.disabledReason`
          next to Auto — showing it again here would duplicate the same text. */}
      {gateBlocked && viewMode === "view" && (
        <p className="font-body text-xs text-amber-400 bg-amber-500/10 rounded-lg px-3 py-2">{gateBlocked}</p>
      )}

      {pushError && (
        <p className="font-label text-xs uppercase tracking-widest text-red-400 text-center bg-red-500/10 rounded-lg py-1.5">{pushError}</p>
      )}

      <div className="flex gap-3">
        <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg border border-[#003572]/30 dark:border-[#00bfff]/20 font-label text-xs uppercase tracking-widest hover:border-[#00bfff] transition-colors">
          Cancelar
        </button>
        <button type="button" onClick={() => handleConfirm(false)} disabled={pushing || toCreate.length === 0 || !!gateBlocked} title={gateBlocked ?? undefined} className="flex-1 py-2 rounded-lg bg-[#003572] dark:bg-[#00bfff]/20 hover:bg-[#003572]/80 dark:hover:bg-[#00bfff]/30 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50">
          {pushing ? "Creando..." : `Crear ${toCreate.length} borrador${toCreate.length !== 1 ? "es" : ""}`}
        </button>
        <button type="button" onClick={() => handleConfirm(true)} disabled={pushing || toCreate.length === 0 || !!gateBlocked} title={gateBlocked ?? undefined} className="flex-1 py-2 rounded-lg bg-[#003572] dark:bg-[#00bfff]/20 hover:bg-[#003572]/80 dark:hover:bg-[#00bfff]/30 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50">
          Crear y publicar
        </button>
      </div>
    </div>
  );
}
