import { pairUnavailable } from "./kidsRotation";
import {
  KIDS_ROOMS,
  KIDS_SEATS,
  KIDS_SEAT_LABELS,
  type KidsAssignment,
  type KidsRoom,
  type KidsSeat,
  type RotationPair,
} from "./kidsTypes";

/**
 * Presentation layer for the Kids planner — PURE and DETERMINISTIC.
 *
 * The rotation engine (`kidsRotation.ts`) decides; this module explains. A
 * planner made of bare `<select>`s lists names in arbitrary order and hides the
 * only three facts a rotation tool exists to surface: who is overdue, who is
 * away that Sunday and why, and which Sunday nobody can cover. So every pair in
 * a seat's pool is RETURNED — blocked ones included, carrying the reason in the
 * UI's own words — instead of being filtered out. A greyed row that says "Vale
 * no disponible" tells the planner something; a missing row tells her nothing.
 *
 * Purity, same as the engine: no `Date.now()`, no `Math.random()`, and never a
 * bare `new Date(iso)` (the repo's UTC day-flip invariant). Dates are Sanity
 * `date` strings compared as strings, and week counts come from a
 * days-from-civil conversion that touches no `Date` at all.
 */

/** Why a pair cannot take a seat on a given Sunday, in the UI's own words. */
export type PairBlock =
  | { kind: "unavailable"; memberNames: string[] }   // one or both are away
  | { kind: "seated"; seat: KidsSeat }               // already has a seat that Sunday
  | { kind: "wrong-room"; room: KidsRoom }           // room seat, pair belongs elsewhere
  | { kind: "retired" };                             // active === false

export interface PairOption {
  pairId: string;
  name: string;                    // "Linnette y Vale"
  room: KidsRoom;
  memberIds: [string, string];
  /** Sundays since this pair last held THIS seat category; null = never served it. */
  weeksSince: number | null;
  /** Spanish, ready to render: "hace 3 semanas" | "hace 1 semana" | "nunca" */
  weeksSinceLabel: string;
  /** null when the pair may take the seat. */
  block: PairBlock | null;
  /** Member names who are ALSO on the worship roster that Sunday. Warn, never block. */
  worshipOverlap: string[];
}

export interface SeatView {
  date: string;                    // YYYY-MM-DD
  seat: KidsSeat;
  assignedPairId: string | null;
  /** Every pair in this seat's pool, blocked ones included, ordered for display:
   *  selectable first (longest-waiting first), then blocked. */
  options: PairOption[];
  /** Set when the seat is empty AND no option is selectable. Spanish. */
  unfillableReason: string | null;
}

export interface BenchEntry extends PairOption {
  /** True for the longest-waiting selectable pair in its room — "le toca". */
  nextUp: boolean;
}

export interface PlannerView {
  sundays: string[];
  seats: SeatView[];                              // sundays × KIDS_SEATS
  /** Per room, that room's four pairs ordered longest-waiting first. */
  bench: Record<KidsRoom, BenchEntry[]>;
  /** Per pair id, how many seats it holds across the whole month — for load balance. */
  monthLoad: Record<string, number>;
}

export interface PlannerViewInput {
  sundays: string[];
  pairs: (RotationPair & { active: boolean })[];
  assignments: KidsAssignment[];        // current on-screen state, draft or saved
  unavailable: Record<string, string[]>;
  memberNames: Record<string, string>;  // memberId -> display name
  history: KidsAssignment[];            // prior Sundays, ascending
  worshipAssignments?: Record<string, string[]>;  // date -> memberIds serving worship
}

type ViewPair = RotationPair & { active: boolean };

/**
 * Days since 1970-01-01 for a `YYYY-MM-DD` string — Hinnant's days-from-civil,
 * proleptic Gregorian, pure integer arithmetic. `new Date(iso)` would parse as
 * UTC midnight and flip the day in America/Mexico_City; this cannot.
 */
