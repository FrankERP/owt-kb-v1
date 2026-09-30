# The trailing Saturday in the solver (delivery 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `gcf/owt_solver_v2.py` accepts `weekends_with_saturday` containing `weeks + 1`, the month-end Saturday whose Sunday is in the next month, and staffs it as a week that has a Saturday service and no Sunday one. Every request that does not name it builds the same model as today.

**Architecture:** one helper, `last_week(weeks, sat_weeks)`, bounds every per-week loop. The trailing week's slots are appended after every existing slot. The soft consecutive penalty skips the Sunday roles in week `weeks + 1`. Every other function keeps its shape. An identity guard, whose fingerprints are captured on the unchanged solver in this branch's FIRST commit, proves that non-trailing requests are untouched.

**Tech Stack:** Python 3.12, ortools 9.15.6755 (pinned), unittest. `gcf/` is deployed by Cloud Build from `main` to ONE Cloud Function that serves production and dev.

**Spec:** `docs/superpowers/specs/2026-09-29-solver-trailing-saturday-design.md` (APPROVED at critical tier; see its review log). The spec is the contract, and this plan argues from it.

## Global Constraints

- **Invariant (spec §5):** a request that does not name the trailing Saturday builds the model it builds today, byte for byte. This holds pinned or not, and with or without history. Proven by `STAGE_A_FINGERPRINTS`, `LADDER_FINGERPRINTS` and `GOLDEN_SCHEDULE` staying green, plus the new identity guard (Task 1). A red literal is a FINDING, never a re-capture.
- **Legal values:** `weeks + 1` is the ONLY index above `weeks` that is accepted. `weeks` keeps its meaning (the number of Sundays) and its `3..6` guard.
- **No phantom Sunday** in week `weeks + 1`: no Sunday seat, variable, count, availability rule or objective term (spec §5, post-approval item). `schedule["<weeks+1>"]` holds only `Saturday`.
- **`{weeks-N}` counts Sundays** (D2): `resolve_dsl_templates` is unchanged.
- Refusals stay `ValueError`/`RuntimeError` → `ok: false` → 422. None may become a 500.
- **Gates** (all must pass): `python -m unittest discover -s gcf -t gcf` (blocking CI gate), `npx tsc --noEmit`, `npm test`, and `npx eslint .` with 0 errors.
- Conventional commits. **Never** add a Co-Authored-By or AI-attribution trailer.
- Python: `/opt/homebrew/Caskroom/miniforge/base/envs/owt-roles/bin/python3` (it has the pinned ortools). CI runs Linux x86_64.

## Rulings for this plan (recorded; the spec is the authority)

