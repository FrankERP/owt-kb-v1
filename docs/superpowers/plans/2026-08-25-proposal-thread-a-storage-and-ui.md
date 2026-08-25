# Child A — The thread: storage, migration and UI

Parent: [`2026-08-25-proposal-thread-roadmap.md`](2026-08-25-proposal-thread-roadmap.md).
Contracts of reused helpers:
[`2026-08-24-proposal-message-thread.md`](2026-08-24-proposal-message-thread.md)
§"Contracts of what this plan reuses" — **normative, cited not restated**.

**Risk tier: CRITICAL.** Data migration against the single production dataset,
two new production writers, and a concurrency-protocol change on an existing
guarded writer. Two sequential fresh `APPROVED` verdicts required.
**This document authorizes nothing.**

## Outcome

A `setlistProposal` carries an append-only, attributed, timestamped conversation
between its lead and the admins. Nothing is ever overwritten. Both surfaces
render the full history and can post to it.

**Operator/user:** worship leads and `admin`/`super-admin` reviewers.

## Current behaviour and the gap

Three independent `text` fields hold notes (`sanity/schemas/setlistProposal.ts:151-169`).
`lead_notes` and `admin_notes` are single-valued, so each new note **destroys the
previous one** — the history the user asked for does not exist. `team_notes` is a
different thing (the whole team sees it) and is out of scope.

`messages[]` is already declared and deployed to the Content Lake, and two pure
modules exist, but nothing reads or writes the field.

## Scope

### In

- Migration of `lead_notes` / `admin_notes` into `messages[]`.
- `POST /api/me/proposals/[id]/messages` and `POST /api/admin/proposals/[id]/messages`.
- The admin transition appends its change-request as a message.
- `_type: "proposal_message"` added to `buildProposalMessage` and its test.
- Reads and projections carrying `messages`.
- `app/components/ProposalThread.tsx` on both surfaces.
- **Mirroring `lead_notes` / `admin_notes` so that no notification changes.**

### Out — and these belong to Child B

- Any change to `app/utils/outbox*`, `proposalNotify.ts`, or
  `queueLeadNotesNotice`'s **signature**.
- Any new push.
- Removing the mirror.

### Explicitly not in this delivery at all

Unread indicators; pastor notes; unsetting the legacy fields; editing or deleting
a message.

## The mirror — the device that keeps this child notification-free

**Rule.** Every write that appends a lead message also `set`s `lead_notes` to that
message's body; every write that appends an admin change-request also `set`s
`admin_notes` to its body, exactly as the transition does today. The lead messages
route then calls **`queueLeadNotesNotice` with its existing, unmodified signature**
(`serviceMutationSideEffects.ts:614`, `:629` — both exported), passing
`beforeNotes` = the stored `lead_notes` captured PRE-COMMIT and `afterNotes` = the
new message body.

**Consequence, which is the entire point:** the existing debounced admin email
fires on exactly the occasions it fires today, to the same audience, with the same
debounce and the same preference key, and **this child modifies no file under
`app/utils/outbox*`**.

**What is a new gap rather than a regression, and is accepted here:** an admin
posting a *standalone* message notifies nobody. No such feature exists today, so
nothing is lost — but the admin half of the conversation is invisible until the
lead opens the proposal. Child B closes it with a push. This is named because
invariant 8 of the parent forbids silent regressions and requires new gaps to be
stated.

**The mirror is lossy on purpose.** `lead_notes` holds only the newest lead
message. That is precisely what it holds today, which is why the notification is
unchanged. The thread is the record; the mirror is a shim with one release to live.

## Design

### Message shape

Per the parent's shipped schema. **`buildProposalMessage` must gain
`_type: "proposal_message"`** — it shipped without it
(`app/utils/proposalMessageWrite.ts`) and `proposalMessageWrite.test.ts` pins that
shape, while every other array-of-object write on this document carries a `_type`
(`proposal_song`, `contributor`). The migration writes the same field. Otherwise
migrated items carry `_type` and runtime items do not: permanently heterogeneous,
half of it written irreversibly.

### Write routes

| Route | Guard | Append |
|---|---|---|
| `POST /api/me/proposals/[id]/messages` | `requireMinistryMember("worship")`, caller ∈ `canonicalLeadRefs(role)`, **and** `role.published !== false` — both halves of `me/proposals/route.ts:127` | `setIfMissing({messages: []})` + `append`, **no `ifRevisionId`** |
| `POST /api/admin/proposals/[id]/messages` | `requireActiveManager()` **and** `role !== "content-editor"` | same |

