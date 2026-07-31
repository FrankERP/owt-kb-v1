# Calendar month picker, special services, and local rule enforcement

**Status:** design, not yet planned. Successor to the C · Planificador work merged to `preview`.

> **Round 3 note.** The reviewer could not verify facts 12 and 28 — the Sanity MCP query tool was unavailable in its session. Both were verified by me earlier by read-only GROQ and stand; fact 12's blast radius is low either way, since E11's resolver matches `member_name` OR `alias`.
>
> **Rewritten 2026-07-30** after a first review found eight blockers, two of which were false facts of mine. The most serious: the spec directed the implementer to resolve rule names with `memberIdToName`, which returns `member_name` — but **every seeded rule name is an alias**, so all nine rules would have silently matched nobody and the hard-block feature would have shipped doing nothing.

**Goal.** Three changes to the month generator, decided together because they share one mechanism:

1. **Calendar-first date picking** — the month as a real calendar; tap the days to generate.
2. **Special services on any day** — tap a weekday to add a `special_role` with a name.
3. **Local enforcement of the solver's hard rules** — pairwise conflicts, person exclusions and week exclusions applied in the grid's candidate ranking, on specials *and* on the weekend grid.

---

## Load-bearing facts

Verified against source, and against the production dataset read-only where stated.

**Specials in the write path — server side is ready**
1. `special_role` is in `ALLOWED_TYPES` on the create route (`app/api/admin/roles/route.ts:118`) and first-class in the read model (`app/utils/serviceReadModel.ts:10`, `:53`, `:74`).
2. Specials store **`date`**; weekend types store `week` (`roleWriteRequest.ts:173`, `:186`). Specials carry `service_name` (`:215`, `:238`).
3. **Specials take no weekend lock** (`roleWriteRequest.ts:258`); their target key is `canonical.targetIdentity` (`:281`), so they cannot contend with a weekend target.
4. **The server already permits two differently-named specials on one date**: `loadTargetOccupancy` filters canonical specials by *normalized `service_name`* (`roleWriteOps.ts:387-391`) against identity `special_role:${date}:${name}` (`roleCreationReceipt.ts:141`).

**Specials in the write path — the CLIENT side is not ready**
5. `draftCreateBody` posts **no `service_name`**, and `CreatableDraft._type` is weekend-only (`monthDraftCreate.ts:28`, `:49-61`). `canonicalizeCreatePayload` raises issue `"service_name"` for a nameless special (`roleCreationReceipt.ts:136`) → `400 invalid_request`. **Every special would fail to create.**
6. **The governing declaration is `ColumnType` (`plannerModel.ts:63`)**, not `MonthGenerator.tsx:32`. `GridColumn.type` is `ColumnType` (`:67`) and `DraftCard._type` is `ServiceType = ColumnType` (`:72`, `:90`). `MonthGenerator.tsx:32` is a **local shadow** with exactly one use — the `preflight` prop at `:62` — so widening *that* line changes almost nothing. The union is declared narrowly in **four** places (`plannerModel.ts:63`, `MonthGenerator.tsx:32`, `monthDraftCreate.ts:28`, `serviceCardModel.ts:1183`) and already includes `special_role` in two others (`serviceCardModel.ts:94`, `assignmentEmail.ts:7`).
   **Widening is NOT broadly `tsc`-visible.** Only `Record<ServiceType, …>` (fact 27) breaks the build; every other weekend/special distinction is an `===` comparison that keeps compiling and silently takes the Sunday-or-Saturday path. **Five** such branches exist and each is wrong for a special:
   - `rowAppliesTo` (`plannerModel.ts:206`): `row.id === "coro"` returns `column.type === "sunday_role"` → a special gets **no Coro row**, contradicting fact 24.
   - `isSolvable` (`plannerModel.ts:215-219`): after `rowAppliesTo`, returns true for lead/bgv/coro on **any** column type → special columns become **solvable**, contradicting E4/E5.
   - `weekForColumn` / `applySolveResponse` (`plannerModel.ts:460-469`, `:521`, `:537`): a non-Sunday column falls into the Saturday branch, so a special dated the day before a selected Sunday resolves to a real week and **has that Saturday's roster written into it**. E4 governs the request; nothing governs the response mapping.
   - `PlannerGrid.tsx:539`: `column.type === "sunday_role" ? "Domingo" : "Sábado"` → a special column header reads **"Sábado"** — the same bug as fact 26, one file over.
   - **`cellsToDrafts` (`plannerModel.ts:624`) — this one is on the WRITE path.** `const chorus = column.type === "saturday_role" ? [] : idsFor("coro");` A special takes the else branch and commits whatever `idsFor("coro")` holds straight into Sanity (`:649`). Because `cellsByDate` is keyed by date alone (fact 10) and E3 lets a *deselected* Saturday become a special, a stale `coro` cell from an earlier column type survives the switch and is written. `SeatBoard.tsx:222` carries the identical guard with the comment that occupancy "can survive a type switch from Sunday, so the write is forced empty too" — the same hazard, already understood one file over.
