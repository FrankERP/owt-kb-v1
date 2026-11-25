// The native app's Biblioteca and song page (ADR-0091; native/ios): the catalogue the web's
// `/biblioteca` lists and the song `/posts/[slug]` shows, shaped for a phone.
//
// NEUTRAL module (no client, no I/O): the two routes fetch the queries below through the
// published-perspective `operationalClient` and hand the rows to the builders, which are tested
// without a network. What it keeps from the web:
//
//  - the title split (`splitSongTitle`): «Cordero y León (Lion and The Lamb)» is a Spanish
//    title and an original beside the artist;
//  - the artist line (`author` plus the linked authors' names), the catalogue's own order
//    (title, `compareByTitle`'s Spanish collation is the app's to apply);
//  - a cover only from Sanity, at the web's sizes (`songCoverUrl`);
//  - lyrics and charts stay two independent fields (ADR-0018): both travel, and the reader
//    shows the charts when there are any, as the web does.
//
// What a song does NOT carry yet: its audio and rehearsal mixes and its play history — the
// app's next slice.

import type { PortableTextBody } from "./interface";
import { bodyToLyrics } from "./lyrics";
import { POST_COVER_GROQ, songCoverUrl } from "./songCover";
import { splitSongTitle } from "./songTitle";
import { isChordPro } from "./transpose";

const LIST_FIELDS = `_id, _createdAt, title, author, "slug": slug.current, key, bpm, timeSig,
    "cover": ${POST_COVER_GROQ},
    "authors": authors[]->name,
    "tags": tags[]->{ "slug": slug.current, name }`;

/** The whole catalogue in one read. No parameter: nothing is interpolated at run time. */
export const APP_SONGS_QUERY = `*[_type == "post" && defined(slug.current)] | order(title asc) { ${LIST_FIELDS} }`;

/** One song by its slug. `order(_id asc)` so a duplicate slug resolves as the web's page does. */
export const APP_SONG_QUERY = `*[_type == "post" && slug.current == $slug] | order(_id asc)[0] {
    ${LIST_FIELDS},
    body,
    chords[]{ key, content },
    referenceLinks[]{ label, url },
    musicalReferenceUrl,
    lyricsVideoUrl,
    tutorials2[]{ title, url }
  }`;

// ─── Rows as GROQ returns them (every field may be null) ────────────────────────

export type AppSongRow = {
  _id?: string | null;
  _createdAt?: string | null;
  title?: string | null;
  author?: string | null;
  slug?: string | null;
  key?: string | null;
  bpm?: number | string | null;
  timeSig?: string | null;
  cover?: string | null;
  authors?: Array<string | null> | null;
  tags?: Array<{ slug?: string | null; name?: string | null } | null> | null;
};
export type AppSongDetailRow = AppSongRow & {
  body?: PortableTextBody | null;
  chords?: Array<{ key?: string | null; content?: string | null } | null> | null;
  referenceLinks?: Array<{ label?: string | null; url?: string | null } | null> | null;
  musicalReferenceUrl?: string | null;
  lyricsVideoUrl?: string | null;
  tutorials2?: Array<{ title?: string | null; url?: string | null } | null> | null;
};

// ─── The wire shape (the app decodes exactly this) ──────────────────────────────

export type AppSongTag = { slug: string; name: string };
export type AppLibrarySong = {
  id: string;
  slug: string;
  /** The Spanish title, without the parenthetical original. */
  title: string;
  /** «Lion and The Lamb», when the stored title closes with one. */
  original: string | null;
  artist: string | null;
  key: string | null;
  bpm: number | null;
  timeSig: string | null;
  cover: string | null;
  coverLarge: string | null;
  tags: AppSongTag[];
  /** ISO instant the song entered the catalogue: the shelf of recent songs sorts by it. */
  addedAt: string | null;
};
export type AppChart = {
  key: string | null;
  content: string;
  /** Bracketed chords the app can transpose; false = plain text, shown as written. */
  chordPro: boolean;
};
export type AppSongLink = { kind: "reference" | "video" | "tutorial"; label: string; url: string };
export type AppSongDetail = AppLibrarySong & {
  /** The lyric in the editor's plain format: `# Coro` a section heading, a blank line a stanza. */
  lyrics: string | null;
  charts: AppChart[];
  links: AppSongLink[];
};

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

function bpmOf(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** Only an `https` address leaves the server: the app opens it in a browser. */
function httpsUrl(v: unknown): string | null {
  const u = text(v);
  if (!u) return null;
  try {
    return new URL(u).protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

function librarySong(row: AppSongRow | null | undefined): AppLibrarySong | null {
  const id = text(row?._id);
  const slug = text(row?.slug);
  const whole = text(row?.title);
  if (!row || !id || !slug || !whole) return null; // not a song a reader can open
  const title = splitSongTitle(whole);
  const artist = [text(row.author), ...(Array.isArray(row.authors) ? row.authors.map(text) : [])]
    .filter((s): s is string => !!s)
    .filter((s, i, all) => all.indexOf(s) === i)
    .join(" · ");
  const tags: AppSongTag[] = [];
  for (const t of Array.isArray(row.tags) ? row.tags : []) {
    const tagSlug = text(t?.slug);
    const name = text(t?.name);
    if (tagSlug && name) tags.push({ slug: tagSlug, name });
  }
  return {
    id,
    slug,
    title: title.main,
    original: title.original,
    artist: artist || null,
    key: text(row.key),
    bpm: bpmOf(row.bpm),
    timeSig: text(row.timeSig),
    cover: songCoverUrl(row.cover, "tile"),
    coverLarge: songCoverUrl(row.cover, "hero"),
    tags,
    addedAt: text(row._createdAt),
  };
}

export function buildAppSongs(rows: Array<AppSongRow | null> | null | undefined): AppLibrarySong[] {
  const out: AppLibrarySong[] = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const song = librarySong(row);
    if (song) out.push(song);
  }
  return out;
}

export function buildAppSong(row: AppSongDetailRow | null | undefined): AppSongDetail | null {
  const base = librarySong(row);
  if (!row || !base) return null;

  const charts: AppChart[] = [];
  for (const c of Array.isArray(row.chords) ? row.chords : []) {
    // Not trimmed: a chart's leading spaces place its chords over the words.
    const content = typeof c?.content === "string" ? c.content : "";
    if (content.trim() === "") continue;
    charts.push({ key: text(c?.key), content, chordPro: isChordPro(content) });
  }

  const links: AppSongLink[] = [];
  const add = (kind: AppSongLink["kind"], label: string | null, url: unknown, fallback: string) => {
    const u = httpsUrl(url);
    if (u && !links.some((l) => l.url === u)) links.push({ kind, label: label ?? fallback, url: u });
  };
  add("reference", null, row.musicalReferenceUrl, "Referencia musical");
  add("video", null, row.lyricsVideoUrl, "Video con letra");
  for (const l of Array.isArray(row.referenceLinks) ? row.referenceLinks : []) add("reference", text(l?.label), l?.url, "Referencia");
  for (const t of Array.isArray(row.tutorials2) ? row.tutorials2 : []) add("tutorial", text(t?.title), t?.url, "Tutorial");

  const lyrics = bodyToLyrics(row.body ?? undefined).replace(/\n{3,}/g, "\n\n").trim();
  return { ...base, lyrics: lyrics === "" ? null : lyrics, charts, links };
}
