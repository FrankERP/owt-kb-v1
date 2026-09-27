// scripts/lib/solverHistoryDiffRun.ts
//
// The diff CLI's working half (R11, R13; plan step 6): arguments, the refusal of
// every path inside the repository, reading the bundles and exports, the
// missing-target refusal, the ortools pin check, the local solve runs, and
// writing the report. `scripts/solver-history-diff.ts` is only its entry point.
//
// It imports no Sanity client and reads no secret: the derived side comes from
// the files Frank captured with Gate B's snippet (spec R11: "the diff consumes
// the builder's output … never a new Sanity-reading script"). Its only
// environment input is `OWT_SOLVER_PYTHON`, the interpreter path the solve route
// already uses, which the entry point passes in.
//
// Every process call goes through an injected `RunProcess`, so the tests never
// spawn the solver. `gcf/**` is invoked here, never edited.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { historyForRequest } from "../../app/components/admin/plannerModel";
import type { SolverHistoryEntry } from "../../app/utils/solverHistory";

import {
  SESSION_GAP_MINUTES,
  classifyHistoryDiff,
  describeJsonError,
  mergeBundles,
  neededTargets,
  parseBundle,
  parseExport,
  parseTargetKey,
  type HistoryDiffResult,
  type MergedTarget,
  type ParsedBundle,
} from "./solverHistoryDiff";
import {
  aggregateTotals,
  gateOf,
  r11Incomplete,
  renderMarkdown,
  stdoutLines,
  summarizeRun,
  type ConsistencyCheck,
  type PrimaryReport,
  type ReportModel,
  type RunSummary,
  type SolveSection,
} from "./solverHistoryDiffReport";

/** The solve route's own default (`app/api/admin/solve/route.ts`): the `owt-roles` conda env. */
export const DEFAULT_SOLVER_PYTHON = "/opt/homebrew/Caskroom/miniforge/base/envs/owt-roles/bin/python3";

export const USAGE =
  "usage: npx tsx scripts/solver-history-diff.ts --bundle <file> [--bundle <file>]… [--export <file>]… " +
  "[--solve-request <file> [--solve-month YYYY-MM]] --out <dir> [--seed 42] [--runs 2]";

// ─── Arguments ───────────────────────────────────────────────────────────────

export interface CliArgs {
  bundles: string[];
  exports: string[];
  solveRequest?: string;
  solveMonth?: string;
  out: string;
  seed: number;
  runs: number;
}

const REPEATABLE = new Set(["--bundle", "--export"]);
const SINGLE = new Set(["--out", "--solve-request", "--solve-month", "--seed", "--runs"]);

export function parseCliArgs(argv: readonly string[]): CliArgs | { error: string } {
  const bundles: string[] = [];
  const exports: string[] = [];
  const single = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (!REPEATABLE.has(flag) && !SINGLE.has(flag)) return { error: `unknown flag ${flag}` };
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) return { error: `${flag} needs a value` };
    i += 1;
    if (flag === "--bundle") bundles.push(value);
    else if (flag === "--export") exports.push(value);
    else if (single.has(flag)) return { error: `${flag} may be given only once` };
    else single.set(flag, value);
  }
  if (bundles.length === 0) return { error: "at least one --bundle is required (the Gate B snippet's output)" };
  const out = single.get("--out");
  if (!out) return { error: "--out <dir> is required (a private folder outside the repository)" };
  const seedText = single.get("--seed") ?? "42";
  if (!/^\d+$/.test(seedText)) return { error: "--seed must be a non-negative integer" };
  const runsText = single.get("--runs") ?? "2";
  if (!/^\d+$/.test(runsText) || Number(runsText) > 10) return { error: "--runs must be an integer from 0 to 10" };
  const solveMonth = single.get("--solve-month");
  if (solveMonth !== undefined && !parseTargetKey(solveMonth)) return { error: "--solve-month must be YYYY-MM" };
  const solveRequest = single.get("--solve-request");
  return {
    bundles,
    exports,
    ...(solveRequest !== undefined ? { solveRequest } : {}),
    ...(solveMonth !== undefined ? { solveMonth } : {}),
    out,
    seed: Number(seedText),
    runs: Number(runsText),
  };
}

