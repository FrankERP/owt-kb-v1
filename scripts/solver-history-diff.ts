/**
 * R11's diff gate: Frank's exported browser history against the server-derived
 * one, every difference classified explained / unverified / bug, plus the solve
 * runs with `objective_skipped` recorded for every run.
 *
 *   npx tsx scripts/solver-history-diff.ts \
 *     --bundle ~/owt-private/p2-history/bundle-<date>.json [--bundle <other profile>]… \
 *     [--export ~/owt-private/p2-history/export-<browser>-<profile>-<date>.json]… \
 *     [--solve-request ~/owt-private/p2-history/solve-request-<NEXT>.json [--solve-month YYYY-MM]] \
 *     --out ~/owt-private/p2-history [--seed 42] [--runs 2]
 *
 * Spec: docs/superpowers/specs/2026-09-23-solver-history-derivation-design.md (R11, R13)
 * Plan: docs/superpowers/plans/2026-09-25-owt-mcp-p2-solver-history.md (step 6, Gates A–C)
 *
 * Frank runs it on his own machine (plan Q3). Every input and the report hold
 * member names and this repository is public, so it refuses any path inside the
 * repository. It reads no Sanity data and no secret: the derived side is the
 * bundle Gate B's snippet captured from the admin route. It spawns the local
 * solver (`OWT_SOLVER_PYTHON`, default the `owt-roles` conda env) only after
 * checking that its ortools is the `gcf/requirements.txt` pin.
 *
 * Exit codes: 0 — report written (read its gate line); 2 — refused; 1 — failed.
 */
import path from "node:path";

import { defaultRunProcess, runSolverHistoryDiff } from "./lib/solverHistoryDiffRun";

runSolverHistoryDiff(process.argv.slice(2), {
  repoRoot: path.resolve(__dirname, ".."),
  solverPython: process.env.OWT_SOLVER_PYTHON,
  runProcess: defaultRunProcess,
  now: () => new Date(),
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  platform: process.platform,
}).then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    process.stderr.write(`solver-history-diff: failed: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  },
);
