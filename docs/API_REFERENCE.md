# API Reference — `app/api/`

36 route handlers (`route.ts` files). Most talk to Sanity through `serverClient` (read) /
`writeClient` (write). Exceptions: `/api/practice-playlist` uses the CDN `client`, and
`/api/admin/solve` touches no Sanity at all (it calls the external solver / spawns a subprocess).

**Reads of the six protected service types** (`sunday_role`, `saturday_role`, `special_role`,
`featuredSongs`, `saturdarSongs`, `setlistProposal`) go through **`operationalClient`**
(published perspective) — `rawIntegrityClient` (raw) only inventories `drafts.*` as evidence.
A static audit fails any route that bypasses this without an exact `file + operation` exemption.
**No route is exempt from the read rule any more:** the temporary A1 handoff allowlist is empty,
and the guarded mutation routes are licensed to *write* only — a non-canonical read in one of them
still fails the audit. → [ARCHITECTURE §8](ARCHITECTURE.md#8-canonical-operational-reads).

## Authorization primitives

Defined in [`app/utils/authGuards.ts`](../app/utils/authGuards.ts):

- **`requireActiveSession()`** — requires a session with a `sanityId` **and** an active member
  (`isMemberActive`, 30s TTL). Returns the session or `null`. Any authenticated active member.
- **`requireActiveManager()`** — the above **plus** role ∈ `{super-admin, admin, content-editor}`.

Both resolve the **effective** `sanityId` (honors impersonation; a disabled impersonation target
is blocked). Roles: `super-admin` > `admin` > `content-editor` > `member`. Many routes call
`requireActiveManager()` then **narrow inline** — e.g. exclude `content-editor`, or require
`super-admin`. There is no dedicated super-admin guard function; it's an inline string check.

## Shared side-effect helpers

- `revalidateServiceViews()` → revalidates `/`, `/schedule`, `/posts/[slug]`.
- `revalidateSongViews()` → `/`, `/posts/[slug]`, `/tag`, `/tag/[slug]`.
- `sendPush(memberIds, category, payload)` — FCM, category-gated by `notifPrefs`.
- `sendAssignmentEmails(...)` / `sendAssignmentEmailsBatch(...)` — allowlist + opt-out gated.
- `notifyProposalSubmitted(...)` — push/email fan-out for proposals. **Fail-closed on identity:**
  it resolves the role through the canonical contract and sends **nothing at all** when that
  identity is missing, ambiguous (duplicate), structurally invalid, or draft-conflicted. The
  admin email includes the proposed setlist table (no Mov. column) and lead notes when present.

> **Convention for new mutating routes:** validate → check auth → write → **revalidate the
> affected ISR pages** → fire best-effort notifications (never let a notify failure fail the
> write) → return `res.ok`-friendly JSON.

Every side effect for the protected service mutations is centralized in
[`app/utils/serviceMutationSideEffects.ts`](../app/utils/serviceMutationSideEffects.ts) — routes
build a *notice* and hand it over; they never assemble a recipient list themselves. Recipients are
derived from **committed server state across all five seat paths** through `operationalClient`, so a
`drafts.*` overlay can never widen an audience, and a client-supplied list is never trusted.
Delivery is **best-effort at-most-once**: one deferred attempt (`after()`) per committed request,
every failure logged and swallowed (`[sideEffects] <label> failed:`), never rolled back. Nothing
fires unless a business commit succeeded — prevalidation rejections, transaction conflicts, no-op
idempotent retries, unpublishes, removals, and draft edits are silent by construction. **No
exactly-once claim is made; that would need an outbox.**

---

## The protected mutation contract

Every writer of a protected service type (`sunday_role`, `saturday_role`, `special_role`,
`featuredSongs`, `saturdarSongs`, `setlistProposal`) obeys one contract: reject stale or ambiguous
state, serialize against every competing writer, and commit all business changes or none. Shared
helpers: [`serviceMutation.ts`](../app/utils/serviceMutation.ts) (error model),
[`roleWriteRequest.ts`](../app/utils/roleWriteRequest.ts),
[`setlistWriteRequest.ts`](../app/utils/setlistWriteRequest.ts),
[`proposalWriteRequest.ts`](../app/utils/proposalWriteRequest.ts),
[`roleTargetLock.ts`](../app/utils/roleTargetLock.ts),
[`roleCreationReceipt.ts`](../app/utils/roleCreationReceipt.ts),
[`specialIdentityCoordinator.ts`](../app/utils/specialIdentityCoordinator.ts),
[`roleDependencies.ts`](../app/utils/roleDependencies.ts).

### Error envelope

Every rejection (other than the auth denials, which stay `{error:"Forbidden"}` / `{error:"Unauthorized"}`):

```ts
{ error: ServiceErrorCode, message: string, conflict: boolean, details?: Record<string, unknown> }
```

`conflict: true` ⇔ the code is a conflict code ⇔ **409**. `serviceErrorStatus` **fails closed to
409** for an unregistered code. `details.issues[]` carries parse-issue tags on `invalid_request`;
`details.detail` carries a discriminator string on conflicts.

| Code | Status | Meaning |
|------|--------|---------|
| `invalid_request` | 400 | Rejected before any write (bad JSON, parse issue, non-canonical id, wrong stored `_type`). |
| `forbidden` | 403 | Registered but unused — routes emit the raw `{error:"Forbidden"}` body. |
| `not_found` | 404 | The id resolves to **zero** canonical documents. |
| `stale_revision` | 409 | A client-observed document/lock revision no longer matches stored state (or the commit lost the race). |
| `ambiguous_target` | 409 | The target resolves to zero-or-many canonical documents, or a duplicate group / index disagreement. |
| `integrity_conflict` | 409 | Malformed, dangling, wrong-owner, or draft-conflicted stored state that must **never** be repaired implicitly. |
| `idempotency_mismatch` | 409 | Same `creationRequestId`, **different** canonical payload fingerprint. |
| `idempotency_key_retired` | 409 | The `creationRequestId` belongs to a receipt whose role was deleted. |
| `bootstrap_completed_reload` | 409 | Legacy lock maintenance **committed**, then the business step conflicted. Reload and retry. |
| `target_has_orphaned_dependencies` | 409 | Create target already carries orphaned setlist/proposal history. |
| `role_date_has_dependencies` | 409 | The old or destination date of a move carries dependent history. |
| `role_has_dependencies` | 409 | The deletion target carries dependent history. |
| `legacy_approval_unverified` | 409 | An `approved` proposal with no verifiable approval receipt. |

A **non-conflict** Sanity error is rethrown (→ 500), never converted into a business code.

### Client-observed revisions

A mutation never trusts a freshly fetched server revision — the client submits the revision **it
actually loaded/reviewed**, and a mismatch is `409 stale_revision` with the modal/card left open.

| Operation | Required revision fields |
|-----------|--------------------------|
| `PATCH`/`DELETE /api/admin/roles/[id]` | `rev` (role `_rev`), optional `lockRev` (the owned `roleTargetLock._rev`) |
| `POST /api/admin/roles/publish` | `roles[].rev` per `roles[].id` |
| `POST /api/admin/roles/swap` | `source.rev` + `target.rev` (seat), or `roles[0..1].rev` (team) |
| `POST /api/admin/roles/copy-instruments` | `source.rev` + `target.rev` |
| `PUT /api/admin/setlists` | `observed: {state:"single", id, rev}` or `observed: {state:"none"}` |
| `POST /api/me/proposals` | `observed` (same shape, the proposal's id/rev) |
| `PATCH /api/admin/proposals/[id]` | `rev` — the proposal revision the admin reviewed |
| `POST /api/admin/roles` (create) | none — idempotency is the `creationRequestId` receipt |

Revision strings: non-empty, ≤200 chars, no whitespace. Ids: non-empty, ≤200 chars, no whitespace,
**never** prefixed `drafts.`.

### `creationRequestId` + deterministic creation receipts

`POST /api/admin/roles` requires one bounded opaque **`creationRequestId`** per logical create
(8–128 chars, `/^[A-Za-z0-9._:-]+$/`). The server canonicalizes the *complete* create payload and
hashes it:

- **included** in the fingerprint — `roleType`, normalized `date` day key, `targetIdentity`,
  normalized `serviceName` (special only), effective `published`, and the ordered/normalized
  `leads`/`bgvs`/`chorus`/`instruments`/`foh` inputs, plus a version marker;
- **excluded** — the request id itself, the role `_id`, generated `_key`s, and all timestamps.
  Ordering is codepoint, never `localeCompare`.

The **`roleCreationReceipt`** is the global create-request mutex across *every* role type and
target. Its `_id` is `roleCreate.<sha256(requestId)>`; it stores the exact `requestId` (equality is
checked against the stored value, never the digest), the `fingerprint`, the pre-generated `roleId`,
`roleType`, `targetIdentity`, and `state: committed | role_deleted`. One transaction `create`s
(never `createIfNotExists`) the receipt, creates the role, and claims/reclaims the weekend lock.

| Replay outcome | Result |
|----------------|--------|
| Same id, same fingerprint, live role carries the receipt | **200** with the committed role + `replay: true` — **no writes, no notifications, no revalidation** |
| Same id, different fingerprint (incl. a different date, role type, or special name) | **409 `idempotency_mismatch`** |
| Receipt `state: role_deleted` | **409 `idempotency_key_retired`** — the role is never recreated |
| Receipt present, result role missing/wrong type | **409 `integrity_conflict`** — never recreated implicitly |

Deleting a receipt-backed role flips its receipt to `role_deleted` **in the same transaction** that
deletes the role and vacates the lock: a durable idempotency tombstone. A later recreation is a new
logical create and needs a new request id. `MonthGenerator` mints one id per preview `DraftCard`
(distinct from the UI `localId`) and reuses it byte-for-byte across edits, partial-batch retries,
and lost responses; `ServicesPanel` mints one per add-modal logical submission.

### Weekend `roleTargetLock`

A hidden `roleTargetLock` serializes **one weekend target** (never the create-request mutex — that
is the receipt). Deterministic `_id` `roleTarget.<roleType>.<date>` from the target key
`<roleType>:<date>`; fields `targetKey`, `state: claimed | vacant`, `roleId` (a **plain string**),
`roleType`, `date`, `claimNonce`, `generation`, `createdAt`, `updatedAt`.

- `claimed` has exactly one non-empty `roleId` owning the same target; `vacate` clears `roleId` /
  `claimNonce` and **advances `generation`**. Deletion **vacates**, never deletes the lock.
- **`special_role` takes no weekend lock** — its target key is its own `_id`, so weekend lock
  derivation returns `null`. Its revision serializes ordinary same-document changes; the global
  coordinator below serializes identity claims that can involve different documents.
- Every Sunday/Saturday writer asserts or heartbeats (`set updatedAt` under `ifRevisionId`) the
  owned lock **in the same business transaction**. Wrong-owner and orphan locks are integrity
  issues, never reclaimed implicitly.

**Legacy bootstrap:** when exactly one canonical legacy weekend role has no lock, a *separate*
maintenance transaction revision-guards a no-op write of that role's own unchanged date field and
creates the claimed lock; the writer then continues only from the produced revisions. If the
business step then conflicts, the response is **`409 bootstrap_completed_reload`** — business
fields are unchanged and no notification/revalidation ran, but the lock and the advanced role
revision intentionally persist. All body/id/type/cardinality, revision, raw-draft, ambiguity, and
dependency validation runs **before** bootstrap, so an invalid request writes nothing at all.

### Global `specialIdentityCoordinator`

Special identity is the normalized `{date, service_name}` pair, so a role's own `_rev` cannot
serialize two distinct documents trying to claim the same destination. Every special create and
every date/name identity-changing PATCH therefore claims the deterministic internal document
`specialIdentityCoordinator.global` in the same transaction as the business write.

- The published-perspective operational loader accepts exactly zero or one row and refuses malformed
  ID/type/revision/version/nonce/timestamp state as `integrity_conflict`; it never repairs state.
- An absent coordinator is lazily `create`d at `version: 1` with a fresh `claimNonce`. There is no
  migration or implementation-time production write.
- A present coordinator is patched under its observed `_rev`; the claim advances `version` and writes
  a fresh nonce/timestamp so the assertion cannot be a no-op.
- A coordination conflict triggers new receipt, normalized-occupancy, and coordinator evidence. The
  business transaction is never blindly replayed. An inert coordinator may remain after code rollback.

The schema is hidden/read-only and the Studio removes every create, mutate, and delete affordance.
See [DATA_MODEL](DATA_MODEL.md#specialidentitycoordinator--one-global-special-identity-mutex) and
[ADR-0011](adr/0011-serialize-special-identities-globally.md).

### Dependency refusal policy

Normal create / date-move / delete **never** cascades, adopts, migrates, archives, or deletes
service history. Before any coordination maintenance, the writer inventories date-keyed canonical
**and** raw-draft setlists (`references(roleId)` cannot find them — they are paired by `week`),
proposals through **both** indexes (`service_ref` and target key, every status, malformed/dangling
records, raw drafts), unknown strong references, and a special service's embedded `songs`. A
destination proposal blocks even when it references another or a missing role; approved proposal
history makes ordinary date/history mutation immutable. Refusal returns the exact ids/types in
`details.dependencies[] = {id, type, kind, scope}` (`kind` ∈ `canonical_setlist`,
`raw_setlist_draft`, `proposal`, `raw_proposal_draft`, `malformed_proposal`, `special_songs`,
`unknown_reference`) under one of the three dependency codes above, and leaves every business
document byte-for-byte unchanged.

---

## Auth

### `GET|POST /api/auth/[...nextauth]`
`app/api/auth/[...nextauth]/route.ts` re-exports `GET, POST` from [`auth.ts`](../auth.ts).
NextAuth handler with three providers (Google web OAuth, `google-native` credentials verifying a
native Google ID token, email/password bcrypt). **Public** (this *is* the auth endpoint), but
each provider rejects non-members / disabled members. Side effects: writes a `loginEvent` on
every sign-in; patches `googlePhotoUrl` on Google sign-in; the `jwt` callback enforces
super-admin-only impersonation and live role/revocation refresh. Full detail in
[AUTH_AND_SECURITY.md](AUTH_AND_SECURITY.md).

---

## Me — self-service (any active member; `requireActiveSession`, 401 otherwise)

| Route | Methods | Purpose & side effects |
|-------|---------|------------------------|
| `/api/me` | GET, PATCH | GET own member doc (incl. `hasPassword`). PATCH `{alias?, email?}` (email regex-validated) → `revalidateServiceViews()` + `revalidatePath("/me")`. |
| `/api/me/availability` | GET, PATCH | GET returns `{_rev, unavailableDates[], unavailabilityNotes[]}`. PATCH **requires `_rev`** (400 if missing — never a fallback to an unconditional write) and commits under `ifRevisionId`; **409 `{error:"stale_revision", _rev, …}` means the write did NOT land** and carries the winner's state, 200 returns the new `_rev`. Validates ISO dates, unique per date (`_key`=date). No revalidation. **`unavailableDates` has exactly two writers — this route and `/api/kids/members/[id]/availability` — and both are now revision-guarded;** before that, whichever saved second silently deleted the other's dates. The client rebases **once** when the conflicting state's base is byte-identical (a sibling `/api/me*` write from the same page, where re-issuing cannot delete anything) and discards on any further conflict. |
| `/api/me/notif-prefs` | PATCH | `{email?, assignments?, proposals?, reminders?, setlist?}` (booleans; `setlist` bool → `"all"`/`"off"`). Writes `notifPrefs.*`. |
| `/api/me/theme` | PATCH | `{theme: "dark" \| "light" \| "system"}` → writes `themePref`. **403 while impersonating — deliberately stricter than `PATCH /api/me`, do not "harmonise" it:** impersonation rewrites `session.user.sanityId` to the target, so without the guard a super-admin would persist their theme onto someone else's record from a UI action that looks local. A name correction is plausibly made on a member's behalf; a theme is not. `"system"` became legal at Child F, together with the `enableSystem` flip that makes it resolvable — the two are one change, and the 400 body is derived from the accepted set so it cannot drift. No `revalidate*` — per-member chrome, no ISR page renders it. |
| `/api/me/password` | POST | `{currentPassword?, newPassword}` (≥8 chars). Verifies current via bcrypt if a hash exists; sets `passwordHash` (cost 12). |
| `/api/me/photo` | POST | multipart `photo`. 5 MB max, MIME whitelist + **magic-byte** check (413/415). Uploads Sanity asset, sets own `profilePhoto` → `revalidateServiceViews()` + `revalidatePath("/me")`. |
| `/api/me/proposals` | GET, POST | GET proposals for every service the user Leads (incl. `_rev`). POST creates/updates the **one shared proposal** (Leads only): `{roleId, observed, songs, leadNotes?, teamNotes?, status: "draft"\|"pending"}`. Resolution uses A1's **two** indexes (`service_ref` + target key), never an arbitrary `[0]`; deterministic `_id` `setlistProposal.<roleId>` is the first-create mutex (`tx.create`, so a co-lead race is a real conflict); `observed` gates every update; the weekend lock or the special-role revision is asserted in the same transaction; `service_type`/`service_date` are **refreshed from the authorized canonical role**, never accepted from the client. Fires `notifyProposalSubmitted` when `status="pending"`. **`leadNotes` becomes a thread message, under a two-part rule:** appended only when it is non-empty AND differs (trimmed) from the **newest `lead_note` message**. Nothing is mirrored — `lead_notes` is never written by this route. Both halves matter: the client re-sends that field verbatim on every save, so an unconditional append mints duplicate bubbles permanently (there is no delete path), and the non-empty half is what stops a pre-Child-A client's cleared textarea appending an empty message. **The comparison target moved from the stored `lead_notes` to the thread** when the mirror was removed — that field is frozen now, so comparing against it would let a lead who posts in the thread and then saves duplicate their own message. The response carries `messages` (or `null`, meaning the write landed and the read-back did not — the client keeps what it has). |
| `/api/me/proposals/[id]/messages` | POST | `{body}` → appends one `lead_note` to the thread. Guard: `requireMinistryMember("worship")`, caller ∈ the role's Leads, `published !== false`, **and `isThreadOpen(service_date)` server-side** — the conversation closes when the SERVICE passes, not on approval, and a hidden composer is not a guard. `setIfMissing` + `append`, **no `ifRevisionId`**: two co-leads posting at once must both land. **Mirrors nothing** — `lead_notes` is a frozen archive — and queues the existing debounced admin notice with a PRE-COMMIT snapshot (`beforeNotes` plus the pre-commit `lead_note` count). **Pushes ADMINS on `approved` only** (`Nuevo mensaje`, `/admin`, author excluded) — the status the debounced email does not cover, so one message yields one signal and never both. Returns `{message, messages, rev, observedRev}`. |
| `/api/admin/proposals/[id]/messages` | POST | Same shape for an `admin_change_request`. `requireActiveManager`, not `content-editor`. **Does NOT touch `admin_notes`** — that field is the change-request archive the rollback leans on, and **nothing mirrors it any more** — the transition was its last writer and Child B stopped that too. **Pushes the LEAD + contributors** via `notifyProposalReview` with NEW copy (`Nuevo mensaje`), the posting admin excluded through its optional third parameter — applied BEFORE the empty-audience guard, or a proposal whose only recipient is the author would push them. No ministry check, inherited from the transition route beside it (`FrankERP/owt-kb-v1#8`). |
| `/api/me/push-token` | POST, DELETE | Register/remove an FCM `deviceToken` (token validated against `/^[A-Za-z0-9_:.-]{1,4096}$/`, GROQ-injection guard). |
| `/api/me/songs` | GET | `?q=` search of `post` by title/author (prefix); up to 30/50 results. |

---

## Oasis Kids

Every route below is gated by `requireMinistryManager("kids")` → **403** when it
returns null. That guard passes for `super-admin` or a member whose
`managesMinistries` includes `"kids"` — **plain `admin` does NOT pass**, which is the
two-way isolation rule (see `CLAUDE.md` § Auth). All mutating routes call
`revalidateKidsViews()`.

| Route | Methods | Purpose & side effects |
|-------|---------|------------------------|
| `/api/kids/pairs` | GET, POST | GET every pair (`active` coalesced, so a field-less doc is not silently dropped from rotations). POST `{name, room, memberIds:[a,b]}` — `members[]` written with `_key = _ref`; `memberIds` must resolve to `teamMembers` whose normalized `ministries` include `kids` (shared `validatePairMembers`). |
| `/api/kids/pairs/[id]` | PATCH | `{name?, room?, memberIds?, active?}`, each applied only when present (the field is `memberIds`, matching POST — a body sending `members` matches no arm and 400s as "Nothing to update"). **Fetches the target's `_type` first and 404s anything that is not a `kidsPair`** — without it the route patched whatever id the path named, and `tag`/`author` both have a real `name` field. A non-existent id is a 404, not a 500. |
| `/api/kids/schedules` | GET, PUT | GET `?month=YYYY-MM` (string bounds, no `Date` math; `published` projected through `coalesce(…, false)` because GROQ has no boolean default). PUT `{date, seats, published?}` upserts at the deterministic `_id` `kidsSchedule-<YYYY-MM-DD>` via `createIfNotExists` + `patch`, so a re-generate updates in place and two concurrent saves cannot fork a Sunday. Re-validates room-vs-seat, retired pairs and one-seat-per-pair server-side rather than trusting the dropdown. `.unset()` is skipped when nothing is being cleared. |
| `/api/kids/generate` | POST | `{month, seed?, exclude?}` → `RotationResult & {seed, fingerprint, exhausted}`. **Read-only, writes nothing** — under a seed too. Reads the month's worship assignments through `operationalClient` with `published != false` (a Kids planner must never be the surface that reveals a draft worship roster) purely to emit overlap **warnings** — never a block. Its own **history read filters `published == true`** — an unpublished Sunday is a proposal, not a served turn, so it never feeds the fairness clock (ADR-0022). The two spellings on this one route are deliberate and not a typo: `!= false` for the worship types that predate the field, `== true` for `kidsSchedule`, which is minted with it. **`seed: 0` (or absent) is always the strictly fairest month** and is returned even when `exclude` already contains it, because that is what «Generar mes» means. A **non-zero seed is «Otra opción»**: the route walks forward from that seed, up to `MAX_SEED_ATTEMPTS`, for the first plan whose `fingerprint` is not in `exclude` — the search runs on the already-fetched data (`planKidsMonth` is pure), so it costs no extra Sanity reads and no extra round trips. When every reachable arrangement is already in `exclude` it answers `{exhausted:true, proposal:[], fingerprint:null}` and the planner **leaves the board untouched** rather than redrawing a month the admin just rejected. See ADR-0021 for why alternatives spend a bounded amount of fairness instead of only breaking ties. |
| `/api/kids/members` | GET | Members whose `ministries` include `kids`, with `_rev`, `unavailableDates` and `unavailabilityNotes`. `_rev` is **contract, not debug clutter** — the availability PATCH requires it. |
| `/api/kids/members/[id]/availability` | PATCH | `{_rev, unavailableDates[], unavailabilityNotes[]}` — the admin-side override for volunteers who never sign in, writing the **same fields the member's own `/me` calendar writes**. 404 unless the target's normalized ministries include `kids` (checked before anything else, so a Kids manager learns nothing about a worship member). **`_rev` is mandatory — a missing one is 400, never an unconditional write**, because the fallback would preserve the lost-update bug for any stale client bundle. The commit runs under `ifRevisionId`; a **409 `{error:"stale_revision", …}` means the write did NOT land** and carries the winner's current arrays. The client adopts that state and holds (not flashes) a Spanish message telling the manager to re-mark and save. |

---

## Activity / Notifications

| Route | Methods | Auth | Purpose |
|-------|---------|------|---------|
| `/api/activity/ping` | POST | active session | Heartbeat — patches own `lastSeen`. Failure swallowed. Returns `{ok:true}`. |
| `/api/notifications/count` | GET | active session (returns `{count:0}` if none) | Nav badge. Admins: count of `pending` proposals. Members/leads: own `changes_requested` proposals. |

---

## Practice / Song (active member)

| Route | Methods | Purpose |
|-------|---------|---------|
| `/api/practice-playlist` | POST | `{ids[], mode?: "musica"\|"letras"}` → builds a `youtube.com/watch_videos` playlist URL (≤50). Uses CDN `client`. |
| `/api/song/[id]` | GET | Full song detail + last-5 play history (Sun/Sat setlists referencing it, with play key + that week's leaders). 404 if missing. |

---

## Content editing — `requireActiveManager` (content-editor **allowed**)

| Route | Methods | Notes |
|-------|---------|-------|
| `/api/content/posts` | GET, POST | GET all songs. POST create song (title required; all URLs must be http(s); resolves `authorIds`→names; `textToBody(lyrics)`; builds slug) → `revalidateSongViews()`, 201. |
| `/api/content/posts/[id]` | PATCH, DELETE | PATCH partial song update (URL validation; **type-guards target is a `post`**). **DELETE requires admin/super-admin** (content-editor excluded). Both → `revalidateSongViews()`. |
| `/api/content/tags` | GET, POST | POST is **idempotent by slug** — returns the existing doc (200) or creates (201). |
| `/api/content/authors` | GET, POST | POST idempotent by slug (via `slugifyAuthor`) — existing (200) or created (201). |

---

## Admin — `requireActiveManager` **excluding content-editor** (admin/super-admin)

### Songs
- **`GET /api/admin/songs`** — `?q=` prefix search on song title, ≤25 results.

### Setlists & services (roles)
| Route | Methods | Notes |
|-------|---------|-------|
| `/api/admin/setlists` | GET, PUT | GET `?week=&type=sunday\|saturday\|special&roleId=` → additive canonical read: always `{setlistId, songs, recentSongs}` (recentSongs = songId→most-recent past use, 8-week window) **plus** `targetState: none\|single\|duplicate\|draft_conflict\|invalid`. `single` adds `contentState` (`empty\|incomplete\|ready\|invalid`) + `observed {state,id,rev}` (special uses the special-role id/rev); conflict branches add `conflictingIds`/`draftIds`/`canonicalIds`/`reason`+`recordIds` and return `setlistId: null`, `songs: []`. Request identity (`type`, valid `YYYY-MM-DD` `week`, special `roleId` resolving to one `special_role` on that date) is validated **before** any target read → 400, never `targetState: "none"`. Read failure → 500, never an empty clean result. **PUT** submits the unchanged `observed` state from that GET (see below) → one guarded transaction → `revalidateServiceViews()` + push to setlist subscribers **only when the service is published** (`subject.published !== false`); a draft save is silent, matching the debounced email. |
| `/api/admin/roles` | GET, POST | GET all role docs (incl. `_rev`) with resolved seats + joined setlist. **POST** create a service: requires `creationRequestId`; whitelists `_type`; `published` only on exact `true`; one transaction creates the receipt + role + weekend lock claim. **201** on create, **200 `{…role, replay:true}`** on an exact replay. Then `revalidateServiceViews()` + `revalidatePath("/me")`; if published, `after()` fires push (`assignments`) + assignment emails. `maxDuration=60`. |
| `/api/admin/roles/[id]` | PATCH, DELETE | Both require the client-observed `rev` (+ optional `lockRev`) in the JSON body — **DELETE has a required body**. PATCH updates date/name/assignments; a permitted date move atomically vacates the old lock and claims the new one; request `_type` is a cross-check and **never converts a document** (the old type/target is derived from storage). Diffs `addedAssignees`; if `published !== false` (published **or** grandfathered), `after()` notifies newly added (drafts stay silent). DELETE applies the dependency policy, vacates the owned lock, retires a receipt-backed key, and deletes the role in one transaction. Both revalidate. `maxDuration=60`. |
| `/api/admin/roles/publish` | POST | **CHANGED contract: `{ roles: [{id, rev}], published: boolean }`** — the old `{ids[], published}` shape is **no longer accepted** (it fails `invalid_request`, `issues:["roles"]`). Exact boolean required; non-empty batch ≤100; canonical ids, no duplicates, no `drafts.*`. Fetches only `sunday_role\|saturday_role\|special_role` and requires exact one-to-one cardinality/type/revision — a single missing / wrong-type / stale / raw-draft / duplicate-target entry **rejects the whole batch during prevalidation**. Then one transaction patches every publication state and heartbeats every coordination token. `{ok:true, published, unpublished}`. Only genuine `false → true` transitions notify (`computePublishTransitions`); newly-published → `after()` push + **one consolidated batch email per member**. Revalidates `/`, `/schedule`, `/me`. `maxDuration=60`. |
| `/api/admin/roles/publish-ready` | POST | **New.** Server-authoritative bulk publish. The client's "Publicar listos" selection is a **hint, never an authorization**: this route reloads all five read domains and re-derives readiness with the same pure predicates the UI uses, then commits one transaction whose ops assert the exact revisions readiness was computed over. Modes: `ready` \| `override` \| `recover`. An `override` may acknowledge only the four **workflow** blockers (availability conflict, active proposal, incomplete setlist, empty team); the eighteen **hard** blockers are never override-eligible, because no acknowledgement makes a publish over unproven state safe. Two ops asserting different revisions of one shared document are an explicit refusal, never a silent last-one-wins. See [SERVICE_READINESS_UI](SERVICE_READINESS_UI.md#7-bulk-publish). |
| `/api/admin/roles/unpublish` | POST | **New.** Hides a published service. Deliberately gated on fewer sources than any other control (`roles` + `roleTargets` only) — pulling a service back must stay available *precisely when* setlist, proposal or member data is unsafe or unavailable. |
| `/api/admin/roles/swap` | POST | **New.** Atomic seat/team swap, replacing the old two-PATCH client handler. Discriminated union: `{kind:"seat", source:{roleId,rev,path,itemKey}, target:{…}}` where `path` ∈ `Lead\|BGVs\|Chorus\|instruments\|foh_team`, or `{kind:"team", roles:[{id,rev},{id,rev}]}`. Assignments are derived from the **current stored roles** — a replacement team payload is never accepted. Seat swaps key off the stored `_key` (never a rendered index) and preserve the destination `_key`, instrument label, and FOH label; team swaps exchange exactly the five seats and preserve identity/date/name/publication/songs/team notes. Same-role, weekend↔weekend, weekend↔special and special↔special all assert every involved role + coordination token in **one** transaction. `{ok:true, kind, roleIds[]}`. Notifies newly added assignees **per destination role**. |
| `/api/admin/roles/copy-instruments` | POST | **New.** `{source:{id,rev}, target:{id,rev}}`. Reads both current singleton roles and **never** accepts a cached client instrument payload; asserts/heartbeats both coordination tokens in one transaction while patching only `target.instruments`. `{ok:true, sourceId, targetId, copied}`. A stale/deleted source, stale target, dangling assignment, invalid target, or conflict leaves target assignments unchanged (`details.side: "source"\|"target"`). |

#### `PUT /api/admin/setlists` — the observed-state contract

The client sends back the **unchanged** `observed` object from the GET it edited. Only two shapes
are expressible (the `duplicate` / `draft_conflict` / `invalid` GET branches carry no `observed` at
all, so a non-editable target cannot be saved):

| `observed` | Permits |
|-----------|---------|
| `{state:"single", id, rev}` | patching **that** target only — the same id at the same revision |
| `{state:"none"}` | deterministic **creation** at `featuredSongs.<week>` / `saturdarSongs.<week>` |

Body: `{week, type: "sunday"\|"saturday"\|"special", roleId?, observed, songs[]}` (≤60 songs;
`roleId` required for `special`). Creation uses `tx.create` (never `createIfNotExists`), so a lost
race surfaces as a conflict rather than a silent merge. Weekend saves heartbeat the owned lock in
the same transaction; special saves revision-guard the `special_role` itself (the role *is* the
setlist target). Mismatch → **409 `stale_revision`** with `details.detail` ∈ `concurrent_creation`,
`target_vanished`, `identity_mismatch`, `revision_mismatch` (or `revision_moved` from the commit).
`{ok:true, setlistId, created}`. The editor retains its observed state until success or reload and
**never closes on failure**.

### Proposals
| Route | Methods | Notes |
|-------|---------|-------|
| `/api/admin/proposals` | GET | List all `setlistProposal` docs — now including **`_rev`** and the approval-input fingerprint fields (`approval_receipt`, `last_transition`, `service_type`, `service_date`, `team_notes`, ordered `songs[]{_key, play_key, medley_tag, song_id, …}`), so an admin can submit the revision they actually reviewed. |
| `/api/admin/proposals/[id]` | PATCH | `{action, rev, adminNotes?}` — **`rev` is required for every action** and must be the revision the admin reviewed; a freshly fetched server revision is not a substitute. Actions: `approve` (from `pending`\|`changes_requested`), `request_changes` (same sources), `reopen` (from `approved` only), `reconcile_target` (from `draft`\|`pending`\|`changes_requested`, refreshes `service_type`/`service_date` without changing status). **Sibling/competing proposals are no longer deleted** — a duplicate group is *refused* (`ambiguous_target`, `detail:"not_shared_proposal"`). 409 preserves the reviewed card/modal and requires a reload. `approve`/`request_changes`/`reopen` push `proposals`; `reconcile_target` is silent. |

#### Atomic approval + approval receipt

`approve` requires proposal `contentState === "ready"`, a canonical role/target, the owned
coordination token, a safe setlist observation, no raw draft, and no duplicate group. **One**
transaction then asserts the proposal at the reviewed `rev`, writes the live setlist (patch the
observed singleton, patch `special_role.songs`, or `create` the deterministic weekend setlist),
heartbeats the weekend lock, and records `approval_receipt` — then `revalidateServiceViews()`.

The receipt fingerprints the normalized target (`serviceType`, `serviceDate`, `serviceRef`,
`setlistTargetKey`), the **ordered** song rows (`songId`, `playKey`, `medleyTag`), the team notes,
and an app/version marker (`owt-kb-v1/a2-approval-1`, v1). The **approval timestamp is deliberately
excluded** so a recomputation after a lost response matches; order *is* significant.

| Retry against an already-`approved` proposal | Result |
|---|---|
| Receipt present, marker/version/target match, fingerprint matches | **200 `{ok:true, status:"approved", idempotent:true}`** — no write, no push, no revalidation |
| Receipt present but fingerprint differs | **409 `integrity_conflict`**, `detail:"approval_fingerprint_mismatch"` |
| Missing / malformed / foreign / old-version receipt | **409 `legacy_approval_unverified`**, `detail:"no_valid_receipt"` |

`request_changes`, `reopen`, and `reconcile_target` work the same way through `last_transition`: a
matching already-committed transition (same action, target status, and transition fingerprint over
`action`/`proposalId`/`toStatus`/`adminNotes`/`targetIdentity` — source status and timestamps
excluded) is an explicit **no-write retry** (`200 {…, idempotent:true}`); a mismatch is a 409.

### Service integrity (read-only)

Three GET summaries over the canonical read contract. Each calls `requireActiveManager()` and
then rejects `content-editor` (**admin + super-admin only**, 403) — the same boundary as the
other service-admin routes, not an access expansion. All three are pure reads: no writes, no
revalidation, no notifications. Canonical data comes from `operationalClient`, `drafts.*`
evidence from `rawIntegrityClient`; assembly is the pure builders in
[`app/utils/serviceReadSummary.ts`](../app/utils/serviceReadSummary.ts).

| Route | Reports |
|-------|---------|
| `GET /api/admin/service-integrity/roles` | `targets[]` keyed by canonical target (`<type>:<week>`, or a `special_role` id): `canonicalCount` / `canonicalIds` / `canonicalState`, `publicState` (`draft_conflict` when a `drafts.*` overlay exists), `memberVisibleCount`, `draftIds`, and per-record `{id, rev, type, serviceDate, published, assignedRefs, members, danglingRefs}` — refs collected across **all five seat paths** and resolved against canonical members. `recordIssues[]` carries `invalid_role` (with its validation issue tags) and `draft_only` records. **Plus weekend lock state:** per target `expectsLock` (weekend only — a `special_role` never expects one), `lock: {id, rev, state, roleId, generation} \| null`, and `lockIssues[]`; plus a flat top-level `lockIssues[]` that also catches locks belonging to no canonical target. Issue kinds: `missing_lock`, `malformed_lock`, `id_mismatch`, `claimed_without_role`, `vacant_with_role`, `wrong_owner`, `orphan_lock`. One malformed lock stays a record-level issue and never fails unrelated targets; when no lock inventory was supplied the array is empty rather than inventing issues. |
| `GET /api/admin/service-integrity/setlists` | Same target shape for `featuredSongs` / `saturdarSongs` **plus** `special_role` documents that carry `songs`: `contentState` (`empty\|incomplete\|ready\|invalid`; `invalid` for an ambiguous/duplicate target), `songCount`, `songKeys`, `invalidEntries`, `draftIds`, `records[]`, and `recordIssues[]` (`invalid_setlist` / `draft_only`). |
| `GET /api/admin/service-integrity/proposals` | Per-proposal `records[]` (`status`, `serviceRef`, `targetKey`, `contentState`, `valid`, `issues`, and the resolved `referencedRole`), plus grouping conflicts through **both** indexes — `serviceRefConflicts[]` and `targetKeyConflicts[]` — `recordIssues[]`, and `draftIds[]`. |

**Contract:** the three domains load **independently**; **one malformed record never fails a
domain** (it becomes a record issue); and a **read failure is a domain error — `500`, never an
empty "clean" result**. `memberVisibleCount` appears on roles only — setlist documents carry no
`published` flag (see [DATA_MODEL](DATA_MODEL.md#draftpublish-gating)).

### Members — mostly **super-admin only**
| Route | Methods | Auth | Notes |
|-------|---------|------|-------|
| `/api/admin/members` | GET, POST | GET admin/super-admin; **POST super-admin** | GET is **ministry-scoped**: `admin`/`content-editor` receive worship members only (`WORSHIP_MEMBER_GROQ_FILTER`), while `super-admin` binds `$all` and receives everyone — they are the only role that can edit `ministries`, so filtering them would make a Kids-only member uneditable through the UI. The Miembros list then offers an Alabanza/Oasis Kids/Todos control, defaulting to Alabanza, filtering client-side. Absent `ministries` counts as worship, so no legacy member is ever hidden. POST create (name+email required), 201. |
| `/api/admin/members/[id]` | PATCH, DELETE | **super-admin** | PATCH validates role/`memberType`/`ministries`/`managesMinistries` (each applied only when present, so an unrelated edit cannot wipe a privilege), sets `notifPrefs.email` → `revalidateServiceViews()` + `revalidatePath("/me")`. DELETE removes. |
| `/api/admin/members/[id]/photo` | POST | **super-admin** | Same photo validation as `/api/me/photo`; sets target's `profilePhoto`. (No revalidation.) |
| `/api/admin/set-password` | POST | **super-admin** | `{sanityMemberId, password}` (≥8) → sets `passwordHash` (cost 12). |
| `/api/admin/login-events` | GET | admin/super-admin | Per-member last login/active, count, providers, recent 20 events. |

### Solver
- **`POST /api/admin/solve`** (`maxDuration=60`) — the auto-scheduler. If `OWT_SOLVER_URL` is
  set, calls the remote solver with `X-Api-Key`; else spawns the local Python subprocess
  (`gcf/owt_solver_v2.py --json-mode`, 120s hard kill). Body is a `SolveRequest`; requires
  `sunday_leads`. Returns a `SolveResponse` — **200 if `ok`, else 422**. No Sanity writes. See
  [SOLVER_AND_INFRA.md](SOLVER_AND_INFRA.md).
- **`GET /api/admin/solver-config`** — the shared planner rule set (`_id: solverConfig`).
  Returns `{ present, rev, config }`. **`present: false` with `config: null` means the document
  does not exist**, which is a different answer from a failed read (an HTTP error, no body):
  absent ⇒ the client may fall back to its built-in defaults **in memory only**; failed ⇒ it must
  refuse to save. Collapsing the two into one `?? DEFAULT` is how a transient failure overwrites
  the real rules.
- **`POST /api/admin/solver-config`** — replace the rule set. Body `{ rev, config }`.
  **UPDATE only: it can never create the document** — a POST while it is absent is `404 not_found`
  with `details.detail = "create_not_allowed_here"`, because only `scripts/seed-solver-config.ts`
  may mint it. A `rev` that is missing is `400 invalid_request`; one that does not match is
  `409 stale_revision` (checked before the patch and again by `ifRevisionId`). Every array item is
  written with a `_key` minted from the rule's own `id` by
  `app/utils/solverConfigWriteRequest.ts` — the same module the seed script uses. **No
  `revalidate*` call applies**: the document backs no ISR surface, it is read only through this
  route inside the dynamic admin tree.

---

## Cron / Webhook

- **`GET /api/cron/service-reminders`** — **secret-based auth** (`Authorization: Bearer
  <CRON_SECRET>` header or `?secret=`, compared to `process.env.CRON_SECRET`; 403 otherwise —
  **not** session-based). Finds members assigned to **tomorrow's** published services
  (America/Mexico_City) and pushes a `reminders` notification ("Sirves mañana"). Scheduled by
  `vercel.json` at `0 1 * * *` (01:00 UTC daily). The only endpoint scheduled by `vercel.json` —
  Vercel Hobby allows one cron per day, so the other two are driven by GitHub Actions.

- **`GET /api/cron/flush-notifications`** — same secret-based auth (401 otherwise). Runs one
  `sweepOutbox()` at full budget: the notification outbox's primary flush trigger. Driven every
  five minutes by `.github/workflows/flush-notifications.yml`, never by `vercel.json`. See
  `docs/NOTIFICATIONS.md`.

- **`GET /api/cron/smtp-probe`** — same secret-based auth (401 otherwise). Diagnostic: times each
  SMTP command against the configured mail server and reports whether `EMAIL_REDIRECT_TO` is
  diverting mail. **Sends no mail** unless `?data=1`, which submits one message and is refused for
  any recipient but our own sending mailbox. Query: `to`, `repeat` (1–5), `data`, `bytes`. Driven
  manually by the *Probe the SMTP path* workflow.

---

## Verification-only

- **`GET /api/service-readiness-verification/identity`** — **no session.** Reports the
  deployment's own Sanity project/dataset, marker, delivery mode, `e2eWritesEnabled`, deployment
  id and commit SHA, so a verification run can prove *before mutating anything* that it is
  pointed at the isolated deployment and the commit it intended to test.

  It **fails closed to 404 in every deployment that is not the isolated verification
  deployment** — including production. A 404 here is the correct, expected response in normal
  operation, not a routing bug. See [`VERIFICATION_HARNESS.md`](VERIFICATION_HARNESS.md#5-run-identity--proving-you-tested-the-commit-you-meant-to).

---

## Cross-cutting notes

- **Content-editor boundary:** allowed on `/api/content/*` (except `posts/[id]` DELETE) and
  `/api/notifications/count`; excluded from all `/api/admin/*`. Member mutations, photo upload,
  and password-set are **super-admin only**.
- **Revalidation coverage:** every mutating route that affects a public ISR page revalidates.
  Mutating routes that deliberately skip it (none touch a cached public page): member POST,
  member photo, set-password, `me/proposals` POST, `activity/ping`, and self-service
  availability/notif-prefs/password/push-token.
- **Canonical reads fail closed:** an ambiguous (duplicate) or draft-conflicted service target
  yields **no** data rather than an arbitrary `[0]` pick — `/api/admin/setlists` GET reports it
  as a non-editable `targetState`, `/api/song/[id]` and `/api/me/songs` drop it from play
  history, and `notifyProposalSubmitted` sends nothing.
- **Protected mutations have no alternate path:** the API routes above are the only writers. The
  embedded Studio strips every mutating action from all thirteen protected types, and the five historical
  one-shot scripts fail closed before constructing a client — see
  [DATA_MODEL → Studio](DATA_MODEL.md#studio) and
  [SOLVER_AND_INFRA §3](SOLVER_AND_INFRA.md#3-scripts--one-off-migrations-imports--ops).
- **Push categories:** `assignments`, `setlist`, `proposals`, `reminders` — each gated by
  `notifPrefs` inside `sendPush`.
- **`app/api/__tests__/proposalTeamNotes.test.ts`** is a test, not a route.
