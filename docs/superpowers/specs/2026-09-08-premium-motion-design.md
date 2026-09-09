# Backstage motion — design spec

**Date:** 2026-09-08 · **Status:** Approved by Frank 2026-09-08 10:40 CST (all decisions A–P, see §22) · **Risk tier:** standard
(UI consumers of already-approved writers; no production writer, serializer, auth boundary,
schema or concurrency contract changes). Pipeline: this spec → user review → implementation
plans per phase → gates → fresh code review of each diff.

## 1. The brief, and what the repo says today

Frank's ask: better animations, buttons, sliding elements and richer interactions on
**every page and every component**, so the app feels premium — "a different level".

What the inventory found (two read-only sweeps, 2026-09-08, on `a733347c`):

| Fact | Where |
|---|---|
| Two duration tokens, one keyframe, one `prefers-reduced-motion` rule in the whole app | `app/brand.css:8-9`, `:884-897` |
| 305 `<button>`s, no shared Button; the same intent spelled ~6 ways | inventory §2 |
| 13 toasts render the same `fixed bottom-6` div by hand, none animate, one has a live region | inventory §4 |
| `CueDialog` (13 consumers) mounts and unmounts instantly; two more modals are hand-rolled | `ui/CueDialog.tsx:228`, `kids/SeatPicker.tsx`, `admin/SongFormModal.tsx` |
| No page enter, no list/filter animation, no tab-switch transition, no expand/collapse height motion anywhere | inventory |
| Mobile has **no bottom tab bar**: `BottomNav.tsx` is unmounted dead code (removed in `a03c3859` "Stable v2", reason unrecorded) — and it holds the only real sheet transition in the repo | `app/components/BottomNav.tsx` |
| `.animate-overlay-in` and the `snap-start` config key have zero callers | `(client)/globals.css:13` |
| Browser floor is **iOS 15** (ADR-0030): no View Transitions API, no `@starting-style`, no scroll-driven animations, no `:has()` guarantee, `overscroll-behavior` unsupported | ADR-0030 |
| Drag is native HTML5, desktop-only by decision (ADR-0012); touch and keyboard use pick-then-place | ADR-0012 |
| Guards that bite a motion change: `colourInventory.test.ts` (new colour-bearing class literals need the artifact regenerated), `dialogSemantics.test.ts`, `brandCss.test.ts` (every `var(--x)` must be declared), `clientBoundary.test.ts`, `tokenLayer.test.ts` | `app/utils/__tests__/` |

So the premium feel is not a coat of paint over a system — the system does not exist yet.
The work is (a) build a motion system with primitives, (b) walk every route and adopt it.

## 2. Design direction

### 2.1 The metaphor is already in the code: a stage

The identity is **Backstage**. The dialog is a *Cue*. The hero has a *beam*. The section
heading carries a lit rail. The stage vocabulary — cue, beam, spot, blackout, follow-spot —
gives this system its one signature and keeps every other motion quiet.

**Signature: the beam.** One accent-light sweep, used in exactly four places and nowhere else:

1. **Route reveal** — on every navigation the page content "gets lit": sections rise 8px
   and fade in with a 40ms stagger, and the page's `brand-section-heading` rail draws itself
   top-to-bottom over 480ms. Not the beam gradient itself, just its rail. (The beam gradient
   stays exclusive to the sign-in lockup, where it already lives.)
2. **Skeletons shimmer instead of pulse** — a diagonal accent sweep crossing each placeholder
   every 1.6s. The loading state and the loaded state share one gesture.
3. **Primary button sheen** — on hover (pointer devices only) a narrow highlight crosses the
   fill once, 600ms. Never on tap, never repeated while hovered.
4. **Drop landing** — when a dragged chip lands (planner, kids board, setlist, proposal), the
   target cell flashes the beam edge once (120ms) as the chip settles with a spring.

Everything else is physics, not decoration: things slide because they are sheets, scale
because they are pressed, and crossfade because they replaced something.

### 2.2 Motion principles (the rules every phase follows)

- **Only `transform` and `opacity` animate.** Never `height`, `width`, `top`, `box-shadow`
  loops, or `filter: blur()` — iOS WebViews drop frames on all of them. The one exception
  is `Collapse`: a user-triggered disclosure animates `height: auto` through `motion`'s
  measured-height path (Safari 15 cannot interpolate `grid-template-rows`; that arrived in
  16), with the inner box at `overflow: hidden`, and only for content that is short.
  The shimmer and the heading rail are `transform` on a pseudo-element (`translateX` sweep,
  `scaleY` draw), never `background-position` or `height`.
- **Durations from tokens, never literals.** `duration-300` in JSX is a smell after Phase 0;
  a scan test warns on new raw `duration-N`/`transition-all` outside `app/components/ui/`.
- **Enter fast, exit faster.** Enter 200–320ms ease-out; exit 120–160ms ease-in. Nothing
  the user is waiting on takes longer than 320ms. The route reveal (480ms) is the single
  exception and it never blocks interaction — content is interactive from first paint.
- **No layout shift from motion.** Reveals start at opacity 0 in their final box. Nothing
  reserves space by animating into it. CLS stays 0.
- **Reduced motion is a first-class theme.** One global rule in `brand.css` collapses every
  animation and transition to 0.01ms when `prefers-reduced-motion: reduce`; the JS layer
  reads the same query and switches sheets/dialogs to a plain crossfade (opacity only), so
  the app never becomes static — it becomes calm. Tested like the theme is tested.
- **Touch is the primary surface.** Every hover effect has a `:active` press twin (sink 1px,
  scale 0.985, 80ms) so the iPhone feels responsive; hover-only choreography (sheens, lifts)
  is gated by `@media (hover: hover)`.
- **44px minimum hit targets** on every control the Button primitive renders at `size="lg"`,
  which is the default on phone widths.
- **Focus is visible everywhere.** The primitive carries `focus-visible:ring-2 ring-accent/60`;
  adopting it fixes the ~240 buttons that rely on browser default today.

### 2.3 Motion tokens (added to `app/brand.css` `:root`, non-colour, outside the colour lint)

```
--motion-fast:    120ms   /* colour, hover, focus ring */
--motion-base:    200ms   /* press, toggles, menus, small reveals */
--motion-slow:    320ms   /* sheets, dialogs, tab panels, expand/collapse */
--motion-reveal:  480ms   /* route reveal, hero rail */
--motion-shimmer: 1600ms  /* skeleton sweep period */
--ease-out:       cubic-bezier(0.22, 1, 0.36, 1)
--ease-in:        cubic-bezier(0.4, 0, 1, 1)
--ease-in-out:    cubic-bezier(0.65, 0, 0.35, 1)
--motion-rise:    8px     /* enter travel */
--motion-sink:    1px     /* press travel */
```

`--brand-duration-fast` and `--brand-duration-reveal` stay (ADR-0016 lists them among the
four surviving non-colour `--brand-*` vars; `brandCss.test.ts` and the token-migration docs
reference them) but become aliases: `--brand-duration-fast: var(--motion-fast)`.

Springs (JS only, Phase 0 `motionPresets.ts`): `sheet` {stiffness 380, damping 36, mass 0.9},
`pop` {stiffness 520, damping 30}, `settle` {stiffness 300, damping 28}.

Tailwind gains `transitionDuration`/`transitionTimingFunction`/`keyframes`/`animation`
extensions keyed to these vars (`duration-fast`, `ease-out-brand`, `animate-shimmer`,
`animate-rise`). `tokenLayer.test.ts` guards colour keys only; these are non-colour and pass.

## 3. Approaches considered

**A. CSS-only + two hand-rolled hooks** (`usePresence` for exit-before-unmount via
`animationend`, `useFlip` for reorder). Zero dependencies. Covers enter/exit, press, sheets,
tab indicator (measured left/width), skeletons. Weak on: shared-element tab indicators across
re-renders, reorder/drag settle with spring physics, interrupted animations (open→close mid-
flight snaps), and it grows a private animation library the repo then owns forever. jsdom has
no `element.animate`, so every hook needs an environment guard in tests.

**B. `motion` (formerly framer-motion) v12, loaded lazily, plus CSS tokens for everything
static.** `LazyMotion features={domAnimation}` + `m.*` components: ~18 kB gz added to the
shared chunk, Safari 15 supported, React 19 supported. `AnimatePresence` solves exit and
interruption; `layout`/`layoutId` gives the sliding tab indicator, list filtering, and reorder
settle for free; `MotionConfig reducedMotion="user"` honours the OS switch app-wide;
`useReducedMotion` for the JS layer. CSS still owns hover/press/focus/skeleton/route-reveal
(no JS cost on 300 buttons). Weak on: one more dependency in a repo that pins carefully
(ADR-0001), and a discipline rule that only `ui/` primitives import `motion` directly.

