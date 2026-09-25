// The catalogue read `search_songs` builds its index over (P1 step 5): every
// song plus the live tag vocabulary, in the same shape `/biblioteca` loads
// (`app/(client)/biblioteca/page.tsx`) so `libraryIndex.ts`'s Fuse index and
// filter run unmodified over server-fetched data.
//
// `post` is neither a protected type nor draft-gated, so this query lives here
// and runs on `operationalClient` — the published perspective, so a Studio
// `drafts.*` copy of a song is never searched or returned. It names no role
// type (spec I2).
//
// Tags are read live (never hard-coded) so an unknown slug can be refused with
// the real list (I13), and so a new tag shows up in search the day it is
// created in Studio.
//
// A failed read is `ok: false`, never an empty catalogue: the caller refuses
// the whole call rather than answering "no songs match" from nothing (ruling 3).

import "server-only";

import { operationalClient } from "@/sanity/lib/operationalClient";
import type { Post, Tag } from "@/app/utils/interface";

export const SONG_CATALOGUE_QUERY = `{
  "posts": *[_type == "post"]{
    _id, title, author, slug, key,
    tags[]->{ _id, slug, name },
    authors[]->{ _id, slug, name }
  },
  "tags": *[_type == "tag"]{ _id, slug, name }
}`;

export interface SongCatalogueLookup {
  readonly ok: boolean;
  readonly posts: Post[];
  readonly tags: Tag[];
}

/** The whole song catalogue and the live tag vocabulary, in one read. */
export async function loadSongCatalogue(): Promise<SongCatalogueLookup> {
  try {
    // The generic only ANNOTATES the result (as `/biblioteca`'s own fetch
    // does) — the projection above deliberately carries fewer fields than the
    // full `Post`/`Tag` shape, since search never needs the rest.
    const data = await operationalClient.fetch<{ posts: Post[]; tags: Tag[] }>(SONG_CATALOGUE_QUERY);
    return { ok: true, posts: Array.isArray(data?.posts) ? data.posts : [], tags: Array.isArray(data?.tags) ? data.tags : [] };
  } catch {
    // The error's text is Sanity's own; never log it (spec E1).
    console.error("[mcp-read] song catalogue read failed");
    return { ok: false, posts: [], tags: [] };
  }
}
