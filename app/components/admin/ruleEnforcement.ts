// app/components/admin/ruleEnforcement.ts
//
// The solver's DSL rules, enforced LOCALLY as hard blocks on a manual pick.
//
// Why this exists at all: a special service is never sent to the solver (E4/E5),
// so on a special NOTHING enforces the rules the admin wrote — the pair the user
// asked to keep apart gets seated together and the UI reports a normal, happy
// fill. The user's requirement for this whole feature was "I need some rules
// enforced in specials, specially that exclude two people from being together",
// and "it has to be hard because if it's soft in fairness it will always choose
// people like Frank, Mkz or Gaby who tend to have 1 or 2 participations a
// month". This module is where that becomes true; everything around it is
// plumbing.
//
// ─── What is enforced ────────────────────────────────────────────────────────
//
//  • Pairwise conflicts   — `A !with B on <pattern>`   (E14, scoped by pattern)
//  • Person exclusions    — `A !in <pattern>`          (E15)
//  • Week exclusions      — `A !in week N <pattern>`   (E7, weekend columns only)
//
// ─── What is NOT, deliberately ───────────────────────────────────────────────
//
//  • **Presence rules** (`any_of(...) each_week`) — a spec non-goal. They are a
//    coverage guarantee over a whole month, not a per-pick predicate; there is
//    nothing to refuse at the moment a human clicks a name. Their persons ARE
//    still checked by `unresolvedRuleNames` below.
//  • **Count caps** (`<pattern> <= N`) — a spec non-goal. Same reason: a cap is
//    a statement about a month, and the grid has no committed month yet.
//  • **Global fairness** (`fairness_exempt`, `fairness_slack N`) — a spec
//    non-goal HERE (P7b). Fairness never enters `rankCandidates`' sort; the
//    filler's `effectiveLoad` (Task 7) is the only place it lives.
//
// A later reader must not assume coverage this module does not claim.
//
// Why the rules are enforced here at all rather than by CP-SAT, why they are
// moving to Sanity, and why a human may override a hard block while the filler
// may not: `docs/adr/0010-specials-fill-locally-not-in-the-solver.md`.
//
// ─── The trap this module was written around ─────────────────────────────────
//
// **Rules name people by ALIAS, not by `member_name`.** Every seeded rule name
// (`MonthGenerator.tsx:122-165`) is an alias — "Frank", "Lucía", "Mkz" — whose
// `member_name` is a different, longer string. Resolving rule names with
// `memberIdToName` (which returns `member_name` only) would make every rule
// match nobody, and the feature would ship enforcing nothing with every test
// green (E11, fact 12). So: rule names resolve through `resolveToMemberName`
// (alias OR `member_name`), occupants resolve through `memberIdToName`, and both
// sides end up in `member_name` space before anything is compared. A name that
// resolves to nobody enforces nothing — which is why `unresolvedRuleNames` is an
// exported, mandatory part of this module's contract rather than a nicety.

import type { AssignedSeat, RankMember } from "./candidateRanking";
import {
  memberIdToName,
  resolveToMemberName,
  weekForColumn,
  type ColumnType,
  type GridColumn,
  type SolverConfig,
} from "./plannerModel";

/**
 * The row shape this module reads: an id, and nothing else.
 *
 * Deliberately structural rather than one of the two concrete types:
 * `rankCandidates` holds a `SeatDef` (`candidateRanking.ts:78-86`) while
 * `PlannerGrid` holds a `GridRow`, and both are assignable to this. For every
 * voice seat `seat.id === row.id` (`VOICE_SEATS` in `seatModel.ts` vs
 * `buildRows` in `plannerModel.ts`), so an id-keyed pattern map means the same
 * thing whichever one the caller has — nobody needs to thread `rows` in to
 * satisfy a signature.
 *
 * `category` is deliberately NOT read. An earlier draft also guarded on
 * `category === "voz"`; no mutation of it could make a test fail, because
 * `ROWS_FOR_ROLE` below lists voice row ids ONLY and is therefore already the
 * whole mechanism. A second lock that cannot be shown to lock anything is worse
 * than one lock that is stated.
 */
export interface RuleRow {
  id: string;
}

type RuleColumn = Pick<GridColumn, "type" | "date">;

export type RuleVerdict = { blocked: true; reason: string } | { blocked: false };

