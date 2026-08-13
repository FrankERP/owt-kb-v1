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
import { readFileSync, readdirSync, statSync } from "node:fs";
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

/** The `:root` triplets, for checking that a pairing survives in BOTH themes. */
function darkRoles(): Map<string, [number, number, number]> {
  const start = CSS.indexOf(":root {");
  const block = CSS.slice(start, CSS.indexOf("\n}", start));
  const out = new Map<string, [number, number, number]>();
  for (const m of block.matchAll(/--([a-z0-9-]+)-rgb:\s*(\d{1,3}) (\d{1,3}) (\d{1,3});/gi)) {
    out.set(m[1], [+m[2], +m[3], +m[4]]);
  }
  return out;
}

const LIGHT = lightRoles();

// `darkRoles()` already existed above — it was written for pairing checks and then
// never used by the mono guard, which is precisely how the dark scale drifted.
const DARK = darkRoles();
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

/**
 * Foregrounds that never touch the page — they sit on a FILLED chip or badge, so the
 * page is the wrong reference and would fail them for the wrong reason.
 *
 * This started as "two roles, always on `accent`", and that shape is what let a real
 * defect ship green. Child D pointed `text-surface-base` at four different fills, and
 * only one of them was `accent`: the pending-count badge sits on `recency-fg`, a MID
 * gold in light, where near-white measures 2.63:1 — worse than the `text-black` it
 * replaced (7.15:1). Measuring against `accent` alone said nothing about it.
 *
 * So the ground is named per site. Adding a `text-<role>` on a new fill means adding a
 * row here; that is the cost of the guard being able to see it at all.
 */
const FOREGROUND_ON_FILL: ReadonlyArray<readonly [string, string, string]> = [
  ["surface-base", "accent", "SongSheet.tsx:223 — current-song chip"],
  ["surface-sunken", "accent", "ChordChart.tsx:183 — selected key"],
  ["surface-base", "warning-fg", "CalendarView.tsx:388, ImpersonationBanner.tsx:22"],
  ["surface-base", "info-fg", "CalendarView.tsx:390 — special service"],
  ["scrim", "recency-fg", "ProposalsPanel.tsx:538 — pending count"],
];

