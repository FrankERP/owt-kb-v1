# Solver v3, child C6: the planner on v3 — engine switch, 1–2-month horizon, stored services as pins, live «Equidad» — design spec

**Date:** 2026-10-05 · **Status:** `DRAFT` · **Parent:**
[`2026-10-05-solver-v3-fairness-design.md`](2026-10-05-solver-v3-fairness-design.md) (APPROVED by
Frank) — this child owns parent §7 (U1–U8) and its part of §8 E2 (A1). The parent's amendments
A1–A26 (its §3) win over older clause wording; this spec is aligned to them (A1, A2, A5–A7, A9–A11,
A13–A15, A17, A19, A21, A23, A24 touch it).
**Risk tier: standard, except §5.11 (the confirm protocol, U4), which is critical** — see §15.

**Contracts, not prescriptions.** This spec states what must be true and what must never happen.
Helper names, file layouts and loop shapes belong to the implementation plan. Existing files and
functions are cited as evidence only.

**Names.** This repository is public. Members are described by their role in the policy («the
cadence members», «the fixed-count lead», «the exempt members»); every example uses fictitious
names (Ana, Bruno, Carla, Dani).

## 1. Original request

The parent's request, verbatim and redacted there:

> Necesitamos arreglar en solver. Tiene que tomar en cuenta el historial, pero debe de considerar a
> personas "especiales" como el caso que te platique de [REDACTED: three member names] que solo
> dirigen un mes sí y un mes no. Y mantener el fariness en ventanas más grandes, siempre siendo claro
> y transparente con el admin al respecto. […] Recuerda que debe de poder respetar los espacios
> asignados y necesitamos también que pueda llenar 2 meses de jalón — and: «Y la participación total
> también»

And the instruction that started the children: «Aprobado, sigue con los specs de las entregas».

## 2. Outcome

- **Primary outcome.** With the engine set to v3, Auto in the `/admin` planner plans **one or two
  calendar months in one run**, respects every stored and pinned seat, sends the solver the
  eligibility-normalised balances, writes each month's eligibility record before any draft (except
  for a month already anchored by services planned without one — a deviation from the parent's
  literal L3/U4/A6 that waits on PI-7's amendment), and
  tells the admin in Spanish why each person got what they got. With the engine at v2 (the default,
  and production until C7), **nothing the admin or the team sees changes**.
- **Operator.** The worship admin running Auto in Servicios (today Frank).
- **Current behaviour.** One month per run; one `year`/`month` in state; create mode ignores stored
  rosters; specials never reach the solver; the confirm writes drafts only; the only fairness surface
  is «sin Lead en …», which judges last month against today's pool; a slow solve reads as «El solver
  no encontró solución.».
- **Success measure.** Parent §16 on Preview with the engine at v3 (C7 runs it); every acceptance row
  of §14 green; v2's tests and request bytes unchanged.

## 3. Evidence

| Fact | Source | Implication |
|---|---|---|
| Engine-style switches already exist as neutral code constants with an explicit union type (a literal type turns the rollback branch into TS2367) | `app/components/admin/solverHistorySource.ts:30-36,54` | `SOLVER_ENGINE` follows the same shape and annotation |
| A pure env-taking resolver keyed on `VERCEL_ENV` is the repo's precedent for "this deployment's environment decides" | `app/mcp/oauth/origin.ts:20-33` | The effective engine is resolved the same way, on the server |
| `/admin` is a Server Component; `AdminPanel` is `"use client"`; `ServicesPanel` takes no props and mounts `MonthGenerator` (dynamic, `ssr: false`) for both create and stored mode | `app/(client)/admin/page.tsx:11-51`; `AdminPanel.tsx:1,52`; `ServicesPanel.tsx:20,194,984-1063` | The engine reaches the planner as a prop resolved at render; a client cannot read a non-public env var |
| A Server Component may not call a value imported from a client module (56-minute outage) | CLAUDE.md, ADR-0028; `app/utils/__tests__/clientBoundary.test.ts` | The engine module is neutral (no `"use client"`, no imports) |
| The solve route: `maxDuration = 60`; remote fetch has no timeout; local spawn killed at 120 s; auth refusals, then JSON parse, then a 400 on empty `sunday_leads`, then dispatch on `OWT_SOLVER_URL`; every `ok:false` is a 422; route-made failures carry `transport_error: true` | `app/api/admin/solve/route.ts:8,97-117,120-160,162-189` | The engine check goes after auth and before v2's body validation; a v2 body under v2 must traverse today's path unchanged |
| The client solve `fetch` has no abort; a non-422 failure parses no body, so a 504 or 409 renders `solverRefusalMessage(undefined)` = «El solver no encontró solución.» | `MonthGenerator.tsx:3638-3669`; `plannerModel.ts:1393-1405` | v3 needs its own abort and copy; v2 needs exactly one new branch (the 409) |
| The trailing-Saturday retry fires on a 422 without `transport_error` whose request sent `weeks + 1` | `MonthGenerator.tsx:3651-3666`; ADR-0048 (Q19) | v2-only; v3 has no weeks and no such retry |
| v2's pin handshake reads `pinned_honored` and week-keyed `schedule`; pin violations are parsed from v2's string grammar; unfilled seats are `"W2 Sunday Sun.Choir #2"`; `PINNED_CAP = 100` mirrors the solver | `pinModel.ts:57,60,107-171,175-224,230-241`; `pinViolations.ts:27-50,68`; `plannerModel.ts:1488-1654` | None of these can read a v3 response (U8) |
| Auto's state is one `year`/`month`; the Sunday spine, selections, columns, pins and drafts derive from it; create-mode columns are one per date, keyed `create:type__date` | `MonthGenerator.tsx:1799-1824,2216-2266`; `plannerModel.ts:429-470,1686-1693` | The horizon replaces the single month under v3 only |
| Stored mode translates admitted stored documents into grid columns keyed by document `_id`, behind a coherence check over the roles and integrity reads | `storedRoleReadModel.ts:27-48,111-153`; `MonthGenerator.tsx:1903-1930` | «Guardado» columns reuse that translation and that coherence verdict |
| Create mode receives `existingRoles` (collision refs, no people) and `allRoles` (full rosters) | `ServicesPanel.tsx:1040-1060`; `MonthGenerator.tsx:3445-3450` | Stored seats come from the full-roster read, never from collision refs |
| `GET /api/admin/roles` returns every role of the three types across all dates, through `operationalClient` (`published` perspective: app drafts with `published: false` are included, `drafts.*` ids are not), with seats projected by `defined(@->)` (a dangling reference is dropped); C1 adds the effective `countsForFairness` per row | `app/api/admin/roles/route.ts:47-85`; `sanity/lib/operationalClient.ts:16-23`; C1 C1-R8 | The previous month's stored facts C5's `prior` needs (RQ-7) come from this read, which the planner already holds |
| The grid already evaluates week exclusions against each column's own month spine | `PlannerGrid.tsx:279,793,813`; `MonthGenerator.tsx:4632` | A multi-month grid needs no new spine mechanism on the grid side |
| Specials are filled greedily after the solve, at every exit, Lead and BGV only, ranked by a 56-day load window | `MonthGenerator.tsx:384,3461-3518`; `localFill.ts:80,247-302` | Uncounted specials keep this; counted specials need a pre-solve fill ranked by balance |
| Confirm: drafts posted one at a time with a stable `creationRequestId`; only confirmed successes become `exists`; a partial failure keeps the dialog open; the history dual-write appends the month's weekend drafts to `localStorage` | `MonthGenerator.tsx:3909-4074,4050-4059`; `monthDraftCreate.ts:106-124`; `MonthGenerator.tsx:360-373` | U4 builds on this; Q4 keeps the append, per month |
| «Crear N borradores» and «Crear y publicar» are two footer buttons | `MonthGenerator.tsx:4849-4854` | Horizon 2 removes the second |
| `LeadPoolHistoryPanel` is mounted three times (config step, derived and per-browser; grid step, both modes) beside the «Historial» block | `MonthGenerator.tsx:1505-1531,1736-1746,1763-1784,4490-4499` | Under v3 these are not mounted; deleting them is C7's |
| Auto's derived-history read is fresh per run, bounded by a 20 s abort, and a failure refuses the solve | `MonthGenerator.tsx:379-381,3822-3848,3874-3894` | The ledger read follows the same discipline (L5) |
| v2 role reach: Sun.Lead = Sunday pool; Sat.Lead = Sunday ∪ Saturday pools; BGV and Choir = every pool; the planner de-duplicates pools Sunday > Saturday > support only because v2 requires mutually exclusive lists | `gcf/owt_solver_v2.py:642-648`; `plannerModel.ts:871-875` | v3 eligibility follows the union, never `solverPools`' de-duplication |
| Sync guards read solver source from vitest | `app/components/admin/__tests__/patternRolesSync.test.ts:15-40` | The v3 pin cap and the code registry get the same kind of guard |
| `OWT_SOLVER_API_KEY` and its companion `OWT_SOLVER_URL` are documented | `docs/SECRETS.md:485-500` | `OWT_SOLVER_V3_URL` gets its entry in this change; `OWT_SOLVER_ENGINE`'s entry is C2's (A1) |
| Engine ownership is settled by the parent: C1 creates `solverEngine.ts` with the constant only; C2 adds the effective-engine resolver (override honoured on the `preview` branch deployment or with `VERCEL_ENV` unset), its SECRETS entry and the PUT's `engine_not_v3`, and returns `engine` from its GET; C6 adds the solve route's 409 and the server-resolved prop | parent A1 (`2026-10-05-solver-v3-fairness-design.md:122`); C1 interface table, row «Engine constant»; C2 EN-1–EN-3, WR-6, RD-3 | C6 consumes the resolver; it never writes a second one, a second SECRETS entry or a second PUT gate |
| A month with stored weekend services or counted specials keeps its record (A5); only such a month binds the solve to its record (A6) | parent A5, A6 (`…-fairness-design.md:126-127`) | «Anchored» (§4) is the one predicate behind binding, the confirm's entry shapes and its record skip |
| The current month at cutover, planned under v2, stays «sin registro» until past and is then reconstructed; «Registrar» is Frank's explicit, permanent alternative | parent A21 (`…-fairness-design.md:142`); C7 plan, Step 10 and Decision K4 (sibling plan, revised in parallel) | A v3 confirm must not mint that record silently (CF-1 (iii)) — which departs from the literal L3, U4 and A6 (`…-fairness-design.md:294-295,326,127`); PI-7 asks the parent to amend them |

## 4. Definitions

- **Engine.** `"v2"` or `"v3"`. The **code default** is `SOLVER_ENGINE`; the **effective engine** is
  the value the server resolves for this deployment (§5.1).
- **Horizon.** The ordered list of 1 or 2 consecutive calendar months a v3 run plans. Under v2 the
  horizon is exactly the selected month.
- **Planned column.** A create-mode column for a target that does not yet exist.
- **Stored column («Guardado»).** A service of a horizon month that exists in Sanity, shown read-only
  in the create grid.
- **Fixed service.** A service sent to the solver with every voice seat pinned and its seat count
  equal to its pins: every stored service in the horizon, and every counted special.
- **Counted.** `countsForFairness` resolved per L1 (C1).
- **Anchored month.** A horizon month with at least one **freezing service** (C2 §4: a stored
  weekend service or a stored counted special, published or not) — exactly A5's condition for keeping
  a record. An uncounted special alone never anchors a month. Read as `horizon[].storedServices > 0`
  from the same fresh `GET /api/admin/fairness` the run (or the no-Auto confirm, CF-2) reads.
