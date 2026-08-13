# Theme gallery — visual regression

Specs here run under `playwright.vr.config.ts` (read-only; see ADR-0014), **not** under
`playwright.config.ts`, which is the Service Readiness write-safety harness.

**Name specs `*.spec.ts`.** `vitest.config.ts:15` includes `e2e/**/*.test.ts`, so a spec
named `.test.ts` gets swept into `npm test` and fails there.

## Nothing runs yet, but the reason has changed

The gallery is **public** as of ADR-0017 — prerendered, reading nothing — so a headless run
needs no member session, and the credential problem that used to block this is gone. What
remains is only that nobody has enabled the harness and taken baselines; that is now an
ordinary piece of work rather than an auth-boundary change.

## The three assertions that need a real browser

These are the reason the composition was redesigned, and a DOM-order check cannot substitute
— jsdom performs no layout or paint:

1. `swatches` — the swatch surface is **unobscured**; no fixed full-viewport body child overlays it.
2. `dialog` — the dialog layer is the **topmost painted** body child.
3. `planner` — the full-screen overlay is the **topmost painted** body child, not merely present.

"A portal node exists under `document.body`" passes in every broken arrangement and is
explicitly insufficient.
