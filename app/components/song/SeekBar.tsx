"use client";

// The loaded row's seek control when the mix carries NO envelope (the full-band
// mix: abletonnl's manifest renders peaks for the isolated instruments only,
// `docs/REHEARSAL_MIXES.md`). It sits in the slot `Waveform` takes on an
// isolated row — same height, same seek maths (`seekFractionAt` / `seekStep`) —
// so the row keeps one shape whichever mix is loaded. A track with a played
// fill in the accent and a playhead; nothing is drawn before playback starts.
// No padding on it: the click maps over its own box (the row indents a wrapper).
import { seekFractionAt, seekStep } from "@/app/utils/rehearsalMixes";

export default function SeekBar({
  progress,
  label,
  onSeek,
}: {
  progress: number;
  label: string;
  onSeek?: (fraction: number) => void;
}) {
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
    return <span role="img" aria-label={label} className="block">{track}</span>;
  }
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(e) => {
        const f = seekFractionAt(e.clientX, e.detail, e.currentTarget.getBoundingClientRect());
        if (f !== null) onSeek(f);
      }}
      onKeyDown={(e) => {
        const f = seekStep(progress, e.key);
        if (f !== null) { e.preventDefault(); onSeek(f); }
      }}
      className="block w-full cursor-pointer rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      {track}
    </button>
  );
}
