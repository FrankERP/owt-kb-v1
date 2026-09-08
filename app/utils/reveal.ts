// Route reveal, CSS-only (spec §2.1 #1). A Server Component spreads
// `{...revealProps(i)}` on a block; brand.css does the rest. Neutral module — no
// "use client", no imports — so server pages may CALL it (ADR-0028).
//
// The stagger is capped: index 12 keeps the last delay at 480 ms — the same length
// as `--motion-reveal`, the section rail's draw, not the reveal itself, which runs
// on `--motion-base` (200 ms). Past that the eye reads the list as "loaded"; a
// 142-row library that staggered to the end would still be fading in at 5.6 s.

export const REVEAL_STAGGER_CAP = 12;

// `style` is typed as `React.CSSProperties & …` (not cast at call sites) so a
// Server Component can spread `{...revealProps(i)}` straight onto a `div` and
// still type-check — React's own `CSSProperties` has no index signature for
// custom properties.
export type RevealProps = {
  "data-reveal": "";
  style: React.CSSProperties & { ["--reveal-i"]: number };
};

export function revealProps(index = 0): RevealProps {
  return { "data-reveal": "", style: { "--reveal-i": Math.min(index, REVEAL_STAGGER_CAP) } };
}
