import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// CLAUDE.md and AGENTS.md are per-tool entry points carrying the same project
// brief. They must stay byte-identical except for two deliberate differences:
// the title line, and the body of "## Continuous improvement" (Claude runs the
// /improve slash command; Codex runs the $improve-owt skill). Same pattern as
// the routeMatcher.test.ts sync guard.

const ROOT = resolve(__dirname, "../../..");

function normalized(file: string): string {
  const raw = readFileSync(resolve(ROOT, file), "utf8");
  const body = raw.split("\n").slice(1).join("\n");
  const section = body.match(/## Continuous improvement\n[\s\S]*?(?=\n## )/);
  expect(section, `${file} must keep its "## Continuous improvement" section`).not.toBeNull();
  return body.replace(section![0], "## Continuous improvement\n<tool-specific>\n");
}

describe("CLAUDE.md / AGENTS.md parity", () => {
  it("matches outside the title and the tool-specific improvement section", () => {
    expect(normalized("AGENTS.md")).toBe(normalized("CLAUDE.md"));
  });
});
