// Offline proof of the A3 §4 preflight aborts.
//
// The preflight is the single check that stands between the mutating suite and the
// wrong Content Lake, so every abort case is pinned here: a 404 (the route fails
// closed, so this is not the isolated deployment), a protection rejection, and any
// mismatched dataset / project / marker / delivery-mode / deployment identity.

import { describe, expect, it } from "vitest";

import { VERIFICATION_DATASET, VERIFICATION_MARKER_VALUE, VERIFICATION_PROJECT_ID } from "../lib/harnessGuards";
import { describePreflightAbort, evaluateIdentity, IDENTITY_PATH } from "../lib/preflight";

function okBody(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    marker: VERIFICATION_MARKER_VALUE,
    projectId: VERIFICATION_PROJECT_ID,
    dataset: VERIFICATION_DATASET,
    deliveryMode: "disabled",
    e2eWritesEnabled: true,
    git: { ref: "verify/service-readiness", commitSha: "abc123" },
    deployment: { id: "dpl_abc", url: "owt-backstage-git-verify.vercel.app" },
    ...overrides,
  };
}

function codes(input: Parameters<typeof evaluateIdentity>[0]): string[] {
  return evaluateIdentity(input).failures.map((f) => f.code);
}

describe("deployment identity preflight", () => {
  it("passes on the exact isolated identity and records non-secret evidence", () => {
    const verdict = evaluateIdentity({ status: 200, body: okBody() });
    expect(verdict.failures).toEqual([]);
    expect(verdict.ok).toBe(true);
    expect(verdict.evidence).toEqual({
      dataset: VERIFICATION_DATASET,
      projectId: VERIFICATION_PROJECT_ID,
      gitRef: "verify/service-readiness",
      commitSha: "abc123",
      deploymentId: "dpl_abc",
      deploymentUrl: "owt-backstage-git-verify.vercel.app",
    });
  });

  it("ABORTS on a 404 — the route fails closed everywhere but the isolated deployment", () => {
    const verdict = evaluateIdentity({ status: 404, body: null });
    expect(verdict.failures.map((f) => f.code)).toEqual(["not_found"]);
    expect(verdict.evidence).toBeNull();
    expect(describePreflightAbort(verdict)).toContain("PREFLIGHT ABORT");
    expect(describePreflightAbort(verdict)).toContain(IDENTITY_PATH);
    expect(describePreflightAbort(verdict)).toContain("No sign-in was attempted");
  });

  it("ABORTS on a Deployment Protection rejection", () => {
    for (const status of [401, 403]) {
      expect(codes({ status, body: null })).toEqual(["protection_rejected"]);
    }
  });

  it("ABORTS on any other status, and on an unparseable body", () => {
    expect(codes({ status: 500, body: null })).toEqual(["unexpected_status"]);
    expect(codes({ status: 302, body: null })).toEqual(["unexpected_status"]);
    expect(codes({ status: 200, body: null })).toEqual(["unparseable_body"]);
    expect(codes({ status: 200, body: "<html>" })).toEqual(["unparseable_body"]);
  });

  it("ABORTS on a mismatched dataset — this is the production guard", () => {
    expect(codes({ status: 200, body: okBody({ dataset: "production" }) })).toContain(
      "dataset_mismatch",
    );
    expect(codes({ status: 200, body: okBody({ dataset: undefined }) })).toContain(
      "dataset_mismatch",
    );
  });

  it("ABORTS on a mismatched project", () => {
    expect(codes({ status: 200, body: okBody({ projectId: "ebb8vcnk" }) })).toContain(
      "project_mismatch",
    );
  });

  it("ABORTS on a missing ok flag, marker, delivery mode or E2E flag", () => {
    expect(codes({ status: 200, body: okBody({ ok: false }) })).toContain("not_ok");
    expect(codes({ status: 200, body: okBody({ marker: "other" }) })).toContain("marker_mismatch");
    expect(codes({ status: 200, body: okBody({ deliveryMode: "enabled" }) })).toContain(
      "delivery_mode_not_disabled",
    );
    expect(codes({ status: 200, body: okBody({ e2eWritesEnabled: false }) })).toContain(
      "e2e_writes_not_enabled",
    );
  });

  it("ABORTS when the deployment is isolated but is not the RECORDED one", () => {
    expect(
      codes({
        status: 200,
        body: okBody(),
        expected: { deploymentId: "dpl_a_different_deployment", candidateSha: "abc123" },
      }),
    ).toEqual(["deployment_id_mismatch"]);
    expect(
      codes({
        status: 200,
        body: okBody(),
        expected: { deploymentId: "dpl_abc", candidateSha: "a_different_sha" },
      }),
    ).toEqual(["candidate_sha_mismatch"]);
    // Agreement passes.
    expect(
      codes({ status: 200, body: okBody(), expected: { deploymentId: "dpl_abc", candidateSha: "abc123" } }),
    ).toEqual([]);
  });

  it("collects every mismatch at once", () => {
    expect(
      codes({
        status: 200,
        body: okBody({ dataset: "production", projectId: "ebb8vcnk", deliveryMode: "enabled" }),
      }),
    ).toEqual(
      expect.arrayContaining(["dataset_mismatch", "project_mismatch", "delivery_mode_not_disabled"]),
    );
  });
});
