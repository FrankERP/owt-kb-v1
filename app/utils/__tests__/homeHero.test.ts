import { describe, expect, it } from "vitest";
import { HERO_DEFAULT_POSITION, heroPhotoPosition, heroPhotoSrc, SHEET_TITLE } from "../homeHero";

const ASSET = "https://cdn.sanity.io/images/p/d/abc-4000x3000.jpg";

describe("heroPhotoSrc", () => {
  it("caps a Sanity asset at 1800 px, always as JPEG (never WebP, never a transparent PNG under the scrim)", () => {
    expect(heroPhotoSrc(ASSET)).toBe(`${ASSET}?w=1800&fit=max&q=78&fm=jpg`);
    expect(heroPhotoSrc("https://cdn.sanity.io/images/p/d/abc-10x10.png?dl=1")).toBe(
      "https://cdn.sanity.io/images/p/d/abc-10x10.png?dl=1&w=1800&fit=max&q=78&fm=jpg",
    );
  });

  it("turns the Studio crop into a pixel rect of the uncropped asset", () => {
    expect(heroPhotoSrc(ASSET, { top: 0.1, bottom: 0.2, left: 0.25, right: 0 })).toBe(
      `${ASSET}?rect=1000,300,3000,2100&w=1800&fit=max&q=78&fm=jpg`,
    );
  });

  it("serves the asset uncropped when the crop is empty, impossible, or the URL carries no size", () => {
    expect(heroPhotoSrc(ASSET, { top: 0, bottom: 0, left: 0, right: 0 })).not.toContain("rect=");
    expect(heroPhotoSrc(ASSET, { top: 0.6, bottom: 0.6, left: 0, right: 0 })).not.toContain("rect=");
    expect(heroPhotoSrc(ASSET, null)).not.toContain("rect=");
    expect(heroPhotoSrc("https://cdn.sanity.io/images/p/d/abc.jpg", { top: 0.1 })).toBe(
      "https://cdn.sanity.io/images/p/d/abc.jpg?w=1800&fit=max&q=78&fm=jpg",
    );
  });

  it("leaves a non-Sanity URL alone", () => {
    expect(heroPhotoSrc("https://lh3.googleusercontent.com/x", { top: 0.5 })).toBe("https://lh3.googleusercontent.com/x");
  });
});

describe("heroPhotoPosition", () => {
  it("turns the Studio hotspot into an object-position", () => {
    expect(heroPhotoPosition({ x: 0.25, y: 0.8 })).toBe("25% 80%");
  });

  it("re-expresses the hotspot inside the crop, since Sanity stores it against the uncropped image", () => {
    // Left quarter cut off, top tenth cut off: a hotspot at (0.5, 0.55) of the
    // whole sits at ((0.5-0.25)/0.75, (0.55-0.1)/0.7) of what is shown.
    expect(heroPhotoPosition({ x: 0.5, y: 0.55 }, { top: 0.1, bottom: 0.2, left: 0.25, right: 0 })).toBe("33% 64%");
    // A hotspot inside the cut-off strip clamps to the nearest edge.
    expect(heroPhotoPosition({ x: 0.1, y: 0.5 }, { left: 0.25 })).toBe("0% 50%");
  });

  it("clamps each axis to the frame and falls back per axis", () => {
    expect(heroPhotoPosition({ x: 1.7, y: -2 })).toBe("100% 0%");
    expect(heroPhotoPosition({ x: Number.NaN, y: null })).toBe("50% 35%");
  });

  it("keeps the faces above the middle when nothing is set", () => {
    expect(heroPhotoPosition(null)).toBe(HERO_DEFAULT_POSITION);
    expect(heroPhotoPosition(undefined, { top: 0.3 })).toBe("50% 35%");
  });
});

describe("SHEET_TITLE", () => {
  it("is the sheet's one small-caps style, and lives in a neutral module both the page and DayCard read", () => {
    expect(SHEET_TITLE).toContain("uppercase");
    expect(SHEET_TITLE).toContain("text-xs");
  });
});
