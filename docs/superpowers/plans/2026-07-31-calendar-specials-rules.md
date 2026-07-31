# Calendar picker, special services, local rule enforcement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

> **Rewritten after review round 1**, which found two blockers, both verified against source. The first: the one surface where the user's hard rule has to hold — the local filler on specials — did not exist in the codebase, was specified in a single sentence, and its acceptance criterion was satisfied by a filler that *violates the rule and flags it afterwards*. It is now Task 7, fully specified. The second: P2's rename refusal keyed on a draft flag that `handlePreview` resets (`previous: []`, `MonthGenerator.tsx:1136`), so the refusal was unreachable across the `← Volver` round-trip and the outcome was a duplicate `special_role` in Sanity — E19's exact forbidden outcome. The refusal moved to the calendar, which reads Sanity.

**Goal:** Three changes to the month generator, built together because they share one mechanism — a calendar replaces the date checkboxes, any weekday can become a named `special_role`, and the solver's hard rules (pairwise conflicts, person exclusions, week exclusions) are enforced locally in the grid's candidate ranking.

**Architecture:** Widen the column type end-to-end **first**, as a typed change with pinning tests around it, because five silent `===` branches and two silent pass-throughs decide weekend-vs-special today and all seven keep compiling when the type widens. Then the rules land as a new pure module. Then the calendar replaces the setup step's controls. The write path and the filler come last — the two parts that can put wrong data in Sanity or violate the rule the user asked for.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind, vitest (`environment: "node"`, per-file `@vitest-environment jsdom` for components). No solver changes — `gcf/owt_solver_v2.py` is untouched (E4, E10).

**Source spec:** [`docs/superpowers/specs/2026-07-30-calendar-specials-rules-design.md`](../specs/2026-07-30-calendar-specials-rules-design.md), approved at review round 5. **Facts and E-decisions are cited by number below and are not restated.** Where a task appears to contradict an E-decision, the decision governs and the task is wrong.

**Predecessor:** C · Planificador is merged to `main` (`9eec3da`). `plannerModel`, `PlannerGrid`, `seatModel` and `candidateRanking` are all extended here, none replaced.

**The requirement in the user's own words**, because two of the decisions below only make sense against it:

> "I need some rules enforce**d** in specials. Specially that exclude two people from being together."
> "It has to be hard because if it's soft in fairness it will always choose people like Frank, Mkz or Gaby who tend to have 1 or 2 participations a month." · "yes, apply on the weekend grid"

---

## Global Constraints

- Done gate, per task: `npx tsc --noEmit`, `npm test`, `npx eslint .` with **0 errors** (89 warnings are a deliberate backlog).
- Spanish UI copy.
- Dates at local noon: `new Date(iso.slice(0,10)+"T12:00:00")`. Never bare `new Date(iso)`. Timezone America/Mexico_City.
- Sanity array-of-object writes need a `_key` per item.
- Conventional commits; the body explains the *why*. Never add AI/Claude attribution or `Co-Authored-By` trailers.
- Branch off `main`; never commit to `main` directly.
- **No production writes without explicit user consent.** Nothing here needs a migration — fact 28: production holds zero `special_role` documents.
- **Tasks 5–8 merge as one unit.** Task 5 puts a "make this day a special" affordance on the calendar; Task 6 is what makes a special postable at all (`draftCreateBody` posts no `service_name` today, so `canonicalizeCreatePayload` 400s — `roleCreationReceipt.ts:136`). Either merge them together or gate the affordance behind Task 6.

---

## Decisions this plan makes

The spec deferred these to the plan; P2 and P7 were rewritten after round 1. They are settled here — do not re-open them mid-task.

