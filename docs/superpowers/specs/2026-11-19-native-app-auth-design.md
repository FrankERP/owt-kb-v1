# Native app sign-in (Fase 0, slice A1) — design

**Status:** draft for adversarial plan review (critical tier: auth/security boundary).
**Date:** 2026-11-19. **Owner:** Frank. **Thread:** «Crear apps nativas de iPhone y Android».
**Parent plan (approved by Frank 2026-11-19):** the Claude Doc «Plan: apps nativas de Backstage
para iPhone y Android» — SwiftUI (iPhone, iPad, Mac) and Kotlin/Jetpack Compose (Android),
both talking to a new authenticated API `/api/app/v1/*`; the whole app (member screens AND
administration) ships in v1; iPhone first.

## 0. The requirement, in Frank's words

> «Podemos tener lista una app nativa de apple y de android? No quiero que use react
> necesariamente. Pero quiero que sea lo más optimizada posible y fluida, sacando todo el
> provecho de los kits de desarrollo de cada plataforma.» — and, approving the plan:
> «Vamos con toda la app desde v1. Diría que solo el 25% tal vez usa android.»

Standing constraints from the repo (`CLAUDE.md`):

- The Sanity production dataset answers unauthenticated reads (security audit 2026-10-31); a
  native app must NEVER read Sanity directly. Everything goes through server routes that
  authenticate the person and re-read their LIVE access.
- Every write goes through the existing `*Commit.ts` writers (the «ten admin write paths» and
  their siblings). This slice adds no writer of team data.
- Any new secret gets a `docs/SECRETS.md` entry in the same change.

## 1. What this slice delivers (and what it does not)

This slice is ONLY the way a native app proves who the person is, and the server-side check
every later `/api/app/v1/*` endpoint will call. It is the foundation every other phase builds on,
so it is reviewed on its own.

In scope:

1. A first-party OAuth 2.0 authorization-code + PKCE door for exactly two public clients,
   `backstage-ios` and `backstage-android` (RFC 8252, "OAuth 2.0 for Native Apps").
2. The tokens it mints (access, refresh, authorization code), under their own secret.
3. The grant store for app sessions (rotation, reuse detection, revocation).
4. `requireAppSession` — the one guard every `/api/app/v1/*` handler runs first.
5. A revocation endpoint (sign-out from the app) and a web list in `/me` where a member sees
   and closes their app sessions.
6. One proof endpoint, `GET /api/app/v1/me`.
7. Docs: ADR-0091, `docs/SECRETS.md`, `docs/MOBILE.md`, `docs/AUTH_AND_SECURITY.md`,
   `docs/ROUTES.md`.

Out of scope (later slices, each with its own review where the ladder demands it): every other
`/api/app/v1/*` endpoint, the OpenAPI contract, push (APNs/FCM), the native projects themselves,
the `apple-app-site-association` and `assetlinks.json` files (they need the Apple Team ID and the
Android signing-certificate fingerprint, which do not exist yet), Sign in with Apple (App Store
rule 4.8 — decided before the first App Store submission), and the admin endpoints.

## 2. Decisions, each with the alternative it rejects

### D1. A separate door, not the MCP connector's OAuth routes

The repo already runs an OAuth authorization server for the MCP connector (`/oauth/authorize`,
`/api/oauth/{register,authorize,token}`, `app/mcp/oauth/*`, ADR-0039/0083). It is NOT reused
as-is, because three of its properties are wrong for a member app and changing them would weaken
the connector:

| MCP door property | Why it cannot serve the app |
| --- | --- |
| Only a super-admin or a worship admin may hold a grant (`mcpTierOf`, checked at consent, code and both token grants) | Every active member must be able to sign in to the app |
| Access tokens carry `aud = <origin>/api/mcp` and `/api/mcp` accepts exactly that | App tokens must never open `/api/mcp`, and MCP tokens must never open `/api/app/v1` |
| Registration is open (stateless DCR) and the redirect allowlist is CLOSED to claude.ai, ChatGPT and loopback (ADR-0083) | App clients are fixed and first-party; adding app redirects to that list would let ANY dynamically registered client name them |

