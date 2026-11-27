# ADR-0091: Native apps sign in through their own first-party OAuth door, verified redirects only

**Date:** 2026-11-20 · **Status:** Accepted (Frank: «Solo entrada verificada» 2026-11-19, «Bloquear
Android 11 o anterior» 2026-11-20, «Empieza» 2026-11-20). Spec:
[`docs/superpowers/specs/2026-11-19-native-app-auth-design.md`](../superpowers/specs/2026-11-19-native-app-auth-design.md)
(critical-tier adversarial review, approved twice; its §10 amendments were not reviewed and are
covered by the implementation's code review).

## Context

Frank wants native iPhone (SwiftUI) and Android (Compose) apps with the whole app, admin included,
in v1. A native app must never read Sanity directly: it calls server routes that authenticate the
person and re-read their LIVE access, and every write still goes through the `*Commit.ts` writers.
So the first slice is only this: how a native app proves who the person is, and the one guard every
later `/api/app/v1/*` endpoint runs first.

The repo already runs an OAuth server for the MCP connector (ADR-0039, ADR-0083). Three of its
properties are wrong for a member app: only a super-admin or worship admin may hold a grant, its
tokens are audience-bound to `/api/mcp`, and its registration is open while its redirect list is
closed to claude.ai, ChatGPT and loopback. Widening any of the three weakens the connector.

## Decision

**A separate door** (`app/appAuth/*`, `app/api/app/v1/auth/*`, `app/(appauth)/app/*`), sharing only
the proven primitives: PKCE (`app/mcp/oauth/pkce.ts`), the capped body reader, the RFC 6749 error
responses, the canonical-origin check, and the grant-store PROTOCOL, extracted to
`app/oauthCore/grantStoreProtocol.ts` (`createGrantStore`); the MCP store is now its first instance,
with every export and every MCP test unchanged, and `app/appAuth/grantStore.ts` the second.

- **Its own secret, `APP_AUTH_SECRET`** (HS256, ≥ 32 bytes; never `MCP_OAUTH_SECRET` or
  `NEXTAUTH_SECRET`), its own token kinds (`app-code` 60 s, `app-at` 1 h with
  `aud = <origin>/api/app`, `app-rt` 90 d) and its own documents (`appAuthGrant.<uuid>`,
  `appAuthCode.<sha256(jti)>`, hidden and read-only in the Studio). Missing secret, or the kill
  switch `APP_AUTH_DISABLED` set → 503 everywhere in the door. A missing `SANITY_WRITE_TOKEN` is a
  503 too, never «revoked»: an untokened read of a dotted id answers «no record», which would sign
  every phone out.
- **Two static public clients** (`app/appAuth/clients.ts`): `backstage-ios` (iPhone, iPad and Mac)
  and `backstage-android`. On production and preview each has exactly ONE redirect, its verified
  `https` callback `<origin>/app/callback/{ios,android}`, compared as an exact string. The
  private-use scheme `app.vercel.owt-backstage:/oauth/callback/*` exists only on the local origin,
  for the Simulator and the emulator.
- **Every session carries the person's live role.** No channel, no cap, no reduced-power session:
  each endpoint declares a `needs` level and `requireAppSession` checks it against the LIVE access
  with the web's own predicates (`meetsNeeds` over `isMinistryMember`, `isMinistryManager`,
  `plansInMinistry`, `MANAGER_ROLES`). `plansInMinistry` is the one Jóvenes planner predicate the
  four Jóvenes pages now share with the app's `planner` level. A Jóvenes endpoint (a later slice)
  also calls `rolloutAllows` first, like the pages.
- **One visible tap before any code.** `/app/authorize` shows who is signing in and two buttons;
  only the tap's same-origin POST to `/app/authorize/submit` mints a code (`Sec-Fetch-Site`, else
  an exact `Origin`; `null` refused). The page never submits itself (tested). A GET of the submit
  URL answers a page, never a code.
