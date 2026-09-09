"use client";

// A number (or short label) that changes in place (spec §4): the old value rises
// out, the new one rises in. NextServiceHero's countdown, the readiness card's
// relative day, the participation total, ChordChart's capo readout. Both values
// share one grid cell so the width never jumps; `initial={false}` so the first
// paint is the value, not an animation.

import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { EASE_IN, EASE_OUT, EXIT_MS, MS } from "@/app/utils/motionPresets";

export default function NumberRoll({ value, className = "" }: { value: string | number; className?: string }) {
  const key = String(value);
  return (
    <span className={`inline-grid overflow-hidden align-baseline ${className}`.trim()}>
      <AnimatePresence initial={false} mode="popLayout">
        <m.span
          key={key}
          initial={{ y: "0.6em", opacity: 0 }}
          animate={{ y: 0, opacity: 1, transition: { duration: MS.base / 1000, ease: EASE_OUT } }}
          exit={{ y: "-0.6em", opacity: 0, transition: { duration: EXIT_MS / 1000, ease: EASE_IN } }}
          className="[grid-area:1/1] block"
        >
          {key}
        </m.span>
      </AnimatePresence>
    </span>
  );
}
