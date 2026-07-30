// app/components/admin/plannerModel.ts
//
// The month-grid's shape (rows, columns, cells) and both translations to and
// from the solver's wire format. Pure — no React, no network, no
// `Date.now()`-dependent behaviour. `PlannerGrid` (Task 3) renders what this
// returns and decides nothing; `MonthGenerator` (Task 4) owns the fetch, the
// `cells`/`counts` state, and threading `previous` across calls.
//
// Six things adversarial review found broken in the code this replaces —
// every test in the sibling `__tests__/plannerModel.test.ts` exists because
// one of these was verified, not guessed:
//
//  1. Saturday↔week is ADJACENCY on Sundays, never position (fact 10).
//  2. The positional Saturday fallback is GONE (D16) — an unaddressable
//     Saturday stays unaddressable rather than being assigned a week by index.
//  3. The rendered column set is an EXPLICIT input (D9) — never inferred from
//     `sundayDates`, so unchecking Domingos can never leak a Sunday draft.
//  4. Every cell is multi-occupant (D3) — voice, instrument and FOH alike.
//  5. `total_counts` is recomputed from the retained `role_counts`, never
//     passed through raw once `role_counts` has been filtered (D19).
//  6. Availability rules only ever name POOL members (fact 15) — a DSL-named
//     non-pool member is schedulable while unavailable, by design, not bug.

import type { SolveRequest, SolveResponse } from "@/app/api/admin/solve/route";
import { parseUnfilledSeat } from "@/app/utils/unfilledSeats";
import type { RankMember } from "./candidateRanking";
import {
  DEFAULT_FOH_SEATS,
  DEFAULT_INSTRUMENT_SEATS,
  VOICE_SEATS,
  fohSeatDef,
  instrumentSeatDef,
  type SeatCategory,
  type SeatDef,
} from "./seatModel";
import { newCreationRequestId } from "@/app/utils/monthDraftCreate";

// ─── Grid shape ───────────────────────────────────────────────────────────────

export type CellOrigin = "manual" | "auto" | "empty";

export interface GridCell {
  date: string;
  rowId: string;
  memberIds: string[];
  origin: CellOrigin;
}

export interface GridRow {
  id: string;
  label: string;
  category: SeatCategory;
  /** Auto's fill goal (D6) — advisory only, never a limit and never enforced. */
  target: number | null;
}

export type ColumnType = "sunday_role" | "saturday_role";

export interface GridColumn {
  date: string;
  type: ColumnType;
}

// ─── Draft cards (the create-path shape `MonthGenerator` already posts) ──────

export type ServiceType = ColumnType;

export interface DraftInstrumentSlot {
  id: string;
  instrument: string;
  personId: string;
}

export interface DraftFohSlot {
  id: string;
  role: string;
  personId: string;
}

export interface DraftCard {
  localId: string;
  /** Opaque per-draft creation idempotency key — see `monthDraftCreate.ts`. */
  creationRequestId: string;
  _type: ServiceType;
  date: string;
  exists: boolean;
  skipped: boolean;
  leads: string[];
  bgvs: string[];
  chorus: string[];
  instruments: DraftInstrumentSlot[];
  foh: DraftFohSlot[];
}

export interface ExistingRoleRef {
  _type: string;
  date: string;
}

// ─── Solver config + fairness history (mirrors `MonthGenerator`'s local types
// so this module stays importable without a component dependency; Task 4
// switches `MonthGenerator` to import these instead of redeclaring them) ─────

export interface WeekExclusion {
  id: string;
  week: number;
  pattern: string;
}

export interface RestrictionCap {
  id: string;
  pattern: string;
  op: "<=" | ">=" | "==";
  value: number;
  relative: boolean;
  relOffset: number;
}

export interface PersonRestriction {
  id: string;
  person: string;
  excludedPatterns: string[];
  fairness: "none" | "exempt" | "slack";
  fairnessSlack: number;
  weekExclusions: WeekExclusion[];
  caps: RestrictionCap[];
}

export interface ConflictRule {
  id: string;
  personA: string;
  personB: string;
  pattern: string;
}

export interface PresenceRule {
  id: string;
  persons: string[];
  pattern: string;
}

