// Service Readiness A3 §4 — the deployment-identity preflight.
//
// The FIRST thing the run does, before any sign-in and before any mutation: GET
// `/api/service-readiness-verification/identity` on the exact recorded host and
// prove the deployment answers `ok: true` with dataset
// `service-readiness-verification` and project `scbxomq9`.
//
// Anything else ABORTS THE WHOLE RUN, not just one test:
//
//   · 404  — the route fails closed in every ordinary Preview/Production
//            deployment, so a 404 means this is NOT the isolated deployment.
//   · 401/403 — Deployment Protection rejected the request, i.e. the bypass is
//            missing or wrong. Continuing would sign in against an unknown target.
//   · a mismatched dataset or project — the deployment is wired to the wrong
//            Content Lake. This is the check that stands between the suite and
//            production data, so it is exact-match and never "close enough".
//
// `evaluateIdentity` is pure, so every abort case is provable offline with no
// deployment in existence.

import {
  DELIVERY_MODE_DISABLED,
  VERIFICATION_DATASET,
  VERIFICATION_MARKER_VALUE,
  VERIFICATION_PROJECT_ID,
} from "./harnessGuards";

export const IDENTITY_PATH = "/api/service-readiness-verification/identity";

export type PreflightFailureCode =
  | "not_found"
  | "protection_rejected"
  | "unexpected_status"
  | "unparseable_body"
  | "not_ok"
  | "marker_mismatch"
  | "dataset_mismatch"
  | "project_mismatch"
  | "delivery_mode_not_disabled"
  | "e2e_writes_not_enabled"
  | "deployment_id_mismatch"
  | "candidate_sha_mismatch";

export interface PreflightFailure {
  code: PreflightFailureCode;
  message: string;
}

export interface IdentityBody {
  ok?: unknown;
  marker?: unknown;
  projectId?: unknown;
  dataset?: unknown;
  deliveryMode?: unknown;
  e2eWritesEnabled?: unknown;
  git?: { ref?: unknown; commitSha?: unknown } | null;
  deployment?: { id?: unknown; url?: unknown } | null;
}

export interface PreflightVerdict {
  ok: boolean;
  failures: PreflightFailure[];
  /** Non-secret provenance recorded as evidence when the preflight passes. */
  evidence: {
    dataset: string | null;
    projectId: string | null;
    gitRef: string | null;
    commitSha: string | null;
    deploymentId: string | null;
    deploymentUrl: string | null;
  } | null;
}

function fail(code: PreflightFailureCode, message: string): PreflightFailure {
  return { code, message };
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length ? value : null;
}

/**
 * Decide, from the status and body alone, whether this deployment may be used.
 *
 * `expected` pins the run's recorded deployment id and candidate SHA. When both
 * are supplied the identity payload must AGREE with them: a deployment that is
 * isolated but is not the one whose commit/tree was recorded invalidates the proof
 * chain (plan §5 step 8), so it is refused here rather than discovered later.
 */
export function evaluateIdentity({
  status,
  body,
  expected,
}: {
  status: number;
  body: unknown;
  expected?: { deploymentId?: string | null; candidateSha?: string | null };
}): PreflightVerdict {
  if (status === 404) {
    return {
      ok: false,
      failures: [
        fail(
          "not_found",
          `${IDENTITY_PATH} answered 404. That route fails closed in every deployment that is not the isolated ` +
            `verification deployment, so this is NOT the isolated one. Aborting the whole run.`,
        ),
      ],
      evidence: null,
    };
  }
  if (status === 401 || status === 403) {
    return {
      ok: false,
      failures: [
        fail(
          "protection_rejected",
          `${IDENTITY_PATH} answered ${status}. Deployment Protection rejected the request: the runner-side bypass ` +
            `secret is missing, wrong, or was not sent as a header. Aborting the whole run.`,
        ),
      ],
      evidence: null,
    };
  }
  if (status !== 200) {
    return {
      ok: false,
      failures: [fail("unexpected_status", `${IDENTITY_PATH} answered ${status}; expected 200.`)],
      evidence: null,
    };
  }
  if (!body || typeof body !== "object") {
    return {
      ok: false,
      failures: [fail("unparseable_body", `${IDENTITY_PATH} did not return a JSON object.`)],
      evidence: null,
    };
  }

  const payload = body as IdentityBody;
  const failures: PreflightFailure[] = [];

  if (payload.ok !== true) {
    failures.push(fail("not_ok", `Identity payload did not report ok:true.`));
  }
  if (payload.marker !== VERIFICATION_MARKER_VALUE) {
    failures.push(fail("marker_mismatch", `Identity marker is not the documented verification marker.`));
  }
  if (payload.dataset !== VERIFICATION_DATASET) {
    failures.push(
      fail(
        "dataset_mismatch",
        `Identity dataset is "${String(payload.dataset)}", not "${VERIFICATION_DATASET}". ` +
          `Refusing: this deployment is wired to the wrong Content Lake.`,
      ),
    );
  }
  if (payload.projectId !== VERIFICATION_PROJECT_ID) {
    failures.push(
      fail(
        "project_mismatch",
        `Identity project is "${String(payload.projectId)}", not "${VERIFICATION_PROJECT_ID}".`,
      ),
    );
  }
  if (payload.deliveryMode !== DELIVERY_MODE_DISABLED) {
    failures.push(
      fail(
        "delivery_mode_not_disabled",
        `Identity delivery mode is "${String(payload.deliveryMode)}", not "${DELIVERY_MODE_DISABLED}". ` +
          `The outbound-delivery firewall is not proven closed.`,
      ),
    );
  }
  if (payload.e2eWritesEnabled !== true) {
    failures.push(fail("e2e_writes_not_enabled", `Identity does not report e2eWritesEnabled:true.`));
  }

  const deploymentId = str(payload.deployment?.id);
  const commitSha = str(payload.git?.commitSha);
  if (expected?.deploymentId && deploymentId && deploymentId !== expected.deploymentId) {
    failures.push(
      fail(
        "deployment_id_mismatch",
        `The deployment reports id "${deploymentId}" but the run recorded "${expected.deploymentId}". ` +
          `A replacement deployment invalidates the run (plan §5).`,
      ),
    );
  }
  if (expected?.candidateSha && commitSha && commitSha !== expected.candidateSha) {
    failures.push(
      fail(
        "candidate_sha_mismatch",
        `The deployment reports commit "${commitSha}" but the run recorded candidate "${expected.candidateSha}".`,
      ),
    );
  }

  if (failures.length) return { ok: false, failures, evidence: null };

  return {
    ok: true,
    failures: [],
    evidence: {
      dataset: VERIFICATION_DATASET,
      projectId: VERIFICATION_PROJECT_ID,
      gitRef: str(payload.git?.ref),
      commitSha,
      deploymentId,
      deploymentUrl: str(payload.deployment?.url),
    },
  };
}

/** Operator message for an aborted preflight. Names codes only, never a secret. */
export function describePreflightAbort(verdict: PreflightVerdict): string {
  const lines = [
    "",
    "Service Readiness A3 deployed-route harness — PREFLIGHT ABORT.",
    "",
    `  ${IDENTITY_PATH} did not prove this deployment is the isolated verification deployment.`,
    "  No sign-in was attempted and nothing was mutated.",
    "",
  ];
  for (const f of verdict.failures) lines.push(`  ✗ [${f.code}] ${f.message}`);
  lines.push("");
  return lines.join("\n");
}
