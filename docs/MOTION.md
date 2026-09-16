# Motion

The motion system introduced by `docs/superpowers/specs/2026-09-08-premium-motion-design.md`
and ADR-0031. This is the reference; the spec is the argument.

## Tokens (`app/brand.css` `:root`, mirrored in `tailwind.config.ts`)

| Token | Value | Utility | Use |
|---|---|---|---|
| `--motion-fast` | 120ms | `duration-fast` | colour, hover, focus ring |
| `--motion-base` | 200ms | `duration-base` | press, toggles, menus, small reveals |
| `--motion-slow` | 320ms | `duration-slow` | sheets, dialogs, tab panels, collapse |
| `--motion-reveal` | 480ms | `duration-reveal` | route reveal, hero rail |
| `--motion-shimmer` | 1600ms | `animate-shimmer` | skeleton sweep period |
| `--ease-out` | cubic-bezier(0.22, 1, 0.36, 1) | `ease-out-brand` | every enter |
| `--ease-in` | cubic-bezier(0.4, 0, 1, 1) | `ease-in-brand` | every exit |
| `--ease-in-out` | cubic-bezier(0.65, 0, 0.35, 1) | `ease-in-out-brand` | crossfades |
| `--motion-rise` | 8px | — | enter travel |
| `--motion-sink` | 1px | — | press travel |

`--reveal-i` is declared in `:root` as `0` — the base case for any element that
carries `[data-reveal]` with no inline stagger index; `revealProps(i)`'s inline
`style` overrides it per element.

JS twins: `app/utils/motionPresets.ts` (`MS`, `EXIT_MS`, `SPRINGS`, `VARIANTS`).
Guard: `app/utils/__tests__/motionTokens.test.ts`.

## The beam (signature)

Spec §2.1: "One accent-light sweep, used in exactly four places and nowhere else."
§23 decision Q (R1, Task 8) added a fifth, CSS-only, harvested from the
`border-beam` package survey without adding the dependency — still enumerated,
still one-shot:

1. **Route reveal** — the page's `brand-section-heading` rail draws itself
   top-to-bottom over 480ms on every navigation. Not the beam gradient itself,
   just its rail (`@keyframes brand-rail-draw`).
2. **Skeletons shimmer** — a diagonal accent sweep crossing each placeholder
   every 1.6s (`--skeleton-sweep`, `@keyframes shimmer`).
3. **Primary button sheen** — on hover (pointer devices only) a narrow highlight
   crosses the fill once, 600ms (`--sheen-highlight`, `.brand-btn-sheen`).
4. **Drop landing** (spec §2.1, not yet built — lands with the drag-and-drop
   phase) — when a dragged chip lands, the target cell flashes the beam edge
   once, 120ms.
5. **The lit card on `/`** (once, 900 ms) — after the route reveal, the next
   service's hero card gets one light pass around its border, then rests on its
   own accent border. `.brand-lit-card[data-lit]::before`, `@keyframes
   brand-lit-pass`, `--lit-beam`. `data-lit` is set by `app/(client)/page.tsx`
   on the hero card only. The wrapper CLIPS and an unmasked conic layer spins
   under the card, so the light only shows in the 1 px gap the wrapper's
   `padding` opens — a mask would rotate with the layer and slash across the
   card. Guard: `app/utils/__tests__/litCard.test.ts`, which cannot see
   geometry; the browser evidence is in the Task 8 fix-round report.

The beam gradient itself (not just a rail/sweep/sheen derived from it) stays
exclusive to the sign-in lockup, where it already lived before this list existed
(`.brand-stage-hero::before`, `@keyframes brand-beam-reveal`).

## Rules

1. **Only `transform` and `opacity` animate.** `Collapse` (M0b) is the one exception,
   on user-triggered disclosures only.
2. **Tokens, never literals.** `rawMotionLiterals.test.ts` pins `transition-all` and
   `duration-N` counts outside `ui/`; lower the baseline when you migrate a route.
3. **`motion` is imported only under `app/components/ui/**` and `app/utils/motion*`.**
   `motionImportBoundary.test.ts`. Compose a primitive instead. `LazyMotion strict`
   (in `MotionProvider`) throws on a stray `motion.*` component only in
   development — it is silent in production — so the import-boundary test is the
   guard that actually holds in prod; `strict` is a dev-time tripwire on top of it,
   not a substitute for it.
