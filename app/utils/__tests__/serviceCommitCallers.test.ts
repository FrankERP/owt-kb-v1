// The caller pin for the service domain modules (`app/**/*Commit.ts`).
//
// WHY THIS EXISTS. The admin write routes delegate everything after
// authorization to a `*Commit` module, and the MCP write tools call the same
// modules — one code path, so refusal, notification and cache parity hold by
// construction. The protected-write audit follows the TRANSACTION, so its
// registry entries now name the modules, not the routes. That left a gap the
// old per-route entries did not have: a brand-new surface could import a
// registered writer and reach production content without touching any
// reviewed list. This pin closes it. The exact set of non-test importers of
// every `*Commit` module, and of the one publish predicate `publishVerdict`
// (which the writer and the MCP reads must share, I4), is written down below,
// so a new caller — or a new `*Commit` module — fails here until someone adds
// it on purpose.
//
// WHAT COUNTS AS A CALLER. Any git-tracked, non-test source under `app/` or
// `scripts/` (widened for the fairness write executor, solver v3 C2 WR-16: C4's
// `tsx` script is its one importer outside `app/`, and a wider scan loosens no
// existing row — no script imports any other pinned module) whose
// comment-stripped code imports the module by a value import: `import … from`,
// `export … from`, a side-effect `import "…"`, a dynamic `import("…")` or a
// `require("…")`. A TYPE-ONLY import (`import type …`, or braces whose every
// specifier is `type …`) is erased at compile time and cannot reach the
// writer, so it is not a caller. Specifiers are RESOLVED (`@/…` from the repo
// root, `./…`/`../…` from the importer), never matched by basename.
//
// The scan reads `git ls-files`, so a new file is invisible until it is staged.
// Stage new files before running this suite (the committed tree is what CI sees).

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { stripComments } from "../../../scripts/lib/strip-comments.mjs";
import { DELIVERY_CAPABLE_IMPORTS } from "./__fixtures__/deliveryCapableImports";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * THE PIN: module name → every non-test source allowed to import it, sorted.
 * Adding a caller is a reviewed change to this table, never a loosening of the scan.
 */
const EXPECTED_CALLERS: Record<string, string[]> = {
  publishReadyCommit: ["app/api/admin/roles/publish-ready/route.ts", "app/mcp/tools/publishService.ts"],
  publishVerdict: ["app/mcp/reads/publishRefusal.ts", "app/utils/publishReadyCommit.ts"],
  roleSwapCommit: ["app/api/admin/roles/swap/route.ts", "app/mcp/tools/swapAssignment.ts"],
  roleUnpublishCommit: ["app/api/admin/roles/unpublish/route.ts", "app/mcp/tools/unpublishService.ts"],
  setlistSaveCommit: ["app/api/admin/setlists/route.ts", "app/mcp/tools/editSetlist.ts"],
  // Solver v3 C2 WR-16 / IF2-23: the ONE mutation path of `fairnessMonth`. Its importer
  // list grows only by a reviewed edit here — C2 adds `fairnessMonthCommit.ts` and
  // `fairnessLedgerRead.ts`; C4 adds its CLI file and its `scripts/lib` core.
  fairnessMonthWriteRequest: ["app/utils/fairnessMonthCommit.ts"],
  // Solver v3 C2 WR-1: the PUT route is the commit module's only caller (no MCP tool).
  fairnessMonthCommit: ["app/api/admin/fairness/months/route.ts"],
};

/**
 * Pinned modules whose name does not end in `Commit` — a shared predicate that a
 * writer and a tool must agree on. Each is a repo-relative path.
 */
const PINNED_BEYOND_COMMIT: string[] = ["app/utils/publishVerdict.ts", "app/utils/fairnessMonthWriteRequest.ts"];

const SOURCE_RE = /\.(ts|tsx|mjs|cjs|js)$/;
const RESOLVABLE_EXT_RE = /\.(ts|tsx|mjs|cjs|js)$/;

