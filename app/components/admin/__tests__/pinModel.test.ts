// app/components/admin/__tests__/pinModel.test.ts
import { describe, expect, it } from "vitest";

import type { SolveResponse } from "@/app/api/admin/solve/route";
import type { RankMember } from "../candidateRanking";
import { buildColumns, buildRows, createColumnId, type GridCell } from "../plannerModel";
import {
  PINNED_CAP,
  collectPins,
  dayLabel,
  droppedPinNotices,
  emptyVoiceSeats,
  pinConflicts,
  pinHandshakeHolds,
  pinRefusal,
  pinSeatKey,
  seatLabel,
  serviceDayLabel,
  type Pin,
} from "../pinModel";

const SUNDAYS = ["2026-03-01", "2026-03-08", "2026-03-15", "2026-03-22", "2026-03-29"];
const TIPO = ["voz", "sunday_lead", "saturday_lead", "support"];
const m = (id: string, member_name: string, alias?: string, extra: Partial<RankMember> = {}): RankMember =>
  ({ _id: id, member_name, alias, memberType: TIPO, ...extra } as RankMember);

const ANA = m("ana", "Ana Karen Villalobos", "Ana");
const BETO = m("beto", "Alberto Ruiz Cano", "Beto");
const LU = m("lu", "María Lucía Estrada", "Lucía");
const members = [ANA, BETO, LU];
const rows = buildRows();
// Sundays 1 and 8 March, Saturday 7 March (week 2's), and a special on Wed 4 March.
const columns = buildColumns({
  sundayDates: SUNDAYS.slice(0, 2),
  activeSatDates: ["2026-03-07"],
  specials: [{ date: "2026-03-04", name: "Vigilia" }],
});
const SUN1 = createColumnId("sunday_role", "2026-03-01");
const SAT2 = createColumnId("saturday_role", "2026-03-07");
const SUN2 = createColumnId("sunday_role", "2026-03-08");
const SPECIAL = createColumnId("special_role", "2026-03-04");

const cell = (columnId: string, rowId: string, ids: string[], extra: Partial<GridCell> = {}): GridCell => ({
  columnId, rowId, occupants: ids.map((memberId) => ({ memberId })), origin: "manual", ...extra,
});
const collect = (cells: GridCell[], who = members) =>
  collectPins({ cells, columns, rows, members: who, sundayDates: SUNDAYS });

describe("labels", () => {
  it("writes dates the way the grid headers read, without Intl", () => {
    expect(dayLabel("2026-10-04")).toBe("4 oct");
    expect(serviceDayLabel("saturday_role", "2026-10-31")).toBe("sábado 31 oct");
    expect(seatLabel({ columnId: SUN1, rowId: "coro" }, columns, rows)).toBe("Coro del domingo 1 mar");
  });
});

describe("collectPins", () => {
  it("pins every occupied voice seat on a column Auto writes, never a special, an instrument or FOH", () => {
    const got = collect([
      cell(SUN1, "lead", ["ana"]),
      cell(SUN1, "coro", ["lu"], { origin: "auto" }),
      cell(SAT2, "bgv", ["beto"]),
      cell(SPECIAL, "lead", ["beto"]),
      cell(SUN1, "instrumento:Drums", ["beto"]),
      cell(SUN1, "foh:Console", ["lu"]),
    ]);
    expect(got.pins).toEqual<Pin[]>([
      { week: 1, role: "Sun.Lead", person: "Ana Karen Villalobos" },
      { week: 1, role: "Sun.Choir", person: "María Lucía Estrada" },
      { week: 2, role: "Sat.BGV", person: "Alberto Ruiz Cano" },
    ]);
    expect([...got.pinnedCellKeys]).toEqual([`${SUN1}|lead`, `${SUN1}|coro`, `${SAT2}|bgv`]);
    expect(got.dropped).toEqual([]);
  });

  it("keeps ONE seat per person per service — Lead before BGV before Coro, then occupant order — and reports the rest", () => {
    // The solver REFUSES two different pins for one person in one service (parse_pins).
    const got = collect([
      cell(SUN2, "coro", ["ana"]),
      cell(SUN2, "bgv", ["ana", "beto"]),
      cell(SUN2, "lead", ["beto", "beto"]), // one member twice in one cell (DD10)
    ]);
    expect(got.pins).toEqual<Pin[]>([
      { week: 2, role: "Sun.Lead", person: "Alberto Ruiz Cano" },
      { week: 2, role: "Sun.BGV", person: "Ana Karen Villalobos" },
    ]);
    expect(got.dropped.map((d) => [d.rowId, d.memberId, d.occurrence, d.kept.rowId])).toEqual([
      ["lead", "beto", 1, "lead"],
      ["bgv", "beto", 0, "lead"],
      ["coro", "ana", 0, "bgv"],
    ]);
  });

  it("lets the same person hold the Saturday and the Sunday of one week — two services", () => {
    const got = collect([cell(SAT2, "lead", ["ana"]), cell(SUN2, "lead", ["ana"])]);
    expect(got.pins.map((p) => p.role)).toEqual(["Sat.Lead", "Sun.Lead"]);
  });

  it("sets aside an occupant who resolves to no member, and one whose member_name is empty", () => {
    const got = collect([cell(SUN1, "lead", ["ghost"]), cell(SUN1, "bgv", ["lu"])], [ANA, BETO, { ...LU, member_name: "  " }]);
    expect(got.pins).toEqual([]);
    expect(got.unresolved).toEqual([{ columnId: SUN1, rowId: "lead", memberId: "ghost", occurrence: 0 }]);
    expect(got.unnamed).toEqual([{ columnId: SUN1, rowId: "bgv", memberId: "lu", occurrence: 0 }]);
  });
});

