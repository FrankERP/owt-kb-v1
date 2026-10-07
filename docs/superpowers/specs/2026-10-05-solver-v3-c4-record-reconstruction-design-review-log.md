# Review log — `2026-10-05-solver-v3-c4-record-reconstruction-design.md`

Written after the loop ended; never shown to a reviewer. **Approval is not authorization to
implement** — implementation still needs its own plan, the four gates, a fresh code review of the
diff, and, before any `--apply` against production, a dry run and Frank's explicit consent to the
plan it prints (CLAUDE.md, «Production Sanity writes need explicit user consent»).

## Tier

**Critical**, derived from the ladder, not raised or lowered: the artifact specifies a production
data-writing script — it creates, replaces and deletes `fairnessMonth` records in the production
dataset, run with consent — and those records are what every later v3 solve, the «Equidad» panel and
the DL floor read as the truth about past eligibility. Requirement: two sequential fresh `APPROVED`
verdicts on byte-identical bytes.

## Rounds

Three loop sets ran on 2026-10-05 (times CST). Each round copied the canonical file to an immutable
snapshot in the private review folder, and hashed the snapshot and the canonical file before the
reviewer started and again after the verdict; the digests matched in every round
(`postDigestsMatch`).

| Set · round | Reviewed digest (SHA-256) | Commit | Verdict | Streak |
|---|---|---|---|---|
| 1 · 1 (~19:12) | `f50c0b1818509ab6d56af042117f276af00c6de6912ebceff8ea21dd50e658ca` | `c2c444fd` | APPROVED | 1 |
| 1 · 2 (~19:28) | `f50c0b18…658ca` (same snapshot) | `c2c444fd` | CHANGES_REQUIRED — substantive | **reset to 0 by a contrary verdict on identical bytes**: the second fresh reviewer raised two blockers, one the first reviewer had missed and one it had rated non-blocking |
| 1 · 3 (~19:56) | `9b1d6f000b7e0c8f674008ec695f3a3a0c77616eaf50e9b2e97e45f852c16576` | none — uncommitted working copy | CHANGES_REQUIRED — substantive | 0 — **churn cap reached** (2 substantive rounds); set stopped |
| 2 · 1 (~22:08) | `61741ec5b2ab4e798883c47284dd7c792afe18688f49952b98a1490513238977` | `1d1bba18` | APPROVED | 1 (fresh cap, after Frank's go-ahead) |
| 2 · 2 (~22:24) | `61741ec5…238977` (same snapshot) | `1d1bba18` | APPROVED | 2 — requirement met, then **reset by an author edit** (key hygiene, below) |
| 3 · 1 (~23:28) | `954869fe589ecccfe4f70a673792500ddd2b371791e6cd9d14882c1a165fb21a` | `cc05dff0` | APPROVED | 1 |
| 3 · 2 (~23:44) | `954869fe…fb21a` (same snapshot) | `cc05dff0` | APPROVED | 2 — **requirement met; final** |

Commit notes. Set 1's fix after round 3 was committed in `2c403a0f` (digest `5c6c913d…`), at the
cap; those bytes were never reviewed and were superseded by the consolidation. The digests `61741ec5`
and `954869fe` were reviewed as working copies and committed byte-identical afterwards (`1d1bba18`
at 22:55, `cc05dff0` at 00:05 on 2026-10-06), checked with `git show <commit>:<path> | shasum -a 256`.

Every reviewer was a fresh `skeptical-reviewer` instance, run one at a time for this artifact (loops
on the sibling specs ran in parallel), given only the reviewer brief, the immutable snapshot path and
digest, the repository, evidence pointers and the redacted original requirement. None saw another's
verdict.

## What the reviewers checked (evidence, not claims)

Across the seven rounds, against the repository and the sibling specs' text:

- Snapshot identity every round (`shasum`, and an empty `diff` against the working-tree spec).
- The read client: `operationalClient` treats the read token as optional, uses the `published`
  perspective and `useCdn: false`, and is `server-only` — `sanity/lib/operationalClient.ts:1-23`.
  This is why the spec checks the token before building any client.
- The worship filter: `WORSHIP_AUDIENCE_GROQ_FILTER` has no `$all` arm and absent or empty
  `ministries` means worship; a bare `"worship" in ministries` would drop the legacy team —
  `app/ministries.ts:41-76`.
- That no roster-with-Tipo or rule-set read builder existed in the code: the only roster builder
  projects `_id, member_name` — `app/utils/serviceReadQueries.ts:378-407`; the admin route reads the
  config inline and answers an absent document as `present: false`, never the defaults —
  `app/api/admin/solver-config/route.ts:71-90`; `SOLVER_CONFIG_DOC_ID` and `solverConfigFromDocument`
  at `app/utils/solverConfigWriteRequest.ts:51`, `:351`.
- Pool fit is `voz` plus subtype, v2 de-duplicates pools, and v2's pool-to-role map —
  `app/components/admin/plannerModel.ts:805-811`, `:873-879`; `gcf/owt_solver_v2.py:642-648`.
- `unavailableDates` is a plain string array on the member — `sanity/schemas/worshipTeam.ts:222-228`.
- Seed-era rule ids embed first names and survive edits (`initialValues?.id ?? uid()`) —
  `app/components/admin/solverConfigDefaults.ts:53-96`; `MonthGenerator.tsx:388`, `:668-675`.
- The guards: `RETIRED_ONE_SHOT_WRITERS` and `OPERATOR_TOOLING_ALLOWLIST` at
  `app/utils/protectedReadAudit.ts:307`, `:367`; the tests pin exact lists, refuse globs and dead
  entries, and require the retired-writer import and `assertRetiredWriter("` call —
  `protectedReadAudit.test.ts:354-361`, `:434-462`, `:486-506`, `:531-538`; the retirement gate test
  needs a write marker after the gate — `scripts/lib/__tests__/sr-retired-writer.test.mjs:112-141`;
  the caller pin scans `git ls-files app` only today — `serviceCommitCallers.test.ts:54`, `:65-69`.
- Script precedents: `tsx` runtime (`scripts/requeue-role-notices.mjs:18-27`); token per mode,
  `ifRevisionId`, «re-run the dry run», `process.exitCode` (`scripts/migrate-proposal-messages.mjs:41-47`,
  `:158-209`); refusing private paths inside any worktree (`scripts/lib/solverHistoryDiffRun.ts:212-227`,
  `:386-395`).
- No new secret: both tokens are documented for the scripts' dry-run and apply halves —
  `docs/SECRETS.md:274-296`; the main checkout's `.env.local` carries no `VERCEL_ENV` key (key-only
  grep), so records are stamped `environment: "local"`.
