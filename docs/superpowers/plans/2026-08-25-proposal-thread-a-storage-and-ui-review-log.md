# Review log — Child A: the thread (storage, migration, UI)

Artifact: [`2026-08-25-proposal-thread-a-storage-and-ui.md`](2026-08-25-proposal-thread-a-storage-and-ui.md)
Parent: [`2026-08-25-proposal-thread-roadmap.md`](2026-08-25-proposal-thread-roadmap.md)

## Outcome

**APPROVED for Phases B–E** — two sequential fresh `APPROVED` verdicts on
byte-identical text, digest `5713a9ccd482bb6f3328b5c833a899967313d835aad9153538cd511cefc442bc`.

**Approval is not authorization to implement.** Each phase still requires its own
fresh code review of the diff plus the documented gates, and the Phase D `--apply`
still requires Frank's explicit consent in chat at the moment it runs.

## Risk tier

**CRITICAL, derived from the ladder.** Three enumerated triggers: a one-shot
data migration against the single production Sanity dataset, a production mutation
trust boundary (two new writers), and a concurrency-protocol change on an existing
guarded writer.

## Lineage

This artifact is the successor to a single-plan version
([`2026-08-24-proposal-message-thread.md`](2026-08-24-proposal-message-thread.md),
whose own log is [here](2026-08-24-proposal-message-thread-review-log.md)). That
plan ran **five rounds without ever reaching an approval**. Six of its nine
blockers were on the outbox/notification surface, which is why the work was split;
this child owns storage, migration and UI, and Child B owns notifications.

## Rounds

| # | Digest | Verdict | Blockers | Streak after |
|---|---|---|---|---|
| 1 | `dc6274ce…` | `CHANGES_REQUIRED` | 3 | 0 |
| 2 | `e3a421d6…` | `CHANGES_REQUIRED` | 3 | 0 |
| — | — | *consolidated: 790 → 648 lines, one normative statement per rule* | — | 0 |
| 3 | `fefc5602…` | `CHANGES_REQUIRED` | 2 | 0 |
| 4 | `03914e22…` | `CHANGES_REQUIRED` | 1 | 0 |
| 5 | `5713a9cc…` | **`APPROVED`** | 0 | 1 |
| 6 | `5713a9cc…` | **`APPROVED`** | 0 | **2 — requirement met** |

Blockers per round: **3 → 3 → 2 → 1 → 0 → 0.** The step down happens at the
consolidation, which is the same pattern the predecessor showed.

## Blockers, with the evidence actually checked

Every blocker below was independently verified against the source before being
accepted — not accepted on the reviewer's citation.

### Round 1

| Blocker | Evidence checked |
|---|---|
| The append rule had no "changed" predicate, and `leadNotes` is a one-time initializer re-sent on every save — so a lead with the page open would mint identical bubbles on every draft save, permanently, since this delivery has no delete path | `ProposalEditor.tsx:121` (initializer), `:350` (always sent) |
| The mirror, written unconditionally from `messages[]`, **blanks** a document with a note and an empty array, and **silently reverts** a newer note with an older migrated body — a class the Phase D reconcile cannot detect, because it compares exactly those two values | Read the reconcile step against the mirror rule; both reachable in the plan's own release window |
| The lead's own post moves `_rev`, so a blanket pin guaranteed a 409 and a reload that discards the in-progress setlist — on the feature's primary action | `ProposalEditor.tsx:162-163` vs `:109-119` |

### Round 2

| Blocker | Evidence checked |
|---|---|
| The migration stores a **trimmed** body; §8 did not say so and step 9 prescribed a raw comparison. **Measured: 4 of the 8 documents carry trailing whitespace in `lead_notes`**, so the reconcile would have flagged half the migrated set as damaged — and its prescribed repair is an irreversible, visible top-up | Ran a read-only probe against `production`; confirmed all four |
| Acceptance criterion 5 claimed the email fires on *exactly* the occasions it fires today, contradicted by §1's own gap list — a pre-deploy client clearing the textarea stops queuing a notice that fires today. An existing signal retired, which parent invariant 8 does not permit silently | `serviceMutationSideEffects.ts:636` (queues on `"X" → ""`), `outboxClassify.ts:103` |

### Round 3

| Blocker | Evidence checked |
|---|---|
| §5's admin protocol rested on a false premise: that cards keyed by `_id` survive `load()`. **They do not** — `load()` sets `setLoading(true)` and the list renders only inside `{!loading && !error && (`, so every card unmounts and every per-card state resets. The `conflict` lock the section spent four paragraphs justifying would not have existed, and every posted message would have wiped an in-progress change-request note in any open card | `ProposalsPanel.tsx:389-390`, `:634`, `:104-110`; and the comment at `:108-109`, which says the 409 path deliberately does **not** call `load()` |

## Churn cap — the record the process requires

