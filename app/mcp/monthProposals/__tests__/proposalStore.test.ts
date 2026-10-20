// MCP P4 step 5 — the proposal store over an in-memory Sanity that enforces `ifRevisionId` the
// way the Content Lake does (a 409 `documentRevisionIDDoesNotMatchError`): create never
// overwrites, a load reads one type through a `$type` parameter, two concurrent `state` writes
// end as their union (D6), four lost races report a failure with every fact kept, and the sweep
// keeps its 24 h grace (D12).
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type Doc = Record<string, unknown> & { _id: string; _rev: string };
const docs = new Map<string, Doc>();
let revCounter = 0;
const nextRev = () => `rev-${++revCounter}`;
/** Ids whose next N patches lose the race regardless of the revision asserted. */
const forcedConflicts = new Map<string, number>();
/** Runs once between a patch's revision check and its commit, to stage a concurrent write. */
let beforeCommit: (() => Promise<void>) | null = null;

const conflict = () =>
  Object.assign(new Error("conflict"), {
    statusCode: 409,
    details: { type: "mutationError", items: [{ error: { type: "documentRevisionIDDoesNotMatchError" } }] },
  });

const fetchMock = vi.fn(async (query: string, params: Record<string, unknown>) => {
  if (params.id !== undefined) {
    const d = docs.get(params.id as string);
    return d && d._type === params.type ? { ...d } : null;
  }
  return [...docs.values()]
    .filter((d) => d._type === params.type && String(d.expiresAt) < String(params.cutoff))
    .sort((a, b) => String(a.expiresAt).localeCompare(String(b.expiresAt)))
    .slice(0, 25)
    .map((d) => d._id);
});
const deleted: string[] = [];

vi.mock("@/sanity/lib/serverClient", () => ({
  writeClient: {
    create: vi.fn(async (doc: Doc) => {
      if (docs.has(doc._id)) {
        throw Object.assign(new Error("exists"), {
          statusCode: 409,
          details: { type: "mutationError", items: [{ error: { type: "documentAlreadyExistsError" } }] },
        });
      }
      docs.set(doc._id, { ...doc, _rev: nextRev() });
    }),
    createOrReplace: vi.fn(() => { throw new Error("createOrReplace must never be called"); }),
    fetch: (q: string, p: Record<string, unknown>) => fetchMock(q, p),
    patch: (id: string) => {
      let rev: string | undefined;
      let fields: Record<string, unknown> = {};
      const b = {
        ifRevisionId(r: string) { rev = r; return b; },
        set(f: Record<string, unknown>) { fields = f; return b; },
        async commit() {
          const stage = beforeCommit;
          beforeCommit = null;
          if (stage) await stage();
          const forced = forcedConflicts.get(id) ?? 0;
          if (forced > 0) { forcedConflicts.set(id, forced - 1); throw conflict(); }
          const d = docs.get(id);
          if (!d || (rev !== undefined && d._rev !== rev)) throw conflict();
          docs.set(id, { ...d, ...fields, _rev: nextRev() });
        },
      };
      return b;
    },
    transaction: () => {
      const ids: string[] = [];
      const tx = { delete(id: string) { ids.push(id); return tx; }, async commit() { for (const id of ids) { docs.delete(id); deleted.push(id); } } };
      return tx;
    },
  },
}));

import { planV3Month } from "@/app/utils/v3MonthPlan";
import { deps } from "@/app/utils/__tests__/v3MonthPlanFixtures";
import { buildProposal, type NewProposalDocument, type StoredProposal } from "../proposalDocument";
import { STATE_WRITE_RETRIES, SWEEP_GRACE_MS, createProposal, loadProposal, sweepExpired, writeState } from "../proposalStore";
import { proposalIdOf } from "../handle";

const HANDLE = "0123456789abcdefghjkmnpqrs";
const NOW = Date.parse("2026-10-20T21:00:00.000Z");

async function proposalDoc(handle = HANDLE, nowMs = NOW): Promise<NewProposalDocument> {
  const out = await planV3Month({ month: "2026-11", months: 1 }, deps());
  if (out.kind !== "success") throw new Error("expected a plan");
  const plan = out.plan;
  const b = buildProposal({
    handle, origin: "https://owt-backstage.vercel.app", principal: "member-frank", nowMs,
    rulesRev: plan.rulesRev, months: plan.months, requestId: plan.requestId,
    payload: { entries: plan.entries, drafts: plan.drafts, storedServiceIds: plan.storedServiceIds },
  });
  if (!b.ok) throw new Error("expected a document");
  return b.doc;
}

async function stored(): Promise<StoredProposal> {
  await createProposal(await proposalDoc());
  const l = await loadProposal(HANDLE);
  if (!l.ok) throw new Error("expected a record");
  return l.proposal;
}

beforeEach(() => {
  docs.clear();
  forcedConflicts.clear();
  deleted.length = 0;
  beforeCommit = null;
  fetchMock.mockClear();
});

