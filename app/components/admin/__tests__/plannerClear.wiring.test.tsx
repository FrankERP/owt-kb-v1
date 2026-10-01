/** @vitest-environment jsdom */
// app/components/admin/__tests__/plannerClear.wiring.test.tsx
//
// «Borrar» WIRED (spec 2026-09-29 §3.2): service items apply at once with «Deshacer»; month
// items confirm through a CueDialog and re-plan against the live cells; FOH is never cleared.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { emptySchedule, stubSolve, type Respond } from "./pinSolveHarness";
import {
  ANA, BETO, Gen, LUCIA, PACO, RODRI, SUNDAYS, cellAt, deselectAll, preview, runAuto, selectSundayLead, setMonthYear,
} from "./plannerWiringHarness";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
beforeEach(() => { localStorage.clear(); });

const roster: Respond = (body) => {
  const schedule = emptySchedule(body);
  schedule["1"].Sunday!.Lead = ["Ana Karen Villalobos"];
  schedule["1"].Sunday!.BGV = ["María Lucía Estrada"];
  schedule["2"].Sunday!.BGV = ["Alberto Ruiz Cano"];
  return { ok: true, schedule, unfilled_seats: [] };
};

async function setup(respond: Respond = roster) {
  stubSolve(respond);
  const view = render(<Gen members={[ANA, LUCIA, BETO, RODRI, PACO]} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} />);
  setMonthYear(view.container, 3, 2026);
  deselectAll(view.container, "saturday");
  selectSundayLead(view.container, "Ana");
  preview();
  runAuto();
  await waitFor(() => expect(cellAt(view.container, "lead", SUNDAYS[0]).textContent).toContain("Ana"));
  return view;
}

describe("«Borrar» this service", () => {
  it("clears its voices at once, leaves instruments and other services, and «Deshacer» puts them back", async () => {
    const { container } = await setup();
    const drums = cellAt(container, "instrumento:Drums", SUNDAYS[0]).textContent;
    fireEvent.click(screen.getByRole("button", { name: `Borrar en ${SUNDAYS[0]}` }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Voces (2)" }));
    expect(cellAt(container, "lead", SUNDAYS[0]).textContent).toContain("Sin asignar");
    expect(cellAt(container, "bgv", SUNDAYS[0]).textContent).toContain("Sin asignar");
    expect(cellAt(container, "bgv", SUNDAYS[1]).textContent).toContain("Beto");
    expect(cellAt(container, "instrumento:Drums", SUNDAYS[0]).textContent).toBe(drums);
    fireEvent.click(await screen.findByRole("button", { name: "Deshacer" }));
    expect(cellAt(container, "lead", SUNDAYS[0]).textContent).toContain("Ana");
    expect(cellAt(container, "bgv", SUNDAYS[0]).textContent).toContain("Lucía");
  });

  it("drops the cleared cells' «Sin cubrir» markers, and «Deshacer» puts them back too", async () => {
    const { container } = await setup((body, call) => ({ ...roster(body, call), unfilled_seats: ["W1 Sunday Sun.BGV #1"] }));
    expect(cellAt(container, "bgv", SUNDAYS[0]).textContent).toContain("Sin cubrir");
    fireEvent.click(screen.getByRole("button", { name: `Borrar en ${SUNDAYS[0]}` }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Voces (2)" }));
    expect(cellAt(container, "bgv", SUNDAYS[0]).textContent).not.toContain("Sin cubrir");
    fireEvent.click(await screen.findByRole("button", { name: "Deshacer" }));
    expect(cellAt(container, "bgv", SUNDAYS[0]).textContent).toContain("Lucía");
    expect(cellAt(container, "bgv", SUNDAYS[0]).textContent).toContain("Sin cubrir");
  });

  it("keeps one «Deshacer» per service when two same-size clears land together, each naming its service", async () => {
    // Two Sundays with 2 voice seats each: before R13 both toasts read «Se borraron 2
    // asignaciones.» and the toast stack replaced the first with the second.
    const { container } = await setup((body, call) => {
      const answer = roster(body, call);
      answer.schedule!["2"].Sunday!.Choir = ["María Lucía Estrada"];
      return answer;
    });
    // Each item is scoped to its own menu: the first panel is still in its exit animation.
    for (const date of [SUNDAYS[0], SUNDAYS[1]]) {
      fireEvent.click(screen.getByRole("button", { name: `Borrar en ${date}` }));
      fireEvent.click(within(screen.getByRole("menu", { name: `Borrar en ${date}` })).getByRole("menuitem", { name: "Voces (2)" }));
    }
    expect(screen.getByText("Voces · domingo 1 mar: se borraron 2 asignaciones.")).toBeTruthy();
    expect(screen.getByText("Voces · domingo 8 mar: se borraron 2 asignaciones.")).toBeTruthy();
    const undos = screen.getAllByRole("button", { name: "Deshacer" });
    expect(undos).toHaveLength(2);
    fireEvent.click(undos[0]);
    expect(cellAt(container, "lead", SUNDAYS[0]).textContent).toContain("Ana");
    expect(cellAt(container, "bgv", SUNDAYS[0]).textContent).toContain("Lucía");
    expect(cellAt(container, "bgv", SUNDAYS[1]).textContent).toContain("Sin asignar");
    expect(cellAt(container, "coro", SUNDAYS[1]).textContent).toContain("Sin asignar");
    // Residual (not fixed): the SAME service cleared of the SAME kind twice within 10 s still
    // repeats a message, so the second toast replaces the first.
  });

  it("withdraws «Deshacer» once Auto has run", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: `Borrar en ${SUNDAYS[0]}` }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Voces (2)" }));
    expect(await screen.findByRole("button", { name: "Deshacer" })).toBeTruthy();
    runAuto();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Deshacer" })).toBeNull());
  });
});

describe("«Borrar» the whole month", () => {
  it("confirms with the live count, keeps FOH, writes nothing, and clears what is on the grid WHEN confirmed", async () => {
    const { container } = await setup();
    fireEvent.click(screen.getByRole("button", { name: "Borrar" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Voces (3)" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Se quitarán 3 asignaciones de voces en todo el mes/)).toBeTruthy();
    expect(within(dialog).getByText(/FOH no se toca/)).toBeTruthy();
    expect(within(dialog).getByText(/Los especiales conservan su Coro e instrumentos/)).toBeTruthy();
    expect(within(dialog).getByText(/Nada se guarda hasta que presiones «Crear \d+ borrador/)).toBeTruthy();

    // A live change while the dialog is open: the confirm must re-plan against it.
    // R3: the candidate click is scoped to the picker — a global /Beto/ button query also
    // matches the grid's «Marcar para mover a Beto» chips. `hidden: true` because the open
    // dialog sets `aria-hidden` on the app root the picker sits in (`CueDialogProvider`).
    fireEvent.click(cellAt(container, "coro", SUNDAYS[2]).querySelector("[data-cell-action]") as HTMLElement);
    const picker = screen.getByRole("region", { name: `Candidatos para Coro — ${SUNDAYS[2]}`, hidden: true });
    fireEvent.click(within(picker).getByRole("button", { name: /Beto/, hidden: true }));
    await waitFor(() => expect(within(dialog).getByText(/Se quitarán 4 asignaciones de voces/)).toBeTruthy());

    fireEvent.click(within(dialog).getByRole("button", { name: "Borrar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    for (const d of SUNDAYS) {
      for (const row of ["lead", "bgv", "coro"]) expect(cellAt(container, row, d).textContent).toContain("Sin asignar");
    }
    expect(screen.queryByRole("button", { name: "Deshacer" })).toBeNull();
  });
});
