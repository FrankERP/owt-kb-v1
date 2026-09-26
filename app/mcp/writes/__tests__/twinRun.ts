// The twin-run harness (P3 step 7) — test-only, NOT a test file (no `.test.`
// in the name, so vitest's `include` never collects it).
//
// WHAT IT PROVES. A write tool must land the same document diff, queue the
// same notifications to the same people and revalidate the same paths as its
// `/admin` counterpart (spec I8, I12, I15). The harness runs BOTH over one
// fixture — the real admin route handler with a mocked `requireActiveManager`,
// and the tool's own result function — and hands back, per run:
//
//   { response, transactions, outboxUpserts, pushes, emails, sweeps,
//     revalidations, reads, refusedReads, afterErrors, store }
//
// Parity is asserted on `parityView(run)` — writes, notifications, sweeps and
// revalidation — NEVER on the read count: the tool also makes its pre-reads,
// its admission reads and its report reads, which the route does not.
//
// HOW (P1's `publishRefusalParity` pattern, extended):
//   - ONE fixture DEFINITION (a function returning documents), but a FRESH
//     store instance per run (preflight M6): a single mutable store would show
//     the second run the first run's commit and refuse it `stale_revision`.
//   - A STRICT responder: every read is answered from the store through a
//     table keyed by the canonical builders' own query text (`TwinQuery`), on
//     the one client the table names. An unknown query, a wrong client or a
//     fixed-param query with other params REJECTS and is recorded in
//     `refusedReads` — assert it empty, or a loader that failed would make the
//     two runs agree for the wrong reason.
//   - A transaction recorder that APPLIES what it commits to the store, with
//     Sanity's own conflict shapes: `ifRevisionId` against the stored `_rev`
//     and `create` against an existing id (409 `mutationError`). A report's
//     read-back therefore sees the committed state and its new `_rev`.
//     `race` lands a concurrent write before the first commit;
//     `failFirstCommit` makes it throw.
//   - `after()` callbacks are captured and RUN once the action returns, in
//     order, so the outbox upserts and the pushes they make are recorded.
//   - `sendPush`, `sendAssignmentEmailsBatch`, `sweepOutbox`, `revalidatePath`
//     and `revalidateServiceViews` are recorded, never executed.
//   - `nextKey` is deterministic (`key-1`, `key-2`, … restarting per run) via a
//     partial mock of `@/app/utils/roleWriteOps`; `Date` is frozen per run.
//
// HOW TO USE. `vi.mock` is hoisted per file, so each test file declares the
// mocks itself and points them at this harness's factories:
//
//   vi.mock("server-only", () => ({}));
//   const t = await vi.hoisted(async () => {
//     const { createTwinHarness } = await import("@/app/mcp/writes/__tests__/twinRun");
//     return createTwinHarness();
//   });
//   vi.mock("@/app/utils/authGuards", () => t.mocks.authGuards());
//   vi.mock("@/sanity/lib/operationalClient", () => t.mocks.operationalClient());
//   vi.mock("@/sanity/lib/serverClient", () => t.mocks.serverClient());
//   vi.mock("@/app/utils/push", () => t.mocks.push());
//   vi.mock("@/app/utils/assignmentEmail", async (orig) => t.mocks.assignmentEmail(await orig()));
//   vi.mock("@/app/utils/outboxSweep", async (orig) => t.mocks.outboxSweep(await orig()));
//   vi.mock("@/app/utils/revalidate", () => t.mocks.revalidate());
//   vi.mock("next/cache", () => t.mocks.nextCache());
//   vi.mock("next/server", async (orig) => t.mocks.nextServer(await orig()));
//   vi.mock("@/app/utils/roleWriteOps", async (orig) => t.mocks.roleWriteOps(await orig()));
//
// This module imports nothing but `vitest`, so loading it inside `vi.hoisted`
// cannot pull a to-be-mocked module in before its mock is registered. Query
// tables are built by the test file, from the builders, after the mocks.
// `twinRun.test.ts` proves the harness itself.

import { vi } from "vitest";

// ── The store ───────────────────────────────────────────────────────────────

