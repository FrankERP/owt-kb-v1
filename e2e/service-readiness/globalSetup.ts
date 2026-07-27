// Service Readiness A3 §4 — one-time run setup.
//
// Order matters, and this is the order the plan requires:
//
//   1. re-assert the harness guards (the config already threw if they fail; this is
//      belt and braces, because a future edit could reorder the config)
//   2. PREFLIGHT the deployment identity on the exact recorded host. A 404, a
//      protection rejection, or a mismatched dataset/project ABORTS THE WHOLE RUN
//      before any sign-in and before anything is mutated.
//   3. acquire the EXCLUSIVE dataset lease for `runId:candidateSha:deploymentId`.
//      A live foreign lease fails immediately; it is never stolen.
//   4. collision-check the run-owned login-event predicate and require ZERO
//      matches. A pre-existing match means the run id collided or was reused:
//      abort and generate a new run id. The pre-existing document is NEVER deleted.
//   5. reset the deterministic fixtures once, under the live lease.
//
// Nothing here prints a secret. The recorded run state file contains non-secret
// provenance only.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { request } from "@playwright/test";

import { bypassHeaders, resolveBypassSecret } from "./lib/bypass";
import { acquireRunLease, resetFixtures } from "./lib/dataset";
import { fetchOwnedLoginEvents } from "./lib/loginEvents";
import { describeRefusal, evaluateHarnessConfig } from "./lib/harnessGuards";
import { IDENTITY_PATH, describePreflightAbort, evaluateIdentity } from "./lib/preflight";
import { resetAttemptLedger, type RunIdentity } from "./lib/runIdentity";
import {
  LEASE_RENEWAL_KEY,
  RUN_STATE_FILE,
  type RunState,
} from "./lib/runState";

export default async function globalSetup(): Promise<void> {
  /* --- 1. Guards ---------------------------------------------------- */
  const verdict = evaluateHarnessConfig({ env: process.env, protectionExpected: true });
  if (!verdict.ok || !verdict.config) throw new Error(describeRefusal(verdict));
  const config = verdict.config;

  const identity: RunIdentity = {
    runId: config.runId,
    candidateSha: config.candidateSha,
    deploymentId: config.deploymentId,
  };

  // The run-scoped attempt ledger starts empty. Its entries are run-id-tagged too,
  // so this is defence in depth rather than the only guard.
  resetAttemptLedger();

  console.log("\nService Readiness A3 deployed-route verification");
  console.log(`  host:       ${config.host}`);
  console.log(`  project:    ${config.projectId}`);
  console.log(`  dataset:    ${config.dataset}`);
  console.log(`  run:        ${config.runId}`);
  console.log(`  candidate:  ${config.candidateSha}`);
  console.log(`  deployment: ${config.deploymentId}`);
  console.log(`  bypass:     ${config.hasBypassSecret ? "runner-supplied (value never printed)" : "none"}`);

  /* --- 2. Deployment identity preflight ----------------------------- */
  const { secret: bypassSecret } = resolveBypassSecret(process.env);
  // The API request context does NOT inherit the browser context's bypass cookie,
  // so it is given the bypass HEADER explicitly.
  const api = await request.newContext({
    baseURL: config.baseURL,
    extraHTTPHeaders: bypassHeaders(bypassSecret),
  });

  let preflight;
  try {
    const res = await api.get(IDENTITY_PATH, { failOnStatusCode: false });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    preflight = evaluateIdentity({
      status: res.status(),
      body,
      expected: { deploymentId: config.deploymentId, candidateSha: config.candidateSha },
    });
  } finally {
    await api.dispose();
  }

  if (!preflight.ok || !preflight.evidence) {
    throw new Error(describePreflightAbort(preflight));
  }
  console.log(`  identity:   verified via ${IDENTITY_PATH} (ok, exact dataset and project)`);

  /* --- 3. Exclusive dataset lease ----------------------------------- */
  const lease = await acquireRunLease(identity);

  // Keep the lease alive for the whole run. `unref()` so the timer can never keep
  // the runner process alive on its own.
  const renewal = setInterval(() => {
    lease.renew().catch((err: unknown) => {
      console.warn(`  lease:     renewal failed (${(err as Error).message}); it will expire.`);
    });
  }, 4 * 60 * 1000);
  renewal.unref();
  (globalThis as Record<string, unknown>)[LEASE_RENEWAL_KEY] = renewal;

  /* --- 4. Login-event collision check ------------------------------- */
  const preexisting = await fetchOwnedLoginEvents(identity);
  if (preexisting.length) {
    clearInterval(renewal);
    await lease.release();
    throw new Error(
      `\nRUN ID COLLISION: ${preexisting.length} login event(s) already match this run's exact ownership predicate ` +
        `(runId=${config.runId}, deploymentId=${config.deploymentId}).\n` +
        `  ${preexisting.map((d) => d._id).join("\n  ")}\n\n` +
        `Those documents belong to whoever wrote them and were NOT deleted. Generate a NEW SR_VERIFY_RUN_ID and re-run.\n`,
    );
  }
  console.log("  logins:     zero pre-existing run-owned login events (no collision)");

  /* --- 5. Deterministic fixtures ------------------------------------ */
  const reset = await resetFixtures(identity);
  console.log(
    `  fixtures:   ${reset.fixtures.length} deterministic document(s) reset under the live lease` +
      (reset.runCreated.length ? `, plus ${reset.runCreated.length} run-created id(s) removed` : ""),
  );
  if (reset.refused.length) {
    throw new Error(
      `Fixture reset generated ${reset.refused.length} id(s) that failed the deletion allowlist: ${reset.refused.join(", ")}`,
    );
  }

  /* --- Record non-secret run state ---------------------------------- */
  const state: RunState = {
    startedAt: new Date().toISOString(),
    baseURL: config.baseURL,
    host: config.host,
    projectId: config.projectId,
    dataset: config.dataset,
    runId: config.runId,
    candidateSha: config.candidateSha,
    deploymentId: config.deploymentId,
    leaseOwner: lease.owner,
    bypassConfigured: config.hasBypassSecret,
    identity: preflight.evidence,
    runtimeLogFile: config.runtimeLogFile,
  };
  const statePath = resolve(process.cwd(), RUN_STATE_FILE);
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  console.log("");
}
