// Solver v3 C6 AD-3–AD-6 — classification in AD-3's order, the handshake, apply-by-service-id and
// the retry rule keyed on codes. Never «sin solución» on any v3 path.
import { describe, expect, it } from "vitest";

import { applyV3Assignments, classifyV3Answer, v3HandshakeHolds, v3OutcomeLine, v3RetryOffered, type V3Outcome } from "../v3SolveResponse";
import { buildRows, type GridCell } from "../plannerModel";
import type { V3Pin, V3SolveRequest, V3Success } from "../v3Wire";

const http = (status: number, body: unknown) => ({ kind: "http" as const, status, text: typeof body === "string" ? body : JSON.stringify(body) });
const success = (over: Partial<V3Success> = {}): V3Success => ({
  ok: true, contract: 3, engine: "v3", solver_version: "3.0.0", build: "t", request_id: "r", seed: 1, months: ["2026-11"],
  reproducible: true, assignments: {}, unfilled: [], pins: { requested: 0, honored: 0 }, violations: [],
  violation_ceiling: { value: 0, proven: true }, stages: [], total_ms: 1,
  fairness: { scale: 100, tolerance: 35, lines: [], people: [] }, cadence: [], missed: [], notices: [], ...over,
});

describe("classifyV3Answer (AD-3's order)", () => {
  it.each<[string, Parameters<typeof classifyV3Answer>[0], V3Outcome["kind"], string?]>([
    ["409 solver_version_mismatch", http(409, { ok: false, error: "solver_version_mismatch", engine: "v2" }), "version_mismatch"],
    ["a client abort", { kind: "aborted" }, "transport", "timeout"],
    ["a fetch that throws", { kind: "threw" }, "transport", "unreachable"],
    ["a bare 504 (no JSON)", http(504, "An error occurred"), "transport", "timeout"],
    ["a non-JSON 200", http(200, "<html>"), "transport", "not_json"],
    ["an unexpected status", http(500, { ok: false }), "transport", "http_status"],
    ["a route-made transport error", http(422, { ok: false, transport_error: true, transport: "not_configured" }), "transport", "not_configured"],
    ["an ok body without contract 3 (a v2 answer)", http(200, { ok: true, schedule: {} }), "transport", "contract_echo"],
    ["a coded refusal", http(422, { ok: false, contract: 3, engine: "v3", code: "timeout", params: { stage: "fill", seconds: 25 } }), "refusal"],
    ["a success", http(200, success()), "success"],
  ])("%s", (_name, answer, kind, reason) => {
    const out = classifyV3Answer(answer);
    expect(out.kind).toBe(kind);
    if (reason) expect(out).toMatchObject({ reason });
  });

  it("never reads as «sin solución»", () => {
    const outcomes: V3Outcome[] = [
      classifyV3Answer({ kind: "aborted" }), classifyV3Answer(http(500, "x")),
      classifyV3Answer(http(422, { ok: false, contract: 3, engine: "v3", code: "internal_error", params: {} })),
      { kind: "version_mismatch" }, { kind: "handshake_failed" },
    ];
    for (const o of outcomes) if (o.kind !== "success") expect(v3OutcomeLine(o)).not.toMatch(/no encontró solución/);
  });
});

describe("v3RetryOffered (AD-6)", () => {
  it.each<[string, V3Outcome, boolean]>([
    ["timeout code", { kind: "refusal", code: "timeout", params: {} }, true],
    ["client abort", { kind: "transport", reason: "timeout" }, true],
    ["unreachable", { kind: "transport", reason: "unreachable" }, true],
    ["http_status", { kind: "transport", reason: "http_status" }, true],
    ["not_json", { kind: "transport", reason: "not_json" }, true],
    ["not_configured", { kind: "transport", reason: "not_configured" }, false],
    ["contract_echo", { kind: "transport", reason: "contract_echo" }, false],
    ["an unknown assignments id", { kind: "transport", reason: "unknown_service" }, false],
    ["another refusal", { kind: "refusal", code: "invalid_request", params: {} }, false],
    ["a handshake failure", { kind: "handshake_failed" }, false],
    ["the version mismatch", { kind: "version_mismatch" }, false],
  ])("%s → %s", (_name, outcome, offered) => expect(v3RetryOffered(outcome)).toBe(offered));
});

