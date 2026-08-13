// Draft/publish coverage guard.
//
// WHY THIS EXISTS
// ---------------
// "Member-facing reads must filter `published != false`" is one of this repo's
// stated invariants, and it is the one whose violation is loudest: an admin's
// unpublished draft service — its song list, its keys, its seat assignments —
// becomes visible to the entire team before they meant to publish it. There is
// no error, no failed request, nothing to notice. The service simply appears.
//
// Every other invariant of that weight already has a mechanism. Protected types
// have `protectedReadAudit`, the middleware matcher has a byte-identity guard,
// the light palette has a contrast ratchet, the vendored skill has a digest.
// This one had a sentence in CLAUDE.md and eight correct call sites, which is a
// state, not a mechanism. Nothing stopped the ninth from omitting the filter.
//
// So this file was written while coverage was measured at 100%: it cannot
// retroactively fix anything, and that is the point — it can only fail on a
// regression that has not happened yet.
//
// THE RULE. Every GROQ filter group `*[ … ]` that selects a protected ROLE type
// must also constrain `published != false` inside that SAME group. Checking the
// group rather than the file is what lets a nested subquery (`song/[id]`'s
// leader join, which filters correctly inside its own brackets) pass honestly
// while a sibling query in the same file is still judged on its own.
//
// The scan is INVERTED on purpose: it reads all of `app/**` and exempts by
// exception, so a member-facing surface added tomorrow in a directory nobody
// thought of is covered by default. An allowlist of "member-facing roots" would
// have the opposite failure mode, and it is the one that actually happens.
//
// WHAT THIS DOES NOT CLAIM. It is a source scan. It proves the filter is written
// in the query, not that the query is bound to the right client, that its result
// is gated downstream, or that setlists follow their role's publish state —
// `publishedSetlist` in `draftGating.ts` owns that last one and is tested next to
// it. Setlist types are deliberately NOT scanned here: `published` lives on the
// role doc, never on `featuredSongs`/`saturdarSongs`.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const APP_DIR = path.join(REPO_ROOT, "app");

/** The three role document types that carry the `published` flag. */
const ROLE_TYPES = /"(sunday_role|saturday_role|special_role)"/;

/**
 * Reads that legitimately see unpublished roles. Each entry is a structural
 * property of the path, not a convenience — "it was failing" is not a reason.
 */
const MAY_SEE_DRAFTS: Record<string, string> = {
  "api/admin":
    "Every route under it is behind `requireActiveManager`. Showing an admin " +
    "their own drafts is the draft/publish feature, not a leak of it.",
  "utils/serviceReadQueries.ts":
    "The admin/write read model. Its unfiltered queries are consumed by " +
    "`api/admin/setlists` and by `roleWriteOps` — the write path, which must " +
    "see a draft in order to publish it. Do NOT add a member-facing query here.",
};

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "__tests__" || name === "node_modules") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/**
 * Every bracket-balanced `*[ … ]` filter group in `src`. Balancing matters: a
 * group holding an array literal (`_type in ["sunday_role", …]`) or a nested
 * subquery would be truncated at the first `]` by a lazy regex, and a truncated
 * group is one that silently loses the `published` clause sitting after it.
 */
function filterGroups(src: string): Array<{ text: string; index: number }> {
  const out: Array<{ text: string; index: number }> = [];
  for (const m of src.matchAll(/\*\[/g)) {
    let depth = 0;
    for (let i = m.index + 1; i < src.length; i++) {
      if (src[i] === "[") depth++;
      else if (src[i] === "]") {
        depth--;
        if (depth === 0) {
          out.push({ text: src.slice(m.index, i + 1), index: m.index });
          break;
        }
      }
    }
  }
  return out;
}

const exemptionFor = (rel: string): string | undefined =>
  Object.keys(MAY_SEE_DRAFTS).find((prefix) => rel === prefix || rel.startsWith(prefix + "/"));

function unfilteredRoleReads() {
  return sourceFiles(APP_DIR).flatMap((file) => {
    const rel = path.relative(APP_DIR, file);
    const src = readFileSync(file, "utf8");
    return filterGroups(src)
      .filter((g) => ROLE_TYPES.test(g.text) && !/published\s*!=\s*false/.test(g.text))
      .map((g) => ({ rel, line: src.slice(0, g.index).split("\n").length }));
  });
}

describe("draft services stay invisible to members", () => {
  it("scans real queries (a scan matching nothing would pass forever)", () => {
    const roleReads = sourceFiles(APP_DIR).flatMap((file) =>
      filterGroups(readFileSync(file, "utf8")).filter((g) => ROLE_TYPES.test(g.text)),
    );
    expect(roleReads.length).toBeGreaterThanOrEqual(15);
  });

  it("filters `published != false` on every role read outside the exempt paths", () => {
    const violations = unfilteredRoleReads()
      .filter(({ rel }) => !exemptionFor(rel))
      .map(({ rel, line }) => `${rel}:${line} reads a role type without \`published != false\``);
    expect(violations).toEqual([]);
  });

  it("keeps the exemption list honest — an entry that shields nothing is dead", () => {
    const shielding = new Set(unfilteredRoleReads().map(({ rel }) => exemptionFor(rel)));
    const dead = Object.keys(MAY_SEE_DRAFTS).filter((prefix) => !shielding.has(prefix));
    expect(dead).toEqual([]);
  });
});
