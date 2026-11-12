import { describe, expect, it } from "vitest";
import { SONG_COVER_GROQ, songCoverUrl } from "../songCover";

const ASSET = "https://cdn.sanity.io/images/ebb8vcnk/production/abc123-1000x1000.jpg";

describe("songCoverUrl", () => {
  it("is the stored album cover, square and sized for the largest tile at 3×", () => {
    expect(songCoverUrl(ASSET)).toBe(`${ASSET}?w=160&h=160&fit=crop`);
  });

  it("replaces any query the URL already carries instead of appending a second one", () => {
    expect(songCoverUrl(`${ASSET}?w=2000`)).toBe(`${ASSET}?w=160&h=160&fit=crop`);
  });

  it("never asks Sanity to pick the format — WebP does not decode in the iOS app's web view", () => {
    expect(songCoverUrl(ASSET)).not.toContain("auto=format");
  });

  it("is null for a song with no cover — the row draws its neutral tile", () => {
    expect(songCoverUrl(undefined)).toBeNull();
    expect(songCoverUrl(null)).toBeNull();
    expect(songCoverUrl("")).toBeNull();
  });

  it("is null for anything that is not a Sanity image: never a video still, never a foreign host", () => {
    expect(songCoverUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(songCoverUrl("https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg")).toBeNull();
    expect(songCoverUrl("https://cdn.sanity.io/files/ebb8vcnk/production/abc.mp3")).toBeNull();
    expect(songCoverUrl("no es un enlace")).toBeNull();
  });
});

describe("SONG_COVER_GROQ", () => {
  it("reads the song's own `albumArt` image, through the setlist item's reference", () => {
    expect(SONG_COVER_GROQ).toBe("song->albumArt.asset->url");
  });
});