Both resolve through `loadCanonicalProposal`, are wrapped in
`withVerificationRunContext`, declare `export const maxDuration = 60` like their
siblings, and share `app/utils/proposalMessageWrite.ts`.

**`setIfMissing` is mandatory on every appending patch.** Sanity requires the array
to exist (`node_modules/@sanity/client/README.md:1213-1218`; live precedent
`app/api/me/push-token/route.ts:19-23`). Without it the first message fails on
every proposal the migration does not touch and on every proposal created later,
and inside the transition patch it fails the whole transaction so admins cannot
request changes at all. **Route tests here mock the Sanity patch chain**
(`notifPrefsRoute.test.ts:21-35`), so a mocked `append` succeeds regardless — the
test must assert on the mutation chain itself.

**Concurrency.** Standalone appends carry no revision precondition, so two
concurrent posts both land. Deliberately not read-modify-write, which would either
409 or drop the loser.

**The transition appends inside its existing patch**, inheriting
`ifRevisionId(request.rev)` because the note is part of a reviewed decision:
`p.ifRevisionId(rev).set({status, admin_notes, reviewed_at, last_transition}).setIfMissing({messages: []}).append("messages", [msg])`.
The asymmetry with the chat routes is intentional and must be commented in code.

- **`reopen` with an empty note appends nothing** and still commits the status
  change — it legitimately sends none (`ProposalsPanel.tsx:143`, `:329`).
- **`reconcile_target` never appends.** Metadata repair, already branched at
  `route.ts:491-503`.
- **The thread-open predicate does not gate the transition.** A `request_changes`
  on a past-dated service must still commit.
- **`PROPOSAL_MESSAGES_MAX = 200` applies to the standalone routes only.** A full
  thread must never block a review decision; the transition commits and appends
  nothing.

**Limits.** Body ≤ `PROPOSAL_NOTES_MAX` (`app/utils/proposalNotesLimit.ts`). Empty
or whitespace-only → `invalid_request` on the standalone routes. The 200 cap is
checked against the loaded document and is **racy by construction** (two concurrent
posts at 199 both land) — a growth bound, not a security boundary. Say so in code.

**On duplicate proposals the message routes are deliberately laxer than the save
path**, which refuses an ambiguous group via `loadProposalGroup`
(`me/proposals/route.ts:138-145`). A message landing on the document the composer
is rendering is self-consistent, and refusing to let someone talk is worst exactly
when a duplicate needs discussing. A write to the wrong document is a lost setlist;
a message is not.

### Revision handling — different per surface, and that is the point

**Admin panel: refresh content and revision together.** After a successful post,
`ProposalsPanel` calls `await load()`, which replaces the whole record
(`:508` → `:395`) and re-renders the card from props.

**Lead editor: adopt nothing.** The route returns no `_rev` to it; `rev` stays
pinned to what the editor rendered from, so a concurrent co-lead save still 409s
into the existing reload banner.

**Why the surfaces differ.** `_rev` on the admin transition is not a staleness
token — it is an **attestation that the admin saw this content**. The route says
so (`app/api/admin/proposals/[id]/route.ts:63-67`): *"a freshly fetched server
revision is never a substitute, because it would re-authorize a decision made
against content the reviewer never saw."* Approve publishes the **stored** songs
(`:164`) with no client content fingerprint, so the revision is the only thing
binding the decision to what was on screen.

- **Admin, if a bare `_rev` were adopted:** admin renders at rev A → lead saves a
  different setlist → rev B → admin posts a question → adopts rev C → *Aprobar*
  **passes** and publishes songs the admin never reviewed. `await load()` prevents
  it because content arrives with the revision.
- **Lead, if `setRev` + `router.refresh()` were used:** `rev` tracks the prop
  (`ProposalEditor.tsx:162-163`) but `songs` (`:109-119`) and `teamNotes` (`:122`)
  are one-time lazy initializers with no prop-driven setter, and
  `router.refresh()` preserves client state by design (see the comment at
  `:158-161`). So the revision would advance without the content: lead A at R1 →
  co-lead B saves different songs → A posts → adopts R3 → A saves →
  `compareObservedTarget` returns `null` (success) and the patch **overwrites B's
  setlist with no 409, no banner and no toast.** Today it 409s.

