# Implementation Plan: Proposal message thread (R2)

**Every rule in this document is stated once, in one place.** An earlier revision
stated several of them in three places, and three of its blockers were
corrections that reached one copy and not its twins. The narrative of what
earlier drafts got wrong now lives in
[the review log](2026-08-24-proposal-message-thread-review-log.md); this file is
normative only.

## Status

| | |
|---|---|
| Phases 0–1 | **Shipped to production**, schema deployed. Out of scope here. |
| Phases 2–6 | **Not approved, not authorized.** Risk tier CRITICAL. |
| Approval required | Two sequential fresh `APPROVED` verdicts on byte-identical text |
| Review history | 3 rounds on the pre-consolidation shape, all `CHANGES_REQUIRED`, 11 blockers, all fixed. See the review log. |

**Approval is not authorization to implement.** Each implemented phase
additionally requires a fresh code review of its diff plus the documented gates.

## The requirement

> "También pensé que sería bueno poder ver el historial o 'conversación' de las
> notas de cada propuesta. Quizá podríamos cambiar nuestro modelo de notas a un
> pequeño 'chat' dentro de la propuesta en el que quede guardado un historial de
> mensajes."

Settled with Frank, each asked and answered explicitly:

1. **Replace, not add.** The private lead↔admin channel becomes the thread.
   `team_notes` — the note for the whole team — stays a separate field.
2. **Participants:** the proposal's lead plus `admin`/`super-admin`. **No new emails.**
3. **Read state:** real read marks, not a derived indicator. Deferred to R3, so
   this release ships **no unread indicator at all**.
4. **Admin→lead signal:** a push. A push is not an email, so (2) stands.
5. **The composer closes when the SERVICE has passed**, not when the proposal is
   approved. The conversation stays open while the set has not yet happened.

---

## Contracts of what this plan reuses

Extracted from the code by an independent read-only pass on 2026-08-25, and
verified by a later reviewer. **These are claims to check, not reassurance** —
the rest of the plan is built on them. Three earlier blockers came from reaching
for a helper by name without checking what it does.

### Not exported today — a phase that imports these will not compile

| Symbol | Module | Disposition |
|---|---|---|
| `REVIEWABLE_BEFORE_WRITE` | `serviceMutationSideEffects.ts:612` | **Export.** The lead messages route needs it to choose push-vs-email |
| `REVIEWABLE_STATUSES` | `outboxSweep.ts:218` | Identical set, second copy, no sync guard. **Do not collapse into the side-effects module** — it already imports `sweepOutbox` (`:71`), so that direction closes an import cycle. Put the shared set in a leaf, or export from `outboxSweep`. They are semantically different predicates (status *before the write* vs status *at flush*) that coincide today |
| `ADMIN_RECIPIENTS_QUERY` | `outboxSweep.ts:193` | **Export.** §6 adds a third consumer; it is currently duplicated verbatim at `proposalNotify.ts:143` with nothing enforcing the match |
| `PROPOSAL_QUERY`, `classifyLeadNotesNotice`, `classifyNotice` | `outboxSweep.ts:203,381,400` | Modified in place; no export needed |
| `attempt`, `attemptSync`, `fireAndForget` | `serviceMutationSideEffects.ts:77,93,106` | New side-effect code lives in that module, or wraps its own |

### Behaviour the name does not tell you

| Helper | Contract | The trap |
|---|---|---|
| `notifyProposalReview(doc, push)` | `serviceMutationSideEffects.ts:740`. Push only. Audience `proposalReviewRecipients` = `doc.lead` + `contributors[].person`. `path` fixed `/me` | **Admins are NOT in the audience.** Never use it for anything admin-facing |
| `notifyProposalPending` | `:712` → `notifyProposalSubmitted`. Caller guards on the status this save *committed* | Fires on **every** save committing `pending`, not only `draft → pending` |
| `notifyProposalSubmitted` | `proposalNotify.ts:111`. Three signals: push→admins (inline GROQ `:143`), push→co-leads, email→same admins filtered by `isEmailAllowed` + `wantsNotification` | Sends **nothing at all** if the ROLE fails canonical resolution (`:133-135`) |
| `sendPush(ids, category, payload)` | `push.ts:32`. Returns `{sent, pruned}`, never throws. **Also a writer** — prunes dead tokens | Gated by `optedIn(notifPrefs, category)` (`:22`) reading `notifPrefs.proposals` — **not** `wantsNotification`, which reads `emailProposals`. Independent axes |
| `wantsNotification` | `notifyPrefs.ts:25`. Absent prefs → `true` | **Email only.** CLAUDE.md's "the ONLY per-type resolver" is email-scoped |
| `queueLeadNotesNotice` | `:629`. Synchronous, `void`, registers an `after()`. No-ops on `!proposalId`, status outside `REVIEWABLE_BEFORE_WRITE`, or trimmed-equal notes | Queues `knownRecipients: []`; **the admin audience resolves at FLUSH**, 15–60 min later |
| `commitUpserts` | `:481`. One transaction, no revision precondition | **Then runs `sweepOutbox` unconditionally.** Queuing a notice can send another member's email inline, on the poster's request |
| `sweepOutbox` | `outboxSweep.ts:559` | **Stage 8 consumes claimed notices unconditionally** — a failed send still deletes. `emailed` counts sends, `consumed` counts deletions; only `report.lost` reveals the gap |
| `classifyLeadNotes` | `outboxClassify.ts:97`. Pure, `null` on past / not-reviewable / equal | Takes `reviewable` as a **boolean the caller computed** |
| `classifyLeadNotesNotice` | `outboxSweep.ts:381`. Re-reads live | **The live `service_date` wins over the queued snapshot** — a date moved into the past drops the notice |
| `buildUpsert` | `outboxNotice.ts:119`. Pure, commits nothing. `before` only in `createIfNotExists` | That `createIfNotExists`-only `before` is what makes the count-and-slice survive a debounce burst |
| `outboxId` | `outboxNotice.ts:29` | `NoticeKind` is a closed union `"role"｜"setlist"｜"leadNotes"` — hence keeping `"leadNotes"` |
| `loadCanonicalProposal(id, tolerate?)` | `serviceWriteTargets.ts:392`. Sentinel, never throws. Fails closed on 0 rows, >1, raw draft overlay, missing `service_ref`, unresolvable role | **It loads the ROLE too**, and fails a valid proposal whose role is ambiguous. It does **not** do duplicate-per-service detection — that is `loadProposalGroup`. A third selection exists: `getSharedProposal` (`me/propose/[roleId]/page.tsx:41`) picks `order(_createdAt asc)[0]`, and that is the id the composer posts to |
| `canonicalLeadRefs(role)` | `serviceReadSelect.ts:138` | **Only the `Lead` seat**, and meaningful only after `validateRole` |
| `requireMinistryMember(id)` | `authGuards.ts:34`. `super-admin` bypasses | **Membership only.** A worship `admin` who is not a worship member gets `null` |
| `requireActiveManager()` | `authGuards.ts:22` | **`content-editor` passes**, and there is **no ministry check** |
| `withVerificationRunContext` | `srVerificationRunContext.ts:170`. Transparent | **Not a guard.** Omitting it costs only run markers |
| `parseProposalSaveRequest` | `proposalWriteRequest.ts:107`. Sentinel, never throws | **Ignores unknown keys**, and coerces an absent `leadNotes` to `""` (`:116`) |
| `compareObservedTarget` | `setlistWriteRequest.ts:117` | **`null` means SUCCESS** |
| `PROPOSAL_PROJECTION` | `serviceReadQueries.ts:33` | Does **not** project `submitted_by`, `submitted_at`, `reviewed_at`, `last_edited_by/at` — four of which the migration's fallback chain reads. The migration issues its own query; a runtime read must add them |
| `operationalClient` | `sanity/lib/operationalClient.ts:16` | `published` perspective — **drafts are invisible by construction** |
| `OPERATOR_TOOLING_ALLOWLIST` / `PROTECTED_RUNTIME_WRITERS` / `RETIRED_ONE_SHOT_WRITERS` | `protectedReadAudit.ts:346` / `:177` / `:293` | The first satisfies reads *and* writes; the second **only** writes; the third is terminal — `assertRetiredWriter` (`scripts/lib/sr-retired-writer.mjs:139`) **always `process.exit`s and cannot be caught** |

