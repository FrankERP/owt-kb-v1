// Bounded wait for THIS run's delivery evidence to reach the captured log.
//
// `vercel logs` opens by replaying recent history and then follows, so at the
// moment teardown runs the stream can still be behind the last scenario — and it
// may legitimately contain an EARLIER run's `delivery_blocked` lines. That is a
// race, not an absence, and the two must not be confused:
//
//   race    → this run's lines exist but have not been flushed to the file yet.
//   absence → this run never reached a delivery trigger at all.
//
// Waiting converts the first into a pass and leaves the second failing. It can
// never turn an absence into a pass, because the predicate is "a `delivery_blocked`
// line carrying THIS run id", never "some blocked line exists" — another run's
// evidence is still rejected after the wait, exactly as before.
//
// The wait is bounded. On timeout we return what we have and let the existing
// evaluator produce its normal failure, so a genuine absence still fails closed
// with the same message rather than hanging the suite.

import { DELIVERY_BLOCKED_EVENT, type DeliveryEventLine } from "./deliveryEvidence";

/** How long to keep re-reading before giving up and evaluating what we have. */
export const DEFAULT_EVIDENCE_TIMEOUT_MS = 90_000;

/** Gap between re-reads. The log is a local file; polling it is cheap. */
export const DEFAULT_EVIDENCE_POLL_MS = 2_000;

/**
 * True when the parsed events already contain a `delivery_blocked` line scoped to
 * this run. This is the ONLY condition that ends the wait early — matching the
 * evaluator's own requirement, so waiting can never accept something the verdict
 * would reject.
 */
export function hasRunScopedBlocked(events: readonly DeliveryEventLine[], runId: string): boolean {
  if (!runId) return false;
  return events.some((e) => e.event === DELIVERY_BLOCKED_EVENT && e.runId === runId);
}

export interface AwaitRunEvidenceResult {
  events: DeliveryEventLine[];
  /** True when this run's blocked evidence arrived before the deadline. */
  satisfied: boolean;
  /** How many times the source was read (>= 1). */
  reads: number;
  waitedMs: number;
}

/**
 * Re-read the evidence sources until this run's blocked evidence appears or the
 * deadline passes.
 *
 * `readEvents` is injected so this is testable without a filesystem or a clock,
 * and so the caller keeps ownership of *which* sources are read.
 */
export async function awaitRunScopedEvidence({
  runId,
  readEvents,
  timeoutMs = DEFAULT_EVIDENCE_TIMEOUT_MS,
  pollMs = DEFAULT_EVIDENCE_POLL_MS,
  now = () => Date.now(),
  sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
}: {
  runId: string;
  readEvents: () => DeliveryEventLine[] | Promise<DeliveryEventLine[]>;
  timeoutMs?: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<AwaitRunEvidenceResult> {
  const started = now();
  const deadline = started + Math.max(0, timeoutMs);

  let events = await readEvents();
  let reads = 1;

  // Always read at least once, so a zero/negative timeout degrades to today's
  // single-read behaviour rather than skipping the read entirely.
  while (!hasRunScopedBlocked(events, runId) && now() < deadline) {
    await sleep(Math.max(1, pollMs));
    events = await readEvents();
    reads += 1;
  }

  return {
    events,
    satisfied: hasRunScopedBlocked(events, runId),
    reads,
    waitedMs: now() - started,
  };
}

/** Operator-facing note explaining what the wait did, for the teardown log. */
export function describeEvidenceWait(result: AwaitRunEvidenceResult): string {
  const secs = (result.waitedMs / 1000).toFixed(1);
  if (result.satisfied) {
    return result.reads === 1
      ? "run-scoped delivery evidence was already present"
      : `run-scoped delivery evidence arrived after ${secs}s (${result.reads} reads)`;
  }
  return `no run-scoped delivery evidence after ${secs}s (${result.reads} reads) — evaluating what was captured`;
}
