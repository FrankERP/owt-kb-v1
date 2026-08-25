# Implementation Plan: Proposal message thread (Release 2)

## Original request

> Release 2 of the setlist-proposal feature. The private lead↔admin channel becomes a **message thread** with persisted history, because today each new note overwrites the last. Settled: (1) a new `messages[]` array REPLACES `lead_notes` and `admin_notes`, migrating existing values in as the first message(s) with authorship and a best-available timestamp; (2) `team_notes` is untouched — separate single field, still copied onto the live setlist on approval, still rendered to the whole team; (3) participants are only the proposal's lead and `admin`/`super-admin` — design author/kind fields so "notas del pastor" can later be routed here, but do not build it; (4) no new emails, no new `notificationOutbox` kind — show an unread indicator instead.

**Amended 2026-08-24, after the open questions were answered.** OQ-1 was resolved *against* the derived indicator this plan originally recommended: read state must be tracked properly, by a `proposalReadMark` document type with its own guarded route. That is its own critical-contract delivery. **R2 therefore ships the thread with no unread indicator at all**, and the badge becomes R3. OQ-2 was resolved as recommended: migrated admin notes with no attributable author are minted with no `author` field and render as "Admin".

## Status and contract

- Document status: **Draft — not approved, not authorization to implement**
- Risk tier: **CRITICAL** (see [Risk tier](#risk-tier))
- Primary outcome: the private lead↔admin channel on a `setlistProposal` is an append-only, attributed, timestamped thread; no message is ever overwritten.
- Preconditions: `claude/proposal-filters-history-3a759b` branched from `main` at `9fd3b6c7`; production dataset measured 2026-08-24 (below).
- Safe ending state: every phase boundary is independently deployable; `lead_notes` / `admin_notes` survive as a frozen archive through the entire delivery and are unset only by a separate, later, separately-consented cleanup run.

---

## Evidence and current behavior

Every row below was read from the repository or from the production dataset on 2026-08-24.

| Evidence | Source | Planning implication |
|---|---|---|
| Three independent `type: "text"` note fields | `sanity/schemas/setlistProposal.ts:151-169` | `lead_notes` and `admin_notes` are the two being replaced; `team_notes` (`:157-163`) is out of scope. |
| The document is `readOnly: true` in Studio; every write goes through guarded API routes | `sanity/schemas/setlistProposal.ts:6-12` | A new field needs no Studio affordance; a new writer is a new trust boundary. |
| **`approvalInputFingerprint` does NOT include `lead_notes` or `admin_notes`.** `canonicalizeApprovalInput` fingerprints `{v, marker, serviceType, serviceDate, serviceRef, setlistTargetKey, songs[], teamNotes}` — `teamNotes` is the only free text | `app/utils/proposalWriteRequest.ts:208-223`, esp. `:221`; consumed at `app/api/admin/proposals/[id]/route.ts:170-179` | **The premise that this change moves the approval fingerprint is false.** Because `team_notes` is unchanged, `approval_receipt` is byte-for-byte unaffected. This is the single most important correction in this plan. |
| `transitionFingerprint` DOES include `adminNotes`, and shares `v: APPROVAL_RECEIPT_VERSION` / `marker: APPROVAL_APP_MARKER` with the approval receipt | `app/utils/proposalWriteRequest.ts:330-342` (`:338`), `:174-176` | The two digests are coupled through two constants. Bumping either to "version" the transition shape would invalidate **every stored `approval_receipt`**. |
| `decideApprovalReceipt` returns `unverified` when `receipt.marker !== APPROVAL_APP_MARKER` or `receipt.v !== APPROVAL_RECEIPT_VERSION` | `app/utils/proposalWriteRequest.ts:302-303` | An `unverified` receipt on an approved proposal is `409 legacy_approval_unverified` (`app/api/admin/proposals/[id]/route.ts:193-197`). Bumping the version would manufacture that on 5 production documents. |
| `decideTransitionRetry` requires `storedStatus === intent.toStatus` before it even looks at the fingerprint | `app/utils/proposalWriteRequest.ts:387` | A stored transition record can only short-circuit while the proposal is still in the status that record committed. |
| **Production, measured 2026-08-24, dataset `production`:** 14 `setlistProposal` docs, 0 drafts; 7 with non-empty `lead_notes`; 3 with non-empty `admin_notes`; 2 with both; 5 approved *with* a receipt; **7 approved *without* one (already `legacy_approval_unverified`)**; 1 doc carries `last_transition` (`action: "request_changes"`, `at: 2026-08-18T15:59:47Z`) but is now `approved`; **0 docs in `changes_requested`**; **0 `notificationOutbox` documents** | Read-only GROQ against `production` via `node --env-file=.env.local` | Migration touches **8 documents** and mints **10 messages**. No stored `last_transition` can currently match a replay (status is `approved`, the record's `toStatus` is `changes_requested`). The outbox was empty at the moment of measurement. |
| `queueLeadNotesNotice` snapshots `before: { beforeNotes }` PRE-COMMIT, gated on the status *before* the write | `app/utils/serviceMutationSideEffects.ts:612-660` (`:632`, `:636`, `:649`); called at `app/api/me/proposals/route.ts:311-317` with `beforeNotes` captured at `:207` | The queue-time snapshot is a single string. A thread has no such value. |
| At flush the sweep re-reads `lead_notes` and diffs it against `before.beforeNotes` | `app/utils/outboxSweep.ts:203-205` (`PROPOSAL_QUERY`), `:381-398`; pure rule at `app/utils/outboxClassify.ts:97-105` | Both the query and the classifier change. |
| **A claimed notice that classifies to zero pairs is CONSUMED (deleted), not retried:** `classifiedIds.add` happens before classification (`:766`), `partitionClaimed` consumes any classified notice with no pending recipients | `app/utils/outboxSweep.ts:733-751`, `:506-535`, `:877-884` | **Verified.** Returning `[]` from `classifyLeadNotesNotice` is a safe drop-and-consume — it does not crash, wedge, or re-pend forever. This is what makes legacy-shape compatibility cheap. |
| The "Nueva propuesta" admin email embeds `lead_notes` | `app/utils/proposalNotify.ts:138-153` (`:145`, `:153`); documented at `docs/NOTIFICATIONS.md:61` | Needs a replacement source. |
| `PROTECTED_FIELDS` lists `team_notes` but **not** `lead_notes` or `admin_notes` | `app/utils/protectedReadAudit.ts:40-53` | The audit does not currently depend on the two fields being replaced. Adding `messages` is a *strengthening*, not a repair. Say so honestly. |
| The `/me` page projects `admin_notes` (`:233`, `:268`, `:278`, `:285`) but **never renders it** — the card at `:382-423` uses only `status` and `hint` | `app/(client)/me/page.tsx` | This projection is dead weight today. Drop it rather than port it. |
| Admin transitions authorize on `doc._rev === request.rev`; a mismatch is `409 stale_revision` | `app/api/admin/proposals/[id]/route.ts:213-220`, `:448-455` | **The proposal's `_rev` is an authorization token.** Anything that bumps it on read (a "mark as read" write) would invalidate the reviewing admin's own revision. Decisive against storing read marks on the proposal. |
| An unrelated `teamMembers` write (the doc names `lastSeen`) can cause a conservative false conflict in the publish-ready transaction | `app/utils/publishReadyTransaction.ts:26-32`; field at `sanity/schemas/worshipTeam.ts:193` | Decisive against storing read marks on `teamMembers` either. |
| People are modeled as **references** on every protected document (`lead`, `contributors[].person`, `submitted_by`, `last_edited_by`); display names are denormalized only in *projections* | `sanity/schemas/setlistProposal.ts:42-88`; `app/api/admin/proposals/route.ts:35-37` | Settles reference-vs-snapshot for `author`. |
| `request_changes` / `reopen` revalidate **nothing** after commit | `app/api/admin/proposals/[id]/route.ts:529-538` | Pre-existing and correct: `/admin` fetches client-side and worship pages are dynamic (ADR-0020). Do **not** "fix" this here. |
| `nextKey()` = 12-char UUID slice | `app/utils/roleWriteOps.ts:64-66` | The `_key` generator for the new array (CLAUDE.md invariant: every array-of-object item needs a `_key`). |
| `PROPOSAL_NOTES_MAX = 4000` | `app/utils/proposalWriteRequest.ts:86` | Reuse as the per-message body cap. |
| `useTransientValue` returns `[value, show, reset, hold]`; already used in both target components | `app/utils/useTransientValue.ts:1-45`; `ProposalsPanel.tsx:4`, `ProposalEditor.tsx:126` | Toast mechanism is settled; never hand-roll a `setTimeout`. |
| A prior spec listed "per-song attribution / comment threads" as an explicit non-goal | `docs/superpowers/specs/2026-07-03-shared-setlist-proposals-design.md:83` | This delivery supersedes that non-goal. Add a forward pointer; do not rewrite the historical spec. |

---

## Scope

### In scope

- `messages[]` on `setlistProposal`, with `_key`, author reference, author-role snapshot, `kind`, `body`, `at`.
- Two thin append-only write routes (lead side, admin side).
- The admin transition (`request_changes` / `reopen`) appending its note as a message inside its existing guarded transaction.
- Outbox `leadNotes` snapshot + classification rewritten for a thread, with legacy-shape compatibility.
- `proposalNotify`'s "Nueva propuesta" body source.
- A `--apply`-guarded migration script populating `messages[]` from the two legacy fields.
- Thread UI in `ProposalsPanel` (admin) and `ProposalEditor` (lead), Spanish, existing tokens.
- Docs + two ADRs.

### Non-goals

- **`team_notes` in any form.** It stays a single field, stays fingerprinted in `approvalInputFingerprint` (`proposalWriteRequest.ts:221`), stays copied onto `featuredSongs`/`saturdarSongs`/`special_role` on approval (`app/api/admin/proposals/[id]/route.ts:283`, `:323`, `:330`), and stays rendered to the whole team (`app/components/DayCard.tsx:126-132`).
- **Pastor notes.** The `kind` enum reserves `pastor_note`; no code mints it in R2.
- **System/transition messages.** `kind` reserves `system`; no code mints it in R2.
- **Unsetting `lead_notes` / `admin_notes`.** Deferred to a separate consented cleanup.
- **A new `notificationOutbox` kind or any new email.**
- **Any unread indicator, derived or stored.** Resolved by OQ-1: read state gets a `proposalReadMark` document type in R3. R2 renders the thread with no badge. See §7.
- Repairing the `request_changes` revalidation gap.

### Preserved invariants

1. `APPROVAL_RECEIPT_VERSION` and `APPROVAL_APP_MARKER` (`proposalWriteRequest.ts:174-176`) are **not changed**. Not by one byte.
2. `canonicalizeApprovalInput`'s field set (`:208-223`) is **not changed**.
3. `transitionFingerprint`'s digest input (`:330-342`) is **not changed** — including the key name `adminNotes`.
4. The wire contracts of `POST /api/me/proposals` (songs/status/observed) and `PATCH /api/admin/proposals/[id]` (`{action, rev, adminNotes?}`) are unchanged in P0–P4.
5. Every Sanity array-of-object write carries a `_key` (CLAUDE.md).
6. `before` is captured PRE-COMMIT and threaded into `after()` (CLAUDE.md; `docs/NOTIFICATIONS.md`).
7. Client mutation handlers wrap `fetch` in try/catch/finally, check `res.ok`, reset the loading flag, never close-as-success on failure.
8. Colour never built by string concatenation.

---

## The hard parts, resolved

### 1. Schema shape

Add to `sanity/schemas/setlistProposal.ts`, after `team_notes` (`:163`):

```
messages: array of object `proposal_message`
  _key        string          nextKey() — CLAUDE.md invariant
  author      reference → teamMembers      (OPTIONAL — see below)
  author_role string          "lead" | "admin" | "pastor" | "system"
  kind        string          "lead_note" | "admin_change_request" | "pastor_note" | "system"
  body        text            ≤ PROPOSAL_NOTES_MAX (4000)
  at          datetime        ISO, server-minted (nowIso(), roleWriteOps.ts:68-70)
```

**Reference, not snapshot, for `author` — and a snapshot alongside it.** Every person on a protected document in this repo is a reference (`sanity/schemas/setlistProposal.ts:42-88`: `lead`, `contributors[].person`, `submitted_by`, `last_edited_by`); display names are denormalized only at projection time (`app/api/admin/proposals/route.ts:35-37`: `"lead_name": coalesce(lead->alias, lead->member_name)`). Following that convention keeps a renamed member's history correct and costs one join the panel already pays.

`author_role` is denormalized deliberately, and it is *not* a display-name snapshot — it is a fact **about the message at the moment it was posted**. If an admin later becomes a `member`, their historical change-request must not retroactively re-render as a lead note, and the ACL/rendering must not need a join to decide which side of the thread a message belongs on. Both fields, not one.

`kind` vs `author_role` are separate because they answer different questions: `author_role` is *who spoke*, `kind` is *what kind of speech act*. Reserving `pastor_note` and `system` now means routing "notas del pastor" here later is a write-path change with **no schema migration** — which is the whole point of the settled decision (3).

`author` is **optional** in the schema. Two of the three production `admin_notes` documents have no `last_transition.by` to attribute them to (measured: only 1 of 14 docs has `last_transition` at all). An unattributed migrated message is honest; a fabricated attribution is not. See [Open question OQ-2](#open-questions).

Studio `options.list` for `kind` and `author_role` includes all four values from day one. The document is `readOnly: true` (`:12`) so the list is cosmetic, but a later pastor-note delivery should not need to touch this file.

### 2. Approval fingerprints — what actually changes (nothing)

**`approvalInputFingerprint` is unaffected.** Read `canonicalizeApprovalInput` (`proposalWriteRequest.ts:208-223`): the fingerprinted set is `{v, marker, serviceType, serviceDate, serviceRef, setlistTargetKey, songs[], teamNotes}`. Neither `lead_notes` nor `admin_notes` appears. `team_notes` is the only free text, and this delivery does not touch it. The `approve` branch (`route.ts:170-179`) builds `ApprovalInput` from `doc.team_notes` and the song rows only.

Therefore: **`messages[]` is NOT added to `ApprovalInput`.** All 5 production documents with a valid `approval_receipt` continue to verify. All 7 without one continue to be `legacy_approval_unverified` — a pre-existing condition this delivery neither creates nor repairs.

**The real trap is the shared constants.** `transitionFingerprint` (`:330-342`) reuses `APPROVAL_RECEIPT_VERSION` and `APPROVAL_APP_MARKER` as its `v` and `marker`. The intuitive move — "the stored shape changed, bump the version" — would flow straight into `decideApprovalReceipt`'s two equality guards (`:302-303`) and turn 5 verified receipts into `unverified`, i.e. `409 legacy_approval_unverified` on the next retry of any of them. **Both constants are frozen.**

**So the transition contract does not change at all.** `adminNotes` stays the wire field (`parseProposalTransitionRequest`, `:156-169`), stays the digest key (`:338`), stays subject to `PROPOSAL_NOTES_MAX`. What changes is only *where the string is stored*: `route.ts:498-503` stops setting `admin_notes` and instead appends a `proposal_message` in the same patch.

**Idempotency is preserved by construction.** `decideTransitionRetry` (`:382-397`) matches on `(storedStatus, marker, v, action, toStatus, fingerprint)` — every input unchanged. A lost-response replay still returns `no_write_retry` at `route.ts:430-438`, **before** the transaction is assembled, so the replay appends **no duplicate message**. The append must live strictly inside the branch that call guards.

**Production exposure, measured:** 0 documents are in `changes_requested`, and the single document carrying a `last_transition` record is now `approved` while that record's `toStatus` is `changes_requested`. `decideTransitionRetry:387` therefore cannot match anything in production today. That is a point-in-time reading, not a licence — a proposal can enter `changes_requested` at any moment — which is exactly why the contract stays frozen rather than relying on the window being empty.

A regression test pinning both digests to hard-coded hex is the deliverable that makes this permanent (Phase 0).

### 3. The outbox `leadNotes` notice

**Queue time** (`serviceMutationSideEffects.ts:612-660`). `QueueLeadNotesNoticeInput` loses `beforeNotes`/`afterNotes` and gains `beforeMessageCount: number` — the pre-commit count of `messages` where `author_role === "lead"`, captured from the already-loaded proposal at `app/api/me/proposals/route.ts:207`'s position. The `previousStatus` gate (`:632`, `REVIEWABLE_BEFORE_WRITE`) is unchanged. The "did anything change" short-circuit at `:636` becomes `if (appendedCount === 0) return`.

`notificationOutbox.before` (`sanity/schemas/notificationOutbox.ts:77-112`) gains `beforeMessageCount: number`. `beforeNotes` (`:110`) **stays in the schema** — removing it would make in-flight legacy documents unreadable.

**Only lead-authored messages queue a notice.** The `leadNotes` audience is admins (`outboxSweep.ts:193`, `ADMIN_RECIPIENTS_QUERY`); mailing admins their own change-request is noise. This is preserved for free: `queueLeadNotesNotice` is called only from `/api/me/proposals` (`route.ts:311-317`), and the admin routes never call it.

**Flush time** (`outboxSweep.ts:381-398`). `PROPOSAL_QUERY` (`:203-205`) projects `messages[]` instead of `lead_notes`. `classifyLeadNotes` in `outboxClassify.ts:97-105` becomes:

```
classifyProposalMessages({ beforeCount, afterMessages, serviceDate, today, reviewable })
  isPast(serviceDate, today)                    -> null      (unchanged, :101)
  !reviewable                                   -> null      (unchanged, :102)
  leadMessages = afterMessages.filter(kind === "lead_note")
  appended = leadMessages.slice(beforeCount)
  appended.length === 0                         -> null
  -> { kind: "leadNotes", ..., notes: appended.map(m => m.body).join("\n\n") }
```

`LineKind` (`outboxClassify.ts:8-11`), `LINE_PREF.leadNotes = "proposals"` (`:19`), `NOTICE_KINDS` (`outboxNotice.ts:10`), and the stored `kind` value `"leadNotes"` are **all unchanged** — renaming the wire value would orphan every in-flight document and force a `notificationOutbox` schema-list change for no benefit. Only the *meaning* changes.

**In-flight legacy documents.** A notice minted by the old code carries `before.beforeNotes: string` and no `beforeMessageCount`. Rule:

> `beforeMessageCount` absent ⇒ **drop the notice** (`classifyLeadNotesNotice` returns `[]`).

Justification: after the migration the proposal has no `lead_notes` to diff against, so the legacy path would compute `after = ""`, see `before !== ""`, classify it as a change, and email admins an **empty** notes panel (`notificationEmail.ts:161-166` renders `line.notes` directly). Dropping is the only truthful outcome — the same reasoning `classifySetlist:81-83` already applies to a date move that invalidates its snapshot.

**Dropping is safe, and it was verified rather than assumed.** `outboxSweep.ts:766` adds the notice to `classifiedIds` *before* calling `classifyNotice`; a notice yielding no pairs gets no entry in `pending`; `partitionClaimed:520-523` then routes any classified notice with no pending recipients to `toConsume`, and the `finally` block at `:877-884` deletes it. The `if (!pairs.length) return report;` early return at `:751` happens before `pendingByNotice = pending` (`:753`), leaving it `null` — `partitionClaimed:520`'s optional chain handles that identically. **A legacy notice is dropped and consumed. It does not crash the sweep, wedge a claim, or re-pend forever.**

Exposure window: production had **0** `notificationOutbox` documents at measurement, so the only legacy-shape documents will be ones queued between the P3 deploy and the next sweep. Small — but the compatibility branch is still mandatory, because a lead can save at any second.

**`proposalNotify.ts:138-153`** — the "Nueva propuesta" admin email. Replace `lead_notes` with the body of the most recent `kind == "lead_note"` message, empty string when the thread has none. Because messages are strictly appended, array order **is** chronological, so the last matching element is the newest. Project the filtered array and take the last element **in JS**, not with a GROQ negative index — confidence in negative-index-on-filtered-array semantics is not high enough to encode it in the query, and the JS form is trivially testable. `docs/NOTIFICATIONS.md:61` updates in the same change.

### 4. Write path

**Two new thin routes, one shared pure module.**

| Route | Guard | Concurrency |
|---|---|---|
| `POST /api/me/proposals/[id]/messages` | `requireMinistryMember("worship")` **and** caller ∈ `service_ref->Lead[]._ref` (mirroring `canonicalLeadRefs(role)` at `app/api/me/proposals/route.ts:127` and the GROQ gate at `me/propose/[roleId]/page.tsx:28`) | `insert("after", "messages[-1]", [msg])`, **no `ifRevisionId`** |
| `POST /api/admin/proposals/[id]/messages` | `requireActiveManager()` **and** `role !== "content-editor"` (mirroring `app/api/admin/proposals/[id]/route.ts:85-92`) | same |

Shared module `app/utils/proposalMessageWrite.ts`: `parseProposalMessageRequest(body)` → `{ body: string }`, `buildProposalMessage({ authorId, authorRole, kind, body, now, key })` → the stored object. Pure, no client, no framework types — matching `proposalWriteRequest.ts`'s stated design (`:1-6`).

**Why not reuse `POST /api/me/proposals`.** That route is a whole-document save. It requires `observed` (id + rev), refuses on any mismatch (`route.ts:151-158`), asserts `ifRevisionId` on the proposal and the weekend lock in one transaction (`:228-242`, `:271-277`), and re-reads the fresh `_rev` for the client (`:320-328`). That model is *correct* for songs, which are a full-array `set` where a lost update is real data loss. It is *wrong* for an append: two people typing at once would 409 each other, and both messages should land. Overloading the route would also drag the message write into the weekend-lock coordination for no reason.

**Why the admin transition does NOT get its own route.** `request_changes` / `reopen` already own a guarded, revision-asserting transaction (`route.ts:490-514`). The change-request note is *part of the reviewed decision* — it must be atomic with the status change and must inherit the `ifRevisionId(request.rev)` precondition. So it appends inside that existing patch: `p.ifRevisionId(rev).set({status, reviewed_at, last_transition}).insert("after", "messages[-1]", [msg])`. Note that `ifRevisionId` is a property of the whole patch in the Sanity client, so the `insert` inherits the precondition — which is what we want here, and is deliberately *different* from the standalone chat route. That asymmetry is intentional and must be documented in the code, because it looks like an inconsistency.

**Concurrency, stated concretely.** Append is `insert(after, "messages[-1]", [...])` with no revision precondition. Sanity applies the insert server-side against the current document, so two concurrent posts both land; order is server-determined and both carry their own `at`. This is deliberately **not** read-modify-write: RMW would require a revision precondition (reintroducing the 409) or would silently drop the loser. `_key` is `nextKey()` (`roleWriteOps.ts:64-66`) — collision probability across a 12-hex-char space at a per-proposal scale of tens is negligible, and Sanity rejects a duplicate key at commit anyway.

**Limits.** Body ≤ `PROPOSAL_NOTES_MAX` (4000, `proposalWriteRequest.ts:86`), same `notes_length` issue code (`:117-119`, `:164`). Empty/whitespace-only body → `invalid_request`. Thread length capped at `PROPOSAL_MESSAGES_MAX = 200`, checked against the loaded document before the append. **This check is racy** — two concurrent posts at 199 both pass and land at 201 — and that is accepted: it is a runaway-growth sanity bound, not a security boundary. Say so in the code comment rather than implying it is enforced.

**Revalidation: none, deliberately.** `/admin` fetches proposals client-side (`ProposalsPanel.tsx:462-492`). `/me/propose/[roleId]` is dynamic because `requireWorshipPage` makes worship pages dynamic (ADR-0020). There is no ISR page caching a proposal thread, so calling `revalidateServiceViews()` here would be cargo cult. The same reasoning is why `request_changes`/`reopen` correctly revalidate nothing today (`route.ts:529-538`) — that is **not** a bug and must not be "fixed" in this delivery. The plan asserts this explicitly so a reviewer can challenge it on evidence rather than on the CLAUDE.md cache invariant read out of context.

**Response shape.** The route returns the appended message plus the full `messages[]` read back through `operationalClient`, so the client renders committed state. **No optimistic append** — a failed post that had already rendered would leave a phantom message in a channel whose entire value proposition is that nothing is lost.

### 5. Migration

`scripts/migrate-proposal-messages.mjs`, dry-run by default, `--apply` to write, run as `node --env-file=.env.local scripts/migrate-proposal-messages.mjs [--apply]` — the pattern of `scripts/migrate-shared-proposals.mjs:1-46`. The pure mapping lives in `scripts/lib/proposalMessages.mjs` so it is unit-testable.

**Expected document count — measured, not guessed.** Against dataset `production` on 2026-08-24: 14 `setlistProposal` documents, 0 drafts. 7 have non-empty `lead_notes`; 3 have non-empty `admin_notes`; 2 have both. ⇒ **8 documents patched, 10 messages minted.** These numbers must be **re-measured immediately before the `--apply` run** and the run aborted if they have drifted materially, since the dataset is live.

**Field mapping.**

| Source | `kind` | `author_role` | `author` | `at`, first available |
|---|---|---|---|---|
| `lead_notes` | `lead_note` | `lead` | `lead._ref` | `last_edited_at` → `submitted_at` → `_createdAt` |
| `admin_notes` | `admin_change_request` | `admin` | `last_transition.by` when present, else **absent** | `last_transition.at` → `reviewed_at` → `_updatedAt` |

Ordering within a document: sort the (at most two) minted messages by the resolved `at` ascending; tie-break lead-first. Measured: only 1 of 14 documents has `last_transition`, so 2 of the 3 admin messages resolve to `reviewed_at` and carry no author. See OQ-2.

**Idempotency.** Skip any document where `messages` is already a non-empty array. Additionally mint deterministic `_key`s `migleadnote01` / `migadminnote1` so that even a bypassed guard cannot duplicate — Sanity rejects the second insert on key collision. A second `--apply` run is a no-op and must print `0 patched`.

**Rollback.** `lead_notes` and `admin_notes` are **not unset**. They remain a byte-exact frozen archive of the source strings. Rollback is therefore: revert the code. The reverted code reads the untouched legacy fields and ignores `messages[]`, which is inert. There is no data-recovery step because no data is destroyed. Unsetting the two fields is a **separate script, separate consent, separate delivery**, gated on the thread having run in production through at least one full review cycle.

**Consent and dataset reality.** Per CLAUDE.md, production Sanity writes need explicit user consent, and **`preview` writes the REAL production dataset** — pushing `preview` rehearses the UI, never the data. There is exactly one dataset and one shot. The `--apply` run happens in Phase 7 only, with Frank's explicit go-ahead in chat, after the dry-run diff has been read line by line.

**Sequencing.** Migrate **before** the read/UI deploy (P5). Nothing reads `messages` until P5 ships, so a pre-deploy migration is invisible and safe. The reverse order would leave the 8 documents rendering an empty thread with their history apparently gone until the script ran — recoverable, but a bad thing for the team to see.

### 6. Reads to update

| Site | Change |
|---|---|
| `app/utils/serviceReadQueries.ts:33-43` (`PROPOSAL_PROJECTION`) | Add `messages[]{ _key, "author": author._ref, author_role, kind, body, at }`. Keep `lead_notes, team_notes, admin_notes` (`:40`) — frozen archive. |
| `app/api/admin/proposals/route.ts:20-49` | Add the messages projection with a resolved author name, following the `"lead_name": coalesce(lead->alias, lead->member_name)` precedent at `:35`. |
| `app/components/admin/ProposalsPanel.tsx:36-38, 220-233` | Type gains `messages`; the two static blocks at `:220-226` (`lead_notes`) and `:228-233` (`admin_notes`) are replaced by `<ProposalThread>`. `team_notes` at `:212-218` is untouched. |
| `app/(client)/me/propose/[roleId]/page.tsx:40-56` (`:43`) | Add messages to `getSharedProposal`'s projection, with resolved author names. |
| `app/(client)/me/propose/[roleId]/ProposalEditor.tsx:34-40, 121, 350, 446-450, 693-740` | Type gains `messages`; drop `leadNotes` state (`:121`) and the `leadNotes` key from the save body (`:350`); replace the "Notas privadas para revisión" textarea (`:709-731`) and the approved-state echo (`:734-739`) with `<ProposalThread>`; replace the `admin_notes` banner (`:446-450`) — the thread subsumes it. **`teamNotes` at `:122`, `:351`, `:693-708`, `:728-733` is untouched.** |
| `app/api/me/proposals/route.ts:56-62` (`:58`) | GET projection: `messages` in, `lead_notes`/`admin_notes` out. |
| `app/(client)/me/page.tsx:231-236, 267-287` | **Drop `admin_notes` from the projection and the two type literals.** It is projected and never rendered (the card at `:382-423` uses only `status` and `hint`). Nothing replaces it in R2; the R3 read-mark delivery is what will put a badge here. |
| `app/utils/interface.tsx:132-141` | `SetlistProposal` gains `messages?`. |
| `app/utils/protectedReadAudit.ts:40-53` | **Add `messages` to `PROTECTED_FIELDS` — but the honest framing is that this is optional.** `PROTECTED_FIELDS` today lists `team_notes` and **not** `lead_notes`/`admin_notes`, so the audit does not currently depend on the fields being replaced and nothing breaks if `messages` is omitted. It *should* be added because it satisfies the module's own stated criterion at `:34-38` (a field that exists only on the protected document, unambiguous against `post`/`teamMembers`), and adding it will cause `protectedReadAudit.test.ts` to flag any new query site that reads it through a non-operational client — which is exactly the point. |
| `e2e/service-readiness/lib/dataset.ts:390-403` | `StoredProposal` and `PROPOSAL_PROJECTION` gain `messages`. |

### 7. Read state — deferred to R3, with the design space already narrowed

**Decision (OQ-1, answered 2026-08-24): R2 ships no unread indicator.** The derived, storage-free indicator this plan originally recommended was rejected because it never clears by reading — only by acting — and in a two-person channel "read and deliberately not replied to" is a meaningful state it cannot represent. Rather than ship a badge that lies, R2 ships the thread alone and read state becomes **R3: a `proposalReadMark` document type, one document per (viewer, proposal), written by its own guarded route** — a new document type, a new writer and a new lifecycle, therefore its own critical-contract plan with its own adversarial review.

What R2 owes R3: nothing structural. `messages[].at` is server-minted and the array is strictly append-only, so a read mark is a timestamp comparison against data R2 already stores. No schema change in R2 anticipates it.

The two rejections below are recorded here because they are the binding constraints on that R3 plan, and because both look like obvious shortcuts to anyone who has not read this. They are the substance of ADR-0024.

**Two storage designs are ruled out on hard evidence, not preference.**

*Read marks on the proposal* (`messages[].readBy[]` or a document-level `readMarks[]`): every reader becomes a writer to `setlistProposal`, which bumps `_rev`. But `_rev` is the **authorization token** for admin transitions — `route.ts:213-220` and `:448-455` reject any action whose submitted `rev` no longer equals `doc._rev`. An admin opening a card to read it would invalidate their own reviewed revision, and every subsequent Approve / Solicitar cambios would 409 with `STALE_MESSAGE`. Two admins opening the same card would invalidate each other. This is disqualifying.

*Read marks on `teamMembers`*: avoids the proposal `_rev` problem, but bumps the **member** `_rev`, and `app/utils/publishReadyTransaction.ts:26-32` documents in so many words that an unrelated member write (it names `lastSeen`) causes conservative false conflicts in the publish-ready transaction. Making readiness publishes flakier to render a dot is a bad trade.

*A new `proposalReadMark` document type* is what survives — a document per (viewer, proposal), written by its own guarded route, keeping every write off both `setlistProposal` and `teamMembers`. That is the R3 delivery. It needs its own answers for lifecycle and cleanup (nothing currently owns deleting marks for proposals that are gone), which is exactly why it is not bolted onto this plan.

**Rejected for R2: a derived, storage-free indicator** of the form "count messages from the other party newer than the viewer's last *action* (`last_edited_at` / `submitted_at` for a lead, `reviewed_at` / `last_transition.at` for an admin)". It costs nothing and works across devices, but it never clears by reading, it is per-thread rather than per-message, and its activity floor is a proxy that goes stale for anyone who reviews without transitioning. Recorded here so a later reader knows it was considered and declined on the merits, not overlooked.

### 8. UI

New client component `app/components/ProposalThread.tsx`, shared by both surfaces:
`{ messages, viewerId, viewerRole, onPost, posting, error }`.

- **Layout:** chronological list, sender-aligned (viewer right, counterpart left), each bubble showing author name (or `Admin` when `author` is absent on a migrated message), a relative timestamp, and the body with `whitespace-pre-wrap`. A composer textarea + send button at the bottom.
- **Colour tokens, reusing what these two files already use:** lead messages `border-surface-accent-30` / `bg-accent/5` and `text-mono-300` (mirroring the team-message block at `ProposalsPanel.tsx:212-218`); admin messages `border-negative-strong/30` / `bg-negative-strong/10` and `text-negative-muted` (mirroring the admin-notes block at `ProposalEditor.tsx:446-450`). Timestamps `font-label text-[11px] uppercase tracking-widest text-mono-500`, matching the existing section labels. No inline colour; if one becomes necessary, `themeColour(rgbVar, alpha)` — **never** string concatenation (CLAUDE.md).
- **Toasts** via `useTransientValue` — `showToast(msg, false)` on failure, matching `ProposalEditor.tsx:126` and `ProposalsPanel.tsx:4`. Never a bare `setTimeout`.
- **Mutation handler** wraps `fetch` in try/catch/finally, checks `res.ok`, resets `posting` in `finally`, never clears the composer on failure (CLAUDE.md invariant; the existing failure modes at `ProposalsPanel.tsx:462-492` are the model).
- **Spanish copy:** section title `Conversación con los admins` (lead side) / `Conversación con el líder` (admin side); empty state `Aún no hay mensajes.`; placeholder `Escribe un mensaje…`; button `Enviar`; posting `Enviando…`; failure `Error al enviar el mensaje`. No unread badge in R2.
- **Admin side:** the `request_changes` composer (`ProposalsPanel.tsx:245-280`) stays exactly as it is — it is a *decision*, not a chat message, and it keeps its own `adminNotes` state and its `!adminNotes.trim()` disable. Its text simply also lands in the thread. The `reopen` composer (`:305-330`) behaves identically.
- **Read-only when approved:** the thread renders but the composer is hidden once `status === "approved"`, matching the existing `!isApproved` gating at `ProposalEditor.tsx:693`, `:709`.

---

## Ordered changes

Every phase ends with the same gate: **`npx tsc --noEmit`, `npm test`, `npx eslint .` with 0 errors.** Plus the per-phase check named below.

### Phase 0 — Pin the fingerprints (no behaviour change)

- **Purpose:** make it *impossible* for any later phase to silently move a digest that authorizes production idempotency.
- **Change:** in `app/utils/__tests__/proposalWriteRequest.test.ts`, add two tests asserting `approvalInputFingerprint(FIXED_INPUT)` and `transitionFingerprint(FIXED_INTENT)` equal hard-coded hex digests, plus assertions that `APPROVAL_RECEIPT_VERSION === 1` and `APPROVAL_APP_MARKER === "owt-kb-v1/a2-approval-1"`.
- **Failure/recovery:** none — test-only.
- **Verification:** gate. Then temporarily add a field to `canonicalizeApprovalInput` locally and confirm the test goes red; revert.
- **State after:** deployable, zero runtime change. Ships alone.

### Phase 1 — Schema + pure model

- `sanity/schemas/setlistProposal.ts`: `messages[]` (after `team_notes`, `:163`).
- `app/utils/proposalMessageWrite.ts`: `parseProposalMessageRequest`, `buildProposalMessage`, `PROPOSAL_MESSAGE_KINDS`, `PROPOSAL_AUTHOR_ROLES`, `PROPOSAL_MESSAGES_MAX`.
- `app/utils/proposalThread.ts`: `orderedMessages` — pure. (`unreadCount` is not built in R2; see §7.)
- `app/utils/interface.tsx:132-141`: `messages?`.
- Deploy the schema (`sanity:deploy-schema`).
- **Verification:** gate + new unit tests. Nothing reads or writes the field.
- **State after:** deployable; the field exists and is empty everywhere.

### Phase 2 — Write paths (additive, dual-write)

- `POST /api/me/proposals/[id]/messages` and `POST /api/admin/proposals/[id]/messages`.
- `app/api/admin/proposals/[id]/route.ts:490-514`: the `request_changes`/`reopen` branch appends a `proposal_message` **and still sets `admin_notes`** (dual-write).
- `POST /api/me/proposals` unchanged — still accepts and writes `leadNotes`.
- **Why dual-write:** without it, an admin's change-request between the P2 and P5 deploys would be stored but invisible in both UIs — an unsafe intermediate state the skill forbids. Dual-write makes P2 independently deployable and keeps the existing outbox path correct until P3.
- **Failure/recovery:** a failed append inside the transition transaction rolls the transition back (one transaction). A failed standalone post returns non-2xx and the client keeps the composer contents.
- **Verification:** gate + `app/api/__tests__/proposalMessageRoutes.test.ts` (auth 403s for non-lead and `content-editor`; `_key` present; two concurrent appends both land; length cap; empty body rejected; `no_write_retry` appends nothing).
- **State after:** deployable. Messages accumulate; nothing renders them; `admin_notes`/`lead_notes` still authoritative.

### Phase 3 — Outbox + "Nueva propuesta"

- `sanity/schemas/notificationOutbox.ts:77-112`: add `beforeMessageCount`; keep `beforeNotes`.
- `app/utils/serviceMutationSideEffects.ts:612-660`: new snapshot shape.
- `app/api/me/proposals/route.ts:202-207, 311-317`: capture the pre-commit lead-message count.
- `app/utils/outboxClassify.ts:97-105`: `classifyProposalMessages`.
- `app/utils/outboxSweep.ts:203-205, 381-398`: new projection; legacy-shape drop.
- `app/utils/proposalNotify.ts:138-153`: newest `lead_note` body.
- `app/utils/notificationEmail.ts:18`: `leadNotes` subject copy → `"Mensajes de la propuesta"` (optional; if changed, `emailTemplateGallery.test.ts:129` and `notificationEmail.test.ts:159` move with it).
- **Verification:** gate + a sweep test asserting a legacy `{beforeNotes}` notice is **dropped and consumed**, not thrown, not re-pended.
- **State after:** deployable.

### Phase 4 — Migration script (written, not run)

- `scripts/migrate-proposal-messages.mjs` + `scripts/lib/proposalMessages.mjs`.
- Run **dry-run only** and paste the diff into the plan's review log.
- **Verification:** gate + `scripts/__tests__/migrateProposalMessages.test.ts` (mapping, timestamp fallback chain, ordering, idempotent skip). Dry-run output must report exactly the measured counts.
- **State after:** deployable; no production write has occurred.

### Phase 5 — Reads and UI (single-read cutover)

- All read sites from §6.
- `app/components/ProposalThread.tsx`.
- `ProposalsPanel.tsx` + `ProposalEditor.tsx` integration; `leadNotes` leaves `parseProposalSaveRequest` (`proposalWriteRequest.ts:105-131`) and the editor save body (`ProposalEditor.tsx:350`).
- Drop the `admin_notes` dual-write from the admin transition.
- **Verification:** gate + updated `proposalWriteRequest.test.ts`, `proposalWriteRoutes.test.ts`; manual walkthrough on `preview`.
- **State after:** deployable **only after the Phase 7 migration `--apply`** — otherwise 8 documents show an empty thread. This ordering constraint is binding.

### Phase 6 — Docs + ADRs + e2e

- `docs/DATA_MODEL.md:166-200` (the field table at `:184`/`:186`); `docs/API_REFERENCE.md:233`, `:327-328`, `:351` (state explicitly that the transition-fingerprint field list is unchanged) + new rows for the two message routes; `docs/UTILITIES_AND_COMPONENTS.md:287` + a `ProposalThread` row; `docs/NOTIFICATIONS.md:61`; a forward pointer added to `docs/superpowers/specs/2026-07-03-shared-setlist-proposals-design.md:83`.
- **ADRs — yes, two.** Both meet the `docs/adr/README.md` bar ("code that looks like a bug but isn't"; "something deliberately not done"):
  - `docs/adr/0023-proposal-thread-keeps-the-approval-marker.md` — why `APPROVAL_RECEIPT_VERSION` / `APPROVAL_APP_MARKER` were deliberately **not** bumped despite the stored transition shape changing. Without this, a future reader bumps them "for correctness" and manufactures `legacy_approval_unverified` on live approvals. Link it from `proposalWriteRequest.ts:173-176`.
  - `docs/adr/0024-proposal-read-state-is-not-stored-on-the-proposal.md` — why read state is deferred to R3 and, when it lands, must not live on `setlistProposal` or on `teamMembers`, citing the proposal-`_rev`-as-auth-token and `publishReadyTransaction.ts:26-32` arguments. Without this, "just add a readBy array" is an obvious-looking improvement that breaks admin review.
- e2e: `e2e/service-readiness/proposal-lifecycle.spec.ts:104` (`admin_notes` contains "apertura" → assert the appended message), `zero-delivery.spec.ts:64` (fixture; wire contract unchanged, so likely unaffected — verify), `lib/dataset.ts:390-403`, `scripts/lib/sr-verification.mjs:938`.
- **Verification:** gate + the e2e suites.

### Phase 7 — Release

1. Re-measure the dataset. Abort if counts drifted.
2. Migration dry-run; read the diff.
3. **Obtain Frank's explicit consent in chat**, then `--apply`.
4. Re-read the 8 documents and confirm 10 messages with correct `_key`, `kind`, `author_role`, `at`.
5. Merge to `main` locally, gates green, **fresh code review of the merge range**, fix, **re-verify the fix**, then merge.
6. Merge `main` → `preview`, push `preview`, **verify `dev-owt-backstage.vercel.app` is in the deployment's `alias` array and `meta.githubCommitSha` equals the pushed commit.**
7. Only then push `main`.

---

## Data and failure safety

- **Source of truth:** `messages[]` after Phase 5; `lead_notes`/`admin_notes` remain as a frozen, read-nowhere archive.
- **Concurrency:** standalone posts are unconditioned array inserts — concurrent posts both land. The transition's message inherits `ifRevisionId(request.rev)` because it is part of a reviewed decision. Idempotency of `request_changes`/`reopen` is unchanged (`decideTransitionRetry:382-397`); the append is inside the branch that call guards, so a replay appends nothing.
- **Partial failure:** the transition's `set` + `insert` are one patch in one transaction — atomic. A standalone post is one patch — atomic. The outbox path is unchanged in its discharge semantics.
- **Data preservation:** nothing is deleted or unset in this delivery.
- **Rollback:** revert the code; the legacy fields are intact and authoritative again; `messages[]` becomes inert.

---

## Verification

| Requirement | Test or check | Failure it detects |
|---|---|---|
| Approval receipts survive | `proposalWriteRequest.test.ts` — hard-coded `approvalInputFingerprint` digest | Any change to `canonicalizeApprovalInput` or the two constants |
| Transition retries survive | `proposalWriteRequest.test.ts` — hard-coded `transitionFingerprint` digest | Any change to the transition digest input |
| Replay appends no duplicate | `proposalWriteRoutes.test.ts` — replay a committed `request_changes`, assert `messages.length` unchanged | The append escaping the `no_write_retry` guard |
| Concurrent posts both land | `proposalMessageRoutes.test.ts` | A revision precondition creeping into the append |
| Legacy outbox notice is dropped and consumed | `outboxSweep.test.ts` — a `{beforeNotes}` notice with no `beforeMessageCount` | An empty-body email to admins; a wedged claim |
| Only lead messages queue a notice | `setlistNoticeQueueing.test.ts` | Admins mailed their own change-request |
| `team_notes` untouched | existing `proposalWriteRoutes.test.ts` approval assertions | Accidental folding of team notes into the thread |
| Migration is idempotent | `migrateProposalMessages.test.ts` + a second `--apply` reporting `0 patched` | Duplicate messages |
| Non-lead / content-editor blocked | `proposalMessageRoutes.test.ts` | An ACL hole on a new writer |
| Protected-read audit | `protectedReadAudit.test.ts` | A new `messages` read through a non-operational client |

**Suites that will break and must be updated:** `app/utils/__tests__/proposalWriteRequest.test.ts` (`:52`, `:66`, `:77`), `.../outboxSweep.test.ts` (`:1128-1165`), `.../outboxClassify.test.ts` (`:120`, `:145`), `.../serviceMutationSideEffects.test.ts` (`:649-688`), `.../proposalNotify.test.ts` (`:172`), `.../protectedReadAudit.test.ts`, `app/api/__tests__/proposalWriteRoutes.test.ts` (`:315`, `:335`, `:442`, `:543`, `:703`, `:929-1056`), `app/api/__tests__/setlistNoticeQueueing.test.ts` (`:375-402`, `:657-751`), and — if the email copy changes — `.../emailTemplateGallery.test.ts:129` and `.../notificationEmail.test.ts:159`. E2E: `e2e/service-readiness/proposal-lifecycle.spec.ts:104`, `zero-delivery.spec.ts:64`, `lib/dataset.ts:390-403`.

---

## Risk tier

**CRITICAL.** Per CLAUDE.md this change is a schema/data migration, a production mutation trust boundary (two new writers), and a concurrency-protocol change on an existing guarded writer — three of the enumerated critical triggers. It therefore requires **two sequential fresh `APPROVED` verdicts on byte-identical plan text**, reviewers run one at a time, prior findings never exposed, before implementation begins. The churn cap is binding: after two rounds with verified substantive blockers, stop; a third round needs Frank's explicit go-ahead obtained in advance. A committed review log at `docs/superpowers/plans/2026-08-24-proposal-message-thread-review-log.md` is part of the delivery. **Plan approval is not authorization to implement**, and each implementation phase still gets its own gates plus the cycle-closing fresh code review of the diff.

---

## Open questions

| # | Question | Why it matters | Recommendation | Blocking? |
|---|---|---|---|---|
| OQ-1 | ~~Does the unread indicator's "never clears by reading" limitation need fixing in R2?~~ | — | **RESOLVED 2026-08-24: yes.** Derived-unread is dropped from R2 entirely; `proposalReadMark` is promoted to its own R3 critical plan. R2 ships the thread with no badge. | Closed |
| OQ-2 | ~~For the 2 migrated `admin_notes` with no `last_transition.by`, mint with no `author`, or attribute to a fallback admin?~~ | Fabricated attribution in an audit-adjacent history is worse than an absent one. | **RESOLVED 2026-08-24 as recommended:** absent `author`, `author_role: "admin"`, rendered as "Admin". Requires `author` optional in the schema. | Closed |
| OQ-3 | Should the standalone admin chat route also assert `ifRevisionId`? | Two different concurrency models on one array looks like an inconsistency. | No — chat is append-only and must not 409; the transition's message inherits the precondition because it is a decision. Document the asymmetry in code. | No |
| OQ-4 | One ADR or two? | Reviewer preference. | Two — the constants decision and the read-state decision have different audiences and different "don't fix this" triggers. | No |
| OQ-5 | Does the `leadNotes` email subject copy change? | Cosmetic; touches two more test files. | Yes, `"Mensajes de la propuesta"`. Cheap, and "Notas del líder" becomes wrong once the thread carries admin replies. | No |

---

## Handoff

- **Prerequisites supplied to later plans:** the `kind`/`author_role` enums reserve `pastor_note` and `system`, so a pastor-note delivery is a write-path change with no migration.
- **Outputs promised:** a populated `messages[]` on all 14 production proposals; `lead_notes`/`admin_notes` intact for a later cleanup delivery.
- **Handed to R3:** read state (`proposalReadMark`), which R2 deliberately does not build. R2 leaves it nothing to undo — `messages[].at` is server-minted and the array is append-only, so a read mark is a timestamp comparison against data R2 already stores.
- **Adversarial review order:** this plan is a single artifact — two sequential fresh reviews on byte-identical text.
- **Implementation authorization: not granted by this plan.**

## Terminal state

`READY_FOR_ADVERSARIAL_REVIEW`
