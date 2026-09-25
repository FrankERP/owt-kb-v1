# Implementation Plan: MCP P2 — the solver's fairness history, derived on the server

## Original request

> "Write the P2 implementation plan …: the solver's fairness history derived server-side
> from role documents instead of the browser's `localStorage` (`owt_solver_history_v2`)."
> — the coordinating agent's brief, 2026-09-25, for the roadmap's P2 row, after P1 was
> released (PR #98, `main` `a04edb43`; release docs PR #99, `main` `963cd736`).
>
> The spec it implements was requested by Frank on 2026-09-23 as "haz el plan de P0 y la
> spec de P2" (quoted in the spec).

## Status and contract

- **Document status:** Draft, 2026-09-25. Not implemented. **Risk tier: STANDARD**. The
  roadmap's review handoff says that P2's *spec* is critical, and it is approved, but its
  *implementation plan* is standard and gets **no adversarial plan review**. The pipeline
  is: this plan → Frank's go-ahead → implement → gates → a fresh code review of each
  delivery's diff → release.
- **Accepted requirement source (binding):**
  [`2026-09-23-solver-history-derivation-design.md`](../specs/2026-09-23-solver-history-derivation-design.md),
  requirements R1–R17. It was approved at critical tier in commit `f6f2ed26` (digest
  `a6958d85…`). The twelve post-approval changes listed in its
  [review log](../specs/2026-09-23-solver-history-derivation-design-review-log.md) are
  part of the text this plan follows. The **P2** row and the H1–H4 coverage rows of
  [`2026-09-22-owt-mcp-roadmap.md`](2026-09-22-owt-mcp-roadmap.md) also apply.
- **Primary outcome:** the solver's fairness history comes from one server-side
  derivation over stored role documents. The admin planner uses it after Frank's
  cutover, and P4's `solve_month` will call the same builder later. Every admin and every
  surface then solves against the same history.
- **Preconditions:** the spec is approved (met). The roadmap's `P0/P1 ∥ P2` entry needs
  the v2 spec and the roadmap approved (met). **Frank's go-ahead to implement is not
  given yet.**
- **Safe ending states:** see the delivery table below. Each delivery ends in a safe,
  releasable state. Stopping after Delivery 1 is permanent-safe: the planner behaves
  exactly as today.
- **Implementation authorization: not granted by this plan.**

## Evidence and current behavior

Verified against `963cd736` (branch `claude/mcp-p2-p3-plans`) on 2026-09-25. Every
pointer in the spec and in the evidence file's §"P2" was re-checked. The line numbers
below are current.

| Evidence | Source | Planning implication |
|---|---|---|
| Entry shape `{ key: "YYYY-M", year, month, total_counts, role_counts }` | `app/components/admin/plannerModel.ts:294-300` | The derivation emits exactly this. `plannerModel.ts` is not edited in D1 or D2 |
| `historyForRequest` drops the target's key, sorts by `(year, month)` and keeps the last 3. `buildSolveRequest` applies it internally and sends `{ total_counts, role_counts }` only | `plannerModel.ts:621-631,697-705,828-831` | Three derived entries, oldest first, pass through unchanged, so the solve request shape does not change. A test pins that it is an identity on derived entries |
| Counting: `HISTORY_ROLE_KEYS` maps Sunday to `Sun.Lead/Sun.BGV/Sun.Choir` and Saturday to `Sat.Lead/Sat.BGV`, with no Saturday Chorus and nothing for specials. `historyEntryFromDrafts` sums totals, omits zero-seat people, returns `null` on empty input and keys by `memberIdToName` | `plannerModel.ts:1205-1212,1254-1282,581-583` | The rules are kept (R6). **`memberIdToName` falls back to the raw id**, but R7 drops and reports a dangling seat, so the derivation must not reuse that fallback |
| Storage: `HISTORY_KEY = "owt_solver_history_v2"`, `MAX_HISTORY = 6`, read once at mount | `app/components/admin/MonthGenerator.tsx:306-307,1885-1888` | This read runs only in local mode |
| `saveHistoryEntry` writes **from in-memory state** (`setSolverHistory(prev => …)`) and `removeHistoryEntry` is the chip's × | `MonthGenerator.tsx:1891-1909` | After cutover that state holds derived entries. R15's dual-write must build from `localStorage`'s own contents, so it needs a new helper |
| History is written only in `handleConfirm`, from the union of this dialog session's created weekend drafts. Specials are filtered out | `MonthGenerator.tsx:3202,3311-3348`; `createdTargets` `:1700` | Defect (a) is confirmed. At cutover this write becomes the dual-write |
| `handleAuto` builds the request from the `solverHistory` state, then POSTs `/api/admin/solve`. Every refusal or failure exit still runs `applySpecialFill` (E5) | `MonthGenerator.tsx:3097-3199` | Solve-time fetch goes here (R14). A failed history read is a new pre-flight refusal and keeps E5 |
| Display: the «Historial (N)» block shows «— últimas N ejecuciones usadas» and has × chips. `LeadPoolHistoryPanel` is mounted in the config step and in the grid. The panel shows «Sin historial guardado para ese mes…». `PlannerGrid` shows «Historial usado: N» | `MonthGenerator.tsx:1493-1499,1516-1537,3494-3499,3773-3781`; `LeadPoolHistoryPanel.tsx:16-19`; `PlannerGrid.tsx:2080-2081` | After cutover all three change copy (R4), and the chips become read-only (R14) |
| `priorMonthLeadVisibility` reads the prior calendar month's entry by key | `app/components/admin/leadPoolHistory.ts:78-110` | Derived history always contains that month. «No entry» turns into «month with no weekend services» |
| Month switching exists only in the config step (`Select` for the month, `YearInput` for the year). The grid is fixed to one month | `MonthGenerator.tsx:3423-3429` | R14's race test: switch the month while the display fetch is pending, preview, then Auto |
| Stored-mode «+ Nuevo servicio» POSTs `draftCreateBody(…, false)` with **all five seat arrays empty**. The month create posts `published: publish` (true or false) | `MonthGenerator.tsx:2671-2684,3262-3264`; `app/utils/monthDraftCreate.ts:65-84` | This is R11 rule 4's "empty-seat payload" signature. The creation-time `published` value varies, so the check covers both values |
| **The fingerprint hashes `published`** (`published: doc.published === true`), plus type, date, name, time, format and all five seat kinds as sorted multisets | `app/utils/roleCreationReceipt.ts:137-200,224-226` | A draft that was later published mismatches on the flag alone. "Unchanged" means the rebuilt payload reproduces the stamp under `published` true **or** false |
| Stored role: `buildRoleDocument` writes `week`/`date`, the seats as `Lead[]{_ref}` / `instruments[]{instrument, person._ref}` / `foh_team[]{role, person._ref}`, plus `published`, `creationReceiptId` and `creationFingerprint` | `app/utils/roleWriteRequest.ts:156-175,203-230,283-316` | The rebuild maps those fields back into a `draftCreateBody`-shaped payload. R12 and the positive control share that path |
| The receipt document has `createdAt`, `updatedAt`, `state ∈ {committed, role_deleted}` and an immutable `targetIdentity` (`sunday_role:YYYY-MM-DD`). **`ROLE_CREATION_RECEIPT_PROJECTION` projects no `createdAt`/`updatedAt`** | `roleCreationReceipt.ts:28-30,238-283`; `app/utils/serviceReadQueries.ts:228-230` | The rule 4 session grouping needs `createdAt`. A **new** projection is added; the existing one is imported by `roleWriteOps.ts:34-35` and stays byte-identical |
| `ROLE_PROJECTION` carries `published`, `week`, `date`, all five seats with `_ref`, `creationReceiptId` and `creationFingerprint`. There is no month-scoped role query and no all-receipts query. `canonicalRolesByIdsQuery` and `canonicalMembersByIdsQuery` exist | `serviceReadQueries.ts:17-26,85-90,160-165` | Three additive builders are needed (step 2) |
| `serviceReadQueries.ts` has 14 non-test importers, eight on write paths (e.g. `roleWriteOps.ts`, `publishReadyBundle.ts`, `serviceWriteTargets.ts`) | `git grep` | Its changes are **additions only**. Existing exports and tests stay unchanged |
| Draft gating scans GROQ `*[…]` groups and template-literal bare predicates under `app/`, never plain TS comparisons. The exemptions are `api/admin` and `utils/serviceReadQueries.ts` | `app/utils/__tests__/draftGatingCoverage.test.ts:96-104,150-200` | All GROQ lives in `serviceReadQueries.ts`. The new modules hold no GROQ. There is no `MAY_SEE_DRAFTS` change (R9) |
| The audit scans only files that import a Sanity client. A `serviceReadQueries` builder run on `operationalClient` is canonical and needs no registry entry. `roleCreationReceipt` is not a protected type | `app/utils/protectedReadAudit.ts:21-30,73-75,782-785` | The builder imports `operationalClient` directly, with no registry entry (R9). The diff CLI imports no client, so it produces no audit site at all |
| `operationalClient` is `server-only`, uses the published perspective and the read token. The role writer already reads receipts through it | `sanity/lib/operationalClient.ts:1-23`; `app/utils/roleWriteOps.ts:117-119,183-190` | Receipts (dotted ids) are readable on this client in production |
| Admin guard: `requireActiveManager`, and content-editor gets `403` | `app/api/admin/solver-config/route.ts:58-64`; `app/api/admin/solve/route.ts:120-128` | The new route copies `solver-config`'s `gate()` |
| The solve route forwards the body unchanged, `seed` included, to GCF or to a local `gcf/owt_solver_v2.py --json-mode` (default interpreter: the `owt-roles` conda env). It performs no Sanity read | `app/api/admin/solve/route.ts:10-25,78-92,142-145` | The R11 solve runs need no `gcf/**` change. The local env has `ortools-9.15.6755`, the `gcf/requirements.txt` pin (checked 2026-09-25, not run) |
| ADR-0038: history offsets alone can push a month past CP-SAT's ceiling, and the month then runs with `objective_skipped: true`. The follow-on is **issue #94**, OPEN, "Solver: the fairness objective is skipped in most real months, so history has no effect" | `docs/adr/0038-*.md:59-66,125-128`; `gh issue view 94` | #94 is out of scope (Frank, 2026-09-23). The spec review log's "suggested, not done" issue now exists |
| Pinned per-browser behaviour: a test asserts that `MonthGenerator.tsx` **contains** the key literal. The docs say the history "stays per-browser on purpose" | `app/components/admin/__tests__/solverConfigSource.test.ts:304-313`; `docs/DATA_MODEL.md:377-378`; `docs/adr/0010-*.md:119-122` | These change at cutover (D2) and again at the stop point (D3) |
| About ten `MonthGenerator.create.test.tsx` cases assert on `localStorage["owt_solver_history_v2"]` | `app/components/admin/__tests__/MonthGenerator.create.test.tsx:455-790,1605-1645` | They guard local mode and the dual-write, and stay green |
| The iOS shell loads the production origin in its own WebView store | `capacitor.config.ts:25-29` | R13 covers it if Frank ever planned there |
| A new route under `/api/admin/` is gated by `proxy.ts` automatically. `routeMatcher.test.ts` only lists routes that are **not** gated | `app/utils/__tests__/routeMatcher.test.ts:12-58` | No matcher or list change is needed |
| The ADRs run up to 0040. Numbers follow the order in which they reach `main`. P3's plan is being written in the same cycle | `docs/adr/`; `docs/adr/README.md` | The new ADR takes **the next free number at merge** (0041 if P2 lands first) |
| `vitest` includes `scripts/**/*.test.ts`, `tsc` includes `**/*.ts`, and TZ is pinned to America/Mexico_City in the suite | `vitest.config.*`; `tsconfig.json` | The diff tool's pure module and tests can live under `scripts/` and still be gated |

## Scope

### In scope

- A pure derivation in a neutral module, a server-only builder with its diagnostics and
  evidence, three additive read builders, and one admin read route (R1–R10).
- The planner's cutover machinery behind a deployment-wide switch: solve-time fetch,
  display, read-only chips, copy changes, diagnostics, and the dual-write (R14, R15).
- The diff tool (a pure classifier plus a local CLI), the export procedure and the report
  (R11, R13).
- A new ADR amending ADR-0010, and the R17 known-limitation record (R16, R17).
- The cutover flip (Delivery 2) and the dual-write stop (Delivery 3), each a separate
  release.

### Non-goals

- **Issue #94, the objective ceiling (ADR-0038)** is out by Frank's decision of
  2026-09-23. P2 changes only the history's **source**. The history keeps influencing
  the schedule only when the objective is not skipped.
- Any change under `gcf/**`, to the solver, to its request shape, to the decay weights,
  to the three-entry window, or to which roles count.
- Storing a history anywhere. There is no new document type, no schema, and no Sanity
  write of any kind.
- Kids, specials in the solver, and anything in the MCP connector (P4 consumes the
  builder later).
- A per-browser switch.
- Cleaning stale `owt_solver_history_v2` values out of browsers. After D3 they are inert,
  like `owt_solver_config_v3` today.

### Preserved invariants

- **Additive only** for modules that production writers import. In D1 and D2,
  `serviceReadQueries.ts` gets additions only. `plannerModel.ts`, `roleWriteRequest.ts`,
  `roleCreationReceipt.ts`, `monthDraftCreate.ts`, `serviceReadModel.ts` and
  `serviceReadSelect.ts` are not edited, and their tests are unchanged. The single
  scheduled exception is D3's removal of `historyEntryFromDrafts`, which the spec's R15
  mandates (see Spec reconciliations).
- **Reads:** every GROQ string lives in `serviceReadQueries.ts`, and every read runs on
  `operationalClient` imported directly. There are no registry or `MAY_SEE_DRAFTS`
  changes. `protectedReadAudit.test.ts` and `draftGatingCoverage.test.ts` pass unchanged.
- **Planner until Frank's cutover:** with the switch at `local`, every existing planner
  path behaves as today. The existing `MonthGenerator` tests are the regression guard and
  are not edited in D1.
- **Timezone:** a service's month comes from its stored `YYYY-MM-DD` string (via
  `serviceDayKey`), never from a `Date`. Month arithmetic is integer arithmetic.