### Idempotency — all pure, none throw

`canonicalizeApprovalInput` normalizes every field, turns `medleyTag: null` into
`""`, and song ORDER is significant. `approvalInputFingerprint` **excludes the
timestamp** — that omission is what makes replay detection work.
`transitionFingerprint` excludes the source status and includes `adminNotes`.
`decideApprovalReceipt` returning `"unverified"` means **"approved but
unprovable"**, not "not approved". `APPROVAL_RECEIPT_VERSION` and
`APPROVAL_APP_MARKER` are **not approval-specific despite their names** — both are
reused verbatim inside `transitionFingerprint`.

### Cache — nothing applies

`app/utils/revalidate.ts` exports three helpers; four more wrap them in
`serviceMutationSideEffects.ts:755-777`. **None applies to a message write.**
`me/propose/[roleId]/page.tsx:8` declares `revalidate = 0`; `/admin` is forced
dynamic by `requireActiveManager()` reading cookies and its panel fetches
client-side. The precedent is exact: `app/api/me/proposals/route.ts` calls no
`revalidate*`, while the admin route calls `revalidateProposalApproval()` only
because **approval writes the live setlist**, which does back ISR pages.

### Unresolved, flagged not decided

The admin notification audience is **role-based with no ministry filter**, so a
kids-only `admin` receives worship proposal notices. Pre-existing. This plan
widens how often it happens. Frank's call, not this document's.

---

## Design

### 1. Schema

Shipped on `setlistProposal` in Phase 1, after `team_notes`:

```
messages: array of object `proposal_message`
  _key        string    nextKey() — 12 hex chars
  author      reference → teamMembers, OPTIONAL
  author_role "lead" | "admin" | "pastor" | "system"
  kind        "lead_note" | "admin_change_request" | "pastor_note" | "system"
  body        text, ≤ PROPOSAL_NOTES_MAX (4000)
  at          datetime, server-minted
```

**`author` is a reference plus an `author_role` snapshot, not a name snapshot.**
Every person on a protected document here is a reference; names are denormalized
only at projection time. `author_role` is a fact about the message *when posted*,
so an admin who later becomes a member does not have their history re-render as a
lead note, and rendering needs no join to pick a side. `author` is optional
because two production `admin_notes` have nobody to attribute them to.

`kind` and `author_role` reserve `pastor_note` and `system` so routing "notas del
pastor" here later is a write-path change with **no migration**. R2 mints neither.

**`_type: "proposal_message"` must be added.** Every other array-of-object write
on this document carries one (`proposal_song`, `contributor`).
`buildProposalMessage` shipped in Phase 1 **without** it and
`proposalMessageWrite.test.ts` pins that shape — so Phase 4 adds the field to the
builder, updates that test, and the migration writes it too. Otherwise migrated
items carry `_type` and runtime items do not: permanently heterogeneous, half of
it written irreversibly.

### 2. Approval and transition fingerprints — nothing changes

`approvalInputFingerprint` fingerprints `{v, marker, serviceType, serviceDate,
serviceRef, setlistTargetKey, songs[], teamNotes}`. Neither notes field appears.
`team_notes` is untouched, so **`approval_receipt` is byte-for-byte unaffected**
and `messages[]` is NOT added to `ApprovalInput`.

**Both constants are frozen.** `transitionFingerprint` reuses
`APPROVAL_RECEIPT_VERSION` and `APPROVAL_APP_MARKER`, and `decideApprovalReceipt`
rejects on either mismatch — so bumping one to "version" the transition shape
would turn the 5 production approvals carrying a valid receipt into
`409 legacy_approval_unverified`. Phase 0 pinned both digests to hard-coded hex.

The transition contract is therefore unchanged: `adminNotes` stays the wire field
and the digest key. Only *where the string is stored* changes.

**Idempotency is preserved by construction.** `decideTransitionRetry` matches on
inputs none of which move, and `no_write_retry` returns before the transaction is
assembled — so a replay appends no duplicate message, provided the append lives
strictly inside the branch that guard protects.

**One visible consequence the overwrite model hid:** a proposal already in
`changes_requested` receiving the *same* `adminNotes` again is a fingerprint match
— a no-write retry returning 200 with no new bubble. The contract stays frozen;
**the UI must not present that 200 as a delivered message.** A proposal is in
`changes_requested` in production now.

### 3. Write paths

| Route | Guard | Append |
|---|---|---|
| `POST /api/me/proposals/[id]/messages` | `requireMinistryMember("worship")`, caller ∈ `canonicalLeadRefs(role)`, **and** `role.published !== false` — both halves of `me/proposals/route.ts:127` | `setIfMissing({messages: []})` + `append`, **no `ifRevisionId`** |
| `POST /api/admin/proposals/[id]/messages` | `requireActiveManager()` **and** `role !== "content-editor"` | same |