**The cost of pinning, stated honestly:** a lead who posts mid-edit 409s on their
next save and must use the existing "Recargar" banner, losing unsaved song
changes. That is the correct trade — a 409 is visible and recoverable; a silent
overwrite of a co-lead's setlist is neither. The composer should disable or warn
while the editor has unsaved changes.

**Response shape.** The appended message and the full `messages[]`, read back
through `operationalClient`. **No optimistic append** — a failed post that had
already rendered would leave a phantom message in a channel whose whole value is
that nothing is lost.

**Revalidation: none, deliberately.** Both surfaces are already uncached
(`me/propose/[roleId]/page.tsx:8` is `revalidate = 0`; `/admin` is dynamic via
`requireActiveManager()` and fetches client-side). `app/api/me/proposals/route.ts`
calls no `revalidate*` either; the admin route calls `revalidateProposalApproval()`
only because approval writes the live setlist, which backs ISR pages.

### Migration

`scripts/migrate-proposal-messages.mjs` + `scripts/lib/proposalMessages.mjs`,
dry-run by default, `--apply` to write, run as
`node --env-file=.env.local scripts/migrate-proposal-messages.mjs [--apply]`.

**The `--apply` runs at exactly one point: Phase D step 4.** Nowhere else.

1. **Refuse to write, per document, whenever `messages` is already non-empty and
   carries no migration `_key`** — a reported hard abort, not a silent skip.
2. Given that interlock, **`set` the whole array**: every target's array is absent
   or empty, so ordering the (at most two) minted messages in JS and writing one
   `set` is the simplest correct thing and needs no anchor semantics.
3. Mint deterministic `_key`s `migleadnote01` / `migadminnote1` and **skip a
   document when ANY key it would mint is present** — 3 production documents mint
   both, so a singular check would half-migrate one on a re-run.

| Source | `kind` | `author_role` | `author` | `at`, first available |
|---|---|---|---|---|
| `lead_notes` | `lead_note` | `lead` | `lead._ref` | `last_edited_at` → `submitted_at` → `_createdAt` |
| `admin_notes` | `admin_change_request` | `admin` | `last_transition.by` when present, else **absent** | `last_transition.at` → `reviewed_at` → `_updatedAt` |

Those fallback fields are **not** in `PROPOSAL_PROJECTION`; the script issues its
own query. Order by resolved `at` ascending, lead-first on a tie.

**One shape, two implementations.** `scripts/lib/proposalMessages.mjs` re-derives
what `proposalMessageWrite.ts` owns, because a `.mjs` script cannot import the TS
module. Nothing makes them agree at compile time — assert the same field set,
including `_type`, in both test files.

**Figures are illustrative, never acceptance criteria.** Measured `production`:

| | 2026-08-24 | 2026-08-25 |
|---|---|---|
| documents | 14 | 14 |
| `lead_notes` | 7 | 7 |
| `admin_notes` | 3 | **4** |
| both | 2 | **3** |
| ⇒ patched / minted | 8 / 10 | **8 / 11** |
| `admin_notes` with no attributable author | 2 of 3 | **2 of 4** |
| in `changes_requested` | 0 | **1** |

One day moved the message count. Phase D step 2 re-measures and the verification
asserts against *that*.

### Reads

| Site | Change |
|---|---|
| `serviceReadQueries.ts:33-43` (`PROPOSAL_PROJECTION`) | Add `messages[]{_key, "author": author._ref, author_role, kind, body, at}`. Keep the legacy fields. **Payload note:** this also backs `canonicalProposalsQuery()`, an all-proposals read; worst case adds ~800 KB per document. Irrelevant at 14, revisit before the catalog grows |
| `app/api/admin/proposals/route.ts:20-49` | Add the projection with a resolved author name, following `"lead_name": coalesce(lead->alias, lead->member_name)` (`:35`) |
| `ProposalsPanel.tsx:43-45, 106, 225-237` | Type gains `messages`; the `lead_notes` and `admin_notes` blocks become `<ProposalThread>`; `team_notes` untouched. **`:106` seeds the change-request composer from `proposal.admin_notes` — seed it empty** |
| `me/propose/[roleId]/page.tsx:40-56` | Add messages with resolved author names |
| `ProposalEditor.tsx` | Type gains `messages`; the "Notas privadas" textarea and the approved-state echo become `<ProposalThread>`; the `admin_notes` banner is subsumed. **`teamNotes` untouched.** The editor stops sending `leadNotes`; `parseProposalSaveRequest` keeps accepting it |
| `app/api/me/proposals/route.ts:56-62` | GET projection gains `messages` (no in-app consumer today; e2e only) |
| `app/(client)/me/page.tsx` | **Drop `admin_notes`** — projected and never rendered |
| `protectedReadAudit.ts` | **No change.** `messages` is deliberately not in `PROTECTED_FIELDS`: word-boundary regex (`:729`), and the list's own comment (`:34-38`) excludes ambiguous names |
| `e2e/service-readiness/lib/dataset.ts:390-403` | `StoredProposal` and its projection gain `messages` |

