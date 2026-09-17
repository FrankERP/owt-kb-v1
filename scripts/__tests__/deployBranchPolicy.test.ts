import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEPLOYING_REFS, evaluateDeployPolicy } from "../lib/deploy-branch-policy.mjs";

const repoRoot = resolve(__dirname, "../..");

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

  it("the runner it points at exists and imports the policy", () => {
    const runner = readFileSync(resolve(repoRoot, "scripts/vercel-ignore-build.mjs"), "utf8");
    expect(runner).toContain("./lib/deploy-branch-policy.mjs");
    // Vercel inverts the usual contract: 0 ignores the build, 1 continues it.
    expect(runner).toContain("process.exit(1)");
    expect(runner).toContain("process.exit(0)");
  });

  it("keeps the verification branch deploying, as deployment-coherence expects", () => {
    const coherence = readFileSync(resolve(repoRoot, "scripts/lib/deployment-coherence.mjs"), "utf8");
    const declared = /VERIFICATION_REF = "([^"]+)"/.exec(coherence)?.[1];
    expect(declared).toBeDefined();
    expect(DEPLOYING_REFS).toContain(declared);
  });
});
