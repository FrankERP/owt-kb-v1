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
// `dy > 8 && window.scrollY === 0`, one finger. Everywhere else the native
// scroll must be exactly as it was; a listener that pre-empts it is how a page
// stops scrolling on a phone with nothing in the console. `brand.css` adds
// `overscroll-behavior-y: contain` under the same class so Chrome Android's own
// pull-to-refresh does not fire on top of this one.

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
  const dyRef = useRef(0);
  const startedAt = useRef(0);

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

    const onStart = (event: TouchEvent) => {
      if (event.touches.length > 1 || window.scrollY !== 0) {
        startY.current = null;
        return;
      }
      startY.current = event.touches[0]?.clientY ?? null;
      dyRef.current = 0;
    };

    const onMove = (event: TouchEvent) => {
      if (startY.current === null) return;
      if (event.touches.length > 1) {
        reset();
        return;
      }
      const distance = (event.touches[0]?.clientY ?? 0) - startY.current;
      if (distance > CLAIM_PX && window.scrollY === 0) {
        // The ONE place the native gesture is taken over.
        event.preventDefault();
        dyRef.current = distance;
        setDy(distance);
        return;
      }
      if (distance <= 0) reset();
    };

    const onEnd = () => {
      const distance = dyRef.current;
      reset();
      if (!shouldRefresh(distance)) return;
      void haptic("medium");
      startedAt.current = Date.now();
      setRefreshing(true);
      startTransition(() => {
        routerRef.current.refresh();
      });
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", reset);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", reset);
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
