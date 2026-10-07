# Review log — `2026-10-05-solver-v3-c1-fairness-toggle-design.md`

Written after the loop ended; never shown to a reviewer. **Approval is not authorization to
implement.** Implementation still needs its own plan, the four gates, and a fresh code review of
the diff. The C1 implementation plan (`docs/superpowers/plans/2026-10-05-solver-v3-c1-fairness-toggle.md`,
committed in `cc05dff0`) cites this approval, but it is a separate artifact outside the approved
digest, and this loop did not review it.

## Tier

**Critical**, derived from the ladder, not raised or lowered. The artifact changes the payload of
two production service writers: role create (`POST /api/admin/roles`) and role edit
(`PATCH /api/admin/roles/[id]`). It also changes the create fingerprint, which decides between
receipt replay and `idempotency_mismatch`, and the PATCH contract: an absent field means
unchanged, and a toggle-only edit suppresses the notice. Requirement: two sequential fresh
`APPROVED` verdicts on byte-identical bytes.

## Rounds

C1 took part only in loop set 1 (2026-10-05, about 19:15 to 20:20 CST). Loop sets 2 and 3 ran no
C1 rounds because C1's bytes did not change; the private ledger records «C1 still cd519cf4…
(unchanged)» at the start of set 2.

| Set / round | Reviewed digest (SHA-256) | Commit | Verdict | Streak |
|---|---|---|---|---|
| 1 / 1 | `7d2c9c0abb7b5b91eb0fe40c3e450576002da3fbe623e8d191a7e3e0ba8ee6f4` | `c2c444fd` | CHANGES_REQUIRED (substantive: 1 of the 2-round cap) | 0 |
| 1 / 2 | `cd519cf479df9b3e3c423c2b974c991132c3f58af6b33205329180795ee4c87b` | landed in `2c403a0f` after both approvals (see below) | APPROVED | 1 (first round on the fixed bytes) |
| 1 / 3 | `cd519cf479df9b3e3c423c2b974c991132c3f58af6b33205329180795ee4c87b` (same bytes, its own immutable snapshot) | as above | APPROVED | 2, requirement met |
| 2 / — | no round; C1 unchanged | — | — | 2 (held) |
| 3 / — | no round; C1 unchanged | — | — | 2 (held) |

**The commit column.** Rounds 2 and 3 reviewed immutable snapshots, written at 19:32 and 19:47.
The fix was committed as `2c403a0f` at 20:20, after both approvals. The approval binds the
snapshot digest, not the commit. `git show 2c403a0f:<spec>` hashes to `cd519cf4…`, so the commit
holds exactly the approved bytes. The round 1 snapshot is byte-identical to the spec at `c2c444fd`.

Each reviewer was a fresh `skeptical-reviewer` instance, run one at a time for this artifact.
Loops on other artifacts (C2, C3, C4) ran in parallel. Each reviewer received only the reviewer
brief, the immutable snapshot path and digest, the repository, evidence pointers and the redacted
original requirement. None saw another reviewer's verdict. In every round, the snapshot and the
canonical file were hashed before the reviewer started and again after the verdict, and the hashes
matched (`postDigestsMatch` in all three rounds).

## What the reviewers checked (evidence, not claims)

- **Fingerprint.** `time`/`format` enter the canonical payload only when present, and
  `FINGERPRINT_VERSION = 1` (`app/utils/roleCreationReceipt.ts:33-34, :62-73, :186-192`). The same
  request id with a different fingerprint gives `idempotency_mismatch`, and an equal one replays
  (`app/utils/roleWriteRequest.ts:706-743`; `app/api/admin/roles/route.ts:131-135`). The create
  route hashes the raw body (`roleWriteRequest.ts:290-305`). Rounds 1–3.
- **Parsers.** Both parsers ignore unknown keys and validate before any read
  (`roleWriteRequest.ts:283-362`; create `route.ts:111-135`; edit `[id]/route.ts:117-139`).
  `buildRoleEditPatch` unsets `time` when it is absent. The spec's «absent means unchanged» rule
  deliberately departs from that (`roleWriteRequest.ts:252-256`).
- **Stale toggles.** The PATCH asserts the revision the client saw and commits with
  `ifRevisionId`, so a stale toggle is a 409, not an overwrite (`[id]/route.ts:86-93, :291-296`).
  Round 3.
