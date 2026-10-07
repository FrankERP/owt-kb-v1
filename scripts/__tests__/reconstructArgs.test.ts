// Solver v3 C4 — the reconstruction CLI's arguments («Provides»), its month scope (R1)
// and its private-path refusal (R11). No argument value is ever echoed back (R12).
// Every name is fictitious.
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defaultPreviewRun, notPastMonths, parseReconstructArgs, privatePathRefusals } from "../lib/reconstructArgs";
import type { GitFs } from "../lib/solverHistoryDiffRun";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const FP = "a".repeat(64);
let work: string;

beforeEach(() => {
  work = mkdtempSync(path.join(tmpdir(), "owt-reconstruct-args-"));
});
afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

describe("arguments («Provides», R18, R19)", () => {
  it("parses a dry run with the months oldest first", () => {
    expect(parseReconstructArgs(["--months", "2026-09,2026-08", "--out", "/x"])).toEqual({
      mode: "dry-run",
      months: ["2026-08", "2026-09"],
      out: "/x",
      overrides: null,
      previewRun: null,
      plan: null,
      fingerprint: null,
    });
  });

  it("lets an apply take its months from the plan, and tells the four modes apart", () => {
    expect(parseReconstructArgs(["--apply", "--plan", "/p.json", "--fingerprint", FP, "--out", "/x"])).toMatchObject({
      mode: "apply",
      months: null,
      plan: "/p.json",
      fingerprint: FP,
    });
    expect(parseReconstructArgs(["--rollback", "--months", "2026-08", "--out", "/x"])).toMatchObject({ mode: "rollback" });
    expect(
      parseReconstructArgs(["--rollback", "--apply", "--plan", "/p.json", "--fingerprint", FP, "--out", "/x"]),
    ).toMatchObject({ mode: "rollback-apply" });
  });

  it.each<[string[], RegExp]>([
    [["--out", "/x"], /--months es obligatorio/],
    [["--months", "2026-08"], /--out <carpeta> es obligatorio/],
    [["--months", "2026-8", "--out", "/x"], /YYYY-MM/],
    [["--months", "2026-08,2026-08", "--out", "/x"], /repite un mes/],
    [["--months", "2026-08", "--out", "/x", "--preview-run", "2026-13"], /--preview-run debe ser YYYY-MM/],
    [["--months", "2026-08", "--out", "/x", "--rollback", "--overrides", "/o.json"], /--rollback no acepta --overrides/],
    [["--months", "2026-08", "--out", "/x", "--rollback", "--preview-run", "2026-09"], /--rollback no acepta --preview-run/],
    [["--months", "2026-08", "--out", "/x", "--apply"], /--apply necesita --plan/],
    [["--out", "/x", "--apply", "--plan", "/p.json"], /--fingerprint/],
    [["--out", "/x", "--apply", "--plan", "/p.json", "--fingerprint", "ABC"], /--fingerprint/],
    [["--months", "2026-08", "--out", "/x", "--plan", "/p.json"], /--plan solo va con --apply/],
    [["--months", "2026-08", "--out", "/x", "--fingerprint", FP], /--fingerprint solo va con --apply/],
    [["--months", "2026-08", "--out", "/x", "--out", "/y"], /--out se dio dos veces/],
    [["--months", "2026-08", "--out"], /--out necesita un valor/],
  ])("refuses %j", (argv, message) => {
    const parsed = parseReconstructArgs(argv);
    expect("error" in parsed ? parsed.error : "").toMatch(message);
  });

  it("refuses an unexpected argument by position, without echoing it (R12)", () => {
    const parsed = parseReconstructArgs(["--months", "2026-08", "--out", "/x", "Ana Ejemplo"]);
    expect(parsed).toEqual({ error: "argumento inesperado en la posición 5" });
  });
});

describe("months (R1, A21)", () => {
  it("lets through only months strictly before the current CDMX month", () => {
    expect(notPastMonths(["2026-08", "2026-09", "2026-10"], "2026-10")).toEqual(["2026-10"]);
    expect(notPastMonths(["2026-10"], "2026-11")).toEqual([]);
    expect(notPastMonths(["2026-11"], "2026-10")).toEqual(["2026-11"]);
  });

  it("defaults the preview run to the month after the last requested month", () => {
    expect(defaultPreviewRun(["2026-08", "2026-09"])).toBe("2026-10");
    expect(defaultPreviewRun(["2026-12"])).toBe("2027-01");
  });
});

describe("private paths (R11)", () => {
  const refusalsFor = (file: string) => privatePathRefusals([{ flag: "--out", file }], REPO_ROOT, process.platform).refusals;

  it("accepts a folder outside the repository", () => {
    expect(refusalsFor(path.join(work, "out"))).toEqual([]);
  });

  it("refuses a folder inside the repository, naming the flag and not the path", () => {
    const refusals = refusalsFor(path.join(REPO_ROOT, "tmp-reconstruct-out"));
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatch(/^--out está dentro del repositorio/);
    expect(refusals[0]).not.toContain("tmp-reconstruct-out");
  });

  it("refuses a symlink that lands inside the repository", () => {
    const link = path.join(work, "link");
    symlinkSync(REPO_ROOT, link);
    expect(refusalsFor(path.join(link, "out"))).toHaveLength(1);
  });

  it("refuses a sibling working tree of the same repository (`--plan` too)", () => {
    const tree: Record<string, string | string[]> = {
      "/r/wt1/.git": "gitdir: /r/main/.git/worktrees/wt1\n",
      "/r/main/.git/worktrees/wt1": ["gitdir", "commondir"],
      "/r/main/.git/worktrees/wt1/commondir": "../..\n",
      "/r/main/.git/worktrees/wt1/gitdir": "/r/wt1/.git\n",
      "/r/main/.git/worktrees": ["wt1", "wt2"],
      "/r/main/.git/worktrees/wt2/gitdir": "/r/wt2/.git\n",
    };
    const fs: GitFs = {
      readFile: (p) => (typeof tree[p] === "string" ? (tree[p] as string) : null),
      readDir: (p) => (Array.isArray(tree[p]) ? (tree[p] as string[]) : null),
    };
    const result = privatePathRefusals([{ flag: "--plan", file: "/r/wt2/plan.json" }], "/r/wt1", "linux", fs);
    expect(result.problem).toBeNull();
    expect(result.refusals).toHaveLength(1);
    expect(result.refusals[0]).toMatch(/^--plan está dentro del repositorio/);
  });

  it("reports a repository it cannot locate as a problem, so the caller refuses", () => {
    const fs: GitFs = { readFile: (p) => (p === "/r/bad/.git" ? "not a gitdir line\n" : null), readDir: () => null };
    expect(privatePathRefusals([{ flag: "--out", file: "/elsewhere" }], "/r/bad", "linux", fs).problem).toMatch(/cannot locate the repository/);
  });
});
