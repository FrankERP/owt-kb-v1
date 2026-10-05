# Solver v3, child C5: the `owt-solver-v3` function — design spec

**Date:** 2026-10-05 · **Status:** `DRAFT` · **Parent:**
[`2026-10-05-solver-v3-fairness-design.md`](2026-10-05-solver-v3-fairness-design.md) (`APPROVED` by
Frank). This child owns parent §5 (S1–S6), the solver half of F1–F15, and E1.

**Risk tier: standard** (parent §11). The function is deployed separately, with its own source, trigger
and test job, and nothing calls it until C6 routes to it behind the engine constant and C7 flips that
constant. It writes nothing: no Sanity, no Vercel, no browser state. Its only security surface is the
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
- **C6.** The route, the client, the engine constant, `OWT_SOLVER_V3_URL`, `OWT_SOLVER_ENGINE`, the
  Spanish copy, the request builder and the «Equidad» panel.
- **The other children:**
  - C2: the ledger over stored data, the eligibility resolver, the X1 cadence-state function,
    authorship of the golden fixture, and the eligibility record.
  - C4: the record's reconstruction.
  - C1: the toggle.
  - C3: the cadence setting.
  - C7: running the timing gate, the Preview rehearsal and the flip.
- **Out of the parent's scope:** instruments, FOH, kids and MCP `solve_month` (parent §10).
- **Specials.** v3 never fills a special; a special reaches it only as pins (parent U3, ADR-0010 as
  amended).

## 4. Decisions

The parent's decisions are inherited and not reopened: D1–D15, X1–X4, F1–F15, S1–S6 and E1. The
decisions below are this spec's readings where the parent leaves a contract open. Where a decision
fixes a real gap in the parent, it is also listed under «Parent issues».