function isNonTestSource(file: string): boolean {
  if (!SOURCE_RE.test(file)) return false;
  if (/(^|\/)__tests__\//.test(file) || /\.test\.[^/]+$/.test(file)) return false;
  return true;
}

function trackedAppSources(): string[] {
  return execFileSync("git", ["ls-files", "app", "scripts"], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\n")
    .filter((f) => f && isNonTestSource(f));
}

function moduleName(file: string): string {
  return path.posix.basename(file).replace(RESOLVABLE_EXT_RE, "");
}

/** A specifier resolved to a repo-relative path without extension, or null for a package. */
function resolveSpecifier(importer: string, specifier: string): string | null {
  let resolved: string;
  if (specifier.startsWith("@/")) resolved = specifier.slice(2);
  else if (specifier.startsWith("./") || specifier.startsWith("../")) {
    resolved = path.posix.join(path.posix.dirname(importer), specifier);
  } else return null;
  return path.posix.normalize(resolved).replace(RESOLVABLE_EXT_RE, "");
}

/** True when an import/export clause brings in types only. */
function typeOnlyClause(typeKeyword: string | undefined, clause: string): boolean {
  if (typeKeyword) return true;
  const braces = clause.trim().match(/^\{([\s\S]*)\}$/);
  if (!braces) return false;
  const specifiers = braces[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return specifiers.length > 0 && specifiers.every((s) => /^type\s/.test(s));
}

/** Every VALUE import specifier in one source, comments ignored. */
function valueImportSpecifiers(source: string): string[] {
  const code = stripComments(source);
  const out: string[] = [];
  // `import X from "m"`, `import { a, type B } from "m"`, `export * from "m"`, `export { a } from "m"`.
  // The clause holds no quote or semicolon, so a match never spans two statements.
  for (const m of code.matchAll(
    /\b(?:import|export)\s+(type\s+)?([^;"'`]*?)\s*from\s*(["'])([^"']+)\3/g,
  )) {
    if (!typeOnlyClause(m[1], m[2])) out.push(m[4]);
  }
  for (const m of code.matchAll(/\bimport\s*(["'])([^"']+)\1/g)) out.push(m[2]);
  for (const m of code.matchAll(/\bimport\s*\(\s*(["'`])([^"'`]+)\1\s*\)/g)) out.push(m[2]);
  for (const m of code.matchAll(/\brequire\s*\(\s*(["'])([^"']+)\1\s*\)/g)) out.push(m[2]);
  return out;
}

describe("the import scan this pin relies on", () => {
  const importer = "app/api/x/route.ts";
  const callsOf = (source: string) =>
    valueImportSpecifiers(source).map((s) => resolveSpecifier(importer, s));

  it("counts value imports in every form, resolved from the importer", () => {
    expect(
      callsOf(
        [
          'import { saveSetlist } from "@/app/utils/setlistSaveCommit";',
          'import { type A, saveSetlist as s } from "../../utils/setlistSaveCommit.ts";',
          'export { saveSetlist } from "./local";',
          'import "@/app/utils/sideEffect";',
          'const m = await import("@/app/utils/lazy");',
          'const r = require("../../utils/required");',
        ].join("\n"),
      ),
    ).toEqual([
      "app/utils/setlistSaveCommit",
      "app/utils/setlistSaveCommit",
      "app/api/x/local",
      "app/utils/sideEffect",
      "app/utils/lazy",
      "app/utils/required",
    ]);
  });

  it("ignores type-only imports, packages and commented-out imports", () => {
    expect(
      callsOf(
        [
          'import type { SetlistSaveEffects } from "@/app/utils/setlistSaveCommit";',
          'import { type CommitOutcome } from "@/app/utils/commitOutcome";',
          'export type { X } from "@/app/utils/setlistSaveCommit";',
          'import { NextResponse } from "next/server";',
          '// import { saveSetlist } from "@/app/utils/setlistSaveCommit";',
          '/* import { saveSetlist } from "@/app/utils/setlistSaveCommit"; */',
        ].join("\n"),
      ).filter((s) => s !== null),
    ).toEqual([]);
  });

  it("never lets one clause span two statements", () => {
    expect(
      callsOf('import "server-only";\nimport type { T } from "@/app/utils/setlistSaveCommit";'),
    ).toEqual([null]);
  });
});

describe("service *Commit modules are imported only by their pinned callers", () => {
  const sources = trackedAppSources();
  const commitModules = sources.filter((f) => /Commit\.(ts|tsx)$/.test(f));
  const pinned = [...commitModules, ...PINNED_BEYOND_COMMIT];

  it("reads a real inventory (a zero-file scan would pass vacuously)", () => {
    expect(sources.length).toBeGreaterThan(100);
  });

  it("pins every *Commit module, and nothing that does not exist", () => {
    expect(pinned.map(moduleName).sort()).toEqual(Object.keys(EXPECTED_CALLERS).sort());
  });

  it("lists every *Commit module in DELIVERY_CAPABLE_IMPORTS, so a route that imports only its domain module cannot silently drop out of the SR-verification scan (F5)", () => {
    for (const file of commitModules) {
      const name = moduleName(file);
      expect(DELIVERY_CAPABLE_IMPORTS, name).toContain(name);
    }
  });

  it("finds exactly the pinned importers of each module", () => {
    const actual: Record<string, string[]> = {};
    for (const file of pinned) actual[moduleName(file)] = [];
    const targets = new Map(pinned.map((f) => [f.replace(RESOLVABLE_EXT_RE, ""), moduleName(f)]));

    for (const importer of sources) {
      const source = readFileSync(path.join(REPO_ROOT, importer), "utf8");
      const reached = new Set<string>();
      for (const specifier of valueImportSpecifiers(source)) {
        const resolved = resolveSpecifier(importer, specifier);
        const name = resolved ? targets.get(resolved) : undefined;
        if (name && resolved !== importer.replace(RESOLVABLE_EXT_RE, "")) reached.add(name);
      }
      for (const name of reached) actual[name].push(importer);
    }
    for (const name of Object.keys(actual)) actual[name].sort();

    const expected: Record<string, string[]> = {};
    for (const [name, callers] of Object.entries(EXPECTED_CALLERS)) expected[name] = [...callers].sort();
    expect(actual).toEqual(expected);
  });
});
