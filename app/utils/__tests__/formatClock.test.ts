import { describe, expect, it } from "vitest";
import { formatClock } from "../formatClock";

describe("formatClock", () => {
  it("formats m:ss, flooring the second", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(5.9)).toBe("0:05");
    expect(formatClock(102)).toBe("1:42");
    expect(formatClock(276.4)).toBe("4:36");
    expect(formatClock(3600)).toBe("60:00");
  });

  it("answers 0:00 for nothing, NaN or a negative", () => {
    expect(formatClock(null)).toBe("0:00");
    expect(formatClock(undefined)).toBe("0:00");
    expect(formatClock(Number.NaN)).toBe("0:00");
    expect(formatClock(-3)).toBe("0:00");
  });
});
