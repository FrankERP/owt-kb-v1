// T3 of the grid drag-and-drop plan
// (docs/superpowers/plans/2026-08-06-grid-drag-and-drop.md) — the judgement half
// of a move: preconditions P1–P3 and the four constraints C1–C4. Every assertion
// below exists because the brief names a specific way this gate could pass
// everything and look like it works; see `task-3-brief.md`.
//
// The two mandated mutations this file must catch:
//   (a) feeding the gate POST-MOVE state — `ruleEnforcement.ts:351` exempts a
//       member already seated at the row being evaluated, so C4 would never fire;
//   (b) dropping the target `column` from the `rankCandidates` call — without it
//       no pattern's service half matches and `ruleBlockedReason` stays `null`.
// Both are caught by "acceptance 6".
import { describe, expect, it } from "vitest";

import {
  assignedAfterSourceRemoval,
  canTouchColumn,
  createMoveGate,
  evaluateMove,
  type MoveGateInput,
} from "../moveGate";
import { buildRows, type GridCell, type GridColumn, type SolverConfig } from "../plannerModel";
import type { RankMember } from "../candidateRanking";
import type { StoredGridColumn } from "../storedRoleReadModel";

const ROWS = buildRows();

const SUNDAYS = ["2026-09-06", "2026-09-13", "2026-09-20", "2026-09-27"];

const COL_1: GridColumn = { columnId: "col-1", date: "2026-09-06", type: "sunday_role" };
const COL_2: GridColumn = { columnId: "col-2", date: "2026-09-13", type: "sunday_role" };

const GABY: RankMember = { _id: "gaby", member_name: "Gabriela Rocha", alias: "Gaby", memberType: ["voz"] };
const FRANK: RankMember = { _id: "frank", member_name: "Francisco Rocha", alias: "Frank", memberType: ["voz", "instrumento"] };
const LUIS: RankMember = { _id: "luis", member_name: "Luis Pérez", alias: "Luis", memberType: ["instrumento"] };
const MEMBERS = [GABY, FRANK, LUIS];

/** `Frank !with Gaby` on every voice row of any service. */
const CONFLICT_CONFIG: SolverConfig = {
  sundayLeads: [],
  saturdayLeads: [],
  support: [],
  restrictions: [],
  conflicts: [{ id: "k1", personA: "Frank", personB: "Gaby", pattern: "*.*" }],
  presence: [],
};

const NO_RULES: SolverConfig = {
  sundayLeads: [],
  saturdayLeads: [],
  support: [],
  restrictions: [],
  conflicts: [],
  presence: [],
};

function cell(rowId: string, columnId: string, memberIds: string[]): GridCell {
  return { rowId, columnId, occupants: memberIds.map((memberId) => ({ memberId })), origin: "manual" };
}

function baseInput(overrides: Partial<MoveGateInput> & Pick<MoveGateInput, "cells" | "source" | "target">): MoveGateInput {
  return {
    mode: "create",
    rows: ROWS,
    columns: [COL_1, COL_2],
    members: MEMBERS,
    sundayDates: SUNDAYS,
    ...overrides,
  };
}

