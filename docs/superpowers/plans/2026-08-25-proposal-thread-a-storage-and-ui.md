# Child A — The thread: storage, migration and UI

**Every rule here is stated once.** The predecessor stated several in three or
four places, and nine of its eleven review blockers were corrections that reached
one copy and not its twins. The narrative of what earlier drafts got wrong lives
in [the review log](2026-08-24-proposal-message-thread-review-log.md).

Parent: [`2026-08-25-proposal-thread-roadmap.md`](2026-08-25-proposal-thread-roadmap.md).
Contracts of reused helpers:
[`2026-08-24-proposal-message-thread.md`](2026-08-24-proposal-message-thread.md)
§"Contracts of what this plan reuses" — **normative, cited not restated**.

## Status

| | |
|---|---|
| Phase A (migration script, dry-run) | **Implemented and on `preview`** — `f1ebdf13`. Verified: dry-run reports 8 documents / 10 messages / 0 aborts |
| Phases B–E | **APPROVED for implementation planning, still NOT authorized to implement.** Risk tier CRITICAL |
| Approval | **Met** — two sequential fresh `APPROVED` verdicts on digest `5713a9cc…`. See the [review log](2026-08-25-proposal-thread-a-storage-and-ui-review-log.md) |
| Review history | 6 rounds. Blockers per round: 3 → 3 → 2 → 1 → 0 → 0; the step down happens at the consolidation |
| **Post-approval edits** | This file has been edited SINCE the approved digest, adopting non-blocking items from the two approving rounds. They are listed in the review log and are **un-reviewed** |

**Approval is not authorization to implement.** Each phase additionally requires a
fresh code review of its diff plus the documented gates.

## Outcome

A `setlistProposal` carries an append-only, attributed, timestamped conversation
between its lead and the admins. Nothing is ever overwritten. Both surfaces render
the full history and can post to it. **Users:** worship leads and
`admin`/`super-admin` reviewers.

Today `lead_notes` and `admin_notes` are single-valued (`sanity/schemas/setlistProposal.ts:151-163`,
`~:231` — `messages[]` was inserted between them in Phase 1), so each new note
destroys the previous one. `team_notes`, the whole-team note, is a different thing
and is out of scope.

## Scope

**In:** the migration; both message routes; the transition appending its
change-request; reads and projections; `ProposalThread.tsx`; and the **mirror**
that keeps notifications unchanged.

**Out — Child B owns these:** any change to `app/utils/outbox*` or
`proposalNotify.ts`, any change to `queueLeadNotesNotice`'s *signature*, any new
push, and removing the mirror.

**Not in this delivery at all:** unread indicators; pastor notes; unsetting the
legacy fields; **editing or deleting a message** — which is why several rules
below are about never writing the wrong thing in the first place.

---

## 1. The mirror

**Rule.** A write that appends a **lead** message also sets `lead_notes` to that
message's body. **`admin_notes` is mirrored by the TRANSITION only** — the
standalone admin route appends and leaves it alone, so admin chatter cannot
overwrite the change-request archive the rollback leans on, and `admin_notes` has
no notification consumer anyway.

**The lead route calls `queueLeadNotesNotice` with its existing, unmodified
signature** (`serviceMutationSideEffects.ts:636`, `:651` — both exported), passing
`beforeNotes` = the stored `lead_notes` captured PRE-COMMIT, `afterNotes` = the
appended body, and **`previousStatus`** = the status before this write, which the
input requires (`serviceMutationSideEffects.ts:641`, guarded at `:654`). **It does not call it at all when nothing was
appended** — passing a mirrored value on such a save yields `""`, minting a
spurious notice and resetting `servedRecipients` (`outboxNotice.ts:147-153`).

**Consequence, which is the entire point:** the existing debounced admin email
fires on the same occasions it fires today **except one, named in criterion 5**
(a pre-deploy client clearing the textarea), and **this child modifies no file
under `app/utils/outbox*` or `proposalNotify.ts`**.

**The mirror is lossy on purpose.** `lead_notes` holds only the newest lead
message — precisely what it holds today, which is why the notification is
unchanged.

### New gaps, named because parent invariant 8 requires it

All but the last are new features not signalling as richly as they could, and
Child B's to close. **The last one IS a regression** — an existing signal retired —
which parent invariant 8 does not permit silently, so it is also carried in
acceptance criterion 5 and in the parent's coverage table.

- **A lead's message on an `approved` or `draft` proposal notifies nobody** —
  `queueLeadNotesNotice` requires `previousStatus ∈ {pending, changes_requested}`
  (`serviceMutationSideEffects.ts:654`). **This is the dominant real-world case, not
  an edge:** at the last measurement 13 of 14 production proposals were `approved`,
  1 was `draft`, and **zero** were pending or changes_requested. Two consequences
  worth stating plainly: Child B's `approved` push exists precisely to close it, and
  **the Phase D walkthrough cannot exercise the mirror→email path at all**, so §1's
  central promise rests entirely on `setlistNoticeQueueing.test.ts`.
- **An admin's standalone message notifies nobody.** No such feature exists today.
- **A repeated identical message sends no email.** The queue guard
  (`serviceMutationSideEffects.ts:658`) and the flush classifier
  (`outboxClassify.ts:103`) both compare *trimmed strings*, so a bump — "¿Alguna
  noticia?" twice — queues nothing. The message is still stored and rendered.
- **Two messages inside the debounce window produce one email, carrying only the
  newest**, because the flush re-reads live `lead_notes` (`outboxSweep.ts:384`).
- **REGRESSION — a pre-deploy client that deliberately CLEARS the textarea is
  ignored.** An empty value fails the non-empty half of §2's server rule, so the
  erasure does not propagate and, because `lead_notes` does not move, **the notice
  that fires today does not fire**. Verified: `queueLeadNotesNotice` queues on
  `"X" → ""` (`serviceMutationSideEffects.ts:658` compares trimmed and they differ)
  and `classifyLeadNotes` returns a line for it. Accepted because the alternative —
  letting an empty payload through — is what criterion 3 exists to prevent. See
  criterion 5.
- **A chat message now invalidates an in-flight review, on BOTH surfaces.** This
  is the cost of the standalone routes carrying no revision precondition, and it
  was found by the Phase C code review rather than named here in advance.
  - *Lead side:* any post by a co-lead OR an admin moves `_rev`. The poster
    adopts the fresh revision; everyone else keeps a stale one, and their next
    save 409s into the reload banner. Before this child only setlist saves and
    admin transitions moved `_rev`; messages will be far more frequent.
  - *Admin side:* the fail-closed lock fires on `observedRev` drift, so a SECOND
    admin's chat message — or a lead's — disables Aprobar / Solicitar cambios /
    Reabrir even though nothing about the setlist under review changed.
  Both fail CLOSED, and both alternatives are worse: adopting a revision whose
  parent you never saw, or comparing content, which §5 rejects on evidence. The
  real fix is distinguishing "messages moved" from "content moved" — a separate
  revision for thread appends — and that is Child-B-sized, not this delivery's.
  **Named here so the team is told rather than surprised.**