export interface SolverConfig {
  sundayLeads: string[];
  saturdayLeads: string[];
  support: string[];
  restrictions: PersonRestriction[];
  conflicts: ConflictRule[];
  presence: PresenceRule[];
}

export interface SolverHistoryEntry {
  key: string; // "YYYY-M"
  year: number;
  month: number;
  total_counts: Record<string, number>;
  role_counts: Record<string, Record<string, number>>;
}

// ─── Row/column shape ─────────────────────────────────────────────────────────

const VOICE_TARGETS: Record<string, number> = { lead: 2, bgv: 3, coro: 3 };

/**
 * Seeded for an uncreated month. Defaults give 3 voice + 5 instrument + 1 FOH
 * = 9 rows, matching `DEFAULT_INSTRUMENT_SEATS`/`DEFAULT_FOH_SEATS`.
 */
export function buildRows(input: { instrumentSeats?: string[]; fohSeats?: string[] } = {}): GridRow[] {
  const instrumentSeats = input.instrumentSeats ?? DEFAULT_INSTRUMENT_SEATS;
  const fohSeats = input.fohSeats ?? DEFAULT_FOH_SEATS;

  const voice: GridRow[] = VOICE_SEATS.map((s) => ({
    id: s.id,
    label: s.label,
    category: s.category,
    target: VOICE_TARGETS[s.id] ?? null,
  }));
  const instruments: GridRow[] = instrumentSeats.map((name) => {
    const def = instrumentSeatDef(name);
    return { id: def.id, label: def.label, category: def.category, target: 1 };
  });
  const foh: GridRow[] = fohSeats.map((name) => {
    const def = fohSeatDef(name);
    return { id: def.id, label: def.label, category: def.category, target: 1 };
  });
  return [...voice, ...instruments, ...foh];
}

/**
 * Solvability is a (row, column) predicate, not a row flag: Coro is solvable
 * on Sunday columns and not on Saturday ones, because the solver has no
 * `Sat.Choir` (fact 2, D11). Instrument and FOH rows are always manual (D5).
 */
export function isSolvable(row: GridRow, column: GridColumn): boolean {
  if (row.category !== "voz") return false;
  if (row.id === "coro") return column.type === "sunday_role";
  return row.id === "lead" || row.id === "bgv";
}

/**
 * The EXPLICIT column set of D9: never inferred from `sundayDates` — the
 * solve may still run on the full Sunday list while zero Sunday columns (and
 * therefore zero Sunday drafts) exist.
 */
export function buildColumns(input: {
  sundayDates: string[];
  activeSatDates: string[];
  includeSundays?: boolean;
}): GridColumn[] {
  const { sundayDates, activeSatDates, includeSundays = true } = input;
  const cols: GridColumn[] = [];
  if (includeSundays) for (const d of sundayDates) cols.push({ date: d, type: "sunday_role" });
  for (const d of activeSatDates) cols.push({ date: d, type: "saturday_role" });
  return cols.sort((a, b) => a.date.localeCompare(b.date));
}

/** `rankCandidates` needs a `SeatDef` and filters on `memberType` (fact 24). */
export function seatDefForRow(row: GridRow): SeatDef {
  if (row.category === "voz") {
    const found = VOICE_SEATS.find((s) => s.id === row.id);
    if (found) return found;
  }
  if (row.category === "instrumento") return instrumentSeatDef(row.label);
  if (row.category === "foh") return fohSeatDef(row.label);
  throw new Error(`seatDefForRow: unrecognised row ${row.id}`);
}

/**
 * The window is the calendar month (D8), so `weeks` is always 4 or 5. The
 * solver's own 3–6 guard can never fire through this path; this is a
 * defensive assert, not a state the UI needs to explain.
 */
export function solvableWindow(sundayDates: string[]): { weeks: number; solvable: boolean } {
  const weeks = sundayDates.length;
  return { weeks, solvable: weeks >= 3 && weeks <= 6 };
}

// ─── Saturday↔week mapping — adjacency, never position (fact 10, D16) ────────

