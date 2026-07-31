# Calendar picker, special services, local rule enforcement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Three changes to the month generator, built together because they share one mechanism — a calendar replaces the date checkboxes, any weekday can become a named `special_role`, and the solver's hard rules (pairwise conflicts, person exclusions, week exclusions) are enforced locally in the grid's candidate ranking.

**Architecture:** Widen the column type end-to-end **first**, as a typed change with pinning tests around it, because five silent `===` branches and two silent pass-throughs decide weekend-vs-special today and all seven keep compiling when the type widens. Then the rules land as a new pure module the ranker consumes. Then the calendar replaces the setup step's controls. The write path is last, because it is the only part that can put wrong data in Sanity.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind, vitest (`environment: "node"`, per-file `@vitest-environment jsdom` for components). No solver changes — `gcf/owt_solver_v2.py` is untouched (E4, E10).

**Source spec:** [`docs/superpowers/specs/2026-07-30-calendar-specials-rules-design.md`](../specs/2026-07-30-calendar-specials-rules-design.md), approved at review round 5. **Facts and E-decisions are cited by number below and are not restated.** Where a task appears to contradict an E-decision, the decision governs and the task is wrong.

**Predecessor:** C · Planificador is merged to `main` (`9eec3da`). `plannerModel`, `PlannerGrid`, `seatModel` and `candidateRanking` are all extended here, none replaced.

---

## Global Constraints

- Done gate, per task: `npx tsc --noEmit`, `npm test`, `npx eslint .` with **0 errors** (89 warnings are a deliberate backlog).
- Spanish UI copy.
- Dates at local noon: `new Date(iso.slice(0,10)+"T12:00:00")`. Never bare `new Date(iso)`. Timezone America/Mexico_City.
- Sanity array-of-object writes need a `_key` per item.
- Conventional commits; the body explains the *why*. Never add AI/Claude attribution or `Co-Authored-By` trailers.
- Branch off `main`; never commit to `main` directly.
- **No production writes without explicit user consent.** Nothing in this plan needs a migration — fact 28: production holds zero `special_role` documents.

---

## Decisions this plan makes

The spec deferred these to the plan. They are settled here; do not re-open them mid-task.

| # | Decision |
|---|---|
| **P1** | **E20 is expressed TWICE, deliberately.** Work item 10 offered a filter *or* a nullable value type. Take both: `HISTORY_ROLE_KEYS` gains `special_role: { leads: null, bgvs: null, chorus: null }` with the value type widened to `string \| null` on all three fields and all three bumps guarded (`historyEntryFromDrafts:727-729`), **and** `handleConfirm:1349`'s `historyDrafts` filters `_type !== "special_role"`. The filter states the intent where a reader looks for it; the null entry makes a leak inert. This is the codebase's own "belt and braces" idiom (`SeatBoard.tsx:175-178`), and E20's failure mode — silently poisoning persisted CP-SAT history that every later month reads — is exactly the kind that earns two locks. |
| **P2** | **Renaming a created special is REFUSED (E19, work item 12).** Once a draft has `exists === true`, its name input is disabled with a short reason; the admin edits the service in the Tablero instead. Rejected: routing the rename to a Sanity patch, which would put an edit path inside a *create* dialog and need its own revision guard, its own `revalidate*` call and its own failure UI. |
| **P3** | **The calendar lives on the SETUP STEP ONLY (work item 14).** `handlePreview`'s `setCells([])` (`MonthGenerator.tsx:1130`) is the only thing preventing stale date-keyed cells surviving a column-type change, and `cellsByDate` is keyed by date alone (fact 10). A live calendar beside the grid repeals that guarantee for no stated user benefit. Changing dates means `← Volver`, which already routes through the discard guard (`5c07e26`). |
| **P4** | **`handleColumnSwap` refuses any swap involving a special (work item 15).** It already refuses to cross service types (`MonthGenerator.tsx:1167-1172`); a special carries a `service_name` bound to its column, so swapping rosters underneath two names silently mislabels both. Same refusal, one more condition. |
| **P5** | **`isSolvable` is split in two.** Fact 6 records that its name hides a second consumer: `PlannerGrid.tsx:679` uses it for D7's `target` cap and the amber over-target `+N`, so making it `false` for specials silently drops both. Introduce `hasTarget(row, column)` for the display cap and leave `isSolvable` meaning *only* "the CP-SAT solve fills this". Specials get `hasTarget === true`, `isSolvable === false`. |
| **P6** | **O1 is answered "leave it, and say so in the UI" for this plan.** Threading the config into `ServicesPanel` or moving rules to Sanity are both real options; neither is in scope here, and the second is a schema change. The consequence must be *visible*, not silent: the rule panel states that rules are stored in this browser only. See "Open questions" — this is the one item worth over-ruling if the user disagrees. |

