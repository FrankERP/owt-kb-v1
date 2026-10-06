# Solver v3 — C0: split CI into per-suite jobs behind one `gates` check (Implementation Plan)

## Original request

> Aprobado, sigue con los specs de las entregas

The accepted requirement this plan delivers is the C0 row of the approved parent design,
`docs/superpowers/specs/2026-10-05-solver-v3-fairness-design.md` §11:

> C0 | Plan | CI runs v2's solver tests and a new suite in separate jobs; a guard proves every
> discovered test runs in exactly one job; `gates` keeps its name | — | Same tests, faster wall
> time | Revert | standard

Its evidence row (§2): «CI's solver step is ~9m43s of a 14m40s job against a 25-minute limit →
Split CI before a second solver suite».

Parent amendment **A20** (§3, «Amendments from writing the children») amends that row and wins over
its older wording: «C0 lands a minimal `gcf_v3/` scaffold (package `owt_v3`, requirements, one smoke
test) that C5 takes over. Safe end state: the same tests plus that smoke test.»

## Status and contract

- **Document status:** Draft.
- **Risk tier: standard** (parent §11). Rationale: no production writer, no data, no deploy target,
  no secret. The one way this change could do real harm is to leave the required check green while a
  suite is red or never ran — the «control on paper» `docs/CI.md` warns about. That failure mode is
  closed by construction (Decision P2), by a permanent guard (Step 3) and by a deliberate-red control
  on a real pull request (Step 6), which is why the tier stays standard rather than critical. No
  adversarial plan review; the control after implementation is a fresh code review of the diff plus
  the verifications below.
- **Accepted source:** parent §11 C0 as amended by §3 A20, §2 (CI evidence row), §8 E1 («its own
  source directory, Cloud Build trigger **and CI job**»), §13 («→ C0 … Production behaviour unchanged
  … Merged, gates green»). A20 is the only amendment in C0's scope; A1–A19 and A21–A26 settle
  ledger, cadence, planner and cutover contracts and change nothing here. A18 (the golden fixture is
  asserted by both suites) is served by the fixture paragraph under Interfaces, unchanged in shape.
- **Primary outcome:** `.github/workflows/ci.yml` runs the Node gates, v2's solver suite (`gcf/`) and
  the v3 suite (`gcf_v3/`) in **separate, parallel jobs**; the check `main`'s protection requires is
  still named **`gates`** and is green **only** when every one of those jobs succeeded; a guard proves
  every Python test module under `gcf/` and `gcf_v3/` is discovered by exactly one job; v2's
  `GOLDEN_SCHEDULE` still runs exactly once, on Linux x86_64, inside GitHub Actions.
- **Preconditions:** the parent is approved (it is, `3dbc189b`). No other child is required.
- **Safe ending state:** the same Node and v2 tests run on every push/PR they run on today, plus one
  scaffold smoke test under `gcf_v3/`; wall time drops to roughly the v2 solver job's length;
  `gcf/`, `cloudbuild.yaml`, branch protection and auto-merge settings are byte-for-byte unchanged;
  nothing deploys anything new.

## Evidence and current behavior

All line numbers verified on this branch (`2d90e4b3`) on 2026-10-05.

