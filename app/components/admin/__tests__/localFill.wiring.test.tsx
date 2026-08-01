/** @vitest-environment jsdom */
// The filler, WIRED — `localFill.test.ts` proves the pure function; this file
// proves the paths that carry its output to the screen and to Sanity.
//
// A pure-function suite stays green while `handleAuto` never calls the filler,
// or calls it and drops the result: `setUnfilled` had exactly one populating
// write site, on the SUCCESS branch only, and `mapUnfilledSeats` cannot express
// a weekday special's date at all (it resolves through the Sunday spine or
// `saturdayForWeek`). And because `handleAuto` writes cells directly instead of
// routing through `handleCellsChange`, a missing `setDrafts` renders a filled
// special in the grid while posting an EMPTY document. Both are green-test
// failures by construction, so they are asserted here.
//
// The rules exercised here are the REAL `DEFAULT_SOLVER_CONFIG` — localStorage
// is cleared, so `MonthGenerator` seeds itself from the shipped defaults, and
// the Lucía/Niza `*.LeadBGV` conflict below is the production rule, resolved
// through the production alias path (fact 12).
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MonthGenerator from "../MonthGenerator";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  localStorage.clear();
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** March 2026 begins on a Sunday and holds five; the special is a Wednesday. */
const SPECIAL_DATE = "2026-03-18";
const FIRST_SUNDAY = "2026-03-01";

const m = (id: string, member_name: string, alias: string, memberType = ["voz"]) => ({
  _id: id,
  member_name,
  alias,
  memberType,
});

/** alias ≠ member_name for every member — the property the rules hang on. */
const LUCIA = m("lucia", "María Lucía Estrada", "Lucía");
const NIZA = m("niza", "Nizarindani Cruz Ávila", "Niza");
const ANA = m("ana", "Ana Karen Villalobos", "Ana", ["voz", "sunday_lead"]);
const BETO = m("beto", "Alberto Ruiz Cano", "Beto");
const CARLA = m("carla", "Carla Méndez Soto", "Carla");
const DORA = m("dora", "Dorotea Salas Nava", "Dora");
const ELSA = m("elsa", "Elsa Guzmán Ríos", "Elsa");
const FINA = m("fina", "Josefina Torres Lugo", "Fina");

// ─── DOM helpers ─────────────────────────────────────────────────────────────

function setMonthYear(container: HTMLElement, month: number, year: number) {
  fireEvent.change(container.querySelector("select") as HTMLSelectElement, {
    target: { value: String(month) },
  });
  fireEvent.change(container.querySelector('input[type="number"]') as HTMLInputElement, {
    target: { value: String(year) },
  });
}

function deselectAll(container: HTMLElement, kind: "sunday" | "saturday") {
  const dates = Array.from(container.querySelectorAll(`[data-day-kind="${kind}"]`)).map((el) =>
    el.getAttribute("data-date"),
  );
  for (const date of dates) {
    const cell = container.querySelector(`[data-date="${date}"]`);
    if (cell?.getAttribute("data-selected") === "true") fireEvent.click(cell);
  }
}

/** Adds a weekday special through the REAL composer, as an admin would. */
function addSpecial(container: HTMLElement, date: string, name: string) {
  fireEvent.click(container.querySelector(`[data-date="${date}"]`)!);
  fireEvent.change(screen.getByLabelText("Nombre del servicio especial"), {
    target: { value: name },
  });
  fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
}

/** Ticks a member in the "Líderes Domingo" pool, so `buildSolveRequest` passes. */
function selectSundayLead(container: HTMLElement, displayName: string) {
  const heading = Array.from(container.querySelectorAll("p")).find(
    (p) => p.textContent === "Líderes Domingo",
  )!;
  const pool = heading.closest("div")!.parentElement as HTMLElement;
  const label = within(pool).getByText(displayName).closest("label") as HTMLElement;
  fireEvent.click(within(label).getByRole("checkbox"));
}

function preview() {
  fireEvent.click(screen.getByRole("button", { name: /Previsualizar/ }));
}

/** Auto is behind a confirmation step. */
function runAuto() {
  fireEvent.click(screen.getByRole("button", { name: /Auto-asignar/ }));
  fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
}

const cellAt = (container: HTMLElement, rowId: string, date: string) =>
  container.querySelector(`[data-row-id="${rowId}"][data-date="${date}"]`) as HTMLElement;

const createButton = () => screen.getByRole("button", { name: /^Crear \d+ borrador/ });

interface RolesCall {
  date: string;
  body: Record<string, unknown>;
}