- **Two tabs, one pre-deploy and one post-deploy**, let the old tab's stale
  `leadNotes` resurrect over a thread post — server-side indistinguishable from a
  deliberate edit. Short window; the one case §2's rule cannot tell apart.

---

## 2. `POST /api/me/proposals` — the submission note, and the two-part rule

`lead_notes` has a **second consumer**: `notifyProposalSubmitted` re-reads it off
the committed proposal for the "Nueva propuesta" admin email (`proposalNotify.ts:146`,
`proposalNotify.ts:184`). Today that value is what the lead typed into "Notas privadas para
revisión" with that submission (`ProposalEditor.tsx:714-720` → `:350` →
`route.ts:232`/`:264`).

**The textarea therefore survives this child, rendered only while no proposal
document exists.** Deleting it would empty that email *and* leave the lead with no
way to say anything on a first submission at all, since the thread composer needs
a document that does not exist yet.

**Client rule.** `save()` sends `leadNotes` **only when no proposal document
exists** — the payload field, not merely the rendering. Conditioning the render
alone makes the server rule below unsound.

**Server rule.** Append a `lead_note`, mirror it, and queue the notice **only when
`request.leadNotes` is non-empty AND differs (trimmed) from the stored
`lead_notes`.** Otherwise **omit `lead_notes` from the patch entirely** and append
nothing.

**Why each half is load-bearing:**

- `leadNotes` is a one-time initializer (`ProposalEditor.tsx:121`) re-sent verbatim
  on every save (`:350`). Harmless for a `set`; with an unconditional append, three
  draft saves mint three identical bubbles — permanent, no delete path.
- After the lead posts, the mirror moves stored `lead_notes`, so the editor's stale
  copy now *differs* — without the client half, the next save resurrects the
  pre-post note as a new message and mails it.
- "Write the newest lead message body" unconditionally **blanks** a document with a
  note and an empty `messages[]` (the newest body is `""`), reachable in the
  step 4 → step 8 window and after a per-document migration abort; and **silently
  reverts** a newer note written through old production code with the older
  migrated body — a class Phase D step 9's reconcile cannot detect, because it
  compares exactly those two values.
- A client loaded **before** this deploy still sends `leadNotes`
  (`ProposalEditor.tsx:711-725` renders on `!isApproved`; `:350` always sends). The
  "differs" test is what turns that into a real note instead of a discard.

**The submit email is byte-identical on a FIRST submission only.**
`notifyProposalSubmitted` fires on **every** save committed as `pending`
(`route.ts:298-304`), and a lead may re-save while `pending` or re-submit from
`changes_requested`. Later submissions carry the mirror — the newest thread
message, possibly older than this submission. **A Child-A-owned behaviour change,
accepted and named**, not a claim of byte-identity. The email still fires, to the
same audience, with the notes block it would have had.

---

## 3. Message shape

Shipped in Phase 1 on `setlistProposal`, after `team_notes`:

```
messages: array of object `proposal_message`
  _key        string    12 hex chars at runtime (`nextKey()`); the migration mints
                        `migleadnote01`/`migadminnote1` and a step-9 repair mints
                        `topup<n>` — deliberately non-hex, so they cannot collide
  _type       "proposal_message"
  author      reference → teamMembers, OPTIONAL
  author_role "lead" | "admin" | "pastor" | "system"
  kind        "lead_note" | "admin_change_request" | "pastor_note" | "system"
  body        text, ≤ PROPOSAL_NOTES_MAX (4000)
  at          datetime, server-minted
```

**`author` is a reference plus an `author_role` snapshot.** People on protected
documents here are references; names are denormalized only at projection time.
`author_role` is a fact about the message *when posted*, so an admin who later
becomes a member does not have their history re-render as a lead note. `author` is
optional because two production `admin_notes` have nobody to attribute them to.

`kind` and `author_role` reserve `pastor_note` and `system`, so routing "notas del
pastor" here later needs no migration. This child mints neither.

**`_type` is carried by both writers and cross-pinned — implemented in Phase A.**
`buildProposalMessage` shipped in Phase 1 without it; Phase A added
`PROPOSAL_MESSAGE_TYPE`, put `_type` on the interface and the returned object, and
made `scripts/__tests__/migrateProposalMessages.test.ts` **import
`buildProposalMessage` and compare the two key sets directly**, plus pin `_type`
against the name the schema gives the array item. Two suites each pinning their own
hardcoded list is what let `_type` ship on one side only with `npm test` green;
that arrangement is not a guard and is not used.

---

## 4. Write routes

| Route | Guard | Append |
|---|---|---|
| `POST /api/me/proposals/[id]/messages` | `requireMinistryMember("worship")`, caller ∈ `canonicalLeadRefs(role)`, **and** `role.published !== false` — both halves of `me/proposals/route.ts:127` — **plus `isThreadOpen(service_date)`** | `setIfMissing({messages: []})` + `append`, **no `ifRevisionId`** |
| `POST /api/admin/proposals/[id]/messages` | `requireActiveManager()`, `role !== "content-editor"`, **plus `isThreadOpen(service_date)`** | same |

**`isThreadOpen` is a GUARD, not just a UI state** (§7) — listed here so it is
implemented as one. A hidden composer is not a guard.

**The admin route mints `kind: "admin_change_request"`** — the only admin-facing
value the enum offers, since `pastor_note` and `system` are reserved and unminted
(§3). Note the consequence: an admin's *question* is stored as a change request and
Studio labels it "Cambios solicitados". Accepted for this child; a distinct
`admin_note` kind would be a schema change and belongs with pastor notes.

Both resolve through `loadCanonicalProposal`, are wrapped in
`withVerificationRunContext`, and declare `export const maxDuration = 60` like
their siblings — the lead route hosts the same `after()` fan-out, and
`commitUpserts` runs an inline sweep at roughly 14 s per send.

**No ministry check on the admin route, inherited deliberately** from the sibling
transition writer, so a kids-only `admin` can post into a worship thread. A new
writer stricter than the route beside it would give two answers to "can this admin
act on this proposal"; tightening both is `FrankERP/owt-kb-v1#8`.

