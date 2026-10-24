import { describe, it, expect } from "vitest";
import { findDuplicates, serviceTone, serviceConflicts, summarizeService, conflictLabel, agendaRows, monthStripDays, weekStripDays, mondayOf, addDays, mySeats, myNameFromSession, dayCellLabel, dayTitle, serviceClock, calendarCounts, calendarCountLine } from "../agenda";
import type { ActiveDay } from "../../components/CalendarView";

const sun = (date: string, extra: Partial<ActiveDay> = {}): ActiveDay => ({ day: "Domingo", date, leads: ["Jakey", "Marianne"], instruments: [{ label: "Keys", person: "Sofi" }, { label: "Bass", person: "Mkz" }], setlist: { songs: Array(5).fill({ _id: "s", title: "t" }) as never, week: date }, ...extra });
const sat = (date: string): ActiveDay => ({ day: "Sábado", date, leads: ["Ana"] });
const special = (date: string): ActiveDay => ({ day: "Noche de alabanza", date, roleId: "sp1", leads: [] });

describe("findDuplicates", () => {
  it("lowercases, trims, and returns only names seen more than once", () => {
    expect([...findDuplicates(["Sofi", " sofi", "Mkz"])]).toEqual(["sofi"]);
  });
});
describe("serviceTone / serviceConflicts", () => {
  it("tones by day and roleId", () => {
    expect(serviceTone(sun("2026-09-13"))).toBe("sun");
    expect(serviceTone(sat("2026-09-12"))).toBe("sat");
    expect(serviceTone(special("2026-09-15"))).toBe("special");
  });
  it("counts a person seated twice in one section, per section", () => {
    const e = sun("2026-09-13", { leads: ["Ana", "Ana"], instruments: [{ label: "Keys", person: "Sofi" }, { label: "Bass", person: "sofi" }] });
    expect(serviceConflicts(e)).toBe(2);
    expect(serviceConflicts(sun("2026-09-13"))).toBe(0);
  });
});
describe("conflictLabel", () => {
  it("says «conflicto» for one, «conflictos» otherwise, singular and plural alike", () => {
    expect(conflictLabel(1)).toBe("1 conflicto");
    expect(conflictLabel(2)).toBe("2 conflictos");
    expect(conflictLabel(0)).toBe("0 conflictos");
  });
});
describe("summarizeService", () => {
  it("joins lead · instruments · song count, skipping empty parts", () => {
    expect(summarizeService(sun("2026-09-13"))).toBe("Lead Jakey, Marianne · Keys Sofi · Bass Mkz · 5 canciones");
    expect(summarizeService(sat("2026-09-12"))).toBe("Lead Ana");
    expect(summarizeService(special("2026-09-15"))).toBe("Sin asignaciones");
  });
});
describe("agendaRows", () => {
  it("one row per service, sorted by date then Sábado < Domingo < specials, with a month marker on the first row of each month", () => {
    const rows = agendaRows({ "2026-09-13": [sun("2026-09-13")], "2026-09-12": [sat("2026-09-12")], "2026-10-04": [sun("2026-10-04")], "2026-09-13x": [] });
    expect(rows.map((r) => `${r.date} ${r.entry.day}`)).toEqual(["2026-09-12 Sábado", "2026-09-13 Domingo", "2026-10-04 Domingo"]);
    expect(rows.map((r) => r.monthStart)).toEqual(["2026-09", null, "2026-10"]);
    expect(rows[0].key).toBe("2026-09-12:Sábado");
  });
});
describe("monthStripDays", () => {
  it("lists every day of the month with weekday letters, lit tones, and today", () => {
    const days = monthStripDays("2026-09", { "2026-09-13": [sun("2026-09-13")], "2026-09-12": [sat("2026-09-12")] }, "2026-09-10");
    expect(days).toHaveLength(30);
    expect(days[0]).toMatchObject({ date: "2026-09-01", dow: "Mar", num: 1, lit: false, tones: [], today: false });
    expect(days[11]).toMatchObject({ date: "2026-09-12", dow: "Sáb", lit: true, tones: ["sat"] });
    expect(days[12]).toMatchObject({ date: "2026-09-13", dow: "Dom", lit: true, tones: ["sun"] });
    expect(days[9].today).toBe(true);
  });
});
describe("dayCellLabel", () => {
  it("names the day, its services and «te toca», the one label both calendar views use", () => {
    const entries = [sun("2026-09-20"), special("2026-09-20")];
    expect(dayCellLabel({ date: "2026-09-20", mine: false }, entries)).toBe("domingo, 20 de septiembre, Domingo, Noche de alabanza");
    expect(dayCellLabel({ date: "2026-09-20", mine: true }, entries)).toBe("domingo, 20 de septiembre, Domingo, Noche de alabanza, te toca");
    expect(dayCellLabel({ date: "2026-09-16", mine: false }, [])).toBe("miércoles, 16 de septiembre");
  });
  it("dayTitle is the visible form — capitalised, without the locale's comma", () => {
    expect(dayTitle("2026-10-25")).toBe("Domingo 25 de octubre");
    expect(dayTitle("2026-09-16")).toBe("Miércoles 16 de septiembre");
  });
});
describe("mondayOf / addDays", () => {
  it("resolves any day to the Monday on or before it, Sunday included", () => {
    expect(mondayOf("2026-09-09")).toBe("2026-09-07"); // a Wednesday
    expect(mondayOf("2026-09-07")).toBe("2026-09-07"); // the Monday itself
    expect(mondayOf("2026-09-13")).toBe("2026-09-07"); // the Sunday that ENDS that week
    expect(mondayOf("2026-01-01")).toBe("2025-12-29"); // across the year boundary
  });
  it("steps days across month and year boundaries", () => {
    expect(addDays("2026-09-07", 7)).toBe("2026-09-14");
    expect(addDays("2026-09-07", -7)).toBe("2026-08-31");
    expect(addDays("2026-12-28", 7)).toBe("2027-01-04");
  });
});
describe("weekStripDays", () => {
  it("gives seven days from the Monday of the given date, with weekday letters, lit tones and today", () => {
    const days = weekStripDays("2026-09-09", { "2026-09-13": [sun("2026-09-13")], "2026-09-12": [sat("2026-09-12")] }, "2026-09-10");
    expect(days).toHaveLength(7);
    expect(days.map((d) => d.dow)).toEqual(["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]);
    expect(days[0]).toMatchObject({ date: "2026-09-07", num: 7, lit: false, tones: [], today: false });
    expect(days[3].today).toBe(true);
    expect(days[5]).toMatchObject({ date: "2026-09-12", lit: true, tones: ["sat"] });
    expect(days[6]).toMatchObject({ date: "2026-09-13", lit: true, tones: ["sun"] });
  });
  it("lights a service in the next month when the week crosses the boundary", () => {
    const days = weekStripDays("2026-09-28", { "2026-10-04": [sun("2026-10-04")] }, "2026-09-10");
    expect(days.map((d) => d.date)).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(days[6]).toMatchObject({ lit: true, tones: ["sun"], num: 4 });
  });
  it("lists one tone per service on a day carrying more than one, in `activeDays` order", () => {
    const days = weekStripDays("2026-09-14", { "2026-09-20": [sun("2026-09-20"), special("2026-09-20")] }, "2026-09-10");
    expect(days[6]).toMatchObject({ lit: true, tones: ["sun", "special"] });
  });
  it("flags the day a member is seated in, `mine`, only when `myName` is given", () => {
    const active = { "2026-09-13": [sun("2026-09-13", { instruments: [{ label: "Keys", person: "Sofi" }] })] };
    expect(weekStripDays("2026-09-09", active, "2026-09-10")[6].mine).toBe(false);
    expect(weekStripDays("2026-09-09", active, "2026-09-10", "sofi")[6].mine).toBe(true);
    expect(weekStripDays("2026-09-09", active, "2026-09-10", "nadie")[6].mine).toBe(false);
  });
});

describe("myNameFromSession", () => {
  it("prefers the trimmed alias over the name, lowercased", () => {
    expect(myNameFromSession({ alias: " Sofi ", name: "Sofía Ramírez" })).toBe("sofi");
  });
  it("falls back to name when there is no alias", () => {
    expect(myNameFromSession({ name: "Sofía Ramírez" })).toBe("sofía ramírez");
  });
  it("trims the name fallback too", () => {
    expect(myNameFromSession({ name: " Sofía Ramírez " })).toBe("sofía ramírez");
  });
  it("is empty for a signed-out or nameless session", () => {
    expect(myNameFromSession(undefined)).toBe("");
    expect(myNameFromSession({})).toBe("");
  });
});

describe("mySeats", () => {
  it("lists Lead and the instrument for a member seated in both, in DayCard's order", () => {
    const e = sun("2026-09-13", { leads: ["Sofi"], instruments: [{ label: "Keys", person: "Sofi" }, { label: "Bass", person: "Mkz" }] });
    expect(mySeats(e, "sofi")).toEqual(["Lead", "Keys"]);
  });
  it("matches by alias in bgvs/chorus, case- and whitespace-insensitively", () => {
    const e = sun("2026-09-13", { leads: [], instruments: [], bgvs: [{ member_name: "Sofía Ramírez", alias: "Sofi" }] });
    expect(mySeats(e, "sofi")).toEqual(["BGVs"]);
  });
  it("seats nobody when `myName` is empty", () => {
    expect(mySeats(sun("2026-09-13"), "")).toEqual([]);
  });
  it("dedupes a member seated on two instrument seats with the same label", () => {
    const e = sun("2026-09-13", { leads: [], instruments: [{ label: "Keys", person: "Sofi" }, { label: "Keys", person: "Sofi" }] });
    expect(mySeats(e, "sofi")).toEqual(["Keys"]);
  });
});

describe("serviceClock", () => {
  it("gives a weekend the team's standing hour and a special its own time", () => {
    expect(serviceClock({ day: "Domingo" })).toBe("11:00");
    expect(serviceClock({ day: "Sábado" })).toBe("18:00");
    expect(serviceClock({ day: "Noche de alabanza", roleId: "sp1", time: "19:30" })).toBe("19:30");
  });
  it("is empty for a special with no valid time — all-day, never a made-up 11:00", () => {
    expect(serviceClock({ day: "Aniversario", roleId: "sp1" })).toBeUndefined();
    expect(serviceClock({ day: "Aniversario", roleId: "sp1", time: "pronto" })).toBeUndefined();
  });
});

describe("calendarCounts / calendarCountLine", () => {
  const days = {
    "2026-09-06": [sun("2026-09-06", { leads: ["Sofi"] })],
    "2026-09-13": [sun("2026-09-13", { leads: ["Sofi"] })],
    "2026-09-20": [sun("2026-09-20", { leads: ["Ana"] }), { day: "Aniversario", date: "2026-09-20", roleId: "sp1", leads: ["Sofi"] }],
    "2026-10-04": [sun("2026-10-04")],
  };
  it("counts the services from today on, across the whole fetch, in the rolling view", () => {
    // Ana leads the 20th only; Sofi is on Keys in every weekend fixture plus the special.
    expect(calendarCounts(days, "2026-09-10", "ana", null)).toEqual({ services: 4, mine: 1 });
    expect(calendarCounts(days, "2026-09-10", "sofi", null)).toEqual({ services: 4, mine: 4 });
  });
  it("counts the browsed month alone, past days included — the number sits under that month's name", () => {
    expect(calendarCounts(days, "2026-09-10", "ana", "2026-09")).toEqual({ services: 4, mine: 1 });
    expect(calendarCounts(days, "2026-09-10", "ana", "2026-10")).toEqual({ services: 1, mine: 0 });
    expect(calendarCounts(days, "2026-09-10", "sofi", "2026-11")).toEqual({ services: 0, mine: 0 });
  });
  it("seats nobody without a name", () => {
    expect(calendarCounts(days, "2026-09-10", "", null).mine).toBe(0);
  });
  it("words the line in two parts, the second absent rather than «te toca en 0»", () => {
    expect(calendarCountLine({ services: 8, mine: 3 }, false)).toEqual({ services: "8 servicios por venir", mine: "te toca en 3" });
    expect(calendarCountLine({ services: 1, mine: 1 }, false)).toEqual({ services: "1 servicio por venir", mine: "te toca en 1" });
    expect(calendarCountLine({ services: 4, mine: 0 }, true)).toEqual({ services: "4 servicios", mine: null });
    expect(calendarCountLine({ services: 0, mine: 0 }, false)).toEqual({ services: "Sin servicios por venir", mine: null });
    expect(calendarCountLine({ services: 0, mine: 0 }, true)).toEqual({ services: "Sin servicios", mine: null });
  });
});
