// app/components/admin/plannerModel.ts
//
// The month-grid's shape (rows, columns, cells) and both translations to and
// from the solver's wire format. Pure — no React, no network, no
// `Date.now()`-dependent behaviour. `PlannerGrid` (Task 3) renders what this
// returns and decides nothing; `MonthGenerator` (Task 4) owns the fetch, the
// `cells` state, and threading `previous` across calls.
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
//  5. Fairness history is derived from the services actually CREATED, never
//     from the solver's raw response (2026-07-30 fix) — `applySolveResponse`
//     used to carry a filtered `counts` field for this (D19's now-removed
//     `total_counts`-recompute-on-filter fix), but that persisted a proposal
//     nobody had committed to, and a hand-edit after Auto never changed what
//     got recorded. `historyEntryFromDrafts` below replaces it, fed only
//     `result.createdLocalIds` from `MonthGenerator`'s create batch.
//  6. Availability rules only ever name POOL members (fact 15) — a DSL-named
//     non-pool member is schedulable while unavailable, by design, not bug.

import type { SolveRequest, SolveResponse } from "@/app/api/admin/solve/route";
import { parseUnfilledSeat } from "@/app/utils/unfilledSeats";
import type { ParticipantRole } from "@/app/utils/computeParticipation";
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
 * Whether a row exists at all on a given column.
 *
 * **A Saturday service has no Coro.** That is the domain rule, confirmed by the
 * team and matched by the data: 0 of 8 stored `saturday_role` documents carry a
 * `Chorus`, against 19 of 19 Sundays. Earlier drafts rendered a Coro row on
 * Saturday columns as merely non-solvable, on the theory that it preserved a
 * capability the old UI offered — but that capability was an artifact of
 * `ServiceForm` showing one Coro picker for every service type, not something
 * the team ever used. Offering it invites an assignment that should not exist.
 */
export function rowAppliesTo(row: GridRow, column: GridColumn): boolean {
  if (row.id === "coro") return column.type === "sunday_role";
  return true;
}

/**
 * Whether **Auto** fills this cell. A row that does not apply is never solvable;
 * beyond that, the solver covers Lead and BGV on both service types and Coro on
 * Sundays only, and instrument and FOH rows are always manual (D5).
 */
