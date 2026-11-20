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
Android signing-certificate fingerprint, which do not exist yet; recorded now for that slice: the
iOS file must list the app under BOTH `webcredentials` and `applinks`, because an `https` callback
in `ASWebAuthenticationSession` requires the `webcredentials` service type), Sign in with Apple (App Store
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

Rejected alternative: a native Google ID-token exchange. The repo already has a `google-native`
credentials provider (`auth.ts`, used by the Capacitor wrap's `NativeAuthBootstrap`) that turns a
Google ID token obtained in the app into a NextAuth cookie session. It is not the native apps'
door: it covers Google accounts only (members who sign in with email and password could not use
the app), it yields a cookie session rather than a revocable bearer grant the `/me` list can show
and close, and it would make the native apps depend on Google's SDK on both platforms for every
sign-in. It stays as it is for the Capacitor wrap until that wrap is retired; nothing in this slice
calls or changes it. Likewise `/api/me/push-token` stays cookie-only (the wrap's push
registration); the native apps' push registration is a later slice under `/api/app/v1` (D9).

### D2. Its own signing secret: `APP_AUTH_SECRET`

HS256 with the UTF-8 bytes of `APP_AUTH_SECRET` (≥ 32 bytes, the same rule as the MCP
`loadSecret`, which is hard-wired to `MCP_OAUTH_SECRET`; the app gets its own `loadAppSecret` in
`app/appAuth/secret.ts`, so `app/mcp/oauth/origin.ts` stays byte-unchanged), never
`MCP_OAUTH_SECRET` and never `NEXTAUTH_SECRET`. Key separation makes a token of one door
unverifiable by the other even if an `aud` or `typ` check were ever dropped. The `typ` values are
also distinct (`app-code`, `app-at`, `app-rt`). Fail closed: no secret → the app door answers 503.
Rotating it signs every app user out (documented in `SECRETS.md`, with «what breaks
mid-rotation»).

### D3. Two static public clients, one verified redirect each

The client registry is code, not data (`app/appAuth/clients.ts`):

| `client_id` | Redirect on production and preview | Extra redirect on the LOCAL origin only |
| --- | --- | --- |
| `backstage-ios` | `<origin>/app/callback/ios` | `app.vercel.owt-backstage:/oauth/callback/ios` |
| `backstage-android` | `<origin>/app/callback/android` | `app.vercel.owt-backstage:/oauth/callback/android` |

`<origin>` is the deployment's canonical origin (`canonicalOrigin`). Redirects are compared as
exact strings (no port, path or case variance). No client authentication (public clients,
`token_endpoint_auth_method: none`); a `client_secret` or `Authorization: Basic` is refused as in
the MCP token route.

**Production and preview accept only the verified `https` redirect.** Our own apps receive it
through a mechanism that delivers it only to an app our domain vouches for: iOS
`ASWebAuthenticationSession` with an `https` callback (iOS 17.4+, Associated Domains with the
`webcredentials` service type, `apple-app-site-association`), Android Auth Tab with an `https`
redirect verified by Digital Asset Links (`assetlinks.json`). The apps must never complete sign-in
through a plain browser intent, a Custom Tab, or an embedded WebView. If the device cannot run the
mechanism, the app does not sign in: on Android, no Auth Tab (Chrome older than 137, or a browser
without it) → the app says «Para entrar necesitas Chrome actualizado» with a link to it; the app
launches the Auth Tab in the Chrome package explicitly when Chrome is installed, whatever the
default browser.

**The exact guarantee against another app on the same phone.** The rule above binds OUR apps; it
does not bind an attacker's app, which can open our authorize URL in its own Custom Tab (sharing
the browser's cookies) with our `client_id`, our `https` redirect and a PKCE pair it generated
itself, and then hope the 303 to our `https` redirect is handed to it. Whether it can be:

| Platform | Can another app receive our `https` redirect? |
| --- | --- |
| iOS 17.4+ | No. Universal Links go only to the app the domain's association file names; an unassociated app cannot claim the domain. |
| Android 12+ | No, unless the person has manually approved our domain for that app under «Abrir de forma predeterminada» (unverified web links open in the browser by default). |
| Android 6–11, our app installed and verified | No. A verified App Link opens the verified app directly, with no chooser. This row holds only if the Android app declares an `autoVerify` App Link intent filter for `/app/callback/android` (the Auth Tab alone does not need one): a requirement recorded now for the Android and association-file slices. |
| Android 6–11, our app NOT installed (or its verification failed) | Yes, if the person picks the other app in the system chooser. |

So two residual cases remain, both requiring the person to act on their own phone: picking an
unknown app in the Android ≤ 11 chooser (realistically, someone who installed a fake «Backstage»
app instead of ours), or approving our domain for another app in Android 12+ settings. The server
cannot tell which app started a flow, so the control the server CAN apply is that no code is ever
minted silently: one visible tap on our own page, showing who is signing in (D5). A background flow
started by another app always stops at a screen the person must deliberately confirm. These
residuals are recorded in ADR-0091 for Frank to accept explicitly. Not verified on a device: how
Chrome on Android ≤ 11 dispatches a 303 to an `https` link from inside a Custom Tab when a
non-browser handler is present; the table assumes the worst (the chooser appears).

Within those bounds, every session the door issues carries the person's full live role, exactly like
a web session — there is no reduced-power session to leak (D4).

**The private-use scheme exists only on the local origin** (`http://localhost:3000`, what
`canonicalOrigin` returns when `VERCEL_ENV` is unset or `development`). It lets the iOS Simulator
and the Android emulator (with `adb reverse tcp:3000 tcp:3000`) sign in against a `next dev` on
Frank's Mac without an Apple Team ID or a signing fingerprint. The registry returns the scheme
redirects only when the resolved origin is `LOCAL_ORIGIN`; production and preview never list them,
and a test asserts both origins refuse them at authorize and at token. A local session is a
developer's own machine; it carries the full role like any other.

Until the association files are published (they need the Apple Team ID and the Android signing
fingerprint) a production redirect lands on the inert web page of §3.5. Consequence, chosen by
Frank on 2026-11-19 («Solo entrada verificada»): a physical iPhone cannot sign in until the paid
Apple Developer account exists; until then the iPhone app is tried in the Simulator against local.

Rejected alternatives: (a) a private-scheme channel on production with sessions capped at member
level. The cap does not hold in this codebase: a member can change their own email or set a
password (and sign-in resolves the member by email), and several writers re-read the person's live
access and widen by role (`updateMinistryEventPart` via `canWriteStored`), so a reduced-power
session layered over code that derives power from the person is fragile by construction. (b) A read-only scheme channel. Smaller, but still a second kind of session every
future endpoint must remember; Frank chose not to carry it.

### D4. Every session carries the person's live role — no channel, no cap

Because only verified redirects exist outside local, the grant has no `channel` and the guard has
no channel cap. What a session may do is decided per endpoint by its declared `needs` level (D8)
against the person's LIVE access, the same predicates the cookie guards use. This is the property
the rejected alternatives lacked: there is exactly one notion of power — the person's — whether the
request comes from the web or the app.

### D5. One visible tap before any code is minted — never a silent code

`/app/authorize` is a page behind the session middleware (like `/oauth/authorize`: a cookie-less
browser goes through sign-in and comes back with its query intact, relying on NextAuth's default
`redirect` callback, already guarded by `authRedirectCallback.test.ts`). After the request validates
and the person is signed in (not impersonating, live-active), the page shows ONE screen: the
person's name and photo, «¿Entrar a la app Backstage en este teléfono?», a primary button
«Entrar a la app» and a secondary «Cancelar», plus one line: «Si no abriste la app Backstage, toca
Cancelar». Only the button's form POST (§3.2) mints a code; the browser then follows the 303 to the
redirect. «Cancelar» redirects to the validated `redirect_uri` with `error=access_denied` and `state`.

Why a tap rather than zero-click: on Android ≤ 11 (and Android 12+ after a manual approval) another
app can start our flow in its own tab and, if the person picks it in a chooser, receive the code
with a verifier it generated itself (D3). PKCE does not help there, so the code must never be minted
without the person deliberately confirming on our page. The tap costs one touch per sign-in, which
happens once per refresh lifetime (D7). Same screen on every origin, local included (one code path).

The page renders the button only; it never auto-submits (no script that clicks it, no `autofocus`
submit on load), and a test asserts the rendered page has no auto-submitting form.

The apps start the flow with an ephemeral browser session (`prefersEphemeralWebBrowserSession` on
iOS; Auth Tab without shared state where available), so the person signs in when they sign in to
the app — once per refresh lifetime (D7).

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
parameterized over the app config. Constraints, all honoured:
`app/mcp/oauth/grantStore.ts` keeps importing `writeClient` and `grantDocument` itself and passes
the client into the factory (so `app/mcp/__tests__/mcpSanityClients.test.ts`'s stale-exemption check
and `oauthRegisterRoute.test.ts`'s import assertion keep holding without edits); the two new
document types join every Studio protection list the MCP types are in — in
`app/utils/studioProtection.ts`: `PROTECTED_STUDIO_TYPES`, `INTERNAL_STUDIO_TYPES`,
`INTERNAL_STUDIO_FIELDS` and `PROTECTED_STUDIO_TITLES`; in `studioProtection.test.ts`: its
expected protected, internal and schema-file lists (intended test changes); plus the Studio
structure if it lists the MCP types;
and the new `app/oauthCore/` and `app/appAuth/` modules get their own sanity-client guard entry
(writes only through the injected `writeClient`).

App documents (dotted ids, so the public reader never sees them, like the MCP ones):

- `appAuthGrant.<uuid>`: `sub` (member id), `clientId` (`backstage-ios`/`backstage-android`,
  public, stored as is), `platform` (`ios`/`android`, derived from the client), `origin`, `createdAt`, `lastRefreshAt`, `currentRefreshJti`, `revoked`, `revokedAt`,
  `revokedReason`. Nothing else: no token, no code, no device name, no IP.
- `appAuthCode.<sha256(jti)>`: `redeemedAt`.

Sanity schema types are added for both (read-only in the Studio, like the MCP ones). The two schema
files import only an import-free constants module (`app/appAuth/documentTypes.ts`: the type names
and id prefixes as string literals, no imports), never `app/appAuth/*` or `app/oauthCore/*`, so
`jose` and `node:crypto` never reach the Studio bundle; a test asserts that module has no `import`.
Parsing fails closed: a missing or malformed document, or one with an unknown `clientId`, reads as revoked.

Rejected alternative: a separate copy of the store for the app. Two copies of a security protocol
drift; the extraction keeps one.

### D7. Lifetimes

- Authorization code: 60 s, single use, bound to client, exact redirect and S256 challenge.
- Access token: **1 hour** (MCP uses 7 days). Revocation itself is enforced by the guard's grant
  read (≤ 30 s, D8), not by expiry. The short life is defence in depth: a phone is easier to lose
  than claude.ai's server, and if a future change ever weakened the per-request grant check, a
  copied access token would still die within the hour, while every hour of use passes through the
  refresh path, which reads the grant fresh and re-checks the person.
- Refresh token: **90 days**, rotated on every use, reuse revokes the grant. 90 not 30 because many
  members open the app weekly or less; a 30-day idle window would sign them out monthly. **No
  absolute grant lifetime**, by choice: a grant used at least every 90 days lives until revoked,
  like the web's rolling session; revocation (D9) and the live access check (D8) are the controls.
- **Strict reuse detection, no grace window.** A lost refresh response (app suspended, network
  switch) followed by a retry with the old refresh token revokes the grant and the member signs in
  again. Accepted for v1: a re-sign-in is the cost, and a grace window would let a copied previous
  token work. (A narrower option, returning the same new pair when the immediately previous token
  is replayed within a few seconds, is left for a later, separate decision if the logs show real
  users hitting this.)
- **A rotation that loses a revision race is not a revocation, and the app can tell.** The store
  refuses it without revoking (D6); the token endpoint answers it `503` with
  `{"error":"temporarily_unavailable"}` and `Retry-After: 1`, never `invalid_grant`. The app treats
  `invalid_grant` as «signed out» and `temporarily_unavailable` (or any 5xx or network error) as
  «try again»: it retries once with the same refresh token after the delay, then keeps its tokens
  and shows an offline state. If the race was a concurrent rotation by another holder of the same
  token, that retry is a reuse and revokes the grant, which is the intended outcome. The client contract REQUIRES one refresh owner per token store: only the main app
  process ever refreshes, single-flight (one refresh in flight, every request waiting on it), and it
  stores the new pair before using it. App extensions that share the keychain (widgets, the
  notification service extension) NEVER refresh; they read what the main app cached or show a
  placeholder. Revocations log
  their reason (`refresh_token_reuse`), so if the logs show real users hitting this, a grace window
  is a later, separate decision.
- Cost, computed: one refresh = one fresh grant read + one patch. Assume ~60 people, each opening
  the app 3 times a day after their hour expired: ~180 refreshes = ~360 Sanity requests a day,
  ~11,000 a month, plus one code exchange (≤ 3 requests) per sign-in. This is an estimate to check
  against `sanity.io/manage` usage after release, not a measurement.

### D8. `requireAppSession` — the one guard

`app/appAuth/requireAppSession.ts`, called first by every `/api/app/v1/*` handler except the
token and revoke endpoints:

1. Kill switch `APP_AUTH_DISABLED` non-empty → 503. Host not canonical → 404. No secret → 503.
2. `Authorization: Bearer <token>`; anything else → 401 with
   `WWW-Authenticate: Bearer error="invalid_token"`.
3. Verify the access token: HS256 with the app key, `iss` = origin, `typ` = `app-at`,
   `aud` = `<origin>/api/app` (exact string), required `sub`, `grant`, `jti`, `exp`.
   Expired → 401 `invalid_token` (the app refreshes and retries once).
4. Load the grant (30 s cache; revoked/missing/malformed → 401). `grant.sub === token.sub`,
   `grant.origin === origin`, else 401. A failed grant read (Sanity error) → 503, never 401 and
   never a pass, so an outage does not sign anyone out.
5. Live access: `getMemberAccess(sub)` (30 s cache); not `active` → 401 with the JSON body
   `{"error":"account_disabled"}` (distinct from an expired or revoked token, whose body is
   `{"error":"invalid_token"}`), so the app signs out AND shows «Tu acceso está desactivado»
   rather than a plain sign-in screen. The token endpoint does the same: an inactive subject is
   `invalid_grant` with the fixed description `account_disabled`. Errors reading Sanity → 503,
   never a pass.
6. Applies the endpoint's declared `needs` level (step 7) with the SAME pure predicates the
   cookie guards use, on the live `access`; a level the person does not meet → 403 `forbidden`.
   Returns `{ sanityId, access, platform, grantId }`.
7. **`needs` is REQUIRED — there is no default** (a ministry-agnostic default would
   break two-way ministry isolation, CLAUDE.md §Auth). The lattice:

   | Level | Passes when (live access) | Cookie-side twin |
   | --- | --- | --- |
   | `"self"` | active | `requireActiveSession`; the handler reads or writes ONLY the caller's own record (`/me`, own devices, own preferences) |
   | `{ ministry: m, as: "member" }` | `isMinistryMember(access, m)` | `requireMinistryMember(m)` |
   | `{ ministry: "jovenes", as: "planner" }` | `plansInMinistry(access, "jovenes")`: `isMinistryManager(access, "jovenes") \|\| ledGroupsIn(access, "jovenes").length > 0` — a Jóvenes manager (admin level or super-admin) OR a leader of at least one group. The handler then narrows: a manager sees every group, anyone else only `ledGroupsIn` (ADR-0085) | the same predicate, which the four web pages that gate on it today inline (`jovenes/admin`, `jovenes`, `jovenes/calendario`, `jovenes/reunion/[token]`: `isManager \|\| ledGroupsIn(…).length > 0`) switch to calling |
   | `{ ministry: m, as: "manager" }` | `isMinistryManager(access, m)` | `requireMinistryManager(m)` |
   | `"manager"` | role ∈ {super-admin, admin, content-editor} — the predicate `requireActiveManager` applies, read from LIVE access | `requireActiveManager` |
   | `"super-admin"` | role = super-admin | the routes' super-admin checks |

   Worship reads (schedule, songs, setlists) are `{ ministry: "worship", as: "member" }`, so a Kids-
   or Jóvenes-only member is refused them exactly as on the web. A level is an ENTRY gate only:
   what a person may then do inside the endpoint is decided by the same writer or read the web
   uses, which may widen by role (e.g. a Jóvenes manager editing any part through
   `updateMinistryEventPart`) — correct here, because every app session is the person themselves. The predicates are the existing pure ones (`isMinistryMember`,
   `isMinistryManager`, `ledGroupsIn` in `app/utils/ministryAccess.ts`) plus ONE new pure predicate
   there, `plansInMinistry(access, ministry)`, extracted from the four pages above (it composes the
   existing two, so `ledGroupsCoverage.test.ts`'s «no level comparison» rule still holds). The level
   is named `planner`, not `leader`, because `ledGroupsIn` deliberately has no manager arm and a
   level called «leader» that let admins in would read as a contradiction of it. The role sets are
   extracted from `authGuards.ts` into named constants both guards import. An equivalence test runs
   one table of access snapshots (a Jóvenes admin, a super-admin, a leader of one group, a leader
   with an empty `leaderOf`, a plain member, a worship-only member) through each cookie-side
   predicate and its bearer level.

Never: impersonation (an app token's `sub` is always the person who signed in; there is no
impersonate parameter anywhere under `/api/app`), a role read from the token (the role is always
the live one), a write that trusts `access` from this guard where the writer today re-reads fresh
(writers keep calling `fetchMemberAccessFresh` inside their commits, ADR-0081 W1).

Revocation latency: a grant revoked in `/me` stops working within 30 s (grant cache); a member
disabled in the admin stops within 30 s (access cache). Same as the MCP route and the web session.

### D9. Revocation and the `/me` list

- `POST /api/app/v1/auth/revoke` (RFC 7009 shape): form `token` (a refresh token) + `client_id`.
  If the token verifies and its grant belongs to that client, the grant is revoked
  (`revokedReason: "app_sign_out"`). It answers 200 whether or not the token was valid (no oracle),
  and `503` only when a valid token's revocation write failed (RFC 7009 §2.2.1 allows it). The app
  calls it on «Cerrar sesión» and then deletes its local tokens and data regardless of the answer;
  after a 503 that grant stays listed in «Apps conectadas» until the person closes it there or its
  90 days run out, which the list makes visible.
- `/me` gets a section «Apps conectadas»: the signed-in person's own live grants (platform,
  created, last used = `lastRefreshAt`), each with «Cerrar sesión en ese teléfono». The button
  calls `POST /api/me/app-sessions/[grantId]/revoke` (cookie session, `requireActiveSession`;
  refuses unless `grant.sub === session.user.sanityId` AND `grant.origin === origin`; refuses
  while impersonating). The read is server-side with the token-carrying client, filtered in GROQ
  by `sub` AND `origin` (both parameters), so a deployment lists only its own grants: local and
  preview test sessions share the dataset but never appear in production's list, matching the
  store's rule that one deployment never revokes another's grant. While a super-admin is
  impersonating, the section is not rendered (it would list the target's sessions); it shows
  «Termina la suplantación para ver las apps conectadas».
- A super-admin can close every app session of a member (a lost phone): «Cerrar sesiones de la
  app» on the member in `/admin` → `POST /api/admin/members/[id]/app-sessions/revoke`
  (super-admin only, checked in the route on live access; refused while impersonating; revokes every
  live `appAuthGrant` whose `sub` is that member AND whose `origin` is this deployment's,
  `revokedReason: "admin_revoked"`, all in ONE Sanity transaction: either every grant is revoked or
  none is and the route answers 503 «No se pudo cerrar; intenta de nuevo»). Decided: it does not span origins; a stray local or preview
  grant is a developer's test session and dies with its own deployment's revoke or its 90 days.
- Disabling a member (existing flow) needs no extra step: D8 step 5 refuses them live.
- Decided now for later slices: device push tokens registered through the app store the `grantId`
  they were registered under, and revoking a grant (any of the three paths) deletes them in the same
  operation, so a revoked phone stops receiving notifications. The member calendar feed (ADR-0057) is
  its own capability with its own rotation in Ajustes; revoking an app session does not rotate it.
  A password change does not revoke app sessions (it does not end web sessions either); the
  explicit revocations above are the tool.

## 3. Endpoint contracts

All under the deployment's canonical origin only (`resolveOrigin`); a foreign `Host` → 404. All
answers `Cache-Control: no-store`. Our code never logs a token, code, verifier or client secret; a
server failure logs a fixed stage name and at most a Sanity status code (as the MCP token route
does). The platform does: Vercel's request logs record full URLs, so a code that lands on the web
callback page of §3.5 (`/app/callback/*?code=…`) is in those logs. Accepted: the code lives 60 s, is
single use, and is useless without the PKCE verifier; tokens travel only in POST bodies and the
`Authorization` header, never in a URL.

### 3.1 `GET /app/authorize` (page, session-gated)

Parameters (each at most once): `response_type=code`, `client_id`, `redirect_uri`,
`code_challenge`, `code_challenge_method=S256`, `state` (required for app clients, 16–256
printable ASCII). Unknown parameters ignored. `scope`/`resource` not accepted (absent or refused
`invalid_request`). Order of checks, first failure wins:

1. Preflight (kill switch, host, secret) → 404/503 page.
2. Session: none → middleware sends the browser through sign-in and back. Impersonating → error
   page «Termina la suplantación antes de entrar a la app». Live access not active → error page.
3. `client_id` is one of the two; `redirect_uri` is EXACTLY one of that client's redirects FOR
   THIS ORIGIN (D3) → else error PAGE (never redirect to an unverified target).
4. The rest (`response_type`, PKCE, `state`) → else error REDIRECT to the request's validated
   `redirect_uri` with `error`, `state` (when present once) and `iss`.
5. The confirmation screen of D5: a form POST to 3.2 carrying every parameter, submitted only by
   the person's tap. It is answered with `Referrer-Policy: same-origin` (pinned, so the browser sends
   a real `Origin` on the POST, never `null`), `Cache-Control: no-store`, `X-Frame-Options: DENY`
   and `Content-Security-Policy: frame-ancestors 'none'` so another page cannot frame it and steal
   the tap.

The page lives in its own route group, `app/(appauth)/`, with a minimal layout (brand styles only:
no navbar, tab bar, assistant bubble or anything else of the `(client)` shell), because it is shown
inside the app's sign-in sheet. The page itself reads the session; the layout reads nothing.

**Where the headers come from.** A Server Component cannot set response headers, and
`next.config.mjs` `headers()` already sends `X-Frame-Options: SAMEORIGIN` and
`Referrer-Policy: strict-origin-when-cross-origin` on `/(.*)`. Next applies the LAST matching entry
for a repeated key, so new entries AFTER the global ones set: for `/app/authorize` and
`/app/authorize/submit` — `X-Frame-Options: DENY`, `frame-ancestors 'none'`,
`Referrer-Policy: same-origin`, `Cache-Control: no-store`; for `/app/callback/:platform` —
`Referrer-Policy: no-referrer`, `Cache-Control: no-store`, `X-Robots-Tag: noindex`. A test asserts
these entries on the config object (order included), not by rendering the page.

### 3.2 `POST /app/authorize/submit` (behind the session middleware, like the page)

Not under `api/app/v1`, so the matcher's session gate covers it as it covers `/api/oauth/authorize`
on the MCP door; the handler still re-checks everything itself. Form re-carrying every parameter
plus `decision=allow|deny`; re-runs the SAME validator as 3.1 (one function, two callers), re-checks
the session, impersonation and live access.

CSRF, in this order: if `Sec-Fetch-Site` is present it must be `same-origin`, else refused. If it
is absent, `Origin` must be present and equal the canonical origin; a missing `Origin` or the
literal `null` is refused. (Every browser the apps can sign in through sends `Sec-Fetch-Site`:
Chrome 137+, and Safari on iOS 17.4+.) A refused POST answers an error page, never a redirect.

`decision=deny` → `303` to `redirect_uri?error=access_denied&state=…&iss=<origin>`.
`decision=allow` → mints the code and answers `303` to `redirect_uri?code=…&state=…&iss=<origin>`.

### 3.3 `POST /api/app/v1/auth/token`

`application/x-www-form-urlencoded`, capped body, no repeated parameter, public clients only.

- `grant_type=authorization_code`: `code`, `redirect_uri`, `client_id`, `code_verifier`. Verify the
  code (key, iss, typ `app-code`, 60 s); `client_id` equals the code's; `redirect_uri` equals the
  code's exactly AND is one of that client's redirects for this origin; PKCE S256 matches; the
  subject's live access is active; only then redeem the code (`create()`, replay → `invalid_grant`)
  and create the grant. Returns
  `{ access_token, token_type: "Bearer", expires_in: 3600, refresh_token }`.
- `grant_type=refresh_token`: `refresh_token`, `client_id`. Verify the refresh token; read the grant
  FRESH; `grant.clientId === client_id`; `grant.sub === token.sub`; live access active; rotate
  (reuse → whole grant revoked, logged as a security event without the token; a lost revision race
  → `503 temporarily_unavailable`, not revoked, D7). Returns a new pair.

Errors: RFC 6749 §5.2 JSON with fixed descriptions, as the MCP token route.

### 3.4 `POST /api/app/v1/auth/revoke` — D9.

### 3.5 `GET /app/callback/ios`, `GET /app/callback/android` (public page)

Reached only when a verified redirect is opened somewhere other than the app (app not installed,
or before the association files exist). Renders «Abre la app Backstage para terminar de entrar»
and NOTHING from the query (the code is never echoed, never put in a link). `Referrer-Policy:
no-referrer`, `Cache-Control: no-store`, `noindex` (headers set in `next.config.mjs`, §3.1).
Excluded from the session matcher (a signed-out browser must not be bounced through sign-in
carrying the code in `callbackUrl`). It lives in the same `app/(appauth)/` group, whose minimal
layout imports nothing that reads a session, cookie, network or env (the pattern of `(gallery)`,
ADR-0017), and the callback page itself imports nothing that does either, so "renders nothing from
the query and loads nothing" is structural rather than a promise about the `(client)` layout's
components.

### 3.6 `GET /api/app/v1/me` — the proof endpoint

`requireAppSession({ needs: "self" })` → `{ id, name, alias, photoUrl, role, ministries,
platform }`. Only the person's own record. `role` is reported so the app can hide admin
tabs; the SERVER still decides every admin call.

## 4. The session matcher

`proxy.ts` and its byte-identical copy `app/utils/routeMatcher.ts` (guarded by
`routeMatcher.test.ts`) gain exactly two anchored exclusions:

- `api/app/v1(?:/|$)` — every handler under it authenticates itself with a bearer token. A new
  test asserts that EVERY `route.ts` under `app/api/app/v1/` other than `auth/token` and
  `auth/revoke` calls `requireAppSession` with a literal `needs` level before any other await
  (static check over the source, like `serviceCommitCallers.test.ts`). No cookie-session handler
  lives under this prefix.
- `app/callback/(?:ios|android)$` — the inert page of 3.5, exact paths.

`/app/authorize` and `/app/authorize/submit` stay gated. Tests: `/app/authorize`,
`/app/authorize/submit`, `/app/callbacks`, `/app/callback/ios/x`, `/api/app`, `/api/apps` remain
gated; `/api/app/v1/me` and the two callback paths are excluded.
`routeMatcher.test.ts`'s `PUBLIC_ROUTES` list (its disk walk of ungated routes) gains every route
under `app/api/app/v1/` and the two callback pages, so each new ungated route is reviewed there.

## 5. Threat model (what each control answers)

| Threat | Control |
| --- | --- |
| A stolen access token | 1 h life; revocation in `/me` bites within 30 s; it opens `/api/app/v1` only |
| A stolen refresh token used after the real app refreshed | Reuse revokes the whole grant; the real app's next refresh fails and it asks to sign in again |
| A malicious app on the phone starts its own flow | iOS 17.4+ and Android 12+ (no manual approval): it cannot receive our `https` redirect (D3 table). Everywhere: no code is minted without the person's visible tap on our page showing their name (D5), so a background flow always stops. Residual, accepted in ADR-0091: on Android ≤ 11 without our app installed, or after a manual «Abrir de forma predeterminada» approval, a person who taps «Entrar a la app» and then picks the other app in the chooser hands it a session. The scheme exists only on localhost |
| A code is intercepted by something that did not start the flow (a browser that opened the link, a log) | PKCE: useless without the verifier the real app holds |
| A Kids- or Jóvenes-only member reads worship data through the app | No default level; worship reads declare `{ ministry: "worship", as: "member" }` (D8) |
| A lost phone | The member closes the session in `/me`, or a super-admin closes all of that member's app sessions (D9); ≤ 30 s |
| A scheme redirect accepted on production by mistake | Registry lists scheme redirects only for `LOCAL_ORIGIN`; tests on production and preview origins at authorize and token |
| An MCP token used on the app API, or the reverse | Different secret, `typ` and `aud` (D2) |
| Another app shows our sign-in in its own embedded WebView | Out of scope, stated in ADR-0091: a WebView shares no cookies with the browser and Google refuses sign-in there, so the person would have to type their password into that app — credential phishing, which no redirect design prevents |
| A dynamically registered MCP client names an app redirect | The MCP allowlist is unchanged and does not contain them (D1) |
| Open redirect via `redirect_uri` | Exact match against two fixed strings per client; unverified target → error page, never a redirect |
| CSRF or clickjacking on the code-minting POST | `Sec-Fetch-Site: same-origin` (or an exact `Origin`; `null` refused); the POST stays behind the session middleware and re-checks the session; the page refuses framing (§3.1, §3.2) |
| Code leaks through the web callback page or the platform's request logs | Never echoed; single use; 60 s; useless without the verifier; tokens never travel in a URL (§3) |
| A super-admin impersonating someone signs the app in as them | Refused on 3.1 and 3.2 |
| A momentary write conflict signs the person out | A lost revision race answers `temporarily_unavailable`, distinct from `invalid_grant`; the app retries instead of signing out (D7) |
| Disabled member keeps using the app | Live access check on every request (≤ 30 s) and at every refresh |
| Grant documents read publicly | Dotted ids; no secret material stored |
| Secret missing or kill switch on | 503 everywhere in the door and the guard; nothing passes |

## 6. Tests (vitest)

- Tokens: sign/verify per kind; wrong key, wrong `typ`, wrong `aud`, missing claim, expired of
  another kind, MCP-key token refused.
- Clients registry: scheme redirects listed ONLY for `LOCAL_ORIGIN`; production and preview list
  exactly their one `https` redirect per client.
- Authorize validator: every rule and the error-page vs error-redirect split; a scheme redirect on
  the production and preview origins → error page.
- Authorize page: renders the confirmation screen with no auto-submit (no script, no auto-submitting
  form). Headers: the `next.config.mjs` entries of §3.1, asserted on the config (they override the
  global ones by coming after them).
- Authorize POST: session absent, impersonating, inactive; `Sec-Fetch-Site` cross-site/same-site
  refused; no `Sec-Fetch-Site` with `Origin` missing, `null` or foreign refused; `decision=deny` →
  `access_denied` redirect and no code minted; 303 target exactness.
- Token route: the full matrix of 3.3, including replay, PKCE mismatch, redirect of the other client,
  a scheme redirect on production/preview, a refresh whose grant belongs to the other client, reuse →
  revocation, revision conflict → `503 temporarily_unavailable` and not revoked.
- Guard: every step of D8; every lattice level; a Kids-only member refused worship `member`; a
  Jóvenes admin and a super-admin pass `planner`; a leader with an empty `leaderOf` is refused it;
  inactive → `account_disabled`; grant read failure → 503; the cookie/bearer predicate
  equivalence table.
- `plansInMinistry`: the four Jóvenes pages call it (static check) and their behaviour is unchanged.
- Revoke endpoints: a failed write → 503 (app revoke, admin revoke-all with nothing revoked).
- Store factory: the MCP suite unchanged and green; the same suite over the app config.
- Matcher: §4 cases; the static «every route calls the guard first» check, which also asserts each
  call passes a literal `needs` (no call without it, no computed level).
- `/me` list and revoke route: own grants of THIS origin only (a grant of another origin is neither
  listed nor revocable), impersonation refused, and the list not rendered while impersonating. Admin revoke route: super-admin only, impersonation
  refused, revokes every live grant of that member on this origin and nothing else.
- Schema constants module: no `import` statement.

Gates before claiming done: `npx tsc --noEmit`, `npm test`, `npx eslint .` (0 errors). No solver
tree is touched.

## 7. Release

Normal order (`CLAUDE.md` §Conventions): branch → gates → one fresh code review of the merge range
(this is an auth boundary, so a HIGH finding's fix gets a scoped re-review) → merge to `preview`,
verify the dev alias → PR to `main` → verify the prod alias. `APP_AUTH_SECRET` is set on Production
and Preview (`vercel env add`) before the merge that reads it; until then the door answers 503.

Note on testing against dev: the dev deployment is behind Vercel SSO, which a native app cannot
pass. The apps develop against a local `next dev` (`http://localhost:3000`, the canonical local
origin) with the local-only scheme: the iOS Simulator reaches it as `localhost`; the Android
emulator must use `adb reverse tcp:3000 tcp:3000` (its `10.0.2.2` host would be refused by
`resolveOrigin`, by design). Physical phones sign in only against production through the verified
redirect, so they wait for the association files: the iPhone for the paid Apple account (Team ID),
Android for the release signing key's fingerprint.

Narrowing of «toda la app desde v1», stated plainly in ADR-0091: nothing in the app is reduced — the
whole app, admin included, works on any signed-in session — but a physical iPhone can sign in only
once the Apple Developer account exists, the iPhone app's minimum is iOS 17.4 (so iPhone XS/XR or
newer; an iPhone X, 8 or older cannot run it), and an Android phone needs Chrome 137+.

## 8. Premises to verify (the review should check these, not assume them)

- P1. iOS `ASWebAuthenticationSession` supports an `https` callback (`Callback.https(host:path:)`)
  from iOS 17.4, and it requires the Associated Domains entitlement, which free provisioning does
  not offer.
- P2. Android's Auth Tab (`androidx.browser` `AuthTabIntent`, Chrome 137+) supports an `https`
  redirect verified by Digital Asset Links and returns the result only to the app the domain names;
  where unsupported it falls back to Custom Tabs, which the app must NOT use for sign-in (D3).
- P3. Google allows its sign-in inside `ASWebAuthenticationSession` and Custom/Auth Tabs (it blocks
  only embedded WebViews).
- P4. NextAuth's default `redirect` callback returns to `/app/authorize?…` with the full query after
  sign-in, as it does for `/oauth/authorize` (`authRedirectCallback.test.ts`).
- P5. The MCP grant-store protocol can be extracted without changing any MCP OAuth test file
  (`app/mcp/oauth/__tests__/`, `mcpSanityClients.test.ts`, `oauthRegisterRoute.test.ts`); the only
  intended test edit outside the new suites is adding the two types to `studioProtection.test.ts`'s
  lists (D6).
- P6. An `https` callback in `ASWebAuthenticationSession` requires the `webcredentials` service type
  in the association file (found in Apple forum threads and third-party guidance; to be confirmed
  against Apple's documentation in the association-file slice).
- P7. On Android 6–11 a verified App Link opens the verified app directly with no chooser, and an
  unverified one shows the chooser; on Android 12+ unverified web links open in the browser unless
  the person approves the domain for an app (D3 table). Not device-tested: Chrome's dispatch of a
  303 from inside a Custom Tab on Android ≤ 11.

## 9. Docs in the same delivery

- ADR-0091 «Native apps sign in through their own first-party OAuth door, verified redirects
  only» (D1–D5, both rejected scheme alternatives and the rejected Google ID-token exchange and why,
  the device narrowing, and the residual Android risk of D3 with Frank's explicit acceptance),
  linked from `app/appAuth/*` and `docs/MOBILE.md`.
- `docs/SECRETS.md`: `APP_AUTH_SECRET` (Production + Preview + local; generated with
  `openssl rand -base64 48`; rotation signs every app user out; nothing else breaks) and
  `APP_AUTH_DISABLED` (kill switch, normally unset).
- `docs/MOBILE.md`: the native plan replaces the Capacitor phases (Capacitor stays until the native
  apps reach parity).
- `docs/AUTH_AND_SECURITY.md`, `docs/ROUTES.md`: the new routes and the matcher exclusions.
- `CLAUDE.md` invariant line: «`/api/app/v1/*` authenticates with `requireAppSession` first, with a
  declared `needs` level (no default). The app door accepts only the verified `https` redirects on
  production and preview, and mints a code only on the person's visible tap; the private scheme
  exists only on localhost — never add it, any auto-submit, or any reduced-power session to a
  deployed origin (ADR-0091)».
- `next.config.mjs`: its CSP caveat comment also names the app's local-only scheme redirect, so a
  future `form-action` directive does not silently break local development.

## 10. Post-approval amendments (NOT covered by the review approval)

The adversarial review approved the text above this section (§0–§9) at SHA-256
`704124851b4e39fe7b98e6aaf4998a31a322ca199086b151dbfb3191a9cb6462` (review log beside this file).
The amendments below adopt the reviewers' non-blocking suggestions after that approval. They were
not reviewed; where one contradicts the text above, the amendment wins, and the implementation's
merge-range code review covers them.

**A1. The iOS row of D3 and §5, restated.** The threat is not Universal Links: it is an
unassociated app opening our authorize URL in its OWN `ASWebAuthenticationSession` with an `https`
callback for our host. iOS 17.4+ refuses an `https` callback for a domain the app is not associated
with (`webcredentials`). New premise **P8**, to be confirmed before ADR-0091 presents the iOS row as
«No»: an unassociated app cannot intercept an `https` navigation through the older initializer with
`callbackURLScheme: "https"` either (sources disagree). If P8 cannot be confirmed, ADR-0091 lists it
as a residual Frank accepts, next to the Android ones. The Mac app (same SwiftUI target) has the
same mechanism from macOS 14.4 and joins the table with the same row.

**A2. Android 12+ row made conditional.** «No» assumes Chrome, inside another app's Custom Tab,
hands an `https` navigation to Android's link resolution and does not target the hosting app; not
verified. ADR-0091 states it as «No, as far as Android's link rules go; Chrome's Custom Tab handling
not device-tested». The visible tap (D5) is unchanged either way.

**A3. Apple minimums and platform label.** iPhone iOS 17.4, iPad iPadOS 17.4, Mac macOS 14.4. iPad
and Mac use the `backstage-ios` client; `platform` stays `ios` on the grant and the `/me` list shows
«iPhone, iPad o Mac». The `/me` button reads «Cerrar sesión en ese dispositivo».

**A4. Live grants.** A grant is LIVE when `revoked != true` and
`coalesce(lastRefreshAt, createdAt)` is within the refresh lifetime (90 days; `lastRefreshAt` is
null until the first refresh). The `/me` list and the admin revoke-all act only on live grants
(tests: an idle 91-day grant is neither listed nor counted). Both live in the store factory
(`listLiveGrants(sub, origin)`, `revokeAllGrants(sub, origin, reason)` in one transaction), so the
revocation patch and the cache drop keep one owner and the sanity-client guard stays accurate.

**A5. A missing read token is an outage, not a revocation.** If the grant reader's client carries no
token (`SANITY_WRITE_TOKEN` unset on a deployment), a dotted-id read answers «no record» with no
error. The app store refuses to run without a token: the guard and the token endpoint answer 503,
never 401/`invalid_grant`, so a misconfiguration cannot sign every phone out. Test: no token → 503.

**A6. Type pin on the `/me` revoke.** The route writes a client-supplied id: it pins the type first
(`isGrantId` + the `_type`-filtered `loadGrant`, the equivalent of `storedRevisionOfType`, W9) and a
test sends the id of another document type.

**A7. Rollout and the Jóvenes wording.** A level is not the whole web gate: every Jóvenes endpoint
also calls `rolloutAllows("jovenesEvents", access)` first, like the pages, and the equivalence table
includes a person outside the rollout. Correction to D8: only `jovenes/admin` GATES on the predicate;
the other three pages use it as the «Planear» flag. All four switch to `plansInMinistry`.

**A8. Callback page.** Two static folders (`app/(appauth)/app/callback/ios`, `…/android`), not
`[platform]`, so `PUBLIC_ROUTES` lists the two real pages. The page is `force-dynamic` so the
`no-store` header is what is served. Its isolation gets a guard: an import-closure test (the
existing walker) over `(appauth)/layout.tsx` and both callback pages (no session, cookie, network,
env or Sanity import), and a render test that a `?code=…&state=…` query never appears in the output.

**A9. `GET /app/authorize/submit`.** If the session expires between the screen and the tap, the
middleware sends the POST through sign-in and back as a GET. That GET answers an error page
«Vuelve a la app y toca Entrar otra vez», never a code.

**A10. Requirements recorded now for the native slices.** The apps ignore any callback with no
matching pending `state` and verifier (a link opened outside the sign-in sheet). The HTTP layer never
retries the token POST on its own (OkHttp `retryOnConnectionFailure` off for that call; URLSession
without automatic retry), because a silent retry of a refresh is a reuse that revokes the grant.

**A11. Release smoke test.** After the production release, one flow by hand on the inert callback
page with a known verifier, then `curl`: code exchange, `GET /api/app/v1/me`, refresh, a reuse that
must revoke, and the revoke endpoint. Recorded in `docs/MOBILE.md`, as the MCP door's smoke was.

**A12. Cost.** D7 counts refreshes only. The guard's grant and access reads (30 s cache per instance
on Fluid compute) add up to two reads per active user per 30 s of use; the post-release
`sanity.io/manage` check compares against that, not the refresh figure alone.

**A13. Android on a physical device and Play.** Testing on a phone need not wait for the release key:
the upload or debug key's fingerprint can go in `assetlinks.json` in the association-file slice. A
Google Play organization account may itself need the D-U-N-S number; `MOBILE.md` says so.

**A14. Docs added to §9.** `docs/agents/project-rules.md` (the long form of the CLAUDE.md line),
`docs/DATA_MODEL.md` (the two new types), and the CLAUDE.md «Reusable utils» list
(`requireAppSession`, `plansInMinistry`). `SECRETS.md`: Production and Preview get DIFFERENT
`APP_AUTH_SECRET` values.

**A15. Android 11 and older are refused at sign-in (Frank's decision, 2026-11-20).** Frank chose
«Bloquear Android 11 o anterior» over accepting the D3 residual. Because the attack works with ANY
`https` redirect on our domain (D3), the gate is on the BROWSER making the request, for every client
id, not on the Android app:

- `/app/authorize` and `/app/authorize/submit` answer every request with
  `Accept-CH: Sec-CH-UA-Platform-Version` and `Critical-CH: Sec-CH-UA-Platform-Version`, so Chrome
  retries the navigation carrying the real Android version (Chrome's reduced user-agent string
  freezes it at «Android 10» and cannot be used).
- A request is from Android when `Sec-CH-UA-Platform` is `"Android"` or, when that header is absent,
  the `User-Agent` contains `Android`. For such a request, the page shows NO confirmation and the
  POST mints NO code unless `Sec-CH-UA-Platform-Version` is present and its major number is ≥ 12.
  Absent or unparsable → refused (fail closed). The refusal page reads «La app de Backstage necesita
  Android 12 o más nuevo. Puedes seguir usando Backstage en el navegador». Anything else (iOS, iPadOS,
  macOS, desktop) is unaffected.
- The check is one pure function (`androidVersionAllows(headers)`) called by both the page and the
  POST, with tests: Android 11 refused, 12 allowed, Android without the version hint refused, a
  non-Chrome Android user agent without client hints refused, iOS and desktop unaffected.
- The Android app sets `minSdk` 31 (Android 12), so Play does not offer it to phones that could not
  sign in anyway. The parent plan's «Android 8 / API 26» changes accordingly.
- Remaining residual, stated in ADR-0091: the Android 12+ case of D3 (the person manually approving
  our domain for another app in Settings), and an Android ≤ 11 browser whose user agent hides Android
  (a «desktop site» mode the person turned on). Both need the person's own deliberate action.
- New premise P9: Chrome on Android (137+) honours `Critical-CH` for `Sec-CH-UA-Platform-Version` on
  a top-level navigation, including inside a Custom Tab and an Auth Tab. To verify on a device in
  the Android slice; until verified, the fail-closed rule means a wrong premise blocks sign-in, never
  lets an old phone through.

Un-reviewed like the rest of §10. It only narrows who can sign in: if it is wrong, the failure is a
refused sign-in, not a wider one.

**A16. Refreshes are single-flight; a lost race says so (implementation code review, 2026-11-20).**
A10 forbids automatic retries but not a deliberate retry after a 503. When two refreshes of the SAME
token race, the loser's `conflict` was a 503 with `Retry-After: 1`; retrying that superseded token
is a reuse and revokes the grant, the winner's new tokens included. So the conflict answer is now
503 `temporarily_unavailable` with `error_description: refresh_in_progress` and no `Retry-After`,
and the apps refresh single-flight across the app and its extensions, re-read the stored refresh
token after any refresh 503, and never resend a token a concurrent refresh superseded
(`docs/MOBILE.md`). A retry after any other 503 whose rotation had in fact committed still revokes;
the worst case is one sign-in tap.
