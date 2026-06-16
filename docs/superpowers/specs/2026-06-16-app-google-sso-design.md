# Design: Native Google SSO for the mobile app

**Date:** 2026-06-16
**Status:** Approved (design) — pending implementation plan
**Topic:** Make Google Sign-In work inside the Capacitor iOS/Android wrap, with permanent-feeling login and a near-instant access kill switch.

---

## 1. Problem & context

The app is a Capacitor wrap that loads the live Next.js site (`https://owt-backstage.vercel.app`) in a WebView. Auth is NextAuth v4 with a **stateless JWT** session, and every route is gated by `proxy.ts` (next-auth `withAuth`), which only verifies the signed JWT cookie — it never reads Sanity.

Google SSO does not work in the wrap: the WebView punts `accounts.google.com` to the system browser, the session cookie lands in that browser (not the WebView), and Google blocks OAuth inside embedded webviews. Today, app users must use email + password. We want Google Sign-In working in-app.

## 2. Goals / non-goals

**Goals**
- Google Sign-In works inside the iOS and Android wrap, establishing the **same cookie session** as the web (no change to `proxy.ts` or the cookie auth model).
- Login feels **permanent** — valid users effectively never see a login screen again.
- A real, **near-instant kill switch**: an admin can cut a member's access and it takes effect within ~30s on all functional surfaces.
- Web/desktop behavior unchanged.

**Non-goals (explicitly out of scope)**
- Offline support / bearer-token rearchitecture (future Phase 2).
- "Sign in with Apple" (noted for App Store guideline 4.8 at submission time; not built now).
- The actual Android **build** (we set up Android config now, but building it waits on the Android toolchain).

## 3. Decisions (settled during brainstorming)

| Decision | Choice |
|---|---|
| Auth approach | **Approach 1** — native Google Sign-In → Google ID token → new `google-native` NextAuth Credentials provider → normal cookie session. Cookie-preserving; reuses existing callbacks. |
| Plugin | `@capgo/capacitor-social-login` (actively maintained for Capacitor 8; returns Google ID token; supports silent restore). Exact silent-restore API to be confirmed in planning. |
| Platforms | iOS + Android config now (Android built later). |
| Providers | Google only for now. |
| Login longevity | **Base session 7 days (rolling)** + **native silent re-auth** → feels permanent for valid users. |
| Kill switch | `disabled` boolean on `teamMembers` + **per-request `assertMemberActive`** (Node-side, ~30s TTL cache) → ~30s revocation on all dynamic/API surfaces. Member is **disabled, not deleted** (reversible, no dangling references). |
| Static pages | `schedule` + home stay **statically cached** (no perf hit). A disabled member retains read-only roster/schedule view only until their token expires (≤7 days); fully blocked from logging back in immediately. Accepted tradeoff. |

## 4. Architecture overview

When the app runs in Capacitor, the sign-in page calls the native Google plugin instead of the web redirect. The plugin returns a Google **ID token**, which the web client passes to the **`google-native`** Credentials provider. The provider verifies the token server-side, maps it to a `teamMembers` doc, confirms the member is active, and mints the **standard NextAuth cookie session** — same cookie, same `jwt`/`session` callbacks, same login-event logging. Because the exchange request is same-origin from the WebView, the cookie persists.

Two cross-cutting additions:
- **Silent re-auth** (client, native-only): transparently re-establishes the session so login feels permanent.
- **`assertMemberActive`** (server, Node-side): per-request kill switch that silent re-auth cannot bypass.

`proxy.ts` remains a pure JWT gate (Edge runtime). It is **not** the enforcement point for revocation.

## 5. Components & changes

### 5.1 Native (iOS + Android)
- Add `@capgo/capacitor-social-login`; `cap sync` + rebuild.
- **iOS:** add the reversed-client-ID URL scheme to `ios/App/App/Info.plist`.
- **Android:** add the web client ID to `strings.xml`; register the app's **SHA-1/SHA-256** signing fingerprints in the Android OAuth client.

### 5.2 Google Cloud Console (user prerequisite — see §10)
- Create **iOS**, **Android**, and **Web** OAuth client IDs (Android requires SHA fingerprints). The server verifies the ID token's `aud` against the full allowlist of these client IDs.

### 5.3 Web (sign-in page + native bootstrap)
- Detect `Capacitor.isNativePlatform()`. In-app, "Continuar con Google" → plugin → `idToken` → `signIn("google-native", { idToken, redirect: false })`. On web, the existing `signIn("google")` redirect is unchanged.
- Plugin/`@capacitor/core` JS is **dynamically imported / guarded** so the web build and SSR are unaffected.

### 5.4 Server — `google-native` Credentials provider (`auth.ts`)
- New provider whose `authorize({ idToken })`:
  1. Verifies the ID token with `google-auth-library` `OAuth2Client.verifyIdToken` — **`aud` ∈ our client-ID allowlist**, `iss` ∈ Google, `exp` valid, **`email_verified === true`**.
  2. Looks up the member via `getMemberByEmail` (reuse existing helper).
  3. Runs the **active-check** (`disabled !== true`); rejects otherwise.
  4. Returns `{ id, name, email, image, role, sanityId, alias }` — same shape as the email/password provider.
