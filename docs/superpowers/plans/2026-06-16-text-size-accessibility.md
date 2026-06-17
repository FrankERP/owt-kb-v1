# Text-Size Accessibility Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users enlarge the app's text via an in-app control that follows the device accessibility setting by default (Automático) and offers fixed overrides (Normal/Grande/Más grande/Máximo), using `@capacitor/text-zoom` so all text scales without a px→rem migration.

**Architecture:** A small engine wrapper (`textZoom.ts`) maps a stored mode to a zoom and applies it — on native via `@capacitor/text-zoom` (`getPreferred()` for Automático, `set()` for fixed), on web via best-effort `-webkit-text-size-adjust`. A client bootstrap applies the stored mode on app load; a segmented control on `/me` lets the user change it. The preference is device-local (`localStorage`).

**Tech Stack:** Next.js 16 (App Router), React 19, Capacitor 8, `@capacitor/text-zoom`, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-16-text-size-accessibility-design.md`

---

## File Structure

**New**
- `app/utils/textZoom.ts` — engine: presets, `localStorage` get/set, value resolution, `applyScale`.
- `app/utils/__tests__/textZoom.test.ts` — unit tests.
- `app/components/TextScaleBootstrap.tsx` — applies the stored mode on app load (mounted in layout).
- `app/components/TextSizeControl.tsx` — the segmented control on `/me`.

**Modified**
- `package.json` — add `@capacitor/text-zoom`.
- `app/(client)/layout.tsx` — mount `<TextScaleBootstrap />`.
- `app/(client)/me/page.tsx` — render `<TextSizeControl />`.
- Targeted container spot-fixes (Task 4) — specific components, listed there.

---

## Task 0: Install the plugin

**Files:** `package.json`

- [ ] **Step 1: Install**

```bash
cd ~/Documents/Builds/owt-kb-v1
npm i @capacitor/text-zoom
```

- [ ] **Step 2: Sync native projects**

```bash
npx cap sync ios
npx cap sync android
```
Expected: both succeed and list `@capacitor/text-zoom` in the plugin output. If `@capacitor/text-zoom` reports a Capacitor peer-version conflict with Capacitor 8, STOP and report it (do not downgrade Capacitor) — we will pin a compatible version.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json ios android
git commit -m "chore(mobile): add @capacitor/text-zoom plugin"
```

---

## Task 1: Text-zoom engine (TDD)

**Files:**
- Create: `app/utils/textZoom.ts`
- Test: `app/utils/__tests__/textZoom.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const setMock = vi.fn();
const getPreferredMock = vi.fn();
vi.mock("@capacitor/text-zoom", () => ({
  TextZoom: { set: (...a: unknown[]) => setMock(...a), getPreferred: () => getPreferredMock() },
}));

const isNativeMock = vi.fn();
vi.mock("../native", () => ({ isNativeApp: () => isNativeMock() }));

import {
  getStoredMode, setStoredMode, resolveValue, nearestPreset, applyScale, PRESETS,
} from "../textZoom";

const store: Record<string, string> = {};
beforeEach(() => {
  setMock.mockReset(); getPreferredMock.mockReset(); isNativeMock.mockReset();
  for (const k of Object.keys(store)) delete store[k];
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
  });
  vi.stubGlobal("document", { documentElement: { style: { setProperty: vi.fn() } } });
});

describe("storage", () => {
  it("defaults to auto when unset", () => { expect(getStoredMode()).toBe("auto"); });
  it("round-trips a valid mode", () => { setStoredMode("1.4"); expect(getStoredMode()).toBe("1.4"); });
  it("resets an invalid stored value to auto", () => { store["owt-text-scale"] = "bogus"; expect(getStoredMode()).toBe("auto"); });
});

describe("resolveValue", () => {
  it("maps a fixed preset to its value", () => { expect(resolveValue("1.2")).toBe(1.2); });
  it("maps auto to 1.0 (web fallback)", () => { expect(resolveValue("auto")).toBe(1.0); });
});

describe("nearestPreset", () => {
  it("snaps to the closest fixed preset", () => {
    expect(nearestPreset(1.25)).toBe("1.2");
    expect(nearestPreset(1.55)).toBe("1.6");
    expect(nearestPreset(0.9)).toBe("1.0");
  });
});

describe("applyScale", () => {
  it("native auto: reads getPreferred and applies it", async () => {
    isNativeMock.mockReturnValue(true);
    getPreferredMock.mockResolvedValueOnce({ value: 1.3 });
    await applyScale("auto");
    expect(getPreferredMock).toHaveBeenCalledTimes(1);
    expect(setMock).toHaveBeenCalledWith({ value: 1.3 });
  });
  it("native fixed: applies the preset value, no getPreferred", async () => {
    isNativeMock.mockReturnValue(true);
    await applyScale("1.6");
    expect(getPreferredMock).not.toHaveBeenCalled();
    expect(setMock).toHaveBeenCalledWith({ value: 1.6 });
  });
  it("web: sets -webkit-text-size-adjust and never calls the plugin", async () => {
    isNativeMock.mockReturnValue(false);
    await applyScale("1.4");
    expect(setMock).not.toHaveBeenCalled();
    expect((document.documentElement.style.setProperty as any)).toHaveBeenCalledWith("-webkit-text-size-adjust", "140%");
  });
  it("never throws when the plugin fails", async () => {
    isNativeMock.mockReturnValue(true);
    setMock.mockRejectedValueOnce(new Error("boom"));
    await expect(applyScale("1.2")).resolves.toBeUndefined();
  });
});

describe("PRESETS", () => {
  it("has auto + four fixed presets in order", () => {
    expect(PRESETS.map(p => p.mode)).toEqual(["auto", "1.0", "1.2", "1.4", "1.6"]);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run app/utils/__tests__/textZoom.test.ts`
