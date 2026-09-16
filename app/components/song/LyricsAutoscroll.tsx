"use client";

// Hands-free lyrics (R4, ruling 6): the Letra section scrolls itself at the
// song's own tempo, so a player holding an instrument never has to reach for the
// page. The model is deliberately the WINDOW — `window.scrollTo(0, y)` on every
// frame — and never a transform on the section: a transformed ancestor becomes
// the containing block for every `position: fixed` descendant (ADR-0031), and
// the audio transport, the toasts and the song FAB all live inside this route.
//
// The clock is `requestAnimationFrame`, never `setInterval`: a timer keeps
// firing in a backgrounded tab and the page returns having leapt. `dt` is the
// gap between two real frame timestamps, clamped to 50 ms so even a dropped
// frame moves the page by at most one slow step.
//
// Speed comes from `autoscrollPxPerSecond` (neutral, shared with the tempo
// pill): the section's measured height divided by how long the lyrics take at
// `BEATS_PER_LINE` per line, clamped to a readable band.

import { useEffect, useState } from "react";
import Button from "@/app/components/ui/Button";
import { autoscrollPxPerSecond } from "@/app/utils/practice";
import { haptic } from "@/app/utils/haptics";

/** Largest gap a single frame may advance, ms — a background tab must not leap. */
const MAX_FRAME_MS = 50;
/** Frames after a resume that re-seed from `window.scrollY` — iOS momentum keeps
 *  moving the page after the finger is gone, and `scrollend` is not everywhere. */
const RESEED_FRAMES = 3;

export default function LyricsAutoscroll({
  targetId,
  bpm,
  lines,
}: {
  targetId: string;
  bpm: number | null;
  lines: number;
}) {
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!running) return;
    const el = document.getElementById(targetId);
    if (!el) {
      setRunning(false);
      return;
    }

    // Measured once, at start: the section's height does not change while it
    // scrolls, and re-measuring per frame would be a layout read per frame.
    const speed = autoscrollPxPerSecond(el.offsetHeight, lines, bpm);
    let y = window.scrollY;
    let last: number | null = null;
    let frame: number | null = null;
    let finished = false;
    let reseed = 0;
    let touching = false;
    let userScrolled = false;

    const step = (now: number) => {
      // Momentum outlives the finger, so the first frames after a resume take
      // the page's own position rather than the offset the pause froze. Only
      // the first few: reading `scrollY` every frame would stall at low speeds,
      // where a sub-pixel advance rounds back to the same integer scroll offset.
      if (reseed > 0) {
        reseed -= 1;
        y = window.scrollY;
      }
      // The first frame has no predecessor to subtract — it only seeds the
      // clock, so the loop never starts with an arbitrary jump.
      const dt = last === null ? 0 : Math.min(MAX_FRAME_MS, now - last);
      last = now;
      y += (speed * dt) / 1000;
      window.scrollTo(0, y);

      if (el.getBoundingClientRect().bottom <= window.innerHeight) {
        frame = null;
        finished = true;
        setRunning(false);
        return;
      }
      frame = requestAnimationFrame(step);
    };

    const pause = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      last = null;
    };
    const resume = () => {
      if (finished || frame !== null) return;
      // Re-seed from where the finger actually left the page, never from the
      // internal offset the pause froze.
      y = window.scrollY;
      last = null;
      reseed = RESEED_FRAMES;
      frame = requestAnimationFrame(step);
    };
    // A wheel is a mouse taking over, and there is no matching "lift" event to
    // resume on — so it ends the run honestly instead of leaving the control
    // reading «Detener» over a page that no longer moves.
    const stop = () => {
      pause();
      setRunning(false);
    };
    // Mouse input hands the page back only through `wheel`: a scrollbar drag or
    // a keyboard scroll is not intercepted at all. Phone-first by design — the
    // control exists for hands that are holding an instrument.
    // A flick promotes to a scroll and the page keeps moving after the lift, so
    // where the browser reports the end of a scroll we wait for THAT rather
    // than resuming into the momentum. A lift that scrolled nothing (a tap)
    // gets no `scrollend`, so it resumes immediately.
    const hasScrollEnd = "onscrollend" in window;

    const down = () => {
      touching = true;
      userScrolled = false;
      pause();
    };
    // A cancelled touch resumes like a lift: `touchcancel` fires instead of
    // `touchend` when the gesture is taken over, and without this the pill sits
    // on «Detener» over a page that stopped moving.
    const up = () => {
      touching = false;
      if (!hasScrollEnd || !userScrolled) resume();
    };
    // Mouse input hands the page back only through `wheel`: a scrollbar drag or
    // a keyboard scroll is not intercepted at all. Phone-first by design — the
    // control exists for hands that are holding an instrument.
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") down();
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") up();
    };
    // Only the user's scrolls land here: while paused the loop writes none.
    const onScroll = () => {
      if (touching) userScrolled = true;
    };
    const onScrollEnd = () => {
      if (!touching) resume();
    };

    frame = requestAnimationFrame(step);
    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchend", up, { passive: true });
    window.addEventListener("touchcancel", up, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("pointerup", onPointerUp, { passive: true });
    window.addEventListener("pointercancel", onPointerUp, { passive: true });
    window.addEventListener("wheel", stop, { passive: true });
    if (hasScrollEnd) {
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("scrollend", onScrollEnd, { passive: true });
    }

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      window.removeEventListener("touchstart", down);
      window.removeEventListener("touchend", up);
      window.removeEventListener("touchcancel", up);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("wheel", stop);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("scrollend", onScrollEnd);
    };
  }, [running, targetId, bpm, lines]);

  return (
    <Button
      variant="pill"
      size="sm"
      active={running}
      className="min-h-[44px]"
      onClick={() => {
        void haptic("light");
        setRunning((on) => !on);
      }}
    >
      {running ? "Detener" : "Autoscroll"}
    </Button>
  );
}