| Evidence | Source | Planning implication |
|---|---|---|
| One job, id and display name `gates`, runs `tsc` → `npm test` → `eslint` → setup-python 3.12 → `pip install -r gcf/requirements.txt` → `python -m unittest discover -s gcf -t gcf -v`, sequentially | `.github/workflows/ci.yml:27-73` | Everything is serial today; the solver step alone is two-thirds of the job |
| `timeout-minutes: 25`, justified by a comment citing «solver step 6m34s, run 36174302390» | `ci.yml:31-34` | Stale: the step now takes ~10 min (next row). Fix the comment |
| `docs/CI.md` repeats «solver step 6m34s» and the rule «If it crowds again, split the workflow; never drop the solver step» | `docs/CI.md:24` | Stale number; this plan is the split that rule asks for |
| Run 36983149539 (main `0a81839c`, 2026-10-02): job 14m41s; Node part (checkout → Lint) 4m35s; «Solver tests» 9m43s | `gh run view 36983149539 --json jobs` (read 2026-10-05) | Node and solver can run in parallel: wall ≈ max, not sum |
| Run 37357419306 (main, 2026-10-05): job 15m11s; «Solver tests» 10m01s | `gh run view 37357419306 --json jobs` (read 2026-10-05) | The solver step keeps growing; v3 adds a second suite |
| Branch protection on `main`: `required_status_checks.checks = [{context: "gates", app_id: 15368}]`, `contexts = ["gates"]`, `strict: true` | `gh api repos/FrankERP/owt-kb-v1/branches/main/protection` (read 2026-10-05); written by `scripts/apply-branch-protection.sh:14,22-25` | The required check is matched by **check-run name** from the GitHub Actions app. Whatever job carries `name: gates` IS the control. Keeping that name means protection and the script need no change |
| A job skipped by an unmet `needs` (or a false `if:`) reports conclusion `skipped`, and GitHub treats a skipped required check as passing | GitHub Actions behaviour, documented for required checks | An aggregator `gates` without `if: always()` would turn every red suite into a green merge. Decision P2 |
| Auto-merge is a repository setting and merges on a green `gates` with `strict` | `docs/CI.md:125-141`, `CLAUDE.md` Conventions | Auto-merge is only as safe as `gates`; nothing about it changes here |
| `GOLDEN_SCHEDULE` is enforced only on `("Linux","x86_64")`; in GitHub Actions (`GITHUB_ACTIONS == "true"`) an off-platform run or a `None` golden **fails** instead of skipping | `gcf/test_inertness.py:123-137`, `:250-292` (`PinlessOutputGolden.test_schedule_matches_the_golden` at `:273`) | The v2 job must stay on an x86_64 Linux runner and must not be a matrix (a matrix would run the golden and every fingerprint N times) |
| `gcf/` holds four test modules: `test_inertness.py`, `test_main.py`, `test_owt_solver_v2.py`, `test_pinned_assignments.py`; no subdirectories, no `__init__.py` | `ls -a gcf` | `-s gcf -t gcf` discovers all four today |
| `gcf/.gcloudignore` excludes `test_*.py` and `*_test.py` from the deployed function | `gcf/.gcloudignore` | `*_test.py` is anticipated as a naming mistake; unittest's default pattern never discovers it |
| Python 3.12.13 measured locally: `discover` silently skips a subdirectory without `__init__.py`; never discovers `x_test.py`; exits **5** («NO TESTS RAN») on an empty start dir; exits **1** («Start directory is not importable») on a missing one | scratch experiment, 2026-10-05 | A v3 job pointed at a missing or empty `gcf_v3/` is red, not inert; a misplaced v3 test runs nowhere and nobody is told. The guard must model this |
| Cross-tree imports are **not** blocked by the start directory. In a scratch tree (`gcf/owt_solver_v2.py`, no `gcf/__init__.py`; `gcf_v3/owt_v3/__init__.py`; one probe test in `gcf_v3/`), `python -m unittest discover -s gcf_v3 -t gcf_v3` run from the tree root imports `owt_v3` ✓, fails on bare `owt_solver_v2` (`ModuleNotFoundError`), and **imports `gcf.owt_solver_v2` ✓** — identical on Python 3.12.13, 3.13 and 3.14.7. Mechanism: `python -m` puts the working directory (the repo root in CI) on `sys.path[0]`, and an `__init__`-less `gcf/` resolves as a namespace package. The mirror holds in `solver-v2` for `gcf_v3.owt_v3` | scratch experiment, 2026-10-05 | Isolation between the trees cannot be a `sys.path` property; it has to be a guard rule over import statements (I2, Step 3) |
| `gcf_v3/` does not exist; no `fixtures/` directory exists | `ls` | C0 must create the minimum for the v3 job to be real (Decision P1) |
| Cloud Build deploys v2 from `main`, trigger file filter `gcf/**` and `cloudbuild.yaml`, `--source=gcf` | `cloudbuild.yaml:1-24` (comment at `:3-4`); `docs/SOLVER_AND_INFRA.md:458` | Files under `gcf_v3/` match neither filter, so the scaffold deploys nothing. The filter itself is read from a comment and a doc, not from GCP (Assumption A1) |
| Other workflows: `smtp-probe.yml` (job `probe`), `flush-notifications.yml` (job `flush`) | `.github/workflows/*.yml` | No other job is named `gates` today; the guard keeps it that way |
| Workflow-text guards already exist and are the house pattern: `flushWorkflowGate.test.ts` reads a workflow as text; `deployBranchPolicy.test.ts` keeps a pure policy in `scripts/lib/` and executes its runner **as a process** so swapped exit codes cannot pass | `app/api/__tests__/flushWorkflowGate.test.ts:38-41`; `scripts/__tests__/deployBranchPolicy.test.ts:1-23`; `scripts/lib/deploy-branch-policy.mjs` | Follow both: pure checks in `scripts/lib/`, a process-executed verdict runner |
| `js-yaml` appears only under `overrides` in `package.json` (`:51-52`, `:68`), never as a direct dependency | `package.json` | A guard may not import a YAML parser it does not own (Decision P4) |
| vitest includes `scripts/**/*.test.{ts,mjs}` and runs at the repo root | `vitest.config.ts` | A guard in `scripts/__tests__/` runs in every `npm test`, locally and in CI |
| Docs that describe the single job: `docs/CI.md:16-26` (layout table), `:106` («runs four local commands»); `docs/SOLVER_AND_INFRA.md:773-777`; `CLAUDE.md:10-13` (local gates) and `:18-20` (what `gates` runs) | files | Updated in the same delivery (Step 4) |
| The repository is public | `CLAUDE.md` (Agent worklog section) | Actions minutes for extra parallel jobs cost nothing |

## Scope

### In scope

- Restructure `.github/workflows/ci.yml` into four jobs: `node`, `solver-v2`, `solver-v3`, and the
  aggregator `gates`.
- A minimal `gcf_v3/` scaffold so the v3 job runs a real suite from day one (Decision P1).
- A pure checker module, a verdict runner, and one vitest guard that pins the required-check shape and
  the Python test partition, with permanent negative cases.
- Fix the stale timing in `ci.yml` and `docs/CI.md:24`; record measured per-job timing.
- Update `docs/CI.md`, `docs/SOLVER_AND_INFRA.md:773-777` and `CLAUDE.md:10-13,18-20`.

### Non-goals

- Any change under `gcf/` or to `cloudbuild.yaml` (parent §10: v2's code, tests and function are
  untouched).
- Creating the v3 Cloud Build trigger, function or source beyond the scaffold (C5, parent E1).
- The golden fixture `fixtures/fairness/golden.json` (C2 creates it and asserts it in vitest; C5's
  Python suite asserts its `ledger` cases — parent A18, C2 FX-1/FX-3).
- Changing branch protection, `scripts/apply-branch-protection.sh`, or the auto-merge setting.
- Path filters, a merge queue, a Python version matrix, or caching beyond today's npm/pip caches.
- Running Python tests that live outside `gcf/` and `gcf_v3/` (there are none).

