# ADR-0027: Agent verification on dev uses a local read-only runner, not a server login path

**Date:** 2026-09-01 · **Status:** Accepted

## Context

Every app surface is session-gated and dev sits behind Vercel SSO. Agents may not enter
credentials. ADR-0017 solved this for one page by making it public; that does not scale to
`/admin`. The A3 harness signs in from env credentials but refuses dev by design (dev is the
production dataset).

## Decision

`scripts/dev-verify.ts`: a local Playwright runner that signs in as a dedicated retired
`admin` member with credentials from `.env.local`, caches the session in a gitignored
storage state, and aborts every non-GET request in the browser. No server code changes.

## Rejected

- **A server-minted verification session (token route).** New auth boundary, new production
  secret, critical review, and exactly what ADR-0017 declined.
- **Frank's own account.** Super-admin credential on disk; login events attributed to a person.
- **Fixed smoke specs only.** Cannot answer "look at what I just built"; may be layered on later.

## Consequences

An `admin` credential lives in a local env file (see `docs/SECRETS.md`, kill switch
`disabled: true`, which the seed script preserves across rotations). Each sign-in writes one
`loginEvent`; the `lastSeen` heartbeat is suppressed client-side. The member is a worship
member (retired) and a kids manager only, because kids reads ignore `retiredFrom`. `visual-verifier` may consume the runner's artifacts for gated routes but
still never enters a credential. The block is wider than the spec's `/api/**` — every
non-GET to the target — because server actions POST to page URLs.
