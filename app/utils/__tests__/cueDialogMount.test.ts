// A `<CueDialog>` with a LITERAL `open` attribute — `open` or `open={true}`-as-
// bare-boolean, never `open={x}` — exists only while it is open, so it is
// created and destroyed by React rather than opened and closed by the `open`
// prop, and it gets no enter/exit animation from CueDialog's own internal
// `AnimatePresence`. This is the same anti-pattern whether the literal sits
// directly behind a `{cond && (<CueDialog open …>}` conditional or inside a
// wrapper component (e.g. a local `Modal` in `AdminPanel`/`ServicesPanel`, or
// `SongSheet`'s `SetlistPopover`, or `KidsPlanner`'s `SeatPicker`) whose only
// JSX output is a literal `<CueDialog open …>` and which the CALLER mounts
// conditionally — the dialog element itself never observes an `open` prop
// transition either way. One regex catches every shape because it counts the
// literal attribute on the `<CueDialog` element in source, not the shape of
// whatever conditional (if any) sits around it. The house pattern is
// `<CueDialog open={x} …>` (the dialog stays mounted; `open` drives its
// AnimatePresence).
//
// Same shape as rawMotionLiterals.test.ts: pins the count at the audited
// baseline and ratchets DOWN — lower it in the same commit that migrates a
// site to `open={…}`; never raise it to make the guard pass. The count is
// PER SOURCE ELEMENT, not per caller: a wrapper mounted by five different
// callers (e.g. ServicesPanel's local `Modal`) still counts once, because
// there is one `<CueDialog open` in source to migrate.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

// Audited 2026-09-08 (Task 10), re-measured 2026-09-09 (fix round 1, Task 10
// docs-audit finding): the direct-conditional regex only saw 7 of the sites
// that share this anti-pattern; counting every literal `open` on a
// `<CueDialog` element (direct or inside a wrapper) measures 11. LOWER in the
// same commit that migrates a site to `open={…}`; never raise it.
const BASELINE = 11;

// Every literal `open` boolean attribute on a `<CueDialog` element — bare
// `open`, never `open={…}`. Matches regardless of what (if anything)
// conditionally mounts the element, and regardless of attribute order or
// line breaks between the tag and the attribute.
const RE = /<CueDialog\b[^>]*?\sopen(?![=\w])/g;

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

describe("CueDialog is never mounted with a literal open attribute", () => {
  const found = countConditionalCueDialogMounts();

  it("does not grow past the audited baseline", () => {
    expect(found.count, found.sites.join("\n")).toBeLessThanOrEqual(BASELINE);
  });

  it("the baseline is not stale — lower it when a site migrates to open={…}", () => {
    expect(found.count).toBe(BASELINE);
  });

  it("FIRES on a synthetic conditional mount (the fire-proof, direct shape)", () => {
    const synthetic = `
      {open && (
        <CueDialog open title="X" label="X" onDismiss={onClose}>
          <p>hi</p>
        </CueDialog>
      )}
    `;
    expect(synthetic.match(RE)?.length ?? 0).toBe(1);
  });

  it("FIRES on a wrapper component whose only output is a literal open (the fire-proof, wrapper shape)", () => {
    const synthetic = `
      function Modal({ title, children }: { title: string; children: React.ReactNode }) {
        return (
          <CueDialog open title={title} label={title} onDismiss={onClose}>
            {children}
          </CueDialog>
        );
      }
    `;
    expect(synthetic.match(RE)?.length ?? 0).toBe(1);
  });

  it("does NOT fire on the house pattern (negative fire-proof)", () => {
    const houseStyle = `<CueDialog open={open} title="X" label="X" onDismiss={onClose}>`;
    expect(houseStyle.match(RE)).toBeNull();
  });
});
