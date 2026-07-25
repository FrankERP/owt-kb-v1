import "server-only";

// Service Readiness A3 §4 — the server-side identity of an isolated verification
// deployment, and the fail-closed decision about whether it may be advertised.
//
// WHY this exists: the deployed-route harness must be able to prove, BEFORE it
// signs in or writes anything, that the deployment it is talking to targets the
// isolated `service-readiness-verification` dataset in project `scbxomq9` — not
// production. "We set the branch variables" is not evidence; a server-exposed
// identity is.
//
// WHY it fails closed rather than being auth-gated: the harness calls it before
// authenticating, so there is no session to check. The safety property is
// therefore carried entirely by the conditions below. In an ordinary Preview or
// Production deployment EVERY one of them fails (no marker, production dataset,
// production project, no E2E flag, no `disabled` delivery mode), so the route
// answers 404 and does not admit that it exists.
//
// This module is PURE: it decides, it never performs I/O, and it never returns a
// secret. `evaluateVerificationEnvironment` produces failure CODES for tests and
// server logs only — the route never sends them to a caller.

/* ------------------------------------------------------------------ *
 * Hard identities (mirrors of scripts/lib/sr-verification.mjs)
 *
 * The `.mjs` guard module cannot be imported from TypeScript, so these values
 * are duplicated here and `app/utils/__tests__/srVerificationIdentity.test.ts`
 * asserts every one of them against that module's source, so the two can never
 * drift apart silently.
 * ------------------------------------------------------------------ */

/** The only dataset a verification deployment may target. */
export const VERIFICATION_DATASET = "service-readiness-verification";

/** The only Sanity project a verification deployment may target. */
export const VERIFICATION_PROJECT_ID = "scbxomq9";

/** Production project — never a verification target, on any path, ever. */
export const FORBIDDEN_PROJECT_IDS: readonly string[] = Object.freeze(["ebb8vcnk"]);

/** Production dataset — never a verification target, on any path, ever. */
export const FORBIDDEN_DATASETS: readonly string[] = Object.freeze(["production"]);

export const VERIFICATION_MARKER_ENV = "SERVICE_READINESS_VERIFICATION_MARKER";
export const VERIFICATION_MARKER_VALUE = "owt-service-readiness-verification-v1";

export const E2E_WRITES_ENV = "ALLOW_SERVICE_READINESS_E2E_WRITES";
export const E2E_WRITES_VALUE = "true";

export const DELIVERY_MODE_ENV = "SERVICE_READINESS_DELIVERY_MODE";
export const DELIVERY_MODE_DISABLED = "disabled";

/** The two variables `sanity/env.ts` resolves the real client project/dataset from. */
export const PROJECT_ID_ENV = "NEXT_PUBLIC_SANITY_PROJECT_ID";
export const DATASET_ENV = "NEXT_PUBLIC_SANITY_DATASET";

/* ------------------------------------------------------------------ *
 * Resolution
 * ------------------------------------------------------------------ */

export type EnvLike = Readonly<Record<string, string | undefined>>;

function trimmed(value: string | undefined): string | null {
  return typeof value === "string" && value.trim().length ? value.trim() : null;
}

export interface VerificationEnvironment {
  /** Resolved exactly as `sanity/env.ts` resolves it — the clients' real project. */
  projectId: string | null;
  /** Resolved exactly as `sanity/env.ts` resolves it — the clients' real dataset. */
  dataset: string | null;
  marker: string | null;
  deliveryMode: string | null;
  /** Raw flag value; compared literally against `"true"`, never coerced. */
  e2eWrites: string | null;
  /** Vercel-provided, non-secret build/deployment provenance. */
  gitRef: string | null;
  gitCommitSha: string | null;
  deploymentId: string | null;
  deploymentUrl: string | null;
}

/**
 * Resolve everything the verification decisions depend on.
 *
 * `projectId`/`dataset` deliberately read the SAME two variables `sanity/env.ts`
 * reads, so "the resolved dataset" here is the dataset the Sanity clients
 * actually talk to, not a second opinion that could disagree with them.
 *
 * `candidateSha`/`deploymentId` prefer the provider-supplied system variables and
 * fall back to the explicitly configured `SR_VERIFY_*` values used by the guarded
 * scripts, so a deployment whose provider metadata is unavailable can still be
 * pinned — but never inferred.
 */
export function resolveVerificationEnvironment(env: EnvLike): VerificationEnvironment {
  return {
    projectId: trimmed(env[PROJECT_ID_ENV]),
    dataset: trimmed(env[DATASET_ENV]),
    marker: trimmed(env[VERIFICATION_MARKER_ENV]),
    deliveryMode: trimmed(env[DELIVERY_MODE_ENV]),
    e2eWrites: trimmed(env[E2E_WRITES_ENV]),
    gitRef: trimmed(env.VERCEL_GIT_COMMIT_REF),
    gitCommitSha: trimmed(env.VERCEL_GIT_COMMIT_SHA) ?? trimmed(env.SR_VERIFY_CANDIDATE_SHA),
    deploymentId: trimmed(env.VERCEL_DEPLOYMENT_ID) ?? trimmed(env.SR_VERIFY_DEPLOYMENT_ID),
    deploymentUrl: trimmed(env.VERCEL_URL),
  };
}

