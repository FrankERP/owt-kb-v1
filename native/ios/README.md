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

## Rules the code keeps (MOBILE.md)

- A callback is redeemed only with the pending `state` AND the server's `iss`.
- A refresh token is never sent twice: one refresh at a time (`SessionAuthority`), no automatic
  retry of a token POST, and after a `503` the stored tokens are re-read before giving up.
- `401 account_disabled` / `invalid_grant account_disabled` → signed out with «Tu acceso está
  desactivado»; any `503` keeps the session.