describe("assignedAfterSourceRemoval", () => {
  it("is the TARGET column's occupancy, source removal applied, member NOT yet at the target seat", () => {
    const cells = [
      cell("bgv", "col-1", ["gaby", "frank"]),
      cell("lead", "col-1", []),
      cell("bgv", "col-2", ["frank"]),
    ];

    const assigned = assignedAfterSourceRemoval({
      cells,
      rows: ROWS,
      source: { rowId: "bgv", columnId: "col-1", memberId: "gaby" },
      targetColumnId: "col-1",
    });

    // Shape, asserted directly: `{ seatId, category, memberId }` per seat.
    expect(assigned).toEqual([{ seatId: "bgv", category: "voz", memberId: "frank" }]);
    // The dragged member appears nowhere — not at the source (removed) and not
    // at the target seat (never added). Post-move state would hold them at
    // `lead`, and every rule would then pass.
    expect(assigned.some((a) => a.memberId === "gaby")).toBe(false);
  });

  it("cross-column move: the removal is a no-op and only the target column contributes", () => {
    const cells = [
      cell("bgv", "col-1", ["gaby"]),
      cell("bgv", "col-2", ["gaby", "frank"]),
      cell("lead", "col-2", []),
    ];

    const assigned = assignedAfterSourceRemoval({
      cells,
      rows: ROWS,
      source: { rowId: "bgv", columnId: "col-1", memberId: "gaby" },
      targetColumnId: "col-2",
    });

    expect(assigned).toEqual([
      { seatId: "bgv", category: "voz", memberId: "gaby" },
      { seatId: "bgv", category: "voz", memberId: "frank" },
    ]);
  });

  it("source cell holding the member twice: exactly ONE copy drops (DD10, `reasonsFor`'s precedent)", () => {
    const cells = [cell("bgv", "col-1", ["gaby", "gaby", "frank"]), cell("lead", "col-1", [])];

    const assigned = assignedAfterSourceRemoval({
      cells,
      rows: ROWS,
      source: { rowId: "bgv", columnId: "col-1", memberId: "gaby" },
      targetColumnId: "col-1",
    });

    expect(assigned).toEqual([
      { seatId: "bgv", category: "voz", memberId: "gaby" },
      { seatId: "bgv", category: "voz", memberId: "frank" },
    ]);
  });

  it("a cell whose row is unknown contributes nothing (`assignedForColumn`'s own contract)", () => {
    const cells = [cell("ghost", "col-1", ["frank"]), cell("bgv", "col-1", ["gaby"])];

    const assigned = assignedAfterSourceRemoval({
      cells,
      rows: ROWS,
      source: { rowId: "lead", columnId: "col-1", memberId: "luis" },
      targetColumnId: "col-1",
    });

    expect(assigned).toEqual([{ seatId: "bgv", category: "voz", memberId: "gaby" }]);
  });
});

describe("evaluateMove — acceptance 6 (C4) and 5 (T3's share)", () => {
  // THE mutation-proof test. Both mandated mutations turn this verdict `clean`.
  it("a configured conflict pair raises C4, with the rule and the exact addOverride payload", () => {
    const cells = [
      cell("lead", "col-1", ["frank"]),
      cell("bgv", "col-1", []),
      cell("bgv", "col-2", ["gaby"]),
    ];

    const verdict = evaluateMove(
      baseInput({
        cells,
        source: { rowId: "bgv", columnId: "col-2", memberId: "gaby" },
        target: { rowId: "bgv", columnId: "col-1" },
        config: CONFLICT_CONFIG,
      }),
    );

    expect(verdict.kind).toBe("prompt");
    if (verdict.kind !== "prompt") return;
    expect(verdict.code).toBe("C4");
    expect(verdict.reason).toBe("Regla: no puede coincidir con Frank");
    // T4 forces with EXACTLY this payload — the member is narrowed to the
    // dragged one, so a forced move cannot record the waiver against anybody else.
    expect(verdict.addOverride).toEqual({ memberId: "gaby", reason: "Regla: no puede coincidir con Frank" });
  });

  it("the same pair with the conflict rule absent is clean (the prompt is the rule's doing, not the fixture's)", () => {
    const cells = [
      cell("lead", "col-1", ["frank"]),
      cell("bgv", "col-1", []),
      cell("bgv", "col-2", ["gaby"]),
    ];

    const verdict = evaluateMove(
      baseInput({
        cells,
        source: { rowId: "bgv", columnId: "col-2", memberId: "gaby" },
        target: { rowId: "bgv", columnId: "col-1" },
        config: NO_RULES,
      }),
    );

    expect(verdict.kind).toBe("clean");
  });

  it("a week exclusion on the TARGET column's week prompts — the spine is threaded per column", () => {
    const config: SolverConfig = {
      ...NO_RULES,
      restrictions: [
        {
          id: "r1",
          person: "Gaby",
          excludedPatterns: [],
          fairness: "none",
          fairnessSlack: 0,
          weekExclusions: [{ id: "w1", week: 2, pattern: "*.*" }],
          caps: [],
        },
      ],
    };
    const cells = [cell("bgv", "col-1", ["gaby"]), cell("bgv", "col-2", [])];

    const verdict = evaluateMove(
      baseInput({
        cells,
        source: { rowId: "bgv", columnId: "col-1", memberId: "gaby" },
        target: { rowId: "bgv", columnId: "col-2" },
        config,
        sundayDates: [],
        sundayDatesForColumn: () => SUNDAYS,
      }),
    );

    expect(verdict.kind).toBe("prompt");
    if (verdict.kind !== "prompt") return;
    expect(verdict.reason).toBe("Regla: excluido en la semana 2 (*.*)");
  });
});