- **Android 11 and older are refused at sign-in**, for every client id (`androidGate.ts`): the
  pages ask for `Sec-CH-UA-Platform-Version` (`Accept-CH` + `Critical-CH`; Chrome's reduced
  User-Agent freezes at «Android 10») and an Android request passes only with a major ≥ 12. No
  hint → refused.
- **Revocation.** The app's «Cerrar sesión» (RFC 7009 shape, 200 whatever the token, 503 only when a
  valid token's revocation write fails); «Apps conectadas» in `/me/ajustes` (the person's own live
  grants on this deployment, one at a time; hidden while impersonating); «Cerrar sesiones de la app»
  for a super-admin in «Personas» (every live grant of that member on this deployment, in one
  transaction, on the LIVE role). A grant is live while not revoked and used in the last 90 days.
  Refresh tokens rotate; a superseded one revokes the whole grant; a lost revision race is a 503
  `refresh_in_progress` without `Retry-After` (the apps refresh single-flight and never resend a
  token a concurrent refresh superseded, `docs/MOBILE.md`),
  never a revocation.

## Rejected

- **Reusing the MCP routes**, with a client-kind branch at every gate. See Context: each change opens
  the connector wider, and one missed branch would hand a member an MCP token.
- **A private-scheme channel on production with sessions capped at member level.** The cap does not
  hold here: a member can change their own email or set a password (and sign-in resolves by email),
  and several writers re-read the person's live access and widen by role (`updateMinistryEventPart`
  via `canWriteStored`). A reduced-power session layered over code that derives power from the
  person is fragile by construction.
- **A read-only scheme channel.** Smaller, but a second kind of session every future endpoint must
  remember. Frank chose not to carry it («Solo entrada verificada»).