| # | Decision |
|---|---|
| **P1** | **E20 is expressed TWICE, deliberately.** Work item 10 offered a filter *or* a nullable value type. Take both: `HISTORY_ROLE_KEYS` gains `special_role: { leads: null, bgvs: null, chorus: null }` with the value type widened to `string \| null` on all three fields and all three bumps guarded (`historyEntryFromDrafts:727-729`), **and** `handleConfirm:1349`'s `historyDrafts` filters `_type !== "special_role"`. The filter states the intent where a reader looks for it; the null entry makes a leak inert. This is the codebase's own "belt and braces" idiom (`SeatBoard.tsx:175-178`), and E20's failure mode — silently poisoning persisted CP-SAT history that every later month reads — earns two locks. |
| **P2** | **The duplicate-special refusal lives on the CALENDAR, which reads `existingRoles`. A date that already holds a `special_role` in Sanity cannot receive another from the generator** — the calendar shows the existing one and says so; renaming or editing is done in the Tablero. *Rewritten after round 1:* the original version disabled the name input once a draft had `exists === true`, which is unreachable. `handlePreview` rebuilds drafts with `previous: []` (`MonthGenerator.tsx:1136`), so on any `← Volver` round-trip `exists` collapses to `isExisting` (`plannerModel.ts:615`) — a lookup in the **name-bearing** collision key. Under a new name that key misses, `exists` is false, the guard never fires, the name-blind preflight cannot object by design, and `handleConfirm` posts a second document that the server accepts (occupancy is name-filtered, `roleWriteOps.ts:389-391`). The flag was near-dead anyway: a fully successful confirm calls `onClose()` (`:1355`), so `exists === true` is only ever observable after a *partial* batch failure. A Sanity-derived refusal closes the in-session rename, the cross-session reopen, and E19 in one rule. This forgoes fact 4's legitimate two-differently-named-specials-per-date capability **in the generator only** — E3 already forbade two special columns in one grid, so nothing is lost that was on offer, and `SeatBoard` still permits it. |
| **P3** | **The calendar lives on the SETUP STEP ONLY (work item 14).** `handlePreview`'s `setCells([])` (`:1130`) is the only thing preventing stale date-keyed cells surviving a column-type change, and `cellsByDate` is keyed by date alone (fact 10). A live calendar beside the grid repeals that guarantee for no stated benefit. Changing dates means `← Volver`, which already routes through the discard guard (`5c07e26`). |
| **P4** | **`handleColumnSwap` refuses any swap involving a special (work item 15).** It already refuses to cross service types (`:1166-1172`); a special carries a `service_name` bound to its column, so swapping rosters underneath two names silently mislabels both. |
| **P5** | **`isSolvable` is split in two.** Fact 6 records that its name hides a second consumer: `PlannerGrid.tsx:679-683` uses it for D7's `target` cap and the amber over-target `+N`, so making it `false` for specials silently drops both. Introduce `hasTarget(row, column)` for the display cap and leave `isSolvable` meaning *only* "the CP-SAT solve fills this". Specials get `hasTarget === true`, `isSolvable === false`. |
| **P6** | **O1 is answered "leave it, and say so in the UI" for this plan.** Threading the config into `ServicesPanel` or moving rules to Sanity are both real options; neither is in scope, and the second is a schema change. The consequence must be *visible*, not silent: the rule panel states that rules are stored in this browser only. See "Open questions" — the one item worth over-ruling. |
| **P7** | **A blocked candidate is REMOVED from the filler's pool, not penalised in its sort — and `fairness_exempt` sorts LAST, `fairness_slack N` sorts as `load + N`.** *Added after round 1.* Today `blockedReason` is a `+100` sort key (`candidateRanking.ts:152-153`), never a removal; the actual refusal lives in the UI (`PlannerGrid.tsx:279`, `:788-800`). A filler taking the top `target` rows would therefore seat a blocked person whenever the eligible pool is smaller than the target — routine on a special. So `rankCandidates` gains an explicit **eligibility** verdict separate from its sort, the filler consumes eligibility, and the manual picker keeps consuming the sort. On direction: `rankCandidates` sorts by ascending `load` (`:156`), which puts Frank, Mkz and Gaby — the three the user named as "1 or 2 participations a month" — at the top of every list *by construction*. The solver's `fairness_exempt` means "excluded from the spread constraint" (`owt_solver_v2.py:791-796`), which has no direct sort analogue; the local analogue that serves the user's stated intent is **exempt ⇒ never preferred by low load (sorts last among equals), slack N ⇒ `load + N`**. Getting this backwards reproduces exactly the behaviour the user rejected. |

---

## File structure

