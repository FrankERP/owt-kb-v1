# Shared setlist proposals (co-leads build one setlist together) — design

Date: 2026-07-03
Status: **Approved (design)** — signed off on adversarial review round 4 after
rounds 1–3 each surfaced a real blocking defect (r1: create-race, phasing,
`admin_notes` exposure; r2: migration ranking must NOT reuse the surfacing
ranking — inverse for `approved`; r3: mandatory approved-doc write-guard +
post-approval re-open lifecycle; r4: APPROVED, 3 non-blocking refinements folded
in). **One product decision remains open for the user (Q4: admin-mediated re-open
vs. terminal-by-design)** — the recommended default is admin-mediated re-open; the
§2 write-guard is required either way. Ready to implement once Q4 is answered.

## Problem

A service can have more than one Lead. Today each lead authors their **own**
`setlistProposal` document: the write path in `app/api/me/proposals/route.ts`
upserts on the pair `(lead._ref, service_ref._ref)`, so two co-leads on the same
Sunday produce two independent, **competing** proposals. The admin then sees two
cards for one service and approves one; approval deletes the losers
(`app/api/admin/proposals/[id]/route.ts`, "supersede" block).

We recently shipped *discoverability* on top of this model — a submission push
plus a persistent "Ana envió una propuesta →" cue on `/me`
(`app/utils/coLeadProposals.ts`). That makes the competing model **visible**, but
it does not make it **collaborative**: co-leads still cannot build one setlist
together. This spec designs that collaboration: **one shared proposal per
service** that every lead on the service edits, submits, and sees reviewed as a
single unit.

## Current state (facts)

- **Schema** (`sanity/schemas/setlistProposal.ts`): `service_type`, `service_ref`
  (→ `sunday_role`/`saturday_role`/`special_role`), `service_date`, `lead`
  (single ref → `teamMembers`), `songs[]` (`proposal_song` = `song`→post +
  `play_key` + `medley_tag`), `status` (`draft`/`pending`/`approved`/
  `changes_requested`), `lead_notes`, `admin_notes`, `submitted_at`,
  `reviewed_at`.
- **Write** (`app/api/me/proposals/route.ts`): upsert keyed by
  `lead._ref == $leadId && service_ref._ref == $roleId`. Authorises via the role
  doc (`$leadId in Lead[]._ref && published != false`). On `pending`, calls
  `notifyProposalSubmitted` (admins + co-lead push, admin email).
- **Approve** (`app/api/admin/proposals/[id]/route.ts`): writes `songs` into the
  real setlist — `featuredSongs` (Sunday, keyed by `week`), `saturdarSongs`
  (Saturday, keyed by `week`), or the `special_role` doc itself — marks the
  proposal `approved`, **deletes** all other non-approved proposals for the same
  service, pushes to `lead._ref`, and `revalidateServiceViews()`.
- **Editor** (`app/(client)/me/propose/[roleId]/ProposalEditor.tsx`): edits *my*
  proposal; shows the co-lead's competing proposal in a **read-only** "Borrador de
  {leadName}" panel. Save does a full-array `set({ songs, status, lead_notes })`.
- **`/me`** (`app/(client)/me/page.tsx`): per-service CTA from *my* proposal +
  the co-lead cue.
- **Admin panel** (`app/components/admin/ProposalsPanel.tsx`): one card per
  proposal doc (so two per service when two leads propose).

### Live data (verified read-only, 2026-07-03)

`4` proposals total (`draft:1, pending:1, approved:2`) across `4` distinct
services. **`0` services have competing proposals.** So: the two-lead collision
this redesign prevents has **not actually happened yet** — migration has no
merge conflicts to resolve, and the change is forward-looking insurance, not
cleanup of an existing mess. (This materially lowers migration risk and is the
main argument for building it *lean*; see Non-goals and "Is it worth it".)

## Goals

1. **One proposal per service.** Every Lead on a service edits the same
   `setlistProposal`; there is never more than one per service.
2. **No silent data loss.** Concurrent edits by two leads must never clobber each
   other invisibly. A stale save is rejected with a clear "reload" path, not a
   last-write-wins overwrite.