**C. `@react-spring/web`.** Comparable physics, but no `layoutId`, no `AnimatePresence`
equivalent without extra code, larger surface for this team to learn. No advantage over B.

**Recommendation: B.** The three things that separate "premium" from "has transitions" —
exits that complete, interruptions that reverse smoothly, and elements that slide between
states — are exactly what A makes expensive and B makes routine. The bundle cost is measured
in Phase 0 and capped (§7). Recorded as ADR-0031 with the iOS 15 check (`motion` 12.x
declares Safari 15+ in its browserslist; verified on the simulator in Phase 0).

**Rule that makes B safe:** `import { m, AnimatePresence } from "motion/react"` is allowed
only under `app/components/ui/**` and `app/utils/motion*`. Feature components compose the
primitives (`<Presence>`, `<Sheet>`, `<SlidingIndicator>`, `<Reveal>`, `<Collapse>`,
`<Reorderable>`). A scan test (`motionImportBoundary.test.ts`) fails on any other import
site, the same shape as `clientBoundary.test.ts`.

## 4. The primitives (Phase 0 deliverables, `app/components/ui/`)

| Primitive | What it owns | Replaces |
|---|---|---|
| `Button` | variants `primary / secondary / ghost / danger / icon / pill`; sizes `sm / md / lg(44px)`; press sink, hover sheen (primary, pointer only), focus ring, `disabled` and `aria-busy` looks, optional leading icon; `asChild`-style `href` rendering a `Link` | the ~6 inline spellings, incrementally per phase |
| `SegmentedControl` | `role=radiogroup` pills with a sliding `layoutId` thumb | ThemeControl, TextSizeControl, Calendario/Lista, Popular/A–Z, ChordChart chart tabs |
| `Tabs` (indicator only) | `SlidingIndicator` under/behind the active tab, scroll-active-into-view | AdminPanel `TabBar`, SectionNav |
| `Presence` | `AnimatePresence` wrapper with the four house variants: `fade`, `rise`, `sheet`, `scale` | every conditional `{open && …}` that should animate |
| `CueDialog` (upgraded) | enter/exit: card = scale 0.96→1 + fade over `slow`; sheet = spring from `translateY(100%)`; backdrop fades; drag-down-to-dismiss from the sheet head — handle and title bar (pointer events, threshold 150px or velocity — 80px as first built, doubled on Frank's dev look 2026-09-09); `CueDialogProvider` gains a `closing` state so focus restores after the exit completes | its 13 consumers + `SeatPicker` + `SongFormModal` + `ProposalEditor` confirm, which migrate onto it |
| `Toast` + `ToastViewport` + `useToast()` | one stack, bottom-centre above the tab bar and safe area, `rise` in / `fade` out, `role=status` (or `alert` for errors), holds the existing `useTransientValue` semantics including `hold` | the 13 hand-rolled toasts |
| `Menu` | anchored popover with `scale` presence, outside-click and Escape, arrow-key roving focus | NavMenu dropdown, PracticePlaylistButton, ServiceReadinessCard "Más acciones", AvailabilityCalendar note popover |
| `Collapse` | measured `height: auto` animation with fade, `aria-expanded` wiring, chevron rotation | ActivityPanel, IntegrityQueuePanel, "Roles previos", "Recurrente", "Agregar canción" |
| `Reveal` | CSS-only route/section reveal; `data-reveal` + `--reveal-i` stagger; replays on navigation via `app/(client)/template.tsx` | nothing — new |
| `Skeleton` | shimmer block with the beam sweep; the three hand-copied `loading.tsx` skeletons become compositions of it | `animate-pulse` blocks |
| `NumberRoll` | digit crossfade (old rises out, new rises in) | NextServiceHero countdown, ChordChart transpose readout, key dial |
| `Switch` | `EmailPrefToggles`' knob promoted to a primitive with a spring | EmailPrefToggles, ChordChart "Mostrar acordes" |
| `haptics` util | `@capacitor/haptics` `impact("light")` on drop landing, toggle flips, sheet snap; no-op on web | new; **decision D** |

Every primitive: `"use client"`, rendered as JSX by server components (never called —
ADR-0028), tested in vitest with `MotionConfig reducedMotion="always"` so assertions see final
state, and exhibited in a new theme-gallery fixture `controls` so light/dark and VR baselines
cover it.

## 5. Page by page

Format: **region → what moves → primitive**. "Press" means the Button primitive's
`:active` sink. Interactions already listed in the inventory that are *not* mentioned here
keep their behaviour and get only the Button/focus adoption.

### 5.0 Shell (`app/(client)/layout.tsx`, Navbar, NavMenu, BottomNav, SectionNav, ImpersonationBanner, AudioPlayer, SongSheet)

- **Route reveal** — `template.tsx` (client, ~10 lines) remounts children per navigation; page sections carry `data-reveal`. The `<main>` wrapper is never transformed (a transformed ancestor breaks every `position: fixed` descendant — the WebKit trap already documented in `CueDialog.tsx:33`).
- **Navbar** — the inert `transition-[height]` goes. Lockup: press. Desktop gains an active-route underline via `SlidingIndicator` across the nav links rendered by NavMenu when signed in (Calendario · Tags · Yo · Admin).
- **NavMenu** — avatar: press + ring `fast`; the dropdown becomes `Menu` (scale presence from the avatar corner, 200ms); notification badge pops in with `pop` spring when the count rises.
- **BottomNav — resurrected (decision B).** Phone-only tab bar: Inicio · Calendario · Biblioteca · Yo · Más. Active tab: icon lifts 2px and the label brightens; a `layoutId` pill slides between tabs; tap = haptic light. "Más" opens a `Sheet` (Kids, Planear Kids, Admin, Tags, Tema, Cerrar sesión) with the existing `inert` handling. Safe-area bottom padding. Every fixed-bottom element (toasts, FAB, AudioPlayer) offsets by `--bottom-nav-h` published on `<html>` the way `--impersonation-h` is — same guard shape as `impersonationOffsetSync.test.ts`.
- **SectionNav** — underline becomes `SlidingIndicator`; the active pill scrolls itself into view (`scrollIntoView({inline:"center"})`, behaviour respects reduced motion as the existing `ProposalsPanel` gate does).
- **ImpersonationBanner** — enters from the top with `rise` (inverted); the `--impersonation-h` measurement runs after the enter completes so the navbar offset does not animate against a moving target.
- **AudioPlayer transport** — slides up with `sheet` spring when a track starts, slides down when it stops; the progress bar switches from a `width` transition to `transform: scaleX` (origin left), which stays on the compositor.
- **SongSheet** — is a `CueDialog mode="sheet"`; inherits the sheet spring and drag-to-dismiss.

### 5.1 `/` Home

- **"Esta semana" DayCards** — reveal stagger; each setlist row: press + `group-hover` title colour (exists) + a 2px accent rail that slides in from the left on hover (`transform: scaleX`). "Editar" opens the SetlistEditor sheet (spring). Medley spine draws in on reveal.
- **PracticePlaylistButton** — its disclosure becomes `Menu`.
- **Biblioteca search** — `brand-search-console` gets a focus glow transition (`fast`); results list is a `layout` group: filtered cards slide to their new positions and leavers fade (`Presence fade`, 120ms); the empty state rises in. `PostComponent`: press, and the existing hover-lift keeps its 150ms but gains the press twin.
- **Empty state** ("No hay servicios…") — `Reveal`.
- **loading.tsx** — `Skeleton` shimmer composition.

### 5.2 `/schedule`

- **Calendario / Lista** — `SegmentedControl` with sliding thumb; the two views crossfade (`Presence fade`, panels absolutely stacked during the 200ms so the height does not jump).
- **Month navigation** — the grid slides 24px in the direction of travel (prev = from left, next = from right) and fades; the `<input type="month">` jump uses fade only.
- **Day cells** — press (scale 0.94, `pop` spring back); today's dot pulses once on reveal, never continuously.
- **Day-detail** — `CueDialog mode="sheet"`, inherits spring + drag-to-dismiss.
- **Legend** — reveal stagger with the heading.
- **loading.tsx** — `Skeleton`.

### 5.3 `/posts/[slug]` Song

- **Hero** — reveal: tag chips stagger 30ms each, h1 rises, key/BPM/time-sig pills rise last. Tag chips: press + hover border.
- **EditSongButton** — inline trigger: press. FAB (mobile): appears with `pop` spring on mount, hides (scale to 0) while a sheet is open, sits above the tab bar. Form opens in `CueDialog` (already) — inherits.
- **SectionNav** — see shell.
- **Audio section** — play/pause icon morphs (two `Presence scale` glyphs); the active track row gets an equaliser-style 3-bar indicator animating `scaleY` (the only ambient animation in the app, and it stops with the audio).
- **Tutoriales** iframes — reveal.
- **Referencia cards** — press + existing hover-lift.
- **ChordChart** — chart tabs → `SegmentedControl`; transpose ± → press with the readout as `NumberRoll`; "Mostrar acordes" → `Switch`; the chart body crossfades on transpose (`fade`, 120ms) so the chords do not flicker mid-reflow.
- **Historial** cards — reveal stagger.
- **loading.tsx** — `Skeleton`, and it stops hard-coding the navbar height (reads the same class as `Navbar`).

### 5.4 `/tag`, `/tag/[slug]`

- **Popular / A–Z** — `SegmentedControl`; the grid `layout`-animates the reorder.
- **Pinned "Tipo de canción" cards** — keep their choreography (the best in the app today); the progress bar changes from `height` to `transform: scaleY` (origin bottom) to stay on the compositor.
- **Remaining tag grid** — press + existing lift; filtered results `layout` + `Presence`.
- `/tag/[slug]` — hero reveal, then §5.1's library behaviour.

### 5.5 `/author`, `/author/[slug]`

- Both adopt `brand-song-hero` (today `/author` has no hero and `/author/[slug]` has an ad-hoc blob — consistency fix, **decision E**). Then §5.4's list behaviour. Sort toggle → `SegmentedControl`.

### 5.6 `/me`

- **ThemeAnnouncement** — enters with `rise` on first paint instead of appearing on the second; dismiss collapses it (`Collapse` closing + fade).
- **AddToCalendarButton** — Button `secondary`, press.
- **NextServiceHero** — reveal first; countdown pill uses `NumberRoll`; the proposal CTA rises last.
- **Remaining DayCards** — §5.1.
- **Kids roles card** — reveal.
- **AvailabilityCalendar** — day toggles: press with `pop` spring and a 120ms fill crossfade; month prev/next slides like §5.2; "Recurrente" → `Collapse`; the dot pager thumb slides (`layoutId`); note popover → `Menu`; "Guardado ✓" → `Toast` (keeps `reset` on edit).
- **ProfilePanel** — avatar hover overlay keeps `transition-opacity`; upload spinner → the `Skeleton` shimmer ring; toasts → `Toast`; Guardar → Button `primary` with `aria-busy` state (label crossfades to "Guardando…").
- **EmailPrefToggles** → `Switch`.
- **ThemeControl**, **TextSizeControl** → `SegmentedControl`. Theme change itself: no crossfade of the whole page (a full-page `transition: background-color` costs a frame on iOS and fights next-themes' class swap) — the pills slide, the page swaps.

### 5.7 `/me/propose/[roleId]` Proposal editor

- **Song rows** — `Reorderable`: rows `layout`-animate on drag reorder and on ↑/↓; the dragged row lifts (`scale 1.02`, shadow via a pre-rendered shadow layer at opacity, not an animated `box-shadow`); drop landing beam; remove = `Presence` exit (row slides left and fades, 160ms, neighbours close the gap via `layout`).
- **Key picker** → `Menu`.
- **Medley chip** — `pop` on attach.
- **"Agregar canción"** → `Collapse`; search results `layout` + `Presence`.
- **Sticky action bar** — appears with `rise` when the form becomes dirty; Enviar = Button `primary`, `aria-busy`.
- **Confirm dialog** → `CueDialog` (card variant).
- **ProposalThread** — new messages `rise` in; the send button: press, then the textarea clears with a 120ms fade.
- **Toast** (top-20 today) → `Toast` viewport (bottom, consistent with the rest).

### 5.8 `/admin`

- **Status dot** ("Acceso autorizado") — one `pop` on reveal, no loop.
- **TabBar** → `Tabs` with `SlidingIndicator`; active tab scrolls into view; tab bodies crossfade (`Presence fade` 200ms) with the outgoing panel absolutely positioned so the frame does not collapse. `?tab=` sync unchanged.
- **Members grid** — search/filter `layout` + `Presence`; member row (`brand-member-row`) press + its existing hover; member modals → CueDialog card (inherit).
- **ServicesPanel** — month pills → `SegmentedControl`-style indicator; "Roles previos" → `Collapse`; loading rows → `Skeleton`; error retry → Button; cards grid reveal stagger; `ParticipationSidebar` counts use `NumberRoll` when a seat changes.
- **ServiceReadinessCard** — state changes (ring, border tone) transition over `base`; "Más acciones" → `Menu`; `ServicePrimaryAction` → Button `primary` with `aria-busy`.
- **MonthGenerator** — selects/checkboxes/radios adopt the primitives' focus and press; the swap toast (which `hold`s) → `Toast` with `hold`; the generated grid reveals with stagger per column.
- **PlannerGrid** — within ADR-0012 (single-seat move, desktop drag, no auto-scroll, pick-then-place on touch): drop-target cells pulse a dashed accent border (the `KidsRotationBoard` "all valid targets" pattern, extended); the dragged chip's HTML5 drag image is a styled clone (`setDragImage`); drop landing beam + `settle` spring; picked chip (pick-then-place) gets a breathing ring (opacity 0.6↔1, 1.2s) that stops on place; over-capacity warning border transitions over `fast`; **full-screen mode** enters with `scale 0.98→1` + fade over `slow` and exits reversed — existing focus trap unchanged; the Tipo warning (PR #48) rises in.
- **SetlistEditor** — `Reorderable` as §5.7; sticky footer rise.
- **SongFormModal** → `CueDialog` (removes a hand-rolled shell; `dialogSemantics.test.ts` already requires the role and trap it has).
- **ActivityPanel**, **IntegrityQueuePanel** — expand/collapse → `Collapse`; queue items `Presence` exit when resolved.
- **AvailabilityPanel** — table cells: press; the sticky first column gets a shadow-on-scroll edge (opacity toggle, IntersectionObserver sentinel).
- **ContentPanel** — row actions `opacity-0 → group-hover` keep; on touch they are always visible at `size="sm"` (hover is not a thing on the phone).

### 5.9 `/kids`, `/kids/admin`

- **/kids** — Sunday cards reveal stagger; "Te toca" pill `pop`s once on reveal.
- **KidsPlanner** — month nav slide (§5.2); Generar / Otra opción / Guardar → Button with `aria-busy` label crossfade; inline status → `Toast`; skeleton → `Skeleton` (keeps its `motion-reduce` intent via the global rule).
- **KidsRotationBoard** — its existing dashed valid-target highlight becomes the shared pattern; `PairChip` drag: lift + landing beam + `settle`; cell buttons press.
- **SeatPicker** → `CueDialog mode="sheet"` (removes the second hand-rolled shell).
- **KidsSundayCards** — seat buttons press; assignment change crossfades the name (`fade` 120ms).
- **PairRoster** — add row `rise`; delete `Presence` exit; inline edit fields focus glow.
- **KidsAvailabilityPanel** — Buttons; save → `Toast`.

### 5.10 `/auth/signin`, `/auth/not-a-member`, `error.tsx`, `not-found.tsx`

- **Sign-in** — the beam stays; the facet panel rises 120ms after the lockup; Google button and form fields stagger 40ms; the error `role=alert` `rise`s; submit → Button `primary` `aria-busy` ("Entrando…" crossfade).
- **not-a-member**, **error**, **not-found** — card reveal; Buttons.

### 5.11 `theme-gallery` (VR baselines)

- Root layout sets `data-motion="off"` on `<html>`; `brand.css` maps it to the same
  zero-duration rule as reduced motion, so Playwright baselines stay stable.
- New fixtures: `controls` (every Button variant × state, Switch, SegmentedControl, Toast
  stack, Skeleton, Menu open) and `nav` (BottomNav with sheet open, SectionNav). Existing
  `dialog`, `planner`, `kids-planner` fixtures pick up the primitives automatically.
- A second, motion-on spec captures one frame at t=0 and t=end of the sheet enter to catch a
  broken transform (the fixed-ancestor trap) rather than a wrong pixel.

## 6. Phasing (each phase = one PR, `preview` first, fresh code review of the diff)

| Phase | Scope | Lands |
|---|---|---|
| **M0 Foundation** | tokens, global reduced-motion rule, `motion` dep + `MotionProvider` in `Provider.tsx`, all §4 primitives, `template.tsx` + `Reveal`, gallery `controls` fixture, ADR-0031, `docs/MOTION.md`, guard tests (`motionImportBoundary`, `motionTokens`, `bottomNavOffsetSync`, raw-duration scan), bundle baseline | nothing visible changes yet except CueDialog animating and skeletons shimmering |
| **M1 Shell** | §5.0 in full: BottomNav resurrected, Navbar indicator, NavMenu `Menu`, SectionNav, banner, AudioPlayer, SongSheet, Toast viewport wired | the app feels different on the phone from this PR on |
| **M2 Home + Library** | §5.1, §5.4, §5.5 | |
| **M3 Song** | §5.3 | |
| **M4 Schedule** | §5.2 | |
| **M5 Me** | §5.6 | |
| **M6 Proposals** | §5.7 | |
| **M7a Admin shell** | §5.8 TabBar, members, ServicesPanel, ReadinessCard, SongFormModal, Collapse adoptions | |
| **M7b Planner + Generator** | §5.8 PlannerGrid, SetlistEditor, MonthGenerator | the riskiest diff — ADR-0012 and `plannerGridDrag.test.tsx` hooks must hold |
| **M8 Kids** | §5.9 | |
| **M9 Auth + errors + gallery `nav`** | §5.10, §5.11 remainder, delete `Header.tsx`, delete `.animate-overlay-in` and the orphan `snap-start` key | |

Buttons migrate per phase (each phase converts the buttons on its routes), so the colour-
inventory artifact is regenerated per phase, never in one 305-site sweep.

## 7. Verification (per phase, in this order)

1. `npx tsc --noEmit`, `npm test`, `npx eslint .` with 0 errors.
2. `node scripts/colour-inventory.mjs` regenerated and `colourInventory.test.ts` green.
3. **Bundle:** `next build` first-load JS for `/` and `/admin` compared to the M0 baseline; cap
   **+25 kB gz** total for the whole programme (M0 spends ~18 of it).
4. **Gallery VR** (`playwright.vr.config.ts`) against a local server, motion off.
5. **Reduced motion:** the `controls` fixture rendered with `prefers-reduced-motion: reduce`
   emulated — no transform in any computed style, dialogs still open and close.
6. **iOS 15 floor:** the iOS Simulator (available on this Mac) at the oldest installed
   runtime: open a sheet, drag it closed, switch tabs, play audio, toggle Reduce Motion in
   Settings; 60 fps in the Xcode FPS overlay during the sheet spring.
7. **Push `preview`, verify the dev alias moved**, then `scripts/dev-verify.ts` screenshots
   (dark and light) of every route the phase touched, plus the a11y tree of one dialog open.
8. Fresh code review of the merge range; re-verify the fix range; PR to `main`; verify the
   production alias.

## 8. Documentation delivered with the work

- `docs/adr/0031-motion-library-under-an-ios-15-floor.md` — why `motion`, why lazily, the
  import boundary, the iOS 15 check.
- `docs/MOTION.md` — tokens, principles, the primitive catalogue with when-to-use, the
  fixed-ancestor trap, how to add a fixture.
- `docs/UTILITIES_AND_COMPONENTS.md` and `CLAUDE.md` "Reusable utils": Button, Toast/useToast,
  Presence, Collapse, SegmentedControl, Reveal, haptics.
- `docs/ROUTES.md`: BottomNav returns; `docs/MOBILE.md`: `@capacitor/haptics` and the tab
  bar's safe-area contract. No secrets or env vars are introduced.

## 9. Decisions Frank should confirm (assumptions the spec proceeds on)

- **A. Add `motion` as a dependency** (recommended, §3). Alternative: CSS-only + hand-rolled
  presence/FLIP hooks, ~150 lines of owned animation code and no interruption handling.
- **B. Resurrect `BottomNav` as the phone navigation.** Removed in `a03c3859` with no recorded
  reason. The spec treats its absence as the single biggest gap between "web page" and "app"
  on the iPhone. If it was removed for a reason, that reason belongs in an ADR and M1 drops it.
- **C. Route transitions are enter-only.** Exit transitions between routes need the View
  Transitions API (iOS 18) or a client-side router shim; neither fits ADR-0030. Enter-only
  with the beam rail is the honest version.
- **D. Add `@capacitor/haptics`** for drop, toggle and tab taps (native only, no-op on web).
  Small, but a new native plugin means an iOS rebuild.
- **E. Give `/author` and `/author/[slug]` the `brand-song-hero`** so the library's three
  entry points (tags, authors, songs) share one hero grammar.
- **F. Theme switch stays a hard swap**, not a crossfade (§5.6) — cost and next-themes
  interaction. Say so if you want the crossfade anyway; it is a one-line rule with a frame
  cost on old phones.

## 10. Out of scope

- Any change to what the pages *do*: writers, routes, data, notifications, the solver.
- Touch drag on the planner grid (ADR-0012 DD8) and edge auto-scroll (DD9).
- A visual redesign of the palette or type — the token system from ADR-0016 stays as is.
- Studio (`/studio`) — Sanity's own UI.
- The email templates (deliberately light, see CLAUDE.md).

---

# Part II — Remakes (proposed 2026-09-08 after looking at the live screens)

Part I is a motion layer over today's layouts. After screenshots of the real routes on dev
(phone 390×844 and desktop 1440×900, dark), six of those layouts are what stop the app from
feeling premium, and no amount of easing fixes a layout. Part II proposes remaking them.
**Nothing in Part II changes a writer, a route contract, a query filter, or the data
model** — every remake is a re-composition of reads the pages already do.

## 11. What the screens actually show

| Screen | Observation | Consequence |
|---|---|---|
| `/` phone | The page is **34,045 px tall**: "Esta semana" then all 142 songs as ~230 px cards, each repeating a `REPERTORIO` eyebrow and a `VER` affordance | The home page is the library. Nobody scrolls it; the search box is the only usable entry |
| `/` desktop | One DayCard centred at ~760 px inside a 1440 px viewport, heading left-aligned above it | The most important object on the site floats in empty space, misaligned with its own heading |
| `/schedule` phone | The screenshot is **417 px wide on a 390 px viewport** — the `min-w-[13rem]` month heading pushes the Anterior/Siguiente buttons off-screen; three full month grids for four service days | Horizontal overflow bug on every phone; ~90 % of the cells carry no information |
| `/me` phone | Three month grids of availability before the member's own identity card; theme and text-size cards are two more framed boxes of pills | The page is upside down: settings and calendars first, "who am I and when do I serve" last |
| `/admin` desktop | Frame → shell → tabs bar → workspace → panel → card: five nested bordered surfaces before content | "Box in box in box" is the single strongest signal of non-premium UI |
| `/tag` phone | Three pinned tiles, then **40+ identical two-column boxes** | A wall of boxes; counts are the only information and they are hidden in small caps |
| `/posts/[slug]` | Good bones: hero, key dial, sticky section nav | Keep; extend into a practice surface (§12.7) |
| Global | The diagonal beam atmosphere, the condensed display face, the lit section rail, the `KEY │ Name` instrument chips | These are the identity. Keep all of them. Part II adds no new colour or type |

## 12. The remakes

Subject grounding: this is a **run sheet for a stage team**. What a worship member wants
on a phone on Thursday night is: *when do I serve, what do we play, in what key, and can I
practise it now*. Every remake below optimises for that sentence.

### 12.1 Home → the run sheet (`/`)

The home page becomes the next service, and only the next service, above the fold.

```
┌──────────────────────────────────────────────┐
│ ▍ESTA SEMANA                                 │
│                                              │
│ DOMINGO 13 SEP              ┌──────────────┐ │
│ en 5 días                   │ ▶ ENSAYAR    │ │  ← practice playlist as the hero action
│                             └──────────────┘ │
│ ──────────────────────────────────────────── │
│ 01  Amor Sin Condición     G   144  ▍▍▍      │  ← run sheet: order · title · key · BPM
│ 02  Alaba (Praise)         A   127  ▍▍       │
│ 03  Anclado (Anchor)       E    73  ▍        │
│ ──────────────────────────────────────────── │
│ VOCES   ● Jakey ● Marianne  ◦ Lucía ◦ Hugo   │  ← avatar stack, lit ring = you
│ INSTR   BASS│Mkz  KEYS│Sofi  DRUMS│Tony …    │
└──────────────────────────────────────────────┘
│ ▍SÁBADO 19 SEP · en 11 días        (collapsed)│
```

- Numbered rows are justified here: a setlist **is** a sequence.
- The `ENSAYAR` action is `PracticePlaylistButton` promoted; playing walks the run sheet and
  the active row carries the equaliser bars from §5.3.
- Saturday and any special service collapse to a one-line header (`Collapse`).
- **The library leaves the home page.** It gets its own route and tab (§12.2). Home drops from
  34,045 px to roughly two screens on a phone.
- Desktop: the run sheet spans the container; team on the right column. No centred card.

### 12.2 Library → an index, not a wall (`/biblioteca`, new route; `/tag`, `/author` fold in)

```
┌──────────────────────────────────────────────┐
│ 🔍 Buscar por título, autor o tonalidad     ⌥ │  ← ⌥ opens the filter drawer (tags, tipo, key)
│ ▍142 TÍTULOS · ordenado A–Z                  │
│ A                                            │
│ ▌A  Alaba (Praise)            Elevation  127 │  ← one 56 px row per song: key · title · artist · BPM
│ ▌C  Alabaré Al Señor          Hillsong    72 │
│ ▌G  Amor Sin Condición        Barrientos 144 │
│ B                                            │
│ …                                            │
└──────────────────────────────────────────────┘
                                          A B C D … ← sticky letter rail (phone: right edge)
```

- Row tap → `SongSheet` (exists). Long-press → quick actions sheet (Ensayar, Letra, Acordes,
  Copiar tonalidad) with a light haptic.
- Tags become a **filter drawer** on this route, not a page of boxes: pinned Tipo as three
  large segmented tiles, the 40 themes as chips sized by count in a flowing row. `/tag` and
  `/tag/[slug]` redirect into `/biblioteca?tag=`; `/author/[slug]` into `/biblioteca?author=`
  (both keep working — they are 301s, no data change).
- Filtering animates with `layout` (rows slide to place, leavers fade) — this is where the
  Part I list motion earns its keep, at 56 px per row instead of 230.
- Bottom tab: Inicio · **Biblioteca** · Calendario · Yo · Más.

### 12.3 Schedule → agenda strip (`/schedule`)

```
┌──────────────────────────────────────────────┐
│ ◂  SEPTIEMBRE 2026  ▸            [Mes][Lista] │
│  L   M   X   J   V   S   D                    │
│  7   8   9  10  11  12  ●13   ← week strip, swipeable, service days lit
│ ──────────────────────────────────────────── │
│ DOM 13 SEP · en 5 días                       │
│   Lead Jakey, Marianne · Keys Sofi · 5 canc. │  ← agenda: service days ONLY
│ SÁB 19 SEP · en 11 días        ⚠ 1 conflicto │
│ DOM 20 SEP                                   │
│ DOM 27 SEP                                   │
└──────────────────────────────────────────────┘
```

- Month view stays as a second mode for planning; the agenda is the default on phone.
- Swipe left/right between months (touch, `motion` drag with snap); the strip slides.
- Fixes the overflow bug by construction (no fixed-width heading).
- Tap a day → the existing sheet.

### 12.4 Me → "Mi semana" (`/me`)

Reordered top to bottom:

1. **Identity header** — avatar, name, roles, and the one line that matters: *"Te toca el
   domingo 13 · Lead"* with a countdown (`NumberRoll`). Editar perfil as a ghost button.
2. **Próximos servicios** — the DayCards the member is on, compact.
3. **Disponibilidad como fines de semana** — the team serves on weekends, so the default
   control is a list of the next 8–12 weekends, each a `SÁB │ DOM` pair of toggles with the
   service badge when one exists. The three-month grid moves behind "Ver calendario"
   (`Collapse`). Saves stay on the same PATCH.
4. **Ajustes** — one card: Tema and Tamaño de texto as two `SegmentedControl`s, email
   preferences as `Switch` rows. Three framed boxes become one.

### 12.5 Control Room → flatten (`/admin`)

- Remove the outer frame: the page is the workspace. The tab bar becomes a **left rail on
  desktop** (icons + labels, active indicator slides vertically) and a segmented top bar on
  phone. Content sits directly on the page atmosphere; cards are the only boxes.
- Servicios: the month pills stay; the service cards become a **horizontal timeline board**
  on desktop (scroll-snap, one card per service, the readiness ring on each header) and the
  current vertical list on phone. `ParticipationSidebar` stays (it is good).
- Integrity strip: collapses to a single lit dot in the rail when OK; expands only when it
  has something to say.
- Planner grid and MonthGenerator: **no layout change** (ADR-0012, and they are dense on
  purpose); they receive Part I motion only.

### 12.6 Tags → gone as a page, kept as a drawer (§12.2)

### 12.7 Song page → "Práctica" (`/posts/[slug]`)

- **Sticky mini-header** on scroll: title · key · BPM · transport, replacing the navbar
  title slot (crossfade `fade`).
- **The key dial becomes the transposer**: tap the hero key → `SegmentedControl` of 12 keys
  slides open under it; the chart transposes with `NumberRoll` on the readout. The
  `ChordChart` transpose buttons remain for keyboard users.
- **Tap tempo on the BPM pill**: tapping it starts a visual click — the pill's ring pulses
  at the song's BPM (`scale` keyframe, period = 60000/BPM ms, stops on second tap or when
  leaving the page). Subject-true ambient motion; a metronome is what a musician reaches for.
- **Autoscroll for the chart**: a play control on the Letra section scrolls at a speed
  derived from BPM and section length; pauses on touch. Uses `requestAnimationFrame` +
  `scrollTo`, no library.

### 12.8 New, app-wide

- **Navbar as cue strip**: on every route but home, the centre slot shows the next service
  countdown in small caps (`DOM 13 · EN 5 DÍAS`) under the page title. It is the one piece
  of state a team member always wants.
- **Blackout on sign-out**: the page dims to the base surface over 320 ms before the redirect
  — the stage vocabulary's exit, used once.
- **Pull-to-refresh** on the phone (native-feel `motion` drag on `<main>` with a lit rail
  as the indicator; calls `router.refresh()`).
- **Long-press quick actions** on song rows and DayCard rows (haptic, sheet).
- **`REPERTORIO` eyebrows and `VER` affordances removed** from every song card/row: the
  row is the affordance.

## 13. What Part II does not change

- Writers, API routes, notification triggers, the solver, Sanity schema: untouched.
- The colour tokens and the type: untouched (ADR-0016 stands).
- ADR-0012 planner constraints: untouched.
- `/tag`, `/author` URLs keep resolving (redirects), so nothing bookmarked breaks.

## 14. Phasing if Part II is approved

Part I M0–M1 stay first (foundation + shell, now with the Biblioteca tab). Then remakes
replace the per-route motion phases where they overlap:

| Phase | Scope |
|---|---|
| R1 Home + Biblioteca | §12.1, §12.2, redirects from `/tag*` and `/author*`, §12.8 eyebrow removal |
| R2 Schedule | §12.3 |
| R3 Me | §12.4 |
| R4 Song | §12.7 + Part I §5.3 |
| R5 Control Room | §12.5 + Part I §5.8 (M7a); M7b (planner) unchanged |
| R6 Kids, auth, errors, gallery | Part I §5.9–§5.11 |
| R7 App-wide | §12.8 cue strip, blackout, pull-to-refresh, long-press |

Each remake phase is its own spec section and its own implementation plan; the verification
ladder in §7 applies, plus a **before/after screenshot pair per route on dev** committed
under `docs/superpowers/specs/2026-09-08-premium-motion-shots/`.

## 15. Decisions added by Part II

- **G. Library leaves the home page** and gets its own route and tab. This is the largest
  single change and the one with the clearest payoff.
- **H. `/tag` and `/author` become a filter drawer** with redirects. Say no if you want the
  pages to stay; §12.2 still works without the redirects.
- **I. Availability defaults to a weekend list**, with the month grid behind a disclosure.
- **J. Admin gets a left rail** on desktop and loses the outer frame.
- **K. Song page gains transposer-in-hero, tap-tempo and chart autoscroll** — three real
  features, not motion. Each can be dropped individually.
- **L. Pull-to-refresh and long-press quick actions** — phone-only conveniences.

---

# Part III — Element audit from a full walk of production (2026-09-08, 10:15–10:50 CST)

Method: signed in as Frank on `owt-backstage.vercel.app` in Chrome (1374×782), every route
and every admin tab, every dialog shell (Cue card, Cue sheet, Nueva canción, Generar mes,
the month editor, Más acciones menu, the avatar menu), plus the read-only verifier on dev at
390×844 for the phone menu, the bottom sheet, the song page and the kids planner, and both
themes. No writes. Songs share one template, so one song with lyrics and one row of the
Contenido list stood in for the 142.

Part III corrects Part II where the walk contradicted it, then catalogues every element type
in the app with its premium treatment. Part I's primitives still carry it; Part III adds
three (`Select`, `DateField`, `Checkbox`) because the walk found the single biggest
premium-killer that neither Part I nor Part II named.

## 16. What the walk found that the screenshots had not

| # | Finding | Evidence | Severity |
|---|---|---|---|
| 1 | **Native form controls everywhere.** 31 `<select>` sites in 12 files, 3 native `date`/`month` inputs, 5 native checkboxes. The schedule's month picker, the planner's per-column date inputs, the participation sidebar's "Voces" select, the kids pair roster's room selects, and the members list's "Deshabilitar acceso (kill switch)" checkbox all render the browser's default control inside a tokenised dark UI | `/schedule`, `/admin?tab=services` (editor), `/kids/admin`, `/admin?tab=members` | **Highest.** Nothing else undoes the identity as completely |
| 2 | **Label noise.** 482 uppercase-tracking eyebrow labels. A DayCard inside the day sheet stacks `CUE → Detalle del día → SERVICIO → DOMINGO → EQUIPO → VOCES` before the first name. Every song card repeats `REPERTORIO` and `VER`; every dialog repeats `CUE` | day sheet on `/schedule`, every card | High |
| 3 | **The lockup mark lazy-loads.** `Navbar.tsx:23` renders the brand mark with `next/image` defaults (`loading="lazy"`), so every navigation paints an empty rounded square first, then the logo. Visible in 9 of 22 captures | all routes | High (it is the first thing on every page) |
| 4 | **Admin shell overflows its box.** `.brand-admin-shell` measures `scrollWidth 1358` vs `clientWidth 1230` with `overflow-x: hidden`; a programmatic `scrollIntoView` shifted the whole workspace 128 px left and it stayed there. The page itself does not scroll, so it hides | `/admin`, JS-measured | Medium (latent) |
| 5 | **The initials avatar is invisible in light theme.** `NavMenu.tsx:129-130` paints a `bg-surface-accent-solid` disc with `text-accent` initials; in light both resolve to navy | `/` light, `/admin` light | Medium |
| 6 | **Tutorial iframes paint white.** The one `<iframe>` (YouTube embeds) shows a white block until the player loads, on a dark page | `/posts/[slug]` | Medium |
| 7 | **The avatar menu is a plain text list** with no icons, no grouping, no animation; `transition: all` is set but nothing changes | all routes | Medium |
| 8 | **Lyrics are unstyled.** `Verso 1`, `Coro`, `Puente` render as ordinary lines; on desktop the block sits at x≈400 with the right two-thirds empty | `/posts/[slug]`, SongSheet | Medium |
| 9 | **Three DayCards in a row on /me**, each ~500 px, before the availability calendar | `/me` | Medium |
| 10 | **ThemeAnnouncement** (a feature shipped in August) still opens `/me` for anyone who has not dismissed it | `/me` | Low |
| 11 | **Contenido already has the row grammar** Part II proposed for the library: icon · title · artist · tag chips · key badge, ~70 px per song. The library remake is a promotion of an existing pattern, not an invention | `/admin?tab=content` | Confirms §12.2 |
| 12 | **Sign-in is the best page in the app** and the only one with an entrance. Its stagger is the reference for the route reveal | `/auth/signin` | Confirms §5.10 |
| 13 | **Bottom sheet works but does not move:** grab handle drawn, no drag, and a redundant `CERRAR` text button under the `×` | `/schedule` phone | Confirms §4 |
| 14 | **/kids is empty in production** (no published Sundays) and the kids planner is 5,067 px tall on a phone | `/kids`, `/kids/admin` phone | Low |

## 17. Corrections to Part II

- **§12.2 Library rows:** adopt Contenido's row (`ContentPanel.tsx`), not a new design; add
  the key badge at the left, the tag chips collapse to `+N` on phones.
- **§12.3 Schedule:** the month input is not a layout problem, it is a native control
  (Finding 1); it becomes the `DateField` month strip, and the Anterior/Siguiente buttons
  become icon buttons at the strip's ends.
- **§12.5 Control Room:** Finding 4 means the flatten must also remove the
  `overflow-x: hidden` shell and let the planner grid be the only horizontal scroller.
- **§12.8 Cue strip:** the navbar title slot already changes per route (`OWT`, `CALENDARIO`,
  `CONTROL ROOM`, the song title); the countdown joins as a second line, so no new slot.

## 18. Label budget (new rule)

One eyebrow per surface. The section rail heading keeps its eyebrow (`PROGRAMACIÓN`,
`BIBLIOTECA`); cards and dialogs lose theirs. Concretely:

| Label | Today | After |
|---|---|---|
| `CUE` on every dialog | 13 dialogs | gone; the dialog title is the header |
| `SERVICIO` on every DayCard | every card | gone; `DOMINGO · 13 SEP` is the header |
| `EQUIPO` + `VOCES` / `INSTRUMENTOS` | every card | `VOCES` and `INSTRUMENTOS` stay as the only two rails |
| `REPERTORIO` + `VER` on song cards | 142 cards | gone; the row is the affordance |
| `ÍNDICE MUSICAL · 142 canciones disponibles` + `142 TÍTULOS` pill | library | one count, in the search console placeholder |
| `BACKSTAGE OPERATIONS` / `Servicios, equipo y contenido desde una sola consola.` | admin | gone; `Control Room` alone |
| `ACCESO AUTORIZADO` pill | admin | gone (a manager knows they are authorised) |

## 19. Element catalogue — every element type, what it does today, what it becomes

Legend: **T** = today, **P** = premium treatment, **Prim** = primitive that owns it.
Motion vocabulary from §2.3; nothing here adds a colour or a face.

### 19.1 Shell

| Element | T | P | Prim |
|---|---|---|---|
| Brand lockup (mark + wordmark) | lazy image, blank square on first paint; hover ring | `priority` + `fetchpriority=high`, no flash; press sink; the mark's glow (`brand-lockup-mark`) brightens 120 ms on hover | Button (link) |
| Navbar title slot | route name in caps, static | route name + second line countdown (`DOM 13 · EN 5 DÍAS`), crossfades on navigation | Reveal |
| Avatar button | 36 px image or initials disc, ring on hover; initials invisible in light | 40 px, initials on `text-on-fill`, ring `fast`, badge `pop` | Button (icon) |
| Avatar menu | plain list, `absolute` panel, no animation | `Menu`: scale-from-corner 200 ms, icons per item, grouped (Yo · Equipo · Kids · Admin · Salir), arrow-key focus; on phone it is the `Más` sheet | Menu |
| Bottom tab bar (phone) | none | Inicio · Biblioteca · Calendario · Yo · Más; `layoutId` pill; haptic tap; safe-area | new |
| Section rail heading | 2 px accent rail, static | rail draws `scaleY` 0→1 over `reveal`; eyebrow fades in after | Reveal |
| Page atmosphere (diagonal beam) | static gradient | stays static (ambient motion here would be the AI-default look) | — |
| SectionNav (song page) | underline jumps, active pill can be off-screen | `SlidingIndicator`, active pill centres itself | Tabs |
| ImpersonationBanner | appears instantly | slides down `slow`; height measured after | Presence |
| Audio transport | appears instantly, `width` progress | `sheet` spring in/out; `scaleX` progress; equaliser bars on the playing track | Presence |
| Toasts | 13 hand-rolled, instant | one viewport, `rise` in / `fade` out, above the tab bar | Toast |
| Skeletons | `animate-pulse` blocks | shimmer sweep (the beam) | Skeleton |
| Focus ring | ~62 of 305 buttons | every control | Button |

### 19.2 Cards and rows

| Element | T | P | Prim |
|---|---|---|---|
| DayCard header (`DOMINGO`, date, pills) | eyebrow + title + long date + 2 pills | `DOMINGO 13 SEP` display + countdown pill; long date dropped; header tint keeps its tone (accent / warning / info) | — |
| Instrument chip `KEYS │ Sofi` | two-cell chip; "you" gets a positive ring | keep; press on tap opens the member's row in the sheet; "you" ring `pop`s on reveal | Button (pill) |
| Voice list (`LEAD / BGVS / CORO`) | three text columns | keep; names become inline avatar+name chips on desktop, text on phone | — |
| Setlist row (inside DayCard) | number · title · key | press, hover rail slides in, active-track equaliser | Button (ghost) |
| Song card (library) | 230 px card with eyebrow, `VER`, BPM, sig, tags | 56–72 px row: key badge · title · artist · BPM · tags (`+N` on phone); press; long-press quick actions | Button (row) |
| Key badge (`G`, `Gb`) | 40 px rounded square, accent text | keep; on the song hero it becomes the transposer trigger; flips with `NumberRoll` | NumberRoll |
| Tag chip (`#amor`) | small outlined pill | keep; press; in the filter drawer sized by count | Button (pill) |
| Count pill (`12 CANCIONES`, `142 TÍTULOS`) | many | one per surface (label budget) | — |
| Status pill (`Publicado`, `Borrador`, `PRÓXIMO`, `EN 5 DÍAS`) | static | tone transition `base` on change; countdown via `NumberRoll` | — |
| Member row (admin) | avatar · alias · name · email · chips · role pill · dot · kill-switch checkbox | kill switch moves into the row's `Menu` (destructive, confirmed); row press; role pill tone transition | Menu, Checkbox |
| Activity row | initials · name · "última actividad" · `ACTIVO` · chevron | `Collapse` on expand; chevron rotates `base` | Collapse |
| Content row (admin songs) | icon · title · artist · tags · key | becomes the library row (§17) | — |
| Availability entry (admin) | name · date chips · quoted reasons | date chips press → `Menu` (edit / clear); reasons collapse past two | Collapse |
| Service card (admin) | header tone, `Más acciones`, action button | readiness ring in the header; ring animates on state change; `Más acciones` → `Menu`; conflict border pulses once on reveal, never loops | Menu |
| Participation sidebar bar | segmented bar, static | segments grow `scaleX` on reveal; `NumberRoll` on the count | — |
| Kids Sunday card | `0 de 4 lugares`, `BORRADOR`, `PUBLICAR`, seat rows `Sin asignar / Cambiar ›` | seat rows press → `SeatPicker` sheet; assigned name crossfades; `PUBLICAR` → Button primary with `aria-busy` | CueDialog, Button |
| Banca pair chip | pill, `LE TOCA` label | draggable lift + landing beam (desktop); press → picker (touch) | — |
| Pair roster row | name · room `<select>` · `RETIRAR` | room → `Select`; `RETIRAR` → danger ghost with confirm `Menu` | Select, Menu |
| Empty state (`AÚN NO HAY DOMINGOS PUBLICADOS`, `Sin propuestas…`) | icon + caps line | keep; `rise` in; add the one action that fills it (`Planear Kids`) as a Button | Reveal |

### 19.3 Controls

| Element | T | P | Prim |
|---|---|---|---|
| Primary button (`+ NUEVO`, `INICIAR SESIÓN`, `GUARDAR`) | solid fill, hover tint | fill + press sink + hover sheen (pointer only) + `aria-busy` label crossfade | Button |
| Secondary (`GENERAR MES`, `EDITAR MES`, `RECARGAR`) | outline | outline + press; hover border to accent `fast` | Button |
| Ghost (`OCULTAR`, `CERRAR`, `VER`) | text | text + press; the redundant `CERRAR` under a `×` is removed | Button |
| Danger (`RETIRAR`, `RESOLVER CONFLICTO`) | red outline/fill | same physics, negative tone; confirm through `Menu` or dialog, never inline | Button |
| Icon buttons (`×`, `⋮`, `←`, `→`, `⛶`) | mixed sizes, some 24 px | 44 px hit target on phone, 36 px desktop, press, focus ring | Button (icon) |
| Segmented (`CALENDARIO / LISTA`, `POPULAR / A–Z`, `TIPO / ROL`, `A→Z / Z→A`, theme, text size, proposals filters) | two spellings of the same thing | one `SegmentedControl` with a sliding thumb | SegmentedControl |
| Admin tab bar | pill tabs, jumps | `SlidingIndicator`, panel crossfade; left rail on desktop (§12.5) | Tabs |
| Month pills (`PRÓXIMOS`, `SEP 26`, `ROLES PREVIOS ▾`) | pills + disclosure | segmented + `Menu` for previous months | SegmentedControl, Menu |
| `<select>` (31 sites) | native | `Select`: styled trigger, `Menu` popover with search when >8 options, keyboard type-ahead; native `<select>` kept as the phone fallback under `@media (pointer: coarse)` because iOS's picker wheel is the better control there | **Select (new)** |
| `<input type="month">` / `type="date"` (3 sites) | native | `DateField`: month strip with prev/next, or a `Menu` calendar; the planner's per-column date stays an inline editable text with a calendar `Menu` | **DateField (new)** |
| Checkbox (5 sites) | native | `Checkbox`: 20 px box, check draws `scale` 0→1 `base`; the kill switch also gets a confirm | **Checkbox (new)** |
| Switch (`EmailPrefToggles`, `Mostrar acordes`) | knob slides | knob spring; haptic | Switch |
| Search console | input with icon | focus glow `fast`; clear button `pop`s in when non-empty; results `layout` | — |
| Textarea (proposal notes, thread) | native | tokenised border/focus; auto-grow | — |
| Calendar day cell | number, tone square when a service exists | press `pop`; service cell carries a 2-px dot row (one per service); today ring pulses once | Button (icon) |
| Availability day toggle | number, dot when marked | press `pop` + 120 ms fill crossfade; marked dot `pop`s | Button (icon) |
| Dot pager | four dots | `layoutId` thumb | SegmentedControl |
| Legend swatches | square swatches | inline dots matching the day-cell dots | — |
| Disclosure (`Recurrente`, `Roles previos`, integrity strip, activity rows) | instant | `Collapse` | Collapse |
| FAB (song edit, phone) | instant | `pop` in; hides while a sheet is open | Presence |
| Planner cell / chip | border tone on drop target, `opacity-30` while dragging | dashed valid-target pulse, custom drag image, landing beam, `settle` spring, picked-chip breathing ring | — |
| Planner column date | native date input | inline text + calendar `Menu` | DateField |
| Planner full-screen | instant | `scale 0.98→1` + fade | Presence |

### 19.4 Overlays

| Element | T | P | Prim |
|---|---|---|---|
| Cue card dialog | instant, `CUE` eyebrow, `×` | scale 0.96→1 + fade `slow`; eyebrow gone | CueDialog |
| Cue sheet (phone) | instant, handle drawn, `CERRAR` + `×` | spring up; drag-to-dismiss from the whole head (handle + title bar, since 2026-09-09); one close control (`×` stays — keyboard, VoiceOver and the ≥640px card have no drag — and the `CERRAR` footer goes); content is the card itself (no stacked headers) | CueDialog |
| Backdrop | `scrim/0.68 + blur` instant | fades `base`; blur stays (it is cheap when not animated) | CueDialog |
| Hand-rolled modals (`SeatPicker`, `SongFormModal`, proposal confirm) | three shells | all on `CueDialog` | CueDialog |
| Menus (`Más acciones`, avatar, practice playlist, note popover) | instant | `Menu` | Menu |
| Toast | instant | `Toast` | Toast |

### 19.5 Content

| Element | T | P | Prim |
|---|---|---|---|
| Song hero (title, artist, key/BPM/sig) | centred stack, chips above | stagger reveal; key → transposer; BPM → tap-tempo (§12.7) | Reveal, NumberRoll |
| Lyrics block | plain lines, `Verso 1`/`Coro` inline, left third of the page | section labels become rail eyebrows (`VERSO 1`, `CORO`, `PUENTE`), the block centres at a 62 ch measure, repeat markers (`//`) styled as a dim glyph; chord chart on top when present | — |
| Tutorial embeds | white iframe flash | poster facade with a play button; iframe mounts on press (also saves the network) | Presence |
| History cards (`Última vez tocada`) | card list | reveal stagger; row press opens the day sheet | Button (row) |
| Proposal thread messages | list | `rise` in per message | Presence |
| Planner rule notes (`Niza: Regla: no puede coincidir con Hugo`) | red text under the chip | inline warning chip with a `Menu` explaining the rule | Menu |
| Sign-in card | beam + facet panel, already staggered | keep; the reference implementation for `Reveal` | Reveal |

## 20. Phase deltas from Part III

- **M0** adds `Select`, `DateField`, `Checkbox`; fixes Finding 3 (lockup `priority`) and
  Finding 5 (initials contrast) as part of the shell; ships the label budget as a
  `labelBudget.test.ts` that counts `uppercase tracking-widest` inside `ui/` primitives'
  consumers and fails above the audited baseline.
- **M0b-1** removed the redundant `CERRAR` and added drag-to-dismiss (from the whole head since 2026-09-09); **M1** collapses stacked headers.
- **R1** promotes Contenido's row to the library (not a new design).
- **R2** replaces the month input with `DateField`.
- **R5** removes the admin shell's `overflow-x: hidden` and the five-frame nesting together.
- **M7b** replaces the planner's per-column date inputs and the sidebar select.
- **R6** adds the tutorial poster facade and lyric section styling to the song page.

## 21. Decisions added by Part III

- **M. Ship `Select` / `DateField` / `Checkbox` primitives** and migrate all 39 native
  control sites. On phones the native `<select>` picker is kept behind the styled trigger.
- **N. Label budget:** one eyebrow per surface; `CUE`, `SERVICIO`, `REPERTORIO`, `VER`,
  `ACCESO AUTORIZADO` and the admin subtitle go.
- **O. Kill switch moves into a confirmed menu** instead of a bare checkbox on every member
  row. Same write, one more click, no accidental disable.
- **P. Tutorial embeds become poster facades** (click-to-load). Saves ~1 MB per song page
  and removes the white flash.

---

# Part IV — Decision ledger

Approved by Frank on 2026-09-08 (10:36–10:40 CST), one question per decision, all with the
recommended option:

| # | Decision | Verdict |
|---|---|---|
| A | `motion` library, lazy, ui/-only import boundary, ADR-0031 | Approved |
| B | Resurrect BottomNav: Inicio · Biblioteca · Calendario · Yo · Más | Approved |
| C | Route transitions enter-only | Approved |
| D | `@capacitor/haptics` | Approved |
| E | Author pages get `brand-song-hero` | Approved |
| F | Theme switch stays a hard swap | Approved |
| G | Library leaves home → `/biblioteca` route + tab | Approved |
| H | `/tag*`, `/author*` → filter drawer with redirects | Approved |
| I | Availability defaults to a weekend list; grid behind a disclosure | Approved |
| J | Control Room: no outer frame, left rail on desktop, snap board | Approved |
| K | Song page: transposer in hero, tap-tempo, chart autoscroll (all three) | Approved |
| L | Pull-to-refresh and long-press quick actions on phone | Approved |
| M | `Select` / `DateField` / `Checkbox`; migrate all 39 native sites | Approved |
| N | Label budget: one eyebrow per surface | Approved |
| O | Kill switch moves into a confirmed row menu | Approved |
| P | Tutorial embeds become click-to-load posters | Approved |

Next step: implementation plan for phase M0 (foundation), then M1, R1… per §6 and §14 with
the §20 deltas. Each phase is its own PR through `preview` then `main`, with a fresh code
review of the diff.

---

# Part V — Reference check: libraries.dev (2026-09-08, 11:00 CST)

Frank asked for libraries.dev to be reviewed for proposals. It catalogues five MIT effect
packages for React 18+: `border-beam` (an animated glow riding a border), `thinking-orbs`
(loading orbs for AI chat), `liquid-gooey` (elements merge like liquid), `metal-fx` (a
real-time chrome ring on buttons) and `img-fx` (a WebGL image-generation loader on `three`).
Together ~83 kB gz.

## 22. Verdict

**Do not add any of the five as dependencies.** Three reasons, each sufficient:

- **Budget.** The programme's whole cap is +25 kB gz (§7); `border-beam` alone would spend
  most of it and `img-fx` brings `three`.
- **Floor.** Nothing on the site states a Safari floor; the gooey and metal effects lean on
  filters and shaders that are exactly the frame-droppers §2.2 bans on iOS 15 WebViews.
- **Register.** Orbs, goo and chrome are the vocabulary of AI-chat and landing pages. This is
  a run sheet for a stage team; §2.1 spends the app's one flourish on the beam and keeps
  everything else quiet. Adding a second, louder vocabulary is the "AI-generated look" the
  spec is written against.

## 23. The one idea worth harvesting — decision Q

`border-beam`'s gesture — a light travelling the edge of a card — is already this app's
metaphor. Harvested CSS-only, with the tokens, it becomes the **lit card**: after the route
reveal on `/` (§12.1), the next service's card gets ONE beam pass around its border, 900 ms,
`--ease-in-out`, then rests with its existing accent border. Never a loop.

Implementation is a rotating pseudo-element under a border mask (transform only —
`@property`-registered angle animation is Safari 16.4, so the rotation is on the element,
not the gradient); ~30 lines in `brand.css`, a `data-lit` attribute set by the page.
It ships in R1 with the run sheet, and it is the FIFTH place the beam appears; §2.1's
"exactly four" becomes five, still enumerated, still one-shot.

**Q. Adopt the lit-card beam (CSS-only, R1) and decline the five packages.** Recommended.
Alternative: decline both — keep the four beam sites and no lit card.

**Approved by Frank 2026-09-08 11:03 CST.** Q joins the Part IV ledger; R1 carries the lit card.

---

# Part VI — After M0a (2026-09-08, 16:30 CST)

M0a shipped to production in PR #50 (`main` 4b218d61; production alias verified 16:31 CST, dpl_88mcKgSeV3Rjo69EAqDsYCXtk1X9). Measured in `docs/MOTION.md`: first-load
+12.4 kB gz on `/`, +12.5 kB on `/admin`, plus a 15.8 kB gz async motion-feature chunk. The
25 kB figure in §7 was written for a synchronous feature load and mis-estimated `domAnimation` at
18 kB; the whole-branch review moved the features to an async chunk, which is the only shape under
which M0b's layout animations (`domMax`) fit.

**R. Bundle cap, restated (coordinator's ruling, pending Frank's word):** §7's **+25 kB gz on
first-load JS** stands as written and is measured as MOTION.md measures it. A second line is added:
**the async motion-feature chunk is capped at 40 kB gz.** M0b measures `domMax` against that line
before adopting `layoutId`; if it does not fit, the sliding indicator is a measured CSS transform
without `layoutId`.

M0b rules learned in M0a: no `Presence appear` above the fold (features arrive after hydration);
the vendor feature loader has no rejection handling, so Toast/Menu/Collapse need a load-failure
fallback; the theme gallery mounts no MotionProvider, so its `controls` fixture must add a
gallery-side `LazyMotion` with `MotionGlobalConfig.skipAnimations` keyed off `data-motion="off"`;
new colour in a rule body is a composed token at every `--warning-glow` touch point; `Button` needs
`forwardRef` before `Menu` can use it as a trigger.

# Part VII — M0b-1 shipped

M0b-1 (overlays and controls — `CueDialog`, `Toast`/`useToast`, `Menu`/`MenuItem`/
`MenuSeparator`/`MenuHeader`, `Collapse`, the gallery's own `GalleryMotion`) is
implemented on branch `claude/motion-m0b-overlays-controls`; commit range
`603f1eb4..0219cc3e` and the two docs commits after it. Full reference in `docs/MOTION.md`
— primitives table, the "Load-failure behaviour" section (§Part VI's "Toast/Menu/Collapse
need a load-failure fallback" resolved: `Collapse`/`CueDialog` render already-open via
`initial={false}`; `Toast`/`Menu` animate in from `initial` since they only ever open long
after the feature chunk has had time to load; a `CueDialog` opened after mount before the
chunk lands is invisible while inerting the page), and the Guards table
(`cueDialogMount.test.ts`, `labelBudget.test.ts`).

**Deferred from M0b-1 → M0b-2, M1, M5–M8:** `SegmentedControl`, `SlidingIndicator`,
`Switch`, `Checkbox`, `Select`, `DateField`, `NumberRoll`, haptics and the `controls`
gallery fixture; the 11 literal-`open` `CueDialog` sites (tracked by `cueDialogMount.test.ts`)
deferred to their route phases; `AvailabilityCalendar`'s note popover → M5; `MonthGenerator`'s
held swap block → M7b; Kids inline statuses → M8; a `Menu`'s Escape inside a `CueDialog`
(`CalendarView`'s day sheet) → M0b-2; the 640 px viewport variant fixed at dialog open → M0b-2.

§Part VI's 40 kB gz async-chunk cap: `domMax` measured at **28.8 kB gz** (88.0 kB
raw) — under the cap, so the sliding indicator kept `layoutId`. See MOTION.md's
Bundle section for the full A/B measurement.