4. **Reduced motion is global.** `@media (prefers-reduced-motion: reduce)` in
   `brand.css` and `reducedMotion="user"` in `MotionProvider`. Do not add per-effect
   opt-outs. `html[data-motion="off"]` collapses CSS motion the same way — but the
   theme gallery mounts no `MotionProvider` (it mounts its own `GalleryMotion`, see
   below), so that attribute covers CSS only, not `motion`-driven JS animation, on
   any route that has neither. The gallery's `GalleryMotion` (`app/(gallery)/
   theme-gallery/[theme]/GalleryMotion.tsx`) closes that gap for itself: it loads
   `domMax` synchronously (a baseline capture must not race an async chunk) and
   sets `MotionGlobalConfig.skipAnimations` from `data-motion="off"` on mount, so
   every gallery frame is final. Any new gallery fixture that renders `Presence`
   (or another `motion` primitive) is covered by this wrapper already sitting above
   `{children}` in the gallery's root layout — it does not need its own. The
   reduced-motion collapse also zeroes `animation-delay` — without that, `[data-reveal]`'s
   up-to-480ms stagger delay (combined with `fill: both`) would still hold an element at
   its `from` frame — opacity 0 — for the whole delay, so "no motion" would mean
   "invisible for half a second".
5. **Never transform an ancestor of a `position: fixed` element.** `template.tsx`
   renders a fragment for this reason (`reveal.test.ts`). Toasts and FABs portal.
   Both `@keyframes brand-reveal` and `brand-beam-reveal` end on `transform: none`,
   never `translate3d(0,0,0)` — a non-`none` transform under `fill: both` stays on the
   host forever and becomes a containing block for any fixed descendant. The Tailwind
   mirror's `rise` and `scale-in` keyframes end on `transform: "none"` too, for the
   same reason — `motionTokens.test.ts` checks every mirrored `to` frame that
   animates transform (`shimmer` is exempt: its `to` is a sweep endpoint, not a
   rest state).
6. **Enter fast, exit faster.** Enter 200–320 ms `--ease-out`; exit 120–160 ms `--ease-in`.
7. **Every hover effect has a press twin.** Hover-only choreography (sheen, lift) is
   gated on `@media (hover: hover)`.
8. **A new colour used inside a rule body is a composed token, never a raw
   `rgb(var(--x-rgb) / a)`.** A one-off alpha composition doesn't bump the tokenLayer
   pin (`brandCss.test.ts`'s composed-token count), so it reads as free — it isn't.
   `--skeleton-base` / `--skeleton-sweep` / `--sheen-highlight` were all added
   following the `--warning-glow` precedent: root value + `.light` override + a
   Tailwind key + the eslint raw-`rgb()` alternation + the tokenLayer COMPOSED count.
9. **`:focus-visible` is unsupported on iOS 15.0–15.3** (Safari 15.4 adds it) — the
   repo-wide focus-ring pattern, accepted under the iOS 15 floor (ADR-0030). A
   pre-15.4 visitor gets no visible focus ring from `Button`'s
   `focus-visible:ring-2`; this is a known, accepted gap, not a bug to "fix" per
   component.

## Primitives (`app/components/ui/`)

| Primitive | Module kind | Use |
|---|---|---|
| `MotionProvider` | client | mounted once in `app/utils/Provider.tsx`; `LazyMotion features={() => import("./motionFeatures").then(…)} strict` (async chunk, not the synchronous `domAnimation` value) + `MotionConfig reducedMotion="user"`. An `m.*` element renders its `initial` values until the chunk resolves; the vendor loader has no rejection handling, so if the chunk fails to fetch an `m` element stays at its pre-feature state and a `Presence` exit never completes — see "Load-failure behaviour" below for what each M0b overlay primitive does about it. |
| `Presence` | client | `<Presence show={open} variant="rise">` — exit before unmount. Hosts `div` \| `section` \| `aside` \| `li` only (block-level — a transform is dropped on a non-replaced inline element). `appear` defaults to **false**: a `Presence` mounted already-shown does not animate in unless `appear` is passed; for the common case — a mounted `Presence` that toggles `show` — do nothing, the enter animation runs on every `show→true` transition regardless. Pass `appear` only for an instance that mounts already-shown and must still animate in (an on-demand toast, a newly appended list row). `onEntered` fires after the enter animation completes; a mount that is already shown without `appear` runs no enter animation, so the callback never fires there. The `sheet` variant enters on `SPRINGS.sheet` (exit stays `EXIT_MS`). |
| `Skeleton`, `SkeletonGroup` | neutral | loading placeholders with the shimmer; one `aria-busy` status region per loading surface |
| `Button` | neutral | `variant` primary/secondary/ghost/danger/icon/pill · `size` sm/md/lg · `busy`/`busyLabel` · `href`. Defaults to `md`; the spec's phone-width `lg` default is applied per call site, not by the primitive. `busy`/`busyLabel` are rejected by the types on the `href` branch — a link has no loading state to represent. `className` is additive only (appended after the variant/size classes, never a padding/radius/colour override). The `primary` variant sets `overflow: hidden` for the hover sheen, so an absolutely positioned badge nested inside a primary button is clipped — anchor badges outside the button instead. The `pill` variant also takes a `tone` (R3): `"accent"` (default) or `"availability"` — `AvailabilityGrid`'s «Seleccionar fechas» pill since F3 retired the tone's original consumer, `WeekendList`'s weekend toggles; pressed text is `soft` rather than `strong` to clear 4.5:1 contrast in light. |
| `revealProps(i)` (`app/utils/reveal.ts`) | neutral | spread on a block a page reveals; `template.tsx` replays it per navigation |
| `CueDialog` | client | the ONE dialog shell — never a hand-rolled `fixed inset-0` scrim. `mode="modal"` \| `"sheet"`; a `"sheet"` dialog is only a sheet below 640px — at ≥640px it renders the same centred-card motion as a modal, decided when the dialog opens (`useMemo` on the `open` edge) and held until it closes. Drag-to-dismiss lives on the sheet's HEAD — the handle and the title bar as one grip, never the body (hand-rolled pointer events, not the `drag` prop — the gesture is one-axis and the sheet body still needs to scroll; on the phone sheet the × is `sr-only` (the grip is the close control; the button stays for VoiceOver and keyboard focus, and the ≥640px card keeps it visible); every sheet passes a `title` (`SongSheet` since M1), so the head is the grip everywhere; it closes past `SHEET_DISMISS.distance` = 150 px of travel OR above 0.5 px/ms, and springs back otherwise); a sheet's exit slides fully out (`y: "100%"`), it does not recoil partway like a modal's scale-fade. `onDismiss(reason: DismissReason)` where `DismissReason` is `"escape" \| "backdrop" \| "drag"`. Layers register with the provider so Escape and inert-ing only ever affect the top one. Its focus effects depend on the presence EDGE ONLY (`[open, top]` for entry focus, which also skips when focus is already inside the shell; `[id, mounted, registerLayer]` for layer registration) — never on `onDismiss` or on a ref prop, which re-run on every consumer render (the layer record is handed live views of the ref mirror, so narrowing the deps costs it no freshness) and pull the caret out of whatever the member is typing ([ADR-0034](adr/0034-dialog-focus-effects-depend-on-edges-only.md)); the Tab/Escape listener may keep them, since re-binding a listener moves no focus. Traps focus via `trapTabTarget`, and can extend its Tab ring to a portalled "satellite" node via `useCueDialogFocusSatellite()` (no production consumer registers one today; see the in-file comment). **Render `<CueDialog open={x}>`, never a literal `open` behind a conditional** — whether that conditional is `{x && <CueDialog open>}` directly, or a wrapper component (a local `Modal`, a `SetlistPopover`, a `SeatPicker`) whose only JSX output is `<CueDialog open …>` and which its caller mounts conditionally. Either way the dialog element is created and destroyed by React instead of opened and closed by the `open` prop, so it never runs CueDialog's own enter/exit — `cueDialogMount.test.ts` pins the current backlog and ratchets it down. A `Menu` inside a `CueDialog` owns Escape: the dialog's capture-phase listener yields when the key's target is inside an open menu or on its expanded trigger, so the first Escape closes the menu and the second the dialog (M0b-2). The sheet/card decision is taken when the dialog OPENS and held until it closes. |
| `Toast` / `useToast` | client | the ONE toast stack — `useTransientValue` stays for an inline "Guardado ✓" flash next to the control that produced it, `useToast` is for anything that needs a FIXED, stacked notification. `toast({ message, tone?, duration?, hold?, action? })`: `tone` is `"ok" \| "error" \| "info"`; `hold` persists until something calls `dismiss(id)` (never a bare `setTimeout`); `action` renders a button inside the toast that both fires and dismisses. Portals to its own viewport node, `z-[95]` (above `CueDialog`'s `z-[90]`, so a save confirmation is visible over a dialog), bottom-anchored at `calc(1.5rem + max(env(safe-area-inset-bottom), var(--bottom-nav-h, 0px)))` so it clears the mobile tab bar. |
| `Menu` / `MenuItem` / `MenuSeparator` / `MenuHeader` | client | the ONE anchored dropdown. Real `role="menu"` semantics: roving focus with arrow keys, Home/End, Escape closes and refocuses the trigger, Tab closes without refocusing. Positioned `absolute` in a `relative` wrapper (never a portal — a portal would escape a dialog's inert boundary). Merges the trigger's own `ref` with its internal one, so a consumer that also needs the trigger node (to refocus it after an async action) still can. |
| `Collapse` | client | the ONE disclosure — expand/collapse with real height animation (the one place `height` animates outside `transform`/`opacity`, on user-triggered disclosures only). Renders an UNSTYLED animated OUTER `m.div` (owns `id`/`aria-hidden`/`inert`/`height`/`opacity`/`overflow`) with `className` applied to a plain INNER `div` — under `border-box` a padded/bordered box floors its height at padding+border, so a closed `Collapse` that owned the padding itself reserved blank space forever; height 0 only means 0 when the animated box has no padding of its own. Children stay mounted while closed; opening clears `inert`/`aria-hidden` in the same commit as `open` (so a parent's own effect can reach a child node right away), while closing waits for the animation to finish before setting them. Because jsdom (as of this writing) does not wire the `inert` IDL property from the reflected attribute, `Collapse` also sets `el.inert` imperatively in an effect — a harmless duplicate of the JSX prop in a real browser, and what `Collapse.test.tsx` actually observes. |

| `SegmentedControl` | client | the ONE segmented control — `role="radiogroup"`, arrows move the selection with wrap and focus follows, the checked option is the sole tab stop; `value={null}` means nothing chosen yet (no thumb). The thumb is one `layoutId` span (what `domMax` is for). Sizes `sm`/`md`; tones `outline` (bordered pills) / `filled` (joined bar, solid thumb). `badge` and `busy` per option. Never `aria-pressed` toggles for a one-of-N choice. |
| `SlidingIndicator` / `useActiveIntoView` | client | the active marker for tab bars (admin `TabBar`, `SectionNav`, `BottomNav`, `NavLinks`): render ONE inside the active item; variants `pill`/`underline`/`dot`. Semantics stay on the items (`aria-current`). The hook scrolls the active item to the centre of an overflowing bar. |
| `Switch` | client | the ONE switch — `role="switch"`, `aria-checked`, a `<button>`; knob springs (`SPRINGS.pop`) with `initial={false}` so the first paint is the real state; haptic on flip. Sizes `sm`/`md`. |
| `Checkbox` | neutral | the ONE checkbox — the native input stays (`sr-only peer`) and does the work; the box is drawn, the mark scales in over `base`. `tone="negative"` for the kill switch. `align?: "center" \| "start"` (default `center`; `start` for a two-line label) is a prop rather than a `className` because a same-property utility passed through `className` cannot beat one the primitive already sets — two classes for the same property land at equal specificity in the compiled stylesheet, and the one emitted LATER wins regardless of call-site order, so an `items-center` baked into the component always beats an `items-start` passed in from outside. Name it with `children` or `aria-label`. |
| `Select` | neutral | the ONE select — the native `<select>` under tokenised chrome and a drawn chevron. Sizes `sm`/`md`/`lg` (`lg` = `md`'s padding/text plus a 44 px `min-height` on the `<select>` element itself, for a touch target). `label` + `id` (wires `htmlFor`) or `aria-label`. The desktop `Menu` popover with type-ahead is Control Room work (spec Part VIII). |
| `DateField` | neutral | the ONE date/month input — native under tokenised chrome; `kind="month"` with `onStep` draws an optional prev/next icon-button pair around the input, the parent's job to interpret. `ScheduleHeader` does NOT pass `onStep` (R2 Task 4 ruling — its own header arrows already page the month, under the same accessible names a second stepper pair would duplicate); the one live consumer is the theme gallery's `ControlsFixture`. |
| `NumberRoll` | client | a value that changes in place: old rises out, new rises in, both in one grid cell. `initial={false}`. |
| `AnimatedList` | client | list reflow: `mode="popLayout"` pops leavers out of flow so the survivors slide at once (`layout="position"` per row, leavers fade `fast`); the host renders `relative` because a popped item positions against it — `/biblioteca` index. |
| `SwipeStrip` | client | `<SwipeStrip onSwipe={(dir: -1 \| 1) => void} threshold={64}>` — the schedule's strip-paging drag (R2: the day strip pages its visible WEEK; the header's arrows page the month). `m.div drag="x"` locked to the horizontal axis (`dragDirectionLock`), pinned at the origin (`dragConstraints={{ left: 0, right: 0 }}`) with elastic give (`dragElastic={0.2}`) and `dragSnapToOrigin`; the snap-back spring is `SPRINGS.settle` passed as `dragTransition`, which motion's drag controller spreads into the release animation and so overrides its default inertia rather than tuning it. `style.touchAction: "pan-y"` keeps vertical page scroll alive under a finger that starts on the strip — and is why the wrapped content must fit the width rather than scroll horizontally. `onSwipe` fires once per completed drag past `threshold` px of travel OR `SWIPE.velocity` (500 px/s); the decision is the exported pure `swipeDirection(offsetX, velocityX, threshold?)`, tested directly since jsdom cannot drive motion's `drag` gesture. Keyboard paging is not this component's job — the header's own prev/next buttons cover the month axis. Reduced motion is not detected here; `MotionConfig reducedMotion="user"` already collapses the snap-back to duration 0 app-wide, same as `Presence`/`CueDialog`. |
| `CueStrip` (R7) | client | the navbar cue (§12.8) — the member's next service under the title, on every route but `/` and `/me`. Fetched client-side after paint like the notification badge (`Navbar` stays sync/ISR-safe); a shared in-flight promise dedupes the phone/desktop pair mounted per page, `sessionStorage`-cached 60 s and keyed by `sanityId` so a stale identity is a miss, not a leak. Reserves its line's height whenever armed, not just once the label paints — `Navbar` remounts every route change. |
| `Blackout` (`blackout()`, `app/components/ui/Blackout.tsx`) (R7) | client | the stage vocabulary's exit (§12.8), used once: sign-out. A plain CSS opacity transition on a `div` appended to `document.body` — deliberately not `motion`, since it fires synchronously from a click handler and outlives the component that rendered the trigger. `{ done, cancel }`; `cancel()` removes the overlay so a `signOut` that throws never leaves the page black. Instant under reduced motion. |
| `PullToRefresh` / `pullModel` (R7) | client / neutral | pull-to-refresh on the phone (§12.8, decision L), mounted once in `app/(client)/layout.tsx`. THE CONTENT IS NEVER TRANSLATED — the rail is a sibling `fixed` element at the viewport top, never a transform on `<main>` (ADR-0031). Arms only on `has-bottom-nav` + a coarse pointer, and only while no `CueDialog` layer is open. `touchmove`/`touchend`/`touchcancel` (`{ passive: false }`) attach per-gesture, only once `touchstart`'s checks pass. `preventDefault()` fires only past 8 px at `window.scrollY <= 0` (`<=`, never `===` — the iOS bounce drives `scrollY` negative); the axis locks once, on the first move past the slop. `[data-pull-ignore]` opts a surface out (`SwipeStrip`'s host, `AvailabilityGrid`'s months while «Seleccionar fechas» is armed). `pullModel.ts` holds the arithmetic (`THRESHOLD`, `MAX`, `pullProgress`, `shouldRefresh`, `railHeight`) apart from the component, since the gesture can't be driven with fidelity in jsdom. A commit calls `router.refresh()` once, with a 600 ms floor on the rail's "refreshing" state. `brand.css`'s `overscroll-behavior-y: contain` sits on the root element under `html.has-bottom-nav` so Chrome Android's own pull-to-refresh doesn't fire underneath. |
| `useLongPress(onLongPress, { ms?, move? })` (R7) | client | the ONE long-press gesture (§12.8, decision L) — 450 ms of a still primary pointer, cancelled by a lift, a cancel, the pointer leaving the row, a move past 8 px, or ANY `scroll` (capture phase, so a scrolling container counts). Nothing is drawn while the timer runs; the feedback is `haptic("medium")` plus whatever the callback opens. The fired press swallows the row's next `click` once through a capture-phase handler on the same element (the `SwipeStrip` precedent), cleared by the next `pointerdown`. A MOUSE `contextmenu` (`pointerType === "mouse"`, or `button === 2` where the browser sends no `pointerType`) fires it immediately — desktop right-click opens the same sheet. A `contextmenu` with no mouse signal is only `preventDefault`ed: a touch one (the press already fired or will) and, indistinguishably from it, a keyboard-invoked menu (Shift+F10 / the Menu key send `button 0` and no `pointerType`) — keyboard-invoked menus on rows are not supported, the row's own tap is the affordance. Spread the whole return on the row, `style` included (kills the iOS callout and text selection). |
| `QuickActions` (R7) | client | what a long press opens — a `CueDialog mode="sheet"` with one full-width, left-aligned `Button variant="ghost" size="lg"` per action and «Cancelar» last. `actions: { label, onSelect?, href?, tone?, icon? }[]`; an `href` action renders `Button href`. Every action closes the sheet. Mounted with `open={open}`, never behind a conditional with a literal `open` — `cueDialogMount.test.ts`. Consumers: `LibraryIndex` (ONE sheet for the whole `/biblioteca` list — the rows report the press through `onQuickActions`, because ~140 mounted sheets subscribing to the CueDialog layer context re-rendered every row on any dialog open/close) and `DayCardDisclosure` (per row; there are a handful). |
| `haptic(kind)` (`app/utils/haptics.ts`) | neutral | `"light"` (default) on a toggle flip or thumb move, `"selection"` on a tab press, `"medium"` for a landing — a drop (M-planner) and, since R7, a committed `PullToRefresh` pull and a fired `useLongPress`. Native only; no-op on web; never awaited in a handler. |
| `LyricsAutoscroll` (R4) | client | the Letra section's «Autoscroll» pill (ruling 6). rAF + `window.scrollTo(0, y)` — NEVER a transform on the section (ADR-0031: a transformed ancestor becomes the containing block for the FAB, the transport and the toasts), and never `setInterval`. `dt` comes from frame timestamps clamped to 50 ms; speed is `autoscrollPxPerSecond` measured once at start. It stops when the section's bottom clears `window.innerHeight` MINUS the tab bar's `--bottom-nav-h` and the audio transport's measured height (re-read at every resume). Touch pauses; `touchend`/`touchcancel`/`pointerup` lift it — never `pointercancel`, which a promoted pan fires with the finger still down — waiting for `scrollend` when the touch actually scrolled so it never resumes into iOS momentum, with a 400 ms fallback timer that resumes on its own if `scrollend` never fires, cleared on `scrollend`/toggle-off/unmount, at the top of every lift (one gesture lifts twice and a re-armed handle would orphan the first timer) and on the next touch down, with `resume()` returning early while `touching` so a re-touch inside the window always beats the timer — and re-seeding `y` from `window.scrollY` for the first 3 frames (never every frame — a sub-pixel advance would stall at low speeds). A `wheel` ends the run. 44 px pill. The frame plus all (passive) listeners are torn down on toggle-off and unmount, and the teardown marks the run finished so a late callback cannot resume it. |
| `PlayPauseGlyph` (R4) | client | the play/pause morph — a `Presence variant="scale"` pair (play, pause) in one `inline-grid` cell, `{ playing, size? }`. Purely decorative (`aria-hidden`); the accessible name lives on the button that hosts it (`SongAudioSection`'s track button, `AudioTransport`'s transport button, `PracticeCluster`'s cluster button all keep their existing `aria-label`s). |
| `Equalizer` (R4) | client | the playing track's tell — three `.brand-eq-bar` bars, `{ playing, className? }`, `data-playing` on the host span. CSS-only, no `motion` import: bars sit at `scaleY(0.3)` idle and animate (`@keyframes brand-eq`, staggered `animationDelay`s of 0/150/300ms) only under `[data-playing="true"]` — the one ambient animation in the app, and it stops with the audio (spec §5.3). The global reduced-motion rule collapses it like everything else; no separate media query. |

### Load-failure behaviour

The vendor feature loader (`motion/react`'s `LazyMotion`) has no rejection handling:
an `m.*` element with no loaded features renders using its `initial` prop's values as
static style, never advancing to `animate`, and a `Presence`/`AnimatePresence` exit
never completes. What that means differs by primitive, because it depends on WHEN
each one first needs the chunk relative to when it loads:

- **`Collapse` and `CueDialog` render already open via `initial={false}`** (on the
  `m.div`/the dialog's `AnimatePresence`, respectively) — a disclosure or a dialog
  that is open at the FIRST paint of its `AnimatePresence` renders at its resting,
  visible state immediately, with no dependency on the feature chunk for that first
  frame. This is what protects the case that matters most: content already open when
  the page loads.
- **`Toast` and `Menu` animate in from `initial` on every open** — deliberately not
  suppressed, because both open only after a user action, long after hydration and
  the feature chunk race is over in practice (see the comment atop `Toast.tsx`). If
  the chunk genuinely never arrives (a same-deploy static asset going missing; Next
  reloads the page on most chunk-load errors so this is a narrow window), a `Toast`
  or `Menu` opened in that window stays at its `initial` values — invisible.
- **A `CueDialog` opened AFTER mount, in that same narrow window, renders invisible
  while still inert-ing the rest of the page** — `initial={false}` only covers the
  case where the dialog's `AnimatePresence` first mounts already open; a dialog that
  starts closed and is opened later is a fresh enter within that `AnimatePresence`,
  which does depend on the chunk. The registration effects (focus, `inert`, scroll
  lock) do not depend on `motion` at all, so they still run — a user would see
  nothing but be unable to reach the rest of the page.

This is accepted and documented, not a bug to fix per component — revisit only if a
real report shows the failure window is wider than "a chunk fetch failed and the page
did not reload."

## Testing a primitive

```ts
/** @vitest-environment jsdom */
import { installMotionTestEnv } from "./motionTestSetup";
installMotionTestEnv(); // matchMedia stub + MotionGlobalConfig.skipAnimations
```

Assert final state, never timing. Wrap in `<MotionProvider>`.

## Guards

| Test | What it pins |
|---|---|
| `motionTokens.test.ts` | `--motion-*` / `--ease-*` NAMES exist in `brand.css` and have a Tailwind mirror — an undeclared custom property drops silently at computed-value time with no signal from `tsc` or eslint. |
| `motionImportBoundary.test.ts` | `motion` is imported only from `app/components/ui/**` and `app/utils/motion*`. Walks `app` and `sanity`, `.ts`/`.tsx`/`.mjs`/`.js`/`.jsx`, and catches a named import, a side-effect import, a dynamic `import()`, a `require()`, and `export * from` — not just `from "motion/…"`. `import type` stays flagged deliberately (a recorded ruling, not an oversight). |
| `reveal.test.ts` | `revealProps()`'s shape, and that `app/(client)/template.tsx` never wraps the page in a transformed element. |
| `loadingSkeletons.test.ts` | The four `loading.tsx` files compose `Skeleton` instead of a hand-copied pulse block. |
| `shellPolish.test.ts` | Spec Part III findings 3 (brand mark loads with `priority`) and 5 (initials avatar contrast in light). |
| `rawMotionLiterals.test.ts` | Pins `transition-all` (7) and raw `duration-N` (0) counts outside `ui/` at the audited baseline (13/12 pre-M1 → 9/8 after M1 → 7/0 after R1 deleted the tag/author lists — M1's four migrated sites: `BottomNav`'s sheet becoming a `CueDialog`, `NavMenu`'s avatar-ring transitions, the audio transport's progress fill and play/pause button) — lower it in the same commit a phase migrates a route; never raise it to make the guard pass. |
| `cueDialogMount.test.ts` | Counts every LITERAL `open` attribute on a `<CueDialog` source element — not `open={…}` — across `app/**/*.tsx` excluding `__tests__` and `ui/`; per element, not per caller, so a wrapper mounted by several callers still counts once. Pins the count at 10 (re-measured 2026-09-09, M1 Task 7 — `SongSheet`'s `SetlistPopover` migrated to `open={x}`, down from 11; the original 2026-09-08 measurement of 7 only caught the direct `{x && <CueDialog open>}` shape and missed wrapper components). `AdminPanel`'s and `ServicesPanel`'s local `Modal`s and `KidsPlanner`'s `SeatPicker` remain and migrate in their own route phases. Lower the count in the same commit that migrates a site to `open={…}`; never raise it. |
| `dialogSemantics.test.ts` | Every file that draws a dismissable full-bleed scrim (`bg-scrim` + `inset-0` + `onClick`) carries `role="dialog"`/`aria-modal`/an accessible name/focus management, or is named in an exemption list with a reason. Floor is 1 (`CueDialog` itself) as of M1 Task 1 — `BottomNav`'s hand-rolled scrim was replaced by a `CueDialog` sheet, so its `NOT_A_DIALOG` entry was deleted along with the overlay it exempted; the exemption list is now empty. A stale exemption (naming a file the scan no longer finds) fails its own check. |
| `labelBudget.test.ts` | Spec §18 (decision N): one eyebrow per surface. Pins seven named labels at their audited counts, by equality — a phase that removes one lowers its number in the same commit. `>Cue<` (0, M0b-1), `>Servicio<` (0, R1 — `DayCard`'s day · date header carries it now), "Índice musical" (0, R1 — `SongSearchList` removed), "títulos" (0, R1 — the home library count removed), "Repertorio" (0, R1 — `PostComponent`'s song-card eyebrow removed), "Backstage operations" (1) and "Acceso autorizado" (1) still open, both due in R5. |
| `redirects.test.ts` | R1 (spec §12.2, decision H): `next.config.mjs`'s `redirects()` folds `/tag`, `/tag/:slug`, `/author`, `/author/:slug` into `/biblioteca` (`?tag=:slug`/`?author=:slug`), all `permanent: true` (308). |
| `litCard.test.ts` | The home hero card's one-shot light pass (R1, decision Q — see "The beam" above). Cannot see geometry (jsdom), so it pins the CSS contract instead. |
| `bottomNavOffsetSync.test.ts` | Names `BottomNav`'s `NAV_H_VAR`/`NAV_CLASS` exports, the `setProperty`/`removeProperty`/`classList` publish-and-clear shapes, `brand.css`'s `--bottom-nav-h` declaration and `html.has-bottom-nav [data-route-main]` padding rule, that every fixed-bottom consumer (`Toast.tsx`, `AudioPlayer.tsx`, `EditSongButton.tsx`) offsets by the variable, and that the client layout mounts `<BottomNav />` inside `<Provider>`. A new fixed-bottom element joins the `it.each` list. |
| `navbarHeightSync.test.ts` | R4 Task 6 (spec §5.3): `Navbar` and `NavbarSkeleton` must publish the top bar's height from the ONE spelling, `NAVBAR_H_CLASS` (`app/utils/navbarHeight.ts`, `"h-20 lg:h-24"`), so a `loading.tsx` never hard-codes a height that can drift from the real navbar. Reads both sources and asserts each imports the constant from `@/app/utils/navbarHeight` and neither contains the literal string. Scope is exactly those two files — `SectionNav`'s sticky offset, `LibraryIndex` and the song page's `scroll-mt-*` still hard-code their own values and the guard does not see them. |

## Bundle

Measured `next build` (Next.js 16, Turbopack). Turbopack's build output no longer
prints the classic per-route "First Load JS" table or an `app-build-manifest.json` —
these figures are computed directly from the emitted manifests instead, gzip level 9:

- **First Load JS shared** — every `.js` file in `build-manifest.json`'s
  `rootMainFiles` + `polyfillFiles` (the framework/runtime chunks every route pays
  for), summed post-gzip.
- **`/` and `/admin`** — every chunk referenced by that route's
  `page_client-reference-manifest.js` (`clientModules[*].chunks`, deduplicated),
  summed post-gzip. This is the route's own total first-load JS (shared + route-
  specific), the closest analogue to the retired per-route table row.

Before was measured on the primary checkout at the merge-base commit
`a733347cfde72f731010f1bd58f9d189a84072cb` (branch `main`); After on the M0a branch
(`claude/premium-ui-animations-7e0204`, merged as `4b218d61`).

| Build | First Load JS shared | `/` | `/admin` | Async feature chunk (raw / gz) |
|---|---|---|---|---|
| Before M0a (merge-base `a733347c`) | 172.3 kB | 77.3 kB | 301.7 kB | — |
| After M0a, `domAnimation` loaded synchronously | 172.3 kB | 101.5 kB | 325.9 kB | — (not yet async) |
| After the fix wave, `domAnimation` loaded as an async chunk | 172.3 kB | 89.7 kB | 314.2 kB | 42.3 kB / 15.8 kB |
| Δ vs Before M0a | +0.01 kB | +12.4 kB | +12.5 kB | — |
| **M0b-1 tree, `domAnimation`** (confirmatory rebuild, fix round 1) | 168.4 kB | 87.8 kB | 307.0 kB | 41.3 kB / 15.4 kB |
| **M0b-1 tree, `domMax`** (shipped, `e9d90327`) | 168.4 kB | 87.9 kB | 307.1 kB | 88.0 kB / 28.8 kB |
| **`e9d90327` cold rebuild** (M0b-1 Task 1, mid-branch — the commit the row above was actually measured against; fix round 1) | 169.2 kB | 85.5 kB | 310.3 kB | 90.1 kB / 29.5 kB |
| **`2d635d38` cold rebuild** (the M0b-1 merge; fix round 1) | 169.2 kB | 110.3 kB | 335.3 kB | not cleanly isolable — see note below |
| **M0b-2 tip** (`857cd2d5`, this branch; fix round 1) | 169.2 kB | 110.2 kB | 336.8 kB | not cleanly isolable — see note below |
| **M1 tip** (this branch, `3c5e8cd4`) | 169.2 kB | 117.5 kB | 342.5 kB | not cleanly isolable — see note below |
| **M1 tip `3c5e8cd4`, release-day rebuild** (worktree, 2026-09-10 — a different environment: every column reads higher, shared included, so compare only within this pair) | 172.5 kB | 123.9 kB | 350.5 kB | not cleanly isolable — see note below |
| **M1 merge `c93d4494`** (same environment as the row above; the three follow-ups — dot centring, month-nav overflow, F1/F2) | 172.5 kB | 123.5 kB | 351.0 kB | not cleanly isolable — see note below |
| **`main` at `0414ee86`, R1 release-day rebuild** (git-archive cold build, APFS-cloned `node_modules`, same environment as the R1 row) | 172.5 kB | 123.5 kB | 350.9 kB | not cleanly isolable — see note below |
| **R1 tip `96555761`** (same environment; the library leaves home for `/biblioteca`) | 172.5 kB | 119.0 kB | 354.8 kB | not cleanly isolable — see note below |
| **R1 tip — `/biblioteca`** (new route, same build) | 172.5 kB | 112.9 kB (`/biblioteca`) | 121.5 kB (`/schedule`) | — |
| **`main 6e9a195c`, R2 release-day rebuild** (git-archive cold build, same environment as the R1 rows) | 172.5 kB | 121.5 kB (`/schedule`) | 355.7 kB | 114.2 kB (`/biblioteca`) |
| **R2 tip `444d015d`** (same environment; the week strip, the agenda and `SwipeStrip`) | 172.5 kB | 123.1 kB (`/schedule`, +1.6) | 356.4 kB (+0.7, build noise) | 114.2 kB (`/biblioteca`, unchanged) |
| **`main df19f1b5`, R3 release-day rebuild** (git-archive cold build, same environment as the R2 rows) | 172.5 kB | 129.8 kB (`/me`) | 356.5 kB | 119.9 kB (`/`; `/schedule` 123.6 kB, `/biblioteca` 114.2 kB) |
| **R3 tip `4b3e18ad`** (the header, weekend list, `SettingsCard`; the pill `tone` on `Button` touches every route by ~0.4–0.5 kB) | 172.5 kB | 132.2 kB (`/me`, +2.4) | 356.9 kB (+0.4) | 120.4 kB (`/`, +0.5); `/schedule` 124.1 kB (+0.5), `/biblioteca` 114.3 kB (+0.1) |
| **`main 61d5330f`, R7 release-day rebuild** (git-archive cold build, same environment as the R3 rows) | 172.5 kB | 118.0 kB | 354.4 kB | 121.7 kB (`/schedule`) · 111.9 kB (`/biblioteca`) · 119.5 kB (`/me`) |
| **R7 tip `6fcfb22c`** (the cue strip, blackout, pull-to-refresh rail, long-press hook + sheet; the two later commits move classes and one sheet, not chunks) | 172.5 kB | 122.1 kB (+4.1) | 357.0 kB (+2.6) | 124.1 kB (`/schedule`, +2.4) · 116.9 kB (`/biblioteca`, +5.0) · 123.1 kB (`/me`, +3.6) |
| **`main 7fbbb105`, R4 release-day rebuild** (git-archive cold build, same environment as the R7 rows) | 172.5 kB | 122.6 kB | 357.6 kB | 110.7 kB (`/posts/[slug]`) · 124.6 kB (`/schedule`) · 117.0 kB (`/biblioteca`) · 123.6 kB (`/me`) |
| **R4 tip `5a899be0`** (the transposer seat, hero pills, practice cluster, autoscroll, equaliser; the three later commits move classes and handlers, not chunks) | 172.5 kB | 121.2 kB (−1.4) | 356.2 kB (−1.4) | 111.7 kB (`/posts/[slug]`, **+1.0**) · 123.3 kB (`/schedule`, −1.3) · 115.7 kB (`/biblioteca`, −1.3) · 122.3 kB (`/me`, −1.3) |

Commit e9d90327's body says first-load does not move; the A/B above is the
evidence for that claim, measured after the fact.

The two M0b-1 rows are a confirmatory A/B run on the *same* tree (the M0b-1 branch
`claude/motion-m0b-overlays-controls`, merged as `2d635d38`,
same commit of everything except `motionFeatures.ts`'s one-line export): first
`domAnimation` was reinstated locally (uncommitted), built, and measured; then
`domMax` was restored via `git checkout --` and rebuilt. Shared moved by 6
bytes between the two builds (172,475 B → 172,481 B, both rounding to 168.4 kB)
even though `motionFeatures.ts` is dynamically imported and never appears in
`rootMainFiles`/`polyfillFiles` — that 6-byte drift is Turbopack build
non-determinism on an unrelated build, not a `domMax` effect. `/` moved +0.1 kB
and `/admin` moved +0.1 kB between the two rows, both inside the ±0.5 kB
budget the switch was expected to hold. The async feature chunk is the only
number that moved meaningfully: 41.3 kB raw / 15.4 kB gz (`domAnimation`) to
88.0 kB raw / 28.8 kB gz (`domMax`), the ~13 kB gz cost of layout projection
plus drag — exactly the change under test, isolated from everything else.

This A/B also resolves the finding-1/finding-2 hole from the first measurement
pass. Shared and first-load did **not** move between `domAnimation` and
`domMax` on this tree — they moved between M0a's merge-base build (172.3 /
89.7 / 314.2, recorded on a different tree entirely, the fix-wave's) and any
build of *this* tree (168.4 / 87.8–87.9 / 307.0–307.1, true for both
`domAnimation` and `domMax` here). Since the drop reproduces identically
whichever feature set `motionFeatures.ts` exports, it cannot be the `domMax`
switch; it belongs to something else that changed on this tree ahead of
M0b-1. The two loading-skeleton commits already merged onto the M0a branch before
M0b-1 (`ecb6c86b`, `e6b2b46c` — both touch `app/(client)/loading.tsx`, the
loading boundary shared by `/` and `/admin`, plus `Skeleton.tsx`) remain the
only commits between the fix-wave's measurement and this one that touch
route-rendered code, and are the most plausible source of the −3.9 kB /
−1.9 kB / −7.2 kB (shared / `/` / `/admin`) difference against the fix-wave
numbers — but that is still an inference from "no other candidate commit
exists," not a rebuild of the pre-skeleton-commits tree, which this pass did
not do either.

The middle row is what M0a originally shipped (`LazyMotion features={domAnimation}`,
loaded synchronously by `MotionProvider`); the last row is this fix wave's change
(`LazyMotion features={() => import("./motionFeatures").then(…)}`, ADR-0031 Important
finding 2). Loading the feature set as its own async chunk — which ships after
hydration instead of inside the first-load script — took each route from ~24 kB gz to
~12.4 kB gz, roughly half. The **async feature chunk itself** (motion-dom's
feature-definitions module, identified by an A/B diff: a chunk unique to the async
build, unreferenced by any route's client-reference manifest, containing motion-dom's
feature signatures `animateVisualElement`, `Presence`, `Exit`, `layout`) is **42.3 kB
raw / 15.8 kB gz** — bigger than either route's net saving, because it now pays its
own gzip framing instead of sharing compression context with code that stayed in the
first-load bundle.

Programme cap: +25 kB gz total. At this M0a fix wave, both route deltas landed well
under the hard cap and under the ≤20 kB expectation the programme opened with —
`motion`'s `domAnimation` feature set plus the four M0a primitives' own code
(`Presence`, `Skeleton`/`SkeletonGroup`, `Button`, `MotionProvider`) together cost
~12.4 kB gz on a route that renders them, not the ~24 kB the synchronous load cost.
The M0b-1 merge later added its own +24.8 / +25.0 kB (see the fix-round-1 measurement
below), and the cap was re-based at +32.9 / +35.1 kB with Frank's acceptance on 2026-09-09 — see the "Cap status" line further down. The shared/root chunk
barely moves (+0.02 kB, noise) because `MotionProvider` is mounted inside
`app/utils/Provider.tsx`, which is wired from the `(admin)` and `(client)` route-group
layouts, not the app root — so the cost is paid by the routes that render it, not by
every route in the app (e.g. bare API routes pay nothing). `motion` resolved the
`MotionGlobalConfig` export from `motion/react` (not the bare `motion` package
specifier); `motion/react-m`'s per-tag hosts (`m.div`, `m.section`, …) are named
exports of that submodule, which is why `Presence.tsx` imports them as
`import * as m from "motion/react-m"` rather than a default export.

M0b's `SlidingIndicator` needs `domMax`, not `domAnimation`, for layout projection
(`layoutId`). M0b-1 switched `motionFeatures.ts` to `domMax` and measured it with the
same A/B method: on a `next build` here, the async chunk is the one file under
`.next/static/chunks/` that is unreferenced by `build-manifest.json` and by every
route's `page_client-reference-manifest.js`, and that carries motion-dom's feature
signatures (`animateVisualElement`, `Presence`, `Exit`, `MeasureLayout` — this build's
minifier did not preserve a literal `HTMLProjectionNode` string, but `MeasureLayout`
alone is enough to distinguish it from the plain `domAnimation` chunk, which had
neither). That chunk is **90 088 B raw / 29 468 B gz (88.0 kB raw / 28.8 kB gz)** —
well under the spec's Part VI 40 kB gz cap, and about 13 kB gz heavier than
`domAnimation`'s 15.8 kB, the cost of layout projection plus drag (motion 13 ships
them as one bundle; there is no public layout-only feature set).

The first measurement pass flagged `/` and `/admin` moving −1.8 kB and −7.1 kB
against the fix-wave's recorded 89.7 kB / 314.2 kB — more than the ±0.5 kB this
switch alone should produce — as an open question, since it did not rebuild
`domAnimation` on this tree to isolate the cause. The Bundle table's two
`M0b-1 tree` rows above are that confirmatory rebuild: `domAnimation` and
`domMax`, same tree, same commit apart from that one export. See the
paragraph under the table for what it shows.

**Fix round 1 (2026-09-09): the "rebuilt today" row above was comparing the wrong
two commits, per a critical review finding.** It measured `2d635d38` (the M0b-1
merge) against the ledger's `87.9 kB / 307.1 kB` row, which was actually measured at
`e9d90327` (2026-09-08, mid-branch — `git diff e9d90327 2d635d38 --stat` is 54 files
changed, 2 653 insertions / 1 156 deletions: `Toast.tsx`, `Menu.tsx`, `Collapse.tsx`,
the expanded `CueDialog.tsx`, and their admin/shell wiring). So the ~25 kB gap that
row reported was most likely M0b-1's own shipped cost, never measured at its merge —
not "Turbopack drift" as the paragraph below used to claim. `package-lock.json` is
unchanged between `e9d90327` and `2d635d38`; it gains 10 lines between `2d635d38` and
this branch's tip (`a1d0fa49`, the haptics plugin) — the rebuild below reused one
`node_modules` (an APFS clone, `cp -Rc`, of this worktree's install) across all three
trees regardless.

To settle it, three trees were exported cold — `git archive <sha> | tar -x` into a
clean scratch directory, `node_modules` cloned in (not symlinked: Turbopack's own
root-detection rejects a `node_modules` symlink that resolves outside the export
directory — "Symlink [project]/node_modules is invalid, it points out of the
filesystem root" — so an APFS clone stood in for it, zero-cost and identical to a
symlink for this purpose), `.next` removed, `next build` from scratch — and measured
with the identical script, in the same environment, on the same day: `e9d90327`
itself (the commit the ledger's `87.9 / 307.1` row was actually measured against),
`2d635d38` (the commit the old "rebuilt today" row meant to isolate), and this
branch's tip (`857cd2d5`). All three rows in the table above are that rebuild.

The cold rebuild of `e9d90327` does **not** reproduce `87.9 kB / 307.1 kB` within
~1 kB: it measures `/` = 85.5 kB (−2.4 kB) and `/admin` = 310.3 kB (+3.2 kB). That is
consistent with the same-commit rebuild drift already documented elsewhere in this
section (the 6-byte shared-chunk drift between the `domAnimation`/`domMax` A/B, both
inside a ±0.5 kB budget) — a few kB of Turbopack chunk-splitting noise on an
unmodified commit, not a new phenomenon. Shared reproduces far more tightly — 169.2 kB
against the recorded 168.4 kB, +0.8 kB — because it sums a small, fixed set of
framework files Turbopack's chunk splitter doesn't touch; all three rows above measure
it at exactly 169.2 kB, byte-identical.

Against that ~3 kB noise band, the gap between `e9d90327` and `2d635d38` is an order
of magnitude larger and moves in one direction: `/` moves **+24.8 kB** (85.5 → 110.3)
and `/admin` moves **+25.0 kB** (310.3 → 335.3), cold, same script, same day. That
matches the reviewer's finding almost exactly — it is M0b-1's own shipped cost (the
Toast/Menu/Collapse/CueDialog expansion named above), not Turbopack instability, and
every sentence in this section that previously attributed a gap of this size to chunk-
splitting drift was wrong and has been removed.

M0b-2's own cost, `857cd2d5` vs `2d635d38`, is small by comparison and inside the
noise band established above: `/` moves **−0.1 kB** (110.3 → 110.2) and `/admin`
moves **+1.5 kB** (335.3 → 336.8).

The async motion-feature chunk could not be cleanly isolated for `2d635d38` or
`857cd2d5` in this rebuild. Its signature strings (`animateVisualElement`,
`MeasureLayout`, `Exit`) turn up inside a single 422.5 kB chunk (`44zm1rbsb67qq.js`,
byte-identical between the two commits, so it is not part of either commit's own
diff) that Turbopack fused together with roughly 380 kB of `@sanity`/Studio code. The
theme gallery's `GalleryMotion` loads `domMax` synchronously by design (Rules §4), so
it is legitimately referenced by the gallery and Studio routes — and in this build
Turbopack packed it into their shared vendor chunk instead of splitting it into its
own file the way it did for `e9d90327`, whose isolated chunk measured 90.1 kB raw /
29.5 kB gz (close to but not identical to the ledger's 88.0 / 28.8 — the same few-kB
class of drift as the route figures above). No raw/gz figure is reported for
`2d635d38` or `857cd2d5`'s async chunk as a result; every measurement that HAS
isolated it, across every commit checked so far, stays well inside the spec's 40 kB
gz cap for that chunk specifically.

The absolute Δ against "Before M0a" (77.3 kB / 301.7 kB — itself only rebuildable in a
stale environment; Task 13's failed attempt at that rebuild is unchanged by this fix
round) is, from this branch's tip: `/` **+32.9 kB**, `/admin` **+35.1 kB**.

**Cap status (§7 +25 kB gz first-load): ACCEPTED by Frank on 2026-09-09** ("merge,
accept", with M0b-2's release) — the absolute Δ is +32.9 kB (`/`) / +35.1 kB (`/admin`)
against "Before M0a", and that is now the programme's recorded cost; §7's +25 kB line
is superseded by this figure (spec Part VIII) — **exceeded by M1 and re-accepted by
Frank on 2026-09-10 at +40.2 / +40.8 absolute** (spec Part IX: structural growth, the
«Más» sheet body too small to be worth deferring; the follow-ups moved the routes −0.4 /
+0.5 kB in a same-environment A/B, build noise). A later phase may
still defer the sheet-drag/`AnimatePresence` path behind a dynamic import if the
number needs to come down. This does not retroactively validate the
Before-M0a-anchored deltas recorded for M0a above; a clean same-environment rebuild of
"Before M0a" itself would still be needed before trusting an absolute cap check
against it without caveat.

**What the +24.8 kB is** (forensics, 2026-09-09): framer-motion's core runtime
(`AnimatePresence`/`useMotionValue` machinery, ~63 kB gz across the chunks that carry
it, an upper bound) became reachable for the first time when `Toast`, `Menu` and the
expanded `CueDialog` were mounted app-wide via `app/utils/Provider.tsx` and the
Navbar; the same import already existed in `Presence.tsx` at `e9d90327` but nothing
imported `Presence`, so it cost nothing. motion 13.2.0 has no slimmer entry for
`AnimatePresence`/`useMotionValue` (`motion/react` is the full `framer-motion`
barrel; `motion/react-m` is hosts only; the mini entries export neither); moving
`animate` to `framer-motion/dom` produced a byte-identical build; the gallery's
synchronous `domMax` fuses into a Studio-only chunk absent from `/` and `/admin`. The
two real options are to accept the number as the programme's cost, or a later
architectural deferral of the sheet-drag/AnimatePresence path behind a dynamic
import — Frank's call.

**M1 tip (`3c5e8cd4`), measured cold, same method as the fix-round-1 rebuilds
above** (2026-09-09): `git archive HEAD | tar -x` into a clean scratch
directory, `node_modules` cloned in via APFS `cp -Rc` (an outside symlink is
rejected by Turbopack's own root detection, same finding as before), `.env.local`
symlinked, `.next` removed, `next build` from scratch under Node 22 (this
worktree's default `node` resolves to 20.x — the build was run with Node
22.22.3 explicitly on `PATH`, per the repo's `engines` field). Shared reproduces
the M0b-2 tip's figure exactly — **169.2 kB**, no drift — because the migrated
sites this milestone touches (`BottomNav`, `NavLinks`, `Presence`, `AudioPlayer`,
`SongSheet`) are all route-rendered code, never `rootMainFiles`/`polyfillFiles`.
`/` moves **+7.3 kB** (110.2 → 117.5 kB) and `/admin` moves **+5.7 kB** (336.8 →
342.5 kB) against the M0b-2 tip — both outside the ±3 kB band this task treats
as noise. The reason is structural, not incidental: `BottomNav` was a file that
existed but was **not mounted anywhere** before M1 Task 2 (its commit message
says "BottomNav returns"); M1 is the milestone that actually renders it — plus
the brand-new `NavLinks` — inside `app/(client)/layout.tsx` and `Navbar.tsx`,
both of which wrap every route in the `(client)` group, `/` and `/admin`
included. Both pull in `SlidingIndicator`'s `layoutId` machinery and (`BottomNav`)
a `CueDialog` sheet on every route that renders the shell, not only the ones
that open a dialog on their own. The async feature chunk is, again, **not
cleanly isolable**: its signature strings (`animateVisualElement`,
`MeasureLayout`, `Exit`) turn up inside a single **422 535 B (422.5 kB)** chunk
(`44zm1rbsb67qq.js`) — byte-identical in size to the chunk M0b-2 reported at the
same name and size, unreferenced by either `/` or `/admin`'s
`page_client-reference-manifest.js`, fused with Studio/gallery vendor code by
Turbopack the same way it was at the M0b-2 tip. The absolute Δ against "Before
M0a" (77.3 kB / 301.7 kB) is now `/` **+40.2 kB**, `/admin` **+40.8 kB** —
**past the accepted cap of +32.9 kB / +35.1 kB by +7.3 kB / +5.7 kB**, the exact
size of this milestone's own marginal cost above, reported here without
trimming anything. Frank accepted the new number on 2026-09-10 at the M1 release
(the cap-status paragraph above; spec Part IX has the reasoning).

## Where the walk's findings landed

Part III of the spec catalogues every element. M0a closes findings 3 (lockup priority)
and 5 (initials contrast) — `shellPolish.test.ts`.

### Shell (M1)

M1 is the app chrome: the phone tab bar, the desktop nav links, the avatar badge,
the impersonation banner, the audio transport, and the song sheet's head.

- **`BottomNav`** (`app/components/BottomNav.tsx`) — three worship tabs (Inicio ·
  Calendario · Biblioteca) or the kids-only set (Kids · Planear Kids when
  managesKids applies), plus a **«Más»** tab that holds only what those tabs
  cannot fit: `Kids` (worship member also in Kids), `Planear Kids` (worship
  member who manages Kids), `Admin` (admin/content-editor/super-admin). **Tema,
  Cerrar sesión and «Yo» all live in the avatar menu (`NavMenu`) now, not
  here** — M1 follow-up F1 moved the account actions and F2 moved «Yo»,
  because `/me` has one home, the avatar menu. When none of the
  three rows applies (the common case: a plain worship member with no Kids
  ministry), the «Más» button itself does not render — the bar shows the
  tabs alone — and the sheet never opens. A bar with fewer than two items
  (tabs + «Más») is not a bar: the kids-only volunteer with no planner rights
  has one tab and no «Más» row, so `BottomNav` renders nothing at all and
  publishes neither `--bottom-nav-h` nor `has-bottom-nav` — their avatar menu
  still carries Mi semana. **«Más» is a
  `CueDialog` sheet** (`mode="sheet"`, `size="sm"`), not the hand-rolled
  `inert`/backdrop panel it used to be, rendered unconditionally with
  `open={moreOpen}` even when the triggering button is absent (only the button
  is conditional, never the dialog element — the `cueDialogMount` guard).
  Hidden at `lg` and above, and on `/auth*`/`/studio*`. Publishes its MEASURED `offsetHeight` in px as
  `--bottom-nav-h` on `<html>` plus a `has-bottom-nav` class while it is mounted
  AND on screen (the `lg:hidden` media query, not a constant, decides "on
  screen" — `getComputedStyle(bar).display !== "none"`, since `offsetParent` is
  always `null` under jsdom regardless of real layout); clears both on unmount.
  `bottomNavOffsetSync.test.ts` lists every fixed-bottom element that must clear
  it and how: **toasts** use `max(env(safe-area-inset-bottom),
  var(--bottom-nav-h, 0px))` (the inset when the bar is absent, the bar — which
  already carries the inset — when it is present, never both stacked); the
  **audio transport** sits flush on the bar via `var(--bottom-nav-h, 0px)`
  alone, with its own inset padding zeroed under `html.has-bottom-nav
  .audio-player`; the **song FAB** (`EditSongButton`) offsets by `calc(1.5rem +
  var(--bottom-nav-h, 0px))`. A new fixed-bottom element joins that guard's list
  in the same commit that adds it.
- **`NavLinks`** (`app/components/NavLinks.tsx`) — the desktop link row, rendered
  inside the navbar's centred title block at `lg` and above; the page title that
  block otherwise shows is `lg:hidden` there (the page's own heading carries it
  on desktop, and the phone/tablet title stays as before below `lg`). One shared
  `SlidingIndicator id="nav-links" variant="underline"` renders inside whichever
  link is active; ministry-filtered the same way `BottomNav` is (cosmetic — the
  pages themselves enforce access).
- The **avatar notification badge** (`NavMenu`) now pops in with `<Presence
  show={notifCount > 0} appear variant="scale">` instead of a plain conditional
  `<span>`. **`NavMenu` is an ACCOUNT menu, all widths** (M1 follow-up F1):
  `Mi semana` (`/me`), `Disponibilidad` (`/me/disponibilidad`), `Ajustes` (`/me/ajustes`),
  a separator, `Cerrar sesión` — Frank's look at R3 F3 (2026-09-13) found «Mi perfil»
  pointing only at `/me/ajustes`, leaving `/me` («Mi semana») unreachable except by URL
  since the tab bars dropped «Yo» at F2; the menu is `/me`'s one home, so it now names all
  three halves, and Tema folds into Ajustes rather than getting its own item. It no
  longer repeats Calendario, #Tags, Oasis Kids, Planear Kids or Admin, which
  already have a home in `NavLinks` (desktop) or `BottomNav`'s tabs/«Más» sheet
  (phone). The `showSchedule`/`showTags` props and their ministry/role
  computations are gone with them.
- **`ImpersonationBanner`** drops in on `<Presence variant="drop">` — but
  `appear` is passed only when impersonation STARTS IN-SESSION, never when the
  session resolves already impersonating. That distinction exists because of
  the feature-chunk trap documented under "Load-failure behaviour" above: an
  unconditional `appear` would render an admin's hard-refresh-while-impersonating
  page at the `drop` variant's `initial` (`opacity: 0`) until the async `motion`
  chunk resolves — invisible, indefinitely, if the chunk never loads — while the
  navbar had already reserved space for a banner nobody could see. "Already
  impersonating" is read from the FIRST RESOLVED SESSION STATUS, not the first
  render: `Provider.tsx` mounts a bare `<SessionProvider>`, so the component's
  literal first render is always `status: "loading"` with no session data yet,
  on every load, whether or not the session turns out to be mid-impersonation —
  a flag frozen at that render always reads "not yet active" and takes the
  animated path regardless. `Presence` itself is not mounted until `status`
  leaves `"loading"` (nothing shows during that gap either way, since an
  unresolved session is never active), so its own "is this my first commit"
  bookkeeping lines up with the first commit that could ever show the banner —
  a later commit adding the child is always an "enter" internally, `appear` or
  not, so the animation-skipping mount and the animated in-session mount have
  to be different COMMITS, not just a different prop on the same one. A mount
  that resolves already active renders at rest and publishes
  `--impersonation-h` (its MEASURED height, same pattern as `--bottom-nav-h`)
  synchronously, in the same effect that used to run unconditionally; an
  in-session start animates and publishes the height from `onEntered`, once
  the drop-in has actually landed.
- **`AudioPlayer`**'s host is itself a `<Presence show variant="sheet">` (no
  fixed descendant — the `Presence` host carries `fixed inset-x-0` directly,
  the allowed exception to rule 5) that enters on `SPRINGS.sheet` and exits on
  the ordinary `EXIT_MS` ease-out fade (a spring on the way out would overshoot
  the edge). Its progress fill animates `transform: scaleX(progress)` on a
  `w-full origin-left` element instead of resizing `width`, inside a track that
  carries `overflow-hidden` so the track's own rounding clips the fill instead
  of the fill drawing (and squashing) its own corners at low progress.
- **`SongSheet`** passes `title={sheet?.title ?? "Canción"}` to its `CueDialog`
  instead of drawing its own header — the dialog's head (grip on phones, the
  drag-to-dismiss surface, the `<h2>`) is now the ONLY head, and the hand-rolled
  eyebrow/title/close-button block is gone. What survived (the author, the
  key/BPM/time-signature pills) moved into one compact meta row rendered as the
  dialog's first child, ahead of the scrollable body.

### Library and run sheet (R1)

`/tag*`/`/author*` folded into `/biblioteca`, and home stopped being a wall of stacked
cards — see spec Part X for the full ledger; the motion-relevant pieces:

- **`AnimatedList`** (`app/components/ui/AnimatedList.tsx`) is the list-reflow primitive
  R1 introduced: `mode="popLayout"` pops a leaving row out of flow (the `NumberRoll`
  precedent) so the survivors slide to their new place at once instead of jumping as the
  leaver's space collapses under them; the host is `relative` because a popped item
  positions against it. `/biblioteca` is the one consumer — every A–Z section renders its
  rows through it, so filtering (Tipo, tema, artista, tonalidad, the search query) reflows
  rather than replacing the list wholesale.
- **The row pattern is now recorded twice more.** `LibraryRow` and `DayCardDisclosure`'s
  header both carry a plain `<button>` inside an `<li>`/wrapping `div` rather than the
  `Button` primitive — the ruling `DayCard`'s setlist rows already set: the row itself IS
  the affordance, so it carries no eyebrow and no "Ver" label. The letter rail's own
  buttons (after the A–Z sections, absolutely positioned in the `relative` list wrapper —
  DOM order no longer decides placement) take the same exemption for the same reason: bare
  tap targets in an index rail, not chrome.
- **The label budget moved four labels to zero** (`labelBudget.test.ts`, spec §18): `>Servicio<`
  (the old per-card "Servicio" eyebrow — `DayCard`'s day · date header carries that now),
  "Índice musical" and "títulos" (the old home song-list heading and its count — home shows
  the run sheet only, the song list moved to `/biblioteca` with no repeated count of its
  own; the ONE count on that surface lives in the search placeholder), and "Repertorio"
  (`PostComponent`'s song-card eyebrow — the card itself is gone).
- **The lit card** (`.brand-lit-card`, `--lit-beam` — see "The beam" above) is the home
  hero's one-shot border pass; it is the fifth enumerated beam use and the first CSS-only
  one (no `motion` import, so it costs nothing against the bundle budget below). Guarded by
  `litCard.test.ts`, which reads `brand.css`/`page.tsx` as text and cannot see geometry —
  see the file's own header for what closed that gap.
- **The letter rail is an INDEX BAR** (`LibraryLetterRail`, F3), not a list of links. It
  shows progress — the letter whose heading is in view carries `aria-current` and the accent,
  fed by ONE `IntersectionObserver` over the `h2#letra-*` headings in `LibraryIndex` (never a
  scroll listener): the band starts at 64 px, above the sticky heading offset, so the heading
  pinned under the navbar is the one inside it, and the last heading above the band wins when
  none intersects. And it scrubs — a pointer drag picks the letter under the finger by
  arithmetic on the rail's own box, jumping `behavior: "auto"` while the finger moves and
  `"smooth"` on a plain tap, with `haptic("selection")` per letter and `touch-none` so the
  page does not scroll underneath. A pill (`data-[scrubbing]:`) paints only while a finger is
  down, so the rail is invisible chrome at rest. Nothing animates through `motion`; reduced
  motion has nothing to opt out of beyond the smooth tap, which is the browser's own.
