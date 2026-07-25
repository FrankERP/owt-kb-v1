// Service Readiness A3 §4 — the fail-closed verification identity decision.
//
// The point of these tests: the identity route has NO auth gate, so the ONLY
// thing standing between "harness can prove the dataset" and "production quietly
// answers a probe" is this decision. Every condition is therefore failed on its
// own, and the payload shape is asserted to be a closed, secret-free set.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The module is `import "server-only"` guarded; neutralize the marker under vitest.
import { vi } from "vitest";
vi.mock("server-only", () => ({}));

import {
  DATASET_ENV,
  DELIVERY_MODE_DISABLED,
  DELIVERY_MODE_ENV,
  E2E_WRITES_ENV,
  E2E_WRITES_VALUE,
  FORBIDDEN_DATASETS,
  FORBIDDEN_PROJECT_IDS,
  PROJECT_ID_ENV,
  VERIFICATION_DATASET,
  VERIFICATION_IDENTITY_KEYS,
  VERIFICATION_MARKER_ENV,
  VERIFICATION_MARKER_VALUE,
  VERIFICATION_PROJECT_ID,
  buildVerificationIdentity,
  evaluateVerificationEnvironment,
  resolveVerificationEnvironment,
} from "../srVerificationIdentity";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function read(rel: string): string {
  return readFileSync(path.join(REPO_ROOT, rel), "utf8");
}

/** A complete, valid isolated-verification environment. */
function goodEnv(over: Record<string, string | undefined> = {}) {
  return {
    [PROJECT_ID_ENV]: VERIFICATION_PROJECT_ID,
    [DATASET_ENV]: VERIFICATION_DATASET,
    [VERIFICATION_MARKER_ENV]: VERIFICATION_MARKER_VALUE,
    [E2E_WRITES_ENV]: E2E_WRITES_VALUE,
    [DELIVERY_MODE_ENV]: DELIVERY_MODE_DISABLED,
    VERCEL_GIT_COMMIT_REF: "verify/service-readiness",
    VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
    VERCEL_DEPLOYMENT_ID: "dpl_verification123",
    VERCEL_URL: "owt-backstage-abc123.vercel.app",
    ...over,
  };
}

describe("verification identity constants", () => {
  it("mirror the guard module's hard identities exactly", () => {
    // These values are duplicated because a `.ts` module cannot import the `.mjs`
    // guard module. Assert the duplication against its source so it cannot drift.
    const guards = read("scripts/lib/sr-verification.mjs");
    expect(guards).toContain(`export const VERIFICATION_DATASET = "${VERIFICATION_DATASET}"`);
    expect(guards).toContain(`export const VERIFICATION_PROJECT_ID = "${VERIFICATION_PROJECT_ID}"`);
    expect(guards).toContain(`export const MARKER_VALUE = "${VERIFICATION_MARKER_VALUE}"`);
    expect(guards).toContain(`export const MARKER_ENV = "${VERIFICATION_MARKER_ENV}"`);
    for (const id of FORBIDDEN_PROJECT_IDS) expect(guards).toContain(`FORBIDDEN_PROJECT_IDS = Object.freeze(["${id}"])`);
    for (const ds of FORBIDDEN_DATASETS) expect(guards).toContain(`FORBIDDEN_DATASETS = Object.freeze(["${ds}"])`);
  });

  it("resolves project and dataset from exactly the variables sanity/env.ts uses", () => {
    // "The resolved dataset" must be the dataset the Sanity clients really talk
    // to, not a second opinion that could disagree with them.
    const env = read("sanity/env.ts");
    expect(env).toContain(`process.env.${DATASET_ENV}`);
    expect(env).toContain(`process.env.${PROJECT_ID_ENV}`);
  });
});

