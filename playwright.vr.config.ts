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
// CREDENTIALS ARE DEFERRED, DELIBERATELY. The gallery is gated, so a headless run needs
// a member session — and provisioning one is a secret/auth-boundary change on CLAUDE.md's
// Critical list, which would re-tier Child A2 and require re-review. A2's bounded default
// is therefore: take Child D's baselines MANUALLY and record them. This config refuses to
// run until that decision is taken explicitly, rather than inventing credentials to
// unblock a screenshot.
//
// When credentials ARE provisioned, whatever variable they use gets a `docs/SECRETS.md`
// entry in the same commit — name, platforms that need it and those that do not, where the
// value came from, rotation steps, blast radius. Never the value.
//
// Specs are `*.spec.ts`, NEVER `*.test.ts`: `vitest.config.ts:15` includes
// `e2e/**/*.test.ts` and would sweep them into `npm test`.

import { defineConfig } from "@playwright/test";

const BASE_URL = process.env.THEME_GALLERY_VR_BASE_URL;
const OPT_IN = process.env.THEME_GALLERY_VR_ENABLED === "true";

if (!OPT_IN || !BASE_URL) {
  throw new Error(
    [
      "playwright.vr.config.ts refuses to run.",
      "",
      "Set THEME_GALLERY_VR_ENABLED=true and THEME_GALLERY_VR_BASE_URL to opt in.",
      "The theme gallery is a GATED route, so an authenticated session is required —",
      "and provisioning one re-opens Child A2's risk tier (CLAUDE.md's Critical list).",
      "Until that decision is taken, take Child D's baselines manually and record them.",
      "See docs/superpowers/plans/2026-08-08-light-mode-A2-rendering.md, step 5.",
    ].join("\n"),
  );
}

export default defineConfig({
  testDir: "./e2e/theme-gallery",
  testMatch: /.*\.spec\.ts/,
  // No `webServer`: this config never starts anything. Point it at a server you started.
  use: {
    baseURL: BASE_URL,
    // Read-only by construction — no storage state that could carry a write-capable identity.
    screenshot: "only-on-failure",
  },
  // Deterministic captures: one worker, no retries silently masking a flaky baseline.
  workers: 1,
  retries: 0,
  reporter: [["list"]],
});
