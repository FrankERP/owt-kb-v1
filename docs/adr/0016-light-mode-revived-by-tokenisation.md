# ADR-0016: Revive light mode by tokenising colour, and stage the rollout on the default

**Date:** 2026-08-12 · **Status:** Accepted — supersedes [ADR-0008](0008-forced-dark-theme.md)

## Context

[ADR-0008](0008-forced-dark-theme.md) forced dark mode app-wide in July 2026. It was
explicit that light mode was rejected **on time, not on merit**: the palette had stopped
being *maintained*, because new panels were built and reviewed in dark only, so light drifted
further out of date with every release. ADR-0008 named the constraint that would have to
change before a revival could stick — *the maintenance cost of two palettes* — and set a
precondition for pulling the lever: not until the 47 untreated files were handled.

Simply un-forcing it would have re-created the state ADR-0008 existed to prevent. The
question this record answers is what changed such that it does not.

## Decision

**Colour was tokenised, so a component can no longer name a palette.** 30 base roles plus
23 composed tokens live in `app/brand.css`, declared once under `:root` and again under
`.light`; `tailwind.config.ts` exposes them as utilities. 2,397 colour decisions across the
app were migrated onto them, and an error-level ESLint clause
(`eslint.config.mjs:73`) now rejects a raw hex literal anywhere under `app/**/*.{ts,tsx}`.

**That is the whole of it.** The drift mechanism was that a component could hardcode a value
that only worked in one theme. With the values named rather than written, a new panel is
correct in both themes by construction, and the second palette costs nothing to keep.

Delivered as six children (A–F), each independently revertible:

| | |
|---|---|
| A–C | the token layer, the migration, the palette families |
| D | the 90 light counterpart values |
| E | `themePref` on `teamMembers`, `PATCH /api/me/theme`, the `/me` control, and the removal of `forcedTheme="dark"` |
| F | the default moves unset → Follow System (`enableSystem={true}`, `defaultTheme="system"`) |

**The rollout was staged on the DEFAULT, never on the surface** — light mode has always
shipped whole. Child E made it reachable and opt-in with unset resolving to dark, so a member
who chose nothing saw no change at all; Child F then moved the default. Reverting is a
change to a constant, not to 2,397 sites.

## Rejected

**Re-adding `dark:` variants** — the cheap revival ADR-0008 itself named. It scales the
drift rather than removing it: **238 of the 251 existing variants carry a hex literal**, so
every one is a place where the two themes can disagree again, and nothing prevents the next
one from being added.

**A partial-surface revival — specified, adversarially reviewed, and rejected on evidence
(parent spec §4.1).** The first scope deferred the 17 admin-panel files and their 1,306
colour decisions (54%), keeping those screens dark inside an otherwise light document. It
failed two adversarial rounds **on the same component each time**, and the finding was
structural rather than incidental: *the containment mechanism cannot be made complete.*

- `app/components/ui/CueDialogProvider.tsx:62-64` appends its portal root to
  `document.body`, and `CueDialog.tsx:230` portals every dialog into it. Five of the
  deferred admin panels mount it.
- `app/components/admin/PlannerGrid.tsx` returns
  `fullScreen ? createPortal(surface, document.body) : surface` — the entire full-screen
  planner, 124 colour decisions, rendered as a child of `<body>`.

Portaled content is not a DOM descendant of anything inside the route, **so a route-scoped
containment wrapper misses it by construction**, and nothing stops the next portal from being
added unpinned. Three further channels had already been found in the round before: 121
`dark:` variants compiling to a `.dark` *ancestor* selector under `tailwind.config.ts:10`;
`.light`-scoped `.brand-*` rules that a descendant wrapper cannot override; and translucent
admin surfaces compositing against the body wash.

**So light mode ships whole (invariant 16).** Anyone reaching for "just do the member
screens first" is reaching for the option that was tried and measured.

## Consequences

**Undoing this is not one line, and the order matters.** The default lives in **three**
places that cannot share a constant — `Provider.tsx`, `ThemeBootstrap`'s
unset-with-a-mirror repair, and `THEME_MIGRATION_SCRIPT`'s `catch` — because `useTheme()`
exposes no `defaultTheme` and the third is a string of pre-hydration JavaScript.
`app/utils/__tests__/themeWiring.test.ts` asserts all three as a set.

**`enableSystem={true}` must not be flipped back while stored `"system"` values exist.**
next-themes resolves a `"system"` theme only when that flag is true; with it false the
applier strips `light`/`dark` and adds a literal `system` class, leaving the document with
**no theme class at all**, no error, and nothing logged. The stored values are in members'
`localStorage` mirrors, not only in Sanity, and the mirror population is *larger* than the
set of members who chose Follow System — the storage listener writes `defaultTheme` back
into every other open tab whenever any tab clears the key. A Sanity-only migration cannot
see them. The ordered rollback is in
`docs/superpowers/plans/2026-08-12-light-mode-F-the-rollout.md`.

**What this costs going forward:** every new colour decision must name a role. The ESLint
clause enforces it, and the theme gallery at `/theme-gallery` renders both themes for
review. That is the maintenance cost ADR-0008 refused to pay in July — and it is now paid
once, in the token layer, rather than per component per release.

**Known remnants, recorded rather than discovered:** an installed iOS PWA keeps dark chrome
in light mode — `manifest.webmanifest`'s `theme_color` is read at install time, and
`appleWebApp.statusBarStyle` stays `black-translucent` because every light-appropriate value
is non-translucent and would collapse `env(safe-area-inset-top)`, moving `Navbar`,
`CueDialog` and `PlannerGrid` on every toggle. That is geometry, not colour, and belongs to
the iOS work. 57 sites remain below WCAG AA in **both** themes — pre-existing debt surfaced
by Child D's audit, explicitly out of scope here rather than silently inherited.
