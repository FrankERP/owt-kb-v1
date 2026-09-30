/** @vitest-environment jsdom */
// app/components/admin/__tests__/fillEmpty.local.test.tsx
//
// The per-browser Auto path (the rollback, `SOLVER_HISTORY_SOURCE = "local"`) goes through the
// same seam: a pre-fetch pin refusal reaches the admin there too, and nothing is sent.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../solverHistorySource", () => ({ SOLVER_HISTORY_SOURCE: "local", SOLVER_SENDS_HISTORY: true }));

import { emptySchedule, stubSolve } from "./pinSolveHarness";
import {
  ANA, BETO, Gen, LUCIA, SUNDAYS, cellAt, deselectAll, fillEmptySwitch, preview, runAuto, selectSundayLead, setMonthYear,
} from "./plannerWiringHarness";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
beforeEach(() => { localStorage.clear(); });

describe("«Solo llenar vacíos» on the per-browser path", () => {
  it("refuses in Spanish, naming the cell, and never calls the solver", async () => {
    const { bodies } = stubSolve((body) => {
      const schedule = emptySchedule(body);
      schedule["1"].Sunday!.BGV = ["Alberto Ruiz Cano"];
      return { ok: true, schedule, unfilled_seats: [] };
    });
    const props = { existingRoles: [], onClose: vi.fn(), onCreated: vi.fn() };
    const view = render(<Gen members={[ANA, LUCIA, BETO]} {...props} />);
    setMonthYear(view.container, 3, 2026);
    deselectAll(view.container, "saturday");
    selectSundayLead(view.container, "Ana");
    preview();
    runAuto();
    await waitFor(() => expect(cellAt(view.container, "bgv", SUNDAYS[0]).textContent).toContain("Beto"));
    // Beto leaves the members list (e.g. the ministry-scoped read): his seat no longer resolves.
    view.rerender(<Gen members={[ANA, LUCIA]} {...props} />);
    fireEvent.click(fillEmptySwitch());
    runAuto();
    await waitFor(() => expect(screen.getByText(
      "No se puede usar «Solo llenar vacíos»: en BGV del domingo 1 mar hay alguien que ya no está en la lista de miembros. Quítalo de ese lugar y vuelve a intentarlo.",
    )).toBeTruthy());
    expect(bodies).toHaveLength(1);
  });
});
