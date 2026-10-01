# ADR-0048: The Saturday after the last Sunday belongs to its calendar month

**Date:** 2026-09-30 · **Status:** Accepted

> **Numbering.** ADR numbers follow the order records reach `main`. This is the next free number
> after [ADR-0047](0047-the-trailing-saturday-is-a-solver-week-with-no-sunday.md), which reaches
> `main` first with PR #121; renumber it if another record lands before it. This is delivery 2 of
> 3, the planner. It amends D16 of the planner-grid plan
> ([`2026-07-29-planner-grid.md`](../superpowers/plans/2026-07-29-planner-grid.md)). It builds on
> ADR-0047 (the solver half) and [ADR-0046](0046-auto-sends-no-fairness-history.md) (Auto sends no
> history). Specs:
> [`2026-09-29-planner-trailing-saturday-and-fill-empty-design.md`](../superpowers/specs/2026-09-29-planner-trailing-saturday-and-fill-empty-design.md)
> §2 (standard tier, approved by Frank 2026-09-29) and
> [`2026-09-29-solver-trailing-saturday-design.md`](../superpowers/specs/2026-09-29-solver-trailing-saturday-design.md)
> (critical tier). Plan:
> [`2026-09-30-planner-trailing-saturday.md`](../superpowers/plans/2026-09-30-planner-trailing-saturday.md).

## Context

Some months end on a Saturday whose Sunday is in the next month: Sat 31 Oct 2026 (Sun 1 Nov),
31 Jan and 28 Feb 2026, 31 Jul 2027. No month's Auto staffed that Saturday. D16 dropped the
positional Saturday fallback, so a Saturday got a solver week only if an in-month Sunday followed
it. This one had none, and the grid labelled it «Fuera del alcance de Auto». The next month's
planner offers only its own Saturdays.

October 2026 showed the cost. Its only Saturday service was the 31st, so the admin deselected
3/10/17/24 and the request sent no Saturday. Three saved `Sat.* == 1` minimums then made the whole
month infeasible, Sundays included. PR #116 responded by dropping Saturday minimums from any month
that sends no Saturday. Frank (2026-09-29): «Quiero que octubre lo trate como un sábado extra sin
domingo». ADR-0047 made the solver accept that Saturday as week `weeks + 1`. This record covers the
planner's half: when it sends that week, and what that does to Saturday minimums.

## Decision

1. **T1: one definition, amending D16.** `trailingSaturday(sundayDatesFull)` (`plannerModel.ts`)
   returns the last Sunday + 6 days if that date is still in the same month, and `null`
   otherwise. That date is solver week `weeks + 1`. `saturdayForWeek`, `weekForColumn` and
   `weekendWeekIndexes` all resolve it through this one function. The column, its seats
   (`applySolveResponse`), its unfilled markers (`mapUnfilledSeats`), its draft (`cellsToDrafts`)
   and its pins (`collectPins`) therefore always agree on its week.
   - D16's rule stands: no Saturday gets a week by position. But in a real month, the only
     Saturday with no Sunday after it now has a week by definition, so no in-month Saturday is
     unaddressable.
   - Removed: `unaddressableDates`, the «Fuera del alcance de Auto» badge, the confirm clause and
     the `PlannerGrid` prop.
   - `SolveResponse.schedule[w].Sunday` is now optional.
2. **The grid's rule context agrees.** `ruleContextForTarget` (`serviceRuleContext.ts`) used to
   judge a Saturday through the Sunday after it. That made the 31st November's week 1, over
   November's spine.
   - Now the trailing Saturday is judged in its own month: that month's spine, week `weeks + 1`,
     `owningSunday: null`. Every other Saturday is unchanged.
   - The manual picker, the seated-rule re-check and the move gate all read this context through
     `sundayDatesForColumn`. So a «Sem 5» rule blocks the 31st there, as it does in the solver.
3. **T2.** The trailing Saturday is preselected like every other Saturday. Deselected, it is not
   a candidate.