7. `monthTargetPreflight` is weekend-only (`serviceCardModel.ts:1183`) and looks a target up by `targetKey` (`:1193-1195`). A special's canonical key is its **document id** (`serviceReadModel.ts:44-56`), so the lookup can never match → `role` defaults to `"none"` → **always `creatable`**, which is wrong in the dangerous direction.
8. `cellsToDrafts` keys existing services as `${_type}__${date}` (`plannerModel.ts:597`, `:609`). One special on a date would mark **every** special column on that date `skipped: true` — never posted, silently.
9. `handleConfirm` posts only `creatable` targets (`MonthGenerator.tsx:1266-1284`).

**The grid is keyed by DATE ALONE**
10. `GridCell` (`plannerModel.ts:48-53`), `cellKey(date, rowId)`, `assignedForDate`, `categoryDuplicatesForDate` (`PlannerGrid.tsx:105`, `:117-127`, `:137-145`, `:276`), `cellsByDate` (`plannerModel.ts:600`, `:776`) and `typeOf = columns.find(c => c.date === d)` (`MonthGenerator.tsx:1166`) all assume **one column per date**. Two specials on one date would share one roster.

**The rules — and the resolver trap**
11. `ConflictRule { id; personA; personB; pattern }`, `PersonRestriction { … excludedPatterns; fairness; fairnessSlack; weekExclusions: {week, pattern}[]; caps }`, `PresenceRule` — all in `plannerModel.ts:109-152`.
12. **Rules name people by ALIAS, not by `member_name`.** Verified by read-only GROQ: all nine seeded rule names are aliases whose `member_name` differs — `Frank` → `Francisco Emiliano Rocha Pineda`, `Mkz` → `Marcos Herrera Forcada`, `Liu` → `Natalia Rodriguez Eguiarte`, and so on for `Gaby`, `Niza`, `Hugo`, `Jakey`, `Marianne`, `Lucía`.
13. `memberIdToName` returns `member_name` only (`plannerModel.ts:322-324`). **`resolveToMemberName` (`plannerModel.ts:307-313`) is the correct one** — it matches `member_name` OR `alias`, case-insensitively — and is currently module-private.
14. The seeded conflict rules all use `*` on the service half (`MonthGenerator.tsx:157-163`); Frank and Mkz are `fairness_exempt`, Gaby `fairness_slack 1` (`:122-141`).
15. **The rules live in `localStorage`** under `owt_solver_config_v3` (`MonthGenerator.tsx:109`, `:1028`). `DEFAULT_SOLVER_CONFIG` is only the first-run seed. Rules are therefore **per-browser and per-device, unshared**.
16. The solver's pair rule binds per **(week, service)** — `owt_solver_v2.py:711-722` — i.e. per column, not per week. A Saturday and its adjacent Sunday are one week but two services.
17. `*.LeadBGV` expands to the four *weekend* role types only (`owt_solver_v2.py:173-174`).

