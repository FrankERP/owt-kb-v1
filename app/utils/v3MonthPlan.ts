// The MCP month planner's core (MCP P4 step 4): one v3 Auto over a fresh preview, composed
// from the very functions the `/admin` planner runs (D3, parity by construction), with
// server transports. No React, no `fetch` of an app route, no client import.
//
// The browser's sequence, and where each piece comes from:
//   1. the setup step (M4–M7): the horizon (`horizonMonths`), its weekends
//      (`weekendDatesOfMonth`, HZ-3) minus the excluded ones, the specials through the
//      composer's own refusals (`refuseSpecialOn`), the columns (`buildColumns` +
//      `applyCreateCountsEdits` with no edits);
//   2. «Previsualizar» (M9): stored services of the horizon fixed (`v3StoredFor`,
//      ST-1/ST-2), drafts (`cellsToDrafts` against the admin roles rows, E17), one
//      preflight per target (`monthTargetPreflight` over `integrityQueueFor`);
//   3. Auto (M10–M13): `runV3Auto` with `preReadRefusals`, the stored verdict, the ledger
//      read raced against the abort, `buildV3SolveRequest` over the creatable planned
//      columns, `solveV3`; then `settleV3AutoResult`, `runLocalFills`, `cellsToDrafts`.
//
// Declared narrowings (Table M, M14): no «Omitir», no per-column fairness edits, no hand
// cells, «Solo llenar vacíos» off, the STORED rules. D8: any exit but success stores
// nothing, so a failed run's local fills (AD-7) are not computed.

import "server-only";

import type { FairnessLedgerResponse } from "@/app/utils/fairnessVocabulary";
import { countsForFairnessDefault } from "@/app/utils/countsForFairness";
import { serviceDayKey } from "@/app/utils/serviceReadSelect";
import { newCreationRequestId } from "@/app/utils/monthDraftCreate";
import { monthDays, refuseSpecialOn } from "@/app/components/admin/plannerCalendar";
import { MAX_YEAR, MIN_YEAR, buildUnavailabilityNotices, savedWindowFor } from "@/app/components/admin/plannerMonth";
import { integrityQueueFor } from "@/app/components/admin/monthPreflight";
import {
  countedSpecialIdsOf,
  runLocalFills,
  settleV3AutoResult,
  v3PlannedColumnsFor,
  v3PlannedCreateColumns,
  v3StoredFor,
  v3TargetOf,
} from "@/app/components/admin/v3Board";
import {
  buildColumns,
  buildRows,
  cellsToDrafts,
  draftTargetKey,
  type DraftCard,
  type GridCell,
  type GridColumn,
  type GridRow,
} from "@/app/components/admin/plannerModel";
import { applyCreateCountsEdits, effectiveCreateCounts } from "@/app/components/admin/fairnessToggleModel";
import { joinStoredRoleInventory } from "@/app/components/admin/storedRoleReadModel";
import { monthTargetPreflight, type MemberOption } from "@/app/components/admin/serviceCardModel";
import type { TargetPreflight } from "@/app/components/admin/serviceReadiness";
import { horizonMonths, weekendDatesOfMonth } from "@/app/components/admin/v3Horizon";
import { runV3Auto, type V3AutoResult } from "@/app/components/admin/v3AutoRun";
import { buildV3SolveRequest, preReadRefusals } from "@/app/components/admin/v3SolveRequest";
import type { V3ConfirmEntry } from "@/app/components/admin/v3Confirm";
import type { V3RunReport } from "@/app/components/admin/v3RunReport";
import type { V3Names } from "@/app/components/admin/v3Copy";
import type { V3SolveRequest, V3Success } from "@/app/components/admin/v3Wire";
import type { V3PlanSources } from "@/app/utils/v3MonthPlanReads";

/** D1/D5: the soft deadline of a tool call, measured from its handler's start. */
export const MCP_SOFT_DEADLINE_MS = 52_000;
/** D5: the solver's timeout never exceeds this, and is clamped to end by the soft deadline. */
export const MCP_SOLVE_MAX_MS = 45_000;
/** D5: what the call keeps for its own answer after the solve. */
export const MCP_SOLVE_MARGIN_MS = 4_000;
/** D5: below this the solver is not called (`time_budget`). */
export const MCP_SOLVE_MIN_MS = 10_000;

export interface V3MonthPlanInput {
  /** The first horizon month, `YYYY-MM`. */
  month: string;
  months: 1 | 2;
  excludeSundays?: readonly string[];
  excludeSaturdays?: readonly string[];
  specials?: ReadonlyArray<{ date: string; name: string; countsForFairness?: boolean }>;
}

