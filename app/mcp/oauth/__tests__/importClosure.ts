// Test-only static import-closure walker — NOT a test file (no `.test.` in
// the name, so vitest's `include` never picks it up).
//
// A route test that only MOCKS a module (e.g. `@/sanity/lib/serverClient`)
// and asserts the mock was never called only proves the paths that specific
// run happened to exercise. It says nothing about whether the route's SOURCE
// still reaches that module at all — a helper added deep inside a module the
// route already imports (`tokens.ts`, shared with a future route that DOES
// need `grantStore`) could pull a writer in with every runtime test still
// green, because the mock is simply never invoked on the paths that changed.
//
// This walks the real import graph from source text, so a forbidden module
// entering the closure fails here even before any handler runs.
//
// `importSpecifiers` was extracted from `documentTypes.test.ts` (which now
// imports it from here) rather than re-implemented, per ruling R15 finding 3.
//
// R15 follow-up: a specifier that STARTS WITH `@/` or `.` but fails to
// resolve used to be silently folded into `externalSpecifiers` — the same
// bucket as a genuine bare package specifier like `jose`. That is exactly the
// false-green this guard exists to prevent: a typo'd or renamed internal
// path, a `.json` import this walker doesn't know how to read, or a NEW
// tsconfig alias it has never heard of would all just look like one more
// external dependency, and a "closure never reaches X" assertion would keep
// passing while quietly seeing less of the graph than it thinks. The walker
// now THROWS, naming the file and the specifier, the moment an
// internal-looking specifier fails to resolve — and separately refuses to run
// at all if `repoRoot`'s tsconfig.json declares a path alias besides `@/*`
// (the only one this walker understands), rather than let that alias's
// specifiers slide into the external bucket unexamined.

import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s+["']([^"']+)["']/g;
const SIDE_EFFECT_IMPORT_RE = /(?:^|\n)\s*import\s+["']([^"']+)["']/g;

/** Every module specifier a file's source text imports or re-exports from. */
export function importSpecifiers(src: string): string[] {
  const specifiers = new Set<string>();
  for (const m of src.matchAll(IMPORT_RE)) specifiers.add(m[1]!);
  for (const m of src.matchAll(SIDE_EFFECT_IMPORT_RE)) specifiers.add(m[1]!);
  return [...specifiers];
}

const RESOLVE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".mjs", ".js"];

function fileExists(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/** Resolves a base path (no extension) to a real file, trying a literal match then `index.*`. */
function resolveBase(base: string): string | null {
  for (const ext of ["", ...RESOLVE_EXTENSIONS]) {
    if (fileExists(base + ext)) return base + ext;
  }
  for (const ext of RESOLVE_EXTENSIONS) {
    const indexCandidate = path.join(base, `index${ext}`);
    if (fileExists(indexCandidate)) return indexCandidate;
  }
  return null;
}

/** True for a specifier this walker treats as INTERNAL: it must resolve to a file, or the walk throws. */
function isInternalSpecifier(specifier: string): boolean {
  return specifier.startsWith("@/") || specifier.startsWith(".");
}

/**
 * Resolves one specifier relative to the file that imports it. Only relative
 * (`./x`, `../x`) and `@/`-aliased (the repo-root alias `vitest.config.ts` and
 * `tsconfig.json` both declare) specifiers are followed — a bare package
 * specifier (`jose`, `node:crypto`, `sanity`, `server-only`, …) is a LEAF and
 * returns `null`, never walked further.
 *
 * Does NOT throw on a failed resolution by itself — `walkImportClosure`
 * decides what a `null` means (a genuine leaf vs. a specifier that LOOKED
 * internal and should have resolved), since only it knows the specifier's
 * shape.
 */
export function resolveModuleFile(fromFile: string, specifier: string, repoRoot: string): string | null {
  if (specifier.startsWith("@/")) return resolveBase(path.join(repoRoot, specifier.slice(2)));
  if (specifier.startsWith(".")) return resolveBase(path.resolve(path.dirname(fromFile), specifier));
  return null;
}

/** The only path alias this walker knows how to resolve. */
const KNOWN_ALIAS = "@/*";

/**
 * Guards against a SECOND alias appearing in `repoRoot`'s tsconfig.json and
 * silently being treated as a bare package by `resolveModuleFile` (which only
 * recognizes `@/` and `.`): if a tsconfig.json exists at all, it must declare
 * no `paths` alias besides `KNOWN_ALIAS`. A synthetic test root with no
 * tsconfig.json is exempt — there is nothing to check.
 */
function assertNoUnknownAlias(repoRoot: string): void {
  const tsconfigPath = path.join(repoRoot, "tsconfig.json");
  if (!fileExists(tsconfigPath)) return;
  let parsed: { compilerOptions?: { paths?: Record<string, unknown> } };
  try {
    parsed = JSON.parse(readFileSync(tsconfigPath, "utf8"));
  } catch (err) {
    throw new Error(`walkImportClosure: could not parse ${tsconfigPath} as JSON: ${String(err)}`);
  }
  const unknown = Object.keys(parsed.compilerOptions?.paths ?? {}).filter((alias) => alias !== KNOWN_ALIAS);
  if (unknown.length > 0) {
    throw new Error(
      `walkImportClosure: ${tsconfigPath} declares path alias(es) this walker does not resolve: ` +
        `${unknown.join(", ")}. Their specifiers would otherwise be silently counted as external — ` +
        `update resolveModuleFile (and KNOWN_ALIAS above) before trusting this walker's result.`,
    );
  }
}

export interface ImportClosure {
  /** Every file transitively reached, as absolute paths, the entry file included. */
  files: Set<string>;
  /** Every BARE (non-internal) specifier seen anywhere in the closure — never a mis-resolved internal one. */
  externalSpecifiers: Set<string>;
}

/**
 * Walks the transitive import graph of `entryFile`, following only relative
 * and `@/`-aliased specifiers (see `resolveModuleFile`). Cycle-safe: a file is
 * only ever processed once.
 *
 * Throws if:
 *  - a `@/`- or `.`-prefixed specifier fails to resolve to a real file
 *    (naming the importing file and the specifier), or
 *  - `repoRoot`'s tsconfig.json declares a `paths` alias besides `@/*`.
 *
 * Both would otherwise widen `externalSpecifiers` with something that was
 * never really external, hiding a forbidden module behind a false "leaf".
 */
export function walkImportClosure(entryFile: string, repoRoot: string): ImportClosure {
  assertNoUnknownAlias(repoRoot);
  const files = new Set<string>();
  const externalSpecifiers = new Set<string>();
  const stack = [path.resolve(entryFile)];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    const src = readFileSync(file, "utf8");
    for (const specifier of importSpecifiers(src)) {
      const resolved = resolveModuleFile(file, specifier, repoRoot);
      if (resolved) {
        stack.push(resolved);
        continue;
      }
      if (isInternalSpecifier(specifier)) {
        throw new Error(`walkImportClosure: cannot resolve internal specifier "${specifier}" imported from ${file}`);
      }
      externalSpecifiers.add(specifier);
    }
  }
  return { files, externalSpecifiers };
}
