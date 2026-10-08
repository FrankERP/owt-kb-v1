# Solver, Scripts & Infrastructure

Covers the OR-Tools scheduling solver, its CI/CD, the `scripts/` toolbox, mobile/Capacitor, and
the test setup.

---

## 1. The scheduling solver (`gcf/`)

A Python 3.12 + **OR-Tools CP-SAT** constraint solver deployed as a **Gen-2 Google Cloud
Function** named `owt-solver`. It builds a **fair monthly worship-team roster**.

Files: [`gcf/main.py`](../gcf/main.py) (HTTP handler), [`gcf/owt_solver_v2.py`](../gcf/owt_solver_v2.py)
(the solver, ~1300 lines, the single source of truth), `requirements.txt`, `.gcloudignore`,
`test_main.py`, `test_owt_solver_v2.py`.

### What it optimizes
Per month (3–6 weeks), it assigns people to service seats:
- **Sunday** every week: `Sun.Lead` ×2, `Sun.BGV` ×3, `Sun.Choir` ×3.
- **Saturday** on selected weeks only: `Sat.Lead` ×2, `Sat.BGV` ×3. The selection may include
  the Saturday after the last Sunday, which has no Sunday of its own (see below).

### Input / output (JSON)
Entry point `solve_from_dict(data)`. Input keys: `weeks`, `weekends_with_saturday`,
`sunday_leads`/`saturday_leads`/`support` (mutually-exclusive name pools), `dsl_rules` (see
below), `history` (prior months, oldest first), `seed`, and solver knobs
(`solver_max_time_seconds`, `solver_num_search_workers`, `solver_total_budget_seconds`,
`discourage_consecutive`), and optionally `pinned` — seats already on the board that the solver
must keep, `[{week, role, person}]`, at most 100 (see *Pinned assignments* below).

Output: `{ ok, schedule: {"<week>": {Sunday?:{Lead[],BGV[],Choir[]}, Saturday?:{...}}},
fairness_relaxed, sun_lead_fairness_relaxed, sun_bgv_fairness_relaxed,
objective_skipped, history_runs_used,
total_counts, role_counts, unfilled_seats[], pinned_honored, pin_violations[],
violation_ceiling_proven? }`. On error: `{ ok: false, error }`.

- **`transport_error`** — never set by the solver. `POST /api/admin/solve` adds
  `transport_error: true` to every `ok: false` it makes itself, when it could not get the solver's
  answer: the service's HTTP status, the local timeout, a process that failed to start, no
  output, or output that is not JSON. The solver's own answers, refusals included, pass through
  without it. Auto reads it to decide whether a refusal may be retried without the trailing
  Saturday (ruling Q19, «Before the request leaves the planner»); it never matches error text.

- **`pinned_honored`** — how many pins the returned schedule actually holds, derived from the
  solved assignment and never echoed. Emitted on **every** response, `0` without pins: its
  presence is how the client (and the deploy check below) tells this solver from one that
  silently ignores `pinned`. It can never come back short — a pin is a hard `== 1` — so the
  signal is the field's presence, not its value.
- **`pin_violations`** — the rules set aside to honour the pins, one entry per relaxed
  instance, in a normative grammar the client parses: `<person>: <source>` (count rule),
  `W<n>: <source>` (weekly presence), `W<n> <Sun|Sat>: <source>` (pair), `W<n>-<n+1> <person>:
  <source>` (consecutive), `builtin:mandatory_lead:W<n>:<Sun|Sat>`, `builtin:sat_anchor:W<n>`.
  `<person>` comes from the parsed rule, because `source` is the `&`-split clause and loses the
  name on every clause after the first. `[]` without pins.
- **`violation_ceiling_proven`** — `true` iff the violation-only solve proved its minimum, i.e.
  the relaxations are exactly as many as the pins force. **Absent** on a pinless request.
- **The trailing Saturday — `weekends_with_saturday` may name `weeks + 1`** (spec
  `2026-09-29-solver-trailing-saturday-design.md`, ADR-0047). It is the month-end Saturday whose
  Sunday falls in the next month (31 Oct 2026). `weeks` keeps its meaning — the number of Sundays,
  `3..6` — and `weeks + 1` is the ONLY index above it that is accepted. The week is a real week of
  the same model with a Saturday service and **no Sunday one**: `schedule["<weeks+1>"]` holds
  `Saturday` alone (`Lead` ×2, `BGV` ×3, grown by pins) and no `Sunday` key; `unfilled_seats` read
  `W5 Saturday Sat.Lead #1` (the existing format); `total_counts`/`role_counts` include it.
  Every per-week rule binds it — the mandatory lead, pair rules, weekly presence, consecutive rules
  (against the last Sunday's week, `W4-5 <person>: <source>` under pins), one seat per service, week
  exclusions and the Saturday-lead anchor — and a `Sat.* == 1` minimum can be met by it alone, while
  `{weeks-N}` still counts the Sundays. **Refusals** (`ValueError` → `ok: false` → 422): `weeks + 2` or more
  («weekends_w_sat must use 1-based indexes 1..5: 4 Sundays, and 5 = the Saturday after the last
  one. Received [6].»); a week exclusion or a pin naming `weeks + 1` when `weekends_with_saturday`
  does not; a Sunday-role pin in it («which has no Sunday service»). An **infeasible** request that
  does name it (a `RuntimeError` from `diagnose_infeasibility`, also `ok: false` → 422) carries one
  extra diagnostic line suggesting it be deselected; the `ValueError` refusals above do not.
  Auto now acts on any such refusal itself: it solves again without the week (ADR-0048,
  decision 11).
  **A request that does not name it
  builds the model it built before, byte for byte** — frozen by `gcf/test_inertness.py`
  (`docs/CI.md`). **The planner sends `weeks + 1`** when the trailing Saturday is selected and some
  lead can take it (see «Before the request leaves the planner», ADR-0048).

Also a **CLI mode**: `echo '<json>' | python3 owt_solver_v2.py --json-mode` (stdin→stdout);
no-args runs a built-in demo roster.

### The DSL (constraint language)
Parsed by `parse_dsl_rules()`; clauses `&`-chainable. Forms include:
- `<name> !in <pattern>` — forbid a person from a role class.
- `!in week <n> <pattern>` — week-specific absence. `n` may be `weeks + 1` only when the request
  names the trailing Saturday; otherwise it is refused.
- `<name> <pattern> ==|>=|<= <n>` — count rule.
- `<A> !with <B> on <pattern>` — pair-exclusion (not same week/service).
- `any_of(A,B,...) on <pattern> each_week` — weekly-presence requirement.
- `<name> !consecutive on <pattern>` — hard no-back-to-back.
- `<name> fairness_exempt` / `fairness_slack <n>` (+ `on <pattern>` role-scoped variants).
  **The bare forms are GLOBAL only** — the only forms the planner emits («Exenta» / «Holgura»).
  They take the person out of the month's total-load band (`gmax − gmin`) and the global soft
  term, nothing else: the `Sun.Lead` and `Sun.BGV` bands read only the role-scoped
  `fairness_exempt on <pattern>`, and every per-role objective spread counts everyone eligible.
  So an «Exenta» Sunday leader still competes for Sunday-lead fairness — which is the intent for
  lead-only members who play an instrument every week (confirmed 2026-09-29): lead constantly, never BGV or
  Coro (that is their `!in` patterns, not the fairness mode). **An exact count leaves the band:**
  a person with `== N` on a single role (`Sun.Lead == 2`) is outside that role's Sun.Lead/Sun.BGV
  band (ADR-0046) — their count is decided by the rule, and inside the band a fixed 2 let anyone
  lead twice. A `>=` floor stays in the band. Slack also drops the person from
  the global soft pull, not just widens their band; absence slack (`compute_absence_slack`) adds
  on top of it; and if fewer than two people are left without slack, every non-exempt person
  goes back into the strict band and the slack is ignored. The same restriction also drives
  the specials filler, which reads it differently: exempt ranks at the median load, slack N as
  `load + N` (`orderByEffectiveLoad`, `localFill.ts`). A slack of 0 is no rule in either.

Patterns: exact roles, `Sun.*`, `Sat.*`, `*.*`, `*.LeadBGV`, `*.Lead/BGV/Choir`, plus legacy
aliases. Templates like `{weeks-2}` resolve against `weeks`, the number of Sundays — the trailing
Saturday (`weeks + 1`) does not count (D2). Names match case-insensitively.

### Key behaviors (these are documented invariants — see the memory notes)
- **Graceful seat degradation:** BGV, Choir, and even the **2nd** Lead seat are optional; only
  **one Lead per service is mandatory**. Unfilled seats carry tiered penalties
  (`Choir=1 < BGV < Lead`) so under tight availability the solver empties **Choir → BGV → 2nd
  Lead**, never the last Lead. Empties surface in `unfilled_seats`.
- **Two-stage solve:** Stage A minimizes only empty seats (ignoring fairness) and records
  `empty_target`; if infeasible, `diagnose_infeasibility()` names the exact week/service with no
  available lead (an **honest** diagnostic, not an opaque failure). Stage B locks
  `weighted_empty <= empty_target` and loops over tightening fairness tiers, returning the first
  feasible result; a wall-clock budget bounds total time (returns the max-fill solution rather
  than timing out). The loops nest Sun.Lead spread 1→2 (outermost), Sun.BGV **1→3**, global
  1→2 (innermost), so **global relaxes first and Sun.Lead last** — Sun.Lead fairness is the
  highest priority. **When every Stage B pass is infeasible the month comes back from Stage A** —
  max-fill with no fairness band at all, all three `*_relaxed` flags up — so a missing ladder
  level is not "a bit less fair", it is no fairness. Sun.BGV reached only 2 until 2026-09-29,
  and a five-Sunday month can force 3: `any_of(A,B) on Sun.BGV each_week` + `A !with B on *.BGV`
  seats exactly one of the pair every week (one carries ≥3) while more BGV-eligible people than
  the month's BGV seats (15 on five Sundays) leaves someone at 0. Production's real November
  2026 request hit it on every run (leads up to 5 of 5 Sundays for one person); with level 3 it
  holds Sun.Lead at 1. **Level 3 also reaches months of any length that used to land at Sun.Lead
  2 only because Sun.BGV stopped at 2:** they now return at Sun.Lead 1 / Sun.BGV 3, and their
  global band may widen to 2 — the ladder's existing priority, one rung further (someone leading
  twice while others lead none is what the priority exists to prevent). October's request, which
  lands at Sun.BGV 2 either way, returns exactly as before (+~0.06 s). Guards:
  `SunBgvLadderReachesThree`.