**`POST /api/me/proposals` keeps writing `lead_notes` — the mirror.** It writes the
newest lead message body rather than a removed form field. It does **not** stop
writing it in this child; that is Child B, and doing it here would silently retire
the existing email.

### UI

`app/components/ProposalThread.tsx`, shared by both surfaces:
`{messages, viewerId, viewerRole, onPost, posting, error}`.

- Chronological, sender-aligned, author name (or `Admin` when `author` is absent
  on a migrated message), timestamp, `whitespace-pre-wrap` body, composer below.
- **Timestamps follow the timezone invariant.** Any "Hoy"/"Ayer" is a calendar-day
  diff at local noon in `America/Mexico_City`; `message.at` is a full ISO datetime,
  so convert to a local calendar day first. Never bare `new Date(iso)`, never
  elapsed hours.
- **The composer closes when the SERVICE has passed**, not on approval —
  `isThreadOpen` (shipped): `service_date >= today` as a calendar-day string
  compare, failing closed on an unusable date because it authorizes a write.
  **Both routes enforce it server-side** — a hidden composer is not a guard. Past
  the date: read-only with `La conversación se cerró al pasar el servicio.`
- **No proposal document yet ⇒ disabled composer** with
  `Guarda la propuesta para empezar la conversación.` A real narrowing (today a
  lead can type notes before the first save), accepted because buffering an unsent
  message client-side is the phantom failure the response shape rejects.
- **Colour:** lead bubbles `border-surface-accent-30` / `bg-accent/5` /
  `text-mono-300`; admin bubbles `border-negative-strong/30` /
  `bg-negative-strong/10` / `text-negative-muted`; timestamps
  `font-label text-[11px] uppercase tracking-widest text-mono-500`. Existing
  tokens only; `themeColour(rgbVar, alpha)` if alpha is needed — **never** string
  concatenation.
- **Toasts** via `useTransientValue`. Never a bare `setTimeout`.
- **Mutation handler** wraps `fetch` in try/catch/finally, checks `res.ok`, resets
  `posting` in `finally`, **never clears the composer on failure**.
- **Spanish:** `Conversación con los admins` / `Conversación con el líder`;
  `Aún no hay mensajes.`; `Escribe un mensaje…`; `Enviar`; `Enviando…`;
  `Error al enviar el mensaje`. No unread badge.
- **The admin `request_changes` composer stays as it is** — it is a decision, not a
  chat message. **One change: branch on `data.idempotent`**, which the route
  already returns (`admin/proposals/[id]/route.ts:437`). A repeat with identical
  `adminNotes` is a no-write retry; show "sin cambios", not a success toast, or the
  admin believes a message was delivered that was not.

## Phases

Every phase ends with `npx tsc --noEmit`, `npm test`, `npx eslint .` at 0 errors,
plus the check named.

### Phase A — Migration script, dry-run only

- The script and its lib. **Register in `OPERATOR_TOOLING_ALLOWLIST` in this same
  phase** (`protectedReadAudit.ts:346`; the exact list is pinned at
  `protectedReadAudit.test.ts:484-497`) — `scripts/**` is audited, so creating the
  file without registering reddens this phase's own gate. Not
  `RETIRED_ONE_SHOT_WRITERS`, which fails closed.
- **Verification:** gate + `scripts/__tests__/migrateProposalMessages.test.ts`
  (mapping, fallback chains, ordering, `_key` skip, hard abort on a live thread).
- **State after:** deployable; no production write.

