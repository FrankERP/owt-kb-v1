// Service Readiness A3 §4 — the deployed-route harness's refusal guards.
//
// This module is PURE. It performs no I/O, constructs no client, reads no
// filesystem, and never returns a secret VALUE — only presence booleans. Every
// refusal the Playwright configuration enforces is DECIDED here, so
// `playwright.config.ts` stays a thin "throw what this module decided" shim and
// the refusals are unit-testable offline, with no deployment in existence.
//
// The harness must be IMPOSSIBLE to run by accident. It refuses unless ALL of:
//
//   1. an explicit base URL of the RECORDED verification deployment is supplied
//      (`SR_VERIFY_BASE_URL`). There is no default, no localhost fallback, and
//      no "guess from VERCEL_URL" — an unset base URL is a hard refusal.
//   2. `ALLOW_SERVICE_READINESS_E2E_WRITES=true`, literally.
//   3. the base URL host is NOT the production domain and NOT the stable dev
//      domain `dev-owt-backstage.vercel.app` (hard refusals, both directions).
//   4. the base URL is https, has no credentials, no query string and no
//      fragment — a secret must never be able to ride in the URL.
//   5. test credentials come from the runner's own environment, never from a
//      tracked file.
//   6. the isolated Sanity identity resolves to project `scbxomq9` / dataset
//      `service-readiness-verification`, and never to production.
//   7. the run identity (`runId:candidateSha:deploymentId`) is complete, because
//      it is the dataset-lease owner AND the login-event collision boundary.
//
// The production Sanity project/dataset and the production domain are refused on
// every axis independently: a correct project carrying the production dataset
// still refuses, and vice versa.

/* ------------------------------------------------------------------ *
 * Environment variable names
 * ------------------------------------------------------------------ */

/** Explicit base URL of the recorded verification deployment. No default, ever. */
export const BASE_URL_ENV = "SR_VERIFY_BASE_URL";

/** Literal opt-in flag. Compared to `"true"`, never coerced. */
export const E2E_WRITES_ENV = "ALLOW_SERVICE_READINESS_E2E_WRITES";
export const E2E_WRITES_VALUE = "true";

/** Test-admin credentials. Runner-side env only; never a tracked file. */
export const ADMIN_EMAIL_ENV = "SR_VERIFY_ADMIN_EMAIL";
export const ADMIN_PASSWORD_ENV = "SR_VERIFY_ADMIN_PASSWORD";
/** A seeded ordinary member, used for the authorization-rejection scenarios. */
export const MEMBER_EMAIL_ENV = "SR_VERIFY_MEMBER_EMAIL";
export const MEMBER_PASSWORD_ENV = "SR_VERIFY_MEMBER_PASSWORD";

/**
 * Deployment Protection bypass secret. RUNNER-SIDE ONLY: it is read from this
 * one variable, sent only as a header, and never written to a tracked file, a
 * URL, a query string, a storage state, or any log line.
 */
export const BYPASS_SECRET_ENV = "SR_VERIFY_BYPASS_SECRET";

/**
 * Vercel's own managed bypass variable. Named here ONLY so the harness can prove
 * it never consumes it: the runner always supplies its own secret, and this name
 * is on a deny list rather than a fallback chain.
 */
export const PROVIDER_MANAGED_BYPASS_ENV = "VERCEL_AUTOMATION_BYPASS_SECRET";

/** Optional: complete recorded deployment logs, for the zero-delivery proof. */
export const RUNTIME_LOG_ENV = "SR_VERIFY_RUNTIME_LOG_FILE";

/* ------------------------------------------------------------------ *
 * Hard identities (mirrored from scripts/lib/sr-verification.mjs and
 * app/utils/srVerificationIdentity.ts; a parity test pins all three)
 * ------------------------------------------------------------------ */

export const VERIFICATION_DATASET = "service-readiness-verification";
export const VERIFICATION_PROJECT_ID = "scbxomq9";
export const FORBIDDEN_PROJECT_IDS: readonly string[] = Object.freeze(["ebb8vcnk"]);
export const FORBIDDEN_DATASETS: readonly string[] = Object.freeze(["production"]);

export const VERIFICATION_MARKER_ENV = "SERVICE_READINESS_VERIFICATION_MARKER";
export const VERIFICATION_MARKER_VALUE = "owt-service-readiness-verification-v1";