```
app/components/admin/
  plannerModel.ts               MODIFY  ColumnType, two keys, five branches, buildColumns, history
  ruleEnforcement.ts            CREATE  pure: rules → eligible/blocked per (member, row, column, assigned)
  candidateRanking.ts           MODIFY  eligibility verdict separate from sort; P7's fairness direction
  localFill.ts                  CREATE  pure: the greedy filler (E5) — does not exist today
  PlannerGrid.tsx               MODIFY  special columns, rule blocks, skip reasons
  MonthCalendar.tsx             CREATE  the setup-step calendar (E1, E2, E3, P2)
  MonthGenerator.tsx            MODIFY  calendar wiring, specials state, write path, history filter
  serviceCardModel.ts           MODIFY  monthTargetPreflight special branch (name-blind)
  ServicesPanel.tsx             MODIFY  preflightTarget signature; existingRoles carries service_name
  __tests__/                    CREATE/MODIFY  per task
app/utils/
  monthDraftCreate.ts           MODIFY  CreatableDraft._type, draftCreateBody service_name
  computeParticipation.ts       MODIFY  specials count toward load (E12)
  draftToDayCardProps.ts        MODIFY  SERVICE_LABEL, not a third ternary
docs/adr/                       CREATE  one ADR — see Task 8
```

---

### Task 1: Pin what must not move

**Files:** Modify `app/components/admin/__tests__/plannerModel.test.ts`, `app/components/admin/__tests__/MonthGenerator.create.test.tsx`.

Tests only, against **current** code. Every one must pass before any production line changes, and each pins an invariant a later task could break silently. Prove each discriminates by mutation — flip the behaviour it pins, watch it fail, restore.

**Steps**
1. **Week spine (E21).** Over a month with 5 Sundays, `buildSolveRequest` emits `!in week 3 Sun.*` for the **third Sunday of the month**. Assert the response mapping through `applySolveResponse` — `weekForColumn` is module-private (`plannerModel.ts:460`, no `export`), and `plannerModel.test.ts:529` already tests it that way. Task 1 changes no production file, so do not export it here.
2. **Fairness history (E9/E20).** `historyEntryFromDrafts` over weekend drafts produces the current `Sun.Lead`/`Sat.Lead`/`Sun.Choir` counts — the baseline Task 6 must leave untouched while adding the special exclusion.
3. **Draft identity (E19).** A second `cellsToDrafts` call with the same `columns` and a `previous` array reuses `localId` and `creationRequestId` and preserves `exists`. This is what the collision-key split must not break.
4. **Existing-service skip (fact 8).** An `existingRoles` entry marks that column `skipped` and `exists`.
5. **Labels (fact 26).** `draftToDayCardProps` labels `sunday_role` "Domingo" and `saturday_role` "Sábado".
6. **`resolveToMemberName`'s raw-input fallback is load-bearing** and Task 3 changes its shape. `buildSolveRequest` relies on it to inject unknown DSL persons into `support` (`plannerModel.ts:414-417`) — omitting them is a documented 422 — and `allRulesToDsl` keeps the rule text. Pin the current `support`/`dsl_rules` output for a rule naming a member who does not exist.

**Verify:** each of the six fails when its behaviour is inverted. `npm test` green.

**Done:** the regression net exists; no production file changed.

---

### Task 2: `plannerModel` — widen the type, split the keys, fix all seven sites

**Files:** Modify `app/components/admin/plannerModel.ts`, `app/utils/monthDraftCreate.ts`, `app/components/admin/serviceCardModel.ts`, `app/components/admin/ServicesPanel.tsx`, `app/components/admin/MonthGenerator.tsx`, `app/utils/draftToDayCardProps.ts`, `app/components/admin/__tests__/MonthGenerator.create.test.tsx`; test `app/components/admin/__tests__/plannerModel.test.ts`.

The type change alone is nearly inert (fact 6) — the value of this task is the seven sites it forces you to visit.

**Steps**
1. Widen `ColumnType` (`plannerModel.ts:63`) to include `special_role`, then the **six other narrow declarations** of work item 1, plus the seventh in `MonthGenerator.create.test.tsx:104`. Do not stop when `tsc` goes green — it goes green long before the job is done.
2. `GridColumn` gains `serviceName?: string` (specials only). Thread it to `DraftCard`, `CreatableDraft` (`monthDraftCreate.ts:28`) and `draftCreateBody` (`:49-61`) as `service_name`.
3. **The five `===` branches** (work item 7):
   - `rowAppliesTo:206` — a special HAS a Coro row (E18). Express applicability as a `Record<ColumnType, …>` so the next column type cannot be forgotten.
   - `isSolvable:215-219` — split per P5.
   - `weekForColumn:460-469` — returns `null` for a special, and `applySolveResponse` (`:521`, `:537`) must never map a solver week onto a special column. **Export it** so Task 2's tests can address it directly.
   - `PlannerGrid.tsx:539` and `draftToDayCardProps.ts:47` — both use `SERVICE_LABEL` (`serviceCardModel.ts:172-176`). No new ternaries (work item 6).
   - `cellsToDrafts:624` — `chorus` is written when and only when `rowAppliesTo` showed the Coro row. **Derive it from `rowAppliesTo`**, do not re-state the condition; E18's standing requirement is that the two agree.
