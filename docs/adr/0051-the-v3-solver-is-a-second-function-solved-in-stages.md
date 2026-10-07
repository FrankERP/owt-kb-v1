# ADR-0051: The v3 solver is a second function, solved in fixed stages under a violation ceiling

**Date:** 2026-10-06 · **Status:** Accepted

## Context

Solver v3 (parent spec `docs/superpowers/specs/2026-10-05-solver-v3-fairness-design.md`, child C5
`…-c5-solver-function-design.md`) balances participation across months: eligibility-normalised
balances carried from a 3-month window, cadence leads, floors, caps, 1–2-month runs. v2
(`gcf/owt_solver_v2.py`) is the one production function, deployed from `main` with no preview
rehearsal, its suite guarded by goldens; its single weighted objective already overflowed CP-SAT's
integer bound (ADR-0038) and, made to fit, was skipped on most real months (ADR-0046). The
prototype of the new policy proved every stage optimal on the real Nov+Dec request in about 0.5 s
when solved in sequence, and showed that assignment-dependent shares took 46–48 s with half the
stages capped, that `linearization_level = 1` left a most-owed stage unproven after 60 s, and that
rule-breaking pins failed whole runs under hard rules.

## Decision

- **A second function** (E1): `owt-solver-v3`, source `gcf_v3/` (package `owt_v3`), its own Cloud
  Build trigger (`owt-solver-v3-deploy`, `gcf_v3/**`, `gcf_v3/cloudbuild.yaml`) and CI job
  (`solver-v3`). It imports nothing from `gcf/`; nothing calls it until C6 and C7.
- **Stages, each solved and then fixed** before the next (`gcf_v3/owt_v3/solver.py`): rules (the
  violation ceiling) → fill → cadence → compensation Saturday → voice floor → DL floor → Sunday
  cap → Saturday cap → no consecutive Sundays → per line, most-owed then sum of squares →
  seeded tie-break (not fixed).
- **Rules soft per instance in every run** (F15, ADR-0041's mechanism applied always): the first
  stage minimises the number of broken instances; that number is a ceiling no later stage may
  raise; the report is re-evaluated from the assignment and names each break with cause `pins` or
  `forced`. Clamps (an `==`/`>=` above availability, a presence rule with no member) are notices.
- **Planned shares fixed before the solve** (F13, `gcf_v3/owt_v3/plan.py`); the realised shares in
  the report are C2's formula on the returned assignment (`gcf_v3/owt_v3/formula.py`, guarded by
  the golden fixture); their gap is bounded by a measured `FAIRNESS_TOLERANCE`.
- **Settings** (S3, `gcf_v3/owt_v3/stages.py`): 1 search worker, `linearization_level = 2`, a
  deterministic limit per stage (`STAGE_DET_LIMIT`, measured) under a 2.5 s wall guard, a 25 s
  budget from model build; a seed required in every request.

## Rejected

- **A `solve_v3` entry point inside `gcf/`.** It would ship with v2 on every merge, share v2's
  requirements and load v2 at module scope (`gcf/main.py:20`).
- **A version field on one function.** No per-environment URL and no independent rollback.
- **A single weighted objective.** It overflows CP-SAT's integer bound (ADR-0038).
- **Assignment-dependent shares.** 46–48 s, half the stages capped.
- **Hard rules when there are no pins.** Stored availability alone already sinks such runs (an
  `==` above a month's available services).
- **`linearization_level = 1`.** A most-owed stage was still unproven after 60 s; level 2 proves it
  in milliseconds.

## Consequences

- Two functions read one key (`OWT_SOLVER_API_KEY`); a rotation redeploys both (`docs/SECRETS.md`).
- A stage stopped by a limit keeps its solution and is reported `unproven`; one never started is
  `not_run`; `rules`/`fill` with no solution answer `timeout`, never «no solution» (none exists).
- Determinism holds per platform and only when every stage is `proven`.
- Undoing the stage order or the ceiling reopens what ADR-0038 and ADR-0041 closed. C7 amends
  ADRs 0004, 0010, 0038, 0041, 0042, 0046 and 0047 at the flip, citing this record (parent A31).
