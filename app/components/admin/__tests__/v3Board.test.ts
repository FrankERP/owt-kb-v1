// MCP P4 step 2 — the v3 board functions lifted out of `MonthGenerator`. Each is pinned on its
// own here; the component's own suites (v3Auto, v3Confirm, localFill/instrumentFill wiring) prove
// the component still behaves as it did with the code inline.
import { describe, expect, it } from "vitest";

import { buildColumns, buildRows, cellsToDrafts, draftTargetKey, type GridCell } from "../plannerModel";
import type { ServiceRole } from "../serviceCardModel";
import type { StoredRoleInventory, StoredRoleObservation } from "../storedRoleReadModel";
import {
  countedSpecialIdsOf,
  runLocalFills,
  settleV3AutoResult,
  v3PlannedColumnsFor,
  v3PlannedCreateColumns,
  v3StoredFor,
  v3TargetOf,
} from "../v3Board";
import { buildV3SolveRequest } from "../v3SolveRequest";
import type { V3Success } from "../v3Wire";
import { MEMBERS, config, ledgerResponse } from "./v3Fixtures";

const NOV_SUNDAYS = ["2026-11-01", "2026-11-08", "2026-11-15", "2026-11-22", "2026-11-29"];
const POOLS = config({ sundayLeads: ["m-ana", "m-bruno"], saturdayLeads: ["m-carla"], support: ["m-dani"] });

const person = (id: string, key: string) => ({ _id: id, _key: key, member_name: id });

function observation(over: Partial<ServiceRole> & Pick<ServiceRole, "_id" | "_type" | "date">): StoredRoleObservation {
  const role = {
    _rev: "rev", published: false, leads: [person("m-ana", "k1")], bgvs: [], chorus: [], instruments: [], foh: [],
    ...over,
  } as unknown as ServiceRole;
  return { role, target: null, admission: "approved", reasons: [], assignedRefs: [] };
}

const inventory = (roles: StoredRoleObservation[], coherent = true): StoredRoleInventory => ({ coherent, reasons: [], roles });

describe("v3TargetOf", () => {
  it("is the type and day for a weekend, and the normalized name for a special (ADR-0011)", () => {
    expect(v3TargetOf({ type: "sunday_role", date: "2026-11-01" })).toBe("sunday_role|2026-11-01");
    expect(v3TargetOf({ type: "special_role", date: "2026-11-20", serviceName: "  Noche  de Alabanza " }))
      .toBe(v3TargetOf({ type: "special_role", date: "2026-11-20", serviceName: "Noche de Alabanza" }));
  });
});

describe("v3StoredFor (ST-1)", () => {
  const nov = observation({ _id: "r-nov", _type: "sunday_role", date: "2026-11-08" });
  const jan = observation({ _id: "r-jan", _type: "sunday_role", date: "2027-01-03" });

  it("keeps only the horizon's stored services, each read-only", () => {
    const out = v3StoredFor({ rolesReady: true, integrityReady: true, inventory: inventory([nov, jan]), horizon: ["2026-11", "2026-12"] });
    expect(out.ready).toBe(true);
    expect(out.translations.map((t) => t.column.columnId)).toEqual(["r-nov"]);
    expect(out.translations[0].column.admission).toBe("readOnly");
  });

  it.each([
    ["the roles read is not ready", { rolesReady: false, integrityReady: true, coherent: true }],
    ["the integrity read is not ready", { rolesReady: true, integrityReady: false, coherent: true }],
    ["the inventory is not coherent", { rolesReady: true, integrityReady: true, coherent: false }],
  ])("is not ready when %s", (_name, s) => {
    expect(v3StoredFor({ rolesReady: s.rolesReady, integrityReady: s.integrityReady, inventory: inventory([nov], s.coherent), horizon: ["2026-11"] }))
      .toEqual({ ready: false, translations: [] });
  });

  it("is not ready when a horizon role's translation is refused (an instrument with no person)", () => {
    const broken = observation({
      _id: "r-bad", _type: "sunday_role", date: "2026-11-15",
      instruments: [{ _key: "i1", instrument: "Bajo", person: null }],
    } as unknown as Partial<ServiceRole> & Pick<ServiceRole, "_id" | "_type" | "date">);
    expect(v3StoredFor({ rolesReady: true, integrityReady: true, inventory: inventory([nov, broken]), horizon: ["2026-11"] }).ready).toBe(false);
  });
});

describe("planned columns (ST-2, RQ-3)", () => {
  const columns = buildColumns({ sundayDates: NOV_SUNDAYS.slice(0, 3), activeSatDates: [], specials: [{ date: "2026-11-20", name: "Noche", countsForFairness: true }] });

  it("drops a planned column whose target a stored service occupies", () => {
    const planned = v3PlannedCreateColumns(columns, new Set(["sunday_role|2026-11-08"]));
    expect(planned.map((c) => c.date)).toEqual(["2026-11-01", "2026-11-15", "2026-11-20"]);
  });

  it("keeps the columns that are not skipped and whose draft is creatable (or has no draft)", () => {
    const drafts = cellsToDrafts([], columns, new Set(), [], []);
    const draftByTarget = new Map(drafts.map((d) => [draftTargetKey(d._type, d.date), d]));
    const blocked = draftTargetKey("sunday_role", "2026-11-15");
    const out = v3PlannedColumnsFor({
      columns,
      skippedColumnIds: new Set([columns[0].columnId]),
      draftByTarget,
      isCreatable: (d) => draftTargetKey(d._type, d.date) !== blocked,
    });
    expect(out.map((c) => c.date)).toEqual(["2026-11-08", "2026-11-20"]);
  });

  it("countedSpecialIdsOf names only the specials that count for fairness", () => {
    const uncounted = buildColumns({ sundayDates: [], activeSatDates: [], specials: [{ date: "2026-11-25", name: "Otra", countsForFairness: false }] });
    expect([...countedSpecialIdsOf([...columns, ...uncounted])]).toEqual([columns.find((c) => c.type === "special_role")!.columnId]);
  });
});

