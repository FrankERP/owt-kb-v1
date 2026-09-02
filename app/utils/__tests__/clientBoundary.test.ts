// The repo-wide guard for ADR-0028.
//
// On 2026-09-02 the home page threw on every render in production for 56
// minutes because `app/(client)/page.tsx` — a Server Component — called
// `paintsDayCard`, which was exported from `DayCard.tsx` (`"use client"`).
// What a server module receives across that boundary is a client reference, not
// the function.
//
// The fix added two guards that read those two specific files. This is the one
// that generalises: it fails on a NEW violation anywhere under `app/**`, the way
// `draftGatingCoverage.test.ts` and `routeMatcher.test.ts` do for their rules,
// rather than pinning the one site that already burned us.
//
// PROOF IT CATCHES THE REAL BUG, not just today's tree: the last test below
// extracts commit 103c935b — the deploy that was live during the outage — and
// asserts the analyser flags `page.tsx:127`. A guard that has never been shown
// to fail on the bug it was written for is decoration.

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { findViolations, isClientModule } from "../clientBoundary";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ROOTS = ["app", "sanity"];

describe("client/server boundary — no server module calls a client value", () => {
  it("the repository is clean", () => {
    const violations = findViolations(REPO_ROOT, ROOTS);
    const report = violations
      .map((v) => `  ${v.file}:${v.line}  ${v.symbol}()  imported from  ${v.from}`)
      .join("\n");

    expect(
      violations,
      violations.length === 0
        ? ""
        : "A module with no \"use client\" directive CALLS a value imported from one that has it.\n" +
          `${report}\n\n` +
          "React hands the importer a client reference, not the function; calling it throws at\n" +
          "render. See docs/adr/0028-shared-predicates-live-outside-client-modules.md. Two fixes\n" +
          "are usually available: move the value into a module that is neutral (no \"use client\",\n" +
          "and no import that pulls one in), or declare \"use client\" on the calling module if it\n" +
          "genuinely belongs to the client bundle.",
    ).toEqual([]);
  });
});

describe("the analyser's own rules", () => {
  it("reads 'use client' as a leading directive, comments and blank lines allowed", () => {
    expect(isClientModule('"use client";\nexport const a = 1;')).toBe(true);
    expect(isClientModule("// a comment first\n\n'use client';\n")).toBe(true);
    expect(isClientModule("export const a = 1;\n")).toBe(false);
  });

  it("does not accept a directive that follows real code — because the bundler does not either", () => {
    expect(isClientModule('export const a = 1;\n"use client";')).toBe(false);
  });
});

describe("proof against the outage", () => {
  // The enforced proof. It reads a fixture rather than the commit because CI
  // clones shallow — `git archive 103c935b` is simply unavailable there, which
  // is how the first version of this test failed in CI while passing locally.
  // A proof that only runs on a full clone does not run where it matters.
  it("flags the call that took / down, from the code as it was deployed", () => {
    const fixture = path.join(import.meta.dirname, "__fixtures__", "client-boundary");
    const violations = findViolations(fixture, ["app"]);

    expect(
      violations.map((v) => `${v.file}:${v.symbol}`),
      "The analyser did not flag the call that caused the 2026-09-02 outage. " +
        "Whatever it is checking, it is not this bug class.",
    ).toEqual(["app/(client)/page.tsx:paintsDayCard"]);
    expect(violations[0].from).toBe("app/components/DayCard.tsx");
  });

  // Stronger when it can run: the ACTUAL deployed tree, where the analyser also
  // finds moveOccupant.ts unaided — the latent second instance a human reviewer
  // found by hand. Skipped rather than failed where the commit is unreachable,
  // because clone depth is not a property of the code under test.
  it("finds both instances in the real 103c935b tree (full clones only)", (ctx) => {
    const reachable = (() => {
      try {
        execFileSync("git", ["cat-file", "-e", "103c935b^{commit}"], { cwd: REPO_ROOT, stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    })();
    if (!reachable) return ctx.skip();

    const dir = mkdtempSync(path.join(tmpdir(), "owt-boundary-"));
    try {
      // `git archive | tar -x` gives the tree as it was deployed, with no
      // checkout and no effect on the working directory.
      const archive = execFileSync("git", ["archive", "103c935b"], { cwd: REPO_ROOT, maxBuffer: 256 * 1024 * 1024 });
      execFileSync("tar", ["-x", "-C", dir], { input: archive, maxBuffer: 256 * 1024 * 1024 });

      const found = findViolations(dir, ROOTS).map((v) => `${v.file}:${v.symbol}`);
      expect(found).toContain("app/(client)/page.tsx:paintsDayCard");
      expect(found).toContain("app/components/admin/moveOccupant.ts:withUpdatedCell");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
