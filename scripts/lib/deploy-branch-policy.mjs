// Which git refs are allowed to spend a Vercel BUILD.
//
// Vercel's Function Storage quota counts the function bundle of every RETAINED
// deployment, not just the current one. On 2026-09-17 this project hit 100% of
// the 10 GB Hobby allowance with 136 retained deployments — ~75 MB each, heavy
// because the Sanity Studio embedded at `/studio` is traced into the lambda.
//
// Half of those were waste. Every fix round pushes the feature branch AND
// merges to `preview`, so Vercel built twice; 20 deployments landed in 4.5
// hours that day and ten of them were feature-branch builds that nothing
// consumes. The documented push order (CLAUDE.md) verifies on
// `dev-owt-backstage` — the `preview` alias — and `main`'s only required check
// is the GitHub Actions `gates` job. Vercel contributes no status check, so a
// feature-branch deployment is read by no human and gates no merge.
//
// `git.deploymentEnabled` in `vercel.json` cannot express this: as an object it
// is a BLACKLIST ("unspecified branches default to true"), and as `false` it
// disables every branch including production. So the policy lives here and is
// wired as the Ignored Build Step, which skips the build before install —
// meaning this module may use Node builtins ONLY, never a dependency.
//
// A skipped ref still gets a deployment, as CANCELED with a URL that serves
// nothing. That ends the storage accumulation, which was the problem; it does
// not make a feature-branch push free of the per-day deployment quota.
//
// Three refs deploy, and each is load-bearing:
//   main                      → production, `owt-backstage.vercel.app`
//   preview                   → the stable dev alias, `dev-owt-backstage.vercel.app`
//   verify/service-readiness  → the isolated verification dataset, which
//                               `deployment-coherence.mjs` asserts at build time

export const DEPLOYING_REFS = Object.freeze(["main", "preview", "verify/service-readiness"]);

/**
 * Decide whether a Vercel build may proceed. Pure — returns a verdict rather
 * than exiting, so it can be exhaustively tested.
 *
 * FAILS OPEN on purpose. A missing ref means a source this policy was not
 * written about, and refusing those would turn a storage economy into an
 * outage during a rollback. Wasting one build is recoverable; not being able
 * to ship is not.
 *
 * Do NOT read that as a general escape hatch: a plain dashboard redeploy
 * re-runs this step and carries the original deployment's ref, and a deploy
 * hook is bound to a branch, so both are skipped again. The way to build a
 * skipped ref that cannot fail is to change what the branch itself carries —
 * merge into `preview`, or drop `ignoreCommand` and push. `docs/CI.md` weighs
 * the dashboard checkbox against that, where someone mid-incident will find it.
 *
 * @returns {{ build: boolean, reason: string }}
 */
export function evaluateDeployPolicy(env = {}) {
  const ref = typeof env.VERCEL_GIT_COMMIT_REF === "string" ? env.VERCEL_GIT_COMMIT_REF.trim() : "";
  const target = typeof env.VERCEL_ENV === "string" ? env.VERCEL_ENV.trim() : "";

  // A production deployment builds whatever ref it came from. This is a belt
  // over the list above: if the production branch is ever renamed, production
  // must not silently stop deploying because a constant here went stale.
  if (target === "production") return { build: true, reason: "production_target" };

  if (!ref) return { build: true, reason: "no_git_ref" };

  if (DEPLOYING_REFS.includes(ref)) return { build: true, reason: "deploying_ref" };

  return { build: false, reason: "non_deploying_ref" };
}