4. **The two pass-throughs** (fact 6): `cellsToParticipantRoles:798`/`:802` forwards `column.type` and passes `idsFor("coro")` unguarded for every type — align with step 3. `canonicalSetlistTargetKey` (`serviceCardModel.ts:1187`) returns `""` for a special; acceptable only because Task 5 keeps the preflight name-blind — leave a comment saying so.
5. **Two keys, not one** (work item 3, E19). Split the single `${_type}__${date}` string into an **identity key** (`type__date`, feeding `prevByKey`, `localId`, `creationRequestId`, `exists` — never name-bearing) and a **collision key** (`type__date__name` for specials, feeding `existing`/`isExisting`). The name is normalized **exactly as the server does — NFC + trim + collapse internal whitespace, and NOTHING else**: `normalizeLabel`'s own docstring says "Case and accents are meaningful" (`roleCreationReceipt.ts:80-85`, matched at `roleWriteOps.ts:389-390`). A `.toLowerCase()` here silently diverges from the server's identity. `MonthGenerator.tsx:38`'s local `ExistingRole` gains `service_name`; `ServiceRole` already carries it and the GET projects it (`app/api/admin/roles/route.ts:61-62`).
6. `buildColumns:226-236` takes `specials: {date, name}[]` as a third input and **dedupes by date defensively** (work item 13) — a leak renders duplicate React keys in three places. **Precedence is weekend-wins**, and it is logged, not silent: a weekend column is what the solver can fill, and E3's UI refusal means reaching this line is already a bug.
7. `HISTORY_ROLE_KEYS:667` — widen the value type to `string | null` on all three fields, add the all-null `special_role` entry, guard all three bumps (P1, lock one).

**Verify:** Task 1's six still pass. New: a special column gets a Coro row and writes `chorus`; `weekForColumn` returns null for it; `historyEntryFromDrafts` counts nothing for it; renaming a special preserves `localId`/`creationRequestId`; an existing same-named special collides while a differently-named one does not; two names differing only in case do **not** collide; `buildColumns` drops a duplicate date weekend-first.

**Done:** the pure module handles specials end-to-end. No UI yet.

---

### Task 3: `ruleEnforcement` — the rules as a pure module

**Files:** Create `app/components/admin/ruleEnforcement.ts`; modify `app/components/admin/candidateRanking.ts`, `app/components/admin/plannerModel.ts` (export `resolveToMemberName`); test `app/components/admin/__tests__/ruleEnforcement.test.ts`.

**Steps**
1. Export `resolveToMemberName` with a **resolve-or-report** shape (E11, work item 4) — `{ resolved: string } | { unresolved: string }`, never the bare input, which is what makes a miss invisible today (`plannerModel.ts:312`). **`buildSolveRequest:414-417` depends on the old fallback** to inject unknown DSL persons into `support`; Task 1 step 6 pinned that output and it must not change.
2. `evaluate({ member, row, column, assigned, members, config })` → `{ blocked: true, reason } | { blocked: false }`. **`members` is not optional** — `assigned` carries only `memberId` (`candidateRanking.ts:29-33`) and rules name people by alias, so both sides need resolving into one name space. Rules covered: pairwise conflicts (E14 — same **column**, not same week), person exclusions (E15 — the service half must match; only `*` matches a special), week exclusions (E7 — weekend columns only). `*.LeadBGV` expands per E16.
3. **The self-exemption is load-bearing** (E6): a member already occupying the cell being edited is never blocked. Without it `CandidateRow`'s `!blocked` guards on both `onClick` and `onKeyDown` (`PlannerGrid.tsx:788-800`) make a violating pair impossible to un-seat, and the admin's only escape is discarding the month.
4. A rule naming nobody is **reported**, never dropped (E11), through the existing `unresolvedNames` channel.
5. **`rankCandidates` gains an `eligible` verdict SEPARATE from its sort** (P7). Today `blockedReason` is only a `+100` sort key (`:152-153`) and the refusal lives in the UI — that is fine for a human clicking, and fatal for a loop. The manual picker keeps consuming the sort; Task 7's filler consumes `eligible`. Apply P7's fairness direction here: exempt sorts last among equals, slack N sorts as `load + N`. Availability stays a `+10` penalty, not a block (fact 19, non-goal) — rules and availability must not look alike in the UI.