- **ADR-0028:** the derivation is neutral (no `"use client"`, no `server-only`, no
  `node:crypto`). **ADR-0030:** use `AbortController` only, never `AbortSignal.timeout`.
  New controls use `Button`.
- **Absent is not failed** (ADR-0010's rule for the rule set): a failed history read is
  never presented as an empty history.

## Global constraints

1. **Gates:** `npx tsc --noEmit`, `npm test`, and `npx eslint .` with 0 errors, on every
   delivery. The `gcf` unittest is **not** triggered, because no step touches `gcf/**`.
   The code review confirms that `git diff origin/main --stat -- gcf` is empty. If a step
   finds it must touch `gcf/**`, stop: the spec says "solver untouched", so that is a
   spec change, not a plan detail.
2. **Release order (CLAUDE.md):** implement → gates → fresh code review of the merge range
   → fix → scoped re-verify of the fix plus gates on the final tree → merge into
   `preview`, push, and verify that `dev-owt-backstage` is in the deployment's `alias` and
   that its `githubCommitSha` is the pushed commit → PR to `main`, green `gates`, merge
   with Frank's OK → verify the production alias the same way. The last worklog entry
   before each merge is a verification.
3. **No Sanity writes, and no script that reads Sanity.** The only sanctioned read path is
   the builder (route or direct call). The diff consumes files the builder produced
   (spec R11).
4. **Personal data never enters git.** Exports, derived JSON, captured solve requests and
   reports hold member names, and this repository is **public**. They live in a private
   folder outside the repository (Open question Q2). PR bodies, commit messages, the
   worklog, the ADR and this plan carry **totals by class only**. The CLI refuses any
   input or output path inside the repository.
5. **Human gates are Frank's.** Agents cannot log in: `dev-verify` is a read-only
   non-admin member, and no agent enters credentials. So the export, the derived fetch,
   the captured solve request, reading the verdicts, accepting the `unverified` total,
   the cutover decision and the stop-point confirmation are all Frank's. Each one
   **parks the plan** until he acts.
6. **Rebase rule (roadmap):** P2 and P3 may both touch `serviceReadQueries.ts` (and each
   may add an ADR). Whichever lands second rebases, re-runs the gates, and renumbers its
   ADR if needed.
7. **Worktree hygiene (CLAUDE.md):** if a worktree is used, clone `node_modules` with
   `cp -Rc`, symlink `.env.local`, and remove the worktree at merge.

## Delivery shape

| Stage | Owner | What | Releases? | Safe end state |
|---|---|---|---|---|
| **D1** | agent | Derivation, builder, route, dormant planner machinery (switch = `local`), diff tool, ADR, R17 notes, docs | yes | The route answers read-only. **The planner is unchanged.** The ADR is on `main` |
| **Gate A** | Frank | R13 export (any time before Gate B; best taken together with it) | — | Nothing changes |
| **Gate B** | Frank (+ CLI run) | The derived fetch and a captured solve request, then the classified report | — | A report outside the repo |
| **Gate C** | Frank | Verdicts: resolve every `bug`, accept or reject the `unverified` total by class, then decide on cutover | — | Either "cut over", or "not cut over", which is recorded as a roadmap change for P4 |
| **D2** | agent | Flip the switch to `derived`; tests and docs | yes | The planner solves on derived history, and the dual-write keeps the rollback target current |
| **Gate D** | Frank | One real month solved and created on derived history, with no rollback | — | — |
| **D3** | agent | Stop the dual-write; remove the local path and `historyEntryFromDrafts` | yes | Final |

The planner machinery ships **dormant in D1** (decision D1). The cutover is then a
one-line flip whose both paths were tested in CI before the diff ran. The ADR must be on
`main` before the diff runs (R16), which forces D1 to be a full release before Gate B.

## Affected boundaries

| Component | Current | Planned |
|---|---|---|
| `app/utils/solverHistory.ts` (new, neutral) | — | `historyWindow`, `DERIVED_HISTORY_ROLE_KEYS`, `deriveSolverHistory`: the one derivation (R1–R7) |
| `app/utils/solverHistoryEvidence.ts` (new, `server-only`) | — | Rebuilds the create payload from a stored role; fingerprint match, empty-seat and receipt evidence (R11) |
| `app/utils/solverHistoryRead.ts` (new, `server-only`) | — | `loadSolverHistory(target, { evidence })`: the one server-callable builder (R8), for the route now and for P4 later |
| `app/utils/serviceReadQueries.ts` | 31 builders | **+3 builders, +1 projection constant**, additions only |
| `app/api/admin/solver-history/route.ts` (new) | — | `GET ?month=YYYY-MM[&evidence=1]`, gated like `solver-config` |
| `app/components/admin/solverHistorySource.ts` (new, neutral) | — | `SOLVER_HISTORY_SOURCE: "local" \| "derived"`, the deployment-wide switch (`local` in D1) |
| `app/components/admin/derivedHistoryClient.ts` (new, neutral) | — | `fetchDerivedHistory(year, month, signal?)`: a checked, shape-validated fetch |
| `app/components/admin/useDerivedSolverHistory.ts` (new, `"use client"`) | — | The display load, keyed by `(year, month)`, with a stale-response guard |
| `app/components/admin/MonthGenerator.tsx` | Local history read, write, remove and solve | Local path unchanged. Derived path gated by the switch: solve-time fetch, dual-write helper, read-only chips, diagnostics |
| `LeadPoolHistoryPanel.tsx`, `leadPoolHistory.ts`, `PlannerGrid.tsx` | «Sin historial guardado…», «Historial usado: N» | Optional, additive props and fields for the derived copy |
| `scripts/lib/solverHistoryDiff.ts`, `scripts/solver-history-diff.ts` (new) | — | Pure R11 classifier, and a CLI over local files plus a local solver runner |
| `docs/adr/00NN-*.md` (new), `docs/adr/0010-*.md`, `docs/adr/README.md` | — | The amending ADR; 0010's Status; the index |
| Docs | Per-browser history | See each delivery's docs item |

No trust boundary moves. The route is one more manager-gated admin read. The builder has
no authentication of its own: its caller authenticates (the route with a session, P4 with
its bearer checks).

## Ordered changes

Every step leaves the four gates green. Nothing deploys until step 8.

### Delivery 1 — the derived history, dormant

#### 1. The pure derivation (R1–R7, R12)

- **Change:** `app/utils/solverHistory.ts` (neutral) exports:
  - **`historyWindow({ year, month })`** returns the three months before the target,
    oldest first, each with an unpadded `key`, using integer arithmetic. November 2026
    gives Aug, Sep, Oct; January 2027 gives Oct, Nov, Dec 2026.
  - **`DERIVED_HISTORY_ROLE_KEYS`** holds `sunday_role → {Lead: Sun.Lead, BGVs: Sun.BGV,
    Chorus: Sun.Choir}` and `saturday_role → {Lead: Sat.Lead, BGVs: Sat.BGV, Chorus: null}`.
    It has **no `special_role` entry**. It is a separate copy of `HISTORY_ROLE_KEYS`,
    because D3 deletes that constant. R12 proves the two agree until then.
  - **`deriveSolverHistory({ target, roles, members })`** returns
    `{ entries, months, diagnostics }`:
    - **Inputs:** `roles` are `ROLE_PROJECTION` rows; `members` are
      `{ _id, member_name }[]` for all members.
    - **R1:** only weekend role types count. A special is ignored, and ignoring it is
      not reported.
    - **R5:** day = `serviceDayKey(week)`, month = `day.slice(0, 7)`. A role outside the
      window is ignored defensively (the read is already bounded). A `drafts.*` id is
      ignored defensively (the published perspective never returns one).
    - **R2, R3:** every stored seat counts. `published` is never read.
    - **R7, duplicate targets:** two or more documents of one type on one day are all
      dropped and reported in `duplicateTargets: [{ type, day, roleIds }]`.
    - **R7, identity:**
      - The key is `member_name` **verbatim**. This is the string `buildSolveRequest`'s
        pools use via `memberIdToName`, so the solver matches it. There is **no raw-id
        fallback**.
      - A reference to an id not in `members` is dropped and reported in
        `danglingSeats: [{ roleId, day, path, memberId }]`.
      - A member whose `member_name` is not a non-empty string is dropped and reported in
        `unnamedMembers`.
      - Two members sharing one `member_name` are reported in
        `duplicateNames: [{ name, memberIds }]`. Their counts merge, as they do in the
        solver.
    - **R4, R6:** `entries` always holds three `SolverHistoryEntry`s:
      - a month with no weekend services gets empty maps;
      - `total_counts` is the sum of `role_counts`;
      - zero-seat members are omitted;
      - `key` is `${year}-${month}`.
    - **Metadata:** `months: [{ key, year, month, services }]` counts the weekend
      services found per month.
    - The output is **independent of input order**: diagnostics are sorted, and the
      entries are built from sorted keys.
  - `SolverHistoryEntry` is imported **as a type only** from `plannerModel.ts`. The
    module imports only neutral helpers (`serviceDayKey` from `serviceReadSelect.ts`),
    never `roleWriteRequest.ts` (which pulls in `node:crypto`).
- **Tests** (`app/utils/__tests__/solverHistory.test.ts`):
  - **R1:** a special in the window changes nothing.
  - **R2:** a swapped month derives the post-swap counts.
  - **R3:** an all-draft month (`published: false`, and absent) counts in full.
  - **R4:** the November and January windows; an empty month is present and empty; a
    role in the target month or later is ignored.
  - **R5:** a `2026-10-31` Saturday counts in October, and a `2026-11-01` Sunday in
    November.
  - **R6:** role keys; Saturday Chorus is ignored; instruments and FOH never count; the
    total is the sum; zero-seat members are omitted; the key is unpadded.
  - **R7:** a rename counts under the current name; a dangling reference is reported and
    not counted; duplicate names are reported; duplicate targets are counted by neither
    copy; an unnamed member is reported.
  - **Determinism:** shuffled input gives deep-equal output.
  - **The request passes through:** `historyForRequest(entries, target)` deep-equals
    `entries`, so `buildSolveRequest` sends them unchanged.
- **R12 equivalence** (`app/utils/__tests__/solverHistoryEquivalence.test.ts`):
  - Take create-mode `DraftCard` fixtures for three non-empty prior months plus the
    target, with a special among them.
  - Build each one's document with the create route's own path: `draftCreateBody` →
    `parseCreateRequest` → `buildRoleDocument`.
  - Project each document to the `ROLE_PROJECTION` shape and derive.
  - Each month's entry must equal `historyEntryFromDrafts` over the same weekend drafts
    and members.
  - Hand-built mirror documents are forbidden, because they would make the test circular.
  - This test is **deleted in D3** together with `historyEntryFromDrafts` (R15).

#### 2. Three additive read builders (R9)

- **Change:** add three builders to `app/utils/serviceReadQueries.ts`. They bind a
  module-private `WEEKEND_ROLE_TYPES` (derived from `ROLE_TYPES`) as a parameter, and
  carry **no `published` clause**, because prior-month drafts count (R3).
  - **`canonicalWeekendRolesInRangeQuery(fromDay, toDayExclusive)`**:
    `*[_type in $roleTypes && week >= $from && week < $to] ${ROLE_PROJECTION}`.
  - **`canonicalMemberNamesQuery()`**: `*[_type == "teamMembers"]{ _id, member_name }`.
    There is no ministry filter (R7; spec v2 I5: the solver's pool is not a
    member-listing read).
  - **`ROLE_CREATION_RECEIPT_EVIDENCE_PROJECTION`** (the existing projection plus
    `createdAt`, `updatedAt`) and **`weekendRoleCreationReceiptsQuery()`**:
    `*[_type == "roleCreationReceipt" && roleType in $roleTypes]`.
    - Why all weekend receipts: rule 4's "moved out of the month" arm needs receipts
      whose immutable `targetIdentity` is in the window while their role is not. A
      document moved *into* the window has a receipt targeting a date outside it. One
      unscoped read covers both.
    - Size: the volume is bounded by the weekend roles created since 2026-07-24 (a few
      a month), so it is small (Assumption A2).
- **Nothing existing changes.** `ROLE_CREATION_RECEIPT_PROJECTION` and every existing
  builder stay byte-identical.
- **Tests** go in a **new** file, `app/utils/__tests__/solverHistoryQueries.test.ts`, so
  the existing `serviceReadQueries.test.ts` stays unchanged:
  - types and dates are bound as parameters;
  - no `${` survives in a query;
  - no `published` clause appears (drafts are read on purpose);
  - the receipt projection carries `createdAt`.
- **Verification:** `git diff origin/main -- app/utils/serviceReadQueries.ts` shows added
  lines only. `protectedReadAudit.test.ts` and `draftGatingCoverage.test.ts` pass
  unchanged.

#### 3. The server-side builder and the evidence (R8–R11)

- **`app/utils/solverHistoryEvidence.ts`** (`server-only`):
  - **`storedRoleCreatePayload(role, published)`** rebuilds a `draftCreateBody`-shaped
    payload from a `ROLE_PROJECTION` row:
    - `_type`;
    - `date` = the day;
    - `leads`/`bgvs`/`chorus` from `Lead`/`BGVs`/`Chorus[]._ref`;
    - `instruments` from `instruments[]{instrument, person._ref → personId}`;
    - `foh` from `foh_team[]{role, person._ref → personId}`;
    - the given `published`.
    - `service_name`/`time`/`format` are carried only when present, for symmetry;
      weekend roles have none.
  - **`documentEvidence(role, receipt)`** returns:
    - `unchangedAs: "published" | "draft" | null`: which `published` value, if either,
      makes `payloadFingerprint` of the rebuild equal the receipt's `fingerprint` (or
      `creationFingerprint` when no receipt was found). "Unchanged" means non-null (D7),
      and the report states the mix;
    - `emptySeatCreate`: the receipt's fingerprint equals the fingerprint of an
      empty-seat payload for its own `targetIdentity`, under either `published` value;
    - `contributes`: that document's per-member counts, taken from the derivation's
      rules.
