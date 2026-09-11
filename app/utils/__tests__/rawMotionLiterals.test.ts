// Spec §2.2 "durations from tokens, never literals". Outside app/components/ui/**
// a raw `duration-N` or `transition-all` is the pre-M0 spelling. This pins the
// count at the audited baseline so a new site fails while the backlog is paid down
// phase by phase (each phase LOWERS the numbers here in the same commit).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

// Audited 2026-09-08 after M0a Task 8; rawDuration 12→10 on 2026-09-09 (M0b-2
// Task 3: the Popular/A–Z pills became SegmentedControl). LOWER freely; never raise.
// 2026-09-09 M1 Task 1: BottomNav's sheet became a CueDialog (−1 transition-all, −1 duration-300).
// 2026-09-09 M1 Task 4: NavMenu's two avatar rings drop transition-all for a tokenised
// box-shadow/transform transition (−2 transition-all).
// 2026-09-09 M1 Task 6: AudioTransport's play/pause button drops transition-all for a
// tokenised background-color/transform transition (−1 transition-all); its progress
// fill drops transition-[width] duration-100 for a tokenised transform: scaleX transition
// (−1 duration-N).
// 2026-09-10 R1 Task 5: SongSearchList.tsx, PostComponent.tsx, TagSearchList.tsx and
// AuthorSearchList.tsx deleted (the library left home for /biblioteca) — their two
// transition-all sites and all eight raw duration-N sites went with them.
const BASELINE = { transitionAll: 7, rawDuration: 0 };

function tsxFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (rel.includes("__tests__") || rel.startsWith(path.join("app", "components", "ui") + path.sep)) continue;
      if (e.isDirectory()) walk(rel);
      else if (rel.endsWith(".tsx")) out.push(rel);
    }
  };
  walk("app");
  return out;
}

export function countRawMotion(files = tsxFiles()) {
  let transitionAll = 0;
  let rawDuration = 0;
  const sites: string[] = [];
  for (const rel of files) {
    const src = readFileSync(path.join(REPO_ROOT, rel), "utf8");
    const a = src.match(/\btransition-all\b/g)?.length ?? 0;
    const d = src.match(/\bduration-\d+\b/g)?.length ?? 0;
    transitionAll += a;
    rawDuration += d;
    if (a || d) sites.push(`${rel} (transition-all×${a}, duration-N×${d})`);
  }
  return { transitionAll, rawDuration, sites };
}

describe("raw motion literals outside app/components/ui", () => {
  const found = countRawMotion();

  it("transition-all does not grow past the audited baseline", () => {
    expect(found.transitionAll, found.sites.join("\n")).toBeLessThanOrEqual(BASELINE.transitionAll);
  });

  it("raw duration-N does not grow past the audited baseline", () => {
    expect(found.rawDuration, found.sites.join("\n")).toBeLessThanOrEqual(BASELINE.rawDuration);
  });

  it("the baseline is not stale — lower it when a phase pays down sites", () => {
    // Equality, so a phase that removes sites must also lower BASELINE in the same
    // commit; otherwise the guard silently gains headroom.
    expect(found.transitionAll).toBe(BASELINE.transitionAll);
    expect(found.rawDuration).toBe(BASELINE.rawDuration);
  });
});
