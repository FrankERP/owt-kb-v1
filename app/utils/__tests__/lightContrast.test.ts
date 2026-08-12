// WCAG contrast guard for the light theme (Child D).
//
// The dark theme never needed this: near-black surfaces make almost any foreground
// pass. Light mode is the opposite — 28 of the 64 roles failed 4.5:1 on a light
// surface at their dark values, including `positive-fg` at 1.01:1 and `warning-strong`
// at 1.15:1. Those are not "a bit low", they are invisible.
//
// So every light value here was hand-picked and then CHECKED, and this file is the
// check. It reads the real `.light` block rather than a copy, so a value edited in
// `brand.css` is measured, not a stale duplicate of it.
//
// WHAT THIS DOES NOT CLAIM. Passing here means a role's colour has enough contrast
// against the surface it is *expected* to sit on. It cannot know that a particular
// element actually uses that pairing — a `text-warning-fg` on a `bg-negative-surface`
// would pass this file and still be unreadable. That is what the theme gallery and a
// human eye are for. This guard catches the systematic failure, not the local one.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const CSS = readFileSync(path.join(REPO_ROOT, "app/brand.css"), "utf8");

/** The `.light` block's triplets, read from source so this cannot drift from it. */
function lightRoles(): Map<string, [number, number, number]> {
  const start = CSS.indexOf(".light {");
  const block = CSS.slice(start, CSS.indexOf("\n}", start));
  const out = new Map<string, [number, number, number]>();
  for (const m of block.matchAll(/--([a-z0-9-]+)-rgb:\s*(\d{1,3}) (\d{1,3}) (\d{1,3});/gi)) {
    out.set(m[1], [+m[2], +m[3], +m[4]]);
  }
  return out;
}

const relLum = ([r, g, b]: number[]) => {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

const contrast = (a: number[], b: number[]) => {
  const [l1, l2] = [relLum(a), relLum(b)];
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

const LIGHT = lightRoles();
const page = () => LIGHT.get("surface-base")!;

/**
 * Roles used as a FOREGROUND somewhere in `app/**` — `text-`, `fill-`, `stroke-`,
 * `placeholder-`. Derived once and listed explicitly rather than re-grepped at test
 * time: a grep would silently shrink if a usage disappeared, taking the assertion with
 * it, which is the "count marches to zero by succeeding" trap this repo has hit twice.
 */
const FOREGROUND_ON_PAGE = [
  "accent", "ink", "ink-muted", "ink-dim",
  "warning-fg", "info-fg", "positive-fg", "negative-fg",
  "mono-200", "mono-300", "mono-400", "mono-500", "mono-600", "mono-700",
  "negative-faint", "negative-soft", "negative-muted",
  "warning-faint", "warning-soft", "warning-strong",
  "recency-faint", "recency-soft", "recency-strong",
  "positive-soft", "positive-strong",
  "availability-faint", "availability-soft", "availability-strong",
  "badge-violet-fg", "badge-azure-fg",
  "chart-lead", "chart-bgv", "chart-coro", "chart-especial", "chart-instr", "chart-foh",
] as const;

/** Two roles are only ever text ON a filled accent chip, never on the page. */
const FOREGROUND_ON_ACCENT = ["surface-base", "surface-sunken"] as const;

describe("light theme — WCAG AA contrast", () => {
  it("declares a light value for every role this file measures", () => {
    const missing = [...FOREGROUND_ON_PAGE, ...FOREGROUND_ON_ACCENT].filter((r) => !LIGHT.has(r));
    expect(missing, "a measured role vanished from .light").toEqual([]);
  });

  it.each(FOREGROUND_ON_PAGE)("`%s` clears 4.5:1 against the page in light", (role) => {
    const ratio = contrast(LIGHT.get(role)!, page());
    expect(ratio, `${role} is ${ratio.toFixed(2)}:1 on the light page`).toBeGreaterThanOrEqual(4.5);
  });

  it.each(FOREGROUND_ON_ACCENT)("`%s` clears 4.5:1 as text on a filled accent chip", (role) => {
    // `ChordChart.tsx:183` and `SongSheet.tsx:223` — `bg-accent text-surface-*`. Measuring
    // these against the page would fail them for the wrong reason: they never touch it.
    const ratio = contrast(LIGHT.get(role)!, LIGHT.get("accent")!);
    expect(ratio, `${role} is ${ratio.toFixed(2)}:1 on bg-accent`).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the surface hierarchy the right way round", () => {
    // In dark the page is the DARKEST surface; in light it must be the LIGHTEST, or
    // panels disappear into it. This is the invariant the one deviation from the
    // recorded evidence exists to preserve.
    const L = (r: string) => relLum(LIGHT.get(r)!);
    expect(L("surface-base")).toBeGreaterThan(L("surface-raised-alt"));
    expect(L("surface-raised-alt")).toBeGreaterThan(L("surface-sunken"));
    expect(L("accent-deep")).toBeLessThan(L("accent")); // "deep" must mean deeper
  });

  it("the mono scale is a SCALE — monotonic, with no two steps the same", () => {
    // Both failures happened in a first draft and neither is visible by eye in a table:
    // `mono-300` and `mono-500` were assigned the same value, and `mono-500` sat lighter
    // than `mono-400`, so the ramp doubled back on itself. A scale that is not ordered
    // is not a scale, and six of its seven steps are used as body text.
    //
    // The order INVERTS between themes and that is correct: in dark a higher number is
    // darker, in light a higher number is lighter. What must hold is that the ordering
    // is strict in each.
    const shades = [200, 300, 400, 500, 600, 700, 800] as const;
    const lums = shades.map((s) => relLum(LIGHT.get(`mono-${s}`)!));

    const seen = new Set(shades.map((s) => LIGHT.get(`mono-${s}`)!.join(",")));
    expect(seen.size, "two mono steps share a value").toBe(shades.length);

    for (let i = 1; i < lums.length; i++) {
      expect(lums[i], `mono-${shades[i]} is not lighter than mono-${shades[i - 1]}`)
        .toBeGreaterThan(lums[i - 1]);
    }
  });

  it("FIRE-PROOF: catches a role that does not clear the bar", () => {
    // Without this the suite above is a set of assertions nobody has seen fail.
    // `#00bfff` on the light page is 1.36:1 — the exact value Child A5 measured as
    // failing, and the reason light mode could not simply reuse the dark accent.
    const ratio = contrast([0, 191, 255], page());
    expect(ratio).toBeLessThan(4.5);
  });
});
