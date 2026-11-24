"use client";
// The ONE media-query hook: `useSyncExternalStore` over `window.matchMedia`, so a
// query answers the same on every render and re-renders on the `change` event.
//
// The SERVER snapshot is `false`, and so is a window without `matchMedia` (jsdom
// without a stub, `installMotionTestEnv`'s stub). Every consumer therefore puts the
// phone-, touch- or narrow-only path behind `true`: the server markup and every
// existing test render the plain path, and the first client render matches the
// server (no hydration mismatch) before the real answer arrives.
//
// For a query a RENDER depends on: `Select`'s pointer tests and `PlannerGrid`'s
// candidates sheet. A value read in render by hand and never subscribed goes stale
// on rotation and reads differently on the server — that is what this replaces. A
// one-shot `matchMedia` read at EVENT time (`prefers-reduced-motion` when a pull, a
// slide or a blackout starts: `PullToRefresh`, `SlidingIndicator`, `Blackout`, the
// Integridad and Propuestas panels) decides one animation as it begins and is not a
// render input, so those stay plain reads.
import { useSyncExternalStore } from "react";

function mql(query: string) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(query);
}

const subscribers = new Map<string, (onChange: () => void) => () => void>();
const snapshots = new Map<string, () => boolean>();

/** One stable subscribe/snapshot pair per query, so `useSyncExternalStore` never resubscribes per render. */
function entry(query: string) {
  let subscribe = subscribers.get(query);
  if (!subscribe) {
    subscribe = (onChange: () => void) => {
      const q = mql(query);
      q?.addEventListener?.("change", onChange);
      return () => q?.removeEventListener?.("change", onChange);
    };
    subscribers.set(query, subscribe);
    snapshots.set(query, () => mql(query)?.matches ?? false);
  }
  return { subscribe, snapshot: snapshots.get(query)! };
}

const serverSnapshot = () => false;

/** True while `query` matches; `false` on the server and wherever `matchMedia` is absent. */
export function useMediaQuery(query: string): boolean {
  const { subscribe, snapshot } = entry(query);
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
