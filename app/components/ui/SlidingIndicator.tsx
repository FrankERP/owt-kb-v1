"use client";

// The sliding active marker for tab bars (spec §4 `Tabs`, §19.1, §19.3): the
// admin TabBar, the song page's SectionNav, the phone's BottomNav. Render ONE
// inside the active item; the shared layoutId makes domMax slide it there.
// Semantics stay on the items (aria-current) — the indicator is decoration.

import { useCallback, useEffect, useRef } from "react";
import * as m from "motion/react-m";
import { SPRINGS } from "@/app/utils/motionPresets";

const VARIANT = {
  pill: "absolute inset-0 -z-10 rounded-lg bg-accent/15 shadow-[inset_0_0_0_1px_rgb(var(--accent-rgb)/0.15)]",
  underline: "absolute inset-x-0 bottom-0 h-0.5 bg-accent",
  dot: "absolute left-1/2 top-1 h-1 w-6 -translate-x-1/2 rounded-full bg-accent",
} as const;

export default function SlidingIndicator({
  id,
  variant = "pill",
  className = "",
}: {
  id: string;
  variant?: keyof typeof VARIANT;
  className?: string;
}) {
  return (
    <m.span
      data-sliding-indicator=""
      aria-hidden
      layoutId={id}
      initial={false}
      transition={SPRINGS.settle}
      className={`${VARIANT[variant]} ${className}`.trim()}
    />
  );
}

/**
 * Ref callback for a tab-bar item: when it becomes active it scrolls itself to
 * the centre of a horizontally scrolling bar. `behavior` honours reduced motion.
 */
export function useActiveIntoView(active: boolean): (node: HTMLElement | null) => void {
  const nodeRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!active || !nodeRef.current) return;
    const reduced =
      typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    nodeRef.current.scrollIntoView?.({ inline: "center", block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [active]);
  return useCallback((node: HTMLElement | null) => { nodeRef.current = node; }, []);
}
