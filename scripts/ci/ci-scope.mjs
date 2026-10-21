#!/usr/bin/env node
// The `scope` job's only step — wired from .github/workflows/ci.yml, which passes
// the event name in EVENT_NAME through `env:`.
//
// Reads the PR's changed files (the merge commit against its first parent; the
// checkout fetches depth 2 for that), decides which skippable jobs run
// (scopeDecision), and writes one `<job>=true|false` line per job to
// $GITHUB_OUTPUT. A diff git cannot produce becomes "run everything", never a
// skip. Without $GITHUB_OUTPUT it exits 1: `scope` goes red, the skippable jobs
// are skipped by their failed `needs`, and `gates` refuses the run.
//
// Node builtins only, so the runner's preinstalled Node runs it. ADR-0064.

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { DIFF_ARGS, scopeDecision } from "../lib/ci-scope.mjs";

const event = process.env.EVENT_NAME;
let changed = null;
if (event === "pull_request") {
  try {
    const out = execFileSync("git", DIFF_ARGS, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    changed = out.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch (e) {
    console.log(`::warning::scope: git ${DIFF_ARGS.join(" ")} failed (${String(e.message).split("\n")[0]})`);
  }
}

const { outputs, lines } = scopeDecision({ event, changed });
for (const line of lines) console.log(line);

const file = process.env.GITHUB_OUTPUT;
if (!file) {
  console.log("::error::scope: GITHUB_OUTPUT is not set, so the decision cannot reach the jobs");
  process.exit(1);
}
appendFileSync(file, Object.entries(outputs).map(([job, v]) => `${job}=${v}\n`).join(""));
