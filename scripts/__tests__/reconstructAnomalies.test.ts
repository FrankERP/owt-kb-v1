// Solver v3 C4 R7, R11 (the balance preview) and R13 — every anomaly the transform does
// not emit, and the ledger runs behind the table — over C2's REAL ledger (IF2-10) and
// seat step (IF2-11). Every name is fictitious.
import { describe, expect, it } from "vitest";

import { saldoWords } from "@/app/utils/fairnessFormat";
import { fairnessLedgerExactSums, type LedgerService } from "@/app/utils/fairnessLedger";
import type { FairnessMonthBody, RoleKey, Status } from "@/app/utils/fairnessVocabulary";
import { joinAnomalies, lostBlocks, monthAnomalies, poolAnomalies, sortAnomalies } from "../lib/reconstructAnomalies";
import { seatJoinMonths } from "../lib/reconstructInference";
import { ledgerMembers, monthLedger, plannedLogicalRecord, previewFigures, previewWindow, seatsPerLine } from "../lib/reconstructPreview";
import type { Anomaly, RosterRow } from "../lib/reconstructTypes";

const OUT: Record<RoleKey, Status> = {
  "Sun.Lead": "out",
  "Sat.Lead": "out",
  "Sun.BGV": "out",
  "Sat.BGV": "out",
  "Sun.Choir": "out",
  "Sat.Choir": "out",
};
const ROSTER: RosterRow[] = [
  { _id: "kidsMember-dani", member_name: "Dani Ejemplo", alias: "Dani E.", memberType: ["voz", "sunday_lead"] },
  { _id: "m-ana", member_name: "Ana Ejemplo", alias: "Ana E.", memberType: ["voz", "sunday_lead"] },
  { _id: "m-beto", member_name: "Beto Ejemplo", alias: "Beto E.", memberType: ["voz", "sunday_lead"] },
  { _id: "m-carla", member_name: "Carla Ejemplo", alias: "Carla E.", memberType: ["voz", "support"], unavailableDates: ["2026-08-16"] },
  { _id: "m-ivan", member_name: "Iván Ejemplo", alias: "Iván E.", memberType: ["voz", "saturday_lead"] },
];
const ROSTER_IDS = new Set(ROSTER.map((m) => m._id));
const NAMES = new Map(ROSTER.map((m) => [m._id, m.alias ?? m.member_name]));
const MEMBERS = ledgerMembers(ROSTER);
const ORDINAL = (ruleKey: string) => (ruleKey === "d-beto-carla" ? "presencia 1 de 1" : undefined);

const svc = (
  id: string,
  type: LedgerService["_type"],
  date: string,
  seats: Partial<Pick<LedgerService, "Lead" | "BGVs" | "Chorus">>,
  extra: Partial<LedgerService> = {},
): LedgerService => ({ _id: id, _type: type, date, Lead: [], BGVs: [], Chorus: [], ...seats, ...extra });
const item = (memberId: string, roles: Partial<Record<RoleKey, Status>>, extra: Partial<FairnessMonthBody["people"][number]> = {}) => ({
  memberId,
  roles: { ...OUT, ...roles },
  exactRules: [],
  exempt: false,
  blocks: [],
  ...extra,
});

const AUGUST: FairnessMonthBody = {
  month: "2026-08",
  people: [
    item("kidsMember-dani", { "Sun.Lead": "in" }, { sundayCadence: "alternate" }),
    item("m-ana", { "Sun.Lead": "in", "Sun.BGV": "in", "Sun.Choir": "in" }),
    item("m-beto", { "Sun.BGV": "exact" }, { exactRules: [{ roles: ["Sun.BGV"], count: 1 }] }),
    item("m-carla", { "Sun.BGV": "in" }, { blocks: [{ date: "2026-08-16", unavailable: true, excludedRoles: [] }] }),
    item("m-ivan", { "Sat.Lead": "in" }, { blocks: [{ date: "2026-08-08", unavailable: false, excludedRoles: ["Sat.Lead", "Sat.BGV", "Sat.Choir"] }] }),
  ],
  presence: [{ ruleKey: "d-beto-carla", roles: ["Sun.BGV"], members: ["m-beto", "m-carla"], exclusive: false }],
};
const SERVICES: LedgerService[] = [
  svc("sat-0801", "saturday_role", "2026-08-01", { Lead: ["m-ivan"], BGVs: ["m-ana"] }),
  svc("sun-0802", "sunday_role", "2026-08-02", { Lead: ["m-ana"], BGVs: ["m-julia"] }),
  svc("sat-0808", "saturday_role", "2026-08-08", { Lead: ["m-ivan"] }),
  svc("spe-0808", "special_role", "2026-08-08", { Lead: ["m-ivan"] }, { countsForFairness: true }),
  svc("sun-0809a", "sunday_role", "2026-08-09", { Lead: ["m-ana"] }),
  svc("sun-0809b", "sunday_role", "2026-08-09", {}),
  svc("sun-0816", "sunday_role", "2026-08-16", { Lead: ["m-ana"], BGVs: ["m-carla"], Chorus: ["m-ana"] }),
  svc("sat-0822", "saturday_role", "2026-08-22", { Lead: ["m-ivan"] }),
];
const RECORD = plannedLogicalRecord(AUGUST, "sha256:planned", "local", NAMES);
const LEDGER = monthLedger("2026-08", RECORD, SERVICES, MEMBERS);