describe("pinRefusal", () => {
  const base = { columns, rows, members, weekendsWithSaturday: [2], poolNames: members.map((x) => x.member_name) };

  it("is null for a clean board", () => {
    expect(pinRefusal({ ...base, collected: collect([cell(SUN1, "lead", ["ana"])]) })).toBeNull();
  });

  it("names the cell of an occupant who is no longer a member", () => {
    expect(pinRefusal({ ...base, collected: collect([cell(SUN1, "lead", ["ghost"])]) })).toBe(
      "No se puede usar «Solo llenar vacíos»: en Lead del domingo 1 mar hay alguien que ya no está en la lista de miembros. Quítalo de ese lugar y vuelve a intentarlo.",
    );
  });

  it("names the cell of a member with no member_name", () => {
    const who = [ANA, BETO, { ...LU, member_name: "" }];
    expect(pinRefusal({ ...base, members: who, collected: collect([cell(SUN1, "bgv", ["lu"])], who) })).toBe(
      "No se puede usar «Solo llenar vacíos»: Lucía (en BGV del domingo 1 mar) no tiene nombre en su ficha. Complétalo en Miembros o quítalo de ese lugar.",
    );
  });

  it("refuses more than PINNED_CAP distinct pins rather than dropping any", () => {
    const many = Array.from({ length: PINNED_CAP + 1 }, (_, i) => m(`p${i}`, `Persona ${i}`));
    const cols = buildColumns({ sundayDates: SUNDAYS, activeSatDates: [], specials: [] });
    const cells = cols.flatMap((c, w) => [cell(c.columnId, "coro", many.slice(w * 21, w * 21 + 21).map((x) => x._id))]);
    const collected = collectPins({ cells, columns: cols, rows, members: many, sundayDates: SUNDAYS });
    expect(collected.pins.length).toBe(PINNED_CAP + 1);
    expect(pinRefusal({ ...base, columns: cols, members: many, collected })).toBe(
      "No se puede usar «Solo llenar vacíos»: hay 101 lugares de voz ocupados y el solver acepta hasta 100. Borra algunos o apaga «Solo llenar vacíos».",
    );
  });

  it("refuses a Saturday pin on a week the request does not send", () => {
    expect(pinRefusal({ ...base, weekendsWithSaturday: [], collected: collect([cell(SAT2, "lead", ["ana"])]) })).toBe(
      "No se puede usar «Solo llenar vacíos»: Lead del sábado 7 mar no se envía al solver este mes. Quítalo de ese lugar o apaga «Solo llenar vacíos».",
    );
  });

  it("refuses a pinned-only spelling that differs from a pool name only in case or spaces", () => {
    const hugo = m("hugo2", " hugo villa", "Hugo 2");
    const who = [...members, hugo];
    expect(pinRefusal({
      ...base, members: who, poolNames: [...base.poolNames, "Hugo Villa"],
      collected: collect([cell(SUN1, "lead", ["hugo2"])], who),
    })).toBe(
      "No se puede usar «Solo llenar vacíos»: « hugo villa» (en Lead del domingo 1 mar) solo se distingue de «Hugo Villa» por mayúsculas o espacios, y el solver no puede saber cuál es cuál. Corrige el nombre en Miembros.",
    );
    // A pin on a pool member's exact name is always fine, whatever its spelling.
    expect(pinRefusal({
      ...base, members: who, poolNames: [...base.poolNames, " hugo villa"],
      collected: collect([cell(SUN1, "lead", ["hugo2"])], who),
    })).toBeNull();
  });
});

