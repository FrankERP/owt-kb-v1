"use client";

// Pull-to-refresh on the phone (spec §12.8, decision L).
//
// THE CONTENT IS NEVER TRANSLATED. The indicator is a sibling `fixed` rail at
// the very top of the viewport, not a transform on `<main>` or on a wrapper
// around it: a transformed ancestor is a containing block for every
// `position: fixed` descendant (the FAB, the audio transport, the toasts), which
// is the trap ADR-0031 and `reveal.test.ts` exist to keep shut. The rail
// overlays the navbar rather than sitting under it — the navbar is `sticky` and
// travels with the page, so a bar at the top edge is what reads as "the page is
// being pulled".
//
// IT ARMS ONLY ON A PHONE, and it says so with the tab bar's own signal: the
// `has-bottom-nav` class `BottomNav` publishes on <html> (plus a coarse
// pointer). The bar mounts after hydration, so the class can arrive later than
// this component — a MutationObserver on <html>'s `class` re-arms when it does,
// and disarms when the bar leaves (a kids-only volunteer, `/auth`, `/studio`).
//
// IT IS INERT WHILE A DIALOG IS OPEN. The signal is `CueDialogProvider`'s own
// `layers` (the provider's context, the same array that drives its body-scroll
// lock and its `inert` on the app root) rather than a DOM sniff: `inert` blocks
// pointer events on DESCENDANTS, and these listeners live on `window`, so
// nothing about an open dialog would otherwise stop the pull.
//
// `preventDefault()` is called ONLY when the pull is genuinely ours —
// `dy > 8 && window.scrollY <= 0`, one finger, vertical. Everywhere else the
// native scroll must be exactly as it was; a listener that pre-empts it is how a
// page stops scrolling on a phone with nothing in the console. `brand.css` adds
// `overscroll-behavior-y: contain` on the ROOT element under the same class
// (the viewport reads the property from `<html>`, not from `<body>`) so Chrome
// Android's own pull-to-refresh does not fire on top of this one.
//
// FOUR RULES DECIDE WHETHER A TOUCH IS A PULL, all checked in `touchstart`:
//   • `window.scrollY <= 0` — **`<=`, never `===`**. During the iOS rubber band
//     `scrollY` goes NEGATIVE, so an equality test freezes the pull at exactly
//     the moment the platform is already showing overscroll.
//   • One finger. A pinch is not a pull.
//   • The touch did not start inside `[data-pull-ignore]` — the surfaces that
//     own their own gesture (`SwipeStrip`'s drag host, `AvailabilityGrid`'s
//     months while «Seleccionar fechas» is on) opt out by marking their host.
//   • No refresh is already in flight (`refreshing` is mirrored into a ref so
//     the check is synchronous — a second pull landing in the same task must
//     not queue a second `router.refresh()`).
// A fifth is decided on the FIRST move past the 8 px slop: if the finger has
// travelled further on x than on y it is a horizontal gesture, and the pull is
// locked out for the REST of that touch (one-shot, like motion's
// `dragDirectionLock`) rather than re-evaluated frame by frame.
//
// THE NON-PASSIVE LISTENER ONLY EXISTS DURING A CANDIDATE PULL. `touchstart` is
// passive and stays attached while armed; the `{ passive: false }` `touchmove`
// (plus `touchend`/`touchcancel`) is attached by `touchstart` once the four
// rules pass and removed again on end/cancel. A permanently attached non-passive
// `touchmove` costs the browser its scroll fast-path on every touch in the app,
// including the ones this component will never claim.

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { haptic } from "@/app/utils/haptics";
import { NAV_CLASS } from "@/app/components/BottomNav";
import { useCueDialogContext } from "./CueDialogProvider";
import { railHeight, shouldRefresh } from "./pullModel";

/** The pull is only claimed past this much travel — under it, it is a tap. */
const CLAIM_PX = 8;

/** The thin bar shown while the refresh is in flight. */
const REFRESHING_PX = 4;

/**
 * The rail stays in «refreshing» at least this long even when the transition
 * settles instantly (a warm route resolves in ~40 ms): a flash that disappears
 * before it is seen reads as "nothing happened", which is the one thing a
 * refresh must never look like.
 */
const MIN_REFRESHING_MS = 600;

