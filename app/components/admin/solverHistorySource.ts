// app/components/admin/solverHistorySource.ts
//
// THE switch for where the month planner's fairness history comes from (R14,
// R15 of `docs/superpowers/specs/2026-09-23-solver-history-derivation-design.md`;
// plan `docs/superpowers/plans/2026-09-25-owt-mcp-p2-solver-history.md`, D2).
//
//  - `"local"`   — today's per-browser `owt_solver_history_v2` (ADR-0010): the
//                  planner reads, writes and solves with `localStorage`.
//  - `"derived"` — the history is derived from the stored weekend services by
//                  `GET /api/admin/solver-history` (R8): the display loads it,
//                  every Auto re-reads it for its own month at solve time, the
//                  chips become read-only, and `localStorage` is still WRITTEN
//                  (the rollback target, R15) but never read.
//
// A CODE CONSTANT, not an env var and never a per-browser setting: one value in
// every bundle, so the switch is deployment-wide by construction (R15) — a
// per-browser switch would bring back the two-admins gap the cutover exists to
// close. Flipping it is Frank's cutover decision (R14) and rolling back is
// flipping it again, through the normal pipeline. No `docs/SECRETS.md` entry:
// it is not an environment variable.
//
// NEUTRAL (ADR-0028): no `"use client"`, no imports. Tests pick a mode with
// `vi.mock("../solverHistorySource", …)`.
//
// The explicit annotation is load-bearing: without it the constant's type is
// the literal `"local"`, and every `=== "derived"` comparison in the planner
// becomes a TS2367 "no overlap" error rather than dormant code.

export type SolverHistorySource = "local" | "derived";

export const SOLVER_HISTORY_SOURCE: SolverHistorySource = "local";
