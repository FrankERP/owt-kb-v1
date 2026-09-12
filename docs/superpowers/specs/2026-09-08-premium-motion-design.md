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
- **Navbar** — the inert `transition-[height]` goes. Lockup: press. Desktop gains an active-route underline via `SlidingIndicator` across the nav links rendered by NavMenu when signed in (Calendario · Tags · Yo · Admin) — as planned; shipped as the separate `NavLinks` row (Calendario · Biblioteca · Kids · Planear Kids · Admin by role) after F1/F2 made `NavMenu` account-only.
- **NavMenu** — avatar: press + ring `fast`; the dropdown becomes `Menu` (scale presence from the avatar corner, 200ms); notification badge pops in with `pop` spring when the count rises. **M1 follow-up F1:** with the tab bar and desktop nav links now covering every destination, NavMenu became a plain ACCOUNT menu at all widths — Mi perfil, Tema, a separator, Cerrar sesión — and no longer repeats Calendario/Tags/Oasis Kids/Planear Kids/Admin.
- **BottomNav — resurrected (decision B).** Phone-only tab bar: Inicio · Calendario · Biblioteca · Yo · Más (as planned; F2 removed «Yo» — three tabs ship). Active tab: icon lifts 2px and the label brightens; a `layoutId` pill slides between tabs; tap = haptic light. **M1 follow-up F1** moved Tags/Tema/Cerrar sesión out to NavMenu, so "Más" now opens a `Sheet` holding only what the tabs (four at the time, three since F2) cannot fit — Kids, Planear Kids, Admin — and does not render at all (no sheet; four tabs at F1, three since F2) when none of those apply. **M1 follow-up F2** then removed «Yo» from the tab bar itself — `/me` has one home, the avatar menu's Mi perfil — leaving three worship tabs (or Kids/Planear Kids); a bar with fewer than two items (tabs + «Más») now renders nothing at all. Safe-area bottom padding. Every fixed-bottom element (toasts, FAB, AudioPlayer) offsets by `--bottom-nav-h` published on `<html>` the way `--impersonation-h` is — same guard shape as `impersonationOffsetSync.test.ts`.
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
| Cue sheet (phone) | instant, handle drawn, `CERRAR` + `×` | spring up; drag-to-dismiss from the whole head (handle + title bar, since 2026-09-09); one close control: the grip itself (Frank, 2026-09-09) — the `×` is `sr-only` on the phone sheet for VoiceOver and keyboard, visible on the ≥640px card which has no drag; the `CERRAR` footer is gone; content is the card itself (no stacked headers) | CueDialog |
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
`MenuSeparator`/`MenuHeader`, `Collapse`, the gallery's own `GalleryMotion`) was
**released to production on 2026-09-09** via PR #52 (merge `2d635d38`, alias verified).
Branch `claude/motion-m0b-overlays-controls`, range `603f1eb4..0c478b5a`, of which
`e686fab3..0c478b5a` is the wave after Frank's dev look: 150 px drag threshold,
the whole head as the grip, the `×` `sr-only` on phone sheets, the day sheet's
`CERRAR` footer gone. Full reference in `docs/MOTION.md`
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

# Part VIII — M0b-2 controls (2026-09-09)

Branch `claude/motion-m0b2-controls` (from `main` 2d635d38), plan
`docs/superpowers/plans/2026-09-09-motion-m0b2-controls.md`. Thirteen tasks, each with a
fresh implementer and a task review; ten fix rounds in all, every one re-reviewed.
**Released to production on 2026-09-09** via PR #53 (merge `40fa9683`), after Frank's
look on dev found one pre-existing bug — opening the month editor from a card's
«Editar equipo» scrolled the admin shell instead of the grid (`scrollIntoView` reaching
an `overflow: hidden` ancestor) — fixed as `8f3dfc87` on the branch before the merge.

**Shipped.** Seven primitives under `app/components/ui/` and one util:
`SegmentedControl` (radiogroup, roving arrows, `layoutId` thumb — the reason M0b-1 paid
for `domMax`), `SlidingIndicator` + `useActiveIntoView` (tab bars), `Switch` (spring knob,
haptic, one off-state anchor for both sites), `Checkbox` (drawn box over the native input;
`align`, `tone`), `Select` (tokenised chrome over the native `<select>`, sizes `sm/md/lg`),
`DateField` (native date/month under the chrome; month steppers), `NumberRoll` (old value
rises out, new rises in), and `haptic(kind)` behind `@capacitor/haptics` (no-op on web;
`ios/` Package.swift regenerated; `docs/MOBILE.md` gains the plugin table).