- **P1: step zero lands as the FIRST COMMIT of this branch, not as a separate PR.** Production has sent `history: []` since ADR-0046 (#120), so the existing history-free literals already match the production shape. What step zero must guarantee is that the fingerprints are captured from the pre-change solver. A first commit made on the unchanged solver gives the same guarantee, and a reviewer can audit it from commit order. A separate PR would add a Cloud Build redeploy of identical code and cost time on a deadline.
- **P2: no adversarial plan review.** The contract was reviewed twice at critical tier. This plan only locates the edits. The implementation controls are the inertness guards, a fresh code review of the diff, and the deploy smoke.

## Reference: the prototype

`/Users/frankrocha/Documents/Builds/owt-agent-logs/sdd/2026-09-30-solver-trailing-saturday/approach-a.diff` (private logs repo; restored from the session that wrote it) is a throwaway diff against the solver as it stood on 2026-09-29 (`1d50f9f3`). Two reviewers ran it:
- 0 model mismatches across 28 non-trailing shapes, with and without history and pins;
- real October 2026 solves with `[1..5]` and with `[5]`.

`main` has since changed the solver twice (#118 Sun.BGV ladder level 3, #120 exact-count band exclusion), so line numbers differ. Use the prototype as the reference for the loop edits. Do not apply it blindly.

---

### Task 1: Step zero — freeze identity fingerprints on the UNCHANGED solver

**Files:**
- Modify: `gcf/test_inertness.py` (append a section and a class)
- Modify: `docs/CI.md` (the «Solver inertness goldens» table gains an `IDENTITY_FINGERPRINTS` row with the same governance as `LADDER_FINGERPRINTS`)

**Interfaces:**
- Produces: `IDENTITY_SHAPES: Dict[str, Callable[[], dict]]` and `IDENTITY_FINGERPRINTS: Dict[str, List[str]]`, plus the test class `NonTrailingModelIsUnchanged`.

- [ ] **Step 1: Define the shapes.** Build each shape from `frozen_config(1)` and fictitious names only. Each value is a zero-argument function that returns a fresh request dict:
  - `w4-none`: `weekends_with_saturday: []`.
  - `w4-some`: `[2, 4]`, identical to `frozen_config(1)`.
  - `w4-all`: `[1, 2, 3, 4]`.
  - `w5-all`: `weeks: 5`, `[1, 2, 3, 4, 5]`.
  - `w4-weekexcl`: `[2, 4]`, plus the DSL rules `"Rachel !in week 3 *.*"` and `"Liu !in week 2 Sat.*"`.
  - `w4-history`: `[2, 4]`, plus `history` with three entries, each `{"total_counts": {…}, "role_counts": {…}}`, with small integer counts for 4–6 of the names. That is the shape `buildSolveRequest` sends.
  - `w4-pinned`: `[2, 4]`, plus `pinned: [{"week": 1, "role": "Sun.Lead", "person": "Rachel"}, {"week": 2, "role": "Sat.BGV", "person": "Hugo"}]`.
  - `w4-pinned-history`: the union of the two above.

- [ ] **Step 2: Record every solve.** Generalise `_run` so it can record any config, keyed by shape name, in the same way (patch `cp_model.CpSolver.Solve`, collect `(fingerprint, status, has_objective)`). Keep `_run(seed)` working for the existing classes.

- [ ] **Step 3: Capture on the unchanged solver.** Write the class with `IDENTITY_FINGERPRINTS = None` first:
  - When it is `None`, the test prints `{shape: [fingerprints…]}` and fails. That is capture mode, the same pattern as `GOLDEN_SCHEDULE`.
  - Run it locally, paste the printed literals in, and re-run until green.
  - Precondition, asserted for each shape: the FIRST solve is `OPTIMAL`, so the later passes' bounds are machine-independent. The same precondition `test_ladder_fingerprints` uses.
  - The assertion message says a red literal in a PR that claims non-trailing requests unchanged is a finding, never a re-capture.

- [ ] **Step 4: Confirm the fingerprints are machine-independent.** They include the whole ladder, so they are independent only because Stage A proves OPTIMAL. Run the test twice with different `PYTHONHASHSEED` values; both runs must be green.

- [ ] **Step 5: Run the python gate.**

  Run: `cd gcf && /opt/homebrew/Caskroom/miniforge/base/envs/owt-roles/bin/python3 -m unittest discover -s . -t .`
  Expected: all OK. Report the counts.

- [ ] **Step 6: Commit ALONE, before any solver change.**

```bash
git add gcf/test_inertness.py docs/CI.md
git commit -m "test(solver): freeze non-trailing request fingerprints on the unchanged solver" -m "Step zero of the trailing-Saturday change: eight request shapes (no, some and all Saturdays; five Sundays; week exclusions; history; pins; pins with history), fingerprinted over every solve on the solver as it stands, so the change can be measured against the past rather than against itself."
```

---

### Task 2: The trailing Saturday in the solver

**Files:**
- Modify: `gcf/owt_solver_v2.py`
- Test: `gcf/test_owt_solver_v2.py` (new class `TrailingSaturday`)

**Interfaces:**
- Produces: `last_week(weeks: int, sat_weeks: Sequence[int]) -> int`. It returns `weeks + 1` iff `weeks + 1` is in `sat_weeks`, and `weeks` otherwise.

- [ ] **Step 1: Write the failing tests** in `TrailingSaturday`, using fictitious names (reuse `make_config` from that file where it helps). The spec §7 list, one test each:
  1. A request with `weeks: 4, weekends_with_saturday: [5]` solves `ok: true`. `schedule["5"]` has exactly the key `Saturday`, with `Lead` and `BGV` filled. No week has a phantom Sunday.
  2. `[6]` with `weeks: 4` → `ok: false`. The message names the legal range and counts Sundays: it says «4 Sundays», never «5 weeks».
  3. A week-5 exclusion without `5` in `weekends_with_saturday` → `ok: false`. With `5` in it, the exclusion applies: the person is never on the 31st.
  4. A Sunday-role pin in week 5 → `ok: false`, and the message says week 5 has no Sunday service. A Saturday pin in week 5 is honoured (`pinned_honored` counts it).
  5. `X Sat.* == 1` is satisfied by week 5 alone (`[5]`).
  6. A pair rule `A !with B on *.*` holds in week 5.
  7. A presence rule `any_of(A,B) on Sat.BGV each_week` binds week 5.
  8. A consecutive rule `A !consecutive on *.Lead` binds weeks 4–5. Under a pin that forces it, `pin_violations` reports `W4-5 A: …`.
  9. One seat per service holds in week 5.
  10. The dedicated Saturday-lead anchor binds week 5.
  11. Absence slack: a full `!in week 5 *.*` earns exactly ONE service of slack, not two. Assert through `compute_absence_slack`.
  12. Under pins, `builtin:mandatory_lead:W5:Sat` and `builtin:sat_anchor:W5` are reported when forced.
  13. No `Sun.*` variable for week 5. With `discourage_consecutive` on, record the model (the same patch technique as test_inertness) and assert that no variable name matches `asgn[*,Sun.*,W5]` or `rep[*,Sun.*,W4]`.
  14. A refused (infeasible) request that names `weeks + 1` gets the diagnostic hint line naming the trailing Saturday and suggesting it be deselected. A refused request that does not name it gets no hint.
  15. `unfilled_seats` entries for week 5 read `W5 Saturday Sat.<Role> #<n>`, and `total_counts`/`role_counts` include week-5 seats.

  Run: `cd gcf && …/python3 -m unittest test_owt_solver_v2.TrailingSaturday -v`
  Expected: FAIL (week 5 is refused by `normalize_weekend_indexes`).

- [ ] **Step 2: Implement.** Keep every change minimal. Each site with its edit:
  - `normalize_weekend_indexes`: accept `1..weeks+1`. Refusal message: `f"weekends_w_sat must use 1-based indexes 1..{weeks + 1}: {weeks} Sundays, and {weeks + 1} = the Saturday after the last one. Received {invalid}."`
  - Add `last_week` right after it, with the docstring from the prototype.
  - `parse_pins`: the week range becomes `1..last_week(weeks, sat_weeks)`, and the range message counts Sundays. Add the refusal: `role not in SATURDAY_ROLES and week > weeks` → `f"pinned[{i}] pins {role} in week {week}, which has no Sunday service (the Saturday after the last Sunday)."`
  - `build_slots`: append the trailing week's `Sat.Lead` then `Sat.BGV` slots AFTER the existing loop, with pin-grown seats as `seats()` computes them, exactly as the prototype does.
  - `create_model_and_solve`:
    - compute `max_week = last_week(...)` once;
    - bound these loops by `max_week` instead of `config.weeks`: mandatory lead, the week-exclusion guard (keep its message counting Sundays), pair, weekly presence, consecutive (`range(1, max_week)`) and one-seat-per-service;
    - soft consecutive penalty (the `elif optimize:` block): bound by `max_week`, and inside the role loop `if week > config.weeks and role_type in SERVICE_ROLES[SUNDAY_SERVICE]: continue` BEFORE creating `av`, so no Sunday-role variable exists for the trailing week;
    - leave the Sun.Lead weekly rotation loop at `config.weeks`: it already skips weeks with no Sun.Lead seat before drawing, and week 5 has none.
  - `compute_absence_slack`: verify it reads `sat_weeks` for the Saturday half and `1..weeks` for the Sunday half, so the trailing week earns one service of slack. Change it only if a test shows otherwise.
  - `diagnose_infeasibility`:
    - bound by `last_week(...)`;
    - after the existing message is composed, when `weeks + 1` is in `sat_weeks`, append one line: `f" The Saturday after the last Sunday (week {weeks + 1}) is part of this request; if it cannot be staffed, deselect it and fill it by hand."` It applies whether the message is the no-lead one or the generic one.
  - `build_schedule_view`: `view.setdefault(w, {})[SATURDAY_SERVICE] = …`.
  - The CLI text printer (~:1864): loop to `last_week(...)` and print only the services present.
  - Check every other `config.weeks` / `range(1, weeks` use in the file (`grep -n "config.weeks\|range(1, weeks"`). Leave each one that is about Sundays or templates. Record every decision in your report.

- [ ] **Step 3: Run the tests.** `TrailingSaturday` must pass, then the whole python gate. `STAGE_A_FINGERPRINTS`, `LADDER_FINGERPRINTS`, `GOLDEN_SCHEDULE` (on Linux in CI only) and Task 1's `IDENTITY_FINGERPRINTS` must stay green WITHOUT re-capture. A red one is a finding: stop and report it.

- [ ] **Step 4: Freeze a trailing fixture.** Add `TRAILING_FINGERPRINTS` for one trailing shape to `gcf/test_inertness.py`: `w4-trailing` = `frozen_config(1)` with `[2, 4, 5]`, every solve fingerprinted, first solve OPTIMAL asserted. Its governance is the same as `LADDER_FINGERPRINTS`. Add its row to `docs/CI.md`.

- [ ] **Step 5: A realistic sanity check (local only).** Build a fictitious October-shaped request (4 Sundays, `[5]` only and `[1..5]`, 10–14 names across the three pools, two `Sat.* == 1` minimums, a few `!in week` exclusions) and solve it both ways; report `ok`, week 5's schedule and `objective_skipped`. The real October request was measured on the prototype by two reviewers; do not fetch production data for this.

- [ ] **Step 6: Commit.**

```bash
git add gcf/owt_solver_v2.py gcf/test_owt_solver_v2.py gcf/test_inertness.py docs/CI.md
git commit -m "feat(solver): staff the Saturday after the last Sunday as a week with no Sunday" -m "weekends_with_saturday accepts weeks + 1: the month-end Saturday whose Sunday is in the next month. Its slots come after every existing slot and every per-week loop is bounded by the last week the request names, so a request without it builds the model it always built (identity fingerprints, captured on the unchanged solver, stay green). The soft consecutive penalty makes no Sunday variable for that week, and a refused month that names it says so."
```

---

### Task 3: Docs, ADR, and the spec's step-zero wording

**Files:**
- Modify: `docs/SOLVER_AND_INFRA.md`:
  - «Input / output (JSON)»: the legal index `weeks + 1`, and `schedule["<weeks+1>"]` holding only `Saturday`.
  - «Verifying a Cloud Function deploy»: step 3, the trailing smoke request with fictitious names; an old revision answers `ok: false`, meaning the deploy did not land and needs a redeploy.
  - «Before the request leaves the planner»: say the planner does NOT send `weeks + 1` yet, because that is delivery 2.
- Create: `docs/adr/00NN-the-trailing-saturday-is-a-solver-week-with-no-sunday.md`. NN is the next free number on `main`; `adrIndex.test.ts` enforces it. Record D1 (Approach A), D2, D3, the invariant, and the spec's §9 rejected alternatives in brief. Link the spec and review log.
- Modify: `docs/superpowers/specs/2026-09-29-solver-trailing-saturday-design.md` §7, step zero, marked **(post-approval)**. ADR-0046 (#120) makes production requests history-free, so the history-free literals already match production. The identity fingerprints (Task 1, with and without history) were captured in this branch's first commit on the unchanged solver (plan ruling P1).
- Modify: `docs/adr/README.md` index, if it lists ADRs.

- [ ] **Step 1: Write the docs.** Check every sentence against the code.
- [ ] **Step 2: Run the four gates** on the final tree: the python gate, `npx tsc --noEmit`, `npm test` (the ADR index test runs here) and `npx eslint .`.
- [ ] **Step 3: Commit.** `docs(solver): the trailing Saturday — contract, deploy check and ADR`, with no trailer.

---

## After the plan (the release, spec §7)

1. Run a fresh code review of the whole range, carrying the docs-audit and worklog checklists. Fix what it finds, then re-verify.
2. Open a PR to `main`; `gates` includes the python gate. Merge it with Frank's standing auto-merge rule. **There is no preview step for `gcf/`: Cloud Build deploys `main` to production and dev at once.**
3. Deploy check:
   - `gcloud functions describe owt-solver --gen2 --region=us-central1`: `updateTime` is after the merge, and the state is ACTIVE.
   - Frank runs the documented pinless smoke and the trailing smoke (the API key is his).
4. Only then does delivery 2 (the planner) send `weeks + 1`.
