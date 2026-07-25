// Offline proof of the A3 §4 harness refusals.
//
// These are the ONLY part of the deployed-route harness that can be verified before a
// verification deployment exists — and they are the part that matters most, because
// they are what stands between "run the mutating suite" and "run it against
// production". Every refusal the plan names has a test here.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  ADMIN_EMAIL_ENV,
  ADMIN_PASSWORD_ENV,
  BASE_URL_ENV,
  BYPASS_SECRET_ENV,
  DELIVERY_MODE_DISABLED,
  E2E_WRITES_ENV,
  FORBIDDEN_DATASETS,
  FORBIDDEN_PROJECT_IDS,
  MEMBER_EMAIL_ENV,
  MEMBER_PASSWORD_ENV,
  PRODUCTION_HOSTS,
  PROVIDER_MANAGED_BYPASS_ENV,
  STABLE_DEV_HOSTS,
  VERIFICATION_DATASET,
  VERIFICATION_MARKER_ENV,
  VERIFICATION_MARKER_VALUE,
  VERIFICATION_PROJECT_ID,
  describeRefusal,
  evaluateBaseUrl,
  evaluateHarnessConfig,
  requireHarnessConfig,
} from "../lib/harnessGuards";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** A complete, valid runner environment — every test perturbs exactly one thing. */
function validEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    [BASE_URL_ENV]: "https://owt-backstage-git-verify-service-readiness-abc123.vercel.app",
    [E2E_WRITES_ENV]: "true",
    [VERIFICATION_MARKER_ENV]: VERIFICATION_MARKER_VALUE,
    SR_VERIFY_SANITY_PROJECT_ID: VERIFICATION_PROJECT_ID,
    SR_VERIFY_SANITY_DATASET: VERIFICATION_DATASET,
    SR_VERIFY_SANITY_TOKEN: "sk-not-a-real-token",
    [ADMIN_EMAIL_ENV]: "srv-member-admin@sr-verify.invalid",
    [ADMIN_PASSWORD_ENV]: "not-a-real-password",
    [MEMBER_EMAIL_ENV]: "srv-member-lead@sr-verify.invalid",
    [MEMBER_PASSWORD_ENV]: "not-a-real-password",
    SR_VERIFY_RUN_ID: "srvrun-0123456789abcdef",
    SR_VERIFY_CANDIDATE_SHA: "0123456789abcdef0123456789abcdef01234567",
    SR_VERIFY_DEPLOYMENT_ID: "dpl_0123456789abcdef",
    [BYPASS_SECRET_ENV]: "runner-side-bypass-secret-value",
    ...overrides,
  };
}

function codes(env: Record<string, string | undefined>, protectionExpected = true): string[] {
  return evaluateHarnessConfig({ env, protectionExpected }).failures.map((f) => f.code);
}

