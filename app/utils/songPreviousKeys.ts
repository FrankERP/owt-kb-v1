import "server-only";

// «Tonos anteriores»: the keys a song was played in at past services, newest first. Read by the
// web editor's song search (`/api/me/songs`) and by the native app (`/api/app/v1/songs/previous-keys`
// and the proposal editor read, ADR-0091 W1).
//
// This module imports `operationalClient` itself and runs the fetch, rather than taking a client:
// the protected-read audit records a site only where a file fetches through a client it imports,
// so a helper handed its client would take this read out of the audit (spec D3b).

import { operationalClient } from "@/sanity/lib/operationalClient";
import { buildPreviousKeysBySong, type SongPlayHistorySet } from "./songPlayHistory";
import { canonicalizePlayHistory, playHistoryTargetKey } from "./serviceReadSelect";

/** Song id → previous keys. A song with no past play is absent from the map. */
export async function previousKeysFor(songIds: readonly string[], today: string): Promise<Map<string, string[]>> {
  if (songIds.length === 0) return new Map();
  // Canonical (published-perspective) client: a `drafts.*` overlay never counts
  // as a play. Project the target identity so duplicate-target (ambiguous)
  // setlists are collapsed before keys are tallied — no double-counted history.
  type HistorySet = SongPlayHistorySet & { _id?: string; _type?: string; week?: string };
  const historyRaw = await operationalClient.fetch<HistorySet[]>(
    `*[
      (
        (_type in ["featuredSongs", "saturdarSongs"] && week < $today) ||
        (_type == "special_role" && date < $today && published != false)
      ) && count(songs[song._ref in $songIds]) > 0
    ] | order(coalesce(week, date) desc) {
      _id, _type, "week": coalesce(week, date),
      "songs": songs[song._ref in $songIds] {
        "songId": song._ref,
        play_key
      }
    }`,
    { songIds: [...songIds], today }
  );
  const history = canonicalizePlayHistory(historyRaw, playHistoryTargetKey);
  return buildPreviousKeysBySong(history);
}
