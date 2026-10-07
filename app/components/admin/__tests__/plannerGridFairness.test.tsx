/** @vitest-environment jsdom */
// Solver v3 C1 §6.2, §6.4, §6.0, §6.6 — «Cuenta para equidad» on the grid's column
// headers, both modes. The clock is pinned (only `Date` is faked, so `waitFor` and
// timers stay real): August 2026 is "now", July 2026 is a past month.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PlannerGrid, { type PlannerGridProps } from "../PlannerGrid";
import { FAIRNESS_ENGINE_NOTE, FAIRNESS_PAST_REASON } from "../fairnessToggleModel";
import { buildColumns, buildRows, type GridColumn } from "../plannerModel";
import type { StoredGridColumn } from "../storedRoleReadModel";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-15T18:00:00.000Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const ROWS = buildRows();
// Saturday 8, Sunday 9 and a Wednesday special on the 12th — all in August.
const CREATE = buildColumns({
  sundayDates: ["2026-08-09"],
  activeSatDates: ["2026-08-08"],
  specials: [{ date: "2026-08-12", name: "Vigilia" }],
});
const SUNDAY_ID = CREATE.find((c) => c.date === "2026-08-09")!.columnId;

function props(over: Partial<PlannerGridProps> = {}): PlannerGridProps {
  return {
    rows: ROWS,
    columns: CREATE,
    cells: [],
    members: [],
    savedWindow: [],
    preflightFor: () => null,
    createBlockFor: () => null,
    canReceive: () => true,
    skipped: new Set(),
    unresolvedNames: [],
    unfilled: [],
    onCellsChange: vi.fn(),
    onRowsChange: vi.fn(),
    onToggleSkip: vi.fn(),
    onAuto: vi.fn(),
    autoState: { pending: false, error: null, disabledReason: null },
    diagnostics: null,
    fairness: { onChange: vi.fn(), createInFlight: false },
    ...over,
  };
}

function stored(column: Pick<GridColumn, "columnId" | "date" | "type" | "countsForFairness"> & Partial<StoredGridColumn>): StoredGridColumn {
  return {
    roleId: column.columnId,
    rev: "rev-1",
    published: false,
    admission: "approved",
    storedFairness: { date: column.date, countsForFairness: column.countsForFairness },
    ...column,
  };
}

const sw = (name: string) => screen.getByRole("switch", { name }) as HTMLButtonElement;
const describedText = (el: HTMLElement) => {
  const id = el.getAttribute("aria-describedby");
  return id ? (document.getElementById(id)?.textContent ?? null) : null;
};

describe("create-mode headers (§6.2)", () => {
  it("every creatable column shows the switch at its type default, named by its column like «Omitir»", () => {
    render(<PlannerGrid {...props()} />);
    expect(sw("Cuenta para equidad 2026-08-08").getAttribute("aria-checked")).toBe("true");
    expect(sw("Cuenta para equidad 2026-08-09").getAttribute("aria-checked")).toBe("true");
    expect(sw("Cuenta para equidad 2026-08-12 · Vigilia").getAttribute("aria-checked")).toBe("false");
    expect(sw("Cuenta para equidad 2026-08-09").getAttribute("aria-describedby")).toBeNull();
  });

  it("reports the column id and the flipped value", () => {
    const onChange = vi.fn();
    render(<PlannerGrid {...props({ fairness: { onChange, createInFlight: false } })} />);
    fireEvent.click(sw("Cuenta para equidad 2026-08-09"));
    expect(onChange).toHaveBeenCalledWith(SUNDAY_ID, false);
  });

  it.each(["existing", "created"] as const)("is not shown on a column blocked from creation (%s)", (block) => {
    render(<PlannerGrid {...props({ createBlockFor: (c) => (c.date === "2026-08-09" ? block : null) })} />);
    expect(screen.queryByRole("switch", { name: "Cuenta para equidad 2026-08-09" })).toBeNull();
    expect(sw("Cuenta para equidad 2026-08-08")).toBeTruthy();
  });

  it("stays enabled on a skipped column — skipping is reversible and keeps the value", () => {
    render(<PlannerGrid {...props({ skipped: new Set([SUNDAY_ID]) })} />);
    expect(sw("Cuenta para equidad 2026-08-09").disabled).toBe(false);
  });

  it("is disabled while a create batch is in flight", () => {
    render(<PlannerGrid {...props({ fairness: { onChange: vi.fn(), createInFlight: true } })} />);
    expect(sw("Cuenta para equidad 2026-08-09").disabled).toBe(true);
  });

  it("on a column of a past month: disabled at the type default, with the reason as its description", () => {
    const july = buildColumns({
      sundayDates: ["2026-07-26"],
      activeSatDates: [],
      specials: [{ date: "2026-07-15", name: "Retiro", countsForFairness: true }],
    });
    render(<PlannerGrid {...props({ columns: july })} />);
    const special = sw("Cuenta para equidad 2026-07-15 · Retiro");
    expect(special.disabled).toBe(true);
    expect(special.getAttribute("aria-checked")).toBe("false");
    expect(describedText(special)).toBe(FAIRNESS_PAST_REASON);
    expect(sw("Cuenta para equidad 2026-07-26").getAttribute("aria-checked")).toBe("true");
  });
});

