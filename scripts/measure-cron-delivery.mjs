#!/usr/bin/env node
// Measure what GitHub ACTUALLY delivers for a scheduled workflow, against what
// the workflow declares.
//
// This exists because the gap is not a one-off. Layer 1's schedule has been
// measured twice — 41 min median over 98 runs (2026-08-27), then 71 min median
// with a 3.4% delivery rate (2026-08-30) — and issue #25's acceptance criterion
// is that any change be re-measured the same way rather than assumed. A method
// that lives in a shell history is not the same way; this is.
//
//   node scripts/measure-cron-delivery.mjs [--limit 60] [--workflow "<name>"]
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
const windowH = (runs.at(-1).at - runs[0].at) / 3_600_000;
const declared = declaredMinutes();

const fmt = (m) => (m >= 60 ? `${(m / 60).toFixed(1)} h` : `${m.toFixed(1)} min`);
console.log(`workflow    : ${WORKFLOW}`);
console.log(`window      : ${runs[0].at.toISOString()} → ${runs.at(-1).at.toISOString()}  (${windowH.toFixed(1)} h)`);
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
console.log(`  <= 20 min : ${gaps.filter((g) => g <= 20).length} / ${gaps.length}`);
console.log(`  > 60 min  : ${gaps.filter((g) => g > 60).length} / ${gaps.length}`);
const failed = runs.filter((r) => r.conclusion && r.conclusion !== "success").length;
console.log(`  non-success runs: ${failed} / ${runs.length}   (lateness is a SCHEDULING problem, not a failing job)`);
