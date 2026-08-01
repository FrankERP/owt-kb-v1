// `GET|POST /api/admin/solver-config` — the shared planner rule set (P6).
//
// Four properties, each of which is a way the live rules could have been lost:
//
//   · the route can never CREATE the document — only the seed script may, so the
//     first Guardar from a browser holding no rules cannot mint the shared
//     document out of `DEFAULT_SOLVER_CONFIG`;
//   · a stale `_rev` is rejected — two admins with the panel open must not
//     silently overwrite each other's whole rule set;
//   · what it stores carries a `_key` on every array item, minted from the `id`
//     a freshly `uid()`ed rule already has;
//   · "absent" and "read failed" are different answers, so the client cannot
//     collapse them into one `?? DEFAULT_SOLVER_CONFIG`.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  requireActiveManager: vi.fn(),
  fetch: vi.fn(),
  /** Every `.set()` payload committed, in order. */
  sets: [] as Record<string, unknown>[],
  patchedIds: [] as string[],
  revisions: [] as (string | undefined)[],
  commit: vi.fn(),
  created: [] as unknown[],
}));

vi.mock("@/app/utils/authGuards", () => ({
  requireActiveManager: () => h.requireActiveManager(),
}));

vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: (...a: unknown[]) => h.fetch(...a) },
}));

vi.mock("@/sanity/lib/serverClient", () => {
  const chain: Record<string, unknown> = {};
  chain.ifRevisionId = (rev: string) => { h.revisions.push(rev); return chain; };
  chain.set = (v: Record<string, unknown>) => { h.sets.push(v); return chain; };
  chain.commit = () => h.commit();
  return {
    serverClient: { fetch: vi.fn() },
    writeClient: {
      patch: (id: string) => { h.patchedIds.push(id); return chain; },
      create: (doc: unknown) => { h.created.push(doc); return Promise.resolve(doc); },
    },
  };
});

import { GET, POST } from "@/app/api/admin/solver-config/route";

const uid = () => Math.random().toString(36).slice(2, 9);

function req(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function config(overrides: Record<string, unknown> = {}) {
  return {
    sundayLeads: ["Frank"],
    saturdayLeads: [],
    support: [],
    restrictions: [
      {
        id: "r1",
        person: "Frank",
        excludedPatterns: ["Sat.*"],
        fairness: "exempt",
        fairnessSlack: 1,
        weekExclusions: [{ id: "w1", week: 3, pattern: "*.*" }],
        caps: [{ id: "c1", pattern: "Sun.BGV", op: "<=", value: 0, relative: true, relOffset: 2 }],
      },
    ],
    conflicts: [{ id: "x1", personA: "Lucía", personB: "Niza", pattern: "*.LeadBGV" }],
    presence: [{ id: "p1", persons: ["Hugo", "Jakey"], pattern: "Sun.BGV" }],
    ...overrides,
  };
}

/** A stored document as the route's own read would return it. */
const STORED = { _id: "solverConfig", _type: "solverConfig", _rev: "rev-1", ...config() };

beforeEach(() => {
  vi.clearAllMocks();
  h.sets.length = 0;
  h.patchedIds.length = 0;
  h.revisions.length = 0;
  h.created.length = 0;
  h.requireActiveManager.mockResolvedValue({
    user: { sanityId: "admin-1", role: "admin" },
  });
  h.fetch.mockResolvedValue(STORED);
  h.commit.mockResolvedValue({ _id: "solverConfig", _rev: "rev-2" });
});

describe("auth", () => {
  it("rejects an unauthenticated POST before reading or writing anything", async () => {
    h.requireActiveManager.mockResolvedValue(null);
    const res = await POST(req({ rev: "rev-1", config: config() }));
    expect(res.status).toBe(403);
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.patchedIds).toEqual([]);
  });

  it("rejects an unauthenticated GET", async () => {
    h.requireActiveManager.mockResolvedValue(null);
    expect((await GET()).status).toBe(403);
  });

  it("rejects a content-editor, who may edit content but not the rules", async () => {
    h.requireActiveManager.mockResolvedValue({ user: { sanityId: "ce", role: "content-editor" } });
    expect((await POST(req({ rev: "rev-1", config: config() }))).status).toBe(403);
    expect((await GET()).status).toBe(403);
    expect(h.patchedIds).toEqual([]);
  });
});

