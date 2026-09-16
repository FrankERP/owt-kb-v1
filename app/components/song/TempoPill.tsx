"use client";

// The BPM pill, tapping the song's tempo (R4 ruling 7) and clicking it (F1,
// ruling 11). TWO CLOCKS, on purpose:
//
// - The RING has no timer. The beat is one keyframe animation on a
//   pseudo-element (`.brand-tempo-pill::after` in brand.css) whose period is
//   this button's own `--tempo-period`, so there is nothing to drift when the
//   main thread is busy and the global reduced-motion rule collapses it with
//   every other animation rather than needing its own opt-out.
// - The CLICK does have a loop — the lookahead scheduler in `metronome.ts`,
//   which is the only way to place a beat accurately — but it belongs to the
//   active state: `stop()` clears it, on the second tap, on a hidden tab, and on
//   unmount. `tempoPill.test.tsx` asserts the timer count is zero in all three.
//
// Tap = ring + click, with no separate silent mode (ruling 13): the phone's
// volume is the control. On iOS the click obeys the SILENT SWITCH, because Web
// Audio does — the ring keeps running with the sound muted.

import { useEffect, useRef, useState } from "react";
import { haptic } from "@/app/utils/haptics";
import { beatsPerBar, tempoPeriodMs } from "@/app/utils/practice";
import { createMetronome, type Metronome } from "./metronome";

export default function TempoPill({ bpm, timeSig }: { bpm: number; timeSig?: string | null }) {
  const [active, setActive] = useState(false);
  const metronome = useRef<Metronome | null>(null);
  const params = useRef({ bpm, timeSig });

  // A tempo that changes underneath a running click would keep the old period —
  // the metronome is built once, from the props of the tap. So drop it and let
  // the next tap build a new one, rather than beating a tempo the pill no
  // longer shows.
  useEffect(() => {
    if (params.current.bpm === bpm && params.current.timeSig === timeSig) return;
    params.current = { bpm, timeSig };
    metronome.current?.stop();
    metronome.current = null;
    setActive(false);
  }, [bpm, timeSig]);

  // Unmount only ([] deps): the metronome outlives every render, and a cleanup
  // that ran on each one would stop the click under the finger.
  useEffect(
    () => () => {
      metronome.current?.stop();
      metronome.current = null;
    },
    [],
  );

  return (
    <button
      type="button"
      onClick={() => {
        void haptic("light");
        if (active) {
          metronome.current?.stop();
          setActive(false);
          return;
        }
        // Created on the FIRST tap, never at mount: an AudioContext may only be
        // built inside a user gesture, and a page of pills would otherwise open
        // one context each.
        metronome.current ??= createMetronome({
          bpm,
          beatsPerBar: beatsPerBar(timeSig),
          onStop: () => setActive(false),
        });
        metronome.current.start();
        setActive(true);
      }}
      aria-pressed={active}
      aria-label={active ? `Detener el clic, ${bpm} BPM` : `Marcar tempo con clic, ${bpm} BPM`}
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
