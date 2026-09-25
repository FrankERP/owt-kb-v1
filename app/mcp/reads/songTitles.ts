// The one song read the service tools make (P1 step 4): title and author for
// the songs a setlist references, by id, in one query.
//
// `post` is neither a protected type nor draft-gated, so the query lives here
// and runs on `operationalClient` — the published perspective, so a Studio
// `drafts.*` copy of a song is never what Frank is shown. It names no role
// type. The projection is declared, not copied: `title` and `author` only —
// never the lyrics, the chord charts or the rehearsal mixes' waveform data
// (`postPeaksProjection.test.ts` keeps that last one to the two song pages).
//
// A failed read is `ok: false`, never an empty answer: the caller shows the
// titles as unknown and says so, while the service itself stays correct.

import "server-only";

import { operationalClient } from "@/sanity/lib/operationalClient";
import type { BoundQuery } from "@/app/utils/serviceReadQueries";

export interface SongTitle {
  readonly title: string | null;
  readonly author: string | null;
}

export interface SongTitleLookup {
  /** False when the read failed: a song missing from `byId` is then UNKNOWN, not missing. */
  readonly ok: boolean;
  readonly byId: ReadonlyMap<string, SongTitle>;
}

/** Title and author of the given songs. Exported so tests key their mock on the same text. */
export function songTitlesQuery(ids: readonly string[]): BoundQuery {
  return {
    query: `*[_type == "post" && _id in $ids]{ _id, title, author }`,
    params: { ids: [...ids] },
  };
}

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

/** One read for every id; none at all when there are no ids. */
export async function loadSongTitles(ids: readonly string[]): Promise<SongTitleLookup> {
  const wanted = [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))];
  const byId = new Map<string, SongTitle>();
  if (wanted.length === 0) return { ok: true, byId };

  const bound = songTitlesQuery(wanted);
  let rows: unknown;
  try {
    rows = await operationalClient.fetch<unknown>(bound.query, bound.params);
  } catch {
    // The error's text is Sanity's own; never log it (spec E1).
    console.error("[mcp-read] song titles read failed");
    return { ok: false, byId };
  }
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object") continue;
    const { _id, title, author } = row as Record<string, unknown>;
    if (typeof _id === "string" && wanted.includes(_id)) byId.set(_id, { title: text(title), author: text(author) });
  }
  return { ok: true, byId };
}
