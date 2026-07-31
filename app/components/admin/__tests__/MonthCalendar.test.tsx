/** @vitest-environment jsdom */
// Task 5 — the calendar picker (E1, E2, E3, E21, P2).
//
// Two halves, deliberately:
//  - `MonthCalendar` on its own: the grid's shape, the toggles, and BOTH
//    orderings of E3's one-column-per-date refusal plus P2's.
//  - `MonthGenerator` with the calendar wired in: the things a component test
//    of the calendar alone cannot see — that Sunday selection reaches
//    `buildColumns` and NOTHING else (E21), that a specials-only month is
//    reachable end to end, and that a special never survives a month change.
//
// Every test here was checked by mutation; the mutation that kills each one is
// named in its comment. Nothing asserts inside a `fetch` mock (a thrown
// assertion there becomes a swallowed `setAutoError`/`setPushError`, not a
// failure) — captures go into an object and are asserted after the interaction
// settles.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MonthCalendar, { refuseSpecialOn, refuseWeekendOn } from "../MonthCalendar";
import MonthGenerator from "../MonthGenerator";
// The SHARED key builder, never a hand-rolled `${type}__${date}` — a second
// copy in the tests could drift from the one both surfaces read.
import { draftTargetKey } from "../plannerModel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  localStorage.clear();
});

// August 2026: five Sundays (2, 9, 16, 23, 30) and five Saturdays (1, 8, 15,
// 22, 29). The five-Sunday month is what makes a week-renumbering bug visible —
// a four-Sunday month hides it (see plannerModel.test.ts's E21 block).
const AUG_SUNDAYS = ["2026-08-02", "2026-08-09", "2026-08-16", "2026-08-23", "2026-08-30"];
const AUG_SATURDAYS = ["2026-08-01", "2026-08-08", "2026-08-15", "2026-08-22", "2026-08-29"];
const WEDNESDAY = "2026-08-12";

function renderCalendar(over: Partial<React.ComponentProps<typeof MonthCalendar>> = {}) {
  const handlers = {
    onToggleWeekend: vi.fn(),
    onAddSpecial: vi.fn(),
    onRemoveSpecial: vi.fn(),
  };
  const utils = render(
    <MonthCalendar
      year={2026}
      month={8}
      selectedSundays={AUG_SUNDAYS}
      selectedSaturdays={AUG_SATURDAYS}
      specials={[]}
      existingRoles={[]}
      {...handlers}
      {...over}
    />,
  );
  return { ...utils, ...handlers };
}

const cell = (container: HTMLElement, date: string) =>
  container.querySelector(`[data-date="${date}"]`) as HTMLElement;

function composeSpecial(date: string, name: string) {
  fireEvent.click(screen.getByRole("button", { name: /Servicio especial/ }));
  fireEvent.change(screen.getByLabelText("Fecha del servicio especial"), { target: { value: date } });
  fireEvent.change(screen.getByLabelText("Nombre del servicio especial"), { target: { value: name } });
  fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
}

describe("MonthCalendar — shape", () => {
  it("lays every day of the month out under its real weekday column", () => {
    const { container } = renderCalendar();
    // 2026-08-01 is a Saturday, so six blank cells precede day 1. A bare
    // `new Date(iso)` (UTC) would shift every date one column left in
    // America/Mexico_City — this is the assertion that catches it.
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(6);
    expect(container.querySelectorAll("[data-date]")).toHaveLength(31);
    expect(cell(container, "2026-08-01").getAttribute("data-day-kind")).toBe("saturday");
    expect(cell(container, "2026-08-02").getAttribute("data-day-kind")).toBe("sunday");
    expect(cell(container, WEDNESDAY).getAttribute("data-day-kind")).toBe("weekday");
  });

  it("shows Sundays and Saturdays selected, and toggles the one that was tapped", () => {
    const { container, onToggleWeekend } = renderCalendar();
    expect(cell(container, "2026-08-16").getAttribute("data-selected")).toBe("true");
    expect(cell(container, "2026-08-15").getAttribute("data-selected")).toBe("true");
    expect(cell(container, WEDNESDAY).getAttribute("data-selected")).toBe("false");

    fireEvent.click(cell(container, "2026-08-16"));
    expect(onToggleWeekend).toHaveBeenCalledWith("2026-08-16");
    expect(onToggleWeekend).toHaveBeenCalledTimes(1);
  });

  it("marks a date that already holds a service, naming what is there", () => {
    const { container } = renderCalendar({
      existingRoles: [
        { _type: "special_role", date: "2026-08-05", service_name: "Bautizos" },
        { _type: "sunday_role", date: "2026-08-09" },
      ],
    });
    expect(cell(container, "2026-08-05").getAttribute("data-existing")).toBe("special_role");
    expect(cell(container, "2026-08-05").getAttribute("title")).toContain("Bautizos");
    expect(cell(container, "2026-08-09").getAttribute("data-existing")).toBe("sunday_role");
    expect(cell(container, "2026-08-12").getAttribute("data-existing")).toBeNull();
  });
});

