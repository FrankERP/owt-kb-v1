# Spec: the solver's lexicographic objective is solved sequentially («Fix B»)

**Status:** `DRAFT`. Frank reviews it before any implementation. · **Date:** 2026-09-29 ·
**Risk tier:** standard (CLAUDE.md). The solver is not a production writer or a trust boundary:
it returns a proposal and the admin decides. So there is no adversarial plan-review loop. This
spec was self-reviewed against the repository, and the fresh code review of the diff is the gate.
**Tracks:** issue #94. **Amends:** ADR-0038 (at implementation, see §9).

## 0. Request and outcome

> Write a review-ready design spec (docs only) for the OWT solver's "Fix B": replace the single
> weighted-sum lexicographic objective with sequential (true) lexicographic optimisation, so the
> fairness history actually shapes Auto's roster again.

- **Outcome:** Auto optimises every month that reaches an optimising pass, history included. Each
  of the eight fairness tiers is minimised in its own solve and then held. The weight product can
  no longer overflow CP-SAT's ceiling and switch the objective off.
- **For:** the admin running Auto in `/admin` (and the MCP `solve_month` tool, once P4 exists).
- **Success measure:** on the real October 2026 request, `objective_skipped` goes from 100% of
  runs to 0%. The eight-tier vector equals a proven sequential reference. The worst-case wall time
  stays under the flip threshold in §8.2.

## 1. Problem and evidence