**`setIfMissing` is mandatory on every appending patch.** Sanity requires the array
to exist (`node_modules/@sanity/client/README.md:1213-1218`; live precedent
`app/api/me/push-token/route.ts:19-23`). Without it the first message fails on
every proposal the migration does not touch and every proposal created later, and
inside the transition patch it fails the whole transaction so admins cannot request
changes at all. **Route tests here mock the Sanity patch chain**
(`notifPrefsRoute.test.ts:21-35`), so a mocked `append` succeeds regardless — the
test must assert the mutation chain itself.

**The create branch is different and needs no `setIfMissing`.** A first submission
goes through `tx.create` (`me/proposals/route.ts:250-268`), not a patch, so it mints
`messages: [msg]` directly in the created document when §2's textarea carried a note.

**Concurrency.** Standalone appends carry no revision precondition, so two
concurrent posts both land. Deliberately not read-modify-write.

**The transition appends inside its existing patch**, inheriting
`ifRevisionId(request.rev)` because the note is part of a reviewed decision:
`p.ifRevisionId(rev).set({status, admin_notes, reviewed_at, last_transition}).setIfMissing({messages: []}).append("messages", [msg])`.
The asymmetry with the chat routes is intentional and must be commented in code.

- **`reopen` with an empty note appends nothing** and still commits the status
  change — it legitimately sends none (`ProposalsPanel.tsx:143`, `:329`).
- **`reconcile_target` never appends.** Metadata repair, branched at `route.ts:491-503`.
- **The thread-open predicate does not gate the transition.** A `request_changes` on
  a past-dated service must still commit.
- **The transition is EXEMPT from `PROPOSAL_MESSAGES_MAX`** — a full thread must
  never block a review decision, and must never swallow one either: §6 replaces
  both `admin_notes` render blocks with `<ProposalThread>`, so a transition that
  committed without appending would leave the lead looking at `changes_requested`
  with no reason shown anywhere. **"Exempt from the cap" is not "always appends"** —
  the two rules above still hold: an empty `reopen` note and `reconcile_target`
  append nothing.

**Limits.** Body ≤ `PROPOSAL_NOTES_MAX` (`app/utils/proposalNotesLimit.ts`). Empty
or whitespace-only → `invalid_request` on the standalone routes. The 200 cap is
checked against the loaded document and is **racy by construction** — a growth
bound, not a security boundary. Say so in code.

**On duplicate proposals the message routes are deliberately laxer than the save
path**, which refuses an ambiguous group via `loadProposalGroup`
(`me/proposals/route.ts:138-145`). A message landing on the document the composer
renders is self-consistent, and refusing to let someone talk is worst exactly when
a duplicate needs discussing. A write to the wrong document is a lost setlist; a
message is not.

**Revalidation: none.** Both surfaces are already uncached
(`me/propose/[roleId]/page.tsx:8` is `revalidate = 0`; `/admin` is dynamic and
fetches client-side). `app/api/me/proposals/route.ts` calls no `revalidate*`
either; the admin route calls `revalidateProposalApproval()` only because approval
writes the live setlist, which backs ISR pages.

---

## 5. Revision handling

**`POST /api/me/proposals` returns the thread as well** — added in Phase C
because the editor swaps its textarea for the thread the moment it has a
`proposalId`, and its `messages` state predates that write, so a first
submission's note rendered "Aún no hay mensajes." until a hard reload. Its two
post-commit reads use `Promise.allSettled`, **not** `all`: they must degrade
independently, or a slow author-name join discards a good revision and raises a
false "otro líder actualizó" banner. And they stay TWO queries —
`canonicalProposalByIdQuery` + `pickUnique` returns null on a duplicate group,
while `THREAD_AFTER_APPEND_QUERY` ends in `[0]`. That is **convention rather than
a live hazard** — both filter `_id == $id`, so the duplicate branch cannot fire —
and merging them is a legitimate change that simply has to relocate `pickUnique`'s
protection rather than drop it.

**Residual, named not closed: the decoupling costs the first submission its own
note, on one narrow failure.** When the THREAD read alone rejects, the response is
a good `_rev` and `messages: null`, so the editor keeps editing rather than
reloading — and reveals a thread that is still empty, because its `messages` state
was initialized from props that predate this very write. "Aún no hay mensajes."
for a note that IS stored.

The coupled `Promise.all` version did not have this: it nulled both, and `_rev:
null` forced a reload that showed the message. **The trade is deliberate.** That
version paid for it on every slow author-name join, with a "otro líder actualizó
esta propuesta compartida" banner that is simply false — a frequent lie against an
infrequent omission. Nothing is lost either way, and the next save or reload
resolves it, because the post-commit reads run unconditionally rather than only
when a message was appended.

Closing it means either forcing the reload on `messages === null` **when the save
was a first create** (narrow, and re-introduces a reload the lead did not need) or
re-seeding `messages` from props on refresh — which is the same work the general
staleness below needs, and is not in this delivery.

**Both MESSAGE routes return `observedRev`** (the save route does not) — the revision read immediately **before**
their own append — alongside the fresh `_rev`.

**Response body:** the appended message and the full `messages[]` **with author
names resolved** — **or `messages: null`**, which is NOT an empty thread but
"the write committed and the read-back did not". Both clients treat `null` as
"keep what you are already rendering"; treating it as `[]` would blank a thread
on a transient read error. Added during Phase C: the unguarded version would have
reported a landed message as a failure, and the obvious retry would have minted a
permanent duplicate, since this delivery ships no delete path. It never reached
`preview` or `main` — the code review caught it on the branch, so no duplicate was
ever created. The projection is the same one
the surfaces use — not
`PROPOSAL_PROJECTION`'s bare `"author": author._ref`. The lead surface has no other
path to its own message (optimistic append is forbidden below, and
`setRev` + `router.refresh()` is rejected), so a bare `_ref` would re-render the
whole thread unattributed on a feature whose Outcome is an *attributed*
conversation. An inline GROQ on `setlistProposal` executed by `operationalClient`
is `compliant` (`protectedReadAudit.ts:880`), exactly as
`app/api/admin/proposals/route.ts:20-48` already is — the write is licensed by the
`PROTECTED_RUNTIME_WRITERS` entry, not by which query helper the read uses.

**No optimistic append.** A failed post that had already rendered would leave a
phantom message in a channel whose whole value is that nothing is lost.

### Admin panel

**A post does NOT call `load()`.** It patches that one record in `proposals` state
from the response, which carries the fresh `_rev`, `observedRev` and the resolved
`messages[]` — or `messages: null`, meaning the write committed and the read-back
did not, in which case the card keeps what it is already rendering. Everything a
re-render needs, including the case where there is nothing new to render.

