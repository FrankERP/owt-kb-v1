# ADR-0031: Motion goes through one lazily loaded library, under an iOS 15 floor

**Date:** 2026-09-08 · **Status:** Accepted

## Context

The app had no motion system: two duration tokens, one keyframe, one reduced-motion
rule, a dialog that mounted and unmounted instantly, 305 inline-styled buttons and 13
hand-rolled toasts (spec `docs/superpowers/specs/2026-09-08-premium-motion-design.md`
§1). The three things that separate "premium" from "has transitions" — exits that
complete, interruptions that reverse smoothly, elements that slide between states — are
exactly what CSS alone makes expensive: an exit needs a "closing" state and an
`animationend` handshake, an interruption snaps, a shared-element indicator needs
measurement on every render.

The browser floor is iOS 15 (ADR-0030): no View Transitions API, no `@starting-style`,
no scroll-driven animations.

## Decision

`motion` 13.x, loaded once through `app/components/ui/MotionProvider.tsx`
(`LazyMotion features={() => import("./motionFeatures").then(…)} strict` +
`MotionConfig reducedMotion="user"`). The feature set is genuinely lazily loaded: it
ships as its own chunk fetched after hydration, not inlined into the first-load
script, which is what keeps `LazyMotion`'s name honest and is the only way a future
`domMax` (M0b's `SlidingIndicator`) fits without inflating every route's first paint.
`motion` is importable ONLY from `app/components/ui/**` and `app/utils/motion*`
(`motionImportBoundary.test.ts`). Feature components compose primitives — `Presence`,
`Collapse`, `SegmentedControl`, `Toast`, `Menu`, `CueDialog` — and never `m.*`.

Static motion stays in CSS: press, hover, focus, the route reveal, the skeleton
shimmer. Tokens live in `brand.css` `:root` (`--motion-*`, `--ease-*`) with a Tailwind
mirror (`motionTokens.test.ts`). Only `transform` and `opacity` animate.

Bundle: measured in `docs/MOTION.md`; the whole programme is capped at +25 kB gz on
first-load JS.

## Rejected

**CSS only, with hand-rolled `usePresence` and `useFlip` hooks.** Zero dependencies and
it covers enter/exit, press, sheets. It fails on interruption (open→close mid-flight
snaps), on `layoutId`-style shared indicators, and it grows a private animation library
the repo owns forever. jsdom has no `element.animate`, so every hook needs an
environment guard in tests.

**`@react-spring/web`.** Comparable physics, no `AnimatePresence` or `layoutId`
equivalent without extra code, larger surface for the team to learn.

**Importing `motion` wherever it is convenient.** One `motion.div` in a feature
component pulls the full bundle past `LazyMotion` (that is what `strict` throws on) and
puts a second clock in the app. The boundary test is what makes the dependency safe.

## Consequences

- A new animated pattern is a new primitive under `ui/`, with a test that runs under
  `MotionGlobalConfig.skipAnimations` and a gallery fixture. Never an `m.div` in a page.
- Because the feature chunk arrives asynchronously, an `m.*` element renders its
  `initial` values until it resolves (sound, since SSR/hydration also renders
  `initial`) — so `Presence appear`, which depends on the enter animation actually
  running on first mount, must never be used above the fold (M0b rule,
  `docs/MOTION.md`).
- `reducedMotion="user"` plus the global CSS rule means Reduce Motion in iOS Settings
  calms the whole app; nothing needs a per-effect opt-out.
- Raising the iOS floor would unlock View Transitions for route exits (decision C
  in the spec chose enter-only for this reason); this ADR does not preclude that.
- Removing the library means rewriting every `ui/` primitive that uses `Presence`
  semantics; the boundary test lists exactly which files those are.