**Out of scope, and stated in the module header** so a later reader cannot assume coverage: presence rules, count caps, global fairness — all three are spec non-goals.

**Verify:** tests use production-shaped data where **alias ≠ member_name** (work item 4) — the exact trap that would have shipped the feature doing nothing. Pin: a `*`-scoped conflict fires on a special; a `Sat.*` exclusion does **not** (E15); a week exclusion does not (E7); the occupant of the edited cell is never blocked; an unknown name is reported; an exempt member does **not** sort to the top of an otherwise-equal pool.

**Done:** rules evaluate correctly in isolation. Not yet wired.

---

### Task 4: Specials count toward participation (E12)

**Files:** Modify `app/utils/computeParticipation.ts`, `app/components/admin/ParticipationSidebar.tsx`, `app/utils/__tests__/computeParticipation.test.ts`.

Small and isolated, but it reverses a recorded v1 decision and changes two shipped surfaces, so it gets its own task and commit.

**Steps**
1. Remove the skip at `computeParticipation.ts:47`; give specials their own bucket so `total` stays the sum of its parts. **Note the blast radius is wider than the voice buckets:** that one `continue` also skips a special's instruments and FOH (`:52-53`), so removing it moves `instrWeeks`/`fohWeeks` too.
2. The sidebar's caption (`ParticipationSidebar.tsx:78`) and stacked bar (`:83`) enumerate five fields today — both must account for the new bucket, or the bar under-fills and the caption stops summing to the big number (`:87`).
3. **`SeatBoard`'s candidate `load` changes too**, via `ServicesPanel.tsx:1262` — a shipped surface outside this feature. Sanity-check it renders sensibly before committing.
4. `computeParticipation.test.ts:43` pins the old exclusion; it changes with the decision. Say so in the commit body.
5. Decide `serviceWeekKey` (fact 22): a weekday special currently takes its own week key and so evicts a real weekend from the 4-week `recent` window. Fix or accept — state which **in the code**, not in the plan.

**Verify:** `npm test`; the sidebar renders a month containing a special with `total` equal to the bar's segments.

**Done:** the `load` signal Task 7's filler depends on is consistent with the `recent` strip (fact 21's drift closed).

---

### Task 5: The calendar picker (E1, E2, E3, E21, P2)

**Files:** Create `app/components/admin/MonthCalendar.tsx`; modify `app/components/admin/MonthGenerator.tsx`, `app/components/admin/serviceCardModel.ts`, `app/components/admin/ServicesPanel.tsx`; test `app/components/admin/__tests__/MonthCalendar.test.tsx` (jsdom).

**Steps**
1. Replace the Domingos/Sábados checkboxes (`MonthGenerator.tsx:1396-1402`) and the Saturday pill row (`:1403-1426`) with a month calendar. Sundays and Saturdays selected by default; tap to deselect; tap a weekday to add a special with a name.
2. **E21 is the invariant of this task.** Calendar selection feeds `buildColumns` **only**. `buildSolveRequest` (`:1201`), `applySolveResponse` (`:1235`), `mapUnfilledSeats` (`:1241`) and `computeUnaddressableDates` (`:1079`) keep receiving `sundayDatesFull` (`:1070`). Deselecting a Sunday must not renumber a single week — otherwise the seeded week-1 and week-3 exclusions land on the wrong dates silently, or the solve 400s below three Sundays.
3. **The calendar reads `existingRoles`** and marks every date that already holds a service. Per **P2**, a date already holding a `special_role` cannot receive another — show the existing one and say so. Per **E3**, one column per date of any kind: a day already generating a weekend service cannot also be a special; a *deselected* Saturday can. Both refusals carry a stated reason; never a silent drop.
4. Per P3 the calendar is on the setup step only.
5. `monthTargetPreflight` gains a special branch (work item 2) that is **name-blind** — `RoleTarget`/`RoleTargetRecord` carry no `service_name` (`serviceReadSummary.ts:58-69`, `:83-104`), so it can only key by date. It stays source-gated (`expectsLock: false`, empty proven setlist/proposal history) and **Task 2's collision key remains the sole existence authority**. Widen `preflightTarget` (`ServicesPanel.tsx:1156`) to match.
6. `mapUnfilledSeats`' Sunday branch has no selection filter (`plannerModel.ts:560`, unlike Saturday at `:563`). Once Sundays are individually deselectable, unfilled markers from a week that was never staffed can render on a column that is now a special. Filter it.

