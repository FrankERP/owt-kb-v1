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
// It is the ONE tempo control: the song hero (`size="md"`) and the `SongSheet`
// meta row (`size="sm"`) render this same pill, and `metronome.ts` keeps only one
// of them sounding at a time (F2, ruling 15) — the pill that loses the floor
// un-presses through `onStop`. `enabled={false}` (the closed sheet, ruling 16)
// stops it without waiting for an unmount.
//
// Tap = ring + click, with no separate silent mode (ruling 13): the phone's
// volume is the control. On iOS the click obeys the SILENT SWITCH, because Web
// Audio does — the ring keeps running with the sound muted.

import { useEffect, useRef, useState } from "react";
import { haptic } from "@/app/utils/haptics";
import { beatsPerBar, tempoPeriodMs } from "@/app/utils/practice";
import { createMetronome, type Metronome } from "./metronome";

// Two chromes, one component (F2, ruling 14): "md" is the song hero's console
// pill, "sm" the smaller outlined pill the `SongSheet`'s meta row already drew
// as static text. Only the chrome differs — the ring, the click and the label are
// the same pill in both.
const CHROME = {
  md: "brand-search-console h-[2.4rem] px-3 text-[11px] uppercase tracking-widest text-ink-dim transition-[color,transform]",
  sm: "rounded-full border border-ink-muted/15 px-3 py-1 text-sm text-ink-muted/70 transition-[color,border-color,transform] aria-pressed:border-accent/60",
} as const;

export default function TempoPill({
  bpm,
  timeSig,
  enabled = true,
  size = "md",
}: {
  bpm: number;
  timeSig?: string | null;
  /** Flips false when the surface holding the pill is dismissed but kept mounted (`SongSheet`). */
  enabled?: boolean;
  size?: "sm" | "md";
}) {
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

  // Ruling 16: a pill whose surface closed must go quiet even if it stays
  // mounted. `stop()` is idempotent and `setActive(false)` is a no-op on an idle
  // pill, so this costs nothing on the enabled edge.
  useEffect(() => {
    if (enabled) return;
    metronome.current?.stop();
    setActive(false);
  }, [enabled]);

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
        // A dismissed surface takes no taps. Not `disabled`: the pill keeps its
        // chrome and its focus behaviour, it simply cannot start a click nobody
        // can see stop.
        if (!enabled) return;
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
      className={`brand-tempo-pill relative flex min-h-[44px] items-center font-label duration-fast ease-out-brand active:translate-y-px active:scale-[0.985] aria-pressed:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base ${CHROME[size]}`}
    >
      {bpm} BPM
    </button>
  );
}
