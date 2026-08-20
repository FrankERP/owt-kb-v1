import { describe, it, expect } from "vitest";
import { planKidsMonth, pairUnavailable } from "../kidsRotation";
import type { RotationInput, RotationPair } from "../kidsTypes";

const P = (id: string, room: RotationPair["room"], a: string, b: string): RotationPair =>
  ({ id, name: id, room, memberIds: [a, b] });

// 12 pairs, 4 per room, mirroring the real roster shape
const pairs: RotationPair[] = [
  P("c1", "chiquitos", "m1", "m2"), P("c2", "chiquitos", "m3", "m4"),
  P("c3", "chiquitos", "m5", "m6"), P("c4", "chiquitos", "m7", "m8"),
  P("d1", "medianos", "m9", "m10"), P("d2", "medianos", "m11", "m12"),
  P("d3", "medianos", "m13", "m14"), P("d4", "medianos", "m15", "m16"),
  P("g1", "grandes", "m17", "m18"), P("g2", "grandes", "m19", "m20"),
  P("g3", "grandes", "m21", "m22"), P("g4", "grandes", "m23", "m24"),
];
const sundays = ["2026-09-06", "2026-09-13", "2026-09-20", "2026-09-27"];
const base: RotationInput = { sundays, pairs, unavailable: {}, history: [] };

describe("planKidsMonth", () => {
  it("fills all four seats every Sunday from the correct pools", () => {
    const r = planKidsMonth(base);
    expect(r.proposal).toHaveLength(4);
    for (const a of r.proposal) {
      expect(Object.keys(a.seats).sort()).toEqual(["chiquitos", "ensenanza", "grandes", "medianos"]);
      const room = (s: "chiquitos" | "medianos" | "grandes") =>
        pairs.find(p => p.id === a.seats[s])!.room;
      expect(room("chiquitos")).toBe("chiquitos");
      expect(room("medianos")).toBe("medianos");
      expect(room("grandes")).toBe("grandes");
    }
    expect(r.diagnostics).toEqual([]);
  });

  it("never seats a pair twice on one Sunday", () => {
    const r = planKidsMonth(base);
    for (const a of r.proposal) {
      const ids = Object.values(a.seats);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("is deterministic: same input, same output", () => {
    expect(planKidsMonth(base)).toEqual(planKidsMonth(base));
  });

  it("rotates rooms least-recently-served across a month", () => {
    const r = planKidsMonth(base);
    const chiq = r.proposal.map(a => a.seats.chiquitos);
    // 4 pairs, 4 Sundays, ensenanza steals at most one per week → no repeats needed
    expect(new Set(chiq).size).toBe(4);
  });

  it("a pair is unavailable when EITHER member is", () => {
    expect(pairUnavailable(pairs[0], "2026-09-06", { m2: ["2026-09-06"] })).toBe(true);
    expect(pairUnavailable(pairs[0], "2026-09-06", { m2: ["2026-09-13"] })).toBe(false);
    const r = planKidsMonth({ ...base, unavailable: { m2: ["2026-09-06"] } });
    expect(Object.values(r.proposal[0].seats)).not.toContain("c1");
  });

  it("respects history: the pair that served most recently goes last", () => {
    const history = [{ date: "2026-08-30", seats: { chiquitos: "c1" } }];
    const r = planKidsMonth({ ...base, history });
    expect(r.proposal[0].seats.chiquitos).not.toBe("c1");
  });

  it("ensenanza cycles the full pool without repeating in 4 weeks", () => {
    const r = planKidsMonth(base);
    const ens = r.proposal.map(a => a.seats.ensenanza);
    expect(new Set(ens).size).toBe(4);
  });

  it("leaves an unfillable seat empty with a diagnostic, never mis-seats", () => {
    const allChiqOut = { m1: sundays, m3: sundays, m5: sundays, m7: sundays };
    const r = planKidsMonth({ ...base, unavailable: allChiqOut });
    const d = r.diagnostics.filter(x => x.seat === "chiquitos");
    expect(d.length).toBeGreaterThan(0);
    for (const a of r.proposal) {
      if (a.seats.chiquitos) expect(pairs.find(p => p.id === a.seats.chiquitos)!.room).toBe("chiquitos");
    }
  });

  it("warns (never blocks) on worship overlap", () => {
    const r = planKidsMonth({ ...base, worshipAssignments: { "2026-09-06": ["m1", "m2"] } });
    const first = r.proposal[0];
    expect(Object.keys(first.seats)).toHaveLength(4); // still fully seated
    if (Object.values(first.seats).includes("c1")) {
      expect(r.warnings.some(w => w.date === "2026-09-06" && w.pairId === "c1")).toBe(true);
    }
  });
});
