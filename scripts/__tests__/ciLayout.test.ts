import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkCiLayout,
  checkCrossTreeImports,
  checkGoldenPlacement,
  checkNoSilentSkips,
  checkPartition,
  checkRequiredCheck,
  checkSolverCommands,
  discoverTests,
  gatesVerdict,
  parseWorkflow,
  walkTree,
} from "../lib/ci-layout.mjs";

// `gates` is the ONE check `main`'s branch protection requires, matched by name.
// Since the CI split it does no testing itself: it aggregates the `node`,
// `solver-v2` and `solver-v3` jobs. That shape has a fail-open edge GitHub does
// not warn about — a job skipped by an unmet `needs` reports `skipped`, and a
// skipped required check counts as PASSING — so the shape is pinned here, along
// with the rule that every Python test module under `gcf/` and `gcf_v3/` runs in
// exactly one job. See docs/CI.md «Why `gates` is an aggregator».

const repoRoot = resolve(__dirname, "../..");
const workflowsDir = resolve(repoRoot, ".github/workflows");
const runner = resolve(repoRoot, "scripts/ci/gates-verdict.mjs");

function readWorkflows(): { file: string; text: string }[] {
  return readdirSync(workflowsDir)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .map((f) => ({ file: `.github/workflows/${f}`, text: readFileSync(resolve(workflowsDir, f), "utf8") }));
}

const CI_FILE = ".github/workflows/ci.yml";
const CI = readFileSync(resolve(repoRoot, CI_FILE), "utf8");

function realTrees() {
  return { gcf: walkTree(repoRoot, "gcf"), gcf_v3: walkTree(repoRoot, "gcf_v3") };
}

/** Replace exactly one occurrence, so a mutation that silently matched nothing cannot pass. */
function mutate(text: string, from: string, to: string): string {
  const at = text.indexOf(from);
  expect(at, `mutation anchor not found in ci.yml: ${JSON.stringify(from)}`).toBeGreaterThanOrEqual(0);
  expect(text.indexOf(from, at + 1), `mutation anchor is not unique: ${JSON.stringify(from)}`).toBe(-1);
  return text.slice(0, at) + to + text.slice(at + from.length);
}

/** Every rule a whole-layout check reports against a mutated ci.yml. */
function layoutProblems(ciText: string, extra: { file: string; text: string }[] = []): string[] {
  const workflows = readWorkflows().map((w) => (w.file === CI_FILE ? { file: w.file, text: ciText } : w));
  return checkCiLayout({ workflows: [...workflows, ...extra], trees: realTrees() });
}

function expectRule(problems: string[], rule: string): void {
  expect(
    problems.some((p) => p.startsWith(`[${rule}]`)),
    `expected a [${rule}] problem, got:\n${problems.join("\n") || "(none)"}`,
  ).toBe(true);
}

type Entry = { path: string; text?: string };
const SCAFFOLD: Entry[] = [
  { path: "gcf_v3/requirements.txt" },
  { path: "gcf_v3/owt_v3/__init__.py", text: '"""v3."""\n' },
  { path: "gcf_v3/test_scaffold.py", text: "import unittest\n" },
];
const V2: Entry[] = [
  { path: "gcf/owt_solver_v2.py", text: "import re\n" },
  { path: "gcf/test_inertness.py", text: "GOLDEN_SCHEDULE = None\n" },
];

describe("the real repository", () => {
  it("passes every CI-layout rule", () => {
    expect(checkCiLayout({ workflows: readWorkflows(), trees: realTrees() })).toEqual([]);
  });

  it("discovers every test*.py on disk, in exactly one tree", () => {
    const trees = realTrees();
    for (const [tree, entries] of Object.entries(trees)) {
      const onDisk = entries.filter((e) => /(^|\/)test[^/]*\.py$/.test(e.path)).map((e) => e.path).sort();
      const { reachable, unreachable } = discoverTests(tree, entries);
      expect(unreachable, `${tree}: unreachable test modules`).toEqual([]);
      expect([...reachable].sort(), `${tree}: discovery model vs disk`).toEqual(onDisk);
      expect(reachable.length, `${tree} has no test module`).toBeGreaterThan(0);
    }
    expect(discoverTests("gcf", trees.gcf).reachable).toContain("gcf/test_inertness.py");
    expect(discoverTests("gcf_v3", trees.gcf_v3).reachable).toContain("gcf_v3/test_scaffold.py");
  });

  it("parses the real ci.yml into the four jobs, gates last", () => {
    const doc = parseWorkflow(CI) as { jobs: Record<string, unknown> };
    expect(Object.keys(doc.jobs)).toEqual(["node", "solver-v2", "solver-v3", "gates"]);
  });
});

