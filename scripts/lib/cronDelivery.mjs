// Pure logic behind `scripts/measure-cron-delivery.mjs`, extracted so it can be
// TESTED. That is not tidiness: three consecutive review rounds found defects in
// this file's argument parsing and window arithmetic, every one of them in
// untested pure logic, and every one biased toward the conclusion the person
// running the tool was hoping for. A measurement that decides a real decision
// needs the same treatment as the code it measures.

/** Flags the CLI understands. Anything else is an error, not a shrug. */
export const KNOWN_FLAGS = ["--limit", "--since", "--workflow", "--repo"];

/**
 * Parse argv. Returns `{ ok: true, opts }` or `{ ok: false, error }`.
 *
 * Rejects, loudly, every form that used to parse as "no bound at all":
 * `--since=X` (the equals form `arg()` never matched), `-since X` (single dash),
 * and a bare positional. Each of those silently produced an UNBOUNDED window
 * that averaged two cadences into one rate and read as an improvement.
 */
/**
 * @param {string[]} argv
 * @param {Record<string, unknown>} [defaults]
 */
export function parseArgs(argv, defaults = {}) {
  const opts = {
    limit: 60,
    since: null,
    workflow: "Flush notification outbox",
    repo: "FrankERP/owt-kb-v1",
    ...defaults,
  };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith("-")) return { ok: false, error: `unexpected argument: ${tok}` };
    if (!tok.startsWith("--") || !KNOWN_FLAGS.includes(tok)) {
      const hint = tok.includes("=") ? '\n(use "--since VALUE", not "--since=VALUE")' : "";
      return { ok: false, error: `unknown argument: ${tok}\nknown: ${KNOWN_FLAGS.join(", ")}${hint}` };
    }
    const val = argv[++i];
    if (val === undefined || val.startsWith("--")) return { ok: false, error: `${tok} needs a value` };
    if (tok === "--limit") {
      const n = Number(val);
      // Integer, because `gh --limit 2.5` is a Go parse error thrown out of
      // execFileSync as an uncaught stack rather than a message.
      if (!Number.isInteger(n) || n < 2) return { ok: false, error: "--limit needs a whole number >= 2" };
      opts.limit = n;
    } else if (tok === "--since") {
      const err = validateSince(val);
      if (err) return { ok: false, error: err };
      opts.since = val;
    } else if (tok === "--workflow") opts.workflow = val;
    else opts.repo = val;
  }
  return { ok: true, opts };
}

/**
 * `--since` must be unambiguous about its timezone. A time-bearing value with no
 * `Z` or offset is read as LOCAL by JavaScript and as UTC by GitHub's `created:`
 * filter — six hours apart in America/Mexico_City, which shortened one window by
 * 30% and moved the rate 43% toward the hypothesis.
 */
export function validateSince(val) {
  if (Number.isNaN(new Date(val).getTime())) return `--since is not a date: ${val}`;
  // Require the ISO shape first. `2026-8-3` and `2026/08/30` parse fine and carry
  // no `T`, so a `hasTime` check alone waves them past — and JS reads them as
  // LOCAL midnight while GitHub reads UTC, the same six hours in the same
  // flattering direction.
  if (!/^\d{4}-\d{2}-\d{2}(T|$)/.test(val)) {
    return `--since must be YYYY-MM-DD or YYYY-MM-DDThh:mm:ssZ, got: ${val}`;
  }
  const hasTime = val.includes("T") || val.includes(" ");
  if (hasTime && !/(Z|[+-]\d{2}:?\d{2})$/.test(val)) {
    return `--since has a time but no timezone: ${val}\nuse an explicit UTC form, e.g. 2026-08-30T07:01:04Z`;
  }
  return null;
}

/**
 * Rates over a set of run timestamps.
 *
 * TWO rates, deliberately, because they answer different questions and the
 * decision needs both:
 *
 *   · `steadyRate` = (n-1) / (last - first). Conditioning on both endpoints
 *     being events, `n/T` overstates by n/(n-1) — 25% at n=5. This is the
 *     estimator the recorded baseline was computed with, so it is the one a
 *     threshold derived from that baseline may be compared against.
 *   · `elapsedRate` = n / (bound - now). Includes the dead period after a
 *     cadence change, which `steadyRate` deletes by anchoring to the first
 *     delivered run. It answers "what did members actually get", and it is the
 *     honest one for a transient — but it is NOT comparable to a steady-state
 *     baseline until the transient is a small share of the window.
 */
/**
 * @param {number[]} runTimes epoch ms
 * @param {{ since?: number | null, now?: number | null }} [bounds]
 */
export function computeRates(runTimes, { since = null, now = null } = {}) {
  const ts = [...runTimes].sort((a, b) => a - b);
  if (ts.length < 2) return null;
  const steadyH = (ts.at(-1) - ts[0]) / 3_600_000;
  const steadyRate = steadyH > 0 ? (ts.length - 1) / steadyH : null;
  let elapsedRate = null;
  let elapsedH = null;
  let transientShare = null;
  if (since && now) {
    elapsedH = (now - since) / 3_600_000;
    if (elapsedH > 0) {
      elapsedRate = ts.length / elapsedH;
      // How much of the window is lead-in before the first run plus the trailing
      // partial interval — the part that is transient rather than cadence.
      transientShare = ((ts[0] - since) + (now - ts.at(-1))) / (now - since);
    }
  }
  return { steadyH, steadyRate, elapsedH, elapsedRate, transientShare, runs: ts.length };
}

/** Intervals between runs, in minutes, ascending. */
export function intervals(runTimes) {
  const ts = [...runTimes].sort((a, b) => a - b);
  return ts.slice(1).map((t, i) => (t - ts[i]) / 60000).sort((a, b) => a - b);
}

/** Runs per hour the cron expression ASKS for. Null when it cannot be parsed. */
export function declaredPerHour(cronExpr) {
  const minute = String(cronExpr ?? "").trim().split(/\s+/)[0];
  if (!minute) return null;
  if (minute === "*") return 60;
  if (minute.startsWith("*/")) {
    const n = Number(minute.slice(2));
    return Number.isFinite(n) && n > 0 ? 60 / n : null;
  }
  if (/^\d+(,\d+)*$/.test(minute)) return minute.split(",").length;
  return null;
}

/** The smallest gap the DECLARED spacing can produce, in minutes. */
export function declaredFloorMinutes(cronExpr) {
  const minute = String(cronExpr ?? "").trim().split(/\s+/)[0];
  if (minute?.startsWith("*/")) return Number(minute.slice(2)) || null;
  if (/^\d+(,\d+)*$/.test(minute ?? "")) {
    const mins = minute.split(",").map(Number).sort((a, b) => a - b);
    if (mins.length === 1) return 60;
    const gaps = mins.slice(1).map((m, i) => m - mins[i]);
    gaps.push(60 - mins.at(-1) + mins[0]);
    return Math.min(...gaps);
  }
  return null;
}

/** Find the `- cron:` line, never a comment quoting one. */
export function extractCron(workflowText) {
  const line = String(workflowText).split("\n").find((l) => /^\s*-\s*cron:/.test(l));
  if (!line) return null;
  return (line.split('"')[1] ?? line.split("'")[1] ?? "").trim() || null;
}
