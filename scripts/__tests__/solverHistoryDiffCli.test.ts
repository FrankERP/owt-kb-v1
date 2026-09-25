// scripts/__tests__/solverHistoryDiffCli.test.ts
//
// The diff CLI (`scripts/solver-history-diff.ts`, plan step 6): it refuses every
// input and output path inside the repository (the export, the bundles and the
// report hold member names, and the repository is public), its import closure
// reaches no server-only module and no Sanity client, it refuses an ortools that
// is not the `gcf/requirements.txt` pin, and it refuses to compare fewer windows
// than an export needs. The solver is never spawned here: `runProcess` is stubbed.
//
// Every name here is fake.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { historyForRequest } from "@/app/components/admin/plannerModel";
import type { SolverHistoryEntry } from "@/app/utils/solverHistory";

import {
  checkOrtoolsPin,
  isInsideRoot,
  parseCliArgs,
  parseOrtoolsPin,
  runSolverHistoryDiff,
  type CliDeps,
  type ProcessResult,
  type RunProcess,
} from "../lib/solverHistoryDiffRun";
import { ANA, BETO, CARO, DANI, NOV, derivedFor, doc, entry } from "./__fixtures__/solverHistoryDiffFixtures";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CLI = path.join(REPO_ROOT, "scripts", "solver-history-diff.ts");
const PIN = "9.15.6755";

let work: string;

