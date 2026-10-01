# The trailing Saturday in the planner (delivery 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** in create mode, Auto staffs the month-end Saturday whose Sunday is in the next month (Sat 31 Oct 2026) as solver week `weeks + 1`. Saturday minimums are applied person by person. When nobody can lead that Saturday it is not sent, and the admin is told why. The «Fuera del alcance de Auto» surface goes away.

**Architecture:** one pure definition, `trailingSaturday(sundayDatesFull)`. The existing adjacency helpers (`saturdayForWeek`, `weekForColumn`, `weekendWeekIndexes`) resolve that date to week `weeks + 1` through it, so a column, a seat, an unfilled marker and a pin can never disagree about its week. `buildSolveRequest` makes three decisions, and returns every omission with a reason:
- whether the Saturday is sent (T5: can anyone lead it);
- the availability rule for it;
- which Saturday floors apply, per person (T3/T4).

**Tech Stack:** Next.js 16 / React 19 client components, TypeScript, vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-09-29-planner-trailing-saturday-and-fill-empty-design.md` §2 (delivery 2), §2.3, §2.4 and §4. Frank approved it on 2026-09-29. **Prerequisite:** delivery 1, the solver accepting `weeks + 1`, must be deployed to the Cloud Function before this reaches `main`. An old solver refuses `weeks + 1` loudly (`ok: false`), so dev fails visibly, never silently.

## Global Constraints

- **T1:** the trailing Saturday is the last Sunday + 6 days, only if that date is still in the same calendar month. It is staffed as solver week `weeks + 1`.
- **T2:** it is preselected like every Saturday; deselecting it leaves it out.
- **T3:** Saturday floors (`isSaturdayFloor`) are judged per person. A floor above what that person can reach this month is left out for them, and the notice names them.
- **T4:** when the floors cannot all fit the month's Saturday seats, keep them in ascending order of the person's Saturday count in the history entries the request is built with, ties broken by name, while the kept set still fits. Leave the rest out and name them. (ADR-0046 made Auto send `history: []`, so today every count is 0 and the order is by name. See ruling Q2.)
- **T5:** if nobody in the Sunday-lead ∪ Saturday-lead pools can lead the trailing Saturday, it is not sent, and the notice says why. The reasons that count: unavailable that day, excluded by a `!in` rule, or excluded by a week exclusion for that week.
- **T6:** `{weeks-N}` counts Sundays: `weeks = sundayDatesFull.length`, unchanged.
- **A request without a trailing Saturday is byte-identical to today's.** (post-implementation) This
  holds only when no Saturday minimum is left out: every floor is reachable, and `floorsFitSeats`
  seats them all. T3/T4 apply in every month. Without pins, they change a request only by leaving
  out a floor the old request could not meet. The exception is a person with two Saturday floors,
  whom the seat model judges conservatively (ADR-0048). (post-implementation, ruling Q14) When
  those floors cannot be merged, the later one is left out as `combined`, in every month.
  (post-implementation, ruling Q16) Merging was removed. Only a person's first Saturday floor
  (rules card order) is judged, and every later one is `combined`, in every month. That is the
  only exception left.
- Notices, in order: floors left out (grouped by reason and named as the rules card names them, with `capLabel`), then the trailing Saturday not sent, then delivery 3's notices.
- The four gates must pass: `npx tsc --noEmit`, `npm test`, `npx eslint .` with 0 errors. No `gcf/**` change.
  (post-implementation) This plan's commits change no `gcf/**` file. The branch does carry
  delivery 1's `gcf/**` changes, through the merge `f4846169`, so the Python gate runs on it too.
- Spanish UI copy; conventional commits. **Never** add a Co-Authored-By or AI-attribution trailer.
- `CueDialog` literal-`open` baseline 5, `Button` only, `motion` only under `ui/` (house rules, CLAUDE.md).

## Rulings for this plan

- **Q1:** a trailing Saturday that T5 withholds is not a column Auto writes. `collectPins` and `emptyVoiceSeats` take the request's `weekends_with_saturday` and skip Saturday columns whose week is not in it. Otherwise, with «Solo llenar vacíos» on, a hand-filled 31st would be pinned and then refused («no se envía al solver»), which contradicts «31 a mano, con aviso». `pinRefusal`'s Saturday-week check stays as the backstop.
- **Q2:** T4's order uses the `historyEntries` the request is built with. Under ADR-0046 those are `[]`, so every count is 0 and the order falls back to name. The notice therefore never claims "they have more Saturdays in the history".
- **Q3:** the pattern→roles expansion needed for T3/T5 is written once, in `plannerModel.ts`, as `rolesOfPattern(pattern)`. It mirrors `gcf/owt_solver_v2.py` `expand_pattern` and its legacy aliases, and a sync test reads the solver file. `plannerModel.ts` must not import `ruleEnforcement.ts`, because `ruleEnforcement` already imports `plannerModel`.

## File structure

| File | Responsibility |
|---|---|
| `app/components/admin/plannerModel.ts` | `trailingSaturday`; trailing-aware `saturdayForWeek`/`weekForColumn`/`weekendWeekIndexes`; `rolesOfPattern`; T3/T4/T5 inside `buildSolveRequest`; `OmittedCap.reason`; `omittedCapsNotices` (plural); `trailingNotice`. `unaddressableDates` removed. |
| `app/api/admin/solve/route.ts` | `SolveResponse.schedule[w].Sunday` becomes optional. |
| `app/components/admin/pinModel.ts` | `collectPins`/`emptyVoiceSeats` take `weekendsWithSaturday?` (Q1). |
| `app/components/admin/MonthGenerator.tsx` | `prepareSolve` pushes the new notice list, passes sent weeks to `collectPins`/`emptyVoiceSeats`; the `unaddressableDatesList` useMemo is removed. |
| `app/components/admin/PlannerGrid.tsx` | The `unaddressableDates` prop, the «Fuera del alcance de Auto» badge (`ColumnHeader`) and the confirm clause are removed. |
| Tests | `__tests__/trailingSaturday.test.ts` (new, pure); `saturdayFloors.test.ts` (updated for reasons); `plannerModel.test.ts` (D16 tests amended, not deleted); `__tests__/trailingSaturday.wiring.test.tsx` (new, derived path); `pinModel.test.ts` (Q1 case); `PlannerGrid.test.tsx` (badge removal). |
| Docs | `docs/SOLVER_AND_INFRA.md` «Before the request leaves the planner»; `docs/MONTH_GRID_EDITING.md`; `docs/UTILITIES_AND_COMPONENTS.md`; a new ADR recording T1 amending D16 and T3–T5; `docs/superpowers/plans/2026-07-29-planner-grid.md` D16 gets a one-line pointer to the new ADR. |

---

### Task 1: One definition of the trailing Saturday, and the helpers resolve through it

**Files:** `plannerModel.ts`, `app/api/admin/solve/route.ts`, `pinModel.ts`, new `__tests__/trailingSaturday.test.ts`, `plannerModel.test.ts` (D16 amendments).

**Interfaces (produces):**
- `trailingSaturday(sundayDates: string[]): string | null`: last Sunday + 6 days if its `YYYY-MM` equals the last Sunday's, else `null`; `null` for an empty list. Use the existing noon-pinned date arithmetic (`subtractDay`'s style).
- `saturdayForWeek(n, sundayDates)`: unchanged for `1..weeks`. For `n === weeks + 1` it returns `trailingSaturday(sundayDates)`. Otherwise `null`.
- `weekForColumn(column, sundayDates)`: a `saturday_role` column whose date equals `trailingSaturday(sundayDates)` → `weeks + 1`. Everything else is unchanged.
- `weekendWeekIndexes(sundayDates, activeSatDates)`: also appends `weeks + 1` when `trailingSaturday` is in `activeSatDates`. It is the CANDIDATE list; T5 in `buildSolveRequest` may withhold it.
- `SolveResponse.schedule[w].Sunday?:` becomes optional. Fix every TS consumer (`applySolveResponse` already guards; the test harness `pinSolveHarness.ts` `emptySchedule`/`echoPins` keep writing Sunday for weeks ≤ `weeks` and only Saturday for `weeks + 1`).
- `collectPins(input)` and `emptyVoiceSeats(input)` accept `weekendsWithSaturday?: number[]`. When given, a `saturday_role` column whose week is not in it is skipped (Q1). Absent means today's behaviour.
- `unaddressableDates` is REMOVED from `plannerModel.ts`. Its callers go in Task 3. This task may keep a temporary re-export only if tsc needs it between commits; say so in the report.

- [ ] **Step 1: Failing tests** (`trailingSaturday.test.ts`):
  - `trailingSaturday`:
    - Oct 2026 (Sundays 4/11/18/25) → `2026-10-31`.
    - Nov 2026 (Sundays 1/8/15/22/29) → `null`, because 29 + 6 falls in December.
    - Jan 2026 (Sundays 4/11/18/25) → `2026-01-31`.
    - Feb 2026 (Sundays 1/8/15/22) → `2026-02-28`.
    - Jul 2027 → `2027-07-31`.
    - `[]` → `null`.
  - `saturdayForWeek(5, OCT)` → `2026-10-31`, and `saturdayForWeek(6, OCT)` → `null`.
  - `weekForColumn({type:"saturday_role", date:"2026-10-31"}, OCT)` → `5`, and `2026-10-03` → `1`.
  - `weekendWeekIndexes(OCT, ["2026-10-31"])` → `[5]`, and `(OCT, ["2026-10-03","2026-10-31"])` → `[1, 5]`.
  - `applySolveResponse` with `schedule: {"5": {Saturday: {Lead: […], BGV: […]}}}` and no Sunday key writes the 31st's Lead/BGV cells and touches nothing else.
  - `mapUnfilledSeats(["W5 Saturday Sat.BGV #3"], OCT, ["2026-10-31"], OCT)` maps to the 31st's `bgv` cell.
  - `cellsToDrafts` produces the 31st's `saturday_role` draft with its voices.
  - `collectPins` with `weekendsWithSaturday: []` skips the 31st's column; with `[5]` it pins it as `Sat.*` week 5.
  - A month with no trailing Saturday (Nov 2026): all these helpers answer exactly as before. Assert against today's values.
- [ ] **Step 2: Amend the D16 tests** in `plannerModel.test.ts` that pin the 31st as unaddressable or «no week». Rewrite each to assert the new mapping, and add a comment `// D16 amended by ADR-0048 (T1): the trailing Saturday is week weeks + 1.` Do not delete them silently.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** `npx vitest run app/components/admin/__tests__/trailingSaturday.test.ts app/components/admin/__tests__/plannerModel.test.ts app/components/admin/__tests__/pinModel.test.ts`, then `npx tsc --noEmit`.
- [ ] **Step 5: Commit.** `feat(planner): one definition of the Saturday after the last Sunday, resolved to week weeks + 1`

---

### Task 2: What the request sends — T5, the availability rule, per-person floors (T3/T4)

**Files:** `plannerModel.ts`, `__tests__/trailingSaturday.test.ts` (extend), `__tests__/saturdayFloors.test.ts` (update), new `__tests__/patternRolesSync.test.ts`.

**Interfaces (produces):**
- `rolesOfPattern(pattern: string): Array<"Sun.Lead" | "Sat.Lead" | "Sun.BGV" | "Sat.BGV" | "Sun.Choir">`. It mirrors `expand_pattern` (`gcf/owt_solver_v2.py`, around :208) and `LEGACY_PATTERN_ALIASES`, and returns `[]` for an unknown pattern. `patternRolesSync.test.ts` reads the solver file and checks the alias table and the special cases (`*.*`, `Sun.*`, `Sat.*`, `*.LeadBGV`, `*.<role>`) against `rolesOfPattern`, in the style of `serviceTimeSchemaSync.test.ts`.
- `type OmitReason = "noSaturday" | "unreachable" | "capacity"`, and `OmittedCap` gains `reason: OmitReason`.
  (post-implementation, ruling Q14) A fourth reason, `"combined"`, was added: a floor its person's other floors cannot be merged with.
  (post-implementation, ruling Q16) It now means any Saturday floor after the person's first.
- `buildSolveRequest(...)`'s ok result gains `trailing: { date: string; sent: boolean; reason?: "noLead" } | null`. It is `null` when the month has no trailing Saturday or it is not selected.
- `omittedCapsNotices(omitted: OmittedCap[]): string[]` replaces `omittedCapsNotice`: one line per reason group, in the order `noSaturday`, `unreachable`, `capacity`. Keep the old wording exactly for `noSaturday`.
  (post-implementation, ruling Q14) The shipped order is `noSaturday`, `unreachable`, `combined`, `capacity`.
- `trailingNotice(t: NonNullable<ok["trailing"]>): string | null`.

**Behaviour, in order inside `buildSolveRequest`:**
1. `candidates = weekendWeekIndexes(sundayDates, activeSatDates)`.
2. **T5**, when `weeks + 1` is in `candidates`:
   - The candidate leads are the request's `sunday_leads` ∪ `saturday_leads` (names).
   - A lead can take the Saturday unless one of these holds:
     - `unavailableDates` includes the trailing date;
     - an `excludedPatterns` entry has `Sat.Lead` in `rolesOfPattern(p)`;
     - a `weekExclusions` entry has `week === weeks + 1` and `Sat.Lead` in `rolesOfPattern(pattern)`.
   - Resolve restriction persons with the same resolver the request uses (`resolvedNameOrRaw`).
   - (post-implementation, ruling Q17) A lead also cannot when one of their Saturday maximums is used up. A Saturday maximum is an `==` or `<=` cap on a pattern whose `rolesOfPattern` includes `Sat.Lead`, its value resolved by `resolvedCapValue`. It is used up when that value is ≤ the number of OTHER sent Saturdays on which they are the only possible lead (`loneLeadsOf`, the lone-lead rule). That covers a zero maximum. Only the trailing Saturday is judged this way.
   - No lead can → drop `weeks + 1` from `weekends_with_saturday` and set `trailing = { date, sent: false, reason: "noLead" }`. Otherwise `trailing = { date, sent: true }`.
3. **Availability:** for every request member unavailable on the trailing date, and only when it is sent, emit `"<member_name> !in week <weeks+1> Sat.*"`. Emit nothing derived from the next month's Sunday.
4. **Floors (T3/T4)** replace today's month-level `dropCap`:
   - For each restriction's cap with `isSaturdayFloor(cap, weeks)`, count the person's reachable Saturdays. A sent Saturday week `w` counts if the person is not unavailable on `saturdayForWeek(w)` AND at least one role in `rolesOfPattern(cap.pattern) ∩ {Sat.Lead, Sat.BGV}` is:
     - not excluded by an `excludedPatterns` entry;
     - not week-excluded for `w`;
     - (for `Sat.Lead`) the person is in the Sunday- or Saturday-lead request pool.
   - If the sent weeks are empty → every floor is omitted with `noSaturday`. That is today's behaviour and sentence.
   - Else if `resolvedCapValue(cap, weeks)` > reachable → omitted with `unreachable`.
   - Then capacity. Let `S` = the number of sent Saturdays. Seats are `Sat.Lead` 2·S, `Sat.BGV` 3·S, total 5·S. Demand is each remaining floor's value, counted as Lead for `Sat.Lead`, BGV for `Sat.BGV`, and total-only for `Sat.*`.
   - If any class exceeds its seats, sort the remaining floors by (the person's Saturday count summed over `historyForRequest(historyEntries, year, month)` `role_counts[person]["Sat.Lead"] + ["Sat.BGV"]`, then `r.person`). Keep them greedily while every class still fits. Omit the rest with `capacity`.
   - (post-implementation, ruling Q10) The pooled count above kept sets the solver cannot seat, so it was replaced by a seat assignment, `floorsFitSeats`:
     - each sent Saturday has 2 Lead + 3 BGV seats and one seat per person;
     - `Sat.Lead` takes only a Lead seat, `Sat.BGV` only a BGV seat, `Sat.*` either, and only where that person can take that role that week;
     - a floor of value v needs v distinct Saturdays;
     - it is solved as a max flow;
     - a person with several floors is judged conservatively: demand is the largest value, and seats are limited to the classes every floor allows.

     The greedy keeps a floor iff the kept set plus it can still all be seated. See ADR-0048.
   - (post-implementation, fix round 2, ruling Q14) Two corrections to that model:
     - the merge also refuses an `==` floor below the largest value. `Sat.* == 2` plus `Sat.Lead == 1` was seated as Lead twice, and the solver refused a month the model called a fit. A floor that cannot be merged with its person's kept floors (no common class, or that `==` rule) is omitted as `combined` before any seat is counted. Only a failed seat assignment is `capacity`;
     - a Saturday's lone lead: when exactly one lead-pool member can lead a sent Saturday, they may take only its Lead seat there (the solver's `mandatory_lead`, one seat per person per Saturday).
   - (post-implementation, final fix wave, ruling Q16) The merge is gone. It over-demanded once more: Ana's `Sat.* >= 2` plus `Sat.Lead >= 1` became two Lead seats, and Dani's `Sat.Lead >= 1` was dropped as a false `capacity` in a November the solver could staff. Only a person's first Saturday floor in the rules card's order goes on to the seats. Every later one is `combined`, decided after `unreachable` and before the flow, so the flow only ever sees one floor per person. The lone-lead rule stays.
   - Omitted floors are dropped from that person's DSL line exactly as today; maximums always stay.

**Copy:**
- `noSaturday`: today's sentence, unchanged.
- `unreachable`: «No se aplicó «X» a A y B: no pueden cubrir ningún sábado de los que Auto llena este mes (no disponibles, excluidos o fuera de los líderes).» Group by cap, with `joinEs`.
  (post-implementation, ruling Q6) The shipped sentence is number-neutral. It is true whether the person reaches no Saturday or too few: «No se aplicó «X» a A y B: los sábados que Auto llena este mes no alcanzan para cumplirlo (por disponibilidad, exclusiones o rol).»
- `capacity`: «No caben todos los mínimos de sábado en los lugares de sábado de este mes, así que no se aplicó «X» a A.»
- (post-implementation, ruling Q14) `combined`: «No se aplicó «X» a A y B: Auto no combina dos mínimos de sábado de la misma persona.» Group by cap, with `joinEs`.
- trailing `noLead`: «El sábado <d> <mes> no se mandó al solver: ningún líder puede dirigirlo (no disponibles o excluidos). Llénalo a mano.» (post-implementation, ruling Q17) The shipped sentence is «El sábado <d> <mes> no se mandó al solver: ningún líder puede dirigirlo (no disponibles, excluidos o sin sábados libres en su regla). Llénalo a mano.» The date uses `dayLabel` from `pinModel.ts` (move `dayLabel` to `plannerModel.ts` if the import would create a cycle; `pinModel` imports `plannerModel`, so `plannerModel` must not import `pinModel`).

- [ ] **Step 1: Failing tests.** The spec §2.4 cases, in `trailingSaturday.test.ts`, with October 2026 fixtures:
  - Only the 31st selected; Andy, Tay and Vale each `Sat.* == 1`; Tay unavailable on the 31st:
    - `weekends_with_saturday` = `[5]`;
    - `dsl_rules` contains `Tay Sat.* == 1`? No: Tay's floor is left out (`unreachable`), while Andy's and Vale's stay;
    - `"<Tay's member_name> !in week 5 Sat.*"` is emitted;
    - no rule for 1 Nov.
  - All five Saturdays selected: `[1,2,3,4,5]`, every floor kept.
  - A crafted over-subscribed Saturday: 6 people with `Sat.* == 1` and only the 31st sent (5 seats) → one omitted with `capacity`. Which one follows the (history count, name) order.
  - A deselected trailing Saturday sends nothing new.
  - T5: every lead unavailable on the 31st → `[ ]` without 5, `trailing.sent === false`, and the notice shows. With the 3rd also selected → `[1]`.
  - Nov 2026 (no trailing): the request is byte-identical to the pre-change request for the same inputs. Build the expected value by hand; do not compute it with the new code.
  - Update `saturdayFloors.test.ts` for `reason` and `omittedCapsNotices` (plural).
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run the tests.** The new files, `saturdayFloors`, `plannerModel`, `solverPools`, then `npx tsc --noEmit`.
- [ ] **Step 4: Commit.** `feat(planner): send the trailing Saturday when someone can lead it, and judge Saturday minimums per person`

---

### Task 3: Wiring, and the «Fuera del alcance de Auto» surface goes

**Files:** `MonthGenerator.tsx`, `PlannerGrid.tsx`, `pinSolveHarness.ts`, new `__tests__/trailingSaturday.wiring.test.tsx`, `PlannerGrid.test.tsx`, and any test that passes `unaddressableDates`.

- [ ] **Step 1: Failing wiring tests** (derived path; `stubSolve` + `plannerWiringHarness`):
  - October 2026 with only the 31st selected, Auto → the solve body has `weekends_with_saturday: [5]`. `echoPins`/`emptySchedule` returns `schedule["5"].Saturday`, and the 31st's Lead/BGV cells show it.
  - T5 in the UI: every lead unavailable on the 31st → the body has no 5, the notice line «El sábado 31 oct no se mandó al solver…» renders in `[data-auto-notices]`, and the Sundays are solved.
  - With «Solo llenar vacíos» on and a hand-filled 31st that T5 withholds (Q1): Auto is NOT refused, and no Saturday pins for week 5 are sent.
  - Notice order when a floor is also left out: floors first, then the trailing line.
  - The badge «Fuera del alcance de Auto» appears nowhere; the confirm has no «fuera del alcance» clause.
- [ ] **Step 2: Implement.**
  - `prepareSolve`:
    - replace the single floors notice with `...omittedCapsNotices(built.omittedCaps)`, then push `trailingNotice(built.trailing)` if non-null, then delivery 3's lines (duplicates);
    - pass `weekendsWithSaturday: built.request.weekends_with_saturday` to `collectPins`.
  - The PlannerGrid `fillEmpty.emptyVoiceSeats` count: pass the weeks the request WOULD send. Compute it from a `useMemo` over the same pure T5 check, e.g. export a small `sentSaturdayWeeks(...)` helper from Task 2 rather than re-implementing it. If that is not clean, pass `weekendWeekIndexes(...)` and state in the report that the count can include a withheld 31st.
  - Remove `unaddressableDatesList`, the prop, the badge, the confirm clause, and the `unaddressable` `ColumnHeader` prop. Update each test that passed the prop.
- [ ] **Step 3: Run the tests.** The new wiring file, `app/components/admin/__tests__`, then the full suite and tsc/eslint.
- [ ] **Step 4: Commit.** `feat(planner): Auto staffs the Saturday after the last Sunday, and says when it cannot`

---

### Task 4: Docs and the ADR

- [ ] `docs/SOLVER_AND_INFRA.md` «Before the request leaves the planner»: replace the «month-end Saturday is manual-only / drops Saturday MINIMUMS» text with T1–T5 as built. Keep the October 2026 history in one sentence.
- [ ] `docs/MONTH_GRID_EDITING.md`: the 31st column is Auto's; T5's notice; the badge is gone.
- [ ] `docs/UTILITIES_AND_COMPONENTS.md` `plannerModel` row: `trailingSaturday`, `rolesOfPattern`, reasons on `omittedCaps`, `omittedCapsNotices`, `trailingNotice`, and `unaddressableDates` removed.
- [ ] New ADR (next free number on `main`; `adrIndex.test.ts`): «The Saturday after the last Sunday belongs to its calendar month». It records T1 amending D16, T3–T5, Q1 and Q2, and the rejected alternatives from the solver spec §9. Link both specs. Add a one-line pointer to D16 in `docs/superpowers/plans/2026-07-29-planner-grid.md`.
- [ ] Mirror any `CLAUDE.md` change into `AGENTS.md` (`agentDocsParity.test.ts`).
- [ ] Run the four gates on the final tree, then commit: `docs(planner): the trailing Saturday is Auto's`.

---

## After the plan

1. Run a fresh whole-branch review (code, docs, worklog), then one fix wave, then a scoped re-verify.
2. **Do not merge to `preview` or `main` before delivery 1 is live on the Cloud Function**:
   - `gcloud functions describe`: `updateTime` is after the merge;
   - the trailing smoke returns `schedule["5"]` with only `Saturday`.
3. Then `preview` → verify the dev alias → Frank's look on dev (October 2026, only the 31st selected; generate, then check the 31st has voices) → PR → auto-merge → verify the production alias.
4. Restoring `Sat.* == 1` for Andy, Tay and Vale is Frank's call (dry-run first). With T3 in place, a floor that becomes unreachable no longer sinks the month.
5. The MCP P4 amendment (spec §5) is still open.
