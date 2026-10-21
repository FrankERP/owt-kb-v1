// Shared by the proposal editor's tool suites — NOT a test file (no `.test.` in the name).
// Fictitious people only (the repository is public).
//
// One world for the three editor tools AND `apply_schedule`: a proposal stored by the REAL
// `solve_month` (Ana on Nov 1's Lead), an in-memory store of every revision whose save mirrors
// `saveRevision` (child created and base marked together; superseded / refused / lost answer), the
// roles both sides read, and `apply_schedule`'s world (`applyWorld`) over that same store.
import { vi } from "vitest";

import type { SolverConfig } from "@/app/components/admin/plannerModel";
import { ledgerResponse } from "@/app/components/admin/__tests__/v3Fixtures";
import { assembleFairnessLedger } from "@/app/utils/fairnessLedgerRead";
import { snapshot, sources } from "@/app/utils/__tests__/v3MonthPlanFixtures";
import { mergeState, type NewProposalDocument, type StoredProposal } from "../../monthProposals/proposalDocument";
import { memberToken } from "../../monthProposals/memberTokens";
import type { EditorMember } from "../../monthProposals/revise";
import type { EditorDeps } from "../proposalEditor";
import { solveMonthResult } from "../solveMonth";
import { BASE_MS, HANDLE, PRINCIPAL, applyWorld, solveDeps, storedFrom, textOf, type ApplyWorld } from "./monthToolFixtures";
import { MEMBERS, RULES } from "../../monthProposals/__tests__/editorFixtures";

export const TOKEN_KEY = new TextEncoder().encode("t".repeat(32));

export interface EditorWorld {
  store: Map<string, StoredProposal>;
  config: { current: SolverConfig };
  members: { current: EditorMember[] };
  apply: ApplyWorld;
  deps: EditorDeps & {
    saveRevision: ReturnType<typeof vi.fn>;
    reads: ReturnType<typeof vi.fn>;
    readLedger: ReturnType<typeof vi.fn>;
    readFairShare: ReturnType<typeof vi.fn>;
    sweepExpired: ReturnType<typeof vi.fn>;
  };
  /** Runs once inside the next save, before its commit: another writer acting meanwhile. */
  beforeCommit: { current: (() => void) | null };
  applyDeps: ApplyWorld["deps"];
  /** The base proposal's (revision 1) handle. */
  root: string;
  tok(memberId: string): string;
  sid(date: string): string;
}

const handleOf = (id: string) => id.slice(id.indexOf(".") + 1);
let minted = 0;

export async function editorWorld(opts: { config?: SolverConfig; members?: EditorMember[] } = {}): Promise<EditorWorld> {
  const d = solveDeps();
  const solved = await solveMonthResult({ month: "2026-11" }, PRINCIPAL, d);
  if (!d.stored[0]) throw new Error(`solve stored nothing: ${textOf(solved)}`);
  const base = storedFrom(d.stored[0]);
  const store = new Map<string, StoredProposal>([[HANDLE, base]]);
  const config = { current: opts.config ?? RULES };
  const members = { current: opts.members ?? MEMBERS };
  const apply = applyWorld(base, { sourcesOver: { members: members.current as never } });
  const beforeCommit: EditorWorld["beforeCommit"] = { current: null };
  let handles = 0;

  const readSources = () =>
    sources({
      members: members.current as never,
      rules: { rev: base.header.rulesRev!, config: config.current },
      snapshot: snapshot({ roles: apply.roles.map((r) => ({ ...r })) }),
    });

  const deps = {
    engine: () => "v3",
    loadProposal: vi.fn(async (h: string) => (store.has(h) ? { ok: true as const, proposal: store.get(h)! } : { ok: false as const, reason: "not_found" as const })),
    reads: vi.fn(async () => ({ ok: true as const, value: readSources() })),
    readLedger: vi.fn(async (months: readonly string[]) => ledgerResponse([...months])),
    readFairShare: vi.fn(async (input: Parameters<EditorDeps["readFairShare"]>[0]) => {
      const { records, services } = input.adjust({ records: [], services: [] });
      return assembleFairnessLedger({
        target: input.target, records, services,
        members: members.current.map((m) => ({ id: m._id, name: m.alias ?? m.member_name, unavailableDates: m.unavailableDates ?? [] })),
      });
    }),
    // `saveRevision`'s contract over the map: child and base mark land together, or neither.
    saveRevision: vi.fn(async (b: StoredProposal, child: NewProposalDocument, recheck: (fresh: StoredProposal) => Promise<unknown>) => {
      const childHandle = handleOf(child._id);
      const hook = beforeCommit.current;
      beforeCommit.current = null;
      hook?.();
      const current = store.get(handleOf(b.id));
      if (!current) return { ok: false as const, reason: "gone" as const };
      const by = current.state.supersededBy;
      if (by !== undefined) return by === childHandle ? { ok: true as const } : { ok: false as const, reason: "superseded" as const, by };
      if (current.rev !== b.rev) {
        const refusal = await recheck(current);
        if (refusal !== null) return { ok: false as const, reason: "refused" as const, refusal };
      }
      store.set(childHandle, storedFrom(child, "rev-1"));
      store.set(handleOf(b.id), { ...current, rev: `${current.rev}+`, state: mergeState(current.state, { recordsDone: false, created: {}, supersededBy: childHandle }) });
      return { ok: true as const };
    }),
    sweepExpired: vi.fn(async () => ({ ok: true as const, deleted: 0 })),
    tokenKey: () => ({ ok: true as const, key: TOKEN_KEY }),
    environment: () => "local" as const,
    nowMs: () => BASE_MS + 60_000,
    todayIso: () => "2026-10-20",
    newHandle: () => `r${String(++handles).padStart(25, "0")}`,
    mintRequestId: () => `00000000-0000-4000-8000-${String(++minted).padStart(12, "0")}`,
  } as unknown as EditorWorld["deps"];

  // apply_schedule over the same store and roles.
  apply.deps.loadProposal = vi.fn(async (h: string) =>
    store.has(h) ? { ok: true as const, proposal: store.get(h)! } : { ok: false as const, reason: "not_found" as const });
  apply.deps.writeState = vi.fn(async (p: StoredProposal, next: StoredProposal["state"]) => {
    const h = handleOf(p.id);
    const cur = store.get(h)!;
    const merged = mergeState(cur.state, next);
    store.set(h, { ...cur, state: merged, rev: `${cur.rev}+` });
    return { ok: true as const, state: merged };
  });

  return {
    store, config, members, apply, deps, beforeCommit, applyDeps: apply.deps, root: HANDLE,
    tok: (id) => memberToken(TOKEN_KEY, HANDLE, id),
    sid: (date) => base.payload.drafts.find((x) => x.draft.date === date)!.draft.localId,
  };
}
