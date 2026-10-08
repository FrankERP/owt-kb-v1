// Solver v3 C6 — Auto's v3 orchestration, with injected transports and fake timers: what refuses
// before any read (HZ-7, HZ-9, WN-2, ST-1), the fresh ledger read bounded at 20 s (RQ-1), the build,
// the solve aborted by the client at 58 s (AD-2), and AD-3/AD-4's outcome.
import { afterEach, describe, expect, it, vi } from "vitest";

import { V3_CLIENT_SOLVE_TIMEOUT_MS, V3_LEDGER_TIMEOUT_MS, runV3Auto, type V3AutoDeps } from "../v3AutoRun";
import { preReadRefusals, type V3BuildResult } from "../v3SolveRequest";
import { MEMBERS, config, ledgerResponse } from "./v3Fixtures";

afterEach(() => vi.useRealTimers());

const builtOk = (pins: unknown[] = []) => ({
  ok: true, request: { contract: 3, pins, services: [], months: ["2026-11"] }, cells: [], notices: [], snapshot: { requestId: "r", months: ["2026-11"], sources: [], ruleTable: [] },
  ruleLabels: new Map(), serviceLabels: new Map(), cadence: new Map(), boardPinnedCellKeys: new Set(), storedServiceIds: new Set(),
}) as unknown as V3BuildResult;
const SUCCESS = JSON.stringify({ ok: true, contract: 3, engine: "v3", assignments: {}, pins: { requested: 0, honored: 0 }, unfilled: [], stages: [], violations: [], violation_ceiling: { value: 0, proven: true }, missed: [], notices: [], cadence: [], fairness: { scale: 100, tolerance: 35, lines: [], people: [] } });

function deps(over: Partial<V3AutoDeps> = {}): V3AutoDeps & { readLedger: ReturnType<typeof vi.fn>; postSolve: ReturnType<typeof vi.fn> } {
  return {
    months: ["2026-11"],
    preRead: () => [],
    storedReady: () => true,
    specialsWaiting: false,
    readLedger: vi.fn(async () => ({ status: 200, body: ledgerResponse(["2026-11"]) })),
    isCurrent: () => true,
    build: () => builtOk(),
    postSolve: vi.fn(async () => ({ status: 200, text: SUCCESS })),
    ...over,
  } as V3AutoDeps & { readLedger: ReturnType<typeof vi.fn>; postSolve: ReturnType<typeof vi.fn> };
}

describe("before any read", () => {
  it("HZ-7 / HZ-9 / WN-2 refuse with no GET and no solver fetch", async () => {
    for (const months of [["2026-09"], ["2027-11"], ["2027-10", "2027-11"]]) {
      const d = deps({ months, preRead: () => preReadRefusals({ months, currentMonth: "2026-10", config: config(), members: MEMBERS }) });
      const out = await runV3Auto(d);
      expect(out.kind).toBe("refused");
      expect(d.readLedger).not.toHaveBeenCalled();
      expect(d.postSolve).not.toHaveBeenCalled();
    }
  });

  it("ST-1: a stored read that is not ready or not coherent refuses, naming the months", async () => {
    const d = deps({ months: ["2026-11", "2026-12"], storedReady: () => false });
    expect(await runV3Auto(d)).toEqual({ kind: "refused", lines: ["No se pudieron leer los servicios guardados de noviembre y diciembre. Auto no corrió; vuelve a intentar."] });
    expect(d.readLedger).not.toHaveBeenCalled();
  });

  it("SP-5: a refusal before the pre-fill adds the counted-specials line", async () => {
    const out = await runV3Auto(deps({ storedReady: () => false, specialsWaiting: true }));
    expect(out.kind === "refused" && out.lines.at(-1)).toBe("Los especiales que cuentan para equidad no se llenaron porque Auto no corrió.");
  });
});

