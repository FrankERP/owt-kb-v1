// scripts/reconstruct-fairness-months.mjs
//
// Solver v3 C4: rebuild the fairness records (`fairnessMonth`) of PAST months planned
// before any v3 writer existed — from today's Tipo, join months, the cadence setting and
// Frank's corrections — for Frank to review, then write exactly what he approved.
// Spec: docs/superpowers/specs/2026-10-05-solver-v3-c4-record-reconstruction-design.md
// Runbook: docs/SOLVER_AND_INFRA.md, «Fairness-record reconstruction».
//
// RUN IT WITH tsx — it imports C2's TypeScript modules (D1):
//   Dry run (the default; no Sanity write; the table and the plan go to --out):
//     npx tsx --env-file=.env.local scripts/reconstruct-fairness-months.mjs --months 2026-08,2026-09 --out ~/owt-private/c4 [--overrides <file>] [--preview-run YYYY-MM]
//   Apply — ONLY after Frank's explicit consent in chat to THAT plan's fingerprint (R19):
//     npx tsx --env-file=.env.local scripts/reconstruct-fairness-months.mjs --apply --plan <run folder>/plan.json --fingerprint <hex> --out ~/owt-private/c4 [--overrides <same file>]
//   Rollback — a dry run first, then the same consent:
//     … --rollback --months 2026-08 --out ~/owt-private/c4
//     … --rollback --apply --plan <run folder>/plan.json --fingerprint <hex> --out ~/owt-private/c4
//
// This file is the ONE caller of C2's write executor outside app/ (C2 IF2-23): every
// create, replace and delete of a record goes through it with actor `reconstruction`,
// which is why the protected-read audit lists this file in OPERATOR_TOOLING_ALLOWLIST.
// It builds the two Sanity clients, after the core has checked both tokens, and nothing
// else; the rest is scripts/lib/reconstructRun.ts.
//
// Exit codes: 0 done · 2 refused before any write · 1 failed or partial (run the dry run
// again before any repair).

import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@sanity/client";

import { executeFairnessMonthWrites } from "../app/utils/fairnessMonthWriteRequest.ts";
import { errorClass, runReconstruction } from "./lib/reconstructRun.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

runReconstruction(process.argv.slice(2), {
  env: process.env,
  repoRoot,
  platform: process.platform,
  now: () => new Date(),
  createClient: (config) => createClient(config),
  execute: (input) => executeFairnessMonthWrites(input),
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
}).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    // R12: the class and status only — never a message that could carry a request body or a name.
    process.stderr.write(`reconstruct-fairness-months: falló: ${errorClass(error)}\n`);
    process.exitCode = 1;
  },
);
