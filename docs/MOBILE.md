# Mobile apps (iOS + Android) — setup & handoff

This repo ships native iOS/Android apps via **Capacitor**, wrapping the existing Next.js app.
Full strategy: `~/.claude/plans/merry-cuddling-crayon.md`. This doc is the operational runbook.

> **Approach (2026-11-20):** native apps — SwiftUI for iPhone, iPad and Mac, Kotlin/Compose for
> Android — over a server API (`/api/app/v1/*`), with the whole app, admin included, in v1. They
> replace the Capacitor phases below; the Capacitor wrap stays as it is until the native apps reach
> parity. Plan: Frank's «apps nativas» doc; sign-in: [ADR-0091](adr/0091-native-apps-sign-in-through-their-own-first-party-oauth-door.md).
>
> **Superseded plan (kept for the wrap):** Capacitor wrap, one codebase. Phase 1: online-only wrap →
> TestFlight / Play internal testing. Phase 2: offline bundled SPA + bearer-token auth. Phase 3:
> push notifications, native camera, add-to-calendar.

---

## Native apps — sign-in (Fase 0, slice A1; ADR-0091)

**What exists on the server.** A first-party OAuth 2.0 authorization-code + PKCE door for two public
clients, `backstage-ios` (iPhone, iPad, Mac) and `backstage-android`:

| Step | Route | Notes |
| --- | --- | --- |
| Confirm | `GET /app/authorize` (session page) | `response_type=code`, `client_id`, `redirect_uri`, `code_challenge` (S256), `state` (16–256 visible ASCII). No `scope`, no `resource`. Shows «Entrar a la app» / «Cancelar». |
| Tap | `POST /app/authorize/submit` | Same-origin only; 303 to the redirect with `code`, `state`, `iss` (or `error=access_denied`). |
| Exchange / refresh | `POST /api/app/v1/auth/token` | Form body. `authorization_code` (code, redirect_uri, client_id, code_verifier) or `refresh_token` (refresh_token, client_id). Answers `access_token` (1 h), `refresh_token` (90 d, rotates on every use), `expires_in`. |
| Sign out | `POST /api/app/v1/auth/revoke` | Form `token` (the refresh token) + `client_id`. 200 always, 503 only if the revocation write failed. |
| Who am I | `GET /api/app/v1/me` | `Authorization: Bearer <access_token>`. |

**Redirects.** Production and preview: only `<origin>/app/callback/ios` and
`<origin>/app/callback/android` (verified `https`; until the association files exist they land on an
inert page «Abre la app Backstage para terminar de entrar»). Local `next dev` only:
`app.vercel.owt-backstage:/oauth/callback/{ios,android}`.

**Answers the apps must handle.** `401 invalid_token` → refresh, then sign in again;
`401 account_disabled` (or `invalid_grant` with `error_description: account_disabled` from the token
route) → sign out and show «Tu acceso está desactivado»; `403` → the person lacks the level; `503`
(`temporarily_unavailable`, with `Retry-After`) → keep the tokens and retry later, never sign out
(a refresh 503 follows the single-flight rule below).
A refresh `invalid_grant` means the grant is gone (revoked, reused, 90 days): sign in again.

**Requirements recorded for the native slices** (spec §10 A10, D3, A15):

- iOS: `ASWebAuthenticationSession` with an `https` callback (iOS/iPadOS 17.4+, macOS 14.4+),
  `prefersEphemeralWebBrowserSession`; the `apple-app-site-association` lists the app under BOTH
  `webcredentials` and `applinks`. iPhone XS/XR or newer.
- Android: Auth Tab with a verified `https` redirect (Chrome 137+; launch it in the Chrome package
  explicitly), an `autoVerify` App Link for `/app/callback/android`, minSdk 31 (Android 12). The
  server refuses Android 11 and older at sign-in. No Chrome Auth Tab → «Para entrar necesitas Chrome
  actualizado». Testing on a phone can use the debug or upload key's fingerprint in `assetlinks.json`;
  a Google Play organization account may itself need the D-U-N-S number.
- Both: ignore any callback without a matching pending `state` and verifier; never retry the token
  POST automatically (OkHttp `retryOnConnectionFailure` off for that call; URLSession without
  automatic retry) — a silent retry of a refresh is a reuse, and a reuse revokes the session.
