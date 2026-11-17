/** @vitest-environment jsdom */
// Jóvenes' Calendario in the browser (ADR-0086): the filter pills are toggles, a chosen audience
// that disappears falls back to everything, and «Lista» and «Mes» are two views of the SAME
// filtered meetings. The rules themselves are `jovenesMeetingList.test.ts`'s and
// `jovenesCalendarModel.test.ts`'s; this pins the wiring.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { installMotionTestEnv } from "@/app/components/ui/__tests__/motionTestSetup";
import { MINISTRIES } from "@/app/ministries";
import type { MinistryEventView } from "@/app/utils/ministryEventReads";
import { jovenesDayEntry } from "@/app/utils/calendarMinistry";
import JovenesMeetingList, { type JovenesListItem } from "../MeetingList";

installMotionTestEnv();
afterEach(cleanup);

const [G1] = MINISTRIES.jovenes.groups;
const TODAY = "2026-11-12";

function item(id: string, date: string, audience: MinistryEventView["audience"], mine: string[] = []): JovenesListItem {
  const e: MinistryEventView = {
    _id: id,
    rev: "r",
    ministry: "jovenes",
    audience,
    kind: audience?.kind === "ministry" ? "saturday" : "group",
    date,
    time: "18:10",
    arrival: null,
    title: id,
    notes: null,
    place: null,
    lesson: null,
    published: true,
    seats: [{ _key: "s1", role: "encargado", memberId: "m1", name: "Ana", photo: null, mine: mine.length > 0 }],
    program: [],
    createdById: null,
    createdByName: null,
  };
  return { event: e, entry: jovenesDayEntry(e), mine, countdown: "En 2 días", editor: null };
}

const ITEMS = [
  item("uno", "2026-11-14", { kind: "ministry" }),
  item("dos", "2026-11-18", { kind: "groups", groups: [G1.id] }, ["Encargado"]),
  item("tres", "2026-11-21", { kind: "ministry" }),
  item("cuatro", "2026-12-05", { kind: "groups", groups: [G1.id] }),
];

const titles = () => screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent!.split(",")[0]);
const expanded = () =>
  screen
    .getAllByRole("article")
    .filter((a) => within(a).queryByRole("button", { expanded: true }))
    .map((a) => within(a).getByRole("heading", { level: 3 }).textContent!.split(",")[0]);
const view = (name: string) => within(screen.getByRole("radiogroup", { name: "Vista" })).getByRole("radio", { name });
const day = (name: RegExp) => screen.getByRole("button", { name });
const pill = (name: RegExp) => within(screen.getByRole("group", { name: "Filtrar reuniones" })).getByRole("button", { name });

