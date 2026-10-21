import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DIFF_ARGS, parseDiffZ, SCOPE_JOB, SKIPPABLE_JOBS, scopeDecision } from "../lib/ci-scope.mjs";

// The `scope` job decides whether a pull request needs `solver-v2` (ADR-0065).
// A wrong "false" is the one way an untested gcf/ change could reach `main`, so
// every doubt must come out "true", and the runner is executed as a process
// against a real merge commit — a model of `git diff` would not catch a rename
// slipping out of gcf/ unseen.

const runner = resolve(__dirname, "../ci/ci-scope.mjs");

describe("SKIPPABLE_JOBS", () => {
  it("is solver-v2 alone — widening it is a decision for an ADR, not a drive-by", () => {
    expect(Object.keys(SKIPPABLE_JOBS)).toEqual(["solver-v2"]);
    expect(SCOPE_JOB).toBe("scope");
  });

  it("reads the diff raw: rename detection off, NUL-separated, no C-quoting", () => {
    expect(DIFF_ARGS).toContain("--no-renames");
    expect(DIFF_ARGS).toContain("-z");
    expect(DIFF_ARGS.slice(0, 2)).toEqual(["-c", "core.quotePath=false"]);
  });

  it("parseDiffZ keeps every path byte for byte", () => {
    expect(parseDiffZ("gcf/a b.py\0 app/x.ts\0gcf/café.py\0")).toEqual(["gcf/a b.py", " app/x.ts", "gcf/café.py"]);
    expect(parseDiffZ("")).toEqual([]);
  });
});

describe("scopeDecision", () => {
  const pr = (changed: string[] | null) => scopeDecision({ event: "pull_request", changed }).outputs["solver-v2"];

  it("runs everything on a push, a manual run or an unknown event", () => {
    for (const event of ["push", "workflow_dispatch", "", undefined]) {
      expect(scopeDecision({ event, changed: ["app/page.tsx"] }).outputs["solver-v2"], String(event)).toBe("true");
    }
  });

  it("runs when the diff could not be read or is empty", () => {
    expect(pr(null)).toBe("true");
    expect(pr([])).toBe("true");
  });

  it("skips a PR that touches only the app, docs or the v3 tree", () => {
    expect(pr(["app/page.tsx", "docs/CI.md", "gcf_v3/owt_v3/solve.py", "gcf_v3/cloudbuild.yaml", "scripts/lib/other.mjs", "scripts/deploy-solver-v3-gcf.sh"])).toBe("false");
  });

  it("runs when the PR touches gcf/, any workflow, or the CI machinery", () => {
    for (const path of [
      "gcf/owt_solver_v2.py",
      "gcf/requirements.txt",
      "cloudbuild.yaml",
      "scripts/deploy-solver-gcf.sh",
      ".github/workflows/ci.yml",
      ".github/workflows/other.yml",
      "scripts/ci/gates-verdict.mjs",
      "scripts/ci/ci-scope.mjs",
      "scripts/lib/ci-layout.mjs",
      "scripts/lib/ci-scope.mjs",
    ]) {
      expect(pr(["app/page.tsx", path]), path).toBe("true");
    }
  });

  it("does not read `gcf_v3/` or a `gcf` file at the root as gcf/", () => {
    expect(pr(["gcf_v3/main.py"])).toBe("false");
    expect(pr(["gcf.md"])).toBe("false");
  });

  it("says why, in the log", () => {
    expect(scopeDecision({ event: "pull_request", changed: ["app/a.ts"] }).lines.join("\n")).toContain("SKIP");
    expect(scopeDecision({ event: "pull_request", changed: ["gcf/main.py"] }).lines.join("\n")).toContain("gcf/main.py");
  });
});

describe("the scope runner, executed as a process against a real merge commit", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  const git = (cwd: string, ...args: string[]) => {
    const r = spawnSync("git", ["-c", "user.email=ci@example.invalid", "-c", "user.name=ci", "-c", "init.defaultBranch=main", ...args], {
      cwd,
      encoding: "utf8",
    });
    expect(r.status, `git ${args.join(" ")}: ${r.stderr}`).toBe(0);
  };
  const put = (root: string, path: string, body = "x\n") => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  };

  /** A repo whose HEAD is a pull request's merge commit: base on parent 1, the PR's change on parent 2. */
  function repoWithPr(change: (root: string) => void): string {
    const root = mkdtempSync(join(tmpdir(), "ci-scope-"));
    dirs.push(root);
    git(root, "init", "-q");
    put(root, "gcf/owt_solver_v2.py");
    put(root, "app/page.tsx");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "base");
    git(root, "checkout", "-q", "-b", "pr");
    change(root);
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "change");
    git(root, "checkout", "-q", "main");
    put(root, "docs/unrelated.md"); // the base moved on: the merge commit's diff must not list it
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "base moves");
    git(root, "merge", "-q", "--no-ff", "-m", "merge", "pr");
    return root;
  }

  function run(cwd: string, event: string | undefined, withOutput = true) {
    const env = { ...process.env };
    delete env.EVENT_NAME;
    delete env.GITHUB_OUTPUT;
    if (event !== undefined) env.EVENT_NAME = event;
    let out: string | null = null;
    if (withOutput) {
      out = join(cwd, ".github-output");
      writeFileSync(out, "");
      env.GITHUB_OUTPUT = out;
    }
    const r = spawnSync(process.execPath, [runner], { cwd, env, encoding: "utf8" });
    expect(r.error).toBeUndefined();
    return { status: r.status, stdout: r.stdout, output: out ? readFileSync(out, "utf8") : null };
  }

  it("writes solver-v2=false for a PR that touches only the app", () => {
    const root = repoWithPr((r) => put(r, "app/page.tsx", "changed\n"));
    const r = run(root, "pull_request");
    expect(r.status).toBe(0);
    expect(r.output).toBe("solver-v2=false\n");
  });

  it("writes solver-v2=true for a PR that edits gcf/", () => {
    const root = repoWithPr((r) => put(r, "gcf/owt_solver_v2.py", "changed\n"));
    expect(run(root, "pull_request").output).toBe("solver-v2=true\n");
  });

  it("writes solver-v2=true for a PR that moves a file OUT of gcf/", () => {
    const root = repoWithPr((r) => {
      mkdirSync(join(r, "lib"));
      git(r, "mv", "gcf/owt_solver_v2.py", "lib/owt_solver_v2.py");
    });
    expect(run(root, "pull_request").output).toBe("solver-v2=true\n");
  });

  it("writes solver-v2=true for a PR that adds a gcf/ file git would C-quote", () => {
    const root = repoWithPr((r) => put(r, "gcf/datos_café\tx.json"));
    expect(run(root, "pull_request").output).toBe("solver-v2=true\n");
  });

  it("writes solver-v2=true on a push, whatever changed", () => {
    const root = repoWithPr((r) => put(r, "app/page.tsx", "changed\n"));
    expect(run(root, "push").output).toBe("solver-v2=true\n");
  });

  it("writes solver-v2=true when HEAD has no parent to diff against", () => {
    const root = mkdtempSync(join(tmpdir(), "ci-scope-"));
    dirs.push(root);
    git(root, "init", "-q");
    put(root, "app/page.tsx");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "only");
    const r = run(root, "pull_request");
    expect(r.status).toBe(0);
    expect(r.output).toBe("solver-v2=true\n");
  });

  it("exits non-zero without GITHUB_OUTPUT, so scope goes red rather than deciding nothing", () => {
    const root = repoWithPr((r) => put(r, "app/page.tsx", "changed\n"));
    expect(run(root, "pull_request", false).status).not.toBe(0);
  });
});