- **Bound month (A6).** A horizon month that has an eligibility record
  (`fairnessMonth.YYYY-MM`, A2) and is anchored — read as that GET's `horizon[].recordBinds`, which
  C2 computes and C6 never re-derives (C2 RD-3). Every horizon month is in exactly one of four
  states:

  | Record | Anchored | State | Month source (RQ-2) | Confirm (CF-1, CF-3) |
  |---|---|---|---|---|
  | yes | yes | **bound** | the record | sends the record's own content, expects `unchanged` |
  | yes | no | **recorded, unbound** | on-screen config | sends the on-screen body under the record's `rev`, expects `replaced` or `unchanged` |
  | no | no | **unrecorded** | on-screen config | sends the on-screen body with `expectedRev: null`, expects `created` or `unchanged` |
  | no | yes | **anchored, unrecorded** | on-screen config | writes **no** record for it (PI-7: a deviation from the parent's literal L3/U4/A6, pending its amendment) |

- **Solve snapshot.** For each horizon month, its month source and its state as of the run's ledger
  read (RQ-1, RQ-2), frozen with the plan.

## 5. Requirements

### 5.1 Engine switch (E2)

**Ownership (parent A1).** C1 creates `app/components/admin/solverEngine.ts` with the constant
`SOLVER_ENGINE` only. C2 adds the pure resolver of the effective engine (the override
`OWT_SOLVER_ENGINE`, honoured only on the `preview` branch deployment or when `VERCEL_ENV` is unset in
local development — never on `verify/service-readiness` or production), its `docs/SECRETS.md`
entry, the PUT's refusal `engine_not_v3` (WR-6) and the GET's `engine` field (RD-3). C6 adds only what
is listed below: the solve route's `409 solver_version_mismatch` and the server-resolved engine passed
to the planner.

| ID | Requirement | Acceptance |
|---|---|---|
| ENG-1 | C6 **imports C2's resolver** (A1) and writes no second one. The module stays **neutral** (no `"use client"`, no imports); C6 adds the exported union type `"v2" \| "v3"` only if C1/C2 did not, and never changes `SOLVER_ENGINE`'s value (`"v2"`) or its union annotation. If C2's plan placed the resolver outside `solverEngine.ts`, C6 imports it from where it is — moving it is allowed, duplicating it is not. | `clientBoundary.test.ts` passes; a test pins `SOLVER_ENGINE === "v2"`; grep guard: exactly one function in `app/**` reads `OWT_SOLVER_ENGINE` |
| ENG-2 | The resolution rule (A1: the override honoured on the `preview` branch deployment or with `VERCEL_ENV` unset, never on `verify/service-readiness` or production) and its table test are **C2's**. C6 restates nothing of it and relies on it unchanged; with `VERCEL_ENV` unset a developer reaches v3 locally through the override and RT-3's local entry point. | C2's resolver tests stay green |
| ENG-3 | The effective engine is resolved **on the server only**: by the `/admin` page at render (passed down as a prop to the planner and to every engine-dependent surface C6 wires, §5.10) and by `/api/admin/solve` on every request. No client module reads `process.env` for it or calls the resolver. C2's GET `engine` is the same resolver's output on the same deployment; C2's own surfaces (its «Registrar» gate, UI-6) keep reading it there. | A static guard test: the resolver is imported only by server modules (`page.tsx`, route files, C2's commit/read modules); a render test: the planner shows v3 controls iff the prop says `"v3"` |
| ENG-4 | Every engine-dependent behaviour C6 owns or wires in the client branches on that prop, never on `SOLVER_ENGINE` directly, so Preview's override and production's constant can never disagree inside one bundle. A page rendered before a deployment change can disagree with a later request; the server gates — the solve route's 409 (RT-1) and C2's PUT `engine_not_v3` (WR-6) — are the backstop. | Grep guard: no client file compares `SOLVER_ENGINE` |
| ENG-5 | Flipping production is a PR that changes `SOLVER_ENGINE` (C7). Rollback is the reverse PR. The production override is ignored by construction (A1), so a stale production variable can never make either PR a no-op. | C2's resolver table |

### 5.2 The solve route

| ID | Requirement | Acceptance |
|---|---|---|
| RT-1 | After the two existing auth refusals and the JSON parse, the route resolves the effective engine (C2's resolver) and classifies the body by the v3 contract marker (`contract: 3`, IF-C5). A **v3 body under v2** or a **v2 body under v3** is answered `409 { ok: false, error: "solver_version_mismatch", engine }` before any other validation. The server's engine decides; the body never selects one. | Route tests, both directions, no upstream call made |
| RT-2 | **v2 under v2 is today's path, byte for byte**: same 400 on empty `sunday_leads`, same `OWT_SOLVER_URL` dispatch, same remote and local behaviour (no new timeout), same status mapping. | Existing route tests unchanged and green; a test asserts the request body forwarded upstream equals the received body |
| RT-3 | **v3 under v3**: remote when `OWT_SOLVER_V3_URL` is set (sent with the `X-Api-Key` header carrying `OWT_SOLVER_API_KEY`, C5-14); otherwise, **only when not on a Vercel deployment** (`VERCEL_ENV` unset), the local v3 entry point (`python gcf_v3/owt_solver_v3.py --json-mode` from the repo root, C5 §11.1). On a deployment without the URL the answer is a JSON transport error with reason `not_configured`, never a spawn. | Route tests for the three cases |
| RT-4 | The v3 upstream call — remote **and** local — is aborted at **≤ 55 s** and answered as JSON `{ ok: false, transport_error: true, transport: "timeout" }`. `maxDuration` stays 60. | Fake-timer tests on both paths |
| RT-5 | **One point of classification.** An upstream JSON body with `ok: false`, `contract: 3`, `engine: "v3"` and a string `code` is the solver's own coded failure, whatever its HTTP status (C5 §8.3 uses 422, 400, 401, 405, 503 and 500): the route forwards that body **verbatim with status 422** (today's v2 rule: every `ok:false` is a 422). Every other failure is route-made: JSON with `transport_error: true` and a `transport` reason — `timeout`, `unreachable` (fetch threw), `http_status` (non-2xx without a coded v3 body), `not_json`, `not_configured`, `contract_echo` (an `ok: true` body without `contract: 3` and `engine: "v3"` — e.g. a v2 function at the v3 URL). Nothing becomes a 500. | Route tests per reason, and one per C5 failure status (401 and 503 bodies arrive as 422 with their code) |
| RT-6 | The route never parses or rewrites a v3 success body beyond the contract-echo check. | Route test: body forwarded verbatim |

### 5.3 Horizon and grid (U1)

