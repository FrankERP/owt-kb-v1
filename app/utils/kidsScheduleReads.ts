// The Kids planner's month read — the ONE place under `app/**` that reads
// `kidsSchedule` drafts (ADR-0022): the planner's schedules GET and the MCP
// `get_kids_month` both read through it, both behind a Kids manager (the route's
// `requireMinistryManager("kids")`, the connector's super-admin bearer). Every
// other `kidsSchedule` read filters `published == true`
// (`draftGatingCoverage.test.ts` keys its one exemption to this file).
//
// A consumer that counts or shows Sundays to a member must gate on `published`
// itself: `KidsPlanner.loadMonth` refills its history state from here and
// re-filters at its `useMemo`.

import { serverClient } from "@/sanity/lib/serverClient";
import { KIDS_SEATS, type KidsSeat } from "@/app/utils/kidsTypes";

export const KIDS_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Seat references are projected RAW (`._ref`), not dereferenced: the planner
 * needs the pair id it will send back, and the pair roster is fetched once
 * alongside. `published` is coalesced, not compared: in GROQ `null == true` is
 * `null`, so a document written before the field existed would answer neither
 * true nor false.
 */
const SCHEDULES_QUERY = `*[_type == "kidsSchedule" && date >= $from && date <= $to] | order(date asc) {
    date,
    "published": coalesce(published, false),
    "ensenanza": ensenanza._ref,
    "chiquitos": chiquitos._ref,
    "medianos": medianos._ref,
    "grandes": grandes._ref
  }`;

interface ScheduleRow {
  date: string;
  published: boolean;
  ensenanza?: string | null;
  chiquitos?: string | null;
  medianos?: string | null;
  grandes?: string | null;
}

export interface KidsMonthSchedule {
  date: string;
  /** Pair id per seat; a missing key is an empty seat. */
  seats: Partial<Record<KidsSeat, string>>;
  published: boolean;
}

/** Every saved Sunday of `month` (`YYYY-MM`, already validated), drafts included. */
export async function readKidsMonthSchedules(month: string): Promise<KidsMonthSchedule[]> {
  // String bounds, no `Date` arithmetic: ISO dates sort lexicographically, and
  // `<= YYYY-MM-31` covers every real day of the month while excluding the next
  // month's first — which is exactly what the repo's timezone invariant asks for
  // (`new Date(iso)` here would drift a day either way).
  const rows = await serverClient.fetch<ScheduleRow[]>(SCHEDULES_QUERY, {
    from: `${month}-01`,
    to: `${month}-31`,
  });

  return (rows ?? []).map((row) => {
    const seats: Partial<Record<KidsSeat, string>> = {};
    for (const seat of KIDS_SEATS) {
      const pairId = row[seat];
      if (pairId) seats[seat] = pairId;
    }
    return { date: row.date, seats, published: row.published };
  });
}
