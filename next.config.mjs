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
    ],
  },

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
    ];
  },
};

export default nextConfig;