---

## File structure

```
app/components/admin/
  plannerModel.ts               MODIFY  ColumnType, two keys, five branches, buildColumns, history
  ruleEnforcement.ts            CREATE  pure: rules → blocked/allowed per (member, row, column)
  candidateRanking.ts           MODIFY  accept a rule verdict; fairness-aware sort (E8)
  PlannerGrid.tsx               MODIFY  special columns, rule blocks, skip reasons
  MonthCalendar.tsx             CREATE  the setup-step calendar (E1, E2, E3)
  MonthGenerator.tsx            MODIFY  calendar wiring, specials state, write path, history filter
  serviceCardModel.ts           MODIFY  monthTargetPreflight special branch (name-blind)
  ServicesPanel.tsx             MODIFY  preflightTarget signature; existingRoles carries service_name
  __tests__/                    CREATE/MODIFY  per task
app/utils/
  monthDraftCreate.ts           MODIFY  CreatableDraft._type, draftCreateBody service_name
  computeParticipation.ts       MODIFY  specials count toward load (E12)
  draftToDayCardProps.ts        MODIFY  SERVICE_LABEL, not a third ternary
```

---

### Task 1: Pin what must not move

**Files:** Modify `app/components/admin/__tests__/plannerModel.test.ts`, `app/components/admin/__tests__/MonthGenerator.create.test.tsx`.

Tests only, against **current** code. Every one must pass before any production line changes, and each pins an invariant a later task could break silently. Prove each discriminates by mutation — flip the behaviour it pins, watch it fail, restore.

**Steps**
1. **Week spine (E21).** `buildSolveRequest` over a month with 5 Sundays emits `!in week 3 Sun.*` for the **third Sunday of the month**, and `weekForColumn` returns 3 for it. Pin that this is positional over the full Sunday list, independent of which columns exist.
2. **Fairness history (E9/E20).** `historyEntryFromDrafts` over weekend drafts produces the current `Sun.Lead`/`Sat.Lead`/`Sun.Choir` counts. This is the baseline Task 6 must leave untouched while adding the special exclusion.
3. **Draft identity (E19).** In `cellsToDrafts`, a second call with the same `columns` and a `previous` array reuses `localId` and `creationRequestId` and preserves `exists`. This is the property the collision-key fix must not break.
4. **Existing-service skip (fact 8).** An `existingRoles` entry marks that column `skipped` and `exists`.
5. **Labels (fact 26).** `draftToDayCardProps` labels `sunday_role` "Domingo" and `saturday_role` "Sábado".

**Verify:** all five fail when their behaviour is inverted. `npm test` green.

**Done:** the regression net exists; no production file changed.

---

### Task 2: `plannerModel` — widen the type, split the keys, fix all seven sites

**Files:** Modify `app/components/admin/plannerModel.ts`, `app/utils/monthDraftCreate.ts`, `app/components/admin/serviceCardModel.ts`, `app/components/admin/ServicesPanel.tsx`, `app/components/admin/MonthGenerator.tsx`, `app/utils/draftToDayCardProps.ts`, `app/components/admin/__tests__/MonthGenerator.create.test.tsx`; test `app/components/admin/__tests__/plannerModel.test.ts`.

The type change alone is nearly inert (fact 6) — the whole value of this task is the seven sites it forces you to visit.

