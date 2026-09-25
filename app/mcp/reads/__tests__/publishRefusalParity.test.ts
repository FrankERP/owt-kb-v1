// The I4 agreement test: what an MCP read reports as blocking a publish is what
// the publish-ready route actually refuses on (Decision D2).
//
// `publishRefusalFor` is a second copy of the per-service verdict inside
// `POST /api/admin/roles/publish-ready` (`route.ts:173-216`). A copy is safe only
// while it is provably the same thing, so this file runs the REAL route handler,
// one isolated ready-mode POST per fixture service, and demands:
//
//   - `refusals` equals the route's own per-service reasons, in the route's order;
//   - `ready` is true exactly when the route publishes (and then it commits);
//   - `blockers` equals `classifyPublishBlockers` over the snapshot AND the
//     hard/workflow lists the route itself reports on a refusal — never cut short
//     by an earlier refusal.
//
// The route's reads are answered by step 2's strict fixture responder, left
// untouched. Everything the route does beyond those reads — the auth guard, the
// transaction, `after()`, revalidation, push and email — is answered by this
// file's own mocks, copied from `app/api/__tests__/publishReadyRoutes.test.ts`.
// `after()` callbacks are captured and never run, so no post-commit outbox read
// ever reaches the strict responder.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

interface PatchOp {
  kind: "patch";
  id: string;
  rev: string | null;
  set: Record<string, unknown>;
  unset: string[];
}
type TxOp =
  | PatchOp
  | { kind: "create"; doc: Record<string, unknown> }
  | { kind: "createIfNotExists"; doc: Record<string, unknown> }
  | { kind: "delete"; id: string };
interface RecordedTx {
  ops: TxOp[];
  committed: boolean;
}

const h = vi.hoisted(() => ({
  requireActiveManager: vi.fn(),
  operational: vi.fn(),
  raw: vi.fn(),
  sendPush: vi.fn(),
  sendAssignmentEmails: vi.fn(),
  sendAssignmentEmailsBatch: vi.fn(),
  revalidateServiceViews: vi.fn(),
  revalidatePath: vi.fn(),
  afterCallbacks: [] as (() => unknown)[],
  transactions: [] as RecordedTx[],
}));

vi.mock("@/app/utils/authGuards", () => ({
  requireActiveManager: () => h.requireActiveManager(),
}));

vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: (...a: unknown[]) => h.operational(...a) },
  rawIntegrityClient: { fetch: (...a: unknown[]) => h.raw(...a) },
}));

vi.mock("@/sanity/lib/serverClient", () => ({
  serverClient: { fetch: vi.fn() },
  writeClient: { transaction: () => makeTransaction() },
}));

vi.mock("@/app/utils/revalidate", () => ({
  revalidateServiceViews: (...a: unknown[]) => h.revalidateServiceViews(...a),
}));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => h.revalidatePath(...a) }));
vi.mock("@/app/utils/push", () => ({ sendPush: (...a: unknown[]) => h.sendPush(...a) }));
vi.mock("@/app/utils/assignmentEmail", () => ({
  sendAssignmentEmails: (...a: unknown[]) => h.sendAssignmentEmails(...a),
  sendAssignmentEmailsBatch: (...a: unknown[]) => h.sendAssignmentEmailsBatch(...a),
  assigneesOf: () => [],
}));
vi.mock("next/server", async (importOriginal) => {
  const mod = await importOriginal<typeof import("next/server")>();
  return { ...mod, after: (fn: () => unknown) => void h.afterCallbacks.push(fn) };
});

import { POST as publishReadyPOST } from "@/app/api/admin/roles/publish-ready/route";
import { assembleService } from "@/app/utils/publishReadyBundle";
import { classifyPublishBlockers } from "@/app/components/admin/publishSelection";
import { PUBLISH_SKIP_COPY } from "@/app/components/admin/serviceCardModel";
import { serviceTodayIso } from "@/app/components/admin/serviceReadiness";
import { loadServiceSnapshot } from "../serviceSnapshot";
import { publishRefusalFor, type PublishRefusal } from "../publishRefusal";
import {
  READINESS_DOMAINS,
  SERVICE_FIXTURE_CASES,
  SERVICE_FIXTURE_ROLE_IDS,
  createFixtureResponder,
  serviceFixtureStore,
  type FixtureCall,
  type FixtureResponder,
  type ServiceFixtureStore,
} from "./serviceFixtures";

