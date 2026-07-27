// Service Readiness A3 §4 — the outermost `finally`.
//
// This runs whether the suite passed, failed, or blew up, and it does five things
// in this order, because the order is the safety property:
//
//   1. WHILE THE LEASE IS STILL LIVE, repeat the exact run/deployment ownership
//      predicate to capture any LATE login event, validate every returned
//      document's full ownership tuple, and delete only that explicit `_id` set
//      (each under its own revision precondition). Then re-query the same predicate
//      and require ZERO remaining. Never `*[_type == "loginEvent"]`, never an
//      email/member/time range, never an id the predicate did not return.
//   2. reset the deterministic fixtures, still under the same lease.
//   3. release the lease (owner-only, under `_rev`).
//   4. prove REDACTION: no retained report, trace, video or log contains the bypass
//      secret or a bypass query parameter.
//   5. prove ZERO DELIVERY: run-id-scoped `delivery_blocked` evidence exists and the
//      complete recorded logs contain zero `delivery_attempt` events.
//
// Steps 1-3 are attempted even if an earlier one throws, so a failure to clean login
// events never leaves the lease held forever. Every failure is collected and
// re-thrown at the end, so the run cannot pass with unclean state.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";

import { resolveBypassSecret, scanForSecretLeak, summarizeLeaks, type SecretLeak } from "./lib/bypass";
import { acquireRunLease, resetFixtures } from "./lib/dataset";
import { cleanupOwnedLoginEvents } from "./lib/loginEvents";
import {
  describeDeliveryVerdict,
  evaluateDeliveryEvidence,
  parseDeliveryEvents,
  type DeliveryEventLine,
} from "./lib/deliveryEvidence";
import { describeManualCapture } from "./lib/runtimeLog";
import { awaitRunScopedEvidence, describeEvidenceWait } from "./lib/awaitRunEvidence";
import {
  RUN_EVIDENCE_FILE,
  RUN_STATE_FILE,
  LEASE_RENEWAL_KEY,
  RUNTIME_LOG_CAPTURE_KEY,
  type RunState,
} from "./lib/runState";
import type { RunIdentity } from "./lib/runIdentity";

/** Directories whose retained contents are scanned for a leaked secret. */
const RETAINED_OUTPUT_DIRS = ["test-results", "playwright-report"];

/** Extensions worth scanning as text. Binaries (png/webm/zip) are skipped. */
const TEXTUAL_EXTENSIONS = new Set([
  "",
  ".json",
  ".txt",
  ".log",
  ".html",
  ".md",
  ".xml",
  ".csv",
  ".har",
  ".jsonl",
  ".ndjson",
]);

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function readRunState(): RunState | null {
  const path = resolve(process.cwd(), RUN_STATE_FILE);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as RunState;
  } catch {
    return null;
  }
}

