// Solver v3 C2 EN-2 / IF2-14 and REC-2 — the effective engine and the record's
// `environment` stamp, both pure functions of an injected env. The resolver honours
// `OWT_SOLVER_ENGINE` only on the `preview` BRANCH deployment and locally; everything
// else answers C1's constant. Two sweeps hold the boundaries: one reader of the
// variable under app/**, and no client module imports this module.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { stripComments } from "../../../scripts/lib/strip-comments.mjs";
import { SOLVER_ENGINE } from "@/app/components/admin/solverEngine";
import { fairnessRecordEnvironment, resolveSolverEngine } from "../solverDeployment";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("resolveSolverEngine (C2 EN-2)", () => {
  it.each([
    ["the preview branch deployment", { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "preview" }],
    ["local development, VERCEL_ENV unset", {}],
    ["local development, VERCEL_ENV empty", { VERCEL_ENV: "" }],
  ])("honours an exact override on %s", (_label, base) => {
    expect(resolveSolverEngine({ ...base, OWT_SOLVER_ENGINE: "v3" })).toBe("v3");
    expect(resolveSolverEngine({ ...base, OWT_SOLVER_ENGINE: "v2" })).toBe("v2");
  });

  it.each([
    ["production", { VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main" }],
    ["production on a ref named preview", { VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "preview" }],
    ["the verify/service-readiness deployment", { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "verify/service-readiness" }],
    ["a preview deployment with no ref", { VERCEL_ENV: "preview" }],
    ["vercel dev (development is not «unset»)", { VERCEL_ENV: "development" }],
    ["an unknown VERCEL_ENV", { VERCEL_ENV: "staging" }],
  ])("answers the constant on %s", (_label, base) => {
    expect(resolveSolverEngine({ ...base, OWT_SOLVER_ENGINE: "v3" })).toBe(SOLVER_ENGINE);
  });

  it.each([undefined, "", "V3", "v3 ", "true"])("answers the constant for the non-exact value %j", (value) => {
    expect(resolveSolverEngine({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "preview", OWT_SOLVER_ENGINE: value })).toBe(
      SOLVER_ENGINE,
    );
  });
});

describe("fairnessRecordEnvironment (C2 REC-2)", () => {
  it.each([
    [{ VERCEL_ENV: "production" }, "production"],
    [{ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "verify/service-readiness" }, "preview"],
    [{ VERCEL_ENV: "development" }, "local"],
    [{ VERCEL_ENV: "" }, "local"],
    [{}, "local"],
    [{ VERCEL_ENV: "staging" }, "local"],
  ] as const)("%j → %s", (env, expected) => {
    expect(fairnessRecordEnvironment(env)).toBe(expected);
  });
});

function trackedAppSources(): string[] {
  return execFileSync("git", ["ls-files", "app"], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\n")
    .filter((f) => /\.(ts|tsx|mjs|js)$/.test(f) && !/(^|\/)__tests__\//.test(f) && !/\.test\./.test(f));
}

describe("the deployment resolvers' boundaries (C2 EN-2, C6 ENG-1)", () => {
  const sources = trackedAppSources();

  it("reads a real inventory", () => {
    expect(sources.length).toBeGreaterThan(100);
  });

  it("has exactly one reader of OWT_SOLVER_ENGINE under app/**", () => {
    const readers = sources.filter((f) =>
      stripComments(readFileSync(path.join(REPO_ROOT, f), "utf8")).includes("OWT_SOLVER_ENGINE"),
    );
    expect(readers).toEqual(["app/utils/solverDeployment.ts"]);
  });

  it("is imported by no client module", () => {
    const clientImporters = sources.filter((f) => {
      const code = stripComments(readFileSync(path.join(REPO_ROOT, f), "utf8"));
      return /^\s*["']use client["']/m.test(code) && /from\s+["'][^"']*solverDeployment["']/.test(code);
    });
    expect(clientImporters).toEqual([]);
  });
});
