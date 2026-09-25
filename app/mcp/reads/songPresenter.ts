// What `search_songs` and `get_song` answer (P1 step 5), built from the reads
// in `songCatalogue.ts` / `songDetail.ts`. No I/O here: every function is a pure
// reading of the rows it is handed, so it can be unit-tested without a Sanity
// client.
//
// SEARCH reuses `app/utils/libraryIndex.ts` verbatim — the same Fuse index, the
// short-query path, `isTipoSlug` and the PR #92 tag filter — over the catalogue
// this module's caller loaded. Nothing here reimplements it.
//
// PLAY HISTORY follows the song route's rule exactly (D4): weekend setlists
// only, `week < today`, published perspective (so a `drafts.*` overlay never
// counts), no role-publication check, and `canonicalizePlayHistory` so a
// duplicate-week (ambiguous) target contributes no rows rather than a false or
// double-counted play. Weekend setlist TYPES are never spelled here (spec I2):
// they come from `WEEKEND_SETLIST_TYPES`, zipped with `SETLIST_SERVICE_KINDS`,
// the same convention `servicePresenter.ts`'s `serviceKindOf` uses for roles.

import type { Post, Tag } from "@/app/utils/interface";
import { applyLibraryFilters, artistOf, makeLibraryFuse, type LibraryFilters } from "@/app/utils/libraryIndex";
import { isCanonicalDocumentId } from "@/app/utils/roleWriteRequest";
import { canonicalizePlayHistory, playHistoryTargetKey } from "@/app/utils/serviceReadSelect";
import { SETLIST_SERVICE_KINDS, WEEKEND_SETLIST_TYPES } from "@/app/utils/setlistWriteRequest";
import type { SongDetailRow } from "./songDetail";

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

// ── search_songs ─────────────────────────────────────────────────────────────

export interface SearchSongsArgs {
  query?: string;
  tags?: string[];
  limit?: number;
}

export type SearchValidation = { ok: true; query: string; tags: string[]; limit: number } | { ok: false; message: string };

export const NO_CRITERIA_MESSAGE = "Indica query, tags, o ambos: no hay nada que buscar.";

/** Cheap, synchronous: true when the call has something to search for. Checked BEFORE any read (no catalogue load for an empty call). */
export function hasSearchCriteria(args: SearchSongsArgs): boolean {
  return (args.query ?? "").trim().length > 0 || (args.tags ?? []).length > 0;
}

/**
 * Shape validation only (I13): at least one of `query` / `tags`, and every
 * requested tag slug exists in the LIVE vocabulary — never hard-coded — or the
 * call is refused with the real list, sorted.
 */
export function validateSearchSongs(args: SearchSongsArgs, liveTagSlugs: readonly string[]): SearchValidation {
  const query = (args.query ?? "").trim();
  const tags = args.tags ?? [];
  if (!hasSearchCriteria(args)) return { ok: false, message: NO_CRITERIA_MESSAGE };

  const known = new Set(liveTagSlugs);
  const unknown = tags.filter((t) => !known.has(t));
  if (unknown.length > 0) {
    const valid = [...known].sort().join(", ");
    return {
      ok: false,
      message:
        `Etiqueta${unknown.length > 1 ? "s" : ""} desconocida${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}. ` +
        `Etiquetas válidas: ${valid || "(ninguna)"}.`,
    };
  }
  return { ok: true, query, tags, limit: args.limit ?? 20 };
}

export interface SearchedSong {
  id: string;
  slug: string | null;
  title: string;
  artist: string;
  key: string | null;
  tags: string[];
}

/** `post` catalogue rows the caller confirms are canonical (`operationalClient`'s published perspective already drops `drafts.*`). */
export function searchSongs(posts: Post[], validated: Extract<SearchValidation, { ok: true }>): SearchedSong[] {
  const filters: LibraryFilters = { q: validated.query, tags: validated.tags, author: "", key: "" };
  const results = applyLibraryFilters(posts, filters, makeLibraryFuse(posts));
  return results.slice(0, validated.limit).map((post): SearchedSong => ({
    id: post._id,
    slug: post.slug?.current ?? null,
    title: post.title,
    artist: artistOf(post),
    key: post.key ?? null,
    tags: (post.tags ?? []).filter(isObj).map((t) => t.slug?.current).filter((s): s is string => nonEmptyString(s)),
  }));
}

/** Every tag slug the catalogue actually has, for I13's refusal and for `isTipoSlug`'s partner axis. */
export function liveTagSlugsOf(tags: readonly Tag[]): string[] {
  return tags.filter(isObj).map((t) => t.slug?.current).filter((s): s is string => nonEmptyString(s));
}

