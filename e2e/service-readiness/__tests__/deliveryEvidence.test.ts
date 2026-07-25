// Offline proof of the A3 §3 zero-delivery evidence rules.
//
// The plan's hardest sentence is "fixture absence alone is not proof", so the central
// test here is that a run with NO complete recorded log source FAILS, rather than
// passing because nothing bad was seen.

import { describe, expect, it } from "vitest";

import {
  DELIVERY_ATTEMPT_EVENT,
  DELIVERY_BLOCKED_EVENT,
  describeDeliveryVerdict,
  evaluateDeliveryEvidence,
  parseDeliveryEvents,
} from "../lib/deliveryEvidence";

const RUN_ID = "srvrun-0123456789abcdef";

const BLOCKED_LINE = JSON.stringify({
  event: DELIVERY_BLOCKED_EVENT,
  runId: RUN_ID,
  transport: "smtp",
});
const ATTEMPT_LINE = JSON.stringify({
  event: DELIVERY_ATTEMPT_EVENT,
  runId: RUN_ID,
  transport: "resend",
});

describe("delivery event parsing", () => {
  it("parses structured JSON lines, keeping run id and transport", () => {
    const events = parseDeliveryEvents("runtime.log", `noise\n${BLOCKED_LINE}\nmore noise\n`);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      source: "runtime.log",
      line: 2,
      event: DELIVERY_BLOCKED_EVENT,
      runId: RUN_ID,
      transport: "smtp",
    });
  });

  it("also detects a bare textual mention, so a log-format change cannot hide an attempt", () => {
    const events = parseDeliveryEvents(
      "runtime.log",
      `2026-07-25T10:00:00Z WARN delivery_attempt runId=${RUN_ID} to smtp`,
    );
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe(DELIVERY_ATTEMPT_EVENT);
    expect(events[0].runId).toBe(RUN_ID);
  });

  it("does not confuse the two event names on a structured line", () => {
    const events = parseDeliveryEvents(
      "runtime.log",
      // A blocked line that also mentions the attempt name in a field.
      JSON.stringify({ event: DELIVERY_BLOCKED_EVENT, runId: RUN_ID, reason: "delivery_attempt suppressed" }),
    );
    expect(events.map((e) => e.event)).toEqual([DELIVERY_BLOCKED_EVENT]);
  });
});

describe("zero-delivery verdict", () => {
  it("PASSES only with a complete log source, a run-scoped blocked event, and zero attempts", () => {
    const verdict = evaluateDeliveryEvidence({
      events: parseDeliveryEvents("runtime.log", BLOCKED_LINE),
      runId: RUN_ID,
      completeLogSources: ["runtime.log"],
    });
    expect(verdict.failures).toEqual([]);
    expect(verdict.ok).toBe(true);
    expect(describeDeliveryVerdict(verdict)).toContain("0 delivery_attempt");
  });

  it("FAILS when no complete recorded log source was supplied — absence is not proof", () => {
    const verdict = evaluateDeliveryEvidence({
      events: parseDeliveryEvents("harness-evidence.log", BLOCKED_LINE),
      runId: RUN_ID,
      completeLogSources: [],
    });
    expect(verdict.failures.map((f) => f.code)).toEqual(["no_complete_log_source"]);
    expect(verdict.ok).toBe(false);
  });

  it("FAILS on any delivery_attempt event", () => {
    const verdict = evaluateDeliveryEvidence({
      events: parseDeliveryEvents("runtime.log", `${BLOCKED_LINE}\n${ATTEMPT_LINE}\n`),
      runId: RUN_ID,
      completeLogSources: ["runtime.log"],
    });
    expect(verdict.failures.map((f) => f.code)).toEqual(["delivery_attempt_observed"]);
    expect(describeDeliveryVerdict(verdict)).toContain("firewall did not hold");
  });

  it("FAILS when no blocked event carries THIS run's id", () => {
    // A run that never reached a delivery trigger...
    expect(
      evaluateDeliveryEvidence({ events: [], runId: RUN_ID, completeLogSources: ["runtime.log"] })
        .failures.map((f) => f.code),
    ).toEqual(["no_run_scoped_delivery_blocked"]);

    // ...and another run's blocked event is not this run's evidence.
    const foreign = JSON.stringify({ event: DELIVERY_BLOCKED_EVENT, runId: "srvrun-someone-else" });
    const verdict = evaluateDeliveryEvidence({
      events: parseDeliveryEvents("runtime.log", foreign),
      runId: RUN_ID,
      completeLogSources: ["runtime.log"],
    });
    expect(verdict.failures.map((f) => f.code)).toEqual(["no_run_scoped_delivery_blocked"]);
    expect(verdict.failures[0].message).toContain("1 blocked event(s) were seen");
  });

  it("reports every failure at once", () => {
    const foreign = JSON.stringify({ event: DELIVERY_BLOCKED_EVENT, runId: "other" });
    const verdict = evaluateDeliveryEvidence({
      events: parseDeliveryEvents("x.log", `${foreign}\n${ATTEMPT_LINE}\n`),
      runId: RUN_ID,
      completeLogSources: [],
    });
    expect(verdict.failures.map((f) => f.code).sort()).toEqual(
      ["delivery_attempt_observed", "no_complete_log_source", "no_run_scoped_delivery_blocked"].sort(),
    );
  });
});
