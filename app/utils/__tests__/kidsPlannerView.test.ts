import { describe, it, expect } from "vitest";
import { buildPlannerView, type PlannerViewInput } from "../kidsPlannerView";
import { KIDS_ROOMS, type KidsAssignment, type RotationPair } from "../kidsTypes";

type ViewPair = RotationPair & { active: boolean };

const P = (
  id: string,
  room: RotationPair["room"],
  a: string,
  b: string,
  active = true,
): ViewPair => ({ id, name: `Pareja ${id}`, room, memberIds: [a, b], active });

// 12 pairs, 4 per room — the real roster shape.
const pairs: ViewPair[] = [
  P("c1", "chiquitos", "m1", "m2"), P("c2", "chiquitos", "m3", "m4"),
  P("c3", "chiquitos", "m5", "m6"), P("c4", "chiquitos", "m7", "m8"),
  P("d1", "medianos", "m9", "m10"), P("d2", "medianos", "m11", "m12"),
  P("d3", "medianos", "m13", "m14"), P("d4", "medianos", "m15", "m16"),
  P("g1", "grandes", "m17", "m18"), P("g2", "grandes", "m19", "m20"),
  P("g3", "grandes", "m21", "m22"), P("g4", "grandes", "m23", "m24"),
];

const memberNames: Record<string, string> = {
  m1: "Linnette", m2: "Vale",
  ...Object.fromEntries(
    Array.from({ length: 22 }, (_, i) => [`m${i + 3}`, `Miembro ${i + 3}`]),
  ),
};

const sundays = ["2026-09-06", "2026-09-13", "2026-09-20", "2026-09-27"];

const base: PlannerViewInput = {
  sundays,
  pairs,
  assignments: [],
  unavailable: {},
  memberNames,
  history: [],
};

const view = (over: Partial<PlannerViewInput> = {}) =>
  buildPlannerView({ ...base, ...over });

const seatOf = (v: ReturnType<typeof buildPlannerView>, date: string, seat: string) =>
  v.seats.find((s) => s.date === date && s.seat === seat)!;

const optOf = (
  v: ReturnType<typeof buildPlannerView>,
  date: string,
  seat: string,
  pairId: string,
) => seatOf(v, date, seat).options.find((o) => o.pairId === pairId)!;

/** Every chiquitos pair serves its room once in August, c1 first (longest wait). */
const augustChiquitos: KidsAssignment[] = [
  { date: "2026-08-09", seats: { chiquitos: "c1" } },
  { date: "2026-08-16", seats: { chiquitos: "c2" } },
  { date: "2026-08-23", seats: { chiquitos: "c3" } },
  { date: "2026-08-30", seats: { chiquitos: "c4" } },
];

describe("buildPlannerView — shape", () => {
  it("emits one row per Sunday × seat, in seat order", () => {
    const v = view();
    expect(v.sundays).toEqual(sundays);
    expect(v.seats).toHaveLength(sundays.length * 4);
    expect(v.seats.slice(0, 4).map((s) => s.seat)).toEqual([
      "ensenanza", "chiquitos", "medianos", "grandes",
    ]);
    expect(v.seats.slice(0, 4).every((s) => s.date === "2026-09-06")).toBe(true);
  });

  it("draws the enseñanza pool from every pair and a room pool from that room", () => {
    const v = view();
    expect(seatOf(v, "2026-09-06", "ensenanza").options).toHaveLength(12);
    expect(seatOf(v, "2026-09-06", "chiquitos").options.map((o) => o.pairId))
      .toEqual(expect.arrayContaining(["c1", "c2", "c3", "c4"]));
    expect(seatOf(v, "2026-09-06", "chiquitos").options).toHaveLength(4);
  });

  it("reports the assignment currently on screen", () => {
    const v = view({ assignments: [{ date: "2026-09-06", seats: { chiquitos: "c2" } }] });
    expect(seatOf(v, "2026-09-06", "chiquitos").assignedPairId).toBe("c2");
    expect(seatOf(v, "2026-09-06", "medianos").assignedPairId).toBeNull();
  });
});

