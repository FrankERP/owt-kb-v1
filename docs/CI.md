# CI and branch protection

## Why this exists

`main` auto-deploys to production — `owt-backstage.vercel.app`, the app the
worship team actually uses. Until 2026-08-24 the only thing standing between a
red test suite and that app was a person remembering to run three commands and
report the result honestly. "Gates green" was an assertion in a chat log.

This makes it a check. The distinction the repo already draws elsewhere applies
here: a control is something that can stop you; an intention is something you
meant to do.

## The workflow

`.github/workflows/ci.yml`: three jobs do the work, in parallel, and a fourth,
**`gates`**, is the check branch protection requires. Until 2026-10 it was one
serial job named `gates`; it was split when the v2 solver step reached ~10 of the
job's 15 minutes and solver v3 was about to add a second suite (see «Timing»).

| | |
|---|---|
| Triggers | `push` to `main` and `preview`; `pull_request` targeting `main` or `preview`; manual `workflow_dispatch`. Every job runs on every trigger — no path filters, no job `if:` except `gates`' `always()` |
| Concurrency | one run per branch (or per PR); a newer push cancels the in-flight run |
| Permissions | `contents: read` only |

| Job (display name) | Runner | Steps | Timeout |
|---|---|---|---|
| `node` | `ubuntu-latest`, Node from `.nvmrc` (22), npm cache | checkout → `npm ci` → `npx tsc --noEmit` → `npm test` (vitest) → `npx eslint .` | 15 min |
| `solver-v2` | `ubuntu-latest` (x86_64), Python 3.12 with pip cache keyed on `gcf/requirements.txt` | checkout → `pip install -r gcf/requirements.txt` → `python -m unittest discover -s gcf -t gcf -v` | 25 min |
| `solver-v3` | `ubuntu-latest` (x86_64), Python 3.12 with pip cache keyed on `gcf_v3/requirements.txt` | checkout → `pip install -r gcf_v3/requirements.txt` → `python -m unittest discover -s gcf_v3 -t gcf_v3 -v` | 15 min |
| `gates` | `ubuntu-latest`, the runner's preinstalled Node | `needs: [node, solver-v2, solver-v3]`, `if: ${{ always() }}`; checkout → `node scripts/ci/gates-verdict.mjs` with `NEEDS_JSON: ${{ toJSON(needs) }}` in `env:` | 5 min |

`npm ci`, not `npm install`: it fails on a lockfile that drifted from
`package.json`, rather than silently resolving something new. Python 3.12 matches
the solver function's own `--runtime=python312`.

**`eslint` runs without `--max-warnings`.** Warnings are a deliberate backlog
(see `eslint.config.mjs`); errors are not. This matches what `CLAUDE.md` asks of
a local run — 0 errors, warnings tolerated.

### Why `gates` is an aggregator

Branch protection on `main` requires **one** check, `gates`, from the GitHub
Actions app, matched by check-run **name**. Whatever job carries that name is the
control, so after the split it had to stay one job that is green only when every
other job is.

- **A skipped required check counts as passing.** A job whose `needs` failed is
  not run; it concludes `skipped`, and GitHub lets a PR merge over a skipped
  required check. A `gates` with a plain `needs:` would therefore be skipped — and
  merge — exactly when a suite went red.
- **So `gates` has `if: ${{ always() }}`** and is never skipped. `!cancelled()`
  is not enough: on a cancelled run it skips `gates` too. With `always()` a
  cancelled run makes `gates` red, not absent.
- **The verdict is a script, not an expression.** `scripts/ci/gates-verdict.mjs`
  reads `toJSON(needs)` from `NEEDS_JSON` (through `env:`, so job data never enters
  the shell source) and exits 0 only if that object is non-empty and every entry's
  `result` is exactly `success`; its log names every job that was not. It is generic
  over `needs`, so a job added later needs no script change — and Node builtins
  only, so `gates` needs no `npm ci`. An inline `jq 'all(...)'` was rejected: it is
  true on an empty object and cannot be tested as a process.
- **No path filters.** A filter decides from the changed files whether the
  workflow runs at all, and a skipped or missing `gates` either blocks a PR forever
  or passes it. A frontend-only PR runs both solver suites; a change to a shared
  fixture runs every suite that reads it.
