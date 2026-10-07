# Solver v3 · C4 — reconstructing the fairness records of past months Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dry-run-by-default operator CLI, `scripts/reconstruct-fairness-months.mjs`, plus its pure `scripts/lib` core, that infers one `fairnessMonth` record per requested past month from stored services, today's roster and today's rules (Tipo as hypothetical pool ticks, join bounds per line, the cadence setting, Frank's corrections file), shows Frank a private per-person table with anomalies and a balance preview, and — only on `--apply` against the exact plan whose fingerprint Frank consented to — writes those records through C2's one write executor, month by month; with a matching guarded rollback.

**Architecture:** Ten focused modules under `scripts/lib/reconstruct*.ts`: arguments and private paths; the corrections file; ONE gateway to C2's write-request module (validator, hash, parser, decision); the plan file (canonical JSON, input digests, fingerprint); inference (R4 pools, R5 join months over C2's record-free seat step, R6–R8 transforms); anomalies; the ledger runs and preview over C2's ledger; the Spanish reports; and the runner (reads through C2's builders on an injected client, dry run, apply, rollback). The CLI file is thin: it builds the two Sanity clients after the core's token check and is the only file that calls `executeFairnessMonthWrites`, so the protected-read audit registers exactly one new `protected-write` site (C2 IF2-23, GU-5).

**Tech Stack:** TypeScript under `tsx` (D1), `@sanity/client` (two injected clients), C2's neutral modules (`fairnessVocabulary`, `fairnessEligibility`, `fairnessLedger`, `fairnessFormat`, `fairnessMonthWriteRequest`, `serviceReadQueries` builders, `solverDeployment`), C1's `countsForFairness`, C3's `sundayCadence`; vitest with C2's in-memory Content Lake (`fakeFairnessSanity.ts`, real GROQ through groq-js).

**Spec:** `docs/superpowers/specs/2026-10-05-solver-v3-c4-record-reconstruction-design.md` — CRITICAL tier, APPROVED by two sequential fresh reviewers on SHA-256 `954869fe589ecccfe4f70a673792500ddd2b371791e6cd9d14882c1a165fb21a` (re-hashed 2026-10-06: unchanged; committed as `cc05dff0`). It cites every C2 interface by `IF2-` ID; the single source of those is C2's spec §7 (`docs/superpowers/specs/2026-10-05-solver-v3-c2-ledger-and-record-design.md`, SHA-256 `dbf2c404…`). Parent: `docs/superpowers/specs/2026-10-05-solver-v3-fairness-design.md` (A1–A41; A41 = key hygiene). Review log: `docs/superpowers/specs/2026-10-05-solver-v3-c4-record-reconstruction-design-review-log.md` — every item it leaves «open for the implementation plan» has a row in «Plan decisions» below. This plan never edits the spec.

**Base and grounding.** C4's prerequisites are C1, C3 and C2 (spec A1, «Review handoff»); none is on `main` as this plan is written.
- The plan was written against the C1+C3 integration (`e358781dbe4bb2b36d6af11f4e43e8707edb3086`) and C2 Tasks 1–10 on local branch `c2-t10` (`1c500c7e6ef26bbbbc132949d46ada917b76bb0c`); anchors marked **[verified c2-t10]** were read there.
- It was then **replayed on C2's final tip, `a35f812e02b4749ccbccc9a97d405c5d6c0f69bf`** (C1 + C3 + all 17 C2 tasks + C2's final-review fixes): every anchor this plan had taken from C2's plan, marked **[verified a35f812e]** below, matched there as written. The full list is in «Anchor provenance».
- **Task 0 bases the C4 branch on `origin/main` AFTER C1, C3 and C2 have all merged** — never on the integration, never on `c2-t10`, never on C2's branch, never on `a35f812e`. The replay base only proves the plan applies; `main` may have moved since, so Task 0 Step 4 re-checks the anchors there.

**How this plan was verified.** Replayed on 2026-10-06: the whole plan was executed task by task in a throwaway clone of `a35f812e` under `/private/tmp/claude-501/c4-replay/` (outside every checkout, no `.env.local`, `node_modules` cloned with `cp -Rc` from a lockfile-identical checkout), each task's «see it fail» checked for its stated reason, its three gates green and a commit. Where a step did not apply or did not go green, the PLAN TEXT was corrected and the task re-run from the previous task's commit (the list is in «Replay record»). The golden table's bytes, written by the first green run and then checked by hand against R4–R13 and the world, are now a **Create** block in Task 7 Step 1. Finally the corrected plan's Create/Find/Append blocks were re-applied mechanically to a **second** fresh clone of `a35f812e` under `CI=true`: every `Find` matched exactly once at its point, every «see it fail» failed, every gate went green with the counts written in each task's gate step, and each task's tree came out byte-identical to the executed one. Gate counts: baseline **468 files / 8643 tests**, final **478 files / 8817 tests**, `tsc` silent, ESLint **0 errors / 81 warnings** throughout.

**How to read an edit step.** A **Create** step writes the whole file. A **Find** … **Replace with** pair replaces text that occurs exactly once in that file at that point of the plan. An **Append** step adds the block at the end of the file after one blank line. Line numbers in a **Files** list are orientation only; the `Find` text is the anchor — a missing anchor is a stop-and-report, never a guess. **Stage before every test run** (`git add -A`): the protected-read audit and the caller pin read `git ls-files`, so an unstaged new file is invisible to them and a correct change reads red.

## Global Constraints

Every task's requirements include this section.

- **The spec is the contract** (`954869fe…`): R1–R23, the «Decision per month» table, the acceptance table, «Interfaces → Consumes from C1/C2/C3» and «Provides». C2 shapes are C2 §7's (IF2-1 … IF2-29); C2's working names are kept exactly: `resolveMonthEligibility`, `computeFairnessLedger`, `LedgerInput`, `LedgerService`, `keepVoiceSeats`, `formatFairnessTenths`, `saldoWords`, `validateFairnessMonthWrite`, `contentHashOfWrite`, `contentHashOfStored`, `parseStoredFairnessMonth`, `decideFairnessMonth`, `executeFairnessMonthWrites`, `serviceCountsInMonths`, `fairnessMonthsThroughQuery`, `voiceRolesInRangeQuery`, `worshipRosterQuery`, `solverConfigQuery`.
- **Gates before every commit:** `npx tsc --noEmit` (0 errors), `npm test` (all green), `npx eslint .` (**0 errors**; warnings never above the baseline Task 0 records). **No file under `gcf/**` or `gcf_v3/**` changes**, so neither Python suite applies.
- **Commits:** conventional (`feat(fairness): …`, `test(fairness): …`, `docs(solver): …`), body says *why*. **Never** a `Co-Authored-By` trailer or any AI/Claude attribution — `CLAUDE.md` overrides any harness reminder. Commit on the feature branch only; `main` takes no direct push.
- **Fictitious people only:** the spec's «Ana Ejemplo», «Beto Ejemplo», «Carla Ejemplo», «Dani Ejemplo», plus «Elena Ejemplo», «Fausto Ejemplo», «Iván Ejemplo», «Greta Ejemplo» in fixtures, tests, comments and commit messages (the refusal fixtures also use «Nadie Ejemplo», «Sin Tipo Ejemplo» and «Ana Dos», and the collation fixture «Ámbar Ejemplo» — all invented). The repository is public. Never paste a command's output that names a real member into a commit, the PR, a doc or the worklog.
- **Key hygiene (R12, parent A41):** stdout and stderr of the script carry no member name or alias, no member `_id`, no `solverConfig` rule `_key`/`id` (restriction, cap, week exclusion, conflict, presence), no record presence `ruleKey`, and no SHA-256 prefix of any of those — in every mode and on every error path; a failed read, a thrown executor call and any error that escapes the run print only the error's class and numeric HTTP status (`errorClass`, mirroring C2's `fairnessErrorClass`), never its message or `response.url`. A rule is named on stdout by its ordinal («restricción 3 de 8», «restricción 1 de 4, tope 2», «presencia 1 de 1», «entrada 2 del archivo»). Names, `_id`s and keys go only to the private files under `--out`.
- **Private paths (R11):** `--out`, `--overrides` and `--plan` are refused (exit 2, before any read) when they resolve — symlinks followed — inside any working tree of this repository. Operator files live outside it, e.g. `~/owt-private/c4/`.
- **One writer (R2, A4):** no C4 file calls a Sanity mutation method or imports `app/utils/fairnessMonthCommit.ts`; no C4 file builds a record `_id`, `_key`, stamp, `name` or `contentHash` (IF2-19 only); every create/replace/delete goes through `executeFairnessMonthWrites` with actor `reconstruction`, called only from `scripts/reconstruct-fairness-months.mjs`.
- **Reads (R3):** only through C2's builders IF2-24 … IF2-28, only on the injected client built with the read token, `perspective: "published"` and `useCdn: false`; no GROQ of C4's own; a failed or malformed read writes no file (exit 1).
- **Timezone (`CLAUDE.md`):** "today" is `new Date().toLocaleDateString("sv",{timeZone:"America/Mexico_City"})`; a service's month is its stored `YYYY-MM-DD` string's first seven characters — never a `Date`.
- **No production Sanity read or write by any agent during implementation or verification.** The production dry run and the `--apply` are operations after release, each behind Frank's explicit consent (see «Release»).
- **No new secret or environment variable** (R19, R21): `SANITY_API_READ_TOKEN` and `SANITY_WRITE_TOKEN` already cover the two halves (`docs/SECRETS.md`, «SANITY_API_READ_TOKEN» / «SANITY_WRITE_TOKEN»); `docs/SECRETS.md` is not edited by C4.
- **Scope fences:** no file under `app/` is created (so no `colour-inventory.json` regeneration); `CLAUDE.md`/`AGENTS.md` are not edited (their parity test); role type names in `scripts/lib` are plain quoted strings, never template literals; the CLI's header comment holds no retirement write marker (`createClient(`, `fetch(`, `.commit(`, `.patch(`, `.delete(`, `.create(`, `.transaction(`, `.createIfNotExists(`, `api.sanity.io`) so C7 can put the retirement gate after the imports (R22).

---
## File Structure

**Created — production**

| File | Responsibility | Spec |
|---|---|---|
| `scripts/reconstruct-fairness-months.mjs` | Thin CLI: builds the two clients through the core's factory hook, is the ONE caller of `executeFairnessMonthWrites`, sets `process.exitCode` | Provides, R2, R19, R20 a, R22 |
| `scripts/lib/reconstructTypes.ts` | Shared types, the line ↔ role table, anomaly codes, refusal shape, `ReadFailure` | — |
| `scripts/lib/reconstructArgs.ts` | Argument parsing, month scope (R1), private-path refusal (R11) | Provides, R1, R11, R18, R19 |
| `scripts/lib/reconstructOverrides.ts` | The corrections file: schema v1, full validation, out-of-run entries | R8 |
| `scripts/lib/reconstructDecide.ts` | The ONE `scripts/lib` importer of C2's write-request module: IF2-18, IF2-19, IF2-20, IF2-21 for actor `reconstruction`, the `recordedBy` marker | R2, R14, R18, R20 b |
| `scripts/lib/reconstructPlanFile.ts` | Canonical JSON, service- and member-input digests, fingerprint, plan file, backups, plan diff | R15, R17, R18 |
| `scripts/lib/reconstructInference.ts` | R4 config, IF2-26 row mapping, R5 join months over IF2-11, counted service days, R5–R8 transform with cell reasons, resolver/validator refusal mapping | R4–R9, R13 |
| `scripts/lib/reconstructAnomalies.ts` | Every R13 anomaly except the two the transform emits | R7, R13 |
| `scripts/lib/reconstructPreview.ts` | Ledger members, in-memory planned records, per-month and preview ledger runs | R11, R13 |
| `scripts/lib/reconstructReport.ts` | Spanish table, refusal report, apply/rollback reports, name-free stdout lines | R11, R12, R13 |
| `scripts/lib/reconstructRun.ts` | The runner: token check before any client, reads, derive, dry run, apply, rollback, exit codes | R1, R3, R10, R11, R14–R19 |

**Created — tests and test fixtures** (`scripts/__tests__/`): `reconstructArgs.test.ts`, `reconstructOverrides.test.ts`, `reconstructPlanFile.test.ts`, `reconstructInference.test.ts`, `reconstructAnomalies.test.ts`, `reconstructReport.test.ts`, `reconstructDryRun.test.ts`, `reconstructApply.test.ts`, `reconstructRollback.test.ts`, `reconstructGuards.test.ts`; `__fixtures__/reconstructWorld.ts` (the R23 world), `__fixtures__/reconstructHarness.ts`, `__fixtures__/reconstruct-golden-table.md` (the vitest file snapshot; its bytes are a **Create** block in Task 7 Step 1).

**Modified**

| File | Change | Task |
|---|---|---|
| `scripts/lib/solverHistoryDiffRun.ts` | `realLocation` exported (one word), reused by R11's refusal — not copied | 1 |
| `app/utils/__tests__/serviceCommitCallers.test.ts` | the write-request module's importer row gains `scripts/lib/reconstructDecide.ts` (Task 3) and the CLI file (Task 10) | 3, 10 |
| `app/utils/protectedReadAudit.ts` | `OPERATOR_TOOLING_ALLOWLIST` gains the CLI file's exact entry; the list's header comment is refreshed (comment-only) | 10 |
| `app/utils/__tests__/protectedReadAudit.test.ts` | the operator-tooling pin and the executor-sites pin gain `scripts/reconstruct-fairness-months.mjs#module` | 10 |
| `docs/SOLVER_AND_INFRA.md` | the runbook (R21) and the `scripts/lib/` list | 11 |
| `docs/adr/0050-the-fairness-balance-is-measured-against-recorded-eligibility.md` | the reconstruction section (R21; C2 is the ADR's author, A31) | 11 |
| `docs/adr/README.md` | ADR-0050's index row mentions the reconstruction section | 11 |

**Deliberately untouched:** every file under `app/` except the two guard tests and the audit registry above; `docs/SECRETS.md` (no new secret); `CLAUDE.md`/`AGENTS.md`; `gcf/**`, `gcf_v3/**`; `scripts/lib/sr-retired-writer.mjs` and its test (retirement is C7 Step 12's, R22).

## Plan decisions (the spec leaves them to the plan)

| Decision | Choice | Why |
|---|---|---|
| **The `config` handed to IF2-15** (review log: «must be resolved») | `hypotheticalConfig(parsed, roster)` = today's parsed `solverConfig` with `sundayLeads`/`saturdayLeads`/`support` replaced by every IF2-27 member whose current Tipo fits that pool (`memberFitsPool`), and `restrictions`, `conflicts`, `presence` passed by reference, unaltered. C2 §7.4's «as `config`» describes the rule set; C4 R4 governs the pools, as C4's own obligations live in C4's text | R4, D11; a test asserts the three rule arrays are the same objects |
| Today's ACTUAL pools | Read only for R13's two pool anomalies, through a SECOND IF2-15 call per month over the unaltered parsed config; its body is never planned, hashed or written. «Not ticked today» = a line in/exact under R4's call and all-out under this one; «ticked today, never seated» = a line in/exact under this one, no seat-derived and no corrected join month, and not a cadence member's DL | No copy of RES-1's pool → role map under `scripts/` (review log, set 3) |
| Body before IF2-18 | `{ ...transformedBody, expectedRev }` with `expectedRev` = the stored `_rev` read, or `null` | IF2-18 requires `expectedRev` for actor `reconstruction` too (`RECONSTRUCTION_FIELDS`, verified c2-t10) |
| Apply command line (review log, sets 2–3) | `--apply --plan <file> --fingerprint <64 hex> --out <dir> [--overrides <same file>]`; months and preview run come from the plan; `--months`/`--preview-run`, if also given, must equal the plan's or the run refuses | One source of truth for what was reviewed |
| **`--fingerprint` (beyond the spec's flag list)** | Required on `--apply` and `--rollback --apply`; the run refuses (exit 2, before any read) unless it equals the plan file's fingerprint, and the plan file is refused if its own content no longer hashes to it | Makes R19's consent mechanical (review log, set 3). It only adds a refusal; C7's W7/Step 10 command lines gain the flag when C7 replays |
| Exit codes after the gate opens (review log, set 3) | `2` = refused before anything is handed to the executor (arguments, paths, tokens, months, plan binding, backups, resolver, validator, corrections file); `1` = an executor refusal or a thrown error during the writes (R16), or a failed read | R16 governs the write phase; «Provides»'s `2` is «before any write» |
| Rule ordinals | 1-based positions in `solverConfigFromDocument`'s output arrays — the order the rules panel lists them; a stored item the parser drops has no ordinal (and reaches no resolver either) | Review log, set 3: «the rule ordinal defined over the parsed config» |
| Ordinals for IF2-15 person-refusals | IF2-15's refusals carry only a `person`; the run lists the ordinals of every rule whose own text is that string, filtered by reason (cap ordinals for `exact_count_range`/`overlapping_exact`; the cadence restriction and its `Sun.Lead` caps for `cadence_and_exact`; restrictions, conflicts and presence for name refusals) | Satisfies R12's acceptance («a refusal over the `d-ana` restriction prints that restriction's ordinal»); the text and keys stay in the report |
| Cell reason codes (R11; review log) | C4's closed set: `tipo` (Tipo fits, no rule moved it), `sin_tipo` (current Tipo does not fit the role), `regla` (Tipo fits, today's rules made it `out`), `fija` (today's exact rule), `linea` (R5 join bound), `partida` (R5 cut an exact rule), `correccion` (R8) | The resolver returns no reasons; these are derivable from IF2-15's output, `memberFitsRoleKey` and C4's own transform |
| «corregido» marks | A `corrections` list beside each body in the plan and the table; never inside the body (IF2-18 is strict) | Review log, set 3 |
| Member-input digest (beyond R15's list) | The plan also binds each worship member's `_id`, names, Tipo, ministries and stored `unavailableDates` inside the requested and preview months | R15's acceptance names an `unavailableDates` change in a preview month, which may move no figure (review log, sets 2–3) |
| Serialized plan contents | Canonical JSON (object keys in codepoint order), every list sorted by the code that builds it (codepoint); `es` collation only for the table's rows (R11) | R17; review log |
| Output layout and overwrite | Each run writes into a new `--out/<ISO-time>-<mode>[-n]/` folder (`plan.json`, `tabla.md`, `backup-YYYY-MM.json`, `rechazo.md`, `aplicado.md`); files are opened `wx` (never overwritten); apply reads backups beside the plan file | Plan bytes exclude the time (R17); nothing reviewed is ever overwritten (review log) |
| Apply checks the backup file (review log) | Before any write, every planned replace's backup must exist beside the plan and hash to the recorded value; otherwise exit 2 `backup_missing` | R18: «no replace overwrites a production record without a copy» |
| Environment stamp (review log) | `fairnessRecordEnvironment(process.env)` from `app/utils/solverDeployment.ts` (REC-2's function, beside IF2-14) — never a hard-coded `"local"` | R10 |
| Preview placeholders (review log) | In-memory `LogicalRecord` for a planned body: `rev: "planned"`, `recordedAt: "planned"`, `contentHash` = IF2-19 of the body, `source: "reconstructed"`, `engine: "v2"`, `environment` = the run's stamp, each person's `name` = roster display name | R2 (never stored-shaped, never written) |
| Per-month ledger runs | R7's «tuvo», R11's per-line seat counts and R13's `member_gone` / `presence_outside` come from `computeFairnessLedger({ target: month + 1, records: [after-apply record], services: that month's })` — IF2-8 `held` covers only the window before the target | Review log, set 2 |
| The record anomalies read per month | The after-apply record (R11's preview rule): the planned body for «crear»/«reemplazar»/«sin cambios», the stored record for the two «no se toca» rows | One rule for the preview and the anomalies |
| «Presence rule with no presence seat» | Per counted weekend service where the rule applies: no kept seat (IF2-11) whose role is in the rule's roles for that day class, whose holder is a rule member and which is not a fixed seat (holder `exact` for that key, or `Sun.Lead` with the cadence setting) — LG-7's candidate definition; the `outside_population` half reads the ledger's notes | R13 |
| Override file schema | v1, keyed by member `_id`; `"*"` (every month of the run) or named months per entry, never both; member-level `exempt`, `sundayCadence`, `joinMonths`, `blockedDates`, `note` | R8 |
| Week-exclusion blocks | No correction removes one (R8 lists additions only); the table header states it with the presence limitation | Review log, set 3 (state the limitation) |
| Blocked-date merge | A corrected date merges into an existing block of that date: `unavailable` ORed, `excludedRoles` unioned in canonical order | Review log, set 2 |
| Comparing a re-create after rollback with its backup; per-month presence overrides | Declined | A re-create is a fresh dry run Frank reviews; presence overrides were declined in the spec's set-1 fix |
| Golden table | Asserted structurally in code (statuses, anomalies, preview words) AND by a vitest file snapshot whose bytes are the **Create** block in Task 7 Step 1 — written by the replay's first green run on `a35f812e`, then checked by hand against R4–R13 and the world (Task 7 Step 4) | Hand-writing a byte-exact Markdown table without running the ledger is not credible; under `CI=true` vitest fails on a missing or different snapshot instead of writing one |
| A replace's per-person diff (spec «Decision per month»: «the table shows the per-person diff»; R21) | `replaceChanges` (Task 6) compares the stored record (IF2-20) with the planned body: people added or removed, each role's status word, exact-rule grouping, «Exenta», «Mes por medio», blocked dates, then presence rules; the table shows it as «Cambios frente al registro guardado» under a «reemplazar» month only | Added at replay: the plan as written had no diff, which the spec requires for every replace (and R21's re-run instruction relies on it) |
| Error output (R12; C2's final-review carry-over) | Every executor call, every read and the CLI's last-resort handler print an error through `errorClass` — its class and numeric HTTP status, mirroring C2's `fairnessErrorClass`, which sits in a `server-only` module the script cannot import; never the message, never `response.url` | C2's executor rethrows every non-409 client error raw, and a `@sanity/client` error carries member ids in its message and URL; Task 8 tests both an executor commit and an executor read failing that way, and the apply's own re-read |

## Review-log open items → disposition

| Item (review log) | Disposition |
|---|---|
| C2 §7.4 «as `config`» vs C4 R4/D11 | «Plan decisions», first row |
| Apply-mode command line | «Plan decisions» |
| R15's `unavailableDates` wording for preview-only months | Member-input digest |
| Environment-stamp function | `fairnessRecordEnvironment` |
| Codepoint order for serialized plan contents | Canonical JSON |
| Refusing to overwrite backups and the reviewed plan | Per-run folder, `wx` |
| Comparing a re-create after rollback against the backup | Declined |
| Merging an override's blocked date with an existing block | Merge rule |
| Per-month ledger calls; preview placeholders | «Plan decisions» |
| R8's validation order | Schema and roster checks before any resolver call; the replacement rule during the transform; IF2-18 last — all before any table or plan |
| R11's reason-code source | Cell reason codes |
| R6(a)'s wording | Tests assert the resolver's `cadence_and_exact` and that a «normal» correction does not clear it |
| Required `--fingerprint` | Adopted, marked beyond the spec |
| Exit codes on a first-month executor refusal | `1` (R16) |
| Apply checking the backup's hash | Adopted |
| Week-exclusion blocks no override can remove | Stated limitation |
| R13 «ticked today» from a second IF2-15 call | Adopted |
| Rule ordinal over the parsed config | Adopted |
| An error-path test whose fake throws messages carrying fixture names | Tasks 7, 8 and 10 (Task 8's error is shaped as `@sanity/client` throws it, ids in its message and `response.url`) |
| Recording the run's own inputs in the plan | `inputs: { months, previewRun, overridesHash }` |
| `record_missing` absent from the decision matrix | A write-time refusal like `member_unknown`; tested in Task 8 |
| «corregido» outside the strict body | `corrections` beside the body |
| Evidence row on the earlier reconstruction attempt (`:87`) | Not cited by this plan; no code depends on its counts |

---
## Task 0: Branch, entry gate and baseline

**Files:** none.

- [ ] **Step 1: Confirm C1, C3 and C2 are on `main`** (spec A1: C4 cannot be built without them; it never re-implements them)

```bash
git fetch origin
git ls-tree --name-only origin/main \
  app/utils/countsForFairness.ts app/utils/sundayCadence.ts \
  app/utils/fairnessVocabulary.ts app/utils/fairnessLedger.ts app/utils/fairnessFormat.ts \
  app/utils/fairnessEligibility.ts app/utils/fairnessMonthWriteRequest.ts app/utils/solverDeployment.ts \
  app/utils/fairnessLedgerRead.ts app/api/admin/fairness/route.ts
for name in executeFairnessMonthWrites decideFairnessMonth parseStoredFairnessMonth validateFairnessMonthWrite contentHashOfWrite contentHashOfStored RECONSTRUCTION_RECORDED_BY; do
  git show origin/main:app/utils/fairnessMonthWriteRequest.ts | grep -c "export .*$name" ; done
git show origin/main:app/utils/fairnessEligibility.ts | grep -n "export function resolveMonthEligibility\|export type EligibilityMember\|export type EligibilityResult"
git show origin/main:app/utils/serviceReadQueries.ts | grep -n "export function \(serviceCountsInMonths\|fairnessMonthsThroughQuery\|voiceRolesInRangeQuery\|worshipRosterQuery\|solverConfigQuery\)"
git ls-tree --name-only origin/main docs/adr/ | grep "the-fairness-balance-is-measured-against-recorded-eligibility"
```

Expected: all ten paths listed; every count ≥ 1; the three eligibility exports and the five builders found; one ADR file (its number may differ from `0050` if another ADR reached `main` first — use the number found everywhere this plan says `0050`). If anything is missing, **stop**: C4 is not implementable yet.

- [ ] **Step 2: Branch from the current `main`**

```bash
git switch -c claude/solver-v3-c4-record-reconstruction origin/main
git log -1 --oneline
```

If the coordinator runs this in a worktree (`CLAUDE.md`: only when two things must be in flight at once), use `EnterWorktree`, populate `node_modules` with `cp -Rc` from a checkout whose `package-lock.json` matches (never a fresh install), and symlink `.env.local` to the primary checkout's copy (`ln -s ../../../.env.local .env.local`) — never write one inside a worktree. `git worktree prune` at cycle open.

- [ ] **Step 3: Record the baseline**

Run: `npx tsc --noEmit && npm test 2>&1 | tail -4 && npx eslint . 2>&1 | tail -1`
Expected: no `tsc` output; all tests green (record the file and test counts — on the replay base `a35f812e` (C2's final tip) they were **468 files / 8643 tests** with 81 warnings; `main` may differ, and every later count in this plan is the replay base's); `✖ N problems (0 errors, N warnings)` — record `N`: it is the warning ceiling for the whole delivery.

- [ ] **Step 4: Re-check the anchors that came from C2's plan** (all matched as written on the replay base `a35f812e`; `main` may have moved since)

```bash
grep -n 'fairnessMonthWriteRequest: \[' app/utils/__tests__/serviceCommitCallers.test.ts
grep -n "export type EligibilityMember" -A 8 app/utils/fairnessEligibility.ts
grep -n "export function resolveMonthEligibility" -A 4 app/utils/fairnessEligibility.ts
tail -3 docs/adr/0050-the-fairness-balance-is-measured-against-recorded-eligibility.md
grep -n "ADR-0050" docs/adr/README.md
grep -n "^### Accounts / auth\|^### \`scripts/lib/\` (unit-tested shared modules)" docs/SOLVER_AND_INFRA.md
grep -n "Guarded OPERATOR TOOLING" -A 7 app/utils/protectedReadAudit.ts
grep -n "finds exactly the registered fairness executor sites" -A 3 app/utils/__tests__/protectedReadAudit.test.ts
```

Expected: the caller-pin row reads `fairnessMonthWriteRequest: ["app/utils/fairnessLedgerRead.ts", "app/utils/fairnessMonthCommit.ts"],` (C2 Task 11); `EligibilityMember` has `_id`, `member_name`, `alias?`, `memberType?`, `ministries?`, `unavailableDates?` and `resolveMonthEligibility(input: { month; config; members })` (C2 Task 12); the ADR ends with C2's «Consequences» bullets (C2 Task 16); the two `SOLVER_AND_INFRA.md` headings exist; the audit header and the executor-sites pin read as quoted in Task 10's `Find` blocks. (Every one of these read exactly so on `a35f812e`.) Any difference: adapt the matching `Find` block in Tasks 3, 4, 10 or 11 to the text on `main` (keeping the change's meaning) and note it in the PR.

---
## Task 1: Arguments, month scope and private paths — **[CRITICAL slice: the apply gate's front door — flag combinations, R1's refusal before any read, R11's path refusal]**

Spec «Provides → To C7», R1, R11, R18 (rollback refuses `--overrides`/`--preview-run`), R19 (`--apply` needs a plan). `parseReconstructArgs` never echoes an argument value (R12). The path refusal reuses `solverHistoryDiffRun.ts`'s exported repository discovery — the one change there is exporting `realLocation`.

**Files:**
- Create: `scripts/lib/reconstructArgs.ts`
- Modify: `scripts/lib/solverHistoryDiffRun.ts` (`function realLocation`, ~line 125) **[verified c2-t10; unchanged by C2]**
- Test: `scripts/__tests__/reconstructArgs.test.ts`

**Interfaces:**
- Consumes: `isMonthString`, `monthIndex`, `shiftMonth` (`app/utils/fairnessVocabulary.ts`, C2 IF2-1 module); `repositoryRoots`, `isInsideRoot`, `nodeGitFs`, `realLocation`, `type GitFs` (`scripts/lib/solverHistoryDiffRun.ts`).
- Produces: `type RunMode = "dry-run" | "apply" | "rollback" | "rollback-apply"`; `interface ReconstructArgs { mode; months: string[] | null; out: string; overrides: string | null; previewRun: string | null; plan: string | null; fingerprint: string | null }`; `USAGE`; `parseReconstructArgs(argv: readonly string[]): ReconstructArgs | { error: string }`; `notPastMonths(months: readonly string[], currentMonth: string): string[]`; `defaultPreviewRun(months: readonly string[]): string`; `privatePathRefusals(entries: ReadonlyArray<{ flag: string; file: string }>, repoRoot: string, platform: string, fs?: GitFs): { problem: string | null; refusals: string[] }`.

- [ ] **Step 1: Write the failing test**

**Create** `scripts/__tests__/reconstructArgs.test.ts`:

````ts
// Solver v3 C4 — the reconstruction CLI's arguments («Provides»), its month scope (R1)
// and its private-path refusal (R11). No argument value is ever echoed back (R12).
// Every name is fictitious.
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defaultPreviewRun, notPastMonths, parseReconstructArgs, privatePathRefusals } from "../lib/reconstructArgs";
import type { GitFs } from "../lib/solverHistoryDiffRun";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const FP = "a".repeat(64);
let work: string;

beforeEach(() => {
  work = mkdtempSync(path.join(tmpdir(), "owt-reconstruct-args-"));
});
afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

describe("arguments («Provides», R18, R19)", () => {
  it("parses a dry run with the months oldest first", () => {
    expect(parseReconstructArgs(["--months", "2026-09,2026-08", "--out", "/x"])).toEqual({
      mode: "dry-run",
      months: ["2026-08", "2026-09"],
      out: "/x",
      overrides: null,
      previewRun: null,
      plan: null,
      fingerprint: null,
    });
  });

  it("lets an apply take its months from the plan, and tells the four modes apart", () => {
    expect(parseReconstructArgs(["--apply", "--plan", "/p.json", "--fingerprint", FP, "--out", "/x"])).toMatchObject({
      mode: "apply",
      months: null,
      plan: "/p.json",
      fingerprint: FP,
    });
    expect(parseReconstructArgs(["--rollback", "--months", "2026-08", "--out", "/x"])).toMatchObject({ mode: "rollback" });
    expect(
      parseReconstructArgs(["--rollback", "--apply", "--plan", "/p.json", "--fingerprint", FP, "--out", "/x"]),
    ).toMatchObject({ mode: "rollback-apply" });
  });

  it.each<[string[], RegExp]>([
    [["--out", "/x"], /--months es obligatorio/],
    [["--months", "2026-08"], /--out <carpeta> es obligatorio/],
    [["--months", "2026-8", "--out", "/x"], /YYYY-MM/],
    [["--months", "2026-08,2026-08", "--out", "/x"], /repite un mes/],
    [["--months", "2026-08", "--out", "/x", "--preview-run", "2026-13"], /--preview-run debe ser YYYY-MM/],
    [["--months", "2026-08", "--out", "/x", "--rollback", "--overrides", "/o.json"], /--rollback no acepta --overrides/],
    [["--months", "2026-08", "--out", "/x", "--rollback", "--preview-run", "2026-09"], /--rollback no acepta --preview-run/],
    [["--months", "2026-08", "--out", "/x", "--apply"], /--apply necesita --plan/],
    [["--out", "/x", "--apply", "--plan", "/p.json"], /--fingerprint/],
    [["--out", "/x", "--apply", "--plan", "/p.json", "--fingerprint", "ABC"], /--fingerprint/],
    [["--months", "2026-08", "--out", "/x", "--plan", "/p.json"], /--plan solo va con --apply/],
    [["--months", "2026-08", "--out", "/x", "--fingerprint", FP], /--fingerprint solo va con --apply/],
    [["--months", "2026-08", "--out", "/x", "--out", "/y"], /--out se dio dos veces/],
    [["--months", "2026-08", "--out"], /--out necesita un valor/],
  ])("refuses %j", (argv, message) => {
    const parsed = parseReconstructArgs(argv);
    expect("error" in parsed ? parsed.error : "").toMatch(message);
  });

  it("refuses an unexpected argument by position, without echoing it (R12)", () => {
    const parsed = parseReconstructArgs(["--months", "2026-08", "--out", "/x", "Ana Ejemplo"]);
    expect(parsed).toEqual({ error: "argumento inesperado en la posición 5" });
  });
});

describe("months (R1, A21)", () => {
  it("lets through only months strictly before the current CDMX month", () => {
    expect(notPastMonths(["2026-08", "2026-09", "2026-10"], "2026-10")).toEqual(["2026-10"]);
    expect(notPastMonths(["2026-10"], "2026-11")).toEqual([]);
    expect(notPastMonths(["2026-11"], "2026-10")).toEqual(["2026-11"]);
  });

  it("defaults the preview run to the month after the last requested month", () => {
    expect(defaultPreviewRun(["2026-08", "2026-09"])).toBe("2026-10");
    expect(defaultPreviewRun(["2026-12"])).toBe("2027-01");
  });
});

describe("private paths (R11)", () => {
  const refusalsFor = (file: string) => privatePathRefusals([{ flag: "--out", file }], REPO_ROOT, process.platform).refusals;

  it("accepts a folder outside the repository", () => {
    expect(refusalsFor(path.join(work, "out"))).toEqual([]);
  });

  it("refuses a folder inside the repository, naming the flag and not the path", () => {
    const refusals = refusalsFor(path.join(REPO_ROOT, "tmp-reconstruct-out"));
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatch(/^--out está dentro del repositorio/);
    expect(refusals[0]).not.toContain("tmp-reconstruct-out");
  });

  it("refuses a symlink that lands inside the repository", () => {
    const link = path.join(work, "link");
    symlinkSync(REPO_ROOT, link);
    expect(refusalsFor(path.join(link, "out"))).toHaveLength(1);
  });

  it("refuses a sibling working tree of the same repository (`--plan` too)", () => {
    const tree: Record<string, string | string[]> = {
      "/r/wt1/.git": "gitdir: /r/main/.git/worktrees/wt1\n",
      "/r/main/.git/worktrees/wt1": ["gitdir", "commondir"],
      "/r/main/.git/worktrees/wt1/commondir": "../..\n",
      "/r/main/.git/worktrees/wt1/gitdir": "/r/wt1/.git\n",
      "/r/main/.git/worktrees": ["wt1", "wt2"],
      "/r/main/.git/worktrees/wt2/gitdir": "/r/wt2/.git\n",
    };
    const fs: GitFs = {
      readFile: (p) => (typeof tree[p] === "string" ? (tree[p] as string) : null),
      readDir: (p) => (Array.isArray(tree[p]) ? (tree[p] as string[]) : null),
    };
    const result = privatePathRefusals([{ flag: "--plan", file: "/r/wt2/plan.json" }], "/r/wt1", "linux", fs);
    expect(result.problem).toBeNull();
    expect(result.refusals).toHaveLength(1);
    expect(result.refusals[0]).toMatch(/^--plan está dentro del repositorio/);
  });

  it("reports a repository it cannot locate as a problem, so the caller refuses", () => {
    const fs: GitFs = { readFile: (p) => (p === "/r/bad/.git" ? "not a gitdir line\n" : null), readDir: () => null };
    expect(privatePathRefusals([{ flag: "--out", file: "/elsewhere" }], "/r/bad", "linux", fs).problem).toMatch(/cannot locate the repository/);
  });
});
````

- [ ] **Step 2: Run it to see it fail**

Run: `git add -A && npx vitest run scripts/__tests__/reconstructArgs.test.ts`
Expected: FAIL — `../lib/reconstructArgs` does not resolve.

- [ ] **Step 3: Implement**

**Find** in `scripts/lib/solverHistoryDiffRun.ts`:

````ts
function realLocation(p: string): string {
````

**Replace with:**

````ts
export function realLocation(p: string): string {
````

**Create** `scripts/lib/reconstructArgs.ts`:

````ts
// scripts/lib/reconstructArgs.ts
//
// The reconstruction CLI's arguments (solver v3 C4, spec «Provides → To C7»), its
// month scope (R1) and its private-path refusal (R11). Pure except the path refusal,
// which follows symlinks and reads the repository's `.git` layout through
// `solverHistoryDiffRun.ts`'s exported helpers — the same refusal, not a copy: every
// working tree of the repository counts as «inside».
//
// Nothing here echoes an argument value: an operator who typed a name where a flag
// belongs must not see it repeated on a terminal or in a transcript (R12).

import path from "node:path";

import { isMonthString, monthIndex, shiftMonth } from "../../app/utils/fairnessVocabulary";
import { isInsideRoot, nodeGitFs, realLocation, repositoryRoots, type GitFs } from "./solverHistoryDiffRun";

export type RunMode = "dry-run" | "apply" | "rollback" | "rollback-apply";

export interface ReconstructArgs {
  mode: RunMode;
  /** Oldest first; null only for an apply, which takes them from its plan. */
  months: string[] | null;
  out: string;
  overrides: string | null;
  /** null = the default: the month after the last requested month (R11). */
  previewRun: string | null;
  plan: string | null;
  fingerprint: string | null;
}

export const USAGE =
  "uso: npx tsx --env-file=.env.local scripts/reconstruct-fairness-months.mjs --months YYYY-MM[,YYYY-MM…] --out <carpeta> " +
  "[--overrides <archivo>] [--preview-run YYYY-MM] [--rollback] [--apply --plan <archivo> --fingerprint <64 hex>]";

const VALUE_FLAGS = new Set(["--months", "--out", "--overrides", "--preview-run", "--plan", "--fingerprint"]);
const BOOLEAN_FLAGS = new Set(["--apply", "--rollback"]);

export function parseReconstructArgs(argv: readonly string[]): ReconstructArgs | { error: string } {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (BOOLEAN_FLAGS.has(flag)) {
      if (flags.has(flag)) return { error: `${flag} se dio dos veces` };
      flags.add(flag);
      continue;
    }
    if (!VALUE_FLAGS.has(flag)) return { error: `argumento inesperado en la posición ${i + 1}` };
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) return { error: `${flag} necesita un valor` };
    if (values.has(flag)) return { error: `${flag} se dio dos veces` };
    values.set(flag, value);
    i += 1;
  }
  const apply = flags.has("--apply");
  const rollback = flags.has("--rollback");
  const mode: RunMode = rollback ? (apply ? "rollback-apply" : "rollback") : apply ? "apply" : "dry-run";

  const out = values.get("--out");
  if (!out) return { error: "--out <carpeta> es obligatorio: una carpeta privada fuera del repositorio" };

  let months: string[] | null = null;
  const monthsText = values.get("--months");
  if (monthsText !== undefined) {
    const list = monthsText.split(",").map((m) => m.trim());
    if (!list.every((m) => isMonthString(m))) return { error: "--months debe ser YYYY-MM[,YYYY-MM…]" };
    if (new Set(list).size !== list.length) return { error: "--months repite un mes" };
    months = [...list].sort((a, b) => monthIndex(a) - monthIndex(b));
  } else if (!apply) {
    return { error: "--months es obligatorio (no tiene valor por defecto)" };
  }

  const previewRun = values.get("--preview-run") ?? null;
  if (previewRun !== null && !isMonthString(previewRun)) return { error: "--preview-run debe ser YYYY-MM" };
  const overrides = values.get("--overrides") ?? null;
  const plan = values.get("--plan") ?? null;
  const fingerprint = values.get("--fingerprint") ?? null;

  if (rollback && overrides !== null) return { error: "--rollback no acepta --overrides: un borrado no infiere nada (R18)" };
  if (rollback && previewRun !== null) return { error: "--rollback no acepta --preview-run (R18)" };
  if (apply) {
    if (plan === null) return { error: "--apply necesita --plan <archivo>: el plan que se revisó" };
    if (fingerprint === null || !/^[0-9a-f]{64}$/.test(fingerprint)) {
      return { error: "--apply necesita --fingerprint con la huella de 64 hex a la que Frank dio su consentimiento" };
    }
  } else {
    if (plan !== null) return { error: "--plan solo va con --apply" };
    if (fingerprint !== null) return { error: "--fingerprint solo va con --apply" };
  }
  return { mode, months, out, overrides, previewRun, plan, fingerprint };
}

/** R1: the months that are NOT strictly before the current CDMX month (empty = the run may go on). */
export function notPastMonths(months: readonly string[], currentMonth: string): string[] {
  return months.filter((m) => monthIndex(m) >= monthIndex(currentMonth));
}

/** R11's default preview run: the month after the last requested month. */
export function defaultPreviewRun(months: readonly string[]): string {
  return shiftMonth(months[months.length - 1], 1);
}

/**
 * R11: `--out`, `--overrides` and `--plan` hold member names, so each must resolve —
 * symlinks followed — outside every working tree of the repository. Checked before
 * any read. A `.git` file that cannot be followed is a `problem`: the caller refuses
 * rather than guard only part of the repository.
 */
export function privatePathRefusals(
  entries: ReadonlyArray<{ flag: string; file: string }>,
  repoRoot: string,
  platform: string,
  fs: GitFs = nodeGitFs,
): { problem: string | null; refusals: string[] } {
  const { roots, problem } = repositoryRoots(repoRoot, fs);
  if (problem) return { problem, refusals: [] };
  const caseInsensitive = platform === "darwin" || platform === "win32";
  const resolvedRoots = roots.flatMap((r) => [path.resolve(r), realLocation(r)]);
  const refusals: string[] = [];
  for (const { flag, file } of entries) {
    const candidates = [path.resolve(file), realLocation(file)];
    if (resolvedRoots.some((root) => candidates.some((c) => isInsideRoot(c, root, caseInsensitive)))) {
      refusals.push(
        `${flag} está dentro del repositorio o de uno de sus árboles de trabajo: los archivos de la reconstrucción ` +
          "llevan nombres de miembros y el repositorio es público. Usa una carpeta privada fuera de él (p. ej. ~/owt-private/c4/).",
      );
    }
  }
  return { problem: null, refusals };
}
````

- [ ] **Step 4: Run it to see it pass**

Run: `git add -A && npx vitest run scripts/__tests__/reconstructArgs.test.ts scripts/__tests__/solverHistoryDiffCli.test.ts`
Expected: PASS — and the diff tool's own suite is unchanged by the export.

- [ ] **Step 5: Gates and commit**

Run: `git add -A && npx tsc --noEmit && npm test && npx eslint .`
Expected: all green (on the replay base `a35f812e`: **469 files / 8667 tests**, 81 warnings); 0 errors; warnings at the Task 0 baseline.

```bash
git add -A
git commit -m "feat(fairness): the reconstruction CLI's arguments, month scope and private paths" -m "Solver v3 C4 R1, R11, R18, R19. The CLI refuses a month that is not strictly before the current CDMX month, a rollback with corrections or a preview run, an apply without the reviewed plan and the fingerprint it was approved under, and any --out, --overrides or --plan path inside a working tree of this public repository. The path check reuses the diff tool's repository discovery (realLocation is now exported) instead of copying it, and no argument value is ever echoed back."
```

---
## Task 2: The corrections file — **[CRITICAL slice: Frank's overrides change what a record says]**

Spec R8 (schema, full validation before any record is built, «no aplica a esta corrida»), D8 (identity = member `_id`), R12 (entries named by position on stdout). Also creates the shared types module the later tasks import.

**Files:**
- Create: `scripts/lib/reconstructTypes.ts`, `scripts/lib/reconstructOverrides.ts`
- Test: `scripts/__tests__/reconstructOverrides.test.ts`

**Interfaces:**
- Consumes: `canonicalRoles`, `isMonthString`, `isRoleKey`, `type RoleKey`, `type FairnessMonthBody` (C2 IF2-1 module); `isValidServiceDate` (`app/utils/serviceReadModel.ts`); `type EligibilityMember` (`app/utils/fairnessEligibility.ts` **[verified a35f812e]**).
- Produces (types module): `type Line`, `LINES`, `LINE_ROLES`, `type RosterRow = EligibilityMember`, `type ReconstructionBody = FairnessMonthBody & { expectedRev: string | null }`, `type CellReason`, `interface CellInfo`, `type PersonCells`, `interface Correction`, `type MonthAction`, `type RollbackAction`, `ANOMALY_CODES`, `type AnomalyCode`, `interface Anomaly`, `type RefusalKind`, `interface RunRefusal`, `class ReadFailure`.
- Produces (overrides): `OVERRIDES_SCHEMA_VERSION = 1`, `ALL_MONTHS = "*"`, `interface MonthOverride { roles; exactRules }`, `interface MemberOverride { ordinal; memberId; note; exempt; sundayCadence; joinMonths; blockedDates; months }`, `interface Overrides { hash; members }`, `overridesHash(text): string`, `parseOverrides(text: string, rosterIds: ReadonlySet<string>): { ok: true; overrides: Overrides } | { ok: false; refusals: RunRefusal[] }`, `outOfRunEntries(overrides, months): Array<{ ordinal; memberId; month }>`.

- [ ] **Step 1: Write the failing test**

**Create** `scripts/__tests__/reconstructOverrides.test.ts`:

````ts
// Solver v3 C4 R8 — Frank's corrections file: schema v1, keyed by member `_id`,
// validated in full; any typo refuses the whole run. Entries are named on stdout by
// their position in the file, never by id (R12). Every name is fictitious.
import { describe, expect, it } from "vitest";

import { outOfRunEntries, parseOverrides } from "../lib/reconstructOverrides";

const ROSTER = new Set(["m-ana", "m-beto", "m-fausto"]);
const parse = (doc: unknown) => parseOverrides(JSON.stringify(doc), ROSTER);
const reasons = (doc: unknown) => {
  const parsed = parse(doc);
  return parsed.ok ? [] : parsed.refusals.map((r) => r.reason);
};
const one = (member: Record<string, unknown>) => ({ schemaVersion: 1, members: { "m-ana": member } });

describe("parsing (R8)", () => {
  it("reads every field and numbers the entries by their position in the file", () => {
    const parsed = parse({
      schemaVersion: 1,
      members: {
        "m-beto": { months: { "2026-08": { exactRules: [{ roles: ["Sat.BGV", "Sun.BGV"], count: 2 }] } } },
        "m-fausto": {
          note: "Cantó en septiembre.",
          exempt: false,
          sundayCadence: "normal",
          joinMonths: { BGV: "2026-09" },
          blockedDates: [{ date: "2026-09-06" }, { date: "2026-09-13", roles: ["Sat.BGV", "Sun.BGV"] }],
          months: { "*": { roles: { "Sun.BGV": "in" } } },
        },
      },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.overrides.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(parsed.overrides.members.map((m) => [m.ordinal, m.memberId])).toEqual([
      [1, "m-beto"],
      [2, "m-fausto"],
    ]);
    expect(parsed.overrides.members[0].months["2026-08"]).toEqual({
      roles: {},
      exactRules: [{ roles: ["Sun.BGV", "Sat.BGV"], count: 2 }],
    });
    expect(parsed.overrides.members[1]).toEqual({
      ordinal: 2,
      memberId: "m-fausto",
      note: "Cantó en septiembre.",
      exempt: false,
      sundayCadence: "normal",
      joinMonths: { BGV: "2026-09" },
      blockedDates: [
        { date: "2026-09-06", roles: null },
        { date: "2026-09-13", roles: ["Sun.BGV", "Sat.BGV"] },
      ],
      months: { "*": { roles: { "Sun.BGV": "in" }, exactRules: [] } },
    });
  });

  it("refuses text that is not JSON", () => {
    const parsed = parseOverrides("{", ROSTER);
    expect(parsed.ok ? [] : parsed.refusals.map((r) => r.reason)).toEqual(["override_json"]);
  });

  it.each<[string, unknown, string]>([
    ["another schema version", { schemaVersion: 2, members: {} }, "override_version"],
    ["an unknown root key", { schemaVersion: 1, members: {}, extra: true }, "override_schema"],
    ["members that is not an object", { schemaVersion: 1, members: [] }, "override_schema"],
    ["an id off the worship roster", { schemaVersion: 1, members: { "m-greta": {} } }, "override_member_unknown"],
    ["an unknown member key", one({ colour: "azul" }), "override_schema"],
    ["a malformed month key", one({ months: { "2026-8": { roles: { "Sun.BGV": "in" } } } }), "override_month"],
    ["«*» beside a named month", one({ months: { "*": { roles: {} }, "2026-08": { roles: {} } } }), "override_scope"],
    ["an unknown role", one({ months: { "2026-08": { roles: { "Sun.Bajo": "in" } } } }), "override_role"],
    ["a status other than in/out", one({ months: { "2026-08": { roles: { "Sun.BGV": "exact" } } } }), "override_status"],
    ["a count of 0", one({ months: { "2026-08": { exactRules: [{ roles: ["Sun.BGV"], count: 0 }] } } }), "override_count"],
    ["a count of 32", one({ months: { "2026-08": { exactRules: [{ roles: ["Sun.BGV"], count: 32 }] } } }), "override_count"],
    ["a fractional count", one({ months: { "2026-08": { exactRules: [{ roles: ["Sun.BGV"], count: 1.5 }] } } }), "override_count"],
    [
      "two of the file's own rules covering one role (A38)",
      one({ months: { "2026-08": { exactRules: [{ roles: ["Sun.BGV", "Sat.BGV"], count: 2 }, { roles: ["Sun.BGV"], count: 1 }] } } }),
      "override_overlap",
    ],
    [
      "a status and an exact rule for one role",
      one({ months: { "2026-08": { roles: { "Sun.BGV": "in" }, exactRules: [{ roles: ["Sun.BGV"], count: 1 }] } } }),
      "override_contradiction",
    ],
    ["an impossible blocked date", one({ blockedDates: [{ date: "2026-09-31" }] }), "override_date"],
    ["an unknown line", one({ joinMonths: { DLX: "2026-09" } }), "override_schema"],
    ["a malformed join month", one({ joinMonths: { BGV: "septiembre" } }), "override_month"],
    ["a non-boolean exempt", one({ exempt: "sí" }), "override_schema"],
    ["an unknown cadence value", one({ sundayCadence: "siempre" }), "override_schema"],
  ])("refuses %s", (_label, doc, reason) => {
    expect(reasons(doc)).toContain(reason);
  });

  it("names a refused entry by its position on stdout and keeps the id for the private report", () => {
    const parsed = parse({ schemaVersion: 1, members: { "m-ana": {}, "m-greta": {} } });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.refusals).toEqual([
      expect.objectContaining({
        reason: "override_member_unknown",
        kind: "corrección",
        rules: [{ ordinal: "entrada 2 del archivo", key: null }],
        memberIds: ["m-greta"],
      }),
    ]);
  });

  it("lists entries for valid months outside the run as «no aplica»", () => {
    const parsed = parse({
      schemaVersion: 1,
      members: {
        "m-ana": { months: { "2026-10": { roles: { "Sat.BGV": "in" } } } },
        "m-beto": { blockedDates: [{ date: "2026-11-01" }, { date: "2026-08-02" }] },
      },
    });
    if (!parsed.ok) throw new Error("expected a valid file");
    expect(outOfRunEntries(parsed.overrides, ["2026-08", "2026-09"])).toEqual([
      { ordinal: 1, memberId: "m-ana", month: "2026-10" },
      { ordinal: 2, memberId: "m-beto", month: "2026-11" },
    ]);
  });
});
````

- [ ] **Step 2: Run it to see it fail**

Run: `git add -A && npx vitest run scripts/__tests__/reconstructOverrides.test.ts`
Expected: FAIL — `../lib/reconstructOverrides` does not resolve.

- [ ] **Step 3: Implement**

**Create** `scripts/lib/reconstructTypes.ts`:

````ts
// scripts/lib/reconstructTypes.ts
//
// Shared shapes of the fairness-record reconstruction (solver v3 C4; spec
// docs/superpowers/specs/2026-10-05-solver-v3-c4-record-reconstruction-design.md).
// Types, constant tables and one error class: no I/O, no Sanity client and no import
// of C2's write-request module, so every other `reconstruct*` module may import it
// without joining that module's importer pin (C2 IF2-23: only `reconstructDecide.ts`
// and the CLI file import the write-request module).

import type { EligibilityMember } from "../../app/utils/fairnessEligibility";
import type { FairnessMonthBody, RoleKey } from "../../app/utils/fairnessVocabulary";

/** The four role lines a join month is kept for (R5). Presence sub-lines have none. */
export type Line = "DL" | "SL" | "BGV" | "CORO";
export const LINES: readonly Line[] = ["DL", "SL", "BGV", "CORO"];

/** The role keys of each line — C2 IF2-1's role → line map, inverted. */
export const LINE_ROLES: Readonly<Record<Line, readonly RoleKey[]>> = {
  DL: ["Sun.Lead"],
  SL: ["Sat.Lead"],
  BGV: ["Sun.BGV", "Sat.BGV"],
  CORO: ["Sun.Choir", "Sat.Choir"],
};

/** One row of C2 IF2-27 (the worship roster) exactly as read; handed to IF2-15 and C3 unaltered (R3, R4). */
export type RosterRow = EligibilityMember;

/** A reconstruction write entry: IF2-15's body plus the revision it asserts — IF2-18 requires `expectedRev` for either actor. */
export type ReconstructionBody = FairnessMonthBody & { expectedRev: string | null };

/** Why a cell has its status (R11's reason code; Spanish labels in `reconstructReport.ts`). */
export type CellReason = "tipo" | "sin_tipo" | "regla" | "fija" | "linea" | "partida" | "correccion";
export interface CellInfo {
  reason: CellReason;
  corrected: boolean;
}
export type PersonCells = Record<RoleKey, CellInfo>;

/** One «corregido» mark (R8, R11). Kept beside the body in the plan, never inside it: IF2-18 is strict. */
export interface Correction {
  memberId: string;
  field: RoleKey | "exempt" | "sundayCadence" | "blocks" | "added";
}

/** A month's planned action (spec «Decision per month», plus R1's skip). */
export type MonthAction = "create" | "replace" | "unchanged" | "skip" | "not_reconstruction_owned" | "record_edited";
/** A rollback month's planned action (R18; C2 WR-14 D1–D3). */
export type RollbackAction = "delete" | "none" | "not_reconstruction_owned" | "record_edited";

/** R13's anomaly types, in the order the spec lists them (also the table's order). */
export const ANOMALY_CODES = [
  "seat_while_out",
  "seat_unavailable",
  "seat_rule_excluded",
  "join_mid_month",
  "exact_mismatch",
  "cadence_not_in",
  "not_ticked_today",
  "ticked_never_seated",
  "presence_no_seat",
  "presence_outside",
  "person_added",
  "member_gone",
  "duplicate_target",
  "second_seat",
  "rule_split",
  "lost_block",
] as const;
export type AnomalyCode = (typeof ANOMALY_CODES)[number];

/**
 * One anomaly (R13): listed, never resolved. `memberId`, `ruleKey` and `roleIds` are
 * private — an anomaly reaches only the private table and the plan; stdout prints a
 * count per month (R12).
 */
export interface Anomaly {
  code: AnomalyCode;
  /** null for the per-person pool anomalies, which span the whole run. */
  month: string | null;
  memberId?: string;
  line?: Line;
  roleKey?: RoleKey;
  date?: string;
  serviceId?: string;
  ruleKey?: string;
  ruleOrdinal?: string;
  roles?: RoleKey[];
  count?: number;
  held?: number;
  months?: string[];
  firstServiceDate?: string;
  type?: string;
  roleIds?: string[];
  dates?: string[];
}

export type RefusalKind =
  | "restricción"
  | "conflicto"
  | "presencia"
  | "regla fija"
  | "mes por medio"
  | "personas"
  | "corrección"
  | "plan";

/**
 * One refusal (R13). Only `reason`, `kind`, `rules[].ordinal`, `month`, `roleKey` and
 * `issues` (C2's index-based issues, IF2-18) may reach stdout; `rules[].key`,
 * `person`, `memberIds`, `detail` and `fix` go to the private refusal report only.
 */
export interface RunRefusal {
  reason: string;
  kind: RefusalKind;
  rules: Array<{ ordinal: string; key: string | null }>;
  month?: string;
  roleKey?: RoleKey;
  issues?: Array<{ path: string; message: string }>;
  person?: string;
  memberIds?: string[];
  detail: string;
  fix: string;
}

/** A failed or malformed read (R3): the run stops with exit 1 before any file is written. */
export class ReadFailure extends Error {
  constructor(
    readonly step: string,
    readonly causeClass: string = "",
  ) {
    super(`read failed: ${step}`);
    this.name = "ReadFailure";
  }
}
````

**Create** `scripts/lib/reconstructOverrides.ts`:

````ts
// scripts/lib/reconstructOverrides.ts
//
// R8 — Frank's corrections file, parsed and validated IN FULL before any record is
// built (solver v3 C4). Keyed by member `_id` (D8), with a schema version; a typo
// refuses the whole run (exit 2). Entries are numbered by their position in
// `members` («entrada 2 del archivo») — the only way stdout may point at one (R12).
// A free-text note is printed in the private table and never written to Sanity.
//
// Shape (version 1):
//   { "schemaVersion": 1,
//     "members": {
//       "<member _id>": {
//         "note": "…",                                  optional, private
//         "exempt": true | false,                       optional, every month of the run
//         "sundayCadence": "alternate" | "normal",      optional, every month of the run
//         "joinMonths": { "BGV": "2026-09" },           optional; replaces the seat-derived month of that line
//         "blockedDates": [{ "date": "2026-09-06" }, { "date": "2026-09-13", "roles": ["Sun.BGV"] }],
//                                                       no roles = unavailable that day; roles = excluded from them
//         "months": { "*" | "YYYY-MM": { "roles": { "Sun.BGV": "in" },
//                                         "exactRules": [{ "roles": ["Sun.BGV"], "count": 2 }] } } } } }
// An entry uses "*" (every month of the run) or named months, never both. Whether a
// correction leaves half of one of TODAY's exact rules (the replacement rule, A38)
// depends on the resolver's body, so `transformMonth` checks it — still before any
// table or plan is written.

import { createHash } from "node:crypto";

import { canonicalRoles, isMonthString, isRoleKey, type RoleKey } from "../../app/utils/fairnessVocabulary";
import { isValidServiceDate } from "../../app/utils/serviceReadModel";
import { LINES, type Line, type RunRefusal } from "./reconstructTypes";

export const OVERRIDES_SCHEMA_VERSION = 1;
/** The month key that means «every month of the run». */
export const ALL_MONTHS = "*";

export interface MonthOverride {
  roles: Partial<Record<RoleKey, "in" | "out">>;
  exactRules: Array<{ roles: RoleKey[]; count: number }>;
}

export interface MemberOverride {
  /** 1-based position in the file's `members` object. */
  ordinal: number;
  memberId: string;
  note: string | null;
  exempt: boolean | null;
  sundayCadence: "alternate" | "normal" | null;
  joinMonths: Partial<Record<Line, string>>;
  blockedDates: Array<{ date: string; roles: RoleKey[] | null }>;
  /** `"*"` or `YYYY-MM` → that month's statuses and exact rules. */
  months: Record<string, MonthOverride>;
}

export interface Overrides {
  /** SHA-256 of the file's bytes — bound into the plan (R15). */
  hash: string;
  members: MemberOverride[];
}

const MEMBER_KEYS = new Set(["note", "exempt", "sundayCadence", "joinMonths", "blockedDates", "months"]);
const MONTH_KEYS = new Set(["roles", "exactRules"]);
const FIX = "Corrige el archivo de correcciones y vuelve a correr el dry run.";

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const distinctRoles = (v: unknown, max: number): v is RoleKey[] =>
  Array.isArray(v) && v.length >= 1 && v.length <= max && v.every((k) => isRoleKey(k)) && new Set(v).size === v.length;

export function overridesHash(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

export function parseOverrides(
  text: string,
  rosterIds: ReadonlySet<string>,
): { ok: true; overrides: Overrides } | { ok: false; refusals: RunRefusal[] } {
  const refusals: RunRefusal[] = [];
  const refuse = (ordinal: number | null, reason: string, detail: string, memberId?: string) => {
    refusals.push({
      reason,
      kind: "corrección",
      rules: ordinal === null ? [] : [{ ordinal: `entrada ${ordinal} del archivo`, key: null }],
      ...(memberId !== undefined ? { memberIds: [memberId] } : {}),
      detail,
      fix: FIX,
    });
  };

  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    refuse(null, "override_json", "El archivo de correcciones no es JSON válido.");
    return { ok: false, refusals };
  }
  if (!isObj(doc)) {
    refuse(null, "override_schema", "El archivo debe ser un objeto con «schemaVersion» y «members».");
    return { ok: false, refusals };
  }
  for (const key of Object.keys(doc)) {
    if (key !== "schemaVersion" && key !== "members") refuse(null, "override_schema", `Clave desconocida en la raíz: «${key}».`);
  }
  if (doc.schemaVersion !== OVERRIDES_SCHEMA_VERSION) {
    refuse(null, "override_version", `«schemaVersion» debe ser ${OVERRIDES_SCHEMA_VERSION}.`);
  }
  if (!isObj(doc.members)) {
    refuse(null, "override_schema", "«members» debe ser un objeto cuyas claves son el _id de cada miembro.");
    return { ok: false, refusals };
  }

  const members: MemberOverride[] = [];
  Object.entries(doc.members).forEach(([memberId, raw], index) => {
    const ordinal = index + 1;
    const bad = (reason: string, detail: string) => refuse(ordinal, reason, detail, memberId);
    if (!rosterIds.has(memberId)) bad("override_member_unknown", "Ese _id no está en el equipo de alabanza que se leyó (IF2-27).");
    if (!isObj(raw)) {
      bad("override_schema", "La entrada debe ser un objeto.");
      return;
    }
    for (const key of Object.keys(raw)) if (!MEMBER_KEYS.has(key)) bad("override_schema", `Clave desconocida: «${key}».`);
    const entry: MemberOverride = {
      ordinal,
      memberId,
      note: null,
      exempt: null,
      sundayCadence: null,
      joinMonths: {},
      blockedDates: [],
      months: {},
    };
    if (raw.note !== undefined) {
      if (typeof raw.note === "string") entry.note = raw.note;
      else bad("override_schema", "«note» debe ser texto.");
    }
    if (raw.exempt !== undefined) {
      if (typeof raw.exempt === "boolean") entry.exempt = raw.exempt;
      else bad("override_schema", "«exempt» debe ser true o false.");
    }
    if (raw.sundayCadence !== undefined) {
      if (raw.sundayCadence === "alternate" || raw.sundayCadence === "normal") entry.sundayCadence = raw.sundayCadence;
      else bad("override_schema", "«sundayCadence» debe ser \"alternate\" o \"normal\".");
    }
    if (raw.joinMonths !== undefined) {
      if (!isObj(raw.joinMonths)) bad("override_schema", "«joinMonths» debe ser un objeto por línea.");
      else {
        for (const [line, month] of Object.entries(raw.joinMonths)) {
          if (!(LINES as readonly string[]).includes(line)) bad("override_schema", `Línea desconocida en «joinMonths»: «${line}».`);
          else if (!isMonthString(month)) bad("override_month", `«joinMonths.${line}» debe ser YYYY-MM.`);
          else entry.joinMonths[line as Line] = month;
        }
      }
    }
    if (raw.blockedDates !== undefined) {
      if (!Array.isArray(raw.blockedDates)) bad("override_schema", "«blockedDates» debe ser una lista.");
      else {
        raw.blockedDates.forEach((item, i) => {
          if (!isObj(item)) {
            bad("override_schema", `«blockedDates[${i}]» debe ser un objeto.`);
            return;
          }
          for (const key of Object.keys(item)) {
            if (key !== "date" && key !== "roles") bad("override_schema", `Clave desconocida en «blockedDates[${i}]»: «${key}».`);
          }
          if (!isValidServiceDate(item.date)) {
            bad("override_date", `«blockedDates[${i}].date» debe ser una fecha YYYY-MM-DD real.`);
            return;
          }
          if (item.roles !== undefined && !distinctRoles(item.roles, 6)) {
            bad("override_role", `«blockedDates[${i}].roles» debe listar roles distintos (Sun.Lead … Sat.Choir).`);
            return;
          }
          entry.blockedDates.push({ date: item.date, roles: item.roles === undefined ? null : canonicalRoles(item.roles as RoleKey[]) });
        });
      }
    }
    if (raw.months !== undefined) {
      if (!isObj(raw.months)) bad("override_schema", "«months» debe ser un objeto por mes.");
      else {
        const keys = Object.keys(raw.months);
        if (keys.includes(ALL_MONTHS) && keys.length > 1) {
          bad("override_scope", "Una entrada usa \"*\" (todos los meses de la corrida) o meses con nombre, nunca los dos.");
        }
        for (const [key, value] of Object.entries(raw.months)) {
          if (key !== ALL_MONTHS && !isMonthString(key)) {
            bad("override_month", `Mes inválido en «months»: «${key}».`);
            continue;
          }
          const parsed = parseMonthOverride(value, key, bad);
          if (parsed) entry.months[key] = parsed;
        }
      }
    }
    members.push(entry);
  });

  if (refusals.length > 0) return { ok: false, refusals };
  return { ok: true, overrides: { hash: overridesHash(text), members } };
}

function parseMonthOverride(
  value: unknown,
  key: string,
  bad: (reason: string, detail: string) => void,
): MonthOverride | null {
  const where = `months.${key}`;
  if (!isObj(value)) {
    bad("override_schema", `«${where}» debe ser un objeto.`);
    return null;
  }
  for (const k of Object.keys(value)) if (!MONTH_KEYS.has(k)) bad("override_schema", `Clave desconocida en «${where}»: «${k}».`);
  const out: MonthOverride = { roles: {}, exactRules: [] };
  let ok = true;
  if (value.roles !== undefined) {
    if (!isObj(value.roles)) {
      bad("override_schema", `«${where}.roles» debe ser un objeto.`);
      ok = false;
    } else {
      for (const [role, status] of Object.entries(value.roles)) {
        if (!isRoleKey(role)) {
          bad("override_role", `Rol desconocido en «${where}.roles»: «${role}».`);
          ok = false;
        } else if (status !== "in" && status !== "out") {
          bad("override_status", `«${where}.roles.${role}» debe ser "in" o "out" (una cuenta fija va en «exactRules»).`);
          ok = false;
        } else out.roles[role] = status;
      }
    }
  }
  if (value.exactRules !== undefined) {
    if (!Array.isArray(value.exactRules)) {
      bad("override_schema", `«${where}.exactRules» debe ser una lista.`);
      ok = false;
    } else {
      value.exactRules.forEach((rule, i) => {
        const at = `${where}.exactRules[${i}]`;
        if (!isObj(rule)) {
          bad("override_schema", `«${at}» debe ser un objeto.`);
          ok = false;
          return;
        }
        for (const k of Object.keys(rule)) if (k !== "roles" && k !== "count") bad("override_schema", `Clave desconocida en «${at}»: «${k}».`);
        if (!distinctRoles(rule.roles, 6)) {
          bad("override_role", `«${at}.roles» debe listar de 1 a 6 roles distintos.`);
          ok = false;
          return;
        }
        if (!(typeof rule.count === "number" && Number.isInteger(rule.count) && rule.count >= 1 && rule.count <= 31)) {
          bad("override_count", `«${at}.count» debe ser un entero de 1 a 31.`);
          ok = false;
          return;
        }
        out.exactRules.push({ roles: canonicalRoles(rule.roles as RoleKey[]), count: rule.count });
      });
    }
  }
  // Inside the file, exactly what IF2-18 would refuse: two exact counts for one role
  // key (A38), or a role given both a status and an exact rule.
  const covered = new Map<RoleKey, number>();
  for (const rule of out.exactRules) for (const k of rule.roles) covered.set(k, (covered.get(k) ?? 0) + 1);
  for (const [k, n] of covered) {
    if (n > 1) {
      bad("override_overlap", `«${where}»: dos reglas fijas cubren ${k} (A38: una sola cuenta fija por rol).`);
      ok = false;
    }
    if (out.roles[k] !== undefined) {
      bad("override_contradiction", `«${where}»: ${k} tiene un estado y una regla fija a la vez.`);
      ok = false;
    }
  }
  return ok ? out : null;
}

/** «no aplica a esta corrida» (R8): valid months outside `--months`, listed in the private table only. */
export function outOfRunEntries(
  overrides: Overrides,
  months: readonly string[],
): Array<{ ordinal: number; memberId: string; month: string }> {
  const inRun = new Set(months);
  const out: Array<{ ordinal: number; memberId: string; month: string }> = [];
  for (const o of overrides.members) {
    const named = new Set<string>([
      ...Object.keys(o.months).filter((k) => k !== ALL_MONTHS),
      ...o.blockedDates.map((d) => d.date.slice(0, 7)),
    ]);
    for (const month of [...named].sort()) if (!inRun.has(month)) out.push({ ordinal: o.ordinal, memberId: o.memberId, month });
  }
  return out;
}
````

- [ ] **Step 4: Run it to see it pass**

Run: `git add -A && npx vitest run scripts/__tests__/reconstructOverrides.test.ts`
Expected: PASS.

- [ ] **Step 5: Gates and commit**

Run: `git add -A && npx tsc --noEmit && npm test && npx eslint .`
Expected: all green (on the replay base `a35f812e`: **470 files / 8690 tests**, 81 warnings); 0 errors; warnings at baseline.

```bash
git add -A
git commit -m "feat(fairness): the reconstruction's corrections file, validated in full" -m "Solver v3 C4 R8. Frank's corrections are a versioned JSON file keyed by member _id: statuses and exact rules per month or for every month of the run, exempt, the cadence setting, join months per line, blocked dates and a private note. Every typo, an id off the worship roster, a count outside 1-31, two of the file's own exact rules on one role (A38) or a role given a status and an exact rule refuses the whole run, and stdout names an entry only by its position in the file."
```

---
## Task 3: The write-request gateway and the plan file — **[CRITICAL slice: the decision table the executor re-runs, and the plan binding consent attaches to]**

Spec R2 (C4 builds no id, key, stamp, name or record hash), R14 (the planned action is IF2-21's verdict), R15 (the plan binding: digests and fingerprint), R17 (determinism), R18 (rollback decision and backups), R20 b (the importer pin). `reconstructDecide.ts` is the ONLY `scripts/lib` file that value-imports C2's write-request module, so the pin lists exactly it and (in Task 10) the CLI file.

**Files:**
- Create: `scripts/lib/reconstructDecide.ts`, `scripts/lib/reconstructPlanFile.ts`
- Modify: `app/utils/__tests__/serviceCommitCallers.test.ts` (the `fairnessMonthWriteRequest` row of `EXPECTED_CALLERS`) **[verified a35f812e]**
- Test: `scripts/__tests__/reconstructPlanFile.test.ts`

**Interfaces:**
- Consumes: from `app/utils/fairnessMonthWriteRequest.ts` **[verified c2-t10]** — `RECONSTRUCTION_RECORDED_BY`, `validateFairnessMonthWrite(body, actor, currentMonth)` (IF2-18), `contentHashOfWrite(month, body)` / `contentHashOfStored(doc)` / `isIntact(doc)` (IF2-19), `parseStoredFairnessMonth(doc)` (IF2-20), `decideFairnessMonth(input)` (IF2-21), `type FairnessDecision`, `type FairnessIssue`, `buildFairnessMonthDocument` (tests only); `countsForFairness` (C1); `normalizeMinistries`; `compareCodepoint`, `type TabKey`, `type FairnessMonthBody`, `type LogicalRecord` (IF2-1/IF2-3 module); `type LedgerService` (IF2-10); Task 2's types.
- Produces (gateway): `RECORDED_BY`; `validateReconstructionBody(body: ReconstructionBody, currentMonth: string): { ok: true } | { ok: false; issues: FairnessIssue[] }`; `hashOfBody(body: FairnessMonthBody): string`; `parseRecord(doc: unknown): { ok: true; record: LogicalRecord } | { ok: false; issues: FairnessIssue[] }`; `interface StoredSummary { id; rev; source; contentHash; recomputedHash; intact }`; `summarizeStored(doc: Record<string, unknown>): StoredSummary`; `decideWrite({ month, currentMonth, bodyHash, stored, freezing }): FairnessDecision`; `decideDelete({ month, currentMonth, stored }): FairnessDecision`.
- Produces (plan file): `canonicalJson`, `canonicalPretty`, `sha256Hex`, `hashText`, `backupText(doc)`, `serviceInputDigest(services)`, `memberInputDigest(roster, months)`, `interface WriteMonthPlan`, `interface WritePlanContent`, `interface RollbackMonthPlan`, `interface RollbackPlanContent`, `type PlanContent`, `interface PlanFile`, `PLAN_KIND`, `PLAN_VERSION`, `fingerprintOf(content): string`, `serializePlan(content, generatedAt): string`, `parsePlanFile(text): { ok: true; plan: PlanFile } | { ok: false; reason: string }`, `planDifferences(planned, live): string[]`.

- [ ] **Step 1: Write the failing test and the importer pin**

**Create** `scripts/__tests__/reconstructPlanFile.test.ts`:

````ts
// Solver v3 C4 — the one gateway to C2's write-request module (IF2-18 … IF2-21 for
// actor `reconstruction`) and the plan file: R14 (the planned action is the
// executor's own verdict), R15 (digests and fingerprint), R17 (determinism), R18
// (delete decisions and backups). Every name is fictitious.
import { describe, expect, it } from "vitest";

import type { LedgerService } from "@/app/utils/fairnessLedger";
import { buildFairnessMonthDocument } from "@/app/utils/fairnessMonthWriteRequest";
import type { FairnessMonthBody, RoleKey, Status } from "@/app/utils/fairnessVocabulary";
import {
  RECORDED_BY,
  decideDelete,
  decideWrite,
  hashOfBody,
  parseRecord,
  summarizeStored,
  validateReconstructionBody,
} from "../lib/reconstructDecide";
import {
  backupText,
  canonicalJson,
  fingerprintOf,
  hashText,
  memberInputDigest,
  parsePlanFile,
  planDifferences,
  serializePlan,
  serviceInputDigest,
  type RollbackPlanContent,
} from "../lib/reconstructPlanFile";

const CURRENT = "2026-10";
const OUT: Record<RoleKey, Status> = {
  "Sun.Lead": "out",
  "Sat.Lead": "out",
  "Sun.BGV": "out",
  "Sat.BGV": "out",
  "Sun.Choir": "out",
  "Sat.Choir": "out",
};
const body = (month: string, lead: Status = "in"): FairnessMonthBody => ({
  month,
  people: [{ memberId: "m-ana", roles: { ...OUT, "Sun.Lead": lead }, exactRules: [], exempt: false, blocks: [] }],
  presence: [],
});
const stored = (b: FairnessMonthBody, source: "auto" | "manual" | "reconstructed" = "reconstructed"): Record<string, unknown> => ({
  ...buildFairnessMonthDocument({
    body: b,
    source,
    engine: source === "reconstructed" ? "v2" : "v3",
    environment: "local",
    recordedAt: "2026-10-02T00:00:00.000Z",
    recordedBy: RECORDED_BY,
    names: new Map([["m-ana", "Ana E."]]),
  }),
  _rev: "rev-1",
});
/** A hand edit after the write: one role flipped, the stored contentHash left as it was. */
const edited = (doc: Record<string, unknown>): Record<string, unknown> => {
  const copy = structuredClone(doc) as { people: Array<{ roles: Record<string, string> }> };
  copy.people[0].roles.sunLead = copy.people[0].roles.sunLead === "in" ? "out" : "in";
  return copy as unknown as Record<string, unknown>;
};

describe("the write decision, exactly as the executor will take it (R14; C2 IF2-21)", () => {
  const planned = body("2026-08");
  const plan = (doc: Record<string, unknown> | null) =>
    decideWrite({ month: "2026-08", currentMonth: CURRENT, bodyHash: hashOfBody(planned), stored: doc ? summarizeStored(doc) : null, freezing: 3 });

  it("creates when there is no record", () => expect(plan(null)).toBe("create"));
  it("changes nothing when a record holds the same content, whatever its source", () => {
    expect(plan(stored(planned))).toBe("unchanged");
    expect(plan(stored(planned, "manual"))).toBe("unchanged");
  });
  it("replaces an intact reconstructed record whose content differs", () => {
    expect(plan(stored(body("2026-08", "out")))).toBe("replace");
  });
  it("refuses a record another writer made", () => {
    expect(plan(stored(body("2026-08", "out"), "auto"))).toEqual({ refused: "not_reconstruction_owned" });
  });
  it("refuses a reconstructed record edited after it was written", () => {
    expect(plan(edited(stored(body("2026-08", "out"))))).toEqual({ refused: "record_edited" });
  });
  it("never plans a month that is not past", () => {
    expect(decideWrite({ month: "2026-10", currentMonth: CURRENT, bodyHash: hashOfBody(body("2026-10")), stored: null, freezing: 1 })).toEqual({
      refused: "not_past_month",
    });
  });
});

describe("the delete decision (R18; C2 WR-14 D1–D4)", () => {
  const del = (doc: Record<string, unknown> | null) =>
    decideDelete({ month: "2026-08", currentMonth: CURRENT, stored: doc ? summarizeStored(doc) : null });
  it("deletes only an intact record the reconstruction wrote", () => {
    expect(del(stored(body("2026-08")))).toBe("delete");
    expect(del(stored(body("2026-08"), "manual"))).toEqual({ refused: "not_reconstruction_owned" });
    expect(del(edited(stored(body("2026-08"))))).toEqual({ refused: "record_edited" });
    expect(del(null)).toEqual({ refused: "record_missing" });
  });
});

describe("validation and parsing through C2 (IF2-18, IF2-20)", () => {
  it("accepts a reconstruction body with its expectedRev, refuses one without it or with a source", () => {
    expect(validateReconstructionBody({ ...body("2026-08"), expectedRev: null }, CURRENT)).toEqual({ ok: true });
    expect(validateReconstructionBody(body("2026-08") as never, CURRENT).ok).toBe(false);
    expect(validateReconstructionBody({ ...body("2026-08"), expectedRev: null, source: "auto" } as never, CURRENT).ok).toBe(false);
  });
  it("parses a stored record and refuses a malformed one", () => {
    expect(parseRecord(stored(body("2026-08"))).ok).toBe(true);
    expect(parseRecord({ ...stored(body("2026-08")), schemaVersion: 9 }).ok).toBe(false);
  });
  it("summarizes a stored record the way the executor re-reads it, without building anything", () => {
    const doc = stored(body("2026-08"));
    expect(summarizeStored(doc)).toEqual({
      id: "fairnessMonth.2026-08",
      rev: "rev-1",
      source: "reconstructed",
      contentHash: doc.contentHash,
      recomputedHash: doc.contentHash,
      intact: true,
    });
    expect(summarizeStored(edited(doc)).intact).toBe(false);
  });
});

describe("the plan file (R15, R17, R18)", () => {
  const content: RollbackPlanContent = {
    mode: "rollback",
    inputs: { months: ["2026-08"] },
    months: [
      {
        month: "2026-08",
        action: "delete",
        stored: { id: "fairnessMonth.2026-08", rev: "rev-1", source: "reconstructed", contentHash: "sha256:aa", recomputedHash: "sha256:aa" },
        backup: { file: "backup-2026-08.json", hash: "sha256:bb" },
      },
    ],
  };
  const withoutTime = (text: string) => text.split("\n").filter((line) => !line.includes('"generatedAt"')).join("\n");

  it("serializes object keys in codepoint order at every level", () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }], u: undefined })).toBe('{"a":[{"c":3,"d":2}],"b":1}');
  });
  it("keeps the generation time out of the fingerprint and round-trips", () => {
    const first = serializePlan(content, "2026-10-20T18:00:00.000Z");
    expect(withoutTime(serializePlan(content, "2026-10-21T09:30:00.000Z"))).toBe(withoutTime(first));
    const parsed = parsePlanFile(first);
    expect(parsed.ok && parsed.plan.fingerprint).toBe(fingerprintOf(content));
    expect(fingerprintOf(content)).toMatch(/^[0-9a-f]{64}$/);
  });
  it("refuses a plan edited after it was written", () => {
    const text = serializePlan(content, "2026-10-20T18:00:00.000Z").replace('"rev-1"', '"rev-2"');
    const parsed = parsePlanFile(text);
    expect(parsed.ok ? "" : parsed.reason).toMatch(/huella no coincide/);
  });
  it("names the parts that differ by position and month only", () => {
    const stale: RollbackPlanContent = {
      ...content,
      months: [{ ...content.months[0], stored: { ...content.months[0].stored!, rev: "rev-2" } }],
    };
    expect(planDifferences(content, stale)).toEqual(["months[0] (2026-08)"]);
    expect(planDifferences(content, content)).toEqual([]);
  });
  it("backs a stored document up as reproducible bytes", () => {
    const doc = stored(body("2026-08"));
    expect(backupText(doc)).toBe(backupText(JSON.parse(JSON.stringify(doc))));
    expect(hashText(backupText(doc))).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe("the input digests (R15)", () => {
  const service = (patch: Partial<LedgerService> = {}): LedgerService => ({
    _id: "sun-2026-08-02",
    _type: "sunday_role",
    date: "2026-08-02",
    published: true,
    countsForFairness: true,
    Lead: ["m-ana"],
    BGVs: ["m-beto", "m-carla"],
    Chorus: [],
    ...patch,
  });
  it("ignores publishing and the service time; sees stored seat order and the counted flag", () => {
    const base = serviceInputDigest([service()]);
    expect(serviceInputDigest([service({ published: false })])).toBe(base);
    expect(serviceInputDigest([service({ time: "10:00" })])).toBe(base);
    expect(serviceInputDigest([service({ BGVs: ["m-carla", "m-beto"] })])).not.toBe(base);
    expect(serviceInputDigest([service({ countsForFairness: false })])).not.toBe(base);
  });
  it("binds members' availability inside the run's months, and nothing outside them", () => {
    const roster = (dates: string[]) => [{ _id: "m-ana", member_name: "Ana Ejemplo", memberType: ["voz", "sunday_lead"], unavailableDates: dates }];
    const base = memberInputDigest(roster(["2026-08-15"]), ["2026-08"]);
    expect(memberInputDigest(roster(["2026-08-15", "2025-12-25"]), ["2026-08"])).toBe(base);
    expect(memberInputDigest(roster(["2026-08-15", "2026-08-22"]), ["2026-08"])).not.toBe(base);
  });
});
````

**Find** in `app/utils/__tests__/serviceCommitCallers.test.ts`:

````ts
  fairnessMonthWriteRequest: ["app/utils/fairnessLedgerRead.ts", "app/utils/fairnessMonthCommit.ts"],
````

**Replace with:**

````ts
  fairnessMonthWriteRequest: [
    "app/utils/fairnessLedgerRead.ts",
    "app/utils/fairnessMonthCommit.ts",
    // Solver v3 C4 R20 b: the reconstruction core's ONE gateway to the module (IF2-18 …
    // IF2-21). It never calls the executor; the CLI file, the only caller, joins in C4's Task 10.
    "scripts/lib/reconstructDecide.ts",
  ],
````

- [ ] **Step 2: Run them to see them fail**

Run: `git add -A && npx vitest run scripts/__tests__/reconstructPlanFile.test.ts app/utils/__tests__/serviceCommitCallers.test.ts`
Expected: FAIL — the two modules do not resolve, and the pin lists an importer that does not exist yet.

- [ ] **Step 3: Implement**

**Create** `scripts/lib/reconstructDecide.ts`:

````ts
// scripts/lib/reconstructDecide.ts
//
// THE one `scripts/lib` module that imports C2's write-request module (solver v3 C4
// R20 b; C2 IF2-23's importer pin lists exactly this file and the CLI file). It
// re-exposes the four pure functions C4 needs for actor `reconstruction` —
// validation (IF2-18), the content hash (IF2-19), the stored-record parser (IF2-20)
// and the write decision (IF2-21) — and the script's fixed `recordedBy` marker.
// It never calls the executor (IF2-22): only `scripts/reconstruct-fairness-months.mjs`
// does (R20 a). Nothing here builds an id, a key, a stamp, a name or a record hash
// (R2): every value below is C2's, computed by C2's functions.

import {
  RECONSTRUCTION_RECORDED_BY,
  contentHashOfStored,
  contentHashOfWrite,
  decideFairnessMonth,
  isIntact,
  parseStoredFairnessMonth,
  validateFairnessMonthWrite,
  type FairnessDecision,
  type FairnessIssue,
} from "../../app/utils/fairnessMonthWriteRequest";
import type { FairnessMonthBody, LogicalRecord } from "../../app/utils/fairnessVocabulary";
import type { ReconstructionBody } from "./reconstructTypes";

/** C2 WR-14's fixed, non-member marker; the executor refuses any other for this actor. */
export const RECORDED_BY = RECONSTRUCTION_RECORDED_BY;

/** IF2-18 with actor `reconstruction` and the run's one CDMX month (spec Interfaces 2). */
export function validateReconstructionBody(
  body: ReconstructionBody,
  currentMonth: string,
): { ok: true } | { ok: false; issues: FairnessIssue[] } {
  const checked = validateFairnessMonthWrite(body, "reconstruction", currentMonth);
  return checked.ok ? { ok: true } : { ok: false, issues: checked.issues };
}

/** IF2-19 of a body — the planned `contentHash` (a body's `expectedRev` never enters it). */
export function hashOfBody(body: FairnessMonthBody): string {
  return contentHashOfWrite(body.month, body);
}

/** IF2-20. A refusal is a malformed read (R3: exit 1, nothing written). */
export function parseRecord(doc: unknown): { ok: true; record: LogicalRecord } | { ok: false; issues: FairnessIssue[] } {
  const parsed = parseStoredFairnessMonth(doc);
  return parsed.ok ? { ok: true, record: parsed.record } : { ok: false, issues: parsed.issues };
}

/** What IF2-21 needs about a stored record, read the way the executor's own re-read reads it (WR-7). */
export interface StoredSummary {
  /** As read — never built (R2). */
  id: string;
  rev: string;
  source: string;
  contentHash: string;
  /** IF2-19's `contentHashOfStored` — computable on a record the parser refuses (R18). */
  recomputedHash: string;
  intact: boolean;
}

export function summarizeStored(doc: Record<string, unknown>): StoredSummary {
  return {
    id: String(doc._id ?? ""),
    rev: String(doc._rev ?? ""),
    source: String(doc.source ?? ""),
    contentHash: String(doc.contentHash ?? ""),
    recomputedHash: contentHashOfStored(doc),
    intact: isIntact(doc),
  };
}

const facts = (stored: StoredSummary | null) =>
  stored
    ? { rev: stored.rev, source: stored.source as LogicalRecord["source"], contentHash: stored.contentHash, intact: stored.intact }
    : null;

/** IF2-21 for a write entry — the very function the executor re-runs at write time (R14). */
export function decideWrite(input: {
  month: string;
  currentMonth: string;
  bodyHash: string;
  stored: StoredSummary | null;
  freezing: number;
}): FairnessDecision {
  return decideFairnessMonth({
    actor: "reconstruction",
    op: "write",
    month: input.month,
    currentMonth: input.currentMonth,
    expectedRev: input.stored ? input.stored.rev : null,
    bodyHash: input.bodyHash,
    stored: facts(input.stored),
    hasFreezingServices: input.freezing > 0,
  });
}

/** IF2-21 for a delete (R18; WR-14 D1–D4). */
export function decideDelete(input: { month: string; currentMonth: string; stored: StoredSummary | null }): FairnessDecision {
  return decideFairnessMonth({
    actor: "reconstruction",
    op: "delete",
    month: input.month,
    currentMonth: input.currentMonth,
    expectedRev: input.stored ? input.stored.rev : null,
    bodyHash: null,
    stored: facts(input.stored),
    hasFreezingServices: false,
  });
}
````

**Create** `scripts/lib/reconstructPlanFile.ts`:

````ts
// scripts/lib/reconstructPlanFile.ts
//
// R15 and R18's plan file (solver v3 C4): the canonical serialization, the digests
// of the inputs the run read, the fingerprint the consent attaches to, and the
// backups' bytes. Deterministic (R17): object keys in codepoint order, every list
// already sorted by the code that built it, the generation time outside the
// fingerprint. A fingerprint or a digest is never a record hash (R2): a record's
// `contentHash` is C2's alone, computed through `reconstructDecide.ts`.

import { createHash } from "node:crypto";

import { normalizeMinistries } from "../../app/ministries";
import { countsForFairness } from "../../app/utils/countsForFairness";
import type { LedgerService } from "../../app/utils/fairnessLedger";
import { compareCodepoint, type TabKey } from "../../app/utils/fairnessVocabulary";
import type { Anomaly, Correction, MonthAction, ReconstructionBody, RollbackAction, RosterRow } from "./reconstructTypes";

export const PLAN_KIND = "owt-fairness-reconstruction-plan";
export const PLAN_VERSION = 1;

/** JSON with object keys in codepoint order at every level; `undefined` members dropped; arrays kept as built. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort(compareCodepoint);
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

/** The same content indented for a human reader — still deterministic. */
export function canonicalPretty(value: unknown): string {
  return `${JSON.stringify(JSON.parse(canonicalJson(value)), null, 2)}\n`;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export const hashText = (text: string): string => `sha256:${sha256Hex(text)}`;

/** A backup's bytes (R18): the stored document exactly as read, canonical and indented. */
export function backupText(doc: Record<string, unknown>): string {
  return canonicalPretty(doc);
}

/**
 * R15's service-input digest: every role document read inside the join and preview
 * windows, projected to `_id`, `_type`, stored date, effective «cuenta» flag (C1) and
 * the voice seat references in stored order, sorted by `_id`. No `_rev`, `_updatedAt`,
 * `published`, `time`, instrument or FOH seat: publishing a draft or touching an
 * instrument changes nothing (R17).
 */
export function serviceInputDigest(services: readonly LedgerService[]): string {
  const rows = [...services]
    .sort((a, b) => compareCodepoint(a._id, b._id))
    .map((s) => ({
      _id: s._id,
      _type: s._type,
      date: s.date,
      counted: countsForFairness(s),
      Lead: s.Lead,
      BGVs: s.BGVs,
      Chorus: s.Chorus,
    }));
  return hashText(canonicalJson(rows));
}

/**
 * The member-input digest — a plan decision beyond R15's list, so R15's acceptance
 * («one `unavailableDates` entry inside a requested or preview month makes --apply
 * refuse») holds for a preview-only month too: each worship member's id, names,
 * Tipo, ministries and stored `unavailableDates` inside the run's months.
 */
export function memberInputDigest(roster: readonly RosterRow[], months: readonly string[]): string {
  const inMonths = new Set(months);
  const rows = [...roster]
    .sort((a, b) => compareCodepoint(a._id, b._id))
    .map((m) => ({
      _id: m._id,
      member_name: m.member_name ?? null,
      alias: m.alias ?? null,
      memberType: [...(m.memberType ?? [])].sort(compareCodepoint),
      ministries: normalizeMinistries(m.ministries),
      unavailableDates: [
        ...new Set(
          (m.unavailableDates ?? [])
            .map((d) => (typeof d === "string" ? d.slice(0, 10) : ""))
            .filter((d) => inMonths.has(d.slice(0, 7))),
        ),
      ].sort(compareCodepoint),
    }));
  return hashText(canonicalJson(rows));
}

export interface WriteMonthPlan {
  month: string;
  action: MonthAction;
  /** The full planned body (null only for «sin servicios guardados»). */
  body: ReconstructionBody | null;
  bodyHash: string | null;
  corrections: Correction[];
  existing: { id: string; rev: string; source: string; contentHash: string } | null;
  /** «reemplazar» only (R18): the backup beside this plan, and its bytes' hash. */
  backup: { file: string; hash: string } | null;
}

export interface WritePlanContent {
  mode: "write";
  inputs: { months: string[]; previewRun: string; overridesHash: string };
  months: WriteMonthPlan[];
  anomalies: Anomaly[];
  preview: {
    run: string;
    sources: Array<{ month: string; from: "planned" | "stored" | "none" }>;
    /** member id → tab → hundredths: the figures Frank reviewed (R15). */
    figures: Record<string, Partial<Record<TabKey, { share: number; received: number; balance: number }>>>;
  };
  serviceDigest: string;
  memberDigest: string;
}

export interface RollbackMonthPlan {
  month: string;
  action: RollbackAction;
  stored: { id: string; rev: string; source: string; contentHash: string; recomputedHash: string } | null;
  backup: { file: string; hash: string } | null;
}

export interface RollbackPlanContent {
  mode: "rollback";
  inputs: { months: string[] };
  months: RollbackMonthPlan[];
}

export type PlanContent = WritePlanContent | RollbackPlanContent;

export interface PlanFile {
  kind: typeof PLAN_KIND;
  version: typeof PLAN_VERSION;
  /** Printed, never hashed (R17). */
  generatedAt: string;
  fingerprint: string;
  content: PlanContent;
}

/** The fingerprint the consent attaches to (R15, R18): SHA-256 of the canonical content. */
export function fingerprintOf(content: PlanContent): string {
  return sha256Hex(canonicalJson(content));
}

export function serializePlan(content: PlanContent, generatedAt: string): string {
  const file: PlanFile = { kind: PLAN_KIND, version: PLAN_VERSION, generatedAt, fingerprint: fingerprintOf(content), content };
  return canonicalPretty(file);
}

export function parsePlanFile(text: string): { ok: true; plan: PlanFile } | { ok: false; reason: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "el plan no es JSON válido" };
  }
  const file = raw as Partial<PlanFile> | null;
  if (
    !file ||
    typeof file !== "object" ||
    file.kind !== PLAN_KIND ||
    file.version !== PLAN_VERSION ||
    typeof file.fingerprint !== "string" ||
    !file.content ||
    typeof file.content !== "object"
  ) {
    return { ok: false, reason: "no es un plan de esta herramienta" };
  }
  if (fingerprintOf(file.content) !== file.fingerprint) {
    return { ok: false, reason: "el plan cambió después de escribirse: su huella no coincide con su contenido" };
  }
  return { ok: true, plan: file as PlanFile };
}

/** Where re-derived content differs from the plan (R15, R18) — name-free paths only. */
export function planDifferences(planned: PlanContent, live: PlanContent): string[] {
  const a = planned as unknown as Record<string, unknown>;
  const b = live as unknown as Record<string, unknown>;
  const out: string[] = [];
  for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort(compareCodepoint)) {
    const left = a[key];
    const right = b[key];
    if (key === "months" && Array.isArray(left) && Array.isArray(right)) {
      for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
        if (canonicalJson(left[i] ?? null) === canonicalJson(right[i] ?? null)) continue;
        const month = (left[i] as { month?: string } | undefined)?.month ?? (right[i] as { month?: string } | undefined)?.month ?? "?";
        out.push(`months[${i}] (${month})`);
      }
    } else if (canonicalJson(left ?? null) !== canonicalJson(right ?? null)) {
      out.push(key);
    }
  }
  return out;
}
````

- [ ] **Step 4: Run them to see them pass**

Run: `git add -A && npx vitest run scripts/__tests__/reconstructPlanFile.test.ts app/utils/__tests__/serviceCommitCallers.test.ts app/utils/__tests__/protectedReadAudit.test.ts`
Expected: PASS — the pin finds exactly the three importers; the audit flags nothing new (`reconstructDecide.ts` neither creates a client nor calls the executor).

- [ ] **Step 5: Gates and commit**

Run: `git add -A && npx tsc --noEmit && npm test && npx eslint .`
Expected: all green (on the replay base `a35f812e`: **471 files / 8707 tests**, 81 warnings); 0 errors; warnings at baseline.

```bash
git add -A
git commit -m "feat(fairness): the reconstruction's gateway to C2's writer, and its plan file" -m "Solver v3 C4 R2, R14, R15, R17, R18, R20 b. One scripts/lib module imports C2's write-request module and re-exposes its validator, content hash, stored-record parser and write decision for actor reconstruction, so the dry run plans each month with the function the executor re-runs and builds no id, key, stamp or record hash of its own; the importer pin lists it. The plan file is canonical JSON whose fingerprint covers the planned bodies, the stored revisions, the backups' hashes and digests of every service and member input the run read, and leaves out only the generation time."
```

---
## Task 4: What each record says — R4 pools, R5 join bounds, R6 cadence, R8 corrections — **[CRITICAL slice: the content of every record the script can write]**

Spec R4 (Tipo today as hypothetical ticks; today's rules unaltered — «Plan decisions», first row), R5 (join months from C2's record-free seat step only; exact rules stay whole), R6 (the cadence line is never join-bounded; cases a/b/c), R8 (corrections win; the replacement rule; adding a person; blocked dates merge), R9 (the month's stored dates only), R13 (resolver and validator refusals, by ordinal), Interfaces 3's order. No seat is counted here.

**Files:**
- Create: `scripts/lib/reconstructInference.ts`
- Test: `scripts/__tests__/reconstructInference.test.ts`

**Interfaces:**
- Consumes: `memberFitsPool`, `memberFitsRoleKey`, `rolesOfPatternV3`, `type SolverConfig` (`app/components/admin/plannerModel.ts` **[verified c2-t10]**); `countsForFairness` (C1); `resolveMonthEligibility`, `type EligibilityResult` (**[verified a35f812e]**); `keepVoiceSeats`, `civilDayOfWeek`, `type LedgerService` (IF2-11/IF2-10 **[verified c2-t10]**); `ROLE_KEYS`, `ROLE_LINE`, `canonicalRoles`, `compareCodepoint` (IF2-1); `isValidServiceDate`; `serviceDayKey`; `resolveRulePersonId`, `type RosterMember` (C3 `app/utils/sundayCadence.ts`); Task 2's `MemberOverride`, `ALL_MONTHS` and types; Task 3's `validateReconstructionBody` (tests).
- Produces: `hypotheticalConfig(config: SolverConfig, roster: readonly RosterRow[]): SolverConfig`; `toLedgerServices(rows: unknown): LedgerService[]` (throws `ReadFailure("services")`); `type SeatJoins = Map<string, Partial<Record<Line, { month: string; firstSeatDate: string }>>>`; `seatJoinMonths(joinWindow: readonly LedgerService[]): SeatJoins`; `interface CountedDay { id; date; sunday; weekend }`; `countedServiceDays(services: readonly LedgerService[]): CountedDay[]`; `interface TransformResult { body; cells; corrections; joins; anomalies; refusals }`; `transformMonth(input: { month; body: FairnessMonthBody; roster; seatJoins; overrides }): TransformResult`; `resolverRefusals(result, config, roster, month): RunRefusal[]`; `rulesNaming(config, person, reason): Array<{ ordinal: string; key: string }>`; `validatorRefusal(month, body, issues, overrides): RunRefusal`; `dedupeRefusals(list): RunRefusal[]`.

- [ ] **Step 1: Write the failing test**

**Create** `scripts/__tests__/reconstructInference.test.ts`:

````ts
// Solver v3 C4 R4–R9 and R13's refusal mapping, over C2's REAL resolver (IF2-15) and
// record-free seat step (IF2-11) and C2's validator (IF2-18). Every name is fictitious.
import { describe, expect, it } from "vitest";

import type { PersonRestriction, RestrictionCap, SolverConfig } from "@/app/components/admin/plannerModel";
import { resolveMonthEligibility } from "@/app/utils/fairnessEligibility";
import type { LedgerService } from "@/app/utils/fairnessLedger";
import type { FairnessMonthBody, RoleKey, Status } from "@/app/utils/fairnessVocabulary";
import { validateReconstructionBody } from "../lib/reconstructDecide";
import {
  hypotheticalConfig,
  resolverRefusals,
  seatJoinMonths,
  toLedgerServices,
  transformMonth,
  validatorRefusal,
} from "../lib/reconstructInference";
import { parseOverrides, type MemberOverride } from "../lib/reconstructOverrides";
import type { RosterRow } from "../lib/reconstructTypes";

const OUT: Record<RoleKey, Status> = {
  "Sun.Lead": "out",
  "Sat.Lead": "out",
  "Sun.BGV": "out",
  "Sat.BGV": "out",
  "Sun.Choir": "out",
  "Sat.Choir": "out",
};
const ANA: RosterRow = { _id: "m-ana", member_name: "Ana Ejemplo", memberType: ["voz", "sunday_lead"] };
const BETO: RosterRow = { _id: "m-beto", member_name: "Beto Ejemplo", memberType: ["voz", "sunday_lead"], ministries: ["worship"] };
const CARLA: RosterRow = { _id: "m-carla", member_name: "Carla Ejemplo", memberType: ["voz", "support"], ministries: [] };
const DANI: RosterRow = { _id: "kidsMember-dani", member_name: "Dani Ejemplo", memberType: ["voz", "sunday_lead"], ministries: ["kids", "worship"] };
const FAUSTO: RosterRow = { _id: "m-fausto", member_name: "Fausto Ejemplo", memberType: ["sunday_lead"], unavailableDates: ["2026-09-20", "2026-08-30"] };
const IVAN: RosterRow = { _id: "m-ivan", member_name: "Iván Ejemplo", memberType: ["voz", "saturday_lead"] };
const ROSTER = [ANA, BETO, CARLA, DANI, FAUSTO, IVAN];

const restriction = (id: string, person: string, patch: Partial<PersonRestriction> = {}): PersonRestriction => ({
  id,
  person,
  excludedPatterns: [],
  fairness: "none",
  fairnessSlack: 1,
  weekExclusions: [],
  caps: [],
  ...patch,
});
const cap = (id: string, pattern: string, value: number, patch: Partial<RestrictionCap> = {}): RestrictionCap => ({
  id,
  pattern,
  op: "==",
  value,
  relative: false,
  relOffset: 0,
  ...patch,
});
const config = (patch: Partial<SolverConfig> = {}): SolverConfig => ({
  sundayLeads: [],
  saturdayLeads: [],
  support: [],
  restrictions: [],
  conflicts: [],
  presence: [],
  ...patch,
});
const svc = (
  id: string,
  type: LedgerService["_type"],
  date: string,
  seats: Partial<Pick<LedgerService, "Lead" | "BGVs" | "Chorus">>,
  extra: Partial<LedgerService> = {},
): LedgerService => ({ _id: id, _type: type, date, Lead: [], BGVs: [], Chorus: [], ...seats, ...extra });

const resolved = (month: string, cfg: SolverConfig, roster: RosterRow[] = ROSTER): FairnessMonthBody => {
  const r = resolveMonthEligibility({ month, config: hypotheticalConfig(cfg, roster), members: roster });
  if (!r.ok) throw new Error(`resolver refused: ${JSON.stringify(r)}`);
  return r.body;
};
const corrections = (doc: unknown, roster: RosterRow[] = ROSTER): MemberOverride[] => {
  const parsed = parseOverrides(JSON.stringify(doc), new Set(roster.map((m) => m._id)));
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.refusals));
  return parsed.overrides.members;
};
const transform = (month: string, cfg: SolverConfig, services: LedgerService[], o: MemberOverride[] = [], roster: RosterRow[] = ROSTER) =>
  transformMonth({ month, body: resolved(month, cfg, roster), roster, seatJoins: seatJoinMonths(services), overrides: o });
const person = (b: FairnessMonthBody, id: string) => {
  const found = b.people.find((p) => p.memberId === id);
  if (!found) throw new Error(`no item for ${id}`);
  return found;
};
const valid = (b: FairnessMonthBody) => validateReconstructionBody({ ...b, expectedRev: null }, "2026-10");

describe("R4 — Tipo today as hypothetical pool ticks; today's rules unaltered", () => {
  it("ticks every worship member whose current Tipo fits each pool, and passes every rule array through", () => {
    const cfg = config({ sundayLeads: ["m-carla"], restrictions: [restriction("d-ana", "Ana Ejemplo", { excludedPatterns: ["Sat.*"] })] });
    const hypothetical = hypotheticalConfig(cfg, ROSTER);
    expect(hypothetical.sundayLeads).toEqual(["kidsMember-dani", "m-ana", "m-beto"]);
    expect(hypothetical.saturdayLeads).toEqual(["m-ivan"]);
    expect(hypothetical.support).toEqual(["m-carla"]);
    expect(hypothetical.restrictions).toBe(cfg.restrictions);
    expect(hypothetical.conflicts).toBe(cfg.conflicts);
    expect(hypothetical.presence).toBe(cfg.presence);
  });

  it("gives exactly C2's resolver statuses for those ticks, before R5–R8 — and nobody without voz", () => {
    const b = resolved("2026-08", config({ restrictions: [restriction("d-ana", "Ana Ejemplo", { excludedPatterns: ["Sat.*"] })] }));
    expect(person(b, "m-ana").roles).toEqual({ ...OUT, "Sun.Lead": "in", "Sun.BGV": "in", "Sun.Choir": "in" });
    expect(person(b, "m-carla").roles).toEqual({ ...OUT, "Sun.BGV": "in", "Sat.BGV": "in", "Sun.Choir": "in", "Sat.Choir": "in" });
    expect(b.people.map((p) => p.memberId)).not.toContain("m-fausto");
  });
});

describe("IF2-26 rows → IF2-10 services", () => {
  it("keeps non-empty references in stored order, drops a row with no valid date, refuses a non-list", () => {
    expect(
      toLedgerServices([
        { _id: "sun-1", _type: "sunday_role", date: "2026-08-02", time: null, published: false, countsForFairness: true, Lead: ["m-ana", null, ""], BGVs: null, Chorus: ["m-beto"] },
        { _id: "sun-2", _type: "sunday_role", date: "no es fecha", countsForFairness: true, Lead: [], BGVs: [], Chorus: [] },
      ]),
    ).toEqual([{ _id: "sun-1", _type: "sunday_role", date: "2026-08-02", published: false, countsForFairness: true, Lead: ["m-ana"], BGVs: [], Chorus: ["m-beto"] }]);
    expect(() => toLedgerServices({ rows: [] })).toThrow(/read failed: services/);
  });
});

describe("R5 — seats may only delay a line's start", () => {
  const seats = [
    svc("sun-0906", "sunday_role", "2026-09-06", { Lead: ["m-ana"] }),
    svc("sun-0913", "sunday_role", "2026-09-13", { BGVs: ["m-carla"] }),
  ];

  it("keeps a newcomer out of BGV before her first BGV seat, and in from that month", () => {
    const august = transform("2026-08", config(), seats);
    const september = transform("2026-09", config(), seats);
    expect(person(august.body, "m-carla").roles["Sun.BGV"]).toBe("out");
    expect(august.cells.get("m-carla")!["Sun.BGV"]).toEqual({ reason: "linea", corrected: false });
    expect(person(september.body, "m-carla").roles).toMatchObject({ "Sun.BGV": "in", "Sat.BGV": "in", "Sun.Choir": "out" });
    expect(september.joins.get("m-carla")).toEqual({ BGV: "2026-09" });
  });

  it("never makes anyone eligible: a seat held while a rule says out stays out", () => {
    const cfg = config({ restrictions: [restriction("d-ana", "Ana Ejemplo", { excludedPatterns: ["Sat.*"] })] });
    const t = transform("2026-08", cfg, [svc("sat-0801", "saturday_role", "2026-08-01", { BGVs: ["m-ana"] })]);
    expect(person(t.body, "m-ana").roles["Sat.BGV"]).toBe("out");
  });

  it("sets no join month from a second seat, a duplicated weekend document or an uncounted special", () => {
    const joins = seatJoinMonths([
      svc("sun-0802", "sunday_role", "2026-08-02", { Lead: ["m-carla"], BGVs: ["m-carla"] }),
      svc("sun-0816-a", "sunday_role", "2026-08-16", { BGVs: ["m-ana"] }),
      svc("sun-0816-b", "sunday_role", "2026-08-16", {}),
      svc("spe-0830", "special_role", "2026-08-30", { Chorus: ["m-ana"] }),
      svc("spe-0809", "special_role", "2026-08-09", { Chorus: ["m-carla"] }, { countsForFairness: true }),
    ]);
    expect(joins.get("m-carla")).toEqual({
      DL: { month: "2026-08", firstSeatDate: "2026-08-02" },
      CORO: { month: "2026-08", firstSeatDate: "2026-08-09" },
    });
    expect(joins.get("m-ana")).toBeUndefined();
  });

  it("keeps exact rules whole: a cut rule is removed and its joined role becomes in, with the anomaly", () => {
    const cfg = config({ restrictions: [restriction("r1", "Ana Ejemplo", { caps: [cap("c1", "Sun.*", 2)] })] });
    const t = transform("2026-08", cfg, [
      svc("sun-0705", "sunday_role", "2026-07-05", { Lead: ["m-ana"] }),
      svc("sun-0712", "sunday_role", "2026-07-12", { BGVs: ["m-ana"] }),
    ]);
    const ana = person(t.body, "m-ana");
    expect(ana.exactRules).toEqual([]);
    expect(ana.roles).toMatchObject({ "Sun.Lead": "in", "Sun.BGV": "in", "Sun.Choir": "out" });
    expect(t.cells.get("m-ana")!["Sun.Lead"]).toEqual({ reason: "partida", corrected: false });
    expect(t.anomalies).toEqual([{ code: "rule_split", month: "2026-08", memberId: "m-ana", roles: ["Sun.Lead", "Sun.BGV"] }]);
    expect(valid(t.body)).toEqual({ ok: true });
  });
});

describe("R6 — the cadence setting applied, never inferred", () => {
  const cadence = restriction("c9p4", "Dani Ejemplo", { sundayCadence: "alternate" });

  it("records in + alternate for Sun.Lead in every month without a DL seat, and bounds her other lines", () => {
    const seats = [svc("sun-0719", "sunday_role", "2026-07-19", { Lead: ["kidsMember-dani"] })];
    for (const month of ["2026-06", "2026-07", "2026-08"]) {
      const dani = person(transform(month, config({ restrictions: [cadence] }), seats).body, "kidsMember-dani");
      expect(dani.roles["Sun.Lead"]).toBe("in");
      expect(dani.sundayCadence).toBe("alternate");
      expect(dani.roles["Sun.BGV"]).toBe("out");
    }
  });

  it("keeps the setting on someone whose Sun.Lead is out, as the resolver returns it", () => {
    const t = transform("2026-08", config({ restrictions: [restriction("c9p4", "Dani Ejemplo", { sundayCadence: "alternate", excludedPatterns: ["Sun.Lead"] })] }), []);
    expect(person(t.body, "kidsMember-dani")).toMatchObject({ sundayCadence: "alternate", roles: OUT });
  });

  it("case (a): the setting beside Sun.Lead == 2 in today's rules refuses through the resolver, named by ordinals", () => {
    const cfg = config({ restrictions: [restriction("c9p4", "Dani Ejemplo", { sundayCadence: "alternate", caps: [cap("c9c", "Sun.Lead", 2)] })] });
    const r = resolveMonthEligibility({ month: "2026-08", config: hypotheticalConfig(cfg, ROSTER), members: ROSTER });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(resolverRefusals(r, cfg, ROSTER, "2026-08")).toContainEqual(
      expect.objectContaining({
        reason: "cadence_and_exact",
        kind: "mes por medio",
        person: "Dani Ejemplo",
        memberIds: ["kidsMember-dani"],
        rules: [
          { ordinal: "restricción 1 de 1", key: "c9p4" },
          { ordinal: "restricción 1 de 1, tope 1", key: "c9c" },
        ],
      }),
    );
  });

  it("case (b): «alternate» from the corrections file beside a rules-side Sun.Lead == 2 fails the validator", () => {
    const cfg = config({ restrictions: [restriction("x1", "Ana Ejemplo", { caps: [cap("x1c", "Sun.Lead", 2)] })] });
    const file = corrections({ schemaVersion: 1, members: { "m-ana": { sundayCadence: "alternate" } } });
    const t = transform("2026-08", cfg, [], file);
    const checked = valid(t.body);
    expect(checked.ok).toBe(false);
    if (checked.ok) return;
    expect(validatorRefusal("2026-08", t.body, checked.issues, file)).toMatchObject({
      reason: "invalid_body",
      kind: "corrección",
      rules: [{ ordinal: "entrada 1 del archivo", key: null }],
      memberIds: ["m-ana"],
    });
  });

  it("case (c): «alternate» plus Sun.Lead in replaces a v2-only Sun.Lead == 2, marked corregido, and passes", () => {
    const cfg = config({ restrictions: [restriction("x1", "Ana Ejemplo", { caps: [cap("x1c", "Sun.Lead", 2)] })] });
    const file = corrections({ schemaVersion: 1, members: { "m-ana": { sundayCadence: "alternate", months: { "*": { roles: { "Sun.Lead": "in" } } } } } });
    const t = transform("2026-08", cfg, [], file);
    const ana = person(t.body, "m-ana");
    expect(ana).toMatchObject({ sundayCadence: "alternate", exactRules: [] });
    expect(ana.roles["Sun.Lead"]).toBe("in");
    expect(t.cells.get("m-ana")!["Sun.Lead"]).toEqual({ reason: "correccion", corrected: true });
    expect(valid(t.body)).toEqual({ ok: true });
  });

  it("«normal» removes the setting, and the DL line is then join-bounded", () => {
    const file = corrections({ schemaVersion: 1, members: { "kidsMember-dani": { sundayCadence: "normal" } } });
    const dani = person(transform("2026-08", config({ restrictions: [cadence] }), [], file).body, "kidsMember-dani");
    expect(dani.sundayCadence).toBeUndefined();
    expect(dani.roles["Sun.Lead"]).toBe("out");
  });
});

describe("R8 — corrections win, and replace exact rules whole (A38)", () => {
  const seated = [svc("sun-0705", "sunday_role", "2026-07-05", { BGVs: ["m-beto"] })];

  it("replaces today's Sun.BGV == 1 with Sun.BGV == 2: exactly one exact rule for Sun.BGV", () => {
    const cfg = config({ restrictions: [restriction("r7k2", "Beto Ejemplo", { caps: [cap("c1q9", "Sun.BGV", 1)] })] });
    const file = corrections({ schemaVersion: 1, members: { "m-beto": { months: { "2026-08": { exactRules: [{ roles: ["Sun.BGV"], count: 2 }] } } } } });
    const t = transform("2026-08", cfg, seated, file);
    expect(person(t.body, "m-beto").exactRules).toEqual([{ roles: ["Sun.BGV"], count: 2 }]);
    expect(t.corrections).toEqual([{ memberId: "m-beto", field: "Sun.BGV" }]);
    expect(valid(t.body)).toEqual({ ok: true });
  });

  it("refuses a correction on one role of a two-role rule that does not restate the other", () => {
    const cfg = config({ restrictions: [restriction("r7k2", "Beto Ejemplo", { caps: [cap("c1q9", "*.BGV", 2)] })] });
    const file = corrections({ schemaVersion: 1, members: { "m-beto": { months: { "2026-08": { roles: { "Sun.BGV": "out" } } } } } });
    expect(transform("2026-08", cfg, seated, file).refusals).toEqual([
      expect.objectContaining({
        reason: "replacement_incomplete",
        kind: "corrección",
        rules: [{ ordinal: "entrada 1 del archivo", key: null }],
        month: "2026-08",
        memberIds: ["m-beto"],
      }),
    ]);
  });

  it("adds a worship member without voz when a correction sets one of her roles, with her month's stored dates", () => {
    const file = corrections({ schemaVersion: 1, members: { "m-fausto": { months: { "2026-09": { roles: { "Sun.BGV": "in" } } } } } });
    const t = transform("2026-09", config(), [], file);
    expect(person(t.body, "m-fausto")).toEqual({
      memberId: "m-fausto",
      roles: { ...OUT, "Sun.BGV": "in" },
      exactRules: [],
      exempt: false,
      blocks: [{ date: "2026-09-20", unavailable: true, excludedRoles: [] }],
    });
    expect(t.anomalies).toContainEqual({ code: "person_added", month: "2026-09", memberId: "m-fausto" });
    expect(t.corrections).toEqual([
      { memberId: "m-fausto", field: "Sun.BGV" },
      { memberId: "m-fausto", field: "added" },
    ]);
    expect(valid(t.body)).toEqual({ ok: true });
  });

  it("adds nobody for a correction that sets no role, and lets a correction win over a join bound", () => {
    const file = corrections({ schemaVersion: 1, members: { "m-fausto": { exempt: true }, "m-carla": { joinMonths: { BGV: "2026-07" } } } });
    const t = transform("2026-08", config(), [svc("sun-0913", "sunday_role", "2026-09-13", { BGVs: ["m-carla"] })], file);
    expect(t.body.people.map((p) => p.memberId)).not.toContain("m-fausto");
    expect(person(t.body, "m-carla").roles["Sun.BGV"]).toBe("in");
    expect(t.joins.get("m-carla")).toEqual({ BGV: "2026-07" });
  });

  it("merges a blocked-date correction into an existing week-exclusion block", () => {
    const cfg = config({ restrictions: [restriction("w3x8", "Iván Ejemplo", { weekExclusions: [{ id: "e5m1", week: 2, pattern: "Sat.*" }] })] });
    const file = corrections({ schemaVersion: 1, members: { "m-ivan": { blockedDates: [{ date: "2026-08-08", roles: ["Sun.BGV"] }, { date: "2026-08-15" }] } } });
    const t = transform("2026-08", cfg, [svc("sat-0711", "saturday_role", "2026-07-11", { Lead: ["m-ivan"] })], file);
    expect(person(t.body, "m-ivan").blocks).toEqual([
      { date: "2026-08-08", unavailable: false, excludedRoles: ["Sat.Lead", "Sun.BGV", "Sat.BGV", "Sat.Choir"] },
      { date: "2026-08-15", unavailable: true, excludedRoles: [] },
    ]);
    expect(t.corrections).toContainEqual({ memberId: "m-ivan", field: "blocks" });
    expect(valid(t.body)).toEqual({ ok: true });
  });
});

describe("R9 — availability is the month's stored dates", () => {
  it("never lets a date outside the month into it", () => {
    const beto: RosterRow = { ...BETO, unavailableDates: ["2026-07-26", "2025-12-25", "2026-08-02"] };
    const t = transform("2026-07", config(), [svc("sun-0705", "sunday_role", "2026-07-05", { Lead: ["m-beto"] })], [], [ANA, beto, CARLA, DANI, FAUSTO, IVAN]);
    expect(person(t.body, "m-beto").blocks).toEqual([{ date: "2026-07-26", unavailable: true, excludedRoles: [] }]);
  });
});

describe("R13 — resolver refusals, by ordinal", () => {
  const refusalsOf = (cfg: SolverConfig, roster: RosterRow[] = ROSTER) => {
    const r = resolveMonthEligibility({ month: "2026-08", config: hypotheticalConfig(cfg, roster), members: roster });
    if (r.ok) throw new Error("expected a refusal");
    return resolverRefusals(r, cfg, roster, "2026-08");
  };

  it("names a presence issue by its config ordinal; the key stays for the report", () => {
    expect(refusalsOf(config({ presence: [{ id: "d-beto-carla", persons: ["Carla Ejemplo"], pattern: "Sun.BGV" }] }))).toContainEqual(
      expect.objectContaining({ reason: "presence_members", kind: "presencia", rules: [{ ordinal: "presencia 1 de 1", key: "d-beto-carla" }] }),
    );
  });

  it("names an out-of-range == cap by its restriction's ordinal plus its own position", () => {
    const cfg = config({ restrictions: [restriction("d-ana", "Ana Ejemplo", { caps: [cap("q1", "Sun.Lead", 1, { op: "<=" }), cap("q2", "Sun.BGV", 1.5)] })] });
    expect(refusalsOf(cfg)).toContainEqual(
      expect.objectContaining({
        reason: "exact_count_range",
        kind: "regla fija",
        rules: [{ ordinal: "restricción 1 de 1, tope 2", key: "q2" }],
        memberIds: ["m-ana"],
      }),
    );
  });

  it("names every rule that carries an unresolved name", () => {
    const cfg = config({
      restrictions: [restriction("r1", "Nadie Ejemplo")],
      conflicts: [{ id: "k1", personA: "Nadie Ejemplo", personB: "Ana Ejemplo", pattern: "Sun.Lead" }],
    });
    expect(refusalsOf(cfg)).toContainEqual(
      expect.objectContaining({
        reason: "unresolved",
        kind: "restricción",
        person: "Nadie Ejemplo",
        memberIds: [],
        rules: [
          { ordinal: "restricción 1 de 1", key: "r1" },
          { ordinal: "conflicto 1 de 1", key: "k1" },
        ],
      }),
    );
  });
});
````

- [ ] **Step 2: Run it to see it fail**

Run: `git add -A && npx vitest run scripts/__tests__/reconstructInference.test.ts`
Expected: FAIL — `../lib/reconstructInference` does not resolve.

- [ ] **Step 3: Implement**

**Create** `scripts/lib/reconstructInference.ts`:

````ts
// scripts/lib/reconstructInference.ts
//
// What each reconstructed record says (solver v3 C4 R4–R9), and how a refusal of C2's
// resolver or validator is reported (R13). Pure: no I/O.
//
// ORDER (spec Interfaces 3, C4's own):
//  (i)   C2's resolver (IF2-15) runs per month on a config whose THREE POOLS are R4's
//        hypothetical ticks — every worship member whose current Tipo fits the pool —
//        and whose restrictions, conflicts, presence and cadence settings are today's,
//        unaltered (D11; C2 §7.4's «as config» governs the rule set, C4 R4 the pools).
//        Any `ok: false` refuses the run; no correction can clear it.
//  (ii)  Only on `ok: true` does `transformMonth` change the body: R5's join bounds only
//        narrow it; R6–R8's corrections may widen a cell or add a person.
//  (iii) The caller runs C2's validator (IF2-18) on the result.
// No seat is counted here: join months read only C2's record-free seat step (IF2-11),
// so the join month and the ledger read the same seats.

import { memberFitsPool, memberFitsRoleKey, rolesOfPatternV3, type SolverConfig } from "../../app/components/admin/plannerModel";
import { countsForFairness } from "../../app/utils/countsForFairness";
import type { EligibilityResult } from "../../app/utils/fairnessEligibility";
import { civilDayOfWeek, keepVoiceSeats, type LedgerService } from "../../app/utils/fairnessLedger";
import { ROLE_KEYS, ROLE_LINE, canonicalRoles, compareCodepoint, type FairnessMonthBody, type RoleKey, type Status } from "../../app/utils/fairnessVocabulary";
import { isValidServiceDate } from "../../app/utils/serviceReadModel";
import { serviceDayKey } from "../../app/utils/serviceReadSelect";
import { resolveRulePersonId, type RosterMember } from "../../app/utils/sundayCadence";
import { ALL_MONTHS, type MemberOverride } from "./reconstructOverrides";
import {
  LINES,
  LINE_ROLES,
  ReadFailure,
  type Anomaly,
  type CellReason,
  type Correction,
  type Line,
  type PersonCells,
  type RefusalKind,
  type RosterRow,
  type RunRefusal,
} from "./reconstructTypes";

type Person = FairnessMonthBody["people"][number];

// ─── R4 ─────────────────────────────────────────────────────────────────────────

/** R4: the pools as Tipo today would tick them (C2 RES-1's effective-pool rule); every rule array is today's, by reference (D11). */
export function hypotheticalConfig(config: SolverConfig, roster: readonly RosterRow[]): SolverConfig {
  const fit = (field: "sundayLeads" | "saturdayLeads" | "support") =>
    roster
      .filter((m) => memberFitsPool(m, field))
      .map((m) => m._id)
      .sort(compareCodepoint);
  return { ...config, sundayLeads: fit("sundayLeads"), saturdayLeads: fit("saturdayLeads"), support: fit("support") };
}

// ─── Services and seats ─────────────────────────────────────────────────────────

const ROLE_TYPE_NAMES = ["sunday_role", "saturday_role", "special_role"];

/**
 * IF2-26 rows → IF2-10 `LedgerService`s. A row that is not an object, lacks a string
 * `_id` or carries another `_type` is a malformed read (R3). A row whose stored date
 * is not a calendar day is dropped — the ledger drops it too (LG-1). `date` is the
 * normalised `YYYY-MM-DD` (`serviceDayKey`, the C2 plan's date normaliser).
 */
export function toLedgerServices(rows: unknown): LedgerService[] {
  if (!Array.isArray(rows)) throw new ReadFailure("services");
  const refs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : []);
  const out: LedgerService[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new ReadFailure("services");
    const r = row as Record<string, unknown>;
    if (typeof r._id !== "string" || !ROLE_TYPE_NAMES.includes(String(r._type))) throw new ReadFailure("services");
    const day = serviceDayKey(r.date);
    if (day === null) continue;
    out.push({
      _id: r._id,
      _type: r._type as LedgerService["_type"],
      date: day,
      ...(typeof r.time === "string" ? { time: r.time } : {}),
      ...(typeof r.published === "boolean" ? { published: r.published } : {}),
      ...(typeof r.countsForFairness === "boolean" ? { countsForFairness: r.countsForFairness } : {}),
      Lead: refs(r.Lead),
      BGVs: refs(r.BGVs),
      Chorus: refs(r.Chorus),
    });
  }
  return out.sort((a, b) => compareCodepoint(a.date, b.date) || compareCodepoint(a._id, b._id));
}

export type SeatJoins = Map<string, Partial<Record<Line, { month: string; firstSeatDate: string }>>>;

/**
 * R5: per person and line, the month (and date) of the earliest KEPT seat at a counted
 * service in the join window — C2's IF2-11 `kept` only, so a second seat, a seat in a
 * duplicated weekend document or one in an uncounted service never sets a join month.
 */
export function seatJoinMonths(joinWindow: readonly LedgerService[]): SeatJoins {
  const joins: SeatJoins = new Map();
  for (const seat of keepVoiceSeats([...joinWindow]).kept) {
    const line = ROLE_LINE[seat.roleKey];
    const entry = joins.get(seat.memberId) ?? {};
    const prior = entry[line];
    if (!prior || seat.date < prior.firstSeatDate) entry[line] = { month: seat.date.slice(0, 7), firstSeatDate: seat.date };
    joins.set(seat.memberId, entry);
  }
  return joins;
}

export interface CountedDay {
  id: string;
  date: string;
  /** Sunday class: a `sunday_role`, or a counted special dated on a Sunday (C2 LG-4). */
  sunday: boolean;
  weekend: boolean;
}

/**
 * The counted services of a list, with their day class — composed from C1's read rule
 * and C2's exported seat step (its duplicate targets) and civil weekday; no second
 * rule. Used for R13's «first counted service of the line» and the presence check.
 */
export function countedServiceDays(services: readonly LedgerService[]): CountedDay[] {
  const dropped = new Set(keepVoiceSeats([...services]).duplicateTargets.flatMap((d) => d.roleIds));
  return services
    .filter((s) => !s._id.startsWith("drafts.") && !dropped.has(s._id) && countsForFairness(s))
    .map((s) => ({
      id: s._id,
      date: s.date,
      sunday: s._type === "sunday_role" || (s._type === "special_role" && civilDayOfWeek(s.date) === 0),
      weekend: s._type !== "special_role",
    }))
    .sort((a, b) => compareCodepoint(a.date, b.date) || compareCodepoint(a.id, b.id));
}

// ─── R5–R8 ──────────────────────────────────────────────────────────────────────

export interface TransformResult {
  /** The transformed body, people by member id, every list in canonical order. */
  body: FairnessMonthBody;
  /** Per person and role: the reason code and the «corregido» mark (R11). */
  cells: Map<string, PersonCells>;
  corrections: Correction[];
  /** Effective join month per line (seat-derived, or corrected) — the table's column. */
  joins: Map<string, Partial<Record<Line, string>>>;
  /** `rule_split` and `person_added` (R13). */
  anomalies: Anomaly[];
  /** `replacement_incomplete` (R8). */
  refusals: RunRefusal[];
}

const clonePerson = (p: Person): Person => ({
  memberId: p.memberId,
  roles: { ...p.roles },
  exactRules: p.exactRules.map((r) => ({ roles: [...r.roles], count: r.count })),
  ...(p.sundayCadence === "alternate" ? { sundayCadence: "alternate" as const } : {}),
  exempt: p.exempt,
  blocks: p.blocks.map((b) => ({ date: b.date, unavailable: b.unavailable, excludedRoles: [...b.excludedRoles] })),
});

const cellsOf = (reason: (k: RoleKey) => CellReason): PersonCells =>
  Object.fromEntries(ROLE_KEYS.map((k) => [k, { reason: reason(k), corrected: false }])) as PersonCells;

/** RES-4's block for each stored `unavailableDates` entry inside the month — for a person a correction adds (R8). */
function storedUnavailableBlocks(member: RosterRow, month: string): Person["blocks"] {
  const dates = new Set<string>();
  for (const raw of member.unavailableDates ?? []) {
    const date = typeof raw === "string" ? raw.slice(0, 10) : "";
    if (isValidServiceDate(date) && date.slice(0, 7) === month) dates.add(date);
  }
  return [...dates].sort(compareCodepoint).map((date) => ({ date, unavailable: true, excludedRoles: [] }));
}

export function transformMonth(input: {
  month: string;
  body: FairnessMonthBody;
  roster: readonly RosterRow[];
  seatJoins: SeatJoins;
  overrides: readonly MemberOverride[];
}): TransformResult {
  const { month } = input;
  const byId = new Map(input.roster.map((m) => [m._id, m]));
  const overrideOf = new Map(input.overrides.map((o) => [o.memberId, o]));
  const people = new Map(input.body.people.map((p) => [p.memberId, clonePerson(p)]));
  const cells = new Map<string, PersonCells>();
  const corrections: Correction[] = [];
  const anomalies: Anomaly[] = [];
  const refusals: RunRefusal[] = [];
  const joins = new Map<string, Partial<Record<Line, string>>>();

  const effectiveJoins = (memberId: string): Partial<Record<Line, string>> => {
    const seat = input.seatJoins.get(memberId) ?? {};
    const override = overrideOf.get(memberId);
    const out: Partial<Record<Line, string>> = {};
    for (const line of LINES) {
      const joined = override?.joinMonths[line] ?? seat[line]?.month;
      if (joined !== undefined) out[line] = joined;
    }
    return out;
  };
  const mark = (memberId: string, field: Correction["field"]) => {
    if (!corrections.some((c) => c.memberId === memberId && c.field === field)) corrections.push({ memberId, field });
  };

  // Reasons as Tipo and today's rules left each cell (R11), before any transform.
  for (const p of people.values()) {
    const member = byId.get(p.memberId);
    cells.set(
      p.memberId,
      cellsOf((k) => {
        if (!memberFitsRoleKey(member, k)) return "sin_tipo";
        return p.roles[k] === "exact" ? "fija" : p.roles[k] === "out" ? "regla" : "tipo";
      }),
    );
  }

  // R5 + R6 — join bounds only narrow; the cadence line is never join-bounded.
  for (const p of people.values()) {
    const override = overrideOf.get(p.memberId);
    const cadence = override?.sundayCadence ? override.sundayCadence === "alternate" : p.sundayCadence === "alternate";
    const effective = effectiveJoins(p.memberId);
    joins.set(p.memberId, effective);
    const personCells = cells.get(p.memberId)!;
    const cut = new Set<RoleKey>();
    for (const line of LINES) {
      if (line === "DL" && cadence) continue;
      const joined = effective[line];
      if (joined !== undefined && joined <= month) continue;
      for (const k of LINE_ROLES[line]) {
        if (p.roles[k] === "out") continue;
        p.roles[k] = "out";
        personCells[k] = { reason: "linea", corrected: false };
        cut.add(k);
      }
    }
    if (cut.size === 0) continue;
    const kept: Person["exactRules"] = [];
    for (const rule of p.exactRules) {
      if (!rule.roles.some((k) => cut.has(k))) {
        kept.push(rule);
        continue;
      }
      // «Exact rules stay whole»: the cut removes the rule for this month; a joined role it also covered is plainly "in".
      const freed = rule.roles.filter((k) => !cut.has(k) && p.roles[k] === "exact");
      for (const k of freed) {
        p.roles[k] = "in";
        personCells[k] = { reason: "partida", corrected: false };
      }
      if (freed.length > 0) anomalies.push({ code: "rule_split", month, memberId: p.memberId, roles: canonicalRoles(freed) });
    }
    p.exactRules = kept;
  }

  // R6–R8 — Frank's corrections win over every inferred value.
  for (const o of input.overrides) {
    const entry = o.months[month] ?? o.months[ALL_MONTHS];
    const setsRole = !!entry && (Object.keys(entry.roles).length > 0 || entry.exactRules.length > 0);
    let p = people.get(o.memberId);
    if (!p) {
      const member = byId.get(o.memberId);
      if (!setsRole || !member) continue;
      // «Adding a person»: a worship member the resolver did not list (no `voz` today).
      p = {
        memberId: o.memberId,
        roles: Object.fromEntries(ROLE_KEYS.map((k) => [k, "out"])) as Record<RoleKey, Status>,
        exactRules: [],
        exempt: false,
        blocks: storedUnavailableBlocks(member, month),
      };
      people.set(o.memberId, p);
      cells.set(o.memberId, cellsOf(() => "sin_tipo"));
      joins.set(o.memberId, effectiveJoins(o.memberId));
      anomalies.push({ code: "person_added", month, memberId: o.memberId });
      mark(o.memberId, "added");
    }
    const personCells = cells.get(o.memberId)!;
    if (entry) {
      // The replacement rule (A38): a correction that sets a role replaces, whole, every
      // exact rule covering it; each other role such a rule covers must be set too.
      const setRoles = new Set<RoleKey>([...(Object.keys(entry.roles) as RoleKey[]), ...entry.exactRules.flatMap((r) => r.roles)]);
      const remaining: Person["exactRules"] = [];
      for (const rule of p.exactRules) {
        if (!rule.roles.some((k) => setRoles.has(k))) {
          remaining.push(rule);
          continue;
        }
        const missing = rule.roles.filter((k) => !setRoles.has(k));
        if (missing.length > 0) {
          refusals.push({
            reason: "replacement_incomplete",
            kind: "corrección",
            rules: [{ ordinal: `entrada ${o.ordinal} del archivo`, key: null }],
            month,
            memberIds: [o.memberId],
            detail: `La corrección cambia un rol que una regla fija de hoy cubre junto con ${missing.join(", ")}; una corrección reemplaza la regla entera (A38).`,
            fix: `Indica también ${missing.join(", ")} para ${month} en la misma entrada (un estado o una regla fija).`,
          });
        }
      }
      p.exactRules = remaining;
      for (const [k, status] of Object.entries(entry.roles) as Array<[RoleKey, "in" | "out"]>) {
        p.roles[k] = status;
        personCells[k] = { reason: "correccion", corrected: true };
        mark(o.memberId, k);
      }
      for (const rule of entry.exactRules) {
        p.exactRules.push({ roles: canonicalRoles(rule.roles), count: rule.count });
        for (const k of rule.roles) {
          p.roles[k] = "exact";
          personCells[k] = { reason: "correccion", corrected: true };
          mark(o.memberId, k);
        }
      }
    }
    if (o.exempt !== null) {
      p.exempt = o.exempt;
      mark(o.memberId, "exempt");
    }
    if (o.sundayCadence === "alternate") {
      p.sundayCadence = "alternate";
      mark(o.memberId, "sundayCadence");
    } else if (o.sundayCadence === "normal") {
      delete p.sundayCadence;
      mark(o.memberId, "sundayCadence");
    }
    const dates = o.blockedDates.filter((d) => d.date.slice(0, 7) === month);
    for (const d of dates) {
      let block = p.blocks.find((b) => b.date === d.date);
      if (!block) {
        block = { date: d.date, unavailable: false, excludedRoles: [] };
        p.blocks.push(block);
      }
      if (d.roles === null) block.unavailable = true;
      else block.excludedRoles = canonicalRoles([...block.excludedRoles, ...d.roles]);
    }
    if (dates.length > 0) mark(o.memberId, "blocks");
  }

  const body: FairnessMonthBody = {
    month,
    people: [...people.values()]
      .sort((a, b) => compareCodepoint(a.memberId, b.memberId))
      .map((p) => ({
        ...p,
        exactRules: [...p.exactRules].sort((a, b) => compareCodepoint(a.roles.join(","), b.roles.join(","))),
        blocks: [...p.blocks].sort((a, b) => compareCodepoint(a.date, b.date)),
      })),
    presence: input.body.presence.map((r) => ({ ruleKey: r.ruleKey, roles: [...r.roles], members: [...r.members], exclusive: r.exclusive })),
  };
  corrections.sort((a, b) => compareCodepoint(a.memberId, b.memberId) || compareCodepoint(a.field, b.field));
  return { body, cells, corrections, joins, anomalies, refusals };
}

// ─── R13 — refusals ─────────────────────────────────────────────────────────────

const RESOLVER_TEXT: Record<string, { detail: string; fix: string }> = {
  unresolved: { detail: "Un nombre de las reglas no coincide con ningún miembro de alabanza.", fix: "Corrige el nombre en el panel de reglas." },
  ambiguous: { detail: "Un nombre de las reglas coincide con más de un miembro de alabanza.", fix: "Usa un nombre o alias único en el panel de reglas." },
  no_tipo: { detail: "Una regla nombra a un miembro sin Tipo.", fix: "Dale un Tipo en /admin o quita la regla." },
  cadence_and_exact: {
    detail: "«Mes por medio» y una cuenta fija de Sun.Lead para la misma persona (A11).",
    fix: "Quita uno de los dos en el panel de reglas; una corrección no lo resuelve (D11).",
  },
  overlapping_exact: { detail: "Dos cuentas fijas cubren el mismo rol para la misma persona (A38).", fix: "Deja una sola en el panel de reglas." },
  exact_count_range: { detail: "Una cuenta fija (==) no es un entero de 0 a 31 en este mes.", fix: "Corrige el valor en el panel de reglas." },
  presence_member_not_listed: { detail: "Una regla de presencia nombra a alguien sin voz en su Tipo.", fix: "Corrige la regla o el Tipo." },
  no_people: { detail: "Ningún miembro de alabanza tiene voz en su Tipo.", fix: "Revisa los Tipos en /admin." },
  too_many_people: { detail: "Más de 100 personas con voz: el registro no las admite.", fix: "Revisa los Tipos en /admin." },
  too_many_presence: { detail: "Más de 20 reglas de presencia.", fix: "Quita reglas de presencia en el panel." },
  presence_rule_id: { detail: "Una regla de presencia tiene un id inválido o repetido.", fix: "Vuelve a guardar la regla desde el panel." },
  presence_roles: { detail: "Una regla de presencia no cubre ningún rol.", fix: "Corrige el patrón de la regla." },
  presence_members: { detail: "Una regla de presencia no tiene de 2 a 12 miembros distintos.", fix: "Corrige los miembros de la regla." },
};
const FALLBACK_TEXT = { detail: "El resolvedor de C2 rechazó las reglas de hoy.", fix: "Corrige el panel de reglas." };

/**
 * The config ordinals of the rules a person-refusal is about (R12, R13). IF2-15's
 * refusals carry only the rule's `person` text, so the run finds every rule whose own
 * text is that string, filtered by reason, and prints their ORDINALS; the text and
 * the raw keys go to the private report only.
 */
export function rulesNaming(config: SolverConfig, person: string, reason: string): Array<{ ordinal: string; key: string }> {
  const out: Array<{ ordinal: string; key: string }> = [];
  const names = reason === "unresolved" || reason === "ambiguous" || reason === "no_tipo";
  config.restrictions.forEach((r, i) => {
    if (r.person !== person) return;
    const base = `restricción ${i + 1} de ${config.restrictions.length}`;
    const exactCaps = r.caps.map((c, j) => ({ c, j })).filter(({ c }) => c.op === "==");
    if (reason === "overlapping_exact" || reason === "exact_count_range") {
      for (const { c, j } of exactCaps) out.push({ ordinal: `${base}, tope ${j + 1}`, key: c.id });
    } else if (reason === "cadence_and_exact") {
      if (r.sundayCadence === "alternate") out.push({ ordinal: base, key: r.id });
      for (const { c, j } of exactCaps) {
        if (rolesOfPatternV3(c.pattern).includes("Sun.Lead")) out.push({ ordinal: `${base}, tope ${j + 1}`, key: c.id });
      }
    } else if (names) {
      out.push({ ordinal: base, key: r.id });
    }
  });
  if (names) {
    config.conflicts.forEach((c, i) => {
      if (c.personA === person || c.personB === person) out.push({ ordinal: `conflicto ${i + 1} de ${config.conflicts.length}`, key: c.id });
    });
  }
  if (names || reason === "presence_member_not_listed") {
    config.presence.forEach((p, i) => {
      if (p.persons.includes(person)) out.push({ ordinal: `presencia ${i + 1} de ${config.presence.length}`, key: p.id });
    });
  }
  return out;
}

function kindOf(reason: string, rules: ReadonlyArray<{ ordinal: string }>): RefusalKind {
  if (reason === "cadence_and_exact") return "mes por medio";
  if (reason === "overlapping_exact" || reason === "exact_count_range") return "regla fija";
  if (reason === "presence_member_not_listed") return "presencia";
  const first = rules[0]?.ordinal ?? "";
  return first.startsWith("conflicto") ? "conflicto" : first.startsWith("presencia") ? "presencia" : "restricción";
}

/** Every IF2-15 `ok: false` — each refusal and each issue — as one refusal of the run (R13; terminal, D11). */
export function resolverRefusals(
  result: Extract<EligibilityResult, { ok: false }>,
  config: SolverConfig,
  roster: readonly RosterRow[],
  month: string,
): RunRefusal[] {
  const out: RunRefusal[] = [];
  for (const issue of result.issues) {
    const text = RESOLVER_TEXT[issue.code] ?? FALLBACK_TEXT;
    if (issue.ruleKey !== undefined) {
      const i = config.presence.findIndex((r) => r.id === issue.ruleKey);
      out.push({
        reason: issue.code,
        kind: "presencia",
        rules: [{ ordinal: i >= 0 ? `presencia ${i + 1} de ${config.presence.length}` : "presencia", key: issue.ruleKey }],
        month,
        detail: text.detail,
        fix: text.fix,
      });
    } else {
      out.push({ reason: issue.code, kind: issue.code === "too_many_presence" ? "presencia" : "personas", rules: [], month, detail: text.detail, fix: text.fix });
    }
  }
  for (const refusal of result.refusals) {
    const text = RESOLVER_TEXT[refusal.reason] ?? FALLBACK_TEXT;
    const rules = rulesNaming(config, refusal.person, refusal.reason);
    const resolved = resolveRulePersonId(refusal.person, [...roster] as RosterMember[]);
    out.push({
      reason: refusal.reason,
      kind: kindOf(refusal.reason, rules),
      rules,
      month,
      person: refusal.person,
      memberIds: resolved.ok ? [resolved.id] : resolved.matches,
      detail: text.detail,
      fix: text.fix,
    });
  }
  return out;
}

/**
 * IF2-18 refused a transformed body. By RES-8 an untransformed body always passes, so
 * the cause is a correction (an A11 pair, an A38 overlap) — the issues are index-based
 * and printable; the members and their entries go to the report.
 */
export function validatorRefusal(
  month: string,
  body: FairnessMonthBody,
  issues: Array<{ path: string; message: string }>,
  overrides: readonly MemberOverride[],
): RunRefusal {
  const ids = new Set<string>();
  for (const issue of issues) {
    const m = /^people\[(\d+)\]/.exec(issue.path);
    const found = m ? body.people[Number(m[1])] : undefined;
    if (found) ids.add(found.memberId);
  }
  return {
    reason: "invalid_body",
    kind: "corrección",
    rules: overrides.filter((o) => ids.has(o.memberId)).map((o) => ({ ordinal: `entrada ${o.ordinal} del archivo`, key: null })),
    month,
    issues,
    memberIds: [...ids].sort(compareCodepoint),
    detail:
      "El registro corregido no pasa el validador del registro (IF2-18): una corrección lo contradice — por ejemplo «Mes por medio» junto a una cuenta fija de Sun.Lead (A11), o dos cuentas fijas para un rol (A38).",
    fix: "Corrige esa entrada (p. ej. «sundayCadence» \"normal\", o Sun.Lead \"in\", que reemplaza la regla fija) y vuelve a correr el dry run.",
  };
}

/** One line per distinct refusal across months (the earliest month kept). */
export function dedupeRefusals(list: readonly RunRefusal[]): RunRefusal[] {
  const seen = new Set<string>();
  return list.filter((r) => {
    const key = `${r.reason}\u0000${r.person ?? ""}\u0000${r.rules.map((x) => x.key ?? x.ordinal).join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
````

- [ ] **Step 4: Run it to see it pass**

Run: `git add -A && npx vitest run scripts/__tests__/reconstructInference.test.ts`
Expected: PASS. If a resolver expectation differs, read C2's `resolveMonthEligibility` on `main` before touching the test: the test asserts C2's behaviour, and a mismatch is a finding about C2 or this plan, never a value to re-capture.

- [ ] **Step 5: Gates and commit**

Run: `git add -A && npx tsc --noEmit && npm test && npx eslint .`
Expected: all green (on the replay base `a35f812e`: **472 files / 8729 tests**, 81 warnings); 0 errors; warnings at baseline.

```bash
git add -A
git commit -m "feat(fairness): infer each reconstructed record from Tipo, join months, the cadence setting and corrections" -m "Solver v3 C4 R4-R9. C2's resolver runs on today's rules with the pools replaced by what each member's current Tipo would tick; join months come only from C2's record-free seat step, so a seat delays a line's start and never makes anyone eligible, and a join bound that cuts an exact rule removes it whole. The cadence line is never join-bounded. Frank's corrections then win: statuses and exact rules replace today's whole (A38), a worship member without voz can be added, and blocked dates merge into existing blocks. Resolver and validator refusals are reported by rule ordinal, never by name or key."
```

---
## Task 5: Anomalies and the ledger runs — [standard; every figure is C2's ledger, every seat C2's seat step]

Spec R7 («regla fija = N, tuvo M» from IF2-8 `held`), R11's balance preview (one ledger run over the after-apply records; planned bodies as in-memory records), R13 (every anomaly type the transform does not emit). C4 computes no share, seat count or balance (A17, A39).

**Files:**
- Create: `scripts/lib/reconstructAnomalies.ts`, `scripts/lib/reconstructPreview.ts`
- Test: `scripts/__tests__/reconstructAnomalies.test.ts`

**Interfaces:**
- Consumes: `computeFairnessLedger`, `fairnessLedgerExactSums` (test only), `keepVoiceSeats`, `type LedgerInput`, `type LedgerService` (IF2-10/IF2-11 **[verified c2-t10]**); `saldoWords` (IF2-13, tests); `displayMemberName`; `ROLE_LINE`, `SUNDAY_KEYS`, `SATURDAY_KEYS`, `TAB_KEYS`, `compareCodepoint`, `shiftMonth`, `type FairnessLedgerResponse`, `type FairnessMonthBody`, `type LogicalRecord`, `type RecordEnvironment`, `type TabKey` (IF2-1/IF2-3/IF2-8); Task 4's `countedServiceDays`, `type SeatJoins`; Task 2's `MemberOverride` and types.
- Produces (anomalies): `monthAnomalies(input: { month; record: Pick<FairnessMonthBody, "people" | "presence">; services; ledger: Pick<FairnessLedgerResponse, "people" | "diagnostics">; rosterIds; presenceOrdinal: (ruleKey: string) => string | undefined }): Anomaly[]`; `poolAnomalies(input: { months; hypothetical: ReadonlyMap<string, FairnessMonthBody>; actual: ReadonlyMap<string, FairnessMonthBody>; seatJoins; overrides; cadenceIds }): Anomaly[]`; `joinAnomalies(input: { months; seatJoins; joinWindow; resolverIds: ReadonlyMap<string, ReadonlySet<string>>; overrides; cadenceIds }): Anomaly[]`; `lostBlocks(month, existing: LogicalRecord, planned: FairnessMonthBody): Anomaly[]`; `sortAnomalies(list): Anomaly[]`.
- Produces (preview): `type LedgerMembers = LedgerInput["members"]`; `ledgerMembers(roster): LedgerMembers`; `plannedLogicalRecord(body, bodyHash, environment, names): LogicalRecord`; `previewWindow(run: string): string[]`; `monthLedger(month, record: LogicalRecord | null, services, members)`; `seatsPerLine(ledger, month): Map<string, Partial<Record<Line, number>>>`; `previewFigures(input: { run; records; services; members }): { result; figures }`.

- [ ] **Step 1: Write the failing test**

**Create** `scripts/__tests__/reconstructAnomalies.test.ts`:

````ts
// Solver v3 C4 R7, R11 (the balance preview) and R13 — every anomaly the transform does
// not emit, and the ledger runs behind the table — over C2's REAL ledger (IF2-10) and
// seat step (IF2-11). Every name is fictitious.
import { describe, expect, it } from "vitest";

import { saldoWords } from "@/app/utils/fairnessFormat";
import { fairnessLedgerExactSums, type LedgerService } from "@/app/utils/fairnessLedger";
import type { FairnessMonthBody, RoleKey, Status } from "@/app/utils/fairnessVocabulary";
import { joinAnomalies, lostBlocks, monthAnomalies, poolAnomalies, sortAnomalies } from "../lib/reconstructAnomalies";
import { seatJoinMonths } from "../lib/reconstructInference";
import { ledgerMembers, monthLedger, plannedLogicalRecord, previewFigures, previewWindow, seatsPerLine } from "../lib/reconstructPreview";
import type { Anomaly, RosterRow } from "../lib/reconstructTypes";

const OUT: Record<RoleKey, Status> = {
  "Sun.Lead": "out",
  "Sat.Lead": "out",
  "Sun.BGV": "out",
  "Sat.BGV": "out",
  "Sun.Choir": "out",
  "Sat.Choir": "out",
};
const ROSTER: RosterRow[] = [
  { _id: "kidsMember-dani", member_name: "Dani Ejemplo", alias: "Dani E.", memberType: ["voz", "sunday_lead"] },
  { _id: "m-ana", member_name: "Ana Ejemplo", alias: "Ana E.", memberType: ["voz", "sunday_lead"] },
  { _id: "m-beto", member_name: "Beto Ejemplo", alias: "Beto E.", memberType: ["voz", "sunday_lead"] },
  { _id: "m-carla", member_name: "Carla Ejemplo", alias: "Carla E.", memberType: ["voz", "support"], unavailableDates: ["2026-08-16"] },
  { _id: "m-ivan", member_name: "Iván Ejemplo", alias: "Iván E.", memberType: ["voz", "saturday_lead"] },
];
const ROSTER_IDS = new Set(ROSTER.map((m) => m._id));
const NAMES = new Map(ROSTER.map((m) => [m._id, m.alias ?? m.member_name]));
const MEMBERS = ledgerMembers(ROSTER);
const ORDINAL = (ruleKey: string) => (ruleKey === "d-beto-carla" ? "presencia 1 de 1" : undefined);

const svc = (
  id: string,
  type: LedgerService["_type"],
  date: string,
  seats: Partial<Pick<LedgerService, "Lead" | "BGVs" | "Chorus">>,
  extra: Partial<LedgerService> = {},
): LedgerService => ({ _id: id, _type: type, date, Lead: [], BGVs: [], Chorus: [], ...seats, ...extra });
const item = (memberId: string, roles: Partial<Record<RoleKey, Status>>, extra: Partial<FairnessMonthBody["people"][number]> = {}) => ({
  memberId,
  roles: { ...OUT, ...roles },
  exactRules: [],
  exempt: false,
  blocks: [],
  ...extra,
});

const AUGUST: FairnessMonthBody = {
  month: "2026-08",
  people: [
    item("kidsMember-dani", { "Sun.Lead": "in" }, { sundayCadence: "alternate" }),
    item("m-ana", { "Sun.Lead": "in", "Sun.BGV": "in", "Sun.Choir": "in" }),
    item("m-beto", { "Sun.BGV": "exact" }, { exactRules: [{ roles: ["Sun.BGV"], count: 1 }] }),
    item("m-carla", { "Sun.BGV": "in" }, { blocks: [{ date: "2026-08-16", unavailable: true, excludedRoles: [] }] }),
    item("m-ivan", { "Sat.Lead": "in" }, { blocks: [{ date: "2026-08-08", unavailable: false, excludedRoles: ["Sat.Lead", "Sat.BGV", "Sat.Choir"] }] }),
  ],
  presence: [{ ruleKey: "d-beto-carla", roles: ["Sun.BGV"], members: ["m-beto", "m-carla"], exclusive: false }],
};
const SERVICES: LedgerService[] = [
  svc("sat-0801", "saturday_role", "2026-08-01", { Lead: ["m-ivan"], BGVs: ["m-ana"] }),
  svc("sun-0802", "sunday_role", "2026-08-02", { Lead: ["m-ana"], BGVs: ["m-hugo"] }),
  svc("sat-0808", "saturday_role", "2026-08-08", { Lead: ["m-ivan"] }),
  svc("spe-0808", "special_role", "2026-08-08", { Lead: ["m-ivan"] }, { countsForFairness: true }),
  svc("sun-0809a", "sunday_role", "2026-08-09", { Lead: ["m-ana"] }),
  svc("sun-0809b", "sunday_role", "2026-08-09", {}),
  svc("sun-0816", "sunday_role", "2026-08-16", { Lead: ["m-ana"], BGVs: ["m-carla"], Chorus: ["m-ana"] }),
  svc("sat-0822", "saturday_role", "2026-08-22", { Lead: ["m-ivan"] }),
];
const RECORD = plannedLogicalRecord(AUGUST, "sha256:planned", "local", NAMES);
const LEDGER = monthLedger("2026-08", RECORD, SERVICES, MEMBERS);

describe("the month's anomalies (R7, R13)", () => {
  it("lists every seat, rule, presence and roster anomaly the month has — and nothing else", () => {
    const expected: Anomaly[] = [
      { code: "seat_while_out", month: "2026-08", memberId: "m-ana", date: "2026-08-01", roleKey: "Sat.BGV", serviceId: "sat-0801" },
      { code: "seat_unavailable", month: "2026-08", memberId: "m-carla", date: "2026-08-16", roleKey: "Sun.BGV", serviceId: "sun-0816" },
      { code: "seat_rule_excluded", month: "2026-08", memberId: "m-ivan", date: "2026-08-08", roleKey: "Sat.Lead", serviceId: "sat-0808" },
      { code: "exact_mismatch", month: "2026-08", memberId: "m-beto", roles: ["Sun.BGV"], count: 1, held: 0 },
      { code: "presence_no_seat", month: "2026-08", ruleKey: "d-beto-carla", ruleOrdinal: "presencia 1 de 1", date: "2026-08-02", serviceId: "sun-0802" },
      { code: "presence_outside", month: "2026-08", ruleKey: "d-beto-carla", ruleOrdinal: "presencia 1 de 1", memberId: "m-carla", dates: ["2026-08-16"] },
      { code: "member_gone", month: "2026-08", memberId: "m-hugo" },
      { code: "duplicate_target", month: "2026-08", type: "sunday_role", date: "2026-08-09", roleIds: ["sun-0809a", "sun-0809b"] },
      { code: "second_seat", month: "2026-08", memberId: "m-ana", date: "2026-08-16", roleKey: "Sun.Choir", serviceId: "sun-0816" },
    ];
    const found = sortAnomalies(
      monthAnomalies({ month: "2026-08", record: AUGUST, services: SERVICES, ledger: LEDGER, rosterIds: ROSTER_IDS, presenceOrdinal: ORDINAL }),
    );
    expect(found).toEqual(sortAnomalies(expected));
  });

  it("never treats a week exclusion as binding at a special (A13)", () => {
    const anomalies = monthAnomalies({ month: "2026-08", record: AUGUST, services: SERVICES, ledger: LEDGER, rosterIds: ROSTER_IDS, presenceOrdinal: ORDINAL });
    expect(anomalies.filter((a) => a.serviceId === "spe-0808")).toEqual([]);
  });

  it("lists a cadence setting on someone not in for Sun.Lead", () => {
    const record: FairnessMonthBody = { month: "2026-08", people: [item("kidsMember-dani", {}, { sundayCadence: "alternate" })], presence: [] };
    const ledger = monthLedger("2026-08", plannedLogicalRecord(record, "sha256:x", "local", NAMES), [], MEMBERS);
    expect(monthAnomalies({ month: "2026-08", record, services: [], ledger, rosterIds: ROSTER_IDS, presenceOrdinal: ORDINAL })).toEqual([
      { code: "cadence_not_in", month: "2026-08", memberId: "kidsMember-dani" },
    ]);
  });
});

describe("the pool anomalies (R13)", () => {
  const body = (people: FairnessMonthBody["people"]): FairnessMonthBody => ({ month: "2026-08", people, presence: [] });
  const hypothetical = new Map([
    ["2026-08", body([item("kidsMember-dani", { "Sun.Lead": "in", "Sat.Lead": "in" }), item("m-ana", { "Sun.Lead": "in" }), item("m-carla", { "Sun.BGV": "in" })])],
  ]);
  const actual = new Map([
    ["2026-08", body([item("kidsMember-dani", { "Sun.Lead": "in", "Sat.Lead": "in" }), item("m-ana", { "Sun.Lead": "in" }), item("m-carla", {})])],
  ]);
  const seatJoins = seatJoinMonths([svc("sun-0705", "sunday_role", "2026-07-05", { Lead: ["m-ana"] })]);
  const cadenceIds = new Set(["kidsMember-dani"]);

  it("lists «not ticked today» and «ticked today, never seated» — never a cadence member's DL", () => {
    expect(sortAnomalies(poolAnomalies({ months: ["2026-08"], hypothetical, actual, seatJoins, overrides: [], cadenceIds }))).toEqual(
      sortAnomalies([
        { code: "not_ticked_today", month: null, memberId: "m-carla", line: "BGV", months: ["2026-08"] },
        { code: "ticked_never_seated", month: null, memberId: "kidsMember-dani", line: "SL", months: ["2026-08"] },
      ]),
    );
  });

  it("drops «ticked today, never seated» once a correction gives that line a join month", () => {
    const overrides = [
      { ordinal: 1, memberId: "kidsMember-dani", note: null, exempt: null, sundayCadence: null, joinMonths: { SL: "2026-08" }, blockedDates: [], months: {} },
    ];
    const anomalies = poolAnomalies({ months: ["2026-08"], hypothetical, actual, seatJoins, overrides, cadenceIds });
    expect(anomalies.some((a) => a.code === "ticked_never_seated")).toBe(false);
  });
});

describe("the join and lost-date anomalies (R13)", () => {
  it("flags a first seat that is not the line's first counted service of the month; never a cadence member's DL", () => {
    const joinWindow = [
      svc("sun-0906", "sunday_role", "2026-09-06", { Lead: ["m-ana"] }),
      svc("sun-0913", "sunday_role", "2026-09-13", { Lead: ["kidsMember-dani"], BGVs: ["m-carla"] }),
    ];
    const resolverIds = new Map([["2026-09", new Set(["kidsMember-dani", "m-ana", "m-carla"])]]);
    expect(
      joinAnomalies({ months: ["2026-09"], seatJoins: seatJoinMonths(joinWindow), joinWindow, resolverIds, overrides: [], cadenceIds: new Set(["kidsMember-dani"]) }),
    ).toEqual([{ code: "join_mid_month", month: "2026-09", memberId: "m-carla", line: "BGV", date: "2026-09-13", firstServiceDate: "2026-09-06" }]);
  });

  it("lists a blocked date a replace would drop", () => {
    const existing = plannedLogicalRecord(
      { month: "2026-07", people: [item("m-ana", { "Sun.Lead": "in" }, { blocks: [{ date: "2026-07-12", unavailable: true, excludedRoles: [] }] })], presence: [] },
      "sha256:old",
      "local",
      NAMES,
    );
    const planned: FairnessMonthBody = { month: "2026-07", people: [item("m-ana", { "Sun.Lead": "in" })], presence: [] };
    expect(lostBlocks("2026-07", existing, planned)).toEqual([{ code: "lost_block", month: "2026-07", memberId: "m-ana", date: "2026-07-12" }]);
  });
});

describe("the ledger runs (R11)", () => {
  it("takes the preview window as the three months before the run", () => {
    expect(previewWindow("2026-10")).toEqual(["2026-07", "2026-08", "2026-09"]);
  });

  it("states its placeholders on an in-memory planned record", () => {
    expect(RECORD).toMatchObject({ month: "2026-08", rev: "planned", recordedAt: "planned", contentHash: "sha256:planned", source: "reconstructed", engine: "v2" });
    expect(RECORD.people.find((p) => p.memberId === "m-ana")?.name).toBe("Ana E.");
  });

  it("counts seats per line from the ledger's integer `held`, second seats included", () => {
    const seats = seatsPerLine(LEDGER, "2026-08");
    expect(seats.get("m-ana")).toEqual({ DL: 2, BGV: 1, CORO: 1 });
    expect(seats.get("m-ivan")).toEqual({ SL: 4 });
  });

  it("gives a cadence member no DL debt, and balances that sum to zero per service and role", () => {
    const { result, figures } = previewFigures({ run: "2026-09", records: [RECORD], services: SERVICES, members: MEMBERS });
    const dani = result.people.find((p) => p.memberId === "kidsMember-dani");
    expect(dani).toBeDefined();
    expect(saldoWords(dani?.tabs.window.DL?.tenths.balance ?? 0)).toBe("al día");
    expect(figures["kidsMember-dani"]?.DL?.balance ?? 0).toBe(0);
    const sums = fairnessLedgerExactSums({ target: "2026-09", records: [RECORD], services: SERVICES, members: MEMBERS });
    expect(sums.length).toBeGreaterThan(0);
    expect(sums.every((s) => s.numerator === "0")).toBe(true);
  });
});
````

- [ ] **Step 2: Run it to see it fail**

Run: `git add -A && npx vitest run scripts/__tests__/reconstructAnomalies.test.ts`
Expected: FAIL — the two modules do not resolve.

- [ ] **Step 3: Implement**

**Create** `scripts/lib/reconstructPreview.ts`:

````ts
// scripts/lib/reconstructPreview.ts
//
// R11's balance preview and the per-month ledger runs (solver v3 C4), all through
// C2's ledger (IF2-10): C4 computes no share, seat count or balance itself (A17, A39).
//
// The ledger takes IF2-3 records. For a month planned «crear» or «reemplazar» the
// preview hands it the PLANNED body as an in-memory record — never stored-shaped and
// never written (R2). Its placeholders, stated so nobody reads them as data: `rev`
// and `recordedAt` are "planned"; `contentHash` is the body's IF2-19 hash; `source`
// and `engine` are what the executor would stamp ("reconstructed", "v2");
// `environment` is the run's REC-2 stamp; each person's `name` is her roster display
// name (the ledger uses names for display only).

import { computeFairnessLedger, type LedgerInput, type LedgerService } from "../../app/utils/fairnessLedger";
import { displayMemberName } from "../../app/utils/memberRuleNames";
import {
  ROLE_LINE,
  TAB_KEYS,
  shiftMonth,
  type FairnessLedgerResponse,
  type FairnessMonthBody,
  type LogicalRecord,
  type RecordEnvironment,
  type RoleKey,
  type TabKey,
} from "../../app/utils/fairnessVocabulary";
import type { Line, RosterRow } from "./reconstructTypes";

export type LedgerMembers = LedgerInput["members"];

/** IF2-10's `members` from IF2-27's rows: existing worship member documents (R13: anyone else is «miembro eliminado»). */
export function ledgerMembers(roster: readonly RosterRow[]): LedgerMembers {
  return roster.map((m) => ({
    id: m._id,
    name: displayMemberName({ member_name: m.member_name ?? undefined, alias: m.alias ?? undefined }),
    unavailableDates: (m.unavailableDates ?? []).filter((d): d is string => typeof d === "string"),
  }));
}

export function plannedLogicalRecord(
  body: FairnessMonthBody,
  bodyHash: string,
  environment: RecordEnvironment,
  names: ReadonlyMap<string, string>,
): LogicalRecord {
  return {
    month: body.month,
    rev: "planned",
    contentHash: bodyHash,
    source: "reconstructed",
    engine: "v2",
    environment,
    recordedAt: "planned",
    people: body.people.map((p) => ({ ...p, name: names.get(p.memberId) ?? "" })),
    presence: body.presence,
  };
}

/** The three calendar months before the run (C2 LG-12). */
export function previewWindow(run: string): string[] {
  return [shiftMonth(run, -3), shiftMonth(run, -2), shiftMonth(run, -1)];
}

/** One month alone: target = the next month, so the month is the window's last (its `held`, notes and `unknownMembers`). */
export function monthLedger(month: string, record: LogicalRecord | null, services: readonly LedgerService[], members: LedgerMembers) {
  return computeFairnessLedger({ target: shiftMonth(month, 1), records: record ? [record] : [], services: [...services], members: [...members] });
}

/** R11's «lugares» column: the ledger's integer `held` (IF2-8) summed per line — never derived from hundredths (A39). */
export function seatsPerLine(ledger: Pick<FairnessLedgerResponse, "people">, month: string): Map<string, Partial<Record<Line, number>>> {
  const out = new Map<string, Partial<Record<Line, number>>>();
  for (const person of ledger.people) {
    const held = person.months.find((m) => m.month === month)?.held ?? {};
    const lines: Partial<Record<Line, number>> = {};
    for (const [key, n] of Object.entries(held) as Array<[RoleKey, number]>) {
      const line = ROLE_LINE[key];
      lines[line] = (lines[line] ?? 0) + n;
    }
    out.set(person.memberId, lines);
  }
  return out;
}

/** R11's preview: one ledger run for the run month over the after-apply records; per member, per tab, hundredths (bound in the plan). */
export function previewFigures(input: { run: string; records: LogicalRecord[]; services: readonly LedgerService[]; members: LedgerMembers }) {
  const result = computeFairnessLedger({ target: input.run, records: input.records, services: [...input.services], members: [...input.members] });
  const figures: Record<string, Partial<Record<TabKey, { share: number; received: number; balance: number }>>> = {};
  for (const person of result.people) {
    const tabs: Partial<Record<TabKey, { share: number; received: number; balance: number }>> = {};
    for (const tab of TAB_KEYS) {
      const f = person.tabs.window[tab];
      if (f) tabs[tab] = { share: f.share, received: f.received, balance: f.balance };
    }
    figures[person.memberId] = tabs;
  }
  return { result, figures };
}
````

**Create** `scripts/lib/reconstructAnomalies.ts`:

````ts
// scripts/lib/reconstructAnomalies.ts
//
// R13's anomalies (solver v3 C4): listed, never resolved. Seats are only C2's kept and
// second seats (IF2-11); seat counts and set-asides are only C2's ledger output
// (IF2-10); nothing here counts or weighs a seat. `rule_split` and `person_added`
// come from `transformMonth`, which made those changes.
//
// The record a month's anomalies read is the one the month will hold after the plan
// is applied (R11's preview rule): the planned body for «crear»/«reemplazar»/«sin
// cambios», the stored record for the two «no se toca» rows.

import { keepVoiceSeats, type LedgerService } from "../../app/utils/fairnessLedger";
import {
  SATURDAY_KEYS,
  SUNDAY_KEYS,
  compareCodepoint,
  type FairnessLedgerResponse,
  type FairnessMonthBody,
  type LogicalRecord,
  type RoleKey,
} from "../../app/utils/fairnessVocabulary";
import { countedServiceDays, type SeatJoins } from "./reconstructInference";
import type { MemberOverride } from "./reconstructOverrides";
import { ANOMALY_CODES, LINES, LINE_ROLES, type Anomaly, type Line } from "./reconstructTypes";

type RecordContent = Pick<FairnessMonthBody, "people" | "presence">;

export function monthAnomalies(input: {
  month: string;
  record: RecordContent;
  services: readonly LedgerService[];
  ledger: Pick<FairnessLedgerResponse, "people" | "diagnostics">;
  rosterIds: ReadonlySet<string>;
  presenceOrdinal: (ruleKey: string) => string | undefined;
}): Anomaly[] {
  const { month, record } = input;
  const out: Anomaly[] = [];
  const people = new Map(record.people.map((p) => [p.memberId, p]));
  const status = (id: string, k: RoleKey) => people.get(id)?.roles[k] ?? "out";
  const cadence = (id: string) => people.get(id)?.sundayCadence === "alternate";
  const { kept, secondSeats, duplicateTargets } = keepVoiceSeats([...input.services]);
  const days = countedServiceDays(input.services);
  const weekend = new Set(days.filter((d) => d.weekend).map((d) => d.id));

  // Seats against the record: out, unavailable, rule-excluded (weekend services only, A13).
  for (const seat of kept) {
    if (!input.rosterIds.has(seat.memberId)) continue; // a deleted or non-worship holder is `member_gone`
    const at = { month, memberId: seat.memberId, date: seat.date, roleKey: seat.roleKey, serviceId: seat.serviceId };
    if (status(seat.memberId, seat.roleKey) === "out") out.push({ code: "seat_while_out", ...at });
    const blocks = people.get(seat.memberId)?.blocks ?? [];
    if (blocks.some((b) => b.date === seat.date && b.unavailable)) out.push({ code: "seat_unavailable", ...at });
    if (weekend.has(seat.serviceId) && blocks.some((b) => b.date === seat.date && b.excludedRoles.includes(seat.roleKey))) {
      out.push({ code: "seat_rule_excluded", ...at });
    }
  }
  for (const seat of secondSeats) {
    out.push({ code: "second_seat", month, memberId: seat.memberId, date: seat.date, roleKey: seat.roleKey, serviceId: seat.serviceId });
  }
  for (const d of duplicateTargets) out.push({ code: "duplicate_target", month, type: d.type, date: d.date, roleIds: d.roleIds });

  // R7 — an exact rule against the seats held (the ledger's integer `held`), and R6's kept setting.
  for (const p of record.people) {
    const held = input.ledger.people.find((x) => x.memberId === p.memberId)?.months.find((m) => m.month === month)?.held ?? {};
    for (const rule of p.exactRules) {
      const n = rule.roles.reduce((sum, k) => sum + (held[k] ?? 0), 0);
      if (n !== rule.count) out.push({ code: "exact_mismatch", month, memberId: p.memberId, roles: rule.roles, count: rule.count, held: n });
    }
    if (p.sundayCadence === "alternate" && p.roles["Sun.Lead"] !== "in") out.push({ code: "cadence_not_in", month, memberId: p.memberId });
  }

  // Presence (C2 LG-7): a counted weekend service where the rule applies and no rule
  // member holds a non-fixed seat of its roles; and the ledger's `outside_population`
  // presence seats.
  for (const rule of record.presence) {
    const ordinal = input.presenceOrdinal(rule.ruleKey);
    const named = { ruleKey: rule.ruleKey, ...(ordinal ? { ruleOrdinal: ordinal } : {}) };
    for (const day of days) {
      if (!day.weekend) continue;
      const roles = (day.sunday ? SUNDAY_KEYS : SATURDAY_KEYS).filter((k) => rule.roles.includes(k));
      if (roles.length === 0) continue;
      const hasSeat = kept.some(
        (x) =>
          x.serviceId === day.id &&
          roles.includes(x.roleKey) &&
          rule.members.includes(x.memberId) &&
          status(x.memberId, x.roleKey) !== "exact" &&
          !(x.roleKey === "Sun.Lead" && cadence(x.memberId)),
      );
      if (!hasSeat) out.push({ code: "presence_no_seat", month, ...named, date: day.date, serviceId: day.id });
    }
    for (const person of input.ledger.people) {
      for (const note of person.months.find((m) => m.month === month)?.notes ?? []) {
        if (note.code === "outside_population" && note.line === `P:${rule.ruleKey}`) {
          out.push({ code: "presence_outside", month, ...named, memberId: person.memberId, dates: note.dates });
        }
      }
    }
  }

  // «miembro eliminado o fuera de alabanza»: exactly IF2-8 `diagnostics.unknownMembers`.
  for (const id of input.ledger.diagnostics.unknownMembers) out.push({ code: "member_gone", month, memberId: id });
  return out;
}

/** Whether a body lists the member with some role of the line not "out". */
const lineOpen = (body: FairnessMonthBody | undefined, memberId: string, line: Line) => {
  const p = body?.people.find((x) => x.memberId === memberId);
  return !!p && LINE_ROLES[line].some((k) => p.roles[k] !== "out");
};

/**
 * R13's two pool anomalies, per person and line, over the requested months. `hypothetical`
 * is R4's resolver output (before R5); `actual` is the same rules over today's REAL pools —
 * so «ticked in a pool C2 RES-1 maps to a role of the line» is C2's own mapping, not a copy.
 */
export function poolAnomalies(input: {
  months: readonly string[];
  hypothetical: ReadonlyMap<string, FairnessMonthBody>;
  actual: ReadonlyMap<string, FairnessMonthBody>;
  seatJoins: SeatJoins;
  overrides: readonly MemberOverride[];
  cadenceIds: ReadonlySet<string>;
}): Anomaly[] {
  const ids = new Set<string>();
  for (const body of [...input.hypothetical.values(), ...input.actual.values()]) for (const p of body.people) ids.add(p.memberId);
  const out: Anomaly[] = [];
  for (const id of [...ids].sort(compareCodepoint)) {
    const override = input.overrides.find((o) => o.memberId === id);
    for (const line of LINES) {
      const notTicked = input.months.filter((m) => lineOpen(input.hypothetical.get(m), id, line) && !lineOpen(input.actual.get(m), id, line));
      if (notTicked.length > 0) out.push({ code: "not_ticked_today", month: null, memberId: id, line, months: notTicked });
      if (line === "DL" && input.cadenceIds.has(id)) continue; // R6: not join-bounded
      if (input.seatJoins.get(id)?.[line] !== undefined || override?.joinMonths[line] !== undefined) continue;
      const ticked = input.months.filter((m) => lineOpen(input.actual.get(m), id, line));
      if (ticked.length > 0) out.push({ code: "ticked_never_seated", month: null, memberId: id, line, months: ticked });
    }
  }
  return out;
}

/** R13: a join month inside the run whose first seat is not that month's first counted service of the line. */
export function joinAnomalies(input: {
  months: readonly string[];
  seatJoins: SeatJoins;
  joinWindow: readonly LedgerService[];
  resolverIds: ReadonlyMap<string, ReadonlySet<string>>;
  overrides: readonly MemberOverride[];
  cadenceIds: ReadonlySet<string>;
}): Anomaly[] {
  const days = countedServiceDays(input.joinWindow);
  const firstOf = (month: string, line: Line) =>
    days.find((d) => d.date.slice(0, 7) === month && (line === "DL" ? d.sunday : line === "SL" ? !d.sunday : true))?.date;
  const out: Anomaly[] = [];
  for (const [id, lines] of [...input.seatJoins].sort(([a], [b]) => compareCodepoint(a, b))) {
    const override = input.overrides.find((o) => o.memberId === id);
    for (const line of LINES) {
      const join = lines[line];
      if (!join || !input.months.includes(join.month)) continue;
      if (!input.resolverIds.get(join.month)?.has(id)) continue;
      if (override?.joinMonths[line] !== undefined) continue;
      if (line === "DL" && input.cadenceIds.has(id)) continue;
      const first = firstOf(join.month, line);
      if (first !== undefined && first !== join.firstSeatDate) {
        out.push({ code: "join_mid_month", month: join.month, memberId: id, line, date: join.firstSeatDate, firstServiceDate: first });
      }
    }
  }
  return out;
}

/** R13 «fecha bloqueada perdida»: an unavailable date the existing record holds and the planned replace drops. */
export function lostBlocks(month: string, existing: LogicalRecord, planned: FairnessMonthBody): Anomaly[] {
  const out: Anomaly[] = [];
  for (const p of existing.people) {
    const next = planned.people.find((x) => x.memberId === p.memberId);
    for (const b of p.blocks) {
      if (!b.unavailable) continue;
      if (next?.blocks.some((x) => x.date === b.date && x.unavailable)) continue;
      out.push({ code: "lost_block", month, memberId: p.memberId, date: b.date });
    }
  }
  return out;
}

/** Deterministic order (R17): month (run-wide first), the spec's anomaly order, then member, line, date and the rest. */
export function sortAnomalies(list: readonly Anomaly[]): Anomaly[] {
  const key = (a: Anomaly) =>
    [
      a.month ?? "",
      String(ANOMALY_CODES.indexOf(a.code)).padStart(2, "0"),
      a.memberId ?? "",
      a.line ?? "",
      a.date ?? "",
      a.ruleKey ?? "",
      a.roleKey ?? "",
      a.serviceId ?? "",
      a.type ?? "",
    ].join("\u0000");
  return [...list].sort((a, b) => compareCodepoint(key(a), key(b)));
}
````

- [ ] **Step 4: Run it to see it pass**

Run: `git add -A && npx vitest run scripts/__tests__/reconstructAnomalies.test.ts`
Expected: PASS. A differing ledger-derived expectation (`held`, a note, `unknownMembers`) is a finding to check against C2's LG rows, not a value to re-capture.

- [ ] **Step 5: Gates and commit**

Run: `git add -A && npx tsc --noEmit && npm test && npx eslint .`
Expected: all green (on the replay base `a35f812e`: **473 files / 8740 tests**, 81 warnings); 0 errors; warnings at baseline.

```bash
git add -A
git commit -m "feat(fairness): the reconstruction's anomalies and ledger runs" -m "Solver v3 C4 R7, R11, R13. Every anomaly is listed, never resolved: seats held while out, unavailable or rule-excluded at a weekend, a join month that does not start on the line's first counted service, an exact rule against the seats held, a cadence setting off Sun.Lead, the two pool anomalies (from a second C2 resolver call over today's real pools), presence rules without a presence seat, deleted or non-worship holders, duplicated weekend documents, second seats and blocked dates a replace would drop. Every seat count and figure is C2's ledger output; planned bodies reach it as in-memory records with stated placeholders."
```

---
## Task 6: The Spanish reports and the name-free stdout lines — [standard; R12 privacy]

Spec R11 (the private table: services with «cuenta», per-person rows with status words `elegible`/`fuera`/`fija N`, reason, «corregido», join months, seats, blocked dates, «Exenta», «Mes por medio»; presence rules as stored; «Decision per month» and R21 (a «reemplazar» row shows the per-person diff against the stored record); the balance preview with one decimal through IF2-13; anomalies; `es` collation), R12 (stdout carries no name, `_id`, key or hash prefix), R13 (the refusal line and the private refusal report).

**Files:**
- Create: `scripts/lib/reconstructReport.ts`
- Test: `scripts/__tests__/reconstructReport.test.ts`

**Interfaces:**
- Consumes: `saldoWords` (IF2-13 **[verified c2-t10]**); `ROLE_KEYS`, `type RoleKey`, `type Status`, `type TabKey`; Task 1's `type RunMode`; Task 2's types; Task 3's `type RollbackPlanContent`.
- Produces: `MODE_LABEL`, `ACTION_LABEL: Record<MonthAction, string>`, `ROLLBACK_LABEL: Record<RollbackAction, string>`, `REASON_LABEL: Record<CellReason, string>`, `SERVICE_TYPE_LABEL`, `statusLabel(status, count): string`, `interface TableCell`, `interface TableRow`, `interface TableMonth`, `interface TableModel`, `interface ReplaceChange`, `replaceChanges(existing: Pick<LogicalRecord, "people" | "presence">, planned: Pick<FairnessMonthBody, "people" | "presence">, nameOf): ReplaceChange[]`, `renderTable(model: TableModel): string`, `anomalyText(a: Anomaly, nameOf: (id: string) => string): string`, `renderRefusalReport(input: { generatedAt; refusals; nameOf }): string`, `renderApplyReport(input: { generatedAt; mode; results: Array<{ month; verdict; memberIds? }>; notAttempted: string[] }): string`, `renderRollbackTable(input: { generatedAt; projectId; dataset; content: RollbackPlanContent }): string`, `targetLine(mode, projectId, dataset): string`, `refusalLine(r: RunRefusal, index: number, total: number, reportPath: string | null): string`.

- [ ] **Step 1: Write the failing test**

**Create** `scripts/__tests__/reconstructReport.test.ts`:

````ts
// Solver v3 C4 R11–R13 — the private Spanish table and refusal report, and the
// name-free lines stdout may carry. Every name is fictitious.
import { describe, expect, it } from "vitest";

import type { FairnessMonthBody, LogicalRecord, RoleKey, Status } from "@/app/utils/fairnessVocabulary";
import {
  ACTION_LABEL,
  anomalyText,
  refusalLine,
  renderRefusalReport,
  renderTable,
  replaceChanges,
  statusLabel,
  targetLine,
  type TableCell,
  type TableModel,
} from "../lib/reconstructReport";
import { ANOMALY_CODES, type Anomaly, type RunRefusal } from "../lib/reconstructTypes";

const REFUSAL: RunRefusal = {
  reason: "exact_count_range",
  kind: "regla fija",
  rules: [{ ordinal: "restricción 1 de 4, tope 1", key: "d-ana" }],
  month: "2026-08",
  person: "Ana Ejemplo",
  memberIds: ["m-ana"],
  detail: "Una cuenta fija no es un entero de 0 a 31.",
  fix: "Corrige el valor en el panel de reglas.",
};
const nameOf = (id: string) => ({ "m-ana": "Ana E.", "m-beto": "Beto E.", "m-ambar": "Ámbar Ejemplo" })[id] ?? "";
const cell = (patch: Partial<TableCell> = {}): TableCell => ({ status: "out", count: null, reason: "linea", corrected: false, ...patch });
const cells = (patch: Partial<Record<RoleKey, TableCell>> = {}) =>
  ({
    "Sun.Lead": cell(),
    "Sat.Lead": cell(),
    "Sun.BGV": cell(),
    "Sat.BGV": cell(),
    "Sun.Choir": cell(),
    "Sat.Choir": cell(),
    ...patch,
  }) as Record<RoleKey, TableCell>;
const row = (memberId: string, patch: Partial<TableModel["table"][number]["rows"][number]> = {}) => ({
  memberId,
  name: nameOf(memberId),
  cells: cells(),
  joins: {},
  seats: {},
  blocked: [],
  exempt: false,
  exemptCorrected: false,
  cadence: false,
  cadenceCorrected: false,
  blocksCorrected: false,
  added: false,
  ...patch,
});
const MODEL: TableModel = {
  generatedAt: "2026-10-20T18:00:00.000Z",
  projectId: "proj-test",
  dataset: "test",
  months: ["2026-08"],
  previewRun: "2026-09",
  overridesHash: "none",
  cadenceSettings: { config: 1, overrides: 0 },
  table: [
    {
      month: "2026-08",
      action: "create",
      services: [
        { date: "2026-08-02", type: "domingo", counted: true },
        { date: "2026-08-30", type: "especial", counted: false },
      ],
      rows: [
        row("m-beto", {
          cells: cells({ "Sun.BGV": cell({ status: "exact", count: 2, reason: "correccion", corrected: true }) }),
          joins: { BGV: "2026-07" },
          seats: { BGV: 1 },
        }),
        row("m-ambar", { cells: cells({ "Sun.Lead": cell({ status: "in", reason: "tipo" }) }), joins: { DL: "2026-08" }, blocked: ["2026-08-15"] }),
      ],
      presence: [{ ordinal: "presencia 1 de 1", ruleKey: "d-beto-carla", roles: ["Sun.BGV"], members: ["Beto E.", "Carla E."], exclusive: false }],
    },
  ],
  preview: {
    window: ["2026-06", "2026-07", "2026-08"],
    sources: [
      { month: "2026-06", from: "none" },
      { month: "2026-07", from: "stored" },
      { month: "2026-08", from: "planned" },
    ],
    rows: [
      { memberId: "m-beto", name: "Beto E.", tabs: { BGV: 8, TOTAL: 8 } },
      { memberId: "m-ambar", name: "Ámbar Ejemplo", tabs: {} },
    ],
  },
  anomalies: [{ anomaly: { code: "person_added", month: "2026-08", memberId: "m-beto" }, text: "2026-08 · Beto E. (`m-beto`): añadida por corrección." }],
  notes: [{ ordinal: 1, memberId: "m-beto", name: "Beto E.", note: "Cantó en septiembre." }],
  notApplicable: [{ ordinal: 2, memberId: "m-ana", month: "2026-10" }],
};

describe("words and labels (R11, «Decision per month»)", () => {
  it("renders statuses as the spec words them", () => {
    expect(statusLabel("in", null)).toBe("elegible");
    expect(statusLabel("out", null)).toBe("fuera");
    expect(statusLabel("exact", 2)).toBe("fija 2");
  });
  it("labels every planned action with the spec's words", () => {
    expect(ACTION_LABEL).toEqual({
      create: "crear",
      replace: "reemplazar",
      unchanged: "sin cambios",
      skip: "sin servicios guardados: no se reconstruye",
      not_reconstruction_owned: "no lo escribió la reconstrucción: no se toca",
      record_edited: "editado después de reconstruir: no se toca",
    });
  });
});

describe("stdout lines (R12, R13)", () => {
  it("prints the target first, with the mode", () => {
    expect(targetLine("dry-run", "proj-test", "test")).toBe("reconstruct-fairness-months · proj-test · test · DRY-RUN");
    expect(targetLine("rollback-apply", "proj-test", "test")).toBe("reconstruct-fairness-months · proj-test · test · ROLLBACK-APPLY");
  });
  it("prints a refusal by ordinal, reason, kind and month — never a name, key or id", () => {
    const line = refusalLine(REFUSAL, 1, 2, "/tmp/out/rechazo.md");
    expect(line).toBe("rechazo 1 de 2 · exact_count_range · regla fija · restricción 1 de 4, tope 1 · 2026-08 · informe: /tmp/out/rechazo.md");
    for (const secret of ["Ana", "d-ana", "m-ana"]) expect(line).not.toContain(secret);
  });
  it("prints C2's index-based issues as they come", () => {
    const line = refusalLine({ ...REFUSAL, reason: "invalid_body", kind: "corrección", rules: [], issues: [{ path: "people[1].sundayCadence", message: "cadence_and_exact" }] }, 1, 1, null);
    expect(line).toBe("rechazo 1 de 1 · invalid_body · corrección · 2026-08 · people[1].sundayCadence: cadence_and_exact · sin informe");
  });
});

describe("the private refusal report (R13)", () => {
  it("names the rule by ordinal AND key, and the member by name AND id", () => {
    const text = renderRefusalReport({ generatedAt: "2026-10-20T18:00:00.000Z", refusals: [REFUSAL], nameOf });
    expect(text).toContain("## Rechazo 1 de 1 — `exact_count_range`");
    expect(text).toContain("- Regla: restricción 1 de 4, tope 1 · clave `d-ana`");
    expect(text).toContain("- Nombre en la regla: «Ana Ejemplo»");
    expect(text).toContain("- Miembro: Ana E. · `m-ana`");
    expect(text).toContain("Nada se escribió en Sanity");
  });
});

describe("the private table (R11)", () => {
  const text = renderTable(MODEL);
  it("lists the month's services with their «cuenta» flag", () => {
    expect(text).toContain("## 2026-08 — crear");
    expect(text).toContain("| 2026-08-02 | domingo | sí |");
    expect(text).toContain("| 2026-08-30 | especial | no |");
  });
  it("shows status words, reasons, «corregido», join months, seats and blocked dates per person", () => {
    expect(text).toContain("fija 2 · corrección · corregido");
    expect(text).toContain("elegible · Tipo de hoy");
    expect(text).toContain("fuera · antes de su primer servicio en esta línea");
    expect(text).toContain("| — · — · 2026-07 · — | 0 · 0 · 1 · 0 |");
    expect(text).toContain("| 2026-08-15 |");
  });
  it("sorts people with Spanish collation, then by id", () => {
    expect(text.indexOf("Ámbar Ejemplo (`m-ambar`)")).toBeLessThan(text.indexOf("Beto E. (`m-beto`)"));
  });
  it("shows the presence rules as stored, with their key, and states the limitations", () => {
    expect(text).toContain("| presencia 1 de 1 | `d-beto-carla` | Sun.BGV | Beto E., Carla E. | no |");
    expect(text).toContain("Disponibilidad: lo guardado hoy, no lo que había entonces.");
    expect(text).toContain("no puede editar una regla de presencia ni quitar una exclusión por semana");
  });
  it("shows the preview with one decimal through C2's formatter, «al día» for nothing owed, and its sources", () => {
    expect(text).toContain("| Beto E. (`m-beto`) | al día | al día | le deben 0.8 | al día | le deben 0.8 |");
    expect(text).toContain("| Ámbar Ejemplo (`m-ambar`) | al día | al día | al día | al día | al día |");
    expect(text).toContain("2026-06: sin registro (no cuenta) · 2026-07: el registro guardado · 2026-08: el plan");
  });
  it("lists anomalies, notes and the entries that do not apply to this run", () => {
    expect(text).toContain("- 2026-08 · Beto E. (`m-beto`): añadida por corrección.");
    expect(text).toContain("- entrada 1 · Beto E. (`m-beto`): Cantó en septiembre.");
    expect(text).toContain("- entrada 2 · `m-ana` · 2026-10: no aplica a esta corrida");
  });
});

describe("a replace's per-person changes against the stored record («Decision per month», R21)", () => {
  const roles = (patch: Partial<Record<RoleKey, Status>> = {}): Record<RoleKey, Status> => ({
    "Sun.Lead": "out",
    "Sat.Lead": "out",
    "Sun.BGV": "out",
    "Sat.BGV": "out",
    "Sun.Choir": "out",
    "Sat.Choir": "out",
    ...patch,
  });
  const person = (memberId: string, patch: Partial<FairnessMonthBody["people"][number]> = {}): FairnessMonthBody["people"][number] => ({
    memberId,
    roles: roles(),
    exactRules: [],
    exempt: false,
    blocks: [],
    ...patch,
  });
  const existing: Pick<LogicalRecord, "people" | "presence"> = {
    people: [
      { ...person("m-ana", { roles: roles({ "Sun.Lead": "in" }), blocks: [{ date: "2026-07-12", unavailable: true, excludedRoles: [] }] }), name: "Ana E." },
      { ...person("m-greta"), name: "Greta E." },
    ],
    presence: [],
  };
  const planned: Pick<FairnessMonthBody, "people" | "presence"> = {
    people: [
      person("m-ana", { roles: roles({ "Sun.Lead": "in", "Sun.BGV": "exact" }), exactRules: [{ roles: ["Sun.BGV"], count: 2 }], exempt: true }),
      person("m-beto", { sundayCadence: "alternate" }),
    ],
    presence: [{ ruleKey: "d-beto-carla", roles: ["Sun.BGV"], members: ["m-beto", "m-carla"], exclusive: false }],
  };

  it("lists every person added, removed or changed, then every presence rule, by name and id", () => {
    expect(replaceChanges(existing, planned, nameOf)).toEqual([
      { kind: "person", id: "m-ana", name: "Ana E.", change: "changed", details: ["Dom. BGV: fuera → fija 2", "Exenta: no → sí", "fecha bloqueada quitada: 2026-07-12"] },
      { kind: "person", id: "m-beto", name: "Beto E.", change: "added", details: [] },
      { kind: "person", id: "m-greta", name: "Greta E.", change: "removed", details: [] },
      { kind: "presence", id: "d-beto-carla", name: "", change: "added", details: ["Sun.BGV · Beto E., m-carla · no exclusiva"] },
    ]);
  });

  it("renders them under the month, and only for a month planned «reemplazar»", () => {
    const text = renderTable({ ...MODEL, table: [{ ...MODEL.table[0], action: "replace", changes: replaceChanges(existing, planned, nameOf) }] });
    expect(text).toContain("### Cambios frente al registro guardado");
    expect(text).toContain("| Ana E. (`m-ana`) | Dom. BGV: fuera → fija 2 · Exenta: no → sí · fecha bloqueada quitada: 2026-07-12 |");
    expect(text).toContain("| Beto E. (`m-beto`) | nueva en el registro |");
    expect(text).toContain("| Greta E. (`m-greta`) | sale del registro |");
    expect(text).toContain("| presencia `d-beto-carla` | nueva en el registro · Sun.BGV · Beto E., m-carla · no exclusiva |");
    expect(renderTable(MODEL)).not.toContain("Cambios frente al registro guardado");
  });
});

describe("anomaly sentences (R13)", () => {
  it("gives every anomaly type a sentence that names the member", () => {
    for (const code of ANOMALY_CODES) {
      const anomaly: Anomaly = { code, month: "2026-08", memberId: "m-ana", line: "BGV", roleKey: "Sun.BGV", date: "2026-08-02", ruleKey: "d-beto-carla", ruleOrdinal: "presencia 1 de 1", roles: ["Sun.BGV"], count: 1, held: 0, months: ["2026-08"], firstServiceDate: "2026-08-01", type: "sunday_role", roleIds: ["sun-a", "sun-b"], dates: ["2026-08-02"] };
      const text = anomalyText(anomaly, nameOf);
      expect(text.length, code).toBeGreaterThan(20);
      if (code !== "duplicate_target" && code !== "presence_no_seat") expect(text, code).toContain("Ana E.");
    }
    expect(anomalyText({ code: "exact_mismatch", month: "2026-08", memberId: "m-beto", roles: ["Sun.BGV"], count: 1, held: 0 }, nameOf)).toContain("regla fija = 1, tuvo 0");
    expect(anomalyText({ code: "member_gone", month: "2026-08", memberId: "m-hugo" }, nameOf)).toContain("miembro eliminado o fuera de alabanza");
  });
});
````

- [ ] **Step 2: Run it to see it fail**

Run: `git add -A && npx vitest run scripts/__tests__/reconstructReport.test.ts`
Expected: FAIL — `../lib/reconstructReport` does not resolve.

- [ ] **Step 3: Implement**

**Create** `scripts/lib/reconstructReport.ts`:

````ts
// scripts/lib/reconstructReport.ts
//
// The reconstruction's words (solver v3 C4): the private Spanish table (R11), the
// private refusal report (R13), the apply and rollback reports, and the ONLY lines
// stdout and stderr carry — which hold no member name or alias, no member `_id`, no
// rule key and no hash of one (R12). Every fairness figure is formatted through C2's
// one formatter from the ledger's tenths (IF2-13, A17); seat counts are the ledger's
// integers (A39). Pure: no I/O.

import { saldoWords } from "../../app/utils/fairnessFormat";
import {
  ROLE_KEYS,
  compareCodepoint,
  type FairnessMonthBody,
  type LogicalRecord,
  type RoleKey,
  type Status,
  type TabKey,
} from "../../app/utils/fairnessVocabulary";
import type { RunMode } from "./reconstructArgs";
import type { RollbackPlanContent } from "./reconstructPlanFile";
import { LINES, type Anomaly, type CellReason, type Line, type MonthAction, type RollbackAction, type RunRefusal } from "./reconstructTypes";

export const MODE_LABEL: Record<RunMode, string> = {
  "dry-run": "DRY-RUN",
  apply: "APPLY",
  rollback: "ROLLBACK",
  "rollback-apply": "ROLLBACK-APPLY",
};

/** The spec's «Decision per month» labels (plus R1's skip). */
export const ACTION_LABEL: Record<MonthAction, string> = {
  create: "crear",
  replace: "reemplazar",
  unchanged: "sin cambios",
  skip: "sin servicios guardados: no se reconstruye",
  not_reconstruction_owned: "no lo escribió la reconstrucción: no se toca",
  record_edited: "editado después de reconstruir: no se toca",
};

export const ROLLBACK_LABEL: Record<RollbackAction, string> = {
  delete: "borrar",
  none: "sin registro: nada que borrar",
  not_reconstruction_owned: "no lo escribió la reconstrucción: no se toca",
  record_edited: "editado después de reconstruir: no se toca",
};

export const REASON_LABEL: Record<CellReason, string> = {
  tipo: "Tipo de hoy",
  sin_tipo: "su Tipo no cubre el rol",
  regla: "regla de hoy",
  fija: "regla fija de hoy",
  linea: "antes de su primer servicio en esta línea",
  partida: "regla fija partida por el inicio de línea",
  correccion: "corrección",
};

export const SERVICE_TYPE_LABEL: Record<"sunday_role" | "saturday_role" | "special_role", string> = {
  sunday_role: "domingo",
  saturday_role: "sábado",
  special_role: "especial",
};

const LINE_LABEL: Record<Line, string> = { DL: "DL", SL: "SL", BGV: "BGV", CORO: "Coro" };
const ROLE_HEAD: Record<RoleKey, string> = {
  "Sun.Lead": "Dom. Líder",
  "Sat.Lead": "Sáb. Líder",
  "Sun.BGV": "Dom. BGV",
  "Sat.BGV": "Sáb. BGV",
  "Sun.Choir": "Dom. Coro",
  "Sat.Choir": "Sáb. Coro",
};
const SOURCE_LABEL: Record<"planned" | "stored" | "none", string> = {
  planned: "el plan",
  stored: "el registro guardado",
  none: "sin registro (no cuenta)",
};
const PREVIEW_TABS: readonly TabKey[] = ["DL", "SL", "BGV", "CORO", "TOTAL"];

export function statusLabel(status: Status, count: number | null): string {
  return status === "in" ? "elegible" : status === "out" ? "fuera" : `fija ${count ?? "?"}`;
}

export interface TableCell {
  status: Status;
  count: number | null;
  reason: CellReason;
  corrected: boolean;
}

export interface TableRow {
  memberId: string;
  name: string;
  cells: Record<RoleKey, TableCell>;
  joins: Partial<Record<Line, string>>;
  seats: Partial<Record<Line, number>>;
  blocked: string[];
  exempt: boolean;
  exemptCorrected: boolean;
  cadence: boolean;
  cadenceCorrected: boolean;
  blocksCorrected: boolean;
  added: boolean;
}

export interface TableMonth {
  month: string;
  action: MonthAction;
  services: Array<{ date: string; type: string; counted: boolean }>;
  rows: TableRow[];
  presence: Array<{ ordinal: string; ruleKey: string; roles: RoleKey[]; members: string[]; exclusive: boolean }>;
  /** Only on a month planned «reemplazar»: what the replace changes against the stored record, person by person. */
  changes?: ReplaceChange[];
}

/**
 * One line of a «reemplazar» month's per-person diff against the stored record (spec
 * «Decision per month»: «the table shows the per-person diff»; R21: a replace after an
 * edit shows what the edit changed). Private table only: `id` is a member `_id` or a
 * presence `ruleKey`, `name` a display name.
 */
export interface ReplaceChange {
  kind: "person" | "presence";
  id: string;
  name: string;
  change: "added" | "removed" | "changed";
  details: string[];
}

type BodyPerson = FairnessMonthBody["people"][number];
const countFor = (p: BodyPerson, k: RoleKey) => p.exactRules.find((r) => r.roles.includes(k))?.count ?? null;
const blockLabel = (b: BodyPerson["blocks"][number]) => (b.unavailable ? b.date : `${b.date} (${b.excludedRoles.join(", ")})`);
const rulesLabel = (p: BodyPerson) => p.exactRules.map((r) => `${r.roles.join("+")} = ${r.count}`).join("; ") || "ninguna";
const cadenceLabel = (p: BodyPerson) => (p.sundayCadence === "alternate" ? "sí" : "no");

/**
 * The diff a «reemplazar» row shows: every person the replace adds, removes or changes
 * (status words as the table words them, exact-rule grouping, «Exenta», «Mes por medio»,
 * blocked dates), by display name with Spanish collation, then every presence rule it
 * adds, removes or changes, by key. Pure; computes no seat and no figure.
 */
export function replaceChanges(
  existing: Pick<LogicalRecord, "people" | "presence">,
  planned: Pick<FairnessMonthBody, "people" | "presence">,
  nameOf: (id: string) => string,
): ReplaceChange[] {
  const before = new Map(existing.people.map((p) => [p.memberId, p] as const));
  const after = new Map(planned.people.map((p) => [p.memberId, p] as const));
  const people: ReplaceChange[] = [];
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const old = before.get(id);
    const now = after.get(id);
    const name = nameOf(id) || old?.name || "";
    if (!old || !now) {
      people.push({ kind: "person", id, name, change: old ? "removed" : "added", details: [] });
      continue;
    }
    const details: string[] = [];
    for (const k of ROLE_KEYS) {
      const was = statusLabel(old.roles[k], countFor(old, k));
      const is = statusLabel(now.roles[k], countFor(now, k));
      if (was !== is) details.push(`${ROLE_HEAD[k]}: ${was} → ${is}`);
    }
    if (details.length === 0 && rulesLabel(old) !== rulesLabel(now)) details.push(`reglas fijas: ${rulesLabel(old)} → ${rulesLabel(now)}`);
    if (old.exempt !== now.exempt) details.push(`Exenta: ${old.exempt ? "sí" : "no"} → ${now.exempt ? "sí" : "no"}`);
    if (cadenceLabel(old) !== cadenceLabel(now)) details.push(`Mes por medio: ${cadenceLabel(old)} → ${cadenceLabel(now)}`);
    const oldBlocks = new Map(old.blocks.map((b) => [b.date, blockLabel(b)] as const));
    const newBlocks = new Map(now.blocks.map((b) => [b.date, blockLabel(b)] as const));
    for (const date of [...new Set([...oldBlocks.keys(), ...newBlocks.keys()])].sort(compareCodepoint)) {
      const was = oldBlocks.get(date);
      const is = newBlocks.get(date);
      if (was === undefined) details.push(`fecha bloqueada nueva: ${is}`);
      else if (is === undefined) details.push(`fecha bloqueada quitada: ${was}`);
      else if (was !== is) details.push(`fecha bloqueada cambiada: ${was} → ${is}`);
    }
    if (details.length > 0) people.push({ kind: "person", id, name, change: "changed", details });
  }
  people.sort((a, b) => a.name.localeCompare(b.name, "es") || compareCodepoint(a.id, b.id));

  const ruleLabel = (r: FairnessMonthBody["presence"][number]) =>
    `${r.roles.join(", ")} · ${r.members.map((id) => nameOf(id) || id).join(", ")} · ${r.exclusive ? "exclusiva" : "no exclusiva"}`;
  const oldRules = new Map(existing.presence.map((r) => [r.ruleKey, ruleLabel(r)] as const));
  const newRules = new Map(planned.presence.map((r) => [r.ruleKey, ruleLabel(r)] as const));
  const presence: ReplaceChange[] = [];
  for (const key of [...new Set([...oldRules.keys(), ...newRules.keys()])].sort(compareCodepoint)) {
    const was = oldRules.get(key);
    const is = newRules.get(key);
    if (was === undefined) presence.push({ kind: "presence", id: key, name: "", change: "added", details: [is ?? ""] });
    else if (is === undefined) presence.push({ kind: "presence", id: key, name: "", change: "removed", details: [was] });
    else if (was !== is) presence.push({ kind: "presence", id: key, name: "", change: "changed", details: [`${was} → ${is}`] });
  }
  return [...people, ...presence];
}

export interface TableModel {
  generatedAt: string;
  projectId: string;
  dataset: string;
  months: string[];
  previewRun: string;
  overridesHash: string;
  cadenceSettings: { config: number; overrides: number };
  table: TableMonth[];
  preview: {
    window: string[];
    sources: Array<{ month: string; from: "planned" | "stored" | "none" }>;
    /** Balance TENTHS per tab, from the ledger (IF2-8 `tenths.balance`). */
    rows: Array<{ memberId: string; name: string; tabs: Partial<Record<TabKey, number>> }>;
  };
  anomalies: Array<{ anomaly: Anomaly; text: string }>;
  notes: Array<{ ordinal: number; memberId: string; name: string; note: string }>;
  notApplicable: Array<{ ordinal: number; memberId: string; month: string }>;
}

/** R11: rows by display name with Spanish collation, then `_id`. */
const byNameEs = <T extends { name: string; memberId: string }>(a: T, b: T) =>
  a.name.localeCompare(b.name, "es") || (a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0);

export function renderTable(m: TableModel): string {
  const lines: string[] = [];
  lines.push("# Reconstrucción de registros de equidad — tabla para revisar", "");
  lines.push(`- Destino: \`${m.projectId}\` · \`${m.dataset}\``);
  lines.push(`- Generado: ${m.generatedAt} (no entra en la huella)`);
  lines.push(`- Meses pedidos: ${m.months.join(", ")} · vista previa del saldo: corrida ${m.previewRun}`);
  lines.push(`- Archivo de correcciones: ${m.overridesHash === "none" ? "ninguno" : `\`${m.overridesHash}\``}`);
  lines.push(`- «Mes por medio» encontrados: ${m.cadenceSettings.config} en las reglas · ${m.cadenceSettings.overrides} en correcciones`);
  lines.push("- **Disponibilidad: lo guardado hoy, no lo que había entonces.**");
  lines.push(
    "- Las reglas de hoy se aplican hacia atrás. Una corrección no puede editar una regla de presencia ni quitar una exclusión por semana: se aceptan como quedan registradas (ver anomalías) o el mes no se aplica.",
  );
  lines.push("");

  for (const month of m.table) {
    lines.push(`## ${month.month} — ${ACTION_LABEL[month.action]}`, "");
    if (month.action === "skip") continue;
    lines.push("### Servicios", "");
    if (month.services.length === 0) lines.push("_Sin servicios guardados._", "");
    else {
      lines.push("| Fecha | Tipo | Cuenta |", "|---|---|---|");
      for (const s of month.services) lines.push(`| ${s.date} | ${s.type} | ${s.counted ? "sí" : "no"} |`);
      lines.push("");
    }
    lines.push("### Personas", "");
    lines.push(
      `| Persona | ${ROLE_KEYS.map((k) => ROLE_HEAD[k]).join(" | ")} | Inicio de línea (DL · SL · BGV · Coro) | Lugares (DL · SL · BGV · Coro) | Fechas bloqueadas | Exenta | Mes por medio |`,
    );
    lines.push(`|---|${ROLE_KEYS.map(() => "---").join("|")}|---|---|---|---|---|`);
    for (const r of [...month.rows].sort(byNameEs)) {
      const roleCells = ROLE_KEYS.map((k) => {
        const c = r.cells[k];
        return `${statusLabel(c.status, c.count)} · ${REASON_LABEL[c.reason]}${c.corrected ? " · corregido" : ""}`;
      });
      const joins = LINES.map((l) => r.joins[l] ?? "—").join(" · ");
      const seats = LINES.map((l) => String(r.seats[l] ?? 0)).join(" · ");
      const blocked = `${r.blocked.length > 0 ? r.blocked.join(", ") : "—"}${r.blocksCorrected ? " · corregido" : ""}`;
      const who = `${r.name || "(sin nombre)"} (\`${r.memberId}\`)${r.added ? " · añadida por corrección" : ""}`;
      lines.push(
        `| ${who} | ${roleCells.join(" | ")} | ${joins} | ${seats} | ${blocked} | ${r.exempt ? "sí" : "no"}${r.exemptCorrected ? " · corregido" : ""} | ${r.cadence ? "sí" : "no"}${r.cadenceCorrected ? " · corregido" : ""} |`,
      );
    }
    lines.push("");
    if (month.changes) {
      lines.push("### Cambios frente al registro guardado", "");
      if (month.changes.length === 0) lines.push("_Ningún cambio visible por persona._", "");
      else {
        lines.push("| Persona o regla | Cambio |", "|---|---|");
        for (const c of month.changes) {
          const who = c.kind === "person" ? `${c.name || "(sin nombre)"} (\`${c.id}\`)` : `presencia \`${c.id}\``;
          const what = c.change === "added" ? ["nueva en el registro"] : c.change === "removed" ? ["sale del registro"] : [];
          lines.push(`| ${who} | ${[...what, ...c.details].join(" · ")} |`);
        }
        lines.push("");
      }
    }
    lines.push("### Reglas de presencia (como se guardarán)", "");
    if (month.presence.length === 0) lines.push("_Ninguna._", "");
    else {
      lines.push("| Regla | Clave | Roles | Miembros | Exclusiva |", "|---|---|---|---|---|");
      for (const p of month.presence) {
        lines.push(`| ${p.ordinal} | \`${p.ruleKey}\` | ${p.roles.join(", ")} | ${p.members.join(", ")} | ${p.exclusive ? "sí" : "no"} |`);
      }
      lines.push("");
    }
  }

  lines.push(`## Vista previa del saldo — corrida ${m.previewRun} (ventana ${m.preview.window.join(", ")})`, "");
  lines.push(`Registros usados: ${m.preview.sources.map((s) => `${s.month}: ${SOURCE_LABEL[s.from]}`).join(" · ")}`, "");
  lines.push("Cifras del ledger de C2 con un decimal; «le deben» = le toca más de lo que tuvo.", "");
  lines.push("| Persona | DL | SL | BGV | Coro | Total |", "|---|---|---|---|---|---|");
  for (const r of [...m.preview.rows].sort(byNameEs)) {
    lines.push(`| ${r.name || "Miembro eliminado"} (\`${r.memberId}\`) | ${PREVIEW_TABS.map((t) => saldoWords(r.tabs[t] ?? 0)).join(" | ")} |`);
  }
  lines.push("");

  lines.push("## Anomalías (se listan; nada se resuelve solo)", "");
  if (m.anomalies.length === 0) lines.push("_Ninguna._");
  for (const a of m.anomalies) lines.push(`- ${a.text}`);
  lines.push("");
  lines.push("## Correcciones: notas", "");
  if (m.notes.length === 0) lines.push("_Ninguna._");
  for (const n of m.notes) lines.push(`- entrada ${n.ordinal} · ${n.name || "(sin nombre)"} (\`${n.memberId}\`): ${n.note}`);
  lines.push("");
  lines.push("## Correcciones que no aplican a esta corrida", "");
  if (m.notApplicable.length === 0) lines.push("_Ninguna._");
  for (const n of m.notApplicable) lines.push(`- entrada ${n.ordinal} · \`${n.memberId}\` · ${n.month}: no aplica a esta corrida`);
  return `${lines.join("\n")}\n`;
}

/** R13's sentence for an anomaly — private table only (it names people). */
export function anomalyText(a: Anomaly, nameOf: (id: string) => string): string {
  const when = a.month ? `${a.month} · ` : "";
  const who = a.memberId ? `${nameOf(a.memberId) || "miembro sin documento"} (\`${a.memberId}\`)` : "";
  const rule = a.ruleKey ? `${a.ruleOrdinal ?? "presencia"} (\`${a.ruleKey}\`)` : "una regla de presencia";
  const line = a.line ? LINE_LABEL[a.line] : "";
  const months = (a.months ?? []).join(", ");
  switch (a.code) {
    case "seat_while_out":
      return `${when}${who}: tiene un lugar ${a.roleKey} el ${a.date} con estado «fuera»; se queda fuera (un lugar nunca da elegibilidad).`;
    case "seat_unavailable":
      return `${when}${who}: tiene un lugar ${a.roleKey} el ${a.date}, una fecha marcada como no disponible.`;
    case "seat_rule_excluded":
      return `${when}${who}: tiene un lugar ${a.roleKey} el ${a.date}, un fin de semana en que una regla de hoy la excluye de ese rol.`;
    case "join_mid_month":
      return `${when}${who}: su primer lugar en ${line} (${a.date}) no es el primer servicio de esa línea en el mes (${a.firstServiceDate}); si llegó a mitad de mes, corrige con «blockedDates».`;
    case "exact_mismatch":
      return `${when}${who}: regla fija = ${a.count}, tuvo ${a.held} (${(a.roles ?? []).join(", ")}).`;
    case "cadence_not_in":
      return `${when}${who}: tiene «Mes por medio» pero Sun.Lead no está elegible; el ajuste se guarda como lo da el resolvedor.`;
    case "not_ticked_today":
      return `${who}: elegible por Tipo para ${line} pero hoy no está marcada en la lista (${months}); la inferencia puede sobrestimarla.`;
    case "ticked_never_seated":
      return `${who}: marcada hoy para ${line} y sin ningún lugar contado en esa línea: queda «fuera» en ${months} y puede leerse «al día» cuando se le debe. Corrección: «joinMonths».`;
    case "presence_no_seat":
      return `${when}${rule}: aplica el ${a.date} y nadie de la regla tuvo un lugar de presencia; quizá la regla de hoy no regía entonces.`;
    case "presence_outside":
      return `${when}${rule}: el lugar de presencia de ${who} (${(a.dates ?? []).join(", ")}) queda fuera de la población (C2 LG-7).`;
    case "person_added":
      return `${when}${who}: añadida por corrección; las exclusiones por semana de hoy no se le aplican (R8).`;
    case "member_gone":
      return `${when}${who}: miembro eliminado o fuera de alabanza: sus lugares no cuentan y la parte de los demás en esos servicios cambia.`;
    case "duplicate_target":
      return `${when}dos documentos ${a.type} el ${a.date} (${(a.roleIds ?? []).map((id) => `\`${id}\``).join(", ")}): el ledger descarta los dos.`;
    case "second_seat":
      return `${when}${who}: dos lugares de voz en el servicio del ${a.date}; el de ${a.roleKey} se aparta como segundo lugar.`;
    case "rule_split":
      return `${when}${who}: regla fija partida por el inicio de línea; ${(a.roles ?? []).join(", ")} queda «elegible». Si hace falta, restáurala con una regla fija en el archivo de correcciones.`;
    case "lost_block":
      return `${when}${who}: fecha bloqueada perdida (${a.date}): el registro actual la tiene y el nuevo no; el registro se respaldó. Corrección: «blockedDates».`;
  }
}

export function renderRefusalReport(input: { generatedAt: string; refusals: readonly RunRefusal[]; nameOf: (id: string) => string }): string {
  const n = input.refusals.length;
  const lines = [
    "# Reconstrucción de registros de equidad — rechazo",
    "",
    `- Generado: ${input.generatedAt}`,
    "- Nada se escribió en Sanity, ni tabla ni plan.",
    "",
  ];
  input.refusals.forEach((r, i) => {
    lines.push(`## Rechazo ${i + 1} de ${n} — \`${r.reason}\``, "");
    lines.push(`- Tipo: ${r.kind}`);
    if (r.month) lines.push(`- Mes: ${r.month}`);
    if (r.roleKey) lines.push(`- Rol: ${r.roleKey}`);
    for (const rule of r.rules) lines.push(`- Regla: ${rule.ordinal}${rule.key ? ` · clave \`${rule.key}\`` : ""}`);
    if (r.person) lines.push(`- Nombre en la regla: «${r.person}»`);
    for (const id of r.memberIds ?? []) lines.push(`- Miembro: ${input.nameOf(id) || "(sin documento)"} · \`${id}\``);
    for (const issue of r.issues ?? []) lines.push(`- Validador: ${issue.path}: ${issue.message}`);
    lines.push(`- Qué pasa: ${r.detail}`, `- Cómo se arregla: ${r.fix}`, "");
  });
  return `${lines.join("\n")}\n`;
}

export function renderApplyReport(input: {
  generatedAt: string;
  mode: RunMode;
  results: ReadonlyArray<{ month: string; verdict: string; memberIds?: string[] }>;
  notAttempted: readonly string[];
}): string {
  const lines = [`# Reconstrucción de registros de equidad — ${MODE_LABEL[input.mode]}`, "", `- Generado: ${input.generatedAt}`, ""];
  lines.push("| Mes | Resultado |", "|---|---|");
  for (const r of input.results) lines.push(`| ${r.month} | ${r.verdict}${r.memberIds?.length ? ` (${r.memberIds.map((id) => `\`${id}\``).join(", ")})` : ""} |`);
  for (const month of input.notAttempted) lines.push(`| ${month} | sin intentar |`);
  lines.push("", "Una escritura fallida pudo haber llegado: corre el dry run otra vez antes de cualquier reparación (R16).");
  return `${lines.join("\n")}\n`;
}

export function renderRollbackTable(input: { generatedAt: string; projectId: string; dataset: string; content: RollbackPlanContent }): string {
  const lines = [
    "# Reconstrucción de registros de equidad — borrado para revisar",
    "",
    `- Destino: \`${input.projectId}\` · \`${input.dataset}\``,
    `- Generado: ${input.generatedAt} (no entra en la huella)`,
    "- Solo se borra un registro que escribió la reconstrucción y que nadie editó después (R18).",
    "",
    "| Mes | Acción | Registro | Revisión | Origen | Intacto | Respaldo |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const m of input.content.months) {
    const s = m.stored;
    lines.push(
      `| ${m.month} | ${ROLLBACK_LABEL[m.action]} | ${s ? `\`${s.id}\`` : "—"} | ${s ? `\`${s.rev}\`` : "—"} | ${s?.source ?? "—"} | ${s ? (s.recomputedHash === s.contentHash ? "sí" : "no") : "—"} | ${m.backup ? m.backup.file : "—"} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

/** R12: printed before any read. Project and dataset are configuration, not secrets. */
export function targetLine(mode: RunMode, projectId: string, dataset: string): string {
  return `reconstruct-fairness-months · ${projectId} · ${dataset} · ${MODE_LABEL[mode]}`;
}

/** R13's name-free refusal line: ordinal, reason, kind, rule ordinals, role, month, C2's index-based issues, the report's path. */
export function refusalLine(r: RunRefusal, index: number, total: number, reportPath: string | null): string {
  const parts = [`rechazo ${index} de ${total}`, r.reason, r.kind];
  if (r.rules.length > 0) parts.push(r.rules.map((x) => x.ordinal).join("; "));
  if (r.roleKey) parts.push(r.roleKey);
  if (r.month) parts.push(r.month);
  if (r.issues && r.issues.length > 0) parts.push(r.issues.map((x) => `${x.path}: ${x.message}`).join("; "));
  parts.push(reportPath ? `informe: ${reportPath}` : "sin informe");
  return parts.join(" · ");
}
````

- [ ] **Step 4: Run it to see it pass**

Run: `git add -A && npx vitest run scripts/__tests__/reconstructReport.test.ts`
Expected: PASS.

- [ ] **Step 5: Gates and commit**

Run: `git add -A && npx tsc --noEmit && npm test && npx eslint .`
Expected: all green (on the replay base `a35f812e`: **474 files / 8755 tests**, 81 warnings); 0 errors; warnings at baseline.

```bash
git add -A
git commit -m "feat(fairness): the reconstruction's Spanish table, refusal report and name-free lines" -m "Solver v3 C4 R11-R13. The private table shows each month's services with their counted flag, every person's status words, reason codes and corregido marks, join months, the ledger's seat counts, blocked dates, Exenta and Mes por medio, the presence rules as they will be stored, a replace's per-person changes against the stored record, the balance preview through C2's one formatter, the anomalies and the corrections' notes. Stdout and stderr lines carry the target, reason codes and rule ordinals only; names, member ids and rule keys go to the private report."
```

---
## Task 7: The runner and the dry run, over the R23 world — **[CRITICAL slice: the token check before any client, the reads, and the plan that consent attaches to]**

Spec R1 (refusal before any read; the skip; a recorded month never skipped), R3 (token before any client; `published`, no CDN; builders only; a failed or malformed read writes no file; an absent `solverConfig` refuses), R4–R13 end to end, R17 (determinism), R18 (backup before the plan), R19 (runtime and tokens), R23 (the fictitious world, injected fake clients, no network). This task adds the dry run only; until Tasks 8 and 9, the other three modes refuse.

**Files:**
- Create: `scripts/lib/reconstructRun.ts`, `scripts/__tests__/__fixtures__/reconstructWorld.ts`, `scripts/__tests__/__fixtures__/reconstructHarness.ts`
- Test: `scripts/__tests__/reconstructDryRun.test.ts` and its file snapshot `scripts/__tests__/__fixtures__/reconstruct-golden-table.md` (created in Step 1 from the bytes given there)

**Interfaces:**
- Consumes: C2's builders `solverConfigQuery`, `worshipRosterQuery`, `fairnessMonthsThroughQuery`, `serviceCountsInMonths`, `voiceRolesInRangeQuery`, `type BoundQuery` (`app/utils/serviceReadQueries.ts`, IF2-24 … IF2-28 **[verified c2-t10]**); `solverConfigFromDocument`, `buildSolverConfigDocument` (tests) (`app/utils/solverConfigWriteRequest.ts`); `resolveMonthEligibility` (**[verified a35f812e]**); `fairnessRecordEnvironment` (`app/utils/solverDeployment.ts`, REC-2 **[verified c2-t10]**); `displayMemberName`; `countsForFairness`; types `FairnessDeleteEntry`, `FairnessExecution`, `FairnessStamps` (write-request module, type-only); `createFakeFairnessSanity`, `type FakeDoc` (`app/utils/__tests__/__fixtures__/fakeFairnessSanity.ts` **[verified c2-t10]**); `executeFairnessMonthWrites`, `buildFairnessMonthDocument` (tests only); Tasks 1–6.
- Produces: `interface ClientConfig { projectId; dataset; apiVersion; token; perspective: "published"; useCdn: false }`; `type ExecuteFn`; `interface RunDeps { env; repoRoot; platform; now; createClient(config: ClientConfig): SanityClient; execute: ExecuteFn; out; err; gitFs? }`; `errorClass(e: unknown): string`; `runReconstruction(argv: readonly string[], deps: RunDeps): Promise<number>`. Test fixtures: `NOW`, `NAMES`, `MEMBER_IDS`, `RULE_KEYS`, `restriction`, `cap`, `member`, `WORLD_CONFIG`, `configDoc`, `MEMBERS`, `SERVICES`, `DRAFTS`, `JUNE_MANUAL`, `JULY_RECONSTRUCTED`, `SEPTEMBER_BODY`, `SEPTEMBER_EDITED`, `OVERRIDES`, `worldDocs`, `storedRecord`, `MONTHS`; `harness(docs, opts)`, `ENV`, `REPO_ROOT`.

- [ ] **Step 1: Write the world, the harness and the failing test**

**Create** `scripts/__tests__/__fixtures__/reconstructWorld.ts`:

````ts
// The fictitious world of solver v3 C4's tests (spec R23) — NOT a test file. Every name
// is invented. Rule keys and one member `_id` have production's SEED shape
// (`d-<first-name>`, `kidsMember-<slug>`), so the key-hygiene test checks the identifier
// shape production really has, not only opaque ids (R12).
//
// People (worship roster unless noted):
//   Ana Ejemplo    m-ana            voz+sunday_lead, ministries absent; rule d-ana excludes Sat.*; a Sat.BGV seat on 1 Aug
//   Beto Ejemplo   m-beto           voz+sunday_lead, ["worship"]; Sun.BGV == 1 (rule r7k2, cap c1q9); holds 0 in August
//   Carla Ejemplo  m-carla          voz+support, ministries []; newcomer: first BGV seat 13 Sep (mid-month); not ticked today
//   Dani Ejemplo   kidsMember-dani  voz+sunday_lead, ["kids","worship"]; «Mes por medio» (rule c9p4); one Sunday lead (19 Jul)
//   Elena Ejemplo  m-elena          voz+sunday_lead; ticked in today's Sunday pool and never seated
//   Fausto Ejemplo m-fausto         sunday_lead only — no voz; a Sun.BGV seat on 13 Sep; the corrections file adds him
//   Iván Ejemplo   m-ivan           voz+saturday_lead; a week-2 Saturday exclusion (rule w3x8, e5m1)
//   Greta Ejemplo  m-greta          voz+support, ["kids"] — kids-only, ticked (stale) in support; never on the worship roster
//   m-hugo                          no member document (deleted); a Sun.BGV seat on 2 Aug
// Presence d-beto-carla (Beto + Carla on Sun.BGV); conflict d-ana-beto (Ana, Beto, Sun.Lead) — so the pair is not exclusive.
// Records: June manual, July reconstructed and intact (content differs; holds a date Ana has since deleted),
// September reconstructed then hand-edited. August has none.

import type { PersonRestriction, RestrictionCap, SolverConfig } from "@/app/components/admin/plannerModel";
import type { FakeDoc } from "@/app/utils/__tests__/__fixtures__/fakeFairnessSanity";
import { buildFairnessMonthDocument } from "@/app/utils/fairnessMonthWriteRequest";
import type { FairnessMonthBody, RoleKey, Status } from "@/app/utils/fairnessVocabulary";
import { buildSolverConfigDocument } from "@/app/utils/solverConfigWriteRequest";

export const NOW = "2026-10-20T18:00:00.000Z";
export const MONTHS = "2026-06,2026-07,2026-08,2026-09";

/** Every fictitious name and alias of this world — none may reach stdout or stderr (R12). */
export const NAMES = [
  "Ana Ejemplo", "Ana E.", "Beto Ejemplo", "Beto E.", "Carla Ejemplo", "Carla E.", "Dani Ejemplo", "Dani E.",
  "Elena Ejemplo", "Elena E.", "Fausto Ejemplo", "Fausto E.", "Iván Ejemplo", "Iván E.", "Greta Ejemplo", "Greta E.",
];
/** Every member `_id` of this world. */
export const MEMBER_IDS = ["m-ana", "m-beto", "m-carla", "kidsMember-dani", "m-elena", "m-fausto", "m-ivan", "m-greta", "m-hugo"];
/** Every `solverConfig` rule id of this world (restrictions, caps, week exclusion, conflict, presence). */
export const RULE_KEYS = ["d-ana", "r7k2", "c1q9", "c9p4", "w3x8", "e5m1", "d-ana-beto", "d-beto-carla"];

export const member = (id: string, member_name: string, alias: string, memberType: string[], extra: Record<string, unknown> = {}): FakeDoc => ({
  _id: id,
  _type: "teamMembers",
  member_name,
  alias,
  memberType,
  ...extra,
});

export const MEMBERS: FakeDoc[] = [
  member("m-ana", "Ana Ejemplo", "Ana E.", ["voz", "sunday_lead"], { unavailableDates: ["2026-08-15"] }),
  member("m-beto", "Beto Ejemplo", "Beto E.", ["voz", "sunday_lead"], { ministries: ["worship"], unavailableDates: ["2026-07-26", "2025-12-25"] }),
  member("m-carla", "Carla Ejemplo", "Carla E.", ["voz", "support"], { ministries: [], unavailableDates: ["2026-09-13"] }),
  member("kidsMember-dani", "Dani Ejemplo", "Dani E.", ["voz", "sunday_lead"], { ministries: ["kids", "worship"] }),
  member("m-elena", "Elena Ejemplo", "Elena E.", ["voz", "sunday_lead"]),
  member("m-fausto", "Fausto Ejemplo", "Fausto E.", ["sunday_lead"]),
  member("m-ivan", "Iván Ejemplo", "Iván E.", ["voz", "saturday_lead"]),
  member("m-greta", "Greta Ejemplo", "Greta E.", ["voz", "support"], { ministries: ["kids"] }),
];

export const restriction = (id: string, person: string, patch: Partial<PersonRestriction> = {}): PersonRestriction => ({
  id,
  person,
  excludedPatterns: [],
  fairness: "none",
  fairnessSlack: 1,
  weekExclusions: [],
  caps: [],
  ...patch,
});
export const cap = (id: string, pattern: string, value: number, patch: Partial<RestrictionCap> = {}): RestrictionCap => ({
  id,
  pattern,
  op: "==",
  value,
  relative: false,
  relOffset: 0,
  ...patch,
});

export const WORLD_CONFIG: SolverConfig = {
  sundayLeads: ["kidsMember-dani", "m-ana", "m-beto", "m-elena"],
  saturdayLeads: ["m-ivan"],
  support: ["m-greta"],
  restrictions: [
    restriction("d-ana", "Ana Ejemplo", { excludedPatterns: ["Sat.*"] }),
    restriction("r7k2", "Beto Ejemplo", { caps: [cap("c1q9", "Sun.BGV", 1)] }),
    restriction("c9p4", "Dani Ejemplo", { sundayCadence: "alternate" }),
    restriction("w3x8", "Iván Ejemplo", { weekExclusions: [{ id: "e5m1", week: 2, pattern: "Sat.*" }] }),
  ],
  conflicts: [{ id: "d-ana-beto", personA: "Ana Ejemplo", personB: "Beto Ejemplo", pattern: "Sun.Lead" }],
  presence: [{ id: "d-beto-carla", persons: ["Beto Ejemplo", "Carla Ejemplo"], pattern: "Sun.BGV" }],
};

/** The stored singleton, built by C2/C3's own serializer (never a hand-written shape). */
export function configDoc(config: SolverConfig = WORLD_CONFIG): FakeDoc {
  return buildSolverConfigDocument({ config, now: "2026-10-01T00:00:00.000Z" }) as unknown as FakeDoc;
}

const refs = (ids: string[] = []) => ids.map((id, i) => ({ _key: `k${i}`, _type: "reference", _ref: id }));
type Seats = { Lead?: string[]; BGVs?: string[]; Chorus?: string[] };
const weekend = (id: string, type: "sunday_role" | "saturday_role", week: string, seats: Seats, extra: Record<string, unknown> = {}): FakeDoc => ({
  _id: id,
  _type: type,
  week,
  published: true,
  Lead: refs(seats.Lead),
  BGVs: refs(seats.BGVs),
  Chorus: refs(seats.Chorus),
  ...extra,
});
const special = (id: string, date: string, name: string, seats: Seats, extra: Record<string, unknown> = {}): FakeDoc => ({
  _id: id,
  _type: "special_role",
  date,
  service_name: name,
  published: true,
  Lead: refs(seats.Lead),
  BGVs: refs(seats.BGVs),
  Chorus: refs(seats.Chorus),
  ...extra,
});

export const SERVICES: FakeDoc[] = [
  weekend("sun-2026-07-05", "sunday_role", "2026-07-05", { Lead: ["m-ana"], BGVs: ["m-beto"] }),
  weekend("sat-2026-07-11", "saturday_role", "2026-07-11", { Lead: ["m-ivan"] }),
  weekend("sun-2026-07-19", "sunday_role", "2026-07-19", { Lead: ["kidsMember-dani"], Chorus: ["m-ana"] }),
  weekend("sat-2026-08-01", "saturday_role", "2026-08-01", { Lead: ["m-ivan"], BGVs: ["m-ana"] }),
  weekend("sun-2026-08-02", "sunday_role", "2026-08-02", { Lead: ["m-ana"], BGVs: ["m-hugo"] }),
  special("spe-2026-08-08", "2026-08-08", "Campamento", { Lead: ["m-ivan"] }, { countsForFairness: true }),
  weekend("sun-2026-08-16-a", "sunday_role", "2026-08-16", { Lead: ["m-ana"], BGVs: ["m-carla"] }),
  weekend("sun-2026-08-16-b", "sunday_role", "2026-08-16", { Lead: ["m-beto"] }),
  weekend("sat-2026-08-22", "saturday_role", "2026-08-22", { Lead: ["m-ivan"], BGVs: ["m-beto"] }, { published: false }),
  special("spe-2026-08-30", "2026-08-30", "Bautizos", { Chorus: ["m-carla"] }),
  weekend("sun-2026-09-06", "sunday_role", "2026-09-06", { Lead: ["m-ana"], BGVs: ["m-beto"] }),
  weekend("sun-2026-09-13", "sunday_role", "2026-09-13", { Lead: ["m-ana"], BGVs: ["m-carla", "m-fausto"], Chorus: ["m-ana"] }),
  weekend("sat-2026-09-19", "saturday_role", "2026-09-19", { Lead: ["m-ivan"] }),
];

/** Draft overlays the builders must never read (R3: canonical documents only). */
export const DRAFTS: FakeDoc[] = [
  weekend("drafts.sun-2026-09-06", "sunday_role", "2026-09-06", { Lead: ["m-elena"] }),
  member("drafts.m-elena", "Elena Ejemplo", "Elena E.", []),
];

const ALIAS = new Map([
  ["m-ana", "Ana E."],
  ["m-beto", "Beto E."],
  ["m-carla", "Carla E."],
  ["kidsMember-dani", "Dani E."],
  ["m-elena", "Elena E."],
  ["m-fausto", "Fausto E."],
  ["m-ivan", "Iván E."],
]);
const OUT: Record<RoleKey, Status> = {
  "Sun.Lead": "out",
  "Sat.Lead": "out",
  "Sun.BGV": "out",
  "Sat.BGV": "out",
  "Sun.Choir": "out",
  "Sat.Choir": "out",
};
const item = (memberId: string, roles: Partial<Record<RoleKey, Status>>, extra: Partial<FairnessMonthBody["people"][number]> = {}) => ({
  memberId,
  roles: { ...OUT, ...roles },
  exactRules: [],
  exempt: false,
  blocks: [],
  ...extra,
});

/** A stored record, built by C2's own document builder (C4 never builds one; tests may). */
export const storedRecord = (body: FairnessMonthBody, source: "manual" | "reconstructed", rev: string): FakeDoc =>
  ({
    ...buildFairnessMonthDocument({
      body,
      source,
      engine: source === "reconstructed" ? "v2" : "v3",
      environment: "local",
      recordedAt: "2026-10-02T00:00:00.000Z",
      recordedBy: source === "reconstructed" ? "script:reconstruct-fairness-months" : "m-beto",
      names: ALIAS,
    }),
    _rev: rev,
  }) as unknown as FakeDoc;

/** June: another writer's record → «no lo escribió la reconstrucción: no se toca». */
export const JUNE_MANUAL = storedRecord({ month: "2026-06", people: [item("m-ana", {})], presence: [] }, "manual", "rev-jun");

/** July: intact, reconstructed, different content → «reemplazar»; it holds 12 Jul for Ana, a date she has since deleted. */
export const JULY_RECONSTRUCTED = storedRecord(
  { month: "2026-07", people: [item("m-ana", { "Sun.Lead": "in" }, { blocks: [{ date: "2026-07-12", unavailable: true, excludedRoles: [] }] })], presence: [] },
  "reconstructed",
  "rev-jul",
);

/** September exactly as the run computes it with the corrections file … */
export const SEPTEMBER_BODY: FairnessMonthBody = {
  month: "2026-09",
  people: [
    item("kidsMember-dani", { "Sun.Lead": "in" }, { sundayCadence: "alternate" }),
    item("m-ana", { "Sun.Lead": "in", "Sun.BGV": "in", "Sun.Choir": "in" }),
    item("m-beto", { "Sun.BGV": "exact", "Sat.BGV": "in" }, { exactRules: [{ roles: ["Sun.BGV"], count: 1 }] }),
    item("m-carla", { "Sun.BGV": "in", "Sat.BGV": "in" }, {
      blocks: [
        { date: "2026-09-06", unavailable: true, excludedRoles: [] },
        { date: "2026-09-13", unavailable: true, excludedRoles: [] },
      ],
    }),
    item("m-elena", {}),
    item("m-fausto", { "Sun.BGV": "in" }),
    item("m-ivan", { "Sat.Lead": "in" }, { blocks: [{ date: "2026-09-12", unavailable: false, excludedRoles: ["Sat.Lead", "Sat.BGV", "Sat.Choir"] }] }),
  ],
  presence: [{ ruleKey: "d-beto-carla", roles: ["Sun.BGV"], members: ["m-beto", "m-carla"], exclusive: false }],
};

/** … then hand-edited after it was written (Elena's Sun.Lead) → «editado después de reconstruir: no se toca». */
export const SEPTEMBER_EDITED: FakeDoc = (() => {
  const doc = storedRecord(SEPTEMBER_BODY, "reconstructed", "rev-sep") as unknown as { people: Array<{ member: { _ref: string }; roles: Record<string, string> }> };
  const elena = doc.people.find((p) => p.member._ref === "m-elena");
  if (elena) elena.roles.sunLead = "in";
  return doc as unknown as FakeDoc;
})();

/** The corrections file of the main run: an added person, a mid-month newcomer's blocked date, an out-of-run month. */
export const OVERRIDES = JSON.stringify(
  {
    schemaVersion: 1,
    members: {
      "m-fausto": { note: "Cantó en septiembre; hoy su Tipo ya no tiene voz.", months: { "2026-09": { roles: { "Sun.BGV": "in" } } } },
      "m-carla": { note: "Llegó a mitad de septiembre.", blockedDates: [{ date: "2026-09-06" }] },
      "m-ivan": { months: { "2026-10": { roles: { "Sat.BGV": "in" } } } },
    },
  },
  null,
  2,
);

export function worldDocs(opts: { config?: SolverConfig | null; without?: string[]; extra?: FakeDoc[] } = {}): FakeDoc[] {
  const config = opts.config === null ? [] : [configDoc(opts.config ?? WORLD_CONFIG)];
  const without = new Set(opts.without ?? []);
  const all = [...MEMBERS, ...SERVICES, ...DRAFTS, JUNE_MANUAL, JULY_RECONSTRUCTED, SEPTEMBER_EDITED, ...config];
  return [...all.filter((d) => !without.has(d._id)), ...(opts.extra ?? [])];
}
````

**Create** `scripts/__tests__/__fixtures__/reconstructHarness.ts`:

````ts
// A run of the reconstruction CLI's core against C2's in-memory Content Lake — NOT a
// test file. Clients are the fake's (real GROQ through groq-js); the executor is C2's
// real one unless a test wraps it; the clock is pinned to 20 Oct 2026 (CDMX) and ticks
// one second per call; every file goes to a temporary folder outside the repository.
// Nothing here touches Sanity, the network or `.env.local` (R23).

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createFakeFairnessSanity, type FakeDoc } from "@/app/utils/__tests__/__fixtures__/fakeFairnessSanity";
import { executeFairnessMonthWrites } from "@/app/utils/fairnessMonthWriteRequest";
import { runReconstruction, type ClientConfig, type ExecuteFn, type RunDeps } from "../../lib/reconstructRun";
import { NOW, OVERRIDES } from "./reconstructWorld";

export const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
export const ENV: Record<string, string | undefined> = {
  NEXT_PUBLIC_SANITY_PROJECT_ID: "proj-test",
  NEXT_PUBLIC_SANITY_DATASET: "test",
  SANITY_API_READ_TOKEN: "test-read-token",
  SANITY_WRITE_TOKEN: "test-write-token",
};

export type Harness = ReturnType<typeof harness>;

export function harness(docs: FakeDoc[], opts: { env?: Record<string, string | undefined>; now?: string; execute?: ExecuteFn } = {}) {
  const lake = createFakeFairnessSanity(docs);
  const work = mkdtempSync(path.join(tmpdir(), "owt-reconstruct-"));
  const outDir = path.join(work, "out");
  const overridesFile = path.join(work, "overrides.json");
  writeFileSync(overridesFile, OVERRIDES);
  const out: string[] = [];
  const err: string[] = [];
  const configs: ClientConfig[] = [];
  let tick = 0;
  const deps: RunDeps = {
    env: opts.env ?? ENV,
    repoRoot: REPO_ROOT,
    platform: process.platform,
    now: () => new Date(Date.parse(opts.now ?? NOW) + 1000 * tick++),
    createClient: (config) => {
      configs.push(config);
      return config.token === ENV.SANITY_WRITE_TOKEN ? lake.clients.write : lake.clients.read;
    },
    execute: opts.execute ?? ((input) => executeFairnessMonthWrites(input)),
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  };
  const lastValue = (prefix: string) => {
    const line = [...out].reverse().find((l) => l.startsWith(prefix));
    if (line === undefined) throw new Error(`no stdout line starting with «${prefix}»`);
    return line.slice(prefix.length);
  };
  const run = (argv: string[]) => runReconstruction(argv, deps);
  return {
    lake,
    deps,
    out,
    err,
    configs,
    work,
    outDir,
    overridesFile,
    run,
    dryRun: (months: string, extra: string[] = []) => run(["--months", months, "--out", outDir, ...extra]),
    applyLast: (extra: string[] = []) => run(["--apply", "--plan", lastValue("plan: "), "--fingerprint", lastValue("huella del plan: "), "--out", outDir, ...extra]),
    planPath: () => lastValue("plan: "),
    tablePath: () => lastValue("tabla: "),
    fingerprint: () => lastValue("huella del plan: "),
    readPlan: () => JSON.parse(readFileSync(lastValue("plan: "), "utf8")),
    runDirs: () => {
      try {
        return readdirSync(outDir).sort();
      } catch {
        return [];
      }
    },
    allOutput: () => [...out, ...err].join("\n"),
    cleanup: () => rmSync(work, { recursive: true, force: true }),
  };
}
````

The dry-run test's file snapshot (`toMatchFileSnapshot`), exactly as the replay's first run on `a35f812e` wrote it and as it was then checked by hand against R4–R13 and the world's comments (see Step 4). It ends with one newline. Never regenerate it to make the test pass: a difference is a finding about the code or the world.

**Create** `scripts/__tests__/__fixtures__/reconstruct-golden-table.md`:

````markdown
# Reconstrucción de registros de equidad — tabla para revisar

- Destino: `proj-test` · `test`
- Generado: <hora>
- Meses pedidos: 2026-06, 2026-07, 2026-08, 2026-09 · vista previa del saldo: corrida 2026-10
- Archivo de correcciones: `sha256:7a7af344c4f63fd292004376973e3bcacc61f797d5847940798e4189fdc35da8`
- «Mes por medio» encontrados: 1 en las reglas · 0 en correcciones
- **Disponibilidad: lo guardado hoy, no lo que había entonces.**
- Las reglas de hoy se aplican hacia atrás. Una corrección no puede editar una regla de presencia ni quitar una exclusión por semana: se aceptan como quedan registradas (ver anomalías) o el mes no se aplica.

## 2026-06 — no lo escribió la reconstrucción: no se toca

### Servicios

_Sin servicios guardados._

### Personas

| Persona | Dom. Líder | Sáb. Líder | Dom. BGV | Sáb. BGV | Dom. Coro | Sáb. Coro | Inicio de línea (DL · SL · BGV · Coro) | Lugares (DL · SL · BGV · Coro) | Fechas bloqueadas | Exenta | Mes por medio |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Ana E. (`m-ana`) | fuera · antes de su primer servicio en esta línea | fuera · regla de hoy | fuera · antes de su primer servicio en esta línea | fuera · regla de hoy | fuera · antes de su primer servicio en esta línea | fuera · regla de hoy | 2026-07 · — · 2026-08 · 2026-07 | 0 · 0 · 0 · 0 | — | no | no |
| Beto E. (`m-beto`) | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | — · — · 2026-07 · — | 0 · 0 · 0 · 0 | — | no | no |
| Carla E. (`m-carla`) | fuera · su Tipo no cubre el rol | fuera · su Tipo no cubre el rol | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | — · — · 2026-09 · — | 0 · 0 · 0 · 0 | — | no | no |
| Dani E. (`kidsMember-dani`) | elegible · Tipo de hoy | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | 2026-07 · — · — · — | 0 · 0 · 0 · 0 | — | no | sí |
| Elena E. (`m-elena`) | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | — · — · — · — | 0 · 0 · 0 · 0 | — | no | no |
| Iván E. (`m-ivan`) | fuera · su Tipo no cubre el rol | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | — · 2026-07 · — · — | 0 · 0 · 0 · 0 | 2026-06-13 (Sat.Lead, Sat.BGV, Sat.Choir) | no | no |

### Reglas de presencia (como se guardarán)

| Regla | Clave | Roles | Miembros | Exclusiva |
|---|---|---|---|---|
| presencia 1 de 1 | `d-beto-carla` | Sun.BGV | Beto E., Carla E. | no |

## 2026-07 — reemplazar

### Servicios

| Fecha | Tipo | Cuenta |
|---|---|---|
| 2026-07-05 | domingo | sí |
| 2026-07-11 | sábado | sí |
| 2026-07-19 | domingo | sí |

### Personas

| Persona | Dom. Líder | Sáb. Líder | Dom. BGV | Sáb. BGV | Dom. Coro | Sáb. Coro | Inicio de línea (DL · SL · BGV · Coro) | Lugares (DL · SL · BGV · Coro) | Fechas bloqueadas | Exenta | Mes por medio |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Ana E. (`m-ana`) | elegible · Tipo de hoy | fuera · regla de hoy | fuera · antes de su primer servicio en esta línea | fuera · regla de hoy | elegible · Tipo de hoy | fuera · regla de hoy | 2026-07 · — · 2026-08 · 2026-07 | 1 · 0 · 0 · 1 | — | no | no |
| Beto E. (`m-beto`) | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fija 1 · regla fija de hoy | elegible · Tipo de hoy | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | — · — · 2026-07 · — | 0 · 0 · 1 · 0 | 2026-07-26 | no | no |
| Carla E. (`m-carla`) | fuera · su Tipo no cubre el rol | fuera · su Tipo no cubre el rol | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | — · — · 2026-09 · — | 0 · 0 · 0 · 0 | — | no | no |
| Dani E. (`kidsMember-dani`) | elegible · Tipo de hoy | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | 2026-07 · — · — · — | 1 · 0 · 0 · 0 | — | no | sí |
| Elena E. (`m-elena`) | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | — · — · — · — | 0 · 0 · 0 · 0 | — | no | no |
| Iván E. (`m-ivan`) | fuera · su Tipo no cubre el rol | elegible · Tipo de hoy | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | — · 2026-07 · — · — | 0 · 1 · 0 · 0 | 2026-07-11 (Sat.Lead, Sat.BGV, Sat.Choir) | no | no |

### Cambios frente al registro guardado

| Persona o regla | Cambio |
|---|---|
| Ana E. (`m-ana`) | Dom. Coro: fuera → elegible · fecha bloqueada quitada: 2026-07-12 |
| Beto E. (`m-beto`) | nueva en el registro |
| Carla E. (`m-carla`) | nueva en el registro |
| Dani E. (`kidsMember-dani`) | nueva en el registro |
| Elena E. (`m-elena`) | nueva en el registro |
| Iván E. (`m-ivan`) | nueva en el registro |
| presencia `d-beto-carla` | nueva en el registro · Sun.BGV · Beto E., Carla E. · no exclusiva |

### Reglas de presencia (como se guardarán)

| Regla | Clave | Roles | Miembros | Exclusiva |
|---|---|---|---|---|
| presencia 1 de 1 | `d-beto-carla` | Sun.BGV | Beto E., Carla E. | no |

## 2026-08 — crear

### Servicios

| Fecha | Tipo | Cuenta |
|---|---|---|
| 2026-08-01 | sábado | sí |
| 2026-08-02 | domingo | sí |
| 2026-08-08 | especial | sí |
| 2026-08-16 | domingo | sí |
| 2026-08-16 | domingo | sí |
| 2026-08-22 | sábado | sí |
| 2026-08-30 | especial | no |

### Personas

| Persona | Dom. Líder | Sáb. Líder | Dom. BGV | Sáb. BGV | Dom. Coro | Sáb. Coro | Inicio de línea (DL · SL · BGV · Coro) | Lugares (DL · SL · BGV · Coro) | Fechas bloqueadas | Exenta | Mes por medio |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Ana E. (`m-ana`) | elegible · Tipo de hoy | fuera · regla de hoy | elegible · Tipo de hoy | fuera · regla de hoy | elegible · Tipo de hoy | fuera · regla de hoy | 2026-07 · — · 2026-08 · 2026-07 | 1 · 0 · 1 · 0 | 2026-08-15 | no | no |
| Beto E. (`m-beto`) | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fija 1 · regla fija de hoy | elegible · Tipo de hoy | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | — · — · 2026-07 · — | 0 · 0 · 1 · 0 | — | no | no |
| Carla E. (`m-carla`) | fuera · su Tipo no cubre el rol | fuera · su Tipo no cubre el rol | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | — · — · 2026-09 · — | 0 · 0 · 0 · 0 | — | no | no |
| Dani E. (`kidsMember-dani`) | elegible · Tipo de hoy | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | 2026-07 · — · — · — | 0 · 0 · 0 · 0 | — | no | sí |
| Elena E. (`m-elena`) | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | — · — · — · — | 0 · 0 · 0 · 0 | — | no | no |
| Iván E. (`m-ivan`) | fuera · su Tipo no cubre el rol | elegible · Tipo de hoy | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | — · 2026-07 · — · — | 0 · 3 · 0 · 0 | 2026-08-08 (Sat.Lead, Sat.BGV, Sat.Choir) | no | no |

### Reglas de presencia (como se guardarán)

| Regla | Clave | Roles | Miembros | Exclusiva |
|---|---|---|---|---|
| presencia 1 de 1 | `d-beto-carla` | Sun.BGV | Beto E., Carla E. | no |

## 2026-09 — editado después de reconstruir: no se toca

### Servicios

| Fecha | Tipo | Cuenta |
|---|---|---|
| 2026-09-06 | domingo | sí |
| 2026-09-13 | domingo | sí |
| 2026-09-19 | sábado | sí |

### Personas

| Persona | Dom. Líder | Sáb. Líder | Dom. BGV | Sáb. BGV | Dom. Coro | Sáb. Coro | Inicio de línea (DL · SL · BGV · Coro) | Lugares (DL · SL · BGV · Coro) | Fechas bloqueadas | Exenta | Mes por medio |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Ana E. (`m-ana`) | elegible · Tipo de hoy | fuera · regla de hoy | elegible · Tipo de hoy | fuera · regla de hoy | elegible · Tipo de hoy | fuera · regla de hoy | 2026-07 · — · 2026-08 · 2026-07 | 2 · 0 · 0 · 1 | — | no | no |
| Beto E. (`m-beto`) | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fija 1 · regla fija de hoy | elegible · Tipo de hoy | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | — · — · 2026-07 · — | 0 · 0 · 1 · 0 | — | no | no |
| Carla E. (`m-carla`) | fuera · su Tipo no cubre el rol | fuera · su Tipo no cubre el rol | elegible · Tipo de hoy | elegible · Tipo de hoy | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | — · — · 2026-09 · — | 0 · 0 · 1 · 0 | 2026-09-06, 2026-09-13 · corregido | no | no |
| Dani E. (`kidsMember-dani`) | elegible · Tipo de hoy | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | 2026-07 · — · — · — | 0 · 0 · 0 · 0 | — | no | sí |
| Elena E. (`m-elena`) | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | — · — · — · — | 0 · 0 · 0 · 0 | — | no | no |
| Fausto E. (`m-fausto`) · añadida por corrección | fuera · su Tipo no cubre el rol | fuera · su Tipo no cubre el rol | elegible · corrección · corregido | fuera · su Tipo no cubre el rol | fuera · su Tipo no cubre el rol | fuera · su Tipo no cubre el rol | — · — · 2026-09 · — | 0 · 0 · 1 · 0 | — | no | no |
| Iván E. (`m-ivan`) | fuera · su Tipo no cubre el rol | elegible · Tipo de hoy | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | fuera · antes de su primer servicio en esta línea | — · 2026-07 · — · — | 0 · 1 · 0 · 0 | 2026-09-12 (Sat.Lead, Sat.BGV, Sat.Choir) | no | no |

### Reglas de presencia (como se guardarán)

| Regla | Clave | Roles | Miembros | Exclusiva |
|---|---|---|---|---|
| presencia 1 de 1 | `d-beto-carla` | Sun.BGV | Beto E., Carla E. | no |

## Vista previa del saldo — corrida 2026-10 (ventana 2026-07, 2026-08, 2026-09)

Registros usados: 2026-07: el plan · 2026-08: el plan · 2026-09: el registro guardado

Cifras del ledger de C2 con un decimal; «le deben» = le toca más de lo que tuvo.

| Persona | DL | SL | BGV | Coro | Total |
|---|---|---|---|---|---|
| Miembro eliminado (`m-hugo`) | al día | al día | al día | al día | al día |
| Ana E. (`m-ana`) | 1.0 de más | al día | al día | al día | 1.0 de más |
| Beto E. (`m-beto`) | al día | al día | al día | al día | al día |
| Carla E. (`m-carla`) | al día | al día | al día | al día | al día |
| Dani E. (`kidsMember-dani`) | al día | al día | al día | al día | al día |
| Elena E. (`m-elena`) | le deben 1.0 | al día | al día | al día | le deben 1.0 |
| Fausto E. (`m-fausto`) | al día | al día | al día | al día | al día |
| Iván E. (`m-ivan`) | al día | al día | al día | al día | al día |

## Anomalías (se listan; nada se resuelve solo)

- Carla E. (`m-carla`): elegible por Tipo para BGV pero hoy no está marcada en la lista (2026-06, 2026-07, 2026-08, 2026-09); la inferencia puede sobrestimarla.
- Carla E. (`m-carla`): elegible por Tipo para Coro pero hoy no está marcada en la lista (2026-06, 2026-07, 2026-08, 2026-09); la inferencia puede sobrestimarla.
- Dani E. (`kidsMember-dani`): marcada hoy para BGV y sin ningún lugar contado en esa línea: queda «fuera» en 2026-06, 2026-07, 2026-08, 2026-09 y puede leerse «al día» cuando se le debe. Corrección: «joinMonths».
- Dani E. (`kidsMember-dani`): marcada hoy para Coro y sin ningún lugar contado en esa línea: queda «fuera» en 2026-06, 2026-07, 2026-08, 2026-09 y puede leerse «al día» cuando se le debe. Corrección: «joinMonths».
- Dani E. (`kidsMember-dani`): marcada hoy para SL y sin ningún lugar contado en esa línea: queda «fuera» en 2026-06, 2026-07, 2026-08, 2026-09 y puede leerse «al día» cuando se le debe. Corrección: «joinMonths».
- Beto E. (`m-beto`): marcada hoy para Coro y sin ningún lugar contado en esa línea: queda «fuera» en 2026-06, 2026-07, 2026-08, 2026-09 y puede leerse «al día» cuando se le debe. Corrección: «joinMonths».
- Beto E. (`m-beto`): marcada hoy para DL y sin ningún lugar contado en esa línea: queda «fuera» en 2026-06, 2026-07, 2026-08, 2026-09 y puede leerse «al día» cuando se le debe. Corrección: «joinMonths».
- Beto E. (`m-beto`): marcada hoy para SL y sin ningún lugar contado en esa línea: queda «fuera» en 2026-06, 2026-07, 2026-08, 2026-09 y puede leerse «al día» cuando se le debe. Corrección: «joinMonths».
- Elena E. (`m-elena`): marcada hoy para BGV y sin ningún lugar contado en esa línea: queda «fuera» en 2026-06, 2026-07, 2026-08, 2026-09 y puede leerse «al día» cuando se le debe. Corrección: «joinMonths».
- Elena E. (`m-elena`): marcada hoy para Coro y sin ningún lugar contado en esa línea: queda «fuera» en 2026-06, 2026-07, 2026-08, 2026-09 y puede leerse «al día» cuando se le debe. Corrección: «joinMonths».
- Elena E. (`m-elena`): marcada hoy para DL y sin ningún lugar contado en esa línea: queda «fuera» en 2026-06, 2026-07, 2026-08, 2026-09 y puede leerse «al día» cuando se le debe. Corrección: «joinMonths».
- Elena E. (`m-elena`): marcada hoy para SL y sin ningún lugar contado en esa línea: queda «fuera» en 2026-06, 2026-07, 2026-08, 2026-09 y puede leerse «al día» cuando se le debe. Corrección: «joinMonths».
- Iván E. (`m-ivan`): marcada hoy para BGV y sin ningún lugar contado en esa línea: queda «fuera» en 2026-06, 2026-07, 2026-08, 2026-09 y puede leerse «al día» cuando se le debe. Corrección: «joinMonths».
- Iván E. (`m-ivan`): marcada hoy para Coro y sin ningún lugar contado en esa línea: queda «fuera» en 2026-06, 2026-07, 2026-08, 2026-09 y puede leerse «al día» cuando se le debe. Corrección: «joinMonths».
- 2026-07 · Iván E. (`m-ivan`): tiene un lugar Sat.Lead el 2026-07-11, un fin de semana en que una regla de hoy la excluye de ese rol.
- 2026-07 · Ana E. (`m-ana`): su primer lugar en Coro (2026-07-19) no es el primer servicio de esa línea en el mes (2026-07-05); si llegó a mitad de mes, corrige con «blockedDates».
- 2026-07 · presencia 1 de 1 (`d-beto-carla`): aplica el 2026-07-05 y nadie de la regla tuvo un lugar de presencia; quizá la regla de hoy no regía entonces.
- 2026-07 · presencia 1 de 1 (`d-beto-carla`): aplica el 2026-07-19 y nadie de la regla tuvo un lugar de presencia; quizá la regla de hoy no regía entonces.
- 2026-07 · Ana E. (`m-ana`): fecha bloqueada perdida (2026-07-12): el registro actual la tiene y el nuevo no; el registro se respaldó. Corrección: «blockedDates».
- 2026-08 · Ana E. (`m-ana`): tiene un lugar Sat.BGV el 2026-08-01 con estado «fuera»; se queda fuera (un lugar nunca da elegibilidad).
- 2026-08 · Beto E. (`m-beto`): regla fija = 1, tuvo 0 (Sun.BGV).
- 2026-08 · presencia 1 de 1 (`d-beto-carla`): aplica el 2026-08-02 y nadie de la regla tuvo un lugar de presencia; quizá la regla de hoy no regía entonces.
- 2026-08 · miembro sin documento (`m-hugo`): miembro eliminado o fuera de alabanza: sus lugares no cuentan y la parte de los demás en esos servicios cambia.
- 2026-08 · dos documentos sunday_role el 2026-08-16 (`sun-2026-08-16-a`, `sun-2026-08-16-b`): el ledger descarta los dos.
- 2026-09 · Carla E. (`m-carla`): tiene un lugar Sun.BGV el 2026-09-13, una fecha marcada como no disponible.
- 2026-09 · Carla E. (`m-carla`): su primer lugar en BGV (2026-09-13) no es el primer servicio de esa línea en el mes (2026-09-06); si llegó a mitad de mes, corrige con «blockedDates».
- 2026-09 · presencia 1 de 1 (`d-beto-carla`): aplica el 2026-09-06 y nadie de la regla tuvo un lugar de presencia; quizá la regla de hoy no regía entonces.
- 2026-09 · presencia 1 de 1 (`d-beto-carla`): el lugar de presencia de Carla E. (`m-carla`) (2026-09-13) queda fuera de la población (C2 LG-7).
- 2026-09 · Fausto E. (`m-fausto`): añadida por corrección; las exclusiones por semana de hoy no se le aplican (R8).
- 2026-09 · Ana E. (`m-ana`): dos lugares de voz en el servicio del 2026-09-13; el de Sun.Choir se aparta como segundo lugar.

## Correcciones: notas

- entrada 1 · Fausto E. (`m-fausto`): Cantó en septiembre; hoy su Tipo ya no tiene voz.
- entrada 2 · Carla E. (`m-carla`): Llegó a mitad de septiembre.

## Correcciones que no aplican a esta corrida

- entrada 3 · `m-ivan` · 2026-10: no aplica a esta corrida
````

**Create** `scripts/__tests__/reconstructDryRun.test.ts`:

````ts
// Solver v3 C4 — the dry run over the fictitious world (R23), end to end through the
// runner, C2's builders (real GROQ), resolver, ledger and validator. Every expectation
// below is hand-derived from the world's comments; a red one is a finding about the
// code or the world, never a value to re-capture. Every name is fictitious.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { SolverConfig } from "@/app/components/admin/plannerModel";
import type { FakeDoc } from "@/app/utils/__tests__/__fixtures__/fakeFairnessSanity";
import { resolveMonthEligibility, type EligibilityMember } from "@/app/utils/fairnessEligibility";
import type { RoleKey, Status } from "@/app/utils/fairnessVocabulary";
import { validateReconstructionBody } from "../lib/reconstructDecide";
import { hypotheticalConfig } from "../lib/reconstructInference";
import type { WritePlanContent } from "../lib/reconstructPlanFile";
import { ANOMALY_CODES } from "../lib/reconstructTypes";
import { ENV, harness, type Harness } from "./__fixtures__/reconstructHarness";
import {
  JULY_RECONSTRUCTED,
  MEMBERS,
  MONTHS,
  WORLD_CONFIG,
  cap,
  member,
  restriction,
  storedRecord,
  worldDocs,
} from "./__fixtures__/reconstructWorld";

const OUT: Record<RoleKey, Status> = {
  "Sun.Lead": "out",
  "Sat.Lead": "out",
  "Sun.BGV": "out",
  "Sat.BGV": "out",
  "Sun.Choir": "out",
  "Sat.Choir": "out",
};
const open: Harness[] = [];
const make = (...args: Parameters<typeof harness>) => {
  const h = harness(...args);
  open.push(h);
  return h;
};
afterEach(() => {
  for (const h of open.splice(0)) h.cleanup();
});

const planOf = (h: Harness) => h.readPlan().content as WritePlanContent;
const bodyOf = (plan: WritePlanContent, month: string) => {
  const body = plan.months.find((m) => m.month === month)?.body;
  if (!body) throw new Error(`no body for ${month}`);
  return body;
};
const personOf = (plan: WritePlanContent, month: string, id: string) => bodyOf(plan, month).people.find((p) => p.memberId === id);
const withConfig = (patch: (c: SolverConfig) => SolverConfig) => worldDocs({ config: patch(structuredClone(WORLD_CONFIG)) });
const withoutTime = (text: string) => text.split("\n").filter((line) => !line.includes('"generatedAt"')).join("\n");

describe("the fictitious world's dry run", () => {
  it("plans each month with the executor's own decision and writes the backup, the table and the plan — no Sanity write", async () => {
    const h = make(worldDocs());
    expect(await h.dryRun(MONTHS, ["--overrides", h.overridesFile])).toBe(0);
    const plan = planOf(h);
    expect(plan.months.map((m) => [m.month, m.action])).toEqual([
      ["2026-06", "not_reconstruction_owned"],
      ["2026-07", "replace"],
      ["2026-08", "create"],
      ["2026-09", "record_edited"],
    ]);
    expect(readdirSync(path.dirname(h.planPath())).sort()).toEqual(["backup-2026-07.json", "plan.json", "tabla.md"]);
    expect(plan.months[1]).toMatchObject({ existing: { id: "fairnessMonth.2026-07", rev: "rev-jul", source: "reconstructed" }, backup: { file: "backup-2026-07.json" } });
    expect(plan.months[1].body?.expectedRev).toBe("rev-jul");
    expect(plan.months[2]).toMatchObject({ existing: null, backup: null });
    expect(plan.months[2].body?.expectedRev).toBeNull();
    expect(plan.inputs).toEqual({ months: ["2026-06", "2026-07", "2026-08", "2026-09"], previewRun: "2026-10", overridesHash: expect.stringMatching(/^sha256:/) });
    expect(h.lake.commits).toEqual([]);
    expect(h.out[0]).toBe("reconstruct-fairness-months · proj-test · test · DRY-RUN");
    expect(h.out).toContain("«Mes por medio» encontrados: 1 en las reglas · 0 en correcciones");
    expect(h.out).toContain("miembros eliminados o fuera de alabanza con lugares: 1");
    expect(h.out.some((l) => l.startsWith("2026-08 · crear · personas 6 · "))).toBe(true);
  });

  it("builds its one read client with the token, the published perspective and no CDN — and no write client (R3, R19)", async () => {
    const h = make(worldDocs());
    await h.dryRun(MONTHS);
    expect(h.configs).toEqual([
      { projectId: "proj-test", dataset: "test", apiVersion: "2024-07-23", token: "test-read-token", perspective: "published", useCdn: false },
    ]);
  });

  it("warns loudly when it finds no «Mes por medio» in the rules or the corrections (A2)", async () => {
    const h = make(withConfig((c) => ({ ...c, restrictions: c.restrictions.filter((r) => r.id !== "c9p4") })));
    expect(await h.dryRun(MONTHS)).toBe(0);
    expect(h.out).toContain("«Mes por medio» encontrados: 0 en las reglas · 0 en correcciones");
    expect(h.out.some((l) => l.startsWith("⚠ AVISO: ningún «Mes por medio»"))).toBe(true);
  });

  it("records what Tipo, join months, the cadence setting and the corrections say (R3–R9)", async () => {
    const h = make(worldDocs());
    await h.dryRun(MONTHS, ["--overrides", h.overridesFile]);
    const plan = planOf(h);
    expect(bodyOf(plan, "2026-08").people.map((p) => p.memberId)).toEqual(["kidsMember-dani", "m-ana", "m-beto", "m-carla", "m-elena", "m-ivan"]);
    expect(bodyOf(plan, "2026-09").people.map((p) => p.memberId)).toEqual(["kidsMember-dani", "m-ana", "m-beto", "m-carla", "m-elena", "m-fausto", "m-ivan"]);
    expect(personOf(plan, "2026-07", "m-ana")?.roles).toEqual({ ...OUT, "Sun.Lead": "in", "Sun.Choir": "in" });
    expect(personOf(plan, "2026-08", "m-ana")?.roles).toEqual({ ...OUT, "Sun.Lead": "in", "Sun.BGV": "in", "Sun.Choir": "in" });
    expect(personOf(plan, "2026-08", "m-ana")?.blocks).toEqual([{ date: "2026-08-15", unavailable: true, excludedRoles: [] }]);
    expect(personOf(plan, "2026-08", "m-beto")).toMatchObject({ roles: { ...OUT, "Sun.BGV": "exact", "Sat.BGV": "in" }, exactRules: [{ roles: ["Sun.BGV"], count: 1 }] });
    expect(personOf(plan, "2026-06", "m-beto")).toMatchObject({ roles: OUT, exactRules: [] });
    expect(personOf(plan, "2026-07", "m-beto")?.blocks).toEqual([{ date: "2026-07-26", unavailable: true, excludedRoles: [] }]);
    expect(personOf(plan, "2026-08", "m-carla")?.roles).toEqual(OUT);
    expect(personOf(plan, "2026-09", "m-carla")).toMatchObject({
      roles: { ...OUT, "Sun.BGV": "in", "Sat.BGV": "in" },
      blocks: [
        { date: "2026-09-06", unavailable: true, excludedRoles: [] },
        { date: "2026-09-13", unavailable: true, excludedRoles: [] },
      ],
    });
    for (const month of ["2026-06", "2026-07", "2026-08", "2026-09"]) {
      expect(personOf(plan, month, "kidsMember-dani")).toMatchObject({ sundayCadence: "alternate", roles: { ...OUT, "Sun.Lead": "in" } });
      expect(personOf(plan, month, "m-elena")?.roles).toEqual(OUT);
    }
    expect(personOf(plan, "2026-08", "m-ivan")).toMatchObject({
      roles: { ...OUT, "Sat.Lead": "in" },
      blocks: [{ date: "2026-08-08", unavailable: false, excludedRoles: ["Sat.Lead", "Sat.BGV", "Sat.Choir"] }],
    });
    expect(personOf(plan, "2026-09", "m-fausto")).toMatchObject({ roles: { ...OUT, "Sun.BGV": "in" }, blocks: [] });
    expect(bodyOf(plan, "2026-08").presence).toEqual([{ ruleKey: "d-beto-carla", roles: ["Sun.BGV"], members: ["m-beto", "m-carla"], exclusive: false }]);
    expect(plan.months[3].corrections).toEqual([
      { memberId: "m-carla", field: "blocks" },
      { memberId: "m-fausto", field: "Sun.BGV" },
      { memberId: "m-fausto", field: "added" },
    ]);
    for (const m of plan.months) expect(m.body && "source" in m.body).toBeFalsy();
  });

  it("lists every anomaly the world has, by type (R7, R13)", async () => {
    const h = make(worldDocs());
    await h.dryRun(MONTHS, ["--overrides", h.overridesFile]);
    const plan = planOf(h);
    const byCode = Object.fromEntries(ANOMALY_CODES.map((code) => [code, plan.anomalies.filter((a) => a.code === code).length]));
    expect(byCode).toEqual({
      seat_while_out: 1,
      seat_unavailable: 1,
      seat_rule_excluded: 1,
      join_mid_month: 2,
      exact_mismatch: 1,
      cadence_not_in: 0,
      not_ticked_today: 2,
      ticked_never_seated: 12,
      presence_no_seat: 4,
      presence_outside: 1,
      person_added: 1,
      member_gone: 1,
      duplicate_target: 1,
      second_seat: 1,
      rule_split: 0,
      lost_block: 1,
    });
    expect(plan.anomalies).toEqual(
      expect.arrayContaining([
        { code: "seat_while_out", month: "2026-08", memberId: "m-ana", date: "2026-08-01", roleKey: "Sat.BGV", serviceId: "sat-2026-08-01" },
        { code: "seat_rule_excluded", month: "2026-07", memberId: "m-ivan", date: "2026-07-11", roleKey: "Sat.Lead", serviceId: "sat-2026-07-11" },
        { code: "exact_mismatch", month: "2026-08", memberId: "m-beto", roles: ["Sun.BGV"], count: 1, held: 0 },
        { code: "member_gone", month: "2026-08", memberId: "m-hugo" },
        { code: "lost_block", month: "2026-07", memberId: "m-ana", date: "2026-07-12" },
        { code: "join_mid_month", month: "2026-09", memberId: "m-carla", line: "BGV", date: "2026-09-13", firstServiceDate: "2026-09-06" },
        { code: "join_mid_month", month: "2026-07", memberId: "m-ana", line: "CORO", date: "2026-07-19", firstServiceDate: "2026-07-05" },
        { code: "not_ticked_today", month: null, memberId: "m-carla", line: "BGV", months: ["2026-06", "2026-07", "2026-08", "2026-09"] },
        { code: "ticked_never_seated", month: null, memberId: "m-elena", line: "DL", months: ["2026-06", "2026-07", "2026-08", "2026-09"] },
        { code: "presence_outside", month: "2026-09", ruleKey: "d-beto-carla", ruleOrdinal: "presencia 1 de 1", memberId: "m-carla", dates: ["2026-09-13"] },
        { code: "person_added", month: "2026-09", memberId: "m-fausto" },
        { code: "second_seat", month: "2026-09", memberId: "m-ana", date: "2026-09-13", roleKey: "Sun.Choir", serviceId: "sun-2026-09-13" },
      ]),
    );
    expect(plan.anomalies.some((a) => a.code === "ticked_never_seated" && a.memberId === "kidsMember-dani" && a.line === "DL")).toBe(false);
  });

  it("shows a split rule and a cadence setting off Sun.Lead in the table", async () => {
    const h = make(
      withConfig((c) => ({
        ...c,
        restrictions: c.restrictions.map((r) =>
          r.id === "d-ana" ? { ...r, caps: [cap("q9", "Sun.*", 2)] } : r.id === "c9p4" ? { ...r, excludedPatterns: ["Sun.Lead"] } : r,
        ),
      })),
    );
    expect(await h.dryRun(MONTHS)).toBe(0);
    const plan = planOf(h);
    expect(plan.anomalies).toContainEqual({ code: "rule_split", month: "2026-07", memberId: "m-ana", roles: ["Sun.Lead", "Sun.Choir"] });
    // June and September keep their stored records (the two «no se toca» rows), so their anomalies read those.
    expect(plan.anomalies.filter((a) => a.code === "cadence_not_in").map((a) => a.month)).toEqual(["2026-07", "2026-08"]);
    const table = readFileSync(h.tablePath(), "utf8");
    expect(table).toContain("regla fija partida por el inicio de línea");
    expect(table).toContain("tiene «Mes por medio» pero Sun.Lead no está elegible");
  });

  it("previews balances over the record each month will hold — the stored one for an edited month (R11)", async () => {
    const h = make(worldDocs());
    await h.dryRun(MONTHS, ["--overrides", h.overridesFile]);
    const plan = planOf(h);
    expect(plan.preview.sources).toEqual([
      { month: "2026-07", from: "planned" },
      { month: "2026-08", from: "planned" },
      { month: "2026-09", from: "stored" },
    ]);
    expect(plan.preview.figures["m-elena"]?.DL).toEqual({ share: 100, received: 0, balance: 100 });
    expect(plan.preview.figures["kidsMember-dani"]?.DL).toBeUndefined();
    const table = readFileSync(h.tablePath(), "utf8");
    expect(table).toContain("| Elena E. (`m-elena`) | le deben 1.0 |");
  });

  it("shows a replace's per-person changes against the stored record — only on the «reemplazar» month («Decision per month», R21)", async () => {
    const h = make(worldDocs());
    await h.dryRun(MONTHS, ["--overrides", h.overridesFile]);
    const table = readFileSync(h.tablePath(), "utf8");
    const july = table.slice(table.indexOf("## 2026-07 — reemplazar"), table.indexOf("## 2026-08 — crear"));
    expect(july).toContain("### Cambios frente al registro guardado");
    expect(july).toContain("| Ana E. (`m-ana`) | Dom. Coro: fuera → elegible · fecha bloqueada quitada: 2026-07-12 |");
    expect(july).toContain("| Beto E. (`m-beto`) | nueva en el registro |");
    expect(july).toContain("| presencia `d-beto-carla` | nueva en el registro · Sun.BGV · Beto E., Carla E. · no exclusiva |");
    expect(table.match(/### Cambios frente al registro guardado/g)).toHaveLength(1);
  });

  it("shows a newcomer «al día» before her join month", async () => {
    const h = make(worldDocs());
    await h.dryRun(MONTHS, ["--overrides", h.overridesFile, "--preview-run", "2026-09"]);
    expect(readFileSync(h.tablePath(), "utf8")).toContain("| Carla E. (`m-carla`) | al día | al día | al día | al día | al día |");
  });

  it("matches the golden table (fictitious names only)", async () => {
    const h = make(worldDocs());
    await h.dryRun(MONTHS, ["--overrides", h.overridesFile]);
    const table = readFileSync(h.tablePath(), "utf8").replace(/^- Generado: .*$/m, "- Generado: <hora>");
    await expect(table).toMatchFileSnapshot("./__fixtures__/reconstruct-golden-table.md");
  });

  it("always passes an untransformed resolver body through C2's validator (RES-8, A38)", () => {
    // Any superset of the worship roster will do: the resolver drops the kids-only member itself (C2 RES-5).
    const roster = MEMBERS as unknown as EligibilityMember[];
    for (const month of ["2026-06", "2026-07", "2026-08", "2026-09"]) {
      const r = resolveMonthEligibility({ month, config: hypotheticalConfig(WORLD_CONFIG, roster), members: roster });
      expect(r.ok).toBe(true);
      if (r.ok) expect(validateReconstructionBody({ ...r.body, expectedRev: null }, "2026-10")).toEqual({ ok: true });
    }
  });
});

describe("determinism (R5, R17)", () => {
  it("writes byte-identical plans for the same inputs, except the printed time", async () => {
    const h = make(worldDocs());
    await h.dryRun(MONTHS, ["--overrides", h.overridesFile]);
    const first = readFileSync(h.planPath(), "utf8");
    await h.dryRun(MONTHS, ["--overrides", h.overridesFile]);
    expect(withoutTime(readFileSync(h.planPath(), "utf8"))).toBe(withoutTime(first));
  });

  it("is not moved by a draft seat after the join window", async () => {
    const a = make(worldDocs());
    await a.dryRun(MONTHS);
    const b = make(worldDocs({ extra: [{ _id: "sun-2026-10-04", _type: "sunday_role", week: "2026-10-04", published: false, Lead: [{ _key: "k0", _type: "reference", _ref: "m-elena" }], BGVs: [], Chorus: [] }] }));
    await b.dryRun(MONTHS);
    expect(withoutTime(readFileSync(b.planPath(), "utf8"))).toBe(withoutTime(readFileSync(a.planPath(), "utf8")));
  });
});

describe("reads (R3)", () => {
  it("writes no file and prints no fingerprint when a read fails, and prints only the error's class", async () => {
    const h = make(worldDocs());
    h.lake.failNext.fetch = Object.assign(new Error("Ana Ejemplo d-ana m-ana"), { statusCode: 500 });
    expect(await h.dryRun(MONTHS)).toBe(1);
    expect(h.runDirs()).toEqual([]);
    expect(h.out.some((l) => l.startsWith("huella del plan"))).toBe(false);
    expect(h.err.join("\n")).toContain("ReadFailure (solverConfig: Error 500)");
    expect(h.allOutput()).not.toMatch(/Ana|d-ana|m-ana/);
  });

  it("refuses without the read token before constructing any client", async () => {
    const h = make(worldDocs(), { env: { ...ENV, SANITY_API_READ_TOKEN: undefined } });
    expect(await h.dryRun(MONTHS)).toBe(2);
    expect(h.configs).toEqual([]);
    expect(h.lake.reads).toEqual([]);
    expect(h.err.join("\n")).toMatch(/falta SANITY_API_READ_TOKEN/);
  });

  it("refuses an absent solverConfig and writes no file — the defaults are not today's rules", async () => {
    const h = make(worldDocs({ config: null }));
    expect(await h.dryRun(MONTHS)).toBe(2);
    expect(h.runDirs()).toEqual([]);
    expect(h.err.join("\n")).toMatch(/no hay reglas guardadas/);
  });

  it("aborts on a malformed stored record the run needs, writing no file", async () => {
    const h = make(worldDocs({ without: ["fairnessMonth.2026-07"], extra: [{ ...JULY_RECONSTRUCTED, schemaVersion: 9 }] }));
    expect(await h.dryRun(MONTHS)).toBe(1);
    expect(h.runDirs()).toEqual([]);
  });

  it("never reads a draft overlay: the draft Sunday lead gives Elena no DL join month", async () => {
    const h = make(worldDocs());
    await h.dryRun(MONTHS);
    expect(planOf(h).anomalies).toContainEqual(expect.objectContaining({ code: "ticked_never_seated", memberId: "m-elena", line: "DL" }));
    expect(personOf(planOf(h), "2026-09", "m-elena")).toBeDefined();
    expect(personOf(planOf(h), "2026-09", "m-greta")).toBeUndefined();
  });
});

describe("months (R1)", () => {
  it("refuses the current month before any read", async () => {
    const h = make(worldDocs());
    expect(await h.dryRun("2026-09,2026-10")).toBe(2);
    expect(h.lake.reads).toEqual([]);
    expect(h.err.join("\n")).toMatch(/--months 2026-10: solo se reconstruyen meses anteriores/);
  });

  it("skips an empty month and one whose only service is an uncounted special — never a month with a record", async () => {
    const special = { _id: "spe-2026-05-10", _type: "special_role", date: "2026-05-10", service_name: "Retiro", published: true, Lead: [], BGVs: [], Chorus: [] };
    const h = make(worldDocs({ extra: [special] }));
    expect(await h.dryRun("2026-04,2026-05")).toBe(0);
    expect(planOf(h).months.map((m) => m.action)).toEqual(["skip", "skip"]);
    expect(h.out).toContain("2026-04 · sin servicios guardados: no se reconstruye");

    const recorded = storedRecord({ month: "2026-05", people: [{ memberId: "m-ana", roles: { ...OUT, "Sun.Lead": "in" }, exactRules: [], exempt: false, blocks: [] }], presence: [] }, "reconstructed", "rev-may");
    const g = make(worldDocs({ extra: [special, recorded] }));
    expect(await g.dryRun("2026-05")).toBe(0);
    expect(planOf(g).months[0].action).toBe("replace");
  });

  it("counts a 31 October Saturday in October once October is past", async () => {
    const saturday = { _id: "sat-2026-10-31", _type: "saturday_role", week: "2026-10-31", published: false, Lead: [{ _key: "k0", _type: "reference", _ref: "m-ivan" }], BGVs: [], Chorus: [] };
    const h = make(worldDocs({ extra: [saturday] }), { now: "2026-11-02T18:00:00.000Z" });
    expect(await h.dryRun("2026-10")).toBe(0);
    expect(planOf(h).months[0].action).toBe("create");
  });
});

describe("refusals after the reads (R6, R8, R12, R13)", () => {
  const refusedOnlyWithReport = (h: Harness) => {
    const dirs = h.runDirs();
    expect(dirs).toHaveLength(1);
    expect(readdirSync(path.join(h.outDir, dirs[0]))).toEqual(["rechazo.md"]);
    return readFileSync(path.join(h.outDir, dirs[0], "rechazo.md"), "utf8");
  };

  it("case (a): «Mes por medio» beside Sun.Lead == 2 in today's rules refuses through the resolver; a «normal» correction does not clear it", async () => {
    const docs = withConfig((c) => ({ ...c, restrictions: c.restrictions.map((r) => (r.id === "c9p4" ? { ...r, caps: [cap("c9c", "Sun.Lead", 2)] } : r)) }));
    const h = make(docs);
    expect(await h.dryRun(MONTHS)).toBe(2);
    expect(h.err[0]).toBe(`rechazo 1 de 1 · cadence_and_exact · mes por medio · restricción 3 de 4; restricción 3 de 4, tope 1 · 2026-06 · informe: ${path.join(h.outDir, h.runDirs()[0], "rechazo.md")}`);
    const report = refusedOnlyWithReport(h);
    expect(report).toContain("clave `c9p4`");
    expect(report).toContain("Dani E. · `kidsMember-dani`");

    const g = make(docs);
    const file = path.join(g.work, "normal.json");
    writeFileSync(file, JSON.stringify({ schemaVersion: 1, members: { "kidsMember-dani": { sundayCadence: "normal" } } }));
    expect(await g.dryRun(MONTHS, ["--overrides", file])).toBe(2);
    expect(g.err[0]).toMatch(/cadence_and_exact/);
  });

  it("case (b) refuses through the validator; removing the correction clears it; case (c) passes", async () => {
    const docs = withConfig((c) => ({ ...c, restrictions: [...c.restrictions, restriction("e1", "Elena Ejemplo", { caps: [cap("e1c", "Sun.Lead", 2)] })] }));
    const writeFile = (h: Harness, doc: unknown) => {
      const file = path.join(h.work, "c.json");
      writeFileSync(file, JSON.stringify(doc));
      return file;
    };
    const b = make(docs);
    expect(await b.dryRun(MONTHS, ["--overrides", writeFile(b, { schemaVersion: 1, members: { "m-elena": { sundayCadence: "alternate" } } })])).toBe(2);
    expect(b.err[0]).toMatch(/^rechazo 1 de 4 · invalid_body · corrección · entrada 1 del archivo · 2026-06 · people\[\d+\]\.sundayCadence: cadence_and_exact · informe: /);
    const clean = make(docs);
    expect(await clean.dryRun(MONTHS)).toBe(0);
    const c = make(docs);
    const file = writeFile(c, { schemaVersion: 1, members: { "m-elena": { sundayCadence: "alternate", months: { "*": { roles: { "Sun.Lead": "in" } } } } } });
    expect(await c.dryRun(MONTHS, ["--overrides", file])).toBe(0);
    expect(personOf(planOf(c), "2026-09", "m-elena")).toMatchObject({ sundayCadence: "alternate", exactRules: [], roles: { ...OUT, "Sun.Lead": "in" } });
    expect(planOf(c).months[3].corrections).toContainEqual({ memberId: "m-elena", field: "Sun.Lead" });
  });

  it("prints a refusal over the seed-shaped d-ana restriction by its ordinal, never its key (R12)", async () => {
    const h = make(withConfig((c) => ({ ...c, restrictions: c.restrictions.map((r) => (r.id === "d-ana" ? { ...r, caps: [cap("q2", "Sun.BGV", 1.5)] } : r)) })));
    expect(await h.dryRun(MONTHS)).toBe(2);
    expect(h.err[0]).toContain("exact_count_range · regla fija · restricción 1 de 4, tope 1");
    expect(h.allOutput()).not.toMatch(/d-ana|Ana Ejemplo|Ana E.|m-ana/);
    expect(refusedOnlyWithReport(h)).toContain("restricción 1 de 4, tope 1 · clave `q2`");
  });

  it.each<[string, (docs: { config: SolverConfig; extra: FakeDoc[] }) => void, string]>([
    ["unresolved", (w) => w.config.restrictions.push(restriction("r9", "Nadie Ejemplo")), "unresolved"],
    ["ambiguous", (w) => w.extra.push(member("m-ana-2", "Ana Ejemplo", "Ana Dos", ["voz", "support"])), "ambiguous"],
    ["no_tipo", (w) => { w.extra.push(member("m-sin", "Sin Tipo Ejemplo", "Sintipo", [])); w.config.restrictions.push(restriction("r8", "Sin Tipo Ejemplo")); }, "no_tipo"],
    ["overlapping_exact", (w) => { w.config.restrictions[1].caps.push(cap("c2", "*.BGV", 2)); }, "overlapping_exact"],
    ["presence_members", (w) => { w.config.presence[0].persons = ["Beto Ejemplo"]; }, "presence_members"],
  ])("refuses %s with exit 2, a private report and a name-free line", async (_label, mutate, reason) => {
    const w = { config: structuredClone(WORLD_CONFIG), extra: [] as FakeDoc[] };
    mutate(w);
    const h = make(worldDocs({ config: w.config, extra: w.extra }));
    expect(await h.dryRun(MONTHS)).toBe(2);
    expect(h.err.some((l) => l.includes(` · ${reason} · `))).toBe(true);
    refusedOnlyWithReport(h);
    expect(h.err.join("\n")).not.toMatch(/Ejemplo|Ana E.|Beto E.|d-ana|d-beto-carla|m-ana/);
  });

  it("refuses a corrections entry off the worship roster, by its position", async () => {
    const h = make(worldDocs());
    const file = path.join(h.work, "greta.json");
    writeFileSync(file, JSON.stringify({ schemaVersion: 1, members: { "m-greta": { exempt: true } } }));
    expect(await h.dryRun(MONTHS, ["--overrides", file])).toBe(2);
    expect(h.err[0]).toMatch(/^rechazo 1 de 1 · override_member_unknown · corrección · entrada 1 del archivo · informe: /);
    expect(refusedOnlyWithReport(h)).toContain("`m-greta`");
  });
});
````

- [ ] **Step 2: Run it to see it fail**

Run: `git add -A && npx vitest run scripts/__tests__/reconstructDryRun.test.ts`
Expected: FAIL — `../../lib/reconstructRun` does not resolve.

- [ ] **Step 3: Implement**

**Create** `scripts/lib/reconstructRun.ts`:

````ts
// scripts/lib/reconstructRun.ts
//
// The reconstruction's working half (solver v3 C4): arguments, the private-path
// refusal, the token check, the reads, the dry run — and, from C4's Tasks 8 and 9,
// the apply and the rollback. `scripts/reconstruct-fairness-months.mjs` is only its
// entry point, and the ONE caller of C2's write executor, which reaches this module as
// the injected `execute` (R20 a: no `scripts/lib` file calls the executor).
//
// Clients are built through the injected `createClient` only AFTER the token check
// (R19), with the read token, the `published` perspective and no CDN — the three C2's
// executor asserts (IF2-22), and the reason an untokened read cannot pass for «sin
// registro» (A2). Every read goes through C2's builders (IF2-24 … IF2-28): this module
// writes no GROQ of its own and calls no mutation method (R2, R3).
//
// Stdout and stderr carry no member name, no member `_id`, no rule key and no hash of
// one (R12): a rule is named by its ordinal, a refusal by its reason code; names, ids
// and keys go only to the private files under `--out`.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SanityClient } from "@sanity/client";

import { countsForFairness } from "../../app/utils/countsForFairness";
import { resolveMonthEligibility } from "../../app/utils/fairnessEligibility";
import type { LedgerService } from "../../app/utils/fairnessLedger";
import type { FairnessDeleteEntry, FairnessExecution, FairnessStamps } from "../../app/utils/fairnessMonthWriteRequest";
import {
  ROLE_KEYS,
  TAB_KEYS,
  compareCodepoint,
  shiftMonth,
  type FairnessMonthBody,
  type FairnessMonthWrite,
  type LogicalRecord,
  type RecordEnvironment,
  type RoleKey,
  type TabKey,
} from "../../app/utils/fairnessVocabulary";
import { displayMemberName } from "../../app/utils/memberRuleNames";
import {
  fairnessMonthsThroughQuery,
  serviceCountsInMonths,
  solverConfigQuery,
  voiceRolesInRangeQuery,
  worshipRosterQuery,
  type BoundQuery,
} from "../../app/utils/serviceReadQueries";
import { solverConfigFromDocument } from "../../app/utils/solverConfigWriteRequest";
import { fairnessRecordEnvironment } from "../../app/utils/solverDeployment";
import { joinAnomalies, lostBlocks, monthAnomalies, poolAnomalies, sortAnomalies } from "./reconstructAnomalies";
import { USAGE, defaultPreviewRun, notPastMonths, parseReconstructArgs, privatePathRefusals, type ReconstructArgs, type RunMode } from "./reconstructArgs";
import { decideWrite, hashOfBody, parseRecord, summarizeStored, validateReconstructionBody, type StoredSummary } from "./reconstructDecide";
import {
  dedupeRefusals,
  hypotheticalConfig,
  resolverRefusals,
  seatJoinMonths,
  toLedgerServices,
  transformMonth,
  validatorRefusal,
  type TransformResult,
} from "./reconstructInference";
import { outOfRunEntries, parseOverrides, type Overrides } from "./reconstructOverrides";
import { backupText, fingerprintOf, hashText, memberInputDigest, serializePlan, serviceInputDigest, type WriteMonthPlan, type WritePlanContent } from "./reconstructPlanFile";
import { ledgerMembers, monthLedger, plannedLogicalRecord, previewFigures, previewWindow, seatsPerLine } from "./reconstructPreview";
import {
  ACTION_LABEL,
  SERVICE_TYPE_LABEL,
  anomalyText,
  refusalLine,
  renderRefusalReport,
  renderTable,
  replaceChanges,
  targetLine,
  type TableCell,
  type TableModel,
  type TableMonth,
  type TableRow,
} from "./reconstructReport";
import { ReadFailure, type Anomaly, type Correction, type Line, type MonthAction, type ReconstructionBody, type RosterRow, type RunRefusal } from "./reconstructTypes";
import type { GitFs } from "./solverHistoryDiffRun";

/** `sanity/env.ts`'s default, when NEXT_PUBLIC_SANITY_API_VERSION is unset. */
const DEFAULT_API_VERSION = "2024-07-23";
/** R5: the join window has no lower bound — every stored service before its end. */
const JOIN_WINDOW_FLOOR = "0001-01-01";

export interface ClientConfig {
  projectId: string;
  dataset: string;
  apiVersion: string;
  token: string;
  perspective: "published";
  useCdn: false;
}

/** C2's write executor (IF2-22), as the CLI hands it in. Actor `reconstruction` only. */
export type ExecuteFn = (input: {
  clients: { read: SanityClient; write: SanityClient };
  actor: "reconstruction";
  op: "write" | "delete";
  months: Array<Omit<FairnessMonthWrite, "source"> | FairnessDeleteEntry>;
  stamps: FairnessStamps;
}) => Promise<FairnessExecution[]>;

export interface RunDeps {
  env: Readonly<Record<string, string | undefined>>;
  repoRoot: string;
  platform: string;
  now: () => Date;
  createClient: (config: ClientConfig) => SanityClient;
  execute: ExecuteFn;
  out: (line: string) => void;
  err: (line: string) => void;
  /** Tests only: a fake repository layout for R11's refusal. */
  gitFs?: GitFs;
}

/** A refusal before any write (exit 2). Its lines are name-free by construction. */
class Refusal extends Error {
  constructor(readonly lines: string[]) {
    super("refused");
    this.name = "Refusal";
  }
}

/**
 * R12: an error is printed as its class (and an HTTP status) — never its message, which may carry a request body or a name.
 * It mirrors C2's `fairnessErrorClass` (`app/utils/fairnessLedgerRead.ts`, a `server-only` module this script cannot
 * import): C2's executor rethrows every non-409 client error raw, and a `@sanity/client` error carries member ids in its
 * message and in `response.url`. Used for the reads, for every executor call, and for any error that escapes the run.
 */
export function errorClass(e: unknown): string {
  if (e instanceof ReadFailure) return `ReadFailure (${e.step}${e.causeClass ? `: ${e.causeClass}` : ""})`;
  if (e instanceof Error) {
    const status = (e as { statusCode?: unknown }).statusCode;
    return typeof status === "number" ? `${e.name} ${status}` : e.name;
  }
  return typeof e;
}

/** Exit code: 0 done · 2 refused before any write · 1 failed or partial. */
export async function runReconstruction(argv: readonly string[], deps: RunDeps): Promise<number> {
  try {
    return await run(argv, deps);
  } catch (e) {
    if (e instanceof Refusal) {
      for (const line of e.lines) deps.err(`reconstruct-fairness-months: ${line}`);
      return 2;
    }
    deps.err(
      `reconstruct-fairness-months: falló: ${errorClass(e)}. Si fue una lectura, nada se escribió; si no, corre el dry run otra vez antes de cualquier reparación.`,
    );
    return 1;
  }
}

interface Ctx {
  args: ReconstructArgs;
  deps: RunDeps;
  read: SanityClient;
  write: SanityClient | null;
  months: string[];
  currentMonth: string;
  environment: RecordEnvironment;
  projectId: string;
  dataset: string;
  overridesText: string | null;
  runDir: string;
}

async function run(argv: readonly string[], deps: RunDeps): Promise<number> {
  const args = parseReconstructArgs(argv);
  if ("error" in args) throw new Refusal([args.error, USAGE]);
  const projectId = deps.env.NEXT_PUBLIC_SANITY_PROJECT_ID ?? "";
  const dataset = deps.env.NEXT_PUBLIC_SANITY_DATASET ?? "";
  deps.out(targetLine(args.mode, projectId || "(sin proyecto)", dataset || "(sin dataset)"));

  // R11 — nothing that holds names may sit in the repository; checked before any read.
  const files = [
    { flag: "--out", file: args.out },
    ...(args.overrides ? [{ flag: "--overrides", file: args.overrides }] : []),
    ...(args.plan ? [{ flag: "--plan", file: args.plan }] : []),
  ];
  const paths = privatePathRefusals(files, deps.repoRoot, deps.platform, deps.gitFs);
  if (paths.problem) throw new Refusal([`${paths.problem}; se rechaza en vez de vigilar solo parte del repositorio`]);
  if (paths.refusals.length > 0) throw new Refusal(paths.refusals);

  // R1, R17 — the clock enters here: the CDMX day, its month.
  const today = deps.now().toLocaleDateString("sv", { timeZone: "America/Mexico_City" });
  const currentMonth = today.slice(0, 7);

  const months = args.months ?? [];

  const notPast = notPastMonths(months, currentMonth);
  if (notPast.length > 0) {
    throw new Refusal([
      `--months ${notPast.join(", ")}: solo se reconstruyen meses anteriores al mes actual de CDMX (${currentMonth}) — R1, A21. Nada se leyó.`,
    ]);
  }
  const overridesText = args.overrides ? readLocal(args.overrides, "--overrides") : null;

  // R19 — the tokens are checked BEFORE any client is constructed.
  const applying = args.mode === "apply" || args.mode === "rollback-apply";
  const readToken = deps.env.SANITY_API_READ_TOKEN ?? "";
  const writeToken = deps.env.SANITY_WRITE_TOKEN ?? "";
  if (!projectId || !dataset) throw new Refusal(["faltan NEXT_PUBLIC_SANITY_PROJECT_ID o NEXT_PUBLIC_SANITY_DATASET; no se construyó ningún cliente"]);
  if (!readToken) {
    throw new Refusal(["falta SANITY_API_READ_TOKEN: sin él un registro (id privado) se leería como «sin registro» (A2). No se construyó ningún cliente."]);
  }
  if (applying && !writeToken) throw new Refusal(["--apply necesita SANITY_WRITE_TOKEN además del de lectura. No se construyó ningún cliente."]);
  const base = {
    projectId,
    dataset,
    apiVersion: deps.env.NEXT_PUBLIC_SANITY_API_VERSION || DEFAULT_API_VERSION,
    perspective: "published" as const,
    useCdn: false as const,
  };
  const read = deps.createClient({ ...base, token: readToken });
  const write = applying ? deps.createClient({ ...base, token: writeToken }) : null;

  const ctx: Ctx = {
    args,
    deps,
    read,
    write,
    months,
    currentMonth,
    environment: fairnessRecordEnvironment(deps.env),
    projectId,
    dataset,
    overridesText,
    runDir: runDirFor(args.out, deps.now(), args.mode),
  };
  // ── Modes (C4 Tasks 8 and 9 wire the apply and the rollback here).
  if (args.mode !== "dry-run") throw new Refusal([`${args.mode}: modo no disponible todavía en esta versión`]);
  return dryRun(ctx);
}

function readLocal(file: string, flag: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    throw new Refusal([`no se pudo leer ${flag}`]);
  }
}

/** A fresh folder per run (never an existing one): nothing reviewed is ever overwritten. */
function runDirFor(out: string, now: Date, mode: RunMode): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  let dir = path.join(out, `${stamp}-${mode}`);
  for (let n = 2; existsSync(dir); n += 1) dir = path.join(out, `${stamp}-${mode}-${n}`);
  return dir;
}

/** Every private file goes into the run's own folder, created on the first write; `wx` never overwrites. */
function writeRunFile(ctx: Ctx, name: string, text: string): string {
  mkdirSync(ctx.runDir, { recursive: true });
  const file = path.join(ctx.runDir, name);
  writeFileSync(file, text, { flag: "wx" });
  return file;
}

// ─── Reads (R3) ─────────────────────────────────────────────────────────────────

interface WorldReads {
  config: Record<string, unknown>;
  roster: RosterRow[];
  records: Array<Record<string, unknown>>;
  /** IF2-24's freezing services per requested month: weekend + counted specials. */
  freezing: Map<string, number>;
  services: LedgerService[];
}

async function fetchStep(read: SanityClient, step: string, bound: BoundQuery): Promise<unknown> {
  try {
    return await read.fetch(bound.query, bound.params);
  } catch (e) {
    throw new ReadFailure(step, errorClass(e));
  }
}

function asRows(value: unknown, step: string): Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.some((r) => !r || typeof r !== "object" || Array.isArray(r))) throw new ReadFailure(step);
  return value as Array<Record<string, unknown>>;
}

const maxMonth = (a: string, b: string) => (a >= b ? a : b);
const monthOfRecord = (doc: Record<string, unknown>) =>
  typeof doc.month === "string" ? doc.month : String(doc._id ?? "").replace(/^fairnessMonth\./, "");

/** Every read through C2's builders, on the one token-carrying client; null = no `solverConfig` document. */
async function readWorld(read: SanityClient, months: string[], previewRun: string): Promise<WorldReads | null> {
  const config = await fetchStep(read, "solverConfig", solverConfigQuery());
  if (config === null || config === undefined) return null;
  if (typeof config !== "object" || Array.isArray(config)) throw new ReadFailure("solverConfig");
  const roster = asRows(await fetchStep(read, "roster", worshipRosterQuery()), "roster");
  if (roster.some((m) => typeof m._id !== "string")) throw new ReadFailure("roster");
  const last = months[months.length - 1];
  const records = asRows(await fetchStep(read, "records", fairnessMonthsThroughQuery(maxMonth(last, shiftMonth(previewRun, -1)))), "records");
  const freezing = new Map<string, number>();
  for (const row of asRows(await fetchStep(read, "counts", serviceCountsInMonths(months)), "counts")) {
    if (typeof row.month !== "string" || typeof row.weekend !== "number" || typeof row.countedSpecials !== "number") throw new ReadFailure("counts");
    freezing.set(row.month, row.weekend + row.countedSpecials);
  }
  if (months.some((m) => !freezing.has(m))) throw new ReadFailure("counts");
  const readEnd = `${maxMonth(shiftMonth(last, 1), previewRun)}-01`;
  const services = toLedgerServices(await fetchStep(read, "services", voiceRolesInRangeQuery(JOIN_WINDOW_FLOOR, readEnd)));
  return { config: config as Record<string, unknown>, roster: roster as unknown as RosterRow[], records, freezing, services };
}

// ─── Derivation (R1, R4–R18) — shared by the dry run and the apply ──────────────

interface Derived {
  content: WritePlanContent;
  table: Omit<TableModel, "generatedAt" | "projectId" | "dataset">;
  backups: Array<{ file: string; text: string }>;
  summaries: string[];
  cadence: { config: number; overrides: number };
  goneCount: number;
}

type DeriveOutcome =
  | { kind: "ok"; derived: Derived }
  | { kind: "absent_config" }
  | { kind: "refused"; refusals: RunRefusal[]; nameOf: (id: string) => string };

function actionOf(decision: ReturnType<typeof decideWrite>): MonthAction {
  if (decision === "create" || decision === "replace" || decision === "unchanged") return decision;
  if (typeof decision === "object" && (decision.refused === "not_reconstruction_owned" || decision.refused === "record_edited")) {
    return decision.refused;
  }
  // R1 refused every month that is not past, and a planned revision is the one read: nothing else can come back.
  throw new Error("unexpected planning decision");
}

function derive(input: {
  reads: WorldReads | null;
  months: string[];
  previewRun: string;
  overridesText: string | null;
  currentMonth: string;
  environment: RecordEnvironment;
}): DeriveOutcome {
  const { reads, months, previewRun, currentMonth, environment } = input;
  if (reads === null) return { kind: "absent_config" };
  const config = solverConfigFromDocument(reads.config);
  const roster = reads.roster;
  const rosterIds = new Set(roster.map((m) => m._id));
  const names = new Map(roster.map((m) => [m._id, displayMemberName({ member_name: m.member_name ?? undefined, alias: m.alias ?? undefined })]));
  const nameOf = (id: string) => names.get(id) ?? "";
  const previewMonths = previewWindow(previewRun);
  const needed = new Set([...months, ...previewMonths]);

  // The stored records the run uses — each through IF2-20 first (R3: a malformed one aborts the run).
  const stored = new Map<string, { doc: Record<string, unknown>; record: LogicalRecord; summary: StoredSummary }>();
  for (const doc of reads.records) {
    const month = monthOfRecord(doc);
    if (!needed.has(month)) continue;
    const parsed = parseRecord(doc);
    if (!parsed.ok) throw new ReadFailure("records", "malformed_record");
    stored.set(month, { doc, record: parsed.record, summary: summarizeStored(doc) });
  }

  // R8 — the corrections file, validated in full before any record is built.
  let overrides: Overrides | null = null;
  if (input.overridesText !== null) {
    const parsed = parseOverrides(input.overridesText, rosterIds);
    if (!parsed.ok) return { kind: "refused", refusals: parsed.refusals, nameOf };
    overrides = parsed.overrides;
  }
  const corrections = overrides?.members ?? [];

  const joinEnd = `${shiftMonth(months[months.length - 1], 1)}-01`;
  const joinWindow = reads.services.filter((s) => s.date < joinEnd);
  const servicesIn = (month: string) => reads.services.filter((s) => s.date.slice(0, 7) === month);
  const seatJoins = seatJoinMonths(joinWindow);
  const hypothetical = hypotheticalConfig(config, roster);

  // R1's skip; then IF2-15 per month — R4's call, and a second over today's REAL pools for R13's pool anomalies only.
  const built = new Map<string, { base: FairnessMonthBody; actual: FairnessMonthBody }>();
  const refusals: RunRefusal[] = [];
  for (const month of months) {
    if (!stored.has(month) && (reads.freezing.get(month) ?? 0) === 0) continue;
    const base = resolveMonthEligibility({ month, config: hypothetical, members: roster });
    if (!base.ok) {
      refusals.push(...resolverRefusals(base, config, roster, month));
      continue;
    }
    const actual = resolveMonthEligibility({ month, config, members: roster });
    if (!actual.ok) {
      refusals.push(...resolverRefusals(actual, config, roster, month));
      continue;
    }
    built.set(month, { base: base.body, actual: actual.body });
  }
  if (refusals.length > 0) return { kind: "refused", refusals: dedupeRefusals(refusals), nameOf };

  // R5–R8, then IF2-18 on every transformed body, with the revision it would assert.
  const planned = new Map<string, { body: ReconstructionBody; transform: TransformResult }>();
  for (const [month, b] of built) {
    const transform = transformMonth({ month, body: b.base, roster, seatJoins, overrides: corrections });
    if (transform.refusals.length > 0) {
      refusals.push(...transform.refusals);
      continue;
    }
    const body: ReconstructionBody = { ...transform.body, expectedRev: stored.get(month)?.summary.rev ?? null };
    const checked = validateReconstructionBody(body, currentMonth);
    if (!checked.ok) {
      refusals.push(validatorRefusal(month, body, checked.issues, corrections));
      continue;
    }
    planned.set(month, { body, transform });
  }
  if (refusals.length > 0) return { kind: "refused", refusals, nameOf };

  // IF2-21 — the executor's own decision, per month (R14).
  const actions = new Map<string, MonthAction>();
  const hashes = new Map<string, string>();
  for (const month of months) {
    const p = planned.get(month);
    if (!p) {
      actions.set(month, "skip");
      continue;
    }
    const bodyHash = hashOfBody(p.body);
    hashes.set(month, bodyHash);
    const decision = decideWrite({ month, currentMonth, bodyHash, stored: stored.get(month)?.summary ?? null, freezing: reads.freezing.get(month) ?? 0 });
    actions.set(month, actionOf(decision));
  }

  // The record each month holds once this plan is applied (R11's preview rule, R13's ledger anomalies).
  const afterApply = (month: string): LogicalRecord | null => {
    const action = actions.get(month);
    if (action === "create" || action === "replace") return plannedLogicalRecord(planned.get(month)!.body, hashes.get(month)!, environment, names);
    if (action === "skip") return null;
    return stored.get(month)?.record ?? null; // «sin cambios», the two «no se toca» rows, and window months outside --months
  };

  // R18 — a backup of every record a replace would overwrite.
  const backups: Array<{ file: string; text: string }> = [];
  const backupOf = new Map<string, { file: string; hash: string }>();
  for (const month of months) {
    if (actions.get(month) !== "replace") continue;
    const text = backupText(stored.get(month)!.doc);
    const file = `backup-${month}.json`;
    backups.push({ file, text });
    backupOf.set(month, { file, hash: hashText(text) });
  }

  // R7, R13 — per month, against the after-apply record and the ledger run on that month alone.
  const members = ledgerMembers(roster);
  const presenceOrdinal = (ruleKey: string) => {
    const i = config.presence.findIndex((r) => r.id === ruleKey);
    return i >= 0 ? `presencia ${i + 1} de ${config.presence.length}` : undefined;
  };
  const anomalies: Anomaly[] = [];
  const seats = new Map<string, Map<string, Partial<Record<Line, number>>>>();
  for (const month of months) {
    const p = planned.get(month);
    if (!p) continue;
    const record = afterApply(month)!;
    const ledger = monthLedger(month, record, servicesIn(month), members);
    seats.set(month, seatsPerLine(ledger, month));
    anomalies.push(...monthAnomalies({ month, record, services: servicesIn(month), ledger, rosterIds, presenceOrdinal }));
    anomalies.push(...p.transform.anomalies);
    if (actions.get(month) === "replace") anomalies.push(...lostBlocks(month, stored.get(month)!.record, p.body));
  }
  const cadenceIds = new Set([...planned.values()].flatMap((p) => p.body.people.filter((x) => x.sundayCadence === "alternate").map((x) => x.memberId)));
  const bodies = (pick: "base" | "actual") => new Map([...built].map(([m, b]) => [m, b[pick]] as const));
  anomalies.push(...poolAnomalies({ months, hypothetical: bodies("base"), actual: bodies("actual"), seatJoins, overrides: corrections, cadenceIds }));
  anomalies.push(
    ...joinAnomalies({
      months,
      seatJoins,
      joinWindow,
      resolverIds: new Map([...built].map(([m, b]) => [m, new Set(b.base.people.map((x) => x.memberId))] as const)),
      overrides: corrections,
      cadenceIds,
    }),
  );
  const sorted = sortAnomalies(anomalies);

  // R11 — the balance preview, over the record each window month will hold.
  const sources = previewMonths.map((month) => {
    const record = afterApply(month);
    const action = actions.get(month);
    const from: "planned" | "stored" | "none" = record === null ? "none" : action === "create" || action === "replace" ? "planned" : "stored";
    return { month, from, record };
  });
  const preview = previewFigures({
    run: previewRun,
    records: sources.flatMap((s) => (s.record ? [s.record] : [])),
    services: reads.services.filter((s) => previewMonths.includes(s.date.slice(0, 7))),
    members,
  });

  // R15 — what the consent attaches to.
  const content: WritePlanContent = {
    mode: "write",
    inputs: { months, previewRun, overridesHash: overrides?.hash ?? "none" },
    months: months.map((month): WriteMonthPlan => {
      const p = planned.get(month);
      if (!p) return { month, action: "skip", body: null, bodyHash: null, corrections: [], existing: null, backup: null };
      const s = stored.get(month)?.summary ?? null;
      return {
        month,
        action: actions.get(month)!,
        body: p.body,
        bodyHash: hashes.get(month)!,
        corrections: p.transform.corrections,
        existing: s ? { id: s.id, rev: s.rev, source: s.source, contentHash: s.contentHash } : null,
        backup: backupOf.get(month) ?? null,
      };
    }),
    anomalies: sorted,
    preview: { run: previewRun, sources: sources.map(({ month, from }) => ({ month, from })), figures: preview.figures },
    serviceDigest: serviceInputDigest(reads.services.filter((s) => s.date < joinEnd || previewMonths.includes(s.date.slice(0, 7)))),
    memberDigest: memberInputDigest(roster, [...needed].sort(compareCodepoint)),
  };

  // R11 — the private table's model.
  const table: TableMonth[] = months.map((month) => {
    const services = servicesIn(month).map((s) => ({ date: s.date, type: SERVICE_TYPE_LABEL[s._type], counted: countsForFairness(s) }));
    const p = planned.get(month);
    if (!p) return { month, action: "skip", services, rows: [], presence: [] };
    const marked = (id: string, field: Correction["field"]) => p.transform.corrections.some((c) => c.memberId === id && c.field === field);
    const monthSeats = seats.get(month) ?? new Map<string, Partial<Record<Line, number>>>();
    const rows: TableRow[] = p.body.people.map((person) => {
      const cells = p.transform.cells.get(person.memberId);
      const cellOf = (k: RoleKey): TableCell => ({
        status: person.roles[k],
        count: person.exactRules.find((r) => r.roles.includes(k))?.count ?? null,
        reason: cells?.[k].reason ?? "tipo",
        corrected: cells?.[k].corrected ?? false,
      });
      return {
        memberId: person.memberId,
        name: nameOf(person.memberId),
        cells: Object.fromEntries(ROLE_KEYS.map((k) => [k, cellOf(k)])) as Record<RoleKey, TableCell>,
        joins: p.transform.joins.get(person.memberId) ?? {},
        seats: monthSeats.get(person.memberId) ?? {},
        blocked: person.blocks.map((b) => (b.unavailable ? b.date : `${b.date} (${b.excludedRoles.join(", ")})`)),
        exempt: person.exempt,
        exemptCorrected: marked(person.memberId, "exempt"),
        cadence: person.sundayCadence === "alternate",
        cadenceCorrected: marked(person.memberId, "sundayCadence"),
        blocksCorrected: marked(person.memberId, "blocks"),
        added: marked(person.memberId, "added"),
      };
    });
    const presence = p.body.presence.map((r) => ({
      ordinal: presenceOrdinal(r.ruleKey) ?? "presencia",
      ruleKey: r.ruleKey,
      roles: r.roles,
      members: r.members.map((id) => nameOf(id) || id),
      exclusive: r.exclusive,
    }));
    // «Decision per month»: a replace shows, person by person, what it changes in the stored record.
    const changes = actions.get(month) === "replace" ? replaceChanges(stored.get(month)!.record, p.body, nameOf) : undefined;
    return { month, action: actions.get(month)!, services, rows, presence, changes };
  });
  const previewRows = preview.result.people.map((person) => {
    const tabs: Partial<Record<TabKey, number>> = {};
    for (const tab of TAB_KEYS) {
      const f = person.tabs.window[tab];
      if (f) tabs[tab] = f.tenths.balance;
    }
    return { memberId: person.memberId, name: person.name, tabs };
  });

  // R12 — the name-free per-month line.
  const summaries = months.map((month) => {
    const p = planned.get(month);
    if (!p) return `${month} · ${ACTION_LABEL.skip}`;
    const statuses = p.body.people.flatMap((x) => ROLE_KEYS.map((k) => x.roles[k]));
    const count = (s: string) => statuses.filter((x) => x === s).length;
    return [
      month,
      ACTION_LABEL[actions.get(month)!],
      `personas ${p.body.people.length}`,
      `elegibles ${count("in")}`,
      `fuera ${count("out")}`,
      `fijas ${count("exact")}`,
      `correcciones ${p.transform.corrections.length}`,
      `anomalías ${sorted.filter((a) => a.month === month).length}`,
    ].join(" · ");
  });
  const cadence = {
    config: config.restrictions.filter((r) => r.sundayCadence === "alternate").length,
    overrides: corrections.filter((o) => o.sundayCadence === "alternate").length,
  };

  return {
    kind: "ok",
    derived: {
      content,
      table: {
        months,
        previewRun,
        overridesHash: overrides?.hash ?? "none",
        cadenceSettings: cadence,
        table,
        preview: { window: previewMonths, sources: content.preview.sources, rows: previewRows },
        anomalies: sorted.map((anomaly) => ({ anomaly, text: anomalyText(anomaly, nameOf) })),
        notes: corrections.flatMap((o) => (o.note !== null ? [{ ordinal: o.ordinal, memberId: o.memberId, name: nameOf(o.memberId), note: o.note }] : [])),
        notApplicable: overrides ? outOfRunEntries(overrides, months) : [],
      },
      backups,
      summaries,
      cadence,
      goneCount: sorted.filter((a) => a.code === "member_gone").length,
    },
  };
}

// ─── The dry run ────────────────────────────────────────────────────────────────

async function dryRun(ctx: Ctx): Promise<number> {
  const previewRun = ctx.args.previewRun ?? defaultPreviewRun(ctx.months);
  const reads = await readWorld(ctx.read, ctx.months, previewRun);
  const outcome = derive({ reads, months: ctx.months, previewRun, overridesText: ctx.overridesText, currentMonth: ctx.currentMonth, environment: ctx.environment });
  if (outcome.kind === "absent_config") {
    throw new Refusal([
      "no hay reglas guardadas (no existe solverConfig): las reglas por defecto no son las de hoy y perderían cada exclusión y regla fija (R3). No se escribió ningún archivo.",
    ]);
  }
  if (outcome.kind === "refused") return reportRefusals(ctx, outcome.refusals, outcome.nameOf);
  const d = outcome.derived;
  for (const b of d.backups) writeRunFile(ctx, b.file, b.text); // R18: every backup before the plan
  const generatedAt = ctx.deps.now().toISOString();
  const tablePath = writeRunFile(ctx, "tabla.md", renderTable({ ...d.table, generatedAt, projectId: ctx.projectId, dataset: ctx.dataset }));
  const planPath = writeRunFile(ctx, "plan.json", serializePlan(d.content, generatedAt));
  for (const line of d.summaries) ctx.deps.out(line);
  ctx.deps.out(`«Mes por medio» encontrados: ${d.cadence.config} en las reglas · ${d.cadence.overrides} en correcciones`);
  if (d.cadence.config + d.cadence.overrides === 0) {
    ctx.deps.out("⚠ AVISO: ningún «Mes por medio»: los miembros de cadencia se leerán como líderes normales (C4 A2). Ponlo en las reglas o en correcciones y vuelve a correr.");
  }
  ctx.deps.out(`miembros eliminados o fuera de alabanza con lugares: ${d.goneCount}`);
  ctx.deps.out(`huella del plan: ${fingerprintOf(d.content)}`);
  ctx.deps.out(`tabla: ${tablePath}`);
  ctx.deps.out(`plan: ${planPath}`);
  ctx.deps.out("Nada se escribió en Sanity. --apply solo después del consentimiento explícito de Frank a esta huella (R19).");
  return 0;
}

/** R13: one name-free line per refusal on stderr, and the private report beside them (exit 2). */
function reportRefusals(ctx: Ctx, refusals: readonly RunRefusal[], nameOf: (id: string) => string): number {
  const file = writeRunFile(ctx, "rechazo.md", renderRefusalReport({ generatedAt: ctx.deps.now().toISOString(), refusals, nameOf }));
  refusals.forEach((r, i) => ctx.deps.err(refusalLine(r, i + 1, refusals.length, file)));
  ctx.deps.err("Nada se escribió en Sanity, ni tabla ni plan.");
  return 2;
}
````

- [ ] **Step 4: Run it to see it pass — against the snapshot of Step 1**

Run: `git add -A && CI=true npx vitest run scripts/__tests__/reconstructDryRun.test.ts`
Expected: PASS. `CI=true` makes vitest refuse to write a missing or different file snapshot, so this proves the table the code renders is byte-identical to Step 1's file. What the replay checked by hand in those bytes (on `a35f812e`, 2026-10-06), against R4–R13 and the world's comments: only the world's fictitious names, aliases and ids appear; the four month headings carry `no lo escribió la reconstrucción: no se toca`, `reemplazar`, `crear`, `editado después de reconstruir: no se toca`; July, the one «reemplazar» month and the only one with a «Cambios frente al registro guardado» section, shows Ana E.'s `Dom. Coro: fuera → elegible · fecha bloqueada quitada: 2026-07-12`, five people `nueva en el registro` and `d-beto-carla` added; the services tables show `especial | no` for 30 Aug and `especial | sí` for 8 Aug, and both 16 Aug Sunday documents; Ana E.'s BGV join month is 2026-08, set by the Sat.BGV seat she held while `fuera` (R5: a kept seat sets a join month, never a status — `seat_while_out` lists it); Beto E. has no DL join month, because his only Sunday lead sits in a duplicated weekend document the seat step drops (LG-1); Iván E.'s August SL seats are 3 (two Saturdays and the counted special of 8 Aug, which his week-2 exclusion does not bind — A13); the twelve «marcada hoy … sin ningún lugar contado» lines are Dani E. 3 (BGV, Coro, SL — never DL), Beto E. 3, Elena E. 4 and Iván E. 2; Fausto E.'s row carries `añadida por corrección`; the presence table shows `d-beto-carla` with `Beto E., Carla E.` and `no`; the preview reads July and August from the plan and September from the stored, hand-edited record, so Elena E. — whose Sun.Lead is `in` only in that edit — shows `le deben 1.0` for DL and Ana E. `1.0 de más` (R11's acceptance row); the deleted holder `m-hugo` has no display name, so his preview row sorts first and reads `Miembro eliminado`; the «no aplica» list holds `entrada 3 · \`m-ivan\` · 2026-10`. A difference is a finding about the code or the world — fix that, never re-capture the snapshot.

- [ ] **Step 5: Gates and commit**

Run: `git add -A && npx tsc --noEmit && npm test && npx eslint .`
Expected: all green (on the replay base `a35f812e`: **475 files / 8785 tests**, 81 warnings); 0 errors; warnings at baseline. `protectedReadAudit.test.ts` still passes: `reconstructRun.ts` builds no client of its own (`deps.createClient` is not `createClient(`), so it holds no audited site.

```bash
git add -A
git commit -m "feat(fairness): the reconstruction dry run over C2's reads, resolver and ledger" -m "Solver v3 C4 R1, R3-R13, R17-R19, R23. The runner refuses a month that is not past before any read, checks the read token before constructing its one client (published perspective, no CDN), reads only through C2's builders, refuses an absent rule set, and writes nothing at all when a read fails. For each month it plans C2's own write decision, backs up every record a replace would overwrite, and writes the private table and the plan whose fingerprint consent attaches to. The fictitious R23 world covers every inference rule, anomaly and refusal; its golden table is a file snapshot. --apply and --rollback refuse until the next tasks."
```

---
## Task 8: `--apply` — the plan binding and the guarded writes — **[CRITICAL slice: the only path that writes production data]**

Spec R10 (the executor's stamps), R14 (every decision row, planned and at write time — `member_unknown`, `record_missing`, `stale_revision`, `record_exists`), R15 (re-derive everything; any difference refuses with zero writes; a seat edit inside the windows, an availability edit, a corrections edit or a moved `_rev` refuses; publishing a draft, an instrument edit or a seat outside the windows does not), R16 (one month per executor call, oldest first, stop at the first refusal or thrown error, exit 1, «run the dry run again»), R17 (re-applying an unchanged plan writes nothing), R18's backup check before a replace, R19 (both tokens, before any client; the fingerprint the consent named).

**Files:**
- Modify: `scripts/lib/reconstructRun.ts` (three imports; the months line; the mode dispatch; append the apply)
- Test: `scripts/__tests__/reconstructApply.test.ts`

**Interfaces:**
- Consumes: Task 3's `RECORDED_BY`, `parsePlanFile`, `planDifferences`, `type PlanFile`; Task 6's `renderApplyReport`; Task 7's `derive`, `readWorld`, `writeRunFile`, `reportRefusals`, `readLocal`, `errorClass`, `Ctx`; the injected `execute` (C2 IF2-22 `executeFairnessMonthWrites` in tests and in the CLI).
- Produces (module-internal): `readPlan(args): PlanFile`, `bindingRefusal(differences): RunRefusal`, `backupRefusal(month): RunRefusal`, `missingBackup(ctx, entries): string | null`, `apply(ctx, plan): Promise<number>`, `finishWrites(ctx, results, planned, stopped): number`.

- [ ] **Step 1: Write the failing test**

**Create** `scripts/__tests__/reconstructApply.test.ts`:

````ts
// Solver v3 C4 R10, R14–R19 — `--apply` against C2's REAL executor over the in-memory
// Content Lake: the plan binding, the guarded writes, the stop on the first failure.
// The commit log is the mutation log: every write in it was issued by the executor.
// Every name is fictitious.
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { FakeDoc } from "@/app/utils/__tests__/__fixtures__/fakeFairnessSanity";
import { executeFairnessMonthWrites } from "@/app/utils/fairnessMonthWriteRequest";
import { RECORDED_BY } from "../lib/reconstructDecide";
import type { WritePlanContent } from "../lib/reconstructPlanFile";
import type { ExecuteFn } from "../lib/reconstructRun";
import { ENV, REPO_ROOT, harness, type Harness } from "./__fixtures__/reconstructHarness";
import { MEMBER_IDS, MONTHS, NAMES, OVERRIDES, RULE_KEYS, storedRecord, worldDocs } from "./__fixtures__/reconstructWorld";

const open: Harness[] = [];
const make = (...args: Parameters<typeof harness>) => {
  const h = harness(...args);
  open.push(h);
  return h;
};
afterEach(() => {
  for (const h of open.splice(0)) h.cleanup();
});
const planOf = (h: Harness) => h.readPlan().content as WritePlanContent;
const corrections = (h: Harness) => ["--overrides", h.overridesFile];
const docOf = (h: Harness, id: string) => {
  const doc = h.lake.docs.get(id);
  if (!doc) throw new Error(`no document ${id}`);
  return doc;
};
const STAMPS = { recordedBy: RECORDED_BY, now: "2026-10-20T18:00:00.000Z", currentMonth: "2026-10", environment: "local" as const };
/**
 * A Content Lake failure shaped as `@sanity/client` throws it: its message and `response.url` carry member ids, a
 * name and a rule key. C2's executor rethrows every non-409 error raw, so the run must print its class and status only.
 */
const clientError = () =>
  Object.assign(new Error("Mutation failed for Ana Ejemplo (m-ana, kidsMember-dani) under d-ana"), {
    name: "ClientError",
    statusCode: 500,
    response: { url: "https://proj-test.api.sanity.io/v2024-07-23/data/query/test?query=*&%24ids=m-ana%2CkidsMember-dani", body: { error: { description: "Ana Ejemplo" } } },
  });
const RAW = ["Mutation failed", "api.sanity.io", ...NAMES, ...MEMBER_IDS, ...RULE_KEYS];
const leaks = (text: string) => RAW.filter((secret) => text.includes(secret));

/** A harness whose executor runs `before(input)` first — a concurrent edit AFTER the apply re-derived the plan. */
function racing(docs: FakeDoc[]) {
  let before: (input: Parameters<ExecuteFn>[0]) => void = () => {};
  const h = make(docs, {
    execute: (input) => {
      before(input);
      return executeFairnessMonthWrites(input);
    },
  });
  return { h, setBefore: (fn: typeof before) => (before = fn) };
}

describe("the writes (R10, R14, R16)", () => {
  it("writes exactly the reviewed plan, one guarded mutation per month, stamped by the executor", async () => {
    const h = make(worldDocs());
    expect(await h.dryRun(MONTHS, corrections(h))).toBe(0);
    const plan = planOf(h);
    expect(await h.applyLast(corrections(h))).toBe(0);
    expect(h.configs.map((c) => c.token)).toEqual(["test-read-token", "test-read-token", "test-write-token"]);
    expect(h.lake.commits.map((ops) => ops.map((o) => `${o.op}:${o.id}`))).toEqual([["patch:fairnessMonth.2026-07"], ["create:fairnessMonth.2026-08"]]);
    for (const month of ["2026-07", "2026-08"]) {
      expect(docOf(h, `fairnessMonth.${month}`)).toMatchObject({
        source: "reconstructed",
        engine: "v2",
        environment: "local",
        recordedBy: "script:reconstruct-fairness-months",
        contentHash: plan.months.find((m) => m.month === month)?.bodyHash,
      });
    }
    expect(h.out).toEqual(expect.arrayContaining(["2026-07 · replaced", "2026-08 · created"]));
    expect(docOf(h, "fairnessMonth.2026-06").source).toBe("manual");
  });

  it("plans zero writes on the next dry run, and refuses to re-apply the old plan with zero writes (R17)", async () => {
    const h = make(worldDocs());
    await h.dryRun(MONTHS, corrections(h));
    const [planPath, fingerprint] = [h.planPath(), h.fingerprint()];
    await h.applyLast(corrections(h));
    const commits = h.lake.commits.length;
    expect(await h.dryRun(MONTHS, corrections(h))).toBe(0);
    expect(planOf(h).months.map((m) => m.action)).toEqual(["not_reconstruction_owned", "unchanged", "unchanged", "record_edited"]);
    expect(await h.run(["--apply", "--plan", planPath, "--fingerprint", fingerprint, "--out", h.outDir, ...corrections(h)])).toBe(2);
    expect(h.lake.commits).toHaveLength(commits);
    expect(h.err.join("\n")).toMatch(/plan_binding/);
  });

  it("stops at a thrown error: the first month landed, the second failed, the third was never attempted (R16)", async () => {
    const { h, setBefore } = racing(worldDocs({ without: ["fairnessMonth.2026-06", "fairnessMonth.2026-07", "fairnessMonth.2026-09"] }));
    expect(await h.dryRun("2026-07,2026-08,2026-09")).toBe(0);
    expect(planOf(h).months.map((m) => m.action)).toEqual(["create", "create", "create"]);
    setBefore((input) => {
      if (input.months[0].month === "2026-08") h.lake.failNext.commit = clientError();
    });
    expect(await h.applyLast()).toBe(1);
    expect(h.out).toEqual(expect.arrayContaining(["2026-07 · created", "2026-08 · error ClientError 500", "sin intentar: 2026-09"]));
    expect(h.out.join("\n")).toMatch(/corre el dry run otra vez antes de cualquier reparación/);
    expect(leaks(h.allOutput())).toEqual([]);
    const report = readFileSync(h.out.find((l) => l.startsWith("informe: "))!.slice("informe: ".length), "utf8");
    expect(report).toContain("| 2026-08 | error ClientError 500 |");
    expect(report).not.toMatch(/Mutation failed|api\.sanity\.io/);
    expect(h.lake.commits.map((ops) => ops[0].id)).toEqual(["fairnessMonth.2026-07"]);
    setBefore(() => {});
    expect(await h.dryRun("2026-07,2026-08,2026-09")).toBe(0);
    expect(planOf(h).months.map((m) => m.action)).toEqual(["unchanged", "create", "create"]);
  });

  it("prints only an error's class and status when the executor's own read throws, and stops before any write", async () => {
    const { h, setBefore } = racing(worldDocs());
    await h.dryRun(MONTHS, corrections(h));
    setBefore(() => {
      h.lake.failNext.fetch = clientError();
    });
    expect(await h.applyLast(corrections(h))).toBe(1);
    expect(h.out).toEqual(expect.arrayContaining(["2026-07 · error ClientError 500", "sin intentar: 2026-08"]));
    expect(h.lake.commits).toEqual([]);
    expect(leaks(h.allOutput())).toEqual([]);
  });

  it("prints only the class and status when the apply's own re-read fails, writing nothing", async () => {
    const h = make(worldDocs());
    await h.dryRun(MONTHS, corrections(h));
    h.lake.failNext.fetch = clientError();
    expect(await h.applyLast(corrections(h))).toBe(1);
    expect(h.err.join("\n")).toContain("falló: ReadFailure (solverConfig: ClientError 500)");
    expect(h.lake.commits).toEqual([]);
    expect(leaks(h.allOutput())).toEqual([]);
  });
});

describe("every decision row against the executor (R14)", () => {
  const send = async (h: Harness, month: string) => {
    const body = planOf(h).months.find((m) => m.month === month)?.body;
    if (!body) throw new Error(`no body for ${month}`);
    const [result] = await executeFairnessMonthWrites({
      clients: h.lake.clients,
      actor: "reconstruction",
      op: "write",
      months: [{ month, expectedRev: body.expectedRev, people: body.people, presence: body.presence }],
      stamps: STAMPS,
    });
    return result.verdict;
  };

  it("gets from the executor the verdict the plan shows for the rows it never sends", async () => {
    const h = make(worldDocs());
    await h.dryRun(MONTHS, corrections(h));
    expect(await send(h, "2026-06")).toEqual({ refused: "not_reconstruction_owned" });
    expect(await send(h, "2026-09")).toEqual({ refused: "record_edited" });
    // The row R1 refuses before any read: the executor refuses the current month on its own (WR-14 row 1).
    const [current] = await executeFairnessMonthWrites({
      clients: h.lake.clients,
      actor: "reconstruction",
      op: "write",
      months: [
        {
          month: "2026-10",
          expectedRev: null,
          people: [{ memberId: "m-ana", roles: { "Sun.Lead": "in", "Sat.Lead": "out", "Sun.BGV": "out", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out" }, exactRules: [], exempt: false, blocks: [] }],
          presence: [],
        },
      ],
      stamps: STAMPS,
    });
    expect(current.verdict).toEqual({ refused: "not_past_month" });
    await h.applyLast(corrections(h));
    await h.dryRun(MONTHS, corrections(h));
    const commits = h.lake.commits.length;
    expect(await send(h, "2026-08")).toBe("unchanged");
    expect(h.lake.commits).toHaveLength(commits);
  });

  it.each<[string, (h: Harness, input: Parameters<ExecuteFn>[0]) => void, string]>([
    ["member_unknown — a listed member deleted after the re-derivation", (h) => h.lake.docs.delete("m-ivan"), "member_unknown"],
    ["record_missing — the record deleted after the re-derivation", (h) => h.lake.docs.delete("fairnessMonth.2026-07"), "record_missing"],
    ["stale_revision — the record rewritten after the re-derivation", (h) => h.lake.put({ ...docOf(h, "fairnessMonth.2026-07") }), "stale_revision"],
  ])("refuses at write time on %s, and stops", async (_label, edit, verdict) => {
    const { h, setBefore } = racing(worldDocs());
    await h.dryRun(MONTHS, corrections(h));
    setBefore((input) => edit(h, input));
    expect(await h.applyLast(corrections(h))).toBe(1);
    expect(h.out).toEqual(expect.arrayContaining([`2026-07 · ${verdict}`, "sin intentar: 2026-08"]));
    expect(h.lake.commits).toEqual([]);
  });

  it("refuses a create that loses the race at commit time (record_exists), after the earlier month landed", async () => {
    const { h, setBefore } = racing(worldDocs());
    await h.dryRun(MONTHS, corrections(h));
    const rival = storedRecord({ month: "2026-08", people: [{ memberId: "m-ana", roles: { "Sun.Lead": "in", "Sat.Lead": "out", "Sun.BGV": "out", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out" }, exactRules: [], exempt: false, blocks: [] }], presence: [] }, "manual", "rev-rival");
    setBefore((input) => {
      if (input.months[0].month === "2026-08") h.lake.hooks.beforeCommit = () => h.lake.put(rival);
    });
    expect(await h.applyLast(corrections(h))).toBe(1);
    expect(h.out).toEqual(expect.arrayContaining(["2026-07 · replaced", "2026-08 · record_exists"]));
    expect(docOf(h, "fairnessMonth.2026-08").source).toBe("manual");
  });
});

describe("the plan binding (R15)", () => {
  const refusedWithZeroWrites = async (h: Harness) => {
    expect(await h.applyLast(corrections(h))).toBe(2);
    expect(h.lake.commits).toEqual([]);
    expect(h.err.join("\n")).toMatch(/plan_binding/);
  };

  it.each<[string, (h: Harness) => void]>([
    ["a voice seat's stored order inside the join window (no figure moves)", (h) => {
      const d = docOf(h, "sun-2026-09-13");
      h.lake.put({ ...d, BGVs: [...(d.BGVs as unknown[])].reverse() });
    }],
    ["an unavailable date inside a requested month", (h) => h.lake.put({ ...docOf(h, "m-ivan"), unavailableDates: ["2026-08-29"] })],
    ["a stored record's revision", (h) => h.lake.put({ ...docOf(h, "fairnessMonth.2026-07") })],
    ["the corrections file", (h) => writeFileSync(h.overridesFile, OVERRIDES.replace("Llegó a mitad de septiembre.", "Llegó a mitad de mes."))],
  ])("refuses, writing nothing, after a change of %s", async (_label, change) => {
    const h = make(worldDocs());
    await h.dryRun(MONTHS, corrections(h));
    change(h);
    await refusedWithZeroWrites(h);
    const applyDir = h.runDirs().find((d) => d.endsWith("-apply"));
    expect(applyDir && readdirSync(path.join(h.outDir, applyDir))).toEqual(["rechazo.md"]);
  });

  it("refuses after an availability change inside a preview-only month", async () => {
    const h = make(worldDocs());
    await h.dryRun("2026-07,2026-08", corrections(h));
    h.lake.put({ ...docOf(h, "m-beto"), unavailableDates: ["2026-07-26", "2026-06-21"] });
    await refusedWithZeroWrites(h);
  });

  it.each<[string, (h: Harness) => void]>([
    ["publishing a draft", (h) => h.lake.put({ ...docOf(h, "sat-2026-08-22"), published: true })],
    ["an instrument edit", (h) => h.lake.put({ ...docOf(h, "sun-2026-09-13"), instruments: [{ _key: "i0", instrument: "Bajo", person: { _type: "reference", _ref: "m-beto" } }] })],
    ["a seat outside both windows", (h) => h.lake.put({ _id: "sun-2026-10-04", _type: "sunday_role", week: "2026-10-04", published: false, Lead: [{ _key: "k0", _type: "reference", _ref: "m-elena" }], BGVs: [], Chorus: [] })],
  ])("still applies after %s", async (_label, change) => {
    const h = make(worldDocs());
    await h.dryRun(MONTHS, corrections(h));
    change(h);
    expect(await h.applyLast(corrections(h))).toBe(0);
    expect(h.lake.commits).toHaveLength(2);
  });

  it("refuses when a replace's backup is missing from beside the plan (R18)", async () => {
    const h = make(worldDocs());
    await h.dryRun(MONTHS, corrections(h));
    rmSync(path.join(path.dirname(h.planPath()), "backup-2026-07.json"));
    expect(await h.applyLast(corrections(h))).toBe(2);
    expect(h.err.join("\n")).toMatch(/backup_missing/);
    expect(h.lake.commits).toEqual([]);
  });
});

describe("the gate (R11, R19)", () => {
  it("refuses an apply without the write token, constructing no client", async () => {
    const h = make(worldDocs());
    await h.dryRun(MONTHS, corrections(h));
    h.deps.env = { ...ENV, SANITY_WRITE_TOKEN: undefined };
    expect(await h.applyLast(corrections(h))).toBe(2);
    expect(h.configs).toHaveLength(1);
    expect(h.err.join("\n")).toMatch(/SANITY_WRITE_TOKEN/);
  });

  it("refuses a fingerprint the plan does not carry, an edited plan, other months, and a plan inside the repository — before any read", async () => {
    const h = make(worldDocs());
    await h.dryRun(MONTHS, corrections(h));
    const reads = h.lake.reads.length;
    const planPath = h.planPath();
    const fingerprint = h.fingerprint();
    expect(await h.run(["--apply", "--plan", planPath, "--fingerprint", "f".repeat(64), "--out", h.outDir])).toBe(2);
    const edited = path.join(h.work, "edited-plan.json");
    writeFileSync(edited, readFileSync(planPath, "utf8").replace('"rev-jul"', '"rev-otra"'));
    expect(await h.run(["--apply", "--plan", edited, "--fingerprint", fingerprint, "--out", h.outDir])).toBe(2);
    expect(await h.run(["--apply", "--plan", planPath, "--fingerprint", fingerprint, "--months", "2026-07", "--out", h.outDir])).toBe(2);
    expect(await h.run(["--apply", "--plan", path.join(REPO_ROOT, "plan.json"), "--fingerprint", fingerprint, "--out", h.outDir])).toBe(2);
    expect(h.lake.reads).toHaveLength(reads);
    expect(h.err.join("\n")).toMatch(/--fingerprint no es la huella/);
    expect(h.err.join("\n")).toMatch(/su huella no coincide/);
    expect(h.err.join("\n")).toMatch(/--months no coincide/);
    expect(h.err.join("\n")).toMatch(/--plan está dentro del repositorio/);
  });
});
````

- [ ] **Step 2: Run it to see it fail**

Run: `git add -A && npx vitest run scripts/__tests__/reconstructApply.test.ts`
Expected: FAIL — every apply answers exit 2 «apply: modo no disponible todavía en esta versión» (21 tests, 20 red; the write-token test is already green, because the token check comes before the mode dispatch).

- [ ] **Step 3: Implement**

**Find** in `scripts/lib/reconstructRun.ts`:

````ts
import { decideWrite, hashOfBody, parseRecord, summarizeStored, validateReconstructionBody, type StoredSummary } from "./reconstructDecide";
````

**Replace with:**

````ts
import { RECORDED_BY, decideWrite, hashOfBody, parseRecord, summarizeStored, validateReconstructionBody, type StoredSummary } from "./reconstructDecide";
````

**Find** in `scripts/lib/reconstructRun.ts`:

````ts
import { backupText, fingerprintOf, hashText, memberInputDigest, serializePlan, serviceInputDigest, type WriteMonthPlan, type WritePlanContent } from "./reconstructPlanFile";
````

**Replace with:**

````ts
import {
  backupText,
  fingerprintOf,
  hashText,
  memberInputDigest,
  parsePlanFile,
  planDifferences,
  serializePlan,
  serviceInputDigest,
  type PlanFile,
  type WriteMonthPlan,
  type WritePlanContent,
} from "./reconstructPlanFile";
````

**Find** in `scripts/lib/reconstructRun.ts`:

````ts
  refusalLine,
  renderRefusalReport,
  renderTable,
````

**Replace with:**

````ts
  refusalLine,
  renderApplyReport,
  renderRefusalReport,
  renderTable,
````

**Find** in `scripts/lib/reconstructRun.ts`:

````ts
  const months = args.months ?? [];
````

**Replace with:**

````ts
  // R15, R19 — an apply runs only the reviewed plan, under the fingerprint Frank approved: a local read, before any Sanity read.
  const plan = args.plan ? readPlan(args) : null;
  const months = args.months ?? plan?.content.inputs.months ?? [];
  if (plan && args.months && args.months.join(",") !== plan.content.inputs.months.join(",")) {
    throw new Refusal(["--months no coincide con los meses del plan revisado"]);
  }
  if (plan && plan.content.mode === "write" && args.previewRun !== null && args.previewRun !== plan.content.inputs.previewRun) {
    throw new Refusal(["--preview-run no coincide con la corrida del plan revisado"]);
  }
````

**Find** in `scripts/lib/reconstructRun.ts`:

````ts
  // ── Modes (C4 Tasks 8 and 9 wire the apply and the rollback here).
  if (args.mode !== "dry-run") throw new Refusal([`${args.mode}: modo no disponible todavía en esta versión`]);
  return dryRun(ctx);
````

**Replace with:**

````ts
  // ── Modes (C4 Task 9 wires the rollback here).
  if (args.mode === "dry-run") return dryRun(ctx);
  if (args.mode === "apply" && plan) return apply(ctx, plan);
  throw new Refusal([`${args.mode}: modo no disponible todavía en esta versión`]);
````

**Append** to `scripts/lib/reconstructRun.ts`:

````ts
// ─── The apply (R14–R17, R19) ───────────────────────────────────────────────────

/** The reviewed plan file, under the fingerprint the consent named (R19). A local read — no Sanity data yet. */
function readPlan(args: ReconstructArgs): PlanFile {
  const parsed = parsePlanFile(readLocal(args.plan ?? "", "--plan"));
  if (!parsed.ok) throw new Refusal([`--plan: ${parsed.reason}`]);
  if (parsed.plan.fingerprint !== args.fingerprint) {
    throw new Refusal(["--fingerprint no es la huella de ese plan: solo se aplica el plan cuya huella aprobó Frank (R19)"]);
  }
  const wanted = args.mode === "apply" ? "write" : "rollback";
  if (parsed.plan.content.mode !== wanted) {
    throw new Refusal([
      `--plan es un plan de ${parsed.plan.content.mode === "write" ? "escritura" : "borrado"}; esta corrida necesita uno de ${wanted === "write" ? "escritura" : "borrado"}`,
    ]);
  }
  return parsed.plan;
}

function bindingRefusal(differences: readonly string[]): RunRefusal {
  return {
    reason: "plan_binding",
    kind: "plan",
    rules: [],
    detail: `Lo que se lee hoy ya no es lo que dice el plan revisado; difiere: ${differences.join(", ")}.`,
    fix: "Corre el dry run otra vez, revisa la tabla nueva y pide a Frank un consentimiento nuevo a la huella nueva (R15).",
  };
}

function backupRefusal(month: string): RunRefusal {
  return {
    reason: "backup_missing",
    kind: "plan",
    rules: [],
    month,
    detail: "El respaldo del registro que se reemplazaría o borraría no está junto al plan, o cambió (R18).",
    fix: "Aplica el plan desde la carpeta donde lo escribió el dry run, o corre el dry run otra vez.",
  };
}

/** R18: every backup the plan names must sit beside the plan file with the bytes the plan hashed; the first month without one, else null. */
function missingBackup(ctx: Ctx, entries: ReadonlyArray<{ month: string; backup: { file: string; hash: string } | null }>): string | null {
  const dir = path.dirname(ctx.args.plan ?? "");
  for (const entry of entries) {
    if (!entry.backup) continue;
    let text: string | null;
    try {
      text = readFileSync(path.join(dir, entry.backup.file), "utf8");
    } catch {
      text = null;
    }
    if (text === null || hashText(text) !== entry.backup.hash) return entry.month;
  }
  return null;
}

async function apply(ctx: Ctx, plan: PlanFile): Promise<number> {
  if (plan.content.mode !== "write") throw new Refusal(["--plan no es un plan de escritura"]);
  const content = plan.content;
  // R15 — re-derive EVERYTHING from live data and the same corrections; any difference refuses the whole run.
  const reads = await readWorld(ctx.read, content.inputs.months, content.inputs.previewRun);
  const outcome = derive({
    reads,
    months: content.inputs.months,
    previewRun: content.inputs.previewRun,
    overridesText: ctx.overridesText,
    currentMonth: ctx.currentMonth,
    environment: ctx.environment,
  });
  if (outcome.kind === "absent_config") throw new Refusal(["ya no existe solverConfig: el plan no se puede volver a derivar. Nada se escribió."]);
  if (outcome.kind === "refused") {
    return reportRefusals(ctx, [bindingRefusal(["la derivación en vivo ahora se rechaza"]), ...outcome.refusals], outcome.nameOf);
  }
  const differences = planDifferences(content, outcome.derived.content);
  if (differences.length > 0) return reportRefusals(ctx, [bindingRefusal(differences)], () => "");
  const missing = missingBackup(ctx, content.months);
  if (missing !== null) return reportRefusals(ctx, [backupRefusal(missing)], () => "");

  // R16 — oldest first, ONE month per executor call, stop at the first refusal or thrown error.
  const stamps: FairnessStamps = { recordedBy: RECORDED_BY, now: ctx.deps.now().toISOString(), currentMonth: ctx.currentMonth, environment: ctx.environment };
  const writes = content.months.filter((m) => m.action === "create" || m.action === "replace");
  const results: Array<{ month: string; verdict: string; memberIds?: string[] }> = [];
  let stopped = false;
  for (const m of writes) {
    if (!m.body) throw new Error("a planned write without a body");
    const entry = { month: m.month, expectedRev: m.body.expectedRev, people: m.body.people, presence: m.body.presence };
    let result: FairnessExecution | undefined;
    try {
      [result] = await ctx.deps.execute({ clients: { read: ctx.read, write: ctx.write! }, actor: "reconstruction", op: "write", months: [entry], stamps });
    } catch (e) {
      results.push({ month: m.month, verdict: `error ${errorClass(e)}` });
      stopped = true;
      break;
    }
    const verdict = result?.verdict;
    if (verdict === "created" || verdict === "replaced" || verdict === "unchanged") {
      results.push({ month: m.month, verdict });
      continue;
    }
    results.push({
      month: m.month,
      verdict: verdict && typeof verdict === "object" ? verdict.refused : "sin respuesta",
      ...(result?.memberIds ? { memberIds: result.memberIds } : {}),
    });
    stopped = true;
    break;
  }
  return finishWrites(ctx, results, writes.map((m) => m.month), stopped);
}

/** R16's report: what landed, what was refused, what was never attempted — and the one repair: the dry run again. */
function finishWrites(ctx: Ctx, results: Array<{ month: string; verdict: string; memberIds?: string[] }>, planned: string[], stopped: boolean): number {
  const notAttempted = planned.filter((month) => !results.some((r) => r.month === month));
  const report = writeRunFile(ctx, "aplicado.md", renderApplyReport({ generatedAt: ctx.deps.now().toISOString(), mode: ctx.args.mode, results, notAttempted }));
  for (const r of results) ctx.deps.out(`${r.month} · ${r.verdict}`);
  if (notAttempted.length > 0) ctx.deps.out(`sin intentar: ${notAttempted.join(", ")}`);
  ctx.deps.out(`informe: ${report}`);
  if (stopped) {
    ctx.deps.out("Una escritura fallida pudo haber llegado: corre el dry run otra vez antes de cualquier reparación; los meses que sí llegaron dirán «sin cambios» (R16).");
    return 1;
  }
  ctx.deps.out(
    ctx.args.mode === "apply"
      ? "Listo. Corre el dry run otra vez: cada mes escrito debe decir «sin cambios» (R17)."
      : "Listo. Esos meses ahora dicen «sin registro, no cuenta» (F3).",
  );
  return 0;
}
````

- [ ] **Step 4: Run it to see it pass**

Run: `git add -A && npx vitest run scripts/__tests__/reconstructApply.test.ts scripts/__tests__/reconstructDryRun.test.ts`
Expected: PASS — both suites (the dry run's behaviour is unchanged).

- [ ] **Step 5: Gates and commit**

Run: `git add -A && npx tsc --noEmit && npm test && npx eslint .`
Expected: all green (on the replay base `a35f812e`: **476 files / 8806 tests**, 81 warnings); 0 errors; warnings at baseline.

```bash
git add -A
git commit -m "feat(fairness): --apply writes exactly the reviewed plan through C2's executor" -m "Solver v3 C4 R14-R17, R19. An apply reads the plan file, refuses unless the fingerprint Frank approved is the plan's own, re-derives everything from live data and the same corrections, and refuses with zero writes on any difference - a voice-seat edit inside the windows, an availability or corrections edit, a moved revision - or on a missing replace backup. It then hands C2's executor one month at a time, oldest first, and stops at the first refusal or error with exit 1 and the instruction to re-run the dry run; the executor stamps source reconstructed, engine v2 and the script's marker."
```

---
## Task 9: `--rollback` — delete only what it wrote — **[CRITICAL slice: the type's only delete path from a script]**

Spec R18 (plans deletes only for intact `source: "reconstructed"` records — C2 WR-14 D1–D3; refuses and lists any other; backs each up before the plan; infers nothing — reads only the requested records, refuses `--overrides`/`--preview-run`; its own fingerprint over `_id`, `_rev`, `source`, stored and recomputed hashes, action and backup hash; the apply re-reads, refuses with zero deletes on any difference, deletes through the executor with `op: "delete"` and the planned `_rev`), R16 (stop at the first failure), R19.

**Files:**
- Modify: `scripts/lib/reconstructRun.ts` (four imports; the mode dispatch; append the rollback)
- Test: `scripts/__tests__/reconstructRollback.test.ts`

**Interfaces:**
- Consumes: Task 3's `decideDelete`, `summarizeStored`, `backupText`, `hashText`, `type RollbackPlanContent`, `type RollbackMonthPlan`; Task 6's `ROLLBACK_LABEL`, `renderRollbackTable`; Task 8's `bindingRefusal`, `backupRefusal`, `missingBackup`, `finishWrites`, `readPlan`; IF2-25 `fairnessMonthsThroughQuery`.
- Produces (module-internal): `rollbackContent(ctx, months): Promise<{ content: RollbackPlanContent; backups }>`, `rollbackDry(ctx)`, `rollbackApply(ctx, plan)`.

- [ ] **Step 1: Write the failing test**

**Create** `scripts/__tests__/reconstructRollback.test.ts`:

````ts
// Solver v3 C4 R18 — the rollback: it deletes only intact records the reconstruction
// wrote, reads nothing but the requested records, backs each one up before its plan, and
// deletes through C2's REAL executor under the revision the plan recorded. Every name is
// fictitious.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { RollbackPlanContent } from "../lib/reconstructPlanFile";
import { harness, type Harness } from "./__fixtures__/reconstructHarness";
import { MONTHS, WORLD_CONFIG, configDoc, restriction, worldDocs } from "./__fixtures__/reconstructWorld";

const open: Harness[] = [];
const make = (...args: Parameters<typeof harness>) => {
  const h = harness(...args);
  open.push(h);
  return h;
};
afterEach(() => {
  for (const h of open.splice(0)) h.cleanup();
});
const rollbackPlan = (h: Harness) => h.readPlan().content as RollbackPlanContent;
/** Rules the resolver would refuse (an unresolved name) — a rollback must not care. */
const BROKEN_RULES = configDoc({ ...WORLD_CONFIG, restrictions: [...WORLD_CONFIG.restrictions, restriction("r9", "Nadie Ejemplo")] });

/** The world after a reviewed apply: July and August hold records the reconstruction wrote. */
async function applied(h: Harness) {
  expect(await h.dryRun(MONTHS, ["--overrides", h.overridesFile])).toBe(0);
  expect(await h.applyLast(["--overrides", h.overridesFile])).toBe(0);
}

describe("the rollback dry run (R18)", () => {
  it("plans to delete only intact reconstructed records, lists the rest, and backs each up before the plan", async () => {
    const h = make(worldDocs());
    await applied(h);
    const commits = h.lake.commits.length;
    expect(await h.run(["--rollback", "--months", "2026-05,2026-06,2026-07,2026-08,2026-09", "--out", h.outDir])).toBe(0);
    const plan = rollbackPlan(h);
    expect(plan.months.map((m) => [m.month, m.action])).toEqual([
      ["2026-05", "none"],
      ["2026-06", "not_reconstruction_owned"],
      ["2026-07", "delete"],
      ["2026-08", "delete"],
      ["2026-09", "record_edited"],
    ]);
    expect(plan.months[2].stored).toMatchObject({ id: "fairnessMonth.2026-07", source: "reconstructed" });
    expect(plan.months[2].stored?.recomputedHash).toBe(plan.months[2].stored?.contentHash);
    expect(plan.months[4].stored?.recomputedHash).not.toBe(plan.months[4].stored?.contentHash);
    const dir = path.dirname(h.planPath());
    expect(readdirSync(dir).sort()).toEqual(["backup-2026-07.json", "backup-2026-08.json", "plan.json", "tabla.md"]);
    expect(JSON.parse(readFileSync(path.join(dir, "backup-2026-07.json"), "utf8"))).toMatchObject({ _id: "fairnessMonth.2026-07", source: "reconstructed" });
    expect(h.lake.commits).toHaveLength(commits);
    expect(h.out).toEqual(
      expect.arrayContaining([
        "reconstruct-fairness-months · proj-test · test · ROLLBACK",
        "2026-05 · sin registro: nada que borrar",
        "2026-06 · no lo escribió la reconstrucción: no se toca",
        "2026-07 · borrar",
        "2026-09 · editado después de reconstruir: no se toca",
      ]),
    );
  });

  it("infers nothing: reads only records, plans over rules the resolver would refuse, and refuses corrections", async () => {
    const h = make(worldDocs());
    await applied(h);
    h.lake.put(BROKEN_RULES);
    const reads = h.lake.reads.length;
    expect(await h.run(["--rollback", "--months", "2026-07,2026-08", "--out", h.outDir])).toBe(0);
    expect(h.lake.reads.slice(reads).length).toBeGreaterThan(0);
    expect(h.lake.reads.slice(reads).every((r) => r.query.includes('"fairnessMonth"'))).toBe(true);
    expect(await h.run(["--rollback", "--months", "2026-07", "--out", h.outDir, "--overrides", h.overridesFile])).toBe(2);
    expect(await h.run(["--rollback", "--months", "2026-07", "--out", h.outDir, "--preview-run", "2026-08"])).toBe(2);
  });
});

describe("the rollback apply (R18)", () => {
  it("deletes exactly the planned records, each in one guarded transaction, even over refused rules", async () => {
    const h = make(worldDocs());
    await applied(h);
    h.lake.put(BROKEN_RULES);
    expect(await h.run(["--rollback", "--months", "2026-06,2026-07,2026-08", "--out", h.outDir])).toBe(0);
    const commits = h.lake.commits.length;
    expect(await h.run(["--rollback", "--apply", "--plan", h.planPath(), "--fingerprint", h.fingerprint(), "--out", h.outDir])).toBe(0);
    expect(h.lake.commits.slice(commits).map((ops) => ops.map((o) => `${o.op}:${o.id}`))).toEqual([
      ["patch:fairnessMonth.2026-07", "delete:fairnessMonth.2026-07"],
      ["patch:fairnessMonth.2026-08", "delete:fairnessMonth.2026-08"],
    ]);
    expect(h.lake.docs.has("fairnessMonth.2026-07")).toBe(false);
    expect(h.lake.docs.has("fairnessMonth.2026-06")).toBe(true);
    expect(h.out).toEqual(expect.arrayContaining(["2026-07 · deleted", "2026-08 · deleted"]));
    expect(await h.run(["--rollback", "--months", "2026-07,2026-08", "--out", h.outDir])).toBe(0);
    expect(rollbackPlan(h).months.map((m) => m.action)).toEqual(["none", "none"]);
  });

  it("refuses with zero deletes when a record's revision moved after the rollback dry run", async () => {
    const h = make(worldDocs());
    await applied(h);
    expect(await h.run(["--rollback", "--months", "2026-07", "--out", h.outDir])).toBe(0);
    const current = h.lake.docs.get("fairnessMonth.2026-07");
    if (!current) throw new Error("no July record");
    h.lake.put({ ...current });
    const commits = h.lake.commits.length;
    expect(await h.run(["--rollback", "--apply", "--plan", h.planPath(), "--fingerprint", h.fingerprint(), "--out", h.outDir])).toBe(2);
    expect(h.lake.commits).toHaveLength(commits);
    expect(h.err.join("\n")).toMatch(/plan_binding/);
  });

  it("refuses a write plan handed to --rollback --apply", async () => {
    const h = make(worldDocs());
    expect(await h.dryRun(MONTHS)).toBe(0);
    expect(await h.run(["--rollback", "--apply", "--plan", h.planPath(), "--fingerprint", h.fingerprint(), "--out", h.outDir])).toBe(2);
    expect(h.err.join("\n")).toMatch(/plan de escritura/);
  });
});
````

- [ ] **Step 2: Run it to see it fail**

Run: `git add -A && npx vitest run scripts/__tests__/reconstructRollback.test.ts`
Expected: FAIL — every rollback answers exit 2 «rollback: modo no disponible todavía en esta versión» (5 tests, 4 red; «refuses a write plan handed to --rollback --apply» is already green, because Task 8's `readPlan` refuses a plan of the other kind).

- [ ] **Step 3: Implement**

**Find** in `scripts/lib/reconstructRun.ts`:

````ts
import { RECORDED_BY, decideWrite, hashOfBody, parseRecord, summarizeStored, validateReconstructionBody, type StoredSummary } from "./reconstructDecide";
````

**Replace with:**

````ts
import {
  RECORDED_BY,
  decideDelete,
  decideWrite,
  hashOfBody,
  parseRecord,
  summarizeStored,
  validateReconstructionBody,
  type StoredSummary,
} from "./reconstructDecide";
````

**Find** in `scripts/lib/reconstructRun.ts`:

````ts
  type PlanFile,
  type WriteMonthPlan,
````

**Replace with:**

````ts
  type PlanFile,
  type RollbackMonthPlan,
  type RollbackPlanContent,
  type WriteMonthPlan,
````

**Find** in `scripts/lib/reconstructRun.ts`:

````ts
import {
  ACTION_LABEL,
  SERVICE_TYPE_LABEL,
  anomalyText,
  refusalLine,
  renderApplyReport,
  renderRefusalReport,
  renderTable,
````

**Replace with:**

````ts
import {
  ACTION_LABEL,
  ROLLBACK_LABEL,
  SERVICE_TYPE_LABEL,
  anomalyText,
  refusalLine,
  renderApplyReport,
  renderRefusalReport,
  renderRollbackTable,
  renderTable,
````

**Find** in `scripts/lib/reconstructRun.ts`:

````ts
import { ReadFailure, type Anomaly, type Correction, type Line, type MonthAction, type ReconstructionBody, type RosterRow, type RunRefusal } from "./reconstructTypes";
````

**Replace with:**

````ts
import {
  ReadFailure,
  type Anomaly,
  type Correction,
  type Line,
  type MonthAction,
  type ReconstructionBody,
  type RollbackAction,
  type RosterRow,
  type RunRefusal,
} from "./reconstructTypes";
````

**Find** in `scripts/lib/reconstructRun.ts`:

````ts
  // ── Modes (C4 Task 9 wires the rollback here).
  if (args.mode === "dry-run") return dryRun(ctx);
  if (args.mode === "apply" && plan) return apply(ctx, plan);
  throw new Refusal([`${args.mode}: modo no disponible todavía en esta versión`]);
````

**Replace with:**

````ts
  // ── Modes.
  if (args.mode === "dry-run") return dryRun(ctx);
  if (args.mode === "rollback") return rollbackDry(ctx);
  if (!plan) throw new Refusal(["--apply necesita el plan revisado (--plan)"]);
  return args.mode === "apply" ? apply(ctx, plan) : rollbackApply(ctx, plan);
````

**Append** to `scripts/lib/reconstructRun.ts`:

````ts
// ─── The rollback (R18) ─────────────────────────────────────────────────────────

/**
 * A rollback infers nothing: it reads only the requested months' records (IF2-25, on
 * the token-carrying client) — no roster, no rules, no services, no resolver, no
 * ledger — so a later rule refusal or a stale name can never block it. It reads `_id`,
 * `_rev`, `source` and IF2-19's recomputed hash, without the parser (a malformed record
 * can still be listed and refused).
 */
async function rollbackContent(ctx: Ctx, months: string[]): Promise<{ content: RollbackPlanContent; backups: Array<{ file: string; text: string }> }> {
  const rows = asRows(await fetchStep(ctx.read, "records", fairnessMonthsThroughQuery(months[months.length - 1])), "records");
  const byMonth = new Map<string, Record<string, unknown>>();
  for (const doc of rows) {
    const month = monthOfRecord(doc);
    if (months.includes(month)) byMonth.set(month, doc);
  }
  const backups: Array<{ file: string; text: string }> = [];
  const plans = months.map((month): RollbackMonthPlan => {
    const doc = byMonth.get(month) ?? null;
    const summary = doc ? summarizeStored(doc) : null;
    const decision = decideDelete({ month, currentMonth: ctx.currentMonth, stored: summary });
    const action: RollbackAction =
      decision === "delete"
        ? "delete"
        : typeof decision === "object" && (decision.refused === "not_reconstruction_owned" || decision.refused === "record_edited")
          ? decision.refused
          : "none";
    let backup: { file: string; hash: string } | null = null;
    if (action === "delete" && doc) {
      const text = backupText(doc);
      const file = `backup-${month}.json`;
      backups.push({ file, text });
      backup = { file, hash: hashText(text) };
    }
    return {
      month,
      action,
      stored: summary
        ? { id: summary.id, rev: summary.rev, source: summary.source, contentHash: summary.contentHash, recomputedHash: summary.recomputedHash }
        : null,
      backup,
    };
  });
  return { content: { mode: "rollback", inputs: { months }, months: plans }, backups };
}

async function rollbackDry(ctx: Ctx): Promise<number> {
  const d = await rollbackContent(ctx, ctx.months);
  for (const b of d.backups) writeRunFile(ctx, b.file, b.text); // R18: every backup before the plan
  const generatedAt = ctx.deps.now().toISOString();
  const tablePath = writeRunFile(ctx, "tabla.md", renderRollbackTable({ generatedAt, projectId: ctx.projectId, dataset: ctx.dataset, content: d.content }));
  const planPath = writeRunFile(ctx, "plan.json", serializePlan(d.content, generatedAt));
  for (const m of d.content.months) ctx.deps.out(`${m.month} · ${ROLLBACK_LABEL[m.action]}`);
  ctx.deps.out(`huella del plan: ${fingerprintOf(d.content)}`);
  ctx.deps.out(`tabla: ${tablePath}`);
  ctx.deps.out(`plan: ${planPath}`);
  ctx.deps.out("Nada se borró. --rollback --apply solo después del consentimiento explícito de Frank a esta huella (R19).");
  return 0;
}

async function rollbackApply(ctx: Ctx, plan: PlanFile): Promise<number> {
  if (plan.content.mode !== "rollback") throw new Refusal(["--plan no es un plan de borrado"]);
  const content = plan.content;
  const live = await rollbackContent(ctx, content.inputs.months);
  const differences = planDifferences(content, live.content);
  if (differences.length > 0) return reportRefusals(ctx, [bindingRefusal(differences)], () => "");
  const missing = missingBackup(ctx, content.months);
  if (missing !== null) return reportRefusals(ctx, [backupRefusal(missing)], () => "");

  const stamps: FairnessStamps = { recordedBy: RECORDED_BY, now: ctx.deps.now().toISOString(), currentMonth: ctx.currentMonth, environment: ctx.environment };
  const deletes = content.months.filter((m) => m.action === "delete");
  const results: Array<{ month: string; verdict: string }> = [];
  let stopped = false;
  for (const m of deletes) {
    if (!m.stored) throw new Error("a planned delete without a stored record");
    let result: FairnessExecution | undefined;
    try {
      [result] = await ctx.deps.execute({
        clients: { read: ctx.read, write: ctx.write! },
        actor: "reconstruction",
        op: "delete",
        months: [{ month: m.month, expectedRev: m.stored.rev }],
        stamps,
      });
    } catch (e) {
      results.push({ month: m.month, verdict: `error ${errorClass(e)}` });
      stopped = true;
      break;
    }
    const verdict = result?.verdict;
    if (verdict === "deleted") {
      results.push({ month: m.month, verdict });
      continue;
    }
    results.push({ month: m.month, verdict: verdict && typeof verdict === "object" ? verdict.refused : String(verdict ?? "sin respuesta") });
    stopped = true;
    break;
  }
  return finishWrites(ctx, results, deletes.map((m) => m.month), stopped);
}
````

- [ ] **Step 4: Run it to see it pass**

Run: `git add -A && npx vitest run scripts/__tests__/reconstructRollback.test.ts scripts/__tests__/reconstructApply.test.ts scripts/__tests__/reconstructDryRun.test.ts`
Expected: PASS — all three suites.

- [ ] **Step 5: Gates and commit**

Run: `git add -A && npx tsc --noEmit && npm test && npx eslint .`
Expected: all green (on the replay base `a35f812e`: **477 files / 8811 tests**, 81 warnings); 0 errors; warnings at baseline.

```bash
git add -A
git commit -m "feat(fairness): --rollback deletes only the intact records the reconstruction wrote" -m "Solver v3 C4 R18. A rollback reads only the requested months' records - no rules, roster or services, so a broken rule set can never block it - plans a delete only for an intact record with source reconstructed, lists every other one as refused, and backs each planned delete up before writing its plan. Its apply re-reads those records, refuses with zero deletes if any revision or hash moved, and deletes through C2's executor one month at a time under the revision the plan recorded."
```

---
## Task 10: The CLI file and the guards — **[CRITICAL slice: the one executor call site outside `app/`, its audit registration and importer pin]**

Spec R2 (static: no mutation method, no `fairnessMonthCommit` import, in the script or its lib), R12 (every mode, every exit, seed-shaped fixture identifiers, no SHA-256 prefix), R19 (runtime `npx tsx --env-file=.env.local`), R20 (the executor call lives in the CLI file; its unconditional exact `OPERATOR_TOOLING_ALLOWLIST` entry with reason and `removalOwner`; the list's header refreshed, comment-only; the importer pin gains the CLI file; no `scripts/lib` file calls the executor), R22 (a write marker the retirement test accepts stays in the CLI file, after its imports, none before). This task also adds the CLI to the audit's executor-sites pin, which IF2-23's «Script caller» row implies.

**Files:**
- Create: `scripts/reconstruct-fairness-months.mjs`
- Modify: `app/utils/protectedReadAudit.ts` (the `OPERATOR_TOOLING_ALLOWLIST` header comment and its last entry) **[verified c2-t10]**
- Modify: `app/utils/__tests__/protectedReadAudit.test.ts` (the operator-tooling pin; the executor-sites pin) **[verified c2-t10]**
- Modify: `app/utils/__tests__/serviceCommitCallers.test.ts` (the write-request module's row, as Task 3 left it)
- Test: `scripts/__tests__/reconstructGuards.test.ts`

**Interfaces:**
- Consumes: `executeFairnessMonthWrites` (IF2-22 **[verified c2-t10]**), `createClient` (`@sanity/client`), Task 7's `runReconstruction`; `stripComments` (`scripts/lib/strip-comments.mjs`).
- Produces: the CLI («Provides → To C7»).

- [ ] **Step 1: Write the failing guards test and the registrations**

**Create** `scripts/__tests__/reconstructGuards.test.ts`:

````ts
// Solver v3 C4 R2, R12, R19, R20, R22 — the static guards on the reconstruction's files,
// the real CLI under tsx, and the key-hygiene sweep over every mode. Every name is
// fictitious; rule keys and one member id have production's seed shape.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { stripComments } from "../lib/strip-comments.mjs";
import { harness, REPO_ROOT, type Harness } from "./__fixtures__/reconstructHarness";
import { MEMBER_IDS, MONTHS, NAMES, RULE_KEYS, WORLD_CONFIG, cap, worldDocs } from "./__fixtures__/reconstructWorld";

const CLI = "scripts/reconstruct-fairness-months.mjs";
const LIB = readdirSync(path.join(REPO_ROOT, "scripts", "lib"))
  .filter((f) => /^reconstruct.*\.ts$/.test(f))
  .sort()
  .map((f) => `scripts/lib/${f}`);
const source = (file: string) => readFileSync(path.join(REPO_ROOT, file), "utf8");
/** The retirement test's write markers (`scripts/lib/__tests__/sr-retired-writer.test.mjs`). */
const WRITE_MARKERS = ["createClient(", "api.sanity.io", ".transaction(", ".commit(", ".patch(", ".delete(", ".create(", ".createIfNotExists(", "fetch("];

const open: Harness[] = [];
const make = (...args: Parameters<typeof harness>) => {
  const h = harness(...args);
  open.push(h);
  return h;
};
afterEach(() => {
  for (const h of open.splice(0)) h.cleanup();
});

describe("the files (R2, R20, R22)", () => {
  it("knows every file of the core, so a new one is a reviewed change", () => {
    expect(LIB).toEqual([
      "scripts/lib/reconstructAnomalies.ts",
      "scripts/lib/reconstructArgs.ts",
      "scripts/lib/reconstructDecide.ts",
      "scripts/lib/reconstructInference.ts",
      "scripts/lib/reconstructOverrides.ts",
      "scripts/lib/reconstructPlanFile.ts",
      "scripts/lib/reconstructPreview.ts",
      "scripts/lib/reconstructReport.ts",
      "scripts/lib/reconstructRun.ts",
      "scripts/lib/reconstructTypes.ts",
    ]);
  });

  it("calls no Sanity mutation method and never imports the route's commit module (R2)", () => {
    const mutation = /\.\s*(create|createIfNotExists|createOrReplace|createOrUpdate|patch|delete|transaction|commit|mutate)\s*\(/;
    for (const file of [CLI, ...LIB]) {
      const code = stripComments(source(file));
      expect(mutation.test(code), file).toBe(false);
      expect(code, file).not.toMatch(/fairnessMonthCommit/);
    }
  });

  it("calls the executor exactly once, from the CLI file — never from scripts/lib (R20 a)", () => {
    expect(stripComments(source(CLI)).match(/\bexecuteFairnessMonthWrites\s*\(/g)).toHaveLength(1);
    for (const file of LIB) expect(stripComments(source(file)), file).not.toMatch(/\bexecuteFairnessMonthWrites\b/);
  });

  it("keeps a write marker after the CLI's imports and none before, so C7's retirement gate fits (R22)", () => {
    const lines = source(CLI).split("\n");
    const firstStatement = lines.findIndex((l) => l.trim() !== "" && !l.startsWith("//") && !l.startsWith("import "));
    expect(firstStatement).toBeGreaterThan(0);
    const head = lines.slice(0, firstStatement).join("\n");
    const body = lines.slice(firstStatement).join("\n");
    for (const marker of WRITE_MARKERS) expect(head.includes(marker), marker).toBe(false);
    expect(body).toContain("createClient(");
  });
});

describe("the real CLI under tsx (R19)", () => {
  it("loads its whole import closure and refuses without the read token, building no client and writing nothing", () => {
    const work = mkdtempSync(path.join(tmpdir(), "owt-reconstruct-cli-"));
    try {
      const result = spawnSync(path.join(REPO_ROOT, "node_modules", ".bin", "tsx"), [path.join(REPO_ROOT, CLI), "--months", "2026-08", "--out", path.join(work, "out")], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        timeout: 60_000,
        // A minimal environment: no token can reach the child, whatever the parent holds. NODE_ENV is
        // there because Next's types make it a required key of ProcessEnv.
        env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? work, NEXT_PUBLIC_SANITY_PROJECT_ID: "proj-test", NEXT_PUBLIC_SANITY_DATASET: "test" },
      });
      expect(result.error).toBeUndefined();
      expect(result.stdout).toContain("reconstruct-fairness-months · proj-test · test · DRY-RUN");
      expect(result.stderr).toMatch(/falta SANITY_API_READ_TOKEN/);
      expect(result.status).toBe(2);
      expect(readdirSync(work)).toEqual([]);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("stdout and stderr carry no name, alias, member id, rule key or key hash — in every mode (R12)", () => {
  it("holds over a dry run, an apply, a rollback, every kind of refusal and a failed read", async () => {
    const outputs: string[] = [];
    const writeFile = (h: Harness, name: string, doc: unknown) => {
      const file = path.join(h.work, name);
      writeFileSync(file, JSON.stringify(doc));
      return file;
    };

    const full = make(worldDocs());
    await full.dryRun(MONTHS, ["--overrides", full.overridesFile]);
    await full.applyLast(["--overrides", full.overridesFile]);
    await full.run(["--rollback", "--months", "2026-07,2026-08", "--out", full.outDir]);
    await full.run(["--rollback", "--apply", "--plan", full.planPath(), "--fingerprint", full.fingerprint(), "--out", full.outDir]);
    outputs.push(full.allOutput());

    const resolver = make(
      worldDocs({ config: { ...WORLD_CONFIG, restrictions: WORLD_CONFIG.restrictions.map((r) => (r.id === "d-ana" ? { ...r, caps: [cap("q2", "Sun.BGV", 1.5)] } : r)) } }),
    );
    expect(await resolver.dryRun(MONTHS)).toBe(2);
    expect(resolver.err.join("\n")).toContain("restricción 1 de 4, tope 1");
    outputs.push(resolver.allOutput());

    const corrections = make(worldDocs());
    const file = writeFile(corrections, "c.json", { schemaVersion: 1, members: { "kidsMember-dani": { months: { "2026-08": { roles: { "Sun.Bajo": "in" } } } } } });
    expect(await corrections.dryRun(MONTHS, ["--overrides", file])).toBe(2);
    outputs.push(corrections.allOutput());

    const binding = make(worldDocs());
    await binding.dryRun(MONTHS);
    const ana = binding.lake.docs.get("m-ana");
    if (!ana) throw new Error("no member document");
    binding.lake.put({ ...ana, unavailableDates: ["2026-08-29"] });
    expect(await binding.applyLast()).toBe(2);
    outputs.push(binding.allOutput());

    const failed = make(worldDocs());
    failed.lake.failNext.fetch = new Error("Ana Ejemplo kidsMember-dani d-beto-carla m-hugo");
    expect(await failed.dryRun(MONTHS)).toBe(1);
    outputs.push(failed.allOutput());

    const text = outputs.join("\n");
    for (const secret of [...NAMES, ...MEMBER_IDS, ...RULE_KEYS]) expect(text.includes(secret), secret).toBe(false);
    for (const key of [...RULE_KEYS, ...MEMBER_IDS]) {
      const prefix = createHash("sha256").update(key, "utf8").digest("hex").slice(0, 8);
      expect(text.includes(prefix), `hash prefix of a fixture identifier`).toBe(false);
    }
  });
});
````

**Find** in `app/utils/__tests__/serviceCommitCallers.test.ts`:

````ts
    // Solver v3 C4 R20 b: the reconstruction core's ONE gateway to the module (IF2-18 …
    // IF2-21). It never calls the executor; the CLI file, the only caller, joins in C4's Task 10.
    "scripts/lib/reconstructDecide.ts",
  ],
````

**Replace with:**

````ts
    // Solver v3 C4 R20 b: the reconstruction core's ONE gateway to the module (IF2-18 …
    // IF2-21), which never calls the executor — and the CLI file, its one caller outside app/.
    "scripts/lib/reconstructDecide.ts",
    "scripts/reconstruct-fairness-months.mjs",
  ],
````

**Find** in `app/utils/__tests__/protectedReadAudit.test.ts`:

````ts
        "scripts/requeue-role-notices.mjs#module",
        "scripts/requeue-setlist-notice.mjs#module",
        "scripts/service-readiness-cleanup.mjs#module",
        "scripts/service-readiness-feasibility.mjs#module",
      ].sort(),
````

**Replace with:**

````ts
        "scripts/requeue-role-notices.mjs#module",
        "scripts/requeue-setlist-notice.mjs#module",
        // Solver v3 C4 R20 a: the one caller of C2's write executor outside app/ — a
        // `protected-write` site under the executor rule, always (C2 IF2-23). It moves to
        // RETIRED_ONE_SHOT_WRITERS at C7 Step 12 (C4 R22), as migrate-proposal-messages did.
        "scripts/reconstruct-fairness-months.mjs#module",
        "scripts/service-readiness-cleanup.mjs#module",
        "scripts/service-readiness-feasibility.mjs#module",
      ].sort(),
````

**Find** in `app/utils/__tests__/protectedReadAudit.test.ts`:

````ts
    expect(sites.sort()).toEqual(["app/utils/fairnessMonthCommit.ts#module", "app/utils/fairnessMonthWriteRequest.ts#module"]);
````

**Replace with:**

````ts
    expect(sites.sort()).toEqual([
      "app/utils/fairnessMonthCommit.ts#module",
      "app/utils/fairnessMonthWriteRequest.ts#module",
      "scripts/reconstruct-fairness-months.mjs#module",
    ]);
````

**Find** in `app/utils/protectedReadAudit.ts`:

````ts
/**
 * Guarded OPERATOR TOOLING — kept SEPARATE from the A2 writer allowlist and NOT
 * owned by A2, because A2 does not remove these writers: they exist precisely to
 * be run by hand against the isolated verification dataset, and their guards
 * (`scripts/lib/sr-verification.mjs`) hard-refuse the production project and
 * dataset on either axis, in dry-run too. They are listed here, by exact
 * file + operation, so they are visible to the audit rather than invisible to it.
 */
````

**Replace with:**

````ts
/**
 * Guarded OPERATOR TOOLING — kept SEPARATE from the A2 writer allowlist and NOT
 * owned by A2, because A2 does not remove these tools. Each is run by hand and listed
 * here by exact file + operation, so it is visible to the audit rather than invisible
 * to it. Two kinds live here:
 *
 *  - isolated-dataset tooling (the Service Readiness cleanup, feasibility harness and
 *    deployed-route dataset adapter): meant for the verification dataset only, its
 *    guards (`scripts/lib/sr-verification.mjs`) hard-refuse the production project and
 *    dataset on either axis, in dry-run too;
 *  - consented PRODUCTION tools: dry run (or read-only) by default, `--apply` only after
 *    the user's explicit consent, each writing one narrow target — the notice requeue
 *    tools (`notificationOutbox`), the one-off backfills and lock bootstrap, the
 *    read-only proposal reconcile, and the solver v3 fairness-record reconstruction
 *    (`fairnessMonth` records, only through C2's write executor, its `--apply` bound to a
 *    reviewed plan's fingerprint). Their guards do not refuse production; consent and
 *    a dry run do.
 */
````

**Find** in `app/utils/protectedReadAudit.ts` (the list's last entry — the same `removalOwner` text also closes an earlier entry, but only this one is followed by `];`):

````ts
    removalOwner: "one-off migration tooling (never A2 — retire alongside the other one-shot writers)",
  },
];
````

**Replace with:**

````ts
    removalOwner: "one-off migration tooling (never A2 — retire alongside the other one-shot writers)",
  },
  {
    file: "scripts/reconstruct-fairness-months.mjs",
    operation: "module",
    reason:
      "solver v3 C4 fairness-record reconstruction CLI: its core reads role documents, the fairness records and members' availability through C2's read builders on an injected token-carrying client, and this file writes ONLY `fairnessMonth` records — every create, replace and delete through C2's write executor (`executeFairnessMonthWrites`, actor `reconstruction`), which makes it a `protected-write` site under the executor rule whatever else it does (C2 IF2-23, GU-5). Dry run by default; `--apply` and `--rollback --apply` write exactly a reviewed plan, under the fingerprint the user consented to (C4 R15, R19); its stdout carries no member name, member id or rule key (C4 R12)",
    removalOwner:
      "solver v3 C7 Step 12, the retirement PR (C4 R22): once the last v2-confirmed month is reconstructed and the cutover's rollback window closes, this entry moves to RETIRED_ONE_SHOT_WRITERS and the file gains assertRetiredWriter()",
  },
];
````

- [ ] **Step 2: Run them to see them fail**

Run: `git add -A && npx vitest run scripts/__tests__/reconstructGuards.test.ts app/utils/__tests__/protectedReadAudit.test.ts app/utils/__tests__/serviceCommitCallers.test.ts`
Expected: FAIL — the CLI file does not exist: the guards suite cannot read it, the audit reports an unused exemption for it and finds no executor site there, and the pin lists an importer that does not exist.

- [ ] **Step 3: Implement**

**Create** `scripts/reconstruct-fairness-months.mjs`:

````js
// scripts/reconstruct-fairness-months.mjs
//
// Solver v3 C4: rebuild the fairness records (`fairnessMonth`) of PAST months planned
// before any v3 writer existed — from today's Tipo, join months, the cadence setting and
// Frank's corrections — for Frank to review, then write exactly what he approved.
// Spec: docs/superpowers/specs/2026-10-05-solver-v3-c4-record-reconstruction-design.md
// Runbook: docs/SOLVER_AND_INFRA.md, «Fairness-record reconstruction».
//
// RUN IT WITH tsx — it imports C2's TypeScript modules (D1):
//   Dry run (the default; no Sanity write; the table and the plan go to --out):
//     npx tsx --env-file=.env.local scripts/reconstruct-fairness-months.mjs --months 2026-08,2026-09 --out ~/owt-private/c4 [--overrides <file>] [--preview-run YYYY-MM]
//   Apply — ONLY after Frank's explicit consent in chat to THAT plan's fingerprint (R19):
//     npx tsx --env-file=.env.local scripts/reconstruct-fairness-months.mjs --apply --plan <run folder>/plan.json --fingerprint <hex> --out ~/owt-private/c4 [--overrides <same file>]
//   Rollback — a dry run first, then the same consent:
//     … --rollback --months 2026-08 --out ~/owt-private/c4
//     … --rollback --apply --plan <run folder>/plan.json --fingerprint <hex> --out ~/owt-private/c4
//
// This file is the ONE caller of C2's write executor outside app/ (C2 IF2-23): every
// create, replace and delete of a record goes through it with actor `reconstruction`,
// which is why the protected-read audit lists this file in OPERATOR_TOOLING_ALLOWLIST.
// It builds the two Sanity clients, after the core has checked both tokens, and nothing
// else; the rest is scripts/lib/reconstructRun.ts.
//
// Exit codes: 0 done · 2 refused before any write · 1 failed or partial (run the dry run
// again before any repair).

import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@sanity/client";

import { executeFairnessMonthWrites } from "../app/utils/fairnessMonthWriteRequest.ts";
import { errorClass, runReconstruction } from "./lib/reconstructRun.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

runReconstruction(process.argv.slice(2), {
  env: process.env,
  repoRoot,
  platform: process.platform,
  now: () => new Date(),
  createClient: (config) => createClient(config),
  execute: (input) => executeFairnessMonthWrites(input),
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
}).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    // R12: the class and status only — never a message that could carry a request body or a name.
    process.stderr.write(`reconstruct-fairness-months: falló: ${errorClass(error)}\n`);
    process.exitCode = 1;
  },
);
````

- [ ] **Step 4: Run them to see them pass**

Run: `git add -A && npx vitest run scripts/__tests__/reconstructGuards.test.ts app/utils/__tests__/protectedReadAudit.test.ts app/utils/__tests__/serviceCommitCallers.test.ts scripts/lib/__tests__/sr-retired-writer.test.mjs`
Expected: PASS — the audit finds exactly one new site (`scripts/reconstruct-fairness-months.mjs#module`, «calls the protected write executor»), licensed by its exact entry; the pin finds the four importers; the retired-writer suite is untouched (seven writers; C4's file is not one yet).

- [ ] **Step 5: Gates and commit**

Run: `git add -A && npx tsc --noEmit && npm test && npx eslint .`
Expected: all green (on the replay base `a35f812e`: **478 files / 8817 tests**, 81 warnings); 0 errors; warnings at baseline (`tsc` does not read the `.mjs`; ESLint does).

```bash
git add -A
git commit -m "feat(fairness): the reconstruct-fairness-months CLI, visible to the audit and the importer pin" -m "Solver v3 C4 R2, R12, R19, R20, R22. The CLI file is the one caller of C2's write executor outside app/, so the protected-read audit lists it by exact file and operation in OPERATOR_TOOLING_ALLOWLIST, whose header now says what the list really holds: isolated-dataset tooling and consented production tools. The importer pin gains the file. Static guards keep every Sanity mutation, the commit module and the executor call out of scripts/lib, keep a client constructor after the CLI's imports for C7's retirement gate, and a sweep over every mode, refusal and failure proves stdout and stderr carry no name, member id, rule key or key hash."
```

---
## Task 11: The runbook and the ADR section — [standard; docs-audit material]

Spec R21: `docs/SOLVER_AND_INFRA.md`'s `scripts/` toolbox gains the runbook (purpose, inputs, the token check, the consent step, dry run → review → apply → second dry run, rollback, the private paths, «names never enter the repository», and the standing re-run instruction); the inference rules R4–R9 go into C2's fairness-record ADR as a section (A31: C2 authors that ADR; C4 writes none of its own). No `docs/SECRETS.md` change: the two tokens already cover both halves. `CLAUDE.md`/`AGENTS.md` are not edited (R21 names neither; their parity test).

**Files:**
- Modify: `docs/SOLVER_AND_INFRA.md` (before «### Accounts / auth»; the «`scripts/lib/`» paragraph) **[verified c2-t10 and a35f812e]**
- Modify: `docs/adr/0050-the-fairness-balance-is-measured-against-recorded-eligibility.md` (append) **[verified a35f812e: it is `0050`; on `main` use the number Task 0 found]**
- Modify: `docs/adr/README.md` (ADR-0050's row) **[verified a35f812e]**

**Interfaces:** none (documentation).

- [ ] **Step 1: The runbook**

**Find** in `docs/SOLVER_AND_INFRA.md`:

````markdown
### Accounts / auth
- `set-password.ts` (tsx) — `MEMBER_ID=… PASSWORD=… npx tsx scripts/set-password.ts` — bcrypt a
````

**Replace with:**

````markdown
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
     It re-derives everything and refuses with zero writes if anything differs from the plan (a voice seat,
     a «cuenta» flag, an availability date, a correction, a record revision) or a replace's backup is
     missing; then it writes month by month, oldest first, and stops at the first refusal or error (exit 1).
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
  month whose record a v3 Auto confirm wrote reads «no lo escribió la reconstrucción: no se toca» —
  expected, not a failure. Exit codes: `0` done · `2` refused before any write · `1` failed or partial.
- The protected-read audit lists the CLI file in `OPERATOR_TOOLING_ALLOWLIST` (the one caller of C2's
  executor outside `app/`); `serviceCommitCallers.test.ts` pins it and `lib/reconstructDecide.ts` as the
  write-request module's only importers under `scripts/`. Retirement (the gate, the registry move, the
  seven → eight pins) is solver v3 C7 Step 12's.

### Accounts / auth
- `set-password.ts` (tsx) — `MEMBER_ID=… PASSWORD=… npx tsx scripts/set-password.ts` — bcrypt a
````

**Find** in `docs/SOLVER_AND_INFRA.md`:

````markdown
`memberInstruments.mjs` (pure grouping/normalization for the instruments backfill; mirrors
`seatModel.ts`'s vocabulary, pinned by test).
````

**Replace with:**

````markdown
`memberInstruments.mjs` (pure grouping/normalization for the instruments backfill; mirrors
`seatModel.ts`'s vocabulary, pinned by test). Solver v3 C4: `reconstruct*.ts` — the fairness-record
reconstruction's core (arguments and private paths, the corrections file, the plan file, inference,
anomalies, the ledger runs, the reports, the runner); `reconstructDecide.ts` is its one importer of C2's
write-request module, and no `lib` file calls the executor.
````

- [ ] **Step 2: The ADR section and its index row**

**Append** to `docs/adr/0050-the-fairness-balance-is-measured-against-recorded-eligibility.md`:

````markdown
## Reconstruction of past months (solver v3 C4)

Added by C4 (spec `docs/superpowers/specs/2026-10-05-solver-v3-c4-record-reconstruction-design.md`); parent
A31 makes this record the home of the reconstruction's rules, so C4 writes no ADR of its own. Nobody recorded
who was eligible in the months planned before v3, and a month without a record counts for nothing (F3).
`scripts/reconstruct-fairness-months.mjs` infers those records once; Frank reviews a private per-person table;
only the plan whose fingerprint he approved is written — through the one executor, actor `reconstruction`,
past months only, and only records the script itself wrote. Runbook: `docs/SOLVER_AND_INFRA.md`.

**Inference rules (R4–R9):**

- **Tipo today, applied backward, as hypothetical pool ticks (R4).** C2's resolver runs on today's
  `solverConfig` — every restriction, exact rule, week exclusion, presence rule and «Mes por medio» unchanged —
  with each of the three pools replaced by the members whose current Tipo fits it. Today's real ticks feed
  only two anomalies («not ticked today», «ticked today, never seated»).
- **Seats may only delay a line's start (R5, parent A21).** Per line (DL, SL, BGV, Coro), the join month is the
  month of the person's first kept seat — C2's record-free seat step — at a counted service; before it every
  role of the line is `out`. A seat never makes anyone eligible. A join bound that cuts an exact rule removes
  the rule whole for that month; a joined role it also covered becomes plainly `in`, and the table says so.
- **The cadence setting is applied, never inferred (R6).** A «Mes por medio» member's `Sun.Lead` is not
  join-bounded; the setting beside an exact `Sun.Lead` count refuses the run (in the rules: through the
  resolver; introduced by a correction: through the record validator).
- **Today's exact rules apply from the join month (R7)**, and every month whose seats held differ from the
  rule's count is listed.
- **Frank's corrections win (R8):** a file keyed by member `_id`, validated in full before any record is built;
  a correction replaces an exact rule whole (A38) and may add a worship member who has lost `voz`. It never
  edits the configuration the resolver reads (D11).
- **Availability is what is stored today (R9)**, plus today's week exclusions on weekend dates and the
  corrections' blocked dates.

**Rejected:**

- **Seats as eligibility** — reads occasional leads as owed (ADR-0046) and turns the record into a copy of the
  seats.
- **Starting the ledger empty** — every first v3 run would balance against nothing: the gap the program exists
  to close.
- **Everyone eligible from the first stored month (April 2026)** — an earlier attempt showed late joiners owing
  large, false debts and Saturday-only singers owing Sundays.
- **A second, correction-edited configuration for the resolver (D11)** — it would record rule sets the live
  solver refuses, and needs a reverse map from roles to patterns that does not exist.

**Consequences:** the inference is lossy, so every case it cannot settle is listed as an anomaly, never chosen
silently; consent attaches to bytes — the plan binds the bodies, the revisions read, the backups, the preview
figures and digests of every service and member input — so any edit between the dry run and the apply sends
Frank back to the table; after a seat edit, a date move, a «cuenta» change or an availability edit in a
reconstructed month the dry run must be re-run, because nothing else prompts it. The script retires at solver
v3 C7 Step 12.
````

**Find** in `docs/adr/README.md`:

````markdown
and one seat per person per service. Amends no existing ADR (parent A31: C7 does, at the flip)
````

**Replace with:**

````markdown
and one seat per person per service. Amends no existing ADR (parent A31: C7 does, at the flip). Since solver v3 C4: «Reconstruction of past months» — the inference rules of the one-time reconstruction (Tipo today as hypothetical pool ticks, seats that only delay a line's start, the cadence setting applied, Frank's corrections) and the alternatives they reject
````

- [ ] **Step 3: Gates and commit**

Run: `git add -A && npx tsc --noEmit && npm test && npx eslint .`
Expected: all green (on the replay base `a35f812e`: **478 files / 8817 tests**, 81 warnings) — `adrIndex.test.ts` and any doc-pinning suites still pass (no new ADR file, no renumbering).

```bash
git add -A
git commit -m "docs(solver): the fairness-record reconstruction's runbook and its ADR section" -m "Solver v3 C4 R21. SOLVER_AND_INFRA.md gains the runbook: purpose, the token check before any client, the private paths, the dry run, review, consented apply and second dry run, the rollback, and the standing instruction to re-run the dry run after any edit that touches a reconstructed month. ADR-0050, which C2 authors (parent A31), gains the reconstruction's inference rules and the alternatives they reject. No secret or variable is added, so docs/SECRETS.md is unchanged."
```

---
## Task 12: Final verification (no commit) — coordinator

**Files:** none.

- [ ] **Step 1: The gates on the final tree**

Run: `npx tsc --noEmit && npm test && npx eslint . 2>&1 | tail -1`
Expected: `tsc` silent; every suite green — **10 more test files** than Task 0's baseline (the ten `scripts/__tests__/reconstruct*.test.ts`; on the replay base **478 files / 8817 tests**, against 468 / 8643); `✖ N problems (0 errors, N warnings)` with `N` equal to Task 0's. If `ParticipationSidebar.test.tsx` times out under load (a known pre-existing flake), re-run before treating it as a finding.

- [ ] **Step 2: The scope and privacy checks**

```bash
git diff --stat origin/main...HEAD
git diff origin/main...HEAD --name-only | grep -E '^(gcf|gcf_v3)/' && echo "STOP: a solver file changed" || true
git diff origin/main...HEAD --name-only | grep -E '^docs/SECRETS.md|^CLAUDE.md|^AGENTS.md' && echo "STOP: an out-of-scope doc changed" || true
git log origin/main..HEAD --format=%B | grep -i "co-authored-by" && echo "STOP: attribution trailer" || true
shasum -a 256 docs/superpowers/specs/2026-10-05-solver-v3-c4-record-reconstruction-design.md
```

Expected: only the files of «File Structure» changed; no `gcf/**`, `gcf_v3/**`, `docs/SECRETS.md`, `CLAUDE.md` or `AGENTS.md`; no attribution trailer; the spec still hashes to `954869fe…fb21a`. Then read every added line of the diff for a real member name: the only people in it are the fictitious world's.

- [ ] **Step 3: Hand to the release**

The cycle is ready for «Release» step R1 (the fresh code review). Nothing here touched Sanity.

---
## Release

The code ships by `CLAUDE.md`'s normal order. **Shipping the code writes no record**: the CLI is an operator tool, and the production dry run and the `--apply` are separate operations below, each behind Frank's explicit consent — this plan never schedules either.

**R1 — Fresh code review on the merge range (`origin/main...HEAD`).** Dispatch a fresh `code-reviewer` at high effort (critical tier) carrying the docs-audit and worklog-completeness checklists (`CLAUDE.md` «Agent worklog»). Point it at the critical slices first: the apply gate and binding (Tasks 1, 3, 8), the transform (Task 4), the rollback (Task 9), the guards (Task 10). It checks the code against the spec (`954869fe…`) and C2 §7, never against this plan's prose. Fix every finding; **re-verify the fix** with a scoped review of the fix range and the gates on the final tree — the last worklog entry before the merge is a verification, not a fix.

**R2 — Preview first.** Merge the feature branch into `preview`, push `preview`, and verify that `dev-owt-backstage.vercel.app` is in the new deployment's `alias` and its `meta.githubCommitSha` is the pushed commit (one authoritative `get_deployment(domain)` query, or the `deploy-verifier` agent; never a hand-rolled watcher). Nothing visual changed; the check proves the tree builds and deploys. **Do not run the script against the Preview environment**: `preview` writes the production dataset (`CLAUDE.md` «Vercel safety»), and the script is not part of any deployment anyway.

**R3 — PR to `main`.** Open the PR from the feature branch (body: what the CLI does, that it writes nothing on its own, the critical slices, the test counts, «Anchor provenance» re-verified). Wait for the `gates` check. Arm auto-merge **last**, on the exact commit that was reviewed and verified (`gh pr merge <n> --auto --merge`); disarm before any later push. After the merge, verify the production alias the same way.

**Operations (after the release; never scheduled by this plan; each step needs Frank's explicit consent in chat, recorded by date in the worklog and the PR):**

- **O1 — Preconditions.** Frank sets «Mes por medio» on the cadence members in the rules panel (C3; inert under v2 — parent A22, A28), or plans to give them in the corrections file — the file, not the setting, for a cadence member who still carries a v2-only exact `Sun.Lead` count (R6 case c). Prepare `~/owt-private/c4/` outside every checkout. Run from the primary checkout, whose `.env.local` is the real one (worktrees symlink it).
- **O2 — Production dry run, only on Frank's go-ahead to run it** (it reads production members' availability into private files): `npx tsx --env-file=.env.local scripts/reconstruct-fairness-months.mjs --months 2026-08,2026-09 --out ~/owt-private/c4`. Check the first line names the production project and dataset and `DRY-RUN`; check the «Mes por medio» count (zero = stop, O1). Hand Frank the path of `tabla.md` — **never paste its contents into the chat transcript, a PR, a doc or the worklog**; stdout's name-free summary may be quoted.
- **O3 — Review loop.** Frank reads the table and the anomalies; corrections go into `~/owt-private/c4/correcciones.json`; O2 again with `--overrides`, until Frank says the table is right.
- **O4 — Apply, only after Frank's explicit «sí» to that run's printed fingerprint.** `… --apply --plan <the reviewed run folder>/plan.json --fingerprint <that fingerprint> --out ~/owt-private/c4 [--overrides <the same file>]`. Exit 2 (binding) means something changed since the dry run: back to O2 and a fresh consent. Exit 1 means stop: O5 is the repair.
- **O5 — Second dry run:** every written month reads «sin cambios» and the run plans zero writes; then Frank opens the «Equidad» preview and reads the months as «reconstruido» with balances he finds correct (spec «Production» acceptance row). Record the consent date, the fingerprint and the outcome in the worklog and the PR.
- **O6 — Later months.** October 2026 only on or after 2026-11-01; each later v2-confirmed month as it becomes past — C7 Step 10 runs O2–O5 again. Rollback, if ever needed, is the same two-consent sequence with `--rollback`.

---
## Replay record

**Replayed on 2026-10-06** on `a35f812e02b4749ccbccc9a97d405c5d6c0f69bf` (C2's final tip: C1 + C3 + all 17 C2 tasks + C2's final-review fixes), in throwaway clones under `/private/tmp/claude-501/c4-replay/` with no `.env.local` and no network — every test uses the injected fake clients. Nothing touched Sanity or any real dataset, and the CLI never ran against one.

**Method.** A script applied the plan's blocks in document order, task by task: each **Create**/**Append**/**Find** → **Replace with** exactly as written, each «Run it to see it fail» (must exit non-zero, reason checked by hand), each «Run it to see it pass», the three gates (`tsc --noEmit`, the whole vitest suite, `eslint .`) and the task's commit. A failing step was fixed in THIS FILE and its task re-run from the previous task's commit — never patched in the copy alone. After the last task the corrected plan was re-applied the same way to a second fresh clone under `CI=true`, comparing each task's tree with the executed one.

**Result.** Every `Find` matched exactly once at its point; every «see it fail» failed for its stated reason; every hand-derived expectation of Tasks 4, 5 and 7 held as written (statuses, join months, the anomaly counts by type, Elena E.'s «le deben 1.0», every refusal line) — no derivation and no code had to change for them; the second clone came out byte-identical to the executed one at every task, with every gate green.

| After task | Test files / tests | `tsc` | ESLint |
|---|---|---|---|
| 0 (baseline) | 468 / 8643 | silent | 0 errors / 81 warnings |
| 1 | 469 / 8667 | silent | 0 / 81 |
| 2 | 470 / 8690 | silent | 0 / 81 |
| 3 | 471 / 8707 | silent | 0 / 81 |
| 4 | 472 / 8729 | silent | 0 / 81 |
| 5 | 473 / 8740 | silent | 0 / 81 |
| 6 | 474 / 8755 | silent | 0 / 81 |
| 7 | 475 / 8785 | silent | 0 / 81 |
| 8 | 476 / 8806 | silent | 0 / 81 |
| 9 | 477 / 8811 | silent | 0 / 81 |
| 10 | 478 / 8817 | silent | 0 / 81 |
| 11 | 478 / 8817 | silent | 0 / 81 |

**Plan corrections made by the replay:**

1. **Spec gap — a replace's per-person diff** (spec «Decision per month»: «the table shows the per-person diff»; R21: a «reemplazar» row «with its per-person diff then shows what the edit changed»). Found while checking the golden table by hand: the plan's table had none. Task 6 gains `ReplaceChange` and `replaceChanges` (people added, removed or changed — status words, exact-rule grouping, «Exenta», «Mes por medio», blocked dates — then presence rules) and renders them as «Cambios frente al registro guardado» under a «reemplazar» month only, with two new tests; Task 7's `derive` fills `TableMonth.changes` from the stored record (IF2-20) and the planned body, with one new dry-run test (July of the world: Ana E. gains Dom. Coro and loses 2026-07-12, five people are added, `d-beto-carla` is added). Task 11's runbook wording, «Plan decisions», the interfaces lists and the coverage row follow.
2. **C2 carry-over — error output.** C2's executor rethrows every non-409 client error raw, and such an error carries member ids in its message and `response.url`. The plan already printed every read and executor error through `errorClass` (class and numeric status, never the message), but no test used an error of that shape on the executor path. Task 8's R16 test now throws a `@sanity/client`-shaped `ClientError` (status 500; a name, member ids and a rule key in its message and URL) and asserts stdout, stderr and the private apply report carry only `error ClientError 500`; two new Task 8 tests do the same for the executor's own member/record read (it stops before any write) and for the apply's re-read (`ReadFailure (solverConfig: ClientError 500)`, exit 1). `errorClass`'s comment now states that it mirrors C2's `fairnessErrorClass` (a `server-only` module the script cannot import), the CLI's last-resort handler prints `errorClass(error)` instead of the bare class, and the key-hygiene constraint says so.
3. **Did not compile — Task 10.** The CLI spawn test's minimal `env` failed `tsc` (TS2769: Next's types make `NODE_ENV` a required key of `ProcessEnv`); it now sets `NODE_ENV: "test"`.
4. **The golden table** is now a **Create** block in Task 7 Step 1 — the bytes of the first green run, checked by hand against R4–R13 and the world's comments (the checklist, now stated as verified, is in Step 4). Step 4 runs under `CI=true`, so a missing or different snapshot fails instead of being written. The Files list, «File Structure» and «Plan decisions» say so.
5. **Expectations made exact.** Task 8's and Task 9's «see it fail» each have one test already green before the implementation (the write-token refusal precedes the mode dispatch; Task 8's `readPlan` refuses a plan of the other kind) — the Expected lines now give the counts. Task 0's baseline is 468 / 8643 on `a35f812e` (C2's plan had predicted 8636; its final-review fixes added seven tests), and every task's gate step now states the replay base's counts.
6. **Provenance.** Every anchor this plan had taken from C2's plan (the importer-pin row, `EligibilityMember`, `resolveMonthEligibility`, `EligibilityResult`, ADR-0050's number, file, closing text and index row, the `SOLVER_AND_INFRA.md` headings, the audit header and executor-sites pin) matched on `a35f812e` as written — no `Find` block changed for them; they are marked **[verified a35f812e]**. The header, «Coverage gaps», «Anchor provenance», «Self-review» and «Execution handoff» drop their «not executed» statements.

**Environment note (second copy, Tasks 9–11).** The machine hit memory pressure mid-replay (swap nearly full, load average above 100); two full `npx vitest run` gates there failed with vitest «Failed to start forks worker» and 5000 ms timeouts in suites C4 does not touch. Tasks 9–11 were re-applied from Task 8's commit with the gate's vitest limited to `--maxWorkers=3` — same suites, fewer parallel workers — and went green with the counts in the table (477 / 8811, 478 / 8817), each tree byte-identical to the executed one. The plan's gate command is unchanged.

**C2 moved after this replay:** its tip is now `0aa33514` (final-review minors: ADR-0050's first clause, docs, the panel's X1 line). None of those lines is an anchor of this plan except ADR-0050, which Task 11 appends to; Task 0 Step 4 re-checks every anchor anyway.

**To replay again** (if C2 changes before C4 is implemented): the same method on C2's new tip, starting from Task 0 Step 4; the per-task counts above are the expected gate output on `a35f812e` only.

---
## Coverage — spec row → task

| Spec item | Where | Proof |
|---|---|---|
| R1 months: strictly past, refused before any read; skip predicate (A5, IF2-24); a recorded month never skipped; month by stored date string | Tasks 1, 7 | `reconstructArgs.test.ts` «months»; `reconstructDryRun.test.ts` «months (R1)» (current month → exit 2, zero reads; two skips; a recorded empty month → `replace`; 31 Oct Saturday counted in October) |
| R2 one writer: no mutation call, no `fairnessMonthCommit`, no built id/key/stamp/name/hash, no `source` set | Tasks 3, 8, 10 | `reconstructGuards.test.ts` static scans; Task 3's gateway; bodies carry no `source` (Task 7); every commit in the fake log comes from the executor (Task 8) |
| R3 reads: canonical, every published state, builders only, token + `published` + no CDN, roster as read, `solverConfig` absent → exit 2, failed/malformed read → exit 1 with no file | Tasks 4, 7 | «reads (R3)» in `reconstructDryRun.test.ts`; the client-config test; absent/empty `ministries` in, kids-only out |
| R4 Tipo today as hypothetical ticks; today's rules unaltered; real ticks for two anomalies only | Tasks 4, 5, 7 | «R4» in `reconstructInference.test.ts` (rule arrays passed by reference); pool anomalies from a second IF2-15 call |
| R5 join bound per line from IF2-11 kept seats only; join window; exact rules stay whole; seats never make eligible | Tasks 4, 7 | «R5» tests (newcomer, excluded-but-seated, second seat / duplicate / uncounted special, split rule); «not moved by a draft seat after the join window» |
| R6 cadence: setting applied, never join-bounded; kept on an `out` Sun.Lead; cases (a)(b)(c) | Tasks 4, 7 | «R6» tests; dry-run refusal tests (a) with a «normal» correction that does not clear it, (b) validator then clean, (c) passes |
| R7 exact rules from the join month; «regla fija = N, tuvo M» from the ledger's `held` | Task 5 | `exact_mismatch` in `reconstructAnomalies.test.ts` and the world (Beto, August) |
| R8 corrections file: schema, full validation, replacement rule (A38), adding a person, blocked dates, notes private, «no aplica», never edits the config | Tasks 2, 4, 7 | `reconstructOverrides.test.ts` (each refusal); «R8» in `reconstructInference.test.ts`; Fausto added and Carla's blocked date in the world |
| R9 availability: the month's stored dates, week exclusions on weekend dates, corrected dates; header line | Tasks 4, 5, 6 | «R9»; `seat_rule_excluded` never at a special; table header «Disponibilidad: lo guardado hoy…» |
| R10 stamps `reconstructed`/`v2`/`local`/marker, set by the executor; `environment` via REC-2's function | Tasks 3, 7, 8 | Task 8's first apply test reads the stored documents |
| R11 private table (services + «cuenta», status words, reasons, «corregido», joins, seats, blocks, Exenta, Mes por medio, presence as stored, preview through IF2-13 over after-apply records, anomalies, `es` collation); `--out`/`--overrides`/`--plan` refused in the repo; backups before a replace; a replace's per-person diff («Decision per month», R21) | Tasks 1, 5, 6, 7, 8 | `reconstructReport.test.ts` (incl. «a replace's per-person changes»); golden file snapshot (July's «Cambios frente al registro guardado»); edited-month preview reads the stored record; newcomer «al día»; exact sums zero; path tests incl. symlink and sibling worktree; `--plan` inside the repo → exit 2, zero reads |
| R12 stdout/stderr name-free and identifier-free in every mode; ordinals; no hash prefixes; errors by class and status | Tasks 1, 6, 7, 8, 10 | key-hygiene sweep (dry run, apply, rollback, resolver/corrections/binding refusals, failed read) with seed-shaped `d-ana`, `d-ana-beto`, `d-beto-carla`, `kidsMember-dani`; «a refusal over the d-ana restriction prints its ordinal»; Task 8's `ClientError` cases (an executor commit, an executor read, the apply's re-read — name, ids and key in the message and `response.url`): only `ClientError 500` reaches stdout, stderr and the apply report |
| R13 every anomaly type; refusals (resolver reasons incl. presence, validator, corrections, plan binding) with name-free lines and a private report | Tasks 4–7 | per-type counts on the world; variant run for `rule_split`/`cadence_not_in`; `anomalyText` for every code; refusal tests |
| R14 decision per month = IF2-21; every row against the executor, incl. `member_unknown` after re-derivation | Tasks 3, 7, 8 | Task 3 decision tests; Task 8 «every decision row» (not owned, edited, unchanged, `not_past_month`, `member_unknown`, `record_missing`, `stale_revision`, `record_exists`, create, replace) |
| R15 plan binding: bodies, hashes, revisions, overrides hash, backup hashes, anomalies, preview figures, service-input digest (+ member-input digest), fingerprint | Tasks 3, 7, 8 | «the plan binding (R15)» (four refusing changes + a preview-only availability change; three non-changes still apply) |
| R16 one month per call, oldest first, stop, exit 1, re-run message | Task 8 | thrown error on the second write; fresh dry run plans only the rest |
| R17 deterministic; re-run after apply plans zero writes; re-apply writes nothing | Tasks 3, 7, 8 | byte-identical plans except `generatedAt`; post-apply dry run «sin cambios»; old plan → exit 2, zero commits |
| R18 rollback: only intact reconstructed; backups first; infers nothing; refuses corrections/preview run; own fingerprint; moved `_rev` → zero deletes | Tasks 1, 3, 9 | `reconstructRollback.test.ts` |
| R19 consent procedure; runtime `npx tsx --env-file`; tokens before any client; no new variable | Tasks 1, 7, 8, 10, Release | token tests (dry run and apply); tsx spawn test; Release O2–O4 |
| R20 executor call only in the CLI; unconditional exact `OPERATOR_TOOLING_ALLOWLIST` entry with reason and `removalOwner`; header refreshed; importer pin lists the CLI file and the `scripts/lib` core; no `scripts/lib` file calls the executor | Tasks 3, 10 | `protectedReadAudit.test.ts` (operator pin, executor-sites pin, no unused entry); `serviceCommitCallers.test.ts`; guards test; header reviewed in R1 |
| R21 runbook; ADR section in C2's ADR; no `docs/SECRETS.md` change | Task 11 | doc diff, reviewed in R1 |
| R22 retirement owned by C7 Step 12; a write marker in the CLI file after its imports | Task 10 | guards test «keeps a write marker after the CLI's imports and none before» |
| R23 fictitious world, injected fake clients, no network | Task 7 | `reconstructWorld.ts` (8 people + a deleted holder; June–September; counted and uncounted specials; drafts; cadence, exact, presence, newcomer, excluded-but-seated, ticked-never-seated, no-voz, absent/empty ministries, kids-only; manual, reconstructed and edited records) |
| Acceptance «Production» row | Release O5 | manual, recorded in the worklog and the PR |
| Consumes from C1 (`countsForFairness` through C2's builders and ledger; facts: past-month rule is client-side) | Tasks 3, 4, 7, 11 | flags read live and bound by the service digest; the runbook's standing instruction |
| Consumes from C2 items 1–6 (IF2-1–IF2-4, IF2-6; IF2-18–IF2-22; IF2-15; IF2-8–IF2-11; IF2-24–IF2-28; IF2-13) | Tasks 3–8 | each module's header names the IF2 items it uses; no second parser, seat rule, formatter or GROQ under `scripts/` |
| Consumes from C3 (the setting via IF2-15; `resolveRulePersonId` for the private report only; roster with `ministries` unstripped; v2-view guarantee) | Tasks 4, 7, Release O1 | `resolverRefusals` resolves `person` only for the report; IF2-27 rows passed unaltered |
| «Provides»: records `source: "reconstructed"`; the CLI's flags and exit codes | Tasks 1, 7–10 | the flag tests; exit codes asserted throughout |
| D1–D11 | D1 Task 10 (tsx); D2 Task 1; D3–D4 Task 4; D5 Tasks 6, 10; D6 Task 8; D7 Task 8; D8 Task 2; D9 Task 7 (unresolved refuses); D10 Task 7; D11 Task 4 | — |
| A2 (cadence settings counted, loud warning at zero) | Task 7 | «warns loudly when it finds no «Mes por medio»» |
| Q1 (a counted special sets a join month); Q2 (Tipo-eligible but unticked → `in` + anomaly) | Tasks 4, 5, 7 | counted special in `seatJoinMonths`; `not_ticked_today` |

**Coverage gaps (stated, not hidden):**
- **Replayed on `a35f812e`, not on `main`.** Every block applies and goes green there («Replay record»); `main` after C1, C3 and C2 merge may differ, which is why Task 0 Step 4 re-checks the anchors before Task 1.
- **Beyond the spec, deliberately:** the required `--fingerprint` flag and the member-input digest (each only adds a refusal). C7's W7/Step 10 command lines must gain `--fingerprint` when C7 is replayed — a sibling note for C7's coordinator; this plan edits no other file.
- **Order of the backup before the plan** is guaranteed by code order (Tasks 7, 9) and checked in review; no test observes the order of two file writes.
- **The production acceptance row** is manual by nature (Release O5).
- **The two «no se toca» rows' anomalies read the STORED record** (the after-apply rule, «Plan decisions»): on a foreign or edited month, `cadence_not_in`, `exact_mismatch`, the seat and presence anomalies describe the record that stays, not the computed body. A reviewer may want to confirm that reading of R13 («computed with the record R11's preview rule uses» is explicit only for `member_gone`). On those two rows the table's PERSON rows, by contrast, show the computed body (what a reconstruction would say), while their «Lugares» column and the preview read the stored record; the month's heading says it is not touched.
- **A seat holder with no member document has no display name**, so his preview row sorts first (R11's `es` collation on an empty name) and reads «Miembro eliminado» — deterministic, visible in the golden table.
- **Absent projected fields:** the plan assumes groq-js (tests) and the Content Lake (production) may answer an absent projected field as `null` or omit it, and every consumer tolerates both (`?? []`, `?? undefined`, C2/C3's own optional chaining) — true by inspection, and the replay ran every consumer over groq-js answers.

## Anchor provenance

**Verified on `c2-t10` (`1c500c7e`) or on the C1+C3 integration (`e358781d`) with `git show`:**
- `app/utils/fairnessMonthWriteRequest.ts` — the exports Task 3 imports; `RECONSTRUCTION_FIELDS` requires `expectedRev`; the read-client assertion; one guarded transaction per month for the reconstruction actor; delete = revision-asserting no-op patch + delete; `member_unknown` for a member with no document or no display name.
- `app/utils/fairnessVocabulary.ts`, `app/utils/fairnessLedger.ts` (`computeFairnessLedger`, `keepVoiceSeats`, `civilDayOfWeek`, `fairnessLedgerExactSums`; `held` counts kept + second seats per window month; `unknownMembers` = people with `exists: false`; presence `outside_population` notes on line `P:<ruleKey>`), `app/utils/fairnessFormat.ts`.
- `app/utils/serviceReadQueries.ts` IF2-24 … IF2-28 and `BoundQuery`; `app/utils/solverDeployment.ts` `fairnessRecordEnvironment`.
- `app/components/admin/plannerModel.ts` (`memberFitsPool`, `memberFitsRoleKey`, `rolesOfPatternV3`, `SolverConfig`, `PersonRestriction`, `RestrictionCap`, `saturdayForWeek`), `app/components/admin/serviceRuleContext.ts` (week numbering).
- `app/utils/__tests__/__fixtures__/fakeFairnessSanity.ts` (real GROQ via groq-js, `commits`, `put`, `failNext`, `hooks.beforeCommit`).
- `app/utils/protectedReadAudit.ts` (the `OPERATOR_TOOLING_ALLOWLIST` header and its last entry; the executor rule; `scanSource`'s client detection), `app/utils/__tests__/protectedReadAudit.test.ts` (the operator-tooling pin and the executor-sites pin), `app/utils/__tests__/serviceCommitCallers.test.ts` (scan over `app` and `scripts`; `PINNED_BEYOND_COMMIT` holds the write-request module).
- C1/C3: `app/utils/countsForFairness.ts`, `app/utils/sundayCadence.ts` (`resolveRulePersonId`, `RosterMember`), `app/utils/solverConfigWriteRequest.ts` (`solverConfigFromDocument`, `buildSolverConfigDocument`, `SOLVER_CONFIG_DOC_ID`).
- Existing: `scripts/lib/solverHistoryDiffRun.ts` (`realLocation` not exported; the rest exported), `scripts/lib/strip-comments.mjs`, `scripts/lib/__tests__/sr-retired-writer.test.mjs` (write markers), `app/utils/serviceReadModel.ts` (`isValidServiceDate` rejects impossible days), `app/utils/serviceReadSelect.ts` (`serviceDayKey`), `app/utils/memberRuleNames.ts` (`displayMemberName`, `rulePersonNamesMember`), `app/ministries.ts`, `docs/SOLVER_AND_INFRA.md` §3 headings, `vitest.config.ts` (`scripts/**/*.test.{ts,mjs}`).

**Taken from C2's plan, then verified on C2's final tip `a35f812e` by the replay (Task 0 Step 4 re-checks them on `main`):**
- **C2 Task 11:** the write-request module's caller-pin row reading `["app/utils/fairnessLedgerRead.ts", "app/utils/fairnessMonthCommit.ts"]` (Task 3's `Find`).
- **C2 Task 12:** `app/utils/fairnessEligibility.ts` — `resolveMonthEligibility({ month, config, members })`, `EligibilityMember`, `EligibilityResult` (issues `{ code, ruleKey? }`, refusals `{ person, reason }`), its people sorted by id with `voz` only, effective pools (ticked AND Tipo-fitting), `sundayCadence` on every cadence member's item, its week-exclusion and unavailable-date blocks; plus Task 12's edits inside the write-request module (limits moved to the vocabulary, `MEMBER_ID_RE`), which C4 uses only through C2's functions.
- **C2 Task 16:** ADR-0050's number, file name and closing «Consequences» text (Task 11's `Append`), and its README row ending «… and one seat per person per service. Amends no existing ADR (parent A31: C7 does, at the flip)» (Task 11's `Find`).
- **C2 Tasks 13–15** (preview model, panel, «Registrar»): no C4 code depends on them; the «Equidad» panel is used only by Release O5.
- **C2's final baseline counts** (Task 0 Step 3): 468 files / 8643 tests, 81 warnings on `a35f812e`.

## Self-review (writing-plans checklist)

1. **Spec coverage:** every R row, the acceptance table, the «Consumes from» items, «Provides», the D and A rows and Q1–Q2 map to a task above; the gaps are listed under «Coverage gaps».
2. **Placeholder scan:** no «TBD», «TODO», «similar to Task N» or test-less step; the one generated artifact (the golden snapshot) is a **Create** block in Task 7 Step 1, with the hand check it passed stated in Step 4. Two interim strings exist on purpose and are removed by later tasks: «modo no disponible todavía en esta versión» (Tasks 7–8, gone after Task 9).
3. **Type consistency:** names are used identically across tasks — `parseReconstructArgs`, `privatePathRefusals`, `parseOverrides`/`MemberOverride`/`ALL_MONTHS`, `validateReconstructionBody`/`hashOfBody`/`parseRecord`/`summarizeStored`/`decideWrite`/`decideDelete`/`RECORDED_BY`, `canonicalJson`/`fingerprintOf`/`serializePlan`/`parsePlanFile`/`planDifferences`/`serviceInputDigest`/`memberInputDigest`, `hypotheticalConfig`/`seatJoinMonths`/`countedServiceDays`/`transformMonth`/`resolverRefusals`/`validatorRefusal`/`dedupeRefusals`, `monthAnomalies`/`poolAnomalies`/`joinAnomalies`/`lostBlocks`/`sortAnomalies`, `ledgerMembers`/`plannedLogicalRecord`/`monthLedger`/`seatsPerLine`/`previewFigures`/`previewWindow`, `renderTable`/`replaceChanges`/`renderRefusalReport`/`renderApplyReport`/`renderRollbackTable`/`refusalLine`/`targetLine`, `runReconstruction`/`RunDeps`/`ClientConfig`/`ExecuteFn`/`errorClass`; C2's names exactly as C2 §7, `c2-t10` and `a35f812e` spell them.

## Execution handoff

Do not execute this plan until C1, C3 and C2 are on `main` (the replay has run on C2's final tip — «Replay record»). Then: **Subagent-driven (recommended)** — `superpowers:subagent-driven-development`, a fresh implementation worker per task, a review between tasks, the critical slices (Tasks 1, 2, 3, 4, 7, 8, 9, 10) reviewed at high effort; or **inline** — `superpowers:executing-plans` with checkpoints after Tasks 3, 7, 9 and 11. Either way the cycle closes with `finish-cycle` and the «Release» order; the production dry run and the `--apply` stay separate operations behind Frank's explicit consent.