// ─── The repository refusal ──────────────────────────────────────────────────

/** Whether `child` is `root` or below it, by whole path segments. */
export function isInsideRoot(child: string, root: string, caseInsensitive: boolean): boolean {
  const norm = (p: string) => (caseInsensitive ? p.toLowerCase() : p);
  const rel = path.relative(norm(root), norm(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * The real location of `p`: symlinks resolved on its nearest existing ancestor,
 * the rest appended — so an `--out` that does not exist yet, or one reached
 * through a link, is judged by where it would really land.
 */
function realLocation(p: string): string {
  let current = path.resolve(p);
  const rest: string[] = [];
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    rest.unshift(path.basename(current));
    current = parent;
  }
  let real = current;
  try {
    real = realpathSync.native(current);
  } catch {
    // Unreadable: judged by its resolved path.
  }
  return path.join(real, ...rest);
}

/** The two reads `repositoryRoots` needs, injected so the discovery is testable without a repository. */
export interface GitFs {
  /** A file's text, or null when the path is not a readable file. */
  readFile(p: string): string | null;
  /** A directory's entries, or null when the path is not a readable directory. */
  readDir(p: string): string[] | null;
}

export const nodeGitFs: GitFs = {
  readFile: (p) => {
    try {
      return statSync(p).isFile() ? readFileSync(p, "utf8") : null;
    } catch {
      return null;
    }
  },
  readDir: (p) => {
    try {
      return statSync(p).isDirectory() ? readdirSync(p) : null;
    } catch {
      return null;
    }
  },
};

/**
 * Every working tree of the repository `repoRoot` belongs to — not just
 * `repoRoot`. A linked worktree (`git worktree add`, `.claude/worktrees/*`) has a
 * `.git` FILE pointing into the main repository's `.git/worktrees/<name>`; a file
 * written into the MAIN checkout, or into a sibling worktree, is just as much
 * inside the public repository as one written here. So the roots are:
 *  - `repoRoot` itself;
 *  - the main working tree: the parent of the common dir, when that is a `.git`
 *    directory (a bare repository has none);
 *  - every linked worktree: the parent of each `<commondir>/worktrees/*` `gitdir` target.
 * A `.git` file that cannot be followed is a `problem`: the caller refuses rather
 * than guard less of the repository than it thinks it does.
 */
export function repositoryRoots(repoRoot: string, fs: GitFs): { roots: string[]; problem: string | null } {
  const root = path.resolve(repoRoot);
  const roots = new Set([root]);
  const dotGit = path.join(root, ".git");
  let commonDir: string | null = null;

  const dotGitFile = fs.readFile(dotGit);
  if (dotGitFile !== null) {
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(dotGitFile);
    if (!m) return { roots: [...roots], problem: `cannot locate the repository: ${dotGit} has no "gitdir:" line` };
    const gitDir = path.resolve(root, m[1]);
    if (fs.readDir(gitDir) === null) {
      return { roots: [...roots], problem: `cannot locate the repository: ${dotGit} points at ${gitDir}, which does not exist` };
    }
    const common = fs.readFile(path.join(gitDir, "commondir"))?.trim();
    if (common) commonDir = path.resolve(gitDir, common);
    else if (path.basename(path.dirname(gitDir)) === "worktrees") commonDir = path.dirname(path.dirname(gitDir));
    else commonDir = gitDir;
  } else if (fs.readDir(dotGit) !== null) {
    commonDir = dotGit;
  }

  if (commonDir) {
    if (path.basename(commonDir) === ".git") roots.add(path.dirname(commonDir));
    const worktrees = path.join(commonDir, "worktrees");
    for (const name of fs.readDir(worktrees) ?? []) {
      const target = fs.readFile(path.join(worktrees, name, "gitdir"))?.trim();
      if (target) roots.add(path.dirname(path.resolve(worktrees, name, target)));
    }
  }
  return { roots: [...roots], problem: null };
}

function repoRefusals(entries: { flag: string; file: string }[], roots: readonly string[], platform: string): string[] {
  const caseInsensitive = platform === "darwin" || platform === "win32";
  const resolvedRoots = roots.flatMap((r) => [{ shown: r, at: path.resolve(r) }, { shown: r, at: realLocation(r) }]);
  const refusals: string[] = [];
  for (const { flag, file } of entries) {
    const candidates = [path.resolve(file), realLocation(file)];
    const hit = resolvedRoots.find((r) => candidates.some((c) => isInsideRoot(c, r.at, caseInsensitive)));
    if (hit) {
      refusals.push(
        `${flag} ${file} is inside the repository (${hit.shown}). Exports, bundles, solve requests and reports hold ` +
          "member names and this repository is public: keep them in a private folder outside it (e.g. ~/owt-private/p2-history/).",
      );
    }
  }
  return refusals;
}

// ─── Processes and the solver ────────────────────────────────────────────────

export interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
  /** Set when the process could not start, or was killed. */
  error?: string;
}

export type RunProcess = (cmd: string, args: string[], stdin: string | null, timeoutMs: number) => Promise<ProcessResult>;

export const defaultRunProcess: RunProcess = (cmd, args, stdin, timeoutMs) =>
  new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const settle = (r: ProcessResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    child.stdin.on("error", () => {
      // The process exited before reading its input; `close` reports it.
    });
    child.on("error", (err) => settle({ code: null, stdout, stderr, error: err.message }));
    child.on("close", (code, signal) => settle({ code, stdout, stderr, ...(signal ? { error: `killed by ${signal}` } : {}) }));
    child.stdin.end(stdin ?? "");
  });

