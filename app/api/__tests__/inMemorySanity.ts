// Test-only in-memory stand-in for `writeClient` — NOT a test file (no `.test.`
// in the name, so vitest's `include` never picks it up).
//
// Route tests replace `@/sanity/lib/serverClient` with this, so the REAL grant
// store runs underneath the route: a second `create()` on one id really
// conflicts, a revision-guarded patch really loses a race with a 409, and a
// revocation really lands in the stored document. Tests can then assert the
// states the spec cares about ("the grant is now revoked") rather than which
// mock was called. Extracted from `oauthTokenRoute.test.ts` (P0 step 8) when
// the MCP route test (P0 step 9) needed the same dataset.
//
// Use it from inside `vi.hoisted`, because `vi.mock` factories are hoisted
// above every import:
//
//   const h = await vi.hoisted(async () => {
//     const { createInMemorySanity } = await import("./inMemorySanity");
//     return { ...createInMemorySanity(), getMemberAccess: vi.fn() };
//   });
//   vi.mock("@/sanity/lib/serverClient", () => ({ writeClient: h.writeClient, serverClient: { fetch: vi.fn() } }));
//
// Only the calls the grant store makes are implemented: `create`, `fetch` of
// one document by `$id`/`$type`, and `patch(id).ifRevisionId().set().commit()`.

export type FakeDoc = Record<string, unknown> & { _id: string; _type: string; _rev: string };

export interface FakePatchCall {
  id: string;
  ifRevisionId?: string;
  set?: Record<string, unknown>;
}

export function createInMemorySanity() {
  const docs = new Map<string, FakeDoc>();
  const creates: Record<string, unknown>[] = [];
  const patches: FakePatchCall[] = [];
  let rev = 0;
  const nextRev = () => `rev-${++rev}`;
  const conflict = (type: string) =>
    Object.assign(new Error("Sanity 409 conflict with internal detail"), {
      statusCode: 409,
      details: { type: "mutationError", description: "x", items: [{ error: { type } }] },
    });
  /** One-shot failures injected by a test, consumed by the next call of that kind. */
  const failNext: { create: unknown; fetch: unknown; commit: unknown } = { create: null, fetch: null, commit: null };
  /** Runs just before a patch commits — lets a test land a concurrent write first. */
  const hooks: { beforeCommit: (() => void) | null } = { beforeCommit: null };

  const writeClient = {
    async create(doc: Record<string, unknown>) {
      if (failNext.create) {
        const err = failNext.create;
        failNext.create = null;
        throw err;
      }
      const id = doc._id as string;
      if (docs.has(id)) throw conflict("documentAlreadyExistsError");
      creates.push(doc);
      docs.set(id, { ...(doc as FakeDoc), _rev: nextRev() });
      return doc;
    },
    async fetch(_query: string, params: { id: string; type: string }) {
      if (failNext.fetch) {
        const err = failNext.fetch;
        failNext.fetch = null;
        throw err;
      }
      const d = docs.get(params.id);
      return d && d._type === params.type ? structuredClone(d) : null;
    },
    patch(id: string) {
      const call: FakePatchCall = { id };
      const builder = {
        ifRevisionId(r: string) {
          call.ifRevisionId = r;
          return builder;
        },
        set(fields: Record<string, unknown>) {
          call.set = fields;
          return builder;
        },
        async commit() {
          patches.push(call);
          hooks.beforeCommit?.();
          hooks.beforeCommit = null;
          if (failNext.commit) {
            const err = failNext.commit;
            failNext.commit = null;
            throw err;
          }
          const d = docs.get(id);
          if (!d) throw Object.assign(new Error("not found"), { statusCode: 404 });
          if (call.ifRevisionId !== undefined && call.ifRevisionId !== d._rev) {
            throw conflict("documentRevisionIDDoesNotMatchError");
          }
          Object.assign(d, call.set ?? {}, { _rev: nextRev() });
          return structuredClone(d);
        },
      };
      return builder;
    },
  };

  return {
    docs,
    creates,
    patches,
    failNext,
    hooks,
    conflict,
    bumpRev: (id: string) => {
      const d = docs.get(id);
      if (d) d._rev = nextRev();
    },
    reset() {
      docs.clear();
      creates.length = 0;
      patches.length = 0;
      failNext.create = failNext.fetch = failNext.commit = null;
      hooks.beforeCommit = null;
    },
    writeClient,
  };
}
