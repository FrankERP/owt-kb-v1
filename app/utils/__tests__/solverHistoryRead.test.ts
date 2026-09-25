// `loadSolverHistory` — the one server-callable builder of the solver's derived
// fairness history (spec R8–R11; plan step 3). The Sanity client is mocked; the
// query builders are the real ones, so every assertion about "which read ran"
// compares against what `serviceReadQueries.ts` actually builds.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const operationalFetch = vi.fn();
vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: (...a: unknown[]) => operationalFetch(...a) },
  rawIntegrityClient: { fetch: vi.fn() },
}));

import {
  canonicalMemberNamesQuery,
  canonicalRolesByIdsQuery,
  canonicalWeekendRolesInRangeQuery,
  weekendRoleCreationReceiptsQuery,
} from "@/app/utils/serviceReadQueries";
import {
  SOLVER_HISTORY_UNAVAILABLE_MESSAGE,
  SolverHistoryUnavailableError,
  loadSolverHistory,
} from "@/app/utils/solverHistoryRead";

// Fake names only: this repository is public.
const MEMBERS = [
  { _id: "m-ana", member_name: "Ana Prueba" },
  { _id: "m-beto", member_name: "Beto Ensayo" },
  // Seated nowhere in the window: a kids-only volunteer, say.
  { _id: "m-kids", member_name: "Gabi Infantil" },
];

const ref = (id: string) => ({ _key: `k-${id}`, _type: "reference", _ref: id });

function role(id: string, type: "sunday_role" | "saturday_role", week: string, over: Record<string, unknown> = {}) {
  return {
    _id: id,
    _rev: `rev-${id}`,
    _type: type,
    published: false,
    week,
    date: null,
    service_name: null,
    time: null,
    format: null,
    creationReceiptId: null,
    creationFingerprint: null,
    Lead: [ref("m-ana")],
    BGVs: [ref("m-beto")],
    Chorus: null,
    instruments: null,
    foh_team: null,
    songs: null,
    ...over,
  };
}

function receipt(id: string, roleId: string, targetIdentity: string, state = "committed") {
  return {
    _id: id,
    _rev: `rev-${id}`,
    _type: "roleCreationReceipt",
    requestId: `req-${id}`,
    fingerprint: "0".repeat(64),
    roleId,
    roleType: targetIdentity.split(":")[0],
    targetIdentity,
    state,
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-01T12:00:00.000Z",
  };
}

const ROLES_Q = canonicalWeekendRolesInRangeQuery("x", "y").query;
const MEMBERS_Q = canonicalMemberNamesQuery().query;
const RECEIPTS_Q = weekendRoleCreationReceiptsQuery().query;
const BY_IDS_Q = canonicalRolesByIdsQuery([]).query;

interface Dataset {
  roles: unknown;
  members: unknown;
  receipts: unknown;
  /** Current documents, looked up by id. */
  byId: Record<string, unknown>[];
}

/** Answer each real builder's query from `data`; a function value rejects or is returned as-is. */
function serve(data: Partial<Dataset>, fail: Partial<Record<"roles" | "members" | "receipts" | "byIds", Error>> = {}) {
  const d: Dataset = { roles: [], members: MEMBERS, receipts: [], byId: [], ...data };
  operationalFetch.mockImplementation(async (query: string, params: Record<string, unknown>) => {
    if (query === ROLES_Q) {
      if (fail.roles) throw fail.roles;
      return d.roles;
    }
    if (query === MEMBERS_Q) {
      if (fail.members) throw fail.members;
      return d.members;
    }
    if (query === RECEIPTS_Q) {
      if (fail.receipts) throw fail.receipts;
      return d.receipts;
    }
    if (query === BY_IDS_Q) {
      if (fail.byIds) throw fail.byIds;
      const ids = params.ids as string[];
      return d.byId.filter((r) => ids.includes(r._id as string));
    }
    throw new Error(`unexpected query: ${query}`);
  });
}

const queriesRun = () => operationalFetch.mock.calls.map(([query]) => query as string);

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  operationalFetch.mockReset();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  consoleError.mockRestore();
});

