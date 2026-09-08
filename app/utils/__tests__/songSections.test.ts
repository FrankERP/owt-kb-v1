// Which sections a song page paints — and the empty state that depends on it.
//
// This list decides three things at once: whether `SectionNav` renders (more
// than one), which `<section>`s render, and whether the "no content yet" state
// renders (none). A quiet mistake in any flag shows up as a section header over
// an empty box, which reads as a half-loaded page rather than an empty one.
//
// The case that earned the file: `body` is an ARRAY, so the page's original
// `!!post.body` was true for `[]` — and `[]` is exactly what clearing the
// "Letra" field writes (`textToBody("")` → `[]`, persisted by `.set`). So
// truthiness claimed lyrics for the commonest way a song loses them, painted an
// empty «Letra» section, and suppressed the empty state in the one case it was
// written for.

import { describe, expect, it } from "vitest";

import { songSections } from "../songSections";

const ids = (post: Parameters<typeof songSections>[0], history = 0) =>
  songSections(post, history).map((s) => s.id);

describe("songSections", () => {
  it("returns nothing for a song with no content at all", () => {
    expect(ids({})).toEqual([]);
    expect(ids(null)).toEqual([]);
    expect(ids(undefined)).toEqual([]);
  });

  it("treats an EMPTY lyrics array as no lyrics", () => {
    // The defect this file exists for. `[]` is what the admin clear-lyrics path
    // stores, not `undefined`, so a truthiness check passes it.
    expect(ids({ body: [] })).toEqual([]);
  });

  it("treats every other empty array as absent too", () => {
    expect(ids({ audioTracks: [], tutorials2: [], chords: [], referenceLinks: [] })).toEqual([]);
  });

  it("shows Letra for words alone, chords alone, or both", () => {
    expect(ids({ body: [{}] })).toEqual(["letra"]);
    // A chart with no words still has something to show in that section.
    expect(ids({ chords: [{}] })).toEqual(["letra"]);
    expect(ids({ body: [{}], chords: [{}] })).toEqual(["letra"]);
  });

  it("counts any of the three reference sources", () => {
    expect(ids({ musicalReferenceUrl: "https://x" })).toEqual(["referencia"]);
    expect(ids({ lyricsVideoUrl: "https://x" })).toEqual(["referencia"]);
    expect(ids({ referenceLinks: [{}] })).toEqual(["referencia"]);
    // An empty string is not a link.
    expect(ids({ musicalReferenceUrl: "", lyricsVideoUrl: "" })).toEqual([]);
  });

  it("takes history from the count, not from the song", () => {
    expect(ids({}, 3)).toEqual(["historial"]);
    expect(ids({}, 0)).toEqual([]);
  });

  it("keeps page order regardless of which are present", () => {
    const all = ids(
      {
        audioTracks: [{}],
        tutorials2: [{}],
        referenceLinks: [{}],
        body: [{}],
      },
      1,
    );
    expect(all).toEqual(["audio", "tutoriales", "referencia", "letra", "historial"]);
  });

  it("gives SectionNav its more-than-one test something to be false about", () => {
    // One section renders no nav; the page keys that on `length > 1`.
    expect(songSections({ body: [{}] }, 0)).toHaveLength(1);
  });
});