Expected: FAIL — cannot find module `../textZoom`.

- [ ] **Step 3: Implement `app/utils/textZoom.ts`**

```ts
import { isNativeApp } from "./native";

export type TextScaleMode = "auto" | "1.0" | "1.2" | "1.4" | "1.6";

export const PRESETS: { mode: TextScaleMode; value?: number; label: string }[] = [
  { mode: "auto", label: "Automático" },
  { mode: "1.0", value: 1.0, label: "Normal" },
  { mode: "1.2", value: 1.2, label: "Grande" },
  { mode: "1.4", value: 1.4, label: "Más grande" },
  { mode: "1.6", value: 1.6, label: "Máximo" },
];

const STORAGE_KEY = "owt-text-scale";
const VALID = new Set<TextScaleMode>(["auto", "1.0", "1.2", "1.4", "1.6"]);

/** Stored device-local mode; "auto" when unset or invalid. */
export function getStoredMode(): TextScaleMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v && VALID.has(v as TextScaleMode) ? (v as TextScaleMode) : "auto";
  } catch {
    return "auto";
  }
}

export function setStoredMode(mode: TextScaleMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* non-fatal */
  }
}

/** Fixed presets resolve to their value; "auto" resolves to 1.0 (web fallback baseline). */
export function resolveValue(mode: TextScaleMode): number {
  return PRESETS.find((p) => p.mode === mode)?.value ?? 1.0;
}

/** Snap a raw zoom (e.g. from getPreferred) to the nearest fixed preset mode. */
export function nearestPreset(value: number): TextScaleMode {
  const fixed = PRESETS.filter(
    (p): p is { mode: TextScaleMode; value: number; label: string } => p.value !== undefined
  );
  let best = fixed[0];
  for (const p of fixed) {
    if (Math.abs(p.value - value) < Math.abs(best.value - value)) best = p;
  }
  return best.mode;
}

/**
 * Apply a text scale. Native: @capacitor/text-zoom (getPreferred for auto, set for
 * fixed). Web: best-effort -webkit-text-size-adjust. Never throws.
 */
export async function applyScale(mode: TextScaleMode): Promise<void> {
  try {
    if (isNativeApp()) {
      const { TextZoom } = await import("@capacitor/text-zoom");
      if (mode === "auto") {
        const { value } = await TextZoom.getPreferred();
        await TextZoom.set({ value });
      } else {
        await TextZoom.set({ value: resolveValue(mode) });
      }
    } else {
      document.documentElement.style.setProperty(
        "-webkit-text-size-adjust",
        `${resolveValue(mode) * 100}%`
      );
    }
  } catch (err) {
    console.error("[textZoom] applyScale failed:", err);
  }
}
```

