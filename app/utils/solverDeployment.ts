// app/utils/solverDeployment.ts
//
// Two pure functions of an INJECTED environment (the `canonicalOrigin(env)` precedent,
// `app/mcp/oauth/origin.ts`), kept apart from `solverEngine.ts`, whose constant stays
// import-free (solver v3 C1):
//
//   · `resolveSolverEngine(env)` — the EFFECTIVE engine (spec C2 EN-2, IF2-14). The
//     ONE reader of `OWT_SOLVER_ENGINE` under `app/**` (`solverDeployment.test.ts`
//     sweeps for a second). It honours the override ONLY on the `preview` branch
//     deployment (`VERCEL_ENV === "preview"` AND `VERCEL_GIT_COMMIT_REF === "preview"`,
//     so `verify/service-readiness`, also `VERCEL_ENV=preview`, never does) and in
//     local development (`VERCEL_ENV` unset or empty). Production, `development` and
//     every other value answer the constant: a stale production variable can never
//     change the engine (parent A1).
//   · `fairnessRecordEnvironment(env)` — REC-2's `environment` stamp: `production` /
//     `preview`, anything else `local`. NOT the same mapping as the engine's: here
//     `development` is `local`, there it is not «unset».
//
// NEUTRAL (ADR-0028): no "use client" and no `server-only` — C4's `tsx` script stamps
// `environment` through it — but no client module may import it: clients learn the
// engine from the GET's `engine` (IF2-8) or C6's server-resolved prop. Guarded by
// `solverDeployment.test.ts`. The variable's entry is in docs/SECRETS.md.

import { SOLVER_ENGINE } from "@/app/components/admin/solverEngine";

export type SolverEngine = "v2" | "v3";

type Env = Readonly<Record<string, string | undefined>>;

export function resolveSolverEngine(env: Env): SolverEngine {
  const override = env.OWT_SOLVER_ENGINE;
  if (override !== "v2" && override !== "v3") return SOLVER_ENGINE;
  const vercelEnv = env.VERCEL_ENV;
  const previewBranch = vercelEnv === "preview" && env.VERCEL_GIT_COMMIT_REF === "preview";
  const local = vercelEnv === undefined || vercelEnv === "";
  return previewBranch || local ? override : SOLVER_ENGINE;
}

export function fairnessRecordEnvironment(env: Env): "production" | "preview" | "local" {
  if (env.VERCEL_ENV === "production") return "production";
  if (env.VERCEL_ENV === "preview") return "preview";
  return "local";
}
