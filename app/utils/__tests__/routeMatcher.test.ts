import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { middlewareRuns, MIDDLEWARE_MATCHER } from "../routeMatcher";

/**
 * Every routable path in `app/`, read off disk: route groups `(x)` dropped and
 * dynamic segments `[slug]` given a concrete value, the way Next.js resolves
 * them. Enumerating the real surface — rather than a hand-kept list — is what
 * makes a future exclusion that quietly opens an extra route fail here.
 */
function appRoutes(): string[] {
  const appDir = join(process.cwd(), "app");
  const routes = new Set<string>(["/"]);
  for (const e of readdirSync(appDir, { recursive: true, withFileTypes: true })) {
    if (!/^(page|route)\.(t|j)sx?$/.test(e.name)) continue;
    const dir = String(e.parentPath ?? (e as unknown as { path: string }).path);
    const segments = join(dir, e.name)
      .slice(appDir.length)
      .replace(/\/(page|route)\.(t|j)sx?$/, "")
      .split("/")
      .filter((s) => s && !/^\(.*\)$/.test(s))
      .map((s) => (s.startsWith("[") ? "sample" : s));
    routes.add("/" + segments.join("/"));
  }
  return [...routes].sort();
}

/**
 * The ONLY routes in `app/` that the auth middleware may leave ungated. Adding
 * to this list is a deliberate, reviewable act — the whole point is that opening
 * a route cannot happen as a side effect of widening a regex.
 */
const PUBLIC_ROUTES = [
  "/api/auth/sample", // NextAuth's own catch-all — it IS the login flow
  "/api/cron/flush-notifications", // Bearer CRON_SECRET, checked in-handler
  "/api/cron/service-reminders", // Bearer CRON_SECRET, checked in-handler
  "/api/cron/smtp-probe", // Bearer CRON_SECRET, checked in-handler; sends no mail
  "/api/service-readiness-verification/identity", // A3 §4; fails closed with 404
  "/auth/not-a-member",
  "/auth/signin",
  // The theme gallery: statically prerendered, reads nothing (no Sanity client,
  // no session, no env, no fetch in its runtime import closure), noindex, and
  // carrying only placeholder fixture data. Opened deliberately so an agent that
  // must never enter credentials can verify both themes on the app's real
  // components. Child A2 gated it for tier-and-cost reasons; ADR-0017 supersedes
  // that. THIS ENTRY IS THE DECISION, not an accident — if it appears without an
  // ADR behind it, that is the signal something went wrong.
  "/theme-gallery/sample/sample",
];