- **Why the three jobs are not required individually.** That needs a protection
  change with admin rights, and every future job would need another one. With the
  aggregator, adding a job means adding it to `gates.needs` — and the guard fails
  until it is.
- **Re-runs.** «Re-run failed jobs» re-runs the failed job and `gates` with it.

`scripts/__tests__/ciLayout.test.ts` is the guard, over the pure rules in
`scripts/lib/ci-layout.mjs`, and it runs in every `npm test` (so in `node`). It
asserts on the real files: exactly one job across all workflows reports as
`gates` (its `name:`, or its id when nameless), and it is job `gates` in `ci.yml`;
no job `name:` in any workflow is a `${{ }}` expression, which could evaluate to
`gates` unseen; its `needs` is every other `ci.yml` job; it has `always()`, a
timeout, no matrix, and the verdict step fed through `env:`; no
`paths`/`paths-ignore`/`branches-ignore` filter; no job `if:` but `gates`', and no
step `if:` at all (a skipped test step leaves its job green); no
`continue-on-error`; no sparse checkout; no step `shell:` or `working-directory:`
and no `defaults:` (`shell: bash -c 'true' {0}` runs nothing and exits 0); a
timeout on every job; and the solver-suite rules below. Walking `gcf/` and
`gcf_v3/`, it skips `__pycache__`, `venv` and dot-directories, so a local `.venv`
does not redden `npm test`. It carries permanent negative cases —
each one a mutation of the real `ci.yml` or a synthetic tree that must stay red —
and executes the verdict runner as a process, because a swapped exit code would
pass a test that only reads the file. It reads workflows with a small YAML-subset
reader (no YAML parser is a direct dependency) that throws on anything it does not
model, so a reformatted workflow fails red, never green.

### Solver suites

Two jobs, one per tree, each running exactly one command from the repository
root:

```bash
python -m unittest discover -s gcf -t gcf -v        # solver-v2 — the deployed solver
python -m unittest discover -s gcf_v3 -t gcf_v3 -v  # solver-v3 — package owt_v3
```

The guard models unittest's default discovery (Python 3.12) and refuses whatever
the model does not follow, so every test module under `gcf/` and `gcf_v3/` runs in
exactly one job:

- A file is a test module iff its name matches `test*.py`, is a valid module name,
  and it sits in the tree's root or in a directory chain below it where **every**
  directory has an `__init__.py`. Discovery skips anything else silently, so the
  guard refuses a `test*.py` it cannot reach.
- Refused anywhere in either tree: a `*_test.py` file (the pattern never matches
  it), a `load_tests` definition, a `-p` pattern, a `-s` that differs from `-t`, and a
  `unittest` run in any other form — including a `run: |` block. Each tree needs at
  least one reachable test module: discovery exits 5 («NO TESTS RAN») on an empty
  tree and 1 on a missing one. A package with no `test*.py` (say `gcf_v3/acceptance/`)
  is allowed and contributes nothing.
- Imports resolve with the tree as the top-level directory: `owt_v3`, `tests.…`,
  `acceptance.…` — never `gcf_v3.…`, which resolves only because CI's working
  directory is on `sys.path`.
- **Neither tree imports the other.** `python -m` puts the repository root on
  `sys.path`, so `gcf.owt_solver_v2` *is* importable in `solver-v3` (as a namespace
  package) and `gcf_v3.owt_v3` in `solver-v2` — the start directory isolates
  nothing. The guard reads import statements instead: nothing under `gcf_v3/` may
  `import gcf…` / `from gcf… import`, and nothing under `gcf/` may import `gcf_v3`
  or `owt_v3`. A dynamic `importlib`/`__import__` is a code-review matter.
- **`GOLDEN_SCHEDULE` runs once per run, in `solver-v2`**, on an x86_64
  `ubuntu-latest` runner with no matrix — the only place it is enforced (see
  «Solver inertness goldens» below).

Every job has the full tree checked out from the repository root, so a fixture at
the root (for example `fixtures/fairness/golden.json`) is present in `node` and in
both solver jobs; resolve it relative to the test's own file, never to a `cd`.

