# ADR-0014: Two Playwright configs

**Date:** 2026-08-08 · **Status:** Accepted

## Context

`playwright.config.ts` is not a test runner configuration in the ordinary sense — it is a
**write-safety harness that exists to refuse**. It calls `requireHarnessConfig()` at module
load (`:33`) and throws unless every condition holds: `SR_VERIFY_BASE_URL` recorded with no
localhost fallback, `ALLOW_SERVICE_READINESS_E2E_WRITES=true` literally, a base URL that is
neither production nor the stable dev domain, a resolved Sanity identity of project
`scbxomq9` / dataset `service-readiness-verification` (never `ebb8vcnk`, never `production`),
credentials from the runner's env, a complete run identity, and a Deployment Protection
bypass secret. It also has **no `webServer` block**, deliberately, so it can never start a
local server and silently verify something other than the recorded deployment.

Child A2 needs a *read-only* visual-regression runner for the theme gallery: no writes, no
Sanity identity, no bypass secret, and — unlike the above — the ability to run against a
local server.

## Decision

A second config, `playwright.vr.config.ts`, with its own `testDir` under `e2e/`.

The existing harness is left exactly as it is.

## Rejected

**Relaxing `playwright.config.ts` to serve both.** Every one of its refusals exists because
the Service Readiness work could otherwise write to the production dataset. Loosening it to
make a screenshot convenient trades a real data-safety guarantee for developer ergonomics,
and the loosened version would then be the one in the repo forever.

**Putting VR specs under the existing `testDir`.** They would inherit the refusal and could
never run.

## Consequences

- Two configs, and a reader must know which is which. That is what this record is for.
- The VR `testDir` sits **under `e2e/`** for a non-obvious reason: `eslint.config.mjs:42`
  disables `react-hooks/rules-of-hooks` only for `files: ["e2e/**"]`, and a Playwright spec
  using a `use` fixture outside that path fails `npx eslint .` — the repo's 0-errors gate.
- VR specs must be named **`*.spec.ts`, never `*.test.ts`**: `vitest.config.ts:15` includes
  `e2e/**/*.test.ts` and would sweep them into `npm test`.
