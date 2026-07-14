# API Reference — `app/api/`

31 route handlers (`route.ts` files). Most talk to Sanity through `serverClient` (read) /
`writeClient` (write). Exceptions: `/api/practice-playlist` uses the CDN `client`, and
`/api/admin/solve` touches no Sanity at all (it calls the external solver / spawns a subprocess).

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
- `notifyProposalSubmitted(...)` — push/email fan-out for proposals.

> **Convention for new mutating routes:** validate → check auth → write → **revalidate the
> affected ISR pages** → fire best-effort notifications (never let a notify failure fail the
> write) → return `res.ok`-friendly JSON.

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
| `/api/me/availability` | GET, PATCH | GET/PATCH `{unavailableDates[], unavailabilityNotes[]}`; validates ISO dates, unique per date (`_key`=date). No revalidation. |
| `/api/me/notif-prefs` | PATCH | `{email?, assignments?, proposals?, reminders?, setlist?}` (booleans; `setlist` bool → `"all"`/`"off"`). Writes `notifPrefs.*`. |
| `/api/me/password` | POST | `{currentPassword?, newPassword}` (≥8 chars). Verifies current via bcrypt if a hash exists; sets `passwordHash` (cost 12). |
| `/api/me/photo` | POST | multipart `photo`. 5 MB max, MIME whitelist + **magic-byte** check (413/415). Uploads Sanity asset, sets own `profilePhoto` → `revalidateServiceViews()` + `revalidatePath("/me")`. |
| `/api/me/proposals` | GET, POST | GET proposals for every service the user Leads. POST creates/updates the **one shared proposal** (Leads only); deterministic `_id` create-mutex → 409 on collision; `ifRevisionId` → 409 on stale/`approved`; fires `notifyProposalSubmitted` when `status="pending"`. |
| `/api/me/push-token` | POST, DELETE | Register/remove an FCM `deviceToken` (token validated against `/^[A-Za-z0-9_:.-]{1,4096}$/`, GROQ-injection guard). |
| `/api/me/songs` | GET | `?q=` search of `post` by title/author (prefix); up to 30/50 results. |

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
| `/api/admin/setlists` | GET, PUT | GET `?week=&type=sunday\|saturday\|special&roleId=` → `{setlistId, songs, recentSongs}` (recentSongs = songId→most-recent past use, 8-week window). PUT upserts `featuredSongs`/`saturdarSongs` or patches `special_role.songs` → `revalidateServiceViews()` + push to setlist subscribers. |
| `/api/admin/roles` | GET, POST | GET all role docs with resolved seats + joined setlist. POST create a service (whitelists `_type`; defaults `published:false`) → `revalidateServiceViews()` + `revalidatePath("/me")`; if published, `after()` fires push (`assignments`) + assignment emails. `maxDuration=60`. |
| `/api/admin/roles/[id]` | PATCH, DELETE | PATCH updates date/name/assignments; diffs `addedAssignees`; if `published !== false` (published **or** grandfathered), `after()` notifies newly added (drafts stay silent). DELETE removes. Both revalidate. `maxDuration=60`. |
| `/api/admin/roles/publish` | POST | `{ids[], published}`. Computes `computePublishTransitions`, batches a Sanity **transaction**; newly-published → `after()` push + **one consolidated batch email per member**. Revalidates `/`, `/schedule`, `/me`. `maxDuration=60`. |

### Proposals
| Route | Methods | Notes |
|-------|---------|-------|
| `/api/admin/proposals` | GET | List all `setlistProposal` docs. |
| `/api/admin/proposals/[id]` | PATCH | `{action: "approve"\|"request_changes"\|"reopen", adminNotes?}`. **approve** claims via `ifRevisionId` (409 on concurrent lead edit), writes the real setlist, **deletes superseded competing proposals**, pushes, `revalidateServiceViews()`. **reopen** only from `approved` (409 else). All push `proposals`. |

### Members — mostly **super-admin only**
| Route | Methods | Auth | Notes |
|-------|---------|------|-------|
| `/api/admin/members` | GET, POST | GET admin/super-admin; **POST super-admin** | GET all members. POST create (name+email required), 201. |
| `/api/admin/members/[id]` | PATCH, DELETE | **super-admin** | PATCH validates role/`memberType`, sets `notifPrefs.email` → `revalidateServiceViews()` + `revalidatePath("/me")`. DELETE removes. |
| `/api/admin/members/[id]/photo` | POST | **super-admin** | Same photo validation as `/api/me/photo`; sets target's `profilePhoto`. (No revalidation.) |
| `/api/admin/set-password` | POST | **super-admin** | `{sanityMemberId, password}` (≥8) → sets `passwordHash` (cost 12). |
| `/api/admin/login-events` | GET | admin/super-admin | Per-member last login/active, count, providers, recent 20 events. |

### Solver
- **`POST /api/admin/solve`** (`maxDuration=60`) — the auto-scheduler. If `OWT_SOLVER_URL` is
  set, calls the remote solver with `X-Api-Key`; else spawns the local Python subprocess
  (`gcf/owt_solver_v2.py --json-mode`, 120s hard kill). Body is a `SolveRequest`; requires
  `sunday_leads`. Returns a `SolveResponse` — **200 if `ok`, else 422**. No Sanity writes. See
  [SOLVER_AND_INFRA.md](SOLVER_AND_INFRA.md).

---

## Cron / Webhook

- **`GET /api/cron/service-reminders`** — **secret-based auth** (`Authorization: Bearer
  <CRON_SECRET>` header or `?secret=`, compared to `process.env.CRON_SECRET`; 403 otherwise —
  **not** session-based). Finds members assigned to **tomorrow's** published services
  (America/Mexico_City) and pushes a `reminders` notification ("Sirves mañana"). Scheduled by
  `vercel.json` at `0 1 * * *` (01:00 UTC daily). The only cron endpoint.

---

## Cross-cutting notes

- **Content-editor boundary:** allowed on `/api/content/*` (except `posts/[id]` DELETE) and
  `/api/notifications/count`; excluded from all `/api/admin/*`. Member mutations, photo upload,
  and password-set are **super-admin only**.
- **Revalidation coverage:** every mutating route that affects a public ISR page revalidates.
  Mutating routes that deliberately skip it (none touch a cached public page): member POST,
  member photo, set-password, `me/proposals` POST, `activity/ping`, and self-service
  availability/notif-prefs/password/push-token.
- **Push categories:** `assignments`, `setlist`, `proposals`, `reminders` — each gated by
  `notifPrefs` inside `sendPush`.
- **`app/api/__tests__/proposalTeamNotes.test.ts`** is a test, not a route.
