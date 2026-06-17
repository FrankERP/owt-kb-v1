# Design: Push notifications (FCM)

**Date:** 2026-06-16
**Status:** Approved (design) — pending implementation plan
**Topic:** Native push notifications for the Capacitor app via Firebase Cloud Messaging, with four event triggers, per-category member preferences, and fully automatic token lifecycle.

---

## 1. Problem & context

The Capacitor app (Phase 3 of the mobile plan) has no push notifications. The team needs to be alerted about scheduling and setlist activity without opening the app. Firebase project `owt-knowledge-base` already exists (client SDK configured but unused), with a `messagingSenderId` — so FCM is available. The app already has an in-app notification badge (counting `setlistProposal` docs) and `revalidate*()` hooks in the setlist mutation route; push extends this to native delivery.

## 2. Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Backend | **FCM** via existing Firebase project `owt-knowledge-base`; server sends with **`firebase-admin`**. |
| Client plugin | **`@capacitor-firebase/messaging`** (FCM token on both platforms). |
| Events | All four: assigned-to-serve, weekly-setlist-published, proposal-workflow, service-reminders. |
| Preferences | **Per-category**, stored on the member. `setlist` is tri-state; the rest boolean. |
| Token lifecycle | **Automatic** — re-register on launch + refresh; self-heal dead tokens on send. No manual management. |
| Platforms | iOS configured now; Android config later (not built yet). |
| Reminders trigger | **Vercel Cron** → a secured daily API route. |

## 3. Data model (`teamMembers` schema additions)

- **`deviceTokens`** — `array` of `{ token: string, platform: "ios" | "android", updatedAt: datetime }`. Hidden. Deduped by `token` value.
- **`notifPrefs`** — object, default all-on:
  ```ts
  {
    assignments: boolean,                    // default true
    setlist: "all" | "assigned" | "off",     // default "all"
    proposals: boolean,                      // default true
    reminders: boolean,                      // default true
  }
  ```
  A member with no `notifPrefs` set is treated as all-defaults (opted in).

## 4. Client (native-only)

- **`PushRegistrar`** — a `"use client"` component mounted in `app/(client)/layout.tsx` (next to `NativeAuthBootstrap`). On an authenticated session AND when OS permission is `granted`: get the FCM token via `@capacitor-firebase/messaging` and `POST /api/me/push-token`. Subscribes to:
  - `tokenReceived` (token refresh) → re-`POST` the new token.
  - `notificationActionPerformed` (user taps a notification) → navigate to the payload's `path` (deep link, e.g. `/schedule`, `/me`).
  - No-op entirely on web (`isNativeApp()` false).
- **Permission + preferences UI on `/me`** ("Notificaciones" section):
  - A **master toggle**: enabling it requests OS permission (prompt-on-intent) and triggers registration; disabling it `DELETE`s the device's token.
  - **Per-category controls** (persist to `notifPrefs` via `PATCH /api/me`):
    - Asignaciones — toggle
    - Setlists — 3-way: **Todos** (`all`) / **Solo donde sirvo** (`assigned`) / **No** (`off`)
    - Propuestas — toggle
    - Recordatorios — toggle

## 5. Server

### 5.1 Token API — `app/api/me/push-token/route.ts`
- `POST { token, platform }` — upsert into the current member's `deviceTokens` (dedup by `token`, set `updatedAt`). Guarded by `requireActiveSession`.
- `DELETE { token }` — remove that token (sign-out / master toggle off).

### 5.2 Send helper — `app/utils/push.ts` → `sendPush(memberIds, category, payload)`
1. Load the members' `deviceTokens` + `notifPrefs`.
2. **Preference filter:** drop members opted out of `category` (`assignments`/`proposals`/`reminders` → boolean false; `setlist` → `"off"`). For `setlist`, the *caller* has already resolved the correct recipient set (see §6), so here `setlist` just excludes `"off"`.
3. Send via `firebase-admin` `messaging().sendEachForMulticast({ tokens, notification, data })`.
4. **Self-heal:** for each per-token error with code `messaging/registration-token-not-registered` or `messaging/invalid-argument`, remove that token from its member doc.
5. Returns `{ sent, pruned }`. **Never throws** — callers wrap defensively, but the helper swallows/log its own errors so a push failure can never break a mutation.
- `firebase-admin` is initialised once (module singleton) from a `FIREBASE_SERVICE_ACCOUNT` env var (service-account JSON for project `owt-knowledge-base`).

## 6. Event triggers

Each trigger calls `sendPush` inside a try/catch (or fire-and-forget) so a push failure never fails the underlying write.

