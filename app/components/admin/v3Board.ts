// app/components/admin/v3Board.ts
//
// The board half of the v3 planner's Auto, lifted out of `MonthGenerator.tsx` (a
// "use client" module) as functions of their inputs, so the MCP month planner
// (`app/utils/v3MonthPlan.ts`) composes a v3 Auto from the very code the browser
// runs (MCP P4, D3: parity by construction). Each function is the body of one
// block that was inline in the component; the component keeps every setter, ref and
// lock and calls these where the blocks were.
//
// Neutral: no React, no "use client", nothing that reads a session or the network.

import { normalizeServiceName } from "@/app/utils/normalizeLabel";
import type { ParticipantRole } from "@/app/utils/computeParticipation";
import type { RankMember } from "./candidateRanking";
import { fillColumn } from "./localFill";
import { fillInstruments } from "./instrumentFill";
import {
  draftTargetKey,
  type DraftCard,
  type GridCell,
  type GridColumn,
  type GridRow,
  type SolverConfig,
} from "./plannerModel";
import { translateStoredRole, type StoredGridTranslation, type StoredRoleInventory } from "./storedRoleReadModel";
import { freezeConfirmEntries, type V3ConfirmEntry } from "./v3Confirm";
import type { V3AutoResult } from "./v3AutoRun";
import { transportLine } from "./v3Copy";
import { applyV3Assignments, v3OutcomeLine, v3RetryOffered } from "./v3SolveResponse";
import { buildV3RunReport, v3Names, type V3RunReport } from "./v3RunReport";
import type { V3Names } from "./v3Copy";
import type { V3Success } from "./v3Wire";

/** C6 ST-2: a service's target — a weekend type and date, or a special's date and normalized name (ADR-0011). */
export function v3TargetOf(c: Pick<GridColumn, "type" | "date" | "serviceName">): string {
  return c.type === "special_role" ? `special_role|${c.date}|${normalizeServiceName(c.serviceName) ?? ""}` : `${c.type}|${c.date}`;
}

/**
 * Solver v3 C6 ST-1: every stored service of a horizon month, from the SAME full-roster read and
 * the SAME coherence verdict the stored editor uses, shown read-only («Guardado»). A read that is
 * not ready or not coherent, or a horizon role whose translation is refused, is not ready: Auto
 * refuses on it (Task 15). The body of `MonthGenerator`'s `v3Stored` memo under v3 create mode.
 */
export function v3StoredFor(input: {
  rolesReady: boolean;
  integrityReady: boolean;
  inventory: StoredRoleInventory;
  horizon: readonly string[];
}): { ready: boolean; translations: StoredGridTranslation[] } {
  const { inventory, horizon } = input;
  const ready = input.rolesReady && input.integrityReady && inventory.coherent;
  if (!ready) return { ready: false, translations: [] };
  const translated = inventory.roles
    .filter((o) => horizon.includes(o.role.date.slice(0, 7)))
    .map(translateStoredRole);
  if (translated.some((t) => t === null)) return { ready: false, translations: [] };
  return {
    ready: true,
    translations: (translated as StoredGridTranslation[]).map((t) => ({ ...t, column: { ...t.column, admission: "readOnly" as const } })),
  };
}

/**
 * ST-2: under v3 a planned column is never built for a target a stored service occupies; the
 * stored service shows as its own «Guardado» column instead, keyed by its document `_id`.
 */
export function v3PlannedCreateColumns(createColumns: readonly GridColumn[], storedTargets: ReadonlySet<string>): GridColumn[] {
  return createColumns.filter((c) => !storedTargets.has(v3TargetOf(c)));
}

/** The planned columns that will exist: not skipped and creatable (RQ-3) — never a «Guardado» one. */
export function v3PlannedColumnsFor(input: {
  columns: readonly GridColumn[];
  skippedColumnIds: ReadonlySet<string>;
  draftByTarget: ReadonlyMap<string, DraftCard>;
  isCreatable: (draft: DraftCard) => boolean;
}): GridColumn[] {
  const { columns, skippedColumnIds, draftByTarget, isCreatable } = input;
  return columns.filter((c) => {
    if (skippedColumnIds.has(c.columnId)) return false;
    const draft = draftByTarget.get(draftTargetKey(c.type, c.date));
    return !draft || isCreatable(draft);
  });
}

/** C6 SP-4: the planned counted specials, which today's after-solve filler leaves to the pre-fill. */
export function countedSpecialIdsOf(columns: readonly GridColumn[]): Set<string> {
  return new Set(columns.filter((c) => c.type === "special_role" && c.countsForFairness).map((c) => c.columnId));
}

