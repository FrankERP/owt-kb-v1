// MCP P4 step 4 — `planV3Month`, the month planner's core, over injected transports: the setup
// refusals that read nothing (M4–M6), the four reads and their agreement (M1), the ledger read
// bounded at 20 s exactly as the browser's (RQ-1), the D5 time budget, D8 (a failed solve is a
// failure with no plan) and a success's plan. The shared functions it composes are pinned by
// their own suites; this pins the composition.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { MCP_SOLVE_MAX_MS, MCP_SOLVE_MIN_MS, horizonRoleIds, planV3Month, type V3MonthPlanInput } from "../v3MonthPlan";
import type { V3PlanSources } from "../v3MonthPlanReads";
import type { ServiceRole } from "@/app/components/admin/serviceCardModel";
import type { V3SolveRequest } from "@/app/components/admin/v3Wire";
import { V3_LEDGER_TIMEOUT_MS } from "@/app/components/admin/v3AutoRun";
import { MEMBERS } from "@/app/components/admin/__tests__/v3Fixtures";
import { POOLS, deps, snapshot, sources, successFor } from "./v3MonthPlanFixtures";

afterEach(() => vi.useRealTimers());

const NOV: V3MonthPlanInput = { month: "2026-11", months: 1 };

describe("setup refusals read nothing (M4–M6)", () => {
  it.each([
    ["a malformed month", { month: "2026-13", months: 1 }, "month"],
    ["a year before the planner's bounds", { month: "2023-11", months: 1 }, "month"],
    ["a horizon of three months", { month: "2026-11", months: 3 }, "months"],
    ["an excluded Sunday outside the horizon", { ...NOV, excludeSundays: ["2026-12-06"] }, "exclusion_not_weekend_of_horizon"],
    ["an excluded Saturday that is a Sunday", { ...NOV, excludeSaturdays: ["2026-11-01"] }, "exclusion_not_weekend_of_horizon"],
    ["an exclusion named twice", { ...NOV, excludeSundays: ["2026-11-01", "2026-11-01"] }, "exclusion_not_weekend_of_horizon"],
    ["a special outside the horizon", { ...NOV, specials: [{ date: "2026-12-02", name: "Noche" }] }, "special_not_in_horizon"],
  ])("%s", async (_name, input, detail) => {
    const d = deps();
    expect(await planV3Month(input as V3MonthPlanInput, d)).toEqual({ kind: "invalid", detail });
    expect(d.reads).not.toHaveBeenCalled();
  });
});

describe("the reads (M1)", () => {
  it("a failed read names its sources and solves nothing", async () => {
    const d = deps({ reads: vi.fn(async () => ({ ok: false as const, failed: ["members", "rules"] })) });
    expect(await planV3Month(NOV, d)).toEqual({ kind: "sources", failed: ["members", "rules"] });
    expect(d.readLedger).not.toHaveBeenCalled();
    expect(d.solve).not.toHaveBeenCalled();
  });

  it("a snapshot domain that is not ready refuses, naming it", async () => {
    const d = deps({ reads: vi.fn(async () => ({ ok: true as const, value: sources({ snapshot: snapshot({ sources: { proposals: "error" } }) }) })) });
    expect(await planV3Month(NOV, d)).toEqual({ kind: "sources", failed: ["proposals"] });
    expect(d.solve).not.toHaveBeenCalled();
  });

  it("admin rows and snapshot rows that disagree on the horizon's services refuse as `roles`", async () => {
    const landed = { _id: "role-new", _type: "sunday_role", date: "2026-11-08" };
    const d = deps({
      reads: vi.fn(async () => ({ ok: true as const, value: sources({ adminRoles: [landed] as unknown as ServiceRole[], snapshot: snapshot() }) })),
    });
    expect(await planV3Month(NOV, d)).toEqual({ kind: "sources", failed: ["roles"] });
    expect(d.readLedger).not.toHaveBeenCalled();
  });

  it("horizonRoleIds keys a row by coalesce(week, date) and keeps only the horizon's", () => {
    const rows = [
      { _id: "b", week: "2026-11-08T12:00:00Z", date: "2026-10-31" },
      { _id: "a", date: "2026-11-20" },
      { _id: "c", date: "2026-12-06" },
    ];
    expect(horizonRoleIds(rows, ["2026-11"])).toEqual(["a", "b"]);
  });
});

describe("RQ-1 and D5", () => {
  it("a ledger read that never settles refuses at 20 s and never calls the solver", async () => {
    vi.useFakeTimers();
    const d = deps({ readLedger: vi.fn(() => new Promise<never>(() => {})) });
    const pending = planV3Month(NOV, d);
    await vi.advanceTimersByTimeAsync(V3_LEDGER_TIMEOUT_MS);
    const out = await pending;
    expect(out).toMatchObject({ kind: "refused" });
    if (out.kind !== "refused") throw new Error("expected refused");
    expect(out.lines[0]).toBe("No se pudo leer el saldo de equidad. Auto no corrió; vuelve a intentar.");
    expect(d.solve).not.toHaveBeenCalled();
  });

  it("the solve's timeout is clamped to the soft deadline and capped at 45 s", async () => {
    const early = deps({ elapsedMs: () => 1_000 });
    await planV3Month(NOV, early);
    expect(early.solve.mock.calls[0][1]).toBe(MCP_SOLVE_MAX_MS);

    const late = deps({ elapsedMs: () => 30_000 });
    await planV3Month(NOV, late);
    expect(late.solve.mock.calls[0][1]).toBe(52_000 - 30_000 - 4_000);
  });

  it("under 10 s left, the solver is not called (time_budget)", async () => {
    const d = deps({ elapsedMs: () => 52_000 - 4_000 - MCP_SOLVE_MIN_MS + 1 });
    expect(await planV3Month(NOV, d)).toEqual({ kind: "time_budget" });
    expect(d.solve).not.toHaveBeenCalled();
  });
});