`gcf_v3/` holds the v3 solver (solver v3 C5): the `owt_v3` package, the HTTP entry
`main.py`, the `--json-mode` CLI `owt_solver_v3.py`, `requirements.txt` (the same
ortools pin as `gcf/`, plus `functions-framework`), its own `.gcloudignore` and
`cloudbuild.yaml`, the unit suite in `tests/` and the acceptance harness in
`acceptance/` (a package with no `test*.py`; its `ci` subset runs from
`tests/test_acceptance_ci.py`). C0's `test_scaffold.py` stays. Two of the suite's
modules read `fixtures/fairness/golden.json` (C2's fixture), so the job is red
without it. v2's trigger filters on `gcf/**` and `cloudbuild.yaml`; v3's
(`owt-solver-v3-deploy`) on `gcf_v3/**` — neither matches the other's paths.

### Timing

**Rule for every `timeout-minutes` in `ci.yml`:** a job's timeout is at least
twice its latest measured job time. Re-measure when a suite's step time grows by a
quarter, and split again rather than drop a suite. The numbers live here, not in
workflow comments. `solver-v3`'s 15 was set before its suite existed; the suite's
first GitHub-runner measurement (a `workflow_dispatch` run of the C5 branch) is
still to be taken, and 15 stands while that job stays at or under 7m30s.

| Run | Date | Commit | Layout | Node steps | v2 solver steps | v3 solver steps | Wall (job) |
|---|---|---|---|---|---|---|---|
| 36983149539 | 2026-10-02 | `0a81839c` (`main`) | one job | 4m34s | 10m03s (tests 9m43s) | — | 14m41s |
| 37357419306 | 2026-10-05 | `4759a214` (`main`) | one job | 4m50s | 10m20s (tests 10m01s) | — | 15m11s |
| 37420430364 | 2026-10-06 | `599734c5` (`preview`) | split | 5m02s (job `node` 5m05s) | 10m08s (tests 9m53s; job `solver-v2` 10m16s) | job `solver-v3` 24s | 10m29s (run) |

The single-job rows sum the job's own step times: «Node steps» is set-up through
Lint, «v2 solver steps» is setup-python through «Solver tests». The split row is the
first run of the split layout (the `push` run on `preview`): the same step sums, each
job's own duration in brackets, and the run's wall time (created → `gates` done). Its
`gates` job took 8 s on the runner's preinstalled Node (assumption A2 holds).

### Solver inertness goldens (`gcf/test_inertness.py`)

The Cloud Function deploys from `main` with no `preview` rehearsal and serves both
environments, so a solver change is safe to ship only if a request with no `pinned` key builds
the model **and runs the search** it did before. Three literals, frozen from the solver as it
stood before pins existed, hold that. A fourth, frozen before the trailing Saturday, holds the
same for a request that does not name it, over eight shapes (no, some and all Saturdays; five
Sundays; week exclusions; history; pins; pins with history). A fifth, frozen on the solver that
first staffed the trailing Saturday, holds one request that does name it, so a later change to
that path is measured against it. All five are captured on the file's own frozen copy of the
fixture (`frozen_config`), not on `make_config`, so editing the shared test fixture for an
unrelated test cannot redden them.

| Literal | Moves when | Legitimate re-capture |
|---|---|---|
| `STAGE_A_FINGERPRINTS` — sha256 of Stage A's model proto plus its solver parameters (time limit stripped), three seeds | Stage A's model or search parameters change | an ortools pin bump, in a PR that changes nothing else — **not** a runner-image change: the fingerprints are machine-independent, so a new image is no excuse for a red one |
| `LADDER_FINGERPRINTS` — the same for every solve after Stage A, in order, up to the pass that returns the month; behind a Stage A `OPTIMAL` precondition | the above, **or the objective** (`compute_priority_weights` feeds it; Stage A never enters that branch), or the ladder's pass sequence | the above, plus a deliberate, reviewed objective change |
| `IDENTITY_FINGERPRINTS` — the same as `LADDER_FINGERPRINTS` plus Stage A, for each of eight non-trailing request shapes, hashed without Stage A's `solution_hint` (Solve 0's tie-broken solution under pins); behind an `OPTIMAL` precondition on every solve before the ladder (Stage A, and Solve 0 ahead of it under pins) | the same as `LADDER_FINGERPRINTS`: Stage A's model or search parameters, **or the objective**, or the ladder's pass sequence | the same: an ortools pin bump, plus a deliberate, reviewed objective change — never a PR that claims non-trailing requests unchanged |
| `TRAILING_FINGERPRINTS` — the same as `IDENTITY_FINGERPRINTS`, for one request that names the trailing Saturday (`w4-trailing`: the seed-1 fixture with Saturdays `[2, 4, 5]`); behind a Stage A `OPTIMAL` precondition | the same as `LADDER_FINGERPRINTS`: Stage A's model or search parameters, **or the objective**, or the ladder's pass sequence | the same as `LADDER_FINGERPRINTS`: an ortools pin bump, plus a deliberate, reviewed objective change |
| `GOLDEN_SCHEDULE` — the seed-42 schedule, behind an `OPTIMAL` precondition on the returning solve | the above, **or how ortools breaks a tie on the runner** | the above, plus a runner-image change |