/**
 * The pure half of `MonthGenerator`'s `applySpecialFill`: the uncounted specials through
 * `fillColumn`, then the instrument seats through `fillInstruments`, on the accumulated cells.
 * Returns the cells and the seats the local fillers left empty; the component owns the three
 * setters (cells, unfilled, drafts) and the merge with the previous run's unfilled seats.
 *
 * @param baseCells the array the fill starts from. On the SUCCESS path this must be
 *   `applied.cells` — passing the pre-solve `cells` here discards the weekend solve.
 * @param fillEmpty «Solo llenar vacíos»: instruments are completed on the weekend columns in
 *   date order and nothing is vacated — `fillInstruments`' `fillColumns` path, no second flag.
 * @param skipSpecialIds C6 SP-4/SP-5: under v3, counted specials are the pre-fill's (filled
 *   before the solve, or left as they are on a refusal) — this filler never touches them.
 */
export function runLocalFills(input: {
  config: SolverConfig;
  baseCells: GridCell[];
  columns: GridColumn[];
  rows: GridRow[];
  members: RankMember[];
  savedWindow: ParticipantRole[];
  fillEmpty?: boolean;
  skipSpecialIds?: ReadonlySet<string>;
}): { cells: GridCell[]; filled: { columnId: string; rowId: string }[] } {
  const { config, baseCells, columns, rows, members, savedWindow, fillEmpty = false, skipSpecialIds } = input;
  let next = baseCells;
  const filled: { columnId: string; rowId: string }[] = [];
  for (const column of columns) {
    if (column.type !== "special_role" || skipSpecialIds?.has(column.columnId)) continue;
    // Fed the ACCUMULATED cells, so the second special of a month ranks
    // against the load the first one just created (`cellsToParticipantRoles`
    // iterates `columns`), instead of re-picking the same people.
    const out = fillColumn({
      column,
      columns,
      rows,
      cells: next,
      members,
      savedWindow,
      config,
    });
    next = out.cells;
    filled.push(...out.unfilled);
  }
  // Instrument seats (spec 2026-09-09 §6.3): after the specials, on the accumulated cells — so
  // it runs on EVERY exit exactly as the specials do.
  const weekendInDateOrder = columns
    .filter(c => c.type === "sunday_role" || c.type === "saturday_role")
    .sort((a, b) => a.date.localeCompare(b.date));
  const instr = fillInstruments({
    columns,
    ...(fillEmpty ? { fillColumns: weekendInDateOrder } : {}),
    rows,
    cells: next,
    members,
    savedWindow,
    config,
  });
  next = instr.cells;
  filled.push(...instr.unfilled);
  return { cells: next, filled };
}

type V3Build = Extract<V3AutoResult, { kind: "solved" }>["build"];

/**
 * What a v3 Auto result means for the board — the state-free half of `MonthGenerator`'s
 * `applyV3AutoResult`. The caller has already dropped a stale result (RQ-1) and fills on
 * EVERY kind below (AD-7): from its pre-solve cells unless `kind === "success"`, where it
 * fills from `applied.cells` with `applied.unfilled` as the solver's own unfilled seats.
 *
 * - `refused`: before any solve; nothing frozen.
 * - `failed`: a solve ran and did not succeed (a coded or transport failure, or an
 *   `assignments` id the request did not send). CF-2: the entries are frozen with the request,
 *   from this run's snapshot — whatever the solve says.
 * - `success`: the assignments applied by service id (AD-5), the report and the notices
 *   (NT-3: C6's own first).
 */
export type V3Settlement =
  | { kind: "refused"; error: string; notices: string[] }
  | { kind: "failed"; entries: V3ConfirmEntry[]; error: string; retry: boolean }
  | {
      kind: "success";
      entries: V3ConfirmEntry[];
      build: V3Build;
      response: V3Success;
      applied: { cells: GridCell[]; unfilled: Array<{ columnId: string; rowId: string; reason: string }> };
      names: V3Names;
      report: V3RunReport;
      notices: string[];
    };

export function settleV3AutoResult(input: {
  result: Exclude<V3AutoResult, { kind: "stale" }>;
  rows: readonly GridRow[];
  members: ReadonlyArray<{ _id: string; member_name: string; alias?: string }>;
}): V3Settlement {
  const { result, rows, members } = input;
  if (result.kind === "refused") {
    return { kind: "refused", error: result.lines[0], notices: result.lines.slice(1) };
  }
  const { build, outcome } = result;
  const entries = freezeConfirmEntries(build.snapshot.sources, "auto");
  if (outcome.kind !== "success") {
    return { kind: "failed", entries, error: v3OutcomeLine(outcome), retry: v3RetryOffered(outcome) };
  }
  const applied = applyV3Assignments({ response: outcome.response, request: build.request, cells: build.cells, rows, pinnedCellKeys: build.boardPinnedCellKeys });
  if (!applied.ok) {
    return { kind: "failed", entries, error: transportLine("unknown_service"), retry: false };
  }
  const names = v3Names({ members, serviceLabels: build.serviceLabels, ruleLabels: build.ruleLabels });
  const report = buildV3RunReport({ response: outcome.response, request: build.request, storedServiceIds: build.storedServiceIds, names });
  return {
    kind: "success",
    entries,
    build,
    response: outcome.response,
    applied: { cells: applied.cells, unfilled: applied.unfilled },
    names,
    report,
    notices: [...build.notices, ...report.solverNotices],
  };
}