- **Positive control (spec R11), `solverHistoryEvidence.test.ts`:**
  - **Matrix:** a weekend role with all five seat kinds; labels with odd whitespace; a
    duplicate reference; created as a draft and as published.
  - **Round trip:** `draftCreateBody` → `parseCreateRequest` → `buildRoleDocument` →
    projected row → rebuild → `payloadFingerprint`. The result must equal the parsed
    fingerprint.
  - **Other cases:**
    - a document published after draft creation still matches (via `published = false`);
    - a swapped seat does not match;
    - a «+ Nuevo servicio» body is detected as `emptySeatCreate`.
- **`app/utils/solverHistoryRead.ts`** (`server-only`) exports
  `loadSolverHistory(target, { evidence = false } = {})`:
  - It imports `operationalClient` **directly**, because a client passed as a parameter
    is invisible to the audit.
  - It runs in parallel: the window's roles (`historyWindow` bounds → step 2 range) and
    all member names.
  - With `evidence`, it also reads the weekend receipts. For receipts whose target day
    is in the window but whose `roleId` is not among the window's roles, it reads their
    current documents with the existing `canonicalRolesByIdsQuery` (the "moved out"
    arm; a missing role means deleted).
  - It derives with step 1.
  - It returns `{ target, entries, months, diagnostics, evidence? }`.
  - **Evidence contents:**
    - per window document: `{ roleId, type, day, publishedRaw, receipt, unchangedAs,
      emptySeatCreate, contributes }`;
    - per out-of-window receipt: `{ receiptId, state, targetDay, createdAt, roleId,
      roleCurrentDay | null }`;
    - `members: [{ id, name }]`;
    - `control: { withReceipt, unchanged }` (the report's match rate).
  - **Failure:** any rejected read throws `SolverHistoryUnavailableError`, whose message
    is fixed and carries no Sanity text. It **never returns empty entries on failure**
    (spec, Behavior → Failure).
- **Tests** (`solverHistoryRead.test.ts` and `solverHistoryEvidence.test.ts`). Both use
  `vi.mock("server-only", () => ({}))`, the repo's pattern (for example
  `app/api/__tests__/flushNotificationsRoute.test.ts:17`). The read test also uses
  `vi.mock("@/sanity/lib/operationalClient")`:
  - exactly the step-2 builders run, plus `canonicalRolesByIdsQuery` only in evidence
    mode;
  - the range bounds for November are `2026-08-01` and `2026-11-01`;
  - a failed members read throws, and the throw carries no Sanity message;
  - no receipt query runs without `evidence`;
  - moved-out and `role_deleted` receipts are surfaced;
  - control counts are correct.