**Migrated.** 11 segmented sites (theme, text size, Calendario/Lista, Popular/A–Z ×2,
Tipo/Rol, A→Z/Z→A, ministry scope, proposal filters with the pending badge, chart versions,
the participation view — the last was a `<select>`), 3 tab bars (admin `TabBar`,
`SectionNav`, `BottomNav` with the icon lift and a haptic), 2 switches, 5 checkboxes,
23 selects (9 + MonthGenerator's 14), 3 date/month inputs, 4 rolling values. **No native
`<select>`, `<input type="checkbox">`, `type="date"` or `type="month"` remains under
`app/**`** — decision M's 39 sites are the radio trio and the number/text inputs short of
complete, which are not M0b-2 primitives.

**Overlay follow-ups closed.** A `Menu` inside a `CueDialog` owns Escape (the dialog's
capture listener yields when the key's target is inside an open menu or on its expanded
trigger); the toast viewport is a persistent polite region with an always-mounted alert
mirror for errors; a sheet decides sheet-or-card on the open edge and holds it.

**Gallery.** `/theme-gallery/{dark,light}/controls` renders every primitive in every state
(hermetic, its own `ToastProvider`); `themeGallery.test.ts` pins five fixtures.

**Rulings taken during execution** (all in the plan's SDD ledger; each reversible):
`Select` ships the native half only — the desktop `Menu` popover with type-ahead goes with
the Control Room remake (§12.5); one `Switch`, one off-state, the higher-contrast anchor
(`mono-300` light / `mono-600` dark) for both sites, and `brand.css`'s white/black census
now counts six literals; `Checkbox` takes `align` because a same-property utility passed
through `className` cannot beat one the primitive sets; the rule editor's nine selects use
`size="sm"` and the two narrowest widened; `NumberRoll`'s host is positioned so the exiting
value is clipped; `useActiveIntoView` scrolls on activation only, never on mount.

**Bundle — the cap, decided.** Measured cold, same environment,
identical script (`docs/MOTION.md` §Bundle): `e9d90327` (M0b-1 Task 1, mid-branch) `/`
85.5 kB · `/admin` 310.3 kB; `2d635d38` (the M0b-1 merge) 110.3 · 335.3; M0b-2 tip
110.2 · 336.8. So **M0b-1's own shipped cost was +24.8 / +25.0 kB gz** — the ledger's
87.9/307.1 row had been measured before `Toast`, `Menu`, `Collapse` and the expanded
`CueDialog` landed — and **M0b-2 adds −0.1 / +1.5 kB**. Against "Before M0a"
(77.3 / 301.7) the absolute delta is **+32.9 / +35.1 kB gz, over §7's +25 kB line.**
**Frank accepted the number on 2026-09-09 ("merge, accept"):** +32.9 / +35.1 kB gz is the
programme's recorded cost and supersedes §7's +25 kB line and ruling R's first clause;
the 40 kB async line stands. The
async feature chunk cannot be isolated at the tip (Turbopack fused it with Studio code into
one async chunk that no first-load path references), so the 40 kB async line has no figure
at this commit.

**Deferred → later phases:** the desktop `Select` popover (§12.5); the kill-switch confirm
(decision O → Control Room); `SongSheet`'s hand-rolled header (→ M1); the 12-key transposer
strip (→ Song page, decision K); `ServicesPanel`'s multi-select month pills (not a
segmented control; → §12.5); a dev warning when `SegmentedControl` gets neither `label` nor
`labelledBy`; `DateField`'s `label`/`id` typing to match `Select`'s union.

# Part IX — M1 Shell (2026-09-09)

Branch `claude/motion-m1-shell` (from `main` 5d214bbf), plan
`docs/superpowers/plans/2026-09-09-motion-m1-shell.md`. Eight tasks, each with a fresh
implementer and a task review; five fix rounds, every one re-reviewed; one final fix wave
after the whole-branch review.

**Shipped (§5.0 in full, less what earlier phases had done).** `BottomNav` returns
(decision B): Inicio · Calendario · Biblioteca · Yo · Más for worship members, Kids ·
Planear Kids · Yo · Más for a kids-only member — **superseded the same day by F2**: «Yo»
left both bars (its one home is the avatar menu), leaving Inicio · Calendario · Biblioteca
or Kids · Planear Kids, and a bar with fewer than two items does not render; «Más» is a `CueDialog` sheet (Kids,
Planear Kids, Admin, Tema → `/me#tema`, Cerrar sesión, conditioned by role and ministry)
— **superseded the same day by task F1** (below): Tema and Cerrar sesión moved to
`NavMenu`, so «Más» now holds Kids/Planear Kids/Admin only and does not render at all
when none apply. The bar publishes its MEASURED height as `--bottom-nav-h` (px) plus `has-bottom-nav` on
`<html>` while on screen, the route main pads under it, toasts clear
`max(inset, bar)`, the audio transport sits flush on the bar, the song FAB offsets by the
variable — `bottomNavOffsetSync.test.ts` pins the halves. Desktop: `NavLinks` (Calendario
· Biblioteca · Kids · Planear Kids · Admin — «Yo» gone with F2) take the navbar's centre at lg+ with one
`SlidingIndicator` underline; the page title stays in the bar below lg. The avatar ring
transitions on `--motion-fast`; the notification badge pops in through `Presence`. The
impersonation banner drops in (`Presence drop`, new) and publishes `--impersonation-h`
after landing (`Presence.onEntered`, new) — but only when impersonation starts in the
session: a page loaded already impersonating renders at rest and measures at once, decided
from the first resolved session status. The audio transport springs in on `SPRINGS.sheet`
(the `sheet` variant now enters on the spring) and its progress fill animates `scaleX`
inside a clipping wrapper. `SongSheet` passes a real `title`, so the dialog's head is the
grip and the hand-rolled header with its "Canción" eyebrow is gone (§20 stacked headers);
`SetlistPopover` renders `open={x}` (`cueDialogMount` 10).

**Rulings.** Biblioteca links to `/tag` until R1 creates `/biblioteca`; Tema is a link,
not a second write path; the kids-only «Tags» row was removed (isolation invariant over
the plan); «Más» is a `CueDialog` (the `dialogSemantics` exemption went; its floor is 1);
`transition-[height]` needed no task (already guarded). **Deviations from §5.0,
accepted:** the badge pops on the eased `scale` enter rather than the `pop` spring (quieter
at 14 px); the tab indicator is a dot above the icon rather than a pill behind it (the
pill read as a button at phone scale).

**Follow-up F1 (same day): one home per destination.** Frank's look at the shipped shell:
the avatar menu (`NavMenu`) still repeated every destination the tab bar and desktop nav
links already carried. Ruling: the top bar keeps the page title, the notification badge and
the impersonation offset anchor; `NavMenu` becomes an ACCOUNT menu at every width — Mi
perfil, Tema, a separator, Cerrar sesión — and drops Calendario/#Tags/Oasis
Kids/Planear Kids/Admin along with their ministry/role computations. `BottomNav`'s «Más»
sheet drops the user block, the Tema row and the Cerrar sesión row; its rows are now
computed first (Kids, Planear Kids, Admin), and when none applies the «Más» button itself
does not render — the bar shows four tabs and the sheet never opens. F2 (22:28): «Yo» left
both bars — `/me` has one home, the avatar menu; a bar with fewer than two items does not
render (kids-only volunteers).
Review of F1 found `/kids/admin` had lost its only lg+ home, so `NavLinks` gained «Planear
Kids» for kids managers (one link current at a time; the sign-out landing is `/auth/signin`
at all three sites). Two smaller items from the same look: the tab bar's active dot sat
off-centre because motion's layout `transform` overwrote the Tailwind translate on the
same element (`SlidingIndicator` now centres the dot with auto margins), and the schedule's
«‹ Anterior» / «Siguiente ›» row overflowed a 390 px phone — the words show from `sm:` up,
the chevrons carry the buttons below that, and both are the house `Button`.

**Bundle — over the accepted figure; ACCEPTED by Frank on 2026-09-10.** Cold, same
method: M1 tip `/` 117.5 kB · `/admin` 342.5 kB (shared 169.2, chunk not isolable). Δ vs
the M0b-2 tip **+7.3 / +5.7 kB gz** — `BottomNav` (with its sheet) and `NavLinks` now
mount on every `(client)` route. Absolute vs "Before M0a": **+40.2 / +40.8 kB gz**, past
the +32.9 / +35.1 accepted on 2026-09-09. Frank's word at the release was "do as you
recommend on the cap"; the recommendation, now the ruling: accept +40.2 / +40.8 as the
programme's recorded cost. The growth is structural (two shell components on every
route), and the one deferral candidate — the «Más» sheet body — is three rows and their
icons after F1/F2, so lazy-loading it cannot recover a meaningful number. A same-
environment A/B at the release (`docs/MOTION.md` ledger) shows the three follow-ups
moved the routes by −0.4 / +0.5 kB, inside Turbopack's ±0.5 kB build noise. The
sheet-drag/`AnimatePresence` deferral from Part VIII remains the lever if a later phase
needs the number down.