**Why not `load()`, which an earlier draft prescribed:** `load()` begins with
`setLoading(true)` (`ProposalsPanel.tsx:389-390`) and the card list renders only
inside `{!loading && !error && (` (`:634`). **Every card therefore unmounts for the
duration of the fetch** — `key` preserves identity across renders where the list is
rendered, not across one where it is not. So every per-card `useState` resets:
`requestingChanges` (`:104`), `reopening` (`:105`), **`adminNotes` (`:106`)** and
`conflict` (`:110`).

Three consequences, all disqualifying:

- The `conflict` flag would be wiped by the remount, so the fail-closed lock this
  section justifies **would not exist**, and its Verification row could not tell a
  correct implementation from one where the banner never appears.
- **Every successful post would wipe an in-progress "Solicitar cambios" / "Reabrir"
  note in any open card, including the posting card's own.** That combination is
  new: today `handleAction` calls `load()` only on `res.ok` (`:508`), while the 409
  path returns `conflict` **without** calling it — deliberately, per the comment at
  `:108-109`: *"keep this card (and its open panel) exactly as it is"*.
- The whole list would flash to skeletons (`:610-616`) on every chat message.

**The banner.** Surface the existing "Propuesta actualizada — recarga"
(`:240-250`) only when `observedRev !== the _rev the card held` — i.e. something
other than this post moved the document between the card's render and the route's
read. Otherwise adopt silently. **Gating on the reloaded `_rev` would lock the
admin out of the card**, because the admin's own append always moves `_rev`, so
that condition is true after every admin message. The `conflict` flag disables
Aprobar (`:291`), Solicitar cambios (`:274`) and Reabrir (`:331`), and with the
patch-in-place approach it now genuinely persists until the panel unmounts.

**The justification is narrower than it looks.** With the record patched in place
the admin *is* looking at current content, so the lock is not "you were not shown
this" — it is a deliberate fail-closed on the fact that something else moved while
they were composing. Correct, but do not defend it with the stale-content argument.

**Residual, named not closed: `handleAction` still calls `load()` on a successful
transition** (`:508`), which remounts every card. Today that discards a half-typed
`adminNotes` in other open cards; with a composer in every card it now also
discards half-typed **thread** text. Pre-existing mechanism, newly widened by this
child. Closing it is the same work as making the refresh non-blanking, and it is
not in this delivery.

### Lead editor

**Adopt the fresh `_rev` only if `observedRev` equals the pinned `rev`.** Otherwise
keep the pin; the next save 409s into the existing reload banner.

**Why not a content comparison.** `POST /api/me/proposals` writes `songs`,
`status`, `lead_notes` **and** `team_notes` in one unconditional patch
(`route.ts:229-241`), and `teamNotes` (`ProposalEditor.tsx:122`) and `status`
(`:123`) are one-time lazy initializers just like `songs` (`:109-119`). So
"identical songs" proves only that songs did not move:

> Lead A renders at `R1` with `team_notes = "T1"` → co-lead B changes **only** the
> team message and saves → `R2`, songs unchanged → A posts → `R3` → A adopts → A
> saves → the patch writes `team_notes: "T1"` and **B's text is destroyed with no
> 409, no banner, no toast.** Today that save 409s. The admin variant needs no
> co-lead: `request_changes` sets `status` with songs untouched
> (`admin/proposals/[id]/route.ts:495-500`), so A's next "Guardar borrador"
> silently reverts `changes_requested → draft`.

**Why not a blanket pin either.** The lead's *own* post moves `_rev`, so pinning
unconditionally guarantees a 409 on their next save and a reload that discards the
in-progress setlist — on the feature's primary action.

**The same residual applies to the admin card, and there the consequence is an
approval.** Card at R1 → route reads R1 → a lead saves (R2) → the append commits
(R3) → `observedRev` R1 matches, so the card adopts R3 silently → *Aprobar* at R3
succeeds and publishes a setlist the reviewer never saw. Sub-second, and it needs a
concurrent lead save — but `parseProposalTransitionRequest`'s own doc-comment says a
server-fetched revision "would re-authorize a decision made against content the
reviewer never saw", so criterion 8's promise about approvals must be read with this
named. Closing it means conditioning the append, which reintroduces the 409 the
protocol exists to avoid.

`observedRev` establishes *nothing moved between the editor's render and the
route's read*. **That is slightly weaker than "before my append":** the append
carries no precondition, so a co-lead commit inside the read→commit window still
lets the editor adopt a revision whose parent it never saw. Milliseconds, and
conditioning the append would reintroduce the 409 it exists to avoid. Named, not
hidden.

**Also still true, and pre-existing:** an admin's post 409s every open lead editor,
and the "Recargar" path re-seeds `rev` but not `songs`/`status`/`teamNotes`. This
child makes it frequent. Closing it is the same work a live thread refresh needs.

---

## 6. Reads

| Site | Change |
|---|---|
| `serviceReadQueries.ts:33-43` (`PROPOSAL_PROJECTION`) | Add `messages[]{_key, _type, "author": author._ref, author_role, kind, body, at}`. Keep the legacy fields. **Payload note:** also backs `canonicalProposalsQuery()` → `publishReadyBundle.ts:147`, an ALL-proposals read on the service-readiness surface, so the worst case is ~800 KB × the catalog, not × 1. Nothing hashes or digests the projection, so it is payload-only. Irrelevant at 14 documents; revisit before the catalog grows |
| `app/api/admin/proposals/route.ts:20-49` | Add the projection **with a resolved author name**, following `"lead_name": coalesce(lead->alias, lead->member_name)` (`:35`) |
| `ProposalsPanel.tsx:43-45, 106, 225-237` | Type gains `messages`; the `lead_notes` and `admin_notes` blocks are **replaced by** `<ProposalThread>`. **Do NOT inherit their render conditions** (`{proposal.lead_notes && …}`, `{status === "changes_requested" && proposal.admin_notes && …}`) — the thread renders **unconditionally**, empty state included, or it would be invisible on a `pending` proposal, which is where the conversation actually happens. `team_notes` untouched. **`:106` seeds the change-request composer from `proposal.admin_notes` — seed it empty**, or an admin re-sends a stale legacy note as a new message |
| `me/propose/[roleId]/page.tsx:40-56` | Add messages with resolved author names |
| `ProposalEditor.tsx` | Type gains `messages`; the approved-state echo (`:734`, gated on `isApproved && leadNotes`) and the `admin_notes` banner (`:446`, gated on `changes_requested`) are **replaced by** an **unconditionally rendered** `<ProposalThread>` — same reason as above. **`teamNotes` untouched.** The "Notas privadas" textarea is retained but conditioned on `!proposalId` (§2) |
| `app/api/me/proposals/route.ts:56-62` | GET projection gains `messages` (no in-app consumer today; e2e only) |
| `app/(client)/me/page.tsx` | **Drop `admin_notes`** — projected and never rendered |
| `app/utils/interface.tsx` | Already carries `messages?` with optional `_type` (Phase A) |
| `protectedReadAudit.ts` | **No change to `PROTECTED_FIELDS`.** `messages` is a generic identifier matched by a word-boundary regex (`:729`), and the list's own comment (`:34-38`) excludes ambiguous names. It already omits `lead_notes`/`admin_notes` |
| `e2e/service-readiness/lib/dataset.ts:390-403` | `StoredProposal` and its projection gain `messages` |

