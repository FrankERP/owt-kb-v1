import { describe, expect, it } from "vitest";
import { HERO_DEFAULT_POSITION, heroPhotoPosition, heroPhotoSrc } from "../homeHero";

describe("heroPhotoSrc", () => {
  it("caps a Sanity asset at 1800 px, as the original format family (jpg), never WebP", () => {
    expect(heroPhotoSrc("https://cdn.sanity.io/images/p/d/abc-4000x3000.jpg")).toBe(
      "https://cdn.sanity.io/images/p/d/abc-4000x3000.jpg?w=1800&fit=max&q=78&fm=jpg",
    );
    expect(heroPhotoSrc("https://cdn.sanity.io/images/p/d/abc.png?rect=1,2,3,4")).toMatch(/\?rect=1,2,3,4&w=1800&/);
  });

  it("leaves a non-Sanity URL alone", () => {
    expect(heroPhotoSrc("https://lh3.googleusercontent.com/x")).toBe("https://lh3.googleusercontent.com/x");
  });
});

describe("heroPhotoPosition", () => {
  it("turns the Studio hotspot into an object-position", () => {
    expect(heroPhotoPosition({ x: 0.25, y: 0.8 })).toBe("25% 80%");
  });

  it("clamps each axis to the frame and falls back per axis", () => {
    expect(heroPhotoPosition({ x: 1.7, y: -2 })).toBe("100% 0%");
    expect(heroPhotoPosition({ x: Number.NaN, y: null })).toBe("50% 35%");
  });

  it("keeps the faces above the middle when nothing is set", () => {
    expect(heroPhotoPosition(null)).toBe(HERO_DEFAULT_POSITION);
    expect(heroPhotoPosition(undefined)).toBe("50% 35%");
  });
});
