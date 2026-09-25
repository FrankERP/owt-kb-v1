// P1-R7 — no MCP-owned file may spell a protected role/setlist type as a bare
// quoted string literal (spec I2).
//
// `draftGatingCoverage.test.ts` only scans GROQ `*[ … ]` filter groups, so a
// bare TypeScript comparison like `role._type === "special_role"` is
// invisible to it — exactly the shape that shipped once in
// `proposalPresenter.ts`'s first commit and was caught by an adversarial
// review, not by any guard. This is the guard that closes that gap.
//
// SCOPE: every git-tracked, non-test `.ts`/`.tsx` file under `app/mcp/`.
// Comments are stripped first (the repo's own `stripComments`, shared with
// `protectedReadAudit.ts` and `draftGatingCoverage.test.ts`), so a doc comment
// that MENTIONS a type in prose — several already explain why a comparison
// does NOT use one — is never a false positive; only an actual quoted string
// literal in code counts. All three JS quote styles are covered.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stripComments } from "../../../scripts/lib/strip-comments.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** The five protected role/setlist types (`serviceReadModel.ts`'s `PROTECTED_TYPES` minus `setlistProposal`, which carries no such literal risk here). */
const PROTECTED_TYPE_LITERALS = [
  "sunday_role",
  "saturday_role",
  "special_role",
  "featuredSongs",
  "saturdarSongs",
] as const;

function gitTrackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z"], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
}

/** Every git-tracked, non-test source file under `app/mcp/`. */
function mcpSourceFiles(): string[] {
  return gitTrackedFiles().filter(
    (file) => file.startsWith("app/mcp/") && /\.tsx?$/.test(file) && !file.includes("__tests__/"),
  );
}

interface Hit {
  literal: string;
  line: number;
}

/** Every protected-type literal found as a QUOTED string (any of `"`/`'`/`` ` ``), after blanking comments. */
export function findProtectedTypeLiterals(source: string): Hit[] {
  const stripped = stripComments(source);
  const hits: Hit[] = [];
  for (const literal of PROTECTED_TYPE_LITERALS) {
    const re = new RegExp(`["'\`]${literal}["'\`]`, "g");
    let match: RegExpExecArray | null;
    while ((match = re.exec(stripped))) {
      hits.push({ literal, line: stripped.slice(0, match.index).split("\n").length });
    }
  }
  return hits;
}

describe("app/mcp/** never spells a protected role/setlist type as a literal (spec I2)", () => {
  it("finds none in the current tree", () => {
    const violations: string[] = [];
    for (const file of mcpSourceFiles()) {
      const source = readFileSync(path.join(REPO_ROOT, file), "utf8");
      for (const hit of findProtectedTypeLiterals(source)) {
        violations.push(`${file}:${hit.line} — "${hit.literal}"`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("negative control: flags a bare TypeScript comparison against a protected type literal", () => {
    const source = [
      'export function isSpecial(role: { _type: unknown }): boolean {',
      '  return role._type === "special_role";',
      "}",
    ].join("\n");
    expect(findProtectedTypeLiterals(source)).toEqual([{ literal: "special_role", line: 2 }]);
  });

  it("positive control: the same check written through ROLE_TYPES is not flagged", () => {
    const source = [
      'import { ROLE_TYPES } from "@/app/utils/serviceReadModel";',
      "export function isRole(type: unknown): boolean {",
      "  return (ROLE_TYPES as readonly unknown[]).includes(type);",
      "}",
    ].join("\n");
    expect(findProtectedTypeLiterals(source)).toEqual([]);
  });

  it("a literal mentioned only in a comment is not flagged", () => {
    const source = [
      '// never spelled here: "special_role" is deliberately absent from code',
      "export const x = 1;",
    ].join("\n");
    expect(findProtectedTypeLiterals(source)).toEqual([]);
  });

  it("catches single, double and backtick quotes", () => {
    for (const source of [
      'const a = "special_role";',
      "const a = 'special_role';",
      "const a = `special_role`;",
    ]) {
      expect(findProtectedTypeLiterals(source)).toEqual([{ literal: "special_role", line: 1 }]);
    }
  });
});
