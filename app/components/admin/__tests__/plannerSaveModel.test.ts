import { describe, expect, it } from "vitest";
import type { GridCell } from "../plannerModel";
import {
  classifyPatchOutcome,
  freezeSaveAttempt,
  reconcileSaveAttempt,
  sameRoleSemantics,
  semanticSnapshot,
  serializeStoredColumn,
  type StoredRolePatchBody,
} from "../plannerSaveModel";
import type { StoredGridColumn, StoredGridRow } from "../storedRoleReadModel";

const column: StoredGridColumn = {
  columnId: "role-1",
  roleId: "role-1",
  rev: "rev-1",
  lockRev: "lock-rev-1",
  type: "sunday_role",
  date: "2026-02-01",
  published: false,
  admission: "approved",
};

const rows: StoredGridRow[] = [
  { id: "lead", label: "Lead", category: "voz", target: 2 },
  { id: "bgv", label: "BGV", category: "voz", target: 3 },
  { id: "coro", label: "Coro", category: "voz", target: 3 },
  { id: "instrumento:Percusión", label: "Percusión", writeLabel: "Percusión", category: "instrumento", target: 1 },
  { id: "instrumento:bass", label: "bass", writeLabel: "bass", category: "instrumento", target: 1 },
  { id: "foh:Streaming", label: "Streaming", writeLabel: "Streaming", category: "foh", target: 1 },
];

const cells: GridCell[] = [
  { columnId: "role-1", rowId: "lead", occupants: [{ memberId: "m1", itemKey: "l1" }, { memberId: "m2", itemKey: "l2" }], origin: "manual" },
  { columnId: "role-1", rowId: "bgv", occupants: [{ memberId: "m3", itemKey: "b1" }], origin: "manual" },
  { columnId: "role-1", rowId: "coro", occupants: [{ memberId: "m4", itemKey: "c1" }], origin: "manual" },
  { columnId: "role-1", rowId: "instrumento:Percusión", occupants: [{ memberId: "m5", itemKey: "i1" }, { memberId: "m6", itemKey: "i2" }], origin: "manual" },
  { columnId: "role-1", rowId: "instrumento:bass", occupants: [{ memberId: "m7", itemKey: "i3" }], origin: "manual" },
  { columnId: "role-1", rowId: "foh:Streaming", occupants: [{ memberId: "m8", itemKey: "f1" }], origin: "manual" },
  { columnId: "same-date-decoy", rowId: "lead", occupants: [{ memberId: "wrong" }], origin: "manual" },
];

function body(overrides: Partial<StoredRolePatchBody> = {}): StoredRolePatchBody {
  return {
    rev: "rev-1",
    _type: "sunday_role",
    date: "2026-02-01",
    leads: ["m1", "m2"],
    bgvs: ["m3"],
    chorus: ["m4"],
    instruments: [
      { instrument: "Percusión", personId: "m5" },
      { instrument: "Percusión", personId: "m6" },
      { instrument: "bass", personId: "m7" },
    ],
    foh: [{ role: "Streaming", personId: "m8" }],
    ...overrides,
  };
}

