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
//  - the rehearsal mixes in the web player's own order and wording (`groupMixes`, `mixLabel`):
//    what travels is a mix's `key`, never an address — the app asks
//    `/api/app/v1/songs/[slug]/mixes/[key]` for the audio each time it plays one.
//
// What a song does NOT carry yet: its play history.

import type { PortableTextBody } from "./interface";
import { bodyToLyrics } from "./lyrics";
import { groupMixes, mixLabel, SEAT_TO_FAMILY, waveformBars } from "./rehearsalMixes";
import { POST_COVER_GROQ, songCoverUrl } from "./songCover";
import { splitSongTitle } from "./songTitle";
import { isChordPro } from "./transpose";

const LIST_FIELDS = `_id, _createdAt, title, author, "slug": slug.current, key, bpm, timeSig,
    "cover": ${POST_COVER_GROQ},
    "authors": authors[]->name,
    "tags": tags[]->{ "slug": slug.current, name }`;

/** The whole catalogue in one read. No parameter: nothing is interpolated at run time. */
export const APP_SONGS_QUERY = `*[_type == "post" && defined(slug.current)] | order(title asc) { ${LIST_FIELDS} }`;

/**
 * One song by its slug. `order(_id asc)` so a duplicate slug resolves as the web's page does.
 * `$me` is the reader's member id: their instruments only choose which mix is offered first.
 */
export const APP_SONG_QUERY = `*[_type == "post" && slug.current == $slug] | order(_id asc)[0] {
    ${LIST_FIELDS},
    body,
    chords[]{ key, content },
    referenceLinks[]{ label, url },
    musicalReferenceUrl,
    lyricsVideoUrl,
    tutorials2[]{ title, url },
    rehearsalMixes[]{ _key, kind, track, family, tone, peaks, "hasAudio": defined(audioFile.asset) },
    "instruments": *[_type == "teamMembers" && _id == $me][0].instruments
  }`;

/**
 * One mix's audio address. The same song the query above resolves, so a `key` the song page
 * showed is the mix this plays.
 */
export const APP_MIX_AUDIO_QUERY = `*[_type == "post" && slug.current == $slug] | order(_id asc)[0]
    .rehearsalMixes[_key == $key][0].audioFile.asset->url`;

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
  rehearsalMixes?: Array<{
    _key?: string | null;
    kind?: string | null;
    track?: string | null;
    family?: string | null;
    tone?: string | null;
    peaks?: Array<number | null> | null;
    hasAudio?: boolean | null;
  } | null> | null;
  instruments?: Array<string | null> | null;
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
export type AppMix = {
  /** Names the mix to the audio route. Not an address: the audio is asked for at play time. */
  key: string;
  /** «Banda completa», or the track's name without Ableton's number. */
  label: string;
  /** `full`, an instrument family, or `other`: the app's sections, already in order. */
  family: string;
  familyLabel: string;
  /** The key this mix sounds in; null when the stored row names none. */
  tone: string | null;
  /** The waveform as `MIX_BARS` heights, 0–100. Empty when the mix has no envelope. */
  bars: number[];
};
export type AppSongDetail = AppLibrarySong & {
  /** The lyric in the editor's plain format: `# Coro` a section heading, a blank line a stanza. */
  lyrics: string | null;
  charts: AppChart[];
  links: AppSongLink[];
  /** The rehearsal mixes, grouped and sorted as the web's player lists them. */
  mixes: AppMix[];
  /** The family of the reader's first instrument: the mix the player offers first. */
  preferredFamily: string | null;
};

/** 600 stored peaks are 12 KB a mix; a phone row draws this many bars. */
export const MIX_BARS = 60;

const CDN_HOST = "cdn.sanity.io";

/**
 * The only audio address the app is ever handed: an `https` file on Sanity's CDN. Anything else
 * (a malformed value, another host) is no audio — the web's redirect holds the same line.
 */
export function mixAudioUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  try {
    const url = new URL(v);
    return url.protocol === "https:" && url.hostname === CDN_HOST ? url.toString() : null;
  } catch {
    return null;
  }
}

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

  // Only a mix that can play: a key to ask for it by, a kind, and a file behind it.
  const playable: Array<{ _key: string; kind: "full" | "up"; track?: string; family?: string; tone: string; peaks: number[] }> = [];
  for (const m of Array.isArray(row.rehearsalMixes) ? row.rehearsalMixes : []) {
    const key = text(m?._key);
    if (!m || !key || m.hasAudio !== true || (m.kind !== "full" && m.kind !== "up")) continue;
    if (playable.some((p) => p._key === key)) continue;
    playable.push({
      _key: key,
      kind: m.kind,
      track: text(m.track) ?? undefined,
      family: text(m.family) ?? undefined,
      tone: text(m.tone) ?? "",
      peaks: Array.isArray(m.peaks) ? m.peaks.filter((n): n is number => typeof n === "number" && Number.isFinite(n)) : [],
    });
  }
  const mixes: AppMix[] = [];
  for (const group of groupMixes(playable)) {
    for (const m of group.mixes) {
      mixes.push({
        key: m._key,
        label: mixLabel(m),
        family: group.family,
        familyLabel: group.label,
        tone: m.tone === "" ? null : m.tone,
        bars: m.peaks.length === 0 ? [] : waveformBars(m.peaks, MIX_BARS).map((b) => Math.round(Math.min(1, Math.max(0, b)) * 100)),
      });
    }
  }
  const firstSeat = Array.isArray(row.instruments) ? text(row.instruments[0]) : null;
  const preferredFamily = firstSeat && Object.hasOwn(SEAT_TO_FAMILY, firstSeat) ? SEAT_TO_FAMILY[firstSeat] : null;

  const lyrics = bodyToLyrics(row.body ?? undefined).replace(/\n{3,}/g, "\n\n").trim();
  return { ...base, lyrics: lyrics === "" ? null : lyrics, charts, links, mixes, preferredFamily };
}
