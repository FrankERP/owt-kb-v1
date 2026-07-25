// Auth-middleware route matcher (used by proxy.ts `config.matcher`).
//
// The middleware protects every path EXCEPT a small allow-list of public
// prefixes (auth pages, NextAuth API, static assets). Each excluded prefix
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
export const MIDDLEWARE_MATCHER =
  "/((?!auth(?:/|$)|api/auth(?:/|$)|api/service-readiness-verification/identity$|_next/static(?:/|$)|_next/image(?:/|$)|favicon\\.ico$|LogoOasis\\.png$|icons(?:/|$)|manifest\\.webmanifest$).*)";

// Mirrors Next.js matcher semantics (full-path match) so the exclusion logic
// can be unit-tested without importing the middleware runtime.
const RE = new RegExp("^" + MIDDLEWARE_MATCHER + "$");

/** True when the auth middleware runs for `pathname` (i.e. the route is gated). */
export function middlewareRuns(pathname: string): boolean {
  return RE.test(pathname);
}