4. **T5: send it only if someone can lead it.** `trailingVerdict` tries every lead in the
   request's Sunday and Saturday lead pools (after the Tipo filter), using `saturdayAccess`. That
   is the one eligibility check, shared with T3.
   - A lead cannot take the Saturday if they are unavailable that day, or if a `!in` pattern or a
     week exclusion for `weeks + 1` covers `Sat.Lead`.
   - Every rule that names them counts, with names resolved as the request resolves them
     (`resolvedNameOrRaw`). Patterns expand through `rolesOfPattern`, which mirrors the solver's
     `expand_pattern` and is guarded by `patternRolesSync.test.ts`.
   - **A lead with no Saturday left cannot take it either (ruling Q17).** Take a maximum on a
     pattern that covers `Sat.Lead` (`Sat.*`, `Sat.Lead`, `*.Lead`, `*.*`, aliases included), with
     `==` or `<=` and its value resolved by `resolvedCapValue`. It is used up when that value is at
     most the number of OTHER sent Saturdays on which this lead is the only possible lead
     (`loneLeadsOf`, the lone-lead rule of decision 7). The solver's `mandatory_lead` puts them on
     each of those Saturdays, so leading the 31st as well would break the maximum and refuse the
     whole month, Sundays included. That happened in October 2026: Frank was away on the 24th and
     the 31st, Andy had `Sat.* == 1`, and the request sent `[4, 5]`. Main sent `[4]` and solved. A
     zero maximum bars the lead outright. Only the trailing Saturday is judged this way.
   - Q17 is a cheap pre-filter, not a guarantee: it misses some refusals (Consequences). Since
     ruling Q19, a refusal it misses costs one extra solve (decision 11), not the month.
   - If no lead can, `weeks + 1` is left out of `weekends_with_saturday` and the Sundays are
     still solved. `trailingNotice` says «El sábado 31 oct no se mandó al solver: ningún líder
     puede dirigirlo (no disponibles, excluidos o sin sábados libres en su regla). Llénalo a mano.»
   - If it is sent, each request member unavailable that day gets
     `<name> !in week <weeks+1> Sat.*`. Nothing is derived from the next month's Sunday.