- **Absence-aware fairness:** `compute_absence_slack()` gives fairness slack proportional to how
  many full services a person is unavailable for, so legitimately-away people aren't flagged as
  under-served. History uses weighted decay (3 recent months weighted `[10, 6, 3]`).
- **Lexicographic objective:** exponentially-separated weights encode strict priority
  (fill > lead fairness > per-role spread > sun-lead rotation > consecutive-repeat
  penalty > random tie-break). **Each tier's weight is computed against that tier's own
  maximum**, not against a single month-wide bound — the ladder is a product over eight
  tiers, so a uniform over-estimate is exponential in it and the objective's upper bound
  crossed CP-SAT's integer-objective ceiling (INT64_MAX / 2) on ordinary months. Months
  whose history still pushes it over run without the objective and say so with
  `objective_skipped: true` — see ADR-0038 for that trade-off. **Since 2026-09-30 the planner
  sends no history** (`SOLVER_SENDS_HISTORY = false`, ADR-0046), so the ladder fits and the
  objective runs; what follows describes a history-bearing request (the rollback, or a direct
  caller). **With history, expect it routinely.** Whether a month overflows depends on the SIZE of its weighted history (the
  `[3, 6, 10]` offsets feed `overall_limit` and every per-role cap), not only on the derived
  history always sending three months; a thin quarter can still optimise. But the real
  October 2026 request — a full roster, three derived months — came back `objective_skipped`
  on every run of an offline reproduction (2026-09-29, 240 runs, the pinned ortools), and its
  weight ladder bounds at ~4.9e19 against the 4.6e18 ceiling. Such a roster is a legal but
  arbitrary draw — history, lead rotation and the back-to-back penalty do nothing. The planner
  shows it (since 2026-09-29) as «Sin optimizar», marks the «Historial» line «(no aplicado)»
  and says so in a sentence under the banners. Lead rotation uses seeded random weights on Sun.Lead
  assignments (monthly and per-week terms). The planner UI surfaces, separately for
  Sunday and Saturday, which lead-pool members did not hold that lead role in the
  calendar month before the month being planned (`LeadPoolHistoryPanel`); that is
  visibility only and does not change the objective. The pool ids are filtered by
  live «Tipo» first, the same rule `buildSolveRequest` applies, so a stale tick
  cannot present an unschedulable member as an available lead (ADR-0029).