describe("required check: `gates` (negative cases — each must be red)", () => {
  it("refuses a `gates` without `always()` — it would be SKIPPED, and skipped passes", () => {
    expectRule(layoutProblems(mutate(CI, "    if: ${{ always() }}\n", "")), "required-check");
  });

  it("accepts the bare `if: always()` spelling", () => {
    expect(layoutProblems(mutate(CI, "if: ${{ always() }}", "if: always()"))).toEqual([]);
  });

  it("refuses `!cancelled()` — a cancelled run would yield a skipped `gates`", () => {
    expectRule(layoutProblems(mutate(CI, "if: ${{ always() }}", "if: ${{ !cancelled() }}")), "required-check");
  });

  it("refuses a `needs` that leaves a job out", () => {
    expectRule(
      layoutProblems(mutate(CI, "needs: [node, solver-v2, solver-v3]", "needs: [node, solver-v2]")),
      "required-check",
    );
  });

  it("refuses a second job named `gates` in ci.yml", () => {
    expectRule(layoutProblems(mutate(CI, "    name: node\n", "    name: gates\n")), "required-check");
  });

  it("refuses a nameless job with id `gates` in another workflow", () => {
    const other = {
      file: ".github/workflows/other.yml",
      text: "on: push\njobs:\n  gates:\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    steps:\n      - run: 'true'\n",
    };
    expectRule(checkRequiredCheck([...readWorkflows(), other]), "required-check");
  });

  it("refuses a `gates` whose verdict step lost its `NEEDS_JSON`", () => {
    expectRule(
      layoutProblems(mutate(CI, "          NEEDS_JSON: ${{ toJSON(needs) }}\n", "          OTHER: x\n")),
      "required-check",
    );
  });

  it("refuses a `gates` with a matrix", () => {
    expectRule(
      layoutProblems(mutate(CI, "    timeout-minutes: 5\n", "    timeout-minutes: 5\n    strategy:\n      matrix:\n        x: [1, 2]\n")),
      "required-check",
    );
  });

  it("refuses an expression in any job `name:` — it could evaluate to `gates` unseen", () => {
    const other = {
      file: ".github/workflows/other.yml",
      text: "on: push\njobs:\n  probe:\n    name: ${{ 'gates' }}\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    steps:\n      - run: 'true'\n",
    };
    expectRule(checkRequiredCheck([...readWorkflows(), other]), "required-check");
    expectRule(layoutProblems(mutate(CI, "    name: solver-v3\n", "    name: ${{ vars.V3_NAME }}\n")), "required-check");
  });
});