**A red fingerprint inside a PR that claims the pinless path unchanged — the pinned-assignments
PR is one — or that claims non-trailing requests unchanged — the trailing-Saturday PR is one — is
a finding, never a literal to update.** It means that path moved, which is the one thing the
preview-less release bets did not happen.

**The output golden runs only on the platform that captured it.** `OPTIMAL` removes the wall
clock, not every tie: on 2026-09-25 a Mac (arm64) and this runner both proved seed 42 optimal
through the same statuses and returned schedules differing in 7 of 16 role cells. Enforced
everywhere, a runner-captured golden would be red on every developer machine, so it skips
off-platform — **except inside GitHub Actions**, where a skip would leave the required gate green
with the guard switched off; there it fails, asking for a re-capture on the new platform. The
fingerprints run everywhere. Stage A's is machine-independent unconditionally; the ladder's only
because Stage A proved `OPTIMAL`, which the test asserts. Both measured identical on the runner and
on macOS, across budgets and `PYTHONHASHSEED` values. The intermediate passes' *statuses* are not
frozen: an infeasibility proof may time out to `UNKNOWN` on a loaded runner and the ladder moves on
identically. The identity fingerprints add two cases for pinned requests. Solve 0 runs first and its
violation count is a ceiling every later solve inherits, so those shapes assert Solve 0 **and** Stage A
`OPTIMAL`. And Stage A is hinted with Solve 0's solution: `OPTIMAL` proves the count minimal, not
*which* minimal solution came back, and ties are the machine's to break — so the identity
fingerprints hash the model **without `solution_hint`**. The hint only steers Stage A's search;
Solve 0's own fingerprint carries none and stays guarded. One blind spot by construction: a **zero-coefficient** objective term that adds no
variable and no constraint is dropped from the proto and invisible to every guard here.

**Captured on:** GitHub Actions `ubuntu-24.04`, runner image `20260920.314.1`, Python 3.12.14,
ortools 9.15.6755, protobuf 6.33.6 — run 36172243640 (`CAPTURED_ON` in the file). A runner-image
bump never arrives as a PR here, so a red golden will first show up on an unrelated one: compare
the job log's **Runner Image** group against that before treating it as a finding.

**If a slow runner trips an `OPTIMAL` precondition,** raise `INERTNESS_BUDGET_SECONDS` in the file
(the solver clamps it to 30 s); never drop the assertion. **To re-capture:** a fingerprint's
failure message already prints the actual value — commit it only for a cause in the table. The
golden: set `GOLDEN_SCHEDULE` to `None` and push; in the `solver-v2` job the test then **fails** with the
captured schedule in its message (a golden left at `None` must never pass the required gate), and you
commit it with the runner image it came from.

### Deliberately not in CI

- **Playwright e2e** (`e2e/service-readiness/`) — needs live Sanity credentials
  and writes to the real dataset. Running it on every push would either leak
  credentials into CI or be flaky against production data.