- [ ] **Step 4: Run tests, verify PASS**

Run: `npx vitest run app/utils/__tests__/textZoom.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add app/utils/textZoom.ts app/utils/__tests__/textZoom.test.ts
git commit -m "feat(a11y): text-zoom engine (presets, storage, applyScale)"
```

---

## Task 2: Apply-on-load bootstrap

**Files:**
- Create: `app/components/TextScaleBootstrap.tsx`
- Modify: `app/(client)/layout.tsx`

- [ ] **Step 1: Create `app/components/TextScaleBootstrap.tsx`**

```tsx
"use client";

import { useEffect } from "react";
import { applyScale, getStoredMode } from "@/app/utils/textZoom";

/**
 * Applies the stored text-scale on app load (default "auto" → follows the device
 * setting on native). Renders nothing. Runs once on mount.
 */
export default function TextScaleBootstrap() {
  useEffect(() => {
    applyScale(getStoredMode());
  }, []);
  return null;
}
```

- [ ] **Step 2: Mount it in `app/(client)/layout.tsx`**

Add the import alongside the other component imports:
```tsx
import TextScaleBootstrap from "../components/TextScaleBootstrap";
```
And render it inside `<Provider>` next to `<NativeAuthBootstrap />`:
```tsx
          <NativeAuthBootstrap />
          <TextScaleBootstrap />
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npx next build`
Expected: both pass (the plugin is dynamically imported inside `applyScale`, so SSR is unaffected).

- [ ] **Step 4: Commit**

```bash
git add app/components/TextScaleBootstrap.tsx "app/(client)/layout.tsx"
git commit -m "feat(a11y): apply stored text-scale on app load"
```

---

## Task 3: The `/me` text-size control

**Files:**
- Create: `app/components/TextSizeControl.tsx`
- Modify: `app/(client)/me/page.tsx`

- [ ] **Step 1: Create `app/components/TextSizeControl.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { PRESETS, TextScaleMode, applyScale, getStoredMode, setStoredMode } from "@/app/utils/textZoom";

/**
 * Segmented text-size control. Persists the choice device-locally and applies it
 * immediately. "Automático" follows the device accessibility setting on native.
 */
export default function TextSizeControl() {
  const [mode, setMode] = useState<TextScaleMode>("auto");

  // Initialise from storage after mount (localStorage is client-only).
  useEffect(() => { setMode(getStoredMode()); }, []);

  function choose(next: TextScaleMode) {
    setMode(next);
    setStoredMode(next);
    applyScale(next);
  }

  return (
    <section className="rounded-2xl border border-[#003572]/20 dark:border-[#00bfff]/15 p-5">
      <h3 className="font-display text-lg font-bold mb-1">Tamaño de texto</h3>
      <p className="font-body text-sm text-gray-500 dark:text-gray-400 mb-4">
        “Automático” sigue el ajuste de tu dispositivo. Elige un tamaño fijo para anularlo.
      </p>
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => {
          const active = p.mode === mode;
          return (
            <button
              key={p.mode}
              type="button"
              onClick={() => choose(p.mode)}
              aria-pressed={active}
              className={`font-label text-xs uppercase tracking-widest px-4 py-2 rounded-full border transition-colors ${
                active
                  ? "border-[#00bfff] text-[#00bfff] bg-[#00bfff]/10"
                  : "border-[#003572]/25 dark:border-[#00bfff]/20 text-gray-500 dark:text-gray-400 hover:border-[#00bfff]/50"
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <p className="font-body text-base mt-4 text-gray-600 dark:text-[#C8D8EB]/70">
        Texto de ejemplo — así se verá el contenido de la app.
      </p>
    </section>
  );
}
```

- [ ] **Step 2: Render it on `/me`.**

In `app/(client)/me/page.tsx`, add the import:
```tsx
import TextSizeControl from "@/app/components/TextSizeControl";
```
Then render `<TextSizeControl />` immediately after the `{member && <ProfilePanel initialMember={member} />}` line (around line 304), inside the same `space-y-12` container:
```tsx
        {member && <ProfilePanel initialMember={member} />}
        <TextSizeControl />
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npx next build`
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add app/components/TextSizeControl.tsx "app/(client)/me/page.tsx"
git commit -m "feat(a11y): text-size control on /me"
```

