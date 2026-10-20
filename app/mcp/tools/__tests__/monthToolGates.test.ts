// MCP P4 step 7 — gate replay: every row of the plan's two «Admin surface gates» tables, each
// proven where it is cheapest to prove. Rows proven elsewhere are listed here with the suite that
// proves them, so this file is the one index of the tables; the rest are tested below.
//
// solve_month
//   M1  sources ready, inventory coherent ..... v3MonthPlan.test.ts «the reads (M1)»
//   M2  rules: failed read refuses; absent = defaults, rev null
//                                               v3MonthPlan.test.ts «the defaults solve with a null revision»; M1's failed read
//   M3  HZ-7 / HZ-9 / WN-2 before the solve .... below
//   M4  1–2 months, YYYY-MM in bounds ......... solveMonth.test.ts (schema); v3MonthPlan.test.ts (M4–M6)
//   M5  exclusions are the horizon's weekends .. v3MonthPlan.test.ts (M4–M6)
//   M6  specials: horizon day, name, composer .. v3MonthPlan.test.ts (success: refused specials)
//   M7  at least one column .................... below
//   M8  one column per date .................... v3MonthPlan.test.ts (success: one draft per date)
//   M9  only creatable targets are planned ..... monthToolParity.test.tsx («not creatable»)
//   M10 the ledger read, ≤ 20 s, fail refuses .. v3MonthPlan.test.ts «RQ-1 and D5»; below (a failed read)
//   M11 buildV3SolveRequest's refusals ......... below (a cadence rule naming nobody)
//   M12 declared (D8): no fills on failure ..... solveMonth.test.ts «D8»
//   M13 handshake, apply by id, fills .......... monthToolParity.test.tsx (all cases)
//   M14 declared narrowing ..................... (no connector spelling; nothing to test)
//   M15 unavailability, worship only ........... v3MonthPlan.test.ts (M15, I5)
//   M16 run report ............................. solveMonth.test.ts («success»: report by name)
// apply_schedule
//   A1  sources ready at confirm ............... applySchedule.test.ts («an unready source»)
//   A2  only creatable-at-solve drafts ......... monthToolParity.test.tsx («not creatable»: never posted)
//   A3  nameless special ....................... proposalDocument.test.ts (the parser refuses it)
//   A4  fresh preflight aborts the whole call .. applySchedule.test.ts («recovery across calls», A4 rows)
//   A5  CF-1, CF-4, CF-5, CF-7 ................. applySchedule.test.ts (guard, CF-4 table, cut-off, replay)
//   A6  the create route's refusals ............ below
//   A7  always drafts .......................... applySchedule.test.ts (happy path: `published: false`)
//   A8  declared: no history dual-write ........ (nothing reads it under v3; nothing to test)
//   A9  rules changed .......................... applySchedule.test.ts (D11)
//   A10 engine not v3 .......................... applySchedule.test.ts, solveMonth.test.ts
//   A11 unknown/expired/foreign proposal ....... applySchedule.test.ts (D10)
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/sanity/env", () => ({ apiVersion: "2024-07-23", dataset: "test", projectId: "test" }));

import { V3_CONNECTOR_LINES as L, V3_LINES } from "@/app/components/admin/v3Copy";
import { config, restriction } from "@/app/components/admin/__tests__/v3Fixtures";
import { sources } from "@/app/utils/__tests__/v3MonthPlanFixtures";
import { applyScheduleResult } from "../applySchedule";
import { solveMonthResult } from "../solveMonth";
import { draftLabel } from "../../monthProposals/labels";
import { HANDLE, PRINCIPAL, applyWorld, solveDeps, storedFrom, textOf } from "./monthToolFixtures";