describe("auth middleware route matcher", () => {
  it("gates EVERY route in app/ except the reviewed public list", () => {
    const routes = appRoutes();
    expect(routes.length).toBeGreaterThan(20); // the walk really found routes
    expect(routes).toContain("/api/cron/flush-notifications");
    expect(routes).toContain("/studio/sample");

    const ungated = routes.filter((p) => !middlewareRuns(p));
    expect(ungated).toEqual(PUBLIC_ROUTES);
  });

  it("gates protected app routes", () => {
    for (const p of ["/", "/me", "/schedule", "/admin", "/tag", "/posts/abc", "/studio"]) {
      expect(middlewareRuns(p)).toBe(true);
    }
  });

  it("leaves auth pages and NextAuth API public", () => {
    for (const p of ["/auth/signin", "/auth/not-a-member", "/api/auth/session", "/api/auth/csrf"]) {
      expect(middlewareRuns(p)).toBe(false);
    }
  });

  it("gates /author and its subpaths (regression: bare-`auth` prefix bypass)", () => {
    // The catalog author pages must NOT be treated as public `/auth` routes.
    expect(middlewareRuns("/author")).toBe(true);
    expect(middlewareRuns("/author/hillsong-worship")).toBe(true);
    // Any future top-level route beginning with "auth" stays gated too.
    expect(middlewareRuns("/authorize")).toBe(true);
    expect(middlewareRuns("/authors")).toBe(true);
  });

  it("still protects other /api routes (they carry their own guards too)", () => {
    expect(middlewareRuns("/api/song/123")).toBe(true);
    expect(middlewareRuns("/api/admin/roles")).toBe(true);
  });

  it("lets the cron routes through — they authenticate with CRON_SECRET, not a session", () => {
    // Regression: both were session-gated, so every machine call got a 307 to
    // /api/auth/signin and the handler never ran. The daily Vercel cron (service
    // reminders + the outbox liveness alarm) and layer 1 of the outbox (GitHub
    // Actions, on a sub-hourly schedule) were dead — and layer 1's `curl --fail`
    // ignores 3xx, so it reported green the whole time.
    expect(middlewareRuns("/api/cron/service-reminders")).toBe(false);
    expect(middlewareRuns("/api/cron/flush-notifications")).toBe(false);
  });

  it("gates near-miss /api/cron* paths (the exclusion is anchored, not a bare prefix)", () => {
    expect(middlewareRuns("/api/cronjobs")).toBe(true);
    expect(middlewareRuns("/api/cron-admin")).toBe(true);
    expect(middlewareRuns("/api/crontab/secrets")).toBe(true);
    // Nothing OUTSIDE /api inherits it either.
    expect(middlewareRuns("/cron")).toBe(true);
    expect(middlewareRuns("/cron/service-reminders")).toBe(true);
  });

  it("leaves ONLY the exact A3 verification identity path public", () => {
    // The harness must read the deployment's dataset identity before it has a
    // session (Service Readiness A3 §4). The route itself fails closed with a 404
    // in any ordinary deployment.
    expect(middlewareRuns("/api/service-readiness-verification/identity")).toBe(false);
    // Anchored with `$`: no sibling or child path inherits public reachability.
    expect(middlewareRuns("/api/service-readiness-verification")).toBe(true);
    expect(middlewareRuns("/api/service-readiness-verification/identity/")).toBe(true);
    expect(middlewareRuns("/api/service-readiness-verification/identity/extra")).toBe(true);
    expect(middlewareRuns("/api/service-readiness-verification/reset")).toBe(true);
    expect(middlewareRuns("/api/service-readiness-verification/seed")).toBe(true);
    expect(middlewareRuns("/api/service-readiness-verification/identityX")).toBe(true);
  });

  it("leaves static assets public", () => {
    for (const p of ["/_next/static/chunks/main.js", "/_next/image", "/favicon.ico", "/LogoOasis.png", "/icons/backstage-v2-192.png", "/manifest.webmanifest"]) {
      expect(middlewareRuns(p)).toBe(false);
    }
  });

  it("the cron exclusion changed the gating of NOTHING but /api/cron/*", () => {
    // Differential check against the matcher as it stood before the cron fix
    // (the same string with the one new alternative removed). Every real route
    // in app/ is enumerated from disk, so a future exclusion that quietly opens
    // an admin API or /studio fails here instead of in production.
    const previous = MIDDLEWARE_MATCHER.replace("api/cron(?:/|$)|", "");
    expect(previous, "the cron alternative must be present to remove").not.toBe(MIDDLEWARE_MATCHER);
    const before = new RegExp("^" + previous + "$");

    const changed = appRoutes().filter((p) => before.test(p) !== middlewareRuns(p));
    expect(changed.sort()).toEqual([
      "/api/cron/flush-notifications",
      "/api/cron/service-reminders",
      // Diagnostic only: connect, greet, AUTH, QUIT. It sends no mail and reads
      // no content, and like its siblings it authenticates with CRON_SECRET
      // itself rather than through the session gate.
      "/api/cron/smtp-probe",
    ]);
    // And the ones that changed became reachable, not the other way round.
    for (const p of changed) expect(middlewareRuns(p)).toBe(false);
  });

  it("the exported matcher is anchored, not a bare prefix", () => {
    // Guards against a regression back to the vulnerable `(?!auth|…)` form.
    expect(MIDDLEWARE_MATCHER).toContain("auth(?:/|$)");
  });

  it("proxy.ts inlines the exact same matcher (static-analysis sync guard)", () => {
    // Next.js needs a literal matcher in proxy.ts, so it can't import the
    // constant. This asserts the inlined literal never drifts from the tested
    // one — a drift here would silently re-open the login gate. Compared as
    // raw source text (both files escape backslashes identically).
    const root = process.cwd();
    const matcherSrc = readFileSync(join(root, "app/utils/routeMatcher.ts"), "utf8");
    const proxySrc = readFileSync(join(root, "proxy.ts"), "utf8");
    const literal = matcherSrc.match(/MIDDLEWARE_MATCHER\s*=\s*"([^"]*)"/)?.[1];
    expect(literal, "could not extract MIDDLEWARE_MATCHER literal").toBeTruthy();
    expect(proxySrc).toContain(literal!);
  });
});
