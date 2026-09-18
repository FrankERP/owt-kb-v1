// Read-only visual-regression config for the theme gallery (Child A2 step 5).
//
// SEPARATE FROM `playwright.config.ts` BY DESIGN — see ADR-0014. That file is a
// write-safety harness that throws at module load without the Service Readiness
// verification identity, and has no `webServer` so it can never start a local server.
// It cannot be reused here, and it must not be loosened to make screenshots convenient.
//
// This config CANNOT WRITE. It carries no Sanity identity, no bypass secret, and no
// write flag. Its only job is to open pages and capture them.
//
// NO CREDENTIALS ARE NEEDED ANY MORE. The gallery is public as of ADR-0017 — it is
// prerendered and reads nothing — so a headless run needs no member session. That removes
// the reason this file used to give for deferring: provisioning a session was a
// secret/auth-boundary change on CLAUDE.md's Critical list.
//
// THE REFUSAL BELOW STAYS. It is not about credentials; it is about not running a visual
// baseline against an unspecified target. Enabling the harness is still an explicit act.
//
// Specs are `*.spec.ts`, NEVER `*.test.ts`: `vitest.config.ts:15` includes
// `e2e/**/*.test.ts` and would sweep them into `npm test`.

import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.THEME_GALLERY_VR_BASE_URL;
const OPT_IN = process.env.THEME_GALLERY_VR_ENABLED === "true";

if (!OPT_IN || !BASE_URL) {
  throw new Error(
    [
      "playwright.vr.config.ts refuses to run.",
      "",
      "Set THEME_GALLERY_VR_ENABLED=true and THEME_GALLERY_VR_BASE_URL to opt in.",
      "No session is needed: the gallery is public as of ADR-0017 (prerendered, reads",
      "nothing). This refusal is about not shooting baselines against an unspecified",
      "target, not about credentials. See docs/adr/0017-public-theme-gallery.md.",
    ].join("\n"),
  );
}

export default defineConfig({
  testDir: "./e2e/theme-gallery",
  testMatch: /.*\.spec\.ts/,
  // `{platform}` is not decoration. Baselines are captured on darwin and committed;
  // a linux run (a future CI experiment, someone's container) would otherwise compare
  // its own font rasterisation against macOS PNGs and report every fixture as a
  // regression. Scoping by platform makes that run simply have no baselines yet, which
  // is an honest state. `{projectName}` separates the desktop and phone pictures.
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{platform}/{arg}{ext}",
  expect: {
    toHaveScreenshot: {
      // 1% of pixels. Sub-pixel text rasterisation moves between Chromium builds; a
      // layout or colour regression moves far more than this. Raising it to make a
      // failing baseline pass is the one forbidden move — recapture instead.
      maxDiffPixelRatio: 0.01,
      // Belt and braces with `data-motion="off"`: the attribute stops motion's own
      // animations, this stops CSS ones (and `motion-on.spec.ts` asserts on computed
      // style and geometry rather than on a screenshot, so it is unaffected).
      animations: "disabled",
      caret: "hide",
    },
  },
  // No `webServer`: this config never starts anything. Point it at a server you started.
  use: {
    baseURL: BASE_URL,
    // Read-only by construction — no storage state that could carry a write-capable identity.
    screenshot: "only-on-failure",
    // The gallery's theme comes from the URL segment, never from the OS preference —
    // `/theme-gallery/light/...` is light under this setting. Pinning it anyway keeps
    // any `prefers-color-scheme` media query in the components deterministic.
    colorScheme: "dark",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } },
    // Chromium, deliberately: `devices["iPhone 13"]` defaults to WebKit, which would
    // add a second engine's rasterisation to the baselines for no extra signal. What is
    // wanted here is the phone VIEWPORT and device-pixel-ratio, not Safari.
    { name: "phone", use: { ...devices["iPhone 13"], browserName: "chromium" } },
  ],
  // Deterministic captures: one worker, no retries silently masking a flaky baseline.
  workers: 1,
  retries: 0,
  reporter: [["list"]],
});
