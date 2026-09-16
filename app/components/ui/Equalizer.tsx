"use client";

// The one ambient animation in the app (R4 spec §5.3), and it stops with the
// audio: three bars sit static at `scaleY(0.3)` and only animate under
// `[data-playing="true"]` (`.brand-eq-bar` / `@keyframes brand-eq` in
// `brand.css`, beside `.brand-tempo-pill`). CSS-only — no `motion` import
// needed — and the global reduced-motion rule already collapses it.

export default function Equalizer({ playing, className = "" }: { playing: boolean; className?: string }) {
  return (
    <span className={`inline-flex h-3 items-end gap-[2px] ${className}`} aria-hidden data-playing={playing}>
      <span className="brand-eq-bar w-[3px] rounded-sm bg-accent" style={{ animationDelay: "0ms" }} />
      <span className="brand-eq-bar w-[3px] rounded-sm bg-accent" style={{ animationDelay: "150ms" }} />
      <span className="brand-eq-bar w-[3px] rounded-sm bg-accent" style={{ animationDelay: "300ms" }} />
    </span>
  );
}
