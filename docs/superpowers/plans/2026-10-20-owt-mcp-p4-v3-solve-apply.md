# OWT MCP P4 on solver v3 — solve and apply a month from the connector (implementation plan)

**Date:** 2026-10-20 · **Status:** draft for adversarial review (critical tier) · **Replaces:**
[`2026-09-28-owt-mcp-p4-solve-apply.md`](2026-09-28-owt-mcp-p4-solve-apply.md), blocked since the
v3 flip ([ADR-0056](../../adr/0056-the-v2-solver-stays-deployed-as-the-rollback-engine.md), K7).
That plan stays in the tree as history; nothing in it is implemented.

## Original request

> «Hay que hacer el nuevo plan para que pueda usar el nuevo solver» (Frank, 2026-10-20, after being
> told that P4 is blocked until it is re-planned on v3).

The roadmap's P4 row ([`2026-09-22-owt-mcp-roadmap.md`](2026-09-22-owt-mcp-roadmap.md)) and the
spec's three tool rows ([`2026-09-22-owt-mcp-design-v2.md`](../specs/2026-09-22-owt-mcp-design-v2.md),
`solve_month`, `revise_proposal`, `apply_schedule`) are the requirement, **re-baselined onto v3**:
the parity target is now the browser's **v3** Auto and the **v3** confirm, not v2's.

Frank's earlier P4 decisions that still stand (2026-09-28, recorded in the old plan's «Original
request»): the proposal is a **short id resolving to a server-stored, hidden, expiring record**;
expiry **7 days**. His decision of 2026-09-28 on Fluid compute («Es gratis? Si es gratis, lo puedes
activar») is **not used**: this plan needs no Fluid (D1).

**Scope question put to Frank on 2026-10-20 (Q1):** whether `revise_proposal` ships in this plan
or in its own later plan. This plan is written on the recommended answer — **later** — and says in
Q1 exactly what changes if he picks the other.

## Status and contract

