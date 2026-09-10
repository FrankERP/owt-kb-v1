# Motion M1 — Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the app its shell motion on every route — the phone tab bar returns (decision B) and publishes its height so every fixed-bottom element clears it, the desktop navbar gets active-route links with a sliding underline, the avatar badge pops, the impersonation banner drops in, the audio transport slides up and its progress bar stays on the compositor, and the song sheet gets a real head so the whole head drags.

**Architecture:** One new client component (`BottomNav` rewritten in place: five tabs, a `CueDialog` sheet for «Más», measured `--bottom-nav-h` on `<html>` the way `--impersonation-h` is), one new client component (`NavLinks`, the desktop active-route row with `SlidingIndicator`), and edits to `NavMenu`, `ImpersonationBanner`, `AudioPlayer`/`AudioTransport`, `SongSheet`, `EditSongButton`, `app/(client)/layout.tsx`. Two primitive extensions: `Presence` gains `onEntered` (the banner measures after its enter completes) and `VARIANTS` gains `drop` (rise from above). Every fixed-bottom element offsets by `var(--bottom-nav-h)`; a guard test pins the two halves the way `impersonationOffsetSync.test.ts` does.

**Tech Stack:** Next.js 16, React 19, Tailwind 3.4, `motion` 13.2 via the M0 primitives (`Presence`, `SlidingIndicator`, `CueDialog`, `Button`), vitest + @testing-library/react (jsdom per file), Node 22.

**Spec:** `docs/superpowers/specs/2026-09-08-premium-motion-design.md` — §5.0 Shell (all bullets), §6 phasing row M1, §19.1 shell rows (navbar, avatar, bottom tab bar, banner, audio), §20 "M1 collapses stacked headers", Part II §14 (M1 "now with the Biblioteca tab"), Part VIII deferral "SongSheet's hand-rolled header (→ M1)". Reconnaissance the plan argues from: the M1 shell recon of 2026-09-09 18:30 CST.

**Scoping rulings recorded here:**
- §5.0's "the inert `transition-[height]` goes" is already done and guarded by `shellPolish.test.ts` — no task.
- The **Biblioteca** tab links to `/tag` until R1 creates `/biblioteca` and redirects `/tag*` (Part II §12.2); the tab's label is Biblioteca from M1 so the shell does not change twice.
- «Más» is a `CueDialog mode="sheet"` — it inherits the sheet spring, the head grip and the inert page — not a hand-rolled panel. `dialogSemantics.test.ts`'s `BottomNav` exemption therefore goes (the file no longer draws a scrim); its floor stays ≥ 2 because the `CueDialog` shell counts.
- **Tema** inside «Más» is a link to `/me#tema` (the `ThemeControl` section id), not a second write path for the theme preference.
- Kids-only members get Kids · Planear Kids (managers) · Yo · Más; worship members get Inicio · Calendario · Biblioteca · Yo · Más; super-admin sees the worship set with Kids in «Más». Ministry filtering here is cosmetic (the pages enforce), exactly as `NavMenu` states.

## Global Constraints

