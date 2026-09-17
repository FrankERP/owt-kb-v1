import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEPLOYING_REFS, evaluateDeployPolicy } from "../lib/deploy-branch-policy.mjs";
import { VERIFICATION_REF } from "../lib/deployment-coherence.mjs";

const repoRoot = resolve(__dirname, "../..");
const runner = resolve(repoRoot, "scripts/vercel-ignore-build.mjs");

/** Exit code of the Ignored Build Step as Vercel would observe it. */
function runPolicy(env: Record<string, string>): number | null {
  return spawnSync(process.execPath, [runner], {
    env: { ...process.env, VERCEL_GIT_COMMIT_REF: "", VERCEL_ENV: "", ...env },
    encoding: "utf8",
  }).status;
}

describe("evaluateDeployPolicy", () => {
  it("builds the three refs that own a deployment target", () => {
    for (const ref of ["main", "preview", "verify/service-readiness"]) {
      expect(evaluateDeployPolicy({ VERCEL_GIT_COMMIT_REF: ref })).toEqual({
        build: true,
        reason: "deploying_ref",
      });
    }
  });

  it("skips a feature branch — nothing reads its deployment", () => {
    // The push order verifies on dev-owt-backstage (the `preview` alias) and
    // `main`'s only required check is the GitHub Actions `gates` job, so this
    // build would have been read by no one while costing ~75 MB of the 10 GB
    // Function Storage quota until someone swept it.
    for (const ref of ["claude/motion-r5-admin", "docs/motion-r4-f3-release-record", "fix/x"]) {
      expect(evaluateDeployPolicy({ VERCEL_GIT_COMMIT_REF: ref })).toEqual({
        build: false,
        reason: "non_deploying_ref",
      });
    }
  });

  it("builds a production deployment whatever ref it names", () => {
    // The belt over DEPLOYING_REFS: renaming the production branch must not
    // silently stop production from deploying because a constant went stale.
    expect(evaluateDeployPolicy({ VERCEL_GIT_COMMIT_REF: "release", VERCEL_ENV: "production" })).toEqual(
      { build: true, reason: "production_target" },
    );
  });

  it("fails OPEN when there is no git ref", () => {
    // A CLI `vercel deploy`, a deploy hook, a dashboard redeploy. Refusing
    // these would turn a storage economy into an inability to ship.
    expect(evaluateDeployPolicy({})).toEqual({ build: true, reason: "no_git_ref" });
    expect(evaluateDeployPolicy({ VERCEL_GIT_COMMIT_REF: "   " })).toEqual({
      build: true,
      reason: "no_git_ref",
    });
  });
});

describe("the policy is actually wired", () => {
  // Without this, deleting `ignoreCommand` leaves the module as dead code and
  // every branch quietly starts deploying again with a green suite.
  it("vercel.json runs the Ignored Build Step script", () => {
    const cfg = JSON.parse(readFileSync(resolve(repoRoot, "vercel.json"), "utf8"));
    expect(cfg.ignoreCommand).toBe("node scripts/vercel-ignore-build.mjs");
  });

  // Asserting that the file CONTAINS both exit codes would pass with the two
  // branches swapped — and that single inversion cancels every build, `main`
  // included, discovered only at a release. So the runner is executed as a
  // process and judged on the code Vercel actually reads. This is also the only
  // place the runner runs end to end: tsc types `.mjs` loosely and the policy
  // tests above never leave the module.
  it("exits 1 (continue) for a deploying ref and 0 (ignore) for a working branch", () => {
    for (const ref of DEPLOYING_REFS) {
      expect(runPolicy({ VERCEL_GIT_COMMIT_REF: ref })).toBe(1);
    }
    expect(runPolicy({ VERCEL_GIT_COMMIT_REF: "claude/motion-r5-admin" })).toBe(0);
    expect(runPolicy({})).toBe(1);
    expect(runPolicy({ VERCEL_GIT_COMMIT_REF: "release", VERCEL_ENV: "production" })).toBe(1);
  });

  it("keeps the verification branch deploying, as deployment-coherence expects", () => {
    // Imported, not regex-scraped out of the source: an unanchored match would
    // read a stale `OLD_VERIFICATION_REF` during exactly the rename this guard
    // exists to catch, and pass while the live constant drifted out of the list.
    expect(DEPLOYING_REFS).toContain(VERIFICATION_REF);
  });
});