describe("harness configuration guards", () => {
  it("accepts a complete runner environment", () => {
    const verdict = evaluateHarnessConfig({ env: validEnv() });
    expect(verdict.failures).toEqual([]);
    expect(verdict.ok).toBe(true);
    expect(verdict.config).toMatchObject({
      projectId: VERIFICATION_PROJECT_ID,
      dataset: VERIFICATION_DATASET,
      hasBypassSecret: true,
    });
    // The origin only — no path, no query, no credentials.
    expect(verdict.config?.baseURL).toBe(
      "https://owt-backstage-git-verify-service-readiness-abc123.vercel.app",
    );
    // The lease owner is exactly `runId:candidateSha:deploymentId`.
    expect(verdict.config?.leaseOwner).toBe(
      "srvrun-0123456789abcdef:0123456789abcdef0123456789abcdef01234567:dpl_0123456789abcdef",
    );
  });

  it("REFUSES a missing base URL — there is no default and no localhost fallback", () => {
    expect(codes(validEnv({ [BASE_URL_ENV]: undefined }))).toContain("missing_base_url");
    expect(codes(validEnv({ [BASE_URL_ENV]: "   " }))).toContain("missing_base_url");
    // And the config object is withheld entirely, so nothing downstream can proceed.
    expect(evaluateHarnessConfig({ env: validEnv({ [BASE_URL_ENV]: undefined }) }).config).toBeNull();
  });

  it("REFUSES the production domain", () => {
    for (const host of PRODUCTION_HOSTS) {
      expect(codes(validEnv({ [BASE_URL_ENV]: `https://${host}` })), host).toContain(
        "production_base_url",
      );
      // A subdomain of production is refused too.
      expect(codes(validEnv({ [BASE_URL_ENV]: `https://sneaky.${host}` })), host).toContain(
        "production_base_url",
      );
    }
  });

  it("REFUSES dev-owt-backstage.vercel.app", () => {
    for (const host of STABLE_DEV_HOSTS) {
      expect(host).toBe("dev-owt-backstage.vercel.app");
      expect(codes(validEnv({ [BASE_URL_ENV]: `https://${host}` }))).toContain(
        "stable_dev_base_url",
      );
      expect(codes(validEnv({ [BASE_URL_ENV]: `https://${host}/admin` }))).toContain(
        "stable_dev_base_url",
      );
    }
  });

  it("REFUSES a missing or non-literal E2E writes flag", () => {
    expect(codes(validEnv({ [E2E_WRITES_ENV]: undefined }))).toContain("e2e_writes_not_enabled");
    for (const value of ["1", "TRUE", "True", "yes", "false", ""]) {
      expect(codes(validEnv({ [E2E_WRITES_ENV]: value })), value).toContain(
        "e2e_writes_not_enabled",
      );
    }
  });

  it("REFUSES the production Sanity project and dataset, on independent axes", () => {
    // A correct project carrying the production dataset still refuses...
    expect(codes(validEnv({ SR_VERIFY_SANITY_DATASET: FORBIDDEN_DATASETS[0] }))).toEqual(
      expect.arrayContaining(["forbidden_dataset", "wrong_dataset"]),
    );
    // ...and vice versa.
    expect(codes(validEnv({ SR_VERIFY_SANITY_PROJECT_ID: FORBIDDEN_PROJECT_IDS[0] }))).toEqual(
      expect.arrayContaining(["forbidden_project", "wrong_project"]),
    );
    // Any other project/dataset is refused too — the allowlist is exact.
    expect(codes(validEnv({ SR_VERIFY_SANITY_PROJECT_ID: "someother" }))).toContain("wrong_project");
    expect(codes(validEnv({ SR_VERIFY_SANITY_DATASET: "staging" }))).toContain("wrong_dataset");
  });

  it("falls back to the app's NEXT_PUBLIC_* variables so a production env REFUSES loudly", () => {
    // Running with `--env-file=.env.local` must not look "unset and therefore safe".
    const env = validEnv({
      SR_VERIFY_SANITY_PROJECT_ID: undefined,
      SR_VERIFY_SANITY_DATASET: undefined,
      NEXT_PUBLIC_SANITY_PROJECT_ID: FORBIDDEN_PROJECT_IDS[0],
      NEXT_PUBLIC_SANITY_DATASET: FORBIDDEN_DATASETS[0],
    });
    expect(codes(env)).toEqual(
      expect.arrayContaining(["forbidden_project", "forbidden_dataset"]),
    );
  });

  it("REFUSES a missing or mismatched verification marker", () => {
    expect(codes(validEnv({ [VERIFICATION_MARKER_ENV]: undefined }))).toContain("missing_marker");
    expect(codes(validEnv({ [VERIFICATION_MARKER_ENV]: "something-else" }))).toContain(
      "marker_mismatch",
    );
  });

  it("REFUSES credentials that were not supplied by the runner", () => {
    expect(codes(validEnv({ [ADMIN_PASSWORD_ENV]: undefined }))).toContain(
      "missing_admin_credentials",
    );
    expect(codes(validEnv({ [MEMBER_EMAIL_ENV]: undefined }))).toContain(
      "missing_member_credentials",
    );
  });

  it("REFUSES an incomplete run identity, and any part containing the lease separator", () => {
    expect(codes(validEnv({ SR_VERIFY_RUN_ID: undefined }))).toContain("incomplete_run_identity");
    expect(codes(validEnv({ SR_VERIFY_CANDIDATE_SHA: undefined }))).toContain(
      "incomplete_run_identity",
    );
    expect(codes(validEnv({ SR_VERIFY_DEPLOYMENT_ID: undefined }))).toContain(
      "incomplete_run_identity",
    );
    // A ':' would let a half-formed owner alias another run's lease.
    expect(codes(validEnv({ SR_VERIFY_RUN_ID: "run:with:colons" }))).toContain(
      "incomplete_run_identity",
    );
  });

  it("REFUSES a missing bypass secret while Deployment Protection is enabled", () => {
    expect(codes(validEnv({ [BYPASS_SECRET_ENV]: undefined }), true)).toContain(
      "provider_managed_bypass_consumed",
    );
    // Vercel's managed variable is NOT a substitute.
    expect(
      codes(
        validEnv({
          [BYPASS_SECRET_ENV]: undefined,
          [PROVIDER_MANAGED_BYPASS_ENV]: "provider-managed-value",
        }),
        true,
      ),
    ).toContain("provider_managed_bypass_consumed");
    // With protection proven absent, no bypass is required.
    expect(codes(validEnv({ [BYPASS_SECRET_ENV]: undefined }), false)).toEqual([]);
  });

  it("collects EVERY failure rather than stopping at the first", () => {
    const found = codes({});
    expect(found).toEqual(
      expect.arrayContaining([
        "missing_base_url",
        "e2e_writes_not_enabled",
        "missing_marker",
        "missing_project",
        "missing_dataset",
        "missing_sanity_token",
        "missing_admin_credentials",
        "missing_member_credentials",
        "incomplete_run_identity",
      ]),
    );
  });

  it("never puts a secret VALUE in the refusal message or the config object", () => {
    const secret = "runner-side-bypass-secret-value";
    const password = "not-a-real-password";
    const token = "sk-not-a-real-token";
    const refusal = describeRefusal(
      evaluateHarnessConfig({ env: validEnv({ [BASE_URL_ENV]: undefined }) }),
    );
    for (const value of [secret, password, token]) expect(refusal).not.toContain(value);

    const config = evaluateHarnessConfig({ env: validEnv() }).config;
    const serialized = JSON.stringify(config);
    for (const value of [secret, password, token]) expect(serialized).not.toContain(value);
    // Presence, never value.
    expect(config?.hasBypassSecret).toBe(true);
  });

  it("throws from requireHarnessConfig, which is how the Playwright config refuses", () => {
    expect(() => requireHarnessConfig({ env: {} })).toThrow(/REFUSING TO RUN/);
    expect(() => requireHarnessConfig({ env: validEnv() })).not.toThrow();
  });
});