| ID | Decision | Why | Tradeoff |
|---|---|---|---|
| C5-1 | Each service has an opaque `id`. A pin carries the service `id` and its `date`, and the two must agree. | Two services can share a date: a Sunday-dated counted special next to the Sunday service, or two specials on one day (ADR-0011). | One more field per pin. |
| C5-2 | **Pattern exclusions (`!in`) and week exclusions arrive inside eligibility.** C2's resolver folds them into the record, so they are hard, except on a pinned seat's own row. The soft rule families are counts, pairs, presence, consecutive and the mandatory lead. There is no `week_exclusion` rule kind. | v2 never made exclusions soft (ADR-0041 lists six soft families). C2 stores them as date blocks (rule-excluded, outside the population). F12: «a seat only for someone eligible and available (or pinned)». | An admin cannot have a «Sem 3» exclusion «broken» to save another rule. v2 did not allow that either. |
| C5-3 | **Protections (F7, F9, F10, F11) and fairness lines see counted services only.** Rules (counts, pairs, presence, consecutive, mandatory lead) apply to every weekend service in the request, counted or not, and never to a special. | X1 defines «led» over counted Sundays. F1 ties each protection to «the line it maps to», and an uncounted service maps to no line. C2's LG-2 gives an uncounted service no floor and no X1 input. ADR-0010 keeps rules off specials. | Two Sunday leads in one month are not a cap miss when one of those Sundays is uncounted. |
| C5-4 | **Rule role sets and count values arrive resolved.** A rule carries `roles` (the six role keys, expanded by C2's resolver) and an integer `value`. A relative cap is already resolved against its month's full Sunday count by the caller, using C2's resolution. v3 has no pattern parser, and it refuses a negative value. | One expansion and one resolution, the ones the record stores, mean that request and record cannot disagree. | The parent's S2 sentence «a relative cap that resolves below 0 is 0» is applied by the caller, who also gives the notice (Parent issues 10). |
| C5-5 | The cadence state on the wire has three values: `on`, `off` and `out`. `out` is X1's «off» with no compensation Saturday: she is not eligible for Sun.Lead that month (C2's CAD-1 reason `not_eligible`). | X1 has two kinds of «off». From resolved eligibility alone, the solver cannot tell «not in the pool» from «unavailable every Sunday», and only the second earns the Saturday. | The caller maps CAD-1's reason to `out`. |
| C5-6 | The mandatory lead stays one of ADR-0041's soft families, counted in the rules stage. Fill's weights still rank Lead first. A `solve` weekend service where nobody is eligible or pinned for Lead has no mandatory-lead instance. Its Lead seats come back unfilled with reason `no_possible_lead` (S2), not as a violation. | F15 keeps ADR-0041's mechanism unchanged. F12 lists «at least one Lead» under fill. This reading satisfies both. | A leaderless service and a broken cap cost one violation each, as in ADR-0041. |
| C5-7 | The report gives two shares per person and line. `planned` is F13's: fixed before the solve and used by the objective. `share` is F14's: the shared ledger formula applied to the returned assignment. Then `after = carried + share − received`. | `after` («queda») must equal what C2's ledger will compute for the same services. The gap between `planned` and `share` is exactly what F13 measures. | Two numbers per line. C6 chooses which to show. |
| C5-8 | Each person-line figure is computed in exact rationals and rounded **once** to integer hundredths, half away from zero. Nothing is rounded per service. | This is F14's «rounding happens once» with its mode stated. It is identical to C2's LG-13, so both languages produce the same bits. | — |
| C5-9 | **Placing a monthly set-aside in the plan.** First subtract the person's pinned seats that already meet it. Spread the remainder evenly over her `solve` services in that month where she is eligible for a matching role and holds no pin. Within one service, split it equally among her eligible matching roles. | F5's «spread evenly» does not say how pins interact. Spreading over `fixed` services, where no seat can be given, or counting a pin twice would misstate the pool. | One more rule for C6 to explain. |
| C5-10 | **The realised formula is C2's.** The populations, presence seat, set-asides, sub-lines and floor seat in the report (and in the model's received count) follow C2's LG-4 to LG-11, translated into request terms (§6). Translation: a pin counts as a stored seat; `eligible` replaces «in ∧ available ∧ not rule-excluded»; `count ==` rules replace exact statuses. | F14 requires one formula, and the golden fixture (C2's) is its guard. | A later change to C2's LG rules is a change to C5. |
| C5-11 | F10 (the DL floor) is read per month. For each horizon month m in which a DL-line person is available, require her Sunday leads in m−1 plus her Sunday leads in m to be at least 1. The pair is skipped when m−1 is before her first DL-eligible month, or when m−1 is the stored previous month and has no stored services. | This follows F10's sentence. The prototype also demanded a lead in m1 when the person was available only in m1 of an (m1, m2) pair. | Differs from the prototype in that one case. |
| C5-12 | Capacity is computed once per run, over the run's months (§6.8). | F10 gives the formula for a pair of months. A one-month run also needs its population stated. | — |
| C5-13 | The pin cap is **250**. A request over it is refused. | A two-month board with 5 Sundays a month and a Saturday every week has 130 voice seats. Counted specials add their own seats as pins. 250 bounds how far rows can grow and still leaves headroom. | — |
| C5-14 | Reuse `OWT_SOLVER_API_KEY` (parent Q5 default). | Same trust boundary, same caller. A second key would double every rotation without a separation that matters: a leaked key buys CPU on either function, never data. | One rotation now redeploys two functions (§11.6). |

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
| `eligibility` | `{ "<service id>": ["Lead" \| "BGV" \| "Choir", …] }` | The roles the person may hold at each service. **Already resolved by the caller from C2's eligibility derivation**, which covers Tipo, pools or the month's record, `!in` patterns, week exclusions, and roles marked `out` (a count of 0 included). Two more inputs are folded in: availability on that date (record snapshot ∪ live `unavailableDates`, F4) and, for a special, the eligibility of its D14 line. Every key must be a request service |
| `carried` | `{ line key: int }` | Carried balance per line, from C2's 3-month window (F2–F3). Positive means owed. Keys are `DL`, `SL`, `BGV`, `CORO` and `P:<presence rule id>`; a missing key means 0. Each value must satisfy \|v\| ≤ 10000 (input validation, not a policy cap). A `P:` key with no matching presence rule in the request is accepted and reported as a carried-only line (§8.2). Any other key is refused |
| `cadence` | `{ "YYYY-MM": "on" \| "off" \| "out" }` | Present if and only if the person is «Mes por medio» (C3). It must have exactly one entry per request month, from C2's X1 function as mapped by C5-5 (F7). A person with `cadence` who also has an `==` count rule containing `Sun.Lead` is refused (`invalid_request`) |
| `dl_since` | `YYYY-MM` or `null` | The first month whose eligibility marks the person `Sun.Lead` «in». C2 reports it as `firstRecordedIn["Sun.Lead"]`. For a horizon month without a record, the month being solved counts. `null` means never. Used only for the F10 skip |
| `prev_dl_leads` | int ≥ 0 | The DL-mapped lead seats the person held at counted services in `prior.month` (F10) |

