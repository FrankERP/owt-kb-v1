import { describe, expect, it } from "vitest";
import { CALENDAR_VIEW_OPTIONS, entryMinistry, filterActiveDays, kidsActiveDay, parseCalendarView } from "../calendarMinistry";
import { agendaRows, mySeats, serviceClock, serviceTone, summarizeService } from "../agenda";
import type { ActiveDay } from "../../components/CalendarView";

const sunday: ActiveDay = { day: "Domingo", date: "2026-11-01", leads: ["Ana"] };
const saturday: ActiveDay = { day: "Sábado", date: "2026-10-31", leads: ["Beto"] };
const kids = kidsActiveDay({
  date: "2026-11-01",
  ensenanza: { name: " Ana y Luis ", mine: false },
  chiquitos: { name: "Beto y Sofi", mine: true },
  medianos: null,
  grandes: { name: "Mkz y Caro", mine: null },
})!;

describe("parseCalendarView", () => {
  it("reads the two single-ministry values and makes anything else «Todos»", () => {
    expect(parseCalendarView("worship")).toBe("worship");
    expect(parseCalendarView("kids")).toBe("kids");
    for (const v of ["all", "", "jovenes", undefined, null, 1]) expect(parseCalendarView(v)).toBe("all");
  });
  it("offers Todos, then each ministry by its registry name", () => {
    expect(CALENDAR_VIEW_OPTIONS.map((o) => o.label)).toEqual(["Todos", "Alabanza", "Oasis Kids"]);
  });
});

describe("kidsActiveDay", () => {
  it("builds the four seats in order, trims names, and takes «mine» only from a true flag", () => {
    expect(kids.day).toBe("Oasis Kids");
    expect(kids.date).toBe("2026-11-01");
    expect(kids.kids?.seats).toEqual([
      { seat: "ensenanza", label: "Enseñanza", pair: "Ana y Luis", mine: false },
      { seat: "chiquitos", label: "RG Chiquitos", pair: "Beto y Sofi", mine: true },
      { seat: "medianos", label: "RG Medianos", pair: null, mine: false },
      { seat: "grandes", label: "RG Grandes", pair: "Mkz y Caro", mine: false },
    ]);
  });
  it("drops a row whose date cannot be placed", () => {
    expect(kidsActiveDay({ date: "mañana" })).toBeNull();
    expect(kidsActiveDay({})).toBeNull();
  });
});

describe("filterActiveDays", () => {
  const days = { "2026-10-31": [saturday], "2026-11-01": [sunday, kids], "2026-11-08": [{ ...kids, date: "2026-11-08" }] };
  it("returns everything under «Todos»", () => {
    expect(filterActiveDays(days, "all")).toBe(days);
  });
  it("keeps one ministry and drops a day left empty", () => {
    expect(filterActiveDays(days, "worship")).toEqual({ "2026-10-31": [saturday], "2026-11-01": [sunday] });
    expect(Object.keys(filterActiveDays(days, "kids"))).toEqual(["2026-11-01", "2026-11-08"]);
  });
  it("calls an entry Kids only when it carries Kids seats", () => {
    expect(entryMinistry(kids)).toBe("kids");
    const named: ActiveDay = { day: "Oasis Kids", date: "2026-11-01" };
    expect(entryMinistry(named)).toBe("worship");
  });
});

describe("agenda helpers on a Kids Sunday", () => {
  it("takes its own neutral tone, sorts after the day's worship service, and keys apart from it", () => {
    expect(serviceTone(kids)).toBe("kids");
    const rows = agendaRows({ "2026-11-01": [kids, sunday] });
    expect(rows.map((r) => r.tone)).toEqual(["sun", "kids"]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
  });
  it("seats the reader by the server's flag, never by name", () => {
    expect(mySeats(kids, "beto y sofi")).toEqual(["RG Chiquitos"]);
    expect(mySeats({ ...kids, kids: { seats: kids.kids!.seats.map((s) => ({ ...s, mine: false })) } }, "ana")).toEqual([]);
  });
  it("summarizes the filled seats and runs at the Sunday hour", () => {
    expect(summarizeService(kids)).toBe("Enseñanza: Ana y Luis · RG Chiquitos: Beto y Sofi · RG Grandes: Mkz y Caro");
    expect(summarizeService({ ...kids, kids: { seats: [] } })).toBe("Sin asignaciones");
    expect(serviceClock(kids)).toBe("11:00");
  });
});
