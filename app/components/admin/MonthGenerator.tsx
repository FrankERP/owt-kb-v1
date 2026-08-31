"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTransientValue } from "@/app/utils/useTransientValue";
import type { SolveResponse } from "@/app/api/admin/solve/route";
import { DayCard } from "@/app/components/DayCard";
import { draftToDayCardProps } from "@/app/utils/draftToDayCardProps";
import { draftCreateBody, newCreationRequestId, runDraftCreateBatch } from "@/app/utils/monthDraftCreate";
import { normalizeServiceName } from "@/app/utils/normalizeLabel";
import { creatableTargets, type TargetPreflight } from "./serviceReadiness";
import PlannerGrid, { type AutoState, type SolveDiagnostics } from "./PlannerGrid";
import MonthCalendar from "./MonthCalendar";
import { SERVICE_LABEL, type ServiceRole } from "./serviceCardModel";
import type { RoleDomainSummary } from "@/app/utils/serviceReadSummary";
import { fillColumn } from "./localFill";
import { ruleContextForTarget } from "./serviceRuleContext";
import { unresolvedRuleNames } from "./ruleEnforcement";
import { ParticipationSidebar } from "./ParticipationSidebar";
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
  createColumnId,
  draftTargetKey,
  historyEntryFromDrafts,
  mapUnfilledSeats,
  namelessSpecial,
  plannerParticipationRoles,
  unaddressableDates as computeUnaddressableDates,
  type DraftCard,
  type GridCell,
  type GridColumn,
  type GridRow,
  type PersonRestriction,
  type SavedRole,
  type ConflictRule,
  type PresenceRule,
  type SolverConfig,
  type SolverHistoryEntry,
} from "./plannerModel";
import {
  buildStoredGridRows,
  joinStoredRoleInventory,
  translateStoredRole,
  type StoredGridColumn,
  type StoredGridTranslation,
} from "./storedRoleReadModel";
import {
  classifyPatchOutcome,
  freezeSaveAttempt,
  reconcileSaveAttempt,
  sameRoleSemantics,
  serializeStoredColumn,
  type FrozenSaveAttempt,
  type PatchTransportOutcome,
  type RoleSemanticSnapshot,
} from "./plannerSaveModel";

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
  mode?: "create" | "stored";
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
   * It is owned by the panel rather than fetched here so every month-planner
   * entry reads one shared object with no second copy to go stale.
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
  storedCapabilities?: {
    edit: { enabled: boolean; reason: string | null };
    create: { enabled: boolean; reason: string | null };
    swap: { enabled: boolean; reason: string | null };
    changeDate: { enabled: boolean; reason: string | null };
  };
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
   *
   * `SavedRole`, not bare `ParticipantRole`: the participation rail keys a saved
   * special by `_type` + `date` + `service_name`, and a `ParticipantRole` has no
   * name to key on. `ServicesPanel` passes `ServiceRole[]`, which carries it
   * already — narrowing this line back would silently make every stored special
   * nameless again and let a differently-named planned special erase it.
   */
  allRoles?: SavedRole[];
  initialMonth?: string;
  focusRoleId?: string;
  openComposerInitially?: boolean;
  storedSource?: {
    roles: ServiceRole[];
    integrity: RoleDomainSummary | null;
    rolesStatus: "loading" | "ready" | "error";
    integrityStatus: "loading" | "ready" | "error";
    rolesGeneration: number;
    integrityGeneration: number;
    reload: () => Promise<boolean>;
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MONTHS = ["Enero","Febrero","Marzo","Abril","Mayo","Junio",
                "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

const SWAP_PROVEN_PREWRITE_FAILURES = new Map<string, number>([
  ["invalid_request", 400],
  ["forbidden", 403],
  ["not_found", 404],
  ["integrity_conflict", 409],
  ["ambiguous_target", 409],
  ["dependency_conflict", 409],
  ["stale_revision", 409],
]);

const CREATE_PROVEN_PREWRITE_FAILURES = new Map<string, number>([
  ["invalid_request", 400],
  ["idempotency_mismatch", 409],
  ["idempotency_key_retired", 409],
  ["ambiguous_target", 409],
  ["integrity_conflict", 409],
  ["stale_revision", 409],
]);

type StoredSectionPath = "Lead" | "BGVs" | "Chorus" | "instruments" | "foh_team";

type StoredSectionFingerprint = Array<{
  itemKey: string;
  memberId: string;
  label?: string;
}>;

const STORED_SECTION_OPTIONS: Array<{ path: StoredSectionPath; label: string }> = [
  { path: "Lead", label: "Líderes" },
  { path: "BGVs", label: "BGV" },
  { path: "Chorus", label: "Coro" },
  { path: "instruments", label: "Instrumentos" },
  { path: "foh_team", label: "FOH" },
];

function storedSectionFingerprint(
  role: ServiceRole,
  path: StoredSectionPath,
): StoredSectionFingerprint | null {
  const keyedMember = (item: { _id: string; _key?: string }) =>
    item._key ? { itemKey: item._key, memberId: item._id } : null;
  if (path === "Lead" || path === "BGVs" || path === "Chorus") {
    const items = path === "Lead" ? role.leads : path === "BGVs" ? role.bgvs : role.chorus;
    const fingerprint = items.map(keyedMember);
    return fingerprint.every((item) => item !== null)
      ? fingerprint as StoredSectionFingerprint
      : null;
  }
  if (path === "instruments") {
    const fingerprint = role.instruments.map((item) =>
      item._key && item.person
        ? { itemKey: item._key, memberId: item.person._id, label: item.instrument }
        : null,
    );
    return fingerprint.every((item) => item !== null)
      ? fingerprint as StoredSectionFingerprint
      : null;
  }
  const fingerprint = role.foh.map((item) =>
    item._key && item.person
      ? { itemKey: item._key, memberId: item.person._id, label: item.role }
      : null,
  );
  return fingerprint.every((item) => item !== null)
    ? fingerprint as StoredSectionFingerprint
    : null;
}

function sameStoredSectionFingerprint(
  expected: StoredSectionFingerprint,
  observed: StoredSectionFingerprint,
): boolean {
  return JSON.stringify(expected) === JSON.stringify(observed);
}

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

/** 56 days — matches the historical candidate-load window used by Servicios. */
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
 * **THE create-gate predicate — one definition, now four consumers.** It used to
 * be written out three times (`candidates` in `handleConfirm`, `toCreate` and
 * `notCreatable` at render), which is how a fix can land on the post path and
 * miss the buttons: `toCreate` gates BOTH "Crear N borrador(es)" (its label AND
 * its disabled state) and "Crear y publicar", so a draft this dialog has already
 * created but which still passes `toCreate` produces a live button offering to
 * create something `handleConfirm` will then decline to post — and
 * `handleConfirm`'s `if (!toCreateNow.length) return` sets no `pushError`, so
 * the admin is told nothing at all. Three surfaces, three different answers.
 * Deriving all of them from this one function is what makes that state
 * unrepresentable.
 *
 * The FOURTH consumer is the drag gate's P3
 * (`moveGate.ts`'s `CreateModeGateInput.canReceive`): a drag is a MOVE, so
 * dropping into a column that is never created lands the removal on a column
 * that IS created and the add on one that is not — the person vanishes from the
 * month in one gesture. That consumer is why this is a module-level function
 * taking its dependencies as arguments rather than a closure over `preflights`
 * and the `createdTargets` ref: `canReceive` is threaded into `PlannerGrid`, and
 * a second copy of these three refusals living down there is exactly the drift
 * P3 exists to prevent.
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
 *  - the A1/A2 preflight when there is one; `!draft.exists` only as the
 *    standalone dialog's fallback, where it also carries the retry semantics
 *    (a failed draft keeps `exists: false` and stays postable).
 */
export function isDraftCreatable(input: {
  draft: DraftCard;
  /**
   * `createdTargets.current` — the LIVE `Set`, passed at call time. It is
   * mutated in place by `handleConfirm` and never re-created, so callers must
   * read `.current` when they call rather than capturing it in a closure.
   */
  createdTargets: ReadonlySet<string>;
  /** Whether the A1/A2 preflight channel exists at all (`!!preflight`). */
  hasPreflight: boolean;
  /** The preflight snapshot, keyed by `localId`. */
  preflights: ReadonlyMap<string, TargetPreflight>;
}): boolean {
  const { draft, createdTargets, hasPreflight, preflights } = input;
  if (draft.skipped) return false;
  if (createdTargets.has(draftTargetKey(draft._type, draft.date))) return false;
  return hasPreflight ? preflights.get(draft.localId)?.state === "creatable" : !draft.exists;
}

/**
 * `allRoles` bounded to `SAVED_WINDOW_DAYS` days ending at the target month's
 * first Sunday (D12's `savedWindow`, fact 24) — both compared at local noon.
 * Empty when the month has no first Sunday (defensive; `getDates` always
 * returns at least one for a real calendar month) or when the caller has no
 * history to offer.
 */
function savedWindowFor(year: number, month: number, allRoles: SavedRole[]): SavedRole[] {
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
        <p className="font-label text-[11px] uppercase tracking-widest text-mono-500">{label}</p>
        <button
          type="button" onClick={onSelectAll}
          className="font-label text-[10px] uppercase tracking-widest text-accent/70 hover:text-accent transition-colors"
        >
          {allSelected ? "Ninguno" : "Todos"}
        </button>
      </div>
      <input
        className="w-full px-2 py-1 mb-1 rounded border border-edge-control bg-transparent font-body text-xs focus:outline-none focus:border-accent placeholder-mono-600"
        placeholder="Buscar..." value={search} onChange={e => onSearch(e.target.value)}
      />
      {/*
        D17: this list used to be `max-h-32 overflow-y-auto` — a keyhole onto up
        to 10 members. The full-width panel D10 buys has room for the whole
        list without a nested scroller.
      */}
      <div className="rounded border border-accent/10 divide-y divide-accent/5">
        {visible.length === 0 && <p className="px-2 py-1 font-body text-xs text-mono-600 italic">Sin resultados</p>}
        {visible.map(m => (
          <label key={m._id} className={`flex items-center gap-2 px-2 py-1 cursor-pointer text-xs transition-colors ${config[field].includes(m._id) ? "bg-accent/10" : "hover:bg-accent/5"}`}>
            <input type="checkbox" checked={config[field].includes(m._id)} onChange={() => onToggle(m._id)} className="accent-accent" />
            <span className="font-body">{dn(m)}</span>
          </label>
        ))}
      </div>
      {config[field].length > 0 && (
        <p className="font-label text-[10px] uppercase tracking-widest text-accent mt-0.5">
          {config[field].length} seleccionado{config[field].length !== 1 ? "s" : ""}
        </p>
      )}
    </div>
  );
}

// ─── Rule builder — display cards ─────────────────────────────────────────────

function RestrictionCard({ r, onDelete, onEdit }: { r: PersonRestriction; onDelete: () => void; onEdit: () => void }) {
  return (
    <div className="rounded-lg border border-accent/10 bg-surface-sunken/40 px-3 py-2 flex items-start gap-2">
      <div className="flex-1 min-w-0 space-y-1">
        <span className="font-label text-[11px] uppercase tracking-widest text-accent/80 font-semibold">{r.person}</span>
        <div className="flex flex-wrap gap-1">
          {r.excludedPatterns.map(p => (
            <span key={p} className="font-label text-[10px] px-1.5 py-0.5 rounded-full bg-negative-strong/15 text-negative-fg border border-negative-strong/30">
              !{p}
            </span>
          ))}
          {r.weekExclusions.map(we => (
            <span key={we.id} className="font-label text-[10px] px-1.5 py-0.5 rounded-full bg-availability-fg/15 text-availability-strong border border-availability-fg/30">
              sem.{we.week} {we.pattern}
            </span>
          ))}
          {r.caps.map(cap => (
            <span key={cap.id} className="font-label text-[10px] px-1.5 py-0.5 rounded-full bg-badge-azure-deep/15 text-badge-azure-fg border border-badge-azure-deep/30">
              {cap.pattern} {cap.op} {cap.relative ? `sem−${cap.relOffset}` : cap.value}
            </span>
          ))}
          {r.fairness === "exempt" && (
            <span className="font-label text-[10px] px-1.5 py-0.5 rounded-full bg-recency-fg/15 text-recency-strong border border-recency-fg/30">
              fairness_exempt
            </span>
          )}
          {r.fairness === "slack" && (
            <span className="font-label text-[10px] px-1.5 py-0.5 rounded-full bg-recency-fg/15 text-recency-strong border border-recency-fg/30">
              slack {r.fairnessSlack}
            </span>
          )}
        </div>
      </div>
      <button type="button" onClick={onEdit} className="text-mono-600 hover:text-accent transition-colors shrink-0 text-xs leading-none mt-0.5 px-0.5" title="Editar">✎</button>
      <button type="button" onClick={onDelete} className="text-mono-600 hover:text-negative-fg transition-colors shrink-0 text-sm leading-none mt-0.5">×</button>
    </div>
  );
}

function ConflictCard({ r, onDelete, onEdit }: { r: ConflictRule; onDelete: () => void; onEdit: () => void }) {
  return (
    <div className="rounded-lg border border-accent/10 bg-surface-sunken/40 px-3 py-2 flex items-center gap-2">
      <span className="font-label text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-badge-violet-deep/15 text-badge-violet-fg border border-badge-violet-deep/30 shrink-0">≠</span>
      <span className="font-body text-xs flex-1">
        <span className="text-mono-200">{r.personA}</span>
        <span className="text-mono-500 mx-1">≠</span>
        <span className="text-mono-200">{r.personB}</span>
        <span className="text-mono-500 mx-1">en</span>
        <span className="text-accent/70">{r.pattern}</span>
      </span>
      <button type="button" onClick={onEdit} className="text-mono-600 hover:text-accent transition-colors shrink-0 text-xs leading-none px-0.5" title="Editar">✎</button>
      <button type="button" onClick={onDelete} className="text-mono-600 hover:text-negative-fg transition-colors shrink-0 text-sm leading-none">×</button>
    </div>
  );
}

function PresenceCard({ r, onDelete, onEdit }: { r: PresenceRule; onDelete: () => void; onEdit: () => void }) {
  return (
    <div className="rounded-lg border border-accent/10 bg-surface-sunken/40 px-3 py-2 flex items-center gap-2">
      <span className="font-label text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-positive-deep/15 text-positive-strong border border-positive-deep/30 shrink-0">≥1</span>
      <span className="font-body text-xs flex-1">
        <span className="text-mono-200">{r.persons.join(", ")}</span>
        <span className="text-mono-500 mx-1">en</span>
        <span className="text-accent/70">{r.pattern}</span>
        <span className="text-mono-500 ml-1">c/sem</span>
      </span>
      <button type="button" onClick={onEdit} className="text-mono-600 hover:text-accent transition-colors shrink-0 text-xs leading-none px-0.5" title="Editar">✎</button>
      <button type="button" onClick={onDelete} className="text-mono-600 hover:text-negative-fg transition-colors shrink-0 text-sm leading-none">×</button>
    </div>
  );
}

// ─── Rule builder — add forms ─────────────────────────────────────────────────

const rbSel = "px-2 py-1 rounded border border-accent/15 bg-surface-raised-alt font-body text-xs focus:outline-none focus:border-accent w-full";
const rbIn  = "px-2 py-1 rounded border border-accent/15 bg-transparent font-body text-xs focus:outline-none focus:border-accent";

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
    // `initialValues?.id ?? uid()` — NOT a bare `uid()`. This form is both the
    // add form and the edit form, and `saveRestriction` in `RuleBuilder` commits
    // an edit with `restrictions.map(x => x.id === r.id ? r : x)`. Minting a
    // fresh id on save therefore matched no row and the edit was DISCARDED with
    // no error: the card re-rendered unchanged and a cap added to an existing
    // person simply never appeared. `ConflictForm` and `PresenceForm` always
    // preserved the id; this one did not.
    onAdd({ id: initialValues?.id ?? uid(), person, excludedPatterns: excl, fairness, fairnessSlack: slack, weekExclusions: weekEx, caps });
  };

  return (
    <div className="rounded-lg border border-negative-strong/20 bg-negative-strong/5 p-3 space-y-3">
      {/* Person */}
      <div>
        <p className="font-label text-[10px] uppercase tracking-widest text-mono-500 mb-1">Persona</p>
        <select className={rbSel} value={person} onChange={e => setPerson(e.target.value)}>
          {names.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>

      {/* Exclusion pattern pills */}
      <div>
        <p className="font-label text-[10px] uppercase tracking-widest text-mono-500 mb-1.5">Excluir de</p>
        <div className="flex flex-wrap gap-1.5">
          {EXCL_PATTERNS.map(pat => (
            <button
              key={pat} type="button" onClick={() => toggleExcl(pat)}
              className={`font-label text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full border transition-colors ${
                excl.includes(pat)
                  ? "bg-negative-strong/20 text-negative-fg border-negative-strong/40"
                  : "text-mono-500 border-accent/15 hover:border-negative-strong/30 hover:text-negative-fg"
              }`}
            >
              {PAT_LABEL[pat] ?? pat}
            </button>
          ))}
        </div>
        {excl.length > 0 && (
          <p className="font-label text-[10px] text-negative-fg/80 mt-1">{excl.join(" · ")}</p>
        )}
      </div>

      {/* Fairness */}
      <div>
        <p className="font-label text-[10px] uppercase tracking-widest text-mono-500 mb-1">Fairness</p>
        <div className="flex items-center gap-3 flex-wrap">
          {(["none", "exempt", "slack"] as const).map(f => (
            <label key={f} className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" name={`fairness-${person}`} value={f} checked={fairness === f} onChange={() => setFairness(f)} className="accent-accent" />
              <span className="font-body text-xs text-mono-400">
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
        <p className="font-label text-[10px] uppercase tracking-widest text-mono-500 mb-1">Semanas excluidas</p>
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
              <button type="button" onClick={() => setWeekEx(ws => ws.filter(x => x.id !== we.id))} className="text-mono-600 hover:text-negative-fg text-sm flex-none">×</button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setWeekEx(ws => [...ws, { id: uid(), week: 1, pattern: "*.*" }])}
          className="font-label text-[10px] uppercase tracking-widest text-accent/70 hover:text-accent transition-colors mt-1"
        >
          + Semana
        </button>
      </div>

      {/* Caps */}
      <div>
        <p className="font-label text-[10px] uppercase tracking-widest text-mono-500 mb-1">Caps</p>
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
                  <span className="font-label text-[10px] text-accent/70">sem−</span>
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
                    ? "border-accent/40 bg-accent/10 text-accent"
                    : "border-accent/15 text-mono-600 hover:text-accent"
                }`}
              >sem</button>
              <button type="button" onClick={() => setCaps(cs => cs.filter(x => x.id !== cap.id))} className="text-mono-600 hover:text-negative-fg text-sm flex-none">×</button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setCaps(cs => [...cs, { id: uid(), pattern: "Sun.*", op: "<=", value: 2, relative: false, relOffset: 2 }])}
          className="font-label text-[10px] uppercase tracking-widest text-accent/70 hover:text-accent transition-colors mt-1"
        >
          + Cap
        </button>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onCancel} className="flex-1 py-1 rounded font-label text-[11px] uppercase tracking-widest border border-accent/20 text-mono-500 hover:text-accent hover:border-accent transition-colors">
          Cancelar
        </button>
        <button type="button" onClick={handleAdd} disabled={!canAdd} className="flex-1 py-1 rounded font-label text-[11px] uppercase tracking-widest bg-negative-strong/20 hover:bg-negative-strong/30 text-negative-fg transition-colors disabled:opacity-40">
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
    <div className="rounded-lg border border-badge-violet-deep/20 bg-badge-violet-deep/5 p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="font-label text-[10px] uppercase tracking-widest text-mono-500 mb-1">Persona A</p>
          <select className={rbSel} value={personA} onChange={e => setPersonA(e.target.value)}>
            {names.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div>
          <p className="font-label text-[10px] uppercase tracking-widest text-mono-500 mb-1">Persona B</p>
          <select className={rbSel} value={personB} onChange={e => setPersonB(e.target.value)}>
            {names.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>
      <div>
        <p className="font-label text-[10px] uppercase tracking-widest text-mono-500 mb-1">Patrón — no pueden coincidir en</p>
        <select className={rbSel} value={pattern} onChange={e => setPattern(e.target.value)}>
          {PATTERNS.map(p => <option key={p.value} value={p.value}>{p.label} ({p.value})</option>)}
        </select>
      </div>
      {personA === personB && personA && (
        <p className="font-label text-[10px] text-negative-fg">Selecciona dos personas distintas</p>
      )}
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onCancel} className="flex-1 py-1 rounded font-label text-[11px] uppercase tracking-widest border border-accent/20 text-mono-500 hover:text-accent hover:border-accent transition-colors">
          Cancelar
        </button>
        <button type="button" disabled={!canAdd} onClick={() => onAdd({ id: initialValues?.id ?? uid(), personA, personB, pattern })} className="flex-1 py-1 rounded font-label text-[11px] uppercase tracking-widest bg-badge-violet-deep/20 hover:bg-badge-violet-deep/30 text-badge-violet-fg transition-colors disabled:opacity-40">
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
    <div className="rounded-lg border border-positive-deep/20 bg-positive-deep/5 p-3 space-y-2">
      <div>
        <p className="font-label text-[10px] uppercase tracking-widest text-mono-500 mb-1">Al menos uno de (mín. 2)</p>
        {/*
          D17: this list used to be `max-h-28 overflow-y-auto` — the one that
          keyholed all 16 `voz` members. Same fix as `MemberPool` above.
        */}
        <div className="rounded border border-accent/10 divide-y divide-accent/5">
          {members.map(m => {
            const name    = dn(m);
            const checked = selected.includes(name);
            return (
              <label key={m._id} className={`flex items-center gap-2 px-2 py-1 cursor-pointer text-xs transition-colors ${checked ? "bg-accent/10" : "hover:bg-accent/5"}`}>
                <input
                  type="checkbox" checked={checked} className="accent-accent"
                  onChange={() => setSelected(s => checked ? s.filter(p => p !== name) : [...s, name])}
                />
                <span className="font-body">{name}</span>
              </label>
            );
          })}
        </div>
        {selected.length > 0 && (
          <p className="font-label text-[10px] text-positive-strong mt-0.5">{selected.join(", ")}</p>
        )}
      </div>
      <div>
        <p className="font-label text-[10px] uppercase tracking-widest text-mono-500 mb-1">Debe aparecer en</p>
        <select className={rbSel} value={pattern} onChange={e => setPattern(e.target.value)}>
          {PATTERNS.map(p => <option key={p.value} value={p.value}>{p.label} ({p.value})</option>)}
        </select>
      </div>
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onCancel} className="flex-1 py-1 rounded font-label text-[11px] uppercase tracking-widest border border-accent/20 text-mono-500 hover:text-accent hover:border-accent transition-colors">
          Cancelar
        </button>
        <button type="button" disabled={!canAdd} onClick={() => onAdd({ id: initialValues?.id ?? uid(), persons: selected, pattern })} className="flex-1 py-1 rounded font-label text-[11px] uppercase tracking-widest bg-positive-deep/20 hover:bg-positive-deep/30 text-positive-strong transition-colors disabled:opacity-40">
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
        <p className="font-label text-[11px] uppercase tracking-widest text-mono-500">
          Reglas{total > 0 ? ` (${total})` : ""}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-label text-[10px] uppercase tracking-widest text-mono-600">
            Añadir regla
          </span>
          <AddRuleButton
            label="+ Persona"
            title="Restringir a una persona: patrones excluidos, semanas, topes y equidad"
            tone="border-negative-strong/40 text-negative-fg hover:bg-negative-strong/10"
            disabled={isFormOpen}
            onClick={() => setAdding("restriction")}
          />
          <AddRuleButton
            label="≠ Conflicto"
            title="Impedir que dos personas coincidan en el mismo patrón"
            tone="border-badge-violet-deep/40 text-badge-violet-fg hover:bg-badge-violet-deep/10"
            disabled={isFormOpen}
            onClick={() => setAdding("conflict")}
          />
          <AddRuleButton
            label="≥1 Presencia"
            title="Exigir al menos una persona de un grupo en el patrón"
            tone="border-positive-deep/40 text-positive-strong hover:bg-positive-deep/10"
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
        <p className="font-body text-xs text-mono-600 italic px-1">Sin reglas configuradas</p>
      )}

      {/*
        Where the rules live, and how far they actually reach — said plainly,
        because both are easy to assume wrongly and expensive to discover late.

        1. THE CUTOVER LANDED. The rules are one Sanity document
           (`sanity/schemas/solverConfig.ts`), read through `useSolverConfig`,
           shared by every admin and by both surfaces. `localStorage` is no
           longer read or written for them — only `owt_solver_history_v2`, the
           fairness history, stays per-browser (ADR-0010).
        2. The saved document is what other planner sessions enforce; the edits
           on this screen are not, until "Guardar reglas" lands them. That gap is the
           price of an explicit save (a POST per keystroke would thrash the
           route's `_rev` check and lose edits to its own concurrency guard), so
           it is stated rather than hidden.
        3. Exclusions, conflicts, and week exclusions are hard on the month grid;
           week exclusions use its complete Sunday spine
           (`ruleEnforcement.ts`, `weekForColumn`). Caps and presence are not
           hard anywhere: they reach CP-SAT for Sundays and Saturdays and
           nothing checks them elsewhere — a special never goes to the solver,
           and neither does a manual pick. All of it stated because a rule that
           looks enforced and is not is worse than one that is plainly not
           offered (`ruleEnforcement.ts` lists both as deliberate non-goals).

        The branch is NOT the old per-browser one wearing new clothes: it is
        `SolverConfigSource`, i.e. what we actually know about the document.
        With no document there is nothing to share and nothing to save, so that state gets its
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
          <p className="font-body text-[11px] text-mono-500 px-1 pt-1">
            Las reglas se guardan en el <span className="text-accent">servidor</span> y las
            comparten todos los administradores. Los cambios de esta pantalla no valen en otras sesiones hasta que pulses{" "}
            <span className="text-mono-400">Guardar reglas</span>.
          </p>
          <p className="font-body text-[11px] text-mono-500 px-1">
            Se aplican como bloqueo duro los patrones excluidos y los conflictos entre dos personas,
            al editar cualquier servicio de este mes. Las{" "}
            <span className="text-mono-400">semanas excluidas</span> se verifican con el calendario completo del mes.
          </p>
        </>
      ) : source.status === "absent" ? (
        <p className="font-body text-[11px] text-mono-500 px-1 pt-1">
          Todavía no hay reglas compartidas en el servidor: estas son las de{" "}
          <span className="text-warning-strong">ejemplo</span> con las que llega la app y no se pueden
          guardar desde aquí. Los patrones excluidos, los conflictos y las semanas excluidas se
          aplican en esta sesión del editor mensual, pero aún no son reglas compartidas.
        </p>
      ) : (
        <p className="font-body text-[11px] text-mono-500 px-1 pt-1">
          <span className="text-warning-strong">
            {source.status === "error"
              ? "No se pudieron cargar las reglas compartidas del servidor."
              : "Se están cargando las reglas compartidas del servidor."}
          </span>{" "}
          Estas son las reglas que quedaron en pantalla, no necesariamente las que el servidor
          tiene ahora, y no se pueden guardar hasta que vuelvan a cargar. Mientras tanto, los
          patrones excluidos, los conflictos y las semanas excluidas se aplican con la última
          configuración cargada en esta sesión.
        </p>
      )}
      <p className="font-body text-[11px] text-mono-500 px-1">
        Los <span className="text-mono-400">topes</span> y la{" "}
        <span className="text-mono-400">presencia</span> solo los resuelve el solver en domingos y
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
        <p role="alert" className="font-body text-[11px] text-negative-fg mr-auto">
          {error.message}
        </p>
      )}
      {error?.stale && (
        <button
          type="button"
          onClick={rules.reload}
          className="font-label text-[11px] uppercase tracking-widest px-3 py-2 rounded-lg border border-accent/30 text-accent hover:bg-accent/10 transition-colors"
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
        className="font-label text-[11px] uppercase tracking-widest px-3 py-2 rounded-lg border border-accent/40 text-accent hover:bg-accent/10 transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
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
    <div className="space-y-3 p-3 rounded-xl border border-accent/20 bg-accent/5">
      <p className="font-label text-[11px] uppercase tracking-widest text-accent">Configuración del Solver</p>
      <p role={failed ? "alert" : undefined} className={`font-body text-xs ${failed ? "text-negative-fg" : "text-mono-500"}`}>
        {failed ? source.message : "Cargando las reglas compartidas…"}
      </p>
      {failed && (
        <button
          type="button"
          onClick={onReload}
          className="font-label text-[11px] uppercase tracking-widest px-3 py-2 rounded-lg border border-accent/30 text-accent hover:bg-accent/10 transition-colors"
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
    return <p className="font-body text-xs text-mono-500">Cargando las reglas compartidas…</p>;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p role="alert" className="font-body text-xs text-negative-fg mr-auto">
        {source.message}
      </p>
      <button
        type="button"
        onClick={onReload}
        className="font-label text-[11px] uppercase tracking-widest px-3 py-2 rounded-lg border border-accent/30 text-accent hover:bg-accent/10 transition-colors"
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
    <div className="space-y-3 p-3 rounded-xl border border-accent/20 bg-accent/5">
      <p className="font-label text-[11px] uppercase tracking-widest text-accent">Configuración del Solver</p>

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
          <p className="font-label text-[11px] uppercase tracking-widest text-mono-500 mb-1">
            Historial ({history.length})
            <span className="ml-1 text-accent/70 normal-case">— últimas {Math.min(history.length, 3)} ejecuciones usadas</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {[...history].reverse().map(h => (
              <span key={h.key} className="flex items-center gap-1 font-label text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full border border-accent/20 bg-accent/5 text-accent/70">
                {MONTHS[h.month - 1].slice(0, 3)} {h.year}
                <button
                  type="button"
                  onClick={() => onRemoveHistory(h.key)}
                  className="text-mono-600 hover:text-negative-fg transition-colors leading-none ml-0.5"
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
  mode = "create", members, existingRoles, onClose, onCreated, rules, capability, preflight, allRoles,
  initialMonth, focusRoleId, openComposerInitially = false, storedSource, storedCapabilities,
}: Props) {
  const storedMode = mode === "stored";
  const gateBlocked = capability && !capability.enabled ? capability.reason ?? "Datos incompletos." : null;
  const now = new Date();
  const initialMonthMatch = /^(\d{4})-(\d{2})$/.exec(initialMonth ?? "");
  const [step, setStep]           = useState<"config" | "grid">(storedMode ? "grid" : "config");
  const [year, setYear]           = useState(initialMonthMatch ? Number(initialMonthMatch[1]) : now.getFullYear());
  const [month, setMonth]         = useState(initialMonthMatch ? Number(initialMonthMatch[2]) : now.getMonth() + 1);
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
   * case, this is not a fabricated rule set, so the grid keeping
   * last-known-good preserves useful enforcement. What
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
  const storedEditBlocked = storedCapabilities?.edit.enabled === false
    ? storedCapabilities.edit.reason ?? "Datos incompletos."
    : gateBlocked ?? rulesBlocked;
  const storedCreateBlocked = storedCapabilities?.create.enabled === false
    ? storedCapabilities.create.reason ?? "Datos incompletos."
    : gateBlocked;
  const storedSwapBlocked = storedCapabilities?.swap.enabled === false
    ? storedCapabilities.swap.reason ?? "Datos incompletos."
    : storedEditBlocked;
  const storedDateBlocked = storedCapabilities?.changeDate.enabled === false
    ? storedCapabilities.changeDate.reason ?? "Datos incompletos."
    : null;
  const [solverHistory, setSolverHistory] = useState<SolverHistoryEntry[]>([]);
  const [unavailabilityNotices, setUnavailabilityNotices] = useState<{ name: string; date: string; service: string }[]>([]);

  const storedInventory = useMemo(
    () => joinStoredRoleInventory(
      storedSource?.roles ?? [],
      storedSource?.rolesStatus === "ready" && storedSource.integrityStatus === "ready"
        ? storedSource.integrity
        : null,
    ),
    [storedSource?.integrity, storedSource?.integrityStatus, storedSource?.roles, storedSource?.rolesStatus],
  );
  const allStoredTranslations = useMemo(() => {
    if (!storedMode || !storedInventory.coherent) return [];
    return storedInventory.roles
      .map(translateStoredRole)
      .filter((entry): entry is StoredGridTranslation => entry !== null);
  }, [storedInventory, storedMode]);
  const storedTranslations = useMemo(() => {
    const prefix = `${year}-${String(month).padStart(2, "0")}`;
    return allStoredTranslations.filter((entry) => entry.column.date.slice(0, 7) === prefix);
  }, [allStoredTranslations, month, year]);
  const initialStoredRows = useMemo(
    () => buildStoredGridRows(storedTranslations),
    [storedTranslations],
  );
  const initialStoredCells = useMemo(
    () => storedTranslations.flatMap((entry) => entry.cells),
    [storedTranslations],
  );

  // ── Grid state (Task 2/3's shape; `MonthGenerator` owns it per the brief) ──
  const [rows, setRows]           = useState<GridRow[]>(() => storedMode ? initialStoredRows : buildRows());
  const [cells, setCells]         = useState<GridCell[]>(() => storedMode ? initialStoredCells : []);
  const [skippedColumnIds, setSkippedColumnIds] = useState<Set<string>>(new Set());
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
  const [unfilled, setUnfilled]   = useState<{ columnId: string; rowId: string }[]>([]);
  const [diagnostics, setDiagnostics] = useState<SolveDiagnostics | null>(null);
  const [autoPending, setAutoPending] = useState(false);
  const [autoError, setAutoError]     = useState<string | null>(null);

  const [viewMode, setViewMode]   = useState<"edit" | "view">("edit");
  const [swapSel, setSwapSel]     = useState<string | null>(null);
  /**
   * The swap toast is the app's one TWO-CHANNEL toast, so it takes both the
   * persistent `hold` (as `setSwapToast`) and the timed `show` (as
   * `flashSwapToast`) from `useTransientValue`.
   *
   * Most of its messages must PERSIST until something replaces them: they report
   * a write that already landed in Sanity but could not be verified ("no se pudo
   * verificar la recarga", "No se reintentó; recarga para verificar"), and the
   * "Recargar y verificar" recovery button is rendered INSIDE this toast's block.
   * Auto-dismissing those would delete the only on-screen record that a real
   * roster swap is unresolved — and the only control that resolves it — while
   * `swapVerificationPending` keeps "Crear vacío" disabled with no stated reason.
   *
   * Only three messages are transient: two swap refusals and the local
   * "⇄ date ↔ date" confirmation.
   *
   * One owner holds the timer, which is what makes mixing the channels safe. A
   * pending flash can no longer fire into a message that replaced it — live
   * before this: a "⇄" confirmation at t=0 armed 2.5s, and an unverified-write
   * warning raised at t=2.4s was wiped 100ms later, recovery button included.
   */
  const [swapToast, flashSwapToast, , setSwapToast] = useTransientValue<string | null>(null, 2500);

  const [swapVerificationPending, setSwapVerificationPending] = useState(false);
  const pendingSwapExpected = useRef<{
    body: string;
    snapshots: Map<string, RoleSemanticSnapshot>;
    section?: {
      path: StoredSectionPath;
      fingerprints: Map<string, StoredSectionFingerprint>;
    };
  } | null>(null);
  const [sectionSwapPath, setSectionSwapPath] = useState<StoredSectionPath>("Lead");
  const [sectionSwapFirst, setSectionSwapFirst] = useState("");
  const [sectionSwapSecond, setSectionSwapSecond] = useState("");
  // Shared by "← Volver" and Escape (below): the ONE state that gates
  // discarding grid work, naming which action is pending so the two exits
  // can never end up with different rules about what counts as "unsaved" —
  // see `assignmentCount` and the effect below.
  const [pendingDiscard, setPendingDiscard] = useState<"back" | "close" | null>(null);
  const [pushing, setPushing]     = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [savingStored, setSavingStored] = useState(false);
  const [saveKnownFailures, setSaveKnownFailures] = useState(0);
  const [pendingSaveAttempts, setPendingSaveAttempts] = useState<Map<string, {
    attempt: FrozenSaveAttempt;
    transport: PatchTransportOutcome;
  }>>(new Map());
  const [storedHeaderEdits, setStoredHeaderEdits] = useState<Map<string, { date?: string; serviceName?: string }>>(new Map());
  const [touchedStoredRoleIds, setTouchedStoredRoleIds] = useState<Set<string>>(new Set());
  const monthPrefix = `${year}-${String(month).padStart(2, "0")}`;
  const [composerOpen, setComposerOpen] = useState(storedMode && openComposerInitially);
  const [createType, setCreateType] = useState<ServiceType>("sunday_role");
  const [createDate, setCreateDate] = useState(`${monthPrefix}-01`);
  const [createName, setCreateName] = useState("");
  const [creatingOne, setCreatingOne] = useState(false);
  const [createAttemptStatus, setCreateAttemptStatus] = useState<"unknown" | "committedUnverified" | null>(null);
  const createAttempt = useRef<{
    id: string;
    payloadKey: string;
    target: { type: ServiceType; date: string; name: string | null };
    roleId?: string;
  } | null>(null);
  const baselineByRole = useRef<Map<string, RoleSemanticSnapshot>>(new Map());
  if (storedMode && baselineByRole.current.size === 0) {
    for (const translation of storedTranslations) {
      const serialized = serializeStoredColumn(
        translation.column,
        initialStoredRows,
        initialStoredCells,
      );
      if (serialized.ok) baselineByRole.current.set(translation.column.roleId, serialized.snapshot);
    }
  }

  /**
   * Total occupied seats across the whole grid — what "← Volver" (and Escape,
   * via the shared `pendingDiscard` guard below) would discard. Counted as
   * assignment SLOTS (one person in two seats counts twice), matching what
   * the admin would actually have to redo. Computed up here, ahead of both
   * effects that read it, rather than down near the JSX that used to be its
   * only reader.
   */
  const assignmentCount = cells.reduce((n, c) => n + c.occupants.length, 0);

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

  const inCls  = "w-full px-3 py-2 rounded-lg border border-accent/20 bg-transparent font-body text-sm focus:outline-none focus:border-accent transition-colors";
  const selCls = "w-full px-3 py-2 rounded-lg border border-accent/20 bg-surface-raised-alt font-body text-sm focus:outline-none focus:border-accent transition-colors";

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
  const createColumns = useMemo(
    () => buildColumns({ sundayDates: selectedSundays, activeSatDates, specials }),
    [selectedSundays, activeSatDates, specials],
  );
  const columns = storedMode
    ? storedTranslations.map((entry) => ({
        ...entry.column,
        ...(storedHeaderEdits.get(entry.column.roleId) ?? {}),
      }))
    : createColumns;
  const storedColumns = columns.filter((column): column is StoredGridColumn => "roleId" in column);
  const dirtyStoredColumns = storedMode
    ? storedColumns.filter((column) => {
        const serialized = serializeStoredColumn(column, rows, cells);
        const baseline = baselineByRole.current.get(column.roleId);
        return serialized.ok && (!baseline || !sameRoleSemantics(baseline, serialized.snapshot));
      })
    : [];
  const invalidStoredColumns = storedMode
    ? storedColumns.filter((column) => touchedStoredRoleIds.has(column.roleId) && !serializeStoredColumn(column, rows, cells).ok)
    : [];
  const storedRowsDirty = storedMode && JSON.stringify(rows) !== JSON.stringify(initialStoredRows);
  const hasStoredDateMove = [...storedHeaderEdits.values()].some((edit) => edit.date !== undefined);
  const storedSaveBlocked = storedEditBlocked ?? (hasStoredDateMove ? storedDateBlocked : null);
  const storedWriteUnresolved = storedRowsDirty || dirtyStoredColumns.length > 0 || invalidStoredColumns.length > 0 || pendingSaveAttempts.size > 0 || swapVerificationPending;
  const storedHasUnresolvedWork = storedWriteUnresolved || createAttemptStatus !== null;
  const storedTransportActive = storedMode && (savingStored || creatingOne);
  const storedMutationLocked = storedMode && (
    savingStored
    || pendingSaveAttempts.size > 0
    || swapVerificationPending
    || creatingOne
    || createAttemptStatus !== null
    || pendingDiscard !== null
  );
  const storedGenerationKey = `${storedSource?.rolesGeneration ?? 0}:${storedSource?.integrityGeneration ?? 0}`;
  const storedSectionServiceOptions = storedMode
    ? storedColumns
        .filter((column) => column.admission === "approved")
        .map((column) => ({
          column,
          label: `${fmtDate(column.date)} · ${SERVICE_LABEL[column.type]}${column.type === "special_role" ? ` · ${column.serviceName}` : ""}`,
        }))
    : [];
  const sectionSwapFirstColumn = storedSectionServiceOptions.find(({ column }) => column.roleId === sectionSwapFirst)?.column;
  const sectionSwapSecondColumn = storedSectionServiceOptions.find(({ column }) => column.roleId === sectionSwapSecond)?.column;
  const sectionSwapTopologyInvalid = sectionSwapPath === "Chorus"
    && (sectionSwapFirstColumn?.type === "saturday_role" || sectionSwapSecondColumn?.type === "saturday_role");
  const storedSwapInteractionBlocked = storedMutationLocked || storedHasUnresolvedWork || !!storedSwapBlocked;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (storedTransportActive) return;
      const wouldDiscard = storedMode
        ? storedHasUnresolvedWork
        : step === "grid" && assignmentCount > 0;
      if (wouldDiscard) {
        setPendingDiscard("close");
        return;
      }
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [assignmentCount, onClose, step, storedHasUnresolvedWork, storedMode, storedTransportActive]);

  useEffect(() => {
    if (!storedMode || !focusRoleId) return;
    const frame = requestAnimationFrame(() => {
      const escaped = typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(focusRoleId)
        : focusRoleId.replace(/["\\]/g, "\\$&");
      document.querySelector(`[data-grid-column-id="${escaped}"]`)?.scrollIntoView({ block: "nearest", inline: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRoleId, storedGenerationKey, storedMode]);
  const lastStoredGeneration = useRef(storedGenerationKey);
  useEffect(() => {
    if (!storedMode || lastStoredGeneration.current === storedGenerationKey) return;
    lastStoredGeneration.current = storedGenerationKey;
    if (!storedInventory.coherent) {
      setSaveNotice("La recarga no produjo una vista íntegra. Tus cambios siguen separados y no se adoptaron.");
      return;
    }
    const refreshedRows = buildStoredGridRows(storedTranslations);
    const refreshedCells = storedTranslations.flatMap((entry) => entry.cells);
    const refreshedSnapshots = new Map<string, RoleSemanticSnapshot>();
    const allRefreshedRows = buildStoredGridRows(allStoredTranslations);
    const allRefreshedCells = allStoredTranslations.flatMap((entry) => entry.cells);
    for (const translation of allStoredTranslations) {
      const serialized = serializeStoredColumn(translation.column, allRefreshedRows, allRefreshedCells);
      if (serialized.ok) refreshedSnapshots.set(translation.column.roleId, serialized.snapshot);
    }

    if (swapVerificationPending) {
      const expected = pendingSwapExpected.current;
      const semanticsVerified = expected && [...expected.snapshots].every(([roleId, snapshot]) => {
        const observed = refreshedSnapshots.get(roleId);
        return observed ? sameRoleSemantics(snapshot, observed) : false;
      });
      const fingerprintsVerified = expected?.section
        ? [...expected.section.fingerprints].every(([roleId, fingerprint]) => {
            const observedRole = storedInventory.roles.find((item) => item.role._id === roleId)?.role;
            const observed = observedRole
              ? storedSectionFingerprint(observedRole, expected.section!.path)
              : null;
            return observed ? sameStoredSectionFingerprint(fingerprint, observed) : false;
          })
        : true;
      const verified = semanticsVerified && fingerprintsVerified;
      if (!verified) {
        setSwapToast("La recarga no coincide con el intercambio solicitado. Se conserva como resultado pendiente y no se reintentó.");
        return;
      }
      baselineByRole.current = refreshedSnapshots;
      setRows(refreshedRows);
      setCells(refreshedCells);
      setStoredHeaderEdits(new Map());
      setTouchedStoredRoleIds(new Set());
      pendingSwapExpected.current = null;
      setSwapVerificationPending(false);
      setSwapToast("Intercambio guardado y verificado.");
      return;
    }

    if (pendingSaveAttempts.size > 0) {
      const outcomes = [...pendingSaveAttempts.values()].map(({ attempt, transport }) => {
        const snapshot = refreshedSnapshots.get(attempt.roleId);
        const column = allStoredTranslations.find((entry) => entry.column.roleId === attempt.roleId)?.column;
        const outcome = reconcileSaveAttempt({
          attempt,
          transport,
          observed: snapshot && column ? { rev: column.rev, snapshot } : null,
        });
        return { roleId: attempt.roleId, transport, column, outcome };
      });
      const resolved = outcomes.every(({ transport, column, outcome }) =>
        outcome.kind === "applied"
        || (transport.kind === "maintenanceReload" && column?.admission === "approved"),
      );
      if (resolved) {
        const appliedRoleIds = new Set(
          outcomes.filter(({ outcome }) => outcome.kind === "applied").map(({ roleId }) => roleId),
        );
        const maintenanceRoleIds = new Set(
          outcomes.filter(({ transport, outcome }) => transport.kind === "maintenanceReload" && outcome.kind !== "applied").map(({ roleId }) => roleId),
        );
        const nextBaselines = new Map(baselineByRole.current);
        for (const roleId of pendingSaveAttempts.keys()) {
          const snapshot = refreshedSnapshots.get(roleId);
          if (snapshot) nextBaselines.set(roleId, snapshot);
        }
        baselineByRole.current = nextBaselines;
        setCells((current) => [
          ...current.filter((cell) => !appliedRoleIds.has(cell.columnId)),
          ...refreshedCells.filter((cell) => appliedRoleIds.has(cell.columnId)),
        ]);
        setStoredHeaderEdits((current) => {
          const next = new Map(current);
          for (const roleId of appliedRoleIds) next.delete(roleId);
          return next;
        });
        setTouchedStoredRoleIds((current) => {
          const next = new Set(current);
          for (const roleId of appliedRoleIds) next.delete(roleId);
          return next;
        });
        setPendingSaveAttempts(new Map());
        setSaveNotice(
          maintenanceRoleIds.size > 0
            ? `Se verificaron ${appliedRoleIds.size} cambios; ${maintenanceRoleIds.size} servicio${maintenanceRoleIds.size !== 1 ? "s" : ""} quedó listo para volver a guardar.${saveKnownFailures ? ` ${saveKnownFailures} fue rechazado y conserva sus cambios.` : ""}`
            : `Cambios guardados y verificados.${saveKnownFailures ? ` ${saveKnownFailures} servicio${saveKnownFailures !== 1 ? "s" : ""} fue rechazado y conserva sus cambios.` : ""}`,
        );
        setSaveKnownFailures(0);
      } else if (outcomes.some(({ outcome }) => outcome.kind === "committedThenSuperseded")) {
        setSaveNotice("El cambio se guardó, pero otra edición lo reemplazó. Conservamos tu intención sin adoptar la versión remota.");
      } else {
        setSaveNotice("No se pudo confirmar el resultado. Conservamos tus cambios; recarga antes de intentar de nuevo.");
      }
      return;
    }

    if (!storedRowsDirty && dirtyStoredColumns.length === 0 && invalidStoredColumns.length === 0 && !swapVerificationPending) {
      baselineByRole.current = refreshedSnapshots;
      setRows(refreshedRows);
      setCells(refreshedCells);
      setStoredHeaderEdits(new Map());
      setTouchedStoredRoleIds(new Set());
      setSwapVerificationPending(false);
    }
  }, [allStoredTranslations, dirtyStoredColumns.length, invalidStoredColumns.length, pendingSaveAttempts, saveKnownFailures, setSwapToast, storedGenerationKey, storedInventory, storedMode, storedRowsDirty, storedTranslations, swapVerificationPending]);

  useEffect(() => {
    const attempt = createAttempt.current;
    if (!storedMode || !attempt || !storedInventory.coherent) return;
    if (!attempt.roleId) return;
    const matches = (storedSource?.roles ?? []).filter((role) => role._id === attempt.roleId);
    const admittedEmpty = matches.find((role) =>
      role._type === attempt.target.type
      && role.date === attempt.target.date
      && (role._type !== "special_role" || normalizeServiceName(role.service_name) === attempt.target.name)
      && role.published === false
      && role.leads.length === 0
      && role.bgvs.length === 0
      && role.chorus.length === 0
      && role.instruments.length === 0
      && role.foh.length === 0,
    );
    if (!admittedEmpty) return;
    createAttempt.current = null;
    setCreateAttemptStatus(null);
    setComposerOpen(false);
    setCreateName("");
    setSaveNotice("Servicio vacío creado y verificado. Ya puedes asignar el equipo.");
    onCreated();
  }, [onCreated, storedGenerationKey, storedInventory.coherent, storedMode, storedSource?.roles]);

  const unaddressableDatesList = useMemo(
    () => computeUnaddressableDates(sundayDatesFull, activeSatDates),
    [sundayDatesFull, activeSatDates],
  );

  const savedWindow = useMemo(
    () => savedWindowFor(year, month, allRoles ?? []),
    [year, month, allRoles],
  );

  /**
   * The SAVED half of the participation rail: everything stored in the month
   * being generated, and NOTHING from any other month.
   *
   * **The rail answers one question — "is THIS month fair?" — so its scope is
   * this month.** It used to add D12's rolling 56-day lookback (`savedWindow`,
   * which ends at the month's first Sunday) to make the number a fairness
   * baseline, and that answered a different question than the one the admin is
   * holding: they are building September, and a chart headed September that
   * carries August's load cannot be read against the grid beside it. Two
   * consequences are the point, not side effects:
   *   • an EMPTY grid reads everyone at zero — the clean starting line that
   *     makes "is this month fair" answerable at a glance;
   *   • a member at 3 in this rail served three times in this month, full stop.
   *
   * **Saved services in the month still count, even though they are not on
   * screen.** Generate September, create six services, come back and generate
   * again: those six are September's load whether or not this pass re-plans
   * them. `plannerParticipationRoles` de-duplicates the ones the grid IS
   * re-planning (`_type|date|normalizeServiceName(name)`), so a service that is
   * both saved and on screen is counted once, from the draft.
   *
   * `savedWindow` is untouched and still feeds `rankCandidates` — a rolling
   * recent load is the right signal for ORDERING candidates, and a wrong one
   * for a per-month fairness read-out. The two numbers legitimately differ,
   * which is why the picker labels its own ("Carga para ordenar").
   *
   * String prefix, not a date comparison: `date` is a Sanity `date`
   * (`YYYY-MM-DD`), so its first seven characters ARE its calendar month. No
   * `new Date` anywhere near it, so there is no UTC day-flip to get wrong.
   */
  const participationSaved = useMemo(() => {
    const prefix = `${year}-${String(month).padStart(2, "0")}`;
    return (allRoles ?? []).filter(r => r.date.slice(0, 7) === prefix);
  }, [allRoles, year, month]);


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
   * This session's binding of the module-level `isDraftCreatable` — see that
   * function for why the predicate itself lives outside the component. Kept as
   * a plain function, not a `useCallback`, so `createdTargets.current` is read
   * when it is CALLED: `handleConfirm` mutates that set in place and no render
   * follows, so a captured copy would answer with a stale month.
   */
  function isCreatable(d: DraftCard): boolean {
    return isDraftCreatable({
      draft: d,
      createdTargets: createdTargets.current,
      hasPreflight: !!preflight,
      preflights,
    });
  }

  /**
   * P3 for the drag gate (`moveGate.ts`) — may an occupant be DROPPED into this
   * column at all?
   *
   * The same `isDraftCreatable` verdict the footer buttons and `handleConfirm`
   * use, resolved from column → draft by `draftTargetKey`, exactly as
   * `createBlockFor` does. A column with no draft answers `false`: `PlannerGrid`
   * cannot know why there is no draft, and "no draft" is never a licence to move
   * somebody into a service this dialog is not going to write.
   *
   * Memoized because the drag gate caches its verdicts on the identity of its
   * inputs (`createMoveGate`), and a fresh closure per render would drop that
   * cache on every `dragover`.
   */
  const canReceiveDrop = useCallback(
    (column: GridColumn): boolean => {
      const key = draftTargetKey(column.type, column.date);
      const draft = drafts.find((d) => draftTargetKey(d._type, d.date) === key);
      if (!draft) return false;
      return isDraftCreatable({
        draft,
        createdTargets: createdTargets.current,
        hasPreflight: !!preflight,
        preflights,
      });
    },
    [drafts, preflight, preflights],
  );

  function requestBack() {
    if (storedMode) {
      if (storedTransportActive) return;
      if (storedHasUnresolvedWork) { setPendingDiscard("close"); return; }
      onClose();
      return;
    }
    if (assignmentCount > 0) { setPendingDiscard("back"); return; }
    goBackToConfig();
  }

  function goBackToConfig() {
    setPendingDiscard(null);
    setStep("config");
    setSwapSel(null);
  }

  function confirmPendingDiscard() {
    if (storedTransportActive) return;
    if (!storedMode && pendingDiscard === "back") goBackToConfig();
    else onClose();
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
    setSkippedColumnIds(new Set());
    setUnresolvedNames([]);
    setUnfilled([]);
    setDiagnostics(null);
    setAutoError(null);
    setDrafts(cellsToDrafts([], columns, new Set(), [], existingRoles));
    setStep("grid");
  }

  function handleCellsChange(next: GridCell[]) {
    if (storedMutationLocked) return;
    if (storedMode) {
      const changedRoleIds = new Set<string>();
      const allColumnIds = new Set([...cells.map((cell) => cell.columnId), ...next.map((cell) => cell.columnId)]);
      for (const columnId of allColumnIds) {
        const before = cells.filter((cell) => cell.columnId === columnId);
        const after = next.filter((cell) => cell.columnId === columnId);
        if (JSON.stringify(before) !== JSON.stringify(after)) changedRoleIds.add(columnId);
      }
      if (changedRoleIds.size) {
        setTouchedStoredRoleIds((current) => new Set([...current, ...changedRoleIds]));
      }
    }
    setCells(next);
    if (storedMode) {
      setSaveNotice(null);
      return;
    }
    setDrafts(prev => cellsToDrafts(next, columns, skippedColumnIds, prev, existingRoles));
  }

  function handleStoredHeaderChange(columnId: string, patch: { date?: string; serviceName?: string }) {
    if (!storedMode || storedMutationLocked) return;
    if (patch.date !== undefined && storedDateBlocked) {
      setSaveNotice(storedDateBlocked);
      return;
    }
    setStoredHeaderEdits((current) => {
      const next = new Map(current);
      next.set(columnId, { ...(next.get(columnId) ?? {}), ...patch });
      return next;
    });
    setTouchedStoredRoleIds((current) => new Set(current).add(columnId));
    setSaveNotice(null);
  }

  function handleRowsChange(next: GridRow[]) {
    if (storedMutationLocked) return;
    setRows(next);
  }

  function handleToggleSkip(columnId: string) {
    if (storedMode) return;
    setSkippedColumnIds(prev => {
      const next = new Set(prev);
      if (next.has(columnId)) next.delete(columnId); else next.add(columnId);
      setDrafts(prevDrafts => cellsToDrafts(cells, columns, next, prevDrafts, existingRoles));
      return next;
    });
  }

  async function handleStoredSave() {
    if (!storedMode || !storedSource || storedMutationLocked || dirtyStoredColumns.length === 0 || storedSaveBlocked) return;
    setSavingStored(true);
    setSaveNotice(null);
    setSaveKnownFailures(0);
    const pending = new Map<string, { attempt: FrozenSaveAttempt; transport: PatchTransportOutcome }>();
    let knownFailures = 0;
    try {
      for (const column of dirtyStoredColumns) {
        const serialized = serializeStoredColumn(column, rows, cells);
        if (!serialized.ok) {
          setSaveNotice(`No se puede guardar ${column.date}: ${serialized.reasons.join(", ")}.`);
          return;
        }
        const attempt = freezeSaveAttempt(crypto.randomUUID(), column, serialized);
        let transport: PatchTransportOutcome;
        try {
          const response = await fetch(`/api/admin/roles/${encodeURIComponent(column.roleId)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: attempt.exactBodyBytes,
          });
          let responseBody: unknown = null;
          try { responseBody = await response.json(); } catch {}
          transport = classifyPatchOutcome({ status: response.status, body: responseBody });
        } catch {
          transport = classifyPatchOutcome({ transportError: true });
        }
        if (transport.kind === "knownFailure") {
          knownFailures += 1;
          setSaveNotice(`El servidor rechazó ${column.date} (${transport.code}); los demás cambios seguros continuaron.`);
          continue;
        }
        pending.set(column.roleId, { attempt, transport });
        if (transport.kind !== "knownCommitted") break;
      }
      setPendingSaveAttempts(pending);
      setSaveKnownFailures(knownFailures);
      if (pending.size > 0) {
        const reloaded = await storedSource.reload();
        if (!reloaded) {
          setSaveNotice("No se pudo verificar la recarga. Conservamos tus cambios y no se reintentó el guardado.");
        }
      } else if (knownFailures > 0) {
        setSaveNotice(`${knownFailures} servicio${knownFailures !== 1 ? "s" : ""} fue rechazado antes de escribir; tus cambios siguen pendientes.`);
      }
    } finally {
      setSavingStored(false);
    }
  }

  async function handleCreateOne() {
    const retryingUnknownAttempt = createAttemptStatus === "unknown";
    if (!storedMode || !storedSource || creatingOne || (storedMutationLocked && !retryingUnknownAttempt) || storedWriteUnresolved || createAttemptStatus === "committedUnverified" || storedCreateBlocked) return;
    const normalizedName = createType === "special_role" ? normalizeServiceName(createName) : null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(createDate) || createDate.slice(0, 7) !== monthPrefix) {
      setSaveNotice("Elige una fecha válida dentro del mes abierto.");
      return;
    }
    if (createType === "special_role" && !normalizedName) {
      setSaveNotice("Escribe el nombre del servicio especial.");
      return;
    }
    const target = { type: createType, date: createDate, name: normalizedName };
    const payloadKey = JSON.stringify(target);
    if (!createAttempt.current || createAttempt.current.payloadKey !== payloadKey) {
      createAttempt.current = { id: newCreationRequestId(), payloadKey, target };
    }
    const body = draftCreateBody({
      localId: createAttempt.current.id,
      creationRequestId: createAttempt.current.id,
      _type: createType,
      date: createDate,
      ...(createType === "special_role" ? { service_name: normalizedName ?? "" } : {}),
      leads: [],
      bgvs: [],
      chorus: [],
      instruments: [],
      foh: [],
    }, false);
    setCreatingOne(true);
    setSaveNotice(null);
    try {
      const response = await fetch("/api/admin/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      let responseBody: unknown = null;
      try { responseBody = await response.json(); } catch {}
      if (!response.ok) {
        const code = responseBody && typeof responseBody === "object" && typeof (responseBody as { error?: unknown }).error === "string"
          ? (responseBody as { error: string }).error
          : null;
        const provenPrewrite = code !== null && CREATE_PROVEN_PREWRITE_FAILURES.get(code) === response.status;
        if (provenPrewrite) setCreateAttemptStatus(null);
        else setCreateAttemptStatus("unknown");
        setSaveNotice(`No se creó el servicio (${code ?? "respuesta_no_verificable"}).`);
        if (response.status === 409 || !provenPrewrite) await storedSource.reload();
        return;
      }
      const responseRoleId = responseBody && typeof responseBody === "object" && typeof (responseBody as { _id?: unknown })._id === "string"
        ? (responseBody as { _id: string })._id
        : null;
      const echoedRequestId = responseBody && typeof responseBody === "object" && typeof (responseBody as { creationRequestId?: unknown }).creationRequestId === "string"
        ? (responseBody as { creationRequestId: string }).creationRequestId
        : null;
      if (!responseRoleId || echoedRequestId !== createAttempt.current.id) {
        setCreateAttemptStatus("unknown");
        setSaveNotice("El servidor confirmó la creación sin identidad verificable. Repite la misma solicitud para verificarla sin duplicar.");
        return;
      }
      createAttempt.current.roleId = responseRoleId;
      setCreateAttemptStatus("committedUnverified");
      setSaveNotice("Servicio creado; verificando la lectura canónica…");
      if (!await storedSource.reload()) {
        setSaveNotice("El servidor confirmó la creación, pero no se pudo verificar la recarga.");
      }
    } catch {
      setCreateAttemptStatus("unknown");
      setSaveNotice("Resultado de creación desconocido. Conservamos la misma solicitud y no creamos otra.");
      await storedSource.reload();
    } finally {
      setCreatingOne(false);
    }
  }

  function frozenSwapExpectation(
    roleIds: readonly string[],
    candidateCells: GridCell[],
    body: unknown,
    section?: { path: StoredSectionPath; fingerprints: Map<string, StoredSectionFingerprint> },
  ) {
    const snapshots = new Map<string, RoleSemanticSnapshot>();
    for (const roleId of roleIds) {
      const column = storedColumns.find((item) => item.roleId === roleId);
      if (!column) return null;
      const serialized = serializeStoredColumn(column, rows, candidateCells);
      if (!serialized.ok) return null;
      snapshots.set(roleId, serialized.snapshot);
    }
    return { body: JSON.stringify(body), snapshots, ...(section ? { section } : {}) };
  }

  async function handleRejectedStoredSwap(response: Response, subject: string) {
    let code: string | null = null;
    try {
      const body = await response.json();
      if (body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string") {
        code = (body as { error: string }).error;
      }
    } catch {}
    if (code === "bootstrap_completed_reload" && response.status === 409) {
      pendingSwapExpected.current = null;
      setSwapVerificationPending(false);
      setSwapToast("Se preparó un servicio legado. Revisa la recarga y vuelve a solicitar el intercambio.");
      await storedSource?.reload();
      return;
    }
    if (code && SWAP_PROVEN_PREWRITE_FAILURES.get(code) === response.status) {
      pendingSwapExpected.current = null;
      setSwapVerificationPending(false);
      setSwapToast(`No se intercambiaron ${subject} (${code}).`);
      return;
    }
    setSwapVerificationPending(true);
    setSwapToast("El servidor devolvió un resultado no verificable. No se reintentó; recargando para comparar la intención exacta…");
    await storedSource?.reload();
  }

  /** Whole-day swap, carried over as a COLUMN swap (2026-07-30 decision):
   *  pick two date columns and exchange every row's cell between them. */
  async function handleColumnSwap(columnId: string) {
    if (storedMode && storedSwapInteractionBlocked) return;
    if (!swapSel) { setSwapSel(columnId); return; }
    if (swapSel === columnId) { setSwapSel(null); return; }
    const a = swapSel;
    const b = columnId;
    const columnA = columns.find((c) => c.columnId === a);
    const columnB = columns.find((c) => c.columnId === b);
    // A Sunday column and a Saturday column have different seats (a Saturday
    // has no Coro row at all in the write path — `cellsToDrafts` zeroes
    // `chorus` for `saturday_role` unconditionally). Swapping across types
    // would carry a Coro cell onto a Saturday and lose it silently on create,
    // under a success toast with no warning. Refuse instead.
    const typeA = columnA?.type;
    const typeB = columnB?.type;
    if (storedMode) {
      setSwapSel(null);
      if (storedSwapBlocked) {
        setSwapToast(storedSwapBlocked);
        return;
      }
      if (dirtyStoredColumns.length > 0 || invalidStoredColumns.length > 0 || storedMutationLocked) {
        setSwapToast("Guarda o resuelve los cambios pendientes antes de intercambiar equipos.");
        return;
      }
      const storedA = columnA && "roleId" in columnA ? columnA as StoredGridColumn : null;
      const storedB = columnB && "roleId" in columnB ? columnB as StoredGridColumn : null;
      if (!storedA || !storedB || storedA.admission !== "approved" || storedB.admission !== "approved") {
        setSwapToast("Uno de los servicios está en modo de solo lectura.");
        return;
      }
      if ((typeA === "saturday_role") !== (typeB === "saturday_role")) {
        setSwapToast("Los equipos de sábado solo se intercambian con otro sábado.");
        return;
      }
      setSavingStored(true);
      try {
        const body = {
          kind: "team",
          roles: [
            { id: storedA.roleId, rev: storedA.rev },
            { id: storedB.roleId, rev: storedB.rev },
          ],
        };
        const byRowA = new Map(cells.filter((cell) => cell.columnId === storedA.roleId).map((cell) => [cell.rowId, cell]));
        const byRowB = new Map(cells.filter((cell) => cell.columnId === storedB.roleId).map((cell) => [cell.rowId, cell]));
        const candidateCells = cells.filter((cell) => cell.columnId !== storedA.roleId && cell.columnId !== storedB.roleId);
        for (const rowId of new Set([...byRowA.keys(), ...byRowB.keys()])) {
          const left = byRowA.get(rowId);
          const right = byRowB.get(rowId);
          if (right) candidateCells.push({ ...right, columnId: storedA.roleId });
          if (left) candidateCells.push({ ...left, columnId: storedB.roleId });
        }
        const expected = frozenSwapExpectation([storedA.roleId, storedB.roleId], candidateCells, body);
        if (!expected) {
          setSwapToast("No se pudo construir una intención completa para el intercambio.");
          return;
        }
        pendingSwapExpected.current = expected;
        const response = await fetch("/api/admin/roles/swap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: expected.body,
        });
        if (!response.ok) {
          await handleRejectedStoredSwap(response, "los equipos");
          return;
        }
        setSwapVerificationPending(true);
        setSwapToast("Equipos intercambiados; verificando…");
        if (!await storedSource?.reload()) {
          setSwapVerificationPending(true);
          setSwapToast("El intercambio respondió correctamente, pero no se pudo verificar la recarga.");
        }
      } catch {
        setSwapVerificationPending(true);
        setSwapToast("Resultado desconocido. No se reintentó; recarga para verificar.");
      } finally {
        setSavingStored(false);
      }
      return;
    }
    // P4: a special is never swappable, not even with another special. The swap
    // exchanges CELLS between two date columns and moves nothing else — the
    // `service_name` stays with its date (it comes from `specials`, which this
    // handler does not touch). So "swap Bautizos with Vigilia" would silently
    // leave each roster under the other service's name, which is the opposite
    // of what the admin just asked for. Checked BEFORE the cross-type refusal
    // below so a special↔weekend attempt names the more specific reason.
    if (typeA === "special_role" || typeB === "special_role") {
      setSwapSel(null);
      flashSwapToast("No se puede intercambiar un servicio especial: su nombre se queda en su fecha.");
      return;
    }
    if (typeA !== typeB) {
      setSwapSel(null);
      // Named from the shared `SERVICE_LABEL`, not hardcoded: specials are
      // columns now, so "Domingo con un Sábado" was about to become wrong copy
      // on a real refusal. For the Sunday/Saturday pair it reads identically.
      flashSwapToast(
        `No se puede intercambiar un ${typeA ? SERVICE_LABEL[typeA] : "servicio"} con un ${typeB ? SERVICE_LABEL[typeB] : "servicio"}.`,
      );
      return;
    }
    const byRowA = new Map(cells.filter(c => c.columnId === a).map(c => [c.rowId, c]));
    const byRowB = new Map(cells.filter(c => c.columnId === b).map(c => [c.rowId, c]));
    const rowIds = new Set([...byRowA.keys(), ...byRowB.keys()]);
    const next = cells.filter(c => c.columnId !== a && c.columnId !== b);
    for (const rowId of rowIds) {
      const ca = byRowA.get(rowId);
      const cb = byRowB.get(rowId);
      if (cb) next.push({ ...cb, columnId: a });
      if (ca) next.push({ ...ca, columnId: b });
    }
    setCells(next);
    setDrafts(prev => cellsToDrafts(next, columns, skippedColumnIds, prev, existingRoles));
    setSwapSel(null);
    flashSwapToast(`⇄ ${fmtDate(columnA?.date ?? "")} ↔ ${fmtDate(columnB?.date ?? "")}`);
  }

  async function handleSectionSwap() {
    if (!storedMode || !storedSource || storedSwapInteractionBlocked) return;
    const source = sectionSwapFirstColumn;
    const target = sectionSwapSecondColumn;
    if (!source || !target || source.roleId === target.roleId) {
      setSwapToast("Selecciona dos servicios distintos.");
      return;
    }
    if (sectionSwapPath === "Chorus" && (source.type === "saturday_role" || target.type === "saturday_role")) {
      setSwapToast("Coro no se puede intercambiar con un servicio de sábado.");
      return;
    }
    setSavingStored(true);
    setSwapToast(null);
    try {
      const body = {
        kind: "section",
        path: sectionSwapPath,
        roles: [
          { id: source.roleId, rev: source.rev },
          { id: target.roleId, rev: target.rev },
        ],
      };
      const sectionOwnsRow = (rowId: string) => sectionSwapPath === "Lead"
        ? rowId === "lead"
        : sectionSwapPath === "BGVs"
          ? rowId === "bgv"
          : sectionSwapPath === "Chorus"
            ? rowId === "coro"
            : sectionSwapPath === "instruments"
              ? rowId.startsWith("instrumento:")
              : rowId.startsWith("foh:");
      const sourceCells = cells.filter((cell) => cell.columnId === source.roleId && sectionOwnsRow(cell.rowId));
      const targetCells = cells.filter((cell) => cell.columnId === target.roleId && sectionOwnsRow(cell.rowId));
      const candidateCells = cells.filter((cell) =>
        !((cell.columnId === source.roleId || cell.columnId === target.roleId) && sectionOwnsRow(cell.rowId)),
      );
      candidateCells.push(
        ...targetCells.map((cell) => ({ ...cell, columnId: source.roleId })),
        ...sourceCells.map((cell) => ({ ...cell, columnId: target.roleId })),
      );
      const sourceRole = storedInventory.roles.find((item) => item.role._id === source.roleId)?.role;
      const targetRole = storedInventory.roles.find((item) => item.role._id === target.roleId)?.role;
      const sourceFingerprint = sourceRole ? storedSectionFingerprint(sourceRole, sectionSwapPath) : null;
      const targetFingerprint = targetRole ? storedSectionFingerprint(targetRole, sectionSwapPath) : null;
      if (!sourceFingerprint || !targetFingerprint) {
        setSwapToast("No se pudo congelar la sección almacenada para verificar el intercambio.");
        return;
      }
      const expected = frozenSwapExpectation(
        [source.roleId, target.roleId],
        candidateCells,
        body,
        {
          path: sectionSwapPath,
          fingerprints: new Map([
            [source.roleId, targetFingerprint],
            [target.roleId, sourceFingerprint],
          ]),
        },
      );
      if (!expected) {
        setSwapToast("No se pudo construir una intención completa para el intercambio.");
        return;
      }
      pendingSwapExpected.current = expected;
      const response = await fetch("/api/admin/roles/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: expected.body,
      });
      if (!response.ok) {
        await handleRejectedStoredSwap(response, "las secciones");
        return;
      }
      setSwapVerificationPending(true);
      setSwapToast("Secciones intercambiadas; verificando…");
      setSectionSwapFirst("");
      setSectionSwapSecond("");
      if (!await storedSource.reload()) {
        setSwapVerificationPending(true);
        setSwapToast("El intercambio respondió correctamente, pero no se pudo verificar la recarga.");
      }
    } catch {
      setSwapVerificationPending(true);
      setSwapToast("Resultado desconocido. No se reintentó; recarga para verificar.");
    } finally {
      setSavingStored(false);
    }
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
    solverUnfilled?: { columnId: string; rowId: string }[],
  ) {
    const specialColumnIds = new Set(
      columns.filter(c => c.type === "special_role").map(c => c.columnId),
    );
    let next = baseCells;
    const filled: { columnId: string; rowId: string }[] = [];
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
      ...(solverUnfilled ?? prev.filter(u => !specialColumnIds.has(u.columnId))),
      ...filled,
    ]);
    setDrafts(prev => cellsToDrafts(next, columns, skippedColumnIds, prev, existingRoles));
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
    //
    // INVARIANT the drag gate's P3 cache depends on: this loop only runs a
    // growing `createdTargets.current.add` when `created.size > 0`, and that
    // is exactly the condition already guarded by `setDrafts` above — so every
    // growth of this set is paired with a `drafts` identity change in the same
    // tick. `canReceiveDrop` (below) closes over `createdTargets.current` and
    // is memoized only on `[drafts, preflight, preflights]`; `createMoveGate`'s
    // cache is keyed on `canReceiveDrop`'s identity (`moveGate.ts`, "cache
    // dropped WHOLE the moment any input identity changes"). Grow this set
    // without a paired `drafts` identity change and the P3 cache goes stale —
    // a drag can be served a `clean` verdict for a column that was actually
    // just created, and the person vanishes from the month in one gesture (the
    // exact hazard P3 exists to prevent). If a future write to this ref is
    // added on a path that does not already `setDrafts`, add one, or thread a
    // fresh dependency into `canReceiveDrop`'s `useCallback` deps.
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
  const creatingColumnIds = new Set(toCreate.map((d) => createColumnId(d._type, d.date)));
  const creatableColumns = columns.filter((c) => creatingColumnIds.has(c.columnId));
  const participationRoles = plannerParticipationRoles({
    saved: participationSaved,
    creatableColumns: storedMode ? columns : creatableColumns,
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
          <label className="font-label text-xs uppercase tracking-widest text-mono-500">Mes</label>
          <select className={selCls} value={month} onChange={e => setMonth(Number(e.target.value))}>
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="font-label text-xs uppercase tracking-widest text-mono-500">Año</label>
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
        <p className="font-body text-xs text-warning-strong bg-warning-fg/10 rounded-lg px-3 py-2">{gateBlocked}</p>
      )}

      <div className="flex gap-3">
        <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg border border-surface-accent-30 font-label text-xs uppercase tracking-widest hover:border-accent dark:hover:border-surface-accent-30 transition-colors">
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
          className="flex-1 py-2 rounded-lg bg-surface-accent-solid text-on-fill hover:bg-accent-deep/80 dark:hover:bg-accent/30 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50"
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
          <p className="font-label text-xs uppercase tracking-widest text-mono-500">{MONTHS[month - 1]} {year}</p>
          {storedMode ? (
            <p className="font-body text-sm">
              <span className="text-accent font-semibold">{storedColumns.length}</span> servicio{storedColumns.length !== 1 ? "s" : ""}
              {dirtyStoredColumns.length + invalidStoredColumns.length > 0 && <span className="text-warning-soft"> · {dirtyStoredColumns.length + invalidStoredColumns.length} con cambios</span>}
            </p>
          ) : (
            <p className="font-body text-sm">
              <span className="text-accent font-semibold">{toCreate.length}</span> por crear
              {skippedCount > 0 && <span className="text-mono-500"> · {skippedCount} omitido{skippedCount !== 1 ? "s" : ""}</span>}
              {notCreatable > 0 && (
                <span className="text-warning-strong"> · {notCreatable} no disponible{notCreatable !== 1 ? "s" : ""}</span>
              )}
            </p>
          )}
        </div>
        <button type="button" onClick={requestBack} disabled={storedTransportActive} className="font-label text-xs uppercase tracking-widest text-mono-500 hover:text-accent transition-colors disabled:opacity-50">
          {storedMode ? "Cerrar" : "← Volver"}
        </button>
      </div>

      {storedMode && (!storedSource || !storedInventory.coherent) && (
        <div className="rounded-lg border border-warning-fg/30 bg-warning-fg/10 px-3 py-2.5">
          <p className="font-body text-sm text-warning-faint">No se puede editar este mes hasta verificar todos los servicios.</p>
          <p className="mt-1 font-body text-xs text-warning-soft/85">
            {storedSource?.rolesStatus === "error" || storedSource?.integrityStatus === "error"
              ? "Falló una fuente de datos. Reintenta la carga."
              : storedInventory.reasons.join(", ") || "Cargando datos…"}
          </p>
          {storedSource && (
            <button type="button" onClick={() => void storedSource.reload()} className="mt-2 min-h-[44px] rounded-lg border border-warning-soft/30 px-3 font-label text-xs uppercase tracking-widest">
              Reintentar
            </button>
          )}
        </div>
      )}

      {storedMode && storedInventory.coherent && (
        <div className="rounded-lg border border-accent/15 bg-accent/5 px-3 py-3">
          {!composerOpen ? (
            <button
              type="button"
              onClick={() => setComposerOpen(true)}
              disabled={storedMutationLocked || storedHasUnresolvedWork || !!storedCreateBlocked}
              title={storedCreateBlocked ?? undefined}
              className="min-h-[44px] rounded-lg border border-accent/25 px-4 font-label text-xs uppercase tracking-widest text-accent disabled:opacity-50"
            >
              + Nuevo servicio
            </button>
          ) : (
            <div className="grid gap-3 md:grid-cols-[1fr_1fr_1.4fr_auto] md:items-end">
              <label className="space-y-1 font-label text-[10px] uppercase tracking-widest text-mono-500">
                Tipo
                <select value={createType} disabled={storedMutationLocked} onChange={(event) => setCreateType(event.target.value as ServiceType)} className={selCls}>
                  <option value="sunday_role">Domingo</option>
                  <option value="saturday_role">Sábado</option>
                  <option value="special_role">Especial</option>
                </select>
              </label>
              <label className="space-y-1 font-label text-[10px] uppercase tracking-widest text-mono-500">
                Fecha
                <input type="date" value={createDate} disabled={storedMutationLocked} min={`${monthPrefix}-01`} max={`${monthPrefix}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`} onChange={(event) => setCreateDate(event.target.value)} className={inCls} />
              </label>
              {createType === "special_role" ? (
                <label className="space-y-1 font-label text-[10px] uppercase tracking-widest text-mono-500">
                  Nombre
                  <input value={createName} disabled={storedMutationLocked} onChange={(event) => setCreateName(event.target.value)} className={inCls} placeholder="Nombre del servicio" />
                </label>
              ) : <div />}
              <div className="flex gap-2">
                <button type="button" onClick={() => void handleCreateOne()} disabled={creatingOne || (storedMutationLocked && createAttemptStatus !== "unknown") || storedWriteUnresolved || createAttemptStatus === "committedUnverified" || !!storedCreateBlocked} title={storedCreateBlocked ?? undefined} className="min-h-[44px] rounded-lg bg-surface-accent-solid text-on-fill px-4 font-label text-xs uppercase tracking-widest disabled:opacity-50">
                  {creatingOne ? "Creando…" : createAttemptStatus === "unknown" ? "Reintentar misma solicitud" : createAttemptStatus === "committedUnverified" ? "Verificando…" : "Crear vacío"}
                </button>
                <button type="button" onClick={() => setComposerOpen(false)} disabled={creatingOne || createAttemptStatus !== null} className="min-h-[44px] rounded-lg border border-accent/20 px-3 font-label text-xs uppercase tracking-widest disabled:opacity-50">
                  Cancelar
                </button>
                {createAttemptStatus && (
                  <button type="button" onClick={() => void storedSource?.reload()} className="min-h-[44px] rounded-lg border border-accent/20 px-3 font-label text-xs uppercase tracking-widest text-accent">
                    Recargar
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {storedMode && storedEditBlocked && (
        <p className="rounded-lg bg-warning-fg/10 px-3 py-2 font-body text-xs text-warning-soft">{storedEditBlocked}</p>
      )}

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
        <div className="rounded-lg border border-warning-fg/30 bg-warning-fg/10 px-3 py-2.5 space-y-2">
          <p className="font-body text-xs text-warning-soft">
            {storedMode
              ? `Cerrar descarta ${dirtyStoredColumns.length + invalidStoredColumns.length} servicio${dirtyStoredColumns.length + invalidStoredColumns.length !== 1 ? "s" : ""} con cambios o resultado pendiente. ¿Continuar?`
              : `${pendingDiscard === "back" ? "Volver a configuración" : "Cerrar"} descarta ${assignmentCount} asignación${assignmentCount !== 1 ? "es" : ""} en este mes. ¿Continuar?`}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={confirmPendingDiscard}
              disabled={storedTransportActive}
              className="min-h-[44px] rounded-lg bg-surface-accent-solid text-on-fill px-3 font-label text-xs uppercase tracking-widest disabled:opacity-50"
            >
              {!storedMode && pendingDiscard === "back" ? "Volver de todos modos" : "Cerrar de todos modos"}
            </button>
            <button type="button" onClick={() => setPendingDiscard(null)} className="min-h-[44px] rounded-lg border border-accent/20 px-3 font-label text-xs uppercase tracking-widest">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {!storedMode && <div className="flex justify-center">
        <div className="flex rounded-lg border border-surface-accent-30 overflow-hidden">
          <button type="button" onClick={() => setViewMode("edit")}
            className={`px-5 py-2 font-label text-xs uppercase tracking-widest transition-colors ${
              viewMode === "edit" ? "bg-surface-accent-solid text-on-fill text-ink-muted" : "text-mono-500 hover:text-ink-muted"}`}>
            Editar
          </button>
          <button type="button" onClick={() => setViewMode("view")}
            className={`px-5 py-2 font-label text-xs uppercase tracking-widest transition-colors border-l border-accent-deep/30 dark:border-accent/20 ${
              viewMode === "view" ? "bg-surface-accent-solid text-on-fill text-ink-muted" : "text-mono-500 hover:text-ink-muted"}`}>
            Vista
          </button>
        </div>
      </div>}

      {viewMode === "edit" && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-label text-[11px] uppercase tracking-widest text-mono-500">⇄ Intercambiar equipos:</span>
          {columns.map(col => (
            <button
              key={col.columnId}
              type="button"
              data-swap-date={col.date}
              onClick={() => handleColumnSwap(col.columnId)}
              disabled={storedMode && storedSwapInteractionBlocked}
              className={`min-h-[44px] px-2 py-1 rounded-full border text-[10px] font-label uppercase tracking-widest transition-colors ${
                swapSel === col.columnId
                  ? "border-accent bg-accent/20 text-accent"
                  : "border-accent/15 text-mono-500 hover:text-accent"
              }`}
            >
              {fmtDate(col.date)}
            </button>
          ))}
          {swapSel && <span className="font-label text-[11px] uppercase tracking-widest text-accent animate-pulse">Selecciona otra columna ⇄</span>}
        </div>
      )}

      {storedMode && (
        <div className="grid gap-2 rounded-lg border border-accent/15 p-3 md:grid-cols-[0.8fr_1fr_1fr_auto] md:items-end">
          <label className="space-y-1 font-label text-[10px] uppercase tracking-widest text-mono-500">
            Sección
            <select value={sectionSwapPath} disabled={storedSwapInteractionBlocked} onChange={(event) => setSectionSwapPath(event.target.value as StoredSectionPath)} className={selCls}>
              {STORED_SECTION_OPTIONS.map((option) => <option key={option.path} value={option.path}>{option.label}</option>)}
            </select>
          </label>
          <label className="space-y-1 font-label text-[10px] uppercase tracking-widest text-mono-500">
            Primer servicio
            <select value={sectionSwapFirst} disabled={storedSwapInteractionBlocked} onChange={(event) => setSectionSwapFirst(event.target.value)} className={selCls}>
              <option value="">Seleccionar…</option>
              {storedSectionServiceOptions.map((option) => <option key={`a:${option.column.roleId}`} value={option.column.roleId}>{option.label}</option>)}
            </select>
          </label>
          <label className="space-y-1 font-label text-[10px] uppercase tracking-widest text-mono-500">
            Segundo servicio
            <select value={sectionSwapSecond} disabled={storedSwapInteractionBlocked} onChange={(event) => setSectionSwapSecond(event.target.value)} className={selCls}>
              <option value="">Seleccionar…</option>
              {storedSectionServiceOptions.map((option) => <option key={`b:${option.column.roleId}`} value={option.column.roleId}>{option.label}</option>)}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void handleSectionSwap()}
            disabled={storedSwapInteractionBlocked || !sectionSwapFirst || !sectionSwapSecond || sectionSwapFirst === sectionSwapSecond || sectionSwapTopologyInvalid}
            title={sectionSwapTopologyInvalid ? "Coro no está disponible en servicios de sábado." : undefined}
            className="min-h-[44px] rounded-lg border border-accent/25 px-4 font-label text-xs uppercase tracking-widest text-accent disabled:opacity-50"
          >
            Intercambiar sección
          </button>
        </div>
      )}

      {swapToast && (
        <div className="flex items-center justify-center gap-2 rounded-lg bg-accent/10 px-3 py-1.5">
          <p className="font-label text-[11px] uppercase tracking-widest text-accent text-center">{swapToast}</p>
          {storedMode && swapVerificationPending && storedSource && (
            <button type="button" onClick={() => void storedSource.reload()} className="min-h-[44px] rounded-lg border border-accent/25 px-3 font-label text-[10px] uppercase tracking-widest text-accent">
              Recargar y verificar
            </button>
          )}
        </div>
      )}

      {unavailabilityNotices.length > 0 && (() => {
        // Group by person name
        const byPerson = new Map<string, { date: string; service: string }[]>();
        for (const n of unavailabilityNotices) {
          if (!byPerson.has(n.name)) byPerson.set(n.name, []);
          byPerson.get(n.name)!.push({ date: n.date, service: n.service });
        }
        return (
          <div className="rounded-lg border border-availability-fg/25 bg-availability-fg/10 px-3 py-2.5 space-y-1.5">
            <p className="font-label text-[11px] uppercase tracking-widest text-availability-strong">
              No disponibles este mes
            </p>
            {Array.from(byPerson.entries()).map(([name, items]) => (
              <p key={name} className="font-body text-xs text-mono-400">
                <span className="text-availability-soft font-semibold">{name}</span>
                {" — "}
                {items.map(i => `${i.service} ${new Date(i.date + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "short" })}`).join(", ")}
              </p>
            ))}
          </div>
        );
      })()}

      {viewMode === "edit" ? (
        <PlannerGrid
          mode={storedMode ? "stored" : "create"}
          rows={rows}
          columns={columns}
          cells={cells}
          members={members}
          savedWindow={savedWindow}
          preflightFor={col => storedMode ? null : (preflight ? preflight(col.type, col.date) : null)}
          createBlockFor={col => storedMode ? null : createBlockFor(col)}
          /*
            P3 — the drag gate's create-mode drop guard, and the ONE authority
            for it (`isDraftCreatable`). Passed in stored mode too, where the
            gate never consults it: every stored column is a document that
            already exists, so there is nothing to refuse. `PlannerGrid` demands
            it unconditionally for the reason `moveGate` demands it — a P3 that
            can be forgotten is a P3 that loses somebody from the month with no
            type error and no runtime signal.
          */
          canReceive={canReceiveDrop}
          skipped={skippedColumnIds}
          unaddressableDates={unaddressableDatesList}
          unresolvedNames={allUnresolvedNames}
          unfilled={unfilled}
          onCellsChange={handleCellsChange}
          onRowsChange={handleRowsChange}
          onToggleSkip={handleToggleSkip}
          onStoredHeaderChange={handleStoredHeaderChange}
          storedDateBlockedReason={storedDateBlocked}
          mutationLocked={storedMutationLocked}
          onAuto={handleAuto}
          autoState={autoState}
          diagnostics={diagnostics}
          config={solverConfig ?? undefined}
          sundayDates={sundayDatesFull}
          // INLINE ON PURPOSE, for now — and worth knowing before "fixing" it.
          // A fresh closure every render means the drag gate's WHOLE verdict
          // cache (`moveGate.ts`'s `createMoveGate`, keyed in part on this
          // prop's identity) is dropped on every `MonthGenerator` re-render,
          // including the one `handleConfirm` triggers. That currently masks a
          // narrower question: whether `canReceiveDrop`'s OWN identity tracks
          // `createdTargets.current` correctly (see the invariant comment on
          // that mutation, and `moveGate.ts`'s `createMoveGate`). Memoizing
          // this closure would be a reasonable-looking perf pass, but it would
          // remove that safety net and make the P3 cache depend ENTIRELY on
          // the `createdTargets`/`canReceiveDrop`/`setDrafts` coupling holding
          // — do so only alongside re-verifying that coupling, not as an
          // unrelated cleanup.
          sundayDatesForColumn={(column) => ruleContextForTarget(column.type, column.date)?.sundayDates ?? []}
          /*
            The participation chart, handed to the grid as the LEFT COLUMN of
            its three-column workspace (`PlannerGrid.tsx`'s header has the
            widths). Built here, rendered there — the counts are a function of
            `cells`, which is this component's state, so lifting the arithmetic
            into `PlannerGrid` would export the grid's draft state to a
            component that has no other use for it. Only the placement moved.

            This used to go through a `ParticipationRail` component (since
            deleted) with `placement="panel"`, mounted below the grid: it put the
            chart in the page's left gutter above
            1700px and stacked it under the grid below that. It never reached
            the 1512px laptop this is planned on — the admin page caps content
            at 1280px, leaving ~116px of gutter for a 216px chart. It now costs
            the grid 216px at every width, on purpose — the same 216, because it
            is the chart's own content floor either way.
          */
          participation={
            <ParticipationSidebar
              roles={participationRoles}
              // The month IS the scope now (`participationSaved`), so the month
              // names itself honestly and the subtitle only has to say that the
              // drafts on screen are already in the count alongside what is
              // stored. The old label had to warn that January was in a
              // February total; nothing from another month can reach this chart
              // any more.
              monthLabel={`${MONTHS[month - 1]} ${year} · guardados + borradores`}
            />
          }
          monthLabel={`${MONTHS[month - 1]} ${year}`}
        />
      ) : !storedMode ? (
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
      ) : null}

      {/*
        In "Vista" mode there is no `PlannerGrid` to hold the chart's column, so
        the same chart stacks here under the day cards — the placement this
        surface had below the gutter threshold, kept for the one mode that has
        no three-column layout to put it in.
      */}
      {!storedMode && viewMode === "view" && (
        <div data-participation-rail="panel" data-rail-placement="stacked">
          <ParticipationSidebar
            roles={participationRoles}
            monthLabel={`${MONTHS[month - 1]} ${year} · guardados + borradores`}
          />
        </div>
      )}

      {/* In "edit" mode `PlannerGrid` already surfaces this via `autoState.disabledReason`
          next to Auto — showing it again here would duplicate the same text. */}
      {gateBlocked && viewMode === "view" && (
        <p className="font-body text-xs text-warning-strong bg-warning-fg/10 rounded-lg px-3 py-2">{gateBlocked}</p>
      )}

      {(pushError || saveNotice) && (
        <p className={`font-label text-xs uppercase tracking-widest text-center rounded-lg py-1.5 ${pushError ? "bg-negative-strong/10 text-negative-fg" : "bg-accent/10 text-accent"}`}>
          {pushError ?? saveNotice}
        </p>
      )}
      {storedMode && invalidStoredColumns.length > 0 && (
        <p className="rounded-lg bg-negative-strong/10 px-3 py-2 font-body text-xs text-negative-muted">
          Corrige los datos inválidos antes de guardar: {invalidStoredColumns.map((column) => column.date).join(", ")}.
        </p>
      )}

      {storedMode ? (
        <div className="flex gap-3">
          <button type="button" onClick={requestBack} disabled={storedTransportActive} className="flex-1 min-h-[44px] rounded-lg border border-surface-accent-30 font-label text-xs uppercase tracking-widest hover:border-accent dark:hover:border-surface-accent-30 transition-colors disabled:opacity-50">
            Cerrar
          </button>
          <button
            type="button"
            onClick={() => void handleStoredSave()}
            disabled={storedMutationLocked || dirtyStoredColumns.length === 0 || invalidStoredColumns.length > 0 || !storedInventory.coherent || !!storedSaveBlocked}
            title={storedSaveBlocked ?? undefined}
            className="flex-1 min-h-[44px] rounded-lg bg-surface-accent-solid text-on-fill hover:bg-accent-deep/80 dark:hover:bg-accent/30 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50"
          >
            {savingStored ? "Guardando…" : `Guardar ${dirtyStoredColumns.length} servicio${dirtyStoredColumns.length !== 1 ? "s" : ""}`}
          </button>
        </div>
      ) : (
        <div className="flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg border border-surface-accent-30 font-label text-xs uppercase tracking-widest hover:border-accent dark:hover:border-surface-accent-30 transition-colors">
            Cancelar
          </button>
          <button type="button" onClick={() => handleConfirm(false)} disabled={pushing || toCreate.length === 0 || !!gateBlocked} title={gateBlocked ?? undefined} className="flex-1 py-2 rounded-lg bg-surface-accent-solid text-on-fill hover:bg-accent-deep/80 dark:hover:bg-accent/30 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50">
            {pushing ? "Creando..." : `Crear ${toCreate.length} borrador${toCreate.length !== 1 ? "es" : ""}`}
          </button>
          <button type="button" onClick={() => handleConfirm(true)} disabled={pushing || toCreate.length === 0 || !!gateBlocked} title={gateBlocked ?? undefined} className="flex-1 py-2 rounded-lg bg-surface-accent-solid text-on-fill hover:bg-accent-deep/80 dark:hover:bg-accent/30 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50">
            Crear y publicar
          </button>
        </div>
      )}
    </div>
  );
}