describe("base URL validation", () => {
  it("rejects a non-https, credentialed, query-bearing or fragment-bearing URL", () => {
    const codesOf = (raw: string) => evaluateBaseUrl(raw).failures.map((f) => f.code);
    expect(codesOf("http://example-deploy.vercel.app")).toContain("insecure_base_url");
    expect(codesOf("https://user:pass@example-deploy.vercel.app")).toContain(
      "base_url_has_credentials",
    );
    // The exact leak the plan forbids: a bypass secret riding in the URL.
    expect(
      codesOf("https://example-deploy.vercel.app/?x-vercel-protection-bypass=secret"),
    ).toContain("base_url_has_query");
    expect(codesOf("https://example-deploy.vercel.app/#frag")).toContain("base_url_has_fragment");
    expect(codesOf("not-a-url")).toContain("malformed_base_url");
  });

  it("returns the ORIGIN, discarding any supplied path", () => {
    const verdict = evaluateBaseUrl("https://example-deploy.vercel.app/admin/schedule");
    expect(verdict.failures).toEqual([]);
    expect(verdict.origin).toBe("https://example-deploy.vercel.app");
  });
});

describe("identity parity with the rest of the repository", () => {
  const guardSource = readFileSync(
    path.join(REPO_ROOT, "scripts/lib/sr-verification.mjs"),
    "utf8",
  );
  const identitySource = readFileSync(
    path.join(REPO_ROOT, "app/utils/srVerificationIdentity.ts"),
    "utf8",
  );

  it("mirrors the guard module's hard identities exactly", () => {
    expect(guardSource).toContain(`export const VERIFICATION_DATASET = "${VERIFICATION_DATASET}"`);
    expect(guardSource).toContain(
      `export const VERIFICATION_PROJECT_ID = "${VERIFICATION_PROJECT_ID}"`,
    );
    expect(guardSource).toContain(`export const MARKER_VALUE = "${VERIFICATION_MARKER_VALUE}"`);
    for (const forbidden of FORBIDDEN_PROJECT_IDS) expect(guardSource).toContain(`"${forbidden}"`);
    for (const forbidden of FORBIDDEN_DATASETS) expect(guardSource).toContain(`"${forbidden}"`);
  });

  it("mirrors the server identity module's env names and values exactly", () => {
    expect(identitySource).toContain(`export const VERIFICATION_DATASET = "${VERIFICATION_DATASET}"`);
    expect(identitySource).toContain(
      `export const VERIFICATION_PROJECT_ID = "${VERIFICATION_PROJECT_ID}"`,
    );
    expect(identitySource).toContain(
      `export const VERIFICATION_MARKER_VALUE = "${VERIFICATION_MARKER_VALUE}"`,
    );
    expect(identitySource).toContain(`export const E2E_WRITES_ENV = "${E2E_WRITES_ENV}"`);
    expect(identitySource).toContain(
      `export const DELIVERY_MODE_DISABLED = "${DELIVERY_MODE_DISABLED}"`,
    );
    expect(identitySource).toContain(
      `export const VERIFICATION_MARKER_ENV = "${VERIFICATION_MARKER_ENV}"`,
    );
  });
});