const NOT_BLOCKED: RuleVerdict = { blocked: false };

// ─── Patterns ────────────────────────────────────────────────────────────────

/** Mirrors the solver's own aliases (`gcf/owt_solver_v2.py:52-57`). */
const LEGACY_PATTERN_ALIASES: Record<string, string> = {
  "Lead.*": "*.Lead",
  "BGV.*": "*.BGV",
  "Choir.*": "*.Choir",
  "LeadBGV.*": "*.LeadBGV",
};

/**
 * The pattern→row mapping, stated ONCE, here.
 *
 * `Lead`→`lead`, `BGV`→`bgv`, `Choir`→`coro` is `ROLE_FIELD`
 * (`plannerModel.ts:560`) inverted. `*.LeadBGV` covers Lead and BGV (E16 — the
 * solver expands it to the four WEEKEND roles only, so a special's Lead+BGV is a
 * deliberate local extension, not an inherited property).
 *
 * **This map listing voice row ids ONLY is what makes patterns voice-only** —
 * `*` never reaches an instrument or FOH row, because `instrumento:Bass` is not
 * in any entry. There is no second category check; this is the one mechanism.
 *
 * The solver's own `*.*` is `set(ROLE_ORDER)` (`owt_solver_v2.py:40`, expanded
 * at `:167-168`) — five voice role types — and instruments/FOH have no solver
 * representation at all. Widening it locally would newly hard-block Lucía, Liu
 * and Marianne —
 * whose seeded week exclusions are `*.*` (`MonthGenerator.tsx:148-161`) — from
 * manual INSTRUMENT and FOH picks on the weekend grid, a shipped surface and a
 * change nobody asked for.
 */
const ROWS_FOR_ROLE: Record<string, readonly string[]> = {
  "*": ["lead", "bgv", "coro"],
  Lead: ["lead"],
  BGV: ["bgv"],
  Choir: ["coro"],
  LeadBGV: ["lead", "bgv"],
};

/**
 * Which service halves a column answers to.
 *
 * **A special answers to `*` and nothing else** (E15): the service half must
 * match, so of the eleven patterns the UI offers (`MonthGenerator.tsx:100-106`)
 * exactly four reach a special — `*.*`, `*.Lead`, `*.BGV`, `*.LeadBGV`. Ignoring
 * the service half instead would make Frank's `Sat.*` block him from a special,
 * the opposite of what that rule says.
 *
 * Consequence, stated plainly: **no seeded EXCLUSION fires on a special** (all
 * eight seeded exclusion patterns are service-qualified). All five seeded
 * CONFLICTS are `*.…` and do fire — which is the user's actual requirement.
 *
 * A `Record<ColumnType, …>`, so a fourth column type is a `tsc` error here
 * rather than silently inheriting "matches nothing".
 */
const SERVICE_HALVES: Record<ColumnType, readonly string[]> = {
  sunday_role: ["Sun", "*"],
  saturday_role: ["Sat", "*"],
  special_role: ["*"],
};

export interface ParsedPattern {
  /** `"Sun"`, `"Sat"` or `"*"`. */
  service: string;
  /** The voice row ids the pattern binds, in grid order. */
  rows: readonly string[];
}

/**
 * `"*.LeadBGV"` → `{ service: "*", rows: ["lead", "bgv"] }`.
 *
 * Returns `null` for anything unrecognised. The solver RAISES on an unsupported
 * pattern (`owt_solver_v2.py:178`); this cannot, because it runs inside a render
 * and the pattern set is closed by a pill grid the admin picks from, never typed.
 * An unparseable pattern therefore binds no row and refuses nobody.
 */
export function parsePattern(pattern: string): ParsedPattern | null {
  const p = LEGACY_PATTERN_ALIASES[pattern] ?? pattern;
  const dot = p.indexOf(".");
  if (dot === -1) return null;
  const service = p.slice(0, dot);
  if (service !== "Sun" && service !== "Sat" && service !== "*") return null;
  const rows = ROWS_FOR_ROLE[p.slice(dot + 1)];
  return rows ? { service, rows } : null;
}

/**
 * Whether `pattern` binds this (row, column) pair at all.
 *
 * **Without a `column` nothing matches.** The service half is half the pattern,
 * so a caller that omits the column has given every rule undefined scope —
 * answering "matches" there would apply `Sat.*` to a special. `SeatBoard` is the
 * one caller that could omit it (fact 25) and Task 9 threads it in; until then
 * its behaviour is provably unchanged.
 */
