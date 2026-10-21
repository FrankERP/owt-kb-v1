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
/** The next transaction commit throws this instead (a non-conflict failure). */
let txFailure: unknown = null;

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
      type Op = { kind: "delete"; id: string } | { kind: "create"; doc: Doc } | { kind: "patch"; id: string; rev?: string; fields: Record<string, unknown> };
      const ops: Op[] = [];
      const tx = {
        delete(id: string) { ops.push({ kind: "delete", id }); return tx; },
        create(doc: Doc) { ops.push({ kind: "create", doc }); return tx; },
        patch(id: string, build: (p: unknown) => unknown) {
          const op: Op = { kind: "patch", id, fields: {} };
          const b = { ifRevisionId(r: string) { op.rev = r; return b; }, set(f: Record<string, unknown>) { op.fields = f; return b; } };
          build(b);
          ops.push(op);
          return tx;
        },
        // All or nothing, as the Content Lake commits a transaction.
        async commit() {
          const stage = beforeCommit;
          beforeCommit = null;
          if (stage) await stage();
          if (txFailure) { const e = txFailure; txFailure = null; throw e; }
          for (const op of ops) {
            if (op.kind === "create" && docs.has(op.doc._id)) {
              throw Object.assign(new Error("exists"), {
                statusCode: 409,
                details: { type: "mutationError", items: [{ error: { type: "documentAlreadyExistsError" } }] },
              });
            }
            if (op.kind === "patch") {
              const forced = forcedConflicts.get(op.id) ?? 0;
              if (forced > 0) { forcedConflicts.set(op.id, forced - 1); throw conflict(); }
              const d = docs.get(op.id);
              if (!d || (op.rev !== undefined && d._rev !== op.rev)) throw conflict();
            }
          }
          for (const op of ops) {
            if (op.kind === "delete") { docs.delete(op.id); deleted.push(op.id); }
            if (op.kind === "create") docs.set(op.doc._id, { ...op.doc, _rev: nextRev() });
            if (op.kind === "patch") docs.set(op.id, { ...docs.get(op.id)!, ...op.fields, _rev: nextRev() });
          }
        },
      };
      return tx;
    },
  },
}));

import { planV3Month } from "@/app/utils/v3MonthPlan";
import { deps } from "@/app/utils/__tests__/v3MonthPlanFixtures";
import { PROPOSAL_TTL_MS, buildProposal, type NewProposalDocument, type StoredProposal } from "../proposalDocument";
import { STATE_WRITE_RETRIES, SWEEP_GRACE_MS, createProposal, loadProposal, saveRevision, sweepExpired, writeState } from "../proposalStore";
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

const CHILD = "abcdefghjkmnpqrs0123456789";
const OTHER = "zzzzzzzzzzzzzzzzzzzzzzzzzz";

/** A revision of HANDLE's record, as the editor's save builds it (same frozen payload, v2). */
async function childDoc(handle = CHILD, saveId = "save_0123456789"): Promise<NewProposalDocument> {
  const out = await planV3Month({ month: "2026-11", months: 1 }, deps());
  if (out.kind !== "success") throw new Error("expected a plan");
  const plan = out.plan;
  const b = buildProposal({
    handle, origin: "https://owt-backstage.vercel.app", principal: "member-frank", nowMs: NOW + 60_000,
    rulesRev: plan.rulesRev, months: plan.months, requestId: `${plan.requestId}-r2`,
    payload: { entries: plan.entries, drafts: plan.drafts, storedServiceIds: plan.storedServiceIds },
    revision: {
      lineage: { parent: HANDLE, revision: 2, root: HANDLE },
      expiresAt: new Date(NOW + PROPOSAL_TTL_MS).toISOString(),
      waivers: [], baseline: [], checked: true, saveId,
    },
  });
  if (!b.ok) throw new Error("expected a revision");
  return b.doc;
}

const passes = async () => null;

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
  txFailure = null;
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