Both resolve through `loadCanonicalProposal`, are wrapped in
`withVerificationRunContext`, and share the pure `app/utils/proposalMessageWrite.ts`.

**On duplicates, the message routes are deliberately laxer than the save path.**
The save path refuses an ambiguous group via `loadProposalGroup`
(`me/proposals/route.ts:138-145`); `loadCanonicalProposal` does no
duplicate-per-service detection, and the composer's id comes from
`getSharedProposal`'s `order(_createdAt asc)[0]`. **Decision: accept it.** A message
landing on the same document the composer is rendering is self-consistent, and
refusing to let someone talk because a duplicate exists elsewhere would block the
channel exactly when a duplicate needs discussing. The save path stays strict
because a write to the wrong document is a lost setlist; a message is not.
**Both declare `export const maxDuration = 60`**, like their siblings
(`me/proposals/route.ts:5`, `admin/proposals/[id]/route.ts:5`) — the lead route
hosts the same `after()` fan-out, and §5 notes queuing runs an inline sweep at
roughly 14 s per send.

**Ministry gate — a decision, not an inheritance.** `requireActiveManager()` has
no ministry check, so a kids-only `admin` could write to a worship proposal. This
mirrors the sibling transition route exactly and grants that actor nothing they do
not already have, so it is not an escalation. But CLAUDE.md's two-way isolation
rule says a worship surface gates with `requireMinistryManager("worship")`, and
this is a **new** writer. **Decision: mirror the sibling.** A new writer stricter
than the route beside it gives two different answers to "can this admin act on
this proposal", which is worse than one consistent wrong answer. Tightening both
together is OQ-1's business.

**`setIfMissing` is mandatory on every patch that appends.** Sanity requires the
array to exist; the vendored client says so (`README.md:1213-1218`) and the repo's
only append precedent does it (`push-token/route.ts:20-23`). Without it the FIRST
message fails on every proposal with no array — the 6 documents the migration does
not touch, plus every proposal created later — and inside the transition patch it
fails the whole transaction, so admins cannot request changes at all. **Route
tests here mock the Sanity patch chain** (`notifPrefsRoute.test.ts:21-35`), so a
mocked `append` succeeds regardless: the test must assert on the mutation chain.

**Concurrency.** Standalone appends carry no revision precondition, so two
concurrent posts both land. Deliberately not read-modify-write, which would
either 409 or drop the loser.

**The admin transition appends inside its existing patch**, inheriting
`ifRevisionId(request.rev)` because the note is part of a reviewed decision:
`p.ifRevisionId(rev).set({status, reviewed_at, last_transition}).setIfMissing({messages: []}).append("messages", [msg])`.
That asymmetry with the chat routes is intentional and must be commented in code.
The transition **stops setting `admin_notes`**.

- **`reopen` with an empty note appends nothing** and still commits the status
  change — it legitimately sends none (`ProposalsPanel.tsx:143`, `:329`,
  placeholder "(opcional)").
- **`reconcile_target` never appends.** It shares the request shape and may carry
  `adminNotes`, but it is a metadata repair, already branched at `route.ts:491-503`.
- **The thread-open predicate does NOT gate the transition path.** A
  `request_changes` on a past-dated service must still commit, so its message
  appends to a thread the composer would refuse. Intended.

**Limits.** Body ≤ `PROPOSAL_NOTES_MAX` (`app/utils/proposalNotesLimit.ts`, a
dependency-free leaf so a client component can import it without pulling in
`node:crypto`). Empty or whitespace-only → `invalid_request` **on the two
standalone routes**. Thread capped at `PROPOSAL_MESSAGES_MAX = 200`, checked
against the loaded document — **racy by construction** (two concurrent posts at
199 both land) and accepted as a growth bound, not a security boundary. Say so in
the code.

**The cap applies to the two standalone routes ONLY.** The transition must never
be blocked by it: a full thread refusing a `request_changes` would turn a growth
bound into a review outage. If the cap is reached, the transition commits its
status change and appends nothing.

**Response.** The appended message and the full `messages[]`, read back through
`operationalClient`.

**The two surfaces get DIFFERENT treatment, and the difference is the point.**

- **Admin panel: refresh content and revision together.** After a successful post,
  `ProposalsPanel` calls `await load()` — which replaces the whole record
  (`:508` → `:395` `setProposals`) and re-renders the card from props. Adopting a
  revision is safe here only because the content arrives with it.
- **Lead editor: adopt NOTHING. The route returns no `_rev` to it, and `rev` stays
  pinned to what the editor was rendered from.** A concurrent co-lead save then
  still 409s on the lead's next save, which is the safe, already-handled outcome.

**Why the lead surface cannot use the same remedy.** `router.refresh()` re-seeds
`rev` (`ProposalEditor.tsx:162-163`) and `_id` (`:168-169`) — those are the file's
only prop-tracking effects. `songs` (`:109-119`) and `teamNotes` (`:122`) are
one-time lazy initializers, and no `setSongs` call is driven by the prop (all six
are user actions). `router.refresh()` preserves client state *by design* — the
comment at `:158-161` exists because it does. So prescribing "`setRev` +
`router.refresh()`" would advance the revision **without** the content, producing
exactly the divergence this section forbids:

> lead A opens at rev R1 → co-lead B saves a different setlist (legal while
> `pending`/`changes_requested`) → R2 → A posts a message; the append has no
> revision precondition, succeeds, returns R3 → A adopts R3 while songs stay A's
> R1 copy → A saves → `compareObservedTarget` returns `null` (success) and the
> patch commits `ifRevisionId(R3).set({songs, …})`, **overwriting B's setlist with
> no 409, no banner and no toast.** Today that save 409s.

Re-seeding `songs` from the prop instead is worse: it would clobber the lead's
unsaved local edits.

**The cost of pinning, stated honestly:** a lead who posts a message mid-edit will
409 on their next save and must use the existing "Recargar" banner, losing unsaved
song changes. That is a real annoyance and it is the correct trade — a 409 is
visible and recoverable; a silent overwrite of a co-lead's setlist is neither. The
composer should nudge: disable it, or warn, while the editor has unsaved changes.

**Why a bare `_rev` is unsafe on the ADMIN surface too, and this is the subtlest
hazard in the plan.**
`_rev` on the admin transition is not a staleness token — it is an **attestation
that the admin saw this content**. The route says so in as many words
(`app/api/admin/proposals/[id]/route.ts:63-67`): *"`rev` is the proposal revision
the admin ACTUALLY reviewed — a freshly fetched server revision is never a
substitute, because it would re-authorize a decision made against content the
reviewer never saw."* Approve then publishes the **stored** songs (`:164`,
`storedProposalSongRows(doc.songs)`); there is no client-supplied content
fingerprint, so the revision is the only thing binding the decision to what was on
screen.

