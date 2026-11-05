// G1 — who may name `ministryEvent`, and who may import its reader (ADR-0082; plan
// `docs/superpowers/plans/2026-10-30-jovenes-events-access.md` §6 G1, R1, R6).
//
// WHY THIS EXISTS. A Jóvenes meeting is kept from another group ONLY by the GROQ in
// `ministryEventReads.ts`: the dataset answers anyone with a token the app holds, so a second query
// written anywhere else — a wider read filtered in TypeScript, an MCP tool, the admin assistant —
// would hand Emprendedores' calendar to Otro Nivel with no error. The rule «one reader» is
// therefore a source scan, not a sentence:
//
//   1. A file NAMES the type when its comment-stripped code, with import specifiers blanked,
//      contains the token `ministryEvent` (any quote style, template strings included) or the
//      exported constant `MINISTRY_EVENT_TYPE` (so a read through the imported constant counts).
//      Only ALLOWED may name it. Tests are exempt.
//   2. A file that imports the reader may not cache: no `unstable_cache`, `"use cache"`,
//      `cacheLife`, nor an `export const revalidate` (R6 — the result is one person's).
//   3. Nothing under `app/mcp/**` or the admin assistant imports the reader or the writer.
//
// The scan is INVERTED (all of `app/**`, `sanity/**` and the root-level sources such as `auth.ts`
// and `proxy.ts`, exempt by exception), so a surface added tomorrow in a directory nobody thought of
// is covered by default. It reads `git ls-files`: stage a new file before running it.
//
// What it does NOT see, accepted: a wrapper module that a page caches (none exists, and a page that
// reads the session is dynamic anyway); a type name built at run time. One such reader exists and is
// accepted by ADR-0082: `sanity/structure.ts` lists every protected type by `_type == $type` from
// `PROTECTED_STUDIO_TYPES` — the Studio, open to Sanity project members, who read everything anyway.
// A `_type match "ministry*"` or `string::startsWith(_type, …)` prefix read is flagged below.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { stripComments } from "../../../scripts/lib/strip-comments.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** THE list of files allowed to name the type. Adding one is a reviewed change to this list. */
const ALLOWED = [
  "app/utils/ministryEventCommit.ts",
  "app/utils/ministryEventReads.ts",
  "app/utils/protectedReadAudit.ts",
  "app/utils/revalidate.ts",
  "app/utils/studioProtection.ts",
  "sanity/schema.ts",
  "sanity/schemas/ministryEvent.ts",
];

const READER = "app/utils/ministryEventReads";
const WRITER = "app/utils/ministryEventCommit";

