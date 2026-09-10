"use client";
// app/components/LibraryLetterRail.tsx — the /biblioteca A–Z rail (F3).
//
// An iOS-style INDEX BAR, not a list of links: it reports where the list is
// (`active`, driven by the caller's IntersectionObserver over the headings) and
// it scrubs — drag a finger down the rail and the list follows under it.
//
// Plain <button>s by the recorded row exemption (spec Part X): bare tap targets
// in an index rail, not the Button primitive's chrome.
import { useCallback, useRef, useState } from "react";
import { haptic } from "@/app/utils/haptics";

export type LibraryLetterRailProps = {
  letters: string[];
  /** The letter whose section is in view. "" while none is. */
  active: string;
  onJump: (letter: string, behavior: ScrollBehavior) => void;
};

export default function LibraryLetterRail({ letters, active, onJump }: LibraryLetterRailProps) {
  const railRef = useRef<HTMLElement | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  // The scrub reads a REF, never the state, because pointermove must see the
  // value pointerdown just wrote without waiting on a render; the state exists
  // only so the pill can paint.
  const scrubbingRef = useRef(false);
  const lastLetter = useRef("");

  /** Which letter sits under `clientY` — arithmetic on the rail's own box, so a
   *  finger past either end clamps to the first/last letter instead of missing. */
  const letterAt = useCallback(
    (clientY: number): string => {
      const el = railRef.current;
      if (!el || letters.length === 0) return "";
      const rect = el.getBoundingClientRect();
      const step = rect.height / letters.length;
      const i = step > 0 ? Math.floor((clientY - rect.top) / step) : 0;
      return letters[Math.min(letters.length - 1, Math.max(0, i))];
    },
    [letters],
  );

  /** `force` is for a discrete activation (a keypress); the scrub stream passes
   *  it false so dragging within one letter's band does not re-fire per pixel. */
  const select = useCallback(
    (letter: string, behavior: ScrollBehavior, force = false) => {
      if (!letter || (!force && letter === lastLetter.current)) return;
      lastLetter.current = letter;
      void haptic("selection");
      onJump(letter, behavior);
    },
    [onJump],
  );

  const endScrub = () => {
    scrubbingRef.current = false;
    setScrubbing(false);
  };

  return (
    // AFTER the sections in DOM order, `absolute` inside the list's `relative`
    // wrapper — `right-1`, not `right-0`, so the rail clears the page's own
    // scrollbar gutter instead of sitting under it. `50vh` on a `sticky` box
    // resolves against the scrollport, same as a percentage would, and states
    // the viewport-relative intent (vertical centre of the SCROLLPORT) plainly.
    <div className="absolute inset-y-0 right-1">
      <nav
        ref={railRef}
        aria-label="Índice alfabético"
        data-scrubbing={scrubbing || undefined}
        // `touch-none` so a drag along the rail scrubs instead of scrolling the
        // page underneath it. The pill only paints while a finger is down, so
        // the rail stays invisible chrome at rest.
        className={
          "sticky top-[50vh] flex -translate-y-1/2 touch-none flex-col items-center py-1 " +
          "transition-colors duration-fast ease-out-brand " +
          "data-[scrubbing]:rounded-full data-[scrubbing]:bg-surface-base/80 data-[scrubbing]:backdrop-blur-sm"
        }
        onPointerDown={(e) => {
          scrubbingRef.current = true;
          lastLetter.current = "";
          setScrubbing(true);
          // jsdom has no pointer capture, and a browser that refuses it still
          // scrubs — the rail reads coordinates, not the event's target.
          try {
            railRef.current?.setPointerCapture?.(e.pointerId);
          } catch {
            /* capture is an optimisation, never a requirement */
          }
          // A plain tap animates; the first move after this switches to instant.
          select(letterAt(e.clientY), "smooth");
        }}
        onPointerMove={(e) => {
          if (!scrubbingRef.current) return;
          select(letterAt(e.clientY), "auto");
        }}
        onPointerUp={endScrub}
        onPointerCancel={endScrub}
        onLostPointerCapture={endScrub}
      >
        {letters.map((l) => (
          <button
            key={l}
            type="button"
            // Pointer taps are already served by the rail's own pointerdown, and
            // the click that follows one carries `detail >= 1`. `detail === 0`
            // is a keyboard activation — the one case with no pointerdown behind
            // it, and the reason this handler exists at all.
            onClick={(e) => {
              if (e.detail === 0) select(l, "smooth", true);
            }}
            // iOS index-bar shape — targets under 24 px by ruling (R1),
            // adjacent letters need the density.
            className={`px-2 py-0.5 font-label text-[10px] focus:outline-none focus-visible:text-accent ${
              l === active ? "font-semibold text-accent" : "text-ink-dim hover:text-accent"
            }`}
            aria-current={l === active ? "true" : undefined}
            aria-label={`Ir a la letra ${l}`}
          >
            {l}
          </button>
        ))}
      </nav>
    </div>
  );
}
