// app/components/admin/plannerModel.ts
//
// The month-grid's shape (rows, columns, cells) and both translations to and
// from the solver's wire format. Pure — no React, no network, no
// `Date.now()`-dependent behaviour. `PlannerGrid` (Task 3) renders what this
// returns and decides nothing; `MonthGenerator` (Task 4) owns the fetch, the
// `cells` state, and threading `previous` across calls.
//
// ONE deliberate exception to "pure": `buildColumns` logs a `console.warn` when
// it drops a duplicate-date column. Reaching that line is already a bug (E3),
// and a silent structural dedupe is exactly the kind of correction that hides
// the defect it corrects. Nothing reads the warning; it is not a return value.
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
import type { AssignedSeat, RankMember } from "./candidateRanking";
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
import { normalizeLabel, normalizeServiceName } from "@/app/utils/normalizeLabel";

// ─── Grid shape ───────────────────────────────────────────────────────────────

export type CellOrigin = "manual" | "auto" | "empty";

export interface GridOccupant {
  memberId: string;
  /** Stored-role array item identity. Create-preview occupants do not have one. */
  itemKey?: string;
}

/**
 * Rebuild an occupant list from member ids without detaching stored item keys
 * from occupants that remain seated. Repeated member ids consume repeated
 * prior occupants in order; newly added occupants have no stored key.
 */
export function reconcileOccupants(
  previous: readonly GridOccupant[],
  memberIds: readonly string[],
): GridOccupant[] {
  const unused = [...previous];
  return memberIds.map((memberId) => {
    const index = unused.findIndex((occupant) => occupant.memberId === memberId);
    if (index === -1) return { memberId };
    return unused.splice(index, 1)[0];
  });
}

export interface GridCell {
  columnId: string;
  rowId: string;
  occupants: GridOccupant[];
  origin: CellOrigin;
  /**
   * P10 — member ids a HUMAN deliberately seated here despite a hard rule
   * refusing them, one entry per explicit "Asignar de todos modos".
   *
   * **Recorded on the cell, not in component state**, for the same reason
   * `origin` is: the cell is the thing that survives a re-render, a step
   * round-trip and a re-solve, and an override that evaporated on re-render
   * would silently become a violation again. Nothing downstream has to learn
   * about it — `cellsToDrafts` reads `columnId`/`rowId`/`occupants` only, so this
   * costs the create path nothing, exactly as `origin` already proves.
   *
   * Read by `PlannerGrid` alone, for two things: suppressing E13's post-fill
   * re-flag for this member, and rendering the persistent "regla anulada"
   * marker that keeps the exception visible instead of silent. Removing the
   * member from `occupants` clears their entry.
   *
   * **The auto-filler never writes this** (`localFill.ts` neither sets nor
   * reads it) — that asymmetry IS the requirement: a person may make a
   * deliberate exception, the automation may not.
   */
  overrides?: string[];
  /**
   * P10 — which RULE each entry in `overrides` waived: member id → the exact
   * reason `evaluate` gave at the moment the admin clicked "Asignar de todos
   * modos".
   *
   * Without it an override is scoped to (date, row, member) and silently
   * pre-sanctions rules the admin never saw: waive `Frank !with Gaby`, add
   * `Gaby !in *.Lead` a week later, and the cell reports an exception nobody
   * made. `ruleViolationsForColumn` compares this against the rule firing NOW,
   * so a different one flags fresh.
   *
   * A sibling field rather than a richer `overrides` on purpose: every existing
   * reader wants the plain id list, and `localFill`'s pass-through and
   * `cellsToDrafts`' indifference both stay literally unchanged. `withUpdatedCell`
   * is the single writer and keeps the two in lockstep — an id here with no
   * reason waives nothing, which fails CLOSED (the violation shows in red).
   */
  overrideReasons?: Record<string, string>;
}

export interface GridRow {
  id: string;
  label: string;
  category: SeatCategory;
  /** Auto's fill goal (D6) — advisory only, never a limit and never enforced. */
  target: number | null;
}

export type ColumnType = "sunday_role" | "saturday_role" | "special_role";

export interface GridColumn {
  columnId: string;
  date: string;
  type: ColumnType;
  /**
   * SPECIALS ONLY — the `service_name` a `special_role` document is identified
   * by, alongside its date (`roleCreationReceipt`'s
   * `special_role:${date}:${name}`). Never set on a weekend column: a weekend
   * role stores no `service_name` and a stray one would not change its
   * fingerprint anyway.
   *
   * It is deliberately NOT part of draft IDENTITY (E19) — see `cellsToDrafts`,
   * where it feeds the collision key and nothing else.
   */
  serviceName?: string;
}