describe("evaluateMove — acceptance 4 (clean) and 7 (the three refusals)", () => {
  it("acceptance 4 — a move violating nothing completes with no prompt", () => {
    const cells = [cell("bgv", "col-1", ["gaby"]), cell("lead", "col-2", [])];

    const verdict = evaluateMove(
      baseInput({
        cells,
        source: { rowId: "bgv", columnId: "col-1", memberId: "gaby" },
        target: { rowId: "lead", columnId: "col-2" },
        config: CONFLICT_CONFIG,
      }),
    );

    expect(verdict).toEqual({ kind: "clean" });
  });

  it("C1 — the target cell already holds the dragged member: refused, never forceable", () => {
    const cells = [cell("bgv", "col-1", ["gaby"]), cell("lead", "col-1", ["gaby"])];

    const verdict = evaluateMove(
      baseInput({
        cells,
        source: { rowId: "bgv", columnId: "col-1", memberId: "gaby" },
        target: { rowId: "lead", columnId: "col-1" },
        config: CONFLICT_CONFIG,
      }),
    );

    expect(verdict).toEqual({ kind: "refused", code: "C1", reason: "Ya está en esta casilla" });
  });

  it("C1 — a same-cell self-drop with a SINGLE copy still fires (pre-removal membership, not the post-removal list)", () => {
    const cells = [cell("bgv", "col-1", ["gaby"])];

    const verdict = evaluateMove(
      baseInput({
        cells,
        source: { rowId: "bgv", columnId: "col-1", memberId: "gaby" },
        target: { rowId: "bgv", columnId: "col-1" },
      }),
    );

    expect(verdict).toEqual({ kind: "refused", code: "C1", reason: "Ya está en esta casilla" });
  });

  it("C2 cross-service — Gaby in BGV of week 1 dragged to Lead of week 2 while already in BGV of week 2", () => {
    const cells = [
      cell("bgv", "col-1", ["gaby"]),
      cell("bgv", "col-2", ["gaby"]),
      cell("lead", "col-2", []),
    ];

    const verdict = evaluateMove(
      baseInput({
        cells,
        source: { rowId: "bgv", columnId: "col-1", memberId: "gaby" },
        target: { rowId: "lead", columnId: "col-2" },
      }),
    );

    // The picker's own wording (`candidateRanking.ts`'s `blockedReason`).
    expect(verdict).toEqual({ kind: "refused", code: "C2", reason: "Ya asignado en Bgv" });
  });

  it("C2's converse — the same-service BGV→Lead move of an otherwise-clean member is NOT refused", () => {
    const cells = [cell("bgv", "col-1", ["gaby"]), cell("lead", "col-1", [])];

    const verdict = evaluateMove(
      baseInput({
        cells,
        source: { rowId: "bgv", columnId: "col-1", memberId: "gaby" },
        target: { rowId: "lead", columnId: "col-1" },
      }),
    );

    expect(verdict).toEqual({ kind: "clean" });
  });

  it("C3 — the seat's `memberType` excludes the member: refused with C3's wording, never forceable", () => {
    const cells = [cell("instrumento:Bass", "col-1", ["luis"]), cell("lead", "col-1", [])];

    const verdict = evaluateMove(
      baseInput({
        cells,
        source: { rowId: "instrumento:Bass", columnId: "col-1", memberId: "luis" },
        target: { rowId: "lead", columnId: "col-1" },
      }),
    );

    expect(verdict).toEqual({
      kind: "refused",
      code: "C3",
      reason: "No puede ocupar Lead: requiere tipo voz",
    });
  });

  it("absence's OTHER cause — a member id not in `members` also refuses, but not with C3's wording", () => {
    const cells = [cell("bgv", "col-1", ["ghost"]), cell("lead", "col-1", [])];

    const verdict = evaluateMove(
      baseInput({
        cells,
        source: { rowId: "bgv", columnId: "col-1", memberId: "ghost" },
        target: { rowId: "lead", columnId: "col-1" },
      }),
    );

    expect(verdict.kind).toBe("refused");
    if (verdict.kind !== "refused") return;
    expect(verdict.code).toBe("unknown-member");
    expect(verdict.reason).not.toBe("No puede ocupar Lead: requiere tipo voz");
  });

  it("the source removal is keyed by ROW id, not by seat id — a stored lowercase instrument row still clears", () => {
    // `instrumento:keys` is the stored row id (`normalizeLabel`, case-preserving);
    // `seatDefForRow` would rebuild it as `instrumento:Keys` (`normalizeSeatName`).
    // Removing by the seat id would clear nothing and this clean move would be
    // refused as a same-category double.
    const rows = [
      ...ROWS.filter((r) => r.category === "voz"),
      { id: "instrumento:keys", label: "keys", category: "instrumento" as const, target: null },
      { id: "instrumento:Drums", label: "Drums", category: "instrumento" as const, target: null },
    ];
    const cells = [cell("instrumento:keys", "col-1", ["luis"]), cell("instrumento:Drums", "col-1", [])];

    const verdict = evaluateMove(
      baseInput({
        cells,
        rows,
        source: { rowId: "instrumento:keys", columnId: "col-1", memberId: "luis" },
        target: { rowId: "instrumento:Drums", columnId: "col-1" },
      }),
    );

    expect(verdict).toEqual({ kind: "clean" });
  });

  it("C2 is decided before C4, so a same-category double is refused rather than offered a force path", () => {
    const cells = [
      cell("lead", "col-2", ["frank"]),
      cell("bgv", "col-2", ["gaby"]),
      cell("bgv", "col-1", ["gaby"]),
      cell("coro", "col-2", []),
    ];

    const verdict = evaluateMove(
      baseInput({
        cells,
        source: { rowId: "bgv", columnId: "col-1", memberId: "gaby" },
        target: { rowId: "coro", columnId: "col-2" },
        config: CONFLICT_CONFIG,
      }),
    );

    expect(verdict.kind).toBe("refused");
    if (verdict.kind !== "refused") return;
    expect(verdict.code).toBe("C2");
  });
});

