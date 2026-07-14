# Authentication, Authorization & Security

Auth is **NextAuth v4** with JWT sessions. Members are Sanity `teamMembers` docs; the member's
`_id` is the `sanityId` carried on the session. Config lives in [`auth.ts`](../auth.ts); the
gate lives in [`proxy.ts`](../proxy.ts); the live-access cache lives in
[`app/utils/memberAccess.ts`](../app/utils/memberAccess.ts).

---

## The role model

```
super-admin  >  admin  >  content-editor  >  member
```

`type OWTRole = "super-admin" | "admin" | "content-editor" | "member"` (declared in
[`types/next-auth.d.ts`](../types/next-auth.d.ts), also augmenting `Session.user` and `JWT`).
A member with no `role` defaults to `"member"` everywhere.

| Role | Can do |
|------|--------|
| `member` | Browse songs/schedule, edit own profile/availability, propose setlists (if a Lead). |
| `content-editor` | + song/tag/author CRUD via `/api/content/*` (but not song DELETE, not `/api/admin/*`). |
| `admin` | + services, setlists, proposals, member list, Studio access. |
| `super-admin` | + create/edit/delete members, set passwords, member photos, **impersonation**. |

Gate server-side with `requireActiveManager()` (content-editor and up) or `requireActiveSession()`
(any active member), then narrow inline for admin-only / super-admin-only actions. See
[API_REFERENCE.md](API_REFERENCE.md).

---

## Providers (three)