Adopting a `_rev` from a message-post response breaks that binding, because the
response carries no songs. The sequence: the admin renders the card at rev A → the
lead saves a different setlist (permitted while `pending`/`changes_requested`) →
rev B → the admin, seeing the old card, posts a question → the append has no
revision precondition, succeeds, returns rev C → the panel adopts C → *Aprobar*
**passes** the staleness check and publishes songs the admin never reviewed.
Today that sequence 409s. `await load()` refreshes rev and content together, which
is why it is the only thing that may set `proposal._rev` in the panel
(`ProposalsPanel.tsx:508` is the sole such call; there is no polling).

The `me/proposals:320-328` precedent does **not** transfer: there the client's
content *is* what it just wrote, so rev and content cannot diverge. Here they can.

**What the refresh does NOT solve:** it refreshes the *poster's* client, not the
counterparty's. An admin's post still 409s a lead who was already editing, and
vice versa — non-destructive, the editor does not clear, and it is the same class
as today's request-changes-during-edit collision. Accepted for R2; live refresh is
R3 alongside read marks.

**No optimistic append.** A failed post that had already rendered would leave a
phantom message in a channel whose whole value is that nothing is lost.

### 4. `POST /api/me/proposals` — two rules, in this order

**1. It STOPS WRITING `lead_notes`, in BOTH branches** — the patch (`:232`) and
the create (`:263`). Unconditionally. The create branch mints `messages: [msg]`
instead when a note is present.

This is data-loss prevention. Both branches set `lead_notes: request.leadNotes`
today, and the parser coerces an absent value to `""`. The new editor stops
sending it — so if that line survives, **the first save from the new bundle writes
`lead_notes: ""` over each of the 7 production documents that carry one**, erasing
the frozen archive that the rollback story and the reconciliation step both depend
on. And the reconcile compares only *non-empty* fields, so it would report clean
over the loss.

**2. It keeps ACCEPTING `leadNotes` for one release.** A lead can have the editor
open from before the cutover; the parser ignores unknown keys and the response
shape is unchanged, so an old bundle would otherwise post its note, receive a
**200**, show "Borrador guardado", and lose the text on reload. When the incoming
value is non-empty and differs from the newest stored `lead_note` body, the route
**appends it as a `lead_note` message and queues the notice**. Removing the field
from the parser is a separate, later delivery.

### 5. Outbox

**Call sites, authoritatively:** `queueLeadNotesNotice` is called from
`POST /api/me/proposals/[id]/messages` **and** from the legacy `leadNotes` compat
path above — each snapshotting `previousStatus` and the lead-message count
PRE-COMMIT in its own handler — and from nowhere else. Both, or the compat path is
silent for the whole release.

**Why it must move at all:** its only caller today passes
`afterNotes: request.leadNotes`, which Phase 4 stops producing. Left in place it
would sit in a handler that appends zero messages, and the debounced admin email
would be **silently retired** by a refactor. The requirement said no *new* emails;
it did not say to kill the existing one.

**Input shape.** `QueueLeadNotesNoticeInput` loses `beforeNotes`/`afterNotes` and
gains `beforeMessageCount: number` — the pre-commit count of `messages` where
**`kind === "lead_note"`**, the same predicate the classifier slices on. One
predicate, named once. The route passes the post-commit count too, since the queue
function cannot derive a delta from one input. `notificationOutbox.before` gains
the field; `beforeNotes` **stays in the schema** so in-flight legacy documents
remain readable.

**Classification** replaces `classifyLeadNotes`:

```
classifyProposalMessages({ beforeCount, afterMessages, serviceDate, today, reviewable })
  isPast(serviceDate, today)  -> null   (unchanged)
  !reviewable                 -> null   (unchanged)
  appended = afterMessages.filter(kind === "lead_note").slice(beforeCount)
  appended.length === 0       -> null
  -> { kind: "leadNotes", …, notes: appended.map(m => m.body).join("\n\n") }
```

A count-and-slice is sound only because the array is append-only *and* the
migration runs before this code reaches production, so no prepend can shift
indices under a queued notice.

`LineKind`, `LINE_PREF.leadNotes`, `NOTICE_KINDS` and the stored `kind` value
`"leadNotes"` are **all unchanged** — renaming the wire value would orphan
in-flight documents for no benefit. Only the meaning changes.

**In-flight legacy notices:** `typeof notice.before?.beforeMessageCount !== "number"`
⇒ **drop** (return `[]`). The test must be `typeof`, not truthiness —
`beforeMessageCount: 0` is the legitimate first-message case. Dropping is safe and
verified: `classifiedIds.add` precedes classification (`outboxSweep.ts:734`),
`partitionClaimed` routes a classified notice with no pending recipients to
`toConsume` (`:506-535`), and the `finally` deletes it (`:886-890`). It does not
crash, wedge or re-pend.

**Knowing what queuing costs:** `commitUpserts` also runs `sweepOutbox`
unconditionally, so posting can send another member's pending email inline. The
messages route is a latency-variable path; the tests must not assume queuing is
cheap.

**`proposalNotify.ts:138-153`** — the "Nueva propuesta" admin email takes the body
of the newest `kind == "lead_note"` message, empty when there is none. Take the
last matching element **in JS**, not with a GROQ negative index. Note the semantic
drift: today `lead_notes` on submit is what the lead saved *with that submission*;
the newest message may be a migrated note or days older. Acceptable — it is still
their most recent word — but the framing must not imply "notes attached to this
submission".

### 6. Notifications, both directions

| Direction | Trigger | Channel |
|---|---|---|
| lead → admin, `pending`/`changes_requested` | a `lead_note` message | the existing debounced `leadNotes` outbox email |
| lead → admin, `approved` | a `lead_note` message | **push to ADMINS** — `sendPush(adminIds, "proposals", …)`, `adminIds` from the exported `ADMIN_RECIPIENTS_QUERY` |
| lead → admin, `draft` | — | **nothing** — a draft is not in front of admins yet |
| admin → lead, **standalone message only** | an `admin_change_request` posted through `POST /api/admin/proposals/[id]/messages` | push via `notifyProposalReview(doc, push)` with the NEW message copy |
| admin → lead, **via a transition** | `request_changes` / `reopen` | **unchanged** — the transition already calls `notifyProposalReview(doc, REVIEW_PUSH[action])` at `admin/proposals/[id]/route.ts:527`. Do not add a second call, and do not replace `Cambios solicitados` with `Nuevo mensaje`: the decision signal outranks the message signal |
| lead → admin, first submission | unchanged | `notifyProposalPending` |