describe("evaluateMove — acceptance 8 (the preconditions)", () => {
  it("P1 — `mutationLocked` refuses before anything is evaluated", () => {
    const cells = [cell("bgv", "col-1", ["gaby"]), cell("lead", "col-2", [])];
    const before = structuredClone(cells);

    const verdict = evaluateMove(
      baseInput({
        cells,
        source: { rowId: "bgv", columnId: "col-1", memberId: "gaby" },
        target: { rowId: "lead", columnId: "col-2" },
        mutationLocked: true,
        config: CONFLICT_CONFIG,
      }),
    );

    expect(verdict.kind).toBe("not-permitted");
    if (verdict.kind !== "not-permitted") return;
    expect(verdict.code).toBe("P1");
    expect(cells).toEqual(before);
  });

  it("P2 — stored mode refuses a `readOnly` TARGET", () => {
    const verdict = evaluateMove(storedInput({ readOnlyColumnId: "col-2" }));

    expect(verdict.kind).toBe("not-permitted");
    if (verdict.kind !== "not-permitted") return;
    expect(verdict.code).toBe("P2");
  });

  it("P2 — stored mode refuses a `readOnly` SOURCE too (both endpoints, unlike P3)", () => {
    const verdict = evaluateMove(storedInput({ readOnlyColumnId: "col-1" }));

    expect(verdict.kind).toBe("not-permitted");
    if (verdict.kind !== "not-permitted") return;
    expect(verdict.code).toBe("P2");
  });

  it("P2 — the same stored move with both columns admitted is evaluated normally", () => {
    expect(evaluateMove(storedInput({})).kind).toBe("clean");
  });

  it("P2 is `serializeStoredColumn().ok`, not a `readOnly` string check: a column missing its Coro cell also refuses", () => {
    const input = storedInput({});
    const verdict = evaluateMove({
      ...input,
      cells: input.cells.filter((c) => !(c.columnId === "col-2" && c.rowId === "coro")),
    });

    expect(verdict.kind).toBe("not-permitted");
    if (verdict.kind !== "not-permitted") return;
    expect(verdict.code).toBe("P2");
  });

  it("P2 does not apply in create mode (there is no stored column to serialize)", () => {
    const cells = [cell("bgv", "col-1", ["gaby"]), cell("lead", "col-2", [])];

    const verdict = evaluateMove(
      baseInput({
        cells,
        source: { rowId: "bgv", columnId: "col-1", memberId: "gaby" },
        target: { rowId: "lead", columnId: "col-2" },
      }),
    );

    expect(verdict.kind).toBe("clean");
  });

  it("P3 — create mode refuses a target column that will never be written", () => {
    const cells = [cell("bgv", "col-1", ["gaby"]), cell("lead", "col-2", [])];

    const verdict = evaluateMove(
      baseInput({
        cells,
        source: { rowId: "bgv", columnId: "col-1", memberId: "gaby" },
        target: { rowId: "lead", columnId: "col-2" },
        canReceive: (column) => column.columnId !== "col-2",
      }),
    );

    expect(verdict.kind).toBe("not-permitted");
    if (verdict.kind !== "not-permitted") return;
    expect(verdict.code).toBe("P3");
  });

  it("P3 is drop-side only — dragging OUT of a column that will never be written is legitimate", () => {
    const cells = [cell("bgv", "col-1", ["gaby"]), cell("lead", "col-2", [])];

    const verdict = evaluateMove(
      baseInput({
        cells,
        source: { rowId: "bgv", columnId: "col-1", memberId: "gaby" },
        target: { rowId: "lead", columnId: "col-2" },
        canReceive: (column) => column.columnId !== "col-1",
      }),
    );

    expect(verdict.kind).toBe("clean");
  });

  it("fails closed on an unresolvable endpoint rather than evaluating a guess", () => {
    const cells = [cell("bgv", "col-1", ["gaby"])];

    const unknownColumn = evaluateMove(
      baseInput({
        cells,
        source: { rowId: "bgv", columnId: "col-1", memberId: "gaby" },
        target: { rowId: "lead", columnId: "col-9" },
      }),
    );
    const unknownRow = evaluateMove(
      baseInput({
        cells,
        source: { rowId: "bgv", columnId: "col-1", memberId: "gaby" },
        target: { rowId: "nope", columnId: "col-1" },
      }),
    );
    const notSeated = evaluateMove(
      baseInput({
        cells,
        source: { rowId: "lead", columnId: "col-1", memberId: "gaby" },
        target: { rowId: "bgv", columnId: "col-2" },
      }),
    );

    expect(unknownColumn.kind).toBe("not-permitted");
    expect(unknownRow.kind).toBe("not-permitted");
    expect(notSeated.kind).toBe("not-permitted");
  });
});