**Verify:** deselect a Sunday and assert every remaining week index is unchanged (work item 11) — mutate it to feed the selected subset and watch it fail. E3's refusal fires on both orderings. P2's refusal fires for a date whose special exists only in `existingRoles`.

**Done:** dates and specials are picked on a calendar; the solver's week spine is provably untouched.

---

### Task 6: Specials through the write path

**Files:** Modify `app/components/admin/MonthGenerator.tsx`, `app/utils/monthDraftCreate.ts`, `app/components/admin/PlannerGrid.tsx`; test `app/components/admin/__tests__/MonthGenerator.create.test.tsx`.

The only task that can put wrong data in Sanity. Nothing here is cosmetic.

**Steps**
1. `draftCreateBody` posts `service_name` for specials (fact 5) — without it every special 400s on `canonicalizeCreatePayload` (`roleCreationReceipt.ts:136`).
2. A client-side guard refuses confirm on an **empty** special name (work item 9); `handleConfirm` has none today.
3. **E17's skip reason needs a channel that does not exist.** `PlannerGrid` receives only `skipped: Set<string>` and `preflightFor`; plumb the draft's `exists`/`isExisting` to `ColumnHeader` so "skipped because this special already exists" reads differently from the admin's own Omitir toggle. Today all three surfaces disagree: the checkbox renders unchecked (`PlannerGrid.tsx:455`), the badge says "Se puede crear", and `handleConfirm` posts nothing (`:1268-1289`).
4. P1's second lock: `handleConfirm:1349`'s `historyDrafts` filters out `special_role` before `historyEntryFromDrafts`.
5. P4: `handleColumnSwap` (`:1166-1188`) refuses any swap involving a special.

**Verify:** create a special end-to-end against a mocked `fetch` and assert the posted body carries `service_name`; assert an empty name is refused before any request; assert no solver-history counts are written (mutate the filter away and watch it fail). **The duplicate test must exercise the real path, not `cellsToDrafts` in isolation**: enter the grid, `← Volver`, rename the special, preview again, confirm — and assert exactly one create request. A unit test on `cellsToDrafts` passes over this path, because `handlePreview` supplies `previous: []` (`:1136`) and never consults it. This is the round-1 blocker; a green test over a broken path is what it looked like.

**Done:** a special can be created from the generator, and cannot be created twice — proven through the UI path.

---

### Task 7: `localFill` — the greedy filler for specials (E5)

**Files:** Create `app/components/admin/localFill.ts`; modify `app/components/admin/MonthGenerator.tsx`; test `app/components/admin/__tests__/localFill.test.ts`.

**This task did not exist before round 1, and it is where the user's requirement actually lands.** No greedy fill exists anywhere in the codebase — `handleAuto` (`MonthGenerator.tsx:1197-1259`) only calls `/api/admin/solve`, and specials are never sent there (E4). Everything the user asked for on specials — auto-fill, and two named people kept apart, hard — is this file.

**Steps**
1. `fillColumn({ column, rows, cells, members, savedWindow, config })` → `GridCell[]`. Pure; no React, no fetch.
2. **Which rows and how many:** every row where `rowAppliesTo` is true, up to `row.target` (`hasTarget` from P5 — *not* `isSolvable`, which is false for specials by design).
3. **Per-placement re-evaluation is mandatory.** After each seat, re-run `evaluate` against the assignment state **as of that moment**. The seeded conflicts are `*.Lead`, `*.BGV`, `*.LeadBGV` (`MonthGenerator.tsx:157-163`) — two people in the *same row* of the same column, where Lead's target is 2 and BGV's is 3. Evaluate once against a pre-fill snapshot and both members of a forbidden pair are individually unblocked, so both get seated. The manual path escapes this only because React re-renders and `liveCandidates` re-ranks between clicks (`PlannerGrid.tsx:357-362`); a loop has no such thing.
4. **Blocked candidates are skipped, not penalised** (P7). Consume `rankCandidates`' `eligible` verdict, not its sort position.
5. **Leave the seat empty rather than violate a rule.** An under-filled column is the correct output when no eligible candidate remains; it surfaces through the existing unfilled-seat channel.
6. Deterministic and idempotent: re-running on an already-filled column changes nothing, and it never overwrites a manually-placed cell.
7. Wire into `handleAuto` so it runs for special columns **even when the weekend solve fails** — `handleAuto` returns early on solver failure (`:1206-1211`), and a failed weekend solve must not block a special's fill. Label it in the UI as a distinct mechanism from the solver; it approximates fairness greedily and does not enforce caps (non-goals).

