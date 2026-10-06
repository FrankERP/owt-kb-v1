// Solver v3 C2 — the ledger's own unit tests: the record-free seat step (IF2-11), the
// weekday formula, X1 (IF2-12), and the ledger properties the golden fixture cannot
// carry (FX-2 keeps hundredths only): display tenths rounded from the EXACT value, an
// invalid stored `time` read as absent, the cumulative span (C2 review log: IF2-29 has
// no cumulative field, so it is asserted here), names and diagnostics, input-order
// independence and exact sum-to-zero. The golden fixture's cases run in
// `fairnessGolden.test.ts`. Every name is fictitious.
import { describe, expect, it } from "vitest";

import {
  cadenceStates,
  civilDayOfWeek,
  computeFairnessLedger,
  fairnessLedgerExactSums,
  keepVoiceSeats,
  type LedgerInput,
  type LedgerService,
} from "../fairnessLedger";
import { formatFairnessTenths } from "../fairnessFormat";
import type { LogicalRecord, RoleKey, Status } from "../fairnessVocabulary";

const OUT: Record<RoleKey, Status> = {
  "Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "out", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out",
};
type PersonPatch = Partial<Omit<LogicalRecord["people"][number], "roles">> & { roles?: Partial<Record<RoleKey, Status>> };
const person = (memberId: string, patch: PersonPatch = {}): LogicalRecord["people"][number] => ({
  memberId,
  name: memberId,
  exactRules: [],
  exempt: false,
  blocks: [],
  ...patch,
  roles: { ...OUT, ...(patch.roles ?? {}) },
});
const record = (month: string, people: LogicalRecord["people"], presence: LogicalRecord["presence"] = []): LogicalRecord => ({
  month,
  rev: `rev-${month}`,
  contentHash: "sha256:fixture",
  source: "auto",
  engine: "v3",
  environment: "production",
  recordedAt: `${month}-28T12:00:00.000Z`,
  people,
  presence,
});
const service = (_id: string, _type: LedgerService["_type"], date: string, seats: Partial<LedgerService> = {}): LedgerService => ({
  _id,
  _type,
  date,
  Lead: [],
  BGVs: [],
  Chorus: [],
  ...seats,
});

describe("keepVoiceSeats (C2 IF2-11: LG-1, LG-2, LG-4)", () => {
  const services: LedgerService[] = [
    service("sun-a", "sunday_role", "2026-10-04", { Lead: ["m-alma"], BGVs: ["m-bruno", "m-alma"], Chorus: ["m-carmen", "m-carmen"] }),
    service("drafts.sun-b", "sunday_role", "2026-10-11", { Lead: ["m-diego"] }),
    service("sat-dup-1", "saturday_role", "2026-10-10", { Lead: ["m-elena"] }),
    service("sat-dup-2", "saturday_role", "2026-10-10T00:00:00", { Lead: ["m-fausto"] }),
    service("spc-sun", "special_role", "2026-10-18", { countsForFairness: true, Lead: ["m-greta"], Chorus: ["m-ivan"] }),
    service("spc-fri", "special_role", "2026-10-23", { countsForFairness: true, Lead: ["m-julia"], BGVs: ["m-bruno"], Chorus: ["m-alma"] }),
    service("spc-legacy", "special_role", "2026-10-24", { Lead: ["m-diego"] }),
    service("sun-off", "sunday_role", "2026-10-25", { countsForFairness: false, Lead: ["m-diego"] }),
    service("sat-legacy", "saturday_role", "2026-10-31", { BGVs: ["", "m-elena"] }),
  ];

  it("keeps one seat per person per service, maps specials by day class, and reports the rest", () => {
    const out = keepVoiceSeats(services);
    expect(out.kept).toEqual([
      { serviceId: "sun-a", date: "2026-10-04", roleKey: "Sun.Lead", memberId: "m-alma" },
      { serviceId: "sun-a", date: "2026-10-04", roleKey: "Sun.BGV", memberId: "m-bruno" },
      { serviceId: "sun-a", date: "2026-10-04", roleKey: "Sun.Choir", memberId: "m-carmen" },
      { serviceId: "spc-sun", date: "2026-10-18", roleKey: "Sun.Lead", memberId: "m-greta" },
      { serviceId: "spc-sun", date: "2026-10-18", roleKey: "Sun.Choir", memberId: "m-ivan" },
      { serviceId: "spc-fri", date: "2026-10-23", roleKey: "Sat.Lead", memberId: "m-julia" },
      { serviceId: "spc-fri", date: "2026-10-23", roleKey: "Sat.BGV", memberId: "m-bruno" },
      { serviceId: "spc-fri", date: "2026-10-23", roleKey: "Sat.Choir", memberId: "m-alma" },
      { serviceId: "sat-legacy", date: "2026-10-31", roleKey: "Sat.BGV", memberId: "m-elena" },
    ]);
    expect(out.secondSeats).toEqual([
      { serviceId: "sun-a", date: "2026-10-04", roleKey: "Sun.BGV", memberId: "m-alma" },
      { serviceId: "sun-a", date: "2026-10-04", roleKey: "Sun.Choir", memberId: "m-carmen" },
    ]);
    expect(out.duplicateTargets).toEqual([{ type: "saturday_role", date: "2026-10-10", roleIds: ["sat-dup-1", "sat-dup-2"] }]);
  });

  it("is independent of input order", () => {
    expect(keepVoiceSeats([...services].reverse())).toEqual(keepVoiceSeats(services));
  });
});

