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

import { defineConfig } from "@playwright/test";

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