describe("light theme — WCAG AA contrast", () => {
  it("declares a light value for every role this file measures", () => {
    const measured = [...FOREGROUND_ON_PAGE, ...FOREGROUND_ON_FILL.flatMap(([r, g]) => [r, g])];
    const missing = measured.filter((r) => !LIGHT.has(r));
    expect(missing, "a measured role vanished from .light").toEqual([]);
  });

  it.each(FOREGROUND_ON_PAGE)("`%s` clears 4.5:1 against the page in light", (role) => {
    const ratio = contrast(LIGHT.get(role)!, page());
    expect(ratio, `${role} is ${ratio.toFixed(2)}:1 on the light page`).toBeGreaterThanOrEqual(4.5);
  });

  it.each(FOREGROUND_ON_FILL)("`%s` clears 4.5:1 on `%s` (%s)", (role, ground) => {
    const ratio = contrast(LIGHT.get(role)!, LIGHT.get(ground)!);
    expect(ratio, `${role} on ${ground} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });

  it("checks the DARK side of those pairings too — a fill inverts, the text on it may not", () => {
    // `text-scrim` on `bg-recency-fg` is the case that motivated this: black on gold is
    // strong in BOTH themes, which is what makes it the right anchor. A role that only
    // worked in light would be half a fix.
    const dark = darkRoles();
    for (const [role, ground] of FOREGROUND_ON_FILL) {
      const ratio = contrast(dark.get(role)!, dark.get(ground)!);
      expect(ratio, `${role} on ${ground} is ${ratio.toFixed(2)}:1 in DARK`).toBeGreaterThanOrEqual(4.5);
    }
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
    // AND IT NOW CHECKS BOTH, which this comment always claimed. Until 2026-08-12
    // it read only `LIGHT` — so the dark scale was never ordered by anything, and
    // dark `mono-500`/`mono-600` sat at 4.09:1 and 2.62:1 against a 4.5 floor
    // across 233 and 64 body-text uses. A guard whose comment promises more than
    // it checks is worse than no guard: it is a green tick over an unchecked thing.
    const shades = [200, 300, 400, 500, 600, 700, 800] as const;

    for (const [theme, roles, lighterWithNumber] of [
      ["light", LIGHT, true],
      ["dark", DARK, false],
    ] as const) {
      const vals = shades.map((s) => roles.get(`mono-${s}`)!);
      expect(
        new Set(vals.map((v) => v.join(","))).size,
        `two mono steps share a value in ${theme}`,
      ).toBe(shades.length);

      const lums = vals.map(relLum);
      for (let i = 1; i < lums.length; i++) {
        const [a, b] = [lums[i - 1], lums[i]];
        expect(
          lighterWithNumber ? b > a : b < a,
          `${theme}: mono-${shades[i]} is not ${lighterWithNumber ? "lighter" : "darker"} than mono-${shades[i - 1]}`,
        ).toBe(true);
      }
    }
  });

  it("the mono steps used as BODY TEXT clear AA in dark too", () => {
    // 200-600 are text roles; 700 and 800 are surface/border roles on dark and are
    // deliberately below the floor. This is the assertion that would have caught
    // the 2.62:1 the theme gallery eventually surfaced.
    const base = DARK.get("surface-base")!;
    for (const s of [200, 300, 400, 500, 600] as const) {
      const r = contrast(DARK.get(`mono-${s}`)!, base);
      expect(
        r,
        `dark mono-${s} is ${r.toFixed(2)}:1 on surface-base; body text needs 4.5`,
      ).toBeGreaterThanOrEqual(4.5);
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

// ---------------------------------------------------------------------------
// The two control affordances, pinned in BOTH themes.
//
// These existed as `ink-dim/70` (placeholder) and `ink-dim/25` (input border)
// and were measured failing in both themes on the sign-in page — the one screen
// every member sees before they can see anything else:
//
//   placeholder   3.55:1 dark   3.09:1 light   against 4.5 (WCAG 1.4.3)
//   input border  1.46:1 dark   1.42:1 light   against 3.0 (WCAG 1.4.11)
//
// They are composed tokens now, so the ratio is a property of the token rather
// than of each call site, and pinning it here means a future alpha tweak has to
// argue with a number instead of slipping through.
//
// The border matters as much as the text: those fields carry no affordance other
// than the border, so a member cannot tell where the control is without it.
// ---------------------------------------------------------------------------

/** Both blocks' triplets — the light guard above reads only `.light`. */
function rolesIn(selector: string): Map<string, [number, number, number]> {
  const start = CSS.indexOf(selector);
  const block = CSS.slice(start, CSS.indexOf("\n}", start));
  const out = new Map<string, [number, number, number]>();
  for (const m of block.matchAll(/--([a-z0-9-]+)-rgb:\s*(\d+)\s+(\d+)\s+(\d+)\s*;/g)) {
    out.set(m[1], [Number(m[2]), Number(m[3]), Number(m[4])]);
  }
  return out;
}

/**
 * The role and alpha a composed token bakes, read from WITHIN a given block.
 *
 * Reading them from the whole file returns the `:root` declaration every time,
 * because `String.match` without `g` stops at the first hit. The light half of
 * this guard was then measuring the dark declaration's alpha — so a `.light`
 * block that softened `--placeholder` to something unreadable would have stayed
 * green, which is precisely the thing the block below claims to prevent.
 */
function bakedIn(selector: string, token: string): { role: string; alpha: number } {
  const start = CSS.indexOf(selector);
  const block = CSS.slice(start, CSS.indexOf("\n}", start));
  const m = block.match(new RegExp(`--${token}:\\s*rgb\\(var\\(--([a-z0-9-]+)-rgb\\)\\s*/\\s*([0-9.]+)\\)`));
  if (!m) throw new Error(`--${token} is not declared as a composed rgb()/alpha token in ${selector}`);
  return { role: m[1], alpha: Number(m[2]) };
}

describe("control affordances clear WCAG in BOTH themes", () => {
  it.each([
    ["placeholder", 4.5, "WCAG 1.4.3 — placeholder text"],
    ["edge-control", 3.0, "WCAG 1.4.11 — the only affordance these inputs have"],
  ])("%s", (token, required, why) => {
    for (const [theme, selector] of [["dark", ":root {"], ["light", ".light {"]] as const) {
      const { role, alpha } = bakedIn(selector, token);
      const roles = rolesIn(selector);
      const fg = roles.get(role);
      // Not just `surface-base`. The ratio is a property of the token AND its
      // ground, and the light `surface-sunken` is the tightest realistic one —
      // an input placed there is the case a base-only guard would miss.
      const ground = roles.get("surface-base");
      expect(fg, `--${role}-rgb must exist in ${selector}`).toBeDefined();
      expect(ground).toBeDefined();

      // Composite the token over the page wash before measuring — reading a
      // translucent value as opaque is the mistake that made this whole class of
      // failure invisible for so long.
      const composited = fg!.map((c, i) => c * alpha + ground![i] * (1 - alpha)) as
        [number, number, number];
      const r = contrast(composited, ground!);

      expect(
        r,
        `--${token} is ${r.toFixed(2)}:1 in ${theme} against --surface-base; ` +
          `needs ${required} (${why}). It was raised here after a measured failure — ` +
          `if you are lowering the alpha, you are undoing that.`,
      ).toBeGreaterThanOrEqual(required);
    }
  });
});

// ---------------------------------------------------------------------------
// Alpha-modified TEXT roles, measured in both themes.
//
// `text-negative-fg/70` measured 3.91:1 dark and 3.98:1 light against a 4.5
// floor — while `negative-fg` at full alpha is 7.15 and 7.00. The role was never
// the problem; the modifier was, on the smallest text in the component.
//
// CLAUDE.md already bans an opacity modifier on a COMPOSED token, because it
// double-applies a baked alpha. This is the neighbouring hazard on a BASE role,
// where the modifier is legal, does exactly what it says, and quietly walks the
// text under the threshold. Nothing was checking it.
// ---------------------------------------------------------------------------
describe("alpha-modified text roles still clear AA, in both themes", () => {
  /** Every `text-<role>/<alpha>` written anywhere in app/, from source. */
  function alphaTextRoles(): Array<{ role: string; alpha: number; file: string }> {
    const out: Array<{ role: string; alpha: number; file: string }> = [];
    const walk = (dir: string): string[] => {
      const acc: string[] = [];
      for (const e of readdirSync(path.join(REPO_ROOT, dir))) {
        const rel = path.join(dir, e);
        if (rel.includes("__tests__")) continue;
        if (statSync(path.join(REPO_ROOT, rel)).isDirectory()) acc.push(...walk(rel));
        else if (/\.tsx?$/.test(e)) acc.push(rel);
      }
      return acc;
    };
    for (const file of walk("app")) {
      const src = readFileSync(path.join(REPO_ROOT, file), "utf8");
      for (const m of src.matchAll(/\btext-([a-z][a-z0-9-]*-fg)\/(\d{1,3})\b/g)) {
        out.push({ role: m[1], alpha: Number(m[2]) / 100, file });
      }
    }
    return out;
  }

  const found = alphaTextRoles();

  it("finds the pattern at all — otherwise this guard is vacuous", () => {
    expect(found.length).toBeGreaterThan(0);
  });

  it.each([...new Map(found.map((f) => [`${f.role}/${f.alpha}`, f])).values()])(
    "text-$role at alpha $alpha",
    ({ role, alpha, file }) => {
      for (const [theme, roles] of [["dark", DARK], ["light", LIGHT]] as const) {
        const fg = roles.get(role);
        const bg = roles.get("surface-base")!;
        expect(fg, `--${role}-rgb must exist in ${theme}`).toBeDefined();
        const composited = fg!.map((c, i) => c * alpha + bg[i] * (1 - alpha)) as
          [number, number, number];
        const r = contrast(composited, bg);
        expect(
          r,
          `text-${role}/${Math.round(alpha * 100)} is ${r.toFixed(2)}:1 in ${theme} ` +
            `(${file}). The ROLE passes at full alpha — the modifier is what breaks it. ` +
            `Raise the alpha or drop it.`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );
});
