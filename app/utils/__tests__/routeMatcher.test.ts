import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { middlewareRuns, MIDDLEWARE_MATCHER } from "../routeMatcher";

describe("auth middleware route matcher", () => {
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

  it("leaves static assets public", () => {
    for (const p of ["/_next/static/chunks/main.js", "/_next/image", "/favicon.ico", "/LogoOasis.png", "/icons/icon-192.png", "/manifest.webmanifest"]) {
      expect(middlewareRuns(p)).toBe(false);
    }
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