- **Guards:** the audit and draft-gating suites pass with their lists unchanged, and
  there is no GROQ in either new module.

#### 4. The admin read route (R8)

- **Change:** `app/api/admin/solver-history/route.ts`:
  - `export const dynamic = "force-dynamic"`.
  - `GET` uses the same `gate()` as `solver-config`: no session gives `403`, and
    content-editor gives `403`.
  - `month` must match `^\d{4}-(0[1-9]|1[0-2])$`, otherwise
    `400 { error: "invalid_request" }`. `evidence=1` is optional.
  - `200` returns the builder's result with `Cache-Control: no-store`.
  - `SolverHistoryUnavailableError` (or any throw) returns
    `500 { error: "history_unavailable", message: "No se pudo leer el historial de equidad." }`
    with **no `entries` key**, so no client can read it as an empty history.
- **Tests** (`app/api/__tests__/solverHistoryRoute.test.ts`, following
  `solverConfigRoute.test.ts`'s `vi.hoisted` mocks):
  - `403` in both refused cases;
  - `400` for `2026-13`, `2026-9` and a missing month;
  - the `200` shape carries three entries;
  - evidence appears only on request;
  - a `500` carries no `entries` and no internals.
- **State:** a read-only admin route exists, and nothing calls it yet.

#### 5. The planner machinery behind the switch (R14, R15), set to `local`

- **Switch:** `solverHistorySource.ts` exports
  `SOLVER_HISTORY_SOURCE: SolverHistorySource = "local"`.
  - It is deployment-wide by construction: one constant in every bundle (R15; Open
    question Q1).
  - Tests select a mode with `vi.mock`.
- **`fetchDerivedHistory(year, month, signal?)`:**
  - uses `cache: "no-store"` and try/catch;
  - checks `res.ok`;
  - checks that there are exactly three entries whose keys equal `historyWindow`;
  - returns `{ ok: true, data } | { ok: false }`;
  - never throws to its caller.
- **`useDerivedSolverHistory(year, month, enabled)`** exposes `loading`, `ready` or
  `error`, plus `reload`. `enabled` is `SOLVER_HISTORY_SOURCE === "derived"` while
  `MonthGenerator` is mounted, in **both** create and stored mode, because stored mode
  also renders the grid's `LeadPoolHistoryPanel` (`MonthGenerator.tsx:3773-3781`). It keys each request by `(year, month)` and **discards a
  response for a month that is no longer current**, using a request counter plus an
  `AbortController` on change or unmount.
- **`MonthGenerator.tsx`: everything new runs only when the switch is `"derived"`.** The
  local-mode code is left as it is.
  - **Mount effect:** the `localStorage` history read runs only in local mode.
  - **Display:** in derived mode, `SolverConfigPanel` and both `LeadPoolHistoryPanel`
    mounts receive the hook's entries.
  - **`handleAuto`:**
    - In derived mode it sets the pending flag, then `await fetchDerivedHistory(year,
      month)` for **the handler's own target, at call time**. The display copy is never
      reused (R14).
    - On failure it runs `setAutoError("No se pudo leer el historial de equidad. Auto no
      corrió; reintenta.")`, then `applySpecialFill(config, cells)`, then returns. That
      is a pre-flight refusal: the specials still fill (E5), and it never solves on an
      empty history (spec, Failure).
    - On success, `buildSolveRequest` receives the fetched entries.
    - The existing `try/finally` widens to cover the fetch.
  - **`handleConfirm`:** in derived mode it calls a new module-level helper,
    `appendLocalHistoryEntry(entry)`, instead of `saveHistoryEntry`. The helper:
    - lives **in `MonthGenerator.tsx` beside `HISTORY_KEY`** (decision D12);
    - reads `localStorage.getItem(HISTORY_KEY)`;
    - drops the entry with the same key, appends the new one, and keeps
      `slice(-MAX_HISTORY)`;
    - writes the result back inside try/catch;
    - **never touches `solverHistory` state** (R15: the rollback target is built from
      its own contents, never from derived entries).
  - **Historial block (derived mode):**
    - the header reads «Historial de equidad — derivado de los servicios guardados»;
    - one **read-only** chip per window month («Ago 2026»), marked «· sin servicios» when
      the month has none. There is no × control;
    - **diagnostics are always shown** (R7): seats pointing to deleted members («no
      cuentan»), repeated names («el solver los confunde»), and duplicate services on a
      date («no cuenta ninguno»);
    - on a read error, a message and a `Button` «Reintentar».
  - **`LeadPoolHistoryPanel`:** an optional, additive prop carries the empty-month keys.
    In derived mode «Sin historial guardado…» never renders. An empty prior month shows
    «Sin servicios de fin de semana en {mes}.»
  - **`PlannerGrid` diagnostics:** an optional `history_months` string replaces
    «Historial usado: N» in derived mode (for example «Historial: ago · sep (sin
    servicios) · oct»). `MonthGenerator` omits `history_runs_used` there, because the
    value is always 3 (R4).
- **Tests** (`app/components/admin/__tests__/MonthGenerator.derivedHistory.test.tsx`,
  switch mocked to `derived`; fetch mocked per URL):
  1. **R14 race:** open on October while October's display fetch is still pending. Switch
     to November, press «Previsualizar», then Auto. The `/api/admin/solve` body's
     `history` equals **November's** derived entries. October's late response never
     reaches the display.
  2. **Fresh at solve time:** the display has loaded X, the server now answers Y, and
     Auto sends Y.
  3. **Failed read:** there is no `/api/admin/solve` call, the error shows, and the
     specials are filled.
  4. **Dual-write:** `localStorage` is seeded with L and the derived entries D sit in
     state. After a confirm, `localStorage` holds L merged with the new entry, and no D
     entry.
  5. **No history source read:** a spy shows no `localStorage.getItem(HISTORY_KEY)` on
     the solve path.
  6. **Display:** the chips have no remove control; the copy and the diagnostics render;
     the lead-pool panel shows its empty-month copy.
  - The existing `MonthGenerator.*.test.tsx`, `leadPoolHistory.test.ts` and
    `solverConfigSource.test.ts` pass **unedited** (local is the default).
- **State:** production behaviour is unchanged. The derived path is compiled in but
  unreachable.

#### 6. The diff tool (R11, R13)

- **`scripts/lib/solverHistoryDiff.ts`** (pure: no `fs`, no Sanity, no network):
  - `parseExport(raw)` is defensive, and a malformed export throws with a clear message.
  - `classifyHistoryDiff({ target, primary, others, derived, sessionGapMinutes })`
    implements the spec's R11 rules **1–5 in order, first rule and first arm wins**,
    and nothing else. Anything no arm admits is `bug`.
  - **Domain:** the union of the target's window months and the export's months,
    compared per month × member × role key. An absent entry and an empty entry compare
    equal.
  - **Month keys** are compared as `(year, month)` numbers, never as strings.
  - **Per-cell attribution:**
    - when derived is higher, only documents that seat that member in that role (via
      `contributes`) can explain the cell;
    - when the export is higher, only a changed, deleted or moved document of the
      matching type in that month can explain it;
    - the remainder falls to rule 5.
  - **Sessions (rule 4), pinned here, decision D8:**
    - the month's weekend receipts (committed or `role_deleted`, excluding empty-seat
      creates) are sorted by `createdAt`;
    - a new session starts after a gap of more than **`SESSION_GAP_MINUTES = 60`**;
    - the latest session is the last group;
    - the report prints each month's groups (times and role ids).
  - **Renames (rule 3):** keys are mapped through the rename arm before rule 4 compares,
    as the spec says ("the remaining comparison uses current names").