---

## 7. UI

`app/components/ProposalThread.tsx`, shared by both surfaces:
`{messages, viewerId, viewerRole, onPost, posting, error}`.

- Chronological, sender-aligned, author name (or `Admin` when
  `author_role === "admin"` and `author` is absent — **key the fallback on the
  ROLE**, or a `lead_note` minted without an author renders as "Admin" in an
  audit-adjacent history), a timestamp, `whitespace-pre-wrap` body, composer below.
- **Timestamps follow the timezone invariant.** Any "Hoy"/"Ayer" is a calendar-day
  diff at local noon in `America/Mexico_City`; `message.at` is a full ISO datetime,
  so convert to a local calendar day first. Never bare `new Date(iso)`, never
  elapsed hours.
- **The composer closes when the SERVICE has passed**, not on approval —
  `isThreadOpen` (shipped): `service_date >= today` as a calendar-day string
  compare, failing closed on an unusable date because it authorizes a write. **Both
  routes enforce it server-side** — a hidden composer is not a guard. Past the date:
  read-only with `La conversación se cerró al pasar el servicio.`
- **No proposal document yet ⇒ no thread composer**; the §2 submission textarea
  stands in its place and the thread renders `Aún no hay mensajes.` Nothing is
  buffered client-side.
- **Colour:** lead bubbles `border-surface-accent-30` / `bg-accent/5` /
  `text-mono-300`; admin bubbles `border-negative-strong/30` /
  `bg-negative-strong/10` / `text-negative-muted`; timestamps
  `font-label text-[11px] uppercase tracking-widest text-mono-500`. Existing tokens
  only; `themeColour(rgbVar, alpha)` if alpha is needed — **never** string
  concatenation.
- **Toasts** via `useTransientValue`. Never a bare `setTimeout`.
- **Mutation handler** wraps `fetch` in try/catch/finally, checks `res.ok`, resets
  `posting` in `finally`, **never clears the composer on failure**.
- **Spanish:** `Conversación con los admins` / `Conversación con el líder`;
  `Aún no hay mensajes.`; `Escribe un mensaje…`; `Enviar`; `Enviando…`;
  `Error al enviar el mensaje`. No unread badge.
- **The admin `request_changes` composer stays as it is** — a decision, not a chat
  message. **One change: branch on `data.idempotent`** — which requires reading the response
  body, something `handleAction` does not do today (`:501-509` checks only
  `res.ok`). Note **`approve` returns it too** (`admin/proposals/[id]/route.ts:191`),
  not just `request_changes` (`:437`), so the branch covers both. A repeat with
  identical `adminNotes` is a no-write retry; show "sin cambios", not a success
  toast, or the admin believes a message was delivered that was not.

---

## 8. Migration — **Phase A, implemented and on `preview`**

`scripts/migrate-proposal-messages.mjs` + `scripts/lib/proposalMessages.mjs`,
dry-run by default, `--apply` to write.

**The `--apply` runs at exactly one point: Phase D step 4.** Nowhere else. Phase D
step 9 repairs by consented top-up, never by re-running it, and Phase E retires the
script behind `assertRetiredWriter`, which makes a re-run impossible.

**Safety, in order — the interlock is verified, not assumed:**

1. **Hard abort, per document, when `messages` is non-empty and carries no
   migration `_key`** — reported, not silently skipped.
2. **Skip when ANY key it would mint is already present** — some documents mint
   both, so a singular check would half-migrate one on a re-run.
3. **A patch decision reached with a non-empty array aborts as
   `partial_migration`.** *This corner was not in the pre-implementation plan and
   four review rounds missed it:* `messages[] === [migleadnote01]` on a document
   whose `lead_notes` was later blanked and whose `admin_notes` was written
   afterwards passes rule 1 (a migration key is present) and rule 2 (the other is
   not), and the whole-array `set` would drop the stored message. The precondition
   is now enforced rather than argued.
4. Given those, **`set` the whole array**.
5. **`ifRevisionId` on each patch; on mismatch abort that document, report it,
   continue** — do not retry. It *can* fire: production is live and any ordinary
   save or transition moves `_rev`.

**The projection reads `count(messages)` alongside `messages[]._key`.** GROQ does
**not** compact nulls — verified against the live API and `groq-js`:
`[{_key:"a"},{x:1},{_key:"b"}][]._key` returns `["a", null, "b"]`. The script's own
non-string filter is what empties the key list, so without the count a stored
keyless item would read as "empty, safe to overwrite".

**Field mapping**

| Source | `kind` | `author_role` | `author` | `at`, first available |
|---|---|---|---|---|
| `lead_notes` | `lead_note` | `lead` | `lead._ref` | `last_edited_at` → `submitted_at` → `_createdAt` |
| `admin_notes` | `admin_change_request` | `admin` | `last_transition.by` **only when `last_transition.action` is `request_changes` or `reopen`**, else absent | `last_transition.at` (same condition) → `reviewed_at` → `_updatedAt` |

- **The action condition** exists because `reconcile_target` writes
  `last_transition` without touching `admin_notes`, so a retarget after a change
  request would attribute one admin's note to another, permanently. `approve`
  writes no `last_transition` at all. The dry-run prints the resolved action per
  document so the decision is auditable before any write.
- **`last_transition.by` is a PLAIN STRING id, not a reference**
  (`proposalWriteRequest.ts:368`) — wrap it as `{_type: "reference", _ref: by}`.
  `lead._ref` already is one.
- **The stored body is TRIMMED** — the script builds every body through
  `trimmedString(...)`. This matters far beyond the script: **4 of the 8 documents
  to be patched carry trailing whitespace in `lead_notes` today** (measured
  2026-08-26), so any raw comparison against the stored legacy value flags half the
  migrated set. Phase D step 9 compares trimmed for exactly this reason, and §2's
  server rule already says "differs (trimmed)".
