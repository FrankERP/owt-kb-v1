// `search_songs` / `get_song` pure logic (P1 step 5): the search reuse over
// `libraryIndex.ts`, the tag-vocabulary refusal, the selector parse, the three
// lyrics states (ADR-0018), the key list, the mix grouping (never a leaked
// waveform), and the play-history rule (D4).

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// This file imports `songFixtures.ts`, which imports the query builders from
// `songCatalogue.ts` / `songDetail.ts` for their query TEXT only — but that
// still loads `@/sanity/lib/operationalClient`, which reaches `sanity/env.ts`
// and throws when `NEXT_PUBLIC_SANITY_*` is unset, as it is under vitest.
vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: vi.fn() },
  rawIntegrityClient: { fetch: vi.fn() },
}));

import {
  liveTagSlugsOf,
  parseGetSongSelector,
  presentSong,
  searchSongs,
  songPlayHistory,
  validateSearchSongs,
} from "../songPresenter";
import { songDetailByIdQuery } from "../songDetail";
import { SONG_CATALOGUE_QUERY } from "../songCatalogue";
import { detailRowFor, projectedCatalogue, SONG_SETLIST_ROWS, TAG_CATALOGUE } from "./songFixtures";

const TODAY = "2026-09-30";
const { posts, tags } = projectedCatalogue();
const SLUGS = liveTagSlugsOf(tags);

function search(args: { query?: string; tags?: string[]; limit?: number }) {
  const validated = validateSearchSongs(args, SLUGS);
  if (!validated.ok) throw new Error(`fixture: expected a valid search, got: ${validated.message}`);
  return searchSongs(posts, validated);
}

describe("validateSearchSongs", () => {
  it("refuses when neither query nor tags is given", () => {
    const result = validateSearchSongs({}, SLUGS);
    expect(result.ok).toBe(false);
  });

  it("refuses a whitespace-only query with no tags (not '20 songs alphabetically')", () => {
    const result = validateSearchSongs({ query: "   " }, SLUGS);
    expect(result.ok).toBe(false);
  });

  it("accepts tags alone, defaults limit to 20", () => {
    const result = validateSearchSongs({ tags: ["up-beat"] }, SLUGS);
    expect(result).toMatchObject({ ok: true, limit: 20 });
  });

  it("refuses an unknown tag slug and lists the valid ones (I13)", () => {
    const result = validateSearchSongs({ tags: ["no-existe"] }, SLUGS);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.message).toContain("no-existe");
    for (const slug of TAG_CATALOGUE.map((t) => t.slug as string)) expect(result.message).toContain(slug);
  });
});

describe("searchSongs", () => {
  it('"cancion" finds «Canción nueva» (accent-insensitive)', () => {
    const results = search({ query: "cancion" });
    expect(results.map((s) => s.id)).toContain("song-cancion");
  });

  it("a 2-character query follows the short (substring) path and still finds a match", () => {
    const results = search({ query: "cu" });
    expect(results.map((s) => s.id)).toContain("song-2");
  });

  it("a tempo tag AND a theme tag combine as in the library: only the song with BOTH", () => {
    const results = search({ tags: ["up-beat", "amor"] });
    expect(results.map((s) => s.id)).toEqual(["song-cancion"]);
  });

  it("limit is respected", () => {
    const all = search({ tags: ["up-beat"] });
    expect(all.length).toBeGreaterThan(1);
    const limited = search({ tags: ["up-beat"], limit: 1 });
    expect(limited).toHaveLength(1);
    expect(limited[0]!.id).toBe(all[0]!.id);
  });

  it("a drafts.<id> post never reaches the searchable catalogue (the published perspective already dropped it)", () => {
    expect(posts.some((p) => p._id === "drafts.song-ghost")).toBe(false);
  });

  it("shapes the output as { id, slug, title, artist, key, tags }", () => {
    const [song1] = search({ query: "grande es tu fidelidad" }).filter((s) => s.id === "song-1");
    expect(song1).toEqual({
      id: "song-1",
      slug: "grande-es-tu-fidelidad",
      title: "Grande es tu fidelidad",
      artist: "Thomas Chisholm",
      key: "G",
      tags: ["down-beat", "gratitud"],
    });
  });
});

