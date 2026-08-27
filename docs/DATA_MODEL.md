# Data Model — Sanity Content Lake

Everything the app stores lives in **Sanity** (project `ebb8vcnk`, dataset `production`,
API version default `2024-07-23`). Schemas are in [`sanity/schemas/`](../sanity/schemas/) and
registered in [`sanity/schema.ts`](../sanity/schema.ts). The type `name` values below are the
exact strings used in GROQ `_type` filters.

> **Read this before any query or write.** The two most error-prone quirks — the deliberate
> `saturdarSongs` typo and the split between role docs (assignments + publish flag) and setlist
> docs (songs) — are explained here.

---

## Registered document types (18)

`post`, `tag`, `author`, `featuredSongs`, `saturdarSongs`, `saturday_role`, `sunday_role`,
`teamMembers`, `special_role`, `loginEvent`, `setlistProposal`, the two Oasis Kids types
`kidsPair` and `kidsSchedule`, and five **internal** types never authored by hand:
`roleTargetLock`, `roleCreationReceipt`, `notificationOutbox`, `specialIdentityCoordinator`,
`solverConfig`.

**Not registered** (present but intentionally unused — do not wire in):
- `sanity/schemas/youtubeType/youtubeType.ts` — object type `youtube`.
- `sanity/schemas/[deprecated]roleSat.ts` — an old `saturday_role` shape (`DepreciatedSaturdayRole`).

**Not a stored type:** there is **no play-history document.** "Recent plays" are derived at
query time via GROQ `references($id)` over setlist docs (see `app/api/song/[id]/route.ts`).

---

## `post` — Song (the core content type)

File: [`sanity/schemas/post.ts`](../sanity/schemas/post.ts). Despite the generic name "Post,"
this is a **song**.

| Field | Type | Notes |
|-------|------|-------|
| `title` | string | **Required.** |
| `author` | string | Free-text author (legacy/simple). Used by the slug source and previews. Coexists with `authors[]`. |
| `slug` | slug | **Required.** Source: `${title}-${author}`, maxLength 96. |
| `publishDate` | datetime | `initialValue`: now. |
| `timeSig` | string | Time signature. |
| `bpm` | number | Tempo. |
| `key` | string | Native/original key. |
| `musicalReferenceUrl` | url | YouTube reference mix musicians rehearse with. |
| `lyricsVideoUrl` | url | YouTube video with the Spanish lyrics the team sings. |
| `body` | array (Portable Text) | `block` + `image` (image has an `alt` text field). Lyrics live here. |
| `tutorials2` | array of `tutorial` | `{ title, url }`. |
| `audioTracks` | array of `audioTrack` | `{ title, tone, audioFile (.mp3 file) }`. |
| `lyrics` | file | Lyrics PDF (`.pdf`). |
| `chordsPDF` | array of `chordsPDF` | `{ title, key, chordsPDF (.pdf file) }`. |
| `chords` | array of `chord_chart` | `{ key, content (text, chords written above lyric lines) }`. Independent of `body` — [ADR-0018](adr/0018-lyrics-and-charts-are-independent.md). |
| `referenceLinks` | array of `referenceLink` | `{ label, url }`. |
| `tags` | array of reference → `tag` | Taxonomy. |
| `authors` | array of reference → `author` | Structured authors (parallel to the `author` string). |

**Lyrics and charts are independent fields.** `body` is the lyrics textarea;
`chords` is the repeatable chart editor. Do not classify one from the other with
`CHORD_MARKER_RE`. See [ADR-0018](adr/0018-lyrics-and-charts-are-independent.md).

---

## `teamMembers` — Member / person

File: [`sanity/schemas/worshipTeam.ts`](../sanity/schemas/worshipTeam.ts). The person type
referenced by every seat, proposal, and login event. **A member's identity in auth is their
`_id` (the `sanityId`).**

| Field | Type | Notes |
|-------|------|-------|
| `member_name` | string | Display name. |
| `slug` | slug | Source `member_name`. |
| `alias` | string | Nickname; preferred in most previews/labels. |
| `email` | string | `Rule.email()`. **Must match the SSO email exactly** (case-insensitive lookup). |
| `role` | string (radio) | **Authorization role:** `super-admin` / `admin` / `content-editor` / `member`. Default `member`. |
| `disabled` | boolean | **Kill switch.** `true` revokes access within ~30s (reversible). Default `false`. |
| `deviceTokens` | array (hidden) | `{ token, platform, updatedAt }` — FCM push tokens. |
| `themePref` | string (hidden) | `"dark"` \| `"light"` \| `"system"`, member-set via `PATCH /api/me/theme`. **Deliberately has NO `initialValue`** — an *unset* field means "has never chosen", which since Child F resolves the same way as `"system"` — both follow the device. The distinction is kept because an explicit choice is worth recording as one. Guarded by `themePrefSchema.test.ts`. Hidden and never in `MemberForm` (D11): a theme is a client preference, not something an admin sets on someone's behalf. |
| `notifPrefs` | object | `assignments` (bool, def true), `email` (bool, def true — assignment emails), `setlist` (string: `all`/`assigned`/`off`, def `all`), `proposals` (bool, def true), `reminders` (bool, def true). |
| `memberType` | array of string | Multi-select: `voz`, `instrumento`, `foh`, `sunday_lead`, `saturday_lead`, `support`. Governs sections + solver pools. |
| `profilePhoto` | image | `hotspot: true`. |
| `googlePhotoUrl` | string (hidden) | Synced from Google OAuth each sign-in; fallback photo. |
| `lastSeen` | datetime (hidden) | Auto-updated by the activity ping. |
| `passwordHash` | string (hidden) | bcrypt. Set via admin API / CLI. Never edit manually. |
| `unavailableDates` | array of string | ISO `YYYY-MM-DD` the member can't serve. Set from `/me`. |
| `unavailabilityNotes` | array (hidden) | `{ date, note }` optional reasons per unavailable date. |

