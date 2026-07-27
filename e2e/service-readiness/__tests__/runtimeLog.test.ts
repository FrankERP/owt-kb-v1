// Service Readiness A3 §3 — the runtime-log capture decision, proven offline.
//
// The zero-delivery proof needs the deployment's COMPLETE recorded log, and nothing
// was producing it. This module decides whether the harness starts that capture
// itself and with exactly what command. What matters here:
//
//   · it is OPT-IN — an unset `SR_VERIFY_RUNTIME_LOG_CAPTURE` starts nothing, so a
//     run that already supplies its own log is untouched;
//   · it is never pointed at production or at the stable dev alias, because the
//     target goes through the harness's OWN base-URL refusals rather than a second
//     opinion that could disagree with them;
//   · no secret ever reaches the command line;
//   · every "no" carries a reason, and a "no" is never silent — the teardown still
//     requires a complete log source, so a refused capture surfaces as the proof
//     failing rather than as the proof being skipped.

import { describe, expect, it } from "vitest";

import { BASE_URL_ENV, RUNTIME_LOG_ENV } from "../lib/harnessGuards";
import {
  CAPTURE_ENV,
  CAPTURE_VERCEL,
  describeManualCapture,
  planRuntimeLogCapture,
} from "../lib/runtimeLog";

const DEPLOYMENT = "https://owt-backstage-abc123-frank.vercel.app";

function env(over: Record<string, string | undefined> = {}) {
  return {
    [BASE_URL_ENV]: DEPLOYMENT,
    [RUNTIME_LOG_ENV]: "test-results/deployment-runtime.log",
    [CAPTURE_ENV]: CAPTURE_VERCEL,
    ...over,
  };
}

describe("planRuntimeLogCapture", () => {
  it("plans a capture of the exact recorded deployment when opted in", () => {
    const plan = planRuntimeLogCapture({ env: env() });
    expect(plan.enabled).toBe(true);
    expect(plan.refusals).toEqual([]);
    expect(plan.file).toBe("test-results/deployment-runtime.log");
    expect(plan.command).toBe("npx");
    expect(plan.args).toEqual(["--yes", "vercel", "logs", DEPLOYMENT, "--json"]);
  });

  it("is OPT-IN: an unset capture mode starts nothing and says why", () => {
    const plan = planRuntimeLogCapture({ env: env({ [CAPTURE_ENV]: undefined }) });
    expect(plan.enabled).toBe(false);
    expect(plan.refusals.map((r) => r.code)).toEqual(["capture_not_requested"]);
    // The nominated file is still reported, so the operator sees what teardown reads.
    expect(plan.file).toBe("test-results/deployment-runtime.log");
  });

  it("refuses an unrecognized capture mode rather than guessing one", () => {
    for (const mode of ["Vercel", "VERCEL", "vercel-logs", "true", "1"]) {
      const plan = planRuntimeLogCapture({ env: env({ [CAPTURE_ENV]: mode }) });
      expect(plan.enabled).toBe(false);
      expect(plan.refusals.map((r) => r.code)).toContain("unknown_capture_mode");
    }
  });

  it("refuses when there is nowhere to put the log", () => {
    const plan = planRuntimeLogCapture({ env: env({ [RUNTIME_LOG_ENV]: undefined }) });
    expect(plan.enabled).toBe(false);
    expect(plan.refusals.map((r) => r.code)).toContain("missing_log_file");
    expect(plan.file).toBeNull();
  });

  it("never captures from PRODUCTION or the stable dev alias", () => {
    for (const host of [
      "https://owt-backstage.vercel.app",
      "https://dev-owt-backstage.vercel.app",
      "https://x.owt-backstage.vercel.app",
    ]) {
      const plan = planRuntimeLogCapture({ env: env({ [BASE_URL_ENV]: host }) });
      expect(plan.enabled, host).toBe(false);
      expect(plan.refusals.map((r) => r.code)).toContain("unusable_base_url");
      expect(plan.command).toBeNull();
    }
  });

  it("refuses a base URL the harness itself would refuse", () => {
    for (const url of [
      undefined,
      "not a url",
      "http://insecure.example.com",
      "https://user:pass@host.example.com",
      "https://host.example.com/?x=secret",
    ]) {
      const plan = planRuntimeLogCapture({ env: env({ [BASE_URL_ENV]: url }) });
      expect(plan.enabled, String(url)).toBe(false);
      expect(plan.refusals.map((r) => r.code)).toContain("unusable_base_url");
    }
  });

  it("puts no secret on the command line", () => {
    const plan = planRuntimeLogCapture({
      env: env({
        SR_VERIFY_BYPASS_SECRET: "bypass-s3cret",
        SR_VERIFY_SANITY_TOKEN: "sk-token",
        VERCEL_TOKEN: "vt-secret",
      }),
    });
    const line = [plan.command, ...plan.args].join(" ");
    for (const forbidden of ["bypass-s3cret", "sk-token", "vt-secret"]) {
      expect(line).not.toContain(forbidden);
    }
    // Nor a query string, which is where a secret would ride if it ever did.
    expect(line).not.toContain("?");
  });

  it("collects every reason at once rather than one per run", () => {
    const plan = planRuntimeLogCapture({
      env: { [BASE_URL_ENV]: "https://owt-backstage.vercel.app" },
    });
    expect(plan.refusals.map((r) => r.code).sort()).toEqual([
      "capture_not_requested",
      "missing_log_file",
      "unusable_base_url",
    ]);
  });
});

describe("describeManualCapture", () => {
  it("names both variables and both paths an operator can take", () => {
    const text = describeManualCapture(DEPLOYMENT, null);
    expect(text).toContain(RUNTIME_LOG_ENV);
    expect(text).toContain(CAPTURE_ENV);
    expect(text).toContain(DEPLOYMENT);
    expect(text).toContain("vercel logs");
    // It must say WHY, or the next operator relaxes the check instead of fixing it.
    expect(text).toContain("not proof");
  });

  it("uses the nominated file when there is one", () => {
    expect(describeManualCapture(DEPLOYMENT, "logs/run.log")).toContain("logs/run.log");
  });
});