### Phase B — Rehearsal

Re-run the dry-run and diff against Phase A's output. Any change means production
moved; investigate. **No `--apply`.**

### Phase C — The cutover (one deploy)

- Both message routes, with `setIfMissing`, `loadCanonicalProposal`,
  `withVerificationRunContext`, `maxDuration`, and the per-surface revision rule.
- The transition appends its message; `reopen`-empty and `reconcile_target` append
  nothing.
- **The mirror**: both routes and the transition keep `lead_notes` / `admin_notes`
  current, and the lead route calls `queueLeadNotesNotice` with its **existing**
  signature.
- `buildProposalMessage` gains `_type`; its test updated.
- Reads and UI.
- Register both writers in `PROTECTED_RUNTIME_WRITERS`, and move the count test's
  title from fourteen to sixteen (`protectedReadAudit.test.ts:387`).
- **Verification:** gate + the whole table below.
- **Caveat:** e2e fixtures still assert `admin_notes` until Phase E, so this phase
  is deployable against vitest but not the e2e suites.
- **The `preview` walkthrough writes REAL data.** No edit or delete path exists, so
  every test message is permanent and visible to the team. Name the target
  proposal in advance.

### Phase D — Release

1. Gates green, then a **fresh code review of `main...feature`**. Do not "merge to
   `main` locally" — it is protected with `enforce_admins: true` (`docs/CI.md`).
   Fix, **re-verify the fix**.
2. **Re-measure:** documents with non-empty legacy notes and the count they imply;
   documents already carrying `messages` (**expect 0** — non-zero means a write
   path shipped early, stop for a human); documents carrying a migration `_key`
   (expect 0).
3. Read the fresh dry-run diff line by line.
4. **Frank's explicit consent in chat**, then `--apply`. **The only `--apply`.**
5. Re-read the patched documents and confirm the count step 2 predicted — never a
   hard-coded number — with correct `_key`, `_type`, `kind`, `author_role`, `at`,
   and a resolvable `author` where present.
6. Merge into `preview`, push, **verify the dev alias and `githubCommitSha`**.
7. PR to `main`, wait for `gates`, merge.
8. Verify the production alias.
9. **Reconcile.** Re-read all proposals and compare each `lead_notes` /
   `admin_notes` against its migrated message. **Compare emptiness too** — a field
   blanked to `""` would be skipped by a non-empty-only comparison. Repair by
   **consented top-up** with a distinct `_key` (`topup<n>`), never by re-running
   the migration.

**The residual window is step 4 → step 8**: a preview verification and a PR gate,
roughly ten to twenty minutes. Do not exercise the thread on `preview` until step 8
completes — during that window `preview` runs new code and production old code
against the same dataset.

### Phase E — Docs, ADRs, e2e

- `docs/DATA_MODEL.md`; `docs/API_REFERENCE.md` (+ rows for the two routes, and
  state that the transition-fingerprint field list is unchanged);
  `docs/UTILITIES_AND_COMPONENTS.md` (+ `ProposalThread`); a forward pointer at
  `docs/superpowers/specs/2026-07-03-shared-setlist-proposals-design.md:83`.
- **ADR-0023** — why `APPROVAL_RECEIPT_VERSION` / `APPROVAL_APP_MARKER` were
  deliberately not bumped. Link from `proposalWriteRequest.ts:173-176`.
- **ADR-0024** — why read state is deferred and must never live on
  `setlistProposal` or `teamMembers` (the `_rev`-as-auth-token and
  `publishReadyTransaction.ts:26-32` arguments).
- e2e: `proposal-lifecycle.spec.ts:104`, `zero-delivery.spec.ts:64`,
  `lib/dataset.ts:390-403`, `scripts/lib/sr-verification.mjs:938`.

## Acceptance criteria

1. Every message ever posted is retrievable; none is overwritten.
2. The 8 documents carrying legacy notes have them as messages, with the count the
   pre-`--apply` re-measure predicted.
3. `lead_notes` and `admin_notes` on every other document are byte-identical to
   their pre-migration values.
4. **The existing debounced admin email fires on exactly the occasions it fires
   today**, same audience, same debounce, same preference key.
5. No file under `app/utils/outbox*` or `proposalNotify.ts` is modified.
6. A post never enables an approval or a save against content the actor was not
   shown.
