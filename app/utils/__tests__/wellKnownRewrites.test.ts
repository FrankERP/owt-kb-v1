// Pins next.config.mjs's `/.well-known/*` rewrites (P0 plan step 4, spec I11).
//
// routeMatcher.ts's `\.well-known(?:/|$)` exclusion (step 5) only opens the
// public REQUEST PATH proxy.ts sees before rewrites run — rewrites have no
// route file of their own, so the routeMatcher.test.ts `PUBLIC_ROUTES` walk
// (which enumerates `app/**/{page,route}.tsx` files) cannot see what that
// exclusion actually exposes. This test closes that gap directly: it pins the
// full set of `/.well-known/*` rewrites so a future rewrite added anywhere
// other than `beforeFiles`, or pointed at anything other than the two
// discovery handlers, fails the suite instead of shipping quietly public.
//
// `next.config.mjs` runs `assertDeploymentCoherence(process.env)` at import
// time (A3 §3), but that guard is a no-op without `VERCEL_GIT_COMMIT_REF` (an
// ordinary local/test run never sets it) — see app/utils/__tests__/redirects.test.ts,
// which imports the same config the same way.
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import nextConfig from "../../../next.config.mjs";

const WELL_KNOWN_REWRITES = [
  {
    source: "/.well-known/oauth-authorization-server",
    destination: "/api/oauth/discovery/authorization-server",
  },
  {
    source: "/.well-known/oauth-protected-resource",
    destination: "/api/oauth/discovery/protected-resource",
  },
  {
    source: "/.well-known/oauth-protected-resource/api/mcp",
    destination: "/api/oauth/discovery/protected-resource",
  },
];

describe("next.config.mjs /.well-known rewrites (I11)", () => {
  it("rewrites() returns a phased object, not a plain array", async () => {
    expect(nextConfig.rewrites).toBeTypeOf("function");
    const rewrites = await nextConfig.rewrites!();
    // A plain-array return is Next's OTHER valid shape for rewrites() and
    // means every entry runs before both pages AND dynamic routes with no
    // `afterFiles`/`fallback` phasing at all. Pinning the phased-object shape
    // means a regression to a plain array — which would still technically put
    // '/.well-known/*' "in a rewrite" but outside any named phase this test
    // inspects — fails loudly here instead of just changing behavior.
    expect(Array.isArray(rewrites)).toBe(false);
  });

  it("the beforeFiles /.well-known/* rewrites are EXACTLY the two discovery handlers", async () => {
    const rewrites = (await nextConfig.rewrites!()) as {
      beforeFiles?: Array<{ source: string; destination: string }>;
      afterFiles?: Array<{ source: string; destination: string }>;
      fallback?: Array<{ source: string; destination: string }>;
    };

    const wellKnownOf = (list?: Array<{ source: string; destination: string }>) =>
      (list ?? []).filter((r) => r.source.startsWith("/.well-known"));

    expect(wellKnownOf(rewrites.beforeFiles)).toEqual(WELL_KNOWN_REWRITES);
  });

  it("no /.well-known/* source appears in afterFiles or fallback", async () => {
    const rewrites = (await nextConfig.rewrites!()) as {
      beforeFiles?: Array<{ source: string; destination: string }>;
      afterFiles?: Array<{ source: string; destination: string }>;
      fallback?: Array<{ source: string; destination: string }>;
    };

    const wellKnownOf = (list?: Array<{ source: string; destination: string }>) =>
      (list ?? []).filter((r) => r.source.startsWith("/.well-known"));

    // proxy.ts runs before ALL rewrite phases, so the exclusion opens the
    // request path regardless of phase — but `beforeFiles` is the only phase
    // that wins over a matching filesystem route, and it is the only phase the
    // rewrite was written into. A `/.well-known/*` entry surfacing in
    // `afterFiles` or `fallback` instead is a silent behavior change this test
    // catches.
    expect(wellKnownOf(rewrites.afterFiles)).toEqual([]);
    expect(wellKnownOf(rewrites.fallback)).toEqual([]);
  });

  it("public/ has no .well-known directory of its own", () => {
    // Static files under public/ are served on their literal path. Once
    // '/.well-known' is excluded from the session middleware, any file placed
    // at public/.well-known/* later would become reachable, unauthenticated,
    // with nothing in routeMatcher.ts or this test noticing — so pin that
    // nothing is there today.
    const wellKnownDir = join(process.cwd(), "public", ".well-known");
    expect(existsSync(wellKnownDir), `${wellKnownDir} must not exist — see the comment above`).toBe(false);
  });
});