beforeEach(() => {
  work = mkdtempSync(path.join(tmpdir(), "owt-history-diff-"));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

const EXPORT_OCT: SolverHistoryEntry[] = [entry(2026, 10, { [BETO]: { "Sun.BGV": 1 } })];
const BASE_OCT = doc({ roleId: "sun-1004", day: "2026-10-04", contributes: { [BETO]: { "Sun.BGV": 1 } } });
const UNSTAMPED = doc({ roleId: "u-1", day: "2026-10-11", receipt: { status: "unstamped" }, contributes: { [ANA]: { "Sun.Lead": 1 } } });

function writeJson(name: string, value: unknown): string {
  const file = path.join(work, name);
  writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
  return file;
}

function bundle(name: string, exportEntries: SolverHistoryEntry[] | null, derived: Record<string, unknown>): string {
  return writeJson(name, {
    origin: "https://owt-backstage.vercel.app",
    takenAt: "2026-10-01T12:00:00.000Z",
    exportRaw: exportEntries === null ? null : JSON.stringify(exportEntries),
    derived,
  });
}

const GOOD_DERIVED = { "2026-11": { status: 200, body: derivedFor(NOV, [BASE_OCT, UNSTAMPED]) } };

/** A captured solve request whose history is exactly what the browser sends for November. */
function solveRequest(history = historyForRequest(EXPORT_OCT, 2026, 11).map(({ total_counts, role_counts }) => ({ total_counts, role_counts }))) {
  return writeJson("solve-request-2026-11.json", {
    weeks: 5,
    weekends_with_saturday: [1, 3],
    sunday_leads: [ANA, BETO],
    saturday_leads: [CARO],
    support: [DANI],
    dsl_rules: [],
    history,
  });
}

interface Harness {
  deps: CliDeps;
  out: string[];
  err: string[];
  calls: { cmd: string; args: string[]; stdin: string | null }[];
}

function harness(opts: { version?: string; solve?: Record<string, unknown> } = {}): Harness {
  const out: string[] = [];
  const err: string[] = [];
  const calls: Harness["calls"] = [];
  const runProcess: RunProcess = async (cmd, args, stdin): Promise<ProcessResult> => {
    calls.push({ cmd, args, stdin });
    if (args[0] === "-c") return { code: 0, stdout: `${opts.version ?? PIN}\n`, stderr: "" };
    return {
      code: 0,
      stdout: JSON.stringify(
        opts.solve ?? {
          ok: true,
          objective_skipped: true,
          history_runs_used: 3,
          fairness_relaxed: false,
          sun_lead_fairness_relaxed: false,
          sun_bgv_fairness_relaxed: false,
          total_counts: { [ANA]: 2, [BETO]: 1 },
          role_counts: {},
          unfilled_seats: [],
        },
      ),
      stderr: "",
    };
  };
  return {
    out,
    err,
    calls,
    deps: {
      repoRoot: REPO_ROOT,
      solverPython: "/fake/python3",
      runProcess,
      now: () => new Date("2026-10-01T18:30:00.000Z"),
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      platform: process.platform,
    },
  };
}

function reports(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.startsWith("report-")).sort() : [];
}

// ─── Arguments ───────────────────────────────────────────────────────────────

describe("parseCliArgs", () => {
  it("takes repeatable --bundle and --export, and defaults --seed 42 and --runs 2", () => {
    expect(parseCliArgs(["--bundle", "a.json", "--bundle", "b.json", "--export", "c.json", "--out", "o"])).toEqual({
      bundles: ["a.json", "b.json"],
      exports: ["c.json"],
      out: "o",
      seed: 42,
      runs: 2,
    });
    expect(
      parseCliArgs(["--bundle", "a", "--out", "o", "--solve-request", "s", "--solve-month", "2026-11", "--seed", "7", "--runs", "0"]),
    ).toEqual({ bundles: ["a"], exports: [], out: "o", solveRequest: "s", solveMonth: "2026-11", seed: 7, runs: 0 });
  });

  it.each([
    [[], /--bundle/],
    [["--bundle", "a"], /--out/],
    [["--bundle", "a", "--out", "o", "--bogus"], /unknown flag --bogus/],
    [["--bundle", "--out", "o"], /--bundle needs a value/],
    [["--bundle", "a", "--out", "o", "--runs", "-1"], /--runs/],
    [["--bundle", "a", "--out", "o", "--seed", "x"], /--seed/],
    [["--bundle", "a", "--out", "o", "--solve-month", "2026-13"], /--solve-month/],
    [["--bundle", "a", "--out", "o", "--out", "p"], /--out.*once/],
  ])("refuses %j", (argv, message) => {
    const parsed = parseCliArgs(argv as string[]);
    expect("error" in parsed && parsed.error).toMatch(message);
  });
});

// ─── The repository refusal ──────────────────────────────────────────────────

describe("paths inside the repository are refused", () => {
  it("isInsideRoot compares whole path segments, and case-insensitively where the filesystem is", () => {
    expect(isInsideRoot("/r/a/b", "/r", false)).toBe(true);
    expect(isInsideRoot("/r", "/r", false)).toBe(true);
    expect(isInsideRoot("/ra/b", "/r", false)).toBe(false);
    expect(isInsideRoot("/elsewhere", "/r", false)).toBe(false);
    expect(isInsideRoot("/R/a", "/r", true)).toBe(true);
    expect(isInsideRoot("/R/a", "/r", false)).toBe(false);
  });

  it("refuses an in-repo --out and creates nothing there", async () => {
    const h = harness();
    const inRepoOut = path.join(REPO_ROOT, "tmp-history-diff-must-not-exist");
    try {
      const code = await runSolverHistoryDiff(["--bundle", bundle("b.json", EXPORT_OCT, GOOD_DERIVED), "--out", inRepoOut], h.deps);
      expect(code).toBe(2);
      expect(h.err.join("\n")).toMatch(/--out .*inside the repository/);
      expect(existsSync(inRepoOut)).toBe(false);
      expect(h.calls).toEqual([]);
    } finally {
      // A regression must not leave a report in the working tree for the next run to trip on.
      rmSync(inRepoOut, { recursive: true, force: true });
    }
  });

  it("refuses an in-repo --bundle, --export or --solve-request before reading it", async () => {
    const inRepo = path.join(REPO_ROOT, "package.json");
    const good = bundle("b.json", EXPORT_OCT, GOOD_DERIVED);
    for (const argv of [
      ["--bundle", inRepo, "--out", path.join(work, "out")],
      ["--bundle", good, "--export", inRepo, "--out", path.join(work, "out")],
      ["--bundle", good, "--solve-request", inRepo, "--out", path.join(work, "out")],
    ]) {
      const h = harness();
      expect(await runSolverHistoryDiff(argv, h.deps)).toBe(2);
      expect(h.err.join("\n")).toMatch(/inside the repository/);
      expect(reports(path.join(work, "out"))).toEqual([]);
    }
  });

  it("refuses a path that reaches the repository through a symlink", async () => {
    const link = path.join(work, "link-into-repo");
    symlinkSync(path.join(REPO_ROOT, "scripts"), link);
    const landed = path.join(REPO_ROOT, "scripts", "tmp-history-diff-new-dir");
    try {
      const h = harness();
      const code = await runSolverHistoryDiff(["--bundle", bundle("b.json", EXPORT_OCT, GOOD_DERIVED), "--out", path.join(link, "tmp-history-diff-new-dir")], h.deps);
      expect(code).toBe(2);
      expect(h.err.join("\n")).toMatch(/--out .*inside the repository/);
      expect(existsSync(landed)).toBe(false);
    } finally {
      rmSync(landed, { recursive: true, force: true });
    }
  });

  it("refuses through the real CLI too, run by tsx (which also proves tsx loads the whole closure)", () => {
    const tsx = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");
    const result = spawnSync(tsx, [CLI, "--bundle", path.join(REPO_ROOT, "package.json"), "--out", path.join(work, "out")], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...process.env, OWT_SOLVER_PYTHON: "/nonexistent/python3" },
      timeout: 60_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.stderr).toMatch(/--bundle .*inside the repository/);
    expect(result.status).toBe(2);
  }, 60_000);
});

