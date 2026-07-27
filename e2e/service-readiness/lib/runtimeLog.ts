// Service Readiness A3 §3 — obtaining the deployment's COMPLETE recorded log.
//
// THE PROBLEM
// -----------
// `deliveryEvidence.ts` refuses to call a run clean unless it can read a complete
// recorded log of the deployment, because "we saw no delivery attempt" is only a
// proof if something was actually watching. `SR_VERIFY_RUNTIME_LOG_FILE` is where
// that log goes — but nothing was producing it, so the teardown failed with
// `no_complete_log_source` on every run.
//
// WHY THE CAPTURE MUST START BEFORE THE SUITE
// -------------------------------------------
// `vercel logs <url>` STREAMS a deployment's runtime output from the moment it is
// invoked; it does not back-fill an arbitrary window. Exporting "after the run" —
// which is also after `globalTeardown`, the thing that reads the file — would
// therefore be both too late in the ordering AND missing the earliest lines. So the
// capture is started by `globalSetup`, before the first scenario, and stopped by
// `globalTeardown` after the last one. That window is exactly the run.
//
// ITS LIMITATION, STATED PLAINLY
// ------------------------------
// The Vercel CLI's log stream is time-bounded (it disconnects on its own after a
// few minutes), so a long run CAN lose the tail of its coverage. That cannot
// produce a FALSE PASS, and this is the reason the two halves of the verdict are
// kept together: a capture that stopped early loses the run-scoped
// `delivery_blocked` lines too, and the run then fails with
// `no_run_scoped_delivery_blocked` rather than passing on a truncated file. A gap
// in the evidence reads as a failure, never as an absence of attempts. If a run
// starts failing that way, restart it with a longer-lived capture (a log drain, or
// re-invoking the CLI) — do not relax the check.
//
// OPT-IN, AND REFUSES THE WRONG TARGET
// ------------------------------------
// Capture only runs when `SR_VERIFY_RUNTIME_LOG_CAPTURE=vercel` is set explicitly.
// The target host goes through the harness's OWN base-URL refusals
// (`evaluateBaseUrl`), so a capture can never be pointed at production or at the
// stable dev alias. No secret is ever passed on the command line: the CLI is
// expected to be authenticated out of band (`vercel login`, or `VERCEL_TOKEN` in
// the runner's environment, which the child inherits and this module never reads).
//
// This module is PURE. It decides; `globalSetup` spawns.

import { RUNTIME_LOG_ENV, evaluateBaseUrl, BASE_URL_ENV } from "./harnessGuards";

/** Explicit opt-in. Any other value means "I will supply the log myself". */
export const CAPTURE_ENV = "SR_VERIFY_RUNTIME_LOG_CAPTURE";
export const CAPTURE_VERCEL = "vercel";

export type CaptureRefusalCode =
  | "capture_not_requested"
  | "unknown_capture_mode"
  | "missing_log_file"
  | "unusable_base_url";

export interface CaptureRefusal {
  code: CaptureRefusalCode;
  message: string;
}

export interface RuntimeLogCapturePlan {
  /** Whether a capture child process should be started. */
  enabled: boolean;
  /** Where the captured output goes. Null when no file was nominated. */
  file: string | null;
  /** Exact command to run. Never contains a secret. */
  command: string | null;
  args: readonly string[];
  refusals: CaptureRefusal[];
}

function trimmed(value: string | undefined): string | null {
  return typeof value === "string" && value.trim().length ? value.trim() : null;
}

/**
 * Decide whether — and exactly how — to capture the deployment's runtime log.
 *
 * Returns `enabled: false` with a REASON for every "no". A refusal here is never
 * fatal on its own: the run continues and `globalTeardown` still requires a
 * complete log source, so a missing capture surfaces as the proof failing rather
 * than as the proof being skipped.
 */
export function planRuntimeLogCapture({
  env,
}: {
  env: Readonly<Record<string, string | undefined>>;
}): RuntimeLogCapturePlan {
  const refusals: CaptureRefusal[] = [];
  const file = trimmed(env[RUNTIME_LOG_ENV]);
  const mode = trimmed(env[CAPTURE_ENV]);

  if (!mode) {
    refusals.push({
      code: "capture_not_requested",
      message:
        `${CAPTURE_ENV} is not set, so the harness will not start a log capture. ` +
        `Supply the deployment's complete recorded log at ${RUNTIME_LOG_ENV} yourself, ` +
        `or set ${CAPTURE_ENV}=${CAPTURE_VERCEL} and let the harness capture it for the run.`,
    });
  } else if (mode !== CAPTURE_VERCEL) {
    refusals.push({
      code: "unknown_capture_mode",
      message: `${CAPTURE_ENV} must be "${CAPTURE_VERCEL}". Refusing an unrecognized capture mode.`,
    });
  }

  if (!file) {
    refusals.push({
      code: "missing_log_file",
      message:
        `${RUNTIME_LOG_ENV} is not set, so there is nowhere to put a captured log and nothing ` +
        `for the zero-delivery proof to read. Fixture absence is not proof: the run will fail at teardown.`,
    });
  }

  const base = evaluateBaseUrl(env[BASE_URL_ENV]);
  if (!base.origin) {
    refusals.push({
      code: "unusable_base_url",
      message:
        `${BASE_URL_ENV} did not resolve to a usable origin (${base.failures.map((f) => f.code).join(", ") || "no origin"}). ` +
        `A log capture is never pointed at a host the harness itself refuses.`,
    });
  }

  if (refusals.length || !file || !base.origin) {
    return { enabled: false, file, command: null, args: [], refusals };
  }

  return {
    enabled: true,
    file,
    command: "npx",
    // `--yes` so an uninstalled CLI cannot block on an interactive prompt. The
    // deployment is named by its URL; no token, and no query string, ever.
    args: ["--yes", "vercel", "logs", base.origin, "--json"],
    refusals: [],
  };
}

/** The instruction an operator needs when no capture is configured. Names only. */
export function describeManualCapture(baseURL: string, file: string | null): string {
  const target = file ?? "test-results/deployment-runtime.log";
  return [
    "",
    "  ⚠ zero-delivery proof: no complete recorded log source is configured.",
    "",
    "    A3 §3 requires the deployment's COMPLETE recorded log for this run — absence of a",
    "    delivery attempt in browser output is not proof of absence. This run will FAIL at",
    "    teardown with `no_complete_log_source` unless one is supplied.",
    "",
    "    Let the harness capture it (starts before the first scenario, stops after the last):",
    "",
    `      export ${RUNTIME_LOG_ENV}=${target}`,
    `      export ${CAPTURE_ENV}=${CAPTURE_VERCEL}`,
    "",
    "    Or capture it yourself, alongside the run, and point the variable at the file:",
    "",
    `      npx vercel logs ${baseURL} --json > ${target} &`,
    `      ${RUNTIME_LOG_ENV}=${target} npx playwright test`,
    "",
  ].join("\n");
}