describe("parseGetSongSelector", () => {
  it("refuses neither songId nor slug", () => {
    expect(parseGetSongSelector({}).ok).toBe(false);
  });

  it("refuses both at once", () => {
    expect(parseGetSongSelector({ songId: "song-1", slug: "x" }).ok).toBe(false);
  });

  it("refuses a drafts.* songId before any read, without calling it merely invalid", () => {
    const result = parseGetSongSelector({ songId: "drafts.song-1" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.message).toMatch(/drafts\.\*/);
  });

  it("accepts a canonical songId", () => {
    expect(parseGetSongSelector({ songId: "song-1" })).toEqual({ ok: true, selector: { by: "id", songId: "song-1" } });
  });

  it("accepts a slug", () => {
    expect(parseGetSongSelector({ slug: "grande-es-tu-fidelidad" })).toEqual({
      ok: true,
      selector: { by: "slug", slug: "grande-es-tu-fidelidad" },
    });
  });
});

describe("presentSong — lyrics (ADR-0018)", () => {
  const history = { playHistory: { ok: true, rows: [] } };

  it('a filled chord chart hides the lyrics: "hidden_by_chart", hasChordChart true', () => {
    const payload = presentSong(detailRowFor("song-1"), TODAY, history);
    expect(payload.lyrics).toBe("hidden_by_chart");
    expect(payload.hasChordChart).toBe(true);
  });

  it('no body at all (field absent): "none"', () => {
    const payload = presentSong(detailRowFor("song-2"), TODAY, history);
    expect(payload.lyrics).toBe("none");
    expect(payload.hasChordChart).toBe(false);
  });

  it('body: [] (explicit empty array) is ALSO "none" — not merely an absent field', () => {
    const payload = presentSong(detailRowFor("song-3"), TODAY, history);
    expect(payload.lyrics).toBe("none");
  });

  it('lyrics with no chart: "visible"', () => {
    const payload = presentSong(detailRowFor("song-4"), TODAY, history);
    expect(payload.lyrics).toBe("visible");
    expect(payload.hasChordChart).toBe(false);
  });
});

describe("presentSong — declared fields", () => {
  const history = { playHistory: { ok: true, rows: [] } };

  it("keys: the base key first, then chord-chart keys, then PDF keys, deduplicated", () => {
    const payload = presentSong(detailRowFor("song-1"), TODAY, history);
    expect(payload.keys).toEqual(["G", "Bb", "Ab"]);
  });

  it("authors are names; artist is the legacy author string, kept separate", () => {
    const payload = presentSong(detailRowFor("song-4"), TODAY, history);
    expect(payload.authors).toEqual(["Artista X"]);
    expect(payload.artist).toBe("");
  });

  it("tags are { slug, title }", () => {
    const payload = presentSong(detailRowFor("song-1"), TODAY, history);
    expect(payload.tags).toEqual([
      { slug: "down-beat", title: "Ritmo lento (Down-beat)" },
      { slug: "gratitud", title: "Gratitud" },
    ]);
  });

  it("referenceLinks bundles referenceLinks[], musicalReferenceUrl, lyricsVideoUrl, lyricsURL and tutorials2", () => {
    const payload = presentSong(detailRowFor("song-1"), TODAY, history);
    expect(payload.referenceLinks).toEqual({
      links: [{ label: "Original", url: "https://example.com/original" }],
      musicalReferenceUrl: "https://example.com/ref",
      lyricsVideoUrl: "https://example.com/video",
      lyricsURL: "https://cdn.example.com/letra.pdf",
      tutorials: [{ title: "Tutorial", url: "https://example.com/tutorial" }],
    });
  });

  it("never carries the body text or the chord content string — the fixture's own secret markers prove it", () => {
    const payload = presentSong(detailRowFor("song-1"), TODAY, history);
    const text = JSON.stringify(payload);
    expect(text).not.toContain("CUERPO_SECRETO_DE_LA_LETRA");
    expect(text).not.toContain("CONTENIDO_SECRETO_DE_ACORDES");
    // `lyricsURL` IS a declared output field (part of `referenceLinks`), unlike the two above.
    expect(text).toContain("cdn.example.com/letra.pdf");
  });
});

describe("presentSong — rehearsalMixes, grouped by tone", () => {
  it("groups by tone, one mix per group here, with mixKey/kind/family/track/bpm only", () => {
    const payload = presentSong(detailRowFor("song-1"), TODAY, { playHistory: { ok: true, rows: [] } });
    expect(payload.rehearsalMixes).toEqual([
      { tone: "G", mixes: [{ mixKey: "mx1", kind: "full", family: null, track: null, bpm: 72 }] },
      { tone: "A", mixes: [{ mixKey: "mx2", kind: "up", family: "bass", track: "Bajo", bpm: 72 }] },
    ]);
  });

  it("never leaks a mix's waveform data, audio file, active range or content hash — the PRESENTER's own discipline, not just the query", () => {
    // The fixture row deliberately keeps every extra field a real mix carries.
    const row = detailRowFor("song-1");
    expect(JSON.stringify(row)).toMatch(/audioFile|sourceHash/); // control: the input DOES carry them
    const payload = presentSong(row, TODAY, { playHistory: { ok: true, rows: [] } });
    const text = JSON.stringify(payload);
    expect(text).not.toContain("peaks");
    expect(text).not.toContain("audioFile");
    expect(text).not.toContain("active");
    expect(text).not.toContain("sourceHash");
  });

  it("neither the catalogue query nor the detail query projects the waveform field", () => {
    expect(SONG_CATALOGUE_QUERY).not.toContain("peaks");
    expect(songDetailByIdQuery("x").query).not.toContain("peaks");
  });

  it("a mix with no _key falls back to mixKey: null, like every other absent field — never undefined or a throw", () => {
    const payload = presentSong(detailRowFor("song-mixgap"), TODAY, { playHistory: { ok: true, rows: [] } });
    expect(payload.rehearsalMixes).toEqual([
      { tone: "D", mixes: [{ mixKey: null, kind: "full", family: null, track: null, bpm: 80 }] },
    ]);
  });
});

describe("songPlayHistory (D4)", () => {
  it("excludes today's week and a future week, includes two past weeks, newest first", () => {
    const history = songPlayHistory(SONG_SETLIST_ROWS, "song-1", TODAY);
    expect(history.map((h) => h.date)).toEqual(["2026-09-13", "2026-08-30", "2026-08-02"]);
  });

  it("maps _type to service and play_key to key, with no base-key fallback", () => {
    const history = songPlayHistory(SONG_SETLIST_ROWS, "song-1", TODAY);
    expect(history).toEqual([
      { date: "2026-09-13", service: "sunday", key: "D" },
      { date: "2026-08-30", service: "saturday", key: "Eb" },
      { date: "2026-08-02", service: "sunday", key: "C" },
    ]);
  });

  it("an ambiguous (duplicate-week) target contributes NO rows, as the song route's canonicalization does", () => {
    const history = songPlayHistory(SONG_SETLIST_ROWS, "song-1", "2026-08-17");
    expect(history.some((h) => h.date === "2026-08-16")).toBe(false);
  });

  it("counts a past week regardless of its paired role's publication state (ADR-0005) — the function never reads a role at all", () => {
    // No role is passed in; the setlist row alone decides. That is the parity.
    const history = songPlayHistory(SONG_SETLIST_ROWS, "song-1", TODAY);
    expect(history.some((h) => h.date === "2026-09-13")).toBe(true);
  });

  it("a special's songs never count, even shaped as a role row referencing the song", () => {
    const rows = [
      ...SONG_SETLIST_ROWS,
      { _id: "role-sp-fixture", _type: "special_role", date: "2026-01-01", songs: [{ _key: "r1", play_key: "B", song: { _ref: "song-1" } }] },
    ];
    const history = songPlayHistory(rows, "song-1", TODAY);
    expect(history.some((h) => h.key === "B")).toBe(false);
  });

  it("returns [] for a song with no history", () => {
    expect(songPlayHistory(SONG_SETLIST_ROWS, "song-nope", TODAY)).toEqual([]);
  });

  it("play_key: null passes through as key: null, with no base-key fallback", () => {
    const history = songPlayHistory(SONG_SETLIST_ROWS, "song-nullkey", TODAY);
    expect(history).toEqual([{ date: "2026-08-01", service: "sunday", key: null }]);
  });
});

describe("presentSong — playHistory wiring and the failed-read note", () => {
  it("wires songPlayHistory's result straight through", () => {
    const payload = presentSong(detailRowFor("song-1"), TODAY, { playHistory: { ok: true, rows: SONG_SETLIST_ROWS } });
    expect(payload.playHistory.map((h) => h.date)).toEqual(["2026-09-13", "2026-08-30", "2026-08-02"]);
  });

  it("never answers an empty history as though it were known-empty when the read failed (ruling 3)", () => {
    const payload = presentSong(detailRowFor("song-1"), TODAY, { playHistory: { ok: false, rows: [] } });
    expect(payload.playHistory).toEqual([]);
    expect(payload.notes).toEqual(expect.arrayContaining([expect.stringMatching(/historial/)]));
  });

  it("adds no note when the read succeeded", () => {
    const payload = presentSong(detailRowFor("song-2"), TODAY, { playHistory: { ok: true, rows: [] } });
    expect(payload.notes).toBeUndefined();
  });
});