describe("stored-mode headers (§6.4)", () => {
  const SUN = stored({ columnId: "role-sun", date: "2026-08-09", type: "sunday_role", countsForFairness: true });
  const SP = stored({ columnId: "role-sp", date: "2026-08-12", type: "special_role", serviceName: "Vigilia", countsForFairness: false });

  it("every stored column carries the switch at its stored value", () => {
    render(<PlannerGrid {...props({ mode: "stored", columns: [SUN, SP] })} />);
    expect(sw("Cuenta para equidad 2026-08-09").getAttribute("aria-checked")).toBe("true");
    expect(sw("Cuenta para equidad 2026-08-12 · Vigilia").getAttribute("aria-checked")).toBe("false");
  });

  it("is disabled by readOnly and by the mutation lock, never by the date-move block", () => {
    const { unmount } = render(
      <PlannerGrid {...props({ mode: "stored", columns: [stored({ ...SUN, admission: "readOnly" })] })} />,
    );
    expect(sw("Cuenta para equidad 2026-08-09").disabled).toBe(true);
    unmount();
    const locked = render(<PlannerGrid {...props({ mode: "stored", columns: [SUN], mutationLocked: true })} />);
    expect(sw("Cuenta para equidad 2026-08-09").disabled).toBe(true);
    locked.unmount();
    render(<PlannerGrid {...props({ mode: "stored", columns: [SUN], storedDateBlockedReason: "No se puede mover la fecha." })} />);
    expect(sw("Cuenta para equidad 2026-08-09").disabled).toBe(false);
  });

  it("a past stored column shows its STORED value, disabled, with the reason — whatever edit it holds", () => {
    const julyHeld = stored({
      columnId: "role-jul",
      date: "2026-07-26",
      type: "sunday_role",
      countsForFairness: false,
      storedFairness: { date: "2026-07-26", countsForFairness: true },
    });
    render(<PlannerGrid {...props({ mode: "stored", columns: [julyHeld] })} />);
    const toggle = sw("Cuenta para equidad 2026-07-26");
    expect(toggle.disabled).toBe(true);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(describedText(toggle)).toBe(FAIRNESS_PAST_REASON);
  });

  it("an edited date moved into a past month disables it too", () => {
    const movedBack = { ...SUN, date: "2026-07-26" };
    render(<PlannerGrid {...props({ mode: "stored", columns: [movedBack] })} />);
    expect(sw("Cuenta para equidad 2026-07-26").disabled).toBe(true);
  });
});

describe("the v2 note (§6.6)", () => {
  it("shows once per grid, not per column, in both modes", () => {
    const { unmount } = render(<PlannerGrid {...props()} />);
    expect(screen.getAllByText(FAIRNESS_ENGINE_NOTE)).toHaveLength(1);
    unmount();
    render(
      <PlannerGrid
        {...props({
          mode: "stored",
          columns: [stored({ columnId: "role-sun", date: "2026-08-09", type: "sunday_role", countsForFairness: true })],
        })}
      />,
    );
    expect(screen.getAllByText(FAIRNESS_ENGINE_NOTE)).toHaveLength(1);
  });

  it("without the fairness prop there is no switch and no note (the gallery fixture's case)", () => {
    render(<PlannerGrid {...props({ fairness: undefined })} />);
    expect(screen.queryAllByRole("switch", { name: /^Cuenta para equidad/ })).toHaveLength(0);
    expect(screen.queryByText(FAIRNESS_ENGINE_NOTE)).toBeNull();
  });
});