| ID | Requirement | Acceptance |
|---|---|---|
| HZ-1 | Under v3 the config step offers «Planear: 1 mes · 2 meses» (`SegmentedControl`, default «1 mes») beside the existing Mes/Año selects, which choose the horizon's first month. Under v2 the control is **absent** and every v2 state, request and copy is unchanged. | Render tests per engine |
| HZ-2 | The planner's month state becomes a horizon under v3. Every per-month derivation (full Sunday spine, Sunday deselections, active Saturdays, specials) is per month; a selection can never leak into a month outside the horizon; changing the first month or the length resets the selections of months that leave the horizon, as a month change does today. | Unit tests over a Dec→Jan horizon and a length change |
| HZ-3 | Each date belongs to exactly one horizon month: its own calendar month (CDMX `YYYY-MM` string, never through a `Date`). A month-end Saturday whose Sunday is in the next month is a service of its own month (ADR-0048) and is never offered by the next month's calendar. | Test: Oct+Nov 2026 offers 31 Oct once, under October |
| HZ-4 | The setup step shows one `MonthCalendar` per horizon month, stacked, each keyed by its month. | Render test |
| HZ-5 | The grid is **one** `PlannerGrid` whose columns span the horizon in date order, with a month band naming each month and a visible boundary at the first column of the second month. The band lives inside the grid's own horizontal scroller (ADR-0035: no page-level horizontal scroll). | Render test; phone-width check in C7's look |
| HZ-6 | The participation sidebar says which months it counts; with 2 months it offers «{Mes1} · {Mes2} · Ambos» (`SegmentedControl`, default «Ambos»). Each stored service is counted once (never as both a saved role and a column). | Unit test on the counted set |
| HZ-7 | Under v3, a horizon that contains a month **before the current CDMX month** is refused by Auto before any read (parent A24): «Auto no planea meses que ya pasaron. Crea esos servicios a mano.» (L3: their records are the reconstruction's.) | Test with a fixed clock |
| HZ-8 | Grid-side rule enforcement keeps using each column's own month spine. | Existing `sundayDatesForColumn` tests plus one cross-month case |

### 5.4 Stored services in the horizon (U2)

| ID | Requirement | Acceptance |
|---|---|---|
| ST-1 | Under v3, every stored service of a horizon month appears as a read-only «Guardado» column built from the same full-roster read and the same admission/coherence verdict the stored editor uses. Auto refuses to solve while that read is not ready or not coherent: «No se pudieron leer los servicios guardados de {meses}. Auto no corrió; vuelve a intentar.» | Tests: ready → columns; failed or incoherent → refusal, no fetch |
| ST-2 | Columns are identified per service — stored by document `_id`, planned by target — never by date alone. A planned column is never built for a target a stored service occupies. Where a stored service and a planned column share a date (a stored special on a Sunday; two same-day sets, ADR-0011), every date-keyed site in the create grid either tolerates both columns or the calendar refuses the combination with a stated reason. The plan names the guard test. | Test: stored special + planned Sunday on one date renders two columns with separate cells, or a stated refusal |
| ST-3 | No create-flow request ever creates, modifies or deletes a stored service. «Guardado» columns produce no drafts, are not editable, take no drops, and Auto never writes their cells. | Tests: confirm posts no stored target; Auto leaves stored cells byte-identical |
| ST-4 | Every stored **weekend** service in the horizon is sent as a fixed service with its counted flag; every stored **counted special** is sent as a fixed service; a stored **uncounted special** is never sent. Their shares use their filled seats (a fixed service's seat count equals its pins), so an empty stored seat creates no share and is never filled. | Request-builder tests |
| ST-5 | One notice says so whenever the horizon holds stored services with empty voice seats: «Los servicios guardados no se tocan: sus {n} lugares de voz vacíos se quedan vacíos. Llénalos en «Editar mes».» | Test |
| ST-6 | A stored seat whose holder is not a current member, or a person holding two voice seats of one stored service, is not sent; each case is named in a notice («{servicio}: un lugar guardado es de alguien que ya no está en la lista; no se envió al solver.» / «{persona} está dos veces en el {servicio} guardado; se envió solo como {rol}.», keeping Lead > BGV > Coro). | Tests |
| ST-7 | A target created during this session (this confirm or another tab) is a stored service for every later Auto: sent fixed with its stored seats, never re-planned. | Test: partial confirm, Auto again, the created target is fixed |
| ST-8 | **Month states (§4, A6).** A **bound** month is solved with **everything its record snapshots** (A3, A6): per-role statuses, exact rules with their resolved counts (`exactRules`), presence rules with members and exclusivity (`presence`), date blocks (unavailable and rule-excluded roles), cadence setting and exempt flags (RQ-2, RQ-4, RQ-5). Only what the record does not hold comes from the on-screen config for that month: `<=`/`>=` caps and pairs. Every other state is solved from the on-screen config. The pool checkboxes are one team-wide list, so: when **every** horizon month is bound they are read-only with «{Meses} ya tienen servicios guardados y elegibilidad registrada: se planea con esas listas, sus reglas fijas, de presencia y de semanas, y estas casillas no aplican.»; otherwise they stay editable and apply only to the months that are not bound, and each bound month shows the banner «{Mes} ya tiene servicios guardados y elegibilidad registrada ({fecha}): se planea con esa lista y sus reglas fijas, de presencia y de semanas; las casillas y esas reglas en pantalla no aplican a {mes}. Como ya tiene servicios guardados, ese registro ya no se puede cambiar.» A **recorded, unbound** month shows «{Mes} tiene elegibilidad registrada ({fecha}) pero ningún servicio guardado: se planea con las casillas en pantalla y, al crear, ese registro se reemplaza.» An **anchored, unrecorded** month shows «{Mes} ya tiene servicios guardados sin registro de elegibilidad: se planea con las casillas en pantalla, pero al crear no se registra su elegibilidad (sus servicios guardados no se planearon con estas casillas). Para registrarla, usa «Registrar elegibilidad de {mes}».» (PI-7). Topes («máximo»/«mínimo») and «no juntos» on screen apply to every month. The ledger GET decides each month's state and its copy; the roles read (ST-1) decides the «Guardado» columns. A service stored between the two reads can make them disagree for that run (a «Guardado» column beside a «ningún servicio guardado» banner); this is tolerated, the writer's own check decides at confirm (CF-1, CF-4), and the next Auto re-reads both. | Tests for each state and for a mixed 2-month horizon; a test where the on-screen `==` cap differs from the record's: the request carries the record's count for the bound month and the on-screen count for a recorded, unbound month; a test where only an uncounted special is stored: the month is not anchored |
| ST-9 | «Solo llenar vacíos» keeps today's meaning on the planned columns' own seats (every occupied voice seat becomes a pin, one per person per service, Lead > BGV > Coro). Stored services and counted specials are fixed whatever the switch says. Its confirm text under v3 reads «… que el solver pueda resolver en {meses}. Los servicios guardados no se tocan.» | Tests with the switch on and off |

### 5.5 Specials (U3)

| ID | Requirement | Acceptance |
|---|---|---|
| SP-1 | Under v3, every **planned counted special** is filled **before the request is built**, Lead and BGV only (Coro on a special stays manual, as today), append-only (nothing hand-placed is evicted), with every hard block of today's filler (rules, availability, Tipo). | Tests |
| SP-2 | Candidates whose status is `in` for the seat's role key in that month's eligibility (D14 and A13 via C2 LG-4: Lead → `Sun.Lead`/DL on a Sunday, `Sat.Lead`/SL on any other day; BGV → `Sun.BGV`/`Sat.BGV`, line BGV) are ranked first, **most owed first** by the carried balance of that line (`people[].window[line].balance`), each placement in this pass counting as one received seat for the next; candidates outside that line follow in today's load order. Ties keep today's order. | Ranking tests with fictitious balances |
| SP-3 | After the pre-fill, every counted special (planned or stored) reaches the solver **only as a fixed service**; the solver never fills a special's seat. Because it is a service of the request, its seats count toward the protections and caps of the line they map to (F1, F11). | Request test: special present with every seat pinned |
| SP-4 | **Uncounted specials** keep today's mechanism exactly: never sent, filled after the solve at every exit by today's load ranking. Instruments keep today's fill at every exit. | Existing special/instrument tests green under v3 |
| SP-5 | On an exit before the pre-fill ran (any pre-flight refusal, a failed ledger read), counted specials are left as they are and the refusal adds «Los especiales que cuentan para equidad no se llenaron porque Auto no corrió.» | Test |
| SP-6 | A notice names the pre-fill whenever it placed anyone: «Los especiales que cuentan para equidad se llenaron primero (Lead y BGV, por saldo) y el solver acomodó los fines de semana alrededor de ellos.» | Test |

### 5.6 The v3 request (built from planner state, C2, C3, C1)

| ID | Requirement | Acceptance |
|---|---|---|
| RQ-1 | **Ledger read.** Every v3 Auto reads `GET /api/admin/fairness` **fresh**, for its own horizon, at press time — never a display copy — bounded by an abort of **≤ 20 s**. A failed, aborted or unparseable read refuses the solve («No se pudo leer el saldo de equidad. Auto no corrió; vuelve a intentar.») and no request is sent with zero or missing balances. A lookback month without a record is not a failure (F3); C2's reader fails closed when its read token is absent (A2), so «sin registro» is never a disguised failed read. The same read decides each horizon month's state (§4). If the admin changes the horizon during the read, nothing is solved. | Tests mirroring the derived-history ones (`MonthGenerator.tsx:3822-3894`) |
| RQ-2 | **Eligibility, one derivation (A7).** For each horizon month the **month source** is the GET's `horizon[].record` (people stripped of `name`, plus `presence`) when the month is **bound** (§4, A6), otherwise the `body` of **C2's `resolveMonthEligibility`** applied to the on-screen config and the unfiltered worship roster at press time. A resolver `ok: false` refuses Auto before the fetch, one line per refusal (C2 RES-7): for `unresolved`/`ambiguous`/`no_tipo`, «No se puede correr Auto: «{persona}» en las reglas {no coincide con nadie / coincide con {n} personas / no tiene Tipo}. Corrige el nombre en la regla.»; for `cadence_and_exact`, WN-2's second sentence (A11). The month source is the solve snapshot: the same value feeds the request (this row, RQ-4, RQ-5) and the frozen record body (§5.11). Per-service eligibility is derived from it alone: a role of service s is eligible for p iff p's status for s's role key (A13, C2 LG-4 day class: a `sunday` or Sunday-dated special → `Sun.*`, otherwise `Sat.*`) is `in` or `exact`, p is available on s's date (the month source's `blocks[].unavailable` ∪ live `unavailableDates`, F4), and — at a weekend service only — the role key is not in that date's `blocks[].excludedRoles`. A non-fixed `saturday` has no Choir. C6 never re-derives pools, Tipo or rule membership, and never uses `solverPools`. | Test: request eligibility and record body are produced from one value; mutation of either fails; a bound month ignores an on-screen pool change and a recorded, unbound month follows it |
| RQ-3 | **Services.** The request holds exactly the services that will exist: planned weekend columns that are neither skipped nor blocked, every stored weekend service, every counted special (planned after SP-1, or stored). Deselected dates, skipped columns and uncounted specials are absent. Each service carries C5's fields (IF-C5): an opaque `id` (a stored service's document `_id`; a planned one minted by the planner, `[A-Za-z0-9:._-]`, ≤ 64), `date`, `month`, `kind`, `time` when the service has one, `fixed`, `counts`, and `seats` when not fixed (planned: today's row targets). | Request-builder tests |
| RQ-4 | **People** (C5 §5.3): `id` = member `_id`; `name` = display name; `eligibility` per RQ-2; `carried` = the GET's `people[].window[line].balance` for each line present (`DL`, `SL`, `BGV`, `CORO`, `P:<ruleKey>`), **integer hundredths, positive = owed**, copied without rounding; `exempt` and the cadence setting **from each month's source** (a bound month's record, otherwise the resolver body, whose `sundayCadence` comes from C3's `cadenceMembers` over the unfiltered roster, C2 RES-5/RES-7). `cadence` is sent for every person whose source marks `sundayCadence` in a horizon month, one entry per horizon month from **C2's `cadenceStates`** — inputs `ledCountedSundayPreviousMonth` = the member has at least one entry of `countedSundayLeads` in `prior.month`, and per month `eligible` = `Sun.Lead` is `in` in that month's source and `availableCountedSundays` = the request's counted Sunday-dated services of that month on which she is eligible for Lead by RQ-2 (so a Sunday on which she is rule-excluded from `Sun.Lead` is not counted, A14) — mapped to the wire (A14, C5-5) as: reason `not_eligible` → `"out"`, otherwise the returned `state`. `dl_since` (A15) = `firstRecordedIn["Sun.Lead"]` when that month is before `months[0]`, else the first horizon month whose source marks her `Sun.Lead` `in`, else `null` (a horizon month's record counts only through its source, so a recorded, unbound month whose record is about to be replaced never sets it); `prev_dl_leads` (A15) = the number of her `countedSundayLeads` entries in `prior.month` (one entry per Lead seat, C2 RD-3). **Horizon-wide fields.** C5 carries one `exempt` per person and requires `cadence` for every request month (C5 §5.3); a person listed in only one month's source takes that source's flags, and her cadence state in the other month is `"out"` (she is not eligible there); when a person listed in both months' sources has a different «Exenta» or «Mes por medio» in each, Auto refuses before the fetch: «{Mes1} y {Mes2} tienen distinto «{Exenta / Mes por medio}» para {persona} (uno viene del registro). Planea 1 mes.» (sibling issue S-3). People sent: everyone with an eligible role at a request service, every pin holder, every rule person. «Holgura N» is not sent (A10, Q2). | Tests incl. a cadence member out of the Sunday pool (`out`), one unavailable every Sunday (`off`), one rule-excluded from `Sun.Lead` on every available Sunday (`off`), a bound month whose record holds the cadence while the screen does not, and each disagreement refusal |
| RQ-5 | **Rules, per month, from one source.** For each horizon month, the **`==` count rules** are the month source's `exactRules` (one `count` rule per item: `op: "=="`, `roles` as stored, `value` = the stored count) and the **presence rules** are its `presence` items (`persons` = `members`, `roles`, `exclusive` copied); week exclusions and `!in` patterns reach the solver **only** as eligibility (RQ-2; A15, C5-2). Only `<=`/`>=` caps and pairs (`conflicts[]`) come from the on-screen config, for every month. For those, C6 uses C2's two neutral functions and nothing else (C2's sibling note to C6): every `roles` list is **`rolesOfPatternV3`**'s expansion, and every count `value` is **`capValueForMonth`** for that month (relative caps against that month's full Sunday count, A15, C5-4); a value below 0 is sent as 0 and noticed («{regla} queda en 0 en {mes} (tiene {n} domingos).»). Every person those rules name resolves through **C3's `resolveRulePersonId`** over the unfiltered roster — exactly one member or Auto refuses before the fetch with RQ-2's line (A7, which closed C3's former Q-b: v3 applies the exactly-one check to every rule name it sends, never `resolveToMemberName`'s first match). Rule `id`s are the config item's key; an `exactRules` item has none, so it takes the id of the on-screen `==` cap with the same person and the same canonical role set, else a C6-minted id rendered «regla fija registrada de {mes}». For a month solved from the screen, an on-screen week exclusion naming a week the month does not have is noticed («{regla} no aplica en {mes}: ese mes no tiene semana {n}.»), never refused. Presence rules are always sent **month-scoped** (C5-16): one `presence` object per `(ruleKey, month)` from that month's source, with `month` set and the rule's own `id` (C5 §5.4: every object of an `id` carries a `month` and `(id, month)` is unique), so a bound month and a month solved from the screen may carry different members, roles or exclusivity for one rule and neither is refused; pairs come from the screen and are sent once, horizon-wide (no `month`). `consecutive` rules are never emitted (today's UI has none). | Tests incl. a 4- and a 5-Sunday month, a bound month with a stale on-screen cap, an ambiguous name on a `<=` cap in an all-bound horizon, a spy proving every `roles` list and count value comes from C2's two functions, and a 2-month horizon whose months carry different presence members (two month-scoped objects, no refusal) |
| RQ-6 | **Pins** carry service id, date, role and member id. Sources: every fixed service's seats; with «Solo llenar vacíos», the planned columns' occupied voice seats. One seat per person per service (duplicates dropped with today's notice wording). The total is checked against **the v3 pin cap — one TS constant equal to C5's literal `PIN_CAP = 250` in `gcf_v3/owt_v3/`, guarded by a vitest that reads the Python source** — and refused before the fetch above it: «El plan tiene {n} lugares fijados (guardados, especiales y del tablero) y el solver acepta hasta {máximo}. Planea 1 mes o apaga «Solo llenar vacíos».». A board seat whose holder is not a member is refused as today («No se puede usar «Solo llenar vacíos»: en {lugar} hay alguien que ya no está en la lista de miembros. Quítalo de ese lugar y vuelve a intentarlo.»). v2's `PINNED_CAP` (100) is untouched. | Tests; sync test fails when either constant changes alone |
| RQ-7 | **Prior** (C5 §5.6), built from the full-roster `GET /api/admin/roles` read the planner already holds (§3), never from the ledger: `month` = `months[0]` − 1; `has_services` = that month holds a stored weekend service or a stored counted special; `services` = every stored weekend service (counted or not) and every stored counted special dated in [first day of `months[0]` − 14 days, first day of `months[0]`), each `{ date, kind, counts, seats: { Lead, BGV, Choir } }` with member ids in stored order. Two stored documents of one weekend type on one date are dropped together (C2 LG-1's rule), so `prior` and the ledger never disagree on a target. If that read is not ready, Auto refuses as ST-1 does. | Tests incl. a previous-month trailing Saturday and a duplicate target |
| RQ-8 | A per-run `seed` and a `request_id`; `months` = the horizon; **no `budget`** in production (C5 §5.7). The request carries no v2 field (`weeks`, `dsl_rules`, `history`, `weekends_with_saturday`). | Test |
| RQ-9 | v2's request builder, its T3/T4/T5 omissions, `omittedCapsNotices`, `trailingNotice` and the trailing retry are never called on the v3 path. | Spy tests |
| RQ-10 | **Pre-flight against C5's limits.** C6 never sends a request C5 §5.8 would refuse: more than 40 services, 100 people (the limit C2's WR-4 shares with C5 §5.1) or 500 rules; a cadence member with an exact `Sun.Lead` rule (A11, WN-2); anything else §5.8 lists. Each limit is refused before the fetch with «El plan es demasiado grande para el solver ({qué}: {n} de {máximo}). Planea 1 mes.» | One test per limit |

### 5.7 The v3 response (U8)

| ID | Requirement | Acceptance |
|---|---|---|
| AD-1 | **Two parsers, never crossed.** The client dispatches on the engine prop before reading the body. Under v3 only the v3 adapter reads it; v2's handshake, violation parser, unfilled mapper, `applySolveResponse`, `solverRefusalMessage` and the trailing retry are unreachable. Under v2 the v3 adapter is unreachable. | A test feeds a v3 response under v2 (and the reverse) and asserts with spies that the other side's parsers are never called and the result is a transport message |
| AD-2 | The v3 fetch is aborted by the client at **58 s** (the route answers first by RT-4). | Fake-timer test |
| AD-3 | Classification, in order: 409 `solver_version_mismatch` → «El solver cambió de versión mientras planeabas. Recarga la página; no se aplicó nada.»; any non-JSON body, any status other than 200/422/409, an abort, or a body with `transport_error` → transport (§7.6); an `ok` body without `contract: 3` and `engine: "v3"` → transport; a 422 `ok:false` with a code → that code's copy (§7.5; the route has already normalised every coded solver failure to 422, RT-5); `ok:true` → AD-4. Never «sin solución» on any v3 path. | One test per branch |
| AD-4 | **Handshake.** A success is applied only if the response's pin echo equals the pins sent **and** every pin appears in `assignments` under its service id and role by member id; otherwise nothing is applied and Auto shows «El solver no respetó los lugares fijados; no se aplicó nada.». | Tests |
| AD-5 | **Apply.** Assignments are mapped by service id to planned columns only; pinned cells keep their origin; every other planned voice cell is replaced (`origin: "auto"`); fixed services' cells are never written. An assignment for an id the request did not send is a transport error (nothing applied). Unfilled entries (`{ service, role, count, reason }`) map by service id and role to `count` markers, with their reason's copy (§7.4). | Tests |
| AD-6 | **Retry rule (v3's own, keyed on codes).** No automatic re-solve on v3. A «Reintentar» action beside the message is offered exactly when the outcome is the timeout code, a timeout transport (client abort, `transport: "timeout"`, 504) or a connection transport (`unreachable`, `http_status`, `not_json`); never after a configuration transport (`not_configured`, `contract_echo`, an unknown `assignments` id), which a retry cannot fix, nor after a refusal with any other code, a handshake failure or a success. | Tests per outcome |
| AD-7 | Every exit (refusal, transport, handshake, success) fills uncounted specials and instruments as today (SP-4). | Tests |
| AD-8 | **The one v2 client change.** Under v2, a 409 `solver_version_mismatch` shows «El solver cambió de versión mientras planeabas. Recarga la página; no se aplicó nada.» instead of falling through to «El solver no encontró solución.»; it never triggers the trailing retry. Every v2 request byte and every other v2 branch is unchanged. | Test: 409 under v2 → reload copy, no retry, specials still fill; existing v2 tests green |

### 5.8 Run notices (U6)

| ID | Requirement | Acceptance |
|---|---|---|
| NT-1 | After a v3 success the diagnostics strip shows the run line («Plan de {n} mes(es): {meses} · {s} servicios ({g} guardados, se respetan tal cual).») and a stage summary: «Todas las etapas quedaron probadas.» or one line per stage not proven, «{etapa}: no probado» / «{etapa}: no ejecutado», plus the matching explanation (§7.1). A «Ver etapas» disclosure (`Collapse`) lists every stage with «probado», «no probado» or «no ejecutado». | Tests per status mix |
| NT-2 | Every missed protection is one line naming the person, the month or dates and the cause (§7.2); the capacity notice (§7.3); every clamp, not-applicable presence and no-possible-lead service (§7.3, §7.4); every rule break with its cause and the ceiling caveat when unproven (§7.4). | Tests per code |
| NT-3 | C6's own notices (RQ-5, ST-5, ST-6, SP-5, SP-6, WN-*) precede the solver's, in a stable order. | Order test |
| NT-4 | Copy comes only from the table in §7, keyed on codes. A **sync test** reads C5's registry `gcf_v3/owt_v3/codes.json` and, over every group it lists — `error`, `stage`, `stage_status`, `stage_reason`, `violation`, `violation_cause`, `unfilled_reason`, `missed`, `missed_cause`, `notice`, `cadence_state`, `compensation` — fails when a code C5 can emit has no copy here, when a copy names a parameter the code does not declare, or when a code here is not in the registry. The group `limit` (`none`/`deterministic`/`wall`) is never shown and is excluded by a named list in the test, as are C6's own codes (the «C6's own» lines of §7.3, §7.6, §7.8). An unknown code at runtime still renders a generic line («El solver informó algo que el planificador no reconoce ({código}).»), never nothing. | Sync test; runtime fallback test |
| NT-5 | v2's «Sin optimizar», «Equidad relajada …» and «Historial …» lines never render on a v3 run. | Test |

### 5.9 The live «Equidad» panel (U5)

| ID | Requirement | Acceptance |
|---|---|---|
| EQ-1 | Under v3 the «Equidad» panel replaces `LeadPoolHistoryPanel` at all three mounts and the «Historial» block; none of the v2 history surfaces is mounted. Under v2 they render exactly as today. Deleting them is C7's. | Render tests per engine |
| EQ-2 | C6 mounts and extends **C2's** preview panel and its formatter; nothing C2 ships is re-implemented. The banner «Vista previa: Auto todavía no usa este saldo» shows exactly when the effective engine is v2 (C6's prop; the GET's `engine` is the same resolver's value, ENG-3). | Tests |
| EQ-3 | Tabs (`SegmentedControl`): «Dom Lead · Sáb Lead · BGV · Coro · Total». Every figure of a tab comes from that tab's own entry on each side, never from its lines: per person, «Le tocaba», «Tuvo» (`seats`) and «Saldo (3 meses)» from the GET's `people[].tabs.window[<tab>]`, and the cumulative figure since the record began («Desde {mes}: …», X4) from `people[].tabs.cumulative[<tab>]`, beside the saldo (C2 §7, `…-c2-ledger-and-record-design.md:360-361`); and from the last v3 solve of this horizon, `fairness.people[].tabs[<tab>]` (C5 §8.2, `c5:706-726`): «En este plan» (the seats the plan gives in that tab, from C5's integer seat count on the tab, S-12) and «Queda» (the tab's `after`, computed from the **realised** share, A19 — C6 never recomputes it and never shows `planned` as a balance). The Total tab adds «Cantó» (all voice seats: the GET's `people[].sang`). Presence sub-lines fold into BGV and every line into Total, and both folds are the emitters' (C2 LG-14's `tabs`; C5's `tabs.BGV` and `tabs.TOTAL`, `c5:706-710`), never C6's. Before any solve, in stored mode, or where C5's entry has no such tab (Total for an exempt person, `c5:724-725`), the plan columns read «—». | Tests per tab, the folded BGV (a person with a `P:` sub-line) and Total included |
| EQ-4 | Each row carries one reason line composed from C2's and C5's codes (§7.7): cadence state, compensation Saturday, unavailable dates, fixed rule, pins that took a share («Los pines tomaron {n} lugares», `{n}` from C5's integer pinned seat count on the tab, S-12 — never `pinned`, which is hundredths), exempt. | Tests per reason |
| EQ-5 | Numbers (A17): **C2's single formatter is the only implementation** (`formatFairnessTenths`, `saldoWords`) — every share and balance is shown with **one decimal** in `es-MX` (decimal point: «le deben 0.8»), the saldo always in words, positive = «le deben …», and the formatter's input is always **tenths rounded once from the exact value**, never hundredths (C2 UI-4's grep guard covers C6's code too). Ledger figures use the GET's `Figures.tenths` of the tab's entry (`tabs.window[<tab>]`, `tabs.cumulative[<tab>]`). Seat counts are integers taken as emitted, each from one named field: «Tuvo» renders the GET's `Figures.seats` and «Cantó» the GET's `people[].sang` (C2 §7, UI-4 — never `received`, which is hundredths); «En este plan» renders C5's integer seat count per person and **tab**, which C5's response does not carry yet (sibling issue S-12, a prerequisite of C6's plan) — never C5's `received` (hundredths, `c5:684`, `c5:711-712`). **No C6 code divides a wire figure**, the GET's or C5's. «Queda» renders C5's `fairness.people[].tabs[<tab>].tenths.after`, rounded once by C5 from the exact summed value (C5-8, `c5:717-719`); it is never derived from the wire hundredths, and never from `lines[*]`, whose figures no tab may be summed from (`c5:720-722`). Nothing in the panel rounds, sums, divides or formats a number itself, and no displayed figure feeds a computation. | C2's formatter tests; the grep guard; tests that «Tuvo» renders `Figures.seats` (a `received` of 300 shows «3»), «Cantó» renders `sang`, «En este plan» renders only C5's per-tab seat count and «Queda» only C5's `tabs[<tab>].tenths.after` — including a BGV tab whose person also has a `P:` sub-line and a Total tab, where the tab's figure differs from any single line's |
| EQ-6 | Phone: one card per person (`Collapse` for the detail); no page-level horizontal scroll. | Phone-width render test |
| EQ-7 | The panel shows the ledger's own diagnostics (C2) where v2 showed the derived-history diagnostics. | Test |

### 5.10 Warnings and wiring of other children's controls

| ID | Requirement | Acceptance |
|---|---|---|
| WN-1 | **C3's «Mes por medio fuera de Líderes Domingo» warning** (C3 §6.7: its predicate and its two sentences) is opened exactly when the effective engine is v3 (A9), and its lines are repeated among Auto's notices. C6 writes no second copy of it. It does not apply to a bound month, whose cadence setting and eligibility are the record's. | Render tests per engine |
| WN-2 | **Cadence refusals.** Under v3, Auto refuses before any read when C3's `cadenceMembers` reports a refusal: «No se puede correr Auto: «Mes por medio» de «{persona}» no corresponde a una sola persona ({motivo}). Corrige el nombre en la regla.» (`{motivo}`: «no coincide con nadie» / «coincide con {n} personas»), and when a person carries the cadence and also an exact count covering `Sun.Lead` (A11): «No se puede correr Auto: {persona} tiene «Mes por medio» y además un número fijo de Dom Lead («{regla}»). Quita una de las dos.» The same pair is refused by C2's resolver (`cadence_and_exact`, RES-7) for a month solved from the screen and by C2's validator (WR-4) for any record, so a bound record never carries it; C6 checks the on-screen config before any read so the admin sees it first. | Tests |
| WN-3 | Under v3, a non-empty «Líderes Sábado» pool gets: «Con el nuevo solver, «Líderes Sábado» ya no aparta un líder para cada sábado: quien esté solo ahí dirige únicamente sábados.» (D9.) Non-blocking, shown in the config step and repeated among Auto's notices. | Test |
| CTL-1 | C6 routes its effective-engine prop to the engine-dependent surfaces it wires: **C1's** «Cuenta para equidad: aplica con el nuevo solver…» note, which reads `SOLVER_ENGINE` until C6 and is rewired to the prop (hidden when it says v3); **C3's** «aplica con el nuevo solver» notes (`CADENCE_V2_NOTE` on the card chip and the form help), which C3 renders **unconditionally** and never gates on any engine (C3 §6.6, §8) — C6 adds the gate, shown only when the prop says v2 (U7); **C3's** warning gate input (WN-1); C2's preview banner (EQ-2). C2's «Registrar elegibilidad de {mes}» stays gated by C2 on its GET's `engine` (UI-6) — the same resolver, so C6 adds no second gate there. C3's «no aplica con el nuevo solver» on «Holgura» stays under both engines. | Render tests per engine for each surface C6 gates |
| CTL-2 | **«Holgura»/«Exenta» in the specials filler under v3 (C3 P4).** Uncounted specials keep today's filler, including its Exenta (median) and Holgura (load + N) ordering. Counted specials are ranked by balance (SP-2), where neither applies; «Exenta» still counts in every role line (D13). | Ranking tests |

### 5.11 Confirm protocol (U4) — **CRITICAL SLICE**

> **Critical.** This section changes when and in what order a production writer's records and the
> service drafts are written, and how partial failure is recovered. Its implementation plan goes
> through the adversarial plan-review loop: **two sequential fresh `APPROVED` verdicts on
> byte-identical text**, churn cap binding (CLAUDE.md). A reviewer may scope a round to this section
> plus IF-C2's PUT contract alone; everything else in this spec is standard tier.

Applies only when the effective engine is v3. Under v2 the confirm is byte-identical to today (no
record, same buttons, same messages).

| ID | Requirement | Acceptance |
|---|---|---|
| CF-1 | **What is written.** A confirm writes (a) one record entry for every horizon month that (i) gets at least one draft from this confirm, (ii) is not before the current CDMX month **as the client computes it at confirm** (a past month's record is the reconstruction's, L3), and (iii) is not **anchored, unrecorded** in the solve snapshot (§4; PI-7 — departs from the parent's literal L3/U4/A6 until the parent amends them, and is dropped if it does not); then (b) the drafts. A month excluded by (ii) or (iii) still gets its drafts, and the dialog names it: «{Mes}: no se registró su elegibilidad porque ya tenía servicios guardados sin registro.» for (iii). If no month needs an entry, no PUT is sent and the confirm goes straight to the drafts. Nothing else is written: never a stored service, never a delete. A month's state is the snapshot's: a month that gains a stored service after the run's read is still sent as its snapshot says, and the writer's own checks decide (C2 WR-7/WR-8). For a month **recorded** at the read that is C2's stated residual window (WR-8 row 7 refuses `month_has_services`). For a month **unrecorded** at the read it is not: WR-8 row 3 creates whenever no record exists and `expectedRev` is null (`…-c2-ledger-and-record-design.md:138`), so (iii) is enforced by this client alone and a confirm racing a stored-service save mints the record (iii) withholds — a residual window that is C6's, closed only if the parent adopts PI-7's server check. | Tests incl. a fixed clock on either side of a month boundary; an anchored, unrecorded month gets drafts and no entry; a confirm with no entries sends no PUT |
| CF-2 | **Record body frozen.** Each month's PUT entry (C2's `FairnessMonthWrite`) is frozen when the run's request is built, from that month's solve snapshot (its source, its state and the record `rev` read with it, RQ-1, RQ-2); if no v3 Auto ran for this horizon in this session, the states and the bound months' sources come from a fresh `GET /api/admin/fairness` for the horizon at the first confirm attempt, every other month's from `resolveMonthEligibility` over the on-screen config, and the entries are frozen then; a failed read or an `ok: false` resolver creates nothing. Every retry sends each month's entry byte-identical; the set of entries changes only by dropping a month that has become past (CF-1). Drafts are taken from the board at confirm. | Test: edit pools after Auto, confirm — the record is the solved one; retry body equals the first |
| CF-3 | **Entries, in C2's terms (§6 IF-C2), one shape per state (§4).** Every entry asserts the revision read with the eligibility it carries (C2 WR-15), never one re-read before the PUT. **Bound:** the GET's `horizon[].record` logical content — `people` with `name` removed from every item (WR-3 refuses it), `presence` as read — with `expectedRev` = that record's `rev` and `source: "auto"`. Because `contentHash` excludes every stamp, `source` included (C2 REC-6), the decision is `unchanged`; if the record changed since the read, it is `stale_revision`/`record_missing`. **Recorded, unbound (A6):** the frozen resolver `body` with `expectedRev` = the record's `rev` as read and `source: "auto"` (`"manual"` on CF-2's no-Auto path), expecting `replaced` — or `unchanged` when the body equals the record or on a replay. **Unrecorded:** the frozen resolver `body` with `expectedRev: null` and the same `source` rule, expecting `created`, or `unchanged` on a replay. | Tests per shape; a **round-trip test** (critical slice): a GET logical record turned into a PUT entry hashes to the record's own `contentHash` |
| CF-4 | **Records first, atomically.** All entries go in **one** `PUT /api/admin/fairness/months` (C2 WR-9: 1–2 consecutive months, all-or-nothing); with a single entry the PUT carries that month alone. The confirm proceeds to drafts **only** on a 200 whose `months[]` has every sent month with an outcome its shape expects (CF-3: bound → `unchanged`; recorded, unbound → `replaced` or `unchanged`; unrecorded → `created` or `unchanged`); any other outcome is treated as «other failure». Any refusal or unknown outcome ⇒ **no draft of any month is created**, the dialog stays open, and the message is chosen by `details.detail` (§7.8): `record_exists`, `stale_revision`, `record_missing`, `month_has_services` (a recorded, unbound month that gained a stored service — or an unrecorded one, if C2 adopts PI-7's server check) → conflict, re-run Auto; `past_month` (the server's clock disagrees with the client's at a month boundary) → nothing created, «Reintentar» after the boundary; `engine_not_v3` → reload; `member_unknown`, `member_not_worship`, `tipo_mismatch` → the team changed, re-run Auto (only a written month can get these: C2 WR-5 never refuses an `unchanged` one); a 400, a network error, a 5xx or an unparseable body → «Reintentar». | Tests per `details.detail` and per unexpected outcome (incl. `replaced` for a bound month and `created` for a recorded one); spy: zero draft POSTs |
| CF-5 | **Drafts oldest first, month by month.** Drafts are posted in date order with their stable `creationRequestId`s (today's per-draft mechanism, unchanged). Within a month every draft is attempted; the next month starts **only if every creatable draft of the earlier months was created**. | Tests: a failure in month 1 ⇒ zero POSTs for month 2 |
| CF-6 | **Per-month report; nothing deleted.** On any failure the dialog stays open with one line per month (§7.8). No record or draft is deleted or rewritten to compensate. Only confirmed successes become `exists`/created-this-session (today's invariants, including the paired `drafts` identity change that the drag gate's cache depends on). | Tests |
| CF-7 | **«Reintentar» resends only what is missing**: the frozen record request again only if it has not succeeded, then only the drafts not yet created, in the same order and with the same ids. A replay of a PUT that did land is a success by C2's decision order: an identical `contentHash` on an intact record is `unchanged` **before** the past-month, `record_exists` and revision checks (WR-8 step 1), so every resent shape — unrecorded (`expectedRev: null`), recorded-unbound (the pre-replace `rev`) and bound — answers `unchanged`. It never re-solves. | Tests: lost-response replay of each shape (including across a month boundary), mid-month failure, month-2-only failure |
| CF-8 | **No publish in a 2-month confirm.** With horizon 2 only «Crear {n} borradores» exists (the publish button is absent, not disabled), with «{Mes1}: {a} · {Mes2}: {b}. Se crean como borradores; publícalos después.». With horizon 1, «Crear y publicar» stays and posts as today after the record step. | Render tests |
| CF-9 | **History dual-write (Q4).** After the drafts, one `localStorage` history entry is appended **per month** with at least one weekend draft created this session, each built from that month's created weekend drafts exactly as today (specials excluded, union across this session's confirms). Removed only when the ADR-0042 dual-write is retired on its own. | Tests: two entries for a 2-month confirm, none for a specials-only month |
| CF-10 | **Closing with gaps** after a partial failure opens a `CueDialog` «El plan quedó incompleto» — «{Mes}: faltan {n} servicios. Si sales, se quedan así; puedes completarlos en «Editar mes».» — with «Salir así» and «Seguir aquí». Full success closes as today. | Test |
| CF-11 | **Client-mutation invariant** for the record call and the draft calls: try/catch/finally, check `res.ok`, reset the pending flag, never close as success on failure. | Tests incl. a thrown fetch |

**Failure table (U4).**

| Moment | What exists afterwards | What the admin sees | Recovery |
|---|---|---|---|
| Record PUT 409 `record_exists` / `stale_revision` / `record_missing` / `month_has_services` | Nothing new | §7.8 conflict line | Re-run Auto; the fresh read gives the month its current state (§4) |
| Record PUT 409 `past_month` (client/server clocks straddle a month boundary) | Nothing new | §7.8 past line | «Reintentar» after the boundary: the client then leaves that month's record out (CF-1) |
| Record PUT 409 `engine_not_v3` (C2 WR-6) | Nothing new | §7.8 reload line | Reload |
| Record PUT 409 `member_unknown` / `member_not_worship` / `tipo_mismatch` | Nothing new | §7.8 team line | Re-run Auto (a month solved from the screen re-resolves); a bound month is never refused here — it is decided `unchanged` and C2 runs these checks only on written months (WR-5) |
| Record PUT 200 with an outcome its shape does not expect | Possibly a rewritten record | «No se pudo registrar…» | «Reintentar» answers `unchanged` if the content landed; the round-trip test (CF-3) guards the bound shape |
| Record PUT network/5xx/unknown | Maybe the records | «No se pudo registrar…» | «Reintentar» (replay-safe) |
| Records ok; month 1 partially fails | Records; some month-1 drafts | Per-month lines; month 2 «no se intentó» | «Reintentar» |
| Records ok; month 1 ok; month 2 partially fails | Records; month 1; part of month 2 | Per-month lines | «Reintentar» |
| Records ok; every draft fails; admin leaves | Records only | CF-10 dialog | Next Auto: the month has a record and no stored services, so it is recorded, unbound — the screen drives and the confirm replaces the record under its `rev` (A6) |
| Draft 409 (target taken meanwhile) | As above | Today's «Alguien más cambió esas fechas: recarga y revisa.» on that month's line | Reload |
| Confirm that includes an anchored, unrecorded month (no failure) | Its drafts; no record for it | The CF-1 line for that month | None needed; a permanent record only through «Registrar» (Frank's choice, C7 K4), otherwise the reconstruction once the month is past |

### 5.12 Documentation in the same delivery

| ID | Requirement | Acceptance |
|---|---|---|
| DOC-1 | `docs/SECRETS.md` entry for `OWT_SOLVER_V3_URL` (non-secret config, introduced by this child): platforms that need it and those that do not, purpose, source, how to change it, blast radius — never a value. Needed on Vercel Preview first and Production at C7; not `.env.local` (the local entry point serves instead), CI or iOS. Source `gcloud functions describe owt-solver-v3 --gen2 --region=us-central1 --format='value(serviceConfig.uri)'` (C5 §11.5). Unset on a deployment ⇒ v3 Auto answers `not_configured`; a change needs a redeploy. `OWT_SOLVER_ENGINE`'s entry is C2's (EN-3) and C6 writes no second one; the API key's amendment is C5's (§11.6). | Docs review |
| DOC-2 | ADRs, numbered when they reach `main`: the engine switch as C6 completes it (A1: C1's constant, C2's resolver honouring the override on the `preview` branch deployment or locally, the solve route's 409, the server-resolved prop); the 1–2-month horizon with stored services and counted specials as fixed services (amends ADR-0010 Decision 1 for counted specials). | Review |
| DOC-3 | CLAUDE.md names `SOLVER_ENGINE` beside the two existing switches (unless C2's GU-4 already did — one line, never two), and the two-parsers rule (U8). | Review |

## 6. Interfaces

Every shape below that another child owns is **copied from that child's spec as read on 2026-10-05**
(C1, C2 §7, C3 §7, C5 §5/§8/§9 and its «Interfaces»), with the parent's amendments applied where a
sibling's text had not yet absorbed them (A1 ownership, A2 id, A5 stored-services predicate, A6
binding, A17 display). C6 keeps no parallel description: if a
sibling's approved text changes, this section is updated in the same review cycle, and a mismatch
is a defect in C6, not a licence to reinterpret.

### IF-C1 — consumed from C1 (`countsForFairness`)

(C1 §6.6 and its interface table.)

- Role-doc field `countsForFairness?: boolean` on `sunday_role`, `saturday_role`, `special_role`;
  effective value `coalesce(countsForFairness, _type != "special_role")` (`COUNTS_FOR_FAIRNESS_GROQ`
  and the TS twin `countsForFairness(doc)` in `app/utils/countsForFairness.ts`).
- `GET /api/admin/roles` rows carry `countsForFairness: boolean` (effective) — the read «Guardado»
  columns and `prior` (RQ-7) are built from.
- Client types: `GridColumn.countsForFairness: boolean` (effective, both modes; `StoredGridColumn`
  inherits) and `CreatableDraft`/`DraftCard.countsForFairness: boolean`; the create POST body follows
  C1's rule. C6 adds no second control; C1's Switch is the only one.
- C1's note «Cuenta para equidad: aplica con el nuevo solver. Hoy Auto no lo usa.» reads
  `SOLVER_ENGINE` until C6 rewires it to the effective-engine prop (CTL-1).

### IF-C2 — consumed from C2 (engine, resolver, ledger, record, panel)

C2 §7, verbatim where it is a type:

```ts
type RoleKey = "Sun.Lead" | "Sat.Lead" | "Sun.BGV" | "Sat.BGV" | "Sun.Choir" | "Sat.Choir";
type LineKey = "DL" | "SL" | "BGV" | "CORO" | `P:${string}`;          // P:<ruleKey>
type Status = "in" | "out" | "exact";

interface FairnessMonthsPut { months: FairnessMonthWrite[] }            // 1–2, consecutive, ascending
interface FairnessMonthWrite {
  month: string;                                                        // "YYYY-MM"
  source: "auto" | "manual";
  expectedRev: string | null;                                           // rev read with the eligibility (WR-15)
  people: Array<{
    memberId: string;
    roles: Record<RoleKey, Status>;                                     // all six
    exactRules: Array<{ roles: RoleKey[]; count: number }>;
    sundayCadence?: "alternate";
    exempt: boolean;
    blocks: Array<{ date: string; unavailable: boolean; excludedRoles: RoleKey[] }>;
  }>;
  presence: Array<{ ruleKey: string; roles: RoleKey[]; members: string[]; exclusive: boolean }>;
}
// PUT 200: { months: Array<{ month; outcome: "created" | "replaced" | "unchanged"; rev; contentHash; recordedAt }> }
// PUT 409: serviceError body; details.detail ∈ record_exists | record_missing | stale_revision |
//          month_has_services | past_month | engine_not_v3 | member_unknown | member_not_worship |
//          tipo_mismatch; details.months lists every month's verdict. 400 invalid_request.

interface LogicalRecord {                     // GET horizon[].record; stored _id "fairnessMonth.YYYY-MM" (A2)
  month: string; rev: string; contentHash: string;
  source: "auto" | "manual" | "reconstructed"; engine: "v2" | "v3";
  environment: "production" | "preview" | "local"; recordedAt: string;
  people: Array<FairnessMonthWrite["people"][number] & { name: string }>;
  presence: FairnessMonthWrite["presence"];
}

// GET /api/admin/fairness — the fields C6 reads (C2 RD-3; full shape in C2 §7)
//   horizon: Array<{ month: string; record: LogicalRecord | null;
//                    storedServices: number;   // freezing services (C2 §4, A5): weekend + counted specials
//                    recordBinds: boolean }>;  // record !== null && storedServices > 0 (A6) — read, never re-derived
//   people[].countedSundayLeads: string[];     // one entry per Lead seat at a counted Sunday-dated service
//                                              // in a window month; a date may repeat; sorted
interface Figures { share: number; received: number; balance: number;   // all hundredths (wire, F14); received = 100 × seats; balance = share − received
                   seats: number;                                       // display: received ÷ 100, an integer seat count («Tuvo»)
                   tenths: { share: number; balance: number } }         // display, rounded once from the exact value (LG-13, A17)
//   people[].sang: number;                    // «cantó», window — an integer seat count (C2 §7)

declare function formatFairnessTenths(tenths: number): string;          // input is TENTHS, never hundredths
declare function saldoWords(balanceTenths: number): string;             // "le deben 0.8" | "0.3 de más" | "al día"
declare function resolveSolverEngine(env: Readonly<Record<string, string | undefined>>): "v2" | "v3";  // server-only

declare function resolveMonthEligibility(input: {
  month: string; config: SolverConfig /* on screen, incl. sundayCadence */;
  members: Array<{ _id: string; member_name: string; alias?: string; memberType?: string[];
                   ministries?: unknown; unavailableDates?: string[] }>;
}): { ok: true; body: Omit<FairnessMonthWrite, "source" | "expectedRev"> }
  | { ok: false; issues: string[]; refusals: Array<{ person: string; reason: "unresolved" | "ambiguous" | "no_tipo" | "cadence_and_exact" }> };

declare function rolesOfPatternV3(pattern: string): RoleKey[];          // [] when unknown; canonical role order
declare function capValueForMonth(cap: RestrictionCap, month: string): number;  // resolvedCapValue(cap, sundaysIn(month))

type CadenceReason = "on" | "not_eligible" | "led_previous_month" | "assumed_led_previous_month" | "no_available_sunday";
declare function cadenceStates(input: {
  ledCountedSundayPreviousMonth: boolean;
  months: Array<{ month: string; eligible: boolean; availableCountedSundays: number }>;  // 1–2
}): Array<{ month: string; state: "on" | "off"; reason: CadenceReason }>;
```

What C6 reads from each:

- **Engine (A1; C2 EN-1–EN-3).** `solverEngine.ts` with `SOLVER_ENGINE: "v2" | "v3"` (value `"v2"`,
  created by C1), C2's pure server-side resolver of the effective engine (`resolveSolverEngine(env)`,
  working name; `OWT_SOLVER_ENGINE` honoured on the `preview` branch deployment — `VERCEL_ENV ===
  "preview"` and `VERCEL_GIT_COMMIT_REF === "preview"` — or with `VERCEL_ENV` unset), its SECRETS
  entry, the PUT gate (`engine_not_v3`) and the GET's `engine`. C6 imports the resolver (ENG-1).
- **`GET /api/admin/fairness?month=<months[0]>&horizon=<1|2>`** (C2 RD-3/RD-4; `FairnessLedgerResponse`,
  `v: 1`): `engine`; `currentMonth`; `window` (3 months, oldest first, `record: RecordSummary | null`);
  `horizon[]: { month, record, storedServices, recordBinds }` — each month's state (§4: `recordBinds`
  for bound, `storedServices > 0` for anchored) and the bound month's source (RQ-2, CF-3); the reader
  fails closed without its read token (A2); `people[]: { memberId, name, exists, window:
  Partial<Record<LineKey, Figures>>, cumulative, tabs, sang, exempt, months[], countedSundayLeads,
  firstRecordedIn: Partial<Record<RoleKey, string>> }` — **carried = `people[].window[line].balance`**
  (hundredths, positive = owed; never the `tenths`), `countedSundayLeads` →
  `ledCountedSundayPreviousMonth` and `prev_dl_leads` (entries, one per seat), `firstRecordedIn["Sun.Lead"]`
  → `dl_since` (RQ-4); `diagnostics` (EQ-7). A failure is any non-2xx (500 `fairness_unavailable`) or an
  unparseable body; C6 never substitutes zeros. The GET does **not** provide `prior`; C6 builds it
  from the roles read (RQ-7).
- **`PUT /api/admin/fairness/months`** (C2 WR-1–WR-15), admin/super-admin: body `FairnessMonthsPut`,
  unknown fields refused (WR-3); decision order per month (WR-8): identical `contentHash` →
  `unchanged`; past month → `past_month`; no record + `expectedRev: null` → create; no record +
  rev → `record_missing`; record + `null` → `record_exists`; rev mismatch → `stale_revision`; stored
  services → `month_has_services` (A5: weekend services and counted specials); else replace. All or
  nothing (WR-9). C6 sends only the three entry shapes of CF-3; it asks for a replace only for a
  recorded, unbound month (A6), under the `rev` it read.
- **`resolveMonthEligibility`** (C2 RES-1–RES-7, A7): the source of every month that is not bound
  (RQ-2, CF-2) and the only source of `==` rules, presence rules and date blocks for that month
  (RQ-5); its `refusals` name each refused rule person (RQ-2's copy).
- **`rolesOfPatternV3`, `capValueForMonth`** (C2 RES-2, RES-3): the only expansion and the only count
  resolution behind every `<=`/`>=` cap and pair C6 sends from the screen (RQ-5).
- **`cadenceStates`** (C2 CAD-1): cadence states and their `reason`, mapped to C5's wire in RQ-4.
- **The preview panel and its formatter** (C2 UI-1–UI-7, §8): mounted and extended (EQ-1–EQ-5);
  every figure goes through `formatFairnessTenths`/`saldoWords` from tenths, and nothing under
  `app/**` derives tenths from hundredths (C2 UI-4's grep guard). «Registrar elegibilidad de {mes}»
  stays C2's, gated by C2 on its GET's `engine` and replaced by C2's `month_has_services` line when the
  month's record binds (UI-6).

### IF-C3 — consumed from C3 (cadence setting)

(C3 §6.6–§6.7 and §7.)

- `PersonRestriction.sundayCadence?: "alternate"` (absent = «Normal»; never stored otherwise), keyed
  by person name; v2's whole request is unaffected by it (C3's v2-view guarantee).
- Neutral module `app/utils/sundayCadence.ts`: `cadenceMembers(config, roster) → { ids, refusals }`
  (refusal reasons `"unresolved" | "ambiguous"`), `cadenceOutsideSundayPool(config, roster)` (reasons
  `"not_ticked" | "no_sunday_lead_tipo"`), `resolveRulePersonId(person, roster) → { ok: true; id } |
  { ok: false; reason: "unresolved" | "ambiguous"; matches }`, and the copy constants
  `CADENCE_V2_NOTE`, `SLACK_V3_NOTE` and the two warning sentences, with `roster` the unfiltered
  worship roster. C6 refuses on any on-screen `cadenceMembers` refusal (WN-2); a month solved from the
  screen gets its cadence members through C2's resolver, which uses `cadenceMembers` (RQ-4); every
  `<=`/`>=` cap and pair person C6 sends resolves through `resolveRulePersonId` (RQ-5, A7 — C3's Q-b
  answered «yes»).
- C3 renders `CADENCE_V2_NOTE` unconditionally and never imports `SOLVER_ENGINE` (C3 §5 non-goals,
  §6.6). The warning's gate is an explicit boolean input on the config panel, default closed; C6
  passes its effective-engine prop to it (WN-1) and adds the v2-only gate on `CADENCE_V2_NOTE`
  (CTL-1).
- C3 leaves to C6: the cadence + exact-`Sun.Lead` conflict (refused, A11, WN-2) and whether the
  specials filler keeps «Holgura» under v3 (A10: it does for uncounted specials, CTL-2).

### IF-C5 — consumed from C5 (solver v3, `contract: 3`)

- **Endpoint.** `owt-solver-v3`; URL in `OWT_SOLVER_V3_URL`; `X-Api-Key` = `OWT_SOLVER_API_KEY`
  (C5-14). **Local entry:** `python gcf_v3/owt_solver_v3.py --json-mode` from the repo root, one
  request on stdin, one response on stdout, exit 0 including for `ok: false` (C5 §11.1).
- **Request (C5 §5, built by C6):** `contract: 3`, `seed` (0–2147483647), `request_id?`, `months`
  (1–2 consecutive, ascending), `budget?` (omitted in production);
  `services[]{ id, date, month, kind: "sunday"|"saturday"|"special", time?, fixed, counts, seats?:
  { Lead, BGV, Choir } }` (1–40; a `special` is `fixed` and `counts`; `seats` required when not
  fixed; a non-fixed `saturday` has no Choir);
  `people[]{ id, name, exempt, eligibility: { <service id>: ("Lead"|"BGV"|"Choir")[] }, carried:
  { DL?, SL?, BGV?, CORO?, "P:<id>"? }, cadence?: { "YYYY-MM": "on"|"off"|"out" }, dl_since:
  "YYYY-MM" | null, prev_dl_leads }` (1–100);
  `rules[]` (0–500): `count{ id, person, roles: RoleKey[], op: "=="|"<="|">=", month, value }`,
  `pair{ id, persons[2], roles, month? }`, `presence{ id, persons[], roles, exclusive, month? }`
  (`month` optional, C5-16: absent = horizon-wide), `consecutive{ id, person, roles }` (horizon-wide);
  there is no week-exclusion kind (C5-2);
  `pins[]{ service, date, role, person }` (0–250); `prior{ month, has_services, services[]{ date,
  kind, counts, seats: { Lead: id[], BGV: id[], Choir: id[] } } }`.
- **Response (C5 §8, read by C6):** success: `ok: true`, `contract: 3`, `engine: "v3"`,
  `solver_version`, `build`, `request_id`, `seed`, `months`, `reproducible`, `assignments: {
  <service id>: { Lead: id[], BGV: id[], Choir: id[] } }` (every request service, fixed ones echo
  their pins), `unfilled[]{ service, role, count, reason }`, `pins{ requested, honored }`,
  `violations[]{ code, rule, cause, person?, persons?, month?, service?, weekends?, observed?,
  limit? }`, `violation_ceiling{ value, proven }`, `stages[]{ id, status, reason?, value, bound,
  limit, ms, det_milli }`, `total_ms`, `fairness{ scale, tolerance, lines, people[]{ person, floor[],
  lines{ <line>: { carried, planned, share, received, pinned, set_aside, after, in_stage, clamped } },
  tabs{ DL?, SL?, BGV?, CORO?, TOTAL?: { carried, share, received, pinned, after, tenths: { share, after } } } } }` (hundredths, `received` = 100 × seats; `after` from the realised `share`, A19, C5-7; per line `tenths: { share, after }`, each rounded once from the exact value, C5-8, `c5:688-697`; `tabs` are the five display tabs in C2 LG-14's folds — BGV is the `BGV` line plus every `P:` sub-line, Total every line — each figure rounded once from the exact sum of its lines, never a sum of their hundredths or tenths, `TOTAL` absent for an exempt person, `c5:706-726`; the panel's plan columns read only `tabs` (EQ-3, EQ-5); an integer seat count and pinned seat count per tab requested by S-12), `cadence[]{ person, month, state, sundays, saturdays, met, compensation }`, `missed[]{ code,
  person, month?, month1?, month2?, dates?, count?, cause }`, `notices[]{ code, params }`. Failure:
  `{ ok: false, contract: 3, engine: "v3", code, params }` at 422 (solver-level), 400, 401, 405, 503
  or 500 — normalised to 422 by the route (RT-5).
- **Service ids are opaque and echoed verbatim**; pins name the service id and keep the date as a
  check (C5-1).
- **Code registry:** `gcf_v3/owt_v3/codes.json`, every emitted code with its parameter names (C5 §9).
  `timeout` {stage, seconds} is the only failure at solve time.
- **Pin cap:** the literal `PIN_CAP = 250` once under `gcf_v3/owt_v3/` (C5-13), mirrored by C6's TS
  constant (RQ-6).

### Provided by C6

- The effective engine as a render prop from `/admin` to the planner and to the C1/C2/C3 surfaces of
  CTL-1, computed by C2's resolver (C6 adds the union type export only if missing).
- `/api/admin/solve`: `409 { ok: false, error: "solver_version_mismatch", engine }`; v3 coded
  failures as 422 with C5's body; v3 transport errors `{ ok: false, transport_error: true,
  transport }` (RT-5).
- The Auto-confirm call to C2's PUT, in C2's shape (CF-3/CF-4); the request to C5 in C5's shape.
- The v3 request builder as one **pure, neutral** function (planner state, the ledger GET, the roles
  read and the clock in; the request and C6's own notices and refusals out — no React, no `fetch`), so
  its unit tests and C7's Preview rehearsal (A23: solve without confirm) exercise the same code.
- To C7: the constant to flip; the v2 history surfaces unmounted under v3 (deletion is C7's); the
  docs of §5.12.

## 7. Spanish copy, keyed on codes

Parameters are rendered by the planner: a member id → alias or name; a month → «noviembre»
(«Noviembre» at the start of a sentence); a date → «8 nov»; a list → «8 y 15 nov»; a rule id → the
rule card's own label; a line → «Dom Lead», «Sáb Lead», «BGV», «Coro», a presence sub-line →
«BGV ({regla})»; a service → «domingo 8 nov» / «sábado 7 nov» / «{nombre} 12 nov».

### 7.1 Stages (`stages[].id`, `stages[].status`)

| Code | Copy |
|---|---|
| `rules` | «Reglas» |
| `fill` | «Llenado» |
| `cadence` | «Mes por medio» |
| `compensation` | «Sábado de compensación» |
| `voice_floor` | «Mínimo de voz» |
| `dl_floor` | «Domingo cada dos meses» |
| `sunday_cap` | «Un domingo al mes» |
| `saturday_cap` | «Un sábado al mes» |
| `no_consecutive` | «Domingos no seguidos» |
| `balance_max:<line>` | «Equidad {línea}: el más pendiente» |
| `balance_sq:<line>` | «Equidad {línea}: reparto» |
| `tiebreak` | «Desempate» (listed in «Ver etapas» only) |
| status `proven` | «probado» |
| status `unproven` | «no probado» — explanation: «"No probado": el plan es válido, pero el solver no alcanzó a comprobar que fuera el mejor en esa etapa.» |
| status `not_run` | «no ejecutado» — explanation by `reason`, then «Las etapas no ejecutadas conservan el plan de la etapa anterior. Revísalo antes de crear.» |
| reason `budget` | «Se acabó el tiempo antes de empezarla.» |
| reason `no_solution_in_limit` | «No encontró un plan dentro de su límite.» |
| reason `stopped_earlier` | «Una etapa anterior terminó la corrida.» |

### 7.2 Missed protections (`missed[]`)

| Code | Params | Copy |
|---|---|---|
| `cadence_on_missed` | person, month | «{persona} no dirigió domingo en {mes}, su mes de dirigir («Mes por medio»).» |
| `cadence_off_led` | person, month | «{persona} dirigió domingo en {mes}, su mes de descanso («Mes por medio»).» |
| `compensation_missed` | person, month | «{persona} no tiene su sábado de compensación en {mes}.» |
| `voice_floor_missed` | person, month | «{persona} no canta en ningún servicio de {mes}.» |
| `dl_floor_missed` | person, month1, month2 | «{persona} no dirige domingo ni en {mes1} ni en {mes2}.» |
| `sunday_cap_exceeded` | person, month, count | «{persona} dirige {n} domingos en {mes}; lo normal es uno.» |
| `saturday_cap_exceeded` | person, month, count | «{persona} dirige {n} sábados en {mes}; lo normal es uno.» |
| `consecutive_sundays` | person, dates | «{persona} dirige domingos seguidos: {fechas}.» |

Cause suffix (`cause`), appended as « — {causa}.»: `unavailable` «no tenía fechas disponibles»;
`pins` «por lo que ya estaba puesto»; `rule` «una regla lo impedía»; `capacity` «no alcanzan los
lugares (ver aviso de capacidad)»; `higher_priority` «cumplirlo rompía algo más importante»;
`not_proven` «el solver no alcanzó a comprobar si había otra opción».

### 7.3 Notices (`notices[]`) and clamps

| Code | Params | Copy |
|---|---|---|
| `dl_capacity` | months, seats, people | «Capacidad de Dom Lead en {meses}: {lugares} domingos para {personas} personas. No alcanza para que todas dirijan al menos un domingo cada dos meses.» |
| `exact_clamped` | rule, person, month, value, available | ««{regla}» pide {valor} en {mes}, pero {persona} solo está disponible {disponible}: se ajustó a {disponible}.» |
| `min_clamped` | rule, person, month, value, available | ««{regla}» pide al menos {valor} en {mes}, pero {persona} solo está disponible {disponible}: se ajustó a {disponible}.» |
| `presence_not_applicable` | rule, service | ««{regla}» no aplica el {servicio}: nadie de esa regla está disponible.» |

C6's own (not in C5's registry): «{regla} queda en 0 en {mes} (tiene {n} domingos).»; «{regla} no
aplica en {mes}: ese mes no tiene semana {n}.»; «{Mes1} y {Mes2} tienen distinto «{Exenta / Mes por medio}»
para {persona} (uno viene del registro). Planea 1 mes.» (RQ-4); the resolver refusal line (RQ-2); «El plan es demasiado grande para el
solver ({qué}: {n} de {máximo}). Planea 1 mes.» (RQ-10); «regla fija registrada de {mes}» as the
label of a record rule with no on-screen card (RQ-5).

### 7.4 Unfilled seats and rule breaks

| Code | Copy |
|---|---|
| unfilled `no_possible_lead` | marker «Nadie puede dirigir este servicio»; notice «Nadie puede dirigir el {servicio}: quedó sin líder.» |
| unfilled `no_candidate` | «Sin candidatos disponibles: quienes podían ya tienen otro lugar en este servicio» |
| unfilled `rules` | «Se dejó vacío: llenarlo rompía más reglas» |
| unfilled `fill_not_proven` | «Se dejó vacío: el solver no alcanzó a llenarlo» |
| violation `mandatory_lead` (rule, service) | «El {servicio} quedó sin líder aunque alguien podía dirigir» |
| violation `count` (rule, person, month, observed, limit) | «No se cumplió «{regla}» en {mes}: quedó en {observado} (pide {límite})» |
| violation `pair` (rule, persons, service) | «No se cumplió «{regla}» el {servicio}» |
| violation `presence` (rule, service) | «No se cumplió «{regla}» el {servicio}» |
| violation `consecutive` (rule, person, weekends) | «No se cumplió «{regla}»: {persona} quedó en fines de semana seguidos ({fechas})» |
| cause `pins` | « — por lo que ya estaba puesto.» |
| cause `forced` | « — no había forma de cumplirla junto con las demás reglas.» |
| `violation_ceiling.proven === false` (with ≥ 1 break) | «Puede que el solver haya cedido más reglas de las necesarias: no alcanzó a comprobarlo.» |

### 7.5 Solver refusals (`ok:false`, `code`)

| Code | Copy |
|---|---|
| `timeout` (stage, seconds) | «El solver tardó demasiado. No se aplicó nada. Prueba con 1 mes o vuelve a intentar.» |
| `contract_mismatch` (received) | «El solver no reconoce esta versión del planificador. Recarga la página; no se aplicó nada.» |
| `invalid_request` (field, detail), `unknown_person` (field, person), `unknown_service` (field, service), `pin_conflict` (person, service), `invalid_json` | «El solver rechazó la solicitud por un error del planificador ({código}: {campo}). No se aplicó nada.» |
| `too_many_pins` (count, cap) | «El plan tiene {n} lugares fijados y el solver acepta hasta {máximo}. Planea 1 mes o apaga «Solo llenar vacíos».» |
| `unauthorized`, `misconfigured`, `method_not_allowed`, `internal_error` | «No se pudo usar el solver ({código}). No se aplicó nada; avisa a quien administra la app.» |
| a code not in the registry (runtime only) | «El solver informó algo que el planificador no reconoce ({código}).» |

### 7.6 Route and client outcomes (C6's own)

| Outcome | Copy |
|---|---|
| 409 `solver_version_mismatch` | «El solver cambió de versión mientras planeabas. Recarga la página; no se aplicó nada.» (also the one new v2 branch) |
| client abort, `transport: "timeout"`, 504 | «El solver tardó demasiado. No se aplicó nada. Prueba con 1 mes o vuelve a intentar.» |
| connection transport (`unreachable`, `http_status`, `not_json`; on the client, any other non-JSON body or unexpected status, AD-3) | «No se pudo hablar con el solver. No se aplicó nada. Vuelve a intentar.» (A24: distinct from the timeout copy) |
| configuration transport (`not_configured`, `contract_echo`, an `assignments` id the request did not send) | «No se pudo usar el solver ({motivo}). No se aplicó nada; avisa a quien administra la app.» — `{motivo}` is the transport code; no «Reintentar» (AD-6) |
| handshake failure | «El solver no respetó los lugares fijados; no se aplicó nada.» |
| ledger read failed | «No se pudo leer el saldo de equidad. Auto no corrió; vuelve a intentar.» |

### 7.7 Panel reasons (one line per row)

«Mes por medio: le toca en {mes}.» · «Mes por medio: descansa en {mes}.» · «Sábado de compensación en
{mes}.» · «No disponible {fechas}: esas fechas no le cuentan.» · «Su número lo fija «{regla}».» ·
«Los pines tomaron {n} lugares.» · «Exenta: fuera de Total y del mínimo de voz.» Ledger-side reasons
(no record, not in the pool) are C2's.

Registry groups shown only through these reasons: `cadence_state` `on` «le toca», `off`
«descansa», `out` «descansa: no está en la lista de Dom Lead»; `compensation` `given` «tiene su
sábado de compensación», `missed` «no tuvo su sábado de compensación», `not_applicable` (no line).

### 7.8 Confirm (U4)

| Situation | Copy |
|---|---|
| record conflict (`record_exists`, `stale_revision`, `record_missing`) | «Otro administrador registró o cambió la elegibilidad de {mes} mientras planeabas. No se creó nada; vuelve a correr Auto.» |
| record conflict (`month_has_services`: a recorded, unbound month gained a stored service) | «Se guardaron servicios en {mes} mientras planeabas, así que su registro ya no se puede reemplazar. No se creó nada; vuelve a correr Auto.» |
| record past (`past_month`) | «{Mes} ya pasó: su elegibilidad solo la registra la reconstrucción. No se creó nada; pulsa «Reintentar».» |
| record engine mismatch (`engine_not_v3`) | «El solver cambió de versión. Recarga la página; no se creó nada.» |
| record team changed (`member_unknown`, `member_not_worship`, `tipo_mismatch`) | «Cambió el equipo mientras planeabas (un miembro o su Tipo). No se creó nada; vuelve a correr Auto.» |
| record other failure (400, network, 5xx, unparseable, unexpected outcome) | «No se pudo registrar la elegibilidad. No se creó nada; pulsa «Reintentar».» |
| anchored, unrecorded month (CF-1 iii) | «{Mes}: no se registró su elegibilidad porque ya tenía servicios guardados sin registro.» |
| month complete | «{Mes}: {c} de {t} creados.» |
| month partial | «{Mes}: {c} de {t} creados; {f} fallaron.» |
| month not attempted | «{Mes}: no se intentó porque {mes anterior} quedó incompleto.» |
| retry button | «Reintentar ({n} pendientes)» |

## 8. Scope

**In scope:** everything in §5; the tests of §14; the docs of §5.12.

**Non-goals:**

- Solver internals, stages, shares, codes' emission (C5); ledger math, record writer, reconstruction,
  «Registrar» UI (C2, C4); the effective-engine resolver, its `OWT_SOLVER_ENGINE` SECRETS entry and
  the PUT's engine gate (C2 EN-1–EN-3, WR-6).
- The toggle UI (C1) and the cadence setting UI (C3).
- Flipping `SOLVER_ENGINE`, deleting `LeadPoolHistoryPanel`/`leadPoolHistory.ts`, emptying the
  Saturday pool, the timing gate, the Preview rehearsal (C7).
- Any change to v2's request, solver, tests, parsers, pin cap or trailing retry beyond the one 409
  branch (RT-2, AD-8); adding timeouts to the v2 path.
- `app/mcp/**`, MCP P4 `solve_month`.
- Publishing in a 2-month confirm; instruments and FOH fairness; kids; a warm-up ping (C7 decides
  if its timing gate needs one).

## 9. Behaviour and invariants preserved

- v2 is the engine and the rollback until C7: with the effective engine at v2 every request byte, response
  path, copy string and mounted surface is today's, except the one 409 branch (RT-2, AD-8).
- CDMX dates as strings; `saturdarSongs`; the five member seats; `published` gating; `_key` on every
  array item; revalidation after writes; client mutation handlers; ADR-0028 boundary; `CueDialog`
  with `open`; house `Button`, `SegmentedControl`, `Switch`, `Collapse`, `useToast`; 16 px form
  controls on a phone.
- ADR-0029 (Tipo is the only eligibility axis): the record and the request snapshot it; cadence only
  shapes shares. ADR-0048: the trailing Saturday is its month's service. ADR-0042: fresh read per
  run, refuse on failure; dual-write kept (Q4).
- Today's draft idempotency (`creationRequestId`), session `createdTargets` and its pairing with the
  `drafts` identity, and the per-target preflight re-check at confirm.

## 10. Decisions

| Decision | Choice | Why | Tradeoff | Owner |
|---|---|---|---|---|
| How the client learns the engine | Server-resolved render prop; 409 as backstop | A client cannot read the Preview override; a fetch adds a loading state to every planner open | Prop threading through `AdminPanel` and `ServicesPanel` | this spec |
| Timeouts | v3 only (55 s route, 58 s client) | Parent §9 keeps v2 byte-identical | v2 keeps its non-JSON 504 until C7 retires it | this spec |
| v3 retry | Manual «Reintentar», only on timeout and connection transports (AD-6) | A solve is ~0.5 s measured; an automatic second call doubles a cold-start wait for no evidence; a configuration fault does not heal on retry | One extra click after a timeout | this spec |
| Services sent | Only those that will exist | A skipped or deselected service would create phantom shares | Differs from v2's full-spine solve | this spec |
| Record write order | One atomic PUT for all months before any draft; any refusal creates nothing | The plan is joint; a refused month means its eligibility differs from what was solved | A record can outlive drafts that all failed (failure table) | this spec |
| Month boundary | Month 2's drafts only after month 1 is complete | Month 2's plan assumes month 1 (cadence, DL floor, consecutive Sundays) | Month 2 waits on month 1's retry | this spec |
| Manual plans under v3 | Record from the on-screen config at first confirm, unless the month is anchored and unrecorded | Otherwise the month drops out of the ledger (F3) | A hand-built month asserts today's pools | this spec |
| Anchored, unrecorded month | Solve it from the screen, create its drafts, write **no** record (PI-7) | Its stored services were not planned with today's pools, so a record would misstate what the month was solved with (L2); C7 K4 makes a permanent record Frank's explicit choice («Registrar») | The month's new drafts count for nothing until a record exists | this spec, pending PI-7 |
| Recorded, unbound month | Screen drives; confirm replaces the record under the `rev` read (A6) | A record whose month has no stored services is not yet what any service was planned with | A failed confirm's record is replaced by the next one | parent A6 |
| 2-month horizon-wide fields | Presence rules month-scoped (C5-16); refuse a horizon whose months disagree on «Exenta» or «Mes por medio» for one person | C5 scopes presence and pairs per month but carries `exempt` once and `cadence` for every month (§5.3); silently picking one month's value would misstate the other | The admin plans 1 month at a time across such a change | this spec, pending S-3 |
| Q4 | Keep one `localStorage` entry per month | Parent default; ADR-0042 rollback target untouched | Two writes per 2-month confirm | Claude (parent Q4) |

## 11. Assumptions

| Assumption | If false | Validation | Response |
|---|---|---|---|
| C5 echoes opaque service ids and matches pins by id | Same-date services mis-map | C5 spec review | Settled by parent A15 and C5-1; a mismatch is a C5 defect |
| C2's PUT is atomic over ≤ 2 months (WR-9) and decides `unchanged` on an identical `contentHash` before every other check (WR-8 step 1) | «Reintentar» 409s forever after a lost response | C2 spec review | Block C6's plan until IF-C2 holds |
| A GET logical record turned into a PUT entry (CF-3) hashes to the stored `contentHash` | A bound month's confirm falls through to `month_has_services` and can never be confirmed | CF-3's round-trip test | Fix the canonicalisation in C2's module, never a C6-side workaround |
| C2's WR-5 member/Tipo check does not refuse a month whose decision is `unchanged` | A bound month with a since-changed member can never be confirmed by Auto, and no app surface can change its record (A5) | C2 WR-5 states this order (checks run after the decision, on written months only) and its test | A CF-4 test with a bound month listing a deleted member: 200 `unchanged`, drafts created |
| A v3 run answers well inside 55 s on the real container | Timeouts | C7 timing gate | Parent §14 responses |
| The create grid can host a stored and a planned column on one date | ST-2 needs a calendar refusal instead | Plan's guard test | Use the refusal branch of ST-2 |
| 2-month horizons fit the pin cap | Fill-empty refused on big horizons | IF-C5 arithmetic | Raise the shared constant (both sides) |

## 12. Open questions (non-blocking)

| Question | Recommendation | Owner | Resolution point | Default |
|---|---|---|---|---|
| Should the run's seed be shown for bug reports? | No; keep it with the plan in memory only | Claude | C6 plan | Not shown |
| Sidebar default with 2 months | «Ambos» | Frank | C7 look | «Ambos» |

## 13. Parent issues

PI-1 to PI-6 of earlier drafts are closed by the amendments: PI-1 and PI-3 by A1 (engine ownership;
the override also honoured with `VERCEL_ENV` unset), PI-2 by A6 (a record binds only an anchored
month), PI-4 by A15 (pins and entries keyed by service id), PI-5 and PI-6 by A24 (distinct copy for
non-timeout transport errors; Auto refuses a horizon with a past month). Their IDs are not reused.

| ID | Issue | Recommended fix | Followed meanwhile |
|---|---|---|---|
| PI-7 | **CF-1 (iii) deviates from the parent's literal text; the parent must amend it.** For the fourth record × stored-services cell (§4) — **no record + stored weekend services or counted specials** — three parent clauses, read literally, have Auto's confirm write the record: L3 («Written by Auto's confirm under v3 only, before any draft», `…-fairness-design.md:294-295`), U4 («The eligibility record(s) first; then drafts», `:326`) and A6's «Otherwise … the confirm replaces the record under its revision» (`:127`), whose «otherwise» covers every month that does not bind, this one included. C2's writer would accept that write (WR-8 row 3: no record and `expectedRev === null` → `create`, `…-c2-ledger-and-record-design.md:138`), so nothing below the parent decides it, and today (iii) lives in C6's client only (CF-1's last sentence). Writing it would mint a permanent `source: "auto"` record for a month whose stored services were planned under v2 or by hand — e.g. a v3 Auto that adds one missing Saturday to the v2-confirmed current month at cutover — contradicting A21 (`:142`: «until then the current month reads «sin registro»») and C7 K4 (a permanent record for that month is Frank's explicit «Registrar» choice, `…-c7-cutover.md:577,714`), and misstating what the month's stored services were solved with (L2). No amendment A1–A26 settles the conflict between L3/U4/A6 and A21. | The parent's owner amends L3 (`:294-299`) or A6 (`:127`), and U4 (`:326`) to match: «Auto's confirm writes no record for a month that already holds stored weekend services or counted specials and has none; that month's record comes from the reconstruction once past, or from «Registrar» by the admin's explicit choice.» The same amendment rules whether C2's route actor enforces it, so the rule is not client-only. **Recommended: yes** — WR-8 refuses a `source: "auto"` create on a month that has freezing services (A5's count, re-checked at write time like row 7) with `month_has_services`; `source: "manual"` («Registrar») and the reconstruction's actor stay allowed. C6's CF-4 already maps that detail to «conflict, re-run Auto», and §7.8's line would gain a create-side wording (no record existed, so «ya no se puede reemplazar» is inexact). **If the owner rules the other way** (keep the literal text), C6 drops CF-1 (iii), ST-8's «anchored, unrecorded» copy, §7.8's line and the failure table's last row, and the state's confirm becomes «sends the on-screen body with `expectedRev: null`, expects `created` or `unchanged`», like an unrecorded month; C7 must then rewrite K4 and Step 10, which rely on (iii) (`…-c7-cutover.md:584-587`). | As recommended (CF-1 (iii), ST-8's notice, §7.8's line, the failure table's last row), marked here as a deviation pending the amendment. The standard part of this spec does not depend on it; **§5.11's plan is not written for review until the amendment lands** (§15) |

### Sibling issues (for the owning child; C6 follows its current text meanwhile)

As read on 2026-10-05, after the siblings' own alignment to A1–A26; IDs are kept stable and closed
ones are not reused.

| ID | Child | Issue | Recommended fix | C6 meanwhile |
|---|---|---|---|---|
| S-3 | C5 | C5-16 now scopes `presence` and `pair` per month, but `exempt` is one bool per person and `cadence` must cover every request month (C5 §5.3), while A6 lets a bound month and a month solved from the screen hold a different «Exenta» or «Mes por medio» for one person | Accept a per-month `exempt` (e.g. `{ "YYYY-MM": bool }`) and a `cadence` that omits a month in which the person is «Normal» | RQ-4 refuses such a 2-month horizon with copy («Planea 1 mes»); presence goes month-scoped (RQ-5) |
| S-12 | C5 | «En este plan» (U5) and the `{n}` of «Los pines tomaron {n} lugares» (EQ-4, §7.7) are seat counts, and C2 forbids a client from dividing a hundredths figure to get one: C2 emits `Figures.seats` for «Tuvo» so that «no client divides» (C2 LG-13, UI-4). C5's `fairness.people[].tabs[<tab>]` — the only source of the panel's plan columns, since the folded BGV and Total have no single line (`c5:706-726`) — carries `received` and `pinned` only as hundredths (`c5:711-712`) and `tenths` only for `share` and `after` (`c5:717-719`), so neither count has a compliant input. C5's own summary has the panel render «En este plan» «from that tab's `received`» (`c5:1226`), which would make C6 divide; its sibling row offers the integer as optional (`c5:1398`). Counting from the board instead would re-implement the line's populations, set-asides and sub-lines (C2 LG-4–LG-11), which C6 must not do | Add, per person and tab, an integer `seats` = `received` ÷ 100 and an integer `pinned_seats` = `pinned` ÷ 100 (both exact, `received` and `pinned` being 100 × seats; the shape of C2's `Figures.seats`), emitted by the solver so no consumer divides — per line too if C5 keeps the two shapes alike; and amend `c5:1226` to name that field | EQ-3/EQ-5 render «En este plan» and EQ-4 its `{n}` only from those fields; C6's plan waits for them |

Closed since the previous draft: S-11 (C5 now emits per-line `tenths: { share, after }` and, per person, the five display `tabs` with their own `tenths: { share, after }`, each rounded once from the exact value or exact sum, C5-8, `c5:688-697`, `c5:706-726`; EQ-3/EQ-5 render «Queda» from `tabs[<tab>].tenths.after`, so the folded BGV and Total need no sum), S-1 (C2 WR-5 now runs the live-data checks only on written months),
S-2 (C1 names C2 as the override's owner), S-4 (C2's `countedSundayLeads` is one entry per Lead
seat), S-5 (C5 takes `prior` from C6's roles read, A15), S-6 (C2 UI-4 and C4 show one decimal, A17),
S-7 (one limit of 100 people), S-8 (C2's freezing services and `recordBinds` follow A5/A6), S-9 (C2's
dotted id and A1 resolver), S-10 (C7 records PI-5 as settled by A24). C3 needs no change: it already
has C6 open the warning with its server-resolved prop, and A7 closed its former Q-b (RQ-5). C1's
SN-2 is applied (§5.1 no longer says «if absent»).

## 14. Acceptance and verification

| Requirement | Acceptance evidence | Verification |
|---|---|---|
| ENG-1..5 | One resolver (C2's) imported; neutral module; server-only import guard; constant `"v2"` | vitest; `clientBoundary.test.ts`; grep guards |
| RT-1..6 | 409 both ways; v2 path unchanged; v3 remote/local/unconfigured; 55 s abort; JSON for every failure | Route tests with a stubbed upstream and fake timers |
| HZ-1..8 | Picker per engine; per-month state; Dec→Jan; date ownership; stacked calendars; month band; sidebar; past refusal | Component and unit tests |
| ST-1..9 | «Guardado» from the coherent read; identity per service; no stored writes; fixed services with filled-seat shares; notices; the four month states (§4); fill-empty | Unit + `MonthGenerator` create tests |
| SP-1..6 | Pre-fill by balance; fixed afterwards; uncounted unchanged; exits | `localFill` + wiring tests |
| RQ-1..10 | Fresh bounded ledger read; one month source for request and record (bound: the record's statuses, exact rules, presence, blocks, cadence and exempt); presence month-scoped; exempt/cadence disagreement refusal; exactly-one names and C2's expansion/count functions for screen rules; services that will exist; per-month rules; pins and cap sync; `prior` from the roles read; C5 limits pre-flighted; no v2 fields or helpers | Request-builder unit tests; Python-source sync test |
| AD-1..8 | Parsers never crossed; 58 s abort; classification; handshake; apply by id; code-keyed retry; exits; the v2 409 branch | Spy tests; adapter unit tests |
| NT-1..5, EQ-1..7 | Copy keyed on codes, registry sync, stage summary, panel per engine, plan columns, phone cards | Copy sync test; render tests |
| WN-1..3, CTL-1..2 | Warnings, cadence refusals, engine wiring, filler ordering | Render and ranking tests |
| CF-1..11 | Order (spy on call sequence: at most one PUT, then POSTs by date); the three entry shapes of CF-3 (bound, recorded-unbound, unrecorded) each with its expected outcomes — `replaced` accepted only for recorded-unbound; no PUT when no month needs an entry; an anchored, unrecorded month gets drafts and no entry; zero POSTs after any record refusal or unexpected outcome; GET→PUT round-trip hash; month gate; frozen body; replay per shape; per-month report; publish absent at 2; per-month history append; closing dialog | `MonthGenerator` create tests with a scripted fetch; route test; reviewed in the adversarial loop |
| DOC-1..3 | Entries and ADRs present | Code review + docs audit at cycle close |
| Parent §16 | Preview, engine v3, two real months solved (not confirmed) | C7 |

Gates before any merge: `npx tsc --noEmit`, `npm test`, `npx eslint .` (0 errors), and — since C6
reads `gcf_v3/` source in a sync test but changes no Python — the Python gate only if a `gcf*/**`
file changes.

## 15. Risk tier and review handoff

- **Tier: standard** for the spec as a whole (parent §11: C6 standard), with **§5.11 critical**: it
  orders writes to a new production writer and to the service create route, and owns partial-failure
  recovery. Per CLAUDE.md, the adversarial loop runs on **that slice's plan** (two sequential fresh
  `APPROVED` on byte-identical text, churn cap binding); the rest of C6 relies on spec review plus a
  fresh code review of the diff. A6 and PI-7 make that slice larger than in the earlier draft — three
  entry shapes (bound, recorded-unbound with a requested replace, unrecorded) and a record skip for an
  anchored, unrecorded month — so it stays critical and the plan's review covers §4's state table with
  it.
- Dependencies: C2 (IF-C2), C3 (IF-C3), C5 (IF-C5, deployed and inert; S-12's per-tab seat counts before C6's
  plan), C1 (IF-C1); PI-7 settled by the parent's owner (an amendment to L3/A6 and U4, and its ruling on C2 WR-8's server check) before the §5.11 plan is reviewed — CF-1 (iii) departs from the parent's literal text until then. Safe end state:
  production unchanged (`SOLVER_ENGINE = "v2"`); Preview may run v3 via the override. Rollback: the
  constant stays v2; unset the Preview override.
- Evidence for reviewers: the parent, this spec, the cited files. Prior planning dialogue excluded.
- Implementation authorization: **not granted by this document.**

## 16. Terminal state

`READY_FOR_REVIEW`
