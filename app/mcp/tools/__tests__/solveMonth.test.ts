// `solve_month` (P4 on solver v3, step 6): the engine gate and the principal before any read,
// D8 (every exit but success stores nothing), the D5 budget, the store (`create` only, inside
// `callDomain`), the D12 sweep and its deadline, and the D14 report's key hygiene. The planning
// itself is the REAL `planV3Month` over the planner fixtures (`v3MonthPlan.test.ts` pins it).
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// The tools import the store and the reads, which build Sanity clients at import (never called here).
vi.mock("@/sanity/env", () => ({ apiVersion: "2024-07-23", dataset: "test", projectId: "test", useCdn: false }));

import { V3_CONNECTOR_LINES as L } from "@/app/components/admin/v3Copy";
import { planV3Month } from "@/app/utils/v3MonthPlan";
import { SOLVE_MONTH_COPY, SOLVE_MONTH_INPUT, SWEEP_DEADLINE_MS, solveMonthResult } from "../solveMonth";
import { parseProposal } from "../../monthProposals/proposalDocument";
import { BASE_MS, HANDLE, PRINCIPAL, solveDeps, textOf } from "./monthToolFixtures";

const NOV = { month: "2026-11" };

describe("the gate, before any read", () => {
  it("no principal refuses and reads nothing", async () => {
    const d = solveDeps();
    const out = await solveMonthResult(NOV, null, d);
    expect(out.isError).toBe(true);
    expect(textOf(out)).toContain(L.noPrincipal);
    expect(d.reads).not.toHaveBeenCalled();
    expect(d.createProposal).not.toHaveBeenCalled();
  });

  it("engine v2 refuses (D2) and reads nothing", async () => {
    const d = solveDeps({ engine: () => "v2" });
    const out = await solveMonthResult(NOV, PRINCIPAL, d);
    expect(out.isError).toBe(true);
    expect(textOf(out)).toContain(L.engineNotV3);
    expect(out.structuredContent).toMatchObject({ refused: true, detail: "engine_not_v3" });
    expect(d.reads).not.toHaveBeenCalled();
  });

  it("the input schema is strict and bounded", () => {
    expect(SOLVE_MONTH_INPUT.safeParse({ month: "2026-11", extra: 1 }).success).toBe(false);
    expect(SOLVE_MONTH_INPUT.safeParse({ month: "2026-11", months: 3 }).success).toBe(false);
    expect(SOLVE_MONTH_INPUT.safeParse({ month: "nov" }).success).toBe(false);
    expect(SOLVE_MONTH_INPUT.safeParse({ month: "2026-11", specials: [{ date: "2026-11-18", name: "x".repeat(81) }] }).success).toBe(false);
    expect(SOLVE_MONTH_INPUT.safeParse({ month: "2026-11", months: 2, excludeSundays: ["2026-11-01"] }).success).toBe(true);
  });
});

describe("D8 — every exit but success stores nothing", () => {
  it("an invalid exclusion is refused with the planner's copy", async () => {
    const d = solveDeps();
    const out = await solveMonthResult({ ...NOV, excludeSaturdays: ["2026-11-01"] }, PRINCIPAL, d);
    expect(out.isError).toBe(true);
    expect(textOf(out)).toContain(L.invalid.exclusion_not_weekend_of_horizon);
    expect(d.reads).not.toHaveBeenCalled();
    expect(d.createProposal).not.toHaveBeenCalled();
  });

  it("a solver 500 stores nothing and offers a retry", async () => {
    const d = solveDeps({ solve: vi.fn(async () => ({ status: 500, text: "{}" })) });
    const out = await solveMonthResult(NOV, PRINCIPAL, d);
    expect(out.isError).toBe(true);
    expect(textOf(out)).toContain(L.noProposalStored);
    expect(out.structuredContent).toMatchObject({ code: "solve_failed", retry: true });
    expect(d.createProposal).not.toHaveBeenCalled();
    expect(d.sweepExpired).not.toHaveBeenCalled();
  });

  it("a failed read names its sources and stores nothing", async () => {
    const d = solveDeps({ reads: vi.fn(async () => ({ ok: false as const, failed: ["members"] })) });
    const out = await solveMonthResult(NOV, PRINCIPAL, d);
    expect(out.structuredContent).toMatchObject({ code: "integrity_conflict", detail: "sources", retry: true });
    expect(d.createProposal).not.toHaveBeenCalled();
  });

  it("D5: with too little of the call left the solver is not called", async () => {
    let calls = 0;
    const d = solveDeps({ nowMs: () => BASE_MS + (calls++ === 0 ? 0 : 45_000) });
    const out = await solveMonthResult(NOV, PRINCIPAL, d);
    expect(textOf(out)).toBe(L.timeBudget);
    expect(out.structuredContent).toMatchObject({ code: "time_budget", retry: true });
    expect(d.solve).not.toHaveBeenCalled();
    expect(d.createProposal).not.toHaveBeenCalled();
  });

  it("a plan with nothing creatable stores nothing", async () => {
    const d = solveDeps({
      plan: async (input, deps) => {
        const out = await planV3Month(input, deps);
        if (out.kind !== "success") return out;
        return { ...out, plan: { ...out.plan, drafts: out.plan.drafts.map((p) => ({ ...p, atSolve: "exists" as const })) } };
      },
    });
    const out = await solveMonthResult(NOV, PRINCIPAL, d);
    expect(out.isError).toBeFalsy();
    expect(textOf(out).split("\n")[0]).toBe(L.nothingToCreate);
    expect(out.structuredContent).toMatchObject({ proposal: null, stored: false });
    expect(d.createProposal).not.toHaveBeenCalled();
  });
});

