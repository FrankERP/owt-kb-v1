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
  it("lists each room's own pairs as unplaced, longest-waiting first", () => {
    const v = view({ history: augustChiquitos });
    for (const room of KIDS_ROOMS) {
      expect(v.bench[room].disponibles).toHaveLength(4);
      expect(v.bench[room].colocadas).toEqual([]);
      expect(v.bench[room].disponibles.every((e) => e.room === room)).toBe(true);
    }
    expect(v.bench.chiquitos.disponibles.map((e) => e.pairId)).toEqual(["c1", "c2", "c3", "c4"]);
  });

  /**
   * The bug this split exists for: the bench used to be measured at the FIRST
   * Sunday, so a pair the generator placed on any later one still read as free.
   */
  it("moves a pair to «ya en el mes» for ANY Sunday of the window, not just the first", () => {
    const v = view({
      history: augustChiquitos,
      assignments: [{ date: "2026-09-27", seats: { chiquitos: "c1" } }],
    });
    expect(v.bench.chiquitos.disponibles.map((e) => e.pairId)).toEqual(["c2", "c3", "c4"]);
    expect(v.bench.chiquitos.colocadas.map((e) => e.pairId)).toEqual(["c1"]);
    expect(v.bench.chiquitos.colocadas[0].monthSeats).toEqual([
      { date: "2026-09-27", seat: "chiquitos" },
    ]);
  });

  it("counts an enseñanza turn as placed — the pair is busy that Sunday either way", () => {
    const v = view({ assignments: [{ date: "2026-09-13", seats: { ensenanza: "c2" } }] });
    expect(v.bench.chiquitos.colocadas.map((e) => e.pairId)).toEqual(["c2"]);
    expect(v.bench.chiquitos.disponibles.map((e) => e.pairId)).toEqual(["c1", "c3", "c4"]);
  });

  it("names every seat a pair holds, in Sunday order", () => {
    const v = view({
      assignments: [
        { date: "2026-09-20", seats: { chiquitos: "c1" } },
        { date: "2026-09-06", seats: { ensenanza: "c1" } },
      ],
    });
    expect(v.bench.chiquitos.colocadas[0].monthSeats).toEqual([
      { date: "2026-09-06", seat: "ensenanza" },
      { date: "2026-09-20", seat: "chiquitos" },
    ]);
  });

  /**
   * The second half of the same bug: a Sunday-1 absence used to set a `block`
   * that made the chip un-draggable for the WHOLE month. Absence is a month fact
   * here; the drop is what validates a day, against the target seat's own view.
   */
  it("counts the Sundays a pair is away without blocking it", () => {
    const v = view({ unavailable: { m1: ["2026-09-06", "2026-09-20"] } });
    const c1 = v.bench.chiquitos.disponibles.find((e) => e.pairId === "c1")!;
    expect(c1.block).toBeNull();
    expect(c1.unavailableSundays).toBe(2);
    expect(v.bench.chiquitos.disponibles.find((e) => e.pairId === "c2")!.unavailableSundays).toBe(0);
  });

  /**
   * Away on EVERY Sunday is month-invariant, so it BLOCKS: no drop can succeed,
   * and the room's real next pair must not lose "le toca" to one that cannot
   * serve at all. The first cut of the month-scoped bench got this wrong — it
   * blocked only on `retired` — and recommended the pair that was away all month.
   */
  it("blocks a pair away every Sunday, and never calls it next up", () => {
    const v = view({ history: augustChiquitos, unavailable: { m1: sundays } });
    const c1 = v.bench.chiquitos.disponibles.find((e) => e.pairId === "c1")!;
    expect(c1.unavailableSundays).toBe(4);
    expect(c1.block).toEqual({ kind: "away-all-month" });
    expect(c1.nextUp).toBe(false);
    // c1 is the longest-waiting pair in the room; the turn passes to the next one.
    expect(v.bench.chiquitos.disponibles.find((e) => e.nextUp)!.pairId).toBe("c2");
  });

  it("leaves a partial absence unblocked — that is a count, not a refusal", () => {
    const v = view({ unavailable: { m1: sundays.slice(0, 3) } });
    const c1 = v.bench.chiquitos.disponibles.find((e) => e.pairId === "c1")!;
    expect(c1.unavailableSundays).toBe(3);
    expect(c1.block).toBeNull();
  });

  it("keeps a retired pair visible, blocked and last", () => {
    const retired = pairs.map((p) => (p.id === "c1" ? { ...p, active: false } : p));
    const v = view({ pairs: retired, history: augustChiquitos });
    const ids = v.bench.chiquitos.disponibles.map((e) => e.pairId);
    expect(ids).toEqual(["c2", "c3", "c4", "c1"]);
    expect(v.bench.chiquitos.disponibles.at(-1)!.block).toEqual({ kind: "retired" });
  });

  it("marks nextUp on the longest-waiting pair still to place", () => {
    const v = view({ history: augustChiquitos });
    for (const room of KIDS_ROOMS) {
      expect(v.bench[room].disponibles.filter((e) => e.nextUp)).toHaveLength(1);
    }
    expect(v.bench.chiquitos.disponibles.find((e) => e.nextUp)!.pairId).toBe("c1");
  });

  it("passes nextUp to the next pair once the first one is placed", () => {
    const v = view({
      history: augustChiquitos,
      assignments: [{ date: "2026-09-06", seats: { chiquitos: "c1" } }],
    });
    expect(v.bench.chiquitos.disponibles.find((e) => e.nextUp)!.pairId).toBe("c2");
    expect(v.bench.chiquitos.colocadas.some((e) => e.nextUp)).toBe(false);
  });

  it("marks nobody when the whole room is already in the month", () => {
    const v = view({
      assignments: sundays.map((date, i) => ({
        date,
        seats: { chiquitos: ["c1", "c2", "c3", "c4"][i] },
      })),
    });
    expect(v.bench.chiquitos.disponibles).toEqual([]);
    expect(v.bench.chiquitos.colocadas.filter((e) => e.nextUp)).toHaveLength(0);
  });

  it("is empty when there is no Sunday to place anyone on", () => {
    const v = view({ sundays: [] });
    expect(v.seats).toEqual([]);
    expect(v.bench).toEqual({
      chiquitos: { disponibles: [], colocadas: [] },
      medianos: { disponibles: [], colocadas: [] },
      grandes: { disponibles: [], colocadas: [] },
    });
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
  });

  it("keeps the overlap OFF the bench, which is month-scoped and cannot mean it", () => {
    const v = view({ worshipAssignments: { "2026-09-06": ["m2", "m9"] } });
    expect(v.bench.chiquitos.disponibles.every((e) => e.worshipOverlap.length === 0)).toBe(true);
    // Warning only, and it never was a block: c1 is still the room's pick.
    expect(v.bench.chiquitos.disponibles.find((e) => e.nextUp)!.pairId).toBe("c1");
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
