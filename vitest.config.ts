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
    // TZ IS PART OF THE GATE, NOT PART OF THE MACHINE.
    //
    // CLAUDE.md's timezone invariant ("Render pinned to local noon:
    // `new Date(iso.slice(0,10)+"T12:00:00")` — never bare `new Date(iso)`")
    // is guarded ONLY by tests, and those tests can only observe a UTC day-flip
    // when the process runs at a negative UTC offset. Unpinned, the guard was
    // conditional on where it ran: replacing `MonthCalendar`'s `noon()` (or
    // `MonthGenerator`'s weekday computation on a calendar toggle) with a bare
    // `new Date(iso)` left the whole suite GREEN under `TZ=UTC`, while killing
    // 9 and 7 tests respectively on a dev machine set to America/Mexico_City.
    // A contributor in UTC, or any CI container (which defaults to UTC), would
    // have shipped the day-flip with a clean gate.
    //
    // America/Mexico_City is the right pin because it is the app's ONE
    // timezone — every service date is authored, rendered and reasoned about
    // there (see the invariant above and `docs/adr/`), so the suite asserting
    // in it is the suite asserting about production. A generic offset like
    // `Etc/GMT+6` would catch the same day-flips but would silently diverge
    // the day Mexico changes its DST rules again, which is exactly the class
    // of bug these date tests exist to catch.
    env: { TZ: "America/Mexico_City" },
  },
  resolve: { alias: { "@": resolve(__dirname, ".") } },
});