/** §3's outbound-delivery firewall. The identity route must report exactly this. */
export const DELIVERY_MODE_ENV = "SERVICE_READINESS_DELIVERY_MODE";
export const DELIVERY_MODE_DISABLED = "disabled";

/**
 * Hosts this harness must never touch.
 *
 * `owt-backstage.vercel.app` is PRODUCTION. `dev-owt-backstage.vercel.app` is the
 * stable dev alias owned exclusively by the `preview` branch, which is
 * production-Sanity-backed — the plan forbids the suite there explicitly. Both are
 * matched on the exact host, and any subdomain of them is refused too, so a
 * lookalike cannot slip past by prefixing a label.
 */
export const PRODUCTION_HOSTS: readonly string[] = Object.freeze(["owt-backstage.vercel.app"]);
export const STABLE_DEV_HOSTS: readonly string[] = Object.freeze(["dev-owt-backstage.vercel.app"]);

/* ------------------------------------------------------------------ *
 * Failure codes
 * ------------------------------------------------------------------ */

export type HarnessFailureCode =
  | "missing_base_url"
  | "malformed_base_url"
  | "insecure_base_url"
  | "base_url_has_credentials"
  | "base_url_has_query"
  | "base_url_has_fragment"
  | "production_base_url"
  | "stable_dev_base_url"
  | "e2e_writes_not_enabled"
  | "missing_marker"
  | "marker_mismatch"
  | "forbidden_project"
  | "forbidden_dataset"
  | "missing_project"
  | "wrong_project"
  | "missing_dataset"
  | "wrong_dataset"
  | "missing_sanity_token"
  | "missing_admin_credentials"
  | "missing_member_credentials"
  | "incomplete_run_identity"
  | "provider_managed_bypass_consumed";

export interface HarnessFailure {
  code: HarnessFailureCode;
  message: string;
}

export interface HarnessConfig {
  /** Origin only — never a path, never a query string, never credentials. */
  baseURL: string;
  host: string;
  projectId: string;
  dataset: string;
  runId: string;
  candidateSha: string;
  deploymentId: string;
  /** `runId:candidateSha:deploymentId` — the dataset-lease owner. */
  leaseOwner: string;
  /** Presence only. The VALUE is never carried in this object. */
  hasBypassSecret: boolean;
  hasSanityToken: boolean;
  /** Path to the deployment's complete recorded logs, when one was supplied. */
  runtimeLogFile: string | null;
}

export interface HarnessVerdict {
  ok: boolean;
  failures: HarnessFailure[];
  /** Present only when `ok` — a refused run has no usable configuration. */
  config: HarnessConfig | null;
}

function trimmed(value: string | undefined): string | null {
  return typeof value === "string" && value.trim().length ? value.trim() : null;
}

function fail(code: HarnessFailureCode, message: string): HarnessFailure {
  return { code, message };
}

/** Exact host, or any subdomain of it (`x.dev-owt-backstage.vercel.app` too). */
function hostMatches(host: string, forbidden: readonly string[]): boolean {
  const lower = host.toLowerCase();
  return forbidden.some((f) => lower === f || lower.endsWith(`.${f}`));
}

/* ------------------------------------------------------------------ *
 * Base URL
 * ------------------------------------------------------------------ */

export interface BaseUrlVerdict {
  failures: HarnessFailure[];
  /** Normalized origin (scheme + host + port), or null when unusable. */
  origin: string | null;
  host: string | null;
}

/**
 * Validate the explicitly supplied base URL.
 *
 * The result is the ORIGIN only. A path, query string or fragment is stripped
 * after being refused — the harness navigates from an origin it constructed, so
 * even a mistake in the supplied value cannot smuggle a query parameter (and
 * therefore cannot smuggle a bypass secret) into a recorded request.
 */
