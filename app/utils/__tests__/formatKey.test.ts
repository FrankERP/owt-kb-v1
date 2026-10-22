import { describe, it, expect } from "vitest";
import { formatKey } from "../formatKey";

describe("formatKey", () => {
  it("turns the accidental after the root into a symbol", () => {
    expect(formatKey("Bb")).toBe("B♭");
    expect(formatKey("F#")).toBe("F♯");
    expect(formatKey("Db")).toBe("D♭");
    expect(formatKey("Ebm")).toBe("E♭m");
    expect(formatKey("C#m7")).toBe("C♯m7");
  });

  it("keeps a natural key and a suffix as written", () => {
    expect(formatKey("E")).toBe("E");
    expect(formatKey("Am")).toBe("Am");
    expect(formatKey("G/B")).toBe("G/B");
  });

  it("upper-cases a lower-case root, since the chip no longer forces uppercase", () => {
    expect(formatKey("bb")).toBe("B♭");
  });

  it("leaves anything that is not a key alone", () => {
    expect(formatKey("—")).toBe("—");
    expect(formatKey("Modal")).toBe("Modal");
    expect(formatKey("")).toBe("");
    expect(formatKey(null)).toBe("");
    expect(formatKey(undefined)).toBe("");
  });

  it("never changes the stored spelling it is given (display only)", () => {
    const stored = "Bb";
    formatKey(stored);
    expect(stored).toBe("Bb");
  });
});
