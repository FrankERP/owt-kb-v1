import {
  KIDS_SEATS,
  KIDS_SEAT_LABELS,
  type KidsAssignment,
  type KidsSeat,
  type RotationDiagnostic,
  type RotationInput,
  type RotationPair,
  type RotationResult,
  type RotationWarning,
} from "./kidsTypes";

/**
 * Oasis Kids rotation engine — PURE and DETERMINISTIC.
 *
 * No `Date.now()`, no `Math.random()`, no `new Date(...)`: dates are Sanity
 * `date` strings (`YYYY-MM-DD`) and are compared as strings, which sort
 * correctly and dodge the repo's UTC day-flip invariant entirely. The `id`
 * tie-break is what makes "same input twice ⇒ identical output" a property
 * rather than a coincidence, so the planner can regenerate a month and diff it.
 *
 * Rules (spec §1, §7.6): four seats per Sunday; the enseñanza pool is every
 * active pair, a room seat's pool is that room's pairs; a pair holds at most one
 * seat per Sunday; a pair is unavailable when EITHER member is; fairness is
 * least-recently-served PER SEAT CATEGORY; an unfillable seat stays EMPTY with a
 * Spanish diagnostic (never mis-seated); a worship overlap only WARNS.
 */

/** Never-served sentinel: sorts before every real ISO date as a plain string. */
const NEVER = "0000-00-00";

/**
 * Fairness bucket for a seat. Enseñanza is its own rotation; each room rotates
 * separately, so a pair that taught last week is still next in line for its room.
 */
const seatCategory = (seat: KidsSeat): string =>
  seat === "ensenanza" ? "ensenanza" : `room:${seat}`;

/**
 * A pair is out when EITHER member is out that date — one absent member is
 * enough to empty the room. Exported because the planner's `<select>` greys out
 * the same options; a second implementation would drift from this one.
 */
export function pairUnavailable(
  pair: RotationPair,
  date: string,
  unavailable: Record<string, string[]>,
): boolean {
  return pair.memberIds.some((memberId) => unavailable[memberId]?.includes(date) ?? false);
}

export function planKidsMonth(input: RotationInput): RotationResult {
  const { sundays, pairs, unavailable, history, worshipAssignments } = input;

  // category -> pairId -> the last date that pair served that category.
  const lastServed = new Map<string, Map<string, string>>();
  const record = (category: string, pairId: string, date: string) => {
    const byPair = lastServed.get(category) ?? new Map<string, string>();
    byPair.set(pairId, date);
    lastServed.set(category, byPair);
  };
  const servedOn = (category: string, pairId: string) =>
    lastServed.get(category)?.get(pairId) ?? NEVER;

  // Seed from prior assignments in array order (ascending by date), so the month
  // being planned continues the rotation instead of restarting it.
  for (const past of history) {
    for (const seat of KIDS_SEATS) {
      const pairId = past.seats[seat];
      if (pairId) record(seatCategory(seat), pairId, past.date);
    }
  }

  const proposal: KidsAssignment[] = [];
  const warnings: RotationWarning[] = [];
  const diagnostics: RotationDiagnostic[] = [];

  for (const date of sundays) {
    const seats: Partial<Record<KidsSeat, string>> = {};
    const seatedToday = new Set<string>();
    const worshipToday = worshipAssignments?.[date] ?? [];

    // Fixed seat order, and enseñanza FIRST on purpose: the teaching pair leaves
    // its own room's pool for that Sunday, so the room seat falls to the room's
    // next pair rather than fighting the teacher for it.
    for (const seat of KIDS_SEATS) {
      const category = seatCategory(seat);
      const pool = pairs
        .filter((pair) => (seat === "ensenanza" ? true : pair.room === seat))
        .filter((pair) => !seatedToday.has(pair.id))
        .filter((pair) => !pairUnavailable(pair, date, unavailable));

      if (pool.length === 0) {
        // Honest degradation: an empty seat the planner can see beats a pair
        // seated somewhere it does not belong.
        diagnostics.push({
          date,
          seat,
          kind: "unfillable",
          reason: `Sin parejas disponibles para ${KIDS_SEAT_LABELS[seat]} el ${date}`,
        });
        continue;
      }

      const [chosen] = [...pool].sort((a, b) => {
        const byDate = servedOn(category, a.id).localeCompare(servedOn(category, b.id));
        return byDate !== 0 ? byDate : a.id.localeCompare(b.id);
      });

      seats[seat] = chosen.id;
      seatedToday.add(chosen.id);
      record(category, chosen.id, date);

      // Overlap with a worship assignment WARNS and never blocks: doubling up is
      // not world-ending, it is just worth seeing before the month is published.
      for (const memberId of chosen.memberIds) {
        if (worshipToday.includes(memberId)) {
          warnings.push({ date, seat, pairId: chosen.id, memberId, kind: "worship-overlap" });
        }
      }
    }

    proposal.push({ date, seats });
  }

  return { proposal, warnings, diagnostics };
}
