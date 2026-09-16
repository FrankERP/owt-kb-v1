// Navbar and NavbarSkeleton must publish the top bar's height from ONE
// spelling (spec §5.3) so loading.tsx never hard-codes it and drifts from the
// real navbar. Reads sources rather than rendering — see
// bottomNavOffsetSync.test.ts for the house style of a source-reading guard.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NAVBAR_H_CLASS } from "../navbarHeight";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("navbar height sync", () => {
  it("navbarHeight.ts exports the constant as a string of two Tailwind height utilities", () => {
    expect(NAVBAR_H_CLASS).toBe("h-20 lg:h-24");
  });

  it.each([
    ["app/components/Navbar.tsx"],
    ["app/components/ui/Skeleton.tsx"],
  ])("%s imports NAVBAR_H_CLASS and never hard-codes the literal", (rel) => {
    const src = read(rel);
    expect(src).toMatch(/import\s*\{\s*NAVBAR_H_CLASS\s*\}\s*from\s*"@\/app\/utils\/navbarHeight"/);
    expect(src).not.toContain("h-20 lg:h-24");
  });
});