export function evaluateBaseUrl(raw: string | undefined): BaseUrlVerdict {
  const value = trimmed(raw);
  if (!value) {
    return {
      failures: [
        fail(
          "missing_base_url",
          `${BASE_URL_ENV} is not set. The deployed-route harness has no default and no localhost fallback: ` +
            `it runs ONLY against the explicitly recorded verification deployment URL.`,
        ),
      ],
      origin: null,
      host: null,
    };
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return {
      failures: [fail("malformed_base_url", `${BASE_URL_ENV} is not a parseable absolute URL.`)],
      origin: null,
      host: null,
    };
  }

  const failures: HarnessFailure[] = [];
  const host = url.hostname;

  // Production and the stable dev alias are refused FIRST and independently, so
  // relaxing any later check can never relax these two.
  if (hostMatches(host, PRODUCTION_HOSTS)) {
    failures.push(
      fail(
        "production_base_url",
        `${BASE_URL_ENV} points at the PRODUCTION domain (${host}). This harness must never run there.`,
      ),
    );
  }
  if (hostMatches(host, STABLE_DEV_HOSTS)) {
    failures.push(
      fail(
        "stable_dev_base_url",
        `${BASE_URL_ENV} points at the stable dev domain (${host}), which is production-Sanity-backed and owned by ` +
          `the "preview" branch. Refusing — use the verification deployment's own unique URL.`,
      ),
    );
  }

  if (url.protocol !== "https:") {
    failures.push(
      fail("insecure_base_url", `${BASE_URL_ENV} must be https (got "${url.protocol}").`),
    );
  }
  if (url.username || url.password) {
    failures.push(
      fail(
        "base_url_has_credentials",
        `${BASE_URL_ENV} carries userinfo credentials. A secret must never live in a URL.`,
      ),
    );
  }
  if (url.search) {
    failures.push(
      fail(
        "base_url_has_query",
        `${BASE_URL_ENV} carries a query string. The protection bypass is sent as a HEADER only, never as a query parameter.`,
      ),
    );
  }
  if (url.hash) {
    failures.push(fail("base_url_has_fragment", `${BASE_URL_ENV} carries a fragment.`));
  }

  return { failures, origin: failures.length ? null : url.origin, host };
}

/* ------------------------------------------------------------------ *
 * The complete verdict
 * ------------------------------------------------------------------ */

export interface EvaluateOptions {
  env: Readonly<Record<string, string | undefined>>;
  /**
   * Whether the deployment is protected. When it is, a bypass secret is
   * required; when it is not, supplying one is pointless but not fatal (the plan
   * records `deploymentProtection=none` and continues with the ordinary config).
   */
  protectionExpected?: boolean;
}

/**
 * Evaluate every refusal condition and collect ALL failures, so one run reports
 * everything that is wrong rather than one thing at a time.
 */