5. **Q9: a withheld week sends no exclusions for itself.** When T5 withholds the 31st,
   `allRulesToDs` (through `withheldWeek`, read from T5's own verdict) drops the week exclusions
   that name `weeks + 1`. The solver refuses any rule that names a week the request does not
   have, which would refuse the whole month. T5 can withhold the week because of exactly such an
   exclusion, so without this drop that refusal would follow.

   The drop applies only then. A «Sem 5» exclusion in a four-Sunday month is still sent, and
   still refused with a 422, when the month has no trailing Saturday or the 31st is deselected.
   That is deliberate (see Rejected).
6. **T3: Saturday minimums are judged per person.** For each `isSaturdayFloor` cap, count the
   person's reachable Saturdays: the sent Saturdays where `saturdayAccess` lets them take a role
   in the cap's pattern (`Sat.Lead` also needs a lead pool).
   - If no Saturday is sent, every floor is omitted as `noSaturday`, with PR #116's sentence.
   - If a floor asks for more Saturdays than the person can reach, it is omitted as
     `unreachable`: «No se aplicó «X» a A y B: los sábados que Auto llena este mes no alcanzan
     para cumplirlo (por disponibilidad, exclusiones o rol).» This is judged for every floor,
     whether or not it is the person's first.
   - T3 runs in every month, not only in months with a trailing Saturday.
   - **Q16/Q18: one floor per person.** Only the person's first REACHABLE Saturday floor goes on
     to the seat check: the first that T3 lets through, in the rules card's order (config order,
     rule then cap), over every rule that names them. Every other reachable floor is omitted as
     `combined`, before any seat is counted: «No se aplicó «X» a A y B: Auto no combina dos
     mínimos de sábado de la misma persona.» A person whose first floor is `unreachable` still
     keeps the next one that can be met, and the notices say why for each floor (ruling Q18; test
     «Q16's order»).
7. **T4 / Q10: then check the floors against the seats.** `floorsFitSeats` asks whether every
   remaining floor can get a real seat.
   - The seats: each sent Saturday has 2 Lead and 3 BGV seats, one per person. `Sat.Lead` takes a
     Lead seat, `Sat.BGV` a BGV seat, `Sat.*` either, and only where `saturdayAccess` allows it.
     A floor of value v needs v different Saturdays.
   - The check is a max flow: source → person → (person, Saturday) → (Saturday, Lead or BGV) →
     sink. Any set it accepts comes with a real seat assignment.
   - It sees one floor per person (decision 6, Q16), and depends on that. Each floor is one
     person node, so one seat per person per Saturday holds only while nobody has two. For one
     floor per person the flow is exact. The latest re-verify (at `097d994d`) checked it two ways.
     An independent re-implementation matched it on 25,500 scenarios. And real-solver
     restorations found no false `capacity` in 2,529 and no false `unreachable` in 4,442.
   - If everything fits, nothing is left out. Otherwise the floors are sorted by the person's
     Saturday count in the history the request is built with (`historyForRequest`), fewest
     first, ties broken by the rule's name. Each floor is kept only if the kept set plus that
     floor still fits. The rest are omitted as `capacity`: «No caben todos los mínimos de sábado
     en los lugares de sábado de este mes, así que no se aplicó «X» a A.» Only a failed seat
     assignment is `capacity`, so that line never claims the seats ran out when they did not.
   - A Saturday's lone lead. The solver needs at least one Lead on every Saturday
     (`mandatory_lead`), and it seats a person once per Saturday. So when exactly one lead-pool
     member can lead a sent Saturday (`loneLeadsOf`, which T5 reads too), the seat model lets that
     member take only its Lead seat. This removes only what the solver already forbids. A lone
     lead whose floor is `Sat.BGV` is therefore `capacity`, as the solver refuses it.
   - Maximums always stay.
8. **Q2.** The history is `[]` under ADR-0046, so today T4's order is by name alone. No notice
   gives the history as a reason.
9. **Q1: a withheld Saturday is not a column Auto writes.** `collectPins` and `emptyVoiceSeats`
   receive the request's `weekends_with_saturday` and skip any Saturday whose week is not in it
   (`autoWrites`, `pinModel.ts`).
   - With «Solo llenar vacíos» on, a hand-filled 31st that T5 withheld is neither pinned nor
     refused. The confirm's count and the board's pin conflicts leave it out.
   - `MonthGenerator` gets that list from `buildSolveRequest` itself (`requestSaturdayWeeks`), so
     the preview and the request always agree.
   - `pinRefusal`'s Saturday-week refusal stays as the backstop.
10. **Notice order.** First the floors left out, one line per reason (`noSaturday`, then
    `unreachable`, then `combined`, then `capacity`), each naming the rules as the rules card names them
    (`capLabel`, via `omittedCapsNotices`). Then the trailing Saturday not sent
    (`trailingNotice`, for `noLead` or, on the retry, `infeasible`). Then delivery 3's notices.
    The floor lines and the trailing line also
    show when «Solo llenar vacíos» is refused before the fetch (`pinRefusal`), because they
    describe the request either way.
    **T6:** `{weeks-N}` still counts Sundays (ADR-0047 D2).
11. **Q19: if the solver refuses a month that sent the 31st, Auto solves it again without it.**
    T5 and the seat check predict only part of what sending week `weeks + 1` adds (see
    Consequences). Four review rounds each patched that prediction, and each next round found a
    new case. Frank chose a structural fix (2026-09-30), so the planner no longer has to be right.
    - **When.** The solver itself refused (a 422 the route did not tag `transport_error`) a
      request whose `weekends_with_saturday` names `weeks + 1`. `runSolve` (`MonthGenerator.tsx`)
      then rebuilds the request and solves once more. Both Auto paths go through it.
    - **Never on a transport failure.** The route tags every `ok: false` it makes when it could
      not get the solver's answer with `transport_error: true`: the service's HTTP status, the
      local timeout, a process that failed to start, no output, and output that is not JSON. The solver's own answers never
      carry it, and the client reads the flag, never the error text. A tagged failure, a non-422
      status, a thrown fetch and a request without the 31st are never retried. Nor is a retry.
    - **How.** `buildSolveRequest({ withholdTrailing: { detail } })`, where `detail` is the
      solver's reason. It goes through T5's own withhold path: `trailing` becomes
      `{ sent: false, reason: "infeasible", detail }`. So Q9 drops the week's exclusions (decision
      5), no availability rule names the 31st, and the floors are judged again on the Saturdays
      left. Deselecting the date would not do this: it keeps the week-5 exclusions, and the
      solver refuses them. When the request would not send the 31st anyway (none, deselected,
      T5's `noLead`), the input changes nothing, byte for byte.
    - **What the admin sees.** The retry's notices replace the first attempt's: its floor lines,
      then «El sábado 31 oct no se mandó al solver: con él, el mes no tenía solución (motivo del
      solver: …). Llénalo a mano.», then delivery 3's lines. The reason is the solver's error,
      trimmed, and the parenthesis is left out when it is empty. With «Solo llenar vacíos» on,
      the pins are collected again over the retry's weeks (Q1), so none names the 31st, and
      `pinRefusal` judges them again with the same exits.
    - **Auto stays locked for both solves.** The retry is awaited inside `runSolve`, under the
      caller's `autoPending`. The specials fill on every exit.
    - **A retry refused too** shows its own refusal through `solverRefusalMessage`, which is
      what main would have shown, and still shows its notices, the infeasible line included.
    - So the 31st never costs the month. The retry's request is the one this branch builds with
      the 31st deselected, minus that week's exclusions. The re-verify found no case where this
      branch's request without the 31st was refused and main's solved (October without the
      31st, and November).

**When a request stays byte-identical to before this change.** Both conditions must hold:
- no trailing Saturday is selected (the month has none, or it is deselected);
- no Saturday floor is omitted: each is reachable, and `floorsFitSeats` seats them all.

T3 and T4 run in every month, so any other month's request can change, but only by omitting
floors. Without pins, a floor omitted as `unreachable` or `capacity` is one the old request could
not meet: it made the month infeasible. The one exception is `combined` (decision 6, Q16/Q18).
It omits every reachable Saturday floor after a person's first reachable one, in every month,
and the solver may have met some of them. For example, `Sat.Lead >= 1` plus `Sat.BGV >= 1` can be met with two Saturdays
sent, and `Sat.* == 2` plus `Sat.Lead == 1` by one Lead and one BGV. Production has no
Saturday floors today, and the pending restore adds a single `Sat.* == 1` for each of three
people, so nobody loses one. A hand-written November 2026 request pins the identity
(`trailingSaturday.test.ts`).

`withholdTrailing` (Q19) adds no exception: it changes only a request that would have sent the
31st.

## Rejected

- **The solver spec's §9 list**, which ADR-0047 also carries:
  - a local greedy fill;
  - two solves («freeze and extend»);
  - a remap onto a deselected in-month Saturday;
  - folding the 31st into the next month's week 1. Frank chose the calendar month. The grid's
    rule context did exactly this until decision 2;
  - a client-side virtual week that discards a phantom Sunday. D16 removed exactly this.

  Q19's retry is not «freeze and extend». It never solves the 31st on top of a frozen month: a
  second solve runs only after a refusal, and it leaves the 31st out.
- **A fifth predictive patch** (instead of Q19). Rulings Q16, Q17 and Q18 each closed the case
  the previous review found, and the next review found another. The re-verify's 124 refusals
  were mostly things no planner-side check models: `sat_anchor` alone was 71. A retry makes the
  prediction optional; Q17 stays only as a pre-filter that saves the extra solve.
- **Retrying on any `ok: false`, or matching the error text.** A transport failure says nothing
  about the 31st, and a second call would only double the wait. The route knows which failures
  are its own, so it tags them (`transport_error`). The client never parses the solver's
  English.
- **Dropping every week exclusion above `weeks`** (Q9's wide option). It would remove the «Sem 5»
  422 for months with no trailing Saturday.
  - It would also change requests in those months, which breaks the identity above.
  - And it would silently throw away a rule the admin wrote for a week the month does not have.
    The solver's refusal names that rule after «Motivo del solver:» («DSL week exclusion
    references week 5, but the month has 4 Sundays: '…'»), which shows the admin what to fix.
  - This is also how it behaved before this change.
- **A pooled seat count** (the first T4 commit, replaced under Q10). It checked Lead floors
  against 2 Lead seats per Saturday sent, BGV floors against 3, and `Sat.*` against the total
  of 5. It accepted sets the solver cannot seat:
  - Crediting `Sat.*` to the total let non-leads use Lead seats. One lead and four support
    members with `Sat.* == 1` on the 31st passed, but that Saturday has only three BGV seats.
  - Pooling across the month let a floor use another Saturday's seats. With the 24th and the
    31st sent and four support members who can reach only the 31st, it passed.
  - Both cases are now tests, «Failure A» and «Failure B».
- **Merging one person's floors by their largest value whatever their operator** (the first
  Q10 commit). It reported a fit for sets the solver refuses. With the 24th and the 31st sent,
  Pau (`Sat.* == 2` plus `Sat.Lead == 1`) was seated Lead twice, while her rule needs one Lead and
  one BGV and the BGV seats were full. The request came back `[]` and the solver answered
  `ok: false`. Fix round 2 made the merge refuse an `==` floor below the largest value (test
  «I-A»); Q16 then removed merging altogether (below).
