# Design: In-app text-size accessibility control

**Date:** 2026-06-16
**Status:** Approved (design) — pending implementation plan
**Topic:** Let users enlarge the app's text — following the device's accessibility setting by default, with an in-app override.

---

## 1. Problem & context

The app (a Capacitor wrap loading the deployed Next.js site) does not currently respond to the device's font-size accessibility setting: iOS Dynamic Type / Android font scale apply to native UI, not to web content in a WebView. The app's own text is split between **499** scalable rem-based Tailwind sizes and **204** hardcoded pixel sizes (`text-[10px]` ×125, `text-[9px]` ×68, `text-[11px]` ×8, `text-[8px]` ×3) that never scale, and there is no root anchor driving the rem sizes. Net: the device setting has no effect, and the app's own sizing can't be enlarged.

Goal: a reliable way for users to make text bigger, that **follows the device setting by default** and can be **overridden in-app**.

## 2. Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Trigger | **Both** — follow the OS setting by default, allow an in-app override. |
| Granularity | **Discrete presets** (not a continuous slider). |
| Engine | **`@capacitor/text-zoom`** — a WebView text zoom that scales text only (not layout), proportionally, regardless of CSS unit (so the 204 px sizes scale too). No px→rem migration. |
| Options | **Automático** (default, follows device) · **Normal** 1.0 · **Grande** 1.2 · **Más grande** 1.4 · **Máximo** 1.6 |
| Persistence | Device-local (`localStorage`), NOT synced to the Sanity account (a display preference is per-device). |
| Control location | `/me`, under an "Accesibilidad" section. |

## 3. Model

The five options collapse to two behaviors:
- **`auto`** (default): on each app launch, read the device's preferred size via `TextZoom.getPreferred()` and apply it — so changing the iOS/Android setting is reflected.
- **A fixed preset** (`1.0` / `1.2` / `1.4` / `1.6`): apply that exact zoom, ignoring the OS setting (override wins).

`@capacitor/text-zoom` API used: `getPreferred(): Promise<{ value: number }>` (OS-preferred zoom, 1.0 = 100%), `set({ value }): Promise<void>` (apply), `get(): Promise<{ value }>` (current). Exact return shapes to be confirmed against the installed version during planning.

## 4. Components

- **`app/utils/textZoom.ts`** — engine wrapper, one responsibility:
  - `PRESETS`: ordered list mapping mode → value, e.g. `[{ mode: "auto" }, { mode: "1.0", value: 1.0 }, { mode: "1.2", value: 1.2 }, { mode: "1.4", value: 1.4 }, { mode: "1.6", value: 1.6 }]`.
  - `getStoredMode()` / `setStoredMode(mode)` — `localStorage` key `owt-text-scale`; invalid/missing → `"auto"`.
  - `applyScale(mode)` — **lazy-imports** the plugin (kept out of the SSR/web bundle). On native: `auto` → `getPreferred()` then `set()`; fixed → `set({ value })`. On web (no native plugin): resolve the value (`auto` → 1.0; fixed → its preset value) and apply best-effort `document.documentElement.style.setProperty("-webkit-text-size-adjust", value*100 + "%")`. Never throws (errors → fall back to 1.0 / CSS, log to console).
  - `nearestPreset(value)` — helper to map a raw `getPreferred()` value to the closest fixed preset (used by the control to highlight what "Automático" currently resolves to).
- **`app/components/TextScaleBootstrap.tsx`** — `"use client"` component mounted in `app/(client)/layout.tsx` next to `NativeAuthBootstrap`. On mount, `applyScale(getStoredMode())`. Renders `null`.
- **`app/components/TextSizeControl.tsx`** — `"use client"` segmented control listing the five options; on change → `setStoredMode(mode)` + `applyScale(mode)`, applied immediately (no reload). Includes a short live preview line so the effect is visible while choosing. Placed in `/me`.

## 5. Data flow

1. App load → `TextScaleBootstrap` reads stored mode (default `auto`) → `applyScale`.
2. `auto` + native → `getPreferred()` → `set()` (follows OS). `auto` + web → 1.0 + CSS best-effort.
3. User opens `/me` → picks an option → persisted + applied immediately.
4. Next launch → stored choice wins; if `auto`, the OS value is re-read.

## 6. Container spot-fixes (targeted — NOT the full 204)

At **Máximo (1.6)**, audit only the tight fixed-size text containers — avatar/initials badges (`w-9 h-9`, `w-5 h-5`) and the smallest micro-labels (`text-[8px]`/`text-[9px]`) — on the key screens (home DayCards, `SongSheet`, `Navbar`/`NavMenu`, `/me`). Let them grow / wrap / truncate gracefully. Fix what visibly breaks; do not convert every occurrence (that is explicitly out of scope).

## 7. Error handling

- Plugin missing or import fails (web, or load error) → CSS `text-size-adjust` fallback; never throw.
- `getPreferred()` throws → default to 1.0.
- Invalid stored value → reset to `auto`.

## 8. Testing

- **Unit (Vitest, plugin mocked):** `getStoredMode`/`setStoredMode` round-trip + invalid-value reset; `nearestPreset` mapping; `applyScale` calls `set` with the right value per mode and calls `getPreferred` only for `auto`.
- **Manual (device):** with **Automático**, change iOS Dynamic Type → app text follows. Pick **Máximo** → text enlarges, persists across a force-quit/relaunch, and OS changes no longer affect it. Verify **Máximo** does not break the home cards, `SongSheet`, nav, or `/me`.

## 9. Scope boundaries

- **In:** `@capacitor/text-zoom` engine, the 5 options, the `/me` control, persistence, OS-seed/follow, targeted container spot-fixes, unit tests.
- **Out:** full px→rem migration; per-account/cross-device sync (preference is device-local by design); a continuous slider; pixel-perfect web parity (the app is the target; web is best-effort via `text-size-adjust`).

## 10. Native / deployment notes

- `npm i @capacitor/text-zoom` + `npx cap sync` (native projects updated). Applying the new plugin needs an **Xcode/Android rebuild** (native code). The web/control code deploys via Vercel as usual.
- **Verify in planning:** `@capacitor/text-zoom` Capacitor 8 compatibility, and the exact `getPreferred()` / `set()` / `get()` signatures and return shapes.
