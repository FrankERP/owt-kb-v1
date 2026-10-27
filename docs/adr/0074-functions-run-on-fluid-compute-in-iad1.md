# ADR-0074: Functions run on Fluid compute, and stay in iad1 although Sanity lives in Europe

**Date:** 2026-10-27 · **Status:** Accepted

## Context

Measured on 2026-10-27 (main 249157b):

- The Sanity dataset lives in Europe: every response carries `x-sanity-shard: gcp-eu-w1`
  (Saint-Ghislain, Belgium). The Vercel functions run in `iad1` (Washington). Every app read is
  live (`useCdn: false`, see `sanity/lib/operationalClient.ts`), so each query crosses the
  Atlantic: ~85 ms a round trip, ~250 ms more when the instance opens a new TLS connection.
  A song page makes 4 sequential reads, `/me` 3, Inicio 2.
- The project predates Vercel's 2025-04-23 switch to Fluid compute by default, and ran on the
  legacy model (`defaultResourceConfig.fluid: false`, 10 s default timeout). A request with no
  Sanity read at all (`/api/auth/session` unauthenticated, the `/` redirect) answered in
  1.2–1.3 s cold against ~0.2 s warm, measured from a cloud session. With ~34 people using
  the app in bursts around services, many visits land on a cold instance.
- Usage was far from every Hobby limit (52 136 invocations and 4.6 GB-h in 30 days), so the
  problem is latency, not quota.

## Decision

`vercel.json` sets `"fluid": true`. One warm instance serves concurrent requests, so the 30 s
member-access cache (`app/utils/memberAccess.ts`) and the open connection to Sanity are reused
across visits instead of per instance, production deployments get bytecode caching and
pre-warming, and the default timeout becomes 300 s (routes that declare `maxDuration` keep it).
It is set per deployment in `vercel.json`, not in the dashboard, so it reaches `preview` (dev)
before `main` and is reverted by a commit.

The region stays `iad1` for now, pinned in the same file (`"regions": ["iad1"]`, the value the
project setting already had) so a dashboard change cannot move it silently.

Module state was audited for sharing between concurrent requests: the access cache, the MCP
grant store (`app/mcp/oauth/grantStore.ts`), the SMTP pool (`app/utils/email.ts`) and the
Google audience list are keyed per member or document, or static; nothing keeps per-request data
in module scope. The one change it needed: the outbox sweep's role memo (`app/utils/outboxSweep.ts`)
is swapped at the start of each sweep, so `fetchRole` now writes into the memo that was current
when its read started — otherwise an older sweep's in-flight read could land in a newer sweep's
memo and that sweep would classify against state read before its own commit. Concurrent sweeps on
one instance also share the 8 SMTP connections, which roughly doubles queue waits (~2.4 s a
wave), far under `SEND_TIMEOUT_MS`.

## Rejected

**A keep-warm cron.** It spends invocations to warm one instance and does nothing for a burst
of concurrent visits, which is exactly when the team opens the app.

**Moving the functions next to Sanity (`cdg1`/`fra1`).** Each Sanity read would drop from
~85 ms to ~10 ms, but every request from Mexico City would pay ~95 ms more to reach the
function, including the ones that read nothing (`/api/auth/session`, called on every load and
when the app returns to the foreground). The net gain is ~250 ms on a 4-read page, ~60 ms on a
2-read page and a ~95 ms loss on a 0-read route. Collapsing the read waterfalls (song page
4 → 2, `/me` 3 → 2) and Fluid's warm connections shrink the gain first, so the move waits for
measurements after those land. It is one line (`"regions"`) in `vercel.json` if they argue for it.

**Reading through the Sanity API CDN.** It has a copy in Northern Virginia, next to `iad1`, but
a member who just edited a chart could reload and see the old one for up to 60 s. Reads stay
live; the catalog alone could move to the CDN later if measurements show those pages slow.

## Consequences

Vercel bills Fluid by active CPU and provisioned memory instead of GB-hours of duration. At this
volume (functions mostly waiting on Sanity) it stays inside Hobby's included usage; check the
Usage page a week after the switch. Turning Fluid off brings the cold starts back.
Any future module-level state must be safe for concurrent requests on one instance.
