# Review log — Parent roadmap: proposal message thread

Artifact: [`2026-08-25-proposal-thread-roadmap.md`](2026-08-25-proposal-thread-roadmap.md)

## Outcome

**APPROVED** — two sequential fresh `APPROVED` verdicts on byte-identical text,
digest `a489d135db7ddceb1b55f89badebee1afacbfc09511865f65a70a40efc4a63dc`.

The file has since gained un-reviewed non-blocking edits, listed at the bottom.

**Approval is not authorization to implement.**

## Risk tier

**CRITICAL**, inherited from what it governs: a one-shot data migration against the
single production dataset, two new production writers, and a change to an existing
production delivery path.

## Rounds

| # | Digest | Verdict | Blockers |
|---|---|---|---|
| 1 | `6a5a4a65…` | `CHANGES_REQUIRED` | 2 |
| 2 | `71cbc7ed…` | `CHANGES_REQUIRED` | 3 |
| 3 | `f8bdd64f…` | `CHANGES_REQUIRED` | 2 |
| 4 | `e2b27e1c…` | `CHANGES_REQUIRED` | 1 |
| 5 | `3905c1c0…` | `CHANGES_REQUIRED` | 1 |
| 6 | `a489d135…` | **`APPROVED`** | 0 |
| 7 | `a489d135…` | **`APPROVED`** | 0 |

Blockers per round: **2 → 3 → 2 → 1 → 1 → 0 → 0.**

## Churn cap — the record the process requires

CLAUDE.md makes the cap binding after two rounds carrying verified substantive
blockers: continuing needs Frank's go-ahead, **obtained in advance**. This loop ran
to seven. Every continuation past the cap was authorised in chat before the round
was dispatched:

| After round | What Frank was told | What he said |
|---|---|---|
| 2 | Two substantive rounds; the defect class was cross-section contradiction; consolidating was the recommended remedy | *"consolida el hijo A"* (for the child); for the parent, *"revisa el padre y A"* |
| 3 | Blockers found; the parent contradicted the child it governs | *"sigue hasta que termines, me voy a dormir"* |
| 4–7 | — | covered by the same standing instruction |

**This was not recorded at the time.** A reviewer in round 7 asked for it and could
not find it; that gap was the process failure, not the continuations themselves.
The same standing instruction covers Child A's rounds 4–6 and is recorded in its
log too.

## Blockers, with the evidence actually checked

### Round 1

| Blocker | Evidence |
|---|---|
| The split's central claim — "Child A changes no notification behaviour" — was **false**. `lead_notes` has a **second** consumer: `proposalNotify.ts:145` puts it in the "Nueva propuesta" submit email. Deleting the private-notes textarea in Child A would have emptied that email **and left the lead with no way to say anything on a first submission at all**, since the thread composer needs a document that does not exist yet | Read `proposalNotify.ts:145,153` and traced `ProposalEditor.tsx:714-720` → `:350` → `route.ts:232` |
| The `lead_notes` blanking hazard is created by Child A's client change but its only guard was scheduled in Child B — a release after the archive Child A's own rollback depends on could be erased | `proposalWriteRequest.ts:117`, `me/proposals/route.ts:232`, `:264` |

### Round 2

| Blocker | Evidence |
|---|---|
| The blanking guard was moved into A and **its twin was left behind** — a client loaded before the deploy still sends `leadNotes`, and A would have discarded it behind a success toast | `ProposalEditor.tsx:711-725`, `:350` |
| "The submit email is byte-identical" is false: `notifyProposalSubmitted` fires on **every** save committed `pending`, not only the first | `me/proposals/route.ts:298-304`, `:160-167` |
| OQ-2 asked Frank to authorise a second CRITICAL delivery on a **false premise** — that `lead_notes` would go stale after A, when the mirror is exactly what keeps it current | Read Child A's mirror rule against the OQ text |

### Round 3

| Blocker | Evidence |
|---|---|
| Invariant 7 said Child A preserves the `admin_notes` blanking exception "verbatim". **It does not.** Today the composer is seeded from the stored value (`ProposalsPanel.tsx:106`) and a note-less `reopen` re-sends it, preserving the field; Child A seeds it empty, so the same reopen blanks a live value. A **new** trigger, reachable on 4 published proposals | Read `:106`, `:143`, `proposalWriteRequest.ts:165`, `admin/proposals/[id]/route.ts:500` |
| The guard for it **passed by construction** — it read "the mirror's writes are the only changes", and Child A defines the transition *as* the `admin_notes` mirror | Read the acceptance bullet against §1 |

### Round 4

| Blocker | Evidence |
|---|---|
| The parent assigned removal of the submission textarea to Child B. **Child B disclaims it** ("No UI beyond notification-adjacent copy"), the parent's own coverage table needs it to survive, and removing it would reintroduce the round-1 regression — the reason it exists is **permanent**, not Child-A-specific | Read Child B's scope and body-source rule against the parent's claim |

### Round 5

| Blocker | Evidence |
|---|---|
| The coverage table said Child B "adds none" of the `messages` projections. **Backwards on the one that matters:** `outboxSweep`'s `PROPOSAL_QUERY` projects `_id, status, lead_notes, service_date` and Child B adds `messages[]` to it — which Child A **cannot**, since its criterion 7 forbids touching `app/utils/outbox*`. Believed literally, `classifyProposalMessages` gets `undefined` and the debounced email silently stops | Read `outboxSweep.ts:203-205` and Child B's Scope-In |