// ── get_song: input ──────────────────────────────────────────────────────────

export type GetSongSelector = { by: "id"; songId: string } | { by: "slug"; slug: string };
export type GetSongSelectorParse = { ok: true; selector: GetSongSelector } | { ok: false; message: string };

/**
 * Which of `{ songId } | { slug }` was given (spec I13): exactly one, and a
 * `songId` must be a canonical document id — bounded, no whitespace, and never
 * a `drafts.*` overlay, refused with its own message before any read (mirrors
 * `parseServiceSelector`'s drafts branch in `servicePresenter.ts`).
 */
export function parseGetSongSelector(input: { songId?: unknown; slug?: unknown }): GetSongSelectorParse {
  const { songId, slug } = input;
  const given = (v: unknown) => v !== undefined;
  if (given(songId) && given(slug)) return { ok: false, message: "Indica songId o slug, no ambos." };
  if (given(songId)) {
    if (typeof songId === "string" && songId.startsWith("drafts.")) {
      return {
        ok: false,
        message:
          "Ese id es una copia de borrador de Sanity (drafts.*), no una canción. " +
          "Usa el songId canónico, sin el prefijo «drafts.».",
      };
    }
    if (!isCanonicalDocumentId(songId)) return { ok: false, message: "songId no es un id de documento válido." };
    return { ok: true, selector: { by: "id", songId } };
  }
  if (given(slug)) {
    if (typeof slug !== "string" || slug.length === 0 || slug.length > 200) {
      return { ok: false, message: "slug no es válido." };
    }
    return { ok: true, selector: { by: "slug", slug } };
  }
  return { ok: false, message: "Indica songId o slug." };
}

// ── get_song: output ─────────────────────────────────────────────────────────

export type LyricsState = "visible" | "hidden_by_chart" | "none";

export interface ReferenceLinksOut {
  links: { label: string | null; url: string | null }[];
  musicalReferenceUrl: string | null;
  lyricsVideoUrl: string | null;
  lyricsURL: string | null;
  tutorials: { title: string | null; url: string | null }[];
}

export interface MixOut {
  mixKey: string | null;
  kind: string | null;
  family: string | null;
  track: string | null;
  bpm: number | null;
}

export interface MixGroup {
  tone: string | null;
  mixes: MixOut[];
}

export interface PlayHistoryEntry {
  date: string;
  service: "sunday" | "saturday";
  key: string | null;
}

export type GetSongPayload = {
  title: string | null;
  authors: string[];
  artist: string | null;
  keys: string[];
  bpm: string | null;
  timeSig: string | null;
  tags: { slug: string; title: string }[];
  referenceLinks: ReferenceLinksOut;
  lyrics: LyricsState;
  hasChordChart: boolean;
  rehearsalMixes: MixGroup[];
  playHistory: PlayHistoryEntry[];
  /** Spanish notes about content that could not be read (a failed play-history domain — ruling 3: never a silent empty answer). */
  notes?: string[];
};

function songKeys(row: SongDetailRow): string[] {
  const keys: string[] = [];
  if (nonEmptyString(row.key)) keys.push(row.key);
  for (const k of [...(row.chordKeys ?? []), ...(row.pdfKeys ?? [])]) {
    if (nonEmptyString(k) && !keys.includes(k)) keys.push(k);
  }
  return keys;
}

function lyricsStateOf(row: SongDetailRow): { lyrics: LyricsState; hasChordChart: boolean } {
  const bodyCount = typeof row.bodyCount === "number" ? row.bodyCount : 0;
  const chordCount = typeof row.chordCount === "number" ? row.chordCount : 0;
  const hasChordChart = chordCount > 0;
  const lyrics: LyricsState = bodyCount > 0 ? (hasChordChart ? "hidden_by_chart" : "visible") : "none";
  return { lyrics, hasChordChart };
}

function referenceLinksOf(row: SongDetailRow): ReferenceLinksOut {
  return {
    links: (row.referenceLinks ?? []).filter(isObj).map((l) => ({ label: l.label ?? null, url: l.url ?? null })),
    musicalReferenceUrl: row.musicalReferenceUrl ?? null,
    lyricsVideoUrl: row.lyricsVideoUrl ?? null,
    lyricsURL: row.lyricsURL ?? null,
    tutorials: (row.tutorials2 ?? []).filter(isObj).map((t) => ({ title: t.title ?? null, url: t.url ?? null })),
  };
}

