import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * `.agents/skills/adversarial-plan-review/` is a VENDORED COPY. The canonical
 * skill lives at `~/.agents/skills/adversarial-plan-review/`, symlinked into
 * `~/.claude/skills/`, and is shared with Codex. The two must stay byte-identical.
 *
 * They didn't. By 2026-08-06 they had drifted into two materially different
 * processes under one name — one inlined the reviewer contract, the other kept it
 * in `reviewer-brief.md`, so the two definitions of a reviewer's job diverged
 * silently for weeks. Nothing compared them, so nothing said so.
 *
 * WHAT THIS TEST CAN AND CANNOT DO. The canonical copy is outside the repo and
 * does not exist in CI, so this cannot compare the two directly. What it can do is
 * make an unsynced repo-side edit fail LOUDLY: change a vendored file without
 * updating its digest below and this goes red, which is the prompt to copy the
 * change out to `~/.agents` as well.
 *
 * It catches FORGETTING to sync, not LYING about it — someone can satisfy it by
 * updating the digest alone. That is an accepted limit, not an oversight: no test
 * inside the repo can observe a file outside it. Updating a digest here is a
 * deliberate, reviewable act whose meaning is "I have synced the canonical copy."
 *
 * The file set is read off disk rather than hand-listed, so ADDING a vendored file
 * without a digest fails too. That is the gap that would otherwise let a new file
 * drift from birth.
 */
const SKILL_DIR = join(process.cwd(), ".agents", "skills", "adversarial-plan-review");

/**
 * SHA-256 of each vendored file's exact bytes. Regenerate with:
 *
 *   cd .agents/skills/adversarial-plan-review && \
 *     find . -type f | sed 's|^\./||' | sort | xargs shasum -a 256
 *
 * and only after copying the same change to `~/.agents/skills/adversarial-plan-review/`.
 */
const EXPECTED_DIGESTS: Record<string, string> = {
  "SKILL.md": "d3616f880c7a2e0440309b471ba7e1a965c2b86878d940307267a833c35cdcd7",
  "agents/openai.yaml": "92ca8b13523357a7c2ddb1093c7ab4169450fd869eca2577e1c779e5bb573ac9",
  "reviewer-brief.md": "88fea628e5262e349827bdbff3bb58c16d3603ee428ae8739c67253955572c8a",
};

const SYNC_REMEDIATION =
  "The vendored adversarial-plan-review skill changed.\n" +
  "1. Copy the same change to ~/.agents/skills/adversarial-plan-review/ (symlinked into ~/.claude/skills/).\n" +
  "2. Regenerate EXPECTED_DIGESTS in this file — the command is in the comment above it.\n" +
  "3. Say in the commit message that both copies moved together.\n" +
  "Updating the digest without step 1 re-opens the drift this test exists to catch.";

function vendoredDigests(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(SKILL_DIR, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const dir = String(entry.parentPath ?? (entry as unknown as { path: string }).path);
    const abs = join(dir, entry.name);
    // POSIX-style keys so the expectations read the same on any platform.
    const key = relative(SKILL_DIR, abs).split(sep).join("/");
    out[key] = createHash("sha256").update(readFileSync(abs)).digest("hex");
  }
  return out;
}

describe("vendored adversarial-plan-review skill", () => {
  it("matches the committed digests, so an unsynced edit cannot pass silently", () => {
    expect(vendoredDigests(), SYNC_REMEDIATION).toEqual(EXPECTED_DIGESTS);
  });

  it("still contains the three files the skill is made of", () => {
    // A deletion would otherwise surface only as a confusing digest diff.
    expect(Object.keys(vendoredDigests()).sort()).toEqual([
      "SKILL.md",
      "agents/openai.yaml",
      "reviewer-brief.md",
    ]);
  });

  it("keeps reviewer-brief.md as the ONLY copy of the reviewer contract", () => {
    // The inline second copy in SKILL.md is precisely what drifted. The verdict
    // grammar belongs to the brief; SKILL.md may name the tokens when describing
    // how to read a verdict, but must not restate the reviewer's instructions.
    const skill = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");
    const brief = readFileSync(join(SKILL_DIR, "reviewer-brief.md"), "utf8");

    expect(brief).toContain("VERDICT: APPROVED");
    expect(brief).toContain("VERDICT: CHANGES_REQUIRED");
    expect(skill).toContain("reviewer-brief.md");
    // The contract's opening line — its presence in SKILL.md means the inline
    // copy is back.
    expect(skill).not.toContain("You are an adversarial, skeptical");
  });
});
