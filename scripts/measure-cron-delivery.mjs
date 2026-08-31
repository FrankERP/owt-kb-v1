#!/usr/bin/env node
// Measure what GitHub ACTUALLY delivers for a scheduled workflow, against what
// the workflow declares.
//
// This exists because the gap is not a one-off. Layer 1's schedule has been
// measured twice — 41 min median over 98 runs (2026-08-27), then 62 min median
// with a 3.3% delivery rate (2026-08-30, scheduled runs only) — and issue #25's acceptance criterion
// is that any change be re-measured the same way rather than assumed. A method
// that lives in a shell history is not the same way; this is.
//
//   node scripts/measure-cron-delivery.mjs [--limit 60] [--since <ISO timestamp>]
//                                          [--workflow "<name>"] [--repo owner/name]
//
// Reads only the GitHub run list through `gh`. Touches no Sanity data, sends
// nothing, and writes nothing.

import { execFileSync } from "node:child_process";

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : process.argv[i + 1];
};
const LIMIT = Number(arg("--limit", "60"));
if (!Number.isFinite(LIMIT) || LIMIT < 2) {
  console.error("--limit needs a number >= 2");
  process.exit(1);
}
const WORKFLOW = arg("--workflow", "Flush notification outbox");
const REPO = arg("--repo", "FrankERP/owt-kb-v1");
// `--since YYYY-MM-DD` bounds the window to one cadence. Issue #25's experiment
// begins at the `main` MERGE, because GitHub runs `schedule` only on the default
// branch — so without this, a --limit reaching back past that merge silently
// averages the old and new cadences into one runs/hour while the declared-cron
// denominator reads only the new expression. The bound belongs in the tool, not
// in a sentence someone has to remember.
const SINCE = arg("--since", null);
for (const [flag, val] of [["--workflow", WORKFLOW], ["--repo", REPO], ["--since", SINCE]]) {
  if (val !== null && (val === undefined || String(val).startsWith("--"))) {
    console.error(`${flag} needs a value`);
    process.exit(1);
  }
}
// REJECT UNKNOWN FLAGS, loudly. `arg()` matches only the space-separated form,
// so `--since=2026-08-30` used to parse as nothing at all: the bound silently
// vanished and the measurement averaged BOTH cadences into one runs/hour —
// reading as an improvement. A measurement tool that ignores an argument it does
// not understand is worse than one that refuses to run.
const KNOWN = new Set(["--limit", "--since", "--workflow", "--repo"]);
for (const tok of process.argv.slice(2)) {
  if (tok.startsWith("--") && !KNOWN.has(tok)) {
    console.error(`unknown argument: ${tok}\n(note: use "--since VALUE", not "--since=VALUE")`);
    process.exit(1);
  }
}

// The DECLARED cadence, parsed from the workflow rather than assumed, so the
// expected-run count cannot silently drift from the file it is judging.
function declaredMinutes() {
  const yml = execFileSync("gh", ["api", `repos/${REPO}/contents/.github/workflows/flush-notifications.yml`,
    "--jq", ".content"], { encoding: "utf8" });
  const text = Buffer.from(yml, "base64").toString("utf8");
  const line = text.split("\n").find((l) => /^\s*-\s*cron:/.test(l));
  if (!line) return null;
  const expr = line.split('"')[1] ?? line.split("'")[1];
  const minuteField = expr?.trim().split(/\s+/)[0];
  if (!minuteField) return null;
  if (minuteField.startsWith("*/")) return { expr, perHour: 60 / Number(minuteField.slice(2)) };
  if (minuteField.includes(",")) return { expr, perHour: minuteField.split(",").length };
  if (minuteField === "*") return { expr, perHour: 60 };
  return { expr, perHour: 1 };
}

