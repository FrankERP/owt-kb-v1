"use client";

// A horizontal strip's "there is more to the right" hint, in ONE place: the hook
// reads whether the scroller can still scroll right (on mount, scroll, resize and
// a change of `count`), and `SCROLL_FADE_RIGHT` is the class the strip wears
// while it can — a MASK on the scroller, never a colour painted over it. That
// distinction is what shipped broken once on `AdminRail`: every member page is
// `.brand-atmosphere` (`surface-base` PLUS accent radials), so an opaque
// `from-surface-base` overlay could never match what is behind it and read on
// a 390px light-theme phone as a flat grey block with hard edges rather than as
// a fade. A mask fades the CONTENT and leaves the page painting whatever it
// paints, in both themes, with no token to keep in sync. Unprefixed and
// `-webkit-` both, because this repo's PostCSS runs Tailwind alone — there is
// no autoprefixer to add the second one. Shared by `AdminRail`'s phone strip and
// the song page's `SectionNav` (design pass E, 2026-10-22).
//
// Applied only while `more` is true: otherwise the mask would eat the last tab,
// which is exactly where the active one lands when it is last.

import { useEffect, useState } from "react";

export const SCROLL_FADE_RIGHT =
  "[-webkit-mask-image:linear-gradient(to_left,transparent,black_2rem)] " +
  "[mask-image:linear-gradient(to_left,transparent,black_2rem)]";

export function useScrollableRight(ref: React.RefObject<HTMLElement | null>, count: number): boolean {
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    read();
    el.addEventListener("scroll", read, { passive: true });
    window.addEventListener("resize", read);
    return () => {
      el.removeEventListener("scroll", read);
      window.removeEventListener("resize", read);
    };
  }, [ref, count]);
  return more;
}