describe("loadSolverHistory — the reads", () => {
  it("without evidence runs exactly the window's roles and every member name, with November's bounds", async () => {
    serve({});
    await loadSolverHistory({ year: 2026, month: 11 });
    expect(operationalFetch).toHaveBeenCalledTimes(2);
    expect(operationalFetch).toHaveBeenCalledWith(ROLES_Q, canonicalWeekendRolesInRangeQuery("2026-08-01", "2026-11-01").params);
    expect(operationalFetch).toHaveBeenCalledWith(MEMBERS_Q, canonicalMemberNamesQuery().params);
    expect(queriesRun()).not.toContain(RECEIPTS_Q);
    expect(queriesRun()).not.toContain(BY_IDS_Q);
  });

  it("borrows across the year: January 2027 reads 2026-10-01 up to 2027-01-01", async () => {
    serve({});
    await loadSolverHistory({ year: 2027, month: 1 });
    expect(operationalFetch).toHaveBeenCalledWith(ROLES_Q, canonicalWeekendRolesInRangeQuery("2026-10-01", "2027-01-01").params);
  });

  it("starts its reads in parallel", async () => {
    const pending: Array<() => void> = [];
    operationalFetch.mockImplementation(
      (query: string) =>
        new Promise((done) => {
          pending.push(() => done(query === MEMBERS_Q ? MEMBERS : []));
        }),
    );
    const loading = loadSolverHistory({ year: 2026, month: 11 }, { evidence: true });
    await Promise.resolve();
    // All three reads are in flight before any of them has answered.
    expect(queriesRun().sort()).toEqual([ROLES_Q, MEMBERS_Q, RECEIPTS_Q].sort());
    pending.forEach((resolveOne) => resolveOne());
    await loading;
  });

  it("with evidence also reads the weekend receipts — and skips the by-id lookup when no receipt left the window", async () => {
    serve({ roles: [role("r-sep", "sunday_role", "2026-09-06")], receipts: [receipt("rc-sep", "r-sep", "sunday_role:2026-09-06")] });
    await loadSolverHistory({ year: 2026, month: 11 }, { evidence: true });
    expect(queriesRun().sort()).toEqual([ROLES_Q, MEMBERS_Q, RECEIPTS_Q].sort());
  });

  it("with evidence looks up the current documents of receipts that left the window, with canonicalRolesByIdsQuery", async () => {
    serve({
      roles: [],
      receipts: [
        receipt("rc-moved", "r-moved", "sunday_role:2026-10-11"),
        receipt("rc-gone", "r-gone", "saturday_role:2026-09-12", "role_deleted"),
        receipt("rc-future", "r-future", "sunday_role:2026-11-15"),
      ],
      byId: [role("r-moved", "sunday_role", "2026-11-08")],
    });
    await loadSolverHistory({ year: 2026, month: 11 }, { evidence: true });
    expect(operationalFetch).toHaveBeenCalledTimes(4);
    expect(operationalFetch).toHaveBeenCalledWith(BY_IDS_Q, canonicalRolesByIdsQuery(["r-gone", "r-moved"]).params);
  });

  it("an invalid target throws RangeError before any read", async () => {
    serve({});
    await expect(loadSolverHistory({ year: 2026, month: 13 })).rejects.toBeInstanceOf(RangeError);
    await expect(loadSolverHistory({ year: 2026, month: 0 }, { evidence: true })).rejects.toBeInstanceOf(RangeError);
    expect(operationalFetch).not.toHaveBeenCalled();
  });
});

describe("loadSolverHistory — failure is never an empty history (spec, Behavior → Failure)", () => {
  const SANITY_TEXT = "Sanity said: Unauthorized - token invalid for dataset production";

  async function failure(run: () => Promise<unknown>): Promise<unknown> {
    try {
      await run();
    } catch (err) {
      return err;
    }
    throw new Error("expected loadSolverHistory to throw");
  }

  function expectOpaque(err: unknown) {
    expect(err).toBeInstanceOf(SolverHistoryUnavailableError);
    const e = err as Error & { cause?: unknown };
    expect(e.message).toBe(SOLVER_HISTORY_UNAVAILABLE_MESSAGE);
    expect(e.cause).toBeUndefined();
    for (const surface of [e.message, String(e), e.stack ?? "", JSON.stringify(e), JSON.stringify(Object.getOwnPropertyNames(e).map((k) => (e as unknown as Record<string, unknown>)[k]))]) {
      expect(surface).not.toContain("Sanity said");
      expect(surface).not.toContain("token invalid");
    }
    expect(e).not.toHaveProperty("entries");
  }

  it("a failed members read throws, and the throw carries no Sanity message", async () => {
    serve({ roles: [role("r-sep", "sunday_role", "2026-09-06")] }, { members: new Error(SANITY_TEXT) });
    expectOpaque(await failure(() => loadSolverHistory({ year: 2026, month: 11 })));
    // The original is logged on the server, where it helps, never returned.
    expect(consoleError).toHaveBeenCalled();
  });

  it.each(["roles", "receipts", "byIds"] as const)("a failed %s read throws the same opaque error", async (which) => {
    serve(
      { receipts: [receipt("rc-gone", "r-gone", "sunday_role:2026-09-20", "role_deleted")] },
      { [which]: new Error(SANITY_TEXT) },
    );
    expectOpaque(await failure(() => loadSolverHistory({ year: 2026, month: 11 }, { evidence: true })));
  });

  it.each([
    ["roles", { roles: null }],
    ["members", { members: { not: "a list" } }],
    ["receipts", { receipts: undefined }],
  ] as const)("a %s read that returns no list is a failure, never read as empty", async (_which, data) => {
    serve(data as Partial<Dataset>);
    expectOpaque(await failure(() => loadSolverHistory({ year: 2026, month: 11 }, { evidence: true })));
  });

  it("a genuinely empty window is valid, and is three empty entries", async () => {
    serve({});
    const result = await loadSolverHistory({ year: 2026, month: 11 });
    expect(result.entries.map((e) => [e.key, e.total_counts])).toEqual([
      ["2026-8", {}],
      ["2026-9", {}],
      ["2026-10", {}],
    ]);
  });
});