export function patternMatches(
  pattern: string,
  column: RuleColumn | undefined,
  row: RuleRow,
): boolean {
  if (!column) return false;
  const parsed = parsePattern(pattern);
  if (!parsed) return false;
  if (!parsed.rows.includes(row.id)) return false;
  return SERVICE_HALVES[column.type].includes(parsed.service);
}

// ─── Name resolution ─────────────────────────────────────────────────────────

/** The canonical `member_name` a rule's person text names, or `null` (E11). */
function ruleNameToCanonical(raw: string, members: RankMember[]): string | null {
  if (!raw.trim()) return null;
  const r = resolveToMemberName(raw, members);
  return "resolved" in r ? r.resolved : null;
}

/**
 * Every person named by a rule that resolves to NOBODY, deduplicated, in config
 * order — as the admin wrote them, so the string is searchable in the rules UI.
 *
 * This is not cosmetic. On the weekend path there is an accidental detector: an
 * unmatched DSL name is injected into the solver's `support`
 * (`plannerModel.ts:516-519`) and `applySolveResponse`'s `nameToId` then reports
 * it. **On a special no solve runs at all**, so an unmatched conflict name would
 * mean the module above enforces nothing, the pair the user named is seated
 * together, and the UI shows a normal successful auto-fill. This report is the
 * only safeguard against that, and against fact 12 (the never-independently-
 * confirmed claim that every seeded rule name is a real alias) being wrong.
 *
 * Presence persons are included even though presence rules are not enforced
 * here: an unresolvable name is equally broken for the solver, and this is the
 * only surface that says so.
 *
 * Task 8 merges this into `PlannerGrid`'s `unresolvedNames` prop; Task 9 puts
 * the same report on `SeatBoard`, so the warning follows the enforcement rather
 * than relying on the generator having been opened first.
 */
export function unresolvedRuleNames(
  config: SolverConfig | undefined,
  members: RankMember[],
): string[] {
  if (!config) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const check = (raw: string) => {
    if (!raw.trim()) return;
    const r = resolveToMemberName(raw, members);
    if ("resolved" in r) return;
    const key = r.unresolved.trim().toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(r.unresolved);
  };
  const { restrictions, conflicts, presence } = ruleLists(config);
  for (const r of restrictions) check(r.person);
  for (const c of conflicts) {
    check(c.personA);
    check(c.personB);
  }
  for (const p of presence) for (const n of p.persons) check(n);
  return out;
}

/**
 * The three rule arrays, each guaranteed to BE an array.
 *
 * Not defensive habit — a specific, live shape. `MonthGenerator` hydrates the
 * persisted config from `localStorage` checking only that `sundayLeads` and
 * `restrictions` are arrays (`MonthGenerator.tsx:~1120`), and `conflicts` /
 * `presence` were added to `SolverConfig` after that key was first written. A
 * config persisted before then sets state with those fields `undefined`, and the
 * `SolverConfig` type says otherwise, so nothing on the type side catches it.
 *
 * **This guard covers THIS module's own iteration and nothing else, and it is
 * not what keeps the planner on screen.** The generator's own config step reads
 * those fields raw, during its first render, before any grid exists:
 * `MemberPool` (`MonthGenerator.tsx:264/289/290/295`) and `RuleBuilder`
 * (`MonthGenerator.tsx:727`, `:802/:814/:826`). Nothing here is on that path.
 * The hydration normaliser in `MonthGenerator` is the SOLE guard for it —
 * deleting it white-screens an admin holding a legacy `localStorage` value the
 * moment they open the generator. Do not read this function as a second lock
 * behind it.
 */
function ruleLists(config: SolverConfig): {
  restrictions: SolverConfig["restrictions"];
  conflicts: SolverConfig["conflicts"];
  presence: SolverConfig["presence"];
} {
  return {
    restrictions: config.restrictions ?? [],
    conflicts: config.conflicts ?? [],
    presence: config.presence ?? [],
  };
}

// ─── The verdict ─────────────────────────────────────────────────────────────