describe("civilDayOfWeek (LG-4, LG-16)", () => {
  it("agrees with the calendar on every day of 2024 (leap) and 2026", () => {
    for (const year of [2024, 2026]) {
      for (let day = new Date(Date.UTC(year, 0, 1)); day.getUTCFullYear() === year; day.setUTCDate(day.getUTCDate() + 1)) {
        const iso = day.toISOString().slice(0, 10);
        expect(civilDayOfWeek(iso), iso).toBe(day.getUTCDay());
      }
    }
  });
});

describe("cadenceStates (C2 IF2-12, CAD-1)", () => {
  const month = (m: string, eligible = true, availableCountedSundays = 4) => ({ month: m, eligible, availableCountedSundays });

  it("names each reason, month 1 from the facts", () => {
    expect(cadenceStates({ ledCountedSundayPreviousMonth: false, months: [month("2026-11")] })).toEqual([
      { month: "2026-11", state: "on", reason: "on" },
    ]);
    expect(cadenceStates({ ledCountedSundayPreviousMonth: true, months: [month("2026-11")] })[0].reason).toBe("led_previous_month");
    expect(cadenceStates({ ledCountedSundayPreviousMonth: true, months: [month("2026-11", false)] })[0].reason).toBe("not_eligible");
    expect(cadenceStates({ ledCountedSundayPreviousMonth: false, months: [month("2026-11", true, 0)] })[0].reason).toBe(
      "no_available_sunday",
    );
  });

  it("month 2 assumes month 1 followed its own state", () => {
    expect(cadenceStates({ ledCountedSundayPreviousMonth: false, months: [month("2026-11"), month("2026-12")] })).toEqual([
      { month: "2026-11", state: "on", reason: "on" },
      { month: "2026-12", state: "off", reason: "assumed_led_previous_month" },
    ]);
    expect(cadenceStates({ ledCountedSundayPreviousMonth: true, months: [month("2026-11"), month("2026-12")] })).toEqual([
      { month: "2026-11", state: "off", reason: "led_previous_month" },
      { month: "2026-12", state: "on", reason: "on" },
    ]);
  });

  it("takes 1 or 2 months only", () => {
    expect(() => cadenceStates({ ledCountedSundayPreviousMonth: false, months: [] })).toThrow(RangeError);
  });
});