describe("plannerSaveModel", () => {
  it("serializes every stored field from one role-ID column and ignores same-date decoys", () => {
    const result = serializeStoredColumn(column, rows, cells);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("unreachable");
    expect(result.body).toEqual({ ...body(), lockRev: "lock-rev-1" });
    expect(JSON.stringify(result.body)).not.toContain("wrong");
  });

  it("compares canonical editable semantics while preserving duplicates and label case", () => {
    const original = semanticSnapshot(body());
    const reordered = semanticSnapshot(body({
      leads: ["m2", "m1"],
      instruments: [...body().instruments].reverse(),
    }));
    expect(sameRoleSemantics(original, reordered)).toBe(true);
    expect(sameRoleSemantics(original, semanticSnapshot(body({ leads: ["m1"] })))).toBe(false);
    expect(sameRoleSemantics(original, semanticSnapshot(body({
      instruments: body().instruments.map((item) =>
        item.instrument === "bass" ? { ...item, instrument: "Bass" } : item),
    })))).toBe(false);
  });

  it("freezes exact retry bytes and the intended snapshot", () => {
    const serialized = serializeStoredColumn(column, rows, cells);
    if (!serialized.ok) throw new Error("unreachable");
    const attempt = freezeSaveAttempt("attempt-1", column, serialized);
    expect(attempt).toMatchObject({ attemptId: "attempt-1", roleId: "role-1", observedRev: "rev-1" });
    expect(attempt.exactBodyBytes).toBe(freezeSaveAttempt("attempt-1", column, serialized).exactBodyBytes);
  });

  it("classifies 2xx as committed and transport/5xx/malformed failures as unknown", () => {
    expect(classifyPatchOutcome({ status: 200, body: {} }).kind).toBe("knownCommitted");
    expect(classifyPatchOutcome({ status: 503, body: { error: "failed" } }).kind).toBe("unknown");
    expect(classifyPatchOutcome({ status: 409, body: {} }).kind).toBe("unknown");
    expect(classifyPatchOutcome({ transportError: true }).kind).toBe("unknown");
    expect(classifyPatchOutcome({ status: 409, body: { error: "bootstrap_completed_reload" } }).kind)
      .toBe("maintenanceReload");
    expect(classifyPatchOutcome({ status: 409, body: { error: "stale_revision" } })).toEqual({
      kind: "knownFailure",
      code: "stale_revision",
    });
  });

  it("does not adopt a concurrent overwrite as successful clean state", () => {
    const serialized = serializeStoredColumn(column, rows, cells);
    if (!serialized.ok) throw new Error("unreachable");
    const attempt = freezeSaveAttempt("attempt-1", column, serialized);
    const remote = semanticSnapshot(body({ leads: ["concurrent-admin"] }));
    expect(reconcileSaveAttempt({
      attempt,
      transport: { kind: "knownCommitted" },
      observed: { rev: "rev-after-overwrite", snapshot: remote },
    })).toEqual({
      kind: "committedThenSuperseded",
      intended: attempt.intendedSnapshot,
      observed: remote,
    });
  });

  it("adopts only exact canonical readback and keeps unknown mismatches frozen", () => {
    const serialized = serializeStoredColumn(column, rows, cells);
    if (!serialized.ok) throw new Error("unreachable");
    const attempt = freezeSaveAttempt("attempt-1", column, serialized);
    expect(reconcileSaveAttempt({
      attempt,
      transport: { kind: "unknown" },
      observed: { rev: "rev-applied", snapshot: attempt.intendedSnapshot },
    }).kind).toBe("applied");
    expect(reconcileSaveAttempt({
      attempt,
      transport: { kind: "unknown" },
      observed: { rev: "rev-other", snapshot: semanticSnapshot(body({ leads: ["other"] })) },
    }).kind).toBe("unknownConflict");
    expect(reconcileSaveAttempt({
      attempt,
      transport: { kind: "unknown" },
      observed: null,
    }).kind).toBe("unresolved");
  });
});

describe("special-service time", () => {
  const specialCells: GridCell[] = cells.map((cell) => ({ ...cell, columnId: "special-1" }));
  const special: StoredGridColumn = { ...column, columnId: "special-1", roleId: "special-1", type: "special_role", serviceName: "Campamento · Alabanza" };

  it("emits the time in the PATCH body and the snapshot, and its absence as null", () => {
    const timed = serializeStoredColumn({ ...special, time: "09:00" }, rows, specialCells);
    expect(timed.ok).toBe(true);
    if (timed.ok) {
      expect(timed.body.time).toBe("09:00");
      expect(timed.snapshot.time).toBe("09:00");
    }
    const untimed = serializeStoredColumn(special, rows, specialCells);
    expect(untimed.ok).toBe(true);
    if (untimed.ok) {
      expect("time" in untimed.body).toBe(false);
      expect(untimed.snapshot.time).toBeNull();
    }
  });

  it("a changed time is a semantic change", () => {
    const a = serializeStoredColumn({ ...special, time: "09:00" }, rows, specialCells);
    const b = serializeStoredColumn({ ...special, time: "12:30" }, rows, specialCells);
    expect(a.ok && b.ok && sameRoleSemantics(a.snapshot, b.snapshot)).toBe(false);
  });

  it("refuses a malformed time instead of sending it", () => {
    const bad = serializeStoredColumn({ ...special, time: "9:00" }, rows, specialCells);
    expect(bad).toMatchObject({ ok: false, reasons: ["invalid_special_time"] });
  });

  it("a weekend column never carries a time", () => {
    const weekend = serializeStoredColumn({ ...column, time: "09:00" }, rows, cells);
    expect(weekend.ok).toBe(true);
    if (weekend.ok) {
      expect("time" in weekend.body).toBe(false);
      expect(weekend.snapshot.time).toBeNull();
    }
  });
});