### Preserved invariants

- **The required check is named `gates`, comes from GitHub Actions, and is green only if every other
  job in `ci.yml` concluded `success`.** `skipped`, `cancelled`, `failure`, or a missing result is red.
- **Every job runs on every trigger it runs on today** (`push` to `main`/`preview`, `pull_request` to
  `main`/`preview`, `workflow_dispatch`). No `paths`/`paths-ignore`, no job-level `if:` except the
  aggregator's `always()`. A frontend-only PR still runs both solver suites.
- **The v2 suite runs exactly as today:** same command, same Python 3.12, same
  `gcf/requirements.txt`, same `ubuntu-latest` (x86_64) runner, once per run, never in a matrix, never
  `continue-on-error`. `GOLDEN_SCHEDULE` therefore runs exactly once per run, on Linux x86_64, with
  `GITHUB_ACTIONS=true` (so a skip is a failure, `gcf/test_inertness.py:276-288`).
- CLAUDE.md's local gate commands keep working verbatim: `python -m unittest discover -s gcf -t gcf`.
- Workflow-level `concurrency` and `permissions: contents: read` are unchanged; no job gains a
  permission or a secret («This workflow needs no secrets», `docs/CI.md:103-108`, stays true).
- `gcf/` and `cloudbuild.yaml` are byte-identical to `main`, so the v2 Cloud Build trigger does not
  fire for this change.

## Interfaces

**Consumes:** nothing from other children. From the repository: `gcf/` as it stands (read-only to this
plan), `.github/workflows/ci.yml`, and branch protection on `main` as read above (required context
`gates`, GitHub Actions app id 15368, `strict: true`), which this plan does not modify.

**Provides to C5 (the v3 solver):**

- **I1 — the v3 CI job.** Job id `solver-v3` in `.github/workflows/ci.yml`; `runs-on: ubuntu-latest`;
  Python `3.12` via `actions/setup-python`; working directory = repository root; full checkout (no
  sparse checkout); installs with `pip install -r gcf_v3/requirements.txt`; runs exactly
  `python -m unittest discover -s gcf_v3 -t gcf_v3 -v`; `GITHUB_ACTIONS=true` (runner default); no
  secrets, no env vars; `timeout-minutes: 15` until C5 re-sets it from its own measured run (Decision
  P6; C5 §12.2 adopts the rule and budgets the job at 10 minutes, target 6). Its result is one of the
  `needs` the `gates` verdict requires to be `success`.
- **I2 — the discovery contract** (enforced by the guard, Step 3). A file under `gcf_v3/` is a test
  module iff its basename matches `test*.py` and it sits in `gcf_v3/` itself or in a directory chain
  below it in which **every** directory has an `__init__.py`. Forbidden under `gcf_v3/` (and `gcf/`):
  a `*_test.py` file, a `test*.py` file that discovery cannot reach, any definition of `load_tests`, a
  `-p` pattern or a `-s` that differs from `-t` in the command. The tree must contain at least one
  reachable test module. Imports resolve with `gcf_v3/` as the top-level directory, so the package
  imports as `owt_v3`. A sub-tree that holds no `test*.py` (C5's `gcf_v3/acceptance/` package, C5
  §11.1) is allowed and contributes no modules.
  **Isolation between the trees is a guard rule, not a `sys.path` property.** Both jobs run
  `python -m unittest` from the repository root, which puts the root on `sys.path`, so
  `gcf.owt_solver_v2` *is* importable in `solver-v3` (as a namespace package) and `gcf_v3.owt_v3` in
  `solver-v2` (evidence row, measured on 3.12.13). The guard therefore forbids the import statements:
  no `.py` file under `gcf_v3/` may contain an `import gcf…` or `from gcf… import` statement naming
  the `gcf` package (the name `gcf` itself, not `gcf_v3`), and no `.py` file under `gcf/` may import
  `gcf_v3` or `owt_v3`. The check reads statement forms only; a dynamic `importlib.import_module` or
  `__import__` call is a code-review matter, not a guard failure.
- **I3 — the scaffold**, which C5 owns from merge on: `gcf_v3/requirements.txt` (one line,
  `ortools==9.15.6755`, the same pin as `gcf/requirements.txt`), `gcf_v3/.gcloudignore` (a copy of
  `gcf/.gcloudignore`), `gcf_v3/owt_v3/__init__.py` (docstring only), and `gcf_v3/test_scaffold.py`
  (one smoke test: `owt_v3` and `ortools.sat.python.cp_model` import). C5 may change the pin and
  delete `test_scaffold.py` once another test module exists. This matches what C5 §11.1 consumes:
  «`ortools==9.15.6755` and `functions-framework>=3.0,<4`. C0 scaffolds the first line»;
  `.gcloudignore` is «C0's copy of v2's file», to which C5 adds `tests/`, `acceptance/` and
  `cloudbuild.yaml`; C5's unit suite lives in the package `gcf_v3/tests/` (with `__init__.py`, so I2
  reaches it) and «C0's `test_scaffold.py` may be kept or replaced».

**Provides to C2 and C5 (the golden fixture):** every job runs from the repository root with the full
tree checked out, so `fixtures/fairness/golden.json` (C2 FX-1: one file at the repository root) is
present in `node` (vitest) and in `solver-v3`. Parent A18 has both suites assert its `ledger` cases,
and C5 §12.1 makes the Python suite fail if the file is missing; because no job has a path filter, a
change to the fixture alone runs both suites. Tests must resolve it relative to their own file
(Python: from `Path(__file__)`; vitest: from the test's own directory or `process.cwd()`, which is the
repo root under `npm test`), never relative to a `cd`. The guard refuses sparse checkout in every job.

