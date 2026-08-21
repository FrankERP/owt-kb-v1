/** @vitest-environment jsdom */
// The planner's failure modes worth guarding, after the board rebuild:
//
//   1. A BLOCKED PAIR THAT VANISHES. The whole point of the redesign is that
//      "Carlos y Paola — Luis no disponible" is on screen. A future "tidy the list"
//      change would silently restore the dropdown's information content, and
//      nothing else in the suite would notice.
//   2. A seat nobody can fill that renders as a blank slot.
//   3. A touch target below the ADR-0012 floor, on the layout Niza actually uses.
//   4. A save that fails and looks like it worked. The repo's client-handler
//      invariant exists because of exactly that, so the failing PUT is asserted
//      end to end: error surfaced, loading flag reset, nothing marked clean.
//
// Both layouts render at once (one is CSS-hidden), so every query here is
// deliberately scoped by the accessible name each layout gives its controls.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import KidsPlanner, {
  formatSunday,
  historyMonthsFor,
  monthLabel,
  shiftMonth,
  sundaysOfMonth,
  type PlannerPair,
} from "../KidsPlanner";
import {
  absenceLabel,
  blockLabel,
  canPlace,
  loadLabel,
  monthSeatsLabel,
  overlapLabel,
} from "../kidsPlannerLabels";
import { buildPlannerView } from "@/app/utils/kidsPlannerView";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const pair = (id: string, room: PlannerPair["room"], a: string, b: string): PlannerPair => ({
  id,
  name: id.toUpperCase(),
  room,
  active: true,
  memberIds: [a, b],
});

const PAIRS: PlannerPair[] = [
  pair("c1", "chiquitos", "m1", "m2"),
  pair("c2", "chiquitos", "m3", "m4"),
  pair("d1", "medianos", "m5", "m6"),
  pair("g1", "grandes", "m7", "m8"),
];

const MEMBERS = [
  { _id: "m1", member_name: "Ana", unavailableDates: [] as string[] },
  { _id: "m2", member_name: "Luis", unavailableDates: ["2026-09-06"] },
  { _id: "m3", member_name: "Sofía", unavailableDates: [] as string[] },
  { _id: "m4", member_name: "Jona", unavailableDates: [] as string[] },
  // Both halves of the only medianos pair are out on the 6th, so that seat is
  // genuinely unfillable — the state that used to render as an empty select.
  { _id: "m5", member_name: "Elvira", unavailableDates: ["2026-09-06"] },
  { _id: "m6", member_name: "Benji", unavailableDates: ["2026-09-06"] },
];

describe("month + date helpers", () => {
  it("lists the Sundays of a month and nothing from its neighbours", () => {
    expect(sundaysOfMonth("2026-09")).toEqual([
      "2026-09-06",
      "2026-09-13",
      "2026-09-20",
      "2026-09-27",
    ]);
    // February 2026 has 28 days and starts on a Sunday — the loop must stop at
    // the month boundary rather than roll into March.
    expect(sundaysOfMonth("2026-02")).toEqual([
      "2026-02-01",
      "2026-02-08",
      "2026-02-15",
      "2026-02-22",
    ]);
  });

  it("crosses the year in both directions", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-09", 0)).toBe("2026-09");
  });

  it("labels a month in Spanish", () => {
    expect(monthLabel("2026-09")).toBe("Septiembre 2026");
  });

  it("renders a date at LOCAL NOON — never a UTC day-flip", () => {
    // The suite pins TZ to America/Mexico_City (UTC−6), where a bare
    // `new Date("2026-09-06")` renders as September 5.
    expect(formatSunday("2026-09-06")).toContain("6 de septiembre");
    expect(formatSunday("2026-09-06").startsWith("Domingo")).toBe(true);
  });

  it("asks for the months BEFORE the one on screen, and crosses the year", () => {
    expect(historyMonthsFor("2026-09")).toEqual(["2026-08", "2026-07", "2026-06"]);
    expect(historyMonthsFor("2026-01")).toEqual(["2025-12", "2025-11", "2025-10"]);
  });
});