- **Notice suppression (§5.4.4).** The PATCH queues one upsert per member across the before and
  after assignees. Each upsert re-pends the notice and clears `servedRecipients`
  (`[id]/route.ts:413-433`; `serviceMutationSideEffects.ts:478-529`; `outboxNotice.ts:148-184`).
  The push goes only to added assignees (`serviceMutationSideEffects.ts:329-352`). The flush
  compares per-member label sets (`assignmentEmail.ts:65-73`; `outboxClassify.ts:44-48, :72`). So
  the suppression is a strict subset of "the flush would say nothing" and never drops an email
  that would have sent. Rounds 1–3.
- **Field survival.** Nothing under `app/` replaces a role document wholesale. The other writers
  patch only the fields they name (`roleSwapCommit.ts:321-329`, `publishReadyCommit.ts:124-130`,
  `roleUnpublishCommit.ts:197`, `copy-instruments/route.ts:143-150`), so the field survives
  publish, unpublish, swap and copy. Round 3, by grep.
- **Read rule.** `coalesce(countsForFairness, _type != "special_role")` was evaluated with
  `groq-js` on {absent, null, true, false} × {weekend, special} (round 1). It was not checked
  against the live Sanity API.
- **Draft gating.** A backtick literal of the fragment trips `draftGatingCoverage`'s bare-predicate
  scan (1 violation) and a plain quoted string does not (0). Round 1 checked this by simulation
  against `draftGatingCoverage.test.ts:191-193`.
- **Projections.** `ROLE_PROJECTION` lacks the field, and its consumers are as the spec lists
  (`serviceReadQueries.ts:17-26`). `GET /api/admin/roles` has its own inline projection, limited
  to admin and super-admin and pinned by a test (`route.ts:47-84`;
  `roleWriteRoutes.test.ts:459-467`). R11's rebuild is projection-bound and covers weekend roles
  only (`solverHistoryEvidence.ts:120-170`).
- **Planner save model.** The PATCH body drives the snapshot, the dirty check and reconciliation
  (`plannerSaveModel.ts:122-160, :229-250`; `MonthGenerator.tsx:2262-2280`). «+ Nuevo servicio»
  keys its attempt on `{type,date,name,time,format}` (`MonthGenerator.tsx:3067-3110`). Month
  drafts keep one request id for life (`monthDraftCreate.ts:1-12`). The only role POST/PATCH
  callers are the four surfaces C1 covers.
- **Other surfaces.** MCP has no role create or edit tool. Studio role types are `readOnly`. The
  verification harness mirror has no `time`/`format` rows.
- **Siblings.** C2, C4, C6 and C7 all read A25's «lookback months» as months before the current
  one. Round 3.
- **Not run.** No reviewer ran vitest, tsc or eslint; every round was read-only. Each reviewer
  listed its UNVERIFIED items: GROQ semantics against the live API, sibling internals beyond the
  cited lines, whether `protectedReadAudit.test.ts` snapshots `reason` text, and the effect of
  browser clock skew on the client-side past rule.

## Blockers

### Set 1 / round 1 — one blocker, substantive

| # | Blocker | Disposition | Evidence checked |
|---|---|---|---|
| 1 | The claim «services of past months cannot be toggled from any surface» (§2 evidence row, §9 «Facts the consumers must hold», §12, §14 Q1, resting on parent A25) is false under C1's own §6.4. Past months open in the stored editor through the «Roles previos» pills plus «Editar mes», or through a past card's «Editar equipo», and nothing on that path checks the month. So the §6.4 Switch would be live on past services, and three siblings reasoned from the false fact. | **fixed** (option (a), widened) | Confirmed against `c2c444fd`. `monthPills.ts:14-18` builds only the upcoming pills. `ServicesPanel.tsx:809-815` builds `pastMonths` and `:1191-1208` renders them. «Editar mes» (`:1122`) and «Editar equipo» (`:1331`, via `ServiceReadinessCard.tsx:216-220`) call `openMonthEditor` (`:792-805`), which takes any month. The stored header is disabled only on `readOnly` or `mutationLocked` (`PlannerGrid.tsx:2475-2503`). The edit gate (`serviceReadiness.ts:825`) and stored admission (`storedRoleReadModel.ts:326-346`) do not check the month, and neither does the PATCH route. **The author widened the finding:** create surfaces also accept past dates. «+ Nuevo servicio» accepts any date in the open month (`MonthGenerator.tsx:3071-3073`), and the month-create config accepts any month from 2024 on (`:4135-4141`, `MIN_YEAR` `:1257`). |

**What the fix changed.**

