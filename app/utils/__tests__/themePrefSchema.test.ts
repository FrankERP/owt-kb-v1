import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * E1's guard. Every OTHER guard in Child E checks that no *client* path writes
 * `themePref`. This one covers the breach that needs no client code running at all:
 * an `initialValue` would make Sanity stamp the field on document creation, so Child
 * F's default-unset cohort would be empty before F begins.
 *
 * Three immediate neighbours in the same schema carry `initialValue: true`, so this
 * is the natural mistake for a later Studio edit — and the cheapest guard in the child.
 */

const SCHEMA = path.join(
  process.cwd(),
  "sanity/schemas/worshipTeam.ts",
);

function themePrefFieldSource(): string {
  const src = readFileSync(SCHEMA, "utf8");
  const start = src.indexOf('name: "themePref"');
  expect(start, "`themePref` must exist on the teamMembers schema").toBeGreaterThan(-1);

  // The field object runs from the `{` that opens it to the matching `}`. Walk back to
  // the opening brace, then forward counting depth — cheaper and more honest than a
  // regex that would quietly match the wrong block.
  let open = start;
  while (open > 0 && src[open] !== "{") open--;
  let depth = 0;
  let end = open;
  for (; end < src.length; end++) {
    if (src[end] === "{") depth++;
    else if (src[end] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  // Strip comments. The field's own comment explains at length why it has no
  // `initialValue`, and a guard that cannot tell an explanation from a declaration
  // would fail on the very documentation that makes the rule survivable.
  return src
    .slice(open, end + 1)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("themePref schema field (invariant 14 — unset must stay distinguishable)", () => {
  it("has NO initialValue — an unset field is Child F's cohort signal", () => {
    expect(
      themePrefFieldSource(),
      "`themePref` must not carry an initialValue: Sanity would stamp every member " +
        "document on creation and Child F's default-unset cohort would be empty before " +
        "F begins. Three neighbouring prefs in this schema do carry one, which is " +
        "exactly why this guard exists.",
    ).not.toMatch(/initialValue/);
  });

  it("is hidden — invariant 13 / D11, member-only, never in MemberForm", () => {
    expect(themePrefFieldSource()).toMatch(/hidden:\s*true/);
  });

  it("is a bare string, so the route's literal set is the only validation", () => {
    expect(themePrefFieldSource()).toMatch(/type:\s*"string"/);
  });

  it("the neighbouring prefs really do carry initialValue — the trap is live", () => {
    // If this ever fails, the "natural mistake" premise above has changed and the
    // first assertion's rationale should be revisited rather than silently kept.
    const src = readFileSync(SCHEMA, "utf8");
    expect(src.match(/initialValue:\s*true/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});