## Process failures on the author's side

1. **Every blocker was a defect the author introduced**, and rounds 2, 3 and 5 were
   introduced *while fixing an earlier one*. Round 2's was the twin of round 1's own
   fix; round 3's was a claim about a child made without re-reading it.
2. **The churn cap was passed five times without the record the rule requires.**
   The go-aheads existed in chat; none was written down until round 7's reviewer
   asked. Recorded above.
3. **The parent contradicted an already-approved child** (round 3) on a data-safety
   invariant it declares — the worst direction for a parent to be wrong in.

## Non-blocking dispositions

Adopted during the loop: the stale `changes_requested` count; a missing Status
table; the unowned schema-deploy row; "no new emails" restated in the parent's
non-goals so both children inherit it; the `sweepOutbox` and `notifyProposalPending`
citations; the push row narrowed to `approved`; the Phase A commit citation.

**Refuted, with evidence:** the missing ministry check on Child A's new admin
message route. Round 7 verified the sibling transition writer has the same gap
(`admin/proposals/[id]/route.ts:85-92`), so the new writer's blast radius is
strictly smaller than the one beside it, and ministry scoping is settled as an
independent delivery (`FrankERP/owt-kb-v1#8`).

## Post-approval changes — NOT covered by the approval

Adopted from the two approving rounds' non-blocking sections, **after** digest
`a489d135…`:

- ~~The A→B seam is now **decided** (accept it; Child B drop-and-consumes) rather
  than left as an either/or in an acceptance list.~~ **SUPERSEDED 2026-08-26** — see
  the section below.
- `report.lost` got a checkpoint in Integration acceptance. It had been asserted in
  parent prose while Child A — already approved — has no step for it, making it an
  instruction with nowhere to happen.
- The load-bearing "non-empty body" justification moved onto the `admin_notes`
  bullet, where it does the work; on `lead_notes` the looser phrasing was already
  safe.
- The cross-cutting arithmetic now matches the table (four Dependent entries, two
  cross-cutting rows).
- `notifyProposalPending`'s citation widened to its real span.

## Standing rule

Plan approval is not authorization to implement. Each child's phases need their own
fresh code review of the diff plus the gates, and Child A's Phase D `--apply` is a
one-shot irreversible write to the only production dataset requiring Frank's
explicit consent at the moment it runs.

## Corrections made during Child B's review (2026-08-26) — NOT covered by the approval

Child B's review found four statements in this approved parent that were wrong, and
they were corrected in the same delivery rather than left contradicting the child. All
four are **un-reviewed text** by the same standard as the section above.

### 1. Both in-flight-notice seam bullets

The parent described the release window as "minutes before B's deploy" and decided
**accept the seam; Child B drop-and-consumes**. The premise is false. CLAUDE.md's
mandated release runs `preview` on the new code and production on the old **against one
shared Sanity dataset** for as long as the PR takes, and a write that commits an outbox
upsert sweeps inline over a `DUE_NOTICES_QUERY` with no environment scoping. The window
is hours, and it is entered by the walkthrough the plan itself schedules.

Dropping is also **unobservable** — a notice classified to `[]` contributes no pending
recipients, so `countLost` reports nothing. Child B therefore classifies legacy notices
instead of dropping them, **against the thread rather than the frozen `lead_notes`**
(classifying against the field would swallow every message appended onto a pre-cutover
notice, since `before` is `createIfNotExists`-only on a deterministic id).

The two directions are **not** symmetric, and an intermediate correction wrongly said
they were:

| Direction | Closed by | Residual |
|---|---|---|
| OLD route queues → NEW sweep flushes | **Mechanism** — classify against the thread | none |
| NEW route queues → OLD sweep flushes | **Procedure only** — release step 3 | the message is **silent**: no stale text, but no email and `report.lost` at 0 |

The unconditional "with no exception … nothing is lost in either direction" is gone.
The parent now claims only the first row, and names the second's residual.

### 2. "None is notified twice"

The same Integration bullet asserted it unqualified. Child B criterion 4 names two
exceptions, **both introduced by B and both in steady state** — not window effects:

- A status round-trip inside one debounce window. M1 on `pending` queues a notice
  holding `beforeMessageCount = N`; approve; M2 on `approved` **pushes**; reopen; the
  flush now finds a reviewable status and emails `slice(N) = [M1, M2]`. M2 gets both.
  The push is B's, so this pairing does not exist today.
- The send-budget re-pend. A new message clears `servedRecipients` while
  `before.beforeMessageCount` is preserved, so an already-served admin receives the
  joined body again including a message they had. Today they would receive only the
  newest note; the join is B's.

The bullet now names them and points at criterion 4 rather than criterion 6.

### 3. The coverage table's export row

It assigned `REVIEWABLE_BEFORE_WRITE` to Child B. B's resolved push gate is
`status === "approved"`, which retired that export's only proposed consumer, so B
declines it and exports `ADMIN_RECIPIENTS_QUERY`, `PROPOSAL_QUERY` and `fireAndForget`
instead. The table also called the classifier's parameter `afterMessages`; it is
`leadMessages`, and the name carries the "do not re-filter" rule.

### 4. Why this is recorded here rather than only in the child

CLAUDE.md's rule is that a child may not silently outperform **or undershoot** an
invariant its parent declares. Child B does both — better than the parent on the
mechanism direction, worse on the procedure one — so the parent had to move. A reviewer
of Child B was pointed at this log for the record and found the superseded decision
still standing; that gap is what this section closes.