**Steps**
1. Widen `ColumnType` (`plannerModel.ts:63`) to include `special_role`, then widen the **six other narrow declarations** enumerated in work item 1, plus the seventh in `MonthGenerator.create.test.tsx:104`. Do not stop when `tsc` goes green — it goes green long before the job is done.
2. `GridColumn` gains `serviceName?: string` (specials only). Thread it to `DraftCard`, `CreatableDraft` (`monthDraftCreate.ts:28`) and `draftCreateBody` (`:49-61`) as `service_name`.
3. **The five `===` branches** (work item 7):
   - `rowAppliesTo:206` — a special HAS a Coro row (E18). Express row applicability as a `Record<ColumnType, …>` so the next column type cannot be forgotten.
   - `isSolvable:215-219` — split per P5. `isSolvable` false for specials; new `hasTarget` true.
   - `weekForColumn:460-469` — returns `null` for a special, and `applySolveResponse` (`:521`, `:537`) must never map a solver week onto a special column.
   - `PlannerGrid.tsx:539` and `draftToDayCardProps.ts:47` — both use `SERVICE_LABEL` (`serviceCardModel.ts:172-176`). No new ternaries (work item 6).
   - `cellsToDrafts:624` — `chorus` is written when and only when `rowAppliesTo` showed the Coro row. Derive it from `rowAppliesTo`, do not re-state the condition; E18's standing requirement is that the two agree.
4. **The two pass-throughs** (fact 6): `cellsToParticipantRoles:798`/`:802` forwards `column.type` and passes `idsFor("coro")` unguarded for every type — align it with step 3's rule. Note `canonicalSetlistTargetKey` (`serviceCardModel.ts:1187`) returns `""` for a special; that is acceptable only because Task 5 keeps the preflight name-blind — leave a comment saying so.
5. **Two keys, not one** (work item 3, E19). In `cellsToDrafts`, split the single `${_type}__${date}` string into an **identity key** (`type__date`, feeding `prevByKey`, `localId`, `creationRequestId`, `exists` — never name-bearing) and a **collision key** (`type__date__normalizedName` for specials, matching `roleCreationReceipt.ts:141`, feeding `existing`/`isExisting`). `MonthGenerator.tsx:38`'s local `ExistingRole` gains `service_name`; `ServiceRole` already carries it.
6. `buildColumns:226-236` takes `specials: {date, name}[]` as a third input, and **dedupes by date defensively** (work item 13) — E3 is a UI rule today, and a leak renders duplicate React keys in three places.
7. `HISTORY_ROLE_KEYS:667` — widen the value type to `string | null` on all three fields, add the all-null `special_role` entry, guard all three bumps (P1, half one).

**Verify:** Task 1's five tests still pass. New unit tests: a special column gets a Coro row and writes `chorus`; `weekForColumn` returns null for it; `historyEntryFromDrafts` counts nothing for it; renaming a special preserves `localId`/`creationRequestId`; an existing same-named special collides while a differently-named one does not; `buildColumns` drops a duplicate date.

**Done:** the pure module handles specials end-to-end. No UI yet.

---

### Task 3: `ruleEnforcement` — the rules as a pure module

**Files:** Create `app/components/admin/ruleEnforcement.ts`; modify `app/components/admin/candidateRanking.ts`, `app/components/admin/plannerModel.ts` (export `resolveToMemberName`); test `app/components/admin/__tests__/ruleEnforcement.test.ts`.

**Steps**
1. Export `resolveToMemberName` with a **resolve-or-report** shape (E11, work item 4) — `{ resolved: string } | { unresolved: string }`, never the bare input, which is what makes a miss invisible today (`plannerModel.ts:312`).
2. `evaluate({ member, row, column, assigned, config })` → `{ blocked: true, reason } | { blocked: false }`. Rules covered: pairwise conflicts (E14 — same **column**, not same week), person exclusions (E15 — the service half must match; only `*` matches a special), week exclusions (E7 — weekend columns only). Pattern expansion follows E16 for `*.LeadBGV`.
3. **The self-exemption is load-bearing** (E6): a member already occupying the cell being edited is never blocked. Without it `CandidateRow`'s `!blocked` guards on both `onClick` and `onKeyDown` (`PlannerGrid.tsx:795-806`) make a violating pair impossible to un-seat, and the admin's only escape is discarding the month.
4. A rule naming nobody is **reported**, never dropped (E11), reusing the existing `unresolvedNames` channel.
5. `candidateRanking` accepts a rule verdict and honours `fairness_exempt`/`fairness_slack` in its **sort** (E8). Availability stays a `+10` penalty, not a block (fact 19, non-goal) — rules and availability must not look alike in the UI.

**Steps that are NOT in scope** — state them in the module's header comment so a later reader does not assume coverage: presence rules, count caps, global fairness (all three are spec non-goals).