const raw = execFileSync("gh", [
  "run", "list", "--workflow", WORKFLOW, "--repo", REPO,
  // SCHEDULED runs only. `workflow_dispatch` is enabled and the runbook tells
  // operators to fire it by hand, so counting those would inflate delivery and
  // shorten the median — biasing the measurement toward "it improved".
  "--event", "schedule",
  ...(SINCE ? ["--created", `>=${SINCE}`] : []),
  "--limit", String(LIMIT), "--json", "createdAt,conclusion",
], { encoding: "utf8" });

const runs = JSON.parse(raw)
  .map((r) => ({ at: new Date(r.createdAt), conclusion: r.conclusion }))
  .sort((a, b) => a.at - b.at);

if (runs.length < 2) {
  console.error(`Not enough runs to measure (${runs.length}).`);
  process.exit(1);
}

const gaps = runs.slice(1).map((r, i) => (r.at - runs[i].at) / 60000).sort((a, b) => a - b);
const q = (p) => gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p))];
// When a bound is given, the window is FROM THE BOUND TO NOW — not first-run to
// last-run. Anchoring to the first delivered run silently deletes the dead period
// after a cadence change: 5.75 h elapsed between the 2026-08-30 merge and the
// first scheduled run, and excluding it printed 0.43 runs/h where the true
// elapsed rate was 0.29. That gap is the thing being measured, not noise before
// the measurement starts.
const windowStart = SINCE ? new Date(SINCE) : runs[0].at;
const windowEnd = SINCE ? new Date() : runs.at(-1).at;
const windowH = (windowEnd - windowStart) / 3_600_000;
const declared = declaredMinutes();

const fmt = (m) => (m >= 60 ? `${(m / 60).toFixed(1)} h` : `${m.toFixed(1)} min`);
console.log(`workflow    : ${WORKFLOW}`);
console.log(`window      : ${windowStart.toISOString()} → ${windowEnd.toISOString()}  (${windowH.toFixed(1)} h)${SINCE ? "  [bounded]" : "  [first run → last run]"}`);
if (declared) {
  const expected = Math.round(windowH * declared.perHour);
  console.log(`declared    : ${declared.expr}  → ~${expected} runs expected`);
  console.log(`delivered   : ${runs.length} runs  → ${((runs.length / expected) * 100).toFixed(1)}% of what was asked`);
} else {
  console.log(`declared    : (could not parse the cron expression)`);
}
// THE METRIC THAT DECIDES THE EXPERIMENT. Delivery-% is only comparable within
// one cadence: asking for less raises it arithmetically without a single email
// arriving sooner. Runs-per-hour and the median interval are what a member
// actually experiences, so those are the acceptance numbers.
console.log(`\n>>> COMPARE THESE ACROSS CADENCES, not the % above:`);
console.log(`    runs per hour  : ${(runs.length / windowH).toFixed(2)}`);
console.log(`    median interval: ${fmt(q(0.5))}`);
console.log(`intervals   : n=${gaps.length}`);
console.log(`  minimum   : ${fmt(gaps[0])}`);
console.log(`  median    : ${fmt(q(0.5))}`);
console.log(`  p90       : ${fmt(q(0.9))}`);
console.log(`  maximum   : ${fmt(gaps.at(-1))}`);
// BOTH buckets. `<= 10` is unreachable under a 15-minute floor, but the recorded
// history in docs/NOTIFICATIONS.md has a `<= 10 min` row, and a tool that cannot
// reproduce the table it is compared against is not the same method.
const floorNote = declared && declared.perHour <= 4 ? "   (historical row; unreachable at this cadence)" : "";
console.log(`  <= 10 min : ${gaps.filter((g) => g <= 10).length} / ${gaps.length}${floorNote}`);
console.log(`  <= 20 min : ${gaps.filter((g) => g <= 20).length} / ${gaps.length}`);
console.log(`  > 60 min  : ${gaps.filter((g) => g > 60).length} / ${gaps.length}`);
const failed = runs.filter((r) => r.conclusion && r.conclusion !== "success").length;
console.log(`  non-success runs: ${failed} / ${runs.length}   (lateness is a SCHEDULING problem, not a failing job)`);