**The `approved` row exists because the composer stays open there** (decision 5)
while both outbox gates are `{pending, changes_requested}`. Without it, a lead
could post on a proposal the admin never learns about — and most proposals are
approved.

**Do not reach for `notifyProposalReview` when the recipients are ADMINS** — that
is the `lead → admin, approved` row. Its audience is lead + contributors; admins
are not in it. (It *is* the right helper for the two rows whose recipient is the
lead, which is why both directions appear in one table: read the RECIPIENT column,
not the arrow.) There is **no reusable admin-push
helper** — this needs a small new one or an inline `sendPush`. Pick one in
implementation and say which.

**Exclude the author** from the recipient set: a lead who is also an `admin` would
otherwise be pushed about their own message. `notifyProposalReview(doc, push)` takes
no exclusion parameter and `proposalReviewRecipients` does not filter, so **filter in
the route** rather than changing that helper — altering it would change behaviour at
its two existing transition call sites for no reason. The repo is inconsistent here
(`notifyProposalSubmitted` does not exclude, `coLeads` does); this is the choice.

`REVIEWABLE_BEFORE_WRITE` and `REVIEWABLE_STATUSES` are **unchanged** — the email
keeps exactly today's audience and timing. The push is a separate additive call,
fired only when the status is one the outbox will not cover. **One signal per
message, never both.**

**Push copy must be new.** Reusing `REVIEW_PUSH.request_changes`
(`admin/proposals/[id]/route.ts:52`) would push "Cambios solicitados — Revisaron la
propuesta y pidieron cambios" when an admin merely asked a question. Say a message
arrived: `Nuevo mensaje` / `<Autor> escribió en la propuesta del <fecha>`.

**A lead message can be silently unsignalled across an approval, and that is
accepted.** A lead posts while `pending` → a notice is queued and no push fires
(the email covers that status). If an admin approves inside the 15–60 min debounce,
the flush finds `REVIEWABLE_STATUSES.has("approved") === false`
(`outboxSweep.ts:393`), classifies to `null`, and consumes the notice. No email, no
push; the message is visible only if an admin opens the card. Rare, non-destructive,
and closing it would mean either firing a push the email was meant to cover or
widening the flush gate. Named rather than fixed.

**These pushes are not debounced.** N messages, N pushes. Acceptable at this team's
volume; if it becomes noise the fix is a push debounce, not a wider email.

**Preference axis:** `sendPush` gates on `notifPrefs.proposals` via `optedIn`,
**not** on `wantsNotification`, which reads `emailProposals`. Independent. Do not
"unify" them here.

### 7. Read state — deferred, with the space narrowed

**R2 ships no unread indicator.** Decision 3. Read state becomes R3: a
`proposalReadMark` document type, one per (viewer, proposal), written by its own
guarded route — a new type, a new writer and a new lifecycle, so its own critical
delivery.

Two designs are ruled out on hard evidence, and these are R3's binding constraints:

- **Read marks on the proposal** make every reader a writer, bumping `_rev` — which
  is the admin transition's authorization token. An admin opening a card would
  invalidate their own reviewed revision, and two admins would invalidate each
  other. Disqualifying.
- **Read marks on `teamMembers`** bump the member `_rev`, and
  `publishReadyTransaction.ts:26-32` documents that an unrelated member write causes
  conservative false conflicts in the publish-ready transaction.

**The same mechanism applies, weakly, to messages themselves:** the publish-ready
transaction asserts the shared proposal's revision (`publishReadyTransaction.ts:21-22`),
so a message posted mid-publish causes a conservative false conflict. It fails
closed, and it is far rarer than a read mark on every card open — a message is a
deliberate act, a read is not. That difference is why messages are acceptable
where read marks are not; recorded so the distinction is explicit.

A derived, storage-free indicator was considered and declined: it never clears by
reading, only by acting.

R2 owes R3 nothing structural — `messages[].at` is server-minted and the array is
append-only, so a read mark is a timestamp comparison against data R2 stores.

### 8. Migration

`scripts/migrate-proposal-messages.mjs` + `scripts/lib/proposalMessages.mjs`,
dry-run by default, `--apply` to write, run as
`node --env-file=.env.local scripts/migrate-proposal-messages.mjs [--apply]`.

**The `--apply` runs at exactly one point: Phase 6 step 4** — after that phase's
code review and re-verification, immediately before the `preview` push. Nowhere
else.

**Safety interlock, then the write:**

1. **Refuse to write, per document, whenever `messages` is already non-empty and
   carries no migration `_key`** — a reported hard abort, not a silent skip. It
   cannot fire in the intended run (0 documents carry `messages`), and if it ever
   does, something is wrong that a script must not paper over.
2. Given that interlock, **`set` the whole `messages` array**: every target's array
   is absent or empty, so ordering the (at most two) minted messages in JS and
   writing one `set` is the simplest correct thing and needs no anchor semantics at
   all. (An earlier draft justified this by claiming `insert`-against-a-fresh-array
   was unverifiable — §3 disproves that, citing the vendored README and the live
   `push-token` precedent. The decision stands on simplicity; the old rationale was
   wrong and is corrected here so nobody inherits a false belief about `append`.)
3. Mint deterministic `_key`s `migleadnote01` / `migadminnote1` and **skip a
   document when ANY key it would mint is already present** — 3 production
   documents mint both, so a singular check would half-migrate one on a re-run.

**Field mapping:**

| Source | `kind` | `author_role` | `author` | `at`, first available |
|---|---|---|---|---|
| `lead_notes` | `lead_note` | `lead` | `lead._ref` | `last_edited_at` → `submitted_at` → `_createdAt` |
| `admin_notes` | `admin_change_request` | `admin` | `last_transition.by` when present, else **absent** | `last_transition.at` → `reviewed_at` → `_updatedAt` |

Those fallback fields are **not** in `PROPOSAL_PROJECTION`; the script issues its
own query. Order the minted messages by resolved `at` ascending, lead-first on a tie.

**One shape, two implementations.** `scripts/lib/proposalMessages.mjs` must
re-derive what `proposalMessageWrite.ts` owns, because a `.mjs` script cannot
import the TS module. Nothing makes them agree at compile time — assert the same
field set (including `_type`) in both test files.

**Figures are illustrative, never acceptance criteria.** Measured `production`:

| | 2026-08-24 | 2026-08-25 |
|---|---|---|
| documents | 14 | 14 |
| `lead_notes` | 7 | 7 |
| `admin_notes` | 3 | **4** |
| both | 2 | **3** |
| ⇒ patched / minted | 8 / 10 | **8 / 11** |
| `admin_notes` with no attributable author | 2 of 3 | **2 of 4** — measured directly, not inferred from the `last_transition` count; the two sets do not coincide |
| in `changes_requested` | 0 | **1** |

One day moved the message count. This is also why §2 freezes the constants rather
than resting on an empty replay window: on 2026-08-24 no document could match
`decideTransitionRetry`; one day later one could.

**Rollback:** `lead_notes` and `admin_notes` are never unset — they remain a
byte-exact frozen archive, which is what §4's first rule protects. Reverting the
code restores them as authoritative and makes `messages[]` inert. **What revert
does not recover:** every message posted after the cutover becomes invisible, and
the legacy fields are stale. Unsetting the legacy fields is a separate, separately
consented delivery, gated on the reconciliation reporting clean.

**Consent:** production Sanity writes need Frank's explicit go-ahead, and `preview`
writes the REAL production dataset — pushing `preview` rehearses the UI, never the
data. One dataset, one shot.

### 9. Reads to update

| Site | Change |
|---|---|
| `serviceReadQueries.ts:33-43` (`PROPOSAL_PROJECTION`) | Add `messages[]{_key, "author": author._ref, author_role, kind, body, at}`. Keep the legacy fields — frozen archive. **Payload note:** this projection also backs `canonicalProposalsQuery()`, an all-proposals read; at 4000 chars × 200 messages the worst case adds ~800 KB per document. Irrelevant at 14 documents, worth revisiting before the catalog grows |
| `app/api/admin/proposals/route.ts:20-49` | Add the projection with a resolved author name, following `"lead_name": coalesce(lead->alias, lead->member_name)` (`:35`) |
| `ProposalsPanel.tsx:36-38, 106, 225-237` | Type gains `messages`; the `lead_notes` (`:225-229`) and `admin_notes` (`:233-237`) blocks become `<ProposalThread>`; `team_notes` (`:212-218`) untouched. **`:106` seeds the change-request composer from `proposal.admin_notes` — seed it empty**, or an admin re-sends a stale legacy note as a new message. Symmetric compat gap: during the one-release window an OLD admin bundle still seeds from `admin_notes` and would append it as a duplicate message. Unlike the lead side (§4 rule 2) this is cosmetic rather than lossy — a duplicate bubble, not a discarded note — so it is accepted rather than handled |
| `me/propose/[roleId]/page.tsx:40-56` | Add messages with resolved author names |
| `ProposalEditor.tsx:34-40, 121, 350, 446-450, 693-740` | Type gains `messages`; drop `leadNotes` state and the save-body key; the "Notas privadas" textarea and the approved-state echo become `<ProposalThread>`; the `admin_notes` banner is subsumed. **`teamNotes` untouched** |
| `app/api/me/proposals/route.ts:56-62` | GET projection: `messages` in, `lead_notes`/`admin_notes` out |
| `app/(client)/me/page.tsx:231-236, 267-287` | **Drop `admin_notes`** — projected and never rendered |
| `app/utils/interface.tsx` | Already carries `messages?` (Phase 1) |
| `app/utils/protectedReadAudit.ts` | **No change.** `messages` is deliberately not added to `PROTECTED_FIELDS`: the list is matched by a word-boundary regex (`:729`) and its own comment (`:34-38`) says it excludes ambiguous names to keep the signal specific. It already omits `lead_notes`/`admin_notes`, so the audit never depended on them |
| `e2e/service-readiness/lib/dataset.ts:390-403` | `StoredProposal` and its projection gain `messages` |

### 10. UI

`app/components/ProposalThread.tsx`, shared by both surfaces:
`{messages, viewerId, viewerRole, onPost, posting, error}`.

- Chronological, sender-aligned, each bubble showing author name (or `Admin` when
  `author` is absent on a migrated message), a timestamp, and `whitespace-pre-wrap`
  body. Composer textarea + send button below.
- **Timestamps follow the timezone invariant.** Any "Hoy"/"Ayer" label is a
  calendar-day diff at local noon in `America/Mexico_City`. `message.at` is a full
  ISO datetime, so convert to a local calendar day first. Never bare
  `new Date(iso)`, never elapsed hours.
- **The composer closes when the SERVICE has passed**, not on approval —
  `isThreadOpen` (`app/utils/proposalThread.ts`, shipped): `service_date >= today`
  as a calendar-day string compare, failing closed on an unusable date because it
  authorizes a write. **Both message routes enforce it server-side** — a hidden
  composer is not a guard. Past the date the thread renders read-only with
  `La conversación se cerró al pasar el servicio.`
- **No proposal document yet ⇒ disabled composer** with
  `Guarda la propuesta para empezar la conversación.` `ProposalEditor` renders
  before the first save with `proposal` null, so there is no `[id]` to post to.
  This is a real narrowing — today a lead can type private notes before the first
  save — accepted, because buffering an unsent message client-side is the phantom
  failure §3 rejects.
- **Colour:** lead bubbles `border-surface-accent-30` / `bg-accent/5` /
  `text-mono-300`; admin bubbles `border-negative-strong/30` /
  `bg-negative-strong/10` / `text-negative-muted`; timestamps
  `font-label text-[11px] uppercase tracking-widest text-mono-500`. Existing tokens
  only; if alpha is ever needed, `themeColour(rgbVar, alpha)` — **never** string
  concatenation.
- **Toasts** via `useTransientValue`. Never a bare `setTimeout`.
- **Mutation handler** wraps `fetch` in try/catch/finally, checks `res.ok`, resets
  `posting` in `finally`, and **never clears the composer on failure**.
- **Spanish copy:** `Conversación con los admins` / `Conversación con el líder`;
  `Aún no hay mensajes.`; `Escribe un mensaje…`; `Enviar`; `Enviando…`;
  `Error al enviar el mensaje`. No unread badge in R2.
- **The admin `request_changes` composer stays as it is** — it is a *decision*, not
  a chat message, keeps its own state and its `!adminNotes.trim()` disable. Its text
  simply also lands in the thread. **One change: branch on `data.idempotent`**,
  which the route already returns (`admin/proposals/[id]/route.ts:437`). A repeat
  with byte-identical `adminNotes` is a no-write retry (§2) — show "sin cambios"
  rather than a success toast, or the admin believes a message was delivered that
  was not.

---

## Phases