**Provides to C6:** the `node` job has the full tree, `gcf_v3/` included, so C6's vitest sync tests
that read C5's Python-side sources — the registry `gcf_v3/owt_v3/codes.json` (C6 NT-4) and the literal
`PIN_CAP = 250` under `gcf_v3/owt_v3/` (C6 RQ-6) — find them in CI exactly as locally. Those tests run
in `node`, not in `solver-v3`; a red sync test turns `gates` red through `node`.

**Provides to every later child and to C7:** the `gates` check keeps its name and its meaning — «every
CI job for this commit succeeded» — so the release flow, `strict` protection and auto-merge
(`CLAUDE.md` Conventions) need no change when a job is added. Adding a job later requires adding it to
`gates.needs`; the guard fails until it is.

## Affected boundaries

| Component, file, or system | Current responsibility | Planned responsibility |
|---|---|---|
| `.github/workflows/ci.yml` | One serial job `gates` | Jobs `node`, `solver-v2`, `solver-v3` in parallel; `gates` aggregates them |
| `gcf_v3/requirements.txt`, `.gcloudignore`, `owt_v3/__init__.py`, `test_scaffold.py` (new) | — | Make the v3 job real; handed to C5 |
| `scripts/lib/ci-layout.mjs` (new, Node builtins only) | — | Pure functions: parse `ci.yml` jobs as text; check the required-check shape; model unittest discovery and check the partition; check the cross-tree import ban; compute the verdict from a `needs` JSON object |
| `scripts/ci/gates-verdict.mjs` (new, Node builtins only) | — | Runner the `gates` job executes: reads `toJSON(needs)` from an env var, exits 0 only on an all-`success`, non-empty result set |
| `scripts/__tests__/ciLayout.test.ts` (new) | — | The guard: real files must pass; mutated inputs must fail; the runner is executed as a process |
| `docs/CI.md` | Describes one job; stale «6m34s» | Describes four jobs, why `gates` is an aggregator, the partition guard, a dated timing table |
| `docs/SOLVER_AND_INFRA.md:773-777` | «`gates` runs `python -m unittest …`» | Names the two solver jobs and that `gates` requires them |
| `CLAUDE.md:10-13`, `:18-20` | Local gates name only `gcf`; `gates` described as tsc/vitest/eslint | Adds the `gcf_v3/**` command; describes `gates` as requiring every CI job |
| Branch protection, `scripts/apply-branch-protection.sh`, auto-merge setting | Require `gates` | **Unchanged** |
| `gcf/**`, `cloudbuild.yaml`, the v2 Cloud Build trigger, Vercel | v2 deploy; app deploy | **Unchanged**; nothing triggers |

## Decisions

| ID | Decision | Choice | Why | Tradeoffs | Owner |
|---|---|---|---|---|---|
| P1 | Who makes `gcf_v3/` exist before C5 | C0 lands the minimal scaffold (I3) | A v3 job on a missing dir exits 1 and on an empty dir exits 5 (measured), so the job must either have a real suite or be conditional — and a conditional job (`if: hashFiles(...)`) is skipped, which reopens the skipped-is-green hole. The scaffold also makes the partition guard non-vacuous for both trees | C0 pre-places four files in C5's directory; C5 inherits and may replace them. Rejected: conditional job (fail-open); adding the v3 job in C5 instead (contradicts the C0 row and E1, and puts the CI split inside a solver delivery) | Claude; settled by parent A20 |
| P2 | How `gates` stays the control | `gates` is an aggregator job: `needs: [node, solver-v2, solver-v3]`, `if: ${{ always() }}`, and its only verdict step runs `scripts/ci/gates-verdict.mjs` with `toJSON(needs)` passed through `env:`; exit 0 iff the object is non-empty and every entry's `result` is exactly `success` | `always()` means `gates` is never `skipped`; a cancelled run makes it red, not absent. A generic verdict over `needs` covers a job added later without editing the script. Passing JSON through `env:` keeps job data out of the shell source | One extra short job (~10–20 s with checkout). Rejected: making the three jobs required checks directly (needs a protection change plus admin rights, and every future job would need another one); `if: ${{ !cancelled() }}` (a cancelled run yields a *skipped* `gates`); inline `jq 'all(...)'` (true on an empty object, and untestable as a process) | Claude |
| P3 | Partition guard: static model or runtime enumeration | Static, in vitest: model unittest's default discovery over the files on disk, and refuse every construct the model does not follow (`load_tests`, `-p`, `-s ≠ -t`, unreachable `test*.py`, `*_test.py`) | Runs on every `npm test`, locally and in the `node` job, regardless of which solver job is broken; no Python needed; fails closed on anything it cannot model. The partition is by start directory, and the two start directories are disjoint siblings, so «each module in exactly one job» follows from the model plus the command check | It is a model of discovery, not discovery. The model was checked against Python 3.12.13 (evidence row) and Step 5 re-checks it against the real runner's «Ran N tests». Rejected: emitting discovered module lists as job outputs and comparing them in `gates` (more plumbing in the release-critical job, and comparison would key on module names, which collide — both trees may hold a `test_main`) | Claude |
| P4 | YAML parsing in the guard | Text-based job-block parsing in `scripts/lib/ci-layout.mjs`, failing closed on any block it cannot read | `js-yaml` is not a direct dependency; adding `yaml` churns the lockfile for one guard; the house precedent (`flushWorkflowGate.test.ts`) reads workflows as text | Brittle to reformatting — acceptable, because brittleness here fails red, never green | Claude |
| P5 | Where the Node gates run | Their own job `node`, unchanged steps and order | Parallel with the solver jobs; the verdict needs it as a peer | `npm ci` no longer shares a job with Python — no cost, nothing shared today | Claude |
| P6 | Timeouts | `node` 15, `solver-v2` 25 (unchanged margin), `solver-v3` 15, `gates` 5 minutes. Rule recorded in `docs/CI.md`: a job's timeout is at least twice its latest measured job time; re-measure when its suite's step time grows by a quarter, and split again rather than drop a suite | Measured: Node part 4m35s–~4m50s; v2 step 9m43s–10m01s | `solver-v2` at 25 is generous; a hung v2 job holds the PR ~10 min longer than a tighter limit | Claude |
| P7 | ADR | None; `docs/CI.md` gains a «Why `gates` is an aggregator» section and the guard's assertion messages state the reason | `docs/CI.md` is already this subsystem's decision record (protection, admins, auto-merge). The looks-like-a-bug line (`if: always()` on a gate) is pinned by a test whose message explains it | One fewer ADR to find; the reason lives where the workflow is documented | Claude |