// ─── The import closure ──────────────────────────────────────────────────────

const FORBIDDEN = [/^server-only$/, /^sanity$/, /(^|\/)sanity\//, /^next-sanity/, /^@sanity\/client/];

/** Every runtime import specifier of `source` — `import type` and `export type … from` are erased, so they are skipped. */
function runtimeSpecifiers(fileName: string, source: string): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!node.importClause?.isTypeOnly) out.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!node.isTypeOnly) out.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      out.push(node.arguments[0].text);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const expr = node.moduleReference.expression;
      if (ts.isStringLiteral(expr)) out.push(expr.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Follow every relative and `@/` specifier from `entry`; return the files reached and every specifier seen. */
function importClosure(entryFile: string, read: (file: string) => string | null): { files: string[]; specifiers: { from: string; spec: string }[] } {
  const seen = new Set<string>();
  const specifiers: { from: string; spec: string }[] = [];
  const queue = [entryFile];
  const resolveLocal = (from: string, spec: string): string | null => {
    const base = spec.startsWith("@/") ? path.join(REPO_ROOT, spec.slice(2)) : path.resolve(path.dirname(from), spec);
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
      if (/\.(ts|tsx)$/.test(candidate) && read(candidate) !== null) return candidate;
    }
    return null;
  };
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = read(file);
    if (source === null) throw new Error(`cannot read ${file}`);
    for (const spec of runtimeSpecifiers(file, source)) {
      specifiers.push({ from: path.relative(REPO_ROOT, file), spec });
      if (spec.startsWith(".") || spec.startsWith("@/")) {
        const resolved = resolveLocal(file, spec);
        if (!resolved) throw new Error(`${path.relative(REPO_ROOT, file)}: cannot resolve ${spec}`);
        queue.push(resolved);
      }
    }
  }
  return { files: [...seen].map((f) => path.relative(REPO_ROOT, f)).sort(), specifiers };
}

const readDisk = (file: string): string | null => (existsSync(file) ? readFileSync(file, "utf8") : null);

describe("the CLI's import closure", () => {
  const closure = importClosure(CLI, readDisk);

  it("reaches no server-only module and no Sanity client, anywhere in the chain", () => {
    const bad = closure.specifiers.filter(({ spec }) => FORBIDDEN.some((re) => re.test(spec)));
    expect(bad).toEqual([]);
  });

  it("is the whole chain, not the first level: it includes the read model the derivation reaches", () => {
    // Deferred from task 1: the neutrality pin must cover serviceReadSelect → serviceReadModel.
    for (const file of [
      "scripts/lib/solverHistoryDiff.ts",
      "scripts/lib/solverHistoryDiffRun.ts",
      "app/utils/solverHistory.ts",
      "app/utils/serviceReadSelect.ts",
      "app/utils/serviceReadModel.ts",
      "app/components/admin/plannerModel.ts",
    ]) {
      expect(closure.files).toContain(file);
    }
  });

  it("the walker is not vacuous: it follows a chain two levels deep, skips type-only imports, and sees require()", () => {
    const files: Record<string, string> = {
      [path.join(REPO_ROOT, "x/entry.ts")]: 'import { a } from "./a";\nimport type { T } from "@/sanity/lib/typesOnly";\n',
      [path.join(REPO_ROOT, "x/a.ts")]: 'export { b } from "@/x/b";\n',
      [path.join(REPO_ROOT, "x/b.ts")]: 'import "server-only";\nconst c = require("next-sanity");\n',
    };
    const fake = importClosure(path.join(REPO_ROOT, "x/entry.ts"), (f) => files[f] ?? null);
    expect(fake.files).toEqual(["x/a.ts", "x/b.ts", "x/entry.ts"]);
    expect(fake.specifiers.filter(({ spec }) => FORBIDDEN.some((re) => re.test(spec))).map((s) => s.spec)).toEqual([
      "server-only",
      "next-sanity",
    ]);
  });
});

