// The navbar cue's two pure pieces: the label and the worship-vs-kids pick.
//
// The label is asserted VERBATIM because it is the only thing the strip paints —
// a drifted separator or a lower-cased countdown is invisible to every other gate.
// The dates are real: 2026-09-13 is a Sunday, 2026-09-12 a Saturday, 2026-09-16 a
// Wednesday (a `special_role` weekday service, which uses its own abbreviation).

import { describe, it, expect } from "vitest";
import { cueLabel, pickCue } from "../cue";

describe("cueLabel", () => {
  it("reads «DOM 13 · EN 5 DÍAS» five days out", () => {
    expect(cueLabel({ dateKey: "2026-09-13", kind: "worship" }, new Date("2026-09-08T12:00:00-06:00"))).toBe("DOM 13 · EN 5 DÍAS");
  });

  it("reads «HOY» on the day itself", () => {
    expect(cueLabel({ dateKey: "2026-09-13", kind: "worship" }, new Date("2026-09-13T12:00:00-06:00"))).toBe("DOM 13 · HOY");
  });

  it("reads «SÁB 12 · MAÑANA» the day before a Saturday service, accent kept", () => {
    expect(cueLabel({ dateKey: "2026-09-12", kind: "worship" }, new Date("2026-09-11T12:00:00-06:00"))).toBe("SÁB 12 · MAÑANA");
  });

  it("abbreviates a weekday service the same way", () => {
    expect(cueLabel({ dateKey: "2026-09-16", kind: "worship" }, new Date("2026-09-13T12:00:00-06:00"))).toBe("MIÉ 16 · EN 3 DÍAS");
  });

  it("pins the day to local noon — never a bare `new Date(iso)` UTC day-flip", () => {
    // At UTC-6 a bare `new Date("2026-09-13")` is Saturday the 12th, 18:00.
    expect(cueLabel({ dateKey: "2026-09-13", kind: "kids" }, new Date("2026-09-12T12:00:00-06:00"))).toBe("DOM 13 · MAÑANA");
  });
});

describe("pickCue", () => {
  it("takes the earlier of the two ministries", () => {
    expect(pickCue("2026-09-13", "2026-09-06")).toMatchObject({ dateKey: "2026-09-06", kind: "kids" });
    expect(pickCue("2026-09-06", "2026-09-13")).toMatchObject({ dateKey: "2026-09-06", kind: "worship" });
  });

  it("breaks a tie toward worship", () => {
    expect(pickCue("2026-09-13", "2026-09-13")).toMatchObject({ dateKey: "2026-09-13", kind: "worship" });
  });

  it("takes whichever side exists, and null when neither does", () => {
    expect(pickCue("2026-09-13", null)).toMatchObject({ kind: "worship" });
    expect(pickCue(null, "2026-09-13")).toMatchObject({ kind: "kids" });
    expect(pickCue(null, null)).toBeNull();
  });

  it("carries the full Spanish weekday alongside the date", () => {
    expect(pickCue("2026-09-12", null)?.day).toBe("Sábado");
  });
});