/** The surfaces that must never read or write a ministry event (MCP and the admin assistant). */
const FORBIDDEN_IMPORTERS = [/^app\/mcp\//, /^app\/api\/admin\/chat\//, /^app\/utils\/adminChat[^/]*$/];

const CACHE_MARKERS: Array<[string, RegExp]> = [
  ["unstable_cache", /\bunstable_cache\b/],
  ['"use cache"', /["']use cache["']/],
  ["cacheLife", /\bcacheLife\b/],
  ["export const revalidate", /\bexport\s+const\s+revalidate\b/],
];

const isTest = (f: string) => f.includes("/__tests__/") || /\.test\.[cm]?[jt]sx?$/.test(f);

function sources(): string[] {
  const out = execFileSync("git", ["ls-files", "app", "sanity", "*.ts", "*.tsx", "*.mjs", "*.js"], { cwd: REPO_ROOT, encoding: "utf8" });
  return out
    .split("\n")
    // Root-level files only from the bare globs (`auth.ts`, `proxy.ts`, `sanity.config.ts`, …);
    // `scripts/`, `e2e/`, `gcf*` and friends are not the app.
    .filter((f) => /^(app|sanity)\//.test(f) || !f.includes("/"))
    .filter((f) => /\.[cm]?[jt]sx?$/.test(f) && !isTest(f));
}

// Every module specifier position: `from "x"`, `import "x"`, `import("x")`, `require("x")`.
const SPECIFIER = /(\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(["'`])([^"'`\n]+)\2/g;

/** The specifiers a file imports, resolved to repo paths without extension. */
function importsOf(file: string, code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(SPECIFIER)) {
    const spec = m[3];
    let resolved: string | null = null;
    if (spec.startsWith("@/")) resolved = spec.slice(2);
    else if (spec.startsWith(".")) resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
    if (resolved) out.push(resolved.replace(/\.[cm]?[jt]sx?$/, "").replace(/\/index$/, ""));
  }
  return out;
}

/** Does this (comment-stripped) code name the type outside its import specifiers? */
function namesType(code: string): boolean {
  const blanked = code.replace(SPECIFIER, (all, lead: string, q: string, spec: string) => `${lead}${q}${" ".repeat(spec.length)}${q}`);
  return (
    /\bministryEvent\b/.test(blanked) ||
    /\bMINISTRY_EVENT_TYPE\b/.test(blanked) ||
    // A prefix read reaches the type without spelling it.
    /_type\s+match\s*["'`]ministry/i.test(blanked) ||
    /startsWith\(\s*_type\s*,\s*["'`]ministry/i.test(blanked)
  );
}

function load(file: string): string {
  return stripComments(readFileSync(path.join(REPO_ROOT, file), "utf8"));
}

describe("G1: ministryEvent read coverage", () => {
  const files = sources();

  it("scans a real tree (the reader and the schema are in it)", () => {
    expect(files).toContain(`${READER}.ts`);
    expect(files).toContain("sanity/schemas/ministryEvent.ts");
  });

  it("only the allowed files name the type", () => {
    const naming = files.filter((f) => namesType(load(f)));
    expect(naming.filter((f) => !ALLOWED.includes(f))).toEqual([]);
  });

  it("no file that imports the reader caches its result", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const code = load(f);
      if (!importsOf(f, code).includes(READER)) continue;
      for (const [label, re] of CACHE_MARKERS) if (re.test(code)) offenders.push(`${f}: ${label}`);
    }
    expect(offenders).toEqual([]);
  });

  it("scans the root-level server files too", () => {
    expect(files).toContain("auth.ts");
    expect(files).toContain("proxy.ts");
  });

  // The nav (a "use client" tree) imports `rollout.ts` → `ministryAccess.ts`. `memberAccess.ts`
  // imports the server Sanity client, so those two may reach it by a TYPE import only, or the
  // client bundle would carry it.
  it("the modules the nav imports reach memberAccess by type only", () => {
    for (const f of ["app/utils/rollout.ts", "app/utils/ministryAccess.ts", "app/components/navSections.ts"]) {
      const code = load(f);
      const valueImport = /^\s*import\s+(?!type\b)[^;]*?from\s*["'][^"']*memberAccess["']/m;
      expect([f, valueImport.test(code)]).toEqual([f, false]);
    }
  });

  it("neither MCP nor the admin assistant imports the reader or the writer", () => {
    const offenders = files
      .filter((f) => FORBIDDEN_IMPORTERS.some((re) => re.test(f)))
      .filter((f) => importsOf(f, load(f)).some((i) => i === READER || i === WRITER));
    expect(offenders).toEqual([]);
  });
});

describe("G1: the scanner itself", () => {
  it.each([
    ['*[_type == "ministryEvent"]', true],
    ["*[_type == 'ministryEvent']", true],
    ["`*[_type == ministryEvent]`", true],
    ["const t = MINISTRY_EVENT_TYPE;", true],
    ['import { MINISTRY_EVENT_TYPE } from "@/app/utils/ministryEventReads";', true],
    ['import { readMinistryEvents } from "@/app/utils/ministryEventReads";', false],
    ['const x = await import("./ministryEventReads");', false],
    ['*[_type == "ministryEventSeat"]', false],
    ['*[_type match "ministry*"]', true],
    ["*[string::startsWith(_type, 'ministryE')]", true],
  ])("%s → %s", (code, expected) => {
    expect(namesType(code)).toBe(expected);
  });

  it("resolves alias and relative imports to the same module", () => {
    const code = 'import { a } from "@/app/utils/ministryEventReads";\nimport { b } from "../utils/ministryEventReads.ts";';
    expect(importsOf("app/jovenes/page.tsx", code)).toEqual([READER, READER]);
  });
});