export function evaluateHarnessConfig({ env, protectionExpected = true }: EvaluateOptions): HarnessVerdict {
  const failures: HarnessFailure[] = [];

  const base = evaluateBaseUrl(env[BASE_URL_ENV]);
  failures.push(...base.failures);

  if (trimmed(env[E2E_WRITES_ENV]) !== E2E_WRITES_VALUE) {
    failures.push(
      fail(
        "e2e_writes_not_enabled",
        `${E2E_WRITES_ENV} must be exactly "${E2E_WRITES_VALUE}". Deployed mutating verification is opt-in, never implicit.`,
      ),
    );
  }

  const marker = trimmed(env[VERIFICATION_MARKER_ENV]);
  if (!marker) {
    failures.push(fail("missing_marker", `${VERIFICATION_MARKER_ENV} is not set.`));
  } else if (marker !== VERIFICATION_MARKER_VALUE) {
    failures.push(
      fail("marker_mismatch", `${VERIFICATION_MARKER_ENV} is set to an unexpected value.`),
    );
  }

  // --- Sanity identity: project and dataset checked on separate axes -----
  const projectId = trimmed(env.SR_VERIFY_SANITY_PROJECT_ID) ?? trimmed(env.NEXT_PUBLIC_SANITY_PROJECT_ID);
  const dataset = trimmed(env.SR_VERIFY_SANITY_DATASET) ?? trimmed(env.NEXT_PUBLIC_SANITY_DATASET);

  if (projectId && FORBIDDEN_PROJECT_IDS.includes(projectId)) {
    failures.push(
      fail("forbidden_project", `Resolved Sanity project "${projectId}" is the PRODUCTION project.`),
    );
  }
  if (dataset && FORBIDDEN_DATASETS.includes(dataset)) {
    failures.push(
      fail("forbidden_dataset", `Resolved Sanity dataset "${dataset}" is the PRODUCTION dataset.`),
    );
  }
  if (!projectId) failures.push(fail("missing_project", `No Sanity project id resolved.`));
  else if (projectId !== VERIFICATION_PROJECT_ID) {
    failures.push(
      fail("wrong_project", `Resolved Sanity project "${projectId}" is not "${VERIFICATION_PROJECT_ID}".`),
    );
  }
  if (!dataset) failures.push(fail("missing_dataset", `No Sanity dataset resolved.`));
  else if (dataset !== VERIFICATION_DATASET) {
    failures.push(
      fail("wrong_dataset", `Resolved Sanity dataset "${dataset}" is not "${VERIFICATION_DATASET}".`),
    );
  }

  if (!trimmed(env.SR_VERIFY_SANITY_TOKEN)) {
    failures.push(
      fail(
        "missing_sanity_token",
        `SR_VERIFY_SANITY_TOKEN is not set. Fixture reset and post-mutation re-query cannot run.`,
      ),
    );
  }

  // --- Credentials: runner-side env or CI secret ONLY --------------------
  if (!trimmed(env[ADMIN_EMAIL_ENV]) || !trimmed(env[ADMIN_PASSWORD_ENV])) {
    failures.push(
      fail(
        "missing_admin_credentials",
        `${ADMIN_EMAIL_ENV}/${ADMIN_PASSWORD_ENV} must come from the runner's local env file or a CI secret store. ` +
          `They are never read from a tracked file.`,
      ),
    );
  }
  if (!trimmed(env[MEMBER_EMAIL_ENV]) || !trimmed(env[MEMBER_PASSWORD_ENV])) {
    failures.push(
      fail(
        "missing_member_credentials",
        `${MEMBER_EMAIL_ENV}/${MEMBER_PASSWORD_ENV} must be supplied so the authorization-rejection scenarios can run ` +
          `as a real seeded member rather than being skipped.`,
      ),
    );
  }

  // --- Run identity = lease owner = login-event collision boundary -------
  const runId = trimmed(env.SR_VERIFY_RUN_ID);
  const candidateSha = trimmed(env.SR_VERIFY_CANDIDATE_SHA);
  const deploymentId = trimmed(env.SR_VERIFY_DEPLOYMENT_ID);
  const identityParts = [runId, candidateSha, deploymentId];
  const identityUsable =
    identityParts.every((p): p is string => typeof p === "string" && p.length > 0) &&
    identityParts.every((p) => !(p as string).includes(":"));
  if (!identityUsable) {
    failures.push(
      fail(
        "incomplete_run_identity",
        `SR_VERIFY_RUN_ID, SR_VERIFY_CANDIDATE_SHA and SR_VERIFY_DEPLOYMENT_ID must all be set and contain no ":". ` +
          `They form the dataset-lease owner and the login-event ownership predicate.`,
      ),
    );
  }

  // --- Bypass secret ----------------------------------------------------
  const hasBypassSecret = !!trimmed(env[BYPASS_SECRET_ENV]);
  if (protectionExpected && !hasBypassSecret) {
    failures.push(
      fail(
        "provider_managed_bypass_consumed",
        `Deployment Protection is enabled on this project, so ${BYPASS_SECRET_ENV} must be supplied from the runner's ` +
          `own secret store. The provider-managed ${PROVIDER_MANAGED_BYPASS_ENV} is never consumed.`,
      ),
    );
  }

  if (failures.length || !base.origin || !base.host) {
    return { ok: false, failures, config: null };
  }

  return {
    ok: true,
    failures: [],
    config: {
      baseURL: base.origin,
      host: base.host,
      projectId: projectId as string,
      dataset: dataset as string,
      runId: runId as string,
      candidateSha: candidateSha as string,
      deploymentId: deploymentId as string,
      leaseOwner: `${runId}:${candidateSha}:${deploymentId}`,
      hasBypassSecret,
      hasSanityToken: true,
      runtimeLogFile: trimmed(env[RUNTIME_LOG_ENV]),
    },
  };
}

/**
 * Render a refusal as a multi-line operator message. Contains failure CODES and
 * variable NAMES only — never a secret value, never a credential.
 */
export function describeRefusal(verdict: HarnessVerdict): string {
  const lines = [
    "",
    "Service Readiness A3 deployed-route harness — REFUSING TO RUN.",
    "",
    "  This suite signs in and MUTATES data through deployed routes. It runs only",
    "  against the explicitly recorded isolated verification deployment, and never",
    "  against production or the stable dev domain.",
    "",
  ];
  for (const f of verdict.failures) lines.push(`  ✗ [${f.code}] ${f.message}`);
  lines.push("");
  return lines.join("\n");
}

/** Throwing form, used by `playwright.config.ts` so the runner exits non-zero. */
export function requireHarnessConfig(options: EvaluateOptions): HarnessConfig {
  const verdict = evaluateHarnessConfig(options);
  if (!verdict.ok || !verdict.config) throw new Error(describeRefusal(verdict));
  return verdict.config;
}
