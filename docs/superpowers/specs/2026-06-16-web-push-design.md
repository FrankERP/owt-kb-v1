# Design: Web push notifications (FCM, browser)

**Date:** 2026-06-16
**Status:** Approved (design) — pending implementation plan
**Topic:** Browser push notifications via FCM web, reusing the existing push backend — lighting up the dormant server slice for desktop/Android-browser users with no Apple involvement.

---

## 1. Problem & context

The push-notifications **server slice** is on `main` but dormant: `sendPush(memberIds, category, payload)`, the four event triggers, the cron, the `notifPrefs` model, and the `POST/DELETE /api/me/push-token` endpoint all exist, but **no client registers a token**, so nothing sends. The native iOS client is blocked on an Apple Developer account (~1 week).

Web push needs none of that. The Firebase project `owt-knowledge-base` already supports FCM; the `firebase@11` client SDK (with `firebase/messaging` + the SW build) is installed; the token API already accepts a `platform` field; and `sendPush` is token-platform-agnostic. So a thin browser layer makes the whole backend **live and end-to-end testable today**, and delivers real notifications to anyone using the site in a supporting browser.

## 2. Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Approach | **Reuse the backend** — **no changes to the send pipeline** (`sendPush`, triggers, cron, token API); the only server edit is accepting `notifPrefs` in the existing `/api/me` PATCH. Add a thin web layer. |
| Foreground (app open) | **In-app toast** (branded card, tappable → deep-link path). |
| Background (closed/hidden) | **System notification** via the service worker (standard FCM); click → open the path. |
| Settings | Build the `/me` **Notification settings** UI now (web master toggle + per-category, setlist tri-state). |
| Manual setup | Generate a **VAPID key** (Web Push certificate) in Firebase — free, instant, non-Apple. |

## 3. Scope note: where web push runs

Web push works in **desktop browsers and Android Chrome** (and iOS Safari **only** as an installed PWA, 16.4+). It does **not** work inside the Capacitor iOS WKWebView — that's the native path (deferred). This is exactly the goal: validate the pipeline + serve browser users without Apple.

## 4. Components

- **`firebaseConfig.ts`** — add a browser-only, lazily-`isSupported()`-guarded `getClientMessaging()` returning the FCM `Messaging` instance (reuses the existing `initializeApp`).
- **`public/firebase-messaging-sw.js`** — the service worker (served at `/firebase-messaging-sw.js`). Uses Firebase **compat** scripts (`importScripts`), `initializeApp(<public config>)`, `firebase.messaging()`, and a `notificationclick` handler that focuses an existing tab or `clients.openWindow(<data.path>)`. (The public Firebase config is duplicated here — it's not secret; SWs can't read env.)
- **`app/utils/webPush.ts`** — the web client logic, one responsibility each:
  - `isWebPushSupported()` — `"Notification" in window && "serviceWorker" in navigator` + FCM `isSupported()`.
  - `registerWebPush()` — register the SW, `Notification.requestPermission()`, `getToken({ vapidKey, serviceWorkerRegistration })`, then `POST /api/me/push-token { token, platform: "web" }`. Returns the permission result.
  - `unregisterWebPush(token)` — `DELETE /api/me/push-token`.
  - `listenForeground(cb)` — `onMessage(messaging, cb)` for foreground toasts; returns an unsubscribe.
- **`app/components/WebPushManager.tsx`** — `"use client"`, mounted in `app/(client)/layout.tsx`. On an authenticated session, in a supporting browser, when permission is already `"granted"`: silently re-register (refresh the token) and `listenForeground` → render an **in-app toast**. Renders nothing when permission isn't granted / unsupported. Owns the toast UI (or composes a small `Toast`).
- **`app/components/NotificationSettings.tsx`** — the `/me` "Notificaciones" section: a master **"Activar notificaciones"** button (calls `registerWebPush()`, reflects permission state incl. "blocked"), and the per-category controls (`assignments` toggle, `setlist` 3-way Todos/Donde sirvo/No, `proposals`, `reminders`) persisting to `notifPrefs` via `PATCH /api/me`.
- **`app/api/me/route.ts`** — accept `notifPrefs` in the PATCH body (the one tiny server edit, shared with the future native client).

## 5. Data flow

1. User visits `/me` → **Activar notificaciones** → browser permission prompt → on grant, SW registered + web token `POST`ed to `/api/me/push-token` (`platform: "web"`), stored in the member's `deviceTokens`.
2. A trigger fires (assignment/setlist/proposal/cron) → existing `sendPush` → FCM → the member's web token(s).
3. **App open:** `onMessage` → `WebPushManager` shows the in-app toast (tap → `data.path`).
4. **App closed/hidden:** the SW shows a system notification; click → focus/open `data.path`.
5. Dead web tokens self-prune via the existing `sendPush` logic (unchanged).

## 6. Notification payload handling (verify in planning)

`sendPush` sends `{ notification: {title, body}, data: {path} }`. On web, an FCM message **with a `notification` field is auto-displayed** by the browser for background messages, and `onMessage` delivers it in foreground. The SW therefore only needs the `notificationclick` handler (deep-link), not its own `showNotification`. **Planning must verify** there's no double-display (auto + a manual `showNotification`); if any browser double-displays, the fallback is to add `title`/`body` to `sendPush`'s `data` and send web tokens **data-only** (a small, isolated `sendPush` tweak) — but default to the no-backend-change path.

## 7. Error handling

- Permission denied/blocked → no token; the settings button reflects "blocked"; everything else degrades gracefully.
- Unsupported browser → `WebPushManager`/settings hide the enable control; category toggles still editable.
- `getToken`/registration failure → logged, non-fatal.
- Token send failure → logged; the backend's self-healing prune handles dead tokens on the next send.

## 8. Testing

- **Unit (Vitest, mocked):** `isWebPushSupported` branches; `registerWebPush` calls `getToken` with the VAPID key + `POST`s `platform: "web"`; `unregisterWebPush` `DELETE`s. (FCM + fetch mocked.)
- **Manual (browser — no Apple needed):** in desktop Chrome, `/me` → enable → grant → confirm a `web` token row appears on the member in Sanity. Assign yourself to a service / publish a setlist / submit a proposal → with the tab open, see the **toast**; with the tab closed, see the **system notification**; click it → lands on the deep-link path. Toggle a category off → silenced. This exercises the **entire** backend (sendPush, triggers, prefs, prune) end-to-end.

## 9. Scope boundaries

- **In:** Firebase web messaging init, the service worker, web token register/unregister (reusing the token API), foreground toast + background system notification + click deep-link, the `/me` settings UI, the `notifPrefs` PATCH, VAPID setup, unit tests.
- **Out:** the native iOS client (deferred — Apple-gated); changing `sendPush` / triggers / cron (reused as-is, save the optional data-only fallback in §6); rich notification actions/images; iOS-Safari-PWA-specific install prompts.
- **Verify in planning:** web `notification`-payload double-display (§6); exact `firebase/messaging` `getToken`/`onMessage` signatures in v11; the compat SW `importScripts` URLs/version.

## 10. Manual setup (user)

- Firebase console (`owt-knowledge-base`) → Project settings → Cloud Messaging → **Web Push certificates** → generate a key pair → copy the **public VAPID key**.
- Add `NEXT_PUBLIC_FIREBASE_VAPID_KEY=<key>` to Vercel (all envs) + `.env.local`. Redeploy (it's build-time).
- (No APNs, no service account beyond the existing `FIREBASE_SERVICE_ACCOUNT` already needed for `sendPush` — which must also be set for any send to actually go out.)
