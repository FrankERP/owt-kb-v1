// `scripts/seed-solver-config.ts` run as a process (solver v3 C3 §6.9, T12).
//
// The capture goes through the SAME parser as the route, so a capture holding
// two `==` caps on one role for one person text (parent A38), or an invalid
// cadence, is refused with its issue path — before any Sanity client exists,
// so nothing is read and nothing is written. Running the real script under
// `tsx` also proves `tsx` resolves the parser's runtime `@/` import of
// `plannerModel` (`rolesOfPattern`), which the seed did not need before C3.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const TSX = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");
const SCRIPT = path.join(REPO_ROOT, "scripts", "seed-solver-config.ts");

let work: string;
beforeEach(() => { work = mkdtempSync(path.join(tmpdir(), "seed-solver-config-")); });
afterEach(() => rmSync(work, { recursive: true, force: true }));

function runSeed(capture: unknown) {
  const file = path.join(work, "capture.json");
  writeFileSync(file, JSON.stringify(capture));
  // A dummy token: the script checks it is set before parsing, and the parse
  // refusal returns before a client is ever constructed with it.
  return spawnSync(TSX, [SCRIPT, file], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, SANITY_WRITE_TOKEN: "dummy-not-a-token" },
    timeout: 60_000,
  });
}

const restriction = (patch: Record<string, unknown>) => ({
  id: "r-1", person: "Ana", excludedPatterns: [], fairness: "none", fairnessSlack: 1, weekExclusions: [], caps: [], ...patch,
});

describe("seed-solver-config — refusals before any read (C3 T12)", () => {
  it("refuses a capture with two exact counts for one role of one person, naming the later cap", () => {
    const result = runSeed({
      restrictions: [restriction({
        caps: [
          { id: "c-1", pattern: "Sun.Lead", op: "==", value: 2 },
          { id: "c-2", pattern: "Sun.*", op: "==", value: 1 },
        ],
      })],
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Nothing was written.");
    expect(result.stderr).toContain("restrictions[0].caps[1]:exact_overlap");
    expect(result.stdout).not.toContain("Target:"); // printed only once a client is about to read
  }, 60_000);

  it("refuses a capture with an invalid «Domingo» value", () => {
    const result = runSeed({ restrictions: [restriction({ sundayCadence: "normal" })] });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("restrictions[0].sundayCadence");
    expect(result.stdout).not.toContain("Target:");
  }, 60_000);
});

describe("seed-solver-config — what it prints (C3 §6.9, parent A41)", () => {
  it("every summary — dry run and both halves of the REFUSING diff — goes through solverConfigSummaryLines", () => {
    const src = readFileSync(SCRIPT, "utf8");
    expect(src).toContain('import { solverConfigSummaryLines } from "./lib/solverConfigSummary";');
    expect(src.match(/summarize\("/g) ?? []).toHaveLength(3);
    // No rule key and no person text is interpolated anywhere in the script.
    for (const leak of ["${r.id}", "${r.person}", "${x.id}", "${x.personA}", "${p.id}", "persons.join"]) {
      expect(src, leak).not.toContain(leak);
    }
  });
});