- Reuses the existing `jwt`/`session` callbacks and the `signIn` event (login logging) verbatim.

### 5.5 Session config (`auth.ts`)
- Keep `session.maxAge` at **7 days**, rolling (already the case in code — no change). Silent re-auth (§5.6), not a long session, is what makes login feel permanent; the short base session is also what bounds the disabled-member static-page leak to ≤7 days.

### 5.6 Silent re-auth (client, native-only)
- A native-only client component (mounted in the client layout) that, on **cold start** and on a detected **unauthenticated / 401** state, calls the plugin's silent restore → fresh `idToken` → `signIn("google-native", { redirect: false })` to re-establish the session.
- On silent-restore failure → fall back to the login screen (never a dead end).

### 5.7 Revocation — `disabled` flag + `assertMemberActive`
- Add `disabled: boolean` to `sanity/schemas/worshipTeam.ts` (absent/false = active).
- New Node-side helper `assertMemberActive(sanityId)`:
  - Reads the member's `disabled` flag via **`serverClient` (`useCdn:false`)**.
  - Backed by a **process-local ~30s TTL cache** keyed by `sanityId` (avoids a Sanity read on every request).
  - Throws / returns unauthorized when disabled or missing.
- **Call sites (required — see §7):** every `app/api/**` route's auth preamble, every dynamic server component that reads the session, both Credentials `authorize` paths, the `google-native` `authorize`, and at token refresh in the `jwt` callback.
- **Impersonation:** the check uses the **effective (impersonated) `sanityId`**, and also verifies the **real admin** is not disabled.

## 6. Data flow

1. **App cold start** → silent restore → if a valid member session is established, user is in.
2. **Manual login** → tap Google → native account sheet → `idToken`.
3. `signIn("google-native", { idToken })` → server verifies `aud`/`iss`/`exp`/`email_verified` → member lookup → `assertMemberActive` → cookie set (sticks in WebView, same-origin).
4. **Every protected request** → `proxy.ts` (JWT gate) → route/page runs `assertMemberActive` → allow/deny.
5. **Admin disables a member** → within ~30s (TTL), every dynamic/API surface rejects them; silent re-auth fails; remaining static-page read access ends when their token expires (≤7 days).

## 7. Security requirements (from verification, agent run 2026-06-16)

**Verdict:** near-instant revocation via the `disabled` flag is sound **with these conditions**:

1. `assertMemberActive` is enforced **Node-side**, never in `proxy.ts` (Edge). Middleware stays a JWT gate.
2. The check runs on **every** authenticated surface:
   - All `app/api/**` routes (add to the shared `getSessionMember()` / `requireManager()` preambles).
   - Every dynamic server component that reads the session (`me`, `me/propose`, `admin`, plus any session-reading page).
   - Both Credentials `authorize` paths and the new `google-native` `authorize`.
   - Token refresh in the `jwt` callback (it currently re-validates only on first sign-in).
3. **Hard gap to fix:** `app/api/practice-playlist/route.ts` currently reads **no session** (uses the public `client`). Add session + `assertMemberActive`.
4. **Static ISR pages** (`schedule`, home) cannot run a per-request check — accepted: bounded to ≤7-day token-expiry leak of read-only roster info (see §3). No code change; documented tradeoff.
5. `google-native` token verification: validate `aud` against the **full iOS+Android+web client-ID allowlist**, `iss`, `exp`, `email_verified`; reject otherwise. Verify against Google JWKS (handled by `google-auth-library`).
6. Use `serverClient` (`useCdn:false`) for the active-check so the flag is read live, never CDN-cached.
7. Retain NextAuth's default secure cookie flags (`httpOnly`, `Secure`, `SameSite`) — no custom cookie overrides.

## 8. Error handling
- Invalid/expired ID token or `aud` mismatch → 401; show error; offer email/password.
- Member not found or `disabled` → reject with a clear message.
- Native plugin failure → fall back to email/password (never a dead end).
- Silent re-auth failure → show the login screen.

## 9. Testing
- **Unit:** ID-token verification (valid / expired / wrong-`aud` / unverified-email); `assertMemberActive` (active / disabled / missing / cache-expiry); `google-native` `authorize`.
- **Manual (device):**
  - Fresh Google login on iOS (native account sheet → logged in, lands on home).
  - Silent re-auth after clearing the session (no login screen shown).
  - **Disable a member → confirm lockout from APIs / `/me` / `/admin` within ~30s**, and that they cannot log back in.
  - Web Google login unchanged.

## 10. Prerequisites (user actions)
- **Google Cloud Console:** create iOS, Android, and Web OAuth client IDs; for Android, register the signing SHA-1/256 fingerprints. (Exact click-path provided in the implementation plan.)
- Decide the production bundle IDs are final (`com.owtBackstage.app`) — already set.

## 11. To verify during planning
- `@capgo/capacitor-social-login` exact **silent-restore** API and Capacitor 8 compatibility (fallback: one-tap re-login).
- Whether the ID-token `aud` to allow is the **web** client ID, the per-platform client IDs, or both (provider/plugin-specific).
- Confirm Next.js 16 dynamic-rendering behavior for session-reading pages (cookie read forces dynamic) so the active-check placement is correct.