describe("D8 — a failed solve is a failure, never a plan", () => {
  it("a 500 is `failed` with AD-6's retry and no plan", async () => {
    const d = deps({ solve: vi.fn(async () => ({ status: 500, text: JSON.stringify({ error: "boom" }) })) });
    const out = await planV3Month(NOV, d);
    expect(out).toMatchObject({ kind: "failed", retry: true });
    expect("plan" in out).toBe(false);
  });

  it("a solver refusal is `failed` with no retry", async () => {
    const refusal = JSON.stringify({ ok: false, contract: 3, engine: "v3", code: "infeasible", params: {} });
    const out = await planV3Month(NOV, deps({ solve: vi.fn(async () => ({ status: 422, text: refusal })) }));
    expect(out).toMatchObject({ kind: "failed", retry: false });
  });
});

describe("success", () => {
  it("plans the selected weekends and the accepted specials, with the rules' revision and the frozen entries", async () => {
    const input: V3MonthPlanInput = {
      ...NOV,
      excludeSaturdays: ["2026-11-28"],
      specials: [
        { date: "2026-11-18", name: "  Noche de alabanza  " },
        { date: "2026-11-14", name: "Boda" },
        { date: "2026-11-25", name: "   " },
      ],
    };
    let sent: V3SolveRequest | null = null;
    const d = deps({
      solve: vi.fn(async (request: V3SolveRequest) => {
        sent = request;
        return { status: 200, text: successFor(request, { [request.services[0].id]: { Lead: ["m-ana"] } }) };
      }),
    });
    const out = await planV3Month(input, d);
    if (out.kind !== "success") throw new Error(`expected success, got ${JSON.stringify(out)}`);
    const { plan } = out;

    expect(plan.months).toEqual(["2026-11"]);
    expect(plan.rulesRev).toBe("rules-rev-1");
    expect(plan.requestId).toBe("req-1");
    expect(plan.entries.map((e) => e.month)).toEqual(["2026-11"]);
    expect(plan.storedServiceIds).toEqual([]);

    // Five Sundays, three Saturdays (the 28th excluded), one special; the Saturday special and
    // the nameless one are refused by the composer's own copy.
    const kinds = plan.drafts.map((p) => `${p.draft._type}:${p.draft.date}`);
    expect(kinds.filter((k) => k.startsWith("sunday_role"))).toHaveLength(5);
    expect(kinds.filter((k) => k.startsWith("saturday_role"))).toEqual([
      "saturday_role:2026-11-07", "saturday_role:2026-11-14", "saturday_role:2026-11-21",
    ]);
    expect(kinds).toContain("special_role:2026-11-18");
    expect(plan.drafts.every((p) => p.atSolve === "creatable")).toBe(true);
    expect(plan.refusedSpecials.map((r) => r.date)).toEqual(["2026-11-14", "2026-11-25"]);
    expect(plan.refusedSpecials[1].reason).toBe("Escribe un nombre para el servicio especial.");
    expect(plan.drafts.find((p) => p.draft._type === "special_role")?.draft.service_name).toBe("Noche de alabanza");

    // Every draft carries a creation request id, and the solver's seat landed on its service.
    expect(plan.drafts.every((p) => typeof p.draft.creationRequestId === "string" && p.draft.creationRequestId.length > 0)).toBe(true);
    expect(sent).not.toBeNull();
    const first = sent!.services[0].id;
    expect(plan.cells.find((c) => c.columnId === first && c.rowId === "lead")?.occupants).toEqual([{ memberId: "m-ana" }]);
    expect(d.readLedger).toHaveBeenCalledWith(["2026-11"]);
  });

  it("reports unavailability for worship members only (M15, I5)", async () => {
    const kidsOnly = { _id: "m-kid", member_name: "Kiki Paz", ministries: ["kids"], unavailableDates: ["2026-11-01"] };
    const ana = { ...MEMBERS[0], unavailableDates: ["2026-11-08"] };
    const members = [ana, ...MEMBERS.slice(1), kidsOnly] as unknown as V3PlanSources["members"];
    const d = deps({ reads: vi.fn(async () => ({ ok: true as const, value: sources({ members }) })) });
    const out = await planV3Month(NOV, d);
    if (out.kind !== "success") throw new Error("expected success");
    expect(out.plan.unavailability).toEqual([{ name: "Ana", date: "2026-11-08", service: "Dom" }]);
  });

  it("the defaults solve with a null revision", async () => {
    const d = deps({ reads: vi.fn(async () => ({ ok: true as const, value: sources({ rules: { rev: null, config: POOLS } }) })) });
    const out = await planV3Month(NOV, d);
    expect(out.kind === "success" && out.plan.rulesRev).toBeNull();
  });
});