- Both: **refreshes are single-flight** across the app and everything sharing its keychain or
  storage (widgets, extensions): one refresh at a time, and every caller waits for it and reads the
  tokens it stored. After a refresh answers 503, first re-read the stored refresh token: if another
  flight already replaced it, use the new one. `503` with `error_description: refresh_in_progress`
  (no `Retry-After`) means a concurrent refresh of the SAME token won: never resend that token —
  re-read storage. Any other refresh 503 may be retried with the same token after `Retry-After`; if
  the earlier attempt had in fact committed, that retry is a reuse and the person signs in again
  (one tap), which is the worst case.

**Developing against local.** The dev deployment is behind Vercel SSO, which an app cannot pass.
Run `next dev` with `APP_AUTH_SECRET` in `.env.local`; the iOS Simulator reaches it as `localhost`,
the Android emulator after `adb reverse tcp:3000 tcp:3000` (its `10.0.2.2` host is refused by
design). Physical phones sign in only against production through the verified redirect.

**Release smoke test** (after the production release, spec §10 A11). One flow by hand: open
`/app/authorize?...` with `redirect_uri=<origin>/app/callback/ios` and a known verifier, tap
«Entrar», copy `code` from the callback page's URL, then with `curl`: exchange the code, `GET
/api/app/v1/me` with the access token, refresh once, present the FIRST refresh token again (must
answer `invalid_grant` and revoke the grant: the second refresh token must now fail too), and call
the revoke endpoint. Check «Apps conectadas» in `/me/ajustes` along the way.

**Closing sessions.** The person: `/me/ajustes` → «Apps conectadas» → «Cerrar sesión en ese
dispositivo». A super-admin, for a lost phone: «Personas» → ⋯ → «Cerrar sesiones de la app».
Disabling a member's access refuses their app within 30 s (the server's live-access cache); no extra step. A revocation takes effect within the same 30 s.

---

## Prerequisites (install on your Mac)

The JavaScript side (`@capacitor/*`) is already installed. To generate/build/sign the native apps
you must install these locally — they can't be set up from the repo:

| Tool | How | Needed for |
|---|---|---|
| **Node 22 LTS** | already set (`nvm use` reads `.nvmrc`) | everything (Capacitor 8 requires Node ≥22) |
| **Xcode** (full) | Mac App Store (~7 GB) | iOS build/sign/run |
| **Xcode CLT** | `xcode-select --install` | iOS tooling |
| **Android Studio** | https://developer.android.com/studio | Android SDK + build/run |
| **JDK 17** | `brew install --cask temurin@17` | Android (Gradle) |

After Android Studio: open it once, install the SDK, and ensure `ANDROID_HOME` is exported in
`~/.zshrc` (e.g. `export ANDROID_HOME="$HOME/Library/Android/sdk"`).

## Store accounts

- **Apple Developer Program** — $99/year — https://developer.apple.com/programs/
- **Google Play Console** — $25 one-time — https://play.google.com/console/

---

## Before the first build — `capacitor.config.ts` (done)

Both required values are now set:
1. **`server.url`** → `https://owt-backstage.vercel.app`.
2. **`appId`** → `com.owtBackstage.app`, **`appName`** → `Backstage` (renamed from `OWT Backstage` 2026-11-10, before any store release; ⚠️ the `appId` is what is permanent once published — the display name can change in a later release).

Still pending: set **Vercel → Settings → Node.js Version → 22** so prod matches local (`.nvmrc`).

---

## Phase 1 — generate native projects & run (online wrap)

> **Status:** `ios/` and `android/` are generated and **committed** to the repo.
> Remaining local setup: Xcode (iOS plugins resolve through Swift Package Manager — there is no Podfile) and JDK 17 + Android Studio (Android).

```bash
nvm use                  # Node 22 from .nvmrc
# npx cap add ios        # already done — ios/ is committed
# npx cap add android    # already done — android/ is committed
npx cap sync             # copies config + fallback webDir into native projects (run on each machine)

npx cap open ios         # opens Xcode → pick your Team, set signing, Run on a device/simulator
npx cap open android     # opens Android Studio → Run
```

In Xcode: select the project target → Signing & Capabilities → check "Automatically manage
signing" → select your Apple Developer team.

### Ship to testers
- **iOS:** Xcode → Product → Archive → Distribute → TestFlight.
- **Android:** Android Studio → Build → Generate Signed Bundle (`.aab`) → upload to Play Console →
  Internal testing track.

> Phase 1 requires a network connection (it loads `server.url`). Offline comes in Phase 2.

---

## Phase 2 — offline bundle (summary)

1. Restructure into pnpm workspaces: `apps/web` (current app = website + API + Studio),
   `apps/mobile` (static export), `packages/shared` (components + medley/ICS/lyrics/search logic).
2. Convert the 8 server-fetching pages to client-side fetching via the existing `/api` routes.
3. Remove static-export blockers: swap the 7 `next/image` usages (use `@sanity/image-url`),
   set `output: 'export'` on the mobile build.
4. Add an offline cache (IndexedDB, stale-while-revalidate) in `packages/shared`.
5. **Auth migration (mandatory):** the app is gated by `proxy.ts` (next-auth `withAuth`) apart from a small public allow-list —
   auth pages, the cron routes, the A3 identity route, the theme gallery (ADR-0017), and the
   ungated MCP/OAuth routes ([MCP.md](MCP.md) lists what enforces each).
   The bundled client must authenticate with a **bearer token**, not a cross-origin cookie —
   add a token endpoint and store it via Capacitor Secure Storage.
6. In `capacitor.config.ts`: remove the `server` block, set `webDir: "out"`, `npx cap sync`.

## Phase 3 — native features

- **Push:** `@capacitor/push-notifications` + FCM/APNs; hook the existing `revalidate*()` calls in
  `app/api/admin/setlists/route.ts` and `app/api/admin/roles/*` to also notify affected members.
- **Camera:** `@capacitor/camera` → POST to the existing `app/api/me/photo/route.ts` (unchanged).
- **Calendar:** a calendar plugin fed by `app/utils/ics.ts` / `icsDownload.ts` (`DownloadCalendarRow`).

---

## Native plugins in use

| Plugin | Used by | Web behaviour |
|---|---|---|
| `@capacitor/text-zoom` | `app/utils/textZoom.ts` | **same mechanism as native.** The iOS plugin bridges only `getPreferred`; `set` falls through to the package's own JS, which assigns `document.body.style.webkitTextSizeAdjust`. So both platforms end at one CSS property — the web path writes it on `documentElement` instead of `body`, which inherits the same. Layout must therefore survive TEXT growing while px/rem boxes do not: see `app/utils/__tests__/textZoomLayout.test.ts`. |
| `@capgo/capacitor-social-login` | `app/utils/native.ts` | not loaded |
| `@capacitor/haptics` | `app/utils/haptics.ts` — `haptic("light")` on a toggle flip or a segmented thumb move, `haptic("selection")` on a tab press (spec decision D) | no-op: `isNativeApp()` is false, the module is never imported |

### Adding a plugin

1. `npm install <plugin>` — the dependency goes in `package.json` like any other.
2. `npx cap sync ios` — regenerates `ios/App/CapApp-SPM/Package.swift` (managed by the
   CLI, never hand-edited) so Xcode resolves the plugin's Swift package from
   `node_modules`. Commit the regenerated file: `ios/` is committed on purpose.
3. Import the plugin LAZILY behind `isNativeApp()` (`app/utils/native.ts` is the
   pattern) so the web bundle and SSR never see it.
4. A new native plugin means a new iOS build before the team's installed app has it;
   until then the util must degrade silently — `haptic()` swallows the failure.

## Safe area and the tab bar

`BottomNav` (phone-only, `lg:hidden`) carries the bottom safe-area inset itself
(`env(safe-area-inset-bottom)` padding inside the bar) and publishes its own
MEASURED height as `--bottom-nav-h` on `<html>`, plus a `has-bottom-nav` class,
while it is on screen. Fixed-bottom elements must clear either the inset (when
the bar is absent) or the bar's own height (which already includes the inset) when
it is present. Elements that must also clear the inset when the bar is absent use
`max(env(safe-area-inset-bottom), var(--bottom-nav-h, 0px))` (toasts); elements
that sit flush on the bar use `var(--bottom-nav-h, 0px)` alone (the audio
transport, whose own inset padding is zeroed under `html.has-bottom-nav`; the
song FAB). `bottomNavOffsetSync.test.ts` is the guard; a new fixed-bottom element
joins its list.

## Notes

- `ios/` and `android/` are generated by `cap add` and **are committed** (Capacitor's recommendation,
  for reproducible signing). Build artifacts (`Pods/`, `build/`, `.gradle/`, `DerivedData`, copied web
  assets, generated `capacitor.config.json`) are excluded by the native dirs' own `.gitignore` files
  and are regenerated by `npx cap sync` on each machine.
- Capacitor 8 needs Node ≥22 — the repo is pinned via `.nvmrc` and `engines.node`.
  The pin is an *exact* `22.x` for a separate Vercel reason: [ADR-0002](adr/0002-node-pinned-to-exact-22x.md).
- Optional later upgrade path: Node already current; staying on Capacitor 8.