- **The filter drawer searches** (F3). Temas and Artista are both a `normalizeText` search box
  over a chip cloud sized by `postCount` — a 43-theme, 80-artist catalogue is not a list
  anyone scans, and the Artista `<Select>` is gone. A SELECTED chip that does not match the
  query pins to the front of the cloud rather than disappearing: an invisible chip is a filter
  nobody can remove. Artista is single-select (a second tap clears it, which is why it needs no
  «Todos» tile) and shows the twelve busiest artists before anyone types. `Tonalidad` keeps its
  `Select` — 15 options is a list.
- **Search reads the ARTIST, not the legacy `author` string** (F3). The Fuse index carries one
  flat derived field, `artist` (`artistOf` = `author` + every `authors[].name`, joined), weight
  1.5 under `title`'s 3, because `getFn` only ever reads `path[0]` and a nested `authors.name`
  key would read nothing. Before F3 a song whose artist lived only in `authors[]` — most of the
  catalogue — was unreachable by name.
- **The redirects** (`/tag*`/`/author*` → `/biblioteca`, `permanent: true` = 308) carry no
  motion of their own — a 308 is a full navigation, not a client transition — but they are
  why `/biblioteca` needed the `?q=`/`?tag=`/`?author=`/`?key=` URL contract
  (`libraryIndex.ts`'s `parseLibraryParams`/`serializeLibraryParams`) rather than being
  free to invent its own params: a bookmark to the old `/tag/:slug` has to land already
  filtered. Guarded by `redirects.test.ts`.

### Schedule (R2)

`/schedule` opened on a three-month grid and asked the reader to scan ~90 cells for the lit
ones to answer "when do I serve next." R2 makes the agenda the default: one row per service,
in date order, under a month divider — see spec Part XI for the full ledger; the motion-
relevant pieces:

- **`ScheduleHeader`** (`app/components/ScheduleHeader.tsx`) replaces the old range-label-plus-
  worded-buttons row, which overflowed a 390 px phone. One `h2` truncates inside a
  `min-w-0 flex-1` cell instead of carrying a fixed width, so the overflow is gone by
  construction; the arrows either side are `Button variant="icon"` **with `href`**, so paging
  is a navigation (`?m=`, one month per press) and the route reveal carries the transition
  (decision C) — the back button keeps working. The month `DateField` carries no `onStep`
  stepper pair (see its row above) — the arrows already own those accessible names. With the
  page's own `h2` gone, this header IS the route's heading; the rolling (non-browsing) view
  adds a small «Próximos» sublabel under the month so a reader knows the named month is where
  the rolling fetch starts, not a month being browsed.
- **`DayStrip`** (`app/components/DayStrip.tsx`) is a WEEK strip, not the month-long scroller
  the plan drew: seven cells in a `grid-cols-7`, no inner scroller. The plan's month-long strip
  shipped once and could not be finger-scrolled — `SwipeStrip`'s own host sets
  `touch-action: pan-y`, so the browser never hands the horizontal axis to a nested scroller,
  and the only way to reach day 20 on a phone was the swipe, which paged the whole month. So
  the drag now pages the WEEK in client state (`onSwipe` → `onWeekChange?(mondayIso)`, which
  `CalendarView` uses to scroll the agenda to the paged week), and the header's arrows keep the
  month axis — two gestures, two axes, neither hidden behind the other. A caption above the
  cells (`weekRangeLabel`, e.g. «7 – 13 sep») is the only label that moves, since the header's
  month heading does not. **Today's dot pulses once** on reveal (`brand-today-pulse`, 600 ms,
  ends on `transform: none` so it never becomes a containing block for a fixed descendant) and
  then rests at the month grid's ordinary dot opacity — centred with a negative margin rather
  than a translate, because the pulse animates `transform` and would override a translate
  utility for the whole pass.
