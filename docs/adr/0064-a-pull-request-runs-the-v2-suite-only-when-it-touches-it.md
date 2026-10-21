# ADR-0064: A pull request runs the v2 solver suite only when it touches it

**Date:** 2026-10-21 · **Status:** Accepted · amends [ADR-0056](0056-the-v2-solver-stays-deployed-as-the-rollback-engine.md) («`solver-v2` stays a required CI job»)

## Context

Since the 2026-10-15 cutover production plans with solver v3; v2 (`gcf/`) stays deployed only
as the rollback engine (ADR-0056). Its suite is still the slowest thing in CI: job `solver-v2`
took 10m16s–10m32s of runs whose wall time was 10m29s–10m46s, while `node` took ~5–6 min and
`solver-v3` ~1 min (`docs/CI.md` «Timing»). Every PR, including frontend-only ones, waited ~4
extra minutes for a suite that cannot change unless `gcf/` does. Frank (2026-10-21): «no tiene
sentido probar el solver v2 porque no lo usamos ya».

## Decision

On a `pull_request`, `solver-v2` runs only when the PR's diff touches `gcf/`, what deploys it
(`cloudbuild.yaml`, `scripts/deploy-solver-gcf.sh`), `.github/`, `scripts/ci/` or
`scripts/lib/ci-`. A `scope` job decides (`scripts/ci/ci-scope.mjs` over
`scopeDecision` in `scripts/lib/ci-scope.mjs`), reading the merge commit against its first
parent, raw (`-z`, `core.quotePath=false`, `--no-renames`). `solver-v2` has `needs: scope` and
`if: ${{ needs.scope.outputs.solver-v2 != 'false' }}`, and `gates` accepts its `skipped` only
when `scope` succeeded and said exactly `false` (`gatesVerdict`). Pushes to `main`/`preview`
and manual runs always run it. Every doubt (unreadable or empty diff, missing output) runs it.
The CI-layout guard pins the exact `if:`, the `scope` job's shape and `SKIPPABLE_JOBS =
{solver-v2}`. Details: `docs/CI.md` «Scoped skip of `solver-v2`».

## Rejected

- **Delete the v2 suite (or the job) now.** v2 is the rollback: a flip-back must find it
  deployed and working, and its goldens are what prove that. Until Frank closes the rollback
  window (ADR-0056: November published, January's run has November in its history, Equidad
  checks out), a change to `gcf/` must still be tested. Removing the suite is part of the PR
  that removes v2.
- **A workflow `paths:` filter.** It skips the whole workflow, `gates` included, and a missing
  required check blocks the PR forever (or a skipped one passes it). The decision has to be made
  inside a run that `gates` judges.
- **A step-level `if:` inside `solver-v2`** (skip the test step, keep the job). The job would
  report green having tested nothing, which is exactly the silent skip the guard forbids. A job
  skip shows as «skipped» in the PR's checks and has to be vouched for by `scope`.
- **A third-party changed-files action** (`dorny/paths-filter`, `tj-actions/changed-files`).
  One more supply-chain dependency with repository read access, for a two-line `git diff`; the
  in-repo script is Node builtins only and is run as a process by its test.
- **Scoping `solver-v3` too.** It takes ~1 min, under `node`'s ~6: skipping it saves no wall
  time, and v3 is the engine production runs.

## Consequences

- A PR that does not touch `gcf/` or CI finishes `gates` in about `node`'s time (~6 min instead
  of ~10.5). A PR that touches them is unchanged.
- Runner-image drift that breaks `GOLDEN_SCHEDULE` now surfaces on the next push to
  `preview`/`main` (which do not block), not on an unrelated PR.
- The one way an untested v2 change could merge is a path the v2 suite depends on that is
  missing from the list. Today the suite reads nothing outside `gcf/`; a test that starts to
  must add its path to `SKIPPABLE_JOBS`.
- When v2 is retired, `solver-v2`, `scope`, `scripts/lib/ci-scope.mjs` and the verdict's
  exception go with it.
