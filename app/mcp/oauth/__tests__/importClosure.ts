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

/**
 * Resolves one specifier relative to the file that imports it. Only relative
 * (`./x`, `../x`) and `@/`-aliased (the repo-root alias `vitest.config.ts` and
 * `tsconfig.json` both declare) specifiers are followed — a bare package
 * specifier (`jose`, `node:crypto`, `sanity`, `server-only`, …) is a LEAF and
 * returns `null`, never walked further.
 */
export function resolveModuleFile(fromFile: string, specifier: string, repoRoot: string): string | null {
  if (specifier.startsWith("@/")) return resolveBase(path.join(repoRoot, specifier.slice(2)));
  if (specifier.startsWith(".")) return resolveBase(path.resolve(path.dirname(fromFile), specifier));
  return null;
}

export interface ImportClosure {
  /** Every file transitively reached, as absolute paths, the entry file included. */
  files: Set<string>;
  /** Every specifier seen anywhere in the closure that resolved to no repo file (leaves). */
  externalSpecifiers: Set<string>;
}

/**
 * Walks the transitive import graph of `entryFile`, following only relative
 * and `@/`-aliased specifiers (see `resolveModuleFile`). Cycle-safe: a file is
 * only ever processed once.
 */
export function walkImportClosure(entryFile: string, repoRoot: string): ImportClosure {
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
      if (resolved) stack.push(resolved);
      else externalSpecifiers.add(specifier);
    }
  }
  return { files, externalSpecifiers };
}
