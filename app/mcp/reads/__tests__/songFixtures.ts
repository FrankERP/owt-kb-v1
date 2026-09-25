// Test-only fixtures for the P1 step 5 read tools (`search_songs`, `get_song`)
// — NOT a test file (no `.test.` in the name, so vitest's `include` never picks
// it up). Independent of `serviceFixtures.ts` / `readToolFixtures.ts`: neither
// tool touches the service snapshot (roles, locks, members, proposals), so this
// module needs no `ServiceFixtureStore`.
//
// One catalogue of raw `post` documents, projected two ways — `catalogueRow`
// (the `search_songs` shape `/biblioteca` loads) and `detailRow` (the
// `get_song` shape) — plus the weekend setlist rows `get_song`'s play history
// reads. `songResponder()` answers `operationalClient.fetch` for all three
// queries by matching the CALLER's own query text (`SONG_CATALOGUE_QUERY`,
// `songDetailByIdQuery`/`songDetailBySlugQuery`, `canonicalSetlistsQuery`), the
// same convention `readToolFixtures.ts` uses.
//
// `detailRow` deliberately keeps every extra field a mix carries in Sanity
// (its waveform envelope, its audio file reference, its active-range, its
// content hash) instead of narrowing to the query's own fields — so a passing
// "no leaked mix data" assertion proves the PRESENTER's own shaping, not just
// that the query text is clean (the same discipline `readToolFixtures.ts`
// documents for `SONG_POSTS`).

import type { Post, Tag } from "@/app/utils/interface";
import { canonicalSetlistsQuery } from "@/app/utils/serviceReadQueries";
import { SONG_CATALOGUE_QUERY } from "../songCatalogue";
import { songDetailByIdQuery, songDetailBySlugQuery, type SongDetailRow } from "../songDetail";

type Row = Record<string, unknown>;

const tagRef = (slug: string, name: string): Row => ({ slug, name });
const authorRef = (slug: string, name: string): Row => ({ slug, name });

export const TAG_CATALOGUE: readonly Row[] = [
  tagRef("up-beat", "Ritmo rápido (Up-beat)"),
  tagRef("down-beat", "Ritmo lento (Down-beat)"),
  tagRef("transition", "Transición"),
  tagRef("amor", "Amor"),
  tagRef("gratitud", "Gratitud"),
  tagRef("adoracion", "Adoración"),
];

/**
 * - `song-1`: a filled chord chart AND lyrics — `hidden_by_chart`; two keys
 *   beyond its base (`chords[].key`, `chordsPDF[].key`); two mixes in
 *   different tones, one carrying every extra field a real mix document has.
 * - `song-2`: no lyrics, no chart — `none`; a tempo (`up-beat`) and theme
 *   (`adoracion`) tag, for the tag-combination test.
 * - `song-3`: `body: []` explicit empty array — ADR-0018's `none`, not merely
 *   an absent field.
 * - `song-4`: lyrics with NO chart — `visible`; a referenced author, no legacy
 *   `author` string.
 * - `song-cancion` ("Canción nueva"): accent-insensitive search; `up-beat` +
 *   `amor`, so `tags: ["up-beat","amor"]` matches it alone (down-beat/adoracion
 *   songs carry neither of those two).
 * - `drafts.song-ghost`: a Studio draft copy — must never be searched, found by
 *   slug, or resolved by id.
 */