**Verify — this is the acceptance test for the user's requirement:**
- **The filler cannot emit a pair the rules forbid.** Construct a column whose eligible pool makes the forbidden pair the two lowest-load candidates — the exact situation the user described. Assert they are never both seated. Mutate step 4 to use the sort instead of `eligible` and watch it fail; mutate step 3 to a pre-fill snapshot and watch it fail.
- A pool where every remaining candidate is blocked leaves the seat empty and reports it, rather than seating someone.
- An exempt member is not preferred by their low load (P7).
- A special fills when the weekend solve errors.

**Done:** "exclude two people from being together", hard, is true of the auto-fill and not merely flagged after the fact.

---

### Task 8: Specials and rules in the grid (E6, E13) + the ADR

**Files:** Modify `app/components/admin/PlannerGrid.tsx`, `app/components/admin/MonthGenerator.tsx`; create one file under `docs/adr/`; test `app/components/admin/__tests__/PlannerGrid.test.tsx` (jsdom).

**Steps**
1. Special columns render with their name and the "Especial" label, Coro included (E18).
2. **E6 — hard blocks** on manual pick, rendered disabled with the rule named, on *adding* only. Task 3's self-exemption is what keeps this from trapping the admin.
3. **E13 — re-check after any bulk fill**, not only at pick time (fact 23). This covers **solver** output and a rule edited after seating; Task 7 guarantees the filler never produces a violation in the first place, so here E13 is a net, not the enforcement. Do not let the flag stand in for the rule.
4. P6: the rule panel states plainly that rules live in this browser only (fact 15). Do not present a per-browser rule as an enforced one.
5. The non-goals get honest UI or none — caps are **not** enforced, and nothing may imply they are.
6. **Write one ADR** (`docs/adr/`, see its README for the bar). Two decisions here clear it: **E10** — solver support for specials is possible, costed, and deliberately not taken, so a later reader does not "fix" the local filler by extending CP-SAT; and **P6** — rules stay in `localStorage`, so "hard enforcement" is per-browser and per-surface. Both are rejected real alternatives whose reasons will not be visible in the code.

**Verify:** a violating pair produced by the **solver** is flagged and **can still be un-seated** — mutate the self-exemption away and watch it fail (E6's trap). A rule edited after seating flags the existing violation.

**Done:** the feature is usable end-to-end, and the two non-obvious decisions are recorded.

---

## Before shipping

- Open `/admin` in a **real logged-in session**, desktop and the iOS wrap. Still outstanding from the C work — nobody has opened the planner grid live.
- First real run uses `Crear N borrador(es)`, never `Crear y publicar` — publishing queues assignment emails to the whole team (`app/api/admin/roles/route.ts:264-286`, and `EMAIL_ALLOWLIST` is `"*"` since 2026-07-03).
- Carry-forwards from C, unrelated but visible in the same panel: the config step's `grid-cols-3` has no phone breakpoint, and `MemberPool` checkbox rows are ~26px against a 44px touch target.

## Open questions for the user

**O1 (P6) — rules are per-browser.** They live in `localStorage` (fact 15) and `SeatBoard` cannot see them at all (fact 25), so after E6 the planner grid refuses a pair the Tablero permits, and a second admin enforces a different rule set entirely. This plan proceeds with "leave it, and say so in the UI". Moving rules into Sanity is the only option that makes hard enforcement true beyond one browser — a schema change plus a migration, and its own plan.

## Not verified independently

Facts 12 and 28 rest on my own read-only GROQ; the Sanity MCP tool was unavailable to spec review rounds 3–5 and to plan review round 1, so no reviewer confirmed them. Fact 12 (**every seeded rule name is an alias**) is the one that matters — it is why Task 3 step 1 exists and why its tests must use data where alias ≠ member_name. Fact 28 (zero production specials) is why this plan has no migration. Also unverified: that `alias` is unique across members — `resolveToMemberName` takes the first `find` match (`plannerModel.ts:309-311`).
