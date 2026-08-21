import { NextRequest, NextResponse } from "next/server";
import { requireMinistryManager } from "@/app/utils/authGuards";
import { serverClient } from "@/sanity/lib/serverClient";
import { operationalClient } from "@/sanity/lib/operationalClient";
import { assignedMemberRefsQuery } from "@/app/utils/notifyTargets";
import { planKidsMonth, proposalFingerprint } from "@/app/utils/kidsRotation";
import {
  KIDS_SEATS,
  type KidsAssignment,
  type KidsSeat,
  type RotationPair,
} from "@/app/utils/kidsTypes";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

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
const MAX_SEED_ATTEMPTS = 12;

/** A seed the client did not choose, so successive asks do not repeat a cycle. */
const clampSeed = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.min(Math.floor(value), Number.MAX_SAFE_INTEGER)
    : 0;

/** How much prior history seeds the fairness clock — a quarter of Sundays. */
const HISTORY_WEEKS = 16;

/**
 * The Sundays of a month, via the UTC-noon technique the home page's weekend
 * helpers use: a UTC anchor at noon has no local-midnight edge to fall off, so
 * `getUTCDay()` answers for the calendar day the string names regardless of the
 * server's timezone or DST. `new Date("2026-09-06")` would not.
 */
function sundaysOfMonth(month: string): string[] {
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

/**
 * Compute a month proposal. READ-ONLY on purpose: the planner shows warnings and
 * diagnostics and lets the admin override before anything is stored, so nothing
 * here writes. `PUT /api/kids/schedules` is the only writer.
 */
export async function POST(req: NextRequest) {
  const session = await requireMinistryManager("kids");
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json()) as { month?: string; seed?: number; exclude?: string[] };
  if (typeof body.month !== "string" || !MONTH_RE.test(body.month)) {
    return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
  }
  const requestedSeed = clampSeed(body.seed);
  const exclude = new Set(
    Array.isArray(body.exclude) ? body.exclude.filter((f) => typeof f === "string") : [],
  );

  const sundays = sundaysOfMonth(body.month);
  const firstSunday = sundays[0] ?? `${body.month}-01`;

  const [pairRows, memberRows, historyRows] = await Promise.all([
    serverClient.fetch<
      { id: string; name: string; room: RotationPair["room"]; memberIds: string[] }[]
    >(
      `*[_type == "kidsPair" && coalesce(active, true) == true] | order(name asc) {
        "id": _id, name, room, "memberIds": coalesce(members[]._ref, [])
      }`,
    ),
    serverClient.fetch<{ _id: string; unavailableDates: string[] }[]>(
      `*[_type == "teamMembers" && "kids" in ministries] {
        _id, "unavailableDates": coalesce(unavailableDates, [])
      }`,
    ),
    // Prior Sundays only — the month being planned is regenerated from scratch,
    // so its own saved rows must not seed their successors' fairness clock.
    serverClient.fetch<ScheduleRow[]>(
      // The slice bound is interpolated because GROQ slices take literals, not
      // params; it is a code constant, never user input.
      `*[_type == "kidsSchedule" && date < $firstSunday] | order(date desc) [0...${HISTORY_WEEKS}] {
        date,
        "ensenanza": ensenanza._ref,
        "chiquitos": chiquitos._ref,
        "medianos": medianos._ref,
        "grandes": grandes._ref
      }`,
      { firstSunday },
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
    return NextResponse.json({
      ...result,
      seed: 0,
      fingerprint: proposalFingerprint(result.proposal),
      exhausted: false,
    });
  }

  for (let attempt = 0; attempt < MAX_SEED_ATTEMPTS; attempt++) {
    const seed = requestedSeed + attempt;
    const result = plan(seed);
    const fingerprint = proposalFingerprint(result.proposal);
    if (!exclude.has(fingerprint)) {
      return NextResponse.json({ ...result, seed, fingerprint, exhausted: false });
    }
  }

  // Every arrangement within the fairness slack is one the admin has already
  // seen. Say so and send no proposal: replacing the board with a month they
  // just rejected would read as the button doing nothing.
  return NextResponse.json({
    proposal: [],
    warnings: [],
    diagnostics: [],
    seed: requestedSeed,
    fingerprint: null,
    exhausted: true,
  });
}
