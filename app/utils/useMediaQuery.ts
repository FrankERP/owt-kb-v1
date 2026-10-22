"use client";

// The ONE media-query hook: `useMediaQuery("(min-width: 1024px)")` is true while
// the viewport matches, false on the server and before hydration (so a server
// render never guesses a width), and re-renders on a change. A component
// reads it only for behaviour CSS cannot express — which sections START open
// (`TeamSections`) — never for layout, which stays in Tailwind's breakpoints.
//
// `useSyncExternalStore` rather than a state + effect: no render with a stale
// answer after the first paint, and no `react-hooks/set-state-in-effect` lint.

import { useCallback, useSyncExternalStore } from "react";

const noop = () => {};

function mediaList(query: string): MediaQueryList | null {
  if (!query || typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(query);
}

/** True while `query` matches. An empty query never matches (a caller's "off" value). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = mediaList(query);
      if (!list) return noop;
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => mediaList(query)?.matches ?? false,
    () => false,
  );
}
