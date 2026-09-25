// The two reads `get_song` needs (P1 step 5): the one song document, and its
// weekend play history.
//
// `post` is neither a protected type nor draft-gated, so its query lives here
// and runs on `operationalClient` — the published perspective, so a Studio
// `drafts.*` copy is never resolved (a `drafts.*` id is refused before any read
// by the tool itself; this guards the SLUG path, which has no such prefix to
// check). The projection is declared, never copied from either existing song
// page: it counts `body` and `chords` instead of fetching their content (ADR-0018
// needs only the counts), and it never names a mix's waveform data, its audio
// file, its active-range or its content hash — only the fields `get_song`
// actually returns (`postPeaksProjection.test.ts` keeps that data to the two
// song pages).
//
// Play history is the SETLIST protected type, so it runs the existing canonical
// builder (`canonicalSetlistsQuery`, spec I1) on the same client, executed here
// directly — never through a parameter, which the audit cannot see. It carries
// no role-type or setlist-type literal (spec I2): both queries are pre-built.

import "server-only";

import { canonicalSetlistsQuery } from "@/app/utils/serviceReadQueries";
import { operationalClient } from "@/sanity/lib/operationalClient";

const SONG_DETAIL_PROJECTION = `{
  _id, title, author, "slug": slug.current, key,
  authors[]->{ name },
  "bodyCount": count(body),
  "chordCount": count(chords),
  "chordKeys": chords[].key,
  "pdfKeys": chordsPDF[].key,
  bpm, timeSig,
  tags[]->{ "slug": slug.current, name },
  referenceLinks[]{ label, url },
  musicalReferenceUrl, lyricsVideoUrl,
  "lyricsURL": lyrics.asset->url,
  tutorials2[]{ title, url },
  rehearsalMixes[]{ _key, kind, family, track, tone, bpm }
}`;

export interface SongDetailRow {
  _id: string;
  title: string | null;
  author: string | null;
  slug: string | null;
  key: string | null;
  authors: { name: string | null }[] | null;
  bodyCount: number | null;
  chordCount: number | null;
  chordKeys: (string | null)[] | null;
  pdfKeys: (string | null)[] | null;
  bpm: unknown;
  timeSig: unknown;
  tags: { slug: string | null; name: string | null }[] | null;
  referenceLinks: { label: string | null; url: string | null }[] | null;
  musicalReferenceUrl: string | null;
  lyricsVideoUrl: string | null;
  lyricsURL: string | null;
  tutorials2: { title: string | null; url: string | null }[] | null;
  rehearsalMixes: { _key: string | null; kind: string | null; family: string | null; track: string | null; tone: string | null; bpm: number | null }[] | null;
}

export interface BoundQueryLike {
  query: string;
  params: Record<string, unknown>;
}

/** Never `[0]`: zero is "no such song", more than one is an integrity conflict the tool must not guess through. */
export function songDetailByIdQuery(id: string): BoundQueryLike {
  return { query: `*[_type == "post" && _id == $id] ${SONG_DETAIL_PROJECTION}`, params: { id } };
}

export function songDetailBySlugQuery(slug: string): BoundQueryLike {
  return { query: `*[_type == "post" && slug.current == $slug] ${SONG_DETAIL_PROJECTION}`, params: { slug } };
}

export type SongDetailLookup =
  | { ok: true; rows: SongDetailRow[] }
  | { ok: false; rows: [] };

async function runSongDetailQuery(bound: BoundQueryLike): Promise<SongDetailLookup> {
  try {
    const rows = await operationalClient.fetch<unknown>(bound.query, bound.params);
    return { ok: true, rows: Array.isArray(rows) ? (rows as SongDetailRow[]) : [] };
  } catch {
    console.error("[mcp-read] song detail read failed");
    return { ok: false, rows: [] };
  }
}

export function loadSongDetailById(id: string): Promise<SongDetailLookup> {
  return runSongDetailQuery(songDetailByIdQuery(id));
}

export function loadSongDetailBySlug(slug: string): Promise<SongDetailLookup> {
  return runSongDetailQuery(songDetailBySlugQuery(slug));
}

export interface SongPlayHistoryLookup {
  readonly ok: boolean;
  readonly rows: readonly unknown[];
}

/** Every weekend setlist row, published perspective — the raw input `songPresenter.ts` filters and canonicalizes. */
export async function loadWeekendSetlistRows(): Promise<SongPlayHistoryLookup> {
  const bound = canonicalSetlistsQuery();
  try {
    const rows = await operationalClient.fetch<unknown>(bound.query, bound.params);
    return { ok: true, rows: Array.isArray(rows) ? rows : [] };
  } catch {
    console.error("[mcp-read] play history read failed");
    return { ok: false, rows: [] };
  }
}
