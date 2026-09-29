# OWT MCP P4 — solve, revise and apply a month (implementation plan)

**Date:** 2026-09-28 · **Status:** Approved at critical tier on digest 93c4e227… (rounds 7 and 8); post-approval changes listed below are un-reviewed; the review log is `docs/superpowers/plans/2026-09-28-owt-mcp-p4-solve-apply-review-log.md`

## Original request

> The **P4** row of [`2026-09-22-owt-mcp-roadmap.md`](2026-09-22-owt-mcp-roadmap.md):
> "`solve_month` + `revise_proposal` + `apply_schedule` per the spec. **Accepted on solver-boundary
> parity**: from the same dataset, history and selections the connector builds the same solve request
> as the browser's Auto (production requests carry no seed on either side, so request parity needs
> none; the proposal is compared from one recorded solver response, never from two live solves,
> because CP-SAT is randomly seeded and bounded by a 40 s wall clock), and from one recorded solver
> response it produces the same proposal — voices, the local instrument and special fills, refused
> specials and the unfilled-seat report. […] Also accepted when applying never touches a target the
> admin create refuses — occupied (published or draft), a raw draft, or a date already holding a
> setlist or proposal — and reports each one, a retry never creates a service twice, and a partial
> apply is reported per service rather than as a whole-month success. **Not atomic across the
> month** […]. `apply_schedule`'s first live run is on a month with no existing services, and its
> drafts are removed afterwards."

Frank's own decisions for P4 (2026-09-28, recorded in the cycle evidence file):

> Proposal binding: a SHORT ID resolving to a server-stored proposal (hidden, expiring).
> Expiry: 7 DAYS. Fluid compute: «Es gratis? Si es gratis, lo puedes activar» — verified free on
> Hobby (4 h Active CPU, 360 GB-hrs, 1M invocations included; no on-demand line, so never billed).

The coordinating agent requested this plan for cycle `2026-09-28-mcp-p4-plan`, with rulings
**P4-R1…P4-R14** (carried in § «Decisions», table «Coordinator rulings») and the measurement of
2026-09-28 16:50 CST (F1). The evidence file is
`owt-agent-logs/sdd/2026-09-28-owt-mcp-p4/evidence.md` (outside this public repo).

## Status and contract

- **Document status:** Approved at critical tier on digest 93c4e227… (rounds 7 and 8); the
  post-approval changes listed in the next section are un-reviewed. **Risk tier: CRITICAL.** P4 extracts
  a production writer (the admin create, `roleCreateCommit`), adds a stored-record protocol with
  concurrency and idempotency across revisions (the proposal store and its apply lease), changes a
  platform setting for every function (Fluid compute: a concurrency change for all of them, and —
  because every function that declares no `maxDuration` is re-capped at its old 10 s — a duration
  change for none), and ends in an irreversible remote release action. It needs two sequential fresh `APPROVED` verdicts on byte-identical text, plus a committed
  review log beside this file. Proposed committed path:
  `docs/superpowers/plans/2026-09-28-owt-mcp-p4-solve-apply.md`, with
  `2026-09-28-owt-mcp-p4-solve-apply-review-log.md` beside it.
- **Accepted requirement sources:** the spec
  [`2026-09-22-owt-mcp-design-v2.md`](../specs/2026-09-22-owt-mcp-design-v2.md) (approved; the three
  tool rows `:219-221`, `:223-248`, invariants I1–I15 `:140-156`, «Error handling, testing, first
  live exercise» `:250-279`, Rollout `:281-292`, Decisions `:296-310`, Assumptions `:312-320`),
  **as amended by § «Spec amendment» below** (post-approval, un-reviewed until recorded in the spec
  review log); the roadmap P4 row (`:115`), its coverage rows `solve_month`, `revise_proposal`,
  `apply_schedule`, INT, DV1, E1, I1–I3, I5–I9, I12–I15, TZ (`:132-172`) and the P2+P3 → P4
  transition (`:189`).
- **Primary outcome:** from the Claude app, Frank asks for a month, gets a proposal equal to what
  `/admin`'s Auto would produce from the same data, edits it through server-judged edits, and applies
  it as draft services — each created exactly once, each refusal reported per service, nothing
  published and nobody notified.
- **Preconditions (step 0):**
  1. This plan approved at critical tier, with its review log. Frank's go-ahead to implement.
  2. P3 exit criteria met — **met 2026-09-28** (PR #106, `main` `7c65f2eb`, live proof passed).
  3. **P2 D2 (the cutover to the derived history) is RELEASED before step 12** (P4-R1). **Status
     2026-09-28:** merged to `main` as `98aa67a9` (`git ls-remote origin refs/heads/main`, read
     2026-09-28), `SOLVER_HISTORY_SOURCE = "derived"` at `app/components/admin/solverHistorySource.ts:36`
     on the cutover branch that merge carries — **RELEASED: production alias verified 2026-09-28**
     (deployment `dpl_3TFsEhFDhapfCaCW6xTHZJDjuspz`, `owt-backstage.vercel.app` in `alias`,
     `githubCommitSha` `98aa67a9`), the record step 12's entry requires. Beyond
     the process gate, `solve_month` itself refuses while the constant is not `"derived"` (M23, D22),
     so a build that lacks the cutover — or rolls it back — can never solve against a history
     `/admin` does not use.
  4. Frank answers Q1 (the spike's early create measurement) and Q2 (the throwaway month) at step 0,
     and sees Q4 — a declared narrowing of the roadmap's rollback (the live run's leftovers are not
     cleaned) — before step 12.
- **Safe ending state:** Fluid compute on for the project (`vercel.json`), every function that
  declares no `maxDuration` still limited to 10 s (observed at each release, step 1), a connector with **15 tools**
  (`ping`, seven reads, four P3 writes, `solve_month`, `revise_proposal`, `apply_schedule`), each P4
  tool proven once on production against a month with no services, the throwaway drafts removed by
  Frank in `/admin`. The only new stored data is `mcpProposal.*` records, private, expiring after 7
  days and swept.
- **Line numbers** are at `main` `7c65f2eb` (read in the worktree at `claude/mcp-p3-release-record`
  `89e783e4`, whose `app/**` equals `main`). The P2 cutover (now on `main`, `98aa67a9`) changes
  `MonthGenerator.tsx` by comments only — +1 line from `:1112`, +2 from `:1751`, +3 from `:2087`, +4
  from `:2093` (so `handleConfirm`'s abort, `:3590-3606` here, is `:3594-3610` at `98aa67a9`) — and
  flips the switch constant (`solverHistorySource.ts:36`, cited at `98aa67a9`); every other line cited
  under `app/**` is unchanged. Every step re-verifies its cited lines against the branch it is
  implemented on. **`main` has since moved to `e8660b26`** (PR #109, ADR-0044; PR #110, ADR-0045):
  `MonthGenerator.tsx` is unchanged, while `PlannerGrid.tsx`, `plannerModel.ts` and
  `ServicesPanel.tsx` moved — the offsets, and the one retired UI element (R8's «+N»), are in
  post-approval change 10 (below); the citations in this plan keep their `7c65f2eb` numbers.

## Post-approval changes — un-reviewed (after digest 93c4e227…)

These ten changes were made after the two approving rounds (7 and 8) on digest `93c4e227…` and are
**outside that approval**. Each is applied inline where it belongs and marked there «post-approval
change N», so every un-reviewed sentence is greppable. The coordinator decides which need a review.

| # | What | Where | Why | Source |
|---|---|---|---|---|
| 1 | `docs/SECRETS.md`'s existing `OWT_SOLVER_API_KEY` entry is updated in the same delivery: the platform table names `app/utils/solverCall.ts` (`runSolve`) as the one sender, called by `/api/admin/solve` and `/api/mcp`'s `solve_month`; «Purpose» adds `solve_month`; «Blast radius of rotation» adds that mid-rotation `solve_month` takes M13's solver-failure arm and answers a fills-only partial proposal. No new entry, no value | § «Non-goals» (the SECRETS bullet: «untouched» → «no new entry; the existing entry updated»); § «Affected boundaries» (the docs row); step 11 «Docs, same delivery» (new bullet) | After step 4a the entry (≈ `:494-497` platform table, ≈ `:550-554` blast radius on `main`) names a sender that no longer exists and omits the connector's dependency — the repo's secrets rule | coordinator, post-approval |
| 2 | X6's rationale split: browser parity holds for a target shown `blocked` (its preflight snapshot refreshes, `MonthGenerator.tsx:2519-2536`) but **not** for one shown `exists` — `isExisting` reads the `existingRoles` prop, which the open dialog never refreshes — so posting a formerly-`exists` target is the connector's declared difference, kept for the re-solve reason. Wording only; the post was already declared | step 6b («That post is a stated decision»); row A5 | The approved text overstated browser parity for `exists` | coordinator, post-approval |
| 3 | (P) states up front that most runs will be inconclusive (F1: 7 278–10 279 ms against an 11 000 ms bar) and that Release A may need several cold windows — an expected schedule cost, never a reason to lower the bar or defer | step 1, (P) | Sets the expectation the numbers already imply | coordinator, post-approval |
| 4 | (O-a) records `config.isUsingActiveCPU` beside `config.functionType`; alone it proves nothing, so the Fluid criterion is `functionType === "fluid"` with `isUsingActiveCPU` agreeing, and no failure arm is chosen on `functionType` alone: arm (i) needs both to say Fluid is off, and a disagreement stops the release for Frank | step 1, (O-a) and arm (i) | A second, independent Fluid signal before an irreversible-looking branch (the fallback is Frank's dashboard action) | coordinator, post-approval |
| 5 | Apply's rules read and the `rules_changed` check move to step 10.3 (the fresh reads, after the claim, inside the `try`, so `finally` releases the lease); step 10.1 keeps the schema, `loadProposal` and the binding checks only. A1 already listed the rules among the fresh reads and needs no edit | step 10.1, step 10.3 | 10.1 checked the rules «as bound» with no rules read before it, 10.3 omitted the rules, and A1 listed them — three places, two answers; revise's 9.2 already reads the rules with the other fresh reads | coordinator, post-approval |
| 6 | One Vercel usage reading after L7, in the baseline's form, against the pre-Fluid baseline and the soak's last reading, recorded in the evidence file and the P4 record; a projection above 50 % escalated | step 15 | The live proof's usage was otherwise never read | coordinator, post-approval |
| 7 | **The Default Max Duration is set later.** Frank sets it only **after Release A's code review passes, immediately before the `preview` merge**, and **no production deploy of anything** happens between setting it and a passing (P); if one must, (P)'s check runs on that production deployment first (a fail: Frank returns the setting to its pre-release state and production is redeployed; an inconclusive run is not a pass, the freeze continues). Consequences applied: the record line, the dates in `docs/CI.md`/`docs/SOLVER_AND_INFRA.md` and `fluidCeiling.test.ts`'s fourth assertion land in a post-review **record commit** with its scoped re-verify; arm (iii) states production was never built under the explicit value; both rollbacks (step 1's and § «Rollout»'s, and the fallback's) return the setting to its pre-release state instead of «it stays», so the plain rollback is no longer a one-line PR (Change 2's SMTP stop condition and the fallback's contrast now point at it) | § «Affected boundaries» (the setting's row); step 1 Change 1, Change 2's stop condition, Change 3's assertion 4, «Release A», «Rollback», arm (iii), the fallback's rollback; § «Rollout» «Rollback, Fluid» | Set before the review, the setting reached production builds of unrelated PRs merged meanwhile while an explicit dashboard value's rank against code was unproven (arm (iii)); the rollback's «stays: without Fluid it changes nothing» assumed exactly what arm (iii) doubts | coordinator, post-approval |
| 8 | The sweep-on-solve choice no longer cites «one of Hobby's two cron slots»; the stated reason is that a cron buys nothing (the store grows only on a solve, and an expired record is refused on use) while adding a schedule and a second entry point into the store (a `CRON_SECRET` route) | step 7 «Expiry and sweep»; D8 | Vercel raised Hobby's cron allowance, so the count claim is false; the choice stands on its other reason | coordinator, post-approval |
| 9 | AS7 stays declared; the AS7 row names `completeResponse`'s buffering (claude.ai's wait covers the whole server time), and L1 and L4 record received / not received, as the Claude app shows it, beside the server `ms`, **explicitly as AS7's validation** (L4 previously did not) | § «Assumptions» AS7; step 13 L1, L4 | The validation was named but not recorded as such at L4 | coordinator, post-approval |
| 10 | **`main` moved to `e8660b26`** (PR #109, ADR-0044, the Servicios board scroll; PR #110, ADR-0045, named/draggable grid chips, «+N» retired). (a) P4's ADR is **ADR-00NN (next free at merge)** — 0044 and 0045 are taken; the plan already named no fixed number (step 11 said «next free number at merge»), now spelled so in step 11 and the boundaries row. (b) Step 3 re-verifies every planner citation against `e8660b26` before extracting (new bullet). **Unchanged files:** `MonthGenerator.tsx` (so `getDates`, `savedWindowFor`, `buildUnavailabilityNotices`, `historyMonthsLabel`, `MIN_YEAR`/`MAX_YEAR`, `handleAuto`, `applySpecialFill`, `handleConfirm`, `isDraftCreatable` keep the offsets the status block states), `MonthCalendar.tsx`, `moveOccupant.ts`, `moveGate.ts`, `monthDraftCreate.ts`, `localFill.ts`, `instrumentFill.ts`, `candidateRanking.ts`, `ruleEnforcement.ts`, `serviceCardModel.ts`, `solverHistorySource.ts`, and all of `app/utils`, `app/api`, `app/mcp`, `sanity`, `scripts`, `gcf` (one colour fixture aside). **Moved, bodies unchanged** (old → new): `PlannerGrid.tsx` +1 from `:20` (a header-comment edit) to GridCellView — `onToggleSkip` 237→238, `withUpdatedCell` 454-498→455-499, `categoryDuplicatesForColumn` 507-541→508-542, `:679`→680, rule violations 700-754→701-755 (call 742-750→743-751), `rankFor` 756-787→757-788, `toggleCandidate` 852-866→853-867 (841-842→842-843, 858-861→859-862, 863/864→864/865), override 888-916→889-917, Auto 2007→2008, unaddressable 2046-2047→2047-2048, diagnostics 2081-2092→2082-2093; −12 after GridCellView — the pick-time badges «No disp.»/«Sin declarar»/«Ya asignado» 3014-3028→3002-3016. `plannerModel.ts` +2 from `:392` (a doc-comment edit; everything above unchanged, `VOICE_TARGETS :304`, `buildRows :310-329`, `rowAppliesTo :361-368`) — `hasTarget` 400-408→402-410, `buildColumns` 425-464→427-466, `weekendWeekIndexes` 501-508→503-510, `unaddressableDates` 528-531→530-533, first-match 551-557→553-559, `buildSolveRequest` 697-839→699-841, `:1057-1061`→1059-1063, `cellsToDrafts` 1084-1167→1086-1169 (`isExisting` 1109-1110→1111-1112), nameless 1182-1184→1184-1186. `ServicesPanel.tsx` +15 from `:112` (layout constants) — `loadSources` 403-446→418-461, `:815-825`→830-840, `:859-863`→874-878, `:916,1040,1099`→931,1055,1114, the `MonthGenerator` wiring 1025-1042→1040-1057, unchanged in substance. **Changed:** `GridCellView` (old `:2620-2876`) — R8's cited `PlannerGrid.tsx:2635,2873` (the «+N» machinery) no longer exist; the over-target warning is now named amber chips plus «Por encima del objetivo — se acepta de todos modos» (`:2869-2871`). **Premises: none changed.** R8's premise — over target warns, never refuses, and no cell refuses for count (D6) — holds (the element it names changed; R8 annotated inline); R14's cap derivation is untouched. **One wording follow-on:** the connector's warning copy «+N sobre el objetivo» (step 6b, `judgePlacement`) named the retired pill — resolved by change 11. Also: the planner tests the plan says pass «unchanged» (`PlannerGrid.test.tsx`, `plannerGridPickPlace.test.tsx`, `plannerGridDrag.test.tsx`, `plannerModel.test.ts`) changed on `main`, so «unchanged» is relative to `e8660b26`; the diff adds no top-level `let`/`var` or mutated module collection, so Change 2 (i)'s eight rows are expected unchanged (the scan re-runs at Release A regardless) | status block (line-number note); step 3 (new bullet); R8; step 6b's warning list (flag); step 11 and § «Affected boundaries» (the ADR) | The plan extracts from and cites planner files two merged PRs changed after the approval | coordinator, post-approval; offsets from `git diff 98aa67a9 origin/main -- app/components/admin/` |
| 11 | The connector's over-target warning (step 6b, `judgePlacement`) reads «Por encima del objetivo», the grid's wording since ADR-0045, instead of «+N sobre el objetivo», which named the retired pill. Copy only: it still warns and never refuses (R8, D6) | step 6b's warning list | Ruling on change 10's flag: the connector mirrors `/admin`'s copy, and the other three warnings are already the grid's own strings | coordinator, post-approval |

## Findings that change or sharpen the binding inputs

Read these first. Each was verified at `7c65f2eb` unless it says «measured».

| # | Finding | Evidence | Consequence in this plan |
|---|---|---|---|
| F1 | **Measured on dev:** a real Auto for October 2026 (4 Sundays, 5 Saturdays, 15 real rules, derived history Jul–Sep) took `/api/admin/solve` 10 279 ms (first) and 7 278 ms (warm), and `/api/admin/solver-history` 526 / 517 ms — browser resource timings, network included | evidence.md «Measured on dev» (2026-09-28 16:50 CST, build `d400379e`) | A typical `solve_month` is ~10–15 s. B1's 60 s does not bind the solve; the apply loop and the 120 s solver abort (P4-R3) size the ceiling (§ «The time budget»). The spike narrows to GCF cold start, a 5-Sunday month and per-create time (step 2) |
| F2 | **Fluid compute is off; turning it on would move every undeclared function from 10 s to 300 s, and nothing on Hobby could watch that.** Fluid lifts the ceiling from 60 s to 300 s and can be set per deployment with `vercel.json` `"fluid": true`, versioned and revertible in git. Its default duration is also 300 s, and it lands on **every function that declares no `maxDuration`**. Those run today at the legacy **10 s**, which is Vercel's default and **not a project setting**: the project API reads `defaultResourceConfig.functionDefaultTimeout: 10` with no `functionDefaultTimeout` in `resourceConfig`, and the production deployment reads `config.functionType: "standard"`, `config.functionTimeout: 10` (both read 2026-09-28 with `npx vercel api`; the repo's own record, `app/api/admin/solve/route.ts:98`; 60 s is the legacy MAXIMUM, evidence.md «Coordinator findings») — so Fluid would replace it. That is **44 of the 61 `route.ts` files** and **every server-rendered page**: none of the 16 `page.tsx` files under `app/` (the `__fixtures__` copy aside) declares one, and the pages that render or revalidate on invocation (`revalidate = 60`/`3600`/`0`, `force-dynamic`, and every worship page `requireWorshipPage` makes dynamic, ADR-0020) run as functions, as do Next's own `_not-found` and `proxy.ts` (its `config`, `proxy.ts:31`, is a matcher and names no runtime); the repo has no `"use server"` action. A 30× runaway window could only be policed by per-path durations, and **Hobby has none**: its runtime logs carry no request duration and the Observability API answers 404 (`docs/MCP.md:942-945`), and it keeps about an hour of them (`docs/NOTIFICATIONS.md:528-529`) | evidence.md «Coordinator findings», «Fluid compute cost»; `vercel.json:1-4`; `solve/route.ts:98`; `find app -name route.ts` (61) vs `grep -l maxDuration` (17); `grep -rn maxDuration app/(client) app/(admin) app/(gallery)` (none); Vercel docs «Fluid compute» → «Order of settings precedence» (function code > `vercel.json` > dashboard > Fluid defaults) | Step 1 is Fluid, its own release, preview first (P4-R2), and it **re-caps** every undeclared function at 10 s (D24) by **one mechanism**: the project's **Default Max Duration = 10** (Settings → Functions; set by Frank, read back by the agent, recorded), which reaches route handlers and pages alike. There is **no `vercel.json` `functions` glob** (P4-R14): a glob sits above the dashboard in that order, so a glob that out-ranked a route's own `export const maxDuration` would cut `/api/admin/solve` (60) to 10 s, and its per-function effect could not be observed without writing the preview environment to disk. The dashboard sits **below** function code, and code already out-ranks the default in this project (the Platform evidence row; AS9). Release A's verify step **observes** the effective limits — the deployment's and the project's readings, and a real call past 10 s on a declared route — instead of assuming them. Fluid then changes the duration only of a function that declares one: the 17 that declare `60` keep it; Release B's `/api/mcp` declares 180 |
| F3 | **Under Fluid, concurrent invocations share one instance's module state.** Only one binding can change behaviour: `cachedTransport` (`app/utils/email.ts:144-183`), the pooled SMTP transport — two overlapping layer-2 sweeps in one instance now share its `SEND_CONCURRENCY` (8) connections. Stage 7 admits a wave only if `SEND_TIMEOUT_MS` (20 s, which includes pool queue wait, `email.ts:166-170`) still fits (`outboxSweep.ts:989-1004`), and the budget tail is **re-pended, not destroyed** (`:1025-1037`). The other bindings are safe (step 1's table: the eight bindings a text scan finds, plus the stateful instances it cannot see, reviewed as commentary) | `app/utils/email.ts:24,144-183`; `app/utils/outboxSweep.ts:338,659,989-1037`; `app/utils/memberAccess.ts:12`; `app/mcp/oauth/grantStore.ts:55`; `app/utils/srVerificationRunContext.ts:72` | Resolved in step 1 by analysis, a pinned audit test (exactly its scanner's hit set), an observation read from the flush workflow's durable runs, and a stop condition — not deferred |
| F4 | **The browser path runs more client-bound code than P4-R4 lists.** Beyond `getDates`/`savedWindowFor`, the calendar refusals, `withUpdatedCell` and `callRemoteSolver`, Auto and its reports also run `applySpecialFill`'s fill orchestration (`MonthGenerator.tsx:3259-3304`), `buildUnavailabilityNotices` (`:389-405`), `historyMonthsLabel` (`:1555-1559`) and `categoryDuplicatesForColumn` (`PlannerGrid.tsx:507-541`) — all module-private in `"use client"` files — and read the module-private constants `DERIVED_HISTORY_AUTO_TIMEOUT_MS`/`DERIVED_HISTORY_AUTO_REFUSAL` (`:351-352`) and `MIN_YEAR`/`MAX_YEAR` (`:1204-1205`; the year field's clamp, `:1230`) | files cited; `clientBoundary.test.ts:28-40` | Step 3 extracts all of them verbatim into neutral modules (D3). `isDraftCreatable` (`MonthGenerator.tsx:443-460`, exported from a client file) is NOT imported: the server decides post / no-post with the same three refusals from `cellsToDrafts`'s `skipped`, the store's per-service apply state and the preflight, and a test pins the equivalence (D12); the REPORT of each service comes from the apply outcome table (step 6b), which also reads what the solve said about that target |
| F5 | **The integrity-queue gate has a server counterpart by assembly.** The evidence said the preflight's integrity-queue refusal (`serviceCardModel.ts:1302-1309`) has "no route counterpart". The three summaries it reads are built by the same functions over the same builders in P1's snapshot (`app/mcp/reads/serviceSnapshot.ts:220-240`) as in the three `/api/admin/service-integrity/*` routes (`roles/route.ts:29-53`; `setlists/route.ts:24-41`; `proposals/route.ts:24-47`); `buildIntegrityQueue` (`serviceIntegrityQueue.ts:399`) and `monthTargetPreflight` (`serviceCardModel.ts:1230-1320`) are neutral | files cited | The tools run the browser's own `monthTargetPreflight` per proposed target, at solve (reported) and fresh at apply (enforced). Disposition **mirror** (P4-R11), zero re-implementation. The queue is built with `cards: []` (step 6b, `targetPreflights`): the preflight's **state** equals the browser's for every target, and only the `reasons` of a target its own role already blocks can gain `issue_*` tags (declared in M16) |
| F6 | **The fills' 56-day window and the month's occupancy come from `GET /api/admin/roles`**, which has **no `published` filter** (drafts count), projects `coalesce(week, date)` and resolves seats with `[defined(@->)]` (`roles/route.ts:64-81`); `ServicesPanel` passes that body as both `existingRoles` and `allRoles` (`ServicesPanel.tsx:1025-1035`) | files cited | A new additive builder in `serviceReadQueries.ts` mirrors it (P4-R5; step 4), pinned against the route's projection and run through the same `savedWindowFor` |
| F7 | **The receipt fingerprints the raw create body** (`roles/route.ts:215-220`, `buildCreationReceipt({ payload: body })`), and `draftCreateBody` (`app/utils/monthDraftCreate.ts:65-84`) is the browser's body | files cited | `apply_schedule` builds each body with the same `draftCreateBody` over the same `cellsToDrafts` output, **JSON-normalised** (`createBodyFor`, step 6b: `JSON.parse(JSON.stringify(…))`, the shape `req.json()` hands the route — no `undefined`-valued key, no prototype), so the route and the tool fingerprint the same value, body parity is testable byte for byte and an unchanged service replays exactly (D23) |
| F8 | **A draft create notifies nobody.** `roleCreateNotice` returns `null` when `!published` (`serviceMutationSideEffects.ts:301-307`); `queueRoleNotices` returns before any upsert when `published === false` (`:465-473`); so no outbox notice and no layer-2 sweep | files cited | `apply_schedule` always sends `published: false`; its notification report is empty by construction and the twin run asserts zero pushes and zero upserts |
| F9 | **The create route answers `201` on a create and `200` on a replay** (`roles/route.ts:368,386-389`); `CommitOutcome`'s success arm is the literal `status: 200` (`app/utils/commitOutcome.ts:20-22`) | files cited | Step 5 adds a defaulted second type parameter (`CommitOutcome<E, S extends number = 200>`); every existing use is unchanged |
| F10 | **Today a solve longer than 60 s already fails in the browser**: `/api/admin/solve` declares `maxDuration = 60` (`solve/route.ts:8`) and its fetch has no timeout (`:98-99`); a 504 takes Auto's failure exit and the fills still run (`MonthGenerator.tsx:3374-3380`, `:3520-3524`) | files cited | The connector's 120 s abort (P4-R3) is **more patient** than the browser, never less; declared (D6) |
| F11 | **`app/mcp/**` may not spell the five role/setlist types** (`mcpProtectedTypeLiterals.test.ts:37-45`), but a create body carries `_type: "sunday_role"` etc. | files cited | The month planning core lives in `app/utils/` (neutral and `server-only` modules); the tools and the store speak `kind` (`sunday`/`saturday`/`special`, `serviceKindOf`, `app/mcp/reads/servicePresenter.ts:73-76`) |
| F12 | **`groq-js` is a direct dependency** (`package.json:86`) and route tests already evaluate the real GROQ of `/api/admin/members` against a fixture dataset (`app/api/__tests__/adminMemberVisibility.test.ts:10-40`) | files cited | Request parity is proven at the dataset level: the admin routes and the connector's builders run their real GROQ over ONE fixture dataset (step 8) |
| F13 | **Deleting a created role retires its receipt key** (the delete's transaction patches the receipt with `retireReceiptPatch`, `app/api/admin/roles/[id]/route.ts:584-588`; the code's message, `app/utils/serviceMutation.ts:71-72`); the retired answer carries the receipt's `roleId` (`decideReceipt`, `app/utils/roleWriteRequest.ts:726-728`, which requires a non-empty `roleId` first, `:723-725`; passed through as `details.roleId`, `roles/route.ts:377,396-400`) | files cited | The delete is a hard delete (`.delete(role._id)`, `:593-595`), so a deleted role's id is gone from every later read. After the live proof's cleanup, re-applying the same proposal never re-posts those services: the record still says `created`, and the apply outcome table (step 6b: Table X row X2, Table O row O4) checks the recorded `roleId` against the fresh month roles and reports each one **«creado y luego eliminado»** — never «ya creado», never re-created, a **failure** cell, so the report of an emptied month is never a whole-month success (I9). The receipt's `idempotency_key_retired` answers **only** when the record lost the `created` state (the service is re-posted, row X6 — or X3 if another service now occupies its date) and the key had been retired; the table gives it the same finding and label, and apply records it as `created` with the receipt's `roleId`, so every later apply and revise treat it exactly as the record-borne case (step 10). Both are the design, stated in the tool's docs and proven at L7 |
| F14 | **The browser writes `owt_solver_history_v2` at confirm** as P2's rollback target (`MonthGenerator.tsx:3702-3712`, `appendLocalHistoryEntry` `:333-346`) | files cited | The connector has no `localStorage` and writes none: declared (D16). Under the derived history (P2 D2) the next solve reads the created services themselves |
| F15 | **The spec binds the proposal "by a server-side signature"** and calls `solve_month`/`revise_proposal` read-only (spec `:155`, `:221`, `:306`) | spec | Frank chose a stored record (P4-R6). § «Spec amendment» rewrites those clauses; nothing in the design depends on a signing key, so O7 gains no secret |
| F16 | **"Omitir" is not "exclude".** The grid's Omitir skips CREATING a column that was still solved; the calendar's deselection of a **Saturday** removes it from the solve (`weekendWeekIndexes`, `plannerModel.ts:501-508`), while a deselected **Sunday** is still solved (E21, `MonthGenerator.tsx:2132-2134`) | files cited | The connector exposes the calendar's exclusions, not Omitir; an omitted Saturday that should still be solved has no connector spelling. Declared narrowing (gate M14) |
| F17 | **The pool admits kids-only members, and the pool's unavailability report would list them.** `solverPoolMembersQuery()` binds `{ all: true }` (every `teamMembers`, `app/ministries.ts:77`), which I5 requires for the SOLVE; but `buildUnavailabilityNotices` (`MonthGenerator.tsx:389-405`) iterates every member with `unavailableDates` and tests neither ministry nor Tipo, and the kids availability route writes that same field (`app/api/kids/members/[id]/availability/route.ts:121-123`). A super-admin's browser therefore lists kids-only volunteers under «No disponibles este mes» (`:4214-4235`). Spec I5 (`:146`): "No read that lists members returns a kids-only member, even though the caller is super-admin"; its exceptions are the solver pool as an INPUT and seated people. P1's precedent: `memberAvailabilityPresenter.ts:11-15,57-58` (no `$all`, and an unknown id and a kids-only id read the same) | files cited | The pool projects `ministries` (additive; the request is unchanged); every pool-derived name list that is not tied to a seat is filtered to the worship audience with the repo's one reader, `normalizeMinistries(m.ministries).includes("worship")` (absent, empty, or holding no known id ⇒ worship, `app/ministries.ts:41-44`; the form `MembersPanel.tsx:138` uses), before it is reported. On a `ministries` that holds only unknown values (or is not an array) that reader and `WORSHIP_AUDIENCE_GROQ_FILTER` (`app/ministries.ts:74-75`) **disagree** — TypeScript reads worship, the GROQ excludes — a pre-existing gap only a raw write opens; the MCP follows the TypeScript reader (D21). The audit (§ «Admin surface gates», M17) finds exactly one such list, `warnings.unavailable`; revise's refusal for an id it cannot place is collapsed so it never confirms a kids-only id exists (R1). D21 |

## Evidence and current behavior

| Evidence | Source | Planning implication |
|---|---|---|
| **Auto's inputs in the browser.** `ServicesPanel.loadSources` fetches the five sources (`ServicesPanel.tsx:403-446`); `MonthGenerator` (create mode) receives `members` = `GET /api/admin/members`, `existingRoles` = `allRoles` = `GET /api/admin/roles`, the shared rules controller and `preflight` (`:1025-1042`). No member is filtered out for Auto (the only `members.filter` calls build pool pickers, `MonthGenerator.tsx:1585-1587,1694`) | files cited | The connector assembles the same inputs server-side (step 6) |
| **The members route** reads `*[_type == "teamMembers" && ${WORSHIP_MEMBER_GROQ_FILTER}] \| order(member_name asc)` bound `{ all: role === "super-admin" }`, with no `disabled` filter, projecting `ministries` among its fields (`app/api/admin/members/route.ts:23-32`; filter `app/ministries.ts:77`). Rule names resolve by FIRST match over `members` (`plannerModel.ts:551-557`), so **member order is parity-relevant** | files cited | A new pool builder with the same filter bound `all: true` and the same `order(member_name asc)` (P4-R5; spec I5: "the solver's member pool is not a member-listing read"). It projects `ministries` too, read ONLY by the reporting filter (F17), never by eligibility |
| **The roles route (GET)**: `*[_type in [...3]] \| order(coalesce(week, date) asc, time asc)`, `"published": coalesce(published, true)`, `"date": coalesce(week, date)`, seats `Lead[defined(@->)]{ _key, ...@->{_id, member_name, alias} }` and likewise, `instruments[]{_key, instrument, "person": person->{…}}`, `foh_team[]{…}` (`roles/route.ts:64-81`) | file cited | F6 |
| **The rules.** `GET /api/admin/solver-config` → `{ present, rev, config }` from the inline `loadStored` (`solver-config/route.ts:71-77,92-103`); the client turns it into a state with `sourceFromGet` (`solverConfigSource.ts:88-99`) and `editableConfig` (`:122-125`); absent ⇒ `DEFAULT_SOLVER_CONFIG` in memory. Auto solves with the rules ON SCREEN, unsaved edits included (`MonthGenerator.tsx:1767-1796`) | files cited | The connector binds the STORED rules only (P4-R5): `present` and `rev` (null when absent) |
| **The history.** `loadSolverHistory(target)` (`app/utils/solverHistoryRead.ts:84-114`, server-only, no auth of its own) is what `/api/admin/solver-history` wraps; derived Auto reads it per solve with a 20 s ceiling and refuses the SOLVE (the fills still run) on failure (`MonthGenerator.tsx:351-352,3441-3508`) | files cited | `solve_month` calls it directly, as its header says (`solverHistoryRead.ts:8-10`) |
| **Dates and selection.** `sundayDatesFull = getDates(y, m, 0)` (`:2134`) is always the full spine; Saturdays default to all (`:2041-2045`); `selectedSundays` filters the spine (`:2156-2159`); columns = `buildColumns({ sundayDates: selectedSundays, activeSatDates, specials })` (`:2162-2165`); preview sets `rows = buildRows()` and `cells = []` (`:2691-2718`) | files cited | The connector's inputs are `month`, `excludeSundays`, `excludeSaturdays`, `specials`; it starts from `cells = []`, as a fresh preview does |
| **Auto** (`handleAuto` `:3316-3426`; derived `:3441-3552`): a pre-flight refusal ⇒ fills only (`:3353-3360`, `:3504-3508`); solver `!ok` ⇒ fills only (`:3374-3380`, `:3520-3524`); success ⇒ `applySolveResponse`, then `applySpecialFill(config, applied.cells, mapUnfilledSeats(…, selectedSundays))` (`:3382-3411`); a throw ⇒ fills only (`:3417-3422`). `applySpecialFill` fills every special column in order, then `fillInstruments`, then merges `unfilled` (`:3259-3304`) | files cited | The connector's solve path is the same sequence (step 6); the fill orchestration is extracted so both call one function (D3) |
| **The request.** `buildSolveRequest` (`plannerModel.ts:697-839`) sends no `seed`, no `solver_*`, no `pinned`; it refuses a month with no Sunday leads and a Tipo-less DSL-named member | file cited | Unchanged and shared. Request parity needs no seed (roadmap) |
| **The solve route.** `callRemoteSolver` (`solve/route.ts:87-106`, module-private) posts to `OWT_SOLVER_URL` with no timeout; a non-ok, non-422 answer ⇒ `{ ok: false, error }`, otherwise the JSON body. `callLocalSolver` spawns the Python solver, killed at 120 s (`:110-149`). The handler validates only `sunday_leads` (`:170-172`) and picks remote or local (`:174-177`) | file cited | Step 4 extracts both and the selector into `runSolve(request, { signal? })`; the route keeps auth, parse and the `sunday_leads` check |
| **The GCF.** 5 s per pass, 1 worker, 40 s total by default (`gcf/owt_solver_v2.py:128-133`); a random seed when none is sent (`:1409-1411`); deployed `--timeout=120s --memory=512MB` (`docs/SOLVER_AND_INFRA.md:209-211`); default seats Sun Lead 2, Sun BGV 3, Sun Choir 3, Sat Lead 2, Sat BGV 3 (`build_slots`, `:708-742`) | files cited | The solver's voice targets equal `VOICE_TARGETS` (`plannerModel.ts:304`, module-private), which reach the revise recompute (D10) and the per-cell cap (R14) only as `buildRows()`'s `row.target` |
| **The fills.** `fillColumn` fills lead and BGV only (`AUTO_FILL_ROW_IDS`, `localFill.ts:79`) with `eligible` candidates and one unfilled entry per missing seat (`:240-302`); `fillInstruments` vacates its own earlier picks, fills known instrument rows that have ≥ 1 declarer, one unfilled entry per empty declared row (`instrumentFill.ts:120-198`). Both are neutral and deterministic | files cited | Run unchanged on the server |
| **The create path.** `handleConfirm` (`MonthGenerator.tsx:3561-3726`): the source gate (`:3564`), `isDraftCreatable` (`:443-460`), the nameless-special refusal (`:3581-3587`), a fresh preflight with a whole-batch abort (`:3590-3606`), a sequential `runDraftCreateBatch` (`monthDraftCreate.ts:106-124`) of `draftCreateBody` (`:65-84`) POSTs; per-draft ids come from `cellsToDrafts` (`plannerModel.ts:1084-1167`; `newCreationRequestId`, `monthDraftCreate.ts:54-62`) | files cited | `apply_schedule` reuses `cellsToDrafts` and `draftCreateBody`, and replaces the batch abort with skip-and-report (P4-R10) |
| **The create route (POST)**, `withVerificationRunContext(postHandler)` (`roles/route.ts:99`): auth (`:102-109`), JSON parse (`:111-116`), `parseCreateRequest` (`:118-121`), type whitelist (`:126-129`), receipt replay, mismatch or retired (`:132-135`, `:376-401`), members exist (`:140-145`), occupancy (`:148-167`), dependencies (`:169-180`), weekend lock plan (`:183-211`), special coordinator (`:238-256`), one transaction (`:261-282`), race handling (`:284-337`), `revalidateRoleMutation` and the notices (`:343-366`), `201` (`:368`). Registry entry `roles/route.ts#POST` (`protectedReadAudit.ts:178-184`) | files cited | Extracted verbatim into `roleCreateCommit.ts` (step 5, ADR-0043's pattern) |
| **The manual pick.** `toggleCandidate` (`PlannerGrid.tsx:852-866`) over `rankFor` (`:756-787`, with `sundayDates` per column from `ruleContextForTarget`, `MonthGenerator.tsx:4285`) refuses `blockedReason` and `ruleBlockedReason`; removal is always allowed; the override is a separate action (`:888-916`); badges «No disp.», «Sin declarar», «Ya asignado» (`:3014-3028`) | files cited | The revise gate (P4-R9, step 9) |
| **`rankCandidates`** (`candidateRanking.ts:109-253`): the Tipo filter drops the member (`:197`); `blockedReason` is the same-category double (`:204-207`); `ruleBlockedReason` comes from `evaluate` (`:216-217`); `available`, `undeclared`, `alreadyAssigned`, `eligible` (`:211-225`); the sort uses `localeCompare(…, "es")` | file cited | The verdict fields do not depend on `windowRoles` (only `load` and `recent` do) |
| **`withUpdatedCell`** (`PlannerGrid.tsx:454-498`) is the grid's one cell writer (origin `manual`, overrides pruned); `moveOccupant` imports it back (`moveOccupant.ts:24`) | files cited | Extracted (P4-R4); revise writes cells only through it |
| **The P1 snapshot** loads the catalogue once (`serviceSnapshot.ts:183-277`) and exposes `readiness.{ sources, roleSummary, setlistSummary, proposalSummary }` | file cited | F5 |
| **MCP write infrastructure.** `runWriteTool` phases `pre`/`domain`, `callDomain`, `safeReportRead` (`app/mcp/writes/runWriteTool.ts:91-142`); `refusalFor` and `CODE_COPY` cover `idempotency_mismatch`, `idempotency_key_retired`, `target_has_orphaned_dependencies`, `ambiguous_target`, `integrity_conflict`, `stale_revision` (`refusals.ts:77-96,469`). `CODE_COPY` and `DETAIL_COPY` are module-private (`:77`, `:108`); `refusalFor` returns a whole-call `CallToolResult` (`:469-530`); and `CODE_COPY.ambiguous_target` reads «… (hay duplicados) …» (`:89-90`), while the create route uses that code for an OCCUPIED target — with its own message «Ya existe un servicio en esta fecha para este tipo.» before the commit (`roles/route.ts:160-166`) and with none, so the English default (`serviceMutation.ts:85`), after a commit race (`:310-316`); the timing line (`app/mcp/toolTiming.ts`); registration (`app/api/mcp/route.ts:83-105`); `maxDuration = 60` (`:58`), pinned by `mcpRoute.test.ts:576-578` | files cited | Reused; `runWriteTool` gains an optional copy parameter (step 10); `refusals.ts` gains a per-service line builder, `serviceRefusalLine` (step 10), because neither `refusalFor`'s shape nor its `ambiguous_target` sentence fits a per-service create outcome |
| **The OAuth store precedent**: import-free type and field names (`app/mcp/oauth/documentTypes.ts`), pure builders (`grantDocument.ts`), a `writeClient` store that also READS through `writeClient` (`grantStore.ts:12,104-122`), a hidden read-only Studio type (`sanity/schemas/mcpOauthGrant.ts:33-40`), its `mcpSanityClients` allowlist entry (`app/mcp/__tests__/mcpSanityClients.test.ts:42-49`), and the `studioProtection.ts` lists (`:76-77,164-168,231-242,498-499`) | files cited | The proposal store follows it field for field (step 7) |
| **Dotted `_id`s are private**: "Dotted `_id`s are not surfaced by the public reader regardless" (`docs/MCP.md:692-695`); `operationalClient` is the published perspective with an optional read token (`sanity/lib/operationalClient.ts:16-23`) | files cited | The record is `mcpProposal.<id>`, read and written through `writeClient`, like the grants |
| **Guards the tools must satisfy**: `serviceCommitCallers.test.ts:42-54` (the pin), `DELIVERY_CAPABLE_IMPORTS` (`__fixtures__/deliveryCapableImports.ts`), the `PROTECTED_RUNTIME_WRITERS` exact list, `mcpProtectedTypeLiterals.test.ts:37-45`, `mcpSanityClients.test.ts`, `draftGatingCoverage.test.ts:96-104` (`MAY_SEE_DRAFTS` includes `utils/serviceReadQueries.ts`), `clientBoundary.test.ts`, `agentDocsParity.test.ts`, and the dev smoke's `WRITE_TOOL_NAMES` (`scripts/mcp-dev-smoke.mjs:320`), `EXPECTED_TOOLS` (`:323-333`), `expectedAnnotations` (`:347-349`), `READ_TOOL_NAMES` (`:408`), `CALLABLE_TOOLS` (`:422`), `toolCallRequest` (`:444`) | files cited | Step 11, § «Guards that change» |
| **Platform.** `vercel.json` has only `ignoreCommand` and one cron (`vercel.json:1-4`) — no `functions` key; ADR-0013 says the 60 s ceiling is one "Vercel Hobby will not raise" (`docs/adr/0013-smtp-sends-stay-serial.md:97-98`); `deployBranchPolicy.test.ts:70-72` parses `vercel.json`. **Read-only readings, 2026-09-28, `npx vercel api … --scope frank-rochas-projects`:** `/v13/deployments/dpl_3TFsEhFDhapfCaCW6xTHZJDjuspz` (production) → `config.functionType: "standard"`, `config.functionTimeout: 10`, `config.isUsingActiveCPU: false`, `functions: null`; `/v9/projects/prj_elS88VGezKpy18wizFN1ffoy8cJ5` → `defaultResourceConfig: { fluid: false, functionDefaultTimeout: 10, … }`, and `resourceConfig` (the explicit settings) carries no `functionDefaultTimeout`. **No API lists a git deployment's per-function limits:** `/v6/deployments/{id}/files` answers 404 «File tree not found», and `vercel inspect` lists functions without their limits. **Code already out-ranks the default here, before Fluid:** on dev on 2026-09-28 `/api/admin/solve` (`export const maxDuration = 60`) answered 200 after 10 279 ms under the 10 s default (evidence.md «Measured on dev»; a browser resource timing, network included, so the server's own margin past 10 s is small); and on 2026-08-06 every flush run died at its route's declared **60 s**, not at 10 (`docs/NOTIFICATIONS.md:900-902`; the route has declared 60 since `6938d83a`, 2026-07-28, and the workflow's client waits 90 s, `.github/workflows/flush-notifications.yml:82-87,96`) | files cited; the readings | Step 1: the re-cap by the Default Max Duration alone (P4-R14), observed through the deployment and project API — (O-a) — plus a real call past 10 s on a declared route — (P), the precedence proof. Per-function limits are not read: no API exposes them, and no step writes the project's environment to disk to reconstruct them |

## Admin surface gates (I15's counterpart)

I15 says every write refuses **at least** what its admin counterpart refuses, and P3 settled that
the counterpart is the **admin surface**: the screen, the read contract it opens from and the route
it posts to (P3 plan D13; ADR-0043). P4's counterpart is one flow — Servicios «Generar mes» → the
calendar → «Previsualizar» → the grid's Auto and manual picks → «Crear N borradores» — so the three
tools share one table per tool. The route half holds by construction wherever a tool calls the
route's own domain function with the route's own body (`apply_schedule` → `roleCreateCommit`,
step 5). Everything else holds by these rows. Dispositions are P3's:

- **mirror**: the tool refuses it itself, before any write. The row says how and which test pins it.
- **mirror (behaviour)**: the surface produces a result (a fill, a label, a report); the tool
  reproduces that result, and a parity or report test pins it.
- **mirror (behaviour), narrowed by I5**: the same, except that a list of members the surface shows
  a super-admin is reported without the members outside the worship audience, because spec I5
  forbids a listing read to name them (F17). The parity test compares the connector's list with the
  surface's list filtered by the same reader.
- **structural**: the tool's input cannot express the case.
- **inherited**: the route refuses it too; the tool returns the route's code.
- **declared narrowing / declared difference**: the tool does not do what the surface does; the row
  says why that is harmless or names the spec clause or ruling that requires it.

Row ids name the tool: **M** `solve_month`, **R** `revise_proposal`, **A** `apply_schedule`. Line
numbers at `7c65f2eb`.

**`solve_month`**: the calendar, the preview and Auto, against `POST /api/admin/solve`.

| # | Gate | Code evidence | Disposition | How, and the test |
|---|---|---|---|---|
| M1 | **Sources ready.** «Generar mes» needs all five sources (`CONTROL_REQUIRED_SOURCES.generateMonth`, `serviceReadiness.ts:824`; `ServicesPanel.tsx:916,1040,1099`), re-checked at preview (`MonthGenerator.tsx:2695`) | files cited | **mirror** | Every read the solve needs must succeed: the snapshot's five sources `ready`, the pool members, the rules, the month-and-window roles. Any failure refuses the whole solve (`integrity_conflict`, detail `sources:<keys>`) before the solver is called and before any record is written. Test: each read failing in turn → the refusal, zero solver calls, zero store writes |
| M2 | **Rules loaded** (`rulesBlocked`, `:1824-1829`; re-checked in `handlePreview`, `:2699`) | files cited | **mirror** | A failed rules read refuses. An ABSENT document solves with `DEFAULT_SOLVER_CONFIG`, as the browser does (`sourceFromGet`, `solverConfigSource.ts:90`), and the proposal binds `{ present: false, rev: null }` |
| M3 | **At least one column** (`handlePreview`, `:2705`) | file cited | **mirror** | Refused `invalid_request`, detail `no_columns` |
| M4 | **Weekend exclusions** are toggles on the month's own Sundays and Saturdays (`handleDayClick`, `MonthCalendar.tsx:249-258`) | file cited | **structural + mirror** | `excludeSundays`/`excludeSaturdays` must name Sundays/Saturdays of `month`, without repeats; otherwise `invalid_request`, detail `exclusion_not_weekend_of_month` |
| M5 | **A special's date is a day of the month** (the composer offers `monthDays`, `MonthCalendar.tsx:80-83,193`) | file cited | **mirror** | Refused and reported (`special_outside_month`) |
| M6 | **A special has a name** (`submitSpecial`, `:271-277`; `handleConfirm`'s `namelessSpecial`, `MonthGenerator.tsx:3581-3587`, `plannerModel.ts:1182-1184`) | files cited | **mirror** at solve (P4-R11) | `normalizeLabel(name) === null` ⇒ refused and reported, never sent to apply. The store's validator refuses a record carrying one (step 7) |
| M7 | **`refuseSpecialOn`'s four rules**: the weekend date is still selected; this session already created a special there; another special this month on the date (E19); a special already stored on the date (`MonthCalendar.tsx:140-172`) | file cited | **mirror** at solve (P4-R11); `createdTargets` **declared narrowing** | The extracted function (step 3) runs per requested special, in input order, with the specials accepted so far and the fresh month roles. The session rule has no connector meaning: a special an earlier apply created is a stored special and meets the fourth rule. A refused special is reported with the function's own Spanish text, rendered by Node's ICU (`longDate`'s `toLocaleDateString("es-MX")`; the TZ test pins it under both zones; Node against Chrome is AS6, read at L1 against `/admin`'s composer), and **never dropped silently**. Parity scenario (e) (step 8) submits the same refused specials through the real composer — rules 1, 3 and 4 — and asserts its rendered notice equals `refusedSpecials[].reason` byte for byte. **Declared difference in wording (rule 3):** the browser refuses a second special on a weekday already in the list by TWO paths with two sentences. The composer's date `Select` → `submitSpecial` runs `refuseSpecialOn`, whose third rule reads «El … ya tiene un servicio especial en este mes: «X». Quítalo de la lista para cambiarlo.» (`MonthCalendar.tsx:157-160`); a click on that day is refused earlier by `handleDayClick` with its own «El … ya tiene un servicio especial («X»). Quítalo de la lista para cambiarlo.» (`:262-267`), before the composer opens. The tool reports `refuseSpecialOn`'s text: its input is a declaration, not a click, and the shared function is the one both surfaces run (a parity pin on the function is worth more than a copy of a click handler's string). Scenario (e) asserts both: the composer path equals the tool byte for byte, and the click path renders `handleDayClick`'s sentence, so a change on either side is seen |
| M8 | **`refuseWeekendOn`**: a weekend date holding a special cannot be re-selected (`:177-181`) | file cited | **structural** | The input is one declaration, not a sequence of toggles; the overlap it guards is M7's first rule |
| M9 | **E3, one column per date**, weekend wins, dropped with a `console.warn` (`buildColumns`, `plannerModel.ts:425-464`, warning `:445-455`) | file cited | **mirror** | After M7 no overlap reaches `buildColumns`. The core also asserts that `columns.length` equals selected Sundays + selected Saturdays + accepted specials and throws otherwise (a `pre` failure, nothing written): never a silent drop |
| M10 | **Auto is offered in create mode only** (`PlannerGrid.tsx:2007`) | file cited | **structural** | The tool only ever plans creates |
| M11 | **`buildSolveRequest`'s refusals**: no Sunday leads; a rule naming a Tipo-less member (`plannerModel.ts:781-788,834-836`) | file cited | **inherited** (same function) + **mirror (behaviour)** | The solver is not called and the fills still run (`MonthGenerator.tsx:3353-3360`); the reason is reported verbatim |
| M12 | **A failed history read refuses the solve** (derived mode, `:3489-3494`), **and so does one past 20 s**: `handleAutoDerived` aborts its read at `DERIVED_HISTORY_AUTO_TIMEOUT_MS` (`:351`, `:3441-3452`), and the abort takes the same refusal | file cited | **mirror** (+ a declared nuance in the clock) | Same: no solver call, fills run (a partial proposal), the refusal text `DERIVED_HISTORY_AUTO_REFUSAL` itself (`:352`, extracted in step 3b). The history read is capped at the same extracted 20 s (step 6a); a read past it is a failed read. The browser's 20 s also covers its network hop and the connector's covers server time only, so the connector is marginally more patient, never less. Test: step 8's history ceiling (20 000 ms ⇒ refused; 19 999 ms ⇒ solved) |
| M13 | **Solver failure** (`!ok`, no schedule, non-2xx, a throw) ⇒ the fills still run (`:3374-3380,3417-3422`) | file cited | **mirror (behaviour)** + **declared difference** (the abort) | Same exits; a proposal is stored only when at least one seat is filled, marked `partial` (spec `:219`). The connector also aborts the call at 120 s (P4-R3, D6), where the browser's own call is capped by its route's 60 s (F10); when the 150 s solve deadline is already spent before the call, the solver is **not called** and the step takes the abort exit (D6) — never a negative timeout |
| M14 | **Omitir** a column after preview (`onToggleSkip`, `PlannerGrid.tsx:237`; `cellsToDrafts`' `skipped`) | files cited | **declared narrowing** | No connector spelling (F16). Harmless: an excluded Sunday is solved and not created, exactly as Omitir; for a Saturday Frank excludes it (not solved) or deletes the created draft in `/admin` |
| M15 | **A target already occupied** is marked and never created (`cellsToDrafts`' `isExisting`, `plannerModel.ts:1109-1110`; header `createBlockFor`, `MonthGenerator.tsx:3774-3778`) | files cited | **mirror (behaviour)** | The proposal reports that service `willCreate: "exists"` (`targetStateOf`, step 6b) and stores it as the service's `atSolve`; apply never posts an occupied target except to let the receipt settle its own `unknown` create (Table X, X3/X4, A3), and reports it against `atSolve` (Table O): still occupied ⇒ «ya existía», *neutral* |
| M16 | **Per-column preflight label** (`preflightFor`, `MonthGenerator.tsx:4245`; `monthTargetPreflight`) | files cited | **mirror (behaviour)** + **declared difference** (extra reasons on an occupied target) | `willCreate` per service (`creatable`, `exists`, `blocked` with reasons — `unknown`/`checking` fold into `blocked` and are unreachable once M1 proved every source ready, step 6b), from the browser's own function over the snapshot's summaries (F5); stored per service as `atSolve`, the solve-time state apply's report reads (step 7, Table O). Informational at solve; enforced at apply (A5). The queue it reads is built with `cards: []` (step 6b): every target's **state** equals the browser's; a target whose own role already blocks it (`duplicate`, `draft_conflict`, `invalid`) may list more `issue_*` reasons than the browser's, never fewer. Test: `targetPreflights` against the browser's queue (step 6) |
| M17 | **Unavailability notices** (`buildUnavailabilityNotices`, `:389-405`, set at preview `:2708-2710`, rendered «No disponibles este mes» `:4214-4235`) | files cited | **mirror (behaviour), narrowed by I5** | Reported (P4-R13) from the extracted function, run verbatim over `worshipAudience(pool)` — the pool filtered by `normalizeMinistries(m.ministries).includes("worship")` — instead of the whole pool (a member whose `ministries` holds only unknown values reads as worship there and stays listed, as the super-admin's browser lists them — D21). **Why narrowed:** a super-admin's browser passes every member (the route binds `$all`) and the function tests neither ministry nor Tipo, while kids availability writes the same `unavailableDates` (F17); this report is a list of members, not a seat, so I5 forbids a kids-only name in it. **The audit of every pool-derived name list P4 returns** (this row is the only one filtered): `warnings.unavailable` — pool-derived and tied to no seat ⇒ filtered; `services[].seats`, revise's `diff` and per-edit warnings, `warnings.ruleViolations` and `warnings.doubles` (occupants of the column, `ruleEnforcement.ts:479-526`, `categoryDuplicatesForColumn`), apply's `warnings.disabled`/`lostTipo` — each names a seated or just-placed member ⇒ I5's seat exception, never filtered (hiding a seated person misreports the service); `warnings.unresolvedSolverNames`/`unresolvedRuleNames` — strings that match NO pool member, from the answer and the rules, not member rows; `solver.diagnostic` — `total_counts`/`role_counts`, keyed by pool names, are already excluded (step 8's output), `pin_violations` is empty without pins (`gcf/owt_solver_v2.py:1757-1758`) and the `error` is the solver's text about the request's rules; revise's refusal for an id it cannot place — collapsed (R1). No tool returns the pool itself. **Test** (`solveMonth.test.ts`, I5): a kids-only member with an unavailable date on a selected Sunday of the month is absent from `warnings.unavailable`; a kids-only member who carries a worship Tipo is still in the solve request's pools (as in the browser) and, when the recorded answer seats them, in `services[].seats`; a legacy member with no `ministries`, one with `ministries: []`-shaped data and one whose `ministries` holds only an unknown value (all read as worship) are listed. Parity: step 8's notices comparison |
| M18 | **Unaddressable Saturdays** (`unaddressableDates`, `plannerModel.ts:528-531`; `PlannerGrid.tsx:2046-2047`) | files cited | **mirror (behaviour)** | Reported (P4-R13) |
| M19 | **«Nombres no reconocidos»**: the solver's unmatched names merged with rule-name misses (`MonthGenerator.tsx:2504-2517`) | file cited | **mirror (behaviour)**, **declared difference** in presentation | Two labelled lists, solver names and rule names, never merged (P4-R13) |
| M20 | **Diagnostics line** (`PlannerGrid.tsx:2081-2092`; derived `history_months`, `MonthGenerator.tsx:3537-3542`) | files cited | **mirror (behaviour)** + **declared addition** | Every diagnostic field of the solver's answer verbatim, `objective_skipped` included, which the browser never shows (spec `:219`; P4-R13), plus `history_months` in the browser's wording (`historyMonthsLabel`, extracted) |
| M21 | **E13 rule violations and same-category doubles**, display-only (`PlannerGrid.tsx:700-754`, `:507-541`); never blocking creation (`createBlockFor`, `MonthGenerator.tsx:3774`) | files cited | **mirror (behaviour)** | Reported as warnings from `ruleViolationsForColumn` and the extracted `categoryDuplicatesForColumn` (P4-R13); never a refusal |
| M22 | **The rules on screen**, unsaved edits included (`:1767-1796`) | file cited | **declared narrowing** | Stored rules only (P4-R5). The parity reference is the browser with no unsaved edit |
| M23 | **The history source is the derived one** (P4-R1; `SOLVER_HISTORY_SOURCE`, `app/components/admin/solverHistorySource.ts:36` on the cutover, neutral: no directive, no imports) | file cited | **connector-only** (D22) | `solve_month` refuses before any read when the constant is not `"derived"`: `integrity_conflict` (M1's family: an input is not in the state parity assumes), detail `history_source_not_derived`, «/admin no usa hoy el historial derivado, así que solve_month no daría lo mismo que Auto. No se guardó nada.». Zero reads, zero solver calls, zero store writes. Test: the switch mocked `"local"` ⇒ that refusal (as `MonthGenerator.derivedHistory.test.tsx:20` mocks it); mocked `"derived"` ⇒ the solve proceeds |
| M24 | **The year range**: the planner's year field accepts only a complete year and clamps it to `MIN_YEAR`…`MAX_YEAR`, 2024–2035 (`MonthGenerator.tsx:1204-1205`; `YearInput`'s `clamp`, `:1230`; `min`/`max`, `:1236-1237`), so `/admin` never plans a month outside it | file cited | **structural** | `solve_month`'s `month` schema accepts only years 2024–2035 — the same two constants, extracted verbatim (step 3b) and imported by the schema — and months 01–12; anything else is a schema refusal before any read. The record parser applies the same bound (step 7). Where the browser clamps an out-of-range year to the nearest bound, the tool refuses it: a model's typo must not silently plan another year. Test: `2023-12` and `2036-01` refused with zero reads; `2024-01` and `2035-12` accepted |

**`revise_proposal`**: the create-mode grid's manual pick. No route: every one of these gates lives
in the client.

| # | Gate | Code evidence | Disposition | How, and the test |
|---|---|---|---|---|
| R1 | **Tipo**: a member without the seat's Tipo is not a candidate (`candidateRanking.ts:197`) — the picker never renders them | file cited | **mirror**, one refusal for every id the ranking lacks (I5) | Refused `invalid_request`, detail `member_not_eligible`, one fixed sentence: «Ese id no es de un miembro del equipo de alabanza con el Tipo de este lugar.» — the SAME payload whether the id names no document, a kids-only member, or a worship member without the seat's Tipo, so a refusal never confirms that a kids-only id exists (P1's precedent, `memberAvailabilityPresenter.ts:57-58`). Distinguishing them would buy Frank nothing he lacks: he chose the member. Test: the three cases produce byte-identical refusals |
| R2 | **Same-category double** (`blockedReason`, `candidateRanking.ts:204-207`; refused at `PlannerGrid.tsx:863`) | files cited | **mirror** | Refused, `same_category_double`, with the reason text |
| R3 | **Hard rule** (`ruleBlockedReason`, `:216-217`; refused at `PlannerGrid.tsx:864`) | files cited | **mirror** | Refused, `hard_rule`, naming the rule (`ruleBlockedReason` verbatim) |
| R4 | **Override** «Asignar de todos modos» (`PlannerGrid.tsx:888-916`) | file cited | **structural** | No override input; forcing stays in `/admin` (spec `:220`) |
| R5 | **Already in the cell** (a pick of a seated member toggles them OFF, `:858-861`) | file cited | **mirror** | A `place` of someone already there is refused, `already_in_cell`, never a silent toggle-off |
| R6 | **Removal is always allowed**; rules refuse additions only (`:841-842,858-861`) | file cited | **mirror** | `clear` checks only that the member is in that cell (`member_not_in_cell` otherwise) |
| R7 | **Badges** «No disp.», «Sin declarar», «Ya asignado» (`:3014-3028`) | file cited | **mirror (behaviour)** | Per-edit warnings from the same `available`, `undeclared`, `alreadyAssigned` |
| R8 | **Over target «+N»** (`hasTarget`, `plannerModel.ts:400-408`; `PlannerGrid.tsx:2635,2873`). **On `e8660b26` the «+N» pill is retired** (ADR-0045; post-approval change 10): every occupant renders as a named chip, the chips past the target are tinted and labelled «(por encima del objetivo)», and the cell says «Por encima del objetivo — se acepta de todos modos» (`PlannerGrid.tsx:2869-2871` there; `hasTarget` `plannerModel.ts:402-410` there, body unchanged) | files cited | **mirror (behaviour)** | A warning, never a refusal (the grid does not refuse it either — unchanged on `e8660b26`, D6) |
| R9 | **A row the column does not show** (Saturday Coro; `rowAppliesTo`, `plannerModel.ts:361-368`) | file cited | **mirror** | Refused, `row_not_on_column` |
| R10 | **A column that will not be created** (the drag gate's P3 `canReceive` = `isDraftCreatable`, `MonthGenerator.tsx:408-460`) | file cited | **mirror** | An edit on a service whose target is not `creatable` in the revise's own fresh read, or that the record shows as `created`/`unknown`, is refused (`column_not_created`, `service_already_created`). The record's `apply` states survive every revise (step 9.8 writes them back as read), so this holds after any number of revisions; a `created` service whose role has since been deleted — recorded by an earlier apply, or learned from the retired receipt (X12) — or moved to another date or renamed in `/admin` (X1b) stays refused, with the sentence that sends Frank to `solve_month` (step 9). The gate reads the fresh state, not `atSolve`: a service the solve showed `exists` or `blocked` is editable exactly when it is `creatable` now, because apply would then post it (X6) |
| R11 | **The drag gate** (`moveGate.evaluateMove`: lock, unresolved, P2, P3, C1–C4, `moveGate.ts:231-350`) | file cited | **declared narrowing** | The connector has no drag. `exchange` is two placements through R1–R5 (P4-R9): C3 is R1, C2 is R2, C4 is R3 (never forced), C1 is R5, P3 is R10 |
| R12 | **Members and rules on screen** | — | **declared** (P4-R9) | CURRENT members (a fresh pool read) and the proposal's BOUND rules; a changed rule set refuses the whole revise (`rules_changed`) |
| R13 | **Worship-night Lead** has no target (`hasTarget`, `plannerModel.ts:405`) | file cited | **structural** | The month create flow never drafts a worship night (`monthDraftCreate.ts:39-45`); the solve input has no `format` |
| R14 | **No per-cell cap** in the grid (R8 lets a cell go over target) | — | **declared narrowing** (step 7's record limits) | A `place` that would put more than `PROPOSAL_LIMITS.membersPerCell` in one cell is refused, `cell_limit`, so a valid revise never stores a record the parser would read as `malformed`. The cap is **derived, not restated**: `4 × Math.max(...buildRows().map(r => r.target ?? 0))` — 12 today, the largest target being 3 — because `VOICE_TARGETS` is module-private (`plannerModel.ts:304`) and `buildRows()` (`:310-329`) is the export that carries it; no export is added. A unit test pins 12. The solver and the fills never exceed a row's target, so a solve cannot reach it |

**`apply_schedule`**: «Crear N borradores», against `POST /api/admin/roles`.

| # | Gate | Code evidence | Disposition | How, and the test |
|---|---|---|---|---|
| A1 | **Sources re-checked at confirm** (`gateBlocked`, `MonthGenerator.tsx:3564`) | file cited | **mirror** (P4-R11) | Fresh snapshot (all five sources), pool members, month roles and rules; any failure refuses the whole apply before the first create (and releases the lease) |
| A2 | **Nameless special** (`:3581-3587`) | file cited | **structural** | Refused at solve (M6); the store refuses to persist one |
| A3 | **`isDraftCreatable` — skipped** (Omitir or `isExisting`, `:443-460`) | file cited | **mirror** | `cellsToDrafts` over the FRESH month roles; an occupied target is never posted (Table X, X4) — except a service whose record says `unknown`, posted so the route's receipt settles whether the occupant is its own (X3, D12). Reported against `atSolve` (Table O, O5): occupied then and now ⇒ «ya existía», *neutral*; `creatable` at solve and occupied since ⇒ «no creado: la fecha se ocupó después de la propuesta de mes», a *failure* — never a success, whether the fresh read sees the occupant (X4) or only the route's race does (X11) |
| A4 | **`isDraftCreatable` — created this session** (`createdTargets`, `:458`) | file cited | **mirror** | The record's per-service apply state `created` ⇒ never re-posted (X1/X1b/X2): «ya creado (revisión N)», *success*, only while its recorded `roleId` is among the fresh roles **at the service's own identity** (its date; for a special, its normalized name too — ADR-0011); **«creado y luego modificado en /admin»**, a *failure*, when that role is among the fresh roles at another date or name (moved or renamed inside the read's range, X1b, O11); **«creado y luego eliminado»**, a *failure*, once it is absent (deleted in `/admin`, or moved out of the read's range) — and the same label when the route's retired receipt is what reveals it (X12, which then records `created` with the receipt's `roleId`). A service the record left `unknown` whose create landed is settled by the receipt's replay, and the replay's role is held to the same identity: at the service's own date (and name) it is «creado (confirmado por su recibo)» (X10), elsewhere «creado y luego modificado en /admin» (X10b, O11, a *failure*), both recorded `created`. Never re-created by this proposal (I9, F13) |
| A5 | **`isDraftCreatable` — preflight `creatable`** (`monthTargetPreflight`, `serviceCardModel.ts:1230-1320`: role target, lock eligibility, setlist and proposal history canonical or raw, **an integrity-queue issue on the target** `:1302-1309`) | file cited | **mirror** (P4-R11) | A fresh preflight per service over the fresh snapshot's summaries and `buildIntegrityQueue` with `cards: []` (F5; `targetPreflights`, step 6b — the same state as the browser's for every target, M16); not `creatable` ⇒ that service refused with the preflight's reasons (X7), the rest proceed. Reported against `atSolve` (O7): «no creado: la fecha se bloqueó después de la propuesta de mes» when the solve had shown it `creatable`, «no creado: sigue bloqueado» when it had shown it `blocked` — both *failures*. A target the solve showed `exists` or `blocked` that is `creatable` now IS posted (X6) — for `blocked`, as the browser posts it once its preflight snapshot is refreshed (`MonthGenerator.tsx:2519-2536`); for `exists`, a declared difference, since the browser's `isExisting` reads an `existingRoles` prop the open dialog never refreshes (step 6b states the decision; post-approval change 2) — and its label says what the proposal had shown (O1) |
| A6 | **Fresh re-check, whole-batch abort** on a dropped date (`:3590-3606`) | file cited | **declared difference** (spec `:221`; P4-R10) | Skip-and-report per service. **Skipping never licenses success:** every target the browser's abort would stop on — a candidate that stopped being `creatable` since the proposal — lands in a *failure* cell of Table O (O5's first cell, O6, O7), so `complete` is `false` exactly where the browser would have refused the batch, and the report names each such service |
| A7 | **E19, one special per date.** The composer's fourth rule refuses a date with a stored special (`MonthCalendar.tsx:161-167`); the route's occupancy is per NAME (`roleWriteOps.ts:390-399`), and the browser's confirm does not re-run the composer | files cited | **mirror**, stricter than the browser's confirm | `refuseSpecialOn`'s fourth rule re-run at apply over the fresh month roles; a special stored on that date since the solve (always *since*: M7 refused any special whose date already held one) ⇒ that special refused (X5) and reported «no creado: la fecha ya tiene un servicio especial con otro nombre» (O6), a *failure*. A stored special of the SAME normalized name is the same target and is read as `occupied` first (X3/X4), so a service whose own create may have landed is settled by its receipt, not refused for a neighbour. A service the record left `unknown` whose create landed and was then **renamed** in `/admin` also meets X5 — apply cannot tell, before posting, whether the stored special is this service renamed or another's, and posting when it is another's would create a second special on the date; so it is refused (fail-safe), and the label and reason name the special found rather than blaming another (step 6b, O6) |
| A8 | **«Crear y publicar»** (`publish = true`, `:4459-4460`) | file cited | **structural** | Always `published: false`; publishing is `publish_service` (spec `:221`) |
| A9 | **The fairness-history write at confirm** (`:3702-3712`) | file cited | **declared difference** (D16) | F14 |
| A10 | **«No se pudieron crear N de M»** (`:3720-3724`) | file cited | **mirror (behaviour)** | A per-service outcome for every proposed service (Table O), `counts` per Table O cell and `complete` from the weights (step 10) |
| A11 | **The create route's refusals**: receipt replay, `idempotency_mismatch`, `idempotency_key_retired`, members exist, raw draft and canonical occupancy, setlist/proposal history on the date, weekend lock integrity, special coordinator, commit race (`roles/route.ts:118-337,376-401`) | file cited | **inherited** | `roleCreateCommit` returns the route's code; the per-service entry carries it, its `detail` and a per-service Spanish line from `serviceRefusalLine` (step 10) — never `refusalFor`'s whole-call result. An OCCUPIED target (`ambiguous_target` with `details.roleIds`, either arm) reads the route's own «Ya existe un servicio en esta fecha para este tipo.», never «hay duplicados» |
| A12 | **The rule set changed since the solve** | — | **connector-only** (spec `:221`) | The whole apply refused, `stale_revision`, detail `rules_changed` |
| A13 | **Expired, unknown, another origin or principal, superseded revision** | — | **connector-only** (spec `:221`; P4-R6/R7) | The whole apply refused before any read of domain data |
| A14 | **A second apply, or a revise, in flight on the same proposal** | — | **connector-only** (D9) | The record's apply lease, enforced on every write to the record (step 7's write table: each apply-side write proves the lease's nonce under `ifRevisionId`, a revise commits under the revision of the read that saw no live lease); the refusal (`proposal_busy`) carries a `next` that says to wait and call again with the same proposal, never to re-solve (step 7) |

**How the tables are tested.** Each refusal-replay case in steps 8–10 names its row.
- An **inherited** row asserts the tool returns the route's code for that service and that the
  route, run alone on the same fixture, returns the same code; neither commits.
- A refusing **mirror** row asserts zero writes (zero `roleCreateCommit` calls for A-rows; zero
  store writes for M- and R-rows) and, for A-rows, runs the route alone on the same fixture, to
  record whether the route refuses too or would commit (the gap the mirror closes).
- A **mirror (behaviour)** row is a parity or report test.
- A **structural** row is a schema test.

## Scope

### In scope

- **Fluid compute** for the project (`vercel.json` `"fluid": true`), **the re-cap of every function
  that declares no `maxDuration` at 10 s** (the project's Default Max Duration, route handlers and
  pages alike; no `vercel.json` `functions` glob, P4-R14) with its observation at deploy, a concurrency
  audit of server module state with a pinned guard test, the ADR-0013 amendment — released on its
  own, first, preview then production (P4-R2).
- **A narrowed spike** (F1): GCF cold start after idle, a 5-Sunday month, per-create time.
- **Behaviour-preserving extractions** out of `"use client"` files and route files into neutral or
  `server-only` modules (P4-R4, widened by F4): the calendar refusals and helpers, `getDates`,
  `savedWindowFor`, `buildUnavailabilityNotices`, `historyMonthsLabel` (with `MONTHS`),
  `withUpdatedCell`, `categoryDuplicatesForColumn`, the Auto fill orchestration (`runLocalFills`),
  `runSolve` (with the solver types), the solver-config loader, and **`roleCreateCommit`** (critical:
  registry, delivery coverage, caller pin, twin runs, `/admin` unchanged).
- **Two additive read builders** in `app/utils/serviceReadQueries.ts` (P4-R5).
- **The month-proposal model** (neutral, `app/components/admin/monthProposalModel.ts`) and its server
  reads (`app/utils/monthPlanReads.ts`).
- **The proposal store**: the `mcpProposal` document type, its Studio schema and protection, a
  `writeClient` store allowlisted in `mcpSanityClients`, expiry and the opportunistic sweep (P4-R6/R7/R8).
- **The three tools**, strict schemas, Spanish descriptions carrying the observation rules,
  annotations per P4-R6, honest per-service reports, the report extras of P4-R13.
- **Tests**: dataset-level request parity and recorded-response proposal parity against the real
  `MonthGenerator` (the roadmap's acceptance), apply twin runs against the admin create route, the
  revise-gate agreement against the real `PlannerGrid`, refusal replay per gate row, store and lease
  tests, TZ tests, the guard updates.
- The dev smoke lists the three tools and calls none (P4-R12). Docs, a new ADR, the ADR-0043 and
  ADR-0013 amendments, the spec amendment and the roadmap amendments, the invariant lines.
- The production live proof with parking points, and its cleanup.

### Non-goals

- Publishing from the connector as part of apply (spec: drafts only; `publish_service` stays
  separate). Any person-level edit on a CREATED service (roadmap decision 6).
- Pins, a seed, or any solver knob in the request (ADR-0041; P4-R3).
- An atomic month (spec «Atomicity is a stated limitation»).
- Stored-mode planner features: «Llenar especiales…», worship nights, same-day sets, `time`/`format`
  on a special (`monthDraftCreate.ts:39-45`: the month create flow sets neither).
- The kids ministry. A proposal read tool (the handle is returned by `solve_month`/`revise_proposal`
  only; a lost response costs a re-solve, D17).
- A new secret or env var: none is introduced (D5). `docs/SECRETS.md` gains **no new entry**; its
  existing `OWT_SOLVER_API_KEY` entry is **updated** in step 11 (post-approval change 1), because
  step 4a moves the key's sender to `app/utils/solverCall.ts` and `/api/mcp`'s `solve_month` comes
  to depend on it. Fluid is
  `vercel.json` configuration and the re-cap is the Default Max Duration, a non-secret project
  setting (documented in `docs/CI.md`, step 1), neither an environment variable. No step reads the
  project's environment or writes any of it to disk (P4-R14): every Vercel observation in this plan
  is a read of the deployment and project API.
- Retiring P1's snapshot mirror (ADR-0040 D1) or P2's dual-write (P2 D3).

### Preserved invariants

- **`/admin` behaves byte-identically.** The planner's Auto, manual pick, calendar and confirm
  produce the same requests, cells, drafts and bodies; the create route answers the same statuses and
  bodies and commits the same transactions. Every extraction is a pure move reviewed with
  `git diff --color-moved=dimmed-zebra --color-moved-ws=allow-indentation-change`; the counterpart
  tests (`app/api/__tests__/roleWriteRoutes.test.ts`, `solverConfigRoute.test.ts`, `serviceIntegrityRoutes.test.ts`, every
  `MonthGenerator.*.test.tsx`, `MonthCalendar.test.tsx`, `PlannerGrid.test.tsx`,
  `plannerGridPickPlace.test.tsx`, `moveOccupant.test.ts`, `localFill*.test.*`,
  `instrumentFill*.test.*`, `plannerModel.test.ts`, `solverConfigSource.test.ts`) pass with **zero
  diff** except import-path lines where a test imports a moved symbol from its old module (none is
  expected: the old modules re-export).
- **Pre-commit capture** moves verbatim with the create domain (I8); a draft create stays silent (F8).
- **Cache parity**: `revalidateRoleMutation()` per create, as the route (I12).
- **Draft gating** (I2): no `MAY_SEE_DRAFTS` entry is added; the two new builders sit in
  `serviceReadQueries.ts`, already exempt (`draftGatingCoverage.test.ts:100-103`); **no protected-type
  or draft-gated GROQ literal in `app/mcp/**`**. (Not "no GROQ literal at all": the store needs two
  queries of its own — `loadProposal`'s and the sweep's, step 7 — which name only `mcpProposal`, through
  a `$type` parameter from `documentTypes.ts`, exactly as `grantStore.ts:62-64`'s `GRANT_QUERY` already
  does for grants.) **Canonical clients** (I1): every protected read goes through `operationalClient`/
  `rawIntegrityClient`; the store reads and writes only `mcpProposal` through `writeClient`.
- **Worship scope** (I5): the solver pool admits every member (`{ all: true }`) as an INPUT, so the
  request equals a super-admin's browser; no P4 output that lists members names one outside the
  worship audience except in a seat — the one such list, `warnings.unavailable`, is computed over
  `worshipAudience(pool)` (M17, F17) — and no refusal distinguishes a kids-only id from an unknown
  one (R1). `ministries` is read only by that filter, never as eligibility (ADR-0029), and through
  the repo's TypeScript reader (`normalizeMinistries`), so a member the app's own auth reads as
  worship is never hidden from a report (D21).
- **No role/setlist type literal in `app/mcp/**`** (`mcpProtectedTypeLiterals.test.ts`); the tools
  speak `kind`.
- **TZ**: every date is `YYYY-MM-DD` built from calendar components or local noon; the core's outputs
  are identical under `TZ=UTC` (Vercel) and `TZ=America/Mexico_City` (the suite), pinned by a test.
- `saturdarSongs` untouched; the five seats covered by `cellsToDrafts`/`draftCreateBody` as today;
  every array item written to Sanity carries a `_key` (the store's arrays of objects included).
- P0's checks, header allowlist, kill switch and host rule are unchanged; P3's buffering
  (`completeResponse`) and detached abort signal stay.

## Affected boundaries

| Component | Current | Planned |
|---|---|---|
| `vercel.json` | `ignoreCommand`, one cron | + `"fluid": true` only (left out again if AS1's Fluid fallback is used); **no `functions` key** (P4-R14) — step 1 |
| Vercel project setting, Settings → Functions → **Default Max Duration** (not in git) | unset (`resourceConfig` has no `functionDefaultTimeout`; 10 is Vercel's legacy default) | **10**, set by Frank **after Release A's code review passes, immediately before the preview merge**, with no production deploy of anything until (P) passes (post-approval change 7), read back through the project API, recorded in ADR-0013 and `docs/CI.md` by a post-review record commit that gets the scoped re-verify (step 1) — the one re-cap of every function that declares no `maxDuration`, route handlers and pages alike (P4-R14) |
| `app/utils/__tests__/moduleStateAudit.test.ts` (new) | — | pins its scanner's exact hit set (today eight top-level mutable bindings) with each one's concurrency reason, and a second scan pinned empty (module-level objects and arrays mutated in place); the stateful instances no text scan can see are reviewed as commentary (step 1) |
| `app/utils/__tests__/fluidCeiling.test.ts` (new) | — | pins `vercel.json`'s top-level keys to exactly `ignoreCommand`, `crons`, `fluid`, with `fluid === true` (no `functions` key); pins the exact map of `maxDuration` declarations under `app/` (today 17 route files at 60; Release B: `/api/mcp` at 180), so a dropped declaration — which the Default Max Duration would silently cut to 10 — fails; a declaration above 60 only where ADR-0013 names it on a dated allowance line, and only with `"fluid": true` (or, under AS1's Fluid fallback, ADR-0013's dated marker line and no `fluid` key); ADR-0013 carries the Default Max Duration's dated record line (step 1) |
| `docs/adr/0013-smtp-sends-stay-serial.md` | "60 s … Hobby will not raise" | dated amendment: Fluid, 300 s Hobby ceiling, and **Fluid raises nothing by default here** — every function that declares no `maxDuration` (the 44 undeclared routes, every server-rendered page, `_not-found`, `proxy.ts`) re-capped at 10 s by the Default Max Duration, why re-capped rather than accepted, the allowance lines for any declaration above 60 (none in Release A), and the observed limits and precedence proof; the SMTP-pool analysis, the pre-Fluid usage baseline (step 1) |
| `app/components/admin/plannerCalendar.ts` (new, neutral) | in `MonthCalendar.tsx` | `CalendarSpecial`, `CalendarExistingRole`, `monthDays`, `dayOfWeek`, `longDate`, `weekendNoun`, `refuseSpecialOn`, `refuseWeekendOn`, verbatim; `MonthCalendar.tsx` imports and re-exports them |
| `app/components/admin/plannerMonth.ts` (new, neutral) | in `MonthGenerator.tsx` | `MONTHS`, `getDates`, `SAVED_WINDOW_DAYS`, `savedWindowFor`, `buildUnavailabilityNotices`, `historyMonthsLabel`, `DERIVED_HISTORY_AUTO_TIMEOUT_MS`, `DERIVED_HISTORY_AUTO_REFUSAL`, `MIN_YEAR`, `MAX_YEAR`, verbatim (the constants gain `export`) |
| `app/components/admin/plannerCells.ts` (new, neutral) | in `PlannerGrid.tsx` | `withUpdatedCell`, `categoryDuplicatesForColumn`, verbatim; `PlannerGrid.tsx` re-exports `withUpdatedCell`; `moveOccupant.ts` imports from the new module |
| `app/components/admin/autoFill.ts` (new, neutral) | the first half of `applySpecialFill` | `runLocalFills({ config, columns, rows, cells, members, savedWindow })` → `{ cells, unfilled }`; `applySpecialFill` calls it and keeps its three setters |
| `app/utils/solverTypes.ts` (new, neutral) | interfaces in `solve/route.ts:10-83` | `SolveRequest`, `SolveResponse`, verbatim; the three importers repoint (type-only) |
| `app/utils/solverCall.ts` (new, `server-only`) | `solve/route.ts:87-149,174-177` | `runSolve(request, { signal? })`; the route calls it with no signal |
| `app/utils/solverConfigRead.ts` (new, `server-only`) | `solver-config/route.ts:71-77,96-102` | `loadStoredSolverConfig()`, `solverConfigGetBody(doc)`; the route's GET and POST call them |
| `app/utils/serviceReadQueries.ts` (writer-imported) | — | + `solverPoolMembersQuery()` (projecting `ministries` for the I5 reporting filter), `plannerRolesInRangeQuery(from, toExclusive)` — additive |
| `app/utils/commitOutcome.ts` | success `status: 200` | `CommitOutcome<E, S extends number = 200>` — additive |
| `app/utils/roleCreateCommit.ts` (new, `server-only`) | `roles/route.ts:118-368,376-401` | `createRole(body: unknown): Promise<CommitOutcome<RoleCreateEffects, 200 \| 201>>`, verbatim |
| `app/api/admin/roles/route.ts` | auth + domain | POST = auth + JSON parse + `createRole(body)`; GET unchanged; still wrapped by `withVerificationRunContext` |
| `app/utils/protectedReadAudit.ts` + test | `roles/route.ts#POST` | `app/utils/roleCreateCommit.ts#module`, same reason re-pointed (count unchanged) |
| `__fixtures__/deliveryCapableImports.ts` | 9 names | + `roleCreateCommit` |
| `serviceCommitCallers.test.ts` | 5 rows | + `roleCreateCommit: ["app/api/admin/roles/route.ts", "app/mcp/tools/applySchedule.ts"]` |
| `app/utils/monthPlanReads.ts` (new, `server-only`) | — | the solve/revise/apply server reads (pool, rules, month and window roles, history), each isolated |
| `app/components/admin/monthProposalModel.ts` (new, neutral) | — | selection, the Auto outcome, preflights, reports (with `worshipAudience`, the I5 filter), the unfilled report, the revise gate and recompute, `targetStateOf` (the one target classifier, solve and apply), the apply outcome table (`planApply`, `classifyCreate`, `sameServiceIdentity`, `APPLY_ACTIONS`/`APPLY_OUTCOMES`, `applyComplete`), `createBodyFor`, kind↔type |
| `app/mcp/monthProposals/*` (new; not `proposals/`, which would collide with the setlist proposal's `app/mcp/reads/proposalPresenter.ts`) | — | `documentTypes.ts` (import-free), `proposalDocument.ts` (neutral; the revise patch builder carries every service's `atSolve` and `apply` from the loaded record), `proposalStore.ts` (`server-only`, `writeClient`; every patch under `ifRevisionId`, every apply-side one also proving the lease's nonce — step 7's write table), `monthProposalPresenter.ts` (the month-proposal refusal shape, `proposal_busy`'s `retryAfterSeconds` and wait-and-call-again `next` included), `runMonthProposalTool.ts` |
| `sanity/schemas/mcpProposal.ts` (new), `sanity/schema.ts`, `app/utils/studioProtection.ts` | — | the hidden, read-only, governed internal type |
| `app/mcp/__tests__/mcpSanityClients.test.ts` | 1 allowlisted file | + `app/mcp/monthProposals/proposalStore.ts` (`writeClient`) |
| `app/mcp/writes/runWriteTool.ts` | fixed copy | optional `copy` parameter (P3 callers unchanged) |
| `app/mcp/writes/refusals.ts` | `refusalFor` (whole call) | + `serviceRefusalLine(outcome)` → `{ code, detail?, reason }`, one create outcome's line, sharing `CODE_COPY`/`DETAIL_COPY`; `refusalFor` and its P3 outputs unchanged |
| `app/mcp/tools/{solveMonth,reviseProposal,applySchedule}.ts` (new) | — | one tool each |
| `app/api/mcp/route.ts` | 12 tools, `maxDuration = 60` | 15 tools, `maxDuration = 180` declared in the route file (§ «The time budget»), which out-ranks the Default Max Duration (code > dashboard, AS9, proven at Release A) — pinned by `fluidCeiling.test.ts` and ADR-0013's allowance line |
| `scripts/mcp-dev-smoke.mjs` + test | 12 tools, 2 annotation classes | 15 tools, 3 annotation classes; the three new tools listed, never callable |
| `docs/MCP.md`, `docs/API_REFERENCE.md`, `docs/DATA_MODEL.md`, `docs/SOLVER_AND_INFRA.md`, `docs/NOTIFICATIONS.md`, `docs/CI.md`, `docs/README.md`, `docs/SECRETS.md` (the existing `OWT_SOLVER_API_KEY` entry, post-approval change 1), ADR-0043 amendment, new ADR-00NN (next free at merge; change 10), `CLAUDE.md`, `AGENTS.md`, spec + spec review log, roadmap + roadmap review log | — | steps 1 and 11 |
| Production dataset | — | `mcpProposal.*` records (private, 7-day, swept); the live-proof drafts, removed by Frank in `/admin` |

No trust boundary moves: every tool dispatches after P0's six checks; the store is reachable only
through the three tools.

## Ordered changes

Every step leaves the four gates green (`npx tsc --noEmit`, `npm test`, `npx eslint .` with 0 errors;
no `gcf/**` change, so no Python gate). P4 ships as **two releases**: **Release A** (step 1, Fluid)
and **Release B** (steps 3–11, the tools). Nothing between them deploys: `claude/*` builds are
canceled (`scripts/vercel-ignore-build.mjs`). Each extraction is reviewable as a **move**
(`git diff --color-moved=dimmed-zebra --color-moved-ws=allow-indentation-change`); the only changes
allowed inside a moved body are the listed boundary edits.

### 0. Entry gate (no code)

- This plan approved at critical tier, its review log committed; Frank's go-ahead.
- **Q1 and Q2 answered by Frank on 2026-09-28: yes to both** (early create timing on dev; the
  throwaway month is the first month from 2027-03 on with no services). Q3 has a default and blocks
  nothing. Q4 (the roadmap rollback's narrowing) blocks nothing here, but step 12's entry needs
  Frank's answer.
- **P2 D2**: merged to `main` as `98aa67a9` and **released on 2026-09-28** — production alias
  verified (`dpl_3TFsEhFDhapfCaCW6xTHZJDjuspz`, `githubCommitSha` `98aa67a9`, which carries
  `SOLVER_HISTORY_SOURCE = "derived"`). P4-R1's release gate is therefore met on record.
  Every parity test mocks the switch to `"derived"` (as `MonthGenerator.derivedHistory.test.tsx:20`
  does), so the suite does not depend on the constant; step 12 re-runs it on the merged tree. The
  runtime refusal (M23) is the control that holds whatever the process does.
- `git worktree prune`. Release A branches `claude/mcp-p4-fluid` from `main`; Release B branches
  `claude/mcp-p4-tools` from `main` after Release A merged. Both start from a tree that already
  carries P2 D2; step 12 merges `main` again to take in anything released meanwhile before its
  review. Any worktree clones
  `node_modules` with `cp -Rc` from a checkout whose lockfile matches and symlinks `.env.local`
  (CLAUDE.md).

### 1. Fluid compute (Release A)

- **Purpose:** lift the function ceiling (F2) safely, before anything depends on it (P4-R2) — and
  lift it **only** for a function that declares a longer `maxDuration` in code. Every function that
  declares none keeps the legacy 10 s (D24).
- **Change 1 — `vercel.json` and the re-cap:**
  - `vercel.json` gains `"fluid": true` **and nothing else** (P4-R14). Its other keys do not change;
    `deployBranchPolicy.test.ts:70-72` still finds `ignoreCommand`.
  - **Every function that declares no `maxDuration`** — the 44 undeclared route handlers, the 16
    `page.tsx`, Next's `_not-found`, `proxy.ts`, anything else — is re-capped by the project's
    **Default Max Duration = 10** (Settings → Functions → Function Max Duration), **set by Frank**
    (a project setting; the agent never changes it). One mechanism for routes and pages alike: the
    dashboard default is the documented stage between `vercel.json` and Fluid's defaults, so it
    reaches every function no higher stage configures — and with no `functions` key in `vercel.json`,
    the only higher stage is the function's own code. The 17 routes that declare `60` therefore keep
    60 (code > dashboard: AS9, already evidenced here before Fluid — the Platform evidence row — and
    re-proved under Fluid at Release A's verify, (P) below). **When it is set** (post-approval
    change 7): 10 is today's implicit default (F2's readings), but an **explicit** dashboard value's
    rank against a route's own declaration is exactly what (P) has not yet proved (arm (iii)) —
    and the setting reaches every deployment built after it, production included, Fluid or not. So
    Frank sets it **only after Release A's code review passes, immediately before the `preview`
    merge**, and **no production deploy of anything** (no merge to `main`, no production redeploy)
    happens between setting it and a passing (P); if one must, (P)'s check (Auto on `/admin`,
    which writes nothing) runs on that production deployment first, before anything else proceeds:
    a fail there means Frank returns the setting to its pre-release state at once and production is
    redeployed; an inconclusive run is not a pass — the deploy stands and the freeze continues.
    Because (P) may need several
    cold windows (post-approval change 3), this freeze can outlast a day; PRs may be opened and
    gated meanwhile, not merged. The agent reads it back (`resourceConfig.functionDefaultTimeout: 10`
    on `/v9/projects/…`), and the date and the reading are recorded in the evidence file and in
    ADR-0013's amendment by a **post-review record commit** (below, «Release A»).
    Every release's deploy verification re-reads it ((O-a) below; steps 12.3–12.4), so a later
    dashboard change is caught at the next release at the latest — and the `CLAUDE.md`/`AGENTS.md`
    line (Change 4) says never to raise it.
  - **No `vercel.json` `functions` glob (P4-R14).** A glob such as `"app/api/**/*"` → 10 is rejected:
    it sits above the dashboard in the precedence order, so if it out-ranked a route's own
    `export const maxDuration` it would cut `/api/admin/solve` and the flush sweeps (both `60`) to
    10 s; and its per-function effect could only be observed by writing the preview environment to
    disk, which this project's secrets rule forbids (an agent never materialises a secret's value,
    and deleting the file afterwards does not satisfy the rule).
- **Change 2 — the concurrency audit.** Under Fluid one instance serves concurrent invocations, so
  every mutable module-level binding in server-reachable code is shared. The audit has two parts.

  **(i) The pinned rows — exactly the scanner's hit set** (Change 3's two emitting classes, run over
  the tree at `98aa67a9`: eight bindings, no more, no fewer). The test pins these `file#binding` keys
  and their reasons; nothing else may appear in its table:

  | Pinned `file#binding` (line) | Sharing under Fluid | Disposition (the pinned reason) |
  |---|---|---|
  | `app/utils/memberAccess.ts#cache` (`:12`, `new Map`, 30 s TTL, keyed by member id) | Two invocations may read or refresh one key concurrently; each write stores an equally fresh value | **safe**: the same semantics as warm reuse today; revocation still bites within 30 s (O2) |
  | `app/mcp/oauth/grantStore.ts#cache` (`:55`, `new Map`, 30 s TTL, frozen values) | same; the refresh path bypasses it with `fresh: true` (`:104-122`) | **safe** |
  | `app/utils/outboxSweep.ts#roleReadCache` (`:338`, `let`), reset at the top of every sweep (`:659`) | An overlapping sweep in the same instance can reset another's memo mid-sweep | **safe, slower**: the file already states it — "the cost is a repeated read, never a wrong one" (`:334-337`); every read is live state. The comment gains "reachable under Fluid compute" |
  | `app/utils/email.ts#cachedTransport` (`:144`, `let`; nodemailer pool, `maxConnections = SEND_CONCURRENCY` = 8, `:147-183`) | Two overlapping sweeps in one instance share one pool of 8 connections, where today each invocation owns its pool | **safe, with an observation and a stop condition** — below |
  | `app/utils/googleIdToken.ts#ALLOWED` (`:5`, `let`; env-derived, test-only setter `:12`) | read-only at runtime | **safe** |
  | `app/utils/native.ts#socialLoginPromise` (`:8`, `let`) | browser-only (Capacitor) | **not server-reachable**; pinned with that reason |
  | `app/utils/haptics.ts#pluginPromise` (`:9`, `let`) | browser-only (Capacitor) | **not server-reachable**; pinned with that reason |
  | `app/components/song/metronome.ts#current` (`:51`, `let`) | browser-only (Web Audio) | **not server-reachable**; pinned with that reason |

  **(ii) Commentary — reviewed, not pinned.** These hold instance state a text scan of `let`/`var`
  and mutated collections cannot emit, so they are not rows of the test's table; the fresh code
  review of each release range re-reads this list against the tree (step 1's Release A review,
  step 12's review):
  - `app/utils/srVerificationRunContext.ts:72` `storage = new AsyncLocalStorage()`: per async
    context by construction (its header rejects `enterWith`, `:24-28`) — **safe**.
  - `app/utils/firebaseAdmin.ts:6-15` `getApps()` then `initializeApp`: synchronous check-and-init,
    no `await` between — **safe**.
  - `app/api/mcp/route.ts:61,83-105` `SERVER_INFO`, `mcpHandler`: immutable; `mcp-handler` builds a
    fresh server per request (`:63-66`) — **safe**; a new route test sends two interleaved
    `tools/call` and asserts each gets its own result.
  - `app/utils/googleIdToken.ts:14` `client = new OAuth2Client()`: its library-internal certificate
    cache is shared by concurrent verifications — public, expiring Google certs, the same sharing as
    warm reuse today — **safe**.
  - The five Sanity clients (`sanity/lib/client.ts:5`, `operationalClient.ts:16,31`,
    `serverClient.ts:5,14`): stateless HTTP clients — **safe**. `process.env`: no runtime
    assignment under `app/`, `sanity/lib`, `auth.ts`, `proxy.ts` (grep) — **safe**.
  - Every other module constant (unmutated `Set`s/`Map`s such as `PRUNE_CODES`,
    `REVIEWABLE_STATUSES`, `studioProtection.ts`'s sets; frozen objects; `ping.ts:41`'s
    `Intl.DateTimeFormat`) is read-only.

  **The SMTP pool, resolved.** Three facts bound what sharing can do:
  1. Stage 7 admits a wave only if the whole wave still fits at its worst case,
     `Date.now() − start + SEND_TIMEOUT_MS ≤ budget` (`outboxSweep.ts:989-1004`), and every send,
     pool queue wait included, is raced against `SEND_TIMEOUT_MS` = 20 s (`email.ts:24,166-170,216-240`).
     So sharing cannot push a sweep past its deadline.
  2. The unsent tail is **re-pended, not destroyed** (`:1025-1037`: "only the budget tail is
     returned, which is what makes setlist fan-out lossless"). Halved throughput under overlap
     delays mail to the next sweep; it loses none.
  3. Destruction happens only when an attempted send FAILS or TIMES OUT. Overlap adds at most one
     wave of queue wait (measured p95 2 429–2 605 ms at width 8, ADR-0013 `:34-39`; CLAUDE.md) to a
     send raced against 20 s. Sharing also keeps this Gmail account's concurrency at 8 per instance,
     where two instances today can hold 16.

  So the budget inequality `(waves − 1) × MEASURED_MS_PER_SEND` (CLAUDE.md «Known landmines») is
  unchanged for a lone sweep; under overlap its effective per-wave time can double, which moves
  recipients from «emailed» to «re-pended», never to «lost». The constant is **not** raised.
  **Observation — from the durable record, not from runtime logs.** The flush workflow's runs
  (`.github/workflows/flush-notifications.yml`), which GitHub keeps, are the soak's source: the
  report body each run prints (`cat "$BODY"`, `:100-101`), which carries `lost`, `failed`,
  `unserved`, `repended` and `skipped`, and the annotations at `:108-167` — `::error::` on
  `lost > 0` and on `failed ≥ 2`, `::warning::` on `failed == 1` and on `skipped > 0`
  (`unserved` has no annotation; it is read from the printed body). They are listed with
  `gh run list --workflow flush-notifications.yml` and read with `gh run view <id> --log`, and the
  soak compares its window with the same workflow's runs over the 14 days before Release A. The
  `notify_sweep_*` runtime lines (`msPerSend`, each failed send's error) live about an hour on Hobby
  (`docs/NOTIFICATIONS.md:528-529`): they are read only to diagnose a red run caught within that
  hour, never as the record. **Declared gap:** the layer-3 daily cron's sweep returns its report to
  Vercel's scheduler, which reads nothing (`docs/NOTIFICATIONS.md:521-523`), so it leaves no durable
  record for the soak. **Stop condition:** a flush run red on `lost > 0`, or red on `failed ≥ 2`
  when the 14 pre-Fluid days had no such run → revert `"fluid"` (step 1's «Rollback» below: since
  post-approval change 7, a dashboard step by Frank plus a PR that also amends the record line) and escalate to Frank,
  with the same-hour `notify_sweep_*` lines attached when the red run was caught within the hour
  (their error tells a timeout from a provider throttle) and the annotation alone otherwise.
  `unserved` is a delay by design (fact 2), not a stop condition by itself: a level the 14 pre-Fluid
  days never showed is escalated to Frank with the numbers.
- **Change 3 — two guards.**
  - `app/utils/__tests__/moduleStateAudit.test.ts` (new). **Files:** `git ls-files app sanity/lib
    auth.ts proxy.ts`, `.ts`/`.tsx`, excluding `__tests__/`, `*.test.*`, `__fixtures__/` and `*.d.ts`;
    each comment-stripped with the repo's `stripComments` (`scripts/lib/strip-comments.mjs`) BEFORE
    the `"use client"` test, so a comment above the directive cannot hide it; a file whose first
    statement is `"use client"` is skipped. **Three classes:**
    1. top-level `let`/`var` bindings (`export` or not);
    2. top-level `const X = new Map|Set|WeakMap(…)` bindings the same file mutates (`X.set(`,
       `X.add(`, `X.delete(`, `X.clear(`) — so the unmutated module sets (`PRUNE_CODES`, …) never
       enter;
    3. top-level `const X = {…}` or `[…]` the same file mutates **in place** — a property or index
       assignment (`X.k =`, `X[k] =`, compound assignment, `++`/`--`), `delete X.k`,
       `Object.assign(X, …)`, or an array mutator (`push`, `pop`, `shift`, `unshift`, `splice`,
       `sort`, `reverse`, `fill`, `copyWithin`).

    Classes 1 and 2 must equal the pinned table of Change 2 (i) **exactly** — the sorted
    `file#binding` list, every entry with its reason: a new mutable binding fails until someone pins
    it on purpose, and a removed one fails until it is unpinned, so the table can never hold a row the
    scanner does not emit. Class 3 is the first two classes' blind spot — an object or array mutated
    by property assignment or `push` holds shared state with no `let` and no collection — and **none
    exists today** (the same scan over `98aa67a9` returns nothing), so it is pinned to the empty list:
    the first one fails the suite and must be reasoned into the table. **What stays blind, declared:**
    mutation through an alias or from another module (an imported object mutated by its importer), and
    the internal state of library instances (Change 2 (ii)'s `AsyncLocalStorage`, `OAuth2Client`,
    Sanity clients; the nodemailer pool behind `cachedTransport`). Those are covered by the commentary
    list and by each release's fresh code review, which checks every new module-level instance or
    exported object in its range for shared mutable state. The scanner has positive and negative unit
    cases per class (a `let` inside a function, an unmutated `new Set`, a `const` object only read, a
    `"use client"` file behind a leading comment, a `__fixtures__` file — none emitted).
  - `app/utils/__tests__/fluidCeiling.test.ts` (new). **Files:** `git ls-files app`, `.ts`/`.tsx`,
    excluding `__tests__/`, `*.test.*` and `__fixtures__/`, comment-stripped with `stripComments`;
    a declaration is `export const maxDuration = N` (a route, page or layout may carry one). Four
    assertions:
    1. **`vercel.json`'s shape, exactly:** its top-level keys are exactly `ignoreCommand`, `crons`
       and `fluid`, and `fluid === true` — so a `functions` key (the rejected glob, P4-R14) or any
       other new key fails the suite. The values of `ignoreCommand` and `crons` are not this test's
       (`deployBranchPolicy.test.ts` pins the first; the cron schedule is its own concern).
    2. **Every declaration, pinned:** the map `file → N` equals a pinned map — today the 17 route
       files at `60`, and in Release B `app/api/mcp/route.ts` at `180`. Under the Default Max
       Duration a route that **loses** its declaration silently drops to 10 (a `/api/admin/solve` or
       a flush sweep killed at 10 s), so a removed declaration fails exactly as a new one does until
       it is pinned on purpose.
    3. **Above 60 only where ADR-0013 allows it:** the pinned files with `N > 60` equal, file for
       file and value for value, the ones ADR-0013 names on its dated allowance lines, «Declared above
       60 s: `<file>` — <N> s (<date>)» — today none, so the amendment carries no allowance line and a
       first declaration above 60 fails until the ADR names it (in Release B, `app/api/mcp/route.ts`
       at 180, step 11) — and each such declaration requires `vercel.json`'s `fluid === true`, so
       reverting Fluid without lowering the ceiling fails the suite; every `N ≤ 300` (Hobby's Fluid
       maximum).
    4. **The dashboard setting, recorded:** ADR-0013 carries the dated line «Default Max Duration:
       10 s — project dashboard (Settings → Functions), set <date>». The header states that this pins
       the repo's **record** of a setting git cannot hold, not the setting; the setting itself is
       checked by each release's deploy observation ((O-a) below; steps 12.3–12.4). Since the
       setting is made only after the code review (post-approval change 7), this assertion and the
       line it reads land **together in the post-review record commit** («Release A» below), so
       the reviewed range stays green without a line that could not yet carry a real date.
- **Change 4 — docs, same delivery.**
  - **ADR-0013 amendment** (dated): Fluid compute is on (`vercel.json`), so the Hobby **maximum** is
    300 s, not 60 — and **Fluid raises nothing by default here.** Every function that declares no
    `maxDuration` stays at the legacy 10 s (the repo's own record, `app/api/admin/solve/route.ts:98`;
    F2's readings show it was Vercel's default, not a setting, so Fluid's 300 s default would have
    replaced it): the 44 undeclared route handlers, every server-rendered page, `_not-found`,
    `proxy.ts` and anything else, through one project setting, the Default Max Duration = 10 (with
    its dated record line, the one `fluidCeiling.test.ts` reads, and the read-back). The 17 routes
    that declare `60` keep 60: code out-ranks the dashboard — evidenced before Fluid (the solve route
    answering 200 past 10 s on dev, 2026-09-28; flush runs dying at 60 s, not 10, on 2026-08-06) and
    re-proved under Fluid at Release A's verify (the call and its reading recorded). Only a function
    that declares a longer ceiling in code gets one, and each one above 60 is named on a dated
    allowance line here («Declared above 60 s: …», read by `fluidCeiling.test.ts`) — none in
    Release A; in P4, `/api/mcp` at 180 (Release B adds its line). **Why re-capped rather than
    accepted** (D24): accepting 300 s would have let a hang in any of those functions (a Sanity
    or HTTP call that never answers) hold its invocation 30× longer, spend up to 30× the provisioned-memory GB-hrs against Hobby's 360 GB-hr
    allowance (Active CPU pauses on I/O; memory does not, AS8), and leave a member on a spinner for
    five minutes instead of a 504 at ten seconds — and the only way to watch for it, per-path
    request durations, **does not exist on Hobby** (no duration in the runtime logs, the
    Observability API 404, `docs/MCP.md:942-945`; about an hour of retention,
    `docs/NOTIFICATIONS.md:528-529`), so a "watched" acceptance would have been an unwatched one.
    Two alternatives are rejected: a `maxDuration` export in each of the 44 routes and every page —
    the same re-cap spelled in 60 files, with no guard against the 61st; and a `vercel.json`
    `functions` glob (P4-R14) — it sits above the dashboard, so a glob that out-ranked a route's own
    declaration would cut `/api/admin/solve` to 10 s, and its per-function effect could not be
    observed without writing the preview environment to disk. **The limits are observed, not
    assumed:** Release A's verify step reads the deployment's configuration and the project's setting
    ((O-a)) and proves code's precedence with a real call ((P)), and the amendment records both.
    Also recorded: the SMTP-pool analysis above and its durable observation; the cost (Hobby
    includes 4 h Active CPU, 360 GB-hrs and 1M invocations a month and has no on-demand line — **past the allowance Vercel
    limits the functions until the cycle resets**, so usage is a stop condition, not a bill), with
    **the pre-Fluid usage baseline** (below) quoted as the reference the soak's 50 % line is read
    against. The «Raising `NOTIFY_SEND_BUDGET_MS`» paragraph (`:97-98`) is annotated: the ceiling is
    no longer the reason; the send budget's own derivation still is.
  - The two comments (`email.ts:139-143`, `outboxSweep.ts:334-337`) name Fluid. Comment-only edits.
  - `docs/CI.md` (the Vercel section beside `ignoreCommand`) and `docs/SOLVER_AND_INFRA.md` state
    that Fluid is on and why, the re-cap (the Default Max Duration alone; no `vercel.json` glob,
    P4-R14), and that the **Default Max Duration is a project setting that must stay 10**
    (Settings → Functions; not in git; set by Frank on <date>; raising it lets every page run up to 300 s under Fluid) — non-secret configuration, so it lives
    here and not in `docs/SECRETS.md`.
  - `CLAUDE.md` **and** `AGENTS.md` («Vercel safety»), one line: "Fluid compute is on
    (`vercel.json` `"fluid": true`) and raises NO function's duration: a function that declares no
    `maxDuration` — route handler or page — stays at 10 s through the project's Default Max
    Duration, 10 (Settings → Functions, not in git — never raise it; never add a `vercel.json`
    `functions` key). A longer limit is declared in code, per route, and out-ranks the dashboard;
    `fluidCeiling.test.ts` pins `vercel.json`'s keys and every declaration, and a declaration above
    60 needs Fluid and an ADR-0013 allowance line. One instance serves concurrent invocations, so
    module-level mutable state is shared — `moduleStateAudit.test.ts` pins every binding its scanner finds with its reason (and
    module objects mutated in place, pinned empty)." (Under an AS1 fallback, this line, the test
    and the ADR amendment take the forms «If AS1 fails» gives below.)
- **Pre-Fluid usage baseline** (before the code review, so before Release A reaches `preview` — the
  first Fluid deployment; dev and production bill to the one project, so preview's Fluid usage
  counts too): Frank reads the team's Vercel **Usage** page for project `owt-backstage` (or the agent
  reads it read-only in a browser session Frank opens; the record says which) and records, month to
  date, **Active CPU**, **provisioned memory / function duration (GB-hrs)** and **function
  invocations**, each under the name the page uses — a metric the pre-Fluid page does not show is
  recorded as *absent*, never as zero (the soak then reads its Fluid-era rate from the reading
  alone, below) — with the reading's date, the billing cycle's start and the days elapsed.
  **Where:** the cycle evidence file (`owt-agent-logs/sdd/2026-09-28-owt-mcp-p4/evidence.md`,
  section «Release A — pre-Fluid usage baseline») and the ADR-0013 amendment (committed before the
  review, so the reviewed range carries it); quoted again in `docs/MCP.md`'s P4 record (step 15).
  Without it the soak's 50 % stop line has no reference: it cannot tell a Fluid-driven rise from
  the project's ordinary rate. **The soak's other two references need no reading now:** the flush
  workflow's pre-Fluid runs are durable and are read at the soak (Change 2); the one pre-Fluid sample
  of production's runtime logs (`vercel logs <production deployment> --json`, the last hour, its
  error-level lines and any non-2xx status the records carry) is taken with the baseline and
  recorded beside it.
- **Observing the effective limits** (Release A's verify step, on the `preview` deployment, before
  any PR to `main`). Read-only, available on Hobby, and nothing written to disk: no API lists a git
  deployment's per-function limits (F2's evidence row), so the observation is the deployment's and
  the project's configuration, plus one real call that shows a declaration out-ranking the default.
  No step reads the project's environment (P4-R14).
  - **(O-a) The deployment's and the project's configuration:** `npx vercel api
    /v13/deployments/<id> --scope frank-rochas-projects --raw` (the command read production on
    2026-09-28: `functionType: "standard"`, `functionTimeout: 10`, `functions: null` — the pre-Fluid
    reading) and `/v9/projects/prj_elS88VGezKpy18wizFN1ffoy8cJ5`. **Pass:** `config.functionType ===
    "fluid"` (AS1); `config.functionTimeout === 10` (the Default Max Duration reached this
    deployment, so every function without its own declaration runs at 10); and the project's
    `resourceConfig.functionDefaultTimeout === 10`. The deployment's `functions` field is recorded as
    read and is not a criterion. **A second Fluid signal, recorded** (post-approval change 4): the
    deployment's `config.isUsingActiveCPU` (production read `false` pre-Fluid, the Platform
    evidence row; Active CPU is Fluid's billing) is recorded beside `config.functionType`.
    `isUsingActiveCPU` alone proves nothing: (O-a)'s Fluid criterion is `functionType === "fluid"`
    **with `isUsingActiveCPU` agreeing** (`true`), and **no failure arm is chosen on `functionType`
    alone** — arm (i) below needs both signals to say Fluid is off; when the two disagree, the
    release stops at (O-a) and both readings go to Frank before any arm is taken. **If (O-a) cannot be read — the API does not expose
    `config.functionType`/`config.functionTimeout` for the deployment, or `resourceConfig` for the
    project — the release stops there: Release A never reaches `main` on an assumed limit.**
  - **(P) The precedence proof — code > dashboard under Fluid, by a real call** (never a new probe
    route). **Expect most runs to be inconclusive** (post-approval change 3): the conclusive bar
    below is a time to first byte of at least 11 000 ms, and F1 measured the whole solve at
    7 278–10 279 ms (an October, first run included), so a run reaches the bar only when a GCF cold
    start lands on a large month, and Release A **may need several cold windows** (each after
    ≥ 30 min with no solve, possibly on different days) before one is conclusive. That is a
    schedule cost, expected and accepted — never a reason to lower the bar or defer (P). After
    (O-a) passes, Frank runs the planner's Auto on `dev-owt-backstage` `/admin` —
    «Generar mes» → **November 2026** (5 Sundays) → «Previsualizar» → Auto — after at least 30 min
    with no solve from either deployment, so the GCF's cold start adds to the solve (S1's condition,
    step 2; if S1 has not run yet, this run is also S1's cold run). Auto writes nothing; the dialog is
    closed without creating. The agent reads, read-only in Frank's session,
    `performance.getEntriesByType("resource")` for `/api/admin/solve` (`maxDuration = 60`): its
    `responseStatus` (or the Network panel where the browser lacks that field), its time to first byte (`responseStart − requestStart`) and its `duration`.
    **Pass (conclusive):** status 200 with a time to first byte of at least **11 000 ms** — a
    declared 60 governed a function that ran past 10 s on a Fluid deployment whose default is 10; the
    extra second is margin for the network round trip the browser's timing includes, which is also
    why the pre-Fluid 10 279 ms (the Platform evidence row) is a close reading, not a wide one.
    (A 504 at about 60 s is conclusive too: the declared ceiling governed.) **Fail:** a 504
    (`FUNCTION_INVOCATION_TIMEOUT`) at about 10 s — the dashboard's 10 cut a declared route: AS9 is
    false, arm (iii) below. **Inconclusive:** a 200 under 11 000 ms — the solve
    finished before the question arose. It is **repeated within Release A**, each run after another
    30 min with no solve, until one is conclusive or fails; it is **never deferred to Release B's
    `solve_month`**, because a dashboard that out-ranked code would cut `/api/admin/solve` and the
    flush sweeps (both `60`) to 10 s on production, where the soak would learn it only from a red
    flush run or a member's failed Auto. After three inconclusive runs the agent stops and asks
    Frank for the next window (another hour, another month); Release A does not reach `main` without
    a conclusive run.
  - **The readings** — (O-a)'s fields and each (P) run's time, status and timings — go to the
    evidence file («Release A — effective function limits») and to ADR-0013's amendment. **Declared
    residual:** (P) exercises one declared route; the other 16 declarations at 60 (and Release B's
    180) rest on the same mechanism — a code declaration out-ranking the dashboard — and on
    `fluidCeiling.test.ts`'s pinned map, not on a per-function reading, which Hobby does not offer.
- **Release A** (CLAUDE.md order; the Default Max Duration's place changed by post-approval change
  7): gates → the pre-Fluid usage baseline (above) → fresh code review of the range (it checks the
  audit's pinned table against the scanner's hit set and the commentary list against the tree, the
  two guards — `fluidCeiling.test.ts`'s `vercel.json` keys (no `functions`), declaration map and
  allowance lines against the tree — and that the baseline is recorded) → fix → re-verify →
  **the Default Max Duration**, immediately before the `preview` merge: Frank sets 10 in Settings →
  Functions; the agent reads it back through the project API; the **record commit** puts the date
  and the reading in the evidence file and on ADR-0013's record line, fills the same date into
  `docs/CI.md` and `docs/SOLVER_AND_INFRA.md`, and adds `fluidCeiling.test.ts`'s fourth assertion
  with the line it reads → **scoped re-verify** of that commit (a scoped review plus the four gates
  on the final tree, so the last worklog entry before the merge is still a verification) → merge
  into `preview`, push, verify the dev alias
  (`dev-owt-backstage.vercel.app` in `alias`, `meta.githubCommitSha` = the pushed commit) **and
  observe the effective limits ((O-a) must pass, then (P) must be conclusive)** → PR to `main`,
  `gates`, merge with Frank's OK → verify the production alias the same way and read (O-a) on the
  production deployment. **From the setting until a conclusive (P), nothing deploys to
  production** (Change 1's window rule; if something must, (P)'s check runs on that production
  deployment first).
- **Soak:** at least 48 h of production on Fluid before Release B merges. It watches what Fluid
  still changes — concurrency and usage — from sources that exist on Hobby; durations need no watch,
  because the re-cap keeps them what they were and the verify step observed it:
  - **SMTP sharing:** the flush workflow's runs against its 14 pre-Fluid days (Change 2: the durable
    record, its stop condition, and the declared layer-3 gap).
  - **Usage:** the Vercel usage page — the baseline's three metrics, with the reading's date and
    days elapsed — at least once a day.
  - **Errors, sampled:** `vercel logs <production deployment> --json` holds the last hour only, so
    the agent reads it at least twice a day and records each sample's error-level lines and non-2xx
    statuses by path, against the pre-Fluid sample (above). A sample is a sample, not a record, and
    the soak says so.

  **Stop conditions:** the SMTP one (Change 2); a `FUNCTION_INVOCATION_TIMEOUT` or 5xx pattern in a
  sample, in a flush run (`::error::Expected HTTP 200`, `:103-105`) or reported by a member, that the
  pre-Fluid sample and runs did not show; **usage on track for more than 50 % of any monthly
  allowance**, read against the baseline: the Fluid-era rate is (reading − baseline) ÷ the days
  between them — or, for a metric the baseline recorded as *absent* (likely Active CPU, which the
  pre-Fluid page may not meter), the reading ÷ the days since Release A's first Fluid deployment
  (its `preview` push; dev and production bill to the one project), since there is nothing to
  subtract — projected over the days left in the cycle and added to the reading; that projection
  above 50 % of an allowance stops the soak. The baseline's own rate (its month-to-date ÷ its days
  elapsed) is recorded beside it, so a line the pre-Fluid rate already crossed is escalated to
  Frank as such rather than blamed on Fluid.
- **Rollback:** a PR removing `"fluid": true` and changing `fluidCeiling.test.ts`'s first assertion
  to the keys `ignoreCommand`, `crons` (and, after Release B, lowering `/api/mcp` to 60 and deleting
  its ADR-0013 allowance line in the same PR, which the third assertion enforces). **The Default
  Max Duration does not simply stay** (post-approval change 7): (P) proved an explicit 10's rank
  under Fluid only, and without Fluid it buys nothing (the implicit default is 10), so Frank returns
  it to its pre-release state (`resourceConfig` without `functionDefaultTimeout`, read back by the
  agent) **before the rollback reaches `main`**, and the same PR amends ADR-0013's record line and
  `fluidCeiling.test.ts`'s fourth assertion to that state — production then runs exactly the
  configuration the Platform evidence row observed. Nothing else depends on Fluid until Release B.
- **If AS1 fails.** AS1 has four failure arms, all seen at the preview verify step, none of them
  reaching production (the dev alias keeps its previous deployment while a preview build fails, and
  `main` is untouched):
  - **(i) Fluid ignored** — (O-a) reads `functionType` other than `"fluid"` **and**
    `isUsingActiveCPU` other than `true` (both signals; a disagreement stops the release for Frank,
    post-approval change 4): the Fluid fallback below.
  - **(ii) `vercel.json` rejected** — the preview deployment ends `ERROR` at build (the `fluid` key
    refused by the builder): `preview` now carries an unbuildable `vercel.json`, so a fix removing
    the key is pushed to `preview` at once, before anything else is merged there; Fluid then goes
    through arm (i)'s fallback, which is Frank's decision.
  - **(iii) Code does not out-rank the dashboard under Fluid** — (P) fails: the declared solve route
    dies at about 10 s (AS9 false). No lower-risk re-cap is left to fall back to (the glob is
    rejected, P4-R14, and would sit above the dashboard anyway), so **the release stops**: a fix
    removing `"fluid": true` is pushed to `preview` at once, (P)'s call is repeated on the rebuilt
    non-Fluid preview to confirm the declared route runs past 10 s again under the now-explicit
    dashboard value (the pre-Fluid evidence ran under the implicit default), and Frank decides —
    per-file declarations (D24's rejected alternative) would need a new decision, not a quiet fix.
    If the non-Fluid preview also dies at 10 s, nothing is merged to `main` until Frank has returned
    the setting to its pre-release state and the same call passes. **Production is not exposed
    meanwhile** (post-approval change 7): the setting was made only immediately before the `preview`
    merge and nothing has deployed to production since (Change 1's window rule), so production has
    not been built under the explicit value (or, if a deploy had to happen, (P)'s check ran on it
    first, and a fail there already returned the setting and redeployed production); the window rule holds until the non-Fluid call
    passes or the setting is back in its pre-release state, whichever comes first.
  - **(iv) The dashboard default did not reach the deployment** — (O-a) reads `functionTimeout`
    other than 10, or the project's `resourceConfig.functionDefaultTimeout` other than 10: Frank
    re-sets the Default Max Duration to 10 (enabling Fluid in the dashboard, arm (i)'s fallback, may
    reset it), the agent reads it back, a new preview deployment is built and observed again; if it
    cannot be made to read 10, the release stops.

  Each response is made in the Release A branch and re-reviewed (a scoped review of the fix plus the
  gates) before the next `preview` push.
- **The Fluid fallback (arm (i)).** If `vercel.json`'s `"fluid": true` did not enable Fluid, and
  Frank enables it instead in the project's **Settings → Functions** (AS1's failure response), the
  repo must stop pointing at a field that does nothing. In the same Release A branch, before its
  review:
  - `vercel.json`: `"fluid": true` is **removed** (it is inert, and leaving it would tell the next
    reader the setting is versioned in git), and `fluidCeiling.test.ts`'s first assertion pins the
    keys `ignoreCommand`, `crons` — no `fluid`, no `functions`. The Default Max Duration stays: it
    does not depend on how Fluid is enabled.
  - `fluidCeiling.test.ts`'s third assertion changes its source of truth: it can no longer read the
    setting, so it pins the repo's **record** of it. A declaration above 60 requires, besides its
    allowance line, ADR-0013's amendment to carry the dated marker line «Fluid compute: ON —
    project dashboard (Settings → Functions), not `vercel.json`», and `vercel.json` must have **no** `fluid` key (so the
    inert field cannot return). Its header says plainly that this couples the ceiling to a record of
    the setting, not to the setting — the one thing a test cannot see — so the real check is each
    release's deploy observation, which reads the deployment's Fluid state and limits (Release A's
    and step 12's verify steps).
  - The `CLAUDE.md`/`AGENTS.md` line reads: "Fluid compute is on — set in the project dashboard
    (Settings → Functions, <date>), because `vercel.json`'s `fluid` field did not take effect on Hobby
    (ADR-0013). It is not in git: turning it off is a dashboard change that must come AFTER a merged PR
    lowering every `maxDuration` above 60 (`fluidCeiling.test.ts` pins ADR-0013's record of the
    setting, not the setting) …", followed by the re-cap and module-state sentences unchanged.
  - The ADR-0013 amendment records where the setting lives, the date and evidence that `vercel.json`
    was inert, that the setting has no PR history and no revert, the marker line the test reads, and
    the rollback order below. `docs/CI.md` and `docs/SOLVER_AND_INFRA.md` say the same.
  - **Preview first still holds:** the toggle applies to deployments built after it (the preview
    verify step confirms it), so Frank toggles it immediately before the `preview` push, the evidence
    file records the time, the agent re-reads the Default Max Duration right after the toggle (arm
    (iv): the toggle may reset it), and the production PR is the next production deployment.
  - **Rollback under the fallback** becomes a Frank action, not the plain «Rollback»'s single PR: first a PR lowering
    `/api/mcp` to 60 and deleting its allowance line and the ADR marker line (the test then passes
    with no ceiling above 60), merged and verified; then Frank turns Fluid off in Settings → Functions. The reverse order would
    leave a 180 s function on a 60 s platform. The Default Max Duration goes back to its pre-release
    state in the same dashboard visit, before the next production deployment, and the next PR amends
    the record line and the fourth assertion to it — as in the plain rollback (post-approval
    change 7). The same order replaces the «Rollback, Fluid» bullet of § «Rollout».
- **State after:** production on Fluid; every function's duration limit what it was (observed:
  (O-a) and (P)); behaviour otherwise identical.

### 2. The spike, narrowed (dev, read-only; S3 by Frank)

- **Purpose:** measure the three numbers F1 did not (the coordinator's narrowing): a GCF cold start,
  a 5-Sunday month, and per-create time. It needs no code and may run in parallel with step 1; an
  S1 run made after Release A's `preview` push is also step 1's precedence proof (P) when it is
  conclusive there.
- **S1, cold start:** on `dev-owt-backstage` `/admin`, after at least 30 min with no solve from
  either deployment (they share the GCF), «Generar mes» → **November 2026** (Sundays 1, 8, 15, 22,
  29; Saturdays 7, 14, 21, 28) → «Previsualizar» → Auto once (cold), then twice more (warm). The
  agent reads `performance.getEntriesByType("resource")` for `/api/admin/solve` and
  `/api/admin/solver-history` in Frank's session (read-only JavaScript). Auto writes nothing; the
  dialog is closed without creating. A cold run that answers 504 at 60 s is itself the finding
  "cold > 60 s" (the browser's own route cap, F10).
- **S2, the 5-Sunday month:** the same runs (November 2026 is one). The diagnostics line is recorded.
- **S3, per-create time (Q1, default: early):** Frank, in `/admin` on dev, previews a throwaway month
  with no services (Q2's month plus one, so the live proof's month stays empty) with one named
  weekday special «PRUEBA MCP P4 S3 — ignorar», and presses «Crear N borradores» (drafts: nobody is
  notified, F8). The agent reads each `POST /api/admin/roles` duration the same way, from
  `performance.getEntriesByType("resource")` in Frank's session. **Where the numbers come from:**
  S1–S3 are browser resource timings, read before that page is reloaded or closed (the buffer does
  not survive either) and copied to the evidence file at once; none comes from Vercel's runtime
  logs, which carry no request duration and keep about an hour (`docs/MCP.md:942-945`,
  `docs/NOTIFICATIONS.md:528-529`). Frank then deletes the
  drafts in `/admin`. The retired receipts, the vacated weekend target locks and the shared special
  coordinator stay behind, inert, and are not cleaned — a declared **narrowing of the roadmap's
  rollback** that Frank must see (§ «Roadmap amendments», the leftovers bullet; Q4).
  **Opt-out:** per-create time is taken at L4 from `apply_schedule`'s per-service `ms` instead.
- **Stop / escalate** (derived in § «The time budget»):
  - S1 cold ≥ 60 s (a 504) or warm p95 > 45 s → escalate with the numbers before step 8: the
    120 s abort still holds, but claude.ai's client timeout (AS7) becomes the binding unknown.
  - Any non-422 GCF error → investigate before step 8.
  - S3 per-create p95 > 10 s (4× P3's worst 2.4 s) or a month's creates > 100 s → the 130 s apply
    cut-off would bind: escalate and re-derive (raising the ceiling to 300 with the same arithmetic
    is the pre-authorised option; any other change is Frank's call).
- **Record:** the evidence file now; `docs/MCP.md`'s P4 record at step 15.

### 3. Neutral extractions out of client modules (behaviour-preserving)

- **Purpose:** the server can call nothing a `"use client"` module exports (ADR-0028), and parity is
  strongest when both sides call one function (F4; P4-R4 widened; D3).
- **Re-verify the citations first** (post-approval change 10): `main` is `e8660b26`, so before any
  extraction every planner citation in this step and in every later step is re-checked against that
  tree (or the branch's actual base), with change 10's offsets as the expected result; a cited body
  that differs from change 10's account stops the step for the coordinator. The bodies this step
  moves are unchanged by PR #109/#110 (change 10), so the moves themselves are unaffected.
- **3a — `app/components/admin/plannerCalendar.ts`** (new, neutral): from `MonthCalendar.tsx`
  verbatim — `pad`, `noon`, `CalendarSpecial`, `CalendarExistingRole`, `monthDays` (`:80-83`),
  `dayOfWeek` (`:85-87`), `longDate` (`:90-92`), `weekendNoun` (`:105`), `refuseSpecialOn`
  (`:140-172`), `refuseWeekendOn` (`:177-181`). `MonthCalendar.tsx` imports them and **re-exports**
  the four exported names and the two types, so `MonthCalendar.test.tsx:20` and every other importer
  is unchanged. `optionLabel` and `EXISTING_LABEL` stay (component-only).
- **3b — `app/components/admin/plannerMonth.ts`** (new, neutral): from `MonthGenerator.tsx`
  verbatim — `MONTHS` (`:204-205`), `DERIVED_HISTORY_AUTO_TIMEOUT_MS` and
  `DERIVED_HISTORY_AUTO_REFUSAL` (`:351-352`), `SAVED_WINDOW_DAYS` (`:356`), `getDates`
  (`:362-372`), `buildUnavailabilityNotices` (`:389-405`), `savedWindowFor` (`:469-479`),
  `MIN_YEAR`/`MAX_YEAR` (`:1204-1205`, read by `YearInput`'s clamp `:1230` and its `min`/`max`
  `:1236-1237`), `historyMonthsLabel` (`:1555-1559`). The four constants gain `export` and nothing
  else. `MonthGenerator.tsx` imports them.
- **3c — `app/components/admin/plannerCells.ts`** (new, neutral): from `PlannerGrid.tsx` verbatim —
  `withUpdatedCell` (`:454-498`) and `categoryDuplicatesForColumn` (`:507-541`, exported now).
  `PlannerGrid.tsx` imports both and re-exports `withUpdatedCell`; `moveOccupant.ts:24` imports it
  from `./plannerCells` (the neutral module, as the P4-R4 placement primitive). **In the same
  commit, `moveOccupant.ts`'s comments follow the import:** its header (`:1-8`) justifies the
  file's `"use client"` by the `PlannerGrid.tsx` import ("This module calls `withUpdatedCell` out of
  `PlannerGrid.tsx`, which is a client module"), and `:18` says it composes `withUpdatedCell`
  (`PlannerGrid.tsx`). After 3c neither is true. The directive **stays** (3c is behaviour-preserving,
  and removing it would change the file's boundary, which is not this step's decision); the header
  is rewritten to give the reason that remains — the directive is a deliberate boundary statement
  for a grid-interaction primitive whose callers are client components, kept as a property of the
  file (ADR-0028), no longer forced by an import — and `:18` names `plannerCells.ts`. Comment-only;
  the move-diff review sees it as such.
- **3d — `app/components/admin/autoFill.ts`** (new, neutral): `runLocalFills({ config, columns, rows,
  cells, members, savedWindow })` returns `{ cells, unfilled }` — the loop over special columns
  calling `fillColumn`, then `fillInstruments`, exactly `MonthGenerator.tsx:3267-3291`'s statements
  with `baseCells` renamed to the `cells` input. `applySpecialFill` becomes
  `const { cells: next, unfilled: filled } = runLocalFills({ … }); setCells(next); setUnfilled(…);
  setDrafts(…)` with its merge (`:3299-3302`) and `specialColumnIds` unchanged.
- **Verification:**
  - the move-diff review; `MonthCalendar.test.tsx`, every `MonthGenerator.*.test.tsx`,
    `PlannerGrid.test.tsx`, `plannerGridPickPlace.test.tsx`, `plannerGridDrag.test.tsx`,
    `moveOccupant.test.ts`, `localFill.wiring.test.tsx`, `instrumentFill.wiring.test.tsx` pass
    **unchanged**;
  - `clientBoundary.test.ts` stays clean (none of the four new modules has a directive or imports a
    client module);
  - **TZ pin** (`app/components/admin/__tests__/plannerNeutralTz.test.ts`, new): `getDates`,
    `savedWindowFor`, `monthDays`, `dayOfWeek`, `longDate`, `refuseSpecialOn`'s text and
    `buildUnavailabilityNotices` produce identical output with `process.env.TZ` set to `"UTC"` (the
    Vercel runtime) and to `"America/Mexico_City"` (the suite's pin, `vitest.config.ts`), for
    November 2026, February 2027 and a month starting on a Sunday;
  - direct unit tests of `runLocalFills` over one fixture equal what `applySpecialFill` sets
    (asserted through the existing wiring tests' observable cells).
- **State after:** deployable; `/admin` identical.

### 4. Server extractions and the two read builders

- **4a — `runSolve`.** Before the move, a new `app/api/__tests__/solveRoute.test.ts` pins today's
  route (auth 403s, invalid JSON 400, missing `sunday_leads` 400, remote non-ok non-422 →
  `{ ok: false, error: "Solver service returned HTTP <n>" }` 422, remote 422 body passed through,
  200 on `ok: true`, the local path chosen when `OWT_SOLVER_URL` is unset, a mocked `fetch` whose
  init carries no `signal`). Then:
  - `app/utils/solverTypes.ts` (new, neutral): `SolveRequest`, `SolveResponse` verbatim from
    `solve/route.ts:10-83`; the three importers (`plannerModel.ts:34`, `MonthGenerator.tsx:8`,
    `plannerModel.test.ts:10`) repoint their `import type`.
  - `app/utils/solverCall.ts` (new, `server-only`): `callRemoteSolver` and `callLocalSolver`
    verbatim (`:87-149`), plus `runSolve(request, opts: { signal?: AbortSignal } = {})` = the
    selector (`:174-177`). The ONE edit: `callRemoteSolver` spreads `...(opts.signal ? { signal:
    opts.signal } : {})` into its `fetch` init, so without a signal the init is byte-identical. The
    local path ignores the signal (it keeps its own 120 s kill, dev only).
  - The route keeps auth, parse and the `sunday_leads` check (`:153-172`), then
    `const result = await runSolve(body); return NextResponse.json(result, { status: result.ok ? 200 : 422 });`.
    `solveRoute.test.ts` passes unchanged after the move.
  - `app/utils/__tests__/solverCall.test.ts`: the signal reaches `fetch`; an aborted signal rejects
    (the caller's failure exit, step 8); with a signal and no `OWT_SOLVER_URL`, `runSolve` still
    resolves through the local path (a mocked `spawn`), so the dev-only branch never surprises.
- **4b — the solver-config loader.** `app/utils/solverConfigRead.ts` (new, `server-only`):
  `loadStoredSolverConfig()` = `loadStored` verbatim (`solver-config/route.ts:71-77`) and
  `solverConfigGetBody(doc)` = the GET's mapping verbatim (`:96-102`). The route's GET and POST call
  them. `solverConfigRoute.test.ts` passes unchanged.
- **4c — two builders in `app/utils/serviceReadQueries.ts`** (additive; P4-R5):
  - `solverPoolMembersQuery()`:
    `*[_type == "teamMembers" && ${WORSHIP_MEMBER_GROQ_FILTER}] | order(member_name asc) { _id, member_name, alias, memberType, instruments, unavailableDates, disabled, ministries }`,
    params `{ all: true }` — the members route's filter and order, bound as a super-admin's request
    binds them (the RankMember fields, plus `disabled` for apply's warnings and `ministries` for the
    I5 reporting filter, F17; the route projects both too, `members/route.ts:25-26`). Nothing that
    builds the request or ranks a candidate reads `ministries`, so the request is unchanged.
  - `plannerRolesInRangeQuery(fromDay, toDayExclusive)`:
    `*[_type in $roleTypes && coalesce(week, date) >= $from && coalesce(week, date) < $to] | order(coalesce(week, date) asc, time asc) { _id, _type, service_name, time, format, "published": coalesce(published, true), "date": coalesce(week, date), "leads": …, "bgvs": …, "chorus": …, "instruments": …, "foh": … }`
    whose five seat lines are **byte-identical** to `roles/route.ts:70-74`; `songs` and `_rev` are
    not projected (no consumer). No `published` filter, by design (F6): the fills count drafts
    (ADR-0010 Decision 3; spec `:219`).
  - **Pins** (`app/utils/__tests__/plannerReadParity.test.ts`, new):
    - text: the members route's filter expression and `order(...)` clause, extracted from
      `members/route.ts`, equal the builder's; the roles GET's five seat lines appear verbatim in the
      range builder;
    - **dataset (groq-js, F12):** one fixture dataset — a legacy member with no `ministries`, a
      kids-only member who still carries a worship Tipo and has an unavailable date in the month, a
      kids-only member with no worship Tipo, a member of both ministries, a member whose `ministries`
      holds only an unknown value (`["alabanza"]`) and one whose `ministries` is a bare string
      (`"kids"`) — shapes only a raw write can store (D21) — a disabled member, two members whose
      `member_name`s differ only in accents, a seat referencing a deleted member, a weekend role with
      only `week`, a special with a datetime `date`, a draft-state role (`published: false`) and a
      `drafts.*` document (excluded, as the published perspective excludes it). The REAL
      `GET /api/admin/members` (session super-admin) and the pool builder return the same rows in the
      same order, projected on the builder's fields; the REAL `GET /api/admin/roles` and the range
      builder over `[from, to)` return the same rows in the same order, minus `songs`/`_rev`. The
      `operationalClient` mock evaluates GROQ over the dataset without `drafts.*`, as
      `adminMemberVisibility.test.ts:27-40` does;
    - **the I5 reader against the GROQ one — agreement, and the one declared divergence:** over the
      same dataset, the ids `worshipAudience(pool)` keeps (step 6b) equal the ids
      `*[_type == "teamMembers" && ${WORSHIP_AUDIENCE_GROQ_FILTER}]` returns for absent `ministries`,
      `[]`, `["worship"]`, `["worship","kids"]` and `["kids"]`, each on the side the storage contract
      puts it; and for the two junk shapes (`["alabanza"]`, `"kids"`) the test asserts the
      **divergence** exactly — `worshipAudience` keeps both (`normalizeMinistries` drops unknown
      entries and reads what is left as worship, `app/ministries.ts:41-44`), the GROQ filter drops both
      (`"worship" in […]` is false and `count` is not 0) — so the declared difference (D21) is pinned,
      and a change to either reader that closes or widens it fails the suite.
  - `draftGatingCoverage.test.ts` and the existing `serviceReadQueries` tests are unchanged and green.
- **State after:** deployable; `/admin` identical.

### 5. Extract the create writer: `roleCreateCommit` (critical; ADR-0043's pattern)

- **Change:**
  - `app/utils/roleCreateCommit.ts` (new, `import "server-only"`) exports
    `createRole(body: unknown): Promise<CommitOutcome<RoleCreateEffects, 200 | 201>>`. Its body is
    `roles/route.ts:118-368` plus `resolveExistingReceipt` (`:376-401`), verbatim, with ADR-0043's
    boundary edits only:
    - each `return reject(x)` becomes `return { ok: false, ...x }`;
    - the success `NextResponse.json({ ...doc, creationRequestId }, { status: 201 })` becomes
      `{ ok: true, status: 201, body: { ...doc, creationRequestId: request.requestId }, effects }`;
    - the replay `NextResponse.json({ …, replay: true, … }, { status: 200 })` becomes
      `{ ok: true, status: 200, body, effects: { replay: true, roleId } }`;
    - `effects` for a create holds values already in scope: `{ replay: false, roleId, roleType,
      date, serviceName, published, receiptId, notices: { assignments, roleNotices } }`, where the
      two descriptors are the return values of `notifyRoleAssignments(...)` and
      `queueRoleNotices(...)` (P3 step 2) captured at their existing call sites (`:346-366`), same
      position, same arguments. For a draft both are empty or `null` (F8).
    A commit error that is not a Sanity conflict still throws, as the route's 500 did (ADR-0043).
  - `app/utils/commitOutcome.ts`: `CommitOutcome<E, S extends number = 200>`, success arm
    `status: S` (F9). The four existing modules keep the default.
  - The route: `postHandler` keeps `:102-116` (auth and JSON parse) and ends
    `const outcome = await createRole(body); return NextResponse.json(outcome.body, { status: outcome.status });`.
    `POST = withVerificationRunContext(postHandler)`, `maxDuration = 60` and `GET` stay.
  - **Registry, same commit:** replace `app/api/admin/roles/route.ts#POST` in
    `PROTECTED_RUNTIME_WRITERS` with `app/utils/roleCreateCommit.ts#module`, the reason re-pointed
    ("… The domain body of `POST /api/admin/roles`, moved here so the MCP `apply_schedule` tool calls
    the same writer; the route keeps only authorization, and `serviceCommitCallers.test.ts` pins who
    may import this module"); update the exact sorted list in `protectedReadAudit.test.ts`. The module
    stays detectable: `writeClient.transaction()` in a region naming `"sunday_role"`,
    `"saturday_role"`, `"special_role"` (`:126`). The route's GET still reads through
    `operationalClient` (a canonical read, no entry).
  - **Delivery coverage, same commit:** `"roleCreateCommit"` joins `DELIVERY_CAPABLE_IMPORTS`; the
    route no longer imports `serviceMutationSideEffects` itself (P3 F5).
  - **Caller pin, same commit:** `roleCreateCommit: ["app/api/admin/roles/route.ts"]` (the tool joins
    in step 10).
  - **ADR-0043 amendment** (dated): the fifth `*Commit` module; its `201`/`200` outcome and the type
    parameter; the create route is the counterpart of a tool that creates, so the tool's "observation"
    is its proposal, not a revision (I7).
- **Verification:**
  - `app/api/__tests__/roleWriteRoutes.test.ts` and every other suite that drives
    `POST /api/admin/roles` pass **with zero diff** (their `vi.mock`s act on module identity);
  - the audit, the caller pin and the delivery coverage tests pass; the move-diff review shows only
    the listed edits;
  - `app/utils/__tests__/roleCreateCommit.test.ts` (new): a published create's descriptors equal what
    was scheduled; a draft create's are empty/`null` and no upsert is made; a replay's effects carry
    `replay: true` and no descriptor; statuses `201`/`200` and every refusal's `{ status, body }` equal
    the route's.
- **State after:** deployable; `/admin` identical; five domain writers, the create with one caller.

### 6. The month-proposal model and its server reads

- **Purpose:** one pure model that states, in functions the browser already runs, what the three
  tools do; one server module that makes the reads. It lives outside `app/mcp/` (F11).
- **6a — `app/utils/monthPlanReads.ts`** (new, `server-only`; `operationalClient` imported here,
  so every read is visible to the audit):
  - `loadMonthPlanReads({ year, month })` runs four reads in parallel, each isolated (a failed one is
    `{ ok: false }`, logged with a fixed tag, never thrown, never empty):
    - `pool`: `solverPoolMembersQuery()`;
    - `rules`: `solverConfigGetBody(await loadStoredSolverConfig())`;
    - `roles`: `plannerRolesInRangeQuery(from, to)` with `from` = the month's first Sunday minus
      **57** days (one day of margin for a datetime `date`, F6) and `to` = the first day of the next
      month — a superset of both the 56-day window and the month;
    - `history`: `loadSolverHistory({ year, month })`, no evidence, **capped at
      `DERIVED_HISTORY_AUTO_TIMEOUT_MS` (20 s, extracted in step 3b)** as the browser caps its own
      read (`MonthGenerator.tsx:351`, `handleAutoDerived` `:3441-3452`). `loadSolverHistory` takes
      no signal, so the cap is a race against a timer: past 20 s the read is `{ ok: false }` —
      the same failure the browser's abort produces, so M12 refuses the solve and the fills still
      run (a partial proposal) — and its late result is ignored (its GROQ reads finish on their
      own and write nothing). The browser's clock also covers its network hop to
      `/api/admin/solver-history`; the connector's covers server time only, so it is marginally
      more patient, never less (declared in M12).
  - The P1 snapshot is NOT loaded here: the tools load it (`loadServiceSnapshot()`, `app/mcp/reads`)
    and pass its `readiness` to the model, so `app/utils` never imports `app/mcp`.
- **6b — `app/components/admin/monthProposalModel.ts`** (new, neutral, pure). Every function below
  composes existing exports; none restates a predicate.
  - **Kinds.** `ProposalKind = "sunday" | "saturday" | "special"`; `kindOfColumnType`/
    `columnTypeOfKind` by index over `ROLE_TYPES`/`SETLIST_SERVICE_KINDS`, as `serviceKindOf` does
    (`servicePresenter.ts:73-76`). The only place a create body's `_type` is chosen is here.
  - **`planSelection({ year, month, excludeSundays, excludeSaturdays, specials, monthRoles })`**
    (M3–M9): the spine `getDates(y, m, 0)` and the Saturdays `getDates(y, m, 6)`; exclusions must be
    members of those, unrepeated (M4); `selectedSundays` and `activeSatDates` as the calendar leaves
    them; then each requested special, **in input order**: a date of the month (M5); a name for
    which `normalizeLabel(name) !== null` (M6; otherwise the composer's own «Escribe un nombre para
    el servicio especial.», `MonthCalendar.tsx:274`); `refuseSpecialOn({ date, weekendSelected,
    specials: acceptedSoFar, existingRoles: monthRoles })` (M7), with `weekendSelected` true exactly
    when the date is a selected Sunday or an active Saturday. An accepted special keeps
    `name.trim()`, as `submitSpecial` stores it (`:272-289`). `columns = buildColumns({ sundayDates:
    selectedSundays, activeSatDates, specials: accepted })` and the M9 count assertion; zero columns
    refuses (M3); `rows = buildRows()`.
  - **`planAutoOutcome({ config, members, columns, rows, sundayDatesFull, activeSatDates,
    selectedSundays, savedWindow, step })`**, where `step` is `{ kind: "not_called", reason }`,
    `{ kind: "failed", error }`, `{ kind: "threw", aborted: boolean }` or `{ kind: "ok", response }`
    — Auto's four exits over a fresh preview (`cells = []`, `unfilled = []`):
    - not `ok`: `runLocalFills({ …, cells: [] })`; `unfilled` = the fills' own entries (the merge's
      `prev` is empty after a preview, `MonthGenerator.tsx:2712-2718`);
    - `ok` (`response.ok && response.schedule`, the browser's own test, `:3374`):
      `applySolveResponse({ response, previousCells: [], columns, rows, sundayDates:
      sundayDatesFull, activeSatDates, members })`, then `runLocalFills` over `applied.cells`;
      `unfilled = [...mapUnfilledSeats(response.unfilled_seats ?? [], sundayDatesFull,
      activeSatDates, selectedSundays), ...filled]`; `unresolvedSolverNames =
      applied.unresolvedNames`.
  - **`unfilledReport(unfilled, cells, columns)`** — what every tool reports and the record stores
    as `unfilled[] { date, row, count }`: `renderableUnfilled(unfilled, cells)` (`instrumentFill.ts:218`,
    the gate the grid applies before counting, `PlannerGrid.tsx:679`), grouped per (the column's
    `date`, `rowId`) with its count; `unfilledTotal` is the sum, which is the browser's
    `visibleUnfilled.length`. Applied after Auto and after every revise, so no report counts an
    instrument entry whose cell has an occupant.
  - **`worshipAudience(members)`** (I5, F17): `members.filter(m =>
    normalizeMinistries(m.ministries).includes("worship"))` — the TypeScript side of
    `WORSHIP_AUDIENCE_GROQ_FILTER` through the repo's one reader (`app/ministries.ts:41-44`; the form
    `MembersPanel.tsx:138` uses). Used ONLY to filter a reported member list that is tied to no seat
    (today: the unavailability notices); never passed to the request, the ranking, the fills or the
    apply warnings. **Its semantics are the TypeScript reader's, not the GROQ filter's, where the two
    disagree** — a `ministries` holding only unknown values, or not an array, reads as worship here
    and is excluded by `WORSHIP_AUDIENCE_GROQ_FILTER` (D21; pinned by step 4c's divergence case).
  - **`createBodyFor(draft)`** (D23): `JSON.parse(JSON.stringify(draftCreateBody(draft, false)))` —
    the value `req.json()` hands the route for the browser's POST of the same draft (an
    `undefined`-valued key dropped, plain objects only). The only way the connector builds a create
    body; the parity test (step 8) and `apply_schedule` (step 10) both call it.
  - **`targetPreflights({ columns, readiness })`**: `buildIntegrityQueue({ sources, cards: [],
    roles, setlists, proposals })` over the snapshot's sources and three summaries, then
    `monthTargetPreflight({ sources, summaries, queue, type, date })` per column — the arguments
    `ServicesPanel` passes (`ServicesPanel.tsx:859-863`), built from the snapshot instead of the three
    `service-integrity` routes (F5). **Why `cards: []` is safe, and what it changes.** `cards` is not
    inert: `buildIntegrityQueue` indexes the validated cards (`serviceIntegrityQueue.ts:401`), gives
    an entry a `cardId` only when its keys name exactly one card (`:323`, `:442`), and splits the
    entries — card-owned ones into `byCard`, the rest into the global `entries` (`:663-669`).
    `monthTargetPreflight` reads **only** `queue.entries`, filtered by each entry's `targetKey`
    (`serviceCardModel.ts:1302-1309`), a key the queue copies from the summaries, never from a card.
    The browser passes `serviceCardRefs(roles, summaries)` (`ServicesPanel.tsx:815-825`,
    `serviceCardModel.ts:532-546`), which moves card-owned entries OUT of the half the preflight
    reads; `cards: []` owns nothing, so the connector's `entries` are a **superset** of the browser's.
    The extra ones cannot change a state:
    1. a card's keys are its own role's id, type and date (`cardRoleTargetKey`/`cardSetlistTargetKey`,
       `:483-484`), and the entries that carry a `targetKey` are keyed by the target the summary
       groups that role under (the role, lock and setlist entries; proposal and record-issue entries
       carry none and never match a month target), so an entry the browser attaches to a card and
       that names a month target exists only where a validated role holds that target;
    2. at such a target the role decides the state first — `single` ⇒ `exists` before any issue is
       read (`serviceReadiness.ts:933-935`); `duplicate`, `draft_conflict` or `invalid` ⇒ `blocked`
       by its own `role_*` reason (`:940`, `:968-969`) — and `cellsToDrafts` marks the target
       `isExisting` on both sides (the same roles), so `targetStateOf` reads it `exists` (at solve)
       and `occupied` (at apply) before the preflight's state is consulted — the apply outcome
       table's rows X1–X4 decide it, never X5–X7;
    3. a target no validated card names could not be card-owned in the browser either, so both see
       the same entries for it; and a special's preflight reads no queue at all
       (`serviceCardModel.ts:1239-1262`).

    So every target's **state** is the browser's; the only visible difference is that a target its
    own role already blocks may list extra `issue_*` reasons (`:963-966`) — declared in M16, never
    looser than the browser (fail-closed direction). The mirror alternative, rebuilding
    `serviceCardRefs` over the range roles, was not taken: it would only ever remove entries the
    connector reads, to change reasons on targets that are never posted.
  - **`planReports(…)`** (P4-R13): `unaddressableDates(sundayDatesFull, activeSatDates)`;
    `buildUnavailabilityNotices(selectedSundays, activeSatDates, acceptedSpecials,
    worshipAudience(members))` — the extracted function verbatim, over the worship audience only
    (M17, narrowed by I5); `unresolvedRuleNames(config, members)` (`ruleEnforcement.ts:225`, over
    the WHOLE pool, as the browser: a rule naming a kids-only member who is in the pool resolves, so
    filtering here would report a false miss); per column
    `ruleViolationsForColumn({ column, rows, assigned: assignedForColumn(cells, rows, id), members,
    sundayDates: ruleContextForTarget(column.type, column.date)?.sundayDates ?? [], config })` (the
    grid's own call, `PlannerGrid.tsx:742-750`, with no overrides: the automation records none) and
    `categoryDuplicatesForColumn(cells, rows, id)`; `historyMonthsLabel(history.months)`.
  - **`judgePlacement({ cells, columns, rows, members, config, savedWindow, columnId, rowId,
    memberId })`** (R1–R3, R5, R7–R9): `rankCandidates` with exactly `rankFor`'s arguments
    (`PlannerGrid.tsx:756-787`: `windowRoles: [...savedWindow, ...cellsToParticipantRoles(cells,
    columns, members)]`, `assigned: assignedForColumn(…)`, `column`, `sundayDates:
    ruleContextForTarget(…)?.sundayDates ?? []`, `config`). Refusals, in this order:
    `row_not_on_column` (`rowAppliesTo`), `already_in_cell`, `member_not_eligible` (absent from the
    ranking, for ANY reason — no such document, a kids-only member, a missing Tipo — one code and one
    sentence, R1), `cell_limit` (the cell already holds `PROPOSAL_LIMITS.membersPerCell`, R14),
    `same_category_double` (`blockedReason`), `hard_rule` (`ruleBlockedReason`, verbatim). Warnings:
    «No disp.» (`!available`), «Sin declarar» (`undeclared`), «Ya asignado» (`alreadyAssigned`),
    «Por encima del objetivo» (`hasTarget` and the cell over `row.target`). [Post-approval change 11:
    was «+N sobre el objetivo», which named the «+N» pill ADR-0045 retired on `e8660b26`; the
    connector's warning now uses the grid's own wording, as the other three warnings do.]
  - **`applyEdits(…)`**: edits in order, each against the state the previous ones left; `place` →
    `judgePlacement`, then `withUpdatedCell(cells, rowId, columnId, [...current, memberId])`;
    `clear` → the member must be in that cell (R6), then `withUpdatedCell(…, current without them)`;
    `exchange` (P4-R9) → remove both people first (two `withUpdatedCell`), then place `a`'s member
    into `b`'s cell judged against that state, then `b`'s member into `a`'s cell judged against the
    state **including the first placement**. Sequential, not independent: a pair rule
    (`X !with Y on *.LeadBGV`) that the second placement would complete is only visible to a judge
    that sees the first (D11). An exchange within one cell, or of a member with themself, is refused.
    Any refusal refuses the whole call and names the edit's index.
  - **`unfilledAfterEdits({ previous, editedCells, cells, columns, rows, members, sundayDatesFull })`**
    (P4-R9, declared new behaviour, D10): every entry of an edited cell is dropped and recomputed by
    the seat rule of the builder that owns that row; untouched cells keep their entries:
    - a weekend column with a solver week (`weekForColumn(column, sundayDatesFull) !== null`) and an
      `isSolvable` row: `max(0, row.target − occupants)` entries — the solver's own seat count
      (`build_slots` defaults equal `row.target`, Evidence);
    - a special column, a row in `AUTO_FILL_ROW_IDS` with `hasTarget`: `max(0, row.target −
      occupants)` — `fillColumn`'s rule (`localFill.ts:240-302`);
    - a weekend column, an instrument row `fillInstruments` would take (`isInstrumentRowId`,
      `isKnownInstrument`, `instrumentSeatDef(label).id === row.id`, `rowAppliesTo`, ≥ 1 declarer by
      `rankCandidates(…).filter(c => !c.undeclared)`, `instrumentFill.ts:142-163`): 1 if empty;
    - anything else (FOH, a special's Coro, an unaddressable Saturday's voices): 0 — no builder ever
      reports it.
    The result goes through `unfilledReport` before it is stored or returned.
  - **`targetStateOf({ draft, preflight })`** — ONE classifier of a target, used at solve and at
    apply: `draft.isExisting || preflight.state === "exists"` ⇒ `exists`; `preflight.state ===
    "creatable"` ⇒ `creatable`; anything else ⇒ `blocked` (`unknown` and `checking` fold in here;
    `deriveTargetPreflight` returns them only for an unready source or an unobserved summary,
    `serviceReadiness.ts:917-931`, which M1 and A1 refuse first, so they are unreachable and the fold
    only keeps the classifier total). `solve_month` reports it per service as `willCreate` and stores
    it as the service's **`atSolve`** (step 7) — what the proposal told Frank about that target.
    A special's is always `creatable`: M7's fourth rule refused any special on a date that already
    holds a stored special (`MonthCalendar.tsx:161-167`, name-blind), and a special's preflight is
    source-gated only (`serviceCardModel.ts:1239-1262`).
  - **`planApply({ services, drafts, preflights, monthRoles })` and the apply outcome table.** The
    order is weekend services by date, then specials by date (P4-R10). `monthRoles` is the FRESH
    read of the call (apply's step 3; `plannerRolesInRangeQuery` projects `_id` and has no
    `published` filter, so a draft counts, F6). Apply is classified in two tables, both ONE constant
    in this module (`APPLY_ACTIONS`, `APPLY_OUTCOMES`), which `planApply`, `classifyCreate`, the tool
    and the tests all read. **Table X decides what apply does** from the record's apply state and
    the target as the fresh read sees it — the post set, which never reads `atSolve`. **Table O
    decides what apply reports** from what happened (the *finding*) and what the solve said
    (`atSolve`) — the label and its weight. No report is ever derived from apply-time state alone.

    The inputs. **Apply state** (the record's `services[].apply`): `created` (with its `roleId`),
    `unknown`, or **pending** — no `apply`, or `refused` (a refused create writes no receipt, so it
    behaves as never posted; step 9.8). **Apply-time target**, first match:
    `occupied` (`targetStateOf` says `exists`); `other_special` (a special, and `monthRoles` holds a
    special on its date whose `normalizeServiceName` differs — A7; a same-name special is the same
    target and is `occupied`); `free` (`creatable`); `blocked` (anything else). Occupancy is read
    first so that a service whose own create may have landed is settled by its receipt (X3), never
    refused for a later neighbour.

    **Table X — the action** (first match; X1–X7 at planning, X1b among them, X8–X14 classify a
    post, X10b among them). A `created` service's recorded `roleId` is looked up in `monthRoles` by
    `_id`, and its **identity** there is compared with the service's: the role's `date` (the
    projection's `coalesce(week, date)`, first ten characters, per the date invariant) must equal the
    service's `date`, and for a special `normalizeServiceName(role.service_name)` must equal
    `normalizeServiceName(service.name)` — ADR-0011's identity, the same pair `cellsToDrafts`' collision
    key compares (`collisionKey`, `plannerModel.ts:1057-1061`; `normalizeServiceName`,
    `app/utils/normalizeLabel.ts:43`). `/admin`'s PATCH can change both: it moves a role to another
    date (`isMove`, `app/api/admin/roles/[id]/route.ts:175-176`) and renames a special (`:180`). The
    range read spans the month and the 56-day window before it (step 6a), so a role moved or renamed
    inside that range is still found; only one moved out of it reads as absent.

    **The same identity check runs on a replay** (`sameServiceIdentity(role, service)`, one helper
    for X1/X1b and X10/X10b). A `200` replay is the receipt's word that this service's create landed —
    not that its role still sits where the service proposed it: `decideReceipt`
    (`app/utils/roleWriteRequest.ts:706-743`) checks only that the receipt's role still exists with
    its type (`:735-741`), and the route answers with that role as it is now
    (`roles/route.ts:386-389`, `{ ...role, replay: true, creationRequestId }`, the role read with
    `ROLE_PROJECTION`, `serviceReadQueries.ts:17-26`, which carries `week`, `date` and
    `service_name`). So a service the record left `unknown` whose create landed and was then moved
    (its date is now `free`, X6) or moved out of the month is re-posted, replayed, and compared by
    `classifyCreate(service, outcome)` on the replay's body: `coalesce(week, date)`, first ten
    characters, against the service's date, and for a special the normalized `service_name` against
    its name. At the service's identity it is X10; anywhere else, X10b.

    | # | Apply state | Apply-time target | Action | Finding |
    |---|---|---|---|---|
    | X1 | `created`, `roleId` among the fresh roles **at the service's identity** | not read | skip | `ours_present` |
    | X1b | `created`, `roleId` among the fresh roles at **another** identity (its date moved, or a special renamed, in `/admin`, inside the read's range) | not read | skip — never re-posted: this proposal's role exists, elsewhere | `ours_moved` |
    | X2 | `created`, `roleId` absent (a hard delete in `/admin`, F13, or a date edit out of the read's range) | not read | skip | `ours_deleted` |
    | X3 | `unknown` | `occupied` | **post — the receipt decides** (D12) | X8–X14 |
    | X4 | pending | `occupied` | skip — nothing of this proposal's landed on this target (never posted, or posted and refused), so the occupant is another's | `taken` |
    | X5 | pending or `unknown` | `other_special` | refuse, with `refuseSpecialOn`'s fourth-rule text (A7) | `other_special` |
    | X6 | pending or `unknown` | `free` | post | X8–X14 |
    | X7 | pending or `unknown` | `blocked` | refuse, with the fresh preflight's reasons (A5) | `blocked` |
    | X8 | a post, when 130 s have passed (D7) or its write-ahead failed (D20) | — | not posted | `not_attempted` |
    | X9 | a post answered `201` | — | record `created`, `roleId` = the body's `_id` | `created_now` |
    | X10 | a post answered `200` (replay), the replayed role **at the service's identity** | — | record `created`, `roleId` | `ours_confirmed` |
    | X10b | a post answered `200` (replay), the replayed role at **another** identity (the service's create landed while the record said `unknown`, and the role was then moved in `/admin` — renamed too, possibly; a special renamed on its own date never gets here, X5 refuses it before any post) | — | record `created`, `roleId` — so the next apply meets X1b (or X2, if it now sits outside the read's range) with zero posts | `ours_moved` |
    | X11 | a post answered `ambiguous_target` with `details.roleIds` (the route's OCCUPIED answer, either arm, `roles/route.ts:160-166`, `:310-316`) | — | record `refused` | `taken` |
    | X12 | a post answered `idempotency_key_retired` | — | record `created` with the receipt's `details.roleId` (F13) | `ours_deleted` |
    | X13 | a post answered any other refusal | — | record `refused` with its code | `refused` |
    | X14 | a post that threw | — | the record keeps the write-ahead `unknown` | `unknown` |

    **Table O — the report** (label · weight; weight is *success*, *neutral* or *failure*):

    | # | Finding | `atSolve` = `creatable` | `atSolve` = `exists` | `atSolve` = `blocked` |
    |---|---|---|---|---|
    | O1 | `created_now` | «creado» · success | «creado (al proponer la fecha tenía otro servicio, que ya no está)» · success | «creado (al proponer estaba bloqueado)» · success |
    | O2 | `ours_confirmed` | «creado (confirmado por su recibo)» · success | same | same |
    | O3 | `ours_present` | «ya creado (revisión N)» · success | same | same |
    | O4 | `ours_deleted` | «creado y luego eliminado» · failure | same | same |
    | O5 | `taken` | «no creado: la fecha se ocupó después de la propuesta de mes» · **failure** | «ya existía» · neutral | «ya existe (al proponer estaba bloqueado)» · neutral |
    | O6 | `other_special` | «no creado: la fecha ya tiene un servicio especial con otro nombre» · failure | unreachable (a special) | unreachable (a special) |
    | O7 | `blocked` | «no creado: la fecha se bloqueó después de la propuesta de mes» · failure | «no creado: el servicio que existía ya no está y la fecha está bloqueada» · failure | «no creado: sigue bloqueado» · failure |
    | O8 | `refused` | «rechazado» · failure | same | same |
    | O9 | `unknown` | «desconocido» · failure | same | same |
    | O10 | `not_attempted` | «no intentado» · failure | same | same |
    | O11 | `ours_moved` | «creado y luego modificado en /admin» · failure | same | same |

    O11's reason names where the role is now («ahora está el <fecha>», and for a renamed special its
    current name — from the fresh read for X1b, from the replay's body for X10b) and says this
    propuesta de mes will not re-create the service. It is a *failure*, not a success: the service
    this proposal created is no longer the one it proposed (another date, or another name), and the
    date it proposed may now be empty. X10b's reason adds that the create was confirmed by its
    receipt («se confirmó por su recibo»), so Frank knows it landed from this propuesta de mes.

    O6 blames no one, because it has two causes apply cannot tell apart before posting (A7): another
    special stored on the date since the solve, or — only when the record said `unknown` — this
    proposal's own special, whose create landed and which was renamed in `/admin`. Refusing is the
    fail-safe for both (a post in the first case would create a second special on the date). Its
    reason is `refuseSpecialOn`'s fourth-rule text, which names the special found («ya tiene un
    servicio especial guardado: «<nombre>»», `MonthCalendar.tsx:161-167`); when the record said
    `unknown` it adds «Si un intento anterior de esta propuesta de mes quedó sin confirmar, puede ser
    este mismo servicio, renombrado en /admin: revísalo allí antes de volver a aplicar.» The label is
    the cell's; only the reason reads the apply state, and it decides nothing.

    Reachability: a special's `atSolve` is always `creatable`, so the `exists`/`blocked` columns are
    weekend-only and O6 has one reachable cell; every other cell is reachable. O1–O3's
    `exists`/`blocked` cells are reached when a target the proposal did not offer to create is
    `free` at apply and is posted (X6). **That post is a stated decision, not a leak:** the
    proposal holds solved seats for every selected column, whatever its `willCreate`, and refusing
    it would force a re-solve — a new random seed, so a different month — to create the very seats
    Frank was shown. **Browser parity holds for the `blocked` half only** (post-approval change 2):
    a target shown `blocked` is one whose preflight refused it, and the browser posts it once its
    preflight snapshot has been refreshed (`preflights` recomputes whenever `drafts` or the
    `preflight` function change, `MonthGenerator.tsx:2519-2536`, and `isDraftCreatable` reads it).
    A target shown `exists` is not: `cellsToDrafts`' `skipped`/`isExisting` read the
    `existingRoles` prop, which does not refresh while the dialog is open — only the preflight half
    does — so within one session the browser never posts a formerly-`exists` target. For `exists`
    the post is therefore the connector's own **declared difference**, kept for the re-solve reason
    above. The cell's label says what the
    proposal had shown («creado (al proponer estaba bloqueado)», …), so the difference is never
    silent, and the post set stays exactly `isDraftCreatable`'s (below).

    **Whole-month success, derived from the weight column:** the apply reports the month complete
    (`complete: true`) exactly when no service falls in a *failure* cell. *Success* is a service in
    place as this proposal made it; *neutral* is a date the proposal never offered to create that
    holds a service now (O5's `exists`/`blocked` cells); everything else is *failure* — in
    particular a target that was `creatable` at solve and is occupied by someone else at apply
    (O5's first cell, whether the fresh read saw it, X4, or the route's race did, X11), a service
    created and later deleted (O4), and one created and later moved or renamed in `/admin` (O11).
    `applyComplete(services)` is that one predicate; no label list restates it.

    **Why X decides and O only reports.** X1, X1b, X2, X4 and X7 are `isDraftCreatable`'s three
    refusals and X6 its one yes (`MonthGenerator.tsx:457-459`), with the record in place of the
    session's `createdTargets` (X1, X1b and X2 are all its `createdTargets` refusal); X3 is
    the connector's own retry path (D12), X5 is A7's stricter re-check, and the X1/X1b/X2 and
    X10/X10b splits and every O label are reports the browser has no counterpart for (`isDraftCreatable` never re-checks a
    created target, and its batch aborts where the connector reports per service, A6). A unit test
    runs `isDraftCreatable` itself (tests may import it) over the same drafts and fresh preflights,
    `createdTargets` being the targets whose record says `created`, and asserts it agrees on post /
    no-post on every X1–X7 cell except the two declared ones — X3 (the connector posts; the route's
    receipt refuses anything that is not ours) and X5 (the connector refuses; the browser's confirm
    does not re-run the composer, A7). `idempotency_key_retired` is therefore reachable from
    `apply_schedule` **only** through X3 or X6 on a service whose record lost its `created` state
    (the key had been retired by a delete); X12 then records `created` again, so the next apply
    meets X2 instead and never posts that key a second time.
- **Verification** (`monthProposalModel.test.ts`, `monthPlanReads.test.ts`, fictitious names):
  every M-row refusal of `planSelection`; the four exits of `planAutoOutcome`; the reports, with
  `worshipAudience` dropping a kids-only member's notices and keeping a legacy (no `ministries`) and
  a two-ministry member's; `unfilledReport` dropping an instrument entry whose cell is occupied and
  keeping a voice entry of a partly seated cell; `createBodyFor` has no `undefined`-valued key and
  `toStrictEqual`s `JSON.parse` of the browser's serialized body for the same draft;
  `judgePlacement`'s every verdict and warning, with `member_not_eligible` byte-identical for an
  unknown id, a kids-only id and a Tipo-less worship member, and `cell_limit` at the thirteenth
  member; `applyEdits` including the sequential-exchange pair
  rule (an independent judge would pass it; this one refuses); `unfilledAfterEdits`' four cases;
  `targetStateOf` over every preflight state (`unknown`/`checking` folded into `blocked`);
  **the apply outcome table, one test per reachable row and cell**: `planApply`'s order (weekends,
  then specials) and one fixture per X1–X7 row — X1 only when the recorded role sits at the
  service's own date (and, for a special, its normalized name); X1b for the same `roleId` moved to
  another date inside the read's range and, separately, for a special renamed on its own date
  (zero posts, finding `ours_moved`, O11 «creado y luego modificado en /admin», *failure*); X2 with
  zero posts, including a role moved out of the read's range; X3 posting where X4 skips on
  the same occupied target, X5 winning over `free` and losing to `occupied` — and `classifyCreate`
  per X8–X14 row (X12 recording `created` with the receipt's `roleId`; a `200` replay whose body sits
  at the service's date — and, for a special, name — is X10, and the same replay with the body at
  another date, at another name, or outside the month is X10b, `ours_moved`, recorded `created`; the
  X1/X1b and X10/X10b fixtures share `sameServiceIdentity`'s cases, so the two checks cannot
  diverge); O6's reason with and without the `unknown` sentence; then every reachable Table O
  cell's exact label and weight, iterated from `APPLY_OUTCOMES` so a cell added without a fixture
  fails; **the blocker case pinned twice**: a service `creatable` at solve whose target another
  service occupies at apply — seen by the fresh read (X4) and, separately, only by the route's race
  (X11) — reads «no creado: la fecha se ocupó después de la propuesta de mes», weight *failure*, and
  `applyComplete` is `false`, while the same occupied target with `atSolve: "exists"` reads «ya
  existía», *neutral*, and leaves `applyComplete` `true`; `applyComplete` is `false` for any single
  failure cell and `true` for a month of O1–O3 and neutral cells only; and the `isDraftCreatable`
  post / no-post agreement on every X1–X7 cell but the declared X3 and X5;
  **`targetPreflights` against the browser's queue**: over one fixture of summaries with a
  lock issue and a dangling assignment on an occupied `single` target, a `duplicate` target with an
  issue, a `draft_conflict` target, a lock issue on an empty target and a special, the state per
  target equals `monthTargetPreflight` over a queue built as `ServicesPanel` builds it
  (`cards: serviceCardRefs(roles, summaries)`), and the reasons differ only by `issue_*` tags on a
  target whose own role already blocks it (M16); `worshipAudience` keeping a member whose
  `ministries` holds only an unknown value (D21); every read failing in isolation; the whole
  model's output under `TZ=UTC` equals it under `TZ=America/Mexico_City`.
- **State after:** unused modules; nothing registered.

### 7. The proposal store (P4-R6, R7, R8)

- **Document type `mcpProposal`**, id `mcpProposal.<handle>`:
  - **The handle** (the "short id", Frank): 16 bytes from `crypto.randomBytes` → **26 characters of
    lowercase Crockford base32** (128 bits), e.g. `k7m2q9x4c1v8b3n6p0r5t2w9za`. A JWS of the same
    proposal would be 12–20 KB (evidence Q6); 26 characters are what the model copies. Validated by
    `^[0-9a-hjkmnp-tv-z]{26}$` **before any read**, as `isGrantId` guards grants. Unguessable
    (2^128), and in any case only a live super-admin's bearer reaches the tools (O2).
  - **Fields** (every array of objects carries `_key`; ids are plain strings, never `reference`s, so
    a stored proposal can never block deleting a member):
    ```
    sub, origin, month ("YYYY-MM"), createdAt, expiresAt (createdAt + 7 days), revision (0, 1, …),
    revisedAt?, rules { present, rev|null }, selections { excludeSundays[], excludeSaturdays[] },
    solverStatus ("ok"|"not_called"|"failed"|"threw"), partial,
    services[] { _key, kind, date, name?, localId, creationRequestId,
                 atSolve ("creatable"|"exists"|"blocked"),
                 cells[] { _key, row, memberIds[] }, original[] { _key, row, memberIds[] },
                 apply? { state ("created"|"refused"|"unknown"), revision,
                          roleId? (required when state is "created"), code?, at } },
    unfilled[] { _key, date, row, count }, applyLease? { nonce, until }
    ```
    **`atSolve`** is the solve-time target state (`targetStateOf`, step 6b) — exactly the service's
    `willCreate` in `solve_month`'s output. `solve_month` sets it; nothing else ever writes it:
    `revise_proposal` carries it unchanged, like `original`, and `apply_schedule` only reads it. It is
    the one input by which apply's report (Table O) knows what the proposal promised about a target,
    so a date taken since the proposal is never reported like a date that was already taken then.
  - **What it may hold** (P4-R6, "no names beyond what's needed"): member ids, dates, row ids, kinds
    and special names — exactly what the drafts it describes will hold once created — plus the
    bookkeeping that describes them and names nobody (the bound rules revision, each service's
    `atSolve` and apply outcome with its role id or refusal code, the lease). No person name,
    no solver diagnostic text, no unresolved name (those are returned once by `solve_month` and not
    stored). The dotted id keeps it off the public reader (`docs/MCP.md:692-695`), and nothing in it
    is secret or replayable without Frank's bearer token (O5's standard).
  - **No member-snapshot hash** (the brief's "member snapshot hash?"): P4-R7 rules that eligibility is
    NOT re-checked at apply beyond the create route and becomes a warning; a hash could only serve a
    refusal the ruling rejects. Warnings are computed from a fresh pool read at apply (step 10).
- **Modules** (the OAuth store's layout):
  - **Naming.** «Proposal» already names the setlist proposal in this app and in the connector
    (`setlistProposal`, `list_proposals`, `app/mcp/reads/proposalPresenter.ts`), so P4's modules live
    under their own directory, **`app/mcp/monthProposals/`**, its presenter is
    `monthProposalPresenter.ts` and its runner `runMonthProposalTool`, and every Spanish sentence P4
    returns or describes says **«propuesta de mes»**, never a bare «propuesta». The wire names the
    spec fixes (`proposalId`, `revision`) and the refusal details (`proposal_busy`,
    `proposal_superseded`, `proposal_expired`, `proposal_changed`) keep their spelling: they are
    identifiers the three tools' descriptions define, not prose.
  - `app/mcp/monthProposals/documentTypes.ts`: import-free type name, id prefix and field names,
    shared by the schema and the store.
  - `app/mcp/monthProposals/proposalDocument.ts` (neutral): `newProposalHandle`, `isProposalHandle`,
    `proposalDocId`, `buildProposalDocument`, `parseProposalDocument` (strict: kinds, a `month`
    whose year is within the planner's `MIN_YEAR`…`MAX_YEAR` (M24), dates in the month, known row
    ids, canonical-id-shaped member ids, a name on every special (M6), an `atSolve` of the three
    values on every service and `creatable` on every special (step 6b), bounded sizes from ONE
    constant, `PROPOSAL_LIMITS`, derived from the input's own bounds so a valid solve can never
    exceed them — **≤ 20 services** (at most 5 Sundays + 5 Saturdays + 10 specials, step 8's
    schema; January 2027 has five of each), each row id one of `buildRows()`'s (9 today:
    3 voices, 5 instruments, 1 FOH, `plannerModel.ts:306-329`) **at most once per service**,
    **≤ 12 members per cell** — `membersPerCell = 4 × Math.max(...buildRows().map(r => r.target ??
    0))`, four times the largest row target, derived from `buildRows()` because `VOICE_TARGETS` is
    module-private (`plannerModel.ts:304`) and exporting it would widen the planner model for one
    number; 12 today (the largest target is 3), pinned by a unit test; revise refuses a thirteenth,
    R14 — `unfilled` at most one entry per (date, row), an `apply` whose `state` is `created`
    carrying a canonical-id-shaped `roleId` (Table X's X1/X1b/X2 read it); anything else reads as
    `malformed`, never as a proposal), and the patch builders. **The revise patch builder takes the
    services AS LOADED** (the record `loadProposal` returned) plus the edited cells and the new ids,
    and returns every service with its `_key`, `kind`, `date`, `name`, `localId`, **`atSolve`**,
    `original` and **`apply`** copied from the loaded record — never from tool input, never rebuilt:
    the revise writes `services` wholesale (step 9.8), so a sub-object the builder dropped would be
    erased; R10 and Table X read `apply`, and Table O reads `atSolve`. `buildProposalDocument` and
    the revise patch builder run `parseProposalDocument` over their own output and throw (a `pre`
    failure: nothing stored) when it would not read back, so no tool can store a record it cannot
    read.
  - `app/mcp/monthProposals/proposalStore.ts` (`server-only`; the one `writeClient` importer, reads
    included, as `grantStore.ts:104-122`). Its two GROQ queries (`loadProposal`'s and the sweep's)
    name only `mcpProposal`, through `$type` (I2, § «Preserved invariants»). Every function that
    mutates a record is one row of the **write/guard table** below; there is no other.
    - `createProposal(doc)` — `create`, never `createIfNotExists`: a collision fails loudly (W1);
    - `loadProposal(handle)` → `{ ok: true, doc, rev } | { ok: false, reason: "not_found" |
      "malformed" } | { ok: false, reason: "server_error" }` (the doc includes `applyLease`);
    - `commitRevision(handle, observedRev, patch)` under `ifRevisionId(observedRev)`; a conflict is
      `{ ok: false, reason: "changed" }` (`sanityConflictKind`, as grants use it) (W3);
    - `claimApplyLease(handle, observedRev, { nonce, until })` under `ifRevisionId(observedRev)` →
      `{ ok: true, held: { nonce, until, rev } } | { ok: false, reason: "changed" | "server_error" }`,
      `rev` being the `_rev` of the document the commit returns (W4);
    - `proveApplyLease(handle, nonce)` — a fresh read → `{ ok: true, held }` when its `applyLease.nonce
      === nonce`, else `{ ok: false, reason: "lease_lost" }` (another nonce, no lease, no record) or
      `{ ok: false, reason: "server_error" }` (the read failed). It writes nothing;
    - `recordApplyOutcome(handle, held, serviceKey, apply)` — `patch(id).ifRevisionId(held.rev).set({
      services[_key==k].apply: apply })` → `{ ok: true, held: { …held, rev: <returned _rev> } } |
      { ok: false, reason: "lease_lost" | "server_error" }` (W5, W6). For a write-ahead
      (`apply.state === "unknown"`) it first refuses, writing nothing, when `Date.now() + 25 000 ≥
      held.until` (`lease_lost`: the lease could lapse before the create it licenses is recorded; 25 s
      is one create's sizing, § «The time budget»). Apply calls it at most twice per create: the
      write-ahead `unknown` before, the outcome after (D20; none after a throw, X14, which leaves
      `unknown`);
    - `releaseApplyLease(handle, held)` — `patch(id).ifRevisionId(held.rev).unset(["applyLease"])` →
      `{ released: true } | { released: false, reason: "not_ours" | "server_error" }` (W7);
    - `sweepExpiredProposals(nowIso, limit = 25)` — reads `{ _id, _rev, expiresAt }` of records with
      `expiresAt < now` and no live lease, oldest first, and deletes each in **its own guarded
      transaction**: `patch(id, p => p.ifRevisionId(rev).set({ expiresAt }))` (a revision-asserting
      no-op of the unchanged field) then `delete(id)` — `delete` takes no revision precondition, so
      this is the repo's guarded-delete shape (`app/api/admin/roles/[id]/route.ts:589-595`,
      `app/utils/outboxSweep.ts:535-539`). A record that moved since the read — an apply that claimed
      its lease in between, which the query could not see — fails its own transaction and is kept;
      the others proceed (at most 5 in flight). Best effort: a failure is logged with a fixed tag and
      never fails the caller (W2).
- **Binding checks, every tool, in this order** (A13): handle shape; found and well-formed
  (`not_found`); `origin` equals this deployment's canonical origin (`app/mcp/oauth/origin.ts`) and
  `sub` equals the principal — otherwise also `not_found`, so a proposal from the other deployment or
  principal is never confirmed to exist; `expiresAt > now` (`stale_revision`, detail
  `proposal_expired`); for revise and apply, `revision` equals the input (`stale_revision`,
  `proposal_superseded`, naming the current revision).
- **The apply lease (D9).** `apply_schedule` claims `applyLease { nonce, until: now + 210 s }` under
  `ifRevisionId(rev it read)`. A revise that read before the claim then fails its own `ifRevisionId`;
  a revise or a second apply that reads after it sees a live lease (`until > now`) and refuses
  (`proposal_busy`). The lease outlives `/api/mcp`'s 180 s ceiling, so a killed apply cannot overlap
  its successor; it expires on its own. The sweep skips a record with a live lease. **Exclusivity is
  enforced on every write, not assumed:** an earlier draft let the outcome writes and the release go
  unguarded on the premise "while the lease is held nobody else writes the record", and a killed
  apply's late `finally` could then remove its successor's live lease, let a revise commit between two
  of the successor's writes, and leave the record claiming a revision the drafts do not hold. The
  class is closed by one rule — **no write to an `mcpProposal` record is unguarded** — stated as
  this table, which lists every write the code makes (the store has no other mutating function, and
  Studio shows the type read-only, § «Studio»):

  | # | Write | Who, when | Mutation | Guard — what it proves | If the guard fails |
  |---|---|---|---|---|---|
  | W1 | `createProposal` | `solve_month`, step 8.7, after W2 | `create(mcpProposal.<handle>)` | a fresh 128-bit handle, and `create` — never `createIfNotExists`/`createOrReplace` — so it can only make a new document; it never touches an existing record | the `store` copy; nothing else is written |
  | W2 | the sweep's delete | `solve_month`, step 8.7, before W1 | per record, ONE transaction: `patch(id).ifRevisionId(rev).set({ expiresAt })` + `delete(id)` | `rev` is from the sweep's read, which saw `expiresAt < now` and no live lease; any write since (a claim, a late outcome) moves `_rev` | that transaction fails and the record is kept; the others proceed; logged, never fails the call |
  | W3 | `commitRevision` | `revise_proposal`, step 9.8 | `patch(id).ifRevisionId(rev).set({ revision, services, unfilled, revisedAt })` | `rev` is the `_rev` of **the same step-1 read** that passed the binding checks and saw no live lease, so a claim (W4), an outcome (W5/W6) or another revise landing in between moves `_rev` | `proposal_changed`; nothing stored |
  | W4 | `claimApplyLease` | `apply_schedule`, step 10.2 | `patch(id).ifRevisionId(rev).set({ applyLease: { nonce, until } })` | `rev` is the `_rev` of the step-1 read, which saw no live lease (none, or `until ≤ now` — a lapsed lease is overwritten, which is what ends a killed apply's ownership) | `proposal_changed`; nothing created |
  | W5 | the write-ahead `unknown` | the apply loop, before each post (X3, X6) | `patch(id).ifRevisionId(held.rev).set({ services[_key==k].apply: { state: "unknown", revision, at } })` | **the lease proof** (below), and the lease unexpired with a create's sizing to spare (`now + 25 s < until`) — the one write that licenses a post | `lease_lost` ⇒ that service is not posted and **the loop stops** (below); `server_error` ⇒ that service is not posted (X8, «no se pudo registrar»), and the next write first re-proves the lease |
  | W6 | the outcome (`created` X9/X10/X12, `refused` X11/X13; X14 writes nothing) | the apply loop, after each post | `patch(id).ifRevisionId(held.rev).set({ services[_key==k].apply: { state, revision, roleId?, code?, at } })` | the lease proof; expiry is not required — the revision guard alone shows nobody has written since this apply's own last write, so the outcome it records is its create's true result and overwrites nobody | `lease_lost` ⇒ the posted service keeps its TRUE finding in the report, with the note «no se registró en la propuesta de mes: se perdió el bloqueo», and **the loop stops**; `server_error` ⇒ the note «no se pudo registrar el resultado en la propuesta de mes», the record still says `unknown` (healed by the receipt on the next run, X3), and the next write first re-proves the lease |
  | W7 | `releaseApplyLease(handle, held)` | apply's `finally` — the one release, which also covers the early refusals of step 10.3 (A1) and every throw between the claim and the report (step 10.7) | `patch(id).ifRevisionId(held.rev).unset(["applyLease"])` | the lease proof; expiry is not required | a nonce mismatch, a revision conflict or a failed proof ⇒ **a no-op**: a lease that is not provably this apply's is never removed; logged with a fixed label; the note «la propuesta de mes queda bloqueada hasta 210 s y se libera sola» |

  **The lease proof** (W5–W7; one protocol). Apply holds `held = { nonce, until, rev }`, where `rev`
  is always the `_rev` of the most recent **read of the record in which `applyLease.nonce ===
  nonce` was checked**, and every apply-side write is a patch under `ifRevisionId(held.rev)`: it
  lands only if nobody has written the record since that read. The read is, in order: the document
  W4's commit returns; then the document each successful W5/W6 commit returns (a `patch(…).commit()`
  resolves to the document as committed, `_rev` included — `@sanity/client` 7.25.0,
  `node_modules/@sanity/client/dist/index.d.ts:4009-4011` — and the store re-checks the nonce on it,
  so each write's result is the next write's ownership read, at no extra round trip); and, after a
  write whose result is unknown (`server_error`: it may or may not have landed, so `held.rev` may be
  stale), a fresh `proveApplyLease` before the next write. A proof that fails — another nonce, no
  lease, no record, or a failed read — is `lease_lost`: ownership that cannot be proven is treated
  as lost (fail closed).

  **When the loop stops on `lease_lost`**: the service at hand and every later post are X8
  (`not_attempted`, reason «se perdió el bloqueo de la propuesta de mes: otra llamada la tomó»), no
  further write is attempted except W7 (a no-op by construction), and the report is built from
  values in hand: every service already posted keeps its true finding (a create that landed is
  «creado», never «desconocido»), with the note where its outcome was not recorded. `complete`
  stays Table O's one predicate — the X8 services make it `false` unless the lost write was the
  last. `next` says to call `apply_schedule` again with the current revision: the record then holds
  that service's write-ahead `unknown`, so the re-run posts it again (X3 or X6) and the route's
  receipt replays what landed (X10) — nothing is created twice. **Reachability:** in a live
  invocation `lease_lost` cannot happen — the lease outlives the 180 s ceiling; every other writer
  either refuses a live lease (W3's and W4's step-1 reads) or is excluded from it (W2); and a killed
  predecessor's late writes are themselves refused (below) — so it is the path of an invocation the
  platform already killed, whose report nobody receives; what matters there is that its writes are
  refused, which the guards guarantee.

  **Late writes are refused, not tolerated.** Fluid compute does not promise to stop a timed-out
  invocation's JavaScript, so a killed apply A's hung create can return after A's lease lapsed and
  reach W6 and then W7. Once the lease has lapsed, the record can only move by a successor's claim
  (W4), a revise's commit (W3) or the sweep (W2), and each moves `_rev`; so A's late W6 fails its
  `ifRevisionId` and writes nothing, and A's late W7 removes nothing. The sequence an earlier draft
  allowed — A killed at 180 s, its create returning after 210 s, apply B holding the lease — now
  ends with A's outcome refused, A's release a no-op, B's lease intact, and any revise refused
  `proposal_busy` until B finishes; no revise can commit between two of B's writes, because its
  step-1 read sees B's live lease or its W3 fails on the `_rev` B's claim moved. What A's lost
  outcome leaves is the write-ahead `unknown` (W5) on the service it posted: a revise can never edit
  that service (R10), and B, or the next apply, posts the same body under the same
  `creationRequestId` again (X3 when its fresh read sees the target occupied, X6 when free) and the
  route's receipt — the global create mutex — settles it: a replay if A's create landed, one create
  if it did not, never two, even while A's create is still in flight. If nobody has written since A's own last
  write, A's late write lands — and is then A's create's true outcome recorded before any other
  writer acted, exactly what A would have written in time; the next writer's guarded read sees it.
  - **The `proposal_busy` refusal tells the model to wait, not to re-solve.** Both tools that meet
    it (`revise_proposal` step 9.1, `apply_schedule` step 10.2) return the month-proposal refusal
    shape `{ isError: true, structuredContent: { refused: true, code: "stale_revision", detail:
    "proposal_busy", retryAfterSeconds, reason, next } }` (`monthProposalPresenter.ts`), where
    `retryAfterSeconds = ceil((applyLease.until − now) / 1000)` (≤ 210) and `next` reads «Hay una
    aplicación en curso sobre esta propuesta de mes. Espera unos {retryAfterSeconds} s y vuelve a
    llamar {tool} con el mismo proposalId y la misma revision; el bloqueo se libera solo. No vuelvas
    a llamar solve_month: la propuesta de mes sigue vigente, y un cálculo nuevo no la desbloquea y
    crearía una segunda propuesta de mes cuyos servicios competirían con los que esa aplicación está
    creando.» Why the last sentence matters: the lease lives on THIS record only, so a re-solve's
    apply would not see it and would race the in-flight apply on the same targets — the route's
    coordination keeps a target from being created twice, but the loser's report would read «no
    creado: la fecha se ocupó después de la propuesta de mes» (X11) for services the first apply is
    creating. The text ends «No se guardó nada.» (revise) or «No se creó nada.» (apply).
- **Expiry and sweep** (P4-R6/R7): an expired record is refused on use; `solve_month` sweeps up to 25
  expired records BEFORE writing its own. Records are only ever minted by `solve_month`, which only
  a live super-admin can call, so the sweep keeps pace with creation. A cron was the alternative:
  it would buy nothing a sweep on solve does not — the store grows only when Frank solves, and an
  expired record is refused on use whether or not it has been swept — while adding a schedule and
  a second entry point into the store (a `/api/cron/*` route outside `proxy.ts`'s matcher,
  authenticated by `CRON_SECRET`), which is otherwise written only through the three tools;
  declined (D8; post-approval change 8).
- **Studio**: `sanity/schemas/mcpProposal.ts` (hidden, read-only, names from `documentTypes.ts`,
  description «Interno: propuesta de mes del servidor MCP; caduca sola. No editar ni borrar a
  mano.»), added to `sanity/schema.ts:36`; `app/utils/studioProtection.ts` gains `mcpProposal` in
  `PROTECTED_STUDIO_TYPES`, `INTERNAL_STUDIO_TYPES`, `INTERNAL_STUDIO_FIELDS` (every field) and the
  pane title «MCP — Propuestas de mes (solo lectura)»; `sanity/structure.ts` lists it through
  `PROTECTED_STUDIO_TYPES`, unchanged.
- **Guards:**
  - `mcpSanityClients.test.ts` `ALLOWED` gains `"app/mcp/monthProposals/proposalStore.ts": { clients:
    ["writeClient"], reason: "P4's month-proposal store: the only writer of `mcpProposal.*` records,
    which are not protected service types and need the write token (dotted ids are private). It
    never reads a protected type; `protectedReadAudit` still scans it." }`.
  - **No `PROTECTED_RUNTIME_WRITERS` entry**: the store writes a non-protected type, names no
    protected type (the literal ban) and calls no protected loader, so the audit finds no site;
    `protectedReadAudit.test.ts` staying green on the new file is the proof.
- **Verification** (`proposalDocument.test.ts`, `proposalStore.test.ts`, `mcpProposalSchema.test.ts`):
  handle shape and length; build/parse round trip; every malformed shape refused (a `created`
  apply without a `roleId`, a service without `atSolve` or with a fourth value, a special whose
  `atSolve` is not `creatable`, and a `month` of 2023 or 2036 included); `_key` on every object
  item; the revise patch builder over a loaded record whose services carry `created`, `unknown` and
  `refused` apply states and all three `atSolve` values returns every `apply` and every `atSolve`
  deep-equal to the loaded one, an edited service's included, and ignores any `apply`- or
  `atSolve`-shaped field in its input; `membersPerCell` equals `4 ×` the largest `buildRows()`
  target (12); `proposal_busy`'s payload (`retryAfterSeconds` from the lease, the `next`
  text naming the calling tool, the wait instruction, and `solve_month` named only as what not to
  call); `PROPOSAL_LIMITS`: the largest valid solve (January 2027, every weekend, 10 specials,
  every cell at target) builds, stores and parses back, and a 21st service or a 13th member in a
  cell reads `malformed` and is refused by the builder before any write; each binding check;
  `commitRevision` and `claimApplyLease` conflicts; the sweep's query excludes live leases and is
  bounded, each delete carries its `ifRevisionId` patch in the same transaction, and a lease
  claimed between the sweep's read and its delete keeps the record (the other deletes proceed);
  **the write/guard table, row by row** (`proposalStore.test.ts`, a mocked `writeClient` that keeps
  a revision per record and refuses a stale `ifRevisionId` as Sanity does):
  - **no unguarded write, structurally**: across every test in the file, the mock records every
    mutation any store function sends, and an `afterAll` asserts each `patch` carried
    `ifRevisionId` and each `delete` sat in a transaction with an `ifRevisionId` patch of the same
    id; and a text scan of `proposalStore.ts` (comments stripped) finds no `.patch(` chain without
    `.ifRevisionId(`, one `.create(` (W1) and one `.delete(` (W2) — so a new unguarded write fails
    the suite even if no test calls it;
  - **(a) a late release carrying a foreign nonce leaves the live lease intact**: A claims; the clock
    passes 210 s; B claims (W4 overwrites the lapsed lease); A's `releaseApplyLease(handle,
    heldA)` — under A's stale `rev`, and again after a `proveApplyLease(handle, nonceA)` that
    reports `lease_lost` — sends no write that lands, returns `{ released: false, reason:
    "not_ours" }`, and B's `applyLease` is deep-equal before and after; a `loadProposal` then still
    shows B's live lease, so a revise would be `proposal_busy`;
  - **(b) an outcome write after the lease was lost is refused**: the same A/B sequence; A's
    `recordApplyOutcome(handle, heldA, k, { state: "created", … })` returns `lease_lost` and service
    `k`'s `apply` is unchanged (B's or the write-ahead's); A's write-ahead on another service is
    refused likewise, and a write-ahead under an unexpired but short lease (`now + 25 s ≥ until`)
    is refused without a write;
  - W5/W6 success returns the committed document's `_rev` as `held.rev`, and a second W6 under the
    returned `rev` lands (the chain); after a W6 that throws a non-conflict error, a W6 under the
    old `rev` is not attempted until `proveApplyLease` re-reads (asserted on the recorded calls);
  - `commitRevision` and `claimApplyLease` refuse a stale `rev` (W3, W4). The schema's field
  names equal `documentTypes.ts` and
  its import closure never reaches `node:crypto` or the store (the grant schema's rule);
  `studioProtection.test.ts` with the new type.
- **State after:** unused; nothing registered.

### 8. `solve_month`

- **Input** (strict):
  `{ month: "YYYY-MM", excludeSundays?: date[] (≤ 5), excludeSaturdays?: date[] (≤ 5), specials?: { date, name (1–80) }[] (≤ 10) }`,
  where `month`'s year is within `MIN_YEAR`…`MAX_YEAR` (2024–2035, the constants the planner's year
  field clamps to, extracted in step 3b and imported here) and its month is 01–12 (M24).
- **Handler** (inside `runMonthProposalTool`, below):
  0. **M23**: `SOLVER_HISTORY_SOURCE !== "derived"` (imported from the neutral
     `solverHistorySource.ts`) ⇒ refused `integrity_conflict`, detail `history_source_not_derived`,
     before any read, solver call or store write (D22).
  1. The schema, then `loadServiceSnapshot()` and `loadMonthPlanReads(target)` in parallel.
  2. **M1**: any snapshot source not `ready`, or a failed `pool`/`rules`/`roles` read ⇒ refused, no
     solver call, no store write. **M2**: `sourceFromGet(true, rules.body)` must be `ready` or
     `absent`; `config = editableConfig(source)`; bind `{ present, rev }`.
  3. `planSelection` (M3–M9). Refused specials are carried to the report.
  4. `savedWindow = savedWindowFor(year, month, roles)`; `targetPreflights` (M16).
  5. The step: a failed `history` read — including one past its 20 s ceiling (M12, step 6a) ⇒
     `not_called` with M12's text; else `buildSolveRequest({
     config, members: pool, sundayDates: sundayDatesFull, activeSatDates, historyEntries:
     history.entries, year, month })`; `!ok` ⇒ `not_called` with its reason (M11); else
     `remaining = 150 000 − elapsed` (ms since the call began): `remaining ≤ 0` ⇒ the solver is NOT
     called and the step is `{ kind: "threw", aborted: true }` — the abort exit, reached at zero
     rather than by a timer, since `AbortSignal.timeout` rejects a negative delay; otherwise
     `runSolve(request, { signal: AbortSignal.timeout(Math.min(120 000, remaining)) })` — the
     request exactly as built, no seed, no knob, no pin (P4-R3). An answer with `ok && schedule` is
     `ok`; any other answer `failed` (its `error` verbatim, spec `:253` — where the browser shows only
     «El solver no encontró solución.» because it never parses a 422 body, `MonthGenerator.tsx:3370-3378`:
     a declared addition); a rejection `threw` (`aborted` when the signal fired) — its error object is
     never read into a report or a log, since a fetch error can name the solver host (E1).
  6. `planAutoOutcome`, `unfilledReport`, `planReports` (its unavailability notices over
     `worshipAudience(pool)`, M17), then `cellsToDrafts(cells, columns, new Set(), [], roles)`,
     which mints each service's `localId` and `creationRequestId` exactly as a fresh Auto does, and
     per service `targetStateOf({ draft, preflight })` (step 6b) — reported as `willCreate` and
     stored as `atSolve`, one value for both.
  7. No seat filled anywhere ⇒ no record (spec `:219`: a proposal "only if any seat was filled");
     `proposal: null` with the diagnostics. Otherwise `sweepExpiredProposals`, then `createProposal`
     (the store phase), with `partial = step.kind !== "ok"`.
- **Output** (`structuredContent`, plus a Spanish summary in `content`):
  `{ ok, proposal: { proposalId, revision: 0, expiresAt, month, partial } | null,
     solver: { status, diagnostic: <every field of the answer but schedule, unfilled_seats,
     total_counts, role_counts>, history_months, reason? },
     services: [{ date, kind, name?, willCreate ("creatable"|"exists"|"blocked"), reasons?,
     seats: { <rowId>: [{ memberId, name, alias? }] } }],
     unfilled: [{ date, row, count }], unfilledTotal, refusedSpecials: [{ date, name, reason }],
     warnings: { unresolvedSolverNames, unresolvedRuleNames, unaddressableSaturdays, ruleViolations,
     doubles, unavailable }, notes }`.
  Names come from the pool read (`member_name`, `alias` apart, P1's convention). `unfilled` and
  `unfilledTotal` are `unfilledReport`'s. `warnings.unavailable` lists the worship audience only
  (I5; M17 — it can be shorter than `/admin`'s «No disponibles este mes» for a super-admin, by
  exactly the kids-only members). `total_counts`/`role_counts` stay out of `diagnostic` because they
  are keyed by pool names (I5 as well as size). `notes` always says
  that no service was written, that count caps and presence rules bind only CP-SAT's seats
  (ADR-0010), that `apply_schedule` creates what is `creatable` when it runs and reports every service
  against this `willCreate` (step 6b, Table O), and, for a partial proposal, why.
- **`runMonthProposalTool`** (`app/mcp/monthProposals/runMonthProposalTool.ts`, neutral,
  `toolTiming` like the other runners): phases `pre` and `store`, set by a `callStore(fn)` helper
  exactly as `callDomain` sets `domain`. A throw in `pre` ⇒ «No se pudo preparar la propuesta de
  mes; vuelve a intentarlo. No se guardó nada.». A throw in `store` ⇒ «No se pudo confirmar si la
  propuesta de mes se guardó. Vuelve a llamar la herramienta; una propuesta de mes que quedara sin
  usar caduca sola en 7 días. No se tocó ningún servicio.» (true: no service is ever written by
  these two tools). One more line per call, from
  `finally`, for the time budget and the live proof (never a payload or an id):
  `[mcp-plan] tool=<name> reads_ms=<n> solver_ms=<n|-> solver=<ok|not_called|failed|threw|aborted|-> fills_ms=<n|-> store_ms=<n|-> creates=<n|-> create_ms_max=<n|->` (`revise_proposal` and `apply_schedule` write it too, with `-` where a field does not apply).
- **Annotations:** `{ readOnlyHint: false, destructiveHint: false, idempotentHint: false,
  openWorldHint: false }` (P4-R6; the GCF is the app's own solver, not an open world, D14).
- **Description** (Spanish, the observation rules of I7; «propuesta de mes» throughout): what it
  does; that it writes no service and stores a private propuesta de mes for 7 days; that
  `proposalId` and `revision` must be passed to
  `revise_proposal`/`apply_schedule` **exactly as returned, never composed or edited by hand**; that
  a change goes through `revise_proposal` only; that a refused special is listed, never dropped.
- **Tests** (`solveMonth.test.ts`): the schema, M24 included (`2023-12` and `2036-01` refused with
  zero reads, `2024-01` and `2035-12` accepted); each M-row refusal with zero solver calls and zero
  store writes, M23 included (the switch mocked `"local"` ⇒ zero reads too); the four exits (a
  pre-flight refusal, a `failed` answer with its `error` verbatim, a throw, the 120 s abort under
  fake timers) each yielding the fills and a partial proposal; **the history ceiling** (M12): a
  history read that settles after 20 000 ms (fake clock) ⇒ zero solver calls, `not_called` with
  `DERIVED_HISTORY_AUTO_REFUSAL`, the fills and a partial proposal, and its late result ignored; one
  that settles at 19 999 ms is solved; every service's stored `atSolve` equals its reported
  `willCreate`; **the spent budget**: reads that take
  150 s or more (fake clock) ⇒ zero solver calls, no `AbortSignal.timeout` with a negative delay,
  the abort exit, the fills and a partial proposal, `[mcp-plan] … solver=aborted solver_ms=-`; with
  149 s spent, the signal's delay is 1 000 ms; no record when nothing is filled; the request's keys
  are exactly `buildSolveRequest`'s; the reports; **I5** (M17's test): a kids-only member with an
  unavailable date on a selected Sunday is absent from `warnings.unavailable`, a kids-only member
  with a worship Tipo is in the request's pools and, seated by the recorded answer, in
  `services[].seats`, and a legacy member without `ministries` and one whose `ministries` holds only
  an unknown value are listed (D21); a store throw ⇒ the
  `store` copy; a `pre` throw ⇒ the `pre` copy; the sweep's failure never fails the call; the timing
  lines' exact shapes.
- **Solver-boundary parity** (`app/mcp/tools/__tests__/solveMonthParity.test.tsx`, jsdom,
  `server-only` mocked, `SOLVER_HISTORY_SOURCE` mocked `"derived"`, fictitious names) — the roadmap's
  acceptance:
  - **One groq-js dataset** (F12), holding three prior months of weekend roles (the history), a
    56-day window with a special and a `published: false` role, the shared rule document naming
    members by alias (an exclusion, a pair conflict, a presence rule, a slack), a rule naming a
    member in no pool (the `support` injection), a pool member whose Tipo was cleared, a kids-only
    member who keeps a worship Tipo, a kids-only member without one and a member whose `ministries`
    holds only an unknown value (D21) — each with an unavailable date on a selected weekend of the
    month — unavailability on a Sunday and a Saturday, two members
    whose names sort by accent, an existing service in the target month (an `exists` column), a
    weekend date of the target month that holds a canonical setlist and no role (a `blocked`
    column: `monthTargetPreflight`'s setlist history, `serviceCardModel.ts:1277-1287`, blocking as
    `setlist_history`, `serviceReadiness.ts:952`), a stored
    special on a weekday of the target month, and instrument declarers.
  - **Browser side**: the REAL route handlers over the dataset answer every request the planner
    makes — `GET /api/admin/members` (super-admin) and `GET /api/admin/roles` become the props,
    `GET /api/admin/solver-config` becomes the rules controller through `sourceFromGet`,
    `GET /api/admin/solver-history` answers the fetch, and `preflight` is `monthTargetPreflight`
    over the three REAL `service-integrity` routes, its queue built exactly as `ServicesPanel`
    builds it (`cards: serviceCardRefs(roles, summaries)`, `ServicesPanel.tsx:815-825`) — so the
    connector's `cards: []` (step 6b) is compared against the browser's real association, not
    against itself. The real `MonthGenerator` (create mode) is
    rendered; the test picks the month, applies the same exclusions and special through the real
    calendar, previews and presses Auto.
  - **Request parity**: the captured `POST /api/admin/solve` body deep-equals the body `solve_month`
    hands `runSolve` over the same dataset — for (a) every weekend, (b) a deselected Sunday, an
    excluded Saturday and a named special, (c) October 2026 (an unaddressable Saturday, F1's month),
    (d) November 2026 (five Sundays), (e) three refused specials beside an accepted one. Neither
    carries `seed`, `solver_*` or `pinned`.
  - **Scenario (e), refused specials (M7) — `refuseSpecialOn`'s rules 1, 3 and 4.** The connector's
    input, in this order: a special on the weekday that holds the stored special (the fourth rule);
    one on a selected Sunday (the first rule); an accepted special on another free weekday W; and a
    second special on W (the third rule, against the one accepted before it). On the browser side the
    harness submits the same four through the real composer:
    1. the stored-special weekday by clicking the day and typing the name (`handleDayClick` →
       `submitSpecial`, `MonthCalendar.tsx:249-293`);
    2. the Sunday by opening the composer from its button and choosing that Sunday in its date
       `Select` (`:372-397`), since a click on a selected Sunday toggles it instead;
    3. the accepted special on W by clicking W and typing its name — no notice, added to the list;
    4. the second special on W by opening the composer from its button and choosing W in the date
       `Select` — the path that runs `refuseSpecialOn` (`submitSpecial`, `:271-293`, the call at
       `:278-288`).

    The harness reads the rendered notice (`<p role="status">`, `:459-463`) after each refused
    submission; each equals the matching `refusedSpecials[i].reason` **byte for byte**, and no
    refused special reaches either side's request or post set, while the accepted one reaches both.
    **The declared click-path difference (M7), asserted:** the harness then clicks W itself; the
    rendered notice is `handleDayClick`'s own sentence for a held date (`:261-267`), which the test
    pins literally and asserts is NOT equal to `refusedSpecials[3].reason` — so the tool's choice of
    the shared function's text is visible, and a change to either sentence fails the suite.
  - **Proposal parity from one recorded response**: the browser's `/api/admin/solve` and the
    connector's `runSolve` both answer a recorded response R1 (a real-shaped schedule including a
    name that matches no member and `unfilled_seats` on a deselected Sunday and an included
    Saturday) and, separately, R2 (`{ ok: false, error }`). The browser then presses «Crear N
    borradores» and the test captures every `POST /api/admin/roles` body, parsed as the route parses
    it; the connector's bodies are `planApply`'s `post` set built with `createBodyFor(draft)` (D23),
    exactly as `apply_schedule` builds them. They are `toStrictEqual` after removing
    `creationRequestId` and sorting by date. The solver's unmatched names equal the browser's list
    minus the rule-name misses.
  - **Every cell, not only the posted ones.** The bodies cover the post set only, but the proposal
    also holds solved seats for the `exists` and `blocked` columns — seats that apply WILL post if
    the target is free when it runs (X6, step 6b's stated post). So, for R1 and for R2, the harness
    also reads the pass-through `PlannerGrid` recorder's last `props.cells` (the recorder of the
    next bullet) right after Auto and before «Crear N borradores»: the grid's whole state. Each
    `GridCell` with at least one occupant, projected to (its column's `date`, `rowId`,
    `occupants.map(o => o.memberId)` in order), equals the connector's stored `services[].cells`
    projected the same way (date, `row`, `memberIds`) **for every column**, the `exists` and
    `blocked` ones included; empty cells are dropped on both sides, and `origin` and the override
    fields are not compared (the record keeps none of them, and `cellsToDrafts` reads only
    `columnId`/`rowId`/`occupants`, `plannerModel.ts:79-104`, the note at `:92-93`). A seat that
    differs in a column neither side posts today fails here, before a later apply could create it.
  - **The unfilled report, per seat, not only as a total.** The harness wraps the real `PlannerGrid`
    in a pass-through that renders it with the same props and records the last ones; the browser's
    report is `renderableUnfilled(props.unfilled, props.cells)` — exactly `visibleUnfilled`
    (`PlannerGrid.tsx:679`) — grouped per (the column's `date`, `rowId`) with counts. It equals the
    connector's `unfilled[]` entry for entry; the rendered «Lugares sin cubrir (faltó gente): N»
    (`:2106-2110`) equals `unfilledTotal`; and the cells the grid marks unfilled (`unfilledByKey`,
    `:681-685`) are exactly the connector's (date, row) pairs. Right after Auto the drop is a no-op
    on both sides (`fillInstruments` reports only rows it left empty); it bites after a manual
    pick, which `unfilledReport`'s unit test (step 6) and a `place` into an instrument cell with an
    entry (step 9) exercise.
  - **The unavailability notices, narrowed by I5 (M17).** The browser renders «No disponibles este
    mes» (`MonthGenerator.tsx:4214-4235`), one line per person; the harness reads it. Filtered to the
    worship audience with the same reader, it equals the connector's `warnings.unavailable` grouped
    the same way; unfiltered, it carries exactly the two kids-only members' lines more — the
    difference the narrowing declares, asserted, so a change on either side is seen. The member
    whose `ministries` holds only an unknown value is on BOTH sides (the super-admin's browser lists
    everyone; the TypeScript reader reads them as worship, D21).
  - This compares voices, the special and instrument fills — in every column, posted or not —
    refused specials, the unfilled report and the notices — the roadmap's list and M17.
  - **What is compared, and why the sets can be equal.** The browser's post set is
    `drafts.filter(isCreatable)` (`MonthGenerator.tsx:3569`): preflight `creatable` (the harness
    passes the real preflight), not skipped (`isExisting` from `existingRoles`), not created this
    session (the ref starts empty). The connector's is `planApply`'s post set (Table X, X6) over the
    proposal `solve_month` stored, every service pending (no `apply`). Their inputs are equal
    because both come from the one dataset and the connector's month roles equal the roles GET's
    rows — step 4c's dataset test is a precondition of this assertion, and runs first; and because
    the solve and the apply read that same dataset, every service's `atSolve` equals its apply-time
    state, so Table O's labels play no part in the comparison (they never change the post set). The
    **body** comparison is over the post set: an excluded Sunday or an already-occupied target yields
    no body on either side. The seats of every other column — the `exists` and `blocked` ones, which
    the dataset carries on purpose — are compared by the «Every cell» bullet above, so no seat a later
    apply could post escapes the browser comparison. The test presses «Crear N borradores»
    (`handleConfirm(false)`, so `published: false`), never «Crear y publicar».

### 9. `revise_proposal`

- **Input** (strict): `{ proposalId, revision, edits: Edit[] (1–20) }`, where `Edit` is
  `{ op: "place", date, row, memberId }`, `{ op: "clear", date, row, memberId }` or
  `{ op: "exchange", a: { date, row, memberId }, b: { date, row, memberId } }`. A service is named
  by its `date` (E3: one column per date); `row` is a row id as `solve_month` reports it (`lead`,
  `bgv`, `coro`, `instrumento:<Label>`, `foh:<Label>`); a member only by id (I13).
- **Handler** (`runMonthProposalTool`):
  1. The schema; ONE `loadProposal`, whose `rev` is kept as `observedRev`; the binding checks
     (step 7) on it; a live lease on it (`until > now`) ⇒ `proposal_busy` — step 7's refusal, whose
     `next` says to wait `retryAfterSeconds` and call `revise_proposal` again with the same
     `proposalId` and `revision`, never to re-solve. Step 8 commits under this same read's `rev`
     (W3), so the lease check and the commit are tied: a claim that lands after this read makes the
     commit fail.
  2. Reads in parallel: the snapshot, the pool, the rules, the month-and-window roles. A failure
     refuses (the M1 rule). The stored rules must still be `{ present, rev }` as bound, else
     `rules_changed` (P4-R9; A12's rule applied earlier, so no edit is judged under other rules).
  3. Rebuild the grid from the record: columns via `columnTypeOfKind` and `createColumnId`, `rows =
     buildRows()`, cells from `services[].cells`; `savedWindow` from the fresh roles.
  4. **R10** per touched service: its fresh `targetStateOf` must be `creatable` (whatever its
     `atSolve`: apply posts exactly the fresh `creatable` targets, X6), and its apply state must not
     be `created` or `unknown` (`service_already_created`: «Ese servicio ya se creó (o su creación
     está por confirmar); cámbialo en /admin, o corre apply_schedule para confirmarlo.»). Because
     apply writes `unknown` BEFORE each create (D20), a service whose create may have started is
     never editable here, even if the apply was killed mid-create; a `refused` service stays
     editable. **A `created` service whose recorded `roleId` is no longer among the fresh roles**
     (deleted in `/admin`, F13; recorded by an earlier apply, or by X12 from the retired receipt)
     stays refused with the same code, but its sentence is apply's «creado y luego eliminado» reason
     (step 10's output), not «cámbialo en /admin»: «Este servicio se creó con esta propuesta de mes
     y después se eliminó (o se movió fuera del mes); esta propuesta de mes ya no puede volver a
     crearlo. Corre solve_month para una nueva.» **A `created` service whose recorded `roleId` is
     among the fresh roles at another date or name** (moved or renamed in `/admin`, Table X's X1b)
     is refused with the same code and apply's O11 reason: «Este servicio se creó con esta propuesta
     de mes y después se cambió en /admin (ahora está el <fecha>); esta propuesta de mes ya no puede
     volver a crearlo ni cambiarlo. Revísalo en /admin o corre solve_month para una nueva.» The
     three `created` cases are told apart by the same lookup Table X uses (step 6b), never by a
     second rule. Re-opening any of them here would be a dead end — its `apply` state stays
     `created` through any revise (step 8 below), so Table X's X1/X1b/X2 would never post the edit.
  5. `applyEdits` (R1–R9, R14, the sequential exchange).
  6. **Ids (P4-R8):** a service whose cells differ from the record's gets a fresh
     `newCreationRequestId()`; every other service keeps its id, so its create stays a replay.
  7. `unfilledAfterEdits`, then `unfilledReport` (the record's `unfilled` is always the rendered
     report, step 6b).
  8. `commitRevision(handle, observedRev, { revision + 1, services, unfilled, revisedAt })` —
     W3 of step 7's write/guard table, under step 1's `observedRev`.
     `expiresAt`, `rules`, `original`, `selections` and every service's `atSolve` never change:
     revising cannot extend or refresh the proposal (spec `:220`), nor rewrite what the solve told
     Frank about a target. A conflict ⇒ `stale_revision`, `proposal_changed`. **`services` is
     written wholesale** (a `set` of the whole array), so it is the revise patch builder's output
     over the services AS LOADED at step 1 (step 7): only the edited services' `cells` and
     `creationRequestId` change; every service's `_key`, `kind`, `date`, `name`, `localId`,
     **`atSolve`**, `original` and **`apply`** are the loaded record's, byte for byte — an edited
     `refused` service included (it keeps its stale `refused`, which Table X reads as pending and
     the next apply's write-ahead overwrites). R10 and Table X depend on `apply` (an `apply` dropped
     here would make a created service editable and re-postable), and Table O on `atSolve` (one
     dropped would make a date taken since the proposal unclassifiable). The loaded `apply` states
     are current, with no exception, because every write to the record is guarded (step 7's
     write/guard table): a revise that loaded before a claim fails its own `ifRevisionId`; one that
     loads while a lease is live refuses at step 1; and an apply's outcome write (W6) lands only
     under the `_rev` of that apply's own last write, so any write that lands between this revise's
     read and its commit — a claim, an outcome, a killed apply's late write — moves `_rev` and fails
     this commit (`proposal_changed`); and no write of an apply whose `held.rev` predates this
     commit can land after it, because this commit moves `_rev` (step 7, «Late writes are refused»).
     No apply write ever lands on a revised array it did not read.
- **Output:** `{ ok, proposalId, revision, expiresAt, edits: [{ index, op, warnings }],
  diff: [{ date, row, added: [{ memberId, name }], removed: […] }]` (against revision 0, the
  solver's original), `services` (the shape of `solve_month`'s, `willCreate` being each service's
  stored `atSolve`, unchanged by any revise), `unfilled`, `unfilledTotal`, `notes` }; `notes` says, for every
  edited seat, that count caps and presence rules were not re-checked (spec `:220`), and that the
  unfilled figures of edited seats are recomputed (D10). Every name in `diff` and `edits[].warnings`
  is of a member seated or being placed — I5's seat exception (M17's audit).
- **Refusal:** `{ isError: true, structuredContent: { refused: true, code, detail, editIndex?,
  reason?, retryAfterSeconds?, next? } }`, the text ends «No se guardó nada.»; `retryAfterSeconds`
  and `next` are set for `proposal_busy` only (step 7). `member_not_eligible` carries no field that
  differs between its three causes (R1).
- **Annotations and description:** as `solve_month`'s; the description names the three edits, says
  that a member without the seat's Tipo, doubles and hard rules are refused and never forced, that a
  cell holds at most 12, that caps and presence are not re-checked, that a `proposal_busy` refusal
  means an apply of this propuesta de mes is in flight — wait the seconds it names (up to ~210) and
  call again with the same `proposalId` and `revision`, never `solve_month` — and repeats the
  observation rule; its Spanish says «propuesta de mes» throughout (step 7's naming).
- **Tests** (`reviseProposal.test.ts`): each verdict (R1–R3, R5, R6, R9, R10, R14) with zero store
  writes — R1 as three byte-identical refusals (an id of no document, a kids-only member without a
  worship Tipo, a worship member without the seat's Tipo); the warnings (R7, R8); the sequential
  exchange; a changed rule set; a superseded revision; a live lease (`proposal_busy` with
  `retryAfterSeconds` from the lease and a `next` that says to wait and call `revise_proposal` again,
  naming `solve_month` only as what not to call); two concurrent revises (one wins, the other
  `proposal_changed`); new ids only for changed services; **the `apply` states survive**: over a
  record an apply left with service 2 `created`, 3 `unknown` and 4 `refused`, a revise that edits
  services 4 and 5 commits a `services` array whose every `apply` and every `atSolve` is deep-equal
  to the loaded one (service 5 still has no `apply`), and a following revise still refuses an edit
  on 2 and 3 (R10); a `created` service whose role is absent from the fresh roles is refused with
  the «se creó … y después se eliminó» sentence, and one whose role was moved to another date of the
  month (or, for a special, renamed) with the «después se cambió en /admin» sentence naming the
  role's current date; **(c) a revise racing a claim loses on `ifRevisionId`**: the revise's step-1
  read sees no lease, an apply's claim (W4) lands before the revise's commit, and the commit is
  refused `proposal_changed` with zero changes to the record — the claimed lease, every `services`
  entry and `revision` deep-equal to the post-claim state — and the apply then proceeds under its
  lease; the same with a lapsed lease on the record at the revise's read (the claim overwrites it
  and still wins); a service whose `atSolve` is `exists` and whose
  target is `creatable` now accepts an edit, and one whose target is still occupied is refused
  `column_not_created`; `unfilledAfterEdits` through the tool, including a `place` into an
  instrument cell that carried an unfilled entry (the entry is gone from `unfilled` and
  `unfilledTotal`); `expiresAt` and `rules` unchanged.
- **Gate agreement** (`app/mcp/tools/__tests__/reviseGateAgreement.test.tsx`, jsdom): the REAL
  `PlannerGrid` (create mode) renders a fixture grid with a rule set; for a matrix of (row, column,
  member) the test opens the picker and reads each candidate row's `aria-disabled`, its refusal line
  and its badges. `judgePlacement` refuses exactly the disabled candidates with the same reason text,
  refuses `member_not_eligible` exactly for the pool members the picker does not list, and warns
  exactly the same badges. This pins R1–R3 and R7 to the planner's own rendering.

### 10. `apply_schedule`

- **Input** (strict): `{ proposalId, revision }`.
- **Handler** (inside `runWriteTool` with apply copy, below; every create through `callDomain`):
  1. The schema; ONE `loadProposal` (its `rev` is what the claim asserts); the binding checks
     (step 7) on it. (The rules are read and checked in step 3, with the other fresh reads —
     post-approval change 5.)
  2. A live lease on that read (`until > now`) ⇒ `proposal_busy` (step 7's refusal: `next` says to
     wait `retryAfterSeconds` — up to ~210 s — and call `apply_schedule` again with the same
     `proposalId` and `revision`, never to re-solve). Otherwise `claimApplyLease(handle, rev, {
     nonce: randomUUID(), until: now + 210 s })` (W4, A14), which returns `held` — the start of the
     lease proof every later record write uses (step 7); a claim conflict ⇒ `proposal_changed`.
     Both refusals are whole-call refusals in the month-proposal refusal shape (step 9's,
     `retryAfterSeconds`/`next` on `proposal_busy` only), ending «No se creó nada.».
  3. Fresh reads, in parallel: the snapshot, the pool, the rules, the month roles (A1; the rules
     read is step 6a's `rules` read, as revise's step 9.2 reads them). Any failure ⇒ refuse
     the whole apply (A1); then the stored rules must still be `{ present, rev }` as bound, else
     `rules_changed` (A12). Either refusal returns from inside the `try` that opened with the claim,
     so the lease is released by step 7's `finally` (W7) — one release, never two.
  4. `drafts = cellsToDrafts(cells, columns, new Set(), previous, roles)` with `previous` built from
     the record (`localId`, `creationRequestId`, `exists: false`), so every id is the record's
     (asserted) and `isExisting` comes from the fresh month roles alone; fresh `targetPreflights`;
     `planApply` over those same fresh roles — Table X (step 6b) per service, so X1/X1b/X2 check
     each recorded `roleId`, and where it now sits, against this call's read, never the solve's.
  5. **The loop**, in `planApply`'s order. Each skip or refusal (X1, X1b, X2, X4, X5, X7) is
     reported at once and writes nothing to the record. Before each post (X3, X6), if 130 s have
     passed since the call began, stop starting creates: that service and every later post are X8
     (D7). If the lease proof was broken by an earlier write whose result is unknown, re-prove it
     first (`proveApplyLease`, step 7); a failed proof stops the loop (step 7, «When the loop stops
     on `lease_lost`»). Otherwise, per posted service:
     1. **Write-ahead** (D20): `recordApplyOutcome(handle, held, key, { state: "unknown",
        revision, at })` (W5); on success `held` takes the returned `rev`. `lease_lost` ⇒ the
        service is NOT posted and the loop stops (every later post X8, «se perdió el bloqueo…»).
        `server_error` ⇒ the service is NOT posted — X8, with the reason «no se pudo registrar» —
        and the loop continues after re-proving the lease. So a service whose create may have
        started always carries `unknown` in the record, even when the platform kills the call
        before step 3 — which is what R10 reads.
     2. `outcome = await callDomain(() => createRole(createBodyFor(draft)))` inside a per-service
        `try` — the body JSON-normalised exactly as the route receives it (D23, step 6b) — and
        `classifyCreate(service, outcome | thrown)` (step 6b) maps it to its Table X row: `201` ⇒
        X9, `200` replay ⇒ X10 when the replayed role sits at the service's identity and X10b when it
        does not (`sameServiceIdentity` on the replay's body, step 6b), `ambiguous_target` with
        `details.roleIds` ⇒ X11, `idempotency_key_retired` ⇒
        X12, any other `!ok` ⇒ X13, a throw ⇒ X14 (the write may have landed; the loop continues,
        because every create is independent and idempotent). A refusal (X11–X13) carries the
        route's `code`, its `detail` and the line `serviceRefusalLine(outcome)` returns (A11) — a
        new export of `refusals.ts`, beside `refusalFor` and sharing its private
        `CODE_COPY`/`DETAIL_COPY`, that answers one create outcome as `{ code, detail?, reason }`:
        the same sentences `refusalFor`'s branch 4 composes (`refusals.ts:514-529`: the code, a
        known `detail`, `rawDrafts`, `danglingRefs`, the issue sentences), without the whole-call
        `CallToolResult` wrapper and without «No se escribió nada.» (the outcome already says it).
        Two codes get create-specific lines:
        - `ambiguous_target` carrying `details.roleIds` — the create's OCCUPIED target, from either
          arm (`roles/route.ts:160-166` with its message, `:310-316` without one) — ⇒ the route's
          own «Ya existe un servicio en esta fecha para este tipo.» (`:163`), never `CODE_COPY`'s
          «… (hay duplicados) …» (`refusals.ts:89-90`). Keyed by code and `roleIds`, not by
          `message`, because the race arm's message is the English default (`serviceMutation.ts:85`).
          This is the reason a retried `unknown` service (X3) or a lost race (X6) carries when the
          occupant is not ours; its outcome label is Table O's O5 for the service's `atSolve`;
        - `idempotency_key_retired` ⇒ `CODE_COPY`'s sentence (`refusals.ts:79-80`) followed by «Este
          servicio se creó con esta propuesta de mes y después se eliminó; esta propuesta de mes ya
          no puede volver a crearlo. Corre solve_month para una nueva.», so a retry is never
          suggested (F13). Its outcome is O4, «creado y luego eliminado», the same as X2's; it is
          reached only when the record lost the `created` state, and X12 records it back.
        `refusalFor` itself and every P3 output are unchanged.
     3. `recordApplyOutcome(handle, held, key, { state, revision, roleId?, code?, at })` (W6)
        replaces the write-ahead with the state its Table X row names (X9/X10/X10b/X12 `created` with
        the `roleId`, X11/X13 `refused` with the code; X14 leaves the write-ahead's `unknown` and
        writes nothing); on success `held` takes the returned `rev`. Locally caught, and never fails
        the call: `server_error` ⇒ the note «no se pudo registrar el resultado en la propuesta de
        mes», the lease is re-proven before the next write, and the record still says `unknown`
        (or the outcome, if the write landed unseen), so a later apply re-posts the same body
        (X3/X6), which the receipt settles (F7); `lease_lost` ⇒ the service keeps its true finding
        with the note «no se registró en la propuesta de mes: se perdió el bloqueo», and the loop
        stops (step 7).
     Each service's `ms` covers the three writes. Every service's report is then Table O's cell for
     (its finding, its `atSolve`): its `outcome` label, its `weight`, and — for X11–X13 — the
     route's `code`, `detail` and `reason`.
  6. **Warnings** (P4-R7): for every seat of every service created now, a member the pool read at
     step 3 marks `disabled`, or who no longer carries the seat's Tipo (`occupantFitsSeat`,
     `seatModel.ts:103`), is listed. There is **no second pool read after the loop**: step 3's read
     is already later than the solve, which is all the warning is about. The computation runs inside
     `safeReportRead("apply warnings", …)` (`runWriteTool.ts:135-142`), so a throw after creates have
     landed degrades to `warnings: null` plus a note («no se pudieron calcular los avisos; revisa los
     servicios en /admin») and never reaches `runWriteTool`'s catch, whose `domain` copy would call a
     landed month unknown. A deleted member is not a warning: the route refuses the create
     (`danglingRefs`, A11). Every name here is of a seated member (I5's seat exception).
  7. `releaseApplyLease(handle, held)` (W7) in `finally`, inside `safeReportRead("apply lease
     release", …)`. **Scope:** the `try` opens as soon as the claim (step 2) returns `held` and
     encloses steps 3–6, so this `finally` runs after **every** exit and every throw between the
     claim and the report — step 3's refusals, an `assertGridIdentity` throw inside `cellsToDrafts`
     (`plannerModel.ts:1091`, step 4), a throw in `targetPreflights` or `planApply`, a throw in the
     loop outside its per-service `try` — and the throw then reaches `runWriteTool`'s catch with the
     release already attempted. When the release is a no-op (below), or the invocation is killed
     before `finally` runs, the lease's own 210 s expiry is the backstop (D9). It patches only under
     `held.rev`, the `_rev` of this apply's last proven read
     (re-proven first when the chain was broken, and skipped as `not_ours` when that proof fails),
     so it can remove this apply's own lease and never another's. `released: false` — the lease is
     not provably ours, a revision conflict, or an error — is a no-op, logged with that fixed label,
     and adds one note («la propuesta de mes queda bloqueada hasta 210 s y se libera sola»); it
     never replaces the report. The report itself is built from values already in hand, so nothing
     after the loop can throw into the `domain` copy.
- **Output:** `{ ok, proposalId, revisionApplied, complete, services: [{ date, kind, name?,
  atSolve, finding, outcome, weight, published?, roleId?, code?, detail?, reason?, ms? }], counts,
  warnings: { disabled, lostTipo }, notifications: [], notificationNote, next }`. Per service,
  `finding` is its Table X finding, and `outcome` and `weight` are Table O's cell for (`finding`,
  `atSolve`) — e.g. «creado» (`published: "draft"`, I3), «ya creado (revisión N)», **«creado y luego
  eliminado»** (with the recorded or the receipt's `roleId` and the reason «Este servicio se creó
  con esta propuesta de mes y después se eliminó (o se movió fuera del mes); esta propuesta de mes
  ya no puede volver a crearlo. Corre solve_month para una nueva.»), **«creado y luego modificado en
  /admin»** (X1b and X10b, O11: with the recorded or the replayed `roleId`, the role's current date —
  and, for a special, its current name — and the reason «Este servicio se creó con esta propuesta de
  mes y después se cambió en /admin (ahora está el <fecha>); esta propuesta de mes no lo vuelve a
  crear. Revísalo en /admin o corre solve_month para una nueva.», which for X10b also says the
  create was confirmed by its receipt), «ya existía», **«no creado: la fecha se ocupó después de la
  propuesta de mes»**, «no creado: la fecha ya tiene un servicio especial con otro nombre» (O6, with
  step 6b's reason), «rechazado», «desconocido», «no intentado».
  `counts` has one entry per Table O cell present — `{ cell, outcome, weight, n }`, `cell` being the
  row and the `atSolve` column (`"O5/creatable"`, `"O5/exists"`, …) and `outcome` the label with
  «revisión N» left as that template — so «ya existía» and «no creado: la fecha se ocupó después de
  la propuesta de mes» (both the finding `taken`) stay apart, every failure cell is counted apart
  from every success and neutral one, and two revisions reported «ya creado» are one entry. **`complete`** is `applyComplete(services)` — `true` exactly when
  no service is in a *failure* cell (step 6b); the Spanish summary in `content` says the month is
  complete only when `complete` is `true`, and otherwise leads with the number of services that
  are not in place. `notifications` is built from each create's descriptors (step 5), which are
  empty for a draft (F8); `notificationNote` is «Nadie recibe aviso: se crearon borradores.»;
  `next` says that publishing is `publish_service`, one service at a time, after reading its `rev`
  with `list_services`, and then one line per *failure* finding present, from the same table
  module: `unknown`/`not_attempted`/`refused` ⇒ a re-run finishes them while the propuesta de mes is
  valid (the receipt replays what landed); `blocked` ⇒ resolve the block in `/admin` and re-run;
  **`taken` with `atSolve` `creatable` ⇒ «la fecha se ocupó después de la propuesta de mes: revisa
  ese servicio en /admin, o corre solve_month para una propuesta de mes nueva que parta de lo que hay
  hoy»**; `other_special` ⇒ the same choice; `ours_deleted` ⇒ this propuesta de mes will not
  re-create it and a new `solve_month` is the way; `ours_moved` ⇒ the service this proposal created
  now sits on another date (or under another name): review it in `/admin`, where the proposed date
  may now be empty, or run a new `solve_month`. When the loop stopped on a lost lease (step 7),
  `next` adds that a re-run with the current revision reconciles what was posted through the
  receipt. `counts` separates `O11/…` from `O2/…`, `O3/…` and `O4/…` like every other cell — a
  replay revealing a moved role (X10b) counts under `O11`, never under `O2`. **A whole-month
  success is never claimed unless `complete`** (I9): a month whose drafts were all deleted, moved
  in `/admin`, or whose dates were taken since the proposal, reports those services as not in
  place, never "done".
- **`runWriteTool`'s copy** gains an optional parameter (P3's four tools pass nothing and keep their
  text): for this tool, `pre` ⇒ «No se pudo preparar la aplicación; vuelve a intentarlo. No se creó
  nada.»; `domain` ⇒ «No se pudo confirmar qué servicios se crearon. Vuelve a llamar apply_schedule
  con la misma propuesta de mes: lo ya creado se reconoce por su recibo y no se duplica.»
- **Annotations:** P3's write annotations, `{ readOnlyHint: false, destructiveHint: true,
  idempotentHint: false, openWorldHint: false }` (I14). **Description** («propuesta de mes»
  throughout): drafts only; nobody is notified; per-service outcome, judged against what the
  propuesta de mes said about each date, and a `complete` flag that is `true` only when every
  service is in place; pass `proposalId` and `revision` exactly as the last
  `solve_month`/`revise_proposal` returned them; a superseded revision is refused; **a
  `proposal_busy` refusal means another apply of this propuesta de mes is in flight or was cut off
  — wait the seconds it names (the lease holds up to ~210 s) and call `apply_schedule` again with
  the same `proposalId` and `revision`; do not call `solve_month` for it**; a service created and
  later deleted, moved or renamed in `/admin` is reported as such, never re-created and never as
  done; a date another service took after the propuesta de mes is reported as not created, never
  as done.
- **Caller pin:** `roleCreateCommit` gains `app/mcp/tools/applySchedule.ts`.
- **Tests** (`applySchedule.test.ts`, the P3 twin-run harness extended with the create route,
  `app/mcp/writes/__tests__/twinRun.ts`):
  - **twin run** per service body: the admin route (a mocked super-admin, its body sent as
    `JSON.stringify(draftCreateBody(draft, false))`, as the browser's `fetch` sends it) and the tool
    over one fixture store: the value each hands `createRole` is `toStrictEqual` (a `createRole` spy;
    an `undefined`-valued key on one side fails it), and they produce identical transactions
    (receipt — whose fingerprint therefore matches — role, and the weekend lock create or reclaim,
    or the special coordinator create or patch), zero pushes, zero outbox upserts,
    `revalidateRoleMutation` once per create, and the same status; two specials serialize on the
    coordinator. The tool's own record writes (lease, outcomes) go through the store's `writeClient`
    calls, which the harness records apart and asserts separately, so the domain transactions are
    compared alone;
  - **refusal replay, inherited** (A11): a canonical occupant, a raw draft, a setlist or proposal on
    the date, a dangling member, a lock integrity issue, a coordinator issue, `idempotency_key_retired`
    (a deleted role's key, reached only on a record that lost its `created` state — X12, reported
    «creado y luego eliminado» and recorded `created` with the receipt's `roleId`), a commit race —
    each the route's code for that service while the others proceed; **the per-service line**: an
    occupied target, pre-commit and after a commit race, reads «Ya existe un servicio en esta fecha
    para este tipo.» and never contains «duplicados»; every line is `serviceRefusalLine`'s, and
    `refusals.test.ts`'s P3 cases for `refusalFor` pass unchanged;
  - **the apply outcome table through the tool** — every Table X row that can occur, X1–X14, X1b
    and X10b, each with its record write (or none) and its Table O cell; and specifically:
    - **a created service moved in `/admin`** (X1b, O11): after an apply created services 1–4, the
      fixture patches service 2's role date to another date of the month, and service 4's (a
      special) name, the way the `/admin` PATCH does; a re-apply makes zero `createRole` calls,
      reports 2 and 4 «creado y luego modificado en /admin» with their recorded `roleId`s and
      current date or name, weight *failure*, counts `O11/creatable` apart from `O3/creatable`,
      returns `complete: false`, and its `next` carries the review-or-re-solve line; the same
      role's date moved OUT of the read's range reads «creado y luego eliminado» (X2), and a role
      moved and then moved back to its own date reads «ya creado» (X1);
    - **a date taken after the proposal** (the finding this table exists for): service 2 is
      `creatable` at solve (`atSolve: "creatable"`, no `apply`); before the apply, the fixture
      creates another role on its target the way `/admin` does. The apply makes zero `createRole`
      calls for 2 (X4), reports it «no creado: la fecha se ocupó después de la propuesta de mes»
      with weight *failure*, counts it under `O5/creatable`, apart from «creado» and from any
      «ya existía» (`O5/exists`), returns `complete: false`, never says
      the month is complete in `content`, and `next` carries the review-in-`/admin`-or-re-solve
      line. The same with the occupant committed between the apply's fresh read and its post (the
      route's race arm, X11): one `createRole` call, the same label and weight, `complete: false`,
      and the record `refused`;
    - the **neutral** cells: a service `exists` at solve whose target is still occupied reports
      «ya existía», and a month whose other services are all «creado» is `complete: true`; one
      `blocked` at solve and now occupied reports «ya existe (al proponer estaba bloqueado)», also
      *neutral*;
    - the **stated post** (step 6b): a service `blocked` at solve whose target is `creatable` at
      apply is posted and reported «creado (al proponer estaba bloqueado)», *success*; one `exists`
      at solve whose service was deleted since is posted and reported «creado (al proponer la fecha
      tenía otro servicio, que ya no está)»;
    - a service `creatable` at solve that is `blocked` at apply reports «no creado: la fecha se
      bloqueó después de la propuesta de mes», *failure*, `complete: false`;
  - **refusal replay, mirror**: an integrity-queue issue on a target (A5) and a different-name special
    stored since the solve (A7) — the tool refuses that service, and the route alone on the same
    fixture would commit; a source failure, a rule change, an expired, superseded or busy proposal —
    zero creates; the busy one returns `retryAfterSeconds` from the lease and a `next` that says to
    wait and call `apply_schedule` again with the same `proposalId` and `revision`, naming
    `solve_month` only as what not to call (A14);
  - **retry and unknowns**: a second apply creates nothing (every service «ya creado» from the
    record, X1) and is `complete: true`; a throw on service 3 ⇒ «desconocido» (X14), 4…n proceed,
    the record says `unknown`, `complete: false`; the re-run posts 3 with the same body (X3 or X6)
    and records the replay («creado (confirmado por su recibo)», X10), and is `complete: true`;
    `idempotency_key_retired` carries its own wording;
  - **an `unknown` service whose role landed and was then moved in `/admin`** (X10b — the replay
    is held to the service's identity): service 3's create lands but the record keeps `unknown` (a
    simulated kill after the post); the fixture then moves that role to another date of the month
    the way the `/admin` PATCH does, so 3's own date reads `free`. A re-apply posts 3 once (X6), the
    route replays `200` with the role at its new date, and the tool reports «creado y luego
    modificado en /admin» with that `roleId` and «ahora está el <fecha>», weight *failure*, counts
    it under `O11/creatable` (never `O2/…`), returns `complete: false`, and records `created` — so a
    third apply meets X1b with zero `createRole` calls. The same with the role moved out of the month
    (X10b, then X2 on the next apply), and with the role left in place (X10, «creado (confirmado por
    su recibo)», `complete: true`);
  - **an `unknown` special renamed in `/admin`** (X5, O6): service 4's create lands, the record keeps
    `unknown`, the fixture renames the role on its own date; a re-apply makes zero `createRole` calls
    for 4 and reports «no creado: la fecha ya tiene un servicio especial con otro nombre» whose reason
    names the stored special and carries the «puede ser este mismo servicio, renombrado en /admin»
    sentence, weight *failure*, `complete: false`; a special stored by someone else on a `pending`
    service's date reads the same label without that sentence;
  - **the `finally`'s scope** (step 7): a throw injected into `cellsToDrafts` (an
    `assertGridIdentity` failure) after the claim ⇒ the lease is released by the `finally` (W7
    recorded once) and the call answers `runWriteTool`'s copy; a fresh-read failure (A1) ⇒ one W7,
    not two;
  - **re-apply after a delete (F13)**: after an apply created services 1–4, the fixture deletes the
    roles of 2 and 4 the way `/admin` does (hard delete, receipt retired); a re-apply makes zero
    `createRole` calls, reports 1 and 3 «ya creado (revisión N)» and 2 and 4 «creado y luego
    eliminado» (X2) with their recorded `roleId`s and the re-solve sentence, `counts` carries the two
    cells (`O3/creatable`, `O4/creatable`) apart, and `complete` is `false` (I9); with every role deleted the same re-apply reports four
    «creado y luego eliminado» and `complete: false`; and with 2's record reset to `unknown` (the
    lost-record case) the re-post is refused `idempotency_key_retired` (X12), reported with the
    same «creado y luego eliminado» label and its own line, recorded `created` with the receipt's
    `roleId` — so a third apply reports it through X2 with zero posts, and a revise refuses it
    (R10);
  - **the write-ahead (D20)**: a simulated kill after service 3's write-ahead and before its outcome
    leaves `unknown`; `revise_proposal` then refuses an edit on service 3 (R10); a failed write-ahead
    posts nothing for that service;
  - **the hard case (P4-R8)**: a revise that changes a created service is refused (R10); with the
    record's apply state lost entirely (simulated, e.g. a hand-edited record), the changed service
    (`atSolve: "creatable"`) meets its own role as an occupant it cannot claim — X4, or under a race X11 — and is reported
    «no creado: la fecha se ocupó después de la propuesta de mes», *failure*, `complete: false`:
    never a second service, and a lost record errs toward "not done", never toward "done";
  - **after the loop**: the warnings computation throwing, and `releaseApplyLease` throwing, each
    after two creates landed ⇒ the per-service report still says «creado» twice, `warnings: null`
    or the lease note, and never the `domain` copy;
  - **the record's write protocol through the tool** (step 7's write/guard table; the fixture store
    keeps a revision per record and refuses a stale `ifRevisionId`):
    - **(a) a late release carrying a foreign nonce leaves the live lease intact** — the blocker's
      sequence end to end: apply A claims and posts service 2, whose `createRole` hangs; the fake
      clock passes A's 180 s (the platform's kill, simulated by abandoning A's call) and A's 210 s
      lease; apply B claims (W4), reads service 2 `unknown`, posts it (X3/X6) and continues; A's
      hung create then resolves and A's code runs on: its W6 for service 2 returns `lease_lost`
      and writes nothing, and its `finally` release (W7) is a no-op (`not_ours`). Asserted: B's
      `applyLease` deep-equal before and after A's writes; a `revise_proposal` issued at that
      moment is refused `proposal_busy` and commits nothing; B finishes with every service in a
      success cell and its record states matching its own posts; at most ONE role exists for
      service 2 (the receipt replayed one of the two posts); the record never shows a revision
      the drafts do not hold;
    - **(b) an outcome write after the lease was lost is refused and the loop stops with an honest
      report**: in one apply, the store is made to lose the lease right after service 2's post (a
      successor's claim injected between the post and W6); W6 returns `lease_lost`, service 2
      keeps «creado» with the note «no se registró en la propuesta de mes: se perdió el bloqueo»,
      services 3…n are «no intentado» (X8) with «se perdió el bloqueo…», zero `createRole` calls
      after the loss, zero writes after the loss but the no-op release, `complete: false`, the
      record's service 2 still `unknown` (not overwritten by the lost apply), and a re-run with the
      current revision posts 2 again (X3), gets the receipt's replay («creado (confirmado por su
      recibo)», X10) and creates 3…n;
    - a W5 or W6 that throws a non-conflict error ⇒ the lease is re-proven with one fresh read
      before the next write (asserted on the recorded calls), and a proof that reads another nonce
      stops the loop as in (b);
    - (c) — the revise that races a claim — is `reviseProposal.test.ts`'s (step 9);
  - the 130 s cut-off under a fake clock (the rest X8, «no intentado», `complete: false`); the lease
    claimed, released on refusal and on success, and
    expired after 210 s; per-service `ms`; weekends before specials; `published: false` in every body;
    no body carries `publish`.

### 11. Registration, the ceiling, the tool list, the dev smoke, docs

- **Route** (`app/api/mcp/route.ts`): register `solve_month`, `revise_proposal`, `apply_schedule`
  after the four P3 writes, in that order; `export const maxDuration = 180` — the same export as
  today's `60` (`:58`), the value changed and nothing else — with a comment pointing at this plan's
  § «The time budget» and at `fluidCeiling.test.ts`, and saying that the declaration in code is what
  keeps `/api/mcp` above the project's Default Max Duration (code out-ranks it, AS9); dropping it
  would cut the route to 10 s, which the test's declaration map refuses. ADR-0013 gains the dated
  allowance line «Declared above 60 s: `app/api/mcp/route.ts` — 180 s (<date>)» in the same commit. The route's export set is unchanged
  (`mcpRoute.test.ts:576`).
- **Guards that change** (evidence Q7), each in the commit that makes it true:

  | Guard | Edit |
  |---|---|
  | `mcpRoute.test.ts` tool list (15) and `maxDuration` (`:578`) | `EXPECTED_TOOLS` (imported from the smoke), `180`, and `PROPOSAL_OBSERVATION_RULE` ending all three P4 descriptions |
  | `scripts/mcp-dev-smoke.mjs` | `WRITE_TOOL_NAMES` gains `apply_schedule` (the destructive five); new `PROPOSAL_TOOL_NAMES = ["solve_month", "revise_proposal"]` and `PROPOSAL_ANNOTATIONS = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }`; `EXPECTED_TOOLS` lists the 15 in registration order; `expectedAnnotations` has three classes; `CALLABLE_TOOLS` unchanged |
  | the smoke's unit test | pins that `toolCallRequest` refuses all seven non-callable names and that `checkToolList` accepts exactly the three annotation classes |
  | `serviceCommitCallers.test.ts` | `roleCreateCommit: ["app/api/admin/roles/route.ts", "app/mcp/tools/applySchedule.ts"]` (steps 5, 10) |
  | `__fixtures__/deliveryCapableImports.ts` | `+ "roleCreateCommit"` (step 5) |
  | `protectedReadAudit.ts` + the exact list in its test | `roles/route.ts#POST` → `roleCreateCommit.ts#module` (step 5) |
  | `mcpSanityClients.test.ts` `ALLOWED` | `+ app/mcp/monthProposals/proposalStore.ts` (step 7) |
  | `mcpProtectedTypeLiterals.test.ts` | unchanged — and green, because no `app/mcp` file spells a type (F11) |
  | `draftGatingCoverage.test.ts` | unchanged — no new exemption (I2) |
  | `clientBoundary.test.ts` | unchanged — clean: the server imports only the step-3 neutral modules |
  | `studioProtection.test.ts` | the new internal type (step 7) |
  | `moduleStateAudit.test.ts` | Release A's guard; the store adds no module state |
  | `fluidCeiling.test.ts` | the declaration map pins `app/api/mcp/route.ts` at `180` (was `60`), matched by ADR-0013's new allowance line; the `vercel.json` assertion unchanged |
  | `agentDocsParity.test.ts` | `CLAUDE.md` and `AGENTS.md` edited in one commit |

- **Dev smoke (P4-R12, DV1):** on dev the three tools are proven only by being **listed** with their
  annotations. The smoke calls none of them in any mode: `solve_month` would call the production GCF
  and write an `mcpProposal` record into the production dataset, and the other two need a proposal.
- **Descriptions** are Spanish and carry the observation rule of I7 in the P4 form, as one constant
  every P4 description ends with and the tool-list test pins on all three (as P3 pins
  `WRITE_REREAD_RULE`): `PROPOSAL_OBSERVATION_RULE` = «Pasa proposalId y revision exactamente como
  los devolvió la última llamada a solve_month o revise_proposal; nunca armes ni edites un
  calendario a mano. Si una llamada se rechaza, usa la revisión actual que el rechazo nombra.»
  (`revise_proposal` and `apply_schedule` refuse a superseded revision and name the current one.)
- **Docs, same delivery:**
  - `docs/MCP.md`: the status banner; 15 tools and the third annotation class; a «Month-proposal
    tools (P4)» section — the three tools, their payloads, their refusal-detail tables, the store
    («Stored state» gains `mcpProposal`, with `atSolve`), the lease **and the write/guard table
    (W1–W7 and the lease proof, verbatim from step 7)**, the expiry and sweep, **the apply outcome
    table (Tables X and O, verbatim from step 6b, and the `complete` rule derived from its
    weights)**, the time budget and the `[mcp-plan]` line; the condensed gate tables (M, R, A →
    disposition); «Known behaviours»: a lost response costs a re-solve (the orphan record expires); a
    dev proposal is invisible on production and vice versa; **apply reports each service against
    what the proposal said about its date** (`atSolve`), and `complete` is `true` only when no service
    is in a failure cell; **a date that was free at the proposal and another service took before the
    apply — in `/admin`, or by another proposal's apply — is reported «no creado: la fecha se ocupó
    después de la propuesta de mes», never as done, and the answer is to review it in `/admin` or
    re-solve**, while a date that already held a service at the proposal and still does is «ya
    existía» and does not block `complete`; a target the proposal showed as existing or blocked that
    is free at apply IS created, labelled with what the proposal had shown (step 6b's stated post);
    after Frank deletes applied drafts, re-applying that proposal re-creates nothing and reports each
    deleted service **«creado y luego eliminado»** — never «ya creado», never `complete` — and says a
    new `solve_month` is the way (F13, Table X's X2); a created draft Frank moves to another date
    of the month or renames in `/admin` is reported **«creado y luego modificado en /admin»** with
    where it sits now — a failure, never «ya creado», never re-created (X1b, O11) — and the same
    when the record had left it `unknown` and the receipt's replay is what shows it moved: a replay
    is «creado (confirmado por su recibo)» only at the service's own date and name (X10b); an
    `unknown` special renamed in `/admin` is refused, and its reason says it may be this same
    service (O6); only when the
    record lost a service's
    `created` state does the route's receipt answer `idempotency_key_retired` for it, with the same
    label and advice, and apply records it `created` so it is never met again (X12); a
    `proposal_busy` refusal means an apply of that proposal is in flight or was cut off — wait the
    seconds it names (≤ 210) and call again with the same proposal, never re-solve (step 7); an
    apply cut off by the platform can never disturb the apply after it: its late record writes and
    its late lease release are refused by the revision guard (step 7, W5–W7); apply
    never publishes; `warnings.unavailable`
    lists the worship audience only, so it can be shorter than `/admin`'s «No disponibles este mes»
    by the kids-only members (I5, M17), and it reads `ministries` as the app's TypeScript reader does,
    so a member whose `ministries` holds only an unknown value is listed (D21); a `willCreate:
    "blocked"` on an occupied target may list more `issue_*` reasons than `/admin`'s column (M16);
    `solve_month` refuses while the planner's history source is not `"derived"` (M23), and accepts
    only months of 2024–2035, the planner's own year range (M24); a history read past 20 s solves
    nothing and returns the fills as a partial proposal, as Auto does (M12); `warnings.unavailable`
    is sorted by date then name with a locale-less `localeCompare`, so accented names may order
    differently from `/admin`'s list (AS6; order only); the live-proof runbook (step 13) and later
    the record.
  - `docs/DATA_MODEL.md` (`mcpProposal`), `docs/API_REFERENCE.md` (the tools; `/api/mcp`'s 180 s;
    `POST /api/admin/roles` delegates to `roleCreateCommit`), `docs/SOLVER_AND_INFRA.md` (`runSolve`,
    the connector's 120 s abort, the solve path), `docs/NOTIFICATIONS.md` (apply creates drafts:
    silent, F8), `docs/README.md` (the index).
  - `docs/SECRETS.md`, **the existing `OWT_SOLVER_API_KEY` entry** (post-approval change 1; no new
    entry, D5): after step 4a it is stale. Its platform table (the Vercel row, which names
    `app/api/admin/solve/route.ts` as the sender) names `app/utils/solverCall.ts` (`runSolve` →
    `callRemoteSolver`) as the one sender, called by `/api/admin/solve` **and** by `/api/mcp`'s
    `solve_month`; its «Purpose» says a missing or mismatched key also fails `solve_month`'s solver
    call; and its «Blast radius of rotation» adds that between the Secret Manager write and each
    Vercel redeploy a `solve_month` that meets a freshly started function instance gets the 401 and
    takes M13's solver-failure arm — the fills still run and the answer is a **fills-only partial
    proposal** (stored `partial` when at least one seat is filled; the solver's `error` reported),
    never a refusal — so a proposal made mid-rotation is re-solved once the rotation is done.
    Where the value comes from, where it is not needed and the rotation steps do not change (the
    connector reads the same Vercel variable); no value is written.
  - **A new ADR, ADR-00NN (next free at merge)** — 0044 and 0045 are taken on `main` `e8660b26`
    (post-approval change 10); the number is chosen when Release B merges (the ADR index numbers
    sequentially, newest highest): "The MCP month proposal is a stored, expiring record,
    and the connector plans a month with the planner's own functions". It records the stored record
    against the JWS options (key rotation killing open proposals, 12–20 KB of text to copy, O7's new
    secret), the handle, the lease, the sweep, P4-R8's ids, why the extractions are moves and not
    copies, the dataset-level parity method, the time-budget derivation, and the rejected options:
    a JWS signed with `MCP_OAUTH_SECRET`, an HKDF subkey, a new secret, a cron sweep, recomputing every
    unfilled seat on a revise (D10), an independent exchange judgement (D11), calling the admin routes
    internally (they cannot authenticate a bearer, ADR-0043), reporting the unavailability of the
    whole pool as a super-admin's browser does (I5, D21), following the GROQ audience filter where it
    and `normalizeMinistries` disagree (D21), a process-only P2 gate (D22), passing the create body as
    a JS object (D23), re-posting a service created and later deleted (it would be refused
    `idempotency_key_retired` at best, and reported as done at worst; F13), rebuilding the
    browser's card association for the preflight queue (M16), and **classifying apply's outcomes
    from apply-time state alone** — the class two review findings exposed (a created-then-deleted
    draft reported «ya creado»; a date taken since the proposal reported as «omitido (ya existe)»
    and counted as success): the record keeps each service's solve-time state (`atSolve`) and apply
    reports from one exhaustive table of (finding × `atSolve`), whose weight column alone defines a
    whole-month success. The ADR also records the stated post (a target the proposal showed as
    existing or blocked is created when free at apply, labelled so) and why refusing it was
    rejected (a re-solve reseeds the whole month); and, as a rejected option, **record writes that
    rely on "while the lease is held nobody else writes"** — the class a third review finding
    exposed (a killed apply's late `finally` removing its successor's live lease, so a revise could
    commit between two of the successor's writes): every write to the record carries a guard (step
    7's write/guard table), apply-side ones a proof of the lease's nonce under `ifRevisionId`.
  - The **ADR-0043 amendment** (step 5), the **ADR-0013 amendment** (step 1) and its allowance line
    for `/api/mcp` (above); a one-line pointer in
    ADR-0010 (specials fill locally — the connector runs the same `runLocalFills`).
  - `CLAUDE.md` **and** `AGENTS.md`: "four admin write routes (setlists PUT, swap, publish-ready,
    unpublish)" becomes **five**, adding the create (`POST /api/admin/roles` → `roleCreateCommit`);
    reusable-utils entries for `runLocalFills` (the ONE Auto fill orchestration), `runSolve` (the ONE
    solver call), `monthProposalModel` (the ONE month-proposal model) and the three neutral planner
    modules (`plannerCalendar`, `plannerMonth`, `plannerCells` — never re-implemented in a client
    file); one invariant: "`mcpProposal.*` is written only by `app/mcp/monthProposals/proposalStore.ts`,
    and **no write to it is unguarded**: every patch carries `ifRevisionId`, and every apply-side
    write (outcomes, release) also proves the lease's nonce on the read that revision came from
    (`proposalStore.test.ts` fails on an unguarded one);
    `solve_month`/`revise_proposal` write only it; `apply_schedule` creates drafts only, through
    `roleCreateCommit`, and reports every service from the ONE apply outcome table
    (`APPLY_ACTIONS`/`APPLY_OUTCOMES`, `monthProposalModel.ts`) — against the service's stored
    solve-time state, never from apply-time state alone — with `complete` derived from its weights.
    The solver pool binds `{ all: true }` as an input, but no P4 output lists a member outside the
    worship audience except in a seat (`worshipAudience`, spec I5)".
  - **The spec amendment** (§ below) applied to the spec and listed in
    `2026-09-22-owt-mcp-design-v2-review-log.md` «Post-approval changes — un-reviewed»; **the
    roadmap amendments** (§ below) applied and listed in `2026-09-22-owt-mcp-roadmap-review-log.md`.
    Release B does not proceed without both (step 12).
- **State after:** the full surface, unreleased.

### 12. Release B (CLAUDE.md order, without exception)

1. **Entry:** P2 D2 released — merged to `main` as `98aa67a9` (2026-09-28) and **the production
   alias verification on record**: `owt-backstage.vercel.app` in the deployment's `alias` and its
   `meta.githubCommitSha` a commit that carries `SOLVER_HISTORY_SOURCE = "derived"` (P4-R1; M23
   refuses at runtime regardless); Release A's 48 h soak passed with no stop condition; step 2's stop
   conditions not tripped, or resolved with Frank; Frank's answer to Q4 (the roadmap rollback's
   narrowing) recorded with the roadmap amendment. Merge `main` into the branch; the gates, the
   parity suite included, green on the merged tree.
2. **Fresh code review of the merge range**, carrying the docs-audit and worklog-completeness
   checklists. It checks specifically:
   - every extraction is a pure move (the colour-moved diff); every listed counterpart suite has zero
     diff;
   - `roleCreateCommit`: registry, delivery coverage, caller pin, the route's residual shape;
   - the store: the allowlist entry, no protected read, no person name stored; **the write/guard
     table against the code**: every mutating store function is one of W1–W7 and carries that row's
     guard — no patch without `ifRevisionId`, no apply-side write whose `rev` did not come from a
     read that checked the lease's nonce, no release that could remove another apply's lease, and
     revise's commit asserting the same read that checked the lease; the lease-lost path stops the
     loop and reports what was posted;
   - no role literal and no protected-type or draft-gated GROQ literal in `app/mcp/**` (the store's
     two `mcpProposal` queries are the only GROQ there, parameterised by `$type` as
     `grantStore.ts:62-64` is);
   - I5: no output lists a pool member outside the worship audience except in a seat (M17's audit
     re-run against the code), `worshipAudience` is `normalizeMinistries`' semantics with the
     junk-only divergence pinned (D21), and R1's refusal is one payload;
   - the record's `apply` states and `atSolve`: the revise patch builder copies both from the
     loaded record (step 7, 9.8), `atSolve` is written only by `solve_month`, and Table X's
     X1/X1b/X2 check the recorded `roleId`, and the identity it now holds, against the fresh roles
     (F13), and X10/X10b hold a replay's role to the same identity through the one
     `sameServiceIdentity` — no `200` is reported «confirmado por su recibo» without it; O6's label
     blames no one and only its reason reads the apply state;
   - apply's `finally` encloses everything from the claim to the report (step 10.7), so no throw
     between them leaves the lease to its 210 s lapse except a killed invocation;
   - **the apply outcome table**: `planApply`, `classifyCreate`, the tool's output, `counts`,
     `next` and `complete` all read the one `APPLY_ACTIONS`/`APPLY_OUTCOMES` constant; no
     per-service label or success decision in the range is computed from apply-time state without
     `atSolve`; no label list restates the `complete` rule; every reachable row and cell has its
     test (step 6), and the blocker case — `creatable` at solve, occupied by another at apply, by
     the read (X4) and by the race (X11) — yields `complete: false`;
   - `proposal_busy` carries `retryAfterSeconds` and the wait-and-call-again `next` in both tools,
     and both descriptions say it;
   - `moduleStateAudit.test.ts`' pinned table still equals its scanner's hit set, its in-place
     mutation class is still empty, and no new module-level instance in the range holds shared
     mutable state (the scanner's declared blind spot, step 1);
   - every gate row (M, R, A) has its test, every `mirror (behaviour)` row its parity or report test;
   - `maxDuration = 180` declared in `app/api/mcp/route.ts`, pinned in `fluidCeiling.test.ts`'s
     declaration map and named on ADR-0013's allowance line; `vercel.json` unchanged (keys
     `ignoreCommand`, `crons`, `fluid`); the smoke never calls the three;
   - the spec and roadmap amendments are in the range and in their review logs.
   Then fix, and **re-verify the fix** (a scoped review of the fix range plus the gates on the final
   tree). The last worklog entry before the merge is a verification, not a fix.
3. Merge into `preview`, push, verify the dev alias (alias + `githubCommitSha`) **and read (O-a)
   exactly as Release A did** (step 1; unreadable ⇒ stop): Fluid on, `config.functionTimeout` 10,
   the project's `resourceConfig.functionDefaultTimeout` 10. `/api/mcp`'s **180** is not observable
   per function (no API lists it, F2's evidence row): it is pinned in code, in `fluidCeiling.test.ts`
   and on ADR-0013's allowance line, and it rests on the precedence Release A's (P) proved; the first
   call that runs `/api/mcp` past 10 s is L1 (step 13), which shows code > dashboard for this route,
   not the value. **Frank** runs
   `mcp-dev-smoke.mjs --await-revocation --reads` on dev: 15 tools listed with their annotations;
   only `ping` and the reads called.
4. PR to `main` from the same reviewed commit; `gates`; merge with Frank's OK; verify the production
   alias and read (O-a) on the production deployment (Fluid on, `functionTimeout` 10).
5. The three tools are live but **unused on any real month** until step 13 passes (roadmap Sequence
   table).

### 13. Live proof on production: **human-gated parking points**

Every call below is made through the claude.ai connector on Frank's explicit instruction at that
moment, or by Frank in `/admin`. **The agent does not pass a parking point without Frank.** The month
is Q2's throwaway **M** (no services). Drafts notify nobody (F8: `roleCreateNotice` returns `null`
for `!published`, `serviceMutationSideEffects.ts:301-307`; `queueRoleNotices` returns before any
upsert when `published === false`, `:465-473`), so the audience of every step is **nobody**; the
drafts are visible only in `/admin`. Unlike P3's throwaways, weekend drafts are safe here: apply
creates no setlist, so `/admin` can delete them (`roleDependencies.ts:219-238` refuses only a week
holding setlist or proposal history).

- **PP0:** `list_services` for M returns no service; Frank confirms M and that he will delete its
  drafts at L6; he names, for L2, one of his hard rules that a placement in M can break, and one
  member who lacks the Lead Tipo. The agent records, read-only, that no `notificationOutbox`
  document names a role of M (a GROQ read through the Sanity MCP if connected, otherwise Frank in the
  Studio's read-only pane).
- **Log readings are made within the hour.** Every check below that reads `[mcp]`/`[mcp-plan]`
  lines — L1's server `ms`, L4's timings, L5's and L7's `creates=0` — reads them with
  `vercel logs <production deployment> --json` **right after the call, before the next parking
  point**, because Hobby keeps about an hour of runtime logs (`docs/NOTIFICATIONS.md:528-529`), and
  copies the line to the evidence file at once. A reading missed past the hour is recorded as
  **missing**, never estimated; L5 and L7 are idempotent re-applies, so a missed `creates=0` is
  re-taken by repeating that same call (it creates nothing by design) and reading at once; L4's
  per-service `ms` is also in the tool's own output.

| Step | Call | Expected | Check |
|---|---|---|---|
| L1 | `solve_month { month: M, excludeSundays: [one], excludeSaturdays: [one], specials: [«PRUEBA MCP P4 — ignorar» on a weekday of M, «PRUEBA duplicada» on a selected Sunday of M] }` | a proposal, revision 0; the second special refused with `refuseSpecialOn`'s text and listed, not dropped; the excluded dates absent; `willCreate: "creatable"` everywhere else; the report extras present | **AS7's validation, recorded explicitly** (post-approval change 9): whether claude.ai received the result (received / not received, as Frank's Claude app shows it — never inferred from the server side), beside the server `ms` from `[mcp]`/`[mcp-plan]` in `vercel logs --json`, read within the hour (above), in the evidence file's AS7 reading; a server `ms` past 10 000 with the result received is also `/api/mcp`'s precedence reading (step 12.3). Frank may open `/admin` «Generar mes» for M with the same selections and **only preview** (no Auto, no Crear) to compare the «Historial» chips and the «No disponibles este mes» list — which equals `warnings.unavailable` plus any kids-only member's line (I5: the connector omits them, a super-admin's `/admin` shows them; M17). A kids-only name in `warnings.unavailable` is a stop condition |
| L2a | `revise_proposal { revision: 0, edits: [place, clear, exchange] }` | revision 1; warnings as applicable; the diff; the caps/presence note on each edited seat; recomputed unfilled | `expiresAt` unchanged |
| L2b | `revise_proposal { revision: 1, edits: [place the PP0 member without Lead Tipo in Lead] }` | refused `member_not_eligible`, with R1's one sentence; nothing stored | revision still 1 |
| L2c | `revise_proposal { revision: 1, edits: [the placement PP0's rule forbids] }` | refused `hard_rule`, naming the rule | revision still 1 |
| L3 | `apply_schedule { revision: 0 }` | refused `proposal_superseded`, naming revision 1; zero creates | `list_services` for M still empty |
| L4 | `apply_schedule { revision: 1 }` | every creatable service «creado» (X9, O1), `complete: true`, per-service `ms` (the spike's S3 figure if Q1 opted out); `notifications: []` | `list_services`/`get_service` for M: drafts only, each service's seats equal the proposal's revision 1; Frank receives nothing; no outbox document names a role of M; **AS7's validation, recorded explicitly** (post-approval change 9): received / not received by claude.ai, as Frank's Claude app shows it, beside the call's server `ms` (`[mcp-plan]`, read within the hour) — typically the proof's longest call (§ «The time budget») |
| L5 | `apply_schedule { revision: 1 }` again | every service «ya creado (revisión 1)» from the record (X1, O3), `complete: true`; zero `roleCreateCommit` calls (`[mcp-plan]` shows `creates=0`, read within the hour) | `list_services` count unchanged |
| L6 | Frank deletes M's drafts in `/admin` | gone; the receipts (now retired, F13), M's weekend target locks (vacated, not deleted) and the shared special coordinator remain, inert and not cleaned — the roadmap P4 row as amended, a narrowing of its rollback Frank has seen (Q4) | `list_services` for M empty |
| L7 | `apply_schedule { revision: 1 }` once more, after L6 | every service L4 created «creado y luego eliminado» with its recorded `roleId` and the re-solve advice (F13, Table X's X2, O4); zero `roleCreateCommit` calls (`[mcp-plan]` `creates=0`, read within the hour); **`complete: false`, and no whole-month success in `content`** (I9); it writes only the record's lease | `list_services` for M still empty; nothing re-created |

- **Stop conditions** (stop, report, decide with Frank; `MCP_DISABLED=1` is the kill switch and
  needs a redeploy): any notification about M's services; any published service in M; a service
  created twice or a count that differs from the proposal; an `isError` on a call expected to
  succeed; seats that differ from the proposal; a kids-only member named in any list that is not a
  seat (I5); a server duration beyond three times the time budget's typical figure (solve > 45 s,
  apply > 120 s); a result the server completed that claude.ai did not receive (AS7); at L4 or L5,
  `complete: false`; at L7, any service re-created, reported «ya creado», `complete: true`, or a
  whole-month success claimed.
- **After L7** the proposal record stays, private and inert, until its expiry and the next sweep.

### 14. Integration acceptance (INT, the roadmap's; Frank's timing)

P4 owns INT (roadmap `:172`): from the phone, the next real month Frank plans — **up to applying
drafts** — goes through the connector: `list_services` for its coverage gaps, `solve_month`,
`revise_proposal` as he wants, `apply_schedule`. Everything that publishes or pushes was proven on
throwaways by P3. Publishing that real month afterwards (in `/admin` or with `publish_service`) is
ordinary operations, outside the acceptance. Default (Q3): the first real month Frank plans after
L7.

### 15. Record and close

- `docs/MCP.md`'s P4 release record: both releases' commits and aliases, the Fluid confirmation, the
  **observed effective limits** of both releases ((O-a), step 1 and step 12.3), Release A's
  precedence proof ((P): each run's status and timings) and L1's `/api/mcp` reading, the Default Max
  Duration's date and read-back, the pre-Fluid usage baseline (step 1) and the
  soak's readings against it (usage; the flush workflow's runs, cited by run id; the runtime-log
  samples, labelled as samples), the spike's numbers, L1–L7 with server durations (a reading missed
  past the log hour recorded as missing) and whether claude.ai received each result,
  the INT run when it happens. The plan's status line; the roadmap's P4 row marked released.
- **One Vercel usage reading after the live proof** (post-approval change 6): after L7, the
  Usage page read as the baseline was (step 1: the same three metrics under the page's names, the
  reading's date, the cycle's start and days elapsed), and set against the pre-Fluid baseline and
  the soak's last reading with the soak's projection rule (step 1) — so the record says what
  Release B and the live proof added. A projection above 50 % of any allowance is escalated to
  Frank with the numbers. It goes to the evidence file and to `docs/MCP.md`'s P4 record.
- `finish-cycle`: batch-append the worklog, the weekly HR run if due.

## Notification audiences (confirmed from code at `7c65f2eb`)

| Tool | Immediate | Queued in the outbox | Never |
|---|---|---|---|
| `solve_month` | — | — | everything: it writes only its own record |
| `revise_proposal` | — | — | everything: it writes only its own record |
| `apply_schedule` | — (`roleCreateNotice` is `null` for a draft, `serviceMutationSideEffects.ts:301-307`) | — (`queueRoleNotices` returns before any upsert for `published === false`, `:465-473`; so no layer-2 sweep runs) | push, email, outbox, sweep |

`apply_schedule` does call `revalidateRoleMutation()` per create, as the route (I12): drafts appear
in `/admin`'s views, and members' pages filter them out (`published != false`).

## The time budget (`maxDuration = 180`)

Sequential round trips; MCP auth is 0–2 (30 s caches). Measured figures are F1's (dev, browser
timings with network) and P1/P3's server-side timings.

| Tool | Phases | Typical | Worst case, bounded |
|---|---|---|---|
| `solve_month` | reads in parallel (the snapshot's 7 + 1, pool, rules, roles, history's 2): P1 read 0.35–0.72 s, history 0.52 s (capped at 20 s, M12) → ≈ 1–1.5 s; the solver 7.3–10.3 s (F1); fills (CPU, < 1 s, measured on the largest parity fixture in step 8); sweep + create ≈ 0.5 s | **≈ 10–15 s** | the solver's abort is `min(120 s, 150 s − elapsed)`, and with nothing left of the 150 s the solver is not called at all (never a negative timeout), so the solve phase ends by 150 s whatever the reads took; + fills ≤ 5 s + store (the guarded sweep, ≤ 25 deletes 5 at a time, and the create) ≤ 5 s = **≤ 160 s** |
| `revise_proposal` | record 1; reads in parallel ≈ 1–1.5 s; judge (CPU); commit 1 | ≈ 2–3 s | ≤ 15 s |
| `apply_schedule` | record + lease 2; fresh reads ≈ 1.5 s; per create ≈ 7 sequential trips (P3's guarded writes 1.2–2.4 s; S3 measures) + 2 record sets (the write-ahead and the outcome, D20 — each one guarded patch; its lease proof is the previous guarded write's returned document, so the guard adds no round trip, and only a write whose result is unknown adds one fresh read before the next, step 7); release 1 | 13 services ≈ 30–40 s | no create **starts** after 130 s (D7); one create with its two record sets in flight — **sized** at 25 s, ≈ 10× its measured cost: an estimate, not a mechanism, since nothing wraps `createRole` or the record writes in a timeout — + release and report ≤ 5 s = **≤ 160 s** when that estimate holds; a create that hangs past it meets the platform's kill at 180 s, and the paragraph below states the outcome |
| reads and P3 writes | unchanged | P3's table | ≈ 39 s + P1's load (P3 plan) |

**Why 180.** The two worst cases are 160 s; 180 is the smallest round ceiling that leaves 20 s of
margin under both, so a normal overrun never meets the platform's kill. 300 (Fluid's Hobby maximum)
would only let a hung call hold an instance longer. **P4-R10's "~240 s"** assumed the 300 s ceiling
and predates F1: with an estimated month of ≈ 30–40 s of creates, the cut-off is re-derived as
`180 − 25 (one create, the sizing estimate above) − 5 (release, report) − 20 (margin) = 130 s`,
and it is a backstop, not a budget a normal month approaches. **P4-R3's 120 s** is kept as the solver's own cap (the GCF's
`--timeout`); the 150 s solve deadline only shortens it when the reads were slow, and when the
reads alone used it up the solve takes the abort exit without a call (M13, D6).

**If the platform kills a call anyway** (a hung create included — nothing bounds one below the
ceiling): `solve_month`/`revise_proposal` lose at most their own record write (a re-run mints a
new one; an orphan expires); `apply_schedule`'s creates are each committed or not, the service in
flight carries its write-ahead `unknown` (D20), the lease expires by itself at 210 s, and a re-run
replays what landed (X3/X6, F7). If the killed invocation's JavaScript keeps running, its late
record writes and its late lease release are **refused** by their guards once anyone else has
written the record — a successor's claim, a revise — so they can never remove a successor's lease
or overwrite its states; one that lands because nobody has written since is that create's true
outcome (step 7, W5–W7 and «Late writes are refused»). The guards cost no round trip in the normal
path, so this table's figures stand.

## Data and failure safety

- **Identity and source of truth.** The dataset. A proposal's identity is its handle plus its
  revision; a service's is its `creationRequestId`, fingerprinted with its body by the route's
  receipt (F7). No revision or id the model sends is trusted beyond equality with the stored record.
- **Migration:** none for domain data. One new document type, created on first use.
- **Partial failure:**
  - `solve_month`/`revise_proposal` write only their record; a throw before it writes nothing
    («No se guardó nada.»); a throw at or after it may leave an orphan record, inert and expiring.
  - `apply_schedule` is per service (spec «Atomicity is a stated limitation»): each create commits
    one transaction or nothing; a refusal or a throw affects only its service; the report is per
    service, from the apply outcome table (step 6b), which reads each service's stored solve-time
    state (`atSolve`) as well as what apply found; a whole-month success (`complete`) is claimed
    only when no service is in a *failure* cell (I9) — so a service «creado y luego eliminado»
    (F13) or «creado y luego modificado en /admin» (X1b), and a date that was `creatable` at the
    proposal and taken by another service before the apply («no creado: la fecha se ocupó después
    de la propuesta de mes»), are never counted as done; only a date that already held a service at
    the proposal and still does is *neutral*.
  - A failed record write after a successful create is reported and healed by the receipt on the
    next run. A record write refused because the lease was lost stops the loop; what was posted is
    reported as it happened, and the next run reconciles it through the receipt (step 7).
- **Concurrency:**
  - the record: **no write is unguarded** (step 7's write/guard table, W1–W7). `revise` commits
    under `ifRevisionId` of the same read that saw no live lease (W3); `apply` claims a lease under
    `ifRevisionId` (W4), and every later record write of that apply — the write-ahead `unknown`
    before each create (D20), each outcome, the release — is a patch under `ifRevisionId` of a read
    that showed its own nonce (W5–W7), so it lands only while nobody else has written; a second
    apply or a revise refuses while the lease lives; the lease outlives the ceiling (D9); a killed
    apply's late writes and late release are refused, never tolerated; the sweep's delete is a
    guarded transaction (W2);
  - the creates: the route's own coordination, unchanged — the receipt as the global create mutex,
    the weekend lock, the special coordinator, occupancy re-checked at write time (spec `:221`);
  - the snapshot, pool and roles are re-read at apply, never trusted from the solve.
- **Idempotency (P4-R8):** a service keeps its `creationRequestId` across revisions unless a revision
  changes it; an unchanged service replays (`200`), a changed one creates under its new id; a service
  already created cannot be revised (R10), and if the record lost that fact the route's occupancy
  refuses a second service. A retried apply creates nothing twice. A service created and then
  deleted in `/admin` is never re-created by the same proposal: the record's `created` state (which
  every revise carries forward, step 9.8) stops it before the route, reported «creado y luego
  eliminado» (Table X's X2); the retired receipt refuses it only if that state was lost, with the
  same label, and apply then records it `created` again (X12, F13). A created service moved or
  renamed in `/admin` is found by its recorded `roleId` at its new identity and is likewise never
  re-posted (X1b); one the record had left `unknown` is posted once, and the receipt's replay is
  held to the service's identity, so a moved role reads «creado y luego modificado en /admin», is
  recorded `created`, and is never posted again (X10b). A record that lost a service's
  state errs away from «done»: its own role reads as an occupant it cannot claim (X4/X11 — a
  *failure* or *neutral* cell by its `atSolve`, never a success).
  A second apply or revise in flight is told to wait for the lease, not to re-solve (`proposal_busy`,
  step 7).
- **Expiry (P4-R7):** 7 days from the solve, never extended by a revise; refused on use; swept.
- **Data preservation and rollback:** the live proof's drafts are deleted by Frank in `/admin`;
  their receipts (retired by the delete, F13), their weekend target locks (vacated, not deleted, by
  the same transaction, `app/api/admin/roles/[id]/route.ts:577-583`, and reclaimed by the next create
  on that target, `app/api/admin/roles/route.ts:273-275`) and the special coordinator
  (`specialIdentityCoordinator.global`, one document shared by every special create,
  `app/utils/specialIdentityCoordinator.ts:18`) remain, inert, and are **not cleaned**. **This is a
  narrowing of the roadmap's rollback, and Frank must see it** (Q4; § «Roadmap amendments»): the
  roadmap promised these leftovers would be «cleaned by a guarded script». The argument: a retired
  receipt is what refuses re-using its key (`idempotency_key_retired`) — deleting it would let a
  stale `unknown` in some record re-create a service Frank deleted; a vacated lock is what the next
  create on its target reclaims, exactly as after any `/admin` delete, so deleting it would race
  that create for no gain; and deleting the coordinator would touch every later special. What the
  script would have been, if Frank wants it anyway: a one-off `scripts/` script, dry run by default,
  `--apply` to write, `writeClient`, deleting only receipts in the retired state (`state:
  "role_deleted"`, `retireReceiptPatch`, `app/utils/roleCreationReceipt.ts:294-296`) whose `roleId`
  no longer exists and whose `updatedAt` precedes a date Frank names, each under its own
  `ifRevisionId` — never a lock, never the coordinator — under CLAUDE.md's production-write consent
  rule. Records are private and self-expiring.
- **I5:** the pool read admits kids-only members as solver input; the only pool-derived member list
  not tied to a seat (`warnings.unavailable`) is filtered to the worship audience before it leaves
  the server — by the app's TypeScript reader, so a junk-only `ministries` reads as worship there
  (D21) — and no refusal distinguishes a kids-only id (M17, R1).

## Verification (requirement coverage)

| Requirement | Test or check | Failure it detects |
|---|---|---|
| Solver-boundary parity: the request | `solveMonthParity.test.tsx`, dataset-level, five scenarios, the real `MonthGenerator` against the real admin routes (step 8) | a connector request that differs from the browser's Auto; a seed, knob or pin |
| Solver-boundary parity: the proposal | the same file, recorded responses R1 and R2, the browser's own create bodies against `planApply`'s built by `createBodyFor` (`toStrictEqual`); **every cell of every column** — the pass-through `PlannerGrid` recorder's last `props.cells` against the stored `services[].cells`, the `exists` and `blocked` columns included (the dataset carries one of each); the unfilled report per (date, row) through `renderableUnfilled` against the grid's own props, markers and total; the composer's rendered notice against `refusedSpecials[].reason` for `refuseSpecialOn`'s rules 1, 3 and 4, and the day-click path's own rule-3 sentence asserted as the declared difference (scenario e, M7) (step 8) | a fill, a special, an unfilled count at any seat or an unmatched name that differs; a seat in a column neither side posts today that differs from the browser's, which a later apply would create (X6); a refused special dropped or worded differently from `/admin`'s composer; a click-path wording change nobody declared |
| The pool and the window reads | `plannerReadParity.test.ts` (text pins + groq-js dataset, step 4) | a pool in another order or filter; a window missing drafts, specials or datetime dates |
| I1 audit | `protectedReadAudit.test.ts` (the create entry moved; the store unregistered and clean); `mcpSanityClients.test.ts` (one new file); `serviceCommitCallers.test.ts` | an unregistered writer; a second create path; an MCP file holding a client |
| I2 draft gating | `draftGatingCoverage.test.ts`, `mcpProtectedTypeLiterals.test.ts` unchanged and green | a draft-gated literal in the MCP; a new exemption |
| I3 publication state | `apply_schedule`'s services carry `published: "draft"`; test | a created draft reported as live |
| I5 (the pool is an input, never a listing) | a parity scenario with a kids-only member who keeps a worship Tipo: in the request, as in the browser; `plannerReadParity.test.ts` asserts textually that `solverPoolMembersQuery()` binds `{ all: true }` (a `false` would silently drop kids-only members from the request a super-admin's browser sends) and that `worshipAudience` keeps exactly the ids `WORSHIP_AUDIENCE_GROQ_FILTER` returns except the two junk shapes (`["alabanza"]`, a bare `"kids"`), where it asserts the declared divergence — TypeScript keeps, GROQ drops (D21); `solveMonth.test.ts` (M17): a kids-only member with an unavailable date is absent from `warnings.unavailable` while a kids-only member with a worship Tipo reaches the request and, seated, `services[].seats`; the parity file's notices comparison (the browser's list filtered by the same reader, and the declared difference asserted); `reviseProposal.test.ts` (R1): one refusal payload for an unknown id, a kids-only id and a Tipo-less member; P1's I5 test unchanged | a worship filter applied to the pool; a kids-only name in a list that is not a seat; a refusal that confirms a kids-only id exists; the audience filter silently switching semantics on junk `ministries` |
| P4-R1 at runtime | `solveMonth.test.ts` (M23): the switch mocked `"local"` ⇒ `history_source_not_derived`, zero reads, zero solver calls, zero store writes | a connector solving against a history `/admin` does not use (a build before the cutover, or after a rollback of it) |
| I6 | the route tests unchanged (bearer before dispatch); `roleWriteRoutes.test.ts` unchanged | a tool reachable without P0's checks; an admin behaviour change |
| I7 (the proposal as the observation) | superseded, expired, other-origin, other-principal, rules-changed refusals (steps 7–10) | applying edits Frank did not see; applying under changed rules |
| I8 | twin run: zero pushes, zero upserts for drafts; the pre-commit capture moved verbatim (step 5) | a notification from a draft create |
| I9 | per-service outcomes from the apply outcome table; `complete` from its weight column alone; the three runners' copy by phase; `monthProposalModel.test.ts`: every reachable Table X row and Table O cell, and `applyComplete`; `applySchedule.test.ts` «a date taken after the proposal» (X4 and X11: «no creado: la fecha se ocupó después de la propuesta de mes», `complete: false`), the neutral «ya existía» (`complete: true`), «re-apply after a delete» and L7 (deleted services reported «creado y luego eliminado», never «ya creado», `complete: false`), «a created service moved in `/admin`» (X1b: «creado y luego modificado en /admin», counted `O11/…`, `complete: false`; moved out of range ⇒ X2), «an `unknown` service whose role landed and was then moved» (X10b: the replay held to the service's identity, «creado y luego modificado en /admin», counted `O11/…` never `O2/…`, `complete: false`, recorded `created`), «an `unknown` special renamed in `/admin`» (X5, O6: refused, its reason naming the special found and saying it may be this same service) | a silent partial month; a committed create reported as unknown; a month whose drafts were deleted reported as done; a draft moved or renamed in `/admin` reported «ya creado» — or, through a replay, «creado (confirmado por su recibo)» — as if it were still the proposed service; a renamed service of this proposal reported as another's special; a date taken since the proposal reported like one already taken then, or counted as success |
| I12 | twin run: `revalidateRoleMutation` per create | stale `/admin` after apply |
| I13 | strict schemas; member ids resolve to pool members; dates in the month; row ids known; the handle shape | argument injection; a composed schedule |
| I14 | the 15-tool list test; the smoke's `checkToolList` with three classes | a write declared harmless; a proposal tool declared read-only (the spec amendment) |
| I15 | every M, R, A row: refusal replay, parity or schema test; the step-12 review checks the tables against the tests | a guard the planner has and the connector skips |
| The revise gate | `reviseGateAgreement.test.tsx` against the real `PlannerGrid` | a refusal or warning that differs from the picker's |
| Idempotency and retries | `applySchedule.test.ts`: retry, unknown, the write-ahead, the hard case, the lease, re-apply after a delete (X1/X2; `idempotency_key_retired` only on a record that lost its `created` state, X12, recorded back as `created`), a created service moved in `/admin` (X1b, zero posts), an `unknown` service whose landed role was moved (one post, the replay held to the service's identity, X10b, recorded `created`, then X1b with zero posts), the `finally` releasing the lease after a throw between the claim and the loop; `monthProposalModel.test.ts`: X1/X1b/X2 against the fresh roles and the identity the role holds there, X10/X10b on the replay's body through the same `sameServiceIdentity`; the twin run's `toStrictEqual` on the value `createRole` receives from the route and from the tool | a service created twice; a lost result; a body whose shape differs from the route's, so its receipt fingerprint differs; a deleted service re-posted or reported as present; a replay taken as proof that the service sits where it was proposed; a lease left to its 210 s lapse by a throw the `finally` should have caught |
| The revise write keeps the apply states and `atSolve` | `proposalDocument.test.ts` (the revise patch builder copies every `apply` and every `atSolve` from the loaded record, ignores input); `reviseProposal.test.ts` (`created`/`unknown`/`refused` states and all three `atSolve` values deep-equal after a revise that edits a `refused` service; R10 still refuses 2 and 3) | a revise that erases `apply` and makes a created service editable and re-postable; a revise that loses or rewrites what the solve said about a target, so apply misreports it |
| The busy lease | `reviseProposal.test.ts`, `applySchedule.test.ts`, `proposalDocument.test.ts`: `proposal_busy` with `retryAfterSeconds` from the lease and the wait-and-call-again `next`; both descriptions say it (A14) | a model that re-solves while an apply is in flight, and races it with a second proposal |
| The record's write protocol (step 7, W1–W7) | `proposalStore.test.ts`: every patch any store function sends carries `ifRevisionId` and a text scan finds no unguarded `.patch(` in `proposalStore.ts`; (a) a late release carrying a foreign nonce leaves the live lease intact; (b) an outcome write after the lease was lost is refused; the write-ahead refused on a short lease; the returned-`rev` chain and the re-proof after an unknown-result write. `applySchedule.test.ts`: (a) the killed-apply sequence end to end (A's late W6 and W7 refused, B's lease intact, a revise `proposal_busy`, one role per service); (b) the loop stopping on a lost lease with an honest report and a re-run reconciling through the receipt. `reviseProposal.test.ts`: (c) a revise racing a claim loses on `ifRevisionId` | a killed apply's late release removing a live successor's lease; a revise committing between two of an apply's writes; an outcome recorded on a revised array its apply never read; a record that claims a revision the drafts do not hold; a new unguarded store write |
| The preflight queue (`cards: []`) | `monthProposalModel.test.ts`: `targetPreflights` against `monthTargetPreflight` over a `serviceCardRefs`-built queue — equal state per target, extra `issue_*` reasons only on a target its role already blocks; the parity harness builds the browser's queue the same way (step 8) | a connector target whose state differs from `/admin`'s preflight; a target the browser would post that the connector refuses, or the reverse |
| Per-service refusal copy | `applySchedule.test.ts`: an occupied target (both arms) reads «Ya existe un servicio en esta fecha para este tipo.», never «duplicados»; `idempotency_key_retired` its own wording; `refusals.test.ts` unchanged | a retry told «hay duplicados» about its own occupied target; a whole-call refusal inside a per-service line |
| After the loop | `applySchedule.test.ts`: a throw in the warnings or in `releaseApplyLease` after creates landed | a landed month reported with the `domain` («no se pudo confirmar») copy |
| The record's limits | `proposalDocument.test.ts`: January 2027 with 10 specials round-trips; a 21st service or a 13th member is refused before any write; `membersPerCell` = 4 × the largest `buildRows()` target; a year outside 2024–2035 reads `malformed`; `reviseProposal.test.ts` (R14); `solveMonth.test.ts` (M24) | a valid solve or revise storing a record that later reads `malformed` |
| The sweep | `proposalStore.test.ts`: guarded delete per record; a lease claimed after the sweep's read keeps its record | an apply's record deleted under its lease |
| The solver deadline | `solveMonth.test.ts`: reads past 150 s ⇒ no call, the abort exit | a `RangeError` from a negative `AbortSignal.timeout`, i.e. a `pre` failure where the fills should have run |
| The history ceiling (M12) | `solveMonth.test.ts`: a history read settling after 20 000 ms ⇒ no solver call, `DERIVED_HISTORY_AUTO_REFUSAL`, fills, a partial proposal; at 19 999 ms ⇒ solved | a connector that waits longer than `/admin` on a slow history, or solves where Auto would refuse |
| E1 | the runners' tests: no Sanity text, no stack | internals leaked |
| DV1 / P4-R12 | the smoke's unit test: the seven non-callable names refused | a dev call that writes the production dataset or calls the production GCF |
| TZ | `plannerNeutralTz.test.ts`; the model under `TZ=UTC` and `America/Mexico_City` | a UTC day-flip on Vercel |
| Fluid | `moduleStateAudit.test.ts` (the pinned table equals the scanner's hit set; the in-place mutation class pinned empty; the declared blind spot reviewed per release); `fluidCeiling.test.ts` (`vercel.json`'s keys exactly `ignoreCommand`/`crons`/`fluid`, no `functions`; the exact map of `maxDuration` declarations; above 60 only on an ADR-0013 allowance line and with Fluid — under AS1's Fluid fallback, ADR-0013's dated marker line and no `fluid` key instead; the Default Max Duration's record line); **the effective limits observed at deploy** — (O-a) the deployment's `config.functionType`/`functionTimeout` and the project's `resourceConfig.functionDefaultTimeout`, on Release A's preview (step 1), Release B's (step 12.3) and each production deployment, an unreadable reading stopping the release — and (P), a real `/api/admin/solve` call past 10 s on Release A's Fluid preview, repeated within Release A until conclusive (step 1); the pre-Fluid usage baseline recorded before the preview merge; Release A's soak: usage against the baseline, the flush workflow's durable runs, runtime-log samples | shared state no one reviewed; a table row the scanner does not emit, or a hit nobody pinned; a ceiling above 60 without Fluid; **an undeclared route or page running under Fluid's 300 s default**; a declared route cut to 10 s (a dropped declaration, or a dashboard default that out-ranked the code); a dashboard default raised or reset unseen; a usage rise with no reference to read it against; mail lost or failed under the shared pool |
| Live | steps 13 and 14 | audience, count, seats or delivery differing from the plan |

## Rollout, observability, and rollback

- **Release sequence:** Release A (step 1) → soak ≥ 48 h → Release B (step 12) once P2 D2's
  production alias verification is on record (merged as `98aa67a9`) → live proof (step 13) → INT
  (step 14). Preview first, always.
- **Signals, by how long they last:** durable — the flush workflow's runs on GitHub (their
  annotations and printed report, step 1 Change 2), the deploy observations (step 1, step 12.3) and
  the tool outputs, copied to the evidence file; the Vercel usage page, read against the pre-Fluid
  baseline (step 1); `list_services`/`get_service` for M; Frank's inbox. **About an hour on Hobby**
  (`docs/NOTIFICATIONS.md:528-529`) — the `[mcp]` and `[mcp-plan]` lines and every other runtime log
  line (`vercel logs --json`), so each is read within the hour of the call it describes and copied
  out at once (step 13), or recorded as missing.
- **Stop conditions:** Release A's (step 1), the live proof's (step 13), any `5xx` from `/api/mcp`.
- **Rollback, tools only:** one commit removes the three tool modules, their registration lines, the
  `applySchedule` caller-pin row and the tool-list and smoke expectations. `roleCreateCommit` keeps
  its registry entry (ADR-0043), so the audit stays green; the extractions, the store module and its
  schema may stay; `maxDuration = 180` may stay (Fluid remains; it is the declaration map's pinned
  value, and `fluidCeiling.test.ts` changes only if it does). Leftover `mcpProposal` records are private
  and expire; if they must go sooner, a guarded one-off script (dry run by default, `--apply`,
  `writeClient`, only `mcpProposal.*` ids) is written then — not now.
- **Rollback, Fluid:** a PR removing `"fluid": true` that also lowers `/api/mcp` to 60 (its pinned
  value in the declaration map, its ADR-0013 allowance line deleted, and the test's `vercel.json`
  keys back to `ignoreCommand`, `crons`), which `fluidCeiling.test.ts` enforces; with 60 s,
  `solve_month`'s worst case no longer fits, so the tools go first (the rollback above), then Fluid.
  The Default Max Duration goes back to its pre-release state before that PR reaches `main` (an
  explicit 10 was proved by (P) under Fluid only, and without Fluid it buys nothing), with the
  record line and the test's fourth assertion amended in the same PR (step 1's «Rollback»;
  post-approval change 7). Under AS1's Fluid fallback (step 1) this is not a single PR
  but a Frank action in order: the tools' rollback, then a PR lowering `/api/mcp` to 60 and deleting
  ADR-0013's allowance and marker lines, merged and verified, then Frank turns Fluid off in Settings → Functions
  and returns the Default Max Duration to its pre-release state in the same visit.
- **P2 coupling (roadmap H4):** rolling P2's cutover back after Release B requires withdrawing
  `solve_month` in the same change, or the connector and `/admin` solve against different histories.
  M23 makes that automatic: the rollback flips `SOLVER_HISTORY_SOURCE` to `"local"`, and in the same
  bundle `solve_month` refuses `history_source_not_derived` (D22). `revise_proposal` and
  `apply_schedule` keep working on proposals already solved; D16's tradeoff (the browser's local
  history misses connector-applied months) is unchanged.
- **Emergency:** `MCP_DISABLED=1` and a redeploy shut every MCP and OAuth route.
- **Full rollback** (only if an extraction proves wrong): revert Release B's PR, which restores the
  route's registry entry in the same revert.
- **Restoration check:** `tools/list` shows the 12 P3 tools; `/admin` Generar mes, Auto and «Crear»
  work on the dev alias; `roleWriteRoutes.test.ts` green.

## Decisions

### Coordinator rulings (binding; carried in substance)

| # | Ruling | Where it lands |
|---|---|---|
| P4-R1 | **Gating on P2 D2:** P4's RELEASE requires P2 D2 released; implementation may proceed | step 0, step 12; D2 merged to `main` `98aa67a9` and released 2026-09-28 (production alias verified, `dpl_3TFsEhFDhapfCaCW6xTHZJDjuspz`); enforced at runtime too (M23, D22) |
| P4-R2 | **Fluid compute is P4's FIRST step**, as `vercel.json` `"fluid": true`, preview first, after an audit of module-level mutable state for concurrent-invocation safety and an ADR-0013 amendment; then `/api/mcp` gets `maxDuration` ≤ 300 as the plan sets it; existing routes keep 60 | step 1; D2 (180) |
| P4-R3 | **The GCF call** is the browser's request and response handling (no seed, knobs or pins); a server-side safety abort at ~120 s (the GCF's own `--timeout`); on abort or failure the local fills still run and a partial proposal is returned, as Auto does | steps 4, 8; D6 |
| P4-R4 | **Extractions** into neutral modules outside `app/mcp`: `savedWindowFor`/`getDates`, `refuseSpecialOn` and its calendar helpers, `withUpdatedCell`, `callRemoteSolver`, the solver-config loader, and `roleCreateCommit` (critical tier) | steps 3–5, widened by F4 (D3) |
| P4-R5 | **Reads:** an additive range builder in `serviceReadQueries.ts` mirroring the admin roles GET (published perspective, `[defined(@->)]`, `coalesce(week, date)`) for the 56-day window and occupancy; a new solver-pool member builder equal to `/api/admin/members` with `all = true`, `order(member_name asc)` included; the STORED rule set only, absent ⇒ defaults, its `rev` bound (null bound as absent) | steps 4, 6 |
| P4-R6 | **Binding = a short id plus a server-stored proposal** (Frank): a hidden `mcpProposal.<random>` type, Studio schema like the OAuth documents, written only through an allowlisted writer, 7-day expiry; the spec is amended — `solve_month`/`revise_proposal` write ONLY this private ephemeral record, never domain data, declared non-read-only and non-destructive; `apply_schedule` stays destructive; expired records refused on use and swept; recorded as a post-approval spec change | step 7; § «Spec amendment» |
| P4-R7 | **Expiry 7 days** (Frank). Eligibility NOT re-checked at apply beyond the create route; the apply report lists any seat whose member lost their Tipo or became disabled since the solve, as a warning | steps 7, 10 |
| P4-R8 | **Idempotency:** `creationRequestId` minted per service at solve; `revise_proposal` keeps it for unchanged services and mints a new one for changed services; the record stores per service the applied revision and the created role id, so a retry is idempotent and apply reports the revision it applied | steps 7, 9, 10 |
| P4-R9 | **Revise:** place judged by `rankCandidates` over the proposal state — refuse wrong Tipo, a same-category double, a hard rule, already-in-cell, a column not created; warn «No disp.», «Sin declarar», «Ya asignado»; clear always allowed; exchange removes both first, then judges each placement against that state, refusing if either fails; judged against CURRENT members and the bound rule revision (changed rules ⇒ refuse, re-solve); unfilled recomputed with the solve's builders, declared new behaviour | steps 6, 9; refined by D10, D11; the Tipo refusal shares one code with an id the ranking lacks for any reason (R1, I5); a per-cell cap (R14) |
| P4-R10 | **Apply:** weekends chronologically, then specials; occupancy re-checked per service at write time; skip-and-report per service (a declared difference from the batch abort); a time budget stops STARTING creates at ~240 s, the rest «no intentado», a re-run finishes | step 10; the cut-off re-derived as 130 s (D7) |
| P4-R11 | **I15 for apply:** sources ready (a failed read refuses the whole apply); an integrity-queue issue on the target refuses that service (mirror); a nameless special is refused at solve; E19 mirrored; `refuseSpecialOn` mirrored at solve; the batch abort a declared difference | gate rows A1, A5, M6, A7, M7, A6 |
| P4-R12 | **Dev smoke:** lists the three new tools and calls NONE | step 11 |
| P4-R13 | **Report extras:** `objective_skipped` (declared addition); the solver's unmatched names and the rule-name misses, separate and labelled; unaddressable Saturdays; E13 violations and same-category doubles as warnings; unavailability notices | step 8 (M17–M21); the notices over the worship audience only (M17, I5, D21) |
| P4-R14 | **The re-cap is the dashboard alone, and no agent step writes the environment to disk:** no `vercel.json` `functions` glob — Release A's `vercel.json` gains only `"fluid": true`; every function without a declared `maxDuration`, routes and pages, is re-capped by the project's Default Max Duration = 10 (Frank sets it; the agent reads it back); the observation is the deployment and project API only (`config.functionType === "fluid"`, `config.functionTimeout === 10`, `resourceConfig.functionDefaultTimeout === 10`), an unreadable one stopping the release; code > dashboard is cited from the dev measurement and re-proved under Fluid by a real call past 10 s on a declared route, never a probe route; `fluidCeiling.test.ts` pins `vercel.json`'s keys, the declaration map (above 60 only where ADR-0013 allows it) and the setting's record line | step 1 (Change 1, (O-a), (P), «If AS1 fails»); D24; AS1, AS9 |

### This plan's decisions

| # | Decision | Choice | Why | Tradeoffs | Owner |
|---|---|---|---|---|---|
| D1 | Release shape | Two releases: Fluid alone first, then the tools | Fluid changes every function's concurrency (its duration only where declared, D24); it should soak on production before anything needs it (P4-R2) | Two review-and-release cycles | this plan |
| D2 | `/api/mcp`'s ceiling | **180 s** | The smallest round value above both bounded worst cases (160 s) with 20 s of margin (§ «The time budget») | The reads and P3 writes also get 180 s; harmless | this plan |
| D3 | Extraction scope | Everything the browser's Auto and its reports run, as verbatim moves (F4), including the fill orchestration `runLocalFills` | Parity by construction: both surfaces call one function instead of two copies a later edit could split | A few more moved lines in client files | this plan |
| D4 | Parity method | groq-js over one dataset for both sides; the real `MonthGenerator` and the real admin routes on the browser side; recorded responses for the proposal | It tests the roadmap's sentence literally: same dataset, same history, same selections | A heavy jsdom test | this plan |
| D5 | Binding mechanism | A stored record (P4-R6), no signature, no new secret | Tamper-evidence comes from storage: the model holds a handle, never the proposal. No key to rotate or document (O7) | A dataset write per solve (private, expiring) | Frank / P4-R6 |
| D6 | Solver timing | Abort at `min(120 s, 150 s − elapsed)`; with `150 s − elapsed ≤ 0` no call at all, the abort exit (fills, partial proposal) | P4-R3's cap, bounded by the ceiling. The browser's call is cut at 60 s by its route (F10), so the connector is never less patient. `AbortSignal.timeout` rejects a negative delay, so an unclamped value would turn slow reads into a `pre` failure with no fills | A cold GCF past 120 s yields a partial proposal (the browser already fails at 60 s) | P4-R3 / this plan |
| D7 | Apply cut-off | Start no create after **130 s** | Re-derived from D2 and the measured create cost (§ «The time budget»); P4-R10's 240 s predates both | A pathological month finishes on a re-run | this plan (refines P4-R10) |
| D8 | Sweep | Opportunistic, ≤ 25 per `solve_month`, plus refusal on use; each delete guarded by an `ifRevisionId` patch in its own transaction | Records are minted only by `solve_month` and refused on use once expired, so a cron would buy nothing a sweep on solve does not; it would add a schedule and a second entry point into the store (a `CRON_SECRET` route), which is otherwise written only through the three tools (post-approval change 8). The guard keeps a record whose lease was claimed after the sweep read it (an apply that passed its expiry check just before expiry) | Up to 7 days + one solve of inert records; one round trip per deleted record | this plan |
| D9 | Apply exclusion | A lease on the record (`until = now + 210 s`), claimed under `ifRevisionId` | Serializes apply against revise and a second apply on the record's own revision; outlives the ceiling, so it never needs releasing to be safe | A killed apply blocks the proposal ≤ 210 s; the `proposal_busy` refusal therefore names the seconds left and tells the model to wait and call again, never to re-solve (a new proposal would not see this lease and would race the in-flight apply, step 7). **Exclusivity is enforced on every write, not assumed** (step 7's write/guard table, W1–W7): the claim and a revise's commit assert the revision of the read that saw no live lease, and every apply-side write — write-ahead, outcome, release — is a patch under `ifRevisionId` of a read that showed that apply's own nonce, so a killed invocation whose JavaScript keeps running can never remove a successor's lease or overwrite its states: its late writes are refused once anyone else has written, and the apply that loses its lease stops and reports what it posted. The earlier premise, "while the lease is held nobody else writes the record", is rejected because a late release broke it (a revise could then commit between two of a successor's writes) | this plan |
| D10 | Unfilled after a revise | Recompute only the edited cells, by the owning builder's seat rule | A full recompute would change untouched columns' figures (an unaddressable Saturday's voices, a cell whose solver name resolved to nobody), which the solve never reported | The recompute is new behaviour (P4-R9 declares it) | this plan (refines P4-R9) |
| D11 | Exchange judgement | Sequential: both removed, then `a` into `b`'s seat, then `b` into `a`'s seat against the state including the first placement | An independent judge of the second placement would miss a pair rule the first completes | Order is fixed (a, then b) and documented | this plan (refines P4-R9) |
| D12 | Apply eligibility and report | **Two tables, one module** (step 6b). Table X (the action) is `isDraftCreatable`'s three refusals with the record for `createdTargets`, plus "an `unknown` service on an occupied target is re-posted and the receipt decides" (X3) and A7's re-check (X5); it never reads `atSolve`, so the post set is the browser's. Table O (the report) maps each finding and the service's stored solve-time state (`atSolve`) to a label and a weight — success, neutral or failure — and `complete` is "no failure cell" | The server cannot import a client export (ADR-0028); a test pins post / no-post agreement with `isDraftCreatable` itself on every cell but X3 and X5; the `unknown` branch resolves a lost result safely because the route refuses any occupant but our own receipt. The report reads `atSolve` because two review findings were one defect class — classifying from apply-time state alone reported a created-then-deleted draft as «ya creado», and a date taken since the proposal like one that was already taken then, as success; one exhaustive table closes the class instead of patching its cases (I9). For the same reason a `created` service is «ya creado» only while its recorded role still holds the service's own identity (date, and a special's name): a role moved or renamed inside the read's range is X1b, «creado y luego modificado en /admin», a failure; and a `200` replay is «creado (confirmado por su recibo)» only at that identity, because the receipt proves the create landed, not where its role sits now (X10b otherwise, the same failure) | One connector-only branch, a connector-only report, and one stored field per service | this plan |
| D13 | The handle | 26 lowercase Crockford base32 characters (128 bits), validated before any read | "Short" against a 12–20 KB JWS, unguessable, easy for a model to copy | — | Frank (short id) / this plan |
| D14 | Annotations | `solve_month`/`revise_proposal` `{ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }`; `apply_schedule` P3's write annotations | P4-R6; the GCF is the app's own function | claude.ai may not prompt before a solve (it writes no domain data) | P4-R6 |
| D15 | Report additions | The solver's `error` and every diagnostic field verbatim; the two unmatched-name lists apart | Spec `:219`, `:253`; P4-R13 | The connector shows more than `/admin` | P4-R13 |
| D16 | The browser-history write | None | The connector has no `localStorage`; under P2 D2 the next solve derives from the created services | P2's rollback target misses connector-applied months (H4 already requires withdrawing `solve_month` on a rollback; M23 does it by itself) | this plan |
| D17 | A lost response | No proposal read tool; a re-solve mints a new proposal | The spec's surface is three tools; the orphan is inert and expires | Frank may wait for a second solve | this plan |
| D18 | Addressing in `revise_proposal` | A service by its `date` (E3), a seat by its row id, a member by id | Unambiguous inside one proposal; no names | — | this plan |
| D19 | The spike | `/admin` on dev, no code; S3 by Frank (Q1) | Dev already reaches the production GCF through `/admin`; no temporary route, secret or spike deploy | S3 is a production-dataset write by Frank (drafts, silent, deleted) | this plan / Frank |
| D20 | Apply's record of a create | A write-ahead `unknown` before each create, the outcome after; no post when the write-ahead fails | Without it a kill between a create and its outcome leaves no trace, R10 lets the service be revised, and only the route's occupancy stops a second service. With it, "a create may have started" is always on the record | One more record write per create (≈ 0.2–0.3 s each) | this plan |
| D21 | I5 on the pool's reports | The pool stays `{ all: true }` (the request equals a super-admin's browser); every pool-derived member list not tied to a seat — today only the unavailability notices — goes through `worshipAudience` (`normalizeMinistries(…).includes("worship")`); a revise refusal for an id the ranking lacks is one payload whatever the cause. **Where the TypeScript reader and `WORSHIP_AUDIENCE_GROQ_FILTER` disagree** — a `ministries` holding only unknown values, or not an array: TypeScript reads worship, the GROQ excludes — **the filter follows the TypeScript reader** | Spec I5 forbids a listing read to name a kids-only member even for a super-admin, and exempts only the pool as input and seated people; the browser's notices do list them (F17). On the junk case: `normalizeMinistries` is documented as THE one definition, with the GROQ filter as its counterpart (`app/ministries.ts:28-44,46-75`); the session token and the 30 s access gate read it (`auth.ts:203`, `memberAccess.ts:62`), so such a member signs in to the worship app and is not kids-only in any sense I5 protects; and the super-admin's browser lists them too, so following the GROQ would add a parity difference to hide a worship member. The gap is pre-existing and only a raw write opens it: both member routes validate with `validateMinistryWrite` (`members/route.ts:69`, `members/[id]/route.ts:95`; `app/ministries.ts:100-109`) and the Studio field offers only the two ids (`sanity/schemas/worshipTeam.ts:57-70`). Closing it (in the GROQ, the notification audience that uses it, or the data) is outside P4 | The connector's «no disponibles» differs from a super-admin's `/admin` by the kids-only members (declared, asserted in parity); Frank is not told whether a refused id is unknown or lacks the Tipo; the junk-only divergence between the two readers is pinned, not fixed (step 4c) | spec I5 / this plan |
| D22 | P2 D2 as a control | `solve_month` refuses at runtime while `SOLVER_HISTORY_SOURCE !== "derived"` (M23), besides the step-12 process gate | A process gate can be skipped or reversed later (a P2 rollback); the constant is deployment-wide by construction, so the refusal holds in exactly the bundles where `/admin` would solve against another history | None in production once D2 is live; a rollback of P2 disables `solve_month` until the connector is withdrawn or P2 returns | P4-R1 / this plan |
| D23 | Create body shape | The tool passes `createBodyFor(draft)` = `JSON.parse(JSON.stringify(draftCreateBody(draft, false)))` | The receipt fingerprints the raw body (F7; `payloadFingerprint(input.payload)`, `roleCreationReceipt.ts:272`) and the parse reads it as given; the route's body is always what `req.json()` returns. Normalising makes the tool's input the route's input by construction, instead of resting on every consumer's tolerance of an `undefined`-valued key or a non-plain value, and lets the twin run compare the two with `toStrictEqual` | One serialization per create (negligible) | this plan |
| D24 | Undeclared functions under Fluid | **Re-cap at the legacy 10 s by one mechanism**: the project's Default Max Duration = 10 (Settings → Functions; set by Frank, read back by the agent, recorded), for route handlers and pages alike; **no `vercel.json` `functions` glob** (P4-R14). The effective limits **observed** at every release's preview deployment through the deployment and project API ((O-a), step 1), an unreadable reading stopping the release, and code's precedence over the dashboard proven under Fluid by a real call past 10 s on a declared route ((P), Release A, repeated until conclusive). Fluid then changes the duration only of a function that declares one | Accepting Fluid's 300 s default would move 44 routes and every page to a 30× runaway window, and the only watch for it — per-path request durations — does not exist on Hobby (no duration in the runtime logs, Observability 404, about an hour of retention; F2), so an accepted-and-watched 300 s would have been an unwatched one. The dashboard default sits below function code in Vercel's order, so the declared routes keep their values — already evidenced here before Fluid (the Platform evidence row). A glob would sit above the dashboard and carry AS9's risk (a glob out-ranking `/api/admin/solve`'s own 60 would cut it to 10 s), and its per-function effect could not be observed without writing the preview environment to disk, which the project's secrets rule forbids | A project setting outside git, with no versioned half (recorded in ADR-0013 and `docs/CI.md`, pinned as a record by `fluidCeiling.test.ts`, re-read at every release by (O-a)); no per-function reading — the undeclared functions' 10 is the deployment's default, and the declared values rest on (P) and the pinned map; a route or page that legitimately needs more than 10 s must declare it in code, as the 17 already do | coordinator rulings (option b; P4-R14) / this plan |

## Assumptions

Assumption ids are `AS#`, so they never collide with the apply gate rows `A#`.

| Assumption | Impact if false | Validation point | Failure response |
|---|---|---|---|
| AS1: Release A's `vercel.json` (`"fluid": true`, its one new key) builds on Hobby and enables Fluid per deployment with a 300 s maximum, and the Default Max Duration re-caps every function that declares no `maxDuration` | (i) the ceiling stays 60 s and `solve_month`'s worst case does not fit; (ii) a rejected `vercel.json` fails the build (the preview deployment `ERROR`; the dev alias keeps its previous deployment, `main` untouched, but `preview` carries an unbuildable file); (iii) a declared route cut to 10 s (AS9 false); (iv) an undeclared function left at Fluid's 300 s | Release A's verify step: the build's own state, (O-a) and (P) (step 1) | Step 1's «If AS1 fails», per arm: **(i)** Frank enables Fluid in Settings → Functions (his decision), or the tools wait; if he does, the **Fluid fallback** applies in the same branch — `"fluid": true` leaves `vercel.json`; `fluidCeiling.test.ts` pins the keys `ignoreCommand`, `crons` and ADR-0013's dated marker line instead of a field that does nothing, and the deploy observations read the real setting; the `CLAUDE.md`/`AGENTS.md` line names Settings → Functions and the date and says the setting is not in git; the ADR-0013 amendment records where it lives and the rollback order (a PR lowering every ceiling above 60 first, then Frank's dashboard toggle). **(ii):** a fix removing the `fluid` key is pushed to `preview` at once; Fluid then goes through (i). **(iii):** the release stops, `"fluid": true` is removed on `preview` at once, and Frank decides (AS9). **(iv):** Frank re-sets the Default Max Duration to 10 and the preview is rebuilt and observed again; if it cannot be made to read 10, the release stops |
| AS2: the GCF is ≤ 60 s cold and ≈ 7–15 s warm | the 120 s cap binds more often (partial proposals) | step 2 (S1, S2) | escalate with the numbers (step 2's stop conditions) |
| AS3: a create costs ≈ 1–2.5 s | the 130 s cut-off binds | step 2 (S3) or L4 | re-derive; the pre-authorised option is 300 s with the same arithmetic |
| AS4: Sanity is read-your-writes for the record (default `visibility: "sync"`) | a revise reads a stale revision | store tests; L2a → L3 | the `ifRevisionId` guards refuse rather than corrupt |
| AS5: groq-js evaluates the routes' GROQ as Sanity does | the dataset parity proves less than it claims | the existing precedent (`adminMemberVisibility.test.ts`) | fall back to text pins plus the pipeline parity |
| AS6: Node's ICU (Node 22, full ICU) and Chrome's agree on `localeCompare(…, "es")` and on `toLocaleDateString("es-MX", …)` — the fills' tie order and the refusal copy M7 reports (`longDate`, «12 de agosto»). **Not assumed, declared:** `buildUnavailabilityNotices` sorts names with a locale-less `a.name.localeCompare(b.name)` (`MonthGenerator.tsx:404`), so it collates by the runtime's default locale — the Vercel function's in the connector, the browser's (es-MX for the team) in `/admin` — and accented names in `warnings.unavailable` may order differently between the two | a tie between equal-load candidates breaks differently; a refusal's date reads differently from `/admin`'s composer; `warnings.unavailable` lists the same entries in another order (report order only: no seat, request or write reads it) | the TZ/locale test pins Node's output; at L1 Frank reads the refused special's text against the composer's notice for the same date in `/admin` (preview only); the parity harness runs both sides in one Node process, so it compares the notices' entries, not a cross-runtime order | report it; parity is then "equal up to tie order" and the copy is Node's; the notices' order is never corrected (the extracted function is moved verbatim) |
| AS7: claude.ai waits for a tool result at least as long as a typical solve and apply (its client timeout is not documented). Kept declared. P3's `completeResponse` (§ «Preserved invariants») buffers the whole SSE response, so claude.ai receives nothing until the tool has finished: its wait covers the call's whole server time | the model never receives a result the server completed | L1 and L4 record the observed behaviour **explicitly as this assumption's validation** — received or not, as the Claude app shows it, beside the server `ms` — never inferred from the server side (post-approval change 9) | a lost solve costs a re-solve (D17); a lost apply is re-run and replays; escalate if typical calls are lost |
| AS8: Fluid usage stays within Hobby's allowances | functions are limited until the cycle resets | Release A's soak, projected against the pre-Fluid usage baseline recorded before the preview merge (step 1) | revert Fluid (step 1) and escalate |
| AS9: function code out-ranks the dashboard — Vercel's documented order, function code > `vercel.json` > dashboard > Fluid defaults («Fluid compute» → «Order of settings precedence») — for this Next.js 16 build under Fluid: a route's `export const maxDuration` keeps its value under a Default Max Duration of 10. **Already evidenced here before Fluid:** on dev on 2026-09-28 `/api/admin/solve` (`maxDuration = 60`) answered 200 after 10 279 ms under the 10 s default (evidence.md «Measured on dev»; browser timing, network included, so a close reading), and on 2026-08-06 every flush run died at its declared 60 s, not at 10 (`docs/NOTIFICATIONS.md:900-902`) | (iii) a declared route (`/api/admin/solve`, a flush sweep, later `/api/mcp`) cut to 10 s | (P) on Release A's Fluid preview: `/api/admin/solve` answering 200 with a time to first byte ≥ 11 000 ms, repeated within Release A until conclusive, never deferred to Release B (step 1); L1's server `ms` for `/api/mcp` (step 13) | AS1's arm (iii) (step 1): the release stops, Fluid is removed on `preview` at once, and Frank decides; no glob is added (it would sit above the dashboard and carry the same risk, P4-R14) |

## Open questions

| Question | Why it matters | Recommendation and why | Tradeoffs | Owner | Blocking? | Resolution point | Bounded default |
|---|---|---|---|---|---|---|---|
| Q1: measure per-create time early (S3: Frank creates and deletes a throwaway month's drafts on dev), or only at L4? | the apply cut-off rests on it | **early**: the coordinator's narrowed spike asks for it, and drafts notify nobody | a production-dataset write by Frank, inert leftovers | Frank | No | **answered 2026-09-28: early (S3)** | early (S3) |
| Q2: the throwaway month | L1–L7 need a month with no services | the first month from **2027-03** on with no services (S3 takes the next one) | drafts visible in `/admin` for the length of the proof | Frank | No | **answered 2026-09-28: as recommended** | as recommended |
| Q3: when INT runs | the roadmap's last acceptance | the first real month Frank plans after L7 | none | Frank | No | after step 13 | as recommended |
| Q4: **a narrowing of the roadmap's rollback, for Frank to see** — the roadmap's P4 row promises the first live run's leftovers (idempotency receipts and coordinators) are «cleaned by a guarded script»; this plan leaves them (retired receipts, vacated weekend target locks, the shared special coordinator) and writes no script | the roadmap is an approved contract; a plan may not quietly promise less than it | **leave them** (§ «Data and failure safety», «Data preservation and rollback»): a retired receipt is what refuses re-using a deleted draft's key, a vacated lock is what the next create reclaims, the coordinator serves every special; each is inert. The declared script (retired receipts only, dry run, `--apply`) remains available on request | a few inert documents stay in the dataset; no cleanup runs | Frank | No for review and implementation; **yes for step 12** (the roadmap amendment is recorded then) | Frank, surfaced by the coordinator before step 12 | leave them; the roadmap amendment records Frank's acknowledgement, or the declared script is written and run under the consent rule |

## Spec amendment (post-approval, un-reviewed — to be recorded in the spec review log)

Frank's P4 decision (P4-R6) and F1/F2 change these clauses of
[`2026-09-22-owt-mcp-design-v2.md`](../specs/2026-09-22-owt-mcp-design-v2.md). Step 11 applies them
and lists them under «Post-approval changes — un-reviewed» in
`2026-09-22-owt-mcp-design-v2-review-log.md`. None loosens a guard; each replaces a mechanism.

| Spec clause | Today | Amended to |
|---|---|---|
| I14 (`:155`) | "`solve_month` and `revise_proposal` write nothing to the dataset and are declared read-only" | "`solve_month` and `revise_proposal` write no domain data: each stores only a private, expiring proposal record (`mcpProposal.*`), and they are declared neither read-only nor destructive. `apply_schedule` is destructive." |
| `solve_month` (`:219`), "Writes nothing. Completes inside 60 s (B1)." | — | "Writes no service; stores the proposal as a private record that expires after 7 days. Completes inside `/api/mcp`'s ceiling (180 s under Fluid compute; measured ≈ 10–15 s)." |
| `revise_proposal` (`:220`), "return a newly bound proposal"; "carries a revision number in its binding" | — | "returns the next revision of the same stored proposal; the revision number is the record's. `apply_schedule` requires the current revision and refuses a superseded one, naming the current." (Stricter than "reports which revision it applied", which it also does.) |
| `apply_schedule` (`:221`), "bound by a server-side signature the model cannot forge … if it is a new secret O7 applies" | — | "bound by a server-stored record the model can only name, by an unguessable 128-bit handle scoped to this deployment's origin and principal; the model holds no part of the proposal it could alter, and no signing key exists. Expiry: 7 days." |
| Ledger B1 (`:59`) and Decisions «`run_solver` shape» (`:304`) | "a hard ceiling ADR-0013 says will not move" | "Fluid compute lifts Hobby's ceiling to 300 s for a function that declares it (ADR-0013's amendment; every other function stays at 10 s); the split stands on its own merits, as the row already says" |
| Assumptions, "fits inside 60 s" (`:318`) | — | "validated: ≈ 10–15 s measured on dev (2026-09-28), inside a 180 s ceiling" |
| Decisions «`apply_schedule` input» (`:306`) | "bound by a server-side signature" | "a stored, unexpired proposal named by its handle and current revision" |
| (new, beside O5) | — | "The proposal record holds member ids, dates, row ids, kinds and special names only — what the drafts it describes will hold — plus bookkeeping that names nobody (the bound rules revision, each service's solve-time target state and apply outcome), under a dotted, private id." |
| `apply_schedule` (`:221`), the refused target | "is **not created and is reported**, per service … the rest of the month proceeds" | adds: "Each service's report is judged against what the proposal said about its date (its stored solve-time state) as well as what apply found, from one exhaustive outcome table, and a whole-month success is claimed only when no service is in a failure cell: a date that was free at the proposal and is occupied at apply — the case where the browser aborts the batch — is a failure, never a success; a date already occupied at the proposal is neutral; a service this proposal created and that was later deleted, moved or renamed in `/admin` is a failure and is never re-created." (A report rule, stricter than the clause; nothing is loosened.) |

## Roadmap amendments (post-approval, un-reviewed — to be recorded in the roadmap review log)

- **P4 row, Outputs** (`:115`, "—"): "Fluid compute on (`vercel.json`; or the project dashboard if
  AS1's Fluid fallback was used, step 1), with every function that declares no `maxDuration`
  re-capped at 10 s (the project's Default Max Duration, route handlers and pages alike) and the
  limits observed at each release; `roleCreateCommit`; the `mcpProposal`
  store; the neutral planner modules".
- **P4 row, Rollback:** "Remove the three tools, their registration lines and the `applySchedule`
  caller-pin row in one commit; `roleCreateCommit` keeps its registry entry (ADR-0043), so the audit
  stays green; `mcpProposal` records are private and expire; the extractions and Fluid may stay. No
  signing key exists." (It replaces "…their audit registry entries… a signing key, if any, is retired
  per O7".)
- **P4 row, Rollback — the leftovers of the first live run. A NARROWING OF THE ROADMAP'S
  ROLLBACK, WHICH FRANK MUST SEE (Q4)** — not a mechanism swap like the other amendments: the
  roadmap promised a cleanup, and this plan declines to do it. The coordinator surfaces it to Frank
  before step 12, and the roadmap review log records his acknowledgement beside the amendment.
  The new text: "Drafts removed after the first live run leave their idempotency receipts (retired
  by the delete), their weekend target locks (vacated, not deleted) and the shared special-identity
  coordinator (`specialIdentityCoordinator.global`) behind — inert, and they **stay**: a retired
  receipt is what refuses re-using its key (`idempotency_key_retired`), so deleting it would let a
  stale create request re-create a service Frank deleted; a vacated lock is what the next create on
  that target reclaims, as after any `/admin` delete; and the coordinator is one document every
  special create uses. The guarded script is declared, not written: retired receipts only, never a
  lock or the coordinator, dry run by default, `--apply` under the production-write consent rule —
  written only if Frank asks." It replaces "Drafts removed after the first live run can leave
  idempotency receipts and coordinators behind — inert, and cleaned by a guarded script" (`:115`),
  which the plan contradicts (step 2 S3, L6, § «Data and failure safety»).
- **P4 row, Scope** (`:115`), "A new proposal-signing key, if one is needed, is documented under O7":
  "No signing key: the proposal is a stored record (the spec amendment)".
- **Shared assumption** "Assemble + GCF solve fits in 60 s serverless" (`:203`): "validated by
  measurement (2026-09-28) and superseded by Fluid compute (180 s for `/api/mcp`)".
- **Coverage row `solve_month`** (`:168`), "inside 60 s": "inside `/api/mcp`'s ceiling".
- **Coverage row O7** (`:140`), dependent "P4 (a proposal-signing key, if new)": "none — P4 stores the
  proposal".

## Handoff

- **Supplied to later work:** Fluid on, with its audit and guards, the 10 s re-cap of every
  undeclared function and the deploy observation of the effective limits (a later route that needs
  longer declares it in code and joins the pinned map, and above 60 also takes an ADR-0013
  allowance line); five `*Commit` modules; the
  neutral planner modules (`plannerCalendar`, `plannerMonth`, `plannerCells`, `autoFill`,
  `monthProposalModel`); `runSolve`; the proposal store pattern (a private, expiring, leased record);
  the dataset-level parity harness.
- **Outputs promised:** the full connector surface (roadmap safe ending state), and INT.
- **Adversarial review order:** this plan alone, sequentially; two fresh verdicts on byte-identical
  text; prior findings never exposed; the churn cap binding.
- **Implementation authorization: not granted by this plan.**

## Terminal state

READY_FOR_ADVERSARIAL_REVIEW

The plan is self-contained. Every blocking unknown is resolved or bounded: the ceiling by derivation
from measurement (F1, D2, D7), Fluid's one behavioural risk by analysis with a stop condition read
from a durable record (F3), Fluid's duration change removed by a dashboard re-cap read back at every
deploy, an unreadable reading stopping the release, and code's precedence over it proven by a real
call before production (F2, D24, P4-R14),
the integrity-queue gate by assembly (F5), the binding by Frank's decision (D5), I5 on the pool's
reports by a filter and an audit (F17, M17), and the record's exclusivity by a guard on every write
(step 7's write/guard table). Q1–Q4 have defaults and none blocks review. **Q4 is a declared
narrowing of the roadmap's rollback (no cleanup of the live run's leftovers) that Frank must see
before step 12.** P2 D2 is
released (`main` `98aa67a9`, production alias verified 2026-09-28), which meets Release B's entry
gate on record, and `solve_month` still enforces the cutover at runtime (M23).
