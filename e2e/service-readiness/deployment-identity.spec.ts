// A3 §4 — the deployment is the isolated verification deployment, and the bypass
// never travelled in a URL.
//
// `globalSetup` already aborts the run if the identity route does not prove this;
// these tests re-prove it from inside the suite so the evidence is attached to the
// run report, and so a mid-run deployment replacement is caught.

import { evaluateIdentity, IDENTITY_PATH } from "./lib/preflight";
import { BYPASS_HEADER, FORBIDDEN_BYPASS_QUERY_PARAMS, scanForSecretLeak, resolveBypassSecret } from "./lib/bypass";
import { VERIFICATION_DATASET, VERIFICATION_PROJECT_ID } from "./lib/harnessGuards";
import { expect, test } from "./fixtures";

test.describe("deployment identity", () => {
  test("the identity route proves the isolated dataset and project", async ({ anon, run }) => {
    const res = await anon.get(IDENTITY_PATH, { failOnStatusCode: false });
    const body: unknown = res.status() === 200 ? await res.json() : null;

    const verdict = evaluateIdentity({
      status: res.status(),
      body,
      expected: {
        deploymentId: run.identity.deploymentId,
        candidateSha: run.identity.candidateSha,
      },
    });
    expect(
      verdict.failures.map((f) => `${f.code}: ${f.message}`),
      "the deployment must prove it targets the isolated verification dataset",
    ).toEqual([]);
    expect(verdict.evidence?.dataset).toBe(VERIFICATION_DATASET);
    expect(verdict.evidence?.projectId).toBe(VERIFICATION_PROJECT_ID);

    run.evidence("deployment_identity_verified", {
      gitRef: verdict.evidence?.gitRef ?? null,
      commitSha: verdict.evidence?.commitSha ?? null,
      deploymentUrl: verdict.evidence?.deploymentUrl ?? null,
    });
  });

  test("no request URL carries a bypass query parameter", async ({ admin, run }) => {
    const seen: string[] = [];
    admin.page.on("request", (req) => seen.push(req.url()));

    await admin.page.goto("/admin", { waitUntil: "domcontentloaded" });
    await admin.page.waitForLoadState("networkidle").catch(() => undefined);

    const { secret } = resolveBypassSecret(process.env);
    const leaks = seen.flatMap((url, i) => scanForSecretLeak(`request[${i}]`, url, secret));
    expect(
      leaks.map((l) => `${l.kind} in ${l.source}`),
      `the bypass must only ever be the "${BYPASS_HEADER}" header, never one of ` +
        `${FORBIDDEN_BYPASS_QUERY_PARAMS.join("/")} in a URL`,
    ).toEqual([]);

    run.evidence("bypass_url_scan", { requests: seen.length, leaks: leaks.length });
  });
});
