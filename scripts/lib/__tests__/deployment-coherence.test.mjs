import { describe, expect, it } from "vitest";
import {
  PRODUCTION_DATASET,
  PRODUCTION_PROJECT_ID,
  VERIFICATION_DATASET,
  VERIFICATION_PROJECT_ID,
  VERIFICATION_REF,
  assertDeploymentCoherence,
  evaluateDeploymentCoherence,
} from "../deployment-coherence.mjs";

const verifyEnv = {
  VERCEL_GIT_COMMIT_REF: VERIFICATION_REF,
  NEXT_PUBLIC_SANITY_PROJECT_ID: VERIFICATION_PROJECT_ID,
  NEXT_PUBLIC_SANITY_DATASET: VERIFICATION_DATASET,
};
const prodEnv = {
  VERCEL_GIT_COMMIT_REF: "main",
  NEXT_PUBLIC_SANITY_PROJECT_ID: PRODUCTION_PROJECT_ID,
  NEXT_PUBLIC_SANITY_DATASET: PRODUCTION_DATASET,
};

describe("the two coherent builds are allowed", () => {
  it("verification branch against the isolated environment", () => {
    expect(evaluateDeploymentCoherence(verifyEnv)).toMatchObject({ ok: true, reason: "verification_ref_isolated" });
  });

  it("main against production", () => {
    expect(evaluateDeploymentCoherence(prodEnv)).toMatchObject({ ok: true, reason: "ordinary_build" });
  });

  it("preview against production", () => {
    expect(evaluateDeploymentCoherence({ ...prodEnv, VERCEL_GIT_COMMIT_REF: "preview" }).ok).toBe(true);
  });

  it("a local build with no git ref asserts nothing", () => {
    expect(evaluateDeploymentCoherence({}).ok).toBe(true);
    expect(evaluateDeploymentCoherence({ NEXT_PUBLIC_SANITY_DATASET: PRODUCTION_DATASET }).ok).toBe(true);
    // Even an isolated-looking local build is allowed: without a ref there is no
    // deployment to protect, and blocking it would break ordinary development.
    expect(evaluateDeploymentCoherence({ NEXT_PUBLIC_SANITY_DATASET: VERIFICATION_DATASET }).ok).toBe(true);
  });
});

describe("direction 1 — the verification branch must never build against production", () => {
  it("refuses the production dataset", () => {
    const v = evaluateDeploymentCoherence({ ...verifyEnv, NEXT_PUBLIC_SANITY_DATASET: PRODUCTION_DATASET });
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("verification_ref_targets_production");
    expect(v.message).toMatch(/MUTATES/);
  });

  it("refuses the production project even with the isolated dataset name", () => {
    const v = evaluateDeploymentCoherence({ ...verifyEnv, NEXT_PUBLIC_SANITY_PROJECT_ID: PRODUCTION_PROJECT_ID });
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("verification_ref_targets_production");
  });

  it("refuses when the branch-scoped variables simply did not apply", () => {
    for (const env of [
      { VERCEL_GIT_COMMIT_REF: VERIFICATION_REF },
      { ...verifyEnv, NEXT_PUBLIC_SANITY_DATASET: "" },
      { ...verifyEnv, NEXT_PUBLIC_SANITY_PROJECT_ID: "" },
      { ...verifyEnv, NEXT_PUBLIC_SANITY_DATASET: "something-else" },
    ]) {
      const v = evaluateDeploymentCoherence(env);
      expect(v.ok, JSON.stringify(env)).toBe(false);
      expect(["verification_ref_misconfigured", "verification_ref_targets_production"]).toContain(v.reason);
    }
  });
});

describe("direction 2 — no other branch may serve the isolated dataset", () => {
  it("refuses main against the isolated dataset", () => {
    const v = evaluateDeploymentCoherence({ ...prodEnv, NEXT_PUBLIC_SANITY_DATASET: VERIFICATION_DATASET });
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("non_verification_ref_targets_isolated");
    expect(v.message).toMatch(/synthetic fixtures to real users/);
  });

  it("refuses preview against the isolated project", () => {
    const v = evaluateDeploymentCoherence({
      VERCEL_GIT_COMMIT_REF: "preview",
      NEXT_PUBLIC_SANITY_PROJECT_ID: VERIFICATION_PROJECT_ID,
      NEXT_PUBLIC_SANITY_DATASET: PRODUCTION_DATASET,
    });
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("non_verification_ref_targets_isolated");
  });

  it("refuses a lookalike branch name", () => {
    // Only the exact ref is the verification branch; a near-miss must not inherit
    // permission to touch the isolated environment.
    const v = evaluateDeploymentCoherence({ ...verifyEnv, VERCEL_GIT_COMMIT_REF: "verify/service-readiness-2" });
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("non_verification_ref_targets_isolated");
  });
});

describe("assertDeploymentCoherence", () => {
  it("returns the verdict when coherent", () => {
    expect(assertDeploymentCoherence(verifyEnv).ok).toBe(true);
  });

  it("throws with the reason and guidance when incoherent", () => {
    expect(() => assertDeploymentCoherence({ ...verifyEnv, NEXT_PUBLIC_SANITY_DATASET: PRODUCTION_DATASET })).toThrow(
      /verification_ref_targets_production/,
    );
  });
});
