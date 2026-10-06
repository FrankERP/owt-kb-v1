// Test-only in-memory Content Lake for the fairness write executor — NOT a test file.
//
// The READ client evaluates the executor's real GROQ (the `serviceReadQueries` builders)
// with groq-js over the stored documents, so a builder that silently missed a draft
// filter or a counted special would fail an executor test, not only its own. The WRITE
// client implements exactly what the executor uses — `transaction()` with `create`,
// `patch(id, p => p.ifRevisionId().set().unset())` and `delete`, committed atomically —
// and answers a lost race with the Content Lake's own 409 shape (`sanityConflictKind`'s
// `documentAlreadyExistsError` / `documentRevisionIDDoesNotMatchError`). Every commit's
// operations are logged, so a test asserts the mutations a decision produced.

import type { SanityClient } from "@sanity/client";
import { evaluate, parse } from "groq-js";

export type FakeDoc = Record<string, unknown> & { _id: string; _type: string };

export type FakeOp =
  | { op: "create"; id: string; doc: FakeDoc }
  | { op: "patch"; id: string; ifRevisionId?: string; set?: Record<string, unknown>; unset?: string[] }
  | { op: "delete"; id: string };

/** The patch builder a transaction hands its callback — `@sanity/client`'s `Patch`, as used. */
export interface FakePatchBuilder {
  ifRevisionId(rev: string): FakePatchBuilder;
  set(fields: Record<string, unknown>): FakePatchBuilder;
  unset(keys: string[]): FakePatchBuilder;
}

export function contentLakeConflict(type?: "documentAlreadyExistsError" | "documentRevisionIDDoesNotMatchError") {
  return Object.assign(new Error("Sanity 409 conflict with internal detail"), {
    statusCode: 409,
    details: { type: "mutationError", description: "x", items: type ? [{ error: { type } }] : [] },
  });
}

export function createFakeFairnessSanity(
  initial: FakeDoc[] = [],
  config: { token?: string; perspective?: unknown; useCdn?: boolean } = {
    token: "test-read-token",
    perspective: "published",
    useCdn: false,
  },
) {
  const docs = new Map<string, FakeDoc>();
  for (const d of initial) docs.set(d._id, { _rev: "rev-0", _createdAt: "2026-01-01T00:00:00Z", ...structuredClone(d) });
  const commits: FakeOp[][] = [];
  const reads: Array<{ query: string; params: Record<string, unknown> }> = [];
  const failNext: { commit: unknown; fetch: unknown } = { commit: null, fetch: null };
  const hooks: { beforeCommit: (() => void) | null } = { beforeCommit: null };
  let txCount = 0;

  const read = {
    config: () => ({ ...config }),
    async fetch(query: string, params: Record<string, unknown> = {}): Promise<unknown> {
      reads.push({ query, params });
      if (failNext.fetch) {
        const err = failNext.fetch;
        failNext.fetch = null;
        throw err;
      }
      const dataset = [...docs.values()].map((d) => structuredClone(d));
      return (await evaluate(parse(query, { params }), { dataset, params })).get();
    },
  };

  const write = {
    transaction() {
      const ops: FakeOp[] = [];
      const tx = {
        create(doc: { _id: string; _type: string }) {
          ops.push({ op: "create", id: doc._id, doc: structuredClone(doc) as FakeDoc });
          return tx;
        },
        patch(id: string, build: (p: FakePatchBuilder) => FakePatchBuilder) {
          const call: Extract<FakeOp, { op: "patch" }> = { op: "patch", id };
          const patch: FakePatchBuilder = {
            ifRevisionId(rev: string) {
              call.ifRevisionId = rev;
              return patch;
            },
            set(fields: Record<string, unknown>) {
              call.set = { ...(call.set ?? {}), ...structuredClone(fields) };
              return patch;
            },
            unset(keys: string[]) {
              call.unset = [...(call.unset ?? []), ...keys];
              return patch;
            },
          };
          build(patch);
          ops.push(call);
          return tx;
        },
        delete(id: string) {
          ops.push({ op: "delete", id });
          return tx;
        },
        async commit() {
          const hook = hooks.beforeCommit;
          hooks.beforeCommit = null;
          hook?.();
          if (failNext.commit) {
            const err = failNext.commit;
            failNext.commit = null;
            throw err;
          }
          const next = new Map(docs);
          const rev = `tx-${++txCount}`;
          const now = "2026-10-20T18:00:01Z";
          for (const o of ops) {
            if (o.op === "create") {
              if (next.has(o.id)) throw contentLakeConflict("documentAlreadyExistsError");
              next.set(o.id, { ...o.doc, _rev: rev, _createdAt: now, _updatedAt: now });
            } else if (o.op === "patch") {
              const current = next.get(o.id);
              if (!current) throw contentLakeConflict();
              if (o.ifRevisionId !== undefined && current._rev !== o.ifRevisionId) {
                throw contentLakeConflict("documentRevisionIDDoesNotMatchError");
              }
              const updated: FakeDoc = { ...current, ...(o.set ?? {}), _rev: rev, _updatedAt: now };
              for (const key of o.unset ?? []) delete updated[key];
              next.set(o.id, updated);
            } else {
              if (!next.has(o.id)) throw contentLakeConflict();
              next.delete(o.id);
            }
          }
          docs.clear();
          for (const [k, v] of next) docs.set(k, v);
          commits.push(ops);
          return { transactionId: rev, documentIds: ops.map((o) => o.id), results: ops.map((o) => ({ id: o.id, operation: o.op })) };
        },
      };
      return tx;
    },
  };

  /** Store a document directly (a concurrent writer, or a hand edit), bumping its revision. */
  const put = (doc: FakeDoc) => docs.set(doc._id, { _createdAt: "2026-01-01T00:00:00Z", ...structuredClone(doc), _rev: `rev-ext-${++txCount}` });

  /** The two clients, typed as the executor takes them (IF2-22: `SanityClient`). */
  const clients = { read: read as unknown as SanityClient, write: write as unknown as SanityClient };

  return { read, write, clients, docs, commits, reads, failNext, hooks, put };
}