- **Theme-gallery visual regression** (`e2e/theme-gallery/`, `npm run test:vr`) — its
  baselines are captured on darwin and committed per platform, and it needs a built
  server (`next build && next start`) to shoot against. On `ubuntu-latest` it would
  compare Linux font rasterisation against macOS PNGs and fail every fixture. See
  `e2e/theme-gallery/README.md` and ADR-0014.
- **`next build`** — Vercel already builds every push to both deploying
  branches. Repeating it here would roughly double CI wall time to re-prove
  something a deploy already proves, and a Vercel build failure is already
  visible.

### Secrets

**This workflow needs no secrets and no environment variables**, on any
platform. Its jobs install from the lockfile and the solver requirements files and
run local commands only; `gates` reads nothing but the other jobs' results. Nothing
to rotate, nothing to configure in GitHub → Settings → Secrets. If a future step
needs one, it gets an entry in `docs/SECRETS.md` in the same change.

## Branch protection

Applied to **`main` only**, via the GitHub API:

- Required status check: **`gates`**, with `strict: true` — the branch must be
  up to date with `main` before merging, so a check cannot pass against a stale
  base. Since the 2026-10 CI split `gates` is the aggregator over every other CI
  job (see «Why `gates` is an aggregator»); the required check kept its name, so
  protection and `scripts/apply-branch-protection.sh` were not touched.
- Required pull request before merging: **1 approving review is NOT required**
  (there is one human on this project; a self-approval adds ceremony, not
  safety). What is required is that changes arrive *through* a PR, so the check
  has a commit to run against.
- **`enforce_admins: true`** — protection applies to repository admins too.
- Force pushes and branch deletion: blocked.
- Conversation resolution: not required.

