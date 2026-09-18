# Theme gallery — visual regression

Specs here run under `playwright.vr.config.ts` (read-only; see ADR-0014), **not** under
`playwright.config.ts`, which is the Service Readiness write-safety harness.

**Name specs `*.spec.ts`.** `vitest.config.ts:15` includes `e2e/**/*.test.ts`, so a spec
named `.test.ts` gets swept into `npm test` and fails there.

## How to run it

Three commands, in this order. The config has **no `webServer`** by design — it never
starts anything, so the server is yours to start and yours to stop.

```bash
npm run build
npx next start -p 3000            # in another shell, or backgrounded; wait for a 200
THEME_GALLERY_VR_ENABLED=true THEME_GALLERY_VR_BASE_URL=http://localhost:3000 npm run test:vr
```

Add `-- --update-snapshots` to the last command to (re)capture. Both variables are
**public configuration, not secrets** — they name a target and say "yes, on purpose", so
they are documented here and in `docs/DEV_VERIFY.md`, never in `docs/SECRETS.md`. Without
them the config throws at load (ADR-0014).

Run it against `next start`, not `next dev`: dev serves unminified CSS through a different
pipeline and recompiles routes on first hit, so a capture there is neither the production
rendering nor a stable one.

## The snapshot policy

| | |
|---|---|
| Scope | 2 themes × 7 fixtures = 14 screenshots per project |
| Projects | `desktop` (Chromium, 1280×900) and `phone` (iPhone 13 viewport, **Chromium** — the phone viewport is the signal, a second engine's rasterisation is not) |
| Non-screenshot tests | 3 paint assertions + 1 motion-on spec, and they run in both projects |
| Total | **36 tests** (18 × 2 projects) |
| Tolerance | `maxDiffPixelRatio: 0.01`. Raising it to make a failing baseline pass is the forbidden move — recapture, or fix what moved |
| Full page | `swatches`, `controls`, `song`, `kids-planner`, `nav`. `dialog` and `planner` are viewport-only: both are `fixed inset-0`, so a full-page shot adds only the scroll height underneath them |
| On disk | ~8.5 MB, committed under `__screenshots__/{project}/{platform}/` |

**Baselines are darwin-only, and the path template says so.** `{platform}` is in
`snapshotPathTemplate`, so a linux run compares against nothing rather than against macOS
font rasterisation. **VR is not in CI** (`docs/CI.md`) — it needs a built server and a
committed platform baseline.

**The song fixture's YouTube poster is stubbed in the spec.** `TutorialPoster` renders
YouTube's still through `next/image`, which is a real request to a third party. Measured:
it made `dark/song` differ from its own baseline by 15% of all pixels between two
consecutive runs. `gallery.spec.ts` fulfils `/_next/image` and `i.ytimg.com` with a fixed
opaque tile, which keeps the poster box, its scrim and its ▶ button while removing the
network.

## `#motion` — the one page that animates

Every gallery page sets `data-motion="off"` on `<html>`, and `GalleryMotion.tsx` turns that
into `MotionGlobalConfig.skipAnimations`, so every frame is final and comparable. Loading a
page with the `#motion` hash removes that attribute, and only that page animates for real.

`motion-on.spec.ts` uses it to catch the one bug a final-frame screenshot cannot show: a
transformed ancestor is the containing block for every `position: fixed` descendant, so an
animating wrapper silently un-anchors the dialog mid-enter. It attaches a t=0 and a t=end
screenshot as evidence and asserts on computed style and geometry, which are not flaky.

The attribute is removed in a **`useLayoutEffect`**, not an inline `<script>` in
`layout.tsx`. That was the fallback and it was not needed: measured, `#motion` runs the
enter across ~10 frames while the default page reaches its final frame in one.

## The three assertions that need a real browser

These are the reason the composition was redesigned, and a DOM-order check cannot substitute
— jsdom performs no layout or paint:

1. `swatches` — the swatch surface is **unobscured**; no fixed full-viewport body child overlays it.
2. `dialog` — the dialog layer is the **topmost painted** body child. Two points, because
   `CueDialog` is `items-start` below `sm`: the viewport centre proves the `[data-cue-layer]`
   layer covers the page, and the panel's own centre proves nothing paints over the panel.
3. `planner` — the full-screen overlay is the **topmost painted** body child, not merely present.
   Its selector is `[role="dialog"][aria-label="Cuadrícula del mes en pantalla completa"]`, NOT
   `[data-planner-fullscreen]` — that attribute is on the "⛶ Pantalla completa" toggle, whose
   whole subtree unmounts once full screen is on.

All three live in `gallery.spec.ts` and run in both projects.

"A portal node exists under `document.body`" passes in every broken arrangement and is
explicitly insufficient.