// ─── The ortools pin ─────────────────────────────────────────────────────────

describe("the ortools version check", () => {
  const requirements = readFileSync(path.join(REPO_ROOT, "gcf", "requirements.txt"), "utf8");
  const stub = (result: ProcessResult): RunProcess => async () => result;

  it("reads the pin from gcf/requirements.txt", () => {
    expect(parseOrtoolsPin(requirements)).toBe(PIN);
    expect(parseOrtoolsPin("functions-framework>=3.0,<4\n")).toBeNull();
    expect(parseOrtoolsPin("ortools>=9\n")).toBeNull();
  });

  it("accepts exactly the pin and refuses anything else", async () => {
    expect(await checkOrtoolsPin("/fake/python3", requirements, stub({ code: 0, stdout: `${PIN}\n`, stderr: "" }))).toEqual({ ok: true, version: PIN });
    const mismatch = await checkOrtoolsPin("/fake/python3", requirements, stub({ code: 0, stdout: "9.14.6206", stderr: "" }));
    expect(mismatch.ok).toBe(false);
    expect(!mismatch.ok && mismatch.reason).toMatch(/9\.14\.6206.*9\.15\.6755/);
    expect((await checkOrtoolsPin("/fake/python3", requirements, stub({ code: 1, stdout: "", stderr: "No module named ortools" }))).ok).toBe(false);
    expect((await checkOrtoolsPin("/fake/python3", requirements, stub({ code: null, stdout: "", stderr: "", error: "ENOENT" }))).ok).toBe(false);
  });

  it("refuses the run on a mismatch before any solve and before writing anything", async () => {
    const h = harness({ version: "9.14.6206" });
    const out = path.join(work, "out");
    const code = await runSolverHistoryDiff(
      ["--bundle", bundle("b.json", EXPORT_OCT, GOOD_DERIVED), "--solve-request", solveRequest(), "--out", out],
      h.deps,
    );
    expect(code).toBe(2);
    expect(h.err.join("\n")).toMatch(/ortools 9\.14\.6206/);
    expect(h.calls.map((c) => c.args[0])).toEqual(["-c"]);
    expect(reports(out)).toEqual([]);
  });
});

// ─── Inputs that cannot be compared ──────────────────────────────────────────

describe("refusals on the inputs", () => {
  it("refuses when a bundle lacks a target an export needs (m+1 for each export month), naming it", async () => {
    // The export holds September and October: it needs 2026-10 and 2026-11. The bundle has only 2026-11.
    const h = harness();
    const out = path.join(work, "out");
    const code = await runSolverHistoryDiff(
      ["--bundle", bundle("b.json", [entry(2026, 9, {}), ...EXPORT_OCT], GOOD_DERIVED), "--out", out],
      h.deps,
    );
    expect(code).toBe(2);
    expect(h.err.join("\n")).toMatch(/2026-10/);
    expect(h.err.join("\n")).toMatch(/Gate B/);
    expect(reports(out)).toEqual([]);
  });

  it("refuses when a needed target was captured without evidence or failed", async () => {
    const h = harness();
    const code = await runSolverHistoryDiff(
      ["--bundle", bundle("b.json", EXPORT_OCT, { "2026-11": { status: 500, body: { error: "history_unavailable" } } }), "--out", path.join(work, "out")],
      h.deps,
    );
    expect(code).toBe(2);
    expect(h.err.join("\n")).toMatch(/2026-11.*HTTP 500/);
  });

  it("an --export with no bundle of its own is checked against the bundles' targets too", async () => {
    const h = harness();
    const code = await runSolverHistoryDiff(
      [
        "--bundle", bundle("b.json", EXPORT_OCT, GOOD_DERIVED),
        "--export", writeJson("export-ios.json", JSON.stringify([entry(2026, 12, {})])),
        "--out", path.join(work, "out"),
      ],
      h.deps,
    );
    expect(code).toBe(2);
    expect(h.err.join("\n")).toMatch(/export-ios\.json[\s\S]*2027-01/);
  });

  it("refuses two bundles that captured one target differently", async () => {
    const h = harness();
    const edited = { "2026-11": { status: 200, body: derivedFor(NOV, [BASE_OCT]) } };
    const code = await runSolverHistoryDiff(
      ["--bundle", bundle("a.json", EXPORT_OCT, GOOD_DERIVED), "--bundle", bundle("b.json", EXPORT_OCT, edited), "--out", path.join(work, "out")],
      h.deps,
    );
    expect(code).toBe(2);
    expect(h.err.join("\n")).toMatch(/disagree on 2026-11/);
  });

  it("refuses a malformed export with its file name", async () => {
    const h = harness();
    const code = await runSolverHistoryDiff(
      ["--bundle", bundle("b.json", EXPORT_OCT, GOOD_DERIVED), "--export", writeJson("export-bad.json", "{"), "--out", path.join(work, "out")],
      h.deps,
    );
    expect(code).toBe(2);
    expect(h.err.join("\n")).toMatch(/export-bad\.json.*not JSON/);
  });
});

