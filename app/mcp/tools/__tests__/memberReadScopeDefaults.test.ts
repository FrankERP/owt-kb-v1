// MCP slice B §3.4b, the two member reads that do not run through an injected `deps.reads`:
// `get_solver_rules`' registered handler binds the members GET's scope from the call's LIVE tier,
// and the availability sweep (no MCP caller, no tier) reads every ministry, exactly as before slice B.
// Its own file because it replaces the real readers with spies.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/sanity/env", () => ({ apiVersion: "2024-07-23", dataset: "test", projectId: "test" }));

const fetchSpy = vi.hoisted(() => vi.fn(async () => [] as unknown[]));
const loadSourcesSpy = vi.hoisted(() => vi.fn(async () => ({ ok: true as const, value: {} })));

vi.mock("@/sanity/lib/operationalClient", () => ({ operationalClient: { fetch: fetchSpy } }));
vi.mock("@/app/utils/v3MonthPlanReads", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/utils/v3MonthPlanReads")>()),
  readRules: vi.fn(async () => ({ rev: "r1", config: { version: 1, rules: [], pools: {} } })),
  loadV3PlanSources: loadSourcesSpy,
}));

import { registerGetSolverRules } from "../getSolverRules";
import { defaultAvailabilityDeps } from "@/app/utils/availabilityFixCommit";

type Handler = (args: unknown, ctx: unknown) => Promise<unknown>;

function solverRulesHandler(): Handler {
  let handler: Handler | null = null;
  registerGetSolverRules({ registerTool: (_name: string, _config: unknown, h: Handler) => { handler = h; } } as never);
  if (!handler) throw new Error("get_solver_rules did not register");
  return handler;
}

const ctxOfTier = (tier: unknown) => ({ http: { authInfo: { extra: { sub: "m-1", tier }, resource: new URL("https://owt.example/api/mcp") } } });

beforeEach(() => {
  fetchSpy.mockClear();
  loadSourcesSpy.mockClear();
});

describe("get_solver_rules binds the member read from the live tier", () => {
  it.each([
    ["full", true],
    ["admin", false],
    [undefined, false],
    ["something-else", false],
  ])("tier %s → all = %s", async (tier, all) => {
    await solverRulesHandler()({}, ctxOfTier(tier));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]).toEqual([expect.any(String), { all }]);
  });
});

describe("the availability sweep keeps reading every ministry", () => {
  it("defaultAvailabilityDeps().reads() asks loadV3PlanSources for allMembers: true", async () => {
    await defaultAvailabilityDeps().reads();
    expect(loadSourcesSpy).toHaveBeenCalledTimes(1);
    expect(loadSourcesSpy).toHaveBeenCalledWith({ allMembers: true });
  });
});
