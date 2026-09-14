"use client";

// The stage vocabulary's exit (spec §12.8), used once: sign-out. A plain CSS
// transition, not `motion` — this fires from a synchronous click handler and
// outlives whatever component rendered the trigger (the overlay is appended to
// `document.body`, never removed by the happy path — the redirect replaces the
// document). `motion` stays reserved for elements that live inside React's tree;
// this one deliberately doesn't.
//
// Call order, everywhere: `clearThemeMirror(); const b = blackout(); try { await
// b.done; await signOut(...); } catch { b.cancel(); }` — see `themePref.ts`'s
// header for why the theme clear comes first. `cancel()` exists so a `signOut`
// that throws never leaves the page permanently black.

export type BlackoutHandle = { done: Promise<void>; cancel: () => void };

const FALLBACK_MS = 400;

let liveHandle: BlackoutHandle | null = null;
let liveEl: HTMLDivElement | null = null;

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Idempotent while an overlay is already live: a second call returns the same
 * handle rather than stacking a second `div`.
 */
export function blackout(): BlackoutHandle {
  if (liveHandle) return liveHandle;

  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  Object.assign(el.style, {
    position: "fixed",
    inset: "0",
    zIndex: "100",
    background: "rgb(var(--surface-base-rgb))",
    opacity: "0",
    pointerEvents: "none",
    transition: "opacity var(--motion-slow) var(--ease-in)",
  });
  document.body.appendChild(el);
  liveEl = el;

  const cancel = () => {
    el.remove();
    if (liveEl === el) liveEl = null;
    if (liveHandle?.cancel === cancel) liveHandle = null;
  };

  let done: Promise<void>;
  if (prefersReducedMotion()) {
    el.style.opacity = "1";
    done = Promise.resolve();
  } else {
    done = new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        el.removeEventListener("transitionend", onTransitionEnd);
        clearTimeout(timer);
        resolve();
      };
      const onTransitionEnd = (e: TransitionEvent) => {
        if (e.target === el && e.propertyName === "opacity") finish();
      };
      el.addEventListener("transitionend", onTransitionEnd);
      const timer = setTimeout(finish, FALLBACK_MS);
      // Force a frame between the initial `opacity: 0` and the transition
      // target so the browser has something to animate from — setting both
      // in the same tick would collapse the transition to a no-op.
      void el.offsetHeight;
      el.style.opacity = "1";
    });
  }

  const handle: BlackoutHandle = { done, cancel };
  liveHandle = handle;
  return handle;
}