describe("no silent skips (negative cases)", () => {
  it("refuses a `paths` filter", () => {
    const text = mutate(
      CI,
      "  pull_request:\n    branches: [main, preview]\n",
      "  pull_request:\n    branches: [main, preview]\n    paths: ['app/**']\n",
    );
    expectRule(checkNoSilentSkips(text), "no-silent-skips");
  });

  it("refuses `continue-on-error` on a solver step", () => {
    const text = mutate(
      CI,
      "        run: python -m unittest discover -s gcf_v3 -t gcf_v3 -v\n",
      "        run: python -m unittest discover -s gcf_v3 -t gcf_v3 -v\n        continue-on-error: true\n",
    );
    expectRule(checkNoSilentSkips(text), "no-silent-skips");
  });

  it("refuses a job-level `if:` outside `gates`", () => {
    const text = mutate(CI, "    name: solver-v3\n", "    name: solver-v3\n    if: ${{ github.event_name == 'push' }}\n");
    expectRule(checkNoSilentSkips(text), "no-silent-skips");
  });

  it("refuses a step-level `if:` — a skipped test step leaves its job green", () => {
    const text = mutate(CI, "      - name: Lint\n", "      - name: Lint\n        if: ${{ false }}\n");
    expectRule(checkNoSilentSkips(text), "no-silent-skips");
  });

  it("refuses a job without `timeout-minutes`", () => {
    const text = mutate(CI, "    timeout-minutes: 15\n    steps:\n      - uses: actions/checkout@v4\n\n      - uses: actions/setup-node@v4", "    steps:\n      - uses: actions/checkout@v4\n\n      - uses: actions/setup-node@v4");
    expectRule(checkNoSilentSkips(text), "no-silent-skips");
  });

  it("refuses a sparse checkout", () => {
    const text = mutate(
      CI,
      "    name: solver-v3\n    runs-on: ubuntu-latest\n    timeout-minutes: 15\n    steps:\n      - uses: actions/checkout@v4\n",
      "    name: solver-v3\n    runs-on: ubuntu-latest\n    timeout-minutes: 15\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          sparse-checkout: gcf_v3\n",
    );
    expectRule(checkNoSilentSkips(text), "no-silent-skips");
  });

  const V3_TESTS = "        run: python -m unittest discover -s gcf_v3 -t gcf_v3 -v\n";

  it("refuses a step `shell:` — `bash -c 'true' {0}` runs nothing and stays green", () => {
    const text = mutate(CI, V3_TESTS, `${V3_TESTS}        shell: bash -c 'true' {0}\n`);
    expectRule(checkNoSilentSkips(text), "no-silent-skips");
  });

  it("refuses a step `working-directory:` — the command would discover from somewhere else", () => {
    const text = mutate(CI, V3_TESTS, `${V3_TESTS}        working-directory: gcf_v3\n`);
    expectRule(checkNoSilentSkips(text), "no-silent-skips");
  });

  it("refuses `defaults:` at workflow level and at job level", () => {
    const workflow = mutate(
      CI,
      "permissions:\n  contents: read\n",
      "permissions:\n  contents: read\n\ndefaults:\n  run:\n    shell: bash -c 'true' {0}\n",
    );
    expectRule(checkNoSilentSkips(workflow), "no-silent-skips");
    const job = mutate(CI, "    name: solver-v2\n", "    name: solver-v2\n    defaults:\n      run:\n        working-directory: gcf\n");
    expectRule(checkNoSilentSkips(job), "no-silent-skips");
  });
});

describe("solver commands (negative cases)", () => {
  it("refuses a matrix on solver-v2 — the golden would run N times", () => {
    const text = mutate(
      CI,
      "    name: solver-v2\n",
      "    name: solver-v2\n    strategy:\n      matrix:\n        python: ['3.12', '3.13']\n",
    );
    expectRule(checkSolverCommands(text).problems, "commands");
  });

  it("refuses a third `unittest discover` over `.`", () => {
    const text = mutate(
      CI,
      "      - name: Lint\n        run: npx eslint .\n",
      "      - name: Lint\n        run: npx eslint .\n\n      - name: Everything\n        run: python -m unittest discover -s . -t . -v\n",
    );
    expectRule(checkSolverCommands(text).problems, "commands");
  });

  it("refuses `-s gcf_v3 -t .`", () => {
    const text = mutate(CI, "discover -s gcf_v3 -t gcf_v3 -v", "discover -s gcf_v3 -t . -v");
    expectRule(checkSolverCommands(text).problems, "commands");
  });

  it("refuses a `-p` pattern", () => {
    const text = mutate(CI, "discover -s gcf_v3 -t gcf_v3 -v", "discover -s gcf_v3 -t gcf_v3 -p '*_test.py' -v");
    expectRule(checkSolverCommands(text).problems, "commands");
  });

  it("refuses a reformatted `run: |` block instead of parsing nothing", () => {
    const text = mutate(
      CI,
      "        run: python -m unittest discover -s gcf -t gcf -v\n",
      "        run: |\n          python -m unittest discover -s gcf -t gcf -v\n",
    );
    expectRule(checkSolverCommands(text).problems, "commands");
  });

  it("refuses a solver job on another runner", () => {
    const text = mutate(CI, "    name: solver-v2\n    runs-on: ubuntu-latest\n", "    name: solver-v2\n    runs-on: ubuntu-24.04-arm\n");
    expectRule(checkSolverCommands(text).problems, "commands");
  });

  it("refuses a solver job that installs the other tree's requirements", () => {
    const text = mutate(CI, "run: pip install -r gcf_v3/requirements.txt", "run: pip install -r gcf/requirements.txt");
    expectRule(checkSolverCommands(text).problems, "commands");
  });
});