Every phase ends with `npx tsc --noEmit`, `npm test`, `npx eslint .` at 0 errors,
plus the check named.

### Phase 2 — Migration script, dry-run only

- `scripts/migrate-proposal-messages.mjs` + `scripts/lib/proposalMessages.mjs`.
- **Register in `OPERATOR_TOOLING_ALLOWLIST` in this same phase** — `scripts/**` is
  audited, so creating the file without registering reddens this phase's own gate.
  Update the exact list pinned at `protectedReadAudit.test.ts:484-497`. It must
  **not** go in `RETIRED_ONE_SHOT_WRITERS` while it still has to run.
- **Verification:** gate + `scripts/__tests__/migrateProposalMessages.test.ts`
  (mapping, fallback chains, ordering, `_key` skip, and the hard abort on a live
  thread). Dry-run reports the three counts and matches a fresh measurement.
- **State after:** deployable; no production write has occurred.

### Phase 3 — Rehearsal

- Re-run the dry-run and diff against Phase 2's output. Any change means production
  moved; investigate before continuing.
- **No `--apply`.**

### Phase 4 — The cutover (one deploy, deliberately not split)

Splitting this produces either a dead notification or a mass mis-send. It ships
together.

- Both message routes (§3), with `setIfMissing`, `loadCanonicalProposal`,
  `withVerificationRunContext`, and the fresh `_rev` in the response.
- The transition appends inside its existing patch and **stops setting
  `admin_notes`**; appends nothing for an empty `reopen` note or for
  `reconcile_target`.
- **`app/api/me/proposals/route.ts` stops writing `lead_notes` in BOTH branches**
  and keeps accepting `leadNotes` per §4.
- **`buildProposalMessage` gains `_type`**, and its test is updated.
- Outbox: the call moves to both paths; `beforeMessageCount`;
  `classifyProposalMessages`; `PROPOSAL_QUERY` projects `messages[]`; legacy-shape
  drop. Export `REVIEWABLE_BEFORE_WRITE` and `ADMIN_RECIPIENTS_QUERY`.
- Notifications per §6. Reads and UI per §9 and §10.
- Register both writers in `PROTECTED_RUNTIME_WRITERS` and move the count test's
  title from fourteen to sixteen (`protectedReadAudit.test.ts:387`).
- **Deploy the Sanity schema again** — `notificationOutbox` gains
  `beforeMessageCount`. The Content Lake stores undeclared fields so nothing breaks
  without it, but the manifest would be stale.
- **Verification:** gate + the whole Verification table, including the
  mutation-chain assertions.
- **Deployability caveat:** the e2e fixtures still assert `admin_notes` until
  Phase 5, so this phase is deployable against vitest but **not** against the e2e
  suites. Run them after Phase 5, or fold the fixture update in here.
- **The `preview` walkthrough writes REAL data.** R2 ships no edit or delete path,
  so every test message is permanent and visible to the actual team. Name the
  target proposal in advance; do not improvise on a live service.

### Phase 5 — Docs, ADRs, e2e

- `docs/DATA_MODEL.md`; `docs/API_REFERENCE.md` (+ rows for the two routes, and
  state explicitly that the transition-fingerprint field list is unchanged);
  `docs/UTILITIES_AND_COMPONENTS.md` (+ `ProposalThread`); `docs/NOTIFICATIONS.md`
  (+ the pushes); a forward pointer at
  `docs/superpowers/specs/2026-07-03-shared-setlist-proposals-design.md:83`.
- **ADR-0023** — why `APPROVAL_RECEIPT_VERSION` / `APPROVAL_APP_MARKER` were
  deliberately not bumped. Link from `proposalWriteRequest.ts:173-176`.
- **ADR-0024** — why read state is deferred and must never live on
  `setlistProposal` or `teamMembers`.
- e2e: `proposal-lifecycle.spec.ts:104`, `zero-delivery.spec.ts:64`,
  `lib/dataset.ts:390-403`, `scripts/lib/sr-verification.mjs:938`.

### Phase 6 — Release

The order is the point: the `--apply` comes **after** the code review, so a review
finding cannot extend the window in which production still writes the legacy fields.

1. Gates green on the feature branch, then a **fresh code review of
   `main...feature`** — the range the PR merges. Do not "merge to `main` locally":
   `main` is protected with `enforce_admins: true` and takes no direct push
   (`docs/CI.md`). Fix, **re-verify the fix**.
2. **Re-measure:** documents with non-empty legacy notes and the message count they
   imply; documents already carrying `messages` (**expect 0** — non-zero means a
   write path shipped early, stop for a human); documents carrying a migration
   `_key` (expect 0).
3. Read the fresh dry-run diff line by line.
4. **Frank's explicit consent in chat**, then `--apply`. **The only `--apply`.**
5. Re-read the patched documents and confirm the count step 2 predicted — never a
   hard-coded number — with correct `_key`, `_type`, `kind`, `author_role`, `at`,
   and a resolvable `author` where present.
6. Merge the feature branch into `preview`, push, **verify
   `dev-owt-backstage.vercel.app` is in the deployment's `alias` array and
   `meta.githubCommitSha` is the pushed commit.**
7. PR to `main`, wait for `gates`, merge.
8. Verify the production alias the same way.
9. **Reconcile — part of the release, not a follow-up.** Re-read all proposals and
   compare each `lead_notes` / `admin_notes` against the body of its migrated
   message. **Compare emptiness too, not only non-empty values** — a field blanked
   to `""` is exactly the failure §4's first rule prevents, and a non-empty-only
   comparison would skip it. Report every mismatch. Repair by **consented top-up**:
   append the drifted text with a distinct `_key` (`topup<n>`), never by re-running
   the migration. Until clean, the legacy field remains the fuller record — so do
   not schedule the cleanup that unsets it.

**The residual window is step 4 → step 8**: a preview verification and a PR gate,
roughly ten to twenty minutes. It is not zero, which is why step 9 exists.

**Two things live inside it.** `preview` runs the new code and production the old,
against the same dataset, and both sweep the outbox — a new-shape notice queued
from preview and classified by production's old `classifyLeadNotesNotice` compares
`before: ""` against the frozen live `lead_notes` and could mail admins stale text
as new. So **do not exercise the thread on `preview` until step 8 completes**,
including the walkthrough's message posts.

**Volume, named rather than assumed:** the debounced admin email moves from "the
notes field changed on a save" to "a lead posted a message", and chat invites far
more frequent posting. Production runs `NOTIFY_FLUSH_EMAIL_LIMIT=2` against a
measured 14 413 ms/send. Watch `report.lost` after the release.

---

## Verification