describe("GET", () => {
  it("returns the config and its revision when the document exists", async () => {
    const body = await (await GET()).json();
    expect(body.present).toBe(true);
    expect(body.rev).toBe("rev-1");
    expect(body.config.conflicts).toEqual([
      { id: "x1", personA: "Lucía", personB: "Niza", pattern: "*.LeadBGV" },
    ]);
  });

  it("says `present: false` with NO config when the document is absent", async () => {
    // Absent must be distinguishable from "read failed": the client falls back to
    // the defaults IN MEMORY on this answer, and refuses to save on an error. One
    // `config ?? DEFAULT_SOLVER_CONFIG` over both is how a transient failure
    // becomes "your rules are the defaults" — and then overwrites them.
    h.fetch.mockResolvedValue(null);
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ present: false, rev: null, config: null });
  });

  it("propagates a failed read as a throw, never as an empty config", async () => {
    h.fetch.mockRejectedValue(new Error("network"));
    await expect(GET()).rejects.toThrow();
  });
});

describe("POST — the route may never CREATE", () => {
  it("refuses to create the document and states the reason", async () => {
    h.fetch.mockResolvedValue(null);
    const res = await POST(req({ rev: "rev-1", config: config() }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("not_found");
    expect(body.details.detail).toBe("create_not_allowed_here");
    // Nothing was written by any mechanism.
    expect(h.patchedIds).toEqual([]);
    expect(h.created).toEqual([]);
    expect(h.commit).not.toHaveBeenCalled();
  });
});

describe("POST — revisions", () => {
  it("rejects a stale `_rev` without writing", async () => {
    const res = await POST(req({ rev: "rev-OLD", config: config() }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("stale_revision");
    expect(body.details).toMatchObject({ observed: "rev-OLD", current: "rev-1" });
    expect(h.patchedIds).toEqual([]);
  });

  it("rejects a missing `_rev` as an invalid request", async () => {
    const res = await POST(req({ config: config() }));
    expect(res.status).toBe(400);
    expect((await res.json()).details.issues).toContain("rev");
    expect(h.patchedIds).toEqual([]);
  });

  it("threads the observed revision into `ifRevisionId`", async () => {
    await POST(req({ rev: "rev-1", config: config() }));
    expect(h.patchedIds).toEqual(["solverConfig"]);
    expect(h.revisions).toEqual(["rev-1"]);
  });

  it("reports a lost commit race as a stale revision, not a 500", async () => {
    h.commit.mockRejectedValue(new Error("conflict"));
    const res = await POST(req({ rev: "rev-1", config: config() }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("stale_revision");
  });
});

describe("POST — what it stores", () => {
  it("stores a freshly `uid()`ed rule WITH a `_key`", async () => {
    const fresh = { id: uid(), personA: "Hugo", personB: "Jakey", pattern: "*.Lead" };
    expect(fresh).not.toHaveProperty("_key");
    await POST(req({ rev: "rev-1", config: config({ conflicts: [fresh] }) }));
    const set = h.sets[0];
    const stored = (set.conflicts as Record<string, unknown>[])[0];
    expect(stored._key).toBe(fresh.id);
  });

  it("mints a `_key` at all five array levels", async () => {
    await POST(req({ rev: "rev-1", config: config() }));
    const set = h.sets[0];
    const r = (set.restrictions as Record<string, unknown>[])[0];
    expect(r._key).toBe("r1");
    expect((r.weekExclusions as Record<string, unknown>[])[0]._key).toBe("w1");
    expect((r.caps as Record<string, unknown>[])[0]._key).toBe("c1");
    expect((set.conflicts as Record<string, unknown>[])[0]._key).toBe("x1");
    expect((set.presence as Record<string, unknown>[])[0]._key).toBe("p1");
  });

  it("records who saved and when", async () => {
    await POST(req({ rev: "rev-1", config: config() }));
    expect(h.sets[0].updatedBy).toBe("admin-1");
    expect(typeof h.sets[0].updatedAt).toBe("string");
  });

  it("rejects a duplicate rule id before any write", async () => {
    const dup = config({
      conflicts: [
        { id: "same", personA: "A", personB: "B", pattern: "*.Lead" },
        { id: "same", personA: "C", personB: "D", pattern: "*.BGV" },
      ],
    });
    const res = await POST(req({ rev: "rev-1", config: dup }));
    expect(res.status).toBe(400);
    expect((await res.json()).details.issues).toContain("conflicts[1].id:duplicate");
    expect(h.patchedIds).toEqual([]);
  });

  it("rejects a rule with no id before any write", async () => {
    const missing = config({ conflicts: [{ personA: "A", personB: "B", pattern: "*.Lead" }] });
    const res = await POST(req({ rev: "rev-1", config: missing }));
    expect(res.status).toBe(400);
    expect((await res.json()).details.issues).toContain("conflicts[0].id:missing");
    expect(h.patchedIds).toEqual([]);
  });

  it("rejects an unparseable body", async () => {
    const res = await POST({ json: async () => { throw new Error("bad json"); } } as unknown as NextRequest);
    expect(res.status).toBe(400);
    expect(h.patchedIds).toEqual([]);
  });
});