export interface V3MonthPlanDeps {
  /** The four reads (`loadV3PlanSources`). */
  reads: () => Promise<{ ok: true; value: V3PlanSources } | { ok: false; failed: readonly string[] }>;
  /** The fairness ledger for the horizon (`loadV3Ledger`); throws on any failure. */
  readLedger: (months: readonly string[]) => Promise<FairnessLedgerResponse>;
  /** The v3 solver (`solveV3`), with this call's timeout. Never throws. */
  solve: (request: V3SolveRequest, timeoutMs: number) => Promise<{ status: number; text: string }>;
  /** Milliseconds since the tool handler started. */
  elapsedMs: () => number;
  /** The server's CDMX day, `YYYY-MM-DD` (`serviceTodayIso()`). */
  todayIso: string;
  seed: number;
  requestId: string;
}

/** A planned draft, with the preview's preflight for its target (A2: only `creatable` is ever posted). */
export interface V3PlannedDraft {
  draft: DraftCard;
  atSolve: TargetPreflight["state"];
  reasons: string[];
}

export interface V3MonthPlan {
  months: string[];
  /** The stored rules' `_rev` the plan was solved under (D11); `null` = the defaults. */
  rulesRev: string | null;
  requestId: string;
  /** CF-2: the record entries frozen with the request. */
  entries: V3ConfirmEntry[];
  drafts: V3PlannedDraft[];
  /** The horizon's stored role ids, from the snapshot's canonical rows (apply's check (c)). */
  storedServiceIds: string[];
  columns: GridColumn[];
  rows: GridRow[];
  cells: GridCell[];
  unfilled: Array<{ columnId: string; rowId: string; reason?: string }>;
  refusedSpecials: Array<{ date: string; name: string; reason: string }>;
  /** Planned targets left out of the solver request (not creatable at preview, M9). */
  leftOut: Array<{ type: GridColumn["type"]; date: string; serviceName?: string; reasons: string[] }>;
  unavailability: Array<{ name: string; date: string; service: string }>;
  report: V3RunReport;
  names: V3Names;
  notices: string[];
  response: V3Success;
  members: MemberOption[];
}

export type V3MonthPlanResult =
  | { kind: "invalid"; detail: string }
  | { kind: "sources"; failed: string[] }
  | { kind: "no_columns"; refusedSpecials: V3MonthPlan["refusedSpecials"] }
  | { kind: "time_budget" }
  | { kind: "refused"; lines: string[] }
  | { kind: "failed"; lines: string[]; retry: boolean }
  | { kind: "success"; plan: V3MonthPlan };

const MONTH_RE = /^(\d{4})-(\d{2})$/;

/** The horizon's stored role ids, from rows whose service day is `coalesce(week, date)`. */
export function horizonRoleIds(
  rows: ReadonlyArray<Readonly<Record<string, unknown>>>,
  months: readonly string[],
): string[] {
  const ids: string[] = [];
  for (const row of rows) {
    const day = serviceDayKey(row.week ?? row.date);
    if (day && months.includes(day.slice(0, 7)) && typeof row._id === "string") ids.push(row._id);
  }
  return ids.sort();
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Raced against the abort by THIS wrapper: `runV3Auto`'s `bounded()` only aborts and awaits. */
function raceAbort<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("aborted"));
      return;
    }
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    run().then(resolve, reject);
  });
}

