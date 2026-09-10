// Guard for the lit card (spec §23, decision Q — Task 8). After the route reveal,
// the next service's card on `/` gets ONE beam pass around its border, then rests.
// A CSS-only rotating pseudo-element with a rule-body/keyframe shape that is easy
// to get subtly wrong: a pseudo-element that never fires, an
// `animation-iteration-count` left implicit (which defaults to 1, but the
// shorthand's `1` is what makes that explicit and auditable), or a keyframe that
// ends on a non-`none` transform and becomes a containing block for a
// `position: fixed` descendant forever (MOTION.md rule 5). This file reads
// `app/brand.css` and `app/(client)/page.tsx` as text.
//
// WHAT THIS GUARD CANNOT SEE: geometry. Nothing here knows whether the light
// actually rides the 1 px gap rather than slashing across the card's face or
// spilling onto the page — that is a question about a rendered box at a paused
// frame, and reading CSS as text cannot answer it. The first shipped version
// passed a guard of this shape while painting a diagonal line over the whole
// card, because it masked the layer that rotates and the mask rotated with it.
// The evidence for the geometry is the browser check recorded in
// `.superpowers/sdd/2026-09-10-motion-r1-library/task-8-fix1-report.md`:
// Chromium, the pass paused at 225/450/675/810 ms, four screenshots, and a
// per-pixel delta against the same tree with the animation suppressed. Re-run it
// when this rule changes; a green suite is not a substitute.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), "utf8");

describe("brand.css — .brand-lit-card", () => {
  const css = read("app/brand.css");
  const rule = css.match(/\.brand-lit-card\[data-lit\]::before\s*\{([\s\S]*?)\n\}/);

  it("declares the data-lit pseudo-element rule", () => {
    expect(rule, ".brand-lit-card[data-lit]::before rule not found").not.toBeNull();
  });

  it("the wrapper clips and opens the 1 px gap the light shows through", () => {
    // The whole effect: the wrapper CLIPS, an unmasked conic layer spins beneath,
    // and the card sits on top — so the only light that escapes is what `padding`
    // leaves showing. Drop either half and the beam is a line across the card.
    const wrapper = css.match(/\.brand-lit-card\[data-lit\]\s*\{([^}]*)\}/);
    expect(wrapper, ".brand-lit-card[data-lit] wrapper rule not found").not.toBeNull();
    expect(wrapper![1]).toMatch(/overflow:\s*hidden/);
    expect(wrapper![1]).toMatch(/padding:\s*1px/);
    expect(css).toMatch(/\.brand-lit-card\[data-lit\]\s*>\s*\*\s*\{[^}]*z-index:\s*1/);
    expect(rule![1]).toMatch(/z-index:\s*0/);
  });

  it("the spinning layer carries NO mask — a mask rotates with it", () => {
    // The shipped bug, kept as a regression: `mask`/`-webkit-mask` live in the
    // element's own box, so a border mask on the layer that rotates turns the
    // ring into a line slashing across the card.
    expect(rule![1]).not.toMatch(/mask/);
  });

  it("`@keyframes brand-lit-pass` ends its 100% frame on transform: none", () => {
    const m = css.match(/@keyframes brand-lit-pass\s*\{([\s\S]*?)\n\}/);
    expect(m, "brand-lit-pass keyframes not found").not.toBeNull();
    const to = m![1].match(/100%\s*\{([^}]*)\}/);
    expect(to, "brand-lit-pass 100% frame not found").not.toBeNull();
    expect(to![1]).toMatch(/transform:\s*none/);
  });

  it("the pass runs the whole documented shorthand — 900ms, eased, delayed, once", () => {
    // Pinned whole rather than piecemeal: the duration is what makes it read as a
    // pass rather than a flash, the 480ms delay is what puts it AFTER the route
    // reveal (--motion-reveal), the `1` is what makes "never loops" auditable, and
    // `both` is what holds opacity 0 through the delay so nothing shows early.
    const animation = rule![1].match(/animation:\s*([^;]+);/);
    expect(animation, "no animation shorthand on .brand-lit-card[data-lit]::before").not.toBeNull();
    expect(animation![1].trim()).toBe("brand-lit-pass 900ms var(--ease-in-out) 480ms 1 both");
  });

  it("the wrapper's literal border-radius is --brand-radius-panel's value", () => {
    // `border-radius: inherit` on nothing and a token reference are both out:
    // tokenLayer.test.ts pins brand.css's own rule bodies as --brand-radius-free.
    // So the literal has to be kept honest against the token it duplicates —
    // the card inside is `rounded-[var(--brand-radius-panel)]`, and a drift here
    // is a visible mismatch between the clip and the card's corners.
    const panel = css.match(/--brand-radius-panel:\s*([^;]+);/);
    expect(panel, "--brand-radius-panel not found in :root").not.toBeNull();
    const wrapper = css.match(/\.brand-lit-card\s*\{([^}]*)\}/);
    expect(wrapper, ".brand-lit-card rule not found").not.toBeNull();
    const radius = wrapper![1].match(/border-radius:\s*([^;]+);/);
    expect(radius, "no border-radius on .brand-lit-card").not.toBeNull();
    expect(radius![1].trim()).toBe(panel![1].trim());
  });

  it("the global reduced-motion collapse covers it — a plain animation: shorthand under *, *::before, *::after, no per-effect override needed", () => {
    const m = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/);
    expect(m, "no global reduced-motion block").not.toBeNull();
    expect(m![1]).not.toMatch(/\.brand-lit-card/);
  });
});

describe("app/(client)/page.tsx — data-lit", () => {
  const src = read("app/(client)/page.tsx");
  // The prose above the wrapper names the attribute and the selector, and a
  // multi-line `{/* … */}` block is not recognisable line by line. So strip the
  // comments wholesale and count what is left: only JSX can SET the attribute,
  // and a raw count would read a doc edit as a second lit card (or miss one).
  const jsx = src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("the stripper works — the surrounding prose does mention data-lit", () => {
    // Fire-proof for the counter below: if this ever stops being true the
    // stripper has become a no-op and the count is measuring the wrong thing.
    expect(src).toMatch(/\{\/\*[\s\S]*?data-lit[\s\S]*?\*\/\}/);
    expect(jsx).not.toMatch(/brand-lit-card\[data-lit\]/);
  });

  it("data-lit is set on exactly one element — the hero card", () => {
    const attr = jsx.match(/\bdata-lit\b/g) ?? [];
    expect(attr.length).toBe(1);
  });

  it("data-lit sits on the brand-lit-card wrapper, which carries the elevation the clip eats", () => {
    expect(src).toMatch(/className="brand-lit-card shadow-xl shadow-accent\/10"\s+data-lit\b/);
  });
});
