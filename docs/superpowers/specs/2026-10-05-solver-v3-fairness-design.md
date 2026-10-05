# Solver v3: cross-month fairness, cadence leads and 1–2-month runs — parent design (roadmap)

**Date:** 2026-10-05 · **Status:** `APPROVED` by Frank (sections in chat, then the written text at
`d497749f`, both on 2026-10-05); amendments A1–A26 (§3) added the same day after writing the
children — technical contracts, no policy change · **Risk tier of this parent:** standard (it owns the shared policy and
the contracts between children; each child carries its own tier, §11).

**Contracts, not prescriptions.** This document states what must be true and what must never happen.
Helper names, file layouts and loop shapes belong to the child specs and their plans.

**Names.** This repository is public. Members are described by their role in the policy — «the
cadence members» (three today), «the fixed-count lead» (a `Sun.Lead == 2` rule), «the presence pair»
(an `any_of(A,B) on Sun.BGV each_week` rule), «the exempt members» («Exenta») — never by name. Every
fixture uses fictitious names.

## Original request

> Necesitamos arreglar en solver.
> Tiene que tomar en cuenta el historial, pero debe de considerar a personas "especiales" como el caso
> que te platique de [REDACTED: three member names] que solo dirigen un mes sí y un mes no.
> Y mantener el fariness en ventanas más grandes, siempre siendo claro y transparente con el admin al
> respecto.
> Lo que pasa es que mientras el equipo crece más, no caben todos para dirigir en un solo mes, pero
> quiero que sus participaciones sigan siendo parejas.
> Si es necesario construir un nuevo solver desde cero, estoy abierto a la posibilidad.
> Recuerda que debe de poder respetar los espacios asignados y necesitamos también que pueda llenar 2
> meses de jalón
>
> — and, mid-session: «Y la participación total también»

## 1. Outcome and current gap

