import { describe, it, expect } from "vitest";
import { planKidsMonth, pairUnavailable, proposalFingerprint } from "../kidsRotation";
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

describe("planKidsMonth — seeded alternatives", () => {
  it("seed 0 and no seed are the same plan: the fairest one is what you see first", () => {
    expect(planKidsMonth({ ...base, seed: 0 })).toEqual(planKidsMonth(base));
  });

  it("a seed is still deterministic: same seed, same plan", () => {
    expect(planKidsMonth({ ...base, seed: 7 })).toEqual(planKidsMonth({ ...base, seed: 7 }));
  });

  it("different seeds give different plans when the roster has no history", () => {
    // The state the app is actually in today: 12 pairs, zero saved Sundays, so
    // every pair sits on the NEVER sentinel and the whole month is one big tie.
    const seen = new Set<string>();
    for (let seed = 0; seed < 6; seed++) {
      seen.add(proposalFingerprint(planKidsMonth({ ...base, seed }).proposal));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("still produces different plans once a SATURATED history leaves no ties at all", () => {
    // The regression a ties-only shuffle would have: once the rotation has run a
    // while there is nothing left tied, and "otra opción" hands back the same
    // month forever.
    //
    // Saturating it takes twelve Sundays, not four. Enseñanza draws from all 12
    // pairs, so a shorter history leaves some of them never-served and TIED —
    // and because the teaching pair leaves its own room's pool that Sunday, that
    // leftover tie leaks into the room seats too and supplies variety all on its
    // own. Both of those masked this test until the history got this long.
    //
    // Here every pair carries a distinct last-served date in every category it
    // can hold. Zero ties. Any variety below is the slack and nothing else.
    const priorSundays = [
      "2026-06-07", "2026-06-14", "2026-06-21", "2026-06-28",
      "2026-07-05", "2026-07-12", "2026-07-19", "2026-07-26",
      "2026-08-02", "2026-08-09", "2026-08-16", "2026-08-23",
    ];
    // The +1 offset keeps a pair from teaching and holding its own room on the
    // same Sunday, which the real writer forbids and the engine would never emit.
    const history = priorSundays.map((date, i) => ({
      date,
      seats: {
        ensenanza: pairs[i].id,
        chiquitos: `c${((i + 1) % 4) + 1}`,
        medianos: `d${((i + 1) % 4) + 1}`,
        grandes: `g${((i + 1) % 4) + 1}`,
      },
    }));
    for (const row of history) {
      expect(new Set(Object.values(row.seats)).size).toBe(4); // no pair twice in a Sunday
    }

    const withHistory = { ...base, history };
    const seen = new Set<string>();
    for (let seed = 0; seed < 6; seed++) {
      seen.add(proposalFingerprint(planKidsMonth({ ...withHistory, seed }).proposal));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("never seats the most recently served pair while a more rested one exists", () => {
    // The bound on the slack. A variant may reach one generation back, never to
    // the pair that served last Sunday — that is the line between "another
    // option" and "the rotation stopped meaning anything".
    for (let seed = 0; seed < 12; seed++) {
      const r = planKidsMonth({ ...base, seed });
      for (let i = 1; i < r.proposal.length; i++) {
        const prev = r.proposal[i - 1].seats;
        const now = r.proposal[i].seats;
        for (const seat of ["chiquitos", "medianos", "grandes"] as const) {
          // 4 pairs per room, all available, so repeating last Sunday's pair is
          // never forced by a shortage.
          expect(now[seat]).not.toBe(prev[seat]);
        }
      }
    }
  });

  it("keeps every hard rule under a seed: one seat per pair, correct room, availability", () => {
    const unavailable = { m1: ["2026-09-06"], m9: ["2026-09-13"] };
    for (let seed = 0; seed < 12; seed++) {
      const r = planKidsMonth({ ...base, seed, unavailable });
      for (const a of r.proposal) {
        const ids = Object.values(a.seats);
        expect(new Set(ids).size).toBe(ids.length);
        for (const seat of ["chiquitos", "medianos", "grandes"] as const) {
          const id = a.seats[seat];
          if (id) expect(pairs.find(p => p.id === id)!.room).toBe(seat);
        }
        for (const id of ids) {
          expect(pairUnavailable(pairs.find(p => p.id === id)!, a.date, unavailable)).toBe(false);
        }
      }
    }
  });
});

describe("proposalFingerprint", () => {
  it("is equal for identical plans and different for a single changed seat", () => {
    const a = planKidsMonth(base).proposal;
    const b = planKidsMonth(base).proposal;
    expect(proposalFingerprint(a)).toBe(proposalFingerprint(b));

    const changed = a.map((row, i) =>
      i === 0 ? { ...row, seats: { ...row.seats, ensenanza: "g4" } } : row,
    );
    expect(proposalFingerprint(changed)).not.toBe(proposalFingerprint(a));
  });

  it("ignores seat key order, so it fingerprints the plan and not the object", () => {
    const [row] = planKidsMonth(base).proposal;
    const reordered = {
      date: row.date,
      seats: Object.fromEntries(Object.entries(row.seats).reverse()),
    };
    expect(proposalFingerprint([reordered])).toBe(proposalFingerprint([row]));
  });
});
