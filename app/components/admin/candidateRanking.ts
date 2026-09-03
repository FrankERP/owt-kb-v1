// app/components/admin/candidateRanking.ts
//
// Who should fill this seat, in order, with the three signals the old form
// withheld until after save: availability on the date, whether the person is
// already assigned on this service, and how much they have served recently.
//
// This is NOT the solver. `gcf/owt_solver_v2.py` handles five VOICE role types
// only and requires 3-6 weeks, so a single service is not a valid input to it
// (design D5). This is a pure sort over data the panel already holds — instant,
// no Cloud Run call, and it works for instruments and FOH, which the solver
// cannot express at all.

import {
  computeParticipation,
  serviceWeekKey,
  type ParticipantRole,
} from "@/app/utils/computeParticipation";
import type { SeatCategory, SeatDef } from "./seatModel";
import { evaluate } from "./ruleEnforcement";
import type { GridColumn, SolverConfig } from "./plannerModel";

export interface RankMember {
  _id: string;
  member_name: string;
  alias?: string;
  memberType?: string[];
  unavailableDates?: string[];
}

/** A seat already occupied on the service being edited. */
export interface AssignedSeat {
  seatId: string;
  category: SeatCategory;
  memberId: string;
}

export interface RankedCandidate {
  id: string;
  name: string;
  /** False when the member marked this date unavailable. Still selectable. */
  available: boolean;
  /** True when the member holds another seat on this service. */
  alreadyAssigned: boolean;
  /** Non-null = may NOT be selected, with the Spanish reason. */
  blockedReason: string | null;
  /**
   * Non-null = a HARD solver rule refuses ADDING this member here, with the
   * Spanish reason (E6). **A separate field from `blockedReason` on purpose**:
   * the two are different refusals with different copy, and the picker has to be
   * able to say which one it is. Task 8/9's manual-pick refusal reads BOTH.
   * Always `null` when no `config` is passed.
   */
  ruleBlockedReason: string | null;
  /**
   * The FILLER's composite verdict (P7/P8) — `¬blockedReason ∧
   * ¬ruleBlockedReason ∧ available`. **The manual picker must NOT read this.**
   * It folds in `available`, and availability is a `+10` sort penalty for a
   * human clicking, never a block (fact 19, a stated non-goal): wiring the UI
   * to `eligible` would turn unavailability into a hard block on two shipped
   * surfaces. A person can override a penalty knowingly; Task 7's loop cannot,
   * which is why the loop gets the stricter predicate.
   */
  eligible: boolean;
  /** Services in the window, on the participation week rule. */
  load: number;
  /** One cell per week, oldest first. */
  recent: boolean[];
}

export const displayName = (m: RankMember) => m.alias?.trim() || m.member_name;

/**
 * Every member id serving in this role, in the given seat category only.
 *
 * `recent` must show the same fact as `load` (loadField below), so it has to
 * be filtered by category exactly like load is: voz = leads+bgvs+chorus
 * (matching computeParticipation's voice-only `total`), instrumento =
 * instruments[].person, foh = foh[].person. Merging all five paths
 * unconditionally (the old behaviour) made the strip light up for weeks a
 * member served in a DIFFERENT category — a real case for the voz+instrumento
 * members the design accommodates (D4) — contradicting the load number.
 */
function servingIds(role: ParticipantRole, category: SeatCategory): string[] {
  switch (category) {
    case "voz":
      return [
        ...(role.leads ?? []).map((p) => p._id),
        ...(role.bgvs ?? []).map((p) => p._id),
        ...(role.chorus ?? []).map((p) => p._id),
      ];
    case "instrumento":
      return (role.instruments ?? []).filter((s) => s.person).map((s) => s.person!._id);
    case "foh":
      return (role.foh ?? []).filter((s) => s.person).map((s) => s.person!._id);
  }
}