describe("resolveVerificationEnvironment", () => {
  it("trims and nulls blank values", () => {
    const resolved = resolveVerificationEnvironment({
      [PROJECT_ID_ENV]: "  scbxomq9  ",
      [DATASET_ENV]: "   ",
      VERCEL_GIT_COMMIT_REF: "",
    });
    expect(resolved.projectId).toBe("scbxomq9");
    expect(resolved.dataset).toBeNull();
    expect(resolved.gitRef).toBeNull();
  });

  it("prefers provider metadata and falls back to the configured SR_VERIFY_* values", () => {
    expect(
      resolveVerificationEnvironment({ VERCEL_GIT_COMMIT_SHA: "aaa", SR_VERIFY_CANDIDATE_SHA: "bbb" }).gitCommitSha,
    ).toBe("aaa");
    expect(resolveVerificationEnvironment({ SR_VERIFY_CANDIDATE_SHA: "bbb" }).gitCommitSha).toBe("bbb");
    expect(
      resolveVerificationEnvironment({ VERCEL_DEPLOYMENT_ID: "dpl_a", SR_VERIFY_DEPLOYMENT_ID: "dpl_b" }).deploymentId,
    ).toBe("dpl_a");
    expect(resolveVerificationEnvironment({ SR_VERIFY_DEPLOYMENT_ID: "dpl_b" }).deploymentId).toBe("dpl_b");
  });
});

describe("evaluateVerificationEnvironment — the complete environment passes", () => {
  it("accepts an isolated verification deployment", () => {
    expect(evaluateVerificationEnvironment(goodEnv())).toEqual({ ok: true, failures: [] });
  });

  it("refuses an empty environment (the ordinary local/production case)", () => {
    const verdict = evaluateVerificationEnvironment({});
    expect(verdict.ok).toBe(false);
    expect(verdict.failures).toContain("missing_project");
    expect(verdict.failures).toContain("missing_dataset");
    expect(verdict.failures).toContain("missing_marker");
    expect(verdict.failures).toContain("e2e_writes_not_enabled");
    expect(verdict.failures).toContain("delivery_mode_not_disabled");
  });
});

describe("evaluateVerificationEnvironment — each condition fails on its own", () => {
  it("wrong marker", () => {
    const verdict = evaluateVerificationEnvironment(goodEnv({ [VERIFICATION_MARKER_ENV]: "owt-something-else" }));
    expect(verdict.ok).toBe(false);
    expect(verdict.failures).toEqual(["marker_mismatch"]);
  });

  it("absent marker", () => {
    const verdict = evaluateVerificationEnvironment(goodEnv({ [VERIFICATION_MARKER_ENV]: undefined }));
    expect(verdict.failures).toEqual(["missing_marker"]);
  });

  it("production dataset", () => {
    const verdict = evaluateVerificationEnvironment(goodEnv({ [DATASET_ENV]: "production" }));
    expect(verdict.ok).toBe(false);
    // Both the independent production refusal AND the exact-match failure fire.
    expect(verdict.failures).toContain("forbidden_dataset");
    expect(verdict.failures).toContain("wrong_dataset");
  });

  it("production project", () => {
    const verdict = evaluateVerificationEnvironment(goodEnv({ [PROJECT_ID_ENV]: "ebb8vcnk" }));
    expect(verdict.ok).toBe(false);
    expect(verdict.failures).toContain("forbidden_project");
    expect(verdict.failures).toContain("wrong_project");
  });

  it("production project WITH the correct verification dataset name still refuses", () => {
    // The two axes are checked independently: a right-looking dataset name in the
    // production project must never be mistaken for isolation.
    const verdict = evaluateVerificationEnvironment(
      goodEnv({ [PROJECT_ID_ENV]: "ebb8vcnk", [DATASET_ENV]: VERIFICATION_DATASET }),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.failures).toContain("forbidden_project");
  });

  it("correct project WITH the production dataset still refuses", () => {
    const verdict = evaluateVerificationEnvironment(
      goodEnv({ [PROJECT_ID_ENV]: VERIFICATION_PROJECT_ID, [DATASET_ENV]: "production" }),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.failures).toContain("forbidden_dataset");
  });

  it("some other non-production project or dataset", () => {
    expect(evaluateVerificationEnvironment(goodEnv({ [PROJECT_ID_ENV]: "zzzzzzzz" })).failures).toEqual([
      "wrong_project",
    ]);
    expect(evaluateVerificationEnvironment(goodEnv({ [DATASET_ENV]: "staging" })).failures).toEqual(["wrong_dataset"]);
  });

  it("missing E2E-writes flag, and a non-literal truthy value", () => {
    expect(evaluateVerificationEnvironment(goodEnv({ [E2E_WRITES_ENV]: undefined })).failures).toEqual([
      "e2e_writes_not_enabled",
    ]);
    for (const value of ["1", "TRUE", "True", "yes", "true "]) {
      const verdict = evaluateVerificationEnvironment(goodEnv({ [E2E_WRITES_ENV]: value }));
      // "true " trims to "true" and is accepted; everything else is refused.
      if (value.trim() === E2E_WRITES_VALUE) expect(verdict.ok, value).toBe(true);
      else expect(verdict.failures, value).toEqual(["e2e_writes_not_enabled"]);
    }
  });

  it("delivery mode not exactly disabled", () => {
    for (const value of [undefined, "", "Disabled", "off", "sandbox", "enabled"]) {
      const verdict = evaluateVerificationEnvironment(goodEnv({ [DELIVERY_MODE_ENV]: value }));
      expect(verdict.ok, String(value)).toBe(false);
      expect(verdict.failures, String(value)).toEqual(["delivery_mode_not_disabled"]);
    }
  });
});

