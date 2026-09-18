// The VR config's shape, asserted on SOURCE TEXT — deliberately not by importing it.
//
// `playwright.vr.config.ts` THROWS at module load unless `THEME_GALLERY_VR_ENABLED`
// and `THEME_GALLERY_VR_BASE_URL` are set (ADR-0014: a baseline never runs against an
// unspecified target). Importing it from vitest would either fail the suite or force
// the suite to set the opt-in vars — which would make the refusal untestable and, worse,
// teach a future reader that setting them is routine. So this reads the file.
//
// What is pinned here is the part a capture silently depends on: two projects (a
// desktop and a phone baseline are different pictures), a snapshot path that is scoped
// by PLATFORM (baselines are darwin-only — a linux run must not compare against them),
// and a tolerance, so an anti-aliasing shift is not reported as a regression.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const src = readFileSync(path.join(REPO_ROOT, "playwright.vr.config.ts"), "utf8");

describe("playwright.vr.config.ts", () => {
  it("names two projects and a platform-scoped snapshot template", () => {
    expect(src).toContain('name: "desktop"');
    expect(src).toContain('name: "phone"');
    expect(src).toContain("{platform}");
    expect(src).toContain("maxDiffPixelRatio");
  });

  it("keeps the opt-in refusal — the config is never runnable by accident", () => {
    expect(src).toContain("THEME_GALLERY_VR_ENABLED");
    expect(src).toContain("THEME_GALLERY_VR_BASE_URL");
    expect(src).toMatch(/throw new Error\(/);
  });

  it("still starts no server of its own and keeps captures deterministic", () => {
    // `webServer:` the KEY, not the word — the file explains in prose why it has none.
    expect(src).not.toMatch(/^\s*webServer:/m);
    expect(src).toContain("workers: 1");
    expect(src).toContain("retries: 0");
  });

  it("disables animations and the caret for every screenshot", () => {
    expect(src).toContain('animations: "disabled"');
    expect(src).toContain('caret: "hide"');
  });
});