**Auth note:** `role` and `disabled` are read live (bypassing CDN) through the 30s-TTL cache in
`memberAccess.ts`, so role changes and the kill switch take effect within ~30 seconds instead
of waiting for the 7-day JWT to expire. See [AUTH_AND_SECURITY.md](AUTH_AND_SECURITY.md).

---

## Services: the role/setlist split

Sunday and Saturday services store data in **two documents paired by matching `week`**:
a **role** doc (assignments + `published` flag) and a **setlist** doc (songs). "Special"
services combine both in one doc.

### `sunday_role` / `saturday_role` — Role (assignments)

Files: [`sunRole.ts`](../sanity/schemas/sunRole.ts), [`satRole.ts`](../sanity/schemas/satRole.ts).
Structurally identical.

| Field | Type | Notes |
|-------|------|-------|
| `creationReceiptId` | string (hidden, readOnly) | The `roleCreationReceipt._id` that minted this role. **Internal** — written only by the guarded create. |
| `creationFingerprint` | string (hidden, readOnly) | The canonical create-payload fingerprint. **Internal.** The receipt stays authoritative; this is the forward link. |
| `published` | boolean | Default `true`. `false` = draft (managers only). **The gate.** |
| `week` | date | The week this service is valid for. |
| `Lead` | array of reference → `teamMembers` | "Leaders." **Seat 1.** |
| `BGVs` | array of reference → `teamMembers` | Background Vocals. **Seat 2.** |
| `Chorus` | array of reference → `teamMembers` | Coro. **Seat 3.** |
| `instruments` | array of `instrument_slot` | `{ instrument (string), person (ref → teamMembers) }`. **Seat 4** = `instruments[].person`. |
| `foh_team` | array of `foh_slot` | `{ role (string), person (ref → teamMembers) }`. **Seat 5** = `foh_team[].person`. |

### `special_role` — Special service (combined)

File: [`specialRole.ts`](../sanity/schemas/specialRole.ts). Combines setlist + assignments,
keyed on **`date`** (not `week`).

| Field | Type | Notes |
|-------|------|-------|
| `creationReceiptId`, `creationFingerprint` | string (hidden, readOnly) | Same internal create-receipt link as the weekend role docs. |
| `published` | boolean | Default `true`. Draft gate. |
| `date` | date | Date of the special service. |
| `service_name` | string | e.g. "Viernes Santo," "Nochebuena." |
| `songs` | array of `setlist_song` | `{ song → post, play_key, medley_tag (hidden) }`. |
| `Lead`, `BGVs`, `Chorus` | arrays of reference → `teamMembers` | Same three vocal seats. |
| `instruments`, `foh_team` | arrays of slots | Same as above. |
| `team_notes` | text | "Mensaje para el equipo." |

### The five member-referencing seats

Any "who serves?" query must cover all five. Two array-of-reference seats expose `_ref`
directly; the two object-array seats nest it under `person`:

```
Lead[]._ref   BGVs[]._ref   Chorus[]._ref   instruments[].person._ref   foh_team[].person._ref
```

Use `assignedMemberRefsQuery(roleFilter)` in [`app/utils/notifyTargets.ts`](../app/utils/notifyTargets.ts).
Keep it in sync with these schemas if seats ever change.

### `featuredSongs` (Sunday) / `saturdarSongs` (Saturday) — Setlists

Files: [`setList.ts`](../sanity/schemas/setList.ts), [`satSongs.ts`](../sanity/schemas/satSongs.ts).

> **⚠️ `saturdarSongs` is a deliberate typo of "Saturday Songs." Do NOT rename it.** GROQ across
> `app/(client)/page.tsx`, `schedule/page.tsx`, `api/song/[id]/route.ts`, and
> `api/admin/setlists/route.ts` filters `_type == "saturdarSongs"`. Renaming orphans all
> Saturday setlist data. Sunday's setlist type is `featuredSongs`.

Both have identical fields:

| Field | Type | Notes |
|-------|------|-------|
| `songs` | array of `setlist_song` | `{ song (ref → post), play_key (string), medley_tag (string, hidden) }`. |
| `week` | date | Pairs with the role doc's `week`. |
| `team_notes` | text | "Mensaje para el equipo." |