- Nothing resolves ⇒ **abort**, never store a half-formed message.
- **Order by `Date.parse(at)`, not lexicographically**, tie → lead first.
  `app/utils/proposalThread.ts:33-36` documents the rule for this same field: `at`
  is a full ISO datetime that may carry an offset, so a string compare orders
  `…T10:00:00-06:00` against `…T11:00:00Z` wrongly.
- Deterministic `_key`s `migleadnote01` / `migadminnote1`.
- **The migrated lead `at` may not be when the note was written.** `last_edited_at`
  moves on *any* save, including a songs-only one, so it is the newest fact about
  the proposal rather than about the note. On one production document it places the
  lead note after the admin's change request. No better source exists and the value
  is permanent; it is presented here as a best-available timestamp, not as the
  moment of writing.

**Client configuration:** `projectId`/`dataset` from `NEXT_PUBLIC_SANITY_*`;
`SANITY_API_READ_TOKEN` for the dry run and `SANITY_WRITE_TOKEN` for `--apply`;
`useCdn: false`; **`perspective: "published"` with an explicit
`!(_id in path("drafts.**"))` filter**. Its query fetches the five fields
`PROPOSAL_PROJECTION` omits.

**Failure reporting.** Distinguish failure kinds (`err?.name` / `err?.statusCode`)
rather than labelling everything a revision conflict, and tell the operator to
**re-run the dry-run before any repair** — a timeout can follow an accepted
mutation, so a reported abort does not prove the write did not land. A landed write
re-reads as `skip (already_migrated)`; a top-up applied to a falsely-reported abort
would duplicate the message permanently.

**One shape, two implementations, cross-pinned directly.**
`scripts/lib/proposalMessages.mjs` re-derives what `proposalMessageWrite.ts` owns —
a deliberate choice to keep a one-shot production writer's dependency surface
minimal, not a limitation (a `.mjs` script *can* import TS under `tsx`;
`scripts/requeue-setlist-notice.mjs:17-18` does). The test imports both and compares
their key sets.

**Figures are illustrative, never acceptance criteria.** Measured `production`
across three readings in two days: 14 documents throughout, but `lead_notes` 7 → 6,
both 3 → 2, minted 11 → 10, `changes_requested` 1 → 0. The last dry-run reports
**8 documents / 10 messages / 0 aborts / 0 already carrying `messages`**. Phase D
step 2 re-measures and the verification asserts against *that*.

---

## Phases

Every phase ends with `npx tsc --noEmit`, `npm test`, `npx eslint .` at 0 errors,
plus the check named.

### Phase A — Migration script, dry-run only ✅ IMPLEMENTED (on `preview`, `f1ebdf13`)

Script, pure lib, `OPERATOR_TOOLING_ALLOWLIST` registration (`protectedReadAudit.ts:346`,
exact list pinned at `protectedReadAudit.test.ts:484-497`) — **not**
`RETIRED_ONE_SHOT_WRITERS`, which fails closed. 30 unit tests plus the cross-writer
comparison. Two code reviews; the second confirmed no data-safety blocker.

### Phase B — Rehearsal ✅ RUN 2026-08-26

**Result: identical to Phase A.** 8 documents with non-empty legacy notes, 10
messages implied, 8 to patch, 0 skipped, **0 aborted** — and the three counters that
must be zero are zero: documents already carrying `messages[]`, documents carrying a
migration `_key`, and aborts. Dry-run; the script defaults to the **read** token and
`--apply` was not passed.

The section below says to *expect* a difference and to check that it is explicable.
There is none, which is the trivial pass — production has not moved since Phase A
read it. **What this actually compares:** Phase A's per-document detail was never
recorded anywhere diffable, so this is a comparison of the counts and the abort
total, not of the ten individual messages. Phase D step 3 has the same limit and is
where it gets closed, by reading the fresh diff line by line.

Three facts carried into Phase D, all already handled by the script:
- **Two documents resolve no author** — the message is written with no `author`
  reference rather than a malformed one.
- **One document is a `draft`**; 13 are `approved`; **zero are `pending` or
  `changes_requested`**, which is the same measurement Child B's criterion 1 rests
  on when it says no acceptable manual check reaches the debounced-email path.
- **One `admin_notes` is a single character** (`"A"`), which migrates to a
  one-character message. Not an abort, and not repairable by this delivery — there
  is no edit or delete path.

The per-document output is **deliberately not committed**: it carries real note
bodies and member ids, and this repository is public.

### Phase B — Rehearsal (the standing instruction)

Re-run the dry-run and diff against Phase A's output. **Expect a difference** —
production moved across all three prior readings (§8), so a change is routine and
the check is that it is *explicable* (a note edited, a proposal transitioned), not
that it is absent. A change you cannot explain is the stop signal. **No `--apply`.**

### Phase C — The cutover (one deploy)

- Both message routes (§4), with `setIfMissing`, `loadCanonicalProposal`,
  `withVerificationRunContext`, `maxDuration`, `observedRev`, and the resolved-name
  response of §5.
- The transition appends its message; `reopen`-empty and `reconcile_target` append
  nothing; the transition is exempt from the cap.
- **`POST /api/me/proposals`** per §2 — the client rule, the server rule, and the
  retained submission textarea.
- **The mirror** per §1: the lead messages route always mirrors (its body can never
  be empty); the save route's compat path mirrors conditionally; **the transition,
  and only the transition, mirrors `admin_notes`**.
- Reads (§6) and UI (§7).
- Register both writers in `PROTECTED_RUNTIME_WRITERS` and move the count test's
  title from fourteen to sixteen (`protectedReadAudit.test.ts:387`).
- **Caveat:** e2e fixtures still assert `admin_notes` until Phase E, so this phase
  is deployable against vitest but not the e2e suites.

### Phase D — Release

1. Gates green, then a **fresh code review of `main...feature`** — the range the PR
   merges. Do not "merge to `main` locally": it is protected with
   `enforce_admins: true` (`docs/CI.md`). Fix, **re-verify the fix**.
2. **Re-measure:** documents with non-empty legacy notes and the count they imply;
   documents already carrying `messages` (**expect 0** — non-zero means a write path
   shipped early, stop for a human); documents carrying a migration `_key` (expect 0).
3. Read the fresh dry-run diff line by line.
4. **Frank's explicit consent in chat**, then `--apply`. **The only `--apply`.**
5. Re-read the patched documents and confirm the count step 2 predicted — never a
   hard-coded number — with correct `_key`, `_type`, `kind`, `author_role`, `at`,
   and a resolvable `author` where present. **If it does not match, STOP: do not
   proceed to step 6.** The legacy fields are untouched, so the safe response is to
   leave production on the old code and diagnose. Shipping the cutover over a
   partial migration is what makes step 9 a repair job instead of a check.
