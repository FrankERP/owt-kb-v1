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
 * How many "generations" of rest a seeded alternative may reach back through.
 *
 * Sort a seat's pool by last-served and collapse it to DISTINCT dates: the pairs
 * that have rested longest are generation 1, the next-longest generation 2, and
 * so on. A seeded variant draws from the first `SLACK_GENERATIONS`, so it can
 * pass over a slightly-more-rested pair in favour of a slightly-less-rested one,
 * which is what makes two options actually differ once history exists.
 *
 * The last generation is always excluded when more than one exists, so the pair
 * that served MOST RECENTLY can never be pulled forward. That is the bound: this
 * buys variety with a little fairness, never with the rotation itself.
 *
 * Raising it to `Infinity` would make the seat a lottery; 2 is the smallest value
 * that still produces distinct months against a saturated history (pinned by
 * "still produces different plans once a SATURATED history leaves no ties at all").
 *
 * ADR-0021 records why an alternative spends a little fairness instead of only
 * reshuffling ties — and the two plausible tests that passed against a ties-only
 * implementation before the third fixture was honest enough to catch it. Read it
 * before "simplifying" this back to a tie-break.
 */
const SLACK_GENERATIONS = 2;

/**
 * FNV-1a over `seed|category|pairId`. Pure, no `Math.random()` — the seed IS the
 * randomness, supplied by the caller, so "same input ⇒ same output" survives and
 * the planner can still regenerate a month and diff it.
 *
 * Keying on the category as well as the pair means a variant reshuffles each
 * rotation independently, rather than applying one global reordering that would
 * make every seat move in lockstep.
 */
function shuffleKey(seed: number, category: string, pairId: string): number {
  let hash = (0x811c9dc5 ^ (seed >>> 0)) >>> 0;
  const source = `${seed}|${category}|${pairId}`;
  for (let i = 0; i < source.length; i++) {
    hash = (hash ^ source.charCodeAt(i)) >>> 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * A stable identity for a whole month's proposal, so the generate route can tell
 * "this seed produced something new" from "this seed produced what you already
 * rejected" without shipping two plans to the client to compare.
 *
 * Seat keys are sorted, so it fingerprints the PLAN and not the object literal's
 * insertion order.
 */
export function proposalFingerprint(proposal: KidsAssignment[]): string {
  return proposal
    .map((row) => {
      const seats = Object.entries(row.seats)
        .filter(([, pairId]) => Boolean(pairId))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([seat, pairId]) => `${seat}=${pairId}`)
        .join(",");
      return `${row.date}:${seats}`;
    })
    .join("|");
}

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

/**
 * The slice of an already-fairness-sorted pool a seeded variant may choose from.
 *
 * Collapses the pool to distinct last-served dates and keeps the first
 * `SLACK_GENERATIONS` of them — minus the most recent generation whenever more
 * than one exists, which is the rule that stops a variant from re-seating last
 * Sunday's pair. With every pair tied (the roster's state before any month is
 * saved) there is exactly one generation, so the whole pool is fair game and the
 * alternatives differ the most.
 */
function eligibleUnderSlack(
  rested: RotationPair[],
  category: string,
  servedOn: (category: string, pairId: string) => string,
): RotationPair[] {
  const generations: string[] = [];
  for (const pair of rested) {
    const served = servedOn(category, pair.id);
    if (generations[generations.length - 1] !== served) generations.push(served);
  }

  // One generation means a clean tie — no fairness to spend, so spend none.
  const reach =
    generations.length <= 1 ? 1 : Math.min(SLACK_GENERATIONS, generations.length - 1);
  const allowed = new Set(generations.slice(0, reach));
  return rested.filter((pair) => allowed.has(servedOn(category, pair.id)));
}

export function planKidsMonth(input: RotationInput): RotationResult {
  const { sundays, pairs, unavailable, history, worshipAssignments, seed = 0 } = input;

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

      const rested = [...pool].sort((a, b) => {
        const byDate = servedOn(category, a.id).localeCompare(servedOn(category, b.id));
        return byDate !== 0 ? byDate : a.id.localeCompare(b.id);
      });

      // Seed 0 (and no seed at all) is the strict least-recently-served answer —
      // the fairest month, and the one "Generar mes" shows first. Everything
      // below only ever runs for an explicitly requested alternative.
      const [chosen] = seed
        ? [...eligibleUnderSlack(rested, category, servedOn)].sort((a, b) => {
            const byKey = shuffleKey(seed, category, a.id) - shuffleKey(seed, category, b.id);
            return byKey !== 0 ? byKey : a.id.localeCompare(b.id);
          })
        : rested;

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