**The ranker**
18. `rankCandidates` knows availability, same-category double-duty and recent load; it knows nothing about conflicts, exclusions or fairness rules, and sorts by `load` ascending (`candidateRanking.ts:78-157`).
19. **Availability is a sort penalty (`+10`), not a block** (`candidateRanking.ts:153`), whereas the solver treats it as a hard `!in week N` (`plannerModel.ts:428-433`).
20. **`computeParticipation` SKIPS specials entirely** — `if (r._type === "special_role") continue;` (`computeParticipation.ts:47`). So specials contribute **zero** to `load`.
21. But `servingIds` in the ranker does **not** skip them (`candidateRanking.ts:63-76`) and `savedWindow` already contains all three types (`ServicesPanel.tsx:1262`). A special therefore lights the `recent` strip while counting zero toward `load` — the number/strip drift `candidateRanking.ts:56-61` exists to prevent.
22. `serviceWeekKey` gives a weekday special its **own** week key (`computeParticipation.ts:27`), so specials consume slots in the 4-week `recent` window and evict real weekends.
23. `blockedReason` is honoured at manual pick and rendered disabled (`PlannerGrid.tsx:279`, `:794-842`), but **only at pick time** — which is why `categoryDuplicatesForDate` exists as a post-hoc flag for solver-written cells (`:132-135`).

**Already-existing capability, and scope**
24. `SeatBoard` **already creates specials with a name**, and gives them Coro, instruments and FOH (`SeatBoard.tsx:219`, `:241`, `:83-86`). Only `saturday_role` drops Coro (`:83-86`, and the write is forced empty at `:222`). Specials are new to the *generator*, not to the app.
25. `SeatBoard` is rendered from `ServicesPanel`, which has **no access to the solver config** (`SeatBoard` renders at `ServicesPanel.tsx:1547`, `:1553`; the solver config never leaves `MonthGenerator`).
26. `draftToDayCardProps` labels any non-`saturday_role` draft "Domingo" (`app/utils/draftToDayCardProps.ts:47`), and the DayCard list still renders (`MonthGenerator.tsx:1601`).
27. `HISTORY_ROLE_KEYS` is `Record<ServiceType, …>` (`plannerModel.ts:667-670`) where that `ServiceType` is `plannerModel.ts:72` — i.e. `ColumnType`. So widening **`ColumnType`** is a `tsc` error until E9 is expressed, and the compiler enforces it. Widening `MonthGenerator.tsx:32` alone earns no enforcement at all.
28. **Production holds zero `special_role` documents** (read-only GROQ). No migration; no evidence base either way on usage.

---

## Decisions

