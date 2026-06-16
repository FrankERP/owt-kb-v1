import type { CapacitorConfig } from "@capacitor/cli";

// ─────────────────────────────────────────────────────────────────────────────
// Capacitor configuration for the OWT iOS + Android apps.
//
// PHASE 1 (current): online-only wrap. The native shell loads the hosted Next.js
// app over the network (server.url). This gets real builds into TestFlight / Play
// internal testing fast. It does NOT yet provide offline support.
//
// PHASE 2 (offline): remove the `server` block below and point `webDir` at the
// static export ("out"). The member UI ships inside the binary and caches data
// locally for offline use. See docs/MOBILE.md.
// ─────────────────────────────────────────────────────────────────────────────

const config: CapacitorConfig = {
  // ⚠️ PERMANENT once published to the App Store / Play Store. Confirm before the
  // first store submission (reverse-DNS, must match your registered identifiers).
  appId: "com.owtBackstage.app",
  appName: "OWT Backstage",

  // Phase 1 uses the committed fallback page (shown when the device is offline or
  // the remote URL is unreachable). Phase 2 switches this to "out" (Next export).
  webDir: "mobile/fallback",

  server: {
    // ⚠️ REPLACE with your production URL before building (e.g. https://owt.example.com).
    // This is the only value required to make the Phase 1 wrap functional.
    url: "https://owt-backstage.vercel.app",
    cleartext: false,
  },
};

export default config;