describe("buildVerificationIdentity", () => {
  it("returns exactly the closed non-secret key set", () => {
    const payload = buildVerificationIdentity(goodEnv());
    expect(Object.keys(payload).sort()).toEqual([...VERIFICATION_IDENTITY_KEYS].sort());
    expect(payload).toEqual({
      ok: true,
      marker: VERIFICATION_MARKER_VALUE,
      projectId: VERIFICATION_PROJECT_ID,
      dataset: VERIFICATION_DATASET,
      deliveryMode: DELIVERY_MODE_DISABLED,
      e2eWritesEnabled: true,
      git: { ref: "verify/service-readiness", commitSha: "a".repeat(40) },
      deployment: { id: "dpl_verification123", url: "owt-backstage-abc123.vercel.app" },
    });
  });

  it("nulls absent provider metadata instead of inventing it", () => {
    const payload = buildVerificationIdentity({
      [PROJECT_ID_ENV]: VERIFICATION_PROJECT_ID,
      [DATASET_ENV]: VERIFICATION_DATASET,
      [VERIFICATION_MARKER_ENV]: VERIFICATION_MARKER_VALUE,
      [E2E_WRITES_ENV]: E2E_WRITES_VALUE,
      [DELIVERY_MODE_ENV]: DELIVERY_MODE_DISABLED,
    });
    expect(payload.git).toEqual({ ref: null, commitSha: null });
    expect(payload.deployment).toEqual({ id: null, url: null });
  });

  it("leaks no secret even when every secret-shaped variable is set", () => {
    const secrets = {
      SANITY_WRITE_TOKEN: "skWriteTokenSECRET",
      SANITY_API_READ_TOKEN: "skReadTokenSECRET",
      SR_VERIFY_SANITY_TOKEN: "skVerifyTokenSECRET",
      SR_VERIFY_ADMIN_PASSWORD_HASH: "$2b$10$hashSECRET",
      NEXTAUTH_SECRET: "nextauthSECRET",
      VERCEL_AUTOMATION_BYPASS_SECRET: "bypassSECRET",
      SMTP_PASS: "smtpSECRET",
      RESEND_API_KEY: "reSECRET",
      FIREBASE_SERVICE_ACCOUNT: '{"private_key":"pkSECRET"}',
      GOOGLE_CLIENT_SECRET: "googleSECRET",
    };
    const serialized = JSON.stringify(buildVerificationIdentity(goodEnv(secrets)));
    for (const value of Object.values(secrets)) expect(serialized).not.toContain(value);
    for (const key of Object.keys(secrets)) expect(serialized).not.toContain(key);
    expect(serialized).not.toContain("SECRET");
  });
});