/** The `ortools==X` pin in `gcf/requirements.txt`, or null. */
export function parseOrtoolsPin(requirementsText: string): string | null {
  const m = /^\s*ortools\s*==\s*([^\s#;]+)/m.exec(requirementsText);
  return m ? m[1] : null;
}

/** The local solver must run the ortools the cloud one runs, or the comparison compares two solvers. */
export async function checkOrtoolsPin(
  python: string,
  requirementsText: string,
  run: RunProcess,
): Promise<{ ok: true; version: string } | { ok: false; reason: string }> {
  const pin = parseOrtoolsPin(requirementsText);
  if (!pin) return { ok: false, reason: "gcf/requirements.txt pins no ortools version" };
  const r = await run(python, ["-c", "import ortools, sys; sys.stdout.write(ortools.__version__)"], null, 60_000);
  if (r.error || r.code !== 0) {
    return { ok: false, reason: `could not read ortools.__version__ with ${python}: ${r.error ?? (r.stderr.trim() || `exit ${r.code}`)}` };
  }
  const version = r.stdout.trim();
  if (version !== pin) return { ok: false, reason: `ortools ${version} is not the gcf/requirements.txt pin ${pin}` };
  return { ok: true, version };
}

async function solveOnce(python: string, script: string, body: unknown, run: RunProcess): Promise<RunSummary> {
  const r = await run(python, [script, "--json-mode"], JSON.stringify(body), 180_000);
  if (r.error || !r.stdout.trim()) {
    return summarizeRun({ ok: false, error: r.error ?? `no output (${r.stderr.trim().slice(0, 200) || `exit ${r.code}`})` });
  }
  try {
    return summarizeRun(JSON.parse(r.stdout));
  } catch {
    return summarizeRun({ ok: false, error: "the solver's output was not JSON" });
  }
}

// ─── The captured solve request ──────────────────────────────────────────────

type HistoryProjection = { total_counts: Record<string, number>; role_counts: Record<string, Record<string, number>> };

function project(entries: readonly SolverHistoryEntry[]): HistoryProjection[] {
  return entries.map(({ total_counts, role_counts }) => ({ total_counts, role_counts }));
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function parseSolveRequest(raw: string, label: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (e) {
    throw new Error(`${label}: not JSON (${describeJsonError(e)})`);
  }
  if (!isObj(value)) throw new Error(`${label}: expected the solve request's JSON object`);
  const arrays = ["weekends_with_saturday", "sunday_leads", "saturday_leads", "support", "dsl_rules", "history"];
  if (!Number.isInteger(value.weeks) || (value.weeks as number) < 1) throw new Error(`${label}: weeks must be a positive integer`);
  for (const key of arrays) if (!Array.isArray(value[key])) throw new Error(`${label}: ${key} must be an array`);
  if ((value.sunday_leads as unknown[]).length === 0) throw new Error(`${label}: sunday_leads is empty — the route refuses that request`);
  return value;
}

/** Sundays in a calendar month. UTC arithmetic: a weekday, never a service date. */
function sundaysIn(year: number, month: number): number {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let n = 0;
  for (let d = 1; d <= days; d += 1) if (new Date(Date.UTC(year, month - 1, d)).getUTCDay() === 0) n += 1;
  return n;
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (isObj(v)) {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(v[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

// ─── The run ─────────────────────────────────────────────────────────────────

export interface CliDeps {
  repoRoot: string;
  /** `OWT_SOLVER_PYTHON`, if set. */
  solverPython: string | undefined;
  runProcess: RunProcess;
  now: () => Date;
  out: (line: string) => void;
  err: (line: string) => void;
  platform: string;
}

interface Primary {
  label: string;
  entries: SolverHistoryEntry[];
  /** From the first bundle: the profile that captured the solve request. */
  capture: boolean;
}

function labelsFor(files: readonly string[], prefix: string): string[] {
  const base = files.map((f) => path.basename(f));
  return files.map((f, i) => `${prefix}:${base.filter((b) => b === base[i]).length > 1 ? f : base[i]}`);
}

class Refusal extends Error {}

/** Returns the process exit code: 0 with a report written, 2 on a refusal, 1 on an unexpected failure. */
export async function runSolverHistoryDiff(argv: readonly string[], deps: CliDeps): Promise<number> {
  try {
    return await run(argv, deps);
  } catch (e) {
    if (e instanceof Refusal) {
      for (const line of e.message.split("\n")) deps.err(`solver-history-diff: ${line}`);
      return 2;
    }
    throw e;
  }
}

async function run(argv: readonly string[], deps: CliDeps): Promise<number> {
  const args = parseCliArgs(argv);
  if ("error" in args) throw new Refusal(`${args.error}\n${USAGE}`);

  // 1. Nothing inside the repository — any of its working trees — checked before any file is read or written.
  const { roots, problem } = repositoryRoots(deps.repoRoot, nodeGitFs);
  if (problem) throw new Refusal(`${problem}; refusing rather than guard only part of the repository`);
  const refusals = repoRefusals(
    [
      ...args.bundles.map((file) => ({ flag: "--bundle", file })),
      ...args.exports.map((file) => ({ flag: "--export", file })),
      ...(args.solveRequest ? [{ flag: "--solve-request", file: args.solveRequest }] : []),
      { flag: "--out", file: args.out },
    ],
    roots,
    deps.platform,
  );
  if (refusals.length) throw new Refusal(refusals.join("\n"));

  // 2. The inputs.
  const read = (file: string): string => {
    try {
      return readFileSync(file, "utf8");
    } catch (e) {
      throw new Refusal(`cannot read ${file}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const guard = <T>(fn: () => T): T => {
    try {
      return fn();
    } catch (e) {
      if (e instanceof Refusal) throw e;
      throw new Refusal(e instanceof Error ? e.message : String(e));
    }
  };
  const bundleLabels = labelsFor(args.bundles, "bundle");
  const bundles: ParsedBundle[] = args.bundles.map((file, i) =>
    guard(() => {
      let json: unknown;
      try {
        json = JSON.parse(read(file));
      } catch (e) {
        if (e instanceof Refusal) throw e;
        throw new Error(`${bundleLabels[i]}: not JSON (${describeJsonError(e)})`);
      }
      return parseBundle(json, bundleLabels[i]);
    }),
  );
  const exportLabels = labelsFor(args.exports, "export");
  const extraExports = args.exports.map((file, i) => guard(() => parseExport(read(file), exportLabels[i])));
  const merged: Map<string, MergedTarget> = guard(() => mergeBundles(bundles));

  const primaries: Primary[] = [
    ...bundles.map((b, i) => ({ label: b.label, entries: b.exportEntries, capture: i === 0 })),
    ...extraExports.map((entries, i) => ({ label: exportLabels[i], entries, capture: false })),
  ];
  const nexts = bundles.flatMap((b) => (b.next ? [b.next] : []));

  // 3. Every window each export needs, or nothing: comparing fewer windows would hide months.
  const missing: string[] = [];
  const targetsOf = new Map<string, string[]>();
  for (const p of primaries) {
    const needed = neededTargets(p.entries, nexts);
    targetsOf.set(p.label, needed);
    const lacking = needed.flatMap((t) => {
      const m = merged.get(t);
      if (m?.usable) return [];
      return [`${t} (${m ? m.reasons.join("; ") : "not captured"})`];
    });
    if (lacking.length) missing.push(`${p.label} needs ${lacking.join(", ")}`);
  }
  if (missing.length) {
    throw new Refusal(
      [
        "the bundles lack targets an export needs (NEXT, and m+1 for every export month):",
        ...missing.map((m) => `  ${m}`),
        "Run Gate B's snippet again in that profile (or with those targets added to it), as a super-admin, with evidence=1.",
      ].join("\n"),
    );
  }

  // 4. The captured solve request, and the pin — before any classification is written.
  let solvePlan: {
    month: string;
    monthSource: string;
    request: Record<string, unknown>;
    derivedHistory: HistoryProjection[];
    python: string;
    script: string;
    ortools: string | null;
    warnings: string[];
  } | null = null;
  if (args.solveRequest) {
    const request = guard(() => parseSolveRequest(read(args.solveRequest!), `--solve-request ${path.basename(args.solveRequest!)}`));
    const month = args.solveMonth ?? bundles[0].next;
    if (!month) throw new Refusal("the first bundle names no NEXT; pass --solve-month YYYY-MM");
    const target = parseTargetKey(month)!;
    const derived = merged.get(month);
    if (!derived?.usable) throw new Refusal(`no usable derived capture for the solve month ${month}; add it to Gate B's snippet`);
    const warnings: string[] = [];
    const sundays = sundaysIn(target.year, target.month);
    if (request.weeks !== sundays) {
      warnings.push(`the request has weeks = ${String(request.weeks)} but ${month} has ${sundays} Sundays: is it the right month?`);
    }
    const python = deps.solverPython || DEFAULT_SOLVER_PYTHON;
    let ortools: string | null = null;
    if (args.runs > 0) {
      const requirements = read(path.join(deps.repoRoot, "gcf", "requirements.txt"));
      const pin = await checkOrtoolsPin(python, requirements, deps.runProcess);
      if (!pin.ok) {
        throw new Refusal(
          `${pin.reason}. Re-pin the owt-roles env to gcf/requirements.txt (or set OWT_SOLVER_PYTHON), ` +
            "or run with --runs 0 and use the fallback: the production solve route from DevTools.",
        );
      }
      ortools = pin.version;
    }
    solvePlan = {
      month,
      monthSource: args.solveMonth ? "--solve-month" : "the first bundle's NEXT",
      request,
      derivedHistory: project(derived.result.entries),
      python,
      script: path.join(deps.repoRoot, "gcf", "owt_solver_v2.py"),
      ortools,
      warnings,
    };
  }

  // 5. Classify: every export as primary, on every target it needs.
  const reports: PrimaryReport[] = primaries.map((p) => {
    const others = primaries.filter((o) => o !== p).map((o) => o.entries);
    const targets = targetsOf.get(p.label)!;
    const results: HistoryDiffResult[] = targets.map((t) => {
      const m = merged.get(t);
      if (!m?.usable) throw new Error(`unreachable: ${t} was checked usable`);
      return classifyHistoryDiff({
        target: parseTargetKey(t)!,
        primary: p.entries,
        others,
        derived: m.result,
        sessionGapMinutes: SESSION_GAP_MINUTES,
      });
    });
    return { label: p.label, entries: p.entries.length, targets, results };
  });

  // 6. Solve: each side `runs` times, one after another (a time-limited search shares the CPU).
  let solve: SolveSection | null = null;
  if (solvePlan) {
    const target = parseTargetKey(solvePlan.month)!;
    const body = (history: HistoryProjection[]) => ({ ...solvePlan!.request, history, seed: args.seed });
    const derivedBody = body(solvePlan.derivedHistory);
    const locals = primaries.map((p) => ({ label: p.label, capture: p.capture, history: project(historyForRequest(p.entries, target.year, target.month)) }));
    const consistency: ConsistencyCheck[] = locals.map((l) => ({
      label: l.label,
      capture: l.capture,
      matches: stable(l.history) === stable(solvePlan!.request.history),
    }));
    const runSide = async (b: unknown): Promise<RunSummary[]> => {
      const out: RunSummary[] = [];
      for (let i = 0; i < args.runs; i += 1) out.push(await solveOnce(solvePlan!.python, solvePlan!.script, b, deps.runProcess));
      return out;
    };
    const derivedRuns = await runSide(derivedBody);
    const localRuns: { label: string; runs: RunSummary[] }[] = [];
    for (const l of locals) localRuns.push({ label: `local (${l.label})`, runs: await runSide(body(l.history)) });
    solve = {
      month: solvePlan.month,
      monthSource: solvePlan.monthSource,
      seed: args.seed,
      runsPerSide: args.runs,
      ortools: solvePlan.ortools,
      python: args.runs > 0 ? solvePlan.python : null,
      warnings: solvePlan.warnings,
      consistency,
      derived: { label: "derived", runs: derivedRuns },
      locals: localRuns,
      requests: { derived: derivedBody, locals: locals.map((l) => ({ label: l.label, body: body(l.history) })) },
    };
  }

  // 7. The report, outside the repository, never overwriting.
  const totals = aggregateTotals(reports.flatMap((r) => r.results));
  const generatedAt = deps.now().toISOString();
  const model: ReportModel = {
    generatedAt,
    sessionGapMinutes: SESSION_GAP_MINUTES,
    bundles: bundles.map((b) => ({
      label: b.label,
      origin: b.origin,
      takenAt: b.takenAt,
      exportEntries: b.exportEntries.length,
      next: b.next,
      targets: [...b.targets].map(([key, t]) => (t.usable ? { key, usable: true } : { key, usable: false, reason: t.reason })),
    })),
    exports: primaries.map((p) => ({ label: p.label, entries: p.entries.length })),
    primaries: reports,
    totals,
    gate: gateOf(totals),
    r11Incomplete: r11Incomplete(solve),
    solve,
  };
  const stamp = generatedAt.replace(/[:.]/g, "-");
  const outDir = path.resolve(args.out);
  mkdirSync(outDir, { recursive: true });
  const mdPath = path.join(outDir, `report-${stamp}.md`);
  const jsonPath = path.join(outDir, `report-${stamp}.json`);
  for (const p of [mdPath, jsonPath]) if (existsSync(p)) throw new Refusal(`${p} already exists; a report is never overwritten`);
  writeFileSync(mdPath, renderMarkdown(model), { flag: "wx" });
  writeFileSync(jsonPath, `${JSON.stringify(model, null, 2)}\n`, { flag: "wx" });
  for (const line of stdoutLines(model, { md: mdPath, json: jsonPath })) deps.out(line);
  return 0;
}