// ─── A whole run ─────────────────────────────────────────────────────────────

describe("a whole run", () => {
  it("classifies, runs each side twice with the seed pinned, and writes the report outside the repository", async () => {
    const h = harness();
    const out = path.join(work, "private", "out");
    const code = await runSolverHistoryDiff(
      ["--bundle", bundle("bundle-2026-10-01.json", EXPORT_OCT, GOOD_DERIVED), "--solve-request", solveRequest(), "--out", out],
      h.deps,
    );
    expect(h.err).toEqual([]);
    expect(code).toBe(0);

    // One version check, then two derived and two local runs, one after another.
    expect(h.calls.map((c) => c.args[0])).toEqual(["-c", ...Array(4).fill(path.join(REPO_ROOT, "gcf", "owt_solver_v2.py"))]);
    expect(h.calls.slice(1).every((c) => c.cmd === "/fake/python3" && c.args[1] === "--json-mode")).toBe(true);
    const bodies = h.calls.slice(1).map((c) => JSON.parse(c.stdin ?? "null"));
    expect(bodies.every((b) => b.seed === 42 && b.weeks === 5 && b.sunday_leads.length === 2)).toBe(true);
    const derivedHistory = derivedFor(NOV, [BASE_OCT, UNSTAMPED]).entries.map(({ total_counts, role_counts }) => ({ total_counts, role_counts }));
    const localHistory = historyForRequest(EXPORT_OCT, 2026, 11).map(({ total_counts, role_counts }) => ({ total_counts, role_counts }));
    expect(bodies.map((b) => b.history)).toEqual([derivedHistory, derivedHistory, localHistory, localHistory]);

    const files = reports(out);
    expect(files).toEqual(["report-2026-10-01T18-30-00-000Z.json", "report-2026-10-01T18-30-00-000Z.md"]);
    const md = readFileSync(path.join(out, files[1]), "utf8");
    expect(md).toMatch(/SESSION_GAP_MINUTES.*60/);
    expect(md).toMatch(/single data point/);
    expect(md).toMatch(/not fairness-driven/);
    expect(md).toMatch(/Fingerprint control rate/);
    expect(md).toMatch(/1 \/ 1/);
    expect(md).toMatch(/bundle-2026-10-01\.json/);
    expect(md).toMatch(/2026-10-01T12:00:00\.000Z/);
    expect(md).toMatch(/equals the recomputed local side/);
    expect(md).toMatch(/created outside create mode — no receipt/);
    const json = JSON.parse(readFileSync(path.join(out, files[0]), "utf8"));
    expect(json.totals.cells).toEqual({ explained: 1, unverified: 0, bug: 0 });
    expect(json.gate).toBe("CLEAN");
    expect(json.solve.requests.derived.seed).toBe(42);

    // Stdout carries totals and paths, never a member name.
    const stdout = h.out.join("\n");
    for (const name of [ANA, BETO, CARO, DANI]) expect(stdout).not.toContain(name);
    expect(stdout).toMatch(/explained 1 · unverified 0 · bug 0/);
  });

  it("says when the captured request's history is not what this export recomputes to", async () => {
    const h = harness();
    const out = path.join(work, "out");
    const code = await runSolverHistoryDiff(
      ["--bundle", bundle("b.json", EXPORT_OCT, GOOD_DERIVED), "--solve-request", solveRequest([]), "--out", out],
      h.deps,
    );
    expect(code).toBe(0);
    const md = readFileSync(path.join(out, reports(out).find((f) => f.endsWith(".md"))!), "utf8");
    expect(md).toMatch(/does NOT equal the recomputed local side/);
    expect(md).toMatch(/planning between the capture and the export/);
  });

  it("reports fairness-driven runs without the 'not fairness-driven' line", async () => {
    const h = harness({ solve: { ok: true, objective_skipped: false, history_runs_used: 3, total_counts: { [ANA]: 1 }, unfilled_seats: ["W1 Sunday Sun.Choir #2"] } });
    const out = path.join(work, "out");
    expect(await runSolverHistoryDiff(["--bundle", bundle("b.json", EXPORT_OCT, GOOD_DERIVED), "--solve-request", solveRequest(), "--out", out], h.deps)).toBe(0);
    const md = readFileSync(path.join(out, reports(out).find((f) => f.endsWith(".md"))!), "utf8");
    expect(md).not.toMatch(/not fairness-driven/);
    expect(md).toMatch(/single data point/);
  });

  it("--runs 0 spawns nothing and records the request bodies for the production-route fallback", async () => {
    const h = harness();
    const out = path.join(work, "out");
    const code = await runSolverHistoryDiff(
      ["--bundle", bundle("b.json", EXPORT_OCT, GOOD_DERIVED), "--solve-request", solveRequest(), "--out", out, "--runs", "0"],
      h.deps,
    );
    expect(code).toBe(0);
    expect(h.calls).toEqual([]);
    const json = JSON.parse(readFileSync(path.join(out, reports(out).find((f) => f.endsWith(".json"))!), "utf8"));
    expect(json.solve.requests.locals).toHaveLength(1);
    expect(json.solve.derived.runs).toEqual([]);
  });

  it("a run whose classification finds a bug says BLOCKED, and still exits 0 with the report written", async () => {
    const h = harness();
    const out = path.join(work, "out");
    // The export counts Dani as a Sunday lead that no stored document explains.
    const exportWithStray = [entry(2026, 10, { [BETO]: { "Sun.BGV": 1 }, [DANI]: { "Sun.Lead": 1 } })];
    const code = await runSolverHistoryDiff(["--bundle", bundle("b.json", exportWithStray, GOOD_DERIVED), "--out", out], h.deps);
    expect(code).toBe(0);
    expect(h.out.join("\n")).toMatch(/BLOCKED/);
    expect(reports(out)).toHaveLength(2);
  });

  it("compares NEXT as well as m+1 for every export month — and an empty store against NEXT alone", async () => {
    const both = harness();
    const outA = path.join(work, "a");
    const derived = { ...GOOD_DERIVED, "2026-10": { status: 200, body: derivedFor({ year: 2026, month: 10 }, []) } };
    expect(await runSolverHistoryDiff(["--bundle", bundle("b.json", [entry(2026, 9, {})], derived), "--out", outA], both.deps)).toBe(0);
    const a = JSON.parse(readFileSync(path.join(outA, reports(outA).find((f) => f.endsWith(".json"))!), "utf8"));
    expect(a.primaries[0].targets).toEqual(["2026-10", "2026-11"]);

    const empty = harness();
    const outB = path.join(work, "b");
    expect(await runSolverHistoryDiff(["--bundle", bundle("empty.json", null, GOOD_DERIVED), "--out", outB], empty.deps)).toBe(0);
    const b = JSON.parse(readFileSync(path.join(outB, reports(outB).find((f) => f.endsWith(".json"))!), "utf8"));
    expect(b.primaries[0].targets).toEqual(["2026-11"]);
    // An empty store holds fewer than six entries: its in-window months with documents are 2e.
    expect(b.totals.byClass).toEqual({ deleted_by_hand_or_never_written: { cells: 2, units: 2 } });
    expect(b.gate).toBe("NEEDS_ACCEPTANCE");
  });

  it("never overwrites a report", async () => {
    const out = path.join(work, "out");
    const argv = ["--bundle", bundle("b.json", EXPORT_OCT, GOOD_DERIVED), "--out", out];
    expect(await runSolverHistoryDiff(argv, harness().deps)).toBe(0);
    const first = reports(out).map((f) => readFileSync(path.join(out, f), "utf8"));
    const again = harness();
    expect(await runSolverHistoryDiff(argv, again.deps)).toBe(2);
    expect(again.err.join("\n")).toMatch(/already exists/);
    expect(reports(out).map((f) => readFileSync(path.join(out, f), "utf8"))).toEqual(first);
  });
});