Today `compute_priority_weights` (`gcf/owt_solver_v2.py`, around line 791) builds one weighted sum
over eight tiers (`PRIORITY_ORDER`, around line 786) plus a consecutive-repeat tail and a random
tie-break. Once history is present, the ladder's bound exceeds CP-SAT's integer ceiling
(INT64_MAX // 2 ≈ 4.6e18). The pass then raises `ObjectiveTooLarge` and solves with **no
objective** (`elif optimize:` block, around lines 1330–1400). The response says
`objective_skipped: true`, and the planner shows «Sin optimizar» (PR #117).

The evidence below is an **offline reproduction, 2026-09-29**. It used the real October 2026 request:
4 weeks with a Saturday every week, 17 pool members, 20 rules, three derived history months, no pins.
It ran on the pinned ortools 9.15.6755 with production parameters (`solve_from_dict` defaults, which
the route never overrides): 1 search worker, 5 s per solve, 40 s budget. Times are from an M4 Pro Mac.
«Throttled» means the whole process was paused and resumed on a 1/3 duty cycle, which also slows
Python and presolve. The measurement artifacts lived in a session scratchpad, are ephemeral and
contain member names. The numbers below are the durable record, and no artifact is committed.

| # | Fact (source lane) | Implication |
|---|---|---|
| E1 | Today every October run is `objective_skipped` (peel lane 23/23, float lane 30/30, comparator 10/10). The ladder bound is 5.07e19 on the peel lane's analytic figure (4.6–4.8e19 on the float lane, which varies with seed through `max_rand`). | History has no effect on a real month. Issue #94 is the steady state, not an edge case. |
| E2 | Today's roster reaches the lexicographic optimum in 0/20 seeds. The same seeds at 8 workers move the exempt lead-only member's «2 Sunday leads» from 9/23 to 19/23. | The roster is an arbitrary legal draw that depends on search details. |
| E3 | Full sequential solving (**P8_brk**, where each tier is minimised and then held, followed by a tail solve) builds its objective 23/23 and returns at the same ladder pass as today with `objective_skipped: false`. Every stage proved OPTIMAL: 184/184 at full time and at 1/3 time on October (peel lane), and 160/160 idle (comparator). | The ceiling problem disappears by construction: the tail's bound on October is `255 × 2790 + 2789 ≈ 7.1e5`. |
| E4 | P8_brk's eight-tier vector **equals the proven sequential reference 20/20 on every shape**, including at 1/3 compute. The reference was sequential with 8 workers and 30 s per tier, OPTIMAL on every tier of all 60 seed/shape runs. With the tail included it scores 18/20 on all ten tiers (comparator, idle). | Its fidelity is exact whenever stages prove OPTIMAL, and they did. |
| E5 | Time for P8_brk on October at 1 worker: median 2.77 s / max 7.38 s (peel lane), 2.35 / 7.06 s idle (comparator), 8.32 / 12.53 s throttled. On the 5-week shape (5 Sundays, a Saturday every week, history scaled to about 6 services a month, **with Fix A's Sun.BGV level 3**): 6.72 / 8.87 s idle and **14.77 / 17.28 s throttled**. A contended stress run with unknown parallelism reached 21.2 s on October and 22.2 s on a 5-week shape (3 FEASIBLE stages of 80). | This is within the route's real ceiling (`maxDuration = 60`, `app/api/admin/solve/route.ts`) and the solver's own 40 s budget, but the real container's clock has not been measured (§8.2). |
| E6 | Under P8, infeasible ladder passes fail at their first stage (one solve, about 0.04 s), so only the returning pass pays for nine solves. P8 without the generalised skip ran 14 passes / 28 solves on October. P8_brk ran 8 passes / 22 solves. | Generalising the sibling skip is required (§4.5). |
| E7 | The tail (consecutive + tie-break) takes 45% of P8's time idle (median 1.09 s, max 5.0 s) and 35% throttled (median 4.95 s). It hit its 5 s cap in 6/10 throttled runs. | A short dedicated tail cap saves time. That saving is a **projection** from these shares and was not measured. |
| E8 | Splitting a pass's 5 s cap evenly across its stages dropped reference matches to 16/20 on October and 5/20 at 1/3 time. At 1/3 time on 5-week shapes, 3–5 of 23 runs had a stage end UNKNOWN. The pass then returned `None`, and the unoptimised sibling shipped. | Never split the cap. Never return `None` after a completed stage. |
| E9 | The prototype clipped each stage with `min(cap, max(1.0, deadline − now))`. That lets a pass that starts near the deadline overrun by up to 1 s per remaining stage (≤ 9 s). | No floor. Stop at the deadline (§5). |
| E10 | Sunday-lead effect on October. The zero-history lead gets 2 Sunday leads in 23/23 (P8_brk, peel lane) against ≥ 1 in 12/23 today. The exempt lead-only member leads twice in 3/23 under P8_brk (3/20 comparator) against 9/23 today in the peel lane and 13/30 (43%) in the float lane. The reference gives 20/20 and 3/20. Other tiers, median today → P8: Sat.Lead spread 17 → 15, Sun.BGV 46 → 44, weekly rotation 38 → 14, consecutive repeats 11 → 2. | This is the change the fairness history exists to make, and it is visible on the board. |
| E11 | On a 5-Sunday month with this roster's rules, a Sun.BGV spread ≤ 2 is infeasible. The ladder only tries 1 and 2, so every Stage B pass fails and the month returns from Stage A, **for every objective variant** (both lanes independently). | Fix B does nothing for these months without Fix A (§7). |
| E12 | `optimize` changes only the objective block and `search_branching` (`create_model_and_solve`). The objective block adds only definitional constraints: the consecutive indicators, which are sound because «one slot per service per week per person» is hard, around line 1110. | A stage-1 INFEASIBLE proof is a proof about the sibling's model too (§4.5). ADR-0038 already relies on this premise. |

## 2. Goals and non-goals

**Goals:** true lexicographic optimisation of the existing tiers in their existing order. No
objective overflow on any month. Budget-safe stages with fallbacks that never lose a completed
stage. A response that reports how far the optimisation got, and a planner that reads it.

**Non-goals:**
- Changing the tiers, their order, their definitions or the hard fairness limits. The Sunday-lead
  outcome in E10 is the current priorities solved correctly. Changing it is a product decision
  (§11, Q2).
- Changing the search. `RANDOMIZED_SEARCH`, the seed and 1 worker stay, and so does ADR-0004.
- Fix A's ladder level (§7).
- The trailing Saturday (§7).
- Stage A, solve 0 and the local specials fill.
- Changing the MCP P4 plan (§7).
- Any new secret or env var.

## 3. Requirements

| ID | Delivery | Requirement | Acceptance |
|---|---|---|---|
| R1 | D1 | Every optimising pass minimises each of the eight tiers in its own solve, in `reversed(PRIORITY_ORDER)` (Sun.Lead first, Sun.Choir last). After each solve it adds `tier ≤ value found` as a hard constraint on every later solve of that pass. `PRIORITY_ORDER` stays the one definition of the order. | Test T1 |
| R2 | D1 | A final **tail** solve minimises `(max_rand+1)·consecutive + tie_break` under all eight holds. When `discourage_consecutive` is false, it minimises the tie-break alone. | T1, T10 |
| R3 | D1 | No optimising pass drops its objective because of size. `compute_priority_weights` shrinks to the tail, and `ObjectiveTooLarge` and `model.Validate()` stay on it as dead-man switches. | T12 |
| R4 | D1 | Budgets and fallbacks are exactly as §5 specifies. | T3–T7 |
| R5 | D1 | An optimising pass whose first stage **proves** INFEASIBLE skips its `optimize=False` sibling. One that ends UNKNOWN still hands over. | T8 |
| R6 | D1 | The §4.6 invariants hold. | T9, T13, and the diff review |
| R7 | D1 | The response carries the §6 fields on every `ok` response, with the §6 meanings. | T11 |
| R8 | D1 | On a small fixture, the eight-tier vector equals an independent sequential reference, with every stage OPTIMAL. | T2 |
| R9 | D1 | Before merge, the implementation (not the prototype) is re-measured offline on the real October and November 2026 requests, and timed once on a non-production function (§8.2). Numbers only, no names, go in the ADR. | §8.2 record |
| R10 | D1 | Inertness governance: Stage A literals do not move, and the ladder-class literals are re-captured as a deliberate objective change (§8.1). | T13 |
| R11 | D1 | A new ADR amends ADR-0038, and the docs in §9 are updated in the same PR. | Review |
| R12 | D1 | Deploy verification follows §8.3. | Recorded check |
| R13 | D2 | The planner reads the §6 fields. An absent field keeps today's behaviour exactly. | T15 |

## 4. Design (contracts, not code)

### 4.1 The peel loop

The contract applies inside `create_model_and_solve` when `optimize` is true and the pass is neither
Stage A nor solve 0. The model is built once, as today, and every stage re-solves that same model:

1. Build the eight tier expressions: the five role spreads, `overall_spread`, and the two Sun.Lead
   rotation sums. The `rng` draws (`pw`, `wpw`, `rand_w`) happen **before the loop, in today's
   order**. The loop draws nothing, so a seed's weights are byte-identical before and after the change.
2. For each tier in `reversed(PRIORITY_ORDER)`:
   - If its expression is **fixed** (a literal, or a variable whose domain is one value, such as a
     spread with no slots in a month without Saturdays), record it as optimised and proven optimal,
     with no solve.
   - Otherwise set it as the only objective and solve (§5 gives the time).
   - On OPTIMAL or FEASIBLE, add `expr ≤ value` and continue. That is the incumbent's value when
     the stage is FEASIBLE.
3. Solve the tail (R2) under all holds.
4. Return one `SolveResult`, built from **exactly one** retained solution: the tail's, or the
   last completed stage's (§5). Assignments, counts, `unfilled`, `weighted_empty_used`,
   `violations_used` and `pin_violations` are all derived from that one solution and never mixed
   across stages.

### 4.2 Search parameters per stage

Every stage and the tail use today's optimising parameters: `RANDOMIZED_SEARCH`, the same
`random_seed`, the same worker count, and a fresh `CpSolver` per solve.

### 4.3 No solution hints

No stage adds a solution hint. A hint writes `solution_hint` into the proto, and the hint would be
the previous stage's solution. That solution can differ across platforms even at OPTIMAL: Mac and
Linux differed in 7/16 cells, per `docs/CI.md`. Hints would therefore make every later stage's
fingerprint machine-dependent. The lane measured no speed or quality gain from hints (October
median 2.4 s without them vs 2.77 s with, max 7.2 vs 7.4 s). The alternative, stripping
`solution_hint` in `_search_fingerprint`, is rejected as needless. The one existing hint (solve 0 →
Stage A under pins) is unchanged.

### 4.4 The tail and `compute_priority_weights`

The function keeps two weights: `consecutive = max_rand + 1` and `tie_break = 1`. It keeps the
INT64_MAX // 2 guard and its non-`ValueError` exception. After the tail's objective is built,
`model.Validate()` still runs. If either one fires, which should be unreachable at about 7e5, the
tail is skipped and the last completed stage is returned with `tail_optimized: false`. The
`tier_maxima` machinery is deleted.

### 4.5 The generalised sibling skip (required)

Today the ladder skips an `optimize=False` sibling only when the optimising pass had its objective
skipped **and** proved INFEASIBLE. Under this design an optimising pass never skips its objective,
so that condition can never fire, and every infeasible tier would pay a second pass (E6). The new
condition is: the optimising pass's **first stage** proved INFEASIBLE. «First stage» means the
pass's first actual solve: the first non-fixed tier, or the tail if all eight are fixed. This is
sound because the first stage adds no hold; a fixed tier's hold is a tautology. Its constraint set
is the sibling's, by E12, so the proof covers the sibling. An UNKNOWN first stage still hands over,
because the sibling searches differently. A later stage can never be INFEASIBLE in principle: the
previous solution satisfies every hold. If one ever reports it, it is treated as UNKNOWN (§5),
never as a proof.

### 4.6 Invariants

- Stage A's model and search are unchanged, so `STAGE_A_FINGERPRINTS` does not move.
- Solve 0, and its ceiling handling, is unchanged.
- `empty_target` and the pin violation ceiling are hard in **every** stage. So no stage buys
  fairness with an emptier seat or with one more rule set aside, as ADR-0010 and ADR-0041 require.
- The hard Sun.Lead, Sun.BGV and global limits and the ladder's loop order are unchanged, apart
  from R5.
- A month the solver can fill never comes back `ok: false` because of the objective.
- `pinned_honored` stays emitted on every response.

## 5. Budgets and fallbacks

| Rule | Contract |
|---|---|
| Stage time | `min(solver_max_time_seconds, deadline − now)`, with **no floor**. `solve_schedule` passes the deadline into the pass. Stage A's and solve 0's time rule, and the ladder's «< 1 s left → return Stage A» check before each pass, are unchanged. |
| Stop at the deadline | A stage never **starts** after the deadline. If the deadline arrives between stages, peeling stops and the last completed stage is returned. |
| Tail cap | `min(solver_tail_time_seconds, deadline − now)`. This is a new request knob, clamped like its siblings to 1–30, with a **default of 2 s**. The route does not forward it, so production uses the default. It exists so the inertness fixture can lift it (§8.1). `max_time_in_seconds` is stripped from every fingerprint. |
| No split | Each stage gets the full per-solve cap, clipped only by the deadline (E8). |
| Worst case | The total is at most the 40 s budget plus one solve's stop latency plus Python overhead. That leaves about 20 s of the route's 60 s for network and cold start (assumption A3). |

The fallback matrix (per pass):

| Outcome | Action |
|---|---|
| First stage (§4.5) INFEASIBLE | The pass returns `None` with status INFEASIBLE, and the ladder skips the sibling (R5). |
| First stage UNKNOWN (cap or deadline) or MODEL_INVALID | The pass returns `None`. The sibling runs if time remains, which is today's behaviour. |
| Stage k OPTIMAL | Hold and continue. |
| Stage k FEASIBLE | Hold the incumbent and continue. From here on it is not counted in `tiers_proven_optimal`. |
| Stage k ≥ 2 UNKNOWN, INFEASIBLE or MODEL_INVALID, or the deadline arrives before stage k | Stop, and return stage k−1's solution with `tiers_optimized = k−1`. Never `None`: today a `None` hands the month to the unoptimised sibling. |
| Tail OPTIMAL or FEASIBLE | Return the tail's solution with `tail_optimized: true`. |
| Tail UNKNOWN, skipped by the deadline, or dropped by the dead-man switch | Return the last stage's solution with `tail_optimized: false`. |

## 6. Response and UI contract

**Solver (D1).** These are additive fields, emitted on **every** `ok` response:

| Field | Meaning |
|---|---|
| `tiers_optimized` | 0–8. How many tiers, counted from the top of the priority order, were minimised and held by the returned pass. Fixed tiers count. It is 0 on every objective-less return. |
| `tiers_proven_optimal` | 0–`tiers_optimized`. The length of the **leading run** of those stages that proved OPTIMAL. The first N tiers are exactly the lexicographic optimum of this pass's constraints. |
| `tail_optimized` | Whether the consecutive/tie-break solve produced the returned roster. |
| `objective_skipped` | The meaning is unchanged: «no lexicographic objective ran». Its only remaining causes are Stage A and `optimize=False` returns. **Invariant:** `objective_skipped == (tiers_optimized == 0)`. |

**Compatibility.** An old client ignores the new fields. An old solver omits them. A client must
read **absence as unknown**, never as «fully optimised». Absence is also the deploy discriminator
(§8.3). A function-only revert is safe: the app half is display only. So the pins-era rule
«revert the app first» does not apply here.

**Planner (D2)** covers `SolveResponse` in `route.ts`, `SolveDiagnostics`, the `MonthGenerator`
mapping (two call sites, around lines 3435 and 3588) and the `PlannerGrid` diagnostics block:

| Response | Shown |
|---|---|
| `objective_skipped: true` | Today's «Sin optimizar», «(no aplicado)» and sentence, unchanged. |
| `1 ≤ tiers_optimized < 8` | A new label, «Optimización parcial», and one sentence: «El solver se quedó sin tiempo: optimizó la equidad en N de 8 niveles; los de menor prioridad quedaron sin optimizar.» There is no «(no aplicado)»: history did shape the tiers it reached. The copy is Frank's call (Q3). |
| `tiers_optimized == 8` | Nothing new, even if `tiers_proven_optimal < 8` or `tail_optimized` is false. Neither is actionable by the admin. Both are in the response and in `SolveDiagnostics` for tests (Q3). |
| Fields absent | Exactly today's rendering. |

## 7. Interactions and ordering

- **Fix A** (`claude/solver-sun-bgv-level-3` @ `c6fff32f`, under review) adds Sun.BGV level 3 to
  the ladder. On the real November 2026 request it takes the month from Stage A (8/8 runs) to an
  optimising pass. It moves no inertness literal. **Composition:** Fix A makes the pass reachable
  and Fix B makes it optimise. Neither is enough alone for a 5-Sunday month (E11). Every 5-week
  figure in E5 was measured with level 3, so Fix B's budget analysis assumes Fix A. Fix A's extra
  infeasible passes cost one stage-1 solve each (about 0.04 s) under R5. Fix A should land first,
  and Fix B rebases on it.
- **Trailing Saturday** (spec `docs/superpowers/specs/2026-09-29-solver-trailing-saturday-design.md`
  on `claude/trailing-saturday` @ `6a8a3bdd`, critical tier) edits `build_slots`, the per-week
  loops and `parse_pins`, and bounds the soft-consecutive and weekly-rotation loops **inside the
  `elif optimize:` block this change restructures**. Both changes move the ladder-class literals.
  Whoever merges second rebases, re-runs the other's tests and re-captures. If Fix B is second, its
  tail consecutive loop keeps the trailing week bound. If the trailing change is second, its
  differential identity check is measured against post-Fix-B `main`.
- **The history-bearing frozen fixture is a dependency. The trailing-Saturday session owns it.**
  Its «step zero» PR adds it to `gcf/test_inertness.py`: fictitious names, per-shape model+params
  fingerprints over non-trailing shapes, pinned and pinless, each with and without history,
  captured from the pre-change solver. Fix B's test plan builds on that baseline rather than
  defining its own. Its value here: today's inertness fixture carries `history: []`, where the
  objective is **not** skipped, so it cannot show Fix B's headline change. **Frank decides the
  order (Q5):** either step zero lands first, or Fix B adds the fixture and the other session
  appends its shape list to it.
- **MCP P4** (approved, not implemented) mirrors the diagnostics line (M20, P4-R13). D2's label is a
  post-approval change that P4 must record, as it did change 12. P4 is not edited here.

## 8. Tests, rehearsal, release

### 8.1 Tests (all in the `gates` job: T1–T14 are Python, T15 is vitest)

| # | Test |
|---|---|
| T1 | Stage hold and order. Record each `Solve`. The returning pass makes ≤ 9 solves in order, Sun.Lead first and the tail last. Each tier's **true** value, recomputed from the returned assignment, is ≤ its stage's recorded value. |
| T2 | Lexicographic equality against an **independent** sequential reference written in the test: its own Minimize/hold loop over a small fixture, 8 workers, generous cap. The solver's eight-tier vector equals it, with every stage OPTIMAL. It stays within about 20 s of CI time. |
| T3 | Deadline stop. A stubbed stage consumes the deadline. No `Solve` starts after it, the result is the last completed stage's, and `objective_skipped` is false. |
| T4 | No floor. A stage started with 0.3 s left gets `max_time_in_seconds ≤ 0.3`. |
| T5 | UNKNOWN fallback. A stubbed stage k ≥ 2 returns UNKNOWN. The result is stage k−1's, not `None` and not the sibling's. `tiers_optimized = k−1`. |
| T6 | FEASIBLE stage. `tiers_optimized` counts it, and `tiers_proven_optimal` stops before it. |
| T7 | Tail. It is capped at `solver_tail_time_seconds`. An UNKNOWN tail returns stage 8's solution with `tail_optimized: false`. |
| T8 | Sibling skip. A stage-1 INFEASIBLE proof means no sibling runs for that tier. A stage-1 UNKNOWN means the sibling runs. These adapt the two existing tests. |
| T9 | Pins and soft mode through the loop. The existing pinned suite stays green. The retained solution's `violations_used` is ≤ the ceiling, and `pin_violations` comes from it. |
| T10 | With `discourage_consecutive=false`, the tail is tie-break only. |
| T11 | Response. The §6 fields are present on every `ok` response and in range, and the invariant holds across a Stage A return, an `optimize=False` return and an optimised return. A month with no Saturdays gives `tiers_optimized == 8` with two fixed tiers and no solve for them. |
| T12 | `ObjectiveWeightLadder` rewritten. On the six shapes plus a heavy-history month: no MODEL_INVALID anywhere; `objective_skipped` false on every shape that reaches an optimising pass. The heavy-history case that today asserts `true` flips; that flip is this change. The tail bound stays under the ceiling. The dead-man tests are kept against the tail. |
| T13 | Inertness. **`STAGE_A_FINGERPRINTS` (and step zero's Stage A and solve-0 entries) must pass untouched; a red one is a finding.** Fix B moves only ladder-class literals: `LADDER_FINGERPRINTS`, `GOLDEN_SCHEDULE`, and the post-Stage-A solves in step zero's fingerprints. Moving them is legitimate only in this reviewed objective PR (`docs/CI.md`). The preconditions widen. Every tier stage whose value later protos contain must prove OPTIMAL. The golden requires all eight stages **and** the tail OPTIMAL. The fixture sets `solver_tail_time_seconds` to `INERTNESS_BUDGET_SECONDS`. The documented exception gains one case: a stage-1 proof that timed out means the sibling runs, so the sequence is one pass longer. |
| T14 | The CI budget is measured. The gcf step is about 6.5 min of a 25-min job, and every optimising test now makes up to nine solves per returning pass. If the job crowds, split the workflow; never drop the step. |
| T15 | (D2, vitest.) One test per row of the §6 planner table, absent fields included. |

### 8.2 Before merge: re-measure and rehearse (issue #94's «how is it rehearsed»)

`gcf/**` deploys from `main` straight to the one function that serves production and dev. There
is no preview rehearsal.

1. **Offline re-run of the implementation.** Use the real October and November 2026 requests,
   kept outside the repo. If the 2026-09-29 copies are gone, rebuild them with the planner's own
   request builder against the live dataset, read-only. Run seeds 1–20 at production parameters, idle and throttled, and record
   the same metrics as §1 (top-8 against the reference, `objective_skipped`, Sunday-lead
   distribution, median and max time). Also run a trailing-Saturday shape if that change is on
   `main`.
2. **The cheap flip pre-check.** Compute r = today's warm October Auto latency, taken function-side
   from Cloud Run request latency or else from Vercel logs for `POST /api/admin/solve`, ÷ the
   Mac's 0.47 s. The projected 5-week worst case is r × 8.87 s.
3. **Real-container timing (Frank runs it; the secret never passes through an agent).** Deploy the
   branch's `gcf/` as a **temporary, private** function with production's flags, so it gets the
   same CPU:
   `gcloud functions deploy owt-solver-rehearsal --gen2 --region=us-central1 --runtime=python312
   --source=gcf --entry-point=solve --trigger-http --no-allow-unauthenticated --memory=512MB
   --timeout=120s --set-secrets=OWT_SOLVER_API_KEY=owt-solver-api-key:latest`.
   Invoke it with an identity token and the key on stdin, as in `docs/SOLVER_AND_INFRA.md`'s smoke
   pattern, with gcloud file logging off. Discard the first (cold) request and record its time
   separately. Then send the October request for 10 seeds and a fictitious-name 5-week,
   Saturday-every-week, history-bearing request for 10 seeds, and record each wall time and the §6
   fields. Afterwards run
   `gcloud functions delete owt-solver-rehearsal --gen2 --region=us-central1`.
   This adds no new secret: the function binds the existing one and does not outlive the
   measurement, so `docs/SECRETS.md` needs no entry. If it is kept, it needs one.
4. **The flip rule.** If the warm 5-week max passes **about 25 s**, stop. Prefer F2 + AUTOMATIC_SEARCH
   (§10), which is a product decision and a spec revision. Otherwise fix the tail cap default from
   the measured tail share, and record r, the timings and the cold-start figure in the ADR.

### 8.3 Deliveries, verification, rollback

| Delivery | Content | Verify | Rollback |
|---|---|---|---|
| **Step zero** | The history-bearing fixture (§7). Owner and order per Q5. | Its own PR's gates. | Revert the PR (tests only). |
| **D1** (`gcf/**` + docs + ADR) | §4–§6 solver side, §8.1, §9. | CLAUDE.md order: gates green, **fresh code review of the diff**, fix, re-verify the fix, then merge. After Cloud Build: (1) `gcloud functions describe owt-solver --gen2 --region=us-central1 --format='value(updateTime)'` is after the merge. (2) The documented pinless smoke request returns `ok: true`, and **both `pinned_honored` and `tiers_optimized` are present**; the new field's presence is what tells this revision from the old. Record its value. (3) One real Auto on the next month, with Frank's look at the board and the diagnostics line. | The smoke request fails or `tiers_optimized` is absent: the deploy did not land, so re-deploy. A later regression (504s, or solves near 40 s in the logs) means re-deploying the previous function revision **alone**, which is safe because D2 reads absence as unknown. |
| **D2** (`app/**`) | §6 planner side, plus T15. | Push order per CLAUDE.md: `preview` first with the dev alias verified, then the PR with `gates`. | Revert the PR (display only). |

**Order:** D2 may land before D1. It is dormant: every field is absent until D1 deploys, so dev
shows no change, which is itself the check that absence is harmless. Landing D2 first leaves no
window in which a partial optimisation goes unannounced. Either order is safe.

## 9. Documentation and ADR at implementation (D1)

- **A new ADR** («the lexicographic objective is solved sequentially»), numbered next-free at merge
  (numbers follow the order of reaching `main`, and `adrIndex.test.ts` enforces this). It records
  E1–E12, the rehearsal figures, the rejected alternatives in §10, and why hints are off.
- **ADR-0038** status becomes «Accepted, amended by ADR-NNNN». The reported-degradation half and
  `objective_skipped` stand. The weighted ladder for the tiers, and the rejection of sequential
  solving «on budget», are superseded by measurement.
- **ADR-0042's issue-#94 note** is updated, and issue #94 is closed by D1.
- **`docs/SOLVER_AND_INFRA.md`:** the «Lexicographic objective» paragraph, including the stale
  «Expect it routinely in production». Restate the tier order from `PRIORITY_ORDER`; today's
  prose ordering is loose. Also the input keys (the new `solver_tail_time_seconds` knob), the
  output field list, and the deploy check.
- **`docs/CI.md`:** the `LADDER_FINGERPRINTS` row, since the peel loop and tail now feed it, the
  widened preconditions, and the re-capture record.

## 10. Rejected alternatives

| Alternative | Why not (offline reproduction, 2026-09-29) |
|---|---|
| **F1: explicit float objective** | CP-SAT accepts it but scales it by 0.125 and rounds the consecutive (0.26) and tie-break (9e-5) weights to 0. Consecutive then comes out at 12.6 against the reference's 2.05. The result depends on an arbitrary normalisation constant: a top weight of 1.0 also loses global, Sun.BGV, Sat.BGV and Choir. Choir's margin shrinks from 66.9 to 9.2 as history grows. CP-SAT's precision warning reaches only a log. This is the silent-degradation class ADR-0038 removed. |
| **F2: range/width integer ladder** | It is provably strict, with a bound of 2.7e14–3.6e15 that does not depend on history, and it is exact at OPTIMAL (60/60). But at production settings it often stops at FEASIBLE. Throttled on October it was FEASIBLE 10/10 and matched the reference's top 8 only 5/10. It is viable only with AUTOMATIC_SEARCH (top 8: 10/10 throttled October, 9/10 throttled 5-week, at about 60% of P8's time), and that search change alters roster diversity, which is a product decision. **It is the fallback if the flip rule fires.** It must not get R5's skip: its declared domains are hard constraints, and the sibling is what would expose a wrong bound. |
| **P1 / Pauto: peel the top k, weight the rest** | k depends on the seed and on history. On one 5-week seed the arithmetic fitted and `Validate()` still refused it. The weighted remainder is what loses fidelity under load: 11/20 and 15/20 at 1/3 time on the 5-week shapes. |
| **Even split of the pass cap across stages** | E8: reference matches fell to 5/20, and there were UNKNOWN fall-throughs. |
| **Hints between stages** | They make fingerprints machine-dependent, with no measured gain (§4.3). |

## 11. Decisions, assumptions, open questions

**Decisions (made by this spec; reviewer may overturn):** P8 over F2+AUTO, subject to the flip
rule. No hints. A tail cap knob with a 2 s default. The generalised skip. Additive fields, with
absence meaning unknown. Partial-peel UI only below 8 tiers.

| Assumption | If false | Validation |
|---|---|---|
| A1: the real container is slow enough to matter but under the flip threshold | P8 could approach 40 s on 5-week months | §8.2 steps 2–4, before merge |
| A2: a 2 s tail cap costs little quality (consecutive is the bottom tier) | More back-to-back repeats | The §8.2 re-run reports consecutive at the default cap; raise the default if needed |
| A3: cold start plus network is under about 20 s | The route's 60 s could be crossed on a cold, hard month | The rehearsal's cold request |
| A4: November's real rules behave like the synthetic 5-week shapes | Unmeasured timing on the real 5-Sunday month | §8.2 step 1 includes November |

| Question for Frank | Why it matters | Recommendation | Blocking? | Default |
|---|---|---|---|---|
| **Q1.** Sequential (P8) rather than F2 + AUTOMATIC_SEARCH? | Fidelity versus about 40% less wall time plus a search change | P8. It is exact by construction and degrades stage by stage; F2 falls back to the status-quo roster | Yes, before implementation | P8 with the flip rule |
| **Q2.** Is E10 the intended outcome (the zero-history lead takes 2 Sunday leads every run, the exempt lead-only member mostly 0–1)? | It is what the board will show. The Sun.Lead tier is a max−min spread, so it moves the extremes, and lower tiers set the rest | Accept: it is the current priorities solved correctly. A different outcome means changing tiers, in a separate spec | No, but Frank should see it before release | Accept |
| **Q3.** Partial-optimisation copy and threshold | What the admin reads on a rare, deadline-cut month | §6 table: label only below 8 tiers | No (D2) | §6 as written |
| **Q4.** Run the temporary private rehearsal function (§8.2 step 3)? | It is the only real-container number, and it needs Frank's gcloud and key | Yes. It is deleted afterwards | Yes, before the D1 merge | Run it (the recommendation). D1 does not merge without it or an explicit waiver from Frank |
| **Q5.** Order of step zero: the trailing session lands it first, or Fix B adds it and that session appends its shapes | Two sessions editing one test file | Whichever PR is ready first | No | Step zero first |

## 12. Terminal state

`READY_FOR_ADVERSARIAL_REVIEW`. Per the standard tier, Frank's review stands in for the
adversarial loop. Every open question has a bounded default, and Q1 and Q4 need his answer
before implementation or merge respectively. **This spec authorises no implementation.**
