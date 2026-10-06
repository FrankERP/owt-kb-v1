import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { classNameExpr, stringConstants, tagText } from "@/app/utils/__tests__/jsxSource";

// A visually hidden NATIVE control (`sr-only` on an <input>/<select>/<textarea>) is
// `position: absolute`. Its containing block is the nearest POSITIONED ancestor, and
// an `overflow-x-auto` box clips an absolute box only when that containing block is
// the box itself or inside it. So a hidden control with no positioned ancestor inside
// its own control escapes any horizontal scroller around it — on 2026-10-06 the
// Checkbox «Omitir» inputs of the planner's off-screen columns, and Select's hidden
// native select (whose `w-full` also beat `sr-only`'s 1px), panned every planner page
// sideways: ADR-0035's «no page-level horizontal scroll» broken with all gates green,
// found by `scripts/dev-verify.ts --layout`.
//
// The primitives own hidden native controls and each one's render test pins its
// positioned root (`Checkbox.test.tsx`, `selectPopover.test.tsx`). A NEW hidden native
// control elsewhere fails here: render it through a primitive, or give it a `relative`
// ancestor inside its own control and add it below with that reason.
//
// Read the way `inputFontSize.test.ts` reads controls (`jsxSource.ts`): the whole
// opening tag, brace- and quote-aware; the whole className expression; bare
// identifiers resolved ONE level to a same-file `const` string. A class carried in an
// object map, or built in another module, is not resolved — the same honest limit.
const KNOWN: Record<string, string> = {
  "app/components/ui/Checkbox.tsx": "the label is `relative` — Checkbox.test.tsx",
  "app/components/ui/Select.tsx": "the popover root is `relative` and the select is exactly `sr-only` — selectPopover.test.tsx",
  "app/components/ProfilePanel.tsx": "the photo file input lives in the profile CueDialog's vertical-only scroller, never inside a horizontal one",
  "app/components/admin/MembersPanel.tsx": "the photo file input sits in the Miembros panel's own flow, never inside a horizontal scroller — 1px at an on-screen static x",
};

const ROOT = path.resolve(__dirname, "../../../..");

/** True when a utility list hides the element: a token whose last variant segment is
 *  `sr-only`, with or without Tailwind's important modifier (`!sr-only`, v4's `sr-only!`)
 *  — the obvious next "fix" for a utility that loses the cascade, as this one did. */
function hides(classText: string): boolean {
  return classText
    .split(/[\s"'`{}()$,+]+/)
    .some((t) => t.split(":").pop()!.replace(/^!|!$/g, "") === "sr-only");
}

/** Line numbers of every native control in `src` whose className hides it. */
export function hiddenNativeControls(src: string): number[] {
  const consts = stringConstants(src);
  const lines: number[] = [];
  for (const m of src.matchAll(/<(input|select|textarea)\b/g)) {
    const expr = classNameExpr(tagText(src, m.index!));
    if (expr === null) continue;
    let expanded = expr;
    for (const id of expr.matchAll(/[A-Za-z_$][\w$]*/g)) {
      const resolved = consts.get(id[0]);
      if (resolved) expanded += ` ${resolved}`;
    }
    if (hides(expanded)) lines.push(src.slice(0, m.index!).split("\n").length);
  }
  return lines;
}

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
    .filter((rel) => hiddenNativeControls(readFileSync(path.join(ROOT, rel), "utf8")).length > 0);

  it("finds the known sites (the reader still matches what it is meant to)", () => {
    expect(offenders).toEqual(expect.arrayContaining(Object.keys(KNOWN)));
  });

  it("has no hidden native control outside the known, contained sites", () => {
    expect(offenders.filter((rel) => !(rel in KNOWN))).toEqual([]);
  });

  it("recognises every shape a hidden control can be written in", () => {
    // The reader is the whole guard, so it is exercised directly rather than trusted.
    const one = (jsx: string) => hiddenNativeControls(jsx).length;
    expect(one(`<input className="sr-only" />`)).toBe(1);
    expect(one(`<input\n  type="file"\n  className="peer sr-only"\n/>`)).toBe(1);
    expect(one(`<input onChange={(e) => go(e)} disabled={n > 0} className="sr-only" />`)).toBe(1);
    expect(one(`<select className={"sr-only"} />`)).toBe(1);
    expect(one(`<select className='sr-only' />`)).toBe(1);
    expect(one(`<textarea className = "sr-only" />`)).toBe(1);
    expect(one(`<input className={\`\${base} sr-only\`} />`)).toBe(1);
    expect(one(`<input className={cn("w-full", "sr-only")} />`)).toBe(1);
    expect(one(`const HIDE = "sr-only";\nexport const A = () => <input className={HIDE} />;`)).toBe(1);
    expect(one(`<input className="sm:sr-only" />`)).toBe(1);
    expect(one(`<input className="!sr-only" />`)).toBe(1);
    expect(one(`<input className="md:!sr-only" />`)).toBe(1);
    expect(one(`<input className="sr-only!" />`)).toBe(1);
    // Not hidden: a reveal, a lookalike, a non-control, no className.
    expect(one(`<input className="focus:not-sr-only" />`)).toBe(0);
    expect(one(`<input className="sr-only-ish" />`)).toBe(0);
    expect(one(`<span className="sr-only">x</span>`)).toBe(0);
    expect(one(`<input type="hidden" name="x" />`)).toBe(0);
  });
});