**Released to production on 2026-09-10** via PR #55 (merge `c93d4494`, production alias
verified by `alias` + `githubCommitSha`), after Frank's look on dev on 2026-09-09 and the
three follow-ups above (dot centring, month-nav overflow, F1/F2), each task-reviewed and
re-reviewed clean on the branch before the merge.

**Deferred → later phases:** `/biblioteca` and the `/tag*` redirects (R1); long-press
quick actions and pull-to-refresh (R7); `NavLinks` follows the page's `schedule`/`tags`
flags, so the row changes shape on `/kids` (Control Room / R5 to unify); the desktop row
has no wrap for a sixth link.

# Part X — R1 (2026-09-10)

Branch `claude/motion-r1-library` (from `main`, HEAD before this task `408b0db2`). Nine
tasks: pure library logic, the `AnimatedList` primitive, the `/biblioteca` route + index +
filters, the `/tag*`/`/author*` redirects, the home run sheet (`DayCard`'s `layout`/`hero`
+ `DayCardDisclosure`), the lit-card beam pass, and this documentation task.

**Shipped (§12.1/§12.2 in full).** `libraryIndex.ts` — neutral params/filters/search/A–Z,
moved from `SongSearchList`'s algorithm with one narrowing (short queries match authors
per-word-prefix, not mid-token substring). `AnimatedList` — the list-reflow primitive.
`/biblioteca` — one Server Component fetch (catalogue + tags-with-counts +
authors-with-counts), `LibraryIndex` (search console, A–Z sections via `AnimatedList`,
letter rail, `LibraryFilters` drawer), `LibraryRow`. `next.config.mjs` redirects: `/tag`,
`/tag/:slug`, `/author`, `/author/:slug` → `/biblioteca` (`?tag=`/`?author=`), all
`permanent: true`. The old `/tag*`/`/author*` pages and `SongSearchList`/`PostComponent`/
`TagSearchList`/`AuthorSearchList` deleted. Home became a run sheet: `DayCard` grew a
`layout?: "card" | "wide"` and `hero?: boolean`, plus a day · date header and a countdown
pill (`daysUntil`); the next service renders in full (`layout="wide" hero`), every other
painting service collapses into `DayCardDisclosure`. `PracticePlaylistButton` grew
`variant="hero"`. The label budget dropped `>Servicio<`, "Índice musical", "títulos" and
"Repertorio" to zero. The lit card — one CSS-only beam pass around the hero card's border
after the route reveal (decision Q, the beam's fifth and only non-`motion` use).

**Rulings.**
- **The row pattern is exempt from `Button`** — `LibraryRow`, `DayCardDisclosure`'s header,
  and the letter rail's buttons all carry a plain `<button>`, the same ruling `DayCard`'s
  setlist rows already set: the row IS the affordance, so it carries no eyebrow and no "Ver".
- **The redirects are `permanent: true` — 308, not 307.** The old URLs are gone, not
  temporarily moved; a 308 lets browsers and crawlers update bookmarks/indexes rather than
  re-checking the source on every visit.
- **The filter drawer carries Artista and Tonalidad** because the standalone author index
  page is gone — `/author/[slug]` used to be the only Artista-scoped view, and folding it
  into a drawer field is what makes that scoping survive the redirect.
- **`nextDate` is computed over painting services only.** A published special with no seats
  and no songs renders nothing (`paintsDayCard`), so it is never named "next" — naming it
  would hand the hero slot and the countdown to a card that renders `null`.
- **A wide card needs a team, not just a setlist.** `layout="wide"` only takes effect when
  both `hasSetlist` and `hasRole` are true — a setlist with no assigned team has nothing to
  put in the second column, so it stays single-column instead of leaving a rail empty.
- **`daysUntil` pins "today" to America/Mexico_City**, not the runtime's local date — the
  countdown is read on Vercel (UTC), and a bare local date would misreport the team's
  evening as still a day away.
- **«Todos» is how a Tipo is cleared.** `SegmentedControl` never fires `onChange` for the
  already-checked option, so "tap the selected tile again to clear it" cannot exist as a
  gesture; a fourth tile, «Todos», is the explicit clear action instead.
- **Long-press quick actions and pull-to-refresh stay R7** — unchanged from the Part IX
  deferral; R1 did not pull either forward.
- **The `Setlist` rail stays as `Editar`'s home.** The inline practice pill and the admin
  "Editar" affordance both live on the setlist section's header row; `hero` mode only
  removes the inline pill (replaced by the header's `Ensayar`), never the edit control.
- **Hero `Ensayar` is accent-toned on every day**, Saturday and special services included —
  `PracticePlaylistButton variant="hero"` always renders the house `Button variant="primary"`
  rather than picking up the day's own theme colour (`SATURDAY_THEME`/`SPECIAL_THEME`), a
  deliberate choice at Frank's look so the one primary action on the hero card reads the
  same regardless of which day it is.

**Deviations from the plan, accepted.**
- **The lit-card construction** — a clipped wrapper plus an UNMASKED spinning conic layer,
  `inset: -800px`, so the only light that escapes is the 1 px gap the wrapper's `padding`
  opens. The plan's original design masked the rotating layer to a ring; that shipped once
  and painted a diagonal line across the whole card, because a `mask`/`-webkit-mask` lives
  in the rotating element's own box and rotates with it. `litCard.test.ts` pins the
  no-mask rule as a named regression; the browser evidence (four paused-frame screenshots,
  a per-pixel delta) is in `task-8-fix1-report.md`, not in the guard — the guard cannot see
  geometry.
- **`AnimatedList`'s `mode="popLayout"`**, not the plan's plain `layout` prop — popping a
  leaving row out of flow (the `NumberRoll` precedent) is what lets the survivors slide to
  their new place in one motion instead of jumping as the leaver's space collapses under
  them mid-animation.
- **The letter rail sits after the A–Z sections in DOM order**, absolutely positioned inside
  the `relative` list wrapper rather than floated or reordered with CSS — so it never
  competes with section content for layout space, and its `sticky top-[50vh]` centring reads
  against the same scrollport the sections scroll in.
- **The index mirrors its own URL state with `window.history.replaceState`**, not the Next
  router (the `AdminPanel` `?tab=` precedent) — a `router.replace` would re-run the Server
  Component's fetch on every keystroke for a filter that is entirely client-side; `replace`
  (never `push`) keeps Back from growing one history entry per keystroke.
- **Short-query author matching is per-word-prefix**, not substring — a 1–2 character query
  against the raw author string false-positived on any word containing it mid-token (e.g.
  "an" inside "Redman"); title search keeps full substring matching since it is what is
  visually shown, sorted prefix-first.

**F3 (Frank's look, 12:30).** Three things off a phone, one commit on the R1 branch.
1. **The letter rail became an index bar** (`LibraryLetterRail`, extracted from `LibraryIndex`):
   the letter whose section is in view carries the accent and `aria-current`, fed by ONE
   `IntersectionObserver` over the `h2#letra-*` headings; a pointer drag scrubs the list under
   the finger (instant while moving, smooth on a plain tap, `haptic("selection")` per letter,
   `touch-none`, a `data-scrubbing` pill to hold, `right-1` so it clears the scrollbar gutter).
   Frank's words: the letters should show the progress of scrolling, not sit beside a scrollbar.
2. **Search finds artists.** The Fuse index now carries a flat derived `artist` field
   (`artistOf` = legacy `author` + every `authors[].name`), weight 1.5 under `title`'s 3, and the
   ≤2-char branch matches it by per-word prefix. Most of the catalogue keeps its artist in
   `authors[]` with `author` empty, so those songs were unreachable by name before this.
3. **The drawer searches.** Temas and Artista are both a search box over a chip cloud sized by
   `postCount`; the Artista `<Select>` is gone (Tonalidad's stays — 15 options is a list).

**F3 rulings.**
- **A selected chip that does not match the query pins to the front of the cloud** rather than
  filtering out. A chip nobody can see is a filter nobody can remove.
- **Artista needs no «Todos» tile** though Tipo does: a chip is a button, so a second tap on the
  chosen artist fires and clears it — the `SegmentedControl` limitation that forced «Todos» does
  not apply.
- **The "in view" band is 64 px, a constant, not the sticky offset.** `rootMargin` takes no
  `env()` and no `rem`, so it cannot be derived from `UNDER_NAVBAR`; 64 px sits deliberately
  ABOVE the smallest real offset (5 rem + inset) so the pinned heading is inside the band
  rather than on its edge.
- **The rail jumps on `pointerdown`, and the `click` that follows is swallowed** (`detail >= 1`).
  A click with `detail === 0` is a keyboard activation — the one case with no pointerdown behind
  it, and the only reason the buttons keep an `onClick` at all.
- **`activeLetter` is DERIVED from `letters`, never stored as "".** A query collapses the
  sections; a remembered letter that no longer has one would light up the instant the sections
  came back, ahead of the observer.
- **Fuse's `threshold: 0.35` was never the problem** — see the F3 report. A full artist word
  scores ~0.0007 against the joined string; "hillsong" missed before F3 only because the index
  had no field containing it. The real limit is the location penalty (`distance: 200`): a word
  starting past ~character 68 of the joined artist string falls outside the threshold, which no
  real artist list reaches.

**Bundle (cold, same environment, git-archive builds of `main` `0414ee86` and the R1 tip):**
`/` 123.5 → **119.0 kB gz (−4.5)** — the catalogue and Fuse left home; `/admin` 350.9 →
354.8 (+3.9, the run-sheet `DayCard`/disclosure code the admin shell shares); the new
`/biblioteca` is 112.9 kB, `/schedule` 121.5; shared 172.5 unchanged. Absolute vs "Before M0a"
on `/`: the release-day environment reads ~6 kB higher than the ledger's older rows, so the
honest statement is that R1 gives back about 4.5 of M1's +7.3 on the route members open first.
Rows in `docs/MOTION.md`'s ledger.

**Released to production on 2026-09-10** via PR #58 (merge `baada1c7`, production alias
verified by `alias` + `githubCommitSha`), after Frank's look on dev (three follow-ups: the
Tipo tiles fitted at 390 px, F3, the letter pill) and a re-merge of `main` twice while other
releases (#57, #59, #60) landed under the PR. Two design questions from the look stay open
for R2+: the hero «Ensayar» is accent-toned on Saturday/special headers; library rows show
BPM at phone width while the home run sheet hides it.

# Part XI — R2 (2026-09-10)

Branch `claude/motion-r2-schedule`. Five tasks: pure agenda logic, the `SwipeStrip`
primitive, the schedule header + day strip, the agenda view + mode host, and this
documentation task.

**Shipped (§12.3 in full).** `app/utils/agenda.ts` — neutral: `findDuplicates` (moved out of
`DayCard`), `serviceTone`, `serviceConflicts`, `conflictLabel`, `summarizeService`,
`agendaRows`, `mondayOf`/`addDays`/`weekStripDays`/`monthStripDays`. `SwipeStrip` — the
drag-with-snap host, `motion`'s `dragTransition` override documented in-file. `ScheduleHeader`
— icon-button arrows that step ONE month via `?m=` (a navigation, so the route reveal carries
it), a jump-to-any-month `DateField` with no stepper pair, a «Próximos» sublabel in the
rolling view. `DayStrip` — a WEEK strip (seven cells, swipe pages weeks client-side,
`onWeekChange` scrolls the agenda; today's dot pulses once). `AgendaView` — service days only,
one row per service, `DOM 13 SEP` + countdown pill + summary + `⚠ N conflicto(s)`; specials
name themselves; rows open the existing day sheet. `CalendarView` becomes the host
(`Agenda | Mes`, a plain keyed `Presence` fade with `appear` only after a switch — the M0b
rule); «Lista» retires. `page.tsx` drops its own `h2` (the header IS the heading now) and
computes `today` once, threading it into both the fetch and `todayStr`. `loading.tsx`
reshaped to match.

**Rulings.**
- **Agenda | Mes replaces Calendario | Lista.** The agenda answers "when do I serve next"
  directly — one row per service — where the grid made the reader scan ~90 cells for the lit
  ones and «Lista» stacked the same full `DayCard`s the day sheet already shows, at ten times
  the height. The grid stays as `Mes`, for planning a month at a glance; agenda is the default.
- **The header's arrows step ONE month while the fetch window is unchanged** — three months
  from the anchor in browse mode, the rolling 95-day window by default. Paging the header
  never changes how much data a view holds, only which slice starts it.
- **The strip is a WEEK strip, not the plan's month-long scroller.** The plan called for the
  whole anchor month in one snapped, horizontally-scrollable row; it shipped once and could
  not be finger-scrolled on a phone, because `SwipeStrip`'s own host sets
  `touch-action: pan-y` — the browser never hands the horizontal axis to a nested scroller, so
  the only way to reach day 20 was the swipe, and the swipe paged the whole month. Days 8–30
  were unreachable by touch while looking reachable. The fix is what spec §12.3's ASCII always
  called it: seven cells, no inner scroller, the week that contains today (or the anchor
  month's first DAY's week — `mondayOf(anchorMonth + "-01")`, service day or not) as
  the initial view.
- **The swipe pages weeks, not months.** With the strip narrowed to one week, its drag became
  the week-paging gesture (client state, `onWeekChange`); the month axis stays where the plan
  put it, on the header's arrows (server-driven, `?m=`).
- **Conflicts are counted per SECTION** (voces / instrumentos / foh), summed —
  `serviceConflicts` runs `findDuplicates` over each section separately rather than the whole
  service, so a person seated in two different sections (a lead who is also on an instrument)
  is not flagged, only a repeat within one section is.
- **The crossfade is a plain keyed fade, not the plan's stacked panels.** Stacking needs a
  host of known height; neither view has one here — the agenda is as tall as the fetch window
  has services, the grid is three months — so any `min-h` big enough for the taller panel
  leaves the shorter one in blank space. `Presence` keyed on the mode (unmount one, mount the
  other, no exit) is the plan's own recorded fallback, taken as the primary design.
- **`appear` only after a switch**, never on the mode the route mounts with — a fix-round
  ruling (Task 4's review), the same M0b rule (ADR-0031) `ImpersonationBanner`'s
  `activeAtLoad` already sets: `Presence appear` above the fold is the one thing that rule
  forbids, so the crossfade exists for switches only and first paint renders at rest.
- **Month paging is server-driven and enters via the route reveal** (decision C), not a
  directional slide — decision C makes every schedule transition enter-only anyway, so a
  slide would have had nothing to pair against; a `?m=` navigation is treated exactly like any
  other route change.
- **Deferred to R7:** pull-to-refresh, long-press quick actions — unchanged from the Part IX/
  Part X deferral, R2 did not pull either forward.

**Deviations from the plan, accepted.**
- **The strip narrowed from a month scroller to a week strip** mid-branch (`dedff38a`) — see
  the ruling above; the plan's own ASCII in §12.3 already described a week strip, so this is a
  correction back to the spec rather than a new design.
- **The crossfade shipped as the plan's recorded fallback**, not its primary stacked-panel
  design — see the ruling above.
- **`appear={switched}` was added in a fix round** (`7782748f`) after the first cut of Task 4
  mounted the agenda with `Presence appear` unconditionally true, which would have animated
  the very first paint — caught before merge, not after.

**Bundle:** `main 6e9a195c` → `R2 tip 444d015d` (git-archive cold build, same env):
`/schedule` 121.5 kB → 123.1 kB (+1.6), `/biblioteca` 114.2 kB → 114.2 kB (unchanged),
`/admin` 355.7 kB → 356.4 kB (+0.7, build noise); shared unchanged. The week strip, the
agenda and `SwipeStrip` cost 1.6 kB on the route — see the `docs/MOTION.md` ledger.

**F1 (Frank's look, 20:49).** The agenda's rows carried no signal for "it's you" — the retired
«Lista» mode's stacked `DayCard`s glowed a seat positive for the signed-in member, and the
one-line agenda dropped it. Fix: `app/utils/agenda.ts` gained `myNameFromSession` (the one
reader of `session.user`, now shared with `DayCard`) and `mySeats(entry, myName)` (DayCard's own
seat order — Lead, BGVs, Coro, instruments, FOH); a seated row in `AgendaView` carries a
`Tú · Lead, Keys` pill and a positive glow on its tone rail, and a seated, lit day in `DayStrip`
gets a second dot under the number (`StripDay.mine`, `CalendarView` deriving `myName` once for
the strip). See `docs/MOTION.md`'s R2 section for the full ledger.

**Released to production on 2026-09-10** via PR #63 (merge `50c76163`, production alias
verified by `alias` + `githubCommitSha`), after Frank's look on dev (F1, the «Tú» signal) and
a re-merge of `main` while #62 landed under the PR. The F1 review's fix round corrected the
strip's dot to share today's slot (one dot, positive wins, the pulse stays today's) and made the
strip cell announce «te toca». Precondition now on the record: the «Tú» signal matches by
display name (`alias || member_name`), so that name must be unique team-wide. Carried to R7:
pull-to-refresh, long-press.

# Part XII — R3 (2026-09-11)

Branch `claude/motion-r3-me`. Four implementation tasks plus this documentation task:
the availability save machinery as a hook, the weekend list with the grid behind a
disclosure, the identity header and services column, and one Ajustes card.

**Shipped (§12.4 in full).** `app/components/availability/useAvailability.ts` — the
revision-guarded PATCH, the one-time sibling rebase, the held conflict, the dirty
fingerprint and the `beforeunload` guard, moved verbatim out of the grid component so a
second surface could read and write the same `unavailableDates` without a second
revision racing the first. `app/utils/weekends.ts` — neutral: `nextWeekends(todayIso,
count)`, `weekendLabel(weekend)`. `app/components/availability/WeekendList.tsx` — the
next ten weekends as `SÁB`/`DOM` pill pairs, the twelve-month grid moved to
`app/components/availability/AvailabilityGrid.tsx` behind «Ver calendario»
(`Collapse`). `app/components/availability/MyAvailabilityPanel.tsx` — the host, calling
`useAvailability` once and owning the shared «Repetir…» recurring panel and the one
`NotePopover` both surfaces open. `app/utils/myWeek.ts` — neutral: `seatLabel(doc)`,
`nextSeatLine(assignments)`. `app/components/MeHeader.tsx` — the identity header:
avatar, name, alias, worship-gated Tipo chips, and the one line («Te toca el domingo 13
· Lead» with a `NumberRoll` countdown, or the next Kids Sunday, or the worship empty
state). `app/utils/memberTypes.ts` — `MEMBER_TYPES`/`MEMBER_TYPE_LABEL`, mirroring the
`worshipTeam` schema, pinned by a parity test. `app/components/SettingsCard.tsx` — one
`section#ajustes` holding `ThemeControl`, `TextSizeControl` and `ProfilePanel`, each
`bare`. `app/(client)/me/page.tsx` — reordered: `ThemeAnnouncement` → `MeHeader` →
services (hero + collapsed `DayCardDisclosure` rows) → Kids → `MyAvailabilityPanel` →
`SettingsCard`; both retired `h2`s ("Mis próximos servicios" / "Próximos servicios")
are gone, the header is the page's heading.

**Rulings.**
- **Weekend toggles are pill `Button`s with `aria-pressed`, not a `SegmentedControl`.**
  A `SegmentedControl` is a one-of-N choice with a sliding thumb; a weekend's two days
  are two INDEPENDENT booleans — a member can be unavailable Saturday, Sunday, both or
  neither — which is exactly the shape `aria-pressed` toggles cover and a radiogroup
  does not. `Button` gained a `tone` prop (`accent` default, `availability`) in fix
  round 1 once the pill's own pressed colours measured 3.67:1 in light, below the 4.5
  floor; the `availability` tone's `soft` text clears 5.17:1 light / 9.16:1 dark.
- **The grid stays, for edge cases, behind a disclosure.** The weekend list answers "can
  you serve this weekend"; a Tuesday rehearsal or a two-week trip needs a date the list
  cannot express, so the twelve-month grid remains, unchanged in behaviour, opened by
  «Ver calendario» rather than being the default — same shape as R2's Mes-behind-Agenda
  ruling in Part XI.
- **The recurring panel is shared**, not duplicated. It moved from the grid up to
  `MyAvailabilityPanel`, the same host that owns the one `useAvailability` call, so
  «Marcar»/«Quitar serie» write against the state both `WeekendList` and the grid render
  rather than a copy either view could drift from.
- **"Guardado" is a toast, not an inline flash.** The old flash was a transient `saved`
  boolean that was also `false` while the save was in flight — reading it as "success"
  conflated a transition with a result. `useAvailability` gained an `onSaved` callback
  fired only on an actual 200, and the panel raises a `useToast` toast from it, which
  survives the surrounding list re-rendering (an inline flash pinned to a row does not,
  once the toggle it was next to has already been redrawn by the save).
- **The header replaces the two `h2`s.** «Mis próximos servicios» and «Próximos
  servicios» named what the member was looking at; `MeHeader`'s one line says what they
  have to DO, and it IS the page's heading — no ARIA landmark stands in for either
  retired heading, because the header already carries that role. An `sr-only` "Después"
  heading precedes the collapsed rows, for a screen reader crossing from the hero into
  the rest of the run sheet.
- **`NextServiceHero` is deleted.** Its only job — wrapping `DayCard` with a countdown —
  moved into `MeHeader` (the countdown) and a direct `<DayCard {...} hero />` (the card),
  once the header owned the one countdown the page needs. Passing `isNext` to that hero
  card as well would have put two countdowns for the same date on one page.
- **Tipo chips are gated on worship membership**, the same gate as the empty state — a
  member's `memberType` is the worship eligibility axis (CLAUDE.md), so handing it to
  `MeHeader` for a kids-only volunteer would print worship copy on a page a kids-only
  member is otherwise never shown any of.
- **`memberTypes.ts` holds neutral, full-word labels** — "Tipo" already had two
  independent copies (`/admin`'s abbreviated table labels and the admin PATCH route's
  write allowlist) with nothing to stop them drifting apart, and the header's chip
  text was about to become a third. `/admin` keeps its own `TYPE_ABBR` deliberately: a
  dense table needs "Líder Dom", not "Líder Domingo", and that is an abbreviation of
  the canonical label, not a second source of it.
- **Dual-ministry precedence: worship wins, Kids is the fallback.** A member in both
  ministries with nothing of their own assigned in worship but a Kids Sunday coming up
  sees the Kids line — the header's one line names the NEAREST thing of any ministry,
  not "worship first, unconditionally." A worship assignment, when one exists, still
  wins over a nearer Kids Sunday, because the page's other worship surfaces (the hero,
  the proposal CTAs) are already keyed to that same assignment and a header naming a
  different service would point at content the rest of the page does not show.
- **`ThemeAnnouncement` dismiss is a `Presence` exit, no `appear`.** `show` starts
  `false` and flips in a mount effect, so the instance is already mounted (at rest) by
  the time it becomes visible, and the ordinary `show → true` enter runs without
  `appear` — passing `appear` here would both violate the M0b above-the-fold rule and be
  redundant, since nothing needs to animate in on top of the already-running mount enter.
- **Past days are disabled, not pressable; every toggle clears 44 px.** A member cannot
  "mark" a weekend that already happened, so a past day renders `disabled` rather than
  as a togglable pill; the `SÁB`/`DOM` pills and the «Razón» ghost sit at `size="lg"` for
  the touch target, and the pressed pill's text is `text-availability-soft`, not
  `-strong`, to hold contrast in light.
- **`SettingsCard`'s impersonation ruling.** `ThemeControl` returns `null` while
  impersonating; `SettingsCard` does not wrap it in a padding `div` the way it wraps
  `TextSizeControl`, because a wrapped `null` still reserves the padding and leaves an
  empty box in the card's `divide-y` sections. `ThemeControl`'s own `bare` mode keeps its
  `p-5` padding rather than shedding it, so it owns the space it needs and nothing more
  when it renders, and nothing at all when it doesn't.

**Deviations from the plan, accepted.**
- **The host renamed to `MyAvailabilityPanel`**, not the plan's `Availability` — caught
  in fix round 1, once the plan's name turned out to collide with the unrelated admin
  `AvailabilityPanel`.
- **The grid moved file** from `app/components/AvailabilityCalendar.tsx` to
  `app/components/availability/AvailabilityGrid.tsx`, beside the rest of `/me`'s
  availability surfaces rather than staying at the top level — a fix-round tidy, not a
  behaviour change; its two existing conflict/popover-position tests re-pointed at the
  new host and pass unchanged.
- **`app/utils/memberTypes.ts` was not in the plan.** It came out of a fix round once
  `MeHeader`'s Tipo chips needed a label source and the admin PATCH route's write
  allowlist and `/admin`'s abbreviated table turned out to already be two independent
  copies of the same six values — a third copy for the chips would have made it three.
- **`NextServiceHero` is deleted**, not reused as the plan's architecture line assumed.
  The plan's own text still lists it as a reused component; the header absorbing the
  countdown made the wrapper's only remaining job — forwarding props to `DayCard` —
  redundant.

**Open notes for Frank's look.**
- `NotePopover` positions against its anchor's `getBoundingClientRect()`, which does not
  account for the mobile tab bar's `--bottom-nav-h` reservation — a «Razón» button near
  the bottom of the weekend list could open a popover that sits partly under the bar on
  a phone. Not caught by any test, since `bottomNavOffsetSync.test.ts` only enumerates
  fixed-bottom elements and the popover is positioned, not fixed.
- `MeHeader`'s «Editar perfil» is `href="#ajustes"`, the same hash-anchor pattern
  `ThemeAnnouncement` already uses for `#tema` — the scroll itself is untested in an
  actual browser (jsdom does not implement scroll-into-view for hash navigation), so
  Frank's look should confirm the jump lands on `SettingsCard`, not merely that the
  anchor exists in the DOM.

**Bundle:** `main df19f1b5` → `R3 tip 4b3e18ad` (git-archive cold build, same env):
`/me` 129.8 kB → 132.2 kB (+2.4), `/admin` 356.5 kB → 356.9 kB (+0.4), `/` 119.9 kB →
120.4 kB (+0.5), `/schedule` 123.6 kB → 124.1 kB (+0.5), `/biblioteca` 114.2 kB →
114.3 kB (+0.1); shared unchanged. The header, weekend list and `SettingsCard` cost
2.4 kB on `/me`; the pill `tone` on `Button` touches every other route by
~0.4–0.5 kB — see the `docs/MOTION.md` ledger.

### F1 — after Frank's look (2026-09-12)

Frank's look at R3 surfaced two asks, both taken as rulings rather than deferred to a
future round:

- **Fridays are rehearsal days.** The team rehearses the Friday before a Sunday (or
  Saturday) service, so a weekend row that only asked about Saturday/Sunday was asking
  half the question a member needed to answer. Each `Weekend` now spans Friday through
  Sunday — the row answers «¿este fin de semana puedes?» for the whole weekend
  including its rehearsal, not just the service days. A Friday still carries a service
  dot if one is genuinely scheduled there (the dot rule is `serviceSet.has(iso)` for any
  day, unchanged), since a special Friday service is real; it simply never carries one
  in the ordinary case, because rehearsals are not service documents.
- **A range panel covers the special-service-mid-week case the ten rows cannot.** Ten
  weekend rows answer "can you serve this weekend, one of the next ten" — they say
  nothing about a Wednesday evening service inserted between two ordinary weekends, and
  marking five separate days by hand for a multi-day trip that isn't aligned to a
  weekend was the gap. `useAvailability.applyRange(startIso, endIso, add)` marks (or
  clears) an inclusive span in one call, on the same revision-guarded state the weekend
  list and the grid already share; `MyAvailabilityPanel`'s «Rango…» panel is its one
  caller.
- **The grid stays for single weekdays.** Neither ask replaces the twelve-month grid
  behind «Ver calendario» — a lone Tuesday rehearsal is still one tap on a calendar day,
  not a one-day "range." The grid, the weekend rows and the range panel now cover three
  distinct shapes (a single arbitrary day, a recurring weekday, a contiguous span) with
  one shared `useAvailability` underneath all three.

**Release:** pending.
