/** @vitest-environment jsdom */
// The `/jovenes` list in the browser (ADR-0086): the filter pills are toggles, a filter makes
// another meeting the open one, and a chosen audience that disappears falls back to everything.
// The rules themselves are `jovenesMeetingList.test.ts`'s; this pins the wiring.
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
    published: true,
    seats: [{ _key: "s1", role: "encargado", memberId: "m1", name: "Ana", mine: mine.length > 0 }],
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
const pill = (name: RegExp) => within(screen.getByRole("group", { name: "Filtrar reuniones" })).getByRole("button", { name });

describe("JovenesMeetingList", () => {
  it("lists every meeting with the first one open, and «Todas» pressed", () => {
    render(<JovenesMeetingList items={ITEMS} />);
    expect(titles()).toEqual(["uno", "dos", "tres", "cuatro"]);
    expect(expanded()).toEqual(["uno"]);
    expect(pill(/^Todas/).getAttribute("aria-pressed")).toBe("true");
    expect(pill(new RegExp(`^${G1.name}`)).getAttribute("aria-pressed")).toBe("false");
  });

  it("a filter keeps its meetings, presses its pill, and opens the one that is now first", () => {
    render(<JovenesMeetingList items={ITEMS} />);
    fireEvent.click(pill(new RegExp(`^${G1.name}`)));
    expect(titles()).toEqual(["dos", "cuatro"]);
    expect(expanded()).toEqual(["dos"]);
    expect(pill(new RegExp(`^${G1.name}`)).getAttribute("aria-pressed")).toBe("true");
    expect(pill(/^Todas/).getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(pill(/^Me toca/));
    expect(titles()).toEqual(["dos"]);

    fireEvent.click(pill(/^Todas/));
    expect(titles()).toEqual(["uno", "dos", "tres", "cuatro"]);
    expect(expanded()).toEqual(["uno"]);
  });

  it("the rows carry the route stagger only until a filter is picked, so a returning row does not wait it out again", () => {
    const { container } = render(<JovenesMeetingList items={ITEMS} />);
    expect(container.querySelectorAll("[data-reveal]").length).toBeGreaterThan(ITEMS.length);
    fireEvent.click(pill(/^Me toca/));
    fireEvent.click(pill(/^Todas/));
    // Only the filter row itself keeps it; no label and no card does.
    const revealed = [...container.querySelectorAll("[data-reveal]")];
    expect(revealed.length).toBe(1);
    expect(revealed[0].getAttribute("role")).toBe("group");
  });

  it("falls back to everything when the chosen audience is no longer offered", () => {
    const { rerender } = render(<JovenesMeetingList items={ITEMS} />);
    fireEvent.click(pill(new RegExp(`^${G1.name}`)));
    expect(titles()).toEqual(["dos", "cuatro"]);
    // A refresh after the group's meetings passed: four whole-ministry meetings, one of them mine.
    const next = [
      item("a", "2026-12-05", { kind: "ministry" }, ["Encargado"]),
      item("b", "2026-12-12", { kind: "ministry" }),
      item("c", "2026-12-19", { kind: "ministry" }),
      item("d", "2026-12-26", { kind: "ministry" }),
    ];
    rerender(<JovenesMeetingList items={next} />);
    expect(titles()).toEqual(["a", "b", "c", "d"]);
    expect(pill(/^Todas/).getAttribute("aria-pressed")).toBe("true");
  });

  it("shows no filter when there is nothing to choose between", () => {
    render(<JovenesMeetingList items={ITEMS.slice(0, 3)} />);
    expect(screen.queryByRole("group", { name: "Filtrar reuniones" })).toBeNull();
    expect(titles()).toEqual(["uno", "dos", "tres"]);
  });
});
