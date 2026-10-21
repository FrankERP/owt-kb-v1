// Which CI jobs a pull request's diff can affect — the `scope` job's decision.
//
// `solver-v2` (the v2 CP-SAT suite, gcf/) takes ~10 of the `gates` run's ~10.5
// minutes, and since 2026-10-15 v2 is only the ROLLBACK engine (ADR-0056): a PR
// that does not touch gcf/ cannot change what that suite proves. So on a pull
// request, and only there, a job listed in SKIPPABLE_JOBS runs only when the PR's
// diff touches one of its paths. Pushes to `main`/`preview` and manual runs keep
// running everything, so a runner-image drift in GOLDEN_SCHEDULE still surfaces
// on the next push without blocking an unrelated PR. ADR-0064.
//
// Every doubt runs the suite: a non-PR event, a diff that could not be read, an
// empty diff. The job's `if:` runs it unless the output is exactly "false", and
// `gates` accepts a skipped job only when this decision said "false" for it
// (gatesVerdict in ci-layout.mjs). So a bug here can cost minutes, and the one
// way it can pass something untested is a path missing from the list below.
//
// NODE BUILTINS ONLY: `scripts/ci/ci-scope.mjs` runs on the runner's
// preinstalled Node, with no `npm ci`.

/** The id of the job that makes the decision; `gates` reads its outputs. */
export const SCOPE_JOB = "scope";

/**
 * Jobs that may be skipped on a pull request, each with the paths that make it
 * run. An entry ending in `/` is a directory prefix; anything else is one file
 * or a file-name prefix (`scripts/lib/ci-`).
 *
 * solver-v2: its tree (code, tests, requirements — the suite reads nothing outside
 * it), every workflow (how and where any job runs), and the CI machinery that
 * decides and judges the skip itself.
 */
export const SKIPPABLE_JOBS = Object.freeze({
  "solver-v2": Object.freeze(["gcf/", ".github/", "scripts/ci/", "scripts/lib/ci-"]),
});

/**
 * The diff the runner reads: the PR's merge commit against its first parent (the
 * base branch tip it was merged onto), so it is exactly what the PR would land.
 * `--no-renames`, so a file moved OUT of gcf/ lists its old path too — with rename
 * detection, `--name-only` prints only the new one.
 */
export const DIFF_ARGS = Object.freeze(["diff", "--no-renames", "--name-only", "HEAD^1", "HEAD"]);

const touches = (path, prefixes) => prefixes.some((p) => path.startsWith(p));

/**
 * @param {{ event: string | undefined, changed: string[] | null }} input
 *   `changed` is the PR's changed paths, or null when the diff could not be read.
 * @returns {{ outputs: Record<string, "true" | "false">, lines: string[] }}
 */
export function scopeDecision({ event, changed }) {
  const outputs = {};
  const lines = [];
  for (const [job, prefixes] of Object.entries(SKIPPABLE_JOBS)) {
    let run = true;
    let why;
    if (event !== "pull_request") why = `event is ${event || "unknown"}, not pull_request — everything runs`;
    else if (!Array.isArray(changed)) why = "the diff could not be read — runs, to be safe";
    else if (changed.length === 0) why = "the diff is empty — runs, to be safe";
    else {
      const hits = changed.filter((p) => touches(p, prefixes));
      run = hits.length > 0;
      why = run
        ? `the PR touches ${hits.slice(0, 5).join(", ")}${hits.length > 5 ? ` and ${hits.length - 5} more` : ""}`
        : `the PR touches none of ${prefixes.join(", ")} (${changed.length} file(s) changed) — skipped`;
    }
    outputs[job] = run ? "true" : "false";
    lines.push(`${job}: ${run ? "RUN" : "SKIP"} — ${why}`);
  }
  return { outputs, lines };
}