export interface EvaluateInput {
  /** The candidate being considered for `row` on `column`. */
  member: RankMember;
  row: RuleRow;
  /** Absent ⇒ no rule can be scoped, so nothing is blocked. See `patternMatches`. */
  column?: RuleColumn;
  /**
   * The month's FULL Sunday spine, positional and 1-based — the same list
   * `weekForColumn` needs (`plannerModel.ts:575-585`). `GridColumn` carries no
   * week and none can be derived from a date alone: `Math.ceil(day / 7)` agrees
   * with the spine on Sundays by arithmetic accident and diverges on Saturdays
   * and weekday specials, which is E21's failure mode — a stated hard rule
   * landing on the wrong dates. Absent ⇒ week exclusions are simply not
   * evaluated; conflicts and exclusions still are.
   *
   * Pass `sundayDatesFull`, never a selected subset: Task 5 narrows
   * `buildColumns`' Sunday input to the SELECTED Sundays, and week 3 must stay
   * week 3 when the admin unticks week 1.
   */
  sundayDates?: string[];
  /** Everyone already seated on THIS column, `seatId` = row id. */
  assigned: AssignedSeat[];
  /** Required: `assigned` carries only ids, and rules name people by alias. */
  members: RankMember[];
  /** Absent ⇒ no rules, no blocks. `SeatBoard` has none until Task 9. */
  config?: SolverConfig;
}

/**
 * Whether a hard rule refuses ADDING `member` to (`row`, `column`).
 *
 * Order of checks: person exclusions, then week exclusions, then conflicts.
 * All three are hard, so the order decides only WHICH Spanish reason is shown;
 * it is fixed here so the string is deterministic in tests and in the UI.
 *
 * **The self-exemption is load-bearing** (E6) **and belongs to the manual picker
 * only** (P9). A member already occupying the cell being edited is never blocked
 * — `CandidateRow` guards both `onClick` and `onKeyDown` on `!blocked`
 * (`PlannerGrid.tsx:801-810`), so without this a violating pair produced by the
 * solver, or by a rule edited after seating, could not be UN-seated and the
 * admin's only escape would be discarding the month. Task 7's filler must
 * therefore exclude a cell's current occupants from its own pool itself (P9);
 * it cannot lean on this verdict, or it would re-pick the member it just placed.
 */
export function evaluate(input: EvaluateInput): RuleVerdict {
  const reasons = blockingReasons(input);
  return reasons.length > 0 ? { blocked: true, reason: reasons[0] } : NOT_BLOCKED;
}

/**
 * EVERY hard rule that refuses this pick, in `evaluate`'s own fixed order,
 * deduplicated — `evaluate` is this list's first element and nothing else.
 *
 * Kept private, and separate from `evaluate`, for exactly one caller:
 * `ruleViolationsForColumn` has to answer "is the rule this seat was overridden
 * past still the ONLY rule that refuses it?" (P10). A single first-match verdict
 * cannot answer that — waive an exclusion, then add a conflict that arrives
 * afterwards. Exclusions sort ahead (exclusions precede conflicts in `evaluate`'s
 * order), so first-match keeps returning the waived reason and masks the new
 * rule. The order below is still what decides which single reason the picker shows.
 */