describe("buildPlannerView — weeksSince", () => {
  it("keeps one clock per seat category: an enseñanza turn does not shorten the room clock", () => {
    const v = view({
      history: [
        { date: "2026-08-09", seats: { chiquitos: "c1" } },
        { date: "2026-08-30", seats: { ensenanza: "c1" } },
      ],
    });
    // Taught last Sunday…
    expect(optOf(v, "2026-09-06", "ensenanza", "c1").weeksSince).toBe(1);
    // …but its room turn is still four Sundays old.
    expect(optOf(v, "2026-09-06", "chiquitos", "c1").weeksSince).toBe(4);
  });

  it("counts weeks even when a Sunday has no saved schedule at all", () => {
    const v = view({ history: [{ date: "2026-08-02", seats: { chiquitos: "c1" } }] });
    expect(optOf(v, "2026-09-06", "chiquitos", "c1").weeksSince).toBe(5);
  });

  it("counts the month's own draft turns for later Sundays", () => {
    const v = view({ assignments: [{ date: "2026-09-06", seats: { chiquitos: "c1" } }] });
    expect(optOf(v, "2026-09-06", "chiquitos", "c1").weeksSince).toBeNull();
    expect(optOf(v, "2026-09-13", "chiquitos", "c1").weeksSince).toBe(1);
    expect(optOf(v, "2026-09-27", "chiquitos", "c1").weeksSince).toBe(3);
  });

  it("labels the wait in Spanish, singular and plural, 'nunca' when never served", () => {
    const v = view({
      history: [
        { date: "2026-08-30", seats: { chiquitos: "c1" } },
        { date: "2026-08-23", seats: { chiquitos: "c2" } },
        { date: "2026-08-09", seats: { chiquitos: "c3" } },
      ],
    });
    expect(optOf(v, "2026-09-06", "chiquitos", "c1").weeksSinceLabel).toBe("hace 1 semana");
    expect(optOf(v, "2026-09-06", "chiquitos", "c2").weeksSinceLabel).toBe("hace 2 semanas");
    expect(optOf(v, "2026-09-06", "chiquitos", "c3").weeksSinceLabel).toBe("hace 4 semanas");
    expect(optOf(v, "2026-09-06", "chiquitos", "c4").weeksSince).toBeNull();
    expect(optOf(v, "2026-09-06", "chiquitos", "c4").weeksSinceLabel).toBe("nunca");
  });

  it("sorts a pair that has never served first — it is the most overdue", () => {
    const v = view({
      history: [
        { date: "2026-08-16", seats: { chiquitos: "c1" } },
        { date: "2026-08-23", seats: { chiquitos: "c2" } },
        { date: "2026-08-30", seats: { chiquitos: "c3" } },
      ],
    });
    expect(seatOf(v, "2026-09-06", "chiquitos").options.map((o) => o.pairId))
      .toEqual(["c4", "c1", "c2", "c3"]);
  });
});

