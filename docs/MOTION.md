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
   theme gallery mounts no `MotionProvider` today, so that attribute covers CSS
   only, not `motion`-driven JS animation. An M0b fixture that renders `Presence`
   (or any other `motion` primitive) inside the gallery must add a gallery-side
   `LazyMotion` plus `MotionGlobalConfig.skipAnimations` keyed off the same
   attribute, or the gallery's "off" baseline will silently still animate. The
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
| `MotionProvider` | client | mounted once in `app/utils/Provider.tsx`; `LazyMotion features={() => import("./motionFeatures").then(…)} strict` (async chunk, not the synchronous `domAnimation` value) + `MotionConfig reducedMotion="user"`. An `m.*` element renders its `initial` values until the chunk resolves; the vendor loader has no rejection handling, so if the chunk fails to fetch an `m` element stays at its pre-feature state and a `Presence` exit never completes — M0b's `Toast`/`Menu`/`Collapse` must decide a fallback. |
| `Presence` | client | `<Presence show={open} variant="rise">` — exit before unmount. Hosts `div` \| `section` \| `aside` \| `li` only (block-level — a transform is dropped on a non-replaced inline element). `appear` defaults to **false**: a `Presence` mounted already-shown does not animate in unless `appear` is passed; for the common case — a mounted `Presence` that toggles `show` — do nothing, the enter animation runs on every `show→true` transition regardless. Pass `appear` only for an instance that mounts already-shown and must still animate in (an on-demand toast, a newly appended list row). |
| `Skeleton`, `SkeletonGroup` | neutral | loading placeholders with the shimmer; one `aria-busy` status region per loading surface |
| `Button` | neutral | `variant` primary/secondary/ghost/danger/icon/pill · `size` sm/md/lg · `busy`/`busyLabel` · `href`. Defaults to `md`; the spec's phone-width `lg` default is applied per call site, not by the primitive. `busy`/`busyLabel` are rejected by the types on the `href` branch — a link has no loading state to represent. `className` is additive only (appended after the variant/size classes, never a padding/radius/colour override). The `primary` variant sets `overflow: hidden` for the hover sheen, so an absolutely positioned badge nested inside a primary button is clipped — anchor badges outside the button instead. |
| `revealProps(i)` (`app/utils/reveal.ts`) | neutral | spread on a block a page reveals; `template.tsx` replays it per navigation |

M0b adds: `CueDialog` motion, `Toast`, `Menu`, `Collapse`, `SegmentedControl`,
`SlidingIndicator`, `Switch`, `Checkbox`, `Select`, `DateField`, `NumberRoll`, `haptics`.

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
`a733347cfde72f731010f1bd58f9d189a84072cb` (branch `main`); After on this branch.

| Build | First Load JS shared | `/` | `/admin` |
|---|---|---|---|
| Before M0a (merge-base `a733347c`) | 172.3 kB | 77.3 kB | 301.7 kB |
| After M0a, `domAnimation` loaded synchronously | 172.3 kB | 101.5 kB | 325.9 kB |
| After the fix wave, `domAnimation` loaded as an async chunk | 172.3 kB | 89.7 kB | 314.2 kB |
| Δ vs Before M0a | +0.01 kB | +12.4 kB | +12.5 kB |
| After M0b-1, `domMax` loaded as an async chunk | 168.4 kB | 87.9 kB | 307.1 kB |

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

First-load `/` and `/admin` moved by −1.8 kB and −7.1 kB against the fix-wave's
recorded 89.7 kB / 314.2 kB — more than the ±0.5 kB this switch alone should produce.
The move is not from `domMax`: the chunk above is structurally unreferenced by any
route's client-reference manifest, so which feature set it re-exports cannot change a
single byte of synchronously-loaded route JS. It is the two loading-skeleton fixes
already merged onto this branch ahead of M0b-1 (`ecb6c86b`, `e6b2b46c` — both touch
`app/(client)/loading.tsx`, shared by `/` and `/admin`) landing between the fix-wave's
measurement and this one. Confirming this would need rebuilding the pre-M0b-1 tree
with `domAnimation` still in place, which this measurement pass intentionally skips.

## Where the walk's findings landed

Part III of the spec catalogues every element. M0a closes findings 3 (lockup priority)
and 5 (initials contrast) — `shellPolish.test.ts`.
