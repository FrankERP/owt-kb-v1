// Guards the two holes that lost the `DEV_VERIFY_*` credentials on 2026-09-01 and
// then, on 2026-09-02, nearly leaked every other secret into a PUBLIC repo.
//
// 1. `.env*.local` is gitignored, so a real `.env.local` written INSIDE a worktree
//    is untracked, unwarned about, and destroyed by `git worktree remove` — not to
//    the Papelera. The runner's credentials were born in the worktree that built
//    it and died with that worktree; the account survived in Sanity, but bcrypt is
//    one-way, so the only recovery was rotation.
//
// 2. The rotation script's backup, `.env.local.bak-<timestamp>`, did NOT match
//    `.env*.local` — that pattern requires the name to END in `.local`. It sat
//    untracked in the primary checkout holding a full copy of every secret, one
//    `git add -A` away from a public commit.
//
// Both are invisible by construction: git says nothing about an ignored file, and
// says nothing useful about an untracked one either. A test is the only place the
// question gets asked out loud.

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();

/** The primary checkout, from anywhere in the repo. In a worktree, `--git-common-dir` is the primary's `.git`. */
const primaryRoot = () => path.dirname(git("rev-parse", "--path-format=absolute", "--git-common-dir"));

describe("secrets never live in a worktree", () => {
  it("a .env.local at the repo root is a symlink whenever this is a worktree", () => {
    const local = path.join(REPO_ROOT, ".env.local");

    // CI has no .env.local, and the primary checkout is where the real one belongs.
    if (!existsSync(local) || primaryRoot() === REPO_ROOT) return;

    expect(
      lstatSync(local).isSymbolicLink(),
      `${local} is a REAL file inside a worktree. It is gitignored, so nothing will warn you, ` +
        "and `git worktree remove` deletes it outright. Copy anything only it has into the primary " +
        "checkout's .env.local, then replace this with: ln -s ../../../.env.local .env.local",
    ).toBe(true);
  });

  it("gitignore covers backups of env files, not just names ending in .local", () => {
    // `.env*.local` matches neither of these. Both are written beside the real file.
    for (const name of [".env.local.bak-2026-09-02T17-38-08-414Z", ".env.local.bak", ".env.local.orig"]) {
      const ignored = (() => {
        try {
          git("check-ignore", "-q", "--no-index", name);
          return true;
        } catch {
          return false;
        }
      })();
      expect(ignored, `.gitignore does not cover ${name}. This repo is PUBLIC and that file is a full copy of every secret.`).toBe(true);
    }
  });
});