export type TwinDoc = Record<string, unknown> & { _id: string; _type: string };

export interface TwinStore {
  readonly docs: Map<string, TwinDoc>;
  /** The next revision id; every document one transaction touches gets the same one. */
  nextRev(): string;
}

/** A fresh store over a deep copy of `docs`: nothing a run writes reaches the fixture definition. */
export function createTwinStore(docs: readonly TwinDoc[]): TwinStore {
  const map = new Map<string, TwinDoc>();
  for (const doc of docs) map.set(doc._id, structuredClone(doc));
  let n = 0;
  return { docs: map, nextRev: () => `twin-rev-${++n}` };
}

const isDraftId = (id: string) => id.startsWith("drafts.");

/** The published-perspective documents of these types (no `drafts.*`), as stored. */
export function canonicalDocs(store: TwinStore, types: readonly string[]): TwinDoc[] {
  return [...store.docs.values()].filter((d) => !isDraftId(d._id) && types.includes(d._type));
}

/** The raw `drafts.*` documents of these types, as stored. */
export function draftDocs(store: TwinStore, types: readonly string[]): TwinDoc[] {
  return [...store.docs.values()].filter((d) => isDraftId(d._id) && types.includes(d._type));
}

/** A GROQ-style projection of top-level fields: an absent field projects as `null`. */
export function project(doc: TwinDoc, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) out[field] = field in doc ? structuredClone(doc[field]) : null;
  return out;
}

// ── The strict responder ────────────────────────────────────────────────────

export type TwinClient = "operational" | "raw";

/** One canonical query the store answers. */
export interface TwinQuery {
  /** A short name for failure messages and `reads`. */
  label: string;
  /** The ONE client this query may run on. */
  client: TwinClient;
  /** A sample call of the builder; its query TEXT keys the table (the params vary by call). */
  bound: { query: string; params: Record<string, unknown> };
  /** When true, a call's params must equal `bound.params` exactly. */
  fixedParams?: boolean;
  /** The rows for one call. */
  rows: (store: TwinStore, params: Record<string, unknown>) => unknown;
}

export interface TwinRead {
  client: TwinClient;
  label: string;
  params: Record<string, unknown>;
}

// ── The transaction recorder ────────────────────────────────────────────────

export interface TwinPatchOp {
  kind: "patch";
  id: string;
  ifRevisionId: string | null;
  set: Record<string, unknown>;
  setIfMissing: Record<string, unknown>;
  unset: string[];
}

export type TwinTxOp =
  | TwinPatchOp
  | { kind: "create"; doc: Record<string, unknown> }
  | { kind: "createIfNotExists"; doc: Record<string, unknown> }
  | { kind: "delete"; id: string };

export interface TwinOutboxUpsert {
  doc: Record<string, unknown>;
  patchSet: Record<string, unknown>;
}

/** Sanity's 409 `mutationError`, the shape `sanityConflictKind` classifies. */
export function sanityConflict(type: "documentRevisionIDDoesNotMatchError" | "documentAlreadyExistsError") {
  return Object.assign(new Error(`twin store: 409 ${type}`), {
    statusCode: 409,
    details: { type: "mutationError", description: type, items: [{ error: { type } }] },
  });
}

const OUTBOX_TYPE = "notificationOutbox";

function assertTopLevel(fields: Record<string, unknown> | string[]) {
  for (const path of Array.isArray(fields) ? fields : Object.keys(fields)) {
    if (/[.[\]]/.test(path)) {
      // A keyed/nested path patch (e.g. a seat-level swap). No tool builds one
      // (ruling P3-R17); fail loudly rather than apply it wrong.
      throw new Error(`twin store: nested patch path is not supported: ${path}`);
    }
  }
}

