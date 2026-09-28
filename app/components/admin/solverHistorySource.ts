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
