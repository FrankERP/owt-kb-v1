// Text pin: `loadServiceSnapshot()` is a line-for-line copy of
// `loadServiceReadinessSources()`'s orchestration (P1 Decision D1), and this
// test keeps it one.
//
// The parity test proves the two BEHAVE alike over the fixture matrix. This one
// fails on any edit to the original loader's body, even one the fixtures happen
// not to exercise, and its message says where the change must be mirrored —
// the same job `scripts/__tests__/vendoredSkillDigest.test.ts` does for the
// vendored skill.
//
// The compared span runs from `await Promise.all([` through the end of the
// `ServiceReadinessSources` object each loader builds. Comments are blanked and
// whitespace is collapsed. The one legitimate difference inside the span is how
// that object is used: the original `return`s it; the snapshot binds it to
// `const readiness: ServiceReadinessSources` and wraps it with the raw rows
// afterwards (outside the span). The two `attempt()` helpers differ only in
// their client receiver spelling and log line, which sit outside the span and are
// covered by the parity test's client-checking responder.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/app/utils/protectedReadAudit";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const ORIGINAL = "app/utils/publishReadyBundle.ts";
const MIRROR = "app/mcp/reads/serviceSnapshot.ts";

const REMEDIATION =
  `${ORIGINAL}'s loadServiceReadinessSources() and ${MIRROR}'s loadServiceSnapshot() no longer ` +
  `run the same orchestration.\n` +
  `If you edited the original: mirror this change in ${MIRROR} in the same commit.\n` +
  `If you edited the mirror: it must stay a copy of the original; widen the original ` +
  `instead, or not at all (a production writer imports it).\n` +
  `Then run app/mcp/reads/__tests__/serviceSnapshotParity.test.ts.`;

/** Index just past the `}` that closes the `{` at `open`. */
function closeBrace(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}" && --depth === 0) return i + 1;
  }
  return -1;
}

/**
 * The span from `await Promise.all([` to the end of the object that follows
 * `objectHead`, inside the function that `fnHead` opens. Throws with the
 * missing anchor's name, so a moved anchor is a clear failure, not a vacuous pass.
 */
function span(file: string, fnHead: string, objectHead: string): string {
  const code = stripComments(readFileSync(path.join(REPO_ROOT, file), "utf8"));
  const fn = code.indexOf(fnHead);
  if (fn < 0) throw new Error(`${file}: anchor not found: ${fnHead}`);
  const start = code.indexOf("await Promise.all([", fn);
  if (start < 0) throw new Error(`${file}: anchor not found after ${fnHead}: await Promise.all([`);
  const head = code.indexOf(objectHead, start);
  if (head < 0) throw new Error(`${file}: anchor not found: ${objectHead}`);
  const end = closeBrace(code, head + objectHead.length - 1);
  if (end < 0) throw new Error(`${file}: unbalanced object after ${objectHead}`);
  return code.slice(start, end).replace(/\s+/g, " ").trim();
}

describe("loadServiceSnapshot mirrors loadServiceReadinessSources", () => {
  const original = span(ORIGINAL, "export async function loadServiceReadinessSources(", "return {");
  const mirror = span(MIRROR, "export async function loadServiceSnapshot(", "const readiness: ServiceReadinessSources = {");

  it("compares a real span (a pin over nothing would pass forever)", () => {
    for (const s of [original, mirror]) {
      expect(s).toMatch(/^await Promise\.all\(\[/);
      expect(s).toContain("canonicalMembersByIdsQuery(memberRefs)");
      expect(s).toContain("specialRolesWithEmbeddedSetlist(roles.rows)");
      expect(s).toMatch(/rawProposalDrafts: proposalDrafts\.rows\.filter\(isObj\), \}$/);
    }
  });

  it("runs the same orchestration, text for text", () => {
    const normalizedMirror = mirror.replace(
      "const readiness: ServiceReadinessSources = {",
      "return {",
    );
    expect(normalizedMirror, REMEDIATION).toBe(original);
  });
});