- **`scripts/solver-history-diff.ts`** (run with `npx tsx`), invoked as
  `--bundle <file>` (the Gate B snippet's output) `[--export <file>]…`
  `[--solve-request <file>] --out <dir> [--seed 42] [--runs 2]`:
  - It **refuses any input or output path inside the repository root.**
  - It writes `report-<timestamp>.md` and `.json` to `--out`.
  - It imports no Sanity client and reads no env secrets.
  - With several exports, it runs once with each export as primary, using the others as
    "another export" evidence.
- **Solve runs (spec R11):**
  - From the captured request, the **local** side is `historyForRequest(primary, y, m)`,
    imported from `plannerModel.ts`: exactly what the browser sends. The **derived** side
    is the bundle's entries for that target. Both are projected to
    `{ total_counts, role_counts }`, with `seed` pinned (default 42), and each side runs
    `--runs` times (default 2).
  - **Consistency check:** when the primary export came from the profile that captured
    the request, the request's own `history` must equal the recomputed local side. If it
    does not, the report says so and names the likely cause (planning between capture
    and export).
  - The runner spawns `OWT_SOLVER_PYTHON` (default: the conda path the solve route uses)
    with `gcf/owt_solver_v2.py --json-mode`.
  - First it checks that `ortools.__version__` equals the `gcf/requirements.txt` pin, and
    refuses otherwise.
  - **Recorded per run:** `ok`, `objective_skipped`, `history_runs_used`, the three
    fairness flags, the unfilled-seat count, and per-person totals.
  - **Reported:** the within-side deltas (the noise baseline) and the cross-side deltas.
    When both sides skip the objective, the report states "**not fairness-driven**".
  - Fallback if the local env is unusable: Frank runs the four requests through
    `/api/admin/solve` from DevTools, and saves the responses into the bundle's folder.
- **Report header:**
  - the export files and their entry counts, the bundle's `takenAt`, the targets, and
    `SESSION_GAP_MINUTES`;
  - **the fingerprint control rate** (`unchanged / withReceipt`);
  - **totals: explained by class, unverified by class, bug**.
- **Tests:**
  - `scripts/__tests__/solverHistoryDiff.test.ts`:
    - one fixture per arm (1; 2a–2e; 3a–3b; 4a–4e; 5, including a special-traced
      difference);
    - precedence, where a cell matching two arms gets the first;
    - per-cell attribution, where a changed Saturday document cannot explain a `Sun.*`
      cell;
    - `2026-10` against `2026-9`;
    - the session-gap boundary (60 minutes versus 61);
    - a changed latest-session document turns earlier-session documents into
      `unverified`;
    - a missing month with no derived documents produces no difference.
  - `scripts/__tests__/solverHistoryDiffCli.test.ts`:
    - an in-repo `--out` or input path is refused;
    - the CLI's import closure has no `sanity/`, `next-sanity` or `@sanity/client`
      specifier;
    - the ortools version check refuses a mismatch (the spawn is stubbed).
- `gcf/**` is invoked, never edited.

#### 7. ADR, R17 record, docs for the dormant state

- **New ADR** `docs/adr/00NN-the-fairness-history-is-derived-from-stored-services.md`.
  NN is the next free number **when its PR merges**: 0041 today, but renumber if P3's ADR
  reaches `main` first. It follows the template and stays under a page:
  - **Context:** defects (a)–(f) and ADR-0010's named gap.
  - **Decision:**
    - the history is derived from canonical weekend role documents;
    - stored state counts (decision 1);
    - prior-month drafts count, and the target and later months never do (decision 2);
    - three calendar months, with empty entries allowed;
    - current names;
    - **ratifies ADR-0010 Decision 3** (specials excluded);
    - the history is **shared, not per-browser**;
    - the staged cutover and its dual-write stop point.
  - **Rejected:**
    - keeping `localStorage`;
    - a stored history document ("storing a history anywhere");
    - counting what was created rather than what is stored;
    - excluding drafts;
    - H3 as "every difference individually proven".
  - **The H3 narrowing is stated:** the `unverified` verdict, which Frank accepts or
    rejects as a total, by class.
  - **Consequences:**
    - **R17's known limitation:** the history moves the schedule only when the objective
      is not skipped (ADR-0038), and the follow-on is **issue #94**;
    - the manual month exclusion is lost with the read-only chips;
    - rollback before and after P4.
- `docs/adr/0010-*.md` Status becomes **"Accepted, amended by ADR-00NN"**, and a one-line
  pointer goes under its "stays in `localStorage`" consequence. The `docs/adr/README.md`
  index gets the 0010 status and the new row.
- **R17 in "P2's review log":** append a dated note to
  `docs/superpowers/specs/2026-09-23-solver-history-derivation-design-review-log.md`
  recording the limitation, citing ADR-0038 and #94. Update its "Suggested, not done"
  line, since #94 exists.
- **Docs:**
  - `docs/API_REFERENCE.md` Solver section: the new `GET`, its gate, its errors, and that
    `evidence=1` returns member names (admin only).
  - `docs/UTILITIES_AND_COMPONENTS.md`: the new modules.
  - `docs/SOLVER_AND_INFRA.md` §"Key behaviors": the source is still the browser until
    cutover, and the derived builder exists.
  - `DATA_MODEL.md` does not change until D2.
  - This plan's status line is updated.

#### 8. Release Delivery 1

1. **Gates**, plus an empty `gcf` diff.
2. **Fresh code review** of the merge range. It carries the docs-audit and
   worklog-completeness checklists (`finish-cycle`). It checks specifically:
   - `serviceReadQueries.ts` has additions only, and the six other writer-imported
     modules show no diff;
   - there is no GROQ outside `serviceReadQueries.ts`;
   - `SOLVER_HISTORY_SOURCE === "local"`;
   - the builder never yields empty entries on a failure;
   - the CLI has no Sanity import and has the in-repo path refusal;
   - no fixture or doc carries a real member name.
   Then fix, then re-verify the fix (scoped review plus gates).
3. **Merge into `preview`** and verify the dev alias (`alias` array and
   `githubCommitSha`). There is no visual change, so no `dev-verify` is needed. Frank may
   optionally run `fetch('/api/admin/solver-history?month=2026-11')` on dev.
4. **PR to `main`**, wait for `gates`, merge with Frank's OK, and verify the production
   alias. The ADR is now on `main`, which is R16's precondition for the diff.

### Gate A — the export (R13) · **Frank**

The history is per origin and per browser profile, and the export holds full member names.
It is saved only into the private folder (Q2), **never into the repository**.

1. In the browser profile he plans in, open **`https://owt-backstage.vercel.app`**, the
   production origin. `dev-owt-backstage` is a different origin with a different store.
2. In the DevTools console, run
   `copy(localStorage.getItem("owt_solver_history_v2"))` and paste the result into
   `export-<browser>-<profile>-<date>.json`. A `null` result means an empty store: record
   it anyway, because it is evidence.
3. Repeat for **every** browser or profile he has ever planned in, including other Macs.
   If he ever confirmed a month on dev, also export dev's origin.
4. **iOS shell**, only if he ever planned there: Safari → Develop → the device or
   simulator → `owt-backstage.vercel.app`, then the same command. A release build whose
   WebView is not inspectable cannot be exported. Record that, and its months then fall
   to rule 2's evidence.
5. Take the primary export **together with Gate B's snippet** (below), which does steps 1
   and 2 and the derived fetch in one go. Do not plan or edit services between the export
   and the fetch.

### Gate B — the diff (R11) · **Frank**, then one CLI run

1. **Derived fetch plus primary export, in one snippet.** Run it on production, in the
   planning profile, after D1 is live. `NEXT` is the next month he will plan:

   ```js
   const NEXT = "2026-11";
   const raw = localStorage.getItem("owt_solver_history_v2");
   const exp = JSON.parse(raw ?? "[]");
   const after = (y, m) => (m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`);
   const targets = [...new Set([NEXT, ...exp.map((e) => after(e.year, e.month))])];
   const derived = {};
   for (const t of targets) {
     const r = await fetch(`/api/admin/solver-history?month=${t}&evidence=1`, { cache: "no-store" });
     derived[t] = { status: r.status, body: await r.json() };
   }
   copy(JSON.stringify({ origin: location.origin, takenAt: new Date().toISOString(), exportRaw: raw, derived }));
   ```

   Save the result as `bundle-<date>.json` in the private folder. Each export month `m`
   gets target `m+1`, so `m` is the newest month in some window (decision D9).
2. **Captured solve request.**
   - In the planner on production, in create mode, pick `NEXT`, then «Previsualizar» →
     **Auto**. Auto writes nothing. **Do not press «Crear».**
   - In DevTools → Network → `solve`, copy the request payload into
     `solve-request-<NEXT>.json`.
3. **Run:**
   `npx tsx scripts/solver-history-diff.ts --bundle <bundle> [--export <other>…] --solve-request <file> --out <private folder>`.
   Frank runs it himself unless he allows an agent to (Q3). Either way, only **totals**
   leave the private folder.
4. **Frank reads the report.** Then Gate C.

### Gate C — verdicts and the cutover decision (R11, R14) · **Frank**

- **Any `bug`, or any difference no class admits, blocks the cutover.**
  - A derivation bug: a fix ships as a D1 patch release through the full pipeline, then
    Gate B runs again.
  - A duplicate weekend target (rule 1): resolving it deletes or moves a production
    document. That is a production write, Frank's to consent to and perform through
    `/admin`, outside P2's code. Then Gate B runs again.
- **Stop condition:** a fingerprint control rate of 0% while documents with a receipt are
  present. Investigate the rebuild before accepting any `unverified`, because a rebuild
  defect turns every would-be `bug` into `unverified`.
- **`unverified`:** Frank **accepts or rejects the total, by class**, explicitly in chat.
  The acceptance is recorded in this plan's status line as totals only.
- **Cutover decision.** Inputs:
  - the report and its `objective_skipped` table;
  - the loss of the manual month exclusion (the chips become read-only);
  - P4's entry criterion ("P2 cut over").
  Two outcomes:
  - **Cut over** → D2.
  - **Not cut over** → the safe end state stays D1 (the route live, the planner local).
    The roadmap records a change for P4's scope, because P4's entry requires the cutover.

### Delivery 2 — cutover

#### 9. The flip

- **Change:**
  - `SOLVER_HISTORY_SOURCE = "derived"`.
  - The existing local-mode history tests (`MonthGenerator.create.test.tsx`, the cases
    that assert on the key) gain a `vi.mock` pinning `local`. The **rollback path stays
    tested** until D3.
  - `solverConfigSource.test.ts:304-313` is rewritten from "per-browser, on purpose" to
    "**written, never read**". It asserts that the literal is still present (the
    dual-write target) **and** that the switch is `derived`.
- **Docs:**
  - `DATA_MODEL.md:377-378`: the history is derived and shared, and the browser key is
    written only as the rollback target until the stop point.
  - `SOLVER_AND_INFRA.md` §"Key behaviors".
  - `UTILITIES_AND_COMPONENTS.md:566` (`MonthGenerator`).
  - A dated note on the ADR: "cutover landed".
  - `CLAUDE.md`: add `deriveSolverHistory`/`loadSolverHistory` to the reusable utils, and
    one invariant line: *the solver's history is derived for the target month at solve
    time; never read from `localStorage`, never cached across a solve*.
- **Release:**
  - Gates, fresh code review, fix, re-verify.
  - Merge into `preview` and verify the dev alias.
  - **Frank's look on dev:** read-only chips, the copy, the lead-pool panel, the
    diagnostics, and Auto running. dev writes the production dataset, so on dev use
    «Previsualizar» and Auto only, **never «Crear»**. `dev-verify` cannot reach `/admin`.
  - PR to `main`, `gates`, merge with Frank's OK, verify the production alias.
  - Then Frank opens the planner on production and sees three derived months.

### Gate D — the stop point (R15) · **Frank**

Frank confirms that **one real month** was solved with Auto and created on production on
the derived history, with no rollback. D3 waits for this confirmation.

### Delivery 3 — stop the dual-write

#### 10. Remove the local path

- **Change:**
  - Delete the dual-write, the local read and write paths, `saveHistoryEntry`,
    `removeHistoryEntry`, `HISTORY_KEY` and `MAX_HISTORY`, and the switch module (derived
    becomes unconditional).
  - Delete `historyEntryFromDrafts` and `HISTORY_ROLE_KEYS` from `plannerModel.ts`, plus
    the R12 equivalence test and the local-mode history tests (R15).
  - `solverConfigSource.test.ts` is inverted to `not.toContain("owt_solver_history_v2")`.
- **Additive-only exception:** this is P2's single removal from a writer-imported module.
  It is sanctioned by R15. The only production writer that imports `plannerModel.ts` is
  `solverConfigWriteRequest.ts:38-45`, and it imports rule **types** only. Re-verify with
  `git grep` at that time; if a writer has started importing either symbol, stop and
  escalate.
- **Docs:** `DATA_MODEL.md`, `SOLVER_AND_INFRA.md`, a dated note on the ADR, and
  `CLAUDE.md`. Stale browser values are inert.
- **Release:** the same pipeline.
- **After D3, rollback is forward-fix only**, because a restored local path would read a
  history frozen at the stop point.

## Data and failure safety

- **Source of truth:** canonical weekend role documents (published perspective) plus
  current member names. The history is recomputed on every request, with nothing stored
  and nothing to migrate (R10).
- **Writes:** none in Sanity. The only write is the existing `localStorage` dual-write,
  built from its own contents (R15).
- **Partial failure:** any failed read fails the whole builder call. The route answers
  `500` with no `entries`. The display shows an error and «Reintentar». Auto refuses
  before calling the solver, and the specials still fill. The manual grid and «Crear»
  are unaffected.
- **Concurrency:** the solve always fetches at call time for its own target. A display
  response for a stale month is discarded. The derivation is deterministic in its inputs.
  An edit landing between the fetch and the solve is the same moment-in-time gap every
  admin read has, and the next Auto sees it.
- **Privacy:** the route returns names to managers only, as other admin reads do. Every
  artifact of the diff stays outside the repository (Global constraint 4).

## Verification

| Requirement | Test or check | Failure it detects |
|---|---|---|
| R1, R5, R6, R7 | step 1 unit tests | a special counted; a UTC day-flip; a changed counting rule; a raw-id key; a double-counted duplicate target |
| R2, R3, R4 | step 1 (swap, all-draft, windows, empty and future months) | the created state counted; drafts dropped; future months leaking; eviction-by-write-order |
| R6 / R12 | step 1 equivalence test through `buildRoleDocument` | the counting rules drifting across the change of source |
| R8 | step 4 route tests; step 5 "no history source read" spy; P4 handoff | a second path feeding a solve |
| R9 | step 2 tests; audit and draft-gating suites unchanged; additions-only diff | a draft-gated literal or registry change; a writer-imported export changed |
| R10 | review: no writer, no schema | a stored history |
| R11 | step 3 positive control; step 6 per-arm fixtures and precedence; the report's control rate and totals | a label admitting a difference; a rebuild defect hiding bugs |
| R13 | Gate A procedure; CLI in-repo path refusal | an export in git; the wrong origin |
| R14 | step 5 tests 1–2, 5 | a solve on a cached or foreign month's history |
| R15 | step 5 test 4; D2's pinned local-mode tests; D3 stop point | derived entries overwriting the rollback target |
| R16, R17 | code review: the ADR on `main` before Gate B; the ADR and the review-log note | the diff run without its decision record |
| Spec: Failure | step 3 and 4 failure tests; step 5 test 3 | a failed read shown or solved as empty |
| Additive-only | `git diff` of writer-imported modules (D1, D2) | a silent change to a writer's dependency |
| No `gcf` change | `git diff origin/main --stat -- gcf` empty | an unrehearsed production solver deploy |

## Rollout, observability, and rollback

- **Sequence:** D1 → Gates A, B, C → D2 → Gate D → D3. Each delivery follows Global
  constraint 2.
- **Signals:**
  - route status codes in the Vercel logs (never payloads);
  - the report's totals and control rate;
  - after D2, the planner's Historial block and diagnostics;
  - Auto's error line on read failure.
- **Stop conditions:**
  - any `bug`;
  - a 0% control rate;
  - route latency above 5 s on production;
  - an Auto refusal caused by a history read failure seen on production after D2, which
    triggers rollback.
- **Rollback:**
  - **D1:** revert the PR. Nothing is stored, and the planner never used the route.
  - **D2, before P4 ships:** revert the flip (`local`) through `preview` → `main`.
    `localStorage` is current thanks to the dual-write. No data restore is needed.
  - **D2, after P4 ships:** rolling back the cutover **also withdraws `solve_month`**
    (a P4 change). Otherwise the connector and the admin UI would solve against different
    histories (H4). No MCP code is affected by P2 itself.
  - **D3:** forward-fix only (see step 10). This is why D3 waits for Gate D.
- **Restoration check:** after a D2 revert, the Historial chips show × again, and a
  solve's request body carries the `localStorage` entries.

## Decisions

| # | Decision | Choice | Why | Tradeoffs | Owner |
|---|---|---|---|---|---|
| D1 | Delivery shape | Three releases. The planner machinery ships **dormant** in D1 | The cutover becomes a one-line flip, both paths are CI-tested before the diff, and D1 carries the ADR to `main` before the diff (R16) | Dormant code sits in production for weeks | this plan |
| D2 | Switch mechanism | A code constant in one neutral module | Deployment-wide by construction, no `docs/SECRETS.md` entry, rollback through the normal pipeline | Rollback takes one pipeline pass (see Q1) | Frank (Q1), with that default |
| D3 | When the solve's history is read | Fetched in `handleAuto` at call time; the display uses a separate load | R14: never a copy cached before an edit, never another month's | One extra request per Auto | this plan |
| D4 | History read fails at Auto | Pre-flight refusal: no solve, error shown, specials still fill | Spec: absent ≠ failed; E5 | Auto is unavailable until the read recovers | this plan |
| D5 | Member set | All `teamMembers` names, no ministry filter | Catches name collisions across the whole solver pool (R7); spec v2 I5 | One small extra read | this plan |
| D6 | Receipt evidence | All weekend receipts in one query, with a new projection carrying `createdAt` | Covers documents moved in and moved out; the existing projection is writer-imported | Unscoped, but bounded by weekend creates (A2) | this plan |
| D7 | "Unchanged document" | The rebuilt payload reproduces the receipt's fingerprint under `published` true **or** false | `published` is hashed, and a draft published later must not read as changed | A publish-flag-only change is invisible, which is irrelevant to seats | this plan |
| D8 | Rule 4 session boundary | `createdAt` gap > **60 min** splits sessions; empty-seat creates are excluded | The spec leaves the grouping to this plan | A mis-grouping fails toward `bug` or `unverified`, never toward `explained`, and the groups are printed | this plan |
| D9 | Diff targets | The next month to plan, plus `m+1` for every export month | Every export month is compared as a window's newest month | Several windows overlap, and each is reported separately | this plan |
| D10 | Solve runs | The local conda solver with an ortools pin check; seed 42; two runs per side. Fallback: Frank runs them through the production route | No `gcf` change, repeatable, and the same machine for both sides | Local CPU differs from GCF, but only the comparison matters | this plan |
| D11 | Home of the diff tool | `scripts/` (pure lib plus CLI) | Tooling, never bundled; zero Sanity imports keeps it off every audit registry | — | this plan |
| D12 | Home of the dual-write helper | `MonthGenerator.tsx`, beside `HISTORY_KEY` | The per-browser literal test stays meaningful until D3 | A module-level function inside a client component | this plan |
| D13 | ADR number | The next free number at merge | Numbers follow the order in which they reach `main`, and P3 may land first | Renumbering at merge | this plan |
| D14 | Where R17 is recorded | The ADR, plus a dated note on the spec's review log | The spec review log is the only review log P2 has | — | this plan |
| D15 | Issue #94 | Out of scope | Frank, 2026-09-23 (spec decision 3) | The history stays mostly inert until #94 ships | Frank |

## Assumptions

| Assumption | Impact if false | Validation point | Failure response |
|---|---|---|---|
| A1: every weekend role's `week` is a `YYYY-MM-DD` string (the schema type is `date`) | A malformed one is invisible to the range read | Step 3 diagnostics count per month; the existing integrity queue | Reported and fixed as data, outside P2 |
| A2: weekend receipts number in the hundreds | The unscoped evidence read grows | The Gate B bundle size | Scope by the `targetIdentity` range in a follow-up |
| A3: `tsx` resolves the repo's `@/` alias for the CLI | The CLI fails to start | Step 6 | Relative imports |
| A4: the local `owt-roles` env stays on `ortools==9.15.6755` (true on 2026-09-25) | Local and GCF solves diverge | The CLI's pin check | The fallback through the production solve route |
| A5: Frank plans in one production profile (spec assumption) | The primary export is incomplete | Gate A | Several exports; each runs as primary |
| A6: a debug build of the iOS shell is inspectable | That store cannot be exported | Gate A step 4 | Recorded; its months fall to rule 2's evidence |
| A7: the builder answers in well under 5 s | Slow Auto | Measured at the D1 smoke and D2 | Add `maxDuration` or narrow the reads |
| A8: direct tests of the two `server-only` modules run under vitest with `vi.mock("server-only", () => ({}))`, as ten existing route tests do | The step 3 tests cannot import their module | Step 3 | Test through the route with the same mocks |

## Open questions

| Question | Why it matters | Recommendation and why | Tradeoffs | Owner | Blocking? | Resolution point | Bounded default |
|---|---|---|---|---|---|---|---|
| **Q1.** What is the deployment-wide switch: a code constant or an env var? | It sets rollback speed and whether `docs/SECRETS.md` changes | **Code constant.** It is deployment-wide by construction, both paths stay CI-tested, and there is no new config surface. A Vercel env change also needs a redeploy, so it saves little | A rollback costs one pipeline pass through `preview` → PR → `main`. An env var skips code review and gates, but adds a SECRETS entry and a value that can drift | Frank | No | Before D1 implementation | Code constant |
| **Q2.** Where do exports, bundles and reports live? | They hold member names, and this repository is public | **`~/owt-private/p2-history/`**: outside the repository, outside the `Builds` tree, and outside iCloud-synced `Documents` | Any folder outside the repo works; the CLI enforces only "not in the repo" | Frank | No | Gate A | That path |
| **Q3.** Who runs the diff CLI? | An agent run pulls member names into an agent transcript | **Frank runs the one command.** An agent may then read only the report's totals section | Frank spends a minute. An agent run is easier but less private | Frank | No | Gate B | Frank runs it |

**Frank's gates are not open questions.** Accepting the `unverified` total by class, the
cutover decision (including losing the manual month exclusion), and the stop-point
confirmation are human gates B, C and D above. The spec assigns them to him explicitly.

## Spec reconciliations

- **R17 names "P2's review log",** but this plan is standard tier and gets none.
  Resolution: it is read as the P2 spec's review log (step 7), plus the ADR (D14).
- **R15 deletes `historyEntryFromDrafts`,** while the spec's Dependencies make
  `plannerModel.ts` additive-only. Resolution: the removal is confined to D3, sanctioned
  by R15, and limited to an export no production writer imports (re-verified at D3).
- **R14 says "`localStorage` is no longer read",** while R15 builds each dual-write "from
  `localStorage`'s own contents". Resolution: after the cutover the key is never read as
  a **history source**. It is read only to merge the rollback target (step 5, test 5).
- **R11's session grouping needs receipt `createdAt`,** which the existing receipt
  projection lacks. Resolution: a new additive projection (D6). This fills a gap; it is
  not a conflict.

## Handoff

- **To P4:**
  - `loadSolverHistory(target)`, called **directly** (bearer authentication; never the
    admin route);
  - the rule that a solve derives its history at solve time;
  - the rollback coupling after P4 ships (withdraw `solve_month`).
- **To P3:** the rebase rule on `serviceReadQueries.ts`, and ADR renumbering.
- **Roadmap:** if Gate C decides "not cut over", record the P4 scope change in the roadmap.
- **Review:** standard tier. There is no adversarial plan review; a fresh code review of
  each delivery's diff runs before `main`.
- **Implementation authorization: not granted by this plan.**

## Terminal state

READY — standard tier (roadmap: P2 implementation plan gets no adversarial plan review); implementation needs Frank's go-ahead.