export default async function globalTeardown(): Promise<void> {
  const failures: string[] = [];

  const renewal = (globalThis as Record<string, unknown>)[LEASE_RENEWAL_KEY];
  if (renewal) clearInterval(renewal as NodeJS.Timeout);

  // Close the runtime-log capture window: the last scenario has finished, so every
  // line this run could produce has been produced. Stopped BEFORE the log is read
  // so a half-written final line cannot be parsed. Killing it can never fail the
  // run — the evidence check below is what decides.
  const capture = (globalThis as Record<string, unknown>)[RUNTIME_LOG_CAPTURE_KEY] as
    | { kill?: (signal?: NodeJS.Signals) => boolean; killed?: boolean }
    | undefined;
  if (capture?.kill) {
    try {
      capture.kill("SIGTERM");
      // Let the child flush whatever it had buffered into the file.
      await new Promise((r) => setTimeout(r, 750));
    } catch {
      /* a dead capture is reported by the evidence verdict, not by a throw here */
    }
  }

  const state = readRunState();
  if (!state) {
    // Global setup never completed, so there is no lease of ours and nothing of ours
    // to clean. Say so rather than guessing an identity from the environment.
    console.warn("\n  teardown:  no recorded run state — global setup did not complete. Nothing to clean.\n");
    return;
  }

  const identity: RunIdentity = {
    runId: state.runId,
    candidateSha: state.candidateSha,
    deploymentId: state.deploymentId,
  };

  console.log("\nService Readiness A3 — teardown");

  /* --- 1-3. Dataset cleanup, under the live lease -------------------- */
  //
  // The lease document is re-acquired rather than shared: `globalTeardown` may run
  // in a fresh module scope, and `acquireRunLease` for the SAME owner resolves to a
  // renew/replace of our own lease (never a steal), so this is the same lease.
  let lease: Awaited<ReturnType<typeof acquireRunLease>> | null = null;
  try {
    lease = await acquireRunLease(identity);
  } catch (err) {
    failures.push(`lease re-acquisition failed: ${(err as Error).message}`);
  }

  if (lease) {
    try {
      const cleanup = await cleanupOwnedLoginEvents(identity);
      console.log(`  logins:    deleted ${cleanup.deletedIds.length} run-owned login event(s) by exact _id`);
      for (const id of cleanup.deletedIds) console.log(`               · ${id}`);
      for (const r of cleanup.refused) {
        failures.push(`login event ${r.id ?? "(no id)"} failed full-tuple validation and was NOT deleted [${r.reason}]`);
      }
      if (cleanup.remaining.length) {
        failures.push(
          `${cleanup.remaining.length} run-owned login event(s) remain after cleanup: ` +
            cleanup.remaining.map((d) => d._id).join(", "),
        );
      } else {
        console.log("  verified:  zero run-owned login events remain");
      }
    } catch (err) {
      failures.push(`run-owned login-event cleanup failed: ${(err as Error).message}`);
    }

    try {
      const reset = await resetFixtures(identity);
      console.log(
        `  fixtures:  reset ${reset.fixtures.length} deterministic document(s); ` +
          `removed ${reset.runCreated.length} run-created id(s) by exact id`,
      );
      for (const id of reset.runCreated) console.log(`               · ${id}`);
    } catch (err) {
      failures.push(`fixture reset failed: ${(err as Error).message}`);
    }

    try {
      await lease.release();
    } catch (err) {
      failures.push(`lease release failed: ${(err as Error).message}`);
    }
  }

  /* --- 4. Redaction assertion --------------------------------------- */
  const { secret: bypassSecret } = resolveBypassSecret(process.env);
  const leaks: SecretLeak[] = [];
  let scanned = 0;
  for (const dir of RETAINED_OUTPUT_DIRS) {
    for (const file of walk(resolve(process.cwd(), dir))) {
      if (!TEXTUAL_EXTENSIONS.has(extname(file).toLowerCase())) continue;
      let text: string;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      scanned++;
      leaks.push(...scanForSecretLeak(file, text, bypassSecret));
    }
  }
  const redaction = summarizeLeaks(leaks);
  console.log(`  redaction: scanned ${scanned} retained file(s) — ${redaction.ok ? "clean" : "FAILED"}`);
  if (!redaction.ok) failures.push(redaction.message);

  /* --- 5. Zero-delivery evidence ------------------------------------ */
  const completeLogSources: string[] = [];
  let missingRuntimeLog: string | null = null;

  // Re-read every source on each poll. `vercel logs` opens by replaying recent
  // history and then follows, so at this moment the stream can still be behind the
  // last scenario — and can legitimately hold an EARLIER run's blocked lines. That
  // is a race, not an absence, so we wait for THIS run's evidence rather than
  // judging a half-flushed file. The predicate is unchanged ("a blocked line
  // carrying this run id"), so another run's evidence is still rejected and a real
  // absence still fails after the deadline.
  const readAllSources = (): DeliveryEventLine[] => {
    const collected: DeliveryEventLine[] = [];
    completeLogSources.length = 0;
    missingRuntimeLog = null;

    // The harness's own structured evidence (browser console + response
    // observations). Useful, but explicitly NOT a complete log source.
    const evidencePath = resolve(process.cwd(), RUN_EVIDENCE_FILE);
    if (existsSync(evidencePath)) {
      collected.push(...parseDeliveryEvents(RUN_EVIDENCE_FILE, readFileSync(evidencePath, "utf8")));
    }

    // The deployment's COMPLETE recorded log. This is the only source that can
    // prove an absence.
    if (state.runtimeLogFile) {
      const logPath = resolve(process.cwd(), state.runtimeLogFile);
      if (existsSync(logPath)) {
        collected.push(...parseDeliveryEvents(state.runtimeLogFile, readFileSync(logPath, "utf8")));
        completeLogSources.push(state.runtimeLogFile);
      } else {
        missingRuntimeLog = state.runtimeLogFile;
      }
    }
    return collected;
  };

  const waited = await awaitRunScopedEvidence({ runId: state.runId, readEvents: readAllSources });
  const events = waited.events;
  console.log(`  evidence:  ${describeEvidenceWait(waited)}`);

  if (missingRuntimeLog) {
    failures.push(
      `SR_VERIFY_RUNTIME_LOG_FILE points at "${missingRuntimeLog}", which does not exist. ` +
        `The zero-delivery proof needs the deployment's complete recorded log.`,
    );
  }

  const delivery = evaluateDeliveryEvidence({
    events,
    runId: state.runId,
    completeLogSources,
  });
  console.log(`  delivery:  ${describeDeliveryVerdict(delivery)}`);
  if (!delivery.ok) {
    // Say what to DO about it, not just that it failed — the log source is an
    // operator action, and the run cannot be made clean without one.
    const noSource = delivery.failures.some((f) => f.code === "no_complete_log_source");
    failures.push(
      describeDeliveryVerdict(delivery) +
        (noSource ? `\n${describeManualCapture(state.baseURL, state.runtimeLogFile)}` : ""),
    );
  }

  console.log("");

  if (failures.length) {
    throw new Error(
      `\nService Readiness A3 teardown FAILED — the run must not be reported as clean:\n\n  ` +
        failures.join("\n\n  ") +
        `\n`,
    );
  }
}