describe("runLocalFills", () => {
  const columns = buildColumns({ sundayDates: ["2026-11-01"], activeSatDates: [], specials: [{ date: "2026-11-20", name: "Noche", countsForFairness: false }] });
  const rows = buildRows();
  const special = columns.find((c) => c.type === "special_role")!;

  it("fills an uncounted special and never touches a skipped (counted) one", () => {
    const filled = runLocalFills({ config: POOLS, baseCells: [], columns, rows, members: MEMBERS, savedWindow: [] });
    expect(filled.cells.some((c) => c.columnId === special.columnId && c.occupants.length > 0)).toBe(true);
    const skipped = runLocalFills({ config: POOLS, baseCells: [], columns, rows, members: MEMBERS, savedWindow: [], skipSpecialIds: new Set([special.columnId]) });
    expect(skipped.cells.some((c) => c.columnId === special.columnId)).toBe(false);
  });

  it("starts from the cells it is given and leaves the weekend voices it did not place", () => {
    const sunday = columns.find((c) => c.type === "sunday_role")!;
    const base: GridCell[] = [{ columnId: sunday.columnId, rowId: "lead", occupants: [{ memberId: "m-ana" }], origin: "auto" }];
    const out = runLocalFills({ config: POOLS, baseCells: base, columns, rows, members: MEMBERS, savedWindow: [] });
    expect(out.cells.find((c) => c.columnId === sunday.columnId && c.rowId === "lead")).toEqual(base[0]);
  });
});

describe("settleV3AutoResult", () => {
  const columns = buildColumns({ sundayDates: NOV_SUNDAYS, activeSatDates: [] });
  const rows = buildRows();
  const built = buildV3SolveRequest({
    months: ["2026-11"], currentMonth: "2026-10", ledger: ledgerResponse(["2026-11"]),
    config: POOLS, members: MEMBERS, storedRoles: [],
    planned: { columns, cells: [], rows }, savedWindow: [], fillEmpty: false, seed: 1, requestId: "req",
  });
  if (!built.ok) throw new Error(built.lines.join("\n"));
  const success = (over: Partial<V3Success> = {}): V3Success => ({
    ok: true, contract: 3, engine: "v3", solver_version: "3.1.0", build: "t", request_id: "req", seed: 1, months: ["2026-11"],
    reproducible: true, assignments: {}, unfilled: [], pins: { requested: 0, honored: 0 }, violations: [],
    violation_ceiling: { value: 0, proven: true }, stages: [], total_ms: 1,
    fairness: { scale: 100, tolerance: 35, lines: [], people: [] }, cadence: [], missed: [], notices: [], ...over,
  });

  it("a refusal freezes nothing and splits its lines", () => {
    expect(settleV3AutoResult({ result: { kind: "refused", lines: ["uno", "dos"] }, rows, members: MEMBERS }))
      .toEqual({ kind: "refused", error: "uno", notices: ["dos"] });
  });

  it("a failed solve freezes the entries and keeps AD-6's retry rule", () => {
    const out = settleV3AutoResult({ result: { kind: "solved", build: built, outcome: { kind: "transport", reason: "timeout" } }, rows, members: MEMBERS });
    expect(out).toMatchObject({ kind: "failed", retry: true });
    if (out.kind !== "failed") throw new Error("expected failed");
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0].month).toBe("2026-11");
  });

  it("an assignment for a service the request did not send is a failure with no retry", () => {
    const outcome = { kind: "success" as const, response: success({ assignments: { "not-sent": { Lead: ["m-ana"] } } }) };
    const out = settleV3AutoResult({ result: { kind: "solved", build: built, outcome }, rows, members: MEMBERS });
    expect(out).toMatchObject({ kind: "failed", retry: false });
  });

  it("a success applies by service id and reports C6's notices before the solver's", () => {
    const id = built.request.services[0].id;
    const response = success({ assignments: { [id]: { Lead: ["m-ana"] } }, notices: [] });
    const out = settleV3AutoResult({ result: { kind: "solved", build: built, outcome: { kind: "success", response } }, rows, members: MEMBERS });
    if (out.kind !== "success") throw new Error("expected success");
    expect(out.applied.cells.find((c) => c.columnId === id && c.rowId === "lead")?.occupants).toEqual([{ memberId: "m-ana" }]);
    expect(out.notices).toEqual([...built.notices, ...out.report.solverNotices]);
    expect(out.entries).toHaveLength(1);
  });
});