- **`SwipeStrip`** (`app/components/ui/SwipeStrip.tsx`, added mid-R2 — see its primitives row
  above) is the drag-with-snap host the week strip was built against; the strip is its one
  production consumer. The header's own month paging is not a drag — it's two `Button
  variant="icon"` links (`href`, a `?m=` navigation).
- **`AgendaView`** (`app/components/AgendaView.tsx`) lays out service days only, one row each:
  day · short date, an upcoming-only countdown pill (`NumberRoll`), who leads and how many
  songs (`summarizeService`), and `⚠ N conflicto(s)` (`conflictLabel`) when someone is seated
  twice within one section. All of the arithmetic — ordering, month breaks, the summary line,
  the conflict count — lives in `app/utils/agenda.ts` (`agendaRows`), so this component only
  lays it out; a special service names itself in the row (Sábado/Domingo don't, the day word
  already says it). Rows open the existing day sheet (`CueDialog`, unchanged).
- **F1 — the agenda says when it's you.** The retired «Lista» rendered stacked `DayCard`s,
  whose seats glow positive for the signed-in member (`myName` = `alias?.trim() || name`,
  lowercased); the agenda's one-line rows dropped that signal entirely. `app/utils/agenda.ts`
  gained `myNameFromSession` (the one reader of `session.user`, now shared by `DayCard`) and
  `mySeats(entry, myName)` (the seat labels in DayCard's own order: Lead, BGVs, Coro, each
  instrument, each FOH seat). A row where `mySeats` is non-empty carries a `Tú · Lead, Keys`
  pill after the countdown and a positive glow on its tone rail (DayCard's own «you» tone);
  `aria-label` gains `, te toca: Lead, Keys`. The week strip's lit-and-seated day gets a second,
  positive dot under the number (`StripDay.mine`, `weekStripDays`/`monthStripDays`'s new
  optional `myName` argument); `CalendarView` derives `myName` once and passes it to `DayStrip`,
  while `AgendaView` reads its own `useSession` (same pattern as `DayCard`).
- **The mode crossfade is a plain keyed fade, not stacked panels.** `CalendarView` keys
  `Presence` on the mode (`agenda` | `month`), so switching unmounts one panel and mounts the
  other — no exit, no host of known height. The plan's stacked-panels design needs exactly
  that: a host tall enough for the taller panel, and the agenda is as tall as the fetch window
  has services while the grid is three months, so any `min-h` big enough for one leaves the
  other in blank space. This is the plan's own recorded fallback, not an improvised deviation.
  `appear` is `switched` — **false until the reader actually flips the `SegmentedControl`** —
  so first paint renders at rest (the M0b rule against `appear` above the fold, ADR-0031; the
  `ImpersonationBanner` `activeAtLoad` precedent); the crossfade exists for switches only.
- **Deviations from the plan, accepted.**
  - **The strip is a week strip, not the plan's month-long scroller** — see `DayStrip` above;
    the plan's design could not be finger-scrolled inside `SwipeStrip`'s own drag host.
  - **The swipe pages weeks, not months** — the month axis stays on the header's arrows, a
    server-driven navigation; the week axis is the one gesture the strip's container can
    actually deliver.
  - **Conflicts are counted per SECTION** (voces / instrumentos / foh), not per service —
    `serviceConflicts` sums `findDuplicates` over each section separately, so the same person
    seated in two different sections is not a conflict, only a repeat within one.
  - **The crossfade is a plain keyed fade, no stacked-panel height trick** — see above.
  - **`appear` only after a switch**, never on the mode the route mounts with — the M0b rule.
  - **Month paging is server-driven and enters via the route reveal** (decision C) rather than
    a directional slide; decision C makes every schedule transition enter-only anyway, so a
    slide had nothing to pair against.
  - **Deferred to R7:** pull-to-refresh, long-press quick actions — unchanged from the Part IX/
    Part X deferral, R2 did not pull either forward.
- **Bundle:** `main 6e9a195c` → `R2 tip 444d015d` (git-archive cold build, same
  environment): `/schedule` 121.5 kB → 123.1 kB (+1.6), `/biblioteca` 114.2 kB
  unchanged, `/admin` 355.7 kB → 356.4 kB (+0.7, build noise); shared unchanged. The
  week strip, the agenda and `SwipeStrip` cost 1.6 kB on the route — see the "Bundle"
  section above for the rows.

### Me (R3)

The walk found `/me` leading with two headings that named what the member was looking
at («Mis próximos servicios», «Próximos servicios») and then printing every assignment
as a full card, with a twelve-month grid asking the member to find a date when the
question they actually answer is «¿este fin de semana puedes?» — see spec Part XII for
the full ledger; the motion-relevant pieces:

- **`useAvailability`** (`app/components/availability/useAvailability.ts`) is the save
  machinery — the revision-guarded PATCH, the one-time sibling rebase, the held
  conflict, the dirty fingerprint, the `beforeunload` guard — lifted out of the grid
  component so a second surface can read and write the same state without a calendar.
  `MyAvailabilityPanel` (the host, renamed off `AvailabilityPanel` mid-branch — that name
  collided with the unrelated admin panel) calls it exactly ONCE and hands the resulting
  state down to `AvailabilityGrid` (and, until F3, `WeekendList`), which keeps only what it draws.
  Two hook calls on the same `unavailableDates` would be two revisions and two dirty
  fingerprints racing into the same Sanity document — the lost-update guard `ifRevisionId`
  exists to refuse.
- **`WeekendList`** (retired in F3, kept as history) was the default availability surface: the next ten weekends
  (`nextWeekends`/`weekendLabel`, `app/utils/weekends.ts`), each a row of two
  `Button variant="pill" tone="availability" size="lg"` toggles (`aria-pressed`), «SÁB» and
  «DOM» (two before F1; three since — see the F1 bullet below). **Ruling: pill toggles, not `SegmentedControl`, are right here** — a
  `SegmentedControl` is a one-of-N choice with a sliding thumb, and a weekend's two days
  are two INDEPENDENT booleans (a member can be unavailable Saturday, Sunday, both, or
  neither), which is exactly the shape `Button`'s `pill` variant with `aria-pressed`
  already covers, not a second primitive. Pressed reads as «no puedo», in the pill's
  `availability` tone (`Button` gained a `tone` prop in fix round 1 — text `soft`, not
  `strong`, which is what clears 4.5:1 in light); a day already past renders `disabled`
  rather than pressable, and the pills plus the «Razón» ghost sit at `size="lg"` for the
  44 px touch target.
- **The twelve-month grid stays** (since F3 it is the ONLY surface, always open on `/me/disponibilidad` — the «Ver calendario» disclosure below is history), for a Tuesday rehearsal or a two-week trip the weekend
  list cannot express, behind a `Collapse` opened by «Ver calendario» — a disclosure, not
  a second default: the grid answers the edge case, the list answers the common one. The
  shared «Repetir…» recurring panel moved up to the host for the same reason the hook did,
  so both surfaces mark or clear the same weekday pattern against one state.
- **"Guardado ✓" is a `useToast` toast**, fired from the hook's new `onSaved` callback,
  not the old inline flash driven by a `saved` flag — a flag that is also `false` while
  the save is in flight reports success from a transition rather than from the actual 200.
- **`MeHeader`** is the page's new heading — it replaces both retired `h2`s outright. It
  says the one line a member opens `/me` for: *«Te toca el domingo 13 · Lead»*, with the
  countdown as a `NumberRoll` in the hero's own pill chrome (two countdowns on one page
  that disagreed on their chrome would read as two different things). Below the header,
  the next service renders as `<DayCard {...} hero />` **without `isNext`** — `isNext` is
  what makes `DayCard` draw its OWN countdown pill, and passing it here would put a second
  countdown for the same date beside the header's. `MeHeader` receives plain data
  (`next`, `kidsNext`, `inWorship`), never a function: the page is a Server Component and
  `nextSeatLine`/`seatLabel` (the neutral `app/utils/myWeek.ts`) run there (ADR-0028).