// ── Transaction recorder (the shape `publishReadyRoutes.test.ts` records) ──────

function makeTransaction() {
  const record: RecordedTx = { ops: [], committed: false };
  h.transactions.push(record);
  const tx = {
    create(doc: Record<string, unknown>) {
      record.ops.push({ kind: "create", doc });
      return tx;
    },
    createIfNotExists(doc: Record<string, unknown>) {
      record.ops.push({ kind: "createIfNotExists", doc });
      return tx;
    },
    delete(id: string) {
      record.ops.push({ kind: "delete", id });
      return tx;
    },
    patch(id: string, fn: (p: unknown) => unknown) {
      const op: PatchOp = { kind: "patch", id, rev: null, set: {}, unset: [] };
      const p = {
        ifRevisionId(rev: string) {
          op.rev = rev;
          return p;
        },
        set(values: Record<string, unknown>) {
          Object.assign(op.set, values);
          return p;
        },
        unset(fields: string[]) {
          op.unset.push(...fields);
          return p;
        },
      };
      fn(p);
      record.ops.push(op);
      return tx;
    },
    async commit() {
      record.committed = true;
      return { transactionId: "t1" };
    },
  };
  return tx;
}

// ── One isolated POST, one isolated snapshot ────────────────────────────────

/** Noon in Mexico City on 2026-09-24: every fixture service is in the future. */
const FROZEN_INSTANT = "2026-09-24T18:00:00.000Z";
const FROZEN_DAY = "2026-09-24";

const ADMIN = { user: { role: "admin" } };

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  // Only `Date`: the route and the loaders await promises, never timers, and a
  // faked `setTimeout` could stall anything that does.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(FROZEN_INSTANT));
  h.requireActiveManager.mockResolvedValue(ADMIN);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  errorSpy.mockRestore();
});

/**
 * Wire BOTH clients to a fresh strict responder, and record every read it
 * refused. A refused read becomes a failed domain inside the loaders, which
 * would make both sides agree for the wrong reason — so each test asserts none.
 */
function wireStrict(responder: FixtureResponder): string[] {
  const refused: string[] = [];
  const strict =
    (serve: FixtureResponder["operational"]) =>
    async (query: string, params?: Record<string, unknown>) => {
      try {
        return await serve(query, params);
      } catch (err) {
        refused.push(err instanceof Error ? err.message.slice(0, 80) : "non-error rejection");
        throw err;
      }
    };
  h.operational.mockImplementation(strict(responder.operational));
  h.raw.mockImplementation(strict(responder.raw));
  return refused;
}