So the app gets its own routes and its own token kinds. It SHARES the proven primitives: PKCE
verification (`app/mcp/oauth/pkce.ts`), the capped form reader (`requestBody.ts`), the RFC 6749
error responses (`responses.ts`), the origin resolution (`origin.ts`: canonical host only, one
issuer per deployment), and the grant-store protocol (D6). The MCP routes, their allowlist,
`mcpTierOf` and every MCP test stay byte-for-byte unchanged except for the store extraction in D6.

Rejected alternative: add `backstage-ios`/`backstage-android` to the MCP door with a client-kind
branch at every gate. It would put member-level tokens through code whose every comment assumes
admins only, and one missed branch would hand a member an MCP token.

### D2. Its own signing secret: `APP_AUTH_SECRET`

HS256 with the UTF-8 bytes of `APP_AUTH_SECRET` (≥ 32 bytes, same `loadSecret` rule), never
`MCP_OAUTH_SECRET` and never `NEXTAUTH_SECRET`. Key separation makes a token of one door
unverifiable by the other even if an `aud` or `typ` check were ever dropped. The `typ` values are
also distinct (`app-code`, `app-at`, `app-rt`). Fail closed: no secret → the app door answers 503.
Rotating it signs every app user out (documented in `SECRETS.md`, with «what breaks
mid-rotation»).

### D3. Two static public clients, two redirect channels

The client registry is code, not data (`app/appAuth/clients.ts`):

| `client_id` | Verified redirect (`channel: "verified"`) | Private-scheme redirect (`channel: "scheme"`) |
| --- | --- | --- |
| `backstage-ios` | `<origin>/app/callback/ios` | `app.vercel.owt-backstage:/oauth/callback/ios` |
| `backstage-android` | `<origin>/app/callback/android` | `app.vercel.owt-backstage:/oauth/callback/android` |

`<origin>` is the deployment's canonical origin (`canonicalOrigin`). Redirects are compared as
exact strings (no port, path or case variance). No client authentication (public clients,
`token_endpoint_auth_method: none`); a `client_secret` or `Authorization: Basic` is refused as in
the MCP token route.

- **Verified channel.** An `https` URL on our own domain. The OS delivers it only to an app whose
  signature the domain vouches for: iOS `ASWebAuthenticationSession` with an `https` callback
  (iOS 17.4+, Associated Domains entitlement, `apple-app-site-association`), Android Auth Tab with
  an `https` redirect verified by Digital Asset Links (`assetlinks.json`). Until those files are
  published (they need the Apple Team ID / signing fingerprint) a verified redirect lands on the
  web page in §3.5, which shows «Abre la app Backstage» and nothing else.
- **Scheme channel.** RFC 8252 §7.1 private-use URI scheme, reverse-DNS of a domain we control.
  Needed because (a) Associated Domains requires a paid Apple Developer account, which is still
  waiting on the DUNS number, so Frank's first test builds on his own iPhone (free provisioning)
  can only use a scheme; (b) Android browsers without Auth Tab support cannot hand an `https`
  redirect back to the app. PKCE stops a different app from redeeming an intercepted code, but it
  does NOT stop a malicious app on the same phone from STARTING its own flow with this scheme and
  receiving a code for a person who signs in through it. Hence D4.

Rejected alternative: scheme only. Simpler, but leaves the phishing-app hole open for admins
forever. Rejected alternative: verified only. Blocks every test build until Apple enrollment
completes and strands Android devices without Auth Tab.

### D4. What a session can do depends on its channel

The grant records its `channel`, set once at code exchange from the redirect the code was bound
to, never changed by a refresh. `requireAppSession` returns it, and:

- `channel: "verified"` → the session carries the person's full live role (member, content-editor,
  admin, super-admin; ministry management), exactly like a web session.
- `channel: "scheme"` → the session is **member-level**, whatever the person's role: it passes
  `needs: "member"` endpoints only. Any endpoint declared `needs: "manager"` (or stronger) refuses
  it with `403 { "error": "verified_app_required" }`, and the app shows «Para administrar, instala
  la versión de la tienda».