3. **Shared review unit.** Admin sees one card per service; approve /
   request-changes acts on the shared doc; all contributors are notified of the
   outcome (not just the original author).
4. **Attribution.** The doc records who created it, who has edited it, and who
   last submitted — so leads and admins can see who did what.
5. **Backward compatible rollout.** Existing 4 docs keep working through the
   transition; no orphaned data.

## Non-goals

- **Real-time co-editing** (live cursors, operational-transform/CRDT merge).
  Overkill for a team that has never yet had two leads propose for one service.
- **Per-song attribution / comment threads** between co-leads. `lead_notes`
  stays a single shared field.
- **Renaming `saturdarSongs`** or any setlist-target plumbing — approval keeps
  writing the same target docs exactly as today.
- **Changing the approval → real-setlist write path.** Untouched.

## Design

### 1. Data model (`sanity/schemas/setlistProposal.ts`)

Keep the doc type and every existing field. The proposal stays "one document,"
but its identity moves from *(lead, service)* to *(service)*. Changes:

- **Keep `lead`** — re-purposed as **creator/owner** (who started the proposal).
  Retained (not renamed) so the Studio preview, the notification code that reads
  `lead._ref`, and existing docs keep working with zero migration churn.
- **Add `contributors[]`** — array of `{ _key, person: reference→teamMembers }`.
  Everyone who has saved an edit. (Array-of-object ⇒ **each item needs a
  `_key`**, per the repo invariant.)
- **Add `last_edited_by`** (reference→teamMembers) and **`last_edited_at`**
  (datetime, readOnly) — drives the "Editado por … hace …" line and disambiguates
  concurrent saves in the UI.
- **Add `submitted_by`** (reference→teamMembers) — who last moved it to
  `pending` (may differ from creator).

`status`, `lead_notes`, `admin_notes`, `submitted_at`, `reviewed_at`,
`service_*`, `songs[]` unchanged. Studio schema must be **deployed** (like prior
schema changes) before the new fields render in `/studio`.

### 2. Uniqueness & the write path (`app/api/me/proposals/route.ts`)

Change the upsert key from *(lead, service)* to **(service) only**. Two distinct
races must be closed — concurrent **create** *and* concurrent **update** — with
two different primitives. Verified against `@sanity/client` v7.22.1:
`patch(id).ifRevisionId(rev)` exists and a revision/id conflict surfaces as a
catchable `ClientError` with `statusCode` (409).

**Find existing by service content (not by id)** so legacy random-id docs are
found too:

```groq
*[_type == "setlistProposal" && service_ref._ref == $roleId]
  | order(_createdAt asc)[0]{ _id, _rev, status, contributors }
```

(`status` is projected because the approved-doc write-guard below needs it; the
`order(_createdAt asc)` tiebreak makes "exactly one wins" robust even if a stray
duplicate ever slipped through — bare `[0]` is order-undefined.)

- **Authorisation unchanged**: the caller must still be a Lead on the service
  (`$leadId in Lead[]._ref && published != false`) — only assigned leads write.

- **Create race — resolved with a deterministic `_id` as a mutex.** When the
  service query finds **no** doc, create with an id *derived from the service*:
  `_id = "setlistProposal." + roleId`. Use `writeClient.create({ _id, … })`
  (**not** `createIfNotExists`, and **not** a random id): `create` on an id that
  already exists **throws a conflict**, so if two co-leads both see "no doc" and
  both create, the first wins and the second's create throws → the route returns
  **409** (`{ error: "stale" }`). This is what actually enforces goal #1;
  optimistic concurrency alone does not. (The legacy docs keep their random ids
  and are matched by the content query above, so the deterministic id is used
  *only* for brand-new creates — no re-id of existing docs is required. A `.`
  in `_id` is a valid Sanity id namespace.)
  Initial content: `lead = creator`, `contributors = [{ _key, person: creator }]`,
  `last_edited_by = creator`, `last_edited_at = now`.

