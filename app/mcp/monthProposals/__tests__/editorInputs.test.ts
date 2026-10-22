// T2.3's structural guard: every rule judgment the editor makes takes `(column, config, spine)` from
// `columnRuleInputs`. The planner's gates and finder enforce NOTHING when one is missing (the grid
// tolerates that while its rules load); the editor must never call them around the builder. So:
// the gates are called only in `editorBoard.ts`, and there only inside a function that asks
// `columnRuleInputs` first.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/scripts/lib/strip-comments.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(HERE, "..");
const TOOL = path.resolve(HERE, "../../tools/proposalEditor.ts");
const STORED_TOOL = path.resolve(HERE, "../../tools/serviceEditor.ts");
const GATES = ["judgePick", "pickCandidates", "evaluateMove", "ruleFindings", "ruleRefusals", "rankCandidates", "evaluate", "sundaySpineForColumn"];
const callOf = (name: string) => new RegExp(`(?<![\\w.])${name}\\s*\\(`, "g");

const files = [
  ...readdirSync(DIR).filter((f) => f.endsWith(".ts")).map((f) => path.join(DIR, f)),
  TOOL,
  STORED_TOOL,
];

describe("the editor's rule judgments go through columnRuleInputs", () => {
  it("no editor module but editorBoard.ts calls a gate, the finder or the spine", () => {
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      if (path.basename(file) === "editorBoard.ts") continue;
      const code = stripComments(readFileSync(file, "utf8"));
      for (const g of GATES) expect(code.match(callOf(g)), `${path.basename(file)} calls ${g}`).toBeNull();
    }
  });

  it("in editorBoard.ts, each function that calls one asks columnRuleInputs first", () => {
    const code = stripComments(readFileSync(path.join(DIR, "editorBoard.ts"), "utf8"));
    // Top-level functions, split at each `export function` / `function`.
    const fns = code.split(/\n(?=(?:export )?function )/).filter((chunk) => /^(?:export )?function /.test(chunk));
    let judged = 0;
    for (const fn of fns) {
      const name = fn.match(/function (\w+)/)![1];
      if (name === "columnRuleInputs" || name === "pickContext") continue;
      const calls = GATES.filter((g) => callOf(g).test(fn));
      if (calls.length === 0) continue;
      judged++;
      const at = fn.search(/columnRuleInputs\s*\(/);
      expect(at, `${name} calls ${calls.join(", ")} without columnRuleInputs`).toBeGreaterThan(-1);
      for (const g of calls) expect(fn.search(callOf(g)), `${name}: ${g} before columnRuleInputs`).toBeGreaterThan(at);
    }
    expect(judged).toBeGreaterThanOrEqual(4);
  });
});
