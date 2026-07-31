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
import { buildColumns, buildRows, type GridCell, type GridColumn, type GridRow } from "../plannerModel";
import type { RankMember } from "../candidateRanking";
import type { TargetPreflight } from "../serviceReadiness";
import type { ParticipantRole } from "@/app/utils/computeParticipation";

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

function baseProps(overrides: Partial<PlannerGridProps> = {}): PlannerGridProps {
  return {
    rows: ROWS,
    columns: SUNDAY_ONLY,
    cells: [],
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
  };
}

/** The interactive cell root for an exact (rowId, date) pair. */
function cellFor(container: HTMLElement, rowId: string, date: string): HTMLElement {
  const el = container.querySelector(`[data-row-id="${rowId}"][data-date="${date}"]`);
  if (!el) throw new Error(`cell not found for rowId=${rowId} date=${date}`);
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
    const cells: GridCell[] = [{ date: "2026-08-09", rowId: "lead", memberIds: ["m1"], origin: "manual" }];
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
    const cells: GridCell[] = [{ date: "2026-08-08", rowId: "lead", memberIds: ["m1"], origin: "auto" }];
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
    const cells: GridCell[] = [
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
    const cells: GridCell[] = [
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
    const cells: GridCell[] = [
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
    const cells: GridCell[] = [
      { date: "2026-08-09", rowId: "instrumento:Drums", memberIds: ["d1", "d2"], origin: "manual" },
    ];
    const { container } = render(<PlannerGrid {...baseProps({ cells })} />);
    const cellRoot = cellFor(container, "instrumento:Drums", "2026-08-09");
    expect(within(cellRoot).getByText("Samo")).toBeTruthy();
    expect(within(cellRoot).getByText("Tony")).toBeTruthy();
    expect(within(cellRoot).queryByText(/^\+\d/)).toBeNull();
  });

  it("above target, a solvable cell still accepts a new occupant (D6) — no cell ever replaces", () => {
    const cells: GridCell[] = [
      { date: "2026-08-09", rowId: "lead", memberIds: ["m1", "m2", "m3"], origin: "auto" },
    ];
    const onCellsChange = vi.fn();
    const { container } = render(<PlannerGrid {...baseProps({ cells, onCellsChange })} />);
    fireEvent.click(within(cellFor(container, "lead", "2026-08-09")).getByRole("button", { name: /ver 1 más/i }));
    fireEvent.click(screen.getByText("Mkz"));
    expect(onCellsChange).toHaveBeenCalledTimes(1);
    const next: GridCell[] = onCellsChange.mock.calls[0][0];
    const lead = next.find((c) => c.rowId === "lead" && c.date === "2026-08-09")!;
    expect(lead.memberIds.sort()).toEqual(["m1", "m2", "m3", "m4"].sort());
  });

  it("an over-target solvable cell carries a Spanish text warning, not just a border color (Finding 6)", () => {
    const cells: GridCell[] = [
      { date: "2026-08-09", rowId: "lead", memberIds: ["m1", "m2", "m3"], origin: "auto" }, // target 2, +1
    ];
    const { container } = render(<PlannerGrid {...baseProps({ cells })} />);
    const cellRoot = cellFor(container, "lead", "2026-08-09");
    expect(within(cellRoot).getByText(/por encima del objetivo/i)).toBeTruthy();
  });

  it("a non-solvable Drums cell with two occupants never replaces a third addition", () => {
    const cells: GridCell[] = [
      { date: "2026-08-09", rowId: "instrumento:Drums", memberIds: ["d1", "d2"], origin: "manual" },
    ];
    const onCellsChange = vi.fn();
    const { container } = render(<PlannerGrid {...baseProps({ cells, onCellsChange })} />);
    fireEvent.click(cellFor(container, "instrumento:Drums", "2026-08-09"));
    fireEvent.click(screen.getByText("Fanta"));
    const next: GridCell[] = onCellsChange.mock.calls[0][0];
    const drums = next.find((c) => c.rowId === "instrumento:Drums")!;
    expect(drums.memberIds.sort()).toEqual(["d1", "d2", "d3"].sort());
  });
});