- **Update race — resolved with `ifRevisionId`.** When the query finds a doc, the
  client must send the `_rev` it loaded. Server applies
  `writeClient.patch(existingId).ifRevisionId(rev).set({…})`. On revision
  mismatch → catch `ClientError` → **409**. The `contributors` append is computed
  **in code from the fetched array and written as a whole-array `set` inside this
  same guarded patch** (so it's atomic with the edit and a rejected-then-retried
  save can't double-add); new items get a `_key`.

- **The explicit missing-`_rev` branch (the data-loss guard, written out):**
  ```
  existing = fetch by service_ref
  if (!existing):        // create path
      try create({_id: deterministic, ...}) ; catch conflict -> 409
  else:                  // update path
      if (!clientRev) -> 409   // never blind-overwrite an existing doc
      try patch(existing._id).ifRevisionId(clientRev).set(...) ; catch 409 -> 409
  ```
  There is no code path that writes to an existing doc without a matching
  revision. This is the invariant the whole design hangs on.

- On `status === "pending"`: set `submitted_by = editor`, keep calling
  `notifyProposalSubmitted` (admins + *other* leads). With one shared doc the
  "co-lead" push now means "your co-lead edited & submitted the shared setlist."

- **Also fix the dead `GET` handler in this file.** `GET /api/me/proposals`
  filters `lead._ref == $id`, which under the shared model returns nothing for a
  non-creator co-lead. It has **zero client callers** today (the editor only
  POSTs), so it's harmless — but since Phase 2 already edits this file, either
  update its filter to the same by-service superset or delete it, so a future
  consumer doesn't inherit the author-only bug.

- **Approved-doc write guard (mandatory safety, goal #2).** The current member
  route has **no status check** — it will `patch(existing).set({songs, status,…})`
  regardless of the existing status. Under one-per-service the shared doc *is* the
  `approved` doc that already wrote the live `featuredSongs`/`saturdarSongs`/
  special setlist. A well-formed save (e.g. a stale tab that loaded a
  pre-approval revision, so its `isApproved` was false, then the `_rev` happens to
  still match) would patch the approved doc back to `draft`/`pending`, **silently
  detaching the proposal from the already-published setlist** — the setlist doc is
  never revalidated or reverted, so the two now disagree, with no admin signal.
  `ifRevisionId` does **not** protect against this (it guards concurrent clobbers,
  not a valid write to an approved doc). Therefore: **the member write path must
  reject any write whose *existing* status is `approved`** (return 409/403), unless
  it is the explicit re-open transition below. This is a hard invariant, not a UI
  nicety — the read-only editor is defence-in-depth, not the guarantee.

### 3. Editor (`ProposalEditor.tsx` + `propose/[roleId]/page.tsx`)

- **Load the single shared proposal** for the service (drop the my-vs-co-lead
  split in `getProposalsForService`). Pass its `_rev` to the client.
- **Remove** the read-only "Borrador de {leadName}" competing panel — there is no
  competing doc anymore. Replace with a **contributors line**: "Editado por Ana,
  Beto · última edición por Beto." (Show creator + contributors.)
- **Save** sends `_rev`. On **409**: show a non-destructive banner — "Otro líder
  actualizó esta propuesta. Recarga para ver los cambios." with a **Recargar**
  button (`router.refresh()`), and do **not** clear the editor (so the lead can
  copy anything unsaved before reloading). The current `save` throws on *any*
  non-ok (`if (!res.ok) throw`) — it must special-case 409 vs. generic error.
  Keep the try/catch/finally + loading-flag-reset contract.
- **`admin_notes` becomes shared-visible (intended exposure change).** Today the
  admin's change-request notes live on the single author's proposal and only that
  author sees them; on a shared doc *every* co-lead sees them. This is desirable
  — co-leads fixing a setlist together should all see what the admin asked for —
  but it **is** a data-visibility change, so it's called out explicitly rather
  than hidden under "invariants preserved." `lead_notes` likewise becomes shared
  (one notes field all leads edit). No other field changes visibility.
- Everything else (song search, drag reorder, key picker, medley grouping,
  submit-confirm modal, sticky bar) unchanged.

### 4. `/me` (`app/(client)/me/page.tsx`)

- The proposal query already became a superset that pulls proposals on any
  service I lead. With one-per-service it returns exactly one row per service.
- The CTA shows the **shared status** (not "mine vs theirs"). Replace the
  `coLeadProposals` competing cue with a **contributor hint** on the same card —
  e.g. "Propuesta compartida · con Ana" when a co-lead has also edited. This
  *repurposes* the discoverability work rather than deleting it:
  `selectCoLeadProposals` becomes `describeContributors(proposal, myId)` (pure,
  testable) returning the "con Ana, Beto" label.
- **Drop the author-keyed filter.** Today `proposalMap` is populated only when
  `p.leadId === sanityId` (`page.tsx:181`). Under one-per-service the shared doc's
  `lead` (creator) may be a *different* co-lead, so this filter would hide the
  current user's own CTA. Key `proposalMap` by `service_ref` and take the single
  row regardless of author. `renderOwnProposalCta` / `renderCoLeadCue` collapse
  back into a single `renderProposalCta` that reads the shared status and appends
  the contributor hint. `describeContributors` is a **pure** helper fed
  already-resolved display names (project them in the query with
  `coalesce(person->alias, person->member_name)`, consistent with every other
  name render here) — it never sees refs. Copy is Spanish ("con Ana, Beto").
- **Cache note (not a bug):** `/me` is `revalidate = 60` and the member write
  path adds no `revalidate*` call, so the contributor hint can lag up to ~60s
  after a co-lead's save. Acceptable for a passive cue; noted so it isn't later
  filed as a defect. (The propose page is `revalidate = 0`, so the editor itself
  is always fresh.)

### 5. Admin (`ProposalsPanel.tsx` + `admin/proposals/[id]/route.ts`)

- List shows **one card per service** (falls out of one-per-service; no code
  change needed, but the mental model simplifies and the duplicate-card case
  disappears).
- **Show contributors on the admin card (goal #3).** The list query
  (`admin/proposals/route.ts`) projects `lead_name` from the creator only; add
  `"contributors": contributors[].person->{alias, member_name}` and render "con
  Ana, Beto" on the card so the admin sees it's shared. (Small display change,
  belongs in this phase — not just notifications.)
- **Notify all contributors** on review outcome:
  `recipients = [...new Set([lead._ref, ...contributors[].person._ref])].filter(Boolean)`,
  passed to `sendPush`. Approve and request_changes both switch from the single
  `lead._ref` target to this set. (Dedup is cheap insurance, **not** a
  correctness requirement: `sendPush` fetches members via `*[… && _id in $ids]`
  and GROQ `in` already returns each member doc once, so a duplicate id would
  *not* double-deliver. The one-push-per-member property holds either way.) Keep
  best-effort.
- The **supersede-and-delete** block becomes a no-op safety net (there is at most
  one non-approved proposal per service). Keep it — cheap insurance against a
  stray legacy doc.

### 5a. Approved-doc lifecycle (behaviour change — decide explicitly)

The shared-doc model changes what "after approval" means, and this must be a
*decision*, not an accident:

- **Today:** each lead has their own doc. A co-lead who did **not** author the
  approved proposal gets `myProposal = null` on the propose page and can author a
  **fresh** proposal — a de-facto "re-propose after approval" path.
- **Under one-per-service:** all leads share the single `approved` doc, which the
  editor renders fully read-only (`ProposalEditor.tsx` `isApproved`) and the admin
  card shows as terminal ("Setlist publicado"). So the redesign **removes** the
  post-approval re-propose path unless we add one back.

**Decision (default): re-opening is an explicit, admin-mediated transition — not
silent re-editability.**

- To revise an already-approved setlist, an **admin** re-opens it: a new
  `reopen` action on `admin/proposals/[id]` sets the shared doc
  `approved → changes_requested` (with `admin_notes`), pushes all contributors,
  and **leaves the live setlist doc unchanged** until the revised proposal is
  re-approved. This reuses the existing review UI and the mandatory write-guard
  above (leads can edit again precisely because status is no longer `approved`).
- Leads do **not** get a self-serve "un-approve and edit" button (it would let a
  lead silently pull the rug on a published setlist). If a lead wants changes
  post-approval, they ask an admin to re-open — the same social flow as today,
  now explicit.
- This keeps the invariant "only the admin approval path writes the real setlist,
  and the proposal can only diverge from it through a tracked transition."

If the user prefers **terminal-by-design** (no re-open at all; post-approval
changes happen by the admin editing the setlist directly, outside the proposal
flow), that's simpler — drop the `reopen` action. Flagged in Open Questions;
either way the **write-guard in §2 is required**.

### 6. Migration (`scripts/migrate-shared-proposals.mjs`, dry-run + `--apply`)

Guarded one-off per repo convention (`node --env-file=.env.local scripts/… ` ,
writes only under `--apply`, prod writes need explicit user consent).

For every existing `setlistProposal`:
1. `setIfMissing contributors = [{ _key, person: lead }]`,
   `last_edited_by = lead`, `last_edited_at = submitted_at ?? _updatedAt`.
2. **Collision handling** (defensive; **0 cases today**): if a service has >1
   proposal, keep the **most advanced** (`approved > pending > changes_requested >
   draft`; tie-break latest `submitted_at`/`_updatedAt`), fold the losers'
   contributors into the winner, and delete the losers.

   > ⚠️ **Do NOT reuse `coLeadProposals.RANK` for this.** That constant ranks
   > `approved` **lowest** (`pending:3, changes_requested:2, approved:1, draft:0`)
   > — correct for `/me` *surfacing* (an approved proposal is done, so don't nag
   > about it), but the **inverse** of what migration needs. Winner-selection must
   > rank `approved` **highest**, because the approved proposal is the one backing
   > the live setlist; picking a `pending` loser over it would `writeClient.delete`
   > the approved doc — silent, irreversible loss under `--apply`, in exactly the
   > collision case this code exists for. These are **two different orderings** and
   > must stay separate: name them distinctly — `salienceRank` (surfacing, in
   > `coLeadProposals.ts`) and `advancementRank` (migration winner-selection, in
   > the migration script or a clearly-separate util) — each with its **own** test
   > asserting where `approved` sits. There is no shared "single source of truth"
   > here; the earlier draft's claim that these are the same ranking was wrong.

Use **`setIfMissing`** for `contributors`, `last_edited_by`, and
`last_edited_at` (not `set`) so a re-run doesn't rewrite `last_edited_at` — that's
what keeps it genuinely idempotent. With 4 docs / 0 collisions, `--apply` touches
4 docs and merges nothing; a second run is a no-op.

## Alternatives considered

- **Primary-proposer (rejected, but the fallback).** Designate one Lead
  (e.g. first in `Lead[]`) as the sole editor; co-leads get read-only + a
  "suggest" affordance. Zero concurrency problem, much less code. Rejected
  because the ask is explicitly "build *together*," and this doesn't. Worth
  reconsidering if we want to ship in a fraction of the effort — noted as the
  lever if scope needs cutting.
- **Real-time collaborative editing (rejected).** Sanity presence / y.js CRDT.
  Weeks of work and a new failure surface for a collision that has never
  occurred. No.
- **Item-level song patches (deferred).** Model each add/remove/reorder as a
  discrete Sanity patch to shrink the conflict window. Optimistic whole-array +
  `ifRevisionId` is sufficient at this scale; revisit only if two-lead editing
  becomes common and reload-friction is felt.

## Phasing

Each phase leaves the app working (gate: `npx tsc --noEmit` + `npm test` green).

1. **Schema** — add `contributors`, `last_edited_by/at`, `submitted_by`; deploy
   Studio schema. (No behaviour change; additive. Safe alone.)
2. **Write path + editor together (one phase, deliberately).** The server's
   strict "existing doc requires matching `_rev` ⇒ else 409" rule and the client
   sending `_rev` **must ship in the same release**: the current client sends no
   `_rev` and throws on any non-ok (`ProposalEditor.tsx:302`), so a server-only
   deploy would 409 *every* existing-doc save. This phase = upsert-by-service +
   deterministic-id create mutex + `ifRevisionId` update guard + contributor
   append + `submitted_by`, **and** the editor loading `_rev`, the 409 reload
   banner, contributors line, and removal of the competing panel. Unit-test
   create-conflict-409 / stale-update-409 / no-rev-on-existing-409 /
   authorisation / contributor-dedupe.
   > **`_rev` must be read live from props, not captured once.** The editor seeds
   > `songs`/`status` via `useState(() => …)` initializers, which do **not**
   > update when props change. After a 409 the banner calls `router.refresh()`
   > (the page is `revalidate = 0`, so it re-runs and yields a fresh `_rev`), but
   > a one-time initializer would resend the *stale* `_rev` and 409 again. Read
   > `_rev` from the live prop (or re-seed on change via a `key` / effect) so the
   > post-reload save carries the new revision.
3. **`/me`** — single shared CTA + contributor hint (`describeContributors`), drop
   the author-keyed `proposalMap` filter. (Read-only; safe alone.)
4. **Admin** — one card per service, contributor display, notify all (deduped)
   contributors on approve/request_changes, and (if re-open is chosen in Open Q4)
   the `reopen` action (`approved → changes_requested`, live setlist untouched).
5. **Migration** — dry-run, review, then `--apply` with explicit user consent.

Phase 2 is the core "build together" value **and** the only irreversible,
data-shaped step; 3–4 are polish; 5 is a 4-doc touch-up. The old plan split
server (2) and client (3) into separate shippable phases — that was wrong and is
corrected here: they are one atomic release.

## Testing

- **Pure logic (must):** `salienceRank` **and** `advancementRank` — each with a
  test that pins where `approved` sits (they are opposite; a test on each is the
  guard against re-merging them); `describeContributors` (contributor label incl.
  self-exclusion + empty); contributor-append dedupe.
- **Write route:** create vs update; editor added to contributors once (dedupe);
  **create conflict** (create on existing deterministic id) → 409, no second doc;
  **stale-`_rev`** update → 409 and **no write**; **no-`_rev` on existing** → 409;
  **write to an `approved` doc → rejected, no write** (the setlist-detach guard);
  non-lead → 403; `pending` sets `submitted_by` and notifies.
- **Admin route:** approve/request_changes push targets the **deduped union** of
  contributors + creator (a member who is both contributor and creator gets one
  push).
- **Concurrency:** two updates with the same starting `_rev` — second returns
  409, first wins, no clobber. Two creates for a no-doc service — second's
  `create` conflicts → 409, exactly one doc exists.

## Open questions

1. **Build it now, or wait?** 0 collisions to date. Options: (a) build lean now
   (Phases 1–3) as insurance; (b) ship only the `ifRevisionId` guard + one-doc
   model and defer contributor UI; (c) defer entirely until a two-lead service
   recurs. Recommendation: **(a)** — the guard and one-per-service model are the
   irreversible/data-shaped parts; UI can follow.
2. **Contributor vs. creator authority.** Any lead can submit and any lead can
   edit after `changes_requested`. Is that desired, or should only the creator
   submit? Assumed **fully symmetric** (true "together").
3. **Notes.** Single shared `lead_notes` (assumed) vs. per-contributor notes
   (rejected as scope creep) — confirm.
4. **Post-approval: re-open vs. terminal.** §5a defaults to an **admin-mediated
   `reopen`** (`approved → changes_requested`) and no lead self-serve un-approve.
   Confirm this is right, or choose terminal-by-design (no re-open; admin edits
   the setlist directly). The §2 write-guard is required regardless. This is the
   one decision that changes user-visible behaviour vs. today — worth a direct
   yes/no from the user before building.

## Risks

- **Concurrency correctness hinges on two guards, not one.** Updates use
  `ifRevisionId`; **creates use a deterministic-`_id` `create` that throws on
  conflict** (a random-id `create` or `createIfNotExists` would silently allow a
  second doc). If the client ever omits `_rev` on an existing doc, we 409, never
  overwrite — enforced server-side.
- **Reload friction.** Two leads editing at once will occasionally hit the 409
  reload. Acceptable at current volume; item-level patches are the escape hatch
  if it bites.
- **Notification fan-out.** Pushing to all contributors could double-notify a
  lead who is also an admin; dedupe recipient ids (already implied by
  set-union).
- **Schema deploy ordering.** New fields must be deployed to Studio before the
  migration/`--apply` writes them, or Studio hides unknown fields (data still
  valid). Deploy schema first.
