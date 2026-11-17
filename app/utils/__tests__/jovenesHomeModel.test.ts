// «Inicio» de Jóvenes as data: the next meeting, the few after it, the reader's turns, the last one held.
import { describe, expect, it } from "vitest";
import { HOME_TURNS, HOME_UPCOMING, homeSections } from "../jovenesHomeModel";

const m = (date: string, mine = false) => ({ date, mine });
const TODAY = "2026-11-17";
const sections = (list: ReturnType<typeof m>[], today: string) => homeSections(list, today, (x) => x);

describe("homeSections", () => {
  it("is empty for no meetings", () => {
    expect(sections([], TODAY)).toEqual({ next: null, upcoming: [], later: 0, turns: [], previous: null });
  });

  it("splits at today: a meeting dated today is still the next one, the latest past one is «anterior»", () => {
    const list = [m("2026-11-07"), m("2026-11-14"), m("2026-11-17"), m("2026-11-21")];
    const s = sections(list, TODAY);
    expect(s.previous).toBe(list[1]);
    expect(s.next).toBe(list[2]);
    expect(s.upcoming).toEqual([list[3]]);
    expect(s.later).toBe(0);
  });

  it("shows a few after the next one and counts the rest for the Calendario", () => {
    const list = Array.from({ length: HOME_UPCOMING + 4 }, (_, i) => m(`2026-12-${String(i + 1).padStart(2, "0")}`));
    const s = sections(list, TODAY);
    expect(s.next).toBe(list[0]);
    expect(s.upcoming).toEqual(list.slice(1, 1 + HOME_UPCOMING));
    expect(s.later).toBe(3);
  });

  it("lists the reader's next turns, from the whole horizon and capped", () => {
    const list = [m("2026-11-21"), m("2026-11-28", true), m("2026-12-05"), m("2026-12-12", true), m("2026-12-19", true), m("2026-12-26", true), m("2027-01-02", true)];
    const s = sections(list, TODAY);
    expect(s.turns).toEqual([list[1], list[3], list[4]]);
    expect(s.turns).toHaveLength(HOME_TURNS);
  });

  it("never counts a past turn", () => {
    expect(sections([m("2026-11-14", true), m("2026-11-21")], TODAY).turns).toEqual([]);
  });

  it("leaves «Te toca» out when the only turn is the next meeting, which already says so", () => {
    expect(sections([m("2026-11-21", true), m("2026-11-28")], TODAY).turns).toEqual([]);
    const two = [m("2026-11-21", true), m("2026-11-28", true)];
    expect(sections(two, TODAY).turns).toEqual(two);
  });

  it("has no «anterior» when nothing was held", () => {
    expect(sections([m("2026-11-21")], TODAY).previous).toBeNull();
  });
});