/** Applies `ops` all-or-nothing, the way one Sanity transaction commits. */
function applyTransaction(store: TwinStore, ops: readonly TwinTxOp[]): void {
  const next = new Map(store.docs);
  const rev = store.nextRev();
  for (const op of ops) {
    if (op.kind === "create") {
      const id = String(op.doc._id);
      if (next.has(id)) throw sanityConflict("documentAlreadyExistsError");
      next.set(id, { ...(structuredClone(op.doc) as TwinDoc), _rev: rev });
    } else if (op.kind === "createIfNotExists") {
      const id = String(op.doc._id);
      if (!next.has(id)) next.set(id, { ...(structuredClone(op.doc) as TwinDoc), _rev: rev });
    } else if (op.kind === "delete") {
      next.delete(op.id);
    } else {
      const current = next.get(op.id);
      if (!current) throw Object.assign(new Error(`twin store: patch of a missing document`), { statusCode: 404 });
      if (op.ifRevisionId !== null && op.ifRevisionId !== current._rev) {
        throw sanityConflict("documentRevisionIDDoesNotMatchError");
      }
      assertTopLevel(op.set);
      assertTopLevel(op.setIfMissing);
      assertTopLevel(op.unset);
      const doc: TwinDoc = structuredClone(current);
      for (const [key, value] of Object.entries(op.setIfMissing)) if (!(key in doc)) doc[key] = structuredClone(value);
      for (const [key, value] of Object.entries(op.set)) doc[key] = structuredClone(value);
      for (const key of op.unset) delete doc[key];
      doc._rev = rev;
      next.set(op.id, doc);
    }
  }
  store.docs.clear();
  for (const [id, doc] of next) store.docs.set(id, doc);
}

// ── One run's record ────────────────────────────────────────────────────────

export interface TwinRun<R> {
  response: R;
  /** Every committed business transaction, in order (outbox upserts excluded). */
  transactions: TwinTxOp[][];
  /** Every committed outbox upsert, in order. */
  outboxUpserts: TwinOutboxUpsert[];
  pushes: { memberIds: string[]; category: string; payload: unknown }[];
  /** Every `sendAssignmentEmailsBatch` argument. */
  emails: unknown[];
  /** How many times the layer-2 sweep was started. */
  sweeps: number;
  /** `revalidateServiceViews()` and each `revalidatePath(...)`, in call order. */
  revalidations: string[];
  reads: TwinRead[];
  refusedReads: string[];
  /** `after()` callbacks that threw (the side-effect helpers swallow their own). */
  afterErrors: number;
  /** The store after the run: committed writes applied. */
  store: TwinStore;
}

/** What a twin run is compared on: never the reads, which legitimately differ. */
export function parityView<R>(run: TwinRun<R>) {
  return {
    transactions: run.transactions,
    outboxUpserts: run.outboxUpserts,
    pushes: run.pushes,
    emails: run.emails,
    sweeps: run.sweeps,
    revalidations: run.revalidations,
  };
}

export interface TwinRunOptions {
  /** The fixture definition: called once per run for a fresh store. */
  fixture: () => readonly TwinDoc[];
  queries: readonly TwinQuery[];
  /** Lands a concurrent write on the store just before the run's FIRST commit (a race). */
  race?: (store: TwinStore) => void;
  /** Makes the run's first commit throw this instead (e.g. a non-conflict failure). */
  failFirstCommit?: unknown;
}

/** An admin route handler as the route module exports it. */
export type TwinRouteHandler = (req: never) => Promise<Response> | Response;

/** Noon in Mexico City on 2026-09-24, before every fixture service. */
export const TWIN_FROZEN_INSTANT = "2026-09-24T18:00:00.000Z";

/** The session `requireActiveManager` returns: a live super-admin, the MCP principal's role. */
export const TWIN_MANAGER_SESSION = { user: { id: "mem-frank", role: "super-admin" } };

// ── The harness ─────────────────────────────────────────────────────────────

