// The five secondary admin tabs + `MonthGenerator` load on demand (Task 6).
//
// A source scan, not a render: it proves each of the six names is imported
// through `next/dynamic` in exactly the file that is allowed to gate it
// (`AdminPanel.tsx` for the tabs, `ServicesPanel.tsx` for the generator), and
// that no OTHER file under `app/**` imports one of them statically — a static
// import anywhere else would pull the chunk back into the eagerly-loaded
// graph and silently undo the split this task exists to make.
//
// `ServicesPanel` and `IntegrityQueuePanel` stay OUT of this list on purpose:
// Servicios is the default tab for most roles, and the integrity fetch feeds
// the rail's dot on every tab, so both are meant to load eagerly.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const APP_ROOT = path.join(REPO_ROOT, "app");

const GATED = [
  { name: "ActivityPanel", gatedBy: "app/components/admin/AdminPanel.tsx" },
  { name: "ContentPanel", gatedBy: "app/components/admin/AdminPanel.tsx" },
  { name: "AvailabilityPanel", gatedBy: "app/components/admin/AdminPanel.tsx" },
  { name: "ProposalsPanel", gatedBy: "app/components/admin/AdminPanel.tsx" },
  { name: "MembersPanel", gatedBy: "app/components/admin/AdminPanel.tsx" },
  { name: "MonthGenerator", gatedBy: "app/components/admin/ServicesPanel.tsx" },
] as const;

/** Every source file under `app/**`, excluding `__tests__` directories. */
function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__" || entry === "__fixtures__" || entry === "node_modules") continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (/\.(tsx?|jsx?)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const SOURCE_FILES = listSourceFiles(APP_ROOT);

describe("admin: the five secondary tabs and MonthGenerator load on demand", () => {
  for (const { name, gatedBy } of GATED) {
    it(`${name} is imported through next/dynamic, only in ${gatedBy}`, () => {
      const gatedByPath = path.join(REPO_ROOT, gatedBy);
      const gatedSource = readFileSync(gatedByPath, "utf8");
      const dynamicPattern = new RegExp(
        `dynamic\\(\\(\\)\\s*=>\\s*import\\(["'][^"']*${name}["']\\)`,
      );
      expect(gatedSource, `${gatedBy} must import ${name} via next/dynamic`).toMatch(dynamicPattern);

      // A plain, top-of-file static import of the SAME name anywhere else
      // under app/** (excluding tests) would defeat the split.
      const staticImportPattern = new RegExp(`^import\\s+${name}\\s+from\\s+["'][^"']*["'];?\\s*$`, "m");
      for (const file of SOURCE_FILES) {
        const rel = path.relative(REPO_ROOT, file).split(path.sep).join("/");
        const src = readFileSync(file, "utf8");
        if (rel === gatedBy) {
          // The gating file itself must NOT also carry a static import of the
          // same name (that would just re-eagerify it beside the dynamic one).
          expect(src, `${rel} imports ${name} both statically and dynamically`).not.toMatch(
            staticImportPattern,
          );
          continue;
        }
        expect(src, `${rel} imports ${name} statically — that undoes the on-demand split`).not.toMatch(
          staticImportPattern,
        );
      }
    });
  }
});