export const SONG_CATALOGUE: readonly Row[] = [
  {
    _id: "song-1",
    title: "Grande es tu fidelidad",
    author: "Thomas Chisholm",
    slug: "grande-es-tu-fidelidad",
    key: "G",
    authors: [],
    tags: [tagRef("down-beat", "Ritmo lento (Down-beat)"), tagRef("gratitud", "Gratitud")],
    bpm: "72",
    timeSig: "4/4",
    body: [{ _type: "block", children: [{ text: "CUERPO_SECRETO_DE_LA_LETRA" }] }],
    chords: [{ key: "Bb", content: "[Bb]CONTENIDO_SECRETO_DE_ACORDES" }],
    chordsPDF: [{ key: "Ab" }],
    referenceLinks: [{ label: "Original", url: "https://example.com/original" }],
    musicalReferenceUrl: "https://example.com/ref",
    lyricsVideoUrl: "https://example.com/video",
    lyricsURL: "https://cdn.example.com/letra.pdf",
    tutorials2: [{ title: "Tutorial", url: "https://example.com/tutorial" }],
    rehearsalMixes: [
      {
        _key: "mx1",
        kind: "full",
        family: null,
        track: null,
        tone: "G",
        bpm: 72,
        peaks: [0.1, 0.2],
        audioFile: { _type: "file", asset: { _ref: "file-1" } },
        active: [{ _key: "a1", s: 0, e: 10 }],
        sourceHash: "hash-1",
      },
      { _key: "mx2", kind: "up", family: "bass", track: "Bajo", tone: "A", bpm: 72, peaks: [0.3] },
    ],
  },
  {
    _id: "song-2",
    title: "Cuán grande es Él",
    author: "Carl Boberg",
    slug: "cuan-grande-es-el",
    key: "A",
    authors: [],
    tags: [tagRef("up-beat", "Ritmo rápido (Up-beat)"), tagRef("adoracion", "Adoración")],
    bpm: null,
    timeSig: null,
    body: undefined,
    chords: [],
    chordsPDF: [],
    referenceLinks: [],
    musicalReferenceUrl: null,
    lyricsVideoUrl: null,
    lyricsURL: null,
    tutorials2: [],
    rehearsalMixes: [],
  },
  {
    _id: "song-3",
    title: "Santo, santo, santo",
    author: "Reginald Heber",
    slug: "santo-santo-santo",
    key: "E",
    authors: [],
    tags: [],
    body: [],
    chords: [],
    chordsPDF: [],
    referenceLinks: [],
    musicalReferenceUrl: null,
    lyricsVideoUrl: null,
    lyricsURL: null,
    tutorials2: [],
    rehearsalMixes: [],
  },
  {
    _id: "song-4",
    title: "Cantad al Señor",
    author: "",
    slug: "cantad-al-senor",
    key: "D",
    authors: [authorRef("artista-x", "Artista X")],
    tags: [tagRef("transition", "Transición")],
    body: [{ _type: "block", children: [{ text: "CUERPO_VISIBLE" }] }],
    chords: [],
    chordsPDF: [],
    referenceLinks: [],
    musicalReferenceUrl: null,
    lyricsVideoUrl: null,
    lyricsURL: null,
    tutorials2: [],
    rehearsalMixes: [],
  },
  {
    _id: "song-cancion",
    title: "Canción nueva",
    author: "",
    slug: "cancion-nueva",
    key: "C",
    authors: [],
    tags: [tagRef("up-beat", "Ritmo rápido (Up-beat)"), tagRef("amor", "Amor")],
    body: [],
    chords: [],
    chordsPDF: [],
    referenceLinks: [],
    musicalReferenceUrl: null,
    lyricsVideoUrl: null,
    lyricsURL: null,
    tutorials2: [],
    rehearsalMixes: [],
  },
  {
    _id: "drafts.song-ghost",
    title: "Fantasma",
    author: "",
    slug: "fantasma",
    key: null,
    authors: [],
    tags: [],
    body: [],
    chords: [],
    chordsPDF: [],
    referenceLinks: [],
    musicalReferenceUrl: null,
    lyricsVideoUrl: null,
    lyricsURL: null,
    tutorials2: [],
    rehearsalMixes: [],
  },
];

function catalogueRow(row: Row): Row {
  return {
    _id: row._id,
    title: row.title,
    author: row.author,
    slug: { current: row.slug },
    key: row.key ?? null,
    tags: (row.tags as Row[]).map((t) => ({ _id: t.slug, slug: { current: t.slug }, name: t.name })),
    authors: (row.authors as Row[]).map((a) => ({ _id: a.slug, slug: { current: a.slug }, name: a.name })),
  };
}

function tagRow(t: Row): Row {
  return { _id: t.slug, slug: { current: t.slug }, name: t.name };
}

function detailRow(row: Row): Row {
  const body = Array.isArray(row.body) ? row.body : [];
  const chords = Array.isArray(row.chords) ? (row.chords as Row[]) : [];
  const chordsPDF = Array.isArray(row.chordsPDF) ? (row.chordsPDF as Row[]) : [];
  return {
    _id: row._id,
    title: row.title,
    author: row.author,
    slug: row.slug,
    key: row.key ?? null,
    authors: (row.authors as Row[]).map((a) => ({ name: a.name })),
    bodyCount: body.length,
    chordCount: chords.length,
    chordKeys: chords.map((c) => c.key),
    pdfKeys: chordsPDF.map((c) => c.key),
    bpm: row.bpm ?? null,
    timeSig: row.timeSig ?? null,
    tags: (row.tags as Row[]).map((t) => ({ slug: t.slug, name: t.name })),
    referenceLinks: row.referenceLinks ?? [],
    musicalReferenceUrl: row.musicalReferenceUrl ?? null,
    lyricsVideoUrl: row.lyricsVideoUrl ?? null,
    lyricsURL: row.lyricsURL ?? null,
    tutorials2: row.tutorials2 ?? [],
    // Every extra field a real mix document carries survives here on purpose —
    // see the header. `presentSong` must still emit only its own five fields.
    rehearsalMixes: (Array.isArray(row.rehearsalMixes) ? (row.rehearsalMixes as Row[]) : []).map((m) => ({ ...m })),
  };
}

/** `search_songs`'s catalogue, as `SONG_CATALOGUE_QUERY` would return it — drafts excluded (the published perspective). */
export function projectedCatalogue(
  posts: readonly Row[] = SONG_CATALOGUE,
  tags: readonly Row[] = TAG_CATALOGUE,
): { posts: Post[]; tags: Tag[] } {
  const live = posts.filter((row) => !String(row._id).startsWith("drafts."));
  return { posts: live.map(catalogueRow) as unknown as Post[], tags: tags.map(tagRow) as unknown as Tag[] };
}

