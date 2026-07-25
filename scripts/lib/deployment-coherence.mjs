// Build-time fail-closed guard (A3 §3).
//
// The verification branch must build against the ISOLATED dataset, and the
// isolated dataset must only ever be built by the verification branch. Both
// directions matter, and the second is the one that is easy to forget:
//
//   verify branch + production dataset → the deployed suite signs in and mutates
//     real services. Catastrophic.
//   any other branch + verification dataset → production or stable-dev serves
//     synthetic fixtures to the actual team. Also unacceptable.
//
// Enforcing this at BUILD time means a misconfigured deployment never exists to
// be caught later at runtime. It relies on Vercel exposing VERCEL_GIT_COMMIT_REF
// to the build, which the project's `autoExposeSystemEnvs` setting provides; if a
// ref is absent (an ordinary local build) there is nothing to assert and the
// guard stays silent rather than blocking development.

export const VERIFICATION_REF = "verify/service-readiness";
export const VERIFICATION_DATASET = "service-readiness-verification";
export const VERIFICATION_PROJECT_ID = "scbxomq9";
export const PRODUCTION_DATASET = "production";
export const PRODUCTION_PROJECT_ID = "ebb8vcnk";

/**
 * Decide whether a build may proceed. Pure — returns a verdict rather than
 * throwing, so it can be exhaustively tested.
 *
 * @returns {{ ok: boolean, reason: string|null, message: string|null }}
 */
export function evaluateDeploymentCoherence(env = {}) {
  const ref = typeof env.VERCEL_GIT_COMMIT_REF === "string" ? env.VERCEL_GIT_COMMIT_REF.trim() : "";
  const dataset = typeof env.NEXT_PUBLIC_SANITY_DATASET === "string" ? env.NEXT_PUBLIC_SANITY_DATASET.trim() : "";
  const projectId = typeof env.NEXT_PUBLIC_SANITY_PROJECT_ID === "string" ? env.NEXT_PUBLIC_SANITY_PROJECT_ID.trim() : "";

  // No git ref: an ordinary local build. Nothing to assert.
  if (!ref) return { ok: true, reason: null, message: null };

  const ok = (reason = null) => ({ ok: true, reason, message: null });
  const fail = (reason, message) => ({ ok: false, reason, message });

  if (ref === VERIFICATION_REF) {
    if (dataset === PRODUCTION_DATASET || projectId === PRODUCTION_PROJECT_ID) {
      return fail(
        "verification_ref_targets_production",
        `Branch "${ref}" is the isolated verification branch but this build targets production ` +
          `(project "${projectId || "unset"}", dataset "${dataset || "unset"}"). The deployed suite ` +
          `signs in and MUTATES data, so this build is refused.`,
      );
    }
    if (dataset !== VERIFICATION_DATASET || projectId !== VERIFICATION_PROJECT_ID) {
      return fail(
        "verification_ref_misconfigured",
        `Branch "${ref}" must build against ${VERIFICATION_PROJECT_ID}/${VERIFICATION_DATASET}, ` +
          `but this build resolved project "${projectId || "unset"}" and dataset "${dataset || "unset"}". ` +
          `Branch-scoped Preview variables are probably missing or not applied.`,
      );
    }
    return ok("verification_ref_isolated");
  }

  // Any other branch — including main and preview — must NOT serve the isolated
  // synthetic dataset to real users.
  if (dataset === VERIFICATION_DATASET || projectId === VERIFICATION_PROJECT_ID) {
    return fail(
      "non_verification_ref_targets_isolated",
      `Branch "${ref}" is not the verification branch, but this build targets the isolated ` +
        `verification environment (project "${projectId || "unset"}", dataset "${dataset || "unset"}"). ` +
        `That would serve synthetic fixtures to real users, so this build is refused.`,
    );
  }

  return ok("ordinary_build");
}

/** Throw on an incoherent build. Called from `next.config.mjs`. */
export function assertDeploymentCoherence(env = {}) {
  const verdict = evaluateDeploymentCoherence(env);
  if (!verdict.ok) {
    throw new Error(`[deployment-coherence] ${verdict.reason}\n\n${verdict.message}\n`);
  }
  return verdict;
}