- Browser floor **iOS 15 / Safari 15** (ADR-0030): no `:has()` in new CSS, no `@starting-style`, no `structuredClone`/`findLast`/`AbortSignal.timeout`, no `overflow: clip`.
- Only `transform` and `opacity` animate (the audio progress bar moves from `width` to `scaleX` for exactly this reason).
- `motion` imports only under `app/components/ui/**`, `app/utils/motion*`, `GalleryMotion.tsx` (`motionImportBoundary.test.ts`). Shell components compose `Presence`, `SlidingIndicator`, `CueDialog`, `Button` — never `motion`.
- `app/(client)/template.tsx` stays a fragment (`reveal.test.ts`): no transformed ancestor above a `position: fixed` element. `Presence` hosts that ARE the fixed element (AudioPlayer, the badge) are fine; a `Presence` wrapping a fixed descendant is not.
- `Presence` hosts are block-level (`div|section|aside|li`); no `appear` above the fold on page load (the banner and player only mount on a user action or a session state, so `appear` is allowed there).
- **`--bottom-nav-h` is published on `<html>` WITH A UNIT (`px`) and measured, never a constant**, cleared on unmount, exactly like `--impersonation-h` (`ImpersonationBanner.tsx`). `brand.css` already declares `--bottom-nav-h: 0px` and `Toast.tsx` already consumes it; `bottomNavOffsetSync.test.ts` (Task 2) pins the two halves.
- `rawMotionLiterals.test.ts` pins `transitionAll` 13 / `rawDuration` 10 with equality — each task that removes a literal lowers the pin in the same commit (the shell sites: `NavMenu.tsx:106,109` `transition-all` ×2; `BottomNav.tsx:48` `transition-all` + `duration-300`; `AudioTransport.tsx:35` `transition-all`, `:81` `duration-100`). Never raise.
- `cueDialogMount.test.ts` baseline 11; Task 6 lowers it to 10 when `SetlistPopover` renders `open={x}`.
- `labelBudget.test.ts` pins six strings; a NEW eyebrow in the shell needs a row, and removing `SongSheet`'s "Canción" eyebrow needs none.
- `dialogSemantics.test.ts`: every file with a clickable `bg-scrim inset-0` carries dialog semantics; the `BottomNav` exemption is deleted in Task 1 (its scrim goes) and the ≥ 2 floor still holds.
- `impersonationBanner.test.tsx` asserts the `impersonating` class is added/removed synchronously on mount/unmount — Task 4 keeps the class synchronous and delays only the height publish.
- Accessible names and roles: the tab bar is `<nav aria-label="Navegación principal">` with `aria-current="page"` on the active tab; the «Más» sheet's items are links/buttons with visible text; the desktop links carry `aria-current="page"`.
- Every new file under `app/**` and every `brand.css` edit regenerates `app/utils/__tests__/__fixtures__/colour-inventory.json` in the same commit (`node scripts/colour-inventory.mjs`). No new colour tokens (use `bg-surface-base/90`, `border-accent/15`, `text-accent`, `text-mono-500` etc.); never bump the `tokenLayer` pin.
- Conventional commits; no AI attribution or `Co-Authored-By`. **Every task runs the FULL `npx vitest run`** before its commit (rerun the two #51 flakes alone), plus `npx tsc --noEmit` and `npx eslint .` (0 errors).
- Docs travel with the code: `docs/MOTION.md` (a "Shell" subsection), `docs/ROUTES.md` (BottomNav returns), `docs/MOBILE.md` (the safe-area + `--bottom-nav-h` contract), `CLAUDE.md` + `AGENTS.md` (byte-identical hunk: the `--bottom-nav-h` invariant beside the `--impersonation-h` one), spec Part IX at delivery.
- Bundle: no new dependency; the shell already carries `AnimatePresence` (M0b-1). Task 8 measures with `docs/MOTION.md`'s method and adds the row; the accepted cap is +32.9 / +35.1 kB gz — report the number, do not trim.

---

## File map

| Path | Responsibility | Task |
|---|---|---|
| `app/components/BottomNav.tsx` (rewrite) + `app/components/__tests__/bottomNav.test.tsx`; `app/utils/__tests__/dialogSemantics.test.ts`; `app/utils/__tests__/rawMotionLiterals.test.ts` | five tabs, «Más» sheet, ministry-aware, publishes `--bottom-nav-h` | 1 |
| `app/(client)/layout.tsx`; `app/components/AudioPlayer.tsx`; `app/components/EditSongButton.tsx`; `app/utils/__tests__/bottomNavOffsetSync.test.ts`; `CLAUDE.md`, `AGENTS.md`, `docs/MOBILE.md`, `docs/ROUTES.md` | mount the bar, offset every fixed-bottom element, guard | 2 |
| `app/components/NavLinks.tsx` + `__tests__/navLinks.test.tsx`; `app/components/Navbar.tsx` | desktop active-route links with `SlidingIndicator`; lockup press | 3 |
| `app/components/ui/Presence.tsx` + test; `app/utils/motionPresets.ts` + test; `app/components/NavMenu.tsx` | `onEntered`, `drop` variant; avatar ring `fast`; badge pop | 4 |
| `app/components/ImpersonationBanner.tsx` + `__tests__/impersonationBanner.test.tsx` | drops in; measures after enter | 5 |
| `app/components/AudioPlayer.tsx`; `app/components/AudioTransport.tsx` | sheet spring in/out; `scaleX` progress | 6 |
| `app/components/SongSheet.tsx`; `app/utils/__tests__/cueDialogMount.test.ts` | real `title`, hand-rolled header collapsed, `SetlistPopover` `open={x}` | 7 |
| `docs/MOTION.md`; bundle row | docs + measurement | 8 |
| `preview`, PR, spec Part IX | delivery | 9 |

---

### Task 1: `BottomNav` — five tabs, «Más» as a sheet, measured height

**Files:**
- Rewrite: `app/components/BottomNav.tsx`
- Create: `app/components/__tests__/bottomNav.test.tsx`
- Modify: `app/utils/__tests__/dialogSemantics.test.ts:54-59` (delete the `BottomNav` exemption), `app/utils/__tests__/rawMotionLiterals.test.ts:14` (`transitionAll` 13→12, `rawDuration` 10→9)

**Interfaces:**
- Consumes: `useSession` (`session.user.role`, `ministries`, `managesMinistries`, `name`, `email`, `image`), `usePathname`, `signOut` + `clearThemeMirror` (as today), `CueDialog` (`open`, `mode="sheet"`, `title`, `label`, `onDismiss`), `SlidingIndicator` (`variant="dot"`), `haptic("selection")`, `Button`.
- Produces: `BottomNav` (default export, `"use client"`, renders `null` when signed out or on `/auth*`/`/studio*`); publishes `--bottom-nav-h` (px) on `document.documentElement` while mounted and visible, removes it on unmount; exports `export const NAV_H_VAR = "--bottom-nav-h"` and `export const NAV_CLASS = "has-bottom-nav"` for the guard; adds `NAV_CLASS` to `<html>` while the bar is on screen (phones), so CSS can pad the page.

Tab sets (ministry filtering cosmetic; pages enforce):

```ts
type Tab = { href: string; label: string; icon: React.ReactNode; match: (p: string) => boolean };
const worship: Tab[] = [
  { href: "/",         label: "Inicio",     icon: <HomeIcon />,     match: (p) => p === "/" },
  { href: "/schedule", label: "Calendario", icon: <CalendarIcon />, match: (p) => p.startsWith("/schedule") },
  // Biblioteca links to /tag until R1 creates /biblioteca and redirects /tag* (spec §12.2).
  { href: "/tag",      label: "Biblioteca", icon: <MusicIcon />,    match: (p) => /^\/(tag|posts|author)/.test(p) },
  { href: "/me",       label: "Yo",         icon: <UserIcon />,     match: (p) => p.startsWith("/me") },
];
const kidsOnly: Tab[] = [
  { href: "/kids",       label: "Kids",         icon: <KidsIcon />, match: (p) => p === "/kids" },
  { href: "/kids/admin", label: "Planear Kids", icon: <PlanIcon />, match: (p) => p.startsWith("/kids/admin") }, // managers only
  { href: "/me",         label: "Yo",           icon: <UserIcon />, match: (p) => p.startsWith("/me") },
];
```

«Más» sheet rows (each a full-width `Link`/`button` row, `min-h-[44px]`): the user block (avatar, name, email) at the top; then, conditionally, **Kids** (`/kids`, when `inKids` and the worship set is showing), **Planear Kids** (`/kids/admin`, when `managesKids`), **Admin** (`/admin`, when `isAdmin`), **Tags** (`/tag` — only in the kids-only set, where Biblioteca is not a tab), **Tema** (`/me#tema`), **Cerrar sesión** (`signOut` after `clearThemeMirror()`, exactly the current handler).

- [ ] **Step 1: Write the failing test**

`app/components/__tests__/bottomNav.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MotionProvider } from "@/app/components/ui/MotionProvider";
import { CueDialogProvider } from "@/app/components/ui/CueDialogProvider";
import { installMotionTestEnv } from "@/app/components/ui/__tests__/motionTestSetup";

installMotionTestEnv();

let pathname = "/";
let session: { user: Record<string, unknown> } | null = null;
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: session, status: session ? "authenticated" : "unauthenticated" }),
  signOut: vi.fn(async () => {}),
}));
vi.mock("@/app/utils/haptics", () => ({ haptic: vi.fn(async () => {}) }));

import BottomNav, { NAV_CLASS, NAV_H_VAR } from "../BottomNav";

function mount() {
  return render(
    <MotionProvider>
      <CueDialogProvider>
        <BottomNav />
      </CueDialogProvider>
    </MotionProvider>,
  );
}
const worshipUser = { name: "Ana", email: "ana@x", role: "member", ministries: ["worship"], managesMinistries: [] };

beforeEach(() => { pathname = "/"; session = { user: worshipUser }; });
afterEach(() => { cleanup(); document.documentElement.classList.remove(NAV_CLASS); document.documentElement.style.removeProperty(NAV_H_VAR); });

describe("BottomNav", () => {
  it("renders nothing signed out, on /auth and on /studio", () => {
    session = null; mount(); expect(screen.queryByRole("navigation", { name: "Navegación principal" })).toBeNull();
    cleanup(); session = { user: worshipUser }; pathname = "/auth/signin"; mount();
    expect(screen.queryByRole("navigation", { name: "Navegación principal" })).toBeNull();
  });

  it("shows Inicio · Calendario · Biblioteca · Yo · Más for a worship member, with aria-current on the route", () => {
    pathname = "/schedule";
    mount();
    const nav = screen.getByRole("navigation", { name: "Navegación principal" });
    const names = Array.from(nav.querySelectorAll("a, button")).map((n) => n.textContent?.trim());
    expect(names).toEqual(["Inicio", "Calendario", "Biblioteca", "Yo", "Más"]);
    expect(screen.getByRole("link", { name: "Calendario" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Biblioteca" }).getAttribute("href")).toBe("/tag");
    expect(nav.querySelectorAll("[data-sliding-indicator]")).toHaveLength(1);
  });

  it("shows Kids · Planear Kids · Yo · Más for a kids manager with no worship ministry", () => {
    session = { user: { ...worshipUser, ministries: ["kids"], managesMinistries: ["kids"] } };
    mount();
    const nav = screen.getByRole("navigation", { name: "Navegación principal" });
    expect(Array.from(nav.querySelectorAll("a, button")).map((n) => n.textContent?.trim())).toEqual(["Kids", "Planear Kids", "Yo", "Más"]);
  });

  it("publishes its measured height on <html> while mounted and clears it on unmount", () => {
    const { unmount } = mount();
    const bar = screen.getByRole("navigation", { name: "Navegación principal" });
    Object.defineProperty(bar, "offsetHeight", { configurable: true, value: 64 });
    act(() => { window.dispatchEvent(new Event("resize")); });
    expect(document.documentElement.style.getPropertyValue(NAV_H_VAR)).toBe("64px");
    expect(document.documentElement.classList.contains(NAV_CLASS)).toBe(true);
    unmount();
    expect(document.documentElement.style.getPropertyValue(NAV_H_VAR)).toBe("");
    expect(document.documentElement.classList.contains(NAV_CLASS)).toBe(false);
  });

  it("opens Más as a sheet dialog with Tema and Cerrar sesión, and Admin only for managers", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Más" }));
    const dialog = screen.getByRole("dialog", { name: "Más" });
    expect(dialog.querySelector('a[href="/me#tema"]')?.textContent).toContain("Tema");
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Admin" })).toBeNull();
    cleanup();
    session = { user: { ...worshipUser, role: "admin" } };
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Más" }));
    expect(screen.getByRole("link", { name: "Admin" }).getAttribute("href")).toBe("/admin");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run app/components/__tests__/bottomNav.test.tsx`
Expected: FAIL — `NAV_CLASS`/`NAV_H_VAR` not exported; tab names differ.

- [ ] **Step 3: Rewrite the component**

`app/components/BottomNav.tsx` — keep the existing icon components at the bottom of the file (`CalendarIcon`, `MusicIcon`, `UserIcon`, `SignOutIcon`, …; add `HomeIcon`, `KidsIcon`, `PlanIcon` as 20×20 `stroke="currentColor"` SVGs in the same style) and replace everything above them with:

```tsx
"use client";

// The phone tab bar (spec §5.0, §19.1, decision B). Five tabs, one sheet. It
// publishes its MEASURED height as --bottom-nav-h on <html> the way the
// impersonation banner publishes --impersonation-h, so every fixed-bottom
// element (toasts, the audio transport, the song FAB) clears it without a
// constant anyone can drift from — bottomNavOffsetSync.test.ts is the guard.
// Ministry filtering is COSMETIC (the pages enforce), as NavMenu says.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { clearThemeMirror } from "@/app/utils/themePref";
import { haptic } from "@/app/utils/haptics";
import SlidingIndicator from "./ui/SlidingIndicator";
import CueDialog from "./ui/CueDialog";
import Button from "./ui/Button";

export const NAV_H_VAR = "--bottom-nav-h";
export const NAV_CLASS = "has-bottom-nav";

type Tab = { href: string; label: string; icon: React.ReactNode; match: (p: string) => boolean };

export default function BottomNav() {
  const { data: session } = useSession();
  const pathname = usePathname() ?? "/";
  const [moreOpen, setMoreOpen] = useState(false);
  const barRef = useRef<HTMLElement | null>(null);
  const user = session?.user ?? null;
  const hidden = !user || pathname.startsWith("/auth") || pathname.startsWith("/studio");

  // Measured, not a constant: the bar wraps to two lines at the largest text
  // scale, and the safe-area inset differs per device. Published only while the
  // bar is on screen (the media query below hides it at lg), cleared on unmount.
  useEffect(() => {
    if (hidden) return;
    const root = document.documentElement;
    const publish = () => {
      const bar = barRef.current;
      const onScreen = bar && bar.offsetParent !== null;
      if (bar && onScreen && bar.offsetHeight) {
        root.style.setProperty(NAV_H_VAR, `${bar.offsetHeight}px`);
        root.classList.add(NAV_CLASS);
      } else {
        root.style.removeProperty(NAV_H_VAR);
        root.classList.remove(NAV_CLASS);
      }
    };
    publish();
    const ro = typeof ResizeObserver !== "undefined" && barRef.current ? new ResizeObserver(publish) : null;
    if (ro && barRef.current) ro.observe(barRef.current);
    window.addEventListener("resize", publish);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", publish);
      root.style.removeProperty(NAV_H_VAR);
      root.classList.remove(NAV_CLASS);
    };
  }, [hidden]);

  if (hidden || !user) return null;

  const role = user.role;
  const isSuper = role === "super-admin";
  const isAdmin = isSuper || role === "admin" || role === "content-editor";
  const ministries = user.ministries ?? ["worship"];
  const inWorship = isSuper || ministries.includes("worship");
  const inKids = isSuper || ministries.includes("kids");
  const managesKids = isSuper || (user.managesMinistries ?? []).includes("kids");

  const tabs: Tab[] = inWorship
    ? [
        { href: "/", label: "Inicio", icon: <HomeIcon />, match: (p) => p === "/" },
        { href: "/schedule", label: "Calendario", icon: <CalendarIcon />, match: (p) => p.startsWith("/schedule") },
        // Biblioteca links to /tag until R1 creates /biblioteca and redirects /tag* (spec §12.2).
        { href: "/tag", label: "Biblioteca", icon: <MusicIcon />, match: (p) => /^\/(tag|posts|author)/.test(p) },
        { href: "/me", label: "Yo", icon: <UserIcon />, match: (p) => p.startsWith("/me") },
      ]
    : [
        { href: "/kids", label: "Kids", icon: <KidsIcon />, match: (p) => p === "/kids" },
        ...(managesKids ? [{ href: "/kids/admin", label: "Planear Kids", icon: <PlanIcon />, match: (p: string) => p.startsWith("/kids/admin") }] : []),
        { href: "/me", label: "Yo", icon: <UserIcon />, match: (p) => p.startsWith("/me") },
      ];

  const rowClass = "flex min-h-[44px] w-full items-center gap-3 px-5 py-3 font-label text-xs uppercase tracking-widest text-ink hover:bg-accent/5";

  return (
    <>
      <nav
        ref={barRef}
        aria-label="Navegación principal"
        className="fixed bottom-0 inset-x-0 z-50 lg:hidden bg-surface-base/90 backdrop-blur-sm border-t border-accent/15"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-stretch h-16 max-w-7xl mx-auto">
          {tabs.map((tab) => {
            const active = tab.match(pathname);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                onClick={() => { void haptic("selection"); setMoreOpen(false); }}
                aria-current={active ? "page" : undefined}
                className={`relative flex-1 flex flex-col items-center justify-center gap-1 transition-colors duration-fast ease-out-brand ${
                  active ? "text-accent" : "text-mono-500 hover:text-mono-300"
                }`}
              >
                {active && <SlidingIndicator id="bottom-nav" variant="dot" />}
                <span className={`transition-transform duration-fast ease-out-brand ${active ? "-translate-y-0.5" : ""}`}>{tab.icon}</span>
                <span className="font-label text-[10px] uppercase tracking-widest">{tab.label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => { void haptic("selection"); setMoreOpen(true); }}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            className={`relative flex-1 flex flex-col items-center justify-center gap-1 transition-colors duration-fast ease-out-brand ${
              moreOpen ? "text-accent" : "text-mono-500 hover:text-mono-300"
            }`}
          >
            <span><MoreIcon /></span>
            <span className="font-label text-[10px] uppercase tracking-widest">Más</span>
          </button>
        </div>
      </nav>

      <CueDialog open={moreOpen} mode="sheet" size="sm" title="Más" label="Más" onDismiss={() => setMoreOpen(false)}>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-accent/10">
          {user.image ? (
            <Image src={user.image} alt="" width={40} height={40} className="rounded-full shrink-0" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-accent-deep flex items-center justify-center shrink-0">
              <span className="font-label text-sm text-accent">{user.name?.slice(0, 2).toUpperCase()}</span>
            </div>
          )}
          <div className="min-w-0">
            <p className="font-body text-sm font-semibold truncate">{user.name}</p>
            <p className="font-label text-[11px] uppercase tracking-widest text-mono-500 truncate">{user.email}</p>
          </div>
        </div>
        <div className="divide-y divide-accent/10 pb-[env(safe-area-inset-bottom)]">
          {inWorship && inKids && <Link href="/kids" onClick={() => setMoreOpen(false)} className={rowClass}><KidsIcon />Kids</Link>}
          {inWorship && managesKids && <Link href="/kids/admin" onClick={() => setMoreOpen(false)} className={rowClass}><PlanIcon />Planear Kids</Link>}
          {isAdmin && <Link href="/admin" onClick={() => setMoreOpen(false)} className={rowClass}><AdminIcon />Admin</Link>}
          {!inWorship && <Link href="/tag" onClick={() => setMoreOpen(false)} className={rowClass}><MusicIcon />Tags</Link>}
          <Link href="/me#tema" onClick={() => setMoreOpen(false)} className={rowClass}><ThemeIcon />Tema</Link>
          <button
            type="button"
            onClick={() => { clearThemeMirror(); void signOut({ callbackUrl: "/auth/signin" }); }}
            className={`${rowClass} text-negative-fg hover:bg-negative-strong/10`}
          >
            <SignOutIcon />Cerrar sesión
          </button>
        </div>
      </CueDialog>
    </>
  );
}
```

Read the current file's sign-out handler and copy its exact `signOut(...)` arguments (the snippet's `callbackUrl` is a placeholder for whatever the file does today). `Button` is imported for nothing yet — remove the import if unused (eslint). Keep the icons; add `MoreIcon`, `HomeIcon`, `KidsIcon`, `PlanIcon`, `AdminIcon`, `ThemeIcon` if absent (20×20, `fill="none" stroke="currentColor" strokeWidth="1.8"`, `aria-hidden`).