**Setlist docs have no `published` flag.** Their visibility is gated by the paired role doc via
`publishedSetlist(role, setlist)` — see [Draft/publish gating](#draftpublish-gating).

---

## `setlistProposal` — Shared setlist proposal

File: [`setlistProposal.ts`](../sanity/schemas/setlistProposal.ts). **One shared, co-edited
proposal per service.** Every Lead on the service edits the same doc; on admin approval its
songs/notes are written to the real setlist. See the design spec
[`superpowers/specs/2026-07-03-shared-setlist-proposals-design.md`](superpowers/specs/2026-07-03-shared-setlist-proposals-design.md).

| Field | Type | Notes |
|-------|------|-------|
| `service_type` | string (radio) | `sunday` / `saturday` / `special`. |
| `service_ref` | reference → `sunday_role`\|`saturday_role`\|`special_role` | The target service. |
| `service_date` | date | |
| `lead` | reference → `teamMembers` | Creator. |
| `contributors` | array of `contributor` | `{ person → teamMembers }` — every Lead who saved an edit. |
| `submitted_by`, `last_edited_by` | reference → `teamMembers` (readOnly) | Audit. |
| `last_edited_at` | datetime (readOnly) | |
| `songs` | array of `proposal_song` | `{ song → post, play_key, medley_tag (hidden) }`. |
| `status` | string (radio) | `draft` (init) / `pending` / `approved` / `changes_requested`. |
| `messages` | array of `proposal_message` | **The private lead ↔ admin thread.** `{_key, _type, author → teamMembers (OPTIONAL), author_role, kind, body, at}`. Append-only — this delivery ships no edit or delete path. `author_role` is a snapshot taken at post time, never joined at read time, so an admin who later becomes a member does not have their history re-render as a lead note; `author` is optional because two migrated `admin_notes` had nobody to attribute them to. `kind` and `author_role` reserve `pastor_note` / `system`, unminted, so routing pastor notes here later needs no migration. |
| `lead_notes` | text | **FROZEN LEGACY ARCHIVE — nothing writes it.** It holds whatever the newest lead message was at the moment Child B removed the mirror, and it is never updated or blanked again. One reader uses the STORED field's value: production's OLD sweep compares the notice's `beforeNotes` snapshot against it during a release window or after a revert. The snapshot itself has a second consumer in this tree — the sweep's legacy-tolerance branch, which reads `before.beforeNotes` for any notice minted before the cutover. Four projections still SELECT it and hand it to callers who ignore it — `PROPOSAL_PROJECTION`, the member and admin proposal GETs, and the propose page — and the editor seeds state from it behind a `!proposalId` gate that can only ever see an empty value. Nothing renders it. Do not "clean it up" — the rollback leans on it. |
| `team_notes` | text | Published to the team on approval. **Not** part of the thread — it is the message to the whole team, and it stayed a field deliberately. |
| `admin_notes` | text | **FROZEN LEGACY ARCHIVE — nothing writes it.** The transition was its last writer and Child B stopped that too, so a `reopen` with an empty note can no longer BLANK it, which is what writing the request verbatim used to do. No notification consumer and nothing that renders it; the same four projections still select it and every caller ignores it. A rollback restores the transition's write, and the e2e fixtures move back with it. |
| `submitted_at`, `reviewed_at` | datetime (readOnly) | |
| `approval_receipt` | object (hidden, readOnly) | **Internal.** `{v, marker, fingerprint, serviceType, serviceDate, serviceRef, setlistTargetKey, setlistId, songCount, approvedAt, approvedBy}` — written atomically with the live setlist on approval. |
| `last_transition` | object (hidden, readOnly) | **Internal.** `{v, marker, action, fingerprint, toStatus, at, by}` — the receipt for `request_changes` / `reopen` / `reconcile_target`. |

**Concurrency:** the write path uses a **deterministic `_id`** (`setlistProposal.<roleId>`) as a
create-mutex and `ifRevisionId` optimistic locking — co-lead collisions return **409**. Resolution
goes through A1's **two** indexes (`service_ref` and target key), never an arbitrary `[0]`, so a
duplicate or disagreeing group is refused rather than guessed. Admin transitions submit the
revision the admin **actually reviewed**, and approval is one atomic transaction that also writes
the live setlist and records `approval_receipt`. A matching receipt makes a retry a **no-write
success**; an `approved` proposal with no valid receipt is `409 legacy_approval_unverified`.
**Sibling proposals are no longer deleted on approval** — a duplicate group is refused instead. See
[API_REFERENCE](API_REFERENCE.md#the-protected-mutation-contract).

---

## Internal coordination types — target lock, creation receipt, special coordinator

Files: [`roleTargetLock.ts`](../sanity/schemas/roleTargetLock.ts),
[`roleCreationReceipt.ts`](../sanity/schemas/roleCreationReceipt.ts), and
[`specialIdentityCoordinator.ts`](../sanity/schemas/specialIdentityCoordinator.ts). All are declared
**`hidden: true` and `readOnly: true`** at the type level and are written **only** by the guarded
mutation routes (never in Studio, never by a script). They carry no member-facing content; they
exist so two concurrent writers cannot both win.

### `roleTargetLock` — one weekend target, serialized

Deterministic `_id`: **`roleTarget.<roleType>.<date>`** (e.g. `roleTarget.sunday_role.2026-08-02`),
derived from the target key `<roleType>:<date>`.

| Field | Type | Notes |
|-------|------|-------|
| `targetKey` | string | `sunday_role:<YYYY-MM-DD>` \| `saturday_role:<YYYY-MM-DD>`. |
| `state` | string | `claimed` \| `vacant`. |
| `roleId` | **string** | **A plain string, never a reference** — see below. Absent while `vacant`. |
| `roleType` | string | `sunday_role` \| `saturday_role`. |
| `date` | date | |
| `claimNonce` | string | Per-claim nonce; cleared on vacate. |
| `generation` | number | Starts at `0`; **advances on every vacate**. |
| `createdAt`, `updatedAt` | datetime | `updatedAt` is the heartbeat every weekend writer sets. |

> **Why `roleId` is a plain string, not a reference:** deleting a role must **not** cascade into the
> lock, and a lock must never keep a deleted role alive. A strong reference would do both. Deletion
> therefore *vacates* the lock (clears `roleId`, advances `generation`) instead of removing it, and a
> recreation claims the same lock with a fresh, non-reused role id.

**`special_role` never gets a weekend lock.** Its target key is its own `_id`, which is not a weekend
key, so lock derivation returns `null`. Its own document revision serializes ordinary writes; the
global coordinator below additionally serializes creates and date/name identity changes that may
involve different document IDs.
`claimed` must have exactly one `roleId` owning the same target; wrong-owner and orphan locks are
integrity issues, surfaced by `GET /api/admin/service-integrity/roles` and **never reclaimed
implicitly**.

### `specialIdentityCoordinator` — one global special-identity mutex

Deterministic `_id`: **`specialIdentityCoordinator.global`**. There is exactly one document because
every special create or date/name identity change must share a target-independent assertion. Its
identity and claim planner live in
[`app/utils/specialIdentityCoordinator.ts`](../app/utils/specialIdentityCoordinator.ts).

| Field | Type | Notes |
|-------|------|-------|
| `version` | number | Starts at `1` and advances by exactly one on every later claim. |
| `claimNonce` | string | Fresh for every claim, so an assertion necessarily changes stored state. |
| `updatedAt` | datetime | Claim timestamp. |

The first authorized identity transaction lazily `create`s version 1; there is no migration or
pre-created production document. Later claims patch under the coordinator `_rev`, advance version,
and replace the nonce in the **same transaction** as the special business write. Malformed state is
an integrity refusal, never repaired implicitly. A transaction conflict requires new occupancy and
coordinator evidence, not a blind retry. The global contention and rejected per-special-lock design
are recorded in [ADR-0011](adr/0011-serialize-special-identities-globally.md).

### `roleCreationReceipt` — the create-request mutex and idempotency tombstone

Deterministic `_id`: **`roleCreate.<sha256(requestId)>`**. It is the global mutex for
`creationRequestId` across *every* role type and target (the weekend lock only serializes one
weekend target), and it outlives the role it minted.

| Field | Type | Notes |
|-------|------|-------|
| `requestId` | string | The **exact** client `creationRequestId`. Equality is checked against this value, never the digest. Immutable. |
| `fingerprint` | string | Canonical create-payload hash. Same id + different fingerprint → `409 idempotency_mismatch`. Immutable. |
| `roleId` | **string** | Pre-generated role id. **Plain string** — the receipt must outlive the role it retired. Immutable. |
| `roleType` | string | `sunday_role` \| `saturday_role` \| `special_role`. |
| `targetIdentity` | string | `<roleType>:<date>`, or `special_role:<date>:<service name>`. Immutable. |
| `state` | string | `committed` \| `role_deleted`. |
| `createdAt`, `updatedAt` | datetime | |

Deleting a receipt-backed role flips `state` to `role_deleted` in the **same** transaction that
deletes the role and vacates the lock. Both states are durable idempotency tombstones: ordinary
cleanup never deletes them, and a retried key returns `409 idempotency_key_retired` rather than
recreating the service. Full replay semantics:
[API_REFERENCE](API_REFERENCE.md#creationrequestid--deterministic-creation-receipts).

---

## `solverConfig` — the shared planner rule set (singleton)

One document, always at `_id: "solverConfig"`
([`solverConfig.ts`](../sanity/schemas/solverConfig.ts)). It holds the rules the planner
enforces — the pools (`sundayLeads`, `saturdayLeads`, `support`), `restrictions[]` (with nested
`weekExclusions[]` and `caps[]`), `conflicts[]` and `presence[]` — plus `updatedAt` / `updatedBy`.
Shape mirrors `SolverConfig` in `app/components/admin/plannerModel.ts`.

The `_id` is fixed and deterministic because two rules depend on there being exactly one document:

- **`app/api/admin/solver-config` may only UPDATE it, never create it.** A POST against an absent
  document is `404 not_found`. Otherwise the first save from a browser holding no rules would mint
  the shared document out of the client's built-in defaults.
- **`scripts/seed-solver-config.ts` is the only writer that may create it, and it refuses if the
  document already exists**, printing a diff instead of overwriting.

Every array-of-object item carries a `_key` **equal to the rule's own `id`** — the `id` the UI's
`uid()` already assigned, not a second identifier. Minting happens in
[`app/utils/solverConfigWriteRequest.ts`](../app/utils/solverConfigWriteRequest.ts), which both the
route and the seed script go through so the two cannot drift.

Hidden and read-only in the Studio, **and** in `PROTECTED_STUDIO_TYPES` / `INTERNAL_STUDIO_TYPES`.
`hidden` only removes the affordance and `readOnly` only freezes the form, so a hand-typed
`/studio/structure/...` or intent URL still offered `delete`, `duplicate`, `restore` and
`unpublish` — a second write path around the `_rev`-checked route. `document.actions` is what
applies however the pane was reached, and it applies only to a governed type. Unlike
`notificationOutbox` nothing here is prunable by hand: its inspection pane is for diagnosis only.

**Status:** LIVE. Seeded to production 2026-08-02 from the rules captured out of the one
browser that held them (they differed from the shipped defaults in two material ways — three
deleted restrictions and three non-empty pools), and authoritative since the cutover. The
browser key `owt_solver_config_v3` is no longer read or written; the stale values still in
admins' browsers are inert. `owt_solver_history_v2` (the solver's fairness history) stays
per-browser on purpose. See [ADR-0010](adr/0010-specials-fill-locally-not-in-the-solver.md).

**Reading it from the client:** `useSolverConfig` (`app/components/admin/useSolverConfig.ts`),
mounted once by `ServicesPanel`, which threads the one controller to `MonthGenerator` for both
create-planning and stored-service month editing. Its four states — `loading` / `error` /
`absent` / `ready` — are the reason
a failed read cannot be mistaken for an empty document: only `ready` carries the `_rev` a save
needs, and only an enforceable state enables mutable grid operations
(`app/components/admin/solverConfigSource.ts`).

---

## `tag`, `author` — Taxonomies

- **`tag`** ([`tag.ts`](../sanity/schemas/tag.ts)): `{ name, slug }`. Referenced by `post.tags[]`.
- **`author`** ([`author.ts`](../sanity/schemas/author.ts)): `{ name, slug }`. Referenced by
  `post.authors[]`. Author docs power `/author` and `/author/[slug]`. Created idempotently by
  slug via `/api/content/authors`.

---

## `loginEvent` — Auth audit log

File: [`loginEvent.ts`](../sanity/schemas/loginEvent.ts). Append-only. `{ member → teamMembers,
email, provider, timestamp }`. Created programmatically by the app on every sign-in (never through
the Studio UI). Powers the admin login/activity dashboard (`/api/admin/login-events`). It still
declares `__experimental_actions: ["read", "delete"]`, but that property was **removed in Sanity v5
and is inert** — it is not restricting anything. See [Studio](#studio) for the mechanisms that
actually work.

---

## Inline object types (get a `_type` when written)

| `_type` | Shape | Used in |
|---------|-------|---------|
| `setlist_song` | `{ song→post, play_key, medley_tag }` | `featuredSongs`, `saturdarSongs`, `special_role` |
| `proposal_song` | same shape | `setlistProposal.songs` |
| `instrument_slot` | `{ instrument, person→teamMembers }` | all role docs |
| `foh_slot` | `{ role, person→teamMembers }` | all role docs |
| `chord_chart` | `{ key, content }` | `post.chords` |
| `chordsPDF` | `{ title, key, chordsPDF (file) }` | `post.chordsPDF` |
| `audioTrack` | `{ title, tone, audioFile (file) }` | `post.audioTracks` |
| `tutorial` | `{ title, url }` | `post.tutorials2` |
| `referenceLink` | `{ label, url }` | `post.referenceLinks` |
| `contributor` | `{ person→teamMembers }` | `setlistProposal.contributors` |
| `solverRestriction` | `{ id, person, excludedPatterns[], fairness, fairnessSlack, weekExclusions[], caps[] }` | `solverConfig.restrictions` |
| `solverWeekExclusion` | `{ id, week, pattern }` | `solverConfig.restrictions[].weekExclusions` |
| `solverCap` | `{ id, pattern, op, value, relative, relOffset }` | `solverConfig.restrictions[].caps` |
| `solverConflict` | `{ id, personA, personB, pattern }` | `solverConfig.conflicts` |
| `solverPresence` | `{ id, persons[], pattern }` | `solverConfig.presence` |

**Every array-of-object write must include a unique `_key` per item and the correct `_type`.**
The API routes generate keys with `Math.random().toString(36).slice(2,9)` and attach the right
`_type` (`instrument_slot`, `foh_slot`, `reference` for reference arrays, etc.).

---

## Draft/publish gating

The `published` boolean lives on the three **role docs** (`sunday_role`/`saturday_role`/
`special_role`, `initialValue: true`) and on **`kidsSchedule`** — where it is written by the
schedules route, defaults to `false`, and is read with a **stricter operator**. The two spellings
are not interchangeable; see "Kids gates on `published == true`" below. The pattern:

- **Member-facing GROQ filters `published != false`.** The `!= false` form treats a **missing**
  `published` as published ("grandfathered"), while explicit `false` is a draft. Used in
  `app/(client)/page.tsx`, `schedule/page.tsx`, `api/song/[id]/route.ts`, and more (9 files under `app/`).
  **Enforced, not just documented:** [`draftGatingCoverage.test.ts`](../app/utils/__tests__/draftGatingCoverage.test.ts)
  scans every `*[…]` filter group in `app/**` — and, separately, every bare filter-predicate
  string such as the one `assignedMemberRefsQuery()` takes — and fails on one that selects a role
  type without the filter. The scan is inverted (everything is checked unless exempt), so a new
  member-facing surface is covered by default; see the file's header for the two shapes it still
  cannot see. `MAY_SEE_DRAFTS` there holds the two reads that
  legitimately see drafts (`api/admin/**`, manager-gated; and `serviceReadQueries.ts`, the
  admin/write read model), each with its reason. **Do not add a member-facing query to either.**
- **Setlists have no flag**, so [`app/utils/draftGating.ts`](../app/utils/draftGating.ts)
  `publishedSetlist(role, setlist)` returns the setlist only when the (already
  `published != false`-filtered) role exists — otherwise a draft service would leak its song
  list before publish.
- **Transitions:** [`app/utils/publishTransitions.ts`](../app/utils/publishTransitions.ts)
  `computePublishTransitions(current, target)` returns `{ toPatch, toNotify }`. Only a genuine
  `false → published` transition triggers notifications.
- **New docs default to draft:** `/api/admin/roles` sets `published: body.published === true`.

### Kids gates on `published == true` — a different operator, on purpose

`kidsSchedule` is **minted with the field** by `PUT /api/kids/schedules` (`published: false`), so a
document without it is a bug rather than a legacy row. The worship `!= false` spelling exists to
grandfather documents that predate the field, and applied here it would wave that bug through —
so kids reads use `published == true`. `draftGatingCoverage.test.ts` scans `kidsSchedule`
separately for exactly this spelling; the two exemption maps beside it (`KIDS_MAY_SEE_DRAFTS`,
keyed by file, and `KIDS_LABELS_MAY_SEE_DRAFTS`, keyed by file **and** projection name) hold the
editor-side reads.

The gate is not only about visibility. Two reads feed the **fairness clock** — the generator's
history in `api/kids/generate` and the `"history"` projection on the planner page — and both filter
`published == true` because an unpublished Sunday is a proposal nobody was asked to serve
([ADR-0022](adr/0022-unpublished-kids-sundays-do-not-count-as-served.md)). `KidsPlanner` re-applies
the same filter client-side, which is **not** redundant: `loadMonth` refills that state from the
editor's endpoint, which returns drafts by design.

Deliberately ungated, both editor-side: the `"schedules"` projection on the planner page, and all of
`api/kids/schedules` — the month being edited and its writer, which must read a draft to publish it.

### Canonical vs member-visible — two different gates

The `published` field above is an **application** flag. Sanity's own draft mechanism
(`drafts.*` documents, created by Studio edits) is a **separate** layer. Never conflate them:

| Term | Definition |
|------|------------|
| **canonical** | a non-`drafts.*` document, as returned by the **published perspective** — *regardless of the app's `published` field value* |
| **member-visible** | canonical **and** passing the app-level `published != false` gate above |

So a service saved as an app-level draft (`published: false`) is still **canonical**: it exists
once, at one target, and counts as one. **Canonical counts, duplicate detection, and target
grouping never apply the app-level gate** — publish state is reported alongside
(`memberVisibleCount`), never folded in.

Why the distinction had to be made explicit: `sanity/lib/client.ts` sets no `perspective`, and
the default for this repo's `apiVersion` (`2024-07-23`, pre-`2025-02-19`) is **`raw`** — so
`drafts.*` overlays previously leaked into member-facing reads. See
[Sanity client setup](#sanity-client-setup) and
[ARCHITECTURE §8](ARCHITECTURE.md#8-canonical-operational-reads).

---

## Canonical target keys & content state

The pure, I/O-free rules that turn stored documents into a trustworthy read live in
[`app/utils/serviceReadModel.ts`](../app/utils/serviceReadModel.ts) (validation/grouping) and
[`app/utils/serviceReadSelect.ts`](../app/utils/serviceReadSelect.ts) (selection). They encode
the role/setlist split described above.

**Target keys** — what "the same service" means when documents are paired by `week`, not by ref:

| Kind | Key |
|------|-----|
| `sunday_role` / `saturday_role` | `<type>:<week>` |
| `special_role` | its own `_id` (it *is* the target) |
| Sunday / Saturday setlist | `featuredSongs:<week>` / `saturdarSongs:<week>` |
| `special_role` songs | the role `_id` (songs are embedded) |
| Proposal | `sunday:<date>` / `saturday:<date>` / `special:<service_ref>` |

Cardinality at a target is `none` (0) / `single` (1) / `duplicate` (>1); a relevant `drafts.*`
overlay makes the public-facing state **`draft_conflict`**.

**Deterministic ids derived from those keys** — every one of these is computed, never stored as a
free choice, so two writers racing for the same thing collide on the same document id:

| Document | Deterministic `_id` |
|----------|---------------------|
| Sunday / Saturday setlist | `featuredSongs.<week>` / `saturdarSongs.<week>` |
| Shared proposal | `setlistProposal.<roleId>` |
| Weekend target lock | `roleTarget.<roleType>.<date>` |
| Creation receipt | `roleCreate.<sha256(creationRequestId)>` |

Role documents themselves keep random ids — their uniqueness at a target is enforced by the lock and
the canonical grouping, not by the id.

**`setlistContentState(songs)`** → `empty` / `incomplete` / `ready` / `invalid`:
- `empty` — zero songs; `incomplete` — a well-formed row with a blank `play_key`;
- `ready` — every row well-formed, resolvable, and carrying a `play_key`;
- **`invalid`** — malformed structure, missing/duplicate `_key`, or a missing/**dangling** song
  reference. Malformed data is **`invalid`, never ordinary `incomplete`.**

**Role validity** is checked across all five seat paths (§ above): each seat must be an array of
well-formed items with unique `_key`s and the right `_type` (`reference` / `instrument_slot` /
`foh_slot`) — a missing or non-array seat is invalid, an empty array is valid-with-zero.
`resolveMembers()` then reports refs with no canonical `teamMembers` document as **dangling**
(never dropped, never treated as empty). Proposals are validated the same way and indexed twice
(by `service_ref` and by target key), so a grouping conflict is visible in either dimension.

**Selection fails closed.** `pickUnique()` returns the document only when the canonical group
holds exactly one — a duplicate target yields **nothing**, never an arbitrary `[0]`.
`indexUniqueByKey()` omits any key claimed twice; `canonicalizePlayHistory()` contributes no
rows for an ambiguous target (so play history is never double-counted); `serviceDayKey()`
returns `null` for a malformed stored date so the row is dropped as an integrity issue instead
of reaching `.slice()` / `new Date()` / a `localeCompare` sort.

---

## Medley grouping

`setlist_song` / `proposal_song` carry a hidden `medley_tag`. **Consecutive** songs sharing the
same non-empty tag render as one grouped medley. Managed by
[`app/utils/medley.ts`](../app/utils/medley.ts):
- `buildRuns(items)` groups a flat list into single/medley "runs" (positional — adjacency
  matters).
- `normalizeMedleyTags(items, newTag)` re-derives tags after reorder/remove: runs of length ≥2
  get a fresh unique tag; orphaned singles are cleared. Call it after any order/membership change.

---

## Sanity client setup

- **[`sanity/env.ts`](../sanity/env.ts)** (one level above `lib/`) — `projectId`/`dataset`
  (asserted, throw if missing), `apiVersion` (default `2024-07-23`). The three `lib/` clients
  import it as `'../env'`.

The clients live in [`sanity/lib/`](../sanity/lib/):
- **`client.ts`** — anonymous read client, `useCdn: false` (ISR pages must read live after
  `revalidatePath`; no token).
- **`serverClient.ts`** — `serverClient` (read token `SANITY_API_READ_TOKEN`, for server
  components + auth callbacks) and `writeClient` (write token `SANITY_WRITE_TOKEN`, admin
  mutations only). Both `useCdn: false`.
- **`operationalClient.ts`** — `server-only`. Two explicitly-perspectived clients:
  - **`operationalClient`** (`perspective: "published"`, `useCdn: false`) — the **only** runtime
    read source for the six protected types (`sunday_role`, `saturday_role`, `special_role`,
    `featuredSongs`, `saturdarSongs`, `setlistProposal`). The read token is optional: it widens
    document access, never the perspective.
  - **`rawIntegrityClient`** (`perspective: "raw"`, tokened) — exists **solely to inventory
    `drafts.*` documents as integrity evidence**; never a runtime content source. Its queries
    are scoped with `_id in path("drafts.**")`.
- **`image.ts`** — `@sanity/image-url`. `urlFor(source)` and `urlForImage(source)` (the latter
  adds `.auto('format').fit('max')`).

> **Perspective is the load-bearing setting.** `client.ts` / `serverClient.ts` set **no**
> `perspective`, and the default for `apiVersion` `2024-07-23` (pre-`2025-02-19`) is **`raw`** —
> unpublished Studio drafts were overlaid onto member reads. That is why the protected types now
> read through `operationalClient` only, and why a static audit
> ([`app/utils/protectedReadAudit.ts`](../app/utils/protectedReadAudit.ts)) fails any new query
> site that bypasses it without an exact `file + operation` exemption.
> → [ARCHITECTURE §8](ARCHITECTURE.md#8-canonical-operational-reads).

## GROQ conventions

There is **no central query module** — GROQ lives inline in pages/routes as template strings,
often with per-file reusable fragments (`SONG_PROJ`, `SETLIST_SONGS`, `ROLE_FIELDS`, etc.).
Rules of thumb:
- Always use bound `$params`; never interpolate user input (the only two audited exceptions are
  the trusted `roleFilter` and opaque FCM tokens).
- **Protected types read through `operationalClient`**, ideally via the bound query builders in
  [`app/utils/serviceReadQueries.ts`](../app/utils/serviceReadQueries.ts) (they return
  `{ query, params }` and share the canonical projections). A `serviceReadQueries` helper
  executed by a *non*-canonical client is exactly the bypass the audit catches.
- Member-facing reads: filter `published != false` (the *member-visible* gate — canonical
  grouping and counts must not use it).
- "Who serves?": reuse `assignedMemberRefsQuery()`.
- Recent plays / song history: `*[_type in ["featuredSongs","saturdarSongs"] && references($id)] | order(week desc)`,
  then collapse with `canonicalizePlayHistory()` so a duplicate target can't double-count a play.

## Studio

`sanity.config.ts` mounts the Studio at `basePath: '/studio'` with `structureTool()` +
`visionTool()` (GROQ playground). It's embedded at
[`app/(admin)/studio/[[...tool]]/page.tsx`](../app/(admin)/studio/[[...tool]]/page.tsx) via
`NextStudio`, and access is restricted to `admin`/`super-admin` by `proxy.ts`. Schema changes
require a Studio deploy to appear in the Studio UI (the app reads/writes via GROQ regardless).

### Protected types in the Studio — read-only, no mutating path

The Studio is a *second* writer into the same dataset, so it would otherwise bypass every guard in
[API_REFERENCE → the protected mutation contract](API_REFERENCE.md#the-protected-mutation-contract).
**Thirteen** types are closed to it — the six protected service types, the five internal types
(`notificationOutbox` keeps `delete` alone, so an operator can prune a stray entry) **plus** the two
Oasis Kids types, whose writer is the app (`/api/kids/pairs`, `/api/kids/schedules`):

`sunday_role`, `saturday_role`, `special_role`, `featuredSongs`, `saturdarSongs`, `setlistProposal`,
`roleTargetLock`, `roleCreationReceipt`, `notificationOutbox`, `specialIdentityCoordinator`,
`solverConfig`, `kidsPair`, `kidsSchedule`.

The kids pair is protected but **not** internal: unlike the coordination types it is a
human-meaningful document, so it stays visible (read-only) rather than `hidden: true`. What
protection buys there is the create affordance — a Studio-created `kidsSchedule` gets a RANDOM
`_id` instead of `kidsSchedule-<YYYY-MM-DD>`, forking a Sunday that already exists.

The rules are pure and unit-tested in
[`app/utils/studioProtection.ts`](../app/utils/studioProtection.ts) (`PROTECTED_STUDIO_TYPES`,
`studioCapability()`), and wired in `sanity.config.ts` + [`sanity/structure.ts`](../sanity/structure.ts)
through **four Sanity v5 mechanisms**:

1. **`document.actions` → `[]`** — every action is filtered out for a protected type, built-in or
   plugin, including `delete`, `duplicate`, `publish`, `unpublish`, `discardChanges`,
   `discardVersion`, `unpublishVersion`, `restore`, `schedule`, and the Canvas trio
   (`linkToCanvas` / `editInCanvas` / `unlinkFromCanvas`). An action with no identifier is dropped
   too — **fail closed**. This is what closes the direct-URL path.
2. **`document.newDocumentOptions`** — protected types are removed from every create affordance.
3. **schema `readOnly: true`** on the document type — the whole form is non-editable.
4. **`structureTool({structure})`** — protected types are removed from the default document-type list
   and re-offered under a read-only group *"Servicios (solo lectura)"*, so an operator can still
   inspect, diff, and read history. Read-only capabilities (`read`, `inspect`, `history`, `preview`,
   `structure-list`) stay allowed on purpose; any unknown capability on a protected type is denied.

The internal types are additionally `hidden: true`, and the internal *fields*
(`creationReceiptId`, `creationFingerprint`, the lock/receipt bodies, `approval_receipt`,
`last_transition`, and the special coordinator body) are `hidden` + `readOnly` individually.

> **⚠️ `__experimental_actions` is NOT the mechanism.** It was removed in Sanity v5 and is **inert**
> — a test asserts no protected schema file contains it. The one remaining occurrence, on
> `loginEvent`, therefore does nothing and is not load-bearing. Do not "fix" protection by adding it.

**Deploy note:** the Studio protection lives in app code and is active as soon as the app deploys,
but internal schema *types* only appear in a deployed Studio after a Sanity schema deploy — see
[DEVELOPMENT.md](DEVELOPMENT.md).
