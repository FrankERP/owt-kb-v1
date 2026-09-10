/** @vitest-environment jsdom */
// The instrument filler, WIRED — `instrumentFill.test.ts` proves the pure
// function; this file proves `applySpecialFill` actually calls it on every
// `handleAuto` exit and that the failure-exit `unfilled` filter drops its
// entries the same way it drops a special's, or a solver refusal (D15's
// normal failure) would re-append the same empty instrument seats every time
// Auto is pressed.
//
// Modelled on `localFill.wiring.test.tsx` — same header, `Gen`, hooks,
// fixtures and DOM helpers, copied verbatim.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MonthGenerator from "../MonthGenerator";
import { readyRules } from "./rulesHarness";
import type { SolverConfigController } from "../solverConfigSource";

/**
 * `MonthGenerator` with the shared rule set supplied.
 *
 * The prop is REQUIRED on the component (an optional one defaulting to
 * `DEFAULT_SOLVER_CONFIG` is the "a failed read looks like the defaults"
 * collapse the cutover exists to prevent), so every render has to name a state.
 * `DEFAULT_RULES` is `ready` holding `DEFAULT_SOLVER_CONFIG` — production's
 * state, and byte-for-byte the rule set these tests exercised before the
 * cutover, when it was the component's own initial state. A stable module-level
 * object, so the load-sync effect fires once rather than on every render.
 */
const DEFAULT_RULES = readyRules();

function Gen({
  rules = DEFAULT_RULES,
  ...props
}: Omit<React.ComponentProps<typeof MonthGenerator>, "rules"> & {
  rules?: SolverConfigController;
}) {
  return <MonthGenerator {...props} rules={rules} />;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  localStorage.clear();
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

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

/** Declared players. Zoe is away every Sunday of March 2026, so Keys stays empty. */
const SUNDAYS = ["2026-03-01", "2026-03-08", "2026-03-15", "2026-03-22", "2026-03-29"];
const RODRI = { ...m("rodri", "Rodrigo Lara Peña", "Rodri", ["instrumento"]), instruments: ["Drums"] };
const PACO = { ...m("paco", "Francisco Ibarra", "Paco", ["instrumento"]), instruments: ["Drums"] };
const ZOE = { ...m("zoe", "Zoraida Peña Lima", "Zoe", ["instrumento"]), instruments: ["Keys"], unavailableDates: SUNDAYS };

const refusal = () => ({
  ok: true,
  status: 200,
  json: async () => ({ ok: false, error: "El solver no encontró solución." }),
});

describe("Auto fills instrument seats on every exit", () => {
  function setup(solve: () => unknown) {
    const { fetchMock } = stubFetch(solve);
    const view = render(
      <Gen members={[ANA, LUCIA, NIZA, BETO, RODRI, PACO, ZOE]} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    setMonthYear(view.container, 3, 2026);
    deselectAll(view.container, "saturday");
    selectSundayLead(view.container, "Ana");
    preview();
    return { ...view, fetchMock };
  }

  it("seats the drummers alternating even when the solver refuses the month", async () => {
    const { container } = setup(refusal);
    runAuto();
    await waitFor(() => expect(cellAt(container, "instrumento:Drums", SUNDAYS[0]).textContent).toContain("Paco"));
    expect(cellAt(container, "instrumento:Drums", SUNDAYS[1]).textContent).toContain("Rodri");
    expect(cellAt(container, "instrumento:Drums", SUNDAYS[2]).textContent).toContain("Paco");
  });

  it("reports the empty Keys seats once, and does not double-count them when Auto runs twice", async () => {
    const { container } = setup(refusal);
    runAuto();
    // Five Keys seats empty (Zoe away). The solver's own unfilled is absent on refusal.
    await waitFor(() => expect(screen.getByText("Lugares sin cubrir (faltó gente): 5")).toBeTruthy());
    expect(cellAt(container, "instrumento:Keys", SUNDAYS[0]).textContent).toContain("Sin cubrir");
    runAuto();
    await waitFor(() => expect(screen.getByText("Lugares sin cubrir (faltó gente): 5")).toBeTruthy());
  });

  it("does not mark a row nobody declares", async () => {
    const { container } = setup(refusal);
    runAuto();
    await waitFor(() => expect(screen.getByText("Lugares sin cubrir (faltó gente): 5")).toBeTruthy());
    expect(cellAt(container, "instrumento:Bass", SUNDAYS[0]).textContent).not.toContain("Sin cubrir");
  });
});
