export type SetlistPref = "all" | "assigned" | "off";

// Every seat type on the role schemas (sunday_role / saturday_role /
// special_role) that references a teamMember. Keep in sync with those schemas.
// Two array-of-reference seats expose `_ref` directly; the object seats nest it
// under `person`.
const ASSIGNED_SEAT_PATHS = [
  "Lead[]._ref",
  "BGVs[]._ref",
  "Chorus[]._ref",
  "instruments[].person._ref",
  "foh_team[].person._ref",
] as const;

/**
 * Build a GROQ expression returning the unique teamMember ids assigned to any
 * seat in role docs matching `roleFilter`. `roleFilter` is a trusted, code-owned
 * predicate (it may reference bound params like $day/$week); never pass user
 * input into it. Centralised so every notification path covers the same seats.
 */
export function assignedMemberRefsQuery(roleFilter: string): string {
  const spreads = ASSIGNED_SEAT_PATHS.map((p) => `...*[${roleFilter}].${p}`).join(",\n    ");
  return `array::unique([\n    ${spreads}\n  ][defined(@)])`;
}

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
    .filter((m) => {
      const pref = m.setlist ?? "all"; // unset = opted-in to all (spec default)
      return pref === "all" || (pref === "assigned" && assigned.has(m._id));
    })
    .map((m) => m._id);
}

/** Tomorrow's date as YYYY-MM-DD in the given IANA tz. */
export function tomorrowDateStr(tz: string, now: Date = new Date()): string {
  const t = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return t.toLocaleDateString("sv", { timeZone: tz }); // sv → ISO YYYY-MM-DD
}