describe("computeFairnessLedger — properties outside the fixture", () => {
  it("rounds the display tenths once from the EXACT value, never from the hundredths (LG-13, A17)", () => {
    // Carmen's exact BGV share is 1/5 + 1/21 = 26/105 ≈ 0.2476: 25 hundredths, but 2 tenths —
    // tenths taken from the hundredths would show «0.3».
    const ids = Array.from({ length: 21 }, (_, i) => `m-${String(i).padStart(2, "0")}`);
    const people = ids.map((id) =>
      person(id, {
        roles: { "Sun.BGV": "in" },
        exempt: id === "m-00",
        blocks: Number(id.slice(2)) >= 5 ? [{ date: "2026-10-04", unavailable: true, excludedRoles: [] }] : [],
      }),
    );
    const out = computeFairnessLedger({
      target: "2026-11",
      records: [record("2026-10", people)],
      services: [
        service("s1", "sunday_role", "2026-10-04", { BGVs: ["m-00"] }),
        service("s2", "sunday_role", "2026-10-11", { BGVs: ["m-00"] }),
      ],
      members: [],
    });
    const carmen = out.people.find((p) => p.memberId === "m-01")!;
    expect(carmen.window.BGV).toEqual({ share: 25, received: 0, balance: 25, seats: 0, tenths: { share: 2, balance: 2 } });
    expect(formatFairnessTenths(carmen.window.BGV!.tenths.share)).toBe("0.2");
  });

  it("reads an invalid stored time as absent at the floor's time tie (LG-11, vitest-only per FX-4)", () => {
    // Two counted Friday specials on one date; Alma leads both. «7pm» is not a service time,
    // so it sorts after «19:00»: the timed special's seat is her floor seat, though its id is later.
    const people = ["m-alma", "m-bruno", "m-carmen", "m-diego"].map((id) => person(id, { roles: { "Sat.Lead": "in" } }));
    const out = computeFairnessLedger({
      target: "2026-11",
      records: [record("2026-10", people)],
      services: [
        service("spc-a", "special_role", "2026-10-09", { countsForFairness: true, time: "7pm", Lead: ["m-alma"] }),
        service("spc-b", "special_role", "2026-10-09", { countsForFairness: true, time: "19:00", Lead: ["m-alma"] }),
      ],
      members: [],
    });
    const alma = out.people.find((p) => p.memberId === "m-alma")!;
    expect(alma.months[2].setAsides).toEqual([{ date: "2026-10-09", serviceId: "spc-b", roleKey: "Sat.Lead", reason: "floor" }]);
  });

  it("lists one countedSundayLeads entry per counted Sunday-dated Lead seat, repeating a date (RD-3, S-4)", () => {
    const out = computeFairnessLedger({
      target: "2026-11",
      records: [],
      services: [
        service("sun-1", "sunday_role", "2026-10-04", { Lead: ["m-alma", "m-alma"] }),
        service("spc-1", "special_role", "2026-10-04", { countsForFairness: true, Lead: ["m-alma"] }),
        service("spc-2", "special_role", "2026-10-11", { Lead: ["m-alma"] }),
      ],
      members: [],
    });
    expect(out.people.find((p) => p.memberId === "m-alma")!.countedSundayLeads).toEqual(["2026-10-04", "2026-10-04"]);
  });

  it("names deleted members from the latest record, else empty, and lists them as unknown (IF2-8)", () => {
    const out = computeFairnessLedger({
      target: "2026-11",
      records: [record("2026-09", [person("m-gone", { name: "Elena Vieja" })]), record("2026-10", [person("m-gone", { name: "Elena" })])],
      services: [service("sun-1", "sunday_role", "2026-10-04", { Chorus: ["m-ghost", "m-here"] })],
      members: [{ id: "m-here", name: "Fausto", unavailableDates: [] }],
    });
    expect(out.people.map((p) => [p.memberId, p.name, p.exists])).toEqual([
      ["m-ghost", "", false],
      ["m-gone", "Elena", false],
      ["m-here", "Fausto", true],
    ]);
    expect(out.diagnostics.unknownMembers).toEqual(["m-ghost", "m-gone"]);
    expect(out.diagnostics.notInRecordSeats).toBe(2);
  });

  // Each recorded month: two Sunday services, 2 BGV seats each among Alma, Bruno and Carmen
  // (shares 4/3 each, no floor). Alma sits both Sundays, Bruno and Carmen one each.
  function monthly(month: string): { rec: LogicalRecord; services: LedgerService[] } {
    return {
      rec: record(month, ["m-alma", "m-bruno", "m-carmen"].map((id) => person(id, { roles: { "Sun.BGV": "in" } }))),
      services: [
        service(`${month}-s1`, "sunday_role", `${month}-07`, { BGVs: ["m-alma", "m-bruno"] }),
        service(`${month}-s2`, "sunday_role", `${month}-14`, { BGVs: ["m-alma", "m-carmen"] }),
      ],
    };
  }
  const SPAN: LedgerInput = (() => {
    const months = ["2026-05", "2026-06", "2026-07", "2026-08"].map(monthly);
    return { target: "2026-09", records: months.map((m) => m.rec), services: months.flatMap((m) => m.services), members: [] };
  })();

  it("sums the cumulative span from the earliest record, longer than the window (X4, LG-12)", () => {
    const out = computeFairnessLedger(SPAN);
    expect(out.recordsSince).toBe("2026-05");
    expect(out.window.map((w) => [w.month, w.record?.rev ?? null])).toEqual([
      ["2026-06", "rev-2026-06"],
      ["2026-07", "rev-2026-07"],
      ["2026-08", "rev-2026-08"],
    ]);
    const alma = out.people.find((p) => p.memberId === "m-alma")!;
    // Window: 3 × 4/3 = 4 → 400; 6 seats. Cumulative: 4 × 4/3 = 16/3 → 533; 8 seats; −8/3 → −27 tenths.
    expect(alma.window.BGV).toEqual({ share: 400, received: 600, balance: -200, seats: 6, tenths: { share: 40, balance: -20 } });
    expect(alma.cumulative.BGV).toEqual({ share: 533, received: 800, balance: -267, seats: 8, tenths: { share: 53, balance: -27 } });
    expect(alma.tabs.cumulative.TOTAL).toEqual(alma.cumulative.BGV);
    expect(alma.sang).toBe(6);
  });

  it("is independent of input order (LG-16)", () => {
    const reversed: LedgerInput = {
      ...SPAN,
      records: [...SPAN.records].reverse().map((r) => ({ ...r, people: [...r.people].reverse() })),
      services: [...SPAN.services].reverse(),
    };
    expect(computeFairnessLedger(reversed)).toEqual(computeFairnessLedger(SPAN));
  });

  it("sums to exactly zero per (service, role key) on exact values (LG-10)", () => {
    const sums = fairnessLedgerExactSums(SPAN);
    expect(sums.length).toBe(4 * 2 * 3);
    for (const s of sums) expect(s.numerator, `${s.serviceId} ${s.key}`).toBe("0");
  });
});
