// app/utils/__tests__/loadingSkeletons.test.ts
// The four loading.tsx files compose Skeleton instead of hand-copying pulse blocks
// (spec §4, §5.1–§5.3). Pulse is the pre-M0 spelling; a new one fails here.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const FILES = [
  "app/(client)/loading.tsx",
  "app/(client)/me/loading.tsx",
  "app/(client)/schedule/loading.tsx",
  "app/(client)/posts/[slug]/loading.tsx",
];

describe.each(FILES)("%s", (rel) => {
  const src = readFileSync(path.join(REPO_ROOT, rel), "utf8");
  it("uses Skeleton and SkeletonGroup", () => {
    expect(src).toMatch(/import Skeleton, \{ SkeletonGroup \} from "[./]*components\/ui\/Skeleton"/);
    expect(src).toMatch(/<SkeletonGroup label="/);
  });
  it("carries no animate-pulse", () => {
    expect(src).not.toContain("animate-pulse");
  });
});

it("brand.css shimmer animates transform on a pseudo-element, never background-position", () => {
  const css = readFileSync(path.join(REPO_ROOT, "app/brand.css"), "utf8");
  const after = css.match(/\.brand-skeleton::after\s*\{([^}]*)\}/)?.[1] ?? "";
  expect(after).toMatch(/animation:\s*shimmer var\(--motion-shimmer\) linear infinite/);
  expect(css).not.toMatch(/\.brand-skeleton[^{]*\{[^}]*background-position/);
});
