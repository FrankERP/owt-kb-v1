// The Kids month proposal — what «Generar mes» shows: the active pairs, the
// volunteers' absences, the last published Sundays and the worship roster read
// once, then `planKidsMonth` (pure) over them. READ-ONLY on purpose: the planner
// shows warnings and diagnostics and lets the admin override before anything is
// stored, so nothing here writes. `saveKidsSunday` (`kidsCommit.ts`) is the only
// writer. The planner's `POST /api/kids/generate` and the MCP
// `generate_kids_month` both call `proposeKidsMonth`, so the chat proposes
// exactly what the screen would.

import { serverClient } from "@/sanity/lib/serverClient";
import { operationalClient } from "@/sanity/lib/operationalClient";
import { assignedMemberRefsQuery } from "@/app/utils/notifyTargets";
import { PUBLISHED_PERSPECTIVE } from "@/app/utils/kidsScheduleReads";
import { planKidsMonth, proposalFingerprint } from "@/app/utils/kidsRotation";
import {
  KIDS_SEATS,
  type KidsAssignment,
  type KidsSeat,
  type RotationPair,
  type RotationResult,
} from "@/app/utils/kidsTypes";

/**
 * How many seeds "otra opción" may burn looking for a month the planner has not
 * already shown and rejected.
 *
 * The search runs entirely on the ALREADY-FETCHED data — `planKidsMonth` is pure
 * and costs microseconds — so this is bounded CPU inside one request, never
 * extra Sanity reads or extra round trips. Once the roster is small enough that
 * the distinct arrangements run out, the loop ends and the response says so
 * instead of silently handing back a month the admin just said no to.
 */
export const MAX_SEED_ATTEMPTS = 12;

/**
 * Leaves room for `requestedSeed + MAX_SEED_ATTEMPTS` to stay on distinct
 * integers. Past 2^53 the spacing between doubles is 2, so a seed at the ceiling
 * would collapse the search window onto ~6 values, silently re-testing duplicates
 * and reporting exhaustion while alternatives remain.
 */
export const MAX_SEED = Number.MAX_SAFE_INTEGER - MAX_SEED_ATTEMPTS;

/**
 * An ABSENT seed means "the fairest month" and is the documented default. A seed
 * that is present but malformed is a caller bug, and coercing it would land on 0
 * — the one value with special meaning — handing back the board the admin is
 * already looking at, labelled as a fresh success. Loud beats plausible.
 */
export const readKidsSeed = (value: unknown): number | null => {
  // Only an OMITTED seed defaults. An explicit `null` is refused, because that is
  // exactly the wire form of a client-side `NaN` cursor —
  // `JSON.stringify({seed: NaN})` emits `{"seed":null}`. Mapping it to 0 here
  // would make this guard depend on the planner's own `Number.isFinite` check
  // rather than back it up, and the failure it lets through is the silent one:
  // the fairest month redrawn over the board the admin is already looking at,
  // announced as a new option.
  if (value === undefined) return 0;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.min(Math.floor(value), MAX_SEED);
};

/** How much prior history seeds the fairness clock — a quarter of Sundays. */
const HISTORY_WEEKS = 16;

/**
 * The Sundays of a month, via the UTC-noon technique the home page's weekend
 * helpers use: a UTC anchor at noon has no local-midnight edge to fall off, so
 * `getUTCDay()` answers for the calendar day the string names regardless of the
 * server's timezone or DST. `new Date("2026-09-06")` would not.
 */
export function sundaysOfMonth(month: string): string[] {
  const [year, monthIndex] = month.split("-").map(Number);
  const sundays: string[] = [];
  for (let day = 1; day <= 31; day++) {
    const anchor = new Date(Date.UTC(year, monthIndex - 1, day, 12));
    if (anchor.getUTCMonth() !== monthIndex - 1) break; // rolled into the next month
    if (anchor.getUTCDay() === 0) sundays.push(anchor.toISOString().slice(0, 10));
  }
  return sundays;
}

interface ScheduleRow {
  date: string;
  ensenanza?: string | null;
  chiquitos?: string | null;
  medianos?: string | null;
  grandes?: string | null;
}

export interface KidsMonthProposal extends RotationResult {
  /** The seed this proposal was built with, or where the next search starts when `exhausted`. */
  seed: number;
  fingerprint: string | null;
  /** Every arrangement in the searched window was in `exclude`: no proposal. */
  exhausted: boolean;
}

/**
 * Compute a month proposal for `month` (`YYYY-MM`, already validated) from
 * `requestedSeed` (already read by `readKidsSeed`), skipping any arrangement
 * whose fingerprint is in `exclude`.
 */
