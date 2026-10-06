# Solver v3 · C2 — the fairness ledger and the monthly eligibility record Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record, once per calendar month, who was eligible for which voice role (`fairnessMonth`, at a private dotted id), compute from those records and the stored services each person's per-line fairness balance (the ledger, with X1 and a hand-computed golden fixture C5 must reproduce), serve it on `GET /api/admin/fairness`, write records through one guarded executor behind `PUT /api/admin/fairness/months`, and show the balance in a read-only «Equidad · vista previa» panel whose «Registrar» exists only under engine v3 — with nothing Auto sends, solves or writes changing.

**Architecture:** Neutral, crypto-free modules hold the vocabulary (`fairnessVocabulary.ts`), the ledger and X1 (`fairnessLedger.ts`), the one figure formatter (`fairnessFormat.ts`), the eligibility resolver (`fairnessEligibility.ts`), the six-key pattern map (`rolesOfPatternV3`, `plannerModel.ts`) and the per-month count (`capValueForMonth`, `serviceRuleContext.ts`). One neutral but not client-importable write-request module (`fairnessMonthWriteRequest.ts`, it hashes with `node:crypto`) owns the record's id and keys, validator, content hash, stored-record parser, write decision and the ONE write executor, whose clients are injected so C4's `tsx` script can use it; the protected-read audit gains an executor rule so its declaration and every call are registered `protected-write` sites. `fairnessMonthCommit.ts` (ADR-0043) and `fairnessLedgerRead.ts` are the server halves behind the two routes; the read builders are additive in `serviceReadQueries.ts`. The panel is a client component over a pure view-model, mounted beside `LeadPoolHistoryPanel` at both of its mounts.

**Tech Stack:** Next.js 16 App Router route handlers, React 19 client components, Sanity v5 (`@sanity/client` 7.25 transactions, GROQ), TypeScript with BigInt rationals, vitest + @testing-library/react (jsdom per file) + groq-js for executing GROQ in tests.

**Spec:** `docs/superpowers/specs/2026-10-05-solver-v3-c2-ledger-and-record-design.md` — APPROVED at **critical** tier by two sequential fresh reviewers (rounds 3/1 and 3/2) on SHA-256 `dbf2c40486a9705a779cbc656a935b329c0a59fd33e64d19f25459dc99e18d3e` (re-hashed 2026-10-06: unchanged). §7 is the single source of every interface (`IF2-1` … `IF2-29`); this plan never restates one differently and never edits the spec. Review log: `docs/superpowers/specs/2026-10-05-solver-v3-c2-ledger-and-record-design-review-log.md` — its open items have a disposition below. Parent: `docs/superpowers/specs/2026-10-05-solver-v3-fairness-design.md` (A1–A41; A41 is the key-hygiene rule). Siblings that consume C2 (read-only here): C4 (record reconstruction), C5 (solver function), C6 (planner v3), C7 (cutover plan). Executors read the spec and this plan together.

**Base and grounding.** C2's prerequisites are C1 (`countsForFairness`, `SOLVER_ENGINE`) and C3 (`sundayCadence`, `resolveRulePersonId`, `cadenceMembers`, `SOLVER_CONFIG_VERSION`) — spec §10. Neither is on `main` as this plan is written, so every path, anchor and line below was verified on their **integration**: `origin/main` **`03b45446`** + `claude/solver-v3-c1-fairness-toggle` **`61d9ef3d`** + `claude/solver-v3-c3-cadence-config` **`8a01caad`**, merged in that order. The merge conflicted in two places, both resolved minimally: `docs/UTILITIES_AND_COMPONENTS.md` keeps C1's «Fairness toggle» section and then C3's «Solver rule set» section, and `app/utils/__tests__/__fixtures__/colour-inventory.json` is regenerated (`node scripts/colour-inventory.mjs`); `MonthGenerator.tsx`, `plannerModel.ts`, `serviceCardModel.ts`, `CLAUDE.md`/`AGENTS.md`, `DATA_MODEL.md` and `API_REFERENCE.md` auto-merged. **Task 0 bases the C2 branch on `origin/main` AFTER both C1 and C3 have merged** — never on the integration itself. Baseline on the integration: `npx tsc --noEmit` 0 errors; `npm test` **448 files / 8130 tests**; `npx eslint .` **0 errors, 81 warnings**. After Task 16: **468 files / 8636 tests**, `tsc` 0, eslint 0 errors and 81 warnings.

**How this plan was verified.** The whole plan was executed once, task by task, in a throwaway clone of the integration under `/private/tmp/claude-501/` (outside every checkout), each task ending with the three gates green and a commit. Every **Create**/**Append**/**Find**→**Replace with** block below was then extracted from those commits, and the plan's own text was re-applied mechanically to a second fresh clone of the integration: every anchor matched exactly once at its point in the plan, each task's tree came out byte-identical to the executed one, each task's «Run it to see it fail» step failed and its gates passed. If `origin/main` has moved when you start, re-run each `Find` anchor before editing; a missing anchor is a stop-and-report, never a guess.

**How to read an edit step.** A **Create** step writes the whole file. An **Append** step adds the block at the end of the file, after one blank line. A **Find** … **Replace with** pair replaces text that occurs exactly once in that file at that point of the plan (an empty **Replace with** block deletes the found text). A **Regenerate** step runs the command shown. Line numbers in a task's **Files** list were read on the integration; earlier tasks shift them, so the `Find` text — never a number — is the anchor. **Stage before every test run** (`git add -A`): the audit, the caller pin and the Studio tests read `git ls-files`, so an unstaged new file is invisible to them and a correct change reads as red.

## Global Constraints

Every task's requirements include this section.

- **The spec is the contract** (`dbf2c404…`): REC-1–9, WR-1–17, LG-1–17, CAD-1–3, RD-1–6, RES-1–8, FX-1–5, UI-1–7, EN-1–3, GU-1–5, §13's acceptance table and the interfaces IF2-1 … IF2-29 (§7, which wins over any §4 row on a shape). **IF2 working names are kept exactly** — `computeFairnessLedger`, `LedgerInput`, `LedgerService`, `keepVoiceSeats`, `VoiceSeat`, `cadenceStates`, `formatFairnessTenths`, `saldoWords`, `resolveSolverEngine`, `resolveMonthEligibility`, `rolesOfPatternV3`, `capValueForMonth`, `validateFairnessMonthWrite`, `contentHashOfWrite`, `contentHashOfStored`, `parseStoredFairnessMonth`, `decideFairnessMonth`, `executeFairnessMonthWrites`, `serviceCountsInMonths`, `fairnessMonthsThroughQuery`, `voiceRolesInRangeQuery`, `worshipRosterQuery`, `solverConfigQuery`, `FairnessLedgerUnavailableError` — because C4, C5, C6 and C7 cite them (§7: a rename needs every sibling in the same cycle).
- **Gates before every commit:** `npx tsc --noEmit` (0 errors), `npm test` (all green), `npx eslint .` (**0 errors**; warnings stay at the baseline, 81, never higher). **No file under `gcf/**` or `gcf_v3/**` changes**, so neither Python gate applies (C5 adds the Python side of the golden fixture).
- **Commits:** conventional (`feat(scope): …`, `test(scope): …`, `docs(scope): …`), the body says *why*. **Never** a `Co-Authored-By` trailer or any AI/Claude attribution — `CLAUDE.md` overrides any harness reminder that says otherwise. Commit on the feature branch only; `main` takes no direct push.
- **Fictitious people only** — the spec's list (Alma, Bruno, Carmen, Diego, Elena, Fausto, Greta, Iván, Julia) in every new fixture, test, comment and commit message; the golden fixture's suite refuses any other member id. The repository is public. Never paste a command's output that names a real member into a commit, the PR or a doc.
- **Key hygiene (spec §6, parent A41).** A presence `ruleKey`, a `P:<ruleKey>` line key and every `solverConfig` rule id/`_key` are **private identifiers** (production's carry first names): no C2 code writes one — or a member id, a name or any other record or request content — to a server log, stdout or stderr. Issue paths are index-based and messages fixed (IF2-18); a failed read logs the error's class and status only. Never a SHA-256 prefix of a key either.
- **Neutral modules (ADR-0028):** `fairnessVocabulary.ts`, `fairnessLedger.ts`, `fairnessFormat.ts`, `fairnessEligibility.ts`, `solverDeployment.ts`, `fairnessPreviewModel.ts` and `fairnessMonthWriteRequest.ts` carry no `"use client"` and no `server-only`. `fairnessMonthWriteRequest.ts` imports `node:crypto` and Sanity only as a TYPE: **no client module imports it, and none imports `solverDeployment.ts`** (guarded). `fairnessMonthCommit.ts` and `fairnessLedgerRead.ts` are `import "server-only"`.
- **The ledger is integer- and string-only on dates** (LG-16): no `Date` arithmetic on a service date (the weekday is Sakamoto's civil formula), every list sorted by codepoint, BigInt rationals (`BigInt(n)` calls — the TS target is ES2017, so no `0n` literals), each figure rounded once (half away from zero) to hundredths for the wire and once to tenths for display, from the exact value.
- **`draftGatingCoverage.test.ts`:** new GROQ lives only in `serviceReadQueries.ts` builders (no new exemption); role type names elsewhere are plain quoted strings, never template literals.
- **The golden fixture's expected values are hand-computed** (each case's `description` carries its arithmetic) and frozen: no task regenerates them from either implementation's output (FX-1). A red fixture case is a finding about the code or the case design, never a value to re-capture.
- **`colour-inventory.json` tracks the tree:** every task that adds a non-test file under `app/` regenerates `app/utils/__tests__/__fixtures__/colour-inventory.json` with `node scripts/colour-inventory.mjs` in the same commit (Tasks 1, 2, 5, 8, 9, 11, 12, 13, 14).
- **`CLAUDE.md` and `AGENTS.md` stay byte-identical** outside their title and «## Continuous improvement» (`agentDocsParity.test.ts`): Task 16 makes every edit in both.
- **No production Sanity write** by the delivery or by any agent — and **no «Registrar» on dev**: `preview` writes the production dataset (`CLAUDE.md` «Vercel safety»), and the PUT answers `409 engine_not_v3` everywhere while `SOLVER_ENGINE` is `"v2"` and `OWT_SOLVER_ENGINE` is unset on Vercel. The release's checks are reads that print counts only.
- **ADR number:** `0050` is the next free number on the integration (C3 took `0049`). ADR numbers follow the order records reach `main`: if another record lands first, renumber in the merge of `main` into this branch — file name, title, index row and every pointer — and let `adrIndex.test.ts` confirm.
- **UI invariants (`CLAUDE.md`):** `Button` only; the tabs are the house `SegmentedControl`; the disclosure is `Collapse`; loading is `Skeleton`/`SkeletonGroup`; the dialog is `CueDialog` with `open={state}` (never a literal); the success flash is `useTransientValue`; no `motion` import outside `app/components/ui/**`; no fixed-bottom element; no new `<input>`/`<select>`; colour by tokens only; the desktop table scrolls inside its own `overflow-x-auto` box (ADR-0035); the client handler wraps `fetch` in try/catch/finally, checks `res.ok`, resets its flag and never closes as success on failure.
- **Known flake:** under full-suite load `ParticipationSidebar.test.tsx` › «goes back to leaving them out» can time out (pre-existing, unrelated, observed once while executing this plan); re-run the suite before treating it as a finding.

---
## File Structure

**Created — production**

| File | Responsibility | Spec |
|---|---|---|
| `app/utils/fairnessVocabulary.ts` | Neutral, crypto-free. Role keys in canonical order, statuses, lines, tabs, set-aside reasons, role → line, month arithmetic, the shared record limits and presence-key grammar, and every wire type (IF2-3 … IF2-9) the routes, ledger and panel share | IF2-1, IF2-3–IF2-9 |
| `app/utils/solverDeployment.ts` | `resolveSolverEngine(env)` (the ONE reader of `OWT_SOLVER_ENGINE`) and `fairnessRecordEnvironment(env)` (REC-2's stamp); pure, env injected, never client-imported | EN-2, REC-2, IF2-14 |
| `sanity/schemas/fairnessMonth.ts` | The record type: hidden, read-only, every field | REC-1–REC-5, REC-8 |
| `app/utils/fairnessMonthWriteRequest.ts` | The write-request module: id and keys, `validateFairnessMonthWrite`, the content hash (two entry points over one serialization), `buildFairnessMonthDocument`, `parseStoredFairnessMonth`, `decideFairnessMonth`, `executeFairnessMonthWrites` | REC-1–7, WR-3/4/7–11/14/16/17, IF2-18–IF2-22 |
| `app/utils/fairnessMonthCommit.ts` | `server-only`; the PUT's domain body (ADR-0043): engine gate, strict body, server stamps, one executor call with actor `route` | WR-1–WR-13 |
| `app/api/admin/fairness/months/route.ts` | `PUT`: authorization and JSON parse only, wrapped in `withVerificationRunContext` | WR-1, WR-2, IF2-4/5 |
| `app/utils/fairnessLedger.ts` | Neutral. `keepVoiceSeats` (record-free seat step), `cadenceStates` (X1), `computeFairnessLedger` (F2–F6) and `fairnessLedgerExactSums` (test-only exact sums) | LG-1–LG-17, CAD-1–3, IF2-10–IF2-12 |
| `app/utils/fairnessFormat.ts` | `formatFairnessTenths`, `saldoWords` — the ONE figure formatter | IF2-13, UI-4 |
| `fixtures/fairness/golden.json` | The hand-computed golden fixture: 22 `ledger` + 7 `cadence` cases | FX-1–FX-5, IF2-29 |
| `app/utils/fairnessLedgerRead.ts` | `server-only`; `loadFairnessLedger`: token check, reads, parser, ledger, horizon | RD-1–RD-3 |
| `app/api/admin/fairness/route.ts` | `GET`: the solver-history gate, parameters, one opaque 500 | RD-4, IF2-7 |
| `app/utils/fairnessEligibility.ts` | Neutral, client-callable `resolveMonthEligibility` | RES-1–RES-8, IF2-15 |
| `app/components/admin/fairnessPreviewModel.ts` | Neutral view-model: labels, chips, rows, «Motivo», X1 line, on-screen Sundays, every string | UI-3–UI-6, §8 |
| `app/components/admin/FairnessPreviewPanel.tsx` | `"use client"`: the disclosure, tabs, table/cards, out-group and «Registrar» | UI-1–UI-7 |
| `CONTEXT.md` | Domain glossary (it does not exist yet): registro de elegibilidad, saldo, línea, sub-línea de presencia | GU-4 |
| `docs/adr/0050-the-fairness-balance-is-measured-against-recorded-eligibility.md` | «El saldo de equidad se mide contra la elegibilidad registrada» | GU-3 |

**Created — tests and test fixtures**

`app/utils/__tests__/` — `fairnessVocabulary.test.ts`, `solverDeployment.test.ts`, `fairnessReadQueries.test.ts`, `fairnessMonthSchema.test.ts`, `fairnessMonthWriteRequest.test.ts`, `fairnessMonthDecision.test.ts`, `fairnessMonthExecutor.test.ts`, `fairnessFormat.test.ts`, `fairnessLedger.test.ts`, `fairnessGolden.test.ts`, `fairnessEligibility.test.ts`, and `__fixtures__/fakeFairnessSanity.ts` (an in-memory Content Lake: reads run the real GROQ with groq-js, transactions commit atomically and answer a lost race with the Content Lake's own 409 shape). `app/api/__tests__/` — `fairnessMonthsRoute.test.ts`, `fairnessLedgerRoute.test.ts`. `app/components/admin/__tests__/` — `patternRolesV3Sync.test.ts`, `capValueForMonth.test.ts`, `memberFitsRoleKey.test.ts`, `fairnessPreviewModel.test.ts`, `FairnessPreviewPanel.test.tsx`, `FairnessPreviewPanel.registrar.test.tsx`, `MonthGenerator.fairnessPreview.test.tsx`.

**Modified**

| File | Change | Task |
|---|---|---|
| `app/components/admin/plannerModel.ts` | `rolesOfPatternV3` after `rolesOfPattern`; `memberFitsRoleKey` after `memberFitsPool` | 1, 7 |
| `app/components/admin/serviceRuleContext.ts` | `capValueForMonth` after `completeSundaySpine` (see «Plan decisions») | 1 |
| `app/utils/serviceReadQueries.ts` | IF2-24 … IF2-28 plus the executor's two by-id reads | 3 |
| `app/utils/studioProtection.ts`, `sanity/schema.ts` | `fairnessMonth` governed (four lists) and registered | 4 |
| `app/utils/protectedReadAudit.ts` | `fairnessMonth` in `PROTECTED_TYPES` (4); `PROTECTED_WRITE_EXECUTORS` + the executor rule + the write-request module's `PROTECTED_RUNTIME_WRITERS` entry (7); the commit module's entry (8) | 4, 7, 8 |
| `app/components/admin/MonthGenerator.tsx` | `ExistingRole.countsForFairness?`; the preview mounted beside both lead-history mounts | 14 |
| `docs/SECRETS.md` | `OWT_SOLVER_ENGINE` (2); `SANITY_API_READ_TOKEN`'s new duty and blast radius (16) | 2, 16 |
| `docs/DATA_MODEL.md`, `docs/API_REFERENCE.md`, `docs/UTILITIES_AND_COMPONENTS.md`, `docs/adr/README.md`, `CLAUDE.md`, `AGENTS.md` | GU-3/GU-4 | 16 |
| Guard tests: `protectedReadAudit.test.ts` (4, 7, 8), `studioProtection.test.ts` (4), `serviceCommitCallers.test.ts` (5, 8, 11), `__fixtures__/deliveryCapableImports.ts` (8), `participationAlongside.test.tsx` (14), `__fixtures__/colour-inventory.json` (regenerated) | Each a reviewed, additive registration or a scope note; **no guard is loosened** | — |

**Deliberately untouched:** `app/components/admin/solverEngine.ts` and its test (C1's constant, EN-1), `app/utils/serviceReadModel.ts`'s unrelated `PROTECTED_TYPES` (REC-9) and `mcpProtectedTypeLiterals.test.ts`, `draftGatingCoverage.test.ts`'s lists, `LeadPoolHistoryPanel.tsx`, `ParticipationSidebar`, `computeParticipation`, the solver-history route and modules, everything Auto sends or solves (`buildSolveRequest`, the solve route), `gcf/**`, `gcf_v3/**`, every MCP file.

## Plan decisions (the spec leaves them to the plan)

| Decision | Choice | Why |
|---|---|---|
| The write-request module's file | `app/utils/fairnessMonthWriteRequest.ts` | Parallels `solverConfigWriteRequest.ts`/`roleWriteRequest.ts`; C4 cites it only as «the write-request module» |
| IF2-1's module; the environment stamp's and resolver's file | `fairnessVocabulary.ts`; `solverDeployment.ts` (both functions, separate logic: `development` is `local` for the stamp and NOT «unset» for the engine) | IF2-1 must be crypto-free; REC-2 puts the stamp outside the write-request module, «beside IF2-14» |
| IF2-15's and IF2-13's files | `fairnessEligibility.ts`, `fairnessFormat.ts` | Client-callable, so never in the write-request module |
| **IF2-17's placement** (review-log open item) | `capValueForMonth` in `serviceRuleContext.ts`, beside `completeSundaySpine`; `rolesOfPatternV3` stays in `plannerModel.ts` as IF2-16 says | `serviceRuleContext.ts` already imports `plannerModel` (`trailingSaturday`); putting IF2-17 in `plannerModel.ts` would import it back — the cycle the review log flagged |
| The stored revision after a write (§10 Assumption 4) | The commit's `transactionId`: Sanity sets every mutated document's `_rev` to it | It is exactly the revision of the content this request wrote; a re-read could return a later concurrent write's `_rev` and let a client assert a revision for content it never saw (WR-15) |
| Refusal codes in the shared error model (WR-12) | No new `SERVICE_CONFLICT_CODES`: `record_exists`, `record_missing`, `stale_revision` → `stale_revision`; every other refusal → `integrity_conflict` (WR-5's three as mandated). Clients branch on `details.detail` | Keeps the shared model unchanged; every one is a 409 with `conflict: true` |
| Executor result (IF2-22) | IF2-22's `{ month, verdict, rev, contentHash }` **plus** additive fields `ownVerdict`, `recordedAt`, `memberIds?`, `current?`, `cause?` | The PUT's IF2-5 bodies need each month's own decision (WR-9), the 200's `recordedAt`, the ids of a member refusal and the current record of `record_exists`; IF2-22 says nothing that forbids extra fields and no sibling reads them. In a route request refused as a whole, a month with no refusal of its own carries `verdict: { refused: <the request's detail> }` (why nothing was written for it) and its own decision in `ownVerdict` |
| Executor client types | `SanityClient` (a TYPE import, as IF2-22 writes it) | Structural stand-ins are not assignable from the real client's `Transaction.patch`; tests cast the fake |
| The `CLAUDE.md` line for the engine resolver (GU-4) | «… the ONE reader of `OWT_SOLVER_ENGINE`; it overrides `SOLVER_ENGINE` (`app/components/admin/solverEngine.ts`, C1's constant) only on the `preview` branch deployment and locally …» instead of GU-4's «`SOLVER_ENGINE` is the constant beside `SOLVER_SENDS_HISTORY`» | C1 put the constant in its own module, not beside `SOLVER_SENDS_HISTORY` (`solverHistorySource.ts`); the docs must say where it is. Same meaning, one line, which C6 DOC-3 then does not repeat |
| The reconstruction actor's `recordedBy` | The exported constant `RECONSTRUCTION_RECORDED_BY = "script:reconstruct-fairness-months"`; the executor throws before any read on any other value for that actor (C4 imports and passes it) | WR-14: «a fixed non-member marker naming the script (never a member id)» — enforced, not hoped for |
| The audit's executor rule | Before the no-client early return; one site per operation; `function NAME` → «declares», `NAME(` → «calls»; comments stripped; an aliased import is not chased (the caller pin backstops it) | GU-5 |
| The caller pin's scan | `git ls-files app scripts` for every pinned module | No script imports any other pinned module today, so no existing row loosens (GU-1 allows either) |
| A member document with no display name | Refused `member_unknown` by the executor, both actors | «No item is ever written without a name» (REC-3) and the parser would then refuse the record (review-log open item) |
| A pool in RES-1 | The **effective** pool: ticked AND fitting the pool's subtype by current Tipo (`memberFitsPool`); RES-1's per-role fit is then applied too | A stale tick is invisible on screen and C3 §6.7 already reads it as no pool; the generated RES-8 test ticks ids at random, stale ticks included (review-log open item) |
| `unknownMembers` (LG-15 vs IF2-8 disagree) | IF2-8's definition: every `people` item with `exists: false` | §7: the item wins over a §4 row (review-log open item) |
| The cumulative span in the fixture | The fixture's cumulative case lists its pre-window month in `expected.months` (vitest checks it by re-targeting the ledger one month after it); the cumulative totals themselves are asserted in `fairnessLedger.test.ts` | IF2-29 has no cumulative field and is the contract (review-log open item) |
| The fixture's header (FX-5) | One top-level `$comment` key, ignored by both suites | JSON has no comments; it is the only key outside IF2-29's shape and the suite pins it |
| A «Registrar» ceiling | Offered only up to the current month + 12 | WR-4 refuses later months; the year select reaches 2035 (review-log open item) |
| The panel's month change | Mounted with `key={YYYY-MM}`: a new month starts closed and re-reads on open | UI-3's «loads on first open» per month |

## Review-log open items (no recorded disposition in the approved text)

| Item | Disposition |
|---|---|
| An `unchanged` month's `rev` can be stale if a concurrent replace lands | Accepted and stated in ADR-0050 «Consequences»: the panel re-reads the GET on any 409 (WR-15), so a retry asserts the current revision; nothing is overwritten |
| RES-1: raw tick or Tipo-filtered pool | Tipo-filtered (effective) pool — «Plan decisions»; the generated test includes stale ticks |
| IF2-17 in `plannerModel.ts` would be an import cycle | `serviceRuleContext.ts` — «Plan decisions» |
| FX-4's cumulative span has no IF2-29 field | «Plan decisions» |
| A member with neither alias nor `member_name` | `member_unknown` — «Plan decisions» |
| §14's «records only through C4's script» overstates the safe end state | Stated in ADR-0050, `docs/SECRETS.md`'s `OWT_SOLVER_ENGINE` entry and the release notes: a local server with `OWT_SOLVER_ENGINE=v3` and `VERCEL_ENV` unset also writes production records, stamped `local` |
| The dotted-id read under the `published` perspective is unverified | Precedent recorded in ADR-0050 (`roleTarget.*` locks are dotted and read through `operationalClient` by `roleWriteOps.ts`), plus a **read-only** probe in Release step 4 (counts only, token vs no token) before the merge |
| UI-6 has no ceiling guard | Ceiling at current + 12 — «Plan decisions» |
| WR-11/IF2-22: «every non-system field» for `set` | Done: the replace sets every field of the new document except `_id`/`_type` and unsets every other non-system top-level field (Task 7 test) |
| Name `serviceDayKey` as the date normalizer | `fairnessLedger.ts`'s seat step and `fairnessLedgerRead.ts` normalise every stored date through `serviceDayKey` |
| `unknownMembers` defined twice | IF2-8's — «Plan decisions» |
| REC-9/GU-1 should name the `PROTECTED_RUNTIME_WRITERS` pin | Tasks 7 and 8 edit it (`protectedReadAudit.test.ts`, «licenses the … permanent runtime writers») |
| RD-2/RD-4 logging of a raw client error | Class and status only (`fairnessErrorClass`); a test proves a URL carrying `$ids` never reaches the log |
| §3's description of `canonicalOrigin` | Irrelevant to the implementation: EN-2 is explicit that `development` answers the constant (Task 2 test) |

The review log itself is never edited by this plan; the coordinator records these as post-approval dispositions when the cycle closes.

---
## Task 0: Branch, entry gate and baseline

**Files:** none.

- [ ] **Step 1: Confirm C1 and C3 are on `main`** (spec §10: C2 waits for them; it never re-implements their rules)

```bash
git fetch origin
git ls-tree --name-only origin/main app/utils/countsForFairness.ts app/components/admin/solverEngine.ts app/utils/sundayCadence.ts
grep -c "SOLVER_CONFIG_VERSION" <(git show origin/main:app/utils/solverConfigWriteRequest.ts)
```

Expected: all three paths listed, and a count of at least 1. If any is missing, **stop**: C2 is not implementable yet (EN-1: C2 never creates `solverEngine.ts` itself).

- [ ] **Step 2: Branch from the current `main`**

```bash
git switch -c claude/solver-v3-c2-ledger-and-record origin/main
git log -1 --oneline
```

If the coordinator runs this in a worktree (`CLAUDE.md`: only when two things must be in flight at once), use `EnterWorktree`, populate `node_modules` with `cp -Rc` from a checkout whose `package-lock.json` matches (never a fresh install; the primary checkout's `node_modules` was stale on 2026-09-25 — check `node_modules/.package-lock.json` against a fresh worktree's), and symlink `.env.local` to the primary checkout's copy (`ln -s ../../../.env.local .env.local` from the worktree root) — never write one inside the worktree.

- [ ] **Step 3: Record the baseline and re-check the anchors**

Run: `npx tsc --noEmit && npx eslint . 2>&1 | tail -1`
Expected: no `tsc` output; `✖ 81 problems (0 errors, 81 warnings)` (if `main` has moved, record the new count — it is the ceiling for the whole delivery). Every later `Find` block must match exactly once; if C1/C3 merged with different text than their branch tips (`61d9ef3d`, `8a01caad`), compare the anchors in Tasks 1, 4, 14 and 16 first.

---

## Task 1: The vocabulary, the six-key pattern map and the per-month count — [standard]

Spec IF2-1, IF2-16 (RES-2), IF2-17 (RES-3). The shared, crypto-free vocabulary every later task imports; `rolesOfPatternV3` beside `rolesOfPattern`, synced by test; `capValueForMonth` as a typed result over `resolvedCapValue`.

**Files:**
- Create: `app/utils/fairnessVocabulary.ts`
- Modify: `app/components/admin/plannerModel.ts` (imports at `:53`; after `rolesOfPattern`, `:703-715`)
- Modify: `app/components/admin/serviceRuleContext.ts` (import at `:1`; after `completeSundaySpine`, `:28-42`)
- Test: `app/utils/__tests__/fairnessVocabulary.test.ts`, `app/components/admin/__tests__/patternRolesV3Sync.test.ts`, `app/components/admin/__tests__/capValueForMonth.test.ts`
- Regenerate: `app/utils/__tests__/__fixtures__/colour-inventory.json`

**Interfaces:**
- Consumes: `rolesOfPattern`, `LEGACY_PATTERN_ALIASES`, `resolvedCapValue`, `RestrictionCap` (`plannerModel.ts`); `completeSundaySpine` (`serviceRuleContext.ts`).
- Produces: from `fairnessVocabulary.ts` — `ROLE_KEYS`, `RoleKey`, `STATUSES`, `Status`, `LineKey`, `TabKey`, `TAB_KEYS`, `SET_ASIDE_REASONS`, `SetAsideReason`, `ROLE_LINE`, `SUNDAY_KEYS`, `SATURDAY_KEYS`, `RoleClass`, `ROLE_CLASS_ORDER`, `roleClassOf`, `isRoleKey`, `isStatus`, `canonicalRoles`, `tabOfLine`, `compareCodepoint`, `MONTH_RE`, `isMonthString`, `monthIndex`, `monthFromIndex`, `shiftMonth`, and the types `FairnessMonthWrite`, `FairnessMonthsPut`, `FairnessMonthBody`, `RecordSource`, `RecordEngine`, `RecordEnvironment`, `LogicalRecord`, `FairnessMonthsPutOk`, `FAIRNESS_PUT_REFUSALS`/`FairnessPutRefusal`, `FAIRNESS_WRITE_REFUSALS`/`FairnessWriteRefusal`, `FairnessMonthsPutConflictDetails`, `Figures`, `RecordSummary`, `NOTE_CODES`/`NoteCode`/`Note`, `FairnessPersonMonth`, `FairnessPerson`, `FairnessLedgerResponse`, `FAIRNESS_UNAVAILABLE_MESSAGE`. `rolesOfPatternV3(pattern: string): RoleKey[]` (`plannerModel.ts`); `capValueForMonth(cap: RestrictionCap, month: string): { ok: true; count: number } | { ok: false; reason: "not_whole" | "negative" }` (`serviceRuleContext.ts`).

- [ ] **Step 1: Write the failing tests**

**Create** `app/utils/__tests__/fairnessVocabulary.test.ts`:

````ts
// Solver v3 C2 IF2-1 — the vocabulary every C2 surface shares. The canonical role
// order is a contract (the record, the hash, the expansion and the wire carry it),
// and month arithmetic is integers only — never a `Date` (LG-12, LG-16).
import { describe, expect, it } from "vitest";

import {
  FAIRNESS_PUT_REFUSALS,
  FAIRNESS_WRITE_REFUSALS,
  NOTE_CODES,
  ROLE_KEYS,
  ROLE_LINE,
  SET_ASIDE_REASONS,
  canonicalRoles,
  compareCodepoint,
  isMonthString,
  isRoleKey,
  isStatus,
  monthFromIndex,
  monthIndex,
  roleClassOf,
  shiftMonth,
  tabOfLine,
} from "../fairnessVocabulary";

describe("fairness vocabulary (C2 IF2-1)", () => {
  it("names the six role keys in the canonical role order", () => {
    expect([...ROLE_KEYS]).toEqual(["Sun.Lead", "Sat.Lead", "Sun.BGV", "Sat.BGV", "Sun.Choir", "Sat.Choir"]);
  });

  it("maps every role key to its line", () => {
    expect(ROLE_LINE).toEqual({
      "Sun.Lead": "DL",
      "Sat.Lead": "SL",
      "Sun.BGV": "BGV",
      "Sat.BGV": "BGV",
      "Sun.Choir": "CORO",
      "Sat.Choir": "CORO",
    });
  });

  it("folds every presence sub-line into the BGV tab", () => {
    expect(tabOfLine("DL")).toBe("DL");
    expect(tabOfLine("CORO")).toBe("CORO");
    expect(tabOfLine("P:any-rule")).toBe("BGV");
  });

  it("orders and de-duplicates role lists canonically", () => {
    expect(canonicalRoles(["Sat.Choir", "Sun.Lead", "Sat.Choir", "Sun.BGV"])).toEqual(["Sun.Lead", "Sun.BGV", "Sat.Choir"]);
  });

  it("classifies seats Lead, BGV, Choir", () => {
    expect(ROLE_KEYS.map(roleClassOf)).toEqual(["Lead", "Lead", "BGV", "BGV", "Choir", "Choir"]);
  });

  it("guards role keys and statuses", () => {
    expect(isRoleKey("Sat.Choir")).toBe(true);
    expect(isRoleKey("Sat.choir")).toBe(false);
    expect(isRoleKey(undefined)).toBe(false);
    expect(isStatus("exact")).toBe(true);
    expect(isStatus("maybe")).toBe(false);
  });

  it("does month arithmetic on integers, across year boundaries", () => {
    expect(isMonthString("2026-11")).toBe(true);
    expect(isMonthString("2026-13")).toBe(false);
    expect(monthFromIndex(monthIndex("2026-01") - 1)).toBe("2025-12");
    expect(shiftMonth("2026-11", 2)).toBe("2027-01");
    expect(shiftMonth("2027-01", -3)).toBe("2026-10");
  });

  it("compares by codepoint, never by locale", () => {
    expect(["b", "B", "a", "Á"].sort(compareCodepoint)).toEqual(["B", "a", "b", "Á"]);
  });

  it("keeps the closed lists of codes the copy tables are keyed on", () => {
    expect(FAIRNESS_PUT_REFUSALS).toHaveLength(9);
    expect(FAIRNESS_WRITE_REFUSALS).toEqual([
      ...FAIRNESS_PUT_REFUSALS,
      "not_past_month",
      "not_reconstruction_owned",
      "record_edited",
      "invalid_body",
    ]);
    expect(NOTE_CODES).toHaveLength(14);
    expect(SET_ASIDE_REASONS).toEqual(["second_seat", "exact", "cadence", "not_in_record", "outside_population", "floor"]);
  });
});
````

**Create** `app/components/admin/__tests__/patternRolesV3Sync.test.ts`:

````ts
// Solver v3 C2 RES-2 / IF2-16 — `rolesOfPatternV3`, the ONE v3 six-key pattern map,
// against `rolesOfPattern`, the ONE v2 map (which `patternRolesSync.test.ts` keeps in
// step with the solver). The relation is the contract: restricted to v2's five keys the
// two agree on every pattern, and `Sat.Choir` is added exactly when a pattern covers
// chorus on Saturday. The pattern set is read from the rule form itself (`PATTERNS` and
// `EXCL_PATTERNS` in MonthGenerator.tsx), so a new saveable pattern joins this test the
// day it joins the form.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { LEGACY_PATTERN_ALIASES, rolesOfPattern, rolesOfPatternV3 } from "../plannerModel";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FORM = readFileSync(path.join(HERE, "../MonthGenerator.tsx"), "utf8");

/** The quoted pattern values of one `const NAME … = [ … ];` in the rule form. */
function formList(name: string): string[] {
  const start = FORM.indexOf(`const ${name}`);
  if (start === -1) throw new Error(`${name} not found in MonthGenerator.tsx`);
  const body = FORM.slice(start, FORM.indexOf("];", start));
  const values = name === "PATTERNS"
    ? [...body.matchAll(/value:\s*"([^"]+)"/g)].map((m) => m[1])
    : [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  if (values.length === 0) throw new Error(`${name} parsed empty`);
  return values;
}

const SAVEABLE = [...new Set([...formList("PATTERNS"), ...formList("EXCL_PATTERNS")])];
const ALIASES = [...LEGACY_PATTERN_ALIASES.keys()];
const SAT_CHOIR_PATTERNS = new Set(["Sat.*", "*.Choir", "*.*", "Sat.Choir", "Choir.*"]);
const ALL = [...SAVEABLE, ...ALIASES, "Sat.Choir", "*.Choir", "Sun.Lead.X", "", "Sat.LeadBGV", "constructor"];

describe("rolesOfPatternV3 against rolesOfPattern (C2 RES-2)", () => {
  it("reads a real pattern list from the rule form", () => {
    expect(SAVEABLE.length).toBeGreaterThanOrEqual(11);
    expect(SAVEABLE).toContain("*.LeadBGV");
  });

  it.each(ALL)("restricted to v2's five keys, equals rolesOfPattern for %j", (pattern) => {
    expect(rolesOfPatternV3(pattern).filter((k) => k !== "Sat.Choir")).toEqual(rolesOfPattern(pattern));
  });

  it.each(ALL)("adds Sat.Choir exactly when %j covers chorus on Saturday", (pattern) => {
    expect(rolesOfPatternV3(pattern).includes("Sat.Choir")).toBe(SAT_CHOIR_PATTERNS.has(pattern));
  });

  it("answers in canonical role order", () => {
    expect(rolesOfPatternV3("*.*")).toEqual(["Sun.Lead", "Sat.Lead", "Sun.BGV", "Sat.BGV", "Sun.Choir", "Sat.Choir"]);
    expect(rolesOfPatternV3("Sat.*")).toEqual(["Sat.Lead", "Sat.BGV", "Sat.Choir"]);
    expect(rolesOfPatternV3("Choir.*")).toEqual(["Sun.Choir", "Sat.Choir"]);
    expect(rolesOfPatternV3("*.LeadBGV")).toEqual(["Sun.Lead", "Sat.Lead", "Sun.BGV", "Sat.BGV"]);
    expect(rolesOfPatternV3("nonsense")).toEqual([]);
  });
});
````

**Create** `app/components/admin/__tests__/capValueForMonth.test.ts`:

````ts
// Solver v3 C2 RES-3 / IF2-17 — `capValueForMonth`, the ONE per-month count resolution:
// `resolvedCapValue` over every Sunday of the calendar month, as a typed result that is
// never rounded, truncated or clamped beyond `resolvedCapValue`'s own `max(0, ·)`.
import { describe, expect, it } from "vitest";

import type { RestrictionCap } from "../plannerModel";
import { capValueForMonth } from "../serviceRuleContext";

const cap = (patch: Partial<RestrictionCap>): RestrictionCap => ({
  id: "c1", pattern: "Sun.Lead", op: "==", value: 2, relative: false, relOffset: 0, ...patch,
});

// November 2026 has 5 Sundays (1, 8, 15, 22, 29); October 2026 has 4 (4, 11, 18, 25).
describe("capValueForMonth (C2 IF2-17)", () => {
  it("answers a fixed whole value as it is", () => {
    expect(capValueForMonth(cap({ value: 2 }), "2026-11")).toEqual({ ok: true, count: 2 });
    expect(capValueForMonth(cap({ value: 0 }), "2026-11")).toEqual({ ok: true, count: 0 });
  });

  it("resolves a relative cap against the month's full Sunday count", () => {
    expect(capValueForMonth(cap({ relative: true, relOffset: 2 }), "2026-11")).toEqual({ ok: true, count: 3 });
    expect(capValueForMonth(cap({ relative: true, relOffset: 2 }), "2026-10")).toEqual({ ok: true, count: 2 });
  });

  it("answers 0 for a relative cap clamped by resolvedCapValue, fractional offset included", () => {
    expect(capValueForMonth(cap({ relative: true, relOffset: 6 }), "2026-10")).toEqual({ ok: true, count: 0 });
    expect(capValueForMonth(cap({ relative: true, relOffset: 4.5 }), "2026-10")).toEqual({ ok: true, count: 0 });
  });

  it("refuses a fractional or non-finite result as not_whole, never rounded", () => {
    expect(capValueForMonth(cap({ value: 1.5 }), "2026-11")).toEqual({ ok: false, reason: "not_whole" });
    expect(capValueForMonth(cap({ relative: true, relOffset: 0.5 }), "2026-11")).toEqual({ ok: false, reason: "not_whole" });
    expect(capValueForMonth(cap({ value: Number.NaN }), "2026-11")).toEqual({ ok: false, reason: "not_whole" });
    expect(capValueForMonth(cap({ value: Number.POSITIVE_INFINITY }), "2026-11")).toEqual({ ok: false, reason: "not_whole" });
    expect(capValueForMonth(cap({ value: Number.NEGATIVE_INFINITY }), "2026-11")).toEqual({ ok: false, reason: "not_whole" });
  });

  it("refuses a fixed negative whole value as negative", () => {
    expect(capValueForMonth(cap({ value: -1 }), "2026-11")).toEqual({ ok: false, reason: "negative" });
  });

  it("has no upper bound of its own (RES-3 adds 31 for == caps)", () => {
    expect(capValueForMonth(cap({ value: 32 }), "2026-11")).toEqual({ ok: true, count: 32 });
  });
});
````

- [ ] **Step 2: Run them to see them fail**

Run: `git add -A && npx vitest run app/utils/__tests__/fairnessVocabulary.test.ts app/components/admin/__tests__/patternRolesV3Sync.test.ts app/components/admin/__tests__/capValueForMonth.test.ts`
Expected: FAIL — `../fairnessVocabulary` does not resolve, and `rolesOfPatternV3`/`capValueForMonth` are not exported.

- [ ] **Step 3: Implement**

**Create** `app/utils/fairnessVocabulary.ts`:

````ts
// app/utils/fairnessVocabulary.ts
//
// Solver v3 C2 — the fairness vocabulary (spec IF2-1) and the wire shapes every
// C2 surface shares (IF2-3 … IF2-9). NEUTRAL (ADR-0028): no "use client", no
// `server-only`, no Sanity client and no `node:crypto`, so the ledger, the
// eligibility resolver, the panel and the routes import ONE definition. The
// write-request module (which hashes with `node:crypto`) imports from here,
// never the other way round.
//
// Units and sign (spec §4 vocabulary, LG-13): every fairness figure — `share`,
// `received`, `balance` — is integer HUNDREDTHS of a seat, positive = owed («le
// deben»); `received` is 100 × the seats counted; `balance` is `share − received`.
// Display tenths and seat counts are separate fields (IF2-8), never fed back into
// a computation.

/** The six role keys, in the CANONICAL ROLE ORDER (IF2-1). Every role-key list on the wire uses it. */
export const ROLE_KEYS = ["Sun.Lead", "Sat.Lead", "Sun.BGV", "Sat.BGV", "Sun.Choir", "Sat.Choir"] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const STATUSES = ["in", "out", "exact"] as const;
export type Status = (typeof STATUSES)[number];

export type LineKey = "DL" | "SL" | "BGV" | "CORO" | `P:${string}`;
export type TabKey = "DL" | "SL" | "BGV" | "CORO" | "TOTAL";
export const TAB_KEYS: readonly TabKey[] = ["DL", "SL", "BGV", "CORO", "TOTAL"];

export const SET_ASIDE_REASONS = [
  "second_seat",
  "exact",
  "cadence",
  "not_in_record",
  "outside_population",
  "floor",
] as const;
export type SetAsideReason = (typeof SET_ASIDE_REASONS)[number];

/** Role key → line (§4 vocabulary). Presence sub-lines `P:<ruleKey>` are not role lines. */
export const ROLE_LINE: Readonly<Record<RoleKey, "DL" | "SL" | "BGV" | "CORO">> = {
  "Sun.Lead": "DL",
  "Sat.Lead": "SL",
  "Sun.BGV": "BGV",
  "Sat.BGV": "BGV",
  "Sun.Choir": "CORO",
  "Sat.Choir": "CORO",
};

/** The Sunday-class and Saturday-class keys of a service (LG-4: a counted special by day class). */
export const SUNDAY_KEYS: readonly RoleKey[] = ["Sun.Lead", "Sun.BGV", "Sun.Choir"];
export const SATURDAY_KEYS: readonly RoleKey[] = ["Sat.Lead", "Sat.BGV", "Sat.Choir"];

/** Lead > BGV > Choir — the one seat-class order (LG-4, LG-7, LG-11). */
export type RoleClass = "Lead" | "BGV" | "Choir";
export const ROLE_CLASS_ORDER: readonly RoleClass[] = ["Lead", "BGV", "Choir"];

export function roleClassOf(key: RoleKey): RoleClass {
  return key.slice(4) as RoleClass;
}

export function isRoleKey(v: unknown): v is RoleKey {
  return typeof v === "string" && (ROLE_KEYS as readonly string[]).includes(v);
}

export function isStatus(v: unknown): v is Status {
  return typeof v === "string" && (STATUSES as readonly string[]).includes(v);
}

/** Distinct keys in canonical role order. */
export function canonicalRoles(keys: Iterable<RoleKey>): RoleKey[] {
  const set = new Set(keys);
  return ROLE_KEYS.filter((k) => set.has(k));
}

/** The display tab a line folds into (LG-14): every `P:*` sub-line folds into BGV. */
export function tabOfLine(line: LineKey): Exclude<TabKey, "TOTAL"> {
  if (line === "DL" || line === "SL" || line === "BGV" || line === "CORO") return line;
  return "BGV";
}

/** Codepoint comparison — never `localeCompare` (LG-16, REC-6). */
export function compareCodepoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ─── Months ─────────────────────────────────────────────────────────────────

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isMonthString(v: unknown): v is string {
  return typeof v === "string" && MONTH_RE.test(v);
}

/** `YYYY-MM` → an integer index (year × 12 + month − 1). Integer arithmetic, never a `Date`. */
export function monthIndex(month: string): number {
  return Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
}

/** The inverse of {@link monthIndex}, zero-padded. */
export function monthFromIndex(index: number): string {
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

export function shiftMonth(month: string, by: number): string {
  return monthFromIndex(monthIndex(month) + by);
}

// ─── Wire shapes ────────────────────────────────────────────────────────────

/** IF2-4 — one month of `PUT /api/admin/fairness/months`. */
export interface FairnessMonthWrite {
  month: string;
  source: "auto" | "manual";
  expectedRev: string | null;
  people: Array<{
    memberId: string;
    roles: Record<RoleKey, Status>;
    exactRules: Array<{ roles: RoleKey[]; count: number }>;
    sundayCadence?: "alternate";
    exempt: boolean;
    blocks: Array<{ date: string; unavailable: boolean; excludedRoles: RoleKey[] }>;
  }>;
  presence: Array<{ ruleKey: string; roles: RoleKey[]; members: string[]; exclusive: boolean }>;
}

/** IF2-4 — the request body. 1–2 entries, consecutive and ascending. */
export interface FairnessMonthsPut {
  months: FairnessMonthWrite[];
}

/** The logical content of one month — a body without `source`/`expectedRev`. */
export type FairnessMonthBody = Omit<FairnessMonthWrite, "source" | "expectedRev">;

export type RecordSource = "auto" | "manual" | "reconstructed";
export type RecordEngine = "v2" | "v3";
export type RecordEnvironment = "production" | "preview" | "local";

/** IF2-3 — the logical record (GET `horizon[].record`, fixture records, the parser's output). */
export interface LogicalRecord {
  month: string;
  rev: string;
  contentHash: string;
  source: RecordSource;
  engine: RecordEngine;
  environment: RecordEnvironment;
  recordedAt: string;
  people: Array<FairnessMonthWrite["people"][number] & { name: string }>;
  presence: FairnessMonthWrite["presence"];
}

/** IF2-5 — the PUT's 200. */
export interface FairnessMonthsPutOk {
  months: Array<{
    month: string;
    outcome: "created" | "replaced" | "unchanged";
    rev: string;
    contentHash: string;
    recordedAt: string;
  }>;
}

/** IF2-6 — the refusal codes the PUT can answer in `details.detail`. */
export const FAIRNESS_PUT_REFUSALS = [
  "record_exists",
  "record_missing",
  "stale_revision",
  "month_has_services",
  "past_month",
  "engine_not_v3",
  "member_unknown",
  "member_not_worship",
  "tipo_mismatch",
] as const;
export type FairnessPutRefusal = (typeof FAIRNESS_PUT_REFUSALS)[number];

/** IF2-6 — every refusal the executor can answer, for either actor. */
export const FAIRNESS_WRITE_REFUSALS = [
  ...FAIRNESS_PUT_REFUSALS,
  "not_past_month",
  "not_reconstruction_owned",
  "record_edited",
  "invalid_body",
] as const;
export type FairnessWriteRefusal = (typeof FAIRNESS_WRITE_REFUSALS)[number];

/** IF2-5 — `details` of a PUT 409. */
export interface FairnessMonthsPutConflictDetails {
  detail: FairnessPutRefusal;
  months: Array<{ month: string; verdict: "create" | "replace" | "unchanged" | FairnessPutRefusal }>;
  cause?: "commit_conflict";
  rev?: string;
  source?: RecordSource;
  recordedAt?: string;
  memberIds?: string[];
}

/** IF2-8 — figures for one line or tab. Fairness figures are hundredths; `seats` and `tenths` are display. */
export interface Figures {
  share: number;
  received: number;
  balance: number;
  seats: number;
  tenths: { share: number; balance: number };
}

export interface RecordSummary {
  rev: string;
  source: RecordSource;
  engine: RecordEngine;
  environment: RecordEnvironment;
  recordedAt: string;
}

/** IF2-9 — the closed set of notes, in their display order (§8). */
export const NOTE_CODES = [
  "unrecorded_month",
  "not_listed",
  "role_out",
  "unavailable",
  "rule_excluded",
  "exact",
  "exact_clamped",
  "cadence_set_aside",
  "cadence_no_sunday_saturday",
  "floor_seat",
  "presence",
  "outside_population",
  "second_seat",
  "exempt",
] as const;
export type NoteCode = (typeof NOTE_CODES)[number];

export type Note = { line?: LineKey } & (
  | { code: "unrecorded_month" }
  | { code: "not_listed" }
  | { code: "role_out" }
  | { code: "unavailable"; dates: string[] }
  | { code: "rule_excluded"; dates: string[] }
  | { code: "exact"; roles: RoleKey[]; count: number }
  | { code: "exact_clamped"; count: number; available: number }
  | { code: "cadence_set_aside"; dates: string[] }
  | { code: "cadence_no_sunday_saturday"; dates: string[] }
  | { code: "floor_seat"; date: string; roleKey: RoleKey }
  | { code: "presence"; ruleKey: string; members: string[] }
  | { code: "outside_population"; dates: string[] }
  | { code: "second_seat"; dates: string[] }
  | { code: "exempt" }
);

export interface FairnessPersonMonth {
  month: string;
  recorded: boolean;
  listed: boolean;
  lines: Partial<Record<LineKey, Figures>>;
  held: Partial<Record<RoleKey, number>>;
  setAsides: Array<{ date: string; serviceId: string; roleKey: RoleKey; reason: SetAsideReason }>;
  notes: Note[];
}

export interface FairnessPerson {
  memberId: string;
  name: string;
  exists: boolean;
  window: Partial<Record<LineKey, Figures>>;
  cumulative: Partial<Record<LineKey, Figures>>;
  tabs: { window: Partial<Record<TabKey, Figures>>; cumulative: Partial<Record<TabKey, Figures>> };
  sang: number;
  exempt: boolean;
  months: FairnessPersonMonth[];
  countedSundayLeads: string[];
  firstRecordedIn: Partial<Record<RoleKey, string>>;
}

/** IF2-8 — the GET's 200 body. */
export interface FairnessLedgerResponse {
  v: 1;
  engine: RecordEngine;
  environment: RecordEnvironment;
  currentMonth: string;
  target: string;
  window: Array<{ month: string; record: RecordSummary | null }>;
  recordsSince: string | null;
  horizon: Array<{ month: string; record: LogicalRecord | null; storedServices: number; recordBinds: boolean }>;
  people: FairnessPerson[];
  diagnostics: {
    duplicateTargets: Array<{ type: string; date: string; roleIds: string[] }>;
    notInRecordSeats: number;
    unknownMembers: string[];
  };
}

/** IF2-7 — the GET's failure body. */
export const FAIRNESS_UNAVAILABLE_MESSAGE = "No se pudo leer el saldo de equidad.";
````

**Find** in `app/components/admin/plannerModel.ts`:

````ts
import { WORSHIP_NIGHT_FORMAT, type ServiceFormat } from "@/app/utils/serviceFormat";
import { countsForFairnessDefault } from "@/app/utils/countsForFairness";

// ─── Grid shape ───────────────────────────────────────────────────────────────
````

**Replace with:**

````ts
import { WORSHIP_NIGHT_FORMAT, type ServiceFormat } from "@/app/utils/serviceFormat";
import { countsForFairnessDefault } from "@/app/utils/countsForFairness";
import { canonicalRoles, type RoleKey } from "@/app/utils/fairnessVocabulary";

// ─── Grid shape ───────────────────────────────────────────────────────────────
````

**Find** in `app/components/admin/plannerModel.ts`:

````ts
  const role = ROLE_ORDER.find((r) => r === p);
  return role ? [role] : [];
}

````

**Replace with:**

````ts
  const role = ROLE_ORDER.find((r) => r === p);
  return role ? [role] : [];
}

/**
 * THE v3 six-key pattern expansion (solver v3 C2 RES-2, IF2-16). Restricted to v2's five
 * keys it is exactly `rolesOfPattern` — which stays the ONE v2 map, untouched — and it adds
 * `Sat.Choir` exactly when the pattern covers chorus on Saturday: `Sat.*`, `*.Choir`, `*.*`,
 * `Sat.Choir`, and their legacy aliases. `[]` for anything else, never a guess; canonical
 * role order (IF2-1). The record's exclusions, exact rules and presence roles, and every v3
 * rule C6 sends, are expanded through this one function. `patternRolesV3Sync.test.ts`
 * holds the relation to `rolesOfPattern` for every saveable pattern and alias.
 */
export function rolesOfPatternV3(pattern: string): RoleKey[] {
  const p = LEGACY_PATTERN_ALIASES.get(pattern) ?? pattern;
  const satChoir = p === "Sat.*" || p === "*.Choir" || p === "*.*" || p === "Sat.Choir";
  return canonicalRoles([...rolesOfPattern(pattern), ...(satChoir ? (["Sat.Choir"] as const) : [])]);
}

````

**Find** in `app/components/admin/serviceRuleContext.ts`:

````ts
import { trailingSaturday } from "./plannerModel";
import type { ServiceType } from "./serviceCardModel";

````

**Replace with:**

````ts
import { resolvedCapValue, trailingSaturday, type RestrictionCap } from "./plannerModel";
import type { ServiceType } from "./serviceCardModel";

````

**Find** in `app/components/admin/serviceRuleContext.ts`:

````ts
  }
  return dates;
}

````

**Replace with:**

````ts
  }
  return dates;
}

/**
 * THE per-month count resolution of a cap (solver v3 C2 RES-3, IF2-17): `resolvedCapValue`
 * over every Sunday of the calendar month (ADR-0047's D2), as a TYPED result — never a
 * restatement of `max(0, weeks − offset)`, never rounded, truncated or clamped beyond that
 * `max(0, ·)`. `not_whole` (checked first): the result is fractional or non-finite (a
 * fractional `value`, a fractional `relOffset` not clamped to 0, NaN, ±Infinity);
 * `negative`: a fixed whole `value` below 0. The resolver adds RES-3's upper bound (31) for
 * `==` caps; C6 refuses a `<=`/`>=` cap whose result is `ok: false`.
 *
 * It lives HERE, not beside `rolesOfPatternV3` in `plannerModel.ts`, because it calls
 * `completeSundaySpine` and this module already imports `plannerModel`: the other way
 * round would be an import cycle (C2 review log, open item; plan decision).
 */
export function capValueForMonth(
  cap: RestrictionCap,
  month: string,
): { ok: true; count: number } | { ok: false; reason: "not_whole" | "negative" } {
  const count = resolvedCapValue(cap, completeSundaySpine(month).length);
  if (!Number.isInteger(count)) return { ok: false, reason: "not_whole" };
  if (count < 0) return { ok: false, reason: "negative" };
  return { ok: true, count };
}

````

**Regenerate** `app/utils/__tests__/__fixtures__/colour-inventory.json` (it records `filesScanned`, and this task adds a file under `app/`):

```bash
node scripts/colour-inventory.mjs
```

- [ ] **Step 4: Run them to see them pass**

Run: `git add -A && npx vitest run app/utils/__tests__/fairnessVocabulary.test.ts app/components/admin/__tests__/patternRolesV3Sync.test.ts app/components/admin/__tests__/capValueForMonth.test.ts`
Expected: PASS (3 files, 59 tests). `patternRolesSync.test.ts` (v2's sync) is untouched and still passes.

- [ ] **Step 5: Gates and commit**

Run: `git add -A && npx tsc --noEmit && npm test && npx eslint .`
Expected: no `tsc` output; **451 files / 8189 tests** passed; `✖ 81 problems (0 errors, 81 warnings)`.

```bash
git add -A
git commit -m "feat(fairness): the v3 vocabulary, rolesOfPatternV3 and capValueForMonth" -m "Solver v3 C2 IF2-1, IF2-16, IF2-17. One neutral vocabulary module (role keys in canonical order, lines, tabs, statuses, set-aside reasons, the wire shapes) that the ledger, the resolver, the panel and the routes share; the six-key pattern expansion beside rolesOfPattern, equal to it on v2's five keys and adding Sat.Choir; and the typed per-month count resolution over resolvedCapValue, placed in serviceRuleContext.ts because it calls completeSundaySpine and the other placement would be an import cycle."
```


---

## Task 2: The effective engine and the record's environment stamp — [standard, touches SECRETS]

Spec EN-1–EN-3, REC-2 (the `environment` derivation), IF2-14. Two pure functions of an injected env; the `OWT_SOLVER_ENGINE` entry lands with the code that reads it (the global rule: a new env var is documented in the same change).

**Files:**
- Create: `app/utils/solverDeployment.ts`
- Modify: `docs/SECRETS.md` (before «## Not yet documented», `:578`)
- Test: `app/utils/__tests__/solverDeployment.test.ts`
- Regenerate: `app/utils/__tests__/__fixtures__/colour-inventory.json`

**Interfaces:**
- Consumes: `SOLVER_ENGINE` (`app/components/admin/solverEngine.ts`, C1 — unchanged).
- Produces: `resolveSolverEngine(env: Readonly<Record<string, string | undefined>>): "v2" | "v3"`; `fairnessRecordEnvironment(env): "production" | "preview" | "local"`; `type SolverEngine`.

- [ ] **Step 1: Write the failing test**

**Create** `app/utils/__tests__/solverDeployment.test.ts`:

````ts
// Solver v3 C2 EN-2 / IF2-14 and REC-2 — the effective engine and the record's
// `environment` stamp, both pure functions of an injected env. The resolver honours
// `OWT_SOLVER_ENGINE` only on the `preview` BRANCH deployment and locally; everything
// else answers C1's constant. Two sweeps hold the boundaries: one reader of the
// variable under app/**, and no client module imports this module.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { stripComments } from "../../../scripts/lib/strip-comments.mjs";
import { SOLVER_ENGINE } from "@/app/components/admin/solverEngine";
import { fairnessRecordEnvironment, resolveSolverEngine } from "../solverDeployment";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("resolveSolverEngine (C2 EN-2)", () => {
  it.each([
    ["the preview branch deployment", { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "preview" }],
    ["local development, VERCEL_ENV unset", {}],
    ["local development, VERCEL_ENV empty", { VERCEL_ENV: "" }],
  ])("honours an exact override on %s", (_label, base) => {
    expect(resolveSolverEngine({ ...base, OWT_SOLVER_ENGINE: "v3" })).toBe("v3");
    expect(resolveSolverEngine({ ...base, OWT_SOLVER_ENGINE: "v2" })).toBe("v2");
  });

  it.each([
    ["production", { VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main" }],
    ["production on a ref named preview", { VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "preview" }],
    ["the verify/service-readiness deployment", { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "verify/service-readiness" }],
    ["a preview deployment with no ref", { VERCEL_ENV: "preview" }],
    ["vercel dev (development is not «unset»)", { VERCEL_ENV: "development" }],
    ["an unknown VERCEL_ENV", { VERCEL_ENV: "staging" }],
  ])("answers the constant on %s", (_label, base) => {
    expect(resolveSolverEngine({ ...base, OWT_SOLVER_ENGINE: "v3" })).toBe(SOLVER_ENGINE);
  });

  it.each([undefined, "", "V3", "v3 ", "true"])("answers the constant for the non-exact value %j", (value) => {
    expect(resolveSolverEngine({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "preview", OWT_SOLVER_ENGINE: value })).toBe(
      SOLVER_ENGINE,
    );
  });
});

describe("fairnessRecordEnvironment (C2 REC-2)", () => {
  it.each([
    [{ VERCEL_ENV: "production" }, "production"],
    [{ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "verify/service-readiness" }, "preview"],
    [{ VERCEL_ENV: "development" }, "local"],
    [{ VERCEL_ENV: "" }, "local"],
    [{}, "local"],
    [{ VERCEL_ENV: "staging" }, "local"],
  ] as const)("%j → %s", (env, expected) => {
    expect(fairnessRecordEnvironment(env)).toBe(expected);
  });
});

function trackedAppSources(): string[] {
  return execFileSync("git", ["ls-files", "app"], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\n")
    .filter((f) => /\.(ts|tsx|mjs|js)$/.test(f) && !/(^|\/)__tests__\//.test(f) && !/\.test\./.test(f));
}

describe("the deployment resolvers' boundaries (C2 EN-2, C6 ENG-1)", () => {
  const sources = trackedAppSources();

  it("reads a real inventory", () => {
    expect(sources.length).toBeGreaterThan(100);
  });

  it("has exactly one reader of OWT_SOLVER_ENGINE under app/**", () => {
    const readers = sources.filter((f) =>
      stripComments(readFileSync(path.join(REPO_ROOT, f), "utf8")).includes("OWT_SOLVER_ENGINE"),
    );
    expect(readers).toEqual(["app/utils/solverDeployment.ts"]);
  });

  it("is imported by no client module", () => {
    const clientImporters = sources.filter((f) => {
      const code = stripComments(readFileSync(path.join(REPO_ROOT, f), "utf8"));
      return /^\s*["']use client["']/m.test(code) && /from\s+["'][^"']*solverDeployment["']/.test(code);
    });
    expect(clientImporters).toEqual([]);
  });
});
````

- [ ] **Step 2: Run it to see it fail**

Run: `git add -A && npx vitest run app/utils/__tests__/solverDeployment.test.ts`
Expected: FAIL — `../solverDeployment` does not resolve.

- [ ] **Step 3: Implement, and document the variable**

**Create** `app/utils/solverDeployment.ts`:

````ts
// app/utils/solverDeployment.ts
//
// Two pure functions of an INJECTED environment (the `canonicalOrigin(env)` precedent,
// `app/mcp/oauth/origin.ts`), kept apart from `solverEngine.ts`, whose constant stays
// import-free (solver v3 C1):
//
//   · `resolveSolverEngine(env)` — the EFFECTIVE engine (spec C2 EN-2, IF2-14). The
//     ONE reader of `OWT_SOLVER_ENGINE` under `app/**` (`solverDeployment.test.ts`
//     sweeps for a second). It honours the override ONLY on the `preview` branch
//     deployment (`VERCEL_ENV === "preview"` AND `VERCEL_GIT_COMMIT_REF === "preview"`,
//     so `verify/service-readiness`, also `VERCEL_ENV=preview`, never does) and in
//     local development (`VERCEL_ENV` unset or empty). Production, `development` and
//     every other value answer the constant: a stale production variable can never
//     change the engine (parent A1).
//   · `fairnessRecordEnvironment(env)` — REC-2's `environment` stamp: `production` /
//     `preview`, anything else `local`. NOT the same mapping as the engine's: here
//     `development` is `local`, there it is not «unset».
//
// NEUTRAL (ADR-0028): no "use client" and no `server-only` — C4's `tsx` script stamps
// `environment` through it — but no client module may import it: clients learn the
// engine from the GET's `engine` (IF2-8) or C6's server-resolved prop. Guarded by
// `solverDeployment.test.ts`. The variable's entry is in docs/SECRETS.md.

import { SOLVER_ENGINE } from "@/app/components/admin/solverEngine";

export type SolverEngine = "v2" | "v3";

type Env = Readonly<Record<string, string | undefined>>;

export function resolveSolverEngine(env: Env): SolverEngine {
  const override = env.OWT_SOLVER_ENGINE;
  if (override !== "v2" && override !== "v3") return SOLVER_ENGINE;
  const vercelEnv = env.VERCEL_ENV;
  const previewBranch = vercelEnv === "preview" && env.VERCEL_GIT_COMMIT_REF === "preview";
  const local = vercelEnv === undefined || vercelEnv === "";
  return previewBranch || local ? override : SOLVER_ENGINE;
}

export function fairnessRecordEnvironment(env: Env): "production" | "preview" | "local" {
  if (env.VERCEL_ENV === "production") return "production";
  if (env.VERCEL_ENV === "preview") return "preview";
  return "local";
}
````

**Find** in `docs/SECRETS.md`:

````markdown
---

## Not yet documented

````

**Replace with:**

````markdown
---

## `OWT_SOLVER_ENGINE` (solver v3 — the Preview-only engine override)

**Needed in: Vercel Preview, branch-scoped to `preview` only — and only while Frank wants a v3
rehearsal on dev. Optional in local `.env.local` (a local v3 rehearsal). Leave it unset
everywhere else. Not needed in: Vercel Production (the code ignores it there), the
`Preview (verify/service-readiness)` scope (the code ignores it there too — never add it "to be
safe"), GitHub Actions, Cloud Scheduler, the iOS build, GCF.**

**Not a secret** — plain config, `"v2"` or `"v3"`. It is the ONE override of the solver-engine
constant (`SOLVER_ENGINE` in `app/components/admin/solverEngine.ts`, parent A1), read by exactly one
function, `resolveSolverEngine` (`app/utils/solverDeployment.ts`). That function honours an exact
`v2`/`v3` only when `VERCEL_ENV === "preview"` **and** `VERCEL_GIT_COMMIT_REF === "preview"` (the
dev deployment), or when `VERCEL_ENV` is unset or empty (local development). Production, `vercel
dev` (`VERCEL_ENV=development`), the `verify/service-readiness` deployment and any other value
answer the constant. Both `VERCEL_*` variables are set by Vercel automatically.

**Purpose — what changes with it.** Under `v3`, the planner's «Equidad · vista previa» panel offers
«Registrar elegibilidad de {mes}» and `PUT /api/admin/fairness/months` accepts writes (under `v2`
it answers `409 engine_not_v3`); after C6, Auto on that deployment also runs the v3 solver.
Without it (the normal state) the deployment runs the constant's engine.

**Where it comes from.** A literal typed by Frank: Vercel → project `owt-backstage` → Settings →
Environment Variables → Preview, scoped to the Git branch `preview`; or a line in `.env.local`.
There is no issuer or generator.

**Rotate / change:** edit or remove the value, then redeploy Preview (push `preview` or redeploy
from the dashboard) and verify the dev alias moved — like every Vercel env var it binds at build
time. Locally, restart the dev server. To go back to the constant, remove it.

**Blast radius.** While it is `v3` on Preview, «Registrar» appears on dev and writes
**production** `fairnessMonth` records — `preview` writes the real dataset (CLAUDE.md «Vercel
safety») — stamped `environment: "preview"`, which no app surface can delete (C2 WR-13). Set
locally with `VERCEL_ENV` unset, a local server writes production records stamped `local`. After
C6, Auto on that deployment runs v3. Nothing is broken mid-change: a deployment reads the value it
was built with.

---

## Not yet documented

````

**Regenerate** `app/utils/__tests__/__fixtures__/colour-inventory.json` (it records `filesScanned`, and this task adds a file under `app/`):

```bash
node scripts/colour-inventory.mjs
```

- [ ] **Step 4: Run it to see it pass**

Run: `git add -A && npx vitest run app/utils/__tests__/solverDeployment.test.ts app/components/admin/__tests__/solverEngine.test.ts`
Expected: PASS (2 files) — C1's `solverEngine.test.ts` still pins `"v2"` and the import-free constant module.

- [ ] **Step 5: Gates and commit**

Run: `git add -A && npx tsc --noEmit && npm test && npx eslint .`
Expected: **452 files / 8212 tests**; 0 errors, 81 warnings.

```bash
git add -A
git commit -m "feat(solver): the effective-engine resolver and the record environment stamp" -m "Solver v3 C2 EN-2/IF2-14 and REC-2. resolveSolverEngine is the one reader of OWT_SOLVER_ENGINE: it honours an exact override only on the preview branch deployment (VERCEL_ENV and VERCEL_GIT_COMMIT_REF both preview) and locally, so verify/service-readiness and production always run C1's constant. fairnessRecordEnvironment is the record's environment stamp (development reads as local there, unlike the engine). Both take the env as an argument; no client module imports them. The variable's SECRETS entry lands with the code (EN-3)."
```


---

## Task 3: The fairness read builders — [standard]

Spec RD-1, RD-6, IF2-24 … IF2-28. Additive builders in the one exempt home of draft-seeing reads, executed with groq-js. The executor's two by-id reads (records by id, members by id) are the same file's plan-internal builders (spec: «not a sibling interface»). `serviceReadQueries.ts` gains a runtime import of `solverConfigWriteRequest.ts` (for `SOLVER_CONFIG_DOC_ID`, never a second literal); that module's import closure does not reach `serviceReadQueries.ts`, so there is no cycle.

**Files:**
- Modify: `app/utils/serviceReadQueries.ts` (imports at `:8`; append after `weekendRoleCreationReceiptsQuery`, end of file)
- Test: `app/utils/__tests__/fairnessReadQueries.test.ts`

**Interfaces:**
- Consumes: `WORSHIP_AUDIENCE_GROQ_FILTER` (`app/ministries.ts`), `COUNTS_FOR_FAIRNESS_GROQ` (C1), `SOLVER_CONFIG_DOC_ID` (`solverConfigWriteRequest.ts`), `ROLE_TYPES`, `BoundQuery`.
- Produces (all `(…) => BoundQuery`): `serviceCountsInMonths(months: string[])` answering `Array<{ month, weekend, countedSpecials, uncountedSpecials }>`; `fairnessMonthsThroughQuery(lastMonth)`; `fairnessMonthsByIdsQuery(ids)`; `voiceRolesInRangeQuery(fromDay, toDayExclusive)` answering rows `{ _id, _type, date, time, published, countsForFairness, Lead, BGVs, Chorus }` (refs as id strings); `fairnessMembersByIdsQuery(ids)` and `worshipRosterQuery()` answering `{ _id, member_name, alias, memberType, ministries, unavailableDates }`; `solverConfigQuery()`.

- [ ] **Step 1: Write the failing test**

**Create** `app/utils/__tests__/fairnessReadQueries.test.ts`:

````ts
// Solver v3 C2 IF2-24 … IF2-28 (RD-1, RD-6) — the fairness read builders, EXECUTED with
// groq-js over an in-memory dataset (the `leadNoteProjection.test.ts` precedent): the
// failures that matter here — a draft counted, a kids-only member in the roster, a
// special counted by the wrong default — are invisible to a string match.
import { evaluate, parse } from "groq-js";
import { describe, expect, it } from "vitest";

import { SOLVER_CONFIG_DOC_ID } from "@/app/utils/solverConfigWriteRequest";
import {
  fairnessMembersByIdsQuery,
  fairnessMonthsByIdsQuery,
  fairnessMonthsThroughQuery,
  serviceCountsInMonths,
  solverConfigQuery,
  voiceRolesInRangeQuery,
  worshipRosterQuery,
  type BoundQuery,
} from "../serviceReadQueries";

async function run(bound: BoundQuery, dataset: unknown[]): Promise<unknown> {
  const tree = parse(bound.query, { params: bound.params });
  return (await evaluate(tree, { dataset, params: bound.params })).get();
}

const ROLES = [
  { _id: "sun-1", _type: "sunday_role", week: "2026-11-01", Lead: [{ _key: "a", _ref: "m-alma" }] },
  { _id: "sat-1", _type: "saturday_role", week: "2026-11-07", published: false },
  { _id: "spc-counted", _type: "special_role", date: "2026-11-03", countsForFairness: true, time: "19:00" },
  { _id: "spc-legacy", _type: "special_role", date: "2026-11-04" },
  { _id: "spc-off", _type: "special_role", date: "2026-11-05", countsForFairness: false },
  { _id: "sat-legacy", _type: "saturday_role", week: "2026-11-14T00:00:00" },
  { _id: "drafts.sun-2", _type: "sunday_role", week: "2026-11-08" },
  { _id: "sun-dec", _type: "sunday_role", week: "2026-12-06", countsForFairness: false },
  { _id: "post-1", _type: "post", week: "2026-11-01" },
];

describe("serviceCountsInMonths (IF2-24)", () => {
  it("counts weekend services and splits specials by C1's rule, per month, drafts excluded", async () => {
    expect(await run(serviceCountsInMonths(["2026-11", "2026-12", "2027-01"]), ROLES)).toEqual([
      { month: "2026-11", weekend: 3, countedSpecials: 1, uncountedSpecials: 2 },
      // An explicit `countsForFairness: false` on a weekend service does not unfreeze it:
      // the freezing services are every stored weekend service (§4 vocabulary).
      { month: "2026-12", weekend: 1, countedSpecials: 0, uncountedSpecials: 0 },
      { month: "2027-01", weekend: 0, countedSpecials: 0, uncountedSpecials: 0 },
    ]);
  });
});

describe("voiceRolesInRangeQuery (IF2-26)", () => {
  it("answers the three role types in range with the stored date, the effective flag and the seat refs", async () => {
    const rows = (await run(voiceRolesInRangeQuery("2026-11-01", "2026-12-01"), ROLES)) as Array<Record<string, unknown>>;
    const byId = Object.fromEntries(rows.map((r) => [r._id, r]));
    expect(Object.keys(byId).sort()).toEqual(["sat-1", "sat-legacy", "spc-counted", "spc-legacy", "spc-off", "sun-1"]);
    expect(byId["sun-1"]).toMatchObject({ _type: "sunday_role", date: "2026-11-01", countsForFairness: true, Lead: ["m-alma"] });
    expect(byId["sat-1"]).toMatchObject({ published: false, countsForFairness: true });
    expect(byId["spc-counted"]).toMatchObject({ date: "2026-11-03", time: "19:00", countsForFairness: true });
    expect(byId["spc-legacy"]).toMatchObject({ countsForFairness: false });
    expect(byId["sat-legacy"]).toMatchObject({ date: "2026-11-14T00:00:00" });
  });
});

const RECORDS = [
  { _id: "fairnessMonth.2026-09", _type: "fairnessMonth", month: "2026-09" },
  { _id: "fairnessMonth.2026-11", _type: "fairnessMonth", month: "2026-11" },
  { _id: "fairnessMonth.2026-12", _type: "fairnessMonth", month: "2026-12" },
  { _id: "drafts.fairnessMonth.2026-10", _type: "fairnessMonth", month: "2026-10" },
];

describe("fairnessMonthsThroughQuery (IF2-25) and fairnessMonthsByIdsQuery", () => {
  it("answers every record up to the last month, ascending, drafts excluded", async () => {
    const rows = (await run(fairnessMonthsThroughQuery("2026-11"), RECORDS)) as Array<{ month: string }>;
    expect(rows.map((r) => r.month)).toEqual(["2026-09", "2026-11"]);
  });

  it("answers exactly the documents with the given ids", async () => {
    const rows = (await run(fairnessMonthsByIdsQuery(["fairnessMonth.2026-12", "fairnessMonth.2027-01"]), RECORDS)) as Array<{
      _id: string;
    }>;
    expect(rows.map((r) => r._id)).toEqual(["fairnessMonth.2026-12"]);
  });
});

const MEMBERS = [
  { _id: "m-absent", _type: "teamMembers", member_name: "Alma", memberType: ["voz"], unavailableDates: ["2026-11-08"], email: "x" },
  { _id: "m-empty", _type: "teamMembers", member_name: "Bruno", ministries: [] },
  { _id: "m-worship", _type: "teamMembers", member_name: "Carmen", alias: "Car", ministries: ["worship", "kids"] },
  { _id: "m-kids", _type: "teamMembers", member_name: "Diego", ministries: ["kids"], memberType: ["voz"] },
  { _id: "drafts.m-absent", _type: "teamMembers", member_name: "Alma (draft)" },
];

describe("worshipRosterQuery (IF2-27, RD-6 a)", () => {
  it("answers absent, empty and worship ministries — never kids-only, never a draft — with exactly six fields", async () => {
    const rows = (await run(worshipRosterQuery(), MEMBERS)) as Array<Record<string, unknown>>;
    expect(rows.map((r) => r._id).sort()).toEqual(["m-absent", "m-empty", "m-worship"]);
    // groq-js projects a field the document lacks as `null`; the six names are what matter.
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(["_id", "alias", "memberType", "member_name", "ministries", "unavailableDates"]);
    }
    expect(rows.find((r) => r._id === "m-absent")).toMatchObject({ memberType: ["voz"], unavailableDates: ["2026-11-08"] });
  });
});

describe("fairnessMembersByIdsQuery", () => {
  it("answers the asked members whatever their ministry, with the writer's and ledger's fields", async () => {
    const rows = (await run(fairnessMembersByIdsQuery(["m-kids", "m-worship", "m-none"]), MEMBERS)) as Array<Record<string, unknown>>;
    expect(rows.map((r) => r._id).sort()).toEqual(["m-kids", "m-worship"]);
    expect(Object.keys(rows[0]).sort()).toEqual(["_id", "alias", "memberType", "member_name", "ministries", "unavailableDates"]);
  });
});

describe("solverConfigQuery (IF2-28, RD-6 b)", () => {
  it("binds SOLVER_CONFIG_DOC_ID and answers the document", async () => {
    const bound = solverConfigQuery();
    expect(bound.params).toEqual({ id: SOLVER_CONFIG_DOC_ID });
    const doc = { _id: SOLVER_CONFIG_DOC_ID, _type: "solverConfig", sundayLeads: ["m-alma"] };
    expect(await run(bound, [doc, ...MEMBERS])).toEqual(doc);
  });

  it("answers null for an absent document", async () => {
    expect(await run(solverConfigQuery(), MEMBERS)).toBeNull();
  });
});
````

- [ ] **Step 2: Run it to see it fail**

Run: `git add -A && npx vitest run app/utils/__tests__/fairnessReadQueries.test.ts`
Expected: FAIL — the seven builders are not exported.

- [ ] **Step 3: Implement**

**Find** in `app/utils/serviceReadQueries.ts`:

````ts

import { ROLE_TYPES, SETLIST_TYPES } from "@/app/utils/serviceReadModel";

export interface BoundQuery {
````

**Replace with:**

````ts

import { ROLE_TYPES, SETLIST_TYPES } from "@/app/utils/serviceReadModel";
import { WORSHIP_AUDIENCE_GROQ_FILTER } from "@/app/ministries";
import { COUNTS_FOR_FAIRNESS_GROQ } from "@/app/utils/countsForFairness";
import { SOLVER_CONFIG_DOC_ID } from "@/app/utils/solverConfigWriteRequest";

export interface BoundQuery {
````

**Find** in `app/utils/serviceReadQueries.ts`:

````ts
    params: { roleTypes: [...WEEKEND_ROLE_TYPES] },
  };
}
````

**Replace with:**

````ts
    params: { roleTypes: [...WEEKEND_ROLE_TYPES] },
  };
}

// ── Solver v3 fairness reads (C2 IF2-24 … IF2-28) ──────────────────────────
// Additive builders for the fairness ledger, its write executor, C4's script and
// C7's rehearsal. NONE carries a `published` clause — prior-month drafts count,
// and neither `fairnessMonth`, `teamMembers` nor `solverConfig` is draft-gated —
// and each names canonical documents only. A caller runs them only on a client
// carrying the read token, the `published` perspective and no CDN (parent A2):
// `fairnessMonth` ids are dotted, so an untokened read answers «no record» with
// no error. This file stays the one exempt home of draft-seeing reads
// (`draftGatingCoverage.test.ts`); no new exemption is added.

const CANONICAL = `!(_id in path("drafts.**"))`;

/** The weekend role types — the freezing services' weekend half (§4 vocabulary). */
const FAIRNESS_WEEKEND_TYPES = ["sunday_role", "saturday_role"];

/** `YYYY-MM` → `[YYYY-MM-01, first day of the next month)`, by integer arithmetic. */
function monthRange(month: string): { month: string; from: string; to: string } {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const next = m === 12 ? `${String(year + 1).padStart(4, "0")}-01` : `${month.slice(0, 4)}-${String(m + 1).padStart(2, "0")}`;
  return { month, from: `${month}-01`, to: `${next}-01` };
}

/**
 * IF2-24 — the freezing-services counts per month: the ONE definition of §4's
 * freezing services (parent A5), used by the write executor (WR-7), the ledger
 * reader (RD-1), C4 (R1) and, through IF2-8's `storedServices`, C6. Answers
 * `Array<{ month, weekend, countedSpecials, uncountedSpecials }>` in the order of
 * `months`; freezing = `weekend + countedSpecials`. Specials split by C1's rule.
 */
export function serviceCountsInMonths(months: string[]): BoundQuery {
  return {
    query: `$months[]{
      "month": month,
      "weekend": count(*[_type in $weekendTypes && ${CANONICAL} && week >= ^.from && week < ^.to]),
      "countedSpecials": count(*[_type == "special_role" && ${CANONICAL} && date >= ^.from && date < ^.to && ${COUNTS_FOR_FAIRNESS_GROQ}]),
      "uncountedSpecials": count(*[_type == "special_role" && ${CANONICAL} && date >= ^.from && date < ^.to && !(${COUNTS_FOR_FAIRNESS_GROQ})])
    }`,
    params: { months: months.map(monthRange), weekendTypes: FAIRNESS_WEEKEND_TYPES },
  };
}

/**
 * IF2-25 — every `fairnessMonth` document with `month <= lastMonth`, whole, as stored
 * (IF2-2). Every caller parses each row through the stored-record parser (IF2-20).
 */
export function fairnessMonthsThroughQuery(lastMonth: string): BoundQuery {
  return {
    query: `*[_type == "fairnessMonth" && ${CANONICAL} && month <= $last] | order(month asc)`,
    params: { last: lastMonth },
  };
}

/**
 * The `fairnessMonth` documents with these exact ids, whole, as stored — the write
 * executor's fresh re-read (WR-7). The ids come from the write-request module, the one
 * place that constructs them (REC-1).
 */
export function fairnessMonthsByIdsQuery(ids: string[]): BoundQuery {
  return {
    query: `*[_type == "fairnessMonth" && _id in $ids]`,
    params: { ids: [...ids] },
  };
}

/**
 * IF2-26 — the voice role documents of the three types whose stored date (`week` on a
 * weekend role, `date` on a special) is in `[fromDay, toDayExclusive)`, every published
 * state, with the effective counted flag (`ROLE_PROJECTION` does not carry it) and the
 * Lead/BGVs/Chorus `_ref`s in stored order. The caller normalises `date` through
 * `serviceDayKey` and maps each row to IF2-10's `LedgerService`.
 */
export function voiceRolesInRangeQuery(fromDay: string, toDayExclusive: string): BoundQuery {
  return {
    query: `*[_type in $roleTypes && ${CANONICAL} && select(_type == "special_role" => date, week) >= $from && select(_type == "special_role" => date, week) < $to]{
      _id, _type,
      "date": select(_type == "special_role" => date, week),
      time, published,
      "countsForFairness": ${COUNTS_FOR_FAIRNESS_GROQ},
      "Lead": Lead[]._ref, "BGVs": BGVs[]._ref, "Chorus": Chorus[]._ref
    }`,
    params: { roleTypes: [...ROLE_TYPES], from: fromDay, to: toDayExclusive },
  };
}

/**
 * Team members by id with the fields the fairness writer and ledger read: the display
 * name (alias, else `member_name`), `ministries` and `memberType` (the executor's WR-5
 * checks) and `unavailableDates` (the ledger's live availability, LG-6). No ministry
 * filter — a seat holder is named whatever her ministry.
 */
export function fairnessMembersByIdsQuery(ids: string[]): BoundQuery {
  return {
    query: `*[_type == "teamMembers" && ${CANONICAL} && _id in $ids]{ _id, member_name, alias, ministries, memberType, unavailableDates }`,
    params: { ids: [...ids] },
  };
}

/**
 * IF2-27 — the worship roster: the one server-side definition of the eligibility
 * resolver's unfiltered worship roster (RES-5) and of C3's `RosterMember` list for a
 * script. Every canonical `teamMembers` document matching `WORSHIP_AUDIENCE_GROQ_FILTER`
 * (absent or empty `ministries` is worship; no `$all` arm), with no `voz`, Tipo, pool or
 * `disabled` filter, projecting exactly six fields.
 */
export function worshipRosterQuery(): BoundQuery {
  return {
    query: `*[_type == "teamMembers" && ${CANONICAL} && ${WORSHIP_AUDIENCE_GROQ_FILTER}]{ _id, member_name, alias, memberType, ministries, unavailableDates }`,
    params: {},
  };
}

/**
 * IF2-28 — the rule set singleton, `$id` bound from `SOLVER_CONFIG_DOC_ID` (never a
 * second literal). Answers the stored document or `null`; the caller parses it with
 * `solverConfigFromDocument` and treats `null` as ABSENT, never as the defaults.
 */
export function solverConfigQuery(): BoundQuery {
  return {
    query: `*[_id == $id][0]`,
    params: { id: SOLVER_CONFIG_DOC_ID },
  };
}
````

- [ ] **Step 4: Run it to see it pass**

Run: `git add -A && npx vitest run app/utils/__tests__/fairnessReadQueries.test.ts app/utils/__tests__/draftGatingCoverage.test.ts`
Expected: PASS — `draftGatingCoverage.test.ts` unchanged and green (the new GROQ is in its exempt file).

- [ ] **Step 5: Gates and commit**

Run: `git add -A && npx tsc --noEmit && npm test && npx eslint .`
Expected: **453 files / 8220 tests**; 0 errors, 81 warnings.

```bash
git add -A
git commit -m "feat(fairness): the fairness read builders" -m "Solver v3 C2 IF2-24 to IF2-28 plus the executor's two by-id reads. Additive builders in serviceReadQueries.ts, the one exempt home of draft-seeing reads: the freezing-services counts per month (weekend services plus specials counted by C1's rule, the one definition A5 needs), the records through a month, the voice roles of all three types with the effective counted flag, the members by id, the worship roster (WORSHIP_AUDIENCE_GROQ_FILTER, no \$all arm) and the rule-set singleton bound from SOLVER_CONFIG_DOC_ID. Executed with groq-js, because a draft counted or a kids-only member listed is invisible to a string match."
```


---

## Task 4: The record type, governed in the Studio and the audit — **[CRITICAL slice: stored type, Studio governance, audit registration]**

Spec REC-1–REC-5 (the fields), REC-8, the type half of REC-9, GU-2. The record is a hidden, read-only type at a dotted id; it joins all four Studio lists and the audit's `PROTECTED_TYPES` (the exact-list pins change in the same commit). `serviceReadModel.ts`'s unrelated `PROTECTED_TYPES` is NOT touched.

**Files:**
- Create: `sanity/schemas/fairnessMonth.ts`
- Modify: `sanity/schema.ts` (`solverConfig` import and the `types` list)
- Modify: `app/utils/studioProtection.ts` (`:1`, `:27`, `PROTECTED_STUDIO_TYPES` `:45-77`, the internal-types doc and list `:145-168`, `INTERNAL_STUDIO_FIELDS` `:189-228`, `PROTECTED_STUDIO_TITLES` `:484-500`)
- Modify: `app/utils/protectedReadAudit.ts` (`PROTECTED_TYPES`, `:21-30`)
- Test: `app/utils/__tests__/fairnessMonthSchema.test.ts`; modify `app/utils/__tests__/studioProtection.test.ts` (the fifteen-type pins and file lists) and `app/utils/__tests__/protectedReadAudit.test.ts` (`:599-609`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the Sanity type `fairnessMonth` with fields `schemaVersion, month, source, engine, environment, recordedAt, recordedBy, contentHash, people[] (fairnessPerson: member, name, roles{sunLead,satLead,sunBgv,satBgv,sunChoir,satChoir}, exactRules[] (fairnessExactRule: roles, count), sundayCadence, exempt, blocks[] (fairnessBlock: date, unavailable, excludedRoles)), presence[] (fairnessPresence: ruleKey, roles, members, exclusive)`; `"fairnessMonth"` in the audit's `PROTECTED_TYPES`.

- [ ] **Step 1: Write the failing tests**

**Create** `app/utils/__tests__/fairnessMonthSchema.test.ts`:

````ts
// Solver v3 C2 REC-5, REC-8, REC-9 — the `fairnessMonth` type is governed like
// `solverConfig`: hidden, read-only, every mutating Studio capability denied, every
// field listed as internal; it stores eligibility and never a computed figure; and the
// protected-read audit treats it as protected (a non-canonical read or a literal-named
// write of it is a violation).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { fairnessMonth } from "@/sanity/schemas/fairnessMonth";
import {
  INTERNAL_STUDIO_FIELDS,
  PROTECTED_STUDIO_TITLES,
  STUDIO_MUTATING_CAPABILITIES,
  isInternalStudioType,
  isProtectedStudioType,
  studioCapability,
} from "../studioProtection";
import { auditViolations, scanSource } from "../protectedReadAudit";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

interface Field {
  name: string;
  type: string;
  weak?: boolean;
  fields?: Field[];
  of?: Array<{ type: string; name?: string; fields?: Field[] }>;
}

const FIELDS = (fairnessMonth as unknown as { fields: Field[] }).fields;
const field = (list: Field[] | undefined, name: string): Field => {
  const found = list?.find((f) => f.name === name);
  if (!found) throw new Error(`no field ${name}`);
  return found;
};
const itemFields = (f: Field) => f.of?.[0]?.fields ?? [];

describe("the fairnessMonth schema (C2 REC-1 … REC-5)", () => {
  it("is a hidden, read-only document type", () => {
    const def = fairnessMonth as unknown as { name: string; type: string; hidden: boolean; readOnly: boolean };
    expect(def).toMatchObject({ name: "fairnessMonth", type: "document", hidden: true, readOnly: true });
  });

  it("declares exactly the fields INTERNAL_STUDIO_FIELDS governs (REC-8)", () => {
    expect(FIELDS.map((f) => f.name)).toEqual([...INTERNAL_STUDIO_FIELDS.fairnessMonth]);
  });

  it("stores people by weak reference, six role fields with no dots, and no figure (REC-3, REC-5)", () => {
    const people = itemFields(field(FIELDS, "people"));
    expect(people.map((f) => f.name)).toEqual(["member", "name", "roles", "exactRules", "sundayCadence", "exempt", "blocks"]);
    expect(field(people, "member")).toMatchObject({ type: "reference", weak: true });
    expect(field(people, "roles").fields?.map((f) => f.name)).toEqual([
      "sunLead",
      "satLead",
      "sunBgv",
      "satBgv",
      "sunChoir",
      "satChoir",
    ]);
    expect(itemFields(field(people, "exactRules")).map((f) => f.name)).toEqual(["roles", "count"]);
    expect(itemFields(field(people, "blocks")).map((f) => f.name)).toEqual(["date", "unavailable", "excludedRoles"]);
  });

  it("keeps names out of presence and never stores a computed figure or publication state (REC-4, REC-5)", () => {
    const presence = itemFields(field(FIELDS, "presence"));
    expect(presence.map((f) => f.name)).toEqual(["ruleKey", "roles", "members", "exclusive"]);
    const names: string[] = [];
    const walk = (list: Field[] | undefined) => {
      for (const f of list ?? []) {
        names.push(f.name);
        walk(f.fields);
        for (const item of f.of ?? []) walk(item.fields);
      }
    };
    walk(FIELDS);
    for (const forbidden of ["published", "balance", "share", "received", "seats", "state", "rule", "person", "persons"]) {
      expect(names, forbidden).not.toContain(forbidden);
    }
  });

  it("is registered in the Sanity schema", () => {
    const src = readFileSync(path.join(REPO_ROOT, "sanity/schema.ts"), "utf8");
    expect(src).toContain("./schemas/fairnessMonth");
    expect(src).toMatch(/types:\s*\[[\s\S]*fairnessMonth[\s\S]*\]/);
  });
});

describe("fairnessMonth in the Studio (C2 REC-8)", () => {
  it("is protected and internal, with its read-only pane title", () => {
    expect(isProtectedStudioType("fairnessMonth")).toBe(true);
    expect(isInternalStudioType("fairnessMonth")).toBe(true);
    expect(PROTECTED_STUDIO_TITLES.fairnessMonth).toBe("Registros de equidad (solo lectura)");
  });

  it("denies every mutating capability and keeps read", () => {
    for (const capability of STUDIO_MUTATING_CAPABILITIES) {
      expect(studioCapability("fairnessMonth", capability).allowed, capability).toBe(false);
    }
    for (const capability of ["create", "update", "delete", "publish", "unpublish", "duplicate", "restore"]) {
      expect(studioCapability("fairnessMonth", capability).allowed, capability).toBe(false);
    }
    expect(studioCapability("fairnessMonth", "read").allowed).toBe(true);
    expect(studioCapability("fairnessMonth", "create").mechanism).toContain("hidden");
  });
});

const CLIENT_IMPORTS = `
import { serverClient, writeClient } from "@/sanity/lib/serverClient";
import { operationalClient } from "@/sanity/lib/operationalClient";
`;

describe("fairnessMonth in the protected-read audit (C2 REC-9)", () => {
  it("flags a read of the type off a non-canonical client", () => {
    const sites = scanSource(
      "app/api/example/route.ts",
      `${CLIENT_IMPORTS}
export async function GET() {
  return serverClient.fetch(\`*[_type == "fairnessMonth"]{ _id, people }\`);
}`,
    );
    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({ kind: "protected-literal-read", compliant: false });
    expect(auditViolations(sites)).toHaveLength(1);
  });

  it("accepts the same read through the canonical operational client", () => {
    const sites = scanSource(
      "app/api/example/route.ts",
      `${CLIENT_IMPORTS}
export async function GET() {
  return operationalClient.fetch(\`*[_type == "fairnessMonth"]{ _id, people }\`);
}`,
    );
    expect(auditViolations(sites)).toHaveLength(0);
  });

  it("flags a literal-named write of the type on a recognised client as an unregistered protected-write", () => {
    const sites = scanSource(
      "app/utils/example.ts",
      `${CLIENT_IMPORTS}
export async function sneak() {
  await writeClient.create({ _id: "fairnessMonth.2026-11", _type: "fairnessMonth" });
}`,
    );
    expect(sites.map((s) => s.kind)).toEqual(["protected-write"]);
    expect(auditViolations(sites)).toHaveLength(1);
  });
});
````

**Find** in `app/utils/__tests__/studioProtection.test.ts`:

````ts
//
// The point of these tests: "we configured the Studio" is not evidence. The
// policy is code, so every capability of every one of the fifteen protected types
// is asserted here, plus the wiring in `sanity.config.ts` / `sanity/structure.ts`
// that actually installs it — and the fact that the v5-inert
````

**Replace with:**

````ts
//
// The point of these tests: "we configured the Studio" is not evidence. The
// policy is code, so every capability of every one of the sixteen protected types
// is asserted here, plus the wiring in `sanity.config.ts` / `sanity/structure.ts`
// that actually installs it — and the fact that the v5-inert
````

**Find** in `app/utils/__tests__/studioProtection.test.ts`:

````ts

describe("studio protection policy", () => {
  it("covers exactly the fifteen protected types, keeping the saturdarSongs typo", () => {
    expect([...PROTECTED_STUDIO_TYPES]).toEqual([
      "sunday_role",
````

**Replace with:**

````ts

describe("studio protection policy", () => {
  it("covers exactly the sixteen protected types, keeping the saturdarSongs typo", () => {
    expect([...PROTECTED_STUDIO_TYPES]).toEqual([
      "sunday_role",
````

**Find** in `app/utils/__tests__/studioProtection.test.ts`:

````ts
      // second write path around the `_rev`-checked admin route.
      "solverConfig",
      // Oasis Kids: the app is the writer (kids design spec §4.2, §5).
      "kidsPair",
````

**Replace with:**

````ts
      // second write path around the `_rev`-checked admin route.
      "solverConfig",
      // Solver v3 C2 REC-8: the monthly eligibility record — one writer, the executor.
      "fairnessMonth",
      // Oasis Kids: the app is the writer (kids design spec §4.2, §5).
      "kidsPair",
````

**Find** in `app/utils/__tests__/studioProtection.test.ts`:

````ts
      "specialIdentityCoordinator",
      "solverConfig",
      "kidsPair",
      "kidsSchedule",
````

**Replace with:**

````ts
      "specialIdentityCoordinator",
      "solverConfig",
      "fairnessMonth",
      "kidsPair",
      "kidsSchedule",
````

**Find** in `app/utils/__tests__/studioProtection.test.ts`:

````ts
      "specialIdentityCoordinator",
      "solverConfig",
      "mcpOauthGrant",
      "mcpOauthCodeRedemption",
````

**Replace with:**

````ts
      "specialIdentityCoordinator",
      "solverConfig",
      "fairnessMonth",
      "mcpOauthGrant",
      "mcpOauthCodeRedemption",
````

**Find** in `app/utils/__tests__/studioProtection.test.ts`:

````ts
      "sanity/schemas/notificationOutbox.ts",
      "sanity/schemas/solverConfig.ts",
      "sanity/schemas/kidsPair.ts",
      "sanity/schemas/kidsSchedule.ts",
````

**Replace with:**

````ts
      "sanity/schemas/notificationOutbox.ts",
      "sanity/schemas/solverConfig.ts",
      "sanity/schemas/fairnessMonth.ts",
      "sanity/schemas/kidsPair.ts",
      "sanity/schemas/kidsSchedule.ts",
````

**Find** in `app/utils/__tests__/studioProtection.test.ts`:

````ts
  });

  it("marks all fifteen protected schema types read-only", () => {
    const files: Record<string, string> = {
      sunday_role: "sanity/schemas/sunRole.ts",
````

**Replace with:**

````ts
  });

  it("marks all sixteen protected schema types read-only", () => {
    const files: Record<string, string> = {
      sunday_role: "sanity/schemas/sunRole.ts",
````

**Find** in `app/utils/__tests__/studioProtection.test.ts`:

````ts
      specialIdentityCoordinator: "sanity/schemas/specialIdentityCoordinator.ts",
      solverConfig: "sanity/schemas/solverConfig.ts",
      kidsPair: "sanity/schemas/kidsPair.ts",
      kidsSchedule: "sanity/schemas/kidsSchedule.ts",
````

**Replace with:**

````ts
      specialIdentityCoordinator: "sanity/schemas/specialIdentityCoordinator.ts",
      solverConfig: "sanity/schemas/solverConfig.ts",
      fairnessMonth: "sanity/schemas/fairnessMonth.ts",
      kidsPair: "sanity/schemas/kidsPair.ts",
      kidsSchedule: "sanity/schemas/kidsSchedule.ts",
````

**Find** in `app/utils/__tests__/studioProtection.test.ts`:

````ts
      "sanity/schemas/specialIdentityCoordinator.ts",
      "sanity/schemas/solverConfig.ts",
      "sanity/schemas/mcpOauthGrant.ts",
      "sanity/schemas/mcpOauthCodeRedemption.ts",
````

**Replace with:**

````ts
      "sanity/schemas/specialIdentityCoordinator.ts",
      "sanity/schemas/solverConfig.ts",
      "sanity/schemas/fairnessMonth.ts",
      "sanity/schemas/mcpOauthGrant.ts",
      "sanity/schemas/mcpOauthCodeRedemption.ts",
````

**Find** in `app/utils/__tests__/studioProtection.test.ts`:

````ts
        "specialIdentityCoordinator",
        "solverConfig",
        "mcpOauthGrant",
        "mcpOauthCodeRedemption",
````

**Replace with:**

````ts
        "specialIdentityCoordinator",
        "solverConfig",
        "fairnessMonth",
        "mcpOauthGrant",
        "mcpOauthCodeRedemption",
````

**Find** in `app/utils/__tests__/protectedReadAudit.test.ts`:

````ts
      "setlistProposal",
      "specialIdentityCoordinator",
    ]);
  });
````

**Replace with:**

````ts
      "setlistProposal",
      "specialIdentityCoordinator",
      "fairnessMonth",
    ]);
  });
````

- [ ] **Step 2: Run them to see them fail**

Run: `git add -A && npx vitest run app/utils/__tests__/fairnessMonthSchema.test.ts app/utils/__tests__/studioProtection.test.ts app/utils/__tests__/protectedReadAudit.test.ts`
Expected: FAIL — the schema module does not resolve and the pins name a type nobody governs.

- [ ] **Step 3: Implement**

**Create** `sanity/schemas/fairnessMonth.ts`:

````ts
import { defineType } from "sanity";

/**
 * The monthly ELIGIBILITY RECORD of the fairness ledger (solver v3 C2 REC-1 … REC-8).
 *
 * One document per calendar month at `_id: "fairnessMonth.YYYY-MM"`. The id is DOTTED on
 * purpose (parent A2): Sanity treats any id containing a dot as private, so the record —
 * which snapshots members' unavailable dates — is never served to an unauthenticated
 * read. The flip side is that every reader must carry the read token or fail closed: an
 * untokened read answers «no record» with no error.
 *
 * What it holds: who was eligible for which of the six voice role keys that month, each
 * person's exact rules (resolved for the month), the «Mes por medio» SETTING, «Exenta»,
 * per-date blocks, and the presence rules — the snapshot the ledger judges that month's
 * seats against. What it never holds (REC-5): seats served, balances, shares, the cadence
 * STATE, rule strings, names inside `presence`, a `published` field. Seats stay derived
 * from the role documents (ADR-0042).
 *
 * Written ONLY by the write executor in `app/utils/fairnessMonthWriteRequest.ts` —
 * through `PUT /api/admin/fairness/months` (`fairnessMonthCommit.ts`) or C4's consented
 * reconstruction script — which mints every `_key`, the content hash and the stamps.
 * Studio posture is the `solverConfig` one: `hidden` + `readOnly`, and governed in
 * `app/utils/studioProtection.ts` so `document.actions` strips every mutating action
 * however the pane was reached. The Content Lake is schemaless; this file governs Studio
 * VISIBILITY only and gates nothing at runtime.
 */
export const fairnessMonth = defineType({
  name: "fairnessMonth",
  title: "Registro de equidad (interno)",
  type: "document",
  hidden: true,
  readOnly: true,
  description:
    "Interno: quién era elegible para cada rol de voz en un mes. Lo escribe la app o la reconstrucción; nunca a mano.",
  fields: [
    { name: "schemaVersion", title: "Versión del esquema", type: "number" },
    { name: "month", title: "Mes (YYYY-MM)", type: "string" },
    { name: "source", title: "Origen", type: "string" },
    { name: "engine", title: "Solver", type: "string" },
    { name: "environment", title: "Entorno", type: "string" },
    { name: "recordedAt", title: "Registrado", type: "datetime" },
    { name: "recordedBy", title: "Registrado por", type: "string" },
    { name: "contentHash", title: "Hash del contenido", type: "string" },
    {
      name: "people",
      title: "Personas",
      type: "array",
      of: [
        {
          type: "object",
          name: "fairnessPerson",
          fields: [
            { name: "member", title: "Miembro", type: "reference", to: [{ type: "teamMembers" }], weak: true },
            { name: "name", title: "Nombre (solo para mostrar)", type: "string" },
            {
              name: "roles",
              title: "Roles",
              type: "object",
              fields: [
                { name: "sunLead", title: "Dom Lead", type: "string" },
                { name: "satLead", title: "Sáb Lead", type: "string" },
                { name: "sunBgv", title: "Dom BGV", type: "string" },
                { name: "satBgv", title: "Sáb BGV", type: "string" },
                { name: "sunChoir", title: "Dom Coro", type: "string" },
                { name: "satChoir", title: "Sáb Coro", type: "string" },
              ],
            },
            {
              name: "exactRules",
              title: "Reglas fijas",
              type: "array",
              of: [
                {
                  type: "object",
                  name: "fairnessExactRule",
                  fields: [
                    { name: "roles", title: "Roles", type: "array", of: [{ type: "string" }] },
                    { name: "count", title: "Lugares", type: "number" },
                  ],
                },
              ],
            },
            { name: "sundayCadence", title: "Domingo", type: "string", description: "Interno: vacío = Normal" },
            { name: "exempt", title: "Exenta", type: "boolean" },
            {
              name: "blocks",
              title: "Fechas",
              type: "array",
              of: [
                {
                  type: "object",
                  name: "fairnessBlock",
                  fields: [
                    { name: "date", title: "Fecha", type: "date" },
                    { name: "unavailable", title: "No disponible", type: "boolean" },
                    { name: "excludedRoles", title: "Roles excluidos por regla", type: "array", of: [{ type: "string" }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      name: "presence",
      title: "Reglas de presencia",
      type: "array",
      of: [
        {
          type: "object",
          name: "fairnessPresence",
          fields: [
            { name: "ruleKey", title: "Regla", type: "string" },
            { name: "roles", title: "Roles", type: "array", of: [{ type: "string" }] },
            { name: "members", title: "Miembros (ids)", type: "array", of: [{ type: "string" }] },
            { name: "exclusive", title: "Exclusiva", type: "boolean" },
          ],
        },
      ],
    },
  ],
});
````

**Find** in `sanity/schema.ts`:

````ts
// sanity/schemas/solverConfig.ts.
import { solverConfig } from './schemas/solverConfig';
// Oasis Kids scheduling vertical (P2): pair roster + one schedule document per
// Sunday at a deterministic id. See sanity/schemas/kidsPair.ts and
````

**Replace with:**

````ts
// sanity/schemas/solverConfig.ts.
import { solverConfig } from './schemas/solverConfig';
// The monthly eligibility record of the fairness ledger (solver v3 C2). Hidden +
// read-only and governed like `solverConfig`. See sanity/schemas/fairnessMonth.ts.
import { fairnessMonth } from './schemas/fairnessMonth';
// Oasis Kids scheduling vertical (P2): pair roster + one schedule document per
// Sunday at a deterministic id. See sanity/schemas/kidsPair.ts and
````

**Find** in `sanity/schema.ts`:

````ts

export const schema: { types: SchemaTypeDefinition[] } = {
  types: [post, tag, author, featuredSongs, saturdaySongs, saturdayRole, sundayRole, teamMembers, specialRole, loginEvent, setlistProposal, roleTargetLock, roleCreationReceipt, notificationOutbox, specialIdentityCoordinator, solverConfig, kidsPair, kidsSchedule, mcpOauthGrant, mcpOauthCodeRedemption],
}
````

**Replace with:**

````ts

export const schema: { types: SchemaTypeDefinition[] } = {
  types: [post, tag, author, featuredSongs, saturdaySongs, saturdayRole, sundayRole, teamMembers, specialRole, loginEvent, setlistProposal, roleTargetLock, roleCreationReceipt, notificationOutbox, specialIdentityCoordinator, solverConfig, fairnessMonth, kidsPair, kidsSchedule, mcpOauthGrant, mcpOauthCodeRedemption],
}
````

**Find** in `app/utils/studioProtection.ts`:

````ts
// Studio protection policy for the fifteen protected stored types
// (Service Readiness A2 §8 / A3 §4) — pure, exported, and unit-testable.
//
````

**Replace with:**

````ts
// Studio protection policy for the sixteen protected stored types
// (Service Readiness A2 §8 / A3 §4) — pure, exported, and unit-testable.
//
````

**Find** in `app/utils/studioProtection.ts`:

````ts

/**
 * The fifteen protected stored types. `saturdarSongs` is a deliberate stored typo —
 * never rename.
 *
````

**Replace with:**

````ts

/**
 * The sixteen protected stored types. `saturdarSongs` is a deliberate stored typo —
 * never rename.
 *
````

**Find** in `app/utils/studioProtection.ts`:

````ts
  "specialIdentityCoordinator",
  "solverConfig",
  // Oasis Kids scheduling (kids design spec §4.2, §5): the app is the writer and
  // the Studio is not the editing surface. Protected but deliberately NOT
````

**Replace with:**

````ts
  "specialIdentityCoordinator",
  "solverConfig",
  // The monthly eligibility record of the fairness ledger (solver v3 C2 REC-8): machine
  // state written only by the write executor in `fairnessMonthWriteRequest.ts`, under a
  // revision assertion and with a minted `_key` per item. Internal, like `solverConfig`.
  "fairnessMonth",
  // Oasis Kids scheduling (kids design spec §4.2, §5): the app is the writer and
  // the Studio is not the editing surface. Protected but deliberately NOT
````

**Find** in `app/utils/studioProtection.ts`:

````ts

/**
 * The seven internal types: never authored by hand at all, so they are also
 * `hidden: true` in the schema and never appear in any create affordance.
 * `notificationOutbox` is additionally delete-only (above) — it is the one type
````

**Replace with:**

````ts

/**
 * The eight internal types: never authored by hand at all, so they are also
 * `hidden: true` in the schema and never appear in any create affordance.
 * `notificationOutbox` is additionally delete-only (above) — it is the one type
````

**Find** in `app/utils/studioProtection.ts`:

````ts
 * only by `app/mcp/oauth/grantStore.ts`, never human-meaningful content — unlike
 * `kidsPair`/`kidsSchedule`, which are protected but deliberately NOT internal.
 */
export const INTERNAL_STUDIO_TYPES = [
````

**Replace with:**

````ts
 * only by `app/mcp/oauth/grantStore.ts`, never human-meaningful content — unlike
 * `kidsPair`/`kidsSchedule`, which are protected but deliberately NOT internal.
 *
 * `fairnessMonth` (solver v3 C2) joins for the `solverConfig` reason: its one writer is
 * the revision-asserting write executor, and a Studio delete, duplicate or restore would
 * be a second, unguarded write path into the record the fairness ledger reads.
 */
export const INTERNAL_STUDIO_TYPES = [
````

**Find** in `app/utils/studioProtection.ts`:

````ts
  "specialIdentityCoordinator",
  "solverConfig",
  "mcpOauthGrant",
  "mcpOauthCodeRedemption",
````

**Replace with:**

````ts
  "specialIdentityCoordinator",
  "solverConfig",
  "fairnessMonth",
  "mcpOauthGrant",
  "mcpOauthCodeRedemption",
````

**Find** in `app/utils/studioProtection.ts`:

````ts
    "updatedAt",
    "updatedBy",
  ],
  // Every field either MCP OAuth type may carry — written only by
````

**Replace with:**

````ts
    "updatedAt",
    "updatedBy",
  ],
  // Every field of the eligibility record (C2 REC-1 … REC-4): the executor writes the
  // whole document, with a `_key` per item and a content hash over it. No field of it is
  // hand-authored legitimately (REC-8).
  fairnessMonth: [
    "schemaVersion",
    "month",
    "source",
    "engine",
    "environment",
    "recordedAt",
    "recordedBy",
    "contentHash",
    "people",
    "presence",
  ],
  // Every field either MCP OAuth type may carry — written only by
````

**Find** in `app/utils/studioProtection.ts`:

````ts
  specialIdentityCoordinator: "Coordinador de especiales (solo lectura)",
  solverConfig: "Reglas del planificador (solo lectura)",
  kidsPair: "Kids — Parejas (solo lectura)",
  kidsSchedule: "Kids — Roles del domingo (solo lectura)",
````

**Replace with:**

````ts
  specialIdentityCoordinator: "Coordinador de especiales (solo lectura)",
  solverConfig: "Reglas del planificador (solo lectura)",
  fairnessMonth: "Registros de equidad (solo lectura)",
  kidsPair: "Kids — Parejas (solo lectura)",
  kidsSchedule: "Kids — Roles del domingo (solo lectura)",
````

**Find** in `app/utils/protectedReadAudit.ts`:

````ts
  "setlistProposal",
  "specialIdentityCoordinator",
] as const;

````

**Replace with:**

````ts
  "setlistProposal",
  "specialIdentityCoordinator",
  // Solver v3 C2 REC-9: the monthly eligibility record. Its ids are dotted (private), so a
  // read off a non-canonical client is the A2 failure; its one writer is the executor
  // (`PROTECTED_WRITE_EXECUTORS`).
  "fairnessMonth",
] as const;

````

- [ ] **Step 4: Run them to see them pass**

Run: `git add -A && npx vitest run app/utils/__tests__/fairnessMonthSchema.test.ts app/utils/__tests__/studioProtection.test.ts app/utils/__tests__/protectedReadAudit.test.ts app/mcp/__tests__/mcpProtectedTypeLiterals.test.ts`
Expected: PASS. No real site names `"fairnessMonth"` on a client yet (`serviceReadQueries.ts` imports no client), so the real-repository scan is unchanged.

- [ ] **Step 5: Gates and commit**

Run: `git add -A && npx tsc --noEmit && npm test && npx eslint .`
Expected: **454 files / 8230 tests**; 0 errors, 81 warnings. (No file under `app/` was added, so `colour-inventory.json` is unchanged.)

```bash
git add -A
git commit -m "feat(fairness): the fairnessMonth record type, governed in the Studio and the audit" -m "Solver v3 C2 REC-1 to REC-5, REC-8 and the type half of REC-9. The monthly eligibility record is a hidden, read-only document type at a dotted (private) id; it joins PROTECTED_STUDIO_TYPES, INTERNAL_STUDIO_TYPES (every field in INTERNAL_STUDIO_FIELDS) and PROTECTED_STUDIO_TITLES, so document.actions strips every mutating action however the pane is reached, and it joins the audit's PROTECTED_TYPES so a read off a non-canonical client or a literal-named write is a violation. serviceReadModel's unrelated PROTECTED_TYPES is untouched."
```


---
## Task 5: The record's validator, keys, content hash, stored document and parser — **[CRITICAL slice: the writer's validator and serializer]**

Spec REC-1 (id), REC-3/REC-4 (keys), REC-6 (hash), REC-7, WR-3, WR-4, WR-17 (IF2-18), IF2-19, IF2-20, IF2-2 (the stored document). The write-request module is created here, neutral and `tsx`-importable, and joins the caller pin with no importer yet — the pin's scan widens to `app/` and `scripts/` (GU-1). The pinned digest was computed by the implementation AND independently by `shasum -a 256` over the pinned canonical text. A parsed record with its names dropped is a valid write body that hashes back to its own `contentHash` — the GET → PUT round trip C6's CF-3 relies on.

**Files:**
- Create: `app/utils/fairnessMonthWriteRequest.ts`
- Modify: `app/utils/__tests__/serviceCommitCallers.test.ts` (header comment, `EXPECTED_CALLERS` `:42-48`, `PINNED_BEYOND_COMMIT` `:54`, `trackedAppSources` `:65-69`)
- Test: `app/utils/__tests__/fairnessMonthWriteRequest.test.ts`
- Regenerate: `app/utils/__tests__/__fixtures__/colour-inventory.json`

**Interfaces:**
- Consumes: from Task 1 — `ROLE_KEYS`, `canonicalRoles`, `compareCodepoint`, `isMonthString`, `isRoleKey`, `isStatus`, `monthIndex`, types `FairnessMonthBody`, `FairnessMonthWrite`, `LogicalRecord`, `RoleKey`, `Status`; `isValidServiceDate` (`serviceReadModel.ts`).
- Produces: `FAIRNESS_MONTH_TYPE`, `FAIRNESS_SCHEMA_VERSION`, `type Actor = "route" | "reconstruction"`, `interface FairnessIssue { path; message }`, `ROLE_FIELD`, `fairnessMonthId(month)`, `personKey(memberId)`, `exactRuleKey(roles)`, `blockKey(date)`, `presenceKey(ruleKey)`, `RULE_KEY_RE` (Task 12 moves it to the vocabulary), `validateFairnessMonthWrite(body: unknown, actor: Actor, currentMonth: string): { ok: true; value } | { ok: false; issues: FairnessIssue[] }`, `canonicalFairnessContent(input)`, `contentHashOfWrite(month, body): string`, `contentHashOfStored(doc: unknown): string`, `isIntact(doc: unknown): boolean`, `interface FairnessMonthFields`, `buildFairnessMonthDocument(input: { body; source; engine; environment; recordedAt; recordedBy; names: ReadonlyMap<string, string> })`, `parseStoredFairnessMonth(doc: unknown): { ok: true; record: LogicalRecord } | { ok: false; refusal: "malformed_record"; issues: FairnessIssue[] }`.

- [ ] **Step 1: Write the failing tests and pin the new module**

**Create** `app/utils/__tests__/fairnessMonthWriteRequest.test.ts`:

````ts
// Solver v3 C2 — the write-request module, part 1: the body validator (IF2-18; WR-3,
// WR-4, WR-17, REC-3, REC-4, A11, A38), the id and keys (REC-1, REC-3, REC-4), the
// content hash (IF2-19, REC-6), the stored document (IF2-2) and the stored-record parser
// (IF2-20, RD-2, REC-7). Every name below is fictitious (this repository is public).
import { describe, expect, it } from "vitest";

import {
  blockKey,
  buildFairnessMonthDocument,
  canonicalFairnessContent,
  contentHashOfStored,
  contentHashOfWrite,
  exactRuleKey,
  fairnessMonthId,
  isIntact,
  parseStoredFairnessMonth,
  personKey,
  presenceKey,
  validateFairnessMonthWrite,
} from "../fairnessMonthWriteRequest";
import type { FairnessMonthWrite, RoleKey, Status } from "../fairnessVocabulary";

const ALL_OUT: Record<RoleKey, Status> = {
  "Sun.Lead": "out",
  "Sat.Lead": "out",
  "Sun.BGV": "out",
  "Sat.BGV": "out",
  "Sun.Choir": "out",
  "Sat.Choir": "out",
};
const roles = (patch: Partial<Record<RoleKey, Status>>): Record<RoleKey, Status> => ({ ...ALL_OUT, ...patch });

/** A valid route body for November 2026: Alma (exact Dom Lead 2), Bruno (cadence), Carmen. */
function body(): FairnessMonthWrite {
  return {
    month: "2026-11",
    source: "auto",
    expectedRev: null,
    people: [
      {
        memberId: "m-carmen",
        roles: roles({ "Sun.BGV": "in", "Sat.BGV": "in", "Sun.Choir": "in", "Sat.Choir": "in" }),
        exactRules: [],
        exempt: false,
        blocks: [
          { date: "2026-11-15", unavailable: true, excludedRoles: [] },
          { date: "2026-11-08", unavailable: false, excludedRoles: ["Sun.Choir", "Sun.BGV"] },
        ],
      },
      {
        memberId: "m-alma",
        roles: roles({ "Sun.Lead": "exact", "Sat.Lead": "in", "Sun.BGV": "in" }),
        exactRules: [{ roles: ["Sun.Lead"], count: 2 }],
        exempt: true,
        blocks: [],
      },
      {
        memberId: "m-bruno",
        roles: roles({ "Sun.Lead": "in", "Sat.Lead": "in" }),
        exactRules: [],
        sundayCadence: "alternate",
        exempt: false,
        blocks: [],
      },
    ],
    presence: [{ ruleKey: "rule-1", roles: ["Sun.BGV"], members: ["m-carmen", "m-alma"], exclusive: false }],
  };
}

const validate = (b: unknown, current = "2026-10") => validateFairnessMonthWrite(b, "route", current);
const pathsOf = (b: unknown, current = "2026-10") => {
  const r = validate(b, current);
  return r.ok ? [] : r.issues.map((i) => i.path);
};

describe("validateFairnessMonthWrite (C2 IF2-18)", () => {
  it("accepts a valid route body", () => {
    expect(validate(body())).toEqual({ ok: true, value: body() });
  });

  it("refuses unknown fields and every server stamp at any level", () => {
    const b = body() as unknown as Record<string, unknown>;
    for (const stamp of ["schemaVersion", "engine", "environment", "recordedAt", "recordedBy", "contentHash", "_key", "name"]) {
      expect(pathsOf({ ...b, [stamp]: "x" }), stamp).toEqual([stamp]);
    }
    const withName = body();
    (withName.people[0] as Record<string, unknown>).name = "Carmen";
    expect(pathsOf(withName)).toEqual(["people[0].name"]);
    const withKey = body();
    (withKey.presence[0] as Record<string, unknown>)._key = "r1";
    expect(pathsOf(withKey)).toEqual(["presence[0]._key"]);
  });

  it("decides the source rule by actor: route needs auto|manual, reconstruction carries none", () => {
    expect(pathsOf({ ...body(), source: "reconstructed" })).toEqual(["source"]);
    const { source: _source, ...noSource } = body();
    void _source;
    expect(pathsOf(noSource)).toEqual(["source"]);
    expect(validateFairnessMonthWrite(noSource, "reconstruction", "2026-12").ok).toBe(true);
    const r = validateFairnessMonthWrite(body(), "reconstruction", "2026-12");
    expect(r.ok ? [] : r.issues.map((i) => i.path)).toEqual(["source"]);
  });

  it("caps the month at the current CDMX month + 12", () => {
    const noBlocks = body();
    noBlocks.people[0].blocks = [];
    expect(pathsOf({ ...noBlocks, month: "2027-10" }, "2026-10")).toEqual([]);
    expect(pathsOf({ ...noBlocks, month: "2027-11" }, "2026-10")).toEqual(["month"]);
    expect(pathsOf({ ...noBlocks, month: "2026-13" })).toEqual(["month"]);
  });

  it("checks expectedRev", () => {
    expect(pathsOf({ ...body(), expectedRev: "rev-1" })).toEqual([]);
    expect(pathsOf({ ...body(), expectedRev: "" })).toEqual(["expectedRev"]);
    expect(pathsOf({ ...body(), expectedRev: "x".repeat(65) })).toEqual(["expectedRev"]);
    const { expectedRev: _rev, ...missing } = body();
    void _rev;
    expect(pathsOf(missing)).toEqual(["expectedRev"]);
  });

  it("limits people to 1–100 with unique member ids", () => {
    expect(pathsOf({ ...body(), people: [], presence: [] })).toEqual(["people"]);
    const many = Array.from({ length: 101 }, (_, i) => ({ ...body().people[2], memberId: `m-${i}` }));
    expect(pathsOf({ ...body(), people: many, presence: [] })).toEqual(["people"]);
    const twice = body();
    twice.people.push({ ...twice.people[0] });
    expect(pathsOf(twice)).toEqual(["people[3].memberId"]);
  });

  it("needs exactly the six role keys, each in|out|exact", () => {
    const missing = body();
    delete (missing.people[0].roles as Partial<Record<RoleKey, Status>>)["Sat.Choir"];
    expect(pathsOf(missing)).toEqual(["people[0].roles"]);
    const bad = body();
    (bad.people[0].roles as Record<string, string>)["Sun.BGV"] = "maybe";
    expect(pathsOf(bad)).toEqual(["people[0].roles.sunBgv"]);
  });

  it("keeps exact rules consistent with the statuses (REC-3)", () => {
    const unlisted = body();
    unlisted.people[1].exactRules = [];
    expect(pathsOf(unlisted)).toEqual(["people[1].roles.sunLead"]);
    const notExact = body();
    notExact.people[1].exactRules = [{ roles: ["Sun.Lead", "Sat.Lead"], count: 2 }];
    expect(pathsOf(notExact)).toEqual(["people[1].exactRules[0].roles"]);
    const count = body();
    count.people[1].exactRules = [{ roles: ["Sun.Lead"], count: 32 }];
    expect(pathsOf(count)).toEqual(["people[1].exactRules[0].count"]);
    count.people[1].exactRules = [{ roles: ["Sun.Lead"], count: 1.5 }];
    expect(pathsOf(count)).toEqual(["people[1].exactRules[0].count"]);
  });

  it("refuses two exact items of one person sharing a role key as overlapping_exact (A38)", () => {
    const b = body();
    b.people[1].roles = roles({ "Sun.Lead": "exact", "Sat.Lead": "exact" });
    b.people[1].exactRules = [
      { roles: ["Sun.Lead"], count: 2 },
      { roles: ["Sun.Lead", "Sat.Lead"], count: 1 },
    ];
    const r = validate(b);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues).toContainEqual({ path: "people[1]", message: "overlapping_exact" });
  });

  it("refuses «Mes por medio» together with an exact rule covering Sun.Lead (A11)", () => {
    const b = body();
    b.people[1].sundayCadence = "alternate";
    const r = validate(b);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues).toEqual([{ path: "people[1].sundayCadence", message: "cadence_and_exact" }]);
  });

  it("keeps blocks inside the month, unique, and never empty", () => {
    const outside = body();
    outside.people[0].blocks = [{ date: "2026-12-01", unavailable: true, excludedRoles: [] }];
    expect(pathsOf(outside)).toEqual(["people[0].blocks[0].date"]);
    const twice = body();
    twice.people[0].blocks = [
      { date: "2026-11-01", unavailable: true, excludedRoles: [] },
      { date: "2026-11-01", unavailable: true, excludedRoles: [] },
    ];
    expect(pathsOf(twice)).toEqual(["people[0].blocks[1].date"]);
    const empty = body();
    empty.people[0].blocks = [{ date: "2026-11-01", unavailable: false, excludedRoles: [] }];
    expect(pathsOf(empty)).toEqual(["people[0].blocks[0]"]);
  });

  it("checks presence rules: key grammar, unique keys, 1–6 roles, 2–12 listed members", () => {
    const badKey = body();
    badKey.presence[0].ruleKey = "has space";
    expect(pathsOf(badKey)).toEqual(["presence[0].ruleKey"]);
    const dup = body();
    dup.presence.push({ ...dup.presence[0] });
    expect(pathsOf(dup)).toEqual(["presence[1].ruleKey"]);
    const unlisted = body();
    unlisted.presence[0].members = ["m-carmen", "m-nadie"];
    expect(pathsOf(unlisted)).toEqual(["presence[0].members"]);
    const noRoles = body();
    noRoles.presence[0].roles = [];
    expect(pathsOf(noRoles)).toEqual(["presence[0].roles"]);
  });

  it("never puts a stored value in a path or a message (key hygiene)", () => {
    const b = body();
    b.people[0].memberId = "m-alma";
    b.presence[0].ruleKey = "d-alma-bruno extra";
    const r = validate(b);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      for (const issue of r.issues) {
        expect(issue.path).not.toMatch(/alma|bruno/);
        expect(issue.message).not.toMatch(/alma|bruno/);
      }
    }
  });
});

describe("the record's id and keys (C2 REC-1, REC-3, REC-4)", () => {
  it("builds the dotted, private id", () => {
    expect(fairnessMonthId("2026-11")).toBe("fairnessMonth.2026-11");
  });

  it("mints keys that never carry a raw id or rule key", () => {
    expect(personKey("m.alma")).toMatch(/^p[0-9a-f]{24}$/);
    expect(personKey("m.alma")).not.toBe(personKey("m.bruno"));
    expect(exactRuleKey(["Sat.Lead", "Sun.Lead"])).toBe(exactRuleKey(["Sun.Lead", "Sat.Lead"]));
    expect(blockKey("2026-11-08")).toBe("d20261108");
    expect(presenceKey("d-alma-bruno")).toMatch(/^r[0-9a-f]{24}$/);
  });
});

const STAMPS = {
  source: "auto" as const,
  engine: "v3" as const,
  environment: "preview" as const,
  recordedAt: "2026-10-20T18:00:00.000Z",
  recordedBy: "m-admin",
  names: new Map([
    ["m-alma", "Alma"],
    ["m-bruno", "Bruno"],
    ["m-carmen", "Carmen"],
  ]),
};

describe("the content hash (C2 IF2-19, REC-6)", () => {
  it("pins the canonical serialization and its digest", () => {
    const b = body();
    const people = b.people.map((p) => ({
      memberId: p.memberId,
      roles: (k: RoleKey) => p.roles[k],
      exactRules: p.exactRules,
      sundayCadence: p.sundayCadence,
      exempt: p.exempt,
      blocks: p.blocks,
    }));
    const text = canonicalFairnessContent({ schemaVersion: 1, month: b.month, people, presence: b.presence });
    expect(text).toBe(
      '{"schemaVersion":1,"month":"2026-11","people":[' +
        '{"memberId":"m-alma","roles":["exact","in","in","out","out","out"],"exactRules":[{"roles":["Sun.Lead"],"count":2}],"sundayCadence":null,"exempt":true,"blocks":[]},' +
        '{"memberId":"m-bruno","roles":["in","in","out","out","out","out"],"exactRules":[],"sundayCadence":"alternate","exempt":false,"blocks":[]},' +
        '{"memberId":"m-carmen","roles":["out","out","in","in","in","in"],"exactRules":[],"sundayCadence":null,"exempt":false,"blocks":[' +
        '{"date":"2026-11-08","unavailable":false,"excludedRoles":["Sun.BGV","Sun.Choir"]},' +
        '{"date":"2026-11-15","unavailable":true,"excludedRoles":[]}]}],' +
        '"presence":[{"ruleKey":"rule-1","roles":["Sun.BGV"],"members":["m-alma","m-carmen"],"exclusive":false}]}',
    );
    expect(contentHashOfWrite("2026-11", b)).toBe(PINNED_DIGEST);
  });

  it("is independent of input order and of source/expectedRev", () => {
    const reordered = body();
    reordered.people.reverse();
    reordered.people[0].blocks.reverse();
    reordered.presence[0].members.reverse();
    reordered.source = "manual";
    reordered.expectedRev = "rev-9";
    expect(contentHashOfWrite("2026-11", reordered)).toBe(contentHashOfWrite("2026-11", body()));
  });

  it("changes with one eligibility, block, rule or flag", () => {
    const base = contentHashOfWrite("2026-11", body());
    const edits: Array<(b: FairnessMonthWrite) => void> = [
      (b) => (b.people[0].roles["Sat.Choir"] = "out"),
      (b) => (b.people[0].blocks[0].unavailable = false),
      (b) => (b.people[1].exactRules[0].count = 3),
      (b) => (b.people[1].exempt = false),
      (b) => delete b.people[2].sundayCadence,
      (b) => (b.presence[0].exclusive = true),
    ];
    for (const edit of edits) {
      const b = body();
      edit(b);
      expect(contentHashOfWrite("2026-11", b)).not.toBe(base);
    }
  });

  it("hashes the document written from a body exactly like the body, and finds it intact", () => {
    const doc = buildFairnessMonthDocument({ body: body(), ...STAMPS });
    expect(doc.contentHash).toBe(contentHashOfWrite("2026-11", body()));
    expect(contentHashOfStored(doc)).toBe(doc.contentHash);
    expect(isIntact(doc)).toBe(true);
  });

  it("finds a stored document with one field edited NOT intact, and still hashes junk", () => {
    const doc = buildFairnessMonthDocument({ body: body(), ...STAMPS });
    const edited = structuredClone(doc);
    (edited.people[0].roles as Record<string, string>).satChoir = "in";
    expect(isIntact(edited)).toBe(false);
    const junkRole = structuredClone(doc);
    ((junkRole.people[0].exactRules as Array<{ roles: string[] }>)[0].roles).push("Sun.Junk");
    expect(isIntact(junkRole)).toBe(false);
    expect(contentHashOfStored({ month: 7, people: "x" })).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(contentHashOfStored(null)).toMatch(/^sha256:/);
  });

  it("ignores names, keys and stamps", () => {
    const doc = buildFairnessMonthDocument({ body: body(), ...STAMPS });
    const restamped = { ...structuredClone(doc), source: "manual", recordedBy: "m-other", recordedAt: "x", _rev: "r2" };
    restamped.people[0].name = "Otra";
    restamped.people[0]._key = "pZZ";
    expect(contentHashOfStored(restamped)).toBe(doc.contentHash);
  });
});

/** Pinned on the unchanged implementation; a different digest is a change to REC-6. */
const PINNED_DIGEST = "sha256:4e581e9e542bf96e057017b8b37c0050d9ef65c5476e2d51b555bc16043d2c20";

describe("the stored document (C2 IF2-2)", () => {
  it("sorts and keys every item, stores names from the member read and the role fields undotted", () => {
    const doc = buildFairnessMonthDocument({ body: body(), ...STAMPS });
    expect(doc._id).toBe("fairnessMonth.2026-11");
    expect(doc.people.map((p) => (p.member as { _ref: string })._ref)).toEqual(["m-alma", "m-bruno", "m-carmen"]);
    expect(doc.people[0]).toMatchObject({
      _key: personKey("m-alma"),
      _type: "fairnessPerson",
      member: { _type: "reference", _ref: "m-alma", _weak: true },
      name: "Alma",
      roles: { sunLead: "exact", satLead: "in", sunBgv: "in", satBgv: "out", sunChoir: "out", satChoir: "out" },
      exactRules: [{ _key: exactRuleKey(["Sun.Lead"]), _type: "fairnessExactRule", roles: ["Sun.Lead"], count: 2 }],
      exempt: true,
    });
    expect(doc.people[0]).not.toHaveProperty("sundayCadence");
    expect(doc.people[1]).toHaveProperty("sundayCadence", "alternate");
    expect(doc.people[2].blocks).toEqual([
      { _key: "d20261108", _type: "fairnessBlock", date: "2026-11-08", unavailable: false, excludedRoles: ["Sun.BGV", "Sun.Choir"] },
      { _key: "d20261115", _type: "fairnessBlock", date: "2026-11-15", unavailable: true, excludedRoles: [] },
    ]);
    expect(doc.presence).toEqual([
      { _key: presenceKey("rule-1"), _type: "fairnessPresence", ruleKey: "rule-1", roles: ["Sun.BGV"], members: ["m-alma", "m-carmen"], exclusive: false },
    ]);
  });
});

function storedDoc(): Record<string, unknown> {
  return { ...buildFairnessMonthDocument({ body: body(), ...STAMPS }), _rev: "rev-1", _createdAt: "t", _updatedAt: "t" };
}

describe("parseStoredFairnessMonth (C2 IF2-20, RD-2)", () => {
  it("maps a valid document to the logical record (IF2-3)", () => {
    const parsed = parseStoredFairnessMonth(storedDoc());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.record).toMatchObject({
      month: "2026-11",
      rev: "rev-1",
      source: "auto",
      engine: "v3",
      environment: "preview",
      recordedAt: "2026-10-20T18:00:00.000Z",
    });
    expect(parsed.record.people[0]).toEqual({
      memberId: "m-alma",
      name: "Alma",
      roles: roles({ "Sun.Lead": "exact", "Sat.Lead": "in", "Sun.BGV": "in" }),
      exactRules: [{ roles: ["Sun.Lead"], count: 2 }],
      exempt: true,
      blocks: [],
    });
    expect(parsed.record.people[1].sundayCadence).toBe("alternate");
    expect(parsed.record.presence).toEqual([{ ruleKey: "rule-1", roles: ["Sun.BGV"], members: ["m-alma", "m-carmen"], exclusive: false }]);
  });

  it("refuses an unknown schemaVersion", () => {
    const parsed = parseStoredFairnessMonth({ ...storedDoc(), schemaVersion: 2 });
    expect(parsed).toEqual({ ok: false, refusal: "malformed_record", issues: [{ path: "schemaVersion", message: "unknown schemaVersion" }] });
  });

  it.each(["schemaVersion", "month", "_rev", "source", "engine", "environment", "recordedAt", "recordedBy", "contentHash", "people", "presence"])(
    "refuses a document missing %s",
    (key) => {
      const doc = storedDoc();
      delete doc[key];
      const parsed = parseStoredFairnessMonth(doc);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.issues.map((i) => i.path)).toContain(key);
    },
  );

  it("refuses a listed item missing one of its six role fields (REC-7: never read as «out»)", () => {
    const doc = storedDoc();
    delete ((doc.people as Array<{ roles: Record<string, string> }>)[2].roles).satChoir;
    const parsed = parseStoredFairnessMonth(doc);
    expect(parsed).toEqual({
      ok: false,
      refusal: "malformed_record",
      issues: [{ path: "people[2].roles.satChoir", message: "required field missing" }],
    });
  });

  it("refuses an invalid enum", () => {
    const doc = storedDoc();
    doc.source = "imported";
    ((doc.people as Array<{ roles: Record<string, string> }>)[0].roles).sunLead = "maybe";
    const parsed = parseStoredFairnessMonth(doc);
    expect(parsed.ok ? [] : parsed.issues).toEqual([
      { path: "source", message: "invalid enum value" },
      { path: "people[0].roles.sunLead", message: "invalid enum value" },
    ]);
  });

  it("round-trips: a parsed record, names dropped, is a write body with the record's own hash (IF2-3, IF2-19; C6 CF-3)", () => {
    const doc = storedDoc();
    const parsed = parseStoredFairnessMonth(doc);
    if (!parsed.ok) throw new Error("parse");
    const entry = {
      month: parsed.record.month,
      people: parsed.record.people.map(({ name: _name, ...person }) => person),
      presence: parsed.record.presence,
    };
    expect(contentHashOfWrite(entry.month, entry)).toBe(doc.contentHash);
    expect(validateFairnessMonthWrite({ ...entry, source: "auto", expectedRev: "rev-1" }, "route", "2026-10").ok).toBe(true);
  });

  it("leaves intactness to the hash: a refused document can still be hashed", () => {
    const doc = { ...storedDoc(), schemaVersion: 2 };
    expect(parseStoredFairnessMonth(doc).ok).toBe(false);
    expect(contentHashOfStored(doc)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
````

**Find** in `app/utils/__tests__/serviceCommitCallers.test.ts`:

````ts
// it on purpose.
//
// WHAT COUNTS AS A CALLER. Any git-tracked, non-test source under `app/` whose
// comment-stripped code imports the module by a value import: `import … from`,
// `export … from`, a side-effect `import "…"`, a dynamic `import("…")` or a
````

**Replace with:**

````ts
// it on purpose.
//
// WHAT COUNTS AS A CALLER. Any git-tracked, non-test source under `app/` or
// `scripts/` (widened for the fairness write executor, solver v3 C2 WR-16: C4's
// `tsx` script is its one importer outside `app/`, and a wider scan loosens no
// existing row — no script imports any other pinned module) whose
// comment-stripped code imports the module by a value import: `import … from`,
// `export … from`, a side-effect `import "…"`, a dynamic `import("…")` or a
````

**Find** in `app/utils/__tests__/serviceCommitCallers.test.ts`:

````ts
  roleUnpublishCommit: ["app/api/admin/roles/unpublish/route.ts", "app/mcp/tools/unpublishService.ts"],
  setlistSaveCommit: ["app/api/admin/setlists/route.ts", "app/mcp/tools/editSetlist.ts"],
};

````

**Replace with:**

````ts
  roleUnpublishCommit: ["app/api/admin/roles/unpublish/route.ts", "app/mcp/tools/unpublishService.ts"],
  setlistSaveCommit: ["app/api/admin/setlists/route.ts", "app/mcp/tools/editSetlist.ts"],
  // Solver v3 C2 WR-16 / IF2-23: the ONE mutation path of `fairnessMonth`. Its importer
  // list grows only by a reviewed edit here — C2 adds `fairnessMonthCommit.ts` and
  // `fairnessLedgerRead.ts`; C4 adds its CLI file and its `scripts/lib` core.
  fairnessMonthWriteRequest: [],
};

````

**Find** in `app/utils/__tests__/serviceCommitCallers.test.ts`:

````ts
 * writer and a tool must agree on. Each is a repo-relative path.
 */
const PINNED_BEYOND_COMMIT: string[] = ["app/utils/publishVerdict.ts"];

const SOURCE_RE = /\.(ts|tsx|mjs|cjs|js)$/;
````

**Replace with:**

````ts
 * writer and a tool must agree on. Each is a repo-relative path.
 */
const PINNED_BEYOND_COMMIT: string[] = ["app/utils/publishVerdict.ts", "app/utils/fairnessMonthWriteRequest.ts"];

const SOURCE_RE = /\.(ts|tsx|mjs|cjs|js)$/;
````

**Find** in `app/utils/__tests__/serviceCommitCallers.test.ts`:

````ts

function trackedAppSources(): string[] {
  return execFileSync("git", ["ls-files", "app"], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\n")
    .filter((f) => f && isNonTestSource(f));
````

**Replace with:**

````ts

function trackedAppSources(): string[] {
  return execFileSync("git", ["ls-files", "app", "scripts"], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\n")
    .filter((f) => f && isNonTestSource(f));
````

- [ ] **Step 2: Run them to see them fail**

Run: `git add -A && npx vitest run app/utils/__tests__/fairnessMonthWriteRequest.test.ts app/utils/__tests__/serviceCommitCallers.test.ts`
Expected: FAIL — the module does not resolve, and the pin names a module that does not exist.

- [ ] **Step 3: Implement**

**Create** `app/utils/fairnessMonthWriteRequest.ts`:

````ts
// app/utils/fairnessMonthWriteRequest.ts
//
// THE write-request module of the monthly eligibility record (`fairnessMonth`, solver v3
// C2 REC, WR; spec IF2-18 … IF2-22). It owns everything about the stored shape: the id
// and every `_key` (only this module constructs them, REC-1), the body validator (WR-3,
// WR-4, WR-17), the content hash (REC-6), the stored-record parser (RD-2), the write
// decision for both actors (WR-8, WR-14) and the ONE write executor (WR-16).
//
// NEUTRAL BUT NOT CLIENT-IMPORTABLE: no "use client", no `server-only`, no module-level
// Sanity client — C4's `tsx` script imports it with its own injected clients — but it
// hashes with `node:crypto`, so no client module may import it. The eligibility
// resolver (IF2-15), which IS client-callable, lives in `fairnessEligibility.ts`.
//
// Key hygiene (spec §6): every issue's `path` is index-based (field names and array
// indexes in input order) and every `message` is a fixed text — no member id, name,
// `ruleKey` or other stored value — so an issue may be logged or returned safely.

import { createHash } from "node:crypto";

import {
  ROLE_KEYS,
  canonicalRoles,
  compareCodepoint,
  isMonthString,
  isRoleKey,
  isStatus,
  monthIndex,
  type FairnessMonthBody,
  type FairnessMonthWrite,
  type LogicalRecord,
  type RoleKey,
  type Status,
} from "./fairnessVocabulary";
import { isValidServiceDate } from "./serviceReadModel";

export const FAIRNESS_MONTH_TYPE = "fairnessMonth";
export const FAIRNESS_SCHEMA_VERSION = 1;

/** Who may write: the PUT (`route`) or C4's consented script (`reconstruction`). */
export type Actor = "route" | "reconstruction";

/** One validation issue (IF2-18's format, shared by IF2-20 and IF2-22). */
export interface FairnessIssue {
  path: string;
  message: string;
}

/** The stored field of each role key — dotted field names are invalid in Sanity (REC-3). */
export const ROLE_FIELD: Readonly<Record<RoleKey, "sunLead" | "satLead" | "sunBgv" | "satBgv" | "sunChoir" | "satChoir">> = {
  "Sun.Lead": "sunLead",
  "Sat.Lead": "satLead",
  "Sun.BGV": "sunBgv",
  "Sat.BGV": "satBgv",
  "Sun.Choir": "sunChoir",
  "Sat.Choir": "satChoir",
};

// ─── Identity and keys (REC-1, REC-3, REC-4) ─────────────────────────────────

/** The record's id: dotted, so private (parent A2). Only this module builds it. */
export function fairnessMonthId(month: string): string {
  return `${FAIRNESS_MONTH_TYPE}.${month}`;
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** `"p"` + 24 hex of SHA-256 of the member `_id` — never the raw id, which may contain dots. */
export function personKey(memberId: string): string {
  return `p${sha256Hex(memberId).slice(0, 24)}`;
}

/** `"x"` + 24 hex of SHA-256 of the canonical role list. */
export function exactRuleKey(roles: readonly RoleKey[]): string {
  return `x${sha256Hex(canonicalRoles(roles).join(",")).slice(0, 24)}`;
}

/** `"d"` + YYYYMMDD. */
export function blockKey(date: string): string {
  return `d${date.replace(/-/g, "")}`;
}

/** `"r"` + 24 hex of SHA-256 of the presence rule key. */
export function presenceKey(ruleKey: string): string {
  return `r${sha256Hex(ruleKey).slice(0, 24)}`;
}

// ─── Small guards ────────────────────────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** A Sanity document id (letters, digits, `.`, `_`, `-`; ≤ 128). */
const MEMBER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** REC-4's presence rule key grammar. */
export const RULE_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;

const at = (base: string, key: string) => (base ? `${base}.${key}` : key);
const idx = (base: string, i: number) => `${base}[${i}]`;

/** Fixed messages, one per violated rule — never a stored value. */
const MSG = {
  object: "must be an object",
  unknown: "unknown field",
  required: "required field missing",
  month: "must be a YYYY-MM month",
  monthCeiling: "is more than 12 months after the current month",
  source: "must be auto or manual",
  expectedRev: "must be null or a non-empty revision of at most 64 characters",
  array: "must be an array",
  peopleCount: "must hold 1 to 100 people",
  memberId: "must be a member id",
  duplicateMember: "lists a member twice",
  roles: "must hold exactly the six role keys",
  status: "must be in, out or exact",
  roleList: "must hold 1 to 6 distinct role keys",
  count: "must be a whole number from 1 to 31",
  notExact: "lists a role whose status is not exact",
  exactUnlisted: "is exact but no exact rule lists it",
  overlapping: "overlapping_exact",
  cadence: "must be absent or alternate",
  cadenceAndExact: "cadence_and_exact",
  boolean: "must be a boolean",
  blocksCount: "must hold at most 31 dates",
  date: "must be a date inside the month",
  duplicateDate: "lists a date twice",
  excludedRoles: "must hold distinct role keys",
  emptyBlock: "must mark the date unavailable or exclude a role",
  presenceCount: "must hold at most 20 rules",
  ruleKey: "must match the rule key grammar",
  duplicateRule: "lists a rule key twice",
  members: "must hold 2 to 12 distinct listed members",
} as const;

function unknownFields(value: Record<string, unknown>, allowed: readonly string[], path: string, issues: FairnessIssue[]) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) issues.push({ path: at(path, key), message: MSG.unknown });
  }
}

function roleList(value: unknown, min: number): value is RoleKey[] {
  if (!Array.isArray(value) || value.length < min || value.length > 6) return false;
  if (!value.every(isRoleKey)) return false;
  return new Set(value).size === value.length;
}

// ─── The body validator (IF2-18; WR-3, WR-4, WR-17, REC-3, REC-4, A11, A38) ──

const ROUTE_FIELDS = ["month", "source", "expectedRev", "people", "presence"] as const;
const RECONSTRUCTION_FIELDS = ["month", "expectedRev", "people", "presence"] as const;
const PERSON_FIELDS = ["memberId", "roles", "exactRules", "sundayCadence", "exempt", "blocks"] as const;
const EXACT_FIELDS = ["roles", "count"] as const;
const BLOCK_FIELDS = ["date", "unavailable", "excludedRoles"] as const;
const PRESENCE_FIELDS = ["ruleKey", "roles", "members", "exclusive"] as const;

/**
 * Validate ONE write entry. Strict: unknown fields at any level are refused, and so is
 * every server-derived stamp, `_key`, `name` and `contentHash`. `actor` decides only
 * WR-4's `source` rule (route: `auto`|`manual`; reconstruction: absent); `currentMonth`
 * (CDMX `YYYY-MM`) decides only WR-4's «at most current month + 12». A delete entry is
 * not a body and never comes here.
 */
export function validateFairnessMonthWrite(
  body: unknown,
  actor: Actor,
  currentMonth: string,
):
  | { ok: true; value: FairnessMonthWrite | Omit<FairnessMonthWrite, "source"> }
  | { ok: false; issues: FairnessIssue[] } {
  const issues: FairnessIssue[] = [];
  if (!isPlainObject(body)) return { ok: false, issues: [{ path: "", message: MSG.object }] };
  unknownFields(body, actor === "route" ? ROUTE_FIELDS : RECONSTRUCTION_FIELDS, "", issues);

  const month = body.month;
  const monthOk = isMonthString(month);
  if (!monthOk) issues.push({ path: "month", message: MSG.month });
  else if (isMonthString(currentMonth) && monthIndex(month) > monthIndex(currentMonth) + 12) {
    issues.push({ path: "month", message: MSG.monthCeiling });
  }

  if (actor === "route" && body.source !== "auto" && body.source !== "manual") {
    issues.push({ path: "source", message: MSG.source });
  }

  if (!("expectedRev" in body)) issues.push({ path: "expectedRev", message: MSG.required });
  else if (
    body.expectedRev !== null &&
    !(typeof body.expectedRev === "string" && body.expectedRev.length > 0 && body.expectedRev.length <= 64)
  ) {
    issues.push({ path: "expectedRev", message: MSG.expectedRev });
  }

  const memberIds = new Set<string>();
  if (!Array.isArray(body.people)) issues.push({ path: "people", message: MSG.array });
  else {
    if (body.people.length < 1 || body.people.length > 100) issues.push({ path: "people", message: MSG.peopleCount });
    body.people.forEach((person, i) => validatePerson(person, idx("people", i), monthOk ? month : null, memberIds, issues));
  }

  if (!Array.isArray(body.presence)) issues.push({ path: "presence", message: MSG.array });
  else {
    if (body.presence.length > 20) issues.push({ path: "presence", message: MSG.presenceCount });
    const ruleKeys = new Set<string>();
    body.presence.forEach((rule, j) => validatePresence(rule, idx("presence", j), memberIds, ruleKeys, issues));
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: body as unknown as FairnessMonthWrite };
}

function validatePerson(
  person: unknown,
  path: string,
  month: string | null,
  memberIds: Set<string>,
  issues: FairnessIssue[],
) {
  if (!isPlainObject(person)) {
    issues.push({ path, message: MSG.object });
    return;
  }
  unknownFields(person, PERSON_FIELDS, path, issues);
  for (const required of ["memberId", "roles", "exactRules", "exempt", "blocks"]) {
    if (!(required in person)) issues.push({ path: at(path, required), message: MSG.required });
  }

  if ("memberId" in person) {
    if (typeof person.memberId !== "string" || !MEMBER_ID_RE.test(person.memberId)) {
      issues.push({ path: at(path, "memberId"), message: MSG.memberId });
    } else if (memberIds.has(person.memberId)) {
      issues.push({ path: at(path, "memberId"), message: MSG.duplicateMember });
    } else memberIds.add(person.memberId);
  }

  const statuses = new Map<RoleKey, Status>();
  if ("roles" in person) {
    const roles = person.roles;
    if (!isPlainObject(roles) || Object.keys(roles).length !== 6 || !Object.keys(roles).every(isRoleKey)) {
      issues.push({ path: at(path, "roles"), message: MSG.roles });
    } else {
      for (const key of ROLE_KEYS) {
        if (!isStatus(roles[key])) issues.push({ path: at(at(path, "roles"), ROLE_FIELD[key]), message: MSG.status });
        else statuses.set(key, roles[key] as Status);
      }
    }
  }

  const listedBy = new Map<RoleKey, number>();
  let overlapping = false;
  let coversSunLead = false;
  if ("exactRules" in person) {
    if (!Array.isArray(person.exactRules)) issues.push({ path: at(path, "exactRules"), message: MSG.array });
    else {
      person.exactRules.forEach((rule, j) => {
        const rulePath = idx(at(path, "exactRules"), j);
        if (!isPlainObject(rule)) {
          issues.push({ path: rulePath, message: MSG.object });
          return;
        }
        unknownFields(rule, EXACT_FIELDS, rulePath, issues);
        if (!roleList(rule.roles, 1)) issues.push({ path: at(rulePath, "roles"), message: MSG.roleList });
        else {
          for (const key of rule.roles) {
            const seen = listedBy.get(key) ?? 0;
            if (seen > 0) overlapping = true;
            listedBy.set(key, seen + 1);
            if (key === "Sun.Lead") coversSunLead = true;
            if (statuses.size === 6 && statuses.get(key) !== "exact") {
              issues.push({ path: at(rulePath, "roles"), message: MSG.notExact });
            }
          }
        }
        if (!(Number.isInteger(rule.count) && (rule.count as number) >= 1 && (rule.count as number) <= 31)) {
          issues.push({ path: at(rulePath, "count"), message: MSG.count });
        }
      });
    }
  }
  if (overlapping) issues.push({ path, message: MSG.overlapping });
  if (statuses.size === 6) {
    for (const key of ROLE_KEYS) {
      if (statuses.get(key) === "exact" && !listedBy.has(key)) {
        issues.push({ path: at(at(path, "roles"), ROLE_FIELD[key]), message: MSG.exactUnlisted });
      }
    }
  }

  if ("sundayCadence" in person) {
    if (person.sundayCadence !== "alternate") issues.push({ path: at(path, "sundayCadence"), message: MSG.cadence });
    else if (coversSunLead) issues.push({ path: at(path, "sundayCadence"), message: MSG.cadenceAndExact });
  }

  if ("exempt" in person && typeof person.exempt !== "boolean") issues.push({ path: at(path, "exempt"), message: MSG.boolean });

  if ("blocks" in person) {
    if (!Array.isArray(person.blocks)) issues.push({ path: at(path, "blocks"), message: MSG.array });
    else {
      if (person.blocks.length > 31) issues.push({ path: at(path, "blocks"), message: MSG.blocksCount });
      const dates = new Set<string>();
      person.blocks.forEach((block, k) => {
        const blockPath = idx(at(path, "blocks"), k);
        if (!isPlainObject(block)) {
          issues.push({ path: blockPath, message: MSG.object });
          return;
        }
        unknownFields(block, BLOCK_FIELDS, blockPath, issues);
        const date = block.date;
        if (!isValidServiceDate(date) || (month !== null && date.slice(0, 7) !== month)) {
          issues.push({ path: at(blockPath, "date"), message: MSG.date });
        } else if (dates.has(date)) issues.push({ path: at(blockPath, "date"), message: MSG.duplicateDate });
        else dates.add(date);
        if (typeof block.unavailable !== "boolean") issues.push({ path: at(blockPath, "unavailable"), message: MSG.boolean });
        if (!roleList(block.excludedRoles, 0)) issues.push({ path: at(blockPath, "excludedRoles"), message: MSG.excludedRoles });
        else if (block.unavailable === false && block.excludedRoles.length === 0) {
          issues.push({ path: blockPath, message: MSG.emptyBlock });
        }
      });
    }
  }
}

function validatePresence(
  rule: unknown,
  path: string,
  memberIds: Set<string>,
  ruleKeys: Set<string>,
  issues: FairnessIssue[],
) {
  if (!isPlainObject(rule)) {
    issues.push({ path, message: MSG.object });
    return;
  }
  unknownFields(rule, PRESENCE_FIELDS, path, issues);
  if (typeof rule.ruleKey !== "string" || !RULE_KEY_RE.test(rule.ruleKey)) {
    issues.push({ path: at(path, "ruleKey"), message: MSG.ruleKey });
  } else if (ruleKeys.has(rule.ruleKey)) issues.push({ path: at(path, "ruleKey"), message: MSG.duplicateRule });
  else ruleKeys.add(rule.ruleKey);
  if (!roleList(rule.roles, 1)) issues.push({ path: at(path, "roles"), message: MSG.roleList });
  const members = rule.members;
  if (
    !Array.isArray(members) ||
    members.length < 2 ||
    members.length > 12 ||
    !members.every((m) => typeof m === "string" && memberIds.has(m)) ||
    new Set(members).size !== members.length
  ) {
    issues.push({ path: at(path, "members"), message: MSG.members });
  }
  if (typeof rule.exclusive !== "boolean") issues.push({ path: at(path, "exclusive"), message: MSG.boolean });
}

// ─── The content hash (IF2-19, REC-6) ────────────────────────────────────────
//
// One serialization, two entry points. Codepoint order everywhere, never
// `localeCompare`. It excludes `name`, every `_key`/`_type`, every stamp, `_rev` and
// timestamps. Built defensively from `unknown`, so a hand-edited or malformed stored
// document still hashes — and hashes DIFFERENTLY from what was written: unknown role
// strings, missing fields and duplicates are kept in the serialization, never dropped.

/** Canonical role order for any list: known keys first in canonical order, then the rest by codepoint. */
function looseRoleList(value: unknown): unknown {
  if (!Array.isArray(value)) return value === undefined ? null : value;
  const rank = (v: unknown) => (typeof v === "string" && isRoleKey(v) ? ROLE_KEYS.indexOf(v) : ROLE_KEYS.length);
  return [...value].sort((a, b) => rank(a) - rank(b) || compareCodepoint(String(a), String(b)));
}

const orNull = (v: unknown) => (v === undefined ? null : v);

interface LoosePerson {
  memberId: unknown;
  roles: (key: RoleKey) => unknown;
  exactRules: unknown;
  sundayCadence: unknown;
  exempt: unknown;
  blocks: unknown;
}

function serializePerson(p: LoosePerson): unknown {
  const exactRules = Array.isArray(p.exactRules)
    ? p.exactRules
        .map((r) => (isPlainObject(r) ? { roles: looseRoleList(r.roles), count: orNull(r.count) } : r))
        .map((r) => [JSON.stringify(r), r] as const)
        .sort(([a], [b]) => compareCodepoint(a, b))
        .map(([, r]) => r)
    : orNull(p.exactRules);
  const blocks = Array.isArray(p.blocks)
    ? p.blocks
        .map((b) =>
          isPlainObject(b)
            ? { date: orNull(b.date), unavailable: orNull(b.unavailable), excludedRoles: looseRoleList(b.excludedRoles) }
            : b,
        )
        .sort((a, b) => compareCodepoint(String(isPlainObject(a) ? a.date : ""), String(isPlainObject(b) ? b.date : "")))
    : orNull(p.blocks);
  return {
    memberId: orNull(p.memberId),
    roles: ROLE_KEYS.map((k) => orNull(p.roles(k))),
    exactRules,
    sundayCadence: orNull(p.sundayCadence),
    exempt: orNull(p.exempt),
    blocks,
  };
}

function serializePresence(rule: unknown): unknown {
  if (!isPlainObject(rule)) return rule;
  return {
    ruleKey: orNull(rule.ruleKey),
    roles: looseRoleList(rule.roles),
    members: Array.isArray(rule.members) ? [...rule.members].sort((a, b) => compareCodepoint(String(a), String(b))) : orNull(rule.members),
    exclusive: orNull(rule.exclusive),
  };
}

function bySerializedKey(field: "memberId" | "ruleKey") {
  return (a: unknown, b: unknown) =>
    compareCodepoint(String(isPlainObject(a) ? a[field] : ""), String(isPlainObject(b) ? b[field] : ""));
}

/** The canonical serialization REC-6 hashes. Exported so a test can pin its exact text. */
export function canonicalFairnessContent(input: {
  schemaVersion: unknown;
  month: unknown;
  people: LoosePerson[] | unknown;
  presence: unknown;
}): string {
  const people = Array.isArray(input.people)
    ? (input.people as LoosePerson[]).map(serializePerson).sort(bySerializedKey("memberId"))
    : orNull(input.people);
  const presence = Array.isArray(input.presence)
    ? input.presence.map(serializePresence).sort(bySerializedKey("ruleKey"))
    : orNull(input.presence);
  return JSON.stringify({ schemaVersion: orNull(input.schemaVersion), month: orNull(input.month), people, presence });
}

const hashOf = (text: string) => `sha256:${sha256Hex(text)}`;

/** IF2-19 — the hash of a write body (its `source`/`expectedRev`, if present, are ignored). */
export function contentHashOfWrite(month: string, body: FairnessMonthBody): string {
  const people: LoosePerson[] = (body.people ?? []).map((p) => ({
    memberId: p.memberId,
    roles: (key) => p.roles?.[key],
    exactRules: p.exactRules,
    sundayCadence: p.sundayCadence,
    exempt: p.exempt,
    blocks: p.blocks,
  }));
  return hashOf(canonicalFairnessContent({ schemaVersion: FAIRNESS_SCHEMA_VERSION, month, people, presence: body.presence }));
}

/**
 * IF2-19 — the hash recomputed from a STORED document, as read: `member._ref` is that
 * person's `memberId` (only the reference wrapper is ignored), the six role fields map
 * back to role keys, and `_key`s, `name` and stamps are ignored. Never throws: a
 * malformed document hashes too (C4's rollback reads it without the parser). A stored
 * record is INTACT iff this equals its stored `contentHash`.
 */
export function contentHashOfStored(doc: unknown): string {
  const d = isPlainObject(doc) ? doc : {};
  const people = Array.isArray(d.people)
    ? d.people.map((item): LoosePerson => {
        const p = isPlainObject(item) ? item : {};
        const roles = isPlainObject(p.roles) ? p.roles : {};
        return {
          memberId: isPlainObject(p.member) ? p.member._ref : undefined,
          roles: (key) => roles[ROLE_FIELD[key]],
          exactRules: p.exactRules,
          sundayCadence: p.sundayCadence,
          exempt: p.exempt,
          blocks: p.blocks,
        };
      })
    : d.people;
  return hashOf(canonicalFairnessContent({ schemaVersion: d.schemaVersion, month: d.month, people, presence: d.presence }));
}

/** Intactness (REC-6): the recomputed hash equals the stored one. */
export function isIntact(doc: unknown): boolean {
  return isPlainObject(doc) && typeof doc.contentHash === "string" && contentHashOfStored(doc) === doc.contentHash;
}

// ─── The stored document (IF2-2) ─────────────────────────────────────────────

/** Every non-system field the executor writes (WR-11 sets exactly these on a replace). */
export interface FairnessMonthFields {
  schemaVersion: 1;
  month: string;
  source: LogicalRecord["source"];
  engine: LogicalRecord["engine"];
  environment: LogicalRecord["environment"];
  recordedAt: string;
  recordedBy: string;
  contentHash: string;
  people: Array<Record<string, unknown>>;
  presence: Array<Record<string, unknown>>;
}

/**
 * The document a write stores, built from a VALIDATED body: people by member id, presence
 * by rule key, blocks by date, exact rules by canonical role list, every role-key list in
 * canonical order, a minted `_key` and `_type` per item, `name` from `names` (the
 * executor's member read, WR-16) and the content hash of the body (REC-6).
 */
export function buildFairnessMonthDocument(input: {
  body: FairnessMonthBody;
  source: LogicalRecord["source"];
  engine: LogicalRecord["engine"];
  environment: LogicalRecord["environment"];
  recordedAt: string;
  recordedBy: string;
  names: ReadonlyMap<string, string>;
}): { _id: string; _type: typeof FAIRNESS_MONTH_TYPE } & FairnessMonthFields {
  const { body } = input;
  const people = [...body.people]
    .sort((a, b) => compareCodepoint(a.memberId, b.memberId))
    .map((p) => {
      const roles: Record<string, Status> = {};
      for (const key of ROLE_KEYS) roles[ROLE_FIELD[key]] = p.roles[key];
      return {
        _key: personKey(p.memberId),
        _type: "fairnessPerson",
        member: { _type: "reference", _ref: p.memberId, _weak: true },
        name: input.names.get(p.memberId) ?? "",
        roles,
        exactRules: p.exactRules
          .map((r) => ({ roles: canonicalRoles(r.roles), count: r.count }))
          .sort((a, b) => compareCodepoint(a.roles.join(","), b.roles.join(",")))
          .map((r) => ({ _key: exactRuleKey(r.roles), _type: "fairnessExactRule", roles: r.roles, count: r.count })),
        ...(p.sundayCadence === "alternate" ? { sundayCadence: "alternate" } : {}),
        exempt: p.exempt,
        blocks: [...p.blocks]
          .sort((a, b) => compareCodepoint(a.date, b.date))
          .map((b) => ({
            _key: blockKey(b.date),
            _type: "fairnessBlock",
            date: b.date,
            unavailable: b.unavailable,
            excludedRoles: canonicalRoles(b.excludedRoles),
          })),
      };
    });
  const presence = [...body.presence]
    .sort((a, b) => compareCodepoint(a.ruleKey, b.ruleKey))
    .map((r) => ({
      _key: presenceKey(r.ruleKey),
      _type: "fairnessPresence",
      ruleKey: r.ruleKey,
      roles: canonicalRoles(r.roles),
      members: [...r.members].sort(compareCodepoint),
      exclusive: r.exclusive,
    }));
  return {
    _id: fairnessMonthId(body.month),
    _type: FAIRNESS_MONTH_TYPE,
    schemaVersion: FAIRNESS_SCHEMA_VERSION,
    month: body.month,
    source: input.source,
    engine: input.engine,
    environment: input.environment,
    recordedAt: input.recordedAt,
    recordedBy: input.recordedBy,
    contentHash: contentHashOfWrite(body.month, body),
    people,
    presence,
  };
}

// ─── The stored-record parser (IF2-20, RD-2) ─────────────────────────────────

const SOURCES = ["auto", "manual", "reconstructed"] as const;
const ENGINES = ["v2", "v3"] as const;
const ENVIRONMENTS = ["production", "preview", "local"] as const;

const PARSE = {
  object: "must be an object",
  missing: "required field missing",
  schemaVersion: "unknown schemaVersion",
  enumValue: "invalid enum value",
  type: "wrong type",
  id: "does not match the month",
} as const;

/**
 * RD-2's record-schema check, the ONE definition: an unknown `schemaVersion`, a missing
 * field (a listed item missing any of its six role fields included, REC-7) or an
 * invalid enum refuses the record. Nothing more — intactness is `isIntact`, a separate
 * test a caller can run on a record this parser refuses (C4's rollback, C4 R18).
 */
export function parseStoredFairnessMonth(
  doc: unknown,
): { ok: true; record: LogicalRecord } | { ok: false; refusal: "malformed_record"; issues: FairnessIssue[] } {
  const issues: FairnessIssue[] = [];
  const refuse = () => ({ ok: false as const, refusal: "malformed_record" as const, issues });
  if (!isPlainObject(doc)) {
    issues.push({ path: "", message: PARSE.object });
    return refuse();
  }
  const str = (v: unknown, path: string, nonEmpty = false): v is string => {
    if (v === undefined) issues.push({ path, message: PARSE.missing });
    else if (typeof v !== "string" || (nonEmpty && v.length === 0)) issues.push({ path, message: PARSE.type });
    else return true;
    return false;
  };
  const bool = (v: unknown, path: string): v is boolean => {
    if (v === undefined) issues.push({ path, message: PARSE.missing });
    else if (typeof v !== "boolean") issues.push({ path, message: PARSE.type });
    else return true;
    return false;
  };
  const oneOf = <T extends string>(v: unknown, values: readonly T[], path: string): v is T => {
    if (v === undefined) issues.push({ path, message: PARSE.missing });
    else if (typeof v !== "string" || !(values as readonly string[]).includes(v)) issues.push({ path, message: PARSE.enumValue });
    else return true;
    return false;
  };
  const roleKeys = (v: unknown, path: string): v is RoleKey[] => {
    if (v === undefined) issues.push({ path, message: PARSE.missing });
    else if (!Array.isArray(v)) issues.push({ path, message: PARSE.type });
    else if (!v.every(isRoleKey)) issues.push({ path, message: PARSE.enumValue });
    else return true;
    return false;
  };
  const arr = (v: unknown, path: string): v is unknown[] => {
    if (v === undefined) issues.push({ path, message: PARSE.missing });
    else if (!Array.isArray(v)) issues.push({ path, message: PARSE.type });
    else return true;
    return false;
  };

  if (doc.schemaVersion === undefined) issues.push({ path: "schemaVersion", message: PARSE.missing });
  else if (doc.schemaVersion !== FAIRNESS_SCHEMA_VERSION) issues.push({ path: "schemaVersion", message: PARSE.schemaVersion });
  if (doc._type !== FAIRNESS_MONTH_TYPE) issues.push({ path: "_type", message: PARSE.enumValue });
  const monthOk = str(doc.month, "month") && isMonthString(doc.month);
  if (typeof doc.month === "string" && !isMonthString(doc.month)) issues.push({ path: "month", message: PARSE.type });
  if (str(doc._id, "_id") && monthOk && doc._id !== fairnessMonthId(doc.month as string)) {
    issues.push({ path: "_id", message: PARSE.id });
  }
  str(doc._rev, "_rev", true);
  oneOf(doc.source, SOURCES, "source");
  oneOf(doc.engine, ENGINES, "engine");
  oneOf(doc.environment, ENVIRONMENTS, "environment");
  str(doc.recordedAt, "recordedAt");
  str(doc.recordedBy, "recordedBy");
  str(doc.contentHash, "contentHash");

  const people: LogicalRecord["people"] = [];
  if (arr(doc.people, "people")) {
    doc.people.forEach((item, i) => {
      const path = idx("people", i);
      if (!isPlainObject(item)) {
        issues.push({ path, message: PARSE.object });
        return;
      }
      const member = item.member;
      let memberId = "";
      if (member === undefined) issues.push({ path: at(path, "member"), message: PARSE.missing });
      else if (!isPlainObject(member) || typeof member._ref !== "string" || member._ref.length === 0) {
        issues.push({ path: at(path, "member"), message: PARSE.type });
      } else memberId = member._ref;
      const nameOk = str(item.name, at(path, "name"));
      const roles = {} as Record<RoleKey, Status>;
      if (item.roles === undefined) issues.push({ path: at(path, "roles"), message: PARSE.missing });
      else if (!isPlainObject(item.roles)) issues.push({ path: at(path, "roles"), message: PARSE.type });
      else {
        const stored = item.roles;
        for (const key of ROLE_KEYS) {
          if (oneOf(stored[ROLE_FIELD[key]], ["in", "out", "exact"] as const, at(at(path, "roles"), ROLE_FIELD[key]))) {
            roles[key] = stored[ROLE_FIELD[key]] as Status;
          }
        }
      }
      const exactRules: Array<{ roles: RoleKey[]; count: number }> = [];
      if (arr(item.exactRules, at(path, "exactRules"))) {
        item.exactRules.forEach((rule, j) => {
          const rulePath = idx(at(path, "exactRules"), j);
          if (!isPlainObject(rule)) {
            issues.push({ path: rulePath, message: PARSE.object });
            return;
          }
          const rolesOk = roleKeys(rule.roles, at(rulePath, "roles"));
          if (rule.count === undefined) issues.push({ path: at(rulePath, "count"), message: PARSE.missing });
          else if (!Number.isInteger(rule.count)) issues.push({ path: at(rulePath, "count"), message: PARSE.type });
          else if (rolesOk) exactRules.push({ roles: [...(rule.roles as RoleKey[])], count: rule.count as number });
        });
      }
      if (item.sundayCadence !== undefined && item.sundayCadence !== "alternate") {
        issues.push({ path: at(path, "sundayCadence"), message: PARSE.enumValue });
      }
      const exemptOk = bool(item.exempt, at(path, "exempt"));
      const blocks: Array<{ date: string; unavailable: boolean; excludedRoles: RoleKey[] }> = [];
      if (arr(item.blocks, at(path, "blocks"))) {
        item.blocks.forEach((block, k) => {
          const blockPath = idx(at(path, "blocks"), k);
          if (!isPlainObject(block)) {
            issues.push({ path: blockPath, message: PARSE.object });
            return;
          }
          const dateOk = str(block.date, at(blockPath, "date"));
          const unavailableOk = bool(block.unavailable, at(blockPath, "unavailable"));
          const excludedOk = roleKeys(block.excludedRoles, at(blockPath, "excludedRoles"));
          if (dateOk && unavailableOk && excludedOk) {
            blocks.push({
              date: block.date as string,
              unavailable: block.unavailable as boolean,
              excludedRoles: [...(block.excludedRoles as RoleKey[])],
            });
          }
        });
      }
      if (memberId && nameOk && Object.keys(roles).length === 6 && exemptOk) {
        people.push({
          memberId,
          name: item.name as string,
          roles,
          exactRules,
          ...(item.sundayCadence === "alternate" ? { sundayCadence: "alternate" as const } : {}),
          exempt: item.exempt as boolean,
          blocks,
        });
      }
    });
  }

  const presence: LogicalRecord["presence"] = [];
  if (arr(doc.presence, "presence")) {
    doc.presence.forEach((rule, j) => {
      const path = idx("presence", j);
      if (!isPlainObject(rule)) {
        issues.push({ path, message: PARSE.object });
        return;
      }
      const keyOk = str(rule.ruleKey, at(path, "ruleKey"));
      const rolesOk = roleKeys(rule.roles, at(path, "roles"));
      let membersOk = false;
      if (arr(rule.members, at(path, "members"))) {
        if (!rule.members.every((m) => typeof m === "string")) issues.push({ path: at(path, "members"), message: PARSE.type });
        else membersOk = true;
      }
      const exclusiveOk = bool(rule.exclusive, at(path, "exclusive"));
      if (keyOk && rolesOk && membersOk && exclusiveOk) {
        presence.push({
          ruleKey: rule.ruleKey as string,
          roles: [...(rule.roles as RoleKey[])],
          members: [...(rule.members as string[])],
          exclusive: rule.exclusive as boolean,
        });
      }
    });
  }

  if (issues.length > 0) return refuse();
  return {
    ok: true,
    record: {
      month: doc.month as string,
      rev: doc._rev as string,
      contentHash: doc.contentHash as string,
      source: doc.source as LogicalRecord["source"],
      engine: doc.engine as LogicalRecord["engine"],
      environment: doc.environment as LogicalRecord["environment"],
      recordedAt: doc.recordedAt as string,
      people,
      presence,
    },
  };
}
````

**Regenerate** `app/utils/__tests__/__fixtures__/colour-inventory.json` (it records `filesScanned`, and this task adds a file under `app/`):

```bash
node scripts/colour-inventory.mjs
```

- [ ] **Step 4: Run them to see them pass**

Run: `git add -A && npx vitest run app/utils/__tests__/fairnessMonthWriteRequest.test.ts app/utils/__tests__/serviceCommitCallers.test.ts`
Expected: PASS. The pinned canonical text and `sha256:4e581e9e542bf96e057017b8b37c0050d9ef65c5476e2d51b555bc16043d2c20` match; a red digest is a change to REC-6, never a value to re-capture.

- [ ] **Step 5: Gates and commit**

Run: `git add -A && npx tsc --noEmit && npm test && npx eslint .`
Expected: **455 files / 8269 tests**; 0 errors, 81 warnings.

```bash
git add -A
git commit -m "feat(fairness): the record's validator, keys, content hash and stored-record parser" -m "Solver v3 C2 IF2-18 to IF2-20 and IF2-2, in the neutral write-request module (fairnessMonthWriteRequest.ts): the strict body validator with the actor's source rule and the current-month ceiling; the dotted id and every _key, minted only here; one canonical serialization behind the hash of a body and of a stored document, so intactness is a recomputation; the stored document built from a validated body; and the one record-schema check the reader and C4's script share. Issue paths are index-based and messages fixed, so no stored value reaches a log. The module joins the caller pin with no importer yet, and the pin's scan now covers scripts/ too."
```


---

## Task 6: The write decision for both actors — **[CRITICAL slice: the writer's decision table]**

Spec WR-8 (actor `route`), WR-14 rows 1–8 and D1–D4 (actor `reconstruction`), IF2-21. One pure function, shared by the executor (Task 7) and C4's planner. Row order is the contract: an identical intact replay is `unchanged` before the past-month, revision and services checks; a create never depends on freezing services (A27); only a replace is refused on a frozen month (A5).

**Files:**
- Modify: `app/utils/fairnessMonthWriteRequest.ts` (type import; append the decision)
- Test: `app/utils/__tests__/fairnessMonthDecision.test.ts`

**Interfaces:**
- Consumes: Task 5's module; `FairnessWriteRefusal` (Task 1).
- Produces: `type FairnessDecision = "create" | "replace" | "unchanged" | "delete" | { refused: FairnessWriteRefusal }`; `interface StoredRecordFacts { rev; source; contentHash; intact }`; `decideFairnessMonth(input: { actor; op: "write" | "delete"; month; currentMonth; expectedRev: string | null; bodyHash: string | null; stored: StoredRecordFacts | null; hasFreezingServices: boolean }): FairnessDecision` (throws on a route delete — a programming error).

- [ ] **Step 1: Write the failing test**

**Create** `app/utils/__tests__/fairnessMonthDecision.test.ts`:

````ts
// Solver v3 C2 IF2-21 — the write decision, table-driven over every row of WR-8 (actor
// route) and WR-14 (actor reconstruction, write and delete). Row order is part of the
// contract: an identical replay is `unchanged` before the past-month, revision and
// services checks (spec §9 «No-op first»), and a non-intact record is never `unchanged`.
import { describe, expect, it } from "vitest";

import { decideFairnessMonth, type StoredRecordFacts } from "../fairnessMonthWriteRequest";

const HASH = "sha256:aaa";
const OTHER = "sha256:bbb";
const rec = (patch: Partial<StoredRecordFacts> = {}): StoredRecordFacts => ({
  rev: "rev-1",
  source: "auto",
  contentHash: HASH,
  intact: true,
  ...patch,
});

type Input = Parameters<typeof decideFairnessMonth>[0];
const base: Input = {
  actor: "route",
  op: "write",
  month: "2026-11",
  currentMonth: "2026-11",
  expectedRev: null,
  bodyHash: HASH,
  stored: null,
  hasFreezingServices: false,
};

describe("decideFairnessMonth — actor route (WR-8)", () => {
  it.each<[string, Partial<Input>, ReturnType<typeof decideFairnessMonth>]>([
    ["row 1: identical intact content is unchanged, even past and frozen", { month: "2026-10", stored: rec(), expectedRev: "rev-0", hasFreezingServices: true }, "unchanged"],
    ["row 1 never: a non-intact record with the same stored hash falls through", { stored: rec({ intact: false }), expectedRev: "rev-1" }, "replace"],
    ["row 2: a past month", { month: "2026-10", stored: null }, { refused: "past_month" }],
    ["row 3: no record, expectedRev null → create", {}, "create"],
    ["row 3 (A27): no record, freezing services present → still create", { hasFreezingServices: true }, "create"],
    ["row 4: no record, expectedRev set → record_missing", { expectedRev: "rev-1" }, { refused: "record_missing" }],
    ["row 5: a record exists, expectedRev null", { stored: rec(), bodyHash: OTHER }, { refused: "record_exists" }],
    ["row 6: a different revision", { stored: rec(), bodyHash: OTHER, expectedRev: "rev-0" }, { refused: "stale_revision" }],
    ["row 7 (A5): the month has freezing services", { stored: rec(), bodyHash: OTHER, expectedRev: "rev-1", hasFreezingServices: true }, { refused: "month_has_services" }],
    ["row 8 (A6): otherwise replace", { stored: rec(), bodyHash: OTHER, expectedRev: "rev-1" }, "replace"],
    ["a future month replaces the same way", { month: "2026-12", stored: rec(), bodyHash: OTHER, expectedRev: "rev-1" }, "replace"],
  ])("%s", (_label, patch, expected) => {
    expect(decideFairnessMonth({ ...base, ...patch })).toEqual(expected);
  });

  it("refuses to decide a delete for the route — the route offers none (WR-13)", () => {
    expect(() => decideFairnessMonth({ ...base, op: "delete" })).toThrow(/never deletes/);
  });
});

const recon: Input = { ...base, actor: "reconstruction", month: "2026-09", currentMonth: "2026-11" };
const reconRec = (patch: Partial<StoredRecordFacts> = {}) => rec({ source: "reconstructed", ...patch });

describe("decideFairnessMonth — actor reconstruction, write (WR-14 rows 1–8)", () => {
  it.each<[string, Partial<Input>, ReturnType<typeof decideFairnessMonth>]>([
    ["row 1 (A4): the current month is not past", { month: "2026-11" }, { refused: "not_past_month" }],
    ["row 1: a future month", { month: "2026-12", stored: reconRec() }, { refused: "not_past_month" }],
    ["row 2: identical intact content", { stored: reconRec(), expectedRev: null }, "unchanged"],
    ["row 3: no record, expectedRev null", {}, "create"],
    ["row 4: no record, expectedRev set", { expectedRev: "rev-1" }, { refused: "record_missing" }],
    ["row 5: a record the route wrote", { stored: rec({ source: "manual" }), bodyHash: OTHER, expectedRev: "rev-1" }, { refused: "not_reconstruction_owned" }],
    ["row 6: a reconstructed record edited since", { stored: reconRec({ intact: false }), bodyHash: OTHER, expectedRev: "rev-1" }, { refused: "record_edited" }],
    ["row 7: a different revision", { stored: reconRec(), bodyHash: OTHER, expectedRev: "rev-0" }, { refused: "stale_revision" }],
    ["row 7: expectedRev null on an existing record", { stored: reconRec(), bodyHash: OTHER, expectedRev: null }, { refused: "stale_revision" }],
    ["row 8: otherwise replace", { stored: reconRec(), bodyHash: OTHER, expectedRev: "rev-1" }, "replace"],
    ["no freezing-services rule applies to this actor", { stored: reconRec(), bodyHash: OTHER, expectedRev: "rev-1", hasFreezingServices: true }, "replace"],
  ])("%s", (_label, patch, expected) => {
    expect(decideFairnessMonth({ ...recon, ...patch })).toEqual(expected);
  });
});

const del: Input = { ...recon, op: "delete", bodyHash: null, expectedRev: "rev-1" };

describe("decideFairnessMonth — actor reconstruction, delete (WR-14 D1–D4)", () => {
  it.each<[string, Partial<Input>, ReturnType<typeof decideFairnessMonth>]>([
    ["D1: no record", {}, { refused: "record_missing" }],
    ["D2: not reconstruction-owned", { stored: rec({ source: "auto" }) }, { refused: "not_reconstruction_owned" }],
    ["D3: edited after reconstruction", { stored: reconRec({ intact: false }) }, { refused: "record_edited" }],
    ["D4: a different revision", { stored: reconRec(), expectedRev: "rev-0" }, { refused: "stale_revision" }],
    ["otherwise delete", { stored: reconRec() }, "delete"],
    ["a delete has no past-month rule", { stored: reconRec(), month: "2026-12" }, "delete"],
  ])("%s", (_label, patch, expected) => {
    expect(decideFairnessMonth({ ...del, ...patch })).toEqual(expected);
  });
});
````

- [ ] **Step 2: Run it to see it fail**

Run: `git add -A && npx vitest run app/utils/__tests__/fairnessMonthDecision.test.ts`
Expected: FAIL — `decideFairnessMonth` is not exported.

- [ ] **Step 3: Implement**

**Find** in `app/utils/fairnessMonthWriteRequest.ts`:

````ts
  type FairnessMonthBody,
  type FairnessMonthWrite,
  type LogicalRecord,
  type RoleKey,
````

**Replace with:**

````ts
  type FairnessMonthBody,
  type FairnessMonthWrite,
  type FairnessWriteRefusal,
  type LogicalRecord,
  type RoleKey,
````

**Find** in `app/utils/fairnessMonthWriteRequest.ts`:

````ts
    },
  };
}
````

**Replace with:**

````ts
    },
  };
}

// ─── The write decision (IF2-21; WR-8 for actor route, WR-14 for reconstruction) ──

export type FairnessDecision = "create" | "replace" | "unchanged" | "delete" | { refused: FairnessWriteRefusal };

/** What the executor's fresh re-read (WR-7) says about the stored record. */
export interface StoredRecordFacts {
  rev: string;
  source: LogicalRecord["source"];
  contentHash: string;
  /** `contentHashOfStored(doc) === doc.contentHash` (REC-6). */
  intact: boolean;
}

/**
 * ONE pure function, shared by the executor and C4's planner, so a planned action and
 * the executor's verdict cannot differ (C4 R14). Not part of it: WR-6's engine gate and
 * IF2-18's validation (both before it), and the live-member checks on a month decided
 * `create` or `replace` (after it). Rows are evaluated in the spec's order; the first
 * match wins.
 */
export function decideFairnessMonth(input: {
  actor: Actor;
  op: "write" | "delete";
  month: string;
  currentMonth: string;
  expectedRev: string | null;
  bodyHash: string | null;
  stored: StoredRecordFacts | null;
  hasFreezingServices: boolean;
}): FairnessDecision {
  const { actor, op, stored, expectedRev } = input;
  const past = monthIndex(input.month) < monthIndex(input.currentMonth);
  const sameContent = stored !== null && stored.intact && stored.contentHash === input.bodyHash;

  if (actor === "route") {
    if (op !== "write") throw new Error("decideFairnessMonth: the route actor never deletes");
    if (sameContent) return "unchanged"; //                                   WR-8 row 1
    if (past) return { refused: "past_month" }; //                            row 2
    if (stored === null) return expectedRev === null ? "create" : { refused: "record_missing" }; // rows 3, 4
    if (expectedRev === null) return { refused: "record_exists" }; //         row 5
    if (expectedRev !== stored.rev) return { refused: "stale_revision" }; //  row 6
    if (input.hasFreezingServices) return { refused: "month_has_services" }; // row 7 (A5)
    return "replace"; //                                                      row 8 (A6)
  }

  if (op === "delete") {
    if (stored === null) return { refused: "record_missing" }; //                       WR-14 D1
    if (stored.source !== "reconstructed") return { refused: "not_reconstruction_owned" }; // D2
    if (!stored.intact) return { refused: "record_edited" }; //                         D3
    if (expectedRev !== stored.rev) return { refused: "stale_revision" }; //            D4
    return "delete";
  }
  if (!past) return { refused: "not_past_month" }; //                                   WR-14 row 1 (A4)
  if (sameContent) return "unchanged"; //                                                row 2
  if (stored === null) return expectedRev === null ? "create" : { refused: "record_missing" }; // rows 3, 4
  if (stored.source !== "reconstructed") return { refused: "not_reconstruction_owned" }; // row 5
  if (!stored.intact) return { refused: "record_edited" }; //                            row 6
  if (expectedRev !== stored.rev) return { refused: "stale_revision" }; //               row 7
  return "replace"; //                                                                   row 8
}
````

- [ ] **Step 4: Run it to see it pass**

Run: `git add -A && npx vitest run app/utils/__tests__/fairnessMonthDecision.test.ts`
Expected: PASS (1 file, 29 tests).

- [ ] **Step 5: Gates and commit**

Run: `git add -A && npx tsc --noEmit && npm test && npx eslint .`
Expected: **456 files / 8298 tests**; 0 errors, 81 warnings.

```bash
git add -A
git commit -m "feat(fairness): the record write decision for both actors" -m "Solver v3 C2 IF2-21 (WR-8, WR-14). One pure function decides every month for the route and for C4's reconstruction script, so a planned action and the executor's verdict cannot differ. An identical intact replay is unchanged before the past-month, revision and services checks; a create never depends on freezing services (A27); only a replace is refused on a frozen month (A5); the reconstruction actor writes past months only, touches only intact records it wrote, and is the only actor that deletes."
```


---

## Task 7: The one write executor, and the audit's executor rule — **[CRITICAL slice: the only mutation path, revision assertion, audit rule]**

Spec WR-7, WR-9–WR-11, WR-13, WR-14 (execution), WR-16, IF2-22, IF2-23 (declaration), GU-5, GU-1 (the write-request module's `PROTECTED_RUNTIME_WRITERS` entry). The executor throws before any read unless the read client carries the token, `perspective: "published"` and `useCdn: false`; re-reads the records (whole), the freezing services (route only) and the listed members itself; decides through Task 6; checks the live members of every written month (WR-5 for the route; `member_unknown` for both); and commits — the route in ONE transaction, reconstruction one guarded transaction per month. Replace is one `ifRevisionId` patch setting every non-system field and unsetting the rest; delete is a revision-asserting no-op patch plus the delete in one transaction; `createOrReplace` never. Because the clients are injected, the audit learns `PROTECTED_WRITE_EXECUTORS`: declaring or calling the executor is a `protected-write` site, detected before the no-client early return, which is what exercises the module's registry entry. `memberFitsRoleKey` is the one Tipo-fits-role predicate the executor and the resolver (Task 12) share.

**Files:**
- Modify: `app/utils/fairnessMonthWriteRequest.ts` (imports; append the executor)
- Modify: `app/components/admin/plannerModel.ts` (after `memberFitsPool`, `:879-884`)
- Modify: `app/utils/protectedReadAudit.ts` (after `PROTECTED_LOADER_RE` `:103`; `scanSource` `:782-787`; `PROTECTED_RUNTIME_WRITERS` before the `serviceMutationSideEffects` entry)
- Create (test fixture, not a test): `app/utils/__tests__/__fixtures__/fakeFairnessSanity.ts`
- Test: `app/utils/__tests__/fairnessMonthExecutor.test.ts`, `app/components/admin/__tests__/memberFitsRoleKey.test.ts`; modify `app/utils/__tests__/protectedReadAudit.test.ts` (import; GU-5 fixtures (a)–(e) before the guard describe; the writers pin `:387-407`; the real-scan assertion)

**Interfaces:**
- Consumes: Tasks 3, 5, 6 (`fairnessMembersByIdsQuery`, `fairnessMonthsByIdsQuery`, `serviceCountsInMonths`, `validateFairnessMonthWrite`, `contentHashOfWrite`, `isIntact`, `buildFairnessMonthDocument`, `decideFairnessMonth`); `sanityConflictKind` (`roleWriteRequest.ts`); `normalizeMinistries`; `displayMemberName`.
- Produces: `memberFitsRoleKey(member: { memberType?: string[] } | undefined, key: RoleKey): boolean` (`plannerModel.ts`); `RECONSTRUCTION_RECORDED_BY = "script:reconstruct-fairness-months"`; `interface FairnessStamps { recordedBy; now; currentMonth; environment; engine? }`; `type FairnessDeleteEntry = { month; expectedRev: string }`; `type FairnessVerdict`; `interface FairnessExecution { month; verdict; rev: string | null; contentHash: string | null; ownVerdict; recordedAt: string | null; memberIds?; current?: { rev; source; recordedAt }; cause?: "commit_conflict" }`; `executeFairnessMonthWrites(input: { clients: { read: SanityClient; write: SanityClient }; actor; op; months; stamps }): Promise<FairnessExecution[]>`; `PROTECTED_WRITE_EXECUTORS` (`protectedReadAudit.ts`). From the test fixture: `createFakeFairnessSanity(initial?, config?)` → `{ read, write, clients, docs, commits, reads, failNext, hooks, put }`, `contentLakeConflict(type?)`, `FakeDoc`.

- [ ] **Step 1: Write the failing tests and the in-memory Content Lake**

**Create** `app/utils/__tests__/__fixtures__/fakeFairnessSanity.ts`:

````ts
// Test-only in-memory Content Lake for the fairness write executor — NOT a test file.
//
// The READ client evaluates the executor's real GROQ (the `serviceReadQueries` builders)
// with groq-js over the stored documents, so a builder that silently missed a draft
// filter or a counted special would fail an executor test, not only its own. The WRITE
// client implements exactly what the executor uses — `transaction()` with `create`,
// `patch(id, p => p.ifRevisionId().set().unset())` and `delete`, committed atomically —
// and answers a lost race with the Content Lake's own 409 shape (`sanityConflictKind`'s
// `documentAlreadyExistsError` / `documentRevisionIDDoesNotMatchError`). Every commit's
// operations are logged, so a test asserts the mutations a decision produced.

import type { SanityClient } from "@sanity/client";
import { evaluate, parse } from "groq-js";

export type FakeDoc = Record<string, unknown> & { _id: string; _type: string };

export type FakeOp =
  | { op: "create"; id: string; doc: FakeDoc }
  | { op: "patch"; id: string; ifRevisionId?: string; set?: Record<string, unknown>; unset?: string[] }
  | { op: "delete"; id: string };

/** The patch builder a transaction hands its callback — `@sanity/client`'s `Patch`, as used. */
export interface FakePatchBuilder {
  ifRevisionId(rev: string): FakePatchBuilder;
  set(fields: Record<string, unknown>): FakePatchBuilder;
  unset(keys: string[]): FakePatchBuilder;
}

export function contentLakeConflict(type?: "documentAlreadyExistsError" | "documentRevisionIDDoesNotMatchError") {
  return Object.assign(new Error("Sanity 409 conflict with internal detail"), {
    statusCode: 409,
    details: { type: "mutationError", description: "x", items: type ? [{ error: { type } }] : [] },
  });
}

export function createFakeFairnessSanity(
  initial: FakeDoc[] = [],
  config: { token?: string; perspective?: unknown; useCdn?: boolean } = {
    token: "test-read-token",
    perspective: "published",
    useCdn: false,
  },
) {
  const docs = new Map<string, FakeDoc>();
  for (const d of initial) docs.set(d._id, { _rev: "rev-0", _createdAt: "2026-01-01T00:00:00Z", ...structuredClone(d) });
  const commits: FakeOp[][] = [];
  const reads: Array<{ query: string; params: Record<string, unknown> }> = [];
  const failNext: { commit: unknown; fetch: unknown } = { commit: null, fetch: null };
  const hooks: { beforeCommit: (() => void) | null } = { beforeCommit: null };
  let txCount = 0;

  const read = {
    config: () => ({ ...config }),
    async fetch(query: string, params: Record<string, unknown> = {}): Promise<unknown> {
      reads.push({ query, params });
      if (failNext.fetch) {
        const err = failNext.fetch;
        failNext.fetch = null;
        throw err;
      }
      const dataset = [...docs.values()].map((d) => structuredClone(d));
      return (await evaluate(parse(query, { params }), { dataset, params })).get();
    },
  };

  const write = {
    transaction() {
      const ops: FakeOp[] = [];
      const tx = {
        create(doc: { _id: string; _type: string }) {
          ops.push({ op: "create", id: doc._id, doc: structuredClone(doc) as FakeDoc });
          return tx;
        },
        patch(id: string, build: (p: FakePatchBuilder) => FakePatchBuilder) {
          const call: Extract<FakeOp, { op: "patch" }> = { op: "patch", id };
          const patch: FakePatchBuilder = {
            ifRevisionId(rev: string) {
              call.ifRevisionId = rev;
              return patch;
            },
            set(fields: Record<string, unknown>) {
              call.set = { ...(call.set ?? {}), ...structuredClone(fields) };
              return patch;
            },
            unset(keys: string[]) {
              call.unset = [...(call.unset ?? []), ...keys];
              return patch;
            },
          };
          build(patch);
          ops.push(call);
          return tx;
        },
        delete(id: string) {
          ops.push({ op: "delete", id });
          return tx;
        },
        async commit() {
          const hook = hooks.beforeCommit;
          hooks.beforeCommit = null;
          hook?.();
          if (failNext.commit) {
            const err = failNext.commit;
            failNext.commit = null;
            throw err;
          }
          const next = new Map(docs);
          const rev = `tx-${++txCount}`;
          const now = "2026-10-20T18:00:01Z";
          for (const o of ops) {
            if (o.op === "create") {
              if (next.has(o.id)) throw contentLakeConflict("documentAlreadyExistsError");
              next.set(o.id, { ...o.doc, _rev: rev, _createdAt: now, _updatedAt: now });
            } else if (o.op === "patch") {
              const current = next.get(o.id);
              if (!current) throw contentLakeConflict();
              if (o.ifRevisionId !== undefined && current._rev !== o.ifRevisionId) {
                throw contentLakeConflict("documentRevisionIDDoesNotMatchError");
              }
              const updated: FakeDoc = { ...current, ...(o.set ?? {}), _rev: rev, _updatedAt: now };
              for (const key of o.unset ?? []) delete updated[key];
              next.set(o.id, updated);
            } else {
              if (!next.has(o.id)) throw contentLakeConflict();
              next.delete(o.id);
            }
          }
          docs.clear();
          for (const [k, v] of next) docs.set(k, v);
          commits.push(ops);
          return { transactionId: rev, documentIds: ops.map((o) => o.id), results: ops.map((o) => ({ id: o.id, operation: o.op })) };
        },
      };
      return tx;
    },
  };

  /** Store a document directly (a concurrent writer, or a hand edit), bumping its revision. */
  const put = (doc: FakeDoc) => docs.set(doc._id, { _createdAt: "2026-01-01T00:00:00Z", ...structuredClone(doc), _rev: `rev-ext-${++txCount}` });

  /** The two clients, typed as the executor takes them (IF2-22: `SanityClient`). */
  const clients = { read: read as unknown as SanityClient, write: write as unknown as SanityClient };

  return { read, write, clients, docs, commits, reads, failNext, hooks, put };
}
````

**Create** `app/utils/__tests__/fairnessMonthExecutor.test.ts`:

````ts
// Solver v3 C2 IF2-22 / WR-16 — the ONE write executor of `fairnessMonth`, against an
// in-memory Content Lake whose reads run the real GROQ builders. Each test asserts the
// MUTATION LOG a decision produced, because "the right refusal with a stray write behind
// it" is exactly the failure the executor exists to rule out. Every name is fictitious.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { stripComments } from "../../../scripts/lib/strip-comments.mjs";
import {
  RECONSTRUCTION_RECORDED_BY,
  buildFairnessMonthDocument,
  contentHashOfWrite,
  executeFairnessMonthWrites,
  fairnessMonthId,
  isIntact,
  type FairnessStamps,
} from "../fairnessMonthWriteRequest";
import type { FairnessMonthWrite, RoleKey, Status } from "../fairnessVocabulary";
import { contentLakeConflict, createFakeFairnessSanity, type FakeDoc } from "./__fixtures__/fakeFairnessSanity";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const OUT: Record<RoleKey, Status> = {
  "Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "out", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out",
};
const roles = (patch: Partial<Record<RoleKey, Status>>) => ({ ...OUT, ...patch });

const MEMBERS: FakeDoc[] = [
  { _id: "m-alma", _type: "teamMembers", member_name: "Alma Ruiz", alias: "Alma", memberType: ["voz", "sunday_lead"] },
  { _id: "m-bruno", _type: "teamMembers", member_name: "Bruno Díaz", memberType: ["voz", "support"], ministries: ["worship"] },
  { _id: "m-kids", _type: "teamMembers", member_name: "Diego Paz", memberType: ["voz", "support"], ministries: ["kids"] },
  { _id: "m-noname", _type: "teamMembers", member_name: "", memberType: ["voz", "support"] },
];

function entry(month: string, patch: Partial<FairnessMonthWrite> = {}): FairnessMonthWrite {
  return {
    month,
    source: "manual",
    expectedRev: null,
    people: [
      { memberId: "m-alma", roles: roles({ "Sun.Lead": "in", "Sun.BGV": "in" }), exactRules: [], exempt: false, blocks: [] },
      { memberId: "m-bruno", roles: roles({ "Sun.BGV": "in", "Sat.Choir": "in" }), exactRules: [], exempt: false, blocks: [] },
    ],
    presence: [],
    ...patch,
  };
}

const ROUTE_STAMPS: FairnessStamps = {
  recordedBy: "m-admin",
  now: "2026-10-20T18:00:00.000Z",
  currentMonth: "2026-10",
  environment: "preview",
  engine: "v3",
};
const RECON_STAMPS: FairnessStamps = {
  recordedBy: RECONSTRUCTION_RECORDED_BY,
  now: "2026-10-20T18:00:00.000Z",
  currentMonth: "2026-10",
  environment: "local",
};

/** A stored record as the executor itself would have written it. */
function storedRecord(body: FairnessMonthWrite, source: "auto" | "manual" | "reconstructed" = "manual"): FakeDoc {
  return buildFairnessMonthDocument({
    body,
    source,
    engine: source === "reconstructed" ? "v2" : "v3",
    environment: "production",
    recordedAt: "2026-09-30T12:00:00.000Z",
    recordedBy: source === "reconstructed" ? RECONSTRUCTION_RECORDED_BY : "m-admin",
    names: new Map([["m-alma", "Alma"], ["m-bruno", "Bruno Díaz"]]),
  }) as unknown as FakeDoc;
}

function route(lake: ReturnType<typeof createFakeFairnessSanity>, months: FairnessMonthWrite[], stamps = ROUTE_STAMPS) {
  return executeFairnessMonthWrites({ clients: lake.clients, actor: "route", op: "write", months, stamps });
}

describe("the read-client contract, asserted before any read (WR-16, A2)", () => {
  it.each([
    ["no token", { perspective: "published", useCdn: false }],
    ["an empty token", { token: "", perspective: "published", useCdn: false }],
    ["no perspective set at creation", { token: "t", useCdn: false }],
    ["the raw perspective", { token: "t", perspective: "raw", useCdn: false }],
    ["the CDN", { token: "t", perspective: "published", useCdn: true }],
  ])("throws with %s, having issued no read", async (_label, config) => {
    const lake = createFakeFairnessSanity(MEMBERS, config);
    await expect(route(lake, [entry("2026-11")])).rejects.toThrow(/read token/);
    expect(lake.reads).toEqual([]);
    expect(lake.commits).toEqual([]);
  });

  it("throws on programming errors before any read", async () => {
    const lake = createFakeFairnessSanity(MEMBERS);
    const clients = lake.clients;
    await expect(route(lake, [entry("2026-11")], { ...ROUTE_STAMPS, engine: undefined })).rejects.toThrow(/v3/);
    await expect(route(lake, [entry("2026-11")], { ...ROUTE_STAMPS, engine: "v2" })).rejects.toThrow(/v3/);
    await expect(
      executeFairnessMonthWrites({ clients, actor: "route", op: "delete", months: [{ month: "2026-11", expectedRev: "r" }], stamps: ROUTE_STAMPS }),
    ).rejects.toThrow(/only the reconstruction actor deletes/);
    await expect(
      executeFairnessMonthWrites({ clients, actor: "reconstruction", op: "write", months: [], stamps: { ...RECON_STAMPS, engine: "v3" } }),
    ).rejects.toThrow(/engine v2/);
    await expect(
      executeFairnessMonthWrites({ clients, actor: "reconstruction", op: "write", months: [], stamps: { ...RECON_STAMPS, recordedBy: "m-alma" } }),
    ).rejects.toThrow(/script marker/);
    expect(lake.reads).toEqual([]);
  });
});

describe("actor route — create, replace, unchanged (WR-7 … WR-12)", () => {
  it("creates a record with server stamps, names from the member read and the body's hash", async () => {
    const lake = createFakeFairnessSanity(MEMBERS);
    const [result] = await route(lake, [entry("2026-11")]);
    expect(result).toMatchObject({ month: "2026-11", verdict: "created", rev: "tx-1", ownVerdict: "create", recordedAt: ROUTE_STAMPS.now });
    expect(result.contentHash).toBe(contentHashOfWrite("2026-11", entry("2026-11")));
    expect(lake.commits).toHaveLength(1);
    expect(lake.commits[0].map((o) => [o.op, o.id])).toEqual([["create", "fairnessMonth.2026-11"]]);
    const doc = lake.docs.get(fairnessMonthId("2026-11"))!;
    expect(doc).toMatchObject({
      schemaVersion: 1, month: "2026-11", source: "manual", engine: "v3", environment: "preview",
      recordedAt: ROUTE_STAMPS.now, recordedBy: "m-admin",
    });
    expect((doc.people as Array<{ name: string }>).map((p) => p.name)).toEqual(["Alma", "Bruno Díaz"]);
    expect(isIntact(doc)).toBe(true);
  });

  it("creates an unrecorded month that already has stored services (A27)", async () => {
    const lake = createFakeFairnessSanity([...MEMBERS, { _id: "sun-1", _type: "sunday_role", week: "2026-11-01" }]);
    const [result] = await route(lake, [entry("2026-11")]);
    expect(result.verdict).toBe("created");
  });

  it("replaces a recorded month with no freezing services as one revision-asserted patch, unsetting stale fields", async () => {
    const old = { ...storedRecord(entry("2026-11")), legacyNote: "hand-added" } as FakeDoc;
    const lake = createFakeFairnessSanity([...MEMBERS, old]);
    const next = entry("2026-11", { expectedRev: "rev-0", source: "auto" });
    next.people[1].roles["Sun.Choir"] = "in";
    const [result] = await route(lake, [next]);
    expect(result).toMatchObject({ verdict: "replaced", ownVerdict: "replace", rev: "tx-1" });
    const ops = lake.commits[0];
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ op: "patch", id: "fairnessMonth.2026-11", ifRevisionId: "rev-0", unset: ["legacyNote"] });
    expect(Object.keys((ops[0] as { set: object }).set).sort()).toEqual(
      ["contentHash", "engine", "environment", "month", "people", "presence", "recordedAt", "recordedBy", "schemaVersion", "source"].sort(),
    );
    const doc = lake.docs.get("fairnessMonth.2026-11")!;
    expect(doc).not.toHaveProperty("legacyNote");
    expect(doc).toMatchObject({ source: "auto", recordedAt: ROUTE_STAMPS.now, _createdAt: "2026-01-01T00:00:00Z" });
    expect(isIntact(doc)).toBe(true);
  });

  it("replaces when the month's only service is an UNCOUNTED special, refuses with a counted one (A5)", async () => {
    const old = storedRecord(entry("2026-11"));
    const next = entry("2026-11", { expectedRev: "rev-0" });
    next.people[0].exempt = true;
    const uncounted = createFakeFairnessSanity([...MEMBERS, old, { _id: "s-1", _type: "special_role", date: "2026-11-03" }]);
    expect((await route(uncounted, [next]))[0].verdict).toBe("replaced");
    const counted = createFakeFairnessSanity([
      ...MEMBERS,
      old,
      { _id: "s-1", _type: "special_role", date: "2026-11-03", countsForFairness: true },
    ]);
    const [refused] = await route(counted, [next]);
    expect(refused.verdict).toEqual({ refused: "month_has_services" });
    expect(counted.commits).toEqual([]);
  });

  it("answers an identical replay unchanged with no transaction — before the past-month check", async () => {
    const lake = createFakeFairnessSanity([...MEMBERS, storedRecord(entry("2026-09"))]);
    const [result] = await route(lake, [entry("2026-09", { expectedRev: "rev-old" })]);
    expect(result).toMatchObject({ verdict: "unchanged", rev: "rev-0", recordedAt: "2026-09-30T12:00:00.000Z" });
    expect(lake.commits).toEqual([]);
  });

  it("never refuses an unchanged month over a since-deleted member (WR-5 runs on written months only)", async () => {
    const lake = createFakeFairnessSanity([MEMBERS[0], storedRecord(entry("2026-11"))]);
    const [result] = await route(lake, [entry("2026-11", { expectedRev: "rev-0" })]);
    expect(result.verdict).toBe("unchanged");
  });

  it("refuses record_exists with the current record's rev, source and recordedAt", async () => {
    const lake = createFakeFairnessSanity([...MEMBERS, storedRecord(entry("2026-11"))]);
    const changed = entry("2026-11");
    changed.people[0].exempt = true;
    const [result] = await route(lake, [changed]);
    expect(result).toMatchObject({
      verdict: { refused: "record_exists" },
      current: { rev: "rev-0", source: "manual", recordedAt: "2026-09-30T12:00:00.000Z" },
    });
  });
});

describe("actor route — the live-member checks (WR-5)", () => {
  it.each([
    ["member_unknown: no member document", "m-ghost", "member_unknown"],
    ["member_unknown: a member document that yields no display name", "m-noname", "member_unknown"],
    ["member_not_worship: a kids-only member", "m-kids", "member_not_worship"],
  ])("%s", async (_label, memberId, refusal) => {
    const lake = createFakeFairnessSanity(MEMBERS);
    const body = entry("2026-11");
    body.people[1] = { ...body.people[1], memberId };
    const [result] = await route(lake, [body]);
    expect(result).toMatchObject({ verdict: { refused: refusal }, ownVerdict: refusal, memberIds: [memberId] });
    expect(lake.commits).toEqual([]);
  });

  it("tipo_mismatch: a role marked in that the member's current Tipo does not fit", async () => {
    const lake = createFakeFairnessSanity(MEMBERS);
    const body = entry("2026-11");
    body.people[1].roles["Sun.Lead"] = "in"; // Bruno is voz + support
    const [result] = await route(lake, [body]);
    expect(result).toMatchObject({ verdict: { refused: "tipo_mismatch" }, memberIds: ["m-bruno"] });
  });
});

describe("actor route — all or nothing (WR-9)", () => {
  it("writes nothing when one month is refused, and reports each month's own verdict", async () => {
    const lake = createFakeFairnessSanity([...MEMBERS, storedRecord(entry("2026-12"))]);
    const dec = entry("2026-12");
    dec.people[0].exempt = true;
    const results = await route(lake, [entry("2026-11"), dec]);
    expect(results.map((r) => [r.month, r.ownVerdict, r.verdict])).toEqual([
      ["2026-11", "create", { refused: "record_exists" }],
      ["2026-12", "record_exists", { refused: "record_exists" }],
    ]);
    expect(lake.commits).toEqual([]);
  });

  it("commits two writes in ONE transaction", async () => {
    const lake = createFakeFairnessSanity(MEMBERS);
    const results = await route(lake, [entry("2026-11"), entry("2026-12")]);
    expect(results.map((r) => r.verdict)).toEqual(["created", "created"]);
    expect(lake.commits).toHaveLength(1);
    expect(lake.commits[0].map((o) => o.id)).toEqual(["fairnessMonth.2026-11", "fairnessMonth.2026-12"]);
  });

  it.each([
    ["documentAlreadyExistsError", "record_exists", undefined],
    ["documentRevisionIDDoesNotMatchError", "stale_revision", undefined],
    [undefined, "stale_revision", "commit_conflict"],
  ] as const)("maps a commit 409 (%s) onto every written month, unchanged months stay unchanged", async (type, refusal, cause) => {
    const lake = createFakeFairnessSanity([...MEMBERS, storedRecord(entry("2026-11"))]);
    lake.failNext.commit = contentLakeConflict(type);
    const results = await route(lake, [entry("2026-11", { expectedRev: "rev-0" }), entry("2026-12")]);
    expect(results[0]).toMatchObject({ verdict: "unchanged", ownVerdict: "unchanged" });
    expect(results[1]).toMatchObject({ verdict: { refused: refusal }, ownVerdict: refusal, ...(cause ? { cause } : {}) });
  });

  it("loses a real race to a concurrent create as record_exists, discarding nothing (L3)", async () => {
    const lake = createFakeFairnessSanity(MEMBERS);
    const theirs = storedRecord(entry("2026-11"));
    lake.hooks.beforeCommit = () => lake.put(theirs);
    const [result] = await route(lake, [entry("2026-11")]);
    expect(result.verdict).toEqual({ refused: "record_exists" });
    expect(lake.docs.get("fairnessMonth.2026-11")?.contentHash).toBe(theirs.contentHash);
  });

  it("throws an error that is not a 409 mutation conflict", async () => {
    const lake = createFakeFairnessSanity(MEMBERS);
    lake.failNext.commit = Object.assign(new Error("Unauthorized"), { statusCode: 401 });
    await expect(route(lake, [entry("2026-11")])).rejects.toThrow("Unauthorized");
  });

  it("refuses an invalid entry as invalid_body with index-based issues, reading nothing", async () => {
    const lake = createFakeFairnessSanity(MEMBERS);
    const bad = { ...entry("2026-12"), name: "x" } as unknown as FairnessMonthWrite;
    const results = await route(lake, [entry("2026-11"), bad]);
    expect(results[1].verdict).toEqual({ refused: "invalid_body", issues: [{ path: "name", message: "unknown field" }] });
    expect(results[0].verdict).toEqual({ refused: "invalid_body", issues: [] });
    expect(lake.reads).toEqual([]);
  });
});

const recon = (lake: ReturnType<typeof createFakeFairnessSanity>, op: "write" | "delete", months: unknown[]) =>
  executeFairnessMonthWrites({
    clients: lake.clients,
    actor: "reconstruction",
    op,
    months: months as FairnessMonthWrite[],
    stamps: RECON_STAMPS,
  });
const reconBody = (month: string, patch: Partial<FairnessMonthWrite> = {}) => {
  const { source: _source, ...body } = entry(month, patch);
  void _source;
  return body;
};

describe("actor reconstruction (WR-14)", () => {
  it("creates a past month stamped reconstructed, v2 and the script marker, without reading services", async () => {
    const lake = createFakeFairnessSanity(MEMBERS);
    const [result] = await recon(lake, "write", [reconBody("2026-08")]);
    expect(result.verdict).toBe("created");
    expect(lake.docs.get("fairnessMonth.2026-08")).toMatchObject({
      source: "reconstructed", engine: "v2", environment: "local", recordedBy: RECONSTRUCTION_RECORDED_BY,
    });
    expect(lake.reads.some((r) => r.query.includes("countedSpecials"))).toBe(false);
  });

  it("refuses the current month as not_past_month", async () => {
    const lake = createFakeFairnessSanity(MEMBERS);
    expect((await recon(lake, "write", [reconBody("2026-10")]))[0].verdict).toEqual({ refused: "not_past_month" });
  });

  it("refuses a body carrying source as invalid_body, and handles each month on its own", async () => {
    const lake = createFakeFairnessSanity(MEMBERS);
    const results = await recon(lake, "write", [entry("2026-07"), reconBody("2026-08")]);
    expect(results[0].verdict).toMatchObject({ refused: "invalid_body" });
    expect(results[1].verdict).toBe("created");
  });

  it("replaces only an intact record it wrote, under its revision", async () => {
    const mine = storedRecord(entry("2026-08"), "reconstructed");
    const lake = createFakeFairnessSanity([...MEMBERS, mine]);
    const next = reconBody("2026-08", { expectedRev: "rev-0" });
    next.people[0].exempt = true;
    expect((await recon(lake, "write", [next]))[0].verdict).toBe("replaced");
    expect(lake.commits[0][0]).toMatchObject({ op: "patch", ifRevisionId: "rev-0" });
  });

  it("refuses a record the route wrote, and one edited after reconstruction", async () => {
    const theirs = storedRecord(entry("2026-08"), "manual");
    const edited = { ...storedRecord(entry("2026-07"), "reconstructed") } as FakeDoc;
    (edited.people as Array<{ exempt: boolean }>)[0].exempt = true;
    const lake = createFakeFairnessSanity([...MEMBERS, theirs, edited]);
    const b8 = reconBody("2026-08", { expectedRev: "rev-0" });
    b8.people[0].exempt = true;
    const results = await recon(lake, "write", [reconBody("2026-07", { expectedRev: "rev-0" }), b8]);
    expect(results.map((r) => r.verdict)).toEqual([{ refused: "record_edited" }, { refused: "not_reconstruction_owned" }]);
    expect(lake.commits).toEqual([]);
  });

  it("refuses member_unknown for a member with no document — its only live-member check", async () => {
    const lake = createFakeFairnessSanity(MEMBERS);
    const body = reconBody("2026-08");
    body.people[1] = { ...body.people[1], memberId: "m-ghost" };
    const kidsOk = reconBody("2026-07");
    kidsOk.people[1] = { ...kidsOk.people[1], memberId: "m-kids", roles: roles({ "Sun.Lead": "in" }) };
    const results = await recon(lake, "write", [kidsOk, body]);
    expect(results[0].verdict).toBe("created");
    expect(results[1]).toMatchObject({ verdict: { refused: "member_unknown" }, memberIds: ["m-ghost"] });
  });

  it("deletes as ONE transaction: a revision-asserting no-op patch, then the delete", async () => {
    const lake = createFakeFairnessSanity([...MEMBERS, storedRecord(entry("2026-08"), "reconstructed")]);
    const [result] = await recon(lake, "delete", [{ month: "2026-08", expectedRev: "rev-0" }]);
    expect(result.verdict).toBe("deleted");
    expect(lake.commits).toEqual([
      [
        { op: "patch", id: "fairnessMonth.2026-08", ifRevisionId: "rev-0", set: { month: "2026-08" } },
        { op: "delete", id: "fairnessMonth.2026-08" },
      ],
    ]);
    expect(lake.docs.has("fairnessMonth.2026-08")).toBe(false);
  });

  it("rolls a delete back when the revision moved", async () => {
    const lake = createFakeFairnessSanity([...MEMBERS, storedRecord(entry("2026-08"), "reconstructed")]);
    lake.failNext.commit = contentLakeConflict("documentRevisionIDDoesNotMatchError");
    const [result] = await recon(lake, "delete", [{ month: "2026-08", expectedRev: "rev-0" }]);
    expect(result.verdict).toEqual({ refused: "stale_revision" });
    expect(lake.docs.has("fairnessMonth.2026-08")).toBe(true);
  });

  it.each([
    ["D1: no record", [], "record_missing"],
    ["D2: a route-written record", [storedRecord(entry("2026-08"), "auto")], "not_reconstruction_owned"],
  ] as const)("refuses a delete — %s", async (_label, extra, refusal) => {
    const lake = createFakeFairnessSanity([...MEMBERS, ...extra]);
    const [result] = await recon(lake, "delete", [{ month: "2026-08", expectedRev: "rev-0" }]);
    expect(result.verdict).toEqual({ refused: refusal });
    expect(lake.commits).toEqual([]);
  });
});

describe("the module's own boundaries (WR-11, WR-13, WR-16)", () => {
  const SOURCE = stripComments(readFileSync(path.join(HERE, "../fairnessMonthWriteRequest.ts"), "utf8"));

  it("never calls createOrReplace", () => {
    expect(SOURCE).not.toMatch(/createOrReplace/);
  });

  it("has no side effect: imports nothing that notifies, queues or revalidates, and calls no after()", () => {
    const specifiers = [...SOURCE.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]).sort();
    expect(specifiers).toEqual(
      [
        "node:crypto",
        "./fairnessVocabulary",
        "./serviceReadModel",
        "@/app/ministries",
        "@/app/components/admin/plannerModel",
        "./memberRuleNames",
        "./roleWriteRequest",
        "./serviceReadQueries",
        "@sanity/client",
      ].sort(),
    );
    expect(SOURCE).not.toMatch(/\brevalidate\w*\(|\bafter\(/);
  });

  it("holds no module-level client: Sanity enters as a TYPE only, and no server-only", () => {
    expect(SOURCE).not.toMatch(/from\s+["'](@\/)?sanity\/lib\//);
    expect(SOURCE).not.toMatch(/next-sanity|server-only|use client|createClient/);
    expect(SOURCE).toMatch(/import type \{ SanityClient, Transaction \} from "@sanity\/client";/);
  });
});
````

**Create** `app/components/admin/__tests__/memberFitsRoleKey.test.ts`:

````ts
// Solver v3 C2 WR-5 / RES-1 — `memberFitsRoleKey`, the one "does the current Tipo fit
// this v3 role key" predicate the record writer and the eligibility resolver share.
import { describe, expect, it } from "vitest";

import { ROLE_KEYS } from "@/app/utils/fairnessVocabulary";
import { memberFitsRoleKey } from "../plannerModel";

const fits = (memberType: string[] | undefined) => ROLE_KEYS.filter((k) => memberFitsRoleKey({ memberType }, k));

describe("memberFitsRoleKey (C2 WR-5)", () => {
  it("a Sunday lead fits every role key", () => {
    expect(fits(["voz", "sunday_lead"])).toEqual([...ROLE_KEYS]);
  });

  it("a Saturday lead fits Sat.Lead and every BGV and Choir key, never Sun.Lead", () => {
    expect(fits(["voz", "saturday_lead"])).toEqual(["Sat.Lead", "Sun.BGV", "Sat.BGV", "Sun.Choir", "Sat.Choir"]);
  });

  it("support fits BGV and Choir only", () => {
    expect(fits(["voz", "support"])).toEqual(["Sun.BGV", "Sat.BGV", "Sun.Choir", "Sat.Choir"]);
  });

  it("nothing fits without voz, or with no Tipo at all (ADR-0029)", () => {
    expect(fits(["sunday_lead", "support"])).toEqual([]);
    expect(fits(["voz"])).toEqual([]);
    expect(fits([])).toEqual([]);
    expect(fits(undefined)).toEqual([]);
    expect(ROLE_KEYS.some((k) => memberFitsRoleKey(undefined, k))).toBe(false);
  });
});
````

**Find** in `app/utils/__tests__/protectedReadAudit.test.ts`:

````ts
  PROTECTED_RUNTIME_WRITERS,
  PROTECTED_TYPES,
  RETIRED_ONE_SHOT_WRITERS,
  auditViolations,
````

**Replace with:**

````ts
  PROTECTED_RUNTIME_WRITERS,
  PROTECTED_TYPES,
  PROTECTED_WRITE_EXECUTORS,
  RETIRED_ONE_SHOT_WRITERS,
  auditViolations,
````

**Find** in `app/utils/__tests__/protectedReadAudit.test.ts`:

````ts
});

// ── Defensive type-rejection guard ──────────────────────────────────────────

````

**Replace with:**

````ts
});

// ── The executor rule (solver v3 C2 GU-5) ───────────────────────────────────

describe("the protected write executor rule (C2 GU-5)", () => {
  it("registers exactly the fairness write executor", () => {
    expect([...PROTECTED_WRITE_EXECUTORS]).toEqual(["executeFairnessMonthWrites"]);
  });

  it("(a) flags a module that calls the executor with NO Sanity client import", () => {
    const sites = scanSource(
      "app/utils/exampleCaller.ts",
      `import { executeFairnessMonthWrites } from "@/app/utils/fairnessMonthWriteRequest";
export async function record(clients, months, stamps) {
  return executeFairnessMonthWrites({ clients, actor: "route", op: "write", months, stamps });
}`,
    );
    expect(sites).toEqual([
      {
        file: "app/utils/exampleCaller.ts",
        operation: "module",
        kind: "protected-write",
        client: "executor",
        compliant: false,
        evidence: "calls the protected write executor executeFairnessMonthWrites()",
      },
    ]);
    expect(auditViolations(sites)).toHaveLength(1);
  });

  it("(b) attributes a call inside a wrapped route handler to its HTTP method", () => {
    const sites = scanSource(
      "app/api/example/route.ts",
      `import { executeFairnessMonthWrites } from "@/app/utils/fairnessMonthWriteRequest";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";
export const PUT = withVerificationRunContext(async (req) => {
  return executeFairnessMonthWrites(await req.json());
});`,
    );
    expect(sites.map((s) => [s.operation, s.kind])).toEqual([["PUT", "protected-write"]]);
  });

  it("(c) flags the declaring module", () => {
    const sites = scanSource(
      "app/utils/exampleExecutor.ts",
      `export async function executeFairnessMonthWrites(input) {
  const tx = input.clients.write.transaction();
  return tx.commit();
}`,
    );
    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({ operation: "module", kind: "protected-write" });
    expect(sites[0].evidence).toBe("declares the protected write executor executeFairnessMonthWrites()");
  });

  it("(d) ignores a similarly named function and the name in a comment or an import alone", () => {
    expect(
      scanSource(
        "app/utils/example.ts",
        `// executeFairnessMonthWrites(input) is the one writer — mentioned only.
/* executeFairnessMonthWrites({}) */
import { executeFairnessMonthWrites } from "@/app/utils/fairnessMonthWriteRequest";
export function executeFairnessMonthWritesLater() { return myexecuteFairnessMonthWrites(1); }`,
      ),
    ).toEqual([]);
  });

  it("(e) still yields nothing for files that merely mention protected type names", () => {
    expect(
      scanSource("app/components/Example.tsx", `const LABELS = { fairnessMonth: "Registro", sunday_role: "Domingo" };`),
    ).toEqual([]);
  });

  it("keeps a client-bearing caller's other sites beside the executor site", () => {
    const sites = scanSource(
      "app/utils/exampleCommit.ts",
      `import { operationalClient } from "@/sanity/lib/operationalClient";
import { writeClient } from "@/sanity/lib/serverClient";
import { executeFairnessMonthWrites } from "@/app/utils/fairnessMonthWriteRequest";
export async function commit(months) {
  return executeFairnessMonthWrites({ clients: { read: operationalClient, write: writeClient }, months });
}`,
    );
    expect(sites.map((s) => [s.operation, s.kind, s.client])).toEqual([["module", "protected-write", "executor"]]);
  });
});

// ── Defensive type-rejection guard ──────────────────────────────────────────

````

**Find** in `app/utils/__tests__/protectedReadAudit.test.ts`:

````ts
  });

  it("licenses the sixteen permanent runtime writers for WRITES ONLY, never reads", () => {
    expect(PROTECTED_RUNTIME_WRITERS.map((e) => `${e.file}#${e.operation}`).sort()).toEqual(
      [
````

**Replace with:**

````ts
  });

  it("licenses the seventeen permanent runtime writers for WRITES ONLY, never reads", () => {
    expect(PROTECTED_RUNTIME_WRITERS.map((e) => `${e.file}#${e.operation}`).sort()).toEqual(
      [
````

**Find** in `app/utils/__tests__/protectedReadAudit.test.ts`:

````ts
        "app/utils/roleWriteOps.ts#module",
        "app/utils/setlistSaveCommit.ts#module",
        "app/api/me/proposals/route.ts#POST",
        "app/api/me/proposals/[id]/messages/route.ts#POST",
````

**Replace with:**

````ts
        "app/utils/roleWriteOps.ts#module",
        "app/utils/setlistSaveCommit.ts#module",
        "app/utils/fairnessMonthWriteRequest.ts#module",
        "app/api/me/proposals/route.ts#POST",
        "app/api/me/proposals/[id]/messages/route.ts#POST",
````

**Find** in `app/utils/__tests__/protectedReadAudit.test.ts`:

````ts
  });

  it("routes every migrated member-facing and notification read through the canonical client", () => {
    const migrated = [
````

**Replace with:**

````ts
  });

  it("finds exactly the registered fairness executor sites (C2 GU-5, IF2-23)", () => {
    const sites = REAL_SITES.filter((s) => s.client === "executor").map((s) => `${s.file}#${s.operation}`);
    expect(sites.sort()).toEqual(["app/utils/fairnessMonthWriteRequest.ts#module"]);
  });

  it("routes every migrated member-facing and notification read through the canonical client", () => {
    const migrated = [
````

- [ ] **Step 2: Run them to see them fail**

Run: `git add -A && npx vitest run app/utils/__tests__/fairnessMonthExecutor.test.ts app/components/admin/__tests__/memberFitsRoleKey.test.ts app/utils/__tests__/protectedReadAudit.test.ts`
Expected: FAIL — `executeFairnessMonthWrites`, `memberFitsRoleKey` and `PROTECTED_WRITE_EXECUTORS` are not exported.

- [ ] **Step 3: Implement**

**Find** in `app/components/admin/plannerModel.ts`:

````ts
): boolean {
  return memberFitsPoolSubtype(member, POOL_SUBTYPE[field]);
}

````

**Replace with:**

````ts
): boolean {
  return memberFitsPoolSubtype(member, POOL_SUBTYPE[field]);
}

/**
 * Does a member's CURRENT Tipo fit one of the six v3 role keys (solver v3 C2 WR-5, RES-1)?
 * `Sun.Lead`: `voz` + `sunday_lead`; `Sat.Lead`: `voz` + `sunday_lead` or `saturday_lead`;
 * every BGV and Choir key: `voz` + any of the three subtypes. Built on
 * `memberFitsPoolSubtype`, the ONE pool predicate — the eligibility resolver and the
 * record writer's `tipo_mismatch` check read this same function, so they cannot disagree.
 */
export function memberFitsRoleKey(member: { memberType?: string[] } | undefined, key: RoleKey): boolean {
  const fits = (subtype: PoolSubtype) => memberFitsPoolSubtype(member, subtype);
  if (key === "Sun.Lead") return fits("sunday_lead");
  if (key === "Sat.Lead") return fits("sunday_lead") || fits("saturday_lead");
  return fits("sunday_lead") || fits("saturday_lead") || fits("support");
}

````

**Find** in `app/utils/fairnessMonthWriteRequest.ts`:

````ts

import { createHash } from "node:crypto";

import {
````

**Replace with:**

````ts

import { createHash } from "node:crypto";
import type { SanityClient, Transaction } from "@sanity/client";

import {
````

**Find** in `app/utils/fairnessMonthWriteRequest.ts`:

````ts
} from "./fairnessVocabulary";
import { isValidServiceDate } from "./serviceReadModel";

export const FAIRNESS_MONTH_TYPE = "fairnessMonth";
````

**Replace with:**

````ts
} from "./fairnessVocabulary";
import { isValidServiceDate } from "./serviceReadModel";
import { normalizeMinistries } from "@/app/ministries";
import { memberFitsRoleKey } from "@/app/components/admin/plannerModel";
import { displayMemberName } from "./memberRuleNames";
import { sanityConflictKind } from "./roleWriteRequest";
import { fairnessMembersByIdsQuery, fairnessMonthsByIdsQuery, serviceCountsInMonths } from "./serviceReadQueries";

export const FAIRNESS_MONTH_TYPE = "fairnessMonth";
````

**Find** in `app/utils/fairnessMonthWriteRequest.ts`:

````ts
  return "replace"; //                                                                   row 8
}
````

**Replace with:**

````ts
  return "replace"; //                                                                   row 8
}

// ─── The write executor (IF2-22, WR-16) ──────────────────────────────────────
//
// THE ONLY mutation path of `fairnessMonth`, for both actors. The clients are INJECTED —
// `fairnessMonthCommit.ts` hands it `operationalClient`/`writeClient`, C4's script its
// own — so this module has no module-level client and the protected-read audit cannot
// see its reads or writes by import. Two things hold it instead: the audit's executor
// rule (`PROTECTED_WRITE_EXECUTORS` in `protectedReadAudit.ts`: every file that declares
// or calls this function is a registered `protected-write` site) and the caller pin
// (`serviceCommitCallers.test.ts`), plus the runtime read-client assertion below.
//
// No side effects (WR-13): no notification, no outbox, no `after()`, no `revalidate*`
// — no ISR page reads this type. `createOrReplace` is never used: it cannot assert a
// revision and would discard a concurrent writer's record (L3).

/** C4's `recordedBy` — a fixed non-member marker naming the script (WR-14). */
export const RECONSTRUCTION_RECORDED_BY = "script:reconstruct-fairness-months";

export interface FairnessStamps {
  /** The session's effective member `_id` (route) or {@link RECONSTRUCTION_RECORDED_BY}. */
  recordedBy: string;
  /** ISO-8601, the server's clock. */
  now: string;
  /** CDMX `YYYY-MM`. */
  currentMonth: string;
  environment: LogicalRecord["environment"];
  /** Route: REQUIRED and `"v3"` (WR-6 already gated it). Reconstruction: absent or `"v2"`. */
  engine?: "v2" | "v3";
}

export type FairnessDeleteEntry = { month: string; expectedRev: string };

export type FairnessVerdict =
  | "created"
  | "replaced"
  | "unchanged"
  | "deleted"
  | { refused: FairnessWriteRefusal; issues?: FairnessIssue[] };

/**
 * One month's result: IF2-22's `{ month, verdict, rev, contentHash }`, plus four fields
 * this plan adds for the PUT's IF2-5 bodies (additive; C4 may ignore them):
 * `ownVerdict` (this month's own decision or refusal — IF2-5 `details.months[].verdict`;
 * `null` for a well-formed entry of a route request refused for another entry's body),
 * `recordedAt` (IF2-5's 200), `memberIds` (with a member refusal) and `current` (the
 * re-read record's summary, for `record_exists` details).
 */
export interface FairnessExecution {
  month: string;
  verdict: FairnessVerdict;
  rev: string | null;
  contentHash: string | null;
  ownVerdict: "create" | "replace" | "unchanged" | "delete" | FairnessWriteRefusal | null;
  recordedAt: string | null;
  memberIds?: string[];
  current?: { rev: string; source: string; recordedAt: string | null };
  cause?: "commit_conflict";
}

const SYSTEM_FIELDS = new Set(["_id", "_type", "_createdAt", "_updatedAt", "_rev"]);

function assertReadClient(read: SanityClient): void {
  const config = read.config();
  const tokenOk = typeof config.token === "string" && config.token.length > 0;
  if (!tokenOk || config.perspective !== "published" || config.useCdn !== false) {
    // A dotted id is private: without the token a read answers «no record» with no
    // error, turning a replay into a refusal and a replace into a create (parent A2).
    throw new Error(
      "fairness executor: the read client must carry the read token, perspective \"published\" and useCdn: false",
    );
  }
}

async function readList(read: SanityClient, bound: { query: string; params: Record<string, unknown> }): Promise<unknown[]> {
  const rows: unknown = await read.fetch(bound.query, bound.params);
  if (!Array.isArray(rows)) throw new Error("fairness executor: a read answered no list");
  return rows;
}

interface MemberRow {
  _id: string;
  member_name?: string;
  alias?: string;
  ministries?: unknown;
  memberType?: string[];
}

interface Planned {
  month: string;
  id: string;
  op: "write" | "delete";
  body: FairnessMonthBody | null;
  source: FairnessMonthWrite["source"] | null;
  expectedRev: string | null;
  bodyHash: string | null;
  stored: Record<string, unknown> | null;
  decision: FairnessDecision | null;
  own: FairnessExecution["ownVerdict"];
  issues?: FairnessIssue[];
  memberIds?: string[];
}

function refusalOf(own: FairnessExecution["ownVerdict"]): FairnessWriteRefusal | null {
  return own === null || own === "create" || own === "replace" || own === "unchanged" || own === "delete" ? null : own;
}

function currentSummary(stored: Record<string, unknown> | null): FairnessExecution["current"] {
  if (!stored || typeof stored._rev !== "string") return undefined;
  return {
    rev: stored._rev,
    source: typeof stored.source === "string" ? stored.source : "",
    recordedAt: typeof stored.recordedAt === "string" ? stored.recordedAt : null,
  };
}

/** WR-5 (route) and WR-14 row 9 (both actors): the live-member checks of a written month. */
function memberRefusal(
  actor: Actor,
  body: FairnessMonthBody,
  members: ReadonlyMap<string, MemberRow>,
): { refusal: "member_unknown" | "member_not_worship" | "tipo_mismatch"; ids: string[] } | null {
  const ids = body.people.map((p) => p.memberId);
  const unknown = ids.filter((id) => {
    const m = members.get(id);
    // A member document that yields no display name is refused too: no item is ever
    // written without a `name` (REC-3), and the reader would refuse it (RD-2).
    return !m || displayMemberName({ member_name: m.member_name, alias: m.alias }) === "";
  });
  if (unknown.length > 0) return { refusal: "member_unknown", ids: unknown.sort(compareCodepoint) };
  if (actor !== "route") return null;
  const notWorship = ids.filter((id) => !normalizeMinistries(members.get(id)?.ministries).includes("worship"));
  if (notWorship.length > 0) return { refusal: "member_not_worship", ids: notWorship.sort(compareCodepoint) };
  const mismatch = body.people
    .filter((p) => ROLE_KEYS.some((k) => p.roles[k] !== "out" && !memberFitsRoleKey(members.get(p.memberId), k)))
    .map((p) => p.memberId);
  if (mismatch.length > 0) return { refusal: "tipo_mismatch", ids: mismatch.sort(compareCodepoint) };
  return null;
}

/**
 * Write (or, for actor `reconstruction`, delete) 1+ months of `fairnessMonth`, returning
 * one result per entry in input order. Throws — before any read — on a read client
 * without the token, the `published` perspective and `useCdn: false`, and on a
 * programming error (a route delete, a route without `stamps.engine === "v3"`, a
 * reconstruction with another engine or another `recordedBy`). Throws after a read for
 * a read that answers no list and for a commit error `sanityConflictKind` does not
 * recognise. Everything else is a typed refusal.
 *
 * Actor `route`: all or nothing (WR-9) — every create and replace in ONE transaction,
 * no transaction when nothing changes, and a refusal of any month writes nothing.
 * Actor `reconstruction`: each month on its own, one guarded transaction per month
 * (C4 R16).
 */
export async function executeFairnessMonthWrites(input: {
  clients: { read: SanityClient; write: SanityClient };
  actor: Actor;
  op: "write" | "delete";
  months: Array<FairnessMonthWrite | Omit<FairnessMonthWrite, "source"> | FairnessDeleteEntry>;
  stamps: FairnessStamps;
}): Promise<FairnessExecution[]> {
  const { clients, actor, op, stamps } = input;
  if (op === "delete" && actor !== "reconstruction") throw new Error("fairness executor: only the reconstruction actor deletes");
  if (actor === "route" && stamps.engine !== "v3") throw new Error("fairness executor: the route actor writes under engine v3 only");
  if (actor === "reconstruction") {
    if (stamps.engine !== undefined && stamps.engine !== "v2") throw new Error("fairness executor: reconstruction stamps engine v2");
    if (stamps.recordedBy !== RECONSTRUCTION_RECORDED_BY) throw new Error("fairness executor: reconstruction stamps the script marker");
  }
  if (!isMonthString(stamps.currentMonth)) throw new Error("fairness executor: currentMonth must be YYYY-MM");
  assertReadClient(clients.read);

  // ── 1. Validate every entry (IF2-18 on write entries; WR-4's month pattern on deletes).
  const planned: Planned[] = input.months.map((entry) => {
    const month = (entry as { month?: unknown }).month;
    const base: Planned = {
      month: typeof month === "string" ? month : "",
      id: typeof month === "string" ? fairnessMonthId(month) : "",
      op,
      body: null,
      source: null,
      expectedRev: (entry as { expectedRev?: string | null }).expectedRev ?? null,
      bodyHash: null,
      stored: null,
      decision: null,
      own: null,
    };
    if (op === "delete") {
      const rev = (entry as { expectedRev?: unknown }).expectedRev;
      const issues: FairnessIssue[] = [];
      if (!isMonthString(month)) issues.push({ path: "month", message: MSG.month });
      if (typeof rev !== "string" || rev.length === 0 || rev.length > 64) issues.push({ path: "expectedRev", message: MSG.expectedRev });
      return issues.length ? { ...base, own: "invalid_body", issues } : base;
    }
    const checked = validateFairnessMonthWrite(entry, actor, stamps.currentMonth);
    if (!checked.ok) return { ...base, own: "invalid_body", issues: checked.issues };
    const value = checked.value;
    return {
      ...base,
      body: { month: value.month, people: value.people, presence: value.presence },
      source: actor === "route" ? (value as FairnessMonthWrite).source : null,
      expectedRev: value.expectedRev,
      bodyHash: contentHashOfWrite(value.month, value),
    };
  });

  if (actor === "route" && planned.some((p) => p.own === "invalid_body")) {
    return planned.map((p) => ({
      month: p.month,
      verdict: { refused: "invalid_body", issues: p.issues ?? [] },
      rev: null,
      contentHash: null,
      ownVerdict: p.own,
      recordedAt: null,
    }));
  }
  const live = planned.filter((p) => p.own === null);

  // ── 2. Fresh state (WR-7): the records in full; for the route, the freezing services.
  const storedRows = live.length ? await readList(clients.read, fairnessMonthsByIdsQuery(live.map((p) => p.id))) : [];
  const storedById = new Map<string, Record<string, unknown>>();
  for (const row of storedRows) {
    if (row && typeof row === "object" && typeof (row as { _id?: unknown })._id === "string") {
      storedById.set((row as { _id: string })._id, row as Record<string, unknown>);
    }
  }
  const freezing = new Map<string, number>();
  if (actor === "route" && live.length) {
    for (const row of await readList(clients.read, serviceCountsInMonths(live.map((p) => p.month)))) {
      const r = row as { month?: unknown; weekend?: unknown; countedSpecials?: unknown };
      if (typeof r.month === "string") freezing.set(r.month, Number(r.weekend ?? 0) + Number(r.countedSpecials ?? 0));
    }
  }

  // ── 3. Decide (IF2-21).
  for (const p of live) {
    p.stored = storedById.get(p.id) ?? null;
    const facts: StoredRecordFacts | null = p.stored
      ? {
          rev: String(p.stored._rev ?? ""),
          source: p.stored.source as LogicalRecord["source"],
          contentHash: String(p.stored.contentHash ?? ""),
          intact: isIntact(p.stored),
        }
      : null;
    p.decision = decideFairnessMonth({
      actor,
      op,
      month: p.month,
      currentMonth: stamps.currentMonth,
      expectedRev: p.expectedRev,
      bodyHash: p.bodyHash,
      stored: facts,
      hasFreezingServices: (freezing.get(p.month) ?? 0) > 0,
    });
    p.own = typeof p.decision === "string" ? p.decision : p.decision.refused;
  }

  // ── 4. The live-member read and checks, on months decided create or replace (WR-5, WR-16).
  const writing = live.filter((p) => p.own === "create" || p.own === "replace");
  const memberIds = [...new Set(writing.flatMap((p) => p.body!.people.map((x) => x.memberId)))].sort(compareCodepoint);
  const members = new Map<string, MemberRow>();
  if (memberIds.length) {
    for (const row of await readList(clients.read, fairnessMembersByIdsQuery(memberIds))) {
      const m = row as MemberRow;
      if (m && typeof m._id === "string") members.set(m._id, m);
    }
  }
  for (const p of writing) {
    const refused = memberRefusal(actor, p.body!, members);
    if (refused) {
      p.own = refused.refusal;
      p.memberIds = refused.ids;
    }
  }

  const names = new Map<string, string>();
  for (const [id, m] of members) names.set(id, displayMemberName({ member_name: m.member_name, alias: m.alias }));

  const docFor = (p: Planned) =>
    buildFairnessMonthDocument({
      body: p.body!,
      source: actor === "route" ? p.source! : "reconstructed",
      engine: actor === "route" ? "v3" : "v2",
      environment: stamps.environment,
      recordedAt: stamps.now,
      recordedBy: stamps.recordedBy,
      names,
    });

  const stage = (tx: Transaction, p: Planned): Transaction => {
    if (p.own === "create") return tx.create(docFor(p));
    if (p.own === "replace") {
      const { _id: _ignoredId, _type: _ignoredType, ...fields } = docFor(p);
      void _ignoredId;
      void _ignoredType;
      const stale = Object.keys(p.stored ?? {}).filter((k) => !SYSTEM_FIELDS.has(k) && !(k in fields));
      const rev = p.expectedRev!;
      return tx.patch(p.id, (patch) => {
        const set = patch.ifRevisionId(rev).set(fields as unknown as Record<string, unknown>);
        return stale.length ? set.unset(stale) : set;
      });
    }
    // delete (reconstruction only): a revision-asserting no-op patch, then the delete, in
    // ONE transaction — `delete` takes no revision precondition (roles/[id] precedent).
    const rev = p.expectedRev!;
    return tx.patch(p.id, (patch) => patch.ifRevisionId(rev).set({ month: p.month })).delete(p.id);
  };

  const unchangedResult = (p: Planned): FairnessExecution => ({
    month: p.month,
    verdict: "unchanged",
    rev: typeof p.stored?._rev === "string" ? p.stored._rev : null,
    contentHash: typeof p.stored?.contentHash === "string" ? p.stored.contentHash : null,
    ownVerdict: "unchanged",
    recordedAt: typeof p.stored?.recordedAt === "string" ? p.stored.recordedAt : null,
  });
  const refusedResult = (p: Planned, refusal: FairnessWriteRefusal, extra: Partial<FairnessExecution> = {}): FairnessExecution => ({
    month: p.month,
    verdict: p.issues ? { refused: refusal, issues: p.issues } : { refused: refusal },
    rev: null,
    contentHash: null,
    ownVerdict: p.own,
    recordedAt: null,
    ...(p.memberIds ? { memberIds: p.memberIds } : {}),
    ...(currentSummary(p.stored) ? { current: currentSummary(p.stored) } : {}),
    ...extra,
  });
  const doneResult = (p: Planned, rev: string): FairnessExecution => ({
    month: p.month,
    verdict: p.own === "create" ? "created" : p.own === "replace" ? "replaced" : "deleted",
    rev: p.own === "delete" ? null : rev,
    contentHash: p.own === "delete" ? null : p.bodyHash,
    ownVerdict: p.own,
    recordedAt: p.own === "delete" ? null : stamps.now,
  });
  const commitRefusal = (err: unknown): { refusal: FairnessWriteRefusal; cause?: "commit_conflict" } => {
    const kind = sanityConflictKind(err);
    if (kind === null) throw err;
    if (kind === "already_exists") return { refusal: "record_exists" };
    return kind === "conflict" ? { refusal: "stale_revision", cause: "commit_conflict" } : { refusal: "stale_revision" };
  };

  // ── 5a. Actor route: all or nothing (WR-9).
  if (actor === "route") {
    const firstRefused = planned.find((p) => refusalOf(p.own) !== null);
    if (firstRefused) {
      const detail = refusalOf(firstRefused.own)!;
      return planned.map((p) => refusedResult(p, refusalOf(p.own) ?? detail));
    }
    const writes = planned.filter((p) => p.own === "create" || p.own === "replace");
    if (writes.length === 0) return planned.map(unchangedResult);
    let tx = clients.write.transaction();
    for (const p of writes) tx = stage(tx, p);
    let transactionId: string;
    try {
      ({ transactionId } = await tx.commit());
    } catch (err) {
      const { refusal, cause } = commitRefusal(err);
      // Content Lake does not say which mutation failed: every written month carries the
      // one mapped verdict, every unchanged month stays unchanged (WR-9).
      return planned.map((p) => {
        if (p.own === "unchanged") return unchangedResult(p);
        p.own = refusal;
        return refusedResult(p, refusal, cause ? { cause } : {});
      });
    }
    return planned.map((p) => (p.own === "unchanged" ? unchangedResult(p) : doneResult(p, transactionId)));
  }

  // ── 5b. Actor reconstruction: each month on its own, one guarded transaction each.
  const results: FairnessExecution[] = [];
  for (const p of planned) {
    const refusal = refusalOf(p.own);
    if (refusal) {
      results.push(refusedResult(p, refusal));
      continue;
    }
    if (p.own === "unchanged") {
      results.push(unchangedResult(p));
      continue;
    }
    try {
      const { transactionId } = await stage(clients.write.transaction(), p).commit();
      results.push(doneResult(p, transactionId));
    } catch (err) {
      const mapped = commitRefusal(err);
      p.own = mapped.refusal;
      results.push(refusedResult(p, mapped.refusal, mapped.cause ? { cause: mapped.cause } : {}));
    }
  }
  return results;
}
````

**Find** in `app/utils/protectedReadAudit.ts`:

````ts

const PROTECTED_LOADER_RE = new RegExp(`\\b(${PROTECTED_LOADER_HELPERS.join("|")})\\s*\\(`);

export type ProtectedSiteKind =
````

**Replace with:**

````ts

const PROTECTED_LOADER_RE = new RegExp(`\\b(${PROTECTED_LOADER_HELPERS.join("|")})\\s*\\(`);

/**
 * Protected WRITE EXECUTORS (solver v3 C2 GU-5) — the `PROTECTED_LOADER_HELPERS`
 * precedent applied to writing. An executor mutates through a client its CALLER injects,
 * so neither its declaring module nor a caller that only hands it a client shows a
 * recognisable mutation: both would be invisible to every rule above. So a CALL to a
 * registered executor, or its DECLARATION, is itself a `protected-write` site of the
 * operation it sits in — detected whether or not the file imports or creates any Sanity
 * client (the rule runs before the no-client early return) and whatever else the file
 * mutates. It adds no read classification: the executor's injected reads are held by its
 * own runtime assertion. An ALIASED import is not chased; the executor's caller pin
 * (`serviceCommitCallers.test.ts`) pins its importers by module instead.
 */
export const PROTECTED_WRITE_EXECUTORS = ["executeFairnessMonthWrites"] as const;

const PROTECTED_EXECUTOR_RE = new RegExp(`\\b(function\\s+)?(${PROTECTED_WRITE_EXECUTORS.join("|")})\\s*(?=[<(])`, "g");

/** One `protected-write` site per operation that declares or calls a registered executor. */
function executorSites(file: string, code: string, regions: Region[]): ProtectedSite[] {
  const byOperation = new Map<string, ProtectedSite>();
  PROTECTED_EXECUTOR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PROTECTED_EXECUTOR_RE.exec(code))) {
    const operation = operationAt(regions, m.index);
    if (byOperation.has(operation)) continue;
    byOperation.set(operation, {
      file,
      operation,
      kind: "protected-write",
      client: "executor",
      compliant: false,
      evidence: m[1]
        ? `declares the protected write executor ${m[2]}()`
        : `calls the protected write executor ${m[2]}()`,
    });
  }
  return [...byOperation.values()];
}

export type ProtectedSiteKind =
````

**Find** in `app/utils/protectedReadAudit.ts`:

````ts
      "the notification sweep: claims and consumes notificationOutbox documents through writeClient while reading protected role/setlist/proposal documents through operationalClient; never mutates protected content",
    removalOwner: "permanent runtime writer (never removed — the notification sweep itself)",
  },
  {
````

**Replace with:**

````ts
      "the notification sweep: claims and consumes notificationOutbox documents through writeClient while reading protected role/setlist/proposal documents through operationalClient; never mutates protected content",
    removalOwner: "permanent runtime writer (never removed — the notification sweep itself)",
  },
  {
    file: "app/utils/fairnessMonthWriteRequest.ts",
    operation: "module",
    reason:
      "declares the one write executor of the monthly eligibility record (`fairnessMonth`, solver v3 C2 WR-16), which mutates through an INJECTED client for both actors: the route's create-by-collision and revision-asserted whole replace, and the reconstruction actor's guarded delete (a revision-asserting no-op patch and the delete in one transaction) — the only delete of the type. It never uses createOrReplace. A site through the executor rule (`PROTECTED_WRITE_EXECUTORS`); its importers are pinned by `serviceCommitCallers.test.ts`, over app/ and scripts/",
    removalOwner: "permanent runtime writer (never removed — the eligibility record's only mutation path)",
  },
  {
````

**Find** in `app/utils/protectedReadAudit.ts`:

````ts
export function scanSource(file: string, source: string): ProtectedSite[] {
  const code = stripComments(source);
  const info = sanityClientIdentifiers(code);
  if (!info.clients.size && !info.rawSanityHttp) return [];
  const regions = operationRegions(code);
  const sites: ProtectedSite[] = [];
  const mutatingOperations = new Set<string>();

````

**Replace with:**

````ts
export function scanSource(file: string, source: string): ProtectedSite[] {
  const code = stripComments(source);
  // GU-5: before the no-client early return — a caller of an injected-client executor
  // may import no Sanity client at all.
  const executors = executorSites(file, code, operationRegions(code));
  const info = sanityClientIdentifiers(code);
  if (!info.clients.size && !info.rawSanityHttp) return executors;
  const regions = operationRegions(code);
  const sites: ProtectedSite[] = [...executors];
  const mutatingOperations = new Set<string>();

````

- [ ] **Step 4: Run them to see them pass**

Run: `git add -A && npx vitest run app/utils/__tests__/fairnessMonthExecutor.test.ts app/components/admin/__tests__/memberFitsRoleKey.test.ts app/utils/__tests__/protectedReadAudit.test.ts app/utils/__tests__/serviceCommitCallers.test.ts`
Expected: PASS. The real scan finds exactly one executor site (`app/utils/fairnessMonthWriteRequest.ts#module`), so the new registry entry is not dead; «carries no dead entries» and «has no unlisted direct protected read or writer today» stay green.

- [ ] **Step 5: Gates and commit**

Run: `git add -A && npx tsc --noEmit && npm test && npx eslint .`
Expected: **458 files / 8348 tests**; 0 errors, 81 warnings. (`__fixtures__/` is under `__tests__/`, which the colour inventory skips.)

```bash
git add -A
git commit -m "feat(fairness): the one write executor of fairnessMonth, and the audit's executor rule" -m "Solver v3 C2 IF2-22 and GU-5. Every create, replace and delete of the eligibility record goes through executeFairnessMonthWrites, with the clients injected so C4's tsx script can use it: it throws before any read unless the read client carries the token, the published perspective and useCdn false (a dotted id is invisible without the token); re-reads the records, the freezing services and the listed members itself; decides through IF2-21; and commits a plain create, a revision-asserted whole replace (set every field, unset stale ones) or the reconstruction actor's guarded patch-plus-delete, never createOrReplace. The route actor is all or nothing in one transaction. Because its mutations run on an injected client, the protected-read audit gains PROTECTED_WRITE_EXECUTORS: declaring or calling the executor is itself a protected-write site, detected before the no-client early return, so the module's PROTECTED_RUNTIME_WRITERS entry is exercised. memberFitsRoleKey is the one Tipo-fits-role predicate the writer and the resolver share."
```


---

## Task 8: `PUT /api/admin/fairness/months` and its commit module — **[CRITICAL slice: the production write route]**

Spec WR-1–WR-13, IF2-4, IF2-5, IF2-6, IF2-23 (route caller), GU-1. The route authorizes (admin and super-admin; content-editor → `403 forbidden`) and parses JSON; `fairnessMonthCommit.ts` holds the rest (ADR-0043): the engine gate before the body is looked at (`409 engine_not_v3`, nothing read), the strict 1–2 consecutive-month body (`400 invalid_request`, index-based `details.issues`), the server stamps (effective engine, environment, CDMX month, clock, the session's EFFECTIVE member id — the impersonated manager under impersonation), one executor call with actor `route` and the canonical clients, and the IF2-5 bodies (`details.detail` = the earliest month's own refusal; a commit 409 on every written month). Registrations: `PROTECTED_RUNTIME_WRITERS` (exercised through the executor rule), `DELIVERY_CAPABLE_IMPORTS` (so the handler is wrapped in `withVerificationRunContext` — it delivers nothing) and the caller pin (the route is its only caller).

**Files:**
- Create: `app/utils/fairnessMonthCommit.ts`, `app/api/admin/fairness/months/route.ts`
- Modify: `app/utils/protectedReadAudit.ts` (`PROTECTED_RUNTIME_WRITERS`, before the write-request module's entry)
- Modify: `app/utils/__tests__/__fixtures__/deliveryCapableImports.ts` (end of the list), `app/utils/__tests__/serviceCommitCallers.test.ts` (`EXPECTED_CALLERS`), `app/utils/__tests__/protectedReadAudit.test.ts` (the writers pin; the executor-site assertion)
- Test: `app/api/__tests__/fairnessMonthsRoute.test.ts`
- Regenerate: `app/utils/__tests__/__fixtures__/colour-inventory.json`

**Interfaces:**
- Consumes: Task 7's executor and fake; Task 5's validator; Task 2's resolvers; `serviceTodayIso` (`serviceReadiness.ts`); `serviceError`; `CommitOutcome`; `withVerificationRunContext`; `requireActiveManager`.
- Produces: `commitFairnessMonths(body: unknown, actor: { recordedBy: string }, env = process.env, now = new Date()): Promise<CommitOutcome<FairnessCommitEffects>>`; `interface FairnessCommitEffects { months: Array<{ month; outcome }> }`; `PUT` (route).

- [ ] **Step 1: Write the failing tests and the registrations they check**

**Create** `app/api/__tests__/fairnessMonthsRoute.test.ts`:

````ts
// `PUT /api/admin/fairness/months` — solver v3 C2 WR-1 … WR-12 through the real route,
// the real commit module and the real executor, over an in-memory Content Lake whose
// reads run the real GROQ builders. The clock is pinned to 20 Oct 2026 (CDMX), so the
// current month is 2026-10. Every name is fictitious (this repository is public).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeFairnessSanity, contentLakeConflict, type FakeDoc } from "@/app/utils/__tests__/__fixtures__/fakeFairnessSanity";
import { buildFairnessMonthDocument } from "@/app/utils/fairnessMonthWriteRequest";
import type { FairnessMonthWrite, RoleKey, Status } from "@/app/utils/fairnessVocabulary";

const h = vi.hoisted(() => ({
  requireActiveManager: vi.fn(),
  lake: null as unknown as ReturnType<typeof import("@/app/utils/__tests__/__fixtures__/fakeFairnessSanity").createFakeFairnessSanity>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/app/utils/authGuards", () => ({ requireActiveManager: () => h.requireActiveManager() }));
vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: {
    config: () => h.lake.read.config(),
    fetch: (query: string, params: Record<string, unknown>) => h.lake.read.fetch(query, params),
  },
}));
vi.mock("@/sanity/lib/serverClient", () => ({
  serverClient: { fetch: vi.fn() },
  writeClient: { transaction: () => h.lake.write.transaction() },
}));

import { PUT } from "@/app/api/admin/fairness/months/route";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const OUT: Record<RoleKey, Status> = {
  "Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "out", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out",
};
const MEMBERS: FakeDoc[] = [
  { _id: "m-alma", _type: "teamMembers", member_name: "Alma Ruiz", alias: "Alma", memberType: ["voz", "sunday_lead"] },
  { _id: "m-bruno", _type: "teamMembers", member_name: "Bruno Díaz", memberType: ["voz", "support"] },
];

function entry(month: string, patch: Partial<FairnessMonthWrite> = {}): FairnessMonthWrite {
  return {
    month,
    source: "manual",
    expectedRev: null,
    people: [
      { memberId: "m-alma", roles: { ...OUT, "Sun.Lead": "in" }, exactRules: [], exempt: false, blocks: [] },
      { memberId: "m-bruno", roles: { ...OUT, "Sun.BGV": "in" }, exactRules: [], exempt: false, blocks: [] },
    ],
    presence: [],
    ...patch,
  };
}

function record(body: FairnessMonthWrite): FakeDoc {
  return buildFairnessMonthDocument({
    body,
    source: "auto",
    engine: "v3",
    environment: "production",
    recordedAt: "2026-10-03T15:00:00.000Z",
    recordedBy: "m-other-admin",
    names: new Map([["m-alma", "Alma"], ["m-bruno", "Bruno Díaz"]]),
  }) as unknown as FakeDoc;
}

const req = (body: unknown) =>
  ({ json: async () => body, headers: new Headers() }) as unknown as NextRequest;
const badJson = () =>
  ({ json: async () => { throw new SyntaxError("x"); }, headers: new Headers() }) as unknown as NextRequest;

const session = (role: string, sanityId = "m-admin") => ({ user: { role, sanityId } });

async function put(body: unknown) {
  const res = await PUT(req(body));
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-20T18:00:00.000Z"));
  vi.stubEnv("OWT_SOLVER_ENGINE", "v3");
  vi.stubEnv("VERCEL_ENV", "");
  h.requireActiveManager.mockResolvedValue(session("admin"));
  h.lake = createFakeFairnessSanity(MEMBERS);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("the gate (WR-2)", () => {
  it("answers 403 with no session", async () => {
    h.requireActiveManager.mockResolvedValue(null);
    expect((await put({ months: [entry("2026-11")] })).status).toBe(403);
    expect(h.lake.reads).toEqual([]);
  });

  it("answers 403 forbidden to a content-editor", async () => {
    h.requireActiveManager.mockResolvedValue(session("content-editor"));
    const res = await put({ months: [entry("2026-11")] });
    expect(res).toMatchObject({ status: 403, body: { error: "forbidden" } });
    expect(h.lake.reads).toEqual([]);
  });

  it.each(["admin", "super-admin"])("lets %s write, stamping recordedBy with the session's effective id", async (role) => {
    h.requireActiveManager.mockResolvedValue(session(role, "m-effective"));
    const res = await put({ months: [entry("2026-11")] });
    expect(res.status).toBe(200);
    expect(h.lake.docs.get("fairnessMonth.2026-11")?.recordedBy).toBe("m-effective");
  });
});

describe("the engine gate (WR-6)", () => {
  it("refuses engine_not_v3 under the constant, reading and writing nothing", async () => {
    vi.stubEnv("OWT_SOLVER_ENGINE", "");
    const res = await put({ months: [entry("2026-11")] });
    expect(res).toMatchObject({ status: 409, body: { conflict: true, details: { detail: "engine_not_v3", months: [] } } });
    expect(h.lake.reads).toEqual([]);
  });

  it("ignores the override on production", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect((await put({ months: [entry("2026-11")] })).body.details.detail).toBe("engine_not_v3");
  });
});

describe("the body (WR-3, WR-4)", () => {
  it("answers 400 on a body that is not JSON", async () => {
    const res = await PUT(badJson());
    expect(res.status).toBe(400);
  });

  it.each([
    ["an unknown top-level field", { months: [entry("2026-11")], force: true }, ["force"]],
    ["no months", { months: [] }, ["months"]],
    ["three months", { months: [entry("2026-11"), entry("2026-12"), entry("2027-01")] }, ["months"]],
    ["two months that are not consecutive", { months: [entry("2026-11"), entry("2027-01")] }, ["months[1].month"]],
    ["two months out of order", { months: [entry("2026-12"), entry("2026-11")] }, ["months[1].month"]],
    ["a server stamp", { months: [{ ...entry("2026-11"), recordedBy: "m-alma" }] }, ["months[0].recordedBy"]],
    ["source reconstructed", { months: [{ ...entry("2026-11"), source: "reconstructed" }] }, ["months[0].source"]],
    ["a month past current + 12", { months: [entry("2027-11")] }, ["months[0].month"]],
  ])("answers 400 invalid_request on %s, naming each path", async (_label, body, paths) => {
    const res = await put(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
    expect(res.body.details.issues.map((i: { path: string }) => i.path)).toEqual(paths);
    expect(h.lake.reads).toEqual([]);
  });
});

describe("the decision and the commit (WR-7 … WR-12)", () => {
  it("creates and answers each month's outcome, revision, hash and recordedAt", async () => {
    const res = await put({ months: [entry("2026-11"), entry("2026-12")] });
    expect(res.status).toBe(200);
    expect(res.body.months.map((m: { outcome: string; rev: string }) => [m.outcome, m.rev])).toEqual([
      ["created", "tx-1"],
      ["created", "tx-1"],
    ]);
    expect(res.body.months[0]).toMatchObject({ month: "2026-11", recordedAt: "2026-10-20T18:00:00.000Z" });
    expect(res.body.months[0].contentHash).toMatch(/^sha256:/);
    expect(h.lake.docs.get("fairnessMonth.2026-11")).toMatchObject({ environment: "local", engine: "v3" });
  });

  it("creates an unrecorded month with stored weekend services and a counted special (A27)", async () => {
    h.lake = createFakeFairnessSanity([
      ...MEMBERS,
      { _id: "sun-1", _type: "sunday_role", week: "2026-11-01" },
      { _id: "spc-1", _type: "special_role", date: "2026-11-04", countsForFairness: true },
    ]);
    expect((await put({ months: [entry("2026-11")] })).body.months[0].outcome).toBe("created");
  });

  it("replaces a recorded month whose only service is an uncounted special; refuses with a counted one (A5, A6)", async () => {
    const changed = entry("2026-11", { expectedRev: "rev-0" });
    changed.people[1].exempt = true;
    h.lake = createFakeFairnessSanity([...MEMBERS, record(entry("2026-11")), { _id: "spc-1", _type: "special_role", date: "2026-11-04" }]);
    expect((await put({ months: [changed] })).body.months[0].outcome).toBe("replaced");
    h.lake = createFakeFairnessSanity([
      ...MEMBERS,
      record(entry("2026-11")),
      { _id: "spc-1", _type: "special_role", date: "2026-11-04", countsForFairness: true },
    ]);
    const refused = await put({ months: [changed] });
    expect(refused).toMatchObject({ status: 409, body: { error: "integrity_conflict", details: { detail: "month_has_services" } } });
  });

  it("refuses record_exists with the current record's rev, source and recordedAt", async () => {
    h.lake = createFakeFairnessSanity([...MEMBERS, record(entry("2026-11"))]);
    const changed = entry("2026-11");
    changed.people[0].exempt = true;
    const res = await put({ months: [changed] });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      error: "stale_revision",
      conflict: true,
      details: {
        detail: "record_exists",
        months: [{ month: "2026-11", verdict: "record_exists" }],
        rev: "rev-0",
        source: "auto",
        recordedAt: "2026-10-03T15:00:00.000Z",
      },
    });
  });

  it("writes nothing when the months' verdicts differ, and names the earlier month's (WR-9)", async () => {
    h.lake = createFakeFairnessSanity([...MEMBERS, record(entry("2026-11"))]);
    const nov = entry("2026-11", { expectedRev: "rev-stale" });
    nov.people[0].exempt = true;
    const dec = entry("2026-12");
    dec.people[1] = { ...dec.people[1], memberId: "m-ghost" };
    const res = await put({ months: [nov, dec] });
    expect(res.body.details).toMatchObject({
      detail: "stale_revision",
      months: [
        { month: "2026-11", verdict: "stale_revision" },
        { month: "2026-12", verdict: "member_unknown" },
      ],
    });
    expect(h.lake.commits).toEqual([]);
  });

  it("refuses a member whose Tipo does not fit as integrity_conflict tipo_mismatch, with the ids (WR-5)", async () => {
    const body = entry("2026-11");
    body.people[1].roles["Sun.Lead"] = "in";
    const res = await put({ months: [body] });
    expect(res).toMatchObject({
      status: 409,
      body: { error: "integrity_conflict", details: { detail: "tipo_mismatch", memberIds: ["m-bruno"] } },
    });
  });

  it("answers an identical replay 200 unchanged with no transaction, even across a month boundary", async () => {
    h.lake = createFakeFairnessSanity([...MEMBERS, record(entry("2026-09"))]);
    const res = await put({ months: [entry("2026-09", { expectedRev: "rev-0" })] });
    expect(res).toMatchObject({ status: 200, body: { months: [{ month: "2026-09", outcome: "unchanged", rev: "rev-0" }] } });
    expect(h.lake.commits).toEqual([]);
  });

  it("reports a transaction's 409 on every written month, never as a server fault (WR-11)", async () => {
    h.lake.failNext.commit = contentLakeConflict();
    const res = await put({ months: [entry("2026-11"), entry("2026-12")] });
    expect(res).toMatchObject({
      status: 409,
      body: {
        error: "stale_revision",
        details: {
          detail: "stale_revision",
          cause: "commit_conflict",
          months: [
            { month: "2026-11", verdict: "stale_revision" },
            { month: "2026-12", verdict: "stale_revision" },
          ],
        },
      },
    });
  });

  it("maps a commit's already_exists to record_exists", async () => {
    h.lake.failNext.commit = contentLakeConflict("documentAlreadyExistsError");
    const res = await put({ months: [entry("2026-11")] });
    expect(res.body.details).toMatchObject({ detail: "record_exists", months: [{ month: "2026-11", verdict: "record_exists" }] });
    expect(res.body.details).not.toHaveProperty("rev");
  });

  it("throws (500) on an error that is not a 409 mutation conflict", async () => {
    h.lake.failNext.commit = Object.assign(new Error("Unauthorized"), { statusCode: 401 });
    await expect(PUT(req({ months: [entry("2026-11")] }))).rejects.toThrow("Unauthorized");
  });

  it("throws (500) before any read when the read token is missing", async () => {
    h.lake = createFakeFairnessSanity(MEMBERS, { perspective: "published", useCdn: false });
    await expect(PUT(req({ months: [entry("2026-11")] }))).rejects.toThrow(/read token/);
    expect(h.lake.reads).toEqual([]);
  });
});

describe("the route's own shape (WR-1, WR-13, WR-14)", () => {
  const SOURCE = readFileSync(path.join(HERE, "../admin/fairness/months/route.ts"), "utf8");

  it("delegates to the commit module and is wrapped in the run context", () => {
    expect(SOURCE).toMatch(/export const PUT = withVerificationRunContext\(putHandler\);/);
    expect(SOURCE).toContain('from "@/app/utils/fairnessMonthCommit"');
  });

  it("never selects the reconstruction actor and exports no DELETE", () => {
    const commit = readFileSync(path.join(HERE, "../../utils/fairnessMonthCommit.ts"), "utf8");
    expect(commit).toMatch(/actor: "route"/);
    expect(commit).not.toMatch(/actor: "reconstruction"|op: "delete"/);
    expect(SOURCE).not.toMatch(/export (const|async function) DELETE/);
  });
});
````

**Find** in `app/utils/__tests__/__fixtures__/deliveryCapableImports.ts`:

````ts
  "publishReadyCommit",
  "roleUnpublishCommit",
];
````

**Replace with:**

````ts
  "publishReadyCommit",
  "roleUnpublishCommit",
  // Solver v3 C2 (ADR-0043's rule for every `*Commit`): the eligibility-record writer
  // delivers nothing, but the name puts its route in the run-context scan anyway.
  "fairnessMonthCommit",
];
````

**Find** in `app/utils/__tests__/serviceCommitCallers.test.ts`:

````ts
  // list grows only by a reviewed edit here — C2 adds `fairnessMonthCommit.ts` and
  // `fairnessLedgerRead.ts`; C4 adds its CLI file and its `scripts/lib` core.
  fairnessMonthWriteRequest: [],
};

````

**Replace with:**

````ts
  // list grows only by a reviewed edit here — C2 adds `fairnessMonthCommit.ts` and
  // `fairnessLedgerRead.ts`; C4 adds its CLI file and its `scripts/lib` core.
  fairnessMonthWriteRequest: ["app/utils/fairnessMonthCommit.ts"],
  // Solver v3 C2 WR-1: the PUT route is the commit module's only caller (no MCP tool).
  fairnessMonthCommit: ["app/api/admin/fairness/months/route.ts"],
};

````

**Find** in `app/utils/__tests__/protectedReadAudit.test.ts`:

````ts
  });

  it("licenses the seventeen permanent runtime writers for WRITES ONLY, never reads", () => {
    expect(PROTECTED_RUNTIME_WRITERS.map((e) => `${e.file}#${e.operation}`).sort()).toEqual(
      [
````

**Replace with:**

````ts
  });

  it("licenses the eighteen permanent runtime writers for WRITES ONLY, never reads", () => {
    expect(PROTECTED_RUNTIME_WRITERS.map((e) => `${e.file}#${e.operation}`).sort()).toEqual(
      [
````

**Find** in `app/utils/__tests__/protectedReadAudit.test.ts`:

````ts
        "app/utils/setlistSaveCommit.ts#module",
        "app/utils/fairnessMonthWriteRequest.ts#module",
        "app/api/me/proposals/route.ts#POST",
        "app/api/me/proposals/[id]/messages/route.ts#POST",
````

**Replace with:**

````ts
        "app/utils/setlistSaveCommit.ts#module",
        "app/utils/fairnessMonthWriteRequest.ts#module",
        "app/utils/fairnessMonthCommit.ts#module",
        "app/api/me/proposals/route.ts#POST",
        "app/api/me/proposals/[id]/messages/route.ts#POST",
````

**Find** in `app/utils/__tests__/protectedReadAudit.test.ts`:

````ts
  it("finds exactly the registered fairness executor sites (C2 GU-5, IF2-23)", () => {
    const sites = REAL_SITES.filter((s) => s.client === "executor").map((s) => `${s.file}#${s.operation}`);
    expect(sites.sort()).toEqual(["app/utils/fairnessMonthWriteRequest.ts#module"]);
  });

````

**Replace with:**

````ts
  it("finds exactly the registered fairness executor sites (C2 GU-5, IF2-23)", () => {
    const sites = REAL_SITES.filter((s) => s.client === "executor").map((s) => `${s.file}#${s.operation}`);
    expect(sites.sort()).toEqual(["app/utils/fairnessMonthCommit.ts#module", "app/utils/fairnessMonthWriteRequest.ts#module"]);
  });

````

- [ ] **Step 2: Run them to see them fail**

Run: `git add -A && npx vitest run app/api/__tests__/fairnessMonthsRoute.test.ts app/utils/__tests__/serviceCommitCallers.test.ts app/utils/__tests__/protectedReadAudit.test.ts`
Expected: FAIL — the route does not resolve, and the pins name a commit module and a registry entry that do not exist.

- [ ] **Step 3: Implement**

**Create** `app/utils/fairnessMonthCommit.ts`:

````ts
// The eligibility-record writer behind `PUT /api/admin/fairness/months` (solver v3 C2
// WR-1 … WR-13) — the domain body ADR-0043 moves out of the route. The route keeps only
// authorization and the JSON parse; everything after lives here and returns a
// `CommitOutcome` whose `body`/`status` the route sends as-is.
//
// It issues NO mutation of its own: it validates the PUT body, stamps the request from the
// server's own state (the effective engine, the deployment's environment, the CDMX
// month, the clock and the session's effective member id) and hands every month to THE
// write executor (`executeFairnessMonthWrites`, `fairnessMonthWriteRequest.ts`) with
// actor `route` and the canonical clients — `operationalClient` (published, no CDN,
// carrying the read token; the executor refuses any other) and `writeClient`. It is a
// registered protected writer (`PROTECTED_RUNTIME_WRITERS`, through the audit's executor
// rule), a delivery-capable import (`DELIVERY_CAPABLE_IMPORTS`) — so the route wraps its
// handler in `withVerificationRunContext`, harmlessly: nothing here delivers — and its
// one caller is pinned by `serviceCommitCallers.test.ts`.
//
// No side effects (WR-13): no notification, no outbox, no `after()`, and no
// `revalidate*` — no ISR page reads `fairnessMonth`; the panel re-reads the GET.
// The route can never select the reconstruction actor, and nothing here deletes.

import "server-only";

import { operationalClient } from "@/sanity/lib/operationalClient";
import { writeClient } from "@/sanity/lib/serverClient";
import { serviceTodayIso } from "@/app/components/admin/serviceReadiness";
import type { CommitOutcome } from "./commitOutcome";
import {
  executeFairnessMonthWrites,
  validateFairnessMonthWrite,
  type FairnessExecution,
  type FairnessIssue,
} from "./fairnessMonthWriteRequest";
import {
  FAIRNESS_PUT_REFUSALS,
  isMonthString,
  shiftMonth,
  type FairnessMonthWrite,
  type FairnessMonthsPutConflictDetails,
  type FairnessMonthsPutOk,
  type FairnessPutRefusal,
} from "./fairnessVocabulary";
import { serviceError } from "./serviceMutation";
import { fairnessRecordEnvironment, resolveSolverEngine } from "./solverDeployment";

export interface FairnessCommitEffects {
  months: Array<{ month: string; outcome: "created" | "replaced" | "unchanged" }>;
}

/**
 * The shared error model's code for each refusal (WR-12: the plan's choice). The three
 * «your view is stale — re-read» refusals reuse `stale_revision`; everything that is the
 * state of the world refusing the write is `integrity_conflict` (WR-5's three are
 * mandated). Every one is a 409 with `conflict: true`; clients branch on `details.detail`.
 */
const REFUSAL_ERROR: Readonly<Record<FairnessPutRefusal, "stale_revision" | "integrity_conflict">> = {
  record_exists: "stale_revision",
  record_missing: "stale_revision",
  stale_revision: "stale_revision",
  month_has_services: "integrity_conflict",
  past_month: "integrity_conflict",
  engine_not_v3: "integrity_conflict",
  member_unknown: "integrity_conflict",
  member_not_worship: "integrity_conflict",
  tipo_mismatch: "integrity_conflict",
};

const isPutRefusal = (v: unknown): v is FairnessPutRefusal =>
  typeof v === "string" && (FAIRNESS_PUT_REFUSALS as readonly string[]).includes(v);

function invalid(issues: FairnessIssue[]): CommitOutcome<FairnessCommitEffects> {
  const res = serviceError("invalid_request", { details: { issues } });
  return { ok: false, status: res.status, body: res.body };
}

function conflict(details: FairnessMonthsPutConflictDetails): CommitOutcome<FairnessCommitEffects> {
  const res = serviceError(REFUSAL_ERROR[details.detail], { details: { ...details } });
  return { ok: false, status: res.status, body: res.body };
}

/** WR-3: `{ months: [1–2 entries] }`, consecutive and ascending; each entry by IF2-18. */
function validatePut(
  body: unknown,
  currentMonth: string,
): { ok: true; months: FairnessMonthWrite[] } | { ok: false; issues: FairnessIssue[] } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, issues: [{ path: "", message: "must be an object" }] };
  }
  const issues: FairnessIssue[] = [];
  for (const key of Object.keys(body)) if (key !== "months") issues.push({ path: key, message: "unknown field" });
  const months = (body as { months?: unknown }).months;
  if (!Array.isArray(months) || months.length < 1 || months.length > 2) {
    issues.push({ path: "months", message: "must hold 1 or 2 months" });
    return { ok: false, issues };
  }
  months.forEach((entry, i) => {
    const checked = validateFairnessMonthWrite(entry, "route", currentMonth);
    if (!checked.ok) {
      for (const issue of checked.issues) {
        issues.push({ path: issue.path ? `months[${i}].${issue.path}` : `months[${i}]`, message: issue.message });
      }
    }
  });
  const [first, second] = months as Array<{ month?: unknown }>;
  if (second && isMonthString(first?.month) && isMonthString(second.month) && second.month !== shiftMonth(first.month, 1)) {
    issues.push({ path: "months[1].month", message: "must be the month after months[0].month" });
  }
  return issues.length ? { ok: false, issues } : { ok: true, months: months as FairnessMonthWrite[] };
}

/** IF2-5 `details.months[].verdict`: each month's own decision or refusal. */
function ownVerdicts(results: FairnessExecution[]): FairnessMonthsPutConflictDetails["months"] {
  return results.map((r) => {
    const own = r.ownVerdict;
    const verdict = own === "create" || own === "replace" || own === "unchanged" ? own : isPutRefusal(own) ? own : "stale_revision";
    return { month: r.month, verdict };
  });
}

export async function commitFairnessMonths(
  body: unknown,
  actor: { recordedBy: string },
  env: Readonly<Record<string, string | undefined>> = process.env,
  now: Date = new Date(),
): Promise<CommitOutcome<FairnessCommitEffects>> {
  // WR-6 — the engine gate, before the body is looked at and before any read.
  const engine = resolveSolverEngine(env);
  if (engine !== "v3") return conflict({ detail: "engine_not_v3", months: [] });

  const currentMonth = serviceTodayIso(now).slice(0, 7);
  const checked = validatePut(body, currentMonth);
  if (!checked.ok) return invalid(checked.issues);

  const results = await executeFairnessMonthWrites({
    clients: { read: operationalClient, write: writeClient },
    actor: "route",
    op: "write",
    months: checked.months,
    stamps: {
      recordedBy: actor.recordedBy,
      now: now.toISOString(),
      currentMonth,
      environment: fairnessRecordEnvironment(env),
      engine,
    },
  });

  // The executor re-runs IF2-18; a body this module accepted cannot fail it, but if one
  // ever did, it is a 400 like any other invalid body.
  const bodyIssues = results.flatMap((r, i) =>
    typeof r.verdict === "object" && r.verdict.refused === "invalid_body"
      ? (r.verdict.issues ?? []).map((issue) => ({ path: `months[${i}].${issue.path}`, message: issue.message }))
      : [],
  );
  if (results.some((r) => typeof r.verdict === "object" && r.verdict.refused === "invalid_body")) return invalid(bodyIssues);

  if (results.every((r) => typeof r.verdict === "string")) {
    const ok: FairnessMonthsPutOk = {
      months: results.map((r) => ({
        month: r.month,
        outcome: r.verdict as "created" | "replaced" | "unchanged",
        rev: r.rev ?? "",
        contentHash: r.contentHash ?? "",
        recordedAt: r.recordedAt ?? "",
      })),
    };
    return {
      ok: true,
      status: 200,
      body: ok as unknown as Record<string, unknown>,
      effects: { months: ok.months.map(({ month, outcome }) => ({ month, outcome })) },
    };
  }

  // A refusal: nothing was written (WR-9). `detail` is the EARLIEST month's own refusal
  // (entries are ascending); a commit conflict carries one mapped verdict on every
  // written month, so the earliest written month's is the same.
  const first = results.find((r) => isPutRefusal(r.ownVerdict))!;
  const detail = first.ownVerdict as FairnessPutRefusal;
  const details: FairnessMonthsPutConflictDetails = { detail, months: ownVerdicts(results) };
  if (first.cause) details.cause = first.cause;
  if (detail === "record_exists" && first.current) {
    details.rev = first.current.rev;
    details.source = first.current.source as FairnessMonthsPutConflictDetails["source"];
    if (first.current.recordedAt) details.recordedAt = first.current.recordedAt;
  }
  if (first.memberIds) details.memberIds = first.memberIds;
  return conflict(details);
}
````

**Create** `app/api/admin/fairness/months/route.ts`:

````ts
// app/api/admin/fairness/months/route.ts
import { NextRequest, NextResponse } from "next/server";

import { requireActiveManager } from "@/app/utils/authGuards";
import { commitFairnessMonths } from "@/app/utils/fairnessMonthCommit";
import { serviceError } from "@/app/utils/serviceMutation";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";

function reject(res: { status: number; body: unknown }) {
  return NextResponse.json(res.body, { status: res.status });
}

/**
 * `PUT /api/admin/fairness/months` — record 1–2 consecutive months of the fairness
 * ledger's monthly eligibility record (solver v3 C2 WR-1 … WR-17; body IF2-4, answers
 * IF2-5, refusals IF2-6). Under engine v2 it answers `409 engine_not_v3` and writes
 * nothing — and the effective engine is v2 everywhere until C7's flip, or until Frank
 * sets `OWT_SOLVER_ENGINE` for a Preview rehearsal (docs/SECRETS.md).
 *
 * This handler authorizes (admin and super-admin; content-editor refused — the
 * `solver-config` gate) and parses JSON only. Everything after that is
 * `commitFairnessMonths` (`app/utils/fairnessMonthCommit.ts`, ADR-0043), whose outcome's
 * `body` and `status` are sent as-is. It always writes as actor `route`; it can neither
 * reconstruct nor delete. `recordedBy` is the session's EFFECTIVE member id — under
 * impersonation (super-admin only) the impersonated manager whose role authorized the
 * write, as `solver-config` stamps `updatedBy`.
 *
 * Wrapped in `withVerificationRunContext` because its commit module is listed in
 * `DELIVERY_CAPABLE_IMPORTS` (every `*Commit` is); it delivers nothing.
 */
export const PUT = withVerificationRunContext(putHandler);

async function putHandler(req: NextRequest) {
  const session = await requireActiveManager();
  const sanityId = session?.user.sanityId;
  if (!session || !sanityId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (session.user.role === "content-editor") return reject(serviceError("forbidden"));

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return reject(serviceError("invalid_request", { details: { issues: [{ path: "", message: "must be JSON" }] } }));
  }
  const outcome = await commitFairnessMonths(body, { recordedBy: sanityId });
  return NextResponse.json(outcome.body, { status: outcome.status });
}
````

**Find** in `app/utils/protectedReadAudit.ts`:

````ts
      "the notification sweep: claims and consumes notificationOutbox documents through writeClient while reading protected role/setlist/proposal documents through operationalClient; never mutates protected content",
    removalOwner: "permanent runtime writer (never removed — the notification sweep itself)",
  },
  {
````

**Replace with:**

````ts
      "the notification sweep: claims and consumes notificationOutbox documents through writeClient while reading protected role/setlist/proposal documents through operationalClient; never mutates protected content",
    removalOwner: "permanent runtime writer (never removed — the notification sweep itself)",
  },
  {
    file: "app/utils/fairnessMonthCommit.ts",
    operation: "module",
    reason:
      "the eligibility-record writer behind `PUT /api/admin/fairness/months` (solver v3 C2 WR-1, ADR-0043): it holds the route's domain body — the engine gate, the strict body and the server stamps — and DELEGATES every mutation to the write executor with actor `route`: create-only-by-collision, revision-asserted whole replace, the freezing-services gate (A5), all-or-nothing in one transaction, no side effects. It commits no transaction itself; it is a site through the executor rule (`PROTECTED_WRITE_EXECUTORS`), and `serviceCommitCallers.test.ts` pins its one caller",
    removalOwner: "permanent runtime writer (never removed — the eligibility record's write surface itself)",
  },
  {
````

**Regenerate** `app/utils/__tests__/__fixtures__/colour-inventory.json` (it records `filesScanned`, and this task adds a file under `app/`):

```bash
node scripts/colour-inventory.mjs
```

- [ ] **Step 4: Run them to see them pass**

Run: `git add -A && npx vitest run app/api/__tests__/fairnessMonthsRoute.test.ts app/utils/__tests__/serviceCommitCallers.test.ts app/utils/__tests__/protectedReadAudit.test.ts app/utils/__tests__/srVerificationRunContext.test.ts`
Expected: PASS — including the run-context scan (`export const PUT = withVerificationRunContext(…)`) and two executor sites in the real scan.

- [ ] **Step 5: Gates and commit**

Run: `git add -A && npx tsc --noEmit && npm test && npx eslint .`
Expected: **459 files / 8376 tests**; 0 errors, 81 warnings.

```bash
git add -A
git commit -m "feat(fairness): PUT /api/admin/fairness/months and its commit module" -m "Solver v3 C2 WR-1 to WR-13. The route authorizes (admin and super-admin; content-editor refused) and parses JSON; fairnessMonthCommit.ts holds the rest per ADR-0043: the engine gate before the body (engine_not_v3 under v2, which is every deployment until C7 or a Preview override), the strict 1-2 consecutive-month body, the server stamps (effective engine, environment, CDMX month, clock, the session's effective member id) and one call to the write executor with actor route and the canonical clients. Refusals are typed 409s whose details.detail is the earliest month's own verdict; a commit 409 is reported on every written month. The commit module joins PROTECTED_RUNTIME_WRITERS through the executor rule, DELIVERY_CAPABLE_IMPORTS (so the handler is wrapped in withVerificationRunContext) and the caller pin."
```


---
## Task 9: The ledger, the seat step, X1 and the one formatter — [standard; the fixture in Task 10 is its contract]

Spec LG-1–LG-17, CAD-1–CAD-3, IF2-10–IF2-13. `fairnessLedger.ts` is the only TypeScript definition of F2–F7 and X1:

- **Seat step (IF2-11, LG-1/LG-2/LG-4)** — canonical documents only; every stored date through `serviceDayKey`; every copy of a weekend type on one date dropped and reported (`indexUniqueByKey`, the history's rule); uncounted services out (`countsForFairness(doc)`); a special by day class through Sakamoto's civil weekday (never a `Date`); one kept seat per person per service (Lead > BGV > Choir), every further one a second seat.
- **Per recorded month (LG-5–LG-11)** — presence at weekend services only, its seat chosen by role class then holder id and never a fixed seat; the normal populations with (iv)–(vii); set-asides in LG-9's order; the floor seat on the pre-floor values (only an `exact` or `cadence` seat cancels it; date, role class, `compareServiceTime`, `_id`); then shares as BigInt rationals.
- **Output (IF2-8's shapes)** — each figure rounded once to hundredths (`balance = share − received`) and once to tenths from the exact value; tabs fold every `P:*` into BGV; notes from the closed set; `countedSundayLeads`, `firstRecordedIn`, diagnostics (`unknownMembers` per IF2-8).

`fairnessLedgerExactSums` exposes the exact per-(service, role key) and per-(rule, service) sums for the tests. `fairnessFormat.ts` writes a tenths figure with one decimal and the saldo in words; a sweep refuses any code under `app/` that divides a share, balance or received figure by 10 or 100.

**Files:**
- Create: `app/utils/fairnessLedger.ts`, `app/utils/fairnessFormat.ts`
- Test: `app/utils/__tests__/fairnessLedger.test.ts`, `app/utils/__tests__/fairnessFormat.test.ts`
- Regenerate: `app/utils/__tests__/__fixtures__/colour-inventory.json`

**Interfaces:**
- Consumes: Task 1's vocabulary; `countsForFairness` (C1); `indexUniqueByKey`, `serviceDayKey`; `compareServiceTime`; `historyWindow` (`solverHistory.ts`, neutral).
- Produces: `interface LedgerService`, `interface LedgerInput` (IF2-10); `type VoiceSeat`; `civilDayOfWeek(date): number`; `keepVoiceSeats(services): { kept; secondSeats; duplicateTargets }` (IF2-11); `type CadenceReason`; `cadenceStates(input): Array<{ month; state: "on" | "off"; reason }>` (IF2-12; throws `RangeError` outside 1–2 months); `computeFairnessLedger(input): Pick<FairnessLedgerResponse, "window" | "recordsSince" | "people" | "diagnostics">`; `fairnessLedgerExactSums(input): Array<{ month; serviceId; key; numerator: string; denominator: string }>`; `formatFairnessTenths(tenths): string`, `saldoWords(balanceTenths): string` (IF2-13).

- [ ] **Step 1: Write the failing tests**

**Create** `app/utils/__tests__/fairnessLedger.test.ts`:

````ts
// Solver v3 C2 — the ledger's own unit tests: the record-free seat step (IF2-11), the
// weekday formula, X1 (IF2-12), and the ledger properties the golden fixture cannot
// carry (FX-2 keeps hundredths only): display tenths rounded from the EXACT value, an
// invalid stored `time` read as absent, the cumulative span (C2 review log: IF2-29 has
// no cumulative field, so it is asserted here), names and diagnostics, input-order
// independence and exact sum-to-zero. The golden fixture's cases run in
// `fairnessGolden.test.ts`. Every name is fictitious.
import { describe, expect, it } from "vitest";

import {
  cadenceStates,
  civilDayOfWeek,
  computeFairnessLedger,
  fairnessLedgerExactSums,
  keepVoiceSeats,
  type LedgerInput,
  type LedgerService,
} from "../fairnessLedger";
import { formatFairnessTenths } from "../fairnessFormat";
import type { LogicalRecord, RoleKey, Status } from "../fairnessVocabulary";

const OUT: Record<RoleKey, Status> = {
  "Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "out", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out",
};
type PersonPatch = Partial<Omit<LogicalRecord["people"][number], "roles">> & { roles?: Partial<Record<RoleKey, Status>> };
const person = (memberId: string, patch: PersonPatch = {}): LogicalRecord["people"][number] => ({
  memberId,
  name: memberId,
  exactRules: [],
  exempt: false,
  blocks: [],
  ...patch,
  roles: { ...OUT, ...(patch.roles ?? {}) },
});
const record = (month: string, people: LogicalRecord["people"], presence: LogicalRecord["presence"] = []): LogicalRecord => ({
  month,
  rev: `rev-${month}`,
  contentHash: "sha256:fixture",
  source: "auto",
  engine: "v3",
  environment: "production",
  recordedAt: `${month}-28T12:00:00.000Z`,
  people,
  presence,
});
const service = (_id: string, _type: LedgerService["_type"], date: string, seats: Partial<LedgerService> = {}): LedgerService => ({
  _id,
  _type,
  date,
  Lead: [],
  BGVs: [],
  Chorus: [],
  ...seats,
});

describe("keepVoiceSeats (C2 IF2-11: LG-1, LG-2, LG-4)", () => {
  const services: LedgerService[] = [
    service("sun-a", "sunday_role", "2026-10-04", { Lead: ["m-alma"], BGVs: ["m-bruno", "m-alma"], Chorus: ["m-carmen", "m-carmen"] }),
    service("drafts.sun-b", "sunday_role", "2026-10-11", { Lead: ["m-diego"] }),
    service("sat-dup-1", "saturday_role", "2026-10-10", { Lead: ["m-elena"] }),
    service("sat-dup-2", "saturday_role", "2026-10-10T00:00:00", { Lead: ["m-fausto"] }),
    service("spc-sun", "special_role", "2026-10-18", { countsForFairness: true, Lead: ["m-greta"], Chorus: ["m-ivan"] }),
    service("spc-fri", "special_role", "2026-10-23", { countsForFairness: true, Lead: ["m-julia"], BGVs: ["m-bruno"], Chorus: ["m-alma"] }),
    service("spc-legacy", "special_role", "2026-10-24", { Lead: ["m-diego"] }),
    service("sun-off", "sunday_role", "2026-10-25", { countsForFairness: false, Lead: ["m-diego"] }),
    service("sat-legacy", "saturday_role", "2026-10-31", { BGVs: ["", "m-elena"] }),
  ];

  it("keeps one seat per person per service, maps specials by day class, and reports the rest", () => {
    const out = keepVoiceSeats(services);
    expect(out.kept).toEqual([
      { serviceId: "sun-a", date: "2026-10-04", roleKey: "Sun.Lead", memberId: "m-alma" },
      { serviceId: "sun-a", date: "2026-10-04", roleKey: "Sun.BGV", memberId: "m-bruno" },
      { serviceId: "sun-a", date: "2026-10-04", roleKey: "Sun.Choir", memberId: "m-carmen" },
      { serviceId: "spc-sun", date: "2026-10-18", roleKey: "Sun.Lead", memberId: "m-greta" },
      { serviceId: "spc-sun", date: "2026-10-18", roleKey: "Sun.Choir", memberId: "m-ivan" },
      { serviceId: "spc-fri", date: "2026-10-23", roleKey: "Sat.Lead", memberId: "m-julia" },
      { serviceId: "spc-fri", date: "2026-10-23", roleKey: "Sat.BGV", memberId: "m-bruno" },
      { serviceId: "spc-fri", date: "2026-10-23", roleKey: "Sat.Choir", memberId: "m-alma" },
      { serviceId: "sat-legacy", date: "2026-10-31", roleKey: "Sat.BGV", memberId: "m-elena" },
    ]);
    expect(out.secondSeats).toEqual([
      { serviceId: "sun-a", date: "2026-10-04", roleKey: "Sun.BGV", memberId: "m-alma" },
      { serviceId: "sun-a", date: "2026-10-04", roleKey: "Sun.Choir", memberId: "m-carmen" },
    ]);
    expect(out.duplicateTargets).toEqual([{ type: "saturday_role", date: "2026-10-10", roleIds: ["sat-dup-1", "sat-dup-2"] }]);
  });

  it("is independent of input order", () => {
    expect(keepVoiceSeats([...services].reverse())).toEqual(keepVoiceSeats(services));
  });
});

describe("civilDayOfWeek (LG-4, LG-16)", () => {
  it("agrees with the calendar on every day of 2024 (leap) and 2026", () => {
    for (const year of [2024, 2026]) {
      for (let day = new Date(Date.UTC(year, 0, 1)); day.getUTCFullYear() === year; day.setUTCDate(day.getUTCDate() + 1)) {
        const iso = day.toISOString().slice(0, 10);
        expect(civilDayOfWeek(iso), iso).toBe(day.getUTCDay());
      }
    }
  });
});

describe("cadenceStates (C2 IF2-12, CAD-1)", () => {
  const month = (m: string, eligible = true, availableCountedSundays = 4) => ({ month: m, eligible, availableCountedSundays });

  it("names each reason, month 1 from the facts", () => {
    expect(cadenceStates({ ledCountedSundayPreviousMonth: false, months: [month("2026-11")] })).toEqual([
      { month: "2026-11", state: "on", reason: "on" },
    ]);
    expect(cadenceStates({ ledCountedSundayPreviousMonth: true, months: [month("2026-11")] })[0].reason).toBe("led_previous_month");
    expect(cadenceStates({ ledCountedSundayPreviousMonth: true, months: [month("2026-11", false)] })[0].reason).toBe("not_eligible");
    expect(cadenceStates({ ledCountedSundayPreviousMonth: false, months: [month("2026-11", true, 0)] })[0].reason).toBe(
      "no_available_sunday",
    );
  });

  it("month 2 assumes month 1 followed its own state", () => {
    expect(cadenceStates({ ledCountedSundayPreviousMonth: false, months: [month("2026-11"), month("2026-12")] })).toEqual([
      { month: "2026-11", state: "on", reason: "on" },
      { month: "2026-12", state: "off", reason: "assumed_led_previous_month" },
    ]);
    expect(cadenceStates({ ledCountedSundayPreviousMonth: true, months: [month("2026-11"), month("2026-12")] })).toEqual([
      { month: "2026-11", state: "off", reason: "led_previous_month" },
      { month: "2026-12", state: "on", reason: "on" },
    ]);
  });

  it("takes 1 or 2 months only", () => {
    expect(() => cadenceStates({ ledCountedSundayPreviousMonth: false, months: [] })).toThrow(RangeError);
  });
});

describe("computeFairnessLedger — properties outside the fixture", () => {
  it("rounds the display tenths once from the EXACT value, never from the hundredths (LG-13, A17)", () => {
    // Carmen's exact BGV share is 1/5 + 1/21 = 26/105 ≈ 0.2476: 25 hundredths, but 2 tenths —
    // tenths taken from the hundredths would show «0.3».
    const ids = Array.from({ length: 21 }, (_, i) => `m-${String(i).padStart(2, "0")}`);
    const people = ids.map((id) =>
      person(id, {
        roles: { "Sun.BGV": "in" },
        exempt: id === "m-00",
        blocks: Number(id.slice(2)) >= 5 ? [{ date: "2026-10-04", unavailable: true, excludedRoles: [] }] : [],
      }),
    );
    const out = computeFairnessLedger({
      target: "2026-11",
      records: [record("2026-10", people)],
      services: [
        service("s1", "sunday_role", "2026-10-04", { BGVs: ["m-00"] }),
        service("s2", "sunday_role", "2026-10-11", { BGVs: ["m-00"] }),
      ],
      members: [],
    });
    const carmen = out.people.find((p) => p.memberId === "m-01")!;
    expect(carmen.window.BGV).toEqual({ share: 25, received: 0, balance: 25, seats: 0, tenths: { share: 2, balance: 2 } });
    expect(formatFairnessTenths(carmen.window.BGV!.tenths.share)).toBe("0.2");
  });

  it("reads an invalid stored time as absent at the floor's time tie (LG-11, vitest-only per FX-4)", () => {
    // Two counted Friday specials on one date; Alma leads both. «7pm» is not a service time,
    // so it sorts after «19:00»: the timed special's seat is her floor seat, though its id is later.
    const people = ["m-alma", "m-bruno", "m-carmen", "m-diego"].map((id) => person(id, { roles: { "Sat.Lead": "in" } }));
    const out = computeFairnessLedger({
      target: "2026-11",
      records: [record("2026-10", people)],
      services: [
        service("spc-a", "special_role", "2026-10-09", { countsForFairness: true, time: "7pm", Lead: ["m-alma"] }),
        service("spc-b", "special_role", "2026-10-09", { countsForFairness: true, time: "19:00", Lead: ["m-alma"] }),
      ],
      members: [],
    });
    const alma = out.people.find((p) => p.memberId === "m-alma")!;
    expect(alma.months[2].setAsides).toEqual([{ date: "2026-10-09", serviceId: "spc-b", roleKey: "Sat.Lead", reason: "floor" }]);
  });

  it("lists one countedSundayLeads entry per counted Sunday-dated Lead seat, repeating a date (RD-3, S-4)", () => {
    const out = computeFairnessLedger({
      target: "2026-11",
      records: [],
      services: [
        service("sun-1", "sunday_role", "2026-10-04", { Lead: ["m-alma", "m-alma"] }),
        service("spc-1", "special_role", "2026-10-04", { countsForFairness: true, Lead: ["m-alma"] }),
        service("spc-2", "special_role", "2026-10-11", { Lead: ["m-alma"] }),
      ],
      members: [],
    });
    expect(out.people.find((p) => p.memberId === "m-alma")!.countedSundayLeads).toEqual(["2026-10-04", "2026-10-04"]);
  });

  it("names deleted members from the latest record, else empty, and lists them as unknown (IF2-8)", () => {
    const out = computeFairnessLedger({
      target: "2026-11",
      records: [record("2026-09", [person("m-gone", { name: "Elena Vieja" })]), record("2026-10", [person("m-gone", { name: "Elena" })])],
      services: [service("sun-1", "sunday_role", "2026-10-04", { Chorus: ["m-ghost", "m-here"] })],
      members: [{ id: "m-here", name: "Fausto", unavailableDates: [] }],
    });
    expect(out.people.map((p) => [p.memberId, p.name, p.exists])).toEqual([
      ["m-ghost", "", false],
      ["m-gone", "Elena", false],
      ["m-here", "Fausto", true],
    ]);
    expect(out.diagnostics.unknownMembers).toEqual(["m-ghost", "m-gone"]);
    expect(out.diagnostics.notInRecordSeats).toBe(2);
  });

  // Each recorded month: two Sunday services, 2 BGV seats each among Alma, Bruno and Carmen
  // (shares 4/3 each, no floor). Alma sits both Sundays, Bruno and Carmen one each.
  function monthly(month: string): { rec: LogicalRecord; services: LedgerService[] } {
    return {
      rec: record(month, ["m-alma", "m-bruno", "m-carmen"].map((id) => person(id, { roles: { "Sun.BGV": "in" } }))),
      services: [
        service(`${month}-s1`, "sunday_role", `${month}-07`, { BGVs: ["m-alma", "m-bruno"] }),
        service(`${month}-s2`, "sunday_role", `${month}-14`, { BGVs: ["m-alma", "m-carmen"] }),
      ],
    };
  }
  const SPAN: LedgerInput = (() => {
    const months = ["2026-05", "2026-06", "2026-07", "2026-08"].map(monthly);
    return { target: "2026-09", records: months.map((m) => m.rec), services: months.flatMap((m) => m.services), members: [] };
  })();

  it("sums the cumulative span from the earliest record, longer than the window (X4, LG-12)", () => {
    const out = computeFairnessLedger(SPAN);
    expect(out.recordsSince).toBe("2026-05");
    expect(out.window.map((w) => [w.month, w.record?.rev ?? null])).toEqual([
      ["2026-06", "rev-2026-06"],
      ["2026-07", "rev-2026-07"],
      ["2026-08", "rev-2026-08"],
    ]);
    const alma = out.people.find((p) => p.memberId === "m-alma")!;
    // Window: 3 × 4/3 = 4 → 400; 6 seats. Cumulative: 4 × 4/3 = 16/3 → 533; 8 seats; −8/3 → −27 tenths.
    expect(alma.window.BGV).toEqual({ share: 400, received: 600, balance: -200, seats: 6, tenths: { share: 40, balance: -20 } });
    expect(alma.cumulative.BGV).toEqual({ share: 533, received: 800, balance: -267, seats: 8, tenths: { share: 53, balance: -27 } });
    expect(alma.tabs.cumulative.TOTAL).toEqual(alma.cumulative.BGV);
    expect(alma.sang).toBe(6);
  });

  it("is independent of input order (LG-16)", () => {
    const reversed: LedgerInput = {
      ...SPAN,
      records: [...SPAN.records].reverse().map((r) => ({ ...r, people: [...r.people].reverse() })),
      services: [...SPAN.services].reverse(),
    };
    expect(computeFairnessLedger(reversed)).toEqual(computeFairnessLedger(SPAN));
  });

  it("sums to exactly zero per (service, role key) on exact values (LG-10)", () => {
    const sums = fairnessLedgerExactSums(SPAN);
    expect(sums.length).toBe(4 * 2 * 3);
    for (const s of sums) expect(s.numerator, `${s.serviceId} ${s.key}`).toBe("0");
  });
});
````

**Create** `app/utils/__tests__/fairnessFormat.test.ts`:

````ts
// Solver v3 C2 IF2-13 — the one fairness-figure formatter, and the guard that nothing
// under app/** derives a display figure from the wire's hundredths (UI-4, A17).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { stripComments } from "../../../scripts/lib/strip-comments.mjs";
import { formatFairnessTenths, saldoWords } from "../fairnessFormat";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("formatFairnessTenths (C2 IF2-13)", () => {
  it.each([
    [8, "0.8"],
    [-13, "-1.3"],
    [0, "0.0"],
    [10, "1.0"],
    [-5, "-0.5"],
    [127, "12.7"],
  ])("%d tenths → %s", (tenths, text) => {
    expect(formatFairnessTenths(tenths)).toBe(text);
  });
});

describe("saldoWords (C2 §8)", () => {
  it("says who is owed, who has extra, and «al día» at zero", () => {
    expect(saldoWords(7)).toBe("le deben 0.7");
    expect(saldoWords(-3)).toBe("0.3 de más");
    expect(saldoWords(-12)).toBe("1.2 de más");
    expect(saldoWords(0)).toBe("al día");
  });
});

describe("no code derives tenths or seats from the wire's hundredths (UI-4)", () => {
  it("finds no division of a share, balance or received figure by 10 or 100 under app/**", () => {
    const files = execFileSync("git", ["ls-files", "app"], { cwd: REPO_ROOT, encoding: "utf8" })
      .split("\n")
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/(^|\/)__tests__\//.test(f) && !/\.test\./.test(f));
    const offenders = files.filter((f) => {
      const code = stripComments(readFileSync(path.join(REPO_ROOT, f), "utf8"));
      return /\b(share|balance|received)\b\s*\)?\s*\/\s*10{1,2}\b/.test(code);
    });
    expect(offenders).toEqual([]);
  });
});
````

- [ ] **Step 2: Run them to see them fail**

Run: `git add -A && npx vitest run app/utils/__tests__/fairnessLedger.test.ts app/utils/__tests__/fairnessFormat.test.ts`
Expected: FAIL — `../fairnessLedger` and `../fairnessFormat` do not resolve.

- [ ] **Step 3: Implement**

**Create** `app/utils/fairnessLedger.ts`:

````ts
// app/utils/fairnessLedger.ts
//
// THE fairness ledger (solver v3 C2 LG-1 … LG-17, CAD-1 … CAD-3; spec IF2-10, IF2-11,
// IF2-12): the only TypeScript definition of the policy's F2–F7 and X1. Given the monthly
// eligibility records, the stored voice services and the members, it computes for every
// person and line the exact share of the seats she was owed, the seats she received and
// the balance, per month, over the 3-month window and cumulatively; and X1's cadence
// state. `fixtures/fairness/golden.json` is its contract with the v3 solver (C5), which
// computes the same formula for its plan: both suites assert the file.
//
// NEUTRAL AND DETERMINISTIC (LG-16): no "use client", no `server-only`, no Sanity client,
// no `node:crypto`, no `Date` arithmetic on service dates (the weekday is a civil-calendar
// formula on the stored string's integers), no import from a client module. Output is
// independent of input order: every list is sorted by codepoint. Identity is the member
// `_id`; names are display only.
//
// EXACT ARITHMETIC (LG-13): shares are rationals in BigInt — nothing floating
// accumulates. Each wire figure is rounded ONCE to hundredths (half away from zero) and
// the wire balance is DEFINED as `share − received` in hundredths; each display tenth is
// rounded once from the same exact value, never from the hundredths.

import { countsForFairness } from "./countsForFairness";
import {
  ROLE_CLASS_ORDER,
  ROLE_KEYS,
  ROLE_LINE,
  SATURDAY_KEYS,
  SUNDAY_KEYS,
  compareCodepoint,
  monthIndex,
  roleClassOf,
  tabOfLine,
  type FairnessLedgerResponse,
  type FairnessPerson,
  type FairnessPersonMonth,
  type Figures,
  type LineKey,
  type LogicalRecord,
  type Note,
  type RecordSummary,
  type RoleKey,
  type SetAsideReason,
  type Status,
  type TabKey,
  NOTE_CODES,
} from "./fairnessVocabulary";
import { indexUniqueByKey, serviceDayKey } from "./serviceReadSelect";
import { compareServiceTime } from "./serviceTime";
import { historyWindow } from "./solverHistory";

// ─── Inputs (IF2-10) ─────────────────────────────────────────────────────────

export interface LedgerService {
  _id: string;
  _type: "sunday_role" | "saturday_role" | "special_role";
  /** The stored date: `week` on a weekend role, `date` on a special. */
  date: string;
  /** Raw stored field, unvalidated; LG-11 orders it only through `compareServiceTime`. */
  time?: string;
  published?: boolean;
  /** Raw field; the ledger applies `countsForFairness(doc)`. */
  countsForFairness?: boolean;
  /** Member ids (non-empty `_ref`s), stored order. */
  Lead: string[];
  BGVs: string[];
  Chorus: string[];
}

export interface LedgerInput {
  target: string;
  records: LogicalRecord[];
  services: LedgerService[];
  members: Array<{ id: string; name: string; unavailableDates: string[] }>;
}

// ─── Exact rationals ─────────────────────────────────────────────────────────

interface Q {
  n: bigint;
  d: bigint;
}

const B0 = BigInt(0);
const B1 = BigInt(1);
const B2 = BigInt(2);
const ZERO: Q = { n: B0, d: B1 };

function gcd(a: bigint, b: bigint): bigint {
  let x = a < B0 ? -a : a;
  let y = b < B0 ? -b : b;
  while (y !== B0) [x, y] = [y, x % y];
  return x === B0 ? B1 : x;
}

function norm(n: bigint, d: bigint): Q {
  if (d < B0) [n, d] = [-n, -d];
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}

const frac = (num: number, den: number): Q => norm(BigInt(num), BigInt(den));
const add = (a: Q, b: Q): Q => norm(a.n * b.d + b.n * a.d, a.d * b.d);
const subInt = (a: Q, k: number): Q => norm(a.n - BigInt(k) * a.d, a.d);
const lessThanOne = (a: Q) => a.n < a.d;

/** sign(x) · ⌊|x| · units + ½⌋ — half away from zero, from the exact value (LG-13). */
function roundTo(x: Q, units: number): number {
  const abs = x.n < B0 ? -x.n : x.n;
  const r = (B2 * abs * BigInt(units) + x.d) / (B2 * x.d);
  return Number(x.n < B0 ? -r : r);
}

/** A line's or tab's figures from its exact share and its received seat count. */
function figures(share: Q, seats: number): Figures {
  const shareH = roundTo(share, 100);
  const received = 100 * seats;
  return {
    share: shareH,
    received,
    balance: shareH - received,
    seats,
    tenths: { share: roundTo(share, 10), balance: roundTo(subInt(share, seats), 10) },
  };
}

// ─── The seat-keeping step (IF2-11; LG-1, LG-2, LG-4) ───────────────────────

export type VoiceSeat = { serviceId: string; date: string; roleKey: RoleKey; memberId: string };

/** 0 = Sunday … 6 = Saturday, by Sakamoto's civil-calendar formula — never a `Date` (LG-16). */
export function civilDayOfWeek(date: string): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const offsets = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const y = month < 3 ? year - 1 : year;
  return (y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + offsets[month - 1] + day) % 7;
}

interface CountedService {
  id: string;
  type: LedgerService["_type"];
  date: string;
  time: unknown;
  sunday: boolean;
  weekend: boolean;
}

const SEAT_FIELDS: ReadonlyArray<[keyof Pick<LedgerService, "Lead" | "BGVs" | "Chorus">, "Lead" | "BGV" | "Choir"]> = [
  ["Lead", "Lead"],
  ["BGVs", "BGV"],
  ["Chorus", "Choir"],
];

function compareSeats(a: VoiceSeat, b: VoiceSeat): number {
  return (
    compareCodepoint(a.date, b.date) ||
    compareCodepoint(a.serviceId, b.serviceId) ||
    ROLE_KEYS.indexOf(a.roleKey) - ROLE_KEYS.indexOf(b.roleKey) ||
    compareCodepoint(a.memberId, b.memberId)
  );
}

function seatStep(services: readonly LedgerService[]) {
  const canonical: Array<{ s: LedgerService; day: string }> = [];
  for (const s of services) {
    if (!s || typeof s._id !== "string" || s._id.startsWith("drafts.")) continue;
    if (s._type !== "sunday_role" && s._type !== "saturday_role" && s._type !== "special_role") continue;
    const day = serviceDayKey(s.date);
    if (!day) continue;
    canonical.push({ s, day });
  }

  // LG-1 — every copy of a weekend type on one stored date is dropped, by the
  // read model's own rule (`indexUniqueByKey`); several specials on a date are separate.
  const targetKey = (x: { s: LedgerService; day: string }) => `${x.s._type}:${x.day}`;
  const weekend = canonical.filter((x) => x.s._type !== "special_role");
  const unique = indexUniqueByKey(weekend, targetKey);
  const duplicates = new Map<string, { type: string; date: string; roleIds: string[] }>();
  for (const x of weekend) {
    const key = targetKey(x);
    if (unique.has(key)) continue;
    const found = duplicates.get(key);
    if (found) found.roleIds.push(x.s._id);
    else duplicates.set(key, { type: x.s._type, date: x.day, roleIds: [x.s._id] });
  }

  const kept: VoiceSeat[] = [];
  const secondSeats: VoiceSeat[] = [];
  const counted: CountedService[] = [];
  for (const x of canonical) {
    if (x.s._type !== "special_role" && unique.get(targetKey(x)) !== x) continue;
    if (!countsForFairness(x.s)) continue; // LG-2
    const sunday = x.s._type === "sunday_role" || (x.s._type === "special_role" && civilDayOfWeek(x.day) === 0);
    counted.push({ id: x.s._id, type: x.s._type, date: x.day, time: x.s.time, sunday, weekend: x.s._type !== "special_role" });
    const keys = sunday ? SUNDAY_KEYS : SATURDAY_KEYS;
    const held = new Set<string>();
    for (const [field, cls] of SEAT_FIELDS) {
      const roleKey = keys[ROLE_CLASS_ORDER.indexOf(cls)];
      for (const memberId of Array.isArray(x.s[field]) ? x.s[field] : []) {
        if (typeof memberId !== "string" || memberId === "") continue;
        const seat = { serviceId: x.s._id, date: x.day, roleKey, memberId };
        // LG-4: one seat per person per service — the first in Lead > BGV > Choir.
        (held.has(memberId) ? secondSeats : kept).push(seat);
        held.add(memberId);
      }
    }
  }
  kept.sort(compareSeats);
  secondSeats.sort(compareSeats);
  counted.sort((a, b) => compareCodepoint(a.date, b.date) || compareCodepoint(a.id, b.id));
  const duplicateTargets = [...duplicates.values()]
    .map((d) => ({ ...d, roleIds: [...d.roleIds].sort(compareCodepoint) }))
    .sort((a, b) => compareCodepoint(a.type, b.type) || compareCodepoint(a.date, b.date));
  return { kept, secondSeats, duplicateTargets, counted };
}

/**
 * IF2-11 — the record-free seat step: LG-1 (duplicate weekend targets dropped whole and
 * reported), LG-2 (uncounted services contribute nothing) and LG-4 (role key by seat
 * array and, at a special, by day class; one kept seat per person per service; every
 * further seat of hers there a second seat). The ledger runs exactly this; C4 runs it for
 * its join months; C6's ST-6 test compares its sent seat against it.
 */
export function keepVoiceSeats(services: LedgerService[]): {
  kept: VoiceSeat[];
  secondSeats: VoiceSeat[];
  duplicateTargets: Array<{ type: string; date: string; roleIds: string[] }>;
} {
  const { kept, secondSeats, duplicateTargets } = seatStep(services);
  return { kept, secondSeats, duplicateTargets };
}

// ─── X1 (IF2-12; CAD-1) ──────────────────────────────────────────────────────

export type CadenceReason = "on" | "not_eligible" | "led_previous_month" | "assumed_led_previous_month" | "no_available_sunday";

/**
 * X1 for one cadence member over 1–2 consecutive months. Month 1 follows the facts;
 * month 2 assumes month 1 followed its own state. The wire's `out` is exactly the reason
 * `not_eligible`, every other «off» is `off` — that mapping is the caller's (A14).
 */
export function cadenceStates(input: {
  ledCountedSundayPreviousMonth: boolean;
  months: Array<{ month: string; eligible: boolean; availableCountedSundays: number }>;
}): Array<{ month: string; state: "on" | "off"; reason: CadenceReason }> {
  if (input.months.length < 1 || input.months.length > 2) throw new RangeError("cadenceStates: 1 or 2 months");
  let ledPrevious = input.ledCountedSundayPreviousMonth;
  return input.months.map((m, i) => {
    let reason: CadenceReason;
    if (!m.eligible) reason = "not_eligible";
    else if (ledPrevious) reason = i === 0 ? "led_previous_month" : "assumed_led_previous_month";
    else if (m.availableCountedSundays <= 0) reason = "no_available_sunday";
    else reason = "on";
    const state = reason === "on" ? "on" : "off";
    ledPrevious = state === "on";
    return { month: m.month, state, reason };
  });
}

// ─── One recorded month (LG-5 … LG-11, LG-15, LG-17) ─────────────────────────

type Person = LogicalRecord["people"][number];

interface SetAside {
  date: string;
  serviceId: string;
  roleKey: RoleKey;
  memberId: string;
  reason: SetAsideReason;
  line: LineKey;
}

interface MonthResult {
  share: Map<string, Map<LineKey, Q>>;
  received: Map<string, Map<LineKey, number>>;
  inPopulation: Map<string, Set<LineKey>>;
  setAsides: SetAside[];
  notes: Map<string, Note[]>;
  zeroChecks: Array<{ serviceId: string; key: string; sum: Q }>;
}

function bump<K>(map: Map<string, Map<K, Q>>, id: string, key: K, value: Q) {
  const inner = map.get(id) ?? new Map<K, Q>();
  inner.set(key, add(inner.get(key) ?? ZERO, value));
  map.set(id, inner);
}

function count<K>(map: Map<string, Map<K, number>>, id: string, key: K, by = 1) {
  const inner = map.get(id) ?? new Map<K, number>();
  inner.set(key, (inner.get(key) ?? 0) + by);
  map.set(id, inner);
}

function computeMonth(
  record: LogicalRecord,
  services: CountedService[],
  kept: VoiceSeat[],
  second: VoiceSeat[],
  liveUnavailable: ReadonlyMap<string, ReadonlySet<string>>,
): MonthResult {
  const people = new Map<string, Person>(record.people.map((p) => [p.memberId, p]));
  const status = (id: string, k: RoleKey): Status => people.get(id)?.roles[k] ?? "out";
  const cadence = (id: string) => people.get(id)?.sundayCadence === "alternate";
  const unavailable = (id: string, date: string) =>
    (people.get(id)?.blocks ?? []).some((b) => b.date === date && b.unavailable) ||
    (liveUnavailable.get(id)?.has(date) ?? false);
  const ruleExcluded = (id: string, k: RoleKey, s: CountedService) =>
    s.weekend && (people.get(id)?.blocks ?? []).some((b) => b.date === s.date && b.excludedRoles.includes(k));
  const isFixed = (seat: VoiceSeat) =>
    status(seat.memberId, seat.roleKey) === "exact" || (ROLE_LINE[seat.roleKey] === "DL" && cadence(seat.memberId));
  const rules = [...record.presence].sort((a, b) => compareCodepoint(a.ruleKey, b.ruleKey));
  const listed = [...people.keys()].sort(compareCodepoint);

  const result: MonthResult = {
    share: new Map(),
    received: new Map(),
    inPopulation: new Map(),
    setAsides: [],
    notes: new Map(),
    zeroChecks: [],
  };
  const enter = (id: string, line: LineKey) => {
    const set = result.inPopulation.get(id) ?? new Set<LineKey>();
    set.add(line);
    result.inPopulation.set(id, set);
  };

  // Per-service structure, before the floor (LG-7 … LG-10).
  interface Slot {
    s: CountedService;
    key: RoleKey | `P:${string}`;
    line: LineKey;
    population: string[];
    /** Seats counted in this slot (class 3, or the counted presence seat). */
    counted: VoiceSeat[];
  }
  const slots: Slot[] = [];
  const fixedHolders = new Set<string>();
  const outsideSeats: SetAside[] = [];

  for (const s of services) {
    const keys = s.sunday ? SUNDAY_KEYS : SATURDAY_KEYS;
    const seatsHere = kept.filter((x) => x.serviceId === s.id);
    for (const x of second.filter((y) => y.serviceId === s.id)) {
      result.setAsides.push({ ...x, reason: "second_seat", line: ROLE_LINE[x.roleKey] });
    }

    // LG-7 — presence, weekend services only.
    const applying: Array<{ ruleKey: string; members: string[]; exclusive: boolean; A: RoleKey[]; Q: string[] }> = [];
    if (s.weekend) {
      for (const rule of rules) {
        const A = keys.filter((k) => rule.roles.includes(k));
        if (A.length === 0) continue;
        const Q = [...rule.members]
          .sort(compareCodepoint)
          .filter((id) => A.some((k) => status(id, k) === "in" && !unavailable(id, s.date) && !ruleExcluded(id, k, s)));
        applying.push({ ruleKey: rule.ruleKey, members: rule.members, exclusive: rule.exclusive, A, Q });
      }
    }
    const usedAsPresence = new Set<VoiceSeat>();
    const presenceSeat = new Map<string, { seat: VoiceSeat; counted: boolean }>();
    for (const rule of applying) {
      const candidate = seatsHere
        .filter((x) => rule.A.includes(x.roleKey) && rule.members.includes(x.memberId) && !isFixed(x) && !usedAsPresence.has(x))
        .sort(
          (a, b) =>
            ROLE_CLASS_ORDER.indexOf(roleClassOf(a.roleKey)) - ROLE_CLASS_ORDER.indexOf(roleClassOf(b.roleKey)) ||
            compareCodepoint(a.memberId, b.memberId),
        )[0];
      if (!candidate) continue;
      usedAsPresence.add(candidate);
      const counts = rule.Q.includes(candidate.memberId);
      presenceSeat.set(rule.ruleKey, { seat: candidate, counted: counts });
      if (!counts) outsideSeats.push({ ...candidate, reason: "outside_population", line: `P:${rule.ruleKey}` });
    }

    // LG-8 — the normal populations.
    const soleInQ = new Set(applying.filter((r) => r.Q.length === 1).map((r) => r.Q[0]));
    const population = (k: RoleKey) =>
      listed.filter((id) => {
        if (status(id, k) !== "in") return false;
        if (unavailable(id, s.date) || ruleExcluded(id, k, s)) return false;
        if (ROLE_LINE[k] === "DL" && cadence(id)) return false;
        if (applying.some((r) => r.exclusive && r.A.includes(k) && r.members.includes(id))) return false;
        if (soleInQ.has(id)) return false;
        return !seatsHere.some((x) => x.memberId === id && x.roleKey !== k && status(id, x.roleKey) === "exact");
      });

    // LG-9 — set-asides of the remaining seats; LG-10 — the normal seats.
    for (const k of keys) {
      const P = population(k);
      const normal: VoiceSeat[] = [];
      for (const seat of seatsHere.filter((x) => x.roleKey === k && !usedAsPresence.has(x))) {
        let reason: SetAsideReason | null = null;
        if (status(seat.memberId, k) === "exact") reason = "exact";
        else if (ROLE_LINE[k] === "DL" && cadence(seat.memberId)) reason = "cadence";
        else if (!people.has(seat.memberId)) reason = "not_in_record";
        else if (!P.includes(seat.memberId)) reason = "outside_population";
        if (reason === null) normal.push(seat);
        else {
          result.setAsides.push({ ...seat, reason, line: ROLE_LINE[k] });
          if (reason === "exact" || reason === "cadence") fixedHolders.add(seat.memberId);
        }
      }
      for (const id of P) enter(id, ROLE_LINE[k]);
      slots.push({ s, key: k, line: ROLE_LINE[k], population: P, counted: normal });
    }
    for (const rule of applying) {
      const line: LineKey = `P:${rule.ruleKey}`;
      for (const id of rule.Q) enter(id, line);
      const pi = presenceSeat.get(rule.ruleKey);
      slots.push({ s, key: line, line, population: rule.Q, counted: pi?.counted ? [pi.seat] : [] });
    }
  }
  result.setAsides.push(...outsideSeats);

  // LG-11 — the floor seat, on the values before any floor set-aside.
  const preShare = new Map<string, Q>();
  const preReceived = new Map<string, VoiceSeat[]>();
  for (const slot of slots) {
    if (slot.population.length > 0) {
      const each = frac(slot.counted.length, slot.population.length);
      for (const id of slot.population) preShare.set(id, add(preShare.get(id) ?? ZERO, each));
    }
    for (const seat of slot.counted) preReceived.set(seat.memberId, [...(preReceived.get(seat.memberId) ?? []), seat]);
  }
  const floorSeats = new Set<VoiceSeat>();
  for (const id of listed) {
    const person = people.get(id)!;
    if (person.exempt || fixedHolders.has(id)) continue;
    if (!result.inPopulation.has(id)) continue;
    if (!lessThanOne(preShare.get(id) ?? ZERO)) continue;
    const received = preReceived.get(id) ?? [];
    if (received.length === 0) continue;
    const time = (seat: VoiceSeat) => services.find((s) => s.id === seat.serviceId)?.time as string | undefined;
    const [first] = [...received].sort(
      (a, b) =>
        compareCodepoint(a.date, b.date) ||
        ROLE_CLASS_ORDER.indexOf(roleClassOf(a.roleKey)) - ROLE_CLASS_ORDER.indexOf(roleClassOf(b.roleKey)) ||
        compareServiceTime(time(a), time(b)) ||
        compareCodepoint(a.serviceId, b.serviceId),
    );
    floorSeats.add(first);
  }

  // Final shares and receipts, the floor seats set aside together (populations unchanged).
  for (const slot of slots) {
    const counted = slot.counted.filter((seat) => !floorSeats.has(seat));
    for (const seat of slot.counted.filter((x) => floorSeats.has(x))) {
      result.setAsides.push({ ...seat, reason: "floor", line: slot.line });
    }
    let sum = ZERO;
    if (slot.population.length > 0) {
      const each = frac(counted.length, slot.population.length);
      for (const id of slot.population) {
        bump(result.share, id, slot.line, each);
        sum = add(sum, each);
      }
    }
    for (const seat of counted) {
      count(result.received, seat.memberId, slot.line);
      sum = subInt(sum, 1);
    }
    result.zeroChecks.push({ serviceId: slot.s.id, key: slot.key, sum });
  }

  result.notes = monthNotes({ record, services, kept, people, status, cadence, unavailable, ruleExcluded, setAsides: result.setAsides });
  return result;
}

// ─── Notes (LG-15, LG-17) ────────────────────────────────────────────────────

function monthNotes(ctx: {
  record: LogicalRecord;
  services: CountedService[];
  kept: VoiceSeat[];
  people: Map<string, Person>;
  status: (id: string, k: RoleKey) => Status;
  cadence: (id: string) => boolean;
  unavailable: (id: string, date: string) => boolean;
  ruleExcluded: (id: string, k: RoleKey, s: CountedService) => boolean;
  setAsides: SetAside[];
}): Map<string, Note[]> {
  const out = new Map<string, Note[]>();
  const push = (id: string, note: Note) => out.set(id, [...(out.get(id) ?? []), note]);
  const uniqueSorted = (dates: string[]) => [...new Set(dates)].sort(compareCodepoint);
  const LINES: Array<{ line: "DL" | "SL" | "BGV" | "CORO"; keys: RoleKey[] }> = [
    { line: "DL", keys: ["Sun.Lead"] },
    { line: "SL", keys: ["Sat.Lead"] },
    { line: "BGV", keys: ["Sun.BGV", "Sat.BGV"] },
    { line: "CORO", keys: ["Sun.Choir", "Sat.Choir"] },
  ];

  for (const [id, person] of ctx.people) {
    for (const { line, keys } of LINES) {
      if (keys.every((k) => ctx.status(id, k) === "out")) push(id, { code: "role_out", line });
    }
    const unavailable = ctx.services.filter((s) => ctx.unavailable(id, s.date)).map((s) => s.date);
    if (unavailable.length) push(id, { code: "unavailable", dates: uniqueSorted(unavailable) });
    for (const { line, keys } of LINES) {
      const dates = ctx.services
        .filter((s) => keys.some((k) => (s.sunday ? SUNDAY_KEYS : SATURDAY_KEYS).includes(k) && ctx.status(id, k) === "in" && ctx.ruleExcluded(id, k, s)))
        .map((s) => s.date);
      if (dates.length) push(id, { code: "rule_excluded", line, dates: uniqueSorted(dates) });
    }
    for (const rule of person.exactRules) {
      push(id, { code: "exact", roles: rule.roles, count: rule.count });
      const available = ctx.services.filter((s) => {
        const keys = s.sunday ? SUNDAY_KEYS : SATURDAY_KEYS;
        return keys.some((k) => rule.roles.includes(k) && !ctx.unavailable(id, s.date) && !ctx.ruleExcluded(id, k, s));
      }).length;
      if (rule.count > available) push(id, { code: "exact_clamped", count: rule.count, available });
    }
    if (ctx.cadence(id)) {
      const sundays = ctx.kept.filter((x) => x.memberId === id && x.roleKey === "Sun.Lead");
      const saturdays = ctx.kept.filter((x) => x.memberId === id && x.roleKey === "Sat.Lead");
      if (sundays.length === 0 && saturdays.length > 0) {
        push(id, { code: "cadence_no_sunday_saturday", line: "SL", dates: uniqueSorted(saturdays.map((x) => x.date)) });
      }
    }
    for (const rule of ctx.record.presence) {
      if (rule.members.includes(id)) {
        push(id, { code: "presence", line: `P:${rule.ruleKey}`, ruleKey: rule.ruleKey, members: [...rule.members].sort(compareCodepoint) });
      }
    }
    if (person.exempt) push(id, { code: "exempt" });
  }
  // Set-aside notes, by holder and line. A holder absent from the record also gets
  // `not_listed`, which `run` gives every unlisted person of a recorded month.
  const byHolder = new Map<string, SetAside[]>();
  for (const x of ctx.setAsides) byHolder.set(x.memberId, [...(byHolder.get(x.memberId) ?? []), x]);
  for (const [id, list] of byHolder) {
    const lines = [...new Set(list.map((x) => x.line))].sort(compareCodepoint);
    for (const line of lines) {
      const of = (reason: SetAsideReason) => uniqueSorted(list.filter((x) => x.line === line && x.reason === reason).map((x) => x.date));
      if (of("cadence").length) push(id, { code: "cadence_set_aside", line, dates: of("cadence") });
      for (const x of list.filter((y) => y.line === line && y.reason === "floor")) {
        push(id, { code: "floor_seat", line, date: x.date, roleKey: x.roleKey });
      }
      if (of("outside_population").length) push(id, { code: "outside_population", line, dates: of("outside_population") });
      if (of("second_seat").length) push(id, { code: "second_seat", line, dates: of("second_seat") });
    }
  }
  for (const [id, notes] of out) out.set(id, sortNotes(notes));
  return out;
}

function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort(
    (a, b) =>
      NOTE_CODES.indexOf(a.code) - NOTE_CODES.indexOf(b.code) ||
      compareCodepoint(a.line ?? "", b.line ?? "") ||
      compareCodepoint(JSON.stringify(a), JSON.stringify(b)),
  );
}

// ─── The ledger (IF2-10) ─────────────────────────────────────────────────────

const LINE_ORDER = (line: LineKey) => (["DL", "SL", "BGV", "CORO"] as string[]).indexOf(line);
function compareLines(a: LineKey, b: LineKey): number {
  const ia = LINE_ORDER(a);
  const ib = LINE_ORDER(b);
  if (ia !== -1 || ib !== -1) return (ia === -1 ? 9 : ia) - (ib === -1 ? 9 : ib);
  return compareCodepoint(a, b);
}

function summary(record: LogicalRecord): RecordSummary {
  return { rev: record.rev, source: record.source, engine: record.engine, environment: record.environment, recordedAt: record.recordedAt };
}

function sumLines(
  months: MonthResult[],
  id: string,
): { lines: Partial<Record<LineKey, Figures>>; tabs: Partial<Record<TabKey, Figures>> } {
  const share = new Map<LineKey, Q>();
  const seats = new Map<LineKey, number>();
  const present = new Set<LineKey>();
  for (const m of months) {
    for (const line of m.inPopulation.get(id) ?? []) present.add(line);
    for (const [line, q] of m.share.get(id) ?? []) share.set(line, add(share.get(line) ?? ZERO, q));
    for (const [line, n] of m.received.get(id) ?? []) seats.set(line, (seats.get(line) ?? 0) + n);
  }
  const lines: Partial<Record<LineKey, Figures>> = {};
  const tabShare = new Map<TabKey, Q>();
  const tabSeats = new Map<TabKey, number>();
  for (const line of [...present].sort(compareLines)) {
    const q = share.get(line) ?? ZERO;
    const n = seats.get(line) ?? 0;
    lines[line] = figures(q, n);
    for (const tab of [tabOfLine(line), "TOTAL"] as TabKey[]) {
      tabShare.set(tab, add(tabShare.get(tab) ?? ZERO, q));
      tabSeats.set(tab, (tabSeats.get(tab) ?? 0) + n);
    }
  }
  const tabs: Partial<Record<TabKey, Figures>> = {};
  for (const tab of ["DL", "SL", "BGV", "CORO", "TOTAL"] as TabKey[]) {
    if (tabShare.has(tab)) tabs[tab] = figures(tabShare.get(tab)!, tabSeats.get(tab)!);
  }
  return { lines, tabs };
}

interface LedgerRun {
  output: Pick<FairnessLedgerResponse, "window" | "recordsSince" | "people" | "diagnostics">;
  zeroChecks: Array<{ month: string; serviceId: string; key: string; sum: Q }>;
}

function run(input: LedgerInput): LedgerRun {
  const target = input.target;
  const targetIndex = monthIndex(target);
  const windowMonths = historyWindow({ year: Number(target.slice(0, 4)), month: Number(target.slice(5, 7)) }).map(
    (w) => `${String(w.year).padStart(4, "0")}-${String(w.month).padStart(2, "0")}`,
  );

  // LG-3 — records before the target only; one per month.
  const records = new Map<string, LogicalRecord>();
  for (const r of [...input.records].sort((a, b) => compareCodepoint(a.month, b.month) || compareCodepoint(a.rev, b.rev))) {
    if (monthIndex(r.month) < targetIndex) records.set(r.month, r);
  }
  const recordedMonths = [...records.keys()].sort(compareCodepoint);
  const recordsSince = recordedMonths[0] ?? null;

  const { kept, secondSeats, duplicateTargets, counted } = seatStep(input.services);
  const before = (date: string) => monthIndex(date.slice(0, 7)) < targetIndex;
  const liveUnavailable = new Map<string, Set<string>>(
    input.members.map((m) => [m.id, new Set((m.unavailableDates ?? []).map((d) => String(d).slice(0, 10)))]),
  );

  const monthResults = new Map<string, MonthResult>();
  const zeroChecks: LedgerRun["zeroChecks"] = [];
  for (const month of recordedMonths) {
    const inMonth = (x: { date: string }) => x.date.slice(0, 7) === month;
    const result = computeMonth(
      records.get(month)!,
      counted.filter(inMonth),
      kept.filter(inMonth),
      secondSeats.filter(inMonth),
      liveUnavailable,
    );
    monthResults.set(month, result);
    for (const z of result.zeroChecks) zeroChecks.push({ month, ...z });
  }

  // Who the ledger names (RD-5): listed in a record before the target, or seated at a
  // counted service before it.
  const ids = new Set<string>();
  for (const r of records.values()) for (const p of r.people) ids.add(p.memberId);
  for (const x of [...kept, ...secondSeats]) if (before(x.date)) ids.add(x.memberId);
  const members = new Map(input.members.map((m) => [m.id, m]));
  const latestNames = new Map<string, string>();
  for (const r of [...input.records].sort((a, b) => compareCodepoint(a.month, b.month))) {
    for (const p of r.people) latestNames.set(p.memberId, p.name);
  }

  const windowResults = windowMonths.map((m) => monthResults.get(m)).filter((m): m is MonthResult => !!m);
  const cumulativeResults = [...monthResults.values()];
  const latestWindowRecord = [...windowMonths].reverse().map((m) => records.get(m)).find((r) => !!r);

  const people: FairnessPerson[] = [...ids].sort(compareCodepoint).map((id) => {
    const exists = members.has(id);
    const months: FairnessPersonMonth[] = windowMonths.map((month) => {
      const record = records.get(month);
      const result = monthResults.get(month);
      const held: Partial<Record<RoleKey, number>> = {};
      for (const x of [...kept, ...secondSeats]) {
        if (x.memberId === id && x.date.slice(0, 7) === month) held[x.roleKey] = (held[x.roleKey] ?? 0) + 1;
      }
      const lines: Partial<Record<LineKey, Figures>> = result ? sumLines([result], id).lines : {};
      return {
        month,
        recorded: !!record,
        listed: !!record?.people.some((p) => p.memberId === id),
        lines,
        held,
        setAsides: (result?.setAsides ?? [])
          .filter((x) => x.memberId === id)
          .map(({ date, serviceId, roleKey, reason }) => ({ date, serviceId, roleKey, reason }))
          .sort((a, b) => compareCodepoint(a.date, b.date) || compareCodepoint(a.serviceId, b.serviceId) || ROLE_KEYS.indexOf(a.roleKey) - ROLE_KEYS.indexOf(b.roleKey)),
        notes: !record
          ? [{ code: "unrecorded_month" }]
          : record.people.some((p) => p.memberId === id)
            ? (result?.notes.get(id) ?? [])
            : sortNotes([{ code: "not_listed" }, ...(result?.notes.get(id) ?? [])]),
      };
    });
    const windowSum = sumLines(windowResults, id);
    const cumulativeSum = sumLines(cumulativeResults, id);
    const firstRecordedIn: Partial<Record<RoleKey, string>> = {};
    for (const month of recordedMonths) {
      const person = records.get(month)!.people.find((p) => p.memberId === id);
      for (const k of ROLE_KEYS) if (person?.roles[k] === "in" && !firstRecordedIn[k]) firstRecordedIn[k] = month;
    }
    const recordedWindow = windowMonths.filter((m) => records.has(m));
    return {
      memberId: id,
      name: exists ? members.get(id)!.name : (latestNames.get(id) ?? ""),
      exists,
      window: windowSum.lines,
      cumulative: cumulativeSum.lines,
      tabs: { window: windowSum.tabs, cumulative: cumulativeSum.tabs },
      sang: [...kept, ...secondSeats].filter((x) => x.memberId === id && recordedWindow.includes(x.date.slice(0, 7))).length,
      exempt: latestWindowRecord?.people.find((p) => p.memberId === id)?.exempt ?? false,
      months,
      countedSundayLeads: kept
        .filter((x) => x.memberId === id && x.roleKey === "Sun.Lead" && windowMonths.includes(x.date.slice(0, 7)))
        .map((x) => x.date)
        .sort(compareCodepoint),
      firstRecordedIn,
    };
  });

  return {
    output: {
      window: windowMonths.map((month) => ({ month, record: records.has(month) ? summary(records.get(month)!) : null })),
      recordsSince,
      people,
      diagnostics: {
        duplicateTargets,
        notInRecordSeats: cumulativeResults.reduce((n, m) => n + m.setAsides.filter((x) => x.reason === "not_in_record").length, 0),
        unknownMembers: people.filter((p) => !p.exists).map((p) => p.memberId),
      },
    },
    zeroChecks,
  };
}

/**
 * IF2-10 — the ledger's entry point: the GET's `window`, `recordsSince`, `people` and
 * `diagnostics` (RD-3). Same input → same output (LG-16).
 */
export function computeFairnessLedger(input: LedgerInput): Pick<FairnessLedgerResponse, "window" | "recordsSince" | "people" | "diagnostics"> {
  return run(input).output;
}

/**
 * The EXACT balance sum of every (service, role key) and every (presence rule, service)
 * of every recorded month — each must be zero (LG-10, FX-3). Exported for the tests that
 * assert it; nothing else reads it.
 */
export function fairnessLedgerExactSums(input: LedgerInput): Array<{ month: string; serviceId: string; key: string; numerator: string; denominator: string }> {
  return run(input).zeroChecks.map((z) => ({
    month: z.month,
    serviceId: z.serviceId,
    key: z.key,
    numerator: z.sum.n.toString(),
    denominator: z.sum.d.toString(),
  }));
}
````

**Create** `app/utils/fairnessFormat.ts`:

````ts
// app/utils/fairnessFormat.ts
//
// THE fairness-figure formatter (solver v3 C2 IF2-13, LG-13, UI-4; parent A17). One
// decimal, written from a TENTHS figure that the ledger computed once from the exact
// value — never from hundredths, which would round twice (exact 0.249 → 0.25 → «0.3»,
// where the exact value says «0.2»). Neutral and client-callable; the panel, C4's table
// and C6's U5 columns all format through these two functions.
// `fairnessFormat.test.ts` sweeps app/** for code that derives tenths from hundredths.

/** 8 → "0.8", -13 → "-1.3", 0 → "0.0" — es-MX writes the decimal point. */
export function formatFairnessTenths(tenths: number): string {
  const whole = Math.trunc(tenths);
  const abs = Math.abs(whole);
  return `${whole < 0 ? "-" : ""}${Math.floor(abs / 10)}.${abs % 10}`;
}

/** The saldo in words (§8): «le deben 0.8» · «0.3 de más» · «al día» when its tenths are 0. */
export function saldoWords(balanceTenths: number): string {
  if (balanceTenths === 0) return "al día";
  return balanceTenths > 0
    ? `le deben ${formatFairnessTenths(balanceTenths)}`
    : `${formatFairnessTenths(-balanceTenths)} de más`;
}
````

**Regenerate** `app/utils/__tests__/__fixtures__/colour-inventory.json` (it records `filesScanned`, and this task adds a file under `app/`):

```bash
node scripts/colour-inventory.mjs
```

- [ ] **Step 4: Run them to see them pass**

Run: `git add -A && npx vitest run app/utils/__tests__/fairnessLedger.test.ts app/utils/__tests__/fairnessFormat.test.ts app/utils/__tests__/clientBoundary.test.ts app/utils/__tests__/draftGatingCoverage.test.ts`
Expected: PASS — the ledger's role type names are plain quoted strings, so `draftGatingCoverage` stays green.

- [ ] **Step 5: Gates and commit**

Run: `git add -A && npx tsc --noEmit && npm test && npx eslint .`
Expected: **461 files / 8397 tests**; 0 errors, 81 warnings.

```bash
git add -A
git commit -m "feat(fairness): the fairness ledger, the seat step, X1 and the one figure formatter" -m "Solver v3 C2 IF2-10 to IF2-13 (LG-1 to LG-17, CAD-1). fairnessLedger.ts is the only TypeScript definition of F2-F7 and X1: the record-free seat step (duplicate weekend targets dropped, uncounted services out, one kept seat per person per service, specials by day class through a civil weekday formula), the per-month populations, presence sub-lines, set-asides and floor seat, exact BigInt rationals rounded once to hundredths for the wire and once to tenths for display from the same exact value, and cadenceStates. fairnessFormat.ts writes a tenths figure with one decimal and the saldo in words; a sweep refuses any code under app/ that derives a display figure from the wire's hundredths."
```


---

## Task 10: The golden fixture, hand-computed, and its vitest suite — **[CRITICAL slice: the cross-language contract C5 must reproduce]**

Spec FX-1–FX-5, IF2-29, the LG/CAD rows each case `covers`. 22 `ledger` cases and 7 `cadence` cases, one or more per FX-4 requirement, with the spec's fictitious people only. **Every expected triple was computed by hand before the suite ran; each case's `description` carries the arithmetic** — a reviewer re-derives a case from its description alone. While executing this plan the suite caught one *case-design* error (a service that gave one person two seats, so her Choir seat was a second seat): the case was redesigned and re-derived by hand, never re-captured from output. The suite asserts, per `ledger` case: the window, every listed month exactly (re-targeting the ledger for a month outside the window), the window totals, every set-aside of the window, the listed notes, and exact sum-to-zero; every `cadence` case; a schema check; an `FX-4` coverage list keyed on the cases' `covers` tags; and that every member id is one of the spec's fictitious people. The file's one key outside IF2-29 is the FX-5 header, `$comment`.

**Files:**
- Create: `fixtures/fairness/golden.json`
- Test: `app/utils/__tests__/fairnessGolden.test.ts`

**Interfaces:**
- Consumes: Task 9's `computeFairnessLedger`, `fairnessLedgerExactSums`, `cadenceStates`, `LedgerInput`; `shiftMonth`.
- Produces: `fixtures/fairness/golden.json` (IF2-29) — read by C5's Python suite later; nothing in the app imports it.

- [ ] **Step 1: Write the fixture**

**Create** `fixtures/fairness/golden.json`:

````json
{
  "$comment": "Solver v3 golden fixture (C2 IF2-29, FX-1 to FX-5). Every person and id here is FICTITIOUS - this repository is public, and code review enforces it (FX-5). Expected values are HAND-COMPUTED and reviewed; no suite regenerates them. units: every expected figure (share, received = 100 x seats, balance = share - received) is integer hundredths of a seat, positive = owed. A ledger case's expected.months lists, per month, every member with at least one line that month, and every such line: a member has a line in a month iff she was in that line's population (normal or presence) at least once that month; figures may be zero. windowTotals is the same over the window's months. setAsides is every set-aside of the window's months. notes lists the notes a case is about (each must be emitted; others may be too). plan cases are reserved for C5. The one key outside IF2-29's shape is this $comment, which both suites ignore.",
  "schemaVersion": 1,
  "units": "hundredths",
  "sign": "positive_owed",
  "cases": [
    {
      "id": "uneven-division-sum-to-zero",
      "kind": "ledger",
      "description": "Two Sunday services, each with 2 BGV seats among Alma, Bruno and Carmen: every share is 2/3 + 2/3 = 4/3 -> 133. Alma sat both (received 200, balance -67); Bruno and Carmen one each (balance 33). Exact balances sum to 0 per service; the rounded ones sum to -1.",
      "covers": ["LG-10", "LG-13", "sum-to-zero", "uneven-division"],
      "input": {
        "target": "2026-11",
        "records": [
          {
            "month": "2026-10",
            "rev": "rev-2026-10",
            "contentHash": "sha256:fixture",
            "source": "auto",
            "engine": "v3",
            "environment": "production",
            "recordedAt": "2026-10-28T12:00:00.000Z",
            "people": [
              {
                "memberId": "m-alma",
                "name": "Alma",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-bruno",
                "name": "Bruno",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-carmen",
                "name": "Carmen",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              }
            ],
            "presence": []
          }
        ],
        "services": [
          {"_id": "sun-1004", "_type": "sunday_role", "date": "2026-10-04", "Lead": [], "BGVs": ["m-alma", "m-bruno"], "Chorus": []},
          {"_id": "sun-1011", "_type": "sunday_role", "date": "2026-10-11", "Lead": [], "BGVs": ["m-alma", "m-carmen"], "Chorus": []}
        ],
        "members": [
          {"id": "m-alma", "name": "Alma", "unavailableDates": []},
          {"id": "m-bruno", "name": "Bruno", "unavailableDates": []},
          {"id": "m-carmen", "name": "Carmen", "unavailableDates": []}
        ]
      },
      "expected": {
        "window": [{"month": "2026-08", "recorded": false}, {"month": "2026-09", "recorded": false}, {"month": "2026-10", "recorded": true}],
        "months": {
          "2026-10": {
            "m-alma": {"BGV": {"share": 133, "received": 200, "balance": -67}},
            "m-bruno": {"BGV": {"share": 133, "received": 100, "balance": 33}},
            "m-carmen": {"BGV": {"share": 133, "received": 100, "balance": 33}}
          }
        },
        "windowTotals": {
          "m-alma": {"BGV": {"share": 133, "received": 200, "balance": -67}},
          "m-bruno": {"BGV": {"share": 133, "received": 100, "balance": 33}},
          "m-carmen": {"BGV": {"share": 133, "received": 100, "balance": 33}}
        },
        "setAsides": [],
        "notes": []
      }
    },
    {
      "id": "unavailable-union",
      "kind": "ledger",
      "description": "Alma is unavailable on 4 Oct by the record's block, Bruno on 11 Oct by his live unavailableDates only (his live 20 Oct has no service). Each Sunday: 2 BGV seats (Carmen, Diego) among the 3 available -> 2/3. Alma and Bruno: share 2/3 -> 67, nothing received, balance 67; Carmen and Diego: 4/3 -> 133, received 200, balance -67. No floor: Alma and Bruno received nothing, Carmen and Diego are at 4/3.",
      "covers": ["LG-6", "unavailable-record", "unavailable-live"],
      "input": {
        "target": "2026-11",
        "records": [
          {
            "month": "2026-10",
            "rev": "rev-2026-10",
            "contentHash": "sha256:fixture",
            "source": "auto",
            "engine": "v3",
            "environment": "production",
            "recordedAt": "2026-10-28T12:00:00.000Z",
            "people": [
              {
                "memberId": "m-alma",
                "name": "Alma",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": [{"date": "2026-10-04", "unavailable": true, "excludedRoles": []}]
              },
              {
                "memberId": "m-bruno",
                "name": "Bruno",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-carmen",
                "name": "Carmen",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-diego",
                "name": "Diego",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              }
            ],
            "presence": []
          }
        ],
        "services": [
          {"_id": "sun-1004", "_type": "sunday_role", "date": "2026-10-04", "Lead": [], "BGVs": ["m-carmen", "m-diego"], "Chorus": []},
          {"_id": "sun-1011", "_type": "sunday_role", "date": "2026-10-11", "Lead": [], "BGVs": ["m-carmen", "m-diego"], "Chorus": []}
        ],
        "members": [
          {"id": "m-alma", "name": "Alma", "unavailableDates": []},
          {"id": "m-bruno", "name": "Bruno", "unavailableDates": ["2026-10-11", "2026-10-20"]},
          {"id": "m-carmen", "name": "Carmen", "unavailableDates": []},
          {"id": "m-diego", "name": "Diego", "unavailableDates": []}
        ]
      },
      "expected": {
        "window": [{"month": "2026-08", "recorded": false}, {"month": "2026-09", "recorded": false}, {"month": "2026-10", "recorded": true}],
        "months": {
          "2026-10": {
            "m-alma": {"BGV": {"share": 67, "received": 0, "balance": 67}},
            "m-bruno": {"BGV": {"share": 67, "received": 0, "balance": 67}},
            "m-carmen": {"BGV": {"share": 133, "received": 200, "balance": -67}},
            "m-diego": {"BGV": {"share": 133, "received": 200, "balance": -67}}
          }
        },
        "windowTotals": {
          "m-alma": {"BGV": {"share": 67, "received": 0, "balance": 67}},
          "m-bruno": {"BGV": {"share": 67, "received": 0, "balance": 67}},
          "m-carmen": {"BGV": {"share": 133, "received": 200, "balance": -67}},
          "m-diego": {"BGV": {"share": 133, "received": 200, "balance": -67}}
        },
        "setAsides": [],
        "notes": [
          {"month": "2026-10", "memberId": "m-alma", "note": {"code": "unavailable", "dates": ["2026-10-04"]}},
          {"month": "2026-10", "memberId": "m-bruno", "note": {"code": "unavailable", "dates": ["2026-10-11"]}}
        ]
      }
    },
    {
      "id": "unrecorded-window-month",
      "kind": "ledger",
      "description": "September has a seat but no record: it contributes nothing and reads recorded false. October: Alma and Bruno split two Sunday Lead seats, 1/2 each per service -> share 100 each, one seat each, balance 0.",
      "covers": ["LG-3", "unrecorded-month"],
      "input": {
        "target": "2026-11",
        "records": [
          {
            "month": "2026-10",
            "rev": "rev-2026-10",
            "contentHash": "sha256:fixture",
            "source": "auto",
            "engine": "v3",
            "environment": "production",
            "recordedAt": "2026-10-28T12:00:00.000Z",
            "people": [
              {
                "memberId": "m-alma",
                "name": "Alma",
                "roles": {"Sun.Lead": "in", "Sat.Lead": "out", "Sun.BGV": "out", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-bruno",
                "name": "Bruno",
                "roles": {"Sun.Lead": "in", "Sat.Lead": "out", "Sun.BGV": "out", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              }
            ],
            "presence": []
          }
        ],
        "services": [
          {"_id": "sun-0906", "_type": "sunday_role", "date": "2026-09-06", "Lead": ["m-alma"], "BGVs": [], "Chorus": []},
          {"_id": "sun-1004", "_type": "sunday_role", "date": "2026-10-04", "Lead": ["m-alma"], "BGVs": [], "Chorus": []},
          {"_id": "sun-1011", "_type": "sunday_role", "date": "2026-10-11", "Lead": ["m-bruno"], "BGVs": [], "Chorus": []}
        ],
        "members": [{"id": "m-alma", "name": "Alma", "unavailableDates": []}, {"id": "m-bruno", "name": "Bruno", "unavailableDates": []}]
      },
      "expected": {
        "window": [{"month": "2026-08", "recorded": false}, {"month": "2026-09", "recorded": false}, {"month": "2026-10", "recorded": true}],
        "months": {
          "2026-10": {"m-alma": {"DL": {"share": 100, "received": 100, "balance": 0}}, "m-bruno": {"DL": {"share": 100, "received": 100, "balance": 0}}}
        },
        "windowTotals": {"m-alma": {"DL": {"share": 100, "received": 100, "balance": 0}}, "m-bruno": {"DL": {"share": 100, "received": 100, "balance": 0}}},
        "setAsides": [],
        "notes": [{"month": "2026-09", "memberId": "m-alma", "note": {"code": "unrecorded_month"}}]
      }
    },
    {
      "id": "not-in-record-seat",
      "kind": "ledger",
      "description": "Carmen is not listed in October; her Choir seat on 4 Oct is set aside not_in_record and leaves the pool: 1 seat among Alma and Bruno there (1/2 each), then 2 seats among them on 11 Oct (1 each). Alma: 3/2 -> 150, received 200, balance -50; Bruno: 150, 100, 50.",
      "covers": ["LG-5", "LG-9", "not-in-record"],
      "input": {
        "target": "2026-11",
        "records": [
          {
            "month": "2026-10",
            "rev": "rev-2026-10",
            "contentHash": "sha256:fixture",
            "source": "auto",
            "engine": "v3",
            "environment": "production",
            "recordedAt": "2026-10-28T12:00:00.000Z",
            "people": [
              {
                "memberId": "m-alma",
                "name": "Alma",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "out", "Sat.BGV": "out", "Sun.Choir": "in", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-bruno",
                "name": "Bruno",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "out", "Sat.BGV": "out", "Sun.Choir": "in", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              }
            ],
            "presence": []
          }
        ],
        "services": [
          {"_id": "sun-1004", "_type": "sunday_role", "date": "2026-10-04", "Lead": [], "BGVs": [], "Chorus": ["m-alma", "m-carmen"]},
          {"_id": "sun-1011", "_type": "sunday_role", "date": "2026-10-11", "Lead": [], "BGVs": [], "Chorus": ["m-alma", "m-bruno"]}
        ],
        "members": [
          {"id": "m-alma", "name": "Alma", "unavailableDates": []},
          {"id": "m-bruno", "name": "Bruno", "unavailableDates": []},
          {"id": "m-carmen", "name": "Carmen", "unavailableDates": []}
        ]
      },
      "expected": {
        "window": [{"month": "2026-08", "recorded": false}, {"month": "2026-09", "recorded": false}, {"month": "2026-10", "recorded": true}],
        "months": {
          "2026-10": {"m-alma": {"CORO": {"share": 150, "received": 200, "balance": -50}}, "m-bruno": {"CORO": {"share": 150, "received": 100, "balance": 50}}}
        },
        "windowTotals": {
          "m-alma": {"CORO": {"share": 150, "received": 200, "balance": -50}},
          "m-bruno": {"CORO": {"share": 150, "received": 100, "balance": 50}}
        },
        "setAsides": [{"serviceId": "sun-1004", "roleKey": "Sun.Choir", "memberId": "m-carmen", "reason": "not_in_record"}],
        "notes": [{"month": "2026-10", "memberId": "m-carmen", "note": {"code": "not_listed"}}]
      }
    },
    {
      "id": "listed-out-then-back",
      "kind": "ledger",
      "description": "September lists Carmen with Sun.Lead out: she has no DL line there while Alma and Bruno split two Lead seats (1/2 each per Sunday -> 100 each, one seat each). October lists all three in: three Sundays, 1/3 each -> 100 each; Carmen led twice (-100), Alma once (0), Bruno none (100).",
      "covers": ["LG-5", "LG-8", "R8", "D7", "role-out"],
      "input": {
        "target": "2026-11",
        "records": [
          {
            "month": "2026-09",
            "rev": "rev-2026-09",
            "contentHash": "sha256:fixture",
            "source": "auto",
            "engine": "v3",
            "environment": "production",
            "recordedAt": "2026-09-28T12:00:00.000Z",
            "people": [
              {
                "memberId": "m-alma",
                "name": "Alma",
                "roles": {"Sun.Lead": "in", "Sat.Lead": "out", "Sun.BGV": "out", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-bruno",
                "name": "Bruno",
                "roles": {"Sun.Lead": "in", "Sat.Lead": "out", "Sun.BGV": "out", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-carmen",
                "name": "Carmen",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "out", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              }
            ],
            "presence": []
          },
          {
            "month": "2026-10",
            "rev": "rev-2026-10",
            "contentHash": "sha256:fixture",
            "source": "auto",
            "engine": "v3",
            "environment": "production",
            "recordedAt": "2026-10-28T12:00:00.000Z",
            "people": [
              {
                "memberId": "m-alma",
                "name": "Alma",
                "roles": {"Sun.Lead": "in", "Sat.Lead": "out", "Sun.BGV": "out", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-bruno",
                "name": "Bruno",
                "roles": {"Sun.Lead": "in", "Sat.Lead": "out", "Sun.BGV": "out", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-carmen",
                "name": "Carmen",
                "roles": {"Sun.Lead": "in", "Sat.Lead": "out", "Sun.BGV": "out", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              }
            ],
            "presence": []
          }
        ],
        "services": [
          {"_id": "sun-0906", "_type": "sunday_role", "date": "2026-09-06", "Lead": ["m-alma"], "BGVs": [], "Chorus": []},
          {"_id": "sun-0913", "_type": "sunday_role", "date": "2026-09-13", "Lead": ["m-bruno"], "BGVs": [], "Chorus": []},
          {"_id": "sun-1004", "_type": "sunday_role", "date": "2026-10-04", "Lead": ["m-carmen"], "BGVs": [], "Chorus": []},
          {"_id": "sun-1011", "_type": "sunday_role", "date": "2026-10-11", "Lead": ["m-carmen"], "BGVs": [], "Chorus": []},
          {"_id": "sun-1018", "_type": "sunday_role", "date": "2026-10-18", "Lead": ["m-alma"], "BGVs": [], "Chorus": []}
        ],
        "members": [
          {"id": "m-alma", "name": "Alma", "unavailableDates": []},
          {"id": "m-bruno", "name": "Bruno", "unavailableDates": []},
          {"id": "m-carmen", "name": "Carmen", "unavailableDates": []}
        ]
      },
      "expected": {
        "window": [{"month": "2026-08", "recorded": false}, {"month": "2026-09", "recorded": true}, {"month": "2026-10", "recorded": true}],
        "months": {
          "2026-09": {"m-alma": {"DL": {"share": 100, "received": 100, "balance": 0}}, "m-bruno": {"DL": {"share": 100, "received": 100, "balance": 0}}},
          "2026-10": {
            "m-alma": {"DL": {"share": 100, "received": 100, "balance": 0}},
            "m-bruno": {"DL": {"share": 100, "received": 0, "balance": 100}},
            "m-carmen": {"DL": {"share": 100, "received": 200, "balance": -100}}
          }
        },
        "windowTotals": {
          "m-alma": {"DL": {"share": 200, "received": 200, "balance": 0}},
          "m-bruno": {"DL": {"share": 200, "received": 100, "balance": 100}},
          "m-carmen": {"DL": {"share": 100, "received": 200, "balance": -100}}
        },
        "setAsides": [],
        "notes": [{"month": "2026-09", "memberId": "m-carmen", "note": {"code": "role_out", "line": "DL"}}]
      }
    },
    {
      "id": "outside-population-seat",
      "kind": "ledger",
      "description": "Carmen is listed with every role out but sat a BGV seat on 4 Oct: it is set aside outside_population. 1 seat among Alma and Bruno on 4 Oct (1/2 each), 2 on 11 Oct (1 each). Alma 150/200/-50, Bruno 150/100/50; Carmen is in no population and has no line.",
      "covers": ["LG-8", "LG-9", "outside-population"],
      "input": {
        "target": "2026-11",
        "records": [
          {
            "month": "2026-10",
            "rev": "rev-2026-10",
            "contentHash": "sha256:fixture",
            "source": "auto",
            "engine": "v3",
            "environment": "production",
            "recordedAt": "2026-10-28T12:00:00.000Z",
            "people": [
              {
                "memberId": "m-alma",
                "name": "Alma",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-bruno",
                "name": "Bruno",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-carmen",
                "name": "Carmen",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "out", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              }
            ],
            "presence": []
          }
        ],
        "services": [
          {"_id": "sun-1004", "_type": "sunday_role", "date": "2026-10-04", "Lead": [], "BGVs": ["m-alma", "m-carmen"], "Chorus": []},
          {"_id": "sun-1011", "_type": "sunday_role", "date": "2026-10-11", "Lead": [], "BGVs": ["m-bruno", "m-alma"], "Chorus": []}
        ],
        "members": [
          {"id": "m-alma", "name": "Alma", "unavailableDates": []},
          {"id": "m-bruno", "name": "Bruno", "unavailableDates": []},
          {"id": "m-carmen", "name": "Carmen", "unavailableDates": []}
        ]
      },
      "expected": {
        "window": [{"month": "2026-08", "recorded": false}, {"month": "2026-09", "recorded": false}, {"month": "2026-10", "recorded": true}],
        "months": {
          "2026-10": {"m-alma": {"BGV": {"share": 150, "received": 200, "balance": -50}}, "m-bruno": {"BGV": {"share": 150, "received": 100, "balance": 50}}}
        },
        "windowTotals": {"m-alma": {"BGV": {"share": 150, "received": 200, "balance": -50}}, "m-bruno": {"BGV": {"share": 150, "received": 100, "balance": 50}}},
        "setAsides": [{"serviceId": "sun-1004", "roleKey": "Sun.BGV", "memberId": "m-carmen", "reason": "outside_population"}],
        "notes": [
          {"month": "2026-10", "memberId": "m-carmen", "note": {"code": "outside_population", "line": "BGV", "dates": ["2026-10-04"]}},
          {"month": "2026-10", "memberId": "m-carmen", "note": {"code": "role_out", "line": "BGV"}}
        ]
      }
    },
    {
      "id": "exact-rule-and-clamp",
      "kind": "ledger",
      "description": "Alma has Sun.Lead == 2 both months; her Lead seats are set aside exact and she is in no DL population. September: Bruno and Carmen split the two other Lead seats, 1/2 each per Sunday -> 100 each, one seat each. October: Alma is blocked on three Sundays, so 2 > 1 available -> exact_clamped; of three non-Alma Sundays Bruno led two (share 3/2 -> 150, 200, -50) and Carmen one (150, 100, 50); 4 Oct's pool is 0.",
      "covers": ["LG-9", "LG-17", "exact", "exact-clamped"],
      "input": {
        "target": "2026-11",
        "records": [
          {
            "month": "2026-09",
            "rev": "rev-2026-09",
            "contentHash": "sha256:fixture",
            "source": "auto",
            "engine": "v3",
            "environment": "production",
            "recordedAt": "2026-09-28T12:00:00.000Z",
            "people": [
              {
                "memberId": "m-alma",
                "name": "Alma",
                "roles": {"Sun.Lead": "exact", "Sat.Lead": "out", "Sun.BGV": "out", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [{"roles": ["Sun.Lead"], "count": 2}],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-bruno",
                "name": "Bruno",
                "roles": {"Sun.Lead": "in", "Sat.Lead": "out", "Sun.BGV": "out", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-carmen",
                "name": "Carmen",
                "roles": {"Sun.Lead": "in", "Sat.Lead": "out", "Sun.BGV": "out", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              }
            ],
            "presence": []
          },
          {
            "month": "2026-10",
            "rev": "rev-2026-10",
            "contentHash": "sha256:fixture",
            "source": "auto",
            "engine": "v3",
            "environment": "production",
            "recordedAt": "2026-10-28T12:00:00.000Z",
            "people": [
              {
                "memberId": "m-alma",
                "name": "Alma",
                "roles": {"Sun.Lead": "exact", "Sat.Lead": "out", "Sun.BGV": "out", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [{"roles": ["Sun.Lead"], "count": 2}],
                "exempt": false,
                "blocks": [
                  {"date": "2026-10-11", "unavailable": true, "excludedRoles": []},
                  {"date": "2026-10-18", "unavailable": true, "excludedRoles": []},
                  {"date": "2026-10-25", "unavailable": true, "excludedRoles": []}
                ]
              },
              {
                "memberId": "m-bruno",
                "name": "Bruno",
                "roles": {"Sun.Lead": "in", "Sat.Lead": "out", "Sun.BGV": "out", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-carmen",
                "name": "Carmen",
                "roles": {"Sun.Lead": "in", "Sat.Lead": "out", "Sun.BGV": "out", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              }
            ],
            "presence": []
          }
        ],
        "services": [
          {"_id": "sun-0906", "_type": "sunday_role", "date": "2026-09-06", "Lead": ["m-alma"], "BGVs": [], "Chorus": []},
          {"_id": "sun-0913", "_type": "sunday_role", "date": "2026-09-13", "Lead": ["m-alma"], "BGVs": [], "Chorus": []},
          {"_id": "sun-0920", "_type": "sunday_role", "date": "2026-09-20", "Lead": ["m-bruno"], "BGVs": [], "Chorus": []},
          {"_id": "sun-0927", "_type": "sunday_role", "date": "2026-09-27", "Lead": ["m-carmen"], "BGVs": [], "Chorus": []},
          {"_id": "sun-1004", "_type": "sunday_role", "date": "2026-10-04", "Lead": ["m-alma"], "BGVs": [], "Chorus": []},
          {"_id": "sun-1011", "_type": "sunday_role", "date": "2026-10-11", "Lead": ["m-bruno"], "BGVs": [], "Chorus": []},
          {"_id": "sun-1018", "_type": "sunday_role", "date": "2026-10-18", "Lead": ["m-carmen"], "BGVs": [], "Chorus": []},
          {"_id": "sun-1025", "_type": "sunday_role", "date": "2026-10-25", "Lead": ["m-bruno"], "BGVs": [], "Chorus": []}
        ],
        "members": [
          {"id": "m-alma", "name": "Alma", "unavailableDates": []},
          {"id": "m-bruno", "name": "Bruno", "unavailableDates": []},
          {"id": "m-carmen", "name": "Carmen", "unavailableDates": []}
        ]
      },
      "expected": {
        "window": [{"month": "2026-08", "recorded": false}, {"month": "2026-09", "recorded": true}, {"month": "2026-10", "recorded": true}],
        "months": {
          "2026-09": {"m-bruno": {"DL": {"share": 100, "received": 100, "balance": 0}}, "m-carmen": {"DL": {"share": 100, "received": 100, "balance": 0}}},
          "2026-10": {"m-bruno": {"DL": {"share": 150, "received": 200, "balance": -50}}, "m-carmen": {"DL": {"share": 150, "received": 100, "balance": 50}}}
        },
        "windowTotals": {"m-bruno": {"DL": {"share": 250, "received": 300, "balance": -50}}, "m-carmen": {"DL": {"share": 250, "received": 200, "balance": 50}}},
        "setAsides": [
          {"serviceId": "sun-0906", "roleKey": "Sun.Lead", "memberId": "m-alma", "reason": "exact"},
          {"serviceId": "sun-0913", "roleKey": "Sun.Lead", "memberId": "m-alma", "reason": "exact"},
          {"serviceId": "sun-1004", "roleKey": "Sun.Lead", "memberId": "m-alma", "reason": "exact"}
        ],
        "notes": [
          {"month": "2026-09", "memberId": "m-alma", "note": {"code": "exact", "roles": ["Sun.Lead"], "count": 2}},
          {"month": "2026-10", "memberId": "m-alma", "note": {"code": "exact", "roles": ["Sun.Lead"], "count": 2}},
          {"month": "2026-10", "memberId": "m-alma", "note": {"code": "exact_clamped", "count": 2, "available": 1}}
        ]
      }
    },
    {
      "id": "exact-seat-leaves-other-population",
      "kind": "ledger",
      "description": "Alma has Sun.Lead == 1 and Sun.BGV in. On 4 Oct she holds the exact Lead seat, so she is out of that service's BGV population (F6): 2 BGV seats among Bruno and Carmen (1 each). On 11 Oct 2 BGV seats among all three (2/3 each). Alma 2/3 -> 67, received 100, -33 (her exact seat cancels the floor); Bruno 5/3 -> 167, 200, -33; Carmen 167, 100, 67.",
      "covers": ["LG-8", "F6", "exact-seat-population", "floor-cancelled-exact"],
      "input": {
        "target": "2026-11",
        "records": [
          {
            "month": "2026-10",
            "rev": "rev-2026-10",
            "contentHash": "sha256:fixture",
            "source": "auto",
            "engine": "v3",
            "environment": "production",
            "recordedAt": "2026-10-28T12:00:00.000Z",
            "people": [
              {
                "memberId": "m-alma",
                "name": "Alma",
                "roles": {"Sun.Lead": "exact", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [{"roles": ["Sun.Lead"], "count": 1}],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-bruno",
                "name": "Bruno",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-carmen",
                "name": "Carmen",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              }
            ],
            "presence": []
          }
        ],
        "services": [
          {"_id": "sun-1004", "_type": "sunday_role", "date": "2026-10-04", "Lead": ["m-alma"], "BGVs": ["m-bruno", "m-carmen"], "Chorus": []},
          {"_id": "sun-1011", "_type": "sunday_role", "date": "2026-10-11", "Lead": [], "BGVs": ["m-alma", "m-bruno"], "Chorus": []}
        ],
        "members": [
          {"id": "m-alma", "name": "Alma", "unavailableDates": []},
          {"id": "m-bruno", "name": "Bruno", "unavailableDates": []},
          {"id": "m-carmen", "name": "Carmen", "unavailableDates": []}
        ]
      },
      "expected": {
        "window": [{"month": "2026-08", "recorded": false}, {"month": "2026-09", "recorded": false}, {"month": "2026-10", "recorded": true}],
        "months": {
          "2026-10": {
            "m-alma": {"BGV": {"share": 67, "received": 100, "balance": -33}},
            "m-bruno": {"BGV": {"share": 167, "received": 200, "balance": -33}},
            "m-carmen": {"BGV": {"share": 167, "received": 100, "balance": 67}}
          }
        },
        "windowTotals": {
          "m-alma": {"BGV": {"share": 67, "received": 100, "balance": -33}},
          "m-bruno": {"BGV": {"share": 167, "received": 200, "balance": -33}},
          "m-carmen": {"BGV": {"share": 167, "received": 100, "balance": 67}}
        },
        "setAsides": [{"serviceId": "sun-1004", "roleKey": "Sun.Lead", "memberId": "m-alma", "reason": "exact"}],
        "notes": [{"month": "2026-10", "memberId": "m-alma", "note": {"code": "exact", "roles": ["Sun.Lead"], "count": 1}}]
      }
    },
    {
      "id": "cadence-sundays-and-saturday",
      "kind": "ledger",
      "description": "Alma is «Mes por medio»: no DL population, and her Sunday Lead seat (6 Sep) is set aside cadence. September: Bruno alone in DL takes the other Sunday (100/100/0); one Saturday Lead seat (Bruno) among Alma and Bruno -> 1/2 each: Alma 50/0/50, Bruno 50/100/-50. October she leads no Sunday and leads the 10 Oct Saturday, which counts in SL: two Saturdays, 1/2 each per Saturday -> 100 each, one seat each; Bruno takes both Sundays (200/200/0).",
      "covers": ["LG-8", "LG-9", "F7", "cadence-set-aside", "cadence-no-sunday-saturday"],
      "input": {
        "target": "2026-11",
        "records": [
          {
            "month": "2026-09",
            "rev": "rev-2026-09",
            "contentHash": "sha256:fixture",
            "source": "auto",
            "engine": "v3",
            "environment": "production",
            "recordedAt": "2026-09-28T12:00:00.000Z",
            "people": [
              {
                "memberId": "m-alma",
                "name": "Alma",
                "roles": {"Sun.Lead": "in", "Sat.Lead": "in", "Sun.BGV": "out", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "sundayCadence": "alternate",
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-bruno",
                "name": "Bruno",
                "roles": {"Sun.Lead": "in", "Sat.Lead": "in", "Sun.BGV": "out", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              }
            ],
            "presence": []
          },
          {
            "month": "2026-10",
            "rev": "rev-2026-10",
            "contentHash": "sha256:fixture",
            "source": "auto",
            "engine": "v3",
            "environment": "production",
            "recordedAt": "2026-10-28T12:00:00.000Z",
            "people": [
              {
                "memberId": "m-alma",
                "name": "Alma",
                "roles": {"Sun.Lead": "in", "Sat.Lead": "in", "Sun.BGV": "out", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "sundayCadence": "alternate",
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-bruno",
                "name": "Bruno",
                "roles": {"Sun.Lead": "in", "Sat.Lead": "in", "Sun.BGV": "out", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              }
            ],
            "presence": []
          }
        ],
        "services": [
          {"_id": "sun-0906", "_type": "sunday_role", "date": "2026-09-06", "Lead": ["m-alma"], "BGVs": [], "Chorus": []},
          {"_id": "sun-0913", "_type": "sunday_role", "date": "2026-09-13", "Lead": ["m-bruno"], "BGVs": [], "Chorus": []},
          {"_id": "sat-0912", "_type": "saturday_role", "date": "2026-09-12", "Lead": ["m-bruno"], "BGVs": [], "Chorus": []},
          {"_id": "sun-1004", "_type": "sunday_role", "date": "2026-10-04", "Lead": ["m-bruno"], "BGVs": [], "Chorus": []},
          {"_id": "sun-1011", "_type": "sunday_role", "date": "2026-10-11", "Lead": ["m-bruno"], "BGVs": [], "Chorus": []},
          {"_id": "sat-1010", "_type": "saturday_role", "date": "2026-10-10", "Lead": ["m-alma"], "BGVs": [], "Chorus": []},
          {"_id": "sat-1017", "_type": "saturday_role", "date": "2026-10-17", "Lead": ["m-bruno"], "BGVs": [], "Chorus": []}
        ],
        "members": [{"id": "m-alma", "name": "Alma", "unavailableDates": []}, {"id": "m-bruno", "name": "Bruno", "unavailableDates": []}]
      },
      "expected": {
        "window": [{"month": "2026-08", "recorded": false}, {"month": "2026-09", "recorded": true}, {"month": "2026-10", "recorded": true}],
        "months": {
          "2026-09": {
            "m-alma": {"SL": {"share": 50, "received": 0, "balance": 50}},
            "m-bruno": {"DL": {"share": 100, "received": 100, "balance": 0}, "SL": {"share": 50, "received": 100, "balance": -50}}
          },
          "2026-10": {
            "m-alma": {"SL": {"share": 100, "received": 100, "balance": 0}},
            "m-bruno": {"DL": {"share": 200, "received": 200, "balance": 0}, "SL": {"share": 100, "received": 100, "balance": 0}}
          }
        },
        "windowTotals": {
          "m-alma": {"SL": {"share": 150, "received": 100, "balance": 50}},
          "m-bruno": {"DL": {"share": 300, "received": 300, "balance": 0}, "SL": {"share": 150, "received": 200, "balance": -50}}
        },
        "setAsides": [{"serviceId": "sun-0906", "roleKey": "Sun.Lead", "memberId": "m-alma", "reason": "cadence"}],
        "notes": [
          {"month": "2026-09", "memberId": "m-alma", "note": {"code": "cadence_set_aside", "line": "DL", "dates": ["2026-09-06"]}},
          {"month": "2026-10", "memberId": "m-alma", "note": {"code": "cadence_no_sunday_saturday", "line": "SL", "dates": ["2026-10-10"]}}
        ]
      }
    },
    {
      "id": "presence-non-exclusive",
      "kind": "ledger",
      "description": "Non-exclusive presence rule-ab (Sun.BGV; Alma, Bruno). 4 Oct: Alma's seat is the presence seat (sub-line 1/2 each) and Carmen's and Diego's are normal (2 among 4 -> 1/2 each). 11 Oct: Bruno's seat is the presence seat, Carmen's normal (1/4 each). 18 Oct: Alma is unavailable, so Bruno is the only member of Q and leaves every normal population there (his Choir too): no presence seat (pool 0), Diego's BGV seat among Carmen and Diego (1/2 each), Carmen's Choir seat among Carmen alone. BGV: Alma and Bruno 3/4 -> 75/0/75; Carmen and Diego 5/4 -> 125/200/-75. P:rule-ab: Alma and Bruno 1 -> 100/100/0. CORO: Bruno 0/0/0 (in the Choir population on 4 and 11 Oct, whose pool is 0), Carmen 100/100/0.",
      "covers": ["LG-7", "LG-8", "LG-10", "presence-both-available", "presence-one-available", "presence-non-exclusive"],
      "input": {
        "target": "2026-11",
        "records": [
          {
            "month": "2026-10",
            "rev": "rev-2026-10",
            "contentHash": "sha256:fixture",
            "source": "auto",
            "engine": "v3",
            "environment": "production",
            "recordedAt": "2026-10-28T12:00:00.000Z",
            "people": [
              {
                "memberId": "m-alma",
                "name": "Alma",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": [{"date": "2026-10-18", "unavailable": true, "excludedRoles": []}]
              },
              {
                "memberId": "m-bruno",
                "name": "Bruno",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "in", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-carmen",
                "name": "Carmen",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "in", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-diego",
                "name": "Diego",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              }
            ],
            "presence": [{"ruleKey": "rule-ab", "roles": ["Sun.BGV"], "members": ["m-alma", "m-bruno"], "exclusive": false}]
          }
        ],
        "services": [
          {"_id": "sun-1004", "_type": "sunday_role", "date": "2026-10-04", "Lead": [], "BGVs": ["m-alma", "m-carmen", "m-diego"], "Chorus": []},
          {"_id": "sun-1011", "_type": "sunday_role", "date": "2026-10-11", "Lead": [], "BGVs": ["m-bruno", "m-carmen"], "Chorus": []},
          {"_id": "sun-1018", "_type": "sunday_role", "date": "2026-10-18", "Lead": [], "BGVs": ["m-diego"], "Chorus": ["m-carmen"]}
        ],
        "members": [
          {"id": "m-alma", "name": "Alma", "unavailableDates": []},
          {"id": "m-bruno", "name": "Bruno", "unavailableDates": []},
          {"id": "m-carmen", "name": "Carmen", "unavailableDates": []},
          {"id": "m-diego", "name": "Diego", "unavailableDates": []}
        ]
      },
      "expected": {
        "window": [{"month": "2026-08", "recorded": false}, {"month": "2026-09", "recorded": false}, {"month": "2026-10", "recorded": true}],
        "months": {
          "2026-10": {
            "m-alma": {"BGV": {"share": 75, "received": 0, "balance": 75}, "P:rule-ab": {"share": 100, "received": 100, "balance": 0}},
            "m-bruno": {
              "BGV": {"share": 75, "received": 0, "balance": 75},
              "CORO": {"share": 0, "received": 0, "balance": 0},
              "P:rule-ab": {"share": 100, "received": 100, "balance": 0}
            },
            "m-carmen": {"BGV": {"share": 125, "received": 200, "balance": -75}, "CORO": {"share": 100, "received": 100, "balance": 0}},
            "m-diego": {"BGV": {"share": 125, "received": 200, "balance": -75}}
          }
        },
        "windowTotals": {
          "m-alma": {"BGV": {"share": 75, "received": 0, "balance": 75}, "P:rule-ab": {"share": 100, "received": 100, "balance": 0}},
          "m-bruno": {
            "BGV": {"share": 75, "received": 0, "balance": 75},
            "CORO": {"share": 0, "received": 0, "balance": 0},
            "P:rule-ab": {"share": 100, "received": 100, "balance": 0}
          },
          "m-carmen": {"BGV": {"share": 125, "received": 200, "balance": -75}, "CORO": {"share": 100, "received": 100, "balance": 0}},
          "m-diego": {"BGV": {"share": 125, "received": 200, "balance": -75}}
        },
        "setAsides": [],
        "notes": [
          {"month": "2026-10", "memberId": "m-alma", "note": {"code": "presence", "line": "P:rule-ab", "ruleKey": "rule-ab", "members": ["m-alma", "m-bruno"]}}
        ]
      }
    },
    {
      "id": "presence-exclusive-broken",
      "kind": "ledger",
      "description": "Exclusive rule-x (Sun.BGV; Alma, Bruno) — they should never serve together, but on 4 Oct both hold BGV seats: Alma's (lower id) is the presence seat, Bruno is out of the normal population (exclusive), so his seat is set aside outside_population; Carmen's seat is normal (1 among Carmen). Alma's combined share is 1/2 < 1 with one received seat and no fixed seat, so that presence seat is her floor seat and the sub-line's pool becomes 0. 11 Oct: no presence seat; Carmen's seat normal. Result: Alma and Bruno P:rule-x 0/0/0; Carmen BGV 200/200/0.",
      "covers": ["LG-7", "LG-8", "LG-9", "LG-11", "presence-exclusive", "presence-broken-exclusive", "floor-presence-seat"],
      "input": {
        "target": "2026-11",
        "records": [
          {
            "month": "2026-10",
            "rev": "rev-2026-10",
            "contentHash": "sha256:fixture",
            "source": "auto",
            "engine": "v3",
            "environment": "production",
            "recordedAt": "2026-10-28T12:00:00.000Z",
            "people": [
              {
                "memberId": "m-alma",
                "name": "Alma",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-bruno",
                "name": "Bruno",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-carmen",
                "name": "Carmen",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              }
            ],
            "presence": [{"ruleKey": "rule-x", "roles": ["Sun.BGV"], "members": ["m-alma", "m-bruno"], "exclusive": true}]
          }
        ],
        "services": [
          {"_id": "sun-1004", "_type": "sunday_role", "date": "2026-10-04", "Lead": [], "BGVs": ["m-bruno", "m-alma", "m-carmen"], "Chorus": []},
          {"_id": "sun-1011", "_type": "sunday_role", "date": "2026-10-11", "Lead": [], "BGVs": ["m-carmen"], "Chorus": []}
        ],
        "members": [
          {"id": "m-alma", "name": "Alma", "unavailableDates": []},
          {"id": "m-bruno", "name": "Bruno", "unavailableDates": []},
          {"id": "m-carmen", "name": "Carmen", "unavailableDates": []}
        ]
      },
      "expected": {
        "window": [{"month": "2026-08", "recorded": false}, {"month": "2026-09", "recorded": false}, {"month": "2026-10", "recorded": true}],
        "months": {
          "2026-10": {
            "m-alma": {"P:rule-x": {"share": 0, "received": 0, "balance": 0}},
            "m-bruno": {"P:rule-x": {"share": 0, "received": 0, "balance": 0}},
            "m-carmen": {"BGV": {"share": 200, "received": 200, "balance": 0}}
          }
        },
        "windowTotals": {
          "m-alma": {"P:rule-x": {"share": 0, "received": 0, "balance": 0}},
          "m-bruno": {"P:rule-x": {"share": 0, "received": 0, "balance": 0}},
          "m-carmen": {"BGV": {"share": 200, "received": 200, "balance": 0}}
        },
        "setAsides": [
          {"serviceId": "sun-1004", "roleKey": "Sun.BGV", "memberId": "m-bruno", "reason": "outside_population"},
          {"serviceId": "sun-1004", "roleKey": "Sun.BGV", "memberId": "m-alma", "reason": "floor"}
        ],
        "notes": [
          {"month": "2026-10", "memberId": "m-bruno", "note": {"code": "outside_population", "line": "BGV", "dates": ["2026-10-04"]}},
          {"month": "2026-10", "memberId": "m-alma", "note": {"code": "floor_seat", "line": "P:rule-x", "date": "2026-10-04", "roleKey": "Sun.BGV"}}
        ]
      }
    },
    {
      "id": "presence-seat-lower-id",
      "kind": "ledger",
      "description": "Non-exclusive rule-ab (Sun.BGV; Alma, Bruno). On 4 Oct both hold BGV seats with Bruno first in stored order: the presence seat is Alma's (lower id), Bruno's is normal. 11 Oct: Alma's is the presence seat, Carmen's normal; 18 Oct: Bruno's presence, Carmen's normal. Sub-line 1/2 each per Sunday: Alma 150/200/-50, Bruno 150/100/50. BGV 1/3 each per Sunday: Alma 100/0/100, Bruno 100/100/0, Carmen 100/200/-100.",
      "covers": ["LG-7", "presence-seat-order"],
      "input": {
        "target": "2026-11",
        "records": [
          {
            "month": "2026-10",
            "rev": "rev-2026-10",
            "contentHash": "sha256:fixture",
            "source": "auto",
            "engine": "v3",
            "environment": "production",
            "recordedAt": "2026-10-28T12:00:00.000Z",
            "people": [
              {
                "memberId": "m-alma",
                "name": "Alma",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-bruno",
                "name": "Bruno",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-carmen",
                "name": "Carmen",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              }
            ],
            "presence": [{"ruleKey": "rule-ab", "roles": ["Sun.BGV"], "members": ["m-alma", "m-bruno"], "exclusive": false}]
          }
        ],
        "services": [
          {"_id": "sun-1004", "_type": "sunday_role", "date": "2026-10-04", "Lead": [], "BGVs": ["m-bruno", "m-alma"], "Chorus": []},
          {"_id": "sun-1011", "_type": "sunday_role", "date": "2026-10-11", "Lead": [], "BGVs": ["m-carmen", "m-alma"], "Chorus": []},
          {"_id": "sun-1018", "_type": "sunday_role", "date": "2026-10-18", "Lead": [], "BGVs": ["m-bruno", "m-carmen"], "Chorus": []}
        ],
        "members": [
          {"id": "m-alma", "name": "Alma", "unavailableDates": []},
          {"id": "m-bruno", "name": "Bruno", "unavailableDates": []},
          {"id": "m-carmen", "name": "Carmen", "unavailableDates": []}
        ]
      },
      "expected": {
        "window": [{"month": "2026-08", "recorded": false}, {"month": "2026-09", "recorded": false}, {"month": "2026-10", "recorded": true}],
        "months": {
          "2026-10": {
            "m-alma": {"BGV": {"share": 100, "received": 0, "balance": 100}, "P:rule-ab": {"share": 150, "received": 200, "balance": -50}},
            "m-bruno": {"BGV": {"share": 100, "received": 100, "balance": 0}, "P:rule-ab": {"share": 150, "received": 100, "balance": 50}},
            "m-carmen": {"BGV": {"share": 100, "received": 200, "balance": -100}}
          }
        },
        "windowTotals": {
          "m-alma": {"BGV": {"share": 100, "received": 0, "balance": 100}, "P:rule-ab": {"share": 150, "received": 200, "balance": -50}},
          "m-bruno": {"BGV": {"share": 100, "received": 100, "balance": 0}, "P:rule-ab": {"share": 150, "received": 100, "balance": 50}},
          "m-carmen": {"BGV": {"share": 100, "received": 200, "balance": -100}}
        },
        "setAsides": [],
        "notes": []
      }
    },
    {
      "id": "floor-seat-order",
      "kind": "ledger",
      "description": "Seven people in Sun.BGV, Sat.BGV and Sat.Lead; six one-seat services, so every combined share is 6/7 < 1 and Alma, Bruno and Carmen (two seats each) get a floor seat. Alma: by date (4 Oct before 11 Oct). Bruno, 10 Oct: the special's Lead seat before the Saturday's BGV seat (role order). Carmen, 18 Oct, both BGV: the special timed 19:00 before the untimed Sunday service (an absent time sorts last). After the floors three BGV seats remain (11, 10 and 18 Oct): BGV share 3/7 -> 43 for all seven; Alma, Bruno and Carmen received 100 (-57); the rest 43/0/43. SL: two Saturday-class services whose only seat was a floor seat -> 0/0/0 for all.",
      "covers": ["LG-11", "floor-by-date", "floor-by-role", "floor-by-time", "LG-4-day-class"],
      "input": {
        "target": "2026-11",
        "records": [
          {
            "month": "2026-10",
            "rev": "rev-2026-10",
            "contentHash": "sha256:fixture",
            "source": "auto",
            "engine": "v3",
            "environment": "production",
            "recordedAt": "2026-10-28T12:00:00.000Z",
            "people": [
              {
                "memberId": "m-alma",
                "name": "Alma",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "in", "Sun.BGV": "in", "Sat.BGV": "in", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-bruno",
                "name": "Bruno",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "in", "Sun.BGV": "in", "Sat.BGV": "in", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-carmen",
                "name": "Carmen",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "in", "Sun.BGV": "in", "Sat.BGV": "in", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-diego",
                "name": "Diego",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "in", "Sun.BGV": "in", "Sat.BGV": "in", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-elena",
                "name": "Elena",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "in", "Sun.BGV": "in", "Sat.BGV": "in", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-fausto",
                "name": "Fausto",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "in", "Sun.BGV": "in", "Sat.BGV": "in", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-greta",
                "name": "Greta",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "in", "Sun.BGV": "in", "Sat.BGV": "in", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              }
            ],
            "presence": []
          }
        ],
        "services": [
          {"_id": "sun-1004", "_type": "sunday_role", "date": "2026-10-04", "Lead": [], "BGVs": ["m-alma"], "Chorus": []},
          {"_id": "sun-1011", "_type": "sunday_role", "date": "2026-10-11", "Lead": [], "BGVs": ["m-alma"], "Chorus": []},
          {"_id": "sat-1010", "_type": "saturday_role", "date": "2026-10-10", "Lead": [], "BGVs": ["m-bruno"], "Chorus": []},
          {
            "_id": "spc-1010",
            "_type": "special_role",
            "date": "2026-10-10",
            "time": "18:00",
            "countsForFairness": true,
            "Lead": ["m-bruno"],
            "BGVs": [],
            "Chorus": []
          },
          {"_id": "sun-1018", "_type": "sunday_role", "date": "2026-10-18", "Lead": [], "BGVs": ["m-carmen"], "Chorus": []},
          {
            "_id": "spc-1018",
            "_type": "special_role",
            "date": "2026-10-18",
            "time": "19:00",
            "countsForFairness": true,
            "Lead": [],
            "BGVs": ["m-carmen"],
            "Chorus": []
          }
        ],
        "members": [
          {"id": "m-alma", "name": "Alma", "unavailableDates": []},
          {"id": "m-bruno", "name": "Bruno", "unavailableDates": []},
          {"id": "m-carmen", "name": "Carmen", "unavailableDates": []},
          {"id": "m-diego", "name": "Diego", "unavailableDates": []},
          {"id": "m-elena", "name": "Elena", "unavailableDates": []},
          {"id": "m-fausto", "name": "Fausto", "unavailableDates": []},
          {"id": "m-greta", "name": "Greta", "unavailableDates": []}
        ]
      },
      "expected": {
        "window": [{"month": "2026-08", "recorded": false}, {"month": "2026-09", "recorded": false}, {"month": "2026-10", "recorded": true}],
        "months": {
          "2026-10": {
            "m-alma": {"SL": {"share": 0, "received": 0, "balance": 0}, "BGV": {"share": 43, "received": 100, "balance": -57}},
            "m-bruno": {"SL": {"share": 0, "received": 0, "balance": 0}, "BGV": {"share": 43, "received": 100, "balance": -57}},
            "m-carmen": {"SL": {"share": 0, "received": 0, "balance": 0}, "BGV": {"share": 43, "received": 100, "balance": -57}},
            "m-diego": {"SL": {"share": 0, "received": 0, "balance": 0}, "BGV": {"share": 43, "received": 0, "balance": 43}},
            "m-elena": {"SL": {"share": 0, "received": 0, "balance": 0}, "BGV": {"share": 43, "received": 0, "balance": 43}},
            "m-fausto": {"SL": {"share": 0, "received": 0, "balance": 0}, "BGV": {"share": 43, "received": 0, "balance": 43}},
            "m-greta": {"SL": {"share": 0, "received": 0, "balance": 0}, "BGV": {"share": 43, "received": 0, "balance": 43}}
          }
        },
        "windowTotals": {
          "m-alma": {"SL": {"share": 0, "received": 0, "balance": 0}, "BGV": {"share": 43, "received": 100, "balance": -57}},
          "m-bruno": {"SL": {"share": 0, "received": 0, "balance": 0}, "BGV": {"share": 43, "received": 100, "balance": -57}},
          "m-carmen": {"SL": {"share": 0, "received": 0, "balance": 0}, "BGV": {"share": 43, "received": 100, "balance": -57}},
          "m-diego": {"SL": {"share": 0, "received": 0, "balance": 0}, "BGV": {"share": 43, "received": 0, "balance": 43}},
          "m-elena": {"SL": {"share": 0, "received": 0, "balance": 0}, "BGV": {"share": 43, "received": 0, "balance": 43}},
          "m-fausto": {"SL": {"share": 0, "received": 0, "balance": 0}, "BGV": {"share": 43, "received": 0, "balance": 43}},
          "m-greta": {"SL": {"share": 0, "received": 0, "balance": 0}, "BGV": {"share": 43, "received": 0, "balance": 43}}
        },
        "setAsides": [
          {"serviceId": "sun-1004", "roleKey": "Sun.BGV", "memberId": "m-alma", "reason": "floor"},
          {"serviceId": "spc-1010", "roleKey": "Sat.Lead", "memberId": "m-bruno", "reason": "floor"},
          {"serviceId": "spc-1018", "roleKey": "Sun.BGV", "memberId": "m-carmen", "reason": "floor"}
        ],
        "notes": [
          {"month": "2026-10", "memberId": "m-alma", "note": {"code": "floor_seat", "line": "BGV", "date": "2026-10-04", "roleKey": "Sun.BGV"}},
          {"month": "2026-10", "memberId": "m-bruno", "note": {"code": "floor_seat", "line": "SL", "date": "2026-10-10", "roleKey": "Sat.Lead"}},
          {"month": "2026-10", "memberId": "m-carmen", "note": {"code": "floor_seat", "line": "BGV", "date": "2026-10-18", "roleKey": "Sun.BGV"}}
        ]
      }
    },
    {
      "id": "fixed-seat-cancels-floor",
      "kind": "ledger",
      "description": "Alma (Sun.Lead == 1) and Bruno («Mes por medio») each hold one fixed Lead seat and one BGV seat, with combined shares under 1: neither gets a floor seat. 4 Oct: Alma's Lead set aside exact and she leaves that BGV population; Bruno's BGV seat among Bruno, Carmen, Diego and Elena (1/4). 11 Oct: Bruno's Lead set aside cadence; Alma's BGV seat among all five (1/5). Alma 1/5 -> 20/100/-80; Bruno 9/20 -> 45/100/-55; Carmen, Diego, Elena 45/0/45.",
      "covers": ["LG-11", "floor-cancelled-exact", "floor-cancelled-cadence"],
      "input": {
        "target": "2026-11",
        "records": [
          {
            "month": "2026-10",
            "rev": "rev-2026-10",
            "contentHash": "sha256:fixture",
            "source": "auto",
            "engine": "v3",
            "environment": "production",
            "recordedAt": "2026-10-28T12:00:00.000Z",
            "people": [
              {
                "memberId": "m-alma",
                "name": "Alma",
                "roles": {"Sun.Lead": "exact", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [{"roles": ["Sun.Lead"], "count": 1}],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-bruno",
                "name": "Bruno",
                "roles": {"Sun.Lead": "in", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "sundayCadence": "alternate",
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-carmen",
                "name": "Carmen",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-diego",
                "name": "Diego",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-elena",
                "name": "Elena",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              }
            ],
            "presence": []
          }
        ],
        "services": [
          {"_id": "sun-1004", "_type": "sunday_role", "date": "2026-10-04", "Lead": ["m-alma"], "BGVs": ["m-bruno"], "Chorus": []},
          {"_id": "sun-1011", "_type": "sunday_role", "date": "2026-10-11", "Lead": ["m-bruno"], "BGVs": ["m-alma"], "Chorus": []}
        ],
        "members": [
          {"id": "m-alma", "name": "Alma", "unavailableDates": []},
          {"id": "m-bruno", "name": "Bruno", "unavailableDates": []},
          {"id": "m-carmen", "name": "Carmen", "unavailableDates": []},
          {"id": "m-diego", "name": "Diego", "unavailableDates": []},
          {"id": "m-elena", "name": "Elena", "unavailableDates": []}
        ]
      },
      "expected": {
        "window": [{"month": "2026-08", "recorded": false}, {"month": "2026-09", "recorded": false}, {"month": "2026-10", "recorded": true}],
        "months": {
          "2026-10": {
            "m-alma": {"BGV": {"share": 20, "received": 100, "balance": -80}},
            "m-bruno": {"BGV": {"share": 45, "received": 100, "balance": -55}},
            "m-carmen": {"BGV": {"share": 45, "received": 0, "balance": 45}},
            "m-diego": {"BGV": {"share": 45, "received": 0, "balance": 45}},
            "m-elena": {"BGV": {"share": 45, "received": 0, "balance": 45}}
          }
        },
        "windowTotals": {
          "m-alma": {"BGV": {"share": 20, "received": 100, "balance": -80}},
          "m-bruno": {"BGV": {"share": 45, "received": 100, "balance": -55}},
          "m-carmen": {"BGV": {"share": 45, "received": 0, "balance": 45}},
          "m-diego": {"BGV": {"share": 45, "received": 0, "balance": 45}},
          "m-elena": {"BGV": {"share": 45, "received": 0, "balance": 45}}
        },
        "setAsides": [
          {"serviceId": "sun-1004", "roleKey": "Sun.Lead", "memberId": "m-alma", "reason": "exact"},
          {"serviceId": "sun-1011", "roleKey": "Sun.Lead", "memberId": "m-bruno", "reason": "cadence"}
        ],
        "notes": []
      }
    },
    {
      "id": "exact-seat-under-presence",
      "kind": "ledger",
      "description": "Alma has Sun.BGV == 1 and belongs to presence rule-ab (Sun.BGV; Alma, Bruno). Her exact BGV seat on 4 Oct is set aside exact and is never the presence seat: Bruno's is (he is the only member of Q, so he also leaves every normal population both Sundays). 4 Oct BGV: Carmen's seat among Carmen and Diego; Alma is out of that Choir population (she holds an exact seat there). 11 Oct: Bruno's BGV seat is again the presence seat; Alma's Choir seat among Alma, Carmen and Diego (1/3). Alma's exact seat cancels her floor (CORO 33/100/-67). Carmen's combined share 1/2 + 1/3 < 1 with one received seat: her 4 Oct BGV seat is her floor seat, so BGV is 0/0/0 for Carmen and Diego. Bruno P:rule-ab 200/200/0; Carmen and Diego CORO 33/0/33.",
      "covers": ["LG-7", "LG-11", "exact-under-presence", "floor-cancelled-exact"],
      "input": {
        "target": "2026-11",
        "records": [
          {
            "month": "2026-10",
            "rev": "rev-2026-10",
            "contentHash": "sha256:fixture",
            "source": "auto",
            "engine": "v3",
            "environment": "production",
            "recordedAt": "2026-10-28T12:00:00.000Z",
            "people": [
              {
                "memberId": "m-alma",
                "name": "Alma",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "exact", "Sat.BGV": "out", "Sun.Choir": "in", "Sat.Choir": "out"},
                "exactRules": [{"roles": ["Sun.BGV"], "count": 1}],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-bruno",
                "name": "Bruno",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "in", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-carmen",
                "name": "Carmen",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "in", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-diego",
                "name": "Diego",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "in", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              }
            ],
            "presence": [{"ruleKey": "rule-ab", "roles": ["Sun.BGV"], "members": ["m-alma", "m-bruno"], "exclusive": false}]
          }
        ],
        "services": [
          {"_id": "sun-1004", "_type": "sunday_role", "date": "2026-10-04", "Lead": [], "BGVs": ["m-alma", "m-bruno", "m-carmen"], "Chorus": []},
          {"_id": "sun-1011", "_type": "sunday_role", "date": "2026-10-11", "Lead": [], "BGVs": ["m-bruno"], "Chorus": ["m-alma"]}
        ],
        "members": [
          {"id": "m-alma", "name": "Alma", "unavailableDates": []},
          {"id": "m-bruno", "name": "Bruno", "unavailableDates": []},
          {"id": "m-carmen", "name": "Carmen", "unavailableDates": []},
          {"id": "m-diego", "name": "Diego", "unavailableDates": []}
        ]
      },
      "expected": {
        "window": [{"month": "2026-08", "recorded": false}, {"month": "2026-09", "recorded": false}, {"month": "2026-10", "recorded": true}],
        "months": {
          "2026-10": {
            "m-alma": {"CORO": {"share": 33, "received": 100, "balance": -67}},
            "m-bruno": {"P:rule-ab": {"share": 200, "received": 200, "balance": 0}},
            "m-carmen": {"BGV": {"share": 0, "received": 0, "balance": 0}, "CORO": {"share": 33, "received": 0, "balance": 33}},
            "m-diego": {"BGV": {"share": 0, "received": 0, "balance": 0}, "CORO": {"share": 33, "received": 0, "balance": 33}}
          }
        },
        "windowTotals": {
          "m-alma": {"CORO": {"share": 33, "received": 100, "balance": -67}},
          "m-bruno": {"P:rule-ab": {"share": 200, "received": 200, "balance": 0}},
          "m-carmen": {"BGV": {"share": 0, "received": 0, "balance": 0}, "CORO": {"share": 33, "received": 0, "balance": 33}},
          "m-diego": {"BGV": {"share": 0, "received": 0, "balance": 0}, "CORO": {"share": 33, "received": 0, "balance": 33}}
        },
        "setAsides": [
          {"serviceId": "sun-1004", "roleKey": "Sun.BGV", "memberId": "m-alma", "reason": "exact"},
          {"serviceId": "sun-1004", "roleKey": "Sun.BGV", "memberId": "m-carmen", "reason": "floor"}
        ],
        "notes": [{"month": "2026-10", "memberId": "m-carmen", "note": {"code": "floor_seat", "line": "BGV", "date": "2026-10-04", "roleKey": "Sun.BGV"}}]
      }
    },
    {
      "id": "outside-population-keeps-floor",
      "kind": "ledger",
      "description": "Alma (Sun.Lead out, Sun.BGV in) led on 4 Oct: that seat is set aside outside_population, which is not a fixed seat, so it does not cancel her floor (A12). Her BGV share is 1/4 + 1/4 + 0 = 1/2 < 1 with one received seat (11 Oct), which becomes her floor seat. Bruno, Carmen and Diego each have 2 Choir seats of the three Sundays' 2-of-3 pools (share 2) and are never floored. BGV after the floor: only 4 Oct's seat (Bruno) is shared, 1/4 each -> 25; Bruno 25/100/-75, the others 25/0/25. DL 0/0/0 for Bruno, Carmen, Diego; CORO 200/200/0.",
      "covers": ["LG-11", "A12", "floor-outside-population"],
      "input": {
        "target": "2026-11",
        "records": [
          {
            "month": "2026-10",
            "rev": "rev-2026-10",
            "contentHash": "sha256:fixture",
            "source": "auto",
            "engine": "v3",
            "environment": "production",
            "recordedAt": "2026-10-28T12:00:00.000Z",
            "people": [
              {
                "memberId": "m-alma",
                "name": "Alma",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-bruno",
                "name": "Bruno",
                "roles": {"Sun.Lead": "in", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "in", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-carmen",
                "name": "Carmen",
                "roles": {"Sun.Lead": "in", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "in", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-diego",
                "name": "Diego",
                "roles": {"Sun.Lead": "in", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "in", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              }
            ],
            "presence": []
          }
        ],
        "services": [
          {"_id": "sun-1004", "_type": "sunday_role", "date": "2026-10-04", "Lead": ["m-alma"], "BGVs": ["m-bruno"], "Chorus": ["m-carmen", "m-diego"]},
          {"_id": "sun-1011", "_type": "sunday_role", "date": "2026-10-11", "Lead": [], "BGVs": ["m-alma"], "Chorus": ["m-bruno", "m-carmen"]},
          {"_id": "sun-1018", "_type": "sunday_role", "date": "2026-10-18", "Lead": [], "BGVs": [], "Chorus": ["m-bruno", "m-diego"]}
        ],
        "members": [
          {"id": "m-alma", "name": "Alma", "unavailableDates": []},
          {"id": "m-bruno", "name": "Bruno", "unavailableDates": []},
          {"id": "m-carmen", "name": "Carmen", "unavailableDates": []},
          {"id": "m-diego", "name": "Diego", "unavailableDates": []}
        ]
      },
      "expected": {
        "window": [{"month": "2026-08", "recorded": false}, {"month": "2026-09", "recorded": false}, {"month": "2026-10", "recorded": true}],
        "months": {
          "2026-10": {
            "m-alma": {"BGV": {"share": 25, "received": 0, "balance": 25}},
            "m-bruno": {
              "DL": {"share": 0, "received": 0, "balance": 0},
              "BGV": {"share": 25, "received": 100, "balance": -75},
              "CORO": {"share": 200, "received": 200, "balance": 0}
            },
            "m-carmen": {
              "DL": {"share": 0, "received": 0, "balance": 0},
              "BGV": {"share": 25, "received": 0, "balance": 25},
              "CORO": {"share": 200, "received": 200, "balance": 0}
            },
            "m-diego": {
              "DL": {"share": 0, "received": 0, "balance": 0},
              "BGV": {"share": 25, "received": 0, "balance": 25},
              "CORO": {"share": 200, "received": 200, "balance": 0}
            }
          }
        },
        "windowTotals": {
          "m-alma": {"BGV": {"share": 25, "received": 0, "balance": 25}},
          "m-bruno": {
            "DL": {"share": 0, "received": 0, "balance": 0},
            "BGV": {"share": 25, "received": 100, "balance": -75},
            "CORO": {"share": 200, "received": 200, "balance": 0}
          },
          "m-carmen": {
            "DL": {"share": 0, "received": 0, "balance": 0},
            "BGV": {"share": 25, "received": 0, "balance": 25},
            "CORO": {"share": 200, "received": 200, "balance": 0}
          },
          "m-diego": {
            "DL": {"share": 0, "received": 0, "balance": 0},
            "BGV": {"share": 25, "received": 0, "balance": 25},
            "CORO": {"share": 200, "received": 200, "balance": 0}
          }
        },
        "setAsides": [
          {"serviceId": "sun-1004", "roleKey": "Sun.Lead", "memberId": "m-alma", "reason": "outside_population"},
          {"serviceId": "sun-1011", "roleKey": "Sun.BGV", "memberId": "m-alma", "reason": "floor"}
        ],
        "notes": [
          {"month": "2026-10", "memberId": "m-alma", "note": {"code": "outside_population", "line": "DL", "dates": ["2026-10-04"]}},
          {"month": "2026-10", "memberId": "m-alma", "note": {"code": "floor_seat", "line": "BGV", "date": "2026-10-11", "roleKey": "Sun.BGV"}}
        ]
      }
    },
    {
      "id": "specials-day-class-and-defaults",
      "kind": "ledger",
      "description": "A counted special on Sunday 4 Oct maps Lead to Sun.Lead (DL); a counted special on Friday 9 Oct maps Lead, BGVs and Chorus to Sat.Lead, Sat.BGV and Sat.Choir (SL, BGV, CORO). An uncounted special (16 Oct, false) and a legacy special without the field (23 Oct) contribute nothing; a legacy Saturday service without the field (24 Oct) counts. Each seat is 1 among Alma, Bruno and Carmen (1/3 -> 33): DL, SL and CORO 33 each, BGV 2/3 -> 67. Alma DL 33/100/-67 and BGV 67/100/-33; Bruno SL 33/100/-67 and BGV 67/100/-33; Carmen CORO 33/100/-67.",
      "covers": ["LG-2", "LG-4", "D14", "special-sunday", "special-friday", "uncounted-special", "legacy-default"],
      "input": {
        "target": "2026-11",
        "records": [
          {
            "month": "2026-10",
            "rev": "rev-2026-10",
            "contentHash": "sha256:fixture",
            "source": "auto",
            "engine": "v3",
            "environment": "production",
            "recordedAt": "2026-10-28T12:00:00.000Z",
            "people": [
              {
                "memberId": "m-alma",
                "name": "Alma",
                "roles": {"Sun.Lead": "in", "Sat.Lead": "in", "Sun.BGV": "in", "Sat.BGV": "in", "Sun.Choir": "in", "Sat.Choir": "in"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-bruno",
                "name": "Bruno",
                "roles": {"Sun.Lead": "in", "Sat.Lead": "in", "Sun.BGV": "in", "Sat.BGV": "in", "Sun.Choir": "in", "Sat.Choir": "in"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-carmen",
                "name": "Carmen",
                "roles": {"Sun.Lead": "in", "Sat.Lead": "in", "Sun.BGV": "in", "Sat.BGV": "in", "Sun.Choir": "in", "Sat.Choir": "in"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              }
            ],
            "presence": []
          }
        ],
        "services": [
          {"_id": "spc-1004", "_type": "special_role", "date": "2026-10-04", "countsForFairness": true, "Lead": ["m-alma"], "BGVs": [], "Chorus": []},
          {
            "_id": "spc-1009",
            "_type": "special_role",
            "date": "2026-10-09",
            "countsForFairness": true,
            "Lead": ["m-bruno"],
            "BGVs": ["m-alma"],
            "Chorus": ["m-carmen"]
          },
          {"_id": "spc-1016", "_type": "special_role", "date": "2026-10-16", "countsForFairness": false, "Lead": ["m-alma"], "BGVs": [], "Chorus": []},
          {"_id": "spc-1023", "_type": "special_role", "date": "2026-10-23", "Lead": ["m-bruno"], "BGVs": [], "Chorus": []},
          {"_id": "sat-1024", "_type": "saturday_role", "date": "2026-10-24", "Lead": [], "BGVs": ["m-bruno"], "Chorus": []}
        ],
        "members": [
          {"id": "m-alma", "name": "Alma", "unavailableDates": []},
          {"id": "m-bruno", "name": "Bruno", "unavailableDates": []},
          {"id": "m-carmen", "name": "Carmen", "unavailableDates": []}
        ]
      },
      "expected": {
        "window": [{"month": "2026-08", "recorded": false}, {"month": "2026-09", "recorded": false}, {"month": "2026-10", "recorded": true}],
        "months": {
          "2026-10": {
            "m-alma": {
              "DL": {"share": 33, "received": 100, "balance": -67},
              "SL": {"share": 33, "received": 0, "balance": 33},
              "BGV": {"share": 67, "received": 100, "balance": -33},
              "CORO": {"share": 33, "received": 0, "balance": 33}
            },
            "m-bruno": {
              "DL": {"share": 33, "received": 0, "balance": 33},
              "SL": {"share": 33, "received": 100, "balance": -67},
              "BGV": {"share": 67, "received": 100, "balance": -33},
              "CORO": {"share": 33, "received": 0, "balance": 33}
            },
            "m-carmen": {
              "DL": {"share": 33, "received": 0, "balance": 33},
              "SL": {"share": 33, "received": 0, "balance": 33},
              "BGV": {"share": 67, "received": 0, "balance": 67},
              "CORO": {"share": 33, "received": 100, "balance": -67}
            }
          }
        },
        "windowTotals": {
          "m-alma": {
            "DL": {"share": 33, "received": 100, "balance": -67},
            "SL": {"share": 33, "received": 0, "balance": 33},
            "BGV": {"share": 67, "received": 100, "balance": -33},
            "CORO": {"share": 33, "received": 0, "balance": 33}
          },
          "m-bruno": {
            "DL": {"share": 33, "received": 0, "balance": 33},
            "SL": {"share": 33, "received": 100, "balance": -67},
            "BGV": {"share": 67, "received": 100, "balance": -33},
            "CORO": {"share": 33, "received": 0, "balance": 33}
          },
          "m-carmen": {
            "DL": {"share": 33, "received": 0, "balance": 33},
            "SL": {"share": 33, "received": 0, "balance": 33},
            "BGV": {"share": 67, "received": 0, "balance": 67},
            "CORO": {"share": 33, "received": 100, "balance": -67}
          }
        },
        "setAsides": [],
        "notes": []
      }
    },
    {
      "id": "drafts-duplicates-target-and-later",
      "kind": "ledger",
      "description": "October: a draft (published false) Sunday counts — 2 BGV seats between Alma and Bruno, 1 each -> 100/100/0. The two Sunday documents of 11 Oct are a duplicate target: both dropped. A drafts.-prefixed overlay is not a canonical document. The November (target) and December records and services are ignored, so the window totals equal October.",
      "covers": ["LG-1", "LG-3", "drafts-count", "duplicate-target", "target-and-later-ignored"],
      "input": {
        "target": "2026-11",
        "records": [
          {
            "month": "2026-10",
            "rev": "rev-2026-10",
            "contentHash": "sha256:fixture",
            "source": "auto",
            "engine": "v3",
            "environment": "production",
            "recordedAt": "2026-10-28T12:00:00.000Z",
            "people": [
              {
                "memberId": "m-alma",
                "name": "Alma",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-bruno",
                "name": "Bruno",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              }
            ],
            "presence": []
          },
          {
            "month": "2026-11",
            "rev": "rev-2026-11",
            "contentHash": "sha256:fixture",
            "source": "auto",
            "engine": "v3",
            "environment": "production",
            "recordedAt": "2026-11-28T12:00:00.000Z",
            "people": [
              {
                "memberId": "m-alma",
                "name": "Alma",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-bruno",
                "name": "Bruno",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              }
            ],
            "presence": []
          },
          {
            "month": "2026-12",
            "rev": "rev-2026-12",
            "contentHash": "sha256:fixture",
            "source": "auto",
            "engine": "v3",
            "environment": "production",
            "recordedAt": "2026-12-28T12:00:00.000Z",
            "people": [
              {
                "memberId": "m-alma",
                "name": "Alma",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-bruno",
                "name": "Bruno",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              }
            ],
            "presence": []
          }
        ],
        "services": [
          {"_id": "sun-1004", "_type": "sunday_role", "date": "2026-10-04", "published": false, "Lead": [], "BGVs": ["m-alma", "m-bruno"], "Chorus": []},
          {"_id": "sun-1011-a", "_type": "sunday_role", "date": "2026-10-11", "Lead": [], "BGVs": ["m-alma"], "Chorus": []},
          {"_id": "sun-1011-b", "_type": "sunday_role", "date": "2026-10-11", "Lead": [], "BGVs": ["m-bruno"], "Chorus": []},
          {"_id": "drafts.sun-1018", "_type": "sunday_role", "date": "2026-10-18", "Lead": [], "BGVs": ["m-alma"], "Chorus": []},
          {"_id": "sun-1101", "_type": "sunday_role", "date": "2026-11-01", "Lead": [], "BGVs": ["m-alma"], "Chorus": []},
          {"_id": "sun-1206", "_type": "sunday_role", "date": "2026-12-06", "Lead": [], "BGVs": ["m-bruno"], "Chorus": []}
        ],
        "members": [{"id": "m-alma", "name": "Alma", "unavailableDates": []}, {"id": "m-bruno", "name": "Bruno", "unavailableDates": []}]
      },
      "expected": {
        "window": [{"month": "2026-08", "recorded": false}, {"month": "2026-09", "recorded": false}, {"month": "2026-10", "recorded": true}],
        "months": {
          "2026-10": {"m-alma": {"BGV": {"share": 100, "received": 100, "balance": 0}}, "m-bruno": {"BGV": {"share": 100, "received": 100, "balance": 0}}}
        },
        "windowTotals": {"m-alma": {"BGV": {"share": 100, "received": 100, "balance": 0}}, "m-bruno": {"BGV": {"share": 100, "received": 100, "balance": 0}}},
        "setAsides": [],
        "notes": []
      }
    },
    {
      "id": "cumulative-span-longer-than-window",
      "kind": "ledger",
      "description": "Four recorded months (July to October) for a November target: the window is August to October and the cumulative span starts in July. Every month: two Sundays, 2 BGV seats among Alma, Bruno and Carmen -> 4/3 -> 133 each; Alma 200 received (-67), Bruno and Carmen 100 (33). Window totals: 3 x 4/3 = 4 -> 400; Alma 600 received (-200), Bruno and Carmen 300 (100). July is listed so a per-month suite checks it too.",
      "covers": ["LG-12", "X4", "cumulative-span"],
      "input": {
        "target": "2026-11",
        "records": [
          {
            "month": "2026-07",
            "rev": "rev-2026-07",
            "contentHash": "sha256:fixture",
            "source": "auto",
            "engine": "v3",
            "environment": "production",
            "recordedAt": "2026-07-28T12:00:00.000Z",
            "people": [
              {
                "memberId": "m-alma",
                "name": "Alma",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-bruno",
                "name": "Bruno",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-carmen",
                "name": "Carmen",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              }
            ],
            "presence": []
          },
          {
            "month": "2026-08",
            "rev": "rev-2026-08",
            "contentHash": "sha256:fixture",
            "source": "auto",
            "engine": "v3",
            "environment": "production",
            "recordedAt": "2026-08-28T12:00:00.000Z",
            "people": [
              {
                "memberId": "m-alma",
                "name": "Alma",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-bruno",
                "name": "Bruno",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-carmen",
                "name": "Carmen",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              }
            ],
            "presence": []
          },
          {
            "month": "2026-09",
            "rev": "rev-2026-09",
            "contentHash": "sha256:fixture",
            "source": "auto",
            "engine": "v3",
            "environment": "production",
            "recordedAt": "2026-09-28T12:00:00.000Z",
            "people": [
              {
                "memberId": "m-alma",
                "name": "Alma",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-bruno",
                "name": "Bruno",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-carmen",
                "name": "Carmen",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              }
            ],
            "presence": []
          },
          {
            "month": "2026-10",
            "rev": "rev-2026-10",
            "contentHash": "sha256:fixture",
            "source": "auto",
            "engine": "v3",
            "environment": "production",
            "recordedAt": "2026-10-28T12:00:00.000Z",
            "people": [
              {
                "memberId": "m-alma",
                "name": "Alma",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-bruno",
                "name": "Bruno",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-carmen",
                "name": "Carmen",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              }
            ],
            "presence": []
          }
        ],
        "services": [
          {"_id": "sun-2026-07-a", "_type": "sunday_role", "date": "2026-07-05", "Lead": [], "BGVs": ["m-alma", "m-bruno"], "Chorus": []},
          {"_id": "sun-2026-07-b", "_type": "sunday_role", "date": "2026-07-12", "Lead": [], "BGVs": ["m-alma", "m-carmen"], "Chorus": []},
          {"_id": "sun-2026-08-a", "_type": "sunday_role", "date": "2026-08-02", "Lead": [], "BGVs": ["m-alma", "m-bruno"], "Chorus": []},
          {"_id": "sun-2026-08-b", "_type": "sunday_role", "date": "2026-08-09", "Lead": [], "BGVs": ["m-alma", "m-carmen"], "Chorus": []},
          {"_id": "sun-2026-09-a", "_type": "sunday_role", "date": "2026-09-06", "Lead": [], "BGVs": ["m-alma", "m-bruno"], "Chorus": []},
          {"_id": "sun-2026-09-b", "_type": "sunday_role", "date": "2026-09-13", "Lead": [], "BGVs": ["m-alma", "m-carmen"], "Chorus": []},
          {"_id": "sun-2026-10-a", "_type": "sunday_role", "date": "2026-10-04", "Lead": [], "BGVs": ["m-alma", "m-bruno"], "Chorus": []},
          {"_id": "sun-2026-10-b", "_type": "sunday_role", "date": "2026-10-11", "Lead": [], "BGVs": ["m-alma", "m-carmen"], "Chorus": []}
        ],
        "members": [
          {"id": "m-alma", "name": "Alma", "unavailableDates": []},
          {"id": "m-bruno", "name": "Bruno", "unavailableDates": []},
          {"id": "m-carmen", "name": "Carmen", "unavailableDates": []}
        ]
      },
      "expected": {
        "window": [{"month": "2026-08", "recorded": true}, {"month": "2026-09", "recorded": true}, {"month": "2026-10", "recorded": true}],
        "months": {
          "2026-07": {
            "m-alma": {"BGV": {"share": 133, "received": 200, "balance": -67}},
            "m-bruno": {"BGV": {"share": 133, "received": 100, "balance": 33}},
            "m-carmen": {"BGV": {"share": 133, "received": 100, "balance": 33}}
          },
          "2026-08": {
            "m-alma": {"BGV": {"share": 133, "received": 200, "balance": -67}},
            "m-bruno": {"BGV": {"share": 133, "received": 100, "balance": 33}},
            "m-carmen": {"BGV": {"share": 133, "received": 100, "balance": 33}}
          },
          "2026-09": {
            "m-alma": {"BGV": {"share": 133, "received": 200, "balance": -67}},
            "m-bruno": {"BGV": {"share": 133, "received": 100, "balance": 33}},
            "m-carmen": {"BGV": {"share": 133, "received": 100, "balance": 33}}
          },
          "2026-10": {
            "m-alma": {"BGV": {"share": 133, "received": 200, "balance": -67}},
            "m-bruno": {"BGV": {"share": 133, "received": 100, "balance": 33}},
            "m-carmen": {"BGV": {"share": 133, "received": 100, "balance": 33}}
          }
        },
        "windowTotals": {
          "m-alma": {"BGV": {"share": 400, "received": 600, "balance": -200}},
          "m-bruno": {"BGV": {"share": 400, "received": 300, "balance": 100}},
          "m-carmen": {"BGV": {"share": 400, "received": 300, "balance": 100}}
        },
        "setAsides": [],
        "notes": []
      }
    },
    {
      "id": "exempt-lines-unchanged",
      "kind": "ledger",
      "description": "Alma is «Exenta»: her line is computed like anyone's — one BGV seat among three, 1/3 -> 33, received 100, -67 — and only the floor seat is skipped (she would otherwise lose that seat to the floor). Bruno and Carmen 33/0/33.",
      "covers": ["LG-14", "D13", "exempt"],
      "input": {
        "target": "2026-11",
        "records": [
          {
            "month": "2026-10",
            "rev": "rev-2026-10",
            "contentHash": "sha256:fixture",
            "source": "auto",
            "engine": "v3",
            "environment": "production",
            "recordedAt": "2026-10-28T12:00:00.000Z",
            "people": [
              {
                "memberId": "m-alma",
                "name": "Alma",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": true,
                "blocks": []
              },
              {
                "memberId": "m-bruno",
                "name": "Bruno",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-carmen",
                "name": "Carmen",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              }
            ],
            "presence": []
          }
        ],
        "services": [{"_id": "sun-1004", "_type": "sunday_role", "date": "2026-10-04", "Lead": [], "BGVs": ["m-alma"], "Chorus": []}],
        "members": [
          {"id": "m-alma", "name": "Alma", "unavailableDates": []},
          {"id": "m-bruno", "name": "Bruno", "unavailableDates": []},
          {"id": "m-carmen", "name": "Carmen", "unavailableDates": []}
        ]
      },
      "expected": {
        "window": [{"month": "2026-08", "recorded": false}, {"month": "2026-09", "recorded": false}, {"month": "2026-10", "recorded": true}],
        "months": {
          "2026-10": {
            "m-alma": {"BGV": {"share": 33, "received": 100, "balance": -67}},
            "m-bruno": {"BGV": {"share": 33, "received": 0, "balance": 33}},
            "m-carmen": {"BGV": {"share": 33, "received": 0, "balance": 33}}
          }
        },
        "windowTotals": {
          "m-alma": {"BGV": {"share": 33, "received": 100, "balance": -67}},
          "m-bruno": {"BGV": {"share": 33, "received": 0, "balance": 33}},
          "m-carmen": {"BGV": {"share": 33, "received": 0, "balance": 33}}
        },
        "setAsides": [],
        "notes": [{"month": "2026-10", "memberId": "m-alma", "note": {"code": "exempt"}}]
      }
    },
    {
      "id": "second-seats",
      "kind": "ledger",
      "description": "4 Oct: Alma holds Lead and is also listed in BGVs — her BGV seat is a second seat, set aside, while she stays in the BGV population with nothing received there. 11 Oct: Diego is listed twice in BGVs — the second entry is a second seat. Each Sunday 1 Lead and 1 kept BGV seat among four: 1/4 each per line per Sunday -> 50. Alma DL 50/100/-50, BGV 50/0/50; Bruno DL 50/0/50, BGV 50/100/-50; Carmen DL 50/100/-50, BGV 50/0/50; Diego DL 50/0/50, BGV 50/100/-50.",
      "covers": ["LG-4", "LG-9", "second-seat-two-roles", "second-seat-repeated"],
      "input": {
        "target": "2026-11",
        "records": [
          {
            "month": "2026-10",
            "rev": "rev-2026-10",
            "contentHash": "sha256:fixture",
            "source": "auto",
            "engine": "v3",
            "environment": "production",
            "recordedAt": "2026-10-28T12:00:00.000Z",
            "people": [
              {
                "memberId": "m-alma",
                "name": "Alma",
                "roles": {"Sun.Lead": "in", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-bruno",
                "name": "Bruno",
                "roles": {"Sun.Lead": "in", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-carmen",
                "name": "Carmen",
                "roles": {"Sun.Lead": "in", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-diego",
                "name": "Diego",
                "roles": {"Sun.Lead": "in", "Sat.Lead": "out", "Sun.BGV": "in", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              }
            ],
            "presence": []
          }
        ],
        "services": [
          {"_id": "sun-1004", "_type": "sunday_role", "date": "2026-10-04", "Lead": ["m-alma"], "BGVs": ["m-alma", "m-bruno"], "Chorus": []},
          {"_id": "sun-1011", "_type": "sunday_role", "date": "2026-10-11", "Lead": ["m-carmen"], "BGVs": ["m-diego", "m-diego"], "Chorus": []}
        ],
        "members": [
          {"id": "m-alma", "name": "Alma", "unavailableDates": []},
          {"id": "m-bruno", "name": "Bruno", "unavailableDates": []},
          {"id": "m-carmen", "name": "Carmen", "unavailableDates": []},
          {"id": "m-diego", "name": "Diego", "unavailableDates": []}
        ]
      },
      "expected": {
        "window": [{"month": "2026-08", "recorded": false}, {"month": "2026-09", "recorded": false}, {"month": "2026-10", "recorded": true}],
        "months": {
          "2026-10": {
            "m-alma": {"DL": {"share": 50, "received": 100, "balance": -50}, "BGV": {"share": 50, "received": 0, "balance": 50}},
            "m-bruno": {"DL": {"share": 50, "received": 0, "balance": 50}, "BGV": {"share": 50, "received": 100, "balance": -50}},
            "m-carmen": {"DL": {"share": 50, "received": 100, "balance": -50}, "BGV": {"share": 50, "received": 0, "balance": 50}},
            "m-diego": {"DL": {"share": 50, "received": 0, "balance": 50}, "BGV": {"share": 50, "received": 100, "balance": -50}}
          }
        },
        "windowTotals": {
          "m-alma": {"DL": {"share": 50, "received": 100, "balance": -50}, "BGV": {"share": 50, "received": 0, "balance": 50}},
          "m-bruno": {"DL": {"share": 50, "received": 0, "balance": 50}, "BGV": {"share": 50, "received": 100, "balance": -50}},
          "m-carmen": {"DL": {"share": 50, "received": 100, "balance": -50}, "BGV": {"share": 50, "received": 0, "balance": 50}},
          "m-diego": {"DL": {"share": 50, "received": 0, "balance": 50}, "BGV": {"share": 50, "received": 100, "balance": -50}}
        },
        "setAsides": [
          {"serviceId": "sun-1004", "roleKey": "Sun.BGV", "memberId": "m-alma", "reason": "second_seat"},
          {"serviceId": "sun-1011", "roleKey": "Sun.BGV", "memberId": "m-diego", "reason": "second_seat"}
        ],
        "notes": [
          {"month": "2026-10", "memberId": "m-alma", "note": {"code": "second_seat", "line": "BGV", "dates": ["2026-10-04"]}},
          {"month": "2026-10", "memberId": "m-diego", "note": {"code": "second_seat", "line": "BGV", "dates": ["2026-10-11"]}}
        ]
      }
    },
    {
      "id": "exact-half",
      "kind": "ledger",
      "description": "One Choir seat among eight people: every share is exactly 0.125 -> 13 (half away from zero). Alma (exempt, so the floor does not take her seat) received 100: her balance is 13 - 100 = -87, never the -88 of rounding -0.875 on its own (A39). The other seven: 13/0/13. Rounded balances sum to 4; exact ones to 0.",
      "covers": ["LG-13", "A39", "exact-half"],
      "input": {
        "target": "2026-11",
        "records": [
          {
            "month": "2026-10",
            "rev": "rev-2026-10",
            "contentHash": "sha256:fixture",
            "source": "auto",
            "engine": "v3",
            "environment": "production",
            "recordedAt": "2026-10-28T12:00:00.000Z",
            "people": [
              {
                "memberId": "m-alma",
                "name": "Alma",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "out", "Sat.BGV": "out", "Sun.Choir": "in", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": true,
                "blocks": []
              },
              {
                "memberId": "m-bruno",
                "name": "Bruno",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "out", "Sat.BGV": "out", "Sun.Choir": "in", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-carmen",
                "name": "Carmen",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "out", "Sat.BGV": "out", "Sun.Choir": "in", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-diego",
                "name": "Diego",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "out", "Sat.BGV": "out", "Sun.Choir": "in", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-elena",
                "name": "Elena",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "out", "Sat.BGV": "out", "Sun.Choir": "in", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-fausto",
                "name": "Fausto",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "out", "Sat.BGV": "out", "Sun.Choir": "in", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-greta",
                "name": "Greta",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "out", "Sat.BGV": "out", "Sun.Choir": "in", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              },
              {
                "memberId": "m-ivan",
                "name": "Iván",
                "roles": {"Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "out", "Sat.BGV": "out", "Sun.Choir": "in", "Sat.Choir": "out"},
                "exactRules": [],
                "exempt": false,
                "blocks": []
              }
            ],
            "presence": []
          }
        ],
        "services": [{"_id": "sun-1004", "_type": "sunday_role", "date": "2026-10-04", "Lead": [], "BGVs": [], "Chorus": ["m-alma"]}],
        "members": [
          {"id": "m-alma", "name": "Alma", "unavailableDates": []},
          {"id": "m-bruno", "name": "Bruno", "unavailableDates": []},
          {"id": "m-carmen", "name": "Carmen", "unavailableDates": []},
          {"id": "m-diego", "name": "Diego", "unavailableDates": []},
          {"id": "m-elena", "name": "Elena", "unavailableDates": []},
          {"id": "m-fausto", "name": "Fausto", "unavailableDates": []},
          {"id": "m-greta", "name": "Greta", "unavailableDates": []},
          {"id": "m-ivan", "name": "Iván", "unavailableDates": []}
        ]
      },
      "expected": {
        "window": [{"month": "2026-08", "recorded": false}, {"month": "2026-09", "recorded": false}, {"month": "2026-10", "recorded": true}],
        "months": {
          "2026-10": {
            "m-alma": {"CORO": {"share": 13, "received": 100, "balance": -87}},
            "m-bruno": {"CORO": {"share": 13, "received": 0, "balance": 13}},
            "m-carmen": {"CORO": {"share": 13, "received": 0, "balance": 13}},
            "m-diego": {"CORO": {"share": 13, "received": 0, "balance": 13}},
            "m-elena": {"CORO": {"share": 13, "received": 0, "balance": 13}},
            "m-fausto": {"CORO": {"share": 13, "received": 0, "balance": 13}},
            "m-greta": {"CORO": {"share": 13, "received": 0, "balance": 13}},
            "m-ivan": {"CORO": {"share": 13, "received": 0, "balance": 13}}
          }
        },
        "windowTotals": {
          "m-alma": {"CORO": {"share": 13, "received": 100, "balance": -87}},
          "m-bruno": {"CORO": {"share": 13, "received": 0, "balance": 13}},
          "m-carmen": {"CORO": {"share": 13, "received": 0, "balance": 13}},
          "m-diego": {"CORO": {"share": 13, "received": 0, "balance": 13}},
          "m-elena": {"CORO": {"share": 13, "received": 0, "balance": 13}},
          "m-fausto": {"CORO": {"share": 13, "received": 0, "balance": 13}},
          "m-greta": {"CORO": {"share": 13, "received": 0, "balance": 13}},
          "m-ivan": {"CORO": {"share": 13, "received": 0, "balance": 13}}
        },
        "setAsides": [],
        "notes": []
      }
    },
    {
      "id": "cadence-on",
      "kind": "cadence",
      "description": "Eligible, did not lead last month, four available counted Sundays: on.",
      "covers": ["CAD-1", "cadence-on"],
      "input": {"ledCountedSundayPreviousMonth": false, "months": [{"month": "2026-11", "eligible": true, "availableCountedSundays": 4}]},
      "expected": [{"month": "2026-11", "state": "on", "reason": "on"}]
    },
    {
      "id": "cadence-led-previous-month",
      "kind": "cadence",
      "description": "She led a counted Sunday last month: off.",
      "covers": ["CAD-1", "led-previous-month"],
      "input": {"ledCountedSundayPreviousMonth": true, "months": [{"month": "2026-11", "eligible": true, "availableCountedSundays": 4}]},
      "expected": [{"month": "2026-11", "state": "off", "reason": "led_previous_month"}]
    },
    {
      "id": "cadence-untick-then-on",
      "kind": "cadence",
      "description": "Unticked from Sun.Lead in November (not eligible: the wire's out), eligible again in December and, not having led in November, on.",
      "covers": ["CAD-1", "not-eligible-then-on"],
      "input": {
        "ledCountedSundayPreviousMonth": false,
        "months": [{"month": "2026-11", "eligible": false, "availableCountedSundays": 4}, {"month": "2026-12", "eligible": true, "availableCountedSundays": 4}]
      },
      "expected": [{"month": "2026-11", "state": "off", "reason": "not_eligible"}, {"month": "2026-12", "state": "on", "reason": "on"}]
    },
    {
      "id": "cadence-no-available-sunday",
      "kind": "cadence",
      "description": "Eligible and did not lead last month, but her only available counted Sunday is rule-excluded from Sun.Lead, so the caller counts 0 (A14): off.",
      "covers": ["CAD-1", "CAD-2", "A14", "no-available-sunday"],
      "input": {"ledCountedSundayPreviousMonth": false, "months": [{"month": "2026-11", "eligible": true, "availableCountedSundays": 0}]},
      "expected": [{"month": "2026-11", "state": "off", "reason": "no_available_sunday"}]
    },
    {
      "id": "cadence-two-months-on-then-assumed",
      "kind": "cadence",
      "description": "A two-month run from a month she did not lead: November on, December assumes November followed its state.",
      "covers": ["CAD-1", "assumed-led-previous-month"],
      "input": {
        "ledCountedSundayPreviousMonth": false,
        "months": [{"month": "2026-11", "eligible": true, "availableCountedSundays": 4}, {"month": "2026-12", "eligible": true, "availableCountedSundays": 4}]
      },
      "expected": [{"month": "2026-11", "state": "on", "reason": "on"}, {"month": "2026-12", "state": "off", "reason": "assumed_led_previous_month"}]
    },
    {
      "id": "cadence-two-months-off-then-on",
      "kind": "cadence",
      "description": "A two-month run after a month she led: November off, December on.",
      "covers": ["CAD-1", "off-then-on"],
      "input": {
        "ledCountedSundayPreviousMonth": true,
        "months": [{"month": "2026-11", "eligible": true, "availableCountedSundays": 4}, {"month": "2026-12", "eligible": true, "availableCountedSundays": 4}]
      },
      "expected": [{"month": "2026-11", "state": "off", "reason": "led_previous_month"}, {"month": "2026-12", "state": "on", "reason": "on"}]
    },
    {
      "id": "cadence-pinned-sunday-in-off-month",
      "kind": "cadence",
      "description": "October was an off month, but a pinned Sunday Lead seat is a stored Lead seat like any other (CAD-2), so she led a counted Sunday in October and November is off.",
      "covers": ["CAD-2", "pinned-sunday-counts"],
      "input": {"ledCountedSundayPreviousMonth": true, "months": [{"month": "2026-11", "eligible": true, "availableCountedSundays": 4}]},
      "expected": [{"month": "2026-11", "state": "off", "reason": "led_previous_month"}]
    }
  ]
}
````

- [ ] **Step 2: Write its suite**

**Create** `app/utils/__tests__/fairnessGolden.test.ts`:

````ts
// Solver v3 C2 FX-1 … FX-5 — the golden fixture (`fixtures/fairness/golden.json`,
// IF2-29), asserted by vitest now and by C5's Python suite later. Expected values are
// hand-computed and frozen in the file; this suite never regenerates them. It asserts
// every `ledger` and `cadence` case and schema-checks `plan` cases (C5 adds them).
//
// What a `ledger` case asserts here (the file's `$comment` states the same):
//   · `window`: each window month and whether it is recorded;
//   · `months`: per listed month, every member with a line and every such line's
//     {share, received, balance} — exactly. A month outside the target's window (the
//     cumulative case) is checked by re-running the ledger with the target one month
//     after it, since a month's figures depend only on its own record and services;
//   · `windowTotals`: every member's window lines, exactly;
//   · `setAsides`: every set-aside of the window's months, exactly;
//   · `notes`: each listed note is emitted (others may be too);
//   · and, for every case, that the EXACT balances sum to 0 per (service, role key)
//     and per (presence rule, service) (FX-3).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { cadenceStates, computeFairnessLedger, fairnessLedgerExactSums, type LedgerInput } from "../fairnessLedger";
import { shiftMonth, type Figures, type LineKey, type Note, type RoleKey, type SetAsideReason } from "../fairnessVocabulary";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const FIXTURE = JSON.parse(readFileSync(path.join(REPO_ROOT, "fixtures/fairness/golden.json"), "utf8")) as {
  $comment: string;
  schemaVersion: number;
  units: string;
  sign: string;
  cases: GoldenCase[];
};

type Triple = { share: number; received: number; balance: number };
type LedgerExpected = {
  window: Array<{ month: string; recorded: boolean }>;
  months: Record<string, Record<string, Partial<Record<LineKey, Triple>>>>;
  windowTotals: Record<string, Partial<Record<LineKey, Triple>>>;
  setAsides: Array<{ serviceId: string; roleKey: RoleKey; memberId: string; reason: SetAsideReason }>;
  notes: Array<{ month: string; memberId: string; note: Note }>;
};
type GoldenCase = { id: string; description: string; covers: string[] } & (
  | { kind: "ledger"; input: LedgerInput; expected: LedgerExpected }
  | { kind: "cadence"; input: Parameters<typeof cadenceStates>[0]; expected: ReturnType<typeof cadenceStates> }
  | { kind: "plan"; input: unknown; expected: unknown }
);

const KINDS = new Set(["ledger", "cadence", "plan"]);
/** FX-5: the spec's fictitious people only. */
const FICTITIOUS = /^m-(alma|bruno|carmen|diego|elena|fausto|greta|ivan|julia)$/;

/** FX-4's required coverage, by the tag each case declares in `covers`. */
const REQUIRED_COVERAGE = [
  "uneven-division",
  "unavailable-record",
  "unavailable-live",
  "unrecorded-month",
  "not-in-record",
  "role-out",
  "outside-population",
  "exact",
  "exact-clamped",
  "exact-seat-population",
  "cadence-set-aside",
  "cadence-no-sunday-saturday",
  "presence-both-available",
  "presence-one-available",
  "presence-exclusive",
  "presence-non-exclusive",
  "presence-broken-exclusive",
  "presence-seat-order",
  "floor-by-date",
  "floor-by-role",
  "floor-by-time",
  "floor-cancelled-exact",
  "floor-cancelled-cadence",
  "exact-under-presence",
  "floor-outside-population",
  "special-sunday",
  "special-friday",
  "uncounted-special",
  "legacy-default",
  "drafts-count",
  "duplicate-target",
  "target-and-later-ignored",
  "cumulative-span",
  "exempt",
  "second-seat-two-roles",
  "second-seat-repeated",
  "exact-half",
  "cadence-on",
  "led-previous-month",
  "not-eligible-then-on",
  "no-available-sunday",
  "assumed-led-previous-month",
  "off-then-on",
  "pinned-sunday-counts",
];

const triple = (f: Figures): Triple => ({ share: f.share, received: f.received, balance: f.balance });
const triples = (lines: Partial<Record<LineKey, Figures>>) =>
  Object.fromEntries(Object.entries(lines).map(([line, f]) => [line, triple(f as Figures)]));

/** Every member's lines for `month`, members with none left out, re-targeting outside the window. */
function monthLines(input: LedgerInput, month: string): Record<string, Partial<Record<LineKey, Triple>>> {
  let out = computeFairnessLedger(input);
  if (!out.window.some((w) => w.month === month)) out = computeFairnessLedger({ ...input, target: shiftMonth(month, 1) });
  const result: Record<string, Partial<Record<LineKey, Triple>>> = {};
  for (const p of out.people) {
    const m = p.months.find((x) => x.month === month)!;
    if (Object.keys(m.lines).length > 0) result[p.memberId] = triples(m.lines);
  }
  return result;
}

const bySetAside = (a: LedgerExpected["setAsides"][number], b: LedgerExpected["setAsides"][number]) =>
  `${a.serviceId}|${a.roleKey}|${a.memberId}|${a.reason}` < `${b.serviceId}|${b.roleKey}|${b.memberId}|${b.reason}` ? -1 : 1;

describe("the golden fixture's schema (C2 IF2-29, FX-2, FX-5)", () => {
  it("has exactly IF2-29's top-level shape, plus FX-5's header", () => {
    expect(Object.keys(FIXTURE).sort()).toEqual(["$comment", "cases", "schemaVersion", "sign", "units"]);
    expect(FIXTURE).toMatchObject({ schemaVersion: 1, units: "hundredths", sign: "positive_owed" });
    expect(FIXTURE.$comment).toMatch(/FICTITIOUS/);
  });

  it("gives every case a unique kebab-case id, a known kind, a description, coverage, input and expected", () => {
    const ids = FIXTURE.cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of FIXTURE.cases) {
      expect(c.id, c.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(KINDS.has(c.kind), `${c.id}: unknown kind ${c.kind}`).toBe(true);
      expect(c.description.length, c.id).toBeGreaterThan(20);
      expect(c.covers.length, c.id).toBeGreaterThan(0);
      expect(c, c.id).toHaveProperty("input");
      expect(c, c.id).toHaveProperty("expected");
    }
  });

  it("covers every FX-4 requirement", () => {
    const covered = new Set(FIXTURE.cases.flatMap((c) => c.covers));
    expect(REQUIRED_COVERAGE.filter((tag) => !covered.has(tag))).toEqual([]);
  });

  it("names only the spec's fictitious people (FX-5)", () => {
    const ids = JSON.stringify(FIXTURE).match(/"m-[^"]*"/g) ?? [];
    for (const id of ids) expect(id.slice(1, -1)).toMatch(FICTITIOUS);
  });
});

describe("the golden fixture's ledger cases (FX-3)", () => {
  const cases = FIXTURE.cases.filter((c): c is Extract<GoldenCase, { kind: "ledger" }> => c.kind === "ledger");

  it("holds a real set of ledger cases", () => {
    expect(cases.length).toBeGreaterThanOrEqual(20);
  });

  describe.each(cases.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const out = computeFairnessLedger(c.input);

    it("matches the window", () => {
      expect(out.window.map((w) => ({ month: w.month, recorded: w.record !== null }))).toEqual(c.expected.window);
    });

    it("matches every listed month, every member, every line", () => {
      const months = new Set([...out.window.map((w) => w.month), ...Object.keys(c.expected.months)]);
      for (const month of months) expect(monthLines(c.input, month), month).toEqual(c.expected.months[month] ?? {});
    });

    it("matches the window totals", () => {
      const actual: Record<string, unknown> = {};
      for (const p of out.people) if (Object.keys(p.window).length > 0) actual[p.memberId] = triples(p.window);
      expect(actual).toEqual(c.expected.windowTotals);
    });

    it("matches every set-aside of the window", () => {
      const actual = out.people.flatMap((p) =>
        p.months.flatMap((m) => m.setAsides.map((x) => ({ serviceId: x.serviceId, roleKey: x.roleKey, memberId: p.memberId, reason: x.reason }))),
      );
      expect(actual.sort(bySetAside)).toEqual([...c.expected.setAsides].sort(bySetAside));
    });

    it("emits every listed note", () => {
      for (const { month, memberId, note } of c.expected.notes) {
        const notes = out.people.find((p) => p.memberId === memberId)?.months.find((m) => m.month === month)?.notes ?? [];
        expect(notes, `${memberId} ${month}`).toContainEqual(note);
      }
    });

    it("sums to exactly zero per (service, role key) and per (rule, service)", () => {
      for (const s of fairnessLedgerExactSums(c.input)) expect(s.numerator, `${s.month} ${s.serviceId} ${s.key}`).toBe("0");
    });
  });
});

describe("the golden fixture's cadence cases (CAD-1; TypeScript only, A18)", () => {
  const cases = FIXTURE.cases.filter((c): c is Extract<GoldenCase, { kind: "cadence" }> => c.kind === "cadence");

  it.each(cases.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    expect(cadenceStates(c.input)).toEqual(c.expected);
  });
});
````

- [ ] **Step 3: Run it**

Run: `git add -A && npx vitest run app/utils/__tests__/fairnessGolden.test.ts`
Expected: PASS (1 file, 144 tests). The ledger already exists (Task 9), so this step proves the hand values against it. A red case is a finding — in the ledger or in the case's design — to be re-derived by hand from the spec's rules; **never** copy the received value into the file.

- [ ] **Step 4: Gates and commit**

Run: `git add -A && npx tsc --noEmit && npm test && npx eslint .`
Expected: **462 files / 8541 tests**; 0 errors, 81 warnings.

```bash
git add -A
git commit -m "test(fairness): the golden fixture, hand-computed, and its vitest suite" -m "Solver v3 C2 FX-1 to FX-5 (IF2-29). fixtures/fairness/golden.json is the cross-language contract between the ledger and C5's solver: 22 ledger cases and 7 cadence cases covering every FX-4 requirement, with fictitious people and expected hundredths computed by hand (each case's description carries its arithmetic). The vitest suite asserts each ledger case's window, every listed month exactly (re-targeting for a month outside the window), the window totals, every set-aside, the listed notes and exact sum-to-zero, runs every cadence case, schema-checks plan cases and refuses an unknown kind."
```


---

## Task 11: `GET /api/admin/fairness` and the ledger reader — [standard; fail-closed read path]

Spec RD-1–RD-5, IF2-7, IF2-8, IF2-23 (the reader is the write-request module's second importer, for the parser). `loadFairnessLedger` checks `SANITY_API_READ_TOKEN` **before any read** (a dotted id would read as «no record»), reads the records through the last horizon month, the voice services from min(earliest record, target − 3) to the target, the horizon's freezing-service counts and the referenced members, all through `operationalClient` imported directly; every record passes the stored-record parser; any failure throws one fixed-message error after logging the error's class and status (or the parser's index-based issues) only. The route keeps the `solver-history` gate and answers one opaque 500 with no `people` key.

**Files:**
- Create: `app/utils/fairnessLedgerRead.ts`, `app/api/admin/fairness/route.ts`
- Modify: `app/utils/__tests__/serviceCommitCallers.test.ts` (the write-request module's importers)
- Test: `app/api/__tests__/fairnessLedgerRoute.test.ts`
- Regenerate: `app/utils/__tests__/__fixtures__/colour-inventory.json`

**Interfaces:**
- Consumes: Tasks 3 (builders), 5 (`parseStoredFairnessMonth`, `buildFairnessMonthDocument` in tests), 7 (the fake), 9 (`computeFairnessLedger`, `LedgerService`), 2 (resolvers); `serviceTodayIso`; `displayMemberName`; `serviceDayKey`.
- Produces: `FAIRNESS_LEDGER_UNAVAILABLE_ERROR_NAME`, `class FairnessLedgerUnavailableError`, `fairnessErrorClass(err): string`, `loadFairnessLedger(input: { month; horizon: 1 | 2; currentMonth; engine; environment; env? }): Promise<FairnessLedgerResponse>`; `GET` (route), `dynamic = "force-dynamic"`.

- [ ] **Step 1: Write the failing tests and the importer pin**

**Create** `app/api/__tests__/fairnessLedgerRoute.test.ts`:

````ts
// `GET /api/admin/fairness` — solver v3 C2 RD-1 … RD-5 through the real route, the real
// reader and the real ledger, over an in-memory Content Lake whose reads run the real
// GROQ builders. The clock is pinned to 20 Oct 2026 (CDMX). Every name is fictitious.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeFairnessSanity, type FakeDoc } from "@/app/utils/__tests__/__fixtures__/fakeFairnessSanity";
import { RECONSTRUCTION_RECORDED_BY, buildFairnessMonthDocument } from "@/app/utils/fairnessMonthWriteRequest";
import type { FairnessMonthWrite, RoleKey, Status } from "@/app/utils/fairnessVocabulary";

const h = vi.hoisted(() => ({
  requireActiveManager: vi.fn(),
  lake: null as unknown as ReturnType<typeof import("@/app/utils/__tests__/__fixtures__/fakeFairnessSanity").createFakeFairnessSanity>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/app/utils/authGuards", () => ({ requireActiveManager: () => h.requireActiveManager() }));
vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: (query: string, params: Record<string, unknown>) => h.lake.read.fetch(query, params) },
}));

import { GET } from "@/app/api/admin/fairness/route";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT: Record<RoleKey, Status> = {
  "Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "out", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out",
};
const MEMBERS: FakeDoc[] = [
  { _id: "m-alma", _type: "teamMembers", member_name: "Alma Ruiz", alias: "Alma", unavailableDates: [] },
  { _id: "m-bruno", _type: "teamMembers", member_name: "Bruno Díaz" },
  { _id: "m-carmen", _type: "teamMembers", member_name: "Carmen Soto" },
];

function body(month: string, ids = ["m-alma", "m-bruno", "m-carmen"]): FairnessMonthWrite {
  return {
    month,
    source: "auto",
    expectedRev: null,
    people: ids.map((memberId) => ({ memberId, roles: { ...OUT, "Sun.BGV": "in" as Status }, exactRules: [], exempt: false, blocks: [] })),
    presence: [],
  };
}
const stored = (month: string, ids?: string[]): FakeDoc =>
  ({
    ...buildFairnessMonthDocument({
      body: body(month, ids),
      source: "reconstructed",
      engine: "v2",
      environment: "local",
      recordedAt: `${month}-28T12:00:00.000Z`,
      recordedBy: RECONSTRUCTION_RECORDED_BY,
      names: new Map([["m-alma", "Alma"], ["m-bruno", "Bruno"], ["m-carmen", "Carmen"], ["m-gone", "Gina"]]),
    }),
  }) as unknown as FakeDoc;

const SERVICES: FakeDoc[] = [
  { _id: "sun-1004", _type: "sunday_role", week: "2026-10-04", published: false, BGVs: [{ _key: "a", _ref: "m-alma" }, { _key: "b", _ref: "m-bruno" }] },
  { _id: "sun-1011", _type: "sunday_role", week: "2026-10-11", BGVs: [{ _key: "a", _ref: "m-alma" }, { _key: "c", _ref: "m-carmen" }] },
];

const req = (query: string) => ({ nextUrl: new URL(`/api/admin/fairness?${query}`, "http://localhost") }) as unknown as NextRequest;
async function get(query: string) {
  const res = await GET(req(query));
  return { status: res.status, headers: res.headers, body: await res.json() };
}

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-20T18:00:00.000Z"));
  vi.stubEnv("SANITY_API_READ_TOKEN", "test-read-token");
  vi.stubEnv("OWT_SOLVER_ENGINE", "");
  vi.stubEnv("VERCEL_ENV", "");
  h.requireActiveManager.mockResolvedValue({ user: { role: "admin", sanityId: "m-admin" } });
  h.lake = createFakeFairnessSanity([...MEMBERS, ...SERVICES, stored("2026-10")]);
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  errors.mockRestore();
});

describe("the gate and the parameters (RD-4)", () => {
  it("answers 403 with no session and to a content-editor, reading nothing", async () => {
    h.requireActiveManager.mockResolvedValue(null);
    expect((await get("month=2026-11")).status).toBe(403);
    h.requireActiveManager.mockResolvedValue({ user: { role: "content-editor", sanityId: "m-ce" } });
    expect((await get("month=2026-11")).status).toBe(403);
    expect(h.lake.reads).toEqual([]);
  });

  it.each(["", "month=2026-13", "month=nov", "month=2026-11&horizon=3", "month=2026-11&horizon=0"])(
    "answers 400 invalid_request for %j",
    async (query) => {
      expect(await get(query)).toMatchObject({ status: 400, body: { error: "invalid_request" } });
    },
  );

  it("is dynamic", () => {
    expect(readFileSync(path.join(HERE, "../admin/fairness/route.ts"), "utf8")).toContain('export const dynamic = "force-dynamic";');
  });
});

describe("the payload (RD-1, RD-3, RD-5)", () => {
  it("answers the ledger with the engine, environment, current month, window and horizon, no-store", async () => {
    const res = await get("month=2026-11");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.body).toMatchObject({
      v: 1,
      engine: "v2",
      environment: "local",
      currentMonth: "2026-10",
      target: "2026-11",
      recordsSince: "2026-10",
      horizon: [{ month: "2026-11", record: null, storedServices: 0, recordBinds: false }],
    });
    expect(res.body.window.map((w: { month: string; record: unknown }) => [w.month, w.record !== null])).toEqual([
      ["2026-08", false],
      ["2026-09", false],
      ["2026-10", true],
    ]);
    // The draft (published: false) counts: Alma sat both Sundays, Bruno and Carmen one each.
    const alma = res.body.people.find((p: { memberId: string }) => p.memberId === "m-alma");
    expect(alma).toMatchObject({ name: "Alma", exists: true });
    expect(alma.window.BGV).toEqual({ share: 133, received: 200, balance: -67, seats: 2, tenths: { share: 13, balance: -7 } });
    expect(alma.months[2]).toMatchObject({ month: "2026-10", recorded: true, listed: true, held: { "Sun.BGV": 2 } });
    expect(alma).toMatchObject({ sang: 2, exempt: false, countedSundayLeads: [], firstRecordedIn: { "Sun.BGV": "2026-10" } });
    expect(res.body.people.map((p: { memberId: string }) => p.memberId)).toEqual(["m-alma", "m-bruno", "m-carmen"]);
  });

  it("names the horizon's records and decides recordBinds from freezing services only (A5, A6)", async () => {
    h.lake = createFakeFairnessSanity([
      ...MEMBERS,
      ...SERVICES,
      stored("2026-10"),
      stored("2026-11"),
      stored("2026-12"),
      { _id: "spc-1104", _type: "special_role", date: "2026-11-04" },
      { _id: "sun-1206", _type: "sunday_role", week: "2026-12-06" },
    ]);
    const res = await get("month=2026-11&horizon=2");
    expect(res.body.horizon.map((h: { month: string; storedServices: number; recordBinds: boolean }) => [h.month, h.storedServices, h.recordBinds])).toEqual([
      ["2026-11", 0, false],
      ["2026-12", 1, true],
    ]);
    expect(res.body.horizon[0].record).toMatchObject({ month: "2026-11", rev: "rev-0", source: "reconstructed", engine: "v2" });
    expect(res.body.horizon[0].record.people[0]).toMatchObject({ memberId: "m-alma", name: "Alma" });
  });

  it("is not a failure for a month without a record (F3)", async () => {
    h.lake = createFakeFairnessSanity([...MEMBERS, ...SERVICES]);
    const res = await get("month=2026-11");
    expect(res.status).toBe(200);
    expect(res.body.recordsSince).toBeNull();
    expect(res.body.people.every((p: { window: object }) => Object.keys(p.window).length === 0)).toBe(true);
  });

  it("names a deleted member from her record and lists her as unknown", async () => {
    h.lake = createFakeFairnessSanity([...MEMBERS, ...SERVICES, stored("2026-10", ["m-alma", "m-bruno", "m-carmen", "m-gone"])]);
    const res = await get("month=2026-11");
    expect(res.body.people.find((p: { memberId: string }) => p.memberId === "m-gone")).toMatchObject({ name: "Gina", exists: false });
    expect(res.body.diagnostics.unknownMembers).toEqual(["m-gone"]);
  });

  it("gives a byte-identical payload for the same data (determinism)", async () => {
    const first = JSON.stringify((await get("month=2026-11&horizon=2")).body);
    expect(JSON.stringify((await get("month=2026-11&horizon=2")).body)).toBe(first);
  });

  it("stays bounded at the limits: 100 people listed in three recorded months", async () => {
    const ids = Array.from({ length: 100 }, (_, i) => `m-${String(i).padStart(3, "0")}`);
    const members: FakeDoc[] = ids.map((id) => ({ _id: id, _type: "teamMembers", member_name: `Persona ${id}` }));
    const services: FakeDoc[] = ["2026-08-02", "2026-09-06", "2026-10-04"].map((week, i) => ({
      _id: `sun-${i}`,
      _type: "sunday_role",
      week,
      BGVs: ids.slice(0, 3).map((id, k) => ({ _key: `k${k}`, _ref: id })),
    }));
    const records = ["2026-08", "2026-09", "2026-10"].map((m) =>
      ({ ...buildFairnessMonthDocument({ body: body(m, ids), source: "auto", engine: "v3", environment: "production", recordedAt: "x", recordedBy: "m-admin", names: new Map(ids.map((id) => [id, id])) }) }) as unknown as FakeDoc,
    );
    h.lake = createFakeFairnessSanity([...members, ...services, ...records]);
    const res = await get("month=2026-11");
    expect(res.status).toBe(200);
    expect(res.body.people).toHaveLength(100);
    expect(JSON.stringify(res.body).length).toBeLessThan(1_000_000);
  });
});

describe("fail closed (RD-2)", () => {
  it.each(["", undefined])("refuses with the read token %j before any read, and has no people key", async (token) => {
    vi.stubEnv("SANITY_API_READ_TOKEN", token as string);
    const res = await get("month=2026-11");
    expect(res).toEqual(expect.objectContaining({ status: 500, body: { error: "fairness_unavailable", message: "No se pudo leer el saldo de equidad." } }));
    expect(h.lake.reads).toEqual([]);
  });

  it("refuses a rejected read, logging the error's class and status only", async () => {
    h.lake.failNext.fetch = Object.assign(new Error("request to https://x.api.sanity.io/?$ids=m-alma failed"), { statusCode: 503 });
    const res = await get("month=2026-11");
    expect(res.status).toBe(500);
    expect(res.body).not.toHaveProperty("people");
    const logged = errors.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(logged).toContain("Error 503");
    expect(logged).not.toContain("m-alma");
  });

  it("refuses a stored record missing a role field, logging an index-based path and no stored value (REC-7)", async () => {
    const broken = stored("2026-10");
    delete ((broken.people as Array<{ roles: Record<string, string> }>)[1].roles).sunBgv;
    h.lake = createFakeFairnessSanity([...MEMBERS, ...SERVICES, broken]);
    const res = await get("month=2026-11");
    expect(res.status).toBe(500);
    const logged = errors.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(logged).toContain("people[1].roles.sunBgv required field missing");
    expect(logged).not.toMatch(/m-alma|m-bruno|Alma|Bruno/);
  });

  it("refuses an unknown schemaVersion", async () => {
    h.lake = createFakeFairnessSanity([...MEMBERS, ...SERVICES, { ...stored("2026-10"), schemaVersion: 2 }]);
    expect((await get("month=2026-11")).status).toBe(500);
  });
});
````

**Find** in `app/utils/__tests__/serviceCommitCallers.test.ts`:

````ts
  // list grows only by a reviewed edit here — C2 adds `fairnessMonthCommit.ts` and
  // `fairnessLedgerRead.ts`; C4 adds its CLI file and its `scripts/lib` core.
  fairnessMonthWriteRequest: ["app/utils/fairnessMonthCommit.ts"],
  // Solver v3 C2 WR-1: the PUT route is the commit module's only caller (no MCP tool).
  fairnessMonthCommit: ["app/api/admin/fairness/months/route.ts"],
````

**Replace with:**

````ts
  // list grows only by a reviewed edit here — C2 adds `fairnessMonthCommit.ts` and
  // `fairnessLedgerRead.ts`; C4 adds its CLI file and its `scripts/lib` core.
  fairnessMonthWriteRequest: ["app/utils/fairnessLedgerRead.ts", "app/utils/fairnessMonthCommit.ts"],
  // Solver v3 C2 WR-1: the PUT route is the commit module's only caller (no MCP tool).
  fairnessMonthCommit: ["app/api/admin/fairness/months/route.ts"],
````

- [ ] **Step 2: Run them to see them fail**

Run: `git add -A && npx vitest run app/api/__tests__/fairnessLedgerRoute.test.ts app/utils/__tests__/serviceCommitCallers.test.ts`
Expected: FAIL — the route does not resolve and the pin lists an importer that does not exist.

- [ ] **Step 3: Implement**

**Create** `app/utils/fairnessLedgerRead.ts`:

````ts
import "server-only";

// app/utils/fairnessLedgerRead.ts
//
// `loadFairnessLedger` — the server-side reader behind `GET /api/admin/fairness` (solver
// v3 C2 RD-1 … RD-3). It reads the eligibility records, the voice services, the horizon's
// freezing-service counts and the referenced members through `operationalClient`
// imported DIRECTLY (published perspective, no CDN, the read token), every query a
// `serviceReadQueries.ts` builder with no `published` filter (prior-month drafts count),
// passes each record through the ONE record-schema check (`parseStoredFairnessMonth`)
// and hands everything to THE ledger (`computeFairnessLedger`). It performs no
// authorization: the route gates.
//
// FAIL CLOSED (RD-2): a record's id is DOTTED, so a read made WITHOUT the read token
// answers zero records with no error and the past would read as «sin registro» — the
// token is therefore checked before any read. That, a rejected read, a non-list answer
// or a record the parser refuses throws `FairnessLedgerUnavailableError`, whose message
// is fixed and carries no Sanity text. It never returns an empty or partial ledger in
// place of a failed read; a month without a record is not a failure (F3).
//
// Logs carry no content (spec §6 «Key hygiene» (c)): a failed read logs the error's class
// and status only (a raw client error can carry the request URL and its `$ids`); a
// refused record logs the parser's issues, whose paths are index-based and whose
// messages are fixed.

import { operationalClient } from "@/sanity/lib/operationalClient";

import { computeFairnessLedger, type LedgerService } from "./fairnessLedger";
import { parseStoredFairnessMonth } from "./fairnessMonthWriteRequest";
import {
  FAIRNESS_UNAVAILABLE_MESSAGE,
  compareCodepoint,
  monthIndex,
  shiftMonth,
  type FairnessLedgerResponse,
  type LogicalRecord,
} from "./fairnessVocabulary";
import { displayMemberName } from "./memberRuleNames";
import {
  fairnessMembersByIdsQuery,
  fairnessMonthsThroughQuery,
  serviceCountsInMonths,
  voiceRolesInRangeQuery,
  type BoundQuery,
} from "./serviceReadQueries";
import { serviceDayKey } from "./serviceReadSelect";

/** The `Error.name` the route discriminates on — pinned so neither side can drift. */
export const FAIRNESS_LEDGER_UNAVAILABLE_ERROR_NAME = "FairnessLedgerUnavailableError";

/** The ledger could not be read. Its message is fixed and carries nothing from Sanity. */
export class FairnessLedgerUnavailableError extends Error {
  constructor() {
    super(FAIRNESS_UNAVAILABLE_MESSAGE);
    this.name = FAIRNESS_LEDGER_UNAVAILABLE_ERROR_NAME;
  }
}

/** An error's class and HTTP status — never its message, which may carry the request. */
export function fairnessErrorClass(err: unknown): string {
  const name = err instanceof Error ? err.name : typeof err;
  const status = err && typeof err === "object" && "statusCode" in err ? ` ${String((err as { statusCode: unknown }).statusCode)}` : "";
  return `${name}${status}`;
}

async function readList(label: string, bound: BoundQuery): Promise<unknown[]> {
  let rows: unknown;
  try {
    rows = await operationalClient.fetch<unknown>(bound.query, bound.params);
  } catch (err) {
    console.error(`[fairnessLedgerRead] the ${label} read failed: ${fairnessErrorClass(err)}`);
    throw new FairnessLedgerUnavailableError();
  }
  if (!Array.isArray(rows)) {
    console.error(`[fairnessLedgerRead] the ${label} read returned no list`);
    throw new FairnessLedgerUnavailableError();
  }
  return rows;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const refs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : []);

/** An IF2-26 row → IF2-10's `LedgerService`; a row with no valid stored date is dropped. */
function toLedgerService(row: unknown): LedgerService | null {
  if (!isObj(row) || typeof row._id !== "string") return null;
  if (row._type !== "sunday_role" && row._type !== "saturday_role" && row._type !== "special_role") return null;
  const date = serviceDayKey(row.date);
  if (!date) return null;
  return {
    _id: row._id,
    _type: row._type,
    date,
    ...(typeof row.time === "string" ? { time: row.time } : {}),
    ...(typeof row.published === "boolean" ? { published: row.published } : {}),
    ...(typeof row.countsForFairness === "boolean" ? { countsForFairness: row.countsForFairness } : {}),
    Lead: refs(row.Lead),
    BGVs: refs(row.BGVs),
    Chorus: refs(row.Chorus),
  };
}

export async function loadFairnessLedger(input: {
  month: string;
  horizon: 1 | 2;
  currentMonth: string;
  engine: FairnessLedgerResponse["engine"];
  environment: FairnessLedgerResponse["environment"];
  env?: Readonly<Record<string, string | undefined>>;
}): Promise<FairnessLedgerResponse> {
  const env = input.env ?? process.env;
  if (!env.SANITY_API_READ_TOKEN) {
    console.error("[fairnessLedgerRead] SANITY_API_READ_TOKEN is not set: fairnessMonth ids are private, refusing to read");
    throw new FairnessLedgerUnavailableError();
  }
  const target = input.month;
  const horizonMonths = input.horizon === 2 ? [target, shiftMonth(target, 1)] : [target];

  // Records through the last horizon month, each through the ONE record-schema check.
  const recordRows = await readList("records", fairnessMonthsThroughQuery(horizonMonths[horizonMonths.length - 1]));
  const records: LogicalRecord[] = [];
  recordRows.forEach((row, i) => {
    const parsed = parseStoredFairnessMonth(row);
    if (!parsed.ok) {
      console.error(
        `[fairnessLedgerRead] stored record ${i + 1} of ${recordRows.length} failed the record-schema check: ` +
          parsed.issues.map((issue) => `${issue.path} ${issue.message}`).join("; "),
      );
      throw new FairnessLedgerUnavailableError();
    }
    records.push(parsed.record);
  });

  // Services from min(earliest record before the target, target − 3) to the target.
  const earliest = records.map((r) => r.month).filter((m) => monthIndex(m) < monthIndex(target)).sort(compareCodepoint)[0];
  const windowStart = shiftMonth(target, -3);
  const from = earliest && monthIndex(earliest) < monthIndex(windowStart) ? earliest : windowStart;
  const [serviceRows, countRows] = await Promise.all([
    readList("services", voiceRolesInRangeQuery(`${from}-01`, `${target}-01`)),
    readList("service counts", serviceCountsInMonths(horizonMonths)),
  ]);
  const services = serviceRows.map(toLedgerService).filter((s): s is LedgerService => s !== null);

  // The members the records and the seats reference (RD-5: nobody else).
  const ids = new Set<string>();
  for (const r of records) for (const p of r.people) ids.add(p.memberId);
  for (const s of services) for (const id of [...s.Lead, ...s.BGVs, ...s.Chorus]) ids.add(id);
  const memberRows = ids.size ? await readList("members", fairnessMembersByIdsQuery([...ids].sort(compareCodepoint))) : [];
  const members = memberRows.filter(isObj).filter((m) => typeof m._id === "string").map((m) => ({
    id: m._id as string,
    name: displayMemberName({ member_name: typeof m.member_name === "string" ? m.member_name : undefined, alias: typeof m.alias === "string" ? m.alias : undefined }),
    unavailableDates: Array.isArray(m.unavailableDates) ? m.unavailableDates.filter((d): d is string => typeof d === "string") : [],
  }));

  const ledger = computeFairnessLedger({ target, records, services, members });
  const freezing = new Map<string, number>();
  for (const row of countRows) {
    if (isObj(row) && typeof row.month === "string") freezing.set(row.month, Number(row.weekend ?? 0) + Number(row.countedSpecials ?? 0));
  }
  return {
    v: 1,
    engine: input.engine,
    environment: input.environment,
    currentMonth: input.currentMonth,
    target,
    window: ledger.window,
    recordsSince: ledger.recordsSince,
    horizon: horizonMonths.map((month) => {
      const record = records.find((r) => r.month === month) ?? null;
      const storedServices = freezing.get(month) ?? 0;
      return { month, record, storedServices, recordBinds: record !== null && storedServices > 0 };
    }),
    people: ledger.people,
    diagnostics: ledger.diagnostics,
  };
}
````

**Create** `app/api/admin/fairness/route.ts`:

````ts
// app/api/admin/fairness/route.ts
import { NextRequest, NextResponse } from "next/server";

import { serviceTodayIso } from "@/app/components/admin/serviceReadiness";
import { requireActiveManager } from "@/app/utils/authGuards";
import {
  FAIRNESS_LEDGER_UNAVAILABLE_ERROR_NAME,
  fairnessErrorClass,
  loadFairnessLedger,
} from "@/app/utils/fairnessLedgerRead";
import { FAIRNESS_UNAVAILABLE_MESSAGE, isMonthString } from "@/app/utils/fairnessVocabulary";
import { fairnessRecordEnvironment, resolveSolverEngine } from "@/app/utils/solverDeployment";

/**
 * `GET /api/admin/fairness?month=YYYY-MM[&horizon=1|2]` — the fairness ledger for a
 * target month (solver v3 C2 RD-3, RD-4; IF2-7, IF2-8): the 3-month window and the
 * cumulative balance per person and line, the horizon months' records with their
 * freezing-service counts and `recordBinds`, the effective engine and this deployment's
 * `environment`. Read-only; the «Equidad · vista previa» panel and (later) C6 read it.
 *
 * The gate is `solver-history`'s: manager-only, content-editor refused — the payload
 * exposes members' availability (L5). Every failure is ONE opaque `500
 * { error: "fairness_unavailable", message }` with NO `people` key, so a client can never
 * read a failed read as an empty ledger; `loadFairnessLedger` has already logged a read
 * failure, and anything else is logged here by class and stack — never a message, a
 * request or a payload (spec §6 «Key hygiene» (c)).
 */

export const dynamic = "force-dynamic";

async function gate() {
  const session = await requireActiveManager();
  if (!session) return null;
  if (session.user.role === "content-editor") return null;
  return session;
}

export async function GET(req: NextRequest) {
  const session = await gate();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const month = req.nextUrl.searchParams.get("month");
  const horizonParam = req.nextUrl.searchParams.get("horizon");
  if (!isMonthString(month) || (horizonParam !== null && horizonParam !== "1" && horizonParam !== "2")) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    const result = await loadFairnessLedger({
      month,
      horizon: horizonParam === "2" ? 2 : 1,
      currentMonth: serviceTodayIso().slice(0, 7),
      engine: resolveSolverEngine(process.env),
      environment: fairnessRecordEnvironment(process.env),
    });
    return NextResponse.json(result, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (!(err instanceof Error) || err.name !== FAIRNESS_LEDGER_UNAVAILABLE_ERROR_NAME) {
      const frames = err instanceof Error ? (err.stack ?? "").split("\n").slice(1).join("\n") : "";
      console.error(`[fairness route] unexpected failure reading the fairness ledger: ${fairnessErrorClass(err)}\n${frames}`);
    }
    return NextResponse.json({ error: "fairness_unavailable", message: FAIRNESS_UNAVAILABLE_MESSAGE }, { status: 500 });
  }
}
````

**Regenerate** `app/utils/__tests__/__fixtures__/colour-inventory.json` (it records `filesScanned`, and this task adds a file under `app/`):

```bash
node scripts/colour-inventory.mjs
```

- [ ] **Step 4: Run them to see them pass**

Run: `git add -A && npx vitest run app/api/__tests__/fairnessLedgerRoute.test.ts app/utils/__tests__/serviceCommitCallers.test.ts app/utils/__tests__/protectedReadAudit.test.ts`
Expected: PASS — the reader's `operationalClient` reads are compliant canonical reads, so the audit is unchanged.

- [ ] **Step 5: Gates and commit**

Run: `git add -A && npx tsc --noEmit && npm test && npx eslint .`
Expected: **463 files / 8559 tests**; 0 errors, 81 warnings.

```bash
git add -A
git commit -m "feat(fairness): GET /api/admin/fairness and the ledger reader" -m "Solver v3 C2 RD-1 to RD-5 (IF2-7, IF2-8). fairnessLedgerRead.ts reads the records, the voice services from the earliest record (or the window) to the target, the horizon's freezing-service counts and the referenced members through operationalClient, passes every record through the one record-schema check and returns the ledger with the horizon's records, counts and recordBinds. It fails closed: no read token (a dotted id would read as no record), a rejected read, a non-list answer or a refused record throws one fixed-message error; logs carry an error's class and status or the parser's index-based issues, never content. The route keeps the solver-history gate and answers one opaque 500 with no people key."
```


---

## Task 12: The v3 eligibility resolver — [standard; it builds the writer's bodies, so RES-8 is proven by a generated-input test]

Spec RES-1–RES-8, IF2-15. `resolveMonthEligibility` turns the on-screen rules and members into one month's body: the worship filter first (RES-5, so one config gives one body whoever is viewing); effective pools → the six role keys by current Tipo (RES-1); exclusions, «Exenta» (RES-2); `==` caps through `capValueForMonth`, refused out of range, overlapping or beside «Mes por medio», then made `exact` on the covered in-roles (RES-3); week exclusions on the planner's own numbering, the trailing Saturday included, and unavailable dates (RES-4); presence with exclusivity from the conflicts (RES-6); every name through C3's `resolveRulePersonId`/`cadenceMembers`, `no_tipo` included (RES-7). Its limits and the presence key grammar move into the vocabulary so the validator and the resolver share one definition, and the validator's member-id grammar admits every Sanity id (RES-8: an `ok` body must always pass it). The generated test runs 1500 seeded configs and rosters — names, aliases, namesakes, kids-only members with and without `voz`, stale ticks, out-of-range and fractional caps, presence edge cases — asserting `ok ⇒ validator ok` and no kids-only member in a body.

**Files:**
- Create: `app/utils/fairnessEligibility.ts`
- Modify: `app/utils/fairnessVocabulary.ts` (before «Months»), `app/utils/fairnessMonthWriteRequest.ts` (imports; `MEMBER_ID_RE`; `RULE_KEY_RE` removed; limits)
- Test: `app/utils/__tests__/fairnessEligibility.test.ts`
- Regenerate: `app/utils/__tests__/__fixtures__/colour-inventory.json`

**Interfaces:**
- Consumes: `rolesOfPatternV3`, `capValueForMonth`, `memberFitsRoleKey`, `memberFitsPool`, `saturdayForWeek`, `completeSundaySpine`, `ruleContextForTarget`, `resolveRulePersonId`, `cadenceMembers`, `normalizeMinistries`, `isValidServiceDate`; `validateFairnessMonthWrite` (test only).
- Produces: `RECORD_LIMITS`, `PRESENCE_RULE_KEY_RE` (`fairnessVocabulary.ts`); `type EligibilityMember`, `type EligibilityIssueCode`, `type EligibilityRefusalReason`, `type EligibilityResult`, `resolveMonthEligibility(input: { month: string; config: SolverConfig; members: EligibilityMember[] }): EligibilityResult` (IF2-15).

- [ ] **Step 1: Write the failing test**

**Create** `app/utils/__tests__/fairnessEligibility.test.ts`:

````ts
// Solver v3 C2 RES-1 … RES-8 — the eligibility resolver (IF2-15). Example tests per rule,
// per refusal and per issue; a generated-input test of RES-8's invariant (every `ok: true`
// body passes the record validator, and no kids-only member ever reaches it); and the
// viewer-independence test (a super-admin's roster and a worship admin's give one body).
// Every name is fictitious.
import { describe, expect, it } from "vitest";

import type { PersonRestriction, SolverConfig } from "@/app/components/admin/plannerModel";
import { normalizeMinistries } from "@/app/ministries";
import { resolveMonthEligibility, type EligibilityMember } from "../fairnessEligibility";
import { validateFairnessMonthWrite } from "../fairnessMonthWriteRequest";
import { shiftMonth, type RoleKey, type Status } from "../fairnessVocabulary";

const OUT: Record<RoleKey, Status> = {
  "Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "out", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out",
};
const ALMA: EligibilityMember = { _id: "m-alma", member_name: "Alma Ruiz", alias: "Alma", memberType: ["voz", "sunday_lead"] };
const BRUNO: EligibilityMember = { _id: "m-bruno", member_name: "Bruno Díaz", alias: "Bruno", memberType: ["voz", "saturday_lead"], ministries: ["worship"] };
const CARMEN: EligibilityMember = { _id: "m-carmen", member_name: "Carmen Soto", alias: "Carmen", memberType: ["voz", "support"], ministries: [] };
const DIEGO: EligibilityMember = { _id: "m-diego", member_name: "Diego Paz", alias: "Diego", memberType: ["voz", "sunday_lead"] };
const ROSTER = [ALMA, BRUNO, CARMEN, DIEGO];

const rule = (id: string, person: string, patch: Partial<PersonRestriction> = {}): PersonRestriction => ({
  id, person, excludedPatterns: [], fairness: "none", fairnessSlack: 1, weekExclusions: [], caps: [], ...patch,
});
const config = (patch: Partial<SolverConfig> = {}): SolverConfig => ({
  sundayLeads: ["m-alma", "m-diego"],
  saturdayLeads: ["m-bruno"],
  support: ["m-carmen"],
  restrictions: [],
  conflicts: [],
  presence: [],
  ...patch,
});
const resolve = (patch: Partial<SolverConfig> = {}, members = ROSTER, month = "2026-10") =>
  resolveMonthEligibility({ month, config: config(patch), members });
const bodyOf = (r: ReturnType<typeof resolveMonthEligibility>) => {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.body;
};
const personOf = (r: ReturnType<typeof resolveMonthEligibility>, id: string) => bodyOf(r).people.find((p) => p.memberId === id)!;

describe("pools → roles (RES-1)", () => {
  it("maps the Sunday, Saturday and support pools, each role only when the Tipo fits", () => {
    const r = resolve();
    expect(personOf(r, "m-alma").roles).toEqual({ "Sun.Lead": "in", "Sat.Lead": "in", "Sun.BGV": "in", "Sat.BGV": "in", "Sun.Choir": "in", "Sat.Choir": "in" });
    expect(personOf(r, "m-bruno").roles).toEqual({ ...OUT, "Sat.Lead": "in", "Sun.BGV": "in", "Sat.BGV": "in", "Sun.Choir": "in", "Sat.Choir": "in" });
    expect(personOf(r, "m-carmen").roles).toEqual({ ...OUT, "Sun.BGV": "in", "Sat.BGV": "in", "Sun.Choir": "in", "Sat.Choir": "in" });
  });

  it("reads a stale tick (a pool the current Tipo does not fit) as no pool at all", () => {
    const r = resolve({ sundayLeads: ["m-alma", "m-carmen"], support: [] });
    expect(personOf(r, "m-carmen").roles).toEqual(OUT);
  });

  it("lists every voz member once — out everywhere when in no pool — and nobody without voz", () => {
    const quiet: EligibilityMember = { _id: "m-elena", member_name: "Elena", memberType: ["voz", "support"] };
    const noVoz: EligibilityMember = { _id: "m-fausto", member_name: "Fausto", memberType: ["sunday_lead"] };
    const body = bodyOf(resolve({}, [...ROSTER, quiet, noVoz]));
    expect(body.people.map((p) => p.memberId)).toEqual(["m-alma", "m-bruno", "m-carmen", "m-diego", "m-elena"]);
    expect(body.people.find((p) => p.memberId === "m-elena")!.roles).toEqual(OUT);
  });

  it("never grants eligibility from a rule (no extraSupport, Q1)", () => {
    const outsider: EligibilityMember = { _id: "m-greta", member_name: "Greta", memberType: ["voz", "support"] };
    const r = resolve({ restrictions: [rule("r1", "Greta", { excludedPatterns: ["Sat.*"] })] }, [...ROSTER, outsider]);
    expect(personOf(r, "m-greta").roles).toEqual(OUT);
  });
});

describe("exclusions, «Exenta» and the six-key expansion (RES-2)", () => {
  it("sets the covered keys out — Sat.Choir included for Sat.*", () => {
    const r = resolve({ restrictions: [rule("r1", "Alma", { excludedPatterns: ["Sat.*"], fairness: "exempt" })] });
    expect(personOf(r, "m-alma")).toMatchObject({ roles: { ...OUT, "Sun.Lead": "in", "Sun.BGV": "in", "Sun.Choir": "in" }, exempt: true });
  });

  it("records slack as nothing (Q2, A10)", () => {
    expect(personOf(resolve({ restrictions: [rule("r1", "Alma", { fairness: "slack", fairnessSlack: 2 })] }), "m-alma").exempt).toBe(false);
  });
});

describe("exact rules (RES-3)", () => {
  const cap = (patch: object) => ({ id: "c1", pattern: "Sun.Lead", op: "==" as const, value: 2, relative: false, relOffset: 0, ...patch });

  it("makes the covered in-roles exact with the month's count", () => {
    const r = resolve({ restrictions: [rule("r1", "Alma", { caps: [cap({ pattern: "*.Lead", value: 2 })] })] });
    expect(personOf(r, "m-alma")).toMatchObject({
      roles: { "Sun.Lead": "exact", "Sat.Lead": "exact" },
      exactRules: [{ roles: ["Sun.Lead", "Sat.Lead"], count: 2 }],
    });
  });

  it("resolves a relative cap against the month's Sundays (Oct 2026: 4, Nov 2026: 5)", () => {
    const relative = { restrictions: [rule("r1", "Alma", { caps: [cap({ relative: true, relOffset: 2 })] })] };
    expect(personOf(resolve(relative, ROSTER, "2026-10"), "m-alma").exactRules).toEqual([{ roles: ["Sun.Lead"], count: 2 }]);
    expect(personOf(resolve(relative, ROSTER, "2026-11"), "m-alma").exactRules).toEqual([{ roles: ["Sun.Lead"], count: 3 }]);
  });

  it("turns a count of 0 into out with no item, and trims to the roles that are in", () => {
    const zero = resolve({ restrictions: [rule("r1", "Alma", { caps: [cap({ relative: true, relOffset: 9 })] })] });
    expect(personOf(zero, "m-alma")).toMatchObject({ roles: { "Sun.Lead": "out" }, exactRules: [] });
    const trimmed = resolve({ restrictions: [rule("r1", "Carmen", { caps: [cap({ pattern: "*.LeadBGV", value: 1 })] })] });
    expect(personOf(trimmed, "m-carmen").exactRules).toEqual([{ roles: ["Sun.BGV", "Sat.BGV"], count: 1 }]);
  });

  it("ignores <= and >= caps", () => {
    const r = resolve({ restrictions: [rule("r1", "Alma", { caps: [cap({ op: "<=" }), cap({ id: "c2", op: ">=" })] })] });
    expect(personOf(r, "m-alma").exactRules).toEqual([]);
  });

  it.each([1.5, -1, 32])("refuses an == value of %d as exact_count_range, even with no covered role in", (value) => {
    for (const person of ["Alma", "Carmen"]) {
      const r = resolve({ restrictions: [rule("r1", person, { caps: [cap({ value })] })] });
      expect(r).toEqual({ ok: false, issues: [], refusals: [{ person, reason: "exact_count_range" }] });
    }
  });

  it("refuses a fractional relOffset that is not clamped — even with no covered role in — accepts one that is, and accepts 0 and 31", () => {
    for (const person of ["Alma", "Carmen"]) {
      expect(resolve({ restrictions: [rule("r1", person, { caps: [cap({ relative: true, relOffset: 0.5 })] })] })).toEqual({
        ok: false,
        issues: [],
        refusals: [{ person, reason: "exact_count_range" }],
      });
    }
    expect(resolve({ restrictions: [rule("r1", "Alma", { caps: [cap({ relative: true, relOffset: 4.5 })] })] }).ok).toBe(true);
    expect(resolve({ restrictions: [rule("r1", "Alma", { caps: [cap({ value: 0 })] })] }).ok).toBe(true);
    expect(personOf(resolve({ restrictions: [rule("r1", "Alma", { caps: [cap({ value: 31 })] })] }), "m-alma").exactRules[0].count).toBe(31);
  });

  it("refuses two == caps of one member that share a role key, across two spellings (A38)", () => {
    const r = resolve({
      restrictions: [rule("r1", "Alma", { caps: [cap({})] }), rule("r2", "Alma Ruiz", { caps: [cap({ id: "c2", pattern: "*.Lead", value: 1 })] })],
    });
    expect(r).toEqual({ ok: false, issues: [], refusals: [{ person: "Alma", reason: "overlapping_exact" }] });
  });

  it("refuses «Mes por medio» with an == rule covering Sun.Lead (A11)", () => {
    const r = resolve({ restrictions: [rule("r1", "Alma", { sundayCadence: "alternate", caps: [cap({})] })] });
    expect(r).toEqual({ ok: false, issues: [], refusals: [{ person: "Alma", reason: "cadence_and_exact" }] });
  });
});

describe("dates (RES-4)", () => {
  it("blocks week exclusions on the week's weekend dates, by day class — the trailing Saturday is week weeks + 1", () => {
    // October 2026: Sundays 4, 11, 18, 25 (weeks = 4); week 2 = Sat 10 + Sun 11; week 5 = Sat 31.
    const r = resolve({
      restrictions: [
        rule("r1", "Alma", {
          weekExclusions: [
            { id: "w1", week: 2, pattern: "*.Lead" },
            { id: "w2", week: 5, pattern: "*.*" },
          ],
        }),
      ],
    });
    expect(personOf(r, "m-alma").blocks).toEqual([
      { date: "2026-10-10", unavailable: false, excludedRoles: ["Sat.Lead"] },
      { date: "2026-10-11", unavailable: false, excludedRoles: ["Sun.Lead"] },
      { date: "2026-10-31", unavailable: false, excludedRoles: ["Sat.Lead", "Sat.BGV", "Sat.Choir"] },
    ]);
  });

  it("marks the member's unavailable dates inside the month and merges them with exclusions", () => {
    const busy = { ...ALMA, unavailableDates: ["2026-10-11", "2026-10-11T00:00:00", "2026-11-01", "nope"] };
    const r = resolve({ restrictions: [rule("r1", "Alma", { weekExclusions: [{ id: "w1", week: 2, pattern: "Sun.BGV" }] })] }, [busy, BRUNO, CARMEN, DIEGO]);
    expect(personOf(r, "m-alma").blocks).toEqual([{ date: "2026-10-11", unavailable: true, excludedRoles: ["Sun.BGV"] }]);
  });
});

describe("names (RES-5, RES-7)", () => {
  it("refuses an unresolved and an ambiguous name, each named", () => {
    const twin: EligibilityMember = { _id: "m-alma2", member_name: "Alma", memberType: ["voz"] };
    const r = resolve({ restrictions: [rule("r1", "Nadie"), rule("r2", "Alma")] }, [...ROSTER, twin]);
    expect(r).toEqual({
      ok: false,
      issues: [],
      refusals: [
        { person: "Nadie", reason: "unresolved" },
        { person: "Alma", reason: "ambiguous" },
      ],
    });
  });

  it("counts a namesake without voz as ambiguous too", () => {
    const twin: EligibilityMember = { _id: "m-alma2", member_name: "Alma", memberType: [] };
    expect(resolve({ restrictions: [rule("r1", "Alma")] }, [...ROSTER, twin])).toMatchObject({ refusals: [{ person: "Alma", reason: "ambiguous" }] });
  });

  it("refuses a rule naming a member with no Tipo — the cadence setting included", () => {
    const empty: EligibilityMember = { _id: "m-elena", member_name: "Elena", memberType: [] };
    expect(resolve({ restrictions: [rule("r1", "Elena", { sundayCadence: "alternate" })] }, [...ROSTER, empty])).toEqual({
      ok: false,
      issues: [],
      refusals: [{ person: "Elena", reason: "no_tipo" }],
    });
  });

  it("puts sundayCadence on the people item of each cadence member", () => {
    const r = resolve({ restrictions: [rule("r1", "Diego", { sundayCadence: "alternate" })] });
    expect(personOf(r, "m-diego").sundayCadence).toBe("alternate");
    expect(personOf(r, "m-alma")).not.toHaveProperty("sundayCadence");
  });

  it("drops kids-only members before anything: never a person, a pool, a block or a name match", () => {
    const kidsAna: EligibilityMember = { _id: "m-kids", member_name: "Ana", alias: "Alma", memberType: ["voz", "sunday_lead"], ministries: ["kids"] };
    const r = resolve({ sundayLeads: ["m-alma", "m-diego", "m-kids"], restrictions: [rule("r1", "Alma", { excludedPatterns: ["Sat.*"] })] }, [...ROSTER, kidsAna]);
    expect(bodyOf(r).people.map((p) => p.memberId)).not.toContain("m-kids");
    expect(personOf(r, "m-alma").roles["Sat.Lead"]).toBe("out");
  });

  it("gives the same body for a worship admin's roster and a super-admin's (viewer independence)", () => {
    const kidsTwin: EligibilityMember = { _id: "m-kids", member_name: "Kim", alias: "Diego", memberType: ["voz", "sunday_lead"], ministries: ["kids"] };
    const cfg = { sundayLeads: ["m-alma", "m-diego", "m-kids"], restrictions: [rule("r1", "Diego", { sundayCadence: "alternate" as const })] };
    expect(resolve(cfg, [...ROSTER, kidsTwin])).toEqual(resolve(cfg, ROSTER));
  });
});

describe("presence (RES-6)", () => {
  const presence = (id: string, persons: string[], pattern = "Sun.BGV") => ({ id, persons, pattern });

  it("records members by id, the six-key roles, and exclusivity from the conflicts", () => {
    const r = resolve({
      presence: [presence("p-1", ["Carmen", "Alma"], "*.BGV")],
      conflicts: [{ id: "x1", personA: "Alma", personB: "Carmen", pattern: "*.LeadBGV" }],
    });
    expect(bodyOf(r).presence).toEqual([{ ruleKey: "p-1", roles: ["Sun.BGV", "Sat.BGV"], members: ["m-alma", "m-carmen"], exclusive: true }]);
    const partial = resolve({
      presence: [presence("p-1", ["Carmen", "Alma"], "*.BGV")],
      conflicts: [{ id: "x1", personA: "Alma", personB: "Carmen", pattern: "Sun.BGV" }],
    });
    expect(bodyOf(partial).presence[0].exclusive).toBe(false);
  });

  it("refuses a person whose Tipo has no voz as presence_member_not_listed", () => {
    const noVoz: EligibilityMember = { _id: "m-fausto", member_name: "Fausto", memberType: ["support"] };
    expect(resolve({ presence: [presence("p-1", ["Alma", "Fausto"])] }, [...ROSTER, noVoz])).toMatchObject({
      ok: false,
      refusals: [{ person: "Fausto", reason: "presence_member_not_listed" }],
    });
  });

  it.each([
    ["one member", [presence("p-1", ["Alma", "Alma Ruiz"])], [{ code: "presence_members", ruleKey: "p-1" }]],
    ["no roles", [presence("p-1", ["Alma", "Bruno"], "Nope.X")], [{ code: "presence_roles", ruleKey: "p-1" }]],
    ["an id outside the grammar", [presence("d alma", ["Alma", "Bruno"])], [{ code: "presence_rule_id", ruleKey: "d alma" }]],
    ["two rules sharing an id", [presence("p-1", ["Alma", "Bruno"]), presence("p-1", ["Carmen", "Diego"])], [{ code: "presence_rule_id", ruleKey: "p-1" }]],
    ["more than 20 rules", Array.from({ length: 21 }, (_, i) => presence(`p-${i}`, ["Alma", "Bruno"])), [{ code: "too_many_presence" }]],
  ])("issues %s", (_label, rules, issues) => {
    expect(resolve({ presence: rules })).toEqual({ ok: false, issues, refusals: [] });
  });

  it("issues more than 12 members", () => {
    const many: EligibilityMember[] = Array.from({ length: 13 }, (_, i) => ({ _id: `m-p${i}`, member_name: `P${i}`, memberType: ["voz", "support"] }));
    expect(resolve({ presence: [presence("p-1", many.map((m) => m.member_name))] }, [...ROSTER, ...many])).toMatchObject({
      ok: false,
      issues: [{ code: "presence_members", ruleKey: "p-1" }],
    });
  });
});

describe("people limits (RES-8)", () => {
  it("issues no_people when no worship member has voz", () => {
    expect(resolveMonthEligibility({ month: "2026-10", config: config(), members: [{ _id: "m-x", member_name: "X", memberType: [] }] })).toEqual({
      ok: false,
      issues: [{ code: "no_people" }],
      refusals: [],
    });
  });

  it("issues too_many_people over 100", () => {
    const members = Array.from({ length: 101 }, (_, i) => ({ _id: `m-${i}`, member_name: `P${i}`, memberType: ["voz", "support"] }));
    expect(resolveMonthEligibility({ month: "2026-10", config: config(), members })).toEqual({
      ok: false,
      issues: [{ code: "too_many_people" }],
      refusals: [],
    });
  });
});

// ─── RES-8: generated inputs ─────────────────────────────────────────────────

/** A small deterministic PRNG (mulberry32), so a failure reproduces from its seed. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = ["Alma", "Bruno", "Carmen", "Diego", "Elena", "Fausto", "Greta", "Iván", "Julia"];
const TIPOS = [[], ["voz"], ["voz", "sunday_lead"], ["voz", "saturday_lead"], ["voz", "support"], ["sunday_lead"], ["voz", "sunday_lead", "support"]];
const MINISTRIES: unknown[] = [undefined, [], ["worship"], ["kids"], ["worship", "kids"]];
const PATTERNS = ["Sun.*", "Sat.*", "*.*", "Sun.Lead", "Sat.Lead", "Sun.BGV", "Sat.BGV", "Sun.Choir", "*.Lead", "*.BGV", "*.LeadBGV", "Lead.*", "Choir.*", "bad"];
const VALUES = [0, 1, 2, 3, 31, 32, 1.5, -1, Number.NaN, Number.POSITIVE_INFINITY];
const OFFSETS = [0, 1, 2, 0.5, 4.5, 9];
const IDS = ["a1b2c3d", "d-alma", "d-alma-bruno", "bad id", "p-1", "p-1", "x".repeat(65)];
const MONTHS = ["2026-08", "2026-09", "2026-10", "2026-11", "2027-02"];

function generate(seed: number): { month: string; config: SolverConfig; members: EligibilityMember[] } {
  const r = rng(seed);
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(r() * list.length)];
  const some = <T,>(list: readonly T[], max: number): T[] => Array.from({ length: Math.floor(r() * (max + 1)) }, () => pick(list));
  const members: EligibilityMember[] = Array.from({ length: 2 + Math.floor(r() * 7) }, (_, i) => {
    const name = pick(NAMES);
    return {
      _id: `m-${i}-${name.normalize("NFD").replace(/[^A-Za-z]/g, "").toLowerCase()}`, // Sanity ids are ASCII
      member_name: `${name} ${i}`,
      ...(r() < 0.6 ? { alias: r() < 0.2 ? pick(NAMES) : name } : {}),
      memberType: [...pick(TIPOS)],
      ...(r() < 0.8 ? { ministries: pick(MINISTRIES) } : {}),
      unavailableDates: some(["2026-10-04", "2026-10-11", "2026-11-01", "2026-09-06", "x"], 2),
    };
  });
  const person = () => (r() < 0.85 ? pick(members).alias ?? pick(members).member_name : pick(["Nadie", ...NAMES]));
  const ids = members.map((m) => m._id);
  return {
    month: pick(MONTHS),
    members,
    config: {
      sundayLeads: some(ids, 3),
      saturdayLeads: some(ids, 3),
      support: some(ids, 4),
      restrictions: Array.from({ length: Math.floor(r() * 4) }, (_, i) => ({
        id: `r${i}`,
        person: person(),
        excludedPatterns: some(PATTERNS, 2),
        fairness: pick(["none", "exempt", "slack"] as const),
        fairnessSlack: 1,
        weekExclusions: some([1, 2, 3, 4, 5, 6], 2).map((week, k) => ({ id: `w${k}`, week, pattern: pick(PATTERNS) })),
        caps: some(["==", "<=", ">="] as const, 2).map((op, k) => ({
          id: `c${k}`,
          pattern: pick(PATTERNS),
          op,
          value: pick(VALUES),
          relative: r() < 0.3,
          relOffset: pick(OFFSETS),
        })),
        ...(r() < 0.2 ? { sundayCadence: "alternate" as const } : {}),
      })),
      conflicts: Array.from({ length: Math.floor(r() * 3) }, (_, i) => ({ id: `x${i}`, personA: person(), personB: person(), pattern: pick(PATTERNS) })),
      presence: Array.from({ length: Math.floor(r() * 3) }, () => ({
        id: pick(IDS),
        persons: Array.from({ length: Math.floor(r() * 4) }, person),
        pattern: pick(PATTERNS),
      })),
    },
  };
}

describe("RES-8: an ok body always passes the validator, and holds no kids-only member", () => {
  it("over 1500 generated configs and rosters", () => {
    let accepted = 0;
    for (let seed = 1; seed <= 1500; seed += 1) {
      const input = generate(seed);
      const result = resolveMonthEligibility(input);
      if (!result.ok) continue;
      accepted += 1;
      const entry = { ...result.body, source: "auto", expectedRev: null };
      for (const currentMonth of [input.month, shiftMonth(input.month, -12)]) {
        const checked = validateFairnessMonthWrite(entry, "route", currentMonth);
        expect(checked.ok ? [] : checked.issues, `seed ${seed}`).toEqual([]);
      }
      const notWorship = new Set(input.members.filter((m) => !normalizeMinistries(m.ministries).includes("worship")).map((m) => m._id));
      const named = [...result.body.people.map((p) => p.memberId), ...result.body.presence.flatMap((p) => p.members)];
      expect(named.filter((id) => notWorship.has(id)), `seed ${seed}`).toEqual([]);
    }
    expect(accepted).toBeGreaterThan(100);
  });
});
````

- [ ] **Step 2: Run it to see it fail**

Run: `git add -A && npx vitest run app/utils/__tests__/fairnessEligibility.test.ts`
Expected: FAIL — `../fairnessEligibility` does not resolve.

- [ ] **Step 3: Implement**

**Find** in `app/utils/fairnessVocabulary.ts`:

````ts
  return a < b ? -1 : a > b ? 1 : 0;
}

// ─── Months ─────────────────────────────────────────────────────────────────
````

**Replace with:**

````ts
  return a < b ? -1 : a > b ? 1 : 0;
}

// ─── Record limits (WR-4, REC-4) ───────────────────────────────────────────
//
// One definition for the record's validator and the eligibility resolver, which must
// never build a body the validator refuses (RES-8). `people` is C5's request limit too.

export const RECORD_LIMITS = {
  people: 100,
  presenceRules: 20,
  presenceMembersMin: 2,
  presenceMembersMax: 12,
  exactCountMax: 31,
  monthsAhead: 12,
} as const;

/** REC-4's presence rule key grammar (a config rule id, unchanged — a PRIVATE identifier, §6). */
export const PRESENCE_RULE_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;

// ─── Months ─────────────────────────────────────────────────────────────────
````

**Find** in `app/utils/fairnessMonthWriteRequest.ts`:

````ts

import {
  ROLE_KEYS,
  canonicalRoles,
````

**Replace with:**

````ts

import {
  PRESENCE_RULE_KEY_RE,
  RECORD_LIMITS,
  ROLE_KEYS,
  canonicalRoles,
````

**Find** in `app/utils/fairnessMonthWriteRequest.ts`:

````ts
}

/** A Sanity document id (letters, digits, `.`, `_`, `-`; ≤ 128). */
const MEMBER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** REC-4's presence rule key grammar. */
export const RULE_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;

const at = (base: string, key: string) => (base ? `${base}.${key}` : key);
````

**Replace with:**

````ts
}

/** A Sanity document id: letters, digits, `.`, `_`, `-`, at most 128 — any id the roster can hold (RES-8). */
const MEMBER_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

const at = (base: string, key: string) => (base ? `${base}.${key}` : key);
````

**Find** in `app/utils/fairnessMonthWriteRequest.ts`:

````ts
  const monthOk = isMonthString(month);
  if (!monthOk) issues.push({ path: "month", message: MSG.month });
  else if (isMonthString(currentMonth) && monthIndex(month) > monthIndex(currentMonth) + 12) {
    issues.push({ path: "month", message: MSG.monthCeiling });
  }
````

**Replace with:**

````ts
  const monthOk = isMonthString(month);
  if (!monthOk) issues.push({ path: "month", message: MSG.month });
  else if (isMonthString(currentMonth) && monthIndex(month) > monthIndex(currentMonth) + RECORD_LIMITS.monthsAhead) {
    issues.push({ path: "month", message: MSG.monthCeiling });
  }
````

**Find** in `app/utils/fairnessMonthWriteRequest.ts`:

````ts
  if (!Array.isArray(body.people)) issues.push({ path: "people", message: MSG.array });
  else {
    if (body.people.length < 1 || body.people.length > 100) issues.push({ path: "people", message: MSG.peopleCount });
    body.people.forEach((person, i) => validatePerson(person, idx("people", i), monthOk ? month : null, memberIds, issues));
  }
````

**Replace with:**

````ts
  if (!Array.isArray(body.people)) issues.push({ path: "people", message: MSG.array });
  else {
    if (body.people.length < 1 || body.people.length > RECORD_LIMITS.people) issues.push({ path: "people", message: MSG.peopleCount });
    body.people.forEach((person, i) => validatePerson(person, idx("people", i), monthOk ? month : null, memberIds, issues));
  }
````

**Find** in `app/utils/fairnessMonthWriteRequest.ts`:

````ts
  if (!Array.isArray(body.presence)) issues.push({ path: "presence", message: MSG.array });
  else {
    if (body.presence.length > 20) issues.push({ path: "presence", message: MSG.presenceCount });
    const ruleKeys = new Set<string>();
    body.presence.forEach((rule, j) => validatePresence(rule, idx("presence", j), memberIds, ruleKeys, issues));
````

**Replace with:**

````ts
  if (!Array.isArray(body.presence)) issues.push({ path: "presence", message: MSG.array });
  else {
    if (body.presence.length > RECORD_LIMITS.presenceRules) issues.push({ path: "presence", message: MSG.presenceCount });
    const ruleKeys = new Set<string>();
    body.presence.forEach((rule, j) => validatePresence(rule, idx("presence", j), memberIds, ruleKeys, issues));
````

**Find** in `app/utils/fairnessMonthWriteRequest.ts`:

````ts
          }
        }
        if (!(Number.isInteger(rule.count) && (rule.count as number) >= 1 && (rule.count as number) <= 31)) {
          issues.push({ path: at(rulePath, "count"), message: MSG.count });
        }
````

**Replace with:**

````ts
          }
        }
        if (!(Number.isInteger(rule.count) && (rule.count as number) >= 1 && (rule.count as number) <= RECORD_LIMITS.exactCountMax)) {
          issues.push({ path: at(rulePath, "count"), message: MSG.count });
        }
````

**Find** in `app/utils/fairnessMonthWriteRequest.ts`:

````ts
  }
  unknownFields(rule, PRESENCE_FIELDS, path, issues);
  if (typeof rule.ruleKey !== "string" || !RULE_KEY_RE.test(rule.ruleKey)) {
    issues.push({ path: at(path, "ruleKey"), message: MSG.ruleKey });
  } else if (ruleKeys.has(rule.ruleKey)) issues.push({ path: at(path, "ruleKey"), message: MSG.duplicateRule });
````

**Replace with:**

````ts
  }
  unknownFields(rule, PRESENCE_FIELDS, path, issues);
  if (typeof rule.ruleKey !== "string" || !PRESENCE_RULE_KEY_RE.test(rule.ruleKey)) {
    issues.push({ path: at(path, "ruleKey"), message: MSG.ruleKey });
  } else if (ruleKeys.has(rule.ruleKey)) issues.push({ path: at(path, "ruleKey"), message: MSG.duplicateRule });
````

**Find** in `app/utils/fairnessMonthWriteRequest.ts`:

````ts
  if (
    !Array.isArray(members) ||
    members.length < 2 ||
    members.length > 12 ||
    !members.every((m) => typeof m === "string" && memberIds.has(m)) ||
    new Set(members).size !== members.length
````

**Replace with:**

````ts
  if (
    !Array.isArray(members) ||
    members.length < RECORD_LIMITS.presenceMembersMin ||
    members.length > RECORD_LIMITS.presenceMembersMax ||
    !members.every((m) => typeof m === "string" && memberIds.has(m)) ||
    new Set(members).size !== members.length
````

**Create** `app/utils/fairnessEligibility.ts`:

````ts
// app/utils/fairnessEligibility.ts
//
// THE v3 eligibility resolver (solver v3 C2 RES-1 … RES-8, spec IF2-15; parent A7): the
// single definition of "what eligibility a month was solved with". It turns the
// ON-SCREEN planner state — the rule set (unsaved edits included) and the planner's
// member list — into one month's record body. «Registrar» calls it; C6 builds both its
// solve request's per-role eligibility and its confirm body from one call of it; C4 and
// C7 run it over the worship roster read and the stored rule set.
//
// NEUTRAL AND CLIENT-CALLABLE (ADR-0028): no "use client", no `server-only`, no I/O and
// no `node:crypto` — so it is NOT in the write-request module, which hashes. Because a
// client cannot run the record validator, the resolver guarantees its output instead
// (RES-8, parent A38): an `ok: true` body, completed with `source` and `expectedRev`,
// always passes `validateFairnessMonthWrite`; every input that would not answers
// `ok: false`, naming each refused person and each issue. Nothing is dropped or
// repaired silently.
//
// Names resolve to EXACTLY ONE worship member through C3's `resolveRulePersonId` and
// `cadenceMembers` (never v2's first match), over the roster after this module drops
// every non-worship member itself (RES-5) — so one config gives one body whoever is
// viewing. Members are handed on with `ministries` as read.

import { normalizeMinistries } from "@/app/ministries";
import {
  memberFitsPool,
  memberFitsRoleKey,
  rolesOfPatternV3,
  saturdayForWeek,
  type SolverConfig,
} from "@/app/components/admin/plannerModel";
import { capValueForMonth, completeSundaySpine, ruleContextForTarget } from "@/app/components/admin/serviceRuleContext";
import {
  PRESENCE_RULE_KEY_RE,
  RECORD_LIMITS,
  ROLE_KEYS,
  SATURDAY_KEYS,
  SUNDAY_KEYS,
  canonicalRoles,
  compareCodepoint,
  type FairnessMonthBody,
  type RoleKey,
  type Status,
} from "./fairnessVocabulary";
import { isValidServiceDate } from "./serviceReadModel";
import { cadenceMembers, resolveRulePersonId, type RosterMember } from "./sundayCadence";

export type EligibilityIssueCode =
  | "no_people"
  | "too_many_people"
  | "too_many_presence"
  | "presence_rule_id"
  | "presence_roles"
  | "presence_members";

export type EligibilityRefusalReason =
  | "unresolved"
  | "ambiguous"
  | "no_tipo"
  | "cadence_and_exact"
  | "overlapping_exact"
  | "exact_count_range"
  | "presence_member_not_listed";

export type EligibilityMember = {
  _id: string;
  member_name: string;
  alias?: string;
  memberType?: string[];
  ministries?: unknown;
  unavailableDates?: string[];
};

export type EligibilityResult =
  | { ok: true; body: FairnessMonthBody }
  | {
      ok: false;
      issues: Array<{ code: EligibilityIssueCode; ruleKey?: string }>;
      refusals: Array<{ person: string; reason: EligibilityRefusalReason }>;
    };

interface Item {
  roles: Record<RoleKey, Status>;
  exactRules: Array<{ roles: RoleKey[]; count: number }>;
  cadence: boolean;
  exempt: boolean;
  blocks: Map<string, { unavailable: boolean; excluded: Set<RoleKey> }>;
}

/** The weekend dates of week `week` of `month` by the planner's own numbering (RES-4). */
function weekendDatesOfWeek(month: string, week: number): Array<{ date: string; keys: readonly RoleKey[] }> {
  const spine = completeSundaySpine(month);
  const candidates: Array<{ date: string; type: "sunday_role" | "saturday_role"; keys: readonly RoleKey[] }> = [];
  if (week >= 1 && week <= spine.length) candidates.push({ date: spine[week - 1], type: "sunday_role", keys: SUNDAY_KEYS });
  const saturday = saturdayForWeek(week, spine);
  if (saturday) candidates.push({ date: saturday, type: "saturday_role", keys: SATURDAY_KEYS });
  return candidates.filter((c) => {
    if (c.date.slice(0, 7) !== month) return false;
    const context = ruleContextForTarget(c.type, c.date);
    return context !== null && context.month === month && context.week === week;
  });
}

export function resolveMonthEligibility(input: {
  month: string;
  config: SolverConfig;
  members: EligibilityMember[];
}): EligibilityResult {
  const { month, config } = input;
  // RES-5 — the worship filter first; members keep every field, `ministries` included.
  const roster = input.members.filter((m) => normalizeMinistries(m.ministries).includes("worship"));
  const byId = new Map(roster.map((m) => [m._id, m]));

  const refusals: Array<{ person: string; reason: EligibilityRefusalReason }> = [];
  const issues: Array<{ code: EligibilityIssueCode; ruleKey?: string }> = [];
  const refuse = (person: string, reason: EligibilityRefusalReason) => {
    if (!refusals.some((r) => r.person === person && r.reason === reason)) refusals.push({ person, reason });
  };
  // RES-7 — exactly one worship member, with a Tipo, or a named refusal.
  const resolve = (person: string): string | null => {
    const found = resolveRulePersonId(person, roster as RosterMember[]);
    if (!found.ok) {
      refuse(person, found.reason);
      return null;
    }
    if ((byId.get(found.id)?.memberType ?? []).length === 0) {
      refuse(person, "no_tipo");
      return null;
    }
    return found.id;
  };

  // People: every worship member whose Tipo includes `voz` (RES-5), all roles out at first.
  const items = new Map<string, Item>();
  for (const m of [...roster].sort((a, b) => compareCodepoint(a._id, b._id))) {
    if (!(m.memberType ?? []).includes("voz")) continue;
    const roles = Object.fromEntries(ROLE_KEYS.map((k) => [k, "out"])) as Record<RoleKey, Status>;
    // RES-1 — pools → roles: the EFFECTIVE pool (ticked and fitting by current Tipo), each
    // role only when the Tipo fits it. A stale tick puts nobody anywhere.
    const sunday = config.sundayLeads.includes(m._id) && memberFitsPool(m, "sundayLeads");
    const saturday = config.saturdayLeads.includes(m._id) && memberFitsPool(m, "saturdayLeads");
    const support = config.support.includes(m._id) && memberFitsPool(m, "support");
    for (const k of ROLE_KEYS) {
      const pooled = k === "Sun.Lead" ? sunday : k === "Sat.Lead" ? sunday || saturday : sunday || saturday || support;
      if (pooled && memberFitsRoleKey(m, k)) roles[k] = "in";
    }
    items.set(m._id, { roles, exactRules: [], cadence: false, exempt: false, blocks: new Map() });
  }
  const block = (item: Item, date: string) => {
    const found = item.blocks.get(date) ?? { unavailable: false, excluded: new Set<RoleKey>() };
    item.blocks.set(date, found);
    return found;
  };

  // Cadence (RES-7): the setting on each listed id `cadenceMembers` returns.
  const cadence = cadenceMembers(config, roster as RosterMember[]);
  for (const r of cadence.refusals) refuse(r.person, r.reason);

  // Restrictions: exclusions, «Exenta», week exclusions; `==` caps collected per member.
  const caps = new Map<string, Array<{ person: string; roles: RoleKey[]; count: number | null }>>();
  for (const r of config.restrictions) {
    const id = resolve(r.person);
    if (id === null) continue;
    for (const cap of r.caps) {
      if (cap.op !== "==") continue;
      const value = capValueForMonth(cap, month);
      const inRange = value.ok && value.count <= RECORD_LIMITS.exactCountMax;
      if (!inRange) refuse(r.person, "exact_count_range"); // RES-3: judged on the cap itself
      caps.set(id, [...(caps.get(id) ?? []), { person: r.person, roles: rolesOfPatternV3(cap.pattern), count: inRange && value.ok ? value.count : null }]);
    }
    const item = items.get(id);
    if (!item) continue; // no `voz`: nothing to record for her
    for (const pattern of r.excludedPatterns) for (const k of rolesOfPatternV3(pattern)) item.roles[k] = "out";
    if (r.fairness === "exempt") item.exempt = true;
    for (const ex of r.weekExclusions) {
      const roles = rolesOfPatternV3(ex.pattern);
      for (const { date, keys } of weekendDatesOfWeek(month, ex.week)) {
        const excluded = keys.filter((k) => roles.includes(k));
        if (excluded.length) for (const k of excluded) block(item, date).excluded.add(k);
      }
    }
  }
  for (const id of cadence.ids) {
    const item = items.get(id);
    if (item) item.cadence = true;
  }

  // RES-3 — the exact rules: overlaps and «Mes por medio» judged on the expansions.
  for (const [id, list] of caps) {
    const seen = new Set<RoleKey>();
    let overlapping = false;
    for (const cap of list) {
      if (cap.roles.some((k) => seen.has(k))) overlapping = true;
      for (const k of cap.roles) seen.add(k);
    }
    if (overlapping) refuse(list[0].person, "overlapping_exact");
    if (cadence.ids.includes(id)) {
      const covering = list.find((cap) => cap.roles.includes("Sun.Lead"));
      if (covering) refuse(covering.person, "cadence_and_exact");
    }
    const item = items.get(id);
    if (!item || overlapping) continue;
    for (const cap of list) {
      if (cap.count === null) continue;
      const covered = canonicalRoles(cap.roles.filter((k) => item.roles[k] === "in"));
      if (covered.length === 0) continue;
      if (cap.count === 0) for (const k of covered) item.roles[k] = "out";
      else {
        for (const k of covered) item.roles[k] = "exact";
        item.exactRules.push({ roles: covered, count: cap.count });
      }
    }
  }

  // Unavailable dates inside the month (RES-4).
  for (const [id, item] of items) {
    for (const raw of byId.get(id)?.unavailableDates ?? []) {
      const date = typeof raw === "string" ? raw.slice(0, 10) : "";
      if (isValidServiceDate(date) && date.slice(0, 7) === month) block(item, date).unavailable = true;
    }
  }

  // RES-6 — presence.
  if (config.presence.length > RECORD_LIMITS.presenceRules) issues.push({ code: "too_many_presence" });
  const idCount = new Map<string, number>();
  for (const rule of config.presence) idCount.set(rule.id, (idCount.get(rule.id) ?? 0) + 1);
  const conflicts = config.conflicts.map((c) => ({ a: resolve(c.personA), b: resolve(c.personB), roles: rolesOfPatternV3(c.pattern) }));
  const presence: FairnessMonthBody["presence"] = [];
  for (const rule of config.presence) {
    const badId = !PRESENCE_RULE_KEY_RE.test(rule.id) || (idCount.get(rule.id) ?? 0) > 1;
    if (badId && !issues.some((i) => i.code === "presence_rule_id" && i.ruleKey === rule.id)) {
      issues.push({ code: "presence_rule_id", ruleKey: rule.id });
    }
    const members: string[] = [];
    for (const person of rule.persons) {
      const id = resolve(person);
      if (id === null) continue;
      if (!items.has(id)) refuse(person, "presence_member_not_listed");
      else if (!members.includes(id)) members.push(id);
    }
    const roles = rolesOfPatternV3(rule.pattern);
    if (roles.length === 0) issues.push({ code: "presence_roles", ruleKey: rule.id });
    if (members.length < RECORD_LIMITS.presenceMembersMin || members.length > RECORD_LIMITS.presenceMembersMax) {
      issues.push({ code: "presence_members", ruleKey: rule.id });
    }
    members.sort(compareCodepoint);
    const exclusive = members.every((a, i) =>
      members.slice(i + 1).every((b) =>
        conflicts.some((c) => ((c.a === a && c.b === b) || (c.a === b && c.b === a)) && roles.every((k) => c.roles.includes(k))),
      ),
    );
    presence.push({ ruleKey: rule.id, roles, members, exclusive });
  }

  if (items.size === 0) issues.push({ code: "no_people" });
  if (items.size > RECORD_LIMITS.people) issues.push({ code: "too_many_people" });
  if (refusals.length > 0 || issues.length > 0) return { ok: false, issues, refusals };

  return {
    ok: true,
    body: {
      month,
      people: [...items].map(([memberId, item]) => ({
        memberId,
        roles: item.roles,
        exactRules: [...item.exactRules].sort((a, b) => compareCodepoint(a.roles.join(","), b.roles.join(","))),
        ...(item.cadence ? { sundayCadence: "alternate" as const } : {}),
        exempt: item.exempt,
        blocks: [...item.blocks]
          .filter(([, b]) => b.unavailable || b.excluded.size > 0)
          .sort(([a], [b]) => compareCodepoint(a, b))
          .map(([date, b]) => ({ date, unavailable: b.unavailable, excludedRoles: canonicalRoles(b.excluded) })),
      })),
      presence: presence.sort((a, b) => compareCodepoint(a.ruleKey, b.ruleKey)),
    },
  };
}
````

**Regenerate** `app/utils/__tests__/__fixtures__/colour-inventory.json` (it records `filesScanned`, and this task adds a file under `app/`):

```bash
node scripts/colour-inventory.mjs
```

- [ ] **Step 4: Run it to see it pass**

Run: `git add -A && npx vitest run app/utils/__tests__/fairnessEligibility.test.ts app/utils/__tests__/fairnessMonthWriteRequest.test.ts app/utils/__tests__/fairnessMonthExecutor.test.ts app/utils/__tests__/sundayCadence.test.ts`
Expected: PASS — at least 100 of the 1500 generated inputs are accepted (asserted), and every accepted body passes the validator; C3's suites are untouched.

- [ ] **Step 5: Gates and commit**

Run: `git add -A && npx tsc --noEmit && npm test && npx eslint .`
Expected: **464 files / 8594 tests**; 0 errors, 81 warnings.

```bash
git add -A
git commit -m "feat(fairness): the v3 eligibility resolver" -m "Solver v3 C2 RES-1 to RES-8 (IF2-15). resolveMonthEligibility turns the on-screen rule set and member list into one month's record body: the worship filter first (one body whoever is viewing), effective pools to the six role keys by current Tipo, exclusions and «Exenta», == caps resolved per month through capValueForMonth and refused out of range, overlapping or beside «Mes por medio», week exclusions on the planner's own week numbering (the trailing Saturday included), unavailable dates, and presence rules with exclusivity from the conflicts. Every name resolves to exactly one worship member through C3's resolver. A generated-input test holds RES-8: an ok body always passes the record validator, now sharing its limits and the presence key grammar through the vocabulary."
```


---
## Task 13: The «Equidad» preview's view-model — [standard]

Spec UI-3–UI-6, §8 (all copy), CAD-2 (X1's inputs for the panel). Neutral and DOM-free: Spanish month and date labels with fixed arrays (no `Date`/`Intl` for service dates), the window chips (an environment suffix only on a registered month; a reconstructed record never carries one), each tab's rows (people in its population at least once, most owed first by the exact-derived hundredths, ties in Spanish order; an exempt person out of Total) and out-group, the «Motivo» line from the closed set of notes, the X1 line for a «Mes por medio» person — from the record when it binds (A6), else from the resolver over the on-screen state, never the raw tick, and no line when the resolver refuses — the month's on-screen counted Sundays (stored counted Sunday services, plus one weekend default per Sunday with no stored `sunday_role`), and every «Registrar» string, the PUT refusals keyed on IF2-6's union so a new code fails `tsc`.

**Files:**
- Create: `app/components/admin/fairnessPreviewModel.ts`
- Test: `app/components/admin/__tests__/fairnessPreviewModel.test.ts`
- Regenerate: `app/utils/__tests__/__fixtures__/colour-inventory.json`

**Interfaces:**
- Consumes: Task 1 (types, `NOTE_CODES`, `FAIRNESS_PUT_REFUSALS`, `shiftMonth`, `tabOfLine`), Task 9 (`cadenceStates`, `formatFairnessTenths`, `saldoWords`), Task 12 (`EligibilityResult`, type only), `countsForFairness`, `completeSundaySpine`.
- Produces: `monthShort`, `monthLong`, `monthLongCapital`, `monthYear`, `dayMonth`, `formatDates`, `windowSpan`, `COPY`, `TABS`, `ROLE_LABEL`, `chipText`, `displayName`, `tabIncludesLine`, `motivo`, `interface PreviewRow`, `tabRows(response, tab, extraMotivo?): { rows; out }`, `onScreenCountedSundays(month, stored)`, `cadenceLine(input): string | null`, `REGISTRAR`, `REFUSAL_COPY`, `refusalMessage(month, body)`, `resolverLines(month, result)`.

- [ ] **Step 1: Write the failing test**

**Create** `app/components/admin/__tests__/fairnessPreviewModel.test.ts`:

````ts
// Solver v3 C2 UI-3 … UI-6, §8 — the «Equidad · vista previa» view-model: Spanish
// labels, window chips, rows and out-group per tab, «Motivo», the X1 line, the month's
// on-screen counted Sundays and «Registrar»'s copy. Every name is fictitious.
import { describe, expect, it } from "vitest";

import type { EligibilityResult } from "@/app/utils/fairnessEligibility";
import {
  FAIRNESS_PUT_REFUSALS,
  type FairnessLedgerResponse,
  type FairnessPerson,
  type Figures,
  type LogicalRecord,
  type Note,
  type RoleKey,
  type Status,
} from "@/app/utils/fairnessVocabulary";
import {
  REFUSAL_COPY,
  REGISTRAR,
  cadenceLine,
  chipText,
  dayMonth,
  displayName,
  formatDates,
  monthLong,
  monthLongCapital,
  monthShort,
  motivo,
  onScreenCountedSundays,
  refusalMessage,
  resolverLines,
  tabRows,
  windowSpan,
} from "../fairnessPreviewModel";

const fig = (balanceTenths: number, seats = 0, balance = balanceTenths * 10): Figures => ({
  share: balance + seats * 100,
  received: seats * 100,
  balance,
  seats,
  tenths: { share: balanceTenths + seats * 10, balance: balanceTenths },
});

function person(memberId: string, name: string, patch: Partial<FairnessPerson> = {}): FairnessPerson {
  return {
    memberId,
    name,
    exists: true,
    window: {},
    cumulative: {},
    tabs: { window: {}, cumulative: {} },
    sang: 0,
    exempt: false,
    months: ["2026-08", "2026-09", "2026-10"].map((month) => ({ month, recorded: true, listed: true, lines: {}, held: {}, setAsides: [], notes: [] })),
    countedSundayLeads: [],
    firstRecordedIn: {},
    ...patch,
  };
}
const withNotes = (p: FairnessPerson, month: string, notes: Note[]) => ({
  ...p,
  months: p.months.map((m) => (m.month === month ? { ...m, notes } : m)),
});

function response(people: FairnessPerson[], patch: Partial<FairnessLedgerResponse> = {}): FairnessLedgerResponse {
  return {
    v: 1,
    engine: "v3",
    environment: "production",
    currentMonth: "2026-10",
    target: "2026-11",
    window: [
      { month: "2026-08", record: null },
      { month: "2026-09", record: { rev: "r9", source: "reconstructed", engine: "v2", environment: "local", recordedAt: "x" } },
      { month: "2026-10", record: { rev: "r10", source: "auto", engine: "v3", environment: "preview", recordedAt: "x" } },
    ],
    recordsSince: "2026-09",
    horizon: [{ month: "2026-11", record: null, storedServices: 0, recordBinds: false }],
    people,
    diagnostics: { duplicateTargets: [], notInRecordSeats: 0, unknownMembers: [] },
    ...patch,
  };
}

describe("labels (§8)", () => {
  it("names months and dates in Spanish", () => {
    expect([monthShort("2026-08"), monthLong("2026-11"), monthLongCapital("2026-11"), dayMonth("2026-10-25")]).toEqual([
      "ago",
      "noviembre",
      "Noviembre",
      "25 oct",
    ]);
    expect(formatDates(["2026-11-15", "2026-11-08"])).toBe("8 y 15 nov");
    expect(formatDates(["2026-10-04", "2026-09-30", "2026-10-11"])).toBe("30 sep, 4 y 11 oct");
    expect(formatDates(["2026-10-04", "2026-09-30"])).toBe("30 sep y 4 oct");
    expect(formatDates(["2026-11-01", "2026-11-08", "2026-11-15"])).toBe("1, 8 y 15 nov");
  });

  it("spans the window", () => {
    expect(windowSpan(response([]).window)).toBe("ago–oct 2026");
    expect(windowSpan([{ month: "2026-11", record: null }, { month: "2026-12", record: null }, { month: "2027-01", record: null }])).toBe(
      "nov 2026–ene 2027",
    );
  });

  it("writes the window chips, the environment suffix only on a registered month", () => {
    expect(response([]).window.map(chipText)).toEqual(["ago: sin registro, no cuenta", "sep: reconstruido", "oct: registrado · desde dev"]);
    expect(chipText({ month: "2026-10", record: { rev: "r", source: "manual", engine: "v3", environment: "local", recordedAt: "x" } })).toBe(
      "oct: registrado · local",
    );
    expect(chipText({ month: "2026-10", record: { rev: "r", source: "auto", engine: "v3", environment: "production", recordedAt: "x" } })).toBe(
      "oct: registrado",
    );
  });

  it("names a deleted member", () => {
    expect(displayName({ name: "Elena", exists: false })).toBe("Elena · ya no está en el equipo");
    expect(displayName({ name: "", exists: false })).toBe("Miembro eliminado");
  });
});

describe("«Motivo» (UI-5)", () => {
  const notes: Note[] = [
    { code: "exempt" },
    { code: "presence", line: "P:rule-ab", ruleKey: "rule-ab", members: ["m-alma", "m-bruno"] },
    { code: "role_out", line: "DL" },
    { code: "unavailable", dates: ["2026-10-04", "2026-10-11"] },
    { code: "outside_population", line: "BGV", dates: ["2026-10-04", "2026-10-18"] },
  ];
  const alma = withNotes(person("m-alma", "Alma"), "2026-10", notes);
  const nameOf = (id: string) => ({ "m-bruno": "Bruno" })[id] ?? id;

  it("keeps each tab's notes, in the closed set's order", () => {
    expect(motivo(alma, "DL", nameOf)).toBe("No estaba en la lista de Dom Lead en oct. No disponible 4 y 11 oct: esas fechas no le cuentan.");
    expect(motivo(alma, "BGV", nameOf)).toBe(
      "No disponible 4 y 11 oct: esas fechas no le cuentan. Regla de presencia con Bruno: ese lugar se reparte entre ellos. 2 lugares fuera de su lista no cuentan.",
    );
    expect(motivo(alma, "TOTAL", nameOf)).toContain("Exenta: no cuenta en Total.");
    expect(motivo(alma, "CORO", nameOf)).not.toContain("Exenta");
  });

  it("writes the same sentence once", () => {
    const twice = withNotes(withNotes(person("m-alma", "Alma"), "2026-09", [{ code: "cadence_set_aside", line: "DL", dates: ["2026-09-06"] }]), "2026-10", [
      { code: "cadence_set_aside", line: "DL", dates: ["2026-10-04"] },
    ]);
    expect(motivo(twice, "DL", nameOf)).toBe("Mes por medio: sus domingos no cuentan en Dom Lead.");
  });
});

describe("rows (UI-4)", () => {
  const people = [
    person("m-bruno", "Bruno", { tabs: { window: { BGV: fig(-3, 1) }, cumulative: { BGV: fig(5, 2) } }, sang: 2 }),
    person("m-alvaro", "Álvaro", { tabs: { window: { BGV: fig(4) }, cumulative: {} } }),
    person("m-alma", "Alma", { tabs: { window: { BGV: fig(4), TOTAL: fig(4) }, cumulative: {} }, exempt: true }),
    person("m-carmen", "Carmen"),
  ];

  it("lists the tab's population, most owed first, ties by name in Spanish order", () => {
    const { rows, out } = tabRows(response(people), "BGV");
    expect(rows.map((r) => r.name)).toEqual(["Alma", "Álvaro", "Bruno"]);
    expect(rows[2]).toMatchObject({ leTocaba: "0.7", tuvo: 1, saldo: "0.3 de más", desde: "le deben 0.5", canto: 2 });
    expect(out.map((r) => r.name)).toEqual(["Carmen"]);
    expect(out[0]).toMatchObject({ leTocaba: "—", saldo: "—", desde: "—" });
  });

  it("leaves an exempt person out of Total", () => {
    expect(tabRows(response(people), "TOTAL").rows.map((r) => r.name)).toEqual([]);
    expect(tabRows(response(people), "TOTAL").out.map((r) => r.name)).toContain("Alma");
  });
});

describe("the month's on-screen counted Sundays (UI-5)", () => {
  it("counts stored counted Sunday services and one default per Sunday with no stored sunday_role", () => {
    // October 2026 Sundays: 4, 11, 18, 25.
    expect(
      onScreenCountedSundays("2026-10", [
        { _type: "sunday_role", date: "2026-10-04" },
        { _type: "sunday_role", date: "2026-10-11", countsForFairness: false },
        { _type: "special_role", date: "2026-10-18", countsForFairness: true },
        { _type: "special_role", date: "2026-10-18" },
        { _type: "special_role", date: "2026-10-23", countsForFairness: true },
        { _type: "sunday_role", date: "2026-11-01" },
      ]),
    ).toEqual(["2026-10-04", "2026-10-18", "2026-10-18", "2026-10-25"]);
  });
});

describe("the X1 line (UI-5, CAD-2)", () => {
  const OUT: Record<RoleKey, Status> = {
    "Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "out", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out",
  };
  const item = (patch: object = {}) => ({
    memberId: "m-diego",
    roles: { ...OUT, "Sun.Lead": "in" as Status },
    exactRules: [],
    sundayCadence: "alternate" as const,
    exempt: false,
    blocks: [] as Array<{ date: string; unavailable: boolean; excludedRoles: RoleKey[] }>,
    ...patch,
  });
  const resolved = (patch: object = {}): EligibilityResult => ({ ok: true, body: { month: "2026-11", people: [item(patch)], presence: [] } });
  const diego = person("m-diego", "Diego");
  const SUNDAYS = ["2026-11-01", "2026-11-08", "2026-11-15", "2026-11-22", "2026-11-29"];
  const line = (patch: Partial<Parameters<typeof cadenceLine>[0]> = {}) =>
    cadenceLine({ person: diego, response: response([diego]), month: "2026-11", resolved: resolved(), countedSundays: SUNDAYS, liveUnavailable: [], ...patch });

  it("is «previsto» on", () => expect(line()).toBe("En nov le toca domingo (previsto)."));

  it("rests after a Sunday led in the previous month, naming it", () => {
    expect(line({ person: { ...diego, countedSundayLeads: ["2026-09-06", "2026-10-25"] } })).toBe("En nov descansa: dirigió domingo el 25 oct.");
  });

  it("rests when not on the Dom Lead list (from the resolver, never the raw tick)", () => {
    expect(line({ resolved: resolved({ roles: OUT }) })).toBe("En nov descansa: no está en la lista de Dom Lead.");
  });

  it("rests with no available Sunday, a rule-excluded Sunday counting as unavailable (A14)", () => {
    const blocks = SUNDAYS.map((date, i) => ({ date, unavailable: i < 4, excludedRoles: i === 4 ? (["Sun.Lead"] as RoleKey[]) : [] }));
    expect(line({ resolved: resolved({ blocks }) })).toBe("En nov descansa: ningún domingo disponible.");
    expect(line({ liveUnavailable: SUNDAYS })).toBe("En nov descansa: ningún domingo disponible.");
  });

  it("reads the record when it binds the month (A6), and says nothing when the resolver refuses", () => {
    const record: LogicalRecord = {
      month: "2026-11", rev: "r", contentHash: "h", source: "auto", engine: "v3", environment: "production", recordedAt: "x",
      people: [{ ...item({ roles: OUT }), name: "Diego" }],
      presence: [],
    };
    const bound = response([diego], { horizon: [{ month: "2026-11", record, storedServices: 4, recordBinds: true }] });
    expect(line({ response: bound })).toBe("En nov descansa: no está en la lista de Dom Lead.");
    expect(line({ resolved: { ok: false, issues: [{ code: "no_people" }], refusals: [] } })).toBeNull();
    expect(line({ resolved: resolved({ sundayCadence: undefined }) })).toBeNull();
  });
});

describe("«Registrar» copy (UI-6, §8)", () => {
  it("names the month in the button and the replace date in CDMX", () => {
    expect(REGISTRAR.button("2026-11")).toBe("Registrar elegibilidad de noviembre");
    expect(REGISTRAR.replace("2026-10-04T03:00:00.000Z")).toBe("Reemplaza el registro guardado el 3 oct.");
    expect(REGISTRAR.devEnvironment("preview")).toContain("Estás en dev");
  });

  it("maps every PUT refusal, and anything else to the fallback", () => {
    for (const code of FAIRNESS_PUT_REFUSALS) {
      expect(refusalMessage("2026-11", { details: { detail: code } })).toBe(REFUSAL_COPY[code]("2026-11"));
    }
    expect(refusalMessage("2026-11", { details: { detail: "past_month" } })).toBe(
      "Noviembre ya pasó: los meses pasados solo se registran con la reconstrucción.",
    );
    expect(refusalMessage("2026-11", { error: "invalid_request" })).toBe("No se pudo registrar. No se guardó nada; vuelve a intentar.");
    expect(refusalMessage("2026-11", null)).toBe("No se pudo registrar. No se guardó nada; vuelve a intentar.");
  });

  it("writes one line per resolver refusal kind and per issue kind", () => {
    expect(
      resolverLines("2026-11", {
        ok: false,
        issues: [{ code: "presence_roles", ruleKey: "p-1" }, { code: "presence_members", ruleKey: "p-1" }],
        refusals: [
          { person: "Alma", reason: "ambiguous" },
          { person: "Nadie", reason: "unresolved" },
          { person: "Diego", reason: "cadence_and_exact" },
          { person: "Bruno", reason: "exact_count_range" },
        ],
      }),
    ).toEqual([
      "Hay reglas con nombres que no corresponden a una sola persona: Alma, Nadie. Corrígelas antes de registrar.",
      "Diego tiene «Mes por medio» y una regla fija de Dom Lead; quita una de las dos antes de registrar.",
      "La regla fija de Bruno no da un número entero de 0 a 31 lugares en noviembre; corrígela antes de registrar.",
      "Una regla de presencia no se puede registrar (necesita de 2 a 12 personas de voz y al menos un rol; máximo 20 reglas). Revísala antes de registrar.",
    ]);
  });
});
````

- [ ] **Step 2: Run it to see it fail**

Run: `git add -A && npx vitest run app/components/admin/__tests__/fairnessPreviewModel.test.ts`
Expected: FAIL — `../fairnessPreviewModel` does not resolve.

- [ ] **Step 3: Implement**

**Create** `app/components/admin/fairnessPreviewModel.ts`:

````ts
// app/components/admin/fairnessPreviewModel.ts
//
// The «Equidad · vista previa» panel's pure view-model (solver v3 C2 UI-3 … UI-6, §8):
// month and date labels, the window chips, the five tabs' rows and out-group, the
// «Motivo» line per person, the X1 line for a «Mes por medio» person on the Dom Lead tab,
// the month's on-screen counted Sundays, and every Spanish string the panel and
// «Registrar» show. NEUTRAL (ADR-0028): no React, no I/O, so every rule is unit-tested
// without a DOM. Figures are formatted ONLY through `fairnessFormat.ts` from the GET's
// tenths — never from hundredths (A17).

import { countsForFairness } from "@/app/utils/countsForFairness";
import { cadenceStates } from "@/app/utils/fairnessLedger";
import { formatFairnessTenths, saldoWords } from "@/app/utils/fairnessFormat";
import type { EligibilityResult } from "@/app/utils/fairnessEligibility";
import {
  FAIRNESS_PUT_REFUSALS,
  NOTE_CODES,
  shiftMonth,
  tabOfLine,
  type FairnessLedgerResponse,
  type FairnessPerson,
  type FairnessPutRefusal,
  type Figures,
  type LineKey,
  type Note,
  type RoleKey,
  type TabKey,
} from "@/app/utils/fairnessVocabulary";
import { completeSundaySpine } from "./serviceRuleContext";

// ─── Months and dates, in Spanish (no `Date`, no `Intl`: fixed and testable) ──

const SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const LONG = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** "2026-11" → "nov". */
export const monthShort = (month: string) => SHORT[Number(month.slice(5, 7)) - 1] ?? month;
/** "2026-11" → "noviembre". */
export const monthLong = (month: string) => LONG[Number(month.slice(5, 7)) - 1] ?? month;
/** "2026-11" → "Noviembre". */
export const monthLongCapital = (month: string) => {
  const long = monthLong(month);
  return long.charAt(0).toUpperCase() + long.slice(1);
};
/** "2026-08" → "ago 2026". */
export const monthYear = (month: string) => `${monthShort(month)} ${month.slice(0, 4)}`;

/** "2026-11-08" → "8 nov". */
export const dayMonth = (date: string) => `${Number(date.slice(8, 10))} ${monthShort(date.slice(0, 7))}`;

/** ["2026-11-08", "2026-11-15"] → "8 y 15 nov"; across months → "30 sep y 4 oct". */
export function formatDates(dates: readonly string[]): string {
  const groups: Array<{ month: string; days: number[] }> = [];
  for (const date of [...dates].sort()) {
    const month = date.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.month === month) last.days.push(Number(date.slice(8, 10)));
    else groups.push({ month, days: [Number(date.slice(8, 10))] });
  }
  const parts = groups.map((g) => `${joinY(g.days.map(String))} ${monthShort(g.month)}`);
  // "y" joins the last two items once: «30 sep y 4 oct», but «30 sep, 4 y 11 oct».
  return groups.every((g) => g.days.length === 1) ? joinY(parts) : parts.join(", ");
}

function joinY(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

/** The window's span: "ago–oct 2026", or "nov 2026–ene 2027" across a year. */
export function windowSpan(window: FairnessLedgerResponse["window"]): string {
  const first = window[0]?.month;
  const last = window[window.length - 1]?.month;
  if (!first || !last) return "";
  return first.slice(0, 4) === last.slice(0, 4) ? `${monthShort(first)}–${monthYear(last)}` : `${monthYear(first)}–${monthYear(last)}`;
}

// ─── Copy (§8) ───────────────────────────────────────────────────────────────

export const COPY = {
  disclosure: "Equidad · vista previa",
  banner: "Vista previa: Auto todavía no usa este saldo",
  subheader: (span: string) => `Saldo de ${span} (3 meses). "Le deben" = le tocaba más de lo que tuvo.`,
  loading: "Cargando el saldo de equidad…",
  error: "No se pudo leer el saldo de equidad.",
  retry: "Reintentar",
  empty: "Todavía no hay meses registrados: el saldo empieza con el primer registro.",
  outGroup: (n: number) => `Fuera de esta línea (${n})`,
  deleted: "Miembro eliminado",
  footer:
    "Le tocaba = su parte de los lugares de cada servicio que cuenta para equidad, repartida entre quienes estaban en la lista y disponibles ese día. Los lugares fijos (reglas fijas, mes por medio, mínimo de voz) no se reparten. Lo que a unos se les debe, otros lo tienen de más: la suma siempre da cero.",
  totalFooter: "Total = Dom Lead + Sáb Lead + BGV + Coro. Cantó = todos sus lugares de voz, incluidos los fijos. Instrumentos y FOH no cuentan.",
  columns: { persona: "Persona", leTocaba: "Le tocaba", tuvo: "Tuvo", saldo: "Saldo (3 meses)", desde: (since: string) => `Desde ${since}`, motivo: "Motivo", canto: "Cantó" },
} as const;

export const TABS: ReadonlyArray<{ key: TabKey; label: string }> = [
  { key: "DL", label: "Dom Lead" },
  { key: "SL", label: "Sáb Lead" },
  { key: "BGV", label: "BGV" },
  { key: "CORO", label: "Coro" },
  { key: "TOTAL", label: "Total" },
];

const TAB_LABEL: Record<Exclude<TabKey, "TOTAL">, string> = { DL: "Dom Lead", SL: "Sáb Lead", BGV: "BGV", CORO: "Coro" };

export const ROLE_LABEL: Readonly<Record<RoleKey, string>> = {
  "Sun.Lead": "Dom Lead",
  "Sat.Lead": "Sáb Lead",
  "Sun.BGV": "Dom BGV",
  "Sat.BGV": "Sáb BGV",
  "Sun.Choir": "Dom Coro",
  "Sat.Choir": "Sáb Coro",
};

/** A window chip (§8): «{ago}: registrado» · «{sep}: reconstruido» · «{oct}: sin registro, no cuenta». */
export function chipText(entry: FairnessLedgerResponse["window"][number]): string {
  const month = monthShort(entry.month);
  if (!entry.record) return `${month}: sin registro, no cuenta`;
  if (entry.record.source === "reconstructed") return `${month}: reconstruido`;
  const suffix = entry.record.environment === "preview" ? " · desde dev" : entry.record.environment === "local" ? " · local" : "";
  return `${month}: registrado${suffix}`;
}

/** The display name: a deleted member reads «{nombre} · ya no está en el equipo», or «Miembro eliminado». */
export function displayName(person: Pick<FairnessPerson, "name" | "exists">): string {
  if (person.exists) return person.name;
  return person.name ? `${person.name} · ya no está en el equipo` : COPY.deleted;
}

// ─── Notes → «Motivo» (UI-5) ─────────────────────────────────────────────────

function lineLabel(line: LineKey | undefined): string {
  if (!line) return "";
  return TAB_LABEL[tabOfLine(line)];
}

function noteSentence(note: Note, month: string, nameOf: (id: string) => string, self: string): string {
  const mes = monthShort(month);
  switch (note.code) {
    case "unrecorded_month":
      return `${mes}: sin registro, no cuenta.`;
    case "not_listed":
      return `No aparece en el registro de ${mes}.`;
    case "role_out":
      return `No estaba en la lista de ${lineLabel(note.line)} en ${mes}.`;
    case "unavailable":
      return `No disponible ${formatDates(note.dates)}: esas fechas no le cuentan.`;
    case "rule_excluded":
      return `Excluido por regla el ${formatDates(note.dates)}.`;
    case "exact":
      return `Regla fija: ${note.roles.map((k) => ROLE_LABEL[k]).join(" + ")} = ${note.count} por mes; esos lugares no se reparten.`;
    case "exact_clamped":
      return `Regla fija de ${note.count}, pero solo estuvo disponible ${note.available} ${note.available === 1 ? "vez" : "veces"} en ${mes}.`;
    case "cadence_set_aside":
      return "Mes por medio: sus domingos no cuentan en Dom Lead.";
    case "cadence_no_sunday_saturday":
      return `En ${mes} no dirigió domingo; su sábado cuenta en Sáb Lead.`;
    case "floor_seat":
      return `Un lugar de ${mes} fue por el mínimo de voz y no cuenta.`;
    case "presence": {
      const others = note.members.filter((id) => id !== self).map(nameOf);
      return `Regla de presencia con ${joinY(others)}: ese lugar se reparte entre ellos.`;
    }
    case "outside_population":
      return note.dates.length === 1
        ? "1 lugar fuera de su lista no cuenta."
        : `${note.dates.length} lugares fuera de su lista no cuentan.`;
    case "second_seat":
      return `Estaba dos veces en el servicio del ${formatDates(note.dates)}: solo cuenta su primer lugar.`;
    case "exempt":
      return "Exenta: no cuenta en Total.";
  }
}

/** The lines a tab shows (LG-14): BGV folds every presence sub-line; Total is every line. */
export function tabIncludesLine(tab: TabKey, line: LineKey): boolean {
  return tab === "TOTAL" || tabOfLine(line) === tab;
}

/** One «Motivo» line: the person's window notes for this tab, in the closed set's order, each once. */
export function motivo(person: FairnessPerson, tab: TabKey, nameOf: (id: string) => string): string {
  const items: Array<{ order: number; month: string; text: string }> = [];
  for (const m of person.months) {
    for (const note of m.notes) {
      if (note.line && !tabIncludesLine(tab, note.line)) continue;
      if (note.code === "exempt" && tab !== "TOTAL") continue;
      items.push({ order: NOTE_CODES.indexOf(note.code), month: m.month, text: noteSentence(note, m.month, nameOf, person.memberId) });
    }
  }
  items.sort((a, b) => a.order - b.order || (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
  return [...new Set(items.map((i) => i.text))].join(" ");
}

// ─── Rows (UI-4) ─────────────────────────────────────────────────────────────

export interface PreviewRow {
  memberId: string;
  name: string;
  leTocaba: string;
  tuvo: number;
  saldo: string;
  desde: string;
  motivo: string;
  canto: number;
  balance: number;
}

/** The tab's rows (people in its population at least once in the window), most owed first, and the rest. */
export function tabRows(
  response: FairnessLedgerResponse,
  tab: TabKey,
  extraMotivo: (person: FairnessPerson) => string = () => "",
): { rows: PreviewRow[]; out: PreviewRow[] } {
  const names = new Map(response.people.map((p) => [p.memberId, displayName(p)]));
  const nameOf = (id: string) => names.get(id) ?? COPY.deleted;
  const row = (p: FairnessPerson, figures: Figures | undefined): PreviewRow => {
    const cumulative = p.tabs.cumulative[tab];
    const why = [motivo(p, tab, nameOf), extraMotivo(p)].filter(Boolean).join(" ");
    return {
      memberId: p.memberId,
      name: displayName(p),
      leTocaba: figures ? formatFairnessTenths(figures.tenths.share) : "—",
      tuvo: figures ? figures.seats : 0,
      saldo: figures ? saldoWords(figures.tenths.balance) : "—",
      desde: cumulative ? saldoWords(cumulative.tenths.balance) : "—",
      motivo: why,
      canto: p.sang,
      balance: figures ? figures.balance : 0,
    };
  };
  const inTab = (p: FairnessPerson) => p.tabs.window[tab] !== undefined && !(tab === "TOTAL" && p.exempt);
  const rows = response.people
    .filter(inTab)
    .map((p) => row(p, p.tabs.window[tab]))
    .sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name, "es"));
  const out = response.people
    .filter((p) => !inTab(p))
    .map((p) => row(p, undefined))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
  return { rows, out };
}

// ─── The X1 line for a «Mes por medio» person (UI-5, CAD-2) ──────────────────

/**
 * The month's counted Sunday services from the on-screen state (display only, «previsto»):
 * every stored counted Sunday-dated service, plus one weekend default for each Sunday of
 * the month with no stored `sunday_role`. One entry per service; a date may repeat.
 */
export function onScreenCountedSundays(
  month: string,
  stored: ReadonlyArray<{ _type: string; date: string; countsForFairness?: boolean }>,
): string[] {
  const sundays = completeSundaySpine(month);
  const out: string[] = [];
  const withSundayRole = new Set<string>();
  for (const s of stored) {
    const date = s.date.slice(0, 10);
    if (!sundays.includes(date)) continue;
    if (s._type === "sunday_role") withSundayRole.add(date);
    if ((s._type === "sunday_role" || s._type === "special_role") && countsForFairness({ _type: s._type, countsForFairness: s.countsForFairness })) {
      out.push(date);
    }
  }
  for (const sunday of sundays) if (!withSundayRole.has(sunday)) out.push(sunday);
  return out.sort();
}

/**
 * «En {nov} …» for a «Mes por medio» person, or `null` when she has none this month or
 * the month's eligibility cannot be told: the record when it binds (A6), else the
 * resolver's output over the on-screen state — never the raw pool tick. A resolver
 * `ok: false` omits the line (CAD-2; «Registrar» and C6 refuse that state anyway).
 */
export function cadenceLine(input: {
  person: FairnessPerson;
  response: FairnessLedgerResponse;
  month: string;
  resolved: EligibilityResult | null;
  countedSundays: readonly string[];
  liveUnavailable: readonly string[];
}): string | null {
  const horizon = input.response.horizon.find((h) => h.month === input.month);
  const source = horizon?.recordBinds && horizon.record ? horizon.record.people : input.resolved?.ok ? input.resolved.body.people : null;
  if (!source) return null;
  const item = source.find((p) => p.memberId === input.person.memberId);
  if (!item || item.sundayCadence !== "alternate") return null;
  const previous = shiftMonth(input.month, -1);
  const led = input.person.countedSundayLeads.filter((d) => d.slice(0, 7) === previous);
  const blocked = (date: string) =>
    input.liveUnavailable.includes(date) ||
    item.blocks.some((b) => b.date === date && (b.unavailable || b.excludedRoles.includes("Sun.Lead")));
  const [state] = cadenceStates({
    ledCountedSundayPreviousMonth: led.length > 0,
    months: [
      {
        month: input.month,
        eligible: item.roles["Sun.Lead"] === "in",
        availableCountedSundays: input.countedSundays.filter((d) => !blocked(d)).length,
      },
    ],
  });
  const mes = monthShort(input.month);
  switch (state.reason) {
    case "on":
      return `En ${mes} le toca domingo (previsto).`;
    case "led_previous_month":
      return `En ${mes} descansa: dirigió domingo el ${dayMonth(led[led.length - 1])}.`;
    case "not_eligible":
      return `En ${mes} descansa: no está en la lista de Dom Lead.`;
    default:
      return `En ${mes} descansa: ningún domingo disponible.`;
  }
}

// ─── «Registrar» (UI-6, §8) ──────────────────────────────────────────────────

export const REGISTRAR = {
  button: (month: string) => `Registrar elegibilidad de ${monthLong(month)}`,
  body: (month: string) =>
    `Se guarda quién está en cada lista de ${monthLong(month)}, sus reglas y sus fechas no disponibles, tal como están en pantalla. El saldo de los próximos meses se calcula con este registro.`,
  unsaved: "Las reglas tienen cambios sin guardar; se registran tal como están en pantalla.",
  replace: (recordedAt: string) => `Reemplaza el registro guardado el ${recordedAtLabel(recordedAt)}.`,
  frozenCreate: (month: string) =>
    `${monthLongCapital(month)} ya tiene servicios guardados: este será su registro. Mientras tenga servicios no se podrá reemplazar, y la reconstrucción no lo cambiará.`,
  devEnvironment: (environment: "preview" | "local") =>
    `Estás en ${environment === "preview" ? "dev" : "local"}: este registro se guarda en los datos reales del equipo y no se puede borrar desde la app.`,
  confirm: "Registrar",
  cancel: "Cancelar",
  success: "Registrado ✓",
  monthHasServices: (month: string) => `${monthLongCapital(month)} ya tiene servicios guardados: su registro ya no se puede reemplazar.`,
  failed: "No se pudo registrar. No se guardó nada; vuelve a intentar.",
} as const;

/** A record's `recordedAt` (an instant) as the CDMX day it was saved: «3 oct». */
function recordedAtLabel(iso: string): string {
  const day = new Date(iso).toLocaleDateString("sv", { timeZone: "America/Mexico_City" });
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? dayMonth(day) : iso;
}

/** One line per PUT refusal (IF2-6); keyed on the union, so a new code fails `tsc`. */
export const REFUSAL_COPY: Readonly<Record<FairnessPutRefusal, (month: string) => string>> = {
  record_exists: (m) => `Otro administrador registró ${monthLong(m)} mientras tanto. Recarga para ver su registro.`,
  record_missing: (m) => `El registro de ${monthLong(m)} cambió mientras tanto. Recarga y vuelve a intentar.`,
  stale_revision: (m) => `El registro de ${monthLong(m)} cambió mientras tanto. Recarga y vuelve a intentar.`,
  month_has_services: (m) => REGISTRAR.monthHasServices(m),
  past_month: (m) => `${monthLongCapital(m)} ya pasó: los meses pasados solo se registran con la reconstrucción.`,
  engine_not_v3: () => "Registrar aplica con el nuevo solver. Recarga la página.",
  member_unknown: () => "Cambió el equipo mientras tanto (un miembro o su Tipo). Recarga y vuelve a intentar.",
  member_not_worship: () => "Cambió el equipo mientras tanto (un miembro o su Tipo). Recarga y vuelve a intentar.",
  tipo_mismatch: () => "Cambió el equipo mientras tanto (un miembro o su Tipo). Recarga y vuelve a intentar.",
};

/** The message for a PUT answer that is not a 200: by `details.detail`, else the fallback. */
export function refusalMessage(month: string, body: unknown): string {
  const detail = (body as { details?: { detail?: unknown } } | null)?.details?.detail;
  return typeof detail === "string" && (FAIRNESS_PUT_REFUSALS as readonly string[]).includes(detail)
    ? REFUSAL_COPY[detail as FairnessPutRefusal](month)
    : REGISTRAR.failed;
}

/** The resolver's refusals and issues as the dialog's lines (§8). */
export function resolverLines(month: string, result: Extract<EligibilityResult, { ok: false }>): string[] {
  const lines: string[] = [];
  const names = (reasons: string[]) => result.refusals.filter((r) => reasons.includes(r.reason)).map((r) => r.person);
  const unresolved = names(["unresolved", "ambiguous"]);
  if (unresolved.length) lines.push(`Hay reglas con nombres que no corresponden a una sola persona: ${unresolved.join(", ")}. Corrígelas antes de registrar.`);
  for (const person of names(["cadence_and_exact"])) {
    lines.push(`${person} tiene «Mes por medio» y una regla fija de Dom Lead; quita una de las dos antes de registrar.`);
  }
  for (const person of names(["overlapping_exact"])) {
    lines.push(`${person} tiene dos reglas fijas que cubren el mismo rol; deja solo una antes de registrar.`);
  }
  for (const person of names(["exact_count_range"])) {
    lines.push(`La regla fija de ${person} no da un número entero de 0 a 31 lugares en ${monthLong(month)}; corrígela antes de registrar.`);
  }
  for (const person of names(["no_tipo"])) lines.push(`${person} está en las reglas pero no tiene Tipo; asígnale uno o corrige la regla.`);
  for (const person of names(["presence_member_not_listed"])) {
    lines.push(`${person} está en una regla de presencia pero no canta (su Tipo no incluye voz); corrige la regla o su Tipo.`);
  }
  const codes = new Set(result.issues.map((i) => i.code));
  if (["presence_members", "presence_roles", "presence_rule_id", "too_many_presence"].some((c) => codes.has(c as never))) {
    lines.push("Una regla de presencia no se puede registrar (necesita de 2 a 12 personas de voz y al menos un rol; máximo 20 reglas). Revísala antes de registrar.");
  }
  if (codes.has("no_people")) lines.push("No hay nadie con Tipo de voz en el equipo: no hay nada que registrar.");
  if (codes.has("too_many_people")) lines.push("Hay más de 100 personas de voz: el registro no las admite.");
  return lines;
}
````

**Regenerate** `app/utils/__tests__/__fixtures__/colour-inventory.json` (it records `filesScanned`, and this task adds a file under `app/`):

```bash
node scripts/colour-inventory.mjs
```

- [ ] **Step 4: Run it to see it pass**

Run: `git add -A && npx vitest run app/components/admin/__tests__/fairnessPreviewModel.test.ts app/utils/__tests__/fairnessFormat.test.ts`
Expected: PASS — the formatter's sweep still finds no division of a figure by 10 or 100.

- [ ] **Step 5: Gates and commit**

Run: `git add -A && npx tsc --noEmit && npm test && npx eslint .`
Expected: **465 files / 8611 tests**; 0 errors, 81 warnings.

```bash
git add -A
git commit -m "feat(planner): the «Equidad» preview's view-model" -m "Solver v3 C2 UI-3 to UI-6 and §8, as a neutral module the panel renders: Spanish month and date labels with no Date or Intl, the window chips (an environment suffix only on a registered month), each tab's rows (most owed first, ties in Spanish order, an exempt person out of Total) and out-group, the «Motivo» line from the ledger's notes, the X1 line for a «Mes por medio» person from the binding record or the resolver over the on-screen state (never the raw tick), the month's on-screen counted Sundays, and every «Registrar» string, the PUT refusals keyed on IF2-6's union. Every figure goes through the one formatter from the GET's tenths."
```


---

## Task 14: The read-only panel, mounted beside the lead history — [standard]

Spec UI-1–UI-5, UI-7. A `Collapse` disclosure, closed by default, that reads `GET /api/admin/fairness?month=<viewed>&horizon=1` only on FIRST open (so no other suite's `fetch` count moves): a skeleton while loading, the fixed error with «Reintentar» on a failure (never an empty table), then the banner, subheader, chips, the five tabs (house `SegmentedControl`), the table on desktop inside its own `overflow-x-auto` box or one card per person on a phone, the collapsed «Fuera de esta línea» group, and the footers. It is mounted with `key={YYYY-MM}` beside `LeadPoolHistoryPanel` at the config step (`SolverConfigPanel`, which gains the month's stored services) and in the stored editor, never in its place. `ExistingRole` gains the effective `countsForFairness` that `GET /api/admin/roles` already projects (type widening; display only). The grid's `aria-expanded` test leaves the preview's own disclosure out, as it already leaves a `Menu` trigger — its subject is the grid's cells.

**Files:**
- Create: `app/components/admin/FairnessPreviewPanel.tsx`
- Modify: `app/components/admin/MonthGenerator.tsx` (import `:67`; `ExistingRole` `:174`; `SolverConfigPanel` signature `:1787` and its lead-history block `:1937-1947`; its render `:4494-4506`; the stored editor's lead-history block `:4809-4820`)
- Modify: `app/components/admin/__tests__/participationAlongside.test.tsx` (`:829-851`)
- Test: `app/components/admin/__tests__/FairnessPreviewPanel.test.tsx`, `app/components/admin/__tests__/MonthGenerator.fairnessPreview.test.tsx`
- Regenerate: `app/utils/__tests__/__fixtures__/colour-inventory.json`

**Interfaces:**
- Consumes: Task 13's view-model; Task 12's `resolveMonthEligibility`/`EligibilityMember`; `Button`, `Collapse`, `SegmentedControl`, `Skeleton`/`SkeletonGroup`; `editableConfig`, `sameSolverConfig` (already imported by `MonthGenerator`).
- Produces: `FAIRNESS_ENDPOINT`, `interface FairnessPreviewPanelProps { month; config; members; storedServices; rulesDirty }`, `default FairnessPreviewPanel`; `monthKeyOf(year, month)` and `rulesDirtyOf(rules, config)` (module-local in `MonthGenerator.tsx`).

- [ ] **Step 1: Write the failing tests**

**Create** `app/components/admin/__tests__/FairnessPreviewPanel.test.tsx`:

````tsx
/** @vitest-environment jsdom */
// Solver v3 C2 UI-1 … UI-5, UI-7 — the read-only «Equidad · vista previa» panel: closed by
// default, loads on first open (never before), a skeleton while loading, the fixed error
// with «Reintentar» (never an empty table), the banner, chips and tabs, one decimal through
// the one formatter, the out-group collapsed, and the X1 line for a «Mes por medio» person.
// The fetch mock routes by URL and only CAPTURES — the component catches every throw.
// Every name is fictitious.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FairnessLedgerResponse, FairnessPerson, Figures } from "@/app/utils/fairnessVocabulary";
import FairnessPreviewPanel, { type FairnessPreviewPanelProps } from "../FairnessPreviewPanel";
import type { SolverConfig } from "../plannerModel";
import { AdminProviders } from "./providersHarness";

const fig = (shareTenths: number, seats: number): Figures => ({
  share: shareTenths * 10,
  received: seats * 100,
  balance: shareTenths * 10 - seats * 100,
  seats,
  tenths: { share: shareTenths, balance: shareTenths - seats * 10 },
});

function person(memberId: string, name: string, patch: Partial<FairnessPerson> = {}): FairnessPerson {
  return {
    memberId,
    name,
    exists: true,
    window: {},
    cumulative: {},
    tabs: { window: {}, cumulative: {} },
    sang: 0,
    exempt: false,
    months: ["2026-08", "2026-09", "2026-10"].map((month) => ({ month, recorded: month === "2026-10", listed: true, lines: {}, held: {}, setAsides: [], notes: [] })),
    countedSundayLeads: [],
    firstRecordedIn: {},
    ...patch,
  };
}

function ledger(patch: Partial<FairnessLedgerResponse> = {}): FairnessLedgerResponse {
  return {
    v: 1,
    engine: "v2",
    environment: "production",
    currentMonth: "2026-10",
    target: "2026-11",
    window: [
      { month: "2026-08", record: null },
      { month: "2026-09", record: null },
      { month: "2026-10", record: { rev: "r10", source: "auto", engine: "v3", environment: "production", recordedAt: "2026-10-03T15:00:00Z" } },
    ],
    recordsSince: "2026-10",
    horizon: [{ month: "2026-11", record: null, storedServices: 0, recordBinds: false }],
    people: [
      person("m-alma", "Alma", { tabs: { window: { DL: fig(8, 0), BGV: fig(13, 2) }, cumulative: { DL: fig(8, 0) } } }),
      person("m-bruno", "Bruno", { tabs: { window: { DL: fig(12, 2) }, cumulative: {} } }),
      person("m-diego", "Diego", { countedSundayLeads: ["2026-10-25"] }),
    ],
    diagnostics: { duplicateTargets: [], notInRecordSeats: 0, unknownMembers: [] },
    ...patch,
  };
}

const CONFIG: SolverConfig = {
  sundayLeads: ["m-alma", "m-bruno", "m-diego"],
  saturdayLeads: [],
  support: [],
  restrictions: [{ id: "r1", person: "Diego", excludedPatterns: [], fairness: "none", fairnessSlack: 1, weekExclusions: [], caps: [], sundayCadence: "alternate" }],
  conflicts: [],
  presence: [],
};
const MEMBERS = [
  { _id: "m-alma", member_name: "Alma", memberType: ["voz", "sunday_lead"] },
  { _id: "m-bruno", member_name: "Bruno", memberType: ["voz", "sunday_lead"] },
  { _id: "m-diego", member_name: "Diego", memberType: ["voz", "sunday_lead"] },
];

const calls: string[] = [];
let answer: () => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
beforeEach(() => {
  calls.length = 0;
  answer = async () => ({ ok: true, status: 200, json: async () => ledger() });
  vi.stubGlobal("fetch", (url: string) => {
    calls.push(url);
    return answer();
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderPanel = (patch: Partial<FairnessPreviewPanelProps> = {}) =>
  render(
    <FairnessPreviewPanel month="2026-11" config={CONFIG} members={MEMBERS} storedServices={[]} rulesDirty={false} {...patch} />,
    { wrapper: AdminProviders },
  );
const openPanel = () => fireEvent.click(screen.getByRole("button", { name: "Equidad · vista previa" }));

describe("the disclosure (UI-2, UI-3)", () => {
  it("is closed by default and reads nothing until opened", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: "Equidad · vista previa" }).getAttribute("aria-expanded")).toBe("false");
    expect(calls).toEqual([]);
  });

  it("reads the viewed month once, on first open", async () => {
    renderPanel();
    openPanel();
    expect(await screen.findByText("Vista previa: Auto todavía no usa este saldo")).toBeTruthy();
    expect(calls).toEqual(["/api/admin/fairness?month=2026-11&horizon=1"]);
    openPanel();
    openPanel();
    expect(calls).toHaveLength(1);
  });

  it("shows a skeleton while loading", async () => {
    let release: () => void = () => {};
    answer = () => new Promise((resolve) => (release = () => resolve({ ok: true, status: 200, json: async () => ledger() })));
    renderPanel();
    openPanel();
    expect(screen.getByLabelText("Cargando el saldo de equidad…")).toBeTruthy();
    release();
    await screen.findByText("Vista previa: Auto todavía no usa este saldo");
  });

  it("shows the fixed error with «Reintentar» on a failed read — never an empty table", async () => {
    answer = async () => ({ ok: false, status: 500, json: async () => ({ error: "fairness_unavailable" }) });
    renderPanel();
    openPanel();
    expect((await screen.findByText("No se pudo leer el saldo de equidad.")).getAttribute("role")).toBe("alert");
    expect(document.querySelector("[data-fairness-table]")).toBeNull();
    answer = async () => ({ ok: true, status: 200, json: async () => ledger() });
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await screen.findByText("Vista previa: Auto todavía no usa este saldo");
    expect(calls).toHaveLength(2);
  });
});

describe("the content (UI-3, UI-4, UI-5)", () => {
  it("shows the window chips and the subheader", async () => {
    renderPanel();
    openPanel();
    expect(await screen.findByText("oct: registrado")).toBeTruthy();
    expect(screen.getByText("ago: sin registro, no cuenta")).toBeTruthy();
    expect(screen.getByText('Saldo de ago–oct 2026 (3 meses). "Le deben" = le tocaba más de lo que tuvo.')).toBeTruthy();
  });

  it("lists the Dom Lead tab most owed first, one decimal, in words", async () => {
    renderPanel();
    openPanel();
    const table = (await screen.findAllByRole("table"))[0];
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("cell")[0].textContent)).toEqual(["Alma", "Bruno"]);
    expect(within(rows[0]).getAllByRole("cell").map((c) => c.textContent).slice(1, 5)).toEqual(["0.8", "0", "le deben 0.8", "le deben 0.8"]);
    expect(within(rows[1]).getAllByRole("cell")[3].textContent).toBe("0.8 de más");
  });

  it("switches tabs through the segmented control", async () => {
    renderPanel();
    openPanel();
    await screen.findByText("oct: registrado");
    fireEvent.click(screen.getByRole("radio", { name: "BGV" }));
    const table = screen.getAllByRole("table")[0];
    expect(within(table).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0].textContent)).toEqual(["Alma"]);
  });

  it("keeps the out-group collapsed, with Diego's X1 line on the Dom Lead tab", async () => {
    renderPanel();
    openPanel();
    const toggle = await screen.findByRole("button", { name: "Fuera de esta línea (1)" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByText("En nov descansa: dirigió domingo el 25 oct.").length).toBeGreaterThan(0);
  });

  it("says when no month is recorded yet", async () => {
    answer = async () => ({ ok: true, status: 200, json: async () => ledger({ recordsSince: null, window: ledger().window.map((w) => ({ ...w, record: null })) }) });
    renderPanel();
    openPanel();
    expect(await screen.findByText("Todavía no hay meses registrados: el saldo empieza con el primer registro.")).toBeTruthy();
  });

  it("offers no «Registrar» under v2", async () => {
    renderPanel();
    openPanel();
    await screen.findByText("oct: registrado");
    expect(screen.queryByRole("button", { name: /Registrar elegibilidad/ })).toBeNull();
  });
});
````

**Create** `app/components/admin/__tests__/MonthGenerator.fairnessPreview.test.tsx`:

````tsx
/** @vitest-environment jsdom */
// Solver v3 C2 UI-1, UI-2 — the «Equidad · vista previa» disclosure is mounted BESIDE the
// «sin Lead en …» panel at the config step and in the stored editor, closed, and reads
// nothing until opened: no other suite's `fetch` count changes. Every name is fictitious.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../PlannerGrid", () => ({ default: () => <div data-testid="grid" /> }));

import MonthGenerator from "../MonthGenerator";
import { stubFetchWithHistory } from "./derivedHistoryHarness";
import { AdminProviders } from "./providersHarness";
import { readyRules } from "./rulesHarness";
import type { SolverConfig } from "../plannerModel";

const MEMBERS: ComponentProps<typeof MonthGenerator>["members"] = [
  { _id: "m-alma", member_name: "Alma", memberType: ["voz", "sunday_lead"] },
  { _id: "m-bruno", member_name: "Bruno", memberType: ["voz", "sunday_lead"] },
];
const CONFIG: SolverConfig = { sundayLeads: ["m-alma", "m-bruno"], saturdayLeads: [], support: [], restrictions: [], conflicts: [], presence: [] };
const RULES = readyRules(CONFIG);

const calls: string[] = [];
beforeEach(() => {
  calls.length = 0;
  stubFetchWithHistory((url: string) => {
    calls.push(url);
    return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const fairnessCalls = () => calls.filter((u) => u.startsWith("/api/admin/fairness"));

describe("the «Equidad» preview mounts (C2 UI-1, UI-2)", () => {
  it("sits beside «sin Lead en …» at the config step, closed, reading nothing", async () => {
    render(<MonthGenerator members={MEMBERS} existingRoles={[]} onClose={vi.fn()} onCreated={vi.fn()} rules={RULES} />, {
      wrapper: AdminProviders,
    });
    const toggle = await screen.findByRole("button", { name: "Equidad · vista previa" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getAllByText(/sin Lead en/).length).toBeGreaterThan(0);
    expect(fairnessCalls()).toEqual([]);
    fireEvent.click(toggle);
    await waitFor(() => expect(fairnessCalls()).toHaveLength(1));
    expect(fairnessCalls()[0]).toMatch(/^\/api\/admin\/fairness\?month=\d{4}-\d{2}&horizon=1$/);
  });

  it("sits beside the lead history in the stored editor, for the viewed month", async () => {
    render(
      <MonthGenerator
        mode="stored"
        members={MEMBERS}
        existingRoles={[]}
        allRoles={[]}
        initialMonth="2026-11"
        storedSource={{
          roles: [],
          integrity: { targets: [], recordIssues: [], lockIssues: [] },
          rolesStatus: "ready",
          integrityStatus: "ready",
          rolesGeneration: 1,
          integrityGeneration: 1,
          reload: vi.fn(async () => true),
        }}
        rules={RULES}
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
      { wrapper: AdminProviders },
    );
    const toggle = await screen.findByRole("button", { name: "Equidad · vista previa" });
    expect(fairnessCalls()).toEqual([]);
    fireEvent.click(toggle);
    await waitFor(() => expect(fairnessCalls()).toEqual(["/api/admin/fairness?month=2026-11&horizon=1"]));
    expect((await screen.findByText("No se pudo leer el saldo de equidad.")).getAttribute("role")).toBe("alert");
  });
});
````

**Find** in `app/components/admin/__tests__/participationAlongside.test.tsx`:

````tsx
    // Menu buttons are excluded: a `Menu` trigger («Borrar», spec 2026-09-29 §3.2) is a real
    // `aria-haspopup="menu"` disclosure and always carries `aria-expanded`, as ARIA wants.
    const disclosures = '[aria-expanded]:not([aria-haspopup="menu"])';
    stubWideViewport();
    const { container } = goToGrid([]);
    expect(container.querySelectorAll(disclosures).length).toBe(0);

    fireEvent.click(container.querySelector('[data-row-id="lead"][data-date="2026-02-01"]')!);
    const expanded = container.querySelectorAll(disclosures);
    expect(expanded.length).toBe(1);
    expect(expanded[0].getAttribute("aria-expanded")).toBe("true");
````

**Replace with:**

````tsx
    // Menu buttons are excluded: a `Menu` trigger («Borrar», spec 2026-09-29 §3.2) is a real
    // `aria-haspopup="menu"` disclosure and always carries `aria-expanded`, as ARIA wants.
    // So is the «Equidad · vista previa» toggle (solver v3 C2 UI-3), a real disclosure
    // mounted beside the lead history, outside the grid this test is about.
    const disclosures = (root: ParentNode) =>
      [...root.querySelectorAll('[aria-expanded]:not([aria-haspopup="menu"])')].filter(
        (el) => !el.closest("[data-fairness-preview]"),
      );
    stubWideViewport();
    const { container } = goToGrid([]);
    expect(disclosures(container).length).toBe(0);

    fireEvent.click(container.querySelector('[data-row-id="lead"][data-date="2026-02-01"]')!);
    const expanded = disclosures(container);
    expect(expanded.length).toBe(1);
    expect(expanded[0].getAttribute("aria-expanded")).toBe("true");
````

- [ ] **Step 2: Run them to see them fail**

Run: `git add -A && npx vitest run app/components/admin/__tests__/FairnessPreviewPanel.test.tsx app/components/admin/__tests__/MonthGenerator.fairnessPreview.test.tsx`
Expected: FAIL — `../FairnessPreviewPanel` does not resolve, and no «Equidad · vista previa» button is mounted.

- [ ] **Step 3: Implement**

**Create** `app/components/admin/FairnessPreviewPanel.tsx`:

````tsx
"use client";

// The «Equidad · vista previa» panel (solver v3 C2 UI-1 … UI-7): a READ-ONLY preview of
// the fairness ledger for the month being viewed, mounted beside «sin Lead en …»
// (`LeadPoolHistoryPanel`) at the planner's config step and in the stored editor. It
// changes nothing Auto reads, sends, solves or writes, and a failure of its read never
// blocks Auto or a save.
//
// A closed `Collapse` disclosure that loads on FIRST open — no read for an admin who never
// opens it, and nothing in any other suite's `fetch` count. Every figure is the GET's
// tenths through the one formatter (A17); every string is in `fairnessPreviewModel.ts`.

import { useId, useMemo, useState } from "react";

import Button from "@/app/components/ui/Button";
import Collapse from "@/app/components/ui/Collapse";
import SegmentedControl from "@/app/components/ui/SegmentedControl";
import Skeleton, { SkeletonGroup } from "@/app/components/ui/Skeleton";
import { resolveMonthEligibility, type EligibilityMember } from "@/app/utils/fairnessEligibility";
import type { FairnessLedgerResponse, FairnessPerson, TabKey } from "@/app/utils/fairnessVocabulary";
import {
  COPY,
  TABS,
  cadenceLine,
  chipText,
  onScreenCountedSundays,
  tabRows,
  windowSpan,
  monthYear,
  type PreviewRow,
} from "./fairnessPreviewModel";
import type { SolverConfig } from "./plannerModel";

export const FAIRNESS_ENDPOINT = "/api/admin/fairness";

type Load = { status: "idle" } | { status: "loading" } | { status: "error" } | { status: "ready"; data: FairnessLedgerResponse };

export interface FairnessPreviewPanelProps {
  /** The month being viewed, `YYYY-MM`. Mount with `key={month}` so a new month starts closed. */
  month: string;
  /** The on-screen rule set, unsaved edits included. */
  config: SolverConfig;
  /** The planner's member list as-is (a super-admin's includes kids-only members; RES-5 filters). */
  members: EligibilityMember[];
  /** The month's stored services, with the effective `countsForFairness` the roles GET projects. */
  storedServices: ReadonlyArray<{ _type: string; date: string; countsForFairness?: boolean }>;
  /** Whether the on-screen rules differ from the saved ones. */
  rulesDirty: boolean;
}

function FiguresTable({ rows, total, sinceLabel }: { rows: PreviewRow[]; total: boolean; sinceLabel: string }) {
  return (
    <>
      {/* Desktop: never widens the page — its own horizontal scroller (ADR-0035). */}
      <div className="hidden md:block overflow-x-auto" data-fairness-table="">
        <table className="w-full font-body text-xs text-ink-muted">
          <thead>
            <tr className="font-label text-[10px] uppercase tracking-widest text-mono-500 text-left">
              <th className="py-1 pr-3">{COPY.columns.persona}</th>
              <th className="py-1 pr-3">{COPY.columns.leTocaba}</th>
              <th className="py-1 pr-3">{COPY.columns.tuvo}</th>
              <th className="py-1 pr-3">{COPY.columns.saldo}</th>
              <th className="py-1 pr-3">{COPY.columns.desde(sinceLabel)}</th>
              {total && <th className="py-1 pr-3">{COPY.columns.canto}</th>}
              <th className="py-1">{COPY.columns.motivo}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.memberId} className="border-t border-accent/10 align-top">
                <td className="py-1 pr-3">{r.name}</td>
                <td className="py-1 pr-3 tabular-nums">{r.leTocaba}</td>
                <td className="py-1 pr-3 tabular-nums">{r.tuvo}</td>
                <td className="py-1 pr-3">{r.saldo}</td>
                <td className="py-1 pr-3">{r.desde}</td>
                {total && <td className="py-1 pr-3 tabular-nums">{r.canto}</td>}
                <td className="py-1 text-mono-500">{r.motivo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Phone: one card per person. */}
      <ul className="md:hidden space-y-2" data-fairness-cards="">
        {rows.map((r) => (
          <li key={r.memberId} className="rounded-lg border border-accent/15 bg-surface-raised-alt/40 p-2 font-body text-xs text-ink-muted">
            <p className="font-label text-[11px] uppercase tracking-widest">{r.name}</p>
            <p>
              {COPY.columns.leTocaba} {r.leTocaba} · {COPY.columns.tuvo} {r.tuvo} · {r.saldo}
              {total && ` · ${COPY.columns.canto} ${r.canto}`}
            </p>
            <p className="text-mono-500">
              {COPY.columns.desde(sinceLabel)}: {r.desde}
            </p>
            {r.motivo && <p className="text-mono-500">{r.motivo}</p>}
          </li>
        ))}
      </ul>
    </>
  );
}

export default function FairnessPreviewPanel(props: FairnessPreviewPanelProps) {
  const { month } = props;
  const bodyId = useId();
  const outId = useId();
  const [open, setOpen] = useState(false);
  const [outOpen, setOutOpen] = useState(false);
  const [tab, setTab] = useState<TabKey>("DL");
  const [load, setLoad] = useState<Load>({ status: "idle" });

  const read = async () => {
    setLoad({ status: "loading" });
    try {
      const res = await fetch(`${FAIRNESS_ENDPOINT}?month=${month}&horizon=1`, { cache: "no-store" });
      if (!res.ok) throw new Error(`fairness read ${res.status}`);
      setLoad({ status: "ready", data: (await res.json()) as FairnessLedgerResponse });
    } catch {
      setLoad({ status: "error" });
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && load.status === "idle") void read();
  };

  // The resolver over the on-screen state: X1's eligibility when the month's record does
  // not bind (CAD-2).
  const resolved = useMemo(
    () => resolveMonthEligibility({ month, config: props.config, members: props.members }),
    [month, props.config, props.members],
  );
  const countedSundays = useMemo(() => onScreenCountedSundays(month, props.storedServices), [month, props.storedServices]);

  const data = load.status === "ready" ? load.data : null;
  const extraMotivo = (person: FairnessPerson) => {
    if (!data || tab !== "DL") return "";
    const live = props.members.find((m) => m._id === person.memberId)?.unavailableDates ?? [];
    return (
      cadenceLine({ person, response: data, month, resolved, countedSundays, liveUnavailable: live.map((d) => d.slice(0, 10)) }) ?? ""
    );
  };
  const { rows, out } = data ? tabRows(data, tab, extraMotivo) : { rows: [], out: [] };
  const sinceLabel = data?.recordsSince ? monthYear(data.recordsSince) : "—";

  return (
    <section className="rounded-lg border border-accent/15 bg-surface-raised-alt/40 p-3 space-y-2" data-fairness-preview="">
      <Button variant="ghost" size="sm" onClick={toggle} aria-expanded={open} aria-controls={bodyId}>
        {COPY.disclosure}
      </Button>
      <Collapse id={bodyId} open={open} className="space-y-3">
        {load.status === "loading" && (
          <SkeletonGroup label={COPY.loading} className="space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-24 w-full" rounded="lg" />
          </SkeletonGroup>
        )}
        {load.status === "error" && (
          <div className="flex flex-wrap items-center gap-2">
            <p role="alert" className="font-body text-xs text-negative-fg mr-auto">
              {COPY.error}
            </p>
            <Button variant="secondary" size="sm" onClick={() => void read()}>
              {COPY.retry}
            </Button>
          </div>
        )}
        {data && (
          <>
            <p className="font-label text-[10px] uppercase tracking-widest text-warning-strong">{COPY.banner}</p>
            <p className="font-body text-xs text-mono-500">{COPY.subheader(windowSpan(data.window))}</p>
            <ul className="flex flex-wrap gap-1.5" aria-label="Meses">
              {data.window.map((w) => (
                <li
                  key={w.month}
                  className="font-label text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full border border-accent/25 text-mono-500"
                >
                  {chipText(w)}
                </li>
              ))}
            </ul>
            {data.recordsSince === null && <p className="font-body text-xs text-mono-500">{COPY.empty}</p>}
            <SegmentedControl
              label="Línea"
              size="sm"
              value={tab}
              onChange={setTab}
              options={TABS.map((t) => ({ value: t.key, label: t.label }))}
            />
            <FiguresTable rows={rows} total={tab === "TOTAL"} sinceLabel={sinceLabel} />
            {out.length > 0 && (
              <div className="space-y-1">
                <Button variant="ghost" size="sm" onClick={() => setOutOpen((v) => !v)} aria-expanded={outOpen} aria-controls={outId}>
                  {COPY.outGroup(out.length)}
                </Button>
                <Collapse id={outId} open={outOpen}>
                  <FiguresTable rows={out} total={tab === "TOTAL"} sinceLabel={sinceLabel} />
                </Collapse>
              </div>
            )}
            <p className="font-body text-[11px] text-mono-500">{tab === "TOTAL" ? COPY.totalFooter : COPY.footer}</p>
          </>
        )}
      </Collapse>
    </section>
  );
}
````

**Find** in `app/components/admin/MonthGenerator.tsx`:

````tsx
import { ParticipationSidebar } from "./ParticipationSidebar";
import LeadPoolHistoryPanel from "./LeadPoolHistoryPanel";
import Button from "@/app/components/ui/Button";
import CueDialog from "@/app/components/ui/CueDialog";
````

**Replace with:**

````tsx
import { ParticipationSidebar } from "./ParticipationSidebar";
import LeadPoolHistoryPanel from "./LeadPoolHistoryPanel";
import FairnessPreviewPanel from "./FairnessPreviewPanel";
import Button from "@/app/components/ui/Button";
import CueDialog from "@/app/components/ui/CueDialog";
````

**Find** in `app/components/admin/MonthGenerator.tsx`:

````tsx
// date from another (E17). `ServiceRole` — what `ServicesPanel` actually passes
// — already carries it; this local shape used to drop it on the floor.
interface ExistingRole { _id: string; _type: string; date: string; service_name?: string; }

interface Props {
````

**Replace with:**

````tsx
// date from another (E17). `ServiceRole` — what `ServicesPanel` actually passes
// — already carries it; this local shape used to drop it on the floor.
// `countsForFairness` is the effective flag `GET /api/admin/roles` projects (solver v3 C1);
// the «Equidad» preview counts the month's Sundays with it (C2 UI-5, display only).
interface ExistingRole { _id: string; _type: string; date: string; service_name?: string; countsForFairness?: boolean; }

/** `YYYY-MM` for the «Equidad» preview's `month` and its remount `key`. */
const monthKeyOf = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

/** Whether the on-screen rules differ from the saved ones — «Registrar» says so (C2 §8). */
function rulesDirtyOf(rules: SolverConfigController, config: SolverConfig): boolean {
  const saved = editableConfig(rules.source);
  return saved !== null && !sameSolverConfig(saved, config);
}

interface Props {
````

**Find** in `app/components/admin/MonthGenerator.tsx`:

````tsx
}

function SolverConfigPanel({ members, config, onChange, rules, history, onRemoveHistory, year, month, derived, showCadencePoolWarning = false }: {
  members: MemberOption[];
  config: SolverConfig;
  onChange: (c: SolverConfig) => void;
````

**Replace with:**

````tsx
}

function SolverConfigPanel({ members, config, onChange, rules, history, onRemoveHistory, year, month, derived, showCadencePoolWarning = false, fairnessServices }: {
  members: MemberOption[];
  /** The month's stored services, for the «Equidad» preview's counted Sundays (C2 UI-5). */
  fairnessServices: ExistingRole[];
  config: SolverConfig;
  onChange: (c: SolverConfig) => void;
````

**Find** in `app/components/admin/MonthGenerator.tsx`:

````tsx
        />
      )}

      <RuleBuilder
````

**Replace with:**

````tsx
        />
      )}

      {/* Solver v3 C2 UI-1: the read-only «Equidad» preview, BESIDE «sin Lead en …», never in its place. */}
      <FairnessPreviewPanel
        key={monthKeyOf(year, month)}
        month={monthKeyOf(year, month)}
        config={config}
        members={members}
        storedServices={fairnessServices}
        rulesDirty={rulesDirtyOf(rules, config)}
      />

      <RuleBuilder
````

**Find** in `app/components/admin/MonthGenerator.tsx`:

````tsx
          derived={derivedMode ? derivedHistory : undefined}
          showCadencePoolWarning={showCadencePoolWarning}
        />
      ) : (
````

**Replace with:**

````tsx
          derived={derivedMode ? derivedHistory : undefined}
          showCadencePoolWarning={showCadencePoolWarning}
          fairnessServices={existingRoles}
        />
      ) : (
````

**Find** in `app/components/admin/MonthGenerator.tsx`:

````tsx
        />
      ))}

      {viewMode === "edit" && (
````

**Replace with:**

````tsx
        />
      ))}

      {/* Solver v3 C2 UI-1: the read-only «Equidad» preview, beside the lead history. */}
      {solverConfig && (
        <FairnessPreviewPanel
          key={monthKeyOf(year, month)}
          month={monthKeyOf(year, month)}
          config={solverConfig}
          members={members}
          storedServices={existingRoles}
          rulesDirty={rulesDirtyOf(rules, solverConfig)}
        />
      )}

      {viewMode === "edit" && (
````

**Regenerate** `app/utils/__tests__/__fixtures__/colour-inventory.json` (it records `filesScanned`, and this task adds a file under `app/`):

```bash
node scripts/colour-inventory.mjs
```

- [ ] **Step 4: Run them to see them pass**

Run: `git add -A && npx vitest run app/components/admin/__tests__/FairnessPreviewPanel.test.tsx app/components/admin/__tests__/MonthGenerator.fairnessPreview.test.tsx app/components/admin/__tests__/participationAlongside.test.tsx app/components/admin/__tests__/MonthGenerator.derivedHistory.test.tsx app/components/admin/__tests__/MonthGenerator.create.test.tsx app/components/admin/__tests__/MonthGenerator.stored.test.tsx`
Expected: PASS — the existing `MonthGenerator` suites, which count `fetch` calls, are unchanged and green.

- [ ] **Step 5: Gates and commit**

Run: `git add -A && npx tsc --noEmit && npm test && npx eslint .`
Expected: **467 files / 8623 tests**; 0 errors, 81 warnings (`cueDialogMount`, `inputFontSize`, `clientBoundary`, `colourInventory` green).

```bash
git add -A
git commit -m "feat(planner): the read-only «Equidad · vista previa» panel beside the lead history" -m "Solver v3 C2 UI-1 to UI-5 and UI-7. A closed disclosure mounted beside «sin Lead en …» at the config step and in the stored editor (keyed by month, so a new month starts closed) that reads GET /api/admin/fairness only on first open: a skeleton while loading, the fixed error with «Reintentar» on a failure, then the banner, the window chips, the five tabs through the house SegmentedControl, the table on desktop (its own horizontal scroller) or one card per person on a phone, and a collapsed out-group whose Dom Lead motivo carries a «Mes por medio» person's X1 line. Nothing Auto reads, sends, solves or writes changes, and no other suite's fetch count moves. The grid's aria-expanded test now leaves the preview's own disclosure out, as it already did a Menu trigger."
```


---

## Task 15: «Registrar elegibilidad de {mes}» — [standard UI over the critical writer; reachable only under engine v3]

Spec UI-6, WR-15. Offered only when the GET's effective `engine` is `"v3"` — never in production while `SOLVER_ENGINE` is `"v2"` and `OWT_SOLVER_ENGINE` is unset — for the current month up to 12 months ahead (WR-4's ceiling), and replaced by the `month_has_services` line when the month's record binds. It builds the body with the resolver from the on-screen rules and members (kids-only members filtered — RES-5), sends `source: "manual"`, and asserts the horizon record's `rev` the panel READ (or `null`). The `CueDialog` (`open={dialogOpen}`) names the replacement, unsaved rules, a frozen first record and a write from dev/local into production data; it stays open on every refusal with §8's copy; on any 409 it re-reads the GET — content and `rev` together, keeping the figures on screen — and the confirm stays disabled until that read lands; success flashes «Registrado ✓» (`useTransientValue`) and re-reads. The handler wraps `fetch` in try/catch/finally, checks `res.ok`, resets its flag and never closes as success on failure.

**Files:**
- Modify: `app/components/admin/FairnessPreviewPanel.tsx`
- Test: `app/components/admin/__tests__/FairnessPreviewPanel.registrar.test.tsx`

**Interfaces:**
- Consumes: Task 13's `REGISTRAR`, `refusalMessage`, `resolverLines`; Task 1's `RECORD_LIMITS` (Task 12), `monthIndex`; `CueDialog`; `useTransientValue`.
- Produces: `FAIRNESS_MONTHS_ENDPOINT = "/api/admin/fairness/months"`; the panel's «Registrar» behaviour.

- [ ] **Step 1: Write the failing test**

**Create** `app/components/admin/__tests__/FairnessPreviewPanel.registrar.test.tsx`:

````tsx
/** @vitest-environment jsdom */
// Solver v3 C2 UI-6, WR-15 — «Registrar elegibilidad de {mes}»: offered under engine v3
// only, for the current month up to 12 months ahead, replaced by a line when the record
// binds; its CueDialog says what is replaced, what is frozen and where the write lands;
// it sends the resolver's body with `source: "manual"` and the revision the panel READ;
// on a 409 it re-reads the GET before any retry; the dialog stays open on every refusal.
// The fetch mock routes by URL and method and only CAPTURES. Every name is fictitious.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FairnessLedgerResponse, LogicalRecord } from "@/app/utils/fairnessVocabulary";
import FairnessPreviewPanel, { type FairnessPreviewPanelProps } from "../FairnessPreviewPanel";
import type { SolverConfig } from "../plannerModel";
import { AdminProviders } from "./providersHarness";

const RECORD: LogicalRecord = {
  month: "2026-11",
  rev: "rev-9",
  contentHash: "sha256:x",
  source: "auto",
  engine: "v3",
  environment: "production",
  recordedAt: "2026-10-03T15:00:00.000Z",
  people: [],
  presence: [],
};

function ledger(patch: Partial<FairnessLedgerResponse> = {}, horizon: Partial<FairnessLedgerResponse["horizon"][number]> = {}): FairnessLedgerResponse {
  return {
    v: 1,
    engine: "v3",
    environment: "production",
    currentMonth: "2026-10",
    target: "2026-11",
    window: [
      { month: "2026-08", record: null },
      { month: "2026-09", record: null },
      { month: "2026-10", record: null },
    ],
    recordsSince: null,
    horizon: [{ month: "2026-11", record: RECORD, storedServices: 0, recordBinds: false, ...horizon }],
    people: [],
    diagnostics: { duplicateTargets: [], notInRecordSeats: 0, unknownMembers: [] },
    ...patch,
  };
}

const CONFIG: SolverConfig = { sundayLeads: ["m-alma", "m-kids"], saturdayLeads: [], support: [], restrictions: [], conflicts: [], presence: [] };
const MEMBERS = [
  { _id: "m-alma", member_name: "Alma", memberType: ["voz", "sunday_lead"] },
  { _id: "m-bruno", member_name: "Bruno", memberType: ["voz", "support"] },
  // A super-admin's roster also holds kids-only members (RES-5).
  { _id: "m-kids", member_name: "Kim", memberType: ["voz", "sunday_lead"], ministries: ["kids"] },
];

type Answer = { ok: boolean; status: number; json: () => Promise<unknown> };
const json = (status: number, body: unknown): Answer => ({ ok: status < 300, status, json: async () => body });
const gets: string[] = [];
const puts: Array<{ months: Array<Record<string, unknown>> }> = [];
let getAnswers: Answer[];
let putAnswer: () => Promise<Answer>;

beforeEach(() => {
  gets.length = 0;
  puts.length = 0;
  getAnswers = [json(200, ledger())];
  putAnswer = async () => json(200, { months: [] });
  vi.stubGlobal("fetch", (url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === "PUT") {
      puts.push(JSON.parse(init.body ?? "{}"));
      return putAnswer();
    }
    gets.push(url);
    return Promise.resolve(getAnswers.length > 1 ? getAnswers.shift()! : getAnswers[0]);
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openPanel(patch: Partial<FairnessPreviewPanelProps> = {}) {
  render(<FairnessPreviewPanel month="2026-11" config={CONFIG} members={MEMBERS} storedServices={[]} rulesDirty={false} {...patch} />, {
    wrapper: AdminProviders,
  });
  fireEvent.click(screen.getByRole("button", { name: "Equidad · vista previa" }));
  await screen.findByText("Vista previa: Auto todavía no usa este saldo");
}
const registrar = () => screen.queryByRole("button", { name: "Registrar elegibilidad de noviembre" });
const confirmButton = () => screen.getByRole("button", { name: "Registrar" });

describe("when «Registrar» is offered (UI-6)", () => {
  it("is offered under v3 for the current month up to 12 months ahead", async () => {
    await openPanel();
    expect(registrar()).toBeTruthy();
  });

  it.each([
    ["under v2", ledger({ engine: "v2" })],
    ["for a past month", ledger({ currentMonth: "2026-12" })],
    ["more than 12 months ahead", ledger({ currentMonth: "2025-10" })],
  ])("is not offered %s", async (_label, answer) => {
    getAnswers = [json(200, answer)];
    await openPanel();
    expect(registrar()).toBeNull();
  });

  it("is replaced by the month_has_services line when the record binds", async () => {
    getAnswers = [json(200, ledger({}, { storedServices: 4, recordBinds: true }))];
    await openPanel();
    expect(registrar()).toBeNull();
    expect(screen.getByText("Noviembre ya tiene servicios guardados: su registro ya no se puede reemplazar.")).toBeTruthy();
  });
});

describe("the dialog (UI-6, §8)", () => {
  it("names the replacement, unsaved rules and a write from dev", async () => {
    getAnswers = [json(200, ledger({ environment: "preview" }))];
    await openPanel({ rulesDirty: true });
    fireEvent.click(registrar()!);
    expect(await screen.findByText(/Se guarda quién está en cada lista de noviembre/)).toBeTruthy();
    expect(screen.getByText("Las reglas tienen cambios sin guardar; se registran tal como están en pantalla.")).toBeTruthy();
    expect(screen.getByText("Reemplaza el registro guardado el 3 oct.")).toBeTruthy();
    expect(screen.getByText(/Estás en dev: este registro se guarda en los datos reales del equipo/)).toBeTruthy();
  });

  it("warns that an unrecorded month with services gets its frozen record", async () => {
    getAnswers = [json(200, ledger({}, { record: null, storedServices: 3 }))];
    await openPanel();
    fireEvent.click(registrar()!);
    expect(await screen.findByText(/Noviembre ya tiene servicios guardados: este será su registro/)).toBeTruthy();
    expect(screen.queryByText(/Estás en/)).toBeNull();
  });

  it("refuses before any write when the resolver refuses, naming the person", async () => {
    await openPanel({ config: { ...CONFIG, restrictions: [{ id: "r1", person: "Nadie", excludedPatterns: [], fairness: "none", fairnessSlack: 1, weekExclusions: [], caps: [] }] } });
    fireEvent.click(registrar()!);
    expect(await screen.findByText(/nombres que no corresponden a una sola persona: Nadie/)).toBeTruthy();
    expect((confirmButton() as HTMLButtonElement).disabled).toBe(true);
    expect(puts).toEqual([]);
  });
});

describe("the write (UI-6, WR-15)", () => {
  it("sends the resolver's body, source manual, asserting the revision it read — without kids-only members", async () => {
    getAnswers = [json(200, ledger()), json(200, ledger({}, { record: { ...RECORD, rev: "rev-10" } }))];
    await openPanel();
    fireEvent.click(registrar()!);
    fireEvent.click(confirmButton());
    await waitFor(() => expect(puts).toHaveLength(1));
    const [entry] = puts[0].months;
    expect(entry).toMatchObject({ month: "2026-11", source: "manual", expectedRev: "rev-9" });
    expect((entry.people as Array<{ memberId: string }>).map((p) => p.memberId)).toEqual(["m-alma", "m-bruno"]);
    expect(await screen.findByText("Registrado ✓")).toBeTruthy();
    expect(gets).toHaveLength(2);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("sends expectedRev null for an unrecorded month", async () => {
    getAnswers = [json(200, ledger({}, { record: null }))];
    await openPanel();
    fireEvent.click(registrar()!);
    fireEvent.click(confirmButton());
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].months[0].expectedRev).toBeNull();
  });

  it("keeps the dialog open on a 409, re-reads the GET, and retries on the revision it re-read", async () => {
    getAnswers = [json(200, ledger()), json(200, ledger({}, { record: { ...RECORD, rev: "rev-11" } }))];
    putAnswer = async () => json(409, { error: "stale_revision", conflict: true, details: { detail: "stale_revision", months: [] } });
    await openPanel();
    fireEvent.click(registrar()!);
    fireEvent.click(confirmButton());
    expect(await screen.findByText("El registro de noviembre cambió mientras tanto. Recarga y vuelve a intentar.")).toBeTruthy();
    await waitFor(() => expect(gets).toHaveLength(2));
    await waitFor(() => expect((confirmButton() as HTMLButtonElement).disabled).toBe(false));
    putAnswer = async () => json(200, { months: [] });
    fireEvent.click(confirmButton());
    await waitFor(() => expect(puts).toHaveLength(2));
    expect(puts[1].months[0].expectedRev).toBe("rev-11");
  });

  it("names record_exists, and anything else with the fallback, without re-reading on a 400", async () => {
    putAnswer = async () => json(409, { details: { detail: "record_exists" } });
    await openPanel();
    fireEvent.click(registrar()!);
    fireEvent.click(confirmButton());
    expect(await screen.findByText("Otro administrador registró noviembre mientras tanto. Recarga para ver su registro.")).toBeTruthy();
    putAnswer = async () => json(400, { error: "invalid_request" });
    await waitFor(() => expect((confirmButton() as HTMLButtonElement).disabled).toBe(false));
    const before = gets.length;
    fireEvent.click(confirmButton());
    expect(await screen.findByText("No se pudo registrar. No se guardó nada; vuelve a intentar.")).toBeTruthy();
    expect(gets).toHaveLength(before);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("survives a network error: the fallback copy, the dialog open, the button usable again", async () => {
    putAnswer = async () => {
      throw new TypeError("Failed to fetch");
    };
    await openPanel();
    fireEvent.click(registrar()!);
    fireEvent.click(confirmButton());
    expect(await screen.findByText("No se pudo registrar. No se guardó nada; vuelve a intentar.")).toBeTruthy();
    await waitFor(() => expect((confirmButton() as HTMLButtonElement).disabled).toBe(false));
  });
});
````

- [ ] **Step 2: Run it to see it fail**

Run: `git add -A && npx vitest run app/components/admin/__tests__/FairnessPreviewPanel.registrar.test.tsx`
Expected: FAIL — no «Registrar elegibilidad de noviembre» button exists.

- [ ] **Step 3: Implement**

**Find** in `app/components/admin/FairnessPreviewPanel.tsx`:

````tsx
// opens it, and nothing in any other suite's `fetch` count. Every figure is the GET's
// tenths through the one formatter (A17); every string is in `fairnessPreviewModel.ts`.

import { useId, useMemo, useState } from "react";
````

**Replace with:**

````tsx
// opens it, and nothing in any other suite's `fetch` count. Every figure is the GET's
// tenths through the one formatter (A17); every string is in `fairnessPreviewModel.ts`.
//
// «Registrar elegibilidad de {mes}» (UI-6) is its one write: offered only when the GET's
// effective engine is v3 (so never in production while the constant is v2) and the
// month is between the current one and 12 months ahead; replaced by a line when the
// month's record binds (WR-8 row 7 would refuse it). It builds the body with the
// resolver from the on-screen state, sends `source: "manual"` and asserts the record
// revision the panel READ (WR-15); on any 409 it re-reads the GET — content and
// revision together — before a retry is possible, and the dialog stays open on every
// refusal.

import { useId, useMemo, useState } from "react";
````

**Find** in `app/components/admin/FairnessPreviewPanel.tsx`:

````tsx
import Button from "@/app/components/ui/Button";
import Collapse from "@/app/components/ui/Collapse";
import SegmentedControl from "@/app/components/ui/SegmentedControl";
import Skeleton, { SkeletonGroup } from "@/app/components/ui/Skeleton";
import { resolveMonthEligibility, type EligibilityMember } from "@/app/utils/fairnessEligibility";
import type { FairnessLedgerResponse, FairnessPerson, TabKey } from "@/app/utils/fairnessVocabulary";
import {
  COPY,
  TABS,
  cadenceLine,
  chipText,
  onScreenCountedSundays,
  tabRows,
  windowSpan,
````

**Replace with:**

````tsx
import Button from "@/app/components/ui/Button";
import Collapse from "@/app/components/ui/Collapse";
import CueDialog from "@/app/components/ui/CueDialog";
import SegmentedControl from "@/app/components/ui/SegmentedControl";
import Skeleton, { SkeletonGroup } from "@/app/components/ui/Skeleton";
import { resolveMonthEligibility, type EligibilityMember } from "@/app/utils/fairnessEligibility";
import {
  RECORD_LIMITS,
  monthIndex,
  type FairnessLedgerResponse,
  type FairnessPerson,
  type TabKey,
} from "@/app/utils/fairnessVocabulary";
import { useTransientValue } from "@/app/utils/useTransientValue";
import {
  COPY,
  REGISTRAR,
  TABS,
  cadenceLine,
  chipText,
  onScreenCountedSundays,
  refusalMessage,
  resolverLines,
  tabRows,
  windowSpan,
````

**Find** in `app/components/admin/FairnessPreviewPanel.tsx`:

````tsx

export const FAIRNESS_ENDPOINT = "/api/admin/fairness";

type Load = { status: "idle" } | { status: "loading" } | { status: "error" } | { status: "ready"; data: FairnessLedgerResponse };
````

**Replace with:**

````tsx

export const FAIRNESS_ENDPOINT = "/api/admin/fairness";
export const FAIRNESS_MONTHS_ENDPOINT = "/api/admin/fairness/months";

type Load = { status: "idle" } | { status: "loading" } | { status: "error" } | { status: "ready"; data: FairnessLedgerResponse };
````

**Find** in `app/components/admin/FairnessPreviewPanel.tsx`:

````tsx
  const [tab, setTab] = useState<TabKey>("DL");
  const [load, setLoad] = useState<Load>({ status: "idle" });

  const read = async () => {
    setLoad({ status: "loading" });
    try {
      const res = await fetch(`${FAIRNESS_ENDPOINT}?month=${month}&horizon=1`, { cache: "no-store" });
````

**Replace with:**

````tsx
  const [tab, setTab] = useState<TabKey>("DL");
  const [load, setLoad] = useState<Load>({ status: "idle" });
  const [reading, setReading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [success, showSuccess] = useTransientValue<string | null>(null, 3000);

  // A re-read keeps the figures on screen until the new ones arrive (a refused
  // «Registrar» re-reads while its dialog is open).
  const read = async () => {
    setReading(true);
    setLoad((prev) => (prev.status === "ready" ? prev : { status: "loading" }));
    try {
      const res = await fetch(`${FAIRNESS_ENDPOINT}?month=${month}&horizon=1`, { cache: "no-store" });
````

**Find** in `app/components/admin/FairnessPreviewPanel.tsx`:

````tsx
    } catch {
      setLoad({ status: "error" });
    }
  };
````

**Replace with:**

````tsx
    } catch {
      setLoad({ status: "error" });
    } finally {
      setReading(false);
    }
  };
````

**Find** in `app/components/admin/FairnessPreviewPanel.tsx`:

````tsx
  const { rows, out } = data ? tabRows(data, tab, extraMotivo) : { rows: [], out: [] };
  const sinceLabel = data?.recordsSince ? monthYear(data.recordsSince) : "—";

  return (
````

**Replace with:**

````tsx
  const { rows, out } = data ? tabRows(data, tab, extraMotivo) : { rows: [], out: [] };
  const sinceLabel = data?.recordsSince ? monthYear(data.recordsSince) : "—";

  // UI-6 — «Registrar»: v3 only, and only for a month the record writer accepts.
  const horizon = data?.horizon.find((h) => h.month === month) ?? null;
  const registrable =
    data !== null &&
    data.engine === "v3" &&
    monthIndex(month) >= monthIndex(data.currentMonth) &&
    monthIndex(month) <= monthIndex(data.currentMonth) + RECORD_LIMITS.monthsAhead;

  const confirm = async () => {
    if (!resolved.ok || !data) return;
    setSaving(true);
    setRefusal(null);
    try {
      const res = await fetch(FAIRNESS_MONTHS_ENDPOINT, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ months: [{ ...resolved.body, source: "manual", expectedRev: horizon?.record?.rev ?? null }] }),
      });
      if (res.ok) {
        setDialogOpen(false);
        showSuccess(REGISTRAR.success);
        await read();
        return;
      }
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      setRefusal(refusalMessage(month, body));
      // WR-15: never retry on the revision just refused — re-read content and rev together.
      if (res.status === 409) await read();
    } catch {
      setRefusal(REGISTRAR.failed);
    } finally {
      setSaving(false);
    }
  };

  return (
````

**Find** in `app/components/admin/FairnessPreviewPanel.tsx`:

````tsx
            )}
            <p className="font-body text-[11px] text-mono-500">{tab === "TOTAL" ? COPY.totalFooter : COPY.footer}</p>
          </>
        )}
      </Collapse>
    </section>
  );
````

**Replace with:**

````tsx
            )}
            <p className="font-body text-[11px] text-mono-500">{tab === "TOTAL" ? COPY.totalFooter : COPY.footer}</p>
            {registrable &&
              (horizon?.recordBinds ? (
                <p className="font-body text-xs text-mono-500">{REGISTRAR.monthHasServices(month)}</p>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setRefusal(null);
                      setDialogOpen(true);
                    }}
                  >
                    {REGISTRAR.button(month)}
                  </Button>
                  {success && <span className="font-body text-xs text-accent">{success}</span>}
                </div>
              ))}
          </>
        )}
      </Collapse>
      <CueDialog
        open={dialogOpen}
        title={REGISTRAR.button(month)}
        onDismiss={() => {
          if (!saving) setDialogOpen(false);
        }}
      >
        <div className="space-y-2 font-body text-sm text-ink-muted">
          <p>{REGISTRAR.body(month)}</p>
          {!resolved.ok &&
            resolverLines(month, resolved).map((line) => (
              <p key={line} role="alert" className="text-negative-fg">
                {line}
              </p>
            ))}
          {props.rulesDirty && <p>{REGISTRAR.unsaved}</p>}
          {horizon?.record ? (
            <p>{REGISTRAR.replace(horizon.record.recordedAt)}</p>
          ) : horizon && horizon.storedServices > 0 ? (
            <p>{REGISTRAR.frozenCreate(month)}</p>
          ) : null}
          {data && data.environment !== "production" && <p>{REGISTRAR.devEnvironment(data.environment)}</p>}
          {refusal && (
            <p role="alert" className="text-negative-fg">
              {refusal}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" disabled={saving} onClick={() => setDialogOpen(false)}>
              {REGISTRAR.cancel}
            </Button>
            <Button
              variant="primary"
              size="sm"
              busy={saving}
              disabled={!resolved.ok || saving || reading || load.status !== "ready"}
              onClick={() => void confirm()}
            >
              {REGISTRAR.confirm}
            </Button>
          </div>
        </div>
      </CueDialog>
    </section>
  );
````

- [ ] **Step 4: Run it to see it pass**

Run: `git add -A && npx vitest run app/components/admin/__tests__/FairnessPreviewPanel.registrar.test.tsx app/components/admin/__tests__/FairnessPreviewPanel.test.tsx app/utils/__tests__/cueDialogMount.test.ts`
Expected: PASS — the read-only suite still finds no «Registrar» under v2, and `cueDialogMount` accepts `open={dialogOpen}`.

- [ ] **Step 5: Gates and commit**

Run: `git add -A && npx tsc --noEmit && npm test && npx eslint .`
Expected: **468 files / 8636 tests**; 0 errors, 81 warnings.

```bash
git add -A
git commit -m "feat(planner): «Registrar elegibilidad de {mes}» in the «Equidad» preview" -m "Solver v3 C2 UI-6 and WR-15. The preview's one write, offered only when the GET's effective engine is v3 — so never in production while SOLVER_ENGINE is v2 and OWT_SOLVER_ENGINE is unset — for the current month up to 12 months ahead, and replaced by a line when the month's record binds. It builds the body with the eligibility resolver from the on-screen rules and members (kids-only members filtered), sends source manual and asserts the record revision the panel read, and confirms through a CueDialog that names the replacement, unsaved rules, a frozen first record and a write from dev into production data. Every refusal keeps the dialog open with its copy; a 409 re-reads the GET before a retry is possible; success flashes «Registrado ✓» and re-reads."
```


---

## Task 16: The ADR and the docs — [standard; docs-audit material]

Spec GU-3, GU-4, EN-3 (its SECRETS entry landed in Task 2), parent A31 (C2 amends no existing ADR). ADR-0050 «El saldo de equidad se mide contra la elegibilidad registrada»; `docs/adr/README.md`; `CONTEXT.md` (created: the repository has none — `docs/agents/domain.md` expects it at the root); `docs/DATA_MODEL.md` (21 registered types, 8 internal, 16 Studio-protected, the type's section and its inline object types); `docs/API_REFERENCE.md` (both routes); `docs/UTILITIES_AND_COMPONENTS.md` (a C2 section); `docs/SECRETS.md` (`SANITY_API_READ_TOKEN` is needed to read `fairnessMonth`, on the `Preview, Production` pair and in `.env.local`, and its rotation's blast radius); `CLAUDE.md` and `AGENTS.md` (the invariant and the reusable-utils entries GU-4 lists, identical in both).

**Files:**
- Create: `docs/adr/0050-the-fairness-balance-is-measured-against-recorded-eligibility.md`, `CONTEXT.md`
- Modify: `docs/adr/README.md` (append), `docs/DATA_MODEL.md` (`:14-20`, before «## `tag`, `author`», the inline-types table, «### Protected types in the Studio»), `docs/API_REFERENCE.md` (after the `solver-history` entry), `docs/UTILITIES_AND_COMPONENTS.md` (after C3's section), `docs/SECRETS.md` (`### SANITY_API_READ_TOKEN`, «Blast radius if you revoke first»), `CLAUDE.md` and `AGENTS.md` (after the `solverConfig` invariant; the end of «Reusable utils»)

**Interfaces:** none (documentation).

- [ ] **Step 1: Write the ADR and index it**

**Create** `docs/adr/0050-the-fairness-balance-is-measured-against-recorded-eligibility.md`:

````markdown
# ADR-0050: El saldo de equidad se mide contra la elegibilidad registrada

**Date:** 2026-10-06 · **Status:** Accepted

## Context

Solver v3 balances each person's share of the voice seats over the three months before a run
(the fairness ledger, spec `docs/superpowers/specs/2026-10-05-solver-v3-c2-ledger-and-record-design.md`).
A share needs a denominator: who was eligible for each role on each service. Nothing recorded it.
The pool checkboxes live in one overwritten singleton (`solverConfig`), so the derived history of
ADR-0042 counted seats with no denominator and read an occasional leader as owed Sundays
(ADR-0046); the «sin Lead en …» panel judges last month against today's pool. Judging the past
against today's rules is the same failure in another form.

## Decision

- **Eligibility is stored, once per month; seats stay derived.** One `fairnessMonth` document per
  calendar month (`fairnessMonth.YYYY-MM`) snapshots, per worship member with `voz`, the six voice
  role keys as `in`/`out`/`exact`, the exact rules resolved for that month, «Mes por medio» (the
  setting, never the state), «Exenta», per-date blocks (unavailable, rule-excluded) and the presence
  rules. It never stores a seat, a share, a balance or a cadence state: seats are read from the role
  documents, as ADR-0042 decided.
- **The id is dotted, so the record is private** (parent A2): Sanity serves no id containing a dot
  to an unauthenticated read. The consequence is a rule for every reader: a read without the read
  token answers «no record» with no error, so the ledger reader checks `SANITY_API_READ_TOKEN`
  before any read and the write executor refuses a read client without the token, the `published`
  perspective and `useCdn: false`. Missing the token fails closed; it can never pass for an empty
  past. (Precedent that dotted ids read under the published perspective with the token: the
  `roleTarget.*` locks, read through `operationalClient` by `roleWriteOps.ts`.)
- **One write executor** (`executeFairnessMonthWrites`, `app/utils/fairnessMonthWriteRequest.ts`)
  issues every mutation, for the PUT (`fairnessMonthCommit.ts`, actor `route`) and for C4's
  consented reconstruction script (actor `reconstruction`). Create is a plain create (the id
  collision is the mutex); replace is one `ifRevisionId` patch that sets every field and unsets the
  rest; `createOrReplace` is never used. Because its client is injected, the protected-read audit
  gained an executor rule: declaring or calling it is a `protected-write` site.
- **Freezing services and record binding** (parent A5, A6). A month's freezing services are its
  stored weekend services and its counted specials. A record exists → a create; a record exists and
  the month has no freezing service → it may be replaced; it has one → the record is frozen (the
  PUT refuses `month_has_services`) and BINDS: the record is what that month was solved with. A
  create never depends on freezing services (A27).
- **Past months are written only by reconstruction**, which touches only intact records it wrote
  and is the only actor that deletes (a revision-asserting no-op patch and the delete in one
  transaction). The route refuses a past month.
- **Exact arithmetic, one rounding each.** Shares are BigInt rationals; each wire figure is rounded
  once to hundredths (half away from zero) and the wire balance is `share − received`, both in
  hundredths; each display tenth is rounded once from the same exact value, never from the
  hundredths (A17, A39).
- **One seat per person per service** (LG-4): a holder's second voice seat at one service is set
  aside `second_seat` before every other rule, exactly as the v3 request carries only the kept seat.

## Rejected

- **Reading eligibility live from `solverConfig`** — judges a past month against today's pools and
  rules: the failure this record exists to end.
- **Storing seats or balances in the record** — a second copy of what the role documents already
  say, which drifts the first time a past service is edited.
- **A root (undotted) id** — the record holds members' unavailable dates; an undotted id is served
  to anyone who asks the dataset.
- **`createOrReplace` for a replace** — it cannot assert a revision and would silently discard a
  concurrent admin's record (L3).
- **Rounding the exact balance on its own** — at an exact half it disagrees with `share − received`
  (0.125 among eight: −87, not −88), and the two suites of the golden fixture must agree to the
  hundredth.

## Consequences

- **Residual race, accepted.** The freezing-services read and the commit are not atomic: a service
  created (or a special toggled to counted) between them lets a replace land on a month that just
  froze. The `ifRevisionId` still guarantees the replaced record is the one read, and the window is
  milliseconds. Likewise an `unchanged` answer can carry a revision a concurrent replace just
  superseded; the panel re-reads the GET on any 409, so the next attempt asserts the new one.
- **No repair path for a malformed or route-written record** in the app or in C4's script: the GET
  fails closed on a malformed record, and repairing one is a separate consented script reviewed on
  its own.
- **Engine gate.** The PUT answers `engine_not_v3` unless the effective engine is v3; until C7's
  flip that means only the `preview` branch deployment or a local server with `OWT_SOLVER_ENGINE=v3`
  (docs/SECRETS.md) — and both write the PRODUCTION dataset, stamped `preview`/`local`.
- Every amendment to an existing ADR (ADR-0042's «amended under v3» included) is C7's, at the flip
  (parent A31). This record amends none.
````

**Find** in `docs/adr/README.md`:

````markdown
- [ADR-0048: The Saturday after the last Sunday belongs to its calendar month](0048-the-saturday-after-the-last-sunday-belongs-to-its-calendar-month.md) — **amends D16** of the planner-grid plan. Why the planner sends the month-end Saturday whose Sunday is in the next month (31 Oct 2026) as solver week `weeks + 1`, through one definition (`trailingSaturday`) that every week mapping and the grid's rule context (`ruleContextForTarget`) resolve through, and why «Fuera del alcance de Auto» is gone. It is sent only when some lead can take it (T5), and a withheld one sends no exclusion for its own week (Q9). Saturday minimums are judged per person: first what each person can reach (T3), then a per-Saturday seat assignment (`floorsFitSeats`, T4), which replaced a pooled count that kept sets the solver cannot seat. Records when a request stays byte-identical, what the seat model leaves to the solver (the dedicated-lead anchor, zero maximums, pins, the one-Lead-per-Saturday rule), and the rejected alternatives. Since ruling Q19, when the solver itself refuses a month that sent the 31st, Auto solves it once more without it (`withholdTrailing`; the route tags the failures it makes when it cannot get the solver's answer `transport_error`, and those never retry), so each of those limits costs one extra solve and a 31st filled by hand, never the month
- [ADR-0049: «Mes por medio» is a rule setting, and the rules POST refuses another config version](0049-mes-por-medio-is-a-restriction-setting-behind-a-version-guard.md) — solver v3 C3. Why the cadence is a `solverConfig` restriction setting keyed by name (not a `teamMembers` field, ADR-0029) with no stored state, why a whole-document save is protected by a refuse-not-merge `SOLVER_CONFIG_VERSION` (and why `invalid_request`, not `stale_revision`), why the one-exact-count check (parent A38) judges `person` text at save and member id at v3 build, why the resolver applies the worship filter itself, and the rule that every other writer of rule values goes through the parser and serializer — superseding two one-off scripts that appended caps with none. Rollback is UI-only once C2 ships, and keeps the form's data path
````

**Replace with:**

````markdown
- [ADR-0048: The Saturday after the last Sunday belongs to its calendar month](0048-the-saturday-after-the-last-sunday-belongs-to-its-calendar-month.md) — **amends D16** of the planner-grid plan. Why the planner sends the month-end Saturday whose Sunday is in the next month (31 Oct 2026) as solver week `weeks + 1`, through one definition (`trailingSaturday`) that every week mapping and the grid's rule context (`ruleContextForTarget`) resolve through, and why «Fuera del alcance de Auto» is gone. It is sent only when some lead can take it (T5), and a withheld one sends no exclusion for its own week (Q9). Saturday minimums are judged per person: first what each person can reach (T3), then a per-Saturday seat assignment (`floorsFitSeats`, T4), which replaced a pooled count that kept sets the solver cannot seat. Records when a request stays byte-identical, what the seat model leaves to the solver (the dedicated-lead anchor, zero maximums, pins, the one-Lead-per-Saturday rule), and the rejected alternatives. Since ruling Q19, when the solver itself refuses a month that sent the 31st, Auto solves it once more without it (`withholdTrailing`; the route tags the failures it makes when it cannot get the solver's answer `transport_error`, and those never retry), so each of those limits costs one extra solve and a 31st filled by hand, never the month
- [ADR-0049: «Mes por medio» is a rule setting, and the rules POST refuses another config version](0049-mes-por-medio-is-a-restriction-setting-behind-a-version-guard.md) — solver v3 C3. Why the cadence is a `solverConfig` restriction setting keyed by name (not a `teamMembers` field, ADR-0029) with no stored state, why a whole-document save is protected by a refuse-not-merge `SOLVER_CONFIG_VERSION` (and why `invalid_request`, not `stale_revision`), why the one-exact-count check (parent A38) judges `person` text at save and member id at v3 build, why the resolver applies the worship filter itself, and the rule that every other writer of rule values goes through the parser and serializer — superseding two one-off scripts that appended caps with none. Rollback is UI-only once C2 ships, and keeps the form's data path
- [ADR-0050: El saldo de equidad se mide contra la elegibilidad registrada](0050-the-fairness-balance-is-measured-against-recorded-eligibility.md) — solver v3 C2. Why eligibility is stored once per month (`fairnessMonth`) while seats stay derived from the role documents (ADR-0042), why the record's id is dotted (private) and every reader carries the read token or fails closed, the one write executor and the audit's executor rule, freezing services and record binding (A5, A6) with the residual race stated, why past months are written only by the reconstruction actor (the only delete), exact arithmetic rounded once to hundredths for the wire and once to tenths for display, and one seat per person per service. Amends no existing ADR (parent A31: C7 does, at the flip)
````

- [ ] **Step 2: The domain glossary**

**Create** `CONTEXT.md`:

````markdown
# OWT Backstage

Internal app for the Oasis Worship Team: song library, weekly setlists, role
assignments, availability, and setlist proposals.

## Language

**Registro de elegibilidad** (`fairnessMonth`):
The record, once per calendar month, of who was eligible for which voice role —
each person's six role keys as `in`, `out` or `exact`, her fixed counts, «Mes por
medio», «Exenta», the dates she was unavailable or excluded by a rule, and the
presence rules. It is what the month was planned with; seats are never stored in it.
Written by «Registrar», by Auto's confirm (v3) or by the reconstruction script.
_Avoid_: history, snapshot of the pools

**Saldo**:
A person's balance on one line over a window: the share of the seats she was owed
(«le tocaba») minus the seats she had («tuvo»). Positive = «le deben»; negative =
«de más». Over every person of a service the exact saldos sum to zero.
_Avoid_: deuda, score

**Línea**:
One of the four fairness ledgers a person carries: Dom Lead (`DL`), Sáb Lead (`SL`),
BGV and Coro. Instruments and FOH have none. «Total» is their sum, for display only.
_Avoid_: rol (a role key is finer: Sun.BGV and Sat.BGV are both the BGV line)

**Sub-línea de presencia** (`P:<regla>`):
The line a presence rule opens for its members: at a weekend service the rule covers,
the one seat its members hold is shared among those of them who were eligible and
available, and folded into the BGV tab for display. A rule's key is a private
identifier — never printed outside a manager surface.
_Avoid_: presence line (in Spanish copy), regla de presencia (the rule, not its line)
````

- [ ] **Step 3: DATA_MODEL, API_REFERENCE, UTILITIES, SECRETS**

**Find** in `docs/DATA_MODEL.md`:

````markdown
---

## Registered document types (20)

`post`, `tag`, `author`, `featuredSongs`, `saturdarSongs`, `saturday_role`, `sunday_role`,
`teamMembers`, `special_role`, `loginEvent`, `setlistProposal`, the two Oasis Kids types
`kidsPair` and `kidsSchedule`, and seven **internal** types never authored by hand:
`roleTargetLock`, `roleCreationReceipt`, `notificationOutbox`, `specialIdentityCoordinator`,
`solverConfig`, `mcpOauthGrant`, `mcpOauthCodeRedemption`.

**Not registered** (present but intentionally unused — do not wire in):
````

**Replace with:**

````markdown
---

## Registered document types (21)

`post`, `tag`, `author`, `featuredSongs`, `saturdarSongs`, `saturday_role`, `sunday_role`,
`teamMembers`, `special_role`, `loginEvent`, `setlistProposal`, the two Oasis Kids types
`kidsPair` and `kidsSchedule`, and eight **internal** types never authored by hand:
`roleTargetLock`, `roleCreationReceipt`, `notificationOutbox`, `specialIdentityCoordinator`,
`solverConfig`, `fairnessMonth`, `mcpOauthGrant`, `mcpOauthCodeRedemption`.

**Not registered** (present but intentionally unused — do not wire in):
````

**Find** in `docs/DATA_MODEL.md`:

````markdown
---

## `tag`, `author` — Taxonomies

````

**Replace with:**

````markdown
---

## `fairnessMonth` — the monthly eligibility record (solver v3)

One document per calendar month at `_id: "fairnessMonth.YYYY-MM"`
([`fairnessMonth.ts`](../sanity/schemas/fairnessMonth.ts); spec
`docs/superpowers/specs/2026-10-05-solver-v3-c2-ledger-and-record-design.md`, REC-1 … REC-9;
[ADR-0050](adr/0050-the-fairness-balance-is-measured-against-recorded-eligibility.md)). The id is
**dotted on purpose**: Sanity never serves an id containing a dot to an unauthenticated read, and
the record holds members' unavailable dates. Every reader must therefore carry
`SANITY_API_READ_TOKEN` — without it a read answers «no record» with no error — and the ledger
reader and the write executor refuse to read without it.

| Field | Meaning |
|---|---|
| `schemaVersion` | `1` |
| `month` | `YYYY-MM`, equal to the id's month |
| `source` | `auto` (Auto's confirm, C6), `manual` («Registrar»), `reconstructed` (C4's script) |
| `engine`, `environment` | `v2`/`v3`; `production`/`preview`/`local` — server-stamped |
| `recordedAt`, `recordedBy` | the server clock; the session's effective member id, or the script's marker |
| `contentHash` | `sha256:` + hex over the canonical content (REC-6); a record is *intact* iff it recomputes |
| `people[]` | `fairnessPerson`: `member` (weak reference), `name` (display only), `roles` (`sunLead`, `satLead`, `sunBgv`, `satBgv`, `sunChoir`, `satChoir`: `in`/`out`/`exact`), `exactRules[]`, `sundayCadence?` (`"alternate"`), `exempt`, `blocks[]` |
| `presence[]` | `fairnessPresence`: `ruleKey`, `roles`, `members` (ids), `exclusive` |

It never stores seats, shares, balances, the cadence state, rule strings or names inside
`presence`; seats are read from the role documents. **Written only** by the write executor in
[`fairnessMonthWriteRequest.ts`](../app/utils/fairnessMonthWriteRequest.ts) — through
`PUT /api/admin/fairness/months` (engine v3 only) or C4's consented reconstruction script — which
mints every `_key`, the hash and the stamps; Studio governs it read-only like `solverConfig`.

---

## `tag`, `author` — Taxonomies

````

**Find** in `docs/DATA_MODEL.md`:

````markdown
| `solverConflict` | `{ id, personA, personB, pattern }` | `solverConfig.conflicts` |
| `solverPresence` | `{ id, persons[], pattern }` | `solverConfig.presence` |

**Every array-of-object write must include a unique `_key` per item and the correct `_type`.**
````

**Replace with:**

````markdown
| `solverConflict` | `{ id, personA, personB, pattern }` | `solverConfig.conflicts` |
| `solverPresence` | `{ id, persons[], pattern }` | `solverConfig.presence` |
| `fairnessPerson` | `{ member (weak ref), name, roles{six}, exactRules[], sundayCadence?, exempt, blocks[] }` — `_key` = `p` + 24 hex of SHA-256(member id) | `fairnessMonth.people` |
| `fairnessExactRule` | `{ roles[], count }` — `_key` = `x` + 24 hex of SHA-256(canonical role list) | `fairnessMonth.people[].exactRules` |
| `fairnessBlock` | `{ date, unavailable, excludedRoles[] }` — `_key` = `d` + YYYYMMDD | `fairnessMonth.people[].blocks` |
| `fairnessPresence` | `{ ruleKey, roles[], members[], exclusive }` — `_key` = `r` + 24 hex of SHA-256(ruleKey) | `fairnessMonth.presence` |

**Every array-of-object write must include a unique `_key` per item and the correct `_type`.**
````

**Find** in `docs/DATA_MODEL.md`:

````markdown
The Studio is a *second* writer into the same dataset, so it would otherwise bypass every guard in
[API_REFERENCE → the protected mutation contract](API_REFERENCE.md#the-protected-mutation-contract).
**Fifteen** types are closed to it — the six protected service types, the seven internal types
(`notificationOutbox` keeps `delete` alone, so an operator can prune a stray entry) **plus** the two
Oasis Kids types, whose writer is the app (`/api/kids/pairs`, `/api/kids/schedules`):
````

**Replace with:**

````markdown
The Studio is a *second* writer into the same dataset, so it would otherwise bypass every guard in
[API_REFERENCE → the protected mutation contract](API_REFERENCE.md#the-protected-mutation-contract).
**Sixteen** types are closed to it — the six protected service types, the eight internal types
(`notificationOutbox` keeps `delete` alone, so an operator can prune a stray entry) **plus** the two
Oasis Kids types, whose writer is the app (`/api/kids/pairs`, `/api/kids/schedules`):
````

**Find** in `docs/DATA_MODEL.md`:

````markdown
`sunday_role`, `saturday_role`, `special_role`, `featuredSongs`, `saturdarSongs`, `setlistProposal`,
`roleTargetLock`, `roleCreationReceipt`, `notificationOutbox`, `specialIdentityCoordinator`,
`solverConfig`, `kidsPair`, `kidsSchedule`, `mcpOauthGrant`, `mcpOauthCodeRedemption`.

The last two hold OAuth state for the MCP connector (P0 auth): `mcpOauthGrant` is one document per
````

**Replace with:**

````markdown
`sunday_role`, `saturday_role`, `special_role`, `featuredSongs`, `saturdarSongs`, `setlistProposal`,
`roleTargetLock`, `roleCreationReceipt`, `notificationOutbox`, `specialIdentityCoordinator`,
`solverConfig`, `fairnessMonth`, `kidsPair`, `kidsSchedule`, `mcpOauthGrant`, `mcpOauthCodeRedemption`.

The last two hold OAuth state for the MCP connector (P0 auth): `mcpOauthGrant` is one document per
````

**Find** in `docs/API_REFERENCE.md`:

````markdown
  [SOLVER_AND_INFRA.md](SOLVER_AND_INFRA.md).

---

````

**Replace with:**

````markdown
  [SOLVER_AND_INFRA.md](SOLVER_AND_INFRA.md).

- **`GET /api/admin/fairness?month=YYYY-MM[&horizon=1|2]`** — the solver v3 fairness ledger
  (C2 RD-1 … RD-5; [ADR-0050](adr/0050-the-fairness-balance-is-measured-against-recorded-eligibility.md)):
  for the 3 months before `month`, each person's per-line share, received seats and balance (all
  integer hundredths, positive = owed, `balance = share − received`, plus display `tenths` and the
  seat count), the cumulative balance since the earliest record, per-month notes and set-asides,
  `countedSundayLeads` and `firstRecordedIn`; the horizon month(s) with their full logical record
  (or `null`), freezing-service count and `recordBinds`; the effective `engine` and this
  deployment's `environment`. Gated **exactly like `solver-history`** (no session or a
  content-editor → `403`); a malformed `month` or a `horizon` other than `1`/`2` → `400
  { error: "invalid_request" }`; `200` carries `Cache-Control: no-store`. Any failure — no
  `SANITY_API_READ_TOKEN` (the records' dotted ids are private; checked before any read), a rejected
  read, a non-list answer, a stored record that fails the record-schema check — is `500
  { error: "fairness_unavailable", message: "No se pudo leer el saldo de equidad." }` with **no
  `people` key**. A month without a record is not a failure. Read by the planner's «Equidad · vista
  previa» panel, on first open only.

- **`PUT /api/admin/fairness/months`** — record 1–2 consecutive months of the eligibility record
  (`fairnessMonth`; C2 WR-1 … WR-17). **admin and super-admin only** (content-editor → `403
  forbidden`). Body `{ months: [{ month, source: "auto"|"manual", expectedRev, people, presence }] }`,
  strict: unknown fields, server stamps, `_key`, `name` and `contentHash` are refused (`400
  invalid_request`, `details.issues` naming each path by field and index only). Under engine v2 —
  every deployment until C7's flip, unless `OWT_SOLVER_ENGINE` is set on the `preview` branch or
  locally (docs/SECRETS.md) — `409 engine_not_v3` before anything is read. Per month: an identical
  intact record → `unchanged` (200, no transaction); a past month → `past_month`; no record and
  `expectedRev: null` → created; a record and a matching `expectedRev` and no freezing service →
  replaced (revision-asserted, whole); otherwise `record_exists` / `record_missing` /
  `stale_revision` (409 `stale_revision`) or `month_has_services`, and for a written month the live
  members must exist, be worship and fit the roles by current Tipo (`member_unknown` /
  `member_not_worship` / `tipo_mismatch`, 409 `integrity_conflict` with `details.memberIds`). All
  or nothing: one refused month writes nothing, `details.detail` is the earliest month's refusal and
  `details.months` every month's own verdict; a commit 409 is reported on every written month. `200`
  answers `{ months: [{ month, outcome, rev, contentHash, recordedAt }] }`. No notification, no
  revalidation, and never a delete.

---

````

**Find** in `docs/UTILITIES_AND_COMPONENTS.md`:

````markdown
  v2 sees: `sundayCadence` stripped and cadence-only restrictions removed; applied in
  `solverPools` and `isExcludedFromLead`. `cadenceV2Inert.test.ts` is the guard.

### Dates & schedule
````

**Replace with:**

````markdown
  v2 sees: `sundayCadence` stripped and cadence-only restrictions removed; applied in
  `solverPools` and `isExcludedFromLead`. `cadenceV2Inert.test.ts` is the guard.

### Fairness ledger and the eligibility record (solver v3 C2, ADR-0050)
- **`computeFairnessLedger`, `keepVoiceSeats`, `cadenceStates`** ([fairnessLedger.ts](../app/utils/fairnessLedger.ts), neutral) —
  the ONE TypeScript definition of F2–F7 and X1: the record-free seat step (duplicate weekend
  targets dropped, uncounted services out, one kept seat per person per service), populations,
  presence sub-lines, set-asides and the floor seat, in exact BigInt rationals rounded once.
  `fixtures/fairness/golden.json` is its contract with the v3 solver (C5): both suites assert it.
- **`formatFairnessTenths`, `saldoWords`** ([fairnessFormat.ts](../app/utils/fairnessFormat.ts)) — the ONLY
  fairness-figure formatter: one decimal from a tenths figure computed from the exact value, never
  from hundredths (a sweep refuses code that divides a figure by 10 or 100).
- **`resolveMonthEligibility`** ([fairnessEligibility.ts](../app/utils/fairnessEligibility.ts), neutral,
  client-callable) — the ONE v3 eligibility resolver: on-screen rules and members → one month's
  record body, or a named refusal; an `ok` body always passes the validator (RES-8).
- **`rolesOfPatternV3`** ([plannerModel.ts](../app/components/admin/plannerModel.ts)) and
  **`capValueForMonth`** ([serviceRuleContext.ts](../app/components/admin/serviceRuleContext.ts)) — the
  ONE v3 six-key pattern map (equal to `rolesOfPattern` on v2's five keys, plus `Sat.Choir`;
  `patternRolesV3Sync.test.ts`) and the ONE per-month count resolution over `resolvedCapValue`.
  `memberFitsRoleKey` (plannerModel) is the one Tipo-fits-role predicate.
- **`fairnessMonthWriteRequest.ts`** ([source](../app/utils/fairnessMonthWriteRequest.ts), neutral, never
  client-imported) — the record's id and keys, `validateFairnessMonthWrite`, `contentHashOfWrite` /
  `contentHashOfStored`, `parseStoredFairnessMonth` (the ONE record-schema check), `decideFairnessMonth`
  and `executeFairnessMonthWrites` — the ONLY mutation path of `fairnessMonth` (clients injected;
  callers pinned over `app/` and `scripts/`; a site of the audit's executor rule).
- **`resolveSolverEngine`, `fairnessRecordEnvironment`** ([solverDeployment.ts](../app/utils/solverDeployment.ts)) —
  the ONE reader of `OWT_SOLVER_ENGINE` and the record's `environment` stamp; never imported by a
  client module.
- **`FairnessPreviewPanel`** ([source](../app/components/admin/FairnessPreviewPanel.tsx)) with its
  view-model [fairnessPreviewModel.ts](../app/components/admin/fairnessPreviewModel.ts) — the read-only
  «Equidad · vista previa» beside «sin Lead en …», loading on first open, and «Registrar» (v3 only).

### Dates & schedule
````

**Find** in `docs/SECRETS.md`:

````markdown
- **Purpose:** authenticated reads that must bypass the CDN — NextAuth member
  lookups (`sanity/lib/serverClient.ts:10`), `operationalClient`, and the
  dry-run half of `scripts/` migrations.
- **Role needed:** Viewer.
- **Platforms:** same two Vercel scopes as above, plus local `.env.local`. **Not**
  in GitHub Actions.

### `SR_VERIFY_SANITY_TOKEN`
````

**Replace with:**

````markdown
- **Purpose:** authenticated reads that must bypass the CDN — NextAuth member
  lookups (`sanity/lib/serverClient.ts:10`), `operationalClient`, and the
  dry-run half of `scripts/` migrations. **Needed to read `fairnessMonth`** (solver v3
  C2): its ids are dotted, so private — without the token they are invisible, so the
  fairness ledger GET fails closed (`500 fairness_unavailable`) and, after C6, Auto refuses
  to solve; the record writer refuses to read without it too.
- **Role needed:** Viewer.
- **Platforms:** same two Vercel scopes as above, plus local `.env.local`. **Not**
  in GitHub Actions. The fairness ledger reads it on the `Preview, Production` pair and in
  `.env.local`.

### `SR_VERIFY_SANITY_TOKEN`
````

**Find** in `docs/SECRETS.md`:

````markdown
every authenticated read and every write fails — members cannot sign in
(NextAuth reads through `SANITY_API_READ_TOKEN`), proposals cannot be saved or
approved, and the outbox sweep cannot flush. Create-then-swap-then-revoke, in
that order, and the window is zero.

## `RESEND_API_KEY`
````

**Replace with:**

````markdown
every authenticated read and every write fails — members cannot sign in
(NextAuth reads through `SANITY_API_READ_TOKEN`), proposals cannot be saved or
approved, and the outbox sweep cannot flush. With `SANITY_API_READ_TOKEN` gone the
«Equidad» preview's ledger GET also fails closed (it can no longer see the private
`fairnessMonth` records) and, after C6, Auto refuses to solve. Create-then-swap-then-revoke,
in that order, and the window is zero.

## `RESEND_API_KEY`
````

- [ ] **Step 4: `CLAUDE.md` and `AGENTS.md`, the same edits in both**

**Find** in `CLAUDE.md`:

````markdown
  one `==` count per role key: refused at save by `exactCapOverlaps` (by `person` text) and at v3
  build by C2 (by member id). ADR-0049.
- **Cache:** admin/API routes that mutate content must call the matching
  `revalidate*` util in `app/utils/revalidate.ts` (or `revalidatePath`), or the
````

**Replace with:**

````markdown
  one `==` count per role key: refused at save by `exactCapOverlaps` (by `person` text) and at v3
  build by C2 (by member id). ADR-0049.
- **The fairness ledger has one definition, and its records one writer** (solver v3 C2,
  ADR-0050). `app/utils/fairnessLedger.ts` is the only TypeScript definition of F2–F7 and X1;
  `fixtures/fairness/golden.json` is asserted by both suites (vitest now, C5's Python later) and its
  expected values are hand-computed — never regenerated from either implementation's output.
  `fairnessMonth` records are written only through `fairnessMonthCommit` (the PUT, actor `route`)
  or the reconstruction actor (C4's consented script), both through `executeFairnessMonthWrites` —
  the ONLY mutation path of the type (`createOrReplace` never; the reconstruction actor's guarded
  delete the only delete). Every reader of `fairnessMonth` carries `SANITY_API_READ_TOKEN` or fails
  closed: the ids are dotted, so private, and an untokened read answers «no record» with no error.
- **Cache:** admin/API routes that mutate content must call the matching
  `revalidate*` util in `app/utils/revalidate.ts` (or `revalidatePath`), or the
````

**Find** in `CLAUDE.md`:

````markdown
(`app/components/admin/solverHistorySource.ts` — the deployment-wide switch, `"derived"`; `"local"`
is the rollback until D3), `SOLVER_SENDS_HISTORY` (same file — `false`: Auto sends `history: []`,
ADR-0046; `true` is the rollback), `countsForFairness`/`countsForFairnessDefault`/`COUNTS_FOR_FAIRNESS_GROQ` (`app/utils/countsForFairness.ts` — the ONE «Cuenta para equidad» read rule; neutral; nothing else spells the fragment or the default), `SOLVER_ENGINE` (`app/components/admin/solverEngine.ts` — the engine constant only, `"v2"`; the effective-engine resolver is C2's, parent A1), `FairnessSwitch`/`FairnessEngineNote` (`app/components/admin/FairnessSwitch.tsx` — the ONE «Cuenta para equidad» control and its v2 note on all four surfaces; the past-month rule and effective values live in `fairnessToggleModel.ts`), `trailingSaturday`/`rolesOfPattern` (`app/components/admin/plannerModel.ts` — the ONE definition of the Saturday after the last Sunday, solver week `weeks + 1`, ADR-0048; and the ONE pattern → solver-roles map, mirroring the solver's `expand_pattern`, guarded by `patternRolesSync.test.ts`).
Motion tokens are `--motion-*` /
`--ease-*`; `motion` is
````

**Replace with:**

````markdown
(`app/components/admin/solverHistorySource.ts` — the deployment-wide switch, `"derived"`; `"local"`
is the rollback until D3), `SOLVER_SENDS_HISTORY` (same file — `false`: Auto sends `history: []`,
ADR-0046; `true` is the rollback), `countsForFairness`/`countsForFairnessDefault`/`COUNTS_FOR_FAIRNESS_GROQ` (`app/utils/countsForFairness.ts` — the ONE «Cuenta para equidad» read rule; neutral; nothing else spells the fragment or the default), `SOLVER_ENGINE` (`app/components/admin/solverEngine.ts` — the engine constant only, `"v2"`; the effective-engine resolver is C2's, parent A1), `FairnessSwitch`/`FairnessEngineNote` (`app/components/admin/FairnessSwitch.tsx` — the ONE «Cuenta para equidad» control and its v2 note on all four surfaces; the past-month rule and effective values live in `fairnessToggleModel.ts`), `trailingSaturday`/`rolesOfPattern` (`app/components/admin/plannerModel.ts` — the ONE definition of the Saturday after the last Sunday, solver week `weeks + 1`, ADR-0048; and the ONE pattern → solver-roles map, mirroring the solver's `expand_pattern`, guarded by `patternRolesSync.test.ts`), `rolesOfPatternV3` (`plannerModel.ts` — the ONE v3 six-key pattern map; equals `rolesOfPattern` on the five v2 keys and adds `Sat.Choir`; synced by `patternRolesV3Sync.test.ts`), `capValueForMonth` (`app/components/admin/serviceRuleContext.ts` — the ONE per-month count resolution, over `resolvedCapValue`, a typed result never rounded or clamped), `memberFitsRoleKey` (`plannerModel.ts` — the ONE does-this-Tipo-fit-this-v3-role-key predicate, shared by the eligibility resolver and the record writer), `resolveMonthEligibility` (`app/utils/fairnessEligibility.ts` — the ONE v3 eligibility resolver; client-callable; an `ok` body always passes the record validator), `formatFairnessTenths`/`saldoWords` (`app/utils/fairnessFormat.ts` — the ONLY fairness-figure formatter: one decimal from a tenths figure computed from the exact value, never from hundredths), `resolveSolverEngine` (`app/utils/solverDeployment.ts` — the ONE reader of `OWT_SOLVER_ENGINE`; it overrides `SOLVER_ENGINE` (`app/components/admin/solverEngine.ts`, C1's constant) only on the `preview` branch deployment and locally; never imported by a client module), `parseStoredFairnessMonth` (`app/utils/fairnessMonthWriteRequest.ts` — the ONE record-schema check for `fairnessMonth`; the reader and C4's script both call it), `keepVoiceSeats` (`app/utils/fairnessLedger.ts` — the ONE seat rule: duplicate weekend targets dropped, uncounted services out, one kept seat per person per service), `executeFairnessMonthWrites` (`fairnessMonthWriteRequest.ts` — the only mutation path for `fairnessMonth`, clients injected; every reader of the type carries the read token or fails closed).
Motion tokens are `--motion-*` /
`--ease-*`; `motion` is
````

**Find** in `AGENTS.md`:

````markdown
  one `==` count per role key: refused at save by `exactCapOverlaps` (by `person` text) and at v3
  build by C2 (by member id). ADR-0049.
- **Cache:** admin/API routes that mutate content must call the matching
  `revalidate*` util in `app/utils/revalidate.ts` (or `revalidatePath`), or the
````

**Replace with:**

````markdown
  one `==` count per role key: refused at save by `exactCapOverlaps` (by `person` text) and at v3
  build by C2 (by member id). ADR-0049.
- **The fairness ledger has one definition, and its records one writer** (solver v3 C2,
  ADR-0050). `app/utils/fairnessLedger.ts` is the only TypeScript definition of F2–F7 and X1;
  `fixtures/fairness/golden.json` is asserted by both suites (vitest now, C5's Python later) and its
  expected values are hand-computed — never regenerated from either implementation's output.
  `fairnessMonth` records are written only through `fairnessMonthCommit` (the PUT, actor `route`)
  or the reconstruction actor (C4's consented script), both through `executeFairnessMonthWrites` —
  the ONLY mutation path of the type (`createOrReplace` never; the reconstruction actor's guarded
  delete the only delete). Every reader of `fairnessMonth` carries `SANITY_API_READ_TOKEN` or fails
  closed: the ids are dotted, so private, and an untokened read answers «no record» with no error.
- **Cache:** admin/API routes that mutate content must call the matching
  `revalidate*` util in `app/utils/revalidate.ts` (or `revalidatePath`), or the
````

**Find** in `AGENTS.md`:

````markdown
(`app/components/admin/solverHistorySource.ts` — the deployment-wide switch, `"derived"`; `"local"`
is the rollback until D3), `SOLVER_SENDS_HISTORY` (same file — `false`: Auto sends `history: []`,
ADR-0046; `true` is the rollback), `countsForFairness`/`countsForFairnessDefault`/`COUNTS_FOR_FAIRNESS_GROQ` (`app/utils/countsForFairness.ts` — the ONE «Cuenta para equidad» read rule; neutral; nothing else spells the fragment or the default), `SOLVER_ENGINE` (`app/components/admin/solverEngine.ts` — the engine constant only, `"v2"`; the effective-engine resolver is C2's, parent A1), `FairnessSwitch`/`FairnessEngineNote` (`app/components/admin/FairnessSwitch.tsx` — the ONE «Cuenta para equidad» control and its v2 note on all four surfaces; the past-month rule and effective values live in `fairnessToggleModel.ts`), `trailingSaturday`/`rolesOfPattern` (`app/components/admin/plannerModel.ts` — the ONE definition of the Saturday after the last Sunday, solver week `weeks + 1`, ADR-0048; and the ONE pattern → solver-roles map, mirroring the solver's `expand_pattern`, guarded by `patternRolesSync.test.ts`).
Motion tokens are `--motion-*` /
`--ease-*`; `motion` is
````

**Replace with:**

````markdown
(`app/components/admin/solverHistorySource.ts` — the deployment-wide switch, `"derived"`; `"local"`
is the rollback until D3), `SOLVER_SENDS_HISTORY` (same file — `false`: Auto sends `history: []`,
ADR-0046; `true` is the rollback), `countsForFairness`/`countsForFairnessDefault`/`COUNTS_FOR_FAIRNESS_GROQ` (`app/utils/countsForFairness.ts` — the ONE «Cuenta para equidad» read rule; neutral; nothing else spells the fragment or the default), `SOLVER_ENGINE` (`app/components/admin/solverEngine.ts` — the engine constant only, `"v2"`; the effective-engine resolver is C2's, parent A1), `FairnessSwitch`/`FairnessEngineNote` (`app/components/admin/FairnessSwitch.tsx` — the ONE «Cuenta para equidad» control and its v2 note on all four surfaces; the past-month rule and effective values live in `fairnessToggleModel.ts`), `trailingSaturday`/`rolesOfPattern` (`app/components/admin/plannerModel.ts` — the ONE definition of the Saturday after the last Sunday, solver week `weeks + 1`, ADR-0048; and the ONE pattern → solver-roles map, mirroring the solver's `expand_pattern`, guarded by `patternRolesSync.test.ts`), `rolesOfPatternV3` (`plannerModel.ts` — the ONE v3 six-key pattern map; equals `rolesOfPattern` on the five v2 keys and adds `Sat.Choir`; synced by `patternRolesV3Sync.test.ts`), `capValueForMonth` (`app/components/admin/serviceRuleContext.ts` — the ONE per-month count resolution, over `resolvedCapValue`, a typed result never rounded or clamped), `memberFitsRoleKey` (`plannerModel.ts` — the ONE does-this-Tipo-fit-this-v3-role-key predicate, shared by the eligibility resolver and the record writer), `resolveMonthEligibility` (`app/utils/fairnessEligibility.ts` — the ONE v3 eligibility resolver; client-callable; an `ok` body always passes the record validator), `formatFairnessTenths`/`saldoWords` (`app/utils/fairnessFormat.ts` — the ONLY fairness-figure formatter: one decimal from a tenths figure computed from the exact value, never from hundredths), `resolveSolverEngine` (`app/utils/solverDeployment.ts` — the ONE reader of `OWT_SOLVER_ENGINE`; it overrides `SOLVER_ENGINE` (`app/components/admin/solverEngine.ts`, C1's constant) only on the `preview` branch deployment and locally; never imported by a client module), `parseStoredFairnessMonth` (`app/utils/fairnessMonthWriteRequest.ts` — the ONE record-schema check for `fairnessMonth`; the reader and C4's script both call it), `keepVoiceSeats` (`app/utils/fairnessLedger.ts` — the ONE seat rule: duplicate weekend targets dropped, uncounted services out, one kept seat per person per service), `executeFairnessMonthWrites` (`fairnessMonthWriteRequest.ts` — the only mutation path for `fairnessMonth`, clients injected; every reader of the type carries the read token or fails closed).
Motion tokens are `--motion-*` /
`--ease-*`; `motion` is
````

- [ ] **Step 5: Gates and commit**

Run: `git add -A && npx vitest run app/utils/__tests__/adrIndex.test.ts app/utils/__tests__/agentDocsParity.test.ts && npx tsc --noEmit && npm test && npx eslint .`
Expected: `adrIndex` and `agentDocsParity` PASS; **468 files / 8636 tests**; 0 errors, 81 warnings.

```bash
git add -A
git commit -m "docs(fairness): ADR-0050, the record in DATA_MODEL and CONTEXT, the routes, and the read token's new duty" -m "Solver v3 C2 GU-3 and GU-4. ADR-0050 (El saldo de equidad se mide contra la elegibilidad registrada) records why eligibility is stored while seats stay derived, the dotted id and the token-or-fail-closed rule, the one executor and the audit's executor rule, freezing services and record binding with the residual race, the reconstruction actor's ownership of past months, exact arithmetic with one rounding each, and one seat per person per service; it amends no existing ADR (parent A31). DATA_MODEL gains the type (21 registered, 8 internal, 16 Studio-protected), CONTEXT.md the four domain terms, API_REFERENCE both routes, the utilities index the new section, SECRETS the read token's new duty and its rotation's blast radius, and CLAUDE.md/AGENTS.md the invariant and the reusable-utils entries."
```


---

## Task 17: Final verification (no commit) — coordinator

- [ ] **Step 1: The gates on the final tree**

Run: `npx tsc --noEmit && npm test && npx eslint .`
Expected: no `tsc` output; **468 files / 8636 tests** (or the Task 0 baseline + 20 files / + 506 tests); `✖ 81 problems (0 errors, 81 warnings)` — never more warnings than Task 0 recorded.

- [ ] **Step 2: Nothing C2 must not touch was touched**

Run: `git diff --name-only origin/main...HEAD -- gcf gcf_v3 app/mcp app/api/mcp app/api/admin/solve app/components/admin/solverEngine.ts app/utils/serviceReadModel.ts app/components/admin/LeadPoolHistoryPanel.tsx app/utils/solverHistory.ts app/utils/solverHistoryRead.ts`
Expected: no output.

- [ ] **Step 3: One reader of the variable, one mutation path, no client import of the writer**

Run: `npx vitest run app/utils/__tests__/solverDeployment.test.ts app/utils/__tests__/fairnessMonthExecutor.test.ts app/utils/__tests__/serviceCommitCallers.test.ts app/utils/__tests__/protectedReadAudit.test.ts`
Expected: PASS — one reader of `OWT_SOLVER_ENGINE` in code (comments stripped), no client module importing the resolvers, no `createOrReplace` in the writer, the write-request module imported only by `fairnessMonthCommit.ts` and `fairnessLedgerRead.ts`, and exactly two executor sites.

Run: `git grep -ln "fairnessMonthWriteRequest\|solverDeployment" -- 'app/**/*.tsx'`
Expected: no output — no `.tsx` file (every client component lives in one) imports the write-request module or the engine resolver.

- [ ] **Step 4: Attribution and key hygiene**

Run: `git log --format=%B origin/main..HEAD | grep -ci 'co-authored-by'`
Expected: `0`.

Run: `git grep -nE "console\.(log|error|warn)" -- app/utils/fairness*.ts app/api/admin/fairness`
Expected: only `fairnessLedgerRead.ts`'s four `console.error` lines (no read token, a failed read's class and status, a non-list answer, a refused record's index-based issues) and the GET route's one (an unexpected error's class and stack frames) — none interpolates a key, an id, a name or a payload.

- [ ] **Step 5: Report**

Record for the code review: `git log --oneline origin/main..HEAD` (16 commits, Tasks 1–16), the gate summary and Steps 2–4's outputs.

---
## Release

Branch `claude/solver-v3-c2-ledger-and-record` (Task 0). The order is `CLAUDE.md`'s and spec §14's, and is not shortened:

    implement (Tasks 1–16) → Task 17 → gates green → FRESH CODE REVIEW of origin/main...HEAD → fix
    → RE-VERIFY THE FIX (scoped review of the fix range + gates on the final tree)
    → read-only checks (step 4) → merge into preview, push preview → verify the dev alias
    → look on dev WITHOUT «Registrar» → PR to main → `gates` green → arm auto-merge on the verified commit
    → verify the production alias → release notes to Frank

**The safe end state** (spec §14): the type, writer, ledger, GET, fixture and preview are live; the effective engine is `v2` on every deployment (`SOLVER_ENGINE = "v2"`, `OWT_SOLVER_ENGINE` unset on Vercel), so the PUT answers `409 engine_not_v3` and «Registrar» is not rendered; records can exist only through C4's consented script — or a local server deliberately run with `OWT_SOLVER_ENGINE=v3` and `VERCEL_ENV` unset, which writes **production** records stamped `local` (EN-3). Auto, its request, v2 and every existing writer are unchanged. **Production writes by C2 itself: none.**

1. **Fresh code review** — run the `finish-cycle` skill. Its code-review dispatch reviews `origin/main...HEAD` against the spec at **critical** tier (Tasks 4–8 and 10 are the critical slices: the stored type and its governance, the validator/serializer/hash/parser, the decision table, the executor and the audit rule, the PUT, and the golden fixture), and carries the docs-audit (GU-3, GU-4, EN-3) and worklog-completeness checklists. Point the reviewer at «Plan decisions» and «Review-log open items» above. Every fix gets its own commit, then a scoped re-review of the fix range and the gates on the final tree; the last worklog entry before any merge is a verification, never a fix. A fix to a golden-fixture case is re-derived by hand and re-reviewed like code.
2. **Vercel safety** — before any Vercel command, verify `.vercel/project.json` names `owt-backstage` / `prj_elS88VGezKpy18wizFN1ffoy8cJ5`.
3. **No Sanity schema deploy is needed.** The type is hidden and the embedded Studio (`/studio`) ships it with the app; the Content Lake is schemaless and the app reads and writes regardless (`docs/DATA_MODEL.md` «Studio»). A hosted schema deploy stays optional — Frank's call, as for C1 and C3.
4. **Read-only checks against production, counts only** (from a checkout whose `.env.local` is the primary's; each prints numbers, never a name, an id or a key):
   - **The dotted-id premise** (review-log open item «most worth carrying»): dotted ids are private and are readable with the token under the `published` perspective.
     ```bash
     npx tsx --env-file=.env.local -e '
     const { createClient } = require("@sanity/client");
     (async () => {
       const base = {
         projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || "ebb8vcnk",
         dataset: process.env.NEXT_PUBLIC_SANITY_DATASET || "production",
         apiVersion: "2024-01-01", useCdn: false, perspective: "published",
       };
       const query = "count(*[_id in path(\"roleTarget.**\")])";
       const withToken = await createClient({ ...base, token: process.env.SANITY_API_READ_TOKEN }).fetch(query);
       const withoutToken = await createClient(base).fetch(query);
       console.log(`dotted roleTarget locks · with the read token: ${withToken} · without: ${withoutToken}`);
     })().catch((e) => { console.error(`read failed: ${e && e.name}${e && e.statusCode ? " " + e.statusCode : ""}`); process.exitCode = 1; });'
     ```
     Expected: `with the read token: N` with N > 0 and `without: 0`. If N is 0, stop and report: the premise ADR-0050 rests on is not demonstrated, and Frank decides before the merge.
   - **The new GROQ runs on the real Content Lake** (the `$months[]{… ^.from …}` projection was proven with groq-js only):
     ```bash
     npx tsx --env-file=.env.local -e '
     const { createClient } = require("@sanity/client");
     const q = require("./app/utils/serviceReadQueries");
     (async () => {
       const client = createClient({
         projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || "ebb8vcnk",
         dataset: process.env.NEXT_PUBLIC_SANITY_DATASET || "production",
         apiVersion: "2024-01-01", token: process.env.SANITY_API_READ_TOKEN, useCdn: false, perspective: "published",
       });
       const run = (b) => client.fetch(b.query, b.params);
       const month = new Date().toLocaleDateString("sv", { timeZone: "America/Mexico_City" }).slice(0, 7);
       const counts = await run(q.serviceCountsInMonths([month]));
       const records = await run(q.fairnessMonthsThroughQuery("9999-12"));
       const roster = await run(q.worshipRosterQuery());
       const config = await run(q.solverConfigQuery());
       console.log(`freezing counts ${JSON.stringify(counts)} · records ${records.length} · worship roster ${roster.length} · rule set ${config ? "present" : "absent"}`);
     })().catch((e) => { console.error(`read failed: ${e && e.name}${e && e.statusCode ? " " + e.statusCode : ""}`); process.exitCode = 1; });'
     ```
     Expected: one `{ month, weekend, countedSpecials, uncountedSpecials }` row for the current month whose numbers match the month on `/admin`; `records 0` (no record exists before C4's consented run or a v3 «Registrar»); a roster count and `rule set present`. (Both invocations — `--env-file` with `-e` and `require` through the `@/` alias of `serviceReadQueries.ts`'s imports — were exercised against a stub env file while this plan was written; only the network reads were not.)
5. **`preview` first.**
   ```bash
   git switch preview && git pull --ff-only origin preview
   git merge --no-ff claude/solver-v3-c2-ledger-and-record
   git push origin preview
   ```
   Verify with one authoritative `get_deployment("dev-owt-backstage.vercel.app")` (Vercel MCP, team `frank-rochas-projects`) or the `deploy-verifier` agent, retried ≥30 s apart: `dev-owt-backstage.vercel.app` is in `alias` and `meta.githubCommitSha` equals the pushed `preview` commit. Never a hand-rolled watcher; never `--wait` on the alias.
6. **Look on dev, read-only.** Confirm first that `OWT_SOLVER_ENGINE` is NOT set on Preview (`npx vercel env ls preview` lists no such variable): then the GET answers `engine: "v2"`, «Registrar» does not render and the PUT refuses. In `/admin` → «Servicios» → «📅 Generar mes» (config step) and in a month's stored editor: the «Equidad · vista previa» disclosure sits beside «sin Lead en …», closed; opening it shows the banner, three chips reading «sin registro, no cuenta», «Todavía no hay meses registrados…», five tabs, and no table rows. Agents may observe with `scripts/dev-verify.ts` once `docs/DEV_VERIFY.md`'s «Verified runs» are recorded (it never writes); it does not replace Frank's look. **No «Registrar» on dev** — even if someone sets the override: `preview` writes the production dataset and a record stamped `preview` cannot be removed from the app.
7. **PR to `main`** from `claude/solver-v3-c2-ledger-and-record` (body: spec link and digest, «Plan decisions», the review-log dispositions, the coverage table below, gate results, review outcome, step 4's readings; no AI attribution). Wait for `gates`. Arm auto-merge **last**, on the exact commit that was reviewed, re-verified and seen on dev: `gh pr merge <n> --auto --merge`. Before pushing anything else to the branch (a review fix, a catch-up merge of `main` — e.g. to renumber the ADR), `gh pr merge <n> --disable-auto` first, and re-arm only once that commit is re-verified and seen on dev too.
8. **After the merge** — verify the production alias the same way (`owt-backstage.vercel.app` in `alias`, `meta.githubCommitSha` = the merge commit) on the next turn; nothing wakes the coordinator on merge. Then record the release (merge SHA, date) in the worklog and the solver v3 program notes, remove the worktree if one was used (`git worktree remove`; `git worktree prune` at the next cycle open), append every dispatch's `WORKLOG:` line to `.agents/log/worklog.jsonl`, and append the «Review-log open items» dispositions to the spec's review log as post-approval dispositions (the coordinator's edit, not an implementer's).
9. **Release notes to Frank:**
   a. Nothing changes for the team: the preview is read-only and «Registrar» appears only under engine v3, which no deployment runs.
   b. **`OWT_SOLVER_ENGINE` stays unset on Vercel** until you decide a Preview rehearsal. Setting it to `v3` on Preview makes «Registrar» appear on dev and write **production** records stamped `preview`; a local server with it and `VERCEL_ENV` unset writes production records stamped `local`. Neither can be deleted from the app (docs/SECRETS.md).
   c. `SANITY_API_READ_TOKEN` now also guards the fairness ledger: rotating it without updating every platform makes the preview fail closed (and, after C6, Auto refuse).
   d. The panel's copy (§8) is yours to reword at C7's look.
10. **Rollback** (spec §14): revert the PR. Nothing reads records except the panel and the GET, so any record becomes inert data. Removing a reconstructed record is C4's consented script through the reconstruction actor's guarded delete — the only deletion path; a record written by the route is never deleted by any code path, and after a revert the executor is gone, so any deletion then is a separate consented script reviewed on its own.

---
## Coverage — spec row → task

| Spec row | Where it is implemented and proven |
|---|---|
| **REC-1** identity, dotted id, built only by the module | Task 4 (schema, `month` field); Task 5 (`fairnessMonthId`, used by the executor only) |
| **REC-2** server stamps; `source` from the body (route) or the executor (reconstruction); `environment` outside the module; `recordedBy` = effective id | Task 2 (`fairnessRecordEnvironment`); Task 5 (validator refuses every stamp, `reconstructed`); Task 7 (executor stamps); Task 8 (route stamps; «stamping recordedBy with the session's effective id») |
| **REC-3** people items, keys from SHA-256, weak ref, `name` from the executor's read, six role fields, exact-rule consistency, A11, blocks | Task 4 (fields); Task 5 (keys, validator, `buildFairnessMonthDocument`); Task 7 (names from the member read; nameless → `member_unknown`) |
| **REC-4** presence snapshot, key grammar, `exclusive` | Task 5 (validator, keys); Task 12 (exclusivity from conflicts) |
| **REC-5** what is never stored | Task 4 (`fairnessMonthSchema.test.ts`: every field governed, no figure, no names in presence) |
| **REC-6** content hash, two entry points, intactness | Task 5 (pinned text and digest, order independence, body = written document, edited/junk not intact, names/keys/stamps ignored) |
| **REC-7** absent means out; a listed item missing a role field fails | Task 5 (parser refuses); Task 9 (`status` defaults to `out`); Task 11 (GET 500 on a missing `sunBgv`) |
| **REC-8** Studio governance | Task 4 (`studioProtection.test.ts` pins; `fairnessMonthSchema.test.ts` capabilities) |
| **REC-9** audit: `PROTECTED_TYPES`, executor rule, both registry entries, the stated residual | Task 4 (type); Task 7 (rule, module entry, fixtures (a)–(e)); Task 8 (commit entry; two executor sites) |
| **WR-1** ADR-0043 shape; commit module delegates; pin row | Task 8 |
| **WR-2** auth: admin/super-admin; content-editor 403 | Task 8 (route tests for no session, content-editor, admin, super-admin) |
| **WR-3** strict body; 1–2 consecutive ascending; stamps/`_key`/`name`/`contentHash` refused | Task 5 (validator); Task 8 (route 400s with index paths) |
| **WR-4** limits | Task 5 (every limit); Task 12 (limits shared with the resolver) |
| **WR-5** live members after the decision, on written months only | Task 7 (each refusal; unchanged month with a deleted member answers unchanged); Task 8 (route `tipo_mismatch`, `integrity_conflict`, `memberIds`) |
| **WR-6** engine gate before any read | Task 8 («refuses engine_not_v3 … reading and writing nothing»; production ignores the override) |
| **WR-7** fresh state inside the commit; counted vs uncounted specials | Task 3 (`serviceCountsInMonths`); Task 7 (re-reads; uncounted special replaces, counted refuses); Task 8 (A27 create with services; A5) |
| **WR-8** decision rows 1–8 | Task 6 (table) |
| **WR-9** all or nothing; earliest detail; commit 409 on every written month | Task 7; Task 8 («writes nothing when the months' verdicts differ…», «reports a transaction's 409…») |
| **WR-10** plain create; `already_exists` → `record_exists` | Tasks 7, 8 (injected 409 and a real concurrent create) |
| **WR-11** whole revision-asserted replace; field survival; `conflict` → `stale_revision` + `commit_conflict`; unknown errors thrown; no `createOrReplace` | Task 7 (unset of a stale field, `_createdAt` survives, grep test); Task 8 |
| **WR-12** responses | Task 8 |
| **WR-13** no side effects; the route offers no delete | Task 7 (imports pinned, no `after`/`revalidate`); Task 8 (no reconstruction actor or DELETE in the route/commit) |
| **WR-14** reconstruction rows 1–9 and D1–D4 | Task 6 (table); Task 7 (execution, guarded delete transaction, rollback on a moved revision, `member_unknown`) |
| **WR-15** assert the revision read; re-read on 409 | Task 15 |
| **WR-16** one executor, injected clients, read-client contract, names for both actors, pin over `app/` and `scripts/` | Task 5 (pin), Task 7 (executor tests), Tasks 8 and 11 (importer list) |
| **WR-17** validator exported, re-run by the executor on write entries only | Task 5; Task 7 (invalid body per actor; delete entries checked by month pattern) |
| **LG-1 … LG-17** | Task 9 (implementation and unit tests: seat step, weekday, tenths from exact, invalid time, `countedSundayLeads`, names, cumulative, order independence, exact sums); Task 10 (every FX-4 case, by `covers` tag) |
| **CAD-1 … CAD-3** | Task 9 (`cadenceStates`); Task 10 (7 cadence cases); Task 13 (X1 inputs for the panel, record-bound vs resolver) |
| **RD-1** reader, builders, members referenced | Tasks 3, 11 |
| **RD-2** fail closed; one record-schema check; logs without content | Task 5 (parser); Task 11 (token, rejected read, malformed record, schemaVersion; log assertions) |
| **RD-3** payload incl. `environment`, `recordBinds`, `countedSundayLeads`, `firstRecordedIn` | Task 9 (`countedSundayLeads` repeats a date); Task 11 (payload, horizon, `recordBinds`, held/sang/firstRecordedIn) |
| **RD-4** route, gate, 400, no-store, dynamic, opaque 500 | Task 11 |
| **RD-5** scope | Task 9 (people = listed or seated); Task 11 |
| **RD-6** roster and rule-set builders | Task 3 (groq-js: absent/empty/worship in, kids/drafts out, six fields; `null` when absent) |
| **RES-1 … RES-8** | Task 1 (IF2-16, IF2-17 with sync and range tests); Task 7 (`memberFitsRoleKey`); Task 12 (examples per rule, refusal and issue; viewer independence; 1500 generated inputs) |
| **FX-1 … FX-5** | Task 10 |
| **UI-1** mount beside both | Task 14 (`MonthGenerator.fairnessPreview.test.tsx`) |
| **UI-2** inert; read on open only | Task 14 (no fetch until open; existing suites' counts unchanged) |
| **UI-3** disclosure, skeleton, error + retry, banner, chips, tabs, table/cards, out group, own scroller | Tasks 13, 14 |
| **UI-4** columns, one decimal through the formatter, words, sort, sweep | Tasks 9 (sweep), 13 (rows), 14 (rendered) |
| **UI-5** «Motivo» and the X1 line | Tasks 13, 14 |
| **UI-6** «Registrar» | Tasks 13 (copy), 15 |
| **UI-7** house rules | Tasks 14, 15 (`cueDialogMount`, `inputFontSize`, `clientBoundary`, `colourInventory`, lint) |
| **EN-1** C1's constant consumed unchanged | Task 2 (`solverEngine.test.ts` untouched and green) |
| **EN-2** the resolver's table; one reader; no client import | Task 2 |
| **EN-3** SECRETS entry | Task 2 |
| **GU-1** registrations; wrapped PUT; pin with exact importers over `app/` + `scripts/` | Tasks 5, 7, 8, 11 |
| **GU-2** audit and Studio pins; serviceReadModel untouched; draft gating and client boundary green | Task 4; every task's gates |
| **GU-3** ADR | Task 16 |
| **GU-4** DATA_MODEL, CONTEXT, SECRETS (read token), CLAUDE.md lines | Task 16 (SECRETS' `OWT_SOLVER_ENGINE` in Task 2) |
| **GU-5** the executor rule and its fixtures | Task 7 |
| **IF2-1 … IF2-29** | IF2-1/3–9: Task 1 (types), 8, 11 · IF2-2: Tasks 4, 5 · IF2-10–13: Task 9 · IF2-14: Task 2 · IF2-15: Task 12 · IF2-16/17: Task 1 · IF2-18–20: Task 5 · IF2-21: Task 6 · IF2-22: Task 7 · IF2-23: Tasks 5, 7, 8, 11 · IF2-24–28: Task 3 · IF2-29: Task 10 |
| **§13** acceptance rows | As the rows above; «All: gates» — every task's last step and Task 17 |
| **§14** safe end state, release, rollback | Release |

**Coverage gaps:** none against the spec. Deliberately left to their owners: Python's half of the golden fixture (C5), the reconstruction script and its `OPERATOR_TOOLING_ALLOWLIST` entry and importer-pin rows (C4, IF2-23), Auto's confirm and the solve route's engine check (C6), the flip and every amendment of an existing ADR (C7, parent A31), and running the resolver on the real config and roster (C7's rehearsal, spec §10).

## Self-review (writing-plans checklist)

- **Spec coverage:** every REC, WR, LG, CAD, RD, RES, FX, UI, EN and GU row, every IF2 item and the §13 table map to a task above; the review log's open items each have a disposition («Review-log open items»).
- **Placeholders:** none. Every code step carries the exact code (new files in full, every edit as an exact `Find`/`Replace with` pair or an `Append`), every run step its command and expected result, and the release's production checks are spelled-out read-only commands that print counts only.
- **Type consistency:** the names in each task's **Interfaces → Produces** are the names later tasks consume — `RoleKey`, `LogicalRecord`, `FairnessMonthWrite`, `FairnessMonthBody`, `FairnessLedgerResponse`, `FairnessPerson`, `Figures`, `Note`, `RECORD_LIMITS`, `PRESENCE_RULE_KEY_RE`, `validateFairnessMonthWrite`, `contentHashOfWrite`, `contentHashOfStored`, `isIntact`, `buildFairnessMonthDocument`, `parseStoredFairnessMonth`, `decideFairnessMonth`, `StoredRecordFacts`, `executeFairnessMonthWrites`, `FairnessExecution`, `FairnessStamps`, `RECONSTRUCTION_RECORDED_BY`, `memberFitsRoleKey`, `rolesOfPatternV3`, `capValueForMonth`, `serviceCountsInMonths`, `fairnessMonthsThroughQuery`, `fairnessMonthsByIdsQuery`, `voiceRolesInRangeQuery`, `fairnessMembersByIdsQuery`, `worshipRosterQuery`, `solverConfigQuery`, `keepVoiceSeats`, `cadenceStates`, `computeFairnessLedger`, `fairnessLedgerExactSums`, `formatFairnessTenths`, `saldoWords`, `loadFairnessLedger`, `FairnessLedgerUnavailableError`, `resolveSolverEngine`, `fairnessRecordEnvironment`, `resolveMonthEligibility`, `EligibilityResult`, `tabRows`, `cadenceLine`, `REGISTRAR`, `refusalMessage`, `resolverLines`, `FairnessPreviewPanel` — one spelling and one signature each; the IF2 working names are the spec's.
- **Executed:** see «How this plan was verified» at the top.

## Execution handoff

Execute with **superpowers:subagent-driven-development**: a fresh implementer per task, each task's review before the next, the coordinator integrating and running Task 0, Task 17 and the Release. Route by risk: Tasks 4–8 and 10 are the critical slices (the stored type and its governance; the validator, serializer, hash and parser; the decision table; the executor and the audit rule; the production PUT; the cross-language fixture) — give them the strongest configuration and a careful review, and for Task 10 have the reviewer re-derive at least the floor, presence and exact-half cases by hand from their descriptions. Tasks 9, 11, 12 and 15 are consequential standard work (the ledger, the fail-closed reader, the resolver that builds the writer's bodies, the write UI) — strong configuration, standard review. Tasks 1–3, 13, 14 and 16 are bounded and fully specified — a faster configuration is fine. Task 0 and the Release stay with the coordinator (they touch shared branches and production aliases). Every dispatch reports a `WORKLOG:` trailer; the coordinator appends them (batched at cycle close is fine).