**Primary outcome.** Auto (the `/admin` planner's solver) staffs weekend voice seats so that, across
months, every person's participation stays even **per role and in total**, the cadence members lead
Sundays every other month, pinned and already-stored seats are respected, and the admin can read why
each person got what they got — for a run of **one or two calendar months**.

**Operator.** The worship admin (today Frank) running Auto in Servicios.

**Current behaviour and gap.**

- Auto sends `history: []` (ADR-0046): the solver balances within one month only. With more Sunday
  leads than seats, 2–3 regulars lead no Sunday in a given month and nothing compensates them later.
- When history was sent, it was raw decayed seat counts with no denominator. It could not tell «was
  not in the pool that month» from «was in the pool and got nothing», so occasional leads read as
  owed Sundays (ADR-0046) — and the 8-tier weighted objective overflowed CP-SAT (ADR-0038).
- Nobody records who was eligible in a past month: the pool checkboxes live in one overwritten
  singleton (`solverConfig`).
- The solver accepts 3–6 weeks of one month (`gcf/owt_solver_v2.py:634`); two months cannot be one
  request.
- The admin sees only booleans («Equidad relajada», «Sin optimizar») and a «sin Lead en …» panel that
  judges last month against today's pool — the same false «owed» signal, in UI form.

## 2. Evidence

Full reports, prototype code and its outputs: private repo
`owt-agent-logs/sdd/2026-10-05-solver-v3-fairness/` (`evidence/`, `prototype/`). They contain
production member data and stay out of this repository.

| Fact | Source | Implication |
|---|---|---|
| Weekend role docs exist from 2026-04-26 only; no per-month record of pool ticks exists anywhere; `solverConfig` revision history starts 2026-09-29 | `evidence/u_real-data.md`, `u_history-derivation.md` §4 | Past eligibility must be reconstructed once and recorded from now on |
| 11 members carry the `sunday_lead` Tipo; a 4-Sunday month has 8 Sun.Lead seats, 2 of them fixed by one exact rule | `u_real-data.md` (a), (f) | One month cannot seat every regular; two months can |
| History offsets are `history[-3:]` weighted 10/6/3, eligibility-blind, objective-only | `gcf/owt_solver_v2.py:686-721`; `u_solver-core.md` §5 | Replace with eligibility-normalised balances |
| The 8-tier weighted sum overflows INT64_MAX//2 with history; a 26-person roster times out with none | ADR-0038; `u_solver-core.md` §10 | Sequential stages with small objectives |
| `weeks` is validated to 3–6; week indexes, `{weeks-N}`, count rules and the trailing Saturday all assume one month | `owt_solver_v2.py:634`, `:228-254`, `:1320-1345` | A date-keyed request with rules scoped per month |
| Pool ticks are team-wide and Auto solves whatever is on screen | `MonthGenerator.tsx:1618-1706`, `:3783` | The record must snapshot what was actually solved |
| Prototype, real Nov+Dec 2026 request, **pre-amendment formulation** (compensation Saturday set aside, strict parity, Saturday cap excluding the cadence members, no F6, no floor set-aside, no pins): 19/19 stages proven optimal, 0.48–0.53 s (M4 Pro, 1 worker); nobody on the DL line with 0 Sundays in both months; 0 double Sundays; 0 consecutive Sundays; voice floor met; 0 hard violations | `evidence/f_final-proto.md` §3 | Feasible and fast on real data; the amended policy is re-proven by C5 (§11) |
| 12-month chain (Nov 2026–Oct 2027), same formulation: cadence pattern held with 0 breaks; longest gap without a Sunday for any regular: 1 month; 1-month runs as even as 2-month runs once the cadence and floor exist | `f_final-proto.md` §5 | Two-month runs are for planning convenience, not required for fairness |
| Compensation Saturday counted inside the SL line (Frank's choice), measured without X3: cadence members 12–14 leads a year, regulars 14–17, Saturdays even | `f_final-proto.md` §7 (V6) | Adopted (D11) |
| The amendments (X1–X3, F5–F6, F15, clamps) were each tested **one at a time**; F6, the «desde» replacement, the pin-aware shares and the lead-floor skips were not tested; every floor and cap stage had objective 0 in every run, so their ranking was never traded off; no pins were run with the full policy | `f_final-stress.md` «Coverage»; `f_final-proto.md` §8.10 | C5's acceptance re-runs the combined policy (Run A, 12-month chain, pin scenarios) |
| Assignment-dependent ("dense") shares: 46–48 s, 7–8 of 15 stages capped; planned fixed shares: ~1 s, all proven | `evidence/d_prototype.md` §Pitfalls 1 | Planned shares are the contract |
| `linearization_level=1`: a BGV stage unproven after 60 s; level 2: proven in ms | `f_final-proto.md` §6 | A solver setting the contract fixes |
| Rule-breaking pins fail a run whose rules are all hard; ADR-0041's soft-rules-under-pins mechanism completes them in ~0.5 s and names each break | `evidence/f_final-stress.md` §1 | Pins enter through ADR-0041, unchanged |
| An exact `== v` with fewer than v available services fails the run (seen in stored July 2026 availability) | `f_final-stress.md`, extra finding | Exact rules clamp to availability, reported |
| Floor-forced seats for someone whose monthly share is under 1 create a debt that grows ~0.6 a month | `f_final-proto.md` §8.2, V4 | Such seats are set aside |
| The DL floor holds for at most 9 people in a 4+4-Sunday month pair (7 today) | `f_final-stress.md` §6–7 | Capacity is part of the contract and of the panel |
| CI's solver step is ~9m43s of a 14m40s job against a 25-minute limit | `evidence/u_solver-tests-fixb.md` §2 | Split CI before a second solver suite |
| gcf deploys to ONE production function from `main`, no preview rehearsal; v2's goldens are the only "path unchanged" proof | `u_consumers-infra.md` §3; `docs/CI.md` | A side-by-side v3 function with its own source, trigger and tests |

## 3. Decisions

### Frank's decisions (2026-10-05, in chat)

| ID | Decision |
|---|---|
| D1 | Approach B: a **new date-based v3 solver side by side with v2**, cut over by a switch; four deliveries (ledger and persistence → solver v3 → planner → cutover). |
| D2 | Evenness is measured **per role separately** — Dom Lead, Sáb Lead, BGV, Coro — in that priority order. |
| D3 | **Total participation** is also balanced, as a **voice floor** (nobody available and in a pool goes a calendar month without a voice seat) plus Total shown as the sum of the four lines. |
| D4 | The solver always considers prior roles; the **lookback is the 3 calendar months** before the run's first month. |
| D5 | The admin chooses **1 or 2 months** per run. |
| D6 | Every service gets a toggle **«Cuenta para equidad»**, visible when creating a service and when editing the month, specials included. |
| D7 | Unavailability and months outside the pool **accrue no debt**. |
| D8 | The cadence members' Sunday lead is a **cadence**: 1 Sunday in their «on» month, 0 in their «off» month. When cadence and «half of a regular» conflict, **cadence wins**. Their cadence Sundays are set aside before the DL share, like an exact rule. |
| D9 | The Saturday-only lead pool becomes empty; **the Saturday anchor rule goes away**. Regular leads keep leading Saturdays. |
| D10 | In their «off» month a cadence member gets, preferably, **one Saturday lead** as compensation. |
| D11 | That compensation Saturday **counts inside their Sáb Lead line** («un poco menos» than a regular in total; measured 12–14 vs 14–17 leads a year). |
| D12 | Protections ranked above repaying balances: no regular two consecutive months without a Sunday when available; at most 1 Sunday lead per person per month (exact-count leads excluded); at most 1 Saturday lead per person per month; no consecutive Sundays. |
| D13 | «Exenta» removes a person from Total and the voice floor only; an exempt lead stays in the Dom Lead line (today's v2 meaning). |
| D14 | Toggle defaults: weekend services count, specials do not. A counted special's Lead counts as Dom Lead on a Sunday and as Sáb Lead on any other day; its BGV counts as BGV, its Chorus as Coro. Drafts in past months count. |
| D15 | Data and delivery as in §8–§11: a monthly eligibility record, a reviewed reconstruction of the lookback months, side-by-side function, Preview rehearsal by solving without confirming, the engine flipped by a code constant. |

### Refinements from the stress pass (recorded here so they are read, not discovered)

These change four sentences of the design approved in chat; each was tested on real data.

| ID | Refinement | Why |
|---|---|---|
| X1 | A cadence member's on/off state is **derived before the solve, from what actually happened, availability-aware**: month *m* is «on» exactly when (a) she led **no counted Sunday** in *m*−1, (b) she is eligible for Sun.Lead in *m*, and (c) she has at least one available counted Sunday in *m*; otherwise *m* is «off». A pinned or hand-placed Sunday counts as «led»; a Sunday the solver failed to give her counts as «not led»; a month where she is not eligible is «off» with no compensation Saturday (so a manual untick advances the chain instead of doubling the gap). In a two-month run, month 2 is derived assuming month 1 follows its own state; if the solve misses it, the miss is reported and the next run re-derives. «Counted Sunday» includes a counted Sunday-dated special (D14). This replaces «en una corrida de 2 meses, cada una tiene un mes sí y un mes no». | Strict parity left a member 3 months without a Sunday and without the Saturday when her «on» month had no available Sunday (`f_final-stress.md` §5). |
| X2 | The compensation Saturday applies only in an «off» month **in which she led no Sunday** (e.g. a pinned Sunday in an off month cancels it). | A pinned off-month Sunday otherwise earned both (`f_final-stress.md` §1). |
| X3 | «At most 1 Saturday lead per month» applies to **everyone**, cadence members included. | With D11 the cadence members are ordinary SL members; without the cap they led 2 Saturdays in a month 1–4 times a year (V5). |
| X4 | Under the 3-month window, an excess that pins force is **forgiven when it leaves the window, not repaid**. Consequence of D4, accepted; the mitigation is transparency: the panel shows «Los pines tomaron N lugares» and the cumulative figure since the record began beside the 3-month «saldo». | `f_final-stress.md` §2. |

### Amendments from writing the children (2026-10-05, after Frank's approval)

Writing the eight children against this document exposed seams the parent left open. These rows
settle them. **None changes a policy decision (D1–D15, X1–X4)**; each is a technical contract the
children need to agree on. Where a row names a clause, the row wins over that clause's older wording.

| ID | Clause | Amendment |
|---|---|---|
| A1 | E2, §11 | Ownership of the engine switch: **C1** creates `app/components/admin/solverEngine.ts` with the constant `SOLVER_ENGINE` only; **C2** adds the pure resolver of the effective engine, the Preview-only override `OWT_SOLVER_ENGINE` (honoured only on the `preview` branch deployment or when `VERCEL_ENV` is unset in local development — never on `verify/service-readiness` or production), its `docs/SECRETS.md` entry, and the fairness PUT's refusal `engine_not_v3`; **C6** adds the solve route's `409 solver_version_mismatch` and passes the server-resolved engine to the planner. |
| A2 | L2 | The record's id is **`fairnessMonth.YYYY-MM`** (a dotted id is private in Sanity: the dataset answers unauthenticated published reads, and the record holds availability). The reader fails closed when the read token is absent — an unreadable record must never look like «sin registro». |
| A3 | L2 | Per-person, per-role status vocabulary is `in` / `out` / `exact`. The record also stores the presence rules, date-scoped rule exclusions and resolved exact counts in force that month. |
| A4 | L3, L6 | The reconstruction (C4) creates, replaces or **deletes** only records it wrote (`source: reconstructed`, content hash intact), under a revision check, through a neutral (non-`server-only`) executor of C2's writer with an injected client; that executor is pinned like the commit modules and its pin scans `scripts/` too. It writes past months only. A reconstructed record is stamped `engine: v2`. |
| A5 | L3 | A record may be replaced only while its month has **no stored weekend services and no counted specials** (so a pre-created uncounted camp special does not freeze it). |
| A6 | U2, L3 | A record **binds** a horizon month only when A5 would keep it (the month has stored services or counted specials at solve time); the solve then takes that month's statuses, exact counts, presence rules and exclusions from the record, and its pool checkboxes show read-only with the reason. Otherwise the on-screen pools and rules drive the solve, and the confirm replaces the record under its revision. |
| A7 | §11 | **C2 owns the single v3 eligibility resolver** (on-screen pools + rules + members → per-person per-role statuses); C6 builds both S1's eligibility and the confirm's record body from its output. Every rule name it resolves must match exactly one member (C3's resolver); v2 keeps its current name matching. |
| A8 | L4 | v2 inertness means the whole v2 solve request and the grid's rule verdicts are identical with or without `sundayCadence`, not only the rule strings. |
| A9 | §14 | The «Mes por medio fuera de Líderes Domingo» warning is built by C3 and shown only when the effective engine is v3 (C6 passes it). |
| A10 | F8, Q2 | Under v3, «Holgura N» has no effect on the solver; the uncounted-specials filler keeps today's Exenta/Holgura ordering. |
| A11 | F7, S1 | A person with both «Mes por medio» and an exact `Sun.Lead` count is refused when the v3 request is built, naming the person. |
| A12 | F5 | The floor seat applies only to a person who holds **no fixed seat** (exact or cadence) that month. For past months the threshold uses the stored-seat share before floor set-asides. |
| A13 | F1, F4 | Populations by day class: a Sunday-dated service uses the `Sun.*` roles; any other day uses `Sat.*` (with `Sat.Choir` for Chorus). Presence and date-scoped rule exclusions bind weekend services only. Lines and protections count **counted** services only; rules see every weekend service. |
| A14 | X1, S1 | A Sunday on which the person is rule-excluded from `Sun.Lead` is not an «available counted Sunday». The wire carries three states: `on`, `off`, and `out` (not eligible: no Sunday, no compensation Saturday). |
| A15 | S1 | Pins are keyed by an opaque service id, with the date as a consistency check. `!in` patterns and week exclusions reach the solver only through per-service eligibility (no week-exclusion rule on the wire). The request adds per person `dl_since` (first recorded DL eligibility) and `prev_dl_leads` (Sunday leads in the month before the run), and `prior` (the previous month's stored services with their seats, built by C6 from `GET /api/admin/roles`). The caller resolves relative caps; the solver never sees `{weeks-N}`. |
| A16 | F11 | Exact-count leads are excluded from the Saturday cap as they are from the Sunday cap. |
| A17 | F14, U5 | Each person-line figure is rounded **once**, half away from zero, to hundredths on the wire; the panel shows **one decimal**, computed once from the exact value by C2's single formatter (es-MX uses a decimal point: «le deben 0.8»). |
| A18 | F14 | Ledger cases in the golden fixture are asserted by both suites; cadence-state cases by TypeScript only (C5 consumes the states). Ties in a presence sub-line break by member-id order in both languages. |
| A19 | S4, F12, F10 | The response reports both the planned and the realised share per person and line; «after» uses the realised one. The mandatory lead is a soft family with no instance where no lead is possible. DL capacity is computed once per run over the people whose floor the previous month has not already met. |
| A20 | §11 C0 | C0 lands a minimal `gcf_v3/` scaffold (package `owt_v3`, requirements, one smoke test) that C5 takes over. Safe end state: the same tests plus that smoke test. |
| A21 | §11 C4, L6 | October 2026's record is applied on or after 2026-11-01 (it must be past). Months confirmed under v2 are reconstructed as each becomes past; until then the current month reads «sin registro». Seats served may only **delay** the start of a line; they never make anyone eligible. |
| A22 | §11 C7 | «Mes por medio» may be saved before C4's dry run (it is inert under v2, A8). The single flip step covers only moving the pools and flipping the constant. |
| A23 | §11 C5 | C5's acceptance against «the real Nov+Dec request» uses a private converter outside the repo; C7's rehearsal re-checks it with C6's real request builder. |
| A24 | U6 | Non-timeout transport errors get their own copy, distinct from «El solver tardó demasiado». Auto refuses a horizon that contains a past month. |
| A25 | L1 | «A PATCH that carries the field and changes nothing a notice could report queues no notification.» Services in lookback months cannot be toggled from any surface (accepted; revisited at C7's look). |
| A26 | C3 row | C3's rollback is UI-only, or a full revert only before C2 ships and after listing every stored setting; no «Mes por medio» is saved anywhere until the production alias serves C3. |

## 4. The fairness policy (the shared contract)

Every child that computes, sends, solves or shows fairness implements exactly this. One TypeScript
module owns the past (carried balances); the v3 solver owns the plan (planned shares, the solve, the
post-solve report). One golden fixture (fictitious people) is read by both test suites and fails if
they disagree (F14).

- **F1 — Lines.** DL = `Sun.Lead`; SL = `Sat.Lead`; BGV = `Sun.BGV` + `Sat.BGV`; CORO = every Chorus
  seat. A counted special maps by D14: its Lead to DL on a Sunday and to SL on any other day, its BGV
  to BGV, its Chorus to CORO — and it counts toward the same protections (F7, F10, F11) as the line it
  maps to. Plus one **presence sub-line** per presence rule (F5), folded into BGV for display.
  **Total** = the sum of a person's lines, for display; it is enforced only through the voice floor
  (F9). Instruments and FOH never count.
- **F2 — Balance.** `saldo = le tocaba − recibió`, summed over counted services in the lookback.
  **Positive means owed** («le deben»), negative means ahead («X de más»). One sign convention in every
  layer, payload and string.
- **F3 — Lookback.** Exactly the 3 calendar months before the run's first month (CDMX dates). Target
  months and later months never count; drafts in earlier months do. A month with no eligibility record
  contributes neither share nor received seats, and the panel says so.
- **F4 — Population and share.** For each counted service and role, the **pool** is the seats left
  after set-asides (F5). It is shared equally among the people who, for that service and role: are
  marked eligible in that month's record; are available that day (record snapshot ∪ live
  `unavailableDates`); and are not excluded by a rule. Received = the seats they hold that count to
  the line. Past services use filled seats; the plan uses configured seats (planned shares, F13).
  Balances sum to zero per service and role.
- **F5 — Set-asides (fixed seats).** These seats are removed from the pool before sharing and create
  no debt for anyone:
  - seats of an exact `==` rule — clamped to the person's available matching services in that month,
    with a notice when clamped;
  - a cadence member's Sundays (F7);
  - one seat per service forced by a presence rule, shared in that rule's own sub-line among its
    members (a member who cannot hold a second seat of that role at that service is outside the
    role's normal population there);
  - a **floor seat**: for a person whose combined planned voice share for the month (all lines,
    computed before any floor set-aside) is under 1, one voice seat that month is set aside from the
    line it falls in; the person stays in every population. In past months the floor seat is the
    first voice seat of that month by date, then Lead > BGV > Choir. *Untested as written (the tested
    variant used an exact rule); C5 must prove it.*
  - a pinned seat held by someone outside the line's population.

  **Placement.** In past months a set-aside is the actual seat at its actual service. In the plan, a
  monthly set-aside (exact count, cadence Sunday, floor seat) is spread evenly over the person's
  available matching services in that month; a per-service one (presence, pin) stays at its service.
- **F6 — A seat decided before the solve** (pin, exact rule, or forced presence **when only one
  presence member is available** for that service) takes that person out of the other roles' shares
  **for that service**. When several presence members are available, the solve decides who holds the
  forced seat, so it moves no shares (F13).
- **F7 — Cadence.** A person marked «Mes por medio» has no DL line. The aim in an «on» month is
  exactly one Sunday lead, in an «off» month none (X1 decides the state; both are protections, F12).
  In an «off» month with no Sunday lead she preferably leads one Saturday (D10, X2), and that Saturday
  counts in her SL line (D11). She is an ordinary member of SL, BGV and CORO. **One function** derives
  the state (X1); it lives in the TypeScript ledger (C2), is sent to the solver per member and month,
  and is covered by the golden fixture. Records store the setting («Mes por medio»), never the state.
- **F8 — Exempt.** «Exenta» removes the person from the voice floor and from Total; every role line
  still counts her (D13). «Holgura N» has no effect under v3 (Q2).
- **F9 — Voice floor.** Every non-exempt person in any voice pool who has at least one available slot
  in a month gets at least one voice seat that month.
- **F10 — DL floor.** No one on the DL line who is available in a month goes two consecutive calendar
  months without a Sunday lead. The check reaches one month back into stored data, and skips a month
  before the person's first recorded DL eligibility (per line — the monthly record replaces a separate
  «desde» field, so a promotion starts the line at the first record that marks it) or a month with no
  stored services. **Capacity:** for
  a pair of months, the floor can hold for at most `Sun.Lead seats in the pair − fixed DL seats −
  cadence Sundays` people (9 for a 4+4-Sunday pair today); beyond that the run says who missed and why.
- **F11 — Concentration and spacing.** At most 1 Sunday lead per person per month (exact-count leads
  excluded); at most 1 Saturday lead per person per month (X3); no one leads two consecutive Sundays,
  across the month boundary and against the last stored Sunday. Counted specials count toward the cap
  of the line they map to (F1); the consecutive check looks at Sunday-dated leads only.
- **F12 — Priority.** Hard, always: one seat per person per service; a seat only for someone eligible
  and available (or pinned). Every **rule** is soft per instance (F15): a first stage minimises the
  number of broken rule instances and fixes it as a ceiling — 0 whenever pins and availability allow,
  which is the hard rule. Then, in order, each stage fixing its optimum before the next: fill (Lead >
  BGV > Choir; at least one Lead per service whenever any eligible lead is available) → cadence on/off →
  compensation Saturday → voice floor → DL floor → monthly concentration caps → no consecutive Sundays
  → for DL, SL, BGV, each presence sub-line, CORO: first the most-owed final balance, then the sum of
  squared final balances → seeded tie-break. **Everything after fill is a protection, not a
  constraint:** it is minimised in this order and every miss is reported (S4). This order follows D12
  (no consecutive Sundays above balances), which differs from the prototype's (it placed spacing after
  balances); C5 re-measures. Cadence ranks above the DL floor and the voice floor above BGV balance.
- **F13 — Planned shares.** The plan's shares are fixed numbers computed before the solve from the
  request's services, eligibility, availability and set-asides. A share that depends on the assignment
  is rejected (measured 46–48 s). Without pins, planned and post-solve figures differed by up to 0.23
  seat (measured); with pins the gap reached 0.32 (0.5 in a presence sub-line) before the pin-aware
  shares of F5–F6. C5 measures the gap under the final rules and fixes the tolerance any consistency
  check uses.
- **F14 — One formula.** The TypeScript ledger and the solver's post-solve report compute F2–F6 the
  same way; a shared golden fixture is the guard. Integer units are hundredths of a seat on the wire;
  rounding happens once, for display.
- **F15 — Pins and rules (ADR-0041's mechanism, applied always).** A pin is a fixed variable. Rules
  are soft per instance in every v3 run (not only under pins): the first stage minimises the number of
  broken rule instances and that number becomes a ceiling no later stage may raise; the report is
  rebuilt from the assignment and names each break; a pinned seat is exempt from the availability
  check; a row grows to fit its pins. Known availability cases are clamped before the solve and
  reported as clamps, not breaks (S2). A pinned seat counts as received when its holder is in the
  line's population, otherwise it is set aside (F5).

## 5. Solver v3 contract (owned by C5)

- **S1 — Request.** Date-keyed: 1 or 2 consecutive calendar months of services (date, kind, month,
  seats per role, counts flag); people by stable id plus display name; per-service per-role
  eligibility already resolved; carried balance per person per line (hundredths); the cadence state
  per cadence member and month, computed by the TypeScript ledger (F7); rules as structured objects
  **scoped per month** (exact/≤/≥ counts with relative caps resolved against that month's Sundays,
  pairs, presence, week exclusions resolved to dates, consecutive); pins by (date, role, person); the
  last stored weekend before the run; a seed; budget knobs. No DSL strings, no week indexes, no `weeks`
  guard.
- **S2 — Never sinks the run because of one service or one rule.** Before the solve, any rule instance
  that availability or eligibility alone makes unsatisfiable is clamped or set aside for that instance
  and reported with a code: an `==`/`≥` count above the person's available matching services clamps to
  them; a presence rule with no member available at a service does not apply there; a relative cap
  that resolves below 0 is 0. Anything else conflicting is a reported soft break (F15). A service with
  no possible lead is returned with its lead seats unfilled and a named reason. The trailing Saturday
  is just a service of its calendar month (ADR-0048).
- **S3 — Stages and settings.** F12's stages, each solved then fixed. `num_search_workers=1`,
  `linearization_level=2`, a deterministic time limit per stage with a wall-clock guard (≈2.5 s), a
  total budget of 25 s. A capped stage keeps its best solution and is reported «no probado»; a stage
  never started is «no ejecutado» and the previous stage's schedule is kept. If fill (or the
  rule-break stage before it) finds no solution in time, the run returns a distinct «timed out» code —
  never «no solution». Nothing is dropped silently.
- **S4 — Response.** Assignments by date and role; unfilled seats with reasons; pin handshake, pin
  violations and the violation ceiling (v3's own format); per-stage status; per person and line:
  carried, planned share, received in the plan, balance after, clamped flags; cadence outcome per
  member and month; every missed protection with a machine-readable cause; a capacity notice; the
  contract version echoed. Codes, not prose — the planner owns the Spanish copy.
- **S5 — Determinism.** Same request and seed give the same output whenever every stage is proven.
- **S6 — Budget.** Measured ~0.5 s for two months on a Mac; the real 1-vCPU container is measured
  before cutover (C7 gate). The route aborts its upstream call at ≤ 55 s and returns a JSON transport
  error; the client aborts at 58 s, so the route's answer always arrives first.

## 6. Ledger and persistence contract (owned by C1–C4)

- **L1 — The toggle.** A boolean `countsForFairness` on `sunday_role`, `saturday_role` and
  `special_role`. Legacy read: `coalesce(countsForFairness, _type != "special_role")` — no migration.
  A PATCH without the field leaves it unchanged; a toggle-only PATCH queues no notification; the
  create fingerprint includes the field only when it differs from the type default (no
  `FINGERPRINT_VERSION` bump). An uncounted service creates neither share nor received seats.
  The ledger reads it through its own query; the readiness loader and the MCP snapshot loader (pinned
  to mirror each other, ADR-0040), `computeParticipation` and the sidebar's «Incluir especiales»
  switch do not change.
- **L2 — The monthly eligibility record.** One document per calendar month (`fairnessMonth.YYYY-MM`, A2), keyed by member `_id`
  (names stored only as display text; array `_key`s are derived hashes, never a raw id containing
  dots). It snapshots what the month was solved with: per person and role, `in` / `out` / `exact` (A3); the
  cadence setting (not the state, F7); exempt; the availability as it stood; the engine that wrote it.
  It never stores seats served — those stay derived from the role documents (ADR-0042). Hidden and
  read-only in Studio.
- **L3 — Writing the record.** Written by Auto's confirm **under v3 only, before any draft** (C6), or
  by an explicit «Registrar elegibilidad de {mes}» offered only under v3. A concurrent writer is
  refused, never silently discarded. An existing record is replaced only while its month has no
  stored weekend services and no counted specials (A5; re-checked at write time), except that the
  reconstruction (C4) may replace or delete a record it wrote itself (A4). «Past» means before the current CDMX month; past months are
  written only by the reconstruction. Records written from Preview are stamped as such.
- **L4 — Cadence in the rules.** A per-person «Domingo: Normal / Mes por medio» on the `solverConfig`
  restriction, keyed like every other rule (by name); it is resolved to a member id when the record or
  the request is built, and a name that does not resolve to exactly one member is refused (the
  existing rule-name validation). The whole-document save refuses a body from a tab that predates the
  field, so an old tab cannot drop it. v2's rule strings are byte-identical with or without it.
- **L5 — Ledger read.** Server-only, keyed by id, behind a manager-only route that excludes
  content-editors (it exposes availability). A failed read throws, and Auto refuses to solve **on a
  failed read** (ADR-0042 discipline); a lookback month without a record is not a failure (F3).
- **L6 — Reconstruction.** A script, dry-run by default, prints the per-person table for each
  lookback month (Aug–Oct 2026 first) for Frank's review; `--apply` only with his consent; it never
  infers eligibility from seats served and never overwrites a record Frank edited. It is re-run for
  every month confirmed under v2 before cutover.

## 7. Planner and transparency contract (owned by C6)

- **U1 — Horizon.** Under v3, «Planear: 1 mes · 2 meses» in Auto; one grid with a month band. Under
  v2 the control is absent.
- **U2 — Stored services in the horizon** load as read-only «Guardado» columns; their seats go as pins;
  Auto never writes them and does not fill their empty seats (a notice says so). Their shares use
  their **filled** seats, like past services, so an empty stored seat creates no share. A horizon month
  that already has an eligibility record is solved with that record's eligibility, and its pool
  checkboxes show read-only with the reason. «Solo llenar vacíos» keeps today's meaning on the board's
  own seats.
- **U3 — Specials.** Counted specials are filled first by the planner (ranked by balance) and reach the
  solver only as pins; the solver never fills a special's seat. Uncounted ones are filled after the
  solve, as today.
- **U4 — Confirm (critical).** The eligibility record(s) first; then drafts oldest first, each
  idempotent; partial failure is reported per month, nothing is deleted, «Reintentar» resends only what
  is missing. A 2-month confirm creates drafts only; publishing is unchanged.
- **U5 — «Equidad» panel.** Replaces «sin Lead en …». Tabs Dom Lead · Sáb Lead · BGV · Coro · Total;
  per person: le tocaba, tuvo, saldo (3 meses), en este plan, queda, a one-line reason (cadence state,
  compensation Saturday, unavailable dates, fixed rule, pins that took a share, exempt), the cumulative
  figure since the record began (X4), and in Total, «cantó» (all voice seats). Phone: one card per
  person. Before cutover it shows as «Vista previa: Auto todavía no usa este saldo».
- **U6 — Run notices.** Per-stage status in Spanish («probado», «no probado», «no ejecutado»); each
  missed protection named with its cause; the capacity notice; omitted or clamped rules; transport
  errors and timeouts as «El solver tardó demasiado. No se aplicó nada. Prueba con 1 mes o vuelve a
  intentar.», never as «sin solución».
- **U7 — Controls before cutover.** The toggle and «Mes por medio» are editable from C1/C3 on and say
  «aplica con el nuevo solver» while the engine is v2.
- **U8 — Two parsers, never crossed.** v3 responses go through their own handshake, pin-violation and
  unfilled-seat formatters and their own retry rule (keyed on a code, not on «422 without
  `transport_error`»); v2's parsers, pin cap (100) and the trailing-Saturday retry stay as they are; a
  test proves a v3 response never reaches a v2 parser and the reverse. The v3 pin cap is one constant
  mirrored in Python by a sync test.

## 8. Engine switch, deploy and rollback (owned by C5, C7)

- **E1.** A separate function `owt-solver-v3` with its **own source directory, Cloud Build trigger and
  CI job**; v2's code, goldens and trigger are untouched. Frank performs the first creation and the
  invoke grant by hand (the build account cannot set IAM).
- **E2.** The engine is a **code constant** (v2 by default), flipped by PR like `SOLVER_SENDS_HISTORY`;
  an environment override is honoured on Preview only. The route refuses a request whose contract does
  not match the engine (409, «recarga la página»).
- **E3.** The v3 URL is per-environment config, and the Preview-only engine override is a new variable;
  v3 reuses `OWT_SOLVER_API_KEY` or gets its own (Q5). Every one of them gets its `docs/SECRETS.md`
  entry in the change that introduces it, with rotation steps that redeploy both functions.
- **E4.** Preview writes the production dataset and shares the one `solverConfig` with production, so
  the Preview rehearsal is **solve without confirm, with the pool and rule edits made on screen and not
  saved** (except a month Frank decides to keep). Moving the cadence members into the Sunday pool and
  flipping the constant are **one step**, taken after a recorded snapshot of the pre-flip
  `solverConfig`. Rollback = flip the constant back and restore `solverConfig` from that snapshot; v2
  stays deployed.

## 9. Preserved invariants and ADR impact

Preserved: CDMX dates; `saturdarSongs`; the five member seats; `published` gating; `_key` on every
array item; revalidation after writes; client mutation handlers; ADR-0029 (Tipo is the only
eligibility axis — the record snapshots it, cadence only shapes a share); ADR-0048 (the trailing
Saturday belongs to its calendar month); the v2 path byte-identical while it is the engine.

| ADR | Change |
|---|---|
| 0010 | Decision 3 amended: a special counts when its toggle says so (default no). Decision 1 amended: a counted special reaches the solver, but only as pins — the solver never fills it. |
| 0041 | Amended under v3: rules are soft per instance in every run, not only under pins (F15); «pinned-only names stay out of every fairness group» becomes «a pinned seat counts as received when its holder is in the line, otherwise it is set aside»; pin slack is replaced by balances. |
| 0047 | Superseded under v3: there are no solver weeks; the trailing Saturday is a dated service of its month, and the week-index refusals do not exist. v2 keeps 0047. |
| 0042 | Amended under v3: ledger keyed by id; a stored eligibility record (eligibility is not recomputable); 3-month window by Frank's choice. |
| 0046 | Amended under v3: balances with a denominator replace `history: []`; exact counts generalise to set-asides. v2 keeps 0046. |
| 0004, 0038 | Amended under v3: sequential stages and the stated budget/settings. |
| New | The fairness ledger and its record; cadence; the 1–2-month horizon with stored services as pins; the engine switch and second function. Numbered when they reach `main`. |

## 10. Non-goals

- Changing v2's behaviour, its tests or its deployed function.
- Instruments and FOH fairness.
- Kids scheduling.
- MCP `solve_month` (P4, unbuilt): its plan is re-baselined onto v3 before it is implemented.
- Publishing as part of a 2-month confirm.
- Inferring past eligibility from seats served.

## 11. Children

| ID | Artifact | Outcome and acceptance | Prereqs | Safe end state | Rollback | Tier |
|---|---|---|---|---|---|---|
| C0 | Plan | CI runs v2's solver tests and a new suite in separate jobs; a guard proves every discovered test runs in exactly one job; `gates` keeps its name | — | Same tests, faster wall time | Revert | standard |
| C1 | Spec → plan | L1 end to end (schema, create/edit, reads, the Switch in every create/edit surface) | — | Field stored, inert under v2, labelled | Revert; field is ignorable | **critical** (service writer) |
| C2 | Spec → plan | L2, L3 (writer; «Registrar» gated to v3), L5, F2–F7/F14 in TypeScript including the X1 cadence-state function, the golden fixture, the read-only panel preview | C1, C3 | Records writable, panel preview, Auto unchanged | Revert; records are inert | **critical** (new production writer) |
| C3 | Spec → plan | L4 | — | Cadence stored, inert under v2 | Revert with the version guard | **critical** (whole-document serializer) |
| C4 | Spec → plan | L6; Aug–Oct 2026 records applied with consent | C2 | Lookback months recorded | Delete reconstructed records (dry-run first, consent) | **critical** (production data) |
| C5 | Spec → plan | §5 and E1: `owt-solver-v3` deployed, inert; v3 suite incl. the golden fixture, pins, per-month rules, clamps, cadence, floors, determinism; **acceptance re-runs the combined amended policy offline** on the real Nov+Dec request (Run A equivalent), a 12-month chain and the pin/rule-break scenarios, and records the F13 tolerance | C0, C2 (fixture) | Function live, nothing calls it | Disable trigger; nothing routes to it | standard |
| C6 | Spec → plan | §7 and E2 behind the constant (v2 default) | C2, C3, C5 | Production unchanged; Preview may be pointed at v3 | Constant stays v2 | standard; **U4 confirm is critical** |
| C7 | Plan | Real-container timing; Preview rehearsal (solve without confirm, unsaved on-screen pool/rule edits); Frank's look; snapshot `solverConfig`, then in one step move the cadence members into the Sunday pool with «Mes por medio», empty the Saturday-only pool (D9) and flip; reconstruct v2-confirmed months (C4 script); retire «sin Lead»; MCP P4 planned on v3 or `solve_month` left unbuilt/disabled with a reason; ADRs, CLAUDE.md, SECRETS | all | v3 serves Auto | Flip back and restore `solverConfig` from the snapshot | standard (release); its `solverConfig` change and reconstruction re-runs are production writes — dry run first, Frank's consent each time |

**Decomposition rationale.** C1, C3 and C2 each change a different production writer or serializer and
each has an inert, shippable end state, so each gets its own critical review. C4 writes production data
and needs Frank's consent on its own output. C5 is a separately deployed, uncalled function. C6 is the
only child that changes what Auto does, and it is gated by the constant. C0 enables C5 without touching
behaviour.

## 12. Requirement coverage

| ID | Requirement | Primary | Dependent | Verified by |
|---|---|---|---|---|
| R1 | Auto takes prior roles into account (3-month balances, eligibility-normalised) | C2 | C4, C5, C6 | C2 fixture; C7 rehearsal |
| R2 | Cadence members: 1 Sunday on / 0 off, availability-aware; compensation Saturday counted in SL | C5 | C3 (setting), C2 (X1 state function) | C2 fixture; C5 tests; C7 rehearsal |
| R3 | Even per role and in total as the team grows (lines, floors, caps, capacity notice) | C5 | C2, C6 | C5 tests incl. growth scenario |
| R4 | Transparent and clear to the admin | C6 | C5 (codes), C2 (preview) | C6 tests; Frank's look in C7 |
| R5 | Respects pins, stored seats and every existing rule | C5 | C6 | C5 pin/rule-break tests; C6 stored-as-pins tests |
| R6 | One run fills 1 or 2 months | C6 | C5 | C6 tests; C7 rehearsal |
| R7 | «Cuenta para equidad» per service, create and edit, specials included | C1 | C2, C6 | C1 tests |
| R8 | No debt for unavailability or months outside the pool | C2 | C5 | C2 fixture |
| R9 | v2 remains the engine and the rollback until Frank approves the flip | C6 | C5, C7 | C6 constant test; C7 |

## 13. Sequence and safe states

| Transition | Entry | Release state | Exit | If interrupted |
|---|---|---|---|---|
| → C0, C1, C3 | Parent approved | Production behaviour unchanged | Merged, gates green | Revert |
| → C2 | C1, C3 merged | Records writable; panel preview only | Merged | Revert; no data depends on it |
| → C4 | C2 merged; Frank reviews the dry run | Aug–Oct recorded | Records applied | Delete reconstructed records (consent) |
| → C5 | C0 merged; C2 fixture exists | Function deployed, uncalled | Smoke request answered | Disable trigger |
| → C6 | C5 deployed | Constant = v2 in production | Merged; Preview may use v3 | Constant stays v2 |
| → C7 | All merged | v3 serves Auto | Prod alias + function verified | Flip back |

## 14. Assumptions

| Assumption | If false | Validation | Response |
|---|---|---|---|
| The 1-vCPU container solves a two-month run well inside 25 s | Runs report «no probado»/«no ejecutado» | C7 timing gate | Raise stage caps or min instances; keep v2 |
| Cold start + network stays under ~25 s | Route timeouts | C7 timing gate | Warm-up ping under v3; min instances |
| Today's roster is representative of the next year (growth up to 9 on the DL line) | Capacity notices become routine | Capacity notice in production | Revisit the DL floor with Frank |
| Frank ticks the cadence members in the Sunday pool every month | Unticked months accrue nothing and alternate twice | C3 copy + a warning when a «Mes por medio» person is unticked | Policy note in the panel |

## 15. Open questions (non-blocking, with defaults)

| Q | Question | Default | Owner | Resolution point |
|---|---|---|---|---|
| Q1 | Saturday-only support singers get only floor-forced seats (set aside, F5). Give them a monthly target instead? | No; show their numbers | Frank | C7 look |
| Q2 | «Holgura N» (set on three people today) has nothing to act on under v3 | Inert under v3; its rule card says «no aplica con el nuevo solver»; kept for v2 | Frank | C3 spec |
| Q3 | Should «Exenta» also take the person out of the DL line? | No (D13) | Frank | C7 look |
| Q4 | Does a v3 confirm keep appending the browser history entry (ADR-0042 dual-write)? | Yes, one entry per month, until that dual-write is retired on its own | Claude | C6 spec |
| Q5 | Separate API key for v3? | Reuse `OWT_SOLVER_API_KEY` | Frank | C5 spec |

## 16. Integration acceptance

On Preview with the engine set to v3, solving (not confirming) the next two real months:

- every stage «probado» within the budget on the real container, cold start included;
- nobody on the DL line with 0 Sundays in both months when capacity allows; otherwise the capacity
  notice names who and why;
- each cadence member: one «on» and one «off» month (or the X1 shift, explained), compensation
  Saturday in the «off» month;
- at most 1 Sunday and 1 Saturday lead per person per month (exact-count leads excepted); no
  consecutive Sundays; voice floor met; 0 hard violations; pins honoured;
- the «Equidad» panel explains every person's numbers, and Frank reads it as correct;
- flipping the constant back and restoring the `solverConfig` snapshot restores v2 behaviour.

The 12-month and pin-scenario evidence is C5's offline acceptance, not this Preview run.

## Review handoff

- This parent first; then children in the order C0, C1, C3, C2, C4, C5, C6, C7. Critical children
  (C1–C4, C6's confirm protocol) go through the adversarial plan review loop; the rest are self-reviewed
  and code-reviewed.
- Evidence: `owt-agent-logs/sdd/2026-10-05-solver-v3-fairness/evidence/` and `prototype/`.
- Prior planning dialogue excluded from reviewers: yes.
- A material child change propagates here and restarts review from the earliest affected artifact: yes.
- Implementation authorization: **not granted by this document.**

## Terminal state

`READY_FOR_ADVERSARIAL_REVIEW`
