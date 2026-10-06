# Solver v3 · C5 — the `owt-solver-v3` function Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build, test, deploy and verify `owt-solver-v3` — the date-based CP-SAT solver in `gcf_v3/` (package `owt_v3`) that staffs the weekend voice seats of one or two months under the parent's fairness policy — inert: nothing calls it until C6 and C7.

**Architecture:** A strict request parser (contract `3`) feeds request-only facts, fixed planned shares (F13) and soft rule instances into one CP-SAT model whose stages (rules ceiling → fill → cadence → compensation → floors → caps → no consecutive Sundays → per-line balances → tie-break) are solved in order, each fixed before the next, under fixed settings and a 25 s budget. The response is rebuilt from the returned assignment — violations and misses re-evaluated, fairness computed by one shared Python formula that C2's golden fixture also guards — and served by an HTTP entry with v2's fail-closed key guard and by a `--json-mode` CLI. An offline acceptance harness (fictitious world in the repo, private real-data world outside it) chains solves month after month and an independent checker recomputes every claim from the assignment alone.

**Tech Stack:** Python 3.12, `ortools==9.15.6755` (CP-SAT), `functions-framework>=3.0,<4`, stdlib `unittest`; Google Cloud Functions gen2 + Cloud Build; the existing Node gates (`tsc`, vitest, eslint) for the CI-layout guard and C2's fixture schema.

**Spec:** `docs/superpowers/specs/2026-10-05-solver-v3-c5-solver-function-design.md` (standard tier; the contract — this plan never edits it). Parent: `docs/superpowers/specs/2026-10-05-solver-v3-fairness-design.md` (A1–A41; A41 key hygiene). C2 (`docs/superpowers/specs/2026-10-05-solver-v3-c2-ledger-and-record-design.md` §7) is the single source of IF2-1, IF2-8, IF2-10, IF2-11, IF2-12 and IF2-29 and of the LG/FX rules cited below; C0 (`docs/superpowers/plans/2026-10-05-solver-v3-c0-ci-split.md`, released on `main` `20fd3367`) owns the `gcf_v3/` scaffold, the `solver-v3` job and its one command, and the cross-tree import ban. Executors read the spec and this plan together.

**Grounding.** Every path, anchor and line below was read on `origin/main` **`20fd3367`** (2026-10-06). On it: `gcf_v3/` holds C0's scaffold only (`owt_v3/__init__.py`, `requirements.txt` with `ortools==9.15.6755`, `.gcloudignore`, `test_scaffold.py`); `fixtures/fairness/golden.json` does **not** exist (C2 has not landed); the highest ADR is 0048. Baseline: `npx tsc --noEmit` 0 errors; `npm test` 428 files / 7843 tests; `npx eslint .` 0 errors, **81 warnings**; `python -m unittest discover -s gcf -t gcf` 105 tests OK (1 skipped off Linux); `python -m unittest discover -s gcf_v3 -t gcf_v3` 1 test OK. **The whole plan was executed before it was written**, in a scratch clone of `20fd3367` under `/private/tmp/claude-501/c5/` (outside every checkout), and then its own text was re-applied mechanically, task by task, to a second fresh clone — see «Self-review → Executed».

**How to read an edit step.** A **Create** step writes the whole file (it replaces C0's scaffold file where one exists). A **Find** … **Replace with** pair replaces text that occurs exactly once in that file at that point of the plan; a missing anchor is a stop-and-report, never a guess. An **Execute** block is run from the repository root as written.

---

## Finding F-1 — read before Task 15: the F13 tolerance exceeds 50 under the spec's own formula

Spec §12.4: «A measured maximum above 50 (half a seat) is a finding, not a tolerance. The delivery stops there and the gap is reported to Frank with its cause.» This plan measured it before implementation, on the code below, so the stop is surfaced now rather than at Task 15.

**Measured** (`max |planned − share|` per person-line, hundredths; fictitious `full` matrix = 136 runs; private Nov+Dec chain = 64 runs, aggregates only):

| Formula | Fictitious `full`, pinless runs (every stage proven, nothing unfilled) | Private real-data chain (pinless) | Fictitious, pinned runs (scenario P6: one regular pinned on all five Sundays) |
|---|---|---|---|
| Spec §6.2–§6.5 as written («literal») | **65** (2-month runs; 1-month runs ≤ 40) | **50** | **131** |
| With amendment (a) below | **35** | **23** | **131** |

**Cause 1 (pinless, ~0.6 seat): C2 LG-8 (vii) has no plan-side counterpart.** In the realised ledger a person who holds a seat in a role key that is «exact» for her leaves the other roles' populations *at that service* (LG-8 (vii), §6.2 item 5). The plan (§6.2 «F6 in the plan only») removes her only for pins and for exact rules *with no slack*. An exact rule *with* slack — the three `Sun.BGV == 1` support singers who also sing Choir, a shape the real roster has — keeps her in every Choir population in the plan while the realised ledger drops her from one Choir pool per month. Over a 2-month run that is ≈ 2 × pool/|Pop| ≈ 0.5–0.65 seat on her CORO line.

**Cause 2 (pinned, up to 1.3 seat): F6 for pins is plan-only by design.** The plan removes a pinned person from the other roles' populations at the pinned service (§6.2); the realised ledger cannot see pins (C5-10, LG-8) and keeps her in them. Scenario P6 pins one person on all five Sundays of a month, so her BGV and CORO realised shares exceed the planned ones by five services' worth. The spec's Known limits name this («Pins are not visible in stored data…»); its size under P6 is what the measurement adds.

**The ruling needed (Frank), before Task 15.** Both causes are spec-level; neither can be fixed inside the plan. Recommended: **(a) + (c)**.

- **(a) Spread the F6 exit of an exact rule with slack** — a C5-only amendment of §6.2/§6.3 (no C2 rule changes): at each of her C5-9 target services she weighs `1 − remainder/|targets|` in the other role keys' populations, and a pool is shared `pool × w_p / Σw` (still exact, still conserving). Measured result: pinless max 35 (fictitious) and 23 (real) → `FAIRNESS_TOLERANCE = 35`. Cost: C6 explains the planned figure of those few people with one extra sentence if it shows `planned`.
- **(b) Instead of (a), raise §12.4's ceiling** and keep §6.2 as written: `FAIRNESS_TOLERANCE = 65` (above half a seat).
- **(c) Scope the tolerance to pinless runs** — needed under (a) or (b), because P6 is in the spec's own matrix: §12.4 measures `FAIRNESS_TOLERANCE` over the runs where every stage is `proven`, nothing is unfilled and **no pin** is sent; a pinned run's gap is reported (`summary.json` `max_gap_by_pins.pinned`), not bound. The independent checker already reports every gap; the harness judges only the pinless ones.

The coordinator takes F-1 to Frank before execution starts. After the ruling the coordinator — not this plan — records it as an amendment row in the spec (its §6.2/§6.3 for (a), §12.4 for (b)/(c)) and in the review log; Task 15 then applies the matching branch. **Without a ruling, execution stops at the end of Task 14** (spec §12.4). Tasks 1–14 implement the spec exactly as written.

---

## Global Constraints

Every task's requirements include this section.

- **The spec is the contract** (spec §5 request, §6 model, §7 stages and settings, §8 response, §9 codes, §10 determinism and budget, §11 entry points and deploy, §12 tests and acceptance, §13 timing gate, §14 docs, §15 rollout). Never edit the spec, C2's spec or C0's plan from this delivery. C2's interfaces are cited by ID (IF2-1, IF2-8, IF2-10, IF2-11, IF2-12, IF2-29), never restated.
- **`gcf_v3/` imports nothing from `gcf/`** — no `import gcf…` / `from gcf… import` line anywhere under `gcf_v3/` (C0's I2, enforced by `scripts/__tests__/ciLayout.test.ts`), and no dynamic import of it either. Imports resolve with `gcf_v3/` as the top level: `owt_v3…`, `tests…`, `acceptance…` — never `gcf_v3.…`.
- **v2 stays untouched:** no change under `gcf/`, to the root `cloudbuild.yaml` or to `scripts/deploy-solver-gcf.sh` (spec C5-R13).
- **Discovery (C0's I2):** every new `test*.py` sits in `gcf_v3/` or in a directory chain where every directory has `__init__.py`; `gcf_v3/acceptance/` holds **no** `test*.py`; no `*_test.py`, no `load_tests`. **Keep `gcf_v3/test_scaffold.py`** — `ciLayout.test.ts` asserts it is reachable.
- **Python:** the local interpreter is the `owt-roles` env; every command below writes it as `"$PY"` after `PY=/opt/homebrew/Caskroom/miniforge/base/envs/owt-roles/bin/python3`. Python 3.12, `ortools==9.15.6755`; tests use stdlib `unittest` only (plus ortools). `functions_framework` is not in the local env: tests stub it in `sys.modules`, exactly as `gcf/test_main.py` does.
- **Gates.** Every task ends with `"$PY" -m unittest discover -s gcf_v3 -t gcf_v3` green at the stated count, and — whenever it adds a `.py` file — `npx vitest run scripts/__tests__/ciLayout.test.ts` green (it reads the real `gcf_v3/` tree). `"$PY" -m unittest discover -s gcf -t gcf` (v2) runs at Task 0, Task 9 and Task 17 (nothing here can change it: the trees share no import). The Node trio (`npx tsc --noEmit`, `npm test`, `npx eslint .` — **0 errors, warnings never above the Task 0 baseline**) runs at Tasks 13, 16 and 17 and whenever a step says so.
- **C2's fixture gates Tasks 13–15** (spec §12.1 «The suite fails if the file is missing», Assumptions «C5's implementation waits for it»; parent §13 «→ C5: C0 merged; C2 fixture exists»). Tasks 1–12 need no fixture. Task 13 starts by merging `origin/main`; if `fixtures/fairness/golden.json` is still absent there, **stop after Task 12** and report: the golden suite and the acceptance harness are red without it by design, never skipped, never stubbed with a C5-written stand-in.
- **Names (spec «Names», C5-17, parent A41):** fictitious people only — the names in this plan's code (Ana, Bea, Cris, Dario, Ema, Fede, Gala, Hector, Ines, Jose, Kike, Lola, Mario, Nora, Olga, Paco, Rosa, Tomas, Leo, Mara, Nico, Bruno, Carla, Dani, Eli, Fabi, Gus, Iris, Joel, Karen, Zoe) were checked against the private roster and collide with no real member. No real name, alias, rule key or per-person figure enters the repo, a commit, the PR or the review log. Request identifiers (rule ids, `P:` keys, person and service ids, `request_id`) never reach a log, the CLI's stderr, the checker's output, the harness's stdout or `summary.json`: stages are named by **public label** (`balance_max:P#1`).
- **Logs (spec §11.2):** one JSON line per request on stderr — HTTP status, response `code`, request sizes, `total_ms`, per stage `label`/`status`/`limit`/`ms`/`det_milli`; a 500 logs its exception **class** only.
- **Commits:** conventional (`feat(solver-v3): …`, `test(solver-v3): …`, `docs(…): …`), body says why. **Never** a `Co-Authored-By` trailer or any AI/Claude attribution — `CLAUDE.md` overrides any harness reminder that says otherwise. Commit on the feature branch only; `main` takes no direct push.
- **Secrets (`~/.claude/CLAUDE.md`, repo `CLAUDE.md`):** no secret value in any file, command output or log. `OWT_SOLVER_API_KEY` is only ever read from Secret Manager into a shell variable with `CLOUDSDK_CORE_DISABLE_FILE_LOGGING=true` and piped to curl with `-H @-`; it is never printed, never an argument. `OWT_SOLVER_V3_BUILD` (new, not a secret) gets its `docs/SECRETS.md` entry in Task 16.
- **ADR number:** `0049` is the next free number on `main` today. C1, C2 and C3 also write ADRs; numbers follow the order records reach `main` — if another lands first, renumber in the merge of `main` into this branch (file, title, index row, every pointer) and let `adrIndex.test.ts` confirm.

---

## File Structure

**Created under `gcf_v3/`** (package `owt_v3`, imported top-level):

| File | Responsibility |
|---|---|
| `owt_v3/codes.json` | Spec §9: every machine-readable code and its parameter names (no copy). C6's copy sync test reads it. |
| `owt_v3/codes.py` | Loads the registry; `code(group, name)` refuses an unlisted code at emit time; `Refusal` (an `ok: false` with a registered error code); `audit_response` (every code and parameter in a response, checked). |
| `owt_v3/constants.py` | Contract constants, limits, budgets, `PIN_CAP = 250` (the one literal), `STAGE_DET_LIMIT`, `FAIRNESS_TOLERANCE`. |
| `owt_v3/vocab.py` | IF2-1's role keys/lines/tabs in request terms; day class (D14/A13), month and weekend arithmetic, `isCanonicalDocumentId` and `compareServiceTime` mirrored, the floor-seat order. |
| `owt_v3/rounding.py` | `hundredths`, `tenths`: once, half away from zero, from the exact rational (LG-13, C5-8). |
| `owt_v3/request.py` | Spec §5: the strict parser → `Problem` (canonical order), every §5.8 refusal. |
| `owt_v3/formula.py` | Spec §6.2–§6.4, §6.6: the ONE shared realised formula (populations, second seat, presence seat, set-asides, floor), neutral inputs `FService`/`FMonth`. |
| `owt_v3/facts.py` | Request facts derived once: pins, grown rows, cells, exact status, clamps, presence scope, DL line, F9/F10 instances, capacity, consecutive weekends, the formula's request-side inputs. |
| `owt_v3/plan.py` | Spec §6.5 (F13): planned shares, set-asides in the plan, F6 in the plan, floor persons (two passes). |
| `owt_v3/instances.py` | Spec §6.7: soft rule instances, `presence_not_applicable`, `broken()` re-evaluation, cause `pins`/`forced`. |
| `owt_v3/report.py` | Spec §8: assignment, unfilled, handshake, violations, cadence, missed causes, notices, fairness lines and tabs (`line_figures`, `tab_figures`). |
| `owt_v3/model.py` | Spec §6.1, §6.6, §7.1: CP-SAT variables, hard rules, violation booleans, the counts the protections read, the received count mirroring `formula.py`, every stage objective. |
| `owt_v3/stages.py` | Spec §7.2–§7.3: the stage runner, settings, limits, statuses, `SolveTimeout`, `SolverDefect`. |
| `owt_v3/solver.py` | Spec §7.1: the pipeline. |
| `owt_v3/service.py` | Raw body → (status, response, log record); public labels; the log line. |
| `main.py` | The HTTP entry `solve` (functions-framework), v2's fail-closed guard, constant-time key compare. |
| `owt_solver_v3.py` | `--json-mode` CLI (C6's local path). |
| `acceptance/{__init__,x1,world,checker,scenarios,run}.py` | The harness: test-only X1, world + chain, independent checker, scenario set P, runner (`--matrix ci|full`, `--emit-requests`). |
| `acceptance/world_realistic.json`, `acceptance/smoke.json` | The fictitious world (17 voices) and the deploy smoke request. |
| `tests/__init__.py`, `tests/builders.py`, `tests/golden_adapter.py`, `tests/test_*.py` | The unit suite (§12.1) and the module driving the acceptance `ci` subset (§12.2). |
| `cloudbuild.yaml` | The v3 build config (§11.3). |

**Replaced C0 scaffold files:** `gcf_v3/owt_v3/__init__.py` (docstring), `gcf_v3/requirements.txt` (+ `functions-framework`), `gcf_v3/.gcloudignore` (+ `tests/`, `acceptance/`, `cloudbuild.yaml`).

**Created elsewhere:** `scripts/deploy-solver-v3-gcf.sh` (first creation / manual deploy); `docs/adr/0049-the-v3-solver-is-a-second-function-solved-in-stages.md`.

**Modified elsewhere:** `fixtures/fairness/golden.json` (C5's `plan` cases appended — Task 13), `docs/SECRETS.md`, `docs/SOLVER_AND_INFRA.md`, `docs/CI.md`, `docs/adr/README.md`; `.github/workflows/ci.yml` and `scripts/__tests__/ciLayout.test.ts` **only if** Task 16 measures the `solver-v3` job above 7m30s.

**Outside the repo (private, never committed):** `owt-agent-logs/sdd/2026-10-05-solver-v3-fairness/c5/convert_world.py` and its outputs (Task 15).

**Deliberately untouched:** `gcf/**`, root `cloudbuild.yaml`, `scripts/deploy-solver-gcf.sh`, `gcf_v3/test_scaffold.py`, `CLAUDE.md`/`AGENTS.md` (C0 already states the `gcf_v3/**` gate; C5 changes no rule there).

---

## Readings this plan makes (each within the spec's text; a reviewer may ask)

1. **Roles a service has** (§5.2, §8.1 «with the roles it has»): a non-fixed `sunday` has Lead, BGV, Choir; a non-fixed `saturday` has Lead, BGV (no Choir key, or 0); a `fixed` service (stored weekend or special) has all three, so a stored Saturday's Chorus pins are accepted (C2 LG-4 maps them to `Sat.Choir`).
2. **Presence at a fixed service** (§6.7): a member *eligible* there makes the rule apply, but a fixed service holds exactly its pins, so if no member is pinned in a matching role the instance is broken with cause `pins` (the stored seats alone break it) — not a `presence_not_applicable` notice, which is kept for services where no member is eligible or pinned.
3. **One forced presence seat, counted once in the plan** (§6.3 «The forced presence seat … split equally among ρ's role keys at s that have a member in Q or a pinned member»): when a member is pinned in one of ρ's role keys (and the seat is not a fixed seat), that pin *is* the forced seat — removed from the pool once, not also as «a pinned seat held by someone not in Pop». At a fixed service no seat can be forced: the sub-line's planned pool is 1 only through such a pin.
4. **`dl_capacity` population** (§6.8 «people whose F10 instance is not already met by `prev_dl_leads`»): a person with an F10 instance in the run's second month, or with one in the first month and `prev_dl_leads == 0`.
5. **Violation cause `pins`** (§8.1 «the pinned seats and the prior constants alone break the instance»): with every unpinned term free (one seat per person per service and the row's room permitting), the instance is still broken — and a pin or a prior constant takes part in it (a pinned term, a candidate blocked by her own pin elsewhere or by a row full of pins, or a fixed service). Otherwise `forced`.
6. **Missed cause `rule`** (§8.1 item 3): a `>=` count rule of hers in that month whose roles include the capped key and whose clamped value is ≥ 2.
7. **`consecutive` instances** (§5.4): a pair of weekends whose terms all come from `prior.services` (both weekends before the horizon) is not an instance — it cannot be changed and would be a permanent `pins` break.
8. **Line appearance** (§8.2): exactly the three conditions (population at a horizon service — planned or realised — carried, received). A set-aside seat alone does not make a line appear. `fairness.lines` lists the stage lines in stage order; a carried-only `P:` key appears in that person's `lines` (after the stage lines) but not in `fairness.lines`.
9. **`floor`** (§8.2): one entry per request month for every person.
10. **`timeout.params.seconds`**: seconds since the budget's start (model build), rounded to milliseconds. **`request_id`** is echoed as `null` when absent.
11. **A stage's `limit`** (§8.1): `none` when proven; otherwise `deterministic` when CP-SAT's deterministic time reached the stage's limit (≥ 0.999 × `stage_det_limit`), else `wall` — under the fixed settings (no solution limit, no other stop criterion) the only other way a stage stops early is the wall guard.
12. **Timing shape C** (§13 «5+5 Sundays»): two consecutive calendar months cannot both have five Sundays, so shape C is the largest real two-month shape — Oct+Nov 2026, 4+5 Sundays, a Saturday every week including the trailing Saturday Oct 31. Shape D pins every seat of shape B's own solution (92 seats — «about 100»).
13. **`unfilled` fallback**: when `fill` is proven no free eligible person can be added without raising the broken count above the ceiling, so the reason is `rules`; `fill_not_proven` is used only when `fill` is not proven.
14. **`STAGE_DET_LIMIT = 0.6`** (OQ-1): the largest deterministic time of any proven stage over the fictitious `full` matrix and the private chain was 113 ms (measured with the limit at 1.0); 5 × 0.113 = 0.565, rounded up to the next 0.05. Task 15 re-measures and confirms.

---

## Task 0: Branch and baseline

**Files:** none.

- [ ] **Step 1: Branch from the current `main`**

```bash
git fetch origin
git switch -c claude/solver-v3-c5-solver-function origin/main
git log -1 --oneline
git worktree prune
```

Expected: the branch points at `origin/main` (`20fd3367` or later). A worktree only if two things must be in flight at once (`CLAUDE.md`): then `EnterWorktree`, `node_modules` by `cp -Rc` from a checkout whose `package-lock.json` matches, and `.env.local` symlinked to the primary's (`ln -s ../../../.env.local .env.local`) — never written inside the worktree. C5 reads no `.env.local`.

- [ ] **Step 2: Record the baseline**

```bash
PY=/opt/homebrew/Caskroom/miniforge/base/envs/owt-roles/bin/python3
"$PY" -c "import ortools; print(ortools.__version__)"
"$PY" -m unittest discover -s gcf_v3 -t gcf_v3 2>&1 | tail -3
"$PY" -m unittest discover -s gcf -t gcf 2>&1 | tail -3
npx tsc --noEmit && npx eslint . 2>&1 | tail -1
git show origin/main:fixtures/fairness/golden.json > /dev/null 2>&1 && echo "C2 fixture: present" || echo "C2 fixture: absent"
```

Expected: `9.15.6755`; `Ran 1 test … OK`; v2 `Ran 105 tests … OK (skipped=1)` (the inertness golden runs on Linux x86_64 only); no `tsc` output; `✖ 81 problems (0 errors, 81 warnings)` on `20fd3367` (if `main` moved, record the new count — it is the ceiling for the whole delivery). The fixture line decides whether Tasks 13–15 can run in this session (Global Constraints).

---

## Task 1: The code registry and the constants

Spec §9 (codes, retired codes), C5-13 (`PIN_CAP = 250` once), §5.1/§5.7/§7.2 constants, §12.1 «Contract» (every emitted code listed; `PIN_CAP` appears exactly once).

**Files:**
- Create: `gcf_v3/owt_v3/codes.json`, `gcf_v3/owt_v3/codes.py`, `gcf_v3/owt_v3/constants.py`, `gcf_v3/tests/__init__.py`, `gcf_v3/tests/test_codes.py`
- Replace: `gcf_v3/owt_v3/__init__.py` (docstring only)

**Interfaces:**
- Consumes: nothing.
- Produces: `owt_v3.codes.GROUPS` (dict group → {code → [param names]}); `code(group: str, name: str) -> str` (raises `AssertionError` on an unlisted code; `balance_max:{line}`/`balance_sq:{line}` match any `balance_max:<line>`); `params_of(group, name) -> list[str]`; `is_listed(group, name) -> bool`; `class Refusal(Exception)` with `.code: str`, `.params: dict` (constructor `Refusal(name, **params)` asserts the params are exactly the registry's); `audit_response(resp: dict) -> list[str]` (problems; empty when clean). `owt_v3.constants`: `CONTRACT = 3`, `ENGINE = "v3"`, `SOLVER_VERSION = "3.0.0"`, `PIN_CAP = 250`, `SCALE = 100`, `MAX_SERVICES = 40`, `MAX_PEOPLE = 100`, `MAX_RULES = 500`, `MAX_SEATS_PER_ROLE = 6`, `CARRIED_ABS_MAX = 10000`, `REQUEST_ID_MAX = 64`, `PERSON_ID_MAX = 64`, `SEED_MAX = 2147483647`, `TOTAL_SECONDS = 25.0`, `STAGE_SECONDS = 2.5`, `STAGE_START_FLOOR = 0.1`, `MIN_TOTAL_SECONDS = 1.0`, `MIN_STAGE_SECONDS = 0.05`, `MIN_STAGE_DET_LIMIT = 0.001`, `STAGE_DET_LIMIT = 0.6`, `FAIRNESS_TOLERANCE = 50` (the spec's ceiling until Task 15 sets the measured value).

- [ ] **Step 1: Write the failing test**

**Create** `gcf_v3/tests/__init__.py` (empty file):

```python

```

**Create** `gcf_v3/tests/test_codes.py`:

```python
"""The code registry (spec §9) and the pin-cap literal (C5-13, U8)."""

import json
import os
import re
import unittest

from owt_v3 import codes
from owt_v3.codes import Refusal, audit_response, code

PKG = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "owt_v3")

RETIRED = ("sat_anchor", "rate_reduced", "alternation_rest", "alternation_broken", "within_slack",
           "carried_clamped", "timeout_no_solution", "mandatory_lead_impossible", "horizon_too_long",
           "degraded", "week_exclusion")


class Registry(unittest.TestCase):
    def test_groups_are_the_spec_groups(self):
        self.assertEqual(sorted(codes.GROUPS), sorted([
            "error", "stage", "stage_status", "stage_reason", "limit", "violation", "violation_rule",
            "violation_cause", "unfilled_reason", "missed", "missed_cause", "notice", "cadence_state",
            "compensation"]))

    def test_every_entry_lists_parameter_names_and_no_copy(self):
        for group, entries in codes.GROUPS.items():
            for name, params in entries.items():
                self.assertIsInstance(params, list, f"{group}/{name}")
                for p in params:
                    self.assertRegex(p, r"^[a-z][a-z0-9_]*$")

    def test_error_codes_and_parameters(self):
        self.assertEqual(codes.GROUPS["error"]["invalid_request"], ["field", "detail"])
        self.assertEqual(codes.GROUPS["error"]["timeout"], ["stage", "seconds"])
        self.assertEqual(codes.GROUPS["error"]["too_many_pins"], ["count", "cap"])
        self.assertEqual(codes.GROUPS["error"]["pin_conflict"], ["person", "service"])

    def test_mandatory_lead_is_the_one_violation_rule_token(self):
        self.assertEqual(list(codes.GROUPS["violation_rule"]), ["mandatory_lead"])

    def test_no_retired_code_is_listed(self):
        names = {n for entries in codes.GROUPS.values() for n in entries}
        for retired in RETIRED:
            self.assertNotIn(retired, names)

    def test_stage_templates_match_line_stages(self):
        self.assertEqual(code("stage", "balance_max:DL"), "balance_max:DL")
        self.assertEqual(code("stage", "balance_sq:P:pr-1"), "balance_sq:P:pr-1")
        with self.assertRaises(AssertionError):
            code("stage", "balance_max:")
        with self.assertRaises(AssertionError):
            code("stage", "fairness")

    def test_refusal_requires_exactly_the_listed_params(self):
        r = Refusal("pin_conflict", person="m-ana", service="s1")
        self.assertEqual((r.code, r.params), ("pin_conflict", {"person": "m-ana", "service": "s1"}))
        with self.assertRaises(AssertionError):
            Refusal("pin_conflict", person="m-ana")
        with self.assertRaises(AssertionError):
            Refusal("no_such_code")

    def test_audit_flags_an_unlisted_code(self):
        resp = {"ok": True, "stages": [{"id": "rules", "status": "proven", "limit": "none"}],
                "violations": [{"code": "week_exclusion", "rule": "x", "cause": "pins"}],
                "unfilled": [], "missed": [], "notices": [], "cadence": []}
        self.assertTrue(audit_response(resp))

    def test_codes_json_is_plain_json(self):
        with open(os.path.join(PKG, "codes.json"), encoding="utf-8") as f:
            self.assertEqual(json.load(f)["contract"], 3)


class PinCap(unittest.TestCase):
    def test_the_literal_appears_exactly_once_in_the_package(self):
        hits = []
        for root, _, files in os.walk(PKG):
            for name in files:
                if name.endswith(".py"):
                    with open(os.path.join(root, name), encoding="utf-8") as f:
                        hits += [name for line in f if re.fullmatch(r"PIN_CAP = 250\n?", line)]
        self.assertEqual(hits, ["constants.py"])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run it to see it fail**

Run: `(cd gcf_v3 && "$PY" -m unittest tests.test_codes)`
Expected: FAIL — `ModuleNotFoundError: No module named 'owt_v3.codes'`.

- [ ] **Step 3: Implement**

**Create** `gcf_v3/owt_v3/codes.json`:

```json
{
  "registry": "owt-solver-v3",
  "contract": 3,
  "note": "Every machine-readable code the function can emit, with its parameter names. No copy: the planner owns the Spanish text (C6's sync test reads this file).",
  "groups": {
    "error": {
      "contract_mismatch": ["received"],
      "invalid_request": ["field", "detail"],
      "unknown_person": ["field", "person"],
      "unknown_service": ["field", "service"],
      "pin_conflict": ["person", "service"],
      "too_many_pins": ["count", "cap"],
      "timeout": ["stage", "seconds"],
      "invalid_json": [],
      "unauthorized": [],
      "method_not_allowed": [],
      "misconfigured": [],
      "internal_error": []
    },
    "stage": {
      "rules": [],
      "fill": [],
      "cadence": [],
      "compensation": [],
      "voice_floor": [],
      "dl_floor": [],
      "sunday_cap": [],
      "saturday_cap": [],
      "no_consecutive": [],
      "balance_max:{line}": ["line"],
      "balance_sq:{line}": ["line"],
      "tiebreak": []
    },
    "stage_status": {
      "proven": [],
      "unproven": [],
      "not_run": []
    },
    "stage_reason": {
      "budget": [],
      "no_solution_in_limit": [],
      "stopped_earlier": []
    },
    "limit": {
      "none": [],
      "deterministic": [],
      "wall": []
    },
    "violation": {
      "mandatory_lead": ["rule", "cause", "service", "month"],
      "count": ["rule", "cause", "person", "month", "observed", "limit"],
      "pair": ["rule", "cause", "persons", "service", "month"],
      "presence": ["rule", "cause", "persons", "service", "month"],
      "consecutive": ["rule", "cause", "person", "weekends"]
    },
    "violation_rule": {
      "mandatory_lead": []
    },
    "violation_cause": {
      "pins": [],
      "forced": []
    },
    "unfilled_reason": {
      "no_possible_lead": [],
      "no_candidate": [],
      "rules": [],
      "fill_not_proven": []
    },
    "missed": {
      "cadence_on_missed": ["person", "month", "cause"],
      "cadence_off_led": ["person", "month", "cause"],
      "compensation_missed": ["person", "month", "cause"],
      "voice_floor_missed": ["person", "month", "cause"],
      "dl_floor_missed": ["person", "month1", "month2", "cause"],
      "sunday_cap_exceeded": ["person", "month", "count", "cause"],
      "saturday_cap_exceeded": ["person", "month", "count", "cause"],
      "consecutive_sundays": ["person", "dates", "cause"]
    },
    "missed_cause": {
      "not_proven": [],
      "pins": [],
      "rule": [],
      "unavailable": [],
      "capacity": [],
      "higher_priority": []
    },
    "notice": {
      "dl_capacity": ["months", "seats", "people"],
      "exact_clamped": ["rule", "person", "month", "value", "available"],
      "min_clamped": ["rule", "person", "month", "value", "available"],
      "presence_not_applicable": ["rule", "service"]
    },
    "cadence_state": {
      "on": [],
      "off": [],
      "out": []
    },
    "compensation": {
      "given": [],
      "missed": [],
      "not_applicable": []
    }
  }
}
```

**Create** `gcf_v3/owt_v3/codes.py`:

```python
"""The code registry (`codes.json`, spec §9) and the one refusal type.

Every code the function emits goes through `code()` or `Refusal`, which raise on a
name the registry does not list, so an unlisted code cannot reach the wire.
`audit_response` re-checks a finished response the same way (tests, checker).
"""

import json
import os

_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "codes.json")
with open(_PATH, encoding="utf-8") as _f:
    REGISTRY = json.load(_f)

GROUPS = REGISTRY["groups"]


def _template_match(group, name):
    """The registry entry `name` falls under: itself, or a `prefix:{line}` template."""
    entries = GROUPS[group]
    if name in entries:
        return name
    for entry in entries:
        if entry.endswith(":{line}") and name.startswith(entry[: -len("{line}")]):
            if len(name) > len(entry) - len("{line}"):
                return entry
    return None


def is_listed(group, name):
    return group in GROUPS and isinstance(name, str) and _template_match(group, name) is not None


def code(group, name):
    """Return `name` after checking the registry lists it under `group`."""
    if not is_listed(group, name):
        raise AssertionError(f"code not in codes.json: {group}/{name}")
    return name


def params_of(group, name):
    return list(GROUPS[group][_template_match(group, name)])


class Refusal(Exception):
    """An `ok: false` answer with a registered `error` code (HTTP 422 unless stated)."""

    def __init__(self, name, **params):
        code("error", name)
        expected = params_of("error", name)
        if sorted(params) != sorted(expected):
            raise AssertionError(f"params of {name} must be {expected}")
        super().__init__(name)
        self.code = name
        self.params = params


def _check(problems, group, name, where):
    if not is_listed(group, name):
        problems.append(f"{where}: {group}/{name!r} not in codes.json")


def _check_fields(problems, group, name, entry, always, where):
    if not is_listed(group, name):
        return
    allowed = set(params_of(group, name)) | set(always)
    for key in entry:
        if key not in allowed:
            problems.append(f"{where}: field {key!r} not listed for {group}/{name}")


def audit_response(resp):
    """Every code and parameter in a response, checked against the registry."""
    problems = []
    if not resp.get("ok"):
        _check(problems, "error", resp.get("code"), "code")
        if is_listed("error", resp.get("code")):
            if sorted(resp.get("params", {})) != sorted(params_of("error", resp["code"])):
                problems.append(f"params of {resp['code']} do not match codes.json")
        return problems
    for i, st in enumerate(resp.get("stages", [])):
        _check(problems, "stage", st.get("id"), f"stages[{i}].id")
        _check(problems, "stage_status", st.get("status"), f"stages[{i}].status")
        _check(problems, "limit", st.get("limit"), f"stages[{i}].limit")
        if "reason" in st:
            _check(problems, "stage_reason", st["reason"], f"stages[{i}].reason")
    for i, v in enumerate(resp.get("violations", [])):
        _check(problems, "violation", v.get("code"), f"violations[{i}].code")
        _check(problems, "violation_cause", v.get("cause"), f"violations[{i}].cause")
        _check_fields(problems, "violation", v.get("code"), v, ("code",), f"violations[{i}]")
        if v.get("code") == "mandatory_lead":
            _check(problems, "violation_rule", v.get("rule"), f"violations[{i}].rule")
    for i, u in enumerate(resp.get("unfilled", [])):
        _check(problems, "unfilled_reason", u.get("reason"), f"unfilled[{i}].reason")
    for i, m in enumerate(resp.get("missed", [])):
        _check(problems, "missed", m.get("code"), f"missed[{i}].code")
        _check(problems, "missed_cause", m.get("cause"), f"missed[{i}].cause")
        _check_fields(problems, "missed", m.get("code"), m, ("code",), f"missed[{i}]")
    for i, n in enumerate(resp.get("notices", [])):
        _check(problems, "notice", n.get("code"), f"notices[{i}].code")
        if is_listed("notice", n.get("code")):
            if sorted(n.get("params", {})) != sorted(params_of("notice", n["code"])):
                problems.append(f"notices[{i}]: params do not match codes.json")
    for i, c in enumerate(resp.get("cadence", [])):
        _check(problems, "cadence_state", c.get("state"), f"cadence[{i}].state")
        _check(problems, "compensation", c.get("compensation"), f"cadence[{i}].compensation")
    return problems
```

**Create** `gcf_v3/owt_v3/constants.py`:

```python
"""Constants of the v3 solver function (spec C5 §5, §7.2, §12.4).

The pin cap's assignment line below is the one literal C6's mirror test reads (spec U8,
C5-13): that line must appear exactly once in this package, spelled exactly as it is.
"""

CONTRACT = 3
ENGINE = "v3"
SOLVER_VERSION = "3.0.0"

PIN_CAP = 250

SCALE = 100  # hundredths of a seat: every fairness figure on the wire

MAX_SERVICES = 40
MAX_PEOPLE = 100
MAX_RULES = 500
MAX_SEATS_PER_ROLE = 6
CARRIED_ABS_MAX = 10000
REQUEST_ID_MAX = 64
PERSON_ID_MAX = 64
SEED_MAX = 2147483647

# Budget (spec §5.7, §7.2). Request knobs clamp DOWN only, into [minimum, default].
TOTAL_SECONDS = 25.0
STAGE_SECONDS = 2.5
STAGE_START_FLOOR = 0.1  # a stage is not started with less budget than this left
MIN_TOTAL_SECONDS = 1.0
MIN_STAGE_SECONDS = 0.05
MIN_STAGE_DET_LIMIT = 0.001

# OQ-1: the smallest value at least 5x the largest deterministic time of any proven
# stage in the `full` acceptance matrix, and at most 1.0 (measured, Task 15).
STAGE_DET_LIMIT = 0.6

# F13 (spec §12.4): the smallest multiple of 5 hundredths at or above the largest
# |planned - share| measured over the `full` matrix (Task 15). Above 50 is a finding.
FAIRNESS_TOLERANCE = 50
```

**Create** `gcf_v3/owt_v3/__init__.py`:

```python
"""The OWT solver v3 package (`owt-solver-v3`; spec
docs/superpowers/specs/2026-10-05-solver-v3-c5-solver-function-design.md).

Imported as `owt_v3`: `gcf_v3/` is the top-level directory of its test job
(`python -m unittest discover -s gcf_v3 -t gcf_v3 -v`). Nothing here may import
the v2 tree (`gcf/`); `scripts/__tests__/ciLayout.test.ts` enforces that, because
the start directory alone does not.

Modules, in dependency order: constants, codes (+ codes.json), vocab, rounding,
request, formula, facts, plan, instances, report, model, stages, solver, service.
"""
```

- [ ] **Step 4: Run the suite and the layout guard**

Run: `"$PY" -m unittest discover -s gcf_v3 -t gcf_v3 2>&1 | tail -3 && npx vitest run scripts/__tests__/ciLayout.test.ts 2>&1 | tail -4`
Expected: `Ran 11 tests … OK`; `Tests  51 passed (51)`.

- [ ] **Step 5: Commit**

```bash
git add gcf_v3/owt_v3/codes.json gcf_v3/owt_v3/codes.py gcf_v3/owt_v3/constants.py gcf_v3/owt_v3/__init__.py gcf_v3/tests/__init__.py gcf_v3/tests/test_codes.py
git commit -m "feat(solver-v3): code registry and constants" -m "Spec C5 §9: codes.json is the single list of every code the function can emit, with parameter names and no copy (C6's sync test reads it); code() and Refusal refuse an unlisted code at emit time and audit_response re-checks a whole response. PIN_CAP = 250 appears once, for C6's textual mirror (U8). STAGE_DET_LIMIT is the measured 0.6 (OQ-1); FAIRNESS_TOLERANCE holds the spec's ceiling of 50 until the F13 gate (Task 15)."
```

---

## Task 2: Vocabulary and rounding

C2 IF2-1 read in request terms (§5.2 «Role key and line of a seat»), D14/A13 day class, §5.2 service ids (`isCanonicalDocumentId`) and `time` (`SERVICE_TIME_RE`, `compareServiceTime`), §6.4 floor-seat order, C5-8/LG-13 rounding.

**Files:**
- Create: `gcf_v3/owt_v3/vocab.py`, `gcf_v3/owt_v3/rounding.py`, `gcf_v3/tests/test_vocab.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `vocab.ROLES = ("Lead","BGV","Choir")`, `ROLE_RANK`, `ROLE_KEYS` (IF2-1 canonical order), `LINE_OF_KEY`, `BASE_LINES`, `TAB_KEYS`, `SERVICE_KINDS`, `RULE_ID_RE`, `SERVICE_TIME_RE`, `DOCUMENT_ID_MAX = 200`; functions `utf16_length(text)`, `is_canonical_document_id(value)`, `parse_date(text) -> date|None`, `is_month(text)`, `weekday(date) -> 0..6`, `is_sunday(date)`, `day_class(date) -> "Sun"|"Sat"`, `role_key(day, role) -> "Sun.Lead"…`, `month_index`, `month_of_index`, `add_months(month, k)`, `add_days(date, k)`, `weekend_of(date)` (the Sunday on or after), `is_service_time`, `time_sort_key(time)`, `seat_order_key(date, role, time, service_id)`. `rounding.hundredths(x)`, `rounding.tenths(x)` — `x` a `Fraction` or int in seats.

- [ ] **Step 1: Write the failing test**

**Create** `gcf_v3/tests/test_vocab.py`:

```python
"""Neutral vocabulary and rounding (C2 IF2-1 in request terms, LG-13, C5-8)."""

import unittest
from fractions import Fraction

from owt_v3.rounding import hundredths, tenths
from owt_v3.vocab import (add_months, day_class, is_canonical_document_id, is_service_time, seat_order_key,
                          time_sort_key, weekend_of)


class Vocabulary(unittest.TestCase):
    def test_day_class_and_weekend(self):
        self.assertEqual(day_class("2026-11-01"), "Sun")  # a Sunday
        self.assertEqual(day_class("2026-11-06"), "Sat")  # a Friday special takes the Sat.* keys
        self.assertEqual(weekend_of("2026-10-31"), "2026-11-01")  # the trailing Saturday's weekend
        self.assertEqual(weekend_of("2026-11-01"), "2026-11-01")

    def test_month_arithmetic(self):
        self.assertEqual(add_months("2026-12", 1), "2027-01")
        self.assertEqual(add_months("2027-01", -1), "2026-12")

    def test_canonical_document_id_mirrors_the_app(self):
        self.assertTrue(is_canonical_document_id("a+b/" + "x" * 196))  # 200 chars, `+` and `/`
        self.assertFalse(is_canonical_document_id("x" * 201))
        self.assertFalse(is_canonical_document_id("has space"))
        self.assertFalse(is_canonical_document_id("nbsp id"))
        self.assertFalse(is_canonical_document_id("bom﻿id"))
        self.assertFalse(is_canonical_document_id("drafts.sundayRole-1"))
        self.assertFalse(is_canonical_document_id(""))
        self.assertFalse(is_canonical_document_id("\U0001F600" * 101))  # 202 UTF-16 code units

    def test_service_time_and_its_order(self):
        self.assertTrue(is_service_time("19:00"))
        self.assertFalse(is_service_time("7:00"))
        self.assertFalse(is_service_time("24:00"))
        keys = sorted([None, "20:00", "19:00"], key=time_sort_key)
        self.assertEqual(keys, ["19:00", "20:00", None])

    def test_floor_seat_order(self):
        a = seat_order_key("2026-11-01", "BGV", "19:00", "z")
        b = seat_order_key("2026-11-01", "Lead", None, "y")
        c = seat_order_key("2026-11-01", "BGV", None, "a")
        self.assertEqual(sorted([a, b, c]), [b, a, c])  # date, then Lead first, then time before none


class Rounding(unittest.TestCase):
    def test_half_away_from_zero(self):
        self.assertEqual(hundredths(Fraction(1, 8)), 13)
        self.assertEqual(hundredths(Fraction(-1, 8)), -13)
        self.assertEqual(tenths(Fraction(65, 100)), 7)
        self.assertEqual(tenths(Fraction(-65, 100)), -7)

    def test_tenths_come_from_the_rational_not_the_hundredths(self):
        x = Fraction(11, 17)  # 0.647…
        self.assertEqual((hundredths(x), tenths(x)), (65, 6))
        self.assertEqual(tenths(Fraction(249, 1000)), 2)  # hundredths 25 would round to 3


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run it to see it fail**

Run: `(cd gcf_v3 && "$PY" -m unittest tests.test_vocab)`
Expected: FAIL — `ModuleNotFoundError: No module named 'owt_v3.rounding'`.

- [ ] **Step 3: Implement**

**Create** `gcf_v3/owt_v3/vocab.py`:

```python
"""Neutral vocabulary (C2 IF2-1 read in request terms, spec §5.2) and pure helpers.

Nothing here reads the clock or a time zone: dates are `YYYY-MM-DD` strings on the
CDMX calendar and every weekday comes from `datetime.date`, a civil calendar.
"""

import datetime
import re

ROLES = ("Lead", "BGV", "Choir")  # the seat-order rule: Lead > BGV > Choir
ROLE_RANK = {"Lead": 0, "BGV": 1, "Choir": 2}

# IF2-1's RoleKey, in its canonical order.
ROLE_KEYS = ("Sun.Lead", "Sat.Lead", "Sun.BGV", "Sat.BGV", "Sun.Choir", "Sat.Choir")
LINE_OF_KEY = {
    "Sun.Lead": "DL", "Sat.Lead": "SL",
    "Sun.BGV": "BGV", "Sat.BGV": "BGV",
    "Sun.Choir": "CORO", "Sat.Choir": "CORO",
}
BASE_LINES = ("DL", "SL", "BGV", "CORO")
TAB_KEYS = ("DL", "SL", "BGV", "CORO", "TOTAL")
SERVICE_KINDS = ("sunday", "saturday", "special")

MONTH_RE = re.compile(r"^(\d{4})-(0[1-9]|1[0-2])$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
# app/utils/serviceTime.ts SERVICE_TIME_RE — keep the two identical.
SERVICE_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
RULE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

# JavaScript's `\s` (ECMAScript WhiteSpace + LineTerminator), spelled out so the
# service-id check matches app/utils/roleWriteRequest.ts isCanonicalDocumentId exactly.
_JS_WHITESPACE = re.compile(
    "[\t\n\u000b\u000c\r    -     　﻿]"
)
DOCUMENT_ID_MAX = 200


def utf16_length(text):
    """String length as JavaScript counts it (UTF-16 code units)."""
    return len(text.encode("utf-16-le")) // 2


def is_canonical_document_id(value):
    """app/utils/roleWriteRequest.ts isCanonicalDocumentId, mirrored."""
    return (
        isinstance(value, str)
        and len(value) > 0
        and utf16_length(value) <= DOCUMENT_ID_MAX
        and _JS_WHITESPACE.search(value) is None
        and not value.startswith("drafts.")
    )


def parse_date(text):
    """A `datetime.date` for a valid `YYYY-MM-DD`, else None."""
    if not isinstance(text, str) or not DATE_RE.match(text):
        return None
    try:
        return datetime.date(int(text[0:4]), int(text[5:7]), int(text[8:10]))
    except ValueError:
        return None


def is_month(text):
    return isinstance(text, str) and MONTH_RE.match(text) is not None


def weekday(date_text):
    """0 = Monday … 6 = Sunday."""
    return parse_date(date_text).weekday()


def is_sunday(date_text):
    return weekday(date_text) == 6


def day_class(date_text):
    """D14/A13: a Sunday-dated service takes the `Sun.*` keys, any other day `Sat.*`."""
    return "Sun" if is_sunday(date_text) else "Sat"


def role_key(day, role):
    return f"{day}.{role}"


def month_index(month):
    return int(month[0:4]) * 12 + int(month[5:7]) - 1


def month_of_index(index):
    return f"{index // 12:04d}-{index % 12 + 1:02d}"


def add_months(month, k):
    return month_of_index(month_index(month) + k)


def add_days(date_text, k):
    return (parse_date(date_text) + datetime.timedelta(days=k)).isoformat()


def weekend_of(date_text):
    """The Sunday on or after a date (spec §5.4 `consecutive`)."""
    d = parse_date(date_text)
    return (d + datetime.timedelta(days=(6 - d.weekday()) % 7)).isoformat()


def is_service_time(value):
    return isinstance(value, str) and SERVICE_TIME_RE.match(value) is not None


def time_sort_key(value):
    """compareServiceTime (app/utils/serviceTime.ts): present times ascending, absent last."""
    return (0, value) if is_service_time(value) else (1, "")


def seat_order_key(date, role, time, service_id):
    """The floor seat's order (spec §6.4): date, Lead > BGV > Choir, time, service id."""
    return (date, ROLE_RANK[role], time_sort_key(time), service_id)
```

**Create** `gcf_v3/owt_v3/rounding.py`:

```python
"""Rounding, once, half away from zero (C2 LG-13; spec C5-8).

Every input is an exact `Fraction` (or an int) in SEATS. Hundredths and tenths are
each rounded from that exact value — never tenths from hundredths.
"""

import math
from fractions import Fraction


def _round_half_away(x, scale):
    x = Fraction(x)
    magnitude = math.floor(abs(x) * scale + Fraction(1, 2))
    return -magnitude if x < 0 else magnitude


def hundredths(x):
    """sign(x) * floor(|x| * 100 + 1/2)."""
    return _round_half_away(x, 100)


def tenths(x):
    """sign(x) * floor(|x| * 10 + 1/2)."""
    return _round_half_away(x, 10)
```

- [ ] **Step 4: Run the suite and the layout guard**

Run: `"$PY" -m unittest discover -s gcf_v3 -t gcf_v3 2>&1 | tail -3 && npx vitest run scripts/__tests__/ciLayout.test.ts 2>&1 | tail -4`
Expected: `Ran 18 tests … OK`; `Tests  51 passed (51)`.

- [ ] **Step 5: Commit**

```bash
git add gcf_v3/owt_v3/vocab.py gcf_v3/owt_v3/rounding.py gcf_v3/tests/test_vocab.py
git commit -m "feat(solver-v3): request-side vocabulary and once-only rounding" -m "IF2-1's role keys and lines read in request terms (a Sunday-dated service takes Sun.*, any other day Sat.*), the app's isCanonicalDocumentId and compareServiceTime mirrored (JavaScript's \\s and UTF-16 length spelled out so the two agree), and hundredths/tenths rounded once, half away from zero, from the exact rational (LG-13, C5-8)."
```

---

## Task 3: The request contract

Spec §5.1–§5.8, C5-1, C5-2, C5-4, C5-5, C5-13, C5-16, A11, A38; §12.1 «Contract» (every refusal with its code; service-id grammar; `contract_mismatch`; the reserved `mandatory_lead` id).

**Files:**
- Create: `gcf_v3/owt_v3/request.py`, `gcf_v3/tests/test_request.py`

**Interfaces:**
- Consumes: `owt_v3.constants` (Task 1), `owt_v3.codes.Refusal` (Task 1), `owt_v3.vocab` (Task 2).
- Produces: `parse_request(body) -> Problem | None` (None for a ping; raises `Refusal`); `is_ping(body) -> bool`. Frozen dataclasses `Service(id, date, month, kind, time, fixed, counts, seats: dict, roles: tuple, day)` with `.weekend` and `.key(role)`; `Person(id, name, exempt, eligibility: {sid: frozenset}, carried: dict, cadence: dict|None, dl_since, prev_dl_leads)`; `CountRule(id, person, roles, op, month, value, index)`; `PairRule(id, persons, roles, month, index)`; `PresenceRule(id, persons, roles, exclusive, month, index)`; `ConsecutiveRule(id, person, roles, index)`; `Pin(service, date, role, person)`; `PriorService(date, kind, counts, seats, day)`; `Prior(month, has_services, services)`; `Budget(total_seconds, stage_seconds, stage_det_limit)`; `Problem(request_id, seed, months, services, people, counts, pairs, presence, consecutive, presence_ids, pins, prior, budget, service_by_id, person_ids)` with `.lines` (stage order: DL, SL, BGV, each `P:<id>` by first appearance, CORO). Services are in canonical order (date, time — absent last — id); pins deduplicated and sorted.

- [ ] **Step 1: Write the failing test**

**Create** `gcf_v3/tests/test_request.py`:

```python
"""The request contract v3 (spec §5, §5.8): every refusal is `ok: false` with a code, before
any solve; the spec's own example is accepted."""

import copy
import unittest

from owt_v3.codes import Refusal
from owt_v3.request import parse_request

EXAMPLE = {
    "contract": 3, "request_id": "r-7f3a", "seed": 418207, "months": ["2026-11"],
    "services": [
        {"id": "p-2026-11-01-sun", "date": "2026-11-01", "month": "2026-11", "kind": "sunday",
         "fixed": False, "counts": True, "seats": {"Lead": 2, "BGV": 3, "Choir": 3}},
        {"id": "p-2026-11-07-sat", "date": "2026-11-07", "month": "2026-11", "kind": "saturday",
         "fixed": False, "counts": True, "seats": {"Lead": 2, "BGV": 3}},
        {"id": "sundayRole-8f2c", "date": "2026-11-08", "month": "2026-11", "kind": "sunday",
         "fixed": True, "counts": True}],
    "people": [
        {"id": "m-ana", "name": "Ana", "exempt": False, "dl_since": "2026-05", "prev_dl_leads": 0,
         "eligibility": {"p-2026-11-01-sun": ["Lead", "BGV", "Choir"], "p-2026-11-07-sat": ["Lead"]},
         "carried": {"DL": 45, "CORO": -120}},
        {"id": "m-carla", "name": "Carla", "exempt": False, "dl_since": "2026-05", "prev_dl_leads": 1,
         "cadence": {"2026-11": "off"},
         "eligibility": {"p-2026-11-01-sun": ["Lead", "Choir"], "p-2026-11-07-sat": ["Lead"]},
         "carried": {"SL": 30}},
        {"id": "m-bruno", "name": "Bruno", "dl_since": "2026-05", "prev_dl_leads": 1,
         "eligibility": {"p-2026-11-01-sun": ["Lead"]}, "carried": {}},
        {"id": "m-dani", "name": "Dani", "dl_since": None, "prev_dl_leads": 0,
         "eligibility": {"p-2026-11-01-sun": ["BGV"]}, "carried": {"P:pr-1": 50}},
        {"id": "m-eli", "name": "Eli", "dl_since": None, "prev_dl_leads": 0,
         "eligibility": {"p-2026-11-01-sun": ["BGV"]}, "carried": {}}],
    "rules": [
        {"id": "cap-b1", "kind": "count", "person": "m-bruno", "roles": ["Sun.Lead"], "op": "==",
         "month": "2026-11", "value": 2},
        {"id": "pr-1", "kind": "presence", "persons": ["m-dani", "m-eli"], "roles": ["Sun.BGV"], "exclusive": True},
        {"id": "cf-3", "kind": "pair", "persons": ["m-dani", "m-eli"], "roles": ["Sun.BGV", "Sat.BGV"]}],
    "pins": [{"service": "sundayRole-8f2c", "date": "2026-11-08", "role": "Lead", "person": "m-bruno"}],
    "prior": {"month": "2026-10", "has_services": True,
              "services": [{"date": "2026-10-25", "kind": "sunday", "counts": True,
                            "seats": {"Lead": ["m-ana", "m-bruno"], "BGV": [], "Choir": []}}]},
}


def refused(body):
    try:
        parse_request(body)
    except Refusal as r:
        return r.code, r.params
    return None


class TheExample(unittest.TestCase):
    def test_is_accepted(self):
        problem = parse_request(copy.deepcopy(EXAMPLE))
        self.assertEqual(problem.months, ("2026-11",))
        self.assertEqual([s.id for s in problem.services],
                         ["p-2026-11-01-sun", "p-2026-11-07-sat", "sundayRole-8f2c"])
        self.assertEqual(problem.presence_ids, ("pr-1",))
        self.assertEqual(problem.lines, ("DL", "SL", "BGV", "P:pr-1", "CORO"))
        self.assertEqual(problem.services[2].roles, ("Lead", "BGV", "Choir"))  # a fixed service has all three
        self.assertEqual(problem.services[1].roles, ("Lead", "BGV"))  # a board Saturday has no Choir

    def test_the_ping_skips_validation(self):
        self.assertIsNone(parse_request({"contract": 3, "ping": True, "anything": "ignored"}))


class Refusals(unittest.TestCase):
    def mutate(self, fn):
        body = copy.deepcopy(EXAMPLE)
        fn(body)
        return refused(body)

    def assertInvalid(self, fn, field=None, detail=None):
        got = self.mutate(fn)
        self.assertIsNotNone(got, "accepted")
        self.assertEqual(got[0], "invalid_request", got)
        if field is not None:
            self.assertEqual(got[1]["field"], field)
        if detail is not None:
            self.assertEqual(got[1]["detail"], detail)

    def test_contract_mismatch(self):
        self.assertEqual(self.mutate(lambda b: b.update(contract=2)), ("contract_mismatch", {"received": 2}))
        self.assertEqual(self.mutate(lambda b: b.pop("contract")), ("contract_mismatch", {"received": None}))
        self.assertEqual(self.mutate(lambda b: b.update(contract=3.0))[0], "contract_mismatch")

    def test_unknown_keys_at_every_level(self):
        self.assertInvalid(lambda b: b.update(extra=1), "extra", "unknown_key")
        self.assertInvalid(lambda b: b["services"][0].update(color="x"), "services[0].color", "unknown_key")
        self.assertInvalid(lambda b: b["services"][0]["seats"].update(Drums=1), "services[0].seats.Drums")
        self.assertInvalid(lambda b: b["people"][0].update(nickname="x"), "people[0].nickname")
        self.assertInvalid(lambda b: b["rules"][0].update(relative=True), "rules[0].relative")
        self.assertInvalid(lambda b: b["pins"][0].update(origin="auto"), "pins[0].origin")
        self.assertInvalid(lambda b: b["prior"].update(extra=1), "prior.extra")
        self.assertInvalid(lambda b: b.update(budget={"workers": 8}), "budget.workers")

    def test_shapes_and_ranges(self):
        self.assertInvalid(lambda b: b.update(seed=-1), "seed")
        self.assertInvalid(lambda b: b.update(seed=1.5), "seed", "integer")
        self.assertInvalid(lambda b: b.update(months=["2026-11", "2027-01"]), "months", "not_consecutive")
        self.assertInvalid(lambda b: b.update(months=["2026-13"]), "months[0]", "format")
        self.assertInvalid(lambda b: b.update(months=["2026-11", "2026-12", "2027-01"]), "months", "range")
        self.assertInvalid(lambda b: b.update(request_id="x" * 65), "request_id", "range")
        self.assertInvalid(lambda b: b["services"][0]["seats"].update(Lead=7), "services[0].seats.Lead", "range")
        self.assertInvalid(lambda b: b["people"][0]["carried"].update(DL=10001), "people[0].carried", "range")
        self.assertInvalid(lambda b: b["people"][0]["carried"].update(XL=1), "people[0].carried", "unknown_key")
        self.assertInvalid(lambda b: b["people"][0].update(prev_dl_leads=-1), "people[0].prev_dl_leads")

    def test_service_ids_follow_the_canonical_document_id(self):
        def rename(b, new):
            b["services"][2]["id"] = new
            b["pins"][0]["service"] = new
        body = copy.deepcopy(EXAMPLE)
        rename(body, "a+b/" + "x" * 196)  # 200 characters outside [A-Za-z0-9:._-]: accepted verbatim
        self.assertEqual(parse_request(body).services[2].id, "a+b/" + "x" * 196)
        for bad in ("x" * 201, "with space", "drafts.sundayRole-8f2c"):
            self.assertInvalid(lambda b, bad=bad: rename(b, bad), "services[2].id", "format")

    def test_dates_months_kinds(self):
        self.assertInvalid(lambda b: b["services"][0].update(date="2026-12-06", month="2026-12"),
                           "services[0].date", "not_in_months")
        self.assertInvalid(lambda b: b["services"][0].update(month="2026-12"), "services[0].month", "month_mismatch")
        self.assertInvalid(lambda b: b["services"][0].update(date="2026-11-02"), "services[0].kind", "weekday")
        self.assertInvalid(lambda b: b["services"][1].update(date="2026-11-08"), "services[1].kind", "weekday")
        self.assertInvalid(lambda b: b["services"][2].update(date="2026-11-01"), "services[2].kind", "one_per_date")
        self.assertInvalid(lambda b: b["services"][0].update(time="7:00"), "services[0].time", "format")
        self.assertInvalid(lambda b: b["services"][1]["seats"].update(Choir=1), "services[1].seats.Choir",
                           "saturday_choir")

    def test_specials_must_be_fixed_and_counted(self):
        special = {"id": "sp-1", "date": "2026-11-13", "month": "2026-11", "kind": "special",
                   "fixed": False, "counts": True, "seats": {"Lead": 1, "BGV": 1, "Choir": 0}}
        self.assertInvalid(lambda b: b["services"].append(special), "services[3].fixed", "special_fixed")
        uncounted = dict(special, fixed=True, counts=False)
        self.assertInvalid(lambda b: b["services"].append(uncounted), "services[3].counts", "special_counted")

    def test_id_resolution(self):
        self.assertEqual(self.mutate(lambda b: b["rules"][0].update(person="m-zoe")),
                         ("unknown_person", {"field": "rules[0].person", "person": "m-zoe"}))
        self.assertEqual(self.mutate(lambda b: b["pins"][0].update(service="nope")),
                         ("unknown_service", {"field": "pins[0].service", "service": "nope"}))
        self.assertEqual(self.mutate(lambda b: b["people"][0]["eligibility"].update(nope=["Lead"]))[0],
                         "unknown_service")

    def test_duplicates_and_scoping(self):
        self.assertInvalid(lambda b: b["services"].append(dict(b["services"][0])), "services[3].id", "duplicate")
        self.assertInvalid(lambda b: b["rules"].append(dict(b["rules"][0])), "rules[3].id", "duplicate")
        self.assertInvalid(lambda b: b["rules"].append(dict(b["rules"][2], month="2026-11")), "rules[3].id",
                           "scope_mixed")

    def test_prior_month_and_window(self):
        self.assertInvalid(lambda b: b["prior"].update(month="2026-09"), "prior.month", "prior_month")
        self.assertInvalid(lambda b: b["prior"]["services"][0].update(date="2026-10-11"),
                           "prior.services[0].date", "prior_window")

    def test_cadence_covers_every_month_and_never_meets_an_exact_lead(self):
        self.assertInvalid(lambda b: b["people"][1].update(cadence={}), "people[1].cadence", "cadence_months")
        self.assertInvalid(lambda b: b["rules"].append({"id": "cap-c", "kind": "count", "person": "m-carla",
                                                        "roles": ["Sun.Lead"], "op": "==", "month": "2026-11",
                                                        "value": 1}),
                           "people[1].cadence", "cadence_exact_lead")

    def test_two_exact_counts_over_one_role_key_A38(self):
        second = {"id": "cap-b0", "kind": "count", "person": "m-bruno", "roles": ["Sun.Lead", "Sun.BGV"],
                  "op": "==", "month": "2026-11", "value": 1}
        # ids in codepoint order: "cap-b0" < "cap-b1", so the SECOND is cap-b1, rules[0]
        self.assertInvalid(lambda b: b["rules"].append(second), "rules[0]", "exact_overlap")

    def test_pins(self):
        self.assertEqual(self.mutate(lambda b: b["pins"].append(
            {"service": "sundayRole-8f2c", "date": "2026-11-08", "role": "BGV", "person": "m-bruno"})),
            ("pin_conflict", {"person": "m-bruno", "service": "sundayRole-8f2c"}))
        self.assertEqual(self.mutate(lambda b: b.update(pins=[b["pins"][0]] * 251)),
                         ("too_many_pins", {"count": 251, "cap": 250}))
        self.assertInvalid(lambda b: b["pins"][0].update(date="2026-11-01"), "pins[0].date", "date_mismatch")
        self.assertInvalid(lambda b: b["pins"].append(
            {"service": "p-2026-11-07-sat", "date": "2026-11-07", "role": "Choir", "person": "m-ana"}),
            "pins[1].role", "role_not_in_service")

    def test_exact_duplicate_pins_collapse(self):
        body = copy.deepcopy(EXAMPLE)
        body["pins"] = body["pins"] * 3
        self.assertEqual(len(parse_request(body).pins), 1)

    def test_negative_or_non_integer_values(self):
        self.assertInvalid(lambda b: b["rules"][0].update(value=-1), "rules[0].value", "range")
        self.assertInvalid(lambda b: b["rules"][0].update(value=1.5), "rules[0].value", "integer")

    def test_the_reserved_rule_id(self):
        self.assertInvalid(lambda b: b["rules"][2].update(id="mandatory_lead"), "rules[2].id", "reserved")

    def test_budget_clamps_down_only(self):
        body = copy.deepcopy(EXAMPLE)
        body["budget"] = {"total_seconds": 999, "stage_seconds": 0.0001, "stage_det_limit": 50}
        b = parse_request(body).budget
        self.assertEqual((b.total_seconds, b.stage_seconds), (25.0, 0.05))
        from owt_v3.constants import STAGE_DET_LIMIT
        self.assertEqual(b.stage_det_limit, STAGE_DET_LIMIT)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run it to see it fail**

Run: `(cd gcf_v3 && "$PY" -m unittest tests.test_request)`
Expected: FAIL — `ModuleNotFoundError: No module named 'owt_v3.request'`.

- [ ] **Step 3: Implement**

**Create** `gcf_v3/owt_v3/request.py`:

```python
"""The request contract v3 (spec §5): parse and validate before any solve.

`parse_request(body)` returns a `Problem` or raises `Refusal` (HTTP 422). It never
compares a month with today (C6 refuses past months, A24) and never logs.
Every list it returns is in a canonical, sorted order (spec §10).
"""

import math
from dataclasses import dataclass, field
from typing import Dict, FrozenSet, Optional, Tuple

from . import constants as C
from .codes import Refusal
from .vocab import (
    ROLES, ROLE_KEYS, RULE_ID_RE, SERVICE_KINDS, add_days, add_months, day_class,
    is_canonical_document_id, is_month, is_service_time, month_index, parse_date,
    role_key, time_sort_key, weekday,
)

RESERVED_RULE_ID = "mandatory_lead"
CARRIED_BASE_KEYS = ("DL", "SL", "BGV", "CORO")
CADENCE_STATES = ("on", "off", "out")
COUNT_OPS = ("==", "<=", ">=")


@dataclass(frozen=True)
class Service:
    id: str
    date: str
    month: str
    kind: str
    time: Optional[str]
    fixed: bool
    counts: bool
    seats: Dict[str, int]  # non-fixed only; {} for a fixed service
    roles: Tuple[str, ...]
    day: str  # "Sun" | "Sat" (day class)

    @property
    def weekend(self):
        return self.kind != "special"

    def key(self, role):
        return role_key(self.day, role)


@dataclass(frozen=True)
class Person:
    id: str
    name: str
    exempt: bool
    eligibility: Dict[str, FrozenSet[str]]
    carried: Dict[str, int]
    cadence: Optional[Dict[str, str]]
    dl_since: Optional[str]
    prev_dl_leads: int


@dataclass(frozen=True)
class CountRule:
    id: str
    person: str
    roles: Tuple[str, ...]
    op: str
    month: str
    value: int
    index: int


@dataclass(frozen=True)
class PairRule:
    id: str
    persons: Tuple[str, str]
    roles: Tuple[str, ...]
    month: Optional[str]
    index: int


@dataclass(frozen=True)
class PresenceRule:
    id: str
    persons: Tuple[str, ...]
    roles: Tuple[str, ...]
    exclusive: bool
    month: Optional[str]
    index: int


@dataclass(frozen=True)
class ConsecutiveRule:
    id: str
    person: str
    roles: Tuple[str, ...]
    index: int


@dataclass(frozen=True)
class Pin:
    service: str
    date: str
    role: str
    person: str


@dataclass(frozen=True)
class PriorService:
    date: str
    kind: str
    counts: bool
    seats: Dict[str, Tuple[str, ...]]
    day: str


@dataclass(frozen=True)
class Prior:
    month: str
    has_services: bool
    services: Tuple[PriorService, ...]


@dataclass(frozen=True)
class Budget:
    total_seconds: float
    stage_seconds: float
    stage_det_limit: float


@dataclass
class Problem:
    request_id: Optional[str]
    seed: int
    months: Tuple[str, ...]
    services: Tuple[Service, ...]
    people: Dict[str, Person]
    counts: Tuple[CountRule, ...]
    pairs: Tuple[PairRule, ...]
    presence: Tuple[PresenceRule, ...]
    consecutive: Tuple[ConsecutiveRule, ...]
    presence_ids: Tuple[str, ...]  # distinct presence ids, by first appearance in `rules`
    pins: Tuple[Pin, ...]
    prior: Prior
    budget: Budget
    service_by_id: Dict[str, Service] = field(default_factory=dict)
    person_ids: Tuple[str, ...] = ()

    @property
    def lines(self):
        """Every stage line, in stage order (spec §7.1)."""
        return ("DL", "SL", "BGV") + tuple(f"P:{i}" for i in self.presence_ids) + ("CORO",)


# ── small validators ─────────────────────────────────────────────────────────


def _fail(field_path, detail):
    raise Refusal("invalid_request", field=field_path, detail=detail)


def _is_int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def _is_number(v):
    return (isinstance(v, (int, float)) and not isinstance(v, bool)) and math.isfinite(v)


def _object(value, path, required, optional=()):
    if not isinstance(value, dict):
        _fail(path, "type")
    for key in value:
        if key not in required and key not in optional:
            _fail(f"{path}.{key}" if path else key, "unknown_key")
    for key in required:
        if key not in value:
            _fail(f"{path}.{key}" if path else key, "missing")
    return value


def _list(value, path, lo, hi):
    if not isinstance(value, list):
        _fail(path, "type")
    if not lo <= len(value) <= hi:
        _fail(path, "range")
    return value


def _string(value, path, lo, hi):
    if not isinstance(value, str):
        _fail(path, "type")
    if not lo <= len(value) <= hi:
        _fail(path, "range")
    return value


def _bool(value, path):
    if not isinstance(value, bool):
        _fail(path, "type")
    return value


def _int(value, path, lo, hi=None):
    if not _is_int(value):
        _fail(path, "integer")
    if value < lo or (hi is not None and value > hi):
        _fail(path, "range")
    return value


def _month(value, path):
    if not is_month(value):
        _fail(path, "format")
    return value


def _role_keys(value, path):
    _list(value, path, 1, len(ROLE_KEYS))
    seen = []
    for i, k in enumerate(value):
        if k not in ROLE_KEYS:
            _fail(f"{path}[{i}]", "format")
        if k in seen:
            _fail(f"{path}[{i}]", "duplicate")
        seen.append(k)
    return tuple(sorted(seen, key=ROLE_KEYS.index))


# ── the parser ───────────────────────────────────────────────────────────────

TOP_KEYS = ("contract", "ping", "request_id", "seed", "months", "services", "people", "rules",
            "pins", "prior", "budget")


def is_ping(body):
    """Contract 3 and `ping` present: answer §8.4 and ignore every other field."""
    contract = body.get("contract") if isinstance(body, dict) else None
    return _is_int(contract) and contract == C.CONTRACT and "ping" in body


def parse_request(body):
    if not isinstance(body, dict):
        _fail("(root)", "type")
    contract = body.get("contract")
    if not (_is_int(contract) and contract == C.CONTRACT):
        raise Refusal("contract_mismatch", received=contract)
    if "ping" in body:
        if body["ping"] is not True:
            _fail("ping", "type")
        return None
    _object(body, "", ("contract", "seed", "months", "services", "people", "rules", "pins", "prior"),
            ("request_id", "budget"))
    request_id = None
    if "request_id" in body:
        request_id = _string(body["request_id"], "request_id", 1, C.REQUEST_ID_MAX)
    seed = _int(body["seed"], "seed", 0, C.SEED_MAX)
    months = _parse_months(body["months"])
    services = _parse_services(body["services"], months)
    by_id = {s.id: s for s in services}
    people = _parse_people(body["people"], months, by_id)
    counts, pairs, presence, consecutive, presence_ids = _parse_rules(body["rules"], months, people)
    _cross_checks(body, people, counts)
    pins = _parse_pins(body["pins"], by_id, people)
    prior = _parse_prior(body["prior"], months)
    budget = _parse_budget(body.get("budget"))
    ordered = tuple(sorted(services, key=lambda s: (s.date, time_sort_key(s.time), s.id)))
    return Problem(
        request_id=request_id, seed=seed, months=months, services=ordered, people=people,
        counts=counts, pairs=pairs, presence=presence, consecutive=consecutive,
        presence_ids=presence_ids, pins=pins, prior=prior, budget=budget,
        service_by_id=by_id, person_ids=tuple(sorted(people)),
    )


def _parse_months(value):
    _list(value, "months", 1, 2)
    for i, m in enumerate(value):
        _month(m, f"months[{i}]")
    if len(value) == 2 and month_index(value[1]) != month_index(value[0]) + 1:
        _fail("months", "not_consecutive")
    return tuple(value)


def _parse_services(value, months):
    _list(value, "services", 1, C.MAX_SERVICES)
    out, ids, per_date_kind = [], set(), set()
    for i, raw in enumerate(value):
        p = f"services[{i}]"
        _object(raw, p, ("id", "date", "month", "kind", "fixed", "counts"), ("time", "seats"))
        sid = raw["id"]
        if not is_canonical_document_id(sid):
            _fail(f"{p}.id", "format")
        if sid in ids:
            _fail(f"{p}.id", "duplicate")
        ids.add(sid)
        date = raw["date"]
        if parse_date(date) is None:
            _fail(f"{p}.date", "format")
        if date[:7] not in months:
            _fail(f"{p}.date", "not_in_months")
        _month(raw["month"], f"{p}.month")
        if raw["month"] != date[:7]:
            _fail(f"{p}.month", "month_mismatch")
        kind = raw["kind"]
        if kind not in SERVICE_KINDS:
            _fail(f"{p}.kind", "format")
        if kind == "sunday" and weekday(date) != 6:
            _fail(f"{p}.kind", "weekday")
        if kind == "saturday" and weekday(date) != 5:
            _fail(f"{p}.kind", "weekday")
        if kind != "special":
            if (date, kind) in per_date_kind:
                _fail(f"{p}.kind", "one_per_date")
            per_date_kind.add((date, kind))
        time = raw.get("time")
        if "time" in raw and not is_service_time(time):
            _fail(f"{p}.time", "format")
        fixed = _bool(raw["fixed"], f"{p}.fixed")
        counts = _bool(raw["counts"], f"{p}.counts")
        if kind == "special" and not fixed:
            _fail(f"{p}.fixed", "special_fixed")
        if kind == "special" and not counts:
            _fail(f"{p}.counts", "special_counted")
        seats = {}
        if "seats" in raw:
            seats = _parse_seats(raw["seats"], f"{p}.seats", kind, fixed)
        elif not fixed:
            _fail(f"{p}.seats", "missing")
        if fixed:
            roles, seats = ROLES, {}
        elif kind == "saturday":
            roles = ("Lead", "BGV")
            seats.pop("Choir", None)
        else:
            roles = ROLES
        out.append(Service(id=sid, date=date, month=raw["month"], kind=kind,
                           time=time if "time" in raw else None, fixed=fixed, counts=counts,
                           seats=seats, roles=roles, day=day_class(date)))
    return out


def _parse_seats(raw, p, kind, fixed):
    _object(raw, p, (), ROLES)
    seats = {}
    for role in ROLES:
        if role in raw:
            seats[role] = _int(raw[role], f"{p}.{role}", 0, C.MAX_SEATS_PER_ROLE)
    if not fixed:
        need = ("Lead", "BGV") if kind == "saturday" else ROLES
        for role in need:
            if role not in seats:
                _fail(f"{p}.{role}", "missing")
        if kind == "saturday" and seats.get("Choir", 0) != 0:
            _fail(f"{p}.Choir", "saturday_choir")
    return seats


def _parse_people(value, months, by_id):
    _list(value, "people", 1, C.MAX_PEOPLE)
    people = {}
    for i, raw in enumerate(value):
        p = f"people[{i}]"
        _object(raw, p, ("id", "name", "eligibility", "carried", "dl_since", "prev_dl_leads"),
                ("exempt", "cadence"))
        pid = _string(raw["id"], f"{p}.id", 1, C.PERSON_ID_MAX)
        if pid in people:
            _fail(f"{p}.id", "duplicate")
        if not isinstance(raw["name"], str):
            _fail(f"{p}.name", "type")
        exempt = _bool(raw["exempt"], f"{p}.exempt") if "exempt" in raw else False
        elig_raw = raw["eligibility"]
        if not isinstance(elig_raw, dict):
            _fail(f"{p}.eligibility", "type")
        eligibility = {}
        for sid, roles in elig_raw.items():
            if sid not in by_id:
                raise Refusal("unknown_service", field=f"{p}.eligibility", service=sid)
            ep = f'{p}.eligibility["{sid}"]'
            _list(roles, ep, 0, len(ROLES))
            seen = set()
            for j, role in enumerate(roles):
                if role not in ROLES:
                    _fail(f"{ep}[{j}]", "format")
                if role in seen:
                    _fail(f"{ep}[{j}]", "duplicate")
                seen.add(role)
            eligibility[sid] = frozenset(seen)
        carried_raw = raw["carried"]
        if not isinstance(carried_raw, dict):
            _fail(f"{p}.carried", "type")
        carried = {}
        for key, v in carried_raw.items():
            ok = key in CARRIED_BASE_KEYS or (
                isinstance(key, str) and key.startswith("P:") and RULE_ID_RE.match(key[2:]))
            if not ok:
                _fail(f"{p}.carried", "unknown_key")
            if not _is_int(v):
                _fail(f"{p}.carried", "integer")
            if abs(v) > C.CARRIED_ABS_MAX:
                _fail(f"{p}.carried", "range")
            carried[key] = v
        cadence = None
        if "cadence" in raw:
            cad = raw["cadence"]
            if not isinstance(cad, dict) or sorted(cad) != sorted(months):
                _fail(f"{p}.cadence", "cadence_months")
            for m, state in cad.items():
                if state not in CADENCE_STATES:
                    _fail(f"{p}.cadence", "format")
            cadence = dict(cad)
        dl_since = raw["dl_since"]
        if dl_since is not None:
            _month(dl_since, f"{p}.dl_since")
        prev = _int(raw["prev_dl_leads"], f"{p}.prev_dl_leads", 0)
        people[pid] = Person(id=pid, name=raw["name"], exempt=exempt, eligibility=eligibility,
                             carried=carried, cadence=cadence, dl_since=dl_since,
                             prev_dl_leads=prev)
    return people


def _person(value, path, people):
    if not isinstance(value, str):
        _fail(path, "type")
    if value not in people:
        raise Refusal("unknown_person", field=path, person=value)
    return value


def _parse_rules(value, months, people):
    _list(value, "rules", 0, C.MAX_RULES)
    counts, pairs, presence, consecutive, scope, presence_ids = [], [], [], [], {}, []
    for i, raw in enumerate(value):
        p = f"rules[{i}]"
        if not isinstance(raw, dict):
            _fail(p, "type")
        kind = raw.get("kind")
        shapes = {
            "count": (("id", "kind", "person", "roles", "op", "month", "value"), ()),
            "pair": (("id", "kind", "persons", "roles"), ("month",)),
            "presence": (("id", "kind", "persons", "roles", "exclusive"), ("month",)),
            "consecutive": (("id", "kind", "person", "roles"), ()),
        }
        if kind not in shapes:
            _fail(f"{p}.kind", "format")
        _object(raw, p, *shapes[kind])
        rid = raw["id"]
        if not isinstance(rid, str) or not RULE_ID_RE.match(rid):
            _fail(f"{p}.id", "format")
        if rid == RESERVED_RULE_ID:
            _fail(f"{p}.id", "reserved")
        month = raw.get("month")
        if "month" in raw:
            _month(month, f"{p}.month")
            if month not in months:
                _fail(f"{p}.month", "not_in_months")
        roles = _role_keys(raw["roles"], f"{p}.roles")
        if kind == "count":
            person = _person(raw["person"], f"{p}.person", people)
            if raw["op"] not in COUNT_OPS:
                _fail(f"{p}.op", "format")
            v = _int(raw["value"], f"{p}.value", 0)
            counts.append(CountRule(rid, person, roles, raw["op"], month, v, i))
        elif kind == "pair":
            _list(raw["persons"], f"{p}.persons", 2, 2)
            a = _person(raw["persons"][0], f"{p}.persons[0]", people)
            b = _person(raw["persons"][1], f"{p}.persons[1]", people)
            if a == b:
                _fail(f"{p}.persons", "duplicate")
            pairs.append(PairRule(rid, (a, b), roles, month, i))
        elif kind == "presence":
            _list(raw["persons"], f"{p}.persons", 1, C.MAX_PEOPLE)
            members = []
            for j, x in enumerate(raw["persons"]):
                x = _person(x, f"{p}.persons[{j}]", people)
                if x in members:
                    _fail(f"{p}.persons[{j}]", "duplicate")
                members.append(x)
            exclusive = _bool(raw["exclusive"], f"{p}.exclusive")
            presence.append(PresenceRule(rid, tuple(members), roles, exclusive, month, i))
            if rid not in presence_ids:
                presence_ids.append(rid)
        else:
            person = _person(raw["person"], f"{p}.person", people)
            consecutive.append(ConsecutiveRule(rid, person, roles, i))
        entries = scope.setdefault(rid, [])
        if (month is None and entries) or (month is not None and any(m is None for m in entries)):
            _fail(f"{p}.id", "scope_mixed")
        if month is not None and month in entries:
            _fail(f"{p}.id", "duplicate")
        entries.append(month)
    return tuple(counts), tuple(pairs), tuple(presence), tuple(consecutive), tuple(presence_ids)


def _cross_checks(body, people, counts):
    order = list(people)
    for rule in counts:
        if rule.op == "==" and "Sun.Lead" in rule.roles and people[rule.person].cadence is not None:
            _fail(f"people[{order.index(rule.person)}].cadence", "cadence_exact_lead")
    exact = sorted((r for r in counts if r.op == "=="), key=lambda r: r.id)
    for i, a in enumerate(exact):
        for b in exact[i + 1:]:
            if a.person == b.person and a.month == b.month and set(a.roles) & set(b.roles):
                _fail(f"rules[{b.index}]", "exact_overlap")


def _parse_pins(value, by_id, people):
    if not isinstance(value, list):
        _fail("pins", "type")
    if len(value) > C.PIN_CAP:
        raise Refusal("too_many_pins", count=len(value), cap=C.PIN_CAP)
    pins, seen = set(), {}
    for i, raw in enumerate(value):
        p = f"pins[{i}]"
        _object(raw, p, ("service", "date", "role", "person"))
        sid = raw["service"]
        if not isinstance(sid, str):
            _fail(f"{p}.service", "type")
        if sid not in by_id:
            raise Refusal("unknown_service", field=f"{p}.service", service=sid)
        person = _person(raw["person"], f"{p}.person", people)
        service = by_id[sid]
        if raw["date"] != service.date:
            _fail(f"{p}.date", "date_mismatch")
        if raw["role"] not in service.roles:
            _fail(f"{p}.role", "role_not_in_service")
        pin = Pin(sid, service.date, raw["role"], person)
        other = seen.get((sid, person))
        if other is not None and other != pin.role:
            raise Refusal("pin_conflict", person=person, service=sid)
        seen[(sid, person)] = pin.role
        pins.add(pin)
    return tuple(sorted(pins, key=lambda x: (x.service, x.role, x.person)))


def _parse_prior(value, months):
    _object(value, "prior", ("month", "has_services", "services"))
    month = _month(value["month"], "prior.month")
    if month != add_months(months[0], -1):
        _fail("prior.month", "prior_month")
    has_services = _bool(value["has_services"], "prior.has_services")
    if not isinstance(value["services"], list):
        _fail("prior.services", "type")
    first = f"{months[0]}-01"
    lo, hi = add_days(first, -14), add_days(first, -1)
    services = []
    for i, raw in enumerate(value["services"]):
        p = f"prior.services[{i}]"
        _object(raw, p, ("date", "kind", "counts", "seats"))
        date = raw["date"]
        if parse_date(date) is None:
            _fail(f"{p}.date", "format")
        if not lo <= date <= hi:
            _fail(f"{p}.date", "prior_window")
        kind = raw["kind"]
        if kind not in SERVICE_KINDS:
            _fail(f"{p}.kind", "format")
        if (kind == "sunday" and weekday(date) != 6) or (kind == "saturday" and weekday(date) != 5):
            _fail(f"{p}.kind", "weekday")
        counts = _bool(raw["counts"], f"{p}.counts")
        _object(raw["seats"], f"{p}.seats", (), ROLES)
        seats = {}
        for role in ROLES:
            ids = raw["seats"].get(role, [])
            if not isinstance(ids, list) or not all(isinstance(x, str) for x in ids):
                _fail(f"{p}.seats.{role}", "type")
            seats[role] = tuple(ids)
        services.append(PriorService(date, kind, counts, seats, day_class(date)))
    services.sort(key=lambda s: (s.date, s.kind))
    return Prior(month=month, has_services=has_services, services=tuple(services))


def _parse_budget(value):
    knobs = (
        ("total_seconds", C.MIN_TOTAL_SECONDS, C.TOTAL_SECONDS),
        ("stage_seconds", C.MIN_STAGE_SECONDS, C.STAGE_SECONDS),
        ("stage_det_limit", C.MIN_STAGE_DET_LIMIT, C.STAGE_DET_LIMIT),
    )
    out = {name: default for name, _, default in knobs}
    if value is None:
        return Budget(**out)
    _object(value, "budget", (), tuple(n for n, _, _ in knobs))
    for name, lo, hi in knobs:
        if name in value:
            v = value[name]
            if not _is_number(v):
                _fail(f"budget.{name}", "type")
            out[name] = min(max(float(v), lo), hi)
    return Budget(**out)
```

- [ ] **Step 4: Run the suite and the layout guard**

Run: `"$PY" -m unittest discover -s gcf_v3 -t gcf_v3 2>&1 | tail -3 && npx vitest run scripts/__tests__/ciLayout.test.ts 2>&1 | tail -4`
Expected: `Ran 36 tests … OK`; `Tests  51 passed (51)`.

- [ ] **Step 5: Commit**

```bash
git add gcf_v3/owt_v3/request.py gcf_v3/tests/test_request.py
git commit -m "feat(solver-v3): the contract-3 request parser and its refusals" -m "Spec C5 §5: unknown keys refused at every level so a misspelt field never falls back to a default; service ids by isCanonicalDocumentId so every stored _id is accepted verbatim; pins keyed by service and refused (never truncated) above 250; cadence on every month and never beside an exact Sun.Lead (A11); one exact count per role key (A38); the reserved mandatory_lead id. Validation runs before any solve and never reads the clock."
```

---

## Task 4: The shared realised formula

Spec §6.2 (populations, items 1–5), §6.3 (presence seat never a fixed seat, set-asides (a)–(e)), §6.4 (floor seat, C5-15), §6.6 (one seat per person per service, `second_seat` first), C5-10, C2 LG-4, LG-7–LG-11; §12.1 «Model contracts» (presence seat never fixed, second seat, floor time tie-break, floor skip, conservation).

**Files:**
- Create: `gcf_v3/owt_v3/formula.py`, `gcf_v3/tests/test_formula.py`

**Interfaces:**
- Consumes: `owt_v3.vocab` (Task 2).
- Produces: `FService(id, date, time, month, day, weekend, keys, seats: {role: tuple of holders})`; `FPresence(id, roles, members, exclusive)`; `FMonth(listed, exact: {p: frozenset}, cadence, exempt, presence, base_in(p, fs, key) -> bool)` with `.is_exact(p, key)`, `.is_fixed_seat(p, key)`; `applying(month, s) -> [(rule, A)]`; `q_members(month, s, rule, A) -> tuple`; `populations(month, s, held_exact=frozenset()) -> {key: tuple}`; `keep_seats(s) -> (kept, second)`; `realised(services, months, floor_override=None) -> Realised` with `.share[(m, p, line)]: Fraction`, `.received[(m, p, line)]: int`, `.seats: [(sid, role, p, outcome)]` (outcome a line key or `"set_aside:<reason>"`), `.set_asides: [{service, role, key, person, reason}]`, `.floor_seat[(m, p)] = (sid, role)`, `.floor_persons[m]`, `.in_population: {(m, p, line)}`, `.fixed_holders[m]`, `.conservation: [(sid, key or P:line, shared, pool)]`.

- [ ] **Step 1: Write the failing test**

**Create** `gcf_v3/tests/test_formula.py`:

```python
"""The shared realised formula (spec §6.2–§6.4, §6.6; C2 LG-4, LG-7–LG-11), hand-computed.

These cases mirror C2's FX-4 shapes so the formula is guarded before the golden fixture
asserts it (test_golden.py). Names are fictitious.
"""

import unittest
from fractions import Fraction

from owt_v3.formula import FMonth, FPresence, FService, realised

M = "2026-10"


def svc(sid, date, lead=(), bgv=(), choir=(), time=None, weekend=True):
    day = "Sun" if date in ("2026-10-04", "2026-10-11", "2026-10-18", "2026-10-25") else "Sat"
    return FService(id=sid, date=date, time=time, month=M, day=day, weekend=weekend,
                    keys=tuple(f"{day}.{r}" for r in ("Lead", "BGV", "Choir")),
                    seats={"Lead": tuple(lead), "BGV": tuple(bgv), "Choir": tuple(choir)})


def month(status, exact=None, cadence=(), exempt=None, presence=(), away=()):
    """status: {person: {role key: "in"}}; away: {(person, date)} unavailable.

    Everyone is exempt unless `exempt` says otherwise, so the floor seat (LG-11) stays out of
    the cases that are not about it: in a small month every share is below 1.
    """
    exact = exact or {}
    exempt = set(status) if exempt is None else set(exempt)

    def base_in(p, s, k):
        return status.get(p, {}).get(k) == "in" and (p, s.date) not in set(away)
    return FMonth(listed=frozenset(status), exact={p: frozenset(v) for p, v in exact.items()},
                  cadence=frozenset(cadence), exempt=frozenset(exempt), presence=tuple(presence),
                  base_in=base_in)


def ins(*keys):
    return {k: "in" for k in keys}


def totals(res):
    share, recv = {}, {}
    for (m, p, line), v in res.share.items():
        share[(p, line)] = share.get((p, line), Fraction(0)) + v
    for (m, p, line), v in res.received.items():
        recv[(p, line)] = recv.get((p, line), 0) + v
    return share, recv


class Populations(unittest.TestCase):
    def test_uneven_division_conserves(self):
        fm = month({p: ins("Sun.BGV") for p in ("m-ana", "m-bea", "m-cris")})
        res = realised([svc("s1", "2026-10-04", bgv=("m-ana", "m-bea"))], {M: fm})
        share, recv = totals(res)
        self.assertEqual(share[("m-cris", "BGV")], Fraction(2, 3))
        self.assertEqual(recv[("m-ana", "BGV")], 1)
        for sid, line, shared, pool in res.conservation:
            self.assertEqual(shared, pool)

    def test_exact_half(self):
        people = [f"m-{n}" for n in ("ana", "bea", "cris", "dario", "ema", "fede", "gala", "iris")]
        fm = month({p: ins("Sun.Choir") for p in people})
        share, recv = totals(realised([svc("s1", "2026-10-11", choir=("m-ana",))], {M: fm}))
        self.assertEqual(share[("m-ana", "CORO")], Fraction(1, 8))

    def test_exact_role_holder_leaves_the_other_populations_there(self):
        fm = month({"m-ana": {"Sun.Lead": "in"}, "m-bea": ins("Sun.Lead", "Sun.BGV")},
                   exact={"m-ana": ["Sun.BGV"]})
        res = realised([svc("s1", "2026-10-04", lead=("m-bea",), bgv=("m-ana",))], {M: fm})
        share, _ = totals(res)
        self.assertNotIn(("m-ana", "DL"), share)  # LG-8 (vii): she holds an exact BGV seat at s
        self.assertIn({"service": "s1", "role": "BGV", "key": "Sun.BGV", "person": "m-ana", "reason": "exact"},
                      res.set_asides)

    def test_cadence_holder_has_no_dl_line(self):
        fm = month({"m-ana": ins("Sun.Lead"), "m-bea": ins("Sun.Lead")}, cadence=["m-ana"])
        res = realised([svc("s1", "2026-10-04", lead=("m-ana", "m-bea"))], {M: fm})
        share, recv = totals(res)
        self.assertEqual(share[("m-bea", "DL")], 1)
        self.assertNotIn(("m-ana", "DL"), share)
        self.assertEqual(res.set_asides[0]["reason"], "cadence")


class Presence(unittest.TestCase):
    def test_sole_available_member_leaves_every_normal_population(self):
        rule = FPresence("pr-1", ("Sun.BGV",), ("m-ana", "m-bea"), False)
        fm = month({"m-ana": ins("Sun.Lead", "Sun.BGV"), "m-bea": ins("Sun.BGV"), "m-cris": ins("Sun.Lead", "Sun.BGV")},
                   presence=[rule], away=[("m-bea", "2026-10-04")])
        res = realised([svc("s1", "2026-10-04", lead=("m-cris",), bgv=("m-ana",))], {M: fm})
        share, recv = totals(res)
        self.assertNotIn(("m-ana", "DL"), share)
        self.assertEqual(share[("m-ana", "P:pr-1")], 1)
        self.assertEqual(recv[("m-ana", "P:pr-1")], 1)

    def test_exclusive_members_leave_the_rule_roles_only(self):
        rule = FPresence("pr-1", ("Sun.BGV",), ("m-ana", "m-bea"), True)
        fm = month({"m-ana": ins("Sun.Lead", "Sun.BGV"), "m-bea": ins("Sun.BGV"), "m-cris": ins("Sun.BGV")},
                   presence=[rule])
        res = realised([svc("s1", "2026-10-04", bgv=("m-bea", "m-cris"))], {M: fm})
        share, recv = totals(res)
        self.assertEqual(share[("m-cris", "BGV")], 1)  # the only normal BGV member; pool 1
        self.assertEqual(share[("m-ana", "P:pr-1")], Fraction(1, 2))
        self.assertIn(("m-ana", "DL"), share)

    def test_presence_seat_is_never_a_fixed_seat(self):
        rule = FPresence("pr-1", ("Sun.BGV",), ("m-ana", "m-bea"), False)
        fm = month({"m-ana": {}, "m-bea": ins("Sun.BGV"), "m-cris": ins("Sun.BGV"), "m-dario": ins("Sun.BGV")},
                   exact={"m-ana": ["Sun.BGV"]}, presence=[rule], exempt=())
        res = realised([svc("s1", "2026-10-25", bgv=("m-cris", "m-bea", "m-ana"))], {M: fm})
        share, recv = totals(res)
        reasons = {(a["person"], a["reason"]) for a in res.set_asides}
        self.assertIn(("m-ana", "exact"), reasons)
        self.assertEqual(recv[("m-bea", "P:pr-1")], 1)  # the next member's seat is the presence seat
        self.assertNotIn((M, "m-ana"), res.floor_seat)
        self.assertIn(("m-cris", "floor"), reasons)  # share 1/2 < 1, a received seat, no fixed seat

    def test_a_cadence_holders_dl_seat_is_never_the_presence_seat(self):
        rule = FPresence("pr-1", ("Sun.Lead",), ("m-ana", "m-bea"), False)
        fm = month({"m-ana": ins("Sun.Lead"), "m-bea": ins("Sun.Lead"), "m-cris": ins("Sun.Lead")},
                   cadence=["m-ana"], presence=[rule])
        res = realised([svc("s1", "2026-10-04", lead=("m-ana", "m-bea"))], {M: fm})
        _, recv = totals(res)
        self.assertIn(("m-ana", "cadence"), {(a["person"], a["reason"]) for a in res.set_asides})
        self.assertEqual(recv.get(("m-bea", "P:pr-1")), 1)  # the next member's seat is the presence seat

    def test_presence_seat_ties_break_by_member_id_not_array_order(self):
        rule = FPresence("pr-1", ("Sun.BGV",), ("m-ana", "m-bea"), False)
        fm = month({"m-ana": ins("Sun.BGV"), "m-bea": ins("Sun.BGV"), "m-cris": ins("Sun.BGV")}, presence=[rule])
        res = realised([svc("s1", "2026-10-04", bgv=("m-bea", "m-ana"))], {M: fm})
        _, recv = totals(res)
        self.assertEqual(recv.get(("m-ana", "P:pr-1")), 1)
        self.assertEqual(recv.get(("m-bea", "BGV")), 1)


class SecondSeat(unittest.TestCase):
    def test_second_seat_changes_nothing_but_itself(self):
        status = {p: ins("Sun.Lead", "Sun.BGV") for p in ("m-ana", "m-bea", "m-cris", "m-dario")}
        with_second = realised([svc("s1", "2026-10-18", lead=("m-ana", "m-bea"), bgv=("m-ana", "m-cris"))],
                               {M: month(status)})
        without = realised([svc("s1", "2026-10-18", lead=("m-ana", "m-bea"), bgv=("m-cris",))], {M: month(status)})
        self.assertEqual(totals(with_second)[1], totals(without)[1])
        self.assertIn({"service": "s1", "role": "BGV", "key": "Sun.BGV", "person": "m-ana",
                       "reason": "second_seat"}, with_second.set_asides)

    def test_a_second_seat_cancels_no_floor(self):
        crowd = {f"m-x{i}": ins("Sun.Lead", "Sun.BGV") for i in range(8)}
        crowd["m-ana"] = {"Sun.Lead": "in"}
        res = realised([svc("s1", "2026-10-18", lead=("m-ana",), bgv=("m-ana",))],
                       {M: month(crowd, exact={"m-ana": ["Sun.BGV"]}, exempt=())})
        # her BGV seat (exact for her) is a SECOND seat: invisible to «no fixed seat», so her Lead floors
        self.assertEqual(res.floor_seat[(M, "m-ana")], ("s1", "Lead"))

    def test_a_repeated_entry_counts_once(self):
        status = {p: ins("Sun.Choir") for p in ("m-ana", "m-bea")}
        res = realised([svc("s1", "2026-10-04", choir=("m-ana", "m-ana"))], {M: month(status)})
        self.assertEqual(totals(res)[1][("m-ana", "CORO")], 1)


class FloorSeat(unittest.TestCase):
    def status(self):
        crowd = {f"m-x{i}": ins("Sat.BGV", "Sun.BGV") for i in range(9)}
        crowd["m-ana"] = ins("Sat.BGV", "Sun.BGV")
        return crowd

    def test_time_breaks_a_same_date_same_role_tie(self):
        a = svc("b", "2026-10-03", bgv=("m-ana",), time="20:00", weekend=False)
        b = svc("a", "2026-10-03", bgv=("m-x1",), time=None, weekend=False)
        c = svc("c", "2026-10-03", bgv=("m-x2",), time="19:00", weekend=False)
        d = svc("d", "2026-10-03", bgv=("m-ana",), time="19:00", weekend=False)
        res = realised([a, b, c], {M: month(self.status(), exempt=())})
        self.assertEqual(res.floor_seat[(M, "m-ana")], ("b", "BGV"))
        res = realised([a, b, d], {M: month(self.status(), exempt=())})
        self.assertEqual(res.floor_seat[(M, "m-ana")], ("d", "BGV"))  # 19:00 before 20:00 and before none

    def test_an_exact_or_cadence_seat_skips_the_floor_but_outside_population_does_not(self):
        status = self.status()
        status["m-ana"] = {"Sun.BGV": "in"}  # not in Sun.Lead: her Lead seat is outside the population
        two = [svc("s1", "2026-10-04", lead=("m-ana",)), svc("s2", "2026-10-11", bgv=("m-ana",))]
        res = realised(two, {M: month(status, exempt=())})
        self.assertEqual(res.floor_seat[(M, "m-ana")], ("s2", "BGV"))  # outside_population cancels nothing
        res = realised(two, {M: month(status, exempt=(), exact={"m-ana": ["Sun.Lead"]})})
        self.assertNotIn((M, "m-ana"), res.floor_seat)  # an exact seat she holds cancels the floor
        res = realised(two, {M: month(status, exempt=(), cadence=["m-ana"])})
        self.assertNotIn((M, "m-ana"), res.floor_seat)  # so does a cadence holder's DL-mapped seat

    def test_floor_override_is_the_models_view(self):
        res = realised([svc("s1", "2026-10-04", bgv=("m-ana",))], {M: month(self.status(), exempt=())},
                       floor_override={M: frozenset()})
        self.assertEqual(res.floor_seat, {})


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run it to see it fail**

Run: `(cd gcf_v3 && "$PY" -m unittest tests.test_formula)`
Expected: FAIL — `ModuleNotFoundError: No module named 'owt_v3.formula'`.

- [ ] **Step 3: Implement**

**Create** `gcf_v3/owt_v3/formula.py`:

```python
"""The shared realised formula (spec §6.2–§6.4, §6.6; C2 LG-4, LG-7–LG-11, F14).

One pure function, `realised`, computes per month, person and line the exact share
and the received seats of a set of COUNTED services whose seats are filled. It runs
in the post-solve report (on the returned assignment) and in the golden-fixture test
(on C2's stored cases). Its inputs are neutral so both callers can build them:

- `FService`: one counted service, its seat holders per role in input order.
- `FMonth`: the month's facts — who is listed, each person's exact role keys, the
  cadence and exempt sets, the presence rules in scope, and `base_in(p, s, k)`: p is
  «in» for role key k at s (status `in`, available, not rule-excluded). On the request
  side that is «k's role is in her eligibility and k is not exact for her».

Everything is exact (`Fraction`); nothing is rounded here (C5-8).
"""

from collections import defaultdict
from dataclasses import dataclass, field
from fractions import Fraction
from typing import Callable, Dict, FrozenSet, Optional, Tuple

from .vocab import LINE_OF_KEY, ROLE_RANK, ROLES, role_key, seat_order_key


@dataclass(frozen=True)
class FService:
    id: str
    date: str
    time: Optional[str]
    month: str
    day: str  # "Sun" | "Sat"
    weekend: bool
    keys: Tuple[str, ...]  # the role keys the service has
    seats: Dict[str, Tuple[str, ...]]  # role -> holders, input order


@dataclass(frozen=True)
class FPresence:
    id: str
    roles: Tuple[str, ...]
    members: Tuple[str, ...]
    exclusive: bool


@dataclass
class FMonth:
    listed: FrozenSet[str]
    exact: Dict[str, FrozenSet[str]]
    cadence: FrozenSet[str]
    exempt: FrozenSet[str]
    presence: Tuple[FPresence, ...]
    base_in: Callable[[str, FService, str], bool]

    def is_exact(self, person, key):
        return key in self.exact.get(person, ())

    def is_fixed_seat(self, person, key):
        """A12's fixed seat: an exact role key, or a DL-mapped seat of a cadence holder."""
        return self.is_exact(person, key) or (LINE_OF_KEY[key] == "DL" and person in self.cadence)


@dataclass
class Realised:
    share: Dict[Tuple[str, str, str], Fraction] = field(default_factory=lambda: defaultdict(Fraction))
    received: Dict[Tuple[str, str, str], int] = field(default_factory=lambda: defaultdict(int))
    # every seat: (service, role, person, outcome) with outcome a line key or "set_aside:<reason>"
    seats: list = field(default_factory=list)
    set_asides: list = field(default_factory=list)  # {service, role, key, person, reason}
    floor_seat: Dict[Tuple[str, str], Tuple[str, str]] = field(default_factory=dict)  # (m, p) -> (sid, role)
    floor_persons: Dict[str, FrozenSet[str]] = field(default_factory=dict)
    in_population: set = field(default_factory=set)  # (m, p, line)
    fixed_holders: Dict[str, FrozenSet[str]] = field(default_factory=dict)  # m -> people with an exact/cadence seat
    conservation: list = field(default_factory=list)  # (service, line, sum of shares, received seats)


def applying(month, s):
    """[(rule, A)] for the presence rules applying at s, in codepoint order of id (LG-7)."""
    if not s.weekend:
        return []
    out = []
    for rho in sorted(month.presence, key=lambda r: r.id):
        a = tuple(k for k in rho.roles if k in s.keys)
        if a:
            out.append((rho, a))
    return out


def q_members(month, s, rho, a):
    """Q(rho, s): members «in» at s for some role key of A(rho, s), codepoint order."""
    return tuple(sorted(m for m in set(rho.members) if any(month.base_in(m, s, k) for k in a)))


def populations(month, s, held_exact=frozenset()):
    """Pop(s, k) for every key s has (§6.2 items 1–5; LG-8).

    `held_exact` is item 5's input: the people holding, at s, a kept seat whose role key
    is exact for them; they leave every OTHER key's population there.
    """
    rules = applying(month, s)
    sole = set()
    for rho, a in rules:
        q = q_members(month, s, rho, a)
        if len(q) == 1:
            sole.add(q[0])
    out = {}
    for k in s.keys:
        members = []
        for p in sorted(month.listed):
            if not month.base_in(p, s, k):
                continue
            if LINE_OF_KEY[k] == "DL" and p in month.cadence:
                continue
            if any(rho.exclusive and p in rho.members and k in a for rho, a in rules):
                continue
            if p in sole:
                continue
            if p in held_exact and not month.is_exact(p, k):
                continue
            members.append(p)
        out[k] = tuple(members)
    return out


def keep_seats(s):
    """LG-4: each holder's first seat in Lead > BGV > Choir order; every further one is a second seat."""
    kept, second, seen = [], [], set()
    for role in ROLES:
        for h in s.seats.get(role, ()):
            if h in seen:
                second.append((role, h))
            else:
                seen.add(h)
                kept.append((role, h))
    return kept, second


def _service_pass(s, month):
    """Everything about one counted service before floor set-asides."""
    kept, second = keep_seats(s)
    held_exact = frozenset(h for role, h in kept if month.is_exact(h, role_key(s.day, role)))
    pop = populations(month, s, held_exact)
    rules = applying(month, s)
    q = {rho.id: q_members(month, s, rho, a) for rho, a in rules}
    used, pi = set(), {}
    for rho, a in rules:
        cands = sorted(
            (ROLE_RANK[role], h, role) for role, h in kept
            if role_key(s.day, role) in a and h in rho.members
            and not month.is_fixed_seat(h, role_key(s.day, role)) and (role, h) not in used
        )
        if cands:
            _, h, role = cands[0]
            used.add((role, h))
            pi[rho.id] = (role, h)
    seat_class = {}  # (role, h) -> ("normal", line) | ("presence", rho_id) | ("set_aside", reason)
    pi_of = {v: k for k, v in pi.items()}
    for role, h in kept:
        k = role_key(s.day, role)
        if (role, h) in pi_of:
            rid = pi_of[(role, h)]
            seat_class[(role, h)] = ("presence", rid) if h in q[rid] else ("set_aside", "outside_population")
        elif month.is_exact(h, k):
            seat_class[(role, h)] = ("set_aside", "exact")
        elif LINE_OF_KEY[k] == "DL" and h in month.cadence:
            seat_class[(role, h)] = ("set_aside", "cadence")
        elif h not in month.listed:
            seat_class[(role, h)] = ("set_aside", "not_in_record")
        elif h not in pop[k]:
            seat_class[(role, h)] = ("set_aside", "outside_population")
        else:
            seat_class[(role, h)] = ("normal", LINE_OF_KEY[k])
    return kept, second, pop, rules, q, pi, seat_class


def realised(services, months, floor_override=None):
    """Exact shares and received seats (§6.6). `services` are counted only.

    `months` maps each month to its `FMonth`. `floor_override`, when given, maps a month
    to the set of floor persons to use instead of the realised test (the model's view:
    it uses the plan's floor persons, §6.6); each of them still needs a received seat.
    """
    out = Realised()
    by_month = defaultdict(list)
    for s in sorted(services, key=lambda x: (x.date, x.id)):
        by_month[s.month].append(s)
    for m in sorted(by_month):
        month = months[m]
        passes = []
        share = defaultdict(Fraction)  # (p, line) before floor set-asides
        received_seats = defaultdict(list)  # p -> [(order key, sid, role, line)]
        fixed = set()
        for s in by_month[m]:
            kept, second, pop, rules, q, pi, cls = _service_pass(s, month)
            passes.append((s, kept, second, pop, rules, q, pi, cls))
            for k, members in pop.items():
                for p in members:
                    out.in_population.add((m, p, LINE_OF_KEY[k]))
            for rho, _ in rules:
                for p in q[rho.id]:
                    out.in_population.add((m, p, f"P:{rho.id}"))
            for (role, h), (kind, what) in cls.items():
                if kind == "set_aside" and what in ("exact", "cadence"):
                    fixed.add(h)
                if kind in ("normal", "presence"):
                    line = what if kind == "normal" else f"P:{what}"
                    received_seats[h].append((seat_order_key(s.date, role, s.time, s.id), s.id, role, line))
            for k, members in pop.items():
                pool = sum(1 for (role, h), (kind, what) in cls.items()
                           if kind == "normal" and role_key(s.day, role) == k)
                for p in members:
                    share[(p, LINE_OF_KEY[k])] += Fraction(pool, len(members))
            for rho, _ in rules:
                if rho.id in pi and cls[pi[rho.id]][0] == "presence":
                    for p in q[rho.id]:
                        share[(p, f"P:{rho.id}")] += Fraction(1, len(q[rho.id]))
        # LG-11 / §6.4: floor persons, on values without floor set-asides
        if floor_override is not None:
            persons = frozenset(floor_override.get(m, ()))
        else:
            persons = set()
            for p in sorted(month.listed):
                if p in month.exempt or p in fixed or not received_seats.get(p):
                    continue
                if not any(mm == m and pp == p for (mm, pp, _) in out.in_population):
                    continue
                total = sum((v for (pp, _), v in share.items() if pp == p), Fraction(0))
                if total < 1:
                    persons.add(p)
            persons = frozenset(persons)
        out.floor_persons[m] = persons
        out.fixed_holders[m] = frozenset(fixed)
        floor = {}
        for p in sorted(persons):
            if received_seats.get(p):
                _, sid, role, line = min(received_seats[p])
                floor[(sid, role, p)] = line
                out.floor_seat[(m, p)] = (sid, role)
        # final pass with floor set-asides applied together
        for s, kept, second, pop, rules, q, pi, cls in passes:
            for role, h in second:
                k = role_key(s.day, role)
                out.set_asides.append({"service": s.id, "role": role, "key": k, "person": h, "reason": "second_seat"})
                out.seats.append((s.id, role, h, "set_aside:second_seat"))
            final = {}
            for (role, h), (kind, what) in cls.items():
                if kind in ("normal", "presence") and (s.id, role, h) in floor:
                    final[(role, h)] = ("set_aside", "floor")
                else:
                    final[(role, h)] = (kind, what)
            for role, h in kept:
                kind, what = final[(role, h)]
                k = role_key(s.day, role)
                if kind == "set_aside":
                    out.set_asides.append({"service": s.id, "role": role, "key": k, "person": h, "reason": what})
                    out.seats.append((s.id, role, h, f"set_aside:{what}"))
                else:
                    line = what if kind == "normal" else f"P:{what}"
                    out.received[(m, h, line)] += 1
                    out.seats.append((s.id, role, h, line))
            for k, members in pop.items():
                pool = sum(1 for (role, h), (kind, what) in final.items()
                           if kind == "normal" and role_key(s.day, role) == k)
                for p in members:
                    out.share[(m, p, LINE_OF_KEY[k])] += Fraction(pool, len(members))
                shared = sum((Fraction(pool, len(members)) for _ in members), Fraction(0))
                out.conservation.append((s.id, k, shared, pool))
            for rho, _ in rules:
                live = rho.id in pi and final[pi[rho.id]][0] == "presence"
                members = q[rho.id]
                if live:
                    for p in members:
                        out.share[(m, p, f"P:{rho.id}")] += Fraction(1, len(members))
                out.conservation.append((s.id, f"P:{rho.id}", Fraction(1) if live else Fraction(0), 1 if live else 0))
    return out
```

- [ ] **Step 4: Run the suite and the layout guard**

Run: `"$PY" -m unittest discover -s gcf_v3 -t gcf_v3 2>&1 | tail -3 && npx vitest run scripts/__tests__/ciLayout.test.ts 2>&1 | tail -4`
Expected: `Ran 51 tests … OK`; `Tests  51 passed (51)`.

- [ ] **Step 5: Commit**

```bash
git add gcf_v3/owt_v3/formula.py gcf_v3/tests/test_formula.py
git commit -m "feat(solver-v3): the one realised fairness formula" -m "C5-10/F14: populations, the second seat (checked first), the presence seat (never a fixed seat, ties by member id), set-asides and the floor seat exactly as C2's LG-4 and LG-7-LG-11 state them, in exact rationals. The report and the golden test both run this function; a floor_override gives the model's view (the plan's floor persons) for the equality test."
```

---

## Task 5: Request facts and planned shares

Spec §6.2 «F6 in the plan only», §6.3 «Set-asides in the plan», §6.4 «In the plan», §6.5 (F13), §6.7 clamps (values), §6.8 (DL line, F10, capacity), C5-9, C5-11, C5-12, C5-15; §12.1 «Model contracts» (plan's F6 for pins and for exact rules with no slack; C5-9's pin remainder; floor skip in the plan; hand-computed planned shares).

**Files:**
- Create: `gcf_v3/owt_v3/facts.py`, `gcf_v3/owt_v3/plan.py`, `gcf_v3/tests/builders.py`, `gcf_v3/tests/test_plan.py`

**Interfaces:**
- Consumes: `parse_request`/`Problem` (Task 3), `formula` (Task 4), `vocab` (Task 2).
- Produces: `Facts(problem)` with `.P, .months, .services, .svc, .people, .pids, .pin_of[(sid, p)] = role, .pin_rows[(sid, role)] = [p], .pinned: frozenset of cells, .row_size[(sid, role)], .cells: [(sid, role, p)] (canonical), .cells_at[sid], .cell_set, .exact[(p, m)], .clamped[rule index], .available[rule index], .clamp_notices, .fmonths[m], .fservice_base[sid]`, methods `eligible(p, sid, role)`, `is_exact(p, m, key)`, `cadence_state(p, m)`, `has_cadence(p)`, `key(sid, role)`, `line(sid, role)`, `available_matching(p, m, roles)`, `presence_in(m)`, `presence_rules_at(s)`, `fservices(assignment)`, `realised_populations(s) -> (pop, q, applying)`, `on_dl_line(p, m)`, `f10_instances()`, `f9_instances()`, `dl_capacity() -> (seats, people)`, `weekend_terms(p, roles, counted_only=False, dl_only=False) -> {weekend: ([cells], prior const)}`. `compute_plan(F) -> PlanResult` with `.share[(m, p, line)]`, `.floor_persons[m]`, `.in_population`, `.clamped_lines`, `.planned(p, line) -> Fraction`. `tests/builders.py`: `service`, `person`, `request`, `everyone`, `pin`, `NOV_SUNDAYS`, `NOV_SATURDAYS`.

- [ ] **Step 1: Write the failing test**

**Create** `gcf_v3/tests/builders.py`:

```python
"""Fictitious request builders for the v3 unit suite. Every name here is invented."""

import copy

ALL3 = ["Lead", "BGV", "Choir"]


def service(sid, date, kind="sunday", seats=None, fixed=False, counts=True, time=None):
    s = {"id": sid, "date": date, "month": date[:7], "kind": kind, "fixed": fixed, "counts": counts}
    if not fixed:
        s["seats"] = seats if seats is not None else (
            {"Lead": 2, "BGV": 3} if kind == "saturday" else {"Lead": 2, "BGV": 3, "Choir": 3})
    if time is not None:
        s["time"] = time
    return s


def person(pid, eligibility, carried=None, exempt=False, cadence=None, dl_since="2026-01", prev=0, name=None):
    p = {"id": pid, "name": name or pid[2:].title(), "eligibility": eligibility, "carried": carried or {},
         "dl_since": dl_since, "prev_dl_leads": prev}
    if exempt:
        p["exempt"] = True
    if cadence is not None:
        p["cadence"] = cadence
    return p


def request(services, people, rules=None, pins=None, months=None, prior=None, seed=1, budget=None, request_id=None):
    months = months or sorted({s["month"] for s in services})
    first = months[0]
    y, m = int(first[:4]), int(first[5:7])
    prev = f"{y - 1}-12" if m == 1 else f"{y}-{m - 1:02d}"
    body = {"contract": 3, "seed": seed, "months": months, "services": services, "people": people,
            "rules": rules or [], "pins": pins or [],
            "prior": prior or {"month": prev, "has_services": True, "services": []}}
    if budget is not None:
        body["budget"] = budget
    if request_id is not None:
        body["request_id"] = request_id
    return copy.deepcopy(body)


def everyone(people_ids, services, roles=ALL3):
    """Eligibility for every listed person at every listed service (roles the service has)."""
    out = []
    for pid in people_ids:
        elig = {}
        for s in services:
            have = ["Lead", "BGV"] if (s["kind"] == "saturday" and not s["fixed"]) else ALL3
            elig[s["id"]] = [r for r in roles if r in have]
        out.append(person(pid, elig))
    return out


def pin(service_, role, pid):
    return {"service": service_["id"], "date": service_["date"], "role": role, "person": pid}


# One month (Nov 2026) used across modules: Sundays 1, 8, 15, 22, 29; Saturdays 14, 28.
NOV_SUNDAYS = ["2026-11-01", "2026-11-08", "2026-11-15", "2026-11-22", "2026-11-29"]
NOV_SATURDAYS = ["2026-11-14", "2026-11-28"]
```

**Create** `gcf_v3/tests/test_plan.py`:

```python
"""Planned shares (F13; spec §6.2 «F6 in the plan», §6.3 set-asides in the plan, §6.4, §6.5,
C5-9, C5-15), hand-computed on fictitious requests."""

import unittest
from fractions import Fraction

from owt_v3.facts import Facts
from owt_v3.plan import compute_plan
from owt_v3.request import parse_request
from tests.builders import NOV_SUNDAYS, person, pin, request, service

LEAD = {"Lead": 2, "BGV": 0, "Choir": 0}


def plan_of(body):
    F = Facts(parse_request(body))
    return F, compute_plan(F)


def sundays(n, seats=LEAD):
    return [service(f"s{i + 1}", NOV_SUNDAYS[i], seats=dict(seats)) for i in range(n)]


def lead_people(ids, svcs, exempt=True, **kw):
    return [person(p, {s["id"]: ["Lead"] for s in svcs}, exempt=exempt, **kw) for p in ids]


class Pools(unittest.TestCase):
    def test_a_pool_is_shared_equally(self):
        s = sundays(1)
        _, plan = plan_of(request(s, lead_people(["m-ana", "m-bea", "m-cris"], s)))
        self.assertEqual(plan.planned("m-ana", "DL"), Fraction(2, 3))

    def test_rows_grow_to_fit_their_pins(self):
        s = sundays(1)
        body = request(s, lead_people(["m-ana", "m-bea", "m-cris"], s),
                       pins=[pin(s[0], "Lead", p) for p in ("m-ana", "m-bea", "m-cris")])
        _, plan = plan_of(body)
        self.assertEqual(plan.planned("m-ana", "DL"), 1)  # base 3 (grown), three members

    def test_a_fixed_service_bases_on_its_pins(self):
        s = [service("st-1", NOV_SUNDAYS[0], fixed=True)]
        people = [person(p, {"st-1": ["Lead"]}, exempt=True) for p in ("m-ana", "m-bea")]
        _, plan = plan_of(request(s, people, pins=[pin(s[0], "Lead", "m-ana")]))
        self.assertEqual(plan.planned("m-bea", "DL"), Fraction(1, 2))


class DecidedSeats(unittest.TestCase):
    def test_a_pin_takes_her_out_of_the_other_roles_there(self):
        s = [service("s1", NOV_SUNDAYS[0], seats={"Lead": 1, "BGV": 1, "Choir": 0})]
        people = [person(p, {"s1": ["Lead", "BGV"]}, exempt=True) for p in ("m-ana", "m-bea")]
        F, plan = plan_of(request(s, people, pins=[pin(s[0], "Lead", "m-ana")]))
        self.assertEqual(plan.planned("m-ana", "BGV"), 0)
        self.assertEqual(plan.planned("m-bea", "BGV"), 1)

    def test_an_exact_rule_with_no_slack_decides_its_services(self):
        s = sundays(2, {"Lead": 1, "BGV": 1, "Choir": 0})
        ana = person("m-ana", {"s1": ["Lead", "BGV"]}, exempt=True)  # available on s1 only
        bea = person("m-bea", {"s1": ["Lead", "BGV"], "s2": ["Lead", "BGV"]}, exempt=True)
        rule = {"id": "cap-a", "kind": "count", "person": "m-ana", "roles": ["Sun.BGV"], "op": "==",
                "month": "2026-11", "value": 1}
        _, plan = plan_of(request(s, [ana, bea], rules=[rule]))
        self.assertEqual(plan.planned("m-ana", "DL"), 0)  # decided: her s1 seat is BGV
        self.assertEqual(plan.planned("m-bea", "DL"), 2)

    def test_with_slack_nothing_is_decided(self):
        s = sundays(2, {"Lead": 1, "BGV": 1, "Choir": 0})
        people = [person(p, {"s1": ["Lead", "BGV"], "s2": ["Lead", "BGV"]}, exempt=True) for p in ("m-ana", "m-bea")]
        rule = {"id": "cap-a", "kind": "count", "person": "m-ana", "roles": ["Sun.BGV"], "op": "==",
                "month": "2026-11", "value": 1}
        _, plan = plan_of(request(s, people, rules=[rule]))
        self.assertEqual(plan.planned("m-ana", "DL"), 1)  # in the Lead pool at both Sundays


class MonthlySetAsides(unittest.TestCase):
    def test_an_exact_count_minus_its_pins_is_spread_C5_9(self):
        s = sundays(3)
        people = lead_people(["m-ana", "m-bea", "m-cris"], s)
        rule = {"id": "cap-a", "kind": "count", "person": "m-ana", "roles": ["Sun.Lead"], "op": "==",
                "month": "2026-11", "value": 2}
        _, plan = plan_of(request(s, people, rules=[rule], pins=[pin(s[0], "Lead", "m-ana")]))
        # s1: base 2, her pin set aside (exact) -> pool 1 for bea and cris; s2, s3: remainder 1 spread
        # as 1/2 each -> pool 3/2 each. bea = 1/2 + 3/4 + 3/4 = 2.
        self.assertEqual(plan.planned("m-bea", "DL"), 2)
        self.assertEqual(plan.planned("m-ana", "DL"), 0)

    def test_a_cadence_on_sunday_is_spread_over_her_sundays(self):
        s = sundays(2)
        people = lead_people(["m-ana", "m-bea", "m-cris"], s)
        people[0]["cadence"] = {"2026-11": "on"}
        _, plan = plan_of(request(s, people))
        # each Sunday: base 2 - 1/2 set aside = 3/2, shared by bea and cris
        self.assertEqual(plan.planned("m-bea", "DL"), Fraction(3, 2))
        self.assertEqual(plan.planned("m-ana", "DL"), 0)


class Presence(unittest.TestCase):
    def test_the_forced_seat_splits_over_the_keys_with_a_member(self):
        s = [service("s1", NOV_SUNDAYS[0], seats={"Lead": 0, "BGV": 2, "Choir": 2})]
        both = {"s1": ["BGV", "Choir"]}
        people = [person(p, dict(both), exempt=True) for p in ("m-ana", "m-bea", "m-cris")]
        rule = {"id": "pr-1", "kind": "presence", "persons": ["m-ana", "m-bea"], "roles": ["Sun.BGV", "Sun.Choir"],
                "exclusive": False}
        _, plan = plan_of(request(s, people, rules=[rule]))
        # each key: 2 - 1/2 = 3/2 over three members; the sub-line's 1 seat over two members
        self.assertEqual(plan.planned("m-cris", "BGV"), Fraction(1, 2))
        self.assertEqual(plan.planned("m-ana", "P:pr-1"), Fraction(1, 2))

    def test_a_pinned_member_seat_is_the_forced_seat_once(self):
        s = [service("s1", NOV_SUNDAYS[0], seats={"Lead": 0, "BGV": 3, "Choir": 0})]
        people = [person(p, {"s1": ["BGV"]}, exempt=True) for p in ("m-ana", "m-bea", "m-cris", "m-dario")]
        rule = {"id": "pr-1", "kind": "presence", "persons": ["m-ana", "m-bea"], "roles": ["Sun.BGV"],
                "exclusive": True}
        _, plan = plan_of(request(s, people, rules=[rule], pins=[pin(s[0], "BGV", "m-ana")]))
        self.assertEqual(plan.planned("m-cris", "BGV"), 1)  # (3 - 1) / 2, not (3 - 2) / 2

    def test_the_sole_available_member_leaves_every_normal_pool(self):
        s = [service("s1", NOV_SUNDAYS[0], seats={"Lead": 2, "BGV": 1, "Choir": 0})]
        people = [person("m-ana", {"s1": ["Lead", "BGV"]}, exempt=True),
                  person("m-bea", {}, exempt=True),  # the other member, away
                  person("m-cris", {"s1": ["Lead"]}, exempt=True)]
        rule = {"id": "pr-1", "kind": "presence", "persons": ["m-ana", "m-bea"], "roles": ["Sun.BGV"],
                "exclusive": False}
        _, plan = plan_of(request(s, people, rules=[rule]))
        self.assertEqual(plan.planned("m-ana", "DL"), 0)
        self.assertEqual(plan.planned("m-cris", "DL"), 2)
        self.assertEqual(plan.planned("m-ana", "P:pr-1"), 1)


class Floor(unittest.TestCase):
    def crowd(self, s, n=6):
        return [person(f"m-x{i}", {x["id"]: ["Lead"] for x in s}, exempt=True) for i in range(n)]

    def test_a_low_share_person_gets_a_floor_seat(self):
        s = sundays(1)
        ana = person("m-ana", {"s1": ["Lead"]})
        F, plan = plan_of(request(s, self.crowd(s) + [ana]))
        self.assertEqual(plan.floor_persons["2026-11"], frozenset({"m-ana"}))
        # her floor seat is set aside from s1: pool 2 - 1 = 1 over seven members
        self.assertEqual(plan.planned("m-x0", "DL"), Fraction(1, 7))

    def test_C5_15_skips_in_the_plan(self):
        s = sundays(1)
        ana = person("m-ana", {"s1": ["Lead"]})
        exact = {"id": "cap-a", "kind": "count", "person": "m-ana", "roles": ["Sun.Lead"], "op": "==",
                 "month": "2026-11", "value": 1}
        _, plan = plan_of(request(s, self.crowd(s) + [ana], rules=[exact]))
        self.assertEqual(plan.floor_persons["2026-11"], frozenset())  # a clamped == of 1
        ana_cad = person("m-ana", {"s1": ["Lead"]}, cadence={"2026-11": "on"})
        _, plan = plan_of(request(s, self.crowd(s) + [ana_cad]))
        self.assertEqual(plan.floor_persons["2026-11"], frozenset())  # an «on» month

    def test_a_received_pin_is_the_floor_seat(self):
        s = sundays(2)
        ana = person("m-ana", {"s1": ["Lead"], "s2": ["Lead"]})
        F, plan = plan_of(request(s, self.crowd(s, 10) + [ana], pins=[pin(s[1], "Lead", "m-ana")]))
        self.assertIn("m-ana", plan.floor_persons["2026-11"])
        # s2's pool loses her pinned seat: (2 - 1) / 11; s1 keeps its full pool 2 / 11
        self.assertEqual(plan.planned("m-x0", "DL"), Fraction(2, 11) + Fraction(1, 11))


class Clamps(unittest.TestCase):
    def test_exact_and_min_clamps_are_notices(self):
        s = sundays(2)
        people = lead_people(["m-ana", "m-bea"], s[:1]) + lead_people(["m-cris"], s)
        rules = [{"id": "cap-a", "kind": "count", "person": "m-ana", "roles": ["Sun.Lead"], "op": "==",
                  "month": "2026-11", "value": 2},
                 {"id": "min-c", "kind": "count", "person": "m-cris", "roles": ["Sun.Lead"], "op": ">=",
                  "month": "2026-11", "value": 3}]
        F, plan = plan_of(request(s, people, rules=rules))
        self.assertEqual([(n["code"], n["params"]["value"], n["params"]["available"]) for n in F.clamp_notices],
                         [("exact_clamped", 2, 1), ("min_clamped", 3, 2)])
        self.assertIn(("m-ana", "DL"), plan.clamped_lines)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run it to see it fail**

Run: `(cd gcf_v3 && "$PY" -m unittest tests.test_plan)`
Expected: FAIL — `ModuleNotFoundError: No module named 'owt_v3.facts'`.

- [ ] **Step 3: Implement**

**Create** `gcf_v3/owt_v3/facts.py`:

```python
"""Request facts derived once, before the model (spec §5–§6): pins, rows, cells, exact
status, clamps, presence scope, the DL line, F9/F10 instances and the formula's inputs.

Everything iterates in canonical order: services by (date, time, id), roles Lead > BGV
> Choir, people by id codepoint, rules by their request index.
"""

from collections import defaultdict

from .formula import FMonth, FPresence, FService, applying, populations, q_members
from .vocab import LINE_OF_KEY, ROLES, add_months, role_key, weekend_of


class Facts:
    def __init__(self, problem):
        P = self.P = problem
        self.months = P.months
        self.services = P.services
        self.svc = P.service_by_id
        self.people = P.people
        self.pids = P.person_ids
        self.pin_of = {}  # (sid, person) -> role
        self.pin_rows = defaultdict(list)  # (sid, role) -> [person]
        for pin in P.pins:
            self.pin_of[(pin.service, pin.person)] = pin.role
            self.pin_rows[(pin.service, pin.role)].append(pin.person)
        self.pinned = frozenset((p.service, p.role, p.person) for p in P.pins)
        self.row_size = {}
        for s in self.services:
            for role in s.roles:
                pins = len(self.pin_rows.get((s.id, role), ()))
                self.row_size[(s.id, role)] = pins if s.fixed else max(s.seats.get(role, 0), pins)
        self.cells = []
        self.cells_at = defaultdict(list)
        for s in self.services:
            for role in s.roles:
                for p in self.pids:
                    if (s.id, role, p) in self.pinned or (not s.fixed and self.eligible(p, s.id, role)):
                        self.cells.append((s.id, role, p))
                        self.cells_at[s.id].append((s.id, role, p))
        self.cell_set = frozenset(self.cells)
        self.exact = defaultdict(frozenset)  # (p, m) -> exact role keys (== value >= 1)
        for r in P.counts:
            if r.op == "==" and r.value >= 1:
                self.exact[(r.person, r.month)] = self.exact[(r.person, r.month)] | frozenset(r.roles)
        self.clamped, self.available, self.clamp_notices = {}, {}, []
        for r in P.counts:
            avail = self.available_matching(r.person, r.month, r.roles)
            self.available[r.index] = avail
            value = r.value
            if r.op in ("==", ">=") and value > avail:
                value = avail
                self.clamp_notices.append({
                    "code": "exact_clamped" if r.op == "==" else "min_clamped",
                    "params": {"rule": r.id, "person": r.person, "month": r.month,
                               "value": r.value, "available": avail}})
            self.clamped[r.index] = value
        self.fmonths = {m: self._fmonth(m) for m in self.months}
        self.fservice_base = {s.id: self._fservice(s, {}) for s in self.services}

    # ── basic predicates ────────────────────────────────────────────────────
    def eligible(self, person, sid, role):
        return role in self.people[person].eligibility.get(sid, ())

    def is_exact(self, person, month, key):
        return key in self.exact.get((person, month), ())

    def cadence_state(self, person, month):
        cad = self.people[person].cadence
        return None if cad is None else cad[month]

    def has_cadence(self, person):
        return self.people[person].cadence is not None

    def key(self, sid, role):
        return role_key(self.svc[sid].day, role)

    def line(self, sid, role):
        return LINE_OF_KEY[self.key(sid, role)]

    def is_dl_lead(self, sid, role):
        return self.key(sid, role) == "Sun.Lead"

    def available_matching(self, person, month, roles):
        """§6.7: weekend services of `month` where she could hold a matching role."""
        n = 0
        for s in self.services:
            if s.month != month or not s.weekend:
                continue
            ok = False
            for role in s.roles:
                if role_key(s.day, role) not in roles:
                    continue
                if (s.id, role, person) in self.pinned or (not s.fixed and self.eligible(person, s.id, role)):
                    ok = True
            n += 1 if ok else 0
        return n

    # ── presence scope ──────────────────────────────────────────────────────
    def presence_in(self, month):
        """The presence objects in scope in `month` (C5-16), as formula rules."""
        return tuple(
            FPresence(r.id, r.roles, r.persons, r.exclusive)
            for r in self.P.presence if r.month is None or r.month == month
        )

    def presence_rules_at(self, s):
        """Request presence objects in scope at a weekend service (instances: counted or not)."""
        if not s.weekend:
            return []
        return [r for r in self.P.presence if r.month is None or r.month == s.month]

    # ── the formula's inputs ────────────────────────────────────────────────
    def _fmonth(self, month):
        def base_in(person, fs, key):
            day, role = key.split(".")
            return (fs.day == day and role in self.people[person].eligibility.get(fs.id, ())
                    and not self.is_exact(person, month, key))
        return FMonth(
            listed=frozenset(self.pids),
            exact={p: self.exact[(p, month)] for p in self.pids if self.exact.get((p, month))},
            cadence=frozenset(p for p in self.pids if self.has_cadence(p)),
            exempt=frozenset(p for p in self.pids if self.people[p].exempt),
            presence=self.presence_in(month),
            base_in=base_in,
        )

    def _fservice(self, s, holders):
        return FService(
            id=s.id, date=s.date, time=s.time, month=s.month, day=s.day, weekend=s.weekend,
            keys=tuple(role_key(s.day, r) for r in s.roles),
            seats={role: tuple(sorted(holders.get(role, ()))) for role in s.roles},
        )

    def fservices(self, assignment):
        """The counted services as formula inputs, seats from an assignment {sid: {role: [ids]}}."""
        return [self._fservice(s, assignment.get(s.id, {})) for s in self.services if s.counts]

    def realised_populations(self, s):
        """Pop(s, k) without item 5 (a holder never holds a second seat there) and Q per rule."""
        fm, fs = self.fmonths[s.month], self.fservice_base[s.id]
        pop = populations(fm, fs)
        q = {rho.id: q_members(fm, fs, rho, a) for rho, a in applying(fm, fs)}
        return pop, q, applying(fm, fs)

    # ── the DL line, F9 and F10 (spec §6.8, §7.1) ────────────────────────────
    def on_dl_line(self, person, month):
        if self.has_cadence(person) or self.is_exact(person, month, "Sun.Lead"):
            return False
        for s in self.services:
            if s.month != month or not s.counts:
                continue
            if s.kind == "sunday" and "Lead" in self.people[person].eligibility.get(s.id, ()):
                return True
            if s.day == "Sun" and self.pin_of.get((s.id, person)) == "Lead":
                return True
        return False

    def f10_instances(self):
        """[(person, month)] per §6.8 and C5-11, skips applied."""
        out = []
        for m in self.months:
            prev = add_months(m, -1)
            for p in self.pids:
                if not self.on_dl_line(p, m):
                    continue
                since = self.people[p].dl_since
                if since is None or prev < since:
                    continue
                if prev == self.P.prior.month and not self.P.prior.has_services:
                    continue
                out.append((p, m))
        return out

    def f9_instances(self):
        out = []
        for m in self.months:
            for p in self.pids:
                if self.people[p].exempt:
                    continue
                if any(s.month == m and s.counts and (
                        self.people[p].eligibility.get(s.id) or self.pin_of.get((s.id, p)))
                        for s in self.services):
                    out.append((p, m))
        return out

    def dl_capacity(self):
        """§6.8 capacity, once per run (A19, C5-12): (seats, people, notice?)."""
        seats = sum(self.row_size[(s.id, "Lead")] for s in self.services
                    if s.counts and s.day == "Sun" and "Lead" in s.roles)
        sub = 0
        counted = set()
        for r in self.P.counts:
            if r.op == "==" and "Sun.Lead" in r.roles:
                sub += self.clamped[r.index]
                counted.add((r.person, r.month))
        for p in self.pids:
            for m in self.months:
                if self.cadence_state(p, m) == "on":
                    sub += 1
                    counted.add((p, m))
        for pin in self.P.pins:
            s = self.svc[pin.service]
            if s.counts and pin.role == "Lead" and s.day == "Sun":
                if not self.on_dl_line(pin.person, s.month) and (pin.person, s.month) not in counted:
                    sub += 1
        capacity = seats - sub
        population = set()
        for p, m in self.f10_instances():
            if m != self.months[0] or self.people[p].prev_dl_leads == 0:
                population.add(p)
        return capacity, len(population)

    # ── consecutive weekends ────────────────────────────────────────────────
    def weekend_terms(self, person, roles, counted_only=False, dl_only=False):
        """{weekend Sunday: ([horizon cells], prior constant)} for one person.

        Rules (`consecutive`) read every weekend service, counted or not, never a special;
        the protection (`no_consecutive`) reads DL-mapped leads at counted services.
        """
        out = defaultdict(lambda: ([], 0))
        for s in self.services:
            if counted_only and not s.counts:
                continue
            if not dl_only and not s.weekend:
                continue
            if dl_only and s.day != "Sun":
                continue
            w = weekend_of(s.date)
            for role in s.roles:
                k = role_key(s.day, role)
                if (dl_only and k != "Sun.Lead") or (not dl_only and k not in roles):
                    continue
                if (s.id, role, person) in self.cell_set:
                    cells, const = out[w]
                    out[w] = (cells + [(s.id, role, person)], const)
        for ps in self.P.prior.services:
            if counted_only and not ps.counts:
                continue
            if not dl_only and ps.kind == "special":
                continue
            if dl_only and ps.day != "Sun":
                continue
            w = weekend_of(ps.date)
            for role in ROLES:
                k = role_key(ps.day, role)
                if (dl_only and k != "Sun.Lead") or (not dl_only and k not in roles):
                    continue
                if person in ps.seats.get(role, ()):
                    cells, const = out[w]
                    out[w] = (cells, 1)
        return dict(out)
```

**Create** `gcf_v3/owt_v3/plan.py`:

```python
"""Planned shares (F13; spec §6.2 «F6 in the plan», §6.3 «Set-asides in the plan», §6.4
«In the plan», §6.5, C5-9, C5-15).

Fixed numbers from the request alone, computed before the solve. Nothing here reads an
assignment. Floor persons are found in a first pass without floor set-asides; shares
are then recomputed with them. Exact `Fraction`s; the caller rounds once (C5-8).

One reading the spec leaves to the plan: a pinned seat that will be a rule's presence
seat (a member's pin in one of the rule's role keys that is not a fixed seat) IS that
rule's forced presence seat, so it is removed from the pool once, not twice.
"""

from collections import defaultdict
from dataclasses import dataclass, field
from fractions import Fraction
from typing import Dict, FrozenSet, Tuple

from .vocab import LINE_OF_KEY, ROLE_RANK, role_key, seat_order_key


@dataclass
class PlanResult:
    share: Dict[Tuple[str, str, str], Fraction] = field(default_factory=lambda: defaultdict(Fraction))
    floor_persons: Dict[str, FrozenSet[str]] = field(default_factory=dict)
    in_population: set = field(default_factory=set)  # (m, p, line)
    clamped_lines: set = field(default_factory=set)  # (p, line)

    def planned(self, person, line):
        """The exact planned share of a person-line over the horizon."""
        if getattr(self, "_totals", None) is None:
            self._totals = defaultdict(Fraction)
            for (m, p, l), v in self.share.items():
                self._totals[(p, l)] += v
        return self._totals.get((person, line), Fraction(0))


def _spread(sa, services_roles, amount):
    """Spread `amount` evenly over services, then equally over each service's keys."""
    if amount <= 0 or not services_roles:
        return
    per_service = Fraction(amount) / len(services_roles)
    for sid, keys in services_roles:
        for k in keys:
            sa[(sid, k)] += per_service / len(keys)


def compute_plan(F):
    P = F.P
    res = PlanResult()
    counted = [s for s in F.services if s.counts]
    pop, q, sub_pool, rules_at = {}, {}, {}, {}
    # ── decided seats (F6 in the plan): pins, and exact rules with no slack ──
    decided = defaultdict(set)  # (sid, p) -> role keys she is decided to hold there
    for (sid, p), role in F.pin_of.items():
        decided[(sid, p)].add(F.key(sid, role))
    for r in P.counts:
        c = F.clamped[r.index]
        if r.op != "==" or c < 1 or c != F.available[r.index]:
            continue
        for s in F.services:
            if s.month != r.month or not s.weekend:
                continue
            keys = {role_key(s.day, role) for role in s.roles
                    if role_key(s.day, role) in r.roles and (s.id, role, r.person) in F.cell_set}
            if keys and (s.id, r.person) not in F.pin_of:
                decided[(s.id, r.person)] |= keys
    # ── populations ───────────────────────────────────────────────────────
    for s in counted:
        base_pop, base_q, rules = F.realised_populations(s)
        rules_at[s.id] = rules
        for role in s.roles:
            k = s.key(role)
            pop[(s.id, k)] = tuple(
                p for p in base_pop.get(k, ())
                if not decided.get((s.id, p)) or k in decided[(s.id, p)])
            for p in pop[(s.id, k)]:
                res.in_population.add((s.month, p, LINE_OF_KEY[k]))
        for rho, _ in rules:
            q[(s.id, rho.id)] = base_q[rho.id]
            for p in base_q[rho.id]:
                res.in_population.add((s.month, p, f"P:{rho.id}"))
    # ── set-asides that do not depend on floor persons ─────────────────────
    sa = defaultdict(Fraction)  # (sid, key) -> seats
    received_pins = defaultdict(list)  # (m, p) -> [(order, sid, key, kind, rho_id)]
    fixed_pin = set()  # (m, p) holding a pinned seat set aside (a) exact or (b) cadence
    for s in counted:
        fm = F.fmonths[s.month]
        consumed = set()
        for rho, a in rules_at[s.id]:
            cands = sorted(
                (ROLE_RANK[role], p, role)
                for role in s.roles for p in F.pin_rows.get((s.id, role), ())
                if s.key(role) in a and p in rho.members
                and not fm.is_fixed_seat(p, s.key(role)) and (role, p) not in consumed)
            if cands:
                _, p, role = cands[0]
                consumed.add((role, p))
                sa[(s.id, s.key(role))] += 1
                live = p in q[(s.id, rho.id)]
                sub_pool[(s.id, rho.id)] = 1 if live else 0
                if live:
                    received_pins[(s.month, p)].append(
                        (seat_order_key(s.date, role, s.time, s.id), s.id, s.key(role), "presence", rho.id))
            elif s.fixed:
                sub_pool[(s.id, rho.id)] = 0  # a fixed service holds exactly its pins: no seat can be forced
            else:
                keys = [k for k in a if any(fm.base_in(m, F.fservice_base[s.id], k) for m in q[(s.id, rho.id)])]
                for k in keys:
                    sa[(s.id, k)] += Fraction(1, len(keys))
                sub_pool[(s.id, rho.id)] = 1 if keys else 0
        for role in s.roles:
            k = s.key(role)
            for p in F.pin_rows.get((s.id, role), ()):
                if fm.is_fixed_seat(p, k):
                    fixed_pin.add((s.month, p))
                if (role, p) in consumed:
                    continue
                if p not in pop[(s.id, k)]:
                    sa[(s.id, k)] += 1
                else:
                    received_pins[(s.month, p)].append(
                        (seat_order_key(s.date, role, s.time, s.id), s.id, k, "normal", None))
    # monthly set-asides (C5-9): exact counts, then cadence Sundays
    for r in P.counts:
        if r.op != "==":
            continue
        c = F.clamped[r.index]
        if c < r.value:
            for k in r.roles:
                res.clamped_lines.add((r.person, LINE_OF_KEY[k]))
        pinned = sum(1 for pin in P.pins if pin.person == r.person and F.svc[pin.service].month == r.month
                     and F.svc[pin.service].weekend and F.key(pin.service, pin.role) in r.roles)
        targets = []
        for s in F.services:
            if s.month != r.month or not s.weekend or s.fixed or (s.id, r.person) in F.pin_of:
                continue
            keys = [s.key(role) for role in s.roles
                    if s.key(role) in r.roles and F.eligible(r.person, s.id, role)]
            if keys:
                targets.append((s.id, keys))
        _spread(sa, targets, max(0, c - pinned))
    for p in F.pids:
        for m in F.months:
            if F.cadence_state(p, m) != "on":
                continue
            pinned = sum(1 for pin in P.pins if pin.person == p and pin.role == "Lead"
                         and F.svc[pin.service].month == m and F.svc[pin.service].counts
                         and F.svc[pin.service].day == "Sun")
            targets = [(s.id, ["Sun.Lead"]) for s in counted
                       if s.month == m and s.kind == "sunday" and not s.fixed
                       and (s.id, p) not in F.pin_of and F.eligible(p, s.id, "Lead")]
            _spread(sa, targets, max(0, 1 - pinned))

    def shares(extra_sa, dropped_sub):
        out = defaultdict(Fraction)
        for s in counted:
            for role in s.roles:
                k = s.key(role)
                members = pop[(s.id, k)]
                base = F.row_size[(s.id, role)]
                pool = max(Fraction(0), base - sa[(s.id, k)] - extra_sa[(s.id, k)])
                for p in members:
                    out[(s.month, p, LINE_OF_KEY[k])] += pool / len(members)
            for rho, _ in rules_at[s.id]:
                members = q[(s.id, rho.id)]
                if members and sub_pool.get((s.id, rho.id)) and (s.id, rho.id) not in dropped_sub:
                    for p in members:
                        out[(s.month, p, f"P:{rho.id}")] += Fraction(1, len(members))
        return out

    first = shares(defaultdict(Fraction), set())
    # ── floor persons (§6.4 «In the plan», C5-15) ─────────────────────────
    plan_fixed = set(fixed_pin)
    for r in P.counts:
        if r.op == "==" and F.clamped[r.index] >= 1:
            plan_fixed.add((r.month, r.person))
    for p in F.pids:
        for m in F.months:
            if F.cadence_state(p, m) == "on":
                plan_fixed.add((m, p))
    floor_sa, dropped_sub = defaultdict(Fraction), set()
    for m in F.months:
        persons = set()
        for p in F.pids:
            if F.people[p].exempt or (m, p) in plan_fixed:
                continue
            if not any(mm == m and pp == p for (mm, pp, _) in res.in_population):
                continue
            total = sum((v for (mm, pp, _), v in first.items() if mm == m and pp == p), Fraction(0))
            if total < 1:
                persons.add(p)
        res.floor_persons[m] = frozenset(persons)
        for p in sorted(persons):
            if received_pins.get((m, p)):
                _, sid, k, kind, rho_id = min(received_pins[(m, p)])
                if kind == "presence":
                    dropped_sub.add((sid, rho_id))
                else:
                    floor_sa[(sid, k)] += 1
                continue
            targets = []
            for s in counted:
                if s.month != m or s.fixed or (s.id, p) in F.pin_of:
                    continue
                keys = [s.key(role) for role in s.roles if F.eligible(p, s.id, role)]
                if keys:
                    targets.append((s.id, keys))
            _spread(floor_sa, targets, 1)
    res.share = shares(floor_sa, dropped_sub)
    return res
```

- [ ] **Step 4: Run the suite and the layout guard**

Run: `"$PY" -m unittest discover -s gcf_v3 -t gcf_v3 2>&1 | tail -3 && npx vitest run scripts/__tests__/ciLayout.test.ts 2>&1 | tail -4`
Expected: `Ran 66 tests … OK`; `Tests  51 passed (51)`.

- [ ] **Step 5: Commit**

```bash
git add gcf_v3/owt_v3/facts.py gcf_v3/owt_v3/plan.py gcf_v3/tests/builders.py gcf_v3/tests/test_plan.py
git commit -m "feat(solver-v3): request facts and planned shares (F13)" -m "Planned shares are fixed numbers from the request alone (F13): grown rows or pin counts as the base, F6 for pins and for exact rules with no slack, the forced presence seat (a member's pin is that seat, counted once), monthly set-asides placed by C5-9, and floor persons found without floor set-asides and then applied (C5-15 in the plan). Facts derives everything the model, the plan and the report share, once and in canonical order."
```

---

## Task 6: Rule instances, clamps and causes

Spec §5.4 instances, §6.7 (soft families, clamps, `presence_not_applicable`, no possible lead), C5-3 (rules see every weekend service, never a special), C5-6, §8.1 `violations` causes; §12.1 «Model contracts» (each clamp notice; a special never in a rule instance; `consecutive` across the month boundary and against `prior`).

**Files:**
- Create: `gcf_v3/owt_v3/instances.py`, `gcf_v3/tests/test_instances.py`

**Interfaces:**
- Consumes: `Facts` (Task 5).
- Produces: `Instance(family, rule, terms, terms_b, const_a, const_b, op, limit, person, persons, month, service, weekends, extra)` with `.observed(assigned)`, `.broken(assigned) -> bool` (`assigned` a set of cells); `build_instances(F) -> (instances, notices)` (canonical order: counts, pairs, presence, consecutive, mandatory leads); `cause(F, inst) -> "pins" | "forced"`; `violation_entry(F, inst, assigned) -> dict` (the §8.1 entry).

- [ ] **Step 1: Write the failing test**

**Create** `gcf_v3/tests/test_instances.py`:

```python
"""Rule instances, clamps and causes, built from the request alone (spec §5.4, §6.7, §8.1)."""

import unittest

from owt_v3.facts import Facts
from owt_v3.instances import build_instances, cause
from owt_v3.request import parse_request
from tests.builders import NOV_SATURDAYS, NOV_SUNDAYS, person, pin, request, service

ROLES3 = ["Lead", "BGV", "Choir"]


def built(body):
    F = Facts(parse_request(body))
    instances, notices = build_instances(F)
    return F, instances, notices


def of(instances, family):
    return [i for i in instances if i.family == family]


def everyone(svcs, ids, roles=ROLES3):
    return [person(p, {s["id"]: [r for r in roles if not (r == "Choir" and s["kind"] == "saturday")]
                       for s in svcs}, exempt=True) for p in ids]


class Counts(unittest.TestCase):
    def test_one_instance_per_rule_and_month_with_clamped_values(self):
        svcs = [service("n1", NOV_SUNDAYS[0]), service("d1", "2026-12-06")]
        people = [person("m-ana", {"n1": ["Lead"]}, exempt=True), person("m-bea", {"d1": ["Lead"]}, exempt=True)]
        rules = [{"id": "cap-a", "kind": "count", "person": "m-ana", "roles": ["Sun.Lead"], "op": "==",
                  "month": m, "value": 2} for m in ("2026-11", "2026-12")]
        F, inst, _ = built(request(svcs, people, rules=rules, months=["2026-11", "2026-12"]))
        self.assertEqual([(i.month, i.limit, len(i.terms)) for i in of(inst, "count")],
                         [("2026-11", 1, 1), ("2026-12", 0, 0)])
        self.assertEqual([(n["code"], n["params"]["month"], n["params"]["available"]) for n in F.clamp_notices],
                         [("exact_clamped", "2026-11", 1), ("exact_clamped", "2026-12", 0)])

    def test_a_fixed_service_counts_only_where_she_is_pinned(self):
        fx = service("fx", NOV_SUNDAYS[1], fixed=True)
        svcs = [service("n1", NOV_SUNDAYS[0]), fx]
        people = [person("m-ana", {"n1": ["Lead"], "fx": ["Lead"]}, exempt=True)]
        rules = [{"id": "min-a", "kind": "count", "person": "m-ana", "roles": ["Sun.Lead"], "op": ">=",
                  "month": "2026-11", "value": 2}]
        F, inst, _ = built(request(svcs, people, rules=rules))
        self.assertEqual(F.available[0], 1)
        F, inst, _ = built(request(svcs, people, rules=rules, pins=[pin(fx, "Lead", "m-ana")]))
        self.assertEqual(F.available[0], 2)


class Presence(unittest.TestCase):
    def test_no_member_able_to_hold_it_means_a_notice_not_an_instance(self):
        svcs = [service("n1", NOV_SUNDAYS[0])]
        people = [person("m-ana", {}, exempt=True), person("m-bea", {"n1": ["Lead"]}, exempt=True)]
        rules = [{"id": "pr-1", "kind": "presence", "persons": ["m-ana"], "roles": ["Sun.BGV"], "exclusive": False}]
        _, inst, notices = built(request(svcs, people, rules=rules))
        self.assertEqual(of(inst, "presence"), [])
        self.assertEqual(notices, [{"code": "presence_not_applicable", "params": {"rule": "pr-1", "service": "n1"}}])

    def test_a_fixed_service_without_the_member_pinned_is_broken_by_its_pins(self):
        fx = service("fx", NOV_SUNDAYS[0], fixed=True)
        people = [person("m-ana", {"fx": ["BGV"]}, exempt=True), person("m-bea", {"fx": ["BGV"]}, exempt=True)]
        rules = [{"id": "pr-1", "kind": "presence", "persons": ["m-ana"], "roles": ["Sun.BGV"], "exclusive": False}]
        F, inst, _ = built(request([fx], people, rules=rules, pins=[pin(fx, "BGV", "m-bea")]))
        [i] = of(inst, "presence")
        self.assertTrue(i.broken(frozenset(F.pinned)))
        self.assertEqual(cause(F, i), "pins")

    def test_a_fixed_seat_still_satisfies_the_soft_presence_instance(self):
        svcs = [service("n1", NOV_SUNDAYS[0])]
        people = [person("m-ana", {"n1": ["BGV"]}, exempt=True), person("m-bea", {"n1": ["BGV"]}, exempt=True)]
        rules = [{"id": "pr-1", "kind": "presence", "persons": ["m-ana"], "roles": ["Sun.BGV"], "exclusive": False},
                 {"id": "cap-a", "kind": "count", "person": "m-ana", "roles": ["Sun.BGV"], "op": "==",
                  "month": "2026-11", "value": 1}]
        F, inst, _ = built(request(svcs, people, rules=rules, pins=[pin(svcs[0], "BGV", "m-ana")]))
        [i] = of(inst, "presence")
        self.assertFalse(i.broken(frozenset(F.pinned)))  # her exact seat is never the presence SEAT, but counts here

    def test_a_saturday_is_out_of_a_sunday_rule(self):
        svcs = [service("t1", NOV_SATURDAYS[0], kind="saturday")]
        rules = [{"id": "pr-1", "kind": "presence", "persons": ["m-ana"], "roles": ["Sun.BGV"], "exclusive": False}]
        _, inst, notices = built(request(svcs, everyone(svcs, ["m-ana", "m-bea"]), rules=rules))
        self.assertEqual((of(inst, "presence"), notices), ([], []))


class PairsSpecialsAndCounted(unittest.TestCase):
    def test_a_pair_needs_a_term_for_both(self):
        svcs = [service("n1", NOV_SUNDAYS[0]), service("n2", NOV_SUNDAYS[1])]
        people = [person("m-ana", {"n1": ["Lead"], "n2": ["Lead"]}, exempt=True),
                  person("m-bea", {"n1": ["Lead"]}, exempt=True)]
        rules = [{"id": "cf-1", "kind": "pair", "persons": ["m-ana", "m-bea"], "roles": ["Sun.Lead"]}]
        _, inst, _ = built(request(svcs, people, rules=rules))
        self.assertEqual([i.service for i in of(inst, "pair")], ["n1"])

    def test_specials_never_and_uncounted_weekends_always(self):
        sp = service("sp", NOV_SUNDAYS[1], kind="special", fixed=True)
        svcs = [service("n1", NOV_SUNDAYS[0], counts=False), sp]
        people = [person("m-ana", {"n1": ["Lead"], "sp": ["Lead"]}, exempt=True)]
        rules = [{"id": "cap-a", "kind": "count", "person": "m-ana", "roles": ["Sun.Lead"], "op": "<=",
                  "month": "2026-11", "value": 0}]
        F, inst, _ = built(request(svcs, people, rules=rules, pins=[pin(sp, "Lead", "m-ana")]))
        [count] = of(inst, "count")
        self.assertEqual([c[0] for c in count.terms], ["n1"])  # the uncounted weekend service, not the special
        self.assertEqual([i.service for i in of(inst, "mandatory_lead")], ["n1"])

    def test_no_possible_lead_means_no_mandatory_lead_instance(self):
        svcs = [service("n1", NOV_SUNDAYS[0])]
        _, inst, _ = built(request(svcs, [person("m-ana", {"n1": ["BGV"]}, exempt=True)]))
        self.assertEqual(of(inst, "mandatory_lead"), [])


class Consecutive(unittest.TestCase):
    def rule(self):
        return [{"id": "cs-1", "kind": "consecutive", "person": "m-ana", "roles": ["Sun.Lead", "Sat.Lead"]}]

    def test_weekends_link_across_the_month_boundary_and_the_prior(self):
        svcs = [service("o31", "2026-10-31", kind="saturday"), service("n1", NOV_SUNDAYS[0]),
                service("n8", NOV_SUNDAYS[1])]
        prior = {"month": "2026-09", "has_services": True, "services": [
            {"date": "2026-09-27", "kind": "sunday", "counts": True, "seats": {"Lead": ["m-ana"]}}]}
        body = request(svcs, everyone(svcs, ["m-ana"], ["Lead"]), rules=self.rule(), months=["2026-10", "2026-11"],
                       prior=prior)
        _, inst, _ = built(body)
        [i] = of(inst, "consecutive")  # Sep 27 has no neighbour seven days on
        self.assertEqual(i.weekends, ("2026-11-01", "2026-11-08"))
        self.assertEqual(sorted(c[0] for c in i.terms), ["n1", "o31"])  # Oct 31 is Nov 1's weekend

    def test_a_prior_seat_pairs_with_the_first_weekend(self):
        svcs = [service("n1", NOV_SUNDAYS[0])]
        prior = {"month": "2026-10", "has_services": True, "services": [
            {"date": "2026-10-25", "kind": "sunday", "counts": True, "seats": {"Lead": ["m-ana"]}}]}
        F, inst, _ = built(request(svcs, everyone(svcs, ["m-ana"], ["Lead"]), rules=self.rule(), prior=prior,
                                   pins=[pin(svcs[0], "Lead", "m-ana")]))
        [i] = of(inst, "consecutive")
        self.assertEqual((i.weekends, i.const_a), (("2026-10-25", "2026-11-01"), 1))
        self.assertTrue(i.broken(frozenset(F.pinned)))
        self.assertEqual(cause(F, i), "pins")


class Causes(unittest.TestCase):
    def test_pins_versus_forced(self):
        svcs = [service("n1", NOV_SUNDAYS[0], seats={"Lead": 2, "BGV": 0, "Choir": 0})]
        people = everyone(svcs, ["m-ana", "m-bea", "m-cris"], ["Lead"])
        rules = [{"id": "cf-1", "kind": "pair", "persons": ["m-ana", "m-bea"], "roles": ["Sun.Lead"]}]
        F, inst, _ = built(request(svcs, people, rules=rules,
                                   pins=[pin(svcs[0], "Lead", "m-ana"), pin(svcs[0], "Lead", "m-bea")]))
        self.assertEqual(cause(F, of(inst, "pair")[0]), "pins")
        F, inst, _ = built(request(svcs, people, rules=rules))
        self.assertEqual(cause(F, of(inst, "pair")[0]), "forced")

    def test_a_member_pinned_in_another_role_is_a_pin_cause(self):
        svcs = [service("n1", NOV_SUNDAYS[0])]
        people = [person("m-ana", {"n1": ["Lead", "BGV"]}, exempt=True)]
        rules = [{"id": "pr-1", "kind": "presence", "persons": ["m-ana"], "roles": ["Sun.BGV"], "exclusive": False}]
        F, inst, _ = built(request(svcs, people, rules=rules, pins=[pin(svcs[0], "Lead", "m-ana")]))
        [i] = of(inst, "presence")
        self.assertEqual(cause(F, i), "pins")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run it to see it fail**

Run: `(cd gcf_v3 && "$PY" -m unittest tests.test_instances)`
Expected: FAIL — `ModuleNotFoundError: No module named 'owt_v3.instances'`.

- [ ] **Step 3: Implement**

**Create** `gcf_v3/owt_v3/instances.py`:

```python
"""Rule instances (spec §5.4, §6.7; F15): one soft instance per rule scope, each with one
violation boolean in the model and a re-evaluation from the assignment for the report.

Rules see every weekend service, counted or not, and never a special (C5-3). Clamps
are applied before the solve (`Facts.clamped`); a presence rule with no member able to
hold a matching role at a service has no instance there and a notice instead.
"""

from dataclasses import dataclass, field
from typing import Optional, Tuple

from .vocab import add_days, role_key


@dataclass
class Instance:
    family: str  # count | pair | presence | consecutive | mandatory_lead
    rule: str  # the request rule id, or "mandatory_lead"
    terms: Tuple = ()  # cells; for consecutive, the first weekend's cells
    terms_b: Tuple = ()  # consecutive: the second weekend's cells
    const_a: int = 0  # consecutive: prior constants
    const_b: int = 0
    op: Optional[str] = None
    limit: Optional[int] = None
    person: Optional[str] = None
    persons: Optional[Tuple[str, ...]] = None
    month: Optional[str] = None
    service: Optional[str] = None
    weekends: Optional[Tuple[str, str]] = None
    extra: dict = field(default_factory=dict)

    def observed(self, assigned):
        return sum(1 for c in self.terms if c in assigned)

    def broken(self, assigned):
        n = self.observed(assigned)
        if self.family == "count":
            return {"==": n != self.limit, "<=": n > self.limit, ">=": n < self.limit}[self.op]
        if self.family == "pair":
            return n >= 2
        if self.family in ("presence", "mandatory_lead"):
            return n == 0
        b = sum(1 for c in self.terms_b if c in assigned)
        return (n + self.const_a) >= 1 and (b + self.const_b) >= 1


def build_instances(F):
    """Every instance in a canonical order, plus presence_not_applicable notices."""
    P = F.P
    out, notices = [], []
    for r in P.counts:
        terms = tuple(c for c in F.cells if F.svc[c[0]].month == r.month and F.svc[c[0]].weekend
                      and c[2] == r.person and F.key(c[0], c[1]) in r.roles)
        out.append(Instance("count", r.id, terms, op=r.op, limit=F.clamped[r.index],
                            person=r.person, month=r.month))
    for r in P.pairs:
        for s in F.services:
            if not s.weekend or (r.month is not None and s.month != r.month):
                continue
            ta = [c for c in F.cells_at[s.id] if c[2] == r.persons[0] and F.key(s.id, c[1]) in r.roles]
            tb = [c for c in F.cells_at[s.id] if c[2] == r.persons[1] and F.key(s.id, c[1]) in r.roles]
            if ta and tb:
                out.append(Instance("pair", r.id, tuple(ta + tb), persons=tuple(r.persons),
                                    service=s.id, month=s.month))
    for r in P.presence:
        for s in F.services:
            if not s.weekend or (r.month is not None and s.month != r.month):
                continue
            if not any(role_key(s.day, role) in r.roles for role in s.roles):
                continue
            terms = tuple(c for c in F.cells_at[s.id] if c[2] in r.persons and F.key(s.id, c[1]) in r.roles)
            eligible = any(F.eligible(p, s.id, role) for p in r.persons for role in s.roles
                           if role_key(s.day, role) in r.roles)
            if not terms and not eligible:
                notices.append({"code": "presence_not_applicable", "params": {"rule": r.id, "service": s.id}})
                continue
            # At a fixed service a member's eligibility gives her no seat: the stored seats (pins) decide.
            out.append(Instance("presence", r.id, terms, persons=tuple(r.persons), service=s.id, month=s.month,
                                extra={"fixed": s.fixed}))
    for r in P.consecutive:
        weeks = F.weekend_terms(r.person, r.roles)
        for w in sorted(weeks):
            nxt = add_days(w, 7)
            if nxt not in weeks:
                continue
            (ca, ka), (cb, kb) = weeks[w], weeks[nxt]
            if not (ca or cb):
                continue  # both weekends entirely before the horizon
            if (ca or ka) and (cb or kb):
                out.append(Instance("consecutive", r.id, tuple(ca), tuple(cb), ka, kb,
                                    person=r.person, weekends=(w, nxt)))
    for s in F.services:
        if s.fixed or not s.weekend or "Lead" not in s.roles:
            continue
        terms = tuple(c for c in F.cells_at[s.id] if c[1] == "Lead")
        if terms:
            out.append(Instance("mandatory_lead", "mandatory_lead", terms, service=s.id, month=s.month))
    return out, notices


def _possible(F, cell):
    """An unpinned cell that pins alone do not rule out (person free at the service, room in the row)."""
    sid, role, p = cell
    if (sid, p) in F.pin_of:
        return False
    return F.row_size[(sid, role)] - len(F.pin_rows.get((sid, role), ())) > 0


def _blocked_by_pin(F, cell):
    sid, role, p = cell
    if cell in F.pinned:
        return False
    row_full_of_pins = bool(F.pin_rows.get((sid, role))) and (
        F.row_size[(sid, role)] - len(F.pin_rows[(sid, role)]) <= 0)
    return (sid, p) in F.pin_of or row_full_of_pins


def cause(F, inst):
    """`pins` when the pinned seats and the prior constants alone break the instance (§8.1)."""
    pinned = [c for c in inst.terms if c in F.pinned]
    lo = len(pinned) + inst.const_a
    possible = {(c[0], c[2]) for c in inst.terms if c not in F.pinned and _possible(F, c)}
    hi = lo + len(possible)
    involved = lo > 0 or any(_blocked_by_pin(F, c) for c in inst.terms)
    if inst.family == "count":
        lim = inst.limit
        alone = {"==": lo > lim or hi < lim, "<=": lo > lim, ">=": hi < lim}[inst.op]
    elif inst.family == "pair":
        alone = lo >= 2
    elif inst.family in ("presence", "mandatory_lead"):
        alone = hi == 0
        involved = involved or bool(inst.extra.get("fixed"))
    else:
        lo_b = sum(1 for c in inst.terms_b if c in F.pinned) + inst.const_b
        alone = lo >= 1 and lo_b >= 1
        involved = involved or lo_b > 0
    return "pins" if alone and involved else "forced"


def violation_entry(F, inst, assigned):
    entry = {"code": inst.family, "rule": inst.rule, "cause": cause(F, inst)}
    if inst.family == "count":
        entry.update(person=inst.person, month=inst.month, observed=inst.observed(assigned), limit=inst.limit)
    elif inst.family in ("pair", "presence"):
        entry.update(persons=list(inst.persons), service=inst.service, month=inst.month)
    elif inst.family == "consecutive":
        entry.update(person=inst.person, weekends=list(inst.weekends))
    else:
        entry.update(service=inst.service, month=inst.month)
    return entry
```

- [ ] **Step 4: Run the suite and the layout guard**

Run: `"$PY" -m unittest discover -s gcf_v3 -t gcf_v3 2>&1 | tail -3 && npx vitest run scripts/__tests__/ciLayout.test.ts 2>&1 | tail -4`
Expected: `Ran 79 tests … OK`; `Tests  51 passed (51)`.

- [ ] **Step 5: Commit**

```bash
git add gcf_v3/owt_v3/instances.py gcf_v3/tests/test_instances.py
git commit -m "feat(solver-v3): soft rule instances, clamps and causes (F15)" -m "Every rule is soft per instance (count per month, pair and presence per weekend service, consecutive per weekend pair, the mandatory lead per board service where a lead is possible). Instances never include a special and do include uncounted weekend services (C5-3). A clamp is a notice, not a break; a break's cause is pins when the pinned seats and the prior alone produce it."
```

---

## Task 7: The response sections

Spec §8.1 (assignments, `unfilled` reasons, handshake, violations, cadence, missed codes and causes, notices), §8.2 (lines, tenths, seat counts, tabs, `TOTAL` absent for an exempt person), C5-7, C5-8, A32, A39; §12.1 «Model contracts» (seat counts; display tenths; display tabs; the `after` identity).

**Files:**
- Create: `gcf_v3/owt_v3/report.py`, `gcf_v3/tests/test_report.py`

**Interfaces:**
- Consumes: `Facts` (Task 5), `compute_plan` (Task 5), `build_instances`/`violation_entry` (Task 6), `realised` (Task 4), `rounding` (Task 2), `codes.code` (Task 1).
- Produces: `assignment_of(F, values) -> {sid: {role: [ids]}}`; `Report(F, plan, instances, notices, records, values, ceiling)` with `.assignment`, `.assigned`, `.status`, `.notices`, `.real` and methods `unfilled()`, `violations()`, `cadence()`, `missed()`, `fairness()`, `pins()`; pure `line_figures(carried, share, seats, pinned_seats, set_aside_seats, planned, in_stage, clamped) -> dict` and `tab_figures(lines, exact_shares, exempt) -> dict`.

- [ ] **Step 1: Write the failing test**

**Create** `gcf_v3/tests/test_report.py`:

```python
"""The response sections (spec §8.1–§8.2, S4; C5-7, C5-8, A17, A32, A39), on hand-made
assignments — nothing is solved here, so every expected figure is checked by hand."""

import unittest
from fractions import Fraction

from owt_v3.codes import audit_response
from owt_v3.facts import Facts
from owt_v3.instances import build_instances
from owt_v3.plan import compute_plan
from owt_v3.report import Report, line_figures, tab_figures
from owt_v3.request import parse_request
from tests.builders import NOV_SATURDAYS, NOV_SUNDAYS, person, pin, request, service

STAGES = ("rules", "fill", "cadence", "compensation", "voice_floor", "dl_floor", "sunday_cap", "saturday_cap",
          "no_consecutive")


def records(status=None):
    status = status or {}
    return [{"id": s, "status": status.get(s, "proven"), "value": 0, "bound": 0, "limit": "none", "ms": 0,
             "det_milli": 0} for s in STAGES]


def report(body, seated, ceiling=0, status=None):
    """A Report for a hand-made assignment: `seated` is [(service id, role, person)]."""
    F = Facts(parse_request(body))
    plan = compute_plan(F)
    instances, notices = build_instances(F)
    values = {c: 1 if c in set(seated) | F.pinned else 0 for c in F.cells}
    return Report(F, plan, instances, notices, records(status), values, ceiling)


def fig(share, carried=0, seats=0, pinned=0):
    return line_figures(carried=carried, share=share, seats=seats, pinned_seats=pinned, set_aside_seats=0,
                        planned=share, in_stage=True, clamped=False)


class LineFigures(unittest.TestCase):
    def test_tenths_are_rounded_from_the_rational(self):
        f = fig(Fraction(11, 17))
        self.assertEqual((f["share"], f["tenths"]["share"]), (65, 6))
        f = fig(Fraction(9, 26), carried=30)
        self.assertEqual((f["after"], f["tenths"]["after"]), (65, 6))
        self.assertEqual(fig(Fraction(65, 100))["tenths"]["share"], 7)
        self.assertEqual(fig(Fraction(-65, 100))["tenths"]["share"], -7)

    def test_the_after_identity_and_seat_counts(self):
        f = fig(Fraction(1, 8), carried=20, seats=3, pinned=1)
        self.assertEqual(f["after"], f["carried"] + f["share"] - f["received"])
        self.assertEqual((f["received"], f["seats"], f["pinned"], f["pinned_seats"]), (300, 3, 100, 1))


class Tabs(unittest.TestCase):
    def test_a_folded_tab_rounds_its_exact_sum_once(self):
        lines = {"BGV": fig(Fraction(7, 50)), "P:pr-1": fig(Fraction(7, 50))}
        tabs = tab_figures(lines, {"BGV": Fraction(7, 50), "P:pr-1": Fraction(7, 50)}, exempt=False)
        self.assertEqual(tabs["BGV"]["tenths"]["share"], 3)  # 0.28, not the lines' 1 + 1
        lines = {"BGV": fig(Fraction(49, 200)), "P:pr-1": fig(Fraction(1, 250))}
        tabs = tab_figures(lines, {"BGV": Fraction(49, 200), "P:pr-1": Fraction(1, 250)}, exempt=False)
        self.assertEqual((tabs["BGV"]["share"], tabs["BGV"]["tenths"]["share"]), (25, 2))  # 0.249

    def test_total_sums_every_line_and_is_absent_for_an_exempt_person(self):
        shares = {"DL": Fraction(1, 3), "SL": Fraction(1, 3), "CORO": Fraction(1, 3)}
        lines = {k: fig(v, seats=1, pinned=1 if k == "DL" else 0) for k, v in shares.items()}
        tabs = tab_figures(lines, shares, exempt=False)
        self.assertEqual((tabs["TOTAL"]["share"], tabs["TOTAL"]["seats"], tabs["TOTAL"]["pinned_seats"]), (100, 3, 1))
        self.assertEqual(tabs["DL"]["share"], lines["DL"]["share"])
        self.assertEqual(tabs["TOTAL"]["after"], tabs["TOTAL"]["carried"] + tabs["TOTAL"]["share"] - 300)
        folded = tab_figures({"BGV": fig(Fraction(1, 2), seats=2, pinned=1), "P:pr-1": fig(Fraction(1, 2), seats=1)},
                             {"BGV": Fraction(1, 2), "P:pr-1": Fraction(1, 2)}, exempt=False)
        self.assertEqual((folded["BGV"]["seats"], folded["BGV"]["pinned_seats"], folded["BGV"]["received"]), (3, 1, 300))
        exempt = tab_figures(lines, shares, exempt=True)
        self.assertNotIn("TOTAL", exempt)
        self.assertEqual(set(exempt), {"DL", "SL", "CORO"})


class Fairness(unittest.TestCase):
    def test_a_line_appears_for_population_carried_or_received_only(self):
        s = [service("s1", NOV_SUNDAYS[0], seats={"Lead": 1, "BGV": 0, "Choir": 0})]
        people = [person("m-ana", {"s1": ["Lead"]}, exempt=True),
                  person("m-bea", {}, exempt=True, carried={"SL": -40, "P:old-1": 25}),
                  person("m-cris", {}, exempt=True)]
        r = report(request(s, people, pins=[pin(s[0], "Choir", "m-cris")]), [("s1", "Lead", "m-ana")])
        fair = r.fairness()
        lines = {p["person"]: p["lines"] for p in fair["people"]}
        self.assertEqual(sorted(lines["m-ana"]), ["DL"])
        self.assertEqual(sorted(lines["m-bea"]), ["P:old-1", "SL"])  # carried-only, a P: key with no rule too
        self.assertEqual(lines["m-cris"], {})  # her pinned Choir seat is set aside: not in any population
        self.assertEqual(fair["lines"], ["DL", "SL", "BGV", "CORO"])
        self.assertEqual(lines["m-ana"]["DL"]["share"], 100)
        self.assertEqual(lines["m-ana"]["DL"]["after"], 0)

    def test_pinned_seats_are_counted_and_seat_identities_hold(self):
        s = [service("s1", NOV_SUNDAYS[0]), service("s2", NOV_SUNDAYS[1])]
        people = [person(p, {"s1": ["Lead", "BGV", "Choir"], "s2": ["Lead", "BGV", "Choir"]}, exempt=True)
                  for p in ("m-ana", "m-bea", "m-cris")]
        seated = [("s1", "Lead", "m-ana"), ("s2", "BGV", "m-ana"), ("s1", "Choir", "m-bea")]
        r = report(request(s, people, pins=[pin(s[1], "BGV", "m-ana")]), seated)
        ana = [p for p in r.fairness()["people"] if p["person"] == "m-ana"][0]
        self.assertEqual((ana["lines"]["BGV"]["seats"], ana["lines"]["BGV"]["pinned_seats"]), (1, 1))
        self.assertEqual((ana["tabs"]["BGV"]["received"], ana["tabs"]["BGV"]["pinned_seats"]), (100, 1))
        self.assertNotIn("TOTAL", ana["tabs"])  # she is exempt
        for f in list(ana["lines"].values()) + list(ana["tabs"].values()):
            self.assertEqual(f["after"], f["carried"] + f["share"] - f["received"])
            self.assertEqual((f["seats"] * 100, f["pinned_seats"] * 100), (f["received"], f["pinned"]))


class Sections(unittest.TestCase):
    def test_cadence_outcomes(self):
        s = [service("s1", NOV_SUNDAYS[0], seats={"Lead": 1, "BGV": 0, "Choir": 0}),
             service("t1", NOV_SATURDAYS[0], kind="saturday", seats={"Lead": 1, "BGV": 0})]
        people = [person("m-ana", {"s1": ["Lead"], "t1": ["Lead"]}, cadence={"2026-11": "off"}, exempt=True),
                  person("m-bea", {"s1": ["Lead"]}, exempt=True, dl_since=None)]
        r = report(request(s, people), [("s1", "Lead", "m-bea"), ("t1", "Lead", "m-ana")])
        self.assertEqual(r.cadence(), [{"person": "m-ana", "month": "2026-11", "state": "off", "sundays": 0,
                                        "saturdays": 1, "met": True, "compensation": "given"}])
        r = report(request(s, people), [("s1", "Lead", "m-ana")])
        self.assertEqual(r.cadence()[0]["compensation"], "not_applicable")  # she led a Sunday (X2)
        self.assertEqual([(m["code"], m["cause"]) for m in r.missed()], [("cadence_off_led", "higher_priority")])

    def test_unfilled_reasons(self):
        s = [service("s1", NOV_SUNDAYS[0], seats={"Lead": 2, "BGV": 2, "Choir": 0})]
        people = [person("m-ana", {"s1": ["Lead", "BGV"]}, exempt=True), person("m-bea", {"s1": ["Lead"]}, exempt=True)]
        rules = [{"id": "cf-1", "kind": "pair", "persons": ["m-ana", "m-bea"], "roles": ["Sun.Lead"]}]
        r = report(request(s, people, rules=rules), [("s1", "Lead", "m-ana")])
        self.assertEqual(r.unfilled(), [{"service": "s1", "role": "Lead", "count": 1, "reason": "rules"},
                                        {"service": "s1", "role": "BGV", "count": 2, "reason": "no_candidate"}])
        r = report(request(s, people), [("s1", "Lead", "m-ana")], status={"fill": "unproven"})
        self.assertEqual(r.unfilled()[0]["reason"], "fill_not_proven")
        r = report(request(s, [person("m-ana", {"s1": ["BGV"]}, exempt=True)]), [("s1", "BGV", "m-ana")])
        self.assertEqual(r.unfilled()[0], {"service": "s1", "role": "Lead", "count": 2, "reason": "no_possible_lead"})

    def test_violations_and_the_handshake(self):
        s = [service("s1", NOV_SUNDAYS[0], seats={"Lead": 1, "BGV": 1, "Choir": 0})]
        people = [person("m-ana", {"s1": ["Lead", "BGV"]}, exempt=True)]
        r = report(request(s, people, pins=[pin(s[0], "BGV", "m-ana")]), [], ceiling=1)
        self.assertEqual(r.violations(), [{"code": "mandatory_lead", "rule": "mandatory_lead", "cause": "pins",
                                           "service": "s1", "month": "2026-11"}])
        self.assertEqual(r.pins(), {"requested": 1, "honored": 1})

    def test_missed_causes(self):
        s = [service(f"s{i}", d, seats={"Lead": 1, "BGV": 1, "Choir": 0}) for i, d in enumerate(NOV_SUNDAYS[:2])]
        both = {"s0": ["Lead", "BGV"], "s1": ["Lead", "BGV"]}
        people = [person("m-ana", dict(both), cadence={"2026-11": "on"}, exempt=True),
                  person("m-bea", dict(both), exempt=True), person("m-cris", dict(both), exempt=True)]
        pins = [pin(s[0], "BGV", "m-ana"), pin(s[1], "BGV", "m-ana")]
        seated = [("s0", "Lead", "m-bea"), ("s1", "Lead", "m-bea")]
        r = report(request(s, people, pins=pins), seated)
        causes = {(m["code"], m["person"]): m["cause"] for m in r.missed()}
        self.assertEqual(causes[("cadence_on_missed", "m-ana")], "pins")  # every slot is where she is pinned
        self.assertEqual(causes[("sunday_cap_exceeded", "m-bea")], "higher_priority")
        r = report(request(s, people, pins=pins), seated, status={"cadence": "unproven"})
        self.assertEqual({m["cause"] for m in r.missed() if m["code"] == "cadence_on_missed"}, {"not_proven"})
        rules = [{"id": "min-b", "kind": "count", "person": "m-bea", "roles": ["Sun.Lead"], "op": ">=",
                  "month": "2026-11", "value": 2}]
        r = report(request(s, people, pins=pins, rules=rules), seated)
        self.assertEqual({m["cause"] for m in r.missed() if m["code"] == "sunday_cap_exceeded"}, {"rule"})

    def test_dl_capacity_is_a_notice_and_a_cause(self):
        s = [service("s1", NOV_SUNDAYS[0], seats={"Lead": 1, "BGV": 0, "Choir": 0})]
        people = [person(x, {"s1": ["Lead"]}, exempt=True, dl_since="2026-01", prev=0)
                  for x in ("m-ana", "m-bea", "m-cris")]
        r = report(request(s, people), [("s1", "Lead", "m-ana")])
        self.assertEqual(r.notices[0], {"code": "dl_capacity",
                                        "params": {"months": ["2026-11"], "seats": 1, "people": 3}})
        self.assertEqual({m["cause"] for m in r.missed() if m["code"] == "dl_floor_missed"}, {"capacity"})

    def test_every_code_in_a_built_response_is_listed(self):
        s = [service("s1", NOV_SUNDAYS[0], seats={"Lead": 1, "BGV": 1, "Choir": 0})]
        people = [person("m-ana", {"s1": ["Lead", "BGV"]}, exempt=True, cadence={"2026-11": "on"})]
        r = report(request(s, people, pins=[pin(s[0], "BGV", "m-ana")]), [], ceiling=1)
        resp = {"ok": True, "stages": records(), "violations": r.violations(), "unfilled": r.unfilled(),
                "missed": r.missed(), "notices": r.notices, "cadence": r.cadence()}
        self.assertEqual(audit_response(resp), [])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run it to see it fail**

Run: `(cd gcf_v3 && "$PY" -m unittest tests.test_report)`
Expected: FAIL — `ModuleNotFoundError: No module named 'owt_v3.report'`.

- [ ] **Step 3: Implement**

**Create** `gcf_v3/owt_v3/report.py`:

```python
"""The response (spec §8.1–§8.2, S4): built from the request, the plan and the returned
assignment — never from the model's flags. Violations and missed protections are
re-evaluated from the assignment (F15); fairness is the shared formula on it (F14).
"""

from collections import defaultdict
from fractions import Fraction

from .codes import code
from .constants import FAIRNESS_TOLERANCE, SCALE
from .formula import realised
from .instances import violation_entry
from .rounding import hundredths, tenths
from .vocab import add_days, add_months

MISSED_ORDER = ("cadence_on_missed", "cadence_off_led", "compensation_missed", "voice_floor_missed",
                "dl_floor_missed", "sunday_cap_exceeded", "saturday_cap_exceeded", "consecutive_sundays")


def assignment_of(F, values):
    """{sid: {role: [ids]}} with every request service and the roles it has (codepoint order)."""
    out = {}
    for s in F.services:
        out[s.id] = {role: sorted(c[2] for c in F.cells_at[s.id] if c[1] == role and values.get(c))
                     for role in s.roles}
    return out


class Report:
    def __init__(self, F, plan, instances, notices, records, values, ceiling):
        self.F, self.plan, self.instances = F, plan, instances
        self.records, self.values, self.ceiling = records, values, ceiling
        self.assigned = frozenset(c for c, v in values.items() if v)
        self.assignment = assignment_of(F, values)
        self.status = {r["id"]: r["status"] for r in records}
        capacity, population = F.dl_capacity()
        self.notices = []
        if population > capacity:
            self.notices.append({"code": code("notice", "dl_capacity"), "params": {
                "months": list(F.months), "seats": capacity, "people": population}})
        self.capacity_notice = population > capacity
        self.notices += F.clamp_notices + notices
        for n in self.notices:
            code("notice", n["code"])
        self.real = realised(F.fservices(self.assignment), F.fmonths)

    # ── counts on the assignment ────────────────────────────────────────────
    def _count(self, person, month, pred):
        return sum(1 for c in self.assigned if c[2] == person and pred(self.F.svc[c[0]], c[1])
                   and self.F.svc[c[0]].month == month)

    def L(self, p, m):
        return self._count(p, m, lambda s, r: s.counts and r == "Lead" and s.day == "Sun")

    def S(self, p, m):
        return self._count(p, m, lambda s, r: s.counts and r == "Lead" and s.day == "Sat")

    def V(self, p, m):
        return self._count(p, m, lambda s, r: s.counts)

    def pinned_count(self, p, m, pred):
        return sum(1 for (sid, role, q) in self.F.pinned if q == p and self.F.svc[sid].month == m
                   and pred(self.F.svc[sid], role))

    def slots(self, p, months, pred):
        """Her unpinned cells at counted non-fixed services that could meet a protection."""
        return [c for c in self.F.cells if c[2] == p and c not in self.F.pinned
                and self.F.svc[c[0]].month in months and self.F.svc[c[0]].counts
                and not self.F.svc[c[0]].fixed and pred(self.F.svc[c[0]], c[1])]

    def blocked_by_own_pins(self, p, slots):
        return bool(slots) and all((c[0], p) in self.F.pin_of for c in slots)

    def cause(self, stage, pins=False, rule=False, no_slot=False, capacity=False):
        if self.status.get(stage) != "proven":
            return "not_proven"
        if pins:
            return "pins"
        if rule:
            return "rule"
        if no_slot:
            return "unavailable"
        if capacity:
            return "capacity"
        return "higher_priority"

    # ── sections ────────────────────────────────────────────────────────────
    def unfilled(self):
        F, out = self.F, []
        seated = {(c[0], c[2]) for c in self.assigned}
        for s in F.services:
            if s.fixed:
                continue
            for role in s.roles:
                size = F.row_size[(s.id, role)]
                filled = len(self.assignment[s.id][role])
                if filled >= size:
                    continue
                cells = [c for c in F.cells_at[s.id] if c[1] == role]
                free = [c for c in cells if c not in F.pinned and (s.id, c[2]) not in seated]
                if role == "Lead" and not cells:
                    reason = "no_possible_lead"
                elif not free:
                    reason = "no_candidate"
                elif all(sum(1 for i in self.instances if i.broken(self.assigned | {c})) > self.ceiling
                         for c in free):
                    reason = "rules"
                else:
                    reason = "fill_not_proven"
                out.append({"service": s.id, "role": role, "count": size - filled,
                            "reason": code("unfilled_reason", reason)})
        return out

    def violations(self):
        return [violation_entry(self.F, i, self.assigned) for i in self.instances if i.broken(self.assigned)]

    def cadence(self):
        F, out = self.F, []
        for p in F.pids:
            for m in F.months:
                state = F.cadence_state(p, m)
                if state is None:
                    continue
                L, S = self.L(p, m), self.S(p, m)
                a = 1 if state == "on" else 0
                if state != "off" or L >= 1:
                    comp = "not_applicable"
                else:
                    comp = "given" if S >= 1 else "missed"
                out.append({"person": p, "month": m, "state": code("cadence_state", state),
                            "sundays": L, "saturdays": S, "met": L == a,
                            "compensation": code("compensation", comp)})
        return out

    def missed(self):
        F, out = self.F, defaultdict(list)
        sun = lambda s, r: r == "Lead" and s.day == "Sun"
        sat = lambda s, r: r == "Lead" and s.day == "Sat"
        for p in F.pids:
            for m in F.months:
                state = F.cadence_state(p, m)
                if state is None:
                    continue
                L, S = self.L(p, m), self.S(p, m)
                if state == "on" and L == 0:
                    slots = self.slots(p, (m,), sun)
                    out["cadence_on_missed"].append({"person": p, "month": m, "cause": self.cause(
                        "cadence", pins=self.blocked_by_own_pins(p, slots), no_slot=not slots)})
                if state in ("off", "out") and L >= 1:
                    out["cadence_off_led"].append({"person": p, "month": m, "cause": self.cause(
                        "cadence", pins=self.pinned_count(p, m, lambda s, r: s.counts and sun(s, r)) >= 1)})
                if state == "off" and L == 0 and S == 0:
                    slots = self.slots(p, (m,), sat)
                    out["compensation_missed"].append({"person": p, "month": m, "cause": self.cause(
                        "compensation", pins=self.blocked_by_own_pins(p, slots), no_slot=not slots)})
        for p, m in F.f9_instances():
            if self.V(p, m) == 0:
                slots = self.slots(p, (m,), lambda s, r: True)
                out["voice_floor_missed"].append({"person": p, "month": m, "cause": self.cause(
                    "voice_floor", pins=self.blocked_by_own_pins(p, slots), no_slot=not slots)})
        for p, m in F.f10_instances():
            first = m == F.months[0]
            prev = F.people[p].prev_dl_leads if first else self.L(p, F.months[0])
            if prev + self.L(p, m) == 0:
                months = (m,) if first else (F.months[0], m)
                slots = self.slots(p, months, sun)
                out["dl_floor_missed"].append({
                    "person": p, "month1": add_months(m, -1), "month2": m, "cause": self.cause(
                        "dl_floor", pins=self.blocked_by_own_pins(p, slots), no_slot=not slots,
                        capacity=self.capacity_notice)})
        for stage, key, counter, missed_code, pred in (
                ("sunday_cap", "Sun.Lead", self.L, "sunday_cap_exceeded", sun),
                ("saturday_cap", "Sat.Lead", self.S, "saturday_cap_exceeded", sat)):
            for p in F.pids:
                for m in F.months:
                    if F.is_exact(p, m, key):
                        continue
                    n = counter(p, m)
                    if n < 2:
                        continue
                    pins = self.pinned_count(p, m, lambda s, r: s.counts and pred(s, r)) >= 2
                    rule = any(r.person == p and r.month == m and r.op == ">=" and key in r.roles
                               and F.clamped[r.index] >= 2 for r in F.P.counts)
                    out[missed_code].append({"person": p, "month": m, "count": n,
                                             "cause": self.cause(stage, pins=pins, rule=rule)})
        horizon = {s.date for s in F.services}
        for p in F.pids:
            weeks = F.weekend_terms(p, (), counted_only=True, dl_only=True)
            for d in sorted(weeks):
                nxt = add_days(d, 7)
                if nxt not in weeks or nxt not in horizon:
                    continue
                (ca, ka), (cb, kb) = weeks[d], weeks[nxt]
                held_a = ka or any(c in self.assigned for c in ca)
                held_b = kb or any(c in self.assigned for c in cb)
                if held_a and held_b:
                    pins_a = ka or any(c in self.assigned and c in F.pinned for c in ca)
                    pins_b = kb or any(c in self.assigned and c in F.pinned for c in cb)
                    out["consecutive_sundays"].append({"person": p, "dates": [d, nxt], "cause": self.cause(
                        "no_consecutive", pins=bool(pins_a and pins_b))})
        result = []
        for c in MISSED_ORDER:
            for entry in out[c]:
                entry = {"code": code("missed", c), **entry}
                code("missed_cause", entry["cause"])
                result.append(entry)
        return result

    def fairness(self):
        F, plan, real = self.F, self.plan, self.real
        P = F.P
        share = defaultdict(Fraction)
        for (m, p, line), v in real.share.items():
            share[(p, line)] += v
        received = defaultdict(int)
        for (m, p, line), v in real.received.items():
            received[(p, line)] += v
        pinned, set_aside = defaultdict(int), defaultdict(int)
        for sid, role, p, outcome in real.seats:
            if outcome.startswith("set_aside:"):
                set_aside[(p, F.line(sid, role))] += 1
            elif (sid, role, p) in F.pinned:
                pinned[(p, outcome)] += 1
        populated = {(p, line) for (_, p, line) in plan.in_population | real.in_population}
        stage_set = {(p, line) for (_, p, line) in plan.in_population}
        stage_lines = list(P.lines)
        people = []
        for p in F.pids:
            person = F.people[p]
            names = [l for l in stage_lines if (p, l) in populated or l in person.carried or received[(p, l)]]
            extra = sorted(k for k in person.carried if k.startswith("P:") and k not in stage_lines)
            lines = {}
            for line in names + extra:
                lines[line] = line_figures(
                    carried=person.carried.get(line, 0), share=share[(p, line)], seats=received[(p, line)],
                    pinned_seats=pinned[(p, line)], set_aside_seats=set_aside[(p, line)],
                    planned=plan.planned(p, line), in_stage=(p, line) in stage_set and line in stage_lines,
                    clamped=(p, line) in plan.clamped_lines)
            tabs = tab_figures(lines, {l: share[(p, l)] for l in lines}, exempt=person.exempt)
            floor = []
            for m in F.months:
                seat = real.floor_seat.get((m, p))
                floor.append({"month": m, "planned": p in plan.floor_persons.get(m, ()),
                              "realised": p in real.floor_persons.get(m, ()),
                              "seat": {"service": seat[0], "role": seat[1]} if seat else None})
            people.append({"person": p, "floor": floor, "lines": lines, "tabs": tabs})
        return {"scale": SCALE, "tolerance": FAIRNESS_TOLERANCE, "lines": stage_lines, "people": people}

    def pins(self):
        return {"requested": len(self.F.P.pins),
                "honored": sum(1 for c in self.F.pinned if c in self.assigned)}


def line_figures(carried, share, seats, pinned_seats, set_aside_seats, planned, in_stage, clamped):
    """One person-line (§8.2): hundredths rounded once from the exact share; tenths rounded once
    from the same rational (never from the hundredths); `after` is the identity."""
    sh = hundredths(share)
    return {
        "carried": carried,
        "planned": hundredths(planned),
        "share": sh,
        "received": SCALE * seats,
        "pinned": SCALE * pinned_seats,
        "seats": seats,
        "pinned_seats": pinned_seats,
        "set_aside": SCALE * set_aside_seats,
        "after": carried + sh - SCALE * seats,
        "tenths": {"share": tenths(share), "after": tenths(Fraction(carried, SCALE) + share - seats)},
        "in_stage": in_stage,
        "clamped": clamped,
    }


TAB_LINES = {"DL": lambda l: l == "DL", "SL": lambda l: l == "SL",
             "BGV": lambda l: l == "BGV" or l.startswith("P:"), "CORO": lambda l: l == "CORO",
             "TOTAL": lambda l: True}


def tab_figures(lines, exact_shares, exempt):
    """The display tabs (§8.2, LG-14): sums of the lines' exact values, each figure rounded once from
    the exact sum — never summed from the lines' rounded figures. TOTAL is absent for an exempt person."""
    tabs = {}
    for tab, member in TAB_LINES.items():
        names = [l for l in lines if member(l)]
        if not names or (tab == "TOTAL" and exempt):
            continue
        carried = sum(lines[l]["carried"] for l in names)
        exact = sum((exact_shares[l] for l in names), Fraction(0))
        seats = sum(lines[l]["seats"] for l in names)
        pins = sum(lines[l]["pinned_seats"] for l in names)
        sh = hundredths(exact)
        tabs[tab] = {
            "carried": carried, "share": sh, "received": SCALE * seats, "pinned": SCALE * pins,
            "seats": seats, "pinned_seats": pins, "after": carried + sh - SCALE * seats,
            "tenths": {"share": tenths(exact), "after": tenths(Fraction(carried, SCALE) + exact - seats)},
        }
    return tabs
```

- [ ] **Step 4: Run the suite and the layout guard**

Run: `"$PY" -m unittest discover -s gcf_v3 -t gcf_v3 2>&1 | tail -3 && npx vitest run scripts/__tests__/ciLayout.test.ts 2>&1 | tail -4`
Expected: `Ran 91 tests … OK`; `Tests  51 passed (51)`.

- [ ] **Step 5: Commit**

```bash
git add gcf_v3/owt_v3/report.py gcf_v3/tests/test_report.py
git commit -m "feat(solver-v3): the response, rebuilt from the assignment" -m "Spec C5 §8: violations and missed protections re-evaluated from the assignment with their causes; fairness per person and line from the shared formula, rounded once to hundredths and separately to tenths from the same rational, with integer seat counts (A39) and display tabs rounded from their exact sums; TOTAL absent for an exempt person. Tested on hand-made assignments, so every figure is checked by hand."
```

---

## Task 8: The model

Spec §6.1 (hard rules, rows grow, fixed = its pins), §6.6 «The model's received count for a line equals this function's `received` on the same assignment», §6.7 (one violation boolean per instance), §7.1 objectives; §12.1 «Model contracts» (rows grow, a fixed service gains no seat, the model's received count equals the shared function's).

**Files:**
- Create: `gcf_v3/owt_v3/model.py`, `gcf_v3/tests/test_model.py`

**Interfaces:**
- Consumes: `Facts`, `PlanResult` (Task 5), instances (Task 6), `assignment_of` (Task 7, in the test), `realised` (Task 4, in the test).
- Produces: `Model(F, plan, instances)` with `.m` (the `CpModel`), `.x[cell]`, `.decision` (unpinned cells, canonical order), `.allvars`, `.viol: [(instance, bool var)]`, `.L/.S/.V[(p, m)]`, `.n[(p, line)]` (received seats), `.n_upper`; objectives each returning `(expression, has_terms)`: `obj_rules()`, `obj_fill()`, `obj_cadence()`, `obj_compensation()`, `obj_voice_floor()`, `obj_dl_floor()`, `obj_sunday_cap()`, `obj_saturday_cap()`, `obj_no_consecutive()`, `balance_inputs(carried, line) -> [(p, K, n, U)]`, `obj_balance_max(inputs)`, `obj_balance_sq(inputs)`, `obj_tiebreak(seed)`. `tests/test_model.py` exports `random_request(k)` and `NAMES` for later suites.

- [ ] **Step 1: Write the failing test**

**Create** `gcf_v3/tests/test_model.py`:

```python
"""The model (spec §6.1, §6.6): hard rules, rows, pins, and the received count it optimises,
which must equal the shared formula's on the same assignment (with the plan's floor persons).

Solved here with one plain CP-SAT call on the fill objective — any feasible assignment will do:
the equality and the hard rules must hold for every one of them.
"""

import random
import unittest
from collections import Counter

from ortools.sat.python import cp_model

from owt_v3.facts import Facts
from owt_v3.formula import realised
from owt_v3.instances import build_instances
from owt_v3.model import Model
from owt_v3.plan import compute_plan
from owt_v3.report import assignment_of
from owt_v3.request import parse_request
from tests.builders import NOV_SATURDAYS, NOV_SUNDAYS, person, pin, request, service

NAMES = ["m-ana", "m-bea", "m-cris", "m-dario", "m-ema", "m-fede", "m-gala", "m-iris", "m-joel", "m-karen"]


def random_request(k):
    """A small fictitious month with random eligibility, pins, presence, exact rules and cadence."""
    rng = random.Random(k)
    svcs = [service(f"s{i}", d) for i, d in enumerate(NOV_SUNDAYS[:3])]
    svcs += [service(f"t{i}", d, kind="saturday") for i, d in enumerate(NOV_SATURDAYS)]
    if rng.random() < 0.5:
        svcs.append(service("fx", NOV_SUNDAYS[3], fixed=True))
    people = []
    for p in NAMES:
        elig = {}
        for s in svcs:
            roles = ["Lead", "BGV"] if (s["kind"] == "saturday" and not s["fixed"]) else ["Lead", "BGV", "Choir"]
            pick = [r for r in roles if rng.random() < 0.6]
            if pick:
                elig[s["id"]] = pick
        people.append(person(p, elig, exempt=rng.random() < 0.2))
    people[0]["cadence"] = {"2026-11": rng.choice(["on", "off", "out"])}
    rules = [{"id": "pr-1", "kind": "presence", "persons": ["m-bea", "m-cris"], "roles": ["Sun.BGV"],
              "exclusive": rng.random() < 0.5},
             {"id": "cap-d", "kind": "count", "person": "m-dario", "roles": ["Sun.BGV"], "op": "==",
              "month": "2026-11", "value": rng.choice([0, 1, 2])}]
    pins, taken = [], set()
    for _ in range(rng.randint(0, 4)):
        s = rng.choice(svcs)
        roles = ["Lead", "BGV"] if (s["kind"] == "saturday" and not s["fixed"]) else ["Lead", "BGV", "Choir"]
        p = rng.choice(NAMES)
        if (s["id"], p) not in taken:
            taken.add((s["id"], p))
            pins.append(pin(s, rng.choice(roles), p))
    return request(svcs, people, rules=rules, pins=pins, seed=k)


def solve_fill(body):
    """(Facts, plan, model, {cell: value}, {(person, line): received}) after one fill solve."""
    F = Facts(parse_request(body))
    plan = compute_plan(F)
    instances, _ = build_instances(F)
    model = Model(F, plan, instances)
    objective, _ = model.obj_fill()
    model.m.Maximize(objective)
    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = 1
    status = solver.Solve(model.m)
    assert status in (cp_model.OPTIMAL, cp_model.FEASIBLE), solver.StatusName(status)
    values = {c: solver.Value(v) for c, v in model.x.items()}
    received = {k: solver.Value(v) for k, v in model.n.items()}
    return F, plan, model, values, received


class ReceivedEquality(unittest.TestCase):
    def test_the_model_counts_what_the_formula_counts(self):
        for k in range(12):
            F, plan, _, values, received = solve_fill(random_request(k))
            real = realised(F.fservices(assignment_of(F, values)), F.fmonths, floor_override=plan.floor_persons)
            formula = Counter()
            for (m, p, line), v in real.received.items():
                formula[(p, line)] += v
            self.assertEqual({key: v for key, v in formula.items() if v},
                             {key: v for key, v in received.items() if v}, f"request {k}")


    def test_equality_when_a_presence_member_holds_a_fixed_seat(self):
        s = [service(f"s{i}", d) for i, d in enumerate(NOV_SUNDAYS[:2])]
        everyone = {x["id"]: ["Lead", "BGV", "Choir"] for x in s}
        people = [person(p, dict(everyone)) for p in NAMES[:8]]
        people[1]["cadence"] = {"2026-11": "on"}
        rules = [{"id": "pr-1", "kind": "presence", "persons": ["m-ana", "m-bea", "m-cris"],
                  "roles": ["Sun.Lead", "Sun.BGV"], "exclusive": False},
                 {"id": "cap-a", "kind": "count", "person": "m-ana", "roles": ["Sun.BGV"], "op": "==",
                  "month": "2026-11", "value": 1}]
        pins = [pin(s[0], "BGV", "m-ana"), pin(s[0], "Lead", "m-bea"), pin(s[1], "BGV", "m-cris")]
        F, plan, _, values, received = solve_fill(request(s, people, rules=rules, pins=pins))
        real = realised(F.fservices(assignment_of(F, values)), F.fmonths, floor_override=plan.floor_persons)
        formula = Counter()
        for (m, p, line), v in real.received.items():
            formula[(p, line)] += v
        self.assertEqual({k: v for k, v in formula.items() if v}, {k: v for k, v in received.items() if v})
        reasons = {(a["person"], a["reason"]) for a in real.set_asides}
        self.assertTrue({("m-ana", "exact"), ("m-bea", "cadence")} <= reasons)


class HardRules(unittest.TestCase):
    def test_hard_rules_hold_on_random_requests(self):
        for k in range(12):
            F, _, _, values, _ = solve_fill(random_request(k))
            seated = {c for c, v in values.items() if v}
            per_service = Counter((c[0], c[2]) for c in seated)
            self.assertTrue(all(v == 1 for v in per_service.values()), f"two seats, request {k}")
            for sid, role, p in seated:
                self.assertTrue((sid, role, p) in F.pinned or (not F.svc[sid].fixed and F.eligible(p, sid, role)))
            self.assertTrue(F.pinned <= seated)
            assignment = assignment_of(F, values)
            for s in F.services:
                for role in s.roles:
                    self.assertLessEqual(len(assignment[s.id][role]), F.row_size[(s.id, role)])
                    if s.fixed:
                        self.assertEqual(len(assignment[s.id][role]), len(F.pin_rows.get((s.id, role), ())))

    def test_rows_grow_to_fit_their_pins(self):
        s = [service("s1", NOV_SUNDAYS[0], seats={"Lead": 2, "BGV": 0, "Choir": 0})]
        people = [person(p, {"s1": ["Lead"]}, exempt=True) for p in NAMES[:4]]
        F, _, _, values, _ = solve_fill(request(s, people, pins=[pin(s[0], "Lead", p) for p in NAMES[:3]]))
        self.assertEqual(assignment_of(F, values)["s1"]["Lead"], NAMES[:3])

    def test_a_fixed_service_gains_no_seat(self):
        s = [service("fx", NOV_SUNDAYS[0], fixed=True)]
        people = [person(p, {"fx": ["Lead", "BGV", "Choir"]}, exempt=True) for p in NAMES[:5]]
        F, _, _, values, _ = solve_fill(request(s, people, pins=[pin(s[0], "BGV", "m-ana")]))
        self.assertEqual(assignment_of(F, values)["fx"], {"Lead": [], "BGV": ["m-ana"], "Choir": []})


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run it to see it fail**

Run: `(cd gcf_v3 && "$PY" -m unittest tests.test_model)`
Expected: FAIL — `ModuleNotFoundError: No module named 'owt_v3.model'`.

- [ ] **Step 3: Implement**

**Create** `gcf_v3/owt_v3/model.py`:

```python
"""The CP-SAT model (spec §6.1, §6.6, §6.7, §7.1): variables, hard constraints, one
violation boolean per rule instance, the counts the protections read, and the received
count per person and line that mirrors the shared formula on the same assignment.

How each objective is encoded is this module's choice; WHAT each stage minimises is the
spec's (§7.1). Variables are created in canonical order (services, roles, people).
"""

import random
from collections import defaultdict

from ortools.sat.python import cp_model

from .constants import SCALE
from .rounding import hundredths
from .vocab import LINE_OF_KEY, ROLE_RANK, add_days, seat_order_key


class Model:
    def __init__(self, F, plan, instances):
        self.F, self.plan, self.instances = F, plan, instances
        self.m = cp_model.CpModel()
        self.allvars = []
        self.x = {}
        self.decision = []
        for c in F.cells:
            v = self._bool("x")
            self.x[c] = v
            if c in F.pinned:
                self.m.Add(v == 1)
            else:
                self.decision.append(c)
        self._hard()
        self.viol = [(inst, self._soft(inst)) for inst in instances]
        self._counts()
        self._received()

    # ── helpers ──────────────────────────────────────────────────────────────
    def _bool(self, name):
        v = self.m.NewBoolVar(name)
        self.allvars.append(v)
        return v

    def _int(self, lo, hi, name):
        v = self.m.NewIntVar(lo, hi, name)
        self.allvars.append(v)
        return v

    def _sum(self, cells):
        return sum(self.x[c] for c in cells)

    def _first_set(self, lits):
        """For literals in order, booleans f_i = lit_i AND no earlier lit (first set bit)."""
        out, seen = [], None
        for lit in lits:
            f = self._bool("first")
            if seen is None:
                self.m.Add(f == lit)
            else:
                self.m.Add(f <= lit)
                self.m.Add(f <= 1 - seen)
                self.m.Add(f >= lit - seen)
            out.append(f)
            nxt = self._bool("seen")
            if seen is None:
                self.m.Add(nxt == lit)
            else:
                self.m.AddMaxEquality(nxt, [seen, lit])
            seen = nxt
        return out

    def _and(self, a, b):
        g = self._bool("and")
        self.m.Add(g <= a)
        self.m.Add(g <= b)
        self.m.Add(g >= a + b - 1)
        return g

    # ── §6.1 hard constraints ────────────────────────────────────────────────
    def _hard(self):
        F, m = self.F, self.m
        per_person = defaultdict(list)
        for c in F.cells:
            per_person[(c[0], c[2])].append(c)
        for cells in per_person.values():
            if len(cells) > 1:
                m.Add(self._sum(cells) <= 1)
        for s in F.services:
            if s.fixed:
                continue
            for role in s.roles:
                cells = [c for c in F.cells_at[s.id] if c[1] == role]
                if cells:
                    m.Add(self._sum(cells) <= F.row_size[(s.id, role)])

    # ── §6.7 soft instances ──────────────────────────────────────────────────
    def _soft(self, inst):
        v = self._bool("viol")
        m, ok = self.m, v.Not()
        if not inst.terms and not inst.terms_b and inst.family != "consecutive":
            if inst.broken(frozenset()):
                m.Add(v == 1)  # nothing can satisfy it (a fixed service's seats are its pins)
            return v
        expr = self._sum(inst.terms)
        if inst.family == "count":
            {"==": lambda: m.Add(expr == inst.limit), "<=": lambda: m.Add(expr <= inst.limit),
             ">=": lambda: m.Add(expr >= inst.limit)}[inst.op]().OnlyEnforceIf(ok)
        elif inst.family == "pair":
            m.Add(expr <= 1).OnlyEnforceIf(ok)
        elif inst.family in ("presence", "mandatory_lead"):
            m.Add(expr >= 1).OnlyEnforceIf(ok)
        else:
            sides_a = [self.x[c] for c in inst.terms] + ([1] if inst.const_a else [])
            sides_b = [self.x[c] for c in inst.terms_b] + ([1] if inst.const_b else [])
            for a in sides_a:
                for b in sides_b:
                    if isinstance(a, int) and isinstance(b, int):
                        m.Add(v == 1)
                    else:
                        m.Add(a + b <= 1).OnlyEnforceIf(ok)
        return v

    # ── counts the protections read ──────────────────────────────────────────
    def _counts(self):
        F = self.F
        self.L, self.S, self.V = {}, {}, {}
        lead_sun, lead_sat, voice = defaultdict(list), defaultdict(list), defaultdict(list)
        for c in F.cells:
            s = F.svc[c[0]]
            if not s.counts:
                continue
            voice[(c[2], s.month)].append(c)
            if c[1] == "Lead":
                (lead_sun if s.day == "Sun" else lead_sat)[(c[2], s.month)].append(c)
        self.lead_sun_cells, self.lead_sat_cells, self.voice_cells = lead_sun, lead_sat, voice
        for p in F.pids:
            for mo in F.months:
                self.L[(p, mo)] = self._sum(lead_sun.get((p, mo), []))
                self.S[(p, mo)] = self._sum(lead_sat.get((p, mo), []))
                self.V[(p, mo)] = self._sum(voice.get((p, mo), []))

    # ── §6.6 received, mirrored on the decision variables ────────────────────
    def _received(self):
        F, plan = self.F, self.plan
        contrib = defaultdict(list)  # (p, line) -> [linear terms]
        upper = defaultdict(int)  # (p, line) -> how many cells can reach it
        recv_of_cell = {}  # cell -> [(line, literal)]
        for s in F.services:
            if not s.counts:
                continue
            fm = F.fmonths[s.month]
            pop, q, rules = F.realised_populations(s)
            cells = F.cells_at[s.id]
            pi = defaultdict(dict)  # cell -> {rho_id: literal}
            taken = defaultdict(list)  # cell -> literals of earlier rules' presence seats
            for rho, a in rules:
                cands = sorted(
                    (c for c in cells if s.key(c[1]) in a and c[2] in rho.members
                     and not fm.is_fixed_seat(c[2], s.key(c[1]))),
                    key=lambda c: (ROLE_RANK[c[1]], c[2]))
                lits = []
                for c in cands:
                    if taken[c]:
                        free = self._bool("free")
                        self.m.Add(free == self.x[c] - sum(taken[c]))
                        lits.append(free)
                    else:
                        lits.append(self.x[c])
                for c, f in zip(cands, self._first_set(lits)):
                    pi[c][rho.id] = f
                    taken[c].append(f)
            for c in cells:
                h, k = c[2], s.key(c[1])
                parts = []
                if h in pop[k] and not fm.is_fixed_seat(h, k):
                    if pi[c]:
                        normal = self._bool("normal")
                        self.m.Add(normal == self.x[c] - sum(pi[c].values()))
                        parts.append((LINE_OF_KEY[k], normal))
                    else:
                        parts.append((LINE_OF_KEY[k], self.x[c]))
                for rid, lit in pi[c].items():
                    if h in q[rid]:
                        parts.append((f"P:{rid}", lit))
                recv_of_cell[c] = parts
                for line, lit in parts:
                    contrib[(h, line)].append(lit)
                    upper[(h, line)] += 1
        # floor seats of the plan's floor persons: the first received seat of the month
        for mo in F.months:
            for p in sorted(plan.floor_persons.get(mo, ())):
                mine = [c for c in F.cells if c[2] == p and F.svc[c[0]].counts
                        and F.svc[c[0]].month == mo and recv_of_cell.get(c)]
                mine.sort(key=lambda c: seat_order_key(F.svc[c[0]].date, c[1], F.svc[c[0]].time, c[0]))
                lits = []
                for c in mine:
                    parts = recv_of_cell[c]
                    if len(parts) == 1:
                        lits.append(parts[0][1])
                    else:
                        any_recv = self._bool("recv")
                        self.m.Add(any_recv == sum(lit for _, lit in parts))
                        lits.append(any_recv)
                for c, f in zip(mine, self._first_set(lits)):
                    for line, lit in recv_of_cell[c]:
                        contrib[(p, line)].append(-1 * self._and(f, lit))
        self.n = {}
        self.n_upper = dict(upper)
        for key in sorted(contrib):
            n = self._int(0, max(1, upper[key]), "n")
            self.m.Add(n == sum(contrib[key]))
            self.n[key] = n

    def received_expr(self, person, line):
        return self.n.get((person, line), 0)

    # ── stage objectives (§7.1) ──────────────────────────────────────────────
    def obj_rules(self):
        return sum(v for _, v in self.viol), len(self.viol) > 0

    def obj_fill(self):
        F = self.F
        rows = [(s, role) for s in F.services if not s.fixed for role in s.roles]
        choir = sum(F.row_size[(s.id, r)] for s, r in rows if r == "Choir")
        bgv = sum(F.row_size[(s.id, r)] for s, r in rows if r == "BGV")
        weight = {"Choir": 1, "BGV": choir + 1, "Lead": (choir + 1) * (bgv + 1)}
        terms = [weight[c[1]] * self.x[c] for c in F.cells if not F.svc[c[0]].fixed]
        return sum(terms), bool(terms)

    def obj_cadence(self):
        terms = []
        for p in self.F.pids:
            for mo in self.F.months:
                state = self.F.cadence_state(p, mo)
                if state is None:
                    continue
                a = 1 if state == "on" else 0
                d = self._int(0, 64, "cad")
                self.m.Add(d >= self.L[(p, mo)] - a)
                self.m.Add(d >= a - self.L[(p, mo)])
                terms.append(d)
        return sum(terms), bool(terms)

    def obj_compensation(self):
        terms = []
        for p in self.F.pids:
            for mo in self.F.months:
                if self.F.cadence_state(p, mo) != "off":
                    continue
                y = self._bool("comp")
                self.m.Add(y >= 1 - self.L[(p, mo)] - self.S[(p, mo)])
                terms.append(y)
        return sum(terms), bool(terms)

    def obj_voice_floor(self):
        terms = []
        for p, mo in self.F.f9_instances():
            y = self._bool("vf")
            self.m.Add(y >= 1 - self.V[(p, mo)])
            terms.append(y)
        return sum(terms), bool(terms)

    def obj_dl_floor(self):
        terms = []
        F = self.F
        for p, mo in F.f10_instances():
            prev = F.people[p].prev_dl_leads if mo == F.months[0] else self.L[(p, F.months[0])]
            y = self._bool("dlf")
            self.m.Add(y >= 1 - prev - self.L[(p, mo)])
            terms.append(y)
        return sum(terms), bool(terms)

    def _cap(self, counts, cells, key):
        terms = []
        for p in self.F.pids:
            for mo in self.F.months:
                if self.F.is_exact(p, mo, key) or len(cells.get((p, mo), [])) < 2:
                    continue
                y = self._int(0, 64, "cap")
                self.m.Add(y >= counts[(p, mo)] - 1)
                terms.append(y)
        return sum(terms), bool(terms)

    def obj_sunday_cap(self):
        return self._cap(self.L, self.lead_sun_cells, "Sun.Lead")

    def obj_saturday_cap(self):
        return self._cap(self.S, self.lead_sat_cells, "Sat.Lead")

    def obj_no_consecutive(self):
        F, terms = self.F, []
        horizon = {s.date for s in F.services}
        for p in F.pids:
            weeks = F.weekend_terms(p, (), counted_only=True, dl_only=True)
            for d in sorted(weeks):
                nxt = add_days(d, 7)
                if nxt not in weeks or nxt not in horizon:
                    continue
                (ca, ka), (cb, kb) = weeks[d], weeks[nxt]
                ha = 1 if ka else self._or([self.x[c] for c in ca])
                hb = 1 if kb else self._or([self.x[c] for c in cb])
                if isinstance(ha, int) and isinstance(hb, int):
                    terms.append(1)
                    continue
                y = self._bool("cons")
                self.m.Add(y >= ha + hb - 1)
                terms.append(y)
        return sum(terms), bool(terms)

    def _or(self, lits):
        if len(lits) == 1:
            return lits[0]
        h = self._bool("or")
        self.m.AddMaxEquality(h, lits)
        return h

    def balance_inputs(self, carried, line):
        """[(person, K, n, U)] for the line's stage set (§7.1): K = carried + planned."""
        out = []
        members = sorted({p for (_, p, l) in self.plan.in_population if l == line})
        for p in members:
            k = carried(p, line) + hundredths(self.plan.planned(p, line))
            n = self.n.get((p, line), 0)
            out.append((p, k, n, self.n_upper.get((p, line), 0)))
        return out

    def obj_balance_max(self, inputs):
        if not inputs:
            return 0, False
        lo = min(k - SCALE * u for _, k, _, u in inputs)
        hi = max(k for _, k, _, _ in inputs)
        mv = self._int(lo, hi, "max")
        for _, k, n, _ in inputs:
            self.m.Add(mv >= k - SCALE * n)
        return mv, True

    def obj_balance_sq(self, inputs):
        if not inputs:
            return 0, False
        terms = []
        for _, k, n, u in inputs:
            table = [(k - SCALE * j) ** 2 for j in range(u + 1)]
            if isinstance(n, int):
                terms.append(table[0])
                continue
            q = self._int(min(table), max(table), "sq")
            self.m.AddElement(n, table, q)
            terms.append(q)
        return sum(terms), True

    def obj_tiebreak(self, seed):
        rng = random.Random(seed)
        weights = [rng.randint(0, 9) for _ in self.decision]
        terms = [w * self.x[c] for w, c in zip(weights, self.decision)]
        return sum(terms), bool(terms)
```

- [ ] **Step 4: Run the suite and the layout guard**

Run: `"$PY" -m unittest discover -s gcf_v3 -t gcf_v3 2>&1 | tail -3 && npx vitest run scripts/__tests__/ciLayout.test.ts 2>&1 | tail -4`
Expected: `Ran 96 tests … OK`; `Tests  51 passed (51)`.

- [ ] **Step 5: Commit**

```bash
git add gcf_v3/owt_v3/model.py gcf_v3/tests/test_model.py
git commit -m "feat(solver-v3): the CP-SAT model and its stage objectives" -m "One seat per person per service, a seat only for the eligible or the pinned, rows that grow to fit their pins, a fixed service holding exactly its pins; one violation boolean per rule instance. The received count per person and line applies the presence-seat attribution and the plan's floor persons to the decision variables (first-set-bit encodings), and equals the shared formula's on any assignment — checked here on twelve random fictitious months."
```

---

## Task 9: Stages, settings, the pipeline and the core

Spec §7.1 (order; fixing; a stage with no terms is `proven` 0), §7.2 (1 worker, `linearization_level = 2`, `random_seed`, deterministic limit, wall guard `min(2.5, remaining)`, 25 s from model build, 0.1 s start floor), §7.3 (statuses, reasons, `timeout`, `internal_error`), F15 (ceiling never raised), C5-R2, C5-R3, §8.1 fields; §12.1 «Stages», «Model contracts» (per-month counts in a two-month run; trailing Saturday; `pair`/`presence` per service; month-scoped objects; exact `Sat.Lead` above 1 off the Saturday cap; uncounted services out of lines and protections), «Contract» (refusals answer 422; a 200-character id echoed verbatim; every emitted code listed).

**Files:**
- Create: `gcf_v3/owt_v3/stages.py`, `gcf_v3/owt_v3/solver.py`, `gcf_v3/owt_v3/service.py`, `gcf_v3/tests/test_stages.py`, `gcf_v3/tests/test_ranking.py`, `gcf_v3/tests/test_rules_solved.py`, `gcf_v3/tests/test_service.py`

**Interfaces:**
- Consumes: Tasks 1–8.
- Produces: `stages.SolveTimeout(stage, seconds)`, `stages.SolverDefect(stage)`, `stage_parameters(solver, seed, det_limit, wall)`, `Runner(model, budget, seed, clock=time.perf_counter, solver_for=None, started=None)` with `.run(stage_id, objective, has_terms, sense="min", fix=True, essential=False) -> record`, `.records`, `.parameters`, `.values`, `.received`. `solver.PROTECTION_STAGES`, `solver.stage_ids(problem)`, `solver.solve_problem(problem, clock=…, solver_for=None, consecutive_last=False) -> (Report, Runner, Model)` (`consecutive_last` is acceptance run O only). `service.handle(body, clock=…, solver_for=None) -> (status, response, log)`, `service.handle_raw(data, clock=…)`, `service.public_label(stage_id, presence_ids)`, `service.failure(name, **params)`, `service.emit_log(record, stream=None)`, `service.build_id()`. `solver_for(stage_id)` returns the stage's `CpSolver` (tests stub it).

- [ ] **Step 1: Write the failing tests**

**Create** `gcf_v3/tests/test_stages.py`:

```python
"""Stages and settings (spec §7.1–§7.3, S3): order, fixing, the CP-SAT settings, budgets,
and honest statuses under stubbed limits."""

import types
import unittest

from ortools.sat.python import cp_model

from owt_v3.constants import STAGE_DET_LIMIT
from owt_v3.request import parse_request
from owt_v3.service import handle
from owt_v3.solver import solve_problem, stage_ids
from tests.builders import NOV_SUNDAYS, person, request, service
from tests.test_model import random_request


def small():
    svcs = [service("s1", NOV_SUNDAYS[0]), service("s2", NOV_SUNDAYS[1])]
    people = [person(p, {"s1": ["Lead", "BGV", "Choir"], "s2": ["Lead", "BGV", "Choir"]})
              for p in ("m-ana", "m-bea", "m-cris", "m-dario", "m-ema", "m-fede", "m-gala", "m-iris")]
    rules = [{"id": "pr-1", "kind": "presence", "persons": ["m-ana", "m-bea"], "roles": ["Sun.BGV"],
              "exclusive": False}]
    return request(svcs, people, rules=rules, seed=7)


def stub(fail, status=cp_model.UNKNOWN, clock=None, advance=0.0):
    """A solver factory whose stages in `fail` stop with `status`; every solve advances `clock`."""

    class Stub(cp_model.CpSolver):
        def __init__(self, stage):
            super().__init__()
            self.stage, self.stubbed = stage, False

        def Solve(self, model, *args, **kwargs):
            if clock is not None:
                clock.now += advance
            if self.stage in fail:
                self.stubbed = True
                if status == cp_model.FEASIBLE:  # a limit stopped it holding a solution
                    super().Solve(model, *args, **kwargs)
                return status
            return super().Solve(model, *args, **kwargs)

        def ResponseProto(self):
            if self.stubbed:
                return types.SimpleNamespace(deterministic_time=self.parameters.max_deterministic_time)
            return super().ResponseProto()

    return Stub


class FakeClock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


class Order(unittest.TestCase):
    def test_stages_run_in_the_spec_order(self):
        status, resp, _ = handle(small())
        self.assertEqual([s["id"] for s in resp["stages"]], [
            "rules", "fill", "cadence", "compensation", "voice_floor", "dl_floor", "sunday_cap", "saturday_cap",
            "no_consecutive", "balance_max:DL", "balance_sq:DL", "balance_max:SL", "balance_sq:SL",
            "balance_max:BGV", "balance_sq:BGV", "balance_max:P:pr-1", "balance_sq:P:pr-1", "balance_max:CORO",
            "balance_sq:CORO", "tiebreak"])
        self.assertEqual([s["id"] for s in resp["stages"]], stage_ids(parse_request(small())))

    def test_a_stage_with_no_terms_is_proven_zero_and_not_solved(self):
        _, resp, _ = handle(small())
        cadence = [s for s in resp["stages"] if s["id"] == "cadence"][0]
        self.assertEqual((cadence["status"], cadence["value"], cadence["ms"], cadence["limit"]),
                         ("proven", 0, 0, "none"))

    def test_the_ceiling_is_never_raised(self):
        for k in range(8):
            report, runner, _ = solve_problem(parse_request(random_request(k)))
            broken = sum(1 for i in report.instances if i.broken(report.assigned))
            self.assertLessEqual(broken, report.ceiling, f"request {k}")


class Settings(unittest.TestCase):
    def test_every_stage_uses_the_fixed_settings(self):
        report, runner, _ = solve_problem(parse_request(small()))
        self.assertTrue(runner.parameters)
        for stage, p in runner.parameters:
            self.assertEqual(p.num_search_workers, 1, stage)
            self.assertEqual(p.linearization_level, 2, stage)
            self.assertEqual(p.random_seed, 7, stage)
            self.assertEqual(p.max_deterministic_time, STAGE_DET_LIMIT, stage)
            self.assertLessEqual(p.max_time_in_seconds, 2.5, stage)

    def test_the_wall_guard_is_the_remaining_budget_when_smaller(self):
        clock = FakeClock()
        body = small()
        body["budget"] = {"total_seconds": 1}
        _, runner, _ = solve_problem(parse_request(body), clock=clock, solver_for=stub(set(), clock=clock, advance=0.3))
        walls = [p.max_time_in_seconds for _, p in runner.parameters]
        self.assertEqual(walls[0], 1.0)
        self.assertAlmostEqual(walls[1], 0.7)


class Statuses(unittest.TestCase):
    def test_no_solution_in_rules_or_fill_is_a_timeout(self):
        for stage in ("rules", "fill"):
            status, resp, log = handle(small(), solver_for=stub({stage}))
            self.assertEqual((status, resp["code"], resp["params"]["stage"]), (422, "timeout", stage))
            self.assertEqual(log["code"], "timeout")

    def test_no_solution_after_fill_ends_the_run(self):
        status, resp, _ = handle(small(), solver_for=stub({"voice_floor"}))
        self.assertEqual(status, 200)
        by_id = {s["id"]: s for s in resp["stages"]}
        self.assertEqual((by_id["voice_floor"]["status"], by_id["voice_floor"]["reason"]),
                         ("not_run", "no_solution_in_limit"))
        later = resp["stages"][[s["id"] for s in resp["stages"]].index("voice_floor") + 1:]
        self.assertTrue(later)
        self.assertTrue(all(s["status"] == "not_run" and s["reason"] == "stopped_earlier" for s in later))
        self.assertFalse(resp["reproducible"])

    def test_a_stage_that_cannot_start_is_not_run_budget(self):
        clock = FakeClock()
        body = small()
        body["budget"] = {"total_seconds": 1}
        status, resp, _ = handle(body, clock=clock, solver_for=stub(set(), clock=clock, advance=0.45))
        reasons = {s["id"]: s.get("reason") for s in resp["stages"] if s["status"] == "not_run"}
        self.assertTrue(reasons)
        self.assertEqual(set(reasons.values()), {"budget"})

    def test_a_stage_stopped_by_a_limit_is_unproven(self):
        status, resp, _ = handle(small(), solver_for=stub({"balance_sq:DL"}, status=cp_model.FEASIBLE))
        by_id = {s["id"]: s for s in resp["stages"]}
        self.assertEqual((by_id["balance_sq:DL"]["status"], by_id["balance_sq:DL"]["limit"]),
                         ("unproven", "deterministic"))
        self.assertEqual(by_id["tiebreak"]["status"], "proven")  # the run goes on with its value fixed
        self.assertFalse(resp["reproducible"])

    def test_a_proven_infeasible_is_a_defect(self):
        status, resp, log = handle(small(), solver_for=stub({"cadence", "dl_floor"}, status=cp_model.INFEASIBLE))
        self.assertEqual((status, resp["code"]), (500, "internal_error"))
        self.assertEqual(log["stage"], "dl_floor")


if __name__ == "__main__":
    unittest.main()
```

**Create** `gcf_v3/tests/test_ranking.py`:

```python
"""Ranking (spec §7.1, F12): each stage's protection wins over the next one's, on instances
built for that purpose. The DL floor and the Sunday cap pull the same way (more distinct
leaders), so no instance trades one for the other; every other neighbouring pair is here.
All names are fictitious; everyone is exempt and has no DL history unless the case needs it.
"""

import unittest

from owt_v3.service import handle
from tests.builders import person, request, service

S1, S8, S15, S29 = "2026-11-01", "2026-11-08", "2026-11-15", "2026-11-29"
SAT14, SAT28 = "2026-11-14", "2026-11-28"
LEAD1 = {"Lead": 1, "BGV": 0, "Choir": 0}
SAT_LEAD1 = {"Lead": 1, "BGV": 0}


def p(pid, elig, **kw):
    kw.setdefault("exempt", True)
    kw.setdefault("dl_since", None)
    return person(pid, elig, **kw)


def solve(body):
    status, resp, _ = handle(body)
    assert status == 200, resp
    return resp


def missed(resp, code=None):
    return [(m["code"], m["person"], m["cause"]) for m in resp["missed"] if code is None or m["code"] == code]


class Ranking(unittest.TestCase):
    def test_rules_over_fill(self):
        s = [service("s1", S1, seats={"Lead": 2, "BGV": 0, "Choir": 0})]
        people = [p("m-ana", {"s1": ["Lead"]}), p("m-bea", {"s1": ["Lead"]})]
        rules = [{"id": "cf-1", "kind": "pair", "persons": ["m-ana", "m-bea"], "roles": ["Sun.Lead"]}]
        resp = solve(request(s, people, rules=rules))
        self.assertEqual(resp["violations"], [])
        self.assertEqual(resp["unfilled"], [{"service": "s1", "role": "Lead", "count": 1, "reason": "rules"}])

    def test_fill_over_cadence(self):
        s = [service("s1", S1, seats=dict(LEAD1))]
        people = [p("m-ana", {"s1": ["Lead"]}, cadence={"2026-11": "off"})]
        resp = solve(request(s, people))
        self.assertEqual(resp["assignments"]["s1"]["Lead"], ["m-ana"])
        self.assertEqual(missed(resp, "cadence_off_led"), [("cadence_off_led", "m-ana", "higher_priority")])

    def test_cadence_over_compensation(self):
        s = [service("s1", S1, seats=dict(LEAD1))]
        people = [p("m-ana", {"s1": ["Lead"]}, cadence={"2026-11": "off"}), p("m-bea", {"s1": ["Lead"]})]
        resp = solve(request(s, people))
        self.assertEqual(resp["assignments"]["s1"]["Lead"], ["m-bea"])  # a Sunday would cancel the debt
        self.assertEqual(missed(resp, "compensation_missed"), [("compensation_missed", "m-ana", "unavailable")])

    def test_compensation_over_voice_floor(self):
        s = [service("s1", S1, seats=dict(LEAD1)), service("t1", SAT14, kind="saturday", seats=dict(SAT_LEAD1))]
        people = [p("m-ana", {"s1": ["Lead"], "t1": ["Lead"]}, cadence={"2026-11": "off"}),
                  p("m-bea", {"s1": ["Lead"]}),
                  p("m-cris", {"t1": ["Lead"]}, exempt=False)]
        resp = solve(request(s, people))
        self.assertEqual(resp["assignments"]["t1"]["Lead"], ["m-ana"])
        self.assertEqual(missed(resp, "voice_floor_missed"), [("voice_floor_missed", "m-cris", "higher_priority")])

    def test_voice_floor_over_dl_floor(self):
        s = [service("s1", S1, seats=dict(LEAD1)), service("t1", SAT14, kind="saturday", seats={"Lead": 0, "BGV": 1})]
        people = [p("m-ana", {"s1": ["Lead"]}, exempt=False),
                  p("m-bea", {"s1": ["Lead"], "t1": ["BGV"]}, dl_since="2026-01", prev=0)]
        resp = solve(request(s, people))
        self.assertEqual(resp["assignments"]["s1"]["Lead"], ["m-ana"])
        self.assertEqual(missed(resp, "dl_floor_missed"), [("dl_floor_missed", "m-bea", "higher_priority")])

    def test_sunday_cap_over_saturday_cap(self):
        s = [service("s1", S1, seats=dict(LEAD1)), service("s2", S15, seats=dict(LEAD1)),
             service("t1", SAT14, kind="saturday", seats=dict(SAT_LEAD1)),
             service("t2", SAT28, kind="saturday", seats=dict(SAT_LEAD1))]
        people = [p("m-ana", {"s1": ["Lead"], "s2": ["Lead"], "t1": ["Lead"], "t2": ["Lead"]}),
                  p("m-bea", {"s1": ["Lead"], "t1": ["Lead"]})]
        rules = [{"id": "cap-b", "kind": "count", "person": "m-bea", "roles": ["Sun.Lead", "Sat.Lead"], "op": "<=",
                  "month": "2026-11", "value": 1}]
        resp = solve(request(s, people, rules=rules))
        self.assertEqual(resp["assignments"]["s1"]["Lead"], ["m-bea"])
        self.assertEqual(missed(resp), [("saturday_cap_exceeded", "m-ana", "higher_priority")])

    def test_saturday_cap_over_no_consecutive(self):
        s = [service("s1", S1, seats=dict(LEAD1)), service("s2", S8, seats=dict(LEAD1)),
             service("s3", S15, seats=dict(LEAD1)),
             service("t1", SAT14, kind="saturday", seats=dict(SAT_LEAD1)),
             service("t2", SAT28, kind="saturday", seats=dict(SAT_LEAD1))]
        people = [p("m-ana", {x: ["Lead"] for x in ("s1", "s2", "s3", "t1", "t2")}),
                  p("m-bea", {"s2": ["Lead"], "t1": ["Lead"]}),
                  p("m-cris", {"s1": ["Lead"], "s3": ["Lead"]})]
        rules = [{"id": "cap-a", "kind": "count", "person": "m-ana", "roles": ["Sun.Lead"], "op": "==",
                  "month": "2026-11", "value": 2},
                 {"id": "cap-b", "kind": "count", "person": "m-bea", "roles": ["Sun.Lead", "Sat.Lead"], "op": "<=",
                  "month": "2026-11", "value": 1}]
        resp = solve(request(s, people, rules=rules))
        self.assertEqual(resp["violations"], [])
        self.assertEqual([m[0] for m in missed(resp)], ["consecutive_sundays"])

    def test_no_consecutive_over_balances(self):
        s = [service("n", S29, seats=dict(LEAD1)), service("d", "2026-12-06", seats=dict(LEAD1))]
        people = [p("m-ana", {"n": ["Lead"], "d": ["Lead"]}, carried={"DL": 500}),
                  p("m-bea", {"n": ["Lead"], "d": ["Lead"]})]
        resp = solve(request(s, people, months=["2026-11", "2026-12"]))
        leads = resp["assignments"]["n"]["Lead"] + resp["assignments"]["d"]["Lead"]
        self.assertEqual(sorted(leads), ["m-ana", "m-bea"])  # the most-owed does not take both weekends
        self.assertEqual(missed(resp), [])


if __name__ == "__main__":
    unittest.main()
```

**Create** `gcf_v3/tests/test_rules_solved.py`:

```python
"""Rule instances solved end to end (spec §5.4, §6.7, §8.1; C5-3, C5-6, C5-16): per-month counts,
the trailing Saturday, month-scoped presence, pairs, specials, consecutive weekends, the mandatory
lead and uncounted services, through the whole pipeline."""

import unittest

from owt_v3.service import handle
from tests.builders import NOV_SATURDAYS, NOV_SUNDAYS, person, pin, request, service

ROLES3 = ["Lead", "BGV", "Choir"]


def solve(body):
    status, resp, _ = handle(body)
    assert status == 200, resp
    return resp


def two_months():
    svcs = [service("n1", "2026-11-22"), service("n2", "2026-11-29"), service("t1", "2026-11-28", kind="saturday"),
            service("d1", "2026-12-06"), service("d2", "2026-12-13")]
    people = [person(p, {s["id"]: (["Lead", "BGV"] if s["kind"] == "saturday" else list(ROLES3)) for s in svcs},
                     exempt=True) for p in ("m-ana", "m-bea", "m-cris", "m-dario", "m-ema", "m-fede", "m-gala")]
    return svcs, people


class Counts(unittest.TestCase):
    def test_count_rules_are_per_month_in_a_two_month_run(self):
        svcs, people = two_months()
        rules = [{"id": "cap-a", "kind": "count", "person": "m-ana", "roles": ["Sun.Lead"], "op": "==",
                  "month": m, "value": v} for m, v in (("2026-11", 2), ("2026-12", 0))]
        resp = solve(request(svcs, people, rules=rules, months=["2026-11", "2026-12"]))
        led = {sid: "m-ana" in resp["assignments"][sid]["Lead"] for sid in ("n1", "n2", "d1", "d2")}
        self.assertEqual(led, {"n1": True, "n2": True, "d1": False, "d2": False})
        self.assertEqual(resp["violations"], [])

    def test_the_trailing_saturday_counts_in_its_own_month(self):
        svcs = [service("o31", "2026-10-31", kind="saturday"), service("n1", "2026-11-01")]
        people = [person(p, {"o31": ["Lead", "BGV"], "n1": list(ROLES3)}, exempt=True)
                  for p in ("m-ana", "m-bea", "m-cris", "m-dario", "m-ema", "m-fede")]
        rules = [{"id": "sat-a", "kind": "count", "person": "m-ana", "roles": ["Sat.Lead"], "op": "==",
                  "month": "2026-10", "value": 1}]
        body = request(svcs, people, rules=rules, months=["2026-10", "2026-11"])
        resp = solve(body)
        self.assertIn("m-ana", resp["assignments"]["o31"]["Lead"])

    def test_an_exact_saturday_lead_above_one_is_off_the_saturday_cap_A16(self):
        svcs = [service("t1", NOV_SATURDAYS[0], kind="saturday"), service("t2", NOV_SATURDAYS[1], kind="saturday")]
        people = [person(p, {"t1": ["Lead", "BGV"], "t2": ["Lead", "BGV"]}, exempt=True)
                  for p in ("m-ana", "m-bea", "m-cris", "m-dario")]
        rules = [{"id": "sat-a", "kind": "count", "person": "m-ana", "roles": ["Sat.Lead"], "op": "==",
                  "month": "2026-11", "value": 2}]
        resp = solve(request(svcs, people, rules=rules))
        self.assertFalse([m for m in resp["missed"] if m["code"] == "saturday_cap_exceeded"])

    def test_each_clamp_is_a_notice(self):
        svcs = [service("s1", NOV_SUNDAYS[0])]
        people = [person("m-ana", {}, exempt=True)] + [
            person(p, {"s1": list(ROLES3)}, exempt=True) for p in ("m-bea", "m-cris", "m-dario")]
        rules = [{"id": "cap-a", "kind": "count", "person": "m-ana", "roles": ["Sun.BGV"], "op": "==",
                  "month": "2026-11", "value": 1},
                 {"id": "min-a", "kind": "count", "person": "m-ana", "roles": ["Sun.Lead"], "op": ">=",
                  "month": "2026-11", "value": 1},
                 {"id": "pr-x", "kind": "presence", "persons": ["m-ana"], "roles": ["Sun.Choir"], "exclusive": False}]
        resp = solve(request(svcs, people, rules=rules))
        self.assertEqual(sorted(n["code"] for n in resp["notices"] if n["code"] != "dl_capacity"),
                         ["exact_clamped", "min_clamped", "presence_not_applicable"])
        self.assertEqual(resp["violations"], [])


class PairsAndPresence(unittest.TestCase):
    def test_a_month_scoped_object_applies_only_in_its_month_C5_16(self):
        svcs, people = two_months()
        rules = [{"id": "pr-1", "kind": "presence", "persons": ["m-ana"], "roles": ["Sun.BGV"], "exclusive": False,
                  "month": "2026-11"},
                 {"id": "pr-1", "kind": "presence", "persons": ["m-bea"], "roles": ["Sun.BGV"], "exclusive": False,
                  "month": "2026-12"}]
        resp = solve(request(svcs, people, rules=rules, months=["2026-11", "2026-12"]))
        for sid in ("n1", "n2"):
            self.assertIn("m-ana", resp["assignments"][sid]["BGV"])
        for sid in ("d1", "d2"):
            self.assertIn("m-bea", resp["assignments"][sid]["BGV"])
        lines = {p["person"]: p["lines"] for p in resp["fairness"]["people"]}
        self.assertIn("P:pr-1", lines["m-ana"])
        self.assertIn("P:pr-1", lines["m-bea"])  # one sub-line spans both months

    def test_a_pair_applies_per_service(self):
        svcs, people = two_months()
        rules = [{"id": "cf-1", "kind": "pair", "persons": ["m-ana", "m-bea"], "roles": ["Sun.Lead", "Sun.BGV"]}]
        resp = solve(request(svcs, people, rules=rules, months=["2026-11", "2026-12"]))
        for sid in ("n1", "n2", "d1", "d2"):
            seated = resp["assignments"][sid]["Lead"] + resp["assignments"][sid]["BGV"]
            self.assertFalse("m-ana" in seated and "m-bea" in seated)

    def test_a_special_never_appears_in_a_rule_instance(self):
        special = service("sp-1", NOV_SUNDAYS[1], kind="special", fixed=True)
        svcs = [service("s1", NOV_SUNDAYS[0]), special]
        people = [person(p, {"s1": list(ROLES3), "sp-1": ["Lead"]}, exempt=True)
                  for p in ("m-ana", "m-bea", "m-cris", "m-dario")]
        rules = [{"id": "cap-a", "kind": "count", "person": "m-ana", "roles": ["Sun.Lead"], "op": "<=",
                  "month": "2026-11", "value": 0}]
        resp = solve(request(svcs, people, rules=rules, pins=[pin(special, "Lead", "m-ana")]))
        self.assertEqual(resp["violations"], [])  # her special Lead is not a rule seat

    def test_pins_that_break_a_pair_are_the_cause(self):
        svcs = [service("s1", NOV_SUNDAYS[0])]
        people = [person(p, {"s1": list(ROLES3)}, exempt=True) for p in ("m-ana", "m-bea", "m-cris", "m-dario")]
        rules = [{"id": "cf-1", "kind": "pair", "persons": ["m-ana", "m-bea"], "roles": ["Sun.BGV"]}]
        resp = solve(request(svcs, people, rules=rules,
                             pins=[pin(svcs[0], "BGV", "m-ana"), pin(svcs[0], "BGV", "m-bea")]))
        self.assertEqual([(v["code"], v["rule"], v["cause"]) for v in resp["violations"]], [("pair", "cf-1", "pins")])
        self.assertEqual(resp["violation_ceiling"], {"value": 1, "proven": True})


class Consecutive(unittest.TestCase):
    def test_links_across_the_month_boundary_and_against_prior(self):
        svcs, people = two_months()
        rules = [{"id": "cs-1", "kind": "consecutive", "person": "m-ana", "roles": ["Sun.Lead"]}]
        prior = {"month": "2026-10", "has_services": True,
                 "services": [{"date": "2026-10-25", "kind": "sunday", "counts": True,
                               "seats": {"Lead": ["m-ana"], "BGV": [], "Choir": []}}]}
        body = request(svcs, people, rules=rules, months=["2026-11", "2026-12"], prior=prior,
                       pins=[pin(svcs[0], "Lead", "m-ana")])
        body["services"].insert(0, service("n0", "2026-11-15"))
        for p in body["people"]:
            p["eligibility"]["n0"] = list(ROLES3)
        resp = solve(body)
        # Nov 22 is pinned; she must not lead Nov 15 or Nov 29 (both neighbours) — no break
        self.assertNotIn("m-ana", resp["assignments"]["n0"]["Lead"])
        self.assertNotIn("m-ana", resp["assignments"]["n2"]["Lead"])
        self.assertEqual(resp["violations"], [])

    def test_a_pin_after_a_prior_seat_is_a_break_caused_by_pins(self):
        svcs = [service("n1", NOV_SUNDAYS[0])]
        people = [person(p, {"n1": list(ROLES3)}, exempt=True) for p in ("m-ana", "m-bea", "m-cris", "m-dario")]
        rules = [{"id": "cs-1", "kind": "consecutive", "person": "m-ana", "roles": ["Sun.Lead"]}]
        prior = {"month": "2026-10", "has_services": True,
                 "services": [{"date": "2026-10-25", "kind": "sunday", "counts": True,
                               "seats": {"Lead": ["m-ana"], "BGV": [], "Choir": []}}]}
        resp = solve(request(svcs, people, rules=rules, prior=prior, pins=[pin(svcs[0], "Lead", "m-ana")]))
        self.assertEqual([(v["code"], v["cause"], v["weekends"]) for v in resp["violations"]],
                         [("consecutive", "pins", ["2026-10-25", "2026-11-01"])])


class MandatoryLead(unittest.TestCase):
    def test_no_possible_lead_is_an_unfilled_reason_not_a_violation(self):
        svcs = [service("s1", NOV_SUNDAYS[0])]
        people = [person(p, {"s1": ["BGV", "Choir"]}, exempt=True) for p in ("m-ana", "m-bea", "m-cris")]
        resp = solve(request(svcs, people))
        self.assertIn({"service": "s1", "role": "Lead", "count": 2, "reason": "no_possible_lead"}, resp["unfilled"])
        self.assertEqual(resp["violations"], [])

    def test_a_mandatory_lead_break_names_the_token(self):
        svcs = [service("s1", NOV_SUNDAYS[0], seats={"Lead": 1, "BGV": 1, "Choir": 0})]
        people = [person("m-ana", {"s1": ["Lead", "BGV"]}, exempt=True)]  # the only possible lead…
        resp = solve(request(svcs, people, pins=[pin(svcs[0], "BGV", "m-ana")]))  # …pinned in BGV
        self.assertEqual(resp["violations"], [{"code": "mandatory_lead", "rule": "mandatory_lead", "cause": "pins",
                                               "service": "s1", "month": "2026-11"}])
        self.assertEqual(resp["violation_ceiling"], {"value": 1, "proven": True})


class Uncounted(unittest.TestCase):
    def test_uncounted_services_stay_out_of_lines_and_protections_C5_3(self):
        svcs = [service("s1", NOV_SUNDAYS[0], counts=False)]
        people = [person(p, {"s1": list(ROLES3)}) for p in ("m-ana", "m-bea", "m-cris", "m-dario", "m-ema",
                                                                "m-fede", "m-gala", "m-iris")]
        resp = solve(request(svcs, people))
        self.assertEqual(resp["missed"], [])  # no voice floor instance: nothing counted
        for p in resp["fairness"]["people"]:
            self.assertEqual(p["lines"], {})


if __name__ == "__main__":
    unittest.main()
```

**Create** `gcf_v3/tests/test_service.py`:

```python
"""The function's core end to end (spec §5.8, §8): a request in, a response out — refusals as
422 never 500, ids echoed verbatim, every field present and every code listed."""

import copy
import unittest

from owt_v3.codes import audit_response
from owt_v3.service import handle, public_label
from tests.test_model import random_request
from tests.test_request import EXAMPLE

FIELDS = ("ok", "contract", "engine", "solver_version", "build", "request_id", "seed", "months", "reproducible",
          "assignments", "unfilled", "pins", "violations", "violation_ceiling", "stages", "total_ms", "fairness",
          "cadence", "missed", "notices")


class Core(unittest.TestCase):
    def test_the_example_solves(self):
        status, resp, _ = handle(copy.deepcopy(EXAMPLE))
        self.assertEqual(status, 200, resp)
        self.assertEqual((resp["request_id"], resp["seed"], resp["months"]), ("r-7f3a", 418207, ["2026-11"]))
        self.assertEqual(resp["assignments"]["sundayRole-8f2c"], {"Lead": ["m-bruno"], "BGV": [], "Choir": []})
        self.assertEqual(resp["assignments"]["p-2026-11-07-sat"].keys(), {"Lead", "BGV"})

    def test_refusals_answer_422_never_500(self):
        body = copy.deepcopy(EXAMPLE)
        body["services"][0]["date"] = "2026-02-30"
        status, resp, _ = handle(body)
        self.assertEqual((status, resp["ok"], resp["code"], resp["contract"], resp["engine"]),
                         (422, False, "invalid_request", 3, "v3"))
        self.assertEqual(handle([1, 2])[0], 422)

    def test_a_200_character_service_id_is_echoed_verbatim(self):
        body = copy.deepcopy(EXAMPLE)
        long_id = "a+b/" + "x" * 196
        body["services"][0]["id"] = long_id
        for p in body["people"]:
            if "p-2026-11-01-sun" in p["eligibility"]:
                p["eligibility"][long_id] = p["eligibility"].pop("p-2026-11-01-sun")
        status, resp, _ = handle(body)
        self.assertEqual(status, 200)
        self.assertIn(long_id, resp["assignments"])
        self.assertTrue(all(u["service"] in resp["assignments"] for u in resp["unfilled"]))
        seats = [f["seat"]["service"] for p in resp["fairness"]["people"] for f in p["floor"] if f["seat"]]
        self.assertTrue(all(s in resp["assignments"] for s in seats))

    def test_every_field_and_every_code_is_listed(self):
        for k in range(6):
            status, resp, _ = handle(random_request(k))
            self.assertEqual(status, 200)
            for key in FIELDS:
                self.assertIn(key, resp)
            self.assertEqual(audit_response(resp), [], f"request {k}")
            for person_ in resp["fairness"]["people"]:
                for f in list(person_["lines"].values()) + list(person_["tabs"].values()):
                    self.assertEqual(f["after"], f["carried"] + f["share"] - f["received"])
                    self.assertEqual((f["seats"] * 100, f["pinned_seats"] * 100), (f["received"], f["pinned"]))

    def test_the_ping(self):
        status, resp, log = handle({"contract": 3, "ping": True})
        self.assertEqual((status, resp["pin_cap"], resp["engine"]), (200, 250, "v3"))
        self.assertTrue(log["ping"])

    def test_public_labels(self):
        self.assertEqual(public_label("balance_max:P:pr-9", ["pr-1", "pr-9"]), "balance_max:P#2")
        self.assertEqual(public_label("balance_sq:DL", ["pr-1"]), "balance_sq:DL")
        self.assertEqual(public_label("rules", []), "rules")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run them to see them fail**

Run: `(cd gcf_v3 && "$PY" -m unittest tests.test_stages tests.test_ranking tests.test_rules_solved tests.test_service)`
Expected: FAIL — `ModuleNotFoundError: No module named 'owt_v3.service'` (and `owt_v3.solver`).

- [ ] **Step 3: Implement**

**Create** `gcf_v3/owt_v3/stages.py`:

```python
"""Stage runner (spec §7.1–§7.3, S3): each stage solved, then fixed at the value it found
before the next one runs; fixed CP-SAT settings; a deterministic limit per stage with a
wall-clock guard; a total budget counted from the start of model build.
"""

import time

from ortools.sat.python import cp_model

from .codes import code
from .constants import STAGE_START_FLOOR


class SolveTimeout(Exception):
    """`rules` or `fill` found no solution within its limits (§7.3)."""

    def __init__(self, stage, seconds):
        super().__init__("timeout")
        self.stage, self.seconds = stage, seconds


class SolverDefect(Exception):
    """A proven INFEASIBLE (or an invalid model) in any stage: a defect, never «no solution»."""

    def __init__(self, stage):
        super().__init__("internal_error")
        self.stage = stage


def stage_parameters(solver, seed, det_limit, wall):
    p = solver.parameters
    p.num_search_workers = 1
    p.linearization_level = 2
    p.random_seed = seed
    p.max_deterministic_time = det_limit
    p.max_time_in_seconds = wall
    return p


class Runner:
    def __init__(self, model, budget, seed, clock=time.perf_counter, solver_for=None, started=None):
        """`solver_for(stage_id)` returns the CP-SAT solver of one stage (tests stub it)."""
        self.model, self.budget, self.seed = model, budget, seed
        self.clock = clock
        self.solver_for = solver_for or (lambda stage_id: cp_model.CpSolver())
        self.started = clock() if started is None else started
        self.records = []
        self.parameters = []  # (stage id, CP-SAT parameters) — for tests; never on the wire
        self.values = None  # the last solution: {cell: 0/1}
        self.received = None
        self.stopped = False
        self._hint = None

    def remaining(self):
        return self.budget.total_seconds - (self.clock() - self.started)

    def _record(self, stage_id, status, value=0, bound=0, limit="none", ms=0, det_milli=0, reason=None):
        rec = {"id": code("stage", stage_id), "status": code("stage_status", status)}
        if reason is not None:
            rec["reason"] = code("stage_reason", reason)
        rec.update(value=value, bound=bound, limit=code("limit", limit), ms=ms, det_milli=det_milli)
        self.records.append(rec)
        return rec

    def skip_rest(self, stage_ids):
        for sid in stage_ids:
            self._record(sid, "not_run", reason="stopped_earlier")

    def run(self, stage_id, objective, has_terms, sense="min", fix=True, essential=False):
        """Solve one stage. Returns the record. `essential` stages (rules, fill) raise on no solution."""
        if self.stopped:
            return self._record(stage_id, "not_run", reason="stopped_earlier")
        if not has_terms:
            return self._record(stage_id, "proven")
        remaining = self.remaining()
        if remaining < STAGE_START_FLOOR:
            if essential:
                raise SolveTimeout(stage_id, round(self.clock() - self.started, 3))
            return self._record(stage_id, "not_run", reason="budget")
        m = self.model.m
        if sense == "min":
            m.Minimize(objective)
        else:
            m.Maximize(objective)
        solver = self.solver_for(stage_id)
        wall = min(self.budget.stage_seconds, remaining)
        self.parameters.append((stage_id, stage_parameters(solver, self.seed, self.budget.stage_det_limit, wall)))
        t0 = self.clock()
        status = solver.Solve(m)
        ms = int(round((self.clock() - t0) * 1000))
        det = solver.ResponseProto().deterministic_time
        det_milli = int(round(det * 1000))
        if status in (cp_model.INFEASIBLE, cp_model.MODEL_INVALID):
            raise SolverDefect(stage_id)
        if status == cp_model.OPTIMAL:
            limit = "none"
        else:
            limit = "deterministic" if det >= self.budget.stage_det_limit * 0.999 else "wall"
        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            if essential:
                raise SolveTimeout(stage_id, round(self.clock() - self.started, 3))
            self.stopped = True
            return self._record(stage_id, "not_run", limit=limit, ms=ms, det_milli=det_milli,
                                reason="no_solution_in_limit")
        value = int(round(solver.ObjectiveValue()))
        bound = int(round(solver.BestObjectiveBound()))
        if fix:
            m.Add(objective <= value) if sense == "min" else m.Add(objective >= value)
        m.ClearHints()
        for v in self.model.allvars:
            m.AddHint(v, solver.Value(v))
        self.values = {c: solver.Value(v) for c, v in self.model.x.items()}
        self.received = {k: solver.Value(v) for k, v in self.model.n.items()}  # tests: model view of §6.6
        return self._record(stage_id, "proven" if status == cp_model.OPTIMAL else "unproven",
                            value=value, bound=bound, limit=limit, ms=ms, det_milli=det_milli)
```

**Create** `gcf_v3/owt_v3/solver.py`:

```python
"""The stage pipeline (spec §7.1): validation and planned shares before the budget, then
model build, the stages in order, and the report after it.
"""

import time

from .facts import Facts
from .instances import build_instances
from .model import Model
from .plan import compute_plan
from .report import Report
from .stages import Runner

PROTECTION_STAGES = ("cadence", "compensation", "voice_floor", "dl_floor", "sunday_cap", "saturday_cap",
                     "no_consecutive")


def stage_ids(problem):
    ids = ["rules", "fill", *PROTECTION_STAGES]
    for line in problem.lines:
        ids += [f"balance_max:{line}", f"balance_sq:{line}"]
    return ids + ["tiebreak"]


def solve_problem(problem, clock=time.perf_counter, solver_for=None, consecutive_last=False):
    """Returns (Report, runner, model). Raises SolveTimeout / SolverDefect (§7.3).

    `consecutive_last` is the acceptance harness's run O only (the prototype's order, with
    `no_consecutive` after the balances); it never reaches the wire.
    """
    F = Facts(problem)
    plan = compute_plan(F)
    instances, notices = build_instances(F)
    started = clock()  # the 25 s budget counts from the start of model build (§7.2)
    model = Model(F, plan, instances)
    runner = Runner(model, problem.budget, problem.seed, clock=clock, solver_for=solver_for, started=started)
    rec = runner.run("rules", *model.obj_rules(), essential=True)
    ceiling = rec["value"]
    runner.run("fill", *model.obj_fill(), sense="max", essential=True)
    for stage in PROTECTION_STAGES:
        if consecutive_last and stage == "no_consecutive":
            continue
        runner.run(stage, *getattr(model, f"obj_{stage}")())
    carried = lambda p, line: problem.people[p].carried.get(line, 0)
    for line in problem.lines:
        inputs = model.balance_inputs(carried, line)
        runner.run(f"balance_max:{line}", *model.obj_balance_max(inputs))
        runner.run(f"balance_sq:{line}", *model.obj_balance_sq(inputs))
    if consecutive_last:
        runner.run("no_consecutive", *model.obj_no_consecutive())
    runner.run("tiebreak", *model.obj_tiebreak(problem.seed), fix=False)
    values = runner.values
    if values is None:  # every stage had no terms: the only seats are pins
        values = {c: 1 if c in F.pinned else 0 for c in F.cells}
    report = Report(F, plan, instances, notices, runner.records, values, ceiling)
    return report, runner, model
```

**Create** `gcf_v3/owt_v3/service.py`:

```python
"""The function's core, shared by the HTTP entry (`gcf_v3/main.py`) and the CLI
(`gcf_v3/owt_solver_v3.py`): raw body in, (HTTP status, response, log record) out.

Logs carry counts, timings and status codes only (C5-17, spec §11.2): never a name, an
id, a rule key, a line key, a month, the `request_id`, the body, an exception message
or a traceback. A stage is logged by its PUBLIC LABEL (`P:<id>` → `P#<n>`).
"""

import json
import os
import re
import sys
import time

from .codes import Refusal, code
from .constants import CONTRACT, ENGINE, PIN_CAP, SOLVER_VERSION
from .request import is_ping, parse_request
from .solver import solve_problem
from .stages import SolveTimeout, SolverDefect

HTTP_OF = {"invalid_json": 400, "unauthorized": 401, "method_not_allowed": 405, "misconfigured": 503,
           "internal_error": 500}


def build_id():
    return os.environ.get("OWT_SOLVER_V3_BUILD") or "unknown"


def public_label(stage_id, presence_ids):
    """`balance_max:P:<id>` → `balance_max:P#<n>`; every other stage id is its own label."""
    m = re.match(r"^(balance_(?:max|sq)):P:(.+)$", stage_id)
    if not m:
        return stage_id
    ids = list(presence_ids)
    n = ids.index(m.group(2)) + 1 if m.group(2) in ids else 0
    return f"{m.group(1)}:P#{n}"


def failure(name, **params):
    code("error", name)
    return {"ok": False, "contract": CONTRACT, "engine": ENGINE, "code": name, "params": params}


def _sizes(body):
    def n(key):
        v = body.get(key) if isinstance(body, dict) else None
        return len(v) if isinstance(v, list) else 0
    return {"months": n("months"), "services": n("services"), "people": n("people"),
            "rules": n("rules"), "pins": n("pins")}


def _presence_ids(body):
    ids = []
    rules = body.get("rules") if isinstance(body, dict) else None
    for r in rules if isinstance(rules, list) else []:
        if isinstance(r, dict) and r.get("kind") == "presence" and isinstance(r.get("id"), str):
            if r["id"] not in ids:
                ids.append(r["id"])
    return ids


def handle(body, clock=time.perf_counter, solver_for=None):
    """A parsed JSON body → (status, response, log record)."""
    t0 = clock()
    log = {"event": "owt-solver-v3", "sizes": _sizes(body)}
    try:
        if is_ping(body):
            resp = {"ok": True, "contract": CONTRACT, "engine": ENGINE, "solver_version": SOLVER_VERSION,
                    "build": build_id(), "pin_cap": PIN_CAP}
            log.update(http=200, ping=True)
            return 200, resp, log
        problem = parse_request(body)
        if problem is None:  # unreachable: parse_request returns None only for a ping
            raise Refusal("invalid_request", field="ping", detail="type")
        report, runner, _ = solve_problem(problem, clock=clock, solver_for=solver_for)
        total_ms = int(round((clock() - t0) * 1000))
        labels = problem.presence_ids
        stages = runner.records
        resp = {
            "ok": True, "contract": CONTRACT, "engine": ENGINE, "solver_version": SOLVER_VERSION,
            "build": build_id(), "request_id": problem.request_id, "seed": problem.seed,
            "months": list(problem.months),
            "reproducible": all(s["status"] == "proven" for s in stages),
            "assignments": report.assignment,
            "unfilled": report.unfilled(),
            "pins": report.pins(),
            "violations": report.violations(),
            "violation_ceiling": {"value": report.ceiling, "proven": report.status.get("rules") == "proven"},
            "stages": stages,
            "total_ms": total_ms,
            "fairness": report.fairness(),
            "cadence": report.cadence(),
            "missed": report.missed(),
            "notices": report.notices,
        }
        log.update(http=200, total_ms=total_ms, stages=[
            {"label": public_label(s["id"], labels), "status": s["status"], "limit": s["limit"],
             "ms": s["ms"], "det_milli": s["det_milli"]} for s in stages])
        return 200, resp, log
    except Refusal as r:
        log.update(http=422, code=r.code)
        if r.code == "too_many_pins":
            log.update(count=r.params["count"], cap=r.params["cap"])
        return 422, failure(r.code, **r.params), log
    except SolveTimeout as t:
        log.update(http=422, code="timeout", stage=public_label(t.stage, _presence_ids(body)), seconds=t.seconds)
        return 422, failure("timeout", stage=t.stage, seconds=t.seconds), log
    except SolverDefect as d:
        log.update(http=500, code="internal_error", stage=public_label(d.stage, _presence_ids(body)))
        return 500, failure("internal_error"), log
    except Exception as e:  # never a message, an argument or a traceback: a KeyError's message is the key
        log.update(http=500, code="internal_error", exception=type(e).__name__)
        return 500, failure("internal_error"), log
    finally:
        log.setdefault("total_ms", int(round((clock() - t0) * 1000)))


def handle_raw(data, clock=time.perf_counter):
    """Raw bytes or text → (status, response, log record); unparseable JSON is `invalid_json` (400)."""
    try:
        body = json.loads(data)
    except (ValueError, TypeError):
        log = {"event": "owt-solver-v3", "http": 400, "code": "invalid_json"}
        return 400, failure("invalid_json"), log
    return handle(body, clock=clock)


def emit_log(record, stream=None):
    print(json.dumps(record, sort_keys=True), file=stream or sys.stderr, flush=True)
```

- [ ] **Step 4: Run the suites and the layout guard**

Run: `"$PY" -m unittest discover -s gcf_v3 -t gcf_v3 2>&1 | tail -3 && npx vitest run scripts/__tests__/ciLayout.test.ts 2>&1 | tail -4 && "$PY" -m unittest discover -s gcf -t gcf 2>&1 | tail -3`
Expected: `Ran 133 tests … OK`; `Tests  51 passed (51)`; v2 `Ran 105 tests … OK (skipped=1)`.

- [ ] **Step 5: Commit**

```bash
git add gcf_v3/owt_v3/stages.py gcf_v3/owt_v3/solver.py gcf_v3/owt_v3/service.py gcf_v3/tests/test_stages.py gcf_v3/tests/test_ranking.py gcf_v3/tests/test_rules_solved.py gcf_v3/tests/test_service.py
git commit -m "feat(solver-v3): the stage pipeline and the function's core" -m "Spec C5 §7: rules first (its value is the ceiling no later stage may raise), then fill, cadence, compensation, the floors, the caps, no consecutive Sundays, the per-line balances and the tie-break, each solved and fixed before the next under one worker, linearization 2, a deterministic limit and a 2.5 s wall guard inside a 25 s budget. rules or fill without a solution answer timeout; a proven INFEASIBLE is a defect (500); a later stage without one ends the run honestly. Ranking is tested pair by pair on instances built to trade one protection for the next."
```

---

## Task 10: The entry points and log hygiene

Spec §11.1 (`main.py`, `owt_solver_v3.py --json-mode`), §11.2 (OPTIONS 204, 405, fail-closed 503, 401 in constant time, 400 `invalid_json`, 500 `internal_error`, key read once at import; logs carry counts, timings and status codes only; public labels), §8.3, §8.4 (ping), C5-17; §12.1 «Handler» (v2's five guard cases; constant time; unparseable JSON; no stack trace; the marker test for handler and CLI stderr).

**Files:**
- Create: `gcf_v3/main.py`, `gcf_v3/owt_solver_v3.py`, `gcf_v3/tests/test_main.py`, `gcf_v3/tests/test_cli.py`, `gcf_v3/tests/test_logs.py`

**Interfaces:**
- Consumes: `service.handle_raw`, `service.emit_log`, `service.failure` (Task 9).
- Produces: `main.solve(request)` (the Cloud Function entry; `request` has `.method`, `.headers`, `.get_data()`); `owt_solver_v3.main(argv) -> exit code`. `tests/test_logs.py` exports `MARK` and `marked()` (used by Task 14).

- [ ] **Step 1: Write the failing tests**

**Create** `gcf_v3/tests/test_main.py`:

```python
"""The HTTP entry point (spec §11.2): v2's fail-closed guard, reproduced, plus v3's codes.

functions_framework is stubbed so the handler imports without it (CI installs it anyway).
"""

import importlib
import io
import json
import os
import sys
import types
import unittest
from contextlib import redirect_stderr
from unittest import mock

_ff = types.ModuleType("functions_framework")
_ff.http = lambda fn: fn
sys.modules["functions_framework"] = _ff

from tests.test_request import EXAMPLE  # noqa: E402


class FakeRequest:
    def __init__(self, method="POST", headers=None, body=b""):
        self.method = method
        self.headers = headers or {}
        self._body = body

    def get_data(self):
        return self._body


def load_main(api_key):
    if api_key is None:
        os.environ.pop("OWT_SOLVER_API_KEY", None)
    else:
        os.environ["OWT_SOLVER_API_KEY"] = api_key
    import main
    return importlib.reload(main)  # re-reads the key, as a new instance would


def call(main, req):
    with redirect_stderr(io.StringIO()) as err:
        body, status, headers = main.solve(req)
    return status, (json.loads(body) if body else None), err.getvalue()


class ApiKeyGuard(unittest.TestCase):
    def test_fail_closed_when_key_unset(self):
        status, body, _ = call(load_main(None), FakeRequest(headers={"X-Api-Key": "anything"}))
        self.assertEqual((status, body["code"]), (503, "misconfigured"))

    def test_fail_closed_when_key_empty(self):
        status, _, _ = call(load_main(""), FakeRequest(headers={"X-Api-Key": ""}))
        self.assertEqual(status, 503)

    def test_unauthorized_on_wrong_key(self):
        status, body, _ = call(load_main("secret"), FakeRequest(headers={"X-Api-Key": "wrong"}))
        self.assertEqual((status, body["code"]), (401, "unauthorized"))

    def test_unauthorized_on_missing_key(self):
        status, _, _ = call(load_main("secret"), FakeRequest(headers={}))
        self.assertEqual(status, 401)

    def test_method_not_allowed_before_anything(self):
        status, body, _ = call(load_main("secret"), FakeRequest(method="GET", headers={"X-Api-Key": "secret"}))
        self.assertEqual((status, body["code"]), (405, "method_not_allowed"))

    def test_options_is_cors(self):
        body, status, headers = load_main("secret").solve(FakeRequest(method="OPTIONS"))
        self.assertEqual(status, 204)
        self.assertIn("X-Api-Key", headers["Access-Control-Allow-Headers"])

    def test_valid_request_solves(self):
        status, body, _ = call(load_main("secret"), FakeRequest(headers={"X-Api-Key": "secret"},
                                                                  body=json.dumps(EXAMPLE).encode()))
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])
        self.assertEqual((body["contract"], body["engine"]), (3, "v3"))

    def test_the_key_is_compared_in_constant_time(self):
        main = load_main("secret")
        with mock.patch.object(main.hmac, "compare_digest", wraps=main.hmac.compare_digest) as spy:
            call(main, FakeRequest(headers={"X-Api-Key": "wrong"}))
        spy.assert_called_once_with(b"wrong", b"secret")


class Answers(unittest.TestCase):
    def test_unparseable_json_is_400(self):
        status, body, _ = call(load_main("secret"), FakeRequest(headers={"X-Api-Key": "secret"}, body=b"{nope"))
        self.assertEqual((status, body), (400, {"ok": False, "contract": 3, "engine": "v3", "code": "invalid_json",
                                                "params": {}}))

    def test_a_refusal_is_422(self):
        status, body, _ = call(load_main("secret"), FakeRequest(headers={"X-Api-Key": "secret"},
                                                                  body=json.dumps({"contract": 2}).encode()))
        self.assertEqual((status, body["code"]), (422, "contract_mismatch"))

    def test_the_ping_answers_and_builds_no_model(self):
        main = load_main("secret")
        with mock.patch.dict(os.environ, {"OWT_SOLVER_V3_BUILD": "abc1234"}):
            status, body, _ = call(main, FakeRequest(headers={"X-Api-Key": "secret"},
                                                     body=json.dumps({"contract": 3, "ping": True}).encode()))
        self.assertEqual((status, body), (200, {"ok": True, "contract": 3, "engine": "v3", "solver_version": "3.0.0",
                                                "build": "abc1234", "pin_cap": 250}))

    def test_a_500_carries_no_stack_trace(self):
        main = load_main("secret")
        with mock.patch.object(main, "handle_raw", side_effect=RuntimeError("boom at /secret/path")):
            status, body, err = call(main, FakeRequest(headers={"X-Api-Key": "secret"}, body=b"{}"))
        self.assertEqual((status, body["code"]), (500, "internal_error"))
        self.assertNotIn("Traceback", json.dumps(body) + err)
        self.assertNotIn("boom", json.dumps(body) + err)
        self.assertIn('"exception": "RuntimeError"', err)


if __name__ == "__main__":
    unittest.main()
```

**Create** `gcf_v3/tests/test_cli.py`:

```python
"""The `--json-mode` CLI (spec §11.1): one request on stdin, one response on stdout, exit 0."""

import json
import os
import subprocess
import sys
import unittest

from tests.test_request import EXAMPLE

SCRIPT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "owt_solver_v3.py")


def run(stdin, *args):
    return subprocess.run([sys.executable, SCRIPT, *args], input=stdin, capture_output=True, timeout=120)


class JsonMode(unittest.TestCase):
    def test_solves_one_request(self):
        done = run(json.dumps(EXAMPLE).encode(), "--json-mode")
        self.assertEqual(done.returncode, 0)
        self.assertTrue(json.loads(done.stdout)["ok"])

    def test_a_refusal_still_exits_zero(self):
        done = run(json.dumps({"contract": 2}).encode(), "--json-mode")
        self.assertEqual(done.returncode, 0)
        self.assertEqual(json.loads(done.stdout)["code"], "contract_mismatch")

    def test_unparseable_json_is_invalid_json(self):
        done = run(b"{nope", "--json-mode")
        self.assertEqual((done.returncode, json.loads(done.stdout)["code"]), (0, "invalid_json"))

    def test_without_the_flag_it_prints_usage(self):
        self.assertEqual(run(b"{}").returncode, 2)

    def test_runs_from_the_repository_root(self):
        root = os.path.dirname(os.path.dirname(SCRIPT))
        done = subprocess.run([sys.executable, "gcf_v3/owt_solver_v3.py", "--json-mode"], cwd=root,
                              input=json.dumps({"contract": 3, "ping": True}).encode(), capture_output=True,
                              timeout=60)
        self.assertEqual(json.loads(done.stdout)["pin_cap"], 250)


if __name__ == "__main__":
    unittest.main()
```

**Create** `gcf_v3/tests/test_logs.py`:

```python
"""Request and response contents stay off every log (C5-17, spec §11.2, §12.1 «Handler»).

A request whose request_id, rule ids, carried P: keys, person ids, names and service ids
each carry a marker is run to success, to a stage stopped inside a `balance_max:P:<id>`
stage, to a `timeout`, to a refusal whose field names a marked id, and to an unexpected
KeyError whose key is a marked id. No log line (handler or CLI stderr) may contain the
marker. The checker and the harness summary over the same pairs: test_public_outputs.py.
"""

import io
import json
import os
import subprocess
import sys
import unittest
from contextlib import redirect_stderr

from ortools.sat.python import cp_model

from owt_v3.service import emit_log, handle
from tests.builders import NOV_SUNDAYS, person, request, service
from tests.test_stages import stub

MARK = "zq7marker"
GCF_V3 = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def marked():
    s = [service(f"svc-{MARK}-1", NOV_SUNDAYS[0]), service(f"svc-{MARK}-2", NOV_SUNDAYS[1])]
    ids = [f"m-{MARK}-{i}" for i in range(6)]
    people = [person(pid, {x["id"]: ["Lead", "BGV", "Choir"] for x in s}, name=f"Name {MARK} {i}",
                     carried={f"P:pres-{MARK}": 10}) for i, pid in enumerate(ids)]
    rules = [{"id": f"pres-{MARK}", "kind": "presence", "persons": ids[:2], "roles": ["Sun.BGV"], "exclusive": False},
             {"id": f"cap-{MARK}", "kind": "count", "person": ids[2], "roles": ["Sun.Lead"], "op": "<=",
              "month": "2026-11", "value": 1},
             {"id": f"pair-{MARK}", "kind": "pair", "persons": ids[3:5], "roles": ["Sun.Lead"]}]
    return request(s, people, rules=rules, request_id=f"req-{MARK}")


def logged(body, **kw):
    status, resp, log = handle(body, **kw)
    with redirect_stderr(io.StringIO()) as err:
        emit_log(log)
    return status, resp, err.getvalue()


class Hygiene(unittest.TestCase):
    def assertClean(self, text):
        self.assertNotIn(MARK, text)

    def test_success_logs_counts_timings_and_public_labels(self):
        status, resp, line = logged(marked())
        self.assertEqual(status, 200)
        self.assertIn(MARK, json.dumps(resp))  # the wire carries ids by design
        self.assertClean(line)
        self.assertIn("balance_max:P#1", line)

    def test_a_stopped_presence_stage_logs_its_public_label(self):
        status, resp, line = logged(marked(), solver_for=stub({f"balance_max:P:pres-{MARK}"}))
        self.assertEqual(status, 200)
        self.assertClean(line)
        self.assertIn('"label": "balance_max:P#1", "limit"', line)

    def test_a_timeout_logs_code_stage_label_and_seconds(self):
        status, resp, line = logged(marked(), solver_for=stub({"rules"}))
        self.assertEqual((status, resp["code"]), (422, "timeout"))
        self.assertClean(line)

    def test_a_refusal_logs_its_code_only(self):
        body = marked()
        body["people"][0]["eligibility"][f"nope-{MARK}"] = ["Lead"]
        status, resp, line = logged(body)
        self.assertEqual((status, resp["code"]), (422, "unknown_service"))
        self.assertIn(MARK, json.dumps(resp))
        self.assertClean(line)

    def test_an_unexpected_key_error_logs_its_class_alone(self):
        class Boom(cp_model.CpSolver):
            def Solve(self, model, *a, **k):
                raise KeyError(f"m-{MARK}-0")
        status, resp, line = logged(marked(), solver_for=lambda stage: Boom())
        self.assertEqual((status, resp["code"]), (500, "internal_error"))
        self.assertClean(line)
        self.assertIn('"exception": "KeyError"', line)

    def test_the_cli_stderr_carries_no_marker(self):
        for body in (marked(), dict(marked(), contract=9)):
            done = subprocess.run([sys.executable, os.path.join(GCF_V3, "owt_solver_v3.py"), "--json-mode"],
                                  input=json.dumps(body).encode(), capture_output=True, timeout=120)
            self.assertEqual(done.returncode, 0)
            self.assertClean(done.stderr.decode())
            json.loads(done.stdout)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run them to see them fail**

Run: `(cd gcf_v3 && "$PY" -m unittest tests.test_main tests.test_cli tests.test_logs)`
Expected: FAIL — `ModuleNotFoundError: No module named 'main'`, and the CLI tests fail on a missing `owt_solver_v3.py`.

- [ ] **Step 3: Implement**

**Create** `gcf_v3/main.py`:

```python
"""Google Cloud Function — the OWT solver v3 HTTP endpoint (`owt-solver-v3`, entry `solve`).

Deployed from `gcf_v3/` by `gcf_v3/cloudbuild.yaml` (trigger `owt-solver-v3-deploy`) or
by `scripts/deploy-solver-v3-gcf.sh`. Imports nothing from `gcf/` (v2).

Environment:
    OWT_SOLVER_API_KEY    shared secret, from Secret Manager `owt-solver-api-key`; Vercel
                          sends it as `X-Api-Key`. REQUIRED: unset or empty fails closed (503).
    OWT_SOLVER_V3_BUILD   the deployed commit, echoed as `build` (absent → "unknown").
"""

import hmac
import json
import os
import sys

import functions_framework

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from owt_v3.service import emit_log, failure, handle_raw  # noqa: E402

_API_KEY = os.environ.get("OWT_SOLVER_API_KEY", "")  # read once, at import (spec §11.2)

_CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Api-Key",
}
_JSON = {"Content-Type": "application/json"}


def _answer(status, body, log):
    emit_log(log)
    return (json.dumps(body), status, _JSON)


@functions_framework.http
def solve(request):
    try:
        if request.method == "OPTIONS":
            return ("", 204, _CORS)
        if request.method != "POST":
            return _answer(405, failure("method_not_allowed"), {"event": "owt-solver-v3", "http": 405,
                                                                 "code": "method_not_allowed"})
        # API key guard — FAIL CLOSED: the function is publicly invokable, so the key is the
        # only barrier to a CPU-heavy solve. An unset key rejects everything.
        if not _API_KEY:
            return _answer(503, failure("misconfigured"), {"event": "owt-solver-v3", "http": 503,
                                                            "code": "misconfigured"})
        sent = request.headers.get("X-Api-Key") or ""
        if not hmac.compare_digest(sent.encode("utf-8"), _API_KEY.encode("utf-8")):
            return _answer(401, failure("unauthorized"), {"event": "owt-solver-v3", "http": 401,
                                                           "code": "unauthorized"})
        status, body, log = handle_raw(request.get_data())
        return _answer(status, body, log)
    except Exception as e:  # never a message, an argument or a traceback
        return _answer(500, failure("internal_error"), {"event": "owt-solver-v3", "http": 500,
                                                         "code": "internal_error",
                                                         "exception": type(e).__name__})
```

**Create** `gcf_v3/owt_solver_v3.py`:

```python
"""The v3 solver's local entry point — C6's local-dev path, the v3 equivalent of
`app/api/admin/solve/route.ts`'s `--json-mode` spawn of v2.

    python gcf_v3/owt_solver_v3.py --json-mode < request.json > response.json

Reads one request on stdin and writes one response on stdout. Exits 0, including for
`ok: false`. Stderr carries the same log lines as the HTTP handler and nothing else.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from owt_v3.service import emit_log, failure, handle_raw  # noqa: E402


def main(argv):
    if argv[1:] != ["--json-mode"]:
        print("usage: owt_solver_v3.py --json-mode < request.json", file=sys.stderr)
        return 2
    try:
        _, body, log = handle_raw(sys.stdin.buffer.read())
    except Exception as e:  # never a message or a traceback
        body, log = failure("internal_error"), {"event": "owt-solver-v3", "http": 500,
                                                "code": "internal_error", "exception": type(e).__name__}
    emit_log(log)
    sys.stdout.write(json.dumps(body))
    sys.stdout.write("\n")
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
```

- [ ] **Step 4: Run the suite and the layout guard**

Run: `"$PY" -m unittest discover -s gcf_v3 -t gcf_v3 2>&1 | tail -3 && npx vitest run scripts/__tests__/ciLayout.test.ts 2>&1 | tail -4`
Expected: `Ran 156 tests … OK`; `Tests  51 passed (51)`.

- [ ] **Step 5: Commit**

```bash
git add gcf_v3/main.py gcf_v3/owt_solver_v3.py gcf_v3/tests/test_main.py gcf_v3/tests/test_cli.py gcf_v3/tests/test_logs.py
git commit -m "feat(solver-v3): HTTP entry with v2's fail-closed guard, and the json-mode CLI" -m "main.solve keeps v2's guard (503 unset, 401 wrong or missing, compared with hmac.compare_digest) and adds v3's codes (400 invalid_json, 405, 422, 500 internal_error with no message or traceback). Every request logs one JSON line of counts, timings, status codes and public stage labels: a marker planted in every request identifier never reaches the handler's log or the CLI's stderr (C5-17)."
```

---

## Task 11: Determinism

Spec §10 (S5): same request and seed → same response apart from `ms`, `total_ms` and `build` whenever every stage is proven; independent of `PYTHONHASHSEED` and dict/set order; with and without pins; C5-R10.

**Files:**
- Create: `gcf_v3/tests/test_determinism.py`

**Interfaces:**
- Consumes: `service.handle` (Task 9), `random_request` (Task 8), the CLI (Task 10).
- Produces: nothing new.

- [ ] **Step 1: Write the test**

**Create** `gcf_v3/tests/test_determinism.py`:

```python
"""Determinism (S5, spec §10): the same request and seed give byte-identical responses apart
from timing fields — in one process, and across processes with different PYTHONHASHSEED —
with and without pins. Only runs where every stage is proven promise it."""

import json
import os
import subprocess
import sys
import unittest

from owt_v3.service import handle
from tests.test_model import random_request

SCRIPT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "owt_solver_v3.py")


def strip(resp):
    out = dict(resp)
    out.pop("total_ms", None)
    out.pop("build", None)
    out["stages"] = [{k: v for k, v in s.items() if k != "ms"} for s in resp["stages"]]
    return json.dumps(out, sort_keys=True)


def bodies():
    with_pins = random_request(5)
    assert with_pins["pins"], "the fixture request must carry pins"
    without = random_request(5)
    without["pins"] = []
    return {"with pins": with_pins, "without pins": without}


class SameProcess(unittest.TestCase):
    def test_two_runs_are_identical(self):
        for label, body in bodies().items():
            _, a, _ = handle(json.loads(json.dumps(body)))
            _, b, _ = handle(json.loads(json.dumps(body)))
            self.assertTrue(a["reproducible"], label)
            self.assertEqual(strip(a), strip(b), label)


class AcrossProcesses(unittest.TestCase):
    def test_hash_seeds_do_not_matter(self):
        for label, body in bodies().items():
            outs = []
            for hash_seed in ("0", "12345"):
                env = dict(os.environ, PYTHONHASHSEED=hash_seed)
                done = subprocess.run([sys.executable, SCRIPT, "--json-mode"], input=json.dumps(body).encode(),
                                      capture_output=True, env=env, timeout=120)
                outs.append(strip(json.loads(done.stdout)))
            self.assertEqual(outs[0], outs[1], label)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run it**

Run: `(cd gcf_v3 && "$PY" -m unittest tests.test_determinism -v)`
Expected: PASS (2 tests). It passes on arrival because Tasks 3–9 already iterate in canonical order and draw the tie-break weights from `random.Random(seed)` over the decision variables in canonical order; to see it guard something, temporarily change `person_ids=tuple(sorted(people))` to `person_ids=tuple(set(people))` in `gcf_v3/owt_v3/request.py` and run it — the two-hash-seed test fails — then revert (checked when this plan was written).

- [ ] **Step 3: Run the suite and the layout guard**

Run: `"$PY" -m unittest discover -s gcf_v3 -t gcf_v3 2>&1 | tail -3 && npx vitest run scripts/__tests__/ciLayout.test.ts 2>&1 | tail -4`
Expected: `Ran 158 tests … OK`; `Tests  51 passed (51)`.

- [ ] **Step 4: Commit**

```bash
git add gcf_v3/tests/test_determinism.py
git commit -m "test(solver-v3): byte-identical responses across runs and hash seeds" -m "S5: with every stage proven, the same request and seed give the same response apart from ms, total_ms and build, in one process and in two processes with different PYTHONHASHSEED, with and without pins. Promised per platform only (docs/CI.md), so no schedule is frozen across machines."
```

---

## Task 12: Packaging and the deploy files

Spec §11.1 (`requirements.txt`, `.gcloudignore`), §11.3 (`gcf_v3/cloudbuild.yaml`: the flags; no `--allow-unauthenticated`, no `--remove-env-vars`), §11.4 (`scripts/deploy-solver-v3-gcf.sh`: hard-codes `owt-solver-v3`, `--gen2`, `--source=gcf_v3`, `OWT_SOLVER_V3_BUILD=$(git rev-parse HEAD)`, passes `--allow-unauthenticated`, refuses a dirty `gcf_v3/`), C5-R12, C5-R13.

**Files:**
- Replace: `gcf_v3/requirements.txt`, `gcf_v3/.gcloudignore`
- Create: `gcf_v3/cloudbuild.yaml`, `scripts/deploy-solver-v3-gcf.sh`, `gcf_v3/tests/test_deploy_files.py`

**Interfaces:**
- Consumes: nothing.
- Produces: the build config and the manual script the Release uses.

- [ ] **Step 1: Write the failing test**

**Create** `gcf_v3/tests/test_deploy_files.py`:

```python
"""Packaging and deploy files (spec §11.1, §11.3, §11.4): read as text, never executed."""

import os
import re
import subprocess
import unittest

GCF_V3 = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(GCF_V3)


def read(*parts):
    with open(os.path.join(*parts), encoding="utf-8") as f:
        return f.read()


class Packaging(unittest.TestCase):
    def test_requirements_pin_ortools_with_v2_and_add_the_framework(self):
        lines = [l for l in read(GCF_V3, "requirements.txt").splitlines() if l and not l.startswith("#")]
        self.assertEqual(lines, ["ortools==9.15.6755", "functions-framework>=3.0,<4"])
        v2 = [l for l in read(ROOT, "gcf", "requirements.txt").splitlines() if l.startswith("ortools")]
        self.assertEqual(v2, ["ortools==9.15.6755"])

    def test_gcloudignore_keeps_tests_harness_and_build_config_out(self):
        lines = read(GCF_V3, ".gcloudignore").splitlines()
        for entry in ("test_*.py", "tests/", "acceptance/", "cloudbuild.yaml"):
            self.assertIn(entry, lines)

    def test_cloudbuild_deploys_only_v3_with_the_contract_flags(self):
        args = re.findall(r"^\s+- (\S+)$", read(GCF_V3, "cloudbuild.yaml"), re.M)
        for flag in ("owt-solver-v3", "--gen2", "--region=us-central1", "--runtime=python312", "--source=gcf_v3",
                     "--entry-point=solve", "--trigger-http", "--memory=512MB", "--cpu=1", "--timeout=120s",
                     "--set-secrets=OWT_SOLVER_API_KEY=owt-solver-api-key:latest",
                     "--set-env-vars=OWT_SOLVER_V3_BUILD=$COMMIT_SHA"):
            self.assertIn(flag, args)
        self.assertNotIn("--allow-unauthenticated", args)
        self.assertFalse([a for a in args if a.startswith("--remove-env-vars")])
        self.assertNotIn("owt-solver", [a for a in args if a != "owt-solver-v3" and a.startswith("owt-solver")])

    def test_the_manual_script(self):
        text = read(ROOT, "scripts", "deploy-solver-v3-gcf.sh")
        for needle in ("gcloud functions deploy owt-solver-v3", "--gen2", "--source=gcf_v3", "--allow-unauthenticated",
                       'OWT_SOLVER_V3_BUILD=$BUILD', 'BUILD="$(git rev-parse HEAD)"',
                       "git status --porcelain -- gcf_v3", "CLOUDSDK_CORE_DISABLE_FILE_LOGGING=true",
                       "--set-secrets=OWT_SOLVER_API_KEY=owt-solver-api-key:latest"):
            self.assertIn(needle, text)
        self.assertNotRegex(text, r"deploy owt-solver[^-]|--source=gcf[^_]")
        self.assertEqual(subprocess.run(["bash", "-n", os.path.join(ROOT, "scripts", "deploy-solver-v3-gcf.sh")])
                         .returncode, 0)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run it to see it fail**

Run: `(cd gcf_v3 && "$PY" -m unittest tests.test_deploy_files)`
Expected: FAIL — the requirements lack `functions-framework`, and `gcf_v3/cloudbuild.yaml` and the script do not exist.

- [ ] **Step 3: Implement**

**Create** `gcf_v3/requirements.txt`:

```text
# Pinned for parity with gcf/requirements.txt and the local owt-roles conda env: the ortools
# pin moves only together with v2's and the local env (spec C5 §11.1), never a floating range.
ortools==9.15.6755
functions-framework>=3.0,<4
```

**Create** `gcf_v3/.gcloudignore`:

```text
# Keep the build context to what the function needs: main.py, owt_v3/, requirements.txt.
__pycache__/
*.pyc
*.pyo
.pytest_cache/
*.err
.DS_Store
# Tests, the acceptance harness and the build config don't belong in the deployed function.
test_*.py
*_test.py
tests/
acceptance/
cloudbuild.yaml
```

**Create** `gcf_v3/cloudbuild.yaml`:

```yaml
# Cloud Build config for the OWT solver v3 Cloud Function `owt-solver-v3` (spec C5 §11.3).
#
# Trigger `owt-solver-v3-deploy`: GitHub, branch ^main$, included files gcf_v3/**, config file
# gcf_v3/cloudbuild.yaml. It runs on every push to main that touches gcf_v3/ and deploys the
# self-contained gcf_v3/ directory. v2's trigger (`owt-solver-deploy`, gcf/** and the root
# cloudbuild.yaml) and this one match no path of each other's.
#
# The API key is the same Secret Manager secret as v2 (owt-solver-api-key, spec C5-14); nothing
# sensitive lives here. OWT_SOLVER_V3_BUILD is the deployed commit, echoed by the ping as `build`.
#
# First creation and manual fallback: bash scripts/deploy-solver-v3-gcf.sh
steps:
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    id: deploy-solver-v3
    entrypoint: gcloud
    args:
      - functions
      - deploy
      - owt-solver-v3
      - --gen2
      - --region=us-central1
      - --runtime=python312
      - --source=gcf_v3
      - --entry-point=solve
      - --trigger-http
      # No --allow-unauthenticated: it calls run.services.setIamPolicy, which the build account
      # (roles/editor) cannot. The first manual creation grants allUsers -> run.invoker once, and
      # the binding persists across revisions. The X-Api-Key header is the barrier.
      - --memory=512MB
      - --cpu=1
      - --timeout=120s
      - --set-secrets=OWT_SOLVER_API_KEY=owt-solver-api-key:latest
      - --set-env-vars=OWT_SOLVER_V3_BUILD=$COMMIT_SHA

options:
  logging: CLOUD_LOGGING_ONLY
```

**Create** `scripts/deploy-solver-v3-gcf.sh`:

```bash
#!/usr/bin/env bash
# First creation (and manual fallback deploy) of the OWT solver v3 Cloud Function, `owt-solver-v3`.
# Spec: docs/superpowers/specs/2026-10-05-solver-v3-c5-solver-function-design.md §11.4.
#
# Run it from the fetched tip of main, never from a feature checkout — it deploys whatever
# gcf_v3/ holds on disk:
#   git fetch && git switch --detach origin/main
#   GCP_PROJECT=eloquent-figure-421401 bash scripts/deploy-solver-v3-gcf.sh
#
# It touches only owt-solver-v3: never v2's function (owt-solver), its source (gcf/) or its script.
# --allow-unauthenticated grants allUsers -> run.invoker with the caller's rights (the build
# account cannot, which is why gcf_v3/cloudbuild.yaml does not pass it). The API key is never on
# the command line: the function reads Secret Manager's owt-solver-api-key at instance start.
set -euo pipefail

: "${GCP_PROJECT:?Set GCP_PROJECT to the Google Cloud project id}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -n "$(git status --porcelain -- gcf_v3)" ]; then
  echo "✗ gcf_v3/ has uncommitted or untracked changes. Deploy a committed tree only:" >&2
  echo "  git fetch && git switch --detach origin/main" >&2
  exit 1
fi

BUILD="$(git rev-parse HEAD)"
export CLOUDSDK_CORE_DISABLE_FILE_LOGGING=true

echo "→ Deploying owt-solver-v3 (gen2, us-central1) at ${BUILD}…"
gcloud functions deploy owt-solver-v3 \
  --project="$GCP_PROJECT" \
  --gen2 \
  --region=us-central1 \
  --runtime=python312 \
  --source=gcf_v3 \
  --entry-point=solve \
  --trigger-http \
  --allow-unauthenticated \
  --memory=512MB \
  --cpu=1 \
  --timeout=120s \
  --set-secrets=OWT_SOLVER_API_KEY=owt-solver-api-key:latest \
  --set-env-vars="OWT_SOLVER_V3_BUILD=$BUILD"

echo "✓ Deployed. Function URL (OWT_SOLVER_V3_URL — C6/C7 set it, not this script):"
gcloud functions describe owt-solver-v3 \
  --project="$GCP_PROJECT" \
  --gen2 \
  --region=us-central1 \
  --format='value(serviceConfig.uri)'
```

**Execute:**

```bash
chmod +x scripts/deploy-solver-v3-gcf.sh
```

- [ ] **Step 4: Run the suite and the layout guard**

Run: `"$PY" -m unittest discover -s gcf_v3 -t gcf_v3 2>&1 | tail -3 && npx vitest run scripts/__tests__/ciLayout.test.ts 2>&1 | tail -4`
Expected: `Ran 162 tests … OK`; `Tests  51 passed (51)`.

- [ ] **Step 5: Commit**

```bash
git add gcf_v3/requirements.txt gcf_v3/.gcloudignore gcf_v3/cloudbuild.yaml scripts/deploy-solver-v3-gcf.sh gcf_v3/tests/test_deploy_files.py
git update-index --chmod=+x scripts/deploy-solver-v3-gcf.sh
git commit -m "build(solver-v3): requirements, build config and the first-creation script" -m "gcf_v3/cloudbuild.yaml deploys owt-solver-v3 (gen2, python312, 512MB, 1 vCPU, 120 s, the shared Secret Manager key, OWT_SOLVER_V3_BUILD=\$COMMIT_SHA) and, like v2's, cannot set IAM, so it passes no --allow-unauthenticated. scripts/deploy-solver-v3-gcf.sh is the first creation and the manual fallback: it refuses a dirty gcf_v3/, passes --gen2 and --allow-unauthenticated with the operator's rights, and stamps the commit. Neither touches v2's function, trigger, config or script."
```

---

## Task 13: The golden fixture (gated on C2's fixture)

Spec §6.6 (the test-side adapter: IF2-11's seat keeping — LG-1, LG-2, LG-4 — then LG-3's month selection, then LG-5–LG-8), §12.1 «Golden fixture (F14)» (every `ledger` case per month to the hundredth; `balance` as `share − received`; exact sums to 0 per (service, role key) and per (rule, service); FX-4's adapter cases; C5's `plan` cases; never the `cadence` cases; the suite FAILS when the file is missing or has no `ledger` case), C5-R6, C5-R7; C2 FX-1–FX-5, IF2-29.

**Files:**
- Create: `gcf_v3/tests/golden_adapter.py`, `gcf_v3/tests/test_golden.py`
- Modify: `fixtures/fairness/golden.json` (C5's two `plan` cases appended; IF2-29 reserves the kind and leaves its `input`/`expected` to C5)

**Interfaces:**
- Consumes: `realised`, `FService`, `FMonth`, `FPresence` (Task 4); `Facts`, `compute_plan` (Task 5); `parse_request` (Task 3); `hundredths` (Task 2); C2's fixture (IF2-29) and its IF2-10 `LedgerInput`.
- Produces: `golden_adapter.FIXTURE`, `counted(service)`, `keep_services(services)`, `record_month(record, live)`, `prepare(ledger_input) -> (services, months)`, `figures(ledger_input) -> (per-month figures, Realised, services)`. The `plan` case shape C5 defines: `input` is a contract-3 request; `expected` is `{"planned": {member: {line: hundredths}}, "floor": {month: [member ids]}}`.

- [ ] **Step 1: Bring C2's fixture in, or stop**

```bash
git fetch origin && git merge --no-edit origin/main
test -f fixtures/fairness/golden.json && echo "fixture present" || echo "STOP: C2's fixture is not on main"
```

Expected: `fixture present`. On `STOP`, end the session here and report (Global Constraints): Tasks 13–15 and the release wait for C2. Tasks 1–12 are complete and committed. After the merge, re-run Task 0 Step 2's Node lines (a merged C2 changes the counts; the new numbers are the baseline from here on).

- [ ] **Step 2: Write the failing test**

**Create** `gcf_v3/tests/golden_adapter.py`:

```python
"""Test-side adapter for C2's golden fixture (IF2-29; C2 FX-3; spec §6.6).

It turns one `ledger` case's input — C2's IF2-10 `LedgerInput` — into the shared formula's
inputs exactly as C2's ledger prepares its own: first IF2-11's seat-keeping step (LG-1, LG-2,
LG-4's role keys; LG-4's kept seat and second seats are the formula's own `keep_seats`), then
LG-3's month selection, then LG-5–LG-8's populations from each month's record. In production
the caller has already applied LG-1–LG-3 (C5-10); these are test-side obligations only.
"""

import os
from collections import Counter, defaultdict
from fractions import Fraction

from owt_v3.formula import FMonth, FPresence, FService, realised
from owt_v3.rounding import hundredths
from owt_v3.vocab import day_class

FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "fixtures", "fairness",
                       "golden.json")
WEEKEND_DAY = {"sunday_role": "Sun", "saturday_role": "Sat"}


def counted(service):
    """LG-2: coalesce(countsForFairness, _type != "special_role") on the raw field."""
    flag = service.get("countsForFairness")
    return flag if flag is not None else service["_type"] != "special_role"


def keep_services(services):
    """LG-1 and LG-2: canonical documents; every copy of a weekend type duplicated on one date dropped."""
    canonical = [s for s in services if not s["_id"].startswith("drafts.")]
    copies = Counter((s["_type"], s["date"]) for s in canonical if s["_type"] != "special_role")
    kept = [s for s in canonical if s["_type"] == "special_role" or copies[(s["_type"], s["date"])] == 1]
    return [s for s in kept if counted(s)]


def record_month(record, live):
    """LG-5–LG-8 facts of one recorded month. `live`: member id -> live unavailable dates."""
    status = {p["memberId"]: p["roles"] for p in record["people"]}
    blocks = {(p["memberId"], b["date"]): b for p in record["people"] for b in p["blocks"]}

    def base_in(person, fs, key):
        if status.get(person, {}).get(key) != "in":
            return False
        block = blocks.get((person, fs.date))
        if (block and block["unavailable"]) or fs.date in live.get(person, ()):
            return False
        return not (fs.weekend and block is not None and key in block["excludedRoles"])

    return FMonth(
        listed=frozenset(status),
        exact={p: frozenset(k for k, v in roles.items() if v == "exact") for p, roles in status.items()},
        cadence=frozenset(p["memberId"] for p in record["people"] if p.get("sundayCadence") == "alternate"),
        exempt=frozenset(p["memberId"] for p in record["people"] if p["exempt"]),
        presence=tuple(FPresence(r["ruleKey"], tuple(r["roles"]), tuple(r["members"]), r["exclusive"])
                       for r in record["presence"]),
        base_in=base_in,
    )


def prepare(ledger_input):
    """(services, months) for `realised`, LG-3's month selection applied."""
    target = ledger_input["target"]
    records = {r["month"]: r for r in ledger_input["records"] if r["month"] < target}
    live = {m["id"]: set(m.get("unavailableDates", [])) for m in ledger_input["members"]}
    fservices = []
    for s in keep_services(ledger_input["services"]):
        month = s["date"][:7]
        if month >= target or month not in records:
            continue
        day = WEEKEND_DAY.get(s["_type"]) or day_class(s["date"])
        fservices.append(FService(
            id=s["_id"], date=s["date"], time=s.get("time"), month=month, day=day,
            weekend=s["_type"] != "special_role", keys=(f"{day}.Lead", f"{day}.BGV", f"{day}.Choir"),
            seats={"Lead": tuple(s["Lead"]), "BGV": tuple(s["BGVs"]), "Choir": tuple(s["Chorus"])}))
    return fservices, {m: record_month(r, live) for m, r in records.items()}


def figures(ledger_input):
    """Per month: {member: {line: {share, received, balance}}} in hundredths, plus the raw result."""
    services, months = prepare(ledger_input)
    res = realised(services, months)
    share, received = defaultdict(Fraction), defaultdict(int)
    for key, v in res.share.items():
        share[key] += v
    for key, v in res.received.items():
        received[key] += v
    out = defaultdict(lambda: defaultdict(dict))
    for (m, p, line) in set(share) | set(received):
        s, r = hundredths(share[(m, p, line)]), 100 * received[(m, p, line)]
        out[m][p][line] = {"share": s, "received": r, "balance": s - r}  # LG-13: share − received
    return out, res, services
```

**Create** `gcf_v3/tests/test_golden.py`:

```python
"""The golden fixture (F14; IF2-29; C2 FX-3): Python reproduces every `ledger` case per month,
to the hundredth, and every `plan` case C5 added. `cadence` cases are TypeScript's (A18).

The suite FAILS — never skips — when the fixture is missing or has no `ledger` case.
"""

import json
import os
import unittest

from owt_v3.facts import Facts
from owt_v3.plan import compute_plan
from owt_v3.request import parse_request
from owt_v3.rounding import hundredths
from tests.golden_adapter import FIXTURE, figures

KINDS = ("ledger", "cadence", "plan")


def load():
    if not os.path.exists(FIXTURE):
        raise AssertionError("fixtures/fairness/golden.json is missing: C2's fixture must be on main first")
    with open(FIXTURE, encoding="utf-8") as f:
        return json.load(f)


class Fixture(unittest.TestCase):
    def test_the_file_exists_and_has_ledger_cases(self):
        fx = load()
        self.assertEqual((fx["schemaVersion"], fx["units"], fx["sign"]), (1, "hundredths", "positive_owed"))
        self.assertTrue([c for c in fx["cases"] if c["kind"] == "ledger"], "no ledger case")
        for case in fx["cases"]:
            self.assertIn(case["kind"], KINDS, case["id"])


class LedgerCases(unittest.TestCase):
    def test_every_ledger_case_per_month(self):
        for case in [c for c in load()["cases"] if c["kind"] == "ledger"]:
            with self.subTest(case=case["id"]):
                got, res, services = figures(case["input"])
                expected = case["expected"]["months"]
                for month, members in expected.items():
                    for member, lines in members.items():
                        for line, triple in lines.items():
                            self.assertEqual(got[month][member].get(line), triple, f"{month} {member} {line}")
                for month, members in got.items():
                    for member, lines in members.items():
                        for line, triple in lines.items():
                            if triple != {"share": 0, "received": 0, "balance": 0}:
                                self.assertIn(line, expected.get(month, {}).get(member, {}),
                                              f"unexpected figure {month} {member} {line}")

    def test_set_asides_match_in_the_months_the_case_lists(self):
        for case in [c for c in load()["cases"] if c["kind"] == "ledger"]:
            with self.subTest(case=case["id"]):
                got, res, _ = figures(case["input"])
                month_of = {s["_id"]: s["date"][:7] for s in case["input"]["services"]}
                months = set(case["expected"]["months"])
                mine = sorted((a["service"], a["key"], a["person"], a["reason"]) for a in res.set_asides
                              if month_of[a["service"]] in months)
                theirs = sorted((a["serviceId"], a["roleKey"], a["memberId"], a["reason"])
                                for a in case["expected"]["setAsides"] if month_of.get(a["serviceId"]) in months)
                self.assertEqual(mine, theirs)

    def test_exact_balances_sum_to_zero_per_service_key_and_rule(self):
        for case in [c for c in load()["cases"] if c["kind"] == "ledger"]:
            with self.subTest(case=case["id"]):
                _, res, _ = figures(case["input"])
                for sid, key, shared, pool in res.conservation:
                    self.assertEqual(shared, pool, f"{sid} {key}")

    def test_the_balance_is_share_minus_received_never_the_rounded_exact(self):
        for case in [c for c in load()["cases"] if c["kind"] == "ledger"]:
            for members in case["expected"]["months"].values():
                for lines in members.values():
                    for t in lines.values():
                        self.assertEqual(t["balance"], t["share"] - t["received"], case["id"])


class PlanCases(unittest.TestCase):
    def test_every_plan_case(self):
        for case in [c for c in load()["cases"] if c["kind"] == "plan"]:
            with self.subTest(case=case["id"]):
                F = Facts(parse_request(case["input"]))
                plan = compute_plan(F)
                for member, lines in case["expected"]["planned"].items():
                    for line, value in lines.items():
                        self.assertEqual(hundredths(plan.planned(member, line)), value, f"{member} {line}")
                floor = {m: sorted(v) for m, v in plan.floor_persons.items() if v}
                self.assertEqual(floor, case["expected"]["floor"])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 3: Run it**

Run: `(cd gcf_v3 && "$PY" -m unittest tests.test_golden -v)`
Expected: every `ledger` case passes per month — Tasks 4–5 implement C2's LG rules as C2 states them. **A failing case is a finding, never an edit of an expected value:** compare with C2's TypeScript ledger on the same case (`npx vitest run` on C2's fixture test prints its figures); a C5 defect is fixed in `formula.py` or `golden_adapter.py` with a regression test in `test_formula.py`; a fixture defect goes to C2's owner. `test_every_plan_case` passes vacuously until Step 4 adds the cases. Proof of the gate (checked when this plan was written): with the file moved away, `test_the_file_exists_and_has_ledger_cases` and every other test in the module **fail** with `fixtures/fairness/golden.json is missing: C2's fixture must be on main first` — there is no skip.

- [ ] **Step 4: Append C5's `plan` cases to the fixture**

The two cases are hand-computed in `test_plan.py`'s terms: (1) an exact count of 2 with one pinned seat — the remaining 1 spread over her two unpinned Sundays (C5-9): each of the two others plans `1/2 + 3/4 + 3/4 = 2` seats → `200`; (2) eleven people over two Sundays, one non-exempt with a pin on the second: her combined planned share `4/11 < 1` makes her a floor person, and her received pin is the floor seat (§6.4), so the second Sunday's pool is `1/11` per member: `2/11 + 1/11 = 3/11` → `27`.

**Execute:**

```bash
"$PY" - fixtures/fairness/golden.json <<'PY'
"""Append C5's `plan` cases to C2's golden fixture (IF2-29 reserves the kind; C5 defines it)."""
import json, sys
path = sys.argv[1]
SUN = ["2026-11-01", "2026-11-08", "2026-11-15"]
def svc(i, d):
    return {"id": f"s{i}", "date": d, "month": "2026-11", "kind": "sunday", "fixed": False, "counts": True,
            "seats": {"Lead": 2, "BGV": 0, "Choir": 0}}
def person(pid, elig, exempt=True):
    return {"id": pid, "name": pid[2:].title(), "exempt": exempt, "eligibility": elig, "carried": {},
            "dl_since": None, "prev_dl_leads": 0}
def body(services, people, rules=(), pins=()):
    return {"contract": 3, "seed": 1, "months": ["2026-11"], "services": services, "people": people,
            "rules": list(rules), "pins": list(pins),
            "prior": {"month": "2026-10", "has_services": True, "services": []}}
three = [svc(i + 1, d) for i, d in enumerate(SUN)]
lead3 = {s["id"]: ["Lead"] for s in three}
two = three[:2]
lead2 = {s["id"]: ["Lead"] for s in two}
CASES = [
    {"id": "plan-exact-pin-remainder", "kind": "plan",
     "description": "An exact count of 2 with one pinned seat: the remaining 1 is spread over her two unpinned Sundays (C5-9).",
     "covers": ["C5-9", "F5", "F13"],
     "input": body(three, [person(p, dict(lead3)) for p in ("m-ana", "m-bea", "m-cris")],
                   rules=[{"id": "cap-a", "kind": "count", "person": "m-ana", "roles": ["Sun.Lead"], "op": "==",
                           "month": "2026-11", "value": 2}],
                   pins=[{"service": "s1", "date": SUN[0], "role": "Lead", "person": "m-ana"}]),
     "expected": {"planned": {"m-bea": {"DL": 200}, "m-cris": {"DL": 200}, "m-ana": {"DL": 0}}, "floor": {}}},
    {"id": "plan-floor-at-received-pin", "kind": "plan",
     "description": "A low-share person's floor seat in the plan is her earliest received pinned seat (§6.4).",
     "covers": ["F5", "F9", "C5-15", "F13"],
     "input": body(two, [person(f"m-x{i}", dict(lead2)) for i in range(10)] + [person("m-ana", dict(lead2), exempt=False)],
                   pins=[{"service": "s2", "date": SUN[1], "role": "Lead", "person": "m-ana"}]),
     "expected": {"planned": {"m-x0": {"DL": 27}, "m-ana": {"DL": 27}}, "floor": {"2026-11": ["m-ana"]}}},
]
with open(path, encoding="utf-8") as f:
    fixture = json.load(f)
have = {c["id"] for c in fixture["cases"]}
fixture["cases"] += [c for c in CASES if c["id"] not in have]
with open(path, "w", encoding="utf-8") as f:
    json.dump(fixture, f, indent=2, ensure_ascii=False)
    f.write("\n")
print(f"{len([c for c in fixture['cases'] if c['kind'] == 'plan'])} plan cases")
PY
```

Run: `git diff --stat fixtures/fairness/golden.json`
Expected: only insertions. If C2's file is not `json.dump(…, indent=2)` + newline, the rewrite reformats it: then `git checkout fixtures/fairness/golden.json` and insert the two case objects by hand before the closing `]` of `cases`, matching C2's formatting — the content is what the script's `CASES` holds.

- [ ] **Step 5: Run the suite, C2's schema check and the Node gates**

Run: `"$PY" -m unittest discover -s gcf_v3 -t gcf_v3 2>&1 | tail -3 && npx tsc --noEmit && npm test 2>&1 | tail -5 && npx eslint . 2>&1 | tail -1`
Expected: `Ran 168 tests … OK`; C2's vitest suite schema-checks the two `plan` cases (FX-3) and stays green; eslint `0 errors` and the baseline warning count.

- [ ] **Step 6: Commit**

```bash
git add gcf_v3/tests/golden_adapter.py gcf_v3/tests/test_golden.py fixtures/fairness/golden.json
git commit -m "test(solver-v3): Python asserts C2's golden fixture, and adds C5's plan cases" -m "F14: the shared formula reproduces every ledger case per month to the hundredth, the balance being share minus received in hundredths (A39), after a test-side adapter that keeps seats and months exactly as C2's ledger does (LG-1-LG-4, then LG-3); exact sums are zero per service key and per rule. The cadence cases stay TypeScript's (A18). The two plan cases are C5's, hand-computed; C2's vitest schema-checks them."
```

---

## Task 14: The acceptance harness (gated on C2's fixture)

Spec §12.2 (the `ci` subset through C0's one command; the harness precondition; the 10-minute job), §12.3 (the harness and its derived inputs, `summary.json` in public form, `--emit-requests`, the independent checker, the fictitious realistic world, runs A–D, P, G, O, scenario set P1–P16), §11.5 (the smoke request), §13 (shapes A–D), C5-R2, R4, R5, R8, R14, R15, R16.

**Files:**
- Create: `gcf_v3/acceptance/__init__.py`, `gcf_v3/acceptance/x1.py`, `gcf_v3/acceptance/world.py`, `gcf_v3/acceptance/world_realistic.json`, `gcf_v3/acceptance/checker.py`, `gcf_v3/acceptance/scenarios.py`, `gcf_v3/acceptance/run.py`, `gcf_v3/acceptance/smoke.json`, `gcf_v3/tests/test_acceptance_ci.py`, `gcf_v3/tests/test_acceptance_tools.py`, `gcf_v3/tests/test_public_outputs.py`

**Interfaces:**
- Consumes: `owt_v3.formula.realised` and `owt_v3.rounding.hundredths` (the SAME formula for carried balances, §12.3), `owt_v3.service.handle`/`public_label`, `owt_v3.request.parse_request`, `owt_v3.solver.solve_problem(…, consecutive_last=True)` (run O only); `tests.test_logs.marked`/`MARK`, `tests.test_stages.stub`.
- Produces: `x1.cadence_states(led_previous, months)`, `x1.wire_state(entry)`, `x1.check_against_fixture(path=FIXTURE) -> case count` (raises `x1.HarnessError`); `world.load_world`, `world.World(data, overlay)`, `world.Chain(data, overlay)` with `.request(months, seed)`, `.run(months, seed, store=True) -> (request, response)`, `.ledger`, `.carried`, `.cumulative`, `.add_stored`, `.drop_months`; `checker.check(request, response) -> dict` (counts, codes and public labels only) and `python -m acceptance.checker req.json resp.json` (exit 0 when ok); `scenarios.scenario_runs(env, seed)`; `run.run_matrix(world_path, matrix, out_dir) -> summary`, `run.emit_requests(world_path, out_dir) -> ["A","B","C","D"]`, `run.Env`, `run.Summary`, `run.WORLD`, `run.MATRIX`; the CLI `python gcf_v3/acceptance/run.py --world … --matrix ci|full --out <dir> [--emit-requests <dir>]`. The world schema is `world.py`'s docstring — the private converter (Task 15) writes the same shape.

- [ ] **Step 1: Write the failing tests**

**Create** `gcf_v3/tests/test_acceptance_ci.py`:

```python
"""The acceptance `ci` subset (spec §12.2, §12.3), driven in process through C0's one
discovery command: runs A (seeds 1–2), B, C, D and the scenario set P (seed 1) on the
fictitious world, and fails on any pass criterion. `acceptance/` itself holds no test module.

Before any chain runs, the harness checks its test-only X1 against the golden fixture's
`cadence` cases; a mismatch — or a missing fixture — is a HARNESS ERROR («the test double
disagrees with the fixture»), not an assertion about X1 (A18).
"""

import json
import tempfile
import unittest

from acceptance import run, x1
from acceptance.world import load_world


class CiMatrix(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.out = tempfile.TemporaryDirectory()
        try:
            cls.summary = run.run_matrix(run.WORLD, "ci", cls.out.name)
            cls.error = None
        except x1.HarnessError as e:
            cls.summary, cls.error = None, str(e)

    @classmethod
    def tearDownClass(cls):
        cls.out.cleanup()

    def setUp(self):
        if self.error:
            self.fail(f"harness error: {self.error}")

    def test_every_criterion_passes(self):
        failed = sorted(k for k, v in self.summary["criteria"].items() if v != "pass")
        self.assertEqual(failed, [])
        self.assertTrue(self.summary["ok"])

    def test_the_matrix_ran(self):
        self.assertGreaterEqual(self.summary["runs"], 40)
        for prefix in ("A.s1.", "A.s2.", "B.s1.", "C.s1.", "D.s1.", "P1.s1.", "P16.s1."):
            self.assertTrue(any(k.startswith(prefix) for k in self.summary["criteria"]), prefix)

    def test_the_summary_is_public(self):
        world = load_world(run.WORLD)
        text = json.dumps(self.summary)
        for member in world["members"]:
            self.assertNotIn(member["id"], text)
            self.assertNotIn(member["name"], text)
        for rule in world["rules"]:
            self.assertNotIn(rule["id"], text)
        self.assertNotIn("w-2026", text)  # service ids


class HarnessPrecondition(unittest.TestCase):
    def test_the_x1_double_agrees_with_the_fixture(self):
        self.assertGreater(x1.check_against_fixture(), 0)


if __name__ == "__main__":
    unittest.main()
```

**Create** `gcf_v3/tests/test_acceptance_tools.py`:

```python
"""The acceptance tools that need no chain (spec §11.5, §13): the smoke request and the
timing-gate shapes A–D."""

import json
import os
import tempfile
import unittest

from acceptance import run
from owt_v3.request import parse_request
from owt_v3.service import handle

ACCEPTANCE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "acceptance")


class Smoke(unittest.TestCase):
    def test_the_smoke_request_proves_every_stage(self):
        with open(os.path.join(ACCEPTANCE, "smoke.json"), encoding="utf-8") as f:
            body = json.load(f)
        status, resp, _ = handle(body)
        self.assertEqual(status, 200)
        self.assertTrue(resp["reproducible"])
        self.assertTrue(all(s["status"] == "proven" for s in resp["stages"]))


class TimingShapes(unittest.TestCase):
    def test_emit_requests_writes_shapes_a_to_d(self):
        with tempfile.TemporaryDirectory() as d:
            names = run.emit_requests(run.WORLD, d)
            self.assertEqual(names, ["A", "B", "C", "D"])
            shapes = {}
            for n in names:
                with open(os.path.join(d, f"shape-{n}.json"), encoding="utf-8") as f:
                    shapes[n] = json.load(f)
        months = {n: parse_request(b).months for n, b in shapes.items()}
        self.assertEqual(months, {"A": ("2026-11",), "B": ("2026-11", "2026-12"), "C": ("2026-10", "2026-11"),
                                  "D": ("2026-11", "2026-12")})
        sundays = sum(1 for s in shapes["C"]["services"] if s["kind"] == "sunday")
        saturdays = sum(1 for s in shapes["C"]["services"] if s["kind"] == "saturday")
        self.assertEqual((sundays, saturdays), (9, 9))  # 4+5 Sundays, a Saturday every week incl. Oct 31
        self.assertTrue(90 <= len(shapes["D"]["pins"]) <= 100)  # «about 100»: every seat of B, pinned


if __name__ == "__main__":
    unittest.main()
```

**Create** `gcf_v3/tests/test_public_outputs.py`:

```python
"""Public outputs carry no request identifier (C5-17 (2)): the independent checker's result and
the harness's summary over the marked pairs of test_logs.py hold counts, codes and public labels."""

import json
import unittest

from acceptance import checker
from acceptance.run import Summary
from owt_v3.service import handle
from tests.test_logs import MARK, marked
from tests.test_stages import stub


class PublicOutputs(unittest.TestCase):
    def test_the_checker_and_the_summary_carry_no_marker(self):
        summary = Summary("ci")
        for kw in ({}, {"solver_for": stub({f"balance_max:P:pres-{MARK}"})}, {"solver_for": stub({"rules"})}):
            body = marked()
            resp = handle(body, **kw)[1]
            self.assertNotIn(MARK, json.dumps(checker.check(body, resp)))
            summary.add_run(body, resp)
        text = json.dumps(summary.as_dict())
        self.assertNotIn(MARK, text)
        self.assertIn("balance_max:P#1", text)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run them to see them fail**

Run: `(cd gcf_v3 && "$PY" -m unittest tests.test_acceptance_ci tests.test_acceptance_tools tests.test_public_outputs)`
Expected: FAIL — `ModuleNotFoundError: No module named 'acceptance'`.

- [ ] **Step 3: Implement the harness**

**Create** `gcf_v3/acceptance/__init__.py` (empty file):

```python

```

**Create** `gcf_v3/acceptance/x1.py`:

```python
"""A TEST-ONLY X1 (C2 CAD-1) that drives the acceptance chain. Never shipped, never
imported by `owt_v3`: the production X1 is C2's TypeScript alone (F7).

Before any chain runs, `check_against_fixture` replays the golden fixture's `cadence`
cases through this double and refuses to run on a mismatch (spec §12.2, §12.3) — a
harness error, never an assertion about X1 itself (A18).
"""

import json
import os

FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "fixtures", "fairness", "golden.json")


class HarnessError(Exception):
    """The acceptance harness cannot run (fixture missing, or its X1 double disagrees)."""


def cadence_states(led_previous, months):
    """CAD-1: [{month, state, reason}] for 1–2 months of {month, eligible, availableCountedSundays}."""
    out, led = [], led_previous
    for i, m in enumerate(months):
        if not m["eligible"]:
            state, reason = "off", "not_eligible"
        elif led:
            state, reason = "off", "led_previous_month" if i == 0 else "assumed_led_previous_month"
        elif m["availableCountedSundays"] == 0:
            state, reason = "off", "no_available_sunday"
        else:
            state, reason = "on", "on"
        out.append({"month": m["month"], "state": state, "reason": reason})
        led = state == "on"
    return out


def wire_state(entry):
    """A14 / C5-5: reason `not_eligible` is `out`; every other state is sent as is."""
    return "out" if entry["reason"] == "not_eligible" else entry["state"]


def check_against_fixture(path=FIXTURE):
    """Replay every `cadence` case of IF2-29 through the double; raise HarnessError on any miss."""
    if not os.path.exists(path):
        raise HarnessError("fixtures/fairness/golden.json is missing — the harness needs C2's fixture")
    with open(path, encoding="utf-8") as f:
        fixture = json.load(f)
    cases = [c for c in fixture.get("cases", []) if c.get("kind") == "cadence"]
    if not cases:
        raise HarnessError("the golden fixture has no cadence cases")
    for case in cases:
        got = cadence_states(case["input"]["ledCountedSundayPreviousMonth"], case["input"]["months"])
        if got != case["expected"]:
            raise HarnessError("the test double disagrees with the fixture (cadence case "
                               f"{cases.index(case) + 1} of {len(cases)})")
    return len(cases)
```

**Create** `gcf_v3/acceptance/world.py`:

```python
"""The acceptance world (spec §12.3): a roster, its rules and a calendar, plus the chain
that solves month after month and derives each next request's inputs:

- carried balances from the SAME Python formula over the chain's stored months (the
  3-month window, F3) — `owt_v3.formula.realised`;
- cadence states from the test-only X1 (`acceptance.x1`);
- `dl_since`, `prev_dl_leads` and `prior` from the stored services.

World file schema (`world_realistic.json`; the private converter writes the same shape):

    {"schema": 1, "scenarios": true?, "start": "YYYY-MM", "saturday_anchor": "YYYY-MM-DD",
     "seats": {"sunday": {"Lead", "BGV", "Choir"}, "saturday": {"Lead", "BGV"}},
     "availability": {"seed": int, "rate": float},
     "members": [{"id", "name", "roles": [RoleKey…], "since": {RoleKey: "YYYY-MM"}?,
                  "exempt": bool, "cadence": bool, "unavailable": ["YYYY-MM-DD"…]}],
     "rules": [count {id, person, roles, op, value | sundays_minus} | pair {id, persons, roles}
               | presence {id, persons, roles, exclusive}],
     "stored": [{"id", "date", "kind", "counts", "time"?, "seats": {"Lead": [ids], …}}]?}

A member's status for a role key is "in" when the key is in `roles` and the month is not
before `since[key]`; an `==` count with value >= 1 makes it "exact" (C2 REC-3). `scenarios`
marks the fictitious world, whose member ids the scenario sets P and G name; a private world
built by the converter omits it, and runs A–D and O only.
"""

import copy
import json
import random
from collections import defaultdict
from fractions import Fraction

from owt_v3.formula import FMonth, FPresence, FService, realised
from owt_v3.rounding import hundredths
from owt_v3.service import handle
from owt_v3.vocab import (add_days, add_months, day_class, month_index,
                          parse_date, role_key)

from . import x1

ROLES = ("Lead", "BGV", "Choir")


def load_world(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def month_dates(month):
    d = parse_date(f"{month}-01")
    while d.strftime("%Y-%m") == month:
        yield d.isoformat()
        d = parse_date(add_days(d.isoformat(), 1))


def sunday_count(month):
    return sum(1 for d in month_dates(month) if parse_date(d).weekday() == 6)


class World:
    def __init__(self, data, overlay=None):
        self.data = copy.deepcopy(data)
        ov = overlay or {}
        self.members = {m["id"]: m for m in self.data["members"]}
        for m in ov.get("members_add", []):
            self.members[m["id"]] = m
        for mid, roles in ov.get("roles_override", {}).items():
            self.members[mid] = {**self.members[mid], "roles": roles}
        for mid, since in ov.get("since_override", {}).items():
            self.members[mid] = {**self.members[mid], "since": since}
        self.rules = [r for r in self.data["rules"] if r["id"] not in ov.get("rules_drop", [])]
        self.rules += ov.get("rules_add", [])
        self.extra_unav = {k: set(v) for k, v in ov.get("unavailable", {}).items()}
        self.forced = {k: set(v) for k, v in ov.get("available", {}).items()}
        self.saturdays = ov.get("saturdays", "alternate")
        for kind, seats in ov.get("seats", {}).items():
            self.data["seats"][kind] = {**self.data["seats"][kind], **seats}
        av = self.data["availability"]
        self._rate, self._seed = av["rate"], av["seed"]

    # ── facts ───────────────────────────────────────────────────────────────
    def ids(self):
        return sorted(self.members)

    def status(self, mid, key, month):
        m = self.members[mid]
        if key not in m["roles"]:
            return "out"
        since = m.get("since", {}).get(key)
        if since is not None and month < since:
            return "out"
        for r in self.rules:
            if r["kind"] == "count" and r["op"] == "==" and r["person"] == mid and key in r["roles"]:
                if self.count_value(r, month) >= 1:
                    return "exact"
        return "in"

    def available(self, mid, date):
        if date in self.forced.get(mid, ()):
            return True
        if date in self.members[mid].get("unavailable", ()) or date in self.extra_unav.get(mid, ()):
            return False
        return random.Random(f"{self._seed}|{mid}|{date}").random() >= self._rate

    def count_value(self, rule, month):
        if "sundays_minus" in rule:
            return max(0, sunday_count(month) - rule["sundays_minus"])
        return rule["value"]

    def presence_rules(self, month=None):
        return [r for r in self.rules if r["kind"] == "presence"
                and (month is None or r.get("month") in (None, month))]

    def record(self, month):
        """The month's facts as a C2 record would hold them, for the ledger."""
        listed = frozenset(self.ids())
        exact = defaultdict(frozenset)
        for mid in listed:
            keys = {k for k in self.members[mid]["roles"] if self.status(mid, k, month) == "exact"}
            if keys:
                exact[mid] = frozenset(keys)
        world = self

        def base_in(p, fs, key):
            return (key.split(".")[0] == fs.day and world.status(p, key, month) == "in"
                    and world.available(p, fs.date))
        return FMonth(
            listed=listed, exact=dict(exact),
            cadence=frozenset(m for m in listed if self.members[m].get("cadence")),
            exempt=frozenset(m for m in listed if self.members[m].get("exempt")),
            presence=tuple(FPresence(r["id"], tuple(r["roles"]), tuple(r["persons"]), r["exclusive"])
                           for r in self.presence_rules(month)),
            base_in=base_in,
        )

    # ── calendar ────────────────────────────────────────────────────────────
    def calendar(self, months):
        anchor = parse_date(self.data["saturday_anchor"])
        out = []
        for month in months:
            for d in month_dates(month):
                wd = parse_date(d).weekday()
                if wd == 6:
                    out.append({"id": f"w-{d}-sun", "date": d, "month": month, "kind": "sunday",
                                "fixed": False, "counts": True, "seats": dict(self.data["seats"]["sunday"])})
                elif wd == 5 and (self.saturdays == "every" or (parse_date(d) - anchor).days % 14 == 0):
                    out.append({"id": f"w-{d}-sat", "date": d, "month": month, "kind": "saturday",
                                "fixed": False, "counts": True, "seats": dict(self.data["seats"]["saturday"])})
        return out


class Chain:
    """Solves runs in sequence; each run's assignment becomes stored services."""

    def __init__(self, data, overlay=None):
        self.data = data
        self.world = World(data, overlay)
        self.stored = [copy.deepcopy(s) for s in data.get("stored", [])]
        self.overlay = overlay or {}

    def add_stored(self, services):
        for s in services:
            self.stored = [x for x in self.stored if (x["date"], x["kind"]) != (s["date"], s["kind"])]
            self.stored.append(copy.deepcopy(s))
        self.stored.sort(key=lambda s: (s["date"], s["id"]))

    def drop_months(self, months):
        self.stored = [s for s in self.stored if s["date"][:7] not in months]

    def stored_in(self, month):
        return [s for s in self.stored if s["date"][:7] == month]

    # ── derived inputs ──────────────────────────────────────────────────────
    def ledger(self, months):
        """Exact (share, received) per (person, line) over stored counted services of `months`."""
        fsvcs, fmonths = [], {}
        for month in months:
            fmonths[month] = self.world.record(month)
            for s in self.stored_in(month):
                if not s["counts"]:
                    continue
                day = day_class(s["date"])
                fsvcs.append(FService(id=s["id"], date=s["date"], time=s.get("time"), month=month, day=day,
                                      weekend=s["kind"] != "special",
                                      keys=tuple(role_key(day, r) for r in ROLES),
                                      seats={r: tuple(s["seats"].get(r, [])) for r in ROLES}))
        res = realised(fsvcs, fmonths)
        share, received = defaultdict(Fraction), defaultdict(int)
        for (m, p, line), v in res.share.items():
            share[(p, line)] += v
        for (m, p, line), v in res.received.items():
            received[(p, line)] += v
        return share, received, res

    def carried(self, first):
        window = [add_months(first, -k) for k in (3, 2, 1)]
        share, received, _ = self.ledger(window)
        out = defaultdict(dict)
        for key in set(share) | set(received):
            p, line = key
            value = hundredths(share[key]) - 100 * received[key]
            if value:
                out[p][line] = value
        return out

    def led_sunday(self, mid, month):
        return any(mid in s["seats"].get("Lead", []) and s["counts"] and day_class(s["date"]) == "Sun"
                   for s in self.stored_in(month))

    def dl_leads(self, mid, month):
        return sum(1 for s in self.stored_in(month)
                   if s["counts"] and day_class(s["date"]) == "Sun" and mid in s["seats"].get("Lead", []))

    # ── the request ─────────────────────────────────────────────────────────
    def request(self, months, seed):
        W, ov = self.world, self.overlay
        stored_dates = {(s["date"], s["kind"]) for s in self.stored}
        services = [s for s in W.calendar(months) if (s["date"], s["kind"]) not in stored_dates]
        fixed = [s for s in self.stored if s["date"][:7] in months]
        for s in ov.get("specials", []):
            if s["date"][:7] in months:
                fixed.append(s)
        pins = []
        for s in fixed:
            entry = {"id": s["id"], "date": s["date"], "month": s["date"][:7], "kind": s["kind"],
                     "fixed": True, "counts": s["counts"]}
            if s.get("time"):
                entry["time"] = s["time"]
            services.append(entry)
            for role in ROLES:
                for mid in s["seats"].get(role, []):
                    pins.append({"service": s["id"], "date": s["date"], "role": role, "person": mid})
        pins += [p for p in ov.get("pins", []) if p["date"][:7] in months]
        services.sort(key=lambda s: (s["date"], s["id"]))
        first = months[0]
        carried = self.carried(first)
        people = []
        for mid in W.ids():
            m = W.members[mid]
            elig = {}
            for s in services:
                roles = [r for r in ROLES
                         if W.status(mid, role_key(day_class(s["date"]), r), s["date"][:7]) in ("in", "exact")
                         and W.available(mid, s["date"])]
                if s["kind"] == "saturday" and not s["fixed"]:
                    roles = [r for r in roles if r != "Choir"]
                if roles:
                    elig[s["id"]] = roles
            entry = {"id": mid, "name": m["name"], "exempt": bool(m.get("exempt")), "eligibility": elig,
                     "carried": dict(sorted(carried.get(mid, {}).items())),
                     "dl_since": self.dl_since(mid, months),
                     "prev_dl_leads": self.dl_leads(mid, add_months(first, -1))}
            if m.get("cadence"):
                states = x1.cadence_states(self.led_sunday(mid, add_months(first, -1)), [
                    {"month": mo, "eligible": W.status(mid, "Sun.Lead", mo) == "in",
                     "availableCountedSundays": sum(
                         1 for s in services if s["date"][:7] == mo and s["counts"]
                         and day_class(s["date"]) == "Sun" and W.available(mid, s["date"]))}
                    for mo in months])
                entry["cadence"] = {e["month"]: x1.wire_state(e) for e in states}
            people.append(entry)
        rules = []
        for r in W.rules:
            if r["kind"] == "count":
                for mo in months:
                    rules.append({"id": r["id"], "kind": "count", "person": r["person"], "roles": r["roles"],
                                  "op": r["op"], "month": mo, "value": W.count_value(r, mo)})
            elif r["kind"] in ("pair", "presence"):
                if r.get("month") is not None and r["month"] not in months:
                    continue
                keys = ("id", "kind", "persons", "roles") + (("exclusive",) if r["kind"] == "presence" else ())
                rules.append({k: r[k] for k in keys + (("month",) if r.get("month") else ())})
        prior_month = add_months(first, -1)
        lo, hi = add_days(f"{first}-01", -14), add_days(f"{first}-01", -1)
        prior = {"month": prior_month,
                 "has_services": any(s["kind"] != "special" or s["counts"] for s in self.stored_in(prior_month)),
                 "services": [{"date": s["date"], "kind": s["kind"], "counts": s["counts"],
                               "seats": {r: list(s["seats"].get(r, [])) for r in ROLES}}
                              for s in self.stored if lo <= s["date"] <= hi
                              and (s["kind"] != "special" or s["counts"])]}
        req = {"contract": 3, "request_id": f"acc-{'-'.join(months)}-{seed}", "seed": seed,
               "months": list(months), "services": services, "people": people, "rules": rules,
               "pins": pins, "prior": prior}
        if "budget" in ov:
            req["budget"] = ov["budget"]
        return req

    def dl_since(self, mid, months):
        m = self.world.members[mid]
        if "Sun.Lead" not in m["roles"]:
            return None
        since = max(self.data["start"], m.get("since", {}).get("Sun.Lead", self.data["start"]))
        if month_index(since) > month_index(months[-1]):
            return None
        return since

    # ── one run ─────────────────────────────────────────────────────────────
    def run(self, months, seed, store=True):
        req = self.request(months, seed)
        status, resp, _ = handle(req)
        if resp.get("ok") and store:
            fixed = {s["id"] for s in req["services"] if s["fixed"]}
            for s in req["services"]:
                if s["id"] in fixed and any(x["id"] == s["id"] for x in self.stored):
                    continue
                self.stored.append({"id": s["id"], "date": s["date"], "kind": s["kind"], "counts": s["counts"],
                                    "time": s.get("time"),
                                    "seats": {r: list(resp["assignments"][s["id"]].get(r, [])) for r in ROLES}})
            self.stored.sort(key=lambda s: (s["date"], s["id"]))
        return req, resp

    def cumulative(self, first, last):
        """Exact cumulative balance per (person, line) from `first` through `last` (LINE seats)."""
        months = [first]
        while months[-1] < last:
            months.append(add_months(months[-1], 1))
        share, received, _ = self.ledger(months)
        return {k: share[k] - received[k] for k in set(share) | set(received)}
```

**Create** `gcf_v3/acceptance/world_realistic.json`:

```json
{
  "schema": 1,
  "scenarios": true,
  "description": "Fictitious roster mirroring the worship team's STRUCTURE (17 voices: 3 cadence leads, a fixed-count lead, an exempt lead, a capped lead, an exclusive presence pair, 3 regulars, 3 support singers with one Sunday BGV each, 2 Saturday-only support singers, 1 unrestricted support singer). One cadence lead enters the Sunday pool in Sep 2026 (a promotion), so the three are not in phase. No real person, name or figure.",
  "start": "2026-08",
  "saturday_anchor": "2026-08-08",
  "seats": {"sunday": {"Lead": 2, "BGV": 3, "Choir": 3}, "saturday": {"Lead": 2, "BGV": 3}},
  "availability": {"seed": 2026, "rate": 0.08},
  "members": [
    {"id": "m-ana", "name": "Ana", "roles": ["Sun.Lead", "Sat.Lead", "Sun.BGV", "Sat.BGV", "Sun.Choir"], "exempt": false, "cadence": true, "unavailable": []},
    {"id": "m-bea", "name": "Bea", "roles": ["Sun.Lead", "Sat.Lead", "Sun.BGV", "Sat.BGV", "Sun.Choir"], "exempt": false, "cadence": true, "unavailable": []},
    {"id": "m-cris", "name": "Cris", "roles": ["Sun.Lead", "Sat.Lead", "Sun.BGV", "Sat.BGV", "Sun.Choir"], "exempt": false, "cadence": true, "unavailable": [], "since": {"Sun.Lead": "2026-09"}},
    {"id": "m-dario", "name": "Dario", "roles": ["Sun.Lead"], "exempt": false, "cadence": false, "unavailable": []},
    {"id": "m-ema", "name": "Ema", "roles": ["Sun.Lead"], "exempt": true, "cadence": false, "unavailable": []},
    {"id": "m-fede", "name": "Fede", "roles": ["Sun.Lead", "Sun.BGV"], "exempt": false, "cadence": false, "unavailable": []},
    {"id": "m-gala", "name": "Gala", "roles": ["Sun.Lead", "Sat.Lead", "Sun.BGV", "Sat.BGV", "Sun.Choir"], "exempt": false, "cadence": false, "unavailable": []},
    {"id": "m-hector", "name": "Hector", "roles": ["Sun.Lead", "Sat.Lead", "Sun.BGV", "Sat.BGV", "Sun.Choir"], "exempt": false, "cadence": false, "unavailable": []},
    {"id": "m-ines", "name": "Ines", "roles": ["Sun.Lead", "Sat.Lead", "Sun.BGV", "Sat.BGV", "Sun.Choir"], "exempt": false, "cadence": false, "unavailable": []},
    {"id": "m-jose", "name": "Jose", "roles": ["Sun.Lead", "Sat.Lead", "Sun.BGV", "Sat.BGV", "Sun.Choir"], "exempt": false, "cadence": false, "unavailable": []},
    {"id": "m-kike", "name": "Kike", "roles": ["Sun.Lead", "Sat.Lead", "Sun.BGV", "Sat.BGV", "Sun.Choir"], "exempt": false, "cadence": false, "unavailable": []},
    {"id": "m-lola", "name": "Lola", "roles": ["Sun.BGV", "Sat.BGV", "Sun.Choir"], "exempt": false, "cadence": false, "unavailable": []},
    {"id": "m-mario", "name": "Mario", "roles": ["Sun.BGV", "Sat.BGV", "Sun.Choir"], "exempt": false, "cadence": false, "unavailable": []},
    {"id": "m-nora", "name": "Nora", "roles": ["Sun.BGV", "Sat.BGV", "Sun.Choir"], "exempt": false, "cadence": false, "unavailable": []},
    {"id": "m-olga", "name": "Olga", "roles": ["Sat.BGV"], "exempt": false, "cadence": false, "unavailable": []},
    {"id": "m-paco", "name": "Paco", "roles": ["Sat.BGV"], "exempt": false, "cadence": false, "unavailable": []},
    {"id": "m-rosa", "name": "Rosa", "roles": ["Sun.BGV", "Sat.BGV", "Sun.Choir"], "exempt": false, "cadence": false, "unavailable": []}
  ],
  "rules": [
    {"id": "cap-fixed", "kind": "count", "person": "m-dario", "roles": ["Sun.Lead"], "op": "==", "value": 2},
    {"id": "cap-capped", "kind": "count", "person": "m-fede", "roles": ["Sun.BGV"], "op": "<=", "sundays_minus": 2},
    {"id": "cap-lola", "kind": "count", "person": "m-lola", "roles": ["Sun.BGV"], "op": "==", "value": 1},
    {"id": "cap-mario", "kind": "count", "person": "m-mario", "roles": ["Sun.BGV"], "op": "==", "value": 1},
    {"id": "cap-nora", "kind": "count", "person": "m-nora", "roles": ["Sun.BGV"], "op": "==", "value": 1},
    {"id": "pres-pair", "kind": "presence", "persons": ["m-gala", "m-hector"], "roles": ["Sun.BGV"], "exclusive": true},
    {"id": "pair-bgv", "kind": "pair", "persons": ["m-gala", "m-hector"], "roles": ["Sun.BGV", "Sat.BGV"]},
    {"id": "pair-lead", "kind": "pair", "persons": ["m-gala", "m-hector"], "roles": ["Sun.Lead", "Sat.Lead"]},
    {"id": "pair-leads-1", "kind": "pair", "persons": ["m-ines", "m-jose"], "roles": ["Sun.Lead", "Sat.Lead"]},
    {"id": "pair-leads-2", "kind": "pair", "persons": ["m-bea", "m-kike"], "roles": ["Sun.BGV"]}
  ]
}
```

**Create** `gcf_v3/acceptance/checker.py`:

```python
"""The independent checker (spec §12.3, C5-R15): one request and its response in, counts
out. It recomputes from `assignments` ALONE — never from the response's own flags and
never from `owt_v3`'s model or report code (stdlib only, no `owt_v3` import):

- hard rules: one seat per person per service; a seat only for someone eligible for that
  role there, or pinned to it; a fixed service holding exactly its pins; rows not over size;
- the pin echo: every request pin seated, `pins.honored` equal to that count;
- every rule instance of §6.7 and every protection of §7.1 stages 3–9, compared with
  `violations`, `missed` and `cadence`;
- the `after` identity, the seat-count identities (A39) per line and tab, and
  |planned − share| against `fairness.tolerance` per person-line.

Its result holds counts, codes and stage public labels only (C5-17) — never a name and
never an identifier from the request — so C7 can run it on captured Preview pairs:

    python -m acceptance.checker request.json response.json      (from gcf_v3/)
"""

import datetime
import json
import re
import sys
from collections import Counter, defaultdict

ROLES = ("Lead", "BGV", "Choir")


def _date(s):
    return datetime.date(int(s[0:4]), int(s[5:7]), int(s[8:10]))


def _day(s):
    return "Sun" if _date(s).weekday() == 6 else "Sat"


def _plus(s, k):
    return (_date(s) + datetime.timedelta(days=k)).isoformat()


def _weekend(s):
    d = _date(s)
    return (d + datetime.timedelta(days=(6 - d.weekday()) % 7)).isoformat()


def _prev_month(m):
    y, mm = int(m[:4]), int(m[5:7])
    return f"{y - 1}-12" if mm == 1 else f"{y}-{mm - 1:02d}"


def label(stage_id, presence_ids):
    m = re.match(r"^(balance_(?:max|sq)):P:(.+)$", stage_id)
    if not m:
        return stage_id
    return f"{m.group(1)}:P#{presence_ids.index(m.group(2)) + 1 if m.group(2) in presence_ids else 0}"


class _Request:
    def __init__(self, req):
        self.req = req
        self.months = req["months"]
        self.svc = {s["id"]: s for s in req["services"]}
        self.people = {p["id"]: p for p in req["people"]}
        self.pins = {(p["service"], p["role"], p["person"]) for p in req["pins"]}
        self.pin_at = {(p["service"], p["person"]) for p in req["pins"]}
        self.presence_ids = []
        for r in req["rules"]:
            if r["kind"] == "presence" and r["id"] not in self.presence_ids:
                self.presence_ids.append(r["id"])

    def roles(self, s):
        if s["fixed"]:
            return ROLES
        return ("Lead", "BGV") if s["kind"] == "saturday" else ROLES

    def key(self, s, role):
        return f"{_day(s['date'])}.{role}"

    def eligible(self, p, sid, role):
        return role in self.people[p]["eligibility"].get(sid, [])

    def could(self, p, sid, role):
        s = self.svc[sid]
        return (sid, role, p) in self.pins or (not s["fixed"] and self.eligible(p, sid, role))

    def row_size(self, sid, role):
        s = self.svc[sid]
        pins = sum(1 for (x, r, _) in self.pins if x == sid and r == role)
        return pins if s["fixed"] else max(s.get("seats", {}).get(role, 0), pins)

    def exact(self, p, month, key):
        return any(r["kind"] == "count" and r["op"] == "==" and r["person"] == p and r["month"] == month
                   and key in r["roles"] and r["value"] >= 1 for r in self.req["rules"])


def _seated(req, resp):
    out = set()
    for sid, roles in resp["assignments"].items():
        for role, ids in roles.items():
            for p in ids:
                out.add((sid, role, p))
    return out


def _instances(R, seated):
    """Broken rule instances, recomputed: {(family, rule, scope)}."""
    broken = set()
    weekend_svcs = [s for s in R.req["services"] if s["kind"] != "special"]
    for r in R.req["rules"]:
        if r["kind"] == "count":
            avail = 0
            for s in weekend_svcs:
                if s["month"] != r["month"]:
                    continue
                if any(R.key(s, role) in r["roles"] and R.could(r["person"], s["id"], role) for role in R.roles(s)):
                    avail += 1
            value = min(r["value"], avail) if r["op"] in ("==", ">=") else r["value"]
            n = sum(1 for (sid, role, p) in seated if p == r["person"] and R.svc[sid]["kind"] != "special"
                    and R.svc[sid]["month"] == r["month"] and R.key(R.svc[sid], role) in r["roles"])
            bad = {"==": n != value, "<=": n > value, ">=": n < value}[r["op"]]
            if bad:
                broken.add(("count", r["id"], r["month"]))
        elif r["kind"] in ("pair", "presence"):
            for s in weekend_svcs:
                if r.get("month") is not None and s["month"] != r["month"]:
                    continue
                terms = [(role, p) for role in R.roles(s) for p in r["persons"]
                         if R.key(s, role) in r["roles"] and R.could(p, s["id"], role)]
                held = sum(1 for role, p in terms if (s["id"], role, p) in seated)
                if r["kind"] == "pair":
                    if {p for _, p in terms} == set(r["persons"]) and held >= 2:
                        broken.add(("pair", r["id"], s["id"]))
                else:
                    applies = terms or any(R.eligible(p, s["id"], role) for role in R.roles(s)
                                           for p in r["persons"] if R.key(s, role) in r["roles"])
                    if applies and held == 0:
                        broken.add(("presence", r["id"], s["id"]))
        elif r["kind"] == "consecutive":
            weeks = defaultdict(lambda: [False, False, False])  # weekend -> [term, held, horizon term]
            for s in weekend_svcs:
                for role in R.roles(s):
                    if R.key(s, role) in r["roles"] and R.could(r["person"], s["id"], role):
                        w = weeks[_weekend(s["date"])]
                        w[0], w[2] = True, True
                        w[1] = w[1] or (s["id"], role, r["person"]) in seated
            for ps in R.req["prior"]["services"]:
                if ps["kind"] == "special":
                    continue
                for role in ROLES:
                    if f"{_day(ps['date'])}.{role}" in r["roles"] and r["person"] in ps["seats"].get(role, []):
                        w = weeks[_weekend(ps["date"])]
                        w[0], w[1] = True, True
            for w in sorted(weeks):
                nxt = _plus(w, 7)
                if nxt in weeks and (weeks[w][2] or weeks[nxt][2]) and weeks[w][1] and weeks[nxt][1]:
                    broken.add(("consecutive", r["id"], (w, nxt)))
    for s in weekend_svcs:
        if s["fixed"] or "Lead" not in R.roles(s):
            continue
        cand = [p for p in R.people if R.could(p, s["id"], "Lead")]
        if cand and not any((s["id"], "Lead", p) in seated for p in cand):
            broken.add(("mandatory_lead", "mandatory_lead", s["id"]))
    return broken


def _reported_instances(resp):
    out = set()
    for v in resp["violations"]:
        if v["code"] == "count":
            out.add(("count", v["rule"], v["month"]))
        elif v["code"] == "consecutive":
            out.add(("consecutive", v["rule"], tuple(v["weekends"])))
        else:
            out.add((v["code"], v["rule"], v["service"]))
    return out


def _protections(R, seated):
    """Recomputed misses {(code, person, scope)} and cadence entries {(person, month): tuple}."""
    counted = [s for s in R.req["services"] if s["counts"]]

    def count(p, m, pred):
        return sum(1 for (sid, role, q) in seated if q == p and R.svc[sid]["counts"]
                   and R.svc[sid]["month"] == m and pred(R.svc[sid], role))

    L = lambda p, m: count(p, m, lambda s, r: r == "Lead" and _day(s["date"]) == "Sun")
    S = lambda p, m: count(p, m, lambda s, r: r == "Lead" and _day(s["date"]) == "Sat")
    V = lambda p, m: count(p, m, lambda s, r: True)
    missed, cadence = set(), {}
    for p, person in R.people.items():
        cad = person.get("cadence")
        for m in R.months:
            if cad:
                state = cad[m]
                a = 1 if state == "on" else 0
                comp = "not_applicable" if (state != "off" or L(p, m) >= 1) else (
                    "given" if S(p, m) >= 1 else "missed")
                cadence[(p, m)] = (state, L(p, m), S(p, m), L(p, m) == a, comp)
                if state == "on" and L(p, m) == 0:
                    missed.add(("cadence_on_missed", p, m))
                if state in ("off", "out") and L(p, m) >= 1:
                    missed.add(("cadence_off_led", p, m))
                if state == "off" and L(p, m) == 0 and S(p, m) == 0:
                    missed.add(("compensation_missed", p, m))
            if not person.get("exempt", False) and any(
                    s["month"] == m and (person["eligibility"].get(s["id"]) or (s["id"], p) in R.pin_at)
                    for s in counted):
                if V(p, m) == 0:
                    missed.add(("voice_floor_missed", p, m))
            for key, cnt, code in (("Sun.Lead", L, "sunday_cap_exceeded"), ("Sat.Lead", S, "saturday_cap_exceeded")):
                if not R.exact(p, m, key) and cnt(p, m) >= 2:
                    missed.add((code, p, m))
    for i, m in enumerate(R.months):
        prev = _prev_month(m)
        for p, person in R.people.items():
            if person.get("cadence") or R.exact(p, m, "Sun.Lead"):
                continue
            on_line = any(
                s["month"] == m and s["counts"] and (
                    (s["kind"] == "sunday" and "Lead" in person["eligibility"].get(s["id"], []))
                    or (_day(s["date"]) == "Sun" and (s["id"], "Lead", p) in R.pins))
                for s in R.req["services"])
            if not on_line:
                continue
            since = person["dl_since"]
            if since is None or prev < since:
                continue
            if prev == R.req["prior"]["month"] and not R.req["prior"]["has_services"]:
                continue
            before = person["prev_dl_leads"] if i == 0 else L(p, R.months[0])
            if before + L(p, m) == 0:
                missed.add(("dl_floor_missed", p, m))
    horizon = {s["date"] for s in R.req["services"]}
    for p in R.people:
        leads = set()
        for (sid, role, q) in seated:
            s = R.svc[sid]
            if q == p and role == "Lead" and s["counts"] and _day(s["date"]) == "Sun":
                leads.add(s["date"])
        for ps in R.req["prior"]["services"]:
            if ps["counts"] and _day(ps["date"]) == "Sun" and p in ps["seats"].get("Lead", []):
                leads.add(ps["date"])
        for d in sorted(leads):
            if _plus(d, 7) in leads and _plus(d, 7) in horizon:
                missed.add(("consecutive_sundays", p, d))
    return missed, cadence


def _reported_missed(resp):
    out = set()
    for m in resp["missed"]:
        if m["code"] == "dl_floor_missed":
            out.add((m["code"], m["person"], m["month2"]))
        elif m["code"] == "consecutive_sundays":
            out.add((m["code"], m["person"], m["dates"][0]))
        else:
            out.add((m["code"], m["person"], m["month"]))
    return out


def check(req, resp):
    """Counts only. `problems` maps a fixed category to how many times it failed."""
    problems = Counter()
    summary = {"ok": False, "problems": problems, "stages": Counter(), "violations": Counter(),
               "missed": Counter(), "notices": Counter(), "unfilled": 0, "max_gap": 0}
    if not resp.get("ok"):
        summary["failure"] = resp.get("code")
        return _finish(summary)
    R = _Request(req)
    seated = _seated(req, resp)
    per_service = Counter((sid, p) for (sid, _, p) in seated)
    problems["hard_two_seats"] += sum(1 for v in per_service.values() if v > 1)
    for (sid, role, p) in seated:
        if sid not in R.svc or p not in R.people:
            problems["hard_unknown"] += 1
            continue
        if not R.could(p, sid, role):
            problems["hard_ineligible"] += 1
    for sid, s in R.svc.items():
        if sid not in resp["assignments"]:
            problems["assignment_missing_service"] += 1
            continue
        for role in R.roles(s):
            held = len(resp["assignments"][sid].get(role, []))
            if held > R.row_size(sid, role):
                problems["hard_row_over"] += 1
        if s["fixed"]:
            mine = {(x, r, p) for (x, r, p) in seated if x == sid}
            if mine != {c for c in R.pins if c[0] == sid}:
                problems["hard_fixed_not_pins"] += 1
    honored = sum(1 for c in R.pins if c in seated)
    if honored != len(R.pins):
        problems["pins_not_honored"] += len(R.pins) - honored
    if resp["pins"] != {"requested": len(R.pins), "honored": honored}:
        problems["pin_echo_mismatch"] += 1
    if _instances(R, seated) != _reported_instances(resp):
        problems["violations_mismatch"] += len(_instances(R, seated) ^ _reported_instances(resp))
    missed, cadence = _protections(R, seated)
    if missed != _reported_missed(resp):
        problems["missed_mismatch"] += len(missed ^ _reported_missed(resp))
    reported_cad = {(c["person"], c["month"]): (c["state"], c["sundays"], c["saturdays"], c["met"],
                                                c["compensation"]) for c in resp["cadence"]}
    if reported_cad != cadence:
        problems["cadence_mismatch"] += 1
    tol = resp["fairness"]["tolerance"]
    over = 0
    for person in resp["fairness"]["people"]:
        for scope, entries in (("line", person["lines"]), ("tab", person["tabs"])):
            for name, f in entries.items():
                if f["after"] != f["carried"] + f["share"] - f["received"]:
                    problems[f"{scope}_after_identity"] += 1
                if f["seats"] * 100 != f["received"] or f["pinned_seats"] * 100 != f["pinned"]:
                    problems[f"{scope}_seat_identity"] += 1
                if scope == "line":
                    gap = abs(f["planned"] - f["share"])
                    summary["max_gap"] = max(summary["max_gap"], gap)
                    over += gap > tol
    # The F13 gap is reported, not judged here: which runs it binds is the harness's criterion.
    summary["gap"] = {"max": summary["max_gap"], "over_tolerance": over, "tolerance": tol,
                      "pins": bool(req["pins"]), "all_proven": all(s["status"] == "proven" for s in resp["stages"]),
                      "filled": not resp["unfilled"]}
    for st in resp["stages"]:
        summary["stages"][f"{label(st['id'], R.presence_ids)} {st['status']}"] += 1
    for v in resp["violations"]:
        summary["violations"][f"{v['code']}/{v['cause']}"] += 1
    for m in resp["missed"]:
        summary["missed"][f"{m['code']}/{m['cause']}"] += 1
    for n in resp["notices"]:
        summary["notices"][n["code"]] += 1
    summary["unfilled"] = sum(u["count"] for u in resp["unfilled"])
    summary["ok"] = not +problems
    return _finish(summary)


def _finish(summary):
    for key in ("problems", "stages", "violations", "missed", "notices"):
        summary[key] = dict(sorted((k, v) for k, v in summary[key].items() if v))
    summary["ok"] = summary["ok"] and not summary["problems"]
    return summary


def main(argv):
    if len(argv) != 3:
        print("usage: python -m acceptance.checker <request.json> <response.json>", file=sys.stderr)
        return 2
    with open(argv[1], encoding="utf-8") as f:
        req = json.load(f)
    with open(argv[2], encoding="utf-8") as f:
        resp = json.load(f)
    result = check(req, resp)
    print(json.dumps(result, sort_keys=True, indent=1))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
```

**Create** `gcf_v3/acceptance/scenarios.py`:

```python
"""Scenario set P (spec §12.3): pins, rule breaks, clamps and edge cases on the
fictitious world. Each scenario returns [(name, passed)] plus the runs it made; names
are fixed strings (no identifier), so they can go into `summary.json` as they are.

Every scenario must complete (no `ok: false`, except P15's honest `timeout`) and name
exactly the expected breaks, misses and notices, each with the expected cause.
"""

NOV, DEC = "2026-11", "2026-12"
SUNDAYS_NOV = ("2026-11-01", "2026-11-08", "2026-11-15", "2026-11-22", "2026-11-29")
SUNDAYS_DEC = ("2026-12-06", "2026-12-13", "2026-12-20", "2026-12-27")


def sun(date):
    return f"w-{date}-sun"


def sat(date):
    return f"w-{date}-sat"


def pin(date, role, person, kind="sun"):
    return {"service": f"w-{date}-{kind}", "date": date, "role": role, "person": person}


def all_dates(month):
    from .world import month_dates
    return list(month_dates(month))


def _codes(resp, key):
    return sorted((x["code"], x.get("rule"), x["cause"]) for x in resp[key]) if key == "violations" else \
        sorted((x["code"], x["person"], x["cause"]) for x in resp[key])


def _missed(resp, person=None, code=None):
    return [m for m in resp["missed"] if (person is None or m["person"] == person)
            and (code is None or m["code"] == code)]


def _line(resp, person, line):
    for p in resp["fairness"]["people"]:
        if p["person"] == person:
            return p["lines"].get(line)
    return None


def scenario_runs(env, seed):
    """Yield (scenario id, [(check name, bool)], [(request, response)])."""
    # P1 — the presence pair, both pinned to one Sunday's BGV: a pair break caused by pins
    req, resp = env.run([NOV], seed, {"pins": [pin(SUNDAYS_NOV[1], "BGV", "m-gala"),
                                               pin(SUNDAYS_NOV[1], "BGV", "m-hector")]})
    yield "P1", [("ok", resp["ok"]),
                 ("pair_pins", resp["ok"] and _codes(resp, "violations") == [("pair", "pair-bgv", "pins")]),
                 ("ceiling_1", resp["ok"] and resp["violation_ceiling"]["value"] == 1)], [(req, resp)]
    # P2 — the fixed-count lead pinned on three Sundays: a count break caused by pins
    p2 = [pin(SUNDAYS_NOV[0], "Lead", "m-dario"), pin(SUNDAYS_NOV[2], "Lead", "m-dario"),
          pin(SUNDAYS_NOV[4], "Lead", "m-dario")]
    req, resp = env.run([NOV], seed, {"pins": p2})
    yield "P2", [("ok", resp["ok"]),
                 ("count_pins", resp["ok"] and _codes(resp, "violations") == [("count", "cap-fixed", "pins")])], \
        [(req, resp)]
    # P3 — both: the ceiling is 2
    req, resp = env.run([NOV], seed, {"pins": p2 + [pin(SUNDAYS_NOV[1], "BGV", "m-gala"),
                                                    pin(SUNDAYS_NOV[1], "BGV", "m-hector")]})
    yield "P3", [("ok", resp["ok"]),
                 ("ceiling_2", resp["ok"] and resp["violation_ceiling"]["value"] == 2),
                 ("both_pins", resp["ok"] and _codes(resp, "violations") == [
                     ("count", "cap-fixed", "pins"), ("pair", "pair-bgv", "pins")])], [(req, resp)]
    # P4 — a stored Sunday with 3 Leads (fixed) and a board Sunday pinned with 3 Leads (row grows)
    stored = {"id": "st-2026-11-08", "date": SUNDAYS_NOV[1], "kind": "sunday", "counts": True,
              "seats": {"Lead": ["m-ema", "m-fede", "m-kike"], "BGV": ["m-lola"], "Choir": []}}
    req, resp = env.run([NOV], seed, {"stored_add": [stored], "pins": [
        pin(SUNDAYS_NOV[3], "Lead", p) for p in ("m-cris", "m-gala", "m-ines")]})
    yield "P4", [("ok", resp["ok"]),
                 ("fixed_is_pins", resp["ok"] and resp["assignments"]["st-2026-11-08"]["Lead"] == [
                     "m-ema", "m-fede", "m-kike"]),
                 ("row_grew", resp["ok"] and len(resp["assignments"][sun(SUNDAYS_NOV[3])]["Lead"]) == 3)], \
        [(req, resp)]
    # P5 — a cadence member pinned on a Sunday in her off month
    req, resp = env.run([NOV], seed, {"pins": [pin(SUNDAYS_NOV[1], "Lead", "m-ana")]})
    cad = [c for c in resp.get("cadence", []) if c["person"] == "m-ana" and c["month"] == NOV]
    yield "P5", [("ok", resp["ok"]),
                 ("off_led_pins", resp["ok"] and [(m["code"], m["cause"]) for m in _missed(resp, "m-ana")]
                  == [("cadence_off_led", "pins")]),
                 ("no_compensation_owed", bool(cad) and cad[0]["compensation"] == "not_applicable")], [(req, resp)]
    # P6 — a regular pinned as Lead on all five Sundays: cap and consecutive misses caused by pins
    # Her never-together partner on Lead is away those Sundays (he could not lead beside her), so he
    # is off the DL line; the other DL members fit the two Sunday seats she leaves.
    ov = {"pins": [pin(d, "Lead", "m-ines") for d in SUNDAYS_NOV], "unavailable": {"m-jose": list(SUNDAYS_NOV)}}
    req, resp = env.run([NOV], seed, ov)
    mine = _missed(resp, "m-ines") if resp["ok"] else []
    yield "P6", [("ok", resp["ok"]),
                 ("cap_pins", any(m["code"] == "sunday_cap_exceeded" and m["cause"] == "pins" for m in mine)),
                 ("consecutive_pins", sum(1 for m in mine if m["code"] == "consecutive_sundays") >= 4
                  and all(m["cause"] == "pins" for m in mine)),
                 ("others_met", resp["ok"] and len(resp["missed"]) == len(mine))], [(req, resp)]
    # P7 — a pin on someone not eligible for that role is honoured, and its seat set aside
    req, resp = env.run([NOV], seed, {"pins": [pin(SUNDAYS_NOV[1], "Choir", "m-olga")]})
    coro = _line(resp, "m-olga", "CORO") if resp["ok"] else None
    yield "P7", [("ok", resp["ok"]),
                 ("honored", resp["ok"] and resp["pins"] == {"requested": 1, "honored": 1}
                  and "m-olga" in resp["assignments"][sun(SUNDAYS_NOV[1])]["Choir"]),
                 ("set_aside", resp["ok"] and (coro is None or coro["seats"] == 0))], [(req, resp)]
    # P8 — `==` above availability clamps: a one-BGV singer away all month; the fixed-count lead on one Sunday
    ov = {"unavailable": {"m-lola": all_dates(NOV), "m-dario": [d for d in SUNDAYS_NOV if d != SUNDAYS_NOV[2]]}}
    req, resp = env.run([NOV], seed, ov)
    clamps = sorted((n["params"]["rule"], n["params"]["value"], n["params"]["available"])
                    for n in resp.get("notices", []) if n["code"] == "exact_clamped")
    yield "P8", [("ok", resp["ok"]),
                 ("clamped", clamps == [("cap-fixed", 2, 1), ("cap-lola", 1, 0)]),
                 ("no_break", resp["ok"] and not resp["violations"])], [(req, resp)]
    # P9 — the presence pair both unavailable on one Sunday: the rule does not apply there
    req, resp = env.run([NOV], seed, {"unavailable": {p: [SUNDAYS_NOV[1]] for p in ("m-gala", "m-hector")}})
    na = [n["params"] for n in resp.get("notices", []) if n["code"] == "presence_not_applicable"]
    yield "P9", [("ok", resp["ok"]),
                 ("not_applicable", na == [{"rule": "pres-pair", "service": sun(SUNDAYS_NOV[1])}])], [(req, resp)]
    # P10 — exactly one presence member available on a Sunday: F6 moves her shares
    base_req, base = env.run([NOV], seed, {"available": {"m-hector": [SUNDAYS_NOV[1]], "m-gala": [SUNDAYS_NOV[1]]}})
    req, resp = env.run([NOV], seed, {"unavailable": {"m-gala": [SUNDAYS_NOV[1]]},
                                      "available": {"m-hector": [SUNDAYS_NOV[1]]}})
    moved = False
    if resp["ok"] and base["ok"]:
        before, after = _line(base, "m-hector", "CORO"), _line(resp, "m-hector", "CORO")
        sub_b, sub_a = _line(base, "m-hector", "P:pres-pair"), _line(resp, "m-hector", "P:pres-pair")
        moved = after["planned"] < before["planned"] and sub_a["planned"] > sub_b["planned"]
    yield "P10", [("ok", resp["ok"] and base["ok"]), ("shares_moved", moved)], [(base_req, base), (req, resp)]
    # P11 — a counted Sunday-dated special as a fixed service, plus pins on Saturdays
    special = {"id": "sp-2026-11-15-camp", "date": SUNDAYS_NOV[2], "kind": "special", "counts": True,
               "time": "19:00", "seats": {"Lead": ["m-kike"], "BGV": ["m-rosa"], "Choir": []}}
    req, resp = env.run([NOV], seed, {"specials": [special], "pins": [
        pin("2026-11-14", "Lead", "m-jose", "sat"), pin("2026-11-28", "BGV", "m-olga", "sat")]})
    yield "P11", [("ok", resp["ok"]),
                  ("special_is_pins", resp["ok"] and resp["assignments"]["sp-2026-11-15-camp"] == {
                      "Lead": ["m-kike"], "BGV": ["m-rosa"], "Choir": []}),
                  ("no_rule_on_special", resp["ok"] and all(
                      v.get("service") != "sp-2026-11-15-camp" for v in resp["violations"])),
                  ("pins_honored", resp["ok"] and resp["pins"]["honored"] == resp["pins"]["requested"])], \
        [(req, resp)]
    # P12 — a newcomer and a promotion, both via dl_since: no spurious dl_floor_missed
    newcomer = {"id": "m-tomas", "name": "Tomas", "roles": ["Sun.Lead", "Sat.Lead", "Sun.BGV", "Sat.BGV",
                                                            "Sun.Choir"],
                "since": {k: NOV for k in ("Sun.Lead", "Sat.Lead", "Sun.BGV", "Sat.BGV", "Sun.Choir")},
                "exempt": False, "cadence": False, "unavailable": []}
    ov = {"members_add": [newcomer],
          "roles_override": {"m-rosa": ["Sun.Lead", "Sun.BGV", "Sat.BGV", "Sun.Choir"]},
          "since_override": {"m-rosa": {"Sun.Lead": NOV}}}
    req, resp = env.run([NOV, DEC], seed, ov)
    yield "P12", [("ok", resp["ok"]),
                  ("no_spurious_floor", resp["ok"] and not any(
                      m["code"] == "dl_floor_missed" and m["person"] in ("m-tomas", "m-rosa") for m in resp["missed"]))], \
        [(req, resp)]
    # P13 — all three cadence members unavailable in their next «on» month: X1 shifts them, gaps <= 2
    ov = {"unavailable": {"m-cris": list(SUNDAYS_NOV), "m-ana": list(SUNDAYS_DEC), "m-bea": list(SUNDAYS_DEC)}}
    runs, chain = env.chain_runs([NOV, DEC, "2027-01", "2027-02", "2027-03", "2027-04"], 1, seed, ov)
    gaps_ok = all(r["ok"] for _, r in runs)
    if gaps_ok:
        for person in ("m-ana", "m-bea", "m-cris"):
            gap = longest = 0
            for _, r in runs:
                for c in r["cadence"]:
                    if c["person"] == person:
                        gap = 0 if c["sundays"] else gap + 1
                        longest = max(longest, gap)
            gaps_ok = gaps_ok and longest <= 2
    yield "P13", [("ok", all(r["ok"] for _, r in runs)), ("gaps_le_2", gaps_ok),
                  ("met", all(c["met"] for _, r in runs if r["ok"] for c in r["cadence"]))], runs
    # P14 — a month planned before the previous one is stored: no spurious floor miss
    req, resp = env.run(["2027-01"], seed, {})
    yield "P14", [("ok", resp["ok"]), ("prior_empty", req["prior"]["has_services"] is False),
                  ("no_floor_miss", resp["ok"] and not any(m["code"] == "dl_floor_missed" for m in resp["missed"]))], \
        [(req, resp)]
    # P15 — tiny stage limits: honest statuses (unproven / not_run / timeout), never a false «proven»
    req, resp = env.run([NOV, DEC], seed, {"budget": {"stage_det_limit": 0.001, "stage_seconds": 0.05,
                                                      "total_seconds": 1}})
    if resp["ok"]:
        honest = all(s["status"] != "proven" or s["limit"] == "none" for s in resp["stages"]) and \
            resp["reproducible"] == all(s["status"] == "proven" for s in resp["stages"]) and \
            any(s["status"] != "proven" for s in resp["stages"])
    else:
        honest = resp["code"] == "timeout" and resp["params"]["stage"] in ("rules", "fill")
    yield "P15", [("honest", honest)], [(req, resp)]
    # P16 — one presence rule id with different members per month (a record-bound month beside another)
    rules = [{"id": "pres-pair", "kind": "presence", "persons": ["m-gala", "m-hector"], "roles": ["Sun.BGV"],
              "exclusive": True, "month": NOV},
             {"id": "pres-pair", "kind": "presence", "persons": ["m-gala", "m-kike"], "roles": ["Sun.BGV"],
              "exclusive": False, "month": DEC}]
    req, resp = env.run([NOV, DEC], seed, {"rules_drop": ["pres-pair"], "rules_add": rules})
    yield "P16", [("ok", resp["ok"]),
                  ("nov_member", resp["ok"] and _line(resp, "m-hector", "P:pres-pair") is not None),
                  ("dec_member", resp["ok"] and _line(resp, "m-kike", "P:pres-pair") is not None)], [(req, resp)]
```

**Create** `gcf_v3/acceptance/run.py`:

```python
"""The acceptance runner (spec §12.3, §13):

    python gcf_v3/acceptance/run.py --world <path> --matrix ci|full --out <dir> [--emit-requests <dir>]

Runs the chained solves of the matrix on a world (the fictitious one in the repo, or a
private one built outside it), checks every pass criterion with the independent checker,
writes each run's request and response under `--out`, and writes `summary.json` there —
aggregates only, in public form (C5-17): pass/fail per criterion, stage statuses by public
label, timings, misses and violations by code and cause, and the largest F13 gap. Stdout
carries no more than `summary.json` does. `--emit-requests` writes the timing-gate shapes
A–D (§13) instead.

Before any chain runs, the X1 test double is checked against the golden fixture's `cadence`
cases; a missing fixture or a mismatch is a harness error and nothing runs.
"""

import argparse
import copy
import json
import os
import statistics
import sys
from collections import Counter

if __package__ in (None, ""):  # run as a script: `python gcf_v3/acceptance/run.py …`
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from acceptance import checker, scenarios, x1  # noqa: E402
from acceptance.world import Chain, load_world  # noqa: E402
from owt_v3.request import parse_request  # noqa: E402
from owt_v3.service import handle, public_label  # noqa: E402
from owt_v3.solver import solve_problem  # noqa: E402
from owt_v3.vocab import add_months  # noqa: E402

WORLD = os.path.join(os.path.dirname(os.path.abspath(__file__)), "world_realistic.json")
BASE_LAST = "2026-10"
RUN_A = ["2026-11", "2026-12"]
CHAIN = [add_months("2026-11", k) for k in range(12)]
MATRIX = {
    "ci": {"A": (1, 2), "B": (1,), "C": (1,), "D": (1,), "P": (1,), "G": (), "O": ()},
    "full": {"A": (1, 2, 3, 4, 5), "B": (1, 2, 3, 4, 5), "C": (1, 2, 3), "D": (1, 2, 3), "P": (1, 2, 3),
             "G": (1, 2, 3), "O": (1, 2, 3, 4, 5)},
}


class Env:
    """Base chains (the world's history up to Oct 2026, solved by the policy itself) and runs on top."""

    def __init__(self, data, out=None):
        self.data, self.out = data, out
        self._base = {}
        self.pairs = []  # every (label, request, response)

    def base(self, seed, overlay=None):
        if seed not in self._base:
            ch = Chain(self.data)
            month = self.data["start"]
            while month <= BASE_LAST:
                if not ch.stored_in(month):
                    ch.run([month], seed)
                month = add_months(month, 1)
            self._base[seed] = ch.stored
        ch = Chain(self.data, overlay)
        ch.stored = copy.deepcopy(self._base[seed])
        ch.add_stored((overlay or {}).get("stored_add", []))
        return ch

    def record(self, label, req, resp):
        self.pairs.append((label, req, resp))
        if self.out:
            os.makedirs(os.path.join(self.out, "runs"), exist_ok=True)
            with open(os.path.join(self.out, "runs", f"{label}.json"), "w", encoding="utf-8") as f:
                json.dump({"request": req, "response": resp}, f, ensure_ascii=False)

    def run(self, months, seed, overlay=None):
        ch = self.base(seed, overlay)
        return ch.run(months, seed, store=False)

    def chain_runs(self, months, step, seed, overlay=None):
        ch = self.base(seed, overlay)
        runs = []
        for i in range(0, len(months), step):
            runs.append(ch.run(months[i:i + step], seed))
            if not runs[-1][1].get("ok"):
                break
        return runs, ch


def _passes_like_a(req, resp, verdict):
    """Run A's pass criteria on one run; returns {criterion: bool}."""
    if not resp.get("ok"):
        return {"ok": False}
    missed = Counter(m["code"] for m in resp["missed"])
    comp = [m for m in resp["missed"] if m["code"] == "compensation_missed" and m["cause"] != "unavailable"]
    return {
        "ok": True,
        "stages_proven": all(s["status"] == "proven" for s in resp["stages"]),
        "ceiling_0": resp["violation_ceiling"]["value"] == 0,
        "nothing_unfilled": not resp["unfilled"],
        "checker_ok": verdict["ok"],
        "cadence_met": all(c["met"] for c in resp["cadence"]),
        "compensation": not comp,
        "no_protection_miss": not any(missed[c] for c in (
            "cadence_on_missed", "cadence_off_led", "voice_floor_missed", "dl_floor_missed",
            "sunday_cap_exceeded", "saturday_cap_exceeded", "consecutive_sundays")),
        "pins_honored": resp["pins"]["honored"] == resp["pins"]["requested"],
    }


def _regular_gap_ok(chain, runs, data):
    """No regular (on the DL line) more than 1 month without a Sunday while available."""
    longest = Counter()
    gap = Counter()
    for req, resp in runs:
        if not resp.get("ok"):
            return False
        for month in req["months"]:
            for p in req["people"]:
                if p.get("cadence") or not any(
                        s["month"] == month and s["kind"] == "sunday" and "Lead" in p["eligibility"].get(s["id"], [])
                        for s in req["services"]):
                    continue
                if any(r["kind"] == "count" and r["op"] == "==" and r["person"] == p["id"] and r["month"] == month
                       and "Sun.Lead" in r["roles"] for r in req["rules"]):
                    continue
                led = any(p["id"] in resp["assignments"][s["id"]]["Lead"] for s in req["services"]
                          if s["month"] == month and s["counts"] and s["date"] and s["kind"] != "saturday"
                          and _is_sunday(s["date"]))
                gap[p["id"]] = 0 if led else gap[p["id"]] + 1
                longest[p["id"]] = max(longest[p["id"]], gap[p["id"]])
    return all(v <= 1 for v in longest.values())


def _is_sunday(date):
    import datetime
    return datetime.date(int(date[:4]), int(date[5:7]), int(date[8:10])).weekday() == 6


def _floor_proof(chain, runs):
    """Every realised floor person: cumulative balance within ±2 seats each month, |slope| <= 0.15."""
    floor_people = set()
    for _, resp in runs:
        for p in resp["fairness"]["people"]:
            if any(f["realised"] for f in p["floor"]):
                floor_people.add(p["person"])
    months = [m for req, _ in runs for m in req["months"]]
    series = {}
    for m in months:
        cum = chain.cumulative(chain.data["start"], m)
        for (p, line), v in cum.items():
            if p in floor_people:
                series.setdefault((p, line), []).append(float(v))
    ok = True
    for values in series.values():
        if any(abs(v) > 2.0 for v in values):
            ok = False
        if len(values) >= 2:
            xs = list(range(len(values)))
            mx, my = statistics.fmean(xs), statistics.fmean(values)
            slope = sum((x - mx) * (y - my) for x, y in zip(xs, values)) / sum((x - mx) ** 2 for x in xs)
            if abs(slope) > 0.15:
                ok = False
    return ok, len(floor_people)


class Summary:
    def __init__(self, matrix):
        self.matrix = matrix
        self.criteria = {}
        self.stages = Counter()
        self.violations, self.missed, self.notices = Counter(), Counter(), Counter()
        self.total_ms = []
        self.max_gap = 0
        self.gaps = Counter({"pinless": 0, "pinned": 0})
        self.max_det_milli = 0
        self.runs = 0
        self.informational = {}

    def add_run(self, req, resp):
        verdict = checker.check(req, resp)
        self.runs += 1
        if resp.get("ok"):
            self.total_ms.append(resp["total_ms"])
            presence = []
            for r in req["rules"]:
                if r["kind"] == "presence" and r["id"] not in presence:
                    presence.append(r["id"])
            for s in resp["stages"]:
                self.stages[f"{public_label(s['id'], presence)} {s['status']}"] += 1
                if s["status"] == "proven":
                    self.max_det_milli = max(self.max_det_milli, s["det_milli"])
            if all(s["status"] == "proven" for s in resp["stages"]) and not resp["unfilled"]:
                key = "pinned" if req["pins"] else "pinless"
                self.gaps[key] = max(self.gaps[key], verdict["max_gap"])
                self.max_gap = max(self.max_gap, verdict["max_gap"])
        for k, v in verdict["violations"].items():
            self.violations[k] += v
        for k, v in verdict["missed"].items():
            self.missed[k] += v
        for k, v in verdict["notices"].items():
            self.notices[k] += v
        return verdict

    def criterion(self, name, passed):
        self.criteria[name] = "pass" if passed else "fail"

    def as_dict(self):
        ms = sorted(self.total_ms)
        p95 = ms[min(len(ms) - 1, int(round(0.95 * (len(ms) - 1))))] if ms else 0
        return {
            "matrix": self.matrix, "runs": self.runs,
            "ok": all(v == "pass" for v in self.criteria.values()),
            "criteria": dict(sorted(self.criteria.items())),
            "stages": dict(sorted(self.stages.items())),
            "timing": {"total_ms_max": max(ms) if ms else 0, "total_ms_p95": p95},
            "violations": dict(sorted(self.violations.items())),
            "missed": dict(sorted(self.missed.items())),
            "notices": dict(sorted(self.notices.items())),
            "max_gap": self.max_gap, "max_gap_by_pins": dict(self.gaps), "max_det_milli": self.max_det_milli,
            "informational": self.informational,
        }


def run_matrix(world_path, matrix, out_dir=None):
    x1.check_against_fixture()
    data = load_world(world_path)
    env, summary, plan = Env(data, out_dir), Summary(matrix), MATRIX[matrix]
    for seed in plan["A"]:
        req, resp = env.run(RUN_A, seed)
        env.record(f"A-s{seed}", req, resp)
        verdict = summary.add_run(req, resp)
        for name, ok in _passes_like_a(req, resp, verdict).items():
            summary.criterion(f"A.s{seed}.{name}", ok)
    for seed in plan["B"]:
        ch = env.base(seed)
        ch.run(RUN_A, seed)
        ch.drop_months(["2026-12"])
        req, resp = ch.run(["2026-12"], seed, store=False)
        env.record(f"B-s{seed}", req, resp)
        verdict = summary.add_run(req, resp)
        for name, ok in _passes_like_a(req, resp, verdict).items():
            summary.criterion(f"B.s{seed}.{name}", ok)
    for run_id, step in (("C", 2), ("D", 1)):
        for seed in plan[run_id]:
            runs, ch = env.chain_runs(CHAIN, step, seed)
            all_ok = len(runs) == len(CHAIN) // step
            for i, (req, resp) in enumerate(runs):
                env.record(f"{run_id}-s{seed}-r{i + 1}", req, resp)
                verdict = summary.add_run(req, resp)
                all_ok = all_ok and all(_passes_like_a(req, resp, verdict).values())
            summary.criterion(f"{run_id}.s{seed}.each_run_passes", all_ok)
            summary.criterion(f"{run_id}.s{seed}.regular_gap_le_1", _regular_gap_ok(ch, runs, data))
            proof, n = _floor_proof(ch, runs)
            summary.criterion(f"{run_id}.s{seed}.floor_seat_proof", proof)
            summary.informational[f"{run_id}.s{seed}.floor_people"] = n
    fictitious = bool(data.get("scenarios"))  # P and G name the fictitious world's members
    for seed in plan["P"] if fictitious else ():
        for sid, checks, runs in scenarios.scenario_runs(env, seed):
            for i, (req, resp) in enumerate(runs):
                env.record(f"{sid}-s{seed}-r{i + 1}", req, resp)
                verdict = summary.add_run(req, resp)
                if resp.get("ok") and sid not in ("P15",):
                    checks = checks + [("checker_ok", verdict["ok"])]
            for name, ok in checks:
                summary.criterion(f"{sid}.s{seed}.{name}", ok)
    for seed in plan["G"] if fictitious else ():
        for size, extra in ((9, ("m-leo", "m-mara")), (10, ("m-leo", "m-mara", "m-nico"))):
            members = [{"id": m, "name": m[2:].title(), "roles": ["Sun.Lead", "Sat.Lead", "Sun.BGV", "Sat.BGV",
                                                                  "Sun.Choir"],
                        "exempt": False, "cadence": False, "unavailable": []} for m in extra]
            ch = Env({**data, "members": data["members"] + members}).base(seed)
            for month in ("2026-11", "2026-12", "2027-01"):
                ch.run([month], seed)
            req, resp = ch.run(["2027-02", "2027-03"], seed, store=False)
            env.record(f"G{size}-s{seed}", req, resp)
            summary.add_run(req, resp)
            floors = [m for m in resp.get("missed", []) if m["code"] == "dl_floor_missed"]
            notice = any(n["code"] == "dl_capacity" for n in resp.get("notices", []))
            if size == 9:
                summary.criterion(f"G9.s{seed}.no_floor_miss", bool(resp.get("ok")) and not floors)
            else:
                summary.criterion(f"G10.s{seed}.capacity_notice", bool(resp.get("ok")) and notice)
                summary.criterion(f"G10.s{seed}.misses_by_capacity", all(m["cause"] == "capacity" for m in floors))
    for seed in plan["O"]:
        values = {}
        req = env.base(seed).request(RUN_A, seed)
        for order in ("F12", "prototype"):
            _, runner, _ = solve_problem(parse_request(req), consecutive_last=(order == "prototype"))
            values[order] = {public_label(r["id"], []): r["value"] for r in runner.records
                             if r["id"].startswith("balance_") and ":P:" not in r["id"]}
        summary.informational[f"O.s{seed}.balance_values"] = values
    result = summary.as_dict()
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
        with open(os.path.join(out_dir, "summary.json"), "w", encoding="utf-8") as f:
            json.dump(result, f, indent=1, sort_keys=True)
    return result


def emit_requests(world_path, out_dir):
    """The timing-gate shapes A–D (§13), from the fictitious world after its Aug–Oct chain."""
    data = load_world(world_path)
    env = Env(data)
    os.makedirs(out_dir, exist_ok=True)
    shapes = {
        "A": env.base(1).request(["2026-11"], 1),
        "B": env.base(1).request(RUN_A, 1),
    }
    every = Env(data)
    ch = every.base(1, {"saturdays": "every"})
    ch.drop_months(["2026-10"])
    shapes["C"] = ch.request(["2026-10", "2026-11"], 1)
    req = shapes["B"]
    _, resp, _ = handle(req)
    pins = []
    for s in req["services"]:
        for role, ids in resp["assignments"][s["id"]].items():
            for p in ids:
                pins.append({"service": s["id"], "date": s["date"], "role": role, "person": p})
    shapes["D"] = {**req, "pins": pins[:100], "request_id": "shape-D"}
    for name, body in shapes.items():
        body = {**body, "request_id": f"shape-{name}"}
        with open(os.path.join(out_dir, f"shape-{name}.json"), "w", encoding="utf-8") as f:
            json.dump(body, f, ensure_ascii=False)
    return sorted(shapes)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--world", default=WORLD)
    ap.add_argument("--matrix", choices=sorted(MATRIX), default="ci")
    ap.add_argument("--out")
    ap.add_argument("--emit-requests", dest="emit")
    args = ap.parse_args(argv)
    if args.emit:
        names = emit_requests(args.world, args.emit)
        print(json.dumps({"emitted": names}))
        return 0
    if not args.out:
        ap.error("--out is required")
    try:
        result = run_matrix(args.world, args.matrix, args.out)
    except x1.HarnessError as e:
        print(json.dumps({"harness_error": str(e)}))
        return 2
    print(json.dumps(result, indent=1, sort_keys=True))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
```

**Create** `gcf_v3/acceptance/smoke.json`:

```json
{
  "contract": 3,
  "seed": 1,
  "months": [
    "2026-11"
  ],
  "services": [
    {"id": "smoke-2026-11-01-sun", "date": "2026-11-01", "month": "2026-11", "kind": "sunday", "fixed": false, "counts": true, "seats": {"Lead": 2, "BGV": 3, "Choir": 3}},
    {"id": "smoke-2026-11-07-sat", "date": "2026-11-07", "month": "2026-11", "kind": "saturday", "fixed": false, "counts": true, "seats": {"Lead": 2, "BGV": 3}},
    {"id": "smoke-2026-11-08-sun", "date": "2026-11-08", "month": "2026-11", "kind": "sunday", "fixed": false, "counts": true, "seats": {"Lead": 2, "BGV": 3, "Choir": 3}}
  ],
  "people": [
    {"id": "m-ana", "name": "Ana", "eligibility": {"smoke-2026-11-01-sun": ["Lead", "BGV", "Choir"], "smoke-2026-11-07-sat": ["Lead", "BGV"], "smoke-2026-11-08-sun": ["Lead", "BGV", "Choir"]}, "carried": {"DL": -40}, "dl_since": "2026-05", "prev_dl_leads": 0, "cadence": {"2026-11": "off"}},
    {"id": "m-bea", "name": "Bea", "eligibility": {"smoke-2026-11-01-sun": ["Lead", "BGV", "Choir"], "smoke-2026-11-07-sat": ["Lead", "BGV"], "smoke-2026-11-08-sun": ["Lead", "BGV", "Choir"]}, "carried": {"DL": -30}, "dl_since": "2026-05", "prev_dl_leads": 1},
    {"id": "m-cris", "name": "Cris", "eligibility": {"smoke-2026-11-01-sun": ["Lead", "BGV", "Choir"], "smoke-2026-11-07-sat": ["Lead", "BGV"], "smoke-2026-11-08-sun": ["Lead", "BGV", "Choir"]}, "carried": {"DL": -20}, "dl_since": "2026-05", "prev_dl_leads": 0},
    {"id": "m-dario", "name": "Dario", "eligibility": {"smoke-2026-11-01-sun": ["Lead", "BGV", "Choir"], "smoke-2026-11-07-sat": ["Lead", "BGV"], "smoke-2026-11-08-sun": ["Lead", "BGV", "Choir"]}, "carried": {"DL": -10}, "dl_since": "2026-05", "prev_dl_leads": 1},
    {"id": "m-ema", "name": "Ema", "eligibility": {"smoke-2026-11-01-sun": ["Lead", "BGV", "Choir"], "smoke-2026-11-07-sat": ["Lead", "BGV"], "smoke-2026-11-08-sun": ["Lead", "BGV", "Choir"]}, "carried": {"DL": 0}, "dl_since": "2026-05", "prev_dl_leads": 0},
    {"id": "m-fede", "name": "Fede", "eligibility": {"smoke-2026-11-01-sun": ["Lead", "BGV", "Choir"], "smoke-2026-11-07-sat": ["Lead", "BGV"], "smoke-2026-11-08-sun": ["Lead", "BGV", "Choir"]}, "carried": {"DL": 10}, "dl_since": "2026-05", "prev_dl_leads": 1},
    {"id": "m-gala", "name": "Gala", "eligibility": {"smoke-2026-11-01-sun": ["Lead", "BGV", "Choir"], "smoke-2026-11-07-sat": ["Lead", "BGV"], "smoke-2026-11-08-sun": ["Lead", "BGV", "Choir"]}, "carried": {"DL": 20}, "dl_since": "2026-05", "prev_dl_leads": 0},
    {"id": "m-ines", "name": "Ines", "eligibility": {"smoke-2026-11-01-sun": ["Lead", "BGV", "Choir"], "smoke-2026-11-07-sat": ["Lead", "BGV"], "smoke-2026-11-08-sun": ["Lead", "BGV", "Choir"]}, "carried": {"DL": 30}, "dl_since": "2026-05", "prev_dl_leads": 1},
    {"id": "m-jose", "name": "Jose", "eligibility": {"smoke-2026-11-01-sun": ["Lead", "BGV", "Choir"], "smoke-2026-11-07-sat": ["Lead", "BGV"], "smoke-2026-11-08-sun": ["Lead", "BGV", "Choir"]}, "carried": {"DL": 40}, "dl_since": "2026-05", "prev_dl_leads": 0}
  ],
  "rules": [
    {"id": "pres-1", "kind": "presence", "persons": ["m-gala", "m-ines"], "roles": ["Sun.BGV"], "exclusive": false},
    {"id": "pair-1", "kind": "pair", "persons": ["m-bea", "m-cris"], "roles": ["Sun.Lead"]}
  ],
  "pins": [],
  "prior": {"month": "2026-10", "has_services": true, "services": []},
  "request_id": "smoke"
}
```

- [ ] **Step 4: Run the suite and the layout guard**

Run: `time "$PY" -m unittest discover -s gcf_v3 -t gcf_v3 2>&1 | tail -3 && npx vitest run scripts/__tests__/ciLayout.test.ts 2>&1 | tail -4`
Expected: `Ran 175 tests … OK` in about 20 s on an M-series Mac (the `ci` subset is ≈ 13 s of it: 43 solves); `Tests  51 passed (51)` — `acceptance/` is a package with no `test*.py`, so discovery reaches it only through `tests/`.

- [ ] **Step 5: Run the `ci` matrix through the CLI once, and read its summary**

Run: `"$PY" gcf_v3/acceptance/run.py --matrix ci --out /private/tmp/c5-ci > /dev/null; echo "exit $?"; "$PY" -c "import json; s=json.load(open('/private/tmp/c5-ci/summary.json')); print(s['runs'], s['ok'], s['max_gap_by_pins'])"`
Expected: `exit 0`; `43 True {'pinless': 63, 'pinned': 128}` — every criterion passes (no gap criterion exists before Task 15); the pinless 63 is Finding F-1's cause 1 and the pinned 128 its cause 2 (scenario P6), both on the `ci` subset.

- [ ] **Step 6: Commit**

```bash
git add gcf_v3/acceptance gcf_v3/tests/test_acceptance_ci.py gcf_v3/tests/test_acceptance_tools.py gcf_v3/tests/test_public_outputs.py
git commit -m "test(solver-v3): the offline acceptance harness, its checker and the ci subset" -m "Spec C5 §12.3: a fictitious world with today's structure (17 voices, no real person) is chained from Aug 2026, each next request's carried balances coming from the same formula, its cadence states from a test-only X1 checked against C2's cadence cases first, and its prior from the stored services. Runs A-D and the scenario set P are judged by an independent checker that recomputes from the assignments alone and prints counts, codes and public stage labels only. The ci subset runs inside C0's one discovery command."
```

---

## Task 15: Measurements and the F13 gate

Spec §12.4 (the tolerance: measure over the `full` matrix and the private re-run; above 50 is a finding), OQ-1 (`STAGE_DET_LIMIT`), §12.3 «The private re-run on real data» (A23; who, input, command, what reaches the repo), §12.3 run G and run O, C5-R6, C5-R14. Finding F-1 above.

**Files:**
- Branch (a)+(c): Modify `gcf_v3/owt_v3/plan.py`, `gcf_v3/tests/test_plan.py`, `gcf_v3/owt_v3/constants.py`, `gcf_v3/acceptance/run.py`, `gcf_v3/tests/test_acceptance_ci.py`
- Branch (b)+(c): Modify `gcf_v3/owt_v3/constants.py`, `gcf_v3/acceptance/run.py`, `gcf_v3/tests/test_acceptance_ci.py`
- Private, never committed: `owt-agent-logs/sdd/2026-10-05-solver-v3-fairness/c5/{convert_world.py, cadence.json, world.json, out-*/}`

**Interfaces:**
- Consumes: Task 14's harness; Frank's ruling on F-1.
- Produces: the final `STAGE_DET_LIMIT` and `FAIRNESS_TOLERANCE`; the criterion `F13.pinless_gap_within_tolerance` in `summary.json`; the aggregates the PR, the review log and C7's cutover record carry.

- [ ] **Step 1: The fictitious `full` matrix, with the deterministic limit opened to its ceiling**

```bash
sed -i.bak 's/^STAGE_DET_LIMIT = 0.6$/STAGE_DET_LIMIT = 1.0/' gcf_v3/owt_v3/constants.py
"$PY" gcf_v3/acceptance/run.py --matrix full --out /private/tmp/c5-full > /dev/null; echo "exit $?"
"$PY" -c "import json; s=json.load(open('/private/tmp/c5-full/summary.json')); print(s['runs'], s['ok'], s['max_det_milli'], s['max_gap_by_pins'], s['timing'])"
mv gcf_v3/owt_v3/constants.py.bak gcf_v3/owt_v3/constants.py && git diff --exit-code gcf_v3/owt_v3/constants.py
```

Expected: `exit 0`; `136 True 112 {'pinless': 65, 'pinned': 131} …` (about a minute; `total_ms` p95 ≈ 0.5 s on an M-series Mac). Every stage of every run is proven except scenario P15's (its tiny limits are the point), so `max_det_milli` is over proven stages only.

- [ ] **Step 2: The private re-run on real data (Frank's machine; nothing from it is committed)**

The converter lives in the private repo and reads its read-only dumps (`members.json`, `config.json`, `roles.json` — the same files the prototype read). It approximates C6's request builder and C4's records (spec §12.3 «Limit»): eligibility by Tipo minus excluded patterns, the stored Aug–Oct weekend services as history, availability from `unavailableDates`, the cadence members named in a private `cadence.json`.

**Create (private — `owt-agent-logs/sdd/2026-10-05-solver-v3-fairness/c5/convert_world.py`, never in this repo):**

```python
"""PRIVATE converter (never in the public repo): read-only production dumps -> the acceptance
harness's world format (gcf_v3/acceptance/world.py docstring). Prints counts only.

    python convert_world.py --dumps <dir with members.json, config.json, roles.json> \
        --cadence <file: JSON list of the cadence members' display names> --out world.json

It approximates C6's request builder and C4's records (spec C5 §12.3 «Limit»): eligibility by
Tipo (voz + sunday_lead / saturday_lead / support) minus excluded patterns, the stored weekend
services as history, availability from unavailableDates. C7's rehearsal re-checks with the real
builder.
"""
import argparse
import json
import os

PATTERN_KEYS = {
    "Sun.Lead": ["Sun.Lead"], "Sat.Lead": ["Sat.Lead"], "Sun.BGV": ["Sun.BGV"], "Sat.BGV": ["Sat.BGV"],
    "Sun.Choir": ["Sun.Choir"], "Sat.Choir": ["Sat.Choir"],
    "Sun.*": ["Sun.Lead", "Sun.BGV", "Sun.Choir"], "Sat.*": ["Sat.Lead", "Sat.BGV", "Sat.Choir"],
    "*.Lead": ["Sun.Lead", "Sat.Lead"], "*.BGV": ["Sun.BGV", "Sat.BGV"], "*.Choir": ["Sun.Choir", "Sat.Choir"],
    "*.LeadBGV": ["Sun.Lead", "Sat.Lead", "Sun.BGV", "Sat.BGV"], "*.*": [
        "Sun.Lead", "Sat.Lead", "Sun.BGV", "Sat.BGV", "Sun.Choir", "Sat.Choir"],
}
ROLE_KEYS = ["Sun.Lead", "Sat.Lead", "Sun.BGV", "Sat.BGV", "Sun.Choir"]


def keys(pattern):
    if pattern not in PATTERN_KEYS:
        raise SystemExit(f"unmapped pattern shape (#{len(pattern)} chars)")
    return PATTERN_KEYS[pattern]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dumps", required=True)
    ap.add_argument("--cadence", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    load = lambda n: json.load(open(os.path.join(a.dumps, n), encoding="utf-8"))
    members, config, roles = load("members.json"), load("config.json")[0], load("roles.json")
    cadence_names = set(json.load(open(a.cadence, encoding="utf-8")))
    by_name = {}
    for m in members:
        for n in (m.get("member_name"), m.get("alias")):
            if n:
                by_name.setdefault(n, []).append(m["_id"])
    resolve = lambda n: by_name[n][0] if len(by_name.get(n, [])) == 1 else None
    restriction = {resolve(r["person"]): r for r in config["restrictions"] if resolve(r["person"])}
    world_members, ids = [], set()
    for m in members:
        tipo = set(m.get("memberType") or [])
        if "voz" not in tipo or not tipo & {"sunday_lead", "saturday_lead", "support"}:
            continue
        allowed = []
        for k in ROLE_KEYS:
            if k == "Sun.Lead":
                ok = "sunday_lead" in tipo
            elif k == "Sat.Lead":
                ok = bool(tipo & {"sunday_lead", "saturday_lead"})
            else:
                ok = True
            r = restriction.get(m["_id"])
            if ok and r and any(k in keys(p) for p in r["excludedPatterns"]):
                ok = False
            if ok:
                allowed.append(k)
        r = restriction.get(m["_id"])
        names = {m.get("member_name"), m.get("alias")}
        world_members.append({"id": m["_id"], "name": "(private)", "roles": allowed,
                              "exempt": bool(r and r["fairness"] == "exempt"),
                              "cadence": bool(names & cadence_names),
                              "unavailable": sorted(m.get("unavailableDates") or [])})
        ids.add(m["_id"])
    rules = []
    for i, (mid, r) in enumerate(sorted(restriction.items())):
        if mid not in ids:
            continue
        for j, cap in enumerate(r["caps"]):
            rule = {"id": f"cap-{i + 1}-{j + 1}", "kind": "count", "person": mid, "roles": keys(cap["pattern"]),
                    "op": cap["op"]}
            if cap.get("relative"):
                rule["sundays_minus"] = cap.get("relOffset") or 0
            else:
                rule["value"] = cap["value"]
            rules.append(rule)
    pairs = []
    for i, c in enumerate(config["conflicts"]):
        a_, b_ = resolve(c["personA"]), resolve(c["personB"])
        if a_ in ids and b_ in ids:
            pairs.append((a_, b_, keys(c["pattern"])))
            rules.append({"id": f"pair-{i + 1}", "kind": "pair", "persons": [a_, b_], "roles": keys(c["pattern"])})
    for i, p in enumerate(config["presence"]):
        persons = [resolve(n) for n in p["persons"]]
        persons = [x for x in persons if x in ids]
        roles_ = keys(p["pattern"])
        exclusive = all(any({x, y} == {a_, b_} and set(roles_) <= set(ks) for a_, b_, ks in pairs)
                        for i_, x in enumerate(persons) for y in persons[i_ + 1:])
        rules.append({"id": f"pres-{i + 1}", "kind": "presence", "persons": persons, "roles": roles_,
                      "exclusive": exclusive})
    stored = []
    kinds = {"sunday_role": "sunday", "saturday_role": "saturday"}
    for d in roles:
        if d["_type"] not in kinds or d["week"] < "2026-08-01":
            continue
        stored.append({"id": d["_id"], "date": d["week"], "kind": kinds[d["_type"]], "counts": True,
                       "seats": {"Lead": [x for x in d.get("Lead") or [] if x],
                                 "BGV": [x for x in d.get("BGVs") or [] if x],
                                 "Choir": [x for x in d.get("Chorus") or [] if x]}})
    world = {"schema": 1, "description": "PRIVATE — real roster, never commit", "start": "2026-08",
             "saturday_anchor": "2026-08-08",
             "seats": {"sunday": {"Lead": 2, "BGV": 3, "Choir": 3}, "saturday": {"Lead": 2, "BGV": 3}},
             "availability": {"seed": 0, "rate": 0}, "members": world_members, "rules": rules,
             "stored": sorted(stored, key=lambda s: (s["date"], s["id"]))}
    json.dump(world, open(a.out, "w", encoding="utf-8"), ensure_ascii=False)
    print(json.dumps({"members": len(world_members), "cadence": sum(m["cadence"] for m in world_members),
                      "rules": len(rules), "stored": len(stored)}))


if __name__ == "__main__":
    main()
```

```bash
P=/Users/frankrocha/Documents/Builds/owt-agent-logs/sdd/2026-10-05-solver-v3-fairness
# cadence.json: a JSON list of the three cadence members' display names, written by hand, private
"$PY" "$P/c5/convert_world.py" --dumps "$P/prototype" --cadence "$P/c5/cadence.json" --out "$P/c5/world.json"
sed -i.bak 's/^STAGE_DET_LIMIT = 0.6$/STAGE_DET_LIMIT = 1.0/' gcf_v3/owt_v3/constants.py
"$PY" gcf_v3/acceptance/run.py --world "$P/c5/world.json" --matrix full --out "$P/c5/out-literal" > /dev/null; echo "exit $?"
mv gcf_v3/owt_v3/constants.py.bak gcf_v3/owt_v3/constants.py
"$PY" -c "import json; s=json.load(open('$P/c5/out-literal/summary.json')); print(s['runs'], s['ok'], s['max_det_milli'], s['max_gap_by_pins'], s['missed'], s['violations'])"
```

Expected: the converter prints counts only (`{"members": 17, "cadence": 3, "rules": 11, "stored": 18}` on the 2026-10-05 dumps); the run prints `64 True 83 {'pinless': 50, 'pinned': 0} {} {}` — runs A, B, C, D and O only (the scenario sets P and G name the fictitious world's members; the private world has no `scenarios` flag). Only `summary.json`'s aggregates may be copied into the PR, the review log or the cutover record (C5-17); `out-*/runs/` holds raw ids and stays private.

- [ ] **Step 3: Fix `STAGE_DET_LIMIT` (OQ-1)**

The value is the smallest multiple of 0.05 at or above 5 × the larger `max_det_milli` of Steps 1–2 (and Step 5 below), capped at 1.0. Measured: 112–113 ms → 0.565 → **0.6**, which `constants.py` already holds. If a re-measurement gives another value, edit the one line `STAGE_DET_LIMIT = …` in `gcf_v3/owt_v3/constants.py` and re-run Steps 1–2 at that value to confirm every stage still proves.

- [ ] **Step 4: Apply Frank's ruling on Finding F-1**

No ruling → stop here (spec §12.4). Apply exactly one branch.

**Branch (a)+(c) — spread F6 exit, tolerance scoped to pinless runs (recommended).**

**Find** in `gcf_v3/owt_v3/plan.py`:

```text
    sa = defaultdict(Fraction)  # (sid, key) -> seats
```

**Replace with:**

```text
    sa = defaultdict(Fraction)  # (sid, key) -> seats
    weight = defaultdict(lambda: Fraction(1))  # (sid, key, p) -> population membership weight
```

**Find** in `gcf_v3/owt_v3/plan.py`:

```text
        _spread(sa, targets, max(0, c - pinned))
    for p in F.pids:
```

**Replace with:**

```text
        _spread(sa, targets, max(0, c - pinned))
        remainder = max(0, c - pinned)
        for sid, keys in targets:  # the F6 exit, spread like the set-aside (spec §6.2 as amended, F-1 (a))
            sv = F.svc[sid]
            for role in sv.roles:
                if sv.key(role) not in keys:
                    weight[(sid, sv.key(role), r.person)] *= 1 - Fraction(remainder, len(targets))
    for p in F.pids:
```

**Find** in `gcf_v3/owt_v3/plan.py`:

```text
                pool = max(Fraction(0), base - sa[(s.id, k)] - extra_sa[(s.id, k)])
                for p in members:
                    out[(s.month, p, LINE_OF_KEY[k])] += pool / len(members)
```

**Replace with:**

```text
                pool = max(Fraction(0), base - sa[(s.id, k)] - extra_sa[(s.id, k)])
                total = sum((weight[(s.id, k, p)] for p in members), Fraction(0))
                for p in members:
                    out[(s.month, p, LINE_OF_KEY[k])] += pool * weight[(s.id, k, p)] / total
```

**Find** in `gcf_v3/owt_v3/plan.py`:

```text
One reading the spec leaves to the plan: a pinned seat that will be a rule's presence
seat (a member's pin in one of the rule's role keys that is not a fixed seat) IS that
rule's forced presence seat, so it is removed from the pool once, not twice.
```

**Replace with:**

```text
One reading the spec leaves to the plan: a pinned seat that will be a rule's presence
seat (a member's pin in one of the rule's role keys that is not a fixed seat) IS that
rule's forced presence seat, so it is removed from the pool once, not twice.

Amendment F-1 (a) (Frank's ruling at the F13 gate): an exact rule WITH slack spreads its F6
exit the way C5-9 spreads its set-aside — at each target service she weighs
1 − remainder/|targets| in the other role keys' populations, and a pool is shared in
proportion to the weights. Without it the realised exit (C2 LG-8 (vii)) is invisible to the
plan and the F13 gap exceeds half a seat.
```

**Find** in `gcf_v3/tests/test_plan.py`:

```text
        _, plan = plan_of(request(s, people, rules=[rule]))
        self.assertEqual(plan.planned("m-ana", "DL"), 1)  # in the Lead pool at both Sundays
```

**Replace with:**

```text
        _, plan = plan_of(request(s, people, rules=[rule]))
        # nothing is decided, but the spread F6 exit (amendment F-1 (a)) leaves her half a member
        # of the Lead pool at each Sunday: 1 x (1/2) / (1/2 + 1) per Sunday
        self.assertEqual(plan.planned("m-ana", "DL"), Fraction(2, 3))
```

**Find** in `gcf_v3/tests/test_plan.py`:

```text
class MonthlySetAsides(unittest.TestCase):
```

**Replace with:**

```text
class SpreadExit(unittest.TestCase):
    """Amendment F-1 (a): an exact rule with slack spreads its F6 exit like its set-aside."""

    def test_the_exit_is_spread_over_her_target_services(self):
        s = sundays(2, {"Lead": 1, "BGV": 0, "Choir": 1})
        ana = person("m-ana", {"s1": ["Lead", "Choir"], "s2": ["Lead", "Choir"]}, exempt=True)
        bea = person("m-bea", {"s1": ["Choir"], "s2": ["Choir"]}, exempt=True)
        rule = {"id": "cap-a", "kind": "count", "person": "m-ana", "roles": ["Sun.Lead"], "op": "==",
                "month": "2026-11", "value": 1}
        _, plan = plan_of(request(s, [ana, bea], rules=[rule]))
        # each Sunday: Choir pool 1, ana weighs 1 - 1/2; she gets 1/3, bea 2/3
        self.assertEqual(plan.planned("m-ana", "CORO"), Fraction(2, 3))
        self.assertEqual(plan.planned("m-bea", "CORO"), Fraction(4, 3))


class MonthlySetAsides(unittest.TestCase):
```

**Find** in `gcf_v3/owt_v3/constants.py`:

```text
# F13 (spec §12.4): the smallest multiple of 5 hundredths at or above the largest
# |planned - share| measured over the `full` matrix (Task 15). Above 50 is a finding.
FAIRNESS_TOLERANCE = 50
```

**Replace with:**

```text
# F13 (spec §12.4 as amended at the F13 gate): the smallest multiple of 5 hundredths at or above
# the largest |planned - share| over the pinless, all-proven, fully filled runs of the `full`
# matrix and of the private re-run. A pinned run's gap is reported, not bound by it.
FAIRNESS_TOLERANCE = 35
```

**Find** in `gcf_v3/acceptance/run.py`:

```text
from owt_v3.request import parse_request  # noqa: E402
```

**Replace with:**

```text
from owt_v3.constants import FAIRNESS_TOLERANCE  # noqa: E402
from owt_v3.request import parse_request  # noqa: E402
```

**Find** in `gcf_v3/acceptance/run.py`:

```text
    result = summary.as_dict()
    if out_dir:
```

**Replace with:**

```text
    # F13 (spec §12.4 as amended, Task 15): the tolerance binds pinless runs where every stage is
    # proven and nothing is unfilled; a pinned run's gap is reported (`max_gap_by_pins`), not judged.
    summary.criterion("F13.pinless_gap_within_tolerance", summary.gaps["pinless"] <= FAIRNESS_TOLERANCE)
    result = summary.as_dict()
    if out_dir:
```

**Find** in `gcf_v3/tests/test_acceptance_ci.py`:

```text
from acceptance import run, x1
from acceptance.world import load_world
```

**Replace with:**

```text
from acceptance import run, x1
from acceptance.world import load_world
from owt_v3.constants import FAIRNESS_TOLERANCE
```

**Find** in `gcf_v3/tests/test_acceptance_ci.py`:

```text
    def test_the_summary_is_public(self):
```

**Replace with:**

```text
    def test_the_f13_gap_is_within_the_tolerance_on_pinless_runs(self):
        self.assertGreater(self.summary["max_gap_by_pins"]["pinless"], 0)  # measured, not vacuous
        self.assertLessEqual(self.summary["max_gap_by_pins"]["pinless"], FAIRNESS_TOLERANCE)

    def test_the_summary_is_public(self):
```

**Branch (b)+(c) — formula as written, ceiling raised, tolerance scoped to pinless runs.** Apply only these three; leave `plan.py` and `test_plan.py` as they are.

**Find** in `gcf_v3/owt_v3/constants.py`:

```text
# F13 (spec §12.4): the smallest multiple of 5 hundredths at or above the largest
# |planned - share| measured over the `full` matrix (Task 15). Above 50 is a finding.
FAIRNESS_TOLERANCE = 50
```

**Replace with:**

```text
# F13 (spec §12.4 as amended at the F13 gate): the smallest multiple of 5 hundredths at or above
# the largest |planned - share| over the pinless, all-proven, fully filled runs of the `full`
# matrix and of the private re-run. A pinned run's gap is reported, not bound by it.
FAIRNESS_TOLERANCE = 65
```

The `run.py` and `test_acceptance_ci.py` edits of branch (a) above, unchanged (the two `m_gate_*` blocks).

- [ ] **Step 5: Re-measure under the ruling**

```bash
"$PY" gcf_v3/acceptance/run.py --matrix full --out /private/tmp/c5-full-ruled > /dev/null; echo "exit $?"
"$PY" -c "import json; s=json.load(open('/private/tmp/c5-full-ruled/summary.json')); print(s['ok'], s['criteria']['F13.pinless_gap_within_tolerance'], s['max_det_milli'], s['max_gap_by_pins'])"
"$PY" gcf_v3/acceptance/run.py --world "$P/c5/world.json" --matrix full --out "$P/c5/out-ruled" > /dev/null; echo "exit $?"
"$PY" -c "import json; s=json.load(open('$P/c5/out-ruled/summary.json')); print(s['ok'], s['max_det_milli'], s['max_gap_by_pins'])"
```

Expected, branch (a): `exit 0`; `True pass 113 {'pinless': 35, 'pinned': 131}`; private `True 112 {'pinless': 23, 'pinned': 0}`. Branch (b): `True pass 112 {'pinless': 65, 'pinned': 131}`; private `True 83 {'pinless': 50, 'pinned': 0}`. `FAIRNESS_TOLERANCE` is the smallest multiple of 5 at or above the larger pinless maximum (35 or 65) — what the branch's constant edit wrote; if a re-measurement differs, edit that one line and repeat this step. A pinless maximum above the ruled tolerance is a finding: stop and report.

- [ ] **Step 6: Run the suite**

Run: `"$PY" -m unittest discover -s gcf_v3 -t gcf_v3 2>&1 | tail -3 && npx vitest run scripts/__tests__/ciLayout.test.ts 2>&1 | tail -4`
Expected: branch (a) `Ran 177 tests … OK`; branch (b) `Ran 176 tests … OK`; `Tests  51 passed (51)`.

- [ ] **Step 7: Commit**

```bash
git add gcf_v3/owt_v3/constants.py gcf_v3/acceptance/run.py gcf_v3/tests/test_acceptance_ci.py
git add gcf_v3/owt_v3/plan.py gcf_v3/tests/test_plan.py   # branch (a) only; a no-op under (b)
git commit -m "feat(solver-v3): the measured F13 tolerance and the ruled planned-share exit" -m "Spec C5 §12.4 and Finding F-1: the gap between planned and realised shares, measured over the full fictitious matrix and the private real-data chain, sets FAIRNESS_TOLERANCE; per Frank's ruling it binds pinless runs where every stage is proven and nothing is unfilled, and a pinned run's gap is reported, not judged. STAGE_DET_LIMIT stays 0.6 (5x the largest proven deterministic time, OQ-1). Aggregates only; the private outputs stay outside the repo."
```

---

## Task 16: Documentation in the same delivery

Spec §14 (`docs/SOLVER_AND_INFRA.md` section, `docs/SECRETS.md` entries of §11.6, `docs/CI.md` measured job time, the ADR of A31), §11.6, §12.2 (`timeout-minutes` by C0's rule), C5-R12; repo `CLAUDE.md` «Keep documentation current», «Any new secret or env var gets an entry»; `~/.claude/CLAUDE.md` secrets rule.

**Files:**
- Modify: `docs/SECRETS.md`, `docs/SOLVER_AND_INFRA.md`, `docs/CI.md`, `docs/adr/README.md`
- Create: `docs/adr/0049-the-v3-solver-is-a-second-function-solved-in-stages.md`
- Modify only if the measured `solver-v3` job exceeds 7m30s: `.github/workflows/ci.yml`, `scripts/__tests__/ciLayout.test.ts`

**Interfaces:** none.

- [ ] **Step 1: `docs/SECRETS.md` — amend `OWT_SOLVER_API_KEY`, add `OWT_SOLVER_V3_BUILD`**

**Find** in `docs/SECRETS.md`:

```text
**Needed in: Vercel Preview AND Production (the SAME value — both environments call the one
Cloud Function) and GCP Secret Manager `owt-solver-api-key` (project `eloquent-figure-421401`).
Not needed in:** `.env.local` (with `OWT_SOLVER_URL` unset, local dev spawns
`gcf/owt_solver_v2.py` directly and no key is involved), GitHub Actions, the iOS build.
```

**Replace with:**

```text
**Needed in: Vercel Preview AND Production (the SAME value — both environments call the solver
functions) and GCP Secret Manager `owt-solver-api-key` (project `eloquent-figure-421401`), which
BOTH Cloud Functions read: `owt-solver` (v2) and, since solver v3 C5, `owt-solver-v3` (one key for
both — same trust boundary, same caller, spec C5-14). Not needed in:** `.env.local` (with
`OWT_SOLVER_URL` unset, local dev spawns `gcf/owt_solver_v2.py` — or, for v3,
`gcf_v3/owt_solver_v3.py --json-mode` — directly and no key is involved), GitHub Actions (the
`solver-v3` job calls the handler with a stub key), the iOS build.
```

**Find** in `docs/SECRETS.md`:

```text
| Secret Manager `owt-solver-api-key` | Cloud Build deploys the function with `--set-secrets=OWT_SOLVER_API_KEY=owt-solver-api-key:latest` (`cloudbuild.yaml`, and `scripts/deploy-solver-gcf.sh` for a manual deploy) |
```

**Replace with:**

```text
| Secret Manager `owt-solver-api-key` | Cloud Build deploys each function with `--set-secrets=OWT_SOLVER_API_KEY=owt-solver-api-key:latest`: v2 from `cloudbuild.yaml` (manual: `scripts/deploy-solver-gcf.sh`), v3 from `gcf_v3/cloudbuild.yaml` (first creation and manual: `scripts/deploy-solver-v3-gcf.sh`) |
```

**Find** in `docs/SECRETS.md`:

```text
**Purpose.** The only barrier on a publicly invokable function (`allUsers` holds
`run.invoker`). Without it on the function, `gcf/main.py` answers **503** to every call (fails
```

**Replace with:**

```text
**Purpose.** The only barrier on each publicly invokable function (`allUsers` holds
`run.invoker`). Without it on a function, its handler (`gcf/main.py`, `gcf_v3/main.py`) answers
**503** to every call (fails
```

**Find** in `docs/SECRETS.md`:

```text
3. **Redeploy the function** so no warm instance keeps the old key (`gcf/main.py` reads it once,
   at import): re-run the Cloud Build trigger `owt-solver-deploy` on `main` (console → Cloud Build
   → Triggers → Run), or, **from the fetched tip of `main`** (`git fetch && git switch --detach
   origin/main` — the script deploys whatever `gcf/` is on disk, to the one function production
   uses, so a stale or feature checkout would ship old or unreviewed solver code),
   `GCP_PROJECT=eloquent-figure-421401 bash scripts/deploy-solver-gcf.sh`.
```

**Replace with:**

```text
3. **Redeploy BOTH functions** so no warm instance keeps the old key (`gcf/main.py` and
   `gcf_v3/main.py` each read it once, at import): re-run both Cloud Build triggers on `main`,
   `owt-solver-deploy` and `owt-solver-v3-deploy` (console → Cloud Build → Triggers → Run), or,
   **from the fetched tip of `main`** (`git fetch && git switch --detach origin/main` — each script
   deploys whatever its directory holds on disk, so a stale or feature checkout would ship old or
   unreviewed solver code), `GCP_PROJECT=eloquent-figure-421401 bash scripts/deploy-solver-gcf.sh`
   and `GCP_PROJECT=eloquent-figure-421401 bash scripts/deploy-solver-v3-gcf.sh`. Each function
   reads `:latest` when an instance starts.
```

**Find** in `docs/SECRETS.md`:

```text
5. Verify with the smoke request in `docs/SOLVER_AND_INFRA.md` ("Verifying a Cloud Function
   deploy"), which reads the new value from Secret Manager — then one «Generar mes» on dev.
```

**Replace with:**

```text
5. Verify with the smoke requests in `docs/SOLVER_AND_INFRA.md` ("Verifying a Cloud Function
   deploy" for v2, "Verifying a v3 deploy" for v3), which read the new value from Secret
   Manager — then one «Generar mes» on dev.
```

**Find** in `docs/SECRETS.md`:

```text
**Blast radius of rotation.** From step 2 until each Vercel environment's redeploy (step 4)
completes, any request that reaches a freshly started function instance fails with HTTP 401 —
«Generar mes» fails in both environments, intermittently at first (warm instances still hold the
old key) and then always.
```

**Replace with:**

```text
**Blast radius of rotation.** From step 2 until both functions and each Vercel environment's
redeploy (steps 3–4) complete, any request that reaches a freshly started instance of EITHER
function fails with HTTP 401 — «Generar mes» fails in both environments, on v2 as today and on
every environment whose engine is v3, intermittently at first (warm instances still hold the
old key) and then always.
```

**Find** in `docs/SECRETS.md`:

```text
Then redeploy exactly as steps 3 (function) and 4 (Vercel) — warm instances and any Vercel
deployment built in between may hold the new key — and verify as in step 5.
```

**Replace with:**

```text
Then redeploy exactly as steps 3 (both functions) and 4 (Vercel) — warm instances and any
Vercel deployment built in between may hold the new key — and verify as in step 5.
```

**Find** in `docs/SECRETS.md`:

```text


---

## Not yet documented
```

**Replace with:**

```text


---

## `OWT_SOLVER_V3_BUILD` (function config — not a secret)

**Needed in: the `owt-solver-v3` Cloud Function only.** Not Vercel, not GitHub Actions, not
`.env.local`, not the iOS build — and not v2's `owt-solver`, which has no such field.

**Purpose.** The commit the function was deployed from, echoed as `build` by every v3 response
and by the ping (`{"contract": 3, "ping": true}`). It is what the deploy check compares with the
merged SHA (`docs/SOLVER_AND_INFRA.md` «Verifying a v3 deploy», the function's analogue of the
Vercel alias check). When absent, `build` is `"unknown"` and nothing else breaks.

**Where the value comes from.** Cloud Build's `$COMMIT_SHA` (`gcf_v3/cloudbuild.yaml`,
`--set-env-vars=OWT_SOLVER_V3_BUILD=$COMMIT_SHA`), or `git rev-parse HEAD` in
`scripts/deploy-solver-v3-gcf.sh`. Never set by hand.

**How to rotate.** Nothing to rotate: every deploy rewrites it.

**Blast radius of rotation.** None.

---

## Not yet documented
```

- [ ] **Step 2: `docs/SOLVER_AND_INFRA.md` — the «Solver v3 (`gcf_v3/`)» section**

**Find** in `docs/SOLVER_AND_INFRA.md`:

```text

---

## 3. `scripts/` — one-off migrations, imports & ops
```

**Replace with:**

````text

### Solver v3 (`gcf_v3/`) — `owt-solver-v3`, deployed and not called

The date-based v3 solver (spec `docs/superpowers/specs/2026-10-05-solver-v3-c5-solver-function-design.md`,
ADR-0049) lives in `gcf_v3/` (package `owt_v3`) and imports nothing from `gcf/`. **Nothing calls it**
until C6 routes Auto to it behind the effective engine and C7 flips `SOLVER_ENGINE`; v2 above is
unchanged and remains the engine.

- **Contract `3`.** One request staffs the weekend voice seats of 1–2 calendar months: dated
  services (opaque `id`, `kind`, `fixed`, `counts`, `seats`), people with eligibility already
  resolved per service, carried balances per line (hundredths), cadence states (`on`/`off`/`out`),
  rules (`count`/`pair`/`presence`/`consecutive`, role keys and values resolved by the caller), pins
  by service id, the previous month's facts (`prior`) and a seed. The response carries the
  assignment, unfilled seats with reasons, the pin handshake, violations under a ceiling, every
  stage's status, the per-person fairness lines and display tabs (hundredths, tenths and integer
  seat counts), cadence outcomes, missed protections with causes, and notices. Every code is in
  `gcf_v3/owt_v3/codes.json`; `PIN_CAP = 250` is in `gcf_v3/owt_v3/constants.py`.
- **Stages** (each solved, then fixed): rules (the violation ceiling) → fill → cadence →
  compensation Saturday → voice floor → DL floor → Sunday cap → Saturday cap → no consecutive
  Sundays → per line (DL, SL, BGV, each presence sub-line, CORO) most-owed then sum of squares →
  tie-break. One search worker, `linearization_level = 2`, a deterministic limit per stage
  (`STAGE_DET_LIMIT`) under a 2.5 s wall guard, a 25 s budget.
- **Local run:** `python gcf_v3/owt_solver_v3.py --json-mode < request.json` from the repository root.
- **Tests:** the `solver-v3` CI job (`python -m unittest discover -s gcf_v3 -t gcf_v3 -v`), which
  includes the acceptance `ci` subset. The full offline acceptance:
  `python gcf_v3/acceptance/run.py --world gcf_v3/acceptance/world_realistic.json --matrix full --out <dir>`
  (aggregates in `<dir>/summary.json`; per-run pairs under `<dir>/runs/`). The independent checker
  runs on one captured pair from `gcf_v3/`: `python -m acceptance.checker request.json response.json`
  — it prints counts, codes and stage public labels only. Timing-gate shapes A–D:
  `python gcf_v3/acceptance/run.py --emit-requests <dir>`.
- **Deploy.** Cloud Build trigger `owt-solver-v3-deploy` (GitHub, branch `^main$`, included files
  `gcf_v3/**`, config `gcf_v3/cloudbuild.yaml`, region global, service account the default compute
  account — the same shape as `owt-solver-deploy`). Its filter and v2's (`gcf/**`, `cloudbuild.yaml`)
  share no path. It deploys `owt-solver-v3` gen2, us-central1, python312, 512MB, 1 vCPU, 120 s, the
  key from Secret Manager (`owt-solver-api-key`, shared with v2) and
  `OWT_SOLVER_V3_BUILD=$COMMIT_SHA`. It does not pass `--allow-unauthenticated` (the build account
  cannot set IAM). **First creation, once, after the merge:** `scripts/deploy-solver-v3-gcf.sh`
  from the fetched tip of `main` (it refuses a dirty `gcf_v3/`, passes `--gen2` and
  `--allow-unauthenticated` with the operator's rights, and stamps
  `OWT_SOLVER_V3_BUILD=$(git rev-parse HEAD)`); then the runtime account's
  `roles/secretmanager.secretAccessor` on `owt-solver-api-key` is checked
  (`gcloud secrets get-iam-policy owt-solver-api-key`), and the trigger is created. Until then the
  function does not exist and a merge that touches `gcf_v3/**` deploys nothing. The same script is
  the manual fallback. A change to `fixtures/fairness/golden.json` alone deploys nothing.

#### Verifying a v3 deploy

1. `gcloud functions describe owt-solver-v3 --gen2 --region=us-central1 --format='value(state,updateTime)'`
   — `ACTIVE`, with an `updateTime` after the merge.
2. **Ping** — the key read from Secret Manager with file logging off and piped to curl, never printed:

   ```bash
   URL=$(gcloud functions describe owt-solver-v3 --gen2 --region=us-central1 --format='value(serviceConfig.uri)')
   KEY=$(CLOUDSDK_CORE_DISABLE_FILE_LOGGING=true gcloud secrets versions access latest --secret=owt-solver-api-key)
   printf 'X-Api-Key: %s\n' "$KEY" | curl -s -X POST "$URL" -H @- -H "Content-Type: application/json" \
     -d '{"contract":3,"ping":true}' \
     | python3 -c 'import json,sys; r=json.load(sys.stdin); print(r["ok"], r["contract"], r["build"])'
   unset KEY
   ```

   It must print `True 3 <the merged commit SHA>` (`git rev-parse origin/main`) — the analogue of
   the Vercel alias check.
3. **Smoke solve** — the same key handling, with `-d @gcf_v3/acceptance/smoke.json` (fictitious
   people) and `print(r["ok"], all(s["status"] == "proven" for s in r["stages"]))`: it must print
   `True True`.

The function URL (C6/C7's `OWT_SOLVER_V3_URL`) is
`gcloud functions describe owt-solver-v3 --gen2 --region=us-central1 --format='value(serviceConfig.uri)'`.

**Rollback.** Disable the trigger `owt-solver-v3-deploy`; nothing routes to the function, so it may
stay or be deleted (Frank's call); revert the PR. No data depends on it. C0's `solver-v3` job and
scaffold stay, green on `gcf_v3/test_scaffold.py`.

---

## 3. `scripts/` — one-off migrations, imports & ops
````

- [ ] **Step 3: The ADR and its index row**

**Create** `docs/adr/0049-the-v3-solver-is-a-second-function-solved-in-stages.md`:

```markdown
# ADR-0049: The v3 solver is a second function, solved in fixed stages under a violation ceiling

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
```

**Find** in `docs/adr/README.md`:

```text
Records when a request stays byte-identical, what the seat model leaves to the solver (the dedicated-lead anchor, zero maximums, pins, the one-Lead-per-Saturday rule), and the rejected alternatives. Since ruling Q19, when the solver itself refuses a month that sent the 31st, Auto solves it once more without it (`withholdTrailing`; the route tags the failures it makes when it cannot get the solver's answer `transport_error`, and those never retry), so each of those limits costs one extra solve and a 31st filled by hand, never the month
```

**Replace with:**

```text
Records when a request stays byte-identical, what the seat model leaves to the solver (the dedicated-lead anchor, zero maximums, pins, the one-Lead-per-Saturday rule), and the rejected alternatives. Since ruling Q19, when the solver itself refuses a month that sent the 31st, Auto solves it once more without it (`withholdTrailing`; the route tags the failures it makes when it cannot get the solver's answer `transport_error`, and those never retry), so each of those limits costs one extra solve and a 31st filled by hand, never the month
- [ADR-0049: The v3 solver is a second function, solved in fixed stages under a violation ceiling](0049-the-v3-solver-is-a-second-function-solved-in-stages.md) — why solver v3 (`owt-solver-v3`, `gcf_v3/`) is a separate function with its own trigger and CI job rather than an entry point in `gcf/` or a version field; why its objectives are stages solved and fixed in order (rules → fill → cadence → compensation → floors → caps → no consecutive Sundays → per-line balances → tie-break) instead of one weighted objective; why rules are soft per instance in every run under a ceiling set first; why shares are planned before the solve; and why 1 worker, `linearization_level = 2` and a deterministic limit per stage. Deployed and not called until C6/C7
```

- [ ] **Step 4: `docs/CI.md` — the v3 tree and the timing rule's sentence**

**Find** in `docs/CI.md`:

```text
`gcf_v3/` holds only a scaffold until the v3 solver lands: `requirements.txt`
(the same ortools pin as `gcf/`), a copy of `gcf/.gcloudignore`, the `owt_v3`
package and one smoke test, `test_scaffold.py`. The v2 Cloud Build trigger filters
on `gcf/**` and `cloudbuild.yaml`, so nothing under `gcf_v3/` deploys.
```

**Replace with:**

```text
`gcf_v3/` holds the v3 solver (solver v3 C5): the `owt_v3` package, the HTTP entry
`main.py`, the `--json-mode` CLI `owt_solver_v3.py`, `requirements.txt` (the same
ortools pin as `gcf/`, plus `functions-framework`), its own `.gcloudignore` and
`cloudbuild.yaml`, the unit suite in `tests/` and the acceptance harness in
`acceptance/` (a package with no `test*.py`; its `ci` subset runs from
`tests/test_acceptance_ci.py`). C0's `test_scaffold.py` stays. Two of the suite's
modules read `fixtures/fairness/golden.json` (C2's fixture), so the job is red
without it. v2's trigger filters on `gcf/**` and `cloudbuild.yaml`; v3's
(`owt-solver-v3-deploy`) on `gcf_v3/**` — neither matches the other's paths.
```

**Find** in `docs/CI.md`:

```text
workflow comments. `solver-v3`'s 15 is a placeholder until the v3 solver's suite
exists and is measured.
```

**Replace with:**

```text
workflow comments. `solver-v3`'s 15 was set before its suite existed; the solver
v3 C5 row below is the suite's first measurement, and 15 stands while that job
stays at or under 7m30s.
```

- [ ] **Step 5: Measure the `solver-v3` job on GitHub and add its row**

The rule needs the runner's time, not a Mac's. Push the branch (a `claude/*` push spends no Vercel build: `ignoreCommand` cancels it) and dispatch CI on it:

```bash
git push -u origin claude/solver-v3-c5-solver-function
gh workflow run ci.yml --ref claude/solver-v3-c5-solver-function
sleep 5; RUN=$(gh run list --workflow ci.yml --branch claude/solver-v3-c5-solver-function --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId'); echo "$RUN"
gh run watch "$RUN" --exit-status > /dev/null; echo "exit $?"
```

Expected: `exit 0` (all four jobs green). Then print the row with the same arithmetic the table already uses (set-up through Lint for Node; setup-python through «Solver tests» for each solver; created → `gates` done for the run) — it reproduces the existing `37420430364` row exactly when pointed at that run:

**Execute:**

```bash
cat > /private/tmp/c5_ci_row.py <<'PY'
"""Print docs/CI.md's «Timing» row for one CI run: `gh run view <id> --json ... | python3 ci_row.py`."""
import json, sys
from datetime import datetime
run = json.load(sys.stdin)
t = lambda s: datetime.fromisoformat(s.replace("Z", "+00:00"))
def span(a, b):
    sec = int((t(b) - t(a)).total_seconds())
    return f"{sec // 60}m{sec % 60:02d}s" if sec >= 60 else f"{sec}s"
jobs = {j["name"]: j for j in run["jobs"]}
def step(job, name):
    return next(s for s in jobs[job]["steps"] if s["name"] == name)
node = span(step("node", "Set up job")["startedAt"], step("node", "Lint")["completedAt"])
v2 = span(step("solver-v2", "Run actions/setup-python@v5")["startedAt"], step("solver-v2", "Solver tests")["completedAt"])
v2t = span(step("solver-v2", "Solver tests")["startedAt"], step("solver-v2", "Solver tests")["completedAt"])
v3 = span(step("solver-v3", "Run actions/setup-python@v5")["startedAt"], step("solver-v3", "Solver tests")["completedAt"])
v3t = span(step("solver-v3", "Solver tests")["startedAt"], step("solver-v3", "Solver tests")["completedAt"])
job = lambda n: span(jobs[n]["startedAt"], jobs[n]["completedAt"])
wall = span(run["createdAt"], jobs["gates"]["completedAt"])
print(f"| {run['databaseId']} | {run['createdAt'][:10]} | `{run['headSha'][:8]}` (`{run['headBranch']}`) | split | "
      f"{node} (job `node` {job('node')}) | {v2} (tests {v2t}; job `solver-v2` {job('solver-v2')}) | "
      f"{v3} (tests {v3t}; job `solver-v3` {job('solver-v3')}) | {wall} (run) |")
PY
```

```bash
gh run view "$RUN" --json databaseId,createdAt,headSha,headBranch,jobs | "$PY" /private/tmp/c5_ci_row.py
```

**Find** in `docs/CI.md`:

```text
| 37420430364 | 2026-10-06 | `599734c5` (`preview`) | split | 5m02s (job `node` 5m05s) | 10m08s (tests 9m53s; job `solver-v2` 10m16s) | job `solver-v3` 24s | 10m29s (run) |
```

**Replace with:** that same line, then a new line holding exactly the row the command printed.

Then append to the paragraph below the table (after «… (assumption A2 holds).») one sentence: «The solver v3 C5 row is a `workflow_dispatch` run of the feature branch, measured the same way; «v3 solver steps» is setup-python through «Solver tests».»

**Spec §12.2's bound:** the `solver-v3` job must finish within 10 minutes (target 6); a longer job is a finding — stop and report. **The timeout rule.** If the row's `job \`solver-v3\`` time is at or under 7m30s, `timeout-minutes: 15` stands and nothing else changes (expected: the suite takes ≈ 20 s on a Mac, so the job ≈ 1–2 min). Otherwise set `solver-v3`'s `timeout-minutes` in `.github/workflows/ci.yml` to the smallest whole number of minutes at or above twice the job time, and change the two `timeout-minutes: 15` occurrences inside the «refuses a sparse checkout» mutation anchor of `scripts/__tests__/ciLayout.test.ts` (the `solver-v3` block) to the same number — the guard's anchor must stay byte-exact — and re-run `npx vitest run scripts/__tests__/ciLayout.test.ts`.

- [ ] **Step 6: The Node gates**

Run: `npx tsc --noEmit && npm test 2>&1 | tail -5 && npx eslint . 2>&1 | tail -1`
Expected: no `tsc` output; all green — `adrIndex.test.ts` sees 0049 indexed, consecutive and dated; eslint `0 errors` and the baseline warnings.

- [ ] **Step 7: Commit**

```bash
git add docs/SECRETS.md docs/SOLVER_AND_INFRA.md docs/CI.md docs/adr/README.md docs/adr/0049-the-v3-solver-is-a-second-function-solved-in-stages.md
git add .github/workflows/ci.yml scripts/__tests__/ciLayout.test.ts   # only if Step 5 changed them
git commit -m "docs(solver-v3): the function, its deploy and verification, its key and build, its ADR" -m "SECRETS: OWT_SOLVER_API_KEY now has two readers, so a rotation redeploys both functions and either answers 401 mid-rotation; OWT_SOLVER_V3_BUILD is function config the ping echoes. SOLVER_AND_INFRA gains the v3 section (contract, stages, deploy, first creation, verification with the key piped, rollback); CI records the suite's first measured job time; ADR-0049 records the second function and its stages (A31)."
git push
```

---

## Task 17: Verify the delivery before any merge

Spec §15 (order), C5-R13 (v2 untouched), C5-R16 (identifiers off public outputs), `CLAUDE.md` (gates, no attribution). Nothing is committed here unless a check fails and is fixed (then: fix → gates → its own commit, and re-run this task).

**Files:** none (read-only checks).

- [ ] **Step 1: Every gate on the final tree**

```bash
"$PY" -m unittest discover -s gcf_v3 -t gcf_v3 2>&1 | tail -3
"$PY" -m unittest discover -s gcf -t gcf 2>&1 | tail -3
npx tsc --noEmit && npm test 2>&1 | tail -5 && npx eslint . 2>&1 | tail -1
```

Expected: v3 `Ran 177 tests … OK` (branch (b): 172); v2 `Ran 105 tests … OK (skipped=1)`; the Node trio green with the baseline warnings.

- [ ] **Step 2: Nothing that must not move moved**

```bash
git diff --name-only origin/main...HEAD | grep -E '^gcf/|^cloudbuild\.yaml$|^scripts/deploy-solver-gcf\.sh$|^CLAUDE\.md$|^AGENTS\.md$'
grep -rnE '^\s*(import gcf|from gcf[ .])' gcf_v3
grep -rxn --include='*.py' 'PIN_CAP = 250' gcf_v3/owt_v3 | wc -l
git diff --name-only origin/main...HEAD | grep -E '^gcf_v3/acceptance/test'
```

Expected: no output; no output; `1`; no output.

- [ ] **Step 3: No real name, no attribution, no secret**

```bash
git log --format=%B origin/main..HEAD | grep -ci 'co-authored-by'
git diff origin/main...HEAD | grep -E '^\+' | grep -nE 'sk-|BEGIN (RSA|PRIVATE)|OWT_SOLVER_API_KEY=[^o$ ]'
"$PY" - <<'PY'
import json, subprocess, unicodedata
P = "/Users/frankrocha/Documents/Builds/owt-agent-logs/sdd/2026-10-05-solver-v3-fairness/prototype/members.json"
norm = lambda s: unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
import re
names = {norm(t) for m in json.load(open(P)) for f in ("member_name", "alias") for t in (m.get(f) or "").split() if len(t) > 2}
# words CLAUDE.md already uses (the owner's name, «service», «account»…) are vocabulary, not a leak
common = set(re.findall(r"[a-z]+", norm(subprocess.run(["git", "show", "origin/main:CLAUDE.md"], capture_output=True, text=True).stdout)))
diff = norm(subprocess.run(["git", "diff", "origin/main...HEAD"], capture_output=True, text=True).stdout)
added = "\n".join(l for l in diff.splitlines() if l.startswith("+"))
words = set(re.findall(r"[a-z]+", added))
print("real-name tokens in the added lines:", len((names - common) & words))
PY
```

Expected: `0`; no output; `real-name tokens in the added lines: 0` (the private roster is read locally and only a count is printed). A non-zero count: list the hits privately (never in the PR), rename them, re-run.

- [ ] **Step 4: The public outputs over the ci subset**

Run: `"$PY" gcf_v3/acceptance/run.py --matrix ci --out /private/tmp/c5-ci-final | "$PY" -c "import json,sys; s=json.load(sys.stdin); print(s['ok'], s['criteria'].get('F13.pinless_gap_within_tolerance'))"`
Expected: `True pass`. `summary.json` and stdout carry counts, codes and public labels only (`test_acceptance_ci.py` and `test_public_outputs.py` assert it).

- [ ] **Step 5: Report**

Record for the code review: `git log --oneline origin/main..HEAD` (Tasks 1–16, 16 commits plus the merge of `main` in Task 13), the gate summary, Steps 2–4's outputs, the F-1 ruling applied, and the measured `STAGE_DET_LIMIT`, `FAIRNESS_TOLERANCE`, ci-subset timing and the private aggregates.

---

## Release

Branch `claude/solver-v3-c5-solver-function`. The order is spec §15's and `CLAUDE.md`'s:

    implement (Tasks 0–17) → gates green → FRESH CODE REVIEW of origin/main...HEAD → fix
    → RE-VERIFY THE FIX (scoped review of the fix range + gates on the final tree)
    → merge into preview, push preview → verify the dev alias (nothing visible changes)
    → PR to main → `gates` green → arm auto-merge on the verified commit → verify the production alias
    → first creation of owt-solver-v3, IAM, trigger → verify the function (§11.5) → records

There is **no preview rehearsal of the function itself**: gcf deploys only from `main`, and the function is inert because nothing calls it until C6 and C7. `preview` still goes first because `CLAUDE.md` makes it the rule for every merge to `main`; on `preview` it proves only that the app build is unaffected.

1. **Fresh code review** — run the `finish-cycle` skill. Its code-review dispatch reviews `origin/main...HEAD` against the spec (standard tier, but the contract feeds C6's critical confirm — review §5 and §8 shapes line by line), and carries the docs-audit (spec §14, §11.6) and worklog-completeness checklists. Every fix: its own commit, a scoped re-review of the fix range and the gates on the final tree; the last worklog entry before any merge is a verification, never a fix.
2. **`preview` first.** Verify `.vercel/project.json` names `owt-backstage` / `prj_elS88VGezKpy18wizFN1ffoy8cJ5`. Then `git switch preview && git pull --ff-only origin preview && git merge --no-ff claude/solver-v3-c5-solver-function && git push origin preview`, and verify with one authoritative `get_deployment("dev-owt-backstage.vercel.app")` (Vercel MCP, team `frank-rochas-projects`) or the `deploy-verifier` agent, retried ≥ 30 s apart: the alias is in `alias` and `meta.githubCommitSha` is the pushed `preview` commit. Never a hand-rolled watcher.
3. **PR to `main`** from the feature branch. Body: the spec link; Finding F-1 and Frank's ruling (with the amendment row the coordinator added to the spec); the coverage table below; the gate results; `STAGE_DET_LIMIT`, `FAIRNESS_TOLERANCE`; the fictitious `full` summary and the private re-run's aggregates (public form only — counts, statuses by public label, timings, the maximum gap; no id, no name); the CI timing row; the review outcome; no AI attribution. Wait for `gates`. Arm auto-merge **last**, on the exact commit reviewed, re-verified and seen on dev: `gh pr merge <n> --auto --merge`; before pushing anything else to the branch, `gh pr merge <n> --disable-auto` first.
4. **After the merge** — on the next turn (nothing wakes the coordinator), verify the production alias the same way (`owt-backstage.vercel.app`, `meta.githubCommitSha` = the merge commit). Production behaviour is unchanged: nothing calls v3.
5. **First creation (spec §11.4).** The brief records that Frank authorized Claude to create the function and grant its invoke binding; these are irreversible remote writes on project `eloquent-figure-421401`, so the coordinator **confirms in chat, right before this step, that the authorization still stands**. Never print or pass the key: the function reads it from Secret Manager.

   ```bash
   git fetch origin && git switch --detach origin/main && git status --porcelain -- gcf_v3
   gcloud config get-value project
   GCP_PROJECT=eloquent-figure-421401 bash scripts/deploy-solver-v3-gcf.sh
   ```

   Expected: an empty `status`; `eloquent-figure-421401`; the script ends `✓ Deployed.` and prints the URL. Then the runtime account's access to the key and the public invoker binding:

   ```bash
   export CLOUDSDK_CORE_DISABLE_FILE_LOGGING=true
   SA=$(gcloud functions describe owt-solver-v3 --gen2 --region=us-central1 --format='value(serviceConfig.serviceAccountEmail)')
   gcloud secrets get-iam-policy owt-solver-api-key --format=json | "$PY" -c "import json,sys; p=json.load(sys.stdin); print(any(b['role']=='roles/secretmanager.secretAccessor' and 'serviceAccount:$SA' in b['members'] for b in p.get('bindings',[])))"
   gcloud run services get-iam-policy owt-solver-v3 --region=us-central1 --format=json | "$PY" -c "import json,sys; p=json.load(sys.stdin); print(any(b['role']=='roles/run.invoker' and 'allUsers' in b['members'] for b in p.get('bindings',[])))"
   ```

   Expected: `True` and `True`. If the first is `False`: `gcloud secrets add-iam-policy-binding owt-solver-api-key --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor --format="value(etag)"`. If the second is `False` (the script's `--allow-unauthenticated` did not land): `gcloud run services add-iam-policy-binding owt-solver-v3 --region=us-central1 --member=allUsers --role=roles/run.invoker --format="value(etag)"`. Re-run both checks.
6. **The trigger (spec §11.3).** Mirror v2's trigger rather than guess the GitHub connection's flags: `gcloud builds triggers describe owt-solver-deploy --region=global --format=yaml` (v2's runs in region `global`, as the default compute account, which trigger creation requires). For a first-generation GitHub connection (`github:` block with `owner`/`name`):

   ```bash
   gcloud builds triggers create github --region=global --name=owt-solver-v3-deploy \
     --repo-owner=FrankERP --repo-name=owt-kb-v1 --branch-pattern='^main$' \
     --included-files='gcf_v3/**' --build-config=gcf_v3/cloudbuild.yaml \
     --service-account="projects/eloquent-figure-421401/serviceAccounts/$(gcloud builds triggers describe owt-solver-deploy --region=global --format='value(serviceAccount.basename())')"
   ```

   (A second-generation `repositoryEventConfig` instead: use `--repository=<v2's repository resource>` in place of `--repo-owner`/`--repo-name`.) Then check the filters are disjoint: `gcloud builds triggers describe owt-solver-v3-deploy --region=global --format='value(includedFiles)'` is `gcf_v3/**` and v2's is `gcf/**;cloudbuild.yaml` — no path of one matches the other's. The trigger does not run now; the next merge that touches `gcf_v3/**` will.
7. **Verify the function (spec §11.5)** — `docs/SOLVER_AND_INFRA.md` «Verifying a v3 deploy», exactly: `describe` → `ACTIVE` with an `updateTime` after the merge; the ping (key piped with `-H @-`, file logging off) prints `True 3 <git rev-parse origin/main>`; the smoke solve with `-d @gcf_v3/acceptance/smoke.json` prints `True True`. A mismatched `build` means the deployed source is not the merged tip: redeploy from the fetched tip. Record the URL's source command for C6/C7 (`OWT_SOLVER_V3_URL` is C6's to document and C7's to set; C5 sets nothing on Vercel).
8. **Records.** Worklog lines (`.agents/log/worklog.jsonl`, every dispatch's `WORKLOG:` trailer, batched at cycle close); the solver-v3 program notes in `owt-agent-logs/sdd/` (merge SHA, function `updateTime`, the F-1 ruling, the tolerance, the private aggregates); C7's inputs: the timing-gate definition (§13), the shapes (`python gcf_v3/acceptance/run.py --emit-requests <dir>`), the checker (`python -m acceptance.checker` from `gcf_v3/`), `STAGE_DET_LIMIT`, `FAIRNESS_TOLERANCE`, OQ-4's default (0 minimum instances).
9. **Safe end state and rollback (spec §15).** `owt-solver-v3` answers the ping and the smoke solve, and nothing calls it; v2's function, trigger and goldens are untouched. Rollback: disable the trigger `owt-solver-v3-deploy`; the function may stay or be deleted (Frank's call); revert the PR — C0's job and scaffold stay, green on `test_scaffold.py`. No data depends on the function.

---

## Coverage — spec row → task

| Spec row | Where it is implemented and proven |
|---|---|
| **C5-R1** request contract (§5, A11, A14, A15, A38), coded refusals | Task 3 (`request.py`; `test_request.py`: every §5.8 case, the id grammar, the reserved id, A38's second rule by id order, the example accepted); Task 9 (`test_service.py`: 422 never 500, the 200-character id echoed in `assignments`, `unfilled`, `floor[].seat`) |
| **C5-R2** a run never sinks (S2) | Task 6 (clamps → notices, `presence_not_applicable`, no instance without a possible lead); Task 7 (`no_possible_lead`); Task 9 (`test_rules_solved.py`); Task 14 (P8, P9; only `timeout` and refusals answer `ok: false`) |
| **C5-R3** F12 stages and S3 settings | Task 8 (objectives); Task 9 (`test_stages.py`: order, fixing, settings read from each stage's CP-SAT parameters, wall guard, budget, statuses; `test_ranking.py`: each protection over the next) |
| **C5-R4** F15 pins and rules | Task 6 (soft per instance, causes); Task 9 (ceiling never raised); Task 14 (P1–P7) |
| **C5-R5** F5/F6 set-asides, floor seat with A12's skip, one-available qualifier | Task 4 (`test_formula.py`: sole member, exclusive, presence seat never fixed, floor order and skip); Task 5 (`test_plan.py`: F6 for pins and no-slack exact rules, C5-9, the plan's skip); Task 14 (P10; run C's floor-seat proof) |
| **C5-R6** F13 planned shares, measured tolerance ≤ 50 | Task 5 (`plan.py`); Task 13 (`plan` cases); Task 15 (measurement, Finding F-1, the ruling, `FAIRNESS_TOLERANCE`, the CI assertion) |
| **C5-R7** F14 one formula | Task 4 (`formula.py`); Task 13 (`test_golden.py`: every `ledger` case per month, `balance = share − received`, sums to zero, FX-4 adapter cases); Task 8 (the model's received count equals the formula's) |
| **C5-R8** cadence, compensation, floors, caps, consecutive (F7–F11, X1–X3, A14, A16) | Task 8 (objectives); Task 7 (`cadence`, `missed` and causes); Task 9 (`test_rules_solved.py`: exact `Sat.Lead` off the Saturday cap); Task 14 (runs A–D, P5, P12–P14) |
| **C5-R9** S4 response and codes | Task 1 (`codes.json`, `audit_response`); Task 7 (`test_report.py`: tenths from the rational, tabs from exact sums, seat counts, `TOTAL` absent for the exempt, the `after` identity); Task 9 (`test_service.py`: every field present, every code listed) |
| **C5-R10** S5 determinism | Task 11 (`test_determinism.py`; the mutation check) |
| **C5-R11** S6 budget | Task 9 (25 s from model build, 0.1 s start floor, `timeout` under stubs); §13's container gate defined in Release step 8 for C7 |
| **C5-R12** E1 deploy, guard, secrets | Task 10 (guard tests); Task 12 (`cloudbuild.yaml`, script); Task 16 (SECRETS entries, SOLVER_AND_INFRA); Release steps 5–7 (creation, IAM, trigger, ping echoing `build`) |
| **C5-R13** v2 untouched | Global Constraints; Task 17 Step 2; v2 suite at Tasks 0, 9, 17 |
| **C5-R14** combined policy accepted offline (A23) | Task 14 (`ci` subset in CI); Task 15 (`full` matrix, P16, the private re-run, aggregates recorded) |
| **C5-R15** the independent checker | Task 14 (`checker.py`: hard rules, pin echo, every instance and protection, identities, gap; counts only; `python -m acceptance.checker`) |
| **C5-R16** identifiers never leave the wire | Task 10 (`test_logs.py`: the four marked runs, handler and CLI stderr); Task 14 (`test_public_outputs.py`, `test_acceptance_ci.py` «summary is public»); Task 17 Steps 3–4 |
| C5-1 pins by service id + date | Task 3 (`date_mismatch`) |
| C5-2 exclusions only through eligibility | Task 3 (no `week_exclusion` kind; unknown keys refused); Task 1 (code retired) |
| C5-3 counted services for lines and protections, every weekend for rules | Task 5 (`facts.py`), Task 6, Task 9 (`Uncounted`) |
| C5-4 roles and values resolved, negatives refused | Task 3 |
| C5-5 `on`/`off`/`out` | Task 3; Task 8 (`out` owes no Saturday); Task 14 (`x1.wire_state`) |
| C5-6 mandatory lead soft, `no_possible_lead` | Tasks 6, 7, 9 |
| C5-7 / C5-8 planned and realised, rounding once, tenths, seats | Tasks 2, 7 |
| C5-9 placing a monthly set-aside | Task 5; Task 13 `plan` case 1 |
| C5-10 the realised formula is C2's, second seat first | Task 4; Task 13 |
| C5-11 F10 per month and its skips | Task 5 (`f10_instances`); Task 14 (P12, P14) |
| C5-12 capacity once per run | Task 5 (`dl_capacity`); Task 7; Task 15 (run G) |
| C5-13 pin cap 250, refused never truncated | Tasks 1, 3 |
| C5-14 reuse `OWT_SOLVER_API_KEY` | Task 12; Task 16 (SECRETS) |
| C5-15 floor skip only for exact or cadence seats, both passes | Task 4; Task 5; Task 13 `plan` case 2 |
| C5-16 month-scoped `presence`/`pair` | Task 3 (scope rules); Task 9; Task 14 (P16) |
| C5-17 identifiers off logs and public outputs | Tasks 9 (`public_label`), 10, 14, 17 |
| §5.7 budget knobs clamp down only | Task 3 |
| §6.1 hard rules, rows grow, fixed = pins, no «no solution» | Task 8 |
| §6.8 DL line, F10, capacity | Task 5; Task 7 (`capacity` cause) |
| §7.3 statuses and failures | Task 9 |
| §8.3 failure shape and HTTP map | Tasks 9, 10 |
| §8.4 ping | Tasks 9, 10; Release step 7 |
| §10 determinism and budget | Tasks 9, 11 |
| §11.1 layout (`main.py`, CLI, `PIN_CAP`, requirements, `.gcloudignore`, `tests/`, `acceptance/`, `cloudbuild.yaml`) | Tasks 1, 10, 12, 14 |
| §11.2 handler contract and logs | Tasks 9, 10 |
| §11.3 Cloud Build and the trigger | Task 12; Release step 6 |
| §11.4 first creation | Task 12 (script); Release step 5 |
| §11.5 verifying a v3 deploy | Task 16 (doc); Release step 7 |
| §11.6 secrets and environment | Task 16 |
| §12.1 contract / handler / golden / model / stages / determinism bullets | Tasks 3, 9, 10, 13, 4–9, 11 (as in the rows above) |
| §12.2 CI budget, the harness precondition, `timeout-minutes` by C0's rule | Task 14 (in-process `ci` subset; `HarnessError`); Task 16 Step 5 (measured row; the rule) |
| §12.3 harness, checker, world, runs A–D/P/G/O, scenarios P1–P16, private re-run | Tasks 14, 15 |
| §12.4 the F13 tolerance | Task 15; Finding F-1 |
| §13 timing gate (shapes A–D emitted; E private; runs, records, pass lines, on-failure order) | Task 14 (`--emit-requests`, `test_acceptance_tools.py`); Release step 8 hands the definition to C7, who runs it |
| §14 docs (SOLVER_AND_INFRA, SECRETS, CI, ADR) | Task 16 |
| §15 rollout, safe end state, rollback | Release |
| Interfaces → C6 (contract, codes.json, `PIN_CAP`, `--json-mode`, `fairness.tolerance`) | Tasks 1, 3, 7, 9, 10, 15 |
| Interfaces → C7 (timing gate, verification, URL source, ADR, tolerance and aggregates, checker) | Tasks 14–16; Release steps 7–8 |
| Assumptions (build account redeploys; runtime account reads the secret; det limit vs wall; fictitious ≈ real; fixture exists; floor seat bounds balances) | Release steps 5–7; Task 15 Step 3; Task 15 Step 2; Task 13 Step 1; Task 14 run C's floor proof |
| OQ-1 `STAGE_DET_LIMIT` · OQ-2 tolerance · OQ-3 floor proof failing · OQ-4 min instances | Task 15 Step 3 · Task 15 + F-1 · run C passes (no OQ-3 needed; if it fails, stop and show Frank) · C7 (default 0) |

**Coverage gaps:** none against the spec, with one finding the spec itself anticipates: **F-1** — under §6.2–§6.5 as written the F13 gap is 65 hundredths on fictitious 2-month runs and 50 on the private chain, and 131 under pin-heavy scenario P6; §12.4's ceiling of 50 cannot hold without Frank's ruling (amendments (a)/(b) and (c)). Deliberately not here: running the §13 container gate (C7's), setting `OWT_SOLVER_V3_URL` (C6 documents it, C7 sets it), any change to v2.

## Self-review (writing-plans checklist)

- **Spec coverage:** every §5–§15 row, decision C5-1–C5-17, acceptance row C5-R1–C5-R16, the Interfaces to C6/C7, the Assumptions and the open questions map to a task above; the one measured contradiction is Finding F-1, carried as a gate with two coded branches rather than resolved silently.
- **Placeholders:** none. Every code step carries the exact file (each **Create** is the whole file as executed); every edit is an exact **Find**/**Replace with** pair; every run step names its command and expected output. The two values only a run can produce — the CI job's timing row and the private aggregates — are produced by commands given in full (the row generator reproduces an existing row exactly), and the rules that turn them into edits are stated.
- **Type consistency:** `Problem`/`Service`/`Person`/rule dataclasses, `Facts` and its methods, `PlanResult.planned`, `Instance`/`build_instances`/`cause`/`violation_entry`, `Report` and `line_figures`/`tab_figures`/`assignment_of`, `Model` and its `obj_*`/`balance_inputs`, `Runner(…, solver_for=…)`, `solve_problem(…, consecutive_last=…)`, `handle`/`handle_raw`/`public_label`/`failure`/`emit_log`, the harness's `Chain`/`Env`/`Summary`/`run_matrix`/`emit_requests`/`check`, and the test helpers (`builders`, `random_request`, `stub`, `marked`/`MARK`) keep one spelling and one signature from the task that produces them to every task that consumes them; the codes are exactly spec §9's.
- **Names:** the prototype's real names and the two fictitious names that collide with the private roster appear nowhere in this plan or its code (checked with Task 17 Step 3's script against the private roster).
- **Executed.** The implementation was built once in a scratch clone of `20fd3367` under `/private/tmp/claude-501/c5/` (outside every checkout), with a stand-in IF2-29 fixture written there (five hand-computed FX-4-shaped `ledger` cases and six `cadence` cases, fictitious, never committed) to play C2's role. Then this plan's own text was applied mechanically to a second fresh clone: every **Create**, **Find**/**Replace with** and **Execute** block of Tasks 1–16 in order (branch (a) at Task 15; branch (b) applied separately to a copy), the stand-in fixture added as a separate commit at Task 13 Step 1 in place of the merge of `main`, and Task 16 Step 5's row generated from run `37420430364` in place of a dispatched run. Each task ended with the stated test count green and `ciLayout.test.ts` green; Tasks 13 and 16 also ran `tsc`, the full vitest suite and eslint (0 errors, 81 warnings — the baseline); the v2 suite ran green (105 tests, 1 skipped on macOS) on the scratch tree. Without the fixture, `test_golden.py` and the acceptance modules fail with the «fixture is missing» message (checked). The final tree was byte-identical to the scratch build apart from that stand-in timing row, and branch (b) ended green at its stated count. On the re-applied tree the `full` matrix and the private re-run reproduced the numbers in Finding F-1 and Task 15 exactly, and Task 17's checks printed what they expect (no protected path touched, `PIN_CAP = 250` once, no attribution, no secret pattern, 0 real-name tokens).

## Execution handoff

Execute with **superpowers:subagent-driven-development**: a fresh implementer per task, each task's review before the next, the coordinator integrating and running Tasks 0, 15, 17 and the Release. Route by risk: Tasks 4, 5, 8 and 9 carry the formula, the plan, the model's received count and the stage pipeline — the strongest configuration and a careful review (the model/formula equality test is their guard); Tasks 3, 6, 7 and 10 are contract and report code with full test code — standard; Tasks 1, 2, 11, 12, 13, 14 and 16 are mechanical. Task 15 needs Frank's ruling on F-1 first and the private data on Frank's machine. Every dispatch reports a `WORKLOG:` trailer; the coordinator appends them (batched at cycle close is fine).