describe("the words a blocked row carries", () => {
  it("names WHO is away — one name, or both", () => {
    expect(blockLabel({ kind: "unavailable", memberNames: ["Vale"] })).toBe("Vale no disponible");
    expect(blockLabel({ kind: "unavailable", memberNames: ["Vale", "Luis"] })).toBe(
      "Vale y Luis no disponibles",
    );
  });

  it("says what the pair is already doing, or where it belongs", () => {
    expect(blockLabel({ kind: "seated", seat: "grandes" })).toBe("Ya tiene RG Grandes");
    expect(blockLabel({ kind: "wrong-room", room: "chiquitos" })).toBe("Es de RG Chiquitos");
    expect(blockLabel({ kind: "retired" })).toBe("Pareja retirada");
  });

  it("says nothing when there is nothing to say", () => {
    expect(overlapLabel([])).toBeNull();
    expect(overlapLabel(["Vale"])).toBe("También en alabanza: Vale");
    expect(loadLabel(0)).toBeNull();
    expect(loadLabel(1)).toBe("1 domingo este mes");
    expect(loadLabel(2)).toBe("2 domingos este mes");
    expect(monthSeatsLabel([])).toBeNull();
    expect(absenceLabel(0)).toBeNull();
  });

  it("names the Sundays a pair already holds, and the seat on each", () => {
    expect(monthSeatsLabel([{ date: "2026-09-06", seat: "ensenanza" }])).toBe(
      "Dom 6 (Enseñanza)",
    );
    expect(
      monthSeatsLabel([
        { date: "2026-09-06", seat: "ensenanza" },
        { date: "2026-09-20", seat: "chiquitos" },
      ]),
    ).toBe("Dom 6 (Enseñanza) · Dom 20 (RG Chiquitos)");
  });

  it("counts a partial absence on the bench — a full one is a block, not a count", () => {
    expect(absenceLabel(1)).toBe("No disponible 1 domingo");
    expect(absenceLabel(2)).toBe("No disponible 2 domingos");
    expect(blockLabel({ kind: "away-all-month" })).toBe("No disponible este mes");
  });
});

describe("canPlace — the one drag the view's own verdict would refuse", () => {
  const viewPairs = PAIRS.map((p) => ({
    id: p.id,
    name: p.name,
    room: p.room,
    memberIds: [p.memberIds[0], p.memberIds[1]] as [string, string],
    active: p.active,
  }));

  const build = (seats: Record<string, string>) =>
    buildPlannerView({
      sundays: ["2026-09-06"],
      pairs: viewPairs,
      assignments: [{ date: "2026-09-06", seats }],
      unavailable: { m2: ["2026-09-06"] },
      memberNames: { m1: "Ana", m2: "Luis" },
      history: [],
    });

  const seat = (view: ReturnType<typeof build>, name: string) =>
    view.seats.find((s) => s.seat === name)!;

  it("refuses an unavailable pair, and says who is away", () => {
    const view = build({});
    expect(canPlace(seat(view, "chiquitos"), "c1", null)).toEqual({
      ok: false,
      reason: "Luis no disponible",
    });
  });

  it("refuses a pair that belongs to another room", () => {
    const view = build({});
    expect(canPlace(seat(view, "chiquitos"), "g1", null)).toMatchObject({ ok: false });
  });

  it("ALLOWS a move out of another seat on the SAME Sunday — the ordinary correction", () => {
    // c2 sits in enseñanza; dragging it to its own room reads as "already seated"
    // because the view is built from the state before the move. Refusing that would
    // make the most common fix impossible by drag while the picker allowed it.
    const view = build({ ensenanza: "c2" });
    expect(canPlace(seat(view, "chiquitos"), "c2", { date: "2026-09-06", seat: "ensenanza" })).toEqual(
      { ok: true },
    );
    // From the BENCH, with nothing being vacated, it stays refused.
    expect(canPlace(seat(view, "chiquitos"), "c2", null)).toMatchObject({ ok: false });
  });
});

