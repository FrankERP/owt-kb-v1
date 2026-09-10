// Guard for the lit card (spec §23, decision Q — Task 8). After the route reveal,
// the next service's card on `/` gets ONE beam pass around its border, then rests.
// A CSS-only rotating pseudo-element with a rule-body/keyframe shape that is easy
// to get subtly wrong: an `::after` that never fires, an `animation-iteration-count`
// left implicit (which defaults to 1, but the shorthand's `1` is what makes that
// explicit and auditable), or a keyframe that ends on a non-`none` transform and
// becomes a containing block for a `position: fixed` descendant forever (MOTION.md
// rule 5). This file reads `app/brand.css` and `app/(client)/page.tsx` as text.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), "utf8");

describe("brand.css — .brand-lit-card", () => {
  const css = read("app/brand.css");

  it("declares the data-lit pseudo-element rule", () => {
    expect(css).toMatch(/\.brand-lit-card\[data-lit\]::after\s*\{/);
  });

  it("`@keyframes brand-lit-pass` ends its 100% frame on transform: none", () => {
    const m = css.match(/@keyframes brand-lit-pass\s*\{([\s\S]*?)\n\}/);
    expect(m, "brand-lit-pass keyframes not found").not.toBeNull();
    const body = m![1];
    const to = body.match(/100%\s*\{([^}]*)\}/);
    expect(to, "brand-lit-pass 100% frame not found").not.toBeNull();
    expect(to![1]).toMatch(/transform:\s*none/);
  });

  it("the pass never loops — animation-iteration-count is 1 in the shorthand", () => {
    const rule = css.match(/\.brand-lit-card\[data-lit\]::after\s*\{([\s\S]*?)\n\}/);
    expect(rule, ".brand-lit-card[data-lit]::after rule not found").not.toBeNull();
    const animation = rule![1].match(/animation:\s*([^;]+);/);
    expect(animation, "no animation shorthand on .brand-lit-card[data-lit]::after").not.toBeNull();
    // brand-lit-pass 900ms var(--ease-in-out) 480ms 1 both — the shorthand's iteration
    // count is the bare `1` between the delay and `both`/`forwards`/`infinite`.
    expect(animation![1]).toMatch(/\bbrand-lit-pass\b/);
    expect(animation![1]).toMatch(/(?:^|\s)1(?:\s|$)/);
    expect(animation![1]).not.toMatch(/\binfinite\b/);
  });

  it("the global reduced-motion collapse covers it — a plain animation: shorthand under *, *::before, *::after, no per-effect override needed", () => {
    const m = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/);
    expect(m, "no global reduced-motion block").not.toBeNull();
    expect(m![1]).not.toMatch(/\.brand-lit-card/);
  });
});

describe("app/(client)/page.tsx — data-lit", () => {
  const src = read("app/(client)/page.tsx");

  it("data-lit is set on exactly one element — the hero card", () => {
    const attr = src.match(/\sdata-lit\b/g) ?? [];
    expect(attr.length).toBe(1);
  });

  it("data-lit sits on the brand-lit-card wrapper", () => {
    expect(src).toMatch(/className="brand-lit-card"\s+data-lit\b/);
  });
});
