// Solver v3 C6 RT-3–RT-6 — the v3 transport: one classification for every upstream answer,
// a 55 s abort on both paths, the local entry point only off Vercel, nothing ever a 500.
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const h = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("child_process", () => ({ spawn: (...a: unknown[]) => h.spawn(...a) }));

import { V3_UPSTREAM_TIMEOUT_MS, classifyUpstream, isV3Body, solveV3 } from "@/app/utils/solverV3Upstream";

const OK = JSON.stringify({ ok: true, contract: 3, engine: "v3", assignments: {} });
const coded = (code: string) => JSON.stringify({ ok: false, contract: 3, engine: "v3", code, params: {} });
const body = { contract: 3, seed: 1, months: ["2026-11"] };

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter; stderr: EventEmitter; stdin: { write: (s: string) => void; end: () => void }; kill: () => void;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: vi.fn(), end: vi.fn() };
  child.kill = vi.fn();
  h.spawn.mockReturnValue(child);
  return child;
}

beforeEach(() => h.spawn.mockReset());
afterEach(() => vi.useRealTimers());

describe("isV3Body (RT-1: the contract marker classifies; the engine decides)", () => {
  it("is true only for an object whose contract is 3", () => {
    expect(isV3Body(body)).toBe(true);
    expect(isV3Body({ contract: "3" })).toBe(false);
    expect(isV3Body({ weeks: 4, sunday_leads: ["Ana"] })).toBe(false);
    expect(isV3Body(null)).toBe(false);
    expect(isV3Body([{ contract: 3 }])).toBe(false);
  });
});

describe("classifyUpstream (RT-5, RT-6)", () => {
  it("a v3 success is forwarded verbatim with 200", () => {
    expect(classifyUpstream(200, OK)).toEqual({ status: 200, text: OK, outcome: "ok" });
  });

  it.each([422, 400, 401, 405, 503, 500])("a coded v3 failure at HTTP %i is forwarded verbatim as 422", (status) => {
    const text = coded(status === 401 ? "unauthorized" : status === 503 ? "misconfigured" : "invalid_request");
    expect(classifyUpstream(status, text)).toEqual({ status: 422, text, outcome: JSON.parse(text).code });
  });

  it("a non-2xx answer without a coded v3 body is http_status", () => {
    expect(JSON.parse(classifyUpstream(502, "<html>bad gateway</html>").text)).toEqual(
      { ok: false, transport_error: true, transport: "http_status" },
    );
  });

  it("a 2xx answer that is not JSON is not_json", () => {
    expect(JSON.parse(classifyUpstream(200, "Traceback").text).transport).toBe("not_json");
  });

  it("a 2xx JSON answer without contract 3 and engine v3 is contract_echo (e.g. a v2 function at the v3 URL)", () => {
    const v2 = JSON.stringify({ ok: true, schedule: {} });
    expect(classifyUpstream(200, v2)).toEqual({
      status: 422, text: JSON.stringify({ ok: false, transport_error: true, transport: "contract_echo" }), outcome: "contract_echo",
    });
  });
});

describe("solveV3 — remote (RT-3, RT-4)", () => {
  const env = { OWT_SOLVER_V3_URL: "https://v3.example/solve", OWT_SOLVER_API_KEY: "test-key", VERCEL_ENV: "preview" };

  it("posts the body with the X-Api-Key header and forwards the answer", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, text: async () => OK }));
    const out = await solveV3(body, env, fetchImpl);
    expect(out).toEqual({ status: 200, text: OK, outcome: "ok" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe("https://v3.example/solve");
    expect(init.headers["X-Api-Key"]).toBe("test-key");
    expect(JSON.parse(init.body)).toEqual(body);
  });

  it("a fetch that throws is unreachable", async () => {
    const out = await solveV3(body, env, vi.fn(async () => { throw new TypeError("fetch failed"); }));
    expect(JSON.parse(out.text).transport).toBe("unreachable");
  });

  it("aborts at 55 s and answers the timeout transport", async () => {
    vi.useFakeTimers();
    expect(V3_UPSTREAM_TIMEOUT_MS).toBe(55_000);
    const fetchImpl = vi.fn((_url: string, init: { signal: AbortSignal }) =>
      new Promise<never>((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")))));
    const pending = solveV3(body, env, fetchImpl as never);
    await vi.advanceTimersByTimeAsync(54_999);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(JSON.parse((await pending).text)).toEqual({ ok: false, transport_error: true, transport: "timeout" });
  });
});

describe("solveV3 — no URL (RT-3)", () => {
  it("on a Vercel deployment answers not_configured and never spawns", async () => {
    const out = await solveV3(body, { VERCEL_ENV: "preview" }, vi.fn());
    expect(JSON.parse(out.text).transport).toBe("not_configured");
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it("off Vercel runs the local v3 entry point and classifies its stdout the same way", async () => {
    const child = fakeChild();
    const pending = solveV3(body, {}, vi.fn());
    await vi.waitFor(() => expect(h.spawn).toHaveBeenCalled());
    const [, args] = h.spawn.mock.calls[0] as [string, string[]];
    expect(args[0].endsWith("gcf_v3/owt_solver_v3.py")).toBe(true);
    expect(args[1]).toBe("--json-mode");
    expect(child.stdin.write).toHaveBeenCalledWith(JSON.stringify(body));
    child.stdout.emit("data", Buffer.from(coded("timeout")));
    child.emit("close", 0);
    expect(await pending).toEqual({ status: 422, text: coded("timeout"), outcome: "timeout" });
  });

  it("the local path is killed at 55 s too", async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    const pending = solveV3(body, {}, vi.fn());
    await vi.waitFor(() => expect(h.spawn).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(55_000);
    expect(JSON.parse((await pending).text).transport).toBe("timeout");
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("a process that fails to start is unreachable; no output is not_json", async () => {
    const first = fakeChild();
    const a = solveV3(body, {}, vi.fn());
    await vi.waitFor(() => expect(h.spawn).toHaveBeenCalledTimes(1));
    first.emit("error", new Error("ENOENT"));
    expect(JSON.parse((await a).text).transport).toBe("unreachable");
    const second = fakeChild();
    const b = solveV3(body, {}, vi.fn());
    await vi.waitFor(() => expect(h.spawn).toHaveBeenCalledTimes(2));
    second.emit("close", 1);
    expect(JSON.parse((await b).text).transport).toBe("not_json");
  });
});