7. `team_notes` behaviour is unchanged end to end.

## Verification

| Requirement | Test | Failure it detects |
|---|---|---|
| **`setIfMissing` precedes every append** | `proposalMessageRoutes.test.ts` + `proposalWriteRoutes.test.ts` — assert the MUTATION CHAIN, not a 200 | The first message failing silently; a first-time `request_changes` rolling back its status change |
| **The existing email still fires** | `setlistNoticeQueueing.test.ts` — a lead message on a `pending` proposal produces an outbox document with the same shape as today's | Silently retiring the notification this child promises not to touch |
| **No outbox module changed** | a test or CI check asserting `git diff --name-only` touches nothing under `app/utils/outbox*` or `proposalNotify.ts` | Scope leaking into Child B |
| A LEAD's post never enables a lost update | mount test — interleave a co-lead content edit between the lead's page render and the lead's post; the subsequent save must **409** | Adopting a revision without its content |
| An ADMIN's post never enables an unreviewed approval | mount test — interleave a lead content edit between the admin's card render and the admin's post; approve must 409 or publish only what was shown | Re-authorizing against unseen content |
| A post does not 409 the ADMIN's own next action | `proposalMessageRoutes.test.ts` — after `load()`, a transition succeeds | Locking the admin out of the card |
| Concurrent posts both land | `proposalMessageRoutes.test.ts` | A revision precondition creeping into the append |
| An empty `reopen` appends nothing | `proposalWriteRoutes.test.ts` | A blank bubble on every note-less reopen |
| A repeat identical `request_changes` is not shown as delivered | panel mount test — a 200 with `idempotent: true` renders no bubble and no success toast | Presenting a no-write retry as a sent message |
| Replay appends no duplicate | `proposalWriteRoutes.test.ts` | The append escaping the `no_write_retry` guard |
| The composer closes on the SERVICE DATE | `proposalThread.test.ts` (shipped) + `proposalMessageRoutes.test.ts` — an approved future service accepts; a past-dated one is rejected server-side | A chat read-only on most real proposals, or a client-only gate |
| Stored shape is homogeneous | `proposalMessageWrite.test.ts` + `migrateProposalMessages.test.ts` assert the same field set including `_type` | Migrated items carrying `_type` and runtime items not |
| Migration ABORTS on a live thread | `migrateProposalMessages.test.ts` | A whole-array `set` erasing real messages |
| Migration is idempotent | second `--apply` reports `0 patched` | Duplicate messages |
| Non-lead / content-editor blocked | `proposalMessageRoutes.test.ts` | An ACL hole on a new writer |
| `team_notes` untouched | existing `proposalWriteRoutes.test.ts` approval assertions | Folding team notes into the thread |
| Approval receipts survive | `proposalWriteRequest.test.ts` frozen digests (shipped) | Any change to the fingerprints or their constants |

**Suites that will break:** `proposalWriteRoutes.test.ts`,
`proposalMessageWrite.test.ts`, `protectedReadAudit.test.ts`,
`setlistNoticeQueueing.test.ts`. E2E: `proposal-lifecycle.spec.ts`,
`zero-delivery.spec.ts`, `lib/dataset.ts`.

## Safe ending state and rollback

**Safe ending state:** the thread is the visible record; `lead_notes` /
`admin_notes` are maintained mirrors and remain a complete archive of the newest
message in each direction; every notification behaves as it did before.

**Rollback: revert the code.** The legacy fields were never stopped, so they are
current, not stale, and the reverted UI reads them as authoritative. `messages[]`
becomes inert. **What revert does not recover:** the *history* — a reverted reader
shows only the newest note in each direction again, which is exactly today's
behaviour. No data is destroyed and nothing needs a recovery script.

**Partial failure:** the transition's `set` + `append` are one patch in one
transaction. A standalone post is one patch. The migration aborts per document
rather than half-writing.

## Outputs for Child B

- `messages[]` populated and live; the thread is the record.
- Mirrors maintained, so Child B's first act is removing a shim rather than
  building a bridge.
- `queueLeadNotesNotice` still on its original signature and still called from a
  known set of sites, so Child B moves a call it can see.

## Open questions

None blocking. OQ-1 and OQ-2 in the parent belong to Child B.

## Terminal state

`READY_FOR_ADVERSARIAL_REVIEW`. Plan approval is not authorization to implement.
