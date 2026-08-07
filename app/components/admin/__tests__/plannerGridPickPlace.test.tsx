/** @vitest-environment jsdom */
// T5 of the grid drag-and-drop plan
// (docs/superpowers/plans/2026-08-06-grid-drag-and-drop.md) — DD12's
// pick-then-place, the SECOND trigger for T4's judge/apply/prompt path and the
// only one a keyboard or a touch screen can reach.
//
// Nothing here builds a second pipeline: every case below asserts against the
// same `moveGate` verdicts, the same `moveOccupant` write and the same
// `CueDialog` prompt the drag runs, which is what makes "pick-then-place skips
// the gate" a failing mutation rather than a different-looking success.
//
// The mutations these tests are written to catch, each named at its assertion:
//   • the place applying without judging (every refusal case below writes);
//   • the picker-row source anchor dropped inside `CandidateRow`'s `blocked`
//     guard — the `+N`-hidden occupant who also holds a same-category double
//     then has NO anchor at all, and acceptance 12's plain round trip would not
//     notice;
//   • the pick surviving Escape, or the cell's shipped "open the picker" action
//     surviving a pending pick;
//   • a pick left armed after its source has vanished from the grid.
import { cleanup, createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import PlannerGrid, { type PlannerGridProps } from "../PlannerGrid";
import { CueDialogProvider } from "../../ui/CueDialogProvider";
import { buildRows, type GridCell, type GridColumn, type SolverConfig } from "../plannerModel";
import type { RankMember } from "../candidateRanking";

afterEach(() => cleanup());

// ─── Fixtures (the drag suite's, so both triggers are judged on one grid) ─────

const ROWS = buildRows();
const SUNDAYS = ["2026-09-06", "2026-09-13", "2026-09-20", "2026-09-27"];

const COL_A: GridColumn = { columnId: "col-1", date: "2026-09-06", type: "sunday_role" };
const COL_B: GridColumn = { columnId: "col-2", date: "2026-09-13", type: "sunday_role" };

const GABY: RankMember = { _id: "gaby", member_name: "Gabriela Rocha", alias: "Gaby", memberType: ["voz"] };
const FRANK: RankMember = { _id: "frank", member_name: "Francisco Rocha", alias: "Frank", memberType: ["voz", "instrumento"] };
const LIU: RankMember = { _id: "liu", member_name: "Liu Wang", alias: "Liu", memberType: ["voz"] };
const MEMBERS = [GABY, FRANK, LIU];

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

/** The cell's own action — "open the picker", or "place here" while a pick is on. */
function cellActionIn(container: HTMLElement, rowId: string, columnId: string): HTMLElement {
  const el = cellAt(container, rowId, columnId).querySelector("[data-cell-action]");
  if (!el) throw new Error(`no cell action for ${rowId}@${columnId}`);
  return el as HTMLElement;
}

/**
 * A chip picked THE WAY A KEYBOARD DOES IT. The chip is a `role="button"` span
 * with its own Enter/Space handler (a native `<button>` cannot carry the drag
 * that T4 shipped), so the key event is the real activation path and not a
 * stand-in for one.
 */
function pickChipWithKeyboard(chip: HTMLElement) {
  fireEvent.keyDown(chip, { key: "Enter" });
}

/**
 * A cell activated the way a keyboard does it. The cell's action IS a native
 * `<button>`, where Enter is the browser's own click — so `click` is the honest
 * spelling of that keystroke, and jsdom (which does not synthesize it) would
 * make a `keyDown` here assert nothing.
 */
function activateCell(container: HTMLElement, rowId: string, columnId: string) {
  fireEvent.click(cellActionIn(container, rowId, columnId));
}

function candidateLi(name: string): HTMLLIElement {
  const li = screen
    .getAllByText(name)
    .map((el) => el.closest("li"))
    .find((el): el is HTMLLIElement => el !== null);
  if (!li) throw new Error(`no candidate row for ${name}`);
  return li;
}

/** DD11's source anchor on a SEATED member's row — the `+N` tail's only handle. */
function pickerAnchorFor(name: string): HTMLButtonElement {
  return within(candidateLi(name)).getByRole("button", {
    name: /marcar para mover|cancelar el movimiento/i,
  }) as HTMLButtonElement;
}

/**
 * The picker-row anchor activated THE WAY A KEYBOARD DOES IT, in the browser's
 * own order: the keydown first (which the row this button sits in also sees —
 * that row is `role="button"` with a handler of its own), then the click the
 * browser synthesizes from it on a native button, which jsdom does not.
 *
 * Both halves matter. Enter on this anchor used to bubble to the row and run its
 * REMOVAL branch, un-seating the person being marked and arming nothing — so a
 * test that only clicks proves the keyboard path works when it does not.
 */
function activateAnchorWithKeyboard(anchor: HTMLElement, key: "Enter" | " " = "Enter") {
  fireEvent.keyDown(anchor, { key });
  fireEvent.click(anchor);
}

function occupantsOf(cells: GridCell[], rowId: string, columnId: string): string[] {
  return (
    cells.find((c) => c.rowId === rowId && c.columnId === columnId)?.occupants.map((o) => o.memberId) ?? []
  );
}

function noticeText(container: HTMLElement, tone: "refusal" | "note"): string | null {
  return container.querySelector(`[data-drag-notice="${tone}"]`)?.textContent ?? null;
}

function pickBannerText(container: HTMLElement): string {
  return container.querySelector("[data-pick-banner]")?.textContent ?? "";
}

// ─── Acceptance 10 — every outcome, by keyboard, including cross-service ──────

describe("pick-then-place by keyboard (acceptance 10)", () => {
  it("moves an occupant ACROSS SERVICES in one onCellsChange, with no prompt", () => {
    const onCellsChange = vi.fn();
    const cells = [cell("bgv", "col-1", ["gaby"]), cell("lead", "col-2", [])];
    const { container } = renderGrid(baseProps({ cells, onCellsChange }));

    pickChipWithKeyboard(chipIn(container, "bgv", "col-1", "gaby"));
    // Marking writes NOTHING — it is a selection, not an edit.
    expect(onCellsChange).not.toHaveBeenCalled();
    activateCell(container, "lead", "col-2");

    expect(onCellsChange).toHaveBeenCalledTimes(1);
    const next = onCellsChange.mock.calls[0][0] as GridCell[];
    expect(occupantsOf(next, "bgv", "col-1")).toEqual([]);
    expect(occupantsOf(next, "lead", "col-2")).toEqual(["gaby"]);
    expect(screen.queryByRole("dialog")).toBeNull();
    // …and the pick is spent.
    expect(pickBannerText(container)).toBe("");
  });

  it("names the marked member and where they were marked from", () => {
    const cells = [cell("bgv", "col-1", ["gaby"]), cell("lead", "col-2", [])];
    const { container } = renderGrid(baseProps({ cells }));

    pickChipWithKeyboard(chipIn(container, "bgv", "col-1", "gaby"));

    const banner = pickBannerText(container);
    expect(banner).toContain("Gaby");
    expect(banner).toContain("BGV");
    expect(banner).toContain("6 sep");
  });

  it("leaves a POINTER click on the chip alone — it opens the picker, as it always has", () => {
    // USER RULING, 2026-08-06: marking from the chip is keyboard-only. A mouse
    // click on a name keeps falling through to the cell, so the shipped
    // interaction is untouched for every pointer user; a mouse marks from the
    // picker-row anchor instead, or just drags.
    const onCellsChange = vi.fn();
    const cells = [cell("bgv", "col-1", ["gaby"]), cell("lead", "col-2", [])];
    const { container } = renderGrid(baseProps({ cells, onCellsChange }));

    fireEvent.click(chipIn(container, "bgv", "col-1", "gaby"));

    expect(container.querySelector("[data-candidate-picker]")).not.toBeNull();
    expect(pickBannerText(container)).toBe("");
    expect(onCellsChange).not.toHaveBeenCalled();
  });

  it("a POINTER click on ANOTHER occupant's chip, while a pick is armed, places onto THAT chip's cell", () => {
    // The chip carries no `onClick` at all (same user ruling as above), so a
    // click on it always falls through to the cell. While no pick is armed
    // that means "open the picker" (pinned above); while one IS armed the
    // cell's own action is "place here" — so clicking a chip that belongs to
    // someone else entirely still targets that chip's CELL, not the chip's
    // own occupant. Frank is not moved; Gaby lands beside him.
    const onCellsChange = vi.fn();
    const cells = [cell("bgv", "col-1", ["gaby"]), cell("bgv", "col-2", ["frank"])];
    const { container } = renderGrid(baseProps({ cells, onCellsChange }));

    pickChipWithKeyboard(chipIn(container, "bgv", "col-1", "gaby"));
    fireEvent.click(chipIn(container, "bgv", "col-2", "frank"));

    expect(onCellsChange).toHaveBeenCalledTimes(1);
    const next = onCellsChange.mock.calls[0][0] as GridCell[];
    expect(occupantsOf(next, "bgv", "col-1")).toEqual([]);
    expect(occupantsOf(next, "bgv", "col-2")).toEqual(["frank", "gaby"]);
    expect(pickBannerText(container)).toBe("");
  });

  it("re-marks rather than queueing when another chip is activated mid-pick", () => {
    const onCellsChange = vi.fn();
    const cells = [cell("bgv", "col-1", ["gaby"]), cell("lead", "col-1", ["liu"]), cell("lead", "col-2", [])];
    const { container } = renderGrid(baseProps({ cells, onCellsChange }));

    pickChipWithKeyboard(chipIn(container, "bgv", "col-1", "gaby"));
    pickChipWithKeyboard(chipIn(container, "lead", "col-1", "liu"));

    // ONE armed source, and it is the newer one — two would make the next cell
    // a coin toss over who moves.
    expect(pickBannerText(container)).toContain("Liu");
    expect(pickBannerText(container)).not.toContain("Gaby");
    activateCell(container, "lead", "col-2");
    const next = onCellsChange.mock.calls[0][0] as GridCell[];
    expect(occupantsOf(next, "lead", "col-2")).toEqual(["liu"]);
    expect(occupantsOf(next, "bgv", "col-1")).toEqual(["gaby"]);
  });

  it("a drag started while a pick is armed replaces it", () => {
    const onCellsChange = vi.fn();
    const cells = [cell("bgv", "col-1", ["gaby"]), cell("lead", "col-1", ["liu"]), cell("lead", "col-2", [])];
    const { container } = renderGrid(baseProps({ cells, onCellsChange }));

    pickChipWithKeyboard(chipIn(container, "bgv", "col-1", "gaby"));
    const other = chipIn(container, "lead", "col-1", "liu");
    fireEvent(
      other,
      createEvent.dragStart(other, {
        dataTransfer: { effectAllowed: "", dropEffect: "", setData: () => {}, getData: () => "" },
      }),
    );

    // Two armed sources and one target would be a coin toss over who moves.
    expect(pickBannerText(container)).toBe("");
  });

  it("un-marks on a second activation of the same chip", () => {
    const onCellsChange = vi.fn();
    const cells = [cell("bgv", "col-1", ["gaby"]), cell("lead", "col-2", [])];
    const { container } = renderGrid(baseProps({ cells, onCellsChange }));

    const chip = chipIn(container, "bgv", "col-1", "gaby");
    pickChipWithKeyboard(chip);
    pickChipWithKeyboard(chip);

    expect(pickBannerText(container)).toBe("");
    // The cell's shipped action is back: activating a cell opens the picker.
    activateCell(container, "lead", "col-2");
    expect(container.querySelector("[data-candidate-picker]")).not.toBeNull();
    expect(onCellsChange).not.toHaveBeenCalled();
  });
});

// ─── The gate runs on this path too, or nothing here means anything ──────────

describe("a placed pick is judged before it is written", () => {
  it("C2 — refuses a same-category double, in the gate's own wording", () => {
    const onCellsChange = vi.fn();
    // Gaby already sings Lead in col-2, so BGV of col-2 would double her.
    const cells = [
      cell("bgv", "col-1", ["gaby"]),
      cell("lead", "col-2", ["gaby"]),
      cell("bgv", "col-2", []),
    ];
    const { container } = renderGrid(baseProps({ cells, onCellsChange }));

    pickChipWithKeyboard(chipIn(container, "bgv", "col-1", "gaby"));
    activateCell(container, "bgv", "col-2");

    // THE MUTATION THIS CATCHES: a place that skips `judgeMove` and writes.
    expect(onCellsChange).not.toHaveBeenCalled();
    expect(noticeText(container, "refusal")).toBe("Ya asignado en Lead");
    expect(screen.queryByRole("dialog")).toBeNull();
    // The refusal is about THIS target, so the pick stays armed for another one.
    expect(pickBannerText(container)).toContain("Gaby");
  });

  it("C3 — refuses a seat the member's type does not cover", () => {
    const onCellsChange = vi.fn();
    const cells = [cell("bgv", "col-1", ["gaby"]), cell("instrumento:Bass", "col-1", [])];
    const { container } = renderGrid(baseProps({ cells, onCellsChange }));

    pickChipWithKeyboard(chipIn(container, "bgv", "col-1", "gaby"));
    activateCell(container, "instrumento:Bass", "col-1");

    expect(onCellsChange).not.toHaveBeenCalled();
    expect(noticeText(container, "refusal")).toContain("requiere tipo instrumento");
  });

  it("P3 — refuses a column that will not be created", () => {
    const onCellsChange = vi.fn();
    const cells = [cell("bgv", "col-1", ["gaby"]), cell("lead", "col-2", [])];
    const { container } = renderGrid(
      baseProps({ cells, onCellsChange, canReceive: (column) => column.columnId !== "col-2" }),
    );

    pickChipWithKeyboard(chipIn(container, "bgv", "col-1", "gaby"));
    activateCell(container, "lead", "col-2");

    expect(onCellsChange).not.toHaveBeenCalled();
    expect(noticeText(container, "refusal")).toBe("Esta columna no se va a crear.");
  });

  it("C4 — raises the SAME prompt the drag raises, and force writes the waiver once", () => {
    const onCellsChange = vi.fn();
    const cells = [
      cell("bgv", "col-1", ["gaby"]),
      cell("lead", "col-2", ["frank"]),
      cell("bgv", "col-2", []),
    ];
    const { container } = renderGrid(baseProps({ cells, onCellsChange, config: CONFLICT_CONFIG }));

    pickChipWithKeyboard(chipIn(container, "bgv", "col-1", "gaby"));
    activateCell(container, "bgv", "col-2");

    expect(onCellsChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Forzar el movimiento" })).toBeTruthy();
    const shownReason = document.querySelector("[data-prompt-reason]")?.textContent ?? "";
    expect(shownReason).not.toBe("");

    fireEvent.click(screen.getByText("Mover de todos modos"));

    expect(onCellsChange).toHaveBeenCalledTimes(1);
    const next = onCellsChange.mock.calls[0][0] as GridCell[];
    expect(occupantsOf(next, "bgv", "col-1")).toEqual([]);
    expect(occupantsOf(next, "bgv", "col-2")).toEqual(["gaby"]);
    const target = next.find((c) => c.rowId === "bgv" && c.columnId === "col-2")!;
    expect(target.overrides).toEqual(["gaby"]);
    expect(target.overrideReasons?.gaby).toBe(shownReason);
  });

  it("C4 — desisting writes nothing at all", () => {
    const onCellsChange = vi.fn();
    const cells = [
      cell("bgv", "col-1", ["gaby"]),
      cell("lead", "col-2", ["frank"]),
      cell("bgv", "col-2", []),
    ];
    const { container } = renderGrid(baseProps({ cells, onCellsChange, config: CONFLICT_CONFIG }));

    pickChipWithKeyboard(chipIn(container, "bgv", "col-1", "gaby"));
    activateCell(container, "bgv", "col-2");
    fireEvent.click(screen.getByText("Desistir"));

    expect(onCellsChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Forzar el movimiento" })).toBeNull();
  });

  it("nothing is placed while a mutation is pending (P1)", () => {
    const onCellsChange = vi.fn();
    const cells = [cell("bgv", "col-1", ["gaby"]), cell("lead", "col-2", [])];
    const { container } = renderGrid(
      baseProps({ mode: "stored", cells, onCellsChange, mutationLocked: true }),
    );

    const chip = chipIn(container, "bgv", "col-1", "gaby");
    expect(chip.getAttribute("aria-disabled")).toBe("true");
    expect(chip.getAttribute("tabindex")).toBe("-1");
    pickChipWithKeyboard(chip);
    fireEvent.click(chip);

    expect(pickBannerText(container)).toBe("");
    expect(onCellsChange).not.toHaveBeenCalled();
  });
});

// ─── The suppressed primary action, and Escape ───────────────────────────────

describe("a pending pick takes over the target cell's activation", () => {
  it("activating a cell PLACES instead of opening the picker", () => {
    const onCellsChange = vi.fn();
    const cells = [cell("bgv", "col-1", ["gaby"]), cell("lead", "col-2", [])];
    const { container } = renderGrid(baseProps({ cells, onCellsChange }));

    pickChipWithKeyboard(chipIn(container, "bgv", "col-1", "gaby"));
    activateCell(container, "lead", "col-2");

    // The shipped interaction — a cell click opens the candidate picker — is
    // deliberately suppressed for the duration of a pick.
    expect(container.querySelector("[data-candidate-picker]")).toBeNull();
    expect(onCellsChange).toHaveBeenCalledTimes(1);
  });

  it("says PLACE on the cell rather than OPEN while a pick is on", () => {
    const cells = [cell("bgv", "col-1", ["gaby"]), cell("lead", "col-2", [])];
    const { container } = renderGrid(baseProps({ cells }));

    expect(cellActionIn(container, "lead", "col-2").getAttribute("aria-label")).toContain("Candidatos");

    pickChipWithKeyboard(chipIn(container, "bgv", "col-1", "gaby"));

    const label = cellActionIn(container, "lead", "col-2").getAttribute("aria-label") ?? "";
    expect(label).toContain("Colocar");
    expect(label).toContain("Gaby");
  });

  it("Escape cancels the pick, writes nothing, and gives the cell its action back", () => {
    const onCellsChange = vi.fn();
    const cells = [cell("bgv", "col-1", ["gaby"]), cell("lead", "col-2", [])];
    const { container } = renderGrid(baseProps({ cells, onCellsChange }));

    pickChipWithKeyboard(chipIn(container, "bgv", "col-1", "gaby"));
    fireEvent.keyDown(document, { key: "Escape" });

    expect(pickBannerText(container)).toBe("");
    expect(onCellsChange).not.toHaveBeenCalled();
    activateCell(container, "lead", "col-2");
    expect(container.querySelector("[data-candidate-picker]")).not.toBeNull();
    expect(onCellsChange).not.toHaveBeenCalled();
  });

  it("Escape cancels the pick WITHOUT leaving full screen", () => {
    // The same collision the C4 prompt has with this surface's capture-phase
    // Escape: one keystroke must not both cancel the pick and drop the admin out
    // of the mode they were working in.
    const cells = [cell("bgv", "col-1", ["gaby"]), cell("lead", "col-2", [])];
    renderGrid(baseProps({ cells }));
    fireEvent.click(screen.getByText("⛶ Pantalla completa"));

    pickChipWithKeyboard(chipIn(document.body, "bgv", "col-1", "gaby"));
    fireEvent.keyDown(document, { key: "Escape" });

    expect(pickBannerText(document.body)).toBe("");
    expect(screen.getByText("Salir de pantalla completa (Esc)")).toBeTruthy();
  });

  it("stops telling the admin to choose a cell once a save has locked them all", () => {
    // A pick can only be ARMED while unlocked, but a save can start under one.
    // Every cell then refuses, so "Elige la casilla de destino" would be
    // instructing the admin to do the one thing nothing will accept.
    const cells = [cell("bgv", "col-1", ["gaby"]), cell("lead", "col-2", [])];
    const props = baseProps({ cells });
    const { container, rerenderWith } = renderGrid(props);

    pickChipWithKeyboard(chipIn(container, "bgv", "col-1", "gaby"));
    expect(pickBannerText(container)).toContain("Elige la casilla de destino");

    rerenderWith({ ...props, mode: "stored", mutationLocked: true });

    expect(pickBannerText(container)).toContain("Gaby");
    expect(pickBannerText(container)).not.toContain("Elige la casilla de destino");
    expect(pickBannerText(container)).toContain("Espera a que termine");
    // Escape is still honest — it does cancel while locked.
    expect(pickBannerText(container)).toContain("Esc");
  });

  it("drops a pick whose source has left the grid rather than writing a stale move", () => {
    const onCellsChange = vi.fn();
    const cells = [cell("bgv", "col-1", ["gaby"]), cell("lead", "col-2", [])];
    const props = baseProps({ cells, onCellsChange });
    const { container, rerenderWith } = renderGrid(props);

    pickChipWithKeyboard(chipIn(container, "bgv", "col-1", "gaby"));
    // Auto finishes, another window edits: Gaby is no longer in that seat.
    rerenderWith({ ...props, cells: [cell("bgv", "col-1", []), cell("lead", "col-2", [])] });
    activateCell(container, "lead", "col-2");

    expect(onCellsChange).not.toHaveBeenCalled();
    expect(pickBannerText(container)).toBe("");
  });
});

// ─── Acceptance 12 — the `+N` tail, out again ────────────────────────────────

describe("an occupant hidden behind +N can be moved out (acceptance 12)", () => {
  it("round trip: dropped onto an at-target cell, then out again via the picker row", () => {
    // NOT full coverage, and the gap is structural: `rankCandidates` filters on
    // `memberType` before it maps (`candidateRanking.ts:184-185`), so an occupant
    // seated in a seat their type does not cover has no picker row — and so no
    // anchor. That occupant cannot be removed by ANY means in this UI today (the
    // same filter gates `toggleCandidate`); this path neither closes nor widens
    // that hole.
    const onCellsChange = vi.fn();
    // `lead` targets 2, so col-1's Lead is already at target.
    const cells = [cell("bgv", "col-1", ["gaby"]), cell("lead", "col-1", ["frank", "liu"])];
    const props = baseProps({ cells, onCellsChange });
    const { container, rerenderWith } = renderGrid(props);

    // 1. Acceptance 3's drop: Gaby is appended, over target.
    const dt = { effectAllowed: "", dropEffect: "", setData: () => {}, getData: () => "" };
    const chip = chipIn(container, "bgv", "col-1", "gaby");
    fireEvent(chip, createEvent.dragStart(chip, { dataTransfer: dt }));
    const target = cellAt(container, "lead", "col-1");
    fireEvent(target, createEvent.dragOver(target, { dataTransfer: dt }));
    fireEvent(target, createEvent.drop(target, { dataTransfer: dt }));
    const afterDrop = onCellsChange.mock.calls[0][0] as GridCell[];
    expect(occupantsOf(afterDrop, "lead", "col-1")).toEqual(["frank", "liu", "gaby"]);

    // 2. She is in the hidden tail: no chip, so no drag can reach her.
    rerenderWith({ ...props, cells: afterDrop });
    expect(cellAt(container, "lead", "col-1").querySelector('[data-occupant="gaby"]')).toBeNull();

    // 3. The picker row is the anchor — DD11's whole point — and it is reached
    //    BY KEYBOARD, which is the only reason this path exists at all.
    fireEvent.click(cellActionIn(container, "lead", "col-1"));
    activateAnchorWithKeyboard(pickerAnchorFor("Gaby"));
    expect(pickBannerText(container)).toContain("Gaby");
    // Marking is not editing: the drop above is still the only write so far.
    expect(onCellsChange).toHaveBeenCalledTimes(1);

    // 4. …and she lands somewhere reachable again.
    activateCell(container, "lead", "col-2");
    expect(onCellsChange).toHaveBeenCalledTimes(2);
    const next = onCellsChange.mock.calls[1][0] as GridCell[];
    expect(occupantsOf(next, "lead", "col-1")).toEqual(["frank", "liu"]);
    expect(occupantsOf(next, "lead", "col-2")).toEqual(["gaby"]);
  });

  it("marks from the keyboard WITHOUT un-seating the member it is marking", () => {
    // THE MUTATION THIS CATCHES, and a defect this suite once shipped: the
    // anchor is a nested `<button>` inside a `role="button"` row whose own
    // Enter/Space handler calls `onToggle` — which, for a member already seated
    // here, is the REMOVAL branch. The row must ignore keystrokes aimed at the
    // controls inside it (`e.target !== e.currentTarget`); without that guard
    // Enter on "Marcar para mover" un-seats the occupant, marks the column
    // touched and arms no pick — the destructive opposite of the action's name,
    // on the ONLY route a `+N`-hidden occupant has.
    const onCellsChange = vi.fn();
    const cells = [cell("lead", "col-1", ["gaby"]), cell("lead", "col-2", [])];
    const { container } = renderGrid(baseProps({ cells, onCellsChange }));
    fireEvent.click(cellActionIn(container, "lead", "col-1"));
    // Not blocked, not overridable: the ordinary acceptance-12 row, where the
    // row's own key handler is live.
    expect(candidateLi("Gaby").getAttribute("aria-disabled")).toBeNull();

    fireEvent.keyDown(pickerAnchorFor("Gaby"), { key: "Enter" });
    expect(onCellsChange).not.toHaveBeenCalled();
    fireEvent.keyDown(pickerAnchorFor("Gaby"), { key: " " });
    expect(onCellsChange).not.toHaveBeenCalled();

    // …and the activation the browser makes of that keystroke does mark.
    fireEvent.click(pickerAnchorFor("Gaby"));
    expect(pickBannerText(container)).toContain("Gaby");
    // Still seated where she was: nothing has been written at all.
    expect(onCellsChange).not.toHaveBeenCalled();
    expect(chipIn(container, "lead", "col-1", "gaby")).toBeTruthy();
  });

  it("keeps the row's OWN Enter working — a keystroke on the row still toggles", () => {
    // The guard above is scoped to keystrokes aimed at nested controls. The
    // row's shipped behaviour (Enter un-seats a member seated here) must survive
    // it, or the fix has traded one regression for another.
    const onCellsChange = vi.fn();
    const cells = [cell("lead", "col-1", ["gaby"])];
    const { container } = renderGrid(baseProps({ cells, onCellsChange }));
    fireEvent.click(cellActionIn(container, "lead", "col-1"));

    fireEvent.keyDown(candidateLi("Gaby"), { key: "Enter" });

    expect(onCellsChange).toHaveBeenCalledTimes(1);
    const next = onCellsChange.mock.calls[0][0] as GridCell[];
    expect(occupantsOf(next, "lead", "col-1")).toEqual([]);
  });

  it("keeps the anchor for a hidden occupant who ALSO holds a same-category double", () => {
    // THE MUTATION THIS CATCHES: the anchor rendered inside `CandidateRow`'s
    // `blocked` guard. Gaby is in the `+N` tail of Lead AND in BGV of the same
    // date, so her row is `aria-disabled` — exactly the person an admin most
    // needs to relocate, and the plain round trip above would not notice her
    // losing every anchor she has. Eligibility is a question about the TARGET.
    const onCellsChange = vi.fn();
    const cells = [
      cell("lead", "col-1", ["frank", "liu", "gaby"]),
      cell("bgv", "col-1", ["gaby"]),
    ];
    const { container } = renderGrid(baseProps({ cells, onCellsChange }));

    expect(cellAt(container, "lead", "col-1").querySelector('[data-occupant="gaby"]')).toBeNull();
    fireEvent.click(cellActionIn(container, "lead", "col-1"));
    expect(candidateLi("Gaby").getAttribute("aria-disabled")).toBe("true");

    activateAnchorWithKeyboard(pickerAnchorFor("Gaby"));
    activateCell(container, "lead", "col-2");

    const next = onCellsChange.mock.calls[0][0] as GridCell[];
    expect(occupantsOf(next, "lead", "col-1")).toEqual(["frank", "liu"]);
    expect(occupantsOf(next, "bgv", "col-1")).toEqual(["gaby"]); // the OTHER seat is untouched
    expect(occupantsOf(next, "lead", "col-2")).toEqual(["gaby"]);
  });

  it("offers the anchor on SEATED rows only, and it toggles off", () => {
    const cells = [cell("lead", "col-1", ["gaby"])];
    const { container } = renderGrid(baseProps({ cells }));
    fireEvent.click(cellActionIn(container, "lead", "col-1"));

    // Liu is a candidate for this seat and is not seated in it: a source anchor
    // on her row would be the "traer aquí" DD12 rejected.
    expect(
      within(candidateLi("Liu")).queryByRole("button", { name: /marcar para mover/i }),
    ).toBeNull();

    const anchor = pickerAnchorFor("Gaby");
    fireEvent.click(anchor);
    expect(pickBannerText(container)).toContain("Gaby");
    fireEvent.click(pickerAnchorFor("Gaby"));
    expect(pickBannerText(container)).toBe("");
  });

  it("meets the 44px touch floor — DD8 routes the iOS wrap through this anchor", () => {
    const cells = [cell("lead", "col-1", ["gaby"])];
    const { container } = renderGrid(baseProps({ cells }));
    fireEvent.click(cellActionIn(container, "lead", "col-1"));

    // jsdom lays nothing out, so the class contract is the honest assertion —
    // the same one the picker's own Cerrar and "Asignar de todos modos" carry.
    const anchor = pickerAnchorFor("Gaby");
    expect(anchor.className).toContain("min-h-[44px]");
    expect(anchor.className).toContain("w-full");
  });
});
