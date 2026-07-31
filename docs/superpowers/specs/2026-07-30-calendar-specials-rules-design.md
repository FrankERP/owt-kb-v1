# Calendar month picker, special services, and local rule enforcement

**Status:** design, not yet planned. Successor to the C · Planificador work merged to `preview`.

**Goal.** Three changes to the month generator, decided together because they share one mechanism:

1. **Calendar-first date picking** — the month as a real calendar; tap the days to generate, instead of a `Sábados` checkbox plus date pills.
2. **Special services on any day** — tap a weekday to add a `special_role` with a name.
3. **Local enforcement of the solver's hard rules** — pairwise conflicts, person exclusions and week exclusions applied in the grid's own candidate ranking, on specials *and* on the weekend grid.

---

## Load-bearing facts

Verified against source. Breaking any is a regression, not a UI change.

**Special services are already first-class in the write path**
1. `special_role` is in `ALLOWED_TYPES` on the create route (`app/api/admin/roles/route.ts:119`) and in the read model (`serviceReadModel.ts:10`, `:53`, `:74`, `:303`, `:406`).
2. Specials store **`date`**; the weekend types store `week` (`roleWriteRequest.ts:173`, `:186`).
3. Specials carry `service_name` (`roleWriteRequest.ts:215`, `:238`).
4. **Specials have no weekend lock** — the deterministic lock id is null for them (`roleWriteRequest.ts:255`), and their target identity is `canonical.targetIdentity` rather than `${roleType}:${date}` (`:281`). So a special can never contend with a Sunday or Saturday target.

**But the preflight does not know about them**
5. `monthTargetPreflight` is typed `type: "sunday_role" | "saturday_role"` (`serviceCardModel.ts:1183`) and its body is built on the weekend target key and lock. `MonthGenerator`'s `preflight` prop is typed `(type: ServiceType, date: string)` (`:62`) — the signature admits specials, the implementation does not.
6. `handleConfirm` only posts targets whose preflight says `creatable`. **A special column would therefore render and never create, silently** — the failure mode this project keeps producing.

**The solver cannot take specials, and the reason is structural**
7. `ROLE_ORDER` is five hard-coded voice role types (`gcf/owt_solver_v2.py:37`); `SUNDAY_SERVICE` / `SATURDAY_SERVICE` are two string constants (`:66-67`).
8. `build_slots` walks `week in range(1, weeks+1)` emitting one Sunday and an optional Saturday (`:547-561`). The model is **week × {Sunday, Saturday}**; a special is an arbitrary date with no week.
9. `VALID_PATTERNS` is *derived* from `ROLE_ORDER` (`:60-65`), so adding role names would extend the DSL for free — the role vocabulary is the cheap part. Reshaping services from a fixed pair into a list per week is not.
10. One slot per person per service per week is written per `(person, week, service)` (`:754-764`).

**The rules, as data**
11. `ConflictRule { id; personA; personB; pattern }`; `PersonRestriction { id; person; excludedPatterns; fairness: "none"|"exempt"|"slack"; fairnessSlack; weekExclusions: {week, pattern}[]; caps }`; `PresenceRule { id; persons; pattern }` (`MonthGenerator.tsx:75-100`).
12. **Rules identify people by NAME**, matching the solver (`gcf/owt_solver_v2.py:454`). The grid works in member ids; `memberIdToName` (`plannerModel.ts`) is the single existing resolver and must be reused.
13. All five seeded conflict rules use `*` for the service half — `*.LeadBGV`, `*.Lead`, `*.BGV` (`MonthGenerator.tsx:199-205`). They therefore apply to a special by construction; a rule scoped `Sun.*` would not.
14. Frank and Mkz are `fairness_exempt`; Gaby is `fairness_slack 1` (`MonthGenerator.tsx:122-141`).

**The ranker today**
15. `rankCandidates` (`candidateRanking.ts`) knows availability, same-category double-duty, and recent load. It knows **nothing** about conflicts, exclusions or fairness rules. It sorts by `load` ascending (`:156`).
16. `SeatBoard` — the single-service editor already in production — is rendered from `ServicesPanel`, which has **no access to the solver config**. The rules live in `MonthGenerator`.

---

## Decisions

