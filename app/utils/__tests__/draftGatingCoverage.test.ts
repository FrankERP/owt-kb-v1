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
//
// It is also satisfied by ONE `published != false` per group, so a disjunction
// whose branches name different types passes when only one branch carries it —
// `api/me/songs` has exactly that shape today (benign: it is past-only play
// history, bounded by `week < $today`). Tightening this needs a real GROQ parser;
// naming the hole is honest, and a silent hole is what a guard is supposed to
// prevent.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The repo's own comment blanker (preserves byte offsets, so line numbers stay
// accurate). Without it, prose that QUOTES a query — `_type == "sunday_role"` in
// a doc comment — is scanned as if it were one.
import { stripComments } from "../../../scripts/lib/strip-comments.mjs";

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

/**
 * BARE filter predicates — a GROQ condition held in a string and injected into a
 * query somewhere else, so it never appears inside a `*[ … ]` in its own file and
 * the group scan above is structurally blind to it.
 *
 * This is not hypothetical. `assignedMemberRefsQuery(roleFilter)` — the helper
 * CLAUDE.md's invariants tell every "who serves" query to reuse — takes exactly
 * such a string, and `api/cron/service-reminders` passes one naming all three
 * role types. Deleting its `published != false` would push-notify the whole team
 * about an unpublished service while the group scan stayed green.
 *
 * A literal is a bare predicate when it names a role type with `_type` and holds
 * no `*[` of its own.
 *
 * Template literals ONLY, and only after comments are blanked. Every GROQ string
 * this repo builds in code is a backtick literal; the same characters inside a
 * `//` comment are markdown, not a query, and must not be reported as one.
 */
function templateLiterals(src: string): string[] {
  return [...stripComments(src).matchAll(/`(?:[^`\\]|\\.)*`/g)].map((m) => m[0]);
}

/**
 * The argument to every `assignedMemberRefsQuery(…)` call — parenthesis-balanced,
 * so a nested call or a template with `${}` is not truncated.
 *
 * Covers the INLINE-literal call sites, which is where the literal heuristic
 * below is not enough: `outboxSweep.ts` passes a double-quoted predicate binding
 * the type as `$roleType`, so it carries no role-type literal and no backticks
 * and every text-shape heuristic misses it.
 *
 * Call sites that pass a VARIABLE are skipped here and belong to the literal
 * check — together the two cover all three of today's callers. A variable holding
 * a double-quoted, param-bound predicate would fall between them; none exists, and
 * naming the seam is better than implying there is none.
 */
function assignedQueryArguments(src: string): string[] {
  const out: string[] = [];
  const clean = stripComments(src);
  for (const m of clean.matchAll(/assignedMemberRefsQuery\(/g)) {
    // Skip the declaration itself in `notifyTargets.ts`.
    if (/\bfunction\s+$/.test(clean.slice(Math.max(0, m.index - 12), m.index))) continue;
    const open = m.index + m[0].length - 1;
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") {
        depth--;
        if (depth === 0) {
          const arg = src.slice(open + 1, i);
          // A bare identifier carries no predicate to inspect — the literal check owns it.
          if (/["'`]/.test(arg)) out.push(arg);
          break;
        }
      }
    }
  }
  return out;
}

function unfilteredBarePredicates(rel: string, src: string): string[] {
  return templateLiterals(src)
    .filter(
      (lit) =>
        lit.includes("_type") &&
        ROLE_TYPES.test(lit) &&
        !lit.includes("*[") &&
        !/published\s*!=\s*false/.test(lit),
    )
    .map(() => `${rel} builds a role-type filter string without \`published != false\``);
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

  it("filters it on bare predicate strings too, which no `*[…]` group contains", () => {
    const scanned = sourceFiles(APP_DIR)
      .filter((file) => !exemptionFor(path.relative(APP_DIR, file)))
      .map((file) => ({ rel: path.relative(APP_DIR, file), src: readFileSync(file, "utf8") }));
    // Sentinel, for the same reason the group scan has one: a heuristic that
    // stops matching passes forever. Two bare predicates exist today.
    const seen = scanned.flatMap(({ src }) =>
      templateLiterals(src).filter((l) => l.includes("_type") && ROLE_TYPES.test(l) && !l.includes("*[")),
    );
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(scanned.flatMap(({ rel, src }) => unfilteredBarePredicates(rel, src))).toEqual([]);
  });

  it("filters it on every `assignedMemberRefsQuery` argument — the exact check", () => {
    const args = sourceFiles(APP_DIR).flatMap((file) =>
      assignedQueryArguments(readFileSync(file, "utf8")).map((arg) => ({
        rel: path.relative(APP_DIR, file),
        arg,
      })),
    );
    // One inline call site today (`outboxSweep`); the other two pass a variable and
    // are covered by the bare-predicate check above. A sentinel either way: a
    // heuristic that quietly stops matching passes forever.
    expect(args.length).toBeGreaterThanOrEqual(1);
    const violations = args
      .filter(({ arg }) => !/published\s*!=\s*false/.test(arg))
      .map(({ rel }) => `${rel} calls assignedMemberRefsQuery without \`published != false\``);
    expect(violations).toEqual([]);
  });

  it("keeps the exemption list honest — an entry that shields nothing is dead", () => {
    const shielding = new Set(unfilteredRoleReads().map(({ rel }) => exemptionFor(rel)));
    const dead = Object.keys(MAY_SEE_DRAFTS).filter((prefix) => !shielding.has(prefix));
    expect(dead).toEqual([]);
  });
});
