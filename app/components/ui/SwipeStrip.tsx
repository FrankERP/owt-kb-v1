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
//
// A drag must not click. `DayStrip`'s cells are plain `<button onClick>`s living
// INSIDE this host, so a swipe that starts and ends over one of them fires a
// native `click` on release — motion doesn't suppress it, the browser does not
// know the pointer was ever "dragging". `dragged` (a ref, not state — it must
// never trigger a render) tracks that: `onDragStart` only fires once motion's
// own 3px distance threshold is cleared (see `swipeDirection`'s sibling doc),
// so a plain tap never sets it. `onClickCapture` on the host swallows the ONE
// click that follows: `e.preventDefault()` + `e.stopPropagation()` before it
// reaches a child's `onClick`, then clears the ref so the NEXT tap is untouched.
//
// The event order is why the reset is split two ways. Motion's drag controller
// resolves the release synchronously in the browser's pointerup handler
// (`stop()`, called from `PanSession`'s `onSessionEnd`), but it defers the
// `onDragEnd` callback itself to `frame.postRender` — i.e. the NEXT animation
// frame (`VisualElementDragControls.mjs`). The browser's own `click` event,
// however, fires synchronously right after `pointerup`, in the same task, well
// before that frame. So the real order on a released drag is: pointerup → click
// (dragged.current still true from onDragStart, so onClickCapture swallows it
// and clears the ref there) → …a frame later… → onDragEnd. Clearing the ref a
// second time in onDragEnd is therefore usually redundant — but it is the only
// backstop if a click is ever suppressed or arrives late (a platform that fires
// click AFTER onDragEnd, or no click at all): without it a single such case
// would leave `dragged.current` stuck true and swallow every future tap. That
// clear is delayed one macrotask (`setTimeout(0)`, not synchronous) precisely
// so it can never race ahead of a same-task click that hasn't run yet — clearing
// synchronously inside onDragEnd would still be fine in the common (rAF-deferred)
// order above, but a `setTimeout(0)` costs nothing and stays correct even if a
// future motion version changes that scheduling.
import { useRef } from "react";
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

/**
 * A y-locked drag never pages. `dragDirectionLock` decides the axis on the
 * first move past the threshold and reports it via `onDirectionLock`; once
 * it says "y" the finger is scrolling the page vertically, not paging the
 * strip, and `offsetX`/`velocityX` are noise picked up along the way (a
 * diagonal flick can still clear `swipeDirection`'s thresholds). `null` means
 * no lock has been reported yet (drag hasn't moved, or the axis is still "x"
 * from `onDragStart`'s reset) and defers to the ordinary decision. Exported
 * next to `swipeDirection` for the same reason: motion's `drag` gesture can't
 * be driven in jsdom, see SwipeStrip.test.tsx.
 */
export function shouldPage(
  lock: "x" | "y" | null,
  offsetX: number,
  velocityX: number,
  threshold: number = SWIPE.distance,
): -1 | 0 | 1 {
  if (lock === "y") return 0;
  return swipeDirection(offsetX, velocityX, threshold);
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
  // Neither ref triggers a render — both are read only from motion's own
  // callbacks and from the click capture below, never from JSX.
  const dragged = useRef(false);
  const lock = useRef<"x" | "y" | null>(null);

  const handleDragStart = () => {
    dragged.current = true;
    lock.current = null;
  };

  const handleDirectionLock = (axis: "x" | "y") => {
    lock.current = axis;
  };

  const handleDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const direction = shouldPage(lock.current, info.offset.x, info.velocity.x, threshold);
    if (direction !== 0) onSwipe(direction);
    // See the file header for why this is a macrotask, not synchronous: the
    // click that follows a real release has, in every observed order, already
    // run and been swallowed by onClickCapture below by the time this fires.
    setTimeout(() => {
      dragged.current = false;
    }, 0);
  };

  const handleClickCapture = (event: React.MouseEvent) => {
    if (dragged.current) {
      event.preventDefault();
      event.stopPropagation();
      dragged.current = false;
    }
  };

  return (
    <m.div
      drag="x"
      dragDirectionLock
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.2}
      dragSnapToOrigin
      dragTransition={SNAP_TRANSITION}
      onDragStart={handleDragStart}
      onDirectionLock={handleDirectionLock}
      onDragEnd={handleDragEnd}
      onClickCapture={handleClickCapture}
      style={{ touchAction: "pan-y" }}
      className={className}
    >
      {children}
    </m.div>
  );
}
