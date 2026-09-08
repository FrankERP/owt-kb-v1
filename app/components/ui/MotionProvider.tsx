"use client";

// The ONE place `motion`'s feature bundle is loaded (decision A, ADR-0031).
//
// `LazyMotion` is handed a LOADER (`./motionFeatures`), not the `domAnimation`
// value directly, so the feature set ships as its own async chunk that arrives
// after hydration instead of inflating this provider's own script. Until that
// chunk resolves, an `m.*` element renders its `initial` values — which is why
// `Presence appear` (an instance that mounts already-shown and must still
// animate in) must never be used above the fold: the M0b rule. `strict` throws
// in development if any file renders a full `motion.*` component — that is the
// runtime twin of motionImportBoundary.test.ts.
//
// `reducedMotion="user"` makes every `m.*` honour prefers-reduced-motion by
// dropping transform animations to instant while keeping opacity; brand.css's global
// rule covers the CSS side. Together the app never becomes static — it becomes calm.

import { LazyMotion, MotionConfig } from "motion/react";

export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={() => import("./motionFeatures").then((mod) => mod.default)} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
