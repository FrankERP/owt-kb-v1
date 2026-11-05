import { describe, expect, it } from "vitest";


import { addDaysIso, audienceLabel, eventDayLabel, eventHeading, mySeats, seatRoleLabel } from "../jovenesEventView";

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

  it("mySeats lists only the reader's seats", () => {
    const seat = (role: string, mine: boolean) => ({ _key: role, role, memberId: "x", name: "X", mine });
    expect(mySeats({ seats: [seat("encargado", true), seat("apoyo", false), seat("comparte", true)] })).toEqual(["Encargado", "Comparte"]);
  });

  it("dates stay on their calendar day", () => {
    expect(eventDayLabel("2026-11-14")).toMatch(/sábado.*14.*noviembre/);
    expect(addDaysIso("2026-11-05", 120)).toBe("2027-03-05");
    expect(addDaysIso("2026-10-31", 1)).toBe("2026-11-01");
  });
});
