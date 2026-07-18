# Slice 1 — Foundation, Shell, and Catalog

**Outcome:** Establish the visual language and a stable, responsive shell without changing modal infrastructure or client mutation behavior.

**Depends on:** [Master contract](./2026-07-16-backstage-cue-system.md) and [dependency matrix](./2026-07-16-backstage-cue-system-dependencies.md).

**Boundary:** This slice is deliberately nonmodal. Do not touch SongSheet, AudioPlayer, CalendarView dialogs, DayCard editors, profile/admin dialogs, shared SongForm output, or mutation handlers.

---

## Task 1 — Harden tokens, CSS ownership, and mobile preview harness

**Files**

- `app/brand.css`
- `tailwind.config.ts`
- `app/(client)/globals.css`
- `capacitor.config.ts`
- `docs/MOBILE.md`

**Work**

- Add semantic Caution, Special, Danger, focus, elevation, radius, and motion tokens from the master contract.
- Define Cue Cut, quiet cue rail, surface levels, and reduced-motion behavior.
- Add new tokens/selectors without changing the computed output of existing shared brand selectors. Do not remove or relocate the legacy layout properties currently owned by `brand-facet-panel`, `brand-surface`, `brand-surface-interactive`, or `brand-library-module` in this slice; their callers span Slices 2–3.
- Normalize raw core-brand values only when the mapping is unambiguous; leave component redesign to its owning task.
- Add `CAPACITOR_SERVER_URL` as an optional HTTPS-only override. Default to the existing production URL.
- Document preview sync/run/restore in `docs/MOBILE.md`; do not claim offline support.

**Verification**

- Existing home, SongSheet, DayCard, tag, and admin geometry/computed layout is unchanged except intentional token additions that are not yet applied.
- Tailwind emits the new semantic utilities.
- Reduced motion removes Cue Cut movement.
- `CAPACITOR_SERVER_URL=https://dev-owt-backstage.vercel.app npx cap sync ios` writes the preview target to generated native config.
- A following plain `npx cap sync ios` restores `https://owt-backstage.vercel.app` and leaves no tracked native diff.

**Commit:** `refactor(ui): harden backstage foundations`

---

## Task 2 — Add only nonmodal visual primitives

**Files**

- Create `app/components/ui/CueButton.tsx`
- Create `app/components/ui/CueSurface.tsx`
- Create `app/components/ui/SignalChip.tsx`
- Create `app/components/ui/cueStyles.ts`
- Add focused tests under `app/components/ui/__tests__/`

**Work**

- Implement only variants already repeated in the app:
  - buttons: primary, secondary, quiet, destructive;
  - surfaces: base, primary, selected;
  - signals: neutral, action, ready, caution, special, danger.
- Keep primitives presentational and domain-agnostic.
- Forward native props and refs; preserve disabled semantics and visible focus.
- Do not create `CueDialog`, a provider, portal, focus manager, or body lock in this slice.
- Do not add a class-merging or component-library dependency.

**Verification**

- Disabled and loading buttons remain accessible and at least 44px on touch surfaces.
- Signal colors match semantic meaning and are never the only source of status information.
- Primitives do not add per-row state or animation.

**Commit:** `feat(ui): add backstage visual primitives`

---

## Task 3 — Establish the global shell and system states

**Files**

- `app/components/Navbar.tsx`
- `app/components/NavMenu.tsx`
- `app/components/ImpersonationBanner.tsx`
- `app/(client)/loading.tsx`
- `app/(client)/error.tsx`
- `app/(client)/auth/signin/page.tsx`
- `app/(client)/auth/not-a-member/page.tsx`
- `app/(client)/posts/not-found.tsx`
- Add `app/components/__tests__/NavMenu.disclosure.test.tsx`

**Work**

- Keep a balanced three-zone desktop header.
- On mobile, separate the logo/profile brand bar from a centered page-context cue strip so brand and route title do not compete.
- Preserve safe-area calculations, sticky behavior, session resolution, notification badges, role links, and alias-first `/me` context.
- Treat NavMenu as a disclosure of ordinary links/buttons:
  - remove inaccurate `aria-haspopup="menu"`;
  - use `aria-controls` and `aria-expanded`;
  - retain normal Tab order;
  - close on outside click, navigation, and Escape;
  - restore focus to the avatar trigger.
