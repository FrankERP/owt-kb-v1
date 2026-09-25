import "server-only";

// app/utils/solverHistoryRead.ts
//
// `loadSolverHistory` — the ONE server-callable builder of the solver's derived
// fairness history (spec `docs/superpowers/specs/2026-09-23-solver-history-derivation-design.md`
// R8–R11; plan `docs/superpowers/plans/2026-09-25-owt-mcp-p2-solver-history.md`
// step 3). The admin read route (`/api/admin/solver-history`) wraps it now; P4's
// `solve_month` will call it directly, because the MCP authenticates with a
// bearer token and cannot use a session-gated route.
//
// Reads (R9): every query is a `serviceReadQueries.ts` builder, run on
// `operationalClient` imported DIRECTLY here — a client passed in as a parameter
// would be invisible to `protectedReadAudit`. No builder filters on `published`:
// prior-month drafts count (R3).
//
// Auth: none, by design. The route gates who may call it, and gates `evidence`
// (every member's name, kids-only included) to super-admin. Without evidence the
// result names only members seated in the window's weekend roles.
//
// Failure (spec, Behavior → Failure): a read that rejects, or answers with
// anything but a list, throws `SolverHistoryUnavailableError` — a fixed
// message, no Sanity text, no `cause`. It never returns empty entries in place
// of a failed read: an empty history is only ever a window with no services.

import { operationalClient } from "@/sanity/lib/operationalClient";

import {
  canonicalMemberNamesQuery,
  canonicalRolesByIdsQuery,
  canonicalWeekendRolesInRangeQuery,
  weekendRoleCreationReceiptsQuery,
  type BoundQuery,
} from "./serviceReadQueries";
import { deriveSolverHistory, historyWindow, type SolverHistoryMember, type SolverHistoryTarget } from "./solverHistory";
import { buildSolverHistoryEvidence, outOfWindowReceiptRoleIds } from "./solverHistoryEvidence";
import type { SolverHistoryResult } from "./solverHistoryTypes";

/** The one message a failed history read carries — safe to show, and the route's own copy. */
export const SOLVER_HISTORY_UNAVAILABLE_MESSAGE = "No se pudo leer el historial de equidad.";

/** The `Error.name` the route discriminates on — its own copy, pinned so neither side can drift. */
export const SOLVER_HISTORY_UNAVAILABLE_ERROR_NAME = "SolverHistoryUnavailableError";

/** The history could not be read. Its message is fixed and carries nothing from Sanity. */
export class SolverHistoryUnavailableError extends Error {
  constructor() {
    super(SOLVER_HISTORY_UNAVAILABLE_MESSAGE);
    this.name = SOLVER_HISTORY_UNAVAILABLE_ERROR_NAME;
  }
}

/** One read. The original failure is logged on the server and never rethrown. */
async function readList(label: string, bound: BoundQuery): Promise<unknown[]> {
  let rows: unknown;
  try {
    rows = await operationalClient.fetch<unknown>(bound.query, bound.params);
  } catch (err) {
    console.error(`[solverHistoryRead] the ${label} read failed:`, err);
    throw new SolverHistoryUnavailableError();
  }
  if (!Array.isArray(rows)) {
    console.error(`[solverHistoryRead] the ${label} read returned no list`);
    throw new SolverHistoryUnavailableError();
  }
  return rows;
}

/** `YYYY-MM-01` by integer arithmetic — never a `Date` (R5). */
function monthStart(year: number, month: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
}

function isMemberRow(row: unknown): row is SolverHistoryMember {
  return !!row && typeof row === "object" && typeof (row as { _id?: unknown })._id === "string";
}

/**
 * The derived history for `target`: `{ target, entries, months, diagnostics }`,
 * plus R11's `evidence` when asked for. Throws `RangeError` — before any read —
 * when `target` is not a calendar month, and `SolverHistoryUnavailableError`
 * when any read fails.
 */
export async function loadSolverHistory(
  target: SolverHistoryTarget,
  { evidence = false }: { evidence?: boolean } = {},
): Promise<SolverHistoryResult> {
  const window = historyWindow(target);
  // The window's weekend roles: `week` in [first window month, target month).
  const from = monthStart(window[0].year, window[0].month);
  const to = monthStart(target.year, target.month);

  const [roles, memberRows, receipts] = await Promise.all([
    readList("roles", canonicalWeekendRolesInRangeQuery(from, to)),
    readList("member names", canonicalMemberNamesQuery()),
    evidence ? readList("creation receipts", weekendRoleCreationReceiptsQuery()) : Promise.resolve([]),
  ]);
  const members = memberRows.filter(isMemberRow);

  const derived = deriveSolverHistory({ target, roles, members });
  const result: SolverHistoryResult = { target: { year: target.year, month: target.month }, ...derived };
  if (!evidence) return result;

  // The "moved out of the month" arm: the current documents of receipts that
  // target the window while their role is not in it. A missing one is deleted.
  const movedIds = outOfWindowReceiptRoleIds({ target, roles, receipts });
  const lookedUpRoles = movedIds.length > 0 ? await readList("moved roles", canonicalRolesByIdsQuery(movedIds)) : [];

  return {
    ...result,
    evidence: buildSolverHistoryEvidence({ target, roles, members, receipts, lookedUpRoles, derived }),
  };
}