| Requirement | Test | Failure it detects |
|---|---|---|
| Approval receipts survive | `proposalWriteRequest.test.ts` frozen digests (shipped) | Any change to `canonicalizeApprovalInput` or the two constants |
| Transition retries survive | same, transition digest (shipped) | Any change to the transition digest input |
| Replay appends no duplicate | `proposalWriteRoutes.test.ts` — replay a committed `request_changes`, assert `messages.length` unchanged | The append escaping the `no_write_retry` guard |
| **The legacy archive is never overwritten** | `proposalWriteRoutes.test.ts` — the save mutation `set` has **no** `lead_notes` key; re-read a document with a pre-existing value and show it byte-unchanged | Blanking `lead_notes` on 7 production documents, with the reconcile reporting clean because it only compares non-empty fields |
| **`setIfMissing` precedes every append** | `proposalMessageRoutes.test.ts` + `proposalWriteRoutes.test.ts` — assert the MUTATION CHAIN, not a 200 | The first message failing silently, and a first-time `request_changes` rolling back its status change |
| An old-shape save lands and queues | `setlistNoticeQueueing.test.ts` — a save carrying `leadNotes` from a pre-cutover bundle appends a message and produces an outbox document | A lead's note discarded behind a success toast; a silent compat release |
| Stored shape is homogeneous | `proposalMessageWrite.test.ts` + `migrateProposalMessages.test.ts` assert the same field set including `_type` | Migrated items carrying `_type` and runtime items not |
| A post refreshes content, not just the revision | mount test — interleave a LEAD CONTENT EDIT between the admin's card render and the admin's post, then assert the subsequent approve either 409s or publishes only songs the admin was shown | An adopted bare `_rev` re-authorizing an approval against content the reviewer never saw — the property `admin/proposals/[id]/route.ts:63-67` exists to protect |
| A post does not 409 the ADMIN's own next action | `proposalMessageRoutes.test.ts` — after `load()`, a transition succeeds | The `_rev` bump locking the admin out of the card |
| A LEAD's post never enables a lost update | mount test — interleave a CO-LEAD content edit between the lead's page render and the lead's post, then assert the subsequent save **409s** rather than committing | Adopting a revision without its content, silently overwriting a co-lead's setlist where today it 409s |
| A repeat identical `request_changes` is not shown as delivered | `proposalsPanel` mount test — a 200 carrying `idempotent: true` does not render a new bubble or a success toast | Presenting a no-write retry as a sent message |
| The transition stops setting `admin_notes` | `proposalWriteRoutes.test.ts` — assert the transition mutation `set` has no `admin_notes` key | Silently blanking the frozen admin archive, which today an empty `reopen` already does (`route.ts:500`, `adminNotes` coerced to `""`) |
| Concurrent posts both land | `proposalMessageRoutes.test.ts` | A revision precondition creeping into the append |
| An empty `reopen` appends nothing | `proposalWriteRoutes.test.ts` | A blank bubble on every note-less reopen |
| The composer closes on the SERVICE DATE | `proposalThread.test.ts` (shipped) + `proposalMessageRoutes.test.ts` — an approved future service accepts a post; a past-dated one is rejected server-side | A chat read-only on most real proposals, or a client-only gate a request bypasses |
| The `leadNotes` notice still queues | `setlistNoticeQueueing.test.ts` | The debounced admin email silently retired |
| Legacy notice is dropped and consumed | `outboxSweep.test.ts` — a `{beforeNotes}` notice with no `beforeMessageCount` | An empty-body email to admins; a wedged claim |
| Only lead messages queue a notice | `setlistNoticeQueueing.test.ts` | Admins mailed their own change-request |
| The admin push reaches ADMINS | `proposalMessageRoutes.test.ts` — assert the recipient set | Pushing the lead about their own message |
| `team_notes` untouched | existing `proposalWriteRoutes.test.ts` approval assertions | Folding team notes into the thread |
| Migration ABORTS on a live thread | `migrateProposalMessages.test.ts` | A whole-array `set` erasing real messages, unrecoverably |
| Migration is idempotent | second `--apply` reports `0 patched` | Duplicate messages |
| Non-lead / content-editor blocked | `proposalMessageRoutes.test.ts` | An ACL hole on a new writer |

**Suites that will break:** `proposalWriteRequest.test.ts`, `outboxSweep.test.ts`,
`outboxClassify.test.ts`, `serviceMutationSideEffects.test.ts`,
`proposalNotify.test.ts`, `protectedReadAudit.test.ts`,
`proposalWriteRoutes.test.ts`, `setlistNoticeQueueing.test.ts`,
`proposalMessageWrite.test.ts`, and if the email subject changes,
`emailTemplateGallery.test.ts` / `notificationEmail.test.ts`. E2E:
`proposal-lifecycle.spec.ts`, `zero-delivery.spec.ts`, `lib/dataset.ts`.

---

## Risk tier

**CRITICAL** — schema/data migration, a production mutation trust boundary (two
new writers), and a concurrency-protocol change on an existing guarded writer.
Three of the enumerated triggers.

Requires **two sequential fresh `APPROVED` verdicts on byte-identical text**,
reviewers run one at a time, prior findings never exposed. The churn cap is
binding: after two substantive `CHANGES_REQUIRED` rounds, stop; continuing needs
Frank's go-ahead obtained in advance. Consolidating this document changed its
shape, not its approval standing — the clock is at **zero**.

## Open questions

| # | Question | Recommendation | Blocking? |
|---|---|---|---|
| OQ-1 | Should the admin notification audience be ministry-filtered? A kids-only `admin` currently receives worship proposal notices | Pre-existing; this plan widens the frequency. Fix separately or accept explicitly | No |
| OQ-2 | New admin-push helper, or inline `sendPush` in the route? | Either; state which in implementation | No |
| OQ-3 | Does the `leadNotes` email subject change to "Mensajes de la propuesta"? | Yes — "Notas del líder" is wrong once the thread carries admin replies | No |

## Handoff

- **To R3:** read state (`proposalReadMark`). R2 leaves it nothing to undo.
- **To a later delivery:** unsetting `lead_notes` / `admin_notes`, gated on the
  Phase 6 reconciliation reporting clean; and removing `leadNotes` from
  `parseProposalSaveRequest` once no old bundle can be mounted.
- **Outputs:** `messages[]` populated on the 8 documents that carry legacy notes.
  The other 6 keep an absent array — which is why `setIfMissing` matters.

## Terminal state

`AWAITING_ADVERSARIAL_REVIEW` — Phases 2–6. Approval is not authorization to
implement.