## Ordered changes

Work on one feature branch (`claude/solver-v3-c0-ci-split`), from current `main`. Steps 1–4 are one
commit series; each step leaves local gates green.

### 1. The `gcf_v3/` scaffold

- **Purpose:** give the v3 job a real, non-empty suite (P1, I3).
- **Components:** `gcf_v3/requirements.txt`, `gcf_v3/.gcloudignore`, `gcf_v3/owt_v3/__init__.py`,
  `gcf_v3/test_scaffold.py`.
- **Change:** as listed in I3. The smoke test asserts both imports and nothing else; its docstring says
  it exists only so the `solver-v3` job runs a real suite until C5 lands, and that C5 owns it.
- **Failure and recovery:** none at runtime; nothing imports or deploys it.
- **Verification:** `python -m unittest discover -s gcf_v3 -t gcf_v3 -v` → `Ran 1 test`, `OK`, exit 0
  (with the pinned-ortools interpreter). `python -m unittest discover -s gcf -t gcf` still finds the
  same four modules and passes.
- **State after:** inert directory; CI still runs the old single job.

### 2. Split `ci.yml`

- **Purpose:** the primary outcome.
- **Components:** `.github/workflows/ci.yml`.
- **Change:**
  - Header comment: «the four gates» becomes the jobs and why `gates` aggregates them, with a pointer
    to `docs/CI.md`. `on:`, `concurrency:`, `permissions:` unchanged.
  - `node` (display name `node`): today's checkout → setup-node (`.nvmrc`, npm cache) → `npm ci` →
    Types → Tests → Lint, verbatim, with their comments.
  - `solver-v2` (display name `solver-v2`): checkout → setup-python `3.12`, `cache: pip`,
    `cache-dependency-path: gcf/requirements.txt` → «Solver deps» `pip install -r gcf/requirements.txt`
    → «Solver tests» `python -m unittest discover -s gcf -t gcf -v`, with today's comment explaining
    why the suite is gated. `runs-on: ubuntu-latest`. No `strategy`, no `container`.
  - `solver-v3` (display name `solver-v3`): the same shape over `gcf_v3/` (I1).
  - `gates` (display name `gates`): `needs: [node, solver-v2, solver-v3]`, `if: ${{ always() }}`,
    checkout, then one step that runs `node scripts/ci/gates-verdict.mjs` with
    `NEEDS_JSON: ${{ toJSON(needs) }}` in its `env:` (no setup-node: the runner's preinstalled Node
    runs a builtins-only module). A comment above `if:` says why it must never be skipped.
  - The `timeout-minutes` of P6 on each job. The stale «6m34s, run 36174302390» comment is replaced by
    a one-line pointer to `docs/CI.md` «Timing» — the numbers live in one place.
- **Failure and recovery:** a mistake here shows up as a red or missing `gates` on the PR, which blocks
  the merge (protection is unchanged). Revert the commit to recover.
- **Verification:** Step 3's guard on the real file; Step 6 on GitHub.
- **State after:** not yet released; protection still requires `gates`, which now exists as the
  aggregator.

### 3. The guard

- **Purpose:** make the required-check shape and the partition permanent, locally checkable facts.
- **Components:** `scripts/lib/ci-layout.mjs`, `scripts/ci/gates-verdict.mjs`,
  `scripts/__tests__/ciLayout.test.ts`.