/* ------------------------------------------------------------------ *
 * The fail-closed decision
 * ------------------------------------------------------------------ */

export type VerificationEnvFailure =
  | "forbidden_project"
  | "forbidden_dataset"
  | "missing_project"
  | "missing_dataset"
  | "wrong_project"
  | "wrong_dataset"
  | "missing_marker"
  | "marker_mismatch"
  | "e2e_writes_not_enabled"
  | "delivery_mode_not_disabled";

export interface VerificationEnvVerdict {
  ok: boolean;
  /** Diagnostic codes for tests/server logs ONLY. Never sent to a caller. */
  failures: VerificationEnvFailure[];
}

/**
 * Every condition, evaluated independently, with ALL failures collected.
 *
 * The two production refusals (`ebb8vcnk`, `production`) are checked on their own
 * axis first and each on its own: a correct project id carrying the production
 * dataset still refuses, and vice versa. They are technically implied by the
 * exact-match checks that follow, and they are kept anyway — a future edit that
 * relaxes "must equal" must not silently relax "must never be production".
 */
export function evaluateVerificationEnvironment(env: EnvLike): VerificationEnvVerdict {
  const resolved = resolveVerificationEnvironment(env);
  const failures: VerificationEnvFailure[] = [];

  // --- Production refusals, each independent -------------------------
  if (resolved.projectId && FORBIDDEN_PROJECT_IDS.includes(resolved.projectId)) {
    failures.push("forbidden_project");
  }
  if (resolved.dataset && FORBIDDEN_DATASETS.includes(resolved.dataset)) {
    failures.push("forbidden_dataset");
  }

  // --- Exact identity ------------------------------------------------
  if (!resolved.projectId) failures.push("missing_project");
  else if (resolved.projectId !== VERIFICATION_PROJECT_ID) failures.push("wrong_project");

  if (!resolved.dataset) failures.push("missing_dataset");
  else if (resolved.dataset !== VERIFICATION_DATASET) failures.push("wrong_dataset");

  // --- Marker --------------------------------------------------------
  if (!resolved.marker) failures.push("missing_marker");
  else if (resolved.marker !== VERIFICATION_MARKER_VALUE) failures.push("marker_mismatch");

  // --- Explicit opt-in flags ----------------------------------------
  if (resolved.e2eWrites !== E2E_WRITES_VALUE) failures.push("e2e_writes_not_enabled");
  if (resolved.deliveryMode !== DELIVERY_MODE_DISABLED) failures.push("delivery_mode_not_disabled");

  return { ok: failures.length === 0, failures };
}

/* ------------------------------------------------------------------ *
 * The response payload
 * ------------------------------------------------------------------ */

/**
 * The COMPLETE set of keys the identity route may ever return. Exported so the
 * test can assert the payload shape is closed — a new field cannot be added
 * without the shape test noticing, which is what keeps a token, bypass value or
 * document body from ever appearing here.
 */
export const VERIFICATION_IDENTITY_KEYS = Object.freeze([
  "ok",
  "marker",
  "projectId",
  "dataset",
  "deliveryMode",
  "e2eWritesEnabled",
  "git",
  "deployment",
] as const);

export interface VerificationIdentityPayload {
  ok: true;
  marker: typeof VERIFICATION_MARKER_VALUE;
  projectId: typeof VERIFICATION_PROJECT_ID;
  dataset: typeof VERIFICATION_DATASET;
  deliveryMode: typeof DELIVERY_MODE_DISABLED;
  e2eWritesEnabled: true;
  git: { ref: string | null; commitSha: string | null };
  deployment: { id: string | null; url: string | null };
}

/**
 * Build the non-secret identity payload. Only ever called once
 * `evaluateVerificationEnvironment(...).ok` is true, so the constant fields are
 * literals rather than echoes: an echo could be made to print something the
 * guards never approved.
 */
export function buildVerificationIdentity(env: EnvLike): VerificationIdentityPayload {
  const resolved = resolveVerificationEnvironment(env);
  return {
    ok: true,
    marker: VERIFICATION_MARKER_VALUE,
    projectId: VERIFICATION_PROJECT_ID,
    dataset: VERIFICATION_DATASET,
    deliveryMode: DELIVERY_MODE_DISABLED,
    e2eWritesEnabled: true,
    git: { ref: resolved.gitRef, commitSha: resolved.gitCommitSha },
    deployment: { id: resolved.deploymentId, url: resolved.deploymentUrl },
  };
}