function blockingReasons(input: EvaluateInput): string[] {
  const { member, row, column, sundayDates, assigned, members, config } = input;
  if (!config) return [];

  // E6/P9 — the occupant of the cell being edited, before any rule runs.
  if (assigned.some((a) => a.seatId === row.id && a.memberId === member._id)) return [];

  const me = member.member_name;
  const canonical = (raw: string) => ruleNameToCanonical(raw, members);
  const { restrictions, conflicts } = ruleLists(config);
  const out: string[] = [];
  const add = (reason: string) => {
    if (!out.includes(reason)) out.push(reason);
  };

  // 1. Person exclusions (E15) — the service half must match.
  for (const r of restrictions) {
    if (canonical(r.person) !== me) continue;
    for (const pattern of r.excludedPatterns) {
      if (patternMatches(pattern, column, row)) add(`Regla: excluido de ${pattern}`);
    }
  }

  // 2. Week exclusions (E7) — WEEKEND columns only. `weekForColumn` returns
  //    `null` for a special by construction, so the exclusion here is the
  //    spine's own answer rather than a second, drift-prone column-type test.
  const week = column && sundayDates ? weekForColumn(column, sundayDates) : null;
  if (week !== null) {
    for (const r of restrictions) {
      if (canonical(r.person) !== me) continue;
      for (const we of r.weekExclusions) {
        if (we.week === week && patternMatches(we.pattern, column, row)) {
          add(`Regla: excluido en la semana ${week} (${we.pattern})`);
        }
      }
    }
  }

  // 3. Pairwise conflicts (E14), scoped BY THE PATTERN, not by the rule.
  //    The solver binds per service AND per matching `role_types`
  //    (`owt_solver_v2.py:711-722`), so `*.Lead`/`*.BGV` bind the same ROW while
  //    `*.LeadBGV`/`*.*` bind across rows within the same COLUMN. E14's "same
  //    column" is the outer bound; the pattern narrows it. A Saturday and its
  //    adjacent Sunday are one week but two columns, and never conflict.
  for (const c of conflicts) {
    const a = canonical(c.personA);
    const b = canonical(c.personB);
    if (a === null || b === null) continue;
    const otherName = a === me ? b : b === me ? a : null;
    // `null` = neither side is this member; `me` = a rule naming one person
    // twice, which binds nobody (the solver's `sum(lt) + sum(rt) <= 1` would
    // count the same variable twice and refuse a legal single seat).
    if (otherName === null || otherName === me) continue;
    const parsed = patternMatches(c.pattern, column, row) ? parsePattern(c.pattern) : null;
    if (!parsed) continue;
    const clash = assigned.some(
      (x) => parsed.rows.includes(x.seatId) && memberIdToName(x.memberId, members) === otherName,
    );
    if (clash) {
      // Named with the RULE's own wording (an alias, as the admin typed it),
      // not the occupant's `member_name` — the message has to point at the rule
      // the admin can go and edit.
      add(`Regla: no puede coincidir con ${a === me ? c.personB : c.personA}`);
    }
  }

  return out;
}

// ─── E13: the post-fill re-check ─────────────────────────────────────────────

/** `${rowId}|${memberId}` — the same convention `PlannerGrid`'s `cellKey` uses. */
export const violationKey = (rowId: string, memberId: string) => `${rowId}|${memberId}`;

export interface SeatedViolation {
  /** The same Spanish reason `evaluate` gives for refusing the pick. */
  reason: string;
  /**
   * True ⇒ a human waived THIS rule for this seating, deliberately (P10). False
   * with an override on the seat means a different rule refuses it now, and
   * `reason` is that other rule — never the waived one.
   */
  overridden: boolean;
}

/**
 * Every ALREADY-SEATED occupant of one column that a hard rule refuses, keyed by
 * `violationKey`, each marked as either a live violation or a sanctioned one.
 *
 * **Why this is not just `evaluate` again.** `evaluate` answers "may I ADD this
 * person here?", and it exempts the cell's own occupants outright (its E6/P9
 * guard) so that a violating pair can always be un-seated. Asking it about
 * someone already seated therefore always answers "fine" — the exemption is
 * doing its job. This re-asks with THAT occupant's own seat removed, so the
 * rules see the column as it looked the instant before they were placed.
 *
 * The three ways a violation exists with no manual pick having produced it: the
 * SOLVER seated the pair (a special never reaches CP-SAT, but a weekend column
 * does, through a different rule path that can disagree with this one); a rule
 * was EDITED after the month was seated; or the month was seated in a browser
 * holding different rules. Task 7's filler cannot produce one — it refuses a
 * rule-blocked candidate per placement — so on a special this is a net under the
 * enforcement, never the enforcement itself.
 *
 * ─── What `overridden` changes, and why it is decided HERE ───────────────────
 *
 * **An override waives ONE RULE, not a person.** It is keyed by `violationKey`
 * and carries the exact reason `evaluate` gave when the admin set it aside, and
 * a seat stays sanctioned only while every rule that still refuses it is that
 * same one. Keying it by (date, row, member) alone — the shape this had first —
 * pre-sanctions rules the admin never saw: override Gaby onto Lead past
 * `Frank !with Gaby`, add `Gaby !in *.Lead` a week later, and her cell would
 * read "Regla anulada — Gaby: Regla: excluido de *.Lead", an exception nobody
 * made, presented as one they did. A DIFFERENT rule must flag fresh; that is
 * the whole point of E13 catching "a rule edited after seating".
 *
 * A seat whose sanction still stands is removed from the pool every OTHER
 * occupant is judged against. Without that, a pairwise conflict would re-appear
 * through its other party: override Gaby onto a Lead row Frank already holds and
 * the rule still refuses *Frank*, so the exception the admin just made would
 * light up in red next to a marker saying it was allowed. One override covers
 * one seating, from both ends — and once it goes stale it covers neither end,
 * so a newly forbidden pair flags on both.
 *
 * The overridden occupant is still evaluated — against the FULL column, its
 * partner included — because its `reason` is what the persistent "regla anulada"
 * marker names. Skipping it outright would make the exception silent, which is
 * the failure mode the marker exists to prevent.
 *
 * Pure and column-scoped: E14's conflicts are bounded by the column, and week
 * and person exclusions are per (row, column) too, so no second column can
 * contribute.
 */
