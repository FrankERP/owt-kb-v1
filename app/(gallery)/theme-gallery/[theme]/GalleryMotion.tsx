"use client";
// The gallery mounts no Provider (themeGallery.test.ts pins that), so its fixtures
// had no motion features: an m.* element would sit at its initial values forever.
// This wrapper loads the features synchronously (a baseline capture must not race
// a chunk) and, under data-motion="off", skips animations so every frame is final.
import { LazyMotion, MotionGlobalConfig, domMax } from "motion/react";
import { useLayoutEffect } from "react";

export default function GalleryMotion({ children }: { children: React.ReactNode }) {
  // `useLayoutEffect`, not `useEffect`, and the difference is the whole point of the
  // `#motion` branch: the attribute has to be gone BEFORE the first paint of the
  // children's enter animations. Children's effects run before the parent's, but
  // `Presence`/`CueDialog` animate from the NEXT frame, so this layout effect lands in
  // time — `motion-on.spec.ts` captures t=0 and t=end and would collapse to two
  // identical final frames if it did not.
  useLayoutEffect(() => {
    const root = document.documentElement;
    // `#motion` opts ONE page into real animation so a spec can watch the sheet enter.
    // Every other gallery page keeps `data-motion="off"` and renders a final frame,
    // which is what makes a screenshot baseline comparable at all.
    if (window.location.hash === "#motion") root.removeAttribute("data-motion");
    MotionGlobalConfig.skipAnimations = root.dataset.motion === "off";
  }, []);
  return <LazyMotion features={domMax} strict>{children}</LazyMotion>;
}