CLAUDE.md makes the cap binding after two rounds carrying verified substantive
blockers: continuing needs Frank's go-ahead **obtained in advance**. This loop ran
to six. Each continuation was authorised in chat before the round was dispatched —
*"consolida el hijo A"* after the consolidation was recommended, *"corre una ronda
sobre el hijo A consolidado"*, then *"sigue hasta que termines, me voy a dormir"*
covering the rest.

**None of it was written down at the time.** A reviewer of the parent asked for
this record and could not find it; that omission was the process failure, not the
continuations. The same standing instruction is recorded in
[the parent's log](2026-08-25-proposal-thread-roadmap-review-log.md).

## Process failures on the author's side

Recorded because a log containing only reviewer findings hides the half most worth
keeping.

1. **Every blocker in rounds 1–3 was a defect the author introduced**, and several
   were introduced *while fixing an earlier one*. Round 3's was a premise the author
   asserted about a component without reading its render structure — the same class
   as the predecessor's `notifyProposalReview` audience error.
2. **The author restated rules across sections again** after having consolidated
   the predecessor for exactly that reason. Rounds 1–2 produced six blockers on a
   790-line draft; consolidating to 648 lines with one normative statement per rule
   dropped the next round to two and the one after to one.
3. **A mutation test reported a false pass** during the Phase A fix work — a `perl`
   anchor silently failed to match, and the guard appeared to be un-triggered when
   it had simply never been mutated. Caught by checking that the mutation had
   landed, not by trusting the green.

## What implementing Phase A taught that no review round had

Phase A was implemented **before** the plan was approved, as a deliberate
standard-tier slice (a script that writes nothing by default). It found three
things four review rounds had missed:

- **An uncovered corner in the migration interlock.** A `messages[]` carrying one
  migration key but not the other is neither aborted by rule 1 nor skipped by rule
  2, and the whole-array `set` would have dropped a stored message. Now a third
  abort, `partial_migration`.
- **`last_transition.by` is a plain string, not a reference** — every migrated
  admin note would have carried a malformed author.
- **GROQ does not compact nulls**, so `messages[]._key` alone cannot detect a
  stored keyless item; the projection needs `count(messages)` beside it.

None came from reading the plan. All three came from writing the code and running
it against the real dataset.

## Non-blocking dispositions

**Adopted during the loop** (rounds 1–4): the admin route's `kind`; the create
branch needing no `setIfMissing`; three Verification-table citations pointing at the
wrong sections; the admin `conflict` lock's justification being narrower than
stated; the migrated lead `at` possibly being a different fact than when the note
was written; the rollback section overstating what `admin_notes` holds; "exempt from
the cap" having drifted into "always appends"; step 9's comparison basis.

**Declined, on evidence:** adding `messages` to `PROTECTED_FIELDS`. The list is
matched by a word-boundary regex and its own comment says it excludes ambiguous
names to keep the signal specific; it already omits `lead_notes`/`admin_notes`, so
the audit never depended on them. Two independent reviewers reached the same
conclusion.

## Post-approval changes — NOT covered by the approval

The approval covers digest `5713a9cc…` exactly. The following were adopted from the
two approving rounds' non-blocking sections **after** that digest and are therefore
**un-reviewed**:

- Criterion 7 reworded so it no longer contradicts §2's named `proposalNotify`
  input change.
- §1 gained the gap it had omitted — **a lead's message on an `approved` or `draft`
  proposal notifies nobody**, which is the dominant real case (13 of 14 production
  proposals are `approved`, zero are pending), and which means the Phase D
  walkthrough cannot exercise the mirror→email path at all.
- §5 names the admin-side read→commit residual and its approval consequence.
- Phase D's "do not exercise on `preview`" justification corrected — the
  stale-notice hazard is Child B's, not this child's — and the consequence stated:
  the only end-to-end human walkthrough happens after the production release.
- Phase B reframed: production moves routinely, so the check is that a difference is
  *explicable*, not absent.
- Phase D step 5 given a defined failure action: **STOP, do not proceed to step 6.**
- §6's two render rows made explicit that the thread renders **unconditionally** —
  read literally they would have inherited the old blocks' conditions and left the
  thread invisible on a `pending` proposal.
- §4's Guard column gained the server-side `isThreadOpen` check.
- Three Verification rows added: the thread renders at all; the standalone admin
  route leaves `admin_notes` alone; the `published` half of the lead guard.
- §3's `_key` line now names all three formats.
- The `load()`-on-transition residual named.
- Citation drift and a stale test count (34 → 30) corrected.

**A reviewer of the next phase should treat these as unreviewed text.** None
changes a rule that was approved; each either names something the approved text
omitted or corrects a citation.

## Standing rule

Plan approval is not authorization to implement. Phase D's `--apply` is a one-shot
irreversible write to the only production dataset and requires Frank's explicit
consent at the moment it runs, after a re-measure and a fresh dry-run diff.