export function isSolvable(row: GridRow, column: GridColumn): boolean {
  if (!rowAppliesTo(row, column)) return false;
  if (row.category !== "voz") return false;
  return row.id === "lead" || row.id === "bgv" || row.id === "coro";
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

/**
 * Canonical id -> NAME resolution: the solver identifies people by name, never
 * id (`gcf/owt_solver_v2.py:454`, `:280`). Falls back to the raw id when no
 * member matches. `buildSolveRequest` (pools) and `historyEntryFromDrafts`
 * (fairness history) both resolve through this ONE function so a pool name
 * and a history-entry name can never disagree about what the same id means.
 */
export function memberIdToName(id: string, members: RankMember[]): string {
  return members.find((m) => m._id === id)?.member_name ?? id;
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

  const idToName = (id: string) => memberIdToName(id, members);

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

export interface AppliedSolveResult {
  cells: GridCell[];
  unresolvedNames: string[];
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

  return { cells: Array.from(byKey.values()), unresolvedNames: Array.from(unresolved) };
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
    // A Saturday service has no Coro, so its chorus is empty whatever the grid
    // holds — a stray cell can never reach the write.
    const chorus = column.type === "saturday_role" ? [] : idsFor("coro");

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

// ─── Fairness history from CREATED drafts ────────────────────────────────────

/**
 * The role-key vocabulary the solver understands
 * (`gcf/owt_solver_v2.py:34`, `:547-561`). There is no `Sat.Choir` — a
 * Saturday draft's `chorus` is ignored rather than inventing a key the solver
 * would not recognise (`cellsToDrafts` already zeroes it on write, but this
 * stays defensive rather than assuming that always holds upstream).
 */
const HISTORY_ROLE_KEYS: Record<ServiceType, { leads: string; bgvs: string; chorus: string | null }> = {
  sunday_role: { leads: "Sun.Lead", bgvs: "Sun.BGV", chorus: "Sun.Choir" },
  saturday_role: { leads: "Sat.Lead", bgvs: "Sat.BGV", chorus: null },
};

/**
 * Derives a fairness-history entry from the services actually CREATED — never
 * from what the solver merely proposed. That was the defect: `handleAuto`
 * used to persist history the instant a solve returned, so closing the panel
 * without creating anything still penalised people next month for services
 * that never existed, and a hand-edit after Auto (or a month assigned by hand
 * with no Auto run at all) never showed up in fairness history either way.
 *
 * `createdDrafts` MUST already be filtered to whatever the caller considers
 * "happened" — a skipped column or a draft that failed to create must never
 * reach here. This function deliberately does NOT filter its input itself
 * (`plannerModel.test.ts` pins that a skipped draft passed in is still
 * counted): the caller — `MonthGenerator.handleConfirm` — is the one that
 * knows which drafts this batch just created, which were already `exists`
 * from an earlier confirm this session or from before it, and which merely
 * failed or were skipped, so it owns the filtering. Keeping that decision out
 * of this function keeps it a pure projection of "seats in, counts out",
 * trivially testable with hand-built `DraftCard`s, and free to be fed any
 * caller-chosen subset — including the UNION `handleConfirm` now passes to
 * self-correct a retried partial batch — without a defensive guard here
 * second-guessing that choice.
 * Returns `null` for an empty `createdDrafts` (the abandoned-run case): no
 * entry is written, rather than an entry with empty counts.
 *
 * Only voice seats count (`leads`/`bgvs`/`chorus`) — those are the only roles
 * the solver balances; instrument/FOH slots and `special_role` services (not
 * even representable as a `DraftCard` — `ServiceType` has no third member)
 * have no solver concept and contribute nothing.
 *
 * People are keyed by NAME, not id (`gcf/owt_solver_v2.py:454`, `:280`), via
 * `memberIdToName` — the same resolution `buildSolveRequest` uses for pools,
 * so a pool name and a history-entry name can never disagree about the same id.
 *
 * `total_counts` is the per-person sum of that same person's `role_counts` —
 * the solver reads `total_counts` as a separate scalar offset, so it must
 * stay derived from, never independent of, the roles actually counted (the
 * same rule D19 established for `applySolveResponse`, now applied here).
 */
export function historyEntryFromDrafts(
  createdDrafts: DraftCard[],
  members: RankMember[],
  year: number,
  month: number,
): SolverHistoryEntry | null {
  if (createdDrafts.length === 0) return null;

  const role_counts: Record<string, Record<string, number>> = {};
  const bump = (id: string, key: string) => {
    const name = memberIdToName(id, members);
    const forName = role_counts[name] ?? (role_counts[name] = {});
    forName[key] = (forName[key] ?? 0) + 1;
  };

  for (const draft of createdDrafts) {
    const keys = HISTORY_ROLE_KEYS[draft._type];
    for (const id of draft.leads) bump(id, keys.leads);
    for (const id of draft.bgvs) bump(id, keys.bgvs);
    if (keys.chorus) for (const id of draft.chorus) bump(id, keys.chorus);
  }

  const total_counts: Record<string, number> = {};
  for (const [name, counts] of Object.entries(role_counts)) {
    total_counts[name] = Object.values(counts).reduce((sum, n) => sum + n, 0);
  }

  return { key: `${year}-${month}`, year, month, total_counts, role_counts };
}

// ─── Cells ↔ ParticipantRole (D12's ranking union) ───────────────────────────

/** The bare member shape `ParticipantRole`'s seats carry (`computeParticipation.ts:2-10`). */
interface RolePerson {
  _id: string;
  member_name?: string;
  alias?: string;
}

/**
 * Converts `GridCell.memberIds` (strings) into the `ParticipantRole` shape
 * `rankCandidates` consumes (member objects) — D12's union needs both `PlannerGrid`
 * calls of `rankCandidates` fed `[...savedWindow, ...cellsToParticipantRoles(...)]`,
 * and hand-rolling this conversion in the component would duplicate the row-id
 * convention (`instrumento:`/`foh:` prefixes, one row per seat) that
 * `cellsToDrafts` already owns above. One `ParticipantRole` per column,
 * regardless of occupancy, mirroring `cellsToDrafts`'s column-per-draft
 * contract — an omitted column here would silently under-count that date's
 * load for every OTHER date's ranking.
 *
 * An id absent from `members` (a solver-resolved name that never matched a
 * canonical member, or simply stale data) still round-trips as a bare `_id`
 * rather than being dropped — `computeParticipation` keys strictly by `_id`,
 * so dropping it would undercount that person's load without any signal.
 */
export function cellsToParticipantRoles(
  cells: GridCell[],
  columns: GridColumn[],
  members: RankMember[],
): ParticipantRole[] {
  const byId = new Map(members.map((mm) => [mm._id, mm]));
  const toPerson = (id: string): RolePerson => {
    const found = byId.get(id);
    return found ? { _id: found._id, member_name: found.member_name, alias: found.alias } : { _id: id };
  };

  const cellsByDate = new Map<string, GridCell[]>();
  for (const c of cells) {
    const list = cellsByDate.get(c.date);
    if (list) list.push(c);
    else cellsByDate.set(c.date, [c]);
  }

  return columns.map((column) => {
    const dateCells = cellsByDate.get(column.date) ?? [];
    const idsFor = (rowId: string) => dateCells.find((c) => c.rowId === rowId)?.memberIds ?? [];

    const instruments: { person: RolePerson }[] = [];
    const foh: { person: RolePerson }[] = [];
    for (const c of dateCells) {
      if (c.rowId.startsWith(INSTRUMENT_PREFIX)) {
        c.memberIds.forEach((id) => instruments.push({ person: toPerson(id) }));
      } else if (c.rowId.startsWith(FOH_PREFIX)) {
        c.memberIds.forEach((id) => foh.push({ person: toPerson(id) }));
      }
    }

    return {
      _type: column.type,
      date: column.date,
      leads: idsFor("lead").map(toPerson),
      bgvs: idsFor("bgv").map(toPerson),
      chorus: idsFor("coro").map(toPerson),
      instruments,
      foh,
    };
  });
}
