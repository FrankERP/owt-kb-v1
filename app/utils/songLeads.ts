// The ONE set of rules for who leads each song of a «Noche de alabanza» (spec
// 2026-09-22-worship-night-song-leads-design.md §3.2–§8). Neutral: no imports
// from server modules, because the setlist editor and the member cards import
// it too. The server writers (setlist PUT, proposal approval) and the
// notification snapshot call these functions; nothing re-implements them.

export const SONG_LEADS_MAX = 2;

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/** Member ids in a role's `Lead` seat (reference items `{ _ref }`). */
export function leadSeatIds(lead: unknown): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(lead)) return out;
  for (const entry of lead) if (isObj(entry) && nonEmptyString(entry._ref)) out.add(entry._ref);
  return out;
}

/** Stored leader ids of one song item; absent or `null` (GROQ's projection of an absent field) is none. */
export function songItemLeadIds(item: unknown): string[] {
  if (!isObj(item) || !Array.isArray(item.leads)) return [];
  const out: string[] = [];
  for (const entry of item.leads) {
    if (isObj(entry) && nonEmptyString(entry._ref) && !out.includes(entry._ref)) out.push(entry._ref);
  }
  return out;
}

export function validateSongLeads(
  rows: readonly { leadIds: readonly string[] }[],
  target: { worshipNight: boolean; leadIds: ReadonlySet<string> },
): { ok: true } | { ok: false; issues: string[] } {
  const issues: string[] = [];
  rows.forEach((row, index) => {
    if (!row.leadIds.length) return;
    if (!target.worshipNight || row.leadIds.some((id) => !target.leadIds.has(id))) {
      issues.push(`songs[${index}].leadIds`);
    }
  });
  return issues.length ? { ok: false, issues } : { ok: true };
}

/**
 * Approval rewrites the live setlist from the proposal's rows, which carry no
 * leaders. Each new row takes the leaders of the first not-yet-used live item
 * with the same song reference, keeping only those still in `leadIds` (the
 * role's Lead), at most two. A song new to the list gets none.
 */
export function carryOverSongLeads<T extends { songId: string }>(
  rows: readonly T[],
  liveSongs: unknown,
  leadIds: ReadonlySet<string>,
): (T & { leadIds: string[] })[] {
  const live = Array.isArray(liveSongs) ? liveSongs : [];
  const used = new Set<number>();
  return rows.map((row) => {
    const index = live.findIndex(
      (entry, i) => !used.has(i) && isObj(entry) && isObj(entry.song) && entry.song._ref === row.songId,
    );
    if (index === -1) return { ...row, leadIds: [] };
    used.add(index);
    const ids = songItemLeadIds(live[index]).filter((id) => leadIds.has(id)).slice(0, SONG_LEADS_MAX);
    return { ...row, leadIds: ids };
  });
}

/** «Aún no dirigen»: roster members who lead no row yet, roster order kept. */
export function unassignedLeads<M extends { id: string }>(
  roster: readonly M[],
  rows: readonly { leadIds: readonly string[] }[],
): M[] {
  const assigned = new Set(rows.flatMap((row) => row.leadIds));
  return roster.filter((m) => !assigned.has(m.id));
}

/** The editor's roster from a projected `Lead[]->{ _id, member_name, alias }`. */
export function leadRosterOf(value: unknown): { id: string; name: string }[] {
  if (!Array.isArray(value)) return [];
  const out: { id: string; name: string }[] = [];
  for (const entry of value) {
    if (!isObj(entry) || !nonEmptyString(entry._id)) continue;
    // A Lead member with neither alias nor name is still a valid leader — the
    // server accepts them — so they stay pickable. [post-approval, un-reviewed]
    const name = nonEmptyString(entry.alias) ? entry.alias : nonEmptyString(entry.member_name) ? entry.member_name : "Sin nombre";
    if (!out.some((m) => m.id === entry._id)) out.push({ id: entry._id, name });
  }
  return out;
}

/** «A» or «A y B» for a song's leaders (alias preferred); "" when none. */
export function formatLeadNames(
  leads: readonly ({ member_name?: string; alias?: string } | null)[] | null | undefined,
): string {
  return (leads ?? [])
    .map((m) => (m ? m.alias || m.member_name || "" : "").trim())
    .filter(Boolean)
    .slice(0, SONG_LEADS_MAX)
    .join(" y ");
}

/**
 * The ONE normalizer for leader ids in a notification snapshot — queue side
 * (`songRowsFrom`) and flush side (`normalizeSnapshotRows`) must agree byte for
 * byte, so neither re-implements it. [post-approval, un-reviewed]
 */
export function sortedLeadIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0))].sort();
}
