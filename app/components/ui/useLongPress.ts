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
//
// A KEYBOARD-invoked context menu (Shift+F10, the Menu key) also arrives as button 0
// with no `pointerType`, so it is indistinguishable from Safari's touch `contextmenu`
// and takes the same path: prevented, sheet not opened. That is the honest statement of
// the behaviour — a `contextmenu` with no mouse signal is prevented, and keyboard-invoked
// menus on rows are not supported. The row's own tap (Enter/Space) is the affordance,
// and every quick action it would have offered is reachable another way.
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
  onKeyDownCapture: (e: React.KeyboardEvent) => void;
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

  // Armed inside `pointerdown`, not always-on: a `window.addEventListener`
  // call is synchronous and takes effect before any LATER task, so a listener
  // added the instant the press starts still catches the first scroll frame of
  // a fast flick — there is no window for it to miss. An always-on listener
  // cost the app one active `scroll` handler per mounted row (~140 on a long
  // list) for presses that were never made.
  const onScrollRef = useRef<(() => void) | null>(null);
  const stopScrollWatch = useCallback(() => {
    if (onScrollRef.current) {
      window.removeEventListener("scroll", onScrollRef.current, true);
      onScrollRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
    stopScrollWatch();
  }, [stopScrollWatch]);

  useEffect(() => () => cancel(), [cancel]);

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
        const onScroll = () => cancel();
        onScrollRef.current = onScroll;
        window.addEventListener("scroll", onScroll, true);
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
        // React's SyntheticEvent only proxies the properties MouseEvent's own
        // interface declares, so a non-standard extension like `pointerType`
        // (Chrome/Edge's own addition to a `contextmenu` MouseEvent) never
        // reaches `e` itself — only `e.nativeEvent` carries it.
        const pointerType = (e.nativeEvent as MouseEvent & { pointerType?: string }).pointerType;
<<<<<<< HEAD
=======
        // No mouse signal ⇒ prevented only: a touch press has already fired (or
        // will), and a keyboard-invoked menu is indistinguishable from it here.
>>>>>>> claude/motion-r7-appwide
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
      // A keydown can never be the tail of a pointer-driven long press — Enter/
      // Space activating a focused row is its own, unrelated interaction. A
      // stale `suppressClick` (a long press fired, then the row kept focus)
      // would otherwise swallow that keyboard activation's click too.
      onKeyDownCapture: () => {
        suppressClick.current = false;
      },
      style: STYLE,
    };
  }, [cancel, move, ms]);
}