- **Calling an unmergeable floor `capacity`.** The seats had not run out, and the solver proved
  November 2026 solvable with both of a person's `Sat.Lead >= 1` and `Sat.BGV >= 1`. It is
  `combined`, with a line that names the model's limit instead (ruling Q14).
- **Merging one person's floors at all** (`mergeFloors`, rulings Q10 and Q14; removed by Q16).
  Three review rounds in a row each found a defect in the merge, while single-floor checking was
  exact. The last defect: in November 2026, with the 21st and the 28th sent, Ana had
  `Sat.* >= 2` plus `Sat.Lead >= 1`, merged into two Lead seats. With Beto's and Caro's
  `Sat.Lead >= 1` the four Lead seats were full, so Dani's `Sat.Lead >= 1` was dropped as
  `capacity`. That was false: main kept all four and the solver seated them, with Ana on BGV one
  Saturday. The same happened with `==` floors. The fix was to remove the method, not to patch it
  a fourth time. A person's other reachable floors are `combined`, and the flow only ever sees one
  floor per person (test «the final review's I1»).
- **A second copy of T5 for the board preview.** It could drift from the request.
  `requestSaturdayWeeks` reads the verdict from `buildSolveRequest` instead.
- **A Sunday as the 31st's `owningSunday`.** 1 Nov belongs to the next month, which spec §2.2
  forbids. 25 Oct belongs to the previous week, and would invite readers to treat it as the 31st's
  weekend. So it is `null`.

## Consequences

- **Known limits, outside the seat model, and what they cost now.** T5 and the seat check are
  advisory, and the solver stays the authority. They do not model the items below. Before Q19,
  each could make the solver refuse a month that sent the 31st, Sundays included, where main
  solved it. Now that refusal makes Auto solve again without the 31st (decision 11). Each limit
  costs one extra solve and a 31st filled by hand, never the month. A month that does not send
  the 31st is refused as it was before this change, with the solver's reason.
  - **The dedicated Saturday-lead anchor** (`sat_anchor`). The solver wants a dedicated Saturday
    lead on every Saturday that has one available. Neither T5 nor the seat model holds a Lead
    seat back for them.
  - **Rows grown by pins.** `buildSolveRequest` never sees the pins. Rows that pins grow
    (ADR-0041), and seats that pins take, are not in the seat count. Under pins the count rules
    are soft anyway.
  - **The solver's rule of at least one Lead per Saturday** (`mandatory_lead`), except for a
    lone lead. The seat model keeps a Saturday's only possible lead in its Lead seat (decision
    7). It does not see two or more leads who could lead a Saturday but whose floors all push
    them onto BGV.
  - **Maximums.** T3 and the seat model do not read maximums. The upper side of an `==` floor,
    or a `<=` (zero included), combined with `mandatory_lead` is the solver's to refuse. Only T5
    reads maximums, and only for the 31st (decision 4, Q17). It errs both ways:
    - Towards sending the 31st, and so towards a refusal: it counts only the other Saturdays a
      lead is forced to lead as their lone lead. It does not count the Sunday seats that a
      `*.Lead`, `Lead.*` or `*.*` maximum also covers. Nor does it see several leads sharing too
      few Saturdays between them (a pigeonhole). The retry catches both.
    - Towards withholding it: it reads every maximum in the config, including that of an `==`
      floor the request later omits.

  The latest re-verify (at `097d994d`) ran the real solver on planner-built requests and found
  124 setups where this branch's request was refused and main's solved. Every one had sent the
  31st. Its mechanism counts were: `sat_anchor` 71; a self-contradictory rule (a kept floor above
  the same person's maximum) 43; floors pushing every possible lead of the 31st onto BGV 2;
  floors plus a lead barred by a maximum 4; a `*.Lead`/`Lead.*`/`*.*` maximum used up by Sundays
  9; a Saturday maximum used up without a lone lead (a pigeonhole) 4; other 1. Under Q19 each is
  a retry. The restore shape is one of them: Andy and Tay are Sunday leads with `Sat.* == 1`,
  Vale is support with `Sat.* == 1`, Frank is away on the 17th, 24th and 31st, and all three are
  selected. Two leads cannot cover three Saturdays, so the solver refuses `[3, 4, 5]`. The
  retry's `[3, 4]` solves.

  So the code promises «never seat-infeasible», not «never solver-infeasible». Auto promises
  that the 31st never costs the month.
- **The preview still counts a 31st the retry withheld.** `requestSaturdayWeeks` previews the
  FIRST request (Q17 included, no retry). So after a retry, the confirm's empty-seat count and the
  board's pin marks still treat the 31st as Auto's. The next Auto sends it again and pays the
  extra solve again. This is deliberate: the preview cannot know the solver's answer.
- **The preview can count a withheld 31st.** `requestSaturdayWeeks` is `undefined`, meaning no
  filter, when there are no rules yet or the request would be refused before it is sent (no
  Sunday lead, or a rule blocked by Tipo). In that state the confirm's count and the board treat
  a withheld 31st as Auto's. Auto sends nothing then.
- **The participation sidebar still pairs the 31st with 1 Nov.** `computeParticipation`'s
  `serviceWeekKey` groups the 31st's instrument and FOH load with Sun 1 Nov. That is a
  calendar-weekend key for the sidebar, not a solver week.
- **Stored-mode rule checks move.** On a hand-made trailing Saturday they now use this month's
  week `weeks + 1`, not the next month's week 1.
- **MCP P4 still needs its amendment.** The P4 plan reuses `ruleContextForTarget(…)?.sundayDates`,
  so it inherits decision 2. It also mirrors `unaddressableDates`, which no longer exists. The
  amendment that planner spec §5 asks for is still owed before P4 is implemented.
- **Release order.** Delivery 1 must be deployed, and pass its deploy check, before this reaches
  `main`. An old solver refuses `weeks + 1` with `ok: false` («weekends_w_sat must use 1-based
  indexes 1..4. Received [5].»). That is the solver's own answer, so since Q19 Auto retries
  without the 31st: the month solves, and the infeasible line under Auto quotes that reason.
  The failure is never silent, but it no longer looks like a refused month, so the deploy check
  is what proves delivery 1 is live. Roll back the planner first.
- **Undoing parts of this.** Undo T1 and no month's Auto staffs the Saturday again. Undo T3/T4
  and one person's unreachable minimum sinks the month again. Undo Q19 and every limit above can
  sink a month that sends the 31st again. Whether to restore October's three
  `Sat.* == 1` minimums is Frank's call.
