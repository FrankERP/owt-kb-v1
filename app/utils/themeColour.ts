// Build a complete CSS colour from a token's RGB triplet.
//
// WHY THIS EXISTS, and why it must never return a fragment.
//
// Before Child B, three components carried their accent as a bare hex string and
// built colours by CONCATENATION — `` `${accentHex}55` `` for a third-opacity
// border, `` `${accentHex}0d` `` for a faint wash. That works only because an
// 8-digit hex is a valid colour: the last two digits are alpha.
//
// A token cannot be used that way. `rgb(var(--accent-rgb) / 0.2)` concatenated
// with `55` gives `rgb(var(--accent-rgb) / 0.2)55`, which is not a valid <color>,
// so the browser drops the ENTIRE declaration and the element renders with no
// colour at all — silently, with nothing in the console. That failure mode was
// live at 24 call sites across four files, several of them member-facing cards.
//
// So the contract is: this returns a COMPLETE colour, always. There is no variant
// that hands back a prefix for a caller to finish. If you find yourself wanting
// one, the answer is another argument here, not a string a caller can append to.
//
// NOT FOR SVG PRESENTATION ATTRIBUTES. `var()` is not substituted inside `fill=`
// or `stroke=`, so a value from here dropped into one of those is silently
// ignored — the same failure in a different costume. Set `color` on an ancestor
// and let the attribute inherit `currentColor` instead; `ChainLinkIcon` defaults
// to exactly that.

/**
 * @param rgbVar  a custom property holding a bare `R G B` triplet, e.g. `--accent-rgb`
 * @param alpha   0–1. Omit for a fully opaque colour.
 *
 * Alphas here are decimals where the call sites used two hex digits, so `55`
 * becomes `85 / 255 = 0.3333`. Four decimal places puts the error below a
 * thousandth of one 8-bit alpha level — far under any quantisation the compositor
 * can express, so nothing renders differently.
 */
export function themeColour(rgbVar: string, alpha?: number): string {
  return alpha === undefined
    ? `rgb(var(${rgbVar}))`
    : `rgb(var(${rgbVar}) / ${alpha})`;
}

/**
 * The same colour, RESOLVED for a `<canvas>`.
 *
 * A canvas `fillStyle` is parsed by the canvas, not the cascade: `var()` is never
 * substituted there, the assignment is invalid and the context silently keeps
 * its previous colour — black on a fresh context. That is how the rehearsal
 * waveform shipped black (2026-10-23). So for a canvas the triplet is read from
 * the computed style of an element inside the themed tree (the canvas itself)
 * and the colour is built from the literal numbers.
 *
 * Returns null when the property is missing or malformed, so a caller can skip
 * the draw rather than paint the wrong colour.
 */
export function resolvedThemeColour(el: Element, rgbVar: string, alpha?: number): string | null {
  const raw = typeof getComputedStyle === "function" ? getComputedStyle(el).getPropertyValue(rgbVar) : "";
  return colourFromTriplet(raw, alpha);
}

/** `"0 191 255"` (as `brand.css` writes the triplets) → `rgb(0 191 255 / a)`; null otherwise. */
export function colourFromTriplet(triplet: string, alpha?: number): string | null {
  const m = triplet.trim().match(/^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})$/);
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map(Number);
  if ([r, g, b].some((n) => n > 255)) return null;
  // The one literal `rgb(` this module writes: the numbers ARE the token, read at
  // run time, and a canvas can take nothing else (`scripts/colour-inventory.mjs`
  // exempts this row with the same reason).
  // eslint-disable-next-line no-restricted-syntax -- a canvas fillStyle never substitutes var()
  return alpha === undefined ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${alpha})`;
}