- **`SettingsCard`** turns three framed boxes into one: `section#ajustes`, `divide-y`,
  holding `ThemeControl bare`, `TextSizeControl bare` and (when the profile read
  succeeded) `ProfilePanel … bare`. **The impersonation ruling:** `ThemeControl` returns
  `null` while impersonating (it always 403s the write), and it keeps OWNING its own
  `p-5` padding in `bare` mode rather than being wrapped in a padding `div` by the card —
  a wrapped `null` still reserves the padding, leaving an empty box in the card's
  `divide-y` sections; an unwrapped `null` leaves nothing at all. `id="tema"` renders
  either way, so the cross-page `/me/ajustes#tema` anchor (`ThemeAnnouncement` on `/me`)
  still lands on something — the avatar menu itself has no `#tema` item since the R3 F3
  look-fix folded Tema into Ajustes.
- **`ThemeAnnouncement` dismisses through `Presence`, not `show && <aside>`** — the
  dismiss gets an exit instead of vanishing (spec §5.6). No `appear`: `show` starts
  `false` and flips in a mount effect, so the instance is already mounted when it becomes
  visible and the ordinary enter runs — `appear` would both violate the M0b rule (an
  above-the-fold element animating in on first paint) and be redundant here, since the
  banner is already showing by the time anyone could see an `appear` transition.
