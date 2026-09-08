// Spec Part III findings 3 and 5: the brand mark lazy-loaded (an empty square on
// every first paint) and the initials avatar painted navy-on-navy in light.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), "utf8");

describe("Navbar lockup", () => {
  it("loads the brand mark with priority — it is the first thing on every page", () => {
    const src = read("app/components/Navbar.tsx");
    const img = src.match(/<Image[\s\S]*?brand-lockup-mark[\s\S]*?\/>/)?.[0] ?? "";
    expect(img).toMatch(/\bpriority\b/);
  });

  it("drops the inert height transition nothing ever changed", () => {
    expect(read("app/components/Navbar.tsx")).not.toMatch(/transition-\[height\]/);
  });
});

describe("NavMenu initials avatar", () => {
  it("paints initials in the on-fill role, which stays light on the solid disc in both themes", () => {
    const src = read("app/components/NavMenu.tsx");
    const disc = src.match(/bg-surface-accent-solid[\s\S]*?<span className="([^"]*)">\{initials\}/)?.[1] ?? "";
    expect(disc).toContain("text-on-fill");
    expect(disc).not.toContain("text-accent");
  });
});
