// Auth-middleware route matcher (used by proxy.ts `config.matcher`).
//
// The middleware protects every path EXCEPT a small allow-list of public
// prefixes (auth pages, NextAuth API, static assets). Each excluded prefix
// MUST be anchored to a path boundary (`(?:/|$)`) — a bare-prefix lookahead
// like `(?!auth…)` also matches `/author`, silently leaving that route (and any
// future `/auth*` route) unauthenticated. See the audit login-gate-bypass fix.
export const MIDDLEWARE_MATCHER =
  "/((?!auth(?:/|$)|api/auth(?:/|$)|_next/static(?:/|$)|_next/image(?:/|$)|favicon\\.ico$|LogoOasis\\.png$|icons(?:/|$)|manifest\\.webmanifest$).*)";

// Mirrors Next.js matcher semantics (full-path match) so the exclusion logic
// can be unit-tested without importing the middleware runtime.
const RE = new RegExp("^" + MIDDLEWARE_MATCHER + "$");

/** True when the auth middleware runs for `pathname` (i.e. the route is gated). */
export function middlewareRuns(pathname: string): boolean {
  return RE.test(pathname);
}
