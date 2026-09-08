// The rule that makes decision A safe (spec §3): `motion` is imported ONLY by the
// primitives under app/components/ui/** and by app/utils/motion*. Feature components
// compose Presence / Reveal / Collapse / …; they never reach for `m.div` directly.
// Same shape as clientBoundary.test.ts: a repo-wide walk, a clean-tree assertion,
// and a synthetic fire-proof.
//
// Widened (Task 3 review ruling, folded into Task 9): the original regex only
// caught a named `from "motion/…"` import. That misses a side-effect import
// (`import "motion/react"`), a dynamic import (`await import("motion/…")`), a
// `require("motion")`, and `export * from "motion/…"` — all of them pull the
// same runtime cost into the bundle without ever matching `from\s+["']`. The
// walk also now covers `.js`/`.jsx` and both the `app` and `sanity` roots, the
// same two roots `clientBoundary.test.ts` walks. Type-only imports
// (`import type … from "motion/react"`) stay FLAGGED — a recorded ruling, not
// an oversight: `import type` erases at compile time, but the whole point of
// this guard is "grep for the pattern that shouldn't spread", and an
// `import type` site is exactly the kind of thing that silently grows a real
// import next to it later. Erasing zero-cost imports from the guard buys
// nothing and costs a blind spot.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const ROOTS = ["app", "sanity"];
const IMPORT_RE = /(?:from|import|require)\s*\(?\s*["'](motion|motion\/[a-z-]+|framer-motion)["']/g;

export function isAllowedMotionImporter(rel: string): boolean {
  const p = rel.split(path.sep).join("/");
  if (p.includes("/__tests__/")) return true;
  if (p.startsWith("app/components/ui/")) return true;
  if (/^app\/utils\/motion[^/]*\.tsx?$/.test(p)) return true;
  return false;
}

export function matchesMotionImport(src: string): boolean {
  const re = new RegExp(IMPORT_RE.source, "g");
  return re.test(src);
}

export function findMotionImports(root: string, roots: string[] = ROOTS): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules") walk(rel); continue; }
      if (!/\.(ts|tsx|mjs|js|jsx)$/.test(e.name)) continue;
      const src = readFileSync(path.join(root, rel), "utf8");
      if (matchesMotionImport(src)) out.push(rel);
    }
  };
  for (const r of roots) walk(r);
  return out.sort();
}

describe("motion import boundary", () => {
  it("only ui/ primitives and app/utils/motion* import motion", () => {
    const offenders = findMotionImports(REPO_ROOT).filter((f) => !isAllowedMotionImporter(f));
    expect(
      offenders,
      "A feature component imports `motion` directly. Compose a primitive from " +
        "app/components/ui/ instead (Presence, Collapse, SegmentedControl…) — see docs/MOTION.md.",
    ).toEqual([]);
  });

  it("the provider itself is an importer (the walk is not vacuous)", () => {
    expect(findMotionImports(REPO_ROOT)).toContain(path.join("app", "components", "ui", "MotionProvider.tsx"));
  });

  it("FIRES on a synthetic feature-component import (the fire-proof)", () => {
    expect(isAllowedMotionImporter("app/components/DayCard.tsx")).toBe(false);
    expect(isAllowedMotionImporter("app/components/admin/PlannerGrid.tsx")).toBe(false);
    expect(isAllowedMotionImporter("app/(client)/page.tsx")).toBe(false);
  });

  it("allows exactly the two roots", () => {
    expect(isAllowedMotionImporter("app/components/ui/Presence.tsx")).toBe(true);
    expect(isAllowedMotionImporter("app/utils/motionPresets.ts")).toBe(true);
    expect(isAllowedMotionImporter("app/utils/motionless.ts")).toBe(true); // prefix rule, documented
    expect(isAllowedMotionImporter("app/utils/reveal.ts")).toBe(false);
  });
});

describe("motion import boundary — widened import forms (fire-proof, synthetic)", () => {
  it("catches a named import", () => {
    expect(matchesMotionImport('import { m } from "motion/react";')).toBe(true);
  });

  it("catches a side-effect import", () => {
    expect(matchesMotionImport('import "motion/react";')).toBe(true);
  });

  it("catches a dynamic import", () => {
    expect(matchesMotionImport('const { m } = await import("motion/react");')).toBe(true);
  });

  it("catches a require()", () => {
    expect(matchesMotionImport('const { m } = require("motion");')).toBe(true);
  });

  it("catches export * from", () => {
    expect(matchesMotionImport('export * from "motion/react";')).toBe(true);
  });

  it("still catches (does not exempt) a type-only import — recorded ruling", () => {
    expect(matchesMotionImport('import type { HTMLMotionProps } from "motion/react";')).toBe(true);
  });

  it("does not fire on an unrelated import", () => {
    expect(matchesMotionImport('import { useState } from "react";')).toBe(false);
  });
});
