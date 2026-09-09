"use client";

// Expand/collapse with motion (spec §4). The ONE place height animates: motion
// measures `auto` and tweens it, on user-triggered disclosures only (spec §2.2).
// Children stay mounted — IntegrityQueuePanel focuses an entry right after
// opening and relies on the node existing — and a closed Collapse is inert +
// aria-hidden so nothing inside is reachable. `initial={false}` means a disclosure
// that is open at first paint renders open before the feature chunk arrives.
//
// The animated element is UNSTYLED and `className` goes on an inner plain div:
// under `border-box` a padded/bordered box floors its height at padding+border,
// so a closed Collapse that owned the padding reserved blank space forever
// (~50px on /me). Height 0 only means 0 when the box has no padding of its own.
//
// A closed Collapse is a zero-height child; a `space-y-*`/`gap` PARENT still
// reserves its gap, so carry the gap on the Collapse's own className instead
// (see AvailabilityCalendar, ServicesPanel).

import { useEffect, useRef, useState } from "react";
import * as m from "motion/react-m";
import { EASE_IN, EASE_OUT, EXIT_MS, MS } from "@/app/utils/motionPresets";

export default function Collapse({
  open,
  id,
  className = "",
  children,
}: {
  open: boolean;
  id?: string;
  className?: string;
  children: React.ReactNode;
}) {
  // Attributes flip AFTER the close animation (so content fades while still
  // readable) and BEFORE the open animation (so it is reachable at once).
  const [hidden, setHidden] = useState(!open);
  const ref = useRef<HTMLDivElement>(null);
  // Derived during RENDER, not in an effect: React runs the whole passive-effect
  // pass before flushing work an effect schedules, so a `setHidden(false)` latch
  // would still leave `inert` on the node while the PARENT's effect runs — that
  // is IntegrityQueuePanel's `el.focus()` being refused inside an inert ancestor,
  // with the ref already cleared so it never retries. Opening therefore clears
  // both attributes in the same commit as `open`; closing still waits for
  // `onAnimationComplete` to set `hidden`.
  const closedNow = hidden && !open;
  // Reconciles the latch once opened, so the next close starts from `false`.
  useEffect(() => {
    if (open) setHidden(false);
  }, [open]);
  // `inert` is a real reflected DOM property in every browser this app ships
  // to, but jsdom (as of this writing) never wires the reflection up — the
  // content attribute React sets from the JSX prop below never shows up as
  // `el.inert` in tests. Setting the IDL property imperatively is what
  // Collapse.test.tsx observes, and it is a harmless no-op duplicate of the
  // attribute in a real browser.
  useEffect(() => {
    if (ref.current) (ref.current as HTMLDivElement & { inert: boolean }).inert = closedNow;
  }, [closedNow]);
  return (
    <m.div
      ref={ref}
      id={id}
      aria-hidden={closedNow ? "true" : undefined}
      inert={closedNow ? true : undefined}
      initial={false}
      animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
      transition={
        open
          ? { duration: MS.slow / 1000, ease: EASE_OUT }
          : { duration: EXIT_MS / 1000, ease: EASE_IN }
      }
      onAnimationComplete={() => {
        if (!open) setHidden(true);
      }}
      style={{ overflow: "hidden" }}
    >
      <div className={className}>{children}</div>
    </m.div>
  );
}