Why: the phishing-app risk of D3 is bounded to what a member can already do from their own
account (read the team's schedule and the song library, edit their own availability and profile),
and never reaches the planner, the solver rules, people or access. Admin screens arrive in phase 3
(week 9+), after the Apple account exists, on verified sessions only. This mirrors ADR-0083,
where the kind of client decides which tools a grant gets.

### D5. Consent: none on the verified channel, an explicit step on the scheme channel

`/app/authorize` is a page behind the session middleware (like `/oauth/authorize`: a cookie-less
browser goes through sign-in and comes back with its query intact, relying on NextAuth's default
`redirect` callback, already guarded by `authRedirectCallback.test.ts`).

- Verified channel: after the request validates and the person is signed in (not impersonating,
  live-active), the page posts automatically — no screen — and the browser follows the 303 to the
  verified redirect. Only an app the OS vouches for can receive it.
- Scheme channel: the page renders ONE screen, «¿Entrar a Backstage en la app?», naming the
  platform, stating «Continúa solo si acabas de abrir la app Backstage en tu teléfono», with
  «Continuar» and «Cancelar». The code is minted only by the POST from that button. This removes
  the zero-click case: a browser that still holds a NextAuth cookie would otherwise hand a code to
  any app that opened the authorize URL with our scheme.

The apps start the flow with an ephemeral browser session (`prefersEphemeralWebBrowserSession`
on iOS; Auth Tab/Custom Tab without shared state where available), so in practice the person
signs in each time they sign in to the app — once per refresh lifetime (D7).

### D6. One grant-store protocol, two document families

The MCP grant store (`app/mcp/oauth/grantStore.ts`) already implements the hard part correctly:
grant creation, a 30 s read cache for the hot path and `fresh: true` for rotation, rotation under
`ifRevisionId`, revocation of the WHOLE grant when a superseded refresh `jti` is presented
(reuse detection), a lost revision race refused without revoking, and single-use code redemption
by `create()` on a deterministic id.

That protocol is extracted, unchanged, into a factory (`app/oauthCore/grantStoreProtocol.ts`)
parameterized by document type, id prefix, the code-redemption type/prefix, the document builder
and parser. The MCP store becomes `createGrantStore(MCP_CONFIG)` and keeps its exported names; the
app store is `createGrantStore(APP_CONFIG)`. The guard for the extraction is that every existing
MCP OAuth test passes UNCHANGED (no edits under `app/mcp/oauth/__tests__/`), plus the same suite
parameterized over the app config.

App documents (dotted ids, so the public reader never sees them, like the MCP ones):

- `appAuthGrant.<uuid>`: `sub` (member id), `clientId` (`backstage-ios`/`backstage-android`,
  public, stored as is), `platform` (`ios`/`android`, derived from the client), `channel`,
  `origin`, `createdAt`, `lastRefreshAt`, `currentRefreshJti`, `revoked`, `revokedAt`,
  `revokedReason`. Nothing else: no token, no code, no device name, no IP.
- `appAuthCode.<sha256(jti)>`: `redeemedAt`.

Sanity schema types are added for both (read-only in the Studio, like the MCP ones). Parsing fails
closed: a missing, malformed, or unknown-`channel` document reads as revoked.

Rejected alternative: a separate copy of the store for the app. Two copies of a security protocol
drift; the extraction keeps one.

### D7. Lifetimes

- Authorization code: 60 s, single use, bound to client, exact redirect, S256 challenge, channel.
- Access token: **1 hour** (MCP uses 7 days). Revocation itself is enforced by the guard's grant
  read (≤ 30 s, D8), not by expiry. The short life is defence in depth: a phone is easier to lose
  than claude.ai's server, and if a future change ever weakened the per-request grant check, a
  copied access token would still die within the hour, while every hour of use passes through the
  refresh path, which reads the grant fresh and re-checks the person.
- Refresh token: **90 days**, rotated on every use, reuse revokes the grant. 90 not 30 because many
  members open the app weekly or less; a 30-day idle window would sign them out monthly.
- Cost: a refresh is one fresh grant read plus one patch. With ~60 people refreshing at most when
  they open the app and their hour has passed, that is well under 1% of the Sanity request quota.

### D8. `requireAppSession` — the one guard

`app/appAuth/requireAppSession.ts`, called first by every `/api/app/v1/*` handler except the
token and revoke endpoints:

1. Kill switch `APP_AUTH_DISABLED` non-empty → 503. Host not canonical → 404. No secret → 503.
2. `Authorization: Bearer <token>`; anything else → 401 with
   `WWW-Authenticate: Bearer error="invalid_token"`.
3. Verify the access token: HS256 with the app key, `iss` = origin, `typ` = `app-at`,
   `aud` = `<origin>/api/app` (exact string), required `sub`, `grant`, `jti`, `exp`, `channel`.
   Expired → 401 `invalid_token` (the app refreshes and retries once).
4. Load the grant (30 s cache; revoked/missing/malformed → 401). `grant.sub === token.sub`,
   `grant.origin === origin`, `grant.channel === token.channel`, else 401.
5. Live access: `getMemberAccess(sub)` (30 s cache); not `active` → 401 (the app signs out and
   shows «Tu acceso está desactivado»). Errors reading Sanity → 503, never a pass.
6. Returns `{ sanityId, access, channel, platform, grantId }`. The handler then applies the SAME
   pure predicates the cookie guards use (`isMinistryMember`, `isMinistryManager`, the manager and
   super-admin checks), extracted where they are not already pure, with an equivalence test that
   runs one table of access snapshots through both the cookie guard and the bearer guard.
7. `needs` option: `"member"` (default) or `"manager"`/`"super-admin"`/ministry-scoped; on a
   `scheme` session anything above `"member"` → 403 `verified_app_required` (D4).

Never: impersonation (an app token's `sub` is always the person who signed in; there is no
impersonate parameter anywhere under `/api/app`), a role read from the token (the role is always
the live one), a write that trusts `access` from this guard where the writer today re-reads fresh
(writers keep calling `fetchMemberAccessFresh` inside their commits, ADR-0081 W1).

Revocation latency: a grant revoked in `/me` stops working within 30 s (grant cache); a member
disabled in the admin stops within 30 s (access cache). Same as the MCP route and the web session.

### D9. Revocation and the `/me` list

- `POST /api/app/v1/auth/revoke` (RFC 7009 shape): form `token` (a refresh token) + `client_id`.
  If the token verifies and its grant belongs to that client, the grant is revoked
  (`revokedReason: "app_sign_out"`). Always answers 200 (no oracle). The app calls it on «Cerrar
  sesión» and then deletes its local tokens and data regardless of the answer.
- `/me` gets a section «Apps conectadas»: the signed-in person's own live grants (platform,
  created, last used = `lastRefreshAt`), each with «Cerrar sesión en ese teléfono». The button
  calls `POST /api/me/app-sessions/[grantId]/revoke` (cookie session, `requireActiveSession`;
  refuses unless `grant.sub === session.user.sanityId`; refuses while impersonating). The read
  is server-side with the token-carrying client, filtered by `sub` in GROQ with a parameter.