describe("JovenesMeetingList", () => {
  it("lists every meeting folded under its month, «Lista» checked and «Todas» pressed", () => {
    render(<JovenesMeetingList items={ITEMS} today={TODAY} />);
    expect(titles()).toEqual(["uno", "dos", "tres", "cuatro"]);
    expect(expanded()).toEqual([]);
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Noviembre3", "Diciembre1"]);
    expect(view("Lista").getAttribute("aria-checked")).toBe("true");
    expect(pill(/^Todas/).getAttribute("aria-pressed")).toBe("true");
    expect(pill(new RegExp(`^${G1.name}`)).getAttribute("aria-pressed")).toBe("false");
  });

  it("a filter keeps its meetings and presses its pill", () => {
    render(<JovenesMeetingList items={ITEMS} today={TODAY} />);
    fireEvent.click(pill(new RegExp(`^${G1.name}`)));
    expect(titles()).toEqual(["dos", "cuatro"]);
    expect(pill(new RegExp(`^${G1.name}`)).getAttribute("aria-pressed")).toBe("true");
    expect(pill(/^Todas/).getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(pill(/^Me toca/));
    expect(titles()).toEqual(["dos"]);

    fireEvent.click(pill(/^Todas/));
    expect(titles()).toEqual(["uno", "dos", "tres", "cuatro"]);
  });

  it("the rows carry the route stagger only until a filter is picked, so a returning row does not wait it out again", () => {
    const { container } = render(<JovenesMeetingList items={ITEMS} today={TODAY} />);
    expect(container.querySelectorAll("[data-reveal]").length).toBeGreaterThan(ITEMS.length);
    fireEvent.click(pill(/^Me toca/));
    fireEvent.click(pill(/^Todas/));
    // Only the toolbar (the view control and the filter) keeps it; no label and no card does.
    const revealed = [...container.querySelectorAll("[data-reveal]")];
    expect(revealed.length).toBe(1);
    expect(within(revealed[0] as HTMLElement).getByRole("group", { name: "Filtrar reuniones" })).toBeTruthy();
  });

  it("falls back to everything when the chosen audience is no longer offered", () => {
    const { rerender } = render(<JovenesMeetingList items={ITEMS} today={TODAY} />);
    fireEvent.click(pill(new RegExp(`^${G1.name}`)));
    expect(titles()).toEqual(["dos", "cuatro"]);
    // A refresh after the group's meetings passed: four whole-ministry meetings, one of them mine.
    const next = [
      item("a", "2026-12-05", { kind: "ministry" }, ["Encargado"]),
      item("b", "2026-12-12", { kind: "ministry" }),
      item("c", "2026-12-19", { kind: "ministry" }),
      item("d", "2026-12-26", { kind: "ministry" }),
    ];
    rerender(<JovenesMeetingList items={next} today={TODAY} />);
    expect(titles()).toEqual(["a", "b", "c", "d"]);
    expect(pill(/^Todas/).getAttribute("aria-pressed")).toBe("true");
  });

  it("shows no filter when there is nothing to choose between", () => {
    render(<JovenesMeetingList items={ITEMS.slice(0, 3)} today={TODAY} />);
    expect(screen.queryByRole("group", { name: "Filtrar reuniones" })).toBeNull();
    expect(titles()).toEqual(["uno", "dos", "tres"]);
  });

  describe("«Mes»", () => {
    const openMonth = () => {
      render(<JovenesMeetingList items={ITEMS} today={TODAY} />);
      fireEvent.click(view("Mes"));
    };

    it("opens on the month of the next meeting, its days pressable, the rest of the month as cards", () => {
      openMonth();
      expect(view("Mes").getAttribute("aria-checked")).toBe("true");
      expect(screen.getByRole("heading", { level: 2, name: "Noviembre 2026" })).toBeTruthy();
      expect(titles()).toEqual(["uno", "dos", "tres"]);
      // A day's name says what it carries; «te toca» only where it is the reader's.
      expect(day(/^Sábado 14 de noviembre: 1 reunión, Todo Jóvenes$/)).toBeTruthy();
      expect(day(new RegExp(`^Miércoles 18 de noviembre: 1 reunión, ${G1.name}, te toca$`))).toBeTruthy();
      // Today is marked, and a day with nothing is not a control.
      expect(document.querySelector('[aria-current="date"]')?.textContent).toBe("12");
      expect(screen.queryByRole("button", { name: /^Jueves 12 de noviembre/ })).toBeNull();
    });

    it("a day shows its meeting open; pressing it again, or «Ver todo el mes», brings the month back", () => {
      openMonth();
      fireEvent.click(day(/^Miércoles 18 de noviembre/));
      expect(titles()).toEqual(["dos"]);
      expect(expanded()).toEqual(["dos"]);
      expect(day(/^Miércoles 18 de noviembre/).getAttribute("aria-pressed")).toBe("true");
      fireEvent.click(day(/^Miércoles 18 de noviembre/));
      expect(titles()).toEqual(["uno", "dos", "tres"]);
      fireEvent.click(day(/^Sábado 21 de noviembre/));
      expect(titles()).toEqual(["tres"]);
      fireEvent.click(screen.getByRole("button", { name: "Ver todo el mes" }));
      expect(titles()).toEqual(["uno", "dos", "tres"]);
      expect(expanded()).toEqual([]);
    });

    it("pages between today's month and the last meeting's, and no further", () => {
      openMonth();
      const prev = screen.getByRole("button", { name: "Mes anterior" }) as HTMLButtonElement;
      const next = screen.getByRole("button", { name: "Mes siguiente" }) as HTMLButtonElement;
      expect(prev.disabled).toBe(true);
      fireEvent.click(day(/^Sábado 21 de noviembre/));
      fireEvent.click(next);
      expect(screen.getByRole("heading", { level: 2, name: "Diciembre 2026" })).toBeTruthy();
      // The day picked in November does not follow into December.
      expect(titles()).toEqual(["cuatro"]);
      expect(next.disabled).toBe(true);
      fireEvent.click(prev);
      expect(titles()).toEqual(["uno", "dos", "tres"]);
    });

    it("the filter reaches the grid too, and survives a change of view", () => {
      openMonth();
      fireEvent.click(pill(new RegExp(`^${G1.name}`)));
      expect(titles()).toEqual(["dos"]);
      expect(screen.queryByRole("button", { name: /^Sábado 14 de noviembre/ })).toBeNull();
      fireEvent.click(view("Lista"));
      expect(titles()).toEqual(["dos", "cuatro"]);
      expect(pill(new RegExp(`^${G1.name}`)).getAttribute("aria-pressed")).toBe("true");
    });

    it("a month with nothing says so", () => {
      const sparse = [item("uno", "2026-11-14", { kind: "ministry" }), item("dos", "2027-01-09", { kind: "ministry" })];
      render(<JovenesMeetingList items={sparse} today={TODAY} />);
      fireEvent.click(view("Mes"));
      fireEvent.click(screen.getByRole("button", { name: "Mes siguiente" }));
      expect(screen.getByRole("heading", { level: 2, name: "Diciembre 2026" })).toBeTruthy();
      expect(screen.getByText("Sin reuniones este mes.")).toBeTruthy();
    });
  });
});