describe("loadSolverHistory — the result", () => {
  const WINDOW_ROLES = [
    role("r-aug", "sunday_role", "2026-08-02"),
    role("r-sep", "saturday_role", "2026-09-12", { creationReceiptId: "rc-sep", creationFingerprint: "0".repeat(64) }),
    role("r-oct", "sunday_role", "2026-10-31", { creationReceiptId: "rc-oct", creationFingerprint: "0".repeat(64) }),
  ];

  it("without evidence returns { target, entries, months, diagnostics } and names only seated members", async () => {
    serve({ roles: WINDOW_ROLES });
    const result = await loadSolverHistory({ year: 2026, month: 11 });
    expect(Object.keys(result)).toEqual(["target", "entries", "months", "diagnostics"]);
    expect(result.target).toEqual({ year: 2026, month: 11 });
    expect(result.entries.map((e) => e.key)).toEqual(["2026-8", "2026-9", "2026-10"]);
    expect(result.entries[0].role_counts).toEqual({ "Ana Prueba": { "Sun.Lead": 1 }, "Beto Ensayo": { "Sun.BGV": 1 } });
    expect(result.months.map((m) => m.services)).toEqual([1, 1, 1]);
    // An unseated member's name never reaches the default payload.
    expect(JSON.stringify(result)).not.toContain("Gabi Infantil");
  });

  it("the target it echoes is exactly { year, month }", async () => {
    serve({});
    const result = await loadSolverHistory({ year: 2026, month: 11, extra: "ignored" } as unknown as { year: number; month: number });
    expect(result.target).toEqual({ year: 2026, month: 11 });
  });

  it("with evidence surfaces moved-out and role_deleted receipts, every member, and a correct control", async () => {
    serve({
      roles: WINDOW_ROLES,
      receipts: [
        // The two window documents' own receipts — fingerprints that cannot match a rebuild.
        receipt("rc-sep", "r-sep", "saturday_role:2026-09-12"),
        receipt("rc-oct", "r-oct", "sunday_role:2026-10-31"),
        // Moved out of the window, into the target month.
        { ...receipt("rc-moved", "r-moved", "sunday_role:2026-10-11"), createdAt: "2026-09-28T10:00:00.000Z" },
        // Deleted since creation.
        receipt("rc-gone", "r-gone", "saturday_role:2026-09-19", "role_deleted"),
        // Outside the window entirely: never surfaced.
        receipt("rc-future", "r-future", "sunday_role:2026-11-15"),
      ],
      byId: [role("r-moved", "sunday_role", "2026-11-08")],
    });
    const result = await loadSolverHistory({ year: 2026, month: 11 }, { evidence: true });
    expect(Object.keys(result)).toEqual(["target", "entries", "months", "diagnostics", "evidence"]);
    const ev = result.evidence!;

    expect(ev.outOfWindowReceipts).toEqual([
      { receiptId: "rc-gone", state: "role_deleted", type: "saturday_role", targetDay: "2026-09-19", createdAt: "2026-09-01T12:00:00.000Z", roleId: "r-gone", roleCurrentDay: null },
      { receiptId: "rc-moved", state: "committed", type: "sunday_role", targetDay: "2026-10-11", createdAt: "2026-09-28T10:00:00.000Z", roleId: "r-moved", roleCurrentDay: "2026-11-08" },
    ]);
    expect(ev.documents.map((d) => [d.roleId, d.receipt.status])).toEqual([
      ["r-aug", "unstamped"],
      ["r-sep", "found"],
      ["r-oct", "found"],
    ]);
    // Two receipts found, neither fingerprint reproduced by its document.
    expect(ev.control).toEqual({ withReceipt: 2, unchanged: 0 });
    // Evidence names every member — the route gates it to super-admin.
    expect(ev.members).toEqual([
      { id: "m-ana", name: "Ana Prueba" },
      { id: "m-beto", name: "Beto Ensayo" },
      { id: "m-kids", name: "Gabi Infantil" },
    ]);
    // The entries do not change with evidence.
    const plain = await (async () => {
      operationalFetch.mockClear();
      return loadSolverHistory({ year: 2026, month: 11 });
    })();
    expect(plain.entries).toEqual(result.entries);
    expect(plain.diagnostics).toEqual(result.diagnostics);
  });
});

describe("module hygiene (R9)", () => {
  const src = readFileSync(resolve(__dirname, "../solverHistoryRead.ts"), "utf8");

  it("is server-only and imports operationalClient directly — a client passed in would be invisible to the audit", () => {
    expect(src).toMatch(/^import "server-only";$/m);
    expect(src).toMatch(/^import \{ operationalClient \} from "@\/sanity\/lib\/operationalClient";$/m);
    expect(src).not.toMatch(/rawIntegrityClient|writeClient|next-sanity|@sanity\/client/);
  });

  it("holds no GROQ: every query comes from a serviceReadQueries builder", () => {
    expect(src).not.toMatch(/\*\[/);
    expect(src).not.toMatch(/_type\s*(==|in)\b/);
    expect(src).toMatch(/from "\.\/serviceReadQueries"/);
  });
});