| # | Decision |
|---|---|
| **E1** | **The calendar is the date picker.** The month renders as a calendar; Sundays and Saturdays are selectable by default. This replaces the `Domingos` / `Sábados` checkboxes and the date pills. |
| **E2** | **Any other day can become a special service.** Tapping a weekday prompts for a `service_name` and adds a `special_role` column. |
| **E3** | **Specials are never sent to the solver.** Fact 8: the solver's model is week × {Sunday, Saturday}, and a special has no week. Auto skips special columns entirely, with the same persistent "asignación manual" marker instrument rows already carry. |
| **E4** | **Specials are auto-filled by the LOCAL ranker**, on the same press as Auto but as a clearly distinct mechanism, labelled as such. It respects availability, recent load, same-category double-duty, and the hard rules of E5. |
| **E5** | **The ranker enforces the solver's hard rules, as HARD blocks:** pairwise conflicts, person exclusions (`excludedPatterns`), and week exclusions. A blocked candidate is shown, disabled, with the rule named — never hidden. Chosen over a soft warning because the ranker sorts by ascending load, so the people a rule most often protects sit at the top of every list and a soft block would keep steering into them. |
| **E6** | **The ranker respects `fairness_exempt` and `fairness_slack` in its SORT** (not as blocks). Fact 14: the three people most affected are marked precisely because raw load is the wrong signal for them; a ranker that ignores it pushes them forward on every seat of every date. |
| **E7** | **E5 applies to the weekend grid too, not only specials.** Today a manual pick can seat two people a conflict rule forbids, which the solver would never have done. |
| **E8** | **Specials get their own preflight branch.** Fact 5-6: without one they render and never create. Having no weekend lock (fact 4), their creatability question is only "does this special already exist?" — see O1. |
| **E9** | **Fairness history ignores specials.** The solver's `role_counts` vocabulary has no slot for them (fact 7), and inventing one would corrupt entries the solver reads back at weight 10. |

---

## Rule matching, precisely

The DSL pattern vocabulary is `<Service>.<Role>` with `*` on either half (fact 9). The grid must map a `(row, column)` to the same pattern space:

| Grid | Pattern |
|---|---|
| `lead` on a Sunday column | `Sun.Lead` |
| `bgv` on a Saturday column | `Sat.BGV` |
| `coro` on a Sunday column | `Sun.Choir` |
| any voice row on a **special** column | service half matches only `*` |
| instrument / FOH rows | **no pattern** — outside the solver's vocabulary entirely; rules never apply |

A rule matches when both halves match, with `*` matching anything. `*.LeadBGV` matches `Lead` and `BGV` but not `Choir` (fact 9's `LEAD_BGV_ROLES`).

**A rule naming an unresolvable person is a no-op locally.** The solver raises on an unknown name (fact 12); the grid must not. It should surface the unmatched name rather than fail — silently dropping a rule is how a conflict gets seated.

---

## Non-goals — stated so they cannot look covered

- **`any_of(...) each_week` presence rules are NOT enforced locally.** They are a property of a whole week, not of one cell.
- **Count caps are NOT fully enforced.** A greedy filler can count as it goes but cannot backtrack once it has overshot. Partial enforcement that looks total is worse than none; the UI must not imply caps are honoured.
- **Global fairness optimisation is approximated, not solved.** The ranker is greedy per column, ordered by load. It is not CP-SAT.
- **The solver is not modified.** No new role types, no new service shape, no redeploy.

---

## Open questions

**O1 — Can two specials share a date?** This defines E8's preflight. The weekend types are one-per-date by construction; specials are keyed by identity, not date (fact 4), so nothing stops two. If yes, the duplicate check must be name-based and the calendar must show a date holding more than one. If no, date alone is the key and the calendar stays simple.

**O2 — Does E7's enforcement extend to the Tablero?** The conflict rules live in the solver config, which `MonthGenerator` owns; `SeatBoard` cannot see them (fact 16). After E7, the planner grid refuses a pair the Tablero still permits — same data, two rules, depending on the screen. Three options: leave it; thread the config into `ServicesPanel`; or move the rules out of the solver config into a place both surfaces read. The third is cleanest and the most work.

**O3 — What does a special contribute to the load signal?** E9 keeps specials out of *solver* history. But `rankCandidates`' `load` comes from `computeParticipation` over stored roles, which counts every role type. So a special someone served would raise their local load while being invisible to the solver — arguably correct (they did serve) but worth stating rather than discovering.

**O4 — Do specials need instrument and FOH rows?** They are services like any other, so presumably yes. Confirm, since it affects the grid's row model for special columns.
