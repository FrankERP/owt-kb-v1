export type SetlistPref = "all" | "assigned" | "off";

/** Member ids present in `next` but not `prev`. */
export function addedAssignees(prev: string[], next: string[]): string[] {
  const prevSet = new Set(prev);
  return [...new Set(next)].filter((id) => !prevSet.has(id));
}

/** Recipients for a published setlist: all "all" members + "assigned" members who are assigned. */
export function setlistRecipientIds(
  members: { _id: string; setlist?: SetlistPref }[],
  assignedIds: string[]
): string[] {
  const assigned = new Set(assignedIds);
  return members
    .filter((m) => m.setlist === "all" || (m.setlist === "assigned" && assigned.has(m._id)))
    .map((m) => m._id);
}

/** Tomorrow's date as YYYY-MM-DD in the given IANA tz. */
export function tomorrowDateStr(tz: string, now: Date = new Date()): string {
  const t = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return t.toLocaleDateString("sv", { timeZone: tz }); // sv → ISO YYYY-MM-DD
}