function subtractDay(iso: string): string {
  const d = new Date(iso.slice(0, 10) + "T12:00:00");
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * 1-based week indexes whose Saturday (the day before that week's Sunday) is
 * in `activeSatDates`. No positional fallback (D16): a Saturday not adjacent
 * to any Sunday in `sundayDates` simply contributes no index, however many
 * Saturdays are selected.
 */
export function weekendWeekIndexes(sundayDates: string[], activeSatDates: string[]): number[] {
  const active = new Set(activeSatDates);
  const out: number[] = [];
  sundayDates.forEach((sunDate, i) => {
    if (active.has(subtractDay(sunDate))) out.push(i + 1);
  });
  return out;
}

/**
 * The Saturday adjacent to week `n`'s Sunday — regardless of selection.
 * Returns `null` for an out-of-range `n` (`sundayDates[n-1]` undefined)
 * rather than throwing. Unreachable today because callers only ever pass a
 * week number the solver derived from `weeks === sundayDates.length`, but
 * `mapUnfilledSeats` calls this with a solver-supplied week number, so it
 * must degrade instead of crashing if that ever stops holding.
 */
export function saturdayForWeek(n: number, sundayDates: string[]): string | null {
  const sunDate = sundayDates[n - 1];
  return sunDate ? subtractDay(sunDate) : null;
}

/**
 * Selected Saturdays with no adjacent Sunday in `sundayDates` — a request
 * would never staff them and a response would never resolve to them. Labelled
 * explicitly rather than silently dropped or (worse) positionally reassigned.
 */
export function unaddressableDates(sundayDates: string[], activeSatDates: string[]): string[] {
  const adjacent = new Set(sundayDates.map(subtractDay));
  return [...activeSatDates].sort().filter((d) => !adjacent.has(d));
}

// ─── Request construction ─────────────────────────────────────────────────────

function resolveToMemberName(name: string, members: RankMember[]): string {
  const lo = name.toLowerCase().trim();
  const m = members.find(
    (mm) => mm.member_name.toLowerCase().trim() === lo || mm.alias?.trim().toLowerCase() === lo,
  );
  return m?.member_name ?? name;
}

function restrictionToDs(r: PersonRestriction): string | null {
  if (!r.person) return null;
  const clauses: string[] = [];
  for (const pat of r.excludedPatterns) clauses.push(`!in ${pat}`);
  for (const we of r.weekExclusions) clauses.push(`!in week ${we.week} ${we.pattern}`);
  for (const cap of r.caps) {
    const val = cap.relative ? `{weeks-${cap.relOffset}}` : String(cap.value);
    clauses.push(`${cap.pattern} ${cap.op} ${val}`);
  }
  if (r.fairness === "exempt") clauses.push("fairness_exempt");
  if (r.fairness === "slack" && r.fairnessSlack > 0) clauses.push(`fairness_slack ${r.fairnessSlack}`);
  if (clauses.length === 0) return null;
  return `${r.person} ${clauses.join(" & ")}`;
}

function allRulesToDs(config: SolverConfig, members: RankMember[]): string[] {
  const res = (name: string) => resolveToMemberName(name, members);
  const out: string[] = [];
  for (const r of config.restrictions) {
    const resolved: PersonRestriction = { ...r, person: res(r.person) };
    const ds = restrictionToDs(resolved);
    if (ds) out.push(ds);
  }
  for (const r of config.conflicts) out.push(`${res(r.personA)} !with ${res(r.personB)} on ${r.pattern}`);
  for (const r of config.presence)
    out.push(`any_of(${r.persons.map(res).join(",")}) on ${r.pattern} each_week`);
  return out;
}

/**
 * D14's exclusion: a month's Auto run must not be fed its own previous
 * result. Retained entries are sorted oldest-first by `(year, month)` before
 * slicing, so "newest last, weight 10" (fact 9) is a property of this
 * function's output, not a convention the caller has to already uphold in
 * how it stores/passes `entries`.
 */
export function historyForRequest(
  entries: SolverHistoryEntry[],
  year: number,
  month: number,
): SolverHistoryEntry[] {
  const key = `${year}-${month}`;
  return entries
    .filter((h) => h.key !== key)
    .sort((a, b) => a.year - b.year || a.month - b.month)
    .slice(-3);
}

/**
 * Builds the literal typed `SolveRequest` (fact 7: a `weekends_with_saturday`
 * rename is now a `tsc` error, not a silent empty month). Applies
 * `historyForRequest` internally (D14) — a caller cannot forget it.
 */
export function buildSolveRequest(input: {
  config: SolverConfig;
  members: RankMember[];
  sundayDates: string[];
  activeSatDates: string[];
  historyEntries: SolverHistoryEntry[];
  year: number;
  month: number;
}): { ok: true; request: SolveRequest } | { ok: false; reason: string } {
  const { config, members, sundayDates, activeSatDates, historyEntries, year, month } = input;

  const weeks = sundayDates.length;
  const weekendsWithSaturday = weekendWeekIndexes(sundayDates, activeSatDates);

  const idToName = (id: string) => members.find((m) => m._id === id)?.member_name ?? id;

  // Deduplicate pools: sunday_leads takes priority, then saturday_leads, then
  // support. The solver requires mutual exclusivity (fact 5).
  const sundayLeadNames = config.sundayLeads.map(idToName);
  const sundaySet = new Set(sundayLeadNames);
  const saturdayLeadNames = config.saturdayLeads.map(idToName).filter((n) => !sundaySet.has(n));
  const satSet = new Set([...sundayLeadNames, ...saturdayLeadNames]);
  const supportNames = config.support.map(idToName).filter((n) => !satSet.has(n));
  const poolNames = new Set([...sundayLeadNames, ...saturdayLeadNames, ...supportNames]);

  // Every DSL-named person absent from all pools is injected into `support`,
  // so every DSL-named person appears in exactly one pool — omitting this is
  // a 422 in production (the solver validates all DSL persons against known
  // people).
  const extraSupport: string[] = [];
  const allDslPersons = [
    ...config.restrictions.map((r) => r.person),
    ...config.conflicts.flatMap((r) => [r.personA, r.personB]),
    ...config.presence.flatMap((r) => r.persons),
  ];
  for (const name of allDslPersons) {
    const resolved = resolveToMemberName(name, members);
    if (!poolNames.has(resolved) && !extraSupport.includes(resolved)) extraSupport.push(resolved);
  }

  // Auto-generate week-exclusion DSL rules from member unavailableDates. The
  // rules loop `allPoolIds` (fact 15): a non-pool member is schedulable while
  // unavailable — that is a documented consequence, not a bug to "fix" here.
  const availabilityRules: string[] = [];
  const allPoolIds = new Set([...config.sundayLeads, ...config.saturdayLeads, ...config.support]);
  for (const memberId of allPoolIds) {
    const m = members.find((x) => x._id === memberId);
    if (!m?.unavailableDates?.length) continue;
    const unavailable = new Set(m.unavailableDates);
    sundayDates.forEach((sunDate, i) => {
      const weekNum = i + 1;
      if (unavailable.has(sunDate)) availabilityRules.push(`${m.member_name} !in week ${weekNum} Sun.*`);
      const prevDay = subtractDay(sunDate);
      if (unavailable.has(prevDay)) availabilityRules.push(`${m.member_name} !in week ${weekNum} Sat.*`);
    });
  }

  const request: SolveRequest = {
    weeks,
    weekends_with_saturday: weekendsWithSaturday,
    sunday_leads: sundayLeadNames,
    saturday_leads: saturdayLeadNames,
    support: [...supportNames, ...extraSupport],
    dsl_rules: [...allRulesToDs(config, members), ...availabilityRules],
    history: historyForRequest(historyEntries, year, month).map((h) => ({
      total_counts: h.total_counts,
      role_counts: h.role_counts,
    })),
  };

  if (!request.sunday_leads.length) {
    return { ok: false, reason: "Debes seleccionar al menos un líder de domingo." };
  }

  return { ok: true, request };
}

// ─── Response mapping ─────────────────────────────────────────────────────────

const ROLE_FIELD: Record<string, "Lead" | "BGV" | "Choir"> = { lead: "Lead", bgv: "BGV", coro: "Choir" };

function weekForColumn(column: GridColumn, sundayDates: string[]): number | null {
  if (column.type === "sunday_role") {
    const i = sundayDates.indexOf(column.date);
    return i === -1 ? null : i + 1;
  }
  for (let i = 0; i < sundayDates.length; i++) {
    if (subtractDay(sundayDates[i]) === column.date) return i + 1;
  }
  return null;
}

const ROLE_KEY_TYPE: Record<string, ColumnType> = {
  "Sun.Lead": "sunday_role",
  "Sun.BGV": "sunday_role",
  "Sun.Choir": "sunday_role",
  "Sat.Lead": "saturday_role",
  "Sat.BGV": "saturday_role",
};

/**
 * `total_counts` is a separate scalar the solver reads as its own offset
 * (D19) — filtering `role_counts` while passing `total_counts` through raw
 * reproduces the defect. Recomputed here as the per-person sum of the
 * retained `role_counts`, restricted to `createdTypes`.
 */
function filterCounts(
  roleCounts: Record<string, Record<string, number>>,
  createdTypes: Set<ColumnType>,
): { total_counts: Record<string, number>; role_counts: Record<string, Record<string, number>> } {
  const role_counts: Record<string, Record<string, number>> = {};
  const total_counts: Record<string, number> = {};
  for (const [person, counts] of Object.entries(roleCounts)) {
    const kept: Record<string, number> = {};
    let sum = 0;
    for (const [key, n] of Object.entries(counts)) {
      const type = ROLE_KEY_TYPE[key];
      if (type && createdTypes.has(type)) {
        kept[key] = n;
        sum += n;
      }
    }
    role_counts[person] = kept;
    total_counts[person] = sum;
  }
  return { total_counts, role_counts };
}

export interface AppliedSolveResult {
  cells: GridCell[];
  unresolvedNames: string[];
  counts: { total_counts: Record<string, number>; role_counts: Record<string, Record<string, number>> } | null;
}

/**
 * Takes the current grid and the column set; returns the MERGED grid. Only
 * `solvable` (row, column) pairs are written, and only on columns present in
 * `columns` — everything else (every instrument/FOH cell, every non-solvable
 * voice cell) survives byte-for-byte from `previousCells`.
 */
export function applySolveResponse(input: {
  response: SolveResponse;
  previousCells: GridCell[];
  columns: GridColumn[];
  rows: GridRow[];
  sundayDates: string[];
  /**
   * Accepted but intentionally UNUSED here: the caller already built
   * `columns` by calling `buildColumns({ sundayDates, activeSatDates, ... })`
   * before this runs, so `columns` already encodes the selection and
   * re-filtering against `activeSatDates` a second time would be redundant.
   * Kept for signature symmetry with `buildSolveRequest`/`mapUnfilledSeats`
   * (both of which DO need it directly) — don't "wire it in" as a second
   * filter without first checking whether `columns` already covers the case.
   */
  activeSatDates: string[];
  members: RankMember[];
}): AppliedSolveResult {
  const { response, previousCells, columns, rows, sundayDates, members } = input;

  const nameToId = (name: string): string | null => {
    const lo = name.toLowerCase().trim();
    const m = members.find(
      (mm) => mm.member_name.toLowerCase().trim() === lo || mm.alias?.trim().toLowerCase() === lo,
    );
    return m?._id ?? null;
  };

  const byKey = new Map<string, GridCell>();
  for (const c of previousCells) byKey.set(`${c.date}|${c.rowId}`, c);

  const unresolved = new Set<string>();
  const schedule = response.schedule ?? {};

  for (const column of columns) {
    const week = weekForColumn(column, sundayDates);
    if (week == null) continue;
    const weekData = schedule[String(week)];
    if (!weekData) continue;
    const serviceData = column.type === "sunday_role" ? weekData.Sunday : weekData.Saturday;
    if (!serviceData) continue;

    for (const row of rows) {
      if (!isSolvable(row, column)) continue;
      const field = ROLE_FIELD[row.id];
      if (!field) continue;
      const names = (serviceData as Record<string, string[] | undefined>)[field];
      if (!names) continue;

      const ids: string[] = [];
      for (const name of names) {
        const id = nameToId(name);
        if (id) ids.push(id);
        else unresolved.add(name);
      }
      byKey.set(`${column.date}|${row.id}`, { date: column.date, rowId: row.id, memberIds: ids, origin: "auto" });
    }
  }

  let counts: AppliedSolveResult["counts"] = null;
  if (response.total_counts && response.role_counts) {
    const createdTypes = new Set(columns.map((c) => c.type));
    counts = filterCounts(response.role_counts, createdTypes);
  }

  return { cells: Array.from(byKey.values()), unresolvedNames: Array.from(unresolved), counts };
}

/** Places each solver `unfilled_seats` string on a row and a date. */
const ROLE_TO_ROW_ID: Record<string, string> = { Lead: "lead", BGV: "bgv", Choir: "coro" };

export function mapUnfilledSeats(
  seats: string[],
  sundayDates: string[],
  activeSatDates: string[],
): { date: string; rowId: string }[] {
  const activeSat = new Set(activeSatDates);
  const out: { date: string; rowId: string }[] = [];
  for (const seat of seats) {
    const parsed = parseUnfilledSeat(seat);
    if (!parsed) continue;
    const rowId = ROLE_TO_ROW_ID[parsed.role];
    let date: string | null = null;
    if (parsed.service === "Sunday") {
      date = sundayDates[parsed.week - 1] ?? null;
    } else {
      const satDate = saturdayForWeek(parsed.week, sundayDates);
      date = satDate && activeSat.has(satDate) ? satDate : null;
    }
    if (date) out.push({ date, rowId });
  }
  return out;
}

// ─── Cells ↔ drafts ───────────────────────────────────────────────────────────

const uid = () => Math.random().toString(36).slice(2, 9);

const INSTRUMENT_PREFIX = "instrumento:";
const FOH_PREFIX = "foh:";

/**
 * One draft per column REGARDLESS of occupancy (an omitted column would have
 * no `localId`, so `preflights.get` would miss). `skippedDates` (D18) is the
 * single explicit channel for a user-toggled skip; a date already `exists`
 * (in `existingRoles`) is ALSO skipped, mirroring today's `buildEmptyDrafts`
 * default — editing an existing service is A · Tablero's job (D4), not this
 * generator's.
 *
 * `localId`/`creationRequestId`/`exists` are looked up in `previous` by
 * `(type, date)`: pass the prior call's drafts to preserve them across an
 * ordinary re-render, or `[]` for a genuinely new Auto run so every column
 * mints fresh ids (fact 19).
 */
export function cellsToDrafts(
  cells: GridCell[],
  columns: GridColumn[],
  skippedDates: Set<string>,
  previous: DraftCard[],
  existingRoles: ExistingRoleRef[],
): DraftCard[] {
  const existing = new Set(existingRoles.map((r) => `${r._type}__${r.date}`));
  const prevByKey = new Map(previous.map((d) => [`${d._type}__${d.date}`, d]));

  const cellsByDate = new Map<string, GridCell[]>();
  for (const c of cells) {
    const list = cellsByDate.get(c.date);
    if (list) list.push(c);
    else cellsByDate.set(c.date, [c]);
  }

  const out: DraftCard[] = [];
  for (const column of columns) {
    const key = `${column.type}__${column.date}`;
    const prevDraft = prevByKey.get(key);
    const localId = prevDraft?.localId ?? uid();
    const creationRequestId = prevDraft?.creationRequestId ?? newCreationRequestId();
    const isExisting = existing.has(key);
    const skipped = skippedDates.has(column.date) || isExisting;
    const exists = isExisting || prevDraft?.exists === true;

    const dateCells = cellsByDate.get(column.date) ?? [];
    const idsFor = (rowId: string) => dateCells.find((c) => c.rowId === rowId)?.memberIds ?? [];

    const leads = idsFor("lead");
    const bgvs = idsFor("bgv");
    const chorus = idsFor("coro");

    const instruments: DraftInstrumentSlot[] = [];
    const foh: DraftFohSlot[] = [];
    for (const c of dateCells) {
      if (c.rowId.startsWith(INSTRUMENT_PREFIX)) {
        const label = c.rowId.slice(INSTRUMENT_PREFIX.length);
        c.memberIds.forEach((personId, idx) =>
          instruments.push({ id: `${c.rowId}#${idx}`, instrument: label, personId }),
        );
      } else if (c.rowId.startsWith(FOH_PREFIX)) {
        const label = c.rowId.slice(FOH_PREFIX.length);
        c.memberIds.forEach((personId, idx) => foh.push({ id: `${c.rowId}#${idx}`, role: label, personId }));
      }
    }

    out.push({
      localId,
      creationRequestId,
      _type: column.type,
      date: column.date,
      exists,
      skipped,
      leads,
      bgvs,
      chorus,
      instruments,
      foh,
    });
  }

  return out.sort((a, b) => a.date.localeCompare(b.date));
}
