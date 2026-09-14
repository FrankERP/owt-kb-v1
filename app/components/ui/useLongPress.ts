"use client";
// app/components/ui/useLongPress.ts
// The long-press gesture (spec §12.8, decision L): hold a row for 450 ms and its
// quick actions open. Spread the returned handlers — and `style` — on the row.
//
// While the timer is pending the row shows NOTHING: no progress ring, no growing
// fill. The whole feedback is the one the spec asks for — a medium haptic the
// instant it fires, and the sheet. A press that is going to be cancelled (a scroll,
// a drag, a lift) therefore costs the row no visual state at all, which is what
// keeps a list of ~140 of these cheap.
//
// Every way a press can STOP being a press cancels it: lift, cancel, the pointer
// leaving the row, a move past 8 px, or a `scroll` anywhere (capture phase, so a
// scrolling container counts too). The scroll rule is the load-bearing one on a
// phone: a flick that starts on a row keeps the finger within a few pixels for the
// first frames, so distance alone would let a scroll open the sheet.
//
// A fired press must not ALSO be a tap. The row's own `onClick` is swallowed once
// through a capture-phase handler on the same element (the `SwipeStrip` precedent),
// cleared by the next `pointerdown` so the following tap is untouched.
//
// Desktop has no long press worth the name — a mouse held still for 450 ms is an
// accident, and the OS context menu wins anyway. So `contextmenu` from a MOUSE opens
// the same sheet immediately; from a touch it is only prevented, because the press
// itself already fired (or will) and the native callout would fight it. "From a
// mouse" is `pointerType === "mouse"` when the browser sends one (Chrome, Edge) and
// `button === 2` when it does not (Safari and Firefox put no `pointerType` on a
// `contextmenu` MouseEvent) — a touch-generated `contextmenu` carries button 0.
import { useCallback, useEffect, useMemo, useRef } from "react";
import type React from "react";
import { haptic } from "@/app/utils/haptics";

export const LONG_PRESS_MS = 450;
export const LONG_PRESS_MOVE = 8;

export interface LongPressHandlers {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onPointerLeave: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onClickCapture: (e: React.MouseEvent) => void;
  style: React.CSSProperties;
}

const STYLE: React.CSSProperties = {
  WebkitTouchCallout: "none",
  userSelect: "none",
  WebkitUserSelect: "none",
} as React.CSSProperties;

export default function useLongPress(
  onLongPress: () => void,
  opts?: { ms?: number; move?: number },
): LongPressHandlers {
  const ms = opts?.ms ?? LONG_PRESS_MS;
  const move = opts?.move ?? LONG_PRESS_MOVE;

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  // The callback in a ref: a row re-renders (a filter, a new `post`) while a finger
  // is down, and re-arming the timer on every render would mean it never fires.
  const latest = useRef(onLongPress);
  useEffect(() => {
    latest.current = onLongPress;
  }, [onLongPress]);

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  }, []);

  // One always-on listener rather than one armed per press: `cancel` is two
  // assignments, and a listener added on `pointerdown` can miss the first scroll
  // frame of a fast flick.
  useEffect(() => {
    const onScroll = () => cancel();
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      cancel();
    };
  }, [cancel]);

  return useMemo<LongPressHandlers>(() => {
    // `suppress` is false for the mouse path: a right-click produces no click to
    // swallow, and a stale flag would eat the next honest left tap.
    const fire = (suppress: boolean) => {
      cancel();
      if (suppress) suppressClick.current = true;
      void haptic("medium");
      latest.current();
    };

    return {
      onPointerDown: (e) => {
        suppressClick.current = false;
        if (e.isPrimary === false || (typeof e.button === "number" && e.button !== 0)) return;
        cancel();
        origin.current = { x: e.clientX, y: e.clientY };
        timer.current = setTimeout(() => fire(true), ms);
      },
      onPointerMove: (e) => {
        const o = origin.current;
        if (!o || !timer.current) return;
        if (Math.hypot(e.clientX - o.x, e.clientY - o.y) > move) cancel();
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onPointerLeave: cancel,
      onContextMenu: (e) => {
        e.preventDefault();
        const pointerType = (e as React.MouseEvent & { pointerType?: string }).pointerType;
        const isMouse = pointerType ? pointerType === "mouse" : e.button === 2;
        if (!isMouse) return;
        fire(false);
      },
      onClickCapture: (e) => {
        if (!suppressClick.current) return;
        suppressClick.current = false;
        e.stopPropagation();
        e.preventDefault();
      },
      style: STYLE,
    };
  }, [cancel, move, ms]);
}