export function createTwinHarness() {
  const state = {
    store: null as TwinStore | null,
    table: new Map<string, TwinQuery>(),
    keys: 0,
    session: TWIN_MANAGER_SESSION as unknown,
    frozenInstant: TWIN_FROZEN_INSTANT,
    afterQueue: [] as (() => unknown)[],
    beforeCommit: null as ((store: TwinStore) => void) | null,
    failNextCommit: null as unknown,
    record: null as Omit<TwinRun<unknown>, "response" | "store"> | null,
  };

  function current() {
    if (!state.record || !state.store) throw new Error("twin harness: no run in progress");
    return { record: state.record, store: state.store };
  }

  const serve = (client: TwinClient) => async (query: string, params: Record<string, unknown> = {}) => {
    const { record, store } = current();
    const entry = state.table.get(query);
    const refuse = (why: string) => {
      record.refusedReads.push(why);
      return new Error(`twin responder: ${why}`);
    };
    if (!entry) throw refuse(`unknown query on ${client}: ${query.slice(0, 70)}`);
    if (entry.client !== client) throw refuse(`${entry.label} read on the ${client} client`);
    if (entry.fixedParams && JSON.stringify(entry.bound.params) !== JSON.stringify(params)) {
      throw refuse(`${entry.label} read with unexpected params`);
    }
    record.reads.push({ client, label: entry.label, params: structuredClone(params) });
    return structuredClone(entry.rows(store, params));
  };

  const strictNoRead = (name: string) => async () => {
    const why = `${name}.fetch is not a read the writers make`;
    state.record?.refusedReads.push(why);
    throw new Error(`twin responder: ${why}`);
  };

  function makeTransaction() {
    const ops: TwinTxOp[] = [];
    const tx = {
      create(doc: Record<string, unknown>) {
        ops.push({ kind: "create", doc: structuredClone(doc) });
        return tx;
      },
      createIfNotExists(doc: Record<string, unknown>) {
        ops.push({ kind: "createIfNotExists", doc: structuredClone(doc) });
        return tx;
      },
      delete(id: string) {
        ops.push({ kind: "delete", id });
        return tx;
      },
      patch(id: string, fn: (p: unknown) => unknown) {
        if (typeof fn !== "function") throw new Error("twin store: only the patch(id, fn) form is recorded");
        const op: TwinPatchOp = { kind: "patch", id, ifRevisionId: null, set: {}, setIfMissing: {}, unset: [] };
        const p = {
          ifRevisionId(rev: string) {
            op.ifRevisionId = rev;
            return p;
          },
          set(values: Record<string, unknown>) {
            Object.assign(op.set, structuredClone(values));
            return p;
          },
          setIfMissing(values: Record<string, unknown>) {
            Object.assign(op.setIfMissing, structuredClone(values));
            return p;
          },
          unset(fields: string[]) {
            op.unset.push(...fields);
            return p;
          },
        };
        fn(p);
        ops.push(op);
        return tx;
      },
      async commit() {
        const { record, store } = current();
        const hook = state.beforeCommit;
        state.beforeCommit = null;
        hook?.(store);
        if (state.failNextCommit) {
          const err = state.failNextCommit;
          state.failNextCommit = null;
          throw err;
        }
        applyTransaction(store, ops);
        const outboxIds = new Set(
          ops.flatMap((op) => (op.kind === "createIfNotExists" && op.doc._type === OUTBOX_TYPE ? [String(op.doc._id)] : [])),
        );
        const isOutbox =
          outboxIds.size > 0 &&
          ops.every(
            (op) =>
              (op.kind === "createIfNotExists" && outboxIds.has(String(op.doc._id))) ||
              (op.kind === "patch" && outboxIds.has(op.id)),
          );
        if (isOutbox) {
          for (const op of ops) {
            if (op.kind !== "createIfNotExists") continue;
            const patch = ops.find((o): o is TwinPatchOp => o.kind === "patch" && o.id === op.doc._id);
            record.outboxUpserts.push({ doc: op.doc, patchSet: patch?.set ?? {} });
          }
        } else {
          record.transactions.push(ops);
        }
        return { transactionId: `twin-tx-${record.transactions.length + record.outboxUpserts.length}` };
      },
    };
    return tx;
  }

  const mocks = {
    authGuards: () => ({ requireActiveManager: async () => state.session }),
    operationalClient: () => ({
      operationalClient: { fetch: (q: string, p?: Record<string, unknown>) => serve("operational")(q, p) },
      rawIntegrityClient: { fetch: (q: string, p?: Record<string, unknown>) => serve("raw")(q, p) },
    }),
    serverClient: () => ({
      serverClient: { fetch: strictNoRead("serverClient") },
      writeClient: { fetch: strictNoRead("writeClient"), transaction: () => makeTransaction() },
    }),
    push: () => ({
      sendPush: async (memberIds: string[], category: string, payload: unknown) => {
        current().record.pushes.push({ memberIds: [...memberIds], category, payload: structuredClone(payload) });
        return { sent: 0, pruned: 0 };
      },
    }),
    assignmentEmail: <M extends Record<string, unknown>>(actual: M) => ({
      ...actual,
      sendAssignmentEmailsBatch: async (services: unknown) => {
        current().record.emails.push(structuredClone(services));
      },
      sendAssignmentEmails: async () => {
        throw new Error("twin harness: sendAssignmentEmails has no production caller");
      },
    }),
    outboxSweep: <M extends Record<string, unknown>>(actual: M) => ({
      ...actual,
      sweepOutbox: async () => {
        current().record.sweeps += 1;
        return undefined;
      },
    }),
    revalidate: () => ({
      revalidateServiceViews: () => current().record.revalidations.push("revalidateServiceViews()"),
    }),
    nextCache: () => ({
      revalidatePath: (path: string, type?: string) =>
        current().record.revalidations.push(`revalidatePath(${path}${type ? `, ${type}` : ""})`),
    }),
    nextServer: <M extends Record<string, unknown>>(actual: M) => ({
      ...actual,
      after: (fn: () => unknown) => void state.afterQueue.push(fn),
    }),
    roleWriteOps: <M extends Record<string, unknown>>(actual: M) => ({
      ...actual,
      nextKey: () => `key-${++state.keys}`,
    }),
  };

  /** One isolated run over a fresh store, with its `after()` callbacks drained. */
  async function run<R>(options: TwinRunOptions, action: () => Promise<R>): Promise<TwinRun<R>> {
    state.store = createTwinStore(options.fixture());
    state.table = new Map(options.queries.map((q) => [q.bound.query, q]));
    state.keys = 0;
    state.afterQueue = [];
    state.beforeCommit = options.race ?? null;
    state.failNextCommit = options.failFirstCommit ?? null;
    state.record = {
      transactions: [],
      outboxUpserts: [],
      pushes: [],
      emails: [],
      sweeps: 0,
      revalidations: [],
      reads: [],
      refusedReads: [],
      afterErrors: 0,
    };
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(state.frozenInstant));

    const response = await action();
    while (state.afterQueue.length) {
      const callback = state.afterQueue.shift() as () => unknown;
      try {
        await callback();
      } catch {
        state.record.afterErrors += 1;
      }
    }
    const { record, store } = current();
    state.record = null;
    return { ...record, response, store };
  }

  /** The real admin route handler, as `/admin` calls it. */
  function runRoute(options: TwinRunOptions, handler: TwinRouteHandler, body: unknown) {
    return run(options, async () => {
      const req = { json: async () => structuredClone(body), headers: new Headers() };
      const res = await (handler as (req: unknown) => Promise<Response>)(req);
      return { status: res.status, body: (await res.json()) as unknown };
    });
  }

  /** The tool, through its own result function (what its registered handler calls). */
  function runTool<R>(options: TwinRunOptions, call: () => Promise<R>) {
    return run(options, call);
  }

  /** Both, each over its own fresh store from the same fixture definition. */
  async function twin<R>(options: TwinRunOptions, route: { handler: TwinRouteHandler; body: unknown }, tool: () => Promise<R>) {
    const routeRun = await runRoute(options, route.handler, route.body);
    const toolRun = await runTool(options, tool);
    return { route: routeRun, tool: toolRun };
  }

  return {
    mocks,
    run,
    runRoute,
    runTool,
    twin,
    /** Set the session the next runs see (e.g. a content-editor, to prove the tool never asks). */
    setSession(session: unknown) {
      state.session = session;
    },
  };
}

export type TwinHarness = ReturnType<typeof createTwinHarness>;