describe("the month's anomalies (R7, R13)", () => {
  it("lists every seat, rule, presence and roster anomaly the month has — and nothing else", () => {
    const expected: Anomaly[] = [
      { code: "seat_while_out", month: "2026-08", memberId: "m-ana", date: "2026-08-01", roleKey: "Sat.BGV", serviceId: "sat-0801" },
      { code: "seat_unavailable", month: "2026-08", memberId: "m-carla", date: "2026-08-16", roleKey: "Sun.BGV", serviceId: "sun-0816" },
      { code: "seat_rule_excluded", month: "2026-08", memberId: "m-ivan", date: "2026-08-08", roleKey: "Sat.Lead", serviceId: "sat-0808" },
      { code: "exact_mismatch", month: "2026-08", memberId: "m-beto", roles: ["Sun.BGV"], count: 1, held: 0 },
      { code: "presence_no_seat", month: "2026-08", ruleKey: "d-beto-carla", ruleOrdinal: "presencia 1 de 1", date: "2026-08-02", serviceId: "sun-0802" },
      { code: "presence_outside", month: "2026-08", ruleKey: "d-beto-carla", ruleOrdinal: "presencia 1 de 1", memberId: "m-carla", dates: ["2026-08-16"] },
      { code: "member_gone", month: "2026-08", memberId: "m-julia" },
      { code: "duplicate_target", month: "2026-08", type: "sunday_role", date: "2026-08-09", roleIds: ["sun-0809a", "sun-0809b"] },
      { code: "second_seat", month: "2026-08", memberId: "m-ana", date: "2026-08-16", roleKey: "Sun.Choir", serviceId: "sun-0816" },
    ];
    const found = sortAnomalies(
      monthAnomalies({ month: "2026-08", record: AUGUST, services: SERVICES, ledger: LEDGER, rosterIds: ROSTER_IDS, presenceOrdinal: ORDINAL }),
    );
    expect(found).toEqual(sortAnomalies(expected));
  });

  it("never treats a week exclusion as binding at a special (A13)", () => {
    const anomalies = monthAnomalies({ month: "2026-08", record: AUGUST, services: SERVICES, ledger: LEDGER, rosterIds: ROSTER_IDS, presenceOrdinal: ORDINAL });
    expect(anomalies.filter((a) => a.serviceId === "spe-0808")).toEqual([]);
  });

  it("lists a cadence setting on someone not in for Sun.Lead", () => {
    const record: FairnessMonthBody = { month: "2026-08", people: [item("kidsMember-dani", {}, { sundayCadence: "alternate" })], presence: [] };
    const ledger = monthLedger("2026-08", plannedLogicalRecord(record, "sha256:x", "local", NAMES), [], MEMBERS);
    expect(monthAnomalies({ month: "2026-08", record, services: [], ledger, rosterIds: ROSTER_IDS, presenceOrdinal: ORDINAL })).toEqual([
      { code: "cadence_not_in", month: "2026-08", memberId: "kidsMember-dani" },
    ]);
  });
});