6. Merge into `preview`, push, **verify the dev alias and `githubCommitSha`**.
7. PR to `main`, wait for `gates`, merge.
8. Verify the production alias.
9. **Reconcile.** Re-read all proposals and compare each `lead_notes` /
   `admin_notes` against its migrated message, **on TRIMMED values** — the
   migration stores a trimmed body (§8), and 4 of the 8 documents carry trailing
   whitespace, so a raw comparison flags half the set as damaged the moment the
   `--apply` finishes. **Those four are the expected baseline, not repair cases.**
   **Compare emptiness too** — a field blanked to `""` would be skipped by a
   non-empty-only comparison. **And flag a non-empty legacy field with NO message
   at all**: a proposal created or edited by old production code inside the step
   4 → 8 window carries one, and §6 removes the render block that showed it, so it
   becomes invisible to admins.

   **Compare against the newest message in that direction, not against
   `migleadnote01` specifically.** From step 8 the mirror is live, so `lead_notes`
   legitimately holds the newest *posted* message — a lead who posts between steps
   8 and 9 would otherwise read as a mismatch and draw a permanent top-up.

   Repair by **consented top-up** with a distinct `_key` (`topup<n>`), never by
   re-running the migration, and **only when no message in that direction carries
   the legacy text at all**. **A top-up is irreversible and visible** — it lands at
   the end of the thread carrying the top-up's own `at`, so it reads as a fresh
   repeat of an old note to both the lead and the admins, and this delivery ships
   no edit or delete path. Never top up a difference that is whitespace only.

**The residual window is step 4 → step 8**: a preview verification and a PR gate,
roughly ten to twenty minutes. **Do not exercise the thread on `preview` until step
8 completes** — because posting there writes REAL production data through code the
team is not yet running, so a message would appear in a thread nobody can see and
`lead_notes` would move under the old UI.

