/** @vitest-environment jsdom */
// The planner's two failure modes worth guarding:
//   1. A dropdown that offers a pair the server will refuse (wrong room, absent
//      member, or already seated that Sunday) — the admin picks it, gets a 400,
//      and learns the rules by bouncing off them.
//   2. A save that fails and looks like it worked. The repo's client-handler
//      invariant exists because of exactly that, so the failing PUT is asserted
//      end to end: error surfaced, loading flag reset, nothing marked clean.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import KidsPlanner, {
  formatSunday,
  monthLabel,
  seatOptions,
  shiftMonth,
  sundaysOfMonth,
  type PlannerPair,
} from "../KidsPlanner";

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
});

describe("seatOptions", () => {
  const base = { pairs: PAIRS, date: "2026-09-06", unavailable: {}, seats: {} };

  it("offers only the room's pairs to a room seat, and every pair to enseñanza", () => {
    expect(seatOptions({ ...base, seat: "chiquitos" }).map((o) => o.id)).toEqual(["c1", "c2"]);
    expect(seatOptions({ ...base, seat: "ensenanza" }).map((o) => o.id)).toEqual([
      "c1",
      "c2",
      "d1",
      "g1",
    ]);
  });

  it("disables a pair whose EITHER member is unavailable, without hiding it", () => {
    const options = seatOptions({
      ...base,
      seat: "chiquitos",
      unavailable: { m2: ["2026-09-06"] },
    });
    expect(options.map((o) => o.id)).toEqual(["c1", "c2"]);
    expect(options.find((o) => o.id === "c1")).toMatchObject({ disabled: true });
    expect(options.find((o) => o.id === "c1")!.label).toContain("no disponible");
    expect(options.find((o) => o.id === "c2")).toMatchObject({ disabled: false });
  });

  it("disables a pair already seated elsewhere that Sunday, but not in its own seat", () => {
    const seats = { ensenanza: "c1" } as const;
    expect(
      seatOptions({ ...base, seat: "chiquitos", seats }).find((o) => o.id === "c1"),
    ).toMatchObject({ disabled: true });
    expect(
      seatOptions({ ...base, seat: "ensenanza", seats }).find((o) => o.id === "c1"),
    ).toMatchObject({ disabled: false });
  });

  it("keeps a stored pair that left the pool, so the select cannot drop what Sanity holds", () => {
    const retired: PlannerPair[] = [{ ...PAIRS[0], active: false }, ...PAIRS.slice(1)];
    const options = seatOptions({
      ...base,
      pairs: retired,
      seat: "chiquitos",
      seats: { chiquitos: "c1" },
    });
    expect(options[0]).toMatchObject({ id: "c1", disabled: false });
    expect(options[0].label).toContain("fuera de la rotación");
  });

  it("drops a pair that is not exactly two people — the engine cannot seat it", () => {
    const broken: PlannerPair[] = [{ ...PAIRS[0], memberIds: ["m1"] }, ...PAIRS.slice(1)];
    expect(
      seatOptions({ ...base, pairs: broken, seat: "chiquitos" }).map((o) => o.id),
    ).toEqual(["c2"]);
  });
});

describe("KidsPlanner — a failed save never reads as success", () => {
  const renderPlanner = () =>
    render(
      <KidsPlanner
        initialMonth="2026-09"
        initialPairs={PAIRS}
        initialMembers={[
          { _id: "m1", member_name: "Ana", unavailableDates: [] },
          { _id: "m2", member_name: "Luis", unavailableDates: ["2026-09-06"] },
        ]}
        initialSchedules={[]}
      />,
    );

  it("greys out the unavailable pair in the rendered dropdown", () => {
    renderPlanner();
    const select = screen.getByLabelText("RG Chiquitos", {
      selector: "#kids-seat-2026-09-06-chiquitos",
    }) as HTMLSelectElement;
    const c1 = Array.from(select.options).find((o) => o.value === "c1")!;
    expect(c1.disabled).toBe(true);
    // The same pair is pickable on a Sunday its member is available.
    const later = screen.getByLabelText("RG Chiquitos", {
      selector: "#kids-seat-2026-09-13-chiquitos",
    }) as HTMLSelectElement;
    expect(Array.from(later.options).find((o) => o.value === "c1")!.disabled).toBe(false);
  });

  it("surfaces the failure, resets the loading flag and keeps the changes dirty", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal("fetch", fetchMock);
    renderPlanner();

    fireEvent.change(
      screen.getByLabelText("RG Chiquitos", {
        selector: "#kids-seat-2026-09-13-chiquitos",
      }),
      { target: { value: "c1" } },
    );

    const save = screen.getByRole("button", { name: "Guardar borradores" });
    fireEvent.click(save);

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
