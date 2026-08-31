#!/usr/bin/env node
// Measure what GitHub ACTUALLY delivers for a scheduled workflow, against what
// the workflow declares.
//
// This exists because the gap is not a one-off. Layer 1's schedule has been
// measured twice — 41 min median over 98 runs (2026-08-27), then 62 min median
// with a 3.3% delivery rate (2026-08-30, scheduled runs only) — and issue #25's
// acceptance criterion is that any change be re-measured the same way rather
// than assumed. A method that lives in a shell history is not the same way.
//
//   node scripts/measure-cron-delivery.mjs [--limit 60] [--since <ISO timestamp>]
//                                          [--workflow "<name>"] [--repo owner/name]
//
// The pure logic lives in `scripts/lib/cronDelivery.mjs` and is tested in
// `scripts/__tests__/cronDelivery.test.ts`. It was extracted after three review
// rounds found defects in this file's argument parsing and window arithmetic —
// every one in untested logic, every one biased toward the conclusion the person
// running it was hoping for.
//
// Reads only the GitHub run list through `gh`. Touches no Sanity data, sends
// nothing, and writes nothing.

import { execFileSync } from "node:child_process";
import {
  computeRates, declaredFloorMinutes, declaredPerHour, extractCron, intervals, parseArgs,
} from "./lib/cronDelivery.mjs";

const parsed = parseArgs(process.argv.slice(2));
if (!parsed.ok) {
  console.error(parsed.error);
  process.exit(1);
}
const { limit: LIMIT, since: SINCE, workflow: WORKFLOW, repo: REPO } = parsed.opts;

const gh = (args) => execFileSync("gh", args, { encoding: "utf8" });

let declaredExpr = null;
try {
  const b64 = gh(["api", `repos/${REPO}/contents/.github/workflows/flush-notifications.yml`, "--jq", ".content"]);
  declaredExpr = extractCron(Buffer.from(b64, "base64").toString("utf8"));
} catch {
  // Non-fatal — the rates are the point — but SAY SO. A silent skip left output
  // with no window, no expression and no sign anything was missing.
  declaredExpr = null;
}

const runs = JSON.parse(gh([
  "run", "list", "--workflow", WORKFLOW, "--repo", REPO,
  // SCHEDULED runs only. `workflow_dispatch` is enabled and the runbook tells
  // operators to fire it by hand, so counting those would inflate delivery and
  // shorten the median — biasing the measurement toward "it improved".
  "--event", "schedule",
  ...(SINCE ? ["--created", `>=${SINCE}`] : []),
  "--limit", String(LIMIT), "--json", "createdAt,conclusion",
])).map((r) => ({ at: new Date(r.createdAt).getTime(), conclusion: r.conclusion }));

if (runs.length < 2) {
  console.error(`Not enough runs to measure (${runs.length}).`);
  process.exit(1);
}

const times = runs.map((r) => r.at);
const sinceMs = SINCE ? new Date(SINCE).getTime() : null;
const rates = computeRates(times, { since: sinceMs, now: sinceMs ? Date.now() : null });
const gaps = intervals(times);
const q = (p) => gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p))];
const fmt = (m) => (m >= 60 ? `${(m / 60).toFixed(1)} h` : `${m.toFixed(1)} min`);
const rate = (r) => (r === null ? "n/a" : r.toFixed(2));

console.log(`workflow    : ${WORKFLOW}`);
console.log(`runs        : ${runs.length} scheduled` + (SINCE ? `  since ${SINCE}` : ""));
// F2 — ALWAYS print the window. Without it, an unbounded run gives a rate that is
// a pure function of --limit over a span the reader cannot see, and on this repo
// that span usually crosses a schedule change.
const first = new Date(Math.min(...times)).toISOString();
const last = new Date(Math.max(...times)).toISOString();
console.log(`window      : ${first} → ${SINCE ? "now" : last}  (${(SINCE ? rates.elapsedH : rates.steadyH).toFixed(1)} h)`);
if (declaredExpr) {
  const perHour = declaredPerHour(declaredExpr);
  const hours = SINCE ? rates.elapsedH : rates.steadyH;
  console.log(`declared    : ${declaredExpr}` +
    (perHour ? `  → ~${Math.round(hours * perHour)} runs asked for over ${hours.toFixed(1)} h` : ""));
} else {
  console.log(`declared    : (unavailable — could not read or parse the workflow)`);
}
if (!SINCE) {
  console.log(`\n!!! UNBOUNDED. This window may span a schedule change, in which case the`);
  console.log(`    rates below average two cadences. Pass --since <ISO timestamp> to bound it.`);
}

// `--limit` truncation used to be self-correcting, because the window shrank
// with the list. Under a bounded window it is not: a truncated list understates
// the elapsed rate with no visible sign.
if (SINCE && runs.length >= LIMIT) {
  console.log(`\n!!! RUN LIST TRUNCATED at --limit ${LIMIT}. gh returns the MOST RECENT N,`);
  console.log(`    so the oldest runs were dropped. Neither rate below is a measurement:`);
  console.log(`    the elapsed rate reads LOW, and the steady rate reads HIGH because it`);
  console.log(`    re-anchors to a later first run. Re-run with a larger --limit.`);
}

console.log(`\n>>> READ THESE, never delivery-%: asking for fewer ticks inflates it by`);
console.log(`    construction, without one email arriving sooner.\n`);
console.log(`    steady rate  : ${rate(rates.steadyRate)} runs/h   (n-1 over first→last run)`);
console.log(`                   ^ compare THIS against a recorded baseline; it is how`);
console.log(`                     the baseline was computed.`);
if (rates.elapsedRate !== null) {
  console.log(`    elapsed rate : ${rate(rates.elapsedRate)} runs/h   (n over ${SINCE}→now)`);
  console.log(`                   ^ what members actually got, INCLUDING the dead period`);
  console.log(`                     after the cadence changed. ${(rates.transientShare * 100).toFixed(0)}% of this window is`);
  console.log(`                     that transient, so it is not comparable to a`);
  console.log(`                     steady-state baseline until that share is small.`);
}
console.log(`    median gap   : ${fmt(q(0.5))}`);

console.log(`\nintervals   : n=${gaps.length}`);
console.log(`  minimum   : ${fmt(gaps[0])}`);
console.log(`  median    : ${fmt(q(0.5))}`);
console.log(`  p90       : ${fmt(q(0.9))}`);
console.log(`  maximum   : ${fmt(gaps.at(-1))}`);
const floor = declaredExpr ? declaredFloorMinutes(declaredExpr) : null;
// "Not reachable from the declared spacing" — `createdAt` is DELIVERY time, so a
// late tick followed by an on-time one can still produce a short gap.
const note = floor && floor > 10 ? `   (not reachable from the declared ${floor}-min spacing)` : "";
console.log(`  <= 10 min : ${gaps.filter((g) => g <= 10).length} / ${gaps.length}${note}`);
console.log(`  <= 20 min : ${gaps.filter((g) => g <= 20).length} / ${gaps.length}`);
console.log(`  > 60 min  : ${gaps.filter((g) => g > 60).length} / ${gaps.length}`);
const failed = runs.filter((r) => r.conclusion && r.conclusion !== "success").length;
console.log(`  non-success runs: ${failed} / ${runs.length}   (lateness is a SCHEDULING problem, not a failing job)`);