### 5.4 Rules

Every rule carries an `id` that matches `[A-Za-z0-9_-]{1,64}`. The `id` is the config item's own key,
so the report names the rule the way the rule card does. `roles` is a non-empty list of role keys.
Every person id must appear in `people`.

| `kind` | Fields | Scope and instances |
|---|---|---|
| `count` | `person`, `roles`, `op` (`==`, `<=`, `>=`), `month`, `value` (integer ≥ 0) | One object per rule per month; `month` must be a request month, and `(id, month)` is unique. **Instance** (`id`, `month`): the person's seats in `roles` at the weekend services of that month (fixed and non-fixed alike), compared with `value`. **Exact status:** in that month, role key k is «exact» for the person if and only if exactly one of her `==` rules lists k and its value is ≥ 1 (C2's REC-3/RES-3) |
| `pair` | `persons` (exactly 2), `roles` | Applies across the whole horizon. **Instance:** each weekend service where both people have a term. At most one of them holds a role in `roles` there |
| `presence` | `persons` (≥ 1, ordered), `roles`, `exclusive` (bool) | Applies across the whole horizon. `exclusive` is C2's RES-6 value, copied as is. **Instance:** each weekend service with a role key in `roles`, where at least one member holds such a role. This is per service, not per week as in v2's `each_week`, because F5 and F6 are per service. `P:<id>` is the rule's sub-line |
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
- duplicate service ids and duplicate count `(id, month)` pairs;
- the `prior.month` arithmetic;
- that every cadence member covers every request month;
- the conflict between `cadence` and an exact `Sun.Lead` rule;
- the pin checks in §5.5;
- negative values.

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

A presence rule applies only at counted weekend services (LG-7). Uncounted services have no
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

Reason (d) `not_in_record` cannot occur in a request: every holder is in `people`.

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

### 6.4 The floor seat (F5, F9; LG-11, which also resolves C2's Parent issue P4)

**Who gets one (realised).** Person p gets one floor set-aside in month m when all of these hold:

- p is not exempt;
- p is in some Pop or Q at a counted service of m;
- p's combined share over every line and sub-line of m, computed exactly and **without** floor
  set-asides, is **below 1**;
- p has at least one received seat in m;
- p holds **no** seat in m that is set aside for reason (a), (b) or (c). A fixed seat has already met
  the floor.

**Which seat.** The floor seat is p's first received seat in m, ordered by:

1. date;
2. role, Lead > BGV > Choir;
3. service `time` (absent first, then lexical);
4. service `id`.

A presence seat qualifies.

**In the plan.** p is a floor person when she meets the same conditions on `planned` shares, except
that she need not hold a seat yet. Her set-aside is placed as follows:

- She holds a pinned seat in m that is set aside for (a), (b) or (c): there is no floor set-aside.
- Otherwise she holds a received pinned seat in m: the earliest one, in the order above, is the
  set-aside.
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
- **Capacity**, computed once per run (C5-12):
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
| 8 | `saturday_cap` | Minimise Σ over (p, m) of max(0, S(p, m) − 1), for everyone | F11 and X3: cadence members included |
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
3. `rule`: a cap missed because her own `==` or `>=` value forces it.
4. `unavailable`: she had no non-fixed slot that could meet it.
5. `capacity`: a `dl_floor_missed` in a run with a `dl_capacity` notice.
6. `higher_priority`: the owning stage proved this optimum, so something ranked above it left no room.

### 8.2 `fairness`