describe("solve_month rows", () => {
  it("M3: a past month refuses with the planner's line; nothing solved, nothing stored", async () => {
    const d = solveDeps();
    const out = await solveMonthResult({ month: "2026-09" }, PRINCIPAL, d);
    expect(out.isError).toBe(true);
    expect(textOf(out)).toContain(V3_LINES.horizonPast);
    expect(d.solve).not.toHaveBeenCalled();
    expect(d.createProposal).not.toHaveBeenCalled();
  });

  it("M3: a month past the ceiling refuses", async () => {
    const d = solveDeps();
    const out = await solveMonthResult({ month: "2027-11" }, PRINCIPAL, d);
    expect(out.isError).toBe(true);
    expect(textOf(out)).toContain(V3_LINES.horizonCeiling("2027-11", "2027-10"));
    expect(d.solve).not.toHaveBeenCalled();
    expect(d.createProposal).not.toHaveBeenCalled();
  });

  it("M7: no column left refuses as no_columns", async () => {
    const d = solveDeps();
    const out = await solveMonthResult({
      month: "2026-11",
      excludeSundays: ["2026-11-01", "2026-11-08", "2026-11-15", "2026-11-22", "2026-11-29"],
      excludeSaturdays: ["2026-11-07", "2026-11-14", "2026-11-21", "2026-11-28"],
    }, PRINCIPAL, d);
    expect(textOf(out)).toContain(L.invalid.no_columns);
    expect(out.structuredContent).toMatchObject({ detail: "no_columns" });
    expect(d.solve).not.toHaveBeenCalled();
    expect(d.createProposal).not.toHaveBeenCalled();
  });

  it("M10: a failed ledger read refuses; nothing solved, nothing stored", async () => {
    const d = solveDeps({ readLedger: vi.fn(async () => { throw new Error("ledger"); }) });
    const out = await solveMonthResult({ month: "2026-11" }, PRINCIPAL, d);
    expect(out.isError).toBe(true);
    expect(textOf(out)).toContain(L.noProposalStored);
    expect(d.solve).not.toHaveBeenCalled();
    expect(d.createProposal).not.toHaveBeenCalled();
  });

  it("M11: a refusal of the shared request builder (a «Mes por medio» rule naming nobody) is the planner's own line", async () => {
    const rules = config({
      sundayLeads: ["m-ana", "m-bruno"], saturdayLeads: ["m-carla"], support: ["m-dani"],
      restrictions: [restriction("r-1", "Nadie", { sundayCadence: "alternate" })],
    });
    const d = solveDeps({ reads: vi.fn(async () => ({ ok: true as const, value: sources({ rules: { rev: "rules-rev-1", config: rules } }) })) });
    const out = await solveMonthResult({ month: "2026-11" }, PRINCIPAL, d);
    expect(out.isError).toBe(true);
    expect(textOf(out)).toContain(V3_LINES.cadenceName("Nadie", V3_LINES.cadenceNameNone));
    expect(d.solve).not.toHaveBeenCalled();
    expect(d.createProposal).not.toHaveBeenCalled();
  });
});

describe("apply_schedule rows", () => {
  it("A6: a create the roles route refuses is «rechazado» with the route's reason; later months are blocked", async () => {
    const d = solveDeps();
    await solveMonthResult({ month: "2026-11", months: 2 }, PRINCIPAL, d);
    const proposal = storedFrom(d.stored[0]);
    const w = applyWorld(proposal);
    const first = proposal.payload.drafts.map((p) => p.draft).sort((a, b) => a.date.localeCompare(b.date))[0];
    const real = w.deps.createRole.getMockImplementation() as (body: unknown) => Promise<unknown>;
    w.deps.createRole.mockImplementation(async (body: { creationRequestId: string }) =>
      body.creationRequestId === first.creationRequestId
        ? { ok: false, status: 409, body: { error: "integrity_conflict", details: { detail: "target_occupied" } } }
        : real(body));
    const out = await applyScheduleResult({ proposal: HANDLE }, PRINCIPAL, w.deps);
    const text = textOf(out);
    expect(text).toMatch(new RegExp(`^${draftLabel(first)}: rechazado\\. `, "m"));
    expect(text).toContain(L.serviceBlocked(draftLabel(proposal.payload.drafts.find((p) => p.draft.date.startsWith("2026-12"))!.draft)));
    expect(out.structuredContent).toMatchObject({ complete: false, next: "solve_month" });
    // No December draft was posted (CF-5).
    const posted = w.deps.createRole.mock.calls.map(([b]) => (b as { date: string }).date);
    expect(posted.some((date) => date.startsWith("2026-12"))).toBe(false);
    expect(text).not.toMatch(/falló|No se creó nada|otro administrador/);
  });
});
