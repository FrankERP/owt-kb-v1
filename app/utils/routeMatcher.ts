// Auth-middleware route matcher (used by proxy.ts `config.matcher`).
//
// The middleware protects every path EXCEPT a small allow-list of public
// prefixes (auth pages, NextAuth API, the cron routes, the A3 identity route,
// the theme gallery, and static assets). Each excluded prefix
// MUST be anchored to a path boundary (`(?:/|$)`) — a bare-prefix lookahead
// like `(?!auth…)` also matches `/author`, silently leaving that route (and any
// future `/auth*` route) unauthenticated. See the audit login-gate-bypass fix.
//
// `api/service-readiness-verification/identity$` (Service Readiness A3 §4) is the
// one exclusion anchored with `$` to an exact API PATH rather than a prefix, on
// purpose: the verification harness must read the deployment's dataset identity
// before it has a session, but no sibling route under
// /api/service-readiness-verification/ may inherit that public reachability. The
// route itself fails closed — in any ordinary deployment it answers 404 because
// the verification marker, isolated project/dataset, E2E-writes flag and
// `disabled` delivery mode are all absent.
//
// `api/cron(?:/|$)` is NOT an unauthenticated exclusion — it is a DIFFERENT
// authentication. Both cron routes check `Authorization: Bearer ${CRON_SECRET}`
// inside their own handlers; a machine caller (Vercel's daily cron, the GitHub
// Actions sweep, declared five-minutely) has no NextAuth session, so a session gate
// in front of them only ever produces a 307 to /api/auth/signin. That is exactly
// what happened in production: the daily reminders + outbox liveness alarm never
// ran, and layer 1's `curl --fail` does not treat 3xx as failure, so the sweep
// was a silent no-op reporting green. Anchored like every other prefix, so
// `/api/cronjobs` or `/api/cron-admin` stay session-gated.
// `theme-gallery(?:/|$)` is excluded because the gallery is a statically
// prerendered review surface that reads NOTHING — no Sanity client, no session,
// no env, no fetch, in its whole runtime import closure — and rendering it
// anonymously is what lets an agent that must never enter credentials verify
// both themes on the app's real components. Child A2 originally chose to gate
// it, for tier-and-cost reasons rather than any property of the route; that
// decision is superseded by ADR-0017, which also records why the alternative
// (placing it under the already-excluded `/auth/` prefix) was rejected: it
// produces identical exposure with less auditability.
//
// The exclusion is deliberately anchored. `/theme-gallery-secrets` stays gated.
//
// `api/mcp(?:/|$)` (P0 plan step 5, spec I11) is the MCP route itself — a plain
// `(Request) => Promise<Response>` that authenticates every call with its own
// bearer token, never a session cookie. Prefix-anchored because the handler
// owns everything under it.
// `api/oauth/register$` and `api/oauth/token$` are anchored with `$` to their
// EXACT path, not a prefix, matching `api/service-readiness-verification/identity$`
// above: registration validates a signed client id and token exchange validates
// a signed code, both inside the handler, and neither authentication extends to
// a sibling route. `/oauth/authorize` and `/api/oauth/authorize` deliberately
// stay OUT of this list — the consent screen needs the real member session, and
// NextAuth's default `redirect` callback round-trips its full query string
// through sign-in unchanged, so gating it costs nothing.
// `\.well-known(?:/|$)` opens the public `/.well-known/*` request path that
// `proxy.ts` sees before `next.config.mjs`'s `beforeFiles` rewrites run —
// discovery (RFC 8414 / RFC 9728) must be reachable before any login exists.
// The rewrite destinations themselves (`app/api/oauth/discovery/*`) are
// ordinary route files under `/api`, so they stay gated; they are reachable
// only through the rewrite, never directly.
export const MIDDLEWARE_MATCHER =
  "/((?!auth(?:/|$)|api/auth(?:/|$)|api/cron(?:/|$)|theme-gallery(?:/|$)|api/service-readiness-verification/identity$|api/mcp(?:/|$)|api/oauth/register$|api/oauth/token$|\\.well-known(?:/|$)|_next/static(?:/|$)|_next/image(?:/|$)|favicon\\.ico$|LogoOasis\\.png$|icons(?:/|$)|manifest\\.webmanifest$).*)";

// Mirrors Next.js matcher semantics (full-path match) so the exclusion logic
// can be unit-tested without importing the middleware runtime.
const RE = new RegExp("^" + MIDDLEWARE_MATCHER + "$");

/** True when the auth middleware runs for `pathname` (i.e. the route is gated). */
export function middlewareRuns(pathname: string): boolean {
  return RE.test(pathname);
}
