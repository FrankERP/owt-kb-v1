"use client";
// app/components/ui/SwipeStrip.tsx
// R2's strip-paging gesture: the schedule's day strip (Task 3) wraps its content
// here so a horizontal drag pages the visible WEEK — seven days per view, paged
// client-side. The header's own prev/next buttons page the MONTH, so the gesture
// complements them rather than duplicating them.
//
// `drag="x"` is locked to the horizontal axis (`dragDirectionLock`) and pinned at
// the origin (`dragConstraints={{ left: 0, right: 0 }}`) with elastic give while a
// finger is down (`dragElastic={0.2}`); `dragSnapToOrigin` always returns the strip
// to 0 on release. The spring for that return is `SPRINGS.settle` passed as
// `dragTransition` — motion's drag controller spreads `dragTransition` INTO the
// release animation's options (`{ type: "inertia", ...dragTransition, ...constraints }`
// in VisualElementDragControls), so a `type: "spring"` override there replaces the
// default inertia entirely rather than merely tuning its bounce. `style.touchAction:
// "pan-y"` keeps vertical page scroll alive under a finger that starts on the strip —
// only the horizontal axis is claimed, which is also why the wrapped content must FIT
// the width: a horizontal scroller nested in here could never be finger-scrolled.
//
// Keyboard paging is NOT this component's job — the header's own prev/next buttons
// (Task 3) cover the month axis; this primitive is pointer/touch only, same division CueDialog
// draws between its drag-to-dismiss head and its Escape handler.
//
// Reduced motion is not detected here. `MotionConfig reducedMotion="user"`
// (`MotionProvider`) already collapses every `m.*` transform transition — this
// snap-back included — to duration 0 app-wide; `Presence` and `CueDialog` rely on
// the same global switch rather than each re-checking `prefers-reduced-motion`,
// and this primitive mirrors that.
import * as m from "motion/react-m";
import type { InertiaOptions, PanInfo } from "motion/react";
import { SPRINGS, SWIPE } from "@/app/utils/motionPresets";

// `dragTransition`'s declared type is `InertiaOptions` (bounceStiffness/bounceDamping,
// no `type` field) — it shares no property with `SPRINGS.settle`'s spring shape, which
// is exactly what makes the override work at runtime (see the file header) and exactly
// what TS's "weak type" check (TS2559) flags at compile time. The cast is the override,
// not a type escape.
const SNAP_TRANSITION = SPRINGS.settle as unknown as InertiaOptions;

/**
 * Pure decision for a completed drag: `1` pages forward (dragged left), `-1`
 * pages back (dragged right), `0` means the drag was neither far nor fast
 * enough to page. Exported so the threshold/velocity arithmetic is directly
 * testable — motion's `drag` gesture cannot be driven in jsdom (no layout, no
 * real pointer capture), see SwipeStrip.test.tsx.
 */
export function swipeDirection(offsetX: number, velocityX: number, threshold: number = SWIPE.distance): -1 | 0 | 1 {
  if (offsetX < -threshold || velocityX < -SWIPE.velocity) return 1;
  if (offsetX > threshold || velocityX > SWIPE.velocity) return -1;
  return 0;
}

export default function SwipeStrip({
  onSwipe,
  threshold = SWIPE.distance,
  className = "",
  children,
}: {
  onSwipe: (direction: -1 | 1) => void;
  threshold?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const handleDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const direction = swipeDirection(info.offset.x, info.velocity.x, threshold);
    if (direction !== 0) onSwipe(direction);
  };

  return (
    <m.div
      drag="x"
      dragDirectionLock
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.2}
      dragSnapToOrigin
      dragTransition={SNAP_TRANSITION}
      onDragEnd={handleDragEnd}
      style={{ touchAction: "pan-y" }}
      className={className}
    >
      {children}
    </m.div>
  );
}