- **Change — what the guard asserts on the real repository:**
  - **Required check.** Across every file in `.github/workflows/`, exactly one job has display name
    `gates` — a job's display name is its `name:` or, when it has none, its id, so both
    `name: gates` and a nameless job with id `gates` count as hits; it is job id `gates` in `ci.yml`. Its `needs` equals the set of every other job id in
    `ci.yml`. It has `if: ${{ always() }}` (or `if: always()`), no `strategy`, no
    `continue-on-error`, a `timeout-minutes`, and a step that runs `scripts/ci/gates-verdict.mjs` with
    `toJSON(needs)` supplied through `env:`.
  - **No silent skips anywhere.** `on:` has no `paths`/`paths-ignore`/`branches-ignore`; no job other
    than `gates` has an `if:`; no job or step has `continue-on-error`; every job has
    `timeout-minutes`; no checkout uses `sparse-checkout`.
  - **Commands.** Every `run:` that mentions `unittest` is exactly
    `python -m unittest discover -s <dir> -t <dir> -v` with the same `<dir>` twice and no `-p`; the
    number of such commands equals the number of `unittest` mentions (a reformatted `run: |` block
    fails loudly instead of parsing nothing); there is exactly one per job, and exactly two in total,
    with start directories `{gcf, gcf_v3}`. Each of those jobs installs `<dir>/requirements.txt`,
    sets up Python `3.12`, runs on `ubuntu-latest`, and has no `strategy`/`matrix` and no `container`.
  - **Partition.** Walking `gcf/` and `gcf_v3/` (skipping `__pycache__`): every `test*.py` is reachable
    by discovery from its tree's start directory (at the root, or every directory between root and file
    has `__init__.py`); no file is named `*_test.py`; no file defines `load_tests`; each tree has at
    least one reachable test module; neither start directory contains the other. Hence each module is
    discovered by exactly one job.
  - **Cross-tree imports** (I2). No `.py` file under `gcf_v3/` has an `import`/`from … import`
    statement naming the package `gcf` (`gcf` or `gcf.<x>`, never `gcf_v3`); no `.py` file under
    `gcf/` has one naming `gcf_v3` or `owt_v3`. This is a textual read of `gcf/`, not a change to it;
    `gcf/` passes it today. The assertion message says why: `python -m` puts the repository root on
    `sys.path`, so the start directory does not isolate the trees.
  - **Golden placement.** `gcf/test_inertness.py` is a reachable module of the `gcf` tree, whose job is
    `ubuntu-latest` with no matrix — the single place `GOLDEN_SCHEDULE` runs.
- **Change — permanent negative cases** (pure functions fed mutated text and synthetic file lists; each
  must be red): `gates` without `always()`; `gates.needs` missing one job; a second job named `gates`
  (in `ci.yml` or another workflow); a `paths` filter; `continue-on-error` on a solver step; a matrix
  on `solver-v2`; a third `unittest discover` over `.`; `-s gcf_v3 -t .`; a `-p` flag; a test file in
  `gcf_v3/sub/` without `__init__.py`; a `gcf_v3/foo_test.py`; a `load_tests` definition; an empty
  `gcf_v3`; a `gcf_v3/x.py` containing `from gcf.owt_solver_v2 import solve`; a `gcf_v3/x.py`
  containing `import gcf`; a `gcf/x.py` containing `from owt_v3 import codes`. And one permanent
  positive case, so the ban cannot over-match: `from gcf_v3.owt_v3 import x` inside `gcf_v3/` is not
  a `gcf` import.
- **Change — the verdict runner, executed as a process** (the `deployBranchPolicy.test.ts` pattern):
  exit 0 for `{"node":{"result":"success"},…}` with all three `success`; exit non-zero for any
  `failure`, `cancelled` or `skipped`, for `{}`, for malformed JSON, and for a missing `NEEDS_JSON`.
  Its stdout names every non-success job and its result, so the `gates` log says which suite failed.
- **Failure and recovery:** the guard is a test; red blocks the PR through `node` → `gates`.
- **Verification:** `npm test` green on the final tree; then, once, temporarily break the real
  `ci.yml` three ways (drop `if: ${{ always() }}`; remove `solver-v3` from `needs`; add a
  `paths: ['app/**']` filter) and move `gcf_v3/test_scaffold.py` into an `__init__`-less
  subdirectory — each must turn the guard red with a message naming the rule; revert each. Record the
  four observations in the PR description.
- **State after:** the layout is pinned.

### 4. Documentation

- **Purpose:** «Keep documentation current in the same delivery» (`CLAUDE.md`).
- **Components and change:**
  - `docs/CI.md`: «The workflow» becomes a per-job table (job, display name, runner, steps, timeout);
    the solver step row no longer cites 6m34s; new «Timing» table — run id, date, per-job durations
    and wall time — seeded with runs 36983149539 and 37357419306 (single-job baseline) and filled with
    the post-split numbers in Step 5; new section «Why `gates` is an aggregator» (skipped-is-passing,
    `always()`, the verdict, why no path filters, why the three jobs are not required individually,
    the guard's file name); new section «Solver suites» (the two commands, I2's discovery rules, that
    `GOLDEN_SCHEDULE` runs once in `solver-v2`); «Secrets» keeps «needs no secrets» and loses «runs
    four local commands»; «Branch protection» adds one sentence: the required check is still `gates`,
    now the aggregator, so protection and `apply-branch-protection.sh` were not touched.
  - `docs/SOLVER_AND_INFRA.md:773-777`: «`gates` runs …» becomes «the `solver-v2` job runs …, and
    `gates` requires it (and `solver-v3` for `gcf_v3/`)».
  - `CLAUDE.md:10-13`: add «and — when it touches `gcf_v3/**` — `python -m unittest discover -s gcf_v3
    -t gcf_v3`»; `:18-20`: `gates` «requires every CI job — `tsc --noEmit`, `vitest`, `eslint` with 0
    errors, and both solver suites».
  - Not touched: `docs/superpowers/plans/2026-09-25-solver-pinned-assignments.md:1698` (a dated
    historical record, true when written).
- **Verification:** `grep -rn "6m34" . --exclude-dir=node_modules --exclude-dir=.next` returns only
  dated historical plan/spec text; the fresh code review (Step 7) carries the docs-audit checklist.
- **State after:** branch complete locally.

### 5. Local gates and push

- `npx tsc --noEmit`, `npm test`, `npx eslint .` (0 errors),
  `python -m unittest discover -s gcf -t gcf` and `python -m unittest discover -s gcf_v3 -t gcf_v3`
  — all green.
