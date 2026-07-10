import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  // Include tsx and scripts .test.ts too, so those files can't be silently
  // skipped (a false-green trap). Note: environment is "node" — a .test.tsx that
  // needs a DOM must set up jsdom itself.
  test: { environment: "node", include: ["app/**/*.test.{ts,tsx,mjs}", "scripts/**/*.test.{ts,mjs}"], passWithNoTests: true },
  resolve: { alias: { "@": resolve(__dirname, ".") } },
});