describe("partition: every test module in exactly one job (negative cases)", () => {
  it("refuses a test file in an `__init__`-less subdirectory — it would run nowhere", () => {
    const problems = checkPartition({
      gcf: V2,
      gcf_v3: [...SCAFFOLD, { path: "gcf_v3/sub/test_x.py", text: "" }],
    });
    expectRule(problems, "partition");
    expect(problems.join("\n")).toContain("gcf_v3/sub/test_x.py");
  });

  it("reaches a test module whose whole directory chain has `__init__.py`", () => {
    const entries = [
      ...SCAFFOLD,
      { path: "gcf_v3/tests/__init__.py", text: "" },
      { path: "gcf_v3/tests/test_x.py", text: "" },
      { path: "gcf_v3/acceptance/__init__.py", text: "" },
      { path: "gcf_v3/acceptance/run.py", text: "" },
    ];
    expect(discoverTests("gcf_v3", entries).reachable.sort()).toEqual([
      "gcf_v3/test_scaffold.py",
      "gcf_v3/tests/test_x.py",
    ]);
    expect(checkPartition({ gcf: V2, gcf_v3: entries })).toEqual([]);
  });

  it("refuses a `*_test.py` file", () => {
    expectRule(checkPartition({ gcf: V2, gcf_v3: [...SCAFFOLD, { path: "gcf_v3/foo_test.py", text: "" }] }), "partition");
  });

  it("refuses a `test*.py` that is not a valid module name", () => {
    expectRule(checkPartition({ gcf: V2, gcf_v3: [...SCAFFOLD, { path: "gcf_v3/test-x.py", text: "" }] }), "partition");
  });

  it("refuses a `load_tests` definition", () => {
    const entries = [...SCAFFOLD, { path: "gcf_v3/test_more.py", text: "def load_tests(loader, tests, pattern):\n    return tests\n" }];
    expectRule(checkPartition({ gcf: V2, gcf_v3: entries }), "partition");
  });

  it("refuses an empty `gcf_v3` — the job would exit 5 (NO TESTS RAN)", () => {
    expectRule(checkPartition({ gcf: V2, gcf_v3: [] }), "partition");
  });
});