describe("v3HandshakeHolds (AD-4)", () => {
  const pins: V3Pin[] = [
    { service: "sun-1", date: "2026-11-01", role: "Lead", person: "m-ana" },
    { service: "sun-1", date: "2026-11-01", role: "Lead", person: "m-ana" },
    { service: "sp-1", date: "2026-11-20", role: "BGV", person: "m-bruno" },
  ];
  const assignments = { "sun-1": { Lead: ["m-ana"] }, "sp-1": { BGV: ["m-bruno"] } };

  it("holds when the echo equals the pins sent and every pin sits in its service and role", () => {
    expect(v3HandshakeHolds(success({ assignments, pins: { requested: 2, honored: 2 } }), pins)).toBe(true);
  });

  it("fails on an echo that differs, or a pin missing from the assignment", () => {
    expect(v3HandshakeHolds(success({ assignments, pins: { requested: 2, honored: 1 } }), pins)).toBe(false);
    expect(v3HandshakeHolds(success({ assignments, pins: { requested: 3, honored: 3 } }), pins)).toBe(false);
    expect(v3HandshakeHolds(success({ assignments: { "sun-1": { Lead: ["m-ana"] } }, pins: { requested: 2, honored: 2 } }), pins)).toBe(false);
  });
});

describe("applyV3Assignments (AD-5)", () => {
  const planned = "create:sunday_role__2026-11-08";
  const request = {
    services: [
      { id: planned, date: "2026-11-08", month: "2026-11", kind: "sunday", fixed: false, counts: true, seats: { Lead: 2, BGV: 3, Choir: 3 } },
      { id: "role.Ñ/odd", date: "2026-11-01", month: "2026-11", kind: "sunday", fixed: true, counts: true },
    ],
  } as unknown as V3SolveRequest;
  const cells: GridCell[] = [
    { columnId: planned, rowId: "lead", occupants: [{ memberId: "m-ana" }], origin: "manual" },
    { columnId: "role.Ñ/odd", rowId: "lead", occupants: [{ memberId: "m-dani", itemKey: "k1" }], origin: "manual" },
  ];

  it("writes planned columns only, by service id; fixed services' cells stay byte-identical; a pinned cell keeps its origin", () => {
    const response = success({ assignments: { [planned]: { Lead: ["m-ana", "m-bruno"], BGV: ["m-carla"], Choir: [] }, "role.Ñ/odd": { Lead: ["m-dani"] } } });
    const out = applyV3Assignments({ response, request, cells, rows: buildRows(), pinnedCellKeys: new Set([`${planned}|lead`]) });
    if (!out.ok) throw new Error("expected ok");
    const at = (col: string, row: string) => out.cells.find((c) => c.columnId === col && c.rowId === row);
    expect(at(planned, "lead")).toMatchObject({ origin: "manual", occupants: [{ memberId: "m-ana" }, { memberId: "m-bruno" }] });
    expect(at(planned, "bgv")).toMatchObject({ origin: "auto", occupants: [{ memberId: "m-carla" }] });
    expect(at("role.Ñ/odd", "lead")).toEqual(cells[1]);
  });

  it("an assignment for a service the request did not send applies nothing", () => {
    const response = success({ assignments: { "not-sent": { Lead: ["m-ana"] } } });
    expect(applyV3Assignments({ response, request, cells, rows: buildRows(), pinnedCellKeys: new Set() })).toEqual({ ok: false });
  });

  it("unfilled entries become `count` markers with their reason's copy", () => {
    const response = success({ assignments: { [planned]: { Lead: [], BGV: [], Choir: [] } }, unfilled: [{ service: planned, role: "Lead", count: 2, reason: "no_possible_lead" }] });
    const out = applyV3Assignments({ response, request, cells, rows: buildRows(), pinnedCellKeys: new Set() });
    if (!out.ok) throw new Error("expected ok");
    expect(out.unfilled).toEqual([
      { columnId: planned, rowId: "lead", reason: "Nadie puede dirigir este servicio" },
      { columnId: planned, rowId: "lead", reason: "Nadie puede dirigir este servicio" },
    ]);
  });
});
