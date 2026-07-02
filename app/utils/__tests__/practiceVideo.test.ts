import { describe, it, expect } from "vitest";
import { pickPracticeVideoUrl, extractYouTubeId } from "../practiceVideo";

describe("extractYouTubeId", () => {
  it("extracts from a standard watch URL", () => {
    expect(extractYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });
  it("extracts from youtu.be short links (with tracking params)", () => {
    expect(extractYouTubeId("https://youtu.be/dQw4w9WgXcQ?si=abcDEF")).toBe("dQw4w9WgXcQ");
  });
  it("extracts from embed and shorts URLs", () => {
    expect(extractYouTubeId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractYouTubeId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });
  it("extracts when v is not the first query param (the bug fix)", () => {
    expect(extractYouTubeId("https://www.youtube.com/watch?list=PL123&v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractYouTubeId("https://www.youtube.com/watch?si=x&feature=share&v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });
  it("handles music.youtube.com", () => {
    expect(extractYouTubeId("https://music.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });
  it("returns null for nullish or non-YouTube URLs", () => {
    expect(extractYouTubeId(undefined)).toBeNull();
    expect(extractYouTubeId(null)).toBeNull();
    expect(extractYouTubeId("https://example.com/video")).toBeNull();
  });
});

describe("pickPracticeVideoUrl", () => {
  const song = {
    musicalReferenceUrl: "https://youtu.be/MUS",
    lyricsVideoUrl: "https://youtu.be/LYR",
    referenceLinks: [{ url: "https://youtu.be/LEGACY" }],
  };
  it("musica mode uses the musical reference", () => {
    expect(pickPracticeVideoUrl(song, "musica")).toBe("https://youtu.be/MUS");
  });
  it("letras mode uses the lyrics video", () => {
    expect(pickPracticeVideoUrl(song, "letras")).toBe("https://youtu.be/LYR");
  });
  it("letras falls back to musical when no lyrics video", () => {
    expect(pickPracticeVideoUrl({ musicalReferenceUrl: "https://youtu.be/MUS" }, "letras"))
      .toBe("https://youtu.be/MUS");
  });
  it("falls back to legacy referenceLinks when no new fields", () => {
    expect(pickPracticeVideoUrl({ referenceLinks: [{ url: "https://youtu.be/LEGACY" }] }, "musica"))
      .toBe("https://youtu.be/LEGACY");
  });
  it("returns null when nothing is available", () => {
    expect(pickPracticeVideoUrl({}, "musica")).toBeNull();
  });
});
