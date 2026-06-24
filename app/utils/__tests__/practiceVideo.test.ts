import { describe, it, expect } from "vitest";
import { pickPracticeVideoUrl } from "../practiceVideo";

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