describe("buildPlannerView — blocks", () => {
  it("returns an unavailable pair instead of hiding it, and names who is away", () => {
    const v = view({ unavailable: { m2: ["2026-09-06"] } });
    const c1 = optOf(v, "2026-09-06", "chiquitos", "c1");
    expect(c1.block).toEqual({ kind: "unavailable", memberNames: ["Vale"] });
    expect(seatOf(v, "2026-09-06", "chiquitos").options.map((o) => o.pairId).sort())
      .toEqual(["c1", "c2", "c3", "c4"]);
    // The other Sunday is untouched.
    expect(optOf(v, "2026-09-13", "chiquitos", "c1").block).toBeNull();
  });

  it("names both members when both are away", () => {
    const v = view({ unavailable: { m1: ["2026-09-06"], m2: ["2026-09-06"] } });
    expect(optOf(v, "2026-09-06", "chiquitos", "c1").block)
      .toEqual({ kind: "unavailable", memberNames: ["Linnette", "Vale"] });
  });

  it("blocks a pair that already holds another seat that Sunday, naming the seat", () => {
    const v = view({ assignments: [{ date: "2026-09-06", seats: { ensenanza: "c1" } }] });
    expect(optOf(v, "2026-09-06", "chiquitos", "c1").block)
      .toEqual({ kind: "seated", seat: "ensenanza" });
    // …but never against its own seat.
    expect(optOf(v, "2026-09-06", "ensenanza", "c1").block).toBeNull();
  });

  it("returns a retired pair with a retired block rather than dropping it", () => {
    const retired = pairs.map((p) => (p.id === "c4" ? { ...p, active: false } : p));
    const v = view({ pairs: retired });
    expect(optOf(v, "2026-09-06", "chiquitos", "c4").block).toEqual({ kind: "retired" });
    expect(seatOf(v, "2026-09-06", "chiquitos").options).toHaveLength(4);
    expect(optOf(v, "2026-09-06", "ensenanza", "c4").block).toEqual({ kind: "retired" });
  });

  it("keeps a pair seated in the wrong room visible, with the room it belongs to", () => {
    const v = view({ assignments: [{ date: "2026-09-06", seats: { chiquitos: "d1" } }] });
    const sv = seatOf(v, "2026-09-06", "chiquitos");
    expect(sv.assignedPairId).toBe("d1");
    expect(sv.options.map((o) => o.pairId)).toContain("d1");
    expect(optOf(v, "2026-09-06", "chiquitos", "d1").block)
      .toEqual({ kind: "wrong-room", room: "medianos" });
  });
});

describe("buildPlannerView — ordering", () => {
  it("puts selectable pairs first, longest-waiting first, blocked ones after", () => {
    const v = view({
      history: augustChiquitos,
      unavailable: { m3: ["2026-09-06"] }, // c2 is out
      assignments: [{ date: "2026-09-06", seats: { ensenanza: "c1" } }],
    });
    // c1 taken (enseñanza) and c2 away → selectable c3, c4 by wait; blocked c1, c2 by wait.
    expect(seatOf(v, "2026-09-06", "chiquitos").options.map((o) => o.pairId))
      .toEqual(["c3", "c4", "c1", "c2"]);
  });

  it("is deterministic: same input, identical output", () => {
    const input: PlannerViewInput = {
      ...base,
      history: augustChiquitos,
      unavailable: { m3: ["2026-09-06"] },
      assignments: [{ date: "2026-09-06", seats: { ensenanza: "c1" } }],
      worshipAssignments: { "2026-09-06": ["m5"] },
    };
    expect(buildPlannerView(input)).toEqual(buildPlannerView(input));
  });

  it("breaks a tie by pair id so equal waits never shuffle", () => {
    const v = view();
    expect(seatOf(v, "2026-09-06", "chiquitos").options.map((o) => o.pairId))
      .toEqual(["c1", "c2", "c3", "c4"]);
  });
});

describe("buildPlannerView — bench", () => {
  it("lists each room's own pairs, longest-waiting first", () => {
    const v = view({ history: augustChiquitos });
    for (const room of KIDS_ROOMS) {
      expect(v.bench[room]).toHaveLength(4);
      expect(v.bench[room].every((e) => e.room === room)).toBe(true);
    }
    expect(v.bench.chiquitos.map((e) => e.pairId)).toEqual(["c1", "c2", "c3", "c4"]);
  });

  it("marks exactly one nextUp per room", () => {
    const v = view({ history: augustChiquitos });
    for (const room of KIDS_ROOMS) {
      expect(v.bench[room].filter((e) => e.nextUp)).toHaveLength(1);
    }
    expect(v.bench.chiquitos.find((e) => e.nextUp)!.pairId).toBe("c1");
  });

  it("never marks a blocked pair nextUp — it skips to the next one who can serve", () => {
    const v = view({ history: augustChiquitos, unavailable: { m1: ["2026-09-06"] } });
    const c1 = v.bench.chiquitos.find((e) => e.pairId === "c1")!;
    expect(c1.block).toEqual({ kind: "unavailable", memberNames: ["Linnette"] });
    expect(c1.nextUp).toBe(false);
    const up = v.bench.chiquitos.filter((e) => e.nextUp);
    expect(up).toHaveLength(1);
    expect(up[0].pairId).toBe("c2");
    expect(up[0].block).toBeNull();
  });

  it("marks nobody when the whole room is blocked", () => {
    const v = view({
      unavailable: { m1: ["2026-09-06"], m3: ["2026-09-06"], m5: ["2026-09-06"], m7: ["2026-09-06"] },
    });
    expect(v.bench.chiquitos.filter((e) => e.nextUp)).toHaveLength(0);
  });

  it("is empty when there is no Sunday to anchor it to", () => {
    const v = view({ sundays: [] });
    expect(v.seats).toEqual([]);
    expect(v.bench).toEqual({ chiquitos: [], medianos: [], grandes: [] });
  });
});

