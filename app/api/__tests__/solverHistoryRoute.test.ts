// `GET /api/admin/solver-history` — the read-only admin route for the month
// solver's derived fairness history (R8; MCP P2 task 4).
//
// Follows `solverConfigRoute.test.ts`'s `vi.hoisted` mock style. What this
// route must get right, each a way the wrong caller could see the wrong thing:
//
//   · the base gate matches `solver-config`'s: no session and content-editor
//     both refused, before the builder is ever called;
//   · `evidence=1` is a SECOND, narrower gate — super-admin only, because its
//     `members` list holds every member, kids-only included (CLAUDE.md §Auth);
//   · `month` is validated against the exact calendar-month shape BEFORE the
//     builder runs, so a malformed target never reaches `historyWindow`;
//   · any throw from the builder — `SolverHistoryUnavailableError` or anything
//     else — comes back as the SAME opaque `500`, with no `entries` key (so a
//     client can never read a failure as an empty history) and nothing from
//     the original error.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  requireActiveManager: vi.fn(),
  loadSolverHistory: vi.fn(),
}));

vi.mock("@/app/utils/authGuards", () => ({
  requireActiveManager: () => h.requireActiveManager(),
}));

vi.mock("@/app/utils/solverHistoryRead", () => ({
  loadSolverHistory: (...args: unknown[]) => h.loadSolverHistory(...args),
  SOLVER_HISTORY_UNAVAILABLE_MESSAGE: "No se pudo leer el historial de equidad.",
}));

import { GET } from "@/app/api/admin/solver-history/route";

function req(url: string): NextRequest {
  return { nextUrl: new URL(url, "http://localhost") } as unknown as NextRequest;
}

/** A plausible builder result: three entries, oldest first, no evidence. */
function fixtureResult(overrides: Record<string, unknown> = {}) {
  return {
    target: { year: 2026, month: 11 },
    entries: [
      { key: "2026-8", role_counts: {} },
      { key: "2026-9", role_counts: {} },
      { key: "2026-10", role_counts: {} },
    ],
    months: [
      { key: "2026-8", year: 2026, month: 8, services: 0 },
      { key: "2026-9", year: 2026, month: 9, services: 0 },
      { key: "2026-10", year: 2026, month: 10, services: 0 },
    ],
    diagnostics: { duplicateTargets: [], dangling: [], unnamedMemberIds: [] },
    ...overrides,
  };
}