export default function PullToRefresh() {
  const router = useRouter();
  const { layers } = useCueDialogContext();
  const dialogOpen = layers.length > 0;

  const [armed, setArmed] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [dy, setDy] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [isPending, startTransition] = useTransition();

  // The listener effect must NOT depend on `router`: `useRouter()` returns a new
  // object on some renders, and a re-run tears the listeners down MID-GESTURE —
  // the cleanup's `reset()` would drop the travel recorded by `touchmove` before
  // `touchend` could read it, and the pull would silently never refresh.
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  const startY = useRef<number | null>(null);
  const startX = useRef(0);
  const dyRef = useRef(0);
  const startedAt = useRef(0);

  // `refreshing` read synchronously from inside a listener: the state update
  // that follows a committed pull has not rendered yet when the next touch
  // arrives, and the second pull must see the refresh already in flight.
  const refreshingRef = useRef(false);
  useEffect(() => {
    refreshingRef.current = refreshing;
  }, [refreshing]);

  // Armed = the tab bar is on screen AND the pointer is coarse. Re-checked on
  // every <html> class change, because the bar publishes its class after
  // hydration and removes it on routes where it does not render.
  useEffect(() => {
    const root = document.documentElement;
    const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
    setReduced(typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    if (!coarse) return;
    const check = () => setArmed(root.classList.contains(NAV_CLASS));
    check();
    const observer = new MutationObserver(check);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const reset = useCallback(() => {
    startY.current = null;
    dyRef.current = 0;
    setDy(0);
  }, []);

  useEffect(() => {
    if (!armed || dialogOpen) return;

    // Whether the axis has already been decided in our favour for this touch.
    // `false` again on every `touchstart`; a horizontal decision ends the touch
    // outright (the listeners come off) rather than leaving a flag to re-check.
    let vertical = false;

    function onMove(event: TouchEvent) {
      if (startY.current === null) return;
      if (event.touches.length > 1) {
        reset();
        return;
      }
      const distance = (event.touches[0]?.clientY ?? 0) - startY.current;
      if (!vertical) {
        const across = (event.touches[0]?.clientX ?? 0) - startX.current;
        if (Math.abs(distance) <= CLAIM_PX && Math.abs(across) <= CLAIM_PX) return;
        if (Math.abs(across) > Math.abs(distance)) {
          // A horizontal gesture — a swipe, a carousel, a drag. Hands the whole
          // touch back, once and for good.
          detach();
          reset();
          return;
        }
        vertical = true;
      }
      if (distance > CLAIM_PX && window.scrollY <= 0) {
        // The ONE place the native gesture is taken over.
        event.preventDefault();
        dyRef.current = distance;
        setDy(distance);
        return;
      }
      if (distance <= 0) reset();
    }

    function onEnd() {
      detach();
      const distance = dyRef.current;
      reset();
      if (refreshingRef.current || !shouldRefresh(distance)) return;
      void haptic("medium");
      startedAt.current = Date.now();
      // Set BEFORE the state update: the ref is what the next `touchstart` in
      // this same task reads.
      refreshingRef.current = true;
      setRefreshing(true);
      startTransition(() => {
        routerRef.current.refresh();
      });
    }

    function onCancel() {
      detach();
      reset();
    }

    const detach = () => {
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onCancel);
    };

    const onStart = (event: TouchEvent) => {
      // Cleared FIRST, before any bail below: a second finger landing while the
      // first is mid-pull must not leave the prior pull's travel sitting in
      // `dyRef` for that second touch's own `touchend` to read — the listeners
      // for the first pull are already gone (a fresh `touchstart` only fires
      // once the previous one's `touchend`/`touchcancel` detached them), but
      // the refs they wrote were not.
      reset();
      if (refreshingRef.current) return;
      if (event.touches.length > 1 || window.scrollY > 0) return;
      const target = event.target as Element | null;
      if (target?.closest?.("[data-pull-ignore]")) return;
      const touch = event.touches[0];
      if (!touch) return;
      startY.current = touch.clientY;
      startX.current = touch.clientX ?? 0;
      dyRef.current = 0;
      vertical = false;
      window.addEventListener("touchmove", onMove, { passive: false });
      window.addEventListener("touchend", onEnd);
      window.addEventListener("touchcancel", onCancel);
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      detach();
      reset();
    };
  }, [armed, dialogOpen, reset]);

  // Collapse once the refresh has settled AND the floor has passed.
  useEffect(() => {
    if (!refreshing || isPending) return;
    const wait = Math.max(0, MIN_REFRESHING_MS - (Date.now() - startedAt.current));
    const timer = setTimeout(() => setRefreshing(false), wait);
    return () => clearTimeout(timer);
  }, [refreshing, isPending]);

  if (!armed) return null;

  const pulling = dy > CLAIM_PX && !refreshing;
  const height = refreshing ? REFRESHING_PX : railHeight(dy);

  return (
    <div
      data-pull-rail={refreshing ? "refreshing" : pulling ? "pulling" : "idle"}
      aria-hidden
      className="pointer-events-none fixed left-0 right-0 z-[60] overflow-hidden"
      style={{
        top: "env(safe-area-inset-top, 0px)",
        height: `${height}px`,
        // No transition WHILE the finger drives it — the height must track the
        // pull frame for frame; the release (and the collapse) is what eases.
        transition: pulling ? "none" : "height var(--motion-base) var(--ease-out)",
      }}
    >
      <div
        className={`h-full w-full bg-accent/70 ${refreshing && !reduced ? "pull-rail-beam" : ""}`}
      />
    </div>
  );
}
