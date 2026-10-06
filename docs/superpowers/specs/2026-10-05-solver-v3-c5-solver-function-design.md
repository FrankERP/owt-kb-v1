# Solver v3, child C5: the `owt-solver-v3` function — design spec

**Date:** 2026-10-05 · **Status:** `DRAFT`, aligned to the parent's amendments A1–A39 (A27–A39 applied 2026-10-05) · **Parent:**
[`2026-10-05-solver-v3-fairness-design.md`](2026-10-05-solver-v3-fairness-design.md) (`APPROVED` by
Frank; amendments A1–A39 in its §3 win over older clause wording). This child owns parent §5 (S1–S6),
the solver half of F1–F15, E1, and the new ADR for the function and its stages (A31). It owns no part
of the engine switch (A1).

**Risk tier: standard** (parent §11). The function is deployed separately, with its own source, trigger
and test job, and nothing calls it until C6 routes to it behind the effective engine (C1's constant,
C2's Preview-only resolver, A1) and C7 flips that constant. It writes nothing: no Sanity, no Vercel, no browser state. Its only security surface is the
API-key guard, a copy of v2's fail-closed guard, on a function Frank creates and grants by hand; no
agent handles the key's value. Its **contract feeds critical work** (C6's confirm, U4), so the request
and response below are written to be implemented exactly. A change to them after review goes back
through review, together with every child that consumes them (C2, C6, C7).

**Contracts, not prescriptions.** This spec states what must be true and what must never happen.
Module splits, helper names, loop shapes and line numbers belong to the implementation plan. Existing
files are cited as evidence only.

**Names.** This repository is public. People are described by their role in the policy («the cadence
members», «the fixed-count lead», «the presence pair», «an exempt lead», «the Saturday-only support
singers»), never by name. Examples use fictitious people (Ana, Bruno, Carla…). No member name, alias or
per-person figure from the private evidence appears here, and none may appear in the v3 code or tests.

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
>
> — on the parent's approval: «Aprobado, sigue con los specs de las entregas»

## 1. Outcome

- **Primary outcome.** A new CP-SAT solver, `owt-solver-v3`, deployed and answering, that staffs the
  weekend voice seats of one or two calendar months under the parent's fairness policy (§4 F1–F15).
  - **Takes:** dated services, people by id, resolved eligibility, carried balances and cadence states.
  - **Returns:** the schedule and a report the planner can explain line by line. The report gives:
    - the status of each stage;
    - every rule it broke;
    - every protection it missed, with a machine-readable cause;
    - planned and realised shares;
    - a notice when the DL floor's capacity is exceeded.
- **Operator.** Nobody uses it directly. C6's route calls it once C6 lands, and the worship admin
  (today Frank) sees its output through C6's planner. Frank performs the one-time creation and the
  invoke grant (E1).
- **Current behaviour and gap.** v2 (`gcf/owt_solver_v2.py`) has these limits:
  - it accepts only 3–6 weeks of one month (`:634-635`);
  - it has no notion of eligibility-normalised balances, cadence, floors or a second month;
  - it reports fairness as four booleans;
  - it is the only function (`cloudbuild.yaml:1-24`).

  The parent's policy was validated only on a throwaway prototype, and its amendments were tested
  **one at a time** (parent §2; `f_final-stress.md` «Coverage»).
- **Success measure.**
  - (a) The v3 suite is green in its own CI job. It covers the golden fixture, per-month rules, clamps,
    pins, cadence, floors, caps, determinism and budgets.
  - (b) The acceptance matrix (§12.3) passes on the fictitious roster in the repo. Its private
    real-data re-run passes outside the repo, with only aggregates recorded.
  - (c) The F13 tolerance is measured and recorded.
  - (d) After merge and Frank's manual creation, the function answers the ping and the smoke solve
    (§11.5), and nothing routes to it.

## 2. Evidence

| Fact | Source | Implication for C5 |
|---|---|---|
| v2's handler fails closed: 503 if `OWT_SOLVER_API_KEY` is unset, 401 on mismatch, 422 on `ok:false`, 500 on anything unexpected | `gcf/main.py:39-65` | v3 keeps the same guard and status map (§11.2) |
| v2's handler imports v2 at module scope | `gcf/main.py:20` | A v3 entry point inside `gcf/` would couple the two deploys. The parent's separate `gcf_v3/` avoids it (E1) |
| `weeks` is guarded to 3–6 | `gcf/owt_solver_v2.py:634-635` | v3 has no weeks: services are dated (S1) |
| v2 refuses more than 100 pins rather than truncating | `owt_solver_v2.py:87-91`, `:362-364` | v3 also refuses and never truncates, under its own cap (§5.5) |
| v2 refuses malformed pins, out-of-range pins, and two different seats for one person in one service | `owt_solver_v2.py:348-405` | v3 makes the same refusals, keyed by service (§5.5, §5.8) |
| Under pins, six rule families go soft per instance. The report is re-evaluated from the assignment, never read off the violation booleans | `owt_solver_v2.py:1005-1020`, `:1508-1514`; ADR-0041 | F15 applies this to every v3 run (§6.7, §8) |
| Solve 0 minimises violations first, and its value is a ceiling on every later solve | `owt_solver_v2.py:1657-1680`; ADR-0041 | This becomes v3's first stage (§7) |
| v2 draws a random seed when the request has none, and uses `RANDOMIZED_SEARCH` when optimising | `owt_solver_v2.py:1487-1492` | v3 requires a seed and fixes its parameters (S5, §7.2) |
| Budget knobs are clamped on the server, so an authenticated caller cannot hold the container | `owt_solver_v2.py:1792-1830` | v3's knobs clamp **down only** (§5.7) |
| `--json-mode` reads one request on stdin and writes one response | `owt_solver_v2.py:1872-1880`; spawned at `app/api/admin/solve/route.ts:120-159` | v3 ships the equivalent CLI for C6's local path (§11.1) |
| The function runs gen2 on python312, with 512 MB, 1 vCPU, a 120 s timeout and its secret from Secret Manager. There is no `--allow-unauthenticated`, because the build account cannot set IAM | `cloudbuild.yaml:13-42` | v3 uses the same envelope. Frank does the first creation and the grant (E1, §11.4) |
| v2's trigger filter is `gcf/**` and `cloudbuild.yaml` | `cloudbuild.yaml:3-4`; `docs/SOLVER_AND_INFRA.md:458-460` | `gcf_v3/**` falls outside it. v3's build config must not be the root `cloudbuild.yaml` (§11.3) |
| The manual script hard-codes `owt-solver` and entry point `solve`, omits `--gen2`, and passes `--allow-unauthenticated` | `scripts/deploy-solver-gcf.sh:27,37-48` | v3 gets its own script, which cannot touch v2 and passes `--gen2` (§11.4) |
| The pinned ortools is 9.15.6755. It exposes `max_deterministic_time`, `linearization_level` and `num_search_workers`, and reports each stage's deterministic time | `gcf/requirements.txt:4`; checked in the `owt-roles` env, 2026-10-05 | The S3 settings can be implemented as written |
| CI runs `python -m unittest discover -s gcf -t gcf` inside the single `gates` job. The job limit is 25 min; the solver step measured 9m43s | `.github/workflows/ci.yml:34,72-73`; `u_solver-tests-fixb.md` §2 | v3's tests need their own job (C0). `discover -s gcf` cannot find `gcf_v3/` |
| A Mac and the CI runner both proved one seed optimal, yet returned schedules that differed in 7 of 16 cells | `docs/CI.md:58-62` | Determinism is promised per platform only (§10) |
| `OWT_SOLVER_API_KEY` is one Secret Manager secret, with the same value in Vercel Preview and Production. Rotation step 3 redeploys the trigger `owt-solver-deploy` | `docs/SECRETS.md:485-575` | Reusing the key (Q5 default) changes that entry: a second function to redeploy on rotation (§11.6) |
| Verifying a function deploy means `describe` shows ACTIVE with a fresh `updateTime`, then a smoke request with the key piped, never printed | `docs/SOLVER_AND_INFRA.md:471-523` | v3's verification follows this and adds a build SHA (§11.5) |
| The prototype ran pre-amendment on real Nov+Dec data: 19 of 19 stages proven in 0.48–0.53 s (Mac, 1 worker, lin 2). 12-month chains met every protection | `evidence/f_final-proto.md` §3, §5, §6 | Feasible and fast. Re-proven under the amended policy (§12.3) |
| With `linearization_level=1`, a BGV most-owed stage was still unproven after 60 s. Level 2 proved it in milliseconds | `f_final-proto.md` §6 | Level 2 is a fixed setting (§7.2) |
| A 0.12 s budget left 16 stages unrun and produced a schedule that was legal but unfair | `f_final-proto.md` §6 (`budget_test.txt`) | Partial results are usable only because floors rank above balances. The status must be reported prominently (§7.3) |
| With hard rules, rule-breaking pins failed whole runs. With soft rules and a violation stage, every run completed in about 0.5 s and named each break | `f_final-stress.md` §1 | F15 applies always (§6.7, §7) |
| A stored service with 3 Leads failed even with soft rules, until rows grew to fit their pins | `f_final-stress.md` §1; `stress/v3p.py` `_build_grow` | Rows grow to fit pins (§6.1) |
| An `==` rule whose value exceeds the person's available services failed the run, and stored July availability already produces this case | `f_final-stress.md`, extra finding | Clamp before the solve (§6.7) |
| A pinned Sunday in an off month still earned the compensation Saturday | `f_final-stress.md` §1 | X2 is part of the compensation objective (§7.1, stage 4) |
| Determinism held across hash seeds and processes whenever every stage was proven. With tiny caps, one seed gave 2–3 different schedules | `f_final-stress.md` §9 | S5 as stated, plus a canonical-order requirement (§10) |
| Assignment-dependent shares took 46–48 s, with 7–8 of 15 stages capped. Planned shares took about 1 s, all stages proven | `d_prototype.md` «Pitfalls» 1 | Shares are fixed numbers computed before the solve (F13, §6.5) |
| Planned and post-solve shares differed by up to 0.23 seat without pins, and by up to 0.32 with pins (0.5 in the presence sub-line) | `f_final-proto.md` §8.8; `f_final-stress.md` §1 | Measure the gap under the final rules and fix the tolerance (§12.4) |
| Every floor and cap stage had objective 0 in every prototype run. F6, the floor seat as written, pin-aware shares and the floor skips were never run | `f_final-proto.md` §8.10; `f_final-stress.md` «Coverage» | The acceptance must exercise each of them (§12.3) |
| The prototype's draft of reason codes still lists `sat_anchor` and `rate_reduced`, and has no codes for floors, caps or compensation | `f_final-stress.md` §2; `prototype/v3/reason_codes.json` | v3 needs a new code list (§9) |

## 3. Scope

### In scope

- **`gcf_v3/` with package `owt_v3`**, containing:
  - the request parser and validator;
  - the planned-share computation (F13);
  - the CP-SAT model and stages (F12, F15);
  - the post-solve report (S4);
  - the Python implementation of the shared ledger formula (F14).
- **Entry points and deployment files:**
  - the HTTP entry point (`gcf_v3/main.py`, entry point `solve`);
  - the `--json-mode` CLI (`gcf_v3/owt_solver_v3.py`);
  - `requirements.txt`, `.gcloudignore` and `cloudbuild.yaml`;
  - the manual deploy script `scripts/deploy-solver-v3-gcf.sh`.
- **Shared constants:** the code list `gcf_v3/owt_v3/codes.json` and the pin-cap constant.
- **Tests and acceptance:**
  - the v3 test suite;
  - the acceptance harness (`gcf_v3/acceptance/`) and the fictitious realistic world;
  - the measurement of the F13 tolerance;
  - the definition of the real-container timing gate.
- **Documentation** delivered in the same change (§14).

### Non-goals

- **v2.** Nothing changes in `gcf/`, v2's tests, its golden schedules, its trigger or its manual script
  (parent §10, E1).
