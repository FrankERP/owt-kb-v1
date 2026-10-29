// The reads the song tools need (admin parity phase 3, S3). `post`, `tag` and `author` are neither
// protected nor draft-gated: published perspective (`operationalClient`), so a song, tag or author is
// never resolved to a `drafts.*` copy (A4). The one raw read asks only whether a Studio draft of the
// song exists (D10), to warn that publishing it would overwrite the chat's save.

import "server-only";

import { operationalClient, rawIntegrityClient } from "@/sanity/lib/operationalClient";
import type { NamedDoc, SongCatalog, StoredSong } from "@/app/utils/songEdits";

/** The editable song, whole: the arrays the writer rewrites, and the raw references beside them. */
const SONG_EDIT_PROJECTION = `{
  _id, _rev, title, key, bpm, timeSig, author,
  body,
  chords[]{ _key, key, content },
  "tagRefs": tags[]._ref,
  "authorRefs": authors[]._ref,
  referenceLinks[]{ label, url },
  tutorials2[]{ title, url },
  musicalReferenceUrl, lyricsVideoUrl
}`;

export type StoredSongWithArtist = StoredSong & { author: string | null };

/** The song by id; `null` when there is none. Never `[0]` over a type mismatch: `_type == "post"`. */
export async function loadSongForEdit(id: string): Promise<StoredSongWithArtist | null> {
  const row = await operationalClient.fetch<StoredSongWithArtist | null>(
    `*[_type == "post" && _id == $id][0] ${SONG_EDIT_PROJECTION}`,
    { id },
  );
  return row ?? null;
}

/** Every tag and author, to resolve names. */
export async function loadSongCatalog(): Promise<SongCatalog> {
  const rows = await operationalClient.fetch<{ tags: NamedDoc[] | null; authors: NamedDoc[] | null }>(
    `{
      "tags": *[_type == "tag"]{ _id, name, "slug": slug.current },
      "authors": *[_type == "author"]{ _id, name, "slug": slug.current }
    }`,
  );
  return { tags: rows?.tags ?? [], authors: rows?.authors ?? [] };
}

/** Whether Studio holds an unpublished draft of the song (`drafts.<id>`). */
export async function hasStudioDraft(id: string): Promise<boolean> {
  const n = await rawIntegrityClient.fetch<number>(`count(*[_id == $draft])`, { draft: `drafts.${id}` });
  return typeof n === "number" && n > 0;
}

export interface SongTitleRow {
  _id: string;
  title: string | null;
  author: string | null;
  slug: string | null;
}

/** Every song's title, artist and slug: duplicate titles are reported, a taken slug refused (D6). */
export async function loadSongTitleIndex(): Promise<SongTitleRow[]> {
  const rows = await operationalClient.fetch<SongTitleRow[] | null>(
    `*[_type == "post"]{ _id, title, author, "slug": slug.current }`,
  );
  return Array.isArray(rows) ? rows : [];
}

/** Whether a document with this id exists at all (the chat's deterministic create id). */
export async function songIdExists(id: string): Promise<boolean> {
  const n = await operationalClient.fetch<number>(`count(*[_id == $id])`, { id });
  return typeof n === "number" && n > 0;
}