function evidenceFixture() {
  return {
    documents: [],
    outOfWindowReceipts: [],
    members: [{ id: "m1", name: "Ana Prueba" }],
    control: { withReceipt: 0, unchanged: 0 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.requireActiveManager.mockResolvedValue({ user: { sanityId: "admin-1", role: "admin" } });
  h.loadSolverHistory.mockResolvedValue(fixtureResult());
});

describe("auth", () => {
  it("rejects an unauthenticated GET before the builder runs", async () => {
    h.requireActiveManager.mockResolvedValue(null);
    const res = await GET(req("/api/admin/solver-history?month=2026-11"));
    expect(res.status).toBe(403);
    expect(h.loadSolverHistory).not.toHaveBeenCalled();
  });

  it("rejects a content-editor, who may edit content but not read the solver history", async () => {
    h.requireActiveManager.mockResolvedValue({ user: { sanityId: "ce", role: "content-editor" } });
    const res = await GET(req("/api/admin/solver-history?month=2026-11"));
    expect(res.status).toBe(403);
    expect(h.loadSolverHistory).not.toHaveBeenCalled();
  });
});

describe("evidence gate — super-admin only", () => {
  it("a plain worship admin gets 200 without evidence", async () => {
    const res = await GET(req("/api/admin/solver-history?month=2026-11"));
    expect(res.status).toBe(200);
    expect(h.loadSolverHistory).toHaveBeenCalledWith({ year: 2026, month: 11 }, { evidence: false });
  });

  it("a plain worship admin gets 403 when asking for evidence, before the builder runs", async () => {
    const res = await GET(req("/api/admin/solver-history?month=2026-11&evidence=1"));
    expect(res.status).toBe(403);
    expect(h.loadSolverHistory).not.toHaveBeenCalled();
  });

  it("a super-admin gets 200 with evidence.members", async () => {
    h.requireActiveManager.mockResolvedValue({ user: { sanityId: "sa-1", role: "super-admin" } });
    h.loadSolverHistory.mockResolvedValue(fixtureResult({ evidence: evidenceFixture() }));
    const res = await GET(req("/api/admin/solver-history?month=2026-11&evidence=1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.evidence.members).toEqual([{ id: "m1", name: "Ana Prueba" }]);
    expect(h.loadSolverHistory).toHaveBeenCalledWith({ year: 2026, month: 11 }, { evidence: true });
  });

  it("evidence is gated on the QUERY PARAM, not the role: a super-admin who does not ask gets none", async () => {
    // Discriminates from a mutant that ties evidence to `role === "super-admin"`
    // instead of the `evidence=1` param — the plain-admin/super-admin pair above
    // cannot tell those two implementations apart on its own.
    h.requireActiveManager.mockResolvedValue({ user: { sanityId: "sa-1", role: "super-admin" } });
    const res = await GET(req("/api/admin/solver-history?month=2026-11"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).not.toHaveProperty("evidence");
    expect(h.loadSolverHistory).toHaveBeenCalledWith({ year: 2026, month: 11 }, { evidence: false });
  });
});

describe("month validation", () => {
  it("400s a month with an out-of-range component (2026-13)", async () => {
    const res = await GET(req("/api/admin/solver-history?month=2026-13"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_request");
    expect(h.loadSolverHistory).not.toHaveBeenCalled();
  });

  it("400s an unpadded month (2026-9)", async () => {
    const res = await GET(req("/api/admin/solver-history?month=2026-9"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_request");
    expect(h.loadSolverHistory).not.toHaveBeenCalled();
  });

  it("400s a missing month", async () => {
    const res = await GET(req("/api/admin/solver-history"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_request");
    expect(h.loadSolverHistory).not.toHaveBeenCalled();
  });
});

describe("200 — the shape", () => {
  it("carries three entries and sets Cache-Control: no-store", async () => {
    const res = await GET(req("/api/admin/solver-history?month=2026-11"));
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.entries).toHaveLength(3);
    expect(body.target).toEqual({ year: 2026, month: 11 });
  });

  it("carries no `evidence` key when evidence was not requested", async () => {
    const res = await GET(req("/api/admin/solver-history?month=2026-11"));
    const body = await res.json();
    expect(body).not.toHaveProperty("evidence");
  });

  it("carries `evidence` only when a super-admin asked for it", async () => {
    h.requireActiveManager.mockResolvedValue({ user: { sanityId: "sa-1", role: "super-admin" } });
    h.loadSolverHistory.mockResolvedValue(fixtureResult({ evidence: evidenceFixture() }));
    const res = await GET(req("/api/admin/solver-history?month=2026-11&evidence=1"));
    const body = await res.json();
    expect(body.evidence).toBeDefined();
  });
});

describe("500 — the builder threw", () => {
  it("SolverHistoryUnavailableError becomes an opaque 500 with no entries key", async () => {
    h.loadSolverHistory.mockRejectedValue(new Error("history unavailable"));
    const res = await GET(req("/api/admin/solver-history?month=2026-11"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({
      error: "history_unavailable",
      message: "No se pudo leer el historial de equidad.",
    });
    expect(body).not.toHaveProperty("entries");
  });

  it("any other throw from the builder gets the same opaque 500, never the original message", async () => {
    h.loadSolverHistory.mockRejectedValue(new RangeError("historyWindow: not a calendar month: 2026-13"));
    const res = await GET(req("/api/admin/solver-history?month=2026-11"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.message).toBe("No se pudo leer el historial de equidad.");
    expect(JSON.stringify(body)).not.toContain("historyWindow");
    expect(body).not.toHaveProperty("entries");
  });
});
