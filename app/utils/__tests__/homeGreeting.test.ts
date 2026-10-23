import { describe, expect, it } from "vitest";
import { firstName, homeGreeting, joinNames, type GreetingService } from "../homeGreeting";

// Wednesday 2026-10-21, 10:00 in CDMX (UTC−6).
const NOW = new Date("2026-10-21T16:00:00Z");
const songs = (n: number) => ({ songs: Array(n).fill({}) });
const sat = (extra: Partial<GreetingService> = {}): GreetingService => ({ day: "Sábado", date: "2026-10-24", setlist: songs(5), leads: ["Gaby"], ...extra });
const sun = (extra: Partial<GreetingService> = {}): GreetingService => ({ day: "Domingo", date: "2026-10-25", setlist: songs(6), leads: ["Pau"], ...extra });

describe("joinNames / firstName", () => {
  it("joins with commas and a final «y»", () => {
    expect(joinNames([])).toBe("");
    expect(joinNames(["Gaby"])).toBe("Gaby");
    expect(joinNames(["Gaby", "Pau"])).toBe("Gaby y Pau");
    expect(joinNames(["Gaby", "Pau", "Lupe"])).toBe("Gaby, Pau y Lupe");
  });
  it("greets by the first word of alias, else name", () => {
    expect(firstName({ alias: "Frank R", name: "Francisco Rocha" })).toBe("Frank");
    expect(firstName({ alias: " ", name: "Francisco Rocha" })).toBe("Francisco");
    expect(firstName(undefined)).toBe("");
  });
});

describe("homeGreeting", () => {
  it("names the weekday, the co-lead, the distance and the songs", () => {
    const g = homeGreeting([sat({ leads: ["Frank", "Gaby"] }), sun()], { alias: "Frank" }, "frank", NOW);
    expect(g).toEqual({ hello: "Hola, Frank", lead: "Te toca el ", day: "sábado", sub: "Lead con Gaby · 18:00 · en 3 días · 5 canciones" });
  });

  it("picks the EARLIEST service the member serves, not the next service overall", () => {
    const g = homeGreeting([sat(), sun({ instruments: [{ label: "Bajo", person: "Frank" }] })], { alias: "Frank" }, "frank", NOW);
    expect(g.day).toBe("domingo");
    expect(g.sub).toBe("Bajo · 11:00 · en 4 días · 6 canciones");
  });

  it("says «hoy» and «mañana» in the heading and drops the distance from the line", () => {
    const today = homeGreeting([{ ...sat({ bgvs: [{ member_name: "Frank" }] }), date: "2026-10-21" }], { name: "Frank" }, "frank", NOW);
    expect([today.lead, today.day, today.sub]).toEqual(["Te toca ", "hoy", "BGVs · 18:00 · 5 canciones"]);
    const tomorrow = homeGreeting([{ ...sat({ chorus: [{ member_name: "Francisco", alias: "Frank" }] }), date: "2026-10-22" }], { name: "Frank" }, "frank", NOW);
    expect([tomorrow.day, tomorrow.sub]).toEqual(["mañana", "Coro · 18:00 · 5 canciones"]);
  });

  it("names a special and its clock; a weekend carries the team's standing hour after the seat", () => {
    const sp: GreetingService = { day: "Noche de alabanza", date: "2026-10-23", time: "19:30", leads: ["Frank"], setlist: songs(1) };
    expect(homeGreeting([sp], { alias: "Frank" }, "frank", NOW).sub).toBe("Noche de alabanza · 19:30 · Lead · en 2 días · 1 canción");
  });

  it("orders two sets on the same day by their clock", () => {
    const late: GreetingService = { day: "Tarde", date: "2026-10-24", time: "18:00", leads: ["Frank"] };
    const early: GreetingService = { day: "Mañana", date: "2026-10-24", time: "09:00", fohTeam: [{ label: "Audio", person: "Frank" }] };
    expect(homeGreeting([late, early], { alias: "Frank" }, "frank", NOW).sub).toBe("Mañana · 09:00 · Audio · en 3 días");
    // An untimed set comes after a timed one, as `compareServiceTime` orders them.
    const untimed: GreetingService = { day: "Sin hora", date: "2026-10-24", leads: ["Frank"] };
    expect(homeGreeting([untimed, late], { alias: "Frank" }, "frank", NOW).sub).toMatch(/^Tarde · 18:00/);
  });

  it("ignores a past service and says so when there is nothing to serve", () => {
    const past = { ...sat({ leads: ["Frank"] }), date: "2026-10-20" };
    expect(homeGreeting([past, sun()], { alias: "Frank" }, "frank", NOW)).toEqual({
      hello: "Hola, Frank", lead: "Esta semana", day: "", sub: "Esta vez no te toca servir.",
    });
  });

  it("seats nobody without a name, and has no hello to give", () => {
    expect(homeGreeting([sat({ leads: [""] })], {}, "", NOW)).toMatchObject({ hello: null, lead: "Esta semana" });
  });
});
