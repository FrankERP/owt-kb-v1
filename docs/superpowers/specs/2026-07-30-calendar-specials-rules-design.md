# Calendar month picker, special services, and local rule enforcement

**Status:** design, not yet planned. Successor to the C · Planificador work merged to `preview`.

> **Rewritten 2026-07-30** after a first review found eight blockers, two of which were false facts of mine. The most serious: the spec directed the implementer to resolve rule names with `memberIdToName`, which returns `member_name` — but **every seeded rule name is an alias**, so all nine rules would have silently matched nobody and the hard-block feature would have shipped doing nothing.

**Goal.** Three changes to the month generator, decided together because they share one mechanism:

1. **Calendar-first date picking** — the month as a real calendar; tap the days to generate.
2. **Special services on any day** — tap a weekday to add a `special_role` with a name.
3. **Local enforcement of the solver's hard rules** — pairwise conflicts, person exclusions and week exclusions applied in the grid's candidate ranking, on specials *and* on the weekend grid.

---

## Load-bearing facts

Verified against source, and against the production dataset read-only where stated.

**Specials in the write path — server side is ready**
1. `special_role` is in `ALLOWED_TYPES` on the create route (`app/api/admin/roles/route.ts:119`) and first-class in the read model (`serviceReadModel.ts:10`, `:53`, `:74`).
2. Specials store **`date`**; weekend types store `week` (`roleWriteRequest.ts:173`, `:186`). Specials carry `service_name` (`:215`, `:238`).
3. **Specials take no weekend lock** (`roleWriteRequest.ts:255`); their target key is `canonical.targetIdentity` (`:281`), so they cannot contend with a weekend target.
4. **The server already permits two differently-named specials on one date**: `loadTargetOccupancy` filters canonical specials by *normalized `service_name`* (`roleWriteOps.ts:387-391`) against identity `special_role:${date}:${name}` (`roleCreationReceipt.ts:141`).

**Specials in the write path — the CLIENT side is not ready**
5. `draftCreateBody` posts **no `service_name`**, and `CreatableDraft._type` is weekend-only (`monthDraftCreate.ts:28`, `:49-61`). `canonicalizeCreatePayload` raises issue `"service_name"` for a nameless special (`roleCreationReceipt.ts:135-136`) → `400 invalid_request`. **Every special would fail to create.**
6. `type ServiceType = "sunday_role" | "saturday_role"` (`MonthGenerator.tsx:32`), so `GridColumn`, `DraftCard` and the `preflight` signature all *refuse* specials today. Widening it is a `tsc`-visible change, not a silent one — good.
7. `monthTargetPreflight` is weekend-only (`serviceCardModel.ts:1183`) and looks a target up by `targetKey` (`:1193-1195`). A special's canonical key is its **document id** (`serviceReadModel.ts:44-56`), so the lookup can never match → `role` defaults to `"none"` → **always `creatable`**, which is wrong in the dangerous direction.
8. `cellsToDrafts` keys existing services as `${_type}__${date}` (`plannerModel.ts:597`, `:609`). One special on a date would mark **every** special column on that date `skipped: true` — never posted, silently.
9. `handleConfirm` posts only `creatable` targets (`MonthGenerator.tsx:1266-1284`).

**The grid is keyed by DATE ALONE**
10. `GridCell` (`plannerModel.ts:48-53`), `cellKey(date, rowId)`, `assignedForDate`, `categoryDuplicatesForDate` (`PlannerGrid.tsx:111-127`, `:137-145`, `:276`), `cellsByDate` (`plannerModel.ts:600`, `:776`) and `typeOf = columns.find(c => c.date === d)` (`MonthGenerator.tsx:1171`) all assume **one column per date**. Two specials on one date would share one roster.