export async function planV3Month(input: V3MonthPlanInput, deps: V3MonthPlanDeps): Promise<V3MonthPlanResult> {
  // ── M4: the horizon ────────────────────────────────────────────────────────
  const m = MONTH_RE.exec(input.month);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return { kind: "invalid", detail: "month" };
  const year = Number(m[1]);
  if (year < MIN_YEAR || year > MAX_YEAR) return { kind: "invalid", detail: "month" };
  if (input.months !== 1 && input.months !== 2) return { kind: "invalid", detail: "months" };
  const horizon = horizonMonths(input.month, input.months);

  // ── M5: weekend exclusions name the horizon's own weekends, once each ─────
  const sundaysFull = horizon.flatMap((h) => weekendDatesOfMonth(h).sundays);
  const saturdaysFull = horizon.flatMap((h) => weekendDatesOfMonth(h).saturdays);
  const excludeSundays = [...(input.excludeSundays ?? [])];
  const excludeSaturdays = [...(input.excludeSaturdays ?? [])];
  const repeats = (list: string[]) => new Set(list).size !== list.length;
  if (
    excludeSundays.some((d) => !sundaysFull.includes(d)) ||
    excludeSaturdays.some((d) => !saturdaysFull.includes(d)) ||
    repeats(excludeSundays) ||
    repeats(excludeSaturdays)
  ) {
    return { kind: "invalid", detail: "exclusion_not_weekend_of_horizon" };
  }
  const selectedSundays = sundaysFull.filter((d) => !excludeSundays.includes(d));
  const selectedSaturdays = saturdaysFull.filter((d) => !excludeSaturdays.includes(d));

  // A special on a day outside the horizon has no composer spelling (structural).
  const horizonDays = horizon.flatMap((h) => monthDays(Number(h.slice(0, 4)), Number(h.slice(5, 7))));
  if ((input.specials ?? []).some((s) => !horizonDays.includes(s.date))) {
    return { kind: "invalid", detail: "special_not_in_horizon" };
  }

  // ── M1: the four reads, every source ready ────────────────────────────────
  const read = await deps.reads();
  if (!read.ok) return { kind: "sources", failed: [...read.failed] };
  const { adminRoles, members, rules, snapshot } = read.value;
  const sources = snapshot.readiness.sources;
  const unready = (Object.keys(sources) as (keyof typeof sources)[]).filter((k) => sources[k] !== "ready");
  if (unready.length > 0) return { kind: "sources", failed: unready };
  // The admin rows and the snapshot rows must agree on the horizon's stored services, or a
  // role landed between the two reads: nothing is solved, and a re-solve sees it.
  const storedServiceIds = horizonRoleIds(snapshot.roles, horizon);
  const adminHorizonIds = horizonRoleIds(adminRoles as unknown as Record<string, unknown>[], horizon);
  if (!sameSet(storedServiceIds, adminHorizonIds)) return { kind: "sources", failed: ["roles"] };

  // ── M6: the specials, through the composer's own refusals, in input order ─
  const specials: { date: string; name: string; countsForFairness: boolean }[] = [];
  const refusedSpecials: V3MonthPlan["refusedSpecials"] = [];
  const weekendSelected = (date: string) => selectedSundays.includes(date) || selectedSaturdays.includes(date);
  for (const s of input.specials ?? []) {
    const name = s.name.trim();
    if (!name) {
      refusedSpecials.push({ date: s.date, name: s.name, reason: "Escribe un nombre para el servicio especial." });
      continue;
    }
    const refusal = refuseSpecialOn({ date: s.date, weekendSelected: weekendSelected(s.date), specials, existingRoles: adminRoles });
    if (refusal) {
      refusedSpecials.push({ date: s.date, name, reason: refusal });
      continue;
    }
    const chosen = s.countsForFairness ?? countsForFairnessDefault("special_role");
    specials.push({ date: s.date, name, countsForFairness: effectiveCreateCounts("special_role", s.date, chosen, deps.todayIso) });
  }

  // ── M7/M8: the columns ─────────────────────────────────────────────────────
  const createColumns = applyCreateCountsEdits(
    buildColumns({ sundayDates: selectedSundays, activeSatDates: selectedSaturdays, specials }),
    new Map(),
    deps.todayIso,
  );
  if (createColumns.length === 0) return { kind: "no_columns", refusedSpecials };
  if (createColumns.length !== selectedSundays.length + selectedSaturdays.length + specials.length) {
    // E3: after M5/M6 no two columns can share a date; `buildColumns`' warned drop is a bug here.
    throw new Error("planV3Month: buildColumns dropped a column");
  }

  // ── Preview (M9): stored services fixed, drafts, one preflight per target ──
  const summaries = {
    roles: snapshot.readiness.roleSummary,
    setlists: snapshot.readiness.setlistSummary,
    proposals: snapshot.readiness.proposalSummary,
  };
  const inventory = joinStoredRoleInventory(adminRoles, summaries.roles);
  const v3Stored = v3StoredFor({ rolesReady: true, integrityReady: true, inventory, horizon });
  const storedTargets = new Set(v3Stored.translations.map((t) => v3TargetOf(t.column)));
  const columns = v3PlannedCreateColumns(createColumns, storedTargets);
  const rows = buildRows();
  const previewDrafts = cellsToDrafts([], columns, new Set(), [], adminRoles);
  const queue = integrityQueueFor({ sources, roles: adminRoles, summaries });
  const preflights = new Map<string, TargetPreflight>();
  for (const d of previewDrafts) {
    preflights.set(draftTargetKey(d._type, d.date), monthTargetPreflight({ sources, summaries, queue, type: d._type, date: d.date }));
  }
  const isCreatable = (d: DraftCard) => !d.skipped && preflights.get(draftTargetKey(d._type, d.date))?.state === "creatable";
  const draftByTarget = new Map(previewDrafts.map((d) => [draftTargetKey(d._type, d.date), d]));
  const requestColumns = v3PlannedColumnsFor({ columns, skippedColumnIds: new Set(), draftByTarget, isCreatable });
  const requestIds = new Set(requestColumns.map((c) => c.columnId));
  const leftOut = columns
    .filter((c) => !requestIds.has(c.columnId))
    .map((c) => {
      const pf = preflights.get(draftTargetKey(c.type, c.date));
      const draft = draftByTarget.get(draftTargetKey(c.type, c.date));
      const reasons = pf?.reasons.length ? pf.reasons : draft?.skipped ? ["Ya existe un servicio guardado para este destino."] : [];
      return { type: c.type, date: c.date, ...(c.serviceName ? { serviceName: c.serviceName } : {}), reasons };
    });

  // ── Auto (M10–M13) ───────────────────────────────────────────────────────
  const savedWindow = savedWindowFor(year, Number(m[2]), adminRoles);
  const config = rules.config;
  let budgetExceeded = false;
  const result: V3AutoResult = await runV3Auto({
    months: horizon,
    preRead: () => preReadRefusals({ months: horizon, currentMonth: deps.todayIso.slice(0, 7), config, members }),
    storedReady: () => v3Stored.ready,
    specialsWaiting: countedSpecialIdsOf(columns).size > 0,
    readLedger: (signal) =>
      raceAbort(signal, async () => ({ status: 200, body: JSON.parse(JSON.stringify(await deps.readLedger(horizon))) as unknown })),
    isCurrent: () => true,
    build: (ledger) =>
      buildV3SolveRequest({
        months: horizon,
        currentMonth: deps.todayIso.slice(0, 7),
        ledger,
        config,
        members,
        storedRoles: adminRoles,
        planned: { columns: requestColumns, cells: [], rows },
        savedWindow,
        fillEmpty: false,
        seed: deps.seed,
        requestId: deps.requestId,
      }),
    postSolve: async (request) => {
      const timeoutMs = Math.min(MCP_SOLVE_MAX_MS, MCP_SOFT_DEADLINE_MS - deps.elapsedMs() - MCP_SOLVE_MARGIN_MS);
      if (timeoutMs < MCP_SOLVE_MIN_MS) {
        budgetExceeded = true;
        throw new Error("time_budget");
      }
      return deps.solve(request, timeoutMs);
    },
  });
  if (budgetExceeded) return { kind: "time_budget" };
  if (result.kind === "stale") throw new Error("planV3Month: a server run is never stale");

  const settled = settleV3AutoResult({ result, rows, members });
  if (settled.kind === "refused") return { kind: "refused", lines: [settled.error, ...settled.notices] };
  if (settled.kind === "failed") return { kind: "failed", lines: [settled.error], retry: settled.retry };

  // ── Success: the local fills, then the drafts (counted specials are the pre-fill's) ──
  const filled = runLocalFills({
    config,
    baseCells: settled.applied.cells,
    columns,
    rows,
    members,
    savedWindow,
    fillEmpty: false,
    skipSpecialIds: countedSpecialIdsOf(columns),
  });
  const drafts = cellsToDrafts(filled.cells, columns, new Set(), previewDrafts, adminRoles);

  return {
    kind: "success",
    plan: {
      months: horizon,
      rulesRev: rules.rev,
      requestId: deps.requestId,
      entries: settled.entries,
      drafts: drafts.map((draft) => {
        const pf = preflights.get(draftTargetKey(draft._type, draft.date));
        return { draft, atSolve: pf?.state ?? "unknown", reasons: pf?.reasons ?? [] };
      }),
      storedServiceIds,
      columns,
      rows,
      cells: filled.cells,
      unfilled: [...settled.applied.unfilled, ...filled.filled],
      refusedSpecials,
      leftOut,
      unavailability: buildUnavailabilityNotices(selectedSundays, selectedSaturdays, specials, members),
      report: settled.report,
      names: settled.names,
      notices: settled.notices,
      response: settled.response,
      members,
    },
  };
}

/** A fresh seed and request id, as the browser mints them (`buildV3FromBoard`). */
export function mintSolveIdentity(): { seed: number; requestId: string } {
  return { seed: crypto.getRandomValues(new Uint32Array(1))[0] % 2147483648, requestId: newCreationRequestId() };
}