describe("buildPlannerView — unfillable", () => {
  it("explains an empty seat nobody can take, in Spanish", () => {
    const out = ["2026-09-06"];
    const v = view({ unavailable: { m1: out, m3: out, m5: out, m7: out } });
    const sv = seatOf(v, "2026-09-06", "chiquitos");
    expect(sv.assignedPairId).toBeNull();
    expect(sv.unfillableReason).toBe("Sin parejas disponibles para RG Chiquitos");
    expect(sv.options).toHaveLength(4); // still shows all four, greyed
  });

  it("stays silent when the seat is empty but somebody can take it", () => {
    const v = view({ unavailable: { m1: ["2026-09-06"] } });
    expect(seatOf(v, "2026-09-06", "chiquitos").unfillableReason).toBeNull();
  });

  it("stays silent when the seat is already filled, however blocked the rest are", () => {
    const out = ["2026-09-06"];
    const v = view({
      unavailable: { m1: out, m3: out, m5: out, m7: out },
      assignments: [{ date: "2026-09-06", seats: { chiquitos: "c1" } }],
    });
    const sv = seatOf(v, "2026-09-06", "chiquitos");
    expect(sv.assignedPairId).toBe("c1");
    expect(sv.unfillableReason).toBeNull();
  });
});

describe("buildPlannerView — worship overlap", () => {
  it("names the members serving worship that Sunday without blocking them", () => {
    const v = view({ worshipAssignments: { "2026-09-06": ["m2", "m9"] } });
    const c1 = optOf(v, "2026-09-06", "chiquitos", "c1");
    expect(c1.worshipOverlap).toEqual(["Vale"]);
    expect(c1.block).toBeNull();
    expect(optOf(v, "2026-09-06", "medianos", "d1").worshipOverlap).toEqual(["Miembro 9"]);
    expect(optOf(v, "2026-09-06", "chiquitos", "c2").worshipOverlap).toEqual([]);
    // Warning only: still the room's pick.
    expect(v.bench.chiquitos.find((e) => e.nextUp)!.pairId).toBe("c1");
  });

  it("only warns on the Sunday the member serves", () => {
    const v = view({ worshipAssignments: { "2026-09-06": ["m2"] } });
    expect(optOf(v, "2026-09-13", "chiquitos", "c1").worshipOverlap).toEqual([]);
  });
});

describe("buildPlannerView — monthLoad", () => {
  it("counts every seat a pair holds this month, and zero for the untouched", () => {
    const v = view({
      assignments: [
        { date: "2026-09-06", seats: { ensenanza: "c1", chiquitos: "c2" } },
        { date: "2026-09-13", seats: { chiquitos: "c1" } },
      ],
    });
    expect(v.monthLoad.c1).toBe(2);
    expect(v.monthLoad.c2).toBe(1);
    expect(v.monthLoad.g4).toBe(0);
    expect(Object.keys(v.monthLoad)).toHaveLength(pairs.length);
  });

  it("ignores assignments outside the month window", () => {
    const v = view({
      assignments: [{ date: "2026-08-30", seats: { chiquitos: "c1" } }],
    });
    expect(v.monthLoad.c1).toBe(0);
  });
});