- Disabling a member (existing flow) needs no extra step: D8 step 5 refuses them live.

## 3. Endpoint contracts

All under the deployment's canonical origin only (`resolveOrigin`); a foreign `Host` → 404. All
answers `Cache-Control: no-store`. Nothing logs a token, code, verifier or client secret; a server
failure logs a fixed stage name and at most a Sanity status code (as the MCP token route does).

### 3.1 `GET /app/authorize` (page, session-gated)

Parameters (each at most once): `response_type=code`, `client_id`, `redirect_uri`,
`code_challenge`, `code_challenge_method=S256`, `state` (required for app clients, 16–256
printable ASCII). Unknown parameters ignored. `scope`/`resource` not accepted (absent or refused
`invalid_request`). Order of checks, first failure wins:

1. Preflight (kill switch, host, secret) → 404/503 page.
2. Session: none → middleware sends the browser through sign-in and back. Impersonating → error
   page «Termina la suplantación antes de entrar a la app». Live access not active → error page.
3. `client_id` is one of the two; `redirect_uri` is EXACTLY one of that client's two redirects
   → else error PAGE (never redirect to an unverified target).
4. The rest (`response_type`, PKCE, `state`) → else error REDIRECT to the verified redirect with
   `error`, `state` (when present once) and `iss`.
5. Verified channel → auto-submitting form (no visible step) to 3.2. Scheme channel → the
   confirmation screen of D5.

### 3.2 `POST /api/app/v1/auth/authorize` (session-gated by its own check, not the matcher)

