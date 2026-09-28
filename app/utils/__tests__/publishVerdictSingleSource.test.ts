// I4 by construction: there is ONE per-service publish predicate.
//
// `publishVerdict` (`app/utils/publishVerdict.ts`) decides why publishing
// refuses a service. The publish writer (`publishReadyCommit.ts`) and the MCP
// read adapter (`app/mcp/reads/publishRefusal.ts`) must both CALL it and must
// never decide a verdict reason themselves. Until P3 the read kept a pinned copy
// (ADR-0040, D2); a copy creeping back — a routine "simplification" that
// re-inlines the checks next to the caller — is what this file catches.
//
// A string-match test, like `clientBoundary` and `cueDialogMount`. Comments are
// stripped first: both callers' headers name every reason code and the
// predicate in prose, and prose is not a copy. `publishRefusalParity.test.ts`
// remains as the behavioural WIRING test over P1's fixtures; this one needs no
// fixture to fail.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { stripComments } from "../../../scripts/lib/strip-comments.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const PREDICATE = "app/utils/publishVerdict.ts";
const CALLERS = ["app/utils/publishReadyCommit.ts", "app/mcp/reads/publishRefusal.ts"] as const;

/** Every reason `publishVerdict` gives, in its order. Pinned against the predicate below. */
const VERDICT_REASONS = [
  "hard_integrity_blocker",
  "unusable_observation",
  "already_published",
  "stale_revision",
  "not_ready",
  "blocker_set_changed",
] as const;

function read(file: string): string {
  return readFileSync(path.join(REPO_ROOT, file), "utf8");
}

function callsPredicate(source: string): boolean {
  return /\bpublishVerdict\s*\(/.test(stripComments(source));
}

/** Everything in `source`'s code that decides a verdict itself instead of asking the predicate. */
function verdictCopies(source: string): string[] {
  const code = stripComments(source);
  const found: string[] = [];
  if (/\bclassifyPublishBlockers\s*\(/.test(code)) found.push("classifyPublishBlockers(");
  for (const m of code.matchAll(/\.push\(\s*(["'`])([A-Za-z_]+)\1/g)) {
    if ((VERDICT_REASONS as readonly string[]).includes(m[2])) found.push(`.push("${m[2]}")`);
  }
  return found;
}

describe("the publish verdict has one source (I4)", () => {
  it.each(CALLERS.map((file) => [file]))("%s calls publishVerdict(", (file) => {
    expect(callsPredicate(read(file))).toBe(true);
  });

  it.each(CALLERS.map((file) => [file]))("%s decides no verdict reason itself", (file) => {
    expect(verdictCopies(read(file))).toEqual([]);
  });

  it("finds the verdict where it lives: the predicate classifies once and pushes exactly the six reasons, in order", () => {
    // Non-vacuity for the scan above, and the pin on VERDICT_REASONS: a reason the
    // predicate gains or drops fails here until this list says so.
    expect(verdictCopies(read(PREDICATE))).toEqual([
      "classifyPublishBlockers(",
      ...VERDICT_REASONS.map((r) => `.push("${r}")`),
    ]);
  });

  it.each(CALLERS.map((file) => [file]))(
    "fails on an inline reasons.push(\"not_ready\") planted in %s",
    (file) => {
      const planted = `${read(file)}\nfunction planted(reasons: string[]) {\n  reasons.push("not_ready");\n}\n`;
      expect(verdictCopies(planted)).toEqual(['.push("not_ready")']);
    },
  );

  it("fails on an inline classification, and ignores both in a comment", () => {
    expect(verdictCopies('const b = classifyPublishBlockers(service.readiness);')).toEqual([
      "classifyPublishBlockers(",
    ]);
    expect(
      verdictCopies('// reasons.push("not_ready")\n/* classifyPublishBlockers(x) */\nconst x = 1;'),
    ).toEqual([]);
    expect(callsPredicate("// publishVerdict(service, entry)\nconst x = 1;")).toBe(false);
  });
});