describe("canTouchColumn", () => {
  it("create mode always permits; stored mode answers with the serializer", () => {
    const input = storedInput({ readOnlyColumnId: "col-2" });
    const readOnly = input.columns.find((c) => c.columnId === "col-2")!;

    expect(canTouchColumn({ mode: "stored", column: readOnly, rows: input.rows, cells: input.cells })).toBe(false);
    expect(canTouchColumn({ mode: "create", column: readOnly, rows: input.rows, cells: input.cells })).toBe(true);
  });

  it("stored mode fails closed on a column carrying no stored identity", () => {
    expect(canTouchColumn({ mode: "stored", column: COL_1, rows: ROWS, cells: [] })).toBe(false);
  });
});

describe("createMoveGate — memoization", () => {
  it("returns the cached verdict for the same move while nothing changed", () => {
    const gate = createMoveGate();
    const input = baseInput({
      cells: [cell("bgv", "col-1", ["gaby"]), cell("lead", "col-2", [])],
      source: { rowId: "bgv", columnId: "col-1", memberId: "gaby" },
      target: { rowId: "lead", columnId: "col-2" },
      config: CONFLICT_CONFIG,
    });

    const first = gate(input);
    expect(gate({ ...input })).toBe(first);
  });

  it("a different (target cell, dragged member) is a different key", () => {
    const gate = createMoveGate();
    const cells = [
      cell("lead", "col-1", ["frank"]),
      cell("bgv", "col-1", []),
      cell("bgv", "col-2", ["gaby"]),
    ];
    const input = baseInput({
      cells,
      source: { rowId: "bgv", columnId: "col-2", memberId: "gaby" },
      target: { rowId: "coro", columnId: "col-1" },
      config: CONFLICT_CONFIG,
    });

    expect(gate(input).kind).toBe("prompt");
    expect(gate({ ...input, target: { rowId: "bgv", columnId: "col-2" } }).kind).toBe("refused");
  });

  it("a new `cells` reference invalidates the cache — a stale verdict would force against a moved grid", () => {
    const gate = createMoveGate();
    const input = baseInput({
      cells: [cell("bgv", "col-2", ["gaby"]), cell("lead", "col-1", []), cell("bgv", "col-1", [])],
      source: { rowId: "bgv", columnId: "col-2", memberId: "gaby" },
      target: { rowId: "bgv", columnId: "col-1" },
      config: CONFLICT_CONFIG,
    });

    expect(gate(input).kind).toBe("clean");

    const withFrankSeated = gate({
      ...input,
      cells: [cell("bgv", "col-2", ["gaby"]), cell("lead", "col-1", ["frank"]), cell("bgv", "col-1", [])],
    });
    expect(withFrankSeated.kind).toBe("prompt");
  });
});