/** Fail closed when a caller supplies ambiguous or detached grid identity. */
export function assertGridIdentity(columns: GridColumn[], cells: GridCell[] = []): void {
  const ids = new Set<string>();
  for (const column of columns) {
    if (!column.columnId.trim()) throw new Error("Grid column is missing columnId");
    if (ids.has(column.columnId)) {
      throw new Error(`Duplicate grid columnId: ${column.columnId}`);
    }
    ids.add(column.columnId);
  }
  for (const cell of cells) {
    if (!ids.has(cell.columnId)) {
      throw new Error(`Grid cell references unknown columnId: ${cell.columnId}`);
    }
  }
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
  /** Specials only — carried through to the POST body as `service_name`. */
  service_name?: string;
  /**
   * **"This column once matched a Sanity document", NOT "this name exists".**
   * `cellsToDrafts` computes it as `isExisting || previous.exists`, so it
   * SURVIVES a rename: rename a special that collided and `isExisting` goes
   * back to false while this stays true. It exists to keep a draft's
   * created/occupied state across a re-render and a partial-batch retry (a
   * confirmed create sets it), which is exactly why it must never be read as
   * "there is a document with this name" — see `isExisting` below, and
   * `MonthGenerator`'s `createdTargets`.
   */
  exists: boolean;
  /**
   * **"A Sanity document occupies this exact target RIGHT NOW"** — the raw
   * collision-key hit against `existingRoles`, name-bearing for a special, with
   * no memory of previous calls folded in. The reason channel E17 needs: it is
   * the difference between "skipped because a stored service already occupies
   * this date" and "skipped because the admin ticked Omitir", which
   * `skippedDates` alone cannot tell apart (`PlannerGrid`'s `ColumnHeader`
   * rendered the checkbox UNCHECKED for the former and the badge still said
   * "Se puede crear").
   */
  isExisting: boolean;
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
  /**
   * Present on `special_role` documents only. Without it, ONE special stored on
   * a date would mark EVERY special column on that date `skipped: true` (E17) —
   * never posted, and silently, since the "Omitir" checkbox renders
   * `skippedDates` alone.
   */
  service_name?: string;
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
 * Row ids a column type does NOT show, keyed by column type.
 *
 * **A Saturday service has no Coro.** That is the domain rule, confirmed by the
 * team and matched by the data: 0 of 8 stored `saturday_role` documents carry a
 * `Chorus`, against 19 of 19 Sundays. Earlier drafts rendered a Coro row on
 * Saturday columns as merely non-solvable, on the theory that it preserved a
 * capability the old UI offered — but that capability was an artifact of
 * `ServiceForm` showing one Coro picker for every service type, not something
 * the team ever used. Offering it invites an assignment that should not exist.
 *
 * **A special DOES have a Coro** (E18): specials are created with Coro,
 * instruments and FOH, and `saturday_role` is the only type that drops it.
 *
 * A `Record<ColumnType, …>` rather than a chain of `===`: a fourth column type
 * is then a `tsc` error here instead of silently inheriting "shows everything".
 */
const HIDDEN_ROW_IDS: Record<ColumnType, readonly string[]> = {
  sunday_role: [],
  saturday_role: ["coro"],
  special_role: [],
};

/**
 * Whether a column type shows a given row id at all. The ONE authority — both
 * `rowAppliesTo` (what the grid renders) and `cellsToDrafts` (what the write
 * commits) go through it, so E18's standing requirement that the two agree is
 * structural rather than two conditions someone has to keep in step.
 * `cellsToDrafts` receives no `rows`, which is why this takes a bare row id.
 */
export function columnShowsRowId(type: ColumnType, rowId: string): boolean {
  return !HIDDEN_ROW_IDS[type].includes(rowId);
}

/** Whether a row exists at all on a given column. */
export function rowAppliesTo(row: GridRow, column: Pick<GridColumn, "type">): boolean {
  return columnShowsRowId(column.type, row.id);
}

/**
 * Whether **Auto** (the CP-SAT solve) fills this cell. A row that does not apply
 * is never solvable; beyond that, the solver covers Lead and BGV on both
 * WEEKEND service types and Coro on Sundays only, and instrument and FOH rows
 * are always manual (D5).
 *
 * **Specials are never solvable** (E4/E5): they are never sent to the solver, so
 * nothing in a response can name one. `weekForColumn` returning `null` for a
 * special is the real defense on the response side — this exclusion is belt and
 * braces, and it is stated rather than left implied, because the pre-widening
 * version had no column-type test at all and would have answered `true`.
 */
export function isSolvable(row: GridRow, column: Pick<GridColumn, "type">): boolean {
  if (column.type === "special_role") return false;
  if (!rowAppliesTo(row, column)) return false;
  if (row.category !== "voz") return false;
  return row.id === "lead" || row.id === "bgv" || row.id === "coro";
}

/**
 * Whether D7's `target` cap and the amber over-target `+N` apply to this cell.
 *
 * Separated from `isSolvable`, whose name hid this second, unrelated consumer
 * (`PlannerGrid.tsx`'s `GridCellView`). They agree exactly on weekend columns —
 * a voice row carrying a `target` is precisely a solvable one there — and
 * diverge on a special, which must keep the cap and the `+N` while being
 * unsolvable. Overloading `isSolvable` for both would have silently dropped
 * both on every special column.
 */
export function hasTarget(row: GridRow, column: Pick<GridColumn, "type">): boolean {
  if (!rowAppliesTo(row, column)) return false;
  if (row.category !== "voz") return false;
  return row.target != null;
}

/**
 * The EXPLICIT column set of D9/E21. `sundayDates` here is the admin's
 * SELECTION, never the month's Sunday spine: exactly one Sunday column per
 * date passed, and none for any date withheld. The solve keeps running on the
 * FULL spine, which `MonthGenerator` holds separately as `sundayDatesFull` —
 * so "no Sundays at all" is an EMPTY `sundayDates` here while
 * `buildSolveRequest` still receives every one of them.
 *
 * There is deliberately NO `includeSundays` flag. It existed for the retired
 * Domingos checkbox, outlived it as a test-only option with a permissive
 * `true` default, and offered a second way to say what `sundayDates` already
 * says — precisely the shape `mapUnfilledSeats` refuses below ("required, not
 * optional-with-a-permissive-default"). A future caller reaching for it would
 * be reaching past the selection it was supposed to thread through.
 */
export function buildColumns(input: {
  sundayDates: string[];
  activeSatDates: string[];
  /** Weekday specials (E2), each with the `service_name` it will be created under. */
  specials?: { date: string; name: string }[];
}): GridColumn[] {
  const { sundayDates, activeSatDates, specials = [] } = input;

  // E3: AT MOST ONE COLUMN PER DATE, of any kind — enforced here rather than
  // trusted to the UI (work item 13). The grid is keyed by date alone in every
  // site of fact 10, so two columns on one date would share ONE roster,
  // `cellsToDrafts` would emit two drafts built from the same cells, and
  // `PlannerGrid` would render duplicate React keys in three places.
  //
  // Precedence is WEEKEND-WINS: a weekend column is the one the solver can
  // fill, so dropping it in favour of a special would cost strictly more.
  // Reaching this line is already a bug (the UI refuses the overlap with a
  // stated reason), so the drop is LOGGED, never silent.
  const cols: GridColumn[] = [];
  const claimed = new Map<string, ColumnType>();
  const push = (col: GridColumn) => {
    const held = claimed.get(col.date);
    if (held) {
      console.warn(
        `buildColumns: dropped a ${col.type} column on ${col.date} — that date already has a ${held} column (E3: one column per date).`,
      );
      return;
    }
    claimed.set(col.date, col.type);
    cols.push(col);
  };

  for (const d of sundayDates) push({ columnId: createColumnId("sunday_role", d), date: d, type: "sunday_role" });
  for (const d of activeSatDates) push({ columnId: createColumnId("saturday_role", d), date: d, type: "saturday_role" });
  for (const s of specials) {
    push({ columnId: createColumnId("special_role", s.date), date: s.date, type: "special_role", serviceName: s.name });
  }

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

export type NameResolution = { resolved: string } | { unresolved: string };

/**
 * A rule's person text -> the canonical `member_name`, matching **alias OR
 * `member_name`** — the reason `memberIdToName` must never be used for rule
 * matching (E11, fact 12). Every seeded rule name is an alias whose
 * `member_name` differs, so an id->`member_name` resolver would match nobody.
 *
 * **Resolve-or-report, not a bare string** (E11). It used to return the raw
 * input on a miss, which is exactly what made a miss invisible: a caller
 * comparing the result against `member_name` matched nobody and never learned.
 * `ruleEnforcement.unresolvedRuleNames` is the surfacing half of this shape.
 *
 * `resolvedNameOrRaw` below keeps the old fallback for the two callers that
 * genuinely want it — see there.
 */
export function resolveToMemberName(name: string, members: RankMember[]): NameResolution {
  const lo = name.toLowerCase().trim();
  const m = members.find(
    (mm) => mm.member_name.toLowerCase().trim() === lo || mm.alias?.trim().toLowerCase() === lo,
  );
  return m ? { resolved: m.member_name } : { unresolved: name };
}

/**
 * The canonical name, or the RAW input when nothing matches.
 *
 * The solve REQUEST wants this, not a report: `buildSolveRequest` injects every
 * DSL-named person absent from all pools into `support`, and an unmatched name
 * must go in under the same spelling `allRulesToDs` writes into `dsl_rules` —
 * omitting it is a documented 422. So the two paths deliberately share this one
 * fallback and can never disagree about an unknown DSL person. Pinned in
 * `plannerModel.test.ts` ("a rule naming a member absent from `members` …").
 */
function resolvedNameOrRaw(name: string, members: RankMember[]): string {
  const r = resolveToMemberName(name, members);
  return "resolved" in r ? r.resolved : r.unresolved;
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
  const res = (name: string) => resolvedNameOrRaw(name, members);
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
    const resolved = resolvedNameOrRaw(name, members);
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

/**
 * The 1-based solver week a column belongs to, or `null` for a column the
 * solver has no concept of.
 *
 * **A special is ALWAYS `null`** (E4). Without this it would fall into the
 * Saturday branch below and — for a weekday special dated the day before a
 * selected Sunday — resolve to a real week, so `applySolveResponse` would write
 * that Saturday's roster into it. E4 governs what the REQUEST contains; nothing
 * governed the response mapping until this line.
 *
 * Exported so it can be pinned directly rather than only through
 * `applySolveResponse`'s observable output.
 */
export function weekForColumn(
  column: Pick<GridColumn, "type" | "date">,
  sundayDates: string[],
): number | null {
  if (column.type === "special_role") return null;
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
  assertGridIdentity(columns, previousCells);

  const nameToId = (name: string): string | null => {
    const lo = name.toLowerCase().trim();
    const m = members.find(
      (mm) => mm.member_name.toLowerCase().trim() === lo || mm.alias?.trim().toLowerCase() === lo,
    );
    return m?._id ?? null;
  };

  const byKey = new Map<string, GridCell>();
  for (const c of previousCells) byKey.set(`${c.columnId}|${c.rowId}`, c);

  const unresolved = new Set<string>();
  const schedule = response.schedule ?? {};

  for (const column of columns) {
    // `weekForColumn` returns null for a special (E4), so a special column is
    // skipped here before anything can be read for it — the ternary below never
    // sees one, and `isSolvable` refuses every one of its rows besides.
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
      byKey.set(`${column.columnId}|${row.id}`, {
        columnId: column.columnId,
        rowId: row.id,
        occupants: ids.map((memberId) => ({ memberId })),
        origin: "auto",
      });
    }
  }

  return { cells: Array.from(byKey.values()), unresolvedNames: Array.from(unresolved) };
}

/** Places each solver `unfilled_seats` string on a row and a date. */
const ROLE_TO_ROW_ID: Record<string, string> = { Lead: "lead", BGV: "bgv", Choir: "coro" };

/**
 * `sundayDates` is the FULL month spine — it is what resolves the solver's
 * positional week number (E21) and must never be narrowed to the selection.
 * `selectedSundays` then filters the RESULT: the Sunday branch used to resolve
 * unconditionally while the Saturday branch already filtered against
 * `activeSatDates`, so once Sundays became individually deselectable an
 * unfilled marker for a week the admin removed would render on a column that no
 * longer exists — or, since a deselected Sunday may carry a weekday special
 * instead, on a `special_role` column the solver was never asked about.
 *
 * Required, not optional-with-a-permissive-default: every caller has to state
 * which Sundays it actually rendered, and passing `sundayDates` twice is the
 * explicit way to say "all of them".
 */
export function mapUnfilledSeats(
  seats: string[],
  sundayDates: string[],
  activeSatDates: string[],
  selectedSundays: string[],
): { columnId: string; rowId: string }[] {
  const activeSat = new Set(activeSatDates);
  const selectedSun = new Set(selectedSundays);
  const out: { columnId: string; rowId: string }[] = [];
  for (const seat of seats) {
    const parsed = parseUnfilledSeat(seat);
    if (!parsed) continue;
    const rowId = ROLE_TO_ROW_ID[parsed.role];
    let date: string | null = null;
    if (parsed.service === "Sunday") {
      const sunDate = sundayDates[parsed.week - 1] ?? null;
      date = sunDate && selectedSun.has(sunDate) ? sunDate : null;
    } else {
      const satDate = saturdayForWeek(parsed.week, sundayDates);
      date = satDate && activeSat.has(satDate) ? satDate : null;
    }
    if (date) {
      const type = parsed.service === "Sunday" ? "sunday_role" : "saturday_role";
      out.push({ columnId: createColumnId(type, date), rowId });
    }
  }
  return out;
}

// ─── Cells ↔ drafts ───────────────────────────────────────────────────────────

const uid = () => Math.random().toString(36).slice(2, 9);

const INSTRUMENT_PREFIX = "instrumento:";
const FOH_PREFIX = "foh:";

/**
 * TWO KEYS, NOT ONE (E19). The single `${_type}__${date}` string used to serve
 * both jobs, so the obvious fix for one breaks the other.
 *
 * **Identity** — `type__date`, and NEVER name-bearing. It feeds `prevByKey`,
 * and through it `localId`, `creationRequestId` and `exists`. If identity
 * carried the name, editing a special's name after a successful confirm would
 * miss `prevByKey`, re-mint both ids, reset `exists` to `false` — and
 * `handleConfirm` would post a SECOND `special_role` on the same date. The
 * server would accept it (occupancy is filtered by normalized `service_name`,
 * so the new name finds no occupant and no 409 fires), orphaning the first
 * document in silence, and the draft would also fall out of
 * `createdThisSession`, losing its seats from the fairness-history union.
 *
 * E3 keeps two columns off one date, so `type__date` stays unique across the
 * rendered column set.
 *
 * EXPORTED because `MonthGenerator`'s session-local created-set is keyed by the
 * very same string (P2), and a second hand-rolled `${type}__${date}` there
 * could drift from this one without anything failing — the set would simply
 * stop matching and start letting duplicates through, silently. One definition,
 * two readers.
 */
export function draftTargetKey(type: string, date: string): string {
  return `${type}__${date}`;
}

/** Stable identity for a create-preview column. */
export function createColumnId(type: ColumnType, date: string): string {
  return `create:${draftTargetKey(type, date)}`;
}

/**
 * **Collision** — what a Sanity document on this target would occupy. For a
 * special that is `type__date__name`, matching the server's own identity
 * `special_role:${date}:${name}` (`roleCreationReceipt`) and its occupancy
 * filter (`roleWriteOps`). Weekend types keep the bare `type__date`: they store
 * no `service_name` at all.
 *
 * The name is normalized through the SHARED `normalizeServiceName` — NFC + trim
 * + collapse internal whitespace, and nothing else. **No `.toLowerCase()`, no
 * accent folding**: case and accents are meaningful to the server, so folding
 * them here would make the client claim a collision the server does not see,
 * and (worse, in the other direction) the two definitions would drift.
 *
 * E3 does NOT make this redundant: the collision arrives from Sanity via
 * `existingRoles`, not from two columns in the grid — a special may already be
 * stored on that date from any earlier session.
 */
function collisionKey(type: string, date: string, serviceName?: string): string {
  return type === "special_role"
    ? `${type}__${date}__${normalizeServiceName(serviceName)}`
    : draftTargetKey(type, date);
}

/**
 * One draft per column REGARDLESS of occupancy (an omitted column would have
 * no `localId`, so `preflights.get` would miss). `skippedDates` (D18) is the
 * single explicit channel for a user-toggled skip; a date already `exists`
 * (in `existingRoles`) is ALSO skipped.
 *
 * **The skip is still correct, but not for the reason it was written.** It used
 * to defer to a separate editor. That editor is gone, and the skip survives
 * because THIS FUNCTION IS THE CREATE PATH ONLY: every call site in
 * `MonthGenerator` is guarded against `storedMode`, which is the grid's own
 * editor for already-saved services and reaches Sanity through
 * `/api/admin/roles/swap` and the stored-save reconciliation instead. Emitting a
 * draft for a date that already exists would make the create path POST over a
 * live service. Do not "fix" this into an upsert without moving the stored path
 * with it.
 *
 * `localId`/`creationRequestId`/`exists` are looked up in `previous` by
 * `(type, date)`: pass the prior call's drafts to preserve them across an
 * ordinary re-render, or `[]` for a genuinely new Auto run so every column
 * mints fresh ids (fact 19).
 */
export function cellsToDrafts(
  cells: GridCell[],
  columns: GridColumn[],
  skippedColumnIds: Set<string>,
  previous: DraftCard[],
  existingRoles: ExistingRoleRef[],
): DraftCard[] {
  assertGridIdentity(columns, cells);
  const existing = new Set(
    existingRoles.map((r) => collisionKey(r._type, r.date, r.service_name)),
  );
  const prevByKey = new Map(previous.map((d) => [draftTargetKey(d._type, d.date), d]));

  const cellsByColumnId = new Map<string, GridCell[]>();
  for (const c of cells) {
    const list = cellsByColumnId.get(c.columnId);
    if (list) list.push(c);
    else cellsByColumnId.set(c.columnId, [c]);
  }

  const out: DraftCard[] = [];
  for (const column of columns) {
    const prevDraft = prevByKey.get(draftTargetKey(column.type, column.date));
    const localId = prevDraft?.localId ?? uid();
    const creationRequestId = prevDraft?.creationRequestId ?? newCreationRequestId();
    const isExisting = existing.has(collisionKey(column.type, column.date, column.serviceName));
    const skipped = skippedColumnIds.has(column.columnId) || isExisting;
    // THE TWO ARE NOT THE SAME QUESTION, and only `isExisting` answers the one
    // its name asks. `exists` folds in `previous`, so a special that collided,
    // was created, and was then RENAMED keeps `exists: true` with
    // `isExisting: false`. Anything that means "a document with this name is
    // there" must read `isExisting`; anything that means "don't lose what this
    // draft already achieved" must read `exists`.
    const exists = isExisting || prevDraft?.exists === true;

    const columnCells = cellsByColumnId.get(column.columnId) ?? [];
    const idsFor = (rowId: string) =>
      columnCells.find((c) => c.rowId === rowId)?.occupants.map((o) => o.memberId) ?? [];

    const leads = idsFor("lead");
    const bgvs = idsFor("bgv");
    // E18: `chorus` is written when and only when the grid SHOWED a Coro row —
    // derived from the same `columnShowsRowId` the render goes through, never
    // re-stated as a second condition that could drift out of step. A Saturday
    // therefore writes an empty chorus whatever the grid holds: `cellsByDate` is
    // keyed by date alone, so a stale cell can survive a column-type switch, and
    // a row the grid never showed must never reach Sanity.
    const chorus = columnShowsRowId(column.type, "coro") ? idsFor("coro") : [];

    const instruments: DraftInstrumentSlot[] = [];
    const foh: DraftFohSlot[] = [];
    for (const c of columnCells) {
      if (c.rowId.startsWith(INSTRUMENT_PREFIX)) {
        const label = c.rowId.slice(INSTRUMENT_PREFIX.length);
        c.occupants.forEach(({ memberId: personId }, idx) =>
          instruments.push({ id: `${c.rowId}#${idx}`, instrument: label, personId }),
        );
      } else if (c.rowId.startsWith(FOH_PREFIX)) {
        const label = c.rowId.slice(FOH_PREFIX.length);
        c.occupants.forEach(({ memberId: personId }, idx) =>
          foh.push({ id: `${c.rowId}#${idx}`, role: label, personId }),
        );
      }
    }

    out.push({
      localId,
      creationRequestId,
      _type: column.type,
      date: column.date,
      ...(column.serviceName !== undefined ? { service_name: column.serviceName } : {}),
      exists,
      isExisting,
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

/**
 * A `special_role` draft whose `service_name` normalizes to empty — the exact
 * payload `canonicalizeCreatePayload` files issue `"service_name"` for
 * (`roleCreationReceipt.ts`), which the create route answers with
 * `400 invalid_request`. `handleConfirm` refuses the whole confirm on one of
 * these rather than sending it and reporting an anonymous failure afterwards.
 *
 * Normalized with the SERVER's own `normalizeLabel` — NFC + trim + collapse —
 * not a bare `.trim()`: the two must agree on what "empty" means, or the client
 * refuses a name the server would have taken (or, worse, waves through one it
 * rejects). A weekend draft is never nameless by this definition; it stores no
 * `service_name` at all.
 */
export function namelessSpecial(draft: Pick<DraftCard, "_type" | "service_name">): boolean {
  return draft._type === "special_role" && normalizeLabel(draft.service_name) === null;
}

// ─── Fairness history from CREATED drafts ────────────────────────────────────

/**
 * The role-key vocabulary the solver understands
 * (`gcf/owt_solver_v2.py:34`, `:547-561`). There is no `Sat.Choir` — a
 * Saturday draft's `chorus` is ignored rather than inventing a key the solver
 * would not recognise (`cellsToDrafts` already zeroes it on write, but this
 * stays defensive rather than assuming that always holds upstream).
 *
 * **`special_role` is all-null, and that is E9/E20's mechanism, not a
 * placeholder.** The `Record` forces an ENTRY for every column type; it cannot
 * force an EXCLUSION, and the cheapest type-satisfying entry would have been a
 * pair of real solver keys — which would write `Sun.Lead`/`Sat.Lead` counts for
 * specials into the persisted `owt_solver_history_v2`, and `buildSolveRequest`
 * would then feed them to CP-SAT every following month. Exactly what E10 warns
 * against. So the value type is `string | null` on ALL THREE fields and
 * `historyEntryFromDrafts` guards all three bumps: a special contributes
 * nothing, by construction rather than by a caller remembering to filter.
 */
const HISTORY_ROLE_KEYS: Record<
  ServiceType,
  { leads: string | null; bgvs: string | null; chorus: string | null }
> = {
  sunday_role: { leads: "Sun.Lead", bgvs: "Sun.BGV", chorus: "Sun.Choir" },
  saturday_role: { leads: "Sat.Lead", bgvs: "Sat.BGV", chorus: null },
  special_role: { leads: null, bgvs: null, chorus: null },
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
 * the solver balances; instrument/FOH slots and `special_role` services have no
 * solver concept and contribute nothing. `special_role` IS representable as a
 * `DraftCard` now (`ServiceType` has a third member); what keeps it out of the
 * history is its all-null `HISTORY_ROLE_KEYS` entry plus the guard on each of
 * the three bumps below — see E20.
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
    if (keys.leads) for (const id of draft.leads) bump(id, keys.leads);
    if (keys.bgvs) for (const id of draft.bgvs) bump(id, keys.bgvs);
    if (keys.chorus) for (const id of draft.chorus) bump(id, keys.chorus);
  }

  const total_counts: Record<string, number> = {};
  for (const [name, counts] of Object.entries(role_counts)) {
    total_counts[name] = Object.values(counts).reduce((sum, n) => sum + n, 0);
  }

  return { key: `${year}-${month}`, year, month, total_counts, role_counts };
}

// ─── Cells → AssignedSeat (who is already on this column) ────────────────────

/**
 * Everyone seated on `columnId`, in the `AssignedSeat` shape `rankCandidates` and
 * `ruleEnforcement.evaluate` both consume. **`seatId` IS the row id** — the same
 * convention `cellsToDrafts` reads above, and the one `evaluate`'s
 * self-exemption (`a.seatId === row.id`) and its conflict scan
 * (`parsed.rows.includes(x.seatId)`) are written against.
 *
 * Module-private inside `PlannerGrid` until Task 7. It moved here because the
 * filler (`localFill.ts`) is pure and must not import from a React component
 * module, and because re-deriving the `seatId === rowId` convention in a second
 * place is exactly how two implementations drift — `cellsToDrafts` and this
 * function share it, so they live together.
 *
 * A cell whose `rowId` is not in `rows` contributes nothing: without its row we
 * cannot know its category, and a guessed one would make the same-category
 * double-duty block either fire or stay silent at random.
 */
export function assignedForColumn(cells: GridCell[], rows: GridRow[], columnId: string): AssignedSeat[] {
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const out: AssignedSeat[] = [];
  for (const c of cells) {
    if (c.columnId !== columnId) continue;
    const row = rowById.get(c.rowId);
    if (!row) continue;
    for (const { memberId } of c.occupants) {
      out.push({ seatId: c.rowId, category: row.category, memberId });
    }
  }
  return out;
}

// ─── Cells ↔ ParticipantRole (D12's ranking union) ───────────────────────────

/** The bare member shape `ParticipantRole`'s seats carry (`computeParticipation.ts:2-10`). */
interface RolePerson {
  _id: string;
  member_name?: string;
  alias?: string;
}

/**
 * Converts `GridCell.occupants` into the `ParticipantRole` shape
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
  assertGridIdentity(columns);
  const byId = new Map(members.map((mm) => [mm._id, mm]));
  const toPerson = (id: string): RolePerson => {
    const found = byId.get(id);
    return found ? { _id: found._id, member_name: found.member_name, alias: found.alias } : { _id: id };
  };

  const cellsByColumnId = new Map<string, GridCell[]>();
  for (const c of cells) {
    const list = cellsByColumnId.get(c.columnId);
    if (list) list.push(c);
    else cellsByColumnId.set(c.columnId, [c]);
  }

  return columns.map((column) => {
    const columnCells = cellsByColumnId.get(column.columnId) ?? [];
    const idsFor = (rowId: string) =>
      columnCells.find((c) => c.rowId === rowId)?.occupants.map((o) => o.memberId) ?? [];

    const instruments: { person: RolePerson }[] = [];
    const foh: { person: RolePerson }[] = [];
    for (const c of columnCells) {
      if (c.rowId.startsWith(INSTRUMENT_PREFIX)) {
        c.occupants.forEach(({ memberId }) => instruments.push({ person: toPerson(memberId) }));
      } else if (c.rowId.startsWith(FOH_PREFIX)) {
        c.occupants.forEach(({ memberId }) => foh.push({ person: toPerson(memberId) }));
      }
    }

    return {
      _type: column.type,
      date: column.date,
      leads: idsFor("lead").map(toPerson),
      bgvs: idsFor("bgv").map(toPerson),
      // Aligned with `cellsToDrafts` through the same `columnShowsRowId`. This
      // is a LIVE behaviour change for SATURDAY too, not only for specials: this
      // call used to pass `idsFor("coro")` unguarded for every column type, so a
      // stale Saturday `coro` cell — one that survived a column-type switch —
      // counted toward in-grid `load` in the candidate ranking while the write
      // path zeroed it and it never reached Sanity. Ranking against a seat that
      // will never exist is the bug this closes.
      //
      // The number/strip drift for a special (E12) is closed in
      // `computeParticipation`, not here: `_type` is forwarded above, and a
      // special's leads/bgvs/chorus now land in one `especial` bucket that
      // counts toward `total`/`load`, matching the week `serviceWeekKey`
      // already gave it for the `recent` strip.
      chorus: (columnShowsRowId(column.type, "coro") ? idsFor("coro") : []).map(toPerson),
      instruments,
      foh,
    };
  });
}

/**
 * A saved role as the participation panel needs it: a `ParticipantRole` plus the
 * one field of a special's IDENTITY that `ParticipantRole` does not carry
 * (`computeParticipation.ts:2-10`).
 *
 * Optional, so every existing `ParticipantRole` fixture and every weekend role
 * still satisfies it, and so a caller that genuinely has no name (a test, a
 * weekend) is not forced to invent one. `ServiceRole` — what `ServicesPanel`
 * actually holds and hands down — already declares `service_name?: string`, so
 * the real path gains the field with no new plumbing.
 */
export type SavedRole = ParticipantRole & { service_name?: string };

/**
 * What the participation panel beside the grid counts: everything already SAVED
 * plus every draft currently on screen, as one `ParticipantRole[]` for
 * `computeParticipation`.
 *
 * **Why the merge, and not one side or the other.** `savedWindow` alone is the
 * number the sidebar has always shown, and beside a grid it is actively
 * misleading: it reports a member at 5 while the admin is in the act of making
 * them 7. The drafts alone answer "is this month fair" but forget that the same
 * person led three times last month. Fairness is the sum, so this is the sum.
 *
 * **`creatableColumns` is only the columns that will actually be created** —
 * `drafts.filter(isCreatable)` in `MonthGenerator`, never the columns on
 * screen. That is load-bearing, not tidiness. Both fillers deliberately seat
 * people into columns that will never reach Sanity: `applySolveResponse` writes
 * the solver's roster into every weekend column with a week (there is no
 * `isExisting`/`skipped` test in its loop), and `applySpecialFill` says so
 * outright in its own comment — "every `special_role` column, `skippedDates`
 * and `isExisting` included — deliberately". Counting those seats would report
 * invented people as serving.
 *
 * It also closes the worse half of that: a mid-month service that ALREADY
 * exists gets a column, Auto fills it with invented seats, and — if this
 * counted them — the invention would displace the real roster this function
 * now pulls out of `allRoles`. `applySpecialFill`'s own justification for
 * tolerating the fabrication was that the real assignments were unavailable to
 * the grid; for this panel they are available, so the truth wins.
 *
 * **The de-duplication.** A creatable column and a saved role can still name
 * the same service if the exists-check is stale (no `preflight`, so
 * `isCreatable` falls back to `!d.exists`). Where the column holds people the
 * draft wins — it is what the admin is looking at and about to create. Where
 * it is empty the saved role is kept: an empty column makes no claim about who
 * serves, and dropping the role would report an already-saved team as serving
 * zero times.
 *
 * **Matched on `_type` + `date` + `service_name`, all three.** The name is not
 * decoration: the server's identity for a special IS
 * `special_role:${date}:${normalizeLabel(name)}` (`roleCreationReceipt.ts`), so
 * "Vigilia" and "Retiro" on one date are two services and the grid can
 * legitimately plan the second while the first is already stored. Keyed on
 * `_type|date` alone the stored one was dropped by the planned one and its
 * whole roster vanished — a person who really served reading as absent, on the
 * chart built to answer "is this fair". `SavedRole` widens `ParticipantRole`
 * with the name for exactly this; the real caller already has the field on the
 * `ServiceRole` documents it holds.
 *
 * `normalizeServiceName` and never `.toLowerCase()` — case and accents are
 * meaningful and the server compares the same way (`normalizeLabel.ts`). A
 * weekend role stores no name and a weekend column is never given one, so both
 * sides key to `""` there and weekend behaviour is untouched.
 */
export function plannerParticipationRoles({
  saved,
  creatableColumns,
  cells,
  members,
}: {
  saved: SavedRole[];
  /** ONLY the columns that will be created. See above — this is not a filter for neatness. */
  creatableColumns: GridColumn[];
  cells: GridCell[];
  members: RankMember[];
}): ParticipantRole[] {
  const occupied = new Set(cells.filter((c) => c.occupants.length > 0).map((c) => c.columnId));
  const serviceKey = (type: ColumnType, date: string, name: unknown) =>
    `${type}|${date.slice(0, 10)}|${normalizeServiceName(name)}`;
  const planned = new Set(
    creatableColumns
      .filter((c) => occupied.has(c.columnId))
      .map((c) => serviceKey(c.type, c.date, c.serviceName)),
  );
  const kept = saved.filter((r) => !planned.has(serviceKey(r._type, r.date, r.service_name)));
  return [...kept, ...cellsToParticipantRoles(cells, creatableColumns, members)];
}
