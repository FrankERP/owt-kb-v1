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
// The `*[…]` group scan WAS at 100% when this file was written. The bare-predicate
// check below was not — it was added after a code review pointed out that a filter
// held in a string and injected elsewhere is invisible to a group scan, and it
// immediately found a real pre-existing violation: `notifySetlistSaved` resolved
// its audience with no `published != false`. So this guard did retroactively catch
// something, which is the more useful lesson than the one originally written here:
// the shape a scan cannot see is where the violation was actually living.
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
// whose branches name different ROLE types would pass when only one branch carries
// it. No query exercises that today — `api/me/songs` looks like it does, but its
// only role branch (`special_role`) is filtered and the other names setlist types,
// which carry no `published` at all. Tightening this needs a real GROQ parser;
// naming the hole is honest, and a silent hole is what a guard is meant to prevent.

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
 * `kidsSchedule`, which gates on the STRICTER `published == true`.
 *
 * The spelling difference is the whole point and is not stylistic. Worship types
 * predate the field, so an ABSENT `published` there must read as visible, which is
 * what `!= false` buys. `kidsSchedule` is minted with the field by its own writer,
 * so a field-less doc is a bug rather than a legacy row — and `!= false` would wave
 * exactly that bug through.
 *
 * Scanned separately from `ROLE_TYPES` for a reason worth stating: until this was
 * added, the whole kids vertical sat in this guard's blind spot. The generator's
 * fairness read and the planner's history read both shipped with no `published`
 * clause at all, and the guard whose entire purpose is "nothing stopped the ninth
 * call site from omitting the filter" had nothing to say about either, because it
 * only ever looked for the three worship role types.
 */
const KIDS_TYPE = /"kidsSchedule"/;

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

/**
 * Kids reads that legitimately see unpublished Sundays, keyed by FILE.
 */
const KIDS_MAY_SEE_DRAFTS: Record<string, string> = {
  "api/kids/schedules/route.ts":
    "The planner's own data source and its writer, both behind " +
    "`requireMinistryManager('kids')`. The GET backs the editing grid, which must " +
    "show drafts or the planner cannot show the work it exists to do; the PUT must " +
    "read a draft in order to publish it. CAVEAT, and it is why this exemption " +
    "looked safer than it was: `KidsPlanner.loadMonth` ALSO refills its history " +
    "state from this GET, so the fairness clock passes through an exempt endpoint. " +
    "The client re-filters on `published` at its `useMemo` (ADR-0022). Anything " +
    "added here that a member or a clock consumes must be gated at the consumer.",
};

/**
 * …and by PROJECTION **within a named file**, which the planner page needs because
 * it holds one group of each kind. `"schedules"` is the month being edited and must
 * see drafts; `"history"` in the same query object is the fairness clock and must
 * not. A file-level exemption would shield both and quietly re-open the bug this
 * scan was extended to catch.
 *
 * Keyed by file rather than by bare label, because a bare label is an exemption
 * ANY file can claim. A review of this guard proved it: adding
 * `"schedules": *[_type == "kidsSchedule" && …]` to the member-facing
 * `(client)/kids/page.tsx` — with no `published` clause — passed all nine tests,
 * and `schedules` is the most natural key name for exactly that data. Narrower than
 * a file exemption on one axis is not narrower overall.
 */