- **Exchanging a Google ID token from the app** (the Capacitor wrap's `google-native` provider). It
  covers Google accounts only (a member who signs in with email and password could not use the
  app), yields a cookie session rather than a revocable grant «Apps conectadas» can show and close,
  and ties both apps to Google's SDK for every sign-in. It stays as it is for the wrap.
- **Minting the code without a tap.** On Android ≤ 11, or after a manual «Abrir de forma
  predeterminada» approval, another app can start our flow in its own tab and receive the redirect
  with a verifier it made itself; PKCE cannot tell. The tap costs one touch per 90 days.
- **Accepting the Android ≤ 11 residual** (Frank, 2026-11-20): blocked instead.

## Consequences

- **Devices.** iPhone/iPad iOS 17.4+ (XS/XR or newer), Mac macOS 14.4+, Android 12+ with Chrome 137+
  (Auth Tab). The Apple association is served since 2026-11-24 (Team ID `2NM4872N5S`,
  `/.well-known/apple-app-site-association`); a physical iPhone signs in through it once a signed
  build of `native/ios` is installed. The Android association is not published yet. Without the app
  (or before the OS has the file) a production redirect lands on the inert callback page.
- **Residuals Frank accepted.** (1) Android 12+: another app receives our redirect only if the person
  approved our domain for it in settings — «No, as far as Android's link rules go; Chrome's Custom
  Tab handling not device-tested». (2) iOS: an unassociated app should not receive an `https`
  callback for our domain (iOS 17.4 `webcredentials`); the older `callbackURLScheme: "https"`
  initializer is not device-tested (spec premise P8). In both cases the visible tap stops a flow
  the person did not start.
- **Rotation.** Rotating `APP_AUTH_SECRET` signs every app user out; nothing else breaks.
- **Undoing it.** Adding the scheme, any auto-submit or any reduced-power session to a deployed
  origin reopens exactly the attacks above. Dropping the Android gate reopens the ≤ 11 chooser case.
  Guards: `app/appAuth/__tests__/*` (the token matrix, the guard, «every `/api/app/v1` route calls
  `requireAppSession` first with a literal level», the `(appauth)` pages' import closure, the
  headers' order in `next.config.mjs`, the sanity-client guard), `routeMatcher.test.ts`.

## Addendum 2026-11-26: the app's first write door (W1)

A Lead proposes a service's setlist from the iPhone (spec
`docs/superpowers/specs/2026-11-26-native-proposal-save-design.md`, review log beside it).

- **One writer, two doors.** The web route's domain body moved verbatim into
  `app/utils/proposalSaveCommit.ts` (`saveProposal`, step 1, PR #280). `POST /api/me/proposals` and
  `POST /api/app/v1/proposals` both call it, so validation, the co-lead concurrency protocol and the
  notifications cannot drift. A second copy of a 400-line protocol was the rejected alternative.
- **What the app door adds.** After `requireAppSession` (worship member), a FRESH access read
  (`fetchMemberAccessFresh`): inactive → 401 `account_disabled`, out of Alabanza → 403, a failed read
  → 503 and no write. Any throw from the writer answers 503, never a bare 500.
- **The grant window.** The grant itself is not re-read fresh: a revoked grant can still write for up
  to 30 s per instance (the grant cache), the same window the MCP write door accepts.
- **The wrapped handler form.** The SR-verification scan requires
  `export const POST = withVerificationRunContext(…)` for any route importing a delivery-capable
  module, which the first-statement rule forbade. `appAuthStatic.test.ts` now accepts exactly that
  form around an `async function` declared in the same file whose first statement is the guard, with
  `withVerificationRunContext` imported from `@/app/utils/srVerificationRunContext`; any other
  `export const` handler is refused (fixtures for each refusal). An unauthenticated caller that sends
  verification headers gets a harmless reason-code warn line from the wrapper before the 401.
- **No member id on the wire.** The editor read (`proposalEditorRead.ts` → `appProposalEditor.ts`)
  answers contributors and thread messages with a name and a server-computed `mine`.
- **The client is the only place a co-lead's work is protected.** The writer compares id + revision
  only, so the app's `ProposalDraftState` never discards the lead's draft and never adopts a revision
  it did not see land; only «Recargar» does. The app never retries a save by itself.
- **Bound to the parser.** `native/contract/proposal-save-body.json` and `medley-normalize.json` are
  read by vitest (through `parseProposalSaveRequest` and `normalizeMedleyTags`) and by the XCTest.
- **Guards:** `appAuthStatic.test.ts` (the wrapped form), `serviceCommitCallers.test.ts`
  (`proposalSaveCommit`'s two callers; no `/api/app/v1` route imports the write client),
  `protectedReadAudit.test.ts` (the moved reads), `nativeProposalContract.test.ts`,
  `proposalsRoute.test.ts`.

## Addendum 2026-11-27: a Lead writes in a saved proposal's conversation (W1b)

Spec `docs/superpowers/specs/2026-11-27-native-proposal-message-design.md`, review log beside it.

- **One writer, two doors, as W1.** The body of `POST /api/me/proposals/[id]/messages` moved into
  `app/utils/proposalMessageCommit.ts` (`postProposalMessage`); the app's door is
  `POST /api/app/v1/proposal-messages/[proposalId]`, a top-level path because the writer keys by
  proposal id and a `proposals/[roleId]` segment would carry an id the door would have to cross-check.
- **The door adds what W1's adds:** the guard first, a malformed id 404 before any read, a fresh
  access read (401 / 403 / 503), any writer throw 503, no member id on the wire.
- **The author's name is read live on the app** (one guarded read of `coalesce(alias, member_name)`,
  `""` on failure, which is the push's nameless wording); the web keeps the session's snapshot. The
  same person's push can therefore be worded from a newer alias on the app. Cosmetic, accepted.
- **The app follows the append's revision only when `observedRev` is the one it holds** (the web's
  rule), so the lead's own message never makes their next save a 409, and a co-lead's change that
  landed first is never adopted silently. Saving and «Recargar» wait while a message is in flight,
  and the composer waits while a reload is (a late reload would erase the sent message on screen).
- **Guards:** `proposalMessagesRoute.test.ts`, `serviceCommitCallers.test.ts`,
  `protectedReadAudit.test.ts`, `routeMatcher.test.ts`, the XCTest of `ProposalDraftState`.
