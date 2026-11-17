/** @vitest-environment jsdom */
// «Inicio» de Jóvenes (2026-11-17): which blocks show for which sections, in the order a pastor
// asks — the next meeting open, the reader's turns, the few after it, the door to the Calendario,
// the last one held. Which meeting lands in which block is `jovenesHomeModel.test.ts`'s.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { installMotionTestEnv } from "@/app/components/ui/__tests__/motionTestSetup";
import { JOVENES_CALENDAR_HREF } from "@/app/components/navSections";
import { MINISTRIES } from "@/app/ministries";
import type { HomeSections } from "@/app/utils/jovenesHomeModel";
import JovenesHome from "../JovenesHome";
import type { JovenesListItem } from "../meetingItems";

type Audience = JovenesListItem["event"]["audience"];

installMotionTestEnv();
afterEach(cleanup);

const [G1] = MINISTRIES.jovenes.groups;

function item(id: string, date: string, over: { mine?: string[]; countdown?: string; audience?: Audience } = {}): JovenesListItem {
  return {
    event: { _id: id, date, time: "18:10", arrival: null, place: null, title: id, kind: "event", audience: over.audience ?? { kind: "ministry" } },
    entry: { id, audience: "Todo Jóvenes", arrival: null, place: null, notes: null, seats: [{ key: "s1", label: "Encargado", name: "Ana", photo: null, mine: false }], program: [] },
    mine: over.mine ?? [],
    countdown: over.countdown ?? "En 2 días",
    editor: null,
  };
}

const EMPTY: HomeSections<JovenesListItem> = { next: null, upcoming: [], later: 0, turns: [], turnsTotal: 0, previous: null };
const labels = () => screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
const cards = () => screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent!.split(",")[0]);
const calendar = () => screen.queryByRole("link", { name: /^Ver el calendario/ });

describe("JovenesHome", () => {
  it("with nothing published it says so, and offers no calendar to look at", () => {
    render(<JovenesHome sections={EMPTY} />);
    expect(labels()).toEqual(["Próxima reunión"]);
    expect(screen.getByText("Aún no hay reuniones publicadas.")).toBeTruthy();
    expect(calendar()).toBeNull();
  });

  it("the next meeting is the one card open; the ones after it are folded", () => {
    render(<JovenesHome sections={{ ...EMPTY, next: item("uno", "2026-11-21"), upcoming: [item("dos", "2026-11-28"), item("tres", "2026-12-05")] }} />);
    expect(labels()).toEqual(["Próxima reunión", "Lo que sigue"]);
    expect(cards()).toEqual(["uno", "dos", "tres"]);
    expect(screen.getAllByRole("button", { name: /detalles/ }).map((b) => b.getAttribute("aria-expanded"))).toEqual(["true", "false", "false"]);
  });

  it("the door to the Calendario counts what Inicio leaves out, and says nothing when it leaves none", () => {
    const { rerender } = render(<JovenesHome sections={{ ...EMPTY, next: item("uno", "2026-11-21"), later: 4 }} />);
    expect(calendar()!.textContent).toBe("Ver el calendario · 4 reuniones más");
    expect(calendar()!.getAttribute("href")).toBe(JOVENES_CALENDAR_HREF);
    rerender(<JovenesHome sections={{ ...EMPTY, next: item("uno", "2026-11-21"), later: 1 }} />);
    expect(calendar()!.textContent).toBe("Ver el calendario · 1 reunión más");
    rerender(<JovenesHome sections={{ ...EMPTY, next: item("uno", "2026-11-21") }} />);
    expect(calendar()!.textContent).toBe("Ver el calendario");
  });

  it("«Te toca» lists the reader's turns with what they hold, between the next meeting and the rest", () => {
    const turn = item("clase", "2026-11-25", { mine: ["Encargado", "Dinámica"], countdown: "En 8 días", audience: { kind: "groups", groups: [G1.id] } });
    render(<JovenesHome sections={{ ...EMPTY, next: item("uno", "2026-11-21"), upcoming: [turn], turns: [turn], turnsTotal: 6 }} />);
    // The count is every turn ahead (six), not the ones listed (one).
    expect(labels()).toEqual(["Próxima reunión", "Te toca6", "Lo que sigue"]);
    const block = screen.getByRole("heading", { level: 2, name: /^Te toca/ }).nextElementSibling!;
    // A list holds only its items: the green rail is the list's own pseudo-element.
    expect(Array.from(block.querySelector("ul")!.children).every((c) => c.tagName === "LI")).toBe(true);
    expect(block.textContent).toContain("clase");
    expect(block.textContent).toContain("En 8 días · 18:10");
    expect(block.textContent).toContain("Encargado");
    expect(block.textContent).toContain("Dinámica");
  });

  it("the last meeting held closes the page, folded, saying how long ago", () => {
    render(<JovenesHome sections={{ ...EMPTY, next: item("uno", "2026-11-21"), previous: item("pasada", "2026-11-14", { countdown: "Hace 3 días" }) }} />);
    expect(labels()).toEqual(["Próxima reunión", "Reunión anterior"]);
    expect(cards()).toEqual(["uno", "pasada"]);
    const last = screen.getAllByRole("article").at(-1)!;
    expect(last.textContent).toContain("Hace 3 días");
    expect(last.querySelector("button")!.getAttribute("aria-expanded")).toBe("false");
  });

  it("a past meeting still shows when nothing is coming", () => {
    render(<JovenesHome sections={{ ...EMPTY, previous: item("pasada", "2026-11-14", { countdown: "Hace 3 días" }) }} />);
    expect(labels()).toEqual(["Próxima reunión", "Reunión anterior"]);
    // Not «Aún no hay»: one was held, and it is right under this line.
    expect(screen.getByText("No hay próximas reuniones publicadas.")).toBeTruthy();
    expect(cards()).toEqual(["pasada"]);
  });
});
