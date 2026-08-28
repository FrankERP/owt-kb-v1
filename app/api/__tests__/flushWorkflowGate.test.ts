// The flush workflow's failure gates read the route's JSON with `sed`, across a
// file boundary no compiler checks. Renaming a field on `SweepReport` would
// silently DISARM the gate: `sed` finds nothing, `[ -n "$X" ]` is false, and the
// run stays green while mail is being destroyed. The gates fail OPEN by design,
// so nothing else would ever report the break.
//
// Same shape as `routeMatcher.test.ts`'s proxy-matcher sync guard: pin the
// textual contract where the two sides can be compared.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// The route pulls in the `import "server-only"` guarded sweep and the Sanity
// clients. Only `aggregateFlushReports` is under test, and it is pure.
vi.mock("server-only", () => ({}));
vi.mock("@/app/utils/outboxSweep", () => ({
  sweepOutbox: vi.fn(),
  EMAIL_LIMIT: 40,
  SEND_BUDGET_MS: 40_000,
}));
vi.mock("@/app/utils/email", () => ({
  sendEmail: vi.fn(),
  SEND_CONCURRENCY: 8,
  SEND_TIMEOUT_MS: 20_000,
}));
vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: vi.fn() },
  rawIntegrityClient: { fetch: vi.fn() },
}));
vi.mock("@/sanity/lib/serverClient", () => ({
  serverClient: { fetch: vi.fn() },
  writeClient: { transaction: vi.fn(), patch: vi.fn() },
}));

import { aggregateFlushReports } from "@/app/api/cron/flush-notifications/route";

const WORKFLOW = readFileSync(
  path.join(process.cwd(), ".github/workflows/flush-notifications.yml"),
  "utf8",
);

/** The fields the workflow extracts, and the shell variable each lands in. */
const GATED_FIELDS = ["lost", "failed", "skipped"] as const;

describe("flush workflow gate ↔ route contract", () => {
  it("extracts every field it gates on, and the route actually serialises it", () => {
    const body = JSON.parse(JSON.stringify(aggregateFlushReports([])));
    for (const field of GATED_FIELDS) {
      // The route emits it...
      expect(body, `route body is missing "${field}"`).toHaveProperty(field);
      expect(typeof body[field], `"${field}" must be numeric for the shell test`).toBe("number");
      // ...and the workflow's sed pattern names it.
      expect(
        WORKFLOW.includes(`"${field}":`),
        `the workflow does not extract "${field}" — the gate is disarmed`,
      ).toBe(true);
    }
  });

  it("keeps `lost` and `failed` as HARD failures and `skipped` as a warning", () => {
    // The thresholds, pinned as prose because the shell is the only place they
    // exist. `failed` is red at 2 and warns at 1 deliberately: a single
    // undeliverable address must not hold the alarm red on every sweep.
    expect(WORKFLOW).toMatch(/\[ "\$LOST" -gt 0 \]/);
    expect(WORKFLOW).toMatch(/\[ "\$FAILED" -ge 2 \]/);
    expect(WORKFLOW).toMatch(/\[ "\$FAILED" -eq 1 \]/);
    expect(WORKFLOW).toMatch(/\[ "\$SKIPPED" -gt 0 \]/);
    // `skipped` never exits.
    const skippedBlock = WORKFLOW.slice(WORKFLOW.indexOf('SKIPPED" -gt 0'));
    expect(skippedBlock.slice(0, skippedBlock.indexOf("fi"))).not.toContain("exit 1");
  });

  it("orders the gates so no exit suppresses an annotation it should not", () => {
    // `lost` used to exit FIRST, so a sweep that both exhausted its budget and
    // hit a throttle annotated only the discarded recipients — the larger loss
    // produced nothing in the run summary. Two properties make that impossible:
    const gateStart = WORKFLOW.indexOf("LOST=$(");
    const firstExit = WORKFLOW.indexOf("exit 1", gateStart);
    const skippedWarn = WORKFLOW.indexOf("::warning::Sweep skipped");
    const lostError = WORKFLOW.indexOf("::error::Sweep discarded");

    // 1. `skipped` — which can co-occur with either failure — warns before any
    //    exit, so a red run still carries it.
    expect(skippedWarn).toBeGreaterThan(gateStart);
    expect(skippedWarn).toBeLessThan(firstExit);

    // 2. `lost` exits LAST, so it cannot suppress the `failed` annotations.
    //    (The `failed == 1` warning sits after the `failed >= 2` exit and that is
    //    fine — the two conditions are mutually exclusive, so neither can hide
    //    the other.)
    expect(lostError).toBeGreaterThan(WORKFLOW.indexOf("::error::Sweep FAILED"));
    expect(lostError).toBeGreaterThan(WORKFLOW.indexOf("::warning::Sweep failed 1 send"));
  });
});
