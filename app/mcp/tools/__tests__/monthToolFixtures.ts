// Shared by the `solve_month` and `apply_schedule` suites — NOT a test file (no `.test.` in the
// name). Fictitious people only (the repository is public).
//
// `solveDeps` runs the REAL `planV3Month` over the planner fixtures' injected transports and
// keeps every stored proposal in memory; `storedFrom` turns one into what `loadProposal` would
// answer. `applyWorld` is the data `apply_schedule` sees: the roles a snapshot read returns, a
// `createRole` that honours creation receipts the way the roles POST does (same request id →
// a replay, never a second role), a fairness PUT that answers each month's expected outcome,
// and a proposal record whose `state` merges like the store's.
import { vi } from "vitest";

import { planV3Month } from "@/app/utils/v3MonthPlan";
import { receiptIdForRequestId } from "@/app/utils/roleCreationReceipt";
import { deps as planDeps, snapshot, sources, successFor } from "@/app/utils/__tests__/v3MonthPlanFixtures";
import type { V3SolveRequest } from "@/app/components/admin/v3Wire";
import type { V3PlanSources } from "@/app/utils/v3MonthPlanReads";
import { mergeState, parseProposal, type NewProposalDocument, type StoredProposal } from "../../monthProposals/proposalDocument";
import type { McpPrincipal } from "../../monthProposals/principal";
import type { SolveMonthDeps } from "../solveMonth";
import type { ApplyScheduleDeps } from "../applySchedule";

export const BASE_MS = Date.parse("2026-10-20T18:00:00.000Z");
export const HANDLE = "0123456789abcdefghjkmnpqrs";
export const PRINCIPAL: McpPrincipal = { sub: "m-admin", origin: "https://owt.example" };

type Row = Record<string, unknown>;

/** The solver's answer: Ana leads the first service, so the report has a name to print. */
export const solveWithAna = vi.fn(async (request: V3SolveRequest) => ({
  status: 200,
  text: successFor(request, { [request.services[0].id]: { Lead: ["m-ana"] } }),
}));

export type SpiedSolveDeps = SolveMonthDeps & {
  stored: NewProposalDocument[];
  createProposal: ReturnType<typeof vi.fn>;
  sweepExpired: ReturnType<typeof vi.fn>;
  reads: ReturnType<typeof vi.fn>;
  solve: ReturnType<typeof vi.fn>;
};

export function solveDeps(over: Partial<SolveMonthDeps> = {}): SpiedSolveDeps {
  const base = planDeps({ solve: solveWithAna });
  const stored: NewProposalDocument[] = [];
  return {
    engine: () => "v3",
    plan: planV3Month,
    reads: base.reads,
    readLedger: base.readLedger,
    solve: base.solve,
    identity: () => ({ seed: 7, requestId: "req-1" }),
    todayIso: () => "2026-10-20",
    nowMs: () => BASE_MS,
    newHandle: () => HANDLE,
    createProposal: vi.fn(async (doc: NewProposalDocument) => {
      stored.push(doc);
      return { ok: true as const };
    }),
    sweepExpired: vi.fn(async () => ({ ok: true as const, deleted: 0 })),
    stored,
    ...over,
  } as SpiedSolveDeps;
}

/** What `loadProposal` answers for a stored document. */
export function storedFrom(doc: NewProposalDocument, rev = "rev-1"): StoredProposal {
  const parsed = parseProposal({ ...doc, _rev: rev });
  if (!parsed) throw new Error("the stored proposal does not parse");
  return parsed;
}

export interface ApplyWorld {
  roles: Row[];
  proposal: StoredProposal | null;
  clock: { t: number };
  deps: ApplyScheduleDeps & {
    loadProposal: ReturnType<typeof vi.fn>;
    reads: ReturnType<typeof vi.fn>;
    commitRecords: ReturnType<typeof vi.fn>;
    createRole: ReturnType<typeof vi.fn>;
    writeState: ReturnType<typeof vi.fn>;
    sweepExpired: ReturnType<typeof vi.fn>;
  };
}

export interface ApplyWorldOptions {
  roles?: Row[];
  rulesRev?: string | null;
  todayIso?: string;
  /** Milliseconds each create takes on the injected clock. */
  createMs?: number;
  /** Called after a role is inserted; may throw to lose the answer. */
  afterInsert?: (n: number) => void;
  sourcesOver?: Partial<V3PlanSources>;
}

export function applyWorld(proposal: StoredProposal, opts: ApplyWorldOptions = {}): ApplyWorld {
  const w = { roles: [...(opts.roles ?? [])], proposal: proposal as StoredProposal | null, clock: { t: BASE_MS } } as ApplyWorld;
  let next = 0;
  let inserted = 0;
  w.deps = {
    engine: () => "v3",
    nowMs: () => w.clock.t,
    todayIso: () => opts.todayIso ?? "2026-10-20",
    loadProposal: vi.fn(async (handle: string) =>
      w.proposal && handle === HANDLE ? { ok: true as const, proposal: w.proposal } : { ok: false as const, reason: "not_found" as const }),
    // R-OBS: each call sees the roles as they are when it reads.
    reads: vi.fn(async () => ({
      ok: true as const,
      value: sources({
        rules: { rev: opts.rulesRev === undefined ? proposal.header.rulesRev : opts.rulesRev, config: sources().rules.config },
        snapshot: snapshot({ roles: w.roles.map((r) => ({ ...r })) }),
        ...(opts.sourcesOver ?? {}),
      }),
    })),
    commitRecords: vi.fn(async () => ({
      ok: true as const,
      status: 200 as const,
      body: { months: proposal.payload.entries.map((e) => ({ month: e.month, outcome: e.expects[0] })) },
      effects: { months: [] },
    })),
    createRole: vi.fn(async (body: Row) => {
      await Promise.resolve();
      // Check and insert in one turn: the receipt is the create mutex.
      const receipt = receiptIdForRequestId(body.creationRequestId as string);
      const existing = w.roles.find((r) => r.creationReceiptId === receipt);
      w.clock.t += opts.createMs ?? 0;
      if (existing) {
        return { ok: true as const, status: 200 as const, body: { roleId: existing._id }, effects: { kind: "replay" as const, roleId: existing._id as string } };
      }
      const roleId = `role-${++next}`;
      w.roles.push({
        _id: roleId,
        _type: body._type,
        ...(body._type === "special_role" ? { date: body.date, service_name: body.service_name } : { week: body.date }),
        creationReceiptId: receipt,
      });
      opts.afterInsert?.(++inserted);
      return { ok: true as const, status: 201 as const, body: { roleId }, effects: { kind: "created" as const, roleId, push: {}, notice: null } };
    }),
    writeState: vi.fn(async (p: StoredProposal, nextState: StoredProposal["state"]) => {
      const merged = mergeState(w.proposal?.state ?? p.state, nextState);
      if (w.proposal) w.proposal = { ...w.proposal, state: merged, rev: `${w.proposal.rev}+` };
      return { ok: true as const, state: merged };
    }),
    sweepExpired: vi.fn(async () => ({ ok: true as const, deleted: 0 })),
  } as unknown as ApplyWorld["deps"];
  return w;
}

export const textOf = (r: { content: Array<{ type: string; text?: string }> }): string =>
  r.content.map((c) => (c.type === "text" ? c.text ?? "" : "")).join("\n");