function req(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

interface RouteRejection {
  id: string;
  reasons: string[];
  hardBlockers?: string[];
  workflowBlockers?: string[];
}

interface RouteVerdict {
  status: number;
  /** The response's top-level `error`, or null on success. */
  error: string | null;
  /** This service's refusal reasons as the route reported them; `[]` when it published. */
  codes: string[];
  /** The route's own rejection row for this service, when it refused with one. */
  rejection: RouteRejection | null;
  committed: RecordedTx[];
  afterCallbacks: number;
  reads: FixtureCall[];
  refusedReads: string[];
}

function roleRev(store: ServiceFixtureStore, id: string): string {
  const rev = store.roles.find((r) => r._id === id)?._rev;
  return typeof rev === "string" ? rev : "rev-of-a-missing-role";
}

/** ONE ready-mode POST for ONE service, over its own fresh store and responder. */
async function postReady(id: string): Promise<RouteVerdict> {
  h.transactions.length = 0;
  h.afterCallbacks.length = 0;
  const store = serviceFixtureStore();
  const responder = createFixtureResponder(store);
  const refusedReads = wireStrict(responder);

  const res = await publishReadyPOST(req({ mode: "ready", roles: [{ id, rev: roleRev(store, id) }] }));
  const body = (await res.json()) as {
    error?: string;
    details?: { ids?: string[]; services?: RouteRejection[] };
  };

  let codes: string[];
  let rejection: RouteRejection | null = null;
  if (res.status === 200) {
    codes = [];
  } else if (res.status === 404 && body.error === "not_found") {
    if (JSON.stringify(body.details?.ids) !== JSON.stringify([id])) {
      throw new Error(`not_found names the wrong ids: ${JSON.stringify(body.details)}`);
    }
    codes = ["not_found"];
  } else if (res.status === 409 && Array.isArray(body.details?.services)) {
    const rows = body.details.services;
    if (rows.length !== 1 || rows[0].id !== id) {
      throw new Error(`one POST must reject exactly its own service: ${JSON.stringify(rows)}`);
    }
    rejection = rows[0];
    codes = rows[0].reasons;
  } else {
    throw new Error(`unexpected route answer for ${id}: ${res.status} ${JSON.stringify(body)}`);
  }

  return {
    status: res.status,
    error: body.error ?? null,
    codes,
    rejection,
    committed: h.transactions.filter((t) => t.committed),
    afterCallbacks: h.afterCallbacks.length,
    reads: responder.calls,
    refusedReads,
  };
}

interface SnapshotAnswer {
  answer: PublishRefusal;
  classified: ReturnType<typeof classifyPublishBlockers> | null;
  refusedReads: string[];
}

/** The MCP side: `loadServiceSnapshot()` → `assembleService` → `publishRefusalFor`. */
async function snapshotAnswer(id: string): Promise<SnapshotAnswer> {
  const refusedReads = wireStrict(createFixtureResponder(serviceFixtureStore()));
  const snapshot = await loadServiceSnapshot();
  const assembled = assembleService(snapshot.readiness, id);
  return {
    answer: publishRefusalFor(assembled),
    classified: assembled ? classifyPublishBlockers(assembled.readiness) : null,
    refusedReads,
  };
}

const HARD_ROUTE_CODES = new Set(["hard_integrity_blocker", "unusable_observation"]);

// ── The clock ───────────────────────────────────────────────────────────────

describe("the frozen clock", () => {
  it("puts today in Mexico City on the frozen day, before every fixture service", () => {
    expect(serviceTodayIso()).toBe(FROZEN_DAY);
    for (const role of serviceFixtureStore().roles) {
      const day = (role.week ?? role.date) as string;
      expect(day > FROZEN_DAY, `${role._id} on ${day}`).toBe(true);
    }
  });
});

// ── Parity, one service at a time ───────────────────────────────────────────

describe("publishRefusalFor agrees with the publish-ready route", () => {
  it.each(SERVICE_FIXTURE_ROLE_IDS.map((id) => [id]))("%s", async (id) => {
    const route = await postReady(id);
    const mcp = await snapshotAnswer(id);

    // Both sides decided from the whole fixture, with nothing refused.
    expect(route.refusedReads).toEqual([]);
    expect(mcp.refusedReads).toEqual([]);
    expect([...new Set(route.reads.map((c) => c.domain))].sort()).toEqual([...READINESS_DOMAINS].sort());

    // The refusal verdict, in the route's order.
    expect(route.codes).not.toContain("stale_revision"); // the fixture's own `_rev` was sent
    expect(mcp.answer.refusals).toEqual(route.codes);
    expect(mcp.answer.ready).toBe(route.status === 200);
    expect(mcp.answer.copy).toHaveLength(mcp.answer.refusals.length);

    if (route.status === 200) {
      // The route really published: one committed transaction flipping this role.
      expect(mcp.answer.refusals).toEqual([]);
      expect(route.committed).toHaveLength(1);
      const flip = route.committed[0].ops.find(
        (o): o is PatchOp => o.kind === "patch" && o.id === id,
      );
      expect(flip?.set.published).toBe(true);
    } else {
      // The route refused before any write and deferred nothing.
      expect(route.committed).toEqual([]);
      expect(h.transactions).toEqual([]);
      expect(route.afterCallbacks).toBe(0);
      expect(route.error).toBe(
        mcp.answer.refusals.some((c) => HARD_ROUTE_CODES.has(c)) ? "integrity_conflict" : "stale_revision",
      );
    }

    // `blockers` is the full classification, whatever the route refused on.
    expect(mcp.answer.blockers).toStrictEqual(mcp.classified);
    if (route.rejection) {
      expect(mcp.answer.blockers).toStrictEqual({
        workflow: route.rejection.workflowBlockers,
        hard: route.rejection.hardBlockers,
      });
    } else {
      expect(mcp.answer.blockers).toStrictEqual({ workflow: [], hard: [] });
    }
    expect(mcp.answer.blockerCopy).toStrictEqual({
      hard: mcp.answer.blockers!.hard.map((c) => PUBLISH_SKIP_COPY[c]),
      workflow: mcp.answer.blockers!.workflow.map((c) => PUBLISH_SKIP_COPY[c]),
    });
  });

  it("agrees on an id that names no service: not_found", async () => {
    const route = await postReady("role-missing");
    const mcp = await snapshotAnswer("role-missing");
    expect(route.status).toBe(404);
    expect(route.codes).toEqual(["not_found"]);
    expect(route.committed).toEqual([]);
    expect(mcp.answer).toStrictEqual({
      ready: false,
      refusals: ["not_found"],
      copy: [mcp.answer.copy[0]],
      blockers: null,
      blockerCopy: null,
    });
    expect(mcp.answer.copy[0]).toMatch(/\S/);
  });

  it("is never asked about a drafts.* id: the route rejects the request before reading", async () => {
    const res = await publishReadyPOST(
      req({ mode: "ready", roles: [{ id: "drafts.role-sp-draftonly", rev: "any-rev" }] }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_request");
    expect(h.operational).not.toHaveBeenCalled();
    expect(h.raw).not.toHaveBeenCalled();
    // The predicate stays conservative for it all the same.
    const mcp = await snapshotAnswer("drafts.role-sp-draftonly");
    expect(mcp.answer.ready).toBe(false);
  });
});

// ── The matrix exercises every code the predicate models ─────────────────────

describe("the fixture matrix, as the route sees it", () => {
  it("covers every modelled refusal, a published service and a live service with a gap", async () => {
    const verdicts = new Map<string, RouteVerdict>();
    for (const id of [...SERVICE_FIXTURE_ROLE_IDS, "role-missing"]) verdicts.set(id, await postReady(id));

    const seen = new Set([...verdicts.values()].flatMap((v) => v.codes));
    for (const code of ["hard_integrity_blocker", "unusable_observation", "already_published", "not_ready", "not_found"]) {
      expect(seen, code).toContain(code);
    }

    const publishable = SERVICE_FIXTURE_CASES.filter((c) => c.readyToPublish).map((c) => c.roleId);
    const published = [...verdicts].filter(([, v]) => v.status === 200).map(([id]) => id);
    expect(published.sort()).toEqual(publishable.sort());
    expect(published.length).toBeGreaterThanOrEqual(2);

    // A LIVE service that lost its setlist: the route refuses it as already
    // published AND not ready — it does not stop at the first reason.
    expect(verdicts.get("role-sun-1115-live")!.codes).toEqual(["already_published", "not_ready"]);
    const live = await snapshotAnswer("role-sun-1115-live");
    expect(live.answer.blockers).toStrictEqual({ workflow: ["incomplete_setlist"], hard: [] });
  });
});

// ── Copy ────────────────────────────────────────────────────────────────────

describe("publishRefusalFor copy", () => {
  it("takes the admin's own Spanish copy where it exists and a fixed fallback elsewhere", async () => {
    const byCode = new Map<string, string>();
    for (const id of [...SERVICE_FIXTURE_ROLE_IDS, "role-missing"]) {
      const { answer } = await snapshotAnswer(id);
      answer.refusals.forEach((code, i) => {
        const text = answer.copy[i];
        expect(text, code).toMatch(/\S/);
        if (byCode.has(code)) expect(text, code).toBe(byCode.get(code));
        byCode.set(code, text);
      });
    }
    expect(byCode.get("already_published")).toBe(PUBLISH_SKIP_COPY.already_published);
    expect(byCode.get("not_ready")).toBe(PUBLISH_SKIP_COPY.not_ready);
    for (const code of ["hard_integrity_blocker", "unusable_observation", "not_found"]) {
      expect(Object.hasOwn(PUBLISH_SKIP_COPY, code), code).toBe(false);
      expect(byCode.get(code), code).toMatch(/\S/);
    }
  });
});
