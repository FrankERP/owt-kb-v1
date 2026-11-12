import { describe, expect, it } from "vitest";
import { calendarViewOptions, entryMinistry, filterActiveDays, jovenesActiveDay, kidsActiveDay, parseCalendarView } from "../calendarMinistry";
import type { MinistryEventView } from "../ministryEventReads";
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
  it("reads the single-ministry values and makes anything else «Todos»", () => {
    expect(parseCalendarView("worship")).toBe("worship");
    expect(parseCalendarView("kids")).toBe("kids");
    expect(parseCalendarView("jovenes", ["kids", "jovenes"])).toBe("jovenes");
    for (const v of ["all", "", "otro", undefined, null, 1]) expect(parseCalendarView(v)).toBe("all");
  });
  it("falls back to «Todos» for a ministry the reader no longer has", () => {
    expect(parseCalendarView("jovenes")).toBe("all");
    expect(parseCalendarView("kids", ["jovenes"])).toBe("all");
    expect(parseCalendarView("worship", ["jovenes"])).toBe("worship");
  });
  it("offers Todos, Alabanza, then each of the reader's other ministries by its registry name", () => {
    expect(calendarViewOptions(["kids"]).map((o) => o.label)).toEqual(["Todos", "Alabanza", "Oasis Kids"]);
    expect(calendarViewOptions(["jovenes"]).map((o) => o.label)).toEqual(["Todos", "Alabanza", "Jóvenes"]);
    expect(calendarViewOptions(["jovenes", "kids"]).map((o) => o.value)).toEqual(["all", "worship", "kids", "jovenes"]);
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

describe("Kids «tú» without a name, and the Kids cache", () => {
  it("still seats a member with no name or alias on a Kids Sunday, but nobody on a worship one", () => {
    expect(mySeats(kids, "")).toEqual(["RG Chiquitos"]);
    expect(mySeats({ leads: [""] }, "")).toEqual([]);
  });
  it("lists Kids right after the Sunday service and before a special that day", () => {
    const special: ActiveDay = { day: "Noche de alabanza", date: "2026-11-01", roleId: "sp1" };
    expect(agendaRows({ "2026-11-01": [special, kids, sunday] }).map((r) => r.tone)).toEqual(["sun", "kids", "special"]);
  });
});

function meeting(over: Partial<MinistryEventView> = {}): MinistryEventView {
  return {
    _id: "ministryEvent.a",
    rev: "r1",
    ministry: "jovenes",
    audience: { kind: "groups", groups: ["otro-nivel", "emprendedores"] },
    kind: "joint",
    date: "2026-11-04",
    time: "19:30",
    arrival: null,
    title: null,
    notes: "Traer Biblia",
    place: null,
    lesson: null,
    published: true,
    seats: [{ _key: "s1", role: "encargado", memberId: "m1", name: "Ana", mine: true }],
    program: [
      { _key: "l1", label: "Oración", memberId: "m2", name: "Beto", mine: false, note: null },
      { _key: "l2", label: "Dinámica", memberId: null, name: null, mine: false, note: "10 min" },
    ],
    createdById: "m1",
    createdByName: "Ana",
    ...over,
  };
}

describe("jovenesActiveDay", () => {
  const j = jovenesActiveDay(meeting())!;
  it("names the meeting by its title or kind, keeps its time, and says who it is for", () => {
    expect(j.day).toBe("Junta de grupos");
    expect(jovenesActiveDay(meeting({ title: "Campamento" }))!.day).toBe("Campamento");
    // The plain Saturday meeting is «Jóvenes», as a Kids Sunday is «Oasis Kids»: the row already
    // sits under a Saturday. With a title it names itself.
    expect(jovenesActiveDay(meeting({ kind: "saturday", audience: { kind: "ministry" } }))!.day).toBe("Jóvenes");
    expect(jovenesActiveDay(meeting({ kind: "saturday", title: "Noche de alabanza" }))!.day).toBe("Noche de alabanza");
    expect(j.time).toBe("19:30");
    expect(j.jovenes?.audience).toBe("Otro Nivel · Emprendedores");
    expect(j.jovenes?.seats).toEqual([{ key: "s1", label: "Encargado", name: "Ana", mine: true }]);
    expect(j.jovenes?.program.map((l) => [l.label, l.name, l.note])).toEqual([["Oración", "Beto", null], ["Dinámica", null, "10 min"]]);
  });
  it("carries the place and a typed seat name (someone without an account) as they are", () => {
    const typed = jovenesActiveDay(meeting({
      place: "Oasis Tlalpan",
      seats: [{ _key: "s9", role: "comparte", memberId: null, name: "Ana", mine: false }],
    }))!;
    expect(typed.jovenes?.place).toBe("Oasis Tlalpan");
    expect(typed.jovenes?.seats).toEqual([{ key: "s9", label: "Comparte", name: "Ana", mine: false }]);
    expect(j.jovenes?.place).toBeNull();
  });
  it("drops a meeting whose date cannot be placed", () => {
    expect(jovenesActiveDay(meeting({ date: "x" }))).toBeNull();
  });
  it("is its own ministry, tone, row key and clock, and «tú» comes from the server's flag", () => {
    expect(entryMinistry(j)).toBe("jovenes");
    expect(serviceTone(j)).toBe("jovenes");
    expect(serviceClock(j)).toBe("19:30");
    expect(serviceClock(jovenesActiveDay(meeting({ time: null }))!)).toBeUndefined();
    expect(mySeats(j, "")).toEqual(["Encargado"]);
    expect(summarizeService(j)).toBe("Otro Nivel · Emprendedores · Encargado Ana");
    // Only who is in charge: the other seats are in the sheet, and an empty one says nothing.
    const full = meeting({
      seats: [
        { _key: "s1", role: "encargado", memberId: "m1", name: "Ana", mine: false },
        { _key: "s2", role: "apoyo", memberId: "m2", name: "Beto", mine: false },
        { _key: "s3", role: "comparte", memberId: "m3", name: "Caro", mine: false },
      ],
    });
    expect(summarizeService(jovenesActiveDay(full)!)).toBe("Otro Nivel · Emprendedores · Encargado Ana");
    expect(summarizeService(jovenesActiveDay(meeting({ seats: [] }))!)).toBe("Otro Nivel · Emprendedores");
    const other = jovenesActiveDay(meeting({ _id: "ministryEvent.b" }))!;
    const rows = agendaRows({ "2026-11-04": [j, other, { ...saturday, date: "2026-11-04" }] });
    expect(rows.map((r) => r.tone)).toEqual(["sat", "jovenes", "jovenes"]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(3);
  });
  it("filters apart from worship and Kids", () => {
    const days = { "2026-11-01": [sunday, kids], "2026-11-04": [j] };
    expect(filterActiveDays(days, "jovenes")).toEqual({ "2026-11-04": [j] });
    expect(filterActiveDays(days, "worship")).toEqual({ "2026-11-01": [sunday] });
  });
});
