import { describe, expect, it } from "vitest";


import { addDaysIso, audienceLabel, dayWords, eventDayLabel, eventHeading, eventLine, eventName, meetingsLede, seatRoleLabel } from "../jovenesEventView";

describe("jovenesEventView", () => {
  it("a heading is the title, else the kind's words, else «Reunión»", () => {
    expect(eventHeading({ title: "Noche de alabanza", kind: "saturday" })).toBe("Noche de alabanza");
    expect(eventHeading({ title: null, kind: "saturday" })).toBe("Sábado de Jóvenes");
    expect(eventHeading({ title: null, kind: "joint" })).toBe("Junta de grupos");
    expect(eventHeading({ title: null, kind: "toString" })).toBe("Reunión");
    expect(eventHeading({ title: null, kind: null })).toBe("Reunión");
  });

  it("names the audience by group name, keeping an unknown id visible", () => {
    expect(audienceLabel({ kind: "ministry" })).toBe("Todo Jóvenes");
    expect(audienceLabel({ kind: "groups", groups: ["otro-nivel", "emprendedores"] })).toBe("Otro Nivel · Emprendedores");
    expect(audienceLabel({ kind: "groups", groups: ["foo"] })).toBe("foo");
    expect(audienceLabel({ kind: "groups", groups: [] })).toBe("Sin grupos");
    expect(audienceLabel(null)).toBe("Sin audiencia");
  });

  it("seat roles read as words; an unknown one shows as stored", () => {
    expect(seatRoleLabel("encargado")).toBe("Encargado");
    expect(seatRoleLabel("constructor")).toBe("constructor");
    expect(seatRoleLabel(null)).toBe("Lugar");
  });

  it("under a date, the plain Saturday needs no name; a title or another kind names itself", () => {
    expect(eventName({ title: null, kind: "saturday" })).toBeNull();
    expect(eventName({ title: "Campamento", kind: "saturday" })).toBe("Campamento");
    expect(eventName({ title: null, kind: "joint" })).toBe("Junta de grupos");
    expect(eventName({ title: null, kind: null })).toBe("Reunión");
  });

  it("the line under the date: name, clock, arrival, audience, each only when there is one", () => {
    const base = { title: null, kind: "saturday", time: "18:10", arrival: "17:30", audience: { kind: "ministry" as const } };
    expect(eventLine(base)).toBe("18:10 · llegada 17:30 · Todo Jóvenes");
    expect(eventLine({ ...base, kind: "joint", arrival: null, audience: { kind: "groups", groups: ["otro-nivel"] } })).toBe(
      "Junta de grupos · 18:10 · Otro Nivel",
    );
    expect(eventLine({ ...base, time: null, arrival: null })).toBe("Todo Jóvenes");
  });

  it("the lede counts what is coming and names the first meeting that is the reader's", () => {
    expect(meetingsLede([{ date: "2026-11-07", mine: false }, { date: "2026-11-14", mine: true }, { date: "2026-11-21", mine: true }])).toEqual({
      count: "3 reuniones por venir",
      mine: "te toca el sábado 14 de noviembre",
    });
    expect(meetingsLede([{ date: "2026-11-07", mine: false }])).toEqual({ count: "1 reunión por venir", mine: null });
  });

  it("dates stay on their calendar day", () => {
    expect(eventDayLabel("2026-11-14")).toMatch(/sábado.*14.*noviembre/);
    // Inside a sentence: no comma, and «de» stays lowercase (CSS `capitalize` gave «14 De Noviembre»).
    expect(dayWords("2026-11-14")).toBe("sábado 14 de noviembre");
    expect(dayWords("2026-11-01")).toBe("domingo 1 de noviembre");
    expect(addDaysIso("2026-11-05", 120)).toBe("2027-03-05");
    expect(addDaysIso("2026-10-31", 1)).toBe("2026-11-01");
  });
});