describe("walkTree", () => {
  it("skips dot-directories, venv and __pycache__ — a local environment is not the tree", () => {
    // A `.venv` inside gcf/ or gcf_v3/ carries site-packages full of test*.py that
    // discovery never reaches; walking it would turn every local `npm test` red.
    const root = mkdtempSync(join(tmpdir(), "ci-layout-"));
    try {
      const put = (path: string, body = "") => {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), body);
      };
      put("gcf_v3/test_ok.py");
      put("gcf_v3/tests/__init__.py");
      put("gcf_v3/tests/test_pkg.py");
      put("gcf_v3/.venv/lib/python3.12/site-packages/pkg/test_vendored.py");
      put("gcf_v3/venv/lib/test_vendored.py");
      put("gcf_v3/tests/.pytest_cache/test_cached.py");
      put("gcf_v3/__pycache__/test_ok.cpython-312.pyc");
      put("gcf_v3/.gcloudignore");
      expect(walkTree(root, "gcf_v3").map((e) => e.path).sort()).toEqual([
        "gcf_v3/.gcloudignore",
        "gcf_v3/test_ok.py",
        "gcf_v3/tests/__init__.py",
        "gcf_v3/tests/test_pkg.py",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("cross-tree imports (I2)", () => {
  // `python -m unittest` puts the repository root on sys.path, so `gcf` resolves
  // as a namespace package inside the v3 job (and `gcf_v3` inside the v2 job).
  // The start directory isolates nothing; this rule does.
  const v3With = (text: string) => ({ gcf: V2, gcf_v3: [...SCAFFOLD, { path: "gcf_v3/x.py", text }] });

  it("refuses `from gcf.owt_solver_v2 import solve` under gcf_v3/", () => {
    expectRule(checkCrossTreeImports(v3With("from gcf.owt_solver_v2 import solve\n")), "cross-tree-import");
  });

  it("refuses `import gcf` under gcf_v3/", () => {
    expectRule(checkCrossTreeImports(v3With("import gcf\n")), "cross-tree-import");
  });

  it("refuses an import of gcf hidden in a list, an indented block, or after a `;`", () => {
    expectRule(checkCrossTreeImports(v3With("import os, gcf.main as m\n")), "cross-tree-import");
    expectRule(checkCrossTreeImports(v3With("try:\n    from gcf import main\nexcept ImportError:\n    pass\n")), "cross-tree-import");
    expectRule(checkCrossTreeImports(v3With("x = 1; import gcf\n")), "cross-tree-import");
  });

  it("refuses `from owt_v3 import codes` under gcf/", () => {
    const problems = checkCrossTreeImports({ gcf: [...V2, { path: "gcf/x.py", text: "from owt_v3 import codes\n" }], gcf_v3: SCAFFOLD });
    expectRule(problems, "cross-tree-import");
  });

  it("refuses `import gcf_v3.owt_v3` under gcf/", () => {
    const problems = checkCrossTreeImports({ gcf: [...V2, { path: "gcf/x.py", text: "import gcf_v3.owt_v3\n" }], gcf_v3: SCAFFOLD });
    expectRule(problems, "cross-tree-import");
  });

  it("does NOT read `from gcf_v3.owt_v3 import x` under gcf_v3/ as a gcf import", () => {
    expect(checkCrossTreeImports(v3With("from gcf_v3.owt_v3 import x\nimport gcf_v3\n"))).toEqual([]);
  });

  it("does not read a comment or a relative import as a gcf import", () => {
    expect(checkCrossTreeImports(v3With("# never import gcf here\nfrom . import gcf\n"))).toEqual([]);
  });
});

describe("golden placement", () => {
  it("refuses a gcf tree where test_inertness.py is unreachable", () => {
    const gcf = [{ path: "gcf/owt_solver_v2.py", text: "" }, { path: "gcf/test_other.py", text: "" }];
    expectRule(checkGoldenPlacement(CI, { gcf, gcf_v3: SCAFFOLD }), "golden");
  });
});

describe("the workflow reader fails closed", () => {
  it("throws on YAML it does not model (an anchor)", () => {
    expect(() => parseWorkflow("jobs:\n  a: &x\n    runs-on: ubuntu-latest\n")).toThrow();
  });

  it("throws on a multi-line plain scalar rather than misreading it", () => {
    expect(() => parseWorkflow("jobs:\n  a:\n    name: one\n      two\n")).toThrow();
  });

  it("reports an unreadable workflow as a problem, never as a pass", () => {
    expectRule(layoutProblems(CI, [{ file: ".github/workflows/odd.yml", text: "jobs:\n  a: *alias\n" }]), "parse");
  });
});

describe("gatesVerdict", () => {
  const ok = { node: { result: "success", outputs: {} }, "solver-v2": { result: "success", outputs: {} }, "solver-v3": { result: "success", outputs: {} } };

  it("passes only when every needed job succeeded", () => {
    expect(gatesVerdict(JSON.stringify(ok)).ok).toBe(true);
    for (const result of ["failure", "cancelled", "skipped", undefined]) {
      const v = gatesVerdict(JSON.stringify({ ...ok, "solver-v3": { result } }));
      expect(v.ok, `result ${result}`).toBe(false);
      expect(v.lines.join("\n")).toContain("solver-v3");
    }
  });

  it("fails on an empty, malformed or missing input", () => {
    expect(gatesVerdict("{}").ok).toBe(false);
    expect(gatesVerdict("not json").ok).toBe(false);
    expect(gatesVerdict("[]").ok).toBe(false);
    expect(gatesVerdict("null").ok).toBe(false);
    expect(gatesVerdict(undefined).ok).toBe(false);
    expect(gatesVerdict("").ok).toBe(false);
  });
});

describe("the verdict runner, executed as a process", () => {
  // Asserting the file CONTAINS both exits would pass with them swapped — and a
  // swapped `gates` merges every red PR. So the runner runs, and is judged on
  // the exit code GitHub reads.
  function runVerdict(needs: string | undefined) {
    const env = { ...process.env };
    delete env.NEEDS_JSON;
    if (needs !== undefined) env.NEEDS_JSON = needs;
    const result = spawnSync(process.execPath, [runner], { env, encoding: "utf8" });
    expect(result.error, `spawning the verdict runner failed: ${result.error?.message}`).toBeUndefined();
    return result;
  }
  const all = (result: string) =>
    JSON.stringify({ node: { result: "success" }, "solver-v2": { result: "success" }, "solver-v3": { result } });

  it("exits 0 when all three jobs succeeded", () => {
    expect(runVerdict(all("success")).status).toBe(0);
  });

  it("exits non-zero and names the job for failure, cancelled and skipped", () => {
    for (const result of ["failure", "cancelled", "skipped"]) {
      const r = runVerdict(all(result));
      expect(r.status, result).not.toBe(0);
      expect(r.stdout, result).toContain("solver-v3");
      expect(r.stdout, result).toContain(result);
    }
  });

  it("exits non-zero for `{}`, malformed JSON and a missing NEEDS_JSON", () => {
    expect(runVerdict("{}").status).not.toBe(0);
    expect(runVerdict("{not json").status).not.toBe(0);
    expect(runVerdict(undefined).status).not.toBe(0);
  });
});