**Verify:** tests use production-shaped data where **alias ≠ member_name** (work item 4) — this is the exact trap that would have shipped the feature doing nothing. Pin: a `*`-scoped conflict fires on a special; a `Sat.*` exclusion does **not** (E15); a week exclusion does not (E7); the occupant of the edited cell is never blocked; an unknown name is reported.

**Done:** rules evaluate correctly in isolation. Not yet wired.

---

### Task 4: Specials count toward participation (E12)

**Files:** Modify `app/utils/computeParticipation.ts`, `app/components/admin/ParticipationSidebar.tsx`, `app/utils/__tests__/computeParticipation.test.ts`.

Small and isolated, but it reverses a recorded v1 decision and changes a shipped surface, so it gets its own task and its own commit.

**Steps**
1. Remove the skip at `computeParticipation.ts:47`; give specials their own bucket so `total` stays the sum of its parts.
2. The sidebar's caption (`:78`) and stacked bar (`:83`) enumerate five fields today — both must account for the new bucket, or the bar under-fills and the caption stops summing to the big number (`:87`).
3. `computeParticipation.test.ts:43` pins the old exclusion; it changes with the decision. Say so in the commit body.
4. Decide `serviceWeekKey` (fact 22): a weekday special currently takes its own week key and so evicts a real weekend from the 4-week `recent` window. Fix or accept — but state which in the code, not in the plan.

**Verify:** `npm test`; the sidebar renders a month containing a special with `total` equal to the bar's segments.

**Done:** the `load` signal E5's filler depends on is consistent with the `recent` strip (fact 21's drift closed).

---

### Task 5: The calendar picker (E1, E2, E3, E21)

**Files:** Create `app/components/admin/MonthCalendar.tsx`; modify `app/components/admin/MonthGenerator.tsx`, `app/components/admin/serviceCardModel.ts`, `app/components/admin/ServicesPanel.tsx`; test `app/components/admin/__tests__/MonthCalendar.test.tsx` (jsdom).

**Steps**
1. Replace the Domingos/Sábados checkboxes (`MonthGenerator.tsx:1396-1402`) and the Saturday pill row (`:1403-1426`) with a month calendar. Sundays and Saturdays selected by default; tap to deselect; tap a weekday to add a special with a name.
2. **E21 is the invariant of this task.** Calendar selection feeds `buildColumns` **only**. `buildSolveRequest` (`:1201`), `applySolveResponse` (`:1235`), `mapUnfilledSeats` (`:1241`) and `computeUnaddressableDates` (`:1079`) keep receiving `sundayDatesFull` (`:1070`). Deselecting a Sunday must not renumber a single week — otherwise the seeded week-1 and week-3 exclusions land on the wrong dates silently, or the solve 400s below three Sundays.
3. E3: one column per date, refused **with a stated reason**. A day already generating a weekend service cannot also be a special; a *deselected* Saturday can.
4. Per P3 the calendar is on the setup step only.
5. `monthTargetPreflight` gains a special branch (work item 2) that is **name-blind** — `RoleTarget`/`RoleTargetRecord` carry no `service_name` (`serviceReadSummary.ts:58-69`, `:83-104`), so it can only key by date. It stays source-gated (`expectsLock: false`, empty proven setlist/proposal history) and **E17's collision key from Task 2 remains the sole existence authority**. Widen `preflightTarget` (`ServicesPanel.tsx:1156`) to match.

**Verify:** a test that deselects a Sunday and asserts every remaining week index is unchanged (work item 11) — mutate it to feed the selected subset and watch it fail. A test that E3's refusal fires on both orderings (weekend-then-special, special-then-weekend).

**Done:** dates and specials are picked on a calendar; the solver's week spine is provably untouched.

---

### Task 6: Specials through the write path

**Files:** Modify `app/components/admin/MonthGenerator.tsx`, `app/utils/monthDraftCreate.ts`, `app/components/admin/PlannerGrid.tsx`; test `app/components/admin/__tests__/MonthGenerator.create.test.tsx`.

The only task that can put wrong data in Sanity. Nothing here is cosmetic.

