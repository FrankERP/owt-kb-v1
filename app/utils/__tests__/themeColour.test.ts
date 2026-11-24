import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { colourFromTriplet, themeColour } from "../themeColour";

const REPO_ROOT = path.resolve(__dirname, "../../..");

describe("themeColour", () => {
  it("returns a complete colour, with or without alpha", () => {
    expect(themeColour("--accent-rgb")).toBe("rgb(var(--accent-rgb))");
    expect(themeColour("--accent-rgb", 0.2)).toBe("rgb(var(--accent-rgb) / 0.2)");
  });
});

describe("colourFromTriplet — the canvas path", () => {
  it("builds a literal colour from a brand.css triplet", () => {
    expect(colourFromTriplet("0 191 255")).toBe("rgb(0 191 255)");
    expect(colourFromTriplet(" 156 163 175 ", 0.45)).toBe("rgb(156 163 175 / 0.45)");
  });

  it("refuses anything that is not a triplet, so a caller skips the draw", () => {
    expect(colourFromTriplet("")).toBeNull();
    expect(colourFromTriplet("rgb(var(--accent-rgb))")).toBeNull();
    expect(colourFromTriplet("0 191 999")).toBeNull();
  });
});

// A SOURCE test: jsdom has no canvas, so nothing else can see that a fillStyle
// was handed `var()`. A canvas does not substitute custom properties — the
// assignment is dropped and the context keeps black, which is how the
// rehearsal waveform shipped black (2026-10-23).
describe("no canvas is painted through var()", () => {
  it("Waveform never hands themeColour() to the 2D context", () => {
    const src = readFileSync(path.join(REPO_ROOT, "app/components/song/Waveform.tsx"), "utf8");
    expect(src).not.toMatch(/\bthemeColour\(/);
    expect(src).toContain("resolvedThemeColour(canvas");
  });
});