- A new §6.0 defines «past» as a month before `serviceTodayIso().slice(0,7)` (CDMX). It is
  evaluated at render and again when the request body is built.
- A stored column is past if its stored date or its edited date is past. Its Switch is then
  disabled and shows the stored value, and the body and snapshot carry the stored value.
- A past-dated create target takes its type default, with the Switch disabled. The reason line
  reads «Mes pasado: ya no se cambia.»
- A new decision, C1-D7, records that the rule is client-side only and why.
- A new requirement, C1-R14, comes with UI, save-model and draft-create tests on a fixed clock
  across a month boundary, plus a §15 row.
- Follow-on edits: §6.2–§6.5 each gain the past state. §2's evidence row is rewritten with the
  real path. §9 states the fact precisely: no app surface can toggle a past service, but a
  hand-built admin request still can, and a date move can carry a service across the boundary.
  §10 gains a known limit, and §12, §14 Q1, Revision, §3 and «Parent issues» are updated.
- The parent's A25 stays true under option (a), so review did not restart from the parent.

Rounds 2 and 3 found no blockers.

## Non-blocking items and their disposition

### Round 1: adopted in the fix, so inside the approved digest

| # | Item | Disposition |
|---|---|---|
| 1 | §7 says `draftGatingCoverage` stays green with no table edit, which is true only if `COUNTS_FOR_FAIRNESS_GROQ` is not a backtick string | Adopted. §5.2 requires a plain quoted string, and the §7 and §15 rows say so. Verified against `draftGatingCoverage.test.ts:72, :96-104, :139-147, :191-193, :340-344`. |
| 2 | A Studio `initialValue` would be a second spelling of the default, because `sanity/` cannot import `app/` | Adopted. §5.1 forbids `initialValue`, and §15's grep covers `app/**` and `sanity/**`. |
| 3 | §11 omits `docs/NOTIFICATIONS.md`, although §5.4.4 changes when a PATCH queues a notice | Adopted. §11 lists it. |
| 4 | §8 rollback after C2/C6: C2 imports the read-rule module, so a full revert breaks `tsc` | Adopted. §8 says a revert stops being a rollback once C2 or C6 merges. The partial rollback keeps both modules, the GET row field, the client types and the writers' acceptance of the field. |
| 5 | The Revision paragraph lists A1–A39, but the parent is at A40 | Adopted. A40 is noted as read and not applicable (it governs C6's confirm writer). |
| 6 | (author, self-found) The evidence baseline omitted `c2c444fd`, and §6.0 promised an accessible description that `Switch` cannot carry (`Switch.tsx:32-45`) | Adopted as stale prose. The mechanism is left to the plan. |

### Rounds 2 and 3: deferred, spec unchanged

These items came on `APPROVED` rounds. Adopting any of them before the second approval would have
reset the streak, and **the spec was not edited after the second approval either** (see
«Post-approval changes»), so none of them is in the spec. Where the C1 implementation plan visibly
takes an item up, the table says so. **That plan is un-reviewed by this loop**, and its handling
must be checked by its own self-review and by the code review of the diff.

| # | Item (round) | Disposition |
|---|---|---|
| 1 | The evidence row «No test pins a literal fingerprint today» is false: `roleWriteRequest.test.ts:682, :749` already pin two (R2, R3) | Not adopted in the spec. The plan's Global Constraints list both existing pins as literals that must stay green. |
| 2 | Implementation hazard: `storedHeaderEdits` is spread over the column (`MonthGenerator.tsx:2268-2272`), so a past column's stored toggle must be kept where the overlay cannot hide it (R3) | Not adopted in the spec. The plan keeps the stored date and value beside the header overlay. |
| 3 | Rollback skew: a tab loaded against a rolled-back server sees no field and later sends the default, silently resetting a stored non-default (R2). The same skew leaves «+ Nuevo servicio» unverified and locked until a reload (R3) | Not adopted in the spec. The plan makes the client row field optional for an older server and keeps §8's «reload open tabs». Whether the plan's absent-key handling prevents the reset was not traced. |
| 4 | The public gallery fixture hosts `PlannerGrid` with past dates, so the visual baseline would move (R2) | Not adopted in the spec. The plan puts the switch behind an optional prop the fixture never passes, so the fixture stays byte-identical. |
| 5 | The `NOTIFICATIONS.md` text should say the suppression applies to every planner save with no reportable change, not only to switch flips (R3) | Not adopted in the spec. The plan adds a `NOTIFICATIONS.md` section on the toggle-only PATCH rule. Whether its wording covers the wider scope was not traced. |
| 6 | Citation: `serviceReadiness.ts:995-998` should read `app/components/admin/serviceReadiness.ts:996` (R2, R3) | Not adopted in the spec. The plan cites the correct path and line. |
| 7 | Retries across a month boundary: a «+ Nuevo servicio» retry after midnight on the 1st mints a new request id (409 conflict), and a month-draft retry gets `idempotency_mismatch`; both should be stated in §10 (R2) | Not adopted in the spec; not traced to the plan. |
| 8 | «Lookback» versus «past» wording, and C4 Q1's October claim (R2, R3) | Not adopted in the spec, where §9 already states the consequence. The C4 half is closed by the sibling edit below. |
| 9 | State the known escape route in one sentence for C7: move a past service into the current month, toggle it, move it back (R2) | Not adopted in the spec; not traced to the plan. |
| 10 | C1-D7's rejected alternative overstates its cost: a POST refusal needs no stored read, because the date is in the payload (R2) | Not adopted. The reviewer agreed the decision stands. |
| 11 | The Switch's accessible name is ambiguous for two specials on one day (R2) | Not adopted in the spec; not traced to the plan. |
| 12 | Citation: the PATCH loads through `loadRoleForMutation` (`[id]/route.ts:88, :137`), not `loadRoleForWrite` (R2) | Not adopted. |

## Sibling changes

Round 1's fix asked for changes in C2, C4 and C7. Each sibling's owner agent applied them in later
passes. They are now present:

- **C4** — the effective-value and past-month row (`…-c4-record-reconstruction-design.md:104`)
  and §9 «as C4 holds them» (`:125-126`). Both carry the client-side qualifier (C1 §6.0, C1-D7).
  The October caveat also closes R2/R3's note on C4's October claim. The reviewer's C4 line cites
  (`:96`, `:394`) are stale because C4 has since moved. The content above is what was verified.
- **C2** — the §7 «Consumed» C1 row (`…-c2-ledger-and-record-design.md:368`) says «absent on
  legacy ones until a post-C1 stored-mode save writes their effective value (C1-D5)» and carries
  the client-side qualifier.
- **C7** — the C1 row (`…-c7-cutover.md:223`) carries the client-side qualifier and points to C1
  §6.0.
- **Parent** — unchanged. A25 is true under the chosen fix.

## Process notes (author side)

- **No churn on C1.** It had one substantive `CHANGES_REQUIRED` round, so the cap was never reached
  and no go-ahead was needed for C1. Frank's two go-aheads governed C2, C3 and C4, **not C1**:
  - 2026-10-05 about 20:35 CST: «Sí, con la consolidación». This followed the churn cap on C2, C3
    and C4 in set 1. C2 became the single source of its interfaces (IF2 IDs), and siblings cite
    them instead of restating them.
  - 22:52 CST: the standing authorization to continue past the cap without further consultation,
    recorded in the private ledger.
  - C1's approval predates both and does not rest on either.
- **Delegated verification.** For round 1, a fresh «author» agent verified the blocker against the
  repository, recorded its disposition and evidence, and applied the fix. The coordinator did not
  personally re-verify every disposition. Round 1's dispositions in this log are that agent's
  record, and the later cold approvals were the independent check on the result. The same agent
  widened the finding to the create surfaces (above), which the reviewer had not reported.
- **Sibling edits that reset approvals elsewhere.** A later cross-check required editing C4 (key
  hygiene, later parent A41), which reset C4's approval and sent it back for review. **No such
  edit touched C1**: its digest is unchanged through sets 2 and 3.
- **Read-only rounds.** No round ran the test suite, `tsc` or `eslint`. GROQ semantics were
  checked with `groq-js` only. These limits carry into the plan and the code review.
- **The implementation plan was drafted on the same night** (`cc05dff0`). It cites this approval
  and says it never changes the spec. It is a separate, un-reviewed artifact. This approval
  authorizes neither the plan nor the implementation.

## Post-approval changes

None. As of this log, `shasum -a 256` of the spec returns
`cd519cf479df9b3e3c423c2b974c991132c3f58af6b33205329180795ee4c87b`, which is the approved digest.
No round 2 or round 3 non-blocker was folded into the spec.

## Approved digest

`cd519cf479df9b3e3c423c2b974c991132c3f58af6b33205329180795ee4c87b`, reviewed from immutable
snapshots in set 1, rounds 2 and 3, and committed unchanged in `2c403a0f`. The spec's current
bytes equal it.