Form re-carrying every parameter; re-runs the SAME validator as 3.1 (one function, two callers),
re-checks the session, impersonation and live access, and for the scheme channel requires the
form's `confirm=1` from the button. Origin check on `Origin`/`Sec-Fetch-Site` (same-origin only)
against CSRF. Mints the code and answers `303` to `redirect_uri?code=…&state=…&iss=<origin>`.

### 3.3 `POST /api/app/v1/auth/token`

`application/x-www-form-urlencoded`, capped body, no repeated parameter, public clients only.

- `grant_type=authorization_code`: `code`, `redirect_uri`, `client_id`, `code_verifier`. Verify the
  code (key, iss, typ `app-code`, 60 s); `client_id` equals the code's; `redirect_uri` equals the
  code's exactly AND is one of that client's registered redirects; PKCE S256 matches; the
  subject's live access is active; only then redeem the code (`create()`, replay → `invalid_grant`)
  and create the grant with `channel` from the redirect. Returns
  `{ access_token, token_type: "Bearer", expires_in: 3600, refresh_token }`.
- `grant_type=refresh_token`: `refresh_token`, `client_id`. Verify the refresh token; read the grant
  FRESH; `grant.clientId === client_id`; `grant.sub === token.sub`; live access active; rotate
  (reuse → whole grant revoked, logged as a security event without the token). Returns a new pair;
  the access token carries the grant's stored `channel`, never one from the request.

Errors: RFC 6749 §5.2 JSON with fixed descriptions, as the MCP token route.

### 3.4 `POST /api/app/v1/auth/revoke` — D9.

### 3.5 `GET /app/callback/ios`, `GET /app/callback/android` (public page)

Reached only when a verified redirect is opened somewhere other than the app (app not installed,
or before the association files exist). Renders «Abre la app Backstage para terminar de entrar»
and NOTHING from the query (the code is never echoed, never put in a link). `Referrer-Policy:
no-referrer`, `Cache-Control: no-store`, `robots: noindex`. Excluded from the session matcher (a
signed-out browser must not be bounced through sign-in carrying the code in `callbackUrl`).

### 3.6 `GET /api/app/v1/me` — the proof endpoint

`requireAppSession({ needs: "member" })` → `{ id, name, alias, photoUrl, role, ministries,
channel, platform }`. Only the person's own record. `role` is reported so the app can hide admin
tabs; the SERVER still decides every admin call.

## 4. The session matcher

`proxy.ts` and its byte-identical copy `app/utils/routeMatcher.ts` (guarded by
`routeMatcher.test.ts`) gain exactly two anchored exclusions:

- `api/app/v1(?:/|$)` — every handler under it authenticates itself (bearer via D8, or the
  session check of 3.2). A new test asserts that EVERY `route.ts` under `app/api/app/v1/` other
  than `auth/token`, `auth/revoke` and `auth/authorize` calls `requireAppSession` before any other
  await (static check over the source, like `serviceCommitCallers.test.ts`), and that
  `auth/authorize` calls the session check first.
- `app/callback/(?:ios|android)$` — the inert page of 3.5, exact paths.

`/app/authorize` stays gated. Tests: `/app/authorize`, `/app/callbacks`, `/app/callback/ios/x`,
`/api/app`, `/api/apps` remain gated; `/api/app/v1/me` and the two callback paths are excluded.

## 5. Threat model (what each control answers)

| Threat | Control |
| --- | --- |
| A stolen access token | 1 h life; revocation in `/me` bites within 30 s; it opens `/api/app/v1` only |
| A stolen refresh token used after the real app refreshed | Reuse revokes the whole grant; the real app's next refresh fails and it asks to sign in again |
| A malicious app on the phone starts its own flow (scheme) | D5 confirmation step (no zero-click); D4 caps it at member level; verified channel needed for admin |
| Another app intercepts a code sent to the scheme | PKCE: it lacks the verifier |
| An MCP token used on the app API, or the reverse | Different secret, `typ` and `aud` (D2) |
| A dynamically registered MCP client names an app redirect | The MCP allowlist is unchanged and does not contain them (D1) |
| Open redirect via `redirect_uri` | Exact match against two fixed strings per client; unverified target → error page, never a redirect |
| CSRF on the code-minting POST | Same-origin check; session re-checked; scheme channel needs the explicit `confirm` |
| Code leaks through the web callback page | Never echoed; single use; 60 s; useless without the verifier |
| A super-admin impersonating someone signs the app in as them | Refused on 3.1 and 3.2 |
| Disabled member keeps using the app | Live access check on every request (≤ 30 s) and at every refresh |
| Grant documents read publicly | Dotted ids; no secret material stored |
| Secret missing or kill switch on | 503 everywhere in the door and the guard; nothing passes |