/** Stubs `fetch`: the solve endpoint answers `solve`, roles-create records. */
function stubFetch(solve: () => unknown) {
  const calls: RolesCall[] = [];
  const fetchMock = vi.fn(async (url: string, init: { body: string }) => {
    if (url === "/api/admin/solve") return solve();
    if (url === "/api/admin/roles") {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      calls.push({ date: body.date as string, body });
      return { ok: true, status: 200, json: async () => ({}) };
    }
    throw new Error(`unexpected fetch to ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

const unreachableSolve = () => {
  throw new Error("the solver must not be called");
};

// ─── Exit 1: the pre-flight refusal ──────────────────────────────────────────

describe("Auto on a month whose only column is a special", () => {
  /**
   * No Sunday is selected and no Sunday lead is configured, so
   * `buildSolveRequest` refuses before the network — E5's "a month with no
   * Sunday leads must still fill its specials", and the exit that reaches the
   * filler without a solve ever running.
   *
   * The member pool is the seeded `*.LeadBGV` conflict pair and nobody else,
   * both at load 0: Lead's target is 2, so a filler that did not re-evaluate
   * per placement would seat exactly the pair the user asked to keep apart.
   */
  function setup() {
    const { fetchMock, calls } = stubFetch(unreachableSolve);
    const view = render(
      <MonthGenerator
        members={[LUCIA, NIZA]}
        existingRoles={[]}
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );
    setMonthYear(view.container, 3, 2026);
    deselectAll(view.container, "saturday");
    deselectAll(view.container, "sunday");
    addSpecial(view.container, SPECIAL_DATE, "Vigilia");
    preview();
    return { ...view, fetchMock, calls };
  }

  it("fills the special even though the solve never ran, and never seats the forbidden pair together", async () => {
    const { container, fetchMock } = setup();
    runAuto();

    await waitFor(() =>
      expect(screen.getByText("Debes seleccionar al menos un líder de domingo.")).toBeTruthy(),
    );
    expect(fetchMock).not.toHaveBeenCalled();

    const lead = cellAt(container, "lead", SPECIAL_DATE);
    expect(lead.textContent).toContain("Lucía");
    expect(lead.textContent).not.toContain("Niza");
    expect(container.textContent).not.toContain("Niza");
  });

  it("renders the under-filled seat as «Sin cubrir» and counts it — the filler's own unfilled channel", async () => {
    const { container } = setup();
    runAuto();

    // Lead: 1 of 2 (Niza refused). BGV: 0 of 3. Four seats reported.
    await waitFor(() =>
      expect(screen.getByText("Lugares sin cubrir (faltó gente): 4")).toBeTruthy(),
    );
    expect(cellAt(container, "lead", SPECIAL_DATE).textContent).toContain("Sin cubrir");
    expect(cellAt(container, "bgv", SPECIAL_DATE).textContent).toContain("Sin cubrir");
  });

  it("POSTS the filler's seats — the `setDrafts` half, which the grid alone cannot show", async () => {
    const { calls } = setup();
    runAuto();
    await waitFor(() =>
      expect(screen.getByText("Debes seleccionar al menos un líder de domingo.")).toBeTruthy(),
    );

    fireEvent.click(createButton());
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].date).toBe(SPECIAL_DATE);
    expect(calls[0].body._type).toBe("special_role");
    expect(calls[0].body.leads).toEqual(["lucia"]);
    expect(calls[0].body.bgvs).toEqual([]);
  });

  it("does not double-count its unfilled seats when Auto is pressed twice", async () => {
    setup();
    runAuto();
    await waitFor(() =>
      expect(screen.getByText("Lugares sin cubrir (faltó gente): 4")).toBeTruthy(),
    );
    runAuto();
    await waitFor(() =>
      expect(screen.getByText("Lugares sin cubrir (faltó gente): 4")).toBeTruthy(),
    );
  });
});

// ─── The UI names it as a different mechanism ────────────────────────────────

describe("the Auto confirmation copy", () => {
  function openConfirm(members: { _id: string }[], withSpecial: boolean) {
    stubFetch(unreachableSolve);
    const view = render(
      <MonthGenerator
        members={members as never}
        existingRoles={[]}
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );
    setMonthYear(view.container, 3, 2026);
    deselectAll(view.container, "saturday");
    if (withSpecial) addSpecial(view.container, SPECIAL_DATE, "Vigilia");
    preview();
    fireEvent.click(screen.getByRole("button", { name: /Auto-asignar/ }));
    return view;
  }

  it("tells the admin a special is filled locally, not by the solver", () => {
    openConfirm([ANA, LUCIA, NIZA, BETO], true);
    expect(screen.getByText(/no pasan por el solver/)).toBeTruthy();
    expect(screen.getByText(/Sin cubrir/)).toBeTruthy();
  });

  it("says nothing about specials on a month that has none", () => {
    openConfirm([ANA, LUCIA, NIZA, BETO], false);
    expect(screen.queryByText(/no pasan por el solver/)).toBeNull();
  });
});

// ─── Exit 4: the network throw ───────────────────────────────────────────────

describe("Auto when the solve fails on the network", () => {
  it("still fills the special — a throw is a solve failure like any other", async () => {
    const { fetchMock } = stubFetch(() => {
      throw new Error("network down");
    });
    const { container } = render(
      <MonthGenerator
        members={[ANA, LUCIA, NIZA, BETO]}
        existingRoles={[]}
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );
    setMonthYear(container, 3, 2026);
    deselectAll(container, "saturday");
    selectSundayLead(container, "Ana");
    addSpecial(container, SPECIAL_DATE, "Vigilia");
    preview();

    runAuto();

    await waitFor(() => expect(screen.getByText("Error de red al llamar al solver.")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Everyone is at load 0, so Lead takes the first two by name; Lucía then
    // takes a BGV seat and the conflict refuses Niza for the rest of the column.
    const lead = cellAt(container, "lead", SPECIAL_DATE);
    expect(lead.textContent).toContain("Ana");
    expect(lead.textContent).toContain("Beto");
    // The conflict still holds on the failure path.
    expect(cellAt(container, "bgv", SPECIAL_DATE).textContent).toContain("Lucía");
    expect(cellAt(container, "bgv", SPECIAL_DATE).textContent).not.toContain("Niza");
    expect(lead.textContent).not.toContain("Niza");
  });
});

// ─── Exit 3: the success path ────────────────────────────────────────────────

describe("Auto when the solve succeeds", () => {
  it("keeps the solver's weekend roster AND fills the special, merging both unfilled reports", async () => {
    const { fetchMock } = stubFetch(() => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        schedule: { "1": { Sunday: { Lead: ["Ana"], BGV: [], Choir: [] } } },
        unfilled_seats: ["W1 Sunday Sun.Choir #1"],
      }),
    }));
    const { container } = render(
      <MonthGenerator
        members={[ANA, LUCIA, NIZA, BETO]}
        existingRoles={[]}
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );
    setMonthYear(container, 3, 2026);
    deselectAll(container, "saturday");
    selectSundayLead(container, "Ana");
    addSpecial(container, SPECIAL_DATE, "Vigilia");
    preview();

    runAuto();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // The weekend roster the solve just produced SURVIVES the filler: feeding
    // `fillColumn` the pre-solve `cells` and calling `setCells` with the result
    // would empty this.
    await waitFor(() =>
      expect(cellAt(container, "lead", FIRST_SUNDAY).textContent).toContain("Ana"),
    );

    // And the special is filled, by the filler, with the rule holding.
    const specialLead = cellAt(container, "lead", SPECIAL_DATE);
    expect(specialLead.textContent).toContain("Lucía");
    expect(specialLead.textContent).not.toContain("Niza");

    // Both unfilled reports reach the UI: the solver's Sunday Coro seat and the
    // filler's own BGV seats on a date `mapUnfilledSeats` cannot even express.
    expect(cellAt(container, "coro", FIRST_SUNDAY).textContent).toContain("Sin cubrir");
    expect(cellAt(container, "bgv", SPECIAL_DATE).textContent).toContain("Sin cubrir");
  });
});

// ─── Two specials in one month ───────────────────────────────────────────────

describe("two specials in one month", () => {
  it("fills both, and the load the first one creates moves the second one's picks", async () => {
    stubFetch(unreachableSolve);
    // SIX rule-free members for the first special's five seats: exactly one
    // sits it out, and the only thing that can promote her on the second
    // special is the load the first one created.
    const { container } = render(
      <MonthGenerator
        members={[ANA, BETO, CARLA, DORA, ELSA, FINA]}
        existingRoles={[]}
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );
    setMonthYear(container, 3, 2026);
    deselectAll(container, "saturday");
    deselectAll(container, "sunday");
    addSpecial(container, SPECIAL_DATE, "Vigilia");
    addSpecial(container, "2026-03-25", "Bautizos");
    preview();

    runAuto();
    await waitFor(() =>
      expect(cellAt(container, "lead", SPECIAL_DATE).textContent).toContain("Ana"),
    );

    const firstColumn = ["lead", "bgv"]
      .map((rowId) => cellAt(container, rowId, SPECIAL_DATE).textContent ?? "")
      .join("");
    const secondLead = cellAt(container, "lead", "2026-03-25").textContent ?? "";
    // Fina sat the first special out, so she leads the second. That only
    // happens if `fillColumn` ranked the second column against the cells the
    // first one had just written — the reason `columns` is a required input.
    expect(firstColumn).not.toContain("Fina");
    expect(secondLead).toContain("Fina");
  });
});