export async function proposeKidsMonth(
  month: string,
  requestedSeed: number,
  exclude: ReadonlySet<string>,
): Promise<KidsMonthProposal> {
  const sundays = sundaysOfMonth(month);
  const firstSunday = sundays[0] ?? `${month}-01`;

  const [pairRows, memberRows, historyRows] = await Promise.all([
    serverClient.fetch<
      { id: string; name: string; room: RotationPair["room"]; memberIds: string[] }[]
    >(
      `*[_type == "kidsPair" && coalesce(active, true) == true] | order(name asc) {
        "id": _id, name, room, "memberIds": coalesce(members[]._ref, [])
      }`,
      {},
      PUBLISHED_PERSPECTIVE,
    ),
    serverClient.fetch<{ _id: string; unavailableDates: string[] }[]>(
      `*[_type == "teamMembers" && "kids" in ministries] {
        _id, "unavailableDates": coalesce(unavailableDates, [])
      }`,
      {},
      PUBLISHED_PERSPECTIVE,
    ),
    // Prior Sundays only — the month being planned is regenerated from scratch,
    // so its own saved rows must not seed their successors' fairness clock.
    //
    // PUBLISHED ONLY. An unpublished Sunday is a proposal, not a fact: it was
    // never announced, `/kids` and `/me` never showed it, and nobody was asked to
    // serve it. Counting a drafted-then-abandoned month would penalise every pair
    // named in it for months, with nothing on screen to explain why they keep
    // getting skipped. Drafts are the DEFAULT (the schedules writer mints
    // `published: false`), so that is the ordinary case, not a corner.
    //
    // This CLAUSE must match the planner page's `history` read (and the filter
    // `KidsPlanner` re-applies client-side, because `loadMonth` refills that state
    // from the editor's endpoint, which serves drafts on purpose). The labels the
    // admin reads and the plan the generator produces come from different queries;
    // if they gate differently the board promises a pair the generator will not
    // pick. The WINDOWS deliberately still differ — 16 Sundays here, 3 months
    // there. ADR-0022.
    //
    // It also makes the `[0...N]` slice honest: an abandoned draft used to consume
    // a history slot and push a real prior Sunday out of the window.
    serverClient.fetch<ScheduleRow[]>(
      // The slice bound is interpolated because GROQ slices take literals, not
      // params; it is a code constant, never user input.
      `*[_type == "kidsSchedule" && published == true && date < $firstSunday] | order(date desc) [0...${HISTORY_WEEKS}] {
        date,
        "ensenanza": ensenanza._ref,
        "chiquitos": chiquitos._ref,
        "medianos": medianos._ref,
        "grandes": grandes._ref
      }`,
      { firstSunday },
      PUBLISHED_PERSPECTIVE,
    ),
  ]);

  // A pair without exactly two members cannot be scheduled (and would not
  // satisfy the `[string, string]` contract the engine relies on).
  const pairs: RotationPair[] = (pairRows ?? [])
    .filter((p) => Array.isArray(p.memberIds) && p.memberIds.length === 2)
    .map((p) => ({
      id: p.id,
      name: p.name,
      room: p.room,
      memberIds: [p.memberIds[0], p.memberIds[1]],
    }));

  const unavailable: Record<string, string[]> = {};
  for (const member of memberRows ?? []) unavailable[member._id] = member.unavailableDates ?? [];

  // Ascending, which is the order the engine seeds `lastServed` in.
  const history: KidsAssignment[] = (historyRows ?? [])
    .slice()
    .reverse()
    .map((row) => {
      const seats: Partial<Record<KidsSeat, string>> = {};
      for (const seat of KIDS_SEATS) {
        const pairId = row[seat];
        if (pairId) seats[seat] = pairId;
      }
      return { date: row.date, seats };
    });

  // Worship overlap only WARNS, so this read is published-only: an unpublished
  // draft service is not something a Kids admin may see, and a missing warning
  // is a lesser harm than leaking a draft roster into the planner.
  const roleFilter = `_type in ["sunday_role","saturday_role","special_role"] && (week == $day || date == $day) && published != false`;
  const worshipAssignments: Record<string, string[]> = {};
  await Promise.all(
    sundays.map(async (day) => {
      const assigned = await operationalClient.fetch<string[]>(assignedMemberRefsQuery(roleFilter), {
        day,
      });
      worshipAssignments[day] = assigned ?? [];
    }),
  );

  const plan = (seed: number) =>
    planKidsMonth({ sundays, pairs, unavailable, history, worshipAssignments, seed });

  // Seed 0 is the strict least-recently-served month and is never "searched for":
  // asking for the first proposal must always give the fairest one, even if the
  // admin has already seen it.
  if (requestedSeed === 0) {
    const result = plan(0);
    return { ...result, seed: 0, fingerprint: proposalFingerprint(result.proposal), exhausted: false };
  }

  for (let attempt = 0; attempt < MAX_SEED_ATTEMPTS; attempt++) {
    const seed = requestedSeed + attempt;
    const result = plan(seed);
    const fingerprint = proposalFingerprint(result.proposal);
    if (!exclude.has(fingerprint)) {
      return { ...result, seed, fingerprint, exhausted: false };
    }
  }

  // Every arrangement in the SEARCHED WINDOW is one the admin has already seen —
  // not every arrangement that exists. Say so and send no proposal: replacing the
  // board with a month they just rejected would read as the button doing nothing.
  //
  // `seed` is where the NEXT search should start, so asking again continues past
  // this window instead of re-testing it. Without that, one exhausted answer would
  // make «Otra opción» permanently dead for the month — the same dead-button
  // symptom, arrived at from the other side.
  return {
    proposal: [],
    warnings: [],
    diagnostics: [],
    seed: Math.min(requestedSeed + MAX_SEED_ATTEMPTS, MAX_SEED),
    fingerprint: null,
    exhausted: true,
  };
}
