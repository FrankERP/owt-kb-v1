// The setlist editor's repeat-song history, read for `edit_setlist`'s repeat
// hint (P3 step 11; § «Admin surface gates», E-hint).
//
// The SAME read the admin setlist GET makes (`app/api/admin/setlists/route.ts`):
// `editorRecentSetlistsQuery(cutoff)` on `operationalClient`, the published
// perspective. The fold that turns it into "song id → most recent past use" is
// the editor's own `recentSongUses` (`app/utils/setlistRecentSongs.ts`); this
// module only reads. A throw propagates: the tool makes this read through
// `safeReportRead`, so a failed hint is left out and never fails a committed
// edit.

import "server-only";

import { operationalClient } from "@/sanity/lib/operationalClient";
import { editorRecentSetlistsQuery } from "@/app/utils/serviceReadQueries";
import type { RecentSetlistsResult } from "@/app/utils/setlistRecentSongs";

/** Every setlist since `cutoff` (`YYYY-MM-DD`), one list per service kind. */
export async function loadRecentSetlists(cutoff: string): Promise<RecentSetlistsResult> {
  const bound = editorRecentSetlistsQuery(cutoff);
  const result = await operationalClient.fetch<RecentSetlistsResult | null>(bound.query, bound.params);
  return result ?? {};
}