function epochDay(iso: string): number {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  const shifted = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(shifted / 400);
  const yearOfEra = shifted - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/**
 * Sundays between two service dates. Divided out of the day count rather than
 * counted off a list of known Sundays: history is sparse by construction — a
 * Sunday nobody scheduled has no document — and an index-based count would
 * silently understate the wait for exactly the pair that has been forgotten
 * longest. For Sunday-aligned dates the two agree; `round` keeps a stray
 * non-Sunday date honest instead of truncating it to zero.
 */
const weeksBetween = (from: string, to: string): number =>
  Math.round((epochDay(to) - epochDay(from)) / 7);

/** Spanish, singular/plural correct, ready to render. */
const weeksSinceLabel = (weeks: number | null): string =>
  weeks === null ? "nunca" : weeks === 1 ? "hace 1 semana" : `hace ${weeks} semanas`;

/** A missing name falls back to the id: visible and debuggable beats blank. */
const nameOf = (memberId: string, memberNames: Record<string, string>): string =>
  memberNames[memberId] ?? memberId;

export function buildPlannerView(input: PlannerViewInput): PlannerView {
  const { sundays, pairs, assignments, unavailable, memberNames, history, worshipAssignments } =
    input;

  const byId = new Map(pairs.map((pair) => [pair.id, pair]));
  const seatsByDate = new Map<string, Partial<Record<KidsSeat, string>>>();
  for (const assignment of assignments) seatsByDate.set(assignment.date, assignment.seats);

  /**
   * seat -> pairId -> the dates that pair held that seat. The seat IS the
   * fairness bucket, matching the engine's per-category clock: enseñanza and
   * each room rotate separately, so a pair that taught last week is still the
   * longest-waiting candidate for its own room.
   */
  const served = new Map<string, string[]>();
  const serveKey = (seat: KidsSeat, pairId: string) => `${seat}::${pairId}`;
  for (const record of [...history, ...assignments]) {
    for (const seat of KIDS_SEATS) {
      const pairId = record.seats[seat];
      if (!pairId) continue;
      const key = serveKey(seat, pairId);
      served.set(key, [...(served.get(key) ?? []), record.date]);
    }
  }

  /** The pair's most recent turn in this seat STRICTLY BEFORE `date`. */
  const lastServedBefore = (seat: KidsSeat, pairId: string, date: string): string | null => {
    const dates = served.get(serveKey(seat, pairId)) ?? [];
    let latest: string | null = null;
    for (const when of dates) {
      if (when < date && (latest === null || when > latest)) latest = when;
    }
    return latest;
  };

  const buildOption = (pair: ViewPair, seat: KidsSeat, date: string): PairOption => {
    const last = lastServedBefore(seat, pair.id, date);
    const weeks = last === null ? null : weeksBetween(last, date);
    const seatsToday = seatsByDate.get(date) ?? {};
    const worshipToday = worshipAssignments?.[date] ?? [];

    // Precedence, most fundamental first: a retired pair is not coming back this
    // month, a pair in another room never belonged to this pool, an absent pair
    // cannot serve anywhere, and only then does "busy elsewhere" apply.
    let block: PairBlock | null = null;
    if (!pair.active) {
      block = { kind: "retired" };
    } else if (seat !== "ensenanza" && pair.room !== seat) {
      block = { kind: "wrong-room", room: pair.room };
    } else if (pairUnavailable(pair, date, unavailable)) {
      block = {
        kind: "unavailable",
        memberNames: pair.memberIds
          .filter((memberId) => unavailable[memberId]?.includes(date) ?? false)
          .map((memberId) => nameOf(memberId, memberNames)),
      };
    } else {
      const elsewhere = KIDS_SEATS.find(
        (other) => other !== seat && seatsToday[other] === pair.id,
      );
      if (elsewhere) block = { kind: "seated", seat: elsewhere };
    }

    return {
      pairId: pair.id,
      name: pair.name,
      room: pair.room,
      memberIds: pair.memberIds,
      weeksSince: weeks,
      weeksSinceLabel: weeksSinceLabel(weeks),
      block,
      worshipOverlap: pair.memberIds
        .filter((memberId) => worshipToday.includes(memberId))
        .map((memberId) => nameOf(memberId, memberNames)),
    };
  };

  /**
   * Selectable first, then longest-waiting first with "nunca" ahead of every
   * real wait — a pair that has never served is the most overdue there is. The
   * id tie-break is what makes "same input twice ⇒ identical output" a property
   * rather than a coincidence.
   */
  const compare = (a: PairOption, b: PairOption): number => {
    if ((a.block === null) !== (b.block === null)) return a.block === null ? -1 : 1;
    const waitA = a.weeksSince ?? Number.POSITIVE_INFINITY;
    const waitB = b.weeksSince ?? Number.POSITIVE_INFINITY;
    if (waitA !== waitB) return waitB - waitA;
    return a.pairId.localeCompare(b.pairId);
  };

  const buildSeatView = (date: string, seat: KidsSeat): SeatView => {
    const assignedPairId = seatsByDate.get(date)?.[seat] ?? null;

    // The enseñanza pool is every pair; a room seat's pool is that room's pairs.
    // A pair the schedule already holds is kept even when it fell out of the pool
    // (retired, or moved room), so the view never silently drops what Sanity has.
    const pool = pairs.filter((pair) => seat === "ensenanza" || pair.room === seat);
    const stored = assignedPairId ? byId.get(assignedPairId) : undefined;
    const candidates =
      stored && !pool.some((pair) => pair.id === stored.id) ? [...pool, stored] : pool;

    const options = candidates
      .map((pair) => buildOption(pair, seat, date))
      .sort(compare);

    return {
      date,
      seat,
      assignedPairId,
      options,
      unfillableReason:
        assignedPairId === null && !options.some((option) => option.block === null)
          ? `Sin parejas disponibles para ${KIDS_SEAT_LABELS[seat]}`
          : null,
    };
  };

  const seats: SeatView[] = [];
  for (const date of sundays) {
    for (const seat of KIDS_SEATS) seats.push(buildSeatView(date, seat));
  }

  // The bench is anchored to the FIRST Sunday of the window: "as this month
  // opens, who has waited longest and who is free". It reuses that Sunday's seat
  // view so the bench and the seat's own list can never disagree about a clock.
  const anchor = sundays[0] ?? null;
  const bench = Object.fromEntries(
    KIDS_ROOMS.map((room) => {
      if (anchor === null) return [room, [] as BenchEntry[]];
      const roomOptions = buildSeatView(anchor, room).options.filter(
        (option) => option.room === room,
      );
      const nextUpId = roomOptions.find((option) => option.block === null)?.pairId ?? null;
      return [room, roomOptions.map((option) => ({ ...option, nextUp: option.pairId === nextUpId }))];
    }),
  ) as Record<KidsRoom, BenchEntry[]>;

  const monthWindow = new Set(sundays);
  const monthLoad: Record<string, number> = Object.fromEntries(
    pairs.map((pair) => [pair.id, 0]),
  );
  for (const assignment of assignments) {
    if (!monthWindow.has(assignment.date)) continue;
    for (const seat of KIDS_SEATS) {
      const pairId = assignment.seats[seat];
      if (pairId) monthLoad[pairId] = (monthLoad[pairId] ?? 0) + 1;
    }
  }

  return { sundays, seats, bench, monthLoad };
}