- **Assigned to serve** — in the role/assignment mutation routes (`app/api/admin/roles/route.ts`, `app/api/admin/roles/[id]/route.ts`, plus `special_role` / setlist Lead+instrument writes): **diff** the new assignee set against the prior one; call `sendPush(newlyAddedIds, "assignments", …)` for **only the added** members (no re-notify on unrelated edits).
- **Weekly setlist published** — in `app/api/admin/setlists/route.ts` after a successful publish: resolve recipients =
  - members with `notifPrefs.setlist == "all"`, **unioned with**
  - members with `notifPrefs.setlist == "assigned"` **who are assigned** to that service.
  Then `sendPush(recipientIds, "setlist", …)`.
- **Proposal workflow** — in the proposal mutation routes (`app/api/admin/proposals/*`, `app/api/me/proposals/*`): on submit → notify admins; on `changes_requested` / approved → notify the proposal's lead. Mirrors the existing in-app badge logic in `app/api/notifications/count/route.ts`.
- **Service reminders** — `app/api/cron/service-reminders/route.ts` (GET, authorised by a `CRON_SECRET` header/query), invoked daily by **Vercel Cron** (`vercel.json` `crons` entry). It finds services occurring "tomorrow" (Mexico City TZ, matching the app's date logic) and calls `sendPush(<assigned members>, "reminders", …)`.

All notification payloads include a `path` for deep-link navigation on tap.

## 7. Native config (one-time, manual)

- Register the **iOS app** in Firebase `owt-knowledge-base`; download `GoogleService-Info.plist` → `ios/App/App/`.
- In Xcode: enable **Push Notifications** capability + **Background Modes → Remote notifications**.
- Create an **APNs auth key** (.p8) in the Apple Developer account and upload it to Firebase (Cloud Messaging settings).
- Install `@capacitor-firebase/messaging` + `firebase-admin`; `npx cap sync`.
- Add env var `FIREBASE_SERVICE_ACCOUNT` (service-account JSON) to Vercel + `.env.local`.
- Android (`google-services.json`, FCM) deferred until Android is built.

## 8. Token lifecycle (automatic)

- **Always fresh:** `PushRegistrar` re-registers on every authenticated launch and on every `tokenReceived` refresh.
- **Self-healing:** `sendPush` removes any token FCM reports as unregistered/invalid (uninstall, expiry).
- **Deduped** by token value, with `updatedAt`. No manual cleanup or cron needed for tokens.

## 9. Error handling

- Permission denied → no token stored; master toggle reflects the denied state; everything else degrades gracefully.
- Send/network errors → logged; **non-fatal** to the triggering mutation.
- Assignment diff guarantees **idempotent, added-only** notifications (editing an unrelated field of a role doc does not re-notify).
- Cron route rejects requests without the correct `CRON_SECRET`.

## 10. Testing

- **Unit (Vitest, `firebase-admin` mocked):**
  - `sendPush` — category preference filtering (incl. `setlist` `"off"`) and dead-token pruning on the mocked multicast response.
  - assignment diff — notifies only newly-added members, not pre-existing ones.
  - setlist recipient resolution — `"all"` members ∪ (`"assigned"` members ∩ assigned-to-service).
  - cron service-selection query — selects tomorrow's services in the right TZ.
- **Manual (device):** enable in `/me` → permission prompt → token stored; assign self to a service → receive a push; publish a setlist → receive (and verify `assigned`-scope members only get theirs); tap → deep link; toggle a category off → silenced; uninstall the app, trigger a send → token auto-pruned.

## 11. Build order (one feature, staged in the plan)

1. **Foundation:** schema (`deviceTokens`, `notifPrefs`), token API, `firebase-admin` + `sendPush`, native config, `PushRegistrar` — prove **one** trigger (assigned-to-serve) end-to-end on device.
2. Remaining triggers: setlist (tri-state), proposals.
3. Reminder cron + `vercel.json`.
4. `/me` "Notificaciones" preferences UI (master toggle + per-category, incl. the setlist 3-way).

## 12. Scope boundaries

- **In:** the 4 triggers, per-category prefs (setlist tri-state), automatic token lifecycle, deep-link taps, iOS config, unit tests.
- **Out (now):** Android *build*; rich notifications (images/action buttons); redesigning the in-app notification center (the existing badge stays as-is); cross-device preference nuance (prefs are per-member, tokens per-device).
- **Verify in planning:** `@capacitor-firebase/messaging` Capacitor 8 compatibility; APNs auth-key vs certificate; exact `firebase-admin` `sendEachForMulticast` response shape and error codes; Vercel Cron config syntax.
