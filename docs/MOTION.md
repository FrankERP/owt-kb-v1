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
| `Presence` | client | `<Presence show={open} variant="rise">` — exit before unmount. Hosts `div` \| `section` \| `aside` \| `li` only (block-level — a transform is dropped on a non-replaced inline element). `appear` defaults to **false**: a `Presence` mounted already-shown does not animate in unless `appear` is passed; for the common case — a mounted `Presence` that toggles `show` — do nothing, the enter animation runs on every `show→true` transition regardless. Pass `appear` only for an instance that mounts already-shown and must still animate in (an on-demand toast, a newly appended list row). |
| `Skeleton`, `SkeletonGroup` | neutral | loading placeholders with the shimmer; one `aria-busy` status region per loading surface |
| `Button` | neutral | `variant` primary/secondary/ghost/danger/icon/pill · `size` sm/md/lg · `busy`/`busyLabel` · `href`. Defaults to `md`; the spec's phone-width `lg` default is applied per call site, not by the primitive. `busy`/`busyLabel` are rejected by the types on the `href` branch — a link has no loading state to represent. `className` is additive only (appended after the variant/size classes, never a padding/radius/colour override). The `primary` variant sets `overflow: hidden` for the hover sheen, so an absolutely positioned badge nested inside a primary button is clipped — anchor badges outside the button instead. |
| `revealProps(i)` (`app/utils/reveal.ts`) | neutral | spread on a block a page reveals; `template.tsx` replays it per navigation |
| `CueDialog` | client | the ONE dialog shell — never a hand-rolled `fixed inset-0` scrim. `mode="modal"` \| `"sheet"`; a `"sheet"` dialog is only a sheet below 640px — at ≥640px it renders the same centred-card motion as a modal, decided when the dialog opens (`useMemo` on the `open` edge) and held until it closes. Drag-to-dismiss lives on the sheet's HEAD — the handle and the title bar as one grip, never the body (hand-rolled pointer events, not the `drag` prop — the gesture is one-axis and the sheet body still needs to scroll; on the phone sheet the × is `sr-only` (the grip is the close control; the button stays for VoiceOver and keyboard focus, and the ≥640px card keeps it visible); a sheet that passes no `title` — `SongSheet`, whose header is hand-rolled inside `children` — still drags only from the pill until M1 gives it a real `title`; it closes past `SHEET_DISMISS.distance` = 150 px of travel OR above 0.5 px/ms, and springs back otherwise); a sheet's exit slides fully out (`y: "100%"`), it does not recoil partway like a modal's scale-fade. `onDismiss(reason: DismissReason)` where `DismissReason` is `"escape" \| "backdrop" \| "drag"`. Layers register with the provider so Escape and inert-ing only ever affect the top one. Traps focus via `trapTabTarget`, and can extend its Tab ring to a portalled "satellite" node via `useCueDialogFocusSatellite()` (no production consumer registers one today; see the in-file comment). **Render `<CueDialog open={x}>`, never a literal `open` behind a conditional** — whether that conditional is `{x && <CueDialog open>}` directly, or a wrapper component (a local `Modal`, a `SetlistPopover`, a `SeatPicker`) whose only JSX output is `<CueDialog open …>` and which its caller mounts conditionally. Either way the dialog element is created and destroyed by React instead of opened and closed by the `open` prop, so it never runs CueDialog's own enter/exit — `cueDialogMount.test.ts` pins the current backlog and ratchets it down. A `Menu` inside a `CueDialog` owns Escape: the dialog's capture-phase listener yields when the key's target is inside an open menu or on its expanded trigger, so the first Escape closes the menu and the second the dialog (M0b-2). The sheet/card decision is taken when the dialog OPENS and held until it closes. |
| `Toast` / `useToast` | client | the ONE toast stack — `useTransientValue` stays for an inline "Guardado ✓" flash next to the control that produced it, `useToast` is for anything that needs a FIXED, stacked notification. `toast({ message, tone?, duration?, hold?, action? })`: `tone` is `"ok" \| "error" \| "info"`; `hold` persists until something calls `dismiss(id)` (never a bare `setTimeout`); `action` renders a button inside the toast that both fires and dismisses. Portals to its own viewport node, `z-[95]` (above `CueDialog`'s `z-[90]`, so a save confirmation is visible over a dialog), bottom-anchored at `calc(1.5rem + env(safe-area-inset-bottom) + var(--bottom-nav-h, 0px))` so it clears the mobile tab bar. |
| `Menu` / `MenuItem` / `MenuSeparator` / `MenuHeader` | client | the ONE anchored dropdown. Real `role="menu"` semantics: roving focus with arrow keys, Home/End, Escape closes and refocuses the trigger, Tab closes without refocusing. Positioned `absolute` in a `relative` wrapper (never a portal — a portal would escape a dialog's inert boundary). Merges the trigger's own `ref` with its internal one, so a consumer that also needs the trigger node (to refocus it after an async action) still can. |
| `Collapse` | client | the ONE disclosure — expand/collapse with real height animation (the one place `height` animates outside `transform`/`opacity`, on user-triggered disclosures only). Renders an UNSTYLED animated OUTER `m.div` (owns `id`/`aria-hidden`/`inert`/`height`/`opacity`/`overflow`) with `className` applied to a plain INNER `div` — under `border-box` a padded/bordered box floors its height at padding+border, so a closed `Collapse` that owned the padding itself reserved blank space forever; height 0 only means 0 when the animated box has no padding of its own. Children stay mounted while closed; opening clears `inert`/`aria-hidden` in the same commit as `open` (so a parent's own effect can reach a child node right away), while closing waits for the animation to finish before setting them. Because jsdom (as of this writing) does not wire the `inert` IDL property from the reflected attribute, `Collapse` also sets `el.inert` imperatively in an effect — a harmless duplicate of the JSX prop in a real browser, and what `Collapse.test.tsx` actually observes. |

M0b also adds: `SegmentedControl`, `SlidingIndicator`, `Switch`, `Checkbox`,
`Select`, `DateField`, `NumberRoll`, `haptics`.

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
| `rawMotionLiterals.test.ts` | Pins `transition-all` (13) and raw `duration-N` (12) counts outside `ui/` at the audited baseline — lower it in the same commit a phase migrates a route; never raise it to make the guard pass. |
| `cueDialogMount.test.ts` | Counts every LITERAL `open` attribute on a `<CueDialog` source element — not `open={…}` — across `app/**/*.tsx` excluding `__tests__` and `ui/`; per element, not per caller, so a wrapper mounted by several callers still counts once. Pins the count at 11 (re-measured 2026-09-09, fix round 1; the original 2026-09-08 measurement of 7 only caught the direct `{x && <CueDialog open>}` shape and missed wrapper components — AdminPanel's and ServicesPanel's local `Modal`, `SongSheet`'s `SetlistPopover`, `KidsPlanner`'s `SeatPicker` — whose only JSX output is a literal `<CueDialog open …>` conditionally mounted by their own callers). Those four wrapper sites migrate in their own route phases. Lower the count in the same commit that migrates a site to `open={…}`; never raise it. |
| `labelBudget.test.ts` | Spec §18 (decision N): one eyebrow per surface. Pins six named labels (`>Cue<`, `>Servicio<`, "Índice musical", "títulos", "Backstage operations", "Acceso autorizado") at their audited counts, by equality — a phase that removes one lowers its number in the same commit. |

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

Programme cap: +25 kB gz total. Both route deltas now land well under the hard cap
and under the ≤20 kB expectation the programme opened with — `motion`'s `domAnimation`
feature set plus the four M0a primitives' own code (`Presence`, `Skeleton`/
`SkeletonGroup`, `Button`, `MotionProvider`) together now cost ~12.4 kB gz on a route
that renders them, not the ~24 kB the synchronous load cost. The shared/root chunk
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

## Where the walk's findings landed

Part III of the spec catalogues every element. M0a closes findings 3 (lockup priority)
and 5 (initials contrast) — `shellPolish.test.ts`.