---

## Task 4: Container spot-fixes at Máximo (targeted)

**Goal:** prevent the worst clipping/overlap at the 1.6 setting on the key screens. This is a *targeted* pass — fix what visibly breaks, do NOT convert all 204 px sizes.

**Files (review each; edit only where needed):**
- `app/components/NavMenu.tsx` (avatar badge + dropdown)
- `app/components/SongSheet.tsx` (history rows, key pills, micro-labels)
- `app/components/DayCard.tsx` (member chips, role labels)
- `app/components/Navbar.tsx` (title/author truncation)
- `app/components/TextSizeControl.tsx` (its own preview)

- [ ] **Step 1: Build and run locally, set the largest size**

```bash
npm run dev
```
In the browser, go to `/me`, choose **Máximo** (on web it applies `-webkit-text-size-adjust: 160%` in Chrome). Then visit `/` (home cards), open a song (SongSheet), and open the nav menu.

- [ ] **Step 2: Apply the standard fixes where text clips or overlaps.** Use these patterns (only where a real break is visible):
  - **Fixed-size avatar/initials badges** (`w-9 h-9`, `w-5 h-5` with text inside): ensure the badge has `shrink-0` and the adjacent text container can shrink — add `min-w-0` to the flex parent and `truncate` to the text. Example (NavMenu avatar fallback):
    ```tsx
    // before: <div className="w-9 h-9 rounded-full ... flex items-center justify-center ...">
    // ensure: add `shrink-0` to the badge; the badge text (initials) can stay fixed —
    // the goal is that the badge doesn't get squeezed and neighboring text truncates.
    ```
  - **Rows that must stay on one line** (e.g. SongSheet history row: date + leaders + key pill): add `min-w-0` to the flex row's growable child and `truncate` to its text, and `shrink-0` to the pills/badges so they don't collapse.
  - **Micro-labels** (`text-[8px]`/`text-[9px]` uppercase tracking): if they wrap badly, add `whitespace-nowrap` where they must not wrap, or allow them to wrap by removing a fixed height.
  - Do NOT change the font-size classes themselves (the zoom handles scaling); only adjust layout containers (`min-w-0`, `shrink-0`, `truncate`, `flex-wrap`, remove fixed heights that clip).

- [ ] **Step 3: Re-verify at Máximo and at Normal** — confirm the key screens are usable at 1.6 and unchanged at 1.0.

- [ ] **Step 4: Typecheck + build + commit**

```bash
npx tsc --noEmit && npx next build
git add app/components
git commit -m "fix(a11y): keep key screens usable at the largest text size"
```

> If, after review, NO container needs changes, commit nothing for this task and note "no breaks found at Máximo" — do not invent edits.

---

## Task 5: Device verification (manual)

**Files:** none. Requires a Vercel deploy of the web changes + an Xcode rebuild for the new plugin.

- [ ] **Step 1:** Push all commits; wait for Vercel "Ready"; then `npx cap sync ios && npx cap open ios` → Run on device.
- [ ] **Step 2 — Automático follows OS:** with the app set to **Automático**, change iOS **Settings → Display & Brightness → Text Size** (or Accessibility → Larger Text); reopen the app → text size reflects the device setting.
- [ ] **Step 3 — Override:** in the app, `/me` → choose **Máximo** → text enlarges immediately; force-quit + reopen → still Máximo (persisted); changing the iOS setting now does NOT change the app (override wins).
- [ ] **Step 4 — Reset:** choose **Automático** again → app follows the device again.
- [ ] **Step 5 — No breakage:** at **Máximo**, confirm home cards, SongSheet, nav menu, and `/me` are readable and usable.
- [ ] **Step 6:** `npm test` — all unit tests pass.

---

## Self-review notes (for the implementer)
- `@capacitor/text-zoom` API used: `getPreferred(): Promise<{value:number}>`, `set({value}): Promise<void>`. Verify these against the installed version (Task 0); if the shape differs, adjust `applyScale` and its test together.
- Web scaling via `-webkit-text-size-adjust` works in Chromium/Android browsers; desktop Safari may ignore it — acceptable, the app (WebView) is the target.
- Do NOT change font-size utility classes in Task 4 — the zoom scales text; Task 4 only adjusts layout containers.