describe("pinHandshakeHolds", () => {
  const pins: Pin[] = [
    { week: 1, role: "Sun.Lead", person: "Ana Karen Villalobos" },
    { week: 2, role: "Sat.BGV", person: "Alberto Ruiz Cano" },
  ];
  const good: SolveResponse = {
    ok: true,
    pinned_honored: 2,
    schedule: {
      "1": { Sunday: { Lead: ["Ana Karen Villalobos"], BGV: [], Choir: [] } },
      "2": { Sunday: { Lead: [], BGV: [], Choir: [] }, Saturday: { Lead: [], BGV: ["Alberto Ruiz Cano"] } },
    },
  };

  it("holds when the count matches and every pin is in the schedule by exact name", () => {
    expect(pinHandshakeHolds(good, pins)).toBe(true);
  });

  it("fails on a missing pinned_honored, a short count, or a name the schedule lacks", () => {
    expect(pinHandshakeHolds({ ...good, pinned_honored: undefined }, pins)).toBe(false);
    expect(pinHandshakeHolds({ ...good, pinned_honored: 1 }, pins)).toBe(false);
    expect(pinHandshakeHolds({
      ...good,
      schedule: { ...good.schedule, "1": { Sunday: { Lead: ["ana karen villalobos"], BGV: [], Choir: [] } } },
    }, pins)).toBe(false);
  });
});

describe("pinConflicts", () => {
  it("flags an unavailable occupant, one outside the pools the request sends for that role, and a dropped duplicate", () => {
    const who = [{ ...ANA, unavailableDates: ["2026-03-01"] }, BETO, LU];
    const collected = collect([cell(SUN1, "lead", ["ana", "lu"]), cell(SUN1, "bgv", ["ana"])], who);
    const got = pinConflicts({
      collected, columns, members: who,
      pools: { sundayLeads: ["Ana Karen Villalobos"], saturdayLeads: [], support: ["María Lucía Estrada"] },
    });
    expect(got.get(pinSeatKey({ columnId: SUN1, rowId: "lead", memberId: "ana", occurrence: 0 }))).toEqual(["unavailable"]);
    // Lucía is support: a Sunday Lead seat is outside what the request sends for Sun.Lead.
    expect(got.get(pinSeatKey({ columnId: SUN1, rowId: "lead", memberId: "lu", occurrence: 0 }))).toEqual(["outsidePool"]);
    expect(got.get(pinSeatKey({ columnId: SUN1, rowId: "bgv", memberId: "ana", occurrence: 0 }))).toEqual(["duplicate"]);
  });

  it("counts Sunday leads as Saturday-lead candidates, and any sent pool for BGV/Coro", () => {
    const collected = collect([cell(SAT2, "lead", ["ana"]), cell(SUN1, "coro", ["beto"])]);
    const got = pinConflicts({
      collected, columns, members,
      pools: { sundayLeads: ["Ana Karen Villalobos"], saturdayLeads: [], support: ["Alberto Ruiz Cano"] },
    });
    expect(got.size).toBe(0);
  });
});

describe("droppedPinNotices", () => {
  it("says where each dropped duplicate was kept", () => {
    const collected = collect([cell(SUN2, "lead", ["ana"]), cell(SUN2, "bgv", ["ana"]), cell(SUN1, "coro", ["lu", "lu"])]);
    expect(droppedPinNotices({ dropped: collected.dropped, columns, rows, members })).toEqual([
      "Lucía estaba dos veces en Coro del domingo 1 mar; se fijó una sola vez.",
      "Ana estaba en dos lugares del domingo 8 mar; se fijó solo en Lead.",
    ]);
  });
});

describe("emptyVoiceSeats", () => {
  it("counts target minus occupants on the voice seats Auto writes", () => {
    // Sunday: Lead 2, BGV 3, Coro 3 (8); Saturday: Lead 2, BGV 3 (5). Two Sundays + one Saturday = 21.
    expect(emptyVoiceSeats({ cells: [], columns, rows, sundayDates: SUNDAYS })).toBe(21);
    expect(emptyVoiceSeats({
      cells: [cell(SUN1, "lead", ["ana", "beto", "lu"]), cell(SUN1, "bgv", ["lu"]), cell(SPECIAL, "lead", ["ana"])],
      columns, rows, sundayDates: SUNDAYS,
    })).toBe(21 - 2 - 1);
  });
});