- **Deviations from the plan, accepted.**
  - **The host renamed to `MyAvailabilityPanel`**, not the plan's `Availability` — it
    shared a name with the unrelated admin `AvailabilityPanel`, caught in fix round 1.
  - **The grid moved file**, `app/components/AvailabilityCalendar.tsx` →
    `app/components/availability/AvailabilityGrid.tsx`, beside the rest of `/me`'s
    availability surfaces rather than staying at the top level.
  - **`app/utils/memberTypes.ts`** was not in the plan — it came out of a fix round once
    `MeHeader`'s Tipo chips needed labels: the admin PATCH route's write allowlist and
    `/admin`'s own abbreviated table labels were already two independent copies of the
    same six-value list with nothing stopping them from drifting apart, and `MeHeader`
    was about to become a third.
  - **`NextServiceHero` is deleted**, not reused as the plan assumed — the hero now
    renders as a direct `<DayCard {...} hero />`, and the countdown that used to live in
    the hero component now lives in `MeHeader` instead; a wrapper that only forwarded
    props to `DayCard` had no remaining job once the header owned the countdown.
- **Bundle:** `main df19f1b5` → `R3 tip 4b3e18ad` (git-archive cold build, same
  environment as the R2 rows): `/me` 129.8 kB → 132.2 kB (+2.4), `/admin` 356.5 kB →
  356.9 kB (+0.4), `/` 119.9 kB → 120.4 kB (+0.5), `/schedule` 123.6 kB → 124.1 kB
  (+0.5), `/biblioteca` 114.2 kB → 114.3 kB (+0.1); shared unchanged. The header, the
  weekend list and `SettingsCard` cost 2.4 kB on `/me`; the pill `tone` on `Button`
  touches every other route by ~0.4–0.5 kB — see the "Bundle" section above for the rows.