**Steps**
1. `draftCreateBody` posts `service_name` for specials (fact 5) — without it every special 400s on `canonicalizeCreatePayload` (`roleCreationReceipt.ts:136`).
2. A client-side guard refuses confirm on an **empty** special name (work item 9); `handleConfirm` has none today.
3. **E17's skip reason needs a channel that does not exist.** `PlannerGrid` receives only `skipped: Set<string>` and `preflightFor`; plumb the draft's `exists`/`isExisting` to `ColumnHeader` so "skipped because this special already exists" reads differently from the admin's own Omitir toggle. Today all three surfaces disagree: the checkbox renders unchecked, the badge says "Se puede crear", and `handleConfirm` posts nothing (fact 9, `:1268-1289`).
4. P2: once `exists`, the name input is disabled with a reason. A rename must never mint a fresh draft (E19) — that posts a second `special_role` on the same date, which the server accepts, orphaning the first silently.
5. P1's second lock: `handleConfirm:1349`'s `historyDrafts` filters out `special_role` before `historyEntryFromDrafts`.
6. P4: `handleColumnSwap` (`:1156-1188`) refuses any swap involving a special.

**Verify:** create a special end-to-end against a mocked `fetch` and assert the posted body carries `service_name`; assert an empty name is refused before any request; assert no solver-history counts are written (work item 10 — mutate the filter away and watch it fail); assert a rename after `exists` cannot mint a new `creationRequestId`.

**Done:** a special can be created from the generator, and cannot be created twice.

---

### Task 7: Specials and rules in the grid (E5, E6, E13)

**Files:** Modify `app/components/admin/PlannerGrid.tsx`, `app/components/admin/MonthGenerator.tsx`; test `app/components/admin/__tests__/PlannerGrid.test.tsx` (jsdom).

**Steps**
1. Special columns render with their name and the "Especial" label, Coro included (E18).
2. **E5 — the local filler.** Specials are filled by the ranker, labelled as a distinct mechanism from the solver, and it **must run even when the solve fails**: `handleAuto` returns early on solver failure (`:1206-1225`), and a failed weekend solve must not block a special's fill.
3. **E6 — hard blocks**, rendered disabled with the rule named, on *adding* only. The self-exemption from Task 3 is what keeps this from trapping the admin.
4. **E13 — re-check after any bulk fill**, not only at pick time (fact 23). Solver output, E5's greedy fill and a rule edited after seating are all unreachable by pick-time blocking — the same reason `categoryDuplicatesForDate` exists.
5. P6: the rule panel states plainly that rules live in this browser only (fact 15). Do not present a per-browser rule as an enforced one.
6. The non-goals get UI treatment or none at all — caps are **not** enforced, and the UI must not imply they are.

**Verify:** a violating pair produced by a bulk fill is flagged and **can still be un-seated** (mutate the self-exemption away and watch the test fail — this is E6's trap). A special fills when the weekend solve errors.

**Done:** the feature is usable end-to-end.

---

## Before shipping

- Open `/admin` in a **real logged-in session**, desktop and the iOS wrap. This is still outstanding from the C work — nobody has opened the planner grid live.
- First real run uses `Crear N borrador(es)`, never `Crear y publicar` — publishing queues assignment emails to the whole team (`app/api/admin/roles/route.ts:264-286`, and `EMAIL_ALLOWLIST` is `"*"` since 2026-07-03).
- Carry-forwards from C, unrelated to this plan but visible in the same panel: the config step's `grid-cols-3` has no phone breakpoint, and `MemberPool` checkbox rows are ~26px against a 44px touch target.

## Open questions for the user

**O1 (P6) — rules are per-browser.** They live in `localStorage` (fact 15) and `SeatBoard` cannot see them at all (fact 25), so after E6 the planner grid refuses a pair the Tablero permits, and a second admin enforces a different rule set entirely. This plan proceeds with "leave it, and say so in the UI". Moving rules into Sanity is the only option that makes hard enforcement true beyond one browser — it is a schema change plus a migration, and it would be its own plan.

## Not verified independently

Facts 12 and 28 rest on my own read-only GROQ; the Sanity MCP tool was unavailable to review rounds 3–5, so no reviewer confirmed them. Fact 12 (**every seeded rule name is an alias**) is the one that matters — it is why Task 3 step 1 exists, and why its tests must use data where alias ≠ member_name. Fact 28 (zero production specials) is why this plan has no migration.
