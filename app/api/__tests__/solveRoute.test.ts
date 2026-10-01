// `POST /api/admin/solve` — which refusals are the route's own (ruling Q19, ADR-0048).
//
// Auto re-solves a month without its trailing Saturday when the SOLVER refuses a request that
// sent it. A failure to reach or read the solver is not that, and must never retry. The route is
// the one place that knows which is which, so it tags every `ok: false` it makes itself
// (`transport_error: true`) and passes the solver's own answers through untouched. The client
// reads the tag; it never matches error strings.
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  requireActiveManager: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock("@/app/utils/authGuards", () => ({
  requireActiveManager: () => h.requireActiveManager(),
}));

vi.mock("child_process", () => ({
  spawn: (...a: unknown[]) => h.spawn(...a),
}));

import { POST } from "@/app/api/admin/solve/route";

const BODY = { weeks: 4, weekends_with_saturday: [5], sunday_leads: ["Ana"], saturday_leads: [], support: [], dsl_rules: [], history: [] };
const req = (body: unknown = BODY) => ({ json: async () => body }) as unknown as NextRequest;

/** A fake solver process: the test decides what it prints, and when it closes. */
function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter; stderr: EventEmitter; stdin: { write: () => void; end: () => void }; kill: () => void;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: () => {}, end: () => {} };
  child.kill = vi.fn();
  h.spawn.mockReturnValue(child);
  return child;
}

/** The route awaits auth and the body before it spawns; wait until the child is listening. */
const spawned = () => vi.waitFor(() => expect(h.spawn).toHaveBeenCalled());

async function call() {
  const res = await POST(req());
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  h.requireActiveManager.mockResolvedValue({ user: { role: "admin" } });
  h.spawn.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the remote solver (OWT_SOLVER_URL)", () => {
  beforeEach(() => { vi.stubEnv("OWT_SOLVER_URL", "https://solver.example/solve"); });

  it("an HTTP status other than 422 is the route's own failure: transport_error, still a 422", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })));
    expect(await call()).toEqual({
      status: 422,
      body: { ok: false, error: "Solver service returned HTTP 503", transport_error: true },
    });
  });

  it("the solver's own refusal (its 422) passes through without the tag", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 422, json: async () => ({ ok: false, error: "infeasible" }) })));
    const { status, body } = await call();
    expect(status).toBe(422);
    expect(body).toEqual({ ok: false, error: "infeasible" });
    expect("transport_error" in body).toBe(false);
  });

  it("a solved month passes through as a 200", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, schedule: {} }) })));
    expect(await call()).toEqual({ status: 200, body: { ok: true, schedule: {} } });
  });
});

describe("the local solver (no OWT_SOLVER_URL)", () => {
  beforeEach(() => { vi.stubEnv("OWT_SOLVER_URL", ""); });

  it("a timeout is the route's own failure", async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    const pending = call();
    await vi.waitFor(() => expect(h.spawn).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await pending).toEqual({
      status: 422,
      body: { ok: false, error: "Local solver timed out after 120 s", transport_error: true },
    });
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("a process that fails to start is the route's own failure", async () => {
    const child = fakeChild();
    const pending = call();
    await spawned();
    child.emit("error", new Error("ENOENT"));
    expect(await pending).toEqual({
      status: 422,
      body: { ok: false, error: "Failed to start solver: ENOENT", transport_error: true },
    });
  });

  it("no output is the route's own failure", async () => {
    const child = fakeChild();
    const pending = call();
    await spawned();
    child.stderr.emit("data", Buffer.from("Traceback: boom"));
    child.emit("close", 1);
    expect(await pending).toEqual({
      status: 422,
      body: { ok: false, error: "Solver produced no output. Traceback: boom", transport_error: true },
    });
  });

  it("output that is not JSON is the route's own failure", async () => {
    const child = fakeChild();
    const pending = call();
    await spawned();
    child.stdout.emit("data", Buffer.from("not json"));
    child.emit("close", 0);
    expect(await pending).toEqual({
      status: 422,
      body: { ok: false, error: "Solver output was not valid JSON: not json", transport_error: true },
    });
  });

  it("the solver's own `ok: false` passes through without the tag", async () => {
    const child = fakeChild();
    const pending = call();
    await spawned();
    child.stdout.emit("data", Buffer.from(JSON.stringify({ ok: false, error: "The schedule is infeasible" })));
    child.emit("close", 0);
    const { status, body } = await pending;
    expect(status).toBe(422);
    expect(body).toEqual({ ok: false, error: "The schedule is infeasible" });
    expect("transport_error" in body).toBe(false);
  });
});

describe("unchanged around it", () => {
  it("stays admin-gated: a content-editor gets a 403 and no solver runs", async () => {
    h.requireActiveManager.mockResolvedValue({ user: { role: "content-editor" } });
    const res = await POST(req());
    expect(res.status).toBe(403);
    expect(h.spawn).not.toHaveBeenCalled();
  });
});
