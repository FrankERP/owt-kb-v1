import { assertDeploymentCoherence } from "./scripts/lib/deployment-coherence.mjs";

// Fail closed at BUILD time (A3 §3): the verification branch may only build
// against the isolated dataset, and no other branch may build against it. A
// misconfigured deployment therefore never exists to be caught later at runtime.
// A build with no git ref (ordinary local development) asserts nothing.
assertDeploymentCoherence(process.env);

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,

  experimental: {
    // Tree-shake large packages to only include what's actually imported
    optimizePackageImports: ["sanity", "next-sanity", "@sanity/ui", "@sanity/icons"],
  },

  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cdn.sanity.io" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      // YouTube tutorial posters (TutorialPoster) — the still that replaces an
      // eagerly-booted embed iframe.
      { protocol: "https", hostname: "i.ytimg.com" },
    ],
  },

  // CSP CAVEAT (MCP connector, docs/MCP.md). There is no Content-Security-Policy
  // here today. If one is added, `form-action 'self'` alone BREAKS the consent
  // flow: the «Permitir»/«Cancelar» form posts to /api/oauth/authorize, which
  // answers 303 to the client's redirect_uri, and Chrome enforces `form-action`
  // on every redirect that follows a form submission — so the hop to claude.ai
  // is blocked and the connector never receives its code. Either allow the
  // redirect targets (`form-action 'self' https://claude.ai`, plus the loopback
  // callbacks `http://127.0.0.1:*` / `http://localhost:*` on preview and local,
  // where app/mcp/oauth/redirects.ts accepts them) or omit `form-action`. The same
  // holds for the native apps' sign-in (ADR-0091): «Entrar a la app» posts to
  // /app/authorize/submit, which answers 303 to the app's redirect — our own
  // `https` origin on production and preview, but the private scheme
  // `app.vercel.owt-backstage:` on LOCAL development, which `form-action 'self'`
  // would block.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options",          value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options",    value: "nosniff" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
          { key: "Referrer-Policy",           value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy",        value: "camera=(), microphone=(), geolocation=(), payment=()" },
        ],
      },
      {
        source: "/studio/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
      // Native-app sign-in (ADR-0091). AFTER the global entry on purpose: when two
      // entries set the same key on a path, Next sends the LAST one. The
      // confirmation page and its POST: no framing (another page cannot steal the
      // tap), `same-origin` referrer (so the POST carries a real `Origin`, never
      // `null`), no caching, and the client hint that gives the real Android
      // version (`Critical-CH` makes Chrome retry the navigation with it; the
      // reduced User-Agent freezes it at «Android 10»). Guarded by
      // `app/appAuth/__tests__/appAuthHeaders.test.ts`.
      ...["/app/authorize", "/app/authorize/submit"].map((source) => ({
        source,
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Cache-Control", value: "no-store" },
          { key: "Accept-CH", value: "Sec-CH-UA-Platform-Version" },
          { key: "Critical-CH", value: "Sec-CH-UA-Platform-Version" },
        ],
      })),
      // The inert callback pages: the URL carries a code, so no referrer, no cache, no index.
      ...["/app/callback/ios", "/app/callback/android"].map((source) => ({
        source,
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "no-store" },
          { key: "X-Robots-Tag", value: "noindex" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      })),
    ];
  },

  // R1 (spec §12.2, decision H): the tag and author pages fold into the library.
  // permanent → 308; bookmarks and the old nav keep working, no data change.
  async redirects() {
    return [
      { source: "/tag",            destination: "/biblioteca",            permanent: true },
      { source: "/tag/:slug",      destination: "/biblioteca?tag=:slug",  permanent: true },
      { source: "/author",         destination: "/biblioteca",            permanent: true },
      { source: "/author/:slug",   destination: "/biblioteca?author=:slug", permanent: true },
    ];
  },

  // MCP OAuth discovery (P0 plan step 4). `beforeFiles`, so these win over any
  // matching filesystem route. `proxy.ts` runs before rewrites, so it still sees
  // the literal `/.well-known/*` request path — step 5 (not this change) is what
  // excludes that prefix from the session middleware. The destinations are plain
  // route handlers, reached at these RFC-mandated paths only through the rewrite.
  async rewrites() {
    return {
      beforeFiles: [
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
      ],
    };
  },
};

export default nextConfig;
