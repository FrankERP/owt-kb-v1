"use client";

// The loaded row's seek control when the mix carries NO envelope (the full-band
// mix: abletonnl's manifest renders peaks for the isolated instruments only,
// `docs/REHEARSAL_MIXES.md`). It sits in the slot `Waveform` takes on an
// isolated row — same height, same seek by click and ←/→ — so the row keeps one
// shape whichever mix is loaded. A track with a played fill in the accent and a
// playhead; nothing is drawn before playback starts.
import { useId } from "react";

const STEP = 5 / 100;

export default function SeekBar({
  progress,
  label,
  onSeek,
  className = "",
}: {
  progress: number;
  label: string;
  onSeek?: (fraction: number) => void;
  className?: string;
}) {
  const id = useId();
  const pct = `${Math.round(Math.min(1, Math.max(0, progress)) * 1000) / 10}%`;
  const track = (
    <span aria-hidden="true" className="relative block h-10 w-full">
      <span className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-mono-400/35" />
      {progress > 0 && (
        <>
          <span className="absolute left-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-accent" style={{ width: pct }} />
          <span className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-accent" style={{ left: pct }} />
        </>
      )}
    </span>
  );
  if (!onSeek) {
    return (
      <div className={className}>
        <span role="img" aria-label={label} id={id}>{track}</span>
      </div>
    );
  }
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(e) => {
        // A synthetic click from Enter/Space carries detail 0 — never seek to 0 on it.
        if (e.detail === 0) return;
        const rect = e.currentTarget.getBoundingClientRect();
        if (rect.width <= 0) return;
        onSeek(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)));
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") { e.preventDefault(); onSeek(Math.min(1, +(progress + STEP).toFixed(2))); }
        if (e.key === "ArrowLeft") { e.preventDefault(); onSeek(Math.max(0, +(progress - STEP).toFixed(2))); }
      }}
      className={`block w-full cursor-pointer rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${className}`}
    >
      {track}
    </button>
  );
}
