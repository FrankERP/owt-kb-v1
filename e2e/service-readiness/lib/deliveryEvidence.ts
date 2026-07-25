// Service Readiness A3 §3 "Outbound-delivery firewall" — the harness's
// zero-delivery proof.
//
// The plan's requirement is exact and deliberately hard to satisfy:
//
//   "The deployed run emits run-id-scoped `delivery_blocked` evidence and must
//    contain zero `delivery_attempt` events in its COMPLETE recorded logs.
//    Fixture absence alone is not proof."
//
// So this module enforces BOTH halves, and fails closed on the third:
//
//   1. zero `delivery_attempt` events anywhere in the recorded logs;
//   2. at least one `delivery_blocked` event scoped to THIS run id — a run that
//      never invoked a delivery trigger proves nothing, and neither does a
//      `delivery_blocked` line belonging to some other run;
//   3. if no COMPLETE log source was supplied, the verdict is a FAILURE, not a
//      pass. "We saw no attempt in the browser console" is exactly the
//      fixture-absence non-proof the plan rejects.
//
// The complete log source is the deployment's own recorded runtime log, exported
// by the operator to `SR_VERIFY_RUNTIME_LOG_FILE`. The harness cannot fetch Vercel
// runtime logs itself without introducing a second credential, and inventing one
// would be a bigger risk than requiring the operator to export the log.
//
// This module is pure: it parses and decides. The teardown does the reading.

/** The two event names the app-side firewall emits. Structured JSON, one per line. */
export const DELIVERY_BLOCKED_EVENT = "delivery_blocked";
export const DELIVERY_ATTEMPT_EVENT = "delivery_attempt";

export interface DeliveryEventLine {
  /** Which log source the line came from. */
  source: string;
  /** 1-based line number, for an operator to find it. */
  line: number;
  event: string;
  runId: string | null;
  /** Which transport was involved (`smtp`, `resend`, `fcm`, `prune`), when named. */
  transport: string | null;
}

export type DeliveryFailureCode =
  | "no_complete_log_source"
  | "delivery_attempt_observed"
  | "no_run_scoped_delivery_blocked";

export interface DeliveryFailure {
  code: DeliveryFailureCode;
  message: string;
}

export interface DeliveryVerdict {
  ok: boolean;
  failures: DeliveryFailure[];
  blocked: DeliveryEventLine[];
  attempts: DeliveryEventLine[];
}

/**
 * Extract delivery events from raw log text.
 *
 * Both a structured JSON line and a bare textual mention are recognized. That is
 * deliberate over-detection on the ATTEMPT side: a `delivery_attempt` mentioned in
 * any shape at all must fail the run, so the parser must not be defeatable by a
 * log format change. On the BLOCKED side over-detection is harmless, because a
 * blocked line additionally has to carry this run's id to count.
 */
export function parseDeliveryEvents(source: string, text: string): DeliveryEventLine[] {
  const out: DeliveryEventLine[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    for (const event of [DELIVERY_BLOCKED_EVENT, DELIVERY_ATTEMPT_EVENT]) {
      if (!raw.includes(event)) continue;
      let runId: string | null = null;
      let transport: string | null = null;
      // Prefer the structured shape when the line contains one.
      const jsonStart = raw.indexOf("{");
      if (jsonStart >= 0) {
        try {
          const parsed = JSON.parse(raw.slice(jsonStart)) as Record<string, unknown>;
          if (typeof parsed.runId === "string") runId = parsed.runId;
          if (typeof parsed.transport === "string") transport = parsed.transport;
          // A structured line whose `event` names the other event is not this one.
          if (typeof parsed.event === "string" && parsed.event !== event) continue;
        } catch {
          // Fall through to the textual scan below.
        }
      }
      if (runId === null) {
        const m = /\brunId["'\s:=]+([A-Za-z0-9._-]+)/.exec(raw);
        if (m) runId = m[1];
      }
      out.push({ source, line: i + 1, event, runId, transport });
    }
  }
  return out;
}

/**
 * The complete verdict.
 *
 * `completeLogSources` is the list of sources that are claimed to be COMPLETE
 * recorded logs of the deployment. An empty list is a hard failure: without one,
 * "zero attempts" is unfalsifiable.
 */
export function evaluateDeliveryEvidence({
  events,
  runId,
  completeLogSources,
}: {
  events: readonly DeliveryEventLine[];
  runId: string;
  completeLogSources: readonly string[];
}): DeliveryVerdict {
  const failures: DeliveryFailure[] = [];
  const attempts = events.filter((e) => e.event === DELIVERY_ATTEMPT_EVENT);
  const blocked = events.filter((e) => e.event === DELIVERY_BLOCKED_EVENT);
  const runScopedBlocked = blocked.filter((e) => e.runId === runId);

  if (!completeLogSources.length) {
    failures.push({
      code: "no_complete_log_source",
      message:
        `No complete recorded log source was supplied (SR_VERIFY_RUNTIME_LOG_FILE). ` +
        `Zero delivery attempts cannot be PROVEN from browser output alone — fixture absence is not proof. ` +
        `Export the deployment's runtime log for this run and point the variable at it.`,
    });
  }

  if (attempts.length) {
    failures.push({
      code: "delivery_attempt_observed",
      message:
        `${attempts.length} ${DELIVERY_ATTEMPT_EVENT} event(s) present in the recorded logs: ` +
        attempts.map((a) => `${a.source}:${a.line}${a.transport ? ` (${a.transport})` : ""}`).join(", ") +
        `. The outbound-delivery firewall did not hold.`,
    });
  }

  if (!runScopedBlocked.length) {
    failures.push({
      code: "no_run_scoped_delivery_blocked",
      message:
        `No ${DELIVERY_BLOCKED_EVENT} event scoped to run id "${runId}" was recorded. ` +
        `A run that never reached a delivery trigger proves nothing, and another run's blocked event is not this run's evidence. ` +
        (blocked.length
          ? `(${blocked.length} blocked event(s) were seen, none carrying this run id.)`
          : `(no blocked events were seen at all.)`),
    });
  }

  return { ok: failures.length === 0, failures, blocked: runScopedBlocked, attempts };
}

export function describeDeliveryVerdict(verdict: DeliveryVerdict): string {
  if (verdict.ok) {
    return `zero-delivery proof: ${verdict.blocked.length} run-scoped ${DELIVERY_BLOCKED_EVENT} event(s), 0 ${DELIVERY_ATTEMPT_EVENT} events`;
  }
  const lines = ["Service Readiness A3 zero-delivery evidence FAILED:"];
  for (const f of verdict.failures) lines.push(`  ✗ [${f.code}] ${f.message}`);
  return lines.join("\n");
}