1. **`GoogleProvider`** — standard web Google OAuth (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`).
2. **`CredentialsProvider` id `"google-native"`** — the Capacitor app sends a Google **ID
   token**; the server verifies it with `verifyGoogleIdToken` (JWKS signature, `aud` against the
   web/iOS/Android client-id allowlist, `iss`, `exp`, `email_verified === true`) and looks up the
   member by verified email. Client side is [`app/utils/native.ts`](../app/utils/native.ts)
   (`@capgo/capacitor-social-login`).
3. **`CredentialsProvider` "Email y contraseña"** — bcrypt (`bcryptjs`) compare against
   `passwordHash`.

All three attach `role`, `sanityId`, `alias` to the user, and reject non-members / disabled
members (`isMemberActive`).

**Sessions:** JWT strategy, **7-day** `maxAge`. Sign-in page `/auth/signin`. Secret from
`NEXTAUTH_SECRET`.

---

## Sign-in side effects (`events.signIn`)

- Writes a `loginEvent` doc (member ref, email, provider, timestamp) — powers the admin activity
  dashboard.
- On Google sign-in with an image, validates the host is exactly `lh3.googleusercontent.com`,
  then patches `googlePhotoUrl` on the member. All best-effort (try/catch, log-only).

---

## The JWT callback — the security core

Three phases, in [`auth.ts`](../auth.ts):

### (a) Impersonation (super-admin only, server-enforced)
Triggered by `trigger === "update"` with an `impersonating` / `stopImpersonating` payload.
- **Start:** the **real** role is `token.__realAdmin?.role ?? token.role`. If that real role is
  **not `super-admin`**, the token is returned unchanged — a crafted `session.update()` from a
  lesser role **cannot escalate**. Otherwise it snapshots the original admin identity into
  `token.__realAdmin` **once** (guarded so switching targets doesn't clobber it), overwrites
  `role/sanityId/name/alias` with the target's, and sets `isImpersonating = true`.
- **Stop:** restores identity from `__realAdmin` and clears the impersonation fields.

> **Invariant:** impersonation authority is enforced in exactly this one trusted place. Never
> move it client-side, and never trust `isImpersonating` from the client. Impersonation UI lives
> in `AdminPanel.tsx` / `ImpersonationBanner.tsx` (they call `session.update`, but the server
> decides).

### (b) First sign-in
Copies `role`/`sanityId`/`alias` from the provider's user onto the token. If a pure-SSO user has
no matching member, `sanityId` stays undefined → `proxy.ts` redirects to `/auth/not-a-member`.
(There's also a one-time `alias` backfill for tokens minted before that field existed.)

### (c) Live refresh + revocation (every token read)
Reads the effective member (and, during impersonation, the real admin) via `getMemberAccess`
(30s TTL). If either is disabled/removed (`!active`), returns `{ ...token, sanityId: undefined,
role: undefined }` → the request is treated as unauthenticated. Otherwise it overwrites
`token.role` with the **current live role** so a promotion/demotion takes effect within ~30s
instead of persisting for the 7-day token lifetime.

---

## Token lifecycle: 7 days vs 30 seconds

- **7 days** — JWT session `maxAge`; the outer token lifetime.
- **30 seconds** — `getMemberAccess` cache TTL (`TTL_MS = 30_000`); the window within which the
  **kill switch** (`disabled`) and **role changes** propagate into the live JWT.

`getMemberAccess(sanityId)` reads `{ disabled, role }` via `serverClient` (`useCdn:false`, never
CDN-stale), caches for 30s, and returns `{ active, role }`. `isMemberActive` is the boolean
wrapper. A member is active iff their doc exists and `disabled !== true`.

---

## The middleware gate (`proxy.ts`)

Next.js 16 renamed `middleware.ts` → **`proxy.ts`**. It wraps the app in NextAuth's `withAuth`:

- `authorized: ({ token }) => !!token` — any authenticated token passes; unauthenticated →
  sign-in.
- `token && !token.sanityId` → redirect `/auth/not-a-member` (SSO user not in `teamMembers`, or
  a revoked session per phase (c)).
- `/studio*` with role ∉ `{super-admin, admin}` → redirect `/` (members and content-editors are
  blocked from Studio).

**Matcher** — protects everything except a small public allow-list (`/auth*`, `/api/auth*`,
`_next/static`, `_next/image`, `favicon.ico`, `LogoOasis.png`, `/icons`, `manifest.webmanifest`).
Each excluded prefix is anchored with `(?:/|$)` so `/author` is **not** mistaken for the public
`/auth` route (this was a real login-gate-bypass bug — the anchor is the fix).

> **Invariant:** the matcher string is inlined in `proxy.ts` (Next requires a statically
> analyzable literal) but must stay **byte-for-byte equal** to `MIDDLEWARE_MATCHER` in
> [`app/utils/routeMatcher.ts`](../app/utils/routeMatcher.ts), which carries the tested version
> and a sync guard (`routeMatcher.test.ts`). Change both together.

---

## Server-side guards (`app/utils/authGuards.ts`)

```ts
requireActiveSession(): Promise<Session | null>   // active member (any role)
requireActiveManager(): Promise<Session | null>   // + role in {super-admin, admin, content-editor}
```

Both use the **effective** `sanityId`, so an impersonated-but-disabled target is blocked. There
is **no** `requireActiveSuperAdmin` helper — super-admin gating is an inline `role === "super-admin"`
check in the routes/components that need it.

---

## Security headers (`next.config.mjs`)

Applied to all routes:
- `X-Frame-Options: SAMEORIGIN`
- `X-Content-Type-Options: nosniff`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`

`poweredByHeader: false`. Image `remotePatterns` allow only `cdn.sanity.io` and
`lh3.googleusercontent.com`.

---

## Other security notes

- **File uploads** (`/api/me/photo`, `/api/admin/members/[id]/photo`): 5 MB max, MIME whitelist,
  and a **magic-byte** check that rejects spoofed content types (413/415).
- **GROQ injection:** bound `$params` everywhere except two audited string-interpolation sites —
  the trusted code-owned `roleFilter` in `assignedMemberRefsQuery`, and opaque FCM tokens (which
  are validated `/^[A-Za-z0-9_:.-]{1,4096}$/` at the token API before storage).
- **Cron auth** is a shared secret (`CRON_SECRET`), not a session — see
  `/api/cron/service-reminders`.
- **Solver auth** is a shared `X-Api-Key` (`OWT_SOLVER_API_KEY`); the Cloud Function **fails
  closed** (503) if the key is unset.
- **Fetch resilience (audited):** every client mutation handler wraps `fetch` in
  try/catch/finally, checks `res.ok`, resets its loading flag, and never closes-as-success on
  failure. Keep this intact for any new mutation handler.

---

## Environment variables

Full list (names only — never print values; `.env.local` is git/claude-ignored). See
[DEVELOPMENT.md](DEVELOPMENT.md) for which are required locally.

| Variable | Purpose |
|----------|---------|
| `NEXTAUTH_SECRET` | JWT signing secret |
| `NEXTAUTH_URL` | Auth/email base URL (may be unset in prod — Vercel var covers it) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google web OAuth (+ `aud` allowlist) |
| `GOOGLE_IOS_CLIENT_ID` / `GOOGLE_ANDROID_CLIENT_ID` | Native token `aud` allowlist |
| `NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID` / `NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID` | Client-side @capgo ids (must mirror the server ids) |
| `NEXT_PUBLIC_SANITY_PROJECT_ID` / `NEXT_PUBLIC_SANITY_DATASET` / `NEXT_PUBLIC_SANITY_API_VERSION` | Sanity project |
| `SANITY_API_READ_TOKEN` | `serverClient` read token |
| `SANITY_WRITE_TOKEN` | `writeClient` write token |
| `RESEND_API_KEY` / `EMAIL_FROM` | Resend email |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` | SMTP transport (preferred) |
| `EMAIL_ALLOWLIST` | Recipient gate (default `"*"` = whole team) |
| `EMAIL_REDIRECT_TO` | Dev/test: reroute all mail to one inbox |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase Admin JSON (FCM push) |
| `CRON_SECRET` | Auth for the cron route |
| `OWT_SOLVER_URL` / `OWT_SOLVER_API_KEY` / `OWT_SOLVER_PYTHON` | Solver endpoint/key/local python path |
| `VERCEL_PROJECT_PRODUCTION_URL` | Production URL fallback for email links |
| `CATALOG_DIR`, `MEMBER_ID`, `PASSWORD` | One-off script args |

> **Security reminder:** `.env.local` on disk contains real secret values. It is correctly
> git-ignored and claude-ignored — never commit it, never print it, and rotate if the tree was
> ever shared.
