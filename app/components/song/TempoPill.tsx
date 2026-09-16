"use client";

// The BPM pill, tapping the song's tempo (R4 ruling 7).
//
// CSS-CLOCKED, NOT TIMED. The beat is one keyframe animation on a pseudo-element
// (`.brand-tempo-pill::after` in brand.css) whose period is this button's own
// `--tempo-period`. There is no interval, so there is nothing to leak on unmount,
// nothing to drift when the main thread is busy, and the global reduced-motion
// rule collapses it with every other animation rather than needing its own
// opt-out. `tempoPill.test.tsx` asserts the timer count stays at zero for exactly
// that reason.

import { useState } from "react";
import { haptic } from "@/app/utils/haptics";
import { tempoPeriodMs } from "@/app/utils/practice";

export default function TempoPill({ bpm }: { bpm: number }) {
  const [active, setActive] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        setActive((a) => !a);
        void haptic("light");
      }}
      aria-pressed={active}
      aria-label={active ? `Detener tempo, ${bpm} BPM` : `Marcar tempo, ${bpm} BPM`}
      // Absent while idle rather than "false": the ring rule keys on
      // [data-active="true"], and the attribute is the state.
      data-active={active || undefined}
      style={{ "--tempo-period": `${tempoPeriodMs(bpm)}ms` } as React.CSSProperties}
      className="brand-tempo-pill brand-search-console relative flex h-[2.4rem] min-h-[44px] items-center px-3 font-label text-[11px] uppercase tracking-widest text-ink-dim transition-[color,transform] duration-fast ease-out-brand active:translate-y-px active:scale-[0.985] aria-pressed:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base"
    >
      {bpm} BPM
    </button>
  );
}
