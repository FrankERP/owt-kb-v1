// app/components/admin/localFill.ts
//
// The greedy local filler for a SPECIAL service — the one place the user's
// requirement actually lands.
//
// "I need some rules enforced in specials. Specially that exclude two people
// from being together." / "It has to be hard because if it's soft in fairness it
// will always choose people like Frank, Mkz or Gaby who tend to have 1 or 2
// participations a month."
//
// A special is never sent to CP-SAT (E4/E5) and no greedy fill existed anywhere
// in this codebase before this file: `handleAuto` only calls `/api/admin/solve`.
// So auto-filling a special, and keeping a forbidden pair apart while doing it,
// is entirely this module. A filler that seats the pair and flags it afterwards
// fails the requirement with every test green.
//
// ─── The three traps, and where each is closed ───────────────────────────────
//
//  1. **Per-placement re-evaluation** (step 3). The seeded conflicts are
//     `*.Lead`, `*.BGV`, `*.LeadBGV` (`MonthGenerator.tsx:167-173`) — two people
//     in the SAME row of the same column, and Lead's target is 2. Rank once
//     against a pre-fill snapshot and BOTH members of a forbidden pair are
//     individually unblocked, so both get seated. The manual picker escapes this
//     only because React re-renders and `rankFor` re-ranks between clicks
//     (`PlannerGrid.tsx:386`); a loop has no such thing. So `rankCandidates` is
//     called again for EVERY placement, against `working` — the assignment state
//     as of that moment.
//  2. **In-cell exclusion** (P9, step 2a). `rankCandidates` deliberately exempts
//     the seat being edited from its double-duty block (`candidateRanking.ts:170`)
//     and `evaluate` exempts the cell's own occupants
//     (`ruleEnforcement.ts:295`) — both so a human can toggle someone OFF. A
//     voice row is ONE multi-occupant cell, so the member just seated is still
//     `eligible` for the cell still being filled, and `canonicalRefs` keeps
//     genuine duplicates: the same person would reach Sanity in `Lead[]` twice.
//     The pool therefore excludes the cell's current occupants, this call's own
//     placements included.
//  3. **Which rows** (step 2, P5, D5, O3). `hasTarget` is true for `coro` on a
//     special (E18 gives it the row) and `rowAppliesTo` is true for all five
//     instruments plus FOH. Neither is the fill rule: `AUTO_FILL_ROW_IDS` is
//     `lead` and `bgv`, and nothing else. The user was asked directly and said
//     "No, don't fill Coro on a special."
//
// ─── What this is NOT ────────────────────────────────────────────────────────
//
// Not the solver, and it must never be described as one in the UI. Extending
// CP-SAT to specials was weighed, costed and turned down — see
// `docs/adr/0010-specials-fill-locally-not-in-the-solver.md` before "fixing"
// this by pointing it at the solver. It is greedy,
// single-column, and one-pass: it approximates fairness through `effectiveLoad`
// (P7b) and enforces NO count caps and no presence rules (both stated non-goals
// of `ruleEnforcement`). It never backtracks — a seat with no eligible candidate
// is left EMPTY and reported, never filled by relaxing a rule.

import type { ParticipantRole } from "@/app/utils/computeParticipation";
import { rankCandidates, type RankedCandidate, type RankMember } from "./candidateRanking";
import {
  assignedForColumn,
  cellsToParticipantRoles,
  hasTarget,
  reconcileOccupants,
  resolveToMemberName,
  seatDefForRow,
  type GridCell,
  type GridColumn,
  type GridRow,
  type SolverConfig,
} from "./plannerModel";

/**
 * The rows the filler seats, and the whole of it (O3).
 *
 * NOT `hasTarget` alone — that is true for `coro` on a special, whose target is
 * 3, so filling every targeted row would auto-seat eight voices into a midweek
 * service. NOT `rowAppliesTo` — true for every non-`coro` row on every column
 * type, so it would seat five instruments and FOH, which D5 keeps manual.
 * `hasTarget` is still consulted per row below: it is what supplies the cap, and
 * it is the authority on whether the row exists on this column at all.
 */
export const AUTO_FILL_ROW_IDS: readonly string[] = ["lead", "bgv"];

export interface FillColumnInput {
  /** The column to fill. Only a `special_role` column is ever filled — see below. */
  column: GridColumn;
  /**
   * **Required.** The in-grid half of the `load` signal is
   * `cellsToParticipantRoles(cells, columns, members)` (`PlannerGrid.tsx:247-250`),
   * which iterates COLUMNS — pass a subset and `load` never moves between two
   * specials in one grid, so the filler re-picks the same people for both.
   */
  columns: GridColumn[];
  rows: GridRow[];
  cells: GridCell[];
  members: RankMember[];
  /** D12's saved history window — the same array `PlannerGrid` is given. */
  savedWindow: ParticipantRole[];
  /** Absent ⇒ no rules and no fairness terms. Blocks and `effectiveLoad` both need it. */
  config?: SolverConfig;
}

