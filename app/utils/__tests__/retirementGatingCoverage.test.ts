// Retirement enumeration guard (R2 / R2b).
//
// Selection must filter retired members at the point of use; GROQ enumeration
// that deliberately does NOT filter must be declared here — same inverted-scan
// pattern as `draftGatingCoverage.test.ts`.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../../../scripts/lib/strip-comments.mjs";
import { WORSHIP_NOT_RETIRED_GROQ_FILTER } from "../memberRetirement";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const APP_DIR = path.join(REPO_ROOT, "app");

/** Executable enumerations exempt from the retirement filter, with rationale. */
const RETIREMENT_ENUM_EXEMPT: Record<string, string> = {
  "api/admin/login-events/route.ts":
    "Audit view — hiding a retired member hides the login event that matters.",
  "api/admin/members/route.ts":
    "Shared list feeds id→name resolution; filtering here breaks pool mapping (R3).",
  "api/admin/members/[id]/disable/route.ts":
    "Super-admin quorum for kill switch (R14) — role-selected ops alert, not roster.",
  "utils/outboxLiveness.ts":
    "Role-selected super-admin ops alert — not a worship roster.",
  "utils/proposalNotifyQueries.ts":
    "ADMIN_RECIPIENTS_QUERY — role-selected admin mail, not ministry-scoped.",
};

/** Kids reads are resolution-only — must never gain a retirement filter (R18). */
const KIDS_RESOLUTION_ONLY = [
  "api/kids/generate/route.ts",
  "api/kids/members/route.ts",
  "(client)/kids/admin/page.tsx",
];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "__tests__" || name === "node_modules") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

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

function templateLiterals(src: string): string[] {
  return [...stripComments(src).matchAll(/`(?:[^`\\]|\\.)*`/g)].map((m) => m[0]);
}

const TEAM_MEMBERS_ENUM =
  /\*\[\s*_type\s*==\s*["']teamMembers["']/;

function isExecutableEnumeration(groupText: string): boolean {
  return TEAM_MEMBERS_ENUM.test(groupText) && !/\b_id\s+in\s+\$/.test(groupText) && !/\b_id\s*==\s*\$/.test(groupText);
}

function hasRetirementFilter(text: string): boolean {
  return (
    text.includes("retiredFrom") ||
    text.includes("WORSHIP_NOT_RETIRED_GROQ_FILTER") ||
    text.includes("filterMembersForSelection") ||
    text.includes("isRetiredFrom") ||
    text.includes("personNameOptions")
  );
}

function rel(file: string): string {
  return path.relative(APP_DIR, file);
}

function exemptFor(relPath: string): string | undefined {
  return Object.keys(RETIREMENT_ENUM_EXEMPT).find(
    (p) => relPath === p || relPath.endsWith("/" + p) || relPath.includes(p),
  );
}

describe("retirement selection coverage (R2 / R2b)", () => {
  it("scans real teamMembers enumerations", () => {
    const groups = sourceFiles(APP_DIR).flatMap((file) =>
      filterGroups(stripComments(readFileSync(file, "utf8"))).filter((g) =>
        isExecutableEnumeration(g.text),
      ),
    );
    expect(groups.length).toBeGreaterThanOrEqual(3);
  });

  it("requires retirement filter on executable enumerations outside exemptions", () => {
    const violations: string[] = [];
    for (const file of sourceFiles(APP_DIR)) {
      const relPath = rel(file);
      if (KIDS_RESOLUTION_ONLY.some((k) => relPath.includes(k))) continue;
      const src = stripComments(readFileSync(file, "utf8"));
      for (const g of filterGroups(src)) {
        if (!isExecutableEnumeration(g.text)) continue;
        if (exemptFor(relPath)) continue;
        if (!hasRetirementFilter(src.slice(Math.max(0, g.index - 400), g.index + g.text.length + 400))) {
          violations.push(`${relPath}:${src.slice(0, g.index).split("\n").length} teamMembers enumeration without retirement filter`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("requires retirement filter on injected GROQ predicate strings", () => {
    const violations = sourceFiles(APP_DIR).flatMap((file) => {
      const relPath = rel(file);
      if (exemptFor(relPath) || KIDS_RESOLUTION_ONLY.some((k) => relPath.includes(k))) return [];
      const src = readFileSync(file, "utf8");
      return templateLiterals(src)
        .filter(
          (lit) =>
            lit.includes('teamMembers') &&
            lit.includes("*[") &&
            isExecutableEnumeration(lit) &&
            !hasRetirementFilter(lit),
        )
        .map(() => `${relPath} injects teamMembers enumeration without retirement filter`);
    });
    expect(violations).toEqual([]);
  });

  it("keeps exemption list honest", () => {
    const shielding = new Set<string>();
    for (const file of sourceFiles(APP_DIR)) {
      const relPath = rel(file);
      const src = stripComments(readFileSync(file, "utf8"));
      if (
        filterGroups(src).some((g) => isExecutableEnumeration(g.text)) &&
        exemptFor(relPath)
      ) {
        shielding.add(exemptFor(relPath)!);
      }
    }
    const dead = Object.keys(RETIREMENT_ENUM_EXEMPT).filter((k) => !shielding.has(k));
    expect(dead).toEqual([]);
  });

  it("fails if a new executable enumeration appears undeclared (R2b sentinel)", () => {
    const undeclared = sourceFiles(APP_DIR).flatMap((file) => {
      const relPath = rel(file);
      const src = stripComments(readFileSync(file, "utf8"));
      return filterGroups(src)
        .filter((g) => isExecutableEnumeration(g.text))
        .filter(() => !exemptFor(relPath) && !KIDS_RESOLUTION_ONLY.some((k) => relPath.includes(k)))
        .filter(
          (g) =>
            !hasRetirementFilter(
              src.slice(Math.max(0, g.index - 400), g.index + g.text.length + 400),
            ),
        )
        .map(() => relPath);
    });
    expect(undeclared).toEqual([]);
  });

  it("WORSHIP_NOT_RETIRED_GROQ_FILTER is composed only in setlist audience", () => {
    const hits = sourceFiles(APP_DIR).filter((file) => {
      const relPath = rel(file);
      if (relPath === "utils/memberRetirement.ts") return false;
      const src = readFileSync(file, "utf8");
      return src.includes("WORSHIP_NOT_RETIRED_GROQ_FILTER");
    });
    expect(hits.map(rel)).toEqual(["utils/serviceMutationSideEffects.ts"]);
  });
});
