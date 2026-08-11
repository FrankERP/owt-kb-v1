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
