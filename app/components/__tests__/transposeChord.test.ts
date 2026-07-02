import { describe, it, expect } from "vitest";
import { transposeChord } from "../ChordChart";

describe("transposeChord", () => {
  it("returns the chord unchanged for zero semitones", () => {
    expect(transposeChord("G/B", 5)).not.toBe("G/B"); // sanity: non-zero does change
    expect(transposeChord("Cmaj7", 0)).toBe("Cmaj7");
  });

  it("transposes a simple root up", () => {
    expect(transposeChord("C", 2)).toBe("D");
    expect(transposeChord("G", 5)).toBe("C");
  });

  it("preserves chord quality/extensions", () => {
    expect(transposeChord("Cmaj7", 2)).toBe("Dmaj7");
    expect(transposeChord("Am7", 3)).toBe("Cm7");
    expect(transposeChord("Dsus4", 2)).toBe("Esus4");
  });

  it("wraps around the octave", () => {
    expect(transposeChord("B", 1)).toBe("C");
    expect(transposeChord("C", -1)).toBe("B");
  });

  it("transposes both sides of a slash chord (the bug fix)", () => {
    // Previously the bass note was left untransposed (G/B -> A/B). It must move.
    expect(transposeChord("G/B", 2)).toBe("A/C#");
    expect(transposeChord("C/E", 2)).toBe("D/F#");
    expect(transposeChord("D/F#", -2)).toBe("C/E");
    expect(transposeChord("G/B", 5)).toBe("C/E");
  });

  it("preserves quality on the root of a slash chord", () => {
    expect(transposeChord("Am7/G", 2)).toBe("Bm7/A");
  });

  it("leaves non-chord tokens untouched", () => {
    expect(transposeChord("N.C.", 2)).toBe("N.C.");
    expect(transposeChord("%", 2)).toBe("%");
  });
});
