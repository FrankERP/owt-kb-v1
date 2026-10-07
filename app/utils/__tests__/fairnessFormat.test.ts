// Solver v3 C2 IF2-13 — the one fairness-figure formatter, and the guard that nothing
// under app/** derives a display figure from the wire's hundredths (UI-4, A17).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { stripComments } from "../../../scripts/lib/strip-comments.mjs";
import { formatFairnessTenths, saldoWords } from "../fairnessFormat";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("formatFairnessTenths (C2 IF2-13)", () => {
  it.each([
    [8, "0.8"],
    [-13, "-1.3"],
    [0, "0.0"],
    [10, "1.0"],
    [-5, "-0.5"],
    [127, "12.7"],
  ])("%d tenths → %s", (tenths, text) => {
    expect(formatFairnessTenths(tenths)).toBe(text);
  });
});

describe("saldoWords (C2 §8)", () => {
  it("says who is owed, who has extra, and «al día» at zero", () => {
    expect(saldoWords(7)).toBe("le deben 0.7");
    expect(saldoWords(-3)).toBe("0.3 de más");
    expect(saldoWords(-12)).toBe("1.2 de más");
    expect(saldoWords(0)).toBe("al día");
  });
});

describe("no code derives tenths or seats from the wire's hundredths (UI-4)", () => {
  it("finds no division of a share, balance or received figure by 10 or 100 under app/**", () => {
    const files = execFileSync("git", ["ls-files", "app"], { cwd: REPO_ROOT, encoding: "utf8" })
      .split("\n")
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/(^|\/)__tests__\//.test(f) && !/\.test\./.test(f));
    const offenders = files.filter((f) => {
      const code = stripComments(readFileSync(path.join(REPO_ROOT, f), "utf8"));
      return /\b(share|balance|received)\b\s*\)?\s*\/\s*10{1,2}\b/.test(code);
    });
    expect(offenders).toEqual([]);
  });
});
