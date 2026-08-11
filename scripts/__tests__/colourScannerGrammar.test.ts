// Grammar guard for `scripts/colour-inventory.mjs`.
//
// WHY THIS FILE EXISTS, and why `colourInventory.test.ts` could not do its job.
//
// That file compares the committed artifact against a LIVE SCAN. Both sides run the
// same scanner, so it agrees with the scanner about anything the scanner cannot see.
// A category whose regex silently fails to match produces no row on either side and
// the guard stays green. Four such defects shipped and survived months that way:
//
//   1. category 6 anchored with `\b(?:rgba?)\(` — but Tailwind writes spaces as
//      UNDERSCORES inside an arbitrary value, and `_` is a word character, so
//      `shadow-[0_0_0_1px_rgb(…)]` never matched. Two real rows were invisible.
//   2. category 12's property class was `[a-z-]+`, so `--mono-500-rgb` emitted NO ROW.
//   3. category 1's opacity alternation accepted `/50` but not `/[0.04]`, so 15
//      bracket-alpha usages recorded no alpha — which reads as fully OPAQUE.
//   4. category 4 had no opacity alternation at all, so `bg-white/5` and `bg-white`
//      were the same row. 24 live rows understated themselves.
//
// Every one is the same species: a regex that could not match what it claimed to.
// None was catchable by comparing the artifact to the scanner. So this file asserts
// the GRAMMAR directly — feed the scanner syntax it must understand and check what
// comes back — and it is the only guard here that can fail while the artifact is
// perfectly self-consistent.
//
// ADDING A CATEGORY OR TOUCHING A REGEX? Add its cases here first.

import { describe, it, expect } from "vitest";
import { scanText } from "../colour-inventory.mjs";

type Row = { category: number; value: string; alpha: string | null };
const first = (src: string): Row | undefined => scanText(src)[0] as Row | undefined;

describe("colour scanner grammar — opacity modifiers, in every spelling Tailwind accepts", () => {
  // Tailwind writes the modifier four ways. Three categories can carry one, and each
  // used to spell the alternation itself; they drifted, and all three were wrong in
  // different ways. `ALPHA_MOD` is now defined once — these cases are what keeps it so.
  it.each([
    ["bg-[#fff]/50", 1, "50", "bracketed hex, numeric"],
    ["bg-[#fff]/[0.04]", 1, "4", "bracketed hex, fraction"],
    ["bg-[#fff]/[.04]", 1, "4", "bracketed hex, leading-dot fraction"],
    ["bg-[#fff]/[4%]", 1, "4", "bracketed hex, percentage"],
    ["bg-gray-500/50", 3, "50", "palette class, numeric"],
    ["bg-gray-500/[0.04]", 3, "4", "palette class, fraction"],
    ["bg-gray-500/[4%]", 3, "4", "palette class, percentage"],
    ["bg-white/50", 4, "50", "keyword, numeric"],
    ["bg-black/[0.06]", 4, "6", "keyword, fraction"],
  ])("%s -> category %i, alpha %s (%s)", (cls, category, alpha) => {
    const row = first(`const a = "${cls}";`);
    expect(row?.category).toBe(category);
    expect(row?.alpha).toBe(alpha);
  });

  it("records a null alpha rather than dropping the row when there is no modifier", () => {
    expect(first(`const a = "bg-white";`)).toMatchObject({ category: 4, alpha: null });
    expect(first(`const a = "bg-[#fff]";`)).toMatchObject({ category: 1, alpha: null });
  });

  it("FIRE-PROOF: a fraction and its percentage are the same alpha", () => {
    // `/[0.04]` and `/[4%]` and `/4` must all normalise to "4", or a pair whose two
    // sides spell it differently reads as alpha-differing when it is not.
    const of = (cls: string) => first(`const a = "${cls}";`)?.alpha;
    expect(new Set([of("bg-[#fff]/[0.04]"), of("bg-[#fff]/[4%]"), of("bg-[#fff]/4")]).size).toBe(1);
  });
});

describe("colour scanner grammar — the underscore trap", () => {
  // Tailwind encodes spaces as `_` inside an arbitrary value. `_` is a word character,
  // so ANY `\b` before a colour function or `var(` asserts a boundary that is not
  // there and the match fails silently. Categories 5, 6 and 11 each had this.
  it.each([
    [`const a = "shadow-[0_2px_rgb(1_2_3)]";`, 6, "rgb() after an underscore, bracketed"],
    [`const a = "shadow-[0_0_0_1px_var(--brand-beam)]";`, 11, "var() after an underscore"],
    [`const a = "shadow-[inset_0_0_rgb(var(--brand-beam)/0.15)]";`, 11, "var() inside rgb()"],
  ])("%s -> category %i (%s)", (src, category) => {
    expect(first(src)?.category).toBe(category);
  });

  it("still sees a plain colour function with no underscore in sight", () => {
    expect(first(`const s = { c: "rgb(1 2 3)" };`)?.category).toBe(5);
  });

  it("does NOT flag the token form, which is the correct output", () => {
    // `rgb(var(--x-rgb) / 0.2)` is what themeColour() produces. A scanner that calls
    // it a literal would report the fix as the defect.
    expect(scanText(`const s = { c: "rgb(var(--accent-rgb) / 0.2)" };`)).toHaveLength(0);
  });
});

describe("colour scanner grammar — SVG presentation attributes", () => {
  // React spells these camelCase. With only the kebab forms a `stopColor="#fff"` fell
  // through to category 2 (bare hex) — not merely miscounted, MISROUTED: an attribute
  // needs `currentColor`, because `var()` is not substituted there, while a category-2
  // row is told to become a token.
  it.each([
    ["stopColor", "React camelCase"],
    ["stop-color", "kebab, as CSS spells it"],
    ["floodColor", "React camelCase"],
    ["fill", "the common case"],
  ])("%s= is category 8 (%s)", (attr) => {
    expect(first(`const a = <svg><x ${attr}="#fff" /></svg>;`)?.category).toBe(8);
  });

  it("keeps case-insensitivity, or the uppercase brand-mark hexes escape", () => {
    // `#4285F4` — the Google mark. Dropping the `i` flag moves all four to category 2.
    expect(first(`const a = <svg><path fill="#4285F4" /></svg>;`)?.category).toBe(8);
  });

  it("ignores a non-colour attribute value", () => {
    expect(scanText(`const a = <svg><path fill="none" /></svg>;`)).toHaveLength(0);
  });
});

describe("colour scanner grammar — custom properties", () => {
  it("accepts DIGITS in a property name", () => {
    // `[a-z-]+` emitted no row for `--mono-500-rgb`, and a row that does not exist
    // cannot be dispositioned — seven roles covering 475 rows were invisible.
    // Category 12 is `cssOnly`, so the pretend filename has to end in `.css` — the
    // extension is the only thing `scanText`'s second argument is used for.
    const rows = scanText(`:root { --mono-500-rgb: 107 114 128; }`, "probe.css") as Row[];
    expect(rows[0]?.category).toBe(12);
  });

  it("takes only a bare triplet, so a composed token is not mistaken for a role", () => {
    // Layer-2 tokens hold `rgb(var(…))`, not `R G B`, and must not land in category 12.
    expect(scanText(`:root { --surface-accent-solid: rgb(var(--accent-rgb) / 0.2); }`, "x.css")
      .filter((r: Row) => r.category === 12)).toHaveLength(0);
  });
});
