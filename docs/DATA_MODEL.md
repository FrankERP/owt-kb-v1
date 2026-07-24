# Data Model — Sanity Content Lake

Everything the app stores lives in **Sanity** (project `ebb8vcnk`, dataset `production`,
API version default `2024-07-23`). Schemas are in [`sanity/schemas/`](../sanity/schemas/) and
registered in [`sanity/schema.ts`](../sanity/schema.ts). The type `name` values below are the
exact strings used in GROQ `_type` filters.

> **Read this before any query or write.** The two most error-prone quirks — the deliberate
> `saturdarSongs` typo and the split between role docs (assignments + publish flag) and setlist
> docs (songs) — are explained here.

---

## Registered document types (11)

`post`, `tag`, `author`, `featuredSongs`, `saturdarSongs`, `saturday_role`, `sunday_role`,
`teamMembers`, `special_role`, `loginEvent`, `setlistProposal`.

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
| `chords` | array of `chord_chart` | `{ key, content (text, chords written above lyric lines) }`. **The multi-chart landmine lives here.** |
| `referenceLinks` | array of `referenceLink` | `{ label, url }`. |
| `tags` | array of reference → `tag` | Taxonomy. |
| `authors` | array of reference → `author` | Structured authors (parallel to the `author` string). |

**Landmine:** `SongFormModal`/`EditSongButton` collapse a multi-entry `chords` array to a
single chart on save. 0 songs affected today; treat as a feature to fix deliberately, not a
drive-by patch.

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
| `lead_notes` | text | "Notas del líder." |
| `team_notes` | text | Published to the team on approval. |
| `admin_notes` | text | |
| `submitted_at`, `reviewed_at` | datetime (readOnly) | |

**Concurrency:** the write path uses a **deterministic `_id`** (`setlistProposal.<roleId>`) as a
create-mutex and `ifRevisionId` optimistic locking — co-lead collisions return **409**. See
[API_REFERENCE.md](API_REFERENCE.md#post-apimeproposals).

---

## `tag`, `author` — Taxonomies

- **`tag`** ([`tag.ts`](../sanity/schemas/tag.ts)): `{ name, slug }`. Referenced by `post.tags[]`.
- **`author`** ([`author.ts`](../sanity/schemas/author.ts)): `{ name, slug }`. Referenced by
  `post.authors[]`. Author docs power `/author` and `/author/[slug]`. Created idempotently by
  slug via `/api/content/authors`.

---

## `loginEvent` — Auth audit log

File: [`loginEvent.ts`](../sanity/schemas/loginEvent.ts). Append-only. `{ member → teamMembers,
email, provider, timestamp }`. Uses `__experimental_actions: ["read", "delete"]` — created
programmatically by the app on every sign-in (never through Studio UI). Powers the admin
login/activity dashboard (`/api/admin/login-events`).

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

**Every array-of-object write must include a unique `_key` per item and the correct `_type`.**
The API routes generate keys with `Math.random().toString(36).slice(2,9)` and attach the right
`_type` (`instrument_slot`, `foh_slot`, `reference` for reference arrays, etc.).

---

## Draft/publish gating

The `published` boolean lives on **role docs only** (`sunday_role`/`saturday_role`/`special_role`),
`initialValue: true`. The pattern:

- **Member-facing GROQ filters `published != false`.** The `!= false` form treats a **missing**
  `published` as published ("grandfathered"), while explicit `false` is a draft. Used in
  `app/(client)/page.tsx`, `schedule/page.tsx`, `api/song/[id]/route.ts`, and more (9 files under `app/`).
- **Setlists have no flag**, so [`app/utils/draftGating.ts`](../app/utils/draftGating.ts)
  `publishedSetlist(role, setlist)` returns the setlist only when the (already
  `published != false`-filtered) role exists — otherwise a draft service would leak its song
  list before publish.
- **Transitions:** [`app/utils/publishTransitions.ts`](../app/utils/publishTransitions.ts)
  `computePublishTransitions(current, target)` returns `{ toPatch, toNotify }`. Only a genuine
  `false → published` transition triggers notifications.
- **New docs default to draft:** `/api/admin/roles` sets `published: body.published === true`.

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

`sanity.config.ts` mounts the Studio at `basePath: '/studio'` with `structureTool()` (default
desk structure) + `visionTool()` (GROQ playground). It's embedded at
[`app/(admin)/studio/[[...tool]]/page.tsx`](../app/(admin)/studio/[[...tool]]/page.tsx) via
`NextStudio`, and access is restricted to `admin`/`super-admin` by `proxy.ts`. Schema changes
require a Studio deploy to appear in the Studio UI (the app reads/writes via GROQ regardless).
