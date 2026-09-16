"use client";

// The play/pause morph (R4 spec §5.3): two glyphs cross-faded/scaled in place
// through `Presence` rather than swapped outright, so the control never pops.
// Purely decorative — the accessible name lives on the button that hosts this,
// so both SVGs stay `aria-hidden`.

import Presence from "./Presence";

export default function PlayPauseGlyph({ playing, size = 12 }: { playing: boolean; size?: number }) {
  return (
    <span className="relative inline-grid" style={{ width: size, height: size }} aria-hidden>
      <Presence show={!playing} variant="scale" as="div" className="[grid-area:1/1]">
        <PlaySvg size={size} />
      </Presence>
      <Presence show={playing} variant="scale" as="div" className="[grid-area:1/1]">
        <PauseSvg size={size} />
      </Presence>
    </span>
  );
}

function PlaySvg({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function PauseSvg({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="4" width="4" height="16" />
      <rect x="14" y="4" width="4" height="16" />
    </svg>
  );
}
