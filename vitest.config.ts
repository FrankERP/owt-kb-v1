import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  // Include tsx and scripts .test.ts too, so those files can't be silently
  // skipped (a false-green trap). Note: environment is "node" — a .test.tsx that
  // needs a DOM must set up jsdom itself.
  // `e2e/**` holds the Service Readiness A3 deployed-route harness. Its Playwright
  // scenarios are `*.spec.ts` (never matched here); its OFFLINE unit tests — the
  // config refusals, the preflight aborts, the header parity and the redaction
  // assertion — are `*.test.ts` and must run in the ordinary `npm test` gate, because
  // they are the only part of the harness that is provable without a deployment.
  test: {
    environment: "node",
    include: ["app/**/*.test.{ts,tsx,mjs}", "scripts/**/*.test.{ts,mjs}", "e2e/**/*.test.ts"],
    passWithNoTests: true,
  },
  resolve: { alias: { "@": resolve(__dirname, ".") } },
});
