// Service Readiness A3 §4 — the deployed-route verification harness configuration.
//
// This config exists to REFUSE. It is loaded before any test, and it throws unless
// every one of the plan's conditions holds (see `e2e/service-readiness/lib/harnessGuards.ts`
// for the full list and the reasons):
//
//   · `SR_VERIFY_BASE_URL` is the explicitly recorded verification deployment URL —
//     there is no default and no localhost fallback
//   · `ALLOW_SERVICE_READINESS_E2E_WRITES=true`, literally
//   · the base URL is NOT production and NOT `dev-owt-backstage.vercel.app`
//   · the resolved Sanity identity is `scbxomq9` / `service-readiness-verification`,
//     never project `ebb8vcnk` and never dataset `production`
//   · test credentials come from the runner's env / CI secret store, never a tracked file
//   · the run identity `runId:candidateSha:deploymentId` is complete (it is the
//     dataset-lease owner and the login-event ownership predicate)
//   · a runner-side Deployment Protection bypass secret is present, because
//     Deployment Protection IS enabled on this project
//
// Running `npx playwright test` with none of that set prints the refusal and exits
// non-zero without contacting anything. That is the intended behaviour, and it is
// what proves the suite cannot run by accident.
//
// The suite exercises DEPLOYED routes only. There is deliberately no `webServer`
// block: this config can never start a local server, so it can never silently
// verify something other than the recorded deployment.

import { defineConfig } from "@playwright/test";

import { initialNavigationHeaders, resolveBypassSecret } from "./e2e/service-readiness/lib/bypass";
import { requireHarnessConfig } from "./e2e/service-readiness/lib/harnessGuards";

// Throws (with a codes-only operator message) unless every condition above holds.
const harness = requireHarnessConfig({ env: process.env, protectionExpected: true });

// Runner-side only. Read here, sent as a header, never written to a URL, a query
// string, a storage state, a report, or a log line.
const { secret: bypassSecret } = resolveBypassSecret(process.env);

export default defineConfig({
  testDir: "./e2e/service-readiness",
  testMatch: /.*\.spec\.ts$/,

  // Single-flight, always. The deterministic fixtures are shared state and are reset
  // between scenarios; two workers would race each other's reset and the lease's
  // ownership re-check would start failing mid-scenario. This is the local/retried
  // counterpart to the CI concurrency group
  // `owt-backstage-service-readiness-verification` with `cancel-in-progress: false`.
  workers: 1,
  fullyParallel: false,

  // A retry would re-run a mutating scenario against state a partial failure left
  // behind. Fixtures are reset per scenario, but a retry also silently re-signs-in,
  // which would create a second run-owned login event for a scenario that already
  // reconciled its first. Fail once, loudly.
  retries: 0,
  forbidOnly: true,

  // Generous, because every action crosses the public internet to a Preview
  // deployment and a cold serverless start is normal.
  timeout: 90_000,
  expect: { timeout: 15_000 },

  globalSetup: "./e2e/service-readiness/globalSetup.ts",
  globalTeardown: "./e2e/service-readiness/globalTeardown.ts",

  // Both directories are gitignored; the global teardown scans them for the bypass
  // secret and for any bypass query parameter before the run is allowed to pass.
  outputDir: "./test-results",
  reporter: [
    ["list"],
    ["html", { outputFolder: "./playwright-report", open: "never" }],
    ["json", { outputFile: "./test-results/service-readiness-results.json" }],
  ],

  use: {
    baseURL: harness.baseURL,

    // The bypass secret rides on the INITIAL navigation together with
    // `x-vercel-set-bypass-cookie: true` (see `signIn` in fixtures.ts), which makes
    // the provider return a bypass cookie the in-memory context then carries. The
    // header is kept on subsequent requests too, so a request that races the cookie
    // — an asset, a NextAuth redirect hop, a client `fetch` — is still authorized.
    extraHTTPHeaders: initialNavigationHeaders(bypassSecret),

    // Same exact deployment host for every hop; a redirect to another host is a bug,
    // not something to follow.
    ignoreHTTPSErrors: false,

    // Retained artifacts are scanned for leaks in teardown. Screenshots/videos are
    // kept only on failure, so a passing run retains the least possible material.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",

    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },

  projects: [
    {
      name: "verification-chromium",
      use: { browserName: "chromium" },
    },
  ],
});