- Sibling contracts: C2's decision rows (WR-14 rows 1–9, D1–D4) match C4's «Decision per month»
  table and R18 row for row; every `IF2-` ID C4 cites exists in C2 §7 with the cited shape (sets 2–3);
  C1 §9's past-month facts, C3 §7 items 4 and 7 and §6.12, and C7 Steps 10 and 12 match how C4 uses
  them; the parent amendments C4 relies on say what C4 claims.
- Several reviewers also read the private real-data evidence and confirmed the join-month bound would
  not change the August/September records; the findings are recorded here by section and role only.

Recurring UNVERIFIED item, every round: Sanity's documented behaviour that a dotted id is private and
readable only with a token under the `published` perspective (parent A2, C2 §3). Reviewers judged it
fail-safe: the token is required before any read, and a create on a misread «sin registro» month
collides as `record_exists` and never overwrites.

## Blockers

### Set 1, round 2 (`f50c0b18`) — substantive

| # | Blocker | Disposition | Evidence checked |
|---|---|---|---|
| 1 | Interfaces 4 relied on two C2 read builders C2 RD-1 did not provide: an unfiltered worship roster carrying `memberType`/`ministries`/`alias`, and a `solverConfig` read. R3 forbids C4 its own GROQ, and the Terminal state did not track the gap | **Fixed** (C4 text) + two sibling rows asked of C2 | C2 RD-1 (working copy :201) read only referenced members (`_id`, `member_name`, `alias`, `unavailableDates`) and never `solverConfig`; C2 §7 «To C4» (:466) listed only RD-1's builders; `serviceReadQueries.ts:398-407` projects `_id, member_name` with no ministry filter; `solverConfig` is read inline at `solver-config/route.ts:71-77`. C4 now separates what RD-1 provides from what C2 owes, refuses an absent `solverConfig` (exit 2) instead of using defaults, and gates its Terminal state on the C2 rows |
| 2 | R13 had no anomaly for the case R5's join rule systematically understates: a Tipo-fit member, ticked in today's pool, with no counted seat in a line, reads `out` every month and «al día» | **Fixed** | R5 and R13 as written covered the inverse case and the overstatement only. R13 gained «ticked today, never seated», per person and line, printed with R8's join-month override as the fix (a cadence member's `Sun.Lead` excluded, R6); A21 and D3 unchanged; R23's fixture and R13's acceptance cover it |