**The rules — and the resolver trap**
11. `ConflictRule { id; personA; personB; pattern }`, `PersonRestriction { … excludedPatterns; fairness; fairnessSlack; weekExclusions: {week, pattern}[]; caps }`, `PresenceRule` — all in `plannerModel.ts:110-155`.
12. **Rules name people by ALIAS, not by `member_name`.** Verified by read-only GROQ: all nine seeded rule names are aliases whose `member_name` differs — `Frank` → `Francisco Emiliano Rocha Pineda`, `Mkz` → `Marcos Herrera Forcada`, `Liu` → `Natalia Rodriguez Eguiarte`, and so on for `Gaby`, `Niza`, `Hugo`, `Jakey`, `Marianne`, `Lucía`.
13. `memberIdToName` returns `member_name` only (`plannerModel.ts:322-324`). **`resolveToMemberName` (`plannerModel.ts:307-313`) is the correct one** — it matches `member_name` OR `alias`, case-insensitively — and is currently module-private.
14. The seeded conflict rules all use `*` on the service half (`MonthGenerator.tsx:157-163`); Frank and Mkz are `fairness_exempt`, Gaby `fairness_slack 1` (`:122-141`).
15. **The rules live in `localStorage`** under `owt_solver_config_v3` (`MonthGenerator.tsx:109`, `:1028`). `DEFAULT_SOLVER_CONFIG` is only the first-run seed. Rules are therefore **per-browser and per-device, unshared**.
16. The solver's pair rule binds per **(week, service)** — `owt_solver_v2.py:711-721` — i.e. per column, not per week. A Saturday and its adjacent Sunday are one week but two services.
17. `*.LeadBGV` expands to the four *weekend* role types only (`owt_solver_v2.py:175`).

**The ranker**
18. `rankCandidates` knows availability, same-category double-duty and recent load; it knows nothing about conflicts, exclusions or fairness rules, and sorts by `load` ascending (`candidateRanking.ts:78-157`).
19. **Availability is a sort penalty (`+10`), not a block** (`candidateRanking.ts:153`), whereas the solver treats it as a hard `!in week N` (`plannerModel.ts:428-433`).
20. **`computeParticipation` SKIPS specials entirely** — `if (r._type === "special_role") continue;` (`computeParticipation.ts:46`). So specials contribute **zero** to `load`.
21. But `servingIds` in the ranker does **not** skip them (`candidateRanking.ts:63-76`) and `savedWindow` already contains all three types (`ServicesPanel.tsx:1262`). A special therefore lights the `recent` strip while counting zero toward `load` — the number/strip drift `candidateRanking.ts:56-61` exists to prevent.
22. `serviceWeekKey` gives a weekday special its **own** week key (`computeParticipation.ts:27`), so specials consume slots in the 4-week `recent` window and evict real weekends.
23. `blockedReason` is honoured at manual pick and rendered disabled (`PlannerGrid.tsx:279`, `:794-842`), but **only at pick time** — which is why `categoryDuplicatesForDate` exists as a post-hoc flag for solver-written cells (`:132-135`).

**Already-existing capability, and scope**
24. `SeatBoard` **already creates specials with a name**, and gives them Coro, instruments and FOH (`SeatBoard.tsx:219`, `:241`, `:83-94`). Only `saturday_role` drops Coro (`:177`). Specials are new to the *generator*, not to the app.
25. `SeatBoard` is rendered from `ServicesPanel`, which has **no access to the solver config** (`ServicesPanel.tsx:1252-1266`).
26. `draftToDayCardProps` labels any non-`saturday_role` draft "Domingo" (`app/utils/draftToDayCardProps.ts:47`), and the DayCard list still renders (`MonthGenerator.tsx:1601`).
27. `HISTORY_ROLE_KEYS` is `Record<ServiceType, …>` (`plannerModel.ts:667-670`), so widening `ServiceType` is a `tsc` error until E9 is expressed — the compiler enforces it.
28. **Production holds zero `special_role` documents** (read-only GROQ). No migration; no evidence base either way on usage.

---

## Decisions

