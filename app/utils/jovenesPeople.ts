import { serverClient } from "@/sanity/lib/serverClient";
import { accessFromDoc, type MemberAccessDoc } from "./memberAccess";
import { groupsIn } from "./ministryAccess";
import { awayVisibleTo, type AwayReader } from "./jovenesAway";
import { addDaysIso } from "./jovenesEventView";

/**
 * `groups`: the Jóvenes groups the person is IN (membership, never leadership), for the class pickers.
 * `away`: the upcoming days the person marked as «no disponible» — present ONLY for the planner
 * page's reader and ONLY on a person that reader may see (ADR-0090). Absent means «not told» as
 * much as «marked nothing»: the client cannot tell the two apart, on purpose.
 */
export type JovenesPerson = { id: string; name: string; groups: string[]; away?: string[] };

// The people a Jóvenes editor can pick for a seat or a program line: Jóvenes' members with app
// access, by display name, with the groups they belong to (group membership is already public —
// base plan 2026-10-30 §8 — and a group's class picker offers only that group's members, plan
// 2026-11-12 §4). The server judges each pick again (W5: an active member of the ministry and,
// for a group's event, of one of its groups), so the LIST is a convenience, not a boundary.
//
// This query never projects availability: `/jovenes`, `/jovenes/calendario` and
// `/jovenes/reunion/[token]` call `readJovenesPeople()` bare and cannot receive a day by mistake.
const QUERY = `*[_type == "teamMembers" && !(_id in path("drafts.**")) && "jovenes" in ministries && disabled != true]{
  _id, disabled, role, ministries, managesMinistries, ministryRoles,
  "name": coalesce(alias, member_name)
} | order(lower(name) asc)`;

// The days, for the ids the reader may see and no others (ADR-0090 R3): the group rule runs in
// TypeScript on the rows above (its one definition is `normalizeMinistryRoles`), and only then is
// this asked, so the server never loads the days of a person the reader may not see. Dates only:
// the note is never projected. A year ahead, the window the member's own calendar offers.
const AWAY_QUERY = `*[_type == "teamMembers" && !(_id in path("drafts.**")) && _id in $ids]{
  _id, "away": unavailableDates[@ >= $today && @ <= $limit]
}`;
const AWAY_DAYS = 365;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

type Row = MemberAccessDoc & { name?: unknown };

/**
 * Bare: the people, nothing else. With `awayFor` (the PLANNER page only —
 * `jovenesAwayCoverage.test.ts`): the same list from the same query, plus `away` on the people
 * `awayVisibleTo` lets that reader see. `awayFor` is the access snapshot the page's gate read.
 * A failed days read throws, like the people read: «no mark» must never mean «could not ask».
 */
export async function readJovenesPeople(opts?: { awayFor: AwayReader; today: string }): Promise<JovenesPerson[]> {
  const rows = await serverClient.fetch<unknown>(QUERY);
  const people: JovenesPerson[] = (Array.isArray(rows) ? (rows as Row[]) : [])
    .filter((r): r is Row & { name: string } => !!r && typeof r._id === "string" && typeof r.name === "string" && r.name.trim() !== "")
    .map((r) => ({ id: r._id, name: r.name, groups: groupsIn(accessFromDoc(r), "jovenes") }));
  if (!opts) return people;

  const ids = people.filter((p) => awayVisibleTo(opts.awayFor, p)).map((p) => p.id);
  if (ids.length === 0) return people;
  const limit = addDaysIso(opts.today, AWAY_DAYS);
  const marked = await serverClient.fetch<unknown>(AWAY_QUERY, { ids, today: opts.today, limit });
  const visible = new Set(ids);
  const away = new Map<string, string[]>();
  for (const row of Array.isArray(marked) ? (marked as Array<{ _id?: unknown; away?: unknown }>) : []) {
    // Checked again here: GROQ compares strings, so «x» passes `>= $today`, and a row for an id
    // that was not asked for is dropped rather than trusted.
    if (!row || typeof row._id !== "string" || !visible.has(row._id) || !Array.isArray(row.away)) continue;
    const days = [...new Set(row.away.filter((d): d is string => typeof d === "string" && ISO_DAY.test(d) && d >= opts.today && d <= limit))].sort();
    if (days.length > 0) away.set(row._id, days);
  }
  return people.map((p) => (away.has(p.id) ? { ...p, away: away.get(p.id) } : p));
}