- [ ] **Step 4: Delete the `dialogSemantics` exemption and lower the raw-motion pins**

In `app/utils/__tests__/dialogSemantics.test.ts` remove the `"components/BottomNav.tsx"` entry from `NOT_A_DIALOG` (the file no longer draws a `bg-scrim inset-0`). In `rawMotionLiterals.test.ts` set `BASELINE = { transitionAll: 12, rawDuration: 9 }` with a comment line `// 2026-09-09 M1 Task 1: BottomNav's sheet became a CueDialog (−1 transition-all, −1 duration-300).` If the test reports different counts, the count is the truth — set it and say so.

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run app/components/__tests__/bottomNav.test.tsx app/utils/__tests__/dialogSemantics.test.ts app/utils/__tests__/rawMotionLiterals.test.ts app/utils/__tests__/cueDialogMount.test.ts`
Expected: PASS. (`cueDialogMount`: the sheet uses `open={moreOpen}`, so the baseline 11 is untouched.)

- [ ] **Step 6: Gates and commit**

Run: `npx tsc --noEmit && npx eslint app/components/BottomNav.tsx app/components/__tests__/bottomNav.test.tsx && node scripts/colour-inventory.mjs && npx vitest run` (full suite; #51 flakes alone).

```bash
git add -A app/components/BottomNav.tsx app/components/__tests__/bottomNav.test.tsx app/utils/__tests__/dialogSemantics.test.ts app/utils/__tests__/rawMotionLiterals.test.ts app/utils/__tests__/__fixtures__/colour-inventory.json
git commit -m "feat(shell): BottomNav returns — five tabs, Más as a sheet, a measured height on <html>