describe("the pool anomalies (R13)", () => {
  const body = (people: FairnessMonthBody["people"]): FairnessMonthBody => ({ month: "2026-08", people, presence: [] });
  const hypothetical = new Map([
    ["2026-08", body([item("kidsMember-dani", { "Sun.Lead": "in", "Sat.Lead": "in" }), item("m-ana", { "Sun.Lead": "in" }), item("m-carla", { "Sun.BGV": "in" })])],
  ]);
  const actual = new Map([
    ["2026-08", body([item("kidsMember-dani", { "Sun.Lead": "in", "Sat.Lead": "in" }), item("m-ana", { "Sun.Lead": "in" }), item("m-carla", {})])],
  ]);
  const seatJoins = seatJoinMonths([svc("sun-0705", "sunday_role", "2026-07-05", { Lead: ["m-ana"] })]);
  const cadenceIds = new Set(["kidsMember-dani"]);

  it("lists «not ticked today» and «ticked today, never seated» — never a cadence member's DL", () => {
    expect(sortAnomalies(poolAnomalies({ months: ["2026-08"], hypothetical, actual, seatJoins, overrides: [], cadenceIds }))).toEqual(
      sortAnomalies([
        { code: "not_ticked_today", month: null, memberId: "m-carla", line: "BGV", months: ["2026-08"] },
        { code: "ticked_never_seated", month: null, memberId: "kidsMember-dani", line: "SL", months: ["2026-08"] },
      ]),
    );
  });

  it("drops «ticked today, never seated» once a correction gives that line a join month", () => {
    const overrides = [
      { ordinal: 1, memberId: "kidsMember-dani", note: null, exempt: null, sundayCadence: null, joinMonths: { SL: "2026-08" }, blockedDates: [], months: {} },
    ];
    const anomalies = poolAnomalies({ months: ["2026-08"], hypothetical, actual, seatJoins, overrides, cadenceIds });
    expect(anomalies.some((a) => a.code === "ticked_never_seated")).toBe(false);
  });
});

describe("the join and lost-date anomalies (R13)", () => {
  it("flags a first seat that is not the line's first counted service of the month; never a cadence member's DL", () => {
    const joinWindow = [
      svc("sun-0906", "sunday_role", "2026-09-06", { Lead: ["m-ana"] }),
      svc("sun-0913", "sunday_role", "2026-09-13", { Lead: ["kidsMember-dani"], BGVs: ["m-carla"] }),
    ];
    const resolverIds = new Map([["2026-09", new Set(["kidsMember-dani", "m-ana", "m-carla"])]]);
    expect(
      joinAnomalies({ months: ["2026-09"], seatJoins: seatJoinMonths(joinWindow), joinWindow, resolverIds, overrides: [], cadenceIds: new Set(["kidsMember-dani"]) }),
    ).toEqual([{ code: "join_mid_month", month: "2026-09", memberId: "m-carla", line: "BGV", date: "2026-09-13", firstServiceDate: "2026-09-06" }]);
  });

  it("lists a blocked date a replace would drop", () => {
    const existing = plannedLogicalRecord(
      { month: "2026-07", people: [item("m-ana", { "Sun.Lead": "in" }, { blocks: [{ date: "2026-07-12", unavailable: true, excludedRoles: [] }] })], presence: [] },
      "sha256:old",
      "local",
      NAMES,
    );
    const planned: FairnessMonthBody = { month: "2026-07", people: [item("m-ana", { "Sun.Lead": "in" })], presence: [] };
    expect(lostBlocks("2026-07", existing, planned)).toEqual([{ code: "lost_block", month: "2026-07", memberId: "m-ana", date: "2026-07-12" }]);
  });
});

describe("the ledger runs (R11)", () => {
  it("takes the preview window as the three months before the run", () => {
    expect(previewWindow("2026-10")).toEqual(["2026-07", "2026-08", "2026-09"]);
  });

  it("states its placeholders on an in-memory planned record", () => {
    expect(RECORD).toMatchObject({ month: "2026-08", rev: "planned", recordedAt: "planned", contentHash: "sha256:planned", source: "reconstructed", engine: "v2" });
    expect(RECORD.people.find((p) => p.memberId === "m-ana")?.name).toBe("Ana E.");
  });

  it("counts seats per line from the ledger's integer `held`, second seats included", () => {
    const seats = seatsPerLine(LEDGER, "2026-08");
    expect(seats.get("m-ana")).toEqual({ DL: 2, BGV: 1, CORO: 1 });
    expect(seats.get("m-ivan")).toEqual({ SL: 4 });
  });

  it("gives a cadence member no DL debt, and balances that sum to zero per service and role", () => {
    const { result, figures } = previewFigures({ run: "2026-09", records: [RECORD], services: SERVICES, members: MEMBERS });
    const dani = result.people.find((p) => p.memberId === "kidsMember-dani");
    expect(dani).toBeDefined();
    expect(saldoWords(dani?.tabs.window.DL?.tenths.balance ?? 0)).toBe("al día");
    expect(figures["kidsMember-dani"]?.DL?.balance ?? 0).toBe(0);
    const sums = fairnessLedgerExactSums({ target: "2026-09", records: [RECORD], services: SERVICES, members: MEMBERS });
    expect(sums.length).toBeGreaterThan(0);
    expect(sums.every((s) => s.numerator === "0")).toBe(true);
  });
});