// ─── Stored-mode fixture ─────────────────────────────────────────────────────

function storedColumn(column: GridColumn, admission: StoredGridColumn["admission"]): StoredGridColumn {
  return { ...column, roleId: column.columnId, rev: "rev-1", published: true, admission };
}

/**
 * A stored two-column grid with every voice row present in both columns, so
 * `serializeStoredColumn` is `ok` unless the fixture deliberately breaks it.
 * The move is Gaby from BGV of col-1 to Lead of col-2 — clean on its own.
 */
function storedInput(opts: { readOnlyColumnId?: string }): MoveGateInput {
  const columns = [COL_1, COL_2].map((column) =>
    storedColumn(column, opts.readOnlyColumnId === column.columnId ? "readOnly" : "approved"),
  );
  const cells = [
    cell("lead", "col-1", []),
    cell("bgv", "col-1", ["gaby"]),
    cell("coro", "col-1", []),
    cell("lead", "col-2", []),
    cell("bgv", "col-2", []),
    cell("coro", "col-2", []),
  ];
  return {
    mode: "stored",
    rows: ROWS,
    columns,
    cells,
    members: MEMBERS,
    sundayDates: SUNDAYS,
    source: { rowId: "bgv", columnId: "col-1", memberId: "gaby" },
    target: { rowId: "lead", columnId: "col-2" },
    config: CONFLICT_CONFIG,
  };
}