describe("PlannerGrid — ranking (D12)", () => {
  it("clicking a cell opens the ranked list, with `assigned` built from that date's whole column", () => {
    const cells: GridCell[] = [{ date: "2026-08-09", rowId: "lead", memberIds: ["m1"], origin: "manual" }];
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
    const cells: GridCell[] = [{ date: "2026-08-02", rowId: "lead", memberIds: ["ana"], origin: "auto" }];
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
    const cells: GridCell[] = [{ date: "2026-08-09", rowId: "lead", memberIds: ["m1"], origin: "manual" }];
    const onCellsChange = vi.fn();
    const { container } = render(<PlannerGrid {...baseProps({ cells, onCellsChange })} />);
    fireEvent.click(cellFor(container, "bgv", "2026-08-09"));
    const frankRow = candidateLi("Frank");
    expect(frankRow.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(frankRow);
    expect(onCellsChange).not.toHaveBeenCalled();
  });

  it("does NOT block cross-category double duty (voz + instrumento)", () => {
    const cells: GridCell[] = [{ date: "2026-08-09", rowId: "lead", memberIds: ["m1"], origin: "manual" }];
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
    const cells: GridCell[] = [
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
    const cells: GridCell[] = [
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
    const cells: GridCell[] = [
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
    const cells: GridCell[] = [
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
    const cells: GridCell[] = [
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
    const cells: GridCell[] = [
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
    const cells: GridCell[] = [{ date: "2026-08-09", rowId: "lead", memberIds: ["m1"], origin: "manual" }];
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
    const { container } = render(<PlannerGrid {...baseProps({ unfilled: [{ date: "2026-08-09", rowId: "coro" }] })} />);
    const coroCell = cellFor(container, "coro", "2026-08-09");
    expect(within(coroCell).getByText(/sin cubrir/i)).toBeTruthy();
  });

  it("keeps the degradation explainer alongside the short-staffing signal", () => {
    render(<PlannerGrid {...baseProps({ unfilled: [{ date: "2026-08-09", rowId: "coro" }] })} />);
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
  it("calls onToggleSkip(date) and reflects the skipped set", () => {
    const onToggleSkip = vi.fn();
    const { rerender } = render(<PlannerGrid {...baseProps({ onToggleSkip })} />);
    const checkbox = screen.getByLabelText("Omitir 2026-08-09") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);
    expect(onToggleSkip).toHaveBeenCalledWith("2026-08-09");

    rerender(<PlannerGrid {...baseProps({ onToggleSkip, skipped: new Set(["2026-08-09"]) })} />);
    const checkbox2 = screen.getByLabelText("Omitir 2026-08-09") as HTMLInputElement;
    expect(checkbox2.checked).toBe(true);
  });
});

describe("PlannerGrid — row management", () => {
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
    const cells: GridCell[] = [
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
    const cells: GridCell[] = [
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
    const cells: GridCell[] = [
      { date: "2026-08-02", rowId: "instrumento:Drums", memberIds: ["d1", "d2"], origin: "manual" },
    ];
    const onCellsChange = vi.fn();
    const { container } = render(<PlannerGrid {...baseProps({ columns, cells, onCellsChange })} />);
    const sourceCell = cellFor(container, "instrumento:Drums", "2026-08-02");
    fireEvent.click(within(sourceCell).getByRole("button", { name: /copiar a todo el mes/i }));
    expect(onCellsChange).toHaveBeenCalledTimes(1);
    const next: GridCell[] = onCellsChange.mock.calls[0][0];
    const copied = next.find((c) => c.rowId === "instrumento:Drums" && c.date === "2026-08-09");
    expect(copied?.memberIds.sort()).toEqual(["d1", "d2"]);
  });
});