describe("saveRevision (editor plan T2.2)", () => {
  async function stateOf(handle: string) {
    const l = await loadProposal(handle);
    return l.ok ? l.proposal.state : null;
  }

  it("creates the child and marks the base in one commit, keeping the base's facts", async () => {
    const base = await stored();
    await writeState(base, { recordsDone: true, created: {} });
    const fresh = await loadProposal(HANDLE);
    if (!fresh.ok) throw new Error("expected a record");
    expect(await saveRevision(fresh.proposal, await childDoc(), passes)).toEqual({ ok: true });
    expect(await stateOf(HANDLE)).toEqual({ recordsDone: true, created: {}, supersededBy: CHILD });
    const child = await loadProposal(CHILD);
    expect(child.ok && child.proposal.header.lineage).toEqual({ parent: HANDLE, revision: 2, root: HANDLE });
  });

  it("a concurrent state write is re-judged on the fresh base and retried", async () => {
    const base = await stored();
    const [a] = base.payload.drafts;
    beforeCommit = async () => {
      expect((await writeState(base, { recordsDone: false, created: { [a.draft.localId]: "role-a" } })).ok).toBe(true);
    };
    const seen: unknown[] = [];
    const out = await saveRevision(base, await childDoc(), async (fresh) => { seen.push(fresh.state); return null; });
    expect(out).toEqual({ ok: true });
    expect(seen).toEqual([{ recordsDone: false, created: { [a.draft.localId]: "role-a" } }]);
    expect(await stateOf(HANDLE)).toEqual({ recordsDone: false, created: { [a.draft.localId]: "role-a" }, supersededBy: CHILD });
  });

  it("a fresh base the caller now refuses (it started applying) writes nothing", async () => {
    const base = await stored();
    const [a] = base.payload.drafts;
    beforeCommit = async () => { await writeState(base, { recordsDone: true, created: { [a.draft.localId]: "role-a" } }); };
    const out = await saveRevision(base, await childDoc(), async (fresh) => (Object.keys(fresh.state.created).length > 0 ? "applying" : null));
    expect(out).toEqual({ ok: false, reason: "refused", refusal: "applying" });
    expect(docs.has(proposalIdOf(CHILD))).toBe(false);
    expect((await stateOf(HANDLE))?.supersededBy).toBeUndefined();
  });

  it("a sibling save that landed first is refused by name, and the loser's child never exists", async () => {
    const base = await stored();
    beforeCommit = async () => { expect(await saveRevision(base, await childDoc(OTHER, "save_other_0001"), passes)).toEqual({ ok: true }); };
    const recheck = vi.fn(passes);
    expect(await saveRevision(base, await childDoc(), recheck)).toEqual({ ok: false, reason: "superseded", by: OTHER });
    expect(recheck).not.toHaveBeenCalled();
    expect(docs.has(proposalIdOf(CHILD))).toBe(false);
    expect((await stateOf(HANDLE))?.supersededBy).toBe(OTHER);
  });

  it("a base already superseded is refused without a write; by this very child, it is the lost answer's success", async () => {
    const base = await stored();
    expect(await saveRevision(base, await childDoc(OTHER, "save_other_0001"), passes)).toEqual({ ok: true });
    const marked = await loadProposal(HANDLE);
    if (!marked.ok) throw new Error("expected a record");
    const writes = revCounter;
    expect(await saveRevision(marked.proposal, await childDoc(), passes)).toEqual({ ok: false, reason: "superseded", by: OTHER });
    expect(await saveRevision(marked.proposal, await childDoc(OTHER, "save_other_0001"), passes)).toEqual({ ok: true });
    expect(revCounter).toBe(writes);
  });

  it("an apply's state write after the supersede keeps it", async () => {
    const base = await stored();
    const [a] = base.payload.drafts;
    beforeCommit = async () => { expect(await saveRevision(base, await childDoc(), passes)).toEqual({ ok: true }); };
    const out = await writeState(base, { recordsDone: true, created: { [a.draft.localId]: "role-a" } });
    expect(out).toEqual({ ok: true, state: { recordsDone: true, created: { [a.draft.localId]: "role-a" }, supersededBy: CHILD } });
    expect((await stateOf(HANDLE))?.supersededBy).toBe(CHILD);
  });

  it("losing every race is a conflict; a base swept away is gone; any other failure is server_error, not retried", async () => {
    let base = await stored();
    forcedConflicts.set(base.id, STATE_WRITE_RETRIES + 1);
    expect(await saveRevision(base, await childDoc(), passes)).toEqual({ ok: false, reason: "conflict" });
    expect(docs.has(proposalIdOf(CHILD))).toBe(false);

    const l = await loadProposal(HANDLE);
    if (!l.ok) throw new Error("expected a record");
    base = l.proposal;
    txFailure = new Error("network");
    expect(await saveRevision(base, await childDoc(), passes)).toMatchObject({ ok: false, reason: "server_error" });

    docs.delete(base.id);
    expect(await saveRevision(base, await childDoc(), passes)).toEqual({ ok: false, reason: "gone" });
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