| # | Decision |
|---|---|
| **E1** | **The calendar is the date picker.** Sundays and Saturdays selectable by default; replaces the checkboxes and date pills. |
| **E2** | **Any weekday can become a special**, with a `service_name`. Note this capability already exists in `SeatBoard` (fact 24) — this brings it to the generator, it does not invent it. |
| **E3** | **At most ONE special per date, enforced in the grid.** The server permits more (fact 4), but the grid is keyed by date alone in nine places (fact 10) and two columns on one date would silently share a roster. Re-keying the pure module's core identity is out of scope here. The UI must refuse a second special on a date with a stated reason, not silently drop it. |
| **E4** | **Specials are never sent to the solver.** See E10 for the honest cost of the alternative. |
| **E5** | **Specials are auto-filled by the LOCAL ranker**, labelled as a distinct mechanism. It fills even when the solve fails (`handleAuto` returns early on solver failure — `MonthGenerator.tsx:1206-1225` — and a failed weekend solve must not block a special's fill). |
| **E6** | **The ranker enforces conflicts and person exclusions as HARD blocks**, shown disabled with the rule named. Hard rather than soft because the ranker sorts by ascending load, so the people a rule protects sit at the top of every list. |
| **E7** | **Week exclusions are NOT enforced on specials.** A weekday has no week in the solver's Sunday-anchored sense (fact 22 gives it its own key, which is not the same thing). They remain enforced on weekend columns, where the week is defined. |
| **E8** | **The ranker respects `fairness_exempt` / `fairness_slack` in its SORT.** Fact 14: those three people are marked precisely because raw load is the wrong signal for them. |
| **E9** | **Fairness history ignores specials**, and fact 27 makes the compiler enforce it. |
| **E10** | **Solver support for specials is possible and is NOT chosen here.** Honest cost: a service dimension in `Slot`, the per-(person, week, service) uniqueness constraint, the fixed `pools` dict (`owt_solver_v2.py:457-463`), `SERVICE_ROLES` (`:50-53`), the degradation weight names, and a Cloud Build redeploy. `VALID_PATTERNS` derives from `ROLE_ORDER` (`:60-65`) so the DSL follows free, and `build_history_offsets` tolerates absent role keys. **Explicitly warned off:** reusing the Saturday slot of a Saturday-less week would write `Sat.*` counts for a special and contradict E9. |
| **E11** | **`resolveToMemberName` is the resolver** (fact 13), exported for this purpose. `memberIdToName` must NOT be used for rule matching (fact 12) — it would match nobody. Both sides resolve into one space, and a rule naming nobody is **surfaced, not silently dropped**. |
| **E12** | **Specials count toward the local `load` signal.** Fact 20 means they currently do not, while fact 21 means they already light the strip — so today they are inconsistent. Making them count fixes the drift and gives E5 a signal to work with. This changes `computeParticipation`, which also feeds the participation sidebar; that consequence is accepted deliberately. |
| **E13** | **Conflicts are re-checked after any bulk fill**, not only at pick time. Fact 23: pick-time blocking cannot cover solver output, E5's greedy fill, or a rule edited after seating — the same reason `categoryDuplicatesForDate` exists. |
| **E14** | **"Together" means the same COLUMN**, matching the solver's per-(week, service) binding (fact 16). A Saturday and its adjacent Sunday are one week but two services, and a conflict does not span them. |
| **E15** | **`*.LeadBGV` applies to a special's Lead and BGV rows.** The solver expands it to weekend roles only (fact 17), so this is a local decision, not an inherited property. |

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

1. Widen `ServiceType` and thread `service_name` through `GridColumn` → `DraftCard` → `CreatableDraft` → `draftCreateBody` (facts 5, 6).
2. A special branch for `monthTargetPreflight`, keyed to something a special actually has (fact 7), plus `existingRoles` carrying `service_name`.
3. Fix `cellsToDrafts`' `${_type}__${date}` key so one special does not skip another (fact 8) — or make E3 structurally guarantee it cannot arise.
4. Export `resolveToMemberName`; pin it with a test using production-shaped data where **alias ≠ member_name** (facts 12, 13).
5. Decide and implement what a special contributes to `computeParticipation` and to `serviceWeekKey` (facts 20–22, E12).
6. `draftToDayCardProps` must not label a special "Domingo" (fact 26).

## Open questions

**O1 — Does rule enforcement extend to the Tablero?** Fact 25: `SeatBoard` cannot see the solver config, and fact 15 says the rules are per-browser localStorage anyway. So after E6 the planner grid refuses a pair the Tablero permits, and a second admin enforces a different rule set entirely. Options: leave it; thread the config into `ServicesPanel`; or move rules out of localStorage into Sanity so both surfaces — and both admins — read one source. **The third is the only one that makes "hard enforcement" true beyond one browser**, and it is the most work.