Decision B. Inicio · Calendario · Biblioteca · Yo · Más for worship members
(Biblioteca points at /tag until R1), Kids · Planear Kids · Yo · Más for a
kids-only member. Más is a CueDialog sheet, so it inherits the spring, the
head grip and the inert page. The bar publishes --bottom-nav-h in px the way
the impersonation banner publishes its height; Task 2 mounts it and moves
every fixed-bottom element onto the variable."
```

---

### Task 2: Mount the bar and offset every fixed-bottom element

**Files:**
- Modify: `app/(client)/layout.tsx:83-93`, `app/components/AudioPlayer.tsx:43-46`, `app/components/EditSongButton.tsx:225`, `app/brand.css` (page bottom padding under `html.has-bottom-nav`), `CLAUDE.md` + `AGENTS.md` (invariant), `docs/MOBILE.md`, `docs/ROUTES.md`
- Create: `app/utils/__tests__/bottomNavOffsetSync.test.ts`

**Interfaces:** consumes `NAV_H_VAR`/`NAV_CLASS` from Task 1 (the guard reads them from the source as `impersonationOffsetSync.test.ts` does).

- [ ] **Step 1: Write the guard (failing)**

`app/utils/__tests__/bottomNavOffsetSync.test.ts` — copy the shape of `impersonationOffsetSync.test.ts` exactly and assert:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

// The bar publishes its MEASURED height as --bottom-nav-h on <html>; every
// fixed-bottom element offsets by it. Nothing but this test connects the halves.
describe("bottom nav offset sync", () => {
  const nav = read("app/components/BottomNav.tsx");
  const varName = /export const NAV_H_VAR = "([^"]+)"/.exec(nav)?.[1];
  const className = /export const NAV_CLASS = "([^"]+)"/.exec(nav)?.[1];

  it("names the variable and class the CSS expects", () => {
    expect(varName).toBe("--bottom-nav-h");
    expect(className).toBe("has-bottom-nav");
  });

  it("publishes with a px unit and clears on unmount", () => {
    expect(nav).toMatch(/setProperty\(NAV_H_VAR, `\$\{[^}]+\}px`\)/);
    expect(nav).toMatch(/removeProperty\(NAV_H_VAR\)/);
    expect(nav).toMatch(/classList\.add\(NAV_CLASS\)/);
    expect(nav).toMatch(/classList\.remove\(NAV_CLASS\)/);
  });

  it("brand.css declares the variable with a unit and pads the page under the class", () => {
    const css = read("app/brand.css");
    expect(css).toMatch(/--bottom-nav-h:\s*0px;/);
    expect(css).toMatch(/html\.has-bottom-nav \[data-route-main\]\s*\{[^}]*padding-bottom:\s*var\(--bottom-nav-h\)/);
  });

  it.each([
    ["app/components/ui/Toast.tsx"],
    ["app/components/AudioPlayer.tsx"],
    ["app/components/EditSongButton.tsx"],
  ])("%s offsets its fixed bottom by the variable", (rel) => {
    expect(read(rel)).toMatch(/var\(--bottom-nav-h(, 0px)?\)/);
  });

  it("the client layout mounts BottomNav inside Provider", () => {
    const layout = read("app/(client)/layout.tsx");
    expect(layout).toMatch(/<BottomNav \/>/);
    expect(layout.indexOf("<Provider>")).toBeLessThan(layout.indexOf("<BottomNav />"));
  });
});
```