const KIDS_LABELS_MAY_SEE_DRAFTS: Record<string, Set<string>> = {
  "(client)/kids/admin/page.tsx": new Set(["schedules"]),
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
    // Balance over `clean`, not `src`: an unbalanced `)` inside a comment would
    // truncate the argument, and a truncated argument that happens to retain the
    // clause passes vacuously.
    for (let i = open; i < clean.length; i++) {
      if (clean[i] === "(") depth++;
      else if (clean[i] === ")") {
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

/**
 * The `"name":` a filter group is projected under, when it has one. Lets the kids
 * scan exempt ONE group inside a multi-projection query object instead of the
 * whole file.
 */
function projectionLabel(src: string, index: number): string | undefined {
  const before = src.slice(Math.max(0, index - 60), index);
  return before.match(/"([A-Za-z_]\w*)"\s*:\s*$/)?.[1];
}

function unfilteredKidsReads() {
  return sourceFiles(APP_DIR).flatMap((file) => {
    const rel = path.relative(APP_DIR, file);
    const src = readFileSync(file, "utf8");
    // Scanned with comments blanked, unlike the role scan: the kids reads carry
    // long comments ABOUT their own gating, and prose quoting a query must not be
    // mistaken for one. `stripComments` preserves byte offsets, so `index` still
    // points at the real line.
    const clean = stripComments(src);
    return filterGroups(clean)
      .filter((g) => KIDS_TYPE.test(g.text) && !/published\s*==\s*true/.test(g.text))
      .map((g) => ({
        rel,
        line: clean.slice(0, g.index).split("\n").length,
        label: projectionLabel(clean, g.index),
      }));
  });
}

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
    // Same exemption list as the scans above: `api/admin` may legitimately resolve
    // an audience over drafts, and a future admin-only helper calling this with an
    // unfiltered predicate must not force the check to be weakened.
    const args = sourceFiles(APP_DIR)
      .filter((file) => !exemptionFor(path.relative(APP_DIR, file)))
      .flatMap((file) =>
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

describe("unpublished kids Sundays stay out of members' views AND out of the clock", () => {
  const kidsExemptionFor = (rel: string): string | undefined =>
    Object.keys(KIDS_MAY_SEE_DRAFTS).find((p) => rel === p || rel.startsWith(p + "/"));

  it("scans real queries (a scan matching nothing would pass forever)", () => {
    const kidsReads = sourceFiles(APP_DIR).flatMap((file) =>
      filterGroups(stripComments(readFileSync(file, "utf8"))).filter((g) => KIDS_TYPE.test(g.text)),
    );
    // Today: /kids, /me, the planner page's two, the schedules route, the generator.
    expect(kidsReads.length).toBeGreaterThanOrEqual(6);
  });

  it("filters `published == true` on every kids read outside the exempt paths", () => {
    const violations = unfilteredKidsReads()
      .filter(
        ({ rel, label }) =>
          !kidsExemptionFor(rel) && !KIDS_LABELS_MAY_SEE_DRAFTS[rel]?.has(label ?? ""),
      )
      .map(({ rel, line }) => `${rel}:${line} reads kidsSchedule without \`published == true\``);
    expect(violations).toEqual([]);
  });

  it("gates the FAIRNESS CLOCK, not just the member-facing views", () => {
    // The specific regression this whole change exists to prevent, pinned by name
    // rather than by scan. These two reads answer "how long since this pair
    // served", and an unpublished Sunday is a proposal nobody was asked to serve —
    // counting one penalises every pair on it with nothing on screen to say why.
    //
    // They must also AGREE. If the planner's labels and the generator's plan come
    // from queries that gate differently, the board promises «le toca» for a pair
    // the generator will not pick, and neither surface can show the disagreement.
    const clocks = [
      "(client)/kids/admin/page.tsx",
      "api/kids/generate/route.ts",
    ].map((rel) => {
      const src = stripComments(readFileSync(path.join(APP_DIR, rel), "utf8"));
      const groups = filterGroups(src).filter(
        (g) => KIDS_TYPE.test(g.text) && projectionLabel(src, g.index) !== "schedules",
      );
      return { rel, groups };
    });

    for (const { rel, groups } of clocks) {
      expect(groups.length, `${rel} should hold exactly one history read`).toBe(1);
      expect(
        /published\s*==\s*true/.test(groups[0].text),
        `${rel}'s history read must filter \`published == true\``,
      ).toBe(true);
      // Prior Sundays only — a clock that swept forward would count the month
      // being planned as already served.
      expect(/date\s*<\s*\$/.test(groups[0].text), `${rel} must read PRIOR Sundays`).toBe(true);
    }
  });

  it("keeps the kids exemptions honest — an entry that shields nothing is dead", () => {
    const shielding = new Set(unfilteredKidsReads().map(({ rel }) => kidsExemptionFor(rel)));
    expect(Object.keys(KIDS_MAY_SEE_DRAFTS).filter((p) => !shielding.has(p))).toEqual([]);

    // Each label exemption must shield a real ungated group IN ITS OWN FILE.
    const dead = Object.entries(KIDS_LABELS_MAY_SEE_DRAFTS).flatMap(([rel, labels]) =>
      [...labels]
        .filter((l) => !unfilteredKidsReads().some((r) => r.rel === rel && r.label === l))
        .map((l) => `${rel} exempts "${l}", which shields nothing`),
    );
    expect(dead).toEqual([]);
  });

  it("does not let ANY file claim the exemption by naming a projection «schedules»", () => {
    // The hole this scoping closed, pinned so it cannot reopen: the exemption is
    // a property of one audited file, never of a key name.
    const exemptFiles = Object.keys(KIDS_LABELS_MAY_SEE_DRAFTS);
    expect(exemptFiles).toEqual(["(client)/kids/admin/page.tsx"]);
    for (const rel of exemptFiles) {
      expect(sourceFiles(APP_DIR).map((f) => path.relative(APP_DIR, f))).toContain(rel);
    }
  });
});
