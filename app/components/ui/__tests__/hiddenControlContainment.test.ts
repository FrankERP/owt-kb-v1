import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// A visually hidden NATIVE control (`sr-only` on an <input>/<select>/<textarea>) is
// `position: absolute`. Its containing block is the nearest POSITIONED ancestor, and
// an `overflow-x-auto` box clips an absolute box only when that containing block is
// the box itself or inside it. So a hidden control with no positioned ancestor inside
// its own control escapes any horizontal scroller around it and becomes page width —
// on 2026-10-06 the Checkbox «Omitir» inputs of the planner's off-screen columns, and
// Select's hidden native select (whose `w-full` also beat `sr-only`'s 1px), panned
// every planner page sideways: ADR-0035's «no page-level horizontal scroll» broken
// with all gates green, found by `scripts/dev-verify.ts --layout`.
//
// The primitives own hidden native controls and each one's render test pins its
// positioned root (`Checkbox.test.tsx`, `selectPopover.test.tsx`). A NEW hidden native
// control anywhere else fails here: render it through a primitive, or give it a
// `relative` ancestor inside its own control and add it below with that reason.
const KNOWN: Record<string, string> = {
  "app/components/ui/Checkbox.tsx": "the label is `relative` — Checkbox.test.tsx",
  "app/components/ui/Select.tsx": "the popover root is `relative` and the select is exactly `sr-only` — selectPopover.test.tsx",
  "app/components/ProfilePanel.tsx": "the photo file input lives in the profile CueDialog's vertical-only scroller, never inside a horizontal one",
  "app/components/admin/MembersPanel.tsx": "the photo file input sits in the Miembros panel's own flow, never inside a horizontal scroller — 1px at an on-screen static x",
};

const ROOT = path.resolve(__dirname, "../../../..");
const NATIVE_HIDDEN = /<(input|select|textarea)\b[^>]*\bclassName=(\{`[^`]*|"[^"]*)\bsr-only\b/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (name === "__tests__" || name === "node_modules") continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

describe("hidden native controls stay inside their own box", () => {
  const offenders = walk(path.join(ROOT, "app"))
    .map((file) => path.relative(ROOT, file).split(path.sep).join("/"))
    .filter((rel) => NATIVE_HIDDEN.test(readFileSync(path.join(ROOT, rel), "utf8")));

  it("finds the known sites (the pattern still matches what it is meant to)", () => {
    expect(offenders).toEqual(expect.arrayContaining(Object.keys(KNOWN)));
  });

  it("has no hidden native control outside the known, contained sites", () => {
    expect(offenders.filter((rel) => !(rel in KNOWN))).toEqual([]);
  });
});