### Set 1, round 3 (`9b1d6f00`) — substantive

| # | Blocker | Disposition | Evidence checked |
|---|---|---|---|
| 1 | C4's own precondition was false: C2 still did not provide the roster builder or the `solverConfig` builder that Interfaces 4(a)/(b), R3, R4, R6, R9, R13 and RES-5/RES-7 depend on | **Fixed in C2**, not in C4: the builders landed in C2 during the consolidation as IF2-27 and IF2-28. In the meantime C4's Terminal state was changed from `READY_FOR_ADVERSARIAL_REVIEW` to `BLOCKED_ON_SIBLING`, listing every unmet C2 row | Independently re-checked by the author agent: C2 RD-1 (:201) still had no `memberType`, `ministries` or config read; §7 «To C4» (:466) unchanged; a grep found no `SOLVER_CONFIG_DOC_ID` or `solverConfigFromDocument` anywhere in C2. Set 2's reviewers confirmed IF2-27 projects `ministries` under `WORSHIP_AUDIENCE_GROQ_FILTER` and IF2-28 answers `null` for an absent document |

Sets 2 and 3: no blockers in any of the four rounds.

## Sibling changes requested of C2 and where they landed

All six rows were raised by C4's fix rounds in set 1 and applied to C2 by its owner agent in later
passes; the set-2 consolidation pass checked each against C2's text.

| Row | Ask | Landed as |
|---|---|---|
| 1 | Neutral, unfiltered worship-roster builder (`WORSHIP_AUDIENCE_GROQ_FILTER`; no `voz`, Tipo, pool or `disabled` filter; projects `_id, member_name, alias, memberType, ministries, unavailableDates`) | IF2-27 (RD-6) |
| 2 | `solverConfig` singleton builder returning the document or `null`; `null` means absent, never the defaults | IF2-28 (RD-6) |
| 3 | WR-17 wording: the transform may also add a `people` item the resolver did not list (C4 R8) | WR-17 parenthetical |
| 4 | One neutral stored-document → `LogicalRecord` parser, shared with RD-2's server reader | IF2-20 |
| 5 | The record-free seat-keeping step (LG-1 duplicate drop, LG-2 counted filter, LG-4 one seat per person per service) exported for C4's join months | IF2-11 (LG-4 export) |
| 6 | Name the CLI file `scripts/reconstruct-fairness-months.mjs`, not the script core, as the executor call site and audit site, unconditionally; the caller pin lists both the CLI file and the core | IF2-23, WR-16, GU-5, REC-9 |

## Non-blocking items and their disposition

