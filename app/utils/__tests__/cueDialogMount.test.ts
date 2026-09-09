// A `<CueDialog>` conditionally mounted (`{open && (<CueDialog open …>`) is
// created and destroyed by React, not opened and closed by the `open` prop —
// so it gets no enter/exit animation from CueDialog's own internal
// `AnimatePresence`. It only "animates" if the CONSUMER's own conditional
// happens to stay mounted across a route phase, which is not this component's
// contract. The house pattern is `<CueDialog open={x} …>` (the dialog stays
// mounted; `open` drives its AnimatePresence).
//
// Same shape as rawMotionLiterals.test.ts: pins the count at the audited
// baseline and ratchets DOWN — a phase that migrates a consumer onto
// `open={x}` lowers this number in the same commit; never raise it to make
// the guard pass.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

// Audited 2026-09-08 (Task 10). LOWER in the same commit that migrates a
// consumer to `open={…}`; never raise it.
const BASELINE = 7;

// A literal `open` boolean attribute right after a conditional — not `open={…}`.
const RE = /&&\s*\(?\s*<CueDialog\b[^>]*\bopen\b(?!=\{)/g;

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

export function countConditionalCueDialogMounts(files = tsxFiles()) {
  let count = 0;
  const sites: string[] = [];
  for (const rel of files) {
    const src = readFileSync(path.join(REPO_ROOT, rel), "utf8");
    const n = src.match(RE)?.length ?? 0;
    count += n;
    if (n) sites.push(`${rel} ×${n}`);
  }
  return { count, sites };
}

describe("CueDialog is never mounted conditionally", () => {
  const found = countConditionalCueDialogMounts();

  it("does not grow past the audited baseline", () => {
    expect(found.count, found.sites.join("\n")).toBeLessThanOrEqual(BASELINE);
  });

  it("the baseline is not stale — lower it when a consumer migrates to open={…}", () => {
    expect(found.count).toBe(BASELINE);
  });

  it("FIRES on a synthetic conditional mount (the fire-proof)", () => {
    const synthetic = `
      {open && (
        <CueDialog open title="X" label="X" onDismiss={onClose}>
          <p>hi</p>
        </CueDialog>
      )}
    `;
    expect(synthetic.match(RE)?.length ?? 0).toBe(1);
    // The house pattern — CueDialog stays mounted, `open` drives it — never fires.
    const houseStyle = `<CueDialog open={open} title="X" label="X" onDismiss={onClose}>`;
    expect(houseStyle.match(RE)).toBeNull();
  });
});