- `git diff --stat main...HEAD -- gcf cloudbuild.yaml` is empty.
- Merge the branch into `preview` and push `preview` (push order, `CLAUDE.md`). The `push` run on
  `preview` is the first real run of the new layout: confirm four check runs (`node`, `solver-v2`,
  `solver-v3`, `gates`), all `success`; the `solver-v2` log reports `Ran 105 tests` (or today's count
  on `main` if it moved) and `test_schedule_matches_the_golden … ok` exactly once in the whole run;
  `solver-v3` reports `Ran 1 test`. Record per-job durations and wall time in `docs/CI.md` «Timing».
  That record is a new commit on the feature branch: merge it into `preview` and push `preview` again
  before it reaches the PR, so the PR head that is reviewed and armed is exactly what `preview`
  carried (the same holds for every later fix). Verify the dev alias per `CLAUDE.md` (alias array contains `dev-owt-backstage.vercel.app`,
  `githubCommitSha` = the pushed `preview` commit); the app is unchanged.

### 6. Pull request and the deliberate-red control

- Open the PR from the feature branch to `main`. Wait for `gates`.
- **Deliberate-red control (once, never merged):** from the feature branch, create a throwaway branch
  `claude/c0-red-control` with one commit that makes `gcf_v3/test_scaffold.py` fail, and open it as an
  ordinary (**not draft**) PR to `main` titled «DO NOT MERGE — CI control». Not a draft, because
  GitHub reports `mergeStateStatus: DRAFT` for any draft regardless of checks, which would prove
  nothing about protection; protection refusing this PR's merge is the thing under test. Never arm
  auto-merge on it. Observe: `solver-v3` concludes `failure`; `gates` concludes **`failure`** (not
  `skipped`, not absent — confirm with `gh api repos/FrankERP/owt-kb-v1/commits/<sha>/check-runs --jq
  '.check_runs[] | select(.name=="gates") | .conclusion'`) and its log names `solver-v3`;
  `gh pr view <n> --json mergeStateStatus` is `BLOCKED`. Close the PR unmerged and delete the branch —
  nothing reaches `main`. Record its run id and the three observations in the real PR's description.
  (A throwaway PR keeps the real PR's history equal to what `preview` carried.)
- **State after:** the real PR is green and unmerged.

### 7. Review, release, post-merge checks

- Fresh code review on the merge range (it also carries the docs-audit and worklog checklists,
  `CLAUDE.md`); fix → re-verify the fix (scoped review + gates re-run on the final tree). If a fix
  lands, it goes to `preview` first, then the PR.
- Arm auto-merge **last**, on the reviewed, re-verified commit that `preview` carries
  (`gh pr merge <n> --auto --merge`); disarm before any further push.
- After the merge: `gh api repos/FrankERP/owt-kb-v1/branches/main/protection --jq
  .required_status_checks` still shows `contexts: ["gates"]` and the GitHub Actions app; the `push`
  run on `main` has four green jobs; the production alias serves the merge commit (alias +
  `githubCommitSha`, `CLAUDE.md`). No Cloud Build run exists for the merge commit (Assumption A1).

## Data and failure safety

- **Identity and source of truth:** none — no data. The source of truth for «may this merge» stays the
  check run named `gates`.
- **Migration and compatibility:** open PRs need no action: a `pull_request` run uses the workflow from
  the PR's merge commit with `main`, so once C0 is on `main` every PR that is up to date with it
  (`strict` requires that) runs the new layout. A PR not yet updated still produces a `gates` from the
  old single job, which is equally strict.
- **Partial failure and retry:** a single failed job makes `gates` red; «Re-run failed jobs» re-runs
  that job and then `gates` (dependents re-run with it). A cancelled run makes `gates` red.
- **Concurrency:** unchanged workflow-level group; a newer push cancels the whole run.
- **Data preservation and rollback:** nothing to preserve. Rollback is Revert (below).

## Verification

| Requirement | Test or check | Failure it detects |
|---|---|---|
| `gates` keeps its name and is the only `gates` | Guard (Step 3); post-merge protection read (Step 7) | Renamed or duplicated required check; protection pointing at nothing |
| `gates` is never green over a red, skipped or cancelled job | Guard (`always()`, `needs` = all jobs); verdict runner executed as a process; deliberate-red control PR (Step 6) | Skipped-is-passing; a job left out of `needs`; swapped exit codes |
| Every test module under `gcf/` and `gcf_v3/` runs in exactly one job | Guard partition + command checks; «Ran N tests» per job (Step 5) | Misplaced or misnamed test running nowhere; a suite discovered twice |
| Neither tree imports the other | Guard import-ban check and its negative/positive cases (Step 3) | v3 silently depending on v2 code (or the reverse), which the start directory does not prevent |
| `GOLDEN_SCHEDULE` runs once, Linux x86_64, in Actions | Guard golden-placement check; log check (Step 5); the test's own CI-fails-on-skip (`gcf/test_inertness.py:276-288`) | Matrix, ARM runner or duplicate job silently doubling or disabling the golden |
| Same tests on every trigger | Guard (no `paths`, no job `if:`); preview and PR runs (Steps 5–6) | Frontend-only PRs skipping solver suites |
| v2 untouched | `git diff --stat main...HEAD -- gcf cloudbuild.yaml` empty; no Cloud Build run on merge | Accidental v2 change or redeploy |
| Faster wall time | «Timing» table: post-split wall < 15m11s baseline | A layout that serialises jobs |
| Stale timing fixed | grep (Step 4) | «6m34s» surviving in live docs/comments |

## Rollout, observability, and rollback

- **Release sequence and gates:** Steps 5 → 6 → 7: local gates, `preview` run of the new layout, dev
  alias verified, PR `gates` green, deliberate-red control observed, fresh code review and re-verify,
  auto-merge armed last, production alias verified.
- **Signals proving success:** four green check runs on the `main` push run; protection still
  `["gates"]`; wall time recorded and below the baseline.
- **Stop conditions:** the deliberate-red control shows `gates` as anything but `failure`; protection
  shows a context other than `gates`; any `gcf/` or `cloudbuild.yaml` diff; `solver-v2`'s test count
  differs from the count on `main` at the merge base.
- **Rollback:** revert the merge commit through a PR (protection applies; the revert's own run uses the
  restored single-job workflow, which still produces `gates`). Protection needs no re-apply because it
  never changed. The `gcf_v3/` scaffold goes with the revert; if C5 has already built on it, revert
  only `ci.yml` and the guard, and run both suites as steps of the single `gates` job instead (Parent
  issue 1).
- **Restoration verification:** the revert's `main` run shows one `gates` job with all steps green;
  protection still `["gates"]`.

## Assumptions

| Assumption | Impact if false | Validation point | Failure response |
|---|---|---|---|
| A1 — the v2 Cloud Build trigger's included-files filter is `gcf/**` and `cloudbuild.yaml` (as `cloudbuild.yaml:3-5` says), which does not match `gcf_v3/…` | The merge redeploys v2 from unchanged `gcf/` — same code, but an unplanned deploy | Read-only, by Frank or with his consent: `gcloud builds triggers describe` for the solver trigger; otherwise post-merge, Cloud Build history shows no run for the merge commit | If a run appears: confirm it deployed identical source, tell Frank, and record the real filter in `docs/SOLVER_AND_INFRA.md`; C5 must account for it before creating its own trigger |
| A2 — the runner's preinstalled Node runs a builtins-only `.mjs` | `gates` errors → red (fails closed) | Step 5's `preview` run | Add `actions/setup-node` with `.nvmrc` to `gates` |
| A3 — `ubuntu-latest` stays x86_64 | `GOLDEN_SCHEDULE` fails in CI by design (`test_inertness.py:284-288`) | Every run | Pin `ubuntu-24.04` or re-capture per `docs/CI.md`; not this plan's to pre-empt |
| A4 — the discovery model matches Python 3.12's `unittest` | A test placed where the model says «reachable» does not run | Step 1 and Step 5 «Ran N tests» against the guard's module count (4 + 1 modules today) | Tighten the model and add the case as a negative test |

## Open questions

None blocking. Non-blocking, with bounded defaults:

| Question | Why it matters | Recommendation and why | Tradeoffs | Owner | Blocking? | Resolution point | Bounded default |
|---|---|---|---|---|---|---|---|
| Should `solver-v2`'s timeout drop from 25 to 20? | Faster failure on a hung job | Keep 25 until the post-split timing exists; the P6 rule then decides | A hung job holds a PR ≤ 25 min | Claude | No | Step 5 timing | 25 |

## Parent issues

Parent issue 1 of the previous draft (who creates `gcf_v3/` before C5) is settled by parent A20 and
removed. One remains:

1. **The C0 row's rollback («Revert», parent §11) is incomplete once C5 has landed on the scaffold.**
   §13 makes C0 a prerequisite of C5 («→ C5 | C0 merged; …»), and C5 takes the `gcf_v3/` scaffold over
   (A20, C5 §11.1). A plain revert of C0's merge after that point deletes or conflicts with C5's files
   and removes the `solver-v3` job that C5's suite depends on. **Recommended fix:** C0's rollback cell
   reads «Revert before C5 lands; after it, revert only the workflow split and the guard, and run both
   suites as steps of the single `gates` job». This plan follows that reading (Rollback, above). Not
   addressed by A1–A26.

## Notes to siblings

- **C5 §11.1 «Layout»** (its opening paragraph) says «C0's CI contract (I2) makes `gcf/` unimportable
  in the v3 job». That is not true of any start-directory layout: `python -m unittest` from the repository root puts the
  root on `sys.path`, so `gcf.owt_solver_v2` imports as a namespace package inside `solver-v3`
  (measured on Python 3.12.13; Evidence). I2 now states the isolation as the guard's import-statement
  ban (Step 3). Suggested rewording for C5: «C0's guard forbids any import of `gcf` from `gcf_v3/`
  (I2); C5 adds no dynamic import of it either.»

## Handoff

- **Prerequisites supplied to later plans:** I1–I3 to C5; the fixture path contract to C2 and C5; the
  full-tree `node` job to C6's sync tests; a `gates` whose meaning survives added jobs, to every child
  and to C7.
- **Outputs promised:** the four-job workflow on `main`; the guard; the scaffold; a dated timing
  table in `docs/CI.md`.
- **C5 must:** keep I2, including the import ban (no `import`/`from` of `gcf` under `gcf_v3/`, and no
  dynamic import of it); keep `gcf_v3/acceptance/` free of `test*.py` or make each one reachable; set
  `solver-v3`'s timeout from its own measured run by the P6 rule; keep `gcf_v3/.gcloudignore` excluding
  tests; give its Cloud Build trigger a `gcf_v3/**` filter that does not match `gcf/` (C5 §11.3 plans
  `owt-solver-v3-deploy` with included files `gcf_v3/**` and config `gcf_v3/cloudbuild.yaml`).
- **Adversarial review order:** none (standard tier). Fresh code review of the diff before merge.
- **Implementation authorization: not granted by this plan.**

## Terminal state

`READY_FOR_REVIEW`