Run: `npx vitest run app/utils/__tests__/bottomNavOffsetSync.test.ts` — FAIL on the CSS, the offsets and the layout.

- [ ] **Step 2: Mount and pad**

`app/(client)/layout.tsx`: import `BottomNav from "@/app/components/BottomNav"` and render `<BottomNav />` after `<SongSheet />` inside `<Provider>` (it needs `CueDialogProvider` and `MotionProvider`). In `app/brand.css`, next to the `--bottom-nav-h: 0px;` declaration, add the consumer:

```css
/* The page pads for the tab bar only while the bar is on screen: BottomNav adds
   the class with the measured height (bottomNavOffsetSync.test.ts). */
html.has-bottom-nav [data-route-main] { padding-bottom: var(--bottom-nav-h); }
```

- [ ] **Step 3: Offset the transport and the FAB**

`AudioPlayer.tsx` root: replace `className="fixed bottom-0 inset-x-0 …"` + `style={{ paddingBottom: "env(safe-area-inset-bottom)" }}` with `className="fixed inset-x-0 …"` and `style={{ bottom: "var(--bottom-nav-h, 0px)", paddingBottom: "env(safe-area-inset-bottom)" }}` — when the bar is on screen its safe-area padding is inside the bar's height, so the player's own padding would double it: make the player's `paddingBottom` `"calc(env(safe-area-inset-bottom) * var(--audio-safe, 1))"` is over-engineering; instead set `paddingBottom` only when `--bottom-nav-h` is 0 by moving it to CSS: `.audio-player { padding-bottom: env(safe-area-inset-bottom); } html.has-bottom-nav .audio-player { padding-bottom: 0; }` in `brand.css` and `className="audio-player fixed inset-x-0 …"`. `EditSongButton.tsx:225`: `className="fixed right-6 z-40 …"` with `style={{ bottom: "calc(1.5rem + var(--bottom-nav-h, 0px))" }}` (drop `bottom-6`).

- [ ] **Step 4: Docs**

`CLAUDE.md` "Don't-break-these invariants": after the impersonation-banner bullet add `- **The phone tab bar publishes its MEASURED height as \`--bottom-nav-h\` (px) on \`<html>\`** plus a \`has-bottom-nav\` class; \`brand.css\` pads the route main under that class and every fixed-bottom element (toasts, the audio transport, the song FAB) offsets by the variable. \`bottomNavOffsetSync.test.ts\` is the guard — a new fixed-bottom element joins its list.` Same hunk in `AGENTS.md`. `docs/MOBILE.md`: a "Safe area and the tab bar" section stating the contract (the bar carries the bottom inset; elements above it offset by the variable, not by the inset). `docs/ROUTES.md`: BottomNav is mounted on every `(client)` route for signed-in members (hidden ≥ lg, on `/auth*`, `/studio*`).

