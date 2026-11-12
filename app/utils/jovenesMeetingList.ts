// The list on `/jovenes` as data: which filters it offers, what a filter keeps, and the rows it
// draws (section labels and meetings, the next one first). Pure and neutral, so the page's client
// list only draws; `jovenesMeetingList.test.ts` holds the rules.
//
// Nothing here decides access: every meeting came from `readMinistryEvents` in member mode, so a
// filter only hides what the reader may already see.

import { MONTH_NAMES_ES } from "./scheduleMonths";
import { audienceBadges, type AudienceTone } from "./jovenesGroupStyle";
import type { MinistryEventView } from "./ministryEventReads";

/** What the list needs of a meeting to sort it into filters and sections. */
export type ListedMeeting = { id: string; date: string; audience: MinistryEventView["audience"]; mine: boolean };

/** `all`, `mine`, `ministry`, or a group id. */
export type MeetingFilter = string;

export type FilterOption = { value: MeetingFilter; label: string; tone: AudienceTone | null; count: number };

/** A filter is worth showing from this many meetings: under it the whole list fits one glance. */
export const FILTER_MIN_MEETINGS = 4;

/**
 * «Todas», «Me toca» when something is the reader's, then one option per audience — only when the
 * list holds more than one audience, since a filter with a single choice filters nothing. Empty
 * when there is nothing to choose between.
 */
export function filterOptions(meetings: readonly ListedMeeting[]): FilterOption[] {
  if (meetings.length < FILTER_MIN_MEETINGS) return [];
  const mine = meetings.filter((m) => m.mine).length;
  const audiences = new Map<string, FilterOption>();
  for (const m of meetings) {
    for (const b of audienceBadges(m.audience)) {
      const seen = audiences.get(b.key);
      if (seen) seen.count += 1;
      else audiences.set(b.key, { value: b.key, label: b.label, tone: b.tone, count: 1 });
    }
  }
  const options: FilterOption[] = [];
  if (mine > 0 && mine < meetings.length) options.push({ value: "mine", label: "Me toca", tone: null, count: mine });
  if (audiences.size > 1) options.push(...audiences.values());
  if (options.length === 0) return [];
  return [{ value: "all", label: "Todas", tone: null, count: meetings.length }, ...options];
}

/** The meetings a filter keeps, in their order. An unknown filter keeps everything. */
export function applyFilter<T extends ListedMeeting>(meetings: readonly T[], filter: MeetingFilter): T[] {
  if (filter === "all") return [...meetings];
  if (filter === "mine") return meetings.filter((m) => m.mine);
  const kept = meetings.filter((m) => audienceBadges(m.audience).some((b) => b.key === filter));
  return kept.length > 0 ? kept : [...meetings];
}

export type ListRow<T> =
  | { kind: "label"; key: string; title: string; count: number | null }
  | { kind: "meeting"; key: string; meeting: T; featured: boolean };

/** «Noviembre», or «Enero 2027» once the list crosses into another year than its first meeting. */
function monthLabel(month: string, firstYear: string): string {
  const name = MONTH_NAMES_ES[Number(month.slice(5, 7)) - 1] ?? month;
  return month.slice(0, 4) === firstYear ? name : `${name} ${month.slice(0, 4)}`;
}

/**
 * The rows, top to bottom: «Próxima reunión» and the first meeting (featured), then the rest
 * under their month, each month with its count. The meetings arrive ordered by date.
 */
export function listRows<T extends ListedMeeting>(meetings: readonly T[]): ListRow<T>[] {
  if (meetings.length === 0) return [];
  const [next, ...rest] = meetings;
  const rows: ListRow<T>[] = [
    { kind: "label", key: "label-next", title: "Próxima reunión", count: null },
    { kind: "meeting", key: next.id, meeting: next, featured: true },
  ];
  const firstYear = next.date.slice(0, 4);
  let month = "";
  for (const m of rest) {
    const ym = m.date.slice(0, 7);
    if (ym !== month) {
      month = ym;
      rows.push({ kind: "label", key: `label-${ym}`, title: monthLabel(ym, firstYear), count: rest.filter((r) => r.date.slice(0, 7) === ym).length });
    }
    rows.push({ kind: "meeting", key: m.id, meeting: m, featured: false });
  }
  return rows;
}
