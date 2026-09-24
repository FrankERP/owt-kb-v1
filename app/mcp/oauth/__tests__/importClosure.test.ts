// app/mcp/oauth/__tests__/importClosure.test.ts
//
// Direct tests for the shared static import-closure walker (R15 finding 3,
// and its own R15 follow-up finding): an unresolvable `@/` or relative
// specifier must THROW, naming the importing file and the specifier, rather
// than silently widen `externalSpecifiers` — the same false-green the
// register-route guard (`oauthRegisterRoute.test.ts`) uses this walker to
// catch. Uses real temp directories (`node:fs` `mkdtemp`), the shape the
// helper itself is built around, rather than an injected reader.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { importSpecifiers, resolveModuleFile, walkImportClosure } from "./importClosure";

let tempRoot: string | undefined;

/** A throwaway repo root, removed in `afterEach` even if the test itself throws first. */
function makeTempRepo(): string {
  tempRoot = mkdtempSync(path.join(tmpdir(), "import-closure-test-"));
  return tempRoot;
}

afterEach(() => {
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe("importSpecifiers", () => {
  it("reads `import … from`, `export … from`, and bare side-effect imports", () => {
    const src = `
import { a } from "./a";
import type { B } from "../b";
export { c } from "./c";
import "server-only";
`;
    expect(importSpecifiers(src)).toEqual(expect.arrayContaining(["./a", "../b", "./c", "server-only"]));
  });
});

describe("resolveModuleFile", () => {
  it("returns null for a bare package specifier — never walked further", () => {
    const root = makeTempRepo();
    expect(resolveModuleFile(path.join(root, "x.ts"), "jose", root)).toBeNull();
  });

  it("does not itself throw on an unresolvable internal specifier (that is walkImportClosure's job)", () => {
    const root = makeTempRepo();
    expect(resolveModuleFile(path.join(root, "x.ts"), "@/does/not/exist", root)).toBeNull();
    expect(resolveModuleFile(path.join(root, "x.ts"), "./nope", root)).toBeNull();
  });
});

describe("walkImportClosure — resolution", () => {
  it("walks relative and @/-aliased imports to their real files, and records genuine bare specifiers", () => {
    const root = makeTempRepo();
    mkdirSync(path.join(root, "app", "sub"), { recursive: true });
    writeFileSync(
      path.join(root, "app", "entry.ts"),
      `
import { x } from "./sub/leaf";
import { y } from "@/app/other";
import { z } from "jose";
`,
    );
    writeFileSync(path.join(root, "app", "sub", "leaf.ts"), `export const x = 1;`);
    writeFileSync(path.join(root, "app", "other.ts"), `export const y = 2;`);

    const { files, externalSpecifiers } = walkImportClosure(path.join(root, "app", "entry.ts"), root);
    expect(files).toContain(path.join(root, "app", "sub", "leaf.ts"));
    expect(files).toContain(path.join(root, "app", "other.ts"));
    expect(externalSpecifiers).toEqual(new Set(["jose"]));
  });

  it("is cycle-safe", () => {
    const root = makeTempRepo();
    writeFileSync(path.join(root, "a.ts"), `import "./b";`);
    writeFileSync(path.join(root, "b.ts"), `import "./a";`);
    const { files } = walkImportClosure(path.join(root, "a.ts"), root);
    expect(files.size).toBe(2);
  });
});

describe("walkImportClosure — an unresolvable internal specifier throws (R15 follow-up)", () => {
  it("throws, naming the file and the specifier, for an unresolvable @/ specifier", () => {
    const root = makeTempRepo();
    mkdirSync(path.join(root, "app"), { recursive: true });
    const entry = path.join(root, "app", "entry.ts");
    writeFileSync(entry, `import { missing } from "@/app/does-not-exist";`);

    expect(() => walkImportClosure(entry, root)).toThrow(/@\/app\/does-not-exist/);
    expect(() => walkImportClosure(entry, root)).toThrow(
      new RegExp(entry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  });

  it("throws for an unresolvable relative specifier too", () => {
    const root = makeTempRepo();
    const entry = path.join(root, "entry.ts");
    writeFileSync(entry, `import { missing } from "./nope";`);
    expect(() => walkImportClosure(entry, root)).toThrow(/\.\/nope/);
  });

  it("still throws even for a specifier reached several hops deep, not just at the entry file", () => {
    const root = makeTempRepo();
    writeFileSync(path.join(root, "entry.ts"), `import "./mid";`);
    writeFileSync(path.join(root, "mid.ts"), `import "./deep-and-missing";`);
    expect(() => walkImportClosure(path.join(root, "entry.ts"), root)).toThrow(/deep-and-missing/);
  });
});

describe("walkImportClosure — tsconfig alias guard (R15 follow-up)", () => {
  it("passes when the root's tsconfig.json declares only @/*", () => {
    const root = makeTempRepo();
    writeFileSync(
      path.join(root, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { paths: { "@/*": ["./*"] } } }),
    );
    const entry = path.join(root, "entry.ts");
    writeFileSync(entry, `export const ok = true;`);
    expect(() => walkImportClosure(entry, root)).not.toThrow();
  });

  it("throws when tsconfig.json declares an alias this walker does not know how to resolve", () => {
    const root = makeTempRepo();
    writeFileSync(
      path.join(root, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { paths: { "@/*": ["./*"], "~/*": ["./app/*"] } } }),
    );
    const entry = path.join(root, "entry.ts");
    writeFileSync(entry, `export const ok = true;`);
    expect(() => walkImportClosure(entry, root)).toThrow(/~\/\*/);
  });

  it("is exempt when no tsconfig.json exists at the root (a synthetic test root)", () => {
    const root = makeTempRepo();
    const entry = path.join(root, "entry.ts");
    writeFileSync(entry, `export const ok = true;`);
    expect(() => walkImportClosure(entry, root)).not.toThrow();
  });
});

describe("walkImportClosure — the real repo", () => {
  it("this repo's tsconfig.json declares only the @/* alias the walker resolves", () => {
    const repoRoot = process.cwd();
    // The walker's own file: imports only node:fs/node:path (bare, external).
    const entry = path.join(repoRoot, "app/mcp/oauth/__tests__/importClosure.ts");
    expect(() => walkImportClosure(entry, repoRoot)).not.toThrow();
  });
});