describe("RQ-1 — the ledger is read fresh, bounded at 20 s, and anything but a 200 IF2-8 body refuses", () => {
  const FAILED = "No se pudo leer el saldo de equidad. Auto no corrió; vuelve a intentar.";

  it.each([
    ["IF2-7's failure body", { status: 500, body: { error: "fairness_unavailable", message: "No se pudo leer el saldo de equidad." } }],
    ["a 403", { status: 403, body: { error: "Forbidden" } }],
    ["an unparseable body", { status: 200, body: null }],
    ["a 200 for another horizon", { status: 200, body: ledgerResponse(["2026-12"]) }],
  ])("%s refuses and sends nothing", async (_name, answer) => {
    const d = deps({ readLedger: vi.fn(async () => answer) });
    expect(await runV3Auto(d)).toEqual({ kind: "refused", lines: [FAILED] });
    expect(d.postSolve).not.toHaveBeenCalled();
  });

  it("a read that throws refuses", async () => {
    const d = deps({ readLedger: vi.fn(async () => { throw new TypeError("fetch failed"); }) });
    expect(await runV3Auto(d)).toEqual({ kind: "refused", lines: [FAILED] });
  });

  it("is aborted at 20 s", async () => {
    vi.useFakeTimers();
    expect(V3_LEDGER_TIMEOUT_MS).toBe(20_000);
    const readLedger = vi.fn((signal: AbortSignal) => new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))));
    const pending = runV3Auto(deps({ readLedger }));
    await vi.advanceTimersByTimeAsync(19_999);
    expect(readLedger.mock.calls[0][0].aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ kind: "refused", lines: [FAILED] });
  });

  it("if the horizon changes during the read, nothing is solved", async () => {
    let current = true;
    const d = deps({ readLedger: vi.fn(async () => { current = false; return { status: 200, body: ledgerResponse(["2026-11"]) }; }), isCurrent: () => current });
    expect(await runV3Auto(d)).toEqual({ kind: "stale" });
    expect(d.postSolve).not.toHaveBeenCalled();
  });

  it("a build refusal is Auto's refusal; no solver fetch", async () => {
    const d = deps({ build: () => ({ ok: false, lines: ["No se puede correr Auto: «Ana» en las reglas no coincide con nadie. Corrige el nombre en la regla."] }) });
    expect(await runV3Auto(d)).toEqual({ kind: "refused", lines: ["No se puede correr Auto: «Ana» en las reglas no coincide con nadie. Corrige el nombre en la regla."] });
    expect(d.postSolve).not.toHaveBeenCalled();
  });
});

describe("the solve (AD-2, AD-3, AD-4)", () => {
  it("is aborted by the client at 58 s and reads as the timeout transport", async () => {
    vi.useFakeTimers();
    expect(V3_CLIENT_SOLVE_TIMEOUT_MS).toBe(58_000);
    const postSolve = vi.fn((_r: unknown, signal: AbortSignal) => new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))));
    const pending = runV3Auto(deps({ postSolve }));
    await vi.advanceTimersByTimeAsync(0);          // flush the ledger read without moving the clock
    expect(postSolve).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(57_999);
    expect((postSolve.mock.calls[0][1] as AbortSignal).aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const out = await pending;
    expect(out.kind === "solved" && out.outcome).toEqual({ kind: "transport", reason: "timeout" });
  });

  it("a success whose pin echo differs is a handshake failure", async () => {
    const pins = [{ service: "s", date: "2026-11-01", role: "Lead", person: "m-ana" }];
    const out = await runV3Auto(deps({ build: () => builtOk(pins) }));
    expect(out.kind === "solved" && out.outcome).toEqual({ kind: "handshake_failed" });
  });

  it("a success is returned with its build", async () => {
    const out = await runV3Auto(deps());
    expect(out.kind === "solved" && out.outcome.kind).toBe("success");
  });

  it("a 409 version mismatch is its own outcome", async () => {
    const out = await runV3Auto(deps({ postSolve: vi.fn(async () => ({ status: 409, text: JSON.stringify({ ok: false, error: "solver_version_mismatch", engine: "v2" }) })) }));
    expect(out.kind === "solved" && out.outcome).toEqual({ kind: "version_mismatch" });
  });
});