/** One song as `get_song`'s own projection would return it. Throws if the id is unknown — a fixture bug, not a test case. */
export function detailRowFor(id: string, posts: readonly Row[] = SONG_CATALOGUE): SongDetailRow {
  const row = posts.find((r) => r._id === id);
  if (!row) throw new Error(`fixture: no song ${id}`);
  return detailRow(row) as unknown as SongDetailRow;
}

// ── Play history rows (canonicalSetlistsQuery — weekend setlists only) ──────

function setlistRow(id: string, type: string, week: string, songs: Row[]): Row {
  return { _id: id, _rev: `${id}-rev`, _type: type, week, songs };
}

function songItem(key: string, songId: string, playKey: string | null): Row {
  return { _key: key, play_key: playKey, medley_tag: null, song: { _type: "reference", _ref: songId }, leads: null };
}

/**
 * `song-1`'s history, frozen "today" 2026-09-30 (`readToolFixtures.FROZEN_EVENING`):
 * - `2026-08-02` and `2026-09-13`: past, both included — newest first.
 * - `2026-09-30`: exactly today — excluded (`week < today` is strict).
 * - `2026-10-04`: future — excluded; also carries `song-2` for a second song's history.
 * - `2026-08-16` a/b: a duplicate (ambiguous) past target — contributes NO rows.
 */
export const SONG_SETLIST_ROWS: readonly Row[] = [
  setlistRow("set-song1-0802", "featuredSongs", "2026-08-02", [songItem("r1", "song-1", "C")]),
  setlistRow("set-song1-0830", "saturdarSongs", "2026-08-30", [songItem("r1", "song-1", "Eb")]),
  setlistRow("set-song1-0913", "featuredSongs", "2026-09-13", [songItem("r1", "song-1", "D")]),
  setlistRow("set-song1-0930", "saturdarSongs", "2026-09-30", [songItem("r1", "song-1", "F")]),
  setlistRow("set-song1-1004", "featuredSongs", "2026-10-04", [
    songItem("r1", "song-1", "G"),
    songItem("r2", "song-2", "A"),
  ]),
  setlistRow("set-song1-0816-a", "featuredSongs", "2026-08-16", [songItem("r1", "song-1", "Bb")]),
  setlistRow("set-song1-0816-b", "featuredSongs", "2026-08-16", [songItem("r1", "song-1", "Bb")]),
];

export interface SongResponderOptions {
  posts?: readonly Row[];
  tags?: readonly Row[];
  setlists?: readonly Row[];
  failCatalogue?: boolean;
  failDetail?: boolean;
  failSetlists?: boolean;
}

/** Every read served, by name, for tests that assert what was (or was not) called. */
export interface SongResponder {
  fetch: (query: string, params?: Record<string, unknown>) => Promise<unknown>;
  calls: string[];
}

/**
 * Answers `operationalClient.fetch` for `search_songs` and `get_song`, keyed by
 * the CALLER's own query text — never a hand-copied GROQ string, so a query
 * edit moves the fixture with it.
 */
export function songResponder(options: SongResponderOptions = {}): SongResponder {
  const posts = options.posts ?? SONG_CATALOGUE;
  const tags = options.tags ?? TAG_CATALOGUE;
  const live = posts.filter((row) => !String(row._id).startsWith("drafts."));
  const setlistsQuery = canonicalSetlistsQuery().query;
  const byIdQuery = songDetailByIdQuery("x").query;
  const bySlugQuery = songDetailBySlugQuery("x").query;
  const calls: string[] = [];

  const fetch = async (query: string, params: Record<string, unknown> = {}): Promise<unknown> => {
    if (query === SONG_CATALOGUE_QUERY) {
      calls.push("catalogue");
      if (options.failCatalogue) throw new Error("fixture: catalogue failed token=sk-fixture-secret");
      return { posts: live.map(catalogueRow), tags: tags.map(tagRow) };
    }
    if (query === byIdQuery) {
      calls.push("detailById");
      if (options.failDetail) throw new Error("fixture: song detail failed token=sk-fixture-secret");
      return live.filter((row) => row._id === params.id).map(detailRow);
    }
    if (query === bySlugQuery) {
      calls.push("detailBySlug");
      if (options.failDetail) throw new Error("fixture: song detail failed token=sk-fixture-secret");
      return live.filter((row) => row.slug === params.slug).map(detailRow);
    }
    if (query === setlistsQuery) {
      calls.push("setlists");
      if (options.failSetlists) throw new Error("fixture: play history failed token=sk-fixture-secret");
      return structuredClone([...(options.setlists ?? SONG_SETLIST_ROWS)]);
    }
    throw new Error(`fixture: unknown query on operational: ${query.slice(0, 60)}`);
  };

  return { fetch, calls };
}
