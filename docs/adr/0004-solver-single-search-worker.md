# ADR-0004: Solve with 1 search worker to stay on free-tier CPU

**Date:** 2026-06-30 · **Status:** Accepted

## Context

The solver runs as a gen2 Cloud Function on roughly **0.33 vCPU**. With 8 search
workers and a 20s per-solve cap, feasible solves thrashed the single core and
ran ~30s — past Vercel's HTTP timeout, surfacing to the user as a 504.

## Decision

In `gcf/owt_solver_v2.py`:

- `solver_num_search_workers = 1`
- `solver_max_time_seconds = 5`
- `solver_total_budget_seconds = 40`

and `maxDuration = 60` on `app/api/admin/solve/route.ts`.

## Rejected

**More workers.** 8 threads on a sub-1-vCPU container is slower than 1 —
measured, not assumed. OR-Tools' parallel portfolio assumes real cores.

**Raising the function's CPU/memory.** Would fix the thrashing and take the
function off free-tier resources. The 1-worker configuration was fast enough
(~8s end-to-end) that paying for CPU wasn't warranted.

## Consequences

The solver is CPU-starved by design; anyone benchmarking it locally on a real
machine will see numbers that don't transfer. If solve times regress, the first
move is *not* to raise `num_search_workers` — check the constraint model first.
`gcf/owt_solver_v2.py:99–106` carries a short version of this warning at the
definition site.

Related, same date: the dedicated-Saturday-lead constraint was relaxed from
`== 1` to `>= 1` because the hard equality made the model infeasible whenever
every remaining lead option was dedicated, and a two-stage solve was added so a
short-staffed month degrades seats (Choir → BGV → 2nd Lead, always ≥1 Lead)
instead of failing outright.
