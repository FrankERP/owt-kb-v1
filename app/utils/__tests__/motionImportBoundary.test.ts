// The rule that makes decision A safe (spec §3): `motion` is imported ONLY by the
// primitives under app/components/ui/** and by app/utils/motion*. Feature components
// compose Presence / Reveal / Collapse / …; they never reach for `m.div` directly.
// Same shape as clientBoundary.test.ts: a repo-wide walk, a clean-tree assertion,
// and a synthetic fire-proof.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const IMPORT_RE = /from\s+["'](motion|motion\/[a-z-]+|framer-motion)["']/g;

export function isAllowedMotionImporter(rel: string): boolean {
  const p = rel.split(path.sep).join("/");
  if (p.includes("/__tests__/")) return true;
  if (p.startsWith("app/components/ui/")) return true;
  if (/^app\/utils\/motion[^/]*\.tsx?$/.test(p)) return true;
  return false;
}

export function findMotionImports(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules") walk(rel); continue; }
      if (!/\.(ts|tsx|mjs)$/.test(e.name)) continue;
      const src = readFileSync(path.join(root, rel), "utf8");
      if (IMPORT_RE.test(src)) out.push(rel);
      IMPORT_RE.lastIndex = 0;
    }
  };
  walk("app");
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