describe("KidsPlanner — the board shows what a dropdown hid", () => {
  const renderPlanner = (over: Partial<Parameters<typeof KidsPlanner>[0]> = {}) =>
    render(
      <KidsPlanner
        initialMonth="2026-09"
        initialPairs={PAIRS}
        initialMembers={MEMBERS}
        initialSchedules={[]}
        initialHistory={[]}
        {...over}
      />,
    );

  /** The phone layout's seat row — the primary target, opened by tap. */
  const seatRow = (seatLabel: string, sundayLabel: string) =>
    within(screen.getByLabelText(sundayLabel)).getByRole("button", {
      name: new RegExp(`^${seatLabel}:`),
    });

  it("LISTS the unavailable pair in the picker, disabled, with the reason", () => {
    renderPlanner();
    fireEvent.click(seatRow("RG Chiquitos", "Domingo, 6 de septiembre"));

    const dialog = screen.getByRole("dialog", { name: /RG Chiquitos/ });
    // Not filtered out — that is the entire redesign.
    const blocked = within(dialog).getByRole("button", { name: /C1/ });
    expect((blocked as HTMLButtonElement).disabled).toBe(true);
    expect(blocked.textContent).toContain("Luis no disponible");
    // …and the pair that CAN serve is enabled, above it.
    const free = within(dialog).getByRole("button", { name: /C2/ });
    expect((free as HTMLButtonElement).disabled).toBe(false);
    expect(dialog.textContent!.indexOf("C2")).toBeLessThan(dialog.textContent!.indexOf("C1"));
  });

  it("marks the longest-waiting selectable pair «le toca» and dates the others", () => {
    renderPlanner({
      // c2 served chiquitos two Sundays before the 6th; c1 never has.
      initialHistory: [{ date: "2026-08-23", seats: { chiquitos: "c2" }, published: true }],
    });
    fireEvent.click(seatRow("RG Chiquitos", "Domingo, 6 de septiembre"));

    const dialog = screen.getByRole("dialog", { name: /RG Chiquitos/ });
    expect(within(dialog).getByRole("button", { name: /C2/ }).textContent).toContain(
      "hace 2 semanas",
    );
    expect(within(dialog).getByText("le toca")).toBeTruthy();
  });

  it("says a seat is unfillable instead of rendering a blank slot", () => {
    renderPlanner();
    // Both halves of the only medianos pair are out on the 6th.
    expect(
      within(screen.getByLabelText("Domingo, 6 de septiembre")).getByText(
        "Sin parejas disponibles para RG Medianos",
      ),
    ).toBeTruthy();
  });

  it("keeps every seat row at or above the ADR-0012 touch floor", () => {
    renderPlanner();
    const card = screen.getByLabelText("Domingo, 6 de septiembre");
    const rows = within(card).getAllByRole("button", { name: /Cambiar$/ });
    expect(rows).toHaveLength(4);
    for (const row of rows) expect(row.className).toMatch(/min-h-\[(4[4-9]|[5-9]\d|\d{3,})px\]/);
  });

  it("assigns from the picker and marks the month dirty", () => {
    renderPlanner();
    fireEvent.click(seatRow("RG Chiquitos", "Domingo, 6 de septiembre"));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: /RG Chiquitos/ })).getByRole("button", {
        name: /C2/,
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(seatRow("RG Chiquitos", "Domingo, 6 de septiembre").textContent).toContain("C2");
    expect(screen.getByText("Cambios sin guardar")).toBeTruthy();
  });

  /**
   * The bench used to be measured at the FIRST Sunday, so a pair placed on any
   * other one still read as free — with 12 pairs and 16 seats, the list Niza
   * scans for "who is left" was wrong for most of the month.
   */
  it("moves a placed pair out of «Disponibles» whichever Sunday it lands on", () => {
    renderPlanner({
      initialSchedules: [
        { date: "2026-09-13", published: false, seats: { chiquitos: "c1" } },
      ],
    });
    const room = within(screen.getByRole("region", { name: "Banca" })).getByRole("group", {
      name: "RG Chiquitos",
    });
    const text = room.textContent!;
    expect(text.indexOf("Falta colocar")).toBeLessThan(text.indexOf("C2"));
    expect(text.indexOf("Ya en el mes")).toBeLessThan(text.indexOf("C1"));
    expect(text.indexOf("C2")).toBeLessThan(text.indexOf("Ya en el mes"));
    // …and it says WHICH Sunday, so the correction is obvious without hunting.
    expect(text).toContain("Dom 13 (RG Chiquitos)");
  });

  /**
   * The same anchor froze a pair for the whole month over one Sunday's absence.
   * Luis is out on the 6th only; c1 must still be draggable onto the 13th, and
   * the drop is what checks the day.
   */
  it("keeps a pair away on one Sunday draggable, and says how many", () => {
    renderPlanner();
    const room = within(screen.getByRole("region", { name: "Banca" })).getByRole("group", {
      name: "RG Chiquitos",
    });
    expect(room.textContent).toContain("No disponible 1 domingo");

    // The attribute, not just the handler: `draggable` is what the browser reads,
    // and it is exactly what the first-Sunday block used to switch off.
    const chip = within(room).getByText("C1").closest("[draggable]");
    expect(chip).not.toBeNull();
    const cell = screen.getByLabelText(/^RG Chiquitos, Domingo, 13 de septiembre/);
    const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
    fireEvent.dragStart(chip!, { dataTransfer });
    fireEvent.dragOver(cell, { dataTransfer });
    fireEvent.drop(cell, { dataTransfer });

    expect(
      screen.getByLabelText(/^RG Chiquitos, Domingo, 13 de septiembre/).textContent,
    ).toContain("C1");
  });

  /** Helper: the desktop bench card for one room. */
  const benchRoom = (label: string) =>
    within(screen.getByRole("region", { name: "Banca" })).getByRole("group", { name: label });

  /**
   * The correction the "Ya en el mes" group exists for: the chip carries the seat
   * the pair already holds, so dragging it MOVES that turn instead of adding a
   * second one. Without `from`, `movePair` never vacates the source.
   */
  it("moves — not duplicates — when a placed pair is dragged off the bench", () => {
    renderPlanner({
      initialSchedules: [
        { date: "2026-09-13", published: false, seats: { chiquitos: "c1" } },
      ],
    });
    const chip = within(benchRoom("RG Chiquitos")).getByText("C1").closest("[draggable]");
    expect(chip).not.toBeNull();

    const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
    const target = screen.getByLabelText(/^RG Chiquitos, Domingo, 20 de septiembre/);
    fireEvent.dragStart(chip!, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });

    expect(
      screen.getByLabelText(/^RG Chiquitos, Domingo, 20 de septiembre/).textContent,
    ).toContain("C1");
    // The 13th was VACATED — a duplicate here is the whole failure mode. Asserted
    // on the accessible name, which spells the empty state out ("sin asignar")
    // where the visible cell only shows "+ Asignar".
    expect(
      screen.getByLabelText("RG Chiquitos, Domingo, 13 de septiembre: sin asignar"),
    ).toBeTruthy();
  });

  it("will not drag a pair that holds two Sundays — no single seat to move", () => {
    renderPlanner({
      initialSchedules: [
        { date: "2026-09-13", published: false, seats: { chiquitos: "c1" } },
        { date: "2026-09-27", published: false, seats: { ensenanza: "c1" } },
      ],
    });
    const room = benchRoom("RG Chiquitos");
    expect(room.textContent).toContain("Dom 13 (RG Chiquitos) · Dom 27 (Enseñanza)");
    expect(within(room).getByText("C1").closest("[draggable]")).toBeNull();
  });

  /**
   * The bench got much wider as a drag source when its per-Sunday blocks were
   * dropped, so the refusal has to hold from the OTHER side: the consumer, not the
   * chip. Luis is away on the 6th; the drop is refused, out loud, and nothing moves.
   */
  it("refuses an invalid drop out loud, and moves nothing", () => {
    renderPlanner();
    const chip = within(benchRoom("RG Chiquitos")).getByText("C1").closest("[draggable]");
    const cell = screen.getByLabelText(/^RG Chiquitos, Domingo, 6 de septiembre/);

    const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
    fireEvent.dragStart(chip!, { dataTransfer });
    fireEvent.drop(cell, { dataTransfer });

    expect(screen.getByRole("status").textContent).toContain("no puede tomar RG Chiquitos");
    expect(
      screen.getByLabelText("RG Chiquitos, Domingo, 6 de septiembre: sin asignar"),
    ).toBeTruthy();
    expect(screen.queryByText("Cambios sin guardar")).toBeNull();
  });

  it("does not mark the month dirty when a placed pair lands back on its own cell", () => {
    renderPlanner({
      initialSchedules: [
        { date: "2026-09-13", published: false, seats: { chiquitos: "c1" } },
      ],
    });
    const chip = within(benchRoom("RG Chiquitos")).getByText("C1").closest("[draggable]");
    const cell = screen.getByLabelText(/^RG Chiquitos, Domingo, 13 de septiembre/);

    const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
    fireEvent.dragStart(chip!, { dataTransfer });
    fireEvent.dragOver(cell, { dataTransfer });
    fireEvent.drop(cell, { dataTransfer });

    expect(screen.queryByText("Cambios sin guardar")).toBeNull();
  });

  it("keeps a blocked placed pair's Sunday on screen — that is where the problem is", () => {
    renderPlanner({
      initialSchedules: [
        { date: "2026-09-13", published: false, seats: { chiquitos: "c1" } },
      ],
      initialMembers: MEMBERS.map((m) =>
        m._id === "m2"
          ? { ...m, unavailableDates: ["2026-09-06", "2026-09-13", "2026-09-20", "2026-09-27"] }
          : m,
      ),
    });
    const room = benchRoom("RG Chiquitos");
    expect(room.textContent).toContain("No disponible este mes");
    expect(room.textContent).toContain("Dom 13 (RG Chiquitos)");
  });

  it("says so when a room has nobody left to place", () => {
    renderPlanner({
      initialSchedules: [
        { date: "2026-09-13", published: false, seats: { chiquitos: "c1" } },
        { date: "2026-09-20", published: false, seats: { chiquitos: "c2" } },
      ],
    });
    expect(benchRoom("RG Chiquitos").textContent).toContain("Todas colocadas este mes");
  });

  it("drops a bench pair into a board cell", () => {
    renderPlanner();
    // The bench is the only place an unassigned pair's name appears.
    const chip = screen.getByText("C2");
    const cell = screen.getByLabelText(/^RG Chiquitos, Domingo, 13 de septiembre/);

    const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
    fireEvent.dragStart(chip, { dataTransfer });
    fireEvent.dragOver(cell, { dataTransfer });
    fireEvent.drop(cell, { dataTransfer });

    expect(
      screen.getByLabelText(/^RG Chiquitos, Domingo, 13 de septiembre/).textContent,
    ).toContain("C2");
    expect(screen.getByText("Cambios sin guardar")).toBeTruthy();
  });
});

describe("KidsPlanner — a failed save never reads as success", () => {
  it("surfaces the failure, resets the loading flag and keeps the changes dirty", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <KidsPlanner
        initialMonth="2026-09"
        initialPairs={PAIRS}
        initialMembers={MEMBERS}
        initialSchedules={[]}
      />,
    );

    fireEvent.click(
      within(screen.getByLabelText("Domingo, 13 de septiembre")).getByRole("button", {
        name: /^RG Chiquitos:/,
      }),
    );
    fireEvent.click(
      within(screen.getByRole("dialog", { name: /RG Chiquitos/ })).getByRole("button", {
        name: /C1/,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Guardar borradores" }));

    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/No se guardaron/));
    // ONE Sunday was touched, so exactly one PUT went out — the untouched,
    // seatless Sundays must not mint empty documents.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].method).toBe("PUT");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      date: "2026-09-13",
      seats: { chiquitos: "c1" },
    });
    // The button came back, still enabled, still announcing unsaved work.
    expect(
      (screen.getByRole("button", { name: "Guardar borradores" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(screen.getByText("Cambios sin guardar")).toBeTruthy();
  });
});
