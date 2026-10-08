# Solver v3, child C6: the planner on v3 — engine switch, 1–2-month horizon, stored services as pins, live «Equidad» — design spec

**Date:** 2026-10-05 · **Status:** `READY_FOR_REVIEW` (status line amended 2026-10-07 to match §16 — it
read `DRAFT`: the spec is self-reviewed; Frank authorized proceeding with the children on 2026-10-05
but has not read C6 itself) · **Parent:**
[`2026-10-05-solver-v3-fairness-design.md`](2026-10-05-solver-v3-fairness-design.md) (APPROVED by
Frank) — this child owns parent §7 (U1–U8) and its part of §8 E2 (A1). The parent's amendments
A1–A41 (its §3) win over older clause wording; this spec is aligned to them (A1, A2, A5–A7, A9–A11,
A13–A15, A17, A19, A21, A23, A24, A27, A30–A32, A35, A38–A41 touch it).
**C2's interfaces are cited by their C2 §7 ID (`IF2-n`, with the field where one is meant), never
copied (§6).**
**Risk tier: standard, except §5.11 (the confirm protocol, U4), which is critical** — see §15.
**Key hygiene:** rule keys never reach a log, a copy line or a doc; rules are named by card label in
the UI and by kind and config ordinal anywhere else (§5.13, A41).

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
  eligibility-normalised balances, writes each horizon month's eligibility record before any draft
  (creating one for every month that has none, A27), and tells the admin in Spanish why each person
  got what they got. With the engine at v2 (the default,
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
| `isServiceTime` is the only validator of a service's `"HH:mm"` `time` under `app/**`; a stored `time` written outside the app's validated writers can fail it | `app/utils/serviceTime.ts:20-22`; CLAUDE.md («A special's `time`…») | RQ-3 sends `time` only when it holds, so the wire's «absent» equals the ledger's «invalid read as absent» (C2 LG-11) |
| A canonical document id is bounded (≤ 200), has no whitespace and is never `drafts.*`; the roles read's `published` perspective never returns a `drafts.*` id | `app/utils/roleWriteRequest.ts:57-71`; `sanity/lib/operationalClient.ts:16-23` | A stored service's `_id` is sent verbatim as its service id (RQ-3); C5 §5.2's service-id grammar is this predicate (S-14, applied) |
| `OWT_SOLVER_API_KEY` and its companion `OWT_SOLVER_URL` are documented | `docs/SECRETS.md:485-500` | `OWT_SOLVER_V3_URL` gets its entry in this change; `OWT_SOLVER_ENGINE`'s entry is C2's (A1) |
| Engine ownership is settled by the parent: C1 creates `solverEngine.ts` with the constant only; C2 adds the effective-engine resolver, its SECRETS entry and the PUT's `engine_not_v3`, and returns `engine` from its GET; C6 adds the solve route's 409 and the server-resolved prop | parent A1 (parent §3); C1 interface table, row «Engine constant»; C2 EN-1–EN-3, WR-6, RD-3; C2 IF2-14 (resolver), IF2-6 (`engine_not_v3`), IF2-8 (`engine`) | C6 consumes the resolver; it never writes a second one, a second SECRETS entry or a second PUT gate |
| A month with stored weekend services or counted specials keeps its record (A5); only such a month binds the solve to its record (A6) | parent A5, A6 (parent §3) | «Anchored» (§4) is the one predicate behind binding, the confirm's entry shapes and its record skip |
| Auto's confirm **creates** a record for every horizon month that has none, whether or not the month already has stored services; creating never overwrites anything, and A5 governs replacement only. A21's «sin registro» applies only to months nobody ran v3 Auto on | parent A27 (parent §3), amending L3, U4, A6 and A21; C2 WR-8 row 3 (decided by C2 IF2-21) | An «anchored, unrecorded» month (§4) is confirmed like an unrecorded one; a v3 confirm on the v2-planned current month at cutover mints its record, which is then frozen (A5) and binds every later solve of that month (A6) |

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
- **Anchored month.** A horizon month with at least one **freezing service** (C2 §4, defined once by
  C2 IF2-24) — exactly A5's condition for keeping a record. An uncounted special alone never anchors
  a month. Read as C2 IF2-8 `horizon[].storedServices > 0` from the same fresh
  `GET /api/admin/fairness` (C2 IF2-7) the run (or the no-Auto confirm, CF-2) reads.
- **Bound month (A6).** A horizon month that has an eligibility record (A2) and is anchored — read
  as that GET's C2 IF2-8 `horizon[].recordBinds`, which C6 never re-derives. Every horizon month is
  in exactly one of four states:

  | Record | Anchored | State | Month source (RQ-2) | Confirm (CF-1, CF-3) |
  |---|---|---|---|---|
  | yes | yes | **bound** | the record | sends the record's own content, expects `unchanged` |
  | yes | no | **recorded, unbound** | on-screen config | sends the on-screen body under the record's `rev`, expects `replaced` or `unchanged` |
  | no | no | **unrecorded** | on-screen config | sends the on-screen body with `expectedRev: null`, expects `created` or `unchanged` |
  | no | yes | **anchored, unrecorded** | on-screen config | as unrecorded: sends the on-screen body with `expectedRev: null`, expects `created` or `unchanged` (A27) |

  The fourth state differs from «unrecorded» only in what the admin is told (ST-8): C2's decision
  (WR-8, IF2-21) creates at row 3, before row 7's `month_has_services` check, which guards
  replacement only, so a create is never refused for the month's stored services. The record so created is frozen at once (A5) and binds
  every later solve of that month (A6). Accepted tradeoff (A27): it asserts the on-screen pools for a
  month whose earlier stored services were planned without them.

- **Solve snapshot.** For each horizon month, its month source and its state as of the run's ledger
  read (RQ-1, RQ-2), frozen with the plan; and, for the whole run, its **rule reference table**
  (KH-3): every rule id the request sends and every `P:` key it rewrites, each with its rule's kind
  and **config ordinal** — never its source key.
- **Config ordinal.** A rule's position in the on-screen config the run read (unsaved edits
  included), in document order, spelled `restrictions[i].caps[j]`, `conflicts[i]` or `presence[i]`
  (parent A41: kind and config-array ordinal). It is **not** the minting ordinal RQ-5 (iii) may use,
  which counts the request's rules in codepoint order of their keys; the two are never conflated.
- **Displayed state before a run.** Before Auto reads, what the config step shows per month — ST-8's
  banners and read-only checkboxes, WN-1's gate — comes from the latest fairness GET for the horizon
  the planner holds; while none has answered, every month is shown as not bound, so banners and gates
  err toward showing. Only the run's own fresh read (RQ-1) decides what is solved and confirmed.

## 5. Requirements

### 5.1 Engine switch (E2)

**Ownership (parent A1).** C1 creates `app/components/admin/solverEngine.ts` with the constant
`SOLVER_ENGINE` only. C2 adds the effective-engine resolver (C2 IF2-14, rule EN-2), its
`docs/SECRETS.md` entry (EN-3), the PUT's refusal `engine_not_v3` (WR-6, IF2-6) and the GET's
`engine` field (IF2-8). C6 adds only what is listed below: the solve route's
`409 solver_version_mismatch` and the server-resolved engine passed to the planner.

| ID | Requirement | Acceptance |
|---|---|---|
| ENG-1 | C6 **imports C2's resolver** (C2 IF2-14, A1) and writes no second one. The constant's module stays **neutral** (no `"use client"`, no imports); C6 adds the exported union type `"v2" \| "v3"` only if C1/C2 did not, and never changes `SOLVER_ENGINE`'s value (`"v2"`) or its union annotation. C6 imports the resolver from wherever C2's plan placed it — moving it is allowed, duplicating it is not. | `clientBoundary.test.ts` passes; **C1's engine-module test (C1-R11, C1 §7 row «Engine module») is the one pin of `SOLVER_ENGINE === "v2"` and its annotation, and stays green unedited** (it asserts nothing about other exports, so C2's resolver may join the module) — C6 adds no second pin; grep guard: exactly one function in `app/**` reads `OWT_SOLVER_ENGINE` |
| ENG-2 | The resolution rule and its table test are **C2's** (EN-2, IF2-14). C6 restates nothing of it and relies on it unchanged; with `VERCEL_ENV` unset a developer reaches v3 locally through the override and RT-3's local entry point. | C2's resolver tests stay green |
| ENG-3 | The effective engine is resolved **on the server only**: by the `/admin` page at render (passed down as a prop to the planner and to every engine-dependent surface C6 wires, §5.10) and by `/api/admin/solve` on every request. No client module reads `process.env` for it or calls the resolver. C2 IF2-8 `engine` is the same resolver's output on the same deployment; C2's own surfaces (its «Registrar» gate, UI-6) keep reading it there. | A static guard test: the resolver is imported only by server modules (`page.tsx`, route files, C2's commit/read modules); a render test: the planner shows v3 controls iff the prop says `"v3"` |
| ENG-4 | Every engine-dependent behaviour C6 owns or wires in the client branches on that prop, never on `SOLVER_ENGINE` directly, so Preview's override and production's constant can never disagree inside one bundle. A page rendered before a deployment change can disagree with a later request; the server gates — the solve route's 409 (RT-1) and C2's PUT `engine_not_v3` (WR-6) — are the backstop. | Grep guard: no client file compares `SOLVER_ENGINE` |
| ENG-5 | Flipping production is a PR that changes `SOLVER_ENGINE` (C7). Rollback is the reverse PR. The production override is ignored by construction (A1), so a stale production variable can never make either PR a no-op. | C2's resolver table |

### 5.2 The solve route

| ID | Requirement | Acceptance |
|---|---|---|
| RT-1 | After the two existing auth refusals and the JSON parse, the route resolves the effective engine (C2 IF2-14) and classifies the body by the v3 contract marker (`contract: 3`, IF-C5). A **v3 body under v2** or a **v2 body under v3** is answered `409 { ok: false, error: "solver_version_mismatch", engine }` before any other validation. The server's engine decides; the body never selects one. | Route tests, both directions, no upstream call made |
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
| HZ-9 | **Ceiling.** Under v3, a horizon that contains a month **later than the current CDMX month + 12** — the last month C2's record validator accepts (C2 WR-4; C2 RES-8 guarantees a passing body only for the months WR-4 accepts) — is refused by Auto before any read, in HZ-7's shape and placement: «Auto no planea más de 12 meses adelante: {Mes} queda fuera. Elige un mes hasta {mes límite}.» The year select keeps reaching 2035 (`MonthGenerator.tsx:1258`, unchanged; v2 writes no record and has no ceiling). The confirm checks the same ceiling on every attempt before writing anything (CF-1's placement), so a confirm that takes CF-2's fresh-read path without a v3 Auto never sends a month WR-4 refuses; it shows this row's line and no «Reintentar» (only a horizon change satisfies it). The ceiling only rises as the client's clock advances, so a horizon admitted at Auto stays admitted at confirm; the one residual `400` is a client clock already past a month boundary the server's has not reached (WR-4 judges the server's current month), which CF-4's «Reintentar» clears once the server crosses it. | Tests with a fixed clock: current + 12 admitted, current + 13 refused before any read (no GET, no solver fetch), incl. a 2-month horizon whose second month alone crosses; a confirm without a prior Auto refuses with nothing written |

### 5.4 Stored services in the horizon (U2)

| ID | Requirement | Acceptance |
|---|---|---|
| ST-1 | Under v3, every stored service of a horizon month appears as a read-only «Guardado» column built from the same full-roster read and the same admission/coherence verdict the stored editor uses. Auto refuses to solve while that read is not ready or not coherent: «No se pudieron leer los servicios guardados de {meses}. Auto no corrió; vuelve a intentar.» | Tests: ready → columns; failed or incoherent → refusal, no fetch |
| ST-2 | Columns are identified per service — stored by document `_id`, planned by target — never by date alone. A planned column is never built for a target a stored service occupies. Where a stored service and a planned column share a date (a stored special on a Sunday; two same-day sets, ADR-0011), every date-keyed site in the create grid either tolerates both columns or the calendar refuses the combination with a stated reason. The plan names the guard test. | Test: stored special + planned Sunday on one date renders two columns with separate cells, or a stated refusal |
| ST-3 | No create-flow request ever creates, modifies or deletes a stored service. «Guardado» columns produce no drafts, are not editable, take no drops, and Auto never writes their cells. | Tests: confirm posts no stored target; Auto leaves stored cells byte-identical |
| ST-4 | Every stored **weekend** service in the horizon is sent as a fixed service with its counted flag; every stored **counted special** is sent as a fixed service; a stored **uncounted special** is never sent. Their shares use their filled seats (a fixed service's seat count equals its pins), so an empty stored seat creates no share and is never filled. | Request-builder tests |
| ST-5 | One notice says so whenever the horizon holds stored services with empty voice seats: «Los servicios guardados no se tocan: sus {n} lugares de voz vacíos se quedan vacíos. Llénalos en «Editar mes».» | Test |
| ST-6 | A stored seat whose holder is not a current member, or a person's second voice seat in one stored service, is not sent; each case is named in a notice («{servicio}: un lugar guardado es de alguien que ya no está en la lista; no se envió al solver.» / «{persona} está dos veces en el {servicio} guardado; se envió solo como {rol} y su saldo cuenta solo ese lugar.»). **One seat per person per service is a shared rule, not C6's:** the seat C6 sends is the one C2's ledger keeps (C2 LG-4, run by C2 IF2-11) and C5's plan counts, by the rule those two state identically — the first by Lead > BGV > Coro (C5-10 and C5 §6.6; C2 LG-4) — so «Queda» after this run and the next ledger read agree on that service. C6 defines no second rule. | Tests, incl. one asserting that, for a counted stored service, the kept seat equals the one C2 IF2-11 keeps for the same service |
| ST-7 | A target created during this session (this confirm or another tab) is a stored service for every later Auto: sent fixed with its stored seats, never re-planned. | Test: partial confirm, Auto again, the created target is fixed |
| ST-8 | **Month states (§4, A6).** A **bound** month is solved with **everything its record snapshots** (A3, A6): per-role statuses, exact rules with their resolved counts (`exactRules`), presence rules with members and exclusivity (`presence`), date blocks (unavailable and rule-excluded roles), cadence setting and exempt flags (RQ-2, RQ-4, RQ-5). Only what the record does not hold comes from the on-screen config for that month: `<=`/`>=` caps and pairs. Every other state is solved from the on-screen config. The pool checkboxes are one team-wide list, so: when **every** horizon month is bound they are read-only with «{Meses} ya tienen servicios guardados y elegibilidad registrada: se planea con esas listas, sus reglas fijas, de presencia y de semanas, y estas casillas no aplican.»; otherwise they stay editable and apply only to the months that are not bound, and each bound month shows the banner «{Mes} ya tiene servicios guardados y elegibilidad registrada ({fecha}): se planea con esa lista y sus reglas fijas, de presencia y de semanas; las casillas y esas reglas en pantalla no aplican a {mes}. Como ya tiene servicios guardados, ese registro ya no se puede cambiar.» A **recorded, unbound** month shows «{Mes} tiene elegibilidad registrada ({fecha}) pero ningún servicio guardado: se planea con las casillas en pantalla y, al crear, ese registro se reemplaza.» An **anchored, unrecorded** month shows «{Mes} ya tiene servicios guardados pero no tiene elegibilidad registrada: se planea con las casillas en pantalla y, al crear, se registra con ellas. Como ya tiene servicios guardados, ese registro ya no se podrá cambiar.» (A27, A5). Topes («máximo»/«mínimo») and «no juntos» on screen apply to every month. The ledger GET decides each month's state and its copy; the roles read (ST-1) decides the «Guardado» columns. A service stored between the two reads can make them disagree for that run (a «Guardado» column beside a «ningún servicio guardado» banner); this is tolerated, the writer's own check decides at confirm (CF-1, CF-4), and the next Auto re-reads both. | Tests for each state and for a mixed 2-month horizon; a test where the on-screen `==` cap differs from the record's: the request carries the record's count for the bound month and the on-screen count for a recorded, unbound month; a test where only an uncounted special is stored: the month is not anchored; a test that an anchored, unrecorded month shows its banner and is confirmed with a create entry (CF-3) |
| ST-9 | «Solo llenar vacíos» keeps today's meaning on the planned columns' own seats (every occupied voice seat becomes a pin, one per person per service, Lead > BGV > Coro). Stored services and counted specials are fixed whatever the switch says. Its confirm text under v3 reads «… que el solver pueda resolver en {meses}. Los servicios guardados no se tocan.» | Tests with the switch on and off |

### 5.5 Specials (U3)

| ID | Requirement | Acceptance |
|---|---|---|
| SP-1 | Under v3, every **planned counted special** is filled **before the request is built**, Lead and BGV only (Coro on a special stays manual, as today), append-only (nothing hand-placed is evicted), with every hard block of today's filler — Tipo, a seat already held in the same category at that service, availability on the date, and the rules today's filler enforces on a special (person exclusions and pairwise conflicts; never count caps or presence) (`candidateRanking.ts:197,204-207,211,216,225`; `ruleEnforcement.ts:15-30`; `localFill.ts:284`) — **and** RQ-2's eligibility for that role at that service (the month source, as the request carries it), so the pre-fill never pins someone the request calls ineligible (which C5 would honour and set aside: C5 §5.5, and §12.3 scenario set P, item 7) — and then ranked by SP-2. Protections are not hard blocks here (F12: fill outranks them); SP-2 orders them. Rule instances never include a special (C5-3, A13), so no count or pair rule of the request can be broken by this pass. | Tests per hard block, incl. a candidate the on-screen pools admit but a bound month's record does not (not placed); SP-2's tests |
| SP-2 | **Protections first, then balance (U3 read under F12; F7, F11, D12).** For a special's **Lead**, a candidate the hard blocks admit is **second tier** when placing her would by itself produce a protection miss that the solver can only report with cause `pins` (C5 §8.1, «`missed` causes», cause `pins`; C5 §12.3 scenario set P, item 5), judged against the seats fixed before the solve — every fixed service's seats (stored services, ST-4), the board pins under «Solo llenar vacíos» (ST-9) and this pass's earlier placements — plus `prior` (RQ-7), over counted services only, as C5 counts them (C5-3; L and S as C5 §7.1's notation defines them): (a) a DL-mapped Lead (a Sunday-dated special, D14) for a cadence member whose RQ-4 state for that month is `off` (`out` cannot arise here: it means `Sun.Lead` is not `in` in that month's source, so SP-1 never admits her) (C5 §7.1, stage 3 `cadence`; F7); (b) a DL-mapped Lead for anyone who already holds a DL-mapped Lead that month, unless `Sun.Lead` is «exact» for her in that month's source (C5 §7.1, stage 7 `sunday_cap`; F11) — a cadence member in her `on` month included; (c) an SL-mapped Lead (a special on any other day, D14) for anyone who already holds an SL-mapped Lead that month, unless `Sat.Lead` is «exact» for her there (C5 §7.1, stage 8 `saturday_cap`; F11, A16); (d) a DL-mapped Lead on Sunday d for anyone who holds a DL-mapped Lead on d − 7 or d + 7 (C5 §7.1, stage 9 `no_consecutive`; D12; a `prior` Sunday counts). Every other admitted candidate is **first tier**, ordered: those whose status is `in` for the seat's role key in that month's eligibility (D14, A13: the special's role key by C2 LG-4's day class, its line by C2 IF2-1's role → line map) **and who are on that line**, most owed first by the carried balance of that line (C2 IF2-8 `people[].window[line].balance`), each placement in this pass counting as one received seat for the next; then everyone else in today's load order. A cadence member has no DL line (F7) and is **never ranked by a DL balance**: on a DL-mapped Lead in her `on` month she is in that second group. The second tier is used **only when the first tier is empty**, because fill outranks every protection (F12: at least one Lead whenever an eligible lead is available) and the solver never fills a fixed special's seat (SP-3); it is ordered by the most important protection the placement would miss, least important first in F12's order (no consecutive Sundays, then the Saturday cap, then the Sunday cap, then cadence), then by the first tier's order. Ties keep today's order. BGV seats carry no such protection and use the first tier's order alone. The cadence states are RQ-4's, computed before this pass (RQ-4). | Ranking tests with fictitious balances, and one per second-tier case: (a) a cadence member in her `off` month is not placed on a Sunday-dated special's Lead while a first-tier candidate exists; (b) a regular holding a stored Sunday Lead that month, and a second Sunday-dated counted special in one month filled in this pass, push that person to the second tier, while a person «exact» for `Sun.Lead` stays first tier; (c) a Saturday-dated special and a candidate holding a stored Saturday Lead that month; (d) a Sunday-dated special on the Sunday after a `prior` Sunday lead, and on the Sunday before a fixed one; a cadence member in her `on` month ranks after every DL-line candidate whatever the balances; a special whose only admitted candidates are second tier is filled with the least important miss and SP-7's notice names it |
| SP-3 | After the pre-fill, every counted special (planned or stored) reaches the solver **only as a fixed service**; the solver never fills a special's seat. Because it is a service of the request, its seats count toward the protections and caps of the line they map to (F1, F11). | Request test: special present with every seat pinned |
| SP-4 | **Uncounted specials** keep today's mechanism exactly: never sent, filled after the solve at every exit by today's load ranking. Instruments keep today's fill at every exit. | Existing special/instrument tests green under v3 |
| SP-5 | On an exit before the pre-fill ran (any pre-flight refusal — RQ-2's resolver lines and RQ-4's disagreement refusal included, since the pre-fill reads both — or a failed ledger read), counted specials are left as they are and the refusal adds «Los especiales que cuentan para equidad no se llenaron porque Auto no corrió.» | Test |
| SP-6 | A notice names the pre-fill whenever it placed anyone: «Los especiales que cuentan para equidad se llenaron primero (Lead y BGV, por saldo) y el solver acomodó los fines de semana alrededor de ellos.» | Test |
| SP-7 | Every second-tier placement (SP-2) gets one notice, keyed on the protection it misses: «{persona} dirige el {servicio} aunque {motivo}: nadie más podía dirigirlo.», with `{motivo}` «es su mes sin domingo («Mes por medio»)» (a; copy amended 2026-10-07, see §7.7), «ya dirige otro domingo en {mes}» (b), «ya dirige otro sábado en {mes}» (c) or «dirige el domingo anterior o el siguiente» (d). The solver's own `missed` line for the same miss (cause `pins`, §7.2) still renders; C6 adds no other copy of it. | Test per motivo |

### 5.6 The v3 request (built from planner state, C2, C3, C1)

| ID | Requirement | Acceptance |
|---|---|---|
| RQ-1 | **Ledger read.** Every v3 Auto reads `GET /api/admin/fairness` (C2 IF2-7, with `month` = the horizon's first month and `horizon` = its length) **fresh**, at press time — never a display copy — bounded by an abort of **≤ 20 s**. Any answer other than an IF2-8 200 body (IF2-7's failure body, any other status, an abort, an unparseable body) refuses the solve («No se pudo leer el saldo de equidad. Auto no corrió; vuelve a intentar.») and no request is sent with zero or missing balances. A lookback month without a record is not a failure (F3); C2's reader fails closed when its read token is absent (A2, IF2-7), so «sin registro» is never a disguised failed read. The same read decides each horizon month's state (§4). If the admin changes the horizon during the read, nothing is solved; if it changes during the solve, nothing is applied — and in neither case is anything filled, because AD-7's fill is for the horizon Auto was pressed on (amended 2026-10-07 by the C6 code review: a stale run used to fill, and apply, its old board over the new horizon's). | Tests mirroring the derived-history ones (`MonthGenerator.tsx:3822-3894`) |
| RQ-2 | **Eligibility, one derivation (A7).** For each horizon month the **month source** is C2 IF2-8 `horizon[].record` (an IF2-3 logical record; C6 takes its `people` with `name` removed, and its `presence`) when the month is **bound** (§4, A6), otherwise the `body` of **C2 IF2-15** applied to the on-screen config and the planner's on-screen `members` **as-is** at press time — any superset of the worship roster carrying each member's stored `ministries` (a super-admin's list includes kids-only members, C3 E25); C6 never filters or strips that list, because the resolver drops non-worship members itself (C2 RES-5) and C3's functions apply the same predicate (C3 §7 item 4). A resolver `ok: false` refuses Auto before the fetch, with one line per IF2-15 `refusals` item and one per `issues` item, each line taken from §7.9, keyed on the item's `reason` or `code`; an issue's `ruleKey`, when present, is used only to find that rule's card label for the line (§7) and is never rendered, logged or copied itself (§5.13). Because C2 guarantees (RES-8, A38, tested) that every `ok: true` body passes its validator **for every month WR-4 accepts** (at most the current CDMX month + 12, which HZ-9 enforces before any read and at confirm), C6 never runs that validator itself (it hashes with `node:crypto`) and a body it confirms is never refused as `400 invalid_request` for its content. The month source is the solve snapshot: the same value feeds the request (this row, RQ-4, RQ-5) and the frozen record body (§5.11). Per-service eligibility is derived from it alone: a role of service s is eligible for p iff p's status for s's role key (A13; a special's by C2 LG-4's day class) is `in` or `exact`, p is available on s's date (the month source's `blocks[].unavailable` ∪ live `unavailableDates`, F4), and — at a weekend service only — the role key is not in that date's `blocks[].excludedRoles`. A non-fixed `saturday` has no Choir. C6 never re-derives pools, Tipo or rule membership, and never uses `solverPools`. | Test: request eligibility and record body are produced from one value; mutation of either fails; a bound month ignores an on-screen pool change and a recorded, unbound month follows it; a refusal test per IF2-15 `reason` and per `issues` code (no fetch); a type-level guard: §7.9's copy map is keyed on IF2-15's own `reason` and `code` unions, so a code C2 adds without copy fails `tsc`; a **super-admin roster with a kids-only namesake** of a rule person (same `member_name` or `alias`, `ministries: ["kids"]`) passed with `ministries` intact: no `ambiguous` refusal, the rule resolves to the worship member, and Auto proceeds |
| RQ-3 | **Services.** The request holds exactly the services that will exist: planned weekend columns that are neither skipped nor blocked, every stored weekend service, every counted special (planned after SP-1, or stored). Deselected dates, skipped columns and uncounted specials are absent. Each service carries C5's fields (IF-C5): an opaque `id`, `date`, `month`, `kind`, `time`, `fixed`, `counts`, and `seats` when not fixed (planned: today's row targets). **`id`:** a stored service's document `_id`, **verbatim** — never rewritten, truncated or re-encoded, so a pin, an assignment and an unfilled entry map back to that document and C5's ties break as C2's ledger breaks them (C5 §5.2); every such id satisfies `isCanonicalDocumentId` (§3: the roles read never returns a `drafts.*` id), which is C5 §5.2's service-id grammar. A planned service's id is minted by the planner in the narrower `[A-Za-z0-9:._-]`, ≤ 64, and no two services of one request share an id. **`time`:** sent only when the service has one and `isServiceTime` holds for it (stored or planned); a `time` that fails it is **omitted**, never sent, repaired or refused — so C5 never refuses a request over a malformed stored `time`, and the wire's «absent» equals C2's «invalid read as absent» on both sides of the floor tie-break (C2 LG-11). | Request-builder tests, incl. a stored service whose `_id` is outside `[A-Za-z0-9:._-]` or longer than 64 (sent byte-identical, and its pins and assignments map back to its column), a stored special with `time: "7pm"` (no `time` key on the wire) and one with `"19:00"` (sent) |
| RQ-4 | **People** (C5 §5.3): `id` = member `_id`; `name` = display name; `eligibility` per RQ-2; `carried` = C2 IF2-8 `people[].window[line].balance` for each line present (IF2-1 `LineKey`), copied without rounding (IF2-1's units and sign), every `P:<ruleKey>` key rewritten to `P:` + that `ruleKey`'s minted id (RQ-5 (a)); `exempt` and the cadence setting **from each month's source** (a bound month's record, otherwise the resolver body, whose `sundayCadence` comes from C3's `cadenceMembers` over the roster C2 RES-5 hands it, C2 RES-7). `cadence` is sent for every person whose source marks `sundayCadence` in a horizon month, one entry per horizon month from **C2 IF2-12** — inputs `ledCountedSundayPreviousMonth` = the member has at least one entry of IF2-8 `countedSundayLeads` in `prior.month`, and per month `eligible` = `Sun.Lead` is `in` in that month's source and `availableCountedSundays` = the request's counted Sunday-dated services of that month on which she is eligible for Lead by RQ-2 (so a Sunday on which she is rule-excluded from `Sun.Lead` is not counted, A14) — mapped to the wire (A14, C5-5) as: reason `not_eligible` → `"out"`, otherwise the returned `state`. These states are computed **once per run, after the ledger read and before SP-1's pre-fill**, which reads them (SP-2 (a)); the same values go on the wire. Their inputs do not depend on who fills a special: a planned counted special is a request service whether or not its seats are filled (RQ-3), so it counts among `availableCountedSundays` either way (X1: a counted Sunday-dated special is a counted Sunday). `dl_since` (A15) = IF2-8 `firstRecordedIn["Sun.Lead"]` when that month is before `months[0]`, else the first horizon month whose source marks her `Sun.Lead` `in`, else `null` (a horizon month's record counts only through its source, so a recorded, unbound month whose record is about to be replaced never sets it); `prev_dl_leads` (A15) = the number of her IF2-8 `countedSundayLeads` entries in `prior.month` (each entry as IF2-8 defines it). **Horizon-wide fields.** C5 carries one `exempt` per person and requires `cadence` for every request month (C5 §5.3); a person listed in only one month's source takes that source's flags, and her cadence state in the other month is `"out"` (she is not eligible there); when a person listed in both months' sources has a different «Exenta» or «Mes por medio» in each, Auto refuses before the fetch: «{Mes1} y {Mes2} tienen distinto «{Exenta / Mes por medio}» para {persona} (uno viene del registro). Planea 1 mes.» — the standing behaviour, since C5 declined a per-month `exempt` and `cadence` (S-3, declined in C5's «Sibling changes»). People sent: everyone with an eligible role at a request service, every pin holder, every rule person. «Holgura N» is not sent (A10, Q2). | Tests incl. a cadence member out of the Sunday pool (`out`), one unavailable every Sunday (`off`), one rule-excluded from `Sun.Lead` on every available Sunday (`off`), a bound month whose record holds the cadence while the screen does not, and each disagreement refusal |
| RQ-5 | **Rules, per month, from one source.** For each horizon month, the **`==` count rules** are the month source's `exactRules` (one `count` rule per item: `op: "=="`, `roles` as stored, `value` = the stored count) and the **presence rules** are its `presence` items (`persons` = `members`, `roles`, `exclusive` copied); week exclusions and `!in` patterns reach the solver **only** as eligibility (RQ-2; A15, C5-2). Only `<=`/`>=` caps and pairs (`conflicts[]`) come from the on-screen config, for every month. For those, C6 uses C2's two neutral functions and nothing else (C2 §7.4, row C6): every `roles` list is **C2 IF2-16**'s expansion, and every `<=`/`>=` count `value` is **C2 IF2-17**'s result for that month (relative caps against that month's full Sunday count, A15, C5-4). IF2-17 answers a typed result. On `ok: true` its `count` is sent as returned — a whole number ≥ 0 that C6 never rounds, truncates or clamps; a **relative** cap whose count is 0 (its month has no more Sundays than its offset) is sent as 0 and noticed («{regla} queda en 0 en {mes} (tiene {n} domingos).»). On `ok: false` (`not_whole` or `negative`) for any cap in any horizon month, **Auto refuses before the fetch** with one line per such cap (a `not_whole` line names every horizon month whose result fails), naming the rule by its card label — never its key (§5.13) — keyed on IF2-17's `reason` union (§7.3; a reason C2 adds without copy fails `tsc`); nothing is rounded, clamped, dropped or sent as 0 in its place. An `==` cap never reaches C6 through IF2-17: its count is the month source's `exactRules` item, already a whole number from 1 to 31 (C2 RES-3 refuses anything else as `exact_count_range`, §7.9). Every person those rules name resolves through **C3's `resolveRulePersonId`** over the planner's on-screen `members` as-is, `ministries` intact (C3 §7 item 4 drops non-worship members itself) — exactly one member or Auto refuses before the fetch with RQ-2's line (A7, which closed C3's former Q-b: v3 applies the exactly-one check to every rule name it sends, never `resolveToMemberName`'s first match). **Rule ids — minted, never a key.** No config key and no `ruleKey` is ever sent as a rule id, for two reasons. A config key is not a valid v3 id by construction: `solverConfig` keys are normalised labels (`idOf` = `normalizeLabel`, `app/utils/solverConfigWriteRequest.ts:75-77`), unique only within one array (`:100-133`), while C5 requires `[A-Za-z0-9_-]{1,64}` and `(id, month)` unique across the whole request (C5 §5.4). And a key that does match C5's grammar is not name-free: the planner mints new ids opaquely (`uid()`, `plannerModel.ts:1658`, `MonthGenerator.tsx:388`), but seed-era ids spell the members' first names (`d-` ids, `app/components/admin/solverConfigDefaults.ts:53-96`, incl. every conflict at `:89-93` and the presence rule at `:96`), and production still carries that shape on its presence rule, every conflict and some restrictions and caps (private evidence, `owt-agent-logs/sdd/2026-10-05-solver-v3-fairness/prototype/config.json`); a presence `ruleKey` is that config id unchanged (C2 RES-6). C5 treats an id as opaque and echoes it in `violations[].rule` and in `stages[].id` (`balance_max:P:<id>`, C5 §7.1, stages 10…). C5-17 keeps those identifiers off C5's own logs, stdout and aggregates (stage public labels, C5 §11.2), but the response is rendered by the planner and C7 reads stage statuses for its PR text and cutover record, so a key sent as an id would be one missed rendering away from leaking names on the real run while every fictitious fixture passes. Minting closes that class: the wire carries no config key at all — more than the program's key-hygiene rule requires (it admits raw keys in authenticated payloads), never less (§5.13). So C6 mints **every** rule id it sends — `<=`/`>=` caps, `==` exact rules, pairs and presence — with one pure function of the rule's kind and its source key (the config key; a presence rule's `ruleKey`; for an `exactRules` item with no matching card, its month, member id and canonical role set) such that: (i) every id matches C5's grammar, none equals C5's reserved rule id `mandatory_lead` (C5 §5.4), and no two distinct rules of one request share an id; (ii) the same config and month sources give the same ids on every run; (iii) an id reveals nothing of its source key — no substring of a config key, `ruleKey`, member id or name, and not a bare digest of one either, since a digest of two first names is recoverable from the roster (an ordinal over the request's rules of one kind, in codepoint order of their source keys, meets all three; the plan picks). (a) A **presence** rule gets one id per `ruleKey` across the horizon, so its month-scoped objects share it (C5 §5.4); and **every** `P:<ruleKey>` key C6 copies into `carried` (RQ-4) — including a carried-only key whose rule is not in the request, which C5 accepts and reports as a carried-only line (C5 §5.3 `carried`, §8.2) — is rewritten to `P:` + the id the same function gives that `ruleKey`, so the carried key and C5's sub-line `P:<id>` still match (C2 IF2-1 `LineKey`; C5 §5.3, §8.2). (b) A **count** or **pair** rule from the screen gets the id of its kind and config key. (c) An `exactRules` item has no key, so it takes the id of the on-screen `==` cap with the same person and the same canonical role set (by A38 at most one such cap covers a role key), else its own minted id, rendered «regla fija registrada de {mes}». C6 keeps, in memory with the plan only, a map from every sent id and every rewritten `P:` key back to its rule card's label — the only way a report's rule id or presence sub-line is rendered (§7); a presence id whose `ruleKey` has no on-screen card (the rule was deleted after the record or the balance was made) renders «regla de presencia registrada». Beside that map, the solve snapshot carries the run's **rule reference table** (KH-3, §4): every sent id and every rewritten `P:` key → its kind and config ordinal, so the request can be compared with the ledger and the config **by ordinal** outside the browser (C7's rehearsal, A41) without the id → label map or any key leaving memory. The config key and the stored `ruleKey` are never rewritten; only the wire ids are minted. For a month solved from the screen, an on-screen week exclusion naming a week the month does not have is noticed («{regla} no aplica en {mes}: ese mes no tiene semana {n}.»), never refused. Presence rules are always sent **month-scoped** (C5-16): one `presence` object per `(ruleKey, month)` from that month's source, with `month` set and `id` = that `ruleKey`'s minted id (C5 §5.4: every object of an `id` carries a `month` and `(id, month)` is unique), so a bound month and a month solved from the screen may carry different members, roles or exclusivity for one rule and neither is refused; pairs come from the screen and are sent once, horizon-wide (no `month`). `consecutive` rules are never emitted (today's UI has none). | Tests incl. a 4- and a 5-Sunday month, a bound month with a stale on-screen cap, an ambiguous name on a `<=` cap in an all-bound horizon, a spy proving every `roles` list comes from C2 IF2-16 and every on-screen `<=`/`>=` count value from C2 IF2-17 (an `==` value only from the month source's `exactRules`, never IF2-17); IF2-17 `ok: false` on a `<=` or `>=` cap — a fractional fixed `value`, a fractional `relOffset` that is not clamped, a non-finite value, a fixed `-1` — each refuses before the fetch with its §7.3 line naming the card label (no fetch, nothing rounded or sent as 0), including when only the second horizon month's result fails; a relative cap clamped to 0 is sent as 0 with its notice, a 2-month horizon whose months carry different presence members (two month-scoped objects, no refusal), and rule ids: a cap key with a space or accent, a cap and a conflict sharing a key, and a cap key equal to a presence `ruleKey` each get a minted, stable, unique id; a presence rule's month-scoped objects share one id and its `carried` key is `P:` + that id; a carried-only `P:<ruleKey>` is rewritten by the same function and renders «regla de presencia registrada» when no card has that key; a **name-shaped fixture** (fictitious `d-<name>-<name>` keys on the presence rule, every conflict and a cap, as production's are shaped): the serialized request, every rendered notice and refusal line, and every `console` call made during the run contain no config key or `ruleKey` as a substring (display names may appear where §7 renders them; the keys themselves never), and the same config gives byte-identical ids on two runs |
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
| NT-3 | C6's own notices (RQ-5, ST-5, ST-6, SP-5, SP-6, SP-7, WN-*) precede the solver's, in a stable order. | Order test |
| NT-4 | Copy comes only from the table in §7, keyed on codes. A **sync test** reads C5's registry `gcf_v3/owt_v3/codes.json` and, over every group it lists — `error`, `stage`, `stage_status`, `stage_reason`, `violation`, `violation_cause`, `unfilled_reason`, `missed`, `missed_cause`, `notice`, `cadence_state`, `compensation` — fails when a code C5 can emit has no copy here, when a copy names a parameter the code does not declare, or when a code here is not in the registry. Two registry groups are never shown and are excluded by a named list in the test: `limit` (`none`/`deterministic`/`wall`), and `violation_rule` (the fixed token `mandatory_lead`, C5 §9), because a `violations[].rule` of `"mandatory_lead"` is never rendered — a mandatory-lead break is rendered from the `violation` code `mandatory_lead`'s own copy (§7.4, by `{servicio}`), never through the rule-label map (RQ-5). C6's own codes (the «C6's own» lines of §7.3, §7.6, §7.8, §7.9) are excluded by the same list. An unknown code at runtime still renders a generic line («El solver informó algo que el planificador no reconoce ({código}).»), never nothing. | Sync test; runtime fallback test |
| NT-5 | v2's «Sin optimizar», «Equidad relajada …» and «Historial …» lines never render on a v3 run. | Test |

### 5.9 The live «Equidad» panel (U5)

| ID | Requirement | Acceptance |
|---|---|---|
| EQ-1 | Under v3 the «Equidad» panel replaces `LeadPoolHistoryPanel` at all three mounts and the «Historial» block; none of the v2 history surfaces is mounted. Under v2 they render exactly as today. Deleting them is C7's, after the rollback window Frank closes (A30). | Render tests per engine |
| EQ-2 | C6 mounts and extends **C2's** preview panel (C2 UI-1–UI-7) and its formatter (C2 IF2-13); nothing C2 ships is re-implemented. The banner «Vista previa: Auto todavía no usa este saldo» shows exactly when the effective engine is v2 (C6's prop; IF2-8 `engine` is the same resolver's value, ENG-3). The panel may show IF2-8's additive `environment` where C2's panel already does (UI-6); C6 adds no second rendering of it. | Tests |
| EQ-3 | Tabs (`SegmentedControl`): «Dom Lead · Sáb Lead · BGV · Coro · Total». Every figure of a tab comes from that tab's own entry on each side, never from its lines: per person, «Le tocaba», «Tuvo» and «Saldo (3 meses)» from C2 IF2-8 `people[].tabs.window[<tab>]`, and the cumulative figure since the record began («Desde {mes}: …», X4) from IF2-8 `people[].tabs.cumulative[<tab>]`, beside the saldo; and from the last v3 solve of this horizon, `fairness.people[].tabs[<tab>]` (C5 §8.2): «En este plan» (the seats the plan gives in that tab, from the tab's integer seat count `seats`, A39) and «Queda» (the tab's `after`, computed from the **realised** share, A19 — C6 never recomputes it and never shows `planned` as a balance). «Queda» is the sent `carried` hundredths plus the plan's figures, rounded once (A32), so it may differ from «Saldo» by 0.1 at a tie even before any seat is planned; that is accepted, and no code or test asserts their equality or reconciles them. The Total tab adds «Cantó» (IF2-8 `people[].sang`). Presence sub-lines fold into BGV and every line into Total, and both folds are the emitters' (C2 LG-14, IF2-1's tab folds and IF2-8 `tabs`; C5's `tabs.BGV` and `tabs.TOTAL`, C5 §8.2), never C6's. Before any solve, in stored mode, or where C5's entry has no such tab (Total for an exempt person, C5 §8.2), the plan columns read «—». | Tests per tab, the folded BGV (a person with a `P:` sub-line) and Total included |
| EQ-4 | Each row carries one reason line composed from C2's and C5's codes (§7.7): cadence state, compensation Saturday, unavailable dates, fixed rule, pins that took a share («Los pines tomaron {n} lugares», `{n}` from the tab's integer pinned seat count `pinned_seats`, A39 — never `pinned`, which is hundredths), exempt. **Cadence state (X1) — one value, the request's.** Under v3, the cadence line of a horizon month in the live panel (C2 UI-5's X1 line on the DL tab, and §7.7's «Mes por medio: …» reason) renders, once a v3 run of this horizon has computed RQ-4's cadence states, **exactly those values** — IF2-12's output with its reason, computed once per run after the ledger read and before SP-1, the same value sent as `people[].cadence` — through C2 §8's X1 copy keyed on the IF2-12 reason (C6 adds no X1 copy). It never calls IF2-12 a second time with other inputs, never shows C2 UI-5's display-only inputs (one default weekend service per unstored Sunday) for a month the run computed, and never adds C5's echoed `cadence[].state` as a second line. Before any v3 run of this horizon, or after the first month or the length changes, the panel shows C2 UI-5's «previsto» line as C2 defines it. One X1 line per person and month, never two. | Tests per reason; X1: after a run whose RQ-4 state differs from what UI-5's approximation would give (a Sunday with no stored service that the planner skipped, so it is not a request service), the panel shows RQ-4's state and reason, equal to the request's `cadence` entry; before a run, UI-5's line; one line per month |
| EQ-5 | Numbers (A17): **C2 IF2-13 is the only implementation** — every share and balance is shown with one decimal through it, the saldo always in words, and its input is always tenths, never hundredths (IF2-13; C2 UI-4's grep guard covers C6's code too). Ledger figures use IF2-8 `Figures.tenths` of the tab's entry (`tabs.window[<tab>]`, `tabs.cumulative[<tab>]`). Seat counts are integers taken as emitted, each from one named field: «Tuvo» renders IF2-8 `Figures.seats` and «Cantó» IF2-8 `people[].sang` (UI-4 — never `received`, which is hundredths); «En este plan» renders the integer seat count C5 carries per person, line and **tab** (A39: `seats` beside `received`, and `pinned_seats` beside `pinned`, C5 §8.2) — never C5's `received` or `pinned` (hundredths, C5 §8.2). **No C6 code divides a wire figure**, the GET's or C5's. «Queda» renders C5's `fairness.people[].tabs[<tab>].tenths.after`, rounded once by C5 from the exact summed value (C5-8, C5 §8.2); it is never derived from the wire hundredths, and never from `lines[*]`, whose figures no tab may be summed from (C5 §8.2). Nothing in the panel rounds, sums, divides or formats a number itself, and no displayed figure feeds a computation. | C2's formatter tests; the grep guard; tests that «Tuvo» renders IF2-8 `Figures.seats` (a `received` of 300 shows «3»), «Cantó» renders `sang`, «En este plan» renders only the tab's `seats`, the pins reason only the tab's `pinned_seats`, and «Queda» only C5's `tabs[<tab>].tenths.after` — including a BGV tab whose person also has a `P:` sub-line and a Total tab, where the tab's figure differs from any single line's; a fixture where «Queda» before any planned seat differs from «Saldo» by 0.1 renders both as emitted (A32) |
| EQ-6 | Phone: one card per person (`Collapse` for the detail); no page-level horizontal scroll. | Phone-width render test |
| EQ-7 | The panel shows the ledger's own diagnostics (C2 IF2-8 `diagnostics`, and each person's IF2-9 notes through C2's panel) where v2 showed the derived-history diagnostics. | Test |

### 5.10 Warnings and wiring of other children's controls

| ID | Requirement | Acceptance |
|---|---|---|
| WN-1 | **C3's «Mes por medio fuera de Líderes Domingo» warning** (C3 §6.7: its predicate and its two sentences, exported as constants, C3 §7 item 5) applies only to a month solved from the screen: a bound month's cadence setting and eligibility are the record's. Its gate (C3 §7 item 6) is **open** exactly when the effective engine is v3 (A9) **and at least one horizon month is not bound**; it is closed under v2 and when every horizon month is bound. Each month's state is the latest fairness GET's for the horizon (§4, IF2-8 `recordBinds`); while no read has answered, every horizon month counts as not bound, so the warning errs toward showing. **Mixed horizon.** The predicate reads the on-screen config only, so its list is the same for every unbound month; C6 therefore names, on each rendered line, the months it applies to — the horizon months that are not bound («{Mes}» / «{Mes1} y {Mes2}») — as a C6-owned prefix or heading suffix beside C3's sentence, which is rendered **unchanged** (C3 is approved; its «este mes» then reads against the named month). The lines are rendered once in the config step and repeated among Auto's notices with the same month naming; where C3's panel renders them behind its boolean gate, the plan either hands that rendering the month names or keeps C3's gate closed and renders the lines itself from C3's exports — one rendering, never two. C6 writes no second copy of either sentence and never changes C3's predicate. | Render tests per engine; a 2-month horizon with one bound month: the gate is open and every line names only the unbound month; every month bound: closed; no read yet: open, naming both months; a 1-month horizon names its month; a test that C3's two sentence constants appear verbatim |
| WN-2 | **Cadence refusals.** Under v3, Auto refuses before any read when C3's `cadenceMembers` — called over the planner's on-screen `members` as-is, `ministries` intact (C3 §7 item 4 filters by ministry inside; C3 E25) — reports a refusal: «No se puede correr Auto: «Mes por medio» de «{persona}» no corresponde a una sola persona ({motivo}). Corrige el nombre en la regla.» (`{motivo}`: «no coincide con nadie» / «coincide con {n} personas»), and when a person carries the cadence and also an exact count covering `Sun.Lead` (A11): «No se puede correr Auto: {persona} tiene «Mes por medio» y además un número fijo de Dom Lead («{regla}»). Quita una de las dos.» The same pair is refused by C2's resolver (`cadence_and_exact`, RES-7) for a month solved from the screen and by C2's validator (WR-4) for any record, so a bound record never carries it; C6 checks the on-screen config before any read so the admin sees it first. | Tests, incl. a **super-admin roster with a kids-only namesake** of a «Mes por medio» person (`ministries: ["kids"]`, passed intact): WN-2 does not refuse and the cadence resolves to the worship member |
| WN-3 | Under v3, a non-empty «Líderes Sábado» pool gets: «Con el nuevo solver, «Líderes Sábado» ya no aparta un líder para cada sábado: quien esté solo ahí dirige únicamente sábados.» (D9.) Non-blocking, shown in the config step and repeated among Auto's notices. | Test |
| CTL-1 | C6 routes its effective-engine prop to the engine-dependent surfaces it wires: **C1's** «Cuenta para equidad: aplica con el nuevo solver…» note, which reads `SOLVER_ENGINE` until C6 and is rewired to the prop (hidden when it says v3); **C3's** «Mes por medio» card chip note — exactly what C3 exports for this purpose, the constant `CADENCE_V2_NOTE` («aplica con el nuevo solver», C3 §6.6, §7 item 5), which C3 renders **unconditionally** and never gates on any engine (C3 §6.6, §8) — C6 adds the gate, shown only when the prop says v2 (U7); **C3's** warning gate input (WN-1); C2's preview banner (EQ-2). C6 gates nothing C3 does not export. In particular, C3's form help for «Mes por medio» ends in a fixed inline sentence, «Aplica con el nuevo solver; el solver actual no lo usa.» (C3 §6.6), which is not an exported constant: C6 leaves it as C3 renders it under both engines (so on a Preview deployment with the override it shows while the engine is v3 — accepted, Preview only), and **C7 removes that sentence in its flip** (C7 Step 5, which applied S-15; C3 is approved and not edited). C2's «Registrar elegibilidad de {mes}» stays gated by C2 on its GET's `engine` (UI-6) — the same resolver, so C6 adds no second gate there. C3's «no aplica con el nuevo solver» on «Holgura» stays under both engines. | Render tests per engine for each surface C6 gates (the card chip's `CADENCE_V2_NOTE` absent under v3, present under v2) |
| CTL-2 | **«Holgura»/«Exenta» in the specials filler under v3 (C3 P4).** Uncounted specials keep today's filler, including its Exenta (median) and Holgura (load + N) ordering. Counted specials are ranked by SP-2 (protection tier, then balance), where neither applies; «Exenta» still counts in every role line (D13). | Ranking tests |

### 5.11 Confirm protocol (U4) — **CRITICAL SLICE**

> **Critical.** This section changes when and in what order a production writer's records and the
> service drafts are written, and how partial failure is recovered. Its implementation plan goes
> through the adversarial plan-review loop: **two sequential fresh `APPROVED` verdicts on
> byte-identical text**, churn cap binding (CLAUDE.md). A reviewer may scope a round to this section
> plus C2 IF2-4–IF2-6 (the PUT) and IF2-19 (the hash) alone; everything else in this spec is standard tier.

Applies only when the effective engine is v3. Under v2 the confirm is byte-identical to today (no
record, same buttons, same messages).

| ID | Requirement | Acceptance |
|---|---|---|
| CF-1 | **What is written.** A confirm writes (a) one record entry for **every** horizon month, in the shape its state calls for (CF-3) — a bound month's `unchanged` entry, a recorded, unbound month's replace (A6), and a **create for every month with no record, anchored or not, whether or not this confirm gives it a draft** (A27); then (b) the drafts. **If any horizon month is before the current CDMX month as the client computes it at confirm (A40; a past month's record is the reconstruction's, L3), the confirm refuses before writing anything** — no PUT, no draft — so no v3-drafted month is ever left without its record. The same placement refuses a month past WR-4's ceiling with HZ-9's line. This check runs on **every** attempt, «Reintentar» included (CF-7), and the entry set is never shrunk to drop the past month. The refusal offers no «Reintentar» (a retry cannot un-pass a month) and its line is §7.8's past line: «{Mes} ya pasó mientras planeabas. No se creó ningún servicio; vuelve a correr Auto.» when no draft of this confirm has been created, and, on a retry after earlier attempts of this confirm created drafts, «{Mes} ya pasó mientras planeabas, así que no se creó nada más. Lo ya creado se queda; completa lo que falta en «Editar mes».», beside CF-6's per-month lines — the admin is never told that nothing was created when an earlier attempt of this confirm created drafts. Nothing else is written: never a stored service, never a delete. A month's state is the snapshot's: a month that gains a stored service after the run's read is still sent as its snapshot says, and the writer's own checks decide (C2 WR-7/WR-8, IF2-21). For a month **recorded** at the read that is C2's stated residual window (WR-8 row 7 refuses a replace with `month_has_services`); for a month **unrecorded** at the read the create is accepted either way (row 3, A27), which is the intended outcome, not a window. | Tests incl. a fixed clock on either side of a month boundary (crossing it refuses with nothing written, A40); a «Reintentar» after the boundary (records landed, month 1 partly drafted) refuses too, sends no PUT and no POST, offers no «Reintentar» and shows the «nada más» line; an anchored, unrecorded month gets its drafts and a create entry; a recordless month that gets no draft from this confirm still gets a create entry |
| CF-2 | **Record body frozen.** Each month's PUT entry (a C2 IF2-4 `FairnessMonthWrite`) is frozen when the run's request is built, from that month's solve snapshot (its source, its state and the record `rev` read with it, RQ-1, RQ-2); if no v3 Auto ran for this horizon in this session, the states and the bound months' sources come from a fresh `GET /api/admin/fairness` for the horizon at the first confirm attempt, every other month's from C2 IF2-15 over the on-screen config and `members` (RQ-2), and the entries are frozen then; a failed read or an `ok: false` resolver creates nothing. Every retry sends each month's entry byte-identical; the set of entries never changes (a month that has become past refuses the confirm, CF-1, A40). Drafts are taken from the board at confirm. | Test: edit pools after Auto, confirm — the record is the solved one; retry body equals the first |
| CF-3 | **Entries, as C2 IF2-4 entries, one shape per state (§4).** Every entry asserts the revision read with the eligibility it carries (C2 WR-15), never one re-read before the PUT. **Bound:** the IF2-8 `horizon[].record` (IF2-3) logical content — `people` with `name` removed from every item (IF2-4 carries no names, WR-3), `presence` as read — with `expectedRev` = that record's `rev` and `source: "auto"`. Because the content hash excludes every stamp, `source` included (C2 REC-6, IF2-19), the decision is `unchanged`; if the record changed since the read, it is `stale_revision`/`record_missing`. **Recorded, unbound (A6):** the frozen resolver `body` with `expectedRev` = the record's `rev` as read and `source: "auto"` (`"manual"` on CF-2's no-Auto path), expecting `replaced` — or `unchanged` when the body equals the record or on a replay. **Unrecorded, anchored or not (A27):** the frozen resolver `body` with `expectedRev: null` and the same `source` rule, expecting `created`, or `unchanged` on a replay; for an anchored month the record so created is frozen at once (A5) and binds every later solve of it (A6), which ST-8's banner told the admin before the confirm. | Tests per shape; a **round-trip test** (critical slice): a GET logical record turned into a PUT entry hashes, by C2 IF2-19 `contentHashOfWrite`, to the record's own `contentHash` (the test's only use of IF2-19; no C6 runtime code imports the write-request module) |
| CF-4 | **Records first, atomically.** All entries go in **one** `PUT /api/admin/fairness/months` (C2 IF2-4; all-or-nothing, WR-9); with a single entry the PUT carries that month alone. The confirm proceeds to drafts **only** on an IF2-5 200 whose `months[]` has every sent month with an outcome its shape expects (CF-3: bound → `unchanged`; recorded, unbound → `replaced` or `unchanged`; unrecorded, anchored or not → `created` or `unchanged`); any other outcome is treated as «other failure». Any refusal or unknown outcome ⇒ **no draft of any month is created**, the dialog stays open, and the message is chosen by IF2-5's `details.detail` (an IF2-6 code; §7.8 maps each one, keyed on IF2-6's union so a new code fails `tsc`): `record_exists`, `stale_revision`, `record_missing`, `month_has_services` (a recorded, unbound month that gained a stored service; a create is never refused with it, A27) → conflict, re-run Auto; `past_month` (the server's clock is past a month boundary the client's has not reached; the PUT is the confirm's first write and atomic, so nothing exists from this confirm) → §7.8's past line, re-run Auto, **no «Reintentar»** (once the client's clock crosses too, CF-1 refuses every attempt); `engine_not_v3` → reload; `member_unknown`, `member_not_worship`, `tipo_mismatch` → the team changed, re-run Auto (only a written month can get these: C2 WR-5 never refuses an `unchanged` one); a 400 (IF2-6 `invalid_body` included), a network error, a 5xx or an unparseable body → «Reintentar». | Tests per `details.detail` and per unexpected outcome (incl. `replaced` for a bound month and `created` for a recorded one); spy: zero draft POSTs |
| CF-5 | **Drafts oldest first, month by month.** Drafts are posted in date order with their stable `creationRequestId`s (today's per-draft mechanism, unchanged). Within a month every draft is attempted; the next month starts **only if every creatable draft of the earlier months was created**. | Tests: a failure in month 1 ⇒ zero POSTs for month 2 |
| CF-6 | **Per-month report; nothing deleted.** On any failure the dialog stays open with one line per month (§7.8). No record or draft is deleted or rewritten to compensate. Only confirmed successes become `exists`/created-this-session (today's invariants, including the paired `drafts` identity change that the drag gate's cache depends on). | Tests |
| CF-7 | **«Reintentar» resends only what is missing**: the frozen record request again only if it has not succeeded, then only the drafts not yet created, in the same order and with the same ids. A replay of a PUT that did land is a success by C2's decision order: an identical `contentHash` on an intact record is `unchanged` **before** the past-month, `record_exists` and revision checks (WR-8 row 1, IF2-21), so every resent shape — unrecorded (`expectedRev: null`), recorded-unbound (the pre-replace `rev`) and bound — answers `unchanged`. That holds for a replay sent **before** the client's month boundary; after it, the attempt is refused by CF-1 and sends nothing. It never re-solves. | Tests: lost-response replay of each shape before the boundary, mid-month failure, month-2-only failure; a retry after the boundary is CF-1's test, not a replay |
| CF-8 | **No publish in a 2-month confirm.** With horizon 2 only «Crear {n} borradores» exists (the publish button is absent, not disabled), with «{Mes1}: {a} · {Mes2}: {b}. Se crean como borradores; publícalos después.». With horizon 1, «Crear y publicar» stays and posts as today after the record step. | Render tests |
| CF-9 | **History dual-write (Q4).** After the drafts, one `localStorage` history entry is appended **per month** with at least one weekend draft created this session, each built from that month's created weekend drafts exactly as today (specials excluded, union across this session's confirms). Removed only when the ADR-0042 dual-write is retired on its own. | Tests: two entries for a 2-month confirm, none for a specials-only month |
| CF-10 | **Closing with gaps** after a partial failure opens a `CueDialog` «El plan quedó incompleto» — «{Mes}: faltan {n} servicios. Si sales, se quedan así; puedes completarlos en «Editar mes».» — with «Salir así» and «Seguir aquí». Full success closes as today. | Test |
| CF-11 | **Client-mutation invariant** for the record call and the draft calls: try/catch/finally, check `res.ok`, reset the pending flag, never close as success on failure. | Tests incl. a thrown fetch |

**Failure table (U4).**

| Moment | What exists afterwards | What the admin sees | Recovery |
|---|---|---|---|
| Record PUT 409 `record_exists` / `stale_revision` / `record_missing` / `month_has_services` | Nothing new | §7.8 conflict line | Re-run Auto; the fresh read gives the month its current state (§4) |
| Record PUT 409 `past_month` (client/server clocks straddle a month boundary) | Nothing new | §7.8 past line («No se creó ningún servicio»), no «Reintentar» | Re-run Auto: once the client's clock has crossed too, HZ-7 refuses a horizon that contains the past month, so the admin plans the remaining month alone and creates the past month's services by hand (HZ-7's copy) |
| Any attempt, «Reintentar» included, after the client's clock has crossed a month boundary (CF-1, A40) | Whatever earlier attempts of this confirm created (records; possibly some drafts); nothing new | §7.8 past line («nada más» when drafts were created), CF-6's per-month lines, no «Reintentar» | As the row above; a month left incomplete is completed in «Editar mes» (CF-10) |
| Any attempt whose horizon holds a month past WR-4's ceiling (CF-1, HZ-9) | Nothing new from this attempt | HZ-9's line, no «Reintentar» | Change the horizon and re-run Auto |
| Record PUT 409 `engine_not_v3` (C2 WR-6) | Nothing new | §7.8 reload line | Reload |
| Record PUT 409 `member_unknown` / `member_not_worship` / `tipo_mismatch` | Nothing new | §7.8 team line | Re-run Auto (a month solved from the screen re-resolves); a bound month is never refused here — it is decided `unchanged` and C2 runs these checks only on written months (WR-5) |
| Record PUT 200 with an outcome its shape does not expect | Possibly a rewritten record | «No se pudo registrar…» | «Reintentar» answers `unchanged` if the content landed; the round-trip test (CF-3) guards the bound shape |
| Record PUT network/5xx/unknown | Maybe the records | «No se pudo registrar…» | «Reintentar» (replay-safe) |
| Records ok; month 1 partially fails | Records; some month-1 drafts | Per-month lines; month 2 «no se intentó» | «Reintentar» |
| Records ok; month 1 ok; month 2 partially fails | Records; month 1; part of month 2 | Per-month lines | «Reintentar» |
| Records ok; every draft fails; admin leaves | Records only | CF-10 dialog | Next Auto: a month that had no stored services before this confirm is now recorded, unbound — the screen drives and the confirm replaces the record under its `rev` (A6); a month that was anchored already is now bound by the record this confirm created (A27, A5, A6) |
| Draft 409 (target taken meanwhile) | As above | Today's «Alguien más cambió esas fechas: recarga y revisa.» on that month's line | Reload |

### 5.12 Documentation in the same delivery

| ID | Requirement | Acceptance |
|---|---|---|
| DOC-1 | `docs/SECRETS.md` entry for `OWT_SOLVER_V3_URL` (non-secret config, introduced by this child): platforms that need it and those that do not, purpose, source, how to change it, blast radius — never a value. Needed on Vercel Preview first and Production at C7; not `.env.local` (the local entry point serves instead), CI or iOS. Source `gcloud functions describe owt-solver-v3 --gen2 --region=us-central1 --format='value(serviceConfig.uri)'` (C5 §11.5). Unset on a deployment ⇒ v3 Auto answers `not_configured`; a change needs a redeploy. C6 writes the entry and sets the variable nowhere: **setting it on Vercel Preview is C7's consented write** (C7 W0, Step 2a, value piped from C5's describe output), as is Production (C7 W4), and C7 updates the entry's status line when each lands. `OWT_SOLVER_ENGINE`'s entry is C2's (EN-3) and C6 writes no second one; the API key's amendment is C5's (§11.6). | Docs review |
| DOC-2 | New ADRs (A31: C6 writes those for the behaviour it introduces), numbered when they reach `main`: the engine switch as C6 completes it (A1: C1's constant, C2's resolver honouring the override on the `preview` branch deployment or locally, the solve route's 409, the server-resolved prop); the 1–2-month horizon with stored services and counted specials as fixed services. Amendments to existing ADRs — ADR-0010 Decision 1 for counted specials included — are C7's (A31), because they describe production behaviour, which changes at the flip; C6's ADR names the one it will need. | Review |
| DOC-3 | CLAUDE.md names `SOLVER_ENGINE` beside the two existing switches (unless C2's GU-4 already did — one line, never two), and the two-parsers rule (U8). | Review |

### 5.13 Key hygiene (the program rule, as C6 applies it)

| ID | Requirement | Acceptance |
|---|---|---|
| KH-1 | **Rule keys are private identifiers.** Every `solverConfig` restriction, cap, conflict and presence `id`/`_key`, every `ruleKey` and every `P:<ruleKey>` line key may spell members' first names: production's conflict and presence keys and some restriction and cap keys are seed-era strings (§3; `app/components/admin/solverConfigDefaults.ts:53-96`; private evidence), and only planner-minted `uid()` keys are opaque. In C6 such a key lives only in the on-screen config, the fairness GET and resolver payloads, the in-memory id → label map (RQ-5) and the authenticated admin UI's own state. **No C6 code renders, logs (`console.*` in the browser, any server log), toasts, reports as telemetry or copies one** — nor a minted id's source key, nor the id → label map. The one rendered id map is KH-3's rule reference table, which holds minted ids, kinds and config ordinals only and is name-free by construction; the id → label map and every source key stay in memory. Every user-facing line names a rule by its card label (§7; the admin UI already shows member names). Wherever C6 must identify a rule outside the authenticated UI — a test name, an assertion message, a doc or PR C6 writes, output of C6's builder that C7's rehearsal prints — it uses the rule's kind and its ordinal in its config array, **never the raw key and never a hash of it** (an unsalted hash of a short seed key is reversible by a dictionary of first names; C2 §6 «Key hygiene» asks its consumers not to use that arm). C6 never re-keys production config. | The name-shaped fixture of RQ-5 run through the request builder, every notice and refusal renderer and the confirm path: no config key or `ruleKey` in any rendered line, `console` call or thrown error message; a grep guard over C6's new modules: no `console.*` call takes a request, response, config or rule key |
| KH-2 | **The solve route logs no content.** For a v3 request the route (RT-1–RT-6) never logs a request or response body or any part of one — service, member or rule ids, `P:` line keys, stage ids such as `balance_max:P:<id>`, names — only the engine, the outcome class (`transport` reason or the coded failure's `code`), the HTTP status and timings. v2's path is unchanged (RT-2). | Route test with a name-shaped request and a stubbed upstream answering success, a coded failure and each transport reason: no log line contains a request identifier |
| KH-3 | **Rule reference table (for comparison by ordinal, A41).** Every v3 run's solve snapshot (§4) carries one entry per rule id the request sends and per `P:` key RQ-4 rewrites: the id (or `P:` + id), the rule's kind (`count`, `pair`, `presence`) and its **config ordinal** (§4) — `restrictions[i].caps[j]` for a cap of either source (an `exactRules` item matched to its card, RQ-5 (c), takes that card's), `conflicts[i]` for a pair, `presence[i]` for a presence rule. A rule with no on-screen card gets no config ordinal and says why: an `exactRules` item with no matching card carries its month, its member id and its canonical role set (all already on the wire); a presence id or carried-only `P:` key whose `ruleKey` has no card carries «sin tarjeta» and its position, in codepoint order, among the distinct `ruleKey`s anywhere in the run's fairness GET body — its `window` `P:` keys and every `horizon[].record.presence[].ruleKey` — (an index, total for every such key, which a holder of the captured GET can recompute privately). No entry carries a config key, a `ruleKey`, a name, a label or a hash of any of them. The table is kept with the plan, beside the snapshot the confirm freezes (CF-2), and is re-made only by the next Auto; the confirm never sends it, and is **readable by the admin** under v3 after a run in the authenticated planner — one copyable, name-free text block headed by the run's `request_id`, so a capture pairs it with the request body; the plan picks the control (e.g. inside NT-1's «Ver etapas»). C6 never sends, logs or stores it anywhere else. With it, a holder of the private config snapshot the run read joins each wire id to its rule by ordinal, and the GET's `P:<ruleKey>` lines to the request's `P:<id>` lines, with no key leaving a private file. | Name-shaped fixture: the table has one entry per sent id and per rewritten `P:` key, each ordinal equal to the rule's index in the fixture config (incl. a cap at `restrictions[1].caps[2]`, a conflict and the presence rule); no config key, `ruleKey`, name, label or hex digest of one appears in it as a substring; a deleted-card carried-only `P:` key reads «sin tarjeta» with its GET index; an unmatched `exactRules` item carries month, member id and role set; byte-identical table on two runs of one config; after deleting an earlier restriction, the next run's table shows the shifted ordinals |

## 6. Interfaces

**C2's interfaces are cited, never copied.** C2 §7 is the single source of every interface C2
provides, each under a stable ID (`IF2-1` … `IF2-29`); IF-C2 below names the IDs C6 consumes and
states only C6's own use and obligations. If an IF2 item changes, C6 is unaffected unless its own
use changes; a C6 sentence that disagrees with an IF2 item on a shape is a defect in C6.

Every other sibling's shape below is **copied from that child's spec as read on 2026-10-05** (C1,
C3 §7, C5 §5/§8/§9 and its «Interfaces»), with the parent's amendments applied where a sibling's
text had not yet absorbed them (A1 ownership, A17 display, A39 the integer seat counts). If such a
sibling's approved text changes, this section is updated in the same review cycle, and a mismatch
is a defect in C6, not a licence to reinterpret.

### IF-C1 — consumed from C1 (`countsForFairness`)

(C1 §5.1–§5.2 and §5.6 for the field, the read rule and the roles read; §6.6 for the note; §7 row «Engine module» and C1-R11 for the constant's pin; §9 for the interface table.)

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

C2 §7.4's row «C6» is C2's statement of C6's obligations; this table is C6's use of each item.
Every shape, field list, signature and code list is the cited item's; none is restated here.

| C2 item | C6's use (its own obligation) | C6 rows |
|---|---|---|
| IF2-1 (vocabulary: `RoleKey` and canonical order, `LineKey`, `TabKey`, `Status`, units and sign) | Types every role key, line and tab C6 handles; `carried` keys are IF2-1 `LineKey`s; a presence sub-line `P:<ruleKey>` is read by its `ruleKey` and sent as `P:` + that `ruleKey`'s minted id (RQ-5 (a)), never with the `ruleKey` itself | RQ-4, RQ-5, EQ-3 |
| IF2-3 (`LogicalRecord`) | A bound month's source, read from IF2-8 `horizon[].record`; turned into a CF-3 bound entry by removing `name` from every `people` item | RQ-2, CF-3 |
| IF2-4 (PUT request) | The one confirm PUT; C6 sends only CF-3's three entry shapes, asserting the `rev` it read (WR-15) — a replace only for a recorded, unbound month, a create (`expectedRev: null`) for every recordless month, anchored or not (A27) | CF-1–CF-4, CF-7 |
| IF2-5 (PUT responses) | Proceeds to drafts only on a 200 whose every month carries an outcome CF-3 expects; otherwise branches on `details.detail` | CF-4 |
| IF2-6 (write refusal codes) | One §7.8 line per code the route can answer, keyed on IF2-6's union (exhaustive at compile time); `invalid_body` reaches C6 only as a 400 | CF-4, §7.8 |
| IF2-7 (GET request, gate, failure body) | One fresh read per Auto (and per no-Auto first confirm), `month` = the horizon's first month, `horizon` = its length, 20 s abort; anything but a 200 refuses | RQ-1, CF-2 |
| IF2-8 (`FairnessLedgerResponse`, `Figures`) | `engine` (banner, ENG-3); `horizon[].record`, `.storedServices`, `.recordBinds` (each month's state, §4 — never re-derived); `people[].window[line].balance` (`carried`); `countedSundayLeads`, `firstRecordedIn` (RQ-4's cadence inputs, `dl_since`, `prev_dl_leads`); `tabs`, `Figures.tenths`, `Figures.seats`, `sang` (panel); `diagnostics` (EQ-7). The additive `environment` is C2's panel's to show (UI-6); C6 reads nothing from it. C6 never substitutes zeros for a figure and never builds `prior` from this body (RQ-7) | §4, RQ-1, RQ-2, RQ-4, SP-2, EQ-2, EQ-3, EQ-5, EQ-7 |
| IF2-9 (`Note`) | Rendered only through C2's panel | EQ-7 |
| IF2-12 (`cadenceStates`) | C6 supplies its inputs from IF2-8 and the request (RQ-4) and maps its output to C5's wire (A14): `not_eligible` → `"out"`, otherwise `state`; the same output, computed once before the pre-fill, ranks the counted specials' Lead (SP-2) | RQ-4, SP-2 |
| IF2-13 (display formatter) | The only formatter of every share and balance C6 shows, always from tenths | EQ-5 |
| IF2-14 (effective-engine resolver) | Imported by `/admin`'s page and the solve route only; never a second resolver, never a client import | ENG-1–ENG-4, RT-1 |
| IF2-15 (`resolveMonthEligibility`) | The source of every month that is not bound and of the confirm body for it, called with the on-screen config and the planner's on-screen `members` **as-is** (any superset carrying `ministries`; RES-5 filters inside); every `ok: false` refuses Auto before the fetch with §7.9's lines; its `ok: true` body is confirmed unvalidated (RES-8, which holds for the months WR-4 accepts; HZ-9 keeps every horizon month inside that ceiling) | RQ-2, RQ-5, CF-2, CF-3, HZ-9 |
| IF2-16 (`rolesOfPatternV3`), IF2-17 (`capValueForMonth`) | The only expansion and the only count resolution behind every `<=`/`>=` cap and pair C6 sends from the screen | RQ-5 |
| IF2-19 (`contentHashOfWrite`) | CF-3's round-trip test only; no C6 runtime module imports the write-request module (it hashes with `node:crypto`) | CF-3 |
| IF2-11 (`keepVoiceSeats`), with IF2-10 `LedgerService` as its input shape | ST-6's test only: for a counted stored service (mapped to an IF2-10 `LedgerService`), the seat C6 sends equals the one IF2-11 keeps (C2 LG-4's rule) | ST-6 |

Behaviour C6 relies on without restating: the PUT's decision order (C2 WR-8, IF2-21), all-or-nothing
(WR-9), the live-member checks only on written months (WR-5), the asserted revision (WR-15), the
resolver's output invariant (RES-8, A38), the GET failing closed (RD-2, A2). C2's preview panel and
«Registrar» (UI-1–UI-7) are mounted and extended (EQ-1–EQ-5), and «Registrar» stays gated by C2 on
IF2-8 `engine` (UI-6).

### IF-C3 — consumed from C3 (cadence setting)

(C3 §6.6–§6.7 and §7.)

- `PersonRestriction.sundayCadence?: "alternate"` (absent = «Normal»; never stored otherwise), keyed
  by person name; v2's whole request is unaffected by it (C3's v2-view guarantee).
- Neutral module `app/utils/sundayCadence.ts`: `type RosterMember = { _id: string; member_name:
  string; alias?: string; memberType?: string[]; ministries?: unknown }` (`ministries` is the stored
  value as read; absent or empty means worship); `cadenceMembers(config, roster) → { ids, refusals }`
  (refusal reasons `"unresolved" | "ambiguous"`), `cadenceOutsideSundayPool(config, roster)` (reasons
  `"not_ticked" | "no_sunday_lead_tipo"`), `resolveRulePersonId(person, roster) → { ok: true; id } |
  { ok: false; reason: "unresolved" | "ambiguous"; matches }`, and the copy constants
  `CADENCE_V2_NOTE`, `SLACK_V3_NOTE` and the two warning sentences. All three functions first drop
  every member whose `normalizeMinistries(m.ministries)` lacks `"worship"` (C3 §7 item 4), so
  `roster` may be any superset of the worship roster that carries `ministries`.
- **C6's caller obligation (C3 §7, «Every caller»).** C6 passes the planner's on-screen `members`
  — the list `GET /api/admin/members` returns, worship-only for a worship admin and everyone,
  kids-only included, for a super-admin (C3 E25) — **as-is, `ministries` intact**, to C3's functions
  and to C2 IF2-15; it never filters by ministry and never strips the field (C3 widens the planner's
  `MemberOption` types to carry it, C3 §5). C6 refuses on any on-screen `cadenceMembers` refusal
  (WN-2); a month solved from the screen gets its cadence members through C2's resolver, which uses
  `cadenceMembers` (RQ-4); every `<=`/`>=` cap and pair person C6 sends resolves through
  `resolveRulePersonId` (RQ-5, A7 — C3's Q-b answered «yes»). Tests (RQ-2, WN-2): a super-admin
  roster with a kids-only namesake of a rule person refuses neither.
- C3 renders `CADENCE_V2_NOTE` unconditionally and never imports `SOLVER_ENGINE` (C3 §5 non-goals,
  §6.6). The warning's gate is an explicit boolean input on the config panel, default closed; C6
  opens it from its effective-engine prop and the horizon months' states (WN-1: v3 and at least one
  month not bound) and adds the v2-only gate on `CADENCE_V2_NOTE`, the card chip's note (CTL-1).
  The form help's inline sentence «Aplica con el nuevo solver; el solver actual no lo usa.» is not
  exported, is not gated by C6, and is removed by C7 at the flip (CTL-1; C7 Step 5).
- C3 leaves to C6: the cadence + exact-`Sun.Lead` conflict (refused, A11, WN-2) and whether the
  specials filler keeps «Holgura» under v3 (A10: it does for uncounted specials, CTL-2).

### IF-C5 — consumed from C5 (solver v3, `contract: 3`)

- **Endpoint.** `owt-solver-v3`; URL in `OWT_SOLVER_V3_URL`; `X-Api-Key` = `OWT_SOLVER_API_KEY`
  (C5-14). **Local entry:** `python gcf_v3/owt_solver_v3.py --json-mode` from the repo root, one
  request on stdin, one response on stdout, exit 0 including for `ok: false` (C5 §11.1).
- **Request (C5 §5, built by C6):** `contract: 3`, `seed` (0–2147483647), `request_id?`, `months`
  (1–2 consecutive, ascending), `budget?` (omitted in production);
  `services[]{ id, date, month, kind: "sunday"|"saturday"|"special", time?, fixed, counts, seats?:
  { Lead, BGV, Choir } }` (1–40; `id` per C5 §5.2: 1–200 chars, no whitespace, not starting with
  `drafts.` — `isCanonicalDocumentId`'s grammar, so a stored service's `_id` is sent verbatim, and a
  planned id minted in `[A-Za-z0-9:._-]`, ≤ 64, is a subset of it, RQ-3; `time` `"HH:mm"`, sent only when `isServiceTime` holds; a `special` is `fixed` and `counts`; `seats` required when not
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
  lines{ <line>: { carried, planned, share, received, seats, pinned, pinned_seats, set_aside, after, in_stage, clamped } },
  tabs{ DL?, SL?, BGV?, CORO?, TOTAL?: { carried, share, received, seats, pinned, pinned_seats, after, tenths: { share, after } } } } }` (hundredths, `received` = 100 × seats; `seats` and `pinned_seats` are the integer seat counts of `received` and `pinned`, per line and tab, which A39 adds (C5 §8.2) and the panel renders as emitted; `after` from the realised `share`, A19, C5-7; per line `tenths: { share, after }`, each rounded once from the exact value, C5-8, C5 §8.2; `tabs` are the five display tabs in C2 LG-14's folds — BGV is the `BGV` line plus every `P:` sub-line, Total every line — each figure rounded once from the exact sum of its lines, never a sum of their hundredths or tenths, `TOTAL` absent for an exempt person, C5 §8.2; the panel's plan columns read only `tabs` (EQ-3, EQ-5): «En este plan» from `seats`, the pins reason from `pinned_seats`, «Queda» from `tenths.after`), `cadence[]{ person, month, state, sundays, saturdays, met, compensation }`, `missed[]{ code,
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
- The Auto-confirm call to C2's PUT (C2 IF2-4, CF-3/CF-4); the request to C5 in C5's shape.
- The v3 request builder as one **pure, neutral** function (planner state, the ledger GET, the roles
  read and the clock in; the request and C6's own notices and refusals out — no React, no `fetch`), so
  its unit tests and C7's Preview rehearsal (A23: solve without confirm) exercise the same code.
- To C7: the constant to flip; the v2 history surfaces unmounted under v3 (deletion is C7's); the
  docs of §5.12; each run's rule reference table (KH-3: wire id → kind and config ordinal, keyed by
  `request_id`, name-free), so the rehearsal compares captured requests with the ledger by ordinal.

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
| `cadence_off_led` | person, month | «{persona} dirigió domingo en {mes}, su mes sin domingo («Mes por medio»).» (copy amended 2026-10-07, see §7.7) |
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

C6's own (not in C5's registry): «{regla} queda en 0 en {mes} (tiene {n} domingos).» (a relative cap whose IF2-17 count is 0, RQ-5); the IF2-17 refusals of an on-screen `<=`/`>=` cap (RQ-5), keyed on IF2-17's `reason` union, each prefixed «No se puede correr Auto: » — `not_whole` ««{regla}» no da un número entero de lugares en {meses}. Corrige su número.» and `negative` ««{regla}» pide un número negativo de lugares. Corrige su número.» (`{regla}` is the card's label, never its key); «{regla} no
aplica en {mes}: ese mes no tiene semana {n}.»; «{Mes1} y {Mes2} tienen distinto «{Exenta / Mes por medio}»
para {persona} (uno viene del registro). Planea 1 mes.» (RQ-4); the resolver refusal lines (§7.9); «El plan es demasiado grande para el
solver ({qué}: {n} de {máximo}). Planea 1 mes.» (RQ-10); «regla fija registrada de {mes}» as the
label of a record rule with no on-screen card, and «regla de presencia registrada» as the label of a presence id or carried-only `P:` line whose `ruleKey` has no on-screen card (RQ-5); SP-7's second-tier line and its four motivos.

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

«Mes por medio: le toca en {mes}.» · «Mes por medio: no dirige domingo en {mes}.» · «Sábado de compensación en
{mes}.» · «No disponible {fechas}: esas fechas no le cuentan.» · «Su número lo fija «{regla}».» ·
«Los pines tomaron {n} lugares.» · «Exenta: fuera de Total y del mínimo de voz.» Ledger-side reasons
(no record, not in the pool) are C2's.

Registry groups shown only through these reasons: `cadence_state` `on` «le toca», `off`
«no dirige domingo», `out` «no dirige domingo: no está en la lista de Dom Lead»; `compensation`
`given` «tiene su sábado de compensación», `missed` «no tuvo su sábado de compensación»,
`not_applicable` (no line).

**Copy amended 2026-10-07 (Frank): the cadence state concerns Sunday lead only.** «Mes por medio»
governs Sunday lead and nothing else — BGV/Coro and the voice floor are untouched — so no C6 line
says «descansa» or «mes de descanso» for the `off`/`out` state: the cadence-off reason above (was
«Mes por medio: descansa en {mes}.»), the `off`/`out` registry copy (was «descansa» / «descansa: no
está en la lista de Dom Lead»), §7.2's `cadence_off_led` (was «…, su mes de descanso («Mes por
medio»).») and SP-7's motivo (a) (was «es su mes de descanso («Mes por medio»)», now «es su mes sin
domingo («Mes por medio»)» — this note supersedes the wording SP-7 quotes). Codes, keys and
behaviour are unchanged. C2's own X1 sentences («En {mes} descansa: …») are C2's copy, not C6's.

### 7.8 Confirm (U4)

Keyed on C2 IF2-6 (`details.detail`) and IF2-5 (outcomes); every IF2-6 code the route answers has a line.

| Situation | Copy |
|---|---|
| record conflict (`record_exists`, `stale_revision`, `record_missing`) | «Otro administrador registró o cambió la elegibilidad de {mes} mientras planeabas. No se creó nada; vuelve a correr Auto.» |
| record conflict (`month_has_services`: a recorded, unbound month gained a stored service) | «Se guardaron servicios en {mes} mientras planeabas, así que su registro ya no se puede reemplazar. No se creó nada; vuelve a correr Auto.» |
| a horizon month became past: C6's own client refusal (CF-1, A40) or `past_month` from the PUT — no «Reintentar» | when no draft of this confirm has been created (always the case for `past_month`, CF-4): «{Mes} ya pasó mientras planeabas. No se creó ningún servicio; vuelve a correr Auto.»; on a retry after earlier attempts created drafts (CF-1 only): «{Mes} ya pasó mientras planeabas, así que no se creó nada más. Lo ya creado se queda; completa lo que falta en «Editar mes».» |
| a horizon month is past WR-4's ceiling: C6's own client refusal (CF-1, HZ-9) — nothing written, no «Reintentar» | HZ-9's line («Auto no planea más de 12 meses adelante: …»), unchanged |
| record engine mismatch (`engine_not_v3`) | «El solver cambió de versión. Recarga la página; no se creó nada.» |
| record team changed (`member_unknown`, `member_not_worship`, `tipo_mismatch`) | «Cambió el equipo mientras planeabas (un miembro o su Tipo). No se creó nada; vuelve a correr Auto.» |
| record other failure (400, network, 5xx, unparseable, unexpected outcome) | «No se pudo registrar la elegibilidad. No se creó nada; pulsa «Reintentar».» |
| month complete | «{Mes}: {c} de {t} creados.» |
| month partial | «{Mes}: {c} de {t} creados; {f} fallaron.» |
| month not attempted | «{Mes}: no se intentó porque {mes anterior} quedó incompleto.» |
| retry button (never after the past or ceiling lines above) | «Reintentar ({n} pendientes)» |

### 7.9 Resolver refusals (C2 IF2-15, RQ-2)

One line per `refusals` item (keyed on its `reason`) and per `issues` item (keyed on its `code`),
each prefixed «No se puede correr Auto: ». The map is typed on IF2-15's own unions (RQ-2's guard).
The facts are the same as C2 §8's «Registrar» copy.

| Key | Copy (after the prefix) |
|---|---|
| reason `unresolved` | ««{persona}» en las reglas no coincide con nadie. Corrige el nombre en la regla.» |
| reason `ambiguous` | ««{persona}» en las reglas coincide con más de una persona. Corrige el nombre en la regla.» (no count: an IF2-15 `refusals` item carries only `person` and `reason`, and C2 §8's «Registrar» copy for it names people without one) |
| reason `no_tipo` | ««{persona}» en las reglas no tiene Tipo. Corrige el nombre en la regla.» |
| reason `cadence_and_exact` | WN-2's second sentence (A11), which carries the prefix itself |
| reason `overlapping_exact` (A38) | «{persona} tiene dos números fijos para el mismo rol. Deja una sola regla.» |
| reason `exact_count_range` | «la regla fija de {persona} no da un número entero de 0 a 31 lugares en {mes}. Corrígela.» (C2 §8's meaning: a count that is not a whole number, is negative, or is above 31) |
| reason `presence_member_not_listed` | «{persona} está en una regla de presencia pero no canta (su Tipo no incluye voz). Corrige la regla o su Tipo.» |
| codes `presence_members`, `presence_roles`, `presence_rule_id`, `too_many_presence` | «una regla de presencia no se puede registrar (necesita de 2 a 12 personas de voz y al menos un rol; máximo 20 reglas). Revísala.» |
| code `no_people` | «no hay nadie con Tipo de voz en el equipo.» |
| code `too_many_people` | «hay más de 100 personas de voz.» |

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
| Manual plans under v3 | Record from the on-screen config at first confirm (A27 for a recordless month) | Otherwise the month drops out of the ledger (F3) | A hand-built month asserts today's pools | this spec |
| Anchored, unrecorded month | Solve it from the screen, create its drafts, and **create** its record from the same frozen body (A27); the banner says the record will be frozen | Otherwise the month would drop out of the ledger (F3) while its services count; A27 rules that creating never overwrites anything | The record asserts today's pools for a month whose earlier stored services were planned without them, and it is frozen at once (A5) | parent A27 |
| Recorded, unbound month | Screen drives; confirm replaces the record under the `rev` read (A6) | A record whose month has no stored services is not yet what any service was planned with | A failed confirm's record is replaced by the next one | parent A6 |
| 2-month horizon-wide fields | Presence rules month-scoped (C5-16); refuse a horizon whose months disagree on «Exenta» or «Mes por medio» for one person | C5 scopes presence and pairs per month but carries `exempt` once and `cadence` for every month (§5.3); silently picking one month's value would misstate the other | The admin plans 1 month at a time across such a change | this spec; C5 declined the per-month form (S-3), so the refusal is the standing behaviour |
| Q4 | Keep one `localStorage` entry per month | Parent default; ADR-0042 rollback target untouched | Two writes per 2-month confirm | Claude (parent Q4) |

## 11. Assumptions

| Assumption | If false | Validation | Response |
|---|---|---|---|
| C5 echoes opaque service ids and matches pins by id | Same-date services mis-map | C5 spec review | Settled by parent A15 and C5-1; a mismatch is a C5 defect |
| C2's PUT is atomic over ≤ 2 months (WR-9) and decides `unchanged` on an identical `contentHash` before every other check (WR-8 step 1) | «Reintentar» 409s forever after a lost response | C2 spec review | Block C6's plan until IF-C2 holds |
| Every `ok: true` body of C2's resolver passes C2's validator (A38, tested by C2) | A month solved from the screen solves, then its confirm is refused `400 invalid_request` every time | C2's invariant test | Fix in C2's resolver (return `ok: false` with issues); never a client-side validator in C6 (it hashes with `node:crypto`) |
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

PI-1 to PI-7 of earlier drafts are closed by the amendments: PI-1 and PI-3 by A1 (engine ownership;
the override also honoured with `VERCEL_ENV` unset), PI-2 by A6 (a record binds only an anchored
month), PI-4 by A15 (pins and entries keyed by service id), PI-5 and PI-6 by A24 (distinct copy for
non-timeout transport errors; Auto refuses a horizon with a past month), and PI-7 by A27 (Auto's
confirm creates a record for every recordless horizon month, anchored or not; C6's former record skip
for an «anchored, unrecorded» month, CF-1 (iii), is removed with its copy and failure row). Their IDs
are not reused.

No parent issue is open.

**Reading of U3 (not an issue).** U3 says counted specials are «ranked by balance». C6 reads that
under F12, which ranks every protection above balances: SP-2 ranks by balance only among the
candidates whose placement misses no protection checkable before the solve (cadence state, both
monthly caps, adjacent Sundays), and falls back to the others only when no such candidate exists,
because fill outranks the protections (F12) and the solver cannot move a pinned special seat (C5 §8.1,
cause `pins`). This refines U3's ranking; it contradicts no parent clause.

### Sibling issues (for the owning child; C6 follows its current text meanwhile)

Re-read on 2026-10-06 against each sibling's current text; IDs are kept stable and closed ones are
not reused.

| ID | Child | Issue | Recommended fix | C6 meanwhile |
|---|---|---|---|---|
| S-18 | C7 | C7's 3e compares the request's presence sub-lines with the GET's by config ordinal through «C6's minted-id → config-ordinal map … however the merged C6 exposes it» (its AS8; the earlier text checked them key-free, reading the map as memory-only). KH-3 is that exposure: each run's rule reference table — wire id or `P:` key → kind and config ordinal, or «sin tarjeta» with the key's codepoint-order index among the `ruleKey`s of the run's GET body — kept with the plan, name-free, readable by the admin in the planner and headed by the run's `request_id` | C7 cites KH-3 by ID in AS8 and Step 0's check of the merged C6; 3d saves each run's table beside its captured bodies; 3e joins `P:<id>` → `presence[i]` through the table and `presence[i]` → `ruleKey` through the private 3a config snapshot (a «sin tarjeta» key through its GET-body index), printing only ordinals, counts and pass/fail (K10); the key-free test stays AS8's fallback | KH-3 states the exposure; C6 edits no C7 text |

Closed on 2026-10-06, each checked in the sibling's current text: S-14 (C5 §5.2 now types a service
`id` by `isCanonicalDocumentId` — 1–200 chars, no whitespace, never `drafts.*` — and its «Sibling
changes» records S-14 as applied; IF-C5 and RQ-3 now cite that grammar), S-16 (C5 §5.3 `carried`, §5.4,
its «Interfaces» («Rule ids») and C5-17's evidence now say C6 mints every rule id and rewrites
`carried`'s `P:` keys, without making it part of C5's contract), S-15 (C7 Step 2's check records the
form-help sentence as still shown on Preview under the override, not a defect, and C7 Step 5's flip PR
deletes it) and S-17 (C7's C6 row, Step 5 and S8 attribute the engine pin to C1-R11 alone). **S-3 is
declined by C5** («Declined: C6's S-3» in its «Sibling changes»: `exempt` and `cadence` stay per person,
because they decide the floor, the `TOTAL` tab and the DL line for the whole run), so RQ-4's «Planea 1
mes» refusal is the standing behaviour, not a stopgap. C5's own open row on the `violation_rule` group
(its «Sibling changes», row «C6 (RQ-5, IF-C5, §7.4)») is answered here — NT-4 excludes the group by name
and RQ-5 (i) never mints `mandatory_lead` — and is C5's to close.

Closed in earlier drafts: S-13 by C2 LG-4, which now states one seat per person per service — the first by Lead > BGV > Choir, every further seat set aside `second_seat` — in C5's words, run by C2 IF2-11 (ST-6 cites both and its test compares against IF2-11); S-12 by A39 (the response carries integer seat counts per person, line and tab beside the hundredths, and the panel renders them; C5's §8.2 now carries `seats` and `pinned_seats` per line and tab, which EQ-3–EQ-5 and IF-C5 read), S-11 (C5 now emits per-line `tenths: { share, after }` and, per person, the five display `tabs` with their own `tenths: { share, after }`, each rounded once from the exact value or exact sum, C5-8, C5 §8.2; EQ-3/EQ-5 render «Queda» from `tabs[<tab>].tenths.after`, so the folded BGV and Total need no sum), S-1 (C2 WR-5 now runs the live-data checks only on written months),
S-2 (C1 names C2 as the override's owner), S-4 (C2's `countedSundayLeads` is one entry per Lead
seat), S-5 (C5 takes `prior` from C6's roles read, A15), S-6 (C2 UI-4 and C4 show one decimal, A17),
S-7 (one limit of 100 people), S-8 (C2's freezing services and `recordBinds` follow A5/A6), S-9 (C2's
dotted id and A1 resolver), S-10 (C7 records PI-5 as settled by A24). C3 has C6 open the warning with its server-resolved prop, and A7 closed its former Q-b (RQ-5); its
§6.7 copy for a cadence member with no Tipo is C3's own item in the cross-check, and C6 shows whatever
lines C3 builds (WN-1). C1's
SN-2 is applied (§5.1 no longer says «if absent»).

## 14. Acceptance and verification

| Requirement | Acceptance evidence | Verification |
|---|---|---|
| ENG-1..5 | One resolver (C2's) imported; neutral module; server-only import guard; constant `"v2"` pinned by C1's test alone (C1-R11) | vitest; `clientBoundary.test.ts`; grep guards |
| RT-1..6 | 409 both ways; v2 path unchanged; v3 remote/local/unconfigured; 55 s abort; JSON for every failure | Route tests with a stubbed upstream and fake timers |
| HZ-1..9 | Picker per engine; per-month state; Dec→Jan; date ownership; stacked calendars; month band; sidebar; past refusal; ceiling refusal (current + 12 admitted, + 13 refused before any read and at confirm, incl. a second month alone crossing) | Component and unit tests with a fixed clock |
| ST-1..9 | «Guardado» from the coherent read; identity per service; no stored writes; fixed services with filled-seat shares; notices; the four month states (§4); fill-empty | Unit + `MonthGenerator` create tests |
| SP-1..7 | Pre-fill under today's hard blocks; protection tiers (cadence state, both monthly caps, adjacent Sundays incl. `prior`) before balance, cadence members never ranked by a DL balance, second tier only when the first is empty, with its notice; fixed afterwards; uncounted unchanged; exits | `localFill` + wiring tests |
| RQ-1..10 | Fresh bounded ledger read; one month source for request and record (bound: the record's statuses, exact rules, presence, blocks, cadence and exempt); presence month-scoped; every rule id and `P:` carried key minted, none a config key or `ruleKey` (name-shaped fixture); exempt/cadence disagreement refusal; exactly-one names and C2 IF2-16/IF2-17 for screen rules, an IF2-17 `ok: false` refusing before the fetch by card label (never rounded, clamped or sent as 0); services that will exist, stored `_id`s verbatim and `time` only when `isServiceTime` holds; per-month rules; pins and cap sync; `prior` from the roles read; C5 limits pre-flighted; no v2 fields or helpers | Request-builder unit tests; Python-source sync test |
| AD-1..8 | Parsers never crossed; 58 s abort; classification; handshake; apply by id; code-keyed retry; exits; the v2 409 branch | Spy tests; adapter unit tests |
| NT-1..5, EQ-1..7 | Copy keyed on codes, registry sync, stage summary, panel per engine, plan columns, the X1 line from RQ-4's values after a run, phone cards | Copy sync test; render tests |
| WN-1..3, CTL-1..2 | Warnings (WN-1's gate open iff v3 and some horizon month not bound, each line naming its months), cadence refusals, engine wiring (only `CADENCE_V2_NOTE` gated among C3's notes), filler ordering | Render and ranking tests |
| CF-1..11 | Order (spy on call sequence: at most one PUT, then POSTs by date); the three entry shapes of CF-3 (bound, recorded-unbound, unrecorded) each with its expected outcomes — `replaced` accepted only for recorded-unbound; one entry per horizon month (CF-1); an anchored, unrecorded month and a recordless month without drafts each get a create entry (A27); zero POSTs after any record refusal or unexpected outcome; GET→PUT round-trip hash; month gate; past-month refusal on the first attempt and on a retry, with no «Reintentar» and the entry set never shrunk (A40); frozen body; replay per shape before the boundary; per-month report; publish absent at 2; per-month history append; closing dialog | `MonthGenerator` create tests with a scripted fetch; route test; reviewed in the adversarial loop |
| DOC-1..3 | Entries and ADRs present | Code review + docs audit at cycle close |
| KH-1..3 | No rule key, minted id source, id → label map or request/response content in any log, copy, toast or doc; rules named by card label in the UI and by kind and ordinal elsewhere; the rule reference table (id → kind and config ordinal, never a key) kept with the plan and readable by the admin, keyed by `request_id` | Name-shaped fixture through builder, renderers, the table and confirm; route log test; grep guard |
| Parent §16 | Preview, engine v3, two real months solved (not confirmed) | C7 |

Gates before any merge: `npx tsc --noEmit`, `npm test`, `npx eslint .` (0 errors), and — since C6
reads `gcf_v3/` source in a sync test but changes no Python — the Python gate only if a `gcf*/**`
file changes.

## 15. Risk tier and review handoff

- **Tier: standard** for the spec as a whole (parent §11: C6 standard), with **§5.11 critical**: it
  orders writes to a new production writer and to the service create route, and owns partial-failure
  recovery. Per CLAUDE.md, the adversarial loop runs on **that slice's plan** (two sequential fresh
  `APPROVED` on byte-identical text, churn cap binding); the rest of C6 relies on spec review plus a
  fresh code review of the diff. A6 and A27 shape that slice — three entry shapes (bound;
  recorded-unbound with a requested replace; unrecorded, anchored or not, with a create) — so it stays
  critical and the plan's review covers §4's state table with it.
- Dependencies: C2 (the IF2 items of IF-C2, including RES-8's resolver invariant, A38), C3
  (IF-C3), C5 (IF-C5, deployed and inert), C1 (IF-C1). C6's plan re-reads each sibling and copies the field and reason names
  their text then carries. Safe end state: production unchanged (`SOLVER_ENGINE = "v2"`); Preview
  runs v3 only once both the override (C2 EN-3) and `OWT_SOLVER_V3_URL` (set on Preview by C7, DOC-1)
  are present — with the override alone, v3 Auto answers `not_configured` (RT-3). Rollback: the
  constant stays v2; unset the Preview override.
- Evidence for reviewers: the parent, this spec, the cited files. Prior planning dialogue excluded.
- Implementation authorization: **not granted by this document.**

## 16. Terminal state

`READY_FOR_REVIEW`