export interface FillColumnResult {
  /** The whole grid, merged — every cell this did not touch survives by reference. */
  cells: GridCell[];
  /**
   * ONE ENTRY PER SEAT left empty, matching `mapUnfilledSeats`, which emits one
   * per solver `unfilled_seats` string (`unfilledSeats.ts:30`) and whose `length`
   * `PlannerGrid` renders as a count of people missing.
   */
  unfilled: { columnId: string; rowId: string }[];
}

// ─── Fairness (P7b) ──────────────────────────────────────────────────────────

type Fairness = { kind: "exempt" } | { kind: "slack"; n: number };

/**
 * member id -> fairness treatment, resolved from the rules.
 *
 * Rules name people by ALIAS (fact 12 — every seeded name is one, and confirmed
 * against production 2026-07-31), so resolution goes through
 * `resolveToMemberName`, never `memberIdToName`. A name that resolves to nobody
 * contributes nothing here and is reported by `unresolvedRuleNames`.
 *
 * FIRST match wins: the config permits several restrictions naming one person
 * (the seeded Gaby entry is itself a merge of two production lines), and a
 * silent last-wins would make the treatment depend on config order.
 *
 * `fairness: "slack"` with `fairnessSlack <= 0` is treated as no treatment at
 * all, matching `restrictionToDs`, which only emits `fairness_slack N` for
 * `N > 0` (`plannerModel.ts:499`). A `+0` offset is not a fairness rule.
 */
export function fairnessByMemberId(
  config: SolverConfig | undefined,
  members: RankMember[],
): Map<string, Fairness> {
  const out = new Map<string, Fairness>();
  if (!config) return out;
  // `?? []` for the same reason `ruleEnforcement`'s `ruleLists` exists: a config
  // persisted before a field existed arrives with it `undefined`, and the type
  // says otherwise. `restrictions` is the one field the hydration guard already
  // checks, so this is the cheap half of the same lock, not a second mechanism.
  for (const r of config.restrictions ?? []) {
    const resolved = resolveToMemberName(r.person, members);
    if (!("resolved" in resolved)) continue;
    const member = members.find((m) => m.member_name === resolved.resolved);
    if (!member || out.has(member._id)) continue;
    if (r.fairness === "exempt") out.set(member._id, { kind: "exempt" });
    else if (r.fairness === "slack" && r.fairnessSlack > 0) {
      out.set(member._id, { kind: "slack", n: r.fairnessSlack });
    }
  }
  return out;
}

/**
 * The LOWER of the two middles on an even count — stated rather than averaged,
 * so the result is always a load some real candidate carries.
 * `null` for an empty input; the caller falls back to the raw load rather than
 * producing `NaN`, which would make the comparator non-transitive.
 */
function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length / 2) - 1];
}

/**
 * The filler's ordering key (P7b), and **never** `RankedCandidate.load`, which
 * is rendered on two shipped surfaces (`PlannerGrid.tsx`, `SeatBoard.tsx`).
 *
 *  • exempt  ⇒ the MEDIAN load of the eligible NON-exempt candidates. "Not
 *    pushed up top, not buried" is the user's own wording (O2); an earlier draft
 *    used `+∞`, which is burial and is explicitly wrong. With the non-exempt set
 *    empty — every eligible candidate exempt, reachable on a thin `voz` pool
 *    since Frank and Mkz both are — it falls back to the raw load.
 *  • slack N ⇒ `load + N`.
 *  • anyone else ⇒ the raw load.
 *
 * A slack member contributes their RAW load to the median, not `load + N`: the
 * median describes the pool's real service level, and inflating it with the
 * offset would let one slack member drag every exempt member's position with her.
 *
 * Recomputed per placement, because the pool shrinks as seats fill.
 */
export function orderByEffectiveLoad(
  pool: RankedCandidate[],
  fairness: Map<string, Fairness>,
): RankedCandidate[] {
  const median = medianOf(pool.filter((c) => fairness.get(c.id)?.kind !== "exempt").map((c) => c.load));
  const effective = (c: RankedCandidate): number => {
    const f = fairness.get(c.id);
    if (!f) return c.load;
    if (f.kind === "exempt") return median ?? c.load;
    return c.load + f.n;
  };
  // Decorated with the incoming index and tie-broken on it explicitly: ties fall
  // back to `rankCandidates`' own order (load, then `localeCompare(…, "es")`)
  // by construction rather than by trusting the engine's sort to be stable.
  return pool
    .map((c, i) => ({ c, key: effective(c), i }))
    .sort((a, b) => a.key - b.key || a.i - b.i)
    .map((x) => x.c);
}

