import { describe, expect, it } from "vitest";

import {
  awaitRunScopedEvidence,
  describeEvidenceWait,
  hasRunScopedBlocked,
} from "../lib/awaitRunEvidence";
import { DELIVERY_ATTEMPT_EVENT, DELIVERY_BLOCKED_EVENT, type DeliveryEventLine } from "../lib/deliveryEvidence";

const RUN = "claudeRun999";
const OTHER = "claudeRun998";

function line(over: Partial<DeliveryEventLine> = {}): DeliveryEventLine {
  return {
    source: "test-results/sr-runtime.log",
    line: 1,
    event: DELIVERY_BLOCKED_EVENT,
    runId: RUN,
    transport: "fcm",
    ...over,
  };
}

/** Deterministic clock so no test depends on real elapsed time. */
function fakeClock(startMs = 0) {
  let t = startMs;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

describe("hasRunScopedBlocked — the predicate the wait ends on", () => {
  it("accepts a blocked line carrying this run id", () => {
    expect(hasRunScopedBlocked([line()], RUN)).toBe(true);
  });

  it("REJECTS another run's blocked line — the whole point of the check", () => {
    expect(hasRunScopedBlocked([line({ runId: OTHER })], RUN)).toBe(false);
  });

  it("rejects a blocked line with no run id at all", () => {
    expect(hasRunScopedBlocked([line({ runId: null })], RUN)).toBe(false);
  });

  it("rejects an ATTEMPT carrying this run id — only a block counts", () => {
    expect(hasRunScopedBlocked([line({ event: DELIVERY_ATTEMPT_EVENT })], RUN)).toBe(false);
  });

  it("rejects everything when the run id is empty", () => {
    expect(hasRunScopedBlocked([line()], "")).toBe(false);
  });
});

describe("awaitRunScopedEvidence", () => {
  it("returns immediately when the evidence is already present", async () => {
    const clock = fakeClock();
    const r = await awaitRunScopedEvidence({
      runId: RUN,
      readEvents: () => [line()],
      ...clock,
    });
    expect(r.satisfied).toBe(true);
    expect(r.reads).toBe(1);
    expect(r.waitedMs).toBe(0);
  });

  it("waits for late evidence and then succeeds — the race this exists to fix", async () => {
    const clock = fakeClock();
    let reads = 0;
    const r = await awaitRunScopedEvidence({
      runId: RUN,
      // The stream is behind: the first two reads show only the PREVIOUS run's
      // blocked line, exactly what was observed live.
      readEvents: () => {
        reads += 1;
        return reads < 3 ? [line({ runId: OTHER })] : [line({ runId: OTHER }), line()];
      },
      timeoutMs: 90_000,
      pollMs: 2_000,
      ...clock,
    });
    expect(r.satisfied).toBe(true);
    expect(r.reads).toBe(3);
    expect(r.waitedMs).toBe(4_000);
  });

  it("gives up at the deadline and reports NOT satisfied — a real absence still fails", async () => {
    const clock = fakeClock();
    const r = await awaitRunScopedEvidence({
      runId: RUN,
      readEvents: () => [], // nothing ever arrives
      timeoutMs: 10_000,
      pollMs: 2_000,
      ...clock,
    });
    expect(r.satisfied).toBe(false);
    expect(r.waitedMs).toBeGreaterThanOrEqual(10_000);
    // It still returns the events it saw, so the evaluator produces its normal failure.
    expect(r.events).toEqual([]);
  });

  it("never accepts another run's evidence, however long it waits", async () => {
    const clock = fakeClock();
    const r = await awaitRunScopedEvidence({
      runId: RUN,
      readEvents: () => [line({ runId: OTHER }), line({ runId: null })],
      timeoutMs: 20_000,
      pollMs: 5_000,
      ...clock,
    });
    expect(r.satisfied).toBe(false);
    expect(r.events).toHaveLength(2);
  });

  it("degrades to a single read when the timeout is zero or negative", async () => {
    const clock = fakeClock();
    for (const timeoutMs of [0, -1]) {
      const r = await awaitRunScopedEvidence({
        runId: RUN,
        readEvents: () => [],
        timeoutMs,
        ...clock,
      });
      expect(r.reads).toBe(1);
      expect(r.satisfied).toBe(false);
    }
  });

  it("supports an async source", async () => {
    const clock = fakeClock();
    const r = await awaitRunScopedEvidence({
      runId: RUN,
      readEvents: async () => [line()],
      ...clock,
    });
    expect(r.satisfied).toBe(true);
  });
});

describe("describeEvidenceWait", () => {
  it("distinguishes already-present, arrived-late, and timed-out", () => {
    expect(describeEvidenceWait({ events: [], satisfied: true, reads: 1, waitedMs: 0 })).toMatch(
      /already present/,
    );
    expect(describeEvidenceWait({ events: [], satisfied: true, reads: 4, waitedMs: 6_000 })).toMatch(
      /arrived after 6\.0s \(4 reads\)/,
    );
    expect(describeEvidenceWait({ events: [], satisfied: false, reads: 46, waitedMs: 90_000 })).toMatch(
      /no run-scoped delivery evidence after 90\.0s/,
    );
  });
});