## 6. Tests (vitest)

- Tokens: sign/verify per kind; wrong key, wrong `typ`, wrong `aud`, missing claim, expired of
  another kind, MCP-key token refused.
- Authorize validator: every rule and the error-page vs error-redirect split; both channels.
- Authorize POST: session absent, impersonating, inactive, cross-site `Origin`, scheme without
  `confirm`, verified auto-path, 303 target exactness.
- Token route: the full matrix of 3.3, including replay, PKCE mismatch, redirect of the other
  client, the other channel's redirect, a refresh whose grant belongs to the other client, reuse →
  revocation, revision conflict → refused not revoked, channel taken from the grant.
- Guard: every step of D8, `scheme` + `needs: "manager"` → 403, and the cookie/bearer predicate
  equivalence table.
- Store factory: the MCP suite unchanged and green; the same suite over the app config.
- Matcher: §4 cases; the static «every route calls the guard first» check.
- `/me` revoke route: own grant only, impersonation refused.

Gates before claiming done: `npx tsc --noEmit`, `npm test`, `npx eslint .` (0 errors). No solver
tree is touched.

## 7. Release

Normal order (`CLAUDE.md` §Conventions): branch → gates → one fresh code review of the merge range
(this is an auth boundary, so a HIGH finding's fix gets a scoped re-review) → merge to `preview`,
verify the dev alias → PR to `main` → verify the prod alias. `APP_AUTH_SECRET` is set on Production
and Preview (`vercel env add`) before the merge that reads it; until then the door answers 503.

Note on testing against dev: the dev deployment is behind Vercel SSO, which a native app cannot
pass. The apps develop against a local `next dev` (`http://localhost:3000`, the canonical local
origin) from the iOS Simulator / Android emulator, and against production with Frank's own account
once released. The scheme redirect works on all three origins (it is not origin-bound); verified
redirects are per-origin.

## 8. Premises to verify (the review should check these, not assume them)

- P1. iOS `ASWebAuthenticationSession` supports an `https` callback (`Callback.https(host:path:)`)
  from iOS 17.4, and it requires the Associated Domains entitlement, which free provisioning does
  not offer.
- P2. Android's Auth Tab (`androidx.browser` `AuthTabIntent`) supports an `https` redirect verified
  by Digital Asset Links, and falls back to Custom Tabs where unsupported, which cannot reliably
  return an `https` redirect to the app — hence the scheme channel on Android too.
- P3. Google allows its sign-in inside `ASWebAuthenticationSession` and Custom/Auth Tabs (it blocks
  only embedded WebViews).
- P4. NextAuth's default `redirect` callback returns to `/app/authorize?…` with the full query after
  sign-in, as it does for `/oauth/authorize` (`authRedirectCallback.test.ts`).
- P5. The MCP grant-store protocol can be extracted without changing any MCP test file.

## 9. Docs in the same delivery

- ADR-0091 «Native apps sign in through their own first-party OAuth door» (D1–D4, rejected
  alternatives), linked from `app/appAuth/*` and `docs/MOBILE.md`.
- `docs/SECRETS.md`: `APP_AUTH_SECRET` (Production + Preview + local; generated with
  `openssl rand -base64 48`; rotation signs every app user out; nothing else breaks) and
  `APP_AUTH_DISABLED` (kill switch, normally unset).
- `docs/MOBILE.md`: the native plan replaces the Capacitor phases (Capacitor stays until the native
  apps reach parity).
- `docs/AUTH_AND_SECURITY.md`, `docs/ROUTES.md`: the new routes and the matcher exclusions.
- `CLAUDE.md` invariant line: «`/api/app/v1/*` authenticates with `requireAppSession` first; a
  `scheme` session is member-level only (ADR-0091)».