| # | Decision |
|---|---|
| **E1** | **The calendar is the date picker.** Sundays and Saturdays selectable by default; replaces the checkboxes and date pills. |
| **E2** | **Any weekday can become a special**, with a `service_name`. Note this capability already exists in `SeatBoard` (fact 24) — this brings it to the generator, it does not invent it. |
| **E3** | **At most ONE COLUMN per date, of any kind.** Not merely one special: the grid is keyed by date alone in every site of fact 10, so a special sharing a date with its Sunday column would share **one roster**, and `cellsToDrafts` would emit two drafts built from the same cells. The server permits both (fact 4), but re-keying the pure module's core identity is out of scope here. Concretely: a day already generating a weekend service **cannot** also become a special; a Saturday the admin has *deselected* **can** become a special, since it then holds no weekend column. The UI refuses with a stated reason — never a silent drop. **E3 does not rescue the `cellsToDrafts` key (fact 8):** `existingRoles` comes from Sanity (`ServicesPanel.tsx:1254` passes `roles`, whose `_type` includes `special_role` — `serviceCardModel.ts:94`, `:121`), and fact 24 means the Tablero can already have created a special on that date. So the key must be fixed regardless of E3 — see E17. |
| **E17** | **The `existing` key for a special includes its normalized `service_name`**, matching the server's own identity `special_role:${date}:${name}` (`roleCreationReceipt.ts:141`) and the occupancy filter (`roleWriteOps.ts:385-391`). Without this, a special that exists in Sanity on date D marks **every** special column on D `skipped: true` (`plannerModel.ts:597`, `:614`) — and the UI then lies three ways at once: the "Omitir" checkbox renders `skipped.has(column.date)` from `skippedDates` only (`PlannerGrid.tsx:455`), so it shows **unchecked** while the draft is skipped and un-checking cannot clear `isExisting`; the preflight badge reads "Se puede crear" (fact 7); and `handleConfirm` silently never posts it (`MonthGenerator.tsx:1264-1284`). The admin presses Confirmar, is told nothing, and gets nothing. **Skipped-because-existing must render its own reason, distinct from the admin's own skip toggle.** |
| **E4** | **Specials are never sent to the solver.** See E10 for the honest cost of the alternative. |
| **E5** | **Specials are auto-filled by the LOCAL ranker**, labelled as a distinct mechanism. It fills even when the solve fails (`handleAuto` returns early on solver failure — `MonthGenerator.tsx:1206-1225` — and a failed weekend solve must not block a special's fill). |
| **E6** | **The ranker enforces conflicts and person exclusions as HARD blocks** on *adding* someone, shown disabled with the rule named. Hard rather than soft because the ranker sorts by ascending load, so the people a rule protects sit at the top of every list. **A member already occupying the cell being edited is NEVER rule-blocked** — only newly-added ones are. Without this the feature traps: `CandidateRow` guards both `onClick` and `onKeyDown` on `!blocked` (`PlannerGrid.tsx:794-812`), so a blocked row cannot be clicked at all, and `toggleCandidate`'s existing removal exemption (`:276-283`) is unreachable. Today this never bites because `candidateRanking.ts:134-136` exempts the seat being edited from the double-duty block; a conflict rule has no such exemption, so E13's post-fill re-check would otherwise produce a violating pair that **cannot be un-seated** — leaving the admin no recourse but discarding the month. |
| **E7** | **Week exclusions are NOT enforced on specials.** A weekday has no week in the solver's Sunday-anchored sense (fact 22 gives it its own key, which is not the same thing). They remain enforced on weekend columns, where the week is defined. |
| **E8** | **The ranker respects `fairness_exempt` / `fairness_slack` in its SORT.** Fact 14: those three people are marked precisely because raw load is the wrong signal for them. |
| **E9** | **Fairness history ignores specials**, and fact 27 makes the compiler enforce it. |
| **E10** | **Solver support for specials is possible and is NOT chosen here — confirmed with the user 2026-07-30**, who asked whether it was possible and accepted the local ranker once the cost was stated. Honest cost: a service dimension in `Slot`, the per-(person, week, service) uniqueness constraint, the fixed `pools` dict (`owt_solver_v2.py:457-463`), `SERVICE_ROLES` (`:50-53`), the degradation weight names, and a Cloud Build redeploy. `VALID_PATTERNS` derives from `ROLE_ORDER` (`:60-65`) so the DSL follows free, and `build_history_offsets` tolerates absent role keys. **Explicitly warned off:** reusing the Saturday slot of a Saturday-less week would write `Sat.*` counts for a special and contradict E9. |
| **E11** | **`resolveToMemberName` is the resolver** (fact 13), exported for this purpose. `memberIdToName` must NOT be used for rule matching (fact 12) — it would match nobody. Both sides resolve into one space, and a rule naming nobody is **surfaced, not silently dropped**. Exporting the function is not enough on its own: `resolveToMemberName` returns the raw input on no match (`plannerModel.ts:312`), so a caller comparing against `member_name` matches nobody and never learns. It needs a resolve-or-report return shape. |
| **E12** | **Specials count toward the local `load` signal.** Fact 20 means they currently do not, while fact 21 means they already light the strip — so today they are inconsistent. Making them count fixes the drift and gives E5 a signal to work with. This changes `computeParticipation`, which also feeds the participation sidebar: `total` is the big number (`ParticipationSidebar.tsx:87`) beside a stacked bar of `sunLead+satLead / sunBGV+satBGV / coro` (`:83`) and a caption enumerating those five fields (`:78`) — so adding specials to `total` without a bucket makes the bar under-fill and the caption stop summing to the number. This is a deliberate reversal, not a regression: the exclusion was a recorded v1 scope decision **carrying a review flag** (`docs/superpowers/specs/2026-06-30-participation-sidebar-design.md:46-48`), and `computeParticipation.test.ts:43` pins it explicitly — that test changes with the decision. |
| **E13** | **Conflicts are re-checked after any bulk fill**, not only at pick time. Fact 23: pick-time blocking cannot cover solver output, E5's greedy fill, or a rule edited after seating — the same reason `categoryDuplicatesForDate` exists. |
| **E14** | **"Together" means the same COLUMN**, matching the solver's per-(week, service) binding (fact 16). A Saturday and its adjacent Sunday are one week but two services, and a conflict does not span them. |
| **E15** | **On a special column the service half must match, and only `*` matches.** Of the eleven patterns in `EXCL_PATTERNS` (`MonthGenerator.tsx:95-100`), exactly four apply to a special — `*.*`, `*.Lead`, `*.BGV`, `*.LeadBGV` — and seven do not: `Sat.*`, `Sun.*`, `Sun.Lead`, `Sun.BGV`, `Sun.Choir`, `Sat.Lead`, `Sat.BGV`. Ignoring the service half instead would make Frank's `Sat.*` block him from a special, which is the opposite of what the rule says. **Consequence, stated plainly: NO seeded exclusion fires on a special.** Only three of the six seeded restrictions carry `excludedPatterns` at all — Frank, Mkz and Gaby (`MonthGenerator.tsx:123`, `:129`, `:136`) — and all eight of their patterns are service-qualified (`Sat.*`, `Sun.BGV`, `Sun.Choir`). The other three restrictions (`:143`, `:148`, `:153`) hold *only* week exclusions, which E7 does not apply to specials. Two different reasons, same outcome. The five seeded *conflicts* all use `*.…` (`:157-163`) and do apply — so the user's stated requirement, keeping two people apart, holds; the exclusion half simply has nothing to do until someone writes a `*`-scoped exclusion. The UI must not imply otherwise. |
| **E18** | **A special column HAS a Coro row**, matching `SeatBoard`, which already gives specials Coro, instruments and FOH (fact 24) — only `saturday_role` drops it. This is not decorative: `cellsToDrafts:624` writes `chorus` for any non-Saturday column, so the write path already assumes it. The alternative (no Coro on specials) is equally implementable but must then force `chorus` empty at `:624`, exactly as Saturday does. Whichever way, **`rowAppliesTo` and `cellsToDrafts:624` must agree** — a row the grid never showed must never reach Sanity. |
| **E16** | **`*.LeadBGV` covers a special's Lead and BGV rows.** The solver expands it to the four weekend roles only (fact 17), so this is a local extension, not an inherited property. |

---

## Non-goals — stated so they cannot look covered

- **`any_of(...) each_week` presence rules are not enforced locally** — a property of a whole week, not a cell.
- **Count caps are not enforced.** A greedy filler cannot backtrack once it has overshot. Partial enforcement that looks total is worse than none; the UI must not imply caps are honoured.
- **Global fairness is approximated, not solved.** Greedy per column, ordered by load. Not CP-SAT.
- **The solver is not modified** (E10).
- **Availability stays a sort penalty, not a block** (fact 19), matching today's grid behaviour — but E6's rules ARE blocks, so the two differ and the UI must not present them alike.

---

## What the plan must carry as work, not as assumption

Each of these is a fact above that has no implementation today:

1. Widen the union at **all four narrow declarations** — `plannerModel.ts:63` (`ColumnType`, the one that matters), `MonthGenerator.tsx:32`, `monthDraftCreate.ts:28`, `serviceCardModel.ts:1183` — and thread `service_name` through `GridColumn` → `DraftCard` → `CreatableDraft` → `draftCreateBody` (facts 5, 6). Widening only `MonthGenerator.tsx:32` compiles and does nothing.
2. A special branch for `monthTargetPreflight`, keyed to something a special actually has (fact 7), plus `existingRoles` carrying `service_name`.
3. **Mandatory, not optional:** fix `cellsToDrafts`' `${_type}__${date}` key to carry the normalized `service_name` for specials (fact 8, E17). E3 does **not** guarantee this away — the collision comes from Sanity via `existingRoles`, not from two columns in the grid. `MonthGenerator.tsx:38`'s local `interface ExistingRole { _id; _type: string; date }` is where `service_name` is dropped; `ServiceRole` already carries it (`serviceCardModel.ts:123`).
4. Export `resolveToMemberName`; pin it with a test using production-shaped data where **alias ≠ member_name** (facts 12, 13).
5. Decide and implement what a special contributes to `computeParticipation` and to `serviceWeekKey` (facts 20–22, E12).
6. `draftToDayCardProps` must not label a special "Domingo" (fact 26), and `PlannerGrid.tsx:539` must not label its column "Sábado" (fact 6). **Do not add a third and fourth hardcoded ternary** — `SERVICE_LABEL: Record<ServiceType, string>` already exists with `special_role: "Especial"` (`serviceCardModel.ts:172-176`, alongside `SERVICE_BADGE` and `CARD_ACCENT` at `:178-214`). Reusing it is both the CLAUDE.md "don't reinvent" rule and the `Record` that makes the compiler check the label.
7. The **five** silent `===` branches of fact 6: `rowAppliesTo`, `isSolvable`, `weekForColumn`/`applySolveResponse`, the column label, and **`cellsToDrafts:624`'s `chorus`** (the write-path one — it needs the answer to E18, and it must force-empty on any column type whose grid shows no Coro row, mirroring `SeatBoard.tsx:222`). Make the widened type load-bearing wherever possible — a `Record<ColumnType, …>` for row applicability, and `SERVICE_LABEL` for the labels — so the compiler earns the claim fact 6 could not.
8. `buildColumns` (`plannerModel.ts:226-236`) takes only `sundayDates`/`activeSatDates`; specials need a third input.
9. A client-side guard refusing confirm on an empty special name — `canonicalizeCreatePayload` 400s (`roleCreationReceipt.ts:136`) and `handleConfirm` has none.
10. State where the E1 calendar lives — setup step only, or live beside the grid. Today `handlePreview` does `setCells([])` (`MonthGenerator.tsx:1130`) before entering the grid, and that is the *only* thing preventing stale cells for a date whose column type changed. A live calendar removes that guarantee, and `cellsByDate` is date-keyed: same failure class as work item 7's `chorus` branch.
11. `handleColumnSwap` (`MonthGenerator.tsx:1156-1188`) would let two special columns swap rosters while each `service_name` stays with its column. Decide and state whether that is intended; the weekend swap already refuses to cross service types.

## Open questions

**O1 — Does rule enforcement extend to the Tablero?** Fact 25: `SeatBoard` cannot see the solver config, and fact 15 says the rules are per-browser localStorage anyway. So after E6 the planner grid refuses a pair the Tablero permits, and a second admin enforces a different rule set entirely. Options: leave it; thread the config into `ServicesPanel`; or move rules out of localStorage into Sanity so both surfaces — and both admins — read one source. **The third is the only one that makes "hard enforcement" true beyond one browser**, and it is the most work.
