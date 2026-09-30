// app/components/admin/solverHistorySource.ts
//
// THE switch for where the month planner's fairness history comes from (R14,
// R15 of `docs/superpowers/specs/2026-09-23-solver-history-derivation-design.md`;
// plan `docs/superpowers/plans/2026-09-25-owt-mcp-p2-solver-history.md`, D2).
//
//  - `"derived"` — WHAT SHIPS since the cutover (Frank's Gate C decision,
//                  2026-09-28; ADR-0042). The history is derived from the stored
//                  weekend services by `GET /api/admin/solver-history` (R8): the
//                  display loads it, every Auto re-reads it for its own month at
//                  solve time, the chips are read-only, and `localStorage` is
//                  still WRITTEN (the rollback target, R15) but never read.
//  - `"local"`   — the pre-cutover per-browser `owt_solver_history_v2` (ADR-0010):
//                  the planner reads, writes and solves with `localStorage`. Kept
//                  compiled, and tested, ONLY as the rollback path until D3
//                  deletes it.
//
// A CODE CONSTANT, not an env var and never a per-browser setting: one value in
// every bundle, so the switch is deployment-wide by construction (R15) — a
// per-browser switch would bring back the two-admins gap the cutover exists to
// close. Flipping it was Frank's cutover decision (R14); rolling back is
// flipping it again through the normal pipeline — no data recovery, because the
// dual-write kept the browser key current. No `docs/SECRETS.md` entry: it is not
// an environment variable.
//
// NEUTRAL (ADR-0028): no `"use client"`, no imports. Tests pick a mode with
// `vi.mock("../solverHistorySource", …)`.
//
// The explicit annotation is load-bearing: without it the constant's type is
// the literal of whichever value it holds, and every comparison against the
// OTHER value in the planner (`!== "local"` while this is `"derived"`) becomes a
// TS2367 "no overlap" error rather than the rollback branch it is meant to be.

export type SolverHistorySource = "local" | "derived";

export const SOLVER_HISTORY_SOURCE: SolverHistorySource = "derived";

/**
 * Whether Auto sends a fairness history to the solver at all — `false` since
 * 2026-09-30 (Frank's decision, ADR-0046). The solver then balances WITHIN the
 * month only; who leads across months is Frank's call through the pool
 * checkboxes (occasional leaders are ticked some months and not others, which a
 * history-weighted objective read as "owed" leads). It also keeps the objective
 * under CP-SAT's ceiling: with three history months it was skipped on every real
 * month (ADR-0038), so the history never shaped a roster anyway.
 *
 * `false`: Auto reads no history at solve time, never refuses over a failed read,
 * sends `history: []`, and shows no «Historial» line. The display read
 * (`useDerivedSolverHistory`, the «sin Lead en …» panel) and the confirm-time
 * dual-write are unchanged. `true` restores the ADR-0042 behaviour exactly —
 * the rollback, through the normal pipeline, like `SOLVER_HISTORY_SOURCE`.
 * Explicitly `boolean`, for the same TS2367 reason as the constant above.
 */
export const SOLVER_SENDS_HISTORY: boolean = false;
