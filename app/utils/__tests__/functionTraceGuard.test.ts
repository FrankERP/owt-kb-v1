// A server module that spawns a process must gate the spawn on a production build.
//
// `spawn(python, [path.join(process.cwd(), …)])` is a path the file tracer cannot resolve, so
// it packs the WHOLE repository into every function that reaches the module: docs/, the e2e
// screenshots, ios/, android/. It made /api/mcp and /api/admin/solve 57–59 MB (2026-10-27),
// most of every deployment's Function Storage. Gating the spawn behind
// `process.env.NODE_ENV === "production"` (a build-time constant) lets the bundler drop it.
// `next build` only warns ("Encountered unexpected file in NFT list") and CI does not build,
// so this is the guard.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ROOTS = ["app", "sanity"];

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "__tests__" || e.name === "node_modules" ? [] : sourceFiles(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

const SPAWNS = /from\s+["'](node:)?child_process["']/;
const GATE = /process\.env\.NODE_ENV\s*===\s*["']production["']/;

describe("function trace guard", () => {
  it("every server module that imports child_process gates it on a production build", () => {
    const files = ROOTS.flatMap((r) => sourceFiles(path.join(REPO_ROOT, r)));
    const spawners = files.filter((f) => SPAWNS.test(fs.readFileSync(f, "utf8")));
    // The two local solver paths; if this drops to zero the guard is scanning nothing.
    expect(spawners.length).toBeGreaterThan(0);
    const ungated = spawners.filter((f) => !GATE.test(fs.readFileSync(f, "utf8")));
    expect(ungated.map((f) => path.relative(REPO_ROOT, f))).toEqual([]);
  });
});