describe("MonthCalendar — specials (E2)", () => {
  it("tapping a weekday opens the composer already pointed at that date", () => {
    const { container, onAddSpecial } = renderCalendar();
    fireEvent.click(cell(container, WEDNESDAY));
    expect((screen.getByLabelText("Fecha del servicio especial") as HTMLSelectElement).value).toBe(
      WEDNESDAY,
    );
    fireEvent.change(screen.getByLabelText("Nombre del servicio especial"), {
      target: { value: "Bautizos" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    expect(onAddSpecial).toHaveBeenCalledWith(WEDNESDAY, "Bautizos");
  });

  it("refuses an unnamed special — a special_role with no service_name has no identity", () => {
    const { container, onAddSpecial } = renderCalendar();
    fireEvent.click(cell(container, WEDNESDAY));
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    expect(onAddSpecial).not.toHaveBeenCalled();
    expect(screen.getByText(/Escribe un nombre/)).toBeTruthy();
  });

  it("a DESELECTED Saturday can become a special (the positive control for E3)", () => {
    const { onAddSpecial } = renderCalendar({
      selectedSaturdays: AUG_SATURDAYS.filter((d) => d !== "2026-08-15"),
    });
    composeSpecial("2026-08-15", "Boda");
    expect(onAddSpecial).toHaveBeenCalledWith("2026-08-15", "Boda");
  });

  it("lists each special with a Quitar control that removes exactly that date", () => {
    const { onRemoveSpecial } = renderCalendar({
      specials: [
        { date: WEDNESDAY, name: "Bautizos" },
        { date: "2026-08-19", name: "Boda" },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: /Quitar servicio especial del 19 de agosto/ }));
    expect(onRemoveSpecial).toHaveBeenCalledWith("2026-08-19");
    expect(onRemoveSpecial).toHaveBeenCalledTimes(1);
  });
});

describe("MonthCalendar — E3 refuses one column per date, in BOTH orderings", () => {
  // Ordering 1: the weekend column exists first, the special is attempted
  // second. Mutation: drop the `weekendSelected` branch from `refuseSpecialOn`
  // and this goes red (the special is accepted and `buildColumns` drops it with
  // only a console.warn).
  it("weekend-then-special: a selected Sunday refuses a special, with a stated reason", () => {
    const { onAddSpecial } = renderCalendar();
    composeSpecial("2026-08-16", "Bautizos");
    expect(onAddSpecial).not.toHaveBeenCalled();
    expect(screen.getByText(/ya genera un servicio de domingo/)).toBeTruthy();
  });

  // Ordering 2: the special exists first, the weekend date is re-selected
  // second. This is the ordering a "just let the dedupe handle it" fix misses
  // entirely. Mutation: delete the `refuseWeekendOn` call in `handleDayClick`
  // and the toggle fires, producing two claims on one date.
  it("special-then-weekend: re-selecting a Saturday that holds a special refuses, with a stated reason", () => {
    const { container, onToggleWeekend } = renderCalendar({
      selectedSaturdays: AUG_SATURDAYS.filter((d) => d !== "2026-08-15"),
      specials: [{ date: "2026-08-15", name: "Boda" }],
    });
    fireEvent.click(cell(container, "2026-08-15"));
    expect(onToggleWeekend).not.toHaveBeenCalled();
    expect(screen.getByText(/ya tiene un servicio especial \(«Boda»\)/)).toBeTruthy();
  });

  it("DESELECTING a Saturday that holds no special is not refused", () => {
    const { container, onToggleWeekend } = renderCalendar({
      specials: [{ date: WEDNESDAY, name: "Bautizos" }],
    });
    fireEvent.click(cell(container, "2026-08-15"));
    expect(onToggleWeekend).toHaveBeenCalledWith("2026-08-15");
  });

  it("the pure predicates say the same thing the UI does", () => {
    const specials = [{ date: "2026-08-15", name: "Boda" }];
    expect(
      refuseSpecialOn({ date: "2026-08-16", weekendSelected: true, specials: [], existingRoles: [] }),
    ).toMatch(/ya genera un servicio de domingo/);
    expect(
      refuseSpecialOn({ date: "2026-08-15", weekendSelected: false, specials, existingRoles: [] }),
    ).toMatch(/ya tiene un servicio especial en este mes/);
    expect(
      refuseSpecialOn({ date: WEDNESDAY, weekendSelected: false, specials, existingRoles: [] }),
    ).toBeNull();
    expect(refuseWeekendOn({ date: "2026-08-15", specials })).toMatch(/«Boda»/);
    expect(refuseWeekendOn({ date: "2026-08-22", specials })).toBeNull();
  });
});

describe("MonthCalendar — P2 refuses a second special on a stored one's date", () => {
  // The generator's preflight for a special is name-BLIND (`special_role:<date>`
  // — `monthTargetPreflight`), so it cannot tell a second special on that date
  // from the stored one. The picker refuses instead of drafting against an
  // observation that cannot discriminate. Mutation: drop the `existingRoles`
  // branch from `refuseSpecialOn` and this goes red.
  it("refuses, and names the special that already exists", () => {
    const { onAddSpecial } = renderCalendar({
      existingRoles: [{ _type: "special_role", date: WEDNESDAY, service_name: "Bautizos" }],
    });
    composeSpecial(WEDNESDAY, "Boda");
    expect(onAddSpecial).not.toHaveBeenCalled();
    expect(screen.getByText(/ya tiene un servicio especial guardado: «Bautizos»/)).toBeTruthy();
  });

  // The session-local created-set (`MonthGenerator`'s `createdTargets`) is the
  // THIRD input to this refusal, and the only one that survives the walk that
  // matters: after "Quitar", `specials` no longer holds the date, and
  // `existingRoles` is refreshed asynchronously by `onCreated()`, so both say
  // "free" on exactly the path where a second document would be created.
  // Mutation: drop `createdTargets` from `refuseSpecialOn`'s inputs and both of
  // these go red.
  it("refuses a special on a date THIS SESSION already created, in the grid's own words", () => {
    const { onAddSpecial } = renderCalendar({
      createdTargets: new Set([draftTargetKey("special_role", WEDNESDAY)]),
    });
    composeSpecial(WEDNESDAY, "Boda");
    expect(onAddSpecial).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe(
      "El 12 de agosto ya tiene un servicio especial. Ya lo creaste en esta sesión.",
    );
  });

  it("the created-set is keyed by TYPE and date — a created weekend target does not block a special", () => {
    // `type__date`, never the bare date: a `saturday_role` this session created
    // on a date the admin then deselected leaves that date free for a special,
    // exactly as a stored `saturday_role` does two tests down.
    const { onAddSpecial } = renderCalendar({
      selectedSaturdays: AUG_SATURDAYS.filter((d) => d !== "2026-08-15"),
      createdTargets: new Set([draftTargetKey("saturday_role", "2026-08-15")]),
    });
    composeSpecial("2026-08-15", "Boda");
    expect(onAddSpecial).toHaveBeenCalledWith("2026-08-15", "Boda");
  });

  it("the pure predicate reports the session-created refusal, and defaults to not refusing", () => {
    const createdTargets = new Set([draftTargetKey("special_role", WEDNESDAY)]);
    expect(
      refuseSpecialOn({ date: WEDNESDAY, weekendSelected: false, specials: [], existingRoles: [], createdTargets }),
    ).toMatch(/Ya lo creaste en esta sesión\./);
    // Ahead of the pending-list branch: "quítalo de la lista para cambiarlo" is
    // a lie once the document exists, so the created reason must win.
    expect(
      refuseSpecialOn({
        date: WEDNESDAY,
        weekendSelected: false,
        specials: [{ date: WEDNESDAY, name: "Bautizos" }],
        existingRoles: [],
        createdTargets,
      }),
    ).toMatch(/Ya lo creaste en esta sesión\./);
    // Omitted entirely — every caller that predates the set is unaffected.
    expect(
      refuseSpecialOn({ date: WEDNESDAY, weekendSelected: false, specials: [], existingRoles: [] }),
    ).toBeNull();
  });

  it("an existing WEEKEND role on a deselected date does not block a special there", () => {
    const { onAddSpecial } = renderCalendar({
      selectedSaturdays: AUG_SATURDAYS.filter((d) => d !== "2026-08-15"),
      existingRoles: [{ _type: "saturday_role", date: "2026-08-15" }],
    });
    composeSpecial("2026-08-15", "Boda");
    expect(onAddSpecial).toHaveBeenCalledWith("2026-08-15", "Boda");
  });
});

// ─── Wired into MonthGenerator ───────────────────────────────────────────────

function setMonthYear(container: HTMLElement, month: number, year: number) {
  const monthSelect = container.querySelector("select") as HTMLSelectElement;
  fireEvent.change(monthSelect, { target: { value: String(month) } });
  const yearInput = container.querySelector('input[type="number"]') as HTMLInputElement;
  fireEvent.change(yearInput, { target: { value: String(year) } });
}

function deselectAll(container: HTMLElement, kind: "sunday" | "saturday") {
  const dates = Array.from(container.querySelectorAll(`[data-day-kind="${kind}"]`)).map((el) =>
    el.getAttribute("data-date"),
  );
  for (const date of dates) {
    const c = container.querySelector(`[data-date="${date}"]`);
    if (c?.getAttribute("data-selected") === "true") fireEvent.click(c);
  }
}

describe("MonthGenerator + calendar — E21: the week spine stays the FULL month", () => {
  const ANA = { _id: "ana", member_name: "Ana", memberType: ["voz", "sunday_lead"] };

  /** Captures the solve request; asserts happen after the interaction settles. */
  function stubSolve(schedule: Record<string, unknown>) {
    const captured: { request: { weeks: number; dsl_rules: string[] } | null } = { request: null };
    const fetchMock = vi.fn(async (url: string, init?: { body: string }) => {
      if (url === "/api/admin/solve") {
        captured.request = JSON.parse(init!.body) as { weeks: number; dsl_rules: string[] };
        return {
          ok: true,
          json: async () => ({ ok: true, schedule, total_counts: {}, role_counts: {}, unfilled_seats: [] }),
        };
      }
      throw new Error(`unexpected fetch to ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    return { captured, fetchMock };
  }

  // THE invariant of this task. Ana is unavailable on the THIRD Sunday; the
  // FIRST Sunday is deselected. The request must still say `weeks: 5` and
  // `week 3`. Mutation: pass `selectedSundays` to `buildSolveRequest` instead of
  // `sundayDatesFull` — `weeks` becomes 4 and the rule becomes `week 2`, and
  // both assertions below fail.
  it("deselecting a Sunday renumbers no week in the solve request", async () => {
    const { captured, fetchMock } = stubSolve({});
    const members = [{ ...ANA, unavailableDates: ["2026-08-16"] }];
    const { container } = render(
      <MonthGenerator members={members} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    setMonthYear(container, 8, 2026);
    deselectAll(container, "saturday");
    fireEvent.click(cell(container, "2026-08-02")); // drop the FIRST Sunday
    fireEvent.click(screen.getByLabelText("Ana"));
    fireEvent.click(screen.getByRole("button", { name: /Previsualizar/ }));

    // The deselected Sunday really is gone from the grid — otherwise this test
    // would pass without the selection having done anything at all.
    expect(container.querySelector('[data-date="2026-08-02"]')).toBeNull();
    expect(container.querySelector('[data-date="2026-08-16"]')).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Auto-asignar con Solver/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/admin/solve", expect.anything()));

    expect(captured.request?.weeks).toBe(5);
    expect(captured.request?.dsl_rules).toContain("Ana !in week 3 Sun.*");
    expect(captured.request?.dsl_rules).not.toContain("Ana !in week 2 Sun.*");
  });

  // The response side of the same invariant: week 3's roster must land on the
  // third Sunday of the MONTH, not the third SELECTED Sunday. Mutation: give
  // `applySolveResponse` the selected subset and week 3 lands on 2026-08-23.
  it("week 3's roster lands on the month's third Sunday even with the first deselected", async () => {
    const { fetchMock } = stubSolve({
      "3": { Sunday: { Lead: ["Ana"], BGV: [], Choir: [] } },
    });
    const { container } = render(
      <MonthGenerator members={[ANA]} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    setMonthYear(container, 8, 2026);
    deselectAll(container, "saturday");
    fireEvent.click(cell(container, "2026-08-02"));
    fireEvent.click(screen.getByLabelText("Ana"));
    fireEvent.click(screen.getByRole("button", { name: /Previsualizar/ }));
    fireEvent.click(screen.getByRole("button", { name: /Auto-asignar con Solver/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/admin/solve", expect.anything()));

    await waitFor(() =>
      expect(
        container.querySelector('[data-row-id="lead"][data-date="2026-08-16"]')?.textContent,
      ).toContain("Ana"),
    );
    expect(
      container.querySelector('[data-row-id="lead"][data-date="2026-08-23"]')?.textContent ?? "",
    ).not.toContain("Ana");
  });
});

describe("MonthGenerator + calendar — a specials-only month", () => {
  // The user's headline ask, and the thing BOTH obvious refactors of the
  // `sundays`/`saturdays` booleans kill. Mutations that turn this red:
  //  - gate on `selectedSundays.length + activeSatDates.length === 0` (the
  //    "derived booleans" refactor): Previsualizar is disabled and
  //    `handlePreview` returns in silence;
  //  - gate on `!selectedSundays && !activeSatDates` (the `string[]` refactor):
  //    that expression is always false, so this test's FIRST half passes and
  //    the "no dates at all" test below fails instead.
  it("previews, fills and confirms with zero weekend dates and one weekday special", async () => {
    const calls: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (url: string, init: { body: string }) => {
      if (url !== "/api/admin/roles") throw new Error(`unexpected fetch to ${url}`);
      calls.push(JSON.parse(init.body) as Record<string, unknown>);
      return { ok: true, status: 200, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const members = [{ _id: "ana", member_name: "Ana", memberType: ["voz"] }];
    const { container } = render(
      <MonthGenerator members={members} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    setMonthYear(container, 8, 2026);
    deselectAll(container, "sunday");
    deselectAll(container, "saturday");
    composeSpecial(WEDNESDAY, "Bautizos");

    const preview = screen.getByRole("button", { name: /Previsualizar/ }) as HTMLButtonElement;
    expect(preview.disabled).toBe(false);
    fireEvent.click(preview);

    // Exactly one column, and it is the special.
    expect(container.querySelectorAll("[data-swap-date]")).toHaveLength(1);
    expect(container.querySelector(`[data-swap-date="${WEDNESDAY}"]`)).toBeTruthy();

    // Fill it by hand — a special is never solvable (E4/E5), so this is the
    // only way it gets a roster.
    fireEvent.click(container.querySelector(`[data-row-id="lead"][data-date="${WEDNESDAY}"]`)!);
    fireEvent.click(within(container.querySelector("ul")!).getByText("Ana"));
    fireEvent.click(screen.getByText("Cerrar"));

    fireEvent.click(screen.getByRole("button", { name: /^Crear 1 borrador/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(calls[0]._type).toBe("special_role");
    expect(calls[0].date).toBe(WEDNESDAY);
    expect(calls[0].service_name).toBe("Bautizos");
    expect(calls[0].leads).toEqual(["ana"]);
  });

  it("Previsualizar is disabled only when there is NO column of any kind", () => {
    const { container } = render(
      <MonthGenerator members={[]} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    setMonthYear(container, 8, 2026);
    deselectAll(container, "sunday");
    deselectAll(container, "saturday");
    expect(
      (screen.getByRole("button", { name: /Previsualizar/ }) as HTMLButtonElement).disabled,
    ).toBe(true);

    composeSpecial(WEDNESDAY, "Bautizos");
    expect(
      (screen.getByRole("button", { name: /Previsualizar/ }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});

describe("MonthGenerator + calendar — picks are scoped to one month", () => {
  // Work item 1a. Without the `setSpecials([])` reset, `buildColumns` emits an
  // August-dated column among September's — invisible on the now-September
  // calendar, and `handleConfirm` posts it. The server accepts a well-formed
  // date, so a special_role is created for a month the admin navigated away
  // from. Asserted on the COLUMN SET (no date outside the month, from any
  // source) and on what is actually POSTed.
  it("a special added in August does not survive a switch to September", async () => {
    const calls: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (url: string, init: { body: string }) => {
      if (url !== "/api/admin/roles") throw new Error(`unexpected fetch to ${url}`);
      calls.push(JSON.parse(init.body) as Record<string, unknown>);
      return { ok: true, status: 200, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(
      <MonthGenerator members={[]} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    setMonthYear(container, 8, 2026);
    composeSpecial(WEDNESDAY, "Bautizos");
    expect(container.querySelector('[data-special="Bautizos"]')).toBeTruthy();

    // Switch to September — the special must be gone from the picker…
    fireEvent.change(container.querySelector("select") as HTMLSelectElement, { target: { value: "9" } });
    expect(screen.queryAllByText(/Bautizos/)).toHaveLength(0);
    expect(container.querySelector("[data-special]")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Previsualizar/ }));

    // …from the column set — from ANY source, not just the specials list…
    const columnDates = Array.from(container.querySelectorAll("[data-swap-date]")).map((el) =>
      el.getAttribute("data-swap-date"),
    );
    expect(columnDates.length).toBeGreaterThan(0);
    expect(columnDates.every((d) => d?.startsWith("2026-09"))).toBe(true);

    // …and from the POST.
    fireEvent.click(screen.getByRole("button", { name: /^Crear \d+ borrador/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => String(c.date).startsWith("2026-09"))).toBe(true);
    expect(calls.every((c) => c._type !== "special_role")).toBe(true);
  });

  // The Sunday side of the same hazard: selection is stored as DESELECTIONS and
  // derived from the month's own spine, so a stale date cannot leak. This also
  // pins that the reset restores a full month rather than carrying a gap over.
  it("a Sunday deselected in August does not leave September's third Sunday missing", () => {
    const { container } = render(
      <MonthGenerator members={[]} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    setMonthYear(container, 8, 2026);
    fireEvent.click(cell(container, "2026-08-16"));
    expect(cell(container, "2026-08-16").getAttribute("data-selected")).toBe("false");

    fireEvent.change(container.querySelector("select") as HTMLSelectElement, { target: { value: "9" } });
    for (const sunday of ["2026-09-06", "2026-09-13", "2026-09-20", "2026-09-27"]) {
      expect(cell(container, sunday).getAttribute("data-selected")).toBe("true");
    }
  });
});

describe("MonthGenerator + calendar — unavailability notices follow the columns", () => {
  // Work item 6: the notices used to be fed the FULL Sunday spine and no
  // specials at all, so they reported people for dates that generate nothing
  // and stayed silent about the one date the admin just created by hand.
  it("reports the special's date and stays silent about a deselected Sunday", () => {
    const members = [
      {
        _id: "ana",
        member_name: "Ana",
        memberType: ["voz"],
        unavailableDates: [WEDNESDAY, "2026-08-02"],
      },
    ];
    const { container } = render(
      <MonthGenerator members={members} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    setMonthYear(container, 8, 2026);
    deselectAll(container, "saturday");
    fireEvent.click(cell(container, "2026-08-02")); // deselect the first Sunday
    composeSpecial(WEDNESDAY, "Bautizos");
    fireEvent.click(screen.getByRole("button", { name: /Previsualizar/ }));

    const notices = screen.getByText(/No disponibles este mes/).parentElement!;
    // "Dom" is the label `buildUnavailabilityNotices` gives a Sunday entry —
    // its absence is what proves the deselected 2026-08-02 produced none.
    // (A bare "2 ago" check would match "12 ago" and pass vacuously.)
    expect(notices.textContent).toContain("Bautizos 12 ago");
    expect(notices.textContent).not.toContain("Dom");
  });
});
