// Finds the bug class that took the home page down on 2026-09-02 (ADR-0028):
// a module with no `"use client"` directive CALLING a value it imported from a
// module that has one.
//
// What React hands a server module across that boundary is a client reference,
// not the function. Calling it throws at render:
//
//     Attempted to call paintsDayCard() from the server but paintsDayCard is on
//     the client.
//
// Nothing else in the toolchain asks this question. `tsc` types the export
// identically on both sides, because the boundary is a bundler property rather
// than a type. Unit tests import the function directly and never cross the
// boundary at all — they stayed green through the entire outage. `next build`
// compiles a dynamic route without rendering it, so the throw waits for a real
// request. A file-walking check is the only control available.
//
// SCOPE, deliberately narrow: this flags CALLS, `f(...)`. A client component
// rendered as JSX is legal and must never be flagged, and so is a client value
// forwarded as a prop to another client component — `<NextStudio config={config}/>`
// in the Studio page is the canonical next-sanity scaffold and does exactly that.
// Calls are the sharp edge, they are what actually threw, and keeping the rule
// this tight is what lets it run with no allowlist of judgement calls.
//
// The check ignores whether a violating module is reachable from a server
// component TODAY. `moveOccupant.ts` was not — every importer was a client
// component — but it advertises itself as the primitive "every drag must go
// through", so the first server-side caller would have discovered the boundary
// the way production did. A declared `"use client"` costs one line.

import ts from "typescript";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export interface Violation {
  file: string;
  line: number;
  symbol: string;
  from: string;
}

const EXTENSIONS = [".ts", ".tsx"];
const RESOLVE_SUFFIXES = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

/** `"use client"` counts only as a leading directive; leading comments are fine, code is not. */
export function isClientModule(source: string): boolean {
  const sf = ts.createSourceFile("m.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const first = sf.statements[0];
  if (!first || !ts.isExpressionStatement(first)) return false;
  const expr = first.expression;
  return ts.isStringLiteral(expr) && expr.text === "use client";
}

export function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      // Tests import and call across any boundary they like; they never render on a server.
      if (entry === "__tests__" || entry === "__fixtures__") continue;
      walk(full, out);
    } else if (EXTENSIONS.includes(path.extname(entry)) && !/\.(test|spec)\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function resolveImport(spec: string, fromFile: string, repoRoot: string): string | null {
  const base = spec.startsWith("@/")
    ? path.join(repoRoot, spec.slice(2))
    : spec.startsWith(".")
      ? path.resolve(path.dirname(fromFile), spec)
      : null;
  if (!base) return null; // a package, never one of ours
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = base + suffix;
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      /* keep trying */
    }
  }
  return null;
}

export function findViolations(repoRoot: string, roots: string[]): Violation[] {
  const files = roots.flatMap((r) => {
    try {
      return walk(path.join(repoRoot, r));
    } catch {
      return [];
    }
  });

  const sources = new Map<string, string>();
  const read = (f: string) => {
    if (!sources.has(f)) sources.set(f, readFileSync(f, "utf8"));
    return sources.get(f)!;
  };
  const clientCache = new Map<string, boolean>();
  const isClient = (f: string) => {
    if (!clientCache.has(f)) clientCache.set(f, isClientModule(read(f)));
    return clientCache.get(f)!;
  };

  const violations: Violation[] = [];

  for (const file of files) {
    if (isClient(file)) continue;
    const source = read(file);
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

    // local name -> the client module it came from
    const fromClient = new Map<string, string>();
    for (const st of sf.statements) {
      if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
      const clause = st.importClause;
      if (!clause || clause.isTypeOnly) continue; // `import type` is erased
      const target = resolveImport(st.moduleSpecifier.text, file, repoRoot);
      if (!target || !isClient(target)) continue;
      const rel = path.relative(repoRoot, target);
      if (clause.name) fromClient.set(clause.name.text, rel);
      const named = clause.namedBindings;
      if (named && ts.isNamedImports(named)) {
        for (const el of named.elements) {
          if (el.isTypeOnly) continue; // `import { type X }` is erased too
          fromClient.set(el.name.text, rel);
        }
      }
    }
    if (fromClient.size === 0) continue;

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const from = fromClient.get(node.expression.text);
        if (from) {
          violations.push({
            file: path.relative(repoRoot, file),
            line: sf.getLineAndCharacterOfPosition(node.expression.getStart(sf)).line + 1,
            symbol: node.expression.text,
            from,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  return violations;
}