`{ "scale": 100, "tolerance": n, "lines": [line keys in stage order], "people": [ … ] }`

Each entry in `people` is `{ "person", "floor", "lines" }`:

- **`floor`:** `[{ "month", "planned": bool, "realised": bool, "seat": { "service", "role" } | null }]`.
- **`lines`:** `{ "<line key>": { … } }`. Each line holds:
  - `carried`: from the request;
  - `planned`: F13;
  - `share`: F14, computed on the assignment;
  - `received`: 100 × the seats counted in the line;
  - `pinned`: the part of `received` that comes from pins;
  - `set_aside`: 100 × the seats she held in the line's services that were set aside;
  - `after`: `carried + share − received`. This is an identity, and a consumer may assert it;
  - `in_stage`: bool;
  - `clamped`: true when a clamp changed her set-aside in this line.

A line appears for a person when any of these holds:

- she is in its population at one or more horizon services;
- she has a carried value for it;
- she received anything in it.

`tolerance` is the F13 constant (§12.4), so no consumer needs to mirror it. Total is not a line; it is
the display sum (D3, C6).

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

Everything for v3 lives under `gcf_v3/` and imports nothing from `gcf/`. C0's CI contract (I2) makes
`gcf/` unimportable in the v3 job. No v2 code is copied: v3 needs no pattern parser (C5-4), and its pin
handling is keyed by service.

