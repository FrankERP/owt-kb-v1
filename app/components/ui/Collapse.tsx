"use client";

// Expand/collapse with motion (spec §4). The ONE place height animates: motion
// measures `auto` and tweens it, on user-triggered disclosures only (spec §2.2).
// Children stay mounted — IntegrityQueuePanel focuses an entry right after
// opening and relies on the node existing — and a closed Collapse is inert +
// aria-hidden so nothing inside is reachable. `initial={false}` means a disclosure
// that is open at first paint renders open before the feature chunk arrives.

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
    if (ref.current) (ref.current as HTMLDivElement & { inert: boolean }).inert = hidden;
  }, [hidden]);
  return (
    <m.div
      ref={ref}
      id={id}
      aria-hidden={hidden ? "true" : undefined}
      inert={hidden ? true : undefined}
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
      className={className}
    >
      {children}
    </m.div>
  );
}
