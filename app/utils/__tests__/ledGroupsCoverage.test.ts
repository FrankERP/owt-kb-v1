// I3 — «which groups does this person lead» has ONE answer: `ledGroupsIn` (`app/utils/ministryAccess.ts`;
// plan `docs/superpowers/plans/2026-11-11-jovenes-per-group-leadership.md` §4.2 I3, §11 N6; ADR-0085).
//
// WHY THIS EXISTS. Before per-group leadership, "is a leader" was open-coded as
// `levelIn(...) === "leader"` in five places, each pairing it with ALL the person's groups. A sixth
// copy written tomorrow would grant a leader of Otro Nivel the drafts and the writes of every group
// they are merely IN — with no error, and no test of the new page would notice. So the rule is a
// source scan, not a sentence:
//
//   A LEVEL COMPARISON is a line of comment-stripped code that names a quoted `leader` (any quote
//   style) together with `level` (`levelIn(`, `.level`, `levelOf(`, a GROQ `level ==` …). Outside
//   `app/ministries.ts` (the normalizer and the write validator) and `ministryAccess.ts` (where
//   `ledGroupsIn` lives), only the EXACT lines in `ALLOWED_LINES` may hold one — each a display or a
//   form/storage rule that decides no access. A new line anywhere, even in an allow-listed file, fails.
//
// What it does NOT scan (§11 N6): `arm.kind === "leader"` in `ministryEventReads.ts` — the name of
// the read's arm, chosen BY `ledGroupsIn`, not a level. What it does not see, accepted: a comparison
// split across lines, or a level held in a variable whose name has no `level` in it. Review catches
// those; this catches the copy-paste of today's five.
//
// It reads `git ls-files`: stage a new file before running it.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { stripComments } from "../../../scripts/lib/strip-comments.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** Whole files that own the reading of a level. */
const OWNERS = ["app/ministries.ts", "app/utils/ministryAccess.ts"];

/**
 * Exact lines (trimmed, comment-stripped) that compare a level with `"leader"` and decide no access.
 * Adding one is a reviewed change to this list; a line that no longer exists fails too.
 */
const ALLOWED_LINES: Array<{ file: string; line: string; why: string }> = [
  {
    file: "app/components/admin/MembersPanel.tsx",
    line: 'if (tickedLeveled.some((id) => levelOf(id).level === "leader" && levelOf(id).groups.length === 0)) {',
    why: "the form's friendly refusal of a leader with no group; the writer enforces it",
  },
  {
    file: "app/utils/memberCommit.ts",
    line: 'if (item.level !== "leader") {',
    why: "K1 (PR 1 only): what a write STORES for a non-leader request item; PR 2 deletes it",
  },
  {
    file: "app/utils/memberCommit.ts",
    line: 'const storedLeader = before?.level === "leader" && raw.length === 1 && raw[0].leaderOf !== undefined && raw[0].leaderOf !== null;',
    why: "K1 (PR 1 only): whether the stored item names its own led groups; PR 2 deletes it",
  },
  {
    file: "app/utils/memberCommit.ts",
    line: 'if (r.level === "leader" && sameGroups(storedLed, storedGroups)) continue;',
    why: "K1 (PR 1 only): a stored item the read dropped that said «leads all»; PR 2 deletes it",
  },
];

/** True for a line that compares (or otherwise pairs) a level with the literal `leader`. */
function isLevelComparison(line: string): boolean {
  return /["'`]leader["'`]/.test(line) && /level/i.test(line);
}

function scannedFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "app", "sanity"], { cwd: REPO_ROOT, encoding: "utf8" });
  return out
    .split("\n")
    .filter((f) => /\.(ts|tsx|js|mjs)$/.test(f))
    .filter((f) => !/(^|\/)__tests__\//.test(f) && !/\.test\.[^/]+$/.test(f));
}

function findings(): Array<{ file: string; line: string }> {
  const found: Array<{ file: string; line: string }> = [];
  for (const file of scannedFiles()) {
    if (OWNERS.includes(file)) continue;
    const code = stripComments(readFileSync(path.join(REPO_ROOT, file), "utf8"));
    for (const raw of code.split("\n")) {
      const line = raw.trim();
      if (isLevelComparison(line)) found.push({ file, line });
    }
  }
  return found;
}

describe("I3: no level comparison with \"leader\" outside the owners", () => {
  it("the detector catches today's five shapes and skips the read's arm name", () => {
    expect(isLevelComparison('if (levelIn(access, "jovenes") === "leader") return x;')).toBe(true);
    expect(isLevelComparison("return r.level !== 'leader';")).toBe(true);
    expect(isLevelComparison('const q = `*[level == "leader"]`;')).toBe(true);
    expect(isLevelComparison("if (levelOf(id).level === `leader`) {}")).toBe(true);
    expect(isLevelComparison('if (arm.kind === "leader") {}')).toBe(false);
    expect(isLevelComparison('const LABEL = { leader: "Líder" };')).toBe(false);
  });

  it("every level comparison outside app/ministries.ts and ministryAccess.ts is an allow-listed line", () => {
    const allowed = new Set(ALLOWED_LINES.map((a) => `${a.file}\n${a.line}`));
    const stray = findings().filter((f) => !allowed.has(`${f.file}\n${f.line}`));
    expect(stray, "Decide who leads a group with ledGroupsIn (app/utils/ministryAccess.ts), never a level comparison").toEqual([]);
  });

  it("every allow-listed line still exists (a stale entry would excuse a future copy)", () => {
    const present = new Set(findings().map((f) => `${f.file}\n${f.line}`));
    for (const a of ALLOWED_LINES) expect(present.has(`${a.file}\n${a.line}`), `${a.file}: ${a.line}`).toBe(true);
  });

  it("the owners still own it: ledGroupsIn exists and the planner pages call it", () => {
    expect(readFileSync(path.join(REPO_ROOT, "app/utils/ministryAccess.ts"), "utf8")).toMatch(/export function ledGroupsIn\(/);
    for (const file of [
      "app/utils/ministryEventCommit.ts",
      "app/utils/ministryEventReads.ts",
      "app/(client)/jovenes/admin/page.tsx",
      "app/(client)/jovenes/page.tsx",
    ]) {
      expect(stripComments(readFileSync(path.join(REPO_ROOT, file), "utf8")), file).toMatch(/\bledGroupsIn\(/);
    }
  });
});
