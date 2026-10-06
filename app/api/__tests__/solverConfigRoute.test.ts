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
import { SOLVER_CONFIG_VERSION } from "@/app/utils/solverConfigWriteRequest";

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

/** A real lost race, in the shape the Content Lake actually throws it. */
function contentLakeConflict() {
  return Object.assign(new Error("conflict"), {
    statusCode: 409,
    details: {
      type: "mutationError",
      items: [{ error: { type: "documentRevisionIDDoesNotMatchError" } }],
    },
  });
}

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
    const res = await POST(req({ configVersion: SOLVER_CONFIG_VERSION, rev: "rev-1", config: config() }));
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
    expect((await POST(req({ configVersion: SOLVER_CONFIG_VERSION, rev: "rev-1", config: config() }))).status).toBe(403);
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
    expect(body).toEqual({ present: false, rev: null, config: null, configVersion: SOLVER_CONFIG_VERSION });
  });

  it("propagates a failed read as a throw, never as an empty config", async () => {
    h.fetch.mockRejectedValue(new Error("network"));
    await expect(GET()).rejects.toThrow();
  });
});

describe("POST — the route may never CREATE", () => {
  it("refuses to create the document and states the reason", async () => {
    h.fetch.mockResolvedValue(null);
    const res = await POST(req({ configVersion: SOLVER_CONFIG_VERSION, rev: "rev-1", config: config() }));
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
    const res = await POST(req({ configVersion: SOLVER_CONFIG_VERSION, rev: "rev-OLD", config: config() }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("stale_revision");
    expect(body.details).toMatchObject({ observed: "rev-OLD", current: "rev-1" });
    expect(h.patchedIds).toEqual([]);
  });

  it("rejects a missing `_rev` as an invalid request", async () => {
    const res = await POST(req({ configVersion: SOLVER_CONFIG_VERSION, config: config() }));
    expect(res.status).toBe(400);
    expect((await res.json()).details.issues).toContain("rev");
    expect(h.patchedIds).toEqual([]);
  });

  it("threads the observed revision into `ifRevisionId`", async () => {
    await POST(req({ configVersion: SOLVER_CONFIG_VERSION, rev: "rev-1", config: config() }));
    expect(h.patchedIds).toEqual(["solverConfig"]);
    expect(h.revisions).toEqual(["rev-1"]);
  });

  it("reports a lost commit race — a GENUINE 409 — as a stale revision, not a 500", async () => {
    h.commit.mockRejectedValue(contentLakeConflict());
    const res = await POST(req({ configVersion: SOLVER_CONFIG_VERSION, rev: "rev-1", config: config() }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("stale_revision");
  });

  it("does NOT dress a non-conflict failure up as a stale revision", async () => {
    // This is the difference between one bad save and an unbreakable loop. A
    // missing or expired `SANITY_WRITE_TOKEN`, a network fault or a validation
    // complaint reported as `stale_revision` tells the admin "Alguien más lo
    // cambió primero. Recarga y reintenta." — so they reload, get the SAME
    // `_rev` back (nothing was written), retry, and fail identically, with the
    // real cause swallowed. Only `sanityConflictKind` may produce that answer;
    // everything else propagates. Same rule as `roles/[id]/route.ts:283`.
    for (const err of [
      Object.assign(new Error("Unauthorized"), { statusCode: 401 }),
      new Error("network"),
      // A 409 that is NOT a mutation conflict is still not a lost race.
      Object.assign(new Error("nope"), { statusCode: 409, details: { type: "somethingElse" } }),
    ]) {
      h.commit.mockRejectedValue(err);
      await expect(POST(req({ configVersion: SOLVER_CONFIG_VERSION, rev: "rev-1", config: config() }))).rejects.toThrow();
    }
  });
});

describe("POST — what it stores", () => {
  it("stores a freshly `uid()`ed rule WITH a `_key`", async () => {
    const fresh = { id: uid(), personA: "Hugo", personB: "Jakey", pattern: "*.Lead" };
    expect(fresh).not.toHaveProperty("_key");
    await POST(req({ configVersion: SOLVER_CONFIG_VERSION, rev: "rev-1", config: config({ conflicts: [fresh] }) }));
    const set = h.sets[0];
    const stored = (set.conflicts as Record<string, unknown>[])[0];
    expect(stored._key).toBe(fresh.id);
  });

  it("mints a `_key` at all five array levels", async () => {
    await POST(req({ configVersion: SOLVER_CONFIG_VERSION, rev: "rev-1", config: config() }));
    const set = h.sets[0];
    const r = (set.restrictions as Record<string, unknown>[])[0];
    expect(r._key).toBe("r1");
    expect((r.weekExclusions as Record<string, unknown>[])[0]._key).toBe("w1");
    expect((r.caps as Record<string, unknown>[])[0]._key).toBe("c1");
    expect((set.conflicts as Record<string, unknown>[])[0]._key).toBe("x1");
    expect((set.presence as Record<string, unknown>[])[0]._key).toBe("p1");
  });

  it("records who saved and when", async () => {
    await POST(req({ configVersion: SOLVER_CONFIG_VERSION, rev: "rev-1", config: config() }));
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
    const res = await POST(req({ configVersion: SOLVER_CONFIG_VERSION, rev: "rev-1", config: dup }));
    expect(res.status).toBe(400);
    expect((await res.json()).details.issues).toContain("conflicts[1].id:duplicate");
    expect(h.patchedIds).toEqual([]);
  });

  it("rejects a rule with no id before any write", async () => {
    const missing = config({ conflicts: [{ personA: "A", personB: "B", pattern: "*.Lead" }] });
    const res = await POST(req({ configVersion: SOLVER_CONFIG_VERSION, rev: "rev-1", config: missing }));
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

// ─── Solver v3 C3 · the config version guard (§6.2) — T4, T5 ──────────────────
//
// The POST is a whole-document serializer and the reader keeps only the fields
// it knows, so a tab whose bundle predates a field reads it away and its next
// save erases it for everyone. The route therefore refuses any body whose
// `configVersion` is not exactly its own — after auth, before it reads the
// stored document or parses the config.
const OUTDATED_TAB =
  "Esta pestaña tiene una versión anterior de las reglas. Recarga la página; no se guardó nada.";

describe("POST — the config version guard (C3 T4)", () => {
  const cases: [string, Record<string, unknown>, unknown][] = [
    ["absent", {}, null],
    ["null", { configVersion: null }, null],
    ['the string "2"', { configVersion: "2" }, "2"],
    ["1 (a pre-C3 shape)", { configVersion: 1 }, 1],
    ["3 (a newer shape)", { configVersion: 3 }, 3],
  ];
  for (const [label, version, received] of cases) {
    it(`refuses a configVersion that is ${label}, reading and writing nothing`, async () => {
      const res = await POST(req({ rev: "rev-1", config: config(), ...version }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: "invalid_request",
        conflict: false,
        message: OUTDATED_TAB,
        details: { issues: ["configVersion"], expected: SOLVER_CONFIG_VERSION, received },
      });
      expect(h.fetch).not.toHaveBeenCalled();
      expect(h.patchedIds).toEqual([]);
      expect(h.commit).not.toHaveBeenCalled();
    });
  }

  it("still answers 403, not 400, to a non-manager with no version (auth comes first)", async () => {
    h.requireActiveManager.mockResolvedValue(null);
    expect((await POST(req({ rev: "rev-1", config: config() }))).status).toBe(403);
  });

  it("checks the version before `rev`: a body missing both names the version", async () => {
    const res = await POST(req({ config: config() }));
    expect((await res.json()).details.issues).toEqual(["configVersion"]);
  });

  it("with the current version behaves as before, and its echo carries the version", async () => {
    const res = await POST(req({ rev: "rev-1", config: config(), configVersion: SOLVER_CONFIG_VERSION }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ present: true, configVersion: SOLVER_CONFIG_VERSION });
    expect(h.revisions).toEqual(["rev-1"]);
  });

  it("the GET carries the version", async () => {
    expect(await (await GET()).json()).toMatchObject({ present: true, rev: "rev-1", configVersion: SOLVER_CONFIG_VERSION });
  });
});

describe("POST — «Mes por medio» survives every path (C3 T5)", () => {
  const cadenceRestriction = {
    id: "r-ana", person: "Ana", excludedPatterns: [], fairness: "none", fairnessSlack: 1,
    weekExclusions: [], caps: [], sundayCadence: "alternate",
  };
  const STORED_WITH_CADENCE = {
    ...STORED,
    restrictions: [...config().restrictions, { _type: "solverRestriction", _key: "r-ana", ...cadenceRestriction }],
  };

  it("refuses a body exactly as a pre-C3 tab sends it, leaving the stored «Mes por medio» alone", async () => {
    h.fetch.mockResolvedValue(STORED_WITH_CADENCE);
    // `{ rev, config }`, the restriction without the field — what a pre-C3
    // bundle's reader turned the stored document into.
    const { sundayCadence: _dropped, ...withoutField } = cadenceRestriction;
    void _dropped;
    const preC3Body = { rev: "rev-1", config: config({ restrictions: [...config().restrictions, withoutField] }) };
    const res = await POST({ json: async () => preC3Body } as unknown as NextRequest);
    expect(res.status).toBe(400);
    expect((await res.json()).details.issues).toEqual(["configVersion"]);
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.sets).toEqual([]);
  });

  it("the GET reads it, and a current tab's save writes it back", async () => {
    h.fetch.mockResolvedValue(STORED_WITH_CADENCE);
    const got = await (await GET()).json();
    expect(got.config.restrictions[1]).toMatchObject({ id: "r-ana", sundayCadence: "alternate" });

    await POST(req({ rev: "rev-1", config: got.config, configVersion: SOLVER_CONFIG_VERSION }));
    const written = (h.sets[0].restrictions as Record<string, unknown>[])[1];
    expect(written).toMatchObject({ _key: "r-ana", sundayCadence: "alternate" });
    expect((h.sets[0].restrictions as Record<string, unknown>[])[0]).not.toHaveProperty("sundayCadence");
  });

  it("refuses an invalid cadence value at its issue path, writing nothing", async () => {
    const res = await POST(req({
      rev: "rev-1",
      configVersion: SOLVER_CONFIG_VERSION,
      config: config({ restrictions: [{ ...cadenceRestriction, sundayCadence: "normal" }] }),
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).details.issues).toEqual(["restrictions[0].sundayCadence"]);
    expect(h.patchedIds).toEqual([]);
  });
});

describe("POST — one exact count per person per role (C3 T14, parent A38)", () => {
  it("refuses two `==` caps covering Sun.Lead for one person, naming the later cap, writing nothing", async () => {
    const res = await POST(req({
      rev: "rev-1",
      configVersion: SOLVER_CONFIG_VERSION,
      config: config({
        restrictions: [{
          id: "r-ana", person: "Ana", excludedPatterns: [], fairness: "none", fairnessSlack: 1, weekExclusions: [],
          caps: [
            { id: "c-1", pattern: "Sun.Lead", op: "==", value: 2, relative: false, relOffset: 0 },
            { id: "c-2", pattern: "*.Lead", op: "==", value: 1, relative: false, relOffset: 0 },
          ],
        }],
      }),
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: "invalid_request", conflict: false });
    expect(body.details.issues).toEqual(["restrictions[0].caps[1]:exact_overlap"]);
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.patchedIds).toEqual([]);
  });
});