- **The engine switch (A1).** C1's `SOLVER_ENGINE` constant; C2's effective-engine resolver, the
  Preview-only `OWT_SOLVER_ENGINE` override and its `docs/SECRETS.md` entry; C6's `409
  solver_version_mismatch`. The function never reads an engine: it answers `contract: 3` or refuses.
- **C6.** The route, the client, `OWT_SOLVER_V3_URL` (documented by C6 DOC-1, set on Vercel by C7), the Spanish copy, the request
  builder (including `prior`, A15), the past-month refusal (A24) and the «Equidad» panel. The function
  never reads the clock, so it cannot tell a past month from a future one.
- **The other children:**
  - C2: the ledger over stored data, the single v3 eligibility resolver (A7), the X1 cadence-state
    function, authorship of the golden fixture, the eligibility record (`fairnessMonth.YYYY-MM`, A2)
    and the one display formatter (A17).
  - C4: the record's reconstruction.
  - C1: the toggle.
  - C3: the cadence setting.
  - C7: running the timing gate, the Preview rehearsal and the flip.
- **Out of the parent's scope:** instruments, FOH, kids and MCP `solve_month` (parent §10).
- **Specials.** v3 never fills a special; a special reaches it only as pins (parent U3, ADR-0010 as
  amended).

## 4. Decisions

The parent's decisions are inherited and not reopened: D1–D15, X1–X4, F1–F15, S1–S6, E1 and the
amendments A1–A39. The decisions below are this spec's readings where a contract needs more precision
than the parent gives. Where an amendment settled the point, the «Why» column cites it.

| ID | Decision | Why | Tradeoff |
|---|---|---|---|
| C5-1 | Each service has an opaque `id`. A pin carries the service `id` and its `date`, and the two must agree. | A15. Two services can share a date: a Sunday-dated counted special next to the Sunday service, or two specials on one day (ADR-0011). | One more field per pin. |
| C5-2 | **Pattern exclusions (`!in`) and week exclusions arrive inside eligibility.** C2's resolver folds them into the record, so they are hard, except on a pinned seat's own row. The soft rule families are counts, pairs, presence, consecutive and the mandatory lead. There is no `week_exclusion` rule kind. | A15. v2 never made exclusions soft (ADR-0041 lists six soft families). C2 stores them as date blocks (rule-excluded, outside the population). F12: «a seat only for someone eligible and available (or pinned)». | An admin cannot have a «Sem 3» exclusion «broken» to save another rule. v2 did not allow that either. |
| C5-3 | **Protections (F7, F9, F10, F11) and fairness lines see counted services only.** Rules (counts, pairs, presence, consecutive, mandatory lead) apply to every weekend service in the request, counted or not, and never to a special. | A13. X1 defines «led» over counted Sundays; ADR-0010 keeps rules off specials. | Two Sunday leads in one month are not a cap miss when one of those Sundays is uncounted. |
| C5-4 | **Rule role sets and count values arrive resolved.** A rule carries `roles` (the six role keys, expanded by C2's one v3 pattern expansion) and an integer `value`. A relative cap is already resolved against its month's full Sunday count by the caller, using C2's one per-month count resolution; a result below 0 is sent as 0 and noticed by the caller (C6 RQ-5). v3 has no pattern parser, never sees `{weeks-N}`, and refuses a negative value. | A15. One expansion and one resolution, the ones the record stores, mean that request and record cannot disagree. | — |
| C5-5 | The cadence state on the wire has three values: `on`, `off` and `out`. `out` is X1's «off» with no compensation Saturday: she is not eligible for Sun.Lead that month (C2's CAD-1 reason `not_eligible`). | A14. From resolved eligibility alone, the solver cannot tell «not in the pool» from «unavailable every Sunday», and only the second earns the Saturday. | The caller maps CAD-1's reason to `out`. |
| C5-6 | The mandatory lead stays one of ADR-0041's soft families, counted in the rules stage. Fill's weights still rank Lead first. A `solve` weekend service where nobody is eligible or pinned for Lead has no mandatory-lead instance. Its Lead seats come back unfilled with reason `no_possible_lead` (S2), not as a violation. | A19. F15 keeps ADR-0041's mechanism unchanged. | A leaderless service and a broken cap cost one violation each, as in ADR-0041. |
| C5-7 | The report gives two shares per person and line. `planned` is F13's: fixed before the solve and used by the objective. `share` is F14's: the shared ledger formula applied to the returned assignment. Then `after = carried + share − received`. | A19. `after` («queda») must equal what C2's ledger will compute for the same services. The gap between `planned` and `share` is exactly what F13 measures. | Two numbers per line. C6 chooses which to show. |
| C5-8 | Each person-line `share` is computed in exact rationals and rounded **once** to integer hundredths, half away from zero. Nothing is rounded per service. `received` and `pinned` are exact (100 × a seat count). A balance is **never rounded on its own**: `after` is the identity `carried + share − received` over the wire hundredths, as C2's `balance` is `share − received` (LG-13, A39); the two differ from a separately rounded exact balance only at a half. The two display figures, `share` and `after`, also cross the wire as integer **tenths**, each rounded once, half away from zero, from the same rational the hundredths come from — never from the hundredths (§8.2). For `share` that rational is exact. For `after` it is the request's `carried` (already hundredths, §5.3) plus the exact `share` minus `received` (A32: «Queda» may differ from «Saldo» by 0.1 at a tie, accepted). The same holds for each person's display **tabs** (DL, SL, BGV with its `P:*` sub-lines folded, CORO, TOTAL; C2 LG-14's folds): their figures are rounded once from the exact sum of their lines, never summed from the lines' hundredths or tenths (§8.2). **Seat counts** cross the wire as integers beside the hundredths, per line and per tab: `seats` (= `received` ÷ 100) and `pinned_seats` (= `pinned` ÷ 100), emitted by the function so no consumer divides (A39). The function never formats a figure: the panel writes C5's tenths through C2's single formatter, which takes tenths only (A17, C2 UI-4), and renders seat counts as emitted. | A17, A32, A39. Identical to C2's LG-13, hundredths and tenths, so both languages produce the same bits. C2 UI-4 forbids deriving tenths from hundredths under `app/**`, and C6 EQ-5 forbids the panel to sum or divide, so without C5's tenths and seat counts, per line and per tab, «Queda», «En este plan» and «Los pines tomaron {n} lugares» would have no compliant input on any tab, the folded BGV and Total included (C6 S-11, S-12). C2 solves the same problem for its own figures with `tabs` and `Figures.seats` (C2 §7, LG-13). | Four more integers per line, and one small object per tab. |
| C5-9 | **Placing a monthly set-aside in the plan.** First subtract the person's pinned seats that already meet it. Spread the remainder evenly over her `solve` services in that month where she is eligible for a matching role and holds no pin. Within one service, split it equally among her eligible matching roles. | F5's «spread evenly» does not say how pins interact. Spreading over `fixed` services, where no seat can be given, or counting a pin twice would misstate the pool. | One more rule for C6 to explain. |
| C5-10 | **The realised formula is C2's.** The populations, presence seat, set-asides, sub-lines and floor seat in the report (and in the model's received count) follow C2's LG-4 to LG-11, translated into request terms (§6). Translation: a pin counts as a stored seat; `eligible` replaces «in ∧ available ∧ not rule-excluded»; `count ==` rules replace exact statuses. Where C2's text and an amendment differ, the amendment wins on both sides (today: the floor skip, C5-15, A33). **One seat per person per service** (§6.6, C2 LG-4): where the formula's input holds one person more than once among a service's voice seats, the seat ranked first by Lead > BGV > Choir is hers and every other is a `second_seat` set-aside, checked first — it credits nobody, owes nobody, leaves the pool as it would be without it and moves no population. That is exactly what C6 sends (ST-6) and what C5 can receive (§5.5 `pin_conflict`). | F14 and A18 require one formula, and the golden fixture (C2's) is its guard. A double seat C5 never receives must still be read the same way by both formulas, or «Queda» and the next ledger read differ for that service. | A later change to C2's LG rules is a change to C5. |
| C5-11 | F10 (the DL floor) is read per month. For each horizon month m in which a DL-line person is available, require her Sunday leads in m−1 plus her Sunday leads in m to be at least 1. The pair is skipped when m−1 is before her first DL-eligible month (`dl_since`, A15), or when m−1 is the stored previous month and has no stored services. | This follows F10's sentence. The prototype also demanded a lead in m1 when the person was available only in m1 of an (m1, m2) pair. | Differs from the prototype in that one case. |
| C5-12 | Capacity is computed once per run, over the run's months, for the people whose floor the previous month has not already met (§6.8). | A19. | — |
| C5-13 | The pin cap is **250**. A request over it is refused. | A two-month board with 5 Sundays a month and a Saturday every week has 130 voice seats. Counted specials add their own seats as pins. 250 bounds how far rows can grow and still leaves headroom. | — |
| C5-14 | Reuse `OWT_SOLVER_API_KEY` (parent Q5 default). | Same trust boundary, same caller. A second key would double every rotation without a separation that matters: a leaked key buys CPU on either function, never data. | One rotation now redeploys two functions (§11.6). |
| C5-15 | **The floor skip is A12's and A33's: only a fixed seat, exact or cadence.** Realised: no floor set-aside in m for a person who holds, in m, a seat set aside for reason (a) `exact` or (b) `cadence` (§6.3). In the plan, where nothing is held yet, «holds a fixed seat» means: her clamped `==` value is ≥ 1 for some rule in m, or her cadence state in m is `on`, or she holds a pinned seat in m set aside for (a) or (b). A seat set aside as `outside_population` does not skip the floor. | A12 names «exact or cadence»; A33 confirms that a pinned seat outside the population does not cancel the floor. The plan has no seats before the solve, so it reads the monthly set-asides that will produce them. | A floor person whose `on` Sunday is missed has a different floor status in the plan and the report (measured, §12.4). |
| C5-16 | **`presence` and `pair` may be scoped to one month.** Each accepts an optional `month`, as `count` has. A month-scoped object applies only at that month's services; an object without `month` applies across the horizon. | Parent S1 («rules … scoped per month») and A6: a record-bound month carries its own presence snapshot, which may differ from the on-screen rule an unrecorded month uses (C6 sibling issue S-3). | One more validation rule (§5.4). |

## 5. Request contract (S1) — `contract: 3`

One JSON object.

- Unknown keys at any level are refused (`invalid_request`), so a misspelt field never falls back to a
  default.
- All fairness quantities are integers in hundredths of a seat, and positive means owed («le deben»).
- Dates are `YYYY-MM-DD` on the CDMX calendar; months are `YYYY-MM`.
- **Role keys** are the six of C2's record: `Sun.Lead`, `Sat.Lead`, `Sun.BGV`, `Sat.BGV`,
  `Sun.Choir` and `Sat.Choir`.

### 5.1 Envelope

| Field | Type | Required | Contract |
|---|---|---|---|
| `contract` | `3` | yes | Any other value gets `contract_mismatch` (§9) |
| `ping` | `true` | no | When present, the function answers §8.4 and ignores every other field |
| `request_id` | string, 1–64 chars | no | Echoed. Never logged next to anything personal |
| `seed` | integer 0–2147483647 | yes | The only source of randomness (S5) |
| `months` | 1 or 2 consecutive `YYYY-MM`, ascending | yes | The horizon |
| `services` | array, 1–40 (§5.2) | yes | Every service the solver fills or has to account for |
| `people` | array, 1–100 (§5.3) | yes | Everyone named anywhere in the request |
| `rules` | array, 0–500 (§5.4) | yes | May be empty |
| `pins` | array, 0–250 (§5.5) | yes | May be empty |
| `prior` | object (§5.6) | yes | Facts about the stored past that the solver needs |
| `budget` | object (§5.7) | no | Can lower the defaults; can never raise them |

### 5.2 Services

| Field | Type | Contract |
|---|---|---|
| `id` | string, 1–64 chars, `[A-Za-z0-9:._-]` | Unique within the request and opaque to the solver. For a stored service it is the document's `_id`, so ties break as C2's ledger breaks them (§6.4) |
| `date` | `YYYY-MM-DD` | Must fall inside one of `months` |
| `month` | `YYYY-MM` | Must equal the month of `date`. A trailing Saturday belongs to its own calendar month (ADR-0048) |
| `kind` | `"sunday"` \| `"saturday"` \| `"special"` | A `sunday` must fall on a Sunday and a `saturday` on a Saturday. At most one of each per date |
| `time` | `"HH:mm"` | Optional. Used only as a tie-break (§6.4). An absent `time` sorts first |
| `fixed` | bool | `false`: the solver fills the service's seats. `true`: the service's seats are exactly its pins and the solver adds nothing. Stored services in the horizon (U2) and counted specials (U3) are fixed. A `special` must be `fixed` |
| `counts` | bool | C1's effective `countsForFairness`. A `special` must have `counts: true`: uncounted specials are never sent (U3) |
| `seats` | `{ "Lead": n, "BGV": n, "Choir": n }`, each 0–6 | Required when `fixed` is false; ignored when it is true. A non-fixed `saturday` must have no `Choir` key, or a value of 0: v2 never fills Saturday Choir |

**Line and role-key map.** This is the one definition (F1, D14, C2's LG-4):

| Service | Lead | BGV | Choir |
|---|---|---|---|
| `sunday`, or a `special` dated on a Sunday | DL / `Sun.Lead` | BGV / `Sun.BGV` | CORO / `Sun.Choir` |
| `saturday`, or a `special` on any other day | SL / `Sat.Lead` | BGV / `Sat.BGV` | CORO / `Sat.Choir` |

Rule instances never include a special (C5-3). For a special, the role key is used only for
population exits. «DL-mapped lead» means a Lead seat whose line is DL; «SL-mapped lead» means one whose
line is SL.

### 5.3 People

| Field | Type | Contract |
|---|---|---|
| `id` | string, 1–64 chars | The stable member id (`teamMembers._id`). Unique |
| `name` | string | For display only. Never used in logic, never logged |
| `exempt` | bool, default false | «Exenta». Removes the person from the voice floor and from its floor seat, and nothing else: every line still counts her (F8, D13) |
| `eligibility` | `{ "<service id>": ["Lead" \| "BGV" \| "Choir", …] }` | The roles the person may hold at each service. **Already resolved by the caller from C2's single v3 eligibility resolver (A7)**, or from the month's record when the record binds (A6). That source covers Tipo, pools, `!in` patterns, week exclusions, and roles with status `out` (a resolved count of 0 included); a role is eligible when its status is `in` or `exact` (A3), by the day class of the service (A13). Two more inputs are folded in: availability on that date (record snapshot ∪ live `unavailableDates`, F4) and, for a special, the eligibility of its D14 line. Every key must be a request service |
| `carried` | `{ line key: int }` | Carried balance per line, from C2's 3-month window (F2–F3). Positive means owed. Keys are `DL`, `SL`, `BGV`, `CORO` and `P:<presence rule id>`; a missing key means 0. Each value must satisfy \|v\| ≤ 10000 (input validation, not a policy cap). A `P:` key with no matching presence rule in the request is accepted and reported as a carried-only line (§8.2). Any other key is refused |
| `cadence` | `{ "YYYY-MM": "on" \| "off" \| "out" }` | Present if and only if the person is «Mes por medio» (C3). It must have exactly one entry per request month, from C2's X1 function as mapped by C5-5 (F7, A14). A person with `cadence` who also has an `==` count rule containing `Sun.Lead` is refused (`invalid_request`, with `field` naming her entry). C6 refuses the same case first, naming the person (A11) |
| `dl_since` | `YYYY-MM` or `null` | The person's first recorded DL eligibility (A15): the first month whose eligibility marks her `Sun.Lead` «in». C6 takes C2's `firstRecordedIn["Sun.Lead"]`, or the first unrecorded horizon month whose source marks her «in» (C6 RQ-4). `null` means never. Used only for the F10 skip |
| `prev_dl_leads` | int ≥ 0 | Her Sunday leads in the month before the run (A15): the DL-mapped lead seats she held at counted services in `prior.month` (F10). C6 counts C2's `countedSundayLeads` entries in that month (C6 RQ-4) |

### 5.4 Rules

Every rule carries an `id` that matches `[A-Za-z0-9_-]{1,64}`. The `id` is the caller's stable
identifier for the rule; the function treats it as opaque and echoes it in the report. Mapping it back
to the rule card is C6's (RQ-5 mints a compliant, stable id when a config item's key is not one, or is
not unique across rule kinds, and keeps the key for display). `roles` is a non-empty list of role keys.
Every person id must appear in `people`. A `month`, where given, must be a request month. For each
`id`, either one object carries no `month` (horizon-wide), or every object carries one and `(id,
month)` is unique; an `id` that mixes the two is refused. `count` always carries `month`;
`consecutive` never does.

| `kind` | Fields | Scope and instances |
|---|---|---|
| `count` | `person`, `roles`, `op` (`==`, `<=`, `>=`), `month`, `value` (integer ≥ 0) | One object per rule per month; `month` must be a request month, and `(id, month)` is unique. **Instance** (`id`, `month`): the person's seats in `roles` at the weekend services of that month (fixed and non-fixed alike), compared with `value`. **At most one exact count per role key (A38):** in one month, no two of a person's `==` rules may list a common role key; such a request is refused (§5.8). **Exact status:** in that month, role key k is «exact» for the person if and only if her `==` rule listing k has a value ≥ 1 (C2's REC-3/RES-3) |
| `pair` | `persons` (exactly 2), `roles`, `month`? | Applies across the whole horizon, or only to the services of `month` when it is present (C5-16). **Instance:** each weekend service in scope where both people have a term. At most one of them holds a role in `roles` there |
| `presence` | `persons` (≥ 1, ordered), `roles`, `exclusive` (bool), `month`? | Applies across the whole horizon, or only to the services of `month` when it is present (C5-16). `exclusive` is C2's RES-6 value, copied as is. **Instance:** each weekend service in scope with a role key in `roles`, where at least one member holds such a role. This is per service, not per week as in v2's `each_week`, because F5 and F6 are per service. `P:<id>` is the rule's sub-line: one line per `id`, whatever its scoping; at each service its members, roles and exclusivity are those of the object in scope there |
| `consecutive` | `person`, `roles` | Applies across the whole horizon plus `prior.services`. A weekend is the Sunday on or after the service's date. **Instance:** each pair of weekends 7 days apart where the person has a term in both. Broken if and only if she holds a matching seat in both. Today's UI does not emit this rule; it is here because S1 names it |

### 5.5 Pins

`{ "service": id, "date": "YYYY-MM-DD", "role": "Lead" | "BGV" | "Choir", "person": id }`.

- `date` must equal the date of `service` (C5-1).
- `role` must be a role of that service. A non-fixed Saturday has no Choir.
- A pin is a fixed variable (ADR-0041). It grants candidacy on its own row only, and on that row it is
  exempt from eligibility and availability (F15).
- On a `fixed` service, the pins are the service's seats.
- Exact duplicates collapse into one pin.
- These pins are refused:
  - two different pins for one person at one service (`pin_conflict`);
  - more than 250 pins in total (`too_many_pins`). The request is refused, never truncated (C5-13).

### 5.6 Prior

`{ "month": "YYYY-MM", "has_services": bool, "services": [ { "date", "kind", "counts": bool, "seats": { "Lead": [ids], "BGV": [ids], "Choir": [ids] } } ] }`

C6 builds it from the full-roster `GET /api/admin/roles` read the planner already holds, never from
the ledger (A15; C6 RQ-7).

- `month` is `months[0]` minus one month.
- `has_services` is true if and only if `month` holds a stored weekend service or a stored counted
  special (F10 skip).
- `services` lists every stored weekend service, counted or not, and every stored counted special,
  dated from 14 days before the first day of `months[0]` up to the day before it. This is the parent's
  «last stored weekend before the run». The window is long enough to include the previous calendar
  month's trailing Saturday, which shares a weekend with the first horizon Sunday.

These services are used only as constants:

- in `consecutive` rule instances, which count all weekend services;
- in the `no_consecutive` protection, which counts counted services only (C5-3).

Unknown ids are ignored.

### 5.7 Budget knobs

`{ "total_seconds": n, "stage_seconds": n, "stage_det_limit": n }`. Each knob is clamped into the
range from its minimum to its default:

- `total_seconds`: 1–25 s.
- `stage_seconds` (the wall-clock guard for each stage): 0.05–2.5 s.
- `stage_det_limit` (the deterministic limit): 0.001 up to `STAGE_DET_LIMIT`.

The knobs exist for tests and for the timing gate. Production requests omit them.

### 5.8 Validation

Validation runs **before any solve**. Every refusal is `ok: false` with a code (§9) and HTTP 422,
never a 500. It covers:

- shapes, types and ranges, and unknown keys;
- dates against `months`, and kind against weekday;
- the `fixed` and `counts` rules for specials;
- id resolution: every person and service id named anywhere must exist;
- duplicate service ids, duplicate `(id, month)` pairs, and a rule `id` that mixes month-scoped and
  horizon-wide objects (§5.4);
- the `prior.month` arithmetic;
- that every cadence member covers every request month;
- the conflict between `cadence` and an exact `Sun.Lead` rule;
- two `==` count rules of one person in one month that list a common role key (A38): `invalid_request`,
  with `field` naming the second rule in codepoint order of `id`. C5 never receives such a pair from a
  compliant caller (C3 refuses saving it, C2's validator and resolver refuse it); the refusal is
  defence in depth;
- the pin checks in §5.5;
- negative values.

It never compares a month with today's date: refusing a horizon with a past month is C6's (A24).

### 5.9 Example (fictitious, abbreviated)

```json
{ "contract": 3, "request_id": "r-7f3a", "seed": 418207, "months": ["2026-11"],
  "services": [
    { "id": "p-2026-11-01-sun", "date": "2026-11-01", "month": "2026-11", "kind": "sunday",
      "fixed": false, "counts": true, "seats": { "Lead": 2, "BGV": 3, "Choir": 3 } },
    { "id": "p-2026-11-07-sat", "date": "2026-11-07", "month": "2026-11", "kind": "saturday",
      "fixed": false, "counts": true, "seats": { "Lead": 2, "BGV": 3 } },
    { "id": "sundayRole-8f2c", "date": "2026-11-08", "month": "2026-11", "kind": "sunday",
      "fixed": true, "counts": true } ],
  "people": [
    { "id": "m-ana", "name": "Ana", "exempt": false, "dl_since": "2026-05", "prev_dl_leads": 0,
      "eligibility": { "p-2026-11-01-sun": ["Lead", "BGV", "Choir"], "p-2026-11-07-sat": ["Lead"] },
      "carried": { "DL": 45, "CORO": -120 } },
    { "id": "m-carla", "name": "Carla", "exempt": false, "dl_since": "2026-05", "prev_dl_leads": 1,
      "cadence": { "2026-11": "off" },
      "eligibility": { "p-2026-11-01-sun": ["Lead", "Choir"], "p-2026-11-07-sat": ["Lead"] },
      "carried": { "SL": 30 } } ],
  "rules": [
    { "id": "cap-b1", "kind": "count", "person": "m-bruno", "roles": ["Sun.Lead"], "op": "==",
      "month": "2026-11", "value": 2 },
    { "id": "pr-1", "kind": "presence", "persons": ["m-dani", "m-eli"], "roles": ["Sun.BGV"], "exclusive": true },
    { "id": "cf-3", "kind": "pair", "persons": ["m-dani", "m-eli"], "roles": ["Sun.BGV", "Sat.BGV"] } ],
  "pins": [ { "service": "sundayRole-8f2c", "date": "2026-11-08", "role": "Lead", "person": "m-bruno" } ],
  "prior": { "month": "2026-10", "has_services": true,
             "services": [ { "date": "2026-10-25", "kind": "sunday", "counts": true,
                             "seats": { "Lead": ["m-ana", "m-bruno"], "BGV": [], "Choir": [] } } ] } }
```

## 6. The model

### 6.1 Hard, always (F12)

- **One seat per person per service.**
- **Who may sit.** A seat exists only for a person with that role in her `eligibility` for that service,
  or on a pinned row for its pin.
- **Pins hold.**
- **Row size.**
  - A non-fixed row holds at most `max(seats, pins in that row)`. Rows grow to fit their pins and never
    shrink.
  - A `fixed` service holds exactly its pins.

Nothing else is hard. Under these constraints a solution always exists: leave every unpinned seat
empty and seat the pins. **v3 therefore has no «no solution» outcome**; the only failure at solve time
is `timeout` (§7.3).

### 6.2 Populations (F4, F6, C5-10)

For each **counted** service s and each role key k it has, the normal population Pop(s, k) is computed
by C2's LG-8, in request terms: the people with that role in their eligibility at s, **minus**:

1. **Exact.** People for whom k is «exact» in the month of s (§5.4).
2. **Cadence.** People with `cadence`, when k maps to DL.
3. **Exclusive presence.** Members of an exclusive presence rule ρ that applies at s with k in ρ's
   roles.
4. **Sole presence member.** The only member of Q(ρ, s), for any ρ that applies at s. That member is
   out of every normal population at s, which is F6's one-available qualifier. Q(ρ, s) is the members
   eligible at s for a role key in ρ's roles that is not «exact» for them.
5. **Exact seat held.** Someone holding, at s, a seat whose role key is «exact» for them is out of the
   other roles' populations there. This applies to the realised report only (LG-8 (vii)), because it
   depends on the assignment.

**F6 in the plan only.** For planned shares, a seat decided before the solve also removes the person
from every other role at that service. A seat is decided in two cases:

- **Pins.** The person is pinned at s. C2 cannot see pins in stored data (LG-8), so this item is
  plan-only.
- **Exact rules with no slack.** The person's `==` rule has a clamped value equal to her count of
  available matching services that month (§6.7). This decides every one of those services.

A presence rule applies only at counted weekend services (LG-7, A13). Uncounted services have no
populations.

### 6.3 Presence seat, set-asides and pools (F5, LG-7, LG-9, LG-10)

**The presence seat π(ρ, s)** is the first seat at s that meets both conditions:

- its role key is in ρ's roles;
- its holder is a member of ρ.

Seats are ordered Lead > BGV > Choir, then by holder order. In both the response and the model, holder
order is codepoint order of member ids. Rules are taken in codepoint order of `id`, and a seat serves
at most one rule. If π's holder is not in Q(ρ, s), π is set aside and the sub-line pool at s is 0.

**Set-asides at (s, k), realised.** A seat other than a presence seat is set aside when its holder:

- (a) has k «exact» (reason `exact`);
- (b) holds a DL-mapped seat and has `cadence` (`cadence`);
- (c) is otherwise not in Pop(s, k) (`outside_population`); this includes a pinned holder without that
  role in her eligibility;
- (e) holds her floor seat, chosen as in §6.4 (`floor`).

Reason (d) `not_in_record` cannot occur in a request: every holder is in `people`. Reason
`second_seat` (C2 LG-9, checked first) is applied by the shared function to stored inputs only (§6.6);
it cannot occur on a returned assignment, which holds one seat per person per service (§6.1).

**Set-asides in the plan.** These reduce the pool at (s, k):

- **Pinned seats** held by someone not in Pop(s, k).
- **The forced presence seat.** One seat for each ρ that applies at s, split equally among ρ's role keys
  at s that have a member in Q or a pinned member.
- **Monthly set-asides**, placed by C5-9:
  - an `==` rule's clamped value, minus the person's pinned matching seats that month, floored at 0;
  - a cadence Sunday: 1 in an `on` month and 0 otherwise, minus the person's pinned DL-mapped lead
    seats that month, floored at 0;
  - the floor seat (§6.4).

The compensation Saturday is **not** set aside. It counts in SL (D11, the prototype's V6), so a cadence
member is an ordinary SL member.

**Pools (LG-10).** Pool(s, k) is `seats − set-asides − presence seats`. Each member of Pop(s, k)
receives `Pool / |Pop(s, k)|`. A sub-line's pool is 1 when π exists and its holder is in Q(ρ, s), and 0
otherwise. Each member of Q receives `pool / |Q|`.

### 6.4 The floor seat (F5, F9, A12; LG-11)

**Who gets one (realised).** Person p gets one floor set-aside in month m when all of these hold:

- p is not exempt;
- p is in some Pop or Q at a counted service of m;
- p's combined share over every line and sub-line of m, computed exactly from the seats actually
  held and **without** floor set-asides, is **below 1** (A12's stored-seat share);
- p has at least one received seat in m;
- p holds **no fixed seat** in m: no seat set aside for reason (a) `exact` or (b) `cadence` (A12,
  C5-15). A fixed seat has already met the floor. A seat set aside as (c) `outside_population` does
  not count as fixed.

**Which seat.** The floor seat is p's first received seat in m, ordered by:

1. date;
2. role, Lead > BGV > Choir;
3. service `time` (absent first, then lexical);
4. service `id`.

A presence seat qualifies.

**In the plan.** p is a floor person when she meets the same conditions on `planned` shares, except
that she need not hold a seat yet, and «holds no fixed seat» reads as C5-15 states for the plan: no
clamped `==` value ≥ 1 in m, no cadence state `on` in m, and no pinned seat in m set aside for (a) or
(b). Her set-aside is placed as follows:

- She holds a received pinned seat in m: the earliest one, in the order above, is the set-aside.
- Otherwise: one seat spread over her eligible voice roles at counted non-fixed services in m, as in
  C5-9.

*This has not been tested as written* (parent F5). §12.3 must prove that it bounds the balances of the
Saturday-only support singers.

### 6.5 Planned shares (F13)

Planned shares are fixed numbers, computed from the request alone, before the solve:

- **Base** at counted (s, k): for a non-fixed service, the grown row size; for a `fixed` service, its
  number of pins.
- **Pool:** `max(0, base − set-asides in the plan)`.
- **Shares:** as in §6.3.
- **Rounding:** exact rational sums per (person, line), rounded once (C5-8), give `planned`.

Floor persons are found in a first pass that ignores floor set-asides. Shares are then recomputed with
them. A share that depends on the assignment is **forbidden** (F13).

### 6.6 Received and the shared formula (F14)

One pure Python function implements §6.2–§6.4 in their realised form, computing per (person, line)
`share` and `received`. Its inputs are:

- services with their seat holders;
- eligibility;
- rules;
- cadence settings;
- exempt flags.

It uses **filled** seats as the base and **actual** seats as the set-asides.

**One seat per person per service** (C2 LG-4, stated identically). When the function's input holds
one person more than once among a service's voice seats — two role keys, or one role key twice (a
repeated entry) — her seat at that service is the first in the order Lead > BGV > Choir, and every
further seat of hers there is a **second seat**, treated as decided: set aside with reason
`second_seat`, checked first, before populations, presence seats, set-asides and the floor are
computed. It therefore leaves the pool exactly as it would be without that seat, credits and owes
nobody, and is invisible to every rule that reads held seats: the presence seat, the exact-seat
population exit (§6.2 item 5), set-aside reasons (a)–(e), and the floor (received seats, «no fixed
seat», the floor seat). It never cancels a floor or removes her from another population, whatever its
role key's status. Stored data can hold such a seat; a request cannot (§5.5 `pin_conflict`), and C6
sends the kept seat only (ST-6), so the realised report on the returned assignment and C2's next
ledger read of that stored service agree. In the **plan**, the kept seat is a pin, and a pin is
decided (§6.2): the person leaves the other roles' populations at that service, as for every pin; the
gap with the realised figure is the measured F13 gap (§12.4).

It runs in two places:

- **In the post-solve report**, on the returned assignment.
- **In the golden-fixture test**, against `fixtures/fairness/golden.json` (C2's file, read by both
  suites). A test-side adapter resolves each `ledger` case's records into the function's inputs exactly
  as C2's LG-5–LG-8 state.

**The model's received count for a line equals this function's `received` on the same assignment.** In
particular, the model applies §6.3's presence-seat attribution and §6.4's floor identification to its
decision variables, using the floor-person status from the plan. So the objective's view and the
report differ only in two ways, and both are measured (§12.4):

- `planned` versus `share`;
- a floor-person status that differs between the two passes.

Exact rational conservation holds at every counted (s, k) and every (ρ, s): the shares sum to the seats
received.

### 6.7 Rule instances, clamps and the violation count (S2, F15)

**Soft families.** Each instance has one violation boolean, and the report re-evaluates it from the
assignment:

- `count`, per rule `id` and month;
- `pair`, per service;
- `presence`, per service;
- `consecutive`, per weekend pair;
- `mandatory_lead`, per non-fixed weekend service where someone is eligible or pinned for Lead: at least
  one Lead seat must be filled.

**Clamps.** These are applied before the solve, in the model and in the planned shares, and each one is
reported as a notice (§8.1):

- **`==` or `>=` above what she can do.** The value clamps down to the person's **available matching
  services** in that month (`exact_clamped`, `min_clamped`). Those services are:
  - non-fixed weekend services where she is eligible for a matching role or pinned to one;
  - `fixed` weekend services where she is pinned to a matching role.
- **Presence with no member.** At a service where no member is eligible or pinned for a matching role,
  the presence rule does not apply (`presence_not_applicable`). Today this case is silent
  (`f_final-stress.md` §8).
- **No possible lead.** A non-fixed service where nobody is eligible or pinned for Lead has no
  `mandatory_lead` instance. Its Lead seats are reported unfilled with reason `no_possible_lead`.

Anything else that conflicts is a soft break, counted against the ceiling set in §7.1, stage 1.

### 6.8 The DL line, F10 instances and capacity

- **The DL line in month m.** A person is on it when all of these hold:
  - She is eligible for Lead at one or more counted `sunday` services in m, fixed or not, or she is
    pinned to a DL-mapped lead.
  - She has no `cadence`.
  - `Sun.Lead` is not «exact» for her in m.
- **F10 instance (p, m)** exists for each person p on the DL line in m (C5-11). It is skipped in two
  cases:
  - `dl_since` is `null`, or m−1 is earlier than `dl_since`;
  - m−1 equals `prior.month` and `has_services` is false.

  The previous month's leads are `prev_dl_leads`, a constant. A horizon month's leads are variables.
- **Capacity**, computed once per run (A19, C5-12):
  - **Seats:** the DL-mapped lead seats in the run's months.
  - **Subtract:** the clamped `==` values on `Sun.Lead`; one per cadence `on` state; and the DL-mapped
    pinned leads held by people not on the DL line who are not already counted in the first two
    subtractions.
  - **Population:** the people whose F10 instance is not already met by `prev_dl_leads`.
  - **Notice:** when population > capacity, the run emits a `dl_capacity` notice.

  For a two-month run of 4+4 Sundays under today's rule shapes, this gives 9 (parent F10).

## 7. Stages and settings (F12, S3)

### 7.1 Stages, in order

Each stage is solved, then fixed at the value it found before the next one runs: `≤` for a
minimisation, `≥` for fill. Each objective below is a contract on **what** is minimised; how it is
encoded is the plan's choice.

Notation: L(p, m) is p's DL-mapped lead seats at counted services in m. S(p, m) is her SL-mapped lead
seats there. V(p, m) is her voice seats there.

| # | Stage `id` | Objective | Notes |
|---|---|---|---|
| 1 | `rules` | Minimise the number of broken rule instances (§6.7) | Always runs (F15). Its value is the **violation ceiling**, which no later stage may raise |
| 2 | `fill` | Maximise Σ over non-fixed rows of W·filled, with W_Choir = 1, W_BGV = C + 1, W_Lead = (C + 1)(B + 1). C and B are the total Choir and BGV seats in non-fixed rows | Lead > BGV > Choir |
| 3 | `cadence` | Minimise Σ over cadence (t, m) of \|L(t, m) − a\|, with a = 1 for `on` and 0 for `off` or `out` | F7. A pinned Sunday counts as led (X1) |
| 4 | `compensation` | Minimise Σ over cadence (t, m) in state `off` of [L(t, m) = 0 and S(t, m) = 0] | D10 and X2: a month in which she led a Sunday owes her no Saturday. There is no set-aside (D11) |
| 5 | `voice_floor` | Minimise Σ over F9 instances of [V(p, m) = 0]. An F9 instance is a non-exempt p who is eligible or pinned for some role at a counted service in m | F9 |
| 6 | `dl_floor` | Minimise Σ over F10 instances of [leads(m−1) + L(p, m) = 0] | F10, §6.8 |
| 7 | `sunday_cap` | Minimise Σ over (p, m) of max(0, L(p, m) − 1), for each p for whom `Sun.Lead` is not «exact» in m | F11 |
| 8 | `saturday_cap` | Minimise Σ over (p, m) of max(0, S(p, m) − 1), for each p for whom `Sat.Lead` is not «exact» in m | F11, X3 (cadence members included) and A16 (exact-count leads excluded, as on Sundays) |
| 9 | `no_consecutive` | Minimise Σ over (p, d) of [p holds a DL-mapped lead at a counted service on Sunday d and on d + 7]. d + 7 is in the horizon; d may come from `prior.services` | D12 puts this **above balances**. The prototype placed it after them (its stage 18); §12.3 re-measures |
| 10… | `balance_max:<line>`, then `balance_sq:<line>`, for each line in the order `DL`, `SL`, `BGV`, each `P:<id>` in request order, `CORO` | `balance_max`: minimise M, with M ≥ K_p − 100·n_p for every p in the line's stage set. `balance_sq`: minimise Σ_p (K_p − 100·n_p)². K_p = carried + planned, in hundredths; n_p = the seats she received in the line | The stage set is the people in the line's population at one or more horizon services. People with only a carried balance are reported but not optimised |
| last | `tiebreak` | Minimise Σ w·x, with weights w ∈ {0…9} drawn from the seed over the decision variables in canonical order | Not fixed |

A stage with no terms is reported `proven` with value 0 and is not solved.

### 7.2 Settings

- `num_search_workers = 1`.
- `linearization_level = 2`.
- `random_seed` is the request's `seed`.
- **Per stage:** `max_deterministic_time = STAGE_DET_LIMIT`, and `max_time_in_seconds = min(2.5 s,
  remaining budget)`. That second limit is the **wall-clock guard**.
- Every other parameter is CP-SAT's default, fixed by the plan, and identical on every run.
- **Total budget:** 25 s, counted from the start of model build. Validation and planned shares run
  before it, and the report after it. Together they must take at most 1 s on the largest acceptance
  shape (§12.3).
- A stage is not started when less than 0.1 s of budget remains.

`STAGE_DET_LIMIT` is a constant the plan fixes from measurement (OQ-1). A stage stopped by the
deterministic limit gives the same result on any machine, which is what keeps runs reproducible on a
slow container.

### 7.3 Status semantics

Each stage ends with one status:

- **`proven`:** optimal.
- **`unproven`:** a limit stopped it with a solution. That solution is kept and its value is fixed.
- **`not_run`:** nothing from this stage was applied. A `reason` says why:
  - `budget`: it never started;
  - `no_solution_in_limit`: it started and found nothing;
  - `stopped_earlier`: an earlier stage ended the run.

Failures are handled as follows:

- **A stage after `fill` ends with `no_solution_in_limit`:** the run ends there. The schedule is the
  last stage's solution, and the remaining stages are `not_run` with reason `stopped_earlier`. A lower
  stage is never fixed while a higher one is missing.
- **`rules` or `fill` finds no solution within its limits:** the response is `ok: false` with code
  `timeout`, naming the stage. It is never «no solution», which does not exist (§6.1).
- **A proven INFEASIBLE in any stage** is a defect. It returns `internal_error` and logs only the stage
  id.

## 8. Response contract (S4)

### 8.1 Success (`ok: true`, HTTP 200)

| Field | Contract |
|---|---|
| `ok`, `contract: 3`, `engine: "v3"`, `solver_version`, `build` | `contract` and `engine` are always present; their absence is how a consumer knows the response is not from v3 (U8). `build` is `OWT_SOLVER_V3_BUILD`, or `"unknown"` |
| `request_id`, `seed`, `months` | Echoed |
| `reproducible` | True if and only if every stage is `proven` (S5) |
| `assignments` | `{ "<service id>": { "Lead": [ids], "BGV": [ids], "Choir": [ids] } }`. Every request service appears, keyed by its id echoed verbatim, with the roles it has. Within each role, ids are in codepoint order. A `fixed` service echoes its pins |
| `unfilled` | `[{ "service", "role", "count", "reason" }]`, one entry per non-fixed row with empty seats. `reason` is the first that applies: `no_possible_lead`; `no_candidate` (everyone eligible already holds another seat at that service); `rules` (seating any free eligible person would push the broken-instance count above the ceiling); `fill_not_proven` |
| `pins` | `{ "requested": n, "honored": n }`. `honored` comes from the assignment, never from the request; it is the handshake |
| `violations` | `[{ "code", "rule", "cause", "person"?, "persons"?, "month"?, "service"?, "weekends"?, "observed"?, "limit"? }]`, re-evaluated from the assignment (F15). `cause` is `pins` when the pinned seats and the prior constants alone break the instance, and `forced` otherwise. When several minimal sets have the same size, which instance gives is the solver's choice (ADR-0041) |
| `violation_ceiling` | `{ "value": n, "proven": bool }` |
| `stages` | `[{ "id", "status", "reason"?, "value", "bound", "limit", "ms", "det_milli" }]`, in run order. `limit` is `none`, `deterministic` or `wall`. `det_milli` is CP-SAT's deterministic time × 1000, rounded |
| `total_ms` | Wall time of the whole request |
| `fairness` | See §8.2 |
| `cadence` | `[{ "person", "month", "state", "sundays", "saturdays", "met", "compensation" }]`. `sundays` = L and `saturdays` = S. `met` means L equals a. `compensation` is `given`, `missed` or `not_applicable`; it is `not_applicable` when the state is `on` or `out`, or when L ≥ 1 (X2) |
| `missed` | Every missed protection: `[{ "code", "person", "month"?, "month1"?, "month2"?, "dates"?, "count"?, "cause" }]`. The codes are listed below |
| `notices` | `[{ "code", "params" }]`: `dl_capacity` {months, seats, people}; `exact_clamped` and `min_clamped` {rule, person, month, value, available}; `presence_not_applicable` {rule, service} |

**`missed` codes:**

- `cadence_on_missed`: state `on`, L = 0.
- `cadence_off_led`: state `off` or `out`, L ≥ 1. An `on` month with L ≥ 2 is reported as
  `sunday_cap_exceeded`.
- `compensation_missed`.
- `voice_floor_missed`.
- `dl_floor_missed`, with `month1` and `month2`.
- `sunday_cap_exceeded` and `saturday_cap_exceeded`, with `count`.
- `consecutive_sundays`, with `dates`.

**`missed` causes.** The first that applies is used:

1. `not_proven`: the stage that owns the protection is not `proven`.
2. `pins`: the pinned or prior seats alone produce the miss, or every slot that could have met it is at
   a service where she is pinned in another role.
3. `rule`: a cap missed because her own count rule forces it (a `>=` above 1). Two `==` rules over
   one role key never reach the function (A38, §5.8), so an `==` rule never produces this cause.
4. `unavailable`: she had no non-fixed slot that could meet it.
5. `capacity`: a `dl_floor_missed` in a run with a `dl_capacity` notice.
6. `higher_priority`: the owning stage proved this optimum, so something ranked above it left no room.

### 8.2 `fairness`

`{ "scale": 100, "tolerance": n, "lines": [line keys in stage order], "people": [ … ] }`

Each entry in `people` is `{ "person", "floor", "lines", "tabs" }`:

- **`floor`:** `[{ "month", "planned": bool, "realised": bool, "seat": { "service", "role" } | null }]`.
- **`lines`:** `{ "<line key>": { … } }`. Each line holds:
  - `carried`: from the request;
  - `planned`: F13;
  - `share`: F14, computed on the assignment;
  - `received`: 100 × the seats counted in the line;
  - `pinned`: the part of `received` that comes from pins;
  - `seats` and `pinned_seats`: integers of seats, `received` ÷ 100 and `pinned` ÷ 100 (both exact,
    since `received` and `pinned` are 100 × a seat count), emitted so no consumer divides (A39, the
    shape of C2's `Figures.seats`). Display counts only: never fairness figures, never fed to a
    computation;
  - `set_aside`: 100 × the seats she held in the line's services that were set aside;
  - `after`: `carried + share − received`. This is an identity, and a consumer may assert it;
  - `tenths`: `{ "share": int, "after": int }`, the display figures in tenths of a seat, the shape of
    C2's `Figures.tenths` (A17, C5-8). Each is rounded once by C2 LG-13's tenths rule,
    tenths = sign(x) · ⌊|x| · 10 + ½⌋, where x is in seats:
    - `share`: x is F14's exact rational share (the one `share` is rounded from);
    - `after`: x = `carried`/100 + the exact share − `received`/100, with `carried` as the request
      sent it (A32: it may differ from C2's «Saldo» tenths by 0.1 at a tie, accepted);
    - neither is ever computed from the hundredths: an exact 0.649 is tenths 6, never 65 → 7;
    - they are outputs only: no identity holds among the tenths, and no consumer may assert one or
      compute with them;
  - `in_stage`: bool;
  - `clamped`: true when a clamp changed her set-aside in this line.

A line appears for a person when any of these holds:

- she is in its population at one or more horizon services;
- she has a carried value for it;
- she received anything in it.

- **`tabs`:** `{ "DL"?, "SL"?, "BGV"?, "CORO"?, "TOTAL"? }`, the five display tabs of U5, in the key
  set and folds of C2's `tabs` (C2 §7, LG-14): `DL`, `SL` and `CORO` are their line; `BGV` is the
  `BGV` line plus every `P:<id>` sub-line (F1, folded for display); `TOTAL` is every line the person
  has (D3, F1). Total and the folded BGV are not lines and no stage optimises them; they exist only
  so the panel never sums. Each tab holds:
  - `carried`, `received` and `pinned`: the exact integer sums of its lines' values (each is already
    exact in hundredths);
  - `seats` and `pinned_seats`: the tab's `received` ÷ 100 and `pinned` ÷ 100, integers, exact (A39).
    «En este plan» renders `seats` and the `{n}` of «Los pines tomaron {n} lugares» renders
    `pinned_seats` (C6 EQ-3, EQ-4, EQ-5);
  - `share`: the exact sum of its lines' exact rational shares, rounded **once** to hundredths by
    LG-13's rule — not the sum of the lines' hundredths;
  - `after`: `carried + share − received`, the same identity as a line's, which a consumer may
    assert;
  - `tenths`: `{ "share": int, "after": int }`, rounded once by the tenths rule above, where x for
    `share` is the exact summed share and x for `after` is `carried`/100 + the exact summed share −
    `received`/100;
  - no identity holds between a tab and its lines: a tab's `share` may differ from the sum of its
    lines' `share` by a few hundredths, as LG-13 says of C2's own sums, and its tenths are never the
    sum of the lines' tenths or a rounding of any hundredths. A consumer computes nothing from them.

  A tab appears when at least one of its lines appears, with one exception: `TOTAL` is absent for an
  exempt person (F8, D13, C2 LG-14), whose lines and other tabs are all present (§5.3). «En este
  plan» (`seats`), «Queda» (`tenths.after`) and the pinned count (`pinned_seats`) on every tab, the
  folded BGV and Total included, come from that tab's entry and from nothing else (A17, A32, A39, C6
  EQ-3–EQ-5).

`tolerance` is the F13 constant (§12.4), so no consumer needs to mirror it.

### 8.3 Failure (`ok: false`)

`{ "ok": false, "contract": 3, "engine": "v3", "code": "…", "params": { … } }`, with the codes listed in
§9.

| Code | HTTP |
|---|---|
| Every solver-level code | 422 |
| `invalid_json` | 400 |
| `unauthorized` | 401 |
| `method_not_allowed` | 405 |
| `misconfigured` | 503 |
| `internal_error` | 500 |

No stack trace and no request content ever appears in a response or a log.

### 8.4 Ping

`{ "contract": 3, "ping": true }` →
`{ "ok": true, "contract": 3, "engine": "v3", "solver_version", "build", "pin_cap": 250 }`.

It builds no model. It serves as the deploy smoke check and as C6's optional warm-up (parent §14).

## 9. Codes

`gcf_v3/owt_v3/codes.json` is the single list of every machine-readable code the function can emit. Each
entry has its parameter names and **no copy**. A Python test asserts that every emitted code and
parameter is listed. C6's sync test asserts that each one has Spanish copy (parent S4, U6).

| Group | Codes |
|---|---|
| `error` | `contract_mismatch` {received}; `invalid_request` {field, detail}; `unknown_person` {field, person}; `unknown_service` {field, service}; `pin_conflict` {person, service}; `too_many_pins` {count, cap}; `timeout` {stage, seconds}; `invalid_json`; `unauthorized`; `method_not_allowed`; `misconfigured`; `internal_error` |
| `stage` | `rules`, `fill`, `cadence`, `compensation`, `voice_floor`, `dl_floor`, `sunday_cap`, `saturday_cap`, `no_consecutive`, `balance_max:{line}`, `balance_sq:{line}`, `tiebreak` |
| `stage_status` | `proven`, `unproven`, `not_run` |
| `stage_reason` | `budget`, `no_solution_in_limit`, `stopped_earlier` |
| `limit` | `none`, `deterministic`, `wall` |
| `violation` | `mandatory_lead`, `count`, `pair`, `presence`, `consecutive` |
| `violation_cause` | `pins`, `forced` |
| `unfilled_reason` | `no_possible_lead`, `no_candidate`, `rules`, `fill_not_proven` |
| `missed` | `cadence_on_missed`, `cadence_off_led`, `compensation_missed`, `voice_floor_missed`, `dl_floor_missed`, `sunday_cap_exceeded`, `saturday_cap_exceeded`, `consecutive_sundays` |
| `missed_cause` | `not_proven`, `pins`, `rule`, `unavailable`, `capacity`, `higher_priority` |
| `notice` | `dl_capacity`, `exact_clamped`, `min_clamped`, `presence_not_applicable` |
| `cadence_state` | `on`, `off`, `out` |
| `compensation` | `given`, `missed`, `not_applicable` |

**Codes retired from the prototype draft:**

| Draft code | Replaced by |
|---|---|
| `sat_anchor` | Nothing: the anchor is gone (D9) |
| `rate_reduced`, `alternation_rest`, `alternation_broken` | Cadence states, the `cadence` outcome, and the `cadence_*` misses (F7, X1) |
| `within_slack` | Nothing: «Holgura N» is inert under v3 (Q2) |
| `carried_clamped` | Nothing: carried balances are not capped (F2–F3) |
| `timeout_no_solution` | `timeout` |
| `mandatory_lead_impossible` | The unfilled reason `no_possible_lead`. It is never an error |
| `horizon_too_long` | `invalid_request` with `field: "months"` |
| `degraded` | `rules` or `fill_not_proven` |
| `week_exclusion` | Nothing: week exclusions are eligibility (C5-2) |
| The `fairness_reason` and `owed_not_seated_why` families | Not solver codes. C6 writes the per-person reason from the request it built and the numbers in §8.2 |

## 10. Determinism (S5) and budget (S6)

- **Same request and seed give the same response whenever every stage is `proven`.**
  - «Same» covers every field except `ms`, `total_ms` and `build`.
  - The promise holds per platform and per ortools build. A Mac and a Linux runner can break ties
    differently, even at OPTIMAL (`docs/CI.md:58-62`). Tests therefore never freeze a schedule across
    platforms.
- **The output must not depend on `PYTHONHASHSEED`**, nor on the iteration order of dicts or sets.
  Everything that feeds the model, the tie-break weights or the report iterates in a canonical sorted
  order.
- **Budget.** The function's own time for an accepted request is at most the 25 s budget plus 1 s of
  overhead.
  - C6's route aborts its upstream call at 55 s or less, and its client at 58 s (S6, C6).
  - C7 measures the real container against §13 before the flip.

## 11. Entry points, packaging, deploy and secrets (E1)

### 11.1 Layout

Everything for v3 lives under `gcf_v3/` and imports nothing from `gcf/`. The start directory does not
enforce that: both jobs run from the repository root, so `gcf` is importable in the v3 job as a
namespace package (C0's evidence). C0's guard forbids any import of `gcf` from `gcf_v3/` (I2); C5 adds
no dynamic import of it either. No v2 code is copied: v3 needs no pattern parser (C5-4), and its pin
handling is keyed by service.

| Path | Contract |
|---|---|
| `gcf_v3/main.py` | The HTTP entry point `solve` (functions-framework) |
| `gcf_v3/owt_solver_v3.py` | Run as `python gcf_v3/owt_solver_v3.py --json-mode` from the repo root. Reads one request on stdin and writes one response on stdout. Exits 0, including for `ok: false`. This is C6's local-dev path, the v3 equivalent of `route.ts:122` |
| `gcf_v3/owt_v3/` | The package. It holds `codes.json` and a module containing the literal line `PIN_CAP = 250` exactly once, for C6's textual sync test (U8) |
| `gcf_v3/requirements.txt` | `ortools==9.15.6755` and `functions-framework>=3.0,<4`. C0 scaffolds the first line. The ortools pin moves only together with v2's and the local env |
| `gcf_v3/.gcloudignore` | C0's copy of v2's file, plus `tests/`, `acceptance/` and `cloudbuild.yaml` |
| `gcf_v3/tests/` | The unit suite (§12.1), a package with `__init__.py` so that C0's discovery contract (I2) reaches it, plus the one module that drives the acceptance `ci` subset (§12.2). C0's `test_scaffold.py` may be kept or replaced |
| `gcf_v3/acceptance/` | The harness, the fictitious world and the scenarios (§12.3). It is a package and contains no `test*.py` (C0's I2); under I2's `-t gcf_v3` it imports as the top-level package `acceptance` |
| `gcf_v3/cloudbuild.yaml` | The build config (§11.3) |

### 11.2 Handler contract

| Request | Response |
|---|---|
| OPTIONS | 204, with v2's CORS headers |
| Any method other than POST | 405 |
| `OWT_SOLVER_API_KEY` unset or empty | 503 (**fail closed**) |
| `X-Api-Key` missing or wrong (compared in constant time) | 401 |
| JSON that cannot be parsed | 400 |
| Anything else | The solve's result: 200 or 422 |
| Any unexpected exception | 500 `internal_error` |

The key is read once, at import. Logs carry only `request_id`, months, sizes, stage statuses and
timings. They never carry names or the request body.

### 11.3 Cloud Build

`gcf_v3/cloudbuild.yaml` deploys `owt-solver-v3` with:

- `--gen2 --region=us-central1 --runtime=python312`
- `--source=gcf_v3 --entry-point=solve --trigger-http`
- `--memory=512MB --cpu=1 --timeout=120s`
- `--set-secrets=OWT_SOLVER_API_KEY=owt-solver-api-key:latest`
- `--set-env-vars=OWT_SOLVER_V3_BUILD=$COMMIT_SHA`

It does not pass `--allow-unauthenticated`, for the same reason as v2 (`cloudbuild.yaml:26-30`). It does
not pass `--remove-env-vars` either: v3 has never had a plaintext key to remove.

**The trigger, `owt-solver-v3-deploy`:**

- **Source:** GitHub, branch `^main$`.
- **Included files:** `gcf_v3/**`.
- **Config file:** `gcf_v3/cloudbuild.yaml`.

When the trigger is created, two properties must be checked:

- v2's filter (`gcf/**`, `cloudbuild.yaml`) matches no path under `gcf_v3/`;
- v3's filter matches no path of v2's.

A change to `fixtures/fairness/golden.json` alone deploys nothing, which is correct: the fixture is test
data.

### 11.4 First creation (Frank, by hand, after merge)

1. From the fetched tip of `main` (`git fetch && git switch --detach origin/main`), run
   `GCP_PROJECT=eloquent-figure-421401 bash scripts/deploy-solver-v3-gcf.sh`. The script:
   - hard-codes `owt-solver-v3`, `--gen2`, `--source=gcf_v3` and
     `OWT_SOLVER_V3_BUILD=$(git rev-parse HEAD)`;
   - passes `--allow-unauthenticated`, which grants `allUsers → run.invoker` using Frank's rights;
   - refuses to run while anything under `gcf_v3/` is dirty.
2. Check that the runtime service account can read the secret: `gcloud secrets get-iam-policy
   owt-solver-api-key`. If it cannot, Frank grants `roles/secretmanager.secretAccessor`.
3. Create the trigger described in §11.3 (console → Cloud Build → Triggers).
4. Verify the deploy (§11.5).

The function does not exist until step 1, and nothing else creates it. A merge that touches `gcf_v3/**`
before the trigger exists deploys nothing.

### 11.5 Verifying a v3 deploy

1. **Describe.** Run `gcloud functions describe owt-solver-v3 --gen2 --region=us-central1
   --format='value(state,updateTime)'`. The state must be `ACTIVE`, with an `updateTime` after the
   merge.
2. **Ping.** Handle the key exactly as `docs/SOLVER_AND_INFRA.md:477-490` does: read it from Secret
   Manager with file logging off, and pipe it to curl with `-H @-`. The response must have `ok: true`,
   `contract: 3`, and `build` equal to the deployed commit SHA. This is the function's analogue of the
   Vercel alias check.
3. **Smoke solve.** Send `gcf_v3/acceptance/smoke.json` (fictitious people). The response must have
   `ok: true` and every stage `proven`.

The function URL for C6 and C7's `OWT_SOLVER_V3_URL` comes from `gcloud functions describe
owt-solver-v3 --gen2 --region=us-central1 --format='value(serviceConfig.uri)'`.

### 11.6 Secrets and environment (`docs/SECRETS.md`, in this delivery)

**`OWT_SOLVER_API_KEY`: amend the existing entry (`docs/SECRETS.md:485-575`).**

- **Needed in:** add the `owt-solver-v3` function, through the same Secret Manager binding
  (`gcf_v3/cloudbuild.yaml`, `scripts/deploy-solver-v3-gcf.sh`). It is still not needed in
  `.env.local`, CI or iOS.
- **Rotation step 3:** redeploy **both** functions, either by running both triggers
  (`owt-solver-deploy` and `owt-solver-v3-deploy`) or by running both manual scripts from the fetched
  `main`. Each function reads `:latest` when an instance starts.
- **Blast radius:** from step 2 until both functions and both Vercel environments are redeployed,
  cold starts of either function answer 401.
  - Auto fails, intermittently at first and then always, on v2 as today and on every environment whose
    engine is v3.
  - Nothing is written.
- **Rollback:** the existing rollback paragraph applies unchanged, with both functions redeployed.

**`OWT_SOLVER_V3_BUILD`: new. Function config, not a secret.**

- **Needed in:** the `owt-solver-v3` function only. Not Vercel, CI, `.env.local` or iOS.
- **Purpose:** the `build` field that the deploy check compares. When it is absent, `build` is
  `"unknown"` and nothing else breaks.
- **Source:** Cloud Build's `$COMMIT_SHA`, or `git rev-parse HEAD` in the manual script.
- **Rotation:** none. Every deploy rewrites it.
- **Blast radius:** none.

**Not introduced here.** `OWT_SOLVER_V3_URL` is read by C6's route, so C6 introduces and documents it
(C6 DOC-1). C7 sets it, under Frank's consent, on Vercel Preview (its write W0, before its Step 2) and
on Production (W4), and updates that `docs/SECRETS.md` entry's status. C5 supplies only the URL's
source command (§11.5). `OWT_SOLVER_ENGINE` and its entry are C2's (A1). The function reads neither.

## 12. Tests, acceptance and the F13 tolerance

### 12.1 Unit suite (`gcf_v3/tests/`, in C0's `solver-v3` job)

Every name in the suite is fictitious. It runs from the repo root as
`python -m unittest discover -s gcf_v3 -t gcf_v3 -v`.

**Contract**

- Every refusal in §5.8 returns its code with HTTP 422, never a 500, and unknown keys are refused.
  This includes two `==` rules of one person in one month over a common role key (A38).
- A `contract` other than 3 gets `contract_mismatch`.
- The ping answers.
- Every emitted code is in `codes.json`.
- `PIN_CAP` appears exactly once.

**Handler**

- v2's five guard cases (`gcf/test_main.py:45-70`), reproduced.
- The key comparison is constant-time.
- Unparseable JSON returns `invalid_json`.
- A 500 carries no stack trace.

**Golden fixture (F14)**

- The Python function reproduces, to the hundredth and per month, every expected `share`, `received`
  and `balance` in every `ledger` case of `fixtures/fairness/golden.json` (C2's FX-3). The test
  computes each `balance` as its own `share` − `received`, both in hundredths, which is FX-2's and
  LG-13's definition (A39) — never the exact balance rounded on its own, which differs at a half (an
  exact share of 0.125 with one seat received: 13 − 100 = −87, where rounding −0.875 alone gives
  −88). C2's FX-4 exact-half case guards it in both languages.
- Exact balances sum to 0 per (service, role key) and per (rule, service).
- C5 adds hand-computed `plan` cases for §6.5 (FX-2 reserves them), and Python asserts them.
- The suite never asserts the `cadence` cases: they are TypeScript's (A18).
- The suite fails if the file is missing, or if it has no `ledger` cases.

**Model contracts**

- Per-month `count` rules in a two-month run.
- The trailing Saturday of month 1 counts in its own month within a two-month horizon.
- `pair` and `presence` apply per service; a month-scoped object applies only in its month, and one
  `P:<id>` sub-line spans both months when the two months carry different members (C5-16).
- `consecutive` links across the month boundary and against `prior.services`.
- An exact `Sat.Lead` rule above 1 gives no `saturday_cap_exceeded` (A16).
- Each clamp notice.
- `no_possible_lead`.
- Rows grow to fit pins.
- A `fixed` service gains no seat.
- A special never appears in a rule instance.
- Uncounted services stay out of lines and protections (C5-3).
- Populations, set-asides and the floor seat follow §6.2–§6.4. This covers:
  - the sole-member and exclusive presence cases;
  - the plan's F6 for pins and for exact rules with no slack;
  - C5-9's pin remainder;
  - the floor skip of C5-15 in both passes: an exact or cadence seat skips it, an
    `outside_population` seat does not, and in the plan a clamped `==` ≥ 1 or an `on` state skips it
    before any seat exists.
- One seat per person per service (§6.6): an input with one person in Lead and BGV of one service
  keeps the Lead seat; the BGV seat is a `second_seat` set-aside, and every `share` and `received` equals
  those of the same input with that seat removed; it cancels no floor and moves no population. A
  repeated entry of one role counts once.
- Hand-computed planned shares.
- Exact rational conservation.
- The `after` identity.
- Seat counts (A39): per line and per tab, `seats × 100 == received` and `pinned_seats × 100 ==
  pinned`; a `received` of 300 with one pinned seat gives `seats: 3` and `pinned_seats: 1`, including
  on the folded BGV and on Total.
- Display tenths (C5-8, §8.2), each case one that re-rounding the hundredths would get wrong: an exact
  share of 11/17 (0.647…) returns `share: 65` and `tenths.share: 6`, not 7; `carried: 30` with an exact
  share of 9/26 (0.346…) and nothing received returns `after: 65` and `tenths.after: 6`, not 7; an exact
  0.65 gives 7 and −0.65 gives −7 (half away from zero). These are Python unit tests, not fixture
  fields: FX-2's expected values stay in hundredths (C2 §13, LG-13).
- Display tabs (§8.2), each folded case one that summing the lines would get wrong: a `BGV` exact
  share of 7/50 (0.14) and one `P:<id>` exact share of 7/50 give `tabs.BGV.tenths.share: 3` (0.28),
  not the lines' 1 + 1 = 2; a `BGV` exact share of 49/200 (0.245, line hundredths 25) and one
  `P:<id>` exact share of 1/250 (0.004, line hundredths 0) give `tabs.BGV.share: 25` and
  `tabs.BGV.tenths.share: 2` (0.249), not 3 from the summed hundredths; `TOTAL` sums every line the
  same way; the tab's `after` identity holds; `DL`, `SL` and `CORO` equal their line; `TOTAL` is
  absent for an exempt person and present otherwise, with her lines and other tabs unchanged.
- The model's received count equals the shared function's.

**Stages**

- Ranking: each stage's protection wins over the next one's, on instances built for that purpose.
- `no_solution_in_limit` ends the run.
- Under stubbed limits, `timeout` for `rules` and for `fill`, and `not_run` with reason `budget`.
- No later stage ever raises the ceiling.

**Determinism**

- Two runs in one process, and two subprocesses with different `PYTHONHASHSEED`, return byte-identical
  responses apart from timing fields.
- This holds with and without pins.

### 12.2 CI budget

- **How the CI subset runs.** C0's job runs one command (I1: `python -m unittest discover -s gcf_v3
  -t gcf_v3 -v`), and `gcf_v3/acceptance/` holds no `test*.py` (I2). The `ci` matrix of §12.3 is
  therefore driven by one test module under `gcf_v3/tests/` (working name `test_acceptance_ci.py`)
  that imports the harness as the top-level package `acceptance` and runs every `ci` cell in process,
  failing on any pass criterion of §12.3. The `full` matrix and the private re-run go through
  `run.py` only, never through discovery.
- **The harness precondition in CI.** Before a chain cell runs, the harness checks its test-only X1
  against the fixture's `cadence` cases (§12.3). In CI a mismatch fails that test module as a
  **harness error** («the test double disagrees with the fixture»): it checks the double that drives
  the chain, not C2's X1, and no shipped code reads the double. The unit suite still asserts no
  `cadence` case (A18); TypeScript remains the only suite that asserts X1's semantics.
- The v3 job (§12.1 plus the CI subset of §12.3) must finish within 10 minutes on `ubuntu-latest`, with
  a target of 6.
- If C0 is rolled back after C5 lands (A36), both suites run as steps of the single `gates` job; the
  v3 suite's measured time then adds to that job's, and its `timeout-minutes` is re-set by the same
  rule.
- C5 sets the job's `timeout-minutes` by C0's rule: at least twice the measured job time.
- The suite never freezes a schedule (§10).
- Assertions on stage status rely on the deterministic limit, never on the wall guard.

### 12.3 Acceptance: the combined, amended policy

**The harness.** `python gcf_v3/acceptance/run.py --world <path> --matrix ci|full --out <dir>` runs
chained solves. Between runs it derives each next request's inputs:

- carried balances, from the same Python function over the chain's stored months (the 3-month window,
  F3);
- cadence states, from a **test-only** Python X1 that drives the chain. It is never shipped, and the
  production X1 remains C2's alone (F7). Before a chain runs, the harness checks its X1 against the
  fixture's `cadence` cases and refuses to run on a mismatch. That is a harness precondition; the
  unit suite never asserts those cases (A18);
- `dl_since`, `prev_dl_leads` and `prior`.

`--emit-requests <dir>` writes the request bodies for the timing-gate shapes (§13).

**The independent checker** (in `gcf_v3/acceptance/`, importable on its own) takes one request and
its response and recomputes from `assignments` alone, never from the response's own flags or from the
model's code:

- hard violations: one seat per person per service; a seat only for someone eligible for that role
  there, or pinned to it; a `fixed` service holding exactly its pins;
- the pin echo: every request pin is in `assignments`, and `pins.honored` equals that count;
- every rule instance of §6.7 and every protection of §7.1 stages 3–9, compared with `violations`,
  `missed` and `cadence`;
- the `after` identity, the seat-count identities (`seats × 100 == received`, `pinned_seats × 100 ==
  pinned`, A39) per line and tab, and `|planned − share|` against `fairness.tolerance` per
  person-line.

It returns counts and codes only, never names, so C7's rehearsal can run it on captured Preview pairs
(C7 step 3e).

**The fictitious realistic world** (`gcf_v3/acceptance/world_realistic.json`) mirrors today's structure,
not today's people. It has 17 voice members:

- **11 with the sunday_lead Tipo:**
  - the 3 cadence members;
  - a fixed-count lead, with `Sun.Lead == 2` and excluded from Saturdays, `Sun.BGV` and `Sun.Choir`;
  - an exempt lead, with the same exclusions;
  - a capped lead, excluded from Saturdays and `Sun.Choir`, with `Sun.BGV <=` Sundays − 2;
  - the presence pair: exclusive presence on `Sun.BGV`, plus pair rules on BGV and Lead;
  - 3 further regulars;
  - two more pair rules among the leads.
- **6 support:**
  - 3 with `Sun.BGV == 1`;
  - 2 Saturday-only;
  - 1 unrestricted.

Saturdays are every other week. Availability is seeded and synthetic (about 8% of dates), with
scenario overlays on top. The chain starts in Aug 2026 from zero, so the Nov+Dec run has a lookback made
by the policy itself.

| Run | `ci` | `full` | Pass criteria |
|---|---|---|---|
| **A**: Nov+Dec 2026, one 2-month run | seeds 1–2 | seeds 1–5 | Every stage `proven`. Violation ceiling 0. Nothing unfilled. 0 hard violations, per an independent checker. Every cadence member meets X1, with the compensation Saturday in each `off` month that has a Saturday slot. 0 misses on the voice floor, the DL floor, both caps and `no_consecutive`, including Oct 25 → Nov 1. Pins honoured |
| **B**: December re-planned alone, after A's November is stored | seed 1 | seeds 1–5 | Same as A |
| **C**: 12-month chain, Nov 2026–Oct 2027, 2-month runs | seed 1 | seeds 1–3 | Each run passes as A. No regular goes more than 1 month without a Sunday while available. No cadence breaks except X1 shifts caused by the scenario. **Floor-seat proof:** for each floor person and line, the cumulative balance stays within ±2.0 seats in every month, and its least-squares slope is within ±0.15 seat per month. Without this rule the prototype gave −0.6 per month, reaching −7 |
| **D**: same chain, 1-month runs | seed 1 | seeds 1–3 | Same as C |
| **P**: pin and rule-break scenarios | seed 1 | seeds 1–3 | See below |
| **G**: growth to 9, then 10, people on the DL line | — | seeds 1–3 | At 9: 0 `dl_floor_missed`. At 10: a `dl_capacity` notice in 4+4 runs, and every miss has cause `capacity` |
| **O**: the D12 order, re-measured | — | seeds 1–5 | Record the balance-stage values under F12's order and under the prototype's order. Informational, for Frank |

**Scenario set P.** Every scenario must complete (no `ok: false`), and its report must name exactly the
expected breaks, misses and notices, each with the expected cause.

1. The presence pair, both pinned to one Sunday's BGV, gives a `pair` violation with cause `pins`.
2. The fixed-count lead, pinned on 3 Sundays, gives a `count` violation with cause `pins`.
3. Scenarios 1 and 2 combined give a ceiling of 2.
4. A stored Sunday with 3 Leads makes the row grow.
5. A cadence member pinned on a Sunday in her `off` month gives `cadence_off_led` with cause `pins`,
   and her compensation is `not_applicable`.
6. A regular pinned as Lead on all 5 Sundays of a month gives cap and consecutive misses with cause
   `pins`. Everyone else's protections are still met.
7. A pin on someone not eligible for that role is honoured, and the seat is set aside.
8. `==` above availability gives `exact_clamped`. Two cases: a `Sun.BGV == 1` member unavailable all
   month, and the fixed-count lead available on only one Sunday.
9. The presence pair, both unavailable on one Sunday, gives `presence_not_applicable`.
10. When exactly one presence member is available on a Sunday, F6 moves her shares.
11. A counted Sunday-dated special as a `fixed` service, plus pins on Saturdays.
12. A newcomer and a promotion, both via `dl_since`, give no spurious `dl_floor_missed`.
13. All three cadence members are unavailable in their `on` month. X1 shifts them, with gaps of at
    most 2 months (`f_final-stress.md` §5).
14. A month planned before the previous one is stored (`has_services: false`) gives no spurious floor
    miss.
15. With tiny stage limits, the report shows honest `unproven`, `not_run` and `timeout` statuses.
16. A two-month run whose months carry different presence members for one rule id (a record-bound
    month beside an unrecorded one, A6) completes, with each month's instances and sub-line
    population taken from its own object (C5-16).

**The private re-run on real data.** This is the parent's «Run A on the real Nov+Dec request» (A23).

- **Who runs it:** the implementer, on Frank's machine. Never in CI, and nothing from it is committed.
- **Input:** a converter kept in the private repo (`owt-agent-logs/sdd/2026-10-05-solver-v3-fairness/`)
  maps that repo's read-only dumps to the harness's world format.
- **Command:** `run.py --world <private>/world.json --matrix full --out <private>/out/`.
- **What reaches the repo:** only aggregates go into the PR description and the review log. These are
  pass/fail per criterion, stage statuses, timings and the maximum F13 gap. No names, no per-person
  numbers.
- **Limit:** the converter approximates C6's request builder and C4's records, which do not exist yet.
  C7's rehearsal re-checks with the real builder.

### 12.4 The F13 tolerance

1. Measure the maximum of |`planned` − `share`| per person-line over every run of the `full` matrix and
   over the private re-run.
2. `FAIRNESS_TOLERANCE`, in hundredths, is the smallest multiple of 5 at or above that maximum.
3. It is defined once in `owt_v3`, echoed as `fairness.tolerance`, and asserted over the CI subset.

**A measured maximum above 50 (half a seat) is a finding, not a tolerance.** The delivery stops there
and the gap is reported to Frank with its cause, for example a flip in floor status or a pin pattern.

## 13. Real-container timing gate (definition; C7 runs it)

Frank runs the gate, because the key comes from Secret Manager. It runs against the deployed
`owt-solver-v3`, before Preview is pointed at v3.

**Shapes.** The harness emits them with `--emit-requests`; all use fictitious people except E:

- **A:** 1 month, 5 Sundays, Saturdays every other week.
- **B:** Nov+Dec, 4+5 Sundays.
- **C:** 2 months, 5+5 Sundays, a Saturday every week, a trailing Saturday.
- **D:** B with about 100 pins (fill-empty).
- **E:** the real Nov+Dec request, built by the private converter and kept outside the repo.

**Runs.** 10 seeds warm per shape, then 3 cold runs, each after at least 20 minutes idle.

**Recorded:**

- curl's `time_total`;
- `total_ms`;
- per stage: status, `limit`, `ms` and `det_milli`. The ratio of `ms` to `det_milli` calibrates
  `STAGE_DET_LIMIT`;
- the Cloud Run memory metric.

**Pass:**

- Warm, on shapes B–E: every stage `proven` in 10 of 10 runs, and no stage with `limit: "wall"`.
- `total_ms` p95 ≤ 8 s.
- `time_total` p95 ≤ 20 s.
- Cold `time_total` ≤ 45 s, which leaves 10 s under the route's 55 s abort.
- Memory under 75% of 512 MB.

**On failure, in order:**

1. If only the cold start fails: `--min-instances=1`. Frank decides, since it has a monthly cost.
2. If stages fail: raise `STAGE_DET_LIMIT` and the wall guard within the 25 s budget, then re-run.
3. If it still fails: v2 stays the engine, and Frank is offered a 1-month-only v3 in the meantime
   (parent §14).

## 14. Documentation in the same delivery

- **`docs/SOLVER_AND_INFRA.md`:** a new «Solver v3 (`gcf_v3/`)» section. It covers:
  - a summary of the contract, pointing to this spec;
  - deploy: the trigger, the script and the first creation;
  - the verification in §11.5;
  - rollback;
  - the fact that nothing calls the function until C6 and C7.
- **`docs/SECRETS.md`:** the entries in §11.6.
- **`docs/CI.md` and `CLAUDE.md`:** C0 adds the job and the gate command. C5 updates the measured
  job time.
- **One ADR**, numbered as the next free number at merge, recording **the v3 solver function and its
  stages** (A31). It covers:
  - E1: a second function with its own source, trigger and suite;
  - the stages of §7.1, solved in sequence and each fixed before the next, in place of a weighted
    ladder;
  - rules soft per instance in every run, under a violation ceiling set first (F15), with the report
    re-evaluated from the assignment;
  - planned shares fixed before the solve (F13), with a measured tolerance;
  - the S3 settings: 1 search worker, `linearization_level = 2`, a deterministic limit per stage with
    a wall guard, and a 25 s total budget.

  It records the rejected alternatives listed below under «Rejected alternatives» (a second entry
  point inside `gcf/`, a version field in one function, a single weighted objective,
  assignment-dependent shares, hard rules without pins, `linearization_level = 1`). C7's amendments
  to existing ADRs (A31: 0004, 0010, 0038, 0041, 0042, 0046, 0047) cite this one; C5 amends none of
  them, because they describe production behaviour, which changes only at the flip.

## 15. Rollout, safe end state and rollback

**Order:**

1. Merge, as CLAUDE.md requires:
   - a feature branch, with gates green, including `solver-v3`;
   - a fresh code review of the diff;
   - the fix, then re-verification;
   - `preview` first: the dev alias moves, but nothing visible changes;
   - then a PR to `main`.
2. Frank's first creation (§11.4).
3. Verification (§11.5).

**Safe end state.** `owt-solver-v3` answers the ping and the smoke solve, and **nothing calls it**.
Production behaviour is unchanged. v2's function, trigger and golden schedules are untouched.

**Rollback.** Disable the trigger `owt-solver-v3-deploy`. Nothing routes to the function, so it can stay
or be deleted (Frank's call). Revert the PR. No data depends on the function. Reverting C5 leaves C0's
job and scaffold in place, so `solver-v3` stays green on the scaffold's smoke test (A20, A36).

## Interfaces

**Provided to C6 (planner and route)**

- **The contract.** The request (§5) and the response (§8), exactly as written, under `contract: 3`.
- **Request fields:**
  - `months`, `seed`, `request_id`, `budget`.
  - `services[]{id, date, month, kind, time?, fixed, counts, seats{Lead, BGV, Choir}}`. For a stored
    service, `id` is the document `_id`.
  - `people[]{id, name, exempt, eligibility{<service id>: [Lead|BGV|Choir]}, carried{DL, SL, BGV, CORO,
    P:<id>}, cadence{YYYY-MM: on|off|out}, dl_since, prev_dl_leads}`.
  - `rules[]`:
    - `count{id, person, roles, op, month, value}`;
    - `pair{id, persons[2], roles, month?}`;
    - `presence{id, persons[], roles, exclusive, month?}` (`month` optional on both, C5-16);
    - `consecutive{id, person, roles}`.
  - `pins[]{service, date, role, person}`.
  - `prior{month, has_services, services[]{date, kind, counts, seats}}`.
- **Response fields:**
  - `contract`, `engine`, `solver_version`, `build`, `reproducible`;
  - `assignments{<service id>: {Lead, BGV, Choir}}`, `unfilled[]`, `pins{requested, honored}`,
    `violations[]`, `violation_ceiling{value, proven}`;
  - `stages[]{id, status, reason, value, bound, limit, ms, det_milli}`;
  - `fairness{scale, tolerance, lines, people[]{person, floor, lines{carried, planned, share, received,
    pinned, seats, pinned_seats, set_aside, after, tenths{share, after}, in_stage, clamped}, tabs{DL,
    SL, BGV, CORO, TOTAL: {carried, share, received, pinned, seats, pinned_seats, after, tenths{share,
    after}}}}}`, `TOTAL` absent for an exempt person; `seats` and `pinned_seats` are required integers
    of seats (A39). The panel renders «Queda» (and any plan share it shows) on each tab only from that
    tab's `tenths`, through C2's formatter (A32); «En este plan» from that tab's `seats`; and the `{n}`
    of «Los pines tomaron {n} lugares» from that tab's `pinned_seats`. It never divides `received` or
    `pinned`, and never sums lines into a tab (A17, A39, C6 EQ-3–EQ-5, S-12);
  - `cadence[]`, `missed[]{code, person, month, month1, month2, dates, count, cause}`,
    `notices[]{code, params}`;
  - on failure: `{ok: false, code, params}`.
- **What C6 must send:**
  - eligibility built only from C2's `resolveMonthEligibility` output, or from the horizon record when
    it binds (A6, A7), plus availability and the day-class eligibility of specials (A13);
  - week exclusions and `!in` patterns only through eligibility: there is no `week_exclusion` rule
    (C5-2);
  - role sets as six-key lists, using C2's `rolesOfPatternV3`, and counts resolved per month with
    C2's `capValueForMonth`, with a below-zero result sent as 0 and noticed by C6 itself (A15, C5-4);
  - presence `exclusive` copied from C2's RES-6; a presence or pair rule whose two months' sources
    differ may be sent as one month-scoped object per month (C5-16);
  - cadence `out` exactly when CAD-1's reason is `not_eligible`, otherwise CAD-1's on/off (A14, C5-5);
  - `prior` built from its own `GET /api/admin/roles` read (A15, C6 RQ-7);
  - `fixed: true` for stored horizon services and counted specials, with their seats as pins (U2, U3);
  - `counts` from C1's legacy read.
- **What C6 must refuse before sending:** everything §5.8 would refuse, including a cadence member who
  also has an exact `Sun.Lead` rule (A11), two exact rules of one person over one role key (A38; C2's
  resolver and the record already refuse it, so a compliant month source never carries it), and a
  horizon that contains a past month (A24).
- **Rule ids:** any stable id matching §5.4's pattern, unique per `(id, month)`; C6 mints one when a
  config key does not qualify and keeps the key for display (C6 RQ-5).
- **Stored double seats:** a stored service holding one person in two voice seats is sent with only
  the seat ranked first by Lead > BGV > Choir (C6 ST-6); §6.6 and C2's LG-4 read the stored service
  the same way, so «Queda» for that service matches the next ledger read.
- **Retries** key on `code`. `timeout` is the only failure at solve time. Violation causes are `pins`
  and `forced`. The unfilled reasons are the four in §8.1.
- **Shared artefacts:**
  - `gcf_v3/owt_v3/codes.json` is the registry that C6's copy sync test reads.
  - `PIN_CAP = 250` is the literal C6's mirror test reads. The ping also echoes it.
  - `gcf_v3/owt_solver_v3.py --json-mode` is the local entry point.
  - `fairness.tolerance` means C6 needs no mirror of its own.

**Consumed from C2 (ledger)**

- **Carried balances.** `carried` per person and line, in hundredths, positive meaning owed. C6 copies
  C2's `window[line].balance`, which covers the 3 calendar months before `months[0]` and is rounded once,
  half away from zero (LG-13, C5-8). Sub-line keys are `P:<ruleKey>`.
- **Cadence states.** CAD-1 `cadenceStates`, one `{state, reason}` per cadence member per request month.
  For month 2, the state assumes month 1 follows its own state.
- **Past facts (via C6, A15).** `firstRecordedIn["Sun.Lead"]` gives `dl_since`, and the
  `countedSundayLeads` entries in `prior.month` give `prev_dl_leads` (C6 RQ-4). `prior.has_services`
  and `prior.services` come from C6's roles read, not from C2 (C6 RQ-7).
- **The realised formula.** C2's LG-4–LG-11 and LG-13 (its hundredths and its display tenths), which C5 implements in Python under C5-10,
  with the floor skip as A12 and A33 state it (C5-15): no floor set-aside when an exact or cadence
  seat already met the floor. The wire balance is `share − received` in hundredths (LG-13, A39), and
  one seat per person per service is counted, the first by Lead > BGV > Choir, every other a
  `second_seat` set-aside (§6.6, C2 LG-4, LG-9).
- **The golden fixture.** `fixtures/fairness/golden.json`, with C2's FX-2 schema: `schemaVersion: 1`,
  `units: "hundredths"`, `sign: "positive_owed"`, and `cases[]{id, kind, description, covers, input,
  expected}`.
  - C5's Python asserts every `ledger` case per month, resolving the records as LG-5–LG-8 state.
  - C5 adds `plan` cases, and C2's vitest schema-checks them.
  - `cadence` cases are TypeScript's alone (A18). The acceptance harness carries a test-only X1,
    self-checked against them as a harness precondition and never shipped. The production X1 stays
    C2's alone (F7).
  - The FX-4 coverage list is required, including the non-exclusive presence case and the floor-seat
    cases.

**Consumed from C0 (CI)**

- **Job.** `solver-v3` (C0's I1): from the repo root, `pip install -r gcf_v3/requirements.txt` and then
  `python -m unittest discover -s gcf_v3 -t gcf_v3 -v`. The full tree is checked out, so `fixtures/` is
  readable. It counts toward `gates`. The acceptance `ci` subset runs inside that one command, from a
  test module under `gcf_v3/tests/` (§12.2).
- **Discovery and isolation.** C0's I2 discovery contract, including its import ban: no `import` or
  `from … import` of `gcf` under `gcf_v3/`, and C5 adds no dynamic import of it (§11.1).
- **Scaffold.** The I3 scaffold, which C5 inherits.

**Consumed from C1 and C3 (via C6)**

- `countsForFairness` becomes `counts`.
- `sundayCadence: "alternate"` («Mes por medio») becomes the presence of `cadence`.

**Provided to C7**

- The timing-gate definition (§13) and the emitted request shapes.
- The deploy verification (§11.5).
- The source command for the `OWT_SOLVER_V3_URL` value. Setting it on Preview and Production, under
  consent, and updating its `docs/SECRETS.md` status are C7's writes (§11.6).
- C5's ADR (§14), which C7's amendments to existing ADRs cite (A31).
- `FAIRNESS_TOLERANCE` and the aggregates of the private run, for the cutover record.
- The independent checker (§12.3), callable on one captured request and response pair (C7 step 3e,
  its assumption A3).

## Assumptions

| Assumption | Impact if false | Validation | Response |
|---|---|---|---|
| The build account can redeploy an existing gen2 function with `--set-secrets` | Trigger deploys fail | v2 does exactly this (`cloudbuild.yaml`); the first trigger run after §11.4 confirms it | Frank deploys with the script until it is fixed |
| The default runtime account can read `owt-solver-api-key` | Every call answers 503 | §11.4, step 2 | Frank grants the accessor role |
| A deterministic limit calibrated on a Mac stops a stage before the 2.5 s wall guard on the container | Runs are not reproducible, and stages report `limit: "wall"` | The `ms`-to-`det_milli` ratio in §13 | Raise the guard within the budget, or lower the limit |
| The fictitious world exercises the policy the way the real roster does | Acceptance passes but real data fails | The private re-run (§12.3) | Fix before merge |
| C2's fixture exists when C5 is implemented (parent §13) | The golden test cannot run | The parent's sequence | C5's implementation waits for it |
| The floor seat as written keeps low-share balances bounded | Debt grows: the prototype lost 0.6 a month | §12.3, run C | OQ-3 |

## Open questions

| Question | Why it matters | Recommendation | Owner | Blocking? | Resolution point | Bounded default |
|---|---|---|---|---|---|---|
| Q5: does v3 get its own API key? | Rotation work against key separation | Reuse the existing key (C5-14) | Frank | No | Review of this spec | Reuse `OWT_SOLVER_API_KEY` |
| OQ-1: the value of `STAGE_DET_LIMIT` | Reproducibility, and proofs on the container | Measure it | Claude | No | The plan, then §13 | The smallest value at least 5× the largest deterministic time of any proven stage in the `full` matrix, and at most 1.0 |
| OQ-2: the F13 tolerance | Every consistency check depends on it | Measure it (§12.4) | Claude | No | Acceptance | At most 50 hundredths; anything above is a finding |
| OQ-3: what to do if the floor-seat proof fails | F5 as written would be wrong | Stop and show Frank the measured trajectories, with the exact-rule variant (the prototype's V4) as the alternative | Frank | Only if it fails | Acceptance, run C | None: the merge waits |
| OQ-4: minimum instances for the cold start | Cost against latency | Decide from §13 | Frank | No | C7 | 0, as v2 |

## Known limits

- `planned` and `share` differ within `fairness.tolerance`, and a floor person's status can differ
  between the two passes (for example a cadence member whose `on` Sunday is missed, C5-15).
- Pins are not visible in stored data. The plan applies F6 for pins, but C2's later ledger cannot, so
  those months' populations differ slightly once stored.
- Excess caused by pins is forgiven once it leaves the 3-month window (X4). C6 shows the cumulative
  figure.
- Which rule gives way among minimal sets of equal size is the solver's choice (ADR-0041).
- Determinism holds per platform, and only for runs where every stage is `proven`.
- Presence is checked per service, not per week as in v2. `consecutive` means «a seat on both
  weekends»; it does not reproduce v2's quirk of «at most one seat across two weeks».
- Two Sunday leads in one month are not a cap miss when one of those Sundays is uncounted (C5-3).
- `scripts/deploy-solver-gcf.sh`, v2's script, has no `--gen2`. That is out of scope here, because v2
  stays untouched, but it deserves its own look.

## Rejected alternatives

- **A `solve_v3` entry point inside `gcf/`.** It would ship with v2 on every merge, share v2's
  `requirements.txt`, and load v2 at module scope (`gcf/main.py:20`). E1 chose a separate source
  directory.
- **A version field on one function.** No per-environment URL, and no independent rollback.
- **Assignment-dependent shares.** Measured at 46–48 s, with half the stages capped (F13).
- **Hard rules when there are no pins** (parity with v2's pinless behaviour). Stored data already sinks
  such runs (`f_final-stress.md` §1, extra finding).
- **A single weighted objective.** It overflows CP-SAT's integer bound (ADR-0038).
- **`linearization_level = 1`.** A most-owed stage was still unproven after 60 s.
- **A pattern parser in v3.** It would be a second expansion beside C2's, and the record and the
  request could then disagree (C5-4).
- **Letting the model solve for an unknown cadence phase** (the prototype's `ph` variable). X1 always
  supplies the state, so a cadence member without one is a refused request.

## Parent issues

None remain. The thirteen issues this spec raised before the first amendments are settled, and this
spec follows the amendments: pins by service id (A15, C5-1); exclusions only through eligibility (A15,
C5-2); counted services for lines and protections, every weekend service for rules (A13, C5-3);
presence-seat ties by member id (A18); planned and realised shares, `after` from the realised one
(A19, C5-7); rounding once, half away from zero (A17, C5-8); `dl_since`, `prev_dl_leads` and `prior`
(A15); the mandatory lead as a soft family (A19, C5-6); exact leads off the Saturday cap (A16);
relative caps resolved by the caller (A15, C5-4); the `out` state (A14, C5-5); capacity once per run
(A19, C5-12); the private converter (A23).

The two raised against A1–A26 are settled too, and removed:

- **The floor skip for a pinned seat outside the population** (old Parent issue 1): A33 rules that only
  an exact or cadence seat cancels the floor, which is what C5-15 already followed.
- **«Queda» rounded from an already rounded `carried`** (old Parent issue 2): A32 accepts it — «Queda»
  and the folded BGV and Total tabs are the sent `carried` hundredths plus the plan's exact figures,
  rounded once, and may differ from «Saldo» by 0.1 at a tie (C5-8, §8.2).

A38 (one exact count per role key) and A39 (integer seat counts; the golden balance as `share −
received`) are applied in §5.4, §5.8, §8.1, §8.2 and §12.1. A31 (C5's ADR covers the function and its
stages) is applied in §14.

### Sibling changes this spec depends on (not made here)

| Sibling | Change | Why |
|---|---|---|
| C2 | FX-4: a case with one person in Lead and BGV of one stored service (the BGV seat a `second_seat` set-aside, LG-4), which both suites assert | §6.6; the rule itself is already in C2 LG-4 and LG-9, stated as §6.6 states it |
| C2 | FX-4: an exact-half `balance` case (A39), e.g. an exact share of 0.125 with one seat received, expected −87 | §12.1 golden bullet |
| C6 | EQ-3, EQ-4 and EQ-5 render «En este plan» from `tabs[<tab>].seats` and the `{n}` of «Los pines tomaron {n} lugares» from `tabs[<tab>].pinned_seats`; IF-C5 copies both fields per line and per tab, now required (A39); S-12 closes | §8.2, Interfaces |

C6's sibling issues S-5 (`prior` from C6's roles read) and S-7 (one limit of 100 people) are applied
(§5.6, «Consumed from C2») or already hold (C2 WR-4 and §5.1 both say 100). S-11 is applied: per-line
`tenths{share, after}` and per-person `tabs`, each rounded once from the exact value or exact sum
(C5-8, §8.2, §12.1). S-12 is applied: `seats` and `pinned_seats` per line and per tab (A39). C2's
earlier rows are applied: the one-seat-per-person-per-service rule (C2 LG-4, LG-9, `second_seat`), the array-order limit (LG-7 and §6.3 both order by member id), the LG-11
floor skip (C2 LG-11 and FX-4 now skip only on `exact` or `cadence`, with the
`outside_population` case), and the golden balance identity (§12.1). C7's earlier Step 3e row (the
exact `Sat.Lead` exception) is applied: C7 no longer carries it.

**Declined: C6's S-3** (a per-month `exempt`, and a `cadence` that omits a month in which the person
is «Normal»). Both are per-person facts in this contract: `exempt` decides the floor and whether the
person has a `TOTAL` tab (§8.2), and `cadence` removes the person from the DL line in every request
month (§6.2). Per-month values would change the tab set, the DL line and the floor across one run,
for a case — one person's «Exenta» or «Mes por medio» differing between a record-bound month and an
unrecorded one — that C6's bounded default already handles by refusing that 2-month horizon with
«Planea 1 mes» (C6 RQ-4). No parent clause requires the per-month form.

## Acceptance and verification

| ID | Requirement | Acceptance evidence | Verification |
|---|---|---|---|
| C5-R1 | The S1 request contract (§5, as amended by A11, A14, A15, A38), with coded refusals | Every §5.8 case is refused with its code, including a rule id mixing month-scoped and horizon-wide objects and two `==` rules of one person over one role key; the example is accepted | §12.1, contract tests |
| C5-R2 | A run never sinks because of one service or one rule (S2) | Notices for clamps, `no_possible_lead`, scenarios P8 and P9, and no `ok: false` other than refusals and `timeout` | §12.1, scenario set P |
| C5-R3 | The F12 stages and the S3 settings | Stage order and fixing; settings asserted from the solver's parameters; budget and limit semantics | §12.1, stage tests |
| C5-R4 | F15: pins and rules | P1–P7; the ceiling is never raised; the report is rebuilt from the assignment | Scenario set P; §12.1 |
| C5-R5 | F5 and F6: set-asides, the floor seat with A12's skip, the one-available qualifier | Hand-computed cases incl. C5-15 in both passes, run C's floor proof, scenario P10 | §12.1; §12.3, run C |
| C5-R6 | F13: planned shares, with a measured tolerance | `plan` cases, and `FAIRNESS_TOLERANCE` recorded at or below 50 | §12.1; §12.4 |
| C5-R7 | F14: one formula | Every `ledger` case in the golden fixture reproduced to the hundredth, `balance` as `share − received` (A39); one seat per person per service (§6.6) | §12.1, golden test |
| C5-R8 | Cadence, compensation, floors, caps and consecutive Sundays (F7–F11, X1–X3, A14, A16) | The pass criteria of runs A–D; scenarios P5 and P12–P14; the exact `Sat.Lead` case off the Saturday cap | §12.3 |
| C5-R9 | The S4 response and the codes | Every field present, the `after` identity holds per line and per tab, `seats` and `pinned_seats` equal `received` ÷ 100 and `pinned` ÷ 100 per line and per tab (A39), the display tenths are rounded from the rational and not from the hundredths, each tab's figures are rounded once from the exact sum of its lines, `TOTAL` is absent for an exempt person, every code listed, no retired code | §12.1 |
| C5-R10 | S5: determinism | Byte-identical responses apart from timings, across processes and hash seeds | §12.1 |
| C5-R11 | S6: budget | A 25 s budget, overhead of at most 1 s, and the container gate | §12.1 stubs; §13 (C7) |
| C5-R12 | E1: deploy, guard and secrets | Own directory, trigger and script; guard tests; the SECRETS entries; the ping returns the build SHA | §12.1, handler tests; §11.5 after Frank's §11.4 |
| C5-R13 | v2 stays untouched | No diff under `gcf/`, in `cloudbuild.yaml` or in `scripts/deploy-solver-gcf.sh`; `solver-v2` is green | Diff review; C0's v2 job |
| C5-R14 | The combined, amended policy is accepted offline (A23) | The `full` matrix, scenario P16 and the private re-run pass, and their aggregates are recorded | §12.3 |
| C5-R15 | The independent checker C7 drives | It recomputes every hard check, rule instance and protection from `assignments` alone, prints counts and codes only, and agrees with the response on every acceptance run | §12.3 |

## Review handoff

- Review the parent first (with its amendments A1–A39), then C2 (whose ledger rules and fixture this
  spec implements), then this spec.
- Evidence: `owt-agent-logs/sdd/2026-10-05-solver-v3-fairness/evidence/`, in particular
  `f_final-proto.md`, `f_final-stress.md`, `u_solver-core.md`, `u_consumers-infra.md` and
  `u_solver-tests-fixb.md`. Prototype code: `prototype/v3/final/` (`v3f.py`, `chain.py`,
  `stress/v3p.py`). All of it is private and contains member data.
- Prior planning dialogue is excluded from reviewers.
- Implementation authorization: **not granted by this document.**

## Terminal state

`READY_FOR_REVIEW`. Three sibling changes this spec depends on are not made here and are listed
above: C2's FX-4 cases for a second seat and for an exact half, and C6's reading
of `seats` and `pinned_seats`. C5's implementation still waits for C2's fixture (Assumptions).