*(The stale-notice hazard an earlier draft gave as the reason does NOT apply to this
child: §1 modifies no `app/utils/outbox*` file and the mirror is exactly what keeps
the old notice shape valid. That hazard is Child B's.)*

**Consequence to accept deliberately: the only end-to-end human walkthrough happens
AFTER the production release**, since steps 7–8 are the release. The gates, the
Verification table and the dry-run are what stand between the code and the team.

**The `preview` walkthrough happens after step 8**, and it writes REAL data: no
edit or delete path exists, so every test message is permanent and visible to the
team. Name the target proposal in advance — and note that **`isThreadOpen` leaves
only the future-dated proposals writable**. At the last measurement exactly one of
the fourteen qualified; the other thirteen render read-only. Check which ones
qualify at walkthrough time rather than discovering it with the composer
disabled.

### Phase E — Docs, ADRs, e2e

- `docs/DATA_MODEL.md`; `docs/API_REFERENCE.md` (+ rows for the two routes, stating
  the transition-fingerprint field list is unchanged);
  `docs/UTILITIES_AND_COMPONENTS.md` (+ `ProposalThread`); a forward pointer at
  `docs/superpowers/specs/2026-07-03-shared-setlist-proposals-design.md:83`;
  update `docs/SOLVER_AND_INFRA.md`'s migration row to record that `--apply` ran.
- **ADR-0023** — why `APPROVAL_RECEIPT_VERSION` / `APPROVAL_APP_MARKER` were
  deliberately not bumped. Link from `proposalWriteRequest.ts:173-176`.
- **ADR-0024** — why read state is deferred and must never live on
  `setlistProposal` or `teamMembers`.
- e2e: `proposal-lifecycle.spec.ts:104`, `zero-delivery.spec.ts:64`,
  `lib/dataset.ts:390-403`, `scripts/lib/sr-verification.mjs:938`.
- **Retire the migration script**: `assertRetiredWriter` at the top, move from
  `OPERATOR_TOOLING_ALLOWLIST` to `RETIRED_ONE_SHOT_WRITERS`, and update
  `scripts/lib/sr-retired-writer.mjs`'s `RETIRED_WRITERS` and the "six retired
  one-shot writers" title, which are pinned equal.

---

## Acceptance criteria

1. Every message ever posted is retrievable; none is overwritten.
2. **Every document carrying legacy notes at the Phase D step 2 re-measure** has
   them as messages, with the count that re-measure predicted — never a hard-coded
   number.
3. **`lead_notes` is never blanked to `""` on a document that carried a value.** Its
   value is either its pre-migration value or a mirror write carrying a real message
   body. (A proposal created later whose lead writes nothing legitimately has `""`;
   this is about erasure, not emptiness.)
4. `admin_notes` likewise, **with one behaviour change this child makes and
   accepts**: seeding the change-request composer empty (§6) means a note-less
   `reopen` now blanks it, where today the composer re-sends the stored value. The
   empty seed is right — it stops a stale legacy note being re-minted as a fresh
   bubble — and the blanking is harmless because the content lives in `messages[]`
   and `admin_notes` has no notification consumer.
5. **The debounced admin email fires on the same occasions it fires today, same
   audience, same debounce, same preference key — with ONE named exception.** A
   pre-deploy client that *clears* the textarea (`"X" → ""`) queues a notice today
   and will not after this child, because §2's server rule requires a non-empty
   value. That is an existing signal retired, not a new gap, and the parent's
   invariant 8 does not permit retiring one silently — so it is recorded here and
   in the parent's coverage table rather than hidden in a gap list.

   **Do not "fix" this by making the empty case queue.** §1 explains why: a notice
   with an empty body mints a spurious document and resets `servedRecipients`
   (`outboxNotice.ts:147-153`), degrading the real debounce. The alternative — letting
   an empty payload field through — is what criterion 3 exists to prevent.
6. **The "Nueva propuesta" submit email always fires**, to the same audience, with
   the notes block it would have had — subject to the first-submission scope in §2.
7. No file under `app/utils/outbox*` or `proposalNotify.ts` is modified, **and
   neither's INPUT changes except as criteria 5 and 6 name.** An unmodified file
   fed an emptied field is still a regression — but `proposalNotify`'s input *does*
   change from the second submission onward (§2), and that is the accepted,
   named exception rather than a violation. Read 7 through 5 and 6, never alone.
8. **A post never enables an approval or a save against content the actor was not
   shown, on the paths the Verification table exercises.** Two residual windows are
   named in §5 and deliberately not closed here.
9. `team_notes` behaviour is unchanged end to end.

---

## Verification

Each row names the **rule it enforces** rather than restating it — the restating is
what let four rounds of contradictions through.

| Enforces | Test | Failure it detects |
|---|---|---|
| §4 `setIfMissing` | `proposalMessageRoutes.test.ts` + `proposalWriteRoutes.test.ts` — assert the MUTATION CHAIN, not a 200 | The first message failing silently; a first-time `request_changes` rolling back its status change |
| §2 server rule, omit half | `proposalWriteRoutes.test.ts` — a new-bundle save (no `leadNotes` in the payload) omits `lead_notes` from the patch and appends nothing; a document with a pre-existing value comes back byte-unchanged | Blanking the archive Child A's own rollback depends on |
| §2 server rule, differs half | `proposalWriteRoutes.test.ts` — a repeated save carrying the same `leadNotes` appends nothing; one carrying a DIFFERENT `leadNotes` appends and queues | Three identical bubbles from three draft saves; or a pre-deploy client's note discarded behind a success toast |
| §2 client rule | mount test — post a message, then save; nothing is appended and no notice is queued | The stale `leadNotes` resurrecting the pre-post note on every post-then-save cycle |
| §1 mirror keeps the email | `setlistNoticeQueueing.test.ts` — a lead message on a `pending` proposal produces an outbox document of the same shape as today's | Silently retiring the notification this child promises not to touch |
| §2 submit email | `proposalNotify.test.ts` — a first submission carrying the textarea's text produces an email whose notes block is that text | A first submission mailing admins with no notes |
| §5 lead adoption | mount test — a co-lead changes only `team_notes`, then the lead posts and saves; the save must **409** | `observedRev` degenerating to a content comparison and losing a co-lead's change |
| §5 lead adoption, own post | mount test — post with no other activity, then edit songs and save; the save must **succeed** | The pin discarding the lead's in-progress setlist on the feature's primary action |
| §5 admin banner | panel mount test — post, then transition; the transition must succeed and no banner appears | The `conflict` flag locking the admin out of the card after their own message |
| §5 resolved names | `proposalMessageRoutes.test.ts` — the response's messages carry author names | The thread re-rendering unattributed after a post |
| §4 `reopen` empty | `proposalWriteRoutes.test.ts` | A blank bubble on every note-less reopen |
| §4 transition exempt from the cap | `proposalWriteRoutes.test.ts` — a `request_changes` on a 200-message thread still appends | A change request whose reason exists nowhere the lead can see |
| §7 idempotent 200 | panel mount test — a 200 with `idempotent: true` renders no bubble and no success toast | Presenting a no-write retry as a sent message |
| §7 service-date gate | `proposalThread.test.ts` (shipped) + `proposalMessageRoutes.test.ts` — an approved future service accepts; a past-dated one is rejected server-side | A chat read-only on most real proposals, or a client-only gate |
| §3 one shape | `migrateProposalMessages.test.ts` — imports `buildProposalMessage` and compares key sets directly, and pins `_type` to the schema's item name | The two writers diverging with both suites green, as `_type` already did |
| §8 interlocks | `migrateProposalMessages.test.ts` — a live thread aborts; a partial migration aborts; a re-run patches nothing | A whole-array `set` erasing real messages |
| §4 guards | `proposalMessageRoutes.test.ts` — non-lead, `content-editor`, **and a lead whose role is `published: false`** all rejected | An ACL hole on a new writer; the `published` half silently dropped |
| §6 the thread renders at all | mount tests, both surfaces — a `pending` proposal with an empty `messages[]` shows the thread and its empty state | Inheriting the old blocks' render conditions and leaving the thread invisible in the status where the conversation happens |
| §1 the standalone admin route leaves `admin_notes` alone | `proposalMessageRoutes.test.ts` — an admin message's patch has no `admin_notes` key | Admin chatter overwriting the change-request archive the rollback leans on |
| §4 replay | `proposalWriteRoutes.test.ts` — replay a committed `request_changes`, `messages.length` unchanged | The append escaping the `no_write_retry` guard |
| Frozen digests | `proposalWriteRequest.test.ts` (shipped) | Any change to the fingerprints or their constants |
| roadmap invariant 4 (`team_notes`) | existing approval assertions | Folding team notes into the thread |

**Suites that will break:** `proposalWriteRoutes.test.ts`,
`proposalMessageWrite.test.ts`, `protectedReadAudit.test.ts`,
`setlistNoticeQueueing.test.ts`, `proposalNotify.test.ts`. E2E:
`proposal-lifecycle.spec.ts`, `zero-delivery.spec.ts`, `lib/dataset.ts`.

---

## Safe ending state and rollback

**Safe ending state:** the thread is the visible record. `lead_notes` is a
maintained mirror of the newest **lead message**. **`admin_notes` is NOT the
newest admin message** — §1 mirrors it from the transition only, so it holds the
newest **change request**. Every notification behaves as before, except the one
criterion 5 names.

**Rollback: revert the code.** The legacy fields were never stopped, so they are
current — not stale — and the reverted UI reads them as authoritative. `messages[]`
becomes inert; no data is destroyed and no recovery script is needed.

**What revert costs, stated precisely:** the *history* collapses back to one value
per direction. For the lead that is today's behaviour — the newest note. **For the
admin side it is worse than today**: every standalone admin message becomes
invisible, and the lead sees the newest *change request*, which may be much older
than the conversation that followed it. That asymmetry follows from §1 mirroring
`admin_notes` only on transitions, and it is the price of not letting admin chatter
overwrite the change-request archive.

**Partial failure:** the transition's `set` + `append` are one patch in one
transaction; a standalone post is one patch; the migration aborts per document
rather than half-writing.

**A message append can 409 an in-flight publish-ready transaction**
(`publishReadyTransaction.ts:70-72`). It fails closed, and is far rarer than the
read-mark case that argument ruled out — a message is a deliberate act, a read is
not.

## Outputs for Child B

- `messages[]` populated and live; the thread is the record.
- Mirrors maintained, so Child B's first act is removing a shim rather than
  building a bridge.
- `queueLeadNotesNotice` still on its original signature, called from a known set of
  sites.

## Open questions

None blocking. `FrankERP/owt-kb-v1#8` (ministry-scoping the notification audience)
is an independent delivery this child neither fixes nor worsens.

## Terminal state

`APPROVED — NOT AUTHORIZED TO IMPLEMENT`. Phases B–E have their two sequential
approvals on digest `5713a9cc…`; the text has since gained un-reviewed non-blocking
edits (see the review log). Each phase still needs its own fresh code review of the
diff plus the gates, and Phase D's `--apply` needs Frank's explicit consent at the
moment it runs.