- Keep dormant `BottomNav` unmounted and keep `CmsNavbar` out of scope.
- Recompose loading, signed-out, unauthorized, error, and not-found states with the same information hierarchy and plain Spanish actions.

**Verification**

- Header context is optically centered at 320, 390, 768, and 1440px.
- No overlap with logo, avatar, notch/Dynamic Island, impersonation banner, or mobile browser chrome.
- NavMenu tests cover association, normal keyboard traversal, outside click, Escape/focus restoration, navigation, and absence of false menu semantics.
- Auth/session behavior and link destinations are unchanged.

**Commit:** `feat(shell): establish backstage cue navigation`

---

## Task 4 — Turn the catalog into a cue index

**Files**

- `app/components/SongSearchList.tsx`
- `app/components/PostComponent.tsx`
- `app/components/TagSearchList.tsx`
- `app/components/AuthorSearchList.tsx`
- `app/(client)/tag/page.tsx`
- `app/(client)/tag/[slug]/page.tsx`
- `app/(client)/author/page.tsx`
- `app/(client)/author/[slug]/page.tsx`
- Targeted component tests under `app/components/__tests__/`

**Work**

- Replace equal-weight card grids with a responsive cue index: title, key dial, compact BPM/time rail, author, and restrained tag signals.
- Reserve Cue Cut for current/selected/primary state. “Nuevo” and any featured metadata use a restrained neutral text chip or quiet rail, never another Cue Cut or strong glow; multiple new rows must remain visually calm together.
- Keep all catalog tag chips neutral. The schema exposes no authoritative semantic classification, so do not infer ready/caution/danger meaning from tag names or slugs.
- Standardize count, sort, search, clear, empty, and result feedback. Give song, tag, and author search inputs explicit accessible names, and announce result-count/empty-state changes after typing or clearing through a polite live region.
- Use native buttons/links where markup permits.
- Preserve Fuse search, accent folding, memoization, tag slugs, author routes, and the current catalog performance profile.
- Do not change SongSheet or song-detail behavior; this checkpoint opens the existing sheet only to prove activation is intact.

**Verification**

- Representative title, author, key, accentless, and two-character queries retain results and ordering.
- Keyboard activation opens the same song; links remain crawlable.
- No per-row state, expensive filter, or entrance animation is introduced.
- A multi-row fixture with several “Nuevo” songs contains no repeated Cue Cuts or strong glows.
- Song, tag, and author search tests cover accessible names plus polite announcements for filtered counts, empty results, and clearing.
- Empty states identify the next useful action in Spanish.

**Commit:** `feat(library): redesign songs and tags as cue index`

---

## Slice 1 preview checkpoint

Before the checkpoint:

1. Run `npx tsc --noEmit`, `npm test`, `npm run build`, and `git diff --check`.
2. Merge current `main` into the implementation branch and rerun the checks.
3. Merge the exact implementation tree through `preview`; verify tree equality and the canonical Vercel project.
4. Record the SHA deployed to `dev-owt-backstage.vercel.app`.

Review:

- `/auth/signin`, `/auth/not-a-member`, `/`, global navigation, loading/error/not-found.
- Catalog search and activation, `/tag`, `/tag/[slug]`, `/author`, `/author/[slug]`.
- Representative shared-shell contexts for every active Navbar consumer: `/posts/[slug]`, `/schedule`, `/me`, `/me/propose/[roleId]`, and `/admin` in addition to the public catalog routes.
- 320, 390, 768, and 1440px shell checks, with screenshots at 390×844 and 1440×900; keyboard, reduced motion, clean console/network.
- Member/content-editor/admin/super-admin NavMenu link assertions, notification badge preservation, alias-first `/me` title, and an impersonation-banner fixture with no overlap.
- “Máximo” text size and safe areas in browser, installed online PWA, and iOS Simulator.
- Preview override and production restoration in generated iOS config.

Do not submit any form. Obtain telemetry consent before authenticated web/PWA/Simulator sessions; otherwise mark those gates blocked.

**Slice 1 is done when** the shell and catalog are approved on the recorded preview SHA, no modal or mutation output changed, and the native config is restored to production.
