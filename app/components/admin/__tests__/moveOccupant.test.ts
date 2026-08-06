// `moveOccupant` is T2 of the grid drag-and-drop plan
// (docs/superpowers/plans/2026-08-06-grid-drag-and-drop.md) — the single move
// primitive every drag must go through: source minus the member, target plus
// the member, composed as ONE `cells` update via two `withUpdatedCell` calls
// (DD1). It is exported and UNCALLED in production here; T3 gates it, T4/T5
// wire it. Every assertion below exists because the brief calls out a specific
// failure mode this primitive must not have — see `task-2-brief.md`.
import { describe, expect, it } from "vitest";

import { moveOccupant } from "../moveOccupant";
import type { GridCell } from "../plannerModel";

function cell(rowId: string, columnId: string, occupants: GridCell["occupants"]): GridCell {
  return { rowId, columnId, occupants, origin: "manual" };
}

describe("moveOccupant", () => {
  it("C1 — target already holds the member: returns cells unchanged, does not throw", () => {
    const cells: GridCell[] = [
      cell("BGV", "col-1", [{ memberId: "m1" }]),
      cell("LEAD", "col-1", [{ memberId: "m1" }]),
    ];
    const before = structuredClone(cells);

    const result = moveOccupant(
      cells,
      { rowId: "BGV", columnId: "col-1", memberId: "m1" },
      { rowId: "LEAD", columnId: "col-1" },
    );

    expect(result).toBe(cells);
    expect(cells).toEqual(before);
  });

  it("source holds the member twice: exactly one copy removed, and the SURVIVING copy is the one that keeps its stored item key", () => {
    const cells: GridCell[] = [
      cell("BGV", "col-1", [
        { memberId: "m1", itemKey: "key-a" },
        { memberId: "m1", itemKey: "key-b" },
      ]),
      cell("LEAD", "col-1", []),
    ];

    const result = moveOccupant(
      cells,
      { rowId: "BGV", columnId: "col-1", memberId: "m1" },
      { rowId: "LEAD", columnId: "col-1" },
    );

    const bgv = result.find((c) => c.rowId === "BGV" && c.columnId === "col-1");
    expect(bgv?.occupants).toHaveLength(1);
    expect(bgv?.occupants[0]).toEqual({ memberId: "m1", itemKey: "key-a" });

    const lead = result.find((c) => c.rowId === "LEAD" && c.columnId === "col-1");
    expect(lead?.occupants.map((o) => o.memberId)).toEqual(["m1"]);
  });

  it("acceptance 2 — same-service BGV to LEAD move: BGV one fewer, LEAD one more, one returned array", () => {
    const cells: GridCell[] = [
      cell("BGV", "col-1", [{ memberId: "m1" }, { memberId: "m2" }]),
      cell("LEAD", "col-1", [{ memberId: "m3" }]),
    ];

    const result = moveOccupant(
      cells,
      { rowId: "BGV", columnId: "col-1", memberId: "m1" },
      { rowId: "LEAD", columnId: "col-1" },
    );

    const bgv = result.find((c) => c.rowId === "BGV" && c.columnId === "col-1");
    const lead = result.find((c) => c.rowId === "LEAD" && c.columnId === "col-1");
    expect(bgv?.occupants.map((o) => o.memberId)).toEqual(["m2"]);
    expect(lead?.occupants.map((o) => o.memberId)).toEqual(["m3", "m1"]);
  });

  it("acceptance 5 (T2's share) — forced move: target's overrideReasons carries the waived rule, source's overrides are pruned", () => {
    const cells: GridCell[] = [
      cell("BGV", "col-1", [{ memberId: "m1" }]),
      cell("LEAD", "col-1", [{ memberId: "m3" }]),
    ];
    cells[0] = { ...cells[0], overrides: ["m1"], overrideReasons: { m1: "otra regla ya anulada" } };

    const result = moveOccupant(
      cells,
      { rowId: "BGV", columnId: "col-1", memberId: "m1" },
      { rowId: "LEAD", columnId: "col-1" },
      { memberId: "m1", reason: "No puede repetir con m3" },
    );

    const bgv = result.find((c) => c.rowId === "BGV" && c.columnId === "col-1");
    const lead = result.find((c) => c.rowId === "LEAD" && c.columnId === "col-1");
    // Source no longer seats m1 at all — a stale override here would silence
    // E13's re-flag if m1 were ever seated back in BGV (docs cite this exactly).
    expect(bgv?.overrides ?? []).toEqual([]);
    expect(bgv?.overrideReasons ?? {}).toEqual({});
    expect(lead?.overrides).toEqual(["m1"]);
    expect(lead?.overrideReasons).toEqual({ m1: "No puede repetir con m3" });
  });

  it("cross-column move: only the two touched cells differ; every other cell keeps its reference", () => {
    const source = cell("BGV", "col-1", [{ memberId: "m1" }]);
    const target = cell("BGV", "col-2", []);
    const untouchedA = cell("LEAD", "col-1", [{ memberId: "m9" }]);
    const untouchedB = cell("CHORUS", "col-2", [{ memberId: "m8" }]);
    const cells: GridCell[] = [source, target, untouchedA, untouchedB];

    const result = moveOccupant(
      cells,
      { rowId: "BGV", columnId: "col-1", memberId: "m1" },
      { rowId: "BGV", columnId: "col-2" },
    );

    expect(result.find((c) => c.rowId === "BGV" && c.columnId === "col-1")).not.toBe(source);
    expect(result.find((c) => c.rowId === "BGV" && c.columnId === "col-2")).not.toBe(target);
    expect(result.find((c) => c.rowId === "LEAD" && c.columnId === "col-1")).toBe(untouchedA);
    expect(result.find((c) => c.rowId === "CHORUS" && c.columnId === "col-2")).toBe(untouchedB);
  });

  it("source cell does not exist in `cells`: no spurious cell is created", () => {
    const cells: GridCell[] = [cell("LEAD", "col-1", [{ memberId: "m3" }])];

    const result = moveOccupant(
      cells,
      { rowId: "BGV", columnId: "col-1", memberId: "m1" },
      { rowId: "LEAD", columnId: "col-1" },
    );

    expect(result).toHaveLength(1);
  });

  it("same-cell move (source === target): the two-call composition still runs and the C1 no-op applies, since the member is already seated at the target", () => {
    const cells: GridCell[] = [cell("BGV", "col-1", [{ memberId: "m1" }])];

    const result = moveOccupant(
      cells,
      { rowId: "BGV", columnId: "col-1", memberId: "m1" },
      { rowId: "BGV", columnId: "col-1" },
    );

    expect(result).toBe(cells);
  });
});
