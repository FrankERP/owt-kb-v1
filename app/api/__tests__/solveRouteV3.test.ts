// Solver v3 C6 RT-1, RT-2, KH-2 — the solve route under each engine. The engine comes from C2's
// resolver: the constant ("v2"), or OWT_SOLVER_ENGINE with VERCEL_ENV unset (local), which is
// how these tests pick v3. Existing v2 behaviour stays pinned by `solveRoute.test.ts`, unedited.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const h = vi.hoisted(() => ({ requireActiveManager: vi.fn(), spawn: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/app/utils/authGuards", () => ({ requireActiveManager: () => h.requireActiveManager() }));
vi.mock("child_process", () => ({ spawn: (...a: unknown[]) => h.spawn(...a) }));

import { POST, maxDuration } from "@/app/api/admin/solve/route";

const V2_BODY = { weeks: 4, weekends_with_saturday: [5], sunday_leads: ["Ana"], saturday_leads: [], support: [], dsl_rules: [], history: [] };
// Name-shaped on purpose (KH-2): every identifier below must stay out of the route's logs.
const V3_BODY = {
  contract: 3, seed: 7, request_id: "req-ana-bruno", months: ["2026-11"],
  services: [{ id: "svc-ana-bruno", date: "2026-11-01", month: "2026-11", kind: "sunday", fixed: false, counts: true, seats: { Lead: 1, BGV: 1, Choir: 0 } }],
  people: [{ id: "m-ana", name: "Ana", exempt: false, eligibility: { "svc-ana-bruno": ["Lead"] }, carried: { "P:d-ana-bruno": 50 }, dl_since: null, prev_dl_leads: 0 }],
  rules: [{ kind: "presence", id: "d-ana-bruno", persons: ["m-ana"], roles: ["Sun.BGV"], exclusive: false, month: "2026-11" }],
  pins: [], prior: { month: "2026-10", has_services: false, services: [] },
};
const SECRETS = ["req-ana-bruno", "svc-ana-bruno", "m-ana", "Ana", "d-ana-bruno", "P:"];
const req = (b: unknown) => ({ json: async () => b }) as unknown as NextRequest;

let logs: string[];
beforeEach(() => {
  h.requireActiveManager.mockResolvedValue({ user: { role: "admin" } });
  h.spawn.mockReset();
  logs = [];
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { logs.push(args.map(String).join(" ")); });
  }
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const asV3 = () => { vi.stubEnv("OWT_SOLVER_ENGINE", "v3"); vi.stubEnv("VERCEL_ENV", ""); };

describe("maxDuration (spec ceiling)", () => {
  it("stays 60 s — the v3 abort (55 s) fits inside it", () => expect(maxDuration).toBe(60));
});

describe("RT-1 — a body of the other contract is a 409 before anything else", () => {
  it("v3 body under v2: 409 with the engine, no upstream call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("OWT_SOLVER_URL", "https://v2.example/solve");
    vi.stubEnv("OWT_SOLVER_V3_URL", "https://v3.example/solve");
    const res = await POST(req(V3_BODY));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, error: "solver_version_mismatch", engine: "v2" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it("v2 body under v3: 409 before v2's own validation (even with empty sunday_leads)", async () => {
    asV3();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST(req({ ...V2_BODY, sunday_leads: [] }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, error: "solver_version_mismatch", engine: "v3" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("RT-2 — v2 under v2 is today's path", () => {
  it("forwards the received body upstream unchanged", async () => {
    vi.stubEnv("OWT_SOLVER_URL", "https://v2.example/solve");
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, schedule: {} }) }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST(req(V2_BODY));
    expect(res.status).toBe(200);
    const init = (fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1];
    expect(JSON.parse(init.body)).toEqual(V2_BODY);
  });
});

describe("RT-3 / RT-5 / RT-6 — v3 under v3", () => {
  beforeEach(asV3);

  it("forwards a success byte for byte", async () => {
    vi.stubEnv("OWT_SOLVER_V3_URL", "https://v3.example/solve");
    const text = JSON.stringify({ ok: true, contract: 3, engine: "v3", stages: [{ id: "balance_max:P:d-ana-bruno", status: "proven" }] });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, text: async () => text })));
    const res = await POST(req(V3_BODY));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(text);
  });

  it("a 401 coded body arrives as 422 with its code", async () => {
    vi.stubEnv("OWT_SOLVER_V3_URL", "https://v3.example/solve");
    const text = JSON.stringify({ ok: false, contract: 3, engine: "v3", code: "unauthorized", params: {} });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, text: async () => text })));
    const res = await POST(req(V3_BODY));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual(JSON.parse(text));
  });

  it("on a deployment without the URL answers not_configured as JSON", async () => {
    vi.stubEnv("OWT_SOLVER_ENGINE", "v3");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_GIT_COMMIT_REF", "preview");
    vi.stubEnv("OWT_SOLVER_V3_URL", "");
    const res = await POST(req(V3_BODY));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ ok: false, transport_error: true, transport: "not_configured" });
    expect(h.spawn).not.toHaveBeenCalled();
  });
});

describe("KH-2 — the route logs no request content", () => {
  beforeEach(asV3);
  const answers: Array<[string, () => Promise<unknown>]> = [
    ["success", async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true, contract: 3, engine: "v3", request_id: "req-ana-bruno", assignments: { "svc-ana-bruno": { Lead: ["m-ana"] } } }) })],
    ["coded failure", async () => ({ ok: false, status: 422, text: async () => JSON.stringify({ ok: false, contract: 3, engine: "v3", code: "unknown_person", params: { field: "pins[0].person", person: "m-ana" } }) })],
    ["http_status", async () => ({ ok: false, status: 502, text: async () => "upstream m-ana" })],
    ["not_json", async () => ({ ok: true, status: 200, text: async () => "Ana" })],
    ["contract_echo", async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true, person: "m-ana" }) })],
    ["unreachable", async () => { throw new Error("connect ECONNREFUSED svc-ana-bruno"); }],
  ];

  it.each(answers)("%s: one log line with engine, outcome, status and timing only", async (_name, answer) => {
    vi.stubEnv("OWT_SOLVER_V3_URL", "https://v3.example/solve");
    vi.stubGlobal("fetch", vi.fn(answer));
    await POST(req(V3_BODY));
    expect(logs).toHaveLength(1);
    for (const secret of SECRETS) expect(logs[0]).not.toContain(secret);
    expect(Object.keys(JSON.parse(logs[0])).sort()).toEqual(["engine", "ms", "outcome", "route", "status"]);
  });
});