- **F1 (Frank's look) — retired in F3 (2026-09-12), kept as history.** The weekend rows
  and the range panel this bullet describes are gone: `WeekendList` was deleted and its
  «Rango…» `Collapse` went with F2 below. Two asks after seeing R3 live — rehearsals are Fridays, so each
  `Weekend` (`app/utils/weekends.ts`) grew a `fri` field and `WeekendList` rows became
  `VIE`/`SÁB`/`DOM` triplets (`weekendLabel` now spans Friday → Sunday, «11 – 13 sep»);
  and a special service mid-week needs more than the ten weekend rows can express, so
  `useAvailability` gained `applyRange(startIso, endIso, add)` and `MyAvailabilityPanel`
  a «Rango…» `Collapse` beside «Repetir…» (two `DateField kind="date"` inputs, opening
  one panel closes the other) — **superseded by F2 below**, which moves those same fields
  into `AvailabilityGrid` under «Rango por fechas». Three `size="lg"` pills at 390 px do NOT always fit
  beside the label on one line: the page's `px-6` leaves 342 px of content, and a
  marked day's «Razón ✓» ghost (`size="lg"`, ~90 px) widens its column, so three
  marked columns plus gaps run ~297 px — against a month-crossing label like
  «30 oct – 1 nov» (~100 px), the row needs ~409 px, more than the 342 px available
  (fix round 1, review). The `<li>` is `flex flex-wrap … justify-between`, the label
  `whitespace-nowrap` (never `shrink`, which is the flex default and was a no-op),
  and the pill cluster `ml-auto`: it right-aligns beside the label when there is
  room and wraps onto its own line, still right-aligned, when there is not — the
  cluster wraps under the label, never the label into word-per-line. No pill-size
  change was needed. Neither ask changed the grid, which stays for a single weekday
  the range panel doesn't fit either.
- **F2 (drag-select, 2026-09-12).** Frank's next look asked for the range itself to come
  from dragging through the calendar rather than typing two dates: a held-click drag
  across the days, a "shadow" of the next month fading in underneath as the finger
  nears the bottom of the page and solidifying into selectable as it arrives, one
  «Razón» once the drag is released.
  - **A `Button` («Seleccionar fechas» ⇄ «Listo»), never a long-press**, arms the mode —
    the long-press gesture is already spoken for on a phone browser (text selection, the
    iOS callout menu), so reusing it for the drag would race the browser's own gesture
    recognizer for the same touch. A mode button removes the race outright: entering it
    is deliberate, and a slow tap outside it does nothing.
  - **Inside the mode the months container takes over the touch surface**:
    `touch-action: none`, `user-select`/`-webkit-user-select: none`,
    `-webkit-touch-callout: none`, and `onContextMenu` is cancelled — the finger's whole
    gesture belongs to the grid, not to page scroll, text selection, or the callout menu.
  - **Pointer capture + `isoFromPoint`.** `onPointerDown` calls
    `setPointerCapture(pointerId)` on the container so the rest of the gesture keeps
    arriving there even once the finger has left the cell it started on — but a captured
    pointer's events target the CONTAINER, not the cell underneath, so
    `isoFromPoint(x, y)` (`dragSelect.ts`) resolves the day the same way regardless:
    `document.elementFromPoint(x, y)?.closest("[data-iso]")`.
  - **One finger owns the drag.** The gesture is pinned to the first primary pointer's
    `pointerId`; a second finger down, moving, or lifting is ignored rather than allowed
    to re-anchor or commit someone else's range.
  - **Release reads a ref, not the render closure.** `pointermove` is continuous, so
    React can still be rendering its last one when the discrete `pointerup` fires — the
    state closure a release would read can be a frame behind, dropping the last day of a
    fast drag (or every day of a tap-and-lift). `dragRef` mirrors the live span
    synchronously; the handlers read the ref, only the render reads the state.
  - **No auto-scroll during the drag, ever** — the page must never move under the
    finger. Instead the next month fades in as an OVERLAY absolutely positioned INSIDE
    the last visible month's own tile, covering its last rows as it solidifies
    (`shadowOpacity(distance)` over a 120px reach measured from the host tile's bottom
    edge) — never a fourth tile below the row, which would grow the very page the mode
    promises not to scroll. It is `aria-hidden`/`pointer-events-none` and inert while
    still fading, so a move over the host's covered rows still resolves the day
    underneath rather than resolving nothing.
  - **Solidity LATCHES for the rest of the drag** once the finger first reaches the host
    tile's bottom edge. The overlay's own cells sit inside the host's padding and
    border, so they never quite reach that edge themselves — without the latch there is
    no finger position that is simultaneously "over a next-month cell" and "past the
    threshold that makes it selectable." Latched, the finger can move back up into the
    fading tile and its days resolve.
  - **Release → `applyRange` → the page flips if the end fell in the next month → the
    «Razón» popover opens from a post-commit effect**, anchored to the first day of the
    range that is still MOUNTED (a drag ending in the shadow month turns the page before
    the popover would open, so the literal first day of the range can already be gone).
    `scrollIntoView({ block: "nearest" })` only moves the day when it has to, and
    `popoverPosition` clamps `y` at a minimum of 8px so flipping the popover above a
    first-row day cannot push it negative.
  - **One note for the whole range** — `NoteAnchor` gained `isos?: string[]`;
    `NotePopover` edits every day in `isos` with the same «Razón» and one «Quitar estas
    fechas», keyed off `days = popover.isos?.length ? popover.isos : [popover.iso]` so
    the single-day path is unchanged.
  - **The Desde/Hasta date fields moved from the panel into the grid**, under «Rango por
    fechas» — they are the keyboard/VoiceOver path to the exact same range a drag
    expresses, so they belong beside the gesture rather than a panel away. The panel's
    own «Rango…» button is retired (see the F1 bullet above, which this supersedes).
    **Retired in F3 (2026-09-12):** the Desde/Hasta fields themselves are gone — see the
    F3 bullet group below for why (four ways to express one range was the accretion
    Frank asked to undo).
- **F3 (2026-09-12): three pages.** Frank's look at F2, verbatim: "too many buttons that
  select the unavailable dates … remove the pills with the calendar … the /me page does
  too many things now — settings, hero cards, unavailable dates, edit profile." `/me`
  split into `/me` ("Mi semana"), `/me/disponibilidad` (the calendar alone) and
  `/me/ajustes` (Tema, Tamaño de texto, Perfil) — see spec Part XII, F3 for the full
  ledger; the motion-relevant pieces:
  - **The split is by QUESTION, not by component.** `/me` answers "who am I and when do
    I serve"; `/me/disponibilidad` answers "when can't I serve"; `/me/ajustes` answers
    "how does the app work for me." Each page keeps its own `revealProps` sequence
    starting at 0 rather than inheriting an offset from `/me`, because each is now its
    own entry point (its own `loading.tsx`, its own session guard, its own
    `callbackUrl`), not a scrolled-past section of one page.
  - **One surface marks availability, not four.** The weekend pills (`WeekendList`),
    the panel's «Rango…» fields (F1) and the grid's Desde/Hasta fields (F2) are all
    gone; the twelve-month grid — «Seleccionar fechas» for a tap or a drag range,
    «Repetir…» for a weekday pattern — is what remains, mounted OPEN on
    `/me/disponibilidad` with no «Ver calendario» disclosure around it. «Seleccionar
    fechas» is KEPT (Frank's ruling) — the calendar page still scrolls vertically, so
    the drag gesture that needed the shadow-month overlay in F2 still has a page to
    scroll past. «Editar perfil» is DROPPED from `MeHeader` — settings are one tap away
    in the avatar menu now, so a second link to the same destination on `/me` itself
    was the redundancy the split was meant to remove.
  - **The §12.4 "one page" ruling is reversed, and here is why.** R3 (§12.4 above)
    deliberately built `/me` as one page — header, hero, the weekend list, the grid
    behind a disclosure, and `SettingsCard` all in one scroll — on the theory that a
    member's whole self-service surface belonged together. Frank's F3 look found the
    theory wrong in practice: a page that answers "when do I serve," "when can't I,"
    and "how do I configure the app" is three answers wearing one URL, and the fix R3
    reached for (a disclosure around the grid) treated the symptom — too much on the
    page — without asking whether the page was doing too many jobs. F3 does the latter:
    three pages, one job each, linked from `/me` and the avatar menu rather than
    scrolled past.
  - **`app/(client)/me/queries.ts`** is the one addition that makes three pages cheaper
    than three copies: `MEMBER_AVAILABILITY_QUERY`, `MEMBER_PROFILE_QUERY`,
    `SERVICE_DATES_QUERY` and `horizon()`, neutral so every Server Component under
    `app/(client)/me/**` can import and call them directly (ADR-0028). `/me`'s own
    projection dropped the profile fields it no longer renders (`role`, `email`,
    `notifPrefs`, `hasPassword`) — `photoUrl` stays, for the header avatar;
    `/me/ajustes`'s
    `MEMBER_PROFILE_QUERY` carries no `_rev` — no profile write takes `ifRevisionId`
    (dropped in the Task 2 fix round, after shipping verbatim from the brief first).
  - **Review trail.** Task 1 (`/me/disponibilidad`) drew one fresh-code-review round:
    APPROVED, 4 LOW (docs deferred to this task on record; two LOW findings about a
    kids-only test's ministry-read assertion and the horizon-comparison expression
    folded into Task 2's dispatch rather than a second round). Task 2 (`/me/ajustes`)
    drew CHANGES_REQUIRED, 2 MEDIUM + 1 LOW: `MEMBER_PROFILE_QUERY` carried a dead
    `_rev` no write uses (MEDIUM); the new `loading.tsx` was missing from
    `loadingSkeletons.test.ts`'s scanned file list (MEDIUM); a stale `/me#tema` line
    survived in this file after the anchor moved to `/me/ajustes#tema` (LOW). All three
    fixed in the commit before this one, verified by the gate chain re-run on the
    final tree — the churn cap (two rounds max) was not reached.
- **Frank's look (2026-09-13), two fixes.** (1) `NotePopover` now portals to
  `document.body` — it is `position: fixed` and was rendering inside `/me/disponibilidad`'s
  route-reveal host (`[data-reveal]`, an animated `transform`, which becomes the
  containing block for a `fixed` descendant), so it landed at the host's own
  offset instead of the day cell's viewport position (reproduced on dev at
  1440×900: cell ~(503,615), popover ~(785,845)). (2) The grid is read-only
  outside «Seleccionar fechas» — `handleDateClick` is gone, day cells carry no
  `onClick` and are `aria-disabled`/untabbable when the mode is off, so a casual
  look at the calendar can no longer mark or open a day by accident; any edit now
  goes through the mode, where a tap is a one-day drag through the same pointer
  flow as a real range.
- **Bundle:** `main df19f1b5` → `F3 tip 8df4d0d7` (git-archive cold build, gzip −9): shared 172.5 → 172.5; `/me` 129.8 → 119.9 kB (−9.9); `/me/disponibilidad` 105.1 kB (new); `/me/ajustes` 103.1 kB (new); `/` 119.9 → 118.0 (−1.9); `/schedule` 123.6 → 121.7 (−1.9); `/admin` 356.5 → 354.4 (−2.1) — the weekend list and the date fields left, and every route shed the pill tone's unused variants.
- **Release:** merged to `main` as `512cd3be` (PR #65, 2026-09-13 18:48 CST); production alias `owt-backstage.vercel.app` verified on that SHA (`alias` + `meta.githubCommitSha`). Preview last verified at `7c6bf572`.

### App-wide (R7)

Spec §12.8 / decision L: four conveniences that don't belong to one route because
they apply everywhere — the navbar cue, the sign-out exit, pull-to-refresh, and a
second verb on a row via long-press. See spec Part XIII for the full ledger; the
motion-relevant pieces:

- **`CueStrip`** puts the member's next service under the title on every route
  except `/` and `/me`, which already carry the countdown in their own headers.
  Fetched CLIENT-SIDE after paint, exactly like the notification badge — `Navbar`
  reads no session server-side, so it stays a plain sync component and every page
  that renders it keeps rendering static/ISR. Two instances mount per page (the
  phone column, hidden `lg:hidden`, and the desktop line, `hidden lg:block`), so
  the fetch is deduped through a module-level in-flight promise: without it, both
  effects fire before either response lands and every page load asks the API
  twice. The response is cached in `sessionStorage` for 60 s, keyed by the
  signed-in member's `sanityId` — a stale-identity hit (a shared machine, an
  impersonation switch mid-session) is treated as a miss, never as someone else's
  cue leaking through. `Navbar` REMOUNTS on every route change (it is not
  memoised across pages), so `CueStrip` reserves the line's height as soon as it
  is armed, not just once the label paints — without the reservation the centred
  title block shifts ~15px on every navigation while the fetch (or a cache hit
  that still costs a render) is in flight.
  - **The cue is ministry-gated at the API by SKIPPING the query, not by
    filtering the response** — `/api/cue` reads the caller's `ministries` and
    only issues the worship query when the member is in worship, only the kids
    query when in kids. A kids-only volunteer must never cause a worship read
    and a worship member must never cause a `kidsSchedule` read, the same
    isolation CLAUDE.md's ministries section requires everywhere else.
  - **Both-ministry precedence: the earlier date wins, and a tie goes to
    worship** (`pickCue`) — a member in both ministries whose Sunday morning is
    the kids room has a worship call earlier that same day, so the tie is never
    actually a coin flip in practice.
  - **`Vary: Cookie`** on the response, alongside `Cache-Control: private,
    max-age=60`: the payload is keyed on the session cookie, so any cache that
    sits between the browser and the route (a CDN, a shared disk cache) must
    treat two members' requests as two different resources rather than serving
    one member's cue to another.
- **`Blackout`** (`blackout()`) is the stage vocabulary's one destructive exit —
  sign-out — used exactly once. A plain CSS opacity transition on a `div`
  appended straight to `document.body`, deliberately NOT `motion`: it fires from
  a synchronous click handler and is meant to outlive whatever component
  rendered the trigger, all the way through the redirect that replaces the
  document. `motion` stays reserved for elements that live inside React's own
  tree for their whole life; this one by design does not. `cancel()` exists
  because `signOut()` can throw (a network failure, a revoked session) — without
  it a failed sign-out would leave the page permanently black with no way back.
  Instant, no transition, under `prefers-reduced-motion: reduce`.
- **`PullToRefresh`** answers the one thing the phone had no way to ask for: a
  setlist that changed on the server since the page loaded. Mounted ONCE in
  `app/(client)/layout.tsx`, not per route.
  - **The content is never translated.** The rail is a sibling `fixed` element
    pinned to the very top of the viewport, not a transform on `<main>` or a
    wrapper around it — a transformed ancestor becomes the containing block for
    every `position: fixed` descendant (the FAB, the audio transport, the
    toasts), which is exactly the trap ADR-0031 and `reveal.test.ts` exist to
    keep shut.
  - **Window `touchstart` is passive and stays attached while armed; the
    `{ passive: false }` `touchmove`/`touchend`/`touchcancel` trio is attached
    PER GESTURE**, only once `touchstart`'s own checks pass, and removed again
    on end or cancel — a permanently attached non-passive `touchmove` would cost
    the browser its scroll fast-path on every touch in the app, including the
    ones this component will never claim.
  - **`preventDefault()` fires only past 8 px of downward travel at
    `window.scrollY <= 0`** — `<=`, never `===`: during the iOS rubber band
    `scrollY` goes NEGATIVE, so an equality test would freeze the pull exactly
    when the platform is already showing its own overscroll. The axis is
    decided ONCE, on the first move past the 8 px slop (a one-shot lock, the
    same shape as `motion`'s `dragDirectionLock`) — a horizontal decision hands
    the whole touch back for the rest of the gesture rather than re-deciding
    frame by frame, so a diagonal flick that turns vertical later still belongs
    to page scroll, not to the pull.
  - **`[data-pull-ignore]` is the opt-out** for a surface that owns its own
    gesture on the same touch surface: `SwipeStrip`'s drag host and
    `AvailabilityGrid`'s months while «Seleccionar fechas» is armed both carry
    it, so the schedule's week strip and the drag-select calendar never lose a
    touch to the pull underneath them.
  - **The rail overlays the navbar rather than sitting under it** — the navbar
    is `sticky` and travels with the page, so a bar fixed at the true top edge
    is what reads as "the page itself is being pulled," not a bar wedged
    between two other elements.
  - **Armed only on a phone**, and it says so with the tab bar's own signal:
    `BottomNav`'s `has-bottom-nav` class on `<html>` plus a coarse pointer
    (`matchMedia("(pointer: coarse)")`). The bar publishes its class after
    hydration, so a `MutationObserver` on `<html>`'s `class` re-arms
    `PullToRefresh` when it arrives and disarms it when the bar leaves (a
    kids-only volunteer, `/auth`, `/studio`).
  - **`overscroll-behavior-y: contain` moved to the ROOT element** under
    `html.has-bottom-nav`, not `body` — the viewport reads the property from
    `<html>`, so a `body` declaration left Chrome Android's own pull-to-refresh
    armed underneath this one (fix round 1, review finding).
  - **A commit refreshes once**: `router.refresh()` fires on release past the
    72 px threshold, and the rail holds its "refreshing" state for a 600 ms
    floor even when the transition settles instantly (a warm route resolves in
    ~40 ms) — a flash that disappears before it's seen reads as "nothing
    happened," which is the one thing a refresh must never look like. A second
    pull landing in the same task while one is in flight reads a REF
    (`refreshingRef`), not the not-yet-rendered `refreshing` state, and is
    dropped at `touchstart`.
  - **`pullModel.ts`** holds the arithmetic (`THRESHOLD`, `MAX`, `pullProgress`,
    `shouldRefresh`, `railHeight`) apart from the component and free of hooks —
    the gesture cannot be driven with any fidelity in jsdom (no layout, no real
    touch), so the numbers are the part that is genuinely provable by test.
- **`useLongPress`** gives a row a second verb on the phone: hold 450 ms and its
  `QuickActions` sheet opens, instead of the one thing a tap already does.
  - **Timings and cancellation.** 450 ms of a still primary pointer; 8 px of
    travel, a lift, a pointer leaving the row, a cancel, or ANY `scroll`
    anywhere (capture phase, so a scrolling ancestor container counts too)
    cancels the press before it fires. While the timer is pending the row draws
    NOTHING — no ring, no growing fill — so a press that is about to be
    cancelled costs a list of ~140 rows no visual state at all.
  - **One swallowed click.** A fired press must not also register as a tap: the
    row's own `onClick` is swallowed exactly once through a capture-phase
    handler on the same element (the `SwipeStrip` precedent), cleared again on
    the next `pointerdown` so the following honest tap is untouched.
  - **Desktop right-click opens the same sheet** — a mouse held still for
    450 ms is an accident, not an intent, and the OS context menu would win the
    race anyway. `contextmenu` from a MOUSE (`pointerType === "mouse"` where the
    browser sends one; `button === 2` where it doesn't, since Safari and
    Firefox put no `pointerType` on a `contextmenu` `MouseEvent`) fires the
    sheet immediately; a `contextmenu` without a mouse signal (a touch, or a
    keyboard-invoked menu — Shift+F10 / the Menu key, which look identical to
    Safari's touch event) is only `preventDefault`ed, because the press itself
    already fired (or will) and the native callout would fight it; keyboard-
    invoked menus on rows are not supported — the row's tap is the affordance.
  - **`QuickActions`** is what opens: a `CueDialog mode="sheet"` — never a
    hand-rolled sheet — with one full-width, left-aligned `Button variant="ghost"
    size="lg"` per action and «Cancelar» last, mounted with `open={open}`
    (`cueDialogMount.test.ts`).
  - **Per-row actions, and what was left out.** `LibraryRow` (the row only fires
    `onQuickActions(post)`; `LibraryIndex` owns the ONE sheet for the page): «Abrir» (the same
    `openSheet` the tap calls) and «Copiar enlace» (clipboard, confirmed or
    refused through `useToast`) — «Practicar» is deliberately absent, since the
    player exposes exactly one song entry point and a second button calling it
    would be two names for one action. `DayCardDisclosure`: «Ver en calendario»
    and «Añadir a mi calendario» (this one service as an `.ics`, the same blob
    download `AddToCalendarButton` uses for the whole list). Neither sheet
    carries a destructive action — a quick-actions sheet is for a second
    convenience, not for something that needs its own confirmation step.

**Deviations from the plan, accepted.**
- `DayCard`'s own setlist rows (`SongRow`) were left out of the long-press
  sweep — they already carry the row-is-the-affordance exemption for a
  different reason (opening the player), and a long press there would compete
  with the row's existing tap rather than add to it.
- No «Practicar» quick action on `LibraryRow` — see above.
- The `contextmenu` mouse test (`pointerType ? pointerType === "mouse" :
  button === 2`) was accepted as written rather than simplified, because Safari
  and Firefox send no `pointerType` on a `contextmenu` `MouseEvent` at all —
  collapsing the check to `pointerType === "mouse"` alone would silently drop
  desktop right-click support on both browsers.

**Review trail.** Task 1 (cue API + strip) drew CHANGES_REQUIRED (1 MEDIUM + 3
LOW: reserve the line; cache keyed by `sanityId` + `Vary: Cookie`; `cueLabel(cue,
now)` taking the caller's clock directly rather than round-tripping "today"
through a string; two tests strengthened) — fixed in one round, scoped
re-review CLEAN. Task 2 (blackout) drew APPROVED outright (a LOW rejection-path
test and a double-tap note parked for the final fix wave). Task 3 (pull-to-
refresh) drew CHANGES_REQUIRED (1 HIGH + 4 MEDIUM + 2 LOW: the HIGH was
`scrollY === 0` freezing the pull mid-iOS-bounce; the MEDIUMs were the one-shot
axis lock, `data-pull-ignore` on `SwipeStrip`'s host and the drag-select months,
moving `overscroll-behavior` to `html`, and the `refreshingRef` in-flight guard;
the LOWs were the per-gesture `touchmove` attachment and tests for up-drag /
horizontal / `touchcancel` / a second pull) — fixed in one round, scoped
re-review CLEAN (2 LOW parked: `reset()` on a multi-finger `onStart`; explicit
touchmove-removal tests). Task 4 (long-press + `QuickActions`) drew APPROVED (4
LOW parked for the final fix wave).

- **Bundle:** `main 61d5330f` → `R7 tip 6fcfb22c`: shared 172.5 → 172.5; `/` +4.1; `/schedule` +2.4; `/biblioteca` +5.0 (the long-press hook and the page's one sheet); `/me` +3.6; `/admin` +2.6 — see the Bundle table.
- **Release:** merged to `main` as `2fae55b8` (PR #72, 2026-09-13 21:2x CST, after PR #71 landed); production alias `owt-backstage.vercel.app` verified on that SHA (`alias` + `meta.githubCommitSha`, 21:22 CST). Preview last verified at `7f5c52c7`.

### Song (R4)

Spec §12.7 / decision K, plus Part I §5.3 and §19.5's hero row: `/posts/[slug]` becomes
a practice surface. See spec Part XIV for the full ledger; the motion-relevant pieces:

- **One transposition seat.** `TransposeProvider` (`app/components/song/`) owns the
  page's single `semitones` value; `KeyDial`, the hero drawer, `PracticeCluster` and
  `ChordChart` all read it through `useTransposeOptional()`. `ChordChart` keeps its own
  `useState` ONLY as the fallback for a chart rendered without a provider (its tests, a
  future consumer) — never as a second live copy beside the hero, which is how the badge
  and the chart would come to disagree. The provider is seated on the FIRST chart's key,
  not on `post.key`: `ChordChart` opens on index 0 and only the chart on screen
  transposes, so the dial, the «(original)» hint and the chart readout name one key.
- **The hero drawer is the page's ONE 12-key picker.** `SongHeroPills` discloses a
  `SegmentedControl` of the twelve notes inside a `Collapse`; `ChordChart`'s old 12-button
  strip is now a ± pair with a `NumberRoll` readout and an «Original» reset. Two 12-key
  strips on one page is the "too many buttons" smell R3 F3 removed. The radiogroup's value
  is the sounding ROOT (a "Gm" song sounds "Am", which matches no option), and each option's
  visible label carries `normal-case` — the control uppercases its options for
  CALENDARIO / LISTA, and a flat left alone reads "EB", which is not a note.
- **The tempo pill is CSS-clocked by a custom property.** `TempoPill` publishes
  `--tempo-period: ${60000 / bpm}ms` inline and `.brand-tempo-pill[data-active="true"]::after`
  runs `@keyframes brand-tempo-pulse` on it — **no `setInterval`, no rAF loop**, so a
  backgrounded tab costs nothing and the beat cannot drift against a React render.
  `data-active` is ABSENT when idle rather than `"false"`. `brand.css` declares a `:root`
  default of 750 ms, the pattern `--impersonation-h` and `--bottom-nav-h` already use for
  a JS-published value, so no guard needed an exemption. One `haptic("light")` on the
  toggle, never per beat.
- **`LyricsAutoscroll` moves the PAGE, never a transform.** rAF + `window.scrollTo`, at
  `autoscrollPxPerSecond(sectionHeight, lines, bpm)` (a lyric line is 8 beats; clamped to
  8–160 px/s; no BPM means 80). A transform on the section would make its ancestor the
  containing block for every `fixed` descendant — the FAB, the audio transport, the
  toasts — the ADR-0031 trap `reveal.test.ts` exists to keep shut.
  - **Touch pauses, the wheel stops.** `touchstart` / a non-mouse `pointerdown` pauses;
    the lift resumes, waiting for `scrollend` when the touch actually scrolled so the
    loop does not fight iOS momentum, with a **400 ms backstop** for the UAs that never
    fire it. Every lift clears that timer first (one gesture lifts twice), a new touch
    clears it, and `resume()` returns early while a finger is down — a backstop is a timer
    and must always lose to a finger. `pointercancel` is deliberately NOT bound: Chrome
    Android and iOS Safari fire it the moment a touch is promoted to a pan, finger still
    down, and treating it as a lift scrolled the page out from under the drag. A genuine
    cancel still arrives as `touchcancel`, which is handled. The wheel **stops** the run
    rather than pausing it, because a mouse has no lift event and a paused run would sit
    there reading «Detener» over a page that no longer moves.
  - **The end is the section's bottom above the furniture** — `window.innerHeight` minus
    `--bottom-nav-h` (the tab bar's published measured height) minus the measured
    `.audio-player` height, re-measured at every resume since the transport appears the
    moment someone taps play. Without it the last lines stop behind both.
- **The practice cluster lives in the page's own sticky bar, not in `Navbar`.**
  `SectionNav` gains a right-hand slot holding `PracticeCluster` (title on `lg`, sounding
  key, BPM, 44 px play/pause), faded in by `Presence` when one `IntersectionObserver` on
  `#song-hero` reports the hero gone. The observer's `rootMargin` is the bar's **sticky
  top** (`parseFloat(getComputedStyle(bar).top)`, which resolves the `calc()` with the
  safe area) plus the bar's own rect HEIGHT — never the rect's `bottom`, which at mount
  (scroll 0, not yet stuck) is most of the hero's height and latched the cluster visible
  from load. The navbar's centre already holds the title and the cue strip on the phone
  and the navigation links on desktop; taking it would repeat or remove something.
- **The press twin is a class rule, not a utility.**
  `.brand-surface-interactive:active { transform: translateY(1px) scale(.985) }` sits right
  after that class's `:hover` rule in `brand.css`. Tailwind v3 compiles `@layer` away, so
  `active:` utilities on a consumer were a same-specificity source-order tie against the
  hover transform; the class rule wins cleanly and every consumer app-wide gets the press
  for free.
- **`PlayPauseGlyph` and `Equalizer`** (`app/components/ui/`) are the one play/pause morph
  and the one playing indicator, used by `SongAudioSection`, `AudioTransport` and
  `PracticeCluster`. The equaliser renders unconditionally on the card's title row and only
  animates (`scaleY`, `@keyframes brand-eq`) under `[data-playing="true"]`, so the row's
  height never shifts when playback starts.
- **The page joins the route reveal** on the house 40 ms step (not §5.3's 30 ms — one clock
  for every route), and `NAVBAR_H_CLASS` (`app/utils/navbarHeight.ts`) gives the navbar's
  height one spelling across `Navbar` and `NavbarSkeleton`, so the loading shell cannot
  drift from the real bar.

**Deviations from the plan, accepted.** The radiogroup's value is the sounding root rather
than the sounding key; `data-active` is absent when idle; the page coerces `post.bpm` with
`Number()` and passes an unusable value through as `bpmText` (a static pill — the field is
typed `string` in `interface.tsx` while the schema writes a number, which predates R4); the
wheel stops the autoscroll instead of pausing it.

**Review trail.** Tasks 1, 2, 4 and 5 drew APPROVED with 0 findings. Task 3 (hero pills)
drew CHANGES_REQUIRED (1 MEDIUM uneven pill row — the static pills sat at 38.4 px beside a
44 px dial; 4 LOW) — fixed in one round, re-review CLEAN. Task 6 (reveal, press twins)
drew APPROVED with 1 MEDIUM parked (the referencia press twin, closed by the `brand.css`
rule above). Task 7 (autoscroll) drew CHANGES_REQUIRED (1 HIGH `touchcancel` stranding the
run; 2 MEDIUM 44 px target and momentum resume; 3 LOW) — fixed in one round. The
whole-branch review then found 1 HIGH (`pointercancel` resuming under the finger), 2 MEDIUM
(`transposeKey` re-spelling at 0 semitones; the end ignoring the tab bar and transport) and
3 LOW; the scoped re-verify of THAT fix found 2 more HIGHs the fix had introduced (the flow-
rect observer inset; a re-touch inside the backstop), and the second re-verify returned
VERIFIED FOR MERGE. Parked, knowingly: the observer inset is read once at mount and goes
stale across an `lg:` rotation; a chart[1] in another key disagrees with the hero readout by
that interval (an editors' data rule, not more code).

**Data reality.** 0 songs in the catalogue carry an inline chart or an audio track today, so
the transposer and the equaliser are capabilities the editors can light up rather than paths
production exercises; the `song` theme-gallery fixture is where both are visually verified.

- **Bundle:** `main 7fbbb105` → `R4 tip 5a899be0`: shared 172.5 → 172.5; `/posts/[slug]`
  110.7 → 111.7 (+1.0, the only route that gained a feature); `/` −1.4; `/schedule` −1.3;
  `/biblioteca` −1.3; `/me` −1.3; `/admin` −1.4 — see the Bundle table.
- **Release:** merged to `main` as `<pending>` (PR #`<pending>`); production alias
  `owt-backstage.vercel.app` verified `<pending>`. Preview verified at `d6b3ba56`.
