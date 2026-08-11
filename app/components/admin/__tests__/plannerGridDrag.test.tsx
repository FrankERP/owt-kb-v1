/** @vitest-environment jsdom */
// T4 of the grid drag-and-drop plan
// (docs/superpowers/plans/2026-08-06-grid-drag-and-drop.md) — the first task
// that changes what the admin can do. T2's `moveOccupant` and T3's `moveGate`
// are pure and were landed uncalled; this file is the proof that the drag
// composes them in that order and in no other.
//
// The mutations these tests are written to catch, each named at its assertion:
//   • desist applying the move anyway (acceptance 5);
//   • the drop skipping the gate and writing straight through (acceptance 8,
//     both the P2 and P3 cases — neither is refused anywhere but in the gate);
//   • `canReceive` degraded to `() => true` (P3's wiring — the fixture's
//     predicate is built from the real `cellsToDrafts`/`draftTargetKey`
//     authority, so a stub would let the drop land);
//   • the C4 force being applied to the `cells` captured when the prompt opened
//     rather than the live one.
import { cleanup, createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import PlannerGrid, { type PlannerGridProps } from "../PlannerGrid";
import { CueDialogProvider } from "../../ui/CueDialogProvider";
import {
  buildRows,
  cellsToDrafts,
  draftTargetKey,
  type GridCell,
  type GridColumn,
  type SolverConfig,
} from "../plannerModel";
import type { RankMember } from "../candidateRanking";
import type { StoredGridColumn } from "../storedRoleReadModel";

afterEach(() => cleanup());

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ROWS = buildRows();
const SUNDAYS = ["2026-09-06", "2026-09-13", "2026-09-20", "2026-09-27"];

const COL_A: GridColumn = { columnId: "col-1", date: "2026-09-06", type: "sunday_role" };
const COL_B: GridColumn = { columnId: "col-2", date: "2026-09-13", type: "sunday_role" };

const GABY: RankMember = { _id: "gaby", member_name: "Gabriela Rocha", alias: "Gaby", memberType: ["voz"] };
const FRANK: RankMember = { _id: "frank", member_name: "Francisco Rocha", alias: "Frank", memberType: ["voz", "instrumento"] };
const LIU: RankMember = { _id: "liu", member_name: "Liu Wang", alias: "Liu", memberType: ["voz"] };
const LUIS: RankMember = { _id: "luis", member_name: "Luis Pérez", alias: "Luis", memberType: ["instrumento"] };
const MEMBERS = [GABY, FRANK, LIU, LUIS];

/** `Frank !with Gaby` on every voice row of any service — C4's only trigger here. */
const CONFLICT_CONFIG: SolverConfig = {
  sundayLeads: [],
  saturdayLeads: [],
  support: [],
  restrictions: [],
  conflicts: [{ id: "k1", personA: "Frank", personB: "Gaby", pattern: "*.*" }],
  presence: [],
};

function cell(rowId: string, columnId: string, memberIds: string[]): GridCell {
  return { rowId, columnId, occupants: memberIds.map((memberId) => ({ memberId })), origin: "manual" };
}

function baseProps(overrides: Partial<PlannerGridProps> = {}): PlannerGridProps {
  return {
    rows: ROWS,
    columns: [COL_A, COL_B],
    cells: [],
    members: MEMBERS,
    savedWindow: [],
    preflightFor: () => null,
    createBlockFor: () => null,
    canReceive: () => true,
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
    sundayDates: SUNDAYS,
    ...overrides,
  };
}

/**
 * Always inside a `CueDialogProvider`: the C4 prompt is a `CueDialog`, which
 * throws without one. Production always has it (`app/utils/Provider.tsx`).
 */
function renderGrid(props: PlannerGridProps) {
  const view = render(
    <CueDialogProvider>
      <PlannerGrid {...props} />
    </CueDialogProvider>,
  );
  return {
    ...view,
    rerenderWith: (next: PlannerGridProps) =>
      view.rerender(
        <CueDialogProvider>
          <PlannerGrid {...next} />
        </CueDialogProvider>,
      ),
  };
}

function cellAt(container: HTMLElement, rowId: string, columnId: string): HTMLElement {
  const el = container.querySelector(`[data-row-id="${rowId}"][data-column-id="${columnId}"]`);
  if (!el) throw new Error(`no cell for ${rowId}@${columnId}`);
  return el as HTMLElement;
}

function chipIn(container: HTMLElement, rowId: string, columnId: string, memberId: string): HTMLElement {
  const el = cellAt(container, rowId, columnId).querySelector(`[data-occupant="${memberId}"]`);
  if (!el) throw new Error(`no chip for ${memberId} in ${rowId}@${columnId}`);
  return el as HTMLElement;
}

/** jsdom has no `DataTransfer`; the drag carries its payload in state anyway. */
function dataTransfer() {
  return { effectAllowed: "", dropEffect: "", setData: () => {}, getData: () => "" };
}

/**
 * One drag, in the three events the browser fires, with every `preventDefault`
 * answer reported back — `dragOver` is the drop-zone contract, so "was the drop
 * allowed at all" is only observable there.
 */
function dragChipToCell(chip: HTMLElement, target: HTMLElement) {
  const dt = dataTransfer();
  const start = createEvent.dragStart(chip, { dataTransfer: dt });
  fireEvent(chip, start);
  const over = createEvent.dragOver(target, { dataTransfer: dt });
  fireEvent(target, over);
  const drop = createEvent.drop(target, { dataTransfer: dt });
  fireEvent(target, drop);
  return { startRefused: start.defaultPrevented, droppable: over.defaultPrevented };
}

function occupantsOf(cells: GridCell[], rowId: string, columnId: string): string[] {
  return (
    cells.find((c) => c.rowId === rowId && c.columnId === columnId)?.occupants.map((o) => o.memberId) ?? []
  );
}

function noticeText(container: HTMLElement, tone: "refusal" | "note"): string | null {
  return container.querySelector(`[data-drag-notice="${tone}"]`)?.textContent ?? null;
}

// ─── Acceptance 4 — a clean move completes with no prompt ────────────────────

describe("a move violating no constraint (acceptance 4)", () => {
  it("moves the occupant in ONE onCellsChange, with no prompt", () => {
    const onCellsChange = vi.fn();
    const cells = [cell("bgv", "col-1", ["gaby"]), cell("lead", "col-2", [])];
    const { container } = renderGrid(baseProps({ cells, onCellsChange }));

    const { droppable } = dragChipToCell(
      chipIn(container, "bgv", "col-1", "gaby"),
      cellAt(container, "lead", "col-2"),
    );

    expect(droppable).toBe(true);
    expect(onCellsChange).toHaveBeenCalledTimes(1);
    const next = onCellsChange.mock.calls[0][0] as GridCell[];
    expect(occupantsOf(next, "bgv", "col-1")).toEqual([]);
    expect(occupantsOf(next, "lead", "col-2")).toEqual(["gaby"]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

// ─── Acceptance 3 — an at-target cell ADDS, and warns ────────────────────────

describe("dropping onto a cell already at target (acceptance 3)", () => {
  it("adds without displacing anyone, and renders the over-target treatment", () => {
    const onCellsChange = vi.fn();
    // `lead` targets 2 (`VOICE_TARGETS`), so col-2's Lead is already at target.
    const cells = [cell("bgv", "col-1", ["gaby"]), cell("lead", "col-2", ["frank", "liu"])];
    const props = baseProps({ cells, onCellsChange });
    const { container, rerenderWith } = renderGrid(props);

    dragChipToCell(chipIn(container, "bgv", "col-1", "gaby"), cellAt(container, "lead", "col-2"));

    const next = onCellsChange.mock.calls[0][0] as GridCell[];
    // NOBODY DISPLACED — the two who were there are still there, in order, and
    // the newcomer is appended.
    expect(occupantsOf(next, "lead", "col-2")).toEqual(["frank", "liu", "gaby"]);

    rerenderWith({ ...props, cells: next });
    const target = cellAt(container, "lead", "col-2");
    expect(target.className).toContain("border-warning-fg/40");
    expect(target.textContent).toContain("Por encima del objetivo — se acepta de todos modos");
  });
});

// ─── Acceptance 5 — C4 prompts, and only C4 ─────────────────────────────────

/** Gaby (BGV of col-1) onto BGV of col-2, where Frank already leads. */
function conflictSetup(overrides: Partial<PlannerGridProps> = {}) {
  const onCellsChange = vi.fn();
  const cells = [
    cell("bgv", "col-1", ["gaby"]),
    cell("lead", "col-2", ["frank"]),
    cell("bgv", "col-2", []),
  ];
  const props = baseProps({ cells, onCellsChange, config: CONFLICT_CONFIG, ...overrides });
  const view = renderGrid(props);
  return { ...view, props, onCellsChange };
}

describe("a move blocked by a rule conflict (acceptance 5)", () => {
  it("raises the prompt rather than moving or refusing outright", () => {
    const { container, onCellsChange } = conflictSetup();

    const { droppable } = dragChipToCell(
      chipIn(container, "bgv", "col-1", "gaby"),
      cellAt(container, "bgv", "col-2"),
    );

    expect(droppable).toBe(true);
    expect(onCellsChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(document.querySelector("[data-prompt-reason]")?.textContent).toBeTruthy();
  });

  it("DESIST leaves cells byte-identical — nothing is written at all", () => {
    const { container, onCellsChange } = conflictSetup();
    dragChipToCell(chipIn(container, "bgv", "col-1", "gaby"), cellAt(container, "bgv", "col-2"));

    fireEvent.click(screen.getByText("Desistir"));

    // THE MUTATION THIS CATCHES: a desist that applies the move anyway. There is
    // no "moved back" state to inspect — `PlannerGrid` is controlled — so the
    // only honest assertion is that the write never happened.
    expect(onCellsChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("FORCE completes the move and records the waived rule in the same single update", () => {
    const { container, onCellsChange } = conflictSetup();
    dragChipToCell(chipIn(container, "bgv", "col-1", "gaby"), cellAt(container, "bgv", "col-2"));
    const shownReason = document.querySelector("[data-prompt-reason]")?.textContent ?? "";

    fireEvent.click(screen.getByText("Mover de todos modos"));

    expect(onCellsChange).toHaveBeenCalledTimes(1); // DD1 — one update, not two
    const next = onCellsChange.mock.calls[0][0] as GridCell[];
    expect(occupantsOf(next, "bgv", "col-1")).toEqual([]);
    expect(occupantsOf(next, "bgv", "col-2")).toEqual(["gaby"]);
    const target = next.find((c) => c.rowId === "bgv" && c.columnId === "col-2")!;
    expect(target.overrides).toEqual(["gaby"]);
    // The rule the admin was SHOWN is the rule recorded — not a second string
    // assembled at the call site.
    expect(target.overrideReasons?.gaby).toBe(shownReason);
    expect(shownReason).not.toBe("");
  });

  it("forces against the LIVE cells, not the snapshot taken when the prompt opened", () => {
    const { container, props, rerenderWith, onCellsChange } = conflictSetup();
    dragChipToCell(chipIn(container, "bgv", "col-1", "gaby"), cellAt(container, "bgv", "col-2"));

    // The grid moves under the open prompt — Auto finishing, another edit
    // landing. The force must not revert it.
    const movedOn = [...props.cells, cell("coro", "col-1", ["liu"])];
    rerenderWith({ ...props, cells: movedOn });
    fireEvent.click(screen.getByText("Mover de todos modos"));

    const next = onCellsChange.mock.calls[0][0] as GridCell[];
    expect(occupantsOf(next, "coro", "col-1")).toEqual(["liu"]);
    expect(occupantsOf(next, "bgv", "col-2")).toEqual(["gaby"]);
  });

  it("carries the unavailability NOTE on the FORCED path too (shares applyMove with a clean move)", () => {
    // Gaby is BOTH ruled against Frank (col-2's Lead) AND unavailable on
    // col-2's date — the same forced move must not lose the signal a CLEAN
    // move already carries, since both go through `applyMove`.
    const members = MEMBERS.map((m) => (m._id === "gaby" ? { ...m, unavailableDates: [COL_B.date] } : m));
    const { container, onCellsChange } = conflictSetup({ members });
    dragChipToCell(chipIn(container, "bgv", "col-1", "gaby"), cellAt(container, "bgv", "col-2"));

    fireEvent.click(screen.getByText("Mover de todos modos"));

    expect(onCellsChange).toHaveBeenCalledTimes(1);
    const note = noticeText(container, "note");
    expect(note).toContain("Gaby");
    expect(note).toContain("no está disponible");
  });

  it("re-judges on FORCE: a source emptied while the prompt is open refuses, writes nothing, and the prompt resolves", () => {
    const { container, props, rerenderWith, onCellsChange } = conflictSetup();
    dragChipToCell(chipIn(container, "bgv", "col-1", "gaby"), cellAt(container, "bgv", "col-2"));
    expect(screen.getByRole("dialog")).toBeTruthy();

    // Un-seat Gaby from the SOURCE cell while the prompt is up — the picker
    // freeing her, another window of the same session, Auto re-running. There
    // is nothing left to move.
    const emptiedSource = props.cells.map((c) =>
      c.rowId === "bgv" && c.columnId === "col-1" ? { ...c, occupants: [] } : c,
    );
    rerenderWith({ ...props, cells: emptiedSource });

    fireEvent.click(screen.getByText("Mover de todos modos"));

    // THE MUTATION THIS CATCHES: forcing against the STALE verdict computed
    // when the prompt opened, instead of re-judging against live `cells`.
    expect(onCellsChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(noticeText(container, "refusal")).toBe("Movimiento no reconocido.");
  });

  it("Escape dismisses ONLY the prompt — full screen survives it", () => {
    const { onCellsChange } = conflictSetup();
    fireEvent.click(screen.getByText("⛶ Pantalla completa"));
    // The dialog's portal target is a body child, and full screen inerts body
    // children: a prompt raised from inside full screen would be unusable.
    expect(document.querySelector("[data-cue-dialog-root]")?.hasAttribute("inert")).toBe(false);

    // Full screen portals the whole surface onto `document.body`, so the grid is
    // no longer inside the render container.
    dragChipToCell(
      chipIn(document.body, "bgv", "col-1", "gaby"),
      cellAt(document.body, "bgv", "col-2"),
    );
    // Named, because the full-screen overlay is itself a `role="dialog"`.
    expect(screen.getByRole("dialog", { name: "Forzar el movimiento" })).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Forzar el movimiento" })).toBeNull();
    // Still in full screen, and nothing was written on the way out.
    expect(screen.getByText("Salir de pantalla completa (Esc)")).toBeTruthy();
    expect(onCellsChange).not.toHaveBeenCalled();
  });
});

// ─── DD2 — the three refusals never offer a force ────────────────────────────

describe("refusals surface inline and are never forceable (DD2)", () => {
  it("C1 — the target cell already holds this member", () => {
    const onCellsChange = vi.fn();
    const cells = [cell("bgv", "col-1", ["gaby"]), cell("lead", "col-1", ["gaby"])];
    const { container } = renderGrid(baseProps({ cells, onCellsChange }));

    const { droppable } = dragChipToCell(
      chipIn(container, "bgv", "col-1", "gaby"),
      cellAt(container, "lead", "col-1"),
    );

    expect(droppable).toBe(false); // not even a drop zone
    expect(onCellsChange).not.toHaveBeenCalled();
    expect(noticeText(container, "refusal")).toBe("Ya está en esta casilla");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("C3 — the member's memberType does not cover the target seat", () => {
    const onCellsChange = vi.fn();
    const cells = [cell("bgv", "col-1", ["gaby"]), cell("instrumento:Bass", "col-1", [])];
    const { container } = renderGrid(baseProps({ cells, onCellsChange }));

    const { droppable } = dragChipToCell(
      chipIn(container, "bgv", "col-1", "gaby"),
      cellAt(container, "instrumento:Bass", "col-1"),
    );

    expect(droppable).toBe(false);
    expect(onCellsChange).not.toHaveBeenCalled();
    expect(noticeText(container, "refusal")).toContain("requiere tipo instrumento");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("C2 — a same-category double in the target service, in the picker's wording", () => {
    const onCellsChange = vi.fn();
    // Gaby already sings Lead in col-2, so BGV of col-2 would double her.
    const cells = [
      cell("bgv", "col-1", ["gaby"]),
      cell("lead", "col-2", ["gaby"]),
      cell("bgv", "col-2", []),
    ];
    const { container } = renderGrid(baseProps({ cells, onCellsChange }));

    const { droppable } = dragChipToCell(
      chipIn(container, "bgv", "col-1", "gaby"),
      cellAt(container, "bgv", "col-2"),
    );

    expect(droppable).toBe(false);
    expect(onCellsChange).not.toHaveBeenCalled();
    expect(noticeText(container, "refusal")).toBe("Ya asignado en Lead");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a refusal does not outlive the edit that resolves it", () => {
    const cells = [
      cell("bgv", "col-1", ["gaby"]),
      cell("lead", "col-2", ["gaby"]),
      cell("bgv", "col-2", []),
    ];
    const { container } = renderGrid(baseProps({ cells, onCellsChange: vi.fn() }));
    dragChipToCell(chipIn(container, "bgv", "col-1", "gaby"), cellAt(container, "bgv", "col-2"));
    expect(noticeText(container, "refusal")).toBe("Ya asignado en Lead");

    // Un-seat her from Lead through the picker — the reason the drag was refused
    // is now false, and the line must not still be asserting it.
    fireEvent.click(cellAt(container, "lead", "col-2"));
    fireEvent.click(within(container.querySelector("[data-candidate-picker] ul")!).getByText("Gaby"));

    expect(noticeText(container, "refusal")).toBeNull();
  });
});

// ─── Acceptance 8 — the preconditions ────────────────────────────────────────

describe("preconditions refuse with no state change (acceptance 8)", () => {
  it("P1 — nothing is draggable while a mutation is pending", () => {
    const onCellsChange = vi.fn();
    const cells = [cell("bgv", "col-1", ["gaby"]), cell("lead", "col-2", [])];
    const { container } = renderGrid(
      baseProps({ mode: "stored", cells, onCellsChange, mutationLocked: true }),
    );

    const chip = chipIn(container, "bgv", "col-1", "gaby");
    expect(chip.getAttribute("draggable")).toBe("false");
    const { startRefused, droppable } = dragChipToCell(chip, cellAt(container, "lead", "col-2"));
    expect(startRefused).toBe(true);
    expect(droppable).toBe(false);
    expect(onCellsChange).not.toHaveBeenCalled();
  });

  it("P2 — a readOnly SOURCE column never starts a drag", () => {
    const onCellsChange = vi.fn();
    const { cells, columns } = storedGrid({ readOnlyColumnId: "col-1" });
    const { container } = renderGrid(baseProps({ mode: "stored", cells, columns, onCellsChange }));

    const { startRefused, droppable } = dragChipToCell(
      chipIn(container, "bgv", "col-1", "gaby"),
      cellAt(container, "lead", "col-2"),
    );

    expect(startRefused).toBe(true);
    expect(droppable).toBe(false);
    expect(onCellsChange).not.toHaveBeenCalled();
  });

  it("P2 — a readOnly TARGET column is refused BY THE GATE, at the drop", () => {
    const onCellsChange = vi.fn();
    const { cells, columns } = storedGrid({ readOnlyColumnId: "col-2" });
    const { container } = renderGrid(baseProps({ mode: "stored", cells, columns, onCellsChange }));

    // THE MUTATION THIS CATCHES: skipping the gate. The source is perfectly
    // draggable here, so nothing but `evaluateMove` stands between this drop and
    // a column whose serializer rejection would disable Guardar for the month.
    const { startRefused, droppable } = dragChipToCell(
      chipIn(container, "bgv", "col-1", "gaby"),
      cellAt(container, "lead", "col-2"),
    );

    expect(startRefused).toBe(false);
    expect(droppable).toBe(false);
    expect(onCellsChange).not.toHaveBeenCalled();
    expect(noticeText(container, "refusal")).toBe("No se puede editar este servicio.");
  });

  it("P3 — a create-blocked column is not a drop target, through the REAL authority", () => {
    const onCellsChange = vi.fn();
    const cells = [cell("bgv", "col-1", ["gaby"]), cell("lead", "col-2", [])];
    // `canReceive` built the way `MonthGenerator` builds it: `cellsToDrafts` for
    // the drafts, `draftTargetKey` for the identity, and the session's
    // created-target set for the refusal. A stub `() => true` here — or in the
    // component — makes this drop land, which is the mutation the test exists
    // for. `createdTargets` is used rather than `skipped` deliberately: it is
    // the part of `isDraftCreatable` that `PlannerGrid`'s `skipped` prop cannot
    // see at all.
    const drafts = cellsToDrafts(cells, [COL_A, COL_B], new Set(), [], []);
    const createdTargets = new Set([draftTargetKey(COL_B.type, COL_B.date)]);
    const canReceive = (column: GridColumn) => {
      const key = draftTargetKey(column.type, column.date);
      const draft = drafts.find((d) => draftTargetKey(d._type, d.date) === key);
      if (!draft || draft.skipped) return false;
      if (createdTargets.has(key)) return false;
      return !draft.exists;
    };
    const { container } = renderGrid(baseProps({ cells, onCellsChange, canReceive }));

    const { startRefused, droppable } = dragChipToCell(
      chipIn(container, "bgv", "col-1", "gaby"),
      cellAt(container, "lead", "col-2"),
    );

    expect(startRefused).toBe(false);
    expect(droppable).toBe(false);
    expect(onCellsChange).not.toHaveBeenCalled();
    expect(noticeText(container, "refusal")).toBe("Esta columna no se va a crear.");
  });

  it("P3 — a column with NO draft at all is refused, the same fail-closed branch `canReceiveDrop` takes", () => {
    // `MonthGenerator`'s `canReceiveDrop` looks up the target column in
    // `drafts` by `draftTargetKey` BEFORE it ever asks `isDraftCreatable`; no
    // match means "cannot know why there is no draft" and refuses outright
    // (`MonthGenerator.tsx`'s own comment on that function). Distinct from the
    // create-blocked case above, where a draft exists and IS the refusal
    // reason — here there is no draft to consult at all, so a `drafts.find`
    // that silently defaulted to "creatable" would be the mutation this test
    // exists to catch.
    const onCellsChange = vi.fn();
    const cells = [cell("bgv", "col-1", ["gaby"]), cell("lead", "col-2", [])];
    // Drafts built for COL_A only — COL_B (the drop target) has no entry.
    const drafts = cellsToDrafts([cell("bgv", "col-1", [])], [COL_A], new Set(), [], []);
    const canReceive = (column: GridColumn) => {
      const key = draftTargetKey(column.type, column.date);
      const draft = drafts.find((d) => draftTargetKey(d._type, d.date) === key);
      if (!draft) return false;
      return !draft.skipped && !draft.exists;
    };
    const { container } = renderGrid(baseProps({ cells, onCellsChange, canReceive }));

    const { startRefused, droppable } = dragChipToCell(
      chipIn(container, "bgv", "col-1", "gaby"),
      cellAt(container, "lead", "col-2"),
    );

    expect(startRefused).toBe(false);
    expect(droppable).toBe(false);
    expect(onCellsChange).not.toHaveBeenCalled();
    expect(noticeText(container, "refusal")).toBe("Esta columna no se va a crear.");
  });

  it("P3 is DROP-side only — dragging OUT of a create-blocked column is legitimate", () => {
    const onCellsChange = vi.fn();
    const cells = [cell("bgv", "col-1", ["gaby"]), cell("lead", "col-2", [])];
    const { container } = renderGrid(
      baseProps({ cells, onCellsChange, canReceive: (column) => column.columnId === "col-2" }),
    );

    const { droppable } = dragChipToCell(
      chipIn(container, "bgv", "col-1", "gaby"),
      cellAt(container, "lead", "col-2"),
    );

    expect(droppable).toBe(true);
    expect(onCellsChange).toHaveBeenCalledTimes(1);
  });
});

// ─── Finding 1 — the P3 cache must not outlive a live `canReceive` mutation ──
//
// `createMoveGate` caches a verdict per (source, target) and drops the WHOLE
// cache only when one of its dependency identities changes — `canReceive`
// among them. In production, `canReceive` is `MonthGenerator`'s
// `canReceiveDrop`, which closes over `createdTargets.current` — a `Set` ref
// MUTATED IN PLACE by `handleConfirm`, never replaced — so the cache stays
// honest ONLY because that mutation is always paired, in the same tick, with a
// `setDrafts` call that gives `canReceiveDrop` a fresh identity (see the
// invariant comments at `MonthGenerator.tsx`'s `handleConfirm` and
// `moveGate.ts`'s `createMoveGate`). This test drives that exact shape at the
// level the cache actually lives (`PlannerGrid`'s one `gate` instance): a
// `createdTargets`-shaped `Set`, mutated in place, paired with a re-render that
// hands `canReceive` a NEW identity — the fix's contract — must invalidate a
// `clean` verdict already cached for that column.

describe("the P3 cache is invalidated when canReceive's identity changes (Finding 1)", () => {
  it("refuses a drop the cache had already judged clean, once createdTargets mutates AND canReceive is re-identified", () => {
    const onCellsChange = vi.fn();
    const cells = [cell("bgv", "col-1", ["gaby"]), cell("lead", "col-2", [])];
    // Mirrors `MonthGenerator`'s `createdTargets.current` — a `Set` MUTATED in
    // place, never replaced, exactly like the ref `handleConfirm` writes.
    const createdTargets = new Set<string>();
    const canReceive = (column: GridColumn) => !createdTargets.has(draftTargetKey(column.type, column.date));
    const props = baseProps({ cells, onCellsChange, canReceive });
    const { container, rerenderWith } = renderGrid(props);

    // SEED: col-2 is not yet "created", so this hover is legitimately `clean`
    // — and the gate now caches that verdict for this exact source→target key.
    const chip = chipIn(container, "bgv", "col-1", "gaby");
    const target = cellAt(container, "lead", "col-2");
    const dt = dataTransfer();
    fireEvent(chip, createEvent.dragStart(chip, { dataTransfer: dt }));
    const seedOver = createEvent.dragOver(target, { dataTransfer: dt });
    fireEvent(target, seedOver);
    expect(seedOver.defaultPrevented).toBe(true);

    // THE MUTATION IN PRODUCTION'S SHAPE: `createdTargets` grows in place, and
    // — the invariant `MonthGenerator` upholds — `canReceive` is re-identified
    // in the SAME tick (there, because `setDrafts` ran; here, a fresh closure
    // standing in for it).
    createdTargets.add(draftTargetKey(COL_B.type, COL_B.date));
    const freshCanReceive = (column: GridColumn) => !createdTargets.has(draftTargetKey(column.type, column.date));
    rerenderWith({ ...props, canReceive: freshCanReceive });

    const drop = createEvent.drop(target, { dataTransfer: dt });
    fireEvent(target, drop);

    // THE MUTATION THIS TEST CATCHES: `createMoveGate` serving the cached
    // `clean` verdict instead of re-judging now that `canReceive` answers
    // differently — reproduced by re-rendering with the SAME `canReceive`
    // reference instead of `freshCanReceive` above (verified by hand; not left
    // in the suite as a permanently-skipped duplicate).
    expect(onCellsChange).not.toHaveBeenCalled();
    expect(noticeText(container, "refusal")).toBe("Esta columna no se va a crear.");
  });
});

// ─── Acceptance 11 — unavailability is a signal, never a gate ────────────────

describe("dropping onto a date the member marked unavailable (acceptance 11)", () => {
  it("completes the move AND carries a visible note", () => {
    const onCellsChange = vi.fn();
    const cells = [cell("bgv", "col-1", ["gaby"]), cell("lead", "col-2", [])];
    const members = MEMBERS.map((m) => (m._id === "gaby" ? { ...m, unavailableDates: [COL_B.date] } : m));
    const { container } = renderGrid(baseProps({ cells, onCellsChange, members }));

    const { droppable } = dragChipToCell(
      chipIn(container, "bgv", "col-1", "gaby"),
      cellAt(container, "lead", "col-2"),
    );

    // NOT a fifth constraint: the move lands.
    expect(droppable).toBe(true);
    const next = onCellsChange.mock.calls[0][0] as GridCell[];
    expect(occupantsOf(next, "lead", "col-2")).toEqual(["gaby"]);
    // …and the drag is not a weaker SIGNAL than the picker, which renders
    // "No disp." on the same fact.
    const note = noticeText(container, "note");
    expect(note).toContain("Gaby");
    expect(note).toContain("no está disponible");
    expect(note).toContain("13 sep");
  });

  it("says nothing when the member IS available on that date", () => {
    const cells = [cell("bgv", "col-1", ["gaby"]), cell("lead", "col-2", [])];
    const { container } = renderGrid(baseProps({ cells, onCellsChange: vi.fn() }));

    dragChipToCell(chipIn(container, "bgv", "col-1", "gaby"), cellAt(container, "lead", "col-2"));

    expect(noticeText(container, "note")).toBeNull();
  });
});

// ─── Scope guards ────────────────────────────────────────────────────────────

describe("the drag's anchors", () => {
  it("gives `+N` no second handle — DD11's picker row is where the tail is reached", () => {
    // Lead targets 2, so a third occupant is hidden behind `+1`.
    const cells = [cell("lead", "col-1", ["frank", "liu", "gaby"])];
    const { container } = renderGrid(baseProps({ cells }));

    const cellEl = cellAt(container, "lead", "col-1");
    const more = cellEl.querySelector("button[aria-label^='Ver ']");
    expect(more).toBeTruthy();
    expect(more!.getAttribute("draggable")).toBeNull();
    // Only the visible occupants are draggable.
    expect(cellEl.querySelectorAll("[data-occupant]")).toHaveLength(2);
  });

  it("does not open the picker or write anything on a bare dragover", () => {
    const onCellsChange = vi.fn();
    const cells = [cell("bgv", "col-1", ["gaby"]), cell("lead", "col-2", [])];
    const { container } = renderGrid(baseProps({ cells, onCellsChange }));

    // No drag in flight: the cell must not become a drop zone by itself.
    const over = createEvent.dragOver(cellAt(container, "lead", "col-2"), {
      dataTransfer: dataTransfer(),
    });
    fireEvent(cellAt(container, "lead", "col-2"), over);
    expect(over.defaultPrevented).toBe(false);
    expect(onCellsChange).not.toHaveBeenCalled();
  });
});

// ─── Finding 2 — a stale `dragSource` must not outlive its own drag ─────────
//
// If the chip that started a drag unmounts mid-gesture, React never fires its
// `onDragEnd`, and `dragSource` would otherwise survive indefinitely. A LATER
// drop anywhere on the page — including one that never touched this grid's
// `onDragStart` at all, like a Finder drag — would then be gated and applied
// as if the original gesture were still live. `cells` is deliberately left
// UNCHANGED in both tests below: the source occupant is still there and the
// move would otherwise be perfectly legal, so the ONLY thing that can stop it
// is the window-level cleanup this fix adds — not `moveGate`'s unrelated
// "nothing to move" precondition, which a changed `cells` would confound.
//
// `act()` wraps the raw `window.dispatchEvent` calls because React 18/19's
// root renders updates asynchronously off a native (non-React-synthetic)
// listener; without it the assertion below would race the state update this
// fix depends on, rather than testing it.

describe("a stale dragSource does not survive its own drag (Finding 2)", () => {
  it("clears on a window-level dragend the chip's own onDragEnd never got to fire", () => {
    const onCellsChange = vi.fn();
    const cells = [cell("bgv", "col-1", ["gaby"]), cell("lead", "col-2", [])];
    const { container } = renderGrid(baseProps({ cells, onCellsChange }));

    const chip = chipIn(container, "bgv", "col-1", "gaby");
    fireEvent(chip, createEvent.dragStart(chip, { dataTransfer: dataTransfer() }));

    // Standing in for the chip's own `onDragEnd` never firing (its node is
    // gone) — the window-level listener this fix registers instead.
    act(() => window.dispatchEvent(new Event("dragend")));

    // A later drop, anywhere — an external (Finder) drag would never have gone
    // through this grid's `onDragStart`, so nothing here re-arms `dragSource`.
    // The source is still fully intact in `cells`, so a live `dragSource`
    // WOULD complete this move (acceptance 4 proves that shape elsewhere).
    const drop = createEvent.drop(cellAt(container, "lead", "col-2"), { dataTransfer: dataTransfer() });
    fireEvent(cellAt(container, "lead", "col-2"), drop);

    expect(onCellsChange).not.toHaveBeenCalled();
  });

  it("a window-level drop also clears it, when the drag never reaches a valid cell", () => {
    const onCellsChange = vi.fn();
    const cells = [cell("bgv", "col-1", ["gaby"]), cell("lead", "col-2", [])];
    const { container } = renderGrid(baseProps({ cells, onCellsChange }));

    const chip = chipIn(container, "bgv", "col-1", "gaby");
    fireEvent(chip, createEvent.dragStart(chip, { dataTransfer: dataTransfer() }));

    // Simulates the native `drop` reaching `window` with no grid cell as its
    // target — e.g. dropped on the page background.
    act(() => window.dispatchEvent(new Event("drop")));

    const drop = createEvent.drop(cellAt(container, "lead", "col-2"), { dataTransfer: dataTransfer() });
    fireEvent(cellAt(container, "lead", "col-2"), drop);

    expect(onCellsChange).not.toHaveBeenCalled();
  });
});

// ─── Stored-mode fixture ─────────────────────────────────────────────────────

/**
 * A stored two-column grid with every voice row present in both columns, so
 * `serializeStoredColumn` is `ok` unless a column is deliberately `readOnly`.
 * Mirrors `moveGate.test.ts`'s own stored fixture.
 */
function storedGrid(opts: { readOnlyColumnId?: string }): { cells: GridCell[]; columns: GridColumn[] } {
  const columns: StoredGridColumn[] = [COL_A, COL_B].map((column) => ({
    ...column,
    roleId: column.columnId,
    rev: "rev-1",
    published: true,
    admission: opts.readOnlyColumnId === column.columnId ? "readOnly" : "approved",
  }));
  const cells = [
    cell("lead", "col-1", []),
    cell("bgv", "col-1", ["gaby"]),
    cell("coro", "col-1", []),
    cell("lead", "col-2", []),
    cell("bgv", "col-2", []),
    cell("coro", "col-2", []),
  ];
  return { cells, columns };
}