- [ ] **Step 5: Gates and commit**

Run: `npx vitest run app/utils/__tests__/bottomNavOffsetSync.test.ts app/utils/__tests__/impersonationOffsetSync.test.ts app/utils/__tests__/agentDocsParity.test.ts app/utils/__tests__/reveal.test.ts app/utils/__tests__/brandCss.test.ts app/utils/__tests__/tokenLayer.test.ts && npx tsc --noEmit && npx eslint "app/(client)/layout.tsx" app/components/AudioPlayer.tsx app/components/EditSongButton.tsx && node scripts/colour-inventory.mjs && npx vitest run`

```bash
git add -A "app/(client)/layout.tsx" app/components/AudioPlayer.tsx app/components/EditSongButton.tsx app/brand.css app/utils/__tests__/bottomNavOffsetSync.test.ts app/utils/__tests__/__fixtures__/colour-inventory.json CLAUDE.md AGENTS.md docs/MOBILE.md docs/ROUTES.md
git commit -m "feat(shell): mount BottomNav; every fixed-bottom element clears its measured height

The route main pads under html.has-bottom-nav, the audio transport and the
song FAB offset by var(--bottom-nav-h), toasts already did.
bottomNavOffsetSync.test.ts pins the halves the way the impersonation guard
does. CLAUDE.md/AGENTS.md carry the invariant; MOBILE.md the safe-area
contract."
```

---

### Task 3: Desktop nav links with a sliding underline; lockup press

**Files:**
- Create: `app/components/NavLinks.tsx`, `app/components/__tests__/navLinks.test.tsx`
- Modify: `app/components/Navbar.tsx:22-61`

