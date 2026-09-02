/**
 * Read-only lock 1 (spec §4.1): decide, per browser request, whether the runner
 * lets it reach the server. Pure — the Playwright `page.route` handler calls this
 * and aborts on `block`.
 *
 * Wider than the spec's `/api/**`: ANY non-GET/HEAD to the target is blocked,
 * because a Next.js server action is a POST to the page URL, not to /api. A read
 * never needs a non-GET, so nothing observable is lost.
 *
 * The one exception is the credentials callback POST, matched by exact path,
 * and only while the runner is in its sign-in phase.
 */

export const SIGNIN_CALLBACK_PATH = "/api/auth/callback/credentials";

export type Phase = "signin" | "observe";

export type RequestDecision = { action: "allow" } | { action: "block"; reason: "mutation" };

const READ_METHODS = new Set(["GET", "HEAD"]);

export function decideRequest(input: { method: string; url: string; phase: Phase }): RequestDecision {
  const method = input.method.toUpperCase();
  if (READ_METHODS.has(method)) return { action: "allow" };
  if (input.phase === "signin" && method === "POST") {
    let pathname: string;
    try {
      pathname = new URL(input.url).pathname;
    } catch {
      return { action: "block", reason: "mutation" };
    }
    if (pathname === SIGNIN_CALLBACK_PATH) return { action: "allow" };
  }
  return { action: "block", reason: "mutation" };
}
