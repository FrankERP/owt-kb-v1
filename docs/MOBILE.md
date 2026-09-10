# Mobile apps (iOS + Android) — setup & handoff

This repo ships native iOS/Android apps via **Capacitor**, wrapping the existing Next.js app.
Full strategy: `~/.claude/plans/merry-cuddling-crayon.md`. This doc is the operational runbook.

> **Approach:** Capacitor wrap, one codebase — NOT a React Native rewrite.
> **Phase 1 (now):** online-only wrap → TestFlight / Play internal testing.
> **Phase 2:** offline bundled SPA + bearer-token auth.
> **Phase 3:** push notifications, native camera, add-to-calendar.

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
2. **`appId`** → `com.owtBackstage.app`, **`appName`** → `OWT Backstage` (⚠️ permanent once published).

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
   auth pages, the cron routes, the A3 identity route and the theme gallery (ADR-0017).
   The bundled client must authenticate with a **bearer token**, not a cross-origin cookie —
   add a token endpoint and store it via Capacitor Secure Storage.
6. In `capacitor.config.ts`: remove the `server` block, set `webDir: "out"`, `npx cap sync`.

## Phase 3 — native features

- **Push:** `@capacitor/push-notifications` + FCM/APNs; hook the existing `revalidate*()` calls in
  `app/api/admin/setlists/route.ts` and `app/api/admin/roles/*` to also notify affected members.
- **Camera:** `@capacitor/camera` → POST to the existing `app/api/me/photo/route.ts` (unchanged).
- **Calendar:** a calendar plugin fed by `app/utils/ics.ts` / `AddToCalendarButton.tsx`.

---

## Native plugins in use

| Plugin | Used by | Web behaviour |
|---|---|---|
| `@capacitor/text-zoom` | `app/utils/textZoom.ts` | falls back to a CSS scale |
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