/** Grouped by `tone`, first-seen order — the document's own stored order, never re-sorted. */
function mixGroupsOf(row: SongDetailRow): MixGroup[] {
  const order: (string | null)[] = [];
  const byTone = new Map<string | null, MixOut[]>();
  for (const mix of (row.rehearsalMixes ?? []).filter(isObj)) {
    const tone = nonEmptyString(mix.tone) ? mix.tone : null;
    if (!byTone.has(tone)) {
      byTone.set(tone, []);
      order.push(tone);
    }
    byTone.get(tone)!.push({
      mixKey: nonEmptyString(mix._key) ? mix._key : null,
      kind: mix.kind ?? null,
      family: mix.family ?? null,
      track: mix.track ?? null,
      bpm: typeof mix.bpm === "number" ? mix.bpm : null,
    });
  }
  return order.map((tone) => ({ tone, mixes: byTone.get(tone)! }));
}

/** Weekend kind for a setlist `_type` — never a literal (spec I2): `WEEKEND_SETLIST_TYPES` and `SETLIST_SERVICE_KINDS` are declared in the same order (Sunday, Saturday), pinned by a test. */
function weekendKindOf(type: unknown): "sunday" | "saturday" | null {
  const index = (WEEKEND_SETLIST_TYPES as readonly unknown[]).indexOf(type);
  if (index < 0) return null;
  const kind = SETLIST_SERVICE_KINDS[index];
  return kind === "sunday" || kind === "saturday" ? kind : null;
}

/**
 * D4: weekend setlists only, `week < today`, this song's id among `songs[]`.
 * `setlistRows` is the raw `canonicalSetlistsQuery()` result — already the
 * published perspective, so a `drafts.*` overlay never appears in it. Rows are
 * canonicalized by target BEFORE mapping, exactly as the song route does, so an
 * ambiguous (duplicate-week) target contributes no rows.
 */
export function songPlayHistory(setlistRows: readonly unknown[], songId: string, today: string): PlayHistoryEntry[] {
  const matches: Record<string, unknown>[] = [];
  for (const raw of setlistRows) {
    if (!isObj(raw)) continue;
    if (weekendKindOf(raw._type) === null) continue;
    if (!nonEmptyString(raw.week) || !(raw.week < today)) continue;
    const songs = Array.isArray(raw.songs) ? raw.songs : [];
    const has = songs.some((item) => isObj(item) && isObj(item.song) && item.song._ref === songId);
    if (has) matches.push(raw);
  }
  const canonical = canonicalizePlayHistory(matches, playHistoryTargetKey);
  return canonical
    .map((row): PlayHistoryEntry => {
      const songs = Array.isArray(row.songs) ? row.songs : [];
      const item = songs.find((it) => isObj(it) && isObj(it.song) && it.song._ref === songId);
      const playKey = isObj(item) && nonEmptyString(item.play_key) ? item.play_key : null;
      return { date: row.week as string, service: weekendKindOf(row._type)!, key: playKey };
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export interface GetSongLookups {
  playHistory: { ok: boolean; rows: readonly unknown[] };
}

const PLAY_HISTORY_UNREADABLE_NOTE =
  "No se pudo leer el historial de reproducciones de esta canción; se omite (nunca se muestra vacío por error).";

/** One song, as `get_song` reports it. `row` must be the ONE `SongDetailRow` the selector resolved. */
export function presentSong(row: SongDetailRow, today: string, lookups: GetSongLookups): GetSongPayload {
  const { lyrics, hasChordChart } = lyricsStateOf(row);
  const notes: string[] = [];
  const playHistory = lookups.playHistory.ok ? songPlayHistory(lookups.playHistory.rows, row._id, today) : [];
  if (!lookups.playHistory.ok) notes.push(PLAY_HISTORY_UNREADABLE_NOTE);

  return {
    title: row.title ?? null,
    authors: (row.authors ?? []).filter(isObj).map((a) => a.name).filter((n): n is string => nonEmptyString(n)),
    artist: row.author ?? null,
    keys: songKeys(row),
    bpm: typeof row.bpm === "string" ? row.bpm : row.bpm != null ? String(row.bpm) : null,
    timeSig: typeof row.timeSig === "string" ? row.timeSig : row.timeSig != null ? String(row.timeSig) : null,
    tags: (row.tags ?? [])
      .filter(isObj)
      .filter((t): t is { slug: string; name: string | null } => nonEmptyString(t.slug))
      .map((t) => ({ slug: t.slug, title: t.name ?? t.slug })),
    referenceLinks: referenceLinksOf(row),
    lyrics,
    hasChordChart,
    rehearsalMixes: mixGroupsOf(row),
    playHistory,
    ...(notes.length ? { notes } : {}),
  };
}