- **The history is derived from the stored services, not read from the browser (MCP P2 cutover,
  2026-09-28 — ADR-0042).** A server-side derivation over canonical `sunday_role`/`saturday_role`
  documents (`app/utils/solverHistory.ts`'s `deriveSolverHistory`, loaded by
  `app/utils/solverHistoryRead.ts`'s `loadSolverHistory` and exposed at
  `GET /api/admin/solver-history` — see [API_REFERENCE.md](API_REFERENCE.md#solver)) produces
  the same entry shape the browser history used to, and the deployment-wide constant
  `SOLVER_HISTORY_SOURCE` (`app/components/admin/solverHistorySource.ts`) is `"derived"`.
  **Since 2026-09-30 Auto sends none of it** (`SOLVER_SENDS_HISTORY = false`, ADR-0046): the
  derivation still draws the Historial block and the lead-pool panel, but the solve gets
  `history: []`, makes no read of its own and never refuses over a failed read. The first two
  properties below hold only when that switch is `true` (the rollback). Three properties to
  hold together:
  - **Derived for the target month at solve time, never cached across a solve.** The planner
    loads the three months before the month on screen to draw the Historial block and the
    lead-pool panel, but **every Auto re-reads the history for its own month** — never the
    display's copy, and the `cells`/`config` it solves with are read after that await. A month
    switched to mid-read cannot leak another month's history into a solve.
  - **A failed read is said, never an empty history.** Auto refuses before solving («No se pudo
    leer el historial de equidad. Auto no corrió; reintenta.»), the specials still fill (E5),
    and the lead-pool panel shows the failure and «Reintentar» instead of listing every leader
    as «sin Lead».
  - **The Historial chips are read-only.** The history is a fact about the stored services, so
    there is no manual month exclusion (no ×) any more; a window month with no services is
    marked «· sin servicios», and the diagnostics (seats pointing at deleted members, repeated
    names, duplicate services on a date) are always shown.

  With history sent, every admin solves against the same history, which closes the two-admins
  gap ADR-0010 left open (with none sent there is no history to disagree about). `owt_solver_history_v2` in `localStorage` is still **written** on each confirm (R15's
  rollback target) and never read; rolling back is flipping the constant to `"local"`, until
  the dual-write is removed (D3, after Gate D). See [DATA_MODEL.md](DATA_MODEL.md),
  [ADR-0042](adr/0042-the-fairness-history-is-derived-from-stored-services.md) and
  `docs/superpowers/specs/2026-09-23-solver-history-derivation-design.md`.

### Pinned assignments (`pinned`)
Spec `docs/superpowers/specs/2026-09-15-solver-pinned-assignments-design.md`, decision record
ADR-0041. The planner sends pins when «Solo llenar vacíos» is on — see «Before the request leaves the planner».

- **A pin is a fixed variable, not a removed seat:** `sum(x[P, slots of (R, W)]) == 1`. Every
  mechanism that counts people or iterates slots — totals, role counts, DSL caps, the Saturday
  anchor, presence, `filled`, occupancy, the consecutive penalty, the response view — sees it
  with no restated offsets.
- **Four enabling changes.** Candidacy is granted only in the pin's own (role, week), appended
  after the shuffled eligibles, so a pinned person in no pool (or with a cleared Tipo) gains
  nothing else. Rows grow to `max(default, pins)` and never shrink, keeping the `Sun.BGV`/
  `Sun.Choir` interleave. Pinned-only names join `all_people` **after** `pools` is built and stay
  out of `strict`, `relaxed` and the collapse rebuild. Each person gets slack equal to their pin
  count on the three **hard** spreads — the global one, and for `Sun.Lead`/`Sun.BGV` their pins
  in the Sunday **service** (not the role, which collapsed the month for lead-pool members).
- **Rules go soft under pins, per instance.** With any pin, the six families a pin can
  contradict — mandatory lead, Saturday anchor, weekly presence, pair, consecutive, DSL count —
  each get one boolean per instance (per week, per service where the rule has one; one per rule
  for counts, which are month totals). A week exclusion is not relaxed but scoped: it is skipped
  on the pinned row only. `!in <pattern>` and pool membership need nothing — the pin grants
  candidacy.
- **Solve 0 fixes the count first.** Order: solve 0 minimises the violation count alone, with
  nothing inherited → Stage A minimises `(max_weighted_empty + 1)·n_viol + weighted_empty` →
  the Stage B ladder. **Every stage after solve 0 carries `n_viol <= violation_target` as a
  constraint**, the `stage_a` fall-through included, so no stage buys fill or fairness with one
  more broken rule — ADR-0010's requirement holds as "the number of rules set aside is never
  increased for fairness". Which instance gives among equal-size sets is still Stage B's choice.
  Stage A's own count also caps Stage B whenever it is lower — which covers solve 0 finding
  nothing in time (then Stage A runs uncapped, but no Stage B pass can exceed what Stage A
  found) and a slack `FEASIBLE` solve 0. `violation_ceiling_proven` reports solve 0 alone.
  Stage A starts from solve 0's month as a search hint, so a board with dozens of pinned people
  in one row returns a month where it used to time out into the mandatory-lead diagnostic. It is
  a hint, not a guarantee: Stage A still needs its presolve (~0.2 s on a MacBook for 64 such pins),
  so a slow enough container can still time out, and that path still reports "infeasible".
  Measured 2026-09-25 (MacBook, 1 worker, 5 s cap — a laptop number): solve 0 was `OPTIMAL` on
  every §7 case × 3 seeds, including a 52-pin full board and 30 pins on 12 people, in 4–6 ms.
- **The report is read from the assignment, never from the booleans**, which are
  one-directional and may sit at 1 on a constraint that holds. Measured: with the ceiling
  removed, Stage B drops the Saturday anchor in weeks nobody pinned — and the report names it.
- **Without pins none of this is built**, `n_viol` included, and no solve 0 runs. A pinless
  request builds a byte-identical Stage A model to the pre-pin solver, which
  `gcf/test_inertness.py` freezes (see `docs/CI.md`). Once any pin exists, the mandatory lead is
  soft for the whole month: a lead shortfall from absences alone comes back as the
  `builtin:mandatory_lead` marker and a «Sin cubrir» seat instead of `ok: false`.
- **Refusals** (all `ValueError` → `ok: false`): a malformed entry, more than 100 entries (never
  truncated), an unknown role, a week outside the month (`1..weeks`, or `1..weeks + 1` when the
  request names the trailing Saturday), a `Sat.*` pin on a week with no Saturday, a Sunday-role pin
  in week `weeks + 1` (which has no Sunday service), two different pins for one person in one
  service, and a pinned-only name that differs from another name only in capitalisation or
  surrounding spaces (a misspelling: it would sit beside the real person and could take their DSL
  rules). A pin on a pool member's exact name is
  always accepted — Studio does not trim `member_name`, so that can include a trailing space.
  Exact duplicates collapse.
- **A consecutive-rule quirk for whoever writes the copy:** pinning someone into both services
  of one weekend under `!consecutive on *.Lead` reports the W(n-1)–W(n) and W(n)–W(n+1) pairs,
  because each pair sums both weeks' services and the rule already forbade a same-weekend double.
- **What it does not promise:** nothing bounds the pinned person's own total, and an un-pinned
  `fairness_exempt` member is outside the global total-load bound (a single pin can cost them a
  service) — though not the `Sun.Lead`/`Sun.BGV` bands, which only the role-scoped form lifts. The
  three `*_fairness_relaxed` flags keep their literal meaning — "the ladder loosened a limit" —
  over slack-adjusted counts. A timed-out pinned month looks like a fairness-free month.

### Invocation from Next.js
`POST /api/admin/solve` (admin/super-admin, `maxDuration=60`):
- **Production:** `fetch(OWT_SOLVER_URL)` with header `X-Api-Key: OWT_SOLVER_API_KEY`; treats
  HTTP 422 as a valid business response.
- **Local dev:** if `OWT_SOLVER_URL` is unset, spawns `gcf/owt_solver_v2.py --json-mode`
  (python from `OWT_SOLVER_PYTHON`, default a local miniforge `owt-roles` env), SIGKILL after
  120s.
- Every `ok: false` from a solve is answered with a 422 (the auth and body checks answer 403 and
  400 before any solve). The ones the route makes when it could not get the solver's answer carry
  `transport_error: true` (see Input / output); the solver's own never do. Guard:
  `app/api/__tests__/solveRoute.test.ts`.

**Before the request leaves the planner** (`buildSolveRequest`, `app/components/admin/plannerModel.ts`):
- **The trailing Saturday is Auto's (T1–T5,
  [ADR-0048](adr/0048-the-saturday-after-the-last-sunday-belongs-to-its-calendar-month.md)).**
  `trailingSaturday(sundayDatesFull)` returns the last Sunday + 6 days if that date is still in
  the month (31 Oct 2026, 31 Jan and 28 Feb 2026, 31 Jul 2027). That date is solver week
  `weeks + 1`.
  - One definition: `saturdayForWeek`, `weekForColumn` and `weekendWeekIndexes` resolve the date
    through it, so its column, seats, unfilled markers, draft and pins always agree on the week.
  - The grid's rule context (`ruleContextForTarget`) judges it as week `weeks + 1` of its own
    month, never as the next month's week 1.
  - It is preselected like every Saturday. Deselected, it is not sent (T2).
  - **T5:** a selected trailing Saturday is sent only if some member of the request's Sunday or
    Saturday lead pools can lead it (`saturdayAccess`). A lead cannot if they are unavailable that
    day, or if a `!in` pattern or a week exclusion for `weeks + 1` covers `Sat.Lead`. Patterns
    expand through `rolesOfPattern`, which mirrors the solver's `expand_pattern`; the guard is
    `patternRolesSync.test.ts`.
  - A lead also cannot when they have no Saturday left under their rule (ruling Q17). That
    means a maximum (`==` or `<=`) on a pattern covering `Sat.Lead`, at most the number of other
    sent Saturdays on which they are the only possible lead. The solver's one-Lead-per-Saturday
    rule puts them on each of those, so with Frank away on the 24th and the 31st, Andy's
    `Sat.* == 1` is used up by the 24th. A zero maximum bars them outright.
  - If no lead can, `weeks + 1` is left out and the Sundays are still solved. Auto says «El
    sábado 31 oct no se mandó al solver: ningún líder puede dirigirlo (no disponibles, excluidos
    o sin sábados libres en su regla). Llénalo a mano.» (`trailingNotice`). The check is
    advisory; the solver stays the authority. Q17 is a cheap pre-filter: it misses some
    refusals (the limits listed under the seat model below), and the retry catches them.
  - **The retry without it (ruling Q19).** When the solver itself refuses a request that sent
    `weeks + 1` (a 422 without `transport_error`), Auto (`runSolve`) rebuilds the request with
    `buildSolveRequest({ withholdTrailing: true })` and solves once more. That goes through
    T5's own withhold path, `trailing = { sent: false, reason: "infeasible" }`: no week
    `weeks + 1`, no exclusion or availability rule naming it, and the floors judged again on
    the Saturdays left. Deselecting the date instead would keep its week exclusions, which the
    solver refuses. The retry's notices replace the first attempt's, and its trailing line is
    «El sábado 31 oct no se mandó al solver: con él, el mes no tenía solución. Llénalo a
    mano.» It is Spanish only and does not quote the solver's reason (ruling Q20): that reason
    already ends with the solver's own advice to deselect the date. With «Solo llenar vacíos»
    on, the pins are collected again over the retry's weeks, so none names the 31st. Auto stays
    locked through both solves.
    - Never retried: a transport failure (`transport_error`), a non-422 status, a thrown fetch,
      a request that did not send the 31st, or a retry.
    - A retry refused too shows its own refusal (`solverRefusalMessage`), which is what main
      would have shown, plus its notices. The specials fill on every exit.
    - The board's preview (`requestSaturdayWeeks`) still shows the first request, so the next
      Auto sends the 31st again and may pay the extra solve again.
  - If it is sent, each request member unavailable that day gets
    `<name> !in week <weeks+1> Sat.*`. Nothing is derived from the next month's Sunday.
  - If T5 withholds it, week exclusions that name `weeks + 1` are not sent, because the solver
    refuses a rule for a week the request does not have. A «Sem 5» exclusion in a four-Sunday
    month is still sent, and still refused with a 422 that names the rule, when the month has no
    trailing Saturday or it is deselected. That is deliberate (ADR-0048).
  - An older solver refuses `weeks + 1` with `ok: false`, so this needs delivery 1 deployed
    first. Since Q19 that refusal is retried without the 31st, so the month still solves and
    only the infeasible line shows, which does not name the cause (Q20). Only the deploy check
    proves delivery 1 is live.
  - Before this change it was manual-only (D16: a week came only from an in-month Sunday after
    the Saturday), and the grid marked it «Fuera del alcance de Auto». That badge, its confirm
    clause and `unaddressableDates` are gone.
- **Saturday minimums are judged per person (T3/T4).** A Saturday minimum is a cap on a
  Saturday-only pattern (`Sat.*`, `Sat.Lead`, `Sat.BGV`) with `==` or `>=` and a value of at least
  1 (`isSaturdayFloor`; relative values resolve as the solver resolves them).
  `buildSolveRequest` drops a minimum from that person's DSL line in four cases and returns it in
  `omittedCaps` with a reason. Auto shows one line per reason (`omittedCapsNotices`), in this
  order, naming each rule as the rules card names it (`capLabel`):
  - `noSaturday`: the request sends no Saturday at all, so every minimum is dropped. The line
    reads «Este mes no tiene sábados que Auto pueda cubrir, así que no se aplicó …».
  - `unreachable`: the minimum asks for more Saturdays than the person can take among those sent.
    A Saturday does not count if they are unavailable that day, or if a `!in` pattern or a week
    exclusion for that week covers the minimum's roles. For `Sat.Lead`, they must also be in a
    lead pool. The line reads «No se aplicó «X» a A y B: los sábados que Auto llena este mes no
    alcanzan para cumplirlo (por disponibilidad, exclusiones o rol).»
  - `combined`: the minimum is reachable, but it is not the person's first reachable Saturday
    minimum in the rules card's order (rulings Q16, Q18). Only one per person goes on to the
    seats. This is decided after `unreachable` and before any seat is counted, so it is a limit
    of the planner, not a shortage of seats. A person whose first minimum is unreachable still
    keeps the next one that can be met. The line reads «No se aplicó «X» a A y B: Auto no combina
    dos mínimos de sábado de la misma persona.»
  - `capacity`: the remaining minimums cannot all get a seat. The line reads «No caben todos los
    mínimos de sábado en los lugares de sábado de este mes, así que no se aplicó …».

  **The seat model** (`floorsFitSeats`) decides `capacity`:
  - Each sent Saturday has the solver's 2 Lead and 3 BGV seats, one seat per person.
  - A `Sat.Lead` minimum takes only a Lead seat, a `Sat.BGV` minimum only a BGV seat, and `Sat.*`
    either, but only where that person can take that role that week. A minimum of v needs v
    different Saturdays.
  - It is a max flow, so any set it accepts comes with a real seat assignment.
  - It only ever sees one minimum per person (`combined` above), and it relies on that: each
    minimum is one person node. For one minimum per person it is exact. In the latest re-verify
    (at `097d994d`) an independent re-implementation matched it on 25,500 scenarios. Real-solver
    restorations found no false `capacity` in 2,529 and no false `unreachable` in 4,442.
  - If the minimums do not all fit, they are sorted by the person's Saturday count in the
    request's history, fewest first, ties by name. Under ADR-0046's `history: []`, that is by
    name. Each one is kept only if the kept set plus it still fits.
  - A Saturday's lone lead: when exactly one lead-pool member can lead a sent Saturday, they may
    take only its Lead seat there, because the solver needs a Lead on every Saturday and seats a
    person once per Saturday. Their own `Sat.BGV` minimum on that Saturday is therefore
    `capacity`.

  Maximums always stay. The solver stays the authority for what the model leaves out. In a
  month that sends the trailing Saturday, each of these now costs one extra solve and a 31st
  filled by hand (the retry above), never the month:
  - the dedicated Saturday-lead anchor (`sat_anchor`);
  - two or more leads whose minimums all push them onto BGV (the one-Lead-per-Saturday rule
    beyond the lone lead);
  - a maximum combined with that rule: the upper side of an `==` minimum, or a `<=`, zero
    included. Only T5 reads maximums, and only for the trailing Saturday. It does not count the
    Sunday seats a `*.Lead`, `Lead.*` or `*.*` maximum also covers, nor several leads sharing too
    few Saturdays, so it can send a 31st the solver then refuses;
  - rows grown by pins.

  The latest re-verify (at `097d994d`) found 124 real-solver setups where this request was
  refused and main's solved, every one with the 31st sent. One cause per case, summing to the
  124: `sat_anchor` 71, a self-contradictory rule (a kept minimum above the same person's
  maximum) 43, minimums pushing every possible lead of the 31st onto BGV 2, minimums plus a
  lead barred by a maximum 4, a maximum used up by Sundays 3, other 1. Separately, hand-built
  Q17 scenarios added 9 more (maximums that also cover Sundays, Saturday pigeonholes across
  several leads, an anchor with a zero maximum). Each case is now a retry (ADR-0048,
  decision 11).

  October 2026 is why this exists: its only Saturday service was the 31st, so the admin
  deselected 3/10/17/24, the request sent no Saturday, and three saved `Sat.* == 1` minimums made
  the whole month infeasible, Sundays included. PR #116 then dropped such minimums month-wide.

  A request stays byte-identical to before this change when no trailing Saturday is selected and
  no minimum is dropped. ADR-0048 names the one case where a dropped minimum is one the solver
  may have met: `combined`, which applies in every month to every reachable Saturday minimum
  after a person's first reachable one.
- **The solver's own reason reaches the admin.** A solver `ok: false` comes back as a 422 whose
  body carries the reason; Auto now reads it and shows «El solver no encontró solución. Motivo
  del solver: …» (`solverRefusalMessage`) instead of the generic line alone. A failure the route
  made itself reads the same, and carries `transport_error: true` so that it is never retried. The solver's
  diagnostic text is English and, for an over-constrained month, blames "a mandatory Lead
  seat" generically — a known weakness of `diagnose_infeasibility`.
- **«Solo llenar vacíos» sends the board as pins** (`pinModel.ts`; spec
  `2026-09-29-planner-trailing-saturday-and-fill-empty-design.md` §3). With the switch on, every
  occupied Lead/BGV/Coro seat on a column Auto writes is a pin `{ week, role, person }`, by exact
  `member_name` — one per person per service (Lead before BGV before Coro; the solver refuses
  two), at most 100. What the solver would refuse in English (an occupant who is no longer a
  member, an empty `member_name`, more than 100, a Saturday week not sent, a pinned-only spelling
  that differs only in case or spaces from a pool name or from another pinned-only spelling) is
  refused first in Spanish, naming the cell. A trailing Saturday that T5 withheld is not a column
  Auto writes (`weekendsWithSaturday` on `collectPins`/`emptyVoiceSeats`). Its seats are never
  pinned, so they are never refused, and the confirm's empty-seat count leaves them out.
  **Off, or with nothing on the board, the request has
  no `pinned` key** and is exactly what it was before. A success is applied only if `pinned_honored` equals the pins sent and the
  schedule shows every pin by exact name; otherwise Auto says «El solver no respetó los lugares
  fijados; no se aplicó nada.». `pin_violations` are named as the rules card names them
  (`pinViolations.ts`); `violation_ceiling_proven: false` adds one caveat, and only when at least
  one rule was set aside — with nothing named there is nothing to have ceded too much of.

### HTTP handler ([`gcf/main.py`](../gcf/main.py))
`functions_framework.http`-decorated `solve(request)`. Handles CORS `OPTIONS`, rejects non-POST
(405). **Fails closed on auth:** `OWT_SOLVER_API_KEY` unset → 503; wrong/missing `X-Api-Key` →
401 (the function is publicly invokable, so the shared secret is the only barrier). Wraps
`solve_from_dict` — unexpected exception → 500; `ok:false` → 422; `ok:true` → 200.

### requirements
`ortools==9.15.6755` (**hard-pinned** for parity with the local conda env — bump deliberately and
re-pin locally), `functions-framework>=3.0,<4`. Entry point `solve`.

### Instrument seats are filled locally, not by the solver
`app/components/admin/instrumentFill.ts` runs inside «Generar mes» on every exit (like the
specials filler, `localFill.ts`). It seats only EMPTY `instrumento:` cells on weekend columns,
through `rankCandidates` per placement (Tipo, availability, same-category block), among
members who DECLARE the instrument (`teamMembers.instruments`). Ordering: fewest instrument
seats this month **per member, all instruments** → did not play the previous weekend
service → name. Guarantee: per-member total balance in the month; for instruments whose
players declare only that instrument this is the «difference ≤ 1» rule. A two-instrument
member is balanced as a person, not per instrument (confirmed 2026-09-09). With «Solo llenar
vacíos» off, its own previous `origin: "auto"` picks are vacated once, before counting; manual
picks are never touched.
Rows nobody declares are skipped with no marker; custom planner rows are outside the
vocabulary and never filled. Rows whose stored label doesn't match the current seat vocabulary
(`instrumentSeatDef(label).id !== row.id` — legacy-spelled rows) are likewise never filled and
produce no marker. With `fillColumns` set it fills exactly the given columns in that order and
vacates nothing: the "vacate this run's own previous auto picks" step above only runs in the
default (no `fillColumns`) weekend path. Two callers set it: the stored-mode group fill
(`groupFill.ts`, spec `2026-09-22-camp-group-fill-design.md`; the ticked specials, specials
included), and create-mode Auto with «Solo llenar vacíos» on (`applySpecialFill` in
`MonthGenerator.tsx` passes the weekend columns in date order), so an earlier Auto's instrument
picks stay. Spec: `docs/superpowers/specs/2026-09-09-member-instruments-auto-fill-design.md`.

---

## 2. CI/CD ([`cloudbuild.yaml`](../cloudbuild.yaml))

A Cloud Build **trigger** (GitHub, branch `main`, file filter `gcf/**` and `cloudbuild.yaml`)
runs on every push touching the solver. One step: `gcloud functions deploy owt-solver --gen2
--region=us-central1 --runtime=python312 --source=gcf --entry-point=solve --trigger-http
--memory=512MB --cpu=1 --timeout=120s` (**1 vCPU since 2026-09-30** — 512MB alone gives 0.33,
measured ~4× a Mac core, plus 11–19 s cold starts; ADR-0046), with `--remove-env-vars=OWT_SOLVER_API_KEY` then
`--set-secrets=OWT_SOLVER_API_KEY=owt-solver-api-key:latest` (key from **Secret Manager**;
Cloud Run rejects a name that's both a plain env var and a secret). It intentionally does **not**
pass `--allow-unauthenticated` (public `run.invoker` is already set and persists; the build SA
can't `setIamPolicy`; auth is enforced at the app layer via `X-Api-Key`).

Manual fallback: `bash scripts/deploy-solver-gcf.sh` (prints the function URL + the Vercel env
vars to set).

### Verifying a Cloud Function deploy
The Vercel rule (alias + `githubCommitSha`) has no analogue here, so the check is:

1. `gcloud functions describe owt-solver --gen2 --region=us-central1 --format='value(state,updateTime)'`
   — the state must be `ACTIVE` and the active revision's `updateTime` must be after the merge.
   This is the analogue of reading the alias, not the build.
2. One **pinless** smoke request, asserting `ok: true` and the **presence** of `pinned_honored`.
   Presence is the discriminator: an old revision answers the same request successfully and
   without the field. It needs the API key, which is Frank's to supply — never paste its value
   into a doc, a chat or a command history. Shape (the key read from Secret Manager into the
   shell, with gcloud's file logging off so the value is not written to `~/.config/gcloud/logs`,
   and handed to curl on stdin with `-H @-` so it never appears in `ps`):

   ```bash
   URL=$(gcloud functions describe owt-solver --gen2 --region=us-central1 --format='value(serviceConfig.uri)')
   KEY=$(CLOUDSDK_CORE_DISABLE_FILE_LOGGING=true gcloud secrets versions access latest --secret=owt-solver-api-key)
   printf 'X-Api-Key: %s\n' "$KEY" | curl -s -X POST "$URL" -H @- -H "Content-Type: application/json" \
     -d '{"weeks":4,"weekends_with_saturday":[2,4],"sunday_leads":["A","B","C"],"saturday_leads":[],"support":["D","E","F","G"],"dsl_rules":[],"history":[],"seed":1}' \
     | python3 -c 'import json,sys; r=json.load(sys.stdin); print("ok", r["ok"], "pinned_honored" in r)'
   unset KEY
   ```

3. One **trailing-Saturday** smoke request (fictitious names), which names week `weeks + 1`,
   asserting `ok: true` and that `schedule["5"]` exists and holds only `Saturday`. Same key
   handling as step 2; only the request and the assertion change:

   ```bash
   URL=$(gcloud functions describe owt-solver --gen2 --region=us-central1 --format='value(serviceConfig.uri)')
   KEY=$(CLOUDSDK_CORE_DISABLE_FILE_LOGGING=true gcloud secrets versions access latest --secret=owt-solver-api-key)
   printf 'X-Api-Key: %s\n' "$KEY" | curl -s -X POST "$URL" -H @- -H "Content-Type: application/json" \
     -d '{"weeks":4,"weekends_with_saturday":[2,4,5],"sunday_leads":["A","B","C"],"saturday_leads":[],"support":["D","E","F","G"],"dsl_rules":[],"history":[],"seed":1}' \
     | python3 -c 'import json,sys; r=json.load(sys.stdin); print("ok", r["ok"], list(r.get("schedule", {}).get("5", {})), r.get("error"))'
   unset KEY
   ```

   Landed: `ok True ['Saturday'] None`. An old revision refuses `weeks + 1` and prints
   `ok False [] weekends_w_sat must use 1-based indexes 1..4. Received [5].` — the new code is not
   serving, so the deploy did not land: **redeploy**. Unlike step 2's failure this is not a revert
   signal. (Both outputs were checked offline: the pre-change solver, `8408e3de`, gives exactly that
   refusal, and this branch gives the first line.)

Never a bare HTTP reachability check, never a grep loop over build logs.

**The one revert trigger** is the pinless smoke request (step 2) failing or coming back without
`pinned_honored` — the deploy did not land; re-deploy the previous revision. A behavioural
problem found later is **not** a function revert: revert the app half (it stops sending
`pinned`, and a pinless request builds today's model). Reverting the function while a pinned
app is live makes every Auto fail the handshake. If a pinless regression ever reaches
production, revert **the app first**, then re-deploy the previous function revision. The same order
holds for the trailing Saturday, now that the planner sends `weeks + 1`: the planner stops sending it
first (the solver's non-trailing path is unchanged by the invariant), then the function if ever
both — an old function refuses a request that names it.

### Solver v3 (`gcf_v3/`) — `owt-solver-v3`, deployed and not called

The date-based v3 solver (spec `docs/superpowers/specs/2026-10-05-solver-v3-c5-solver-function-design.md`,
ADR-0051) lives in `gcf_v3/` (package `owt_v3`) and imports nothing from `gcf/`. **Nothing calls it**
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

**Convention:** most `.mjs` scripts share a **dry-run guard** —
`const APPLY = process.argv.includes("--apply")`. They compute and log a plan by default and only
write to Sanity with `--apply`. Run as `node --env-file=.env.local scripts/<name>.mjs [--apply]`.
**Production writes need explicit user consent — dry-run first; never re-run a completed one-shot
import with `--apply`.**

> **Scripts may no longer write the protected service types on the honour system.** A script that
> touches `sunday_role` / `saturday_role` / `special_role` / `featuredSongs` / `saturdarSongs` /
> `setlistProposal` / `roleTargetLock` / `roleCreationReceipt` either uses the shared guarded
> invariant or **fails before any write** — and it must be listed by exact `file + operation` in the
> protected-read audit or `npm test` fails. See the two subsections below.

### Catalog import & processing
- `catalog/xlsx-to-json.py` — Python (openpyxl); `oasis-songs.xlsx` → `oasis-songs.json`. Reusable.
- `import-catalog.mjs` — main song importer; reconciles against existing posts via
  `lib/catalog-reconcile.mjs`; writes `import-plan.json`. Reusable.
- `backfill-song-fields.mjs` — fills empty `key`/`bpm`/`timeSig` only (never overwrites). Reusable.
- `fix-song-bodies.mjs`, `fix-section-colons.mjs` — one-off body/heading cleanups.

### Migrations (one-off)
- `migrate-authors.mjs` — free-text authors → canonical `author` references (`lib/author-canon.mjs`).
- `retag-songs.mjs` — catalogue re-tag by theme (2026-09-05). Replaces each post's THEMATIC
  tags with a curated set derived from the stored lyrics (the assignment table lives in the
  script), keeps the tempo tags (`Up Beat`/`Down Beat`/`Transition`; five songs that had
  none received `Down Beat`), strips the 21 artist
  tags from `tags` (artists are `authors` since `migrate-authors`), folds 11 near-duplicate
  theme tags into their canonical name, creates 9 new theme tags, fixes two accent-mangled
  slugs, and deletes the 33 tag docs left unreferenced. Dry-run by default, `--apply` to
  write; refuses to run while any `post` draft exists; idempotent. **STATE: APPLIED
  2026-09-06** with Frank's consent — 9 tags created, 135 posts patched, 33 tag docs deleted,
  0 skips; a follow-up dry-run reported 0 changes that day. **A later `--apply` re-imposes
  the script's `THEMES` table over any tag edit made in Studio since** (full-array replace),
  so read the dry-run diff first — do not re-run it on the word "idempotent". In the same
  session two co-authors were
  added by hand (`Gracias Dios` +UPPERROOM, `Gracia Sublime Es` +En Espíritu y En Verdad),
  both in `authors[]` and the denormalised `author` string. Taxonomy after: 43 tags
  (3 tempo + 40 theme), no artist tags.
- `migrate-proposal-messages.mjs` — **RETIRED, see the table below.** It folded
  `setlistProposal.lead_notes` / `.admin_notes` into the append-only `messages[]` thread
  (Release 2, Child A). **STATE: APPLIED 2026-08-26** — 8 documents, 10 messages, 0 failed
  patches, at Child A Phase D step 4 with explicit consent.

  **It can no longer run at all, not even a dry run.** `assertRetiredWriter()` is its first
  statement, before any client is constructed. Earlier revisions of this entry described a
  re-run as "safe but pointless" and told an operator to "re-run the DRY-RUN before any
  repair" — that procedure is not executable and following it wastes the time of whoever is
  mid-incident. **The read-only check is `reconcile-proposal-messages.mjs`**, which reports a
  mismatch and exits 1; a repair is a consented top-up under a distinct `_key`, never a re-run.

  The pure mapping survives in `lib/proposalMessages.mjs` (unit-tested in
  `scripts/__tests__/migrateProposalMessages.test.ts`) as the record of what was applied.

### ⛔ Retired writers — seven one-shots that now **fail closed**

**Count kept honest by hand, and it has drifted twice:** it said "five" while the registry held
six, and then the TABLE held five while the heading correctly said seven — the heading was fixed
and the rows were not. No test pins prose, so check both when you touch either. `RETIRED_WRITER_NAMES` in
[`lib/sr-retired-writer.mjs`](../scripts/lib/sr-retired-writer.mjs) is the source of truth;
if this number disagrees with it, the registry is right.

These seven already ran against production and **cannot** adopt the guarded mutation invariant
(target lock + creation receipt + exact observed revision + dependency policy). Documentation-only
retirement would have been insufficient, so each one calls `assertRetiredWriter()` from
[`lib/sr-retired-writer.mjs`](../scripts/lib/sr-retired-writer.mjs) as its **first statement** —
before any client is constructed and before any mutation is assembled — and exits non-zero. There is
no flag, argument, or environment that lets one reach the Content Lake again: the gate reuses
`evaluateGuards()` (so the production project `ebb8vcnk` and dataset `production` are hard refusals
on either axis, in dry-run too) and *always* adds a `retired_writer` hard failure on top. The file
bodies are kept only as the historical record of what was applied.

| Retired script | What it used to do | Use instead |
|----------------|--------------------|-------------|
| `import-schedule.ts` | create-if-missing + patch Lead/BGVs/Chorus on role docs from a solver history JSON | `POST /api/admin/roles`, `PATCH /api/admin/roles/[id]` |
| `import-setlist-history.mjs` | create missing `featuredSongs`/`saturdarSongs` history from a WhatsApp export | `PUT /api/admin/setlists` |
| `cleanup-superseded-proposals.mjs` | delete non-approved proposals where an approved one exists | `service-readiness-cleanup.mjs --action resolve-proposal --mode remove` |
| `migrate-shared-proposals.mjs` | backfill `contributors` and delete collision losers | applied 2026-07-03; residual collisions → `--action resolve-proposal` |
| `unpublish-july-2026.mjs` | patch `published:false` on every July 2026 service | `POST /api/admin/roles/publish` |
| `migrate-proposal-messages.mjs` | fold `lead_notes`/`admin_notes` into `messages[]` under two deterministic `_key`s | applied 2026-08-26; the fold is done. Read-only check: `reconcile-proposal-messages.mjs` |
| `normalize-instrument-names.mjs` | rewrite free-text instrument names on role docs to the canonical set | `PATCH /api/admin/roles/[id]` |

Unit tests: `lib/__tests__/sr-retired-writer.test.mjs` proves the refusal is unconditional **and**
statically checks each real file — the gate call must precede every write marker (`createClient(`,
`api.sanity.io`, `.transaction(`, `.commit(`, `.patch(`, `.delete(`, `.create(`, `fetch(`).

> Gitignored local developer tooling (e.g. `sa-roster.mjs`) is outside this committed-writer scope —
> the operator guards or retires it by hand, and it is never a protected-read-audit entry.

### Guarded Service Readiness operator tooling

Unlike the retired one-shots, these are **meant** to be run by hand — but only against the isolated
verification dataset. Guards live in [`lib/sr-verification.mjs`](../scripts/lib/sr-verification.mjs)
and refuse **in dry-run too**, on either axis: `forbidden_project` (`ebb8vcnk`), `wrong_project`,
`forbidden_dataset` (`production`), `wrong_dataset`, `marker_mismatch`, `unknown_flag` are hard
failures; `missing_project_id` / `missing_dataset` / `missing_marker` / `missing_token` /
`missing_admin_password_hash` block `--apply`. No client is constructed at all unless
`willContactRemote` is true (i.e. `--apply` and nothing refused). Env: `SR_VERIFY_SANITY_PROJECT_ID`,
`SR_VERIFY_SANITY_DATASET`, `SERVICE_READINESS_VERIFICATION_MARKER`, `SR_VERIFY_SANITY_TOKEN`
(+ `SR_VERIFY_ADMIN_PASSWORD_HASH`, `SR_VERIFY_RUN_ID`, `SR_VERIFY_CANDIDATE_SHA`,
`SR_VERIFY_DEPLOYMENT_ID` for the seed). Secrets are never printed — presence booleans only.

- **`service-readiness-cleanup.mjs`** — one guarded, atomic cleanup per invocation. **Dry-run by
  default;** `--apply` needs an exact action-specific confirmation phrase
  (`<action>[#<mode>]:<id>@<rev>`), takes a timestamped backup outside tracked files
  (`.sr-verification-backups/<ISO>-cleanup-<kind>.json`, gitignored), commits one revision-asserted
  transaction, then **re-queries and verifies** the outcome. It gathers its own dataset evidence with
  its own GROQ — an `--evidence` intent file is never trusted as proof. Actions:
  `discard-raw-draft`, `select-canonical-duplicate` (never implicit merging),
  `repair-malformed-record` (closed field allowlist), `remove-malformed-role` (**only** after the same
  dependency inventory/refusal policy the routes use), `remove-orphan-setlist` (needs proof no
  canonical owner exists), `resolve-proposal` (`--mode retarget|normalize|remove`, non-approved only),
  `reconcile-approved-receipt` (never deletes approved history), `vacate-orphan-lock` (needs
  published/raw proof the owner is gone), `cleanup-creation-receipt` (`--mode inspect|remove`, by
  exact id+rev, only after proving no live role carries it — **committed and retired receipts are
  durable idempotency tombstones and are never deleted by ordinary cleanup**). Refusals are named
  codes, e.g. `revision_mismatch`, `lock_owner_alive`, `receipt_carried_by_live_role`,
  `approval_via_cleanup_forbidden`, `destination_proposal_exists`, `role_has_dependencies`.
  Multi-target cleanup is separate invocations, never one batch.
- **`service-readiness-restore.mjs`** — revision-aware restore from a backup file. Dry-run prints the
  confirmation phrase (`restore:<count>:<digest>`). It **refuses the whole restore** — never partially,
  never latest-wins — on `later_write_conflict` (the document was written after the backup),
  `restore_type_mismatch`, `restore_type_not_protected`, `empty_backup`, or a confirmation mismatch.
  It never force-overwrites.
- **`service-readiness-feasibility.mjs`** — the A3 isolated-dataset transaction-shape harness.
- **`service-readiness-verification-seed.mjs` / `-reset.mjs`** — fixture seed/teardown, dry-run by
  default. Reset deletes from a **closed allowlist** of `srv.`-prefixed fixture ids (infrastructure
  docs excluded) — never a discovery query, never `*[_type == …]`.

Both of the first two are listed by exact `file + operation` in the protected-read audit's
`OPERATOR_TOOLING_ALLOWLIST` so they are visible to it rather than invisible.
**Production `--apply` always requires separate explicit user consent.**

### History / backfill
- `import-setlist-history.mjs`, `import-schedule.ts` — **retired**, see above.
- `backfill-member-instruments.mjs` — one-shot, dry-run by default, `--apply` with consent:
  derives `teamMembers.instruments` from held `instruments[]` seats. `setIfMissing` +
  `ifRevisionId`, backup to `.backfill-backups/`, closed vocabulary only. **Status:** applied to production 2026-09-10 (10 written; Samy skipped «sin historial»; Francisco Gutierrez listed without Tipo — Frank had already un-typed him; Antonio Navarro then patched by hand to `[Drums, AG]` at Frank's request). Backup in `.backfill-backups/` (gitignored). Idempotent: a re-run writes nothing.

### Solver history diff (MCP P2, Gate B — Frank runs it, never an agent by default)
- `solver-history-diff.ts` (tsx entry point) + `lib/solverHistoryDiff.ts` / `solverHistoryDiffReport.ts`
  / `solverHistoryDiffRun.ts` — classifies every difference between Frank's exported
  `localStorage` history and the derived one (R11, ADR-0042) into `explained` / `unverified` /
  `bug`, and runs the local solver against both sides for one target month. **Reads only local
  files, no Sanity client, no network** — the classifier and report modules are pure, verified
  by a test that walks their import closure. **Refuses any input or output path inside the
  repository** — the checkout it runs from, the main checkout and every linked worktree (found
  through the `.git` file's `gitdir` and `commondir`), resolved through symlinks — before any
  read or write; a `.git` file it cannot follow refuses the run. Exports and derived bundles
  hold real member names, and this repository is public. Usage:

  ```
  npx tsx scripts/solver-history-diff.ts \
    --bundle ~/owt-private/p2-history/bundle-<date>.json [--bundle <another profile's bundle>]… \
    [--export ~/owt-private/p2-history/export-<browser>-<profile>-<date>.json]… \
    [--solve-request ~/owt-private/p2-history/solve-request-<NEXT>.json [--solve-month YYYY-MM]] \
    --out ~/owt-private/p2-history [--seed 42] [--runs 2]
  ```

  Run from the repository root; the first `--bundle` must be the one from the profile that
  captured `--solve-request` (the consistency check treats that bundle's export as the
  capture profile). **`--solve-request` is optional** — without it the CLI still classifies
  (R11's diff), it just cannot also run R11's solve comparison. `--solve-month YYYY-MM`
  overrides which month the solve section targets; left off, that month defaults to the first
  bundle's own `NEXT`. `--runs 0` records the exact request bodies for the production solve
  route instead of spawning the local solver. Without `--solve-request`, or with fewer than 2
  runs per side, the report and stdout say **"R11 incomplete"**: the gate line covers the
  classification only. Exit codes: `0` a report was written (read its gate line), `2` refused,
  `1` failed. The export, bundle and report files are never committed —
  see the P2 plan's Gates A–B
  (`docs/superpowers/plans/2026-09-25-owt-mcp-p2-solver-history.md`) for the full procedure and
  where `~/owt-private/p2-history/` comes from. No new environment variable: the runner spawns
  the local solver through the already-documented `OWT_SOLVER_PYTHON` (§1, "Invocation from
  Next.js"), and checks its `ortools` version against `gcf/requirements.txt`'s pin before
  running anything.

### Fairness-record reconstruction (solver v3 C4 — a consented production writer)
- `reconstruct-fairness-months.mjs` (run with `tsx`) + `lib/reconstruct*.ts`. **Purpose:** give each past
  month planned before any v3 writer existed a `fairnessMonth` record with `source: "reconstructed"`, so
  the first v3 runs balance against a real past instead of an empty one
  (`docs/superpowers/specs/2026-10-05-solver-v3-c4-record-reconstruction-design.md`). Each record says who
  was eligible, inferred from today's Tipo and rules, join months from the stored seats, the «Mes por
  medio» setting and Frank's corrections; ADR-0050's «Reconstruction of past months» records the rules.
  Every write goes through C2's one write executor (actor `reconstruction`), past months only, and only
  ever creates, replaces or deletes a record this script wrote.
- **Tokens, checked before any client is built:** a dry run needs `SANITY_API_READ_TOKEN` (a record's id is
  dotted, so without the token a record would read as «sin registro»); an apply or a rollback-apply also
  needs `SANITY_WRITE_TOKEN`. Both already exist in `.env.local` (`docs/SECRETS.md`); C4 adds no variable.
  Run it from a checkout whose `.env.local` points at the dataset you mean — the first stdout line prints
  project · dataset · mode before any read.
- **Private paths, and names never enter the repository:** `--out`, `--overrides` and `--plan` are refused
  inside any working tree of this repository (use e.g. `~/owt-private/c4/`). The table, the plan, the
  backups and the refusal report hold member names, member ids and rule keys; stdout and stderr hold none
  of them — a rule is named by its ordinal («restricción 3 de 8»), a corrections entry by its position.
  A refusal (exit 2) prints its name-free lines on stdout; one that came after the reads also writes the
  private `rechazo.md`, except a missing `solverConfig`, which writes no file. stderr carries only a
  failure (exit 1), as its error class.
- **The sequence.** Each step is separate. Step 3 runs only after Frank's explicit consent in chat to the
  fingerprint step 1 printed — diagnosing is not consent, and one consent never carries to a second plan.
  1. **Dry run:** `npx tsx --env-file=.env.local scripts/reconstruct-fairness-months.mjs --months 2026-08,2026-09 --out ~/owt-private/c4 [--overrides ~/owt-private/c4/correcciones.json] [--preview-run YYYY-MM]`.
     It writes `<out>/<time>-dry-run/`: `tabla.md` (per month the services with «cuenta»; per person each
     role's status, reason and «corregido» mark, join months, seats, blocked dates, «Exenta», «Mes por
     medio»; for a «reemplazar» month, what it changes in the stored record, person by person; the presence
     rules as stored; the balance preview for the run month; the anomalies),
     `plan.json`, and a `backup-YYYY-MM.json` of every record a replace would overwrite. Stdout: the action
     per month with counts, how many «Mes por medio» settings it found (a loud warning at zero), the plan's
     fingerprint and the two paths.
  2. **Review:** Frank reads `tabla.md`; corrections go in the corrections file (schema v1, keyed by member
     `_id` copied from the table — see the header of `lib/reconstructOverrides.ts`), then step 1 again,
     until the table is right.
  3. **Apply:** `npx tsx --env-file=.env.local scripts/reconstruct-fairness-months.mjs --apply --plan <out>/<time>-dry-run/plan.json --fingerprint <hex> --out ~/owt-private/c4 [--overrides <the same file>]`.
     It refuses before any read a plan made against another project or dataset (the fingerprint covers
     the «Destino»); it re-derives everything and refuses with zero writes if anything differs from the
     plan (a voice seat, a «cuenta» flag, an availability date, a correction, a record revision) or a
     replace's backup is missing; then it writes month by month, oldest first, and stops at the first refusal or error (exit 1).
  4. **Dry run again:** every written month must read «sin cambios»; then the «Equidad» preview should show
     those months «reconstruido». After a failed or partial apply this is the repair: a write that failed
     may have landed.
- **Rollback:** `… --rollback --months 2026-08 --out ~/owt-private/c4` plans the deletion of intact records
  the reconstruction wrote (any other is refused and listed), backing each up before its plan; after the
  same consent, `… --rollback --apply --plan <…>/plan.json --fingerprint <hex> --out ~/owt-private/c4`. A
  rollback reads only the records — no rules, roster or services — and refuses `--overrides` and
  `--preview-run`. Afterwards those months read «sin registro, no cuenta».
- **Standing instruction: after any seat edit, date move, «cuenta» flag change or member availability edit
  that touches a reconstructed month, re-run the dry run for that month** — nothing else prompts it (the
  past-month rule on «cuenta» is client-side, so a hand-built request or a date move can still change a past
  month). A «reemplazar» row and its «Cambios frente al registro guardado» section then show, person by
  person, what changed, for a fresh consent.
- **Months:** strictly before the current CDMX month — October 2026 only on or after 2026-11-01. A month
  with no record and no stored weekend service or counted special is skipped («sin servicios guardados»). A
  month whose record a v3 Auto confirm wrote reads «no lo escribió la reconstrucción: no se toca», and one
  whose reconstructed record was edited by hand since reads «editado después de reconstruir: no se toca» —
  both expected, not failures. Exit codes: `0` done · `2` refused before any write · `1` failed or partial.
- The protected-read audit lists the CLI file in `OPERATOR_TOOLING_ALLOWLIST` (the one caller of C2's
  executor outside `app/`); `serviceCommitCallers.test.ts` pins it and `lib/reconstructDecide.ts` as the
  write-request module's only importers under `scripts/`. Retirement (the gate, the registry move, the
  seven → eight pins) is solver v3 C7 Step 12's.

### Accounts / auth
- `set-password.ts` (tsx) — `MEMBER_ID=… PASSWORD=… npx tsx scripts/set-password.ts` — bcrypt a
  member's password (bootstrap first admin / reset).
- `create-service-account.mjs`, `sa-roster.mjs` — a credentials service account for UX-review
  automation.

### Diagnostics / UX screenshots (Playwright)
- `ux-shots*.mjs`, `ux-verify.mjs`, `maya-shots.mjs`, `skeptic-desktop.mjs` — drive the local app
  as the service account, capture screenshots to `.ux-shots/`. Creds in gitignored
  `scripts/.sa-creds.json`.

### Ops shell
- `deploy-solver-gcf.sh` (manual solver deploy), `serve-all.sh` (boots redesign variants on
  ports 3000–3006 from sibling worktrees).

### `scripts/lib/` (unit-tested shared modules)
`catalog-reconcile.mjs`, `author-canon.mjs`, `setlist-match.mjs`, `whatsapp-setlists.mjs`,
`proposalRank.mjs` (note: `advancementRank` ranks `approved` **highest** here — the inverse of the
`/me` surfacing rank; don't merge them). Service Readiness: `sr-verification.mjs` (pure guard
evaluation, backup naming, fixture verifiers), `sr-verification-runtime.mjs` (the only module that
constructs a client, acquires the dataset lease, and writes backups), `sr-cleanup.mjs` (pure cleanup
plan/refusal decisions), `sr-feasibility-checks.mjs`, `sr-retired-writer.mjs` (the retirement gate),
`memberInstruments.mjs` (pure grouping/normalization for the instruments backfill; mirrors
`seatModel.ts`'s vocabulary, pinned by test). Solver v3 C4: `reconstruct*.ts` — the fairness-record
reconstruction's core (arguments and private paths, the corrections file, the plan file, inference,
anomalies, the ledger runs, the reports, the runner); `reconstructDecide.ts` is its one importer of C2's
write-request module, and no `lib` file calls the executor.
Tests in `scripts/lib/__tests__/`; CLI-level tests in `scripts/__tests__/`.

---

## 4. Mobile / native (Capacitor 8)

Strategy: **wrap the existing Next.js app** (not a React Native rewrite). Full runbook:
[MOBILE.md](MOBILE.md).

- **`capacitor.config.ts`** — `appId: "com.owtBackstage.app"` (permanent once published),
  `appName: "OWT Backstage"`, `webDir: "mobile/fallback"`. **Phase 1** (current): online-only
  wrap loading `server.url = "https://owt-backstage.vercel.app"`.
- **`mobile/fallback/index.html`** — minimal offline shell shown when the remote app is
  unreachable.
- **Plugins:** `@capacitor/core`, `@capacitor/text-zoom` (drives `textZoom.ts`),
  `@capgo/capacitor-social-login` (native Google SSO). `native.ts` bridges them.
- **`ios/` and `android/`** — generated by `npx cap add` and **committed** (reproducible signing).
  Build artifacts are gitignored; regenerate with `npx cap sync`. **Don't hand-edit generated
  native code** — change source + `npx cap sync`.
- **Phases:** 1 = online wrap (iOS verified on-device; Android pending, Apple Dev enrollment in
  progress). 2 = offline bundled SPA + bearer-token auth. 3 = push/camera/calendar.

---

## 5. PWA & assets (`public/`)

- **`manifest.webmanifest`** — "Backstage," Spanish, `display: standalone`, theme `#010b17`,
  icons 192/512 (any + maskable).
- **`icons/`** — 32/192/512 + maskable + apple-touch. Brand: `LogoOasis.png`,
  `backstage_*.png`.
- **No service worker yet** (offline is Phase 2).

---

## 6. Testing

- **JS/TS — Vitest** ([vitest.config.ts](../vitest.config.ts)): `environment: "node"`,
  includes `app/**/*.test.{ts,tsx,mjs}` + `scripts/**/*.test.{ts,mjs}`, `passWithNoTests: true`,
  `@` → repo root. Run `npm test` (`vitest run`) or `npm run test:watch`. A DOM-needing `.test.tsx`
  sets up jsdom itself.
- **Python — stdlib unittest** (in `gcf/`, no extra deps):
  - `test_owt_solver_v2.py` — degradation order, absence slack, honest diagnostics
    (`python3 -m unittest test_owt_solver_v2 -v`).
  - `test_main.py` — HTTP handler auth (fail-closed 503/401), 405, valid 200.

  These are excluded from the deployed function via `.gcloudignore`.

**This suite is a BLOCKING gate.** The `solver-v2` CI job runs
`python -m unittest discover -s gcf -t gcf -v` on Python 3.12 (`.github/workflows/ci.yml`), and
`gates` — the required check — requires it (and `solver-v3`, the same command over `gcf_v3/`; see
[CI.md](CI.md) «Solver suites»); before that a `gcf/**`-only PR went green on a
job that never opened the file, on code that deploys to the Cloud Function from `main` with
no `preview` rehearsal. Run it locally the same way from the repo root before claiming done —
the three Node gates are no longer the whole set.

---

## 7. Feature history (`docs/superpowers/`)

Every substantial subsystem has a dated **spec** (`specs/*-design.md`) and **plan**
(`plans/*.md`) — Google SSO, push, web-push, text-size a11y, dual reference links, multi-author
references, WhatsApp setlist history, draft/publish services, participation sidebar, preview
toggle + assignment emails, email notification preferences, shared setlist proposals, past-set
browsing. These are the authoritative "why" for each feature; consult them before reworking one.
