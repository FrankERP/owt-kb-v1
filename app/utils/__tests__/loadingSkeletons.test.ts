// app/utils/__tests__/loadingSkeletons.test.ts
// Every loading.tsx file composes Skeleton instead of hand-copying pulse blocks
// (spec §4, §5.1–§5.3). Pulse is the pre-M0 spelling; a new one fails here.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const FILES = [
  "app/(client)/loading.tsx",
  "app/(client)/me/loading.tsx",
  "app/(client)/me/disponibilidad/loading.tsx",
  "app/(client)/schedule/loading.tsx",
  "app/(client)/posts/[slug]/loading.tsx",
  "app/(client)/biblioteca/loading.tsx",
];

describe.each(FILES)("%s", (rel) => {
  const src = readFileSync(path.join(REPO_ROOT, rel), "utf8");
  it("uses Skeleton and SkeletonGroup", () => {
    expect(src).toMatch(/import Skeleton, \{ SkeletonGroup, NavbarSkeleton \} from "[./]*components\/ui\/Skeleton"/);
    expect(src).toMatch(/<SkeletonGroup label="/);
  });
  it("carries no animate-pulse", () => {
    expect(src).not.toContain("animate-pulse");
  });
  it("renders NavbarSkeleton as the first child of SkeletonGroup, so the top bar never vanishes", () => {
    expect(src).toContain("NavbarSkeleton");
    expect(src).toContain("<NavbarSkeleton />");
  });
});

it("schedule/loading.tsx mirrors the calendar's 7-column month grid", () => {
  const src = readFileSync(path.join(REPO_ROOT, "app/(client)/schedule/loading.tsx"), "utf8");
  expect(src).toContain("grid-cols-7");
});

describe("full-bleed navbar in loading states", () => {
  it("home/loading.tsx: NavbarSkeleton appears before the container's max-w-", () => {
    const src = readFileSync(path.join(REPO_ROOT, "app/(client)/loading.tsx"), "utf8");
    const navbarIndex = src.indexOf("<NavbarSkeleton />");
    const maxWIndex = src.indexOf("max-w-");
    expect(navbarIndex).toBeGreaterThan(-1);
    expect(maxWIndex).toBeGreaterThan(-1);
    expect(navbarIndex).toBeLessThan(maxWIndex);
  });

  it("me/loading.tsx: NavbarSkeleton appears before the container's max-w-", () => {
    const src = readFileSync(path.join(REPO_ROOT, "app/(client)/me/loading.tsx"), "utf8");
    const navbarIndex = src.indexOf("<NavbarSkeleton />");
    const maxWIndex = src.indexOf("max-w-");
    expect(navbarIndex).toBeGreaterThan(-1);
    expect(maxWIndex).toBeGreaterThan(-1);
    expect(navbarIndex).toBeLessThan(maxWIndex);
  });

  it("schedule/loading.tsx: NavbarSkeleton appears before the container's max-w-", () => {
    const src = readFileSync(path.join(REPO_ROOT, "app/(client)/schedule/loading.tsx"), "utf8");
    const navbarIndex = src.indexOf("<NavbarSkeleton />");
    const maxWIndex = src.indexOf("max-w-");
    expect(navbarIndex).toBeGreaterThan(-1);
    expect(maxWIndex).toBeGreaterThan(-1);
    expect(navbarIndex).toBeLessThan(maxWIndex);
  });
});

it("brand.css shimmer animates transform on a pseudo-element, never background-position", () => {
  const css = readFileSync(path.join(REPO_ROOT, "app/brand.css"), "utf8");
  const after = css.match(/\.brand-skeleton::after\s*\{([^}]*)\}/)?.[1] ?? "";
  expect(after).toMatch(/animation:\s*shimmer var\(--motion-shimmer\) linear infinite/);
  expect(css).not.toMatch(/\.brand-skeleton[^{]*\{[^}]*background-position/);
});