- **Risk tier: CRITICAL.** The plan extracts a production writer (the admin create,
  `roleCreateCommit`), adds a second caller to the eligibility-record writer
  (`commitFairnessMonths`, ADR-0050's one writer), defines a stored-record protocol with
  concurrency and recovery across calls (the proposal store), and ends in a production write by the
  connector. Two sequential fresh `APPROVED` verdicts on byte-identical text, the churn cap binding,
  and a committed `2026-10-20-owt-mcp-p4-v3-solve-apply-review-log.md` beside this file
  (CLAUDE.md §Review policy; `.agents/skills/adversarial-plan-review/SKILL.md`).
- **Primary outcome.** From the Claude app Frank asks for one or two months; `solve_month` runs the
  same v3 Auto `/admin` runs on the same data and returns a proposal; `apply_schedule` writes each
  horizon month's eligibility record and then the drafts, exactly as `/admin`'s v3 confirm does —
  nothing published, nobody notified.
- **Preconditions (step 0):** this plan approved with its review log; Frank's go-ahead to
  implement; Q2 and Q4 answered (or their defaults accepted) before step 6.
- **Safe ending state:** `/api/mcp` registers **14 tools** (P0–P3's 12 + `solve_month` +
  `apply_schedule`), `maxDuration` still **60**; no platform setting changed; the only new stored
  data is `mcpProposal.*` records (private, 7-day, swept); each new tool proven once on production
  on the Q3 month (by default the next month Frank plans, its drafts kept as real work).
- **Line numbers** are at `main` `d65871e2`. Every step re-verifies the lines it cites on the branch
  it is implemented on.

## What changed since the 2026-09-28 plan

| Old plan | Under v3 | Disposition here |
|---|---|---|
| Release A: Fluid compute, a 180 s `/api/mcp`, a dashboard re-cap of 44 routes and every page, a concurrency audit (≈ 400 lines) | v3 answers in seconds: production route 6.8 s, `total_ms` 1 814 for the real Nov+Dec request; cold start 7.97 s; the function's own budget is 25 s and the route aborts it at 55 s (F1) | **Dropped** (D1). Both tools fit 60 s with a budget; apply works in resumable slices |
| Parity with v2's `buildSolveRequest` + derived history (P2) | Auto never calls v2's builder under v3 (C6 RQ-9); no history is sent; the balance comes from the fairness ledger GET | **Replaced**: parity with `runV3Auto` + `buildV3SolveRequest`, by calling them (D3) |
| M23: refuse unless `SOLVER_HISTORY_SOURCE === "derived"` | Irrelevant under v3 | **Replaced** by the engine gate (D2) |
| Apply = the v2 confirm (`runDraftCreateBatch`) with skip-and-report and two exhaustive outcome tables (X, O) | v3's confirm writes every horizon month's record **first**, in one PUT, then the drafts month by month (C6 §5.11, CF-1–CF-7), in `runV3ConfirmAttempt` — «the ONE v3 confirm» (CLAUDE.md) | **Replaced**: apply calls `runV3ConfirmAttempt` itself (D4); the browser's whole-batch refusal is mirrored (D7, Q2) |
| A lease on the record (W1–W7) serializing apply against revise | No revise in this plan (Q1); every write apply makes is replay-safe | **Replaced** by grow-only state merged under `ifRevisionId` (D6) |
| `revise_proposal` | — | **Moved to its own plan** (Q1) |
| `roleCreateCommit` extraction (ADR-0043 pattern), the stored proposal, the 7-day expiry, the 128-bit handle, origin/principal binding, the sweep, I5 on member lists, the dev smoke listing tools it never calls | Unchanged needs | **Kept**, re-derived below |

## Findings

Verified at `d65871e2` unless marked «measured».

| # | Finding | Evidence | Consequence |
|---|---|---|---|
| F1 | **v3 is fast, measured.** Real-container gate: warm `total_ms` p95 ≤ 2 735 on shapes A–E; the real Nov+Dec 2026 request (shape E) p95 1 910 ms, curl p95 2.17 s; cold 7.97 s. First production run (2026-10-16): route 6.8 s, `total_ms` 1 814. The solver's own budget is 25 s; the route's v3 upstream abort is 55 s and `maxDuration` 60 | `docs/SOLVER_AND_INFRA.md:555,624-643,679-683`; `app/utils/solverV3Upstream.ts:20`; `app/api/admin/solve/route.ts:10,185-199` | No Fluid, no ceiling change (D1). `solve_month` passes its own, shorter timeout to `solveV3` (D5) |
| F2 | **The v3 solve is already a server-only function.** The route only authorizes, checks the engine and calls `solveV3(body)`; `solveV3(body, env, fetchImpl, timeoutMs)` never throws and returns `{ status: 200 \| 422, text, outcome }` | `app/api/admin/solve/route.ts:183-199`; `app/utils/solverV3Upstream.ts:1-25,119-129` | `solve_month` calls `solveV3` directly — no `runSolve` extraction (old step 4a gone) |
| F3 | **The fairness GET is a server function too.** The route is `loadFairnessLedger({ month, horizon, currentMonth: serviceTodayIso().slice(0,7), engine, environment })`, which fails closed without `SANITY_API_READ_TOKEN` | `app/api/admin/fairness/route.ts:50-56`; `app/utils/fairnessLedgerRead.ts:117-129` | `solve_month` calls it with the same arguments; a throw is the browser's «No se pudo leer el saldo de equidad» refusal |
| F4 | **The browser's v3 Auto is transport-injected and almost all pure.** `runV3Auto(deps)` takes `preRead`, `storedReady`, `readLedger`, `isCurrent`, `build`, `postSolve`; `buildV3SolveRequest` is «the ONE pure builder»; `classifyV3Answer`, `v3HandshakeHolds`, `applyV3Assignments`, `buildV3RunReport` are neutral | `app/components/admin/v3AutoRun.ts:1-86`; `v3SolveRequest.ts:1-17,40-70`; `v3SolveResponse.ts:17-114`; `v3RunReport.ts:35-63` | `solve_month` calls the same functions with server transports. Parity is by construction for everything they own |
| F5 | **What is still inline in `MonthGenerator.tsx` (a `"use client"` file)** and the server would need: `savedWindowFor` (`:595-606`), the v3 stored-service derivation (`v3Stored`, `:2296-2308`, over `joinStoredRoleInventory` + `translateStoredRole`), the planned-column derivation (`createColumns`/`plannedCreateColumns`, `:2689-2702`, and `v3PlannedColumns`, `:4338-4344`), the after-solve settlement (`applyV3AutoResult`, `:4416-4451`) and the local fills (`applySpecialFill`, `:3963-4023`, whose first half — `fillColumn` over uncounted specials, then `fillInstruments` — is pure), `buildUnavailabilityNotices` (`:515`), and the board half of the request (`buildV3FromBoard`, `:4393-4402`). `refuseSpecialOn`/`refuseWeekendOn` live in `MonthCalendar.tsx` (`:155,192`), also `"use client"` | files cited; `clientBoundary.test.ts` (ADR-0028) | Step 2 moves each verbatim into neutral modules that `MonthGenerator`/`MonthCalendar` import back (D3) |
| F6 | **The v3 confirm is transport-injected and resumable.** `runV3ConfirmAttempt({ entries, months, drafts, published, state, currentMonth, putRecords, postDraft })`: guard (CF-1) → one PUT of every month's frozen entry until it lands (`recordsDone`) → drafts oldest first, month by month, a month starting only if every draft of the earlier ones was created → `{ kind, lines, state, progress, retry, createdNow }`. `V3ConfirmState = { recordsDone, createdLocalIds }` is all it carries between attempts | `app/components/admin/v3ConfirmRun.ts:1-129`; `v3Confirm.ts:39-55` | Apply calls it; the proposal record persists exactly `V3ConfirmState` and the frozen entries (D4, D6) |
| F7 | **The record writer is a commit module with an injected actor.** `commitFairnessMonths(body, { recordedBy })` stamps engine, environment, CDMX month and clock itself and delegates to `executeFairnessMonthWrites`; it delivers nothing and needs no revalidation (WR-13). Its caller pin says «the PUT route is the commit module's only caller (no MCP tool)» | `app/utils/fairnessMonthCommit.ts:1-25,137-161`; `app/api/admin/fairness/months/route.ts:33-49`; `serviceCommitCallers.test.ts:62-63` | Apply adds itself as the second caller in the pin, with `recordedBy` = the grant's member id (D4). ADR-0050's «one writer» is the executor, unchanged |
| F8 | **The browser's confirm gates**, in order: `gateBlocked` (the five sources), `isDraftCreatable` against the preflight snapshot taken at preview (non-creatable targets are silently not candidates), the nameless-special refusal, then a **fresh** preflight of every candidate — any candidate no longer `creatable` aborts the whole confirm before any write — then `confirmV3` | `MonthGenerator.tsx:569-586,2093,4709-4767`; `serviceCardModel.ts:1242-1333` (`monthTargetPreflight`) | Apply mirrors each gate (Table A). The fresh-preflight abort is mirrored, not softened (D7) |
| F9 | **A planned column exists only for a target that is creatable and not stored** (ST-2; `v3PlannedColumns` filters skipped and non-creatable). A stored service of the horizon is a fixed «Guardado» column | `MonthGenerator.tsx:2699-2702,4338-4344`; C6 spec ST-1–ST-4 | `solve_month` runs the preflight per planned target at solve and leaves the non-creatable ones out of the **solver request**, reporting each with its reasons (M9). As in the browser, the local fills and `cellsToDrafts` still run over the full planned column set (`MonthGenerator.tsx:2697-2708,3963-4023`); a non-creatable draft is simply never a candidate (A2) |
| F10 | **A draft create notifies nobody** (`roleCreateNotice` returns `null` when `!published`; `queueRoleNotices` returns early), and the record write delivers nothing (WR-13) | `app/utils/serviceMutationSideEffects.ts` (`roleCreateNotice`, `queueRoleNotices`); `fairnessMonthCommit.ts:15-18` | Apply always sends `published: false` (CF-8 forbids publish in a 2-month confirm anyway); its notification report is empty by construction |
| F11 | **The create receipt makes every draft POST replay-safe**: the same `creationRequestId` with the same body replays as success with no writes; a different body is `idempotency_mismatch`; a deleted role's key is retired. The receipt fingerprints the canonicalised create payload (`payloadFingerprint`, defined at `roleCreationReceipt.ts:248`, called at `roleWriteRequest.ts:314`) | `app/api/admin/roles/route.ts:89-100,376-401`; `app/utils/roleCreationReceipt.ts` (`payloadFingerprint`) | Concurrent or repeated applies cannot create a service twice (D6). The tool normalises each body through `JSON.parse(JSON.stringify(…))`, the shape `req.json()` hands the route (old D23, kept) |
| F12 | **The record PUT is replay-safe**: an identical content hash on an intact record answers `unchanged` before every other check (WR-8 row 1), for each of the three entry shapes | C6 spec CF-7; `fairnessMonthWriteRequest.ts` (decision order) | Two applies of one proposal, or a re-call after a lost answer, never write the record twice (D6) |
| F13 | **Measured server-side cost of one P3 write: 1.2–2.4 s** (production, 2026-09-28). A create is the same class of call (reads, one transaction, revalidate) | `docs/MCP.md:1263` | Apply starts no create after 40 s of its call and finishes in later calls (D5); AS2 validates the per-create figure at L2 |
| F14 | **`app/mcp/**` may not spell the five role/setlist type literals**, and the MCP writes only through `*Commit` modules | `app/mcp/__tests__/mcpProtectedTypeLiterals.test.ts`; `serviceCommitCallers.test.ts:42-61` | The planning core lives under `app/components/admin/` and `app/utils/`; the tools speak `kind` |
| F15 | **I5's trap is unchanged**: the members route binds `{ all: true }` for a super-admin, and the browser's unavailability notices list every member with `unavailableDates`, kids-only included. Under v3 the request itself is worship-only: C2's resolver drops non-worship members (RES-5) | `app/api/admin/members/route.ts:23-33`; `MonthGenerator.tsx:515,3315-3317`; C6 RQ-2 | The one member list `solve_month` reports that is not tied to a seat — the unavailability notices — is filtered by `normalizeMinistries(…).includes("worship")` (old D21, kept) |
| F16 | **The principal is the grant's member id**, available to a tool as `authInfo.extra.sub` | `app/api/mcp/route.ts:245-265` | `recordedBy` for the PUT; the record's principal binding |
| F17 | **The browser's month planner owns per-column UI state the connector has no spelling for**: «Omitir» (`skippedColumnIds`), per-column «Cuenta para equidad» edits (`createCountsEdits`), hand-placed cells, «Solo llenar vacíos», unsaved rule edits | `MonthGenerator.tsx:2689-2696,3315-3320` | The connector solves a fresh preview: no skips, no edits, `cells = []`, `fillEmpty = false`, the STORED rules. Each is a declared narrowing (Table M) |

## Scope

### In scope

- `solve_month` and `apply_schedule`, v3 only, registered on `/api/mcp`.
- Behaviour-preserving moves out of `MonthGenerator.tsx` and `MonthCalendar.tsx` into neutral
  modules (F5), so the browser and the connector call one implementation.
- `roleCreateCommit` (ADR-0043's pattern; the create route keeps auth and the JSON parse).
- One shared GROQ builder each for the admin roles GET and the admin members GET, so the routes and
  the connector read through the same text.
- The `mcpProposal` store (hidden, read-only Studio type; `writeClient`, allowlisted), expiry and
  sweep.
- Guard updates, the dev smoke's tool list, docs, one ADR, the spec and roadmap amendments.
- The production live proof (step 9).

### Non-goals

- `revise_proposal` (Q1). Fluid compute or any `maxDuration` change. Any v2 path in the connector.
- Publishing from apply; a seat-level edit of a created service (roadmap decision 6).
- Pins, a seed knob or «Solo llenar vacíos» from the connector; on-screen (unsaved) rules.
- Same-day sets, worship nights, a special's `time`/`format` (the month create flow sets none).
- The kids ministry. A proposal read tool (a lost `solve_month` answer costs a re-solve).
- P2's D3 and every other v2-only cleanup: they belong to the v2-retirement PR (ADR-0056).
- A new secret or env var: none is introduced. `OWT_SOLVER_V3_URL`, `OWT_SOLVER_API_KEY` and
  `SANITY_API_READ_TOKEN` gain a caller; their `docs/SECRETS.md` entries are updated (step 8).

### Preserved invariants

- **`/admin` behaves byte-identically.** Every move is reviewable with
  `git diff --color-moved=dimmed-zebra --color-moved-ws=allow-indentation-change`; the only edits
  inside a moved body are the listed boundary edits. The v3 suites (`MonthGenerator.v3*.test.tsx`,
  `v3*.test.ts`, `fairnessEngineV3.test.tsx`), `MonthCalendar.test.tsx`, `roleWriteRoutes.test.ts`
  and the fairness route tests pass with zero diff.
- **The ONE v3 request builder and the ONE v3 confirm stay one**: `buildV3SolveRequest` and
  `freezeConfirmEntries`/`runV3ConfirmAttempt` are called, never copied or edited.
- **Two parsers, never crossed (U8):** the connector reads only v3 answers, only through
  `v3SolveResponse.ts`; v3 copy only from `v3Copy.ts`. The connector's own lines (pending, deleted or
  modified since created, the state-write failure, the record failure after earlier progress, the
  dropped-service refusal) are added there as `V3_CONNECTOR_LINES`, and every browser line that names a
  UI control («Reintentar», «vuelve a correr Auto», «Editar mes», «vuelve a previsualizar», «Recarga la
  página») has a connector twin there naming `apply_schedule` or `solve_month` instead; a tool never
  shows a line that tells Frank to press a button it does not have.
- **Key hygiene (C6 KH-1, KH-2):** no tool output, log line or error carries a `solverConfig` key, a
  `ruleKey`, a minted rule id's source, a member id in a log, or a request/response body. Rules are
  named by their card labels through the run's own label maps. The proposal record stores the
  frozen PUT entries (which carry `ruleKey`s, as the `fairnessMonth` records they become do) under a
  private dotted id and never returns them.
- **Draft gating** (I2): no `MAY_SEE_DRAFTS` entry; the two shared builders sit in
  `serviceReadQueries.ts` (already exempt); no protected-type GROQ literal in `app/mcp/**`.
- **I5:** the solve's member input admits every member (`{ all: true }`), as a super-admin's browser
  does; the only reported member list not tied to a seat is filtered to the worship audience.
- **TZ:** service dates are `YYYY-MM-DD` strings; the current month is
  `serviceTodayIso().slice(0, 7)` (CDMX); outputs identical under `TZ=UTC` and
  `TZ=America/Mexico_City`.
- `saturdarSongs` untouched; every array of objects written to Sanity has a `_key` (the store
  writes none: its structured payload is one JSON string, D6).

## Design decisions

| # | Decision | Choice | Why this and not the alternative |
|---|---|---|---|
| D1 | Platform | **No Fluid compute; `/api/mcp` keeps `maxDuration = 60`.** Each tool runs under a **52 s soft deadline** measured from its handler's start | Fluid existed in the old plan only because v2's solve took 7–15 s warm and the apply loop needed ~130 s. v3's real request solves in ~2 s and the route answered in 6.8 s in production (F1), and an apply that cannot finish in one call can finish in the next (D5). Fluid would change every function's concurrency (shared module state across invocations) and needed a dashboard re-cap of 44 routes plus every page to avoid a 30× duration window that Hobby cannot watch. That is real risk bought for no measured need |
| D2 | Engine | **v3 only.** Both tools refuse before any read, `integrity_conflict` detail `engine_not_v3`, unless `resolveSolverEngine(process.env) === "v3"` | v2 is the rollback engine (ADR-0056). Supporting it would double the parity surface, which is how the old plan became obsolete. On Production the override is ignored (`solverDeployment.ts:32-39`), so the tools follow the code constant: a flip-back disables them automatically, and the fairness PUT would refuse `engine_not_v3` anyway |
| D3 | Parity | **By construction.** The connector calls `preReadRefusals`, `runV3Auto`, `buildV3SolveRequest`, `classifyV3Answer`/`v3HandshakeHolds`, `applyV3Assignments`, `buildV3RunReport`, `freezeConfirmEntries`, `cellsToDrafts`, and the inline helpers of F5 after step 2 moves them. A parity test still runs both surfaces on one fixture (step 7) | Two compositions of the same pieces drift; one composition cannot. The old plan's dataset-level jsdom parity test is kept, narrowed to what the shared calls do not already guarantee: that the **inputs** each surface hands those functions are equal |
| D4 | Apply | **`runV3ConfirmAttempt` itself**, with server transports: `putRecords` → `commitFairnessMonths(body, { recordedBy: sub })`; `postDraft` → `createRole(normalised body)` from the new `roleCreateCommit`; `published: false`; `currentMonth` from the server's CDMX clock | It is «the ONE v3 confirm»: records first and atomic, the month-by-month rule, the past-month and ceiling guards on every attempt, replay-safe resends. A second implementation would be a second contract to review and keep in step |
| D5 | Time | **Solve:** the `solveV3` timeout is `min(45 000, 52 000 − elapsed − 4 000)` ms; under 10 000 ms left, the solver is not called: `postSolve` sets a flag in its closure and throws, and the tool answers `time_budget` from the flag (never the generic transport line), nothing stored. `runV3Auto`'s own bounds stay as they are: the ledger read at `V3_LEDGER_TIMEOUT_MS` (20 s) and an outer 58 s on the solve (`v3AutoRun.ts:23-24,70,79`), which the shorter `solveV3` timeout always beats. **Apply:** `postDraft` starts no create after 40 000 ms of the call; a draft past the cut-off is **deferred** (not posted, reported «pendiente») and the next call continues | 52 s leaves 8 s for the response inside the 60 s kill. 45 s still exceeds v3's 25 s internal budget plus a cold start (F1); only when slow reads and a near-20 s ledger read shrink the clamp below ~33 s can a cold solve time out where the browser's would finish — a transport failure with `retry` offered, nothing stored, and the re-call is warm. At 1.2–2.4 s per create (F13) a call covers ~15 creates; a 2-month horizon (~18–22 drafts) takes two calls. A deferral reuses the browser's own retry path: deferred drafts are simply not yet in `createdLocalIds`, so CF-5 blocks the later months exactly as a failure would, and the next call resends only what is missing (CF-7) |
| D6 | Store and concurrency | `mcpProposal.<handle>`: immutable fields written once at solve — origin, principal, `createdAt`, `expiresAt` (+7 days), `engine: "v3"`, the bound rules `rev`, `months`, `requestId`, and **one JSON string `payload`** (the frozen entries, the drafts, each draft's solve-time preflight state, the horizon's stored service ids at solve, from the snapshot's canonical role rows — the rows apply's `O` reads) with its SHA-256 — plus one mutable JSON string `state` = `{ recordsDone, created: { localId → roleId } }`. **No lease.** Every `state` write is a patch under `ifRevisionId`; on a revision conflict the writer re-reads, merges (`recordsDone` OR, `created` set-union) and retries, at most 3 times | Without revise the proposal never changes after solve, and every domain write apply makes is replay-safe on its own (F11, F12). The only shared mutable data is therefore a set of facts that only grow; a union of two applies' facts is always true, so a lost update is impossible and no mutual exclusion is needed. The old plan's lease (W1–W7, the most-reviewed part of it) existed to serialize revise against apply. JSON strings, not structured fields: the payload is written once and parsed on load, so it needs no `_key`s, no Studio sub-schema and adds no attribute paths to the dataset; it is validated (digest, schema) on every load |
| D7 | A target lost since the solve | **Refuse the whole apply call before any write** when a `pending` draft (creatable at solve, not yet created) is no longer `creatable` — exactly the browser's fresh-preflight abort (F8) — plus two connector-only checks the 7-day window needs: any special stored on a pending special's date (the preflight is name-blind and the route refuses only the same normalised name, ADR-0011), and any change to the horizon's stored service ids. **A draft whose own create landed is never pending:** the observation `O` (step 6, `apply_schedule`) recognises it from data — its role's `creationReceiptId` equals `receiptIdForRequestId(d.creationRequestId)` — and counts it as created, so it is neither re-posted nor mistaken for a foreign occupant by any of the three checks | Under v3 the plan is a whole: a date taken by someone else changes the fixed services the solver balanced around, and the frozen eligibility records are for that plan. Re-solving is cheap (F1) and the new solve takes the new service as fixed. The spec's per-service skip predates v3 and was justified by a costly re-solve; that premise is gone (Q2: a spec amendment Frank confirms). Recognising an own create by its receipt id, not by a mark this proposal wrote, is the point: a mark written before a post (or before a PUT that then failed) proves nothing about who occupies the date, while the receipt id is stamped on the role by that draft's own create transaction. With it the connector recovers a lost create answer, which the browser cannot until a reload refreshes its snapshot |
| D8 | Solver failure | **No proposal is stored** on any exit but success: refusal, transport, coded failure, handshake failure, an `assignments` id the request did not send, `time_budget`. The answer carries the browser's own line (`v3OutcomeLine`, `transportLine`, the refusal lines) and whether a retry is useful (`v3RetryOffered`) | The browser fills uncounted specials and instruments on a failed run so the admin keeps a board to finish by hand. The connector has no hand surface (Q1), so a fills-only proposal would only invite applying a month with empty weekends. A declared difference (Table M, M12) that Frank confirms (Q4) |
| D9 | Handle | 26 lowercase Crockford base32 characters (128 bits) from `crypto.getRandomValues`, validated before any read | Short enough for a model to copy, unguessable (old D13, kept) |
| D10 | Binding | Apply refuses — with **one** fixed answer, «No encontré esa propuesta o ya venció. Vuelve a correr solve_month.» — an unknown handle, an expired record, another origin, another principal, or a payload whose digest or schema fails | The model holds only the handle. One answer never confirms that another principal's proposal exists |
| D11 | Rules | The proposal binds the stored `solverConfig` `_rev` (`null` when absent). Apply refuses `stale_revision` detail `rules_changed` when it differs | The browser lets an admin confirm a board after editing rules within one session; a connector proposal lives 7 days, and the spec requires this refusal (`apply_schedule` row). Cheap and strictly safer |
| D12 | Sweep | On each `solve_month` after its record is written, and on each `apply_schedule` after its `state` write, while under 45 s of the call, delete up to 25 records whose `expiresAt` is more than **24 h** past | Records are minted only by solves and refused once expired, so a cron would buy nothing and add a second entry point. The 24 h grace means a sweep can never delete a record an apply loaded just before its expiry |
| D13 | Annotations | `solve_month`: `{ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }` (it writes only its private record). `apply_schedule`: P3's write annotations (`destructiveHint: true`) | Spec I14 as amended; the claude.ai client asks before a destructive call |
| D14 | Output | Spanish text plus `structuredContent`. Solve: the handle and expiry, the run line, the stage summary, C6's notices then the solver's (NT-3 order), each service with its seats by display name, every unfilled seat (voices, instruments, specials), refused specials, services left out because their target is blocked (with reasons), the unavailability notices (I5-filtered), and per person a compact fairness line from the response's `tabs` (D15). Apply: one line per month and per service, `complete`, and what to do next | The browser's report, re-used through the same functions; nothing composed from rule keys or ids |
| D15 | Fairness figures | Per person and tab, «En este plan» = the tab's integer `seats`; «Queda» = `tenths.after` through `formatFairnessTenths`/`saldoWords` (C2 IF2-13) | C6 EQ-5: the only formatter, integers taken as emitted, no division of a wire figure |

## Admin surface gates

I15: every write refuses at least what its admin counterpart refuses (P3's admin-surface reading,
ADR-0043). Dispositions as P3: **mirror** (the tool refuses it itself), **mirror (behaviour)** (it
reproduces the surface's result), **structural** (the input cannot express it), **inherited** (the
writer refuses it; the tool returns its code), **declared** (a stated difference).

**`solve_month`** — the planner's calendar, preview and v3 Auto.

| # | Gate | Evidence | Disposition and test |
|---|---|---|---|
| M1 | The five sources ready («Generar mes» gate) and the stored-services read coherent (ST-1) | `MonthGenerator.tsx:2093,2296-2308`; `joinStoredRoleInventory` | **mirror**: the snapshot, the members read, the roles read and the rules read must all succeed and the inventory be coherent; otherwise ST-1's line «No se pudieron leer los servicios guardados de {meses}…» or `integrity_conflict` `sources:<keys>`, nothing stored, solver not called. Test: each read failing in turn |
| M2 | Rules loaded; absent ⇒ defaults | `solverConfigSource.ts` (`sourceFromGet`) | **mirror**: a failed rules read refuses; an absent document solves with `DEFAULT_SOLVER_CONFIG` and binds `rev: null` |
| M3 | HZ-7 past month, HZ-9 ceiling, WN-2 cadence refusals, before any read | `v3SolveRequest.ts:95` (`preReadRefusals`) | **inherited** (same function, called first, `currentMonth` = server CDMX month) |
| M4 | Horizon 1–2 consecutive months | `v3Horizon.ts:13-16` | **structural**: `months: 1 \| 2`; `month` `YYYY-MM`, year 2024–2035 (the planner's `MIN_YEAR`/`MAX_YEAR`, moved in step 2) |
| M5 | Weekend exclusions name the horizon's own Sundays/Saturdays (HZ-3; a month-end Saturday belongs to its own month) | `v3Horizon.ts:59-74` (`weekendDatesOfMonth`) | **structural + mirror**: each excluded date must be a weekend date of a horizon month, no repeats; else `invalid_request` `exclusion_not_weekend_of_horizon` |
| M6 | A special: a day of a horizon month, a name (`normalizeLabel`), the composer's four rules (`refuseSpecialOn`) and `refuseWeekendOn` | `MonthCalendar.tsx:155-196`; `MonthGenerator.tsx` nameless guard | **mirror**: refused per special with the function's own Spanish text, never dropped silently; a nameless one never reaches the request. `countsForFairness` optional, default `countsForFairnessDefault("special_role")` (the composer's default) |
| M7 | At least one column | `handlePreview` (`MonthGenerator.tsx:3313`) | **mirror**: `invalid_request` `no_columns` |
| M8 | One column per date (E3) | `plannerModel.ts:482-530` (`buildColumns`) | **mirror**: after M5/M6 no overlap reaches `buildColumns`; the core asserts the column count and throws otherwise (a `pre` failure, nothing stored) — never `buildColumns`' console-warned drop |
| M9 | A planned column only for a creatable, unstored target | F9 | **mirror (behaviour)**: per planned target, `monthTargetPreflight` over the snapshot's sources and summaries (the P1 snapshot's own builders, ADR-0040) and the integrity queue built **exactly as `/admin` builds it** — `buildIntegrityQueue({ sources, cards: serviceCardRefs(roles, summaries), roles: summaries.roles, setlists: summaries.setlists, proposals: summaries.proposals })` (`ServicesPanel.tsx:831-841`) over the admin roles rows — lifted into a neutral `integrityQueueFor(…)` in a new module `monthPreflight.ts` (not `serviceIntegrityQueue.ts`: `serviceCardModel.ts:77-84` already imports that module, so `serviceCardRefs` there would close a cycle) that `ServicesPanel`'s memo calls back (step 2). Not `creatable` ⇒ left out of the request and reported with its reasons; the state is stored per draft as `atSolve`. A special's preflight is name-blind by design (`serviceCardModel.ts:1242`, doc comment); its existence is E17's `existing` key in `cellsToDrafts`, as in the browser |
| M10 | The ledger read: fresh, ≤ 20 s, any failure refuses | C6 RQ-1; `v3AutoRun.ts:62-74` | **inherited** (`runV3Auto` with `readLedger` → `loadFairnessLedger`, raced against the abort) |
| M11 | Every refusal of `buildV3SolveRequest` (resolver, rules, IF2-17, cadence disagreement, pin cap, C5 limits) | `v3SolveRequest.ts:7-17` | **inherited** (same function) |
| M12 | Every exit fills uncounted specials and instruments (AD-7) | `MonthGenerator.tsx:4416-4451` | **declared difference (D8)**: on a non-success exit nothing is stored; the lines are the browser's |
| M13 | Success: handshake (AD-4), apply by service id (AD-5), then the fills with counted specials skipped | `v3SolveResponse.ts:66-114`; `MonthGenerator.tsx:4440-4450` | **mirror (behaviour)**: the moved `settleV3AutoResult` + `runLocalFills` (step 2), then `cellsToDrafts` with no skips and the fresh roles as `existingRoles` |
| M14 | «Omitir», per-column «Cuenta para equidad» edits, hand edits, «Solo llenar vacíos», unsaved rules | F17 | **declared narrowing**: none has a connector spelling. Omitir's effect is reachable by excluding the date (a weekend) or by deleting the draft in `/admin` |
| M15 | Unavailability notices at preview | `MonthGenerator.tsx:515,3315-3317` | **mirror (behaviour), narrowed by I5** (F15): the moved function over the members filtered by `normalizeMinistries(m.ministries).includes("worship")` |
| M16 | Run report (NT-1–NT-4) | `v3RunReport.ts:35-63` | **mirror (behaviour)**: `buildV3RunReport` with the run's `v3Names` |

**`apply_schedule`** — «Crear N borradores» under v3.

| # | Gate | Evidence | Disposition and test |
|---|---|---|---|
| A1 | Sources ready at confirm (`gateBlocked`) | `MonthGenerator.tsx:2093,4712` | **mirror**: a fresh snapshot (the five sources) and the rules `rev`; any failed read refuses the call before any write |
| A2 | Only drafts creatable in the preview snapshot are candidates | `isDraftCreatable`, `MonthGenerator.tsx:569-586` | **mirror**: a draft whose `atSolve` state was not `creatable` is never posted (it was never in the request either, M9) |
| A3 | Nameless special | `MonthGenerator.tsx:4720-4735` | **structural**: refused at solve (M6); the payload parser refuses a record carrying one |
| A4 | Fresh preflight; a dropped candidate aborts the whole confirm | `MonthGenerator.tsx:4737-4756` | **mirror (D7)** over `pending`, whose own landed creates are already counted as created (`O`). Tests: a candidate turned `blocked` ⇒ refusal, zero PUTs, zero creates; a foreign occupant on a never-posted draft after a failed PUT ⇒ refusal, zero PUTs, zero creates; the same after a deferral (month 2) ⇒ refusal, zero creates; an occupant carrying another receipt id or none ⇒ refusal; the draft's own landed create (weekend and special), absent from `state` ⇒ counted as created by `O`, not posted, checks (a), (b), (c) pass, reported «creado (confirmado por su recibo)» |
| A5 | CF-1 past month and ceiling, CF-4 record refusals, CF-5 month order, CF-7 replay | `v3ConfirmRun.ts:60-129` | **inherited** (same function); the copy is the browser's (`V3_CONFIRM_REFUSAL`, `V3_LINES`) |
| A6 | The create route's refusals (receipt, members, occupancy, history on the date, lock, coordinator, races) | `app/api/admin/roles/route.ts:103-401` | **inherited** through `roleCreateCommit`; each failed draft carries the route's code and a per-service Spanish line (`serviceRefusalLine`, step 6) |
| A7 | «Crear y publicar» | `MonthGenerator.tsx:5803` | **structural**: always `published: false` |
| A8 | The history dual-write (CF-9) | `MonthGenerator.tsx:4671-4690` | **declared difference**: the connector has no `localStorage`; under v3 nothing reads it (ADR-0046) |
| A9 | Rules changed since the solve | — | **connector-only (D11)**: `stale_revision` `rules_changed` |
| A10 | Engine not v3 | — | **connector-only (D2)**, checked on every call |
| A11 | Unknown, expired, other origin or principal, bad payload | — | **connector-only (D10)**: one fixed refusal |

**How the tables are tested.** An inherited row: the tool returns the writer's or the shared
function's own refusal, and the same fixture through the admin path refuses the same way. A
refusing mirror row: zero writes (zero store writes for M rows; zero PUTs and zero creates for A
rows). A behaviour row: a parity or report test. A structural row: a schema test.

## Affected boundaries

| Component | Change |
|---|---|
| `app/components/admin/plannerCalendar.ts` (new, neutral) | `monthDays`, `dayOfWeek`, `longDate`, `weekendNoun`, `refuseSpecialOn`, `refuseWeekendOn`, `CalendarSpecial`, `CalendarExistingRole` moved verbatim from `MonthCalendar.tsx`, which imports and re-exports them |
| `app/components/admin/plannerMonth.ts` (new, neutral) | `SAVED_WINDOW_DAYS`, `savedWindowFor`, its `getDates`, `buildUnavailabilityNotices`, `MIN_YEAR`, `MAX_YEAR` moved verbatim from `MonthGenerator.tsx` |
| `app/components/admin/v3Board.ts` (new, neutral) | `v3StoredFor(…)` (the body of the `v3Stored` memo), `v3PlannedColumnsFor(…)` (`createColumns` → stored-target filter → skip/creatable filter), `runLocalFills(…)` (the pure half of `applySpecialFill`), `settleV3AutoResult(…)` (the state-free half of `applyV3AutoResult`: frozen entries, applied cells, unfilled, notices, report). `MonthGenerator` calls each where it ran the inline code; its setters stay where they are |
| `app/components/admin/monthPreflight.ts` (new, neutral) | `integrityQueueFor({ sources, roles, summaries })`: the `buildIntegrityQueue` call `ServicesPanel.tsx:831-841` makes, lifted (it imports `serviceCardModel` and `serviceIntegrityQueue`, neither imports it); the panel's memo calls it |
| `app/utils/serviceReadQueries.ts` | + `adminRolesQuery()` (the roles GET's GROQ, moved) and `adminMembersQuery()` (the members GET's GROQ, moved; `$all` bound by the caller). Additive exports; the two routes import them |
| `app/api/admin/roles/route.ts`, `app/api/admin/members/route.ts` | GET reads through the shared builders (same text, same params); POST of roles = auth + JSON parse + `createRole(body)` |
| `app/utils/roleCreateCommit.ts` (new, `server-only`) | `createRole(body: unknown): Promise<CommitOutcome<RoleCreateEffects, 200 \| 201>>` — the route's domain body moved verbatim (`roles/route.ts:119-401`, from `parseCreateRequest(body)` on; the JSON parse at `:112-117` stays in the route) |
| `app/utils/commitOutcome.ts` | `CommitOutcome<E, S extends number = 200>` — additive; every existing use unchanged |
| `app/utils/v3MonthPlanReads.ts` (new, `server-only`) | the server reads: snapshot, members (`{ all: true }`), roles rows, stored rules + `rev`, ledger; each isolated so a failure names its source |
| `app/mcp/monthProposals/` (new) | `documentTypes.ts` (import-free names), `proposalDocument.ts` (neutral: build, parse, digest, merge), `proposalStore.ts` (`server-only`, `writeClient`), `handle.ts` |
| `app/mcp/tools/solveMonth.ts`, `applySchedule.ts` (new) | one tool each |
| `app/mcp/writes/runWriteTool.ts` | optional `copy` parameter (the unknown-outcome text names `apply_schedule`); P3 callers unchanged |
| `app/mcp/writes/refusals.ts` | + `serviceRefusalLine(outcome)` for one draft's failure, sharing `CODE_COPY`/`DETAIL_COPY`; `refusalFor` unchanged |
| `app/api/mcp/route.ts` | two `register*` calls; `maxDuration` unchanged (60, still pinned by `mcpRoute.test.ts:578`) |
| `sanity/schemas/mcpProposal.ts`, `sanity/schema.ts`, `app/utils/studioProtection.ts` | the hidden, read-only internal type, as `mcpOauthGrant` |
| Guards | `serviceCommitCallers.test.ts` (+ `roleCreateCommit`: the roles route and `applySchedule.ts`; `fairnessMonthCommit`: + `applySchedule.ts`), `DELIVERY_CAPABLE_IMPORTS` (+ `roleCreateCommit`), `protectedReadAudit.ts` (`roles/route.ts#POST` → `roleCreateCommit.ts#module`, same reason), `mcpSanityClients.test.ts` (+ `proposalStore.ts`: `writeClient`), `scripts/mcp-dev-smoke.mjs` (14 tools, the two new ones listed and never called), `agentDocsParity.test.ts` |
| Docs | `docs/MCP.md`, `docs/API_REFERENCE.md`, `docs/DATA_MODEL.md` (`mcpProposal`), `docs/SOLVER_AND_INFRA.md` (the connector as a v3 caller), `docs/SECRETS.md` (callers of the three variables), `docs/NOTIFICATIONS.md` (apply notifies nobody), ADR-0043 and ADR-0050 amendments, **ADR-0059** (or the next free number at merge), `CLAUDE.md`/`AGENTS.md`, the spec and roadmap amendments, the old plan's status line |
| Production dataset | `mcpProposal.*`; the live proof's record and drafts (Q3) |

No trust boundary moves: both tools dispatch after P0's checks; the store is reachable only through
them.

## Ordered changes

Every step leaves the gates green: `npx tsc --noEmit`, `npm test`, `npx eslint .` with 0 errors (no
`gcf/**` or `gcf_v3/**` change, so no Python gate). One branch, `claude/mcp-p4-v3` from `main`. One
release. `claude/*` pushes build nothing (`scripts/vercel-ignore-build.mjs`).

### 0. Entry

- This plan approved at critical tier with its review log; Frank's go-ahead; Q1 answered.
- `git worktree prune`. Re-verify every cited line on the branch.

### 1. Shared read builders (behaviour-preserving)

- Move the roles GET's GROQ (`roles/route.ts:65-85`) into `adminRolesQuery()` and the members GET's
  (`members/route.ts:23-30`) into `adminMembersQuery()` in `serviceReadQueries.ts`; the routes call
  them with the same params. A test asserts each route passes the builder's exact text (so a later
  edit to one cannot skip the other).
- `draftGatingCoverage.test.ts` stays green with no new exemption (the file is already exempt).

### 2. Neutral moves out of the client files (behaviour-preserving)

- `plannerCalendar.ts`, `plannerMonth.ts` as listed; the client files import and re-export, so no
  test changes an import. `integrityQueueFor` as listed; `ServicesPanel`'s memo calls it.
- `v3Board.ts`: lift each inline block named in F5 into a function of its inputs, the closure reads
  becoming parameters. `MonthGenerator` keeps every setter, ref and lock; it calls the functions
  where the blocks were. `settleV3AutoResult` returns what `applyV3AutoResult` used to set, and the
  component sets it in the same order.
- Proof: the diff is a move (the color-moved review); the v3 suites, `MonthCalendar.test.tsx` and
  `clientBoundary.test.ts` green unchanged; one new unit test per lifted function on fixtures from
  `v3Fixtures.ts`.

### 3. `roleCreateCommit` (critical; ADR-0043's pattern)

- Move the POST's domain body verbatim into `createRole(body)`; the route keeps
  `withVerificationRunContext`, auth and the JSON parse, and sends `outcome.body`/`outcome.status`.
- Registry, delivery list and caller pin as in «Affected boundaries», in the same commit as the
  writer (I1).
- Twin-run tests: the existing route tests unchanged; for each refusal and for create/replay, the
  route and `createRole` on one fixture return the same status and body and commit the same
  transaction.

### 4. Server reads and the planning core

- `v3MonthPlanReads.ts`: `loadServiceSnapshot()` (P1), the members (`adminMembersQuery` bound
  `{ all: true }`), the roles rows (`adminRolesQuery`), the stored rules (`loadStored` of
  `solver-config/route.ts`, moved to `app/utils/solverConfigRead.ts` and called by the route too — a behaviour-preserving move
  inside a production writer's route, since the rules POST reads its `_rev` check through it: the
  solver-config route tests pass unchanged) with its `_rev`, and the ledger (`loadFairnessLedger` with the route's arguments).
- `app/utils/v3MonthPlan.ts` (`server-only`): `planV3Month(input, deps)` — validates the input
  (M4–M7), builds the stored inventory and planned columns through `v3Board`, runs the preflight per
  planned target (M9), then `runV3Auto` with `preRead` = `preReadRefusals`, `storedReady` = the
  inventory verdict, `isCurrent` = `() => true`, `specialsWaiting` = the browser's `countedSpecialIds().size > 0` over the
  planned columns (`MonthGenerator.tsx:4368`), `readLedger` = `loadFairnessLedger(…)` wrapped as
  `{ status: 200, body: JSON.parse(JSON.stringify(ledger)) }` (the browser's body is JSON, so the shape
  is equal by construction) **and raced against the signal by the wrapper itself** — `runV3Auto`'s
  `bounded()` only aborts the signal and awaits the transport (`v3AutoRun.ts:50-61`), and
  `loadFairnessLedger` takes no signal, so the wrapper rejects on `abort` (a test: a never-settling
  read refuses at 20 s). A throw or an abort is `runV3Auto`'s «ledger failed» refusal, as a non-200 is
  in the browser; `isLedgerBody` still checks the body. `build` =
  `buildV3SolveRequest` with `cells: []`, `rows` = `buildRows()` (as at preview,
  `MonthGenerator.tsx:3318`; the same `rows` feed `applyV3Assignments` and `cellsToDrafts`),
  `fillEmpty: false`, a random seed and `requestId`, and
  `postSolve` = `solveV3(request, process.env, fetch, budget)`; on success `settleV3AutoResult` +
  `runLocalFills` + `cellsToDrafts` + `freezeConfirmEntries(sources, "auto")`.
- No React, no `fetch` of an app route, no client import (`clientBoundary.test.ts`).

### 5. The proposal store

- `mcpProposal` Studio type: hidden, every field read-only, governed in `studioProtection.ts` like
  `mcpOauthGrant`.
- `proposalDocument.ts`: `buildProposal`, `parseProposal` (digest check, a strict schema for
  `payload` and `state`, months and drafts bounded: ≤ 2 months, ≤ 40 drafts, payload ≤ 1 MB),
  `mergeState(a, b)`.
- `proposalStore.ts`: `createProposal` (`create`, never `createOrReplace`), `loadProposal` (one
  query naming only `mcpProposal`, through a `$type` parameter, as `grantStore.ts` does),
  `writeState(id, rev, next)` (patch under `ifRevisionId`; on a conflict re-read, `mergeState`,
  retry ≤ 3), `sweepExpired(now)` (D12).
- Tests: create/load round trip; a tampered payload or digest ⇒ the D10 refusal; two concurrent
  `writeState` calls ⇒ the union; a conflict four times ⇒ a reported failure, nothing lost; the
  sweep's grace.

### 6. The two tools

**`solve_month`** — input `{ month, months?: 1 | 2, excludeSundays?, excludeSaturdays?, specials?:
[{ date, name, countsForFairness? }] }`, strict schema (I13); `specials` at most 10 entries and a name at most
80 characters, so a successful solve can never exceed the store's bounds (step 5).

1. Engine gate (D2). 2. `planV3Month`. 3. On a non-success exit: the lines, `retry` per
`v3RetryOffered`, nothing stored (D8). 4. On success with at least one creatable draft: `createProposal`, then the sweep — skipped once 45 s of
the call have passed, and its failure logged by a fixed tag, never failing the call — then the D14
report. A success with **zero** creatable drafts stores nothing and answers that there is nothing to
create (the browser's «Crear» is disabled in that case).

**`apply_schedule`** — input `{ proposal }` (the handle).

An apply may take several calls (D5), and any call may be killed, lose its answer or fail to save its
progress. So every decision and every sentence of an apply call obeys **two rules**, and the table
below is the whole protocol:

- **R-OBS — cumulative facts come from one observation read from data at the start of the call.**
  The stored `state` is a cache that may lag (a failed `state` write, a killed call); it can add
  facts (a created draft later deleted in `/admin` stays «created»), never stand in for a read.
- **R-CALL — negative claims are about this call only, and only when this call knows them.** «En
  esta llamada no se escribió nada» (team data: records and services; the proposal's own `state` is
  not team data) is said only when this call made no domain write, or its only one answered a refusal. A write whose answer was lost (a throw, an abort, a 5xx) is **unknown**, never
  «falló» or «no se creó». No connector line says «No se creó nada» / «ningún servicio» about the
  proposal as a whole, and none attributes a conflict to «otro administrador» (it may be a concurrent
  call of this same proposal). The browser lines that do (`V3_CONFIRM_REFUSAL`, `recordOtherFailure`,
  the guard lines, `monthPartial`; `v3Copy.ts:342-352,445,451`) are true in the browser only because
  its session lives in memory and CF-7 never resends a landed PUT; the connector uses their
  `V3_CONNECTOR_LINES` twins.

**The observation `O`** (phase 1, one read set — the same reads as the solve, `v3MonthPlanReads.ts`
minus the ledger): the snapshot (sources, summaries and its canonical role rows, which carry
`_id`, type, date, name and `creationReceiptId` through `ROLE_PROJECTION`, `serviceReadQueries.ts:20-22`),
the members, the admin roles rows (only for `integrityQueueFor`, M9) and the stored rules with their
`rev`. From the snapshot role rows alone:

- `own` = each draft `d` of the proposal whose `receiptIdForRequestId(d.creationRequestId)`
  (`roleCreationReceipt.ts:257`) equals some row's `creationReceiptId` → that row. Only `d`'s own
  create transaction stamps that id (`roleWriteRequest.ts:231,296`), so `own` is proof, not inference.
- `created` = `own` ∪ `state.created` (by `localId`). A `state.created` entry with no row is
  «creado y luego eliminado en /admin»; one whose row's type, date or name differs from its draft is
  «creado y luego modificado en /admin». Both are failures for `complete` and are never re-created.
- `pending` = the drafts creatable at solve (`atSolve`, A2) not in `created`.
- `stored` = the ids of the rows dated in the horizon months, minus every row of `created`.

| Phase | Reads / does | Refuses (whole call) when | Writes | Answer |
|---|---|---|---|---|
| 0. Gate | engine (D2, before any read); handle format; `loadProposal`; the D10 checks | engine not v3; D10 | none | the refusal; «en esta llamada no se escribió nada» |
| 1. Observe | `O` as above | any read fails or any source not ready (A1); rules `rev` ≠ the bound one (A9, D11) | none | the refusal; no-write line |
| 2. Done? | `pending` empty | — | none | the report from `O` (created, deleted, modified); `complete` per I9 |
| 3. Check | (a) the fresh preflight of every `pending` draft through `integrityQueueFor` (A4, D7); (b) for every `pending` special, `refuseSpecialOn`'s stored-special rule over the rows minus `created` (E19: the preflight is name-blind and the route refuses only the same name); (c) `stored` = the horizon's stored ids frozen in the payload at solve | (a) a draft not `creatable`; (b) any special stored on its date; (c) a stored service added on an unplanned date or deleted | none | the refusal naming the services, `next: solve_month`, plus `created` from `O` («ya existen: …»); no-write line |
| 4. Confirm | `runV3ConfirmAttempt` (D4) inside `callDomain` with `state = { recordsDone: false, createdLocalIds: created }`, so **every call resends the PUT** (this proposal's own records answer `unchanged`, WR-8 row 1; a record replaced by someone else is refused, never trusted from `state`) and posts only `pending`. Both transports record what they **know**: `putRecords` the commit's answer (status 200 with per-month outcomes; a 4xx refusal, which wrote nothing; or unknown — a throw, an abort, a 5xx); `postDraft` each draft's answer (created with its `roleId`, refused with the route's code, unknown, or deferred by the D5 cut-off without posting) | — (the confirm's own refusals are outcomes, below) | the records PUT (atomic across the horizon); the creates | per the outcome rows below |
| 5. Save | `writeState`: `recordsDone` if the PUT answered 200, `created` ∪= `own` ∪ this call's known creates (merge under `ifRevisionId`, D6); then the D12 sweep if under 45 s | — | the `mcpProposal` state | if it fails: the outcome answer plus «no pude guardar el avance; volver a llamar apply_schedule es seguro: lo creado se reconoce por su recibo» |

**Outcome rows of phase 4** (each answer also lists `created` from `O` plus this call's known creates):

| Confirm result | What this call knows | Answer |
|---|---|---|
| `refused_guard` (CF-1: a horizon month passed, or the ceiling) | it wrote nothing (the guard runs before the PUT) | the guard's reason through its twin; «en esta llamada no se escribió nada»; `next: solve_month` |
| `record_failed`, a 4xx refusal (CF-4's 409s, or a 400) | the PUT wrote nothing in this call (a refusal is decided before the one transaction) | the reason through its twin (no «otro administrador»); for `record_exists`, `stale_revision`, `record_missing`: «si otra llamada de apply_schedule con esta propuesta está en curso, vuelve a llamarla en un momento; si no, vuelve a correr solve_month» — a re-call then finds the record `unchanged`; `retry` per `recordRetryOffered`, else `next: solve_month` |
| `record_failed`, unknown (threw, aborted, 5xx, or a 200 whose outcomes `classifyRecordPut` does not accept) | **nothing**: the records may have landed | «No pude confirmar si el registro de elegibilidad quedó guardado; volver a llamar apply_schedule es seguro (si quedó, responde sin cambios)»; `retry: true` |
| `drafts` | per draft: created (with `roleId`), refused (route code), unknown, deferred; the PUT answered 200 | «el registro de {meses} quedó guardado»; per month and service: created now, already created (`O`), refused with `serviceRefusalLine`, «sin confirmar: vuelve a llamar; si quedó creado se reconoce por su recibo», «pendiente: vuelve a llamar apply_schedule». A month's line is composed from that split; `V3_LINES.monthPartial` is never used (it calls every uncreated draft «fallaron»). Later months blocked by CF-5 are «pendiente» |

`complete` (I9) is true only when every draft creatable at solve is in `created`, none deleted or
modified, and nothing is unknown, refused or pending.

### 7. Tests that close the plan

- **Parity (D3), one fixture dataset** evaluated with `groq-js` (the precedent:
  `app/api/__tests__/adminMemberVisibility.test.ts`), one fixed seed and `requestId`, one recorded v3
  response: the real `MonthGenerator` under `v3PlannerHarness.tsx` posts a solve body and, on
  confirm, a PUT body and N create bodies; `solve_month` + `apply_schedule` on the same dataset
  produce byte-identical solve, PUT and create bodies (modulo the minted `creationRequestId`s, which
  are compared by position), and the same proposal content the roadmap's acceptance names: unfilled
  seats, refused specials and the services left out of the request with their reasons. Cases: one month; two months with a stored service and a counted
  special; an uncounted special (the local fills); a planned date that is not creatable (left out of
  the request, still in the fills and the drafts, never posted); an excluded Sunday and an excluded
  Saturday (the input mapping the roadmap's acceptance names); a bound month; a recorded, unbound
  month.
- **Apply recovery** (each answer checked against R-OBS and R-CALL: no «No se creó nada», no «otro administrador», no «falló» for an unknown): kill between the PUT and the first create; kill mid-month; a PUT that lands but whose answer throws ⇒ «no pude confirmar», `retry`; a create that lands but whose answer throws ⇒ «sin confirmar», next call counts it from `O`; a deferral at the
  cut-off; two concurrent applies of one proposal (zero duplicate creates, state is the union);
  CF-1 across a month boundary (fixed clock); each `details.detail` of CF-4; **call 1 lands the
  records and some drafts, a foreign writer replaces a record, call 2 ⇒ an answer naming what exists
  and never containing «No se creó nada»**; **the same with call 1's `state` write failing (or the
  call killed) so `state` is empty, then call 2's PUT failing «other», `record_exists`, or the guard
  refusing a past month ⇒ the answer lists the receipt-proven drafts and contains neither «No se creó
  nada» nor «ningún servicio»**; a special of another name stored on a pending special's
  date ⇒ refusal, zero writes; a stored service deleted or added on an unplanned date ⇒ refusal, zero
  writes.
- **Gate replay**: each row of the two tables, as stated under them.
- **Key hygiene**: the name-shaped fixture of `v3KeyHygiene.test.ts` through both tools — no config
  key, `ruleKey`, member id or body in any output, log line or error.
- **TZ**: both tools' outputs identical under both zones.

### 8. Docs, ADR, amendments (same delivery)

- ADR-00NN «The connector plans months only on v3, through the browser's own Auto and confirm»:
  D1, D2, D4, D6, D7, with the rejected alternatives (Fluid; a v2 path; a lease; skip-and-report),
  and the two accepted gaps it shares with the browser: seat edits inside a stored service between
  solve and apply go undetected, and two **different** proposals for one horizon applied at once can
  interleave when their frozen entries are identical (the second PUT answers `unchanged`).
- ADR-0043: `roleCreateCommit` joins the commit modules. ADR-0050: the executor is still the one
  writer; `fairnessMonthCommit` gains the connector as a second caller. The C2 spec
  (`docs/superpowers/specs/2026-10-05-solver-v3-c2-ledger-and-record-design.md`; its `:141`, IF2-23 at
  `:779`, the non-goal at `:290`) is amended to match: WR-1 «its only
  caller is the route» becomes «the route and `apply_schedule` (still actor `route`; `recordedBy` the
  grant's member id, REC-2's effective identity)», IF2-23's caller list likewise, and
  its non-goal «MCP access to records or the ledger» is narrowed to «no MCP read or edit tool for
  records; `solve_month` reads the ledger and `apply_schedule` writes through the commit module».
- `CLAUDE.md`/`AGENTS.md`: the commit-callers invariant names the six admin write paths; the
  fairness-ledger invariant names `apply_schedule`.
- `docs/MCP.md`: tools, store, refusals, the live-proof record; the status banner rewritten (P4 on
  v3). The old plan's status line: «Superseded by `2026-10-20-owt-mcp-p4-v3-solve-apply.md`».
- The spec and roadmap amendments below, each listed as post-approval in its review log.

### 9. Release (CLAUDE.md order, without exception) and live proof

1. Gates green → one fresh `code-reviewer` on the merge range (with the docs-audit and worklog
   checklists) → fixes → gates on the final tree (a scoped re-review only for a HIGH fix).
2. Merge into `preview`, push, verify the dev alias (`alias` + `githubCommitSha`). Because step 2
   refactors `MonthGenerator` and `ServicesPanel`, one v3 Auto is run on dev in `/admin`
   (`scripts/dev-verify.ts` or Frank's look) **without confirming** — a solve writes nothing — and the
   board, report and Equidad tab are compared with production's for the same month. `dev` cannot be
   reached by claude.ai (Deployment Protection; roadmap decision 5): dev proves the build and the
   dev smoke (`scripts/mcp-dev-smoke.mjs`, which lists 14 tools and calls neither new one).
3. PR to `main`, `gates` green, merge, verify the production alias.
4. **Live proof on production, Frank present, each line his go:** L1 `solve_month` on the Q3 month
   (record the server `ms` and that the Claude app received the answer — AS1); L2 `apply_schedule`
   (record per-create `ms` — AS2); L3 call `apply_schedule` again (no write, «ya creado»); L4 Frank
   reads the drafts and the Equidad panel in `/admin`. Then Q3's cleanup.
5. Record in `docs/MCP.md` (aggregates only) and close.

## The time budget

| Call | Worst case | Typical (F1, F13) |
|---|---|---|
| `solve_month` | reads ≤ ~6 s; ledger ≤ 20 s (then refused); solver ≤ 45 s, clamped so the call ends by 52 s; store write + sweep ≤ ~3 s | ~10 s |
| `apply_schedule` | reads + preflight ≤ ~5 s; PUT ≤ ~5 s; creates start until 40 s and one in flight may end ~45 s; two `state` writes ≤ ~2 s | one call per ~15 drafts |

A call killed at 60 s anyway leaves the same state a lost answer does: the PUT is replay-safe, every
create is replay-safe through its receipt, and the next call's observation counts a create that landed unseen as created by its receipt id (D7).

## Data and failure safety

| Moment | What exists | What Frank is told | Recovery |
|---|---|---|---|
| Any refusal before the PUT | Nothing new from this call | The refusal | As it says (re-solve, retry, wait) |
| PUT refused (CF-4) or failed, any call | Whatever earlier calls left (records, drafts) | The reason (connector twin) plus `exists`, read from data (the one answer rule); never «No se creó nada» | Re-solve (conflict, team changed, past month), retry (other), or re-call if another apply of this proposal is running |
| Seven days pass: Tipo, availability or a stored service's seats change | The proposal as solved | Team or Tipo changes refuse the PUT on create/replace (CF-4 `member_unknown`/`member_not_worship`); availability and seat edits are not re-checked (the spec's bounded window) | Re-solve when in doubt; the report shows the solve date |
| PUT landed, answer lost / call killed | The records | «No pude confirmar si el registro… quedó guardado; volver a llamar es seguro» | Call again: the PUT answers `unchanged` |
| Some drafts created, call killed or cut off | Records, those drafts | Per month and service; «pendiente» or «sin confirmar» | Call again: every created draft, seen or not, is counted from data by its receipt id and not resent |
| A date taken by someone else since the solve | Records maybe, earlier drafts | The refusal naming it (D7) | Re-solve: the new solve fixes that service and the already-created drafts |
| A created draft deleted in `/admin` | The rest | «creado y luego eliminado en /admin», not complete | Re-solve if wanted; this proposal never re-creates it |
| `state` write fails after creates | Records, drafts | The outcome plus the phase-5 failure line | Call again: the observation finds the drafts by their receipt ids |
| Proposal expired | Whatever was applied | The D10 refusal | Re-solve |
| A deploy between solve and apply changed the create body or its canonical form | Whatever was applied | A pending draft whose earlier post's answer was lost and whose role was then deleted (its key retired) is refused by the route per service; a landed one is counted by `O` and never re-posted | Re-solve |

Nothing is deleted or rewritten to compensate (CF-6). The live proof's leftovers: Q3. If L4 finds the
live-proof month's drafts or record wrong: Frank deletes the drafts in `/admin`, which leaves the
month recorded and unbound, and the next `/admin` Auto plus confirm replaces the record (C2 WR-8).

## Verification (requirement coverage)

| Requirement | Proven by |
|---|---|
| Same Auto as `/admin` (roadmap: request parity, proposal parity from one recorded answer) | D3's shared calls; step 7 parity |
| Records before drafts, month order, past-month guard, replay | D4's shared call; step 7 recovery tests |
| Each service created at most once across retries and concurrent applies | F11, F12, D6; step 7 |
| Refusal parity (I15) | Tables M and A; gate replay |
| Drafts only, nobody notified (I8, F10) | A7; a test asserting zero outbox upserts and zero pushes |
| Honest outcomes (I9) | R-OBS and R-CALL (step 6, `apply_schedule`); every apply answer per month and service; `complete` false on any pending, refused, unknown, deleted or modified; the recovery tests |
| Worship scope (I5) | M15; the request is worship-only by RES-5 |
| Key hygiene | step 7 |
| `/admin` unchanged | the move proofs (steps 1–3) |

## Rollout, observability, rollback

- **Observability:** the existing `[mcp] tool=… outcome=… code=… ms=…` line per call; the solve's
  outcome class as the route's KH-2 line logs it (never a body).
- **Rollback:** remove the two registrations, the two tool files and their pin rows in one commit;
  `roleCreateCommit`, the shared builders and the moves stay (they are the admin's code path now);
  `mcpProposal` records are private and expire. A flip back to v2 disables both tools by itself (D2).
- **Stop conditions:** any parity mismatch; a duplicate create in any test; a live-proof answer that
  claims success the drafts in `/admin` contradict.

## Assumptions

| Assumption | If false | Checked at |
|---|---|---|
| AS1: claude.ai waits for a tool answer of up to ~52 s (P3's buffering means it receives nothing until the tool ends) | an answer is lost; a re-call converges (D6); the 40 s create cut-off becomes one constant lowered to what L1 measures | L1/L2, recorded as seen in the Claude app |
| AS2: a create costs ≤ ~2.5 s server-side (F13) | more apply calls per month, nothing else | L2's per-create `ms` |
| AS3: the payload of a 2-month proposal stays well under 1 MB (the frozen entries of ≤ 100 people per month plus ≤ 40 drafts) | the store refuses and nothing is stored | a unit test on the largest fixture; L1's stored size |
| AS4: Sanity reads its own writes for the record (default `visibility: "sync"`) | a `state` write conflicts and re-merges | store tests; L3 |

## Open questions

| Question | Recommendation | Default | Blocks |
|---|---|---|---|
| **Q1** (asked 2026-10-20): `revise_proposal` here or in its own plan? | **Its own plan.** Editing stays possible in `/admin` on the drafts before publishing. If Frank picks «here»: the plan gains the old step 9 re-based on v3 (the `rankCandidates` gate, a revision counter), and D6 gains back a lease, because revise would mutate the payload apply reads | own plan | step 0 |
| **Q2**: confirm the spec amendment of D7 (refuse the apply when a date was taken since the proposal, instead of skipping that service) | **Confirm.** Under v3 a re-solve takes seconds and treats the new service as fixed; skipping would create a month the solver did not plan, under records frozen for another plan | D7 | step 6 (apply's protocol depends on it; a «skip» answer reopens this plan's review) |
| **Q4**: confirm D8 (a failed solve stores no proposal, where the spec says «a bound proposal… marked as partial» on a solver failure and the browser keeps a fills-only board) | **Confirm.** The connector has no hand surface to finish a fills-only board, so applying one would create weekends with empty voices; a failed solve answers with the browser's own line and Frank re-solves or finishes in `/admin` | D8 | step 6 |
| **Q3**: the live-proof month and its cleanup | **The next month Frank actually plans** (one with no services yet), solved and applied from the Claude app, the drafts **kept** as real work, reviewed in `/admin` before he publishes. Nothing needs cleaning, and the record is the real one. Alternative: a far month (≤ current + 12, HZ-9) whose drafts Frank deletes in `/admin`; its record **stays** (only C4's reconstruction actor deletes one), and the real Auto months later finds it «recorded, unbound» and replaces it, so nothing is lost but the dataset carries a proof record until then | the next real month, kept | step 9 |

## Spec amendment (post-approval, to be recorded in the spec review log)

| Clause | Amended to |
|---|---|
| I14 (`:155`) | «`solve_month` writes no domain data: it stores only a private, expiring proposal record (`mcpProposal.*`) and is declared neither read-only nor destructive. `apply_schedule` is destructive.» |
| `solve_month` (`:219`) | «Runs the planner's **v3** Auto for 1 or 2 months (stored services fixed, counted specials pre-filled, the fairness ledger read fresh); refuses under any other engine. On any exit but success it stores nothing and returns the browser's own line. Completes inside 60 s (measured ~10 s).» The v2 sentences (positional weeks, `objective_skipped`, P2 history) are removed |
| `revise_proposal` (`:220`) | «Not in the v3 P4 delivery; planned separately (Q1).» |
| `apply_schedule` (`:221`) | «Runs the browser's v3 confirm: one record entry per horizon month first, then the drafts month by month. Bound by a server-stored record named by an unguessable handle, scoped to origin and principal; 7-day expiry. A date that stopped being creatable since the proposal refuses the call before any write (re-solve), as the browser's confirm does; the per-service skip is withdrawn (Q2). Resumable: a call that runs out of time reports what is pending and the next call finishes.» |
| B1 (`:59`), «fits inside 60 s» (`:318`) | «Holds under v3 (measured); no ceiling change.» |
| C6 spec KH-1 (`2026-10-05-solver-v3-c6-planner-v3-design.md:313`) | add: «Exception: the connector's `mcpProposal` record stores the frozen PUT entries (with their `ruleKey`s) under a private dotted id between `solve_month` and `apply_schedule`, as the `fairnessMonth` records they become do; it never renders, logs or returns them.» |
| (new, beside O5) | «The proposal record holds member ids, dates, row ids, kinds, special names and the frozen eligibility entries its apply will write, under a private dotted id; it is never returned to the model. Those entries carry `ruleKey`s, as the `fairnessMonth` records they become do (C6 KH-1's copy rule applies to code paths, not to this stored payload); the record is swept on every solve and apply once 24 h past its expiry.» |

## Roadmap amendments (post-approval, to be recorded in the roadmap review log)

- **P4 row:** re-baselined onto v3; Outputs: `roleCreateCommit`, the shared read builders, the
  neutral planner moves, the `mcpProposal` store; **no Fluid**. Acceptance: parity with v3 Auto and
  the v3 confirm (step 7). Rollback as above.
- **P2 → P4 transition** (`:189`): void under v3 (no history is sent, ADR-0046).
- **P4 live run** (`:115`): «on a month with no existing services, and its drafts are removed
  afterwards» becomes «on the next month Frank plans (no services yet), its drafts kept as real work
  and reviewed in `/admin` before publishing» (Q3's default; the far-month alternative keeps the
  original wording).
- **`revise_proposal`:** its own later delivery (Q1).
- **Contract row `solve_month`** (`:168`): «writes nothing» → «writes only its private proposal
  record»; «a CP-SAT failure returning a partial proposal» → «any non-success exit stores nothing»
  (D8); the v2 wording (CP-SAT, the 56-day window as the solve input, a deselected Sunday) → the v3
  Auto's inputs (stored services fixed, the ledger read fresh, weekends excluded by date).
- **Contract row `apply_schedule`** (`:170`): «skipped and reported» → «a target lost since the
  solve refuses the call before any write» (D7, Q2); «reports which proposal revision it applied» →
  void until `revise_proposal` exists (proposals have no revisions without it); `revise_proposal` as a
  source is removed until then.

## Handoff

- **Adversarial review:** this plan alone, sequentially; two fresh verdicts on byte-identical text;
  prior findings never shown to a reviewer; the churn cap binding.
- **Implementation authorization: not granted by this plan or by its approval.** Frank's go-ahead is
  required.

## Terminal state

READY_FOR_ADVERSARIAL_REVIEW