**Set 1, round 1 (approved, 13 notes).** Most were adopted through round 2's fix, whose items overlap them: R5's
join-month walk follows the ledger's seat rules (later via IF2-11); R6 keeps the cadence setting as
the resolver returns it; the no-seat anomaly (raised again as round 2's blocker 2); R1 and the skip
row agree; the refusal list covers every resolver reason and the typed issues, and
`presence_member_not_listed` is never printed with its name; the stale sibling rows and the LG-10/LG-4
citation; the replace backup (adopted in round 3's fix); the audit site always flagged (sibling row 6).
**Not adopted:** codepoint ordering for the serialized plan (re-raised in set 2; `es` collation still
orders rows, :266); binding `--apply` to the reviewed, merged commit or a recorded git SHA (re-raised
in set 3 as a mechanical fingerprint check); R21 amending C2's ADR in place rather than by «amended by»;
and the claim that the Evidence row on the earlier reconstruction attempt (:87) misstates the counts
in the private report — that row still reads as before and its owner should check it against the
report before the implementation plan cites it.

**Set 1, round 2 (in its fix).** Adopted: C2 working-copy drift (`member_unknown` added to Interfaces
2 and the R14 matrix; read client on `published` with `useCdn: false`; replace as a guarded patch,
delete as patch plus delete in one transaction, never `createOrReplace`); presence rules shown per
month with a presence anomaly and the limitation stated; rollback reads only the requested records,
refuses `--overrides`/`--preview-run`, and has its own fingerprint; `--plan` refused inside the
repository; the executor call confined to the CLI file so R22's retirement test holds; R2 scoped to
written records; R21's re-run-after-edit instruction; R5's join window ends at the last requested
month; R1 and the skip row agree; R6 keeps `sundayCadence`; R8 can add a worship member the resolver
did not list.

**Set 1, round 3 (in its fix).** Adopted: a service-input digest added to R15's fingerprint so its
acceptance test can pass; a backup before every planned replace plus the «fecha bloqueada perdida»
anomaly (carrying blocks forward automatically was rejected: a record cannot tell an override-added
date from a member's own); R11's preview names which record feeds each window month; a neutral stored
record parser (sibling row 4); the CLI file as executor caller (sibling row 6); join months from kept
seats only (sibling row 5); a private refusal report under `--out`. **Declined:** per-month presence
overrides — a stated, defensible narrowing; widening the overrides schema in a critical spec is not
warranted without evidence that a presence rule failed in August–September.

**Set 2 (both approved; 5 + 9 notes).** Nothing could be adopted before the second approval without
resetting the streak. The only set-2 note that reached the final text is R22's registration in
`RETIRED_WRITERS` (set 2 round 1), which arrived through the cross-check edit described below; the
set-2 → set-3 diff (11 hunks) is the complete list of edits between the two approved digests.
**Not adopted, open for the C4 implementation plan:** the apply-mode command line (which of
`--months`, `--overrides`, `--preview-run`, `--out` the apply takes, and refusing a mismatch); R15's
`unavailableDates` acceptance text, which overclaims for preview-only months; citing the environment
stamp function rather than hard-coding `"local"`; codepoint order for serialized plan contents;
refusing to overwrite backups and the reviewed plan; comparing a re-create after rollback against
the backup; merging an override's blocked date with an existing block; per-month ledger calls and
placeholder fields for the in-memory preview record; R8's validation order; R11's reason-code source;
R6(a)'s wording.

**One open item needs resolving, not just carrying.** Set 2 round 1 marked it «fix before
implementation»: C2 §7.4 row «C4» (`c2:872`) says C4 hands the resolver IF2-28's parsed document
«as `config`», while C4's Interfaces (:169) replace its three pools with R4's Tipo-derived ticks, and
C4's own D11 (:376) still says the config is «today's, unaltered». Neither the asked C2 sibling row
nor the D11 reword landed, and set 3 did not re-raise it. Both specs leave a consumer's obligations
in its own text, so R4 governs and there is no runtime defect as written, but an implementer following
C2 §7.4 would hand the real pools to the resolver and get materially different records. The C4
implementation plan must resolve it.

**Set 3 (both approved; 7 + 10 notes).** All deferred and none adopted: the approved bytes are the
reviewed bytes. Open for the implementation plan: a required `--fingerprint` on `--apply` and
`--rollback --apply` so consent binds mechanically; the apply-mode command line; exit codes when the
first month's executor verdict refuses (R16 says 1, «Provides» says 2); apply checking the backup
file's hash; week-exclusion blocks that no override can remove (state the limitation or extend R8);
placeholder fields the preview builds for IF2-10; R11's reason codes; R13's «ticked today» check
reading RES-1's map (derive it from a second IF2-15 call instead); the rule ordinal defined over the
parsed config; R15's `unavailableDates` acceptance wording; the environment-stamp function's IF2 ID;
an error-path test whose fake client throws messages carrying fixture names; recording the run's own
inputs in the plan; `record_missing` absent from the decision matrix; «corregido» living in the table
and plan, not the strict record body. The concurrent cross-check also listed the preview's
`LogicalRecord` placeholder fields as a minor C2/C4 seam; it is the same item.

## Process notes (author side)

- **Churn cap reached in set 1.** Rounds 2 and 3 were both substantive (`stop: CHURN_CAP`). The
  coordinator logged the defect class — cross-spec interface drift, siblings restating C2's
  interfaces — and asked Frank **before** any round three. His answer, recorded in the private ledger:
  «Sí, con la consolidación». C2 became the single source of its interfaces (`IF2-` IDs); siblings
  cite, never restate; loops restarted with a fresh cap.
- **Same defect class twice, and an author-introduced false precondition.** Round 2's blocker 1 and
  round 3's blocker were the same class: C4 depending on C2 reads that were not in C2's text. Round 2's
  fix added the sibling rows but left C4 declaring `READY_FOR_ADVERSARIAL_REVIEW` while those rows had
  not landed — a false precondition the author wrote and round 3 caught. This is the skill's «the
  defect is the method» signal, and it is what the consolidation remedied.
- **Approval reset by a later edit.** Set 2 met the requirement on `61741ec5`. The program's
  cross-check round 2 then found that C4 printed seed-era rule keys as if they were name-free (they
  embed first names in production) and that C4's R22 omitted the `RETIRED_WRITERS` registration. The
  edit that fixed them (key hygiene — config ordinals on stdout, never a key or a hash of one — later
  made program-wide as parent A41; plus R22, the audit header in R20 and IF2-18's `currentMonth`)
  moved C4 to `954869fe` and voided set 2's approval. Set 3 re-reviewed from zero.
- **Blanket go-ahead.** C2 reached the cap again in set 2. At 22:52 Frank wrote «Me voy a dormir, no
  me consultes más. Te autorizo lo que necesites para seguir avanzando», recorded in the private ledger
  as the explicit go-ahead to continue past the cap without further consultation. For C4 it is context
  only: set 3 was a re-review forced by the edit, with zero `CHANGES_REQUIRED` rounds, so C4 did not
  continue past a cap under it.
- **Delegated blocker verification.** Each `CHANGES_REQUIRED` round's blockers were verified against
  the repository by a fresh author agent, which recorded each as fixed, fixed-but-non-blocking-class,
  or refuted, with evidence. The coordinator did not personally re-verify every disposition; the
  dispositions above are those records, not a second independent check.
- **Sibling edits by their owners.** Sibling changes requested by C4's fix rounds were applied to C2
  by C2's owner agent in later passes, not by C4's author.
- **Unreviewed bytes committed at the cap.** `2c403a0f` carried C4's post-round-3 fix (`5c6c913d…`)
  into the branch un-reviewed; the consolidation rewrote it before any approval counted.

## Post-approval changes

**None.** The spec's current bytes hash to the approved digest (`shasum -a 256`, checked when this log
was written), and `git status` shows no change to the spec. `61741ec5` was also approved twice but is
superseded: it is not the approved text.

## Approved digest

`954869fe589ecccfe4f70a673792500ddd2b371791e6cd9d14882c1a165fb21a` (commit `cc05dff0`), two
sequential fresh `APPROVED` verdicts on the same immutable snapshot in set 3. Approval is not
authorization to implement.