export function ruleViolationsForColumn(input: {
  column: RuleColumn;
  /** Every row the column can hold; only ids are read. */
  rows: RuleRow[];
  /** Everyone seated on this column — `assignedForColumn`'s output. */
  assigned: AssignedSeat[];
  members: RankMember[];
  sundayDates?: string[];
  config?: SolverConfig;
  /**
   * P10 — `violationKey` → the EXACT reason that override waived, as
   * `evaluate` worded it at the moment the admin clicked "Asignar de todos
   * modos". A key with any other reason attached is not a sanction for the rule
   * firing now, so an entry whose rule has since been edited away simply stops
   * covering anything.
   */
  overridden?: ReadonlyMap<string, string>;
}): Map<string, SeatedViolation> {
  const { column, rows, assigned, members, sundayDates, config } = input;
  const overridden = input.overridden ?? EMPTY_WAIVERS;
  const out = new Map<string, SeatedViolation>();
  if (!config) return out;

  const rowById = new Map(rows.map((r) => [r.id, r]));
  const memberById = new Map(members.map((m) => [m._id, m]));

  /**
   * Every rule refusing `seat`, judged against `pool` with this occupant's own
   * seat removed — and ONLY this one. A member holding the same row twice (a
   * duplicate `canonicalRefs` would collapse) still sees their other copy, which
   * is right: that copy is a real occupant as far as a pairwise rule naming them
   * is concerned. `null` ⇒ the seat names a row or member that does not exist.
   */
  const reasonsFor = (seat: AssignedSeat, pool: AssignedSeat[]): string[] | null => {
    const row = rowById.get(seat.seatId);
    const member = memberById.get(seat.memberId);
    if (!row || !member) return null;
    let dropped = false;
    const others = pool.filter((x) => {
      if (dropped) return true;
      if (x.seatId === seat.seatId && x.memberId === seat.memberId) {
        dropped = true;
        return false;
      }
      return true;
    });
    return blockingReasons({ member, row, column, sundayDates, assigned: others, members, config });
  };

  // Pass 1 — which sanctions still stand. An overridden seat is judged against
  // the FULL column (see above), so this answer never depends on the pool the
  // pass below builds from it, and there is no circularity to unpick.
  const liveForOverridden = new Map<string, string[]>();
  const standing = new Set<string>();
  for (const seat of assigned) {
    const key = violationKey(seat.seatId, seat.memberId);
    const waived = overridden.get(key);
    if (waived === undefined) continue;
    const reasons = reasonsFor(seat, assigned);
    if (!reasons) continue;
    liveForOverridden.set(key, reasons);
    if (reasons.every((r) => r === waived)) standing.add(key);
  }
  const sanctionFree = assigned.filter((x) => !standing.has(violationKey(x.seatId, x.memberId)));

  for (const seat of assigned) {
    const key = violationKey(seat.seatId, seat.memberId);
    const waived = overridden.get(key);
    const reasons = liveForOverridden.get(key) ?? reasonsFor(seat, sanctionFree);
    if (!reasons || reasons.length === 0) continue;
    // A rule OTHER than the waived one is a violation the admin never sanctioned,
    // and it is the one worth naming: report it in red, not the stale marker.
    const fresh = reasons.find((r) => r !== waived);
    out.set(
      key,
      fresh !== undefined
        ? { reason: fresh, overridden: false }
        : { reason: reasons[0], overridden: true },
    );
  }
  return out;
}

const EMPTY_WAIVERS: ReadonlyMap<string, string> = new Map<string, string>();
