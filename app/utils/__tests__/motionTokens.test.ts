// Guard for the motion token layer (spec §2.3). brand.css is outside lint and tsc,
// so an undeclared --motion-* var is dropped silently at computed-value time —
// exactly the failure brandCss.test.ts closes for colours. This file pins the
// NAMES and the Tailwind mirror, because a token that exists only in CSS can be
// misspelled in a utility with no signal from any gate.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments, syntaxFor } from "../../../scripts/lib/strip-comments.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel: string) =>
  stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"), { syntax: syntaxFor(rel) });

const css = read("app/brand.css");
const tailwind = read("tailwind.config.ts");

function rootBlock(src: string): string {
  const m = src.match(/:root\s*\{([^}]*)\}/);
  return m ? m[1] : "";
}

export const MOTION_TOKENS = {
  "--motion-fast": "120ms",
  "--motion-base": "200ms",
  "--motion-slow": "320ms",
  "--motion-reveal": "480ms",
  "--motion-shimmer": "1600ms",
  "--ease-out": "cubic-bezier(0.22, 1, 0.36, 1)",
  "--ease-in": "cubic-bezier(0.4, 0, 1, 1)",
  "--ease-in-out": "cubic-bezier(0.65, 0, 0.35, 1)",
  "--motion-rise": "8px",
  "--motion-sink": "1px",
} as const;

describe("motion tokens — brand.css :root", () => {
  const root = rootBlock(css);

  it.each(Object.entries(MOTION_TOKENS))("declares %s as %s", (name, value) => {
    const re = new RegExp(`${name}\\s*:\\s*${value.replace(/[().]/g, "\\$&")}\\s*;`);
    expect(root).toMatch(re);
  });

  it("aliases the two surviving --brand-duration-* vars onto the motion tokens", () => {
    expect(root).toMatch(/--brand-duration-fast\s*:\s*var\(--motion-fast\)\s*;/);
    expect(root).toMatch(/--brand-duration-reveal\s*:\s*var\(--motion-reveal\)\s*;/);
  });

  it("declares them inside the FIRST :root block, where brandCss.test.ts's parity check reads", () => {
    for (const name of Object.keys(MOTION_TOKENS)) expect(root).toContain(name);
  });
});

describe("motion tokens — Tailwind mirror", () => {
  it("maps duration utilities onto the vars", () => {
    expect(tailwind).toMatch(/transitionDuration:\s*\{[^}]*fast:\s*"var\(--motion-fast\)"/);
    expect(tailwind).toMatch(/transitionDuration:\s*\{[^}]*base:\s*"var\(--motion-base\)"/);
    expect(tailwind).toMatch(/transitionDuration:\s*\{[^}]*slow:\s*"var\(--motion-slow\)"/);
    expect(tailwind).toMatch(/transitionDuration:\s*\{[^}]*reveal:\s*"var\(--motion-reveal\)"/);
  });

  it("maps easing utilities onto the vars", () => {
    expect(tailwind).toMatch(/transitionTimingFunction:\s*\{[^}]*"out-brand":\s*"var\(--ease-out\)"/);
    expect(tailwind).toMatch(/transitionTimingFunction:\s*\{[^}]*"in-brand":\s*"var\(--ease-in\)"/);
    expect(tailwind).toMatch(/transitionTimingFunction:\s*\{[^}]*"in-out-brand":\s*"var\(--ease-in-out\)"/);
  });

  it("declares the three keyframes and their animation utilities", () => {
    for (const k of ["rise", "shimmer", "scale-in"]) {
      expect(tailwind, `keyframes.${k}`).toMatch(new RegExp(`keyframes:\\s*\\{[\\s\\S]*"?${k}"?:\\s*\\{`));
      expect(tailwind, `animation.${k}`).toMatch(new RegExp(`animation:\\s*\\{[\\s\\S]*"?${k}"?:\\s*"${k} `));
    }
  });

  it("ends every mirrored keyframe's `to` frame that animates transform on transform: \"none\" — the containing-block trap `brand-reveal`/`brand-beam-reveal` avoid in brand.css (MOTION.md rule 5); shimmer is exempt because its `to` is the sweep's landing position, not a rest state", () => {
    // shimmer deliberately does NOT end on "none" — it is a translate sweep, not
    // an enter animation, so there is no fixed-descendant containing-block risk.
    const EXEMPT = new Set(["shimmer"]);
    for (const k of ["rise", "shimmer", "scale-in"]) {
      const m = tailwind.match(new RegExp(`"?${k}"?:\\s*\\{[\\s\\S]*?to:\\s*\\{([^}]*)\\}`));
      expect(m, `${k}: to-frame not found`).not.toBeNull();
      const toFrame = m![1];
      if (!/transform\s*:/.test(toFrame)) continue;
      if (EXEMPT.has(k)) {
        expect(toFrame, `${k}: exempt keyframe should not end on transform: "none"`).not.toMatch(/transform:\s*"none"/);
        continue;
      }
      expect(toFrame, `${k}: to-frame must end on transform: "none"`).toMatch(/transform:\s*"none"/);
    }
  });

  it("adds no colour key — tokenLayer.test.ts owns theme.extend.colors", () => {
    const colorsStart = tailwind.indexOf("colors: {");
    const motionStart = tailwind.indexOf("transitionDuration:");
    expect(colorsStart).toBeGreaterThan(-1);
    expect(motionStart).toBeGreaterThan(colorsStart);
  });
});

describe("reduced motion is global, not per-effect", () => {
  it("brand.css collapses every animation and transition under prefers-reduced-motion", () => {
    const m = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/);
    expect(m, "no global reduced-motion block").not.toBeNull();
    const body = m![1];
    expect(body).toMatch(/\*,\s*\*::before,\s*\*::after\s*\{/);
    expect(body).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
    expect(body).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
    expect(body).toMatch(/animation-iteration-count:\s*1\s*!important/);
    expect(body).toMatch(/scroll-behavior:\s*auto\s*!important/);
    // [data-reveal]'s animation-delay (up to 480ms at the stagger cap) combines
    // with `fill: both` to hold the element at opacity 0 for the whole delay —
    // the collapse must zero that too, or "no motion" still means "invisible
    // for half a second".
    expect(body).toMatch(/animation-delay:\s*-1ms\s*!important/);
  });

  it("the old beam-only override is gone — one rule, not one per effect", () => {
    expect(css).not.toMatch(/prefers-reduced-motion[\s\S]{0,200}\.brand-stage-hero::before/);
  });

  it("html[data-motion=\"off\"] applies the same collapse, for VR baselines", () => {
    const selector = /html\[data-motion="off"\]\s*\*,\s*html\[data-motion="off"\]\s*\*::before,\s*html\[data-motion="off"\]\s*\*::after\s*\{/;
    expect(css).toMatch(selector);
    const m = css.match(/html\[data-motion="off"\]\s*\*,\s*html\[data-motion="off"\]\s*\*::before,\s*html\[data-motion="off"\]\s*\*::after\s*\{([\s\S]*?)\n\}/);
    expect(m, "no html[data-motion=\"off\"] collapse block").not.toBeNull();
    expect(m![1]).toMatch(/animation-delay:\s*-1ms\s*!important/);
  });

  it("the theme gallery root sets data-motion=\"off\" on <html>", () => {
    const layout = read("app/(gallery)/theme-gallery/[theme]/layout.tsx");
    expect(layout).toMatch(/<html[\s\S]*?data-motion="off"/);
  });
});