describe("success", () => {
  it("stores one proposal bound to the caller, sweeps, and reports by name", async () => {
    const d = solveDeps();
    const out = await solveMonthResult(NOV, PRINCIPAL, d);
    expect(out.isError).toBeFalsy();
    expect(d.createProposal).toHaveBeenCalledTimes(1);
    expect(d.sweepExpired).toHaveBeenCalledTimes(1);

    const doc = d.stored[0];
    const stored = parseProposal({ ...doc, _rev: "r" });
    expect(stored).not.toBeNull();
    expect(stored!.header).toMatchObject({ origin: PRINCIPAL.origin, principal: PRINCIPAL.sub, months: ["2026-11"], rulesRev: "rules-rev-1", requestId: "req-1" });
    expect(Date.parse(stored!.header.expiresAt) - BASE_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(stored!.payload.drafts.filter((p) => p.atSolve === "creatable")).toHaveLength(9);

    const text = textOf(out);
    expect(text.split("\n")[0]).toContain(`Propuesta ${HANDLE}`);
    expect(text).toContain("Ana");
    expect(out.structuredContent).toMatchObject({ ok: true, proposal: HANDLE, stored: true, months: ["2026-11"] });

    // Key hygiene: no member id, rule key, role id or caller id in what the model reads.
    const all = `${text}\n${JSON.stringify(out.structuredContent)}`;
    expect(all).not.toMatch(/\bm-(ana|bruno|carla|dani|admin)\b/);
    expect(all).not.toContain("rules-rev");
  });

  it("a failed store answers the report WITHOUT a handle and skips the sweep", async () => {
    const d = solveDeps({ createProposal: vi.fn(async () => ({ ok: false as const, reason: "server_error" as const, cause: new Error("x") })) });
    const out = await solveMonthResult(NOV, PRINCIPAL, d);
    const text = textOf(out);
    expect(text.split("\n")[0]).toBe(L.storeFailed);
    expect(text).not.toContain(HANDLE);
    expect(out.structuredContent).toMatchObject({ proposal: null, stored: false });
    expect(d.sweepExpired).not.toHaveBeenCalled();
  });

  it("a store that throws is the domain side: the outcome is unknown, never «no se guardó»", async () => {
    const d = solveDeps({ createProposal: vi.fn(async () => { throw new Error("socket"); }) });
    const out = await solveMonthResult(NOV, PRINCIPAL, d);
    expect(out.isError).toBe(true);
    expect(textOf(out)).toBe(SOLVE_MONTH_COPY.domain);
  });

  it("D12: no sweep once 45 s of the call have passed", async () => {
    const clock = { t: BASE_MS };
    const d = solveDeps({ nowMs: () => clock.t });
    const solve = d.solve;
    d.solve = vi.fn(async (request, timeoutMs) => {
      clock.t += SWEEP_DEADLINE_MS + 1_000;
      return solve(request, timeoutMs);
    });
    const out = await solveMonthResult(NOV, PRINCIPAL, d);
    expect(out.structuredContent).toMatchObject({ stored: true });
    expect(d.createProposal).toHaveBeenCalledTimes(1);
    expect(d.sweepExpired).not.toHaveBeenCalled();
  });

  it("a failed sweep never fails the call", async () => {
    const d = solveDeps({ sweepExpired: vi.fn(async () => ({ ok: false as const, reason: "server_error" as const, cause: null })) });
    const out = await solveMonthResult(NOV, PRINCIPAL, d);
    expect(out.isError).toBeFalsy();
    expect(out.structuredContent).toMatchObject({ proposal: HANDLE, stored: true });
  });
});