**Interfaces:**
- Produces: `NavLinks` (`"use client"`; props `{ schedule?: boolean; tags?: boolean }` mirroring `Navbar`'s flags), renders `null` while the session loads or signed out; `hidden lg:flex` row of `Link`s — Calendario (`/schedule`, when `schedule` and `inWorship`), Biblioteca (`/tag`, when `tags` and `inWorship`), Yo (`/me`), Admin (`/admin`, when `isAdmin`), Kids (`/kids`, when `inKids`) — each `aria-current="page"` when active with `<SlidingIndicator id="nav-links" variant="underline" />` inside the active one.

- [ ] **Step 1: Failing test** (`navLinks.test.tsx`, same mocks as `bottomNav.test.tsx`): renders the four worship links for an admin at `/schedule` with `aria-current="page"` on Calendario and exactly one `[data-sliding-indicator]`; renders nothing signed out; hides Calendario/Biblioteca for a kids-only member and shows Kids.

- [ ] **Step 2: Component**

```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import SlidingIndicator, { useActiveIntoView } from "./ui/SlidingIndicator";

function NavLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  const ref = useActiveIntoView(active);
  return (
    <Link
      ref={ref}
      href={href}
      aria-current={active ? "page" : undefined}
      className={`relative px-3 py-2 font-label text-[11px] uppercase tracking-widest transition-colors duration-fast ease-out-brand ${active ? "text-accent" : "text-mono-500 hover:text-accent"}`}
    >
      {label}
      {active && <SlidingIndicator id="nav-links" variant="underline" />}
    </Link>
  );
}

export default function NavLinks({ schedule = false, tags = false }: { schedule?: boolean; tags?: boolean }) {
  const { data: session, status } = useSession();
  const pathname = usePathname() ?? "/";
  const user = session?.user;
  if (status === "loading" || !user) return null;
  const isSuper = user.role === "super-admin";
  const isAdmin = isSuper || user.role === "admin" || user.role === "content-editor";
  const ministries = user.ministries ?? ["worship"];
  const inWorship = isSuper || ministries.includes("worship");
  const inKids = isSuper || ministries.includes("kids");
  const links = [
    ...(schedule && inWorship ? [{ href: "/schedule", label: "Calendario", active: pathname.startsWith("/schedule") }] : []),
    ...(tags && inWorship ? [{ href: "/tag", label: "Biblioteca", active: /^\/(tag|posts|author)/.test(pathname) }] : []),
    ...(inKids ? [{ href: "/kids", label: "Kids", active: pathname.startsWith("/kids") }] : []),
    { href: "/me", label: "Yo", active: pathname.startsWith("/me") },
    ...(isAdmin ? [{ href: "/admin", label: "Admin", active: pathname.startsWith("/admin") }] : []),
  ];
  return (
    <div className="hidden lg:flex items-center gap-1 ml-6" aria-label="Secciones">
      {links.map((l) => <NavLink key={l.href} {...l} />)}
    </div>
  );
}
```

`Navbar.tsx`: render `<NavLinks schedule={schedule} tags={tags} />` right after the lockup `Link`; add press physics to the lockup: `active:scale-[0.985] transition-transform duration-fast ease-out-brand` on the lockup `Link`'s className. `Navbar` stays a plain component (no hooks).

- [ ] **Step 3: Gates and commit** — `npx vitest run app/components/__tests__/navLinks.test.tsx app/utils/__tests__/shellPolish.test.ts app/utils/__tests__/rawMotionLiterals.test.ts && npx tsc --noEmit && npx eslint app/components/NavLinks.tsx app/components/Navbar.tsx && node scripts/colour-inventory.mjs && npx vitest run`.

```bash
git add -A app/components/NavLinks.tsx app/components/__tests__/navLinks.test.tsx app/components/Navbar.tsx app/utils/__tests__/__fixtures__/colour-inventory.json
git commit -m "feat(shell): desktop nav links with a sliding underline; the lockup presses

Calendario · Biblioteca · Kids · Yo · Admin as real links at lg and above,
ministry-filtered like NavMenu, aria-current on the route, one shared
SlidingIndicator underline. The avatar menu keeps every destination for
narrower screens."
```

---

### Task 4: `Presence.onEntered`, the `drop` variant, avatar ring and badge pop

**Files:**
- Modify: `app/components/ui/Presence.tsx`, `app/components/ui/__tests__/Presence.test.tsx`, `app/utils/motionPresets.ts`, `app/utils/__tests__/motionPresets.test.ts`, `app/components/NavMenu.tsx:100-119`, `app/utils/__tests__/rawMotionLiterals.test.ts`

**Interfaces:**
- Produces: `Presence` prop `onEntered?: () => void` (fires when the enter animation completes — under `skipAnimations` synchronously after mount); `VARIANTS.drop = { initial: { opacity: 0, y: -8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -8 } }`; `VariantName` includes `"drop"`.

- [ ] **Step 1: Failing tests** — in `Presence.test.tsx`: `onEntered` is called once after a `show` false→true (`await waitFor(...)`), and not on exit; in `motionPresets.test.ts`: `VARIANTS.drop` has the shape above and only `opacity`/`y` keys (the existing loop over `VARIANTS` already checks that).

- [ ] **Step 2: Implement** — `Presence`: add the prop; on the host `onAnimationComplete={(def) => { if (def === "animate" || (typeof def === "object" && def && "opacity" in def && (def as {opacity?: number}).opacity === 1)) onEntered?.(); }}` — check how `motion` reports the definition for an object `animate` (it passes the target object); assert in the test what arrives and adjust the guard so exit does NOT fire it. `motionPresets.ts`: add `drop`.

- [ ] **Step 3: NavMenu** — the two `transition-all` rings (`NavMenu.tsx:106,109`) become `transition-[box-shadow,transform] duration-fast ease-out-brand active:scale-[0.97]`; wrap the badge in `<Presence show={notifCount > 0} appear variant="scale" className="absolute -top-0.5 -right-0.5">` with the badge `span` inside it (drop the `absolute` classes from the span; `Presence` is a block host, which is what the absolute box needs; `aria-hidden` stays on the span). Lower `rawMotionLiterals` `transitionAll` by 2 (12→10).

- [ ] **Step 4: Gates and commit** — `npx vitest run app/components/ui/__tests__ app/utils/__tests__/motionPresets.test.ts app/utils/__tests__/rawMotionLiterals.test.ts && npx tsc --noEmit && npx eslint app/components/ui/Presence.tsx app/utils/motionPresets.ts app/components/NavMenu.tsx && node scripts/colour-inventory.mjs && npx vitest run`.

```bash
git add -A app/components/ui/Presence.tsx app/components/ui/__tests__/Presence.test.tsx app/utils/motionPresets.ts app/utils/__tests__/motionPresets.test.ts app/components/NavMenu.tsx app/utils/__tests__/rawMotionLiterals.test.ts app/utils/__tests__/__fixtures__/colour-inventory.json
git commit -m "feat(motion): Presence.onEntered and the drop variant; the avatar ring and badge get their physics

The badge pops in (Presence scale, appear) when the count rises; the avatar
ring transitions box-shadow and transform over --motion-fast instead of
transition-all. onEntered exists for the impersonation banner, which must
measure itself only after it has landed."
```

---

### Task 5: `ImpersonationBanner` drops in and measures after landing

**Files:**
- Modify: `app/components/ImpersonationBanner.tsx:30-60`, `app/components/__tests__/impersonationBanner.test.tsx`

- [ ] **Step 1: Failing test** — add a case: with `active` true, the `--impersonation-h` property is NOT set synchronously on mount but IS set after `onEntered` fires (`await waitFor(() => expect(document.documentElement.style.getPropertyValue("--impersonation-h")).toMatch(/px$/))` with `offsetHeight` stubbed to 56 on the bar). The existing class add/remove assertions stay untouched.

- [ ] **Step 2: Implement** — keep `classList.add(BANNER_CLASS)` in the effect exactly as today (synchronous). Move the FIRST `publish()` call out of the effect into a `handleEntered` callback passed to `<Presence show={active} appear variant="drop" onEntered={handleEntered} className="…">` wrapping the bar; keep the `ResizeObserver` + `resize` listener wiring in the effect (they publish later changes); the unmount cleanup still removes the property and the class. The banner is `sticky top-0` — `Presence`'s host takes the sticky/positioning classes and the bar inside keeps its visual classes; verify nothing `position: fixed` is a descendant (it is not).

- [ ] **Step 3: Gates and commit** — `npx vitest run app/components/__tests__/impersonationBanner.test.tsx app/utils/__tests__/impersonationOffsetSync.test.ts && npx tsc --noEmit && npx eslint app/components/ImpersonationBanner.tsx && node scripts/colour-inventory.mjs && npx vitest run`.

```bash
git add -A app/components/ImpersonationBanner.tsx app/components/__tests__/impersonationBanner.test.tsx app/utils/__tests__/__fixtures__/colour-inventory.json
git commit -m "feat(shell): the impersonation banner drops in and publishes its height after landing

The navbar offset used to animate against a moving target; now the class is
set at once (the guard's contract) and the measured height lands with the
banner via Presence.onEntered."
```

---

### Task 6: Audio transport slides; progress on the compositor

**Files:**
- Modify: `app/components/AudioPlayer.tsx:38-46`, `app/components/AudioTransport.tsx:35,80-83`, `app/utils/__tests__/rawMotionLiterals.test.ts`

- [ ] **Step 1: AudioPlayer** — replace the early `return null` + fixed `div` with `<Presence show={!!player.track && !sheet && !sheetLoading && !sheetError} appear variant="sheet" className="audio-player fixed inset-x-0 z-40 …" style={{ bottom: "var(--bottom-nav-h, 0px)" }}>…</Presence>` (the host IS the fixed element; `Presence` forwards `className`/`style`). Everything the old `div` contained moves inside.

- [ ] **Step 2: AudioTransport** — the progress fill: `className="h-full w-full origin-left rounded-full bg-accent transition-transform duration-fast ease-out-brand group-hover:bg-accent/80"` with `style={{ transform: \`scaleX(${progress})\` }}` (drop `transition-[width] duration-100` and the `width` style); the `transition-all` at `:35` becomes the specific properties it animates (read the element: colour → `transition-colors`). Lower `rawMotionLiterals` (`transitionAll` 10→9, `rawDuration` 9→8) — the test's count is the truth.

- [ ] **Step 3: Test** — if `app/components/__tests__` has an AudioTransport/AudioPlayer test, extend it: the fill's `style.transform` is `scaleX(0.5)` at `progress=0.5`; otherwise add `audioTransport.test.tsx` with that single case (render `AudioTransport` with the minimal props the component needs — read its prop type).

- [ ] **Step 4: Gates and commit** — `npx vitest run app/components/__tests__ app/utils/__tests__/rawMotionLiterals.test.ts app/utils/__tests__/bottomNavOffsetSync.test.ts && npx tsc --noEmit && npx eslint app/components/AudioPlayer.tsx app/components/AudioTransport.tsx && node scripts/colour-inventory.mjs && npx vitest run`.

```bash
git add -A app/components/AudioPlayer.tsx app/components/AudioTransport.tsx app/components/__tests__ app/utils/__tests__/rawMotionLiterals.test.ts app/utils/__tests__/__fixtures__/colour-inventory.json
git commit -m "feat(shell): the audio transport slides up and down; progress scales instead of resizing

Presence sheet spring on the fixed host (no transformed ancestor above it);
the fill animates transform: scaleX from the left, which stays on the
compositor where a width transition did not."
```

---

### Task 7: `SongSheet` gets a real head; stacked headers collapse

**Files:**
- Modify: `app/components/SongSheet.tsx:113-151, 383-411`, `app/utils/__tests__/cueDialogMount.test.ts:34` (11→10)

- [ ] **Step 1: The head** — pass `title={sheet?.title ?? "Canción"}` to the `CueDialog` at `:113` (keep `label`); delete the hand-rolled header block (`:122-151`): the "Canción" eyebrow, the `h2`, and the close `button`. Whatever else that block carried (key/BPM/author line, the setlist trigger) moves to the top of the body as a compact meta row (`px-5 pt-3`), keeping the same text and controls. `closeButtonRef` is gone: point `fallbackFocusRef` at the first control of the meta row (give it a ref) and pass that ref where `closeButtonRef` was used (`:253`, `:386`). Loading/error states that rendered their own header text: keep their body content, drop any duplicated title.

- [ ] **Step 2: `SetlistPopover`** — change its `<CueDialog open title="Set completo" …>` to `<CueDialog open={open} …>` where the caller passes `open` (read the caller at `:383` — it mounts the popover conditionally; keep the popover mounted and pass the boolean instead). Lower `cueDialogMount` `BASELINE` to 10 with a comment naming this site.

- [ ] **Step 3: Test** — `app/components/__tests__/songSheet.test.tsx` if it exists (grep); otherwise add one that renders `SongSheet` with a mocked sheet store showing a song and asserts: `getByRole("dialog", { name: /Canción/ })`, exactly one `h2` with the title (no duplicate), and the `[data-cue-head]` contains the title (the head grip). Read how `SongSheet` gets its state (a context/store) and mock the minimum.

- [ ] **Step 4: Gates and commit** — `npx vitest run app/components/__tests__ app/utils/__tests__/cueDialogMount.test.ts app/utils/__tests__/labelBudget.test.ts && npx tsc --noEmit && npx eslint app/components/SongSheet.tsx && node scripts/colour-inventory.mjs && npx vitest run`.

```bash
git add -A app/components/SongSheet.tsx app/components/__tests__ app/utils/__tests__/cueDialogMount.test.ts app/utils/__tests__/__fixtures__/colour-inventory.json
git commit -m "feat(shell): the song sheet has one head — the dialog's — and it drags

SongSheet passes a real title, so CueDialog draws the head (grip, sr-only ×
on phones) and the hand-rolled header with its Canción eyebrow goes (spec
§20: M1 collapses stacked headers). SetlistPopover renders open={x};
cueDialogMount 11→10."
```

---

### Task 8: Docs and the bundle row

**Files:** `docs/MOTION.md` (new "Shell" subsection under Primitives/Where the walk's findings landed: BottomNav, NavLinks, banner, transport, the `--bottom-nav-h` contract, `Presence.onEntered`, `drop`), `docs/UTILITIES_AND_COMPONENTS.md` (`Presence` row: `onEntered`; a `BottomNav`/`NavLinks` line), bundle ledger row per §Bundle's method (`/`, `/admin`, shared, async chunk raw/gz; Δ vs the M0b-2 tip 110.2 / 336.8 and vs Before M0a).

- [ ] Write, run `npx vitest run app/utils/__tests__/agentDocsParity.test.ts app/utils/__tests__/motionTokens.test.ts`, commit `docs(motion): shell section, Presence.onEntered, the M1 bundle row`.

---

### Task 9: Delivery

Full gates on the tip; whole-branch review (most capable model) with docs-audit + worklog checklists; ONE fix wave + scoped re-review; spec Part IX (branch, range, what shipped, rulings, bundle, deferrals: `/biblioteca` route and `/tag*` redirects → R1; long-press quick actions → R7); push branch → `preview` → deploy-verifier → dev-verify captures (`/` phone with the bar, `/schedule` phone, `/me` phone with «Más» open via `--click "Más"`, a song page phone with the sheet + transport, desktop `/schedule` at 1440 for the underline, `/admin` desktop; an impersonation capture if the bot can impersonate — it cannot, say so) → visual-verifier → PR to `main` → STOP for Frank's look.

---

## Self-review

- **Spec coverage:** §5.0 route reveal (M0a, done); Navbar `transition-[height]` (already gone, ruled); lockup press (T3); desktop underline (T3); NavMenu avatar press + ring, `Menu` (M0b-1), badge pop (T4); BottomNav resurrected with tabs, lift, `layoutId` pill (dot), haptic, «Más» sheet, safe-area, `--bottom-nav-h` published + guard (T1, T2); SectionNav (M0b-2, done); banner drop + measure-after-enter (T4, T5); AudioPlayer sheet spring + `scaleX` (T6); SongSheet as sheet with the head (T7); §20 stacked headers (T7); §14 Biblioteca tab (T1, ruled to `/tag`).
- **Placeholders:** the sign-out arguments in T1 and the meta-row contents in T7 are explicitly "read the current file and keep it verbatim" instructions, not TBDs; T4's `onAnimationComplete` guard says what to assert and adjust.
- **Type consistency:** `NAV_H_VAR`/`NAV_CLASS` exported by T1, read by T2's guard; `Presence.onEntered` added in T4, used in T5; `VARIANTS.drop` added in T4, used in T5; `SlidingIndicator` `variant="underline"` (exists) in T3, `"dot"` in T1; `useActiveIntoView` signature unchanged.