| Path | Contract |
|---|---|
| `gcf_v3/main.py` | The HTTP entry point `solve` (functions-framework) |
| `gcf_v3/owt_solver_v3.py` | Run as `python gcf_v3/owt_solver_v3.py --json-mode` from the repo root. Reads one request on stdin and writes one response on stdout. Exits 0, including for `ok: false`. This is C6's local-dev path, the v3 equivalent of `route.ts:122` |
| `gcf_v3/owt_v3/` | The package. It holds `codes.json` and a module containing the literal line `PIN_CAP = 250` exactly once, for C6's textual sync test (U8) |
| `gcf_v3/requirements.txt` | `ortools==9.15.6755` and `functions-framework>=3.0,<4`. C0 scaffolds the first line. The ortools pin moves only together with v2's and the local env |
| `gcf_v3/.gcloudignore` | C0's copy of v2's file, plus `tests/`, `acceptance/` and `cloudbuild.yaml` |
| `gcf_v3/tests/` | The unit suite (§12.1), a package with `__init__.py` so that C0's discovery contract (I2) reaches it. C0's `test_scaffold.py` may be kept or replaced |
| `gcf_v3/acceptance/` | The harness, the fictitious world and the scenarios (§12.3). It is a package and contains no `test*.py` (C0's I2) |
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

**Not introduced here.** `OWT_SOLVER_V3_URL` and `OWT_SOLVER_ENGINE` are read by C6's route, so C6
introduces and documents them. C5 supplies only the URL's source command (§11.5).

## 12. Tests, acceptance and the F13 tolerance

### 12.1 Unit suite (`gcf_v3/tests/`, in C0's `solver-v3` job)

Every name in the suite is fictitious. It runs from the repo root as
`python -m unittest discover -s gcf_v3 -t gcf_v3 -v`.

**Contract**

- Every refusal in §5.8 returns its code with HTTP 422, never a 500, and unknown keys are refused.
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
  and `balance` in every `ledger` case of `fixtures/fairness/golden.json` (C2's FX-3).
- Exact balances sum to 0 per (service, role key) and per (rule, service).
- C5 adds hand-computed `plan` cases for §6.5 (FX-2 reserves them), and Python asserts them.
- The suite fails if the file is missing, or if it has no `ledger` cases.

**Model contracts**

- Per-month `count` rules in a two-month run.
- The trailing Saturday of month 1 counts in its own month within a two-month horizon.
- `pair` and `presence` apply per service.
- `consecutive` links across the month boundary and against `prior.services`.
- Each clamp notice.
- `no_possible_lead`.
- Rows grow to fit pins.
- A `fixed` service gains no seat.
- A special never appears in a rule instance.
- Uncounted services stay out of lines and protections (C5-3).
- Populations, set-asides and the floor seat follow §6.2–§6.4. This covers:
  - the sole-member and exclusive presence cases;
  - the plan's F6 for pins and for exact rules with no slack;
  - C5-9's pin remainder.
- Hand-computed planned shares.
- Exact rational conservation.
- The `after` identity.
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

- The v3 job (§12.1 plus the CI subset of §12.3) must finish within 10 minutes on `ubuntu-latest`, with
  a target of 6.
- C5 sets the job's `timeout-minutes` by C0's rule: at least twice the measured job time.
- The suite never freezes a schedule (§10).
- Assertions on stage status rely on the deterministic limit, never on the wall guard.

### 12.3 Acceptance: the combined, amended policy

**The harness.** `python gcf_v3/acceptance/run.py --world <path> --matrix ci|full --out <dir>` runs
chained solves. Between runs it derives each next request's inputs:

- carried balances, from the same Python function over the chain's stored months (the 3-month window,
  F3);
- cadence states, from a **test-only** Python X1 that is asserted against C2's `cadence` fixture cases.
  It is never shipped, and the production X1 remains C2's alone (F7);
- `dl_since`, `prev_dl_leads` and `prior`.

`--emit-requests <dir>` writes the request bodies for the timing-gate shapes (§13).

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

**The private re-run on real data.** This is the parent's «Run A on the real Nov+Dec request».

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
- **One ADR**, numbered as the next free number at merge, recording E1: a second function with its own
  source, trigger and suite. It records two rejected alternatives: a second entry point inside `gcf/`,
  and a version field in one function. The ADR amendments that take effect only once v3 serves Auto
  (parent §9: 0004, 0038, 0041, 0046, 0047) belong to C7.

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
or be deleted (Frank's call). Revert the PR. No data depends on the function.

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
    - `pair{id, persons[2], roles}`;
    - `presence{id, persons[], roles, exclusive}`;
    - `consecutive{id, person, roles}`.
  - `pins[]{service, date, role, person}`.
  - `prior{month, has_services, services[]{date, kind, counts, seats}}`.
- **Response fields:**
  - `contract`, `engine`, `solver_version`, `build`, `reproducible`;
  - `assignments{<service id>: {Lead, BGV, Choir}}`, `unfilled[]`, `pins{requested, honored}`,
    `violations[]`, `violation_ceiling{value, proven}`;
  - `stages[]{id, status, reason, value, bound, limit, ms, det_milli}`;
  - `fairness{scale, tolerance, lines, people[]{person, floor, lines{carried, planned, share, received,
    pinned, set_aside, after, in_stage, clamped}}}`;
  - `cadence[]`, `missed[]{code, person, month, month1, month2, dates, count, cause}`,
    `notices[]{code, params}`;
  - on failure: `{ok: false, code, params}`.
- **What C6 must send:**
  - eligibility built only from C2's derivation, plus availability and the D14 eligibility of specials;
  - week exclusions and `!in` patterns only through eligibility: there is no `week_exclusion` rule
    (C5-2);
  - role sets as six-key lists, using C2's expansion, and counts resolved per month, with a below-zero
    result sent as 0 and noticed by C6 itself (C5-4);
  - presence `exclusive` copied from C2's RES-6;
  - cadence `out` exactly when CAD-1's reason is `not_eligible`, otherwise CAD-1's on/off (C5-5);
  - `fixed: true` for stored horizon services and counted specials, with their seats as pins (U2, U3);
  - `counts` from C1's legacy read.
- **What C6 must refuse before sending:** everything §5.8 would refuse, including a cadence member who
  also has an exact `Sun.Lead` rule.
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
- **Past facts.** `firstRecordedIn["Sun.Lead"]` gives `dl_since`, and `countedSundayLeads` gives
  `prev_dl_leads`. Whether the previous month has stored services gives `prior.has_services`.
- **The realised formula.** C2's LG-4–LG-11 and LG-13, which C5 implements in Python under C5-10.
  This includes C2's resolution of Parent issue P4: no floor set-aside when a fixed seat already met
  the floor.
- **The golden fixture.** `fixtures/fairness/golden.json`, with C2's FX-2 schema: `schemaVersion: 1`,
  `units: "hundredths"`, `sign: "positive_owed"`, and `cases[]{id, kind, description, covers, input,
  expected}`.
  - C5's Python asserts every `ledger` case per month, resolving the records as LG-5–LG-8 state.
  - C5 adds `plan` cases, and C2's vitest schema-checks them.
  - The acceptance harness carries a test-only X1, checked against C2's `cadence` cases and never
    shipped. The production X1 stays C2's alone (F7).
  - The FX-4 coverage list is required, including the non-exclusive presence case and the floor-seat
    cases.

**Consumed from C0 (CI)**

- **Job.** `solver-v3` (C0's I1): from the repo root, `pip install -r gcf_v3/requirements.txt` and then
  `python -m unittest discover -s gcf_v3 -t gcf_v3 -v`. The full tree is checked out, so `fixtures/` is
  readable. It counts toward `gates`.
- **Discovery.** C0's I2 discovery contract.
- **Scaffold.** The I3 scaffold, which C5 inherits.

**Consumed from C1 and C3 (via C6)**

- `countsForFairness` becomes `counts`.
- `sundayCadence: "alternate"` («Mes por medio») becomes the presence of `cadence`.

**Provided to C7**

- The timing-gate definition (§13) and the emitted request shapes.
- The deploy verification (§11.5).
- The source command for the `OWT_SOLVER_V3_URL` value.
- `FAIRNESS_TOLERANCE` and the aggregates of the private run, for the cutover record.

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
  between the two passes.
- Pins are not visible in stored data. The plan applies F6 for pins, but C2's later ledger cannot, so
  those months' populations differ slightly once stored.
- Excess caused by pins is forgiven once it leaves the 3-month window (X4). C6 shows the cumulative
  figure.
- When two non-exclusive presence members hold matching seats at a stored service, C2 attributes the
  forced seat by stored array order. The report attributes it by id order, and these can differ. No
  non-exclusive rule exists today.
- Which rule gives way among minimal sets of equal size is the solver's choice (ADR-0041).
- Determinism holds per platform, and only for runs where every stage is `proven`.
- Presence is checked per service, not per week as in v2. `consecutive` means «a seat on both
  weekends»; it does not reproduce v2's quirk of «at most one seat across two weeks».
- Two Sunday leads in one month are not a cap miss when one of those Sundays is uncounted (C5-3).
- A person with an exact `Sat.Lead` rule above 1 always misses the Saturday cap, with cause `rule`.
  See Parent issue 9.
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

Each issue is followed as stated in this spec, and its fix is recommended for the parent.

1. **S1's «pins by (date, role, person)» is ambiguous when two services share a date.** This happens
   with a counted Sunday special beside the Sunday service, or with same-day specials (ADR-0011).
   *Fix:* pins name the service id and keep the date as a check (C5-1).
2. **S1 lists «week exclusions resolved to dates» among rules, but F12 and F15 make every rule soft.**
   v2 never softened exclusions, and C2 stores them as eligibility blocks. *Fix:* `!in` patterns and
   week exclusions reach the solver only through eligibility (C5-2).
3. **F9–F11 do not say whether an uncounted weekend service counts toward a protection.** *Fix:* only
   counted services count, for both protections and lines; rules see every weekend service (C5-3).
   Counting every seat toward protections was rejected because it disagrees with X1's «counted
   Sunday».
4. **F5 does not say which seat is the forced presence seat when members are not mutually exclusive.**
   *Fix:* C2's LG-7 order, adopted here (C5-10).
5. **S4's «balance after» does not say whether it uses the planned share (F13) or the realised one
   (F14).** *Fix:* report both, and compute `after` from the realised share (C5-7).
6. **F14's «rounding happens once» gives neither the point nor the mode.** *Fix:* round each
   person-line figure once, half away from zero, to hundredths (C5-8 = LG-13).
7. **S1 omits the previous-month facts F10 needs.** *Fix:* add `prev_dl_leads`, `dl_since` and
   `prior.has_services`.
8. **F12 lists «at least one Lead» under fill, while F15 and ADR-0041 count the mandatory lead as a
   soft rule.** *Fix:* keep it a soft family, with no instance where no lead is possible (C5-6).
9. **F11 exempts exact-count leads from the Sunday cap only.** So an exact `Sat.Lead` rule above 1
   always misses the Saturday cap. *Followed:* the cap applies, with cause `rule`. *Recommended:* exempt
   them symmetrically.
10. **S1 says relative caps arrive resolved, while S2 has the solver floor them at 0.** *Fix:* the
    caller resolves them, with C2's resolution, and gives the below-zero notice; the solver refuses a
    negative value (C5-4).
11. **X1's «off» comes in two kinds: with the compensation Saturday and without it.** *Fix:* a third
    wire state, `out` (C5-5).
12. **F10's capacity formula covers only a pair of months.** *Fix:* one capacity per run, whose
    population is the people whose floor the previous month has not already met (C5-12).
13. **§11 asks C5 to accept on «the real Nov+Dec request», but the real request builder belongs to C6,
    which comes after C5.** *Fix:* C5 uses a private converter, and C7's rehearsal re-checks with the
    real builder (§12.3).

## Acceptance and verification

| ID | Requirement | Acceptance evidence | Verification |
|---|---|---|---|
| C5-R1 | The S1 request contract (§5), with coded refusals | Every §5.8 case is refused with its code, and the example is accepted | §12.1, contract tests |
| C5-R2 | A run never sinks because of one service or one rule (S2) | Notices for clamps, `no_possible_lead`, scenarios P8 and P9, and no `ok: false` other than refusals and `timeout` | §12.1, scenario set P |
| C5-R3 | The F12 stages and the S3 settings | Stage order and fixing; settings asserted from the solver's parameters; budget and limit semantics | §12.1, stage tests |
| C5-R4 | F15: pins and rules | P1–P7; the ceiling is never raised; the report is rebuilt from the assignment | Scenario set P; §12.1 |
| C5-R5 | F5 and F6: set-asides, the floor seat, the one-available qualifier | Hand-computed cases, run C's floor proof, scenario P10 | §12.1; §12.3, run C |
| C5-R6 | F13: planned shares, with a measured tolerance | `plan` cases, and `FAIRNESS_TOLERANCE` recorded at or below 50 | §12.1; §12.4 |
| C5-R7 | F14: one formula | Every `ledger` case in the golden fixture reproduced to the hundredth | §12.1, golden test |
| C5-R8 | Cadence, compensation, floors, caps and consecutive Sundays (F7–F11, X1–X3) | The pass criteria of runs A–D; scenarios P5 and P12–P14 | §12.3 |
| C5-R9 | The S4 response and the codes | Every field present, the `after` identity holds, every code listed, no retired code | §12.1 |
| C5-R10 | S5: determinism | Byte-identical responses apart from timings, across processes and hash seeds | §12.1 |
| C5-R11 | S6: budget | A 25 s budget, overhead of at most 1 s, and the container gate | §12.1 stubs; §13 (C7) |
| C5-R12 | E1: deploy, guard and secrets | Own directory, trigger and script; guard tests; the SECRETS entries; the ping returns the build SHA | §12.1, handler tests; §11.5 after Frank's §11.4 |
| C5-R13 | v2 stays untouched | No diff under `gcf/`, in `cloudbuild.yaml` or in `scripts/deploy-solver-gcf.sh`; `solver-v2` is green | Diff review; C0's v2 job |
| C5-R14 | The combined, amended policy is accepted offline | The `full` matrix and the private re-run pass, and their aggregates are recorded | §12.3 |

## Review handoff

- Review the parent first, then C2 (whose ledger rules and fixture this spec implements), then this
  spec.
- Evidence: `owt-agent-logs/sdd/2026-10-05-solver-v3-fairness/evidence/`, in particular
  `f_final-proto.md`, `f_final-stress.md`, `u_solver-core.md`, `u_consumers-infra.md` and
  `u_solver-tests-fixb.md`. Prototype code: `prototype/v3/final/` (`v3f.py`, `chain.py`,
  `stress/v3p.py`). All of it is private and contains member data.
- Prior planning dialogue is excluded from reviewers.
- Implementation authorization: **not granted by this document.**

## Terminal state

`READY_FOR_REVIEW`
