// The setlist editor's repeat-song history: the date window the admin setlist GET
// reads, and the fold that turns those setlists into "song id → most recent past
// use". Extracted verbatim from `app/api/admin/setlists/route.ts` so the MCP
// `edit_setlist` tool computes its repeat hint the same way the editor does.
//
// NEUTRAL on purpose — no client, no `server-only` — so a route, a tool or a test
// may call it. The read itself stays with the caller
// (`editorRecentSetlistsQuery(weeksAgoIso(8))` on `operationalClient`).

/** The shape `editorRecentSetlistsQuery` returns: one list per service kind. */
export type RecentSetlistsResult = Record<string, { week?: string; songs?: unknown }[]>;

/** The Mexico City calendar day `n` weeks before today, as `YYYY-MM-DD`. */
export function weeksAgoIso(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n * 7);
  return d.toLocaleDateString("sv", { timeZone: "America/Mexico_City" });
}

/**
 * Map songId → most recent past use, excluding this service's own date so a
 * setlist never warns about itself. An absent result is no history.
 */
export function recentSongUses(
  recentRaw: RecentSetlistsResult | null | undefined,
  serviceDate: string,
): Record<string, string> {
  const recentSongs: Record<string, string> = {};
  const lists = [
    ...(recentRaw?.sunday ?? []),
    ...(recentRaw?.saturday ?? []),
    ...(recentRaw?.special ?? []),
  ];
  for (const list of lists) {
    if (!list || list.week === serviceDate || typeof list.week !== "string") continue;
    const entries = Array.isArray(list.songs) ? list.songs : [];
    for (const entry of entries as { song?: { _id?: string } }[]) {
      const id = entry?.song?._id;
      if (!id) continue;
      const prev = recentSongs[id];
      if (!prev || list.week > prev) recentSongs[id] = list.week;
    }
  }
  return recentSongs;
}