describe("create and load", () => {
  it("round-trips, reading one type through a `$type` parameter", async () => {
    const p = await stored();
    expect(p.id).toBe(proposalIdOf(HANDLE));
    const [query, params] = fetchMock.mock.calls[0];
    expect(query).toContain("_type == $type");
    expect(query).not.toContain("mcpProposal");
    expect(params).toMatchObject({ type: "mcpProposal", id: proposalIdOf(HANDLE) });
  });

  it("create never overwrites a record at the same handle", async () => {
    const doc = await proposalDoc();
    expect(await createProposal(doc)).toEqual({ ok: true });
    expect((await createProposal(doc)).ok).toBe(false);
  });

  it("a malformed handle reads nothing; a missing or malformed record is not_found", async () => {
    expect(await loadProposal("NOT-A-HANDLE")).toEqual({ ok: false, reason: "not_found" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await loadProposal(HANDLE)).toEqual({ ok: false, reason: "not_found" });
    const doc = await proposalDoc();
    docs.set(doc._id, { ...doc, _rev: "r", principal: "someone-else" });
    expect(await loadProposal(HANDLE)).toEqual({ ok: false, reason: "not_found" });
  });

  it("a read failure is server_error, never not_found", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network"));
    expect(await loadProposal(HANDLE)).toMatchObject({ ok: false, reason: "server_error" });
  });
});

describe("writeState (D6)", () => {
  it("patches under the observed revision", async () => {
    const p = await stored();
    const [a] = p.payload.drafts;
    const out = await writeState(p, { recordsDone: true, created: { [a.draft.localId]: "role-a" } });
    expect(out).toEqual({ ok: true, state: { recordsDone: true, created: { [a.draft.localId]: "role-a" } } });
    const after = await loadProposal(HANDLE);
    expect(after.ok && after.proposal.state.created).toEqual({ [a.draft.localId]: "role-a" });
  });

  it("two concurrent applies of one proposal end as the union of their facts", async () => {
    const p = await stored();
    const [a, b] = p.payload.drafts;
    // The second apply lands between the first's read and its commit.
    beforeCommit = async () => {
      const r = await writeState(p, { recordsDone: false, created: { [b.draft.localId]: "role-b" } });
      expect(r.ok).toBe(true);
    };
    const first = await writeState(p, { recordsDone: true, created: { [a.draft.localId]: "role-a" } });
    expect(first).toEqual({ ok: true, state: { recordsDone: true, created: { [a.draft.localId]: "role-a", [b.draft.localId]: "role-b" } } });
    const after = await loadProposal(HANDLE);
    expect(after.ok && after.proposal.state).toEqual(first.ok && first.state);
  });

  it("losing the race on every attempt reports a conflict and keeps every fact", async () => {
    const p = await stored();
    const [a] = p.payload.drafts;
    forcedConflicts.set(p.id, STATE_WRITE_RETRIES + 1);
    const out = await writeState(p, { recordsDone: true, created: { [a.draft.localId]: "role-a" } });
    expect(out).toEqual({ ok: false, reason: "conflict", state: { recordsDone: true, created: { [a.draft.localId]: "role-a" } } });
  });

  it("three lost races then a win is a success", async () => {
    const p = await stored();
    forcedConflicts.set(p.id, STATE_WRITE_RETRIES);
    expect((await writeState(p, { recordsDone: true, created: {} })).ok).toBe(true);
  });

  it("a record swept from under it is `gone`, with the facts", async () => {
    const p = await stored();
    docs.delete(p.id);
    expect(await writeState(p, { recordsDone: true, created: {} })).toEqual({ ok: false, reason: "gone", state: { recordsDone: true, created: {} } });
  });
});

describe("sweepExpired (D12)", () => {
  it("deletes only records expired more than 24 h ago", async () => {
    const TTL = 7 * 24 * 60 * 60 * 1000;
    await createProposal(await proposalDoc("aaaaaaaaaaaaaaaaaaaaaaaaaa", NOW - TTL - SWEEP_GRACE_MS - 1));
    await createProposal(await proposalDoc("bbbbbbbbbbbbbbbbbbbbbbbbbb", NOW - TTL - SWEEP_GRACE_MS + 60_000));
    await createProposal(await proposalDoc("cccccccccccccccccccccccccc", NOW));
    expect(await sweepExpired(NOW)).toEqual({ ok: true, deleted: 1 });
    expect(deleted).toEqual([proposalIdOf("aaaaaaaaaaaaaaaaaaaaaaaaaa")]);
  });

  it("never deletes an id it did not mint, and writes nothing when nothing is due", async () => {
    fetchMock.mockResolvedValueOnce(["teamMembers.x", "mcpOauthGrant.y"]);
    expect(await sweepExpired(NOW)).toEqual({ ok: true, deleted: 0 });
    expect(deleted).toEqual([]);
  });
});
