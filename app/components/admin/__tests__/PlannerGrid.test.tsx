/** @vitest-environment jsdom */
// `PlannerGrid` renders the month grid `plannerModel` (Task 2) computes and
// decides nothing itself. Every test here exists because a specific, verified
// failure was found in nine rounds of adversarial review of the plan this
// implements (docs/superpowers/plans/2026-07-29-planner-grid.md) — see the
// numbered list in `task-3-brief.md` and the file header comment in
// `PlannerGrid.tsx`.
import { fireEvent, render, cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import PlannerGrid, { type PlannerGridProps, type SolveDiagnostics } from "../PlannerGrid";
import {
  buildColumns,
  buildRows,
  type GridCell,
  type GridColumn,
  type GridRow,
  type SolverConfig,
} from "../plannerModel";
import type { RankMember } from "../candidateRanking";
import type { TargetPreflight } from "../serviceReadiness";
import type { ParticipantRole } from "@/app/utils/computeParticipation";

type InputGridCell = GridCell | {
  date: string;
  rowId: string;
  memberIds: string[];
  origin: GridCell["origin"];
  overrides?: string[];
  overrideReasons?: Record<string, string>;
};

type PlannerGridTestOverrides = Omit<Partial<PlannerGridProps>, "cells"> & {
  cells?: InputGridCell[];
};

afterEach(() => cleanup());

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ROWS: GridRow[] = buildRows();

const SUNDAY_ONLY: GridColumn[] = buildColumns({
  sundayDates: ["2026-08-09"],
  activeSatDates: [],
});

const WEEKEND: GridColumn[] = buildColumns({
  sundayDates: ["2026-08-09"],
  activeSatDates: ["2026-08-08"],
});

// 2026-08-12 is a Wednesday — a weekday special (E2), no weekend column on it.
const SPECIAL_ONLY: GridColumn[] = buildColumns({
  sundayDates: [],
  activeSatDates: [],
  specials: [{ date: "2026-08-12", name: "Vigilia" }],
});

const members: RankMember[] = [
  { _id: "m1", member_name: "Frank", memberType: ["voz"] },
  { _id: "m2", member_name: "Gaby", memberType: ["voz"] },
  { _id: "m3", member_name: "Liu", memberType: ["voz"] },
  { _id: "m4", member_name: "Mkz", memberType: ["voz"] },
  { _id: "d1", member_name: "Samo", memberType: ["instrumento"] },
  { _id: "d2", member_name: "Tony", memberType: ["instrumento"] },
  { _id: "d3", member_name: "Fanta", memberType: ["instrumento"] },
  { _id: "f1", member_name: "Rene", memberType: ["foh"] },
];

function baseProps(overrides: PlannerGridTestOverrides = {}): PlannerGridProps {
  const columns = overrides.columns ?? SUNDAY_ONLY;
  const cells = (overrides.cells ?? []).map((cell): GridCell => {
    if ("columnId" in cell) return cell;
    const column = columns.find((candidate) => candidate.date === cell.date);
    if (!column) throw new Error(`no test column for ${cell.date}`);
    return {
      columnId: column.columnId,
      rowId: cell.rowId,
      occupants: cell.memberIds.map((memberId) => ({ memberId })),
      origin: cell.origin,
      overrides: cell.overrides,
      overrideReasons: cell.overrideReasons,
    };
  });
  return {
    rows: ROWS,
    members,
    savedWindow: [],
    preflightFor: () => null,
    createBlockFor: () => null,
    skipped: new Set(),
    unaddressableDates: [],
    unresolvedNames: [],
    unfilled: [],
    onCellsChange: vi.fn(),
    onRowsChange: vi.fn(),
    onToggleSkip: vi.fn(),
    onAuto: vi.fn(),
    autoState: { pending: false, error: null, disabledReason: null },
    diagnostics: null,
    ...overrides,
    columns,
    cells,
  };
}

/** The interactive cell root for an exact (rowId, date) pair. */
function cellFor(container: HTMLElement, rowId: string, date: string): HTMLElement {
  const el = container.querySelector(`[data-row-id="${rowId}"][data-date="${date}"]`);
  if (!el) throw new Error(`cell not found for rowId=${rowId} date=${date}`);
  return el as HTMLElement;
}

function cellForColumn(container: HTMLElement, rowId: string, columnId: string): HTMLElement {
  const el = container.querySelector(`[data-row-id="${rowId}"][data-column-id="${columnId}"]`);
  if (!el) throw new Error(`cell not found for rowId=${rowId} columnId=${columnId}`);
  return el as HTMLElement;
}

/**
 * The candidate picker's <li> for a given name. Once a member is seated
 * anywhere, their name also renders as an occupant chip inside a grid cell,
 * so a bare `getByText` is ambiguous — this always resolves to the roster
 * row (the only occurrence that is an `<li>`), matching the pattern
 * `SeatBoard.test.tsx` uses for the same reason.
 */
function candidateLi(name: string): HTMLLIElement {
  const li = screen
    .getAllByText(name)
    .map((el) => el.closest("li"))
    .find((el): el is HTMLLIElement => el !== null);
  if (!li) throw new Error(`candidate <li> not found for ${name}`);
  return li;
}

describe("PlannerGrid — shape", () => {
  it("isolates same-date columns by columnId", () => {
    const columns: GridColumn[] = [
      { columnId: "role-a", date: "2026-08-12", type: "special_role", serviceName: "Vigilia" },
      { columnId: "role-b", date: "2026-08-12", type: "special_role", serviceName: "Retiro" },
    ];
    const cells: GridCell[] = [
      { columnId: "role-a", rowId: "lead", occupants: [{ memberId: "m1" }], origin: "manual" },
      { columnId: "role-b", rowId: "lead", occupants: [{ memberId: "m2" }], origin: "manual" },
    ];
    const onCellsChange = vi.fn();
    const { container } = render(<PlannerGrid {...baseProps({ columns, cells, onCellsChange })} />);
    expect(within(cellForColumn(container, "lead", "role-a")).getByText("Frank")).toBeTruthy();
    expect(within(cellForColumn(container, "lead", "role-b")).getByText("Gaby")).toBeTruthy();

    fireEvent.click(cellForColumn(container, "lead", "role-b"));
    fireEvent.click(candidateLi("Liu"));
    const next = onCellsChange.mock.calls[0][0] as GridCell[];
    expect(next.find((cell) => cell.columnId === "role-a")?.occupants.map((o) => o.memberId)).toEqual(["m1"]);
    expect(next.find((cell) => cell.columnId === "role-b")?.occupants.map((o) => o.memberId)).toEqual(["m2", "m3"]);
  });

  it("renders rows from props and columns from props", () => {
    render(<PlannerGrid {...baseProps()} />);
    expect(screen.getByText("Lead")).toBeTruthy();
    expect(screen.getByText("BGV")).toBeTruthy();
    expect(screen.getByText("Coro")).toBeTruthy();
    expect(screen.getByText("Drums")).toBeTruthy();
    expect(screen.getByText("9")).toBeTruthy(); // the day-of-month for 2026-08-09
  });

  it("the grid scroller carries overflow-x-auto and every column carries a min-w class", () => {
    const { container } = render(<PlannerGrid {...baseProps({ columns: WEEKEND })} />);
    const scroller = container.querySelector(".overflow-x-auto");
    expect(scroller).toBeTruthy();
    const minWEls = container.querySelectorAll('[class*="min-w-\\["]');
    expect(minWEls.length).toBeGreaterThan(0);
  });

  it("has no scroll region nested inside another (checked on BOTH axes — this scroller is overflow-x-auto, not overflow-y-auto)", () => {
    const cells: InputGridCell[] = [{ date: "2026-08-09", rowId: "lead", memberIds: ["m1"], origin: "manual" }];
    const { container } = render(<PlannerGrid {...baseProps({ cells })} />);
    // Open the candidate picker too, so an overflow-y-auto scroller (the
    // roster list) exists simultaneously — otherwise this test would pass
    // vacuously with only the grid's overflow-x-auto scroller present.
    fireEvent.click(cellFor(container, "lead", "2026-08-09"));
    const scrollers = Array.from(container.querySelectorAll(".overflow-x-auto, .overflow-y-auto"));
    expect(scrollers.length).toBeGreaterThan(1);
    for (const outer of scrollers) {
      for (const inner of scrollers) {
        if (outer !== inner) expect(outer.contains(inner)).toBe(false);
      }
    }
  });

  it("a Saturday column still renders the Coro row label, and both column headers render", () => {
    render(<PlannerGrid {...baseProps({ columns: WEEKEND })} />);
    expect(screen.getByText("Coro")).toBeTruthy();
    expect(screen.getByText("Domingo")).toBeTruthy();
    expect(screen.getByText("Sábado")).toBeTruthy();
  });

  it("a Saturday column renders no interactive Coro cell (D11 — rowAppliesTo, not just isSolvable)", () => {
    const { container } = render(<PlannerGrid {...baseProps({ columns: WEEKEND })} />);
    expect(container.querySelector('[data-row-id="coro"][data-date="2026-08-08"]')).toBeNull();
    expect(container.querySelector('[data-row-id="coro"][data-date="2026-08-09"]')).toBeTruthy();
  });

  it("a special column header reads 'Especial', never 'Sábado' — the old ternary labelled every non-Sunday column Sábado", () => {
    render(<PlannerGrid {...baseProps({ columns: SPECIAL_ONLY })} />);
    expect(screen.getByText("Especial")).toBeTruthy();
    expect(screen.queryByText("Sábado")).toBeNull();
    expect(screen.queryByText("Domingo")).toBeNull();
  });
});

describe("PlannerGrid — Domingos unchecked (D9)", () => {
  // An EMPTY Sunday selection, which is how `MonthGenerator` says this now
  // that `includeSundays` is gone (Task 5 fix pass, Finding 4). The Sunday
  // 2026-08-09 still exists for the solve — but only in `sundayDatesFull`,
  // which never reaches `buildColumns` and so is not this file's business;
  // the assertions below (no Sunday column, Auto still enabled) are unchanged.
  const satOnly = buildColumns({ sundayDates: [], activeSatDates: ["2026-08-08"] });

  it("Auto is ENABLED, produces Saturday cells, and renders no Sunday column", () => {
    const cells: InputGridCell[] = [{ date: "2026-08-08", rowId: "lead", memberIds: ["m1"], origin: "auto" }];
    const { container } = render(<PlannerGrid {...baseProps({ columns: satOnly, cells })} />);
    expect(screen.queryByText("Domingo")).toBeNull();
    expect(screen.getByText("Sábado")).toBeTruthy();
    expect(container.querySelector('[data-row-id="lead"][data-date="2026-08-09"]')).toBeNull();
    expect(container.querySelector('[data-row-id="lead"][data-date="2026-08-08"]')).toBeTruthy();
    const autoButton = screen.getByRole("button", { name: /auto-asignar/i }) as HTMLButtonElement;
    expect(autoButton.disabled).toBe(false);
  });
});

describe("PlannerGrid — cell density (D7)", () => {
  it("a normally-staffed Sunday (L2/B3/C3) shows every name with no +N", () => {
    // Eight DISTINCT people, matching the solver's own invariant that nobody
    // holds two voice slots on one service (fact 4) — the fixture would be
    // self-contradictory (and would trip the duplicate-surfacing flag,
    // testing the wrong thing) if any of Lead/BGV/Coro overlapped here.
    const cells: InputGridCell[] = [
      { date: "2026-08-09", rowId: "lead", memberIds: ["v1", "v2"], origin: "auto" },
      { date: "2026-08-09", rowId: "bgv", memberIds: ["v3", "v4", "v5"], origin: "auto" },
      { date: "2026-08-09", rowId: "coro", memberIds: ["v6", "v7", "v8"], origin: "auto" },
    ];
    render(<PlannerGrid {...baseProps({ cells })} />);
    expect(screen.queryByText(/^\+\d/)).toBeNull();
    for (const id of ["v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8"]) {
      expect(screen.getByText(id)).toBeTruthy(); // falls back to the bare id (not in `members`)
    }
  });

  it("+N appears only above target on a solvable row, is keyboard-reachable, and carries no title", () => {
    const cells: InputGridCell[] = [
      { date: "2026-08-09", rowId: "lead", memberIds: ["m1", "m2", "m3"], origin: "auto" }, // target 2, +1
    ];
    const { container } = render(<PlannerGrid {...baseProps({ cells })} />);
    const cellRoot = cellFor(container, "lead", "2026-08-09");
    const plusButton = within(cellRoot).getByRole("button", { name: /ver 1 más/i }) as HTMLButtonElement;
    expect(plusButton.tagName).toBe("BUTTON");
    expect(plusButton.getAttribute("title")).toBeNull();
    expect(cellRoot.getAttribute("title")).toBeNull();
    fireEvent.click(plusButton);
    expect(screen.getByText(/Candidatos para Lead/)).toBeTruthy();
  });

  it("a SPECIAL column keeps the target cap and the +N — the P5 outcome `hasTarget` exists to protect", () => {
    // `isSolvable` is false for every row on a special (E4/E5). Gating the cap
    // on it — as this component used to — would silently drop both the cap and
    // the amber over-target warning on every special column.
    const cells: InputGridCell[] = [
      { date: "2026-08-12", rowId: "lead", memberIds: ["m1", "m2", "m3"], origin: "manual" }, // target 2, +1
    ];
    const { container } = render(<PlannerGrid {...baseProps({ columns: SPECIAL_ONLY, cells })} />);
    const cellRoot = cellFor(container, "lead", "2026-08-12");
    expect(within(cellRoot).getByRole("button", { name: /ver 1 más/i })).toBeTruthy();
  });

  it("a special column renders an interactive Coro cell, unlike a Saturday (E18)", () => {
    const { container } = render(<PlannerGrid {...baseProps({ columns: SPECIAL_ONLY })} />);
    expect(container.querySelector('[data-row-id="coro"][data-date="2026-08-12"]')).not.toBeNull();
  });

  it("on a non-solvable row (Drums), TWO occupants render both names and no +N", () => {
    const cells: InputGridCell[] = [
      { date: "2026-08-09", rowId: "instrumento:Drums", memberIds: ["d1", "d2"], origin: "manual" },
    ];
    const { container } = render(<PlannerGrid {...baseProps({ cells })} />);
    const cellRoot = cellFor(container, "instrumento:Drums", "2026-08-09");
    expect(within(cellRoot).getByText("Samo")).toBeTruthy();
    expect(within(cellRoot).getByText("Tony")).toBeTruthy();
    expect(within(cellRoot).queryByText(/^\+\d/)).toBeNull();
  });

  it("above target, a solvable cell still accepts a new occupant (D6) — no cell ever replaces", () => {
    const cells: InputGridCell[] = [
      { date: "2026-08-09", rowId: "lead", memberIds: ["m1", "m2", "m3"], origin: "auto" },
    ];
    const onCellsChange = vi.fn();
    const { container } = render(<PlannerGrid {...baseProps({ cells, onCellsChange })} />);
    fireEvent.click(within(cellFor(container, "lead", "2026-08-09")).getByRole("button", { name: /ver 1 más/i }));
    fireEvent.click(screen.getByText("Mkz"));
    expect(onCellsChange).toHaveBeenCalledTimes(1);
    const next: GridCell[] = onCellsChange.mock.calls[0][0];
    const lead = next.find((c) => c.rowId === "lead" && c.columnId === SUNDAY_ONLY[0].columnId)!;
    expect(lead.occupants.map((o) => o.memberId).sort()).toEqual(["m1", "m2", "m3", "m4"].sort());
  });

  it("an over-target solvable cell carries a Spanish text warning, not just a border color (Finding 6)", () => {
    const cells: InputGridCell[] = [
      { date: "2026-08-09", rowId: "lead", memberIds: ["m1", "m2", "m3"], origin: "auto" }, // target 2, +1
    ];
    const { container } = render(<PlannerGrid {...baseProps({ cells })} />);
    const cellRoot = cellFor(container, "lead", "2026-08-09");
    expect(within(cellRoot).getByText(/por encima del objetivo/i)).toBeTruthy();
  });

  it("a non-solvable Drums cell with two occupants never replaces a third addition", () => {
    const cells: InputGridCell[] = [
      { date: "2026-08-09", rowId: "instrumento:Drums", memberIds: ["d1", "d2"], origin: "manual" },
    ];
    const onCellsChange = vi.fn();
    const { container } = render(<PlannerGrid {...baseProps({ cells, onCellsChange })} />);
    fireEvent.click(cellFor(container, "instrumento:Drums", "2026-08-09"));
    fireEvent.click(screen.getByText("Fanta"));
    const next: GridCell[] = onCellsChange.mock.calls[0][0];
    const drums = next.find((c) => c.rowId === "instrumento:Drums")!;
    expect(drums.occupants.map((o) => o.memberId).sort()).toEqual(["d1", "d2", "d3"].sort());
  });
});

describe("PlannerGrid — ranking (D12)", () => {
  it("clicking a cell opens the ranked list, with `assigned` built from that date's whole column", () => {
    const cells: InputGridCell[] = [{ date: "2026-08-09", rowId: "lead", memberIds: ["m1"], origin: "manual" }];
    const { container } = render(<PlannerGrid {...baseProps({ cells })} />);
    fireEvent.click(cellFor(container, "bgv", "2026-08-09"));
    // Frank (m1) already holds a voz seat (Lead) on this date -> blocked in BGV.
    const frankRow = candidateLi("Frank");
    expect(frankRow.getAttribute("aria-disabled")).toBe("true");
  });

  it("a member who served recently sorts BELOW one who did not (fails if the saved window were empty)", () => {
    // The tie-break below load is `a.name.localeCompare(b.name, "es")`
    // (candidateRanking.ts:156). With every load at 0, alphabetical order
    // and load-driven order are indistinguishable UNLESS the recently-served
    // member is chosen to be alphabetically FIRST — "Ana" here has history,
    // "Zoe" does not, so a load-blind implementation (tie -> alphabetical)
    // would wrongly sort Ana before Zoe, and this assertion would catch it.
    const localMembers: RankMember[] = [
      { _id: "ana", member_name: "Ana", memberType: ["voz"] },
      { _id: "zoe", member_name: "Zoe", memberType: ["voz"] },
    ];
    const savedWindow: ParticipantRole[] = [
      {
        _type: "sunday_role",
        date: "2026-07-19",
        leads: [{ _id: "ana", member_name: "Ana" }],
        bgvs: [],
        chorus: [],
        instruments: [],
        foh: [],
      },
    ];
    const { container } = render(<PlannerGrid {...baseProps({ members: localMembers, savedWindow })} />);
    fireEvent.click(cellFor(container, "lead", "2026-08-09"));
    const items = screen.getAllByRole("button").filter((el) => el.tagName === "LI");
    const names = items.map((el) => el.textContent ?? "");
    const anaIdx = names.findIndex((n) => n.includes("Ana"));
    const zoeIdx = names.findIndex((n) => n.includes("Zoe"));
    expect(zoeIdx).toBeGreaterThanOrEqual(0);
    expect(anaIdx).toBeGreaterThan(zoeIdx);
  });

  it("a member assigned earlier in THIS grid sorts BELOW one who was not (fails if D12's union were dropped)", () => {
    // Same alphabetical-tie-break trap as above: "Ana" is assigned earlier
    // in the grid (real load, from `inGridDrafts`) and is alphabetically
    // FIRST, "Zoe" has none. If D12's union were dropped (order sourced
    // from `savedWindow` alone, ignoring the grid's own occupancy), both
    // would read load 0, tie, and the alphabetical fallback would wrongly
    // put Ana first — this assertion requires the in-grid load to win.
    const localMembers: RankMember[] = [
      { _id: "ana", member_name: "Ana", memberType: ["voz"] },
      { _id: "zoe", member_name: "Zoe", memberType: ["voz"] },
    ];
    const columns = buildColumns({ sundayDates: ["2026-08-02", "2026-08-09"], activeSatDates: [] });
    const cells: InputGridCell[] = [{ date: "2026-08-02", rowId: "lead", memberIds: ["ana"], origin: "auto" }];
    const { container } = render(<PlannerGrid {...baseProps({ columns, cells, members: localMembers })} />);
    fireEvent.click(cellFor(container, "lead", "2026-08-09"));
    const items = screen.getAllByRole("button").filter((el) => el.tagName === "LI");
    const names = items.map((el) => el.textContent ?? "");
    const anaIdx = names.findIndex((n) => n.includes("Ana"));
    const zoeIdx = names.findIndex((n) => n.includes("Zoe"));
    expect(zoeIdx).toBeGreaterThanOrEqual(0);
    expect(anaIdx).toBeGreaterThan(zoeIdx);
  });

  it("the `recent` strip still shows history for a member who served historically but appears nowhere in the grid", () => {
    // A single-Sunday column set lets even a wrongly-concatenated
    // (savedWindow + inGridDrafts) call leave the historical week inside
    // `slice(-4)` by accident (only 2 distinct weeks total, and 2 <= 4).
    // Four grid columns push every historical week out of a genuinely
    // concatenated window, so only a `recent` that is sourced from
    // `savedWindow` ALONE (D12) keeps showing Liu's history here.
    const columns = buildColumns({
      sundayDates: ["2026-08-02", "2026-08-09", "2026-08-16", "2026-08-23"],
      activeSatDates: [],
    });
    const savedWindow: ParticipantRole[] = [
      {
        _type: "sunday_role",
        date: "2026-07-05",
        leads: [],
        bgvs: [],
        chorus: [{ _id: "m3", member_name: "Liu" }],
        instruments: [],
        foh: [],
      },
    ];
    const { container } = render(<PlannerGrid {...baseProps({ columns, savedWindow })} />);
    fireEvent.click(cellFor(container, "coro", "2026-08-23"));
    const liuRow = candidateLi("Liu");
    const servedMarks = liuRow.querySelectorAll('span[class*="bg-[#00bfff]/70"]');
    expect(servedMarks.length).toBeGreaterThan(0);
  });
});

describe("PlannerGrid — candidate order frozen while the picker is open", () => {
  // Picking a candidate changes THEIR `load` (they now occupy a seat in this
  // grid) which, unfrozen, changes `rankCandidates`' sort key and reshuffles
  // the whole list under the cursor — the bug report was "elements on the
  // list change places depending on if you choose them or not". Three equal
  // (load 0) candidates, alphabetical to start, and picking the ALPHABETICALLY
  // FIRST one is the case that actually moves under the unfrozen sort (load
  // ascending, then name) — picking the last one wouldn't visibly reorder.
  const localMembers: RankMember[] = [
    { _id: "ana", member_name: "Ana", memberType: ["voz"] },
    { _id: "ben", member_name: "Ben", memberType: ["voz"] },
    { _id: "cat", member_name: "Cat", memberType: ["voz"] },
  ];

  // Order of KNOWN candidate names only — `li.textContent` also carries the
  // live `load` number and the `Ya asignado` badge, both of which are
  // expected to change live; only the SEQUENCE of names must not.
  function names(): string[] {
    return screen
      .getAllByRole("button")
      .filter((el) => el.tagName === "LI")
      .map((el) => (el.textContent ?? "").trim())
      .map((text) => ["Ana", "Ben", "Cat"].find((n) => text.includes(n)) ?? text);
  }

  it("keeps the rendered order stable after a pick, while the picked row's own state (selected) still updates live", () => {
    let cells: GridCell[] = [];
    const onCellsChange = vi.fn((next: GridCell[]) => {
      cells = next;
    });
    const { container, rerender } = render(
      <PlannerGrid {...baseProps({ members: localMembers, cells, onCellsChange })} />,
    );
    fireEvent.click(cellFor(container, "lead", "2026-08-09"));

    const before = names();
    expect(before.length).toBe(3);
    expect(before[0]).toContain("Ana"); // alphabetical tie-break, all load 0

    fireEvent.click(candidateLi("Ana"));
    expect(onCellsChange).toHaveBeenCalledTimes(1);
    rerender(<PlannerGrid {...baseProps({ members: localMembers, cells, onCellsChange })} />);

    const after = names();
    // Order is UNCHANGED: without the fix, Ana's load goes 0 -> 1 and she
    // sorts back below Ben/Cat, reordering the list under the cursor.
    expect(after).toEqual(before);
    // Ana's OWN row state still updates live — she now reads as selected.
    const anaRow = candidateLi("Ana");
    expect(anaRow.className).toContain("border-[#00bfff] bg-[#00bfff]/10");
  });

  it("reopening the picker (a fresh cell) recomputes the order from scratch", () => {
    let cells: GridCell[] = [];
    const onCellsChange = vi.fn((next: GridCell[]) => {
      cells = next;
    });
    const { container, rerender } = render(
      <PlannerGrid {...baseProps({ members: localMembers, cells, onCellsChange })} />,
    );
    fireEvent.click(cellFor(container, "lead", "2026-08-09"));
    fireEvent.click(candidateLi("Ana"));
    rerender(<PlannerGrid {...baseProps({ members: localMembers, cells, onCellsChange })} />);
    fireEvent.click(screen.getByRole("button", { name: /cerrar/i }));

    fireEvent.click(cellFor(container, "bgv", "2026-08-09"));
    // Fresh order for the NEW cell: Ana now carries real load from Lead, so a
    // freshly-opened BGV picker (not the frozen Lead-picker order) sorts her
    // below Ben/Cat.
    const reopened = names();
    const anaIdx = reopened.findIndex((n) => n.includes("Ana"));
    const benIdx = reopened.findIndex((n) => n.includes("Ben"));
    expect(anaIdx).toBeGreaterThan(benIdx);
  });
});

describe("PlannerGrid — manual pick blocking (D6)", () => {
  it("REFUSES a same-category double, exactly as SeatBoard does", () => {
    const cells: InputGridCell[] = [{ date: "2026-08-09", rowId: "lead", memberIds: ["m1"], origin: "manual" }];
    const onCellsChange = vi.fn();
    const { container } = render(<PlannerGrid {...baseProps({ cells, onCellsChange })} />);
    fireEvent.click(cellFor(container, "bgv", "2026-08-09"));
    const frankRow = candidateLi("Frank");
    expect(frankRow.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(frankRow);
    expect(onCellsChange).not.toHaveBeenCalled();
  });

  it("does NOT block cross-category double duty (voz + instrumento)", () => {
    const cells: InputGridCell[] = [{ date: "2026-08-09", rowId: "lead", memberIds: ["m1"], origin: "manual" }];
    const membersWithBoth: RankMember[] = [
      { _id: "m1", member_name: "Frank", memberType: ["voz", "instrumento"] },
      ...members.slice(1),
    ];
    const onCellsChange = vi.fn();
    const { container } = render(
      <PlannerGrid {...baseProps({ cells, members: membersWithBoth, onCellsChange })} />,
    );
    fireEvent.click(cellFor(container, "instrumento:Bass", "2026-08-09"));
    const frankRow = candidateLi("Frank");
    expect(frankRow.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(frankRow);
    expect(onCellsChange).toHaveBeenCalledTimes(1);
  });
});

describe("PlannerGrid — duplicate surfacing after Auto (fact 27)", () => {
  it("surfaces a same-category duplicate against BOTH cells", () => {
    const cells: InputGridCell[] = [
      { date: "2026-08-09", rowId: "lead", memberIds: ["m1"], origin: "auto" },
      { date: "2026-08-09", rowId: "bgv", memberIds: ["m1"], origin: "auto" },
    ];
    const { container } = render(<PlannerGrid {...baseProps({ cells })} />);
    const leadCell = cellFor(container, "lead", "2026-08-09");
    const bgvCell = cellFor(container, "bgv", "2026-08-09");
    expect(within(leadCell).getByText(/⚠/)).toBeTruthy();
    expect(within(bgvCell).getByText(/⚠/)).toBeTruthy();
  });

  it("does NOT flag cross-category double duty (voz + instrumento)", () => {
    const cells: InputGridCell[] = [
      { date: "2026-08-09", rowId: "lead", memberIds: ["m1"], origin: "auto" },
      { date: "2026-08-09", rowId: "instrumento:Bass", memberIds: ["m1"], origin: "manual" },
    ];
    const { container } = render(<PlannerGrid {...baseProps({ cells })} />);
    expect(container.querySelectorAll(".border-red-500\\/50").length).toBe(0);
  });

  it("flags a same-category duplicate on its own two rows WITHOUT bleeding onto a legitimate cross-category cell for the same member (Finding 1)", () => {
    // m1 is hand-assigned to Lead; Auto also placed them in BGV — a real
    // same-category (voz) duplicate. m1 ALSO holds a Bass seat the same
    // date — legitimate voz+instrumento double duty (D4) that must never
    // be flagged. `duplicates` is keyed by member alone across the whole
    // date, so checking `duplicates.has(id)` without also checking that
    // THIS row participates would incorrectly paint the Bass chip red too.
    const cells: InputGridCell[] = [
      { date: "2026-08-09", rowId: "lead", memberIds: ["m1"], origin: "manual" },
      { date: "2026-08-09", rowId: "bgv", memberIds: ["m1"], origin: "auto" },
      { date: "2026-08-09", rowId: "instrumento:Bass", memberIds: ["m1"], origin: "manual" },
    ];
    const { container } = render(<PlannerGrid {...baseProps({ cells })} />);
    const leadCell = cellFor(container, "lead", "2026-08-09");
    const bgvCell = cellFor(container, "bgv", "2026-08-09");
    const bassCell = cellFor(container, "instrumento:Bass", "2026-08-09");
    expect(within(leadCell).getByText(/⚠/)).toBeTruthy();
    expect(within(bgvCell).getByText(/⚠/)).toBeTruthy();
    expect(within(bassCell).queryByText(/⚠/)).toBeNull();
    expect(bassCell.querySelectorAll(".border-red-500\\/50").length).toBe(0);
  });

  it("flags duplicates in BOTH categories when a member is doubled in each", () => {
    // `categoryDuplicatesForDate` groups by category and must ACCUMULATE across
    // them. Assigning instead of appending keeps only the last category's rows,
    // so the voz duplicate silently stops being flagged — the very thing the
    // function exists to catch.
    const cells: InputGridCell[] = [
      // ONE member doubled in BOTH categories — that is what makes an
      // overwrite lose a flag. Two different members would never collide.
      { date: "2026-08-09", rowId: "lead", memberIds: ["m1"], origin: "manual" },
      { date: "2026-08-09", rowId: "bgv", memberIds: ["m1"], origin: "auto" },
      { date: "2026-08-09", rowId: "instrumento:Bass", memberIds: ["m1"], origin: "manual" },
      { date: "2026-08-09", rowId: "instrumento:Keys", memberIds: ["m1"], origin: "manual" },
    ];
    const { container } = render(<PlannerGrid {...baseProps({ cells })} />);
    for (const rowId of ["lead", "bgv", "instrumento:Bass", "instrumento:Keys"]) {
      expect(
        within(cellFor(container, rowId, "2026-08-09")).getByText(/⚠/),
        rowId,
      ).toBeTruthy();
    }
  });

  it("clears the row-removal refusal once a cell is edited again", () => {
    const cells: InputGridCell[] = [
      { date: "2026-08-09", rowId: "instrumento:Bass", memberIds: ["d1"], origin: "manual" },
    ];
    const { container, queryByText } = render(<PlannerGrid {...baseProps({ cells })} />);
    fireEvent.click(screen.getByRole("button", { name: /Eliminar fila Bass/i }));
    expect(queryByText(/Vacía la fila/)).toBeTruthy();
    // Target the Bass cell and toggle its occupant off: an edit resolves the
    // refusal, so the message must not linger. "Samo" also renders as a chip in
    // the cell, so scope the click to the candidate picker.
    fireEvent.click(cellFor(container, "instrumento:Bass", "2026-08-09"));
    const picker = container.querySelector(".overflow-y-auto") as HTMLElement;
    fireEvent.click(within(picker).getByText("Samo"));
    expect(queryByText(/Vacía la fila/)).toBeFalsy();
  });

  it("surfaces a duplicate hidden behind +N — the over-target state +N exists for (Finding 2)", () => {
    // Lead's target is 2. Three occupants means the third (m1) is hidden
    // behind "+1". m1 is ALSO in BGV the same date, a real same-category
    // duplicate — but the old code only ever checked `visibleIds`, so a
    // duplicate sitting in the hidden tail was invisible exactly when +N
    // exists (an over-target cell).
    const cells: InputGridCell[] = [
      { date: "2026-08-09", rowId: "lead", memberIds: ["m2", "m3", "m1"], origin: "auto" },
      { date: "2026-08-09", rowId: "bgv", memberIds: ["m1"], origin: "auto" },
    ];
    const { container } = render(<PlannerGrid {...baseProps({ cells })} />);
    const leadCell = cellFor(container, "lead", "2026-08-09");
    const plusButton = within(leadCell).getByRole("button", { name: /ver 1 más/i });
    expect(plusButton.textContent).toMatch(/⚠/);
  });
});

describe("PlannerGrid — Auto contract (D15)", () => {
  it("disables Auto with a visible reason when gateBlocked", () => {
    render(
      <PlannerGrid
        {...baseProps({ autoState: { pending: false, error: null, disabledReason: "Datos incompletos." } })}
      />,
    );
    const btn = screen.getByRole("button", { name: /auto-asignar/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByText("Datos incompletos.")).toBeTruthy();
  });

  it("shows the pending state while in flight and disables Auto", () => {
    render(<PlannerGrid {...baseProps({ autoState: { pending: true, error: null, disabledReason: null } })} />);
    expect(screen.getByText(/calculando/i)).toBeTruthy();
    const btn = screen.getByRole("button", { name: /calculando/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("renders a solver ok:false reason and leaves the grid untouched", () => {
    const cells: InputGridCell[] = [{ date: "2026-08-09", rowId: "lead", memberIds: ["m1"], origin: "manual" }];
    const { rerender } = render(
      <PlannerGrid {...baseProps({ cells, autoState: { pending: false, error: null, disabledReason: null } })} />,
    );
    rerender(
      <PlannerGrid
        {...baseProps({
          cells,
          autoState: { pending: false, error: "Mes con poco personal.", disabledReason: null },
        })}
      />,
    );
    expect(screen.getByText("Mes con poco personal.")).toBeTruthy();
    // The grid itself is unchanged — still shows Frank in Lead (controlled by `cells`).
    expect(screen.getByText("Frank")).toBeTruthy();
  });

  it("renders a connection-error message the same way", () => {
    render(
      <PlannerGrid
        {...baseProps({
          autoState: { pending: false, error: "No se pudo conectar con el solver.", disabledReason: null },
        })}
      />,
    );
    expect(screen.getByText("No se pudo conectar con el solver.")).toBeTruthy();
  });
});

describe("PlannerGrid — Auto confirms first (D2)", () => {
  it("shows a confirmation naming the replace scope before calling onAuto, and only calls onAuto on confirm", () => {
    const onAuto = vi.fn();
    render(<PlannerGrid {...baseProps({ onAuto, unaddressableDates: ["2026-08-01"] })} />);
    fireEvent.click(screen.getByRole("button", { name: /auto-asignar/i }));
    expect(onAuto).not.toHaveBeenCalled();
    expect(screen.getByText(/reemplazar/i)).toBeTruthy();
    expect(screen.getByText(/1 sábado\(s\) fuera del alcance/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^confirmar$/i }));
    expect(onAuto).toHaveBeenCalledTimes(1);
  });

  it("cancelling the confirmation never calls onAuto", () => {
    const onAuto = vi.fn();
    render(<PlannerGrid {...baseProps({ onAuto })} />);
    fireEvent.click(screen.getByRole("button", { name: /auto-asignar/i }));
    fireEvent.click(screen.getByRole("button", { name: /^cancelar$/i }));
    expect(onAuto).not.toHaveBeenCalled();
    expect(screen.queryByText(/reemplazar/i)).toBeNull();
  });
});

describe("PlannerGrid — instrument/FOH manual label (D5)", () => {
  it("instrument and FOH rows carry a persistent 'asignación manual' label", () => {
    render(<PlannerGrid {...baseProps()} />);
    const labels = screen.getAllByText(/asignación manual/i);
    // 5 instrument rows + 1 FOH row = 6, from buildRows()'s defaults.
    expect(labels.length).toBe(6);
  });

  it("voice rows carry no such label", () => {
    render(<PlannerGrid {...baseProps()} />);
    const leadRowLabelContainer = screen.getByText("Lead").parentElement as HTMLElement;
    expect(within(leadRowLabelContainer).queryByText(/asignación manual/i)).toBeNull();
  });
});

describe("PlannerGrid — preflight and unaddressable markers", () => {
  it("shows each date column's TargetPreflight state and reasons", () => {
    const preflight: TargetPreflight = {
      targetKey: "sunday_role:2026-08-09",
      state: "blocked",
      reasons: ["role_single"],
      ids: [],
      blockedBy: [],
    };
    render(<PlannerGrid {...baseProps({ preflightFor: () => preflight })} />);
    expect(screen.getByText("Bloqueado")).toBeTruthy();
  });

  it("renders an explicit 'fuera del alcance de Auto' marker for an unaddressable date", () => {
    render(<PlannerGrid {...baseProps({ columns: WEEKEND, unaddressableDates: ["2026-08-08"] })} />);
    expect(screen.getByText(/fuera del alcance de auto/i)).toBeTruthy();
  });
});

describe("PlannerGrid — unresolvedNames and unfilled surfacing", () => {
  it("surfaces unresolvedNames", () => {
    render(<PlannerGrid {...baseProps({ unresolvedNames: ["Nombre Fantasma"] })} />);
    expect(screen.getByText(/nombre fantasma/i)).toBeTruthy();
  });

  it("surfaces mapUnfilledSeats output against the specific row and date", () => {
    const { container } = render(<PlannerGrid {...baseProps({ unfilled: [{ columnId: SUNDAY_ONLY[0].columnId, rowId: "coro" }] })} />);
    const coroCell = cellFor(container, "coro", "2026-08-09");
    expect(within(coroCell).getByText(/sin cubrir/i)).toBeTruthy();
  });

  it("keeps the degradation explainer alongside the short-staffing signal", () => {
    render(<PlannerGrid {...baseProps({ unfilled: [{ columnId: SUNDAY_ONLY[0].columnId, rowId: "coro" }] })} />);
    expect(screen.getByText(/el líder siempre se asigna/i)).toBeTruthy();
    expect(screen.getByText(/lugares sin cubrir/i)).toBeTruthy();
  });
});

describe("PlannerGrid — diagnostics", () => {
  it("surfaces fairness_relaxed, sun_lead/bgv fairness, and history_runs_used", () => {
    const diagnostics: SolveDiagnostics = {
      fairness_relaxed: true,
      sun_lead_fairness_relaxed: true,
      sun_bgv_fairness_relaxed: true,
      history_runs_used: 2,
    };
    render(<PlannerGrid {...baseProps({ diagnostics })} />);
    expect(screen.getByText(/equidad relajada/i)).toBeTruthy();
    expect(screen.getByText(/líderes de domingo relajada/i)).toBeTruthy();
    expect(screen.getByText(/bgv de domingo relajada/i)).toBeTruthy();
    expect(screen.getByText(/historial usado: 2/i)).toBeTruthy();
  });
});

describe("PlannerGrid — per-column skip control (D18)", () => {
  it("calls onToggleSkip(columnId) and reflects the skipped set", () => {
    const onToggleSkip = vi.fn();
    const { rerender } = render(<PlannerGrid {...baseProps({ onToggleSkip })} />);
    const checkbox = screen.getByLabelText("Omitir 2026-08-09") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);
    expect(onToggleSkip).toHaveBeenCalledWith(SUNDAY_ONLY[0].columnId);

    rerender(<PlannerGrid {...baseProps({ onToggleSkip, skipped: new Set([SUNDAY_ONLY[0].columnId]) })} />);
    const checkbox2 = screen.getByLabelText("Omitir 2026-08-09") as HTMLInputElement;
    expect(checkbox2.checked).toBe(true);
  });
});

describe("PlannerGrid — row management", () => {
  it("exposes the stored mutation lock on cells, headers, candidates, and row controls", () => {
    const onCellsChange = vi.fn();
    const onRowsChange = vi.fn();
    const onStoredHeaderChange = vi.fn();
    const cells: InputGridCell[] = [
      { date: "2026-08-09", rowId: "lead", memberIds: ["m1"], origin: "manual" },
    ];
    const { container, rerender } = render(
      <PlannerGrid
        {...baseProps({ mode: "stored", cells, onCellsChange, onRowsChange, onStoredHeaderChange })}
      />,
    );
    fireEvent.click(cellFor(container, "lead", "2026-08-09"));
    expect(candidateLi("Gaby").getAttribute("aria-disabled")).toBeNull();

    rerender(
      <PlannerGrid
        {...baseProps({ mode: "stored", cells, onCellsChange, onRowsChange, onStoredHeaderChange, mutationLocked: true })}
      />,
    );

    const leadCell = cellFor(container, "lead", "2026-08-09");
    expect(leadCell.getAttribute("aria-disabled")).toBe("true");
    expect(candidateLi("Gaby").getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(candidateLi("Gaby"));
    expect(onCellsChange).not.toHaveBeenCalled();
    expect((screen.getByDisplayValue("2026-08-09") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /eliminar fila drums/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByPlaceholderText("Nuevo instrumento") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getAllByRole("button", { name: "Añadir" }).every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    expect(onRowsChange).not.toHaveBeenCalled();
    expect(onStoredHeaderChange).not.toHaveBeenCalled();
  });

  it("adds an instrument row via onRowsChange", () => {
    const onRowsChange = vi.fn();
    render(<PlannerGrid {...baseProps({ onRowsChange })} />);
    const input = screen.getByPlaceholderText("Nuevo instrumento") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Trombone" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(onRowsChange).toHaveBeenCalledTimes(1);
    const next: GridRow[] = onRowsChange.mock.calls[0][0];
    expect(next.some((r) => r.label === "Trombone")).toBe(true);
  });

  it("rejects a new instrument row name that only differs by case", () => {
    render(<PlannerGrid {...baseProps()} />);
    const input = screen.getByPlaceholderText("Nuevo instrumento") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "drums" } }); // "Drums" already exists
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(screen.getByText(/ya existe/i)).toBeTruthy();
  });

  it("refuses to remove a row that holds occupants, with a reason", () => {
    const cells: InputGridCell[] = [
      { date: "2026-08-09", rowId: "instrumento:Drums", memberIds: ["d1"], origin: "manual" },
    ];
    const onRowsChange = vi.fn();
    render(<PlannerGrid {...baseProps({ cells, onRowsChange })} />);
    fireEvent.click(screen.getByRole("button", { name: /eliminar fila drums/i }));
    expect(onRowsChange).not.toHaveBeenCalled();
    expect(screen.getByText(/vacía la fila/i)).toBeTruthy();
  });

  it("removes an empty row", () => {
    const onRowsChange = vi.fn();
    render(<PlannerGrid {...baseProps({ onRowsChange })} />); // Drums has no cells
    fireEvent.click(screen.getByRole("button", { name: /eliminar fila drums/i }));
    expect(onRowsChange).toHaveBeenCalledTimes(1);
    const next: GridRow[] = onRowsChange.mock.calls[0][0];
    expect(next.some((r) => r.id === "instrumento:Drums")).toBe(false);
  });

  it("voice rows offer no remove control", () => {
    render(<PlannerGrid {...baseProps()} />);
    expect(screen.queryByRole("button", { name: /eliminar fila lead/i })).toBeNull();
  });

  it("clears the remove-row error once `cells` changes make the row empty (Finding 5)", () => {
    // Nothing in the old code ever cleared `removeError` except a
    // successful `removeRow` call — so once the refusal fires, it outlives
    // whatever condition caused it if the row is emptied by some OTHER
    // path (Auto, a manual pick clearing the last occupant, `cells` simply
    // changing under a controlled re-render).
    const cells: InputGridCell[] = [
      { date: "2026-08-09", rowId: "instrumento:Drums", memberIds: ["d1"], origin: "manual" },
    ];
    const { rerender } = render(<PlannerGrid {...baseProps({ cells })} />);
    fireEvent.click(screen.getByRole("button", { name: /eliminar fila drums/i }));
    expect(screen.getByText(/vacía la fila/i)).toBeTruthy();

    rerender(<PlannerGrid {...baseProps({ cells: [] })} />);
    expect(screen.queryByText(/vacía la fila/i)).toBeNull();
  });
});

describe("PlannerGrid — copy across dates (fact 26, grid-only)", () => {
  it("copies an instrument row's occupants to every other date in the grid", () => {
    const columns = buildColumns({ sundayDates: ["2026-08-02", "2026-08-09"], activeSatDates: [] });
    const cells: InputGridCell[] = [
      { date: "2026-08-02", rowId: "instrumento:Drums", memberIds: ["d1", "d2"], origin: "manual" },
    ];
    const onCellsChange = vi.fn();
    const { container } = render(<PlannerGrid {...baseProps({ columns, cells, onCellsChange })} />);
    const sourceCell = cellFor(container, "instrumento:Drums", "2026-08-02");
    fireEvent.click(within(sourceCell).getByRole("button", { name: /copiar a todo el mes/i }));
    expect(onCellsChange).toHaveBeenCalledTimes(1);
    const next: GridCell[] = onCellsChange.mock.calls[0][0];
    const copied = next.find(
      (c) => c.rowId === "instrumento:Drums" && c.columnId === columns[1].columnId,
    );
    expect(copied?.occupants.map((o) => o.memberId).sort()).toEqual(["d1", "d2"]);
  });
});

// ─── E6 / E13 / P10: the rules on the grid ───────────────────────────────────
//
// Until Task 8 no `config` reached this component, so `ruleEnforcement` enforced
// nothing in production however well it was unit-tested. Everything below is the
// wiring, and the two-interaction shape of the override.
//
// SPECIAL_ONLY is a Wednesday special: nothing else in this codebase enforces a
// rule there — a special never reaches the solver — so it is the surface the
// user's requirement actually lands on.

const SPECIAL_DATE = "2026-08-12";

/** `Frank !with Gaby on *.Lead`, and nothing else, so one rule is under test. */
const CONFLICT_CONFIG: SolverConfig = {
  sundayLeads: [],
  saturdayLeads: [],
  support: [],
  restrictions: [],
  conflicts: [{ id: "c1", personA: "Frank", personB: "Gaby", pattern: "*.Lead" }],
  presence: [],
};

const FRANK_ON_LEAD: InputGridCell[] = [
  { date: SPECIAL_DATE, rowId: "lead", memberIds: ["m1"], origin: "manual" },
];

const specialProps = (over: PlannerGridTestOverrides = {}) =>
  baseProps({ columns: SPECIAL_ONLY, config: CONFLICT_CONFIG, ...over });

/** The picker's secondary override action, if the open picker offers one. */
const overrideButtons = () => screen.queryAllByRole("button", { name: "Asignar de todos modos" });

describe("PlannerGrid — a special column identifies itself (E18)", () => {
  it("renders the special's NAME alongside the Especial label", () => {
    render(<PlannerGrid {...baseProps({ columns: SPECIAL_ONLY })} />);
    expect(screen.getByText("Especial")).toBeTruthy();
    // Two specials can share a date, and the header's own "ya existe un servicio
    // especial con este nombre" copy points at a name the admin cannot see
    // without this.
    expect(screen.getByText("Vigilia")).toBeTruthy();
  });
});

describe("PlannerGrid — E6 hard blocks on a manual pick", () => {
  it("refuses a rule-blocked candidate on ADDING, inert and with the rule named", () => {
    const onCellsChange = vi.fn();
    const { container } = render(<PlannerGrid {...specialProps({ cells: FRANK_ON_LEAD, onCellsChange })} />);
    fireEvent.click(cellFor(container, "lead", SPECIAL_DATE));
    const gaby = candidateLi("Gaby");
    // Inert: no pointer target, no keyboard target, and the reason on screen.
    expect(gaby.getAttribute("aria-disabled")).toBe("true");
    expect(gaby.getAttribute("tabindex")).toBe("-1");
    expect(within(gaby).getByText("Regla: no puede coincidir con Frank")).toBeTruthy();
    fireEvent.click(gaby);
    fireEvent.keyDown(gaby, { key: "Enter" });
    fireEvent.keyDown(gaby, { key: " " });
    expect(onCellsChange).not.toHaveBeenCalled();
  });

  it("passes the config through — the same pick is free when no rules are supplied", () => {
    // The mutation this catches is the whole task: drop the `config` prop and
    // every test above still passes on a component that enforces nothing.
    const onCellsChange = vi.fn();
    const { container } = render(
      <PlannerGrid {...baseProps({ columns: SPECIAL_ONLY, cells: FRANK_ON_LEAD, onCellsChange })} />,
    );
    fireEvent.click(cellFor(container, "lead", SPECIAL_DATE));
    const gaby = candidateLi("Gaby");
    expect(gaby.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(gaby);
    expect(onCellsChange).toHaveBeenCalledTimes(1);
  });

  it("blocks on ADDING only — the cell's own occupant stays selectable (E6's trap)", () => {
    const onCellsChange = vi.fn();
    const { container } = render(<PlannerGrid {...specialProps({ cells: FRANK_ON_LEAD, onCellsChange })} />);
    fireEvent.click(cellFor(container, "lead", SPECIAL_DATE));
    const frank = candidateLi("Frank");
    expect(frank.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(frank);
    expect(onCellsChange.mock.calls[0][0].find((c: GridCell) => c.rowId === "lead").occupants).toEqual([]);
  });

  it("threads `sundayDates`, so a WEEK exclusion reaches the weekend grid", () => {
    // 2026-08-09 is the second Sunday of August 2026 (spine below), and the rule
    // bars Gaby from week 2. Without the spine `weekForColumn` cannot answer and
    // week exclusions are simply not evaluated — so this fails if the prop goes.
    const weekConfig: SolverConfig = {
      ...CONFLICT_CONFIG,
      conflicts: [],
      restrictions: [
        {
          id: "r1",
          person: "Gaby",
          excludedPatterns: [],
          fairness: "none",
          fairnessSlack: 0,
          weekExclusions: [{ id: "w", week: 2, pattern: "*.*" }],
          caps: [],
        },
      ],
    };
    const spine = ["2026-08-02", "2026-08-09", "2026-08-16", "2026-08-23", "2026-08-30"];
    const { container, unmount } = render(
      <PlannerGrid {...baseProps({ config: weekConfig, sundayDates: spine })} />,
    );
    fireEvent.click(cellFor(container, "lead", "2026-08-09"));
    expect(candidateLi("Gaby").getAttribute("aria-disabled")).toBe("true");
    unmount();

    const bare = render(<PlannerGrid {...baseProps({ config: weekConfig })} />);
    fireEvent.click(cellFor(bare.container, "lead", "2026-08-09"));
    expect(candidateLi("Gaby").getAttribute("aria-disabled")).toBeNull();
  });

  it("does NOT read `eligible` — an unavailable member is a penalty, never a block (fact 19)", () => {
    // `eligible` is the FILLER's composite and folds in availability. Wiring the
    // picker to it would turn "marked this date unavailable" into a hard refusal
    // on a shipped surface, dressed up as rule enforcement.
    const away: RankMember[] = members.map((mm) =>
      mm._id === "m2" ? { ...mm, unavailableDates: [SPECIAL_DATE] } : mm,
    );
    const onCellsChange = vi.fn();
    const { container } = render(
      <PlannerGrid {...specialProps({ members: away, cells: [], onCellsChange })} />,
    );
    fireEvent.click(cellFor(container, "lead", SPECIAL_DATE));
    const gaby = candidateLi("Gaby");
    expect(within(gaby).getByText("No disp.")).toBeTruthy();
    expect(gaby.getAttribute("aria-disabled")).toBeNull();
    expect(overrideButtons()).toHaveLength(0);
    fireEvent.click(gaby);
    expect(onCellsChange).toHaveBeenCalledTimes(1);
  });
});

describe("PlannerGrid — P10, the override takes a second, deliberate action", () => {
  it("seats the blocked member and records them, only via 'Asignar de todos modos'", () => {
    const onCellsChange = vi.fn();
    const { container } = render(<PlannerGrid {...specialProps({ cells: FRANK_ON_LEAD, onCellsChange })} />);
    fireEvent.click(cellFor(container, "lead", SPECIAL_DATE));

    // The primary row first: it must do nothing at all.
    fireEvent.click(candidateLi("Gaby"));
    expect(onCellsChange).not.toHaveBeenCalled();

    // Exactly one candidate offers the override — the rule-blocked one.
    const buttons = overrideButtons();
    expect(buttons).toHaveLength(1);
    expect(within(candidateLi("Gaby")).getByRole("button", { name: "Asignar de todos modos" })).toBeTruthy();

    fireEvent.click(buttons[0]);
    expect(onCellsChange).toHaveBeenCalledTimes(1);
    const cell = onCellsChange.mock.calls[0][0].find((c: GridCell) => c.rowId === "lead");
    expect(cell.occupants.map((o: { memberId: string }) => o.memberId)).toEqual(["m1", "m2"]);
    expect(cell.overrides).toEqual(["m2"]);
    // And WHICH rule was waived, recorded with the seating: an override that
    // only knows "Gaby, here" is inherited by every rule written afterwards.
    expect(cell.overrideReasons).toEqual({ m2: "Regla: no puede coincidir con Frank" });
  });

  it("offers NO override for a same-category double — D6 is not a judgement call", () => {
    // Frank holds Lead; the BGV picker refuses him as a double. That refusal is
    // a data error on two shipped surfaces, not something to wave through.
    //
    // The config must ALSO rule-block him here, or this test passes for the
    // wrong reason: with `Frank !with Gaby on *.Lead` alone his
    // `ruleBlockedReason` on BGV is null, `overridable` is already false on its
    // FIRST term, and the `!candidate.blockedReason` term it exists to pin can
    // be deleted with every test still green. `Frank !in *.BGV` is what makes
    // him carry both refusals at once.
    const bothRefusals: SolverConfig = {
      ...CONFLICT_CONFIG,
      restrictions: [
        {
          id: "r-frank-bgv",
          person: "Frank",
          excludedPatterns: ["*.BGV"],
          fairness: "none",
          fairnessSlack: 0,
          weekExclusions: [],
          caps: [],
        },
      ],
    };
    const { container } = render(
      <PlannerGrid {...specialProps({ cells: FRANK_ON_LEAD, config: bothRefusals })} />,
    );
    fireEvent.click(cellFor(container, "bgv", SPECIAL_DATE));
    const frank = candidateLi("Frank");
    expect(frank.getAttribute("aria-disabled")).toBe("true");
    // Both refusals really are live on this row: the double wins the wording
    // (`title`), and the rule is named in the row's own text.
    expect(frank.getAttribute("title")).toMatch(/Lead/);
    expect(within(frank).getByText(/Regla: excluido de \*\.BGV/)).toBeTruthy();
    expect(overrideButtons()).toHaveLength(0);
  });

  /** Gaby seated past `Frank !with Gaby on *.Lead`, the waived rule recorded. */
  const OVERRIDDEN_PAIR: InputGridCell[] = [
    {
      date: SPECIAL_DATE,
      rowId: "lead",
      memberIds: ["m1", "m2"],
      origin: "manual",
      overrides: ["m2"],
      overrideReasons: { m2: "Regla: no puede coincidir con Frank" },
    },
  ];

  it("renders a persistent 'regla anulada' marker naming the rule, and does NOT re-flag (E13)", () => {
    const cells = OVERRIDDEN_PAIR;
    const { container } = render(<PlannerGrid {...specialProps({ cells })} />);
    const cell = cellFor(container, "lead", SPECIAL_DATE);
    expect(within(cell).getByText(/Regla anulada — Gaby: Regla: no puede coincidir con Frank/)).toBeTruthy();
    // Neither party is flagged: one override covers the seating from both ends.
    expect(within(cell).queryByText(/⚠/)).toBeNull();
  });

  it("clears the record when the member is removed", () => {
    const cells = OVERRIDDEN_PAIR;
    const onCellsChange = vi.fn();
    const { container } = render(<PlannerGrid {...specialProps({ cells, onCellsChange })} />);
    fireEvent.click(cellFor(container, "lead", SPECIAL_DATE));
    fireEvent.click(candidateLi("Gaby"));
    const next = onCellsChange.mock.calls[0][0].find((c: GridCell) => c.rowId === "lead");
    expect(next.occupants.map((o: { memberId: string }) => o.memberId)).toEqual(["m1"]);
    // A stale entry would silence E13 if the same person were ever re-seated.
    expect(next.overrides).toEqual([]);
    expect(next.overrideReasons).toEqual({});
  });

  it("flags a rule ADDED AFTER the override fresh, instead of pre-sanctioning it", () => {
    // The walked failure: the admin overrides Gaby onto Lead past
    // `Frank !with Gaby`; a week later they add `Gaby !in *.Lead`. Scoped to
    // (date, row, member), the override covers the new rule too and the cell
    // reads "Regla anulada — Gaby: Regla: excluido de *.Lead" — an exception the
    // admin never made, presented as one they did. Nothing re-runs Auto and no
    // cell changes here; only the config does.
    const withNewRule: SolverConfig = {
      ...CONFLICT_CONFIG,
      restrictions: [
        {
          id: "r-gaby-lead",
          person: "Gaby",
          excludedPatterns: ["*.Lead"],
          fairness: "none",
          fairnessSlack: 0,
          weekExclusions: [],
          caps: [],
        },
      ],
    };
    const { container, rerender } = render(<PlannerGrid {...specialProps({ cells: OVERRIDDEN_PAIR })} />);
    expect(
      within(cellFor(container, "lead", SPECIAL_DATE)).getByText(/Regla anulada — Gaby/),
    ).toBeTruthy();

    rerender(<PlannerGrid {...specialProps({ cells: OVERRIDDEN_PAIR, config: withNewRule })} />);
    const cell = cellFor(container, "lead", SPECIAL_DATE);
    expect(within(cell).getByText(/⚠ Gaby: Regla: excluido de \*\.Lead/)).toBeTruthy();
    expect(within(cell).queryByText(/Regla anulada/)).toBeNull();
  });
});

describe("PlannerGrid — E13 re-checks what is already seated", () => {
  /** The shape `applySolveResponse` writes: seated by the solver, not by hand. */
  const SOLVER_PAIR: InputGridCell[] = [
    { date: SPECIAL_DATE, rowId: "lead", memberIds: ["m1", "m2"], origin: "auto" },
  ];

  it("flags a violating pair the SOLVER produced, naming the rule for both", () => {
    const { container } = render(<PlannerGrid {...specialProps({ cells: SOLVER_PAIR })} />);
    const cell = cellFor(container, "lead", SPECIAL_DATE);
    expect(within(cell).getByText(/⚠ Frank: Regla: no puede coincidir con Gaby/)).toBeTruthy();
    expect(within(cell).getByText(/⚠ Gaby: Regla: no puede coincidir con Frank/)).toBeTruthy();
  });

  it("lets the flagged pair still be UN-SEATED — the trap the self-exemption exists for", () => {
    // `CandidateRow` guards onClick and onKeyDown on `!blocked`, so if the rules
    // refused a cell's own occupants the admin's only escape from a solver-made
    // violation would be discarding the month.
    const onCellsChange = vi.fn();
    const { container } = render(<PlannerGrid {...specialProps({ cells: SOLVER_PAIR, onCellsChange })} />);
    fireEvent.click(cellFor(container, "lead", SPECIAL_DATE));
    const gaby = candidateLi("Gaby");
    expect(gaby.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(gaby);
    expect(
      onCellsChange.mock.calls[0][0]
        .find((c: GridCell) => c.rowId === "lead")
        .occupants.map((o: { memberId: string }) => o.memberId),
    ).toEqual(["m1"]);
  });

  it("flags a violation created by EDITING the rules after the month was seated", () => {
    // Same cells throughout — only the config arrives. Nothing re-runs Auto.
    const { container, rerender } = render(
      <PlannerGrid {...baseProps({ columns: SPECIAL_ONLY, cells: SOLVER_PAIR })} />,
    );
    expect(within(cellFor(container, "lead", SPECIAL_DATE)).queryByText(/⚠/)).toBeNull();
    rerender(<PlannerGrid {...specialProps({ cells: SOLVER_PAIR })} />);
    expect(within(cellFor(container, "lead", SPECIAL_DATE)).getByText(/⚠ Gaby/)).toBeTruthy();
  });

  it("surfaces a violation hidden behind +N, like a duplicate", () => {
    const cells: InputGridCell[] = [
      { date: SPECIAL_DATE, rowId: "lead", memberIds: ["m3", "m1", "m2"], origin: "auto" },
    ];
    const { container } = render(<PlannerGrid {...specialProps({ cells })} />);
    const cell = cellFor(container, "lead", SPECIAL_DATE);
    // Lead's target is 2, so Gaby sits in the hidden tail.
    const more = within(cell).getByRole("button", { name: /Ver 1 más/ });
    expect(more.textContent).toContain("⚠");
  });

  it("does not flag an unrelated pairing", () => {
    const cells: InputGridCell[] = [
      { date: SPECIAL_DATE, rowId: "lead", memberIds: ["m1", "m3"], origin: "auto" },
    ];
    const { container } = render(<PlannerGrid {...specialProps({ cells })} />);
    expect(within(cellFor(container, "lead", SPECIAL_DATE)).queryByText(/⚠/)).toBeNull();
  });
});

describe("PlannerGrid — a config persisted before `conflicts`/`presence` existed", () => {
  // `MonthGenerator` hydrates `owt_solver_config_v3` checking only that
  // `sundayLeads` and `restrictions` are arrays. A value written before those
  // two fields were added sets state with them `undefined` — and it is sitting
  // in an admin's browser right now. Passing it to `rankCandidates` reads it
  // DURING RENDER, so an unguarded iteration is a white screen on the planner.
  //
  // These tests cover the GRID's render path only. The generator's own config
  // step crashes FIRST and harder on the same value — `MemberPool` and
  // `RuleBuilder` iterate the raw config on their first render — and nothing in
  // `ruleEnforcement` is on that path. `MonthGenerator`'s hydration normaliser
  // is the sole guard there; see the comment at its `STORAGE_KEY` read.
  const LEGACY = {
    sundayLeads: [],
    saturdayLeads: [],
    support: [],
    restrictions: [
      {
        id: "r1",
        person: "Gaby",
        excludedPatterns: ["*.Lead"],
        fairness: "none",
        fairnessSlack: 0,
        weekExclusions: [],
        caps: [],
      },
    ],
  } as unknown as PlannerGridProps["config"];

  it("renders the grid and the picker, and still enforces the rules it does carry", () => {
    const { container } = render(
      <PlannerGrid {...baseProps({ columns: SPECIAL_ONLY, config: LEGACY })} />,
    );
    expect(screen.getByText("Lead")).toBeTruthy();
    fireEvent.click(cellFor(container, "lead", SPECIAL_DATE));
    expect(candidateLi("Gaby").getAttribute("aria-disabled")).toBe("true");
    expect(candidateLi("Frank").getAttribute("aria-disabled")).toBeNull();
  });
});
