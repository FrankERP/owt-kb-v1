/** @vitest-environment jsdom */
// Solver v3 C1-R11, parent U7 — «aplica con el nuevo solver» shows exactly while the
// engine is v2. Here the constant is mocked to "v3": every surface keeps its Switch
// and drops the note. (The v2 side is asserted beside each surface's own tests.)
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../solverEngine", () => ({ SOLVER_ENGINE: "v3" }));

import MonthCalendar from "../MonthCalendar";
import PlannerGrid from "../PlannerGrid";
import { FairnessEngineNote } from "../FairnessSwitch";
import { FAIRNESS_ENGINE_NOTE } from "../fairnessToggleModel";
import { buildColumns, buildRows } from "../plannerModel";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-03T18:00:00.000Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the note under SOLVER_ENGINE "v3"', () => {
  it("the note component renders nothing", () => {
    const { container } = render(<FairnessEngineNote />);
    expect(container.textContent).toBe("");
  });

  it("the grid keeps its switches and drops the note", () => {
    render(
      <PlannerGrid
        rows={buildRows()}
        columns={buildColumns({ sundayDates: ["2026-08-09"], activeSatDates: [] })}
        cells={[]}
        members={[]}
        savedWindow={[]}
        preflightFor={() => null}
        createBlockFor={() => null}
        canReceive={() => true}
        skipped={new Set()}
        unresolvedNames={[]}
        unfilled={[]}
        onCellsChange={vi.fn()}
        onRowsChange={vi.fn()}
        onToggleSkip={vi.fn()}
        onAuto={vi.fn()}
        autoState={{ pending: false, error: null, disabledReason: null }}
        diagnostics={null}
        fairness={{ onChange: vi.fn(), createInFlight: false }}
      />,
    );
    expect(screen.getByRole("switch", { name: "Cuenta para equidad 2026-08-09" })).toBeTruthy();
    expect(screen.queryByText(FAIRNESS_ENGINE_NOTE)).toBeNull();
  });

  it("the special composer keeps its switch and drops the note", () => {
    const { container } = render(
      <MonthCalendar
        year={2026}
        month={8}
        selectedSundays={[]}
        selectedSaturdays={[]}
        specials={[]}
        existingRoles={[]}
        onToggleWeekend={vi.fn()}
        onAddSpecial={vi.fn()}
        onRemoveSpecial={vi.fn()}
      />,
    );
    fireEvent.click(container.querySelector('[data-date="2026-08-12"]')!);
    expect(screen.getByRole("switch", { name: "Cuenta para equidad" })).toBeTruthy();
    expect(screen.queryByText(FAIRNESS_ENGINE_NOTE)).toBeNull();
  });
});