**Auto-merge is allowed** (`allow_auto_merge: true`, a REPOSITORY setting, since
2026-09-29 — Frank asked for it after enabling it on PR #111 was refused while
that PR's `gates` re-ran against a moved `main`). It does not loosen anything
above: GitHub merges an auto-merge PR only once `gates` is green on a branch
that is up to date with `main`. What it removes is the wait on CI — not the
catch-up: with `strict` and no merge queue, a PR that another merge leaves
behind waits, out of date, until someone brings `main` into it. Because it
merges on green and not on anyone's look, it approves a COMMIT, not a PR: it is
armed LAST, on the exact commit that was reviewed, re-verified and seen on dev
in the release flow below (`gh pr merge <n> --auto --merge`; the history uses
merge commits). GitHub keeps it armed across later pushes, so it is disarmed
(`gh pr merge <n> --disable-auto`) before anything else is pushed to that branch
— a review fix or a catch-up merge — and re-armed only once that commit is
verified too. It is not part of `scripts/apply-branch-protection.sh`, which sets
BRANCH protection: the emergency `DELETE …/protection` does not touch it, and
re-applying protection does not restore it — `gh api -X PATCH
repos/FrankERP/owt-kb-v1 -F allow_auto_merge=true` does.

**`preview` is deliberately NOT protected.** It is the rehearsal branch and
takes direct pushes; CI still runs there, so a failure is visible fast, but it
does not block. Slowing down the dev rehearsal is the opposite of the point.

### Why admins are not exempt

An admin bypass would make this advisory again — and the agents that do most of
the work here push with the owner's credentials, so they would inherit the
bypass. The control would exist on paper and not in fact.

The escape hatch is deliberate friction rather than a silent flag:

```bash
gh api -X DELETE repos/FrankERP/owt-kb-v1/branches/main/protection
```

Disarm any auto-merge PR FIRST (`gh pr list --json number,autoMergeRequest`, then
`gh pr merge <n> --disable-auto`): with no required check left, an armed PR has
nothing to wait for and merges the moment protection comes off.

…do the emergency push, then re-apply with `scripts/apply-branch-protection.sh`.
Turning protection off is an explicit act that leaves a trace in the audit log;
`--no-verify` on a local hook is not.

## The release flow, after this change

```
feature branch (local gates green)
  → merge the feature branch into preview, push preview
  → VERIFY the dev alias moved (alias array + githubCommitSha)
  → open a PR from the feature branch to main, WAIT for `gates`
    (or arm `gh pr merge <n> --auto --merge` on the commit that was
    reviewed, re-verified AND seen on dev — never before)
  → merge the PR — that IS the production release
  → VERIFY the production alias the same way
```

`preview` still goes first. The PR gate proves the code compiles and its tests
pass; it says nothing about whether the change looks right to a human on dev.
Those are different questions and the gate only answers one of them.

### When the production build fails after the merge

A green `gates` run and a green `preview` build do not guarantee the production
build. If Vercel's build of the merge commit ends in `ERROR`, **production is
not affected**: the alias never moves to a failed deployment, so
`owt-backstage.vercel.app` keeps serving the previous release. That is also why
the alias check in the flow above is the step that catches it — a merged PR is
not a release until `alias` contains the production domain *and*
`meta.githubCommitSha` is the merge commit.

**The one seen so far: the Google font fetch (2026-10-05).** PR #127's merge
(`095e5033`) failed in `next build` with

```
[next]/internal/font/google/urbanist_….module.css
Module not found: Can't resolve '@vercel/turbopack-next/internal/font/google/font'
next/font/google queries have exactly one entry
```

with the import trace ending in `./app/(admin)/layout.tsx` (Urbanist is declared
in `app/brandFonts.ts`, which the layouts import). The diff touched only
`CueDialogProvider.tsx` and its test, and the identical tree had built `READY` on
`preview` 20 minutes earlier. `next/font/google` downloads the font files from
Google at build time, so that step can fail on its own, whatever the commit
contains. One redeploy of the failed deployment, same commit, went `READY` and
the alias moved.

**What caused it is not known, and the fix does not tell you.** The failed build
had restored its build cache from a previous deployment; the redeploy that
worked ran **without** cache — its log says *"Skipping build cache, deployment
was triggered without cache"*. That redeploy was `POST /v13/deployments` with the
failed `deploymentId`, `target: "production"` and the query `forceNew=1`; the
cache skip most likely came from `forceNew=1`, which is what the CLI's `--force`
sends, and Vercel documents `--force` as skipping the build cache (its
`--with-cache` keeps it). So the retry changed two things at once — a fresh
download and no cache — and either could have been the problem: a failed fetch
from Google, or a bad font entry in the restored cache. Write it down if it
happens again with a cache-backed retry succeeding or failing; that is the
observation that separates the two.

**Recognising it** — all of these, not some:

- every error sits under `[next]/internal/font/google/`;
- `git diff --stat <SHA production serves> <failed SHA>` — the release diff,
  not the PR's, since production may be several merges behind — touches none of
  `app/brandFonts.ts`, any `layout.tsx`, `next.config.mjs`, `package.json`,
  `package-lock.json` (a `next` bump changes the font loader) or `vercel.json`;
- the same tree built `READY` on `preview`.

Anything less is a real failure until shown otherwise. A Vercel project-setting
change (Node version, environment variables) never shows up in a diff, so check
the project's recent settings too before calling it transient.

**What to do:**

1. Confirm production is still on the previous release (`get_deployment` on the
   production domain: old SHA, `READY`) — then nothing is on fire.
2. Read the failed deployment's build log (`list_deployment_events`); check the
   signature above.
3. **Only if the failed commit is still `main`'s HEAD**, redeploy that
   deployment **once**, same commit, without build cache: the dashboard's
   Redeploy with «Use existing Build Cache» unchecked, or the API call above
   *including* `forceNew=1`. If a later merge has deployed, it already contains
   this change — never redeploy an older commit to production. A production
   redeploy is never skipped by the `ignoreCommand`: anything with
   `VERCEL_ENV=production` builds (see below).
4. Verify the alias and the SHA as usual. Treat a second failure as not
   transient: stop and investigate.

**Not** an empty commit or a revert-and-reapply to "kick" the build: on `main`
each is a release of its own, and needs a PR and `gates` to get there.

## Which branches Vercel builds

Only three refs spend a Vercel build: **`main`** (production), **`preview`**
(the stable dev alias) and **`verify/service-readiness`** (the isolated
verification dataset that `scripts/lib/deployment-coherence.mjs` asserts at
build time). Everything else — every `claude/*`, `docs/*`, `fix/*` working
branch — is skipped.

`vercel.json`'s `ignoreCommand` runs `scripts/vercel-ignore-build.mjs`, a thin
runner over the pure `evaluateDeployPolicy` in
`scripts/lib/deploy-branch-policy.mjs`. Vercel inverts the usual exit contract:
**0 ignores the build, 1 continues it.** The step runs *before* `npm install`,
so that module may use Node builtins only.

**A skipped ref still gets a deployment**, in state `CANCELED`, with a URL that
serves nothing. So the Function Storage saving is complete — no build output
means no function bundle and no retained GB — but canceled builds still count
against the deployments-per-day quota and can still take a concurrent build
slot. "Feature branches are free now" is the wrong summary; "feature branches
stop accumulating storage" is the right one. `git.deploymentEnabled` would
prevent the deployment from being created at all, which is the one thing it
does better; it still loses on the point below.

**Why, and why not `git.deploymentEnabled`.** Vercel's Function Storage quota
counts the function bundle of every *retained* deployment, not just the current
one. On 2026-09-17 this project hit 100% of the 10 GB Hobby allowance with 136
retained deployments at roughly 75 MB each — the embedded Sanity Studio at
`/studio` is traced into the lambda, so each one is expensive. Half of them were
never read by anybody: every fix round pushes the feature branch *and* merges to
`preview`, so Vercel built twice, and 20 deployments landed in 4.5 hours that
day. The release flow above verifies on `dev-owt-backstage` and `main`'s only
required check is the `gates` job — Vercel contributes no status check, so a
feature-branch deployment gates nothing. `git.deploymentEnabled` cannot express
this rule: as an object it is a *blacklist* (unspecified branches default to
`true`), and as `false` it disables production too.

**It fails open where it can.** A deployment that reaches the step with no
`VERCEL_GIT_COMMIT_REF` builds, and so does anything with
`VERCEL_ENV=production` whatever ref it names — a belt so that renaming the
production branch cannot silently stop production from deploying. A broken
policy module exits non-zero, which also builds. Wasting one build is
recoverable; being unable to ship during a rollback is not.

**To build a skipped ref on purpose**, the hatch the mechanism itself
guarantees is that the deployment reads `vercel.json` *from the branch being
built*: merge into `preview`, or drop `ignoreCommand` on that branch and push.
That cannot fail, because nothing outside the branch decides it.

Vercel also documents a **«Use project's Ignore Build Step»** checkbox on the
Redeploy modal, and unchecking it runs the build. Treat it as a maybe, not a
plan: it is documented for an ignore step configured in *Project Settings*, and
this repo's comes from `vercel.json`, which overrides that setting — whether the
checkbox is even rendered, let alone whether it suppresses a `vercel.json`
command, is unverified against this project's dashboard. Do not expect the
remaining hatches at all: a *plain* redeploy re-runs this step and carries the
original deployment's git metadata, so it is skipped again, and a **deploy
hook** is bound to a project/repo/branch, so its deployment carries that ref
and is skipped too. Whether a CLI `vercel deploy` attaches git metadata is
likewise unverified — do not plan an incident around any of these.

`scripts/__tests__/deployBranchPolicy.test.ts` is the guard. It asserts the
wiring as well as the policy, and it *executes the runner as a process* rather
than grepping it, because the one mistake that matters — the two exit codes
swapped — cancels every build including `main` while leaving a text-matching
test green.

**Sweeping what has accumulated:**

```bash
npx vercel remove owt-backstage --safe --scope frank-rochas-projects
```

**`--safe` is not optional.** Given a project name without it, `vercel remove`
deletes **the entire project** — `owt-backstage`, the ID that the Vercel-safety
section of `CLAUDE.md` exists to protect — rather than its deployments. With
`--safe` it keeps everything holding an alias and removes the rest. Run it from
the primary checkout, which has the `.vercel/` link; a worktree does not, and
the CLI would try to link there. The sweep is irreversible and it also destroys
the previous production deployment, so one-step rollback goes with it.

## Re-applying protection

`scripts/apply-branch-protection.sh` is idempotent and prints the resulting
settings. Run it after any emergency override, or to inspect what is currently
enforced:

```bash
bash scripts/apply-branch-protection.sh
```

It requires `gh` authenticated as a repo admin.