export function rankCandidates(input: {
  seat: SeatDef;
  date: string;
  members: RankMember[];
  windowRoles: ParticipantRole[];
  assigned: AssignedSeat[];
  weeks?: number;
  /**
   * The column being edited. **Optional**, and the fallback is deliberate:
   * without it no pattern's service half can be matched, so every rule is out
   * of scope and `ruleBlockedReason` stays `null`. Enforcing nothing is the
   * honest answer when the caller cannot say which service it is ranking for —
   * never a reason to guess a column.
   */
  column?: Pick<GridColumn, "type" | "date">;
  /** The month's full Sunday spine; only week exclusions need it (E7, E21). */
  sundayDates?: string[];
  /**
   * The rules. **Optional, and absent means "no rules", never "the defaults".**
   *
   * `PlannerGrid`, the only caller, passes the panel's edited copy of the
   * shared Sanity document (ADR-0010). It stays optional so a caller that does
   * not know the rules — a loading or failed read — enforces nothing rather
   * than inventing refusals against `DEFAULT_SOLVER_CONFIG`, which is nobody's
   * decision (`solverConfigSource.ts`).
   */
  config?: SolverConfig;
}): RankedCandidate[] {
  const { seat, date, windowRoles, assigned, column, sundayDates, config } = input;
  const members = (input.members ?? []) as RankMember[];
  const weeks = input.weeks ?? 4;

  // Load comes from the shipped counter so the WEEK RULE (Saturday counts toward
  // the following Sunday, a special counts toward the next Sunday on or after it)
  // cannot drift between this and the participation sidebar.
  //
  // **That is the only thing shared, and the sentence used to claim more.** The
  // rule is shared; the SET of services it is applied to is not, and since the
  // participation chart sits beside the picker the two numbers are on one screen
  // and legitimately disagree. `PlannerGrid` passes `unionRoles` — the ranking
  // lookback plus every draft on the grid, including columns that will never be
  // created — while the chart counts the month's saved services plus only the
  // creatable drafts (`plannerParticipationRoles`). Both sides are right about
  // their own question, and the chart is the more truthful about "has this month
  // been fair" — so the divergence is not a bug to arithmetic away. It is why
  // the picker LABELS this figure instead of rendering a bare number next to a
  // chart of totals. Do not "reconcile" them by feeding one the other's roles:
  // the picker's union is deliberate (a person seated three times earlier in
  // this grid must rank lower for the fourth seat, before anything is saved).
  //
  // computeParticipation
  // keeps `total` VOICE-ONLY (sunLead+satLead+sunBGV+satBGV+coro+especial) and
  // tracks instrument/FOH history in separate fields, so the figure read here
  // must match the seat's own category — otherwise instrumento/foh seats (the ones
  // the solver can't touch at all, and where this fairness signal matters most)
  // always read load 0. The `recent` strip below is built by `servingIds` filtered
  // to this SAME category, so they count the same category—but load sums appearances
  // and recent counts distinct weeks (by serviceWeekKey). E.g. serving both Sat and
  // Sun of one weekend: load = 2, recent = one true cell.
  const loadField =
    seat.category === "instrumento" ? "instrWeeks" : seat.category === "foh" ? "fohWeeks" : "total";
  const loadById = new Map(computeParticipation(windowRoles).map((p) => [p.id, p[loadField]]));

  // The most recent `weeks` week-keys present in the window, oldest first.
  const weekKeys = [...new Set(windowRoles.map(serviceWeekKey))].sort().slice(-weeks);
  const servedInWeek = new Map<string, Set<string>>();
  for (const role of windowRoles) {
    const key = serviceWeekKey(role);
    let set = servedInWeek.get(key);
    if (!set) servedInWeek.set(key, (set = new Set()));
    for (const id of servingIds(role, seat.category)) set.add(id);
  }

  // A member can hold several seats on one service (D4: voz + instrumento is
  // real — Frank and Mkz both lead and play). A Map keyed by memberId would
  // keep only the LAST seat built for that member, and a caller that builds
  // `assigned` in seat order (voces, then instrumentos, then FOH) would have an
  // instrument seat silently overwrite a voice one, hiding the same-category
  // conflict the block exists to catch. This is not hypothetical: it is the bug
  // that shipped. Keep every held seat.
  const seatsById = new Map<string, AssignedSeat[]>();
  for (const a of assigned) {
    const list = seatsById.get(a.memberId);
    if (list) list.push(a);
    else seatsById.set(a.memberId, [a]);
  }

  const rows: RankedCandidate[] = (members ?? [])
    .filter((m) => (m.memberType ?? []).includes(seat.memberType))
    .map((m) => {
      const heldSeats = seatsById.get(m._id) ?? [];
      // D4: same category is a real conflict (nobody sings Lead and BGV at once);
      // voz + instrumento is what Frank and Mkz actually do, so it only informs.
      // The seat being targeted itself never counts as a conflict — a member
      // already in this exact seat must stay selectable so they can be toggled off.
      const conflict = heldSeats.find(
        (held) => held.category === seat.category && held.seatId !== seat.id,
      );
      const blockedReason = conflict ? `Ya asignado en ${labelOfSeatId(conflict.seatId)}` : null;
      const strip = weekKeys.map((k) => servedInWeek.get(k)?.has(m._id) ?? false);
      // Pad on the left so every strip is the same width regardless of history.
      const recent = [...Array(Math.max(0, weeks - strip.length)).fill(false), ...strip];
      const available = !(m.unavailableDates ?? []).includes(date);
      // `seat` crosses as the row: for every voice seat `seat.id === row.id`,
      // and the rules only ever bind voice rows.
      const verdict = evaluate({ member: m, row: seat, column, sundayDates, assigned, members, config });
      const ruleBlockedReason = verdict.blocked ? verdict.reason : null;
      return {
        id: m._id,
        name: displayName(m),
        available,
        alreadyAssigned: heldSeats.some((held) => held.seatId !== seat.id),
        blockedReason,
        ruleBlockedReason,
        eligible: !blockedReason && !ruleBlockedReason && available,
        load: loadById.get(m._id) ?? 0,
        recent,
      };
    });

  // THE SORT IS DELIBERATELY UNCHANGED (P7b), in two respects:
  //
  //  • No fairness term. The user settled this: "I don't want them necessarily
  //    buried, just not pushed up top always, if it's just visual then it
  //    doesn't matter." Ordering here is visual, so the smallest correct change
  //    is none. The filler's `effectiveLoad` (Task 7) is the only place exempt
  //    and slack members move, and it never touches `load`, which is rendered.
  //  • `ruleBlockedReason` is NOT a sort key. A rule-blocked candidate keeps its
  //    load-ordered position and renders disabled with the rule named — E6
  //    accepts that the people a rule protects sit at the top of every list;
  //    that is precisely WHY the rule has to be hard rather than a nudge.
  const rank = (c: RankedCandidate) =>
    (c.blockedReason ? 100 : 0) + (c.available ? 0 : 10) + (c.alreadyAssigned ? 1 : 0);

  return rows.sort(
    (a, b) => rank(a) - rank(b) || a.load - b.load || a.name.localeCompare(b.name, "es"),
  );
}

/** `lead` -> `Lead`, `instrumento:Bass` -> `Bass`. */
function labelOfSeatId(seatId: string): string {
  const tail = seatId.includes(":") ? seatId.slice(seatId.indexOf(":") + 1) : seatId;
  return tail.charAt(0).toUpperCase() + tail.slice(1);
}