// ─── The fill ────────────────────────────────────────────────────────────────

function withAutoCell(cells: GridCell[], columnId: string, rowId: string, memberIds: string[]): GridCell[] {
  const idx = cells.findIndex((c) => c.columnId === columnId && c.rowId === rowId);
  // `origin: "auto"`, matching `applySolveResponse` against `withUpdatedCell`'s
  // `"manual"`. Nothing reads the field for behaviour today; setting it
  // correctly keeps it meaningful if anything ever does. A cell that already
  // held a manual pick and then receives an auto one becomes `"auto"` — the
  // cell is no longer purely manual, and the field describes the cell, not each
  // occupant.
  const occupants = reconcileOccupants(idx === -1 ? [] : cells[idx].occupants, memberIds);
  if (idx === -1) return [...cells, { columnId, rowId, occupants, origin: "auto" }];
  const next = [...cells];
  next[idx] = { ...next[idx], occupants, origin: "auto" };
  return next;
}

/**
 * Fill one special column's Lead and BGV up to target, greedily, refusing every
 * rule-blocked and every unavailable candidate outright.
 *
 * Pure: no React, no fetch, no clock. Deterministic — the same inputs always
 * produce the same seats — and idempotent: re-run on an already-filled column
 * and nothing changes, because every cell is already at target. It only ever
 * APPENDS to a cell, so a manual pick is never replaced or evicted (D6); a cell
 * a human half-filled is topped up rather than rebuilt.
 *
 * **A non-special column is returned untouched.** The weekend grid belongs to
 * CP-SAT (E4/E5), and a greedy pass over it would silently compete with the
 * solve `handleAuto` just committed. `handleAuto` filters to specials before
 * calling; this is the structural half of that, and it is directly testable
 * rather than a lock nothing can demonstrate.
 */
export function fillColumn(input: FillColumnInput): FillColumnResult {
  const { column, columns, rows, cells, members, savedWindow, config } = input;
  const unfilled: { columnId: string; rowId: string }[] = [];
  if (column.type !== "special_role") return { cells, unfilled };

  const fairness = fairnessByMemberId(config, members);
  let working = cells;

  for (const row of rows) {
    if (!hasTarget(row, column)) continue;
    if (!AUTO_FILL_ROW_IDS.includes(row.id)) continue;
    const target = row.target ?? 0;
    const seat = seatDefForRow(row);

    let current =
      working
        .find((c) => c.columnId === column.columnId && c.rowId === row.id)
        ?.occupants.map((o) => o.memberId) ?? [];

    while (current.length < target) {
      // STEP 3 — re-ranked against `working`, the assignment state as of THIS
      // placement. Hoisting any of these three out of the loop re-introduces the
      // pre-fill snapshot the whole module exists to avoid.
      const windowRoles = [...savedWindow, ...cellsToParticipantRoles(working, columns, members)];
      const assigned = assignedForColumn(working, rows, column.columnId);
      const ranked = rankCandidates({
        seat,
        date: column.date,
        members,
        windowRoles,
        assigned,
        column,
        config,
        // No `sundayDates`: week exclusions bind weekend columns only —
        // `weekForColumn` is `null` for a special by construction — and this
        // function fills nothing else.
      });

      // STEP 4 — the `eligible` VERDICT, never a sort position. Availability and
      // rule blocks live only in `rankCandidates`' sort today (a `+10` and a
      // nothing respectively), so taking the top `target` rows would seat a
      // blocked or unavailable person whenever the eligible pool is thinner than
      // the target — routine on a special. Plus P9's in-cell exclusion.
      const inCell = new Set(current);
      const pool = ranked.filter((c) => c.eligible && !inCell.has(c.id));

      // STEP 5 — an empty seat is the correct output. One entry per seat still
      // missing, then on to the next row; no relaxation, no second pass.
      if (pool.length === 0) {
        for (let i = current.length; i < target; i++) {
          unfilled.push({ columnId: column.columnId, rowId: row.id });
        }
        break;
      }

      const pick = orderByEffectiveLoad(pool, fairness)[0];
      current = [...current, pick.id];
      working = withAutoCell(working, column.columnId, row.id, current);
    }
  }

  return { cells: working, unfilled };
}
