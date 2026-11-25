# Backstage for iPhone and iPad (SwiftUI)

The native app over `/api/app/v1/*` (plan: Frank's «apps nativas» doc; sign-in:
[ADR-0091](../../docs/adr/0091-native-apps-sign-in-through-their-own-first-party-oauth-door.md),
runbook: [`docs/MOBILE.md`](../../docs/MOBILE.md)). iOS/iPadOS 17.4+ (iPhone XS/XR or newer).

## What is here

| Folder | What |
| --- | --- |
| `project.yml` | The XcodeGen spec. `Backstage.xcodeproj`, `Support/Info.plist` and the entitlements are **generated** and git-ignored. |
| `Backstage/App` | `BackstageApp`, `AppModel` (the one state: signed out / in), `AppConfig` (origin, client id, redirect). |
| `Backstage/Auth` | PKCE, the callback check (state + issuer), the token endpoint's answers, the Keychain store, and `SessionAuthority`: the one owner of the tokens, an actor so refreshes are single-flight. |
| `Backstage/API` | `APIClient` (bearer, one refresh on `401 invalid_token`) and the models. |
| `Backstage/Views` | The screens. |
| `BackstageTests` | Unit tests of everything above that is logic. |

## Build

On a Mac with Xcode 16+: `brew install xcodegen`, then `cd native/ios && xcodegen generate && open Backstage.xcodeproj`.
CI (`.github/workflows/ios.yml`) does the same on a GitHub macOS runner and runs the tests on a
Simulator, on every change under `native/ios/`.

- **Debug** talks to `http://localhost:3000` (`next dev` with `APP_AUTH_SECRET` in `.env.local`) and
  signs in through the private scheme `app.vercel.owt-backstage:` — the only origin where the
  server accepts it.
- **Release** (TestFlight, App Store) talks to production and signs in through the verified
  `https` callback `/app/callback/ios`, which needs the Team ID in the site's
  `apple-app-site-association` and the Associated Domains capability on the App ID.

The app icon (`Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png`, 1024×1024, opaque) is the
Backstage «B» mark, resized from `public/backstage-mark-v2.png`, the same mark as the web's icons.

## TestFlight

Actions → «iOS TestFlight» → Run workflow on `main` (`.github/workflows/ios-testflight.yml`,
`ExportOptions.plist`). Built with Xcode 27 on the `xcode-27` runner image (ITMS-90725: from April 2027 uploads need the iOS 27 SDK); the version is `MARKETING_VERSION` in `project.yml`, the
build number is `<run number>.<attempt>`. Before the first run:

1. The App ID `com.owtBackstage.app` is registered (Certificates, IDs & Profiles) with Associated Domains.
2. App Store Connect has the app record for that bundle id (Apps → + → New App, iOS).
3. The App Store Connect key (Admin) and an Apple Distribution certificate (`.p12`) are in the
   `testflight` environment ([`docs/SECRETS.md`](../../docs/SECRETS.md)). Without the certificate
   the run stops at «Install the Apple Distribution certificate» (Xcode's cloud signing, its
   fallback, was refused by App Store Connect).

First successful upload: run 4, 2026-11-25 (build 0.1.0 (4.1)). Runs 1–3 failed on signing: run 1
because App Store Connect refused Xcode's cloud signing; run 2 stopped at the identity check; run 3's `.p12` held an Apple
Development identity (the Distribution `.cer` sat in the System keychain, apart from its key).

Automatic signing archives with a development profile first; if the run says the team has no
devices, register one iPhone under Devices and run it again. Each fresh runner may create a new
development certificate: look at Certificates after the first runs and revoke the extras.

## Rules the code keeps (MOBILE.md)

- A callback is redeemed only with the pending `state` AND the server's `iss`.
- One refresh at a time (`SessionAuthority`), no automatic retry of a token POST. A refresh token
  the server says was superseded (`refresh_in_progress`) is never presented again: the app adopts a
  newer stored pair or ends the session. A plain `503` or a lost connection keeps the token for a
  later try (the server did not rotate it; if a lost response had in fact rotated it, that try is a
  reuse and the person signs in again, the documented worst case).
- A sign-out bumps a generation: a token answer still in flight is thrown away, never stored.
- `401 account_disabled` / `invalid_grant account_disabled` → signed out with «Tu acceso está
  desactivado». A `503` or no connection keeps the session and shows «intenta de nuevo»; a
  Keychain that cannot answer yet (before the first unlock) is «try again», never «signed out».
- If the Keychain refuses a new pair, the old one is cleared so it cannot become a reuse.

## Bundle id

`com.owtBackstage.app`, Team `2NM4872N5S`. The Capacitor wrap (`ios/`) reserved the same id but was
never published; this app takes it over, and the wrap must never be uploaded under it.
