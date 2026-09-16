import { describe, it, expect } from "vitest";
import { rootIndex, noteAt, semitonesBetween, transposeKey, transposeChord, capoSuggestion, isChordPro } from "../transpose";

describe("rootIndex", () => {
  it("parses a known root", () => {
    expect(rootIndex("Gb")).toBe(6);
  });

  it("returns -1 when unparsable", () => {
    expect(rootIndex("H")).toBe(-1);
  });
});

describe("noteAt", () => {
  it("wraps negative indices", () => {
    expect(noteAt(-1)).toBe("B");
  });

  it("wraps indices past the octave", () => {
    expect(noteAt(12)).toBe("C");
  });
});

describe("semitonesBetween", () => {
  it("computes the distance up from one key to another", () => {
    expect(semitonesBetween("G", "A")).toBe(2);
  });

  it("wraps around the octave", () => {
    expect(semitonesBetween("A", "G")).toBe(10);
  });

  it("returns 0 when either key is unparsable", () => {
    expect(semitonesBetween("?", "G")).toBe(0);
  });
});

describe("transposeKey", () => {
  it("transposes a minor key", () => {
    expect(transposeKey("Gm", 2)).toBe("Am");
  });

  it("transposes a flat key", () => {
    expect(transposeKey("Db", 1)).toBe("D");
  });

  it("returns the key unchanged when unparsable", () => {
    expect(transposeKey("", 3)).toBe("");
  });
});

describe("capoSuggestion", () => {
  it("suggests a fret and open-chord shape", () => {
    expect(capoSuggestion(rootIndex("Ab"))).toEqual({ fret: 1, shapeKey: "G" });
  });

  it("returns null for an unparsable root", () => {
    expect(capoSuggestion(-1)).toBeNull();
  });
});

describe("isChordPro", () => {
  it("detects a bracketed chord token", () => {
    expect(isChordPro("[G]Santo")).toBe(true);
  });

  it("returns false for plain lyrics", () => {
    expect(isChordPro("Santo")).toBe(false);
  });
});

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
