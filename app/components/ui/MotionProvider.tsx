"use client";

// The ONE place `motion`'s feature bundle is loaded (decision A, ADR-0031).
//
// `LazyMotion` + `domAnimation` keeps the shared chunk small: primitives render
// `m.*` elements, which are inert until this provider supplies the features. `strict`
// throws in development if any file renders a full `motion.*` component — that is the
// runtime twin of motionImportBoundary.test.ts.
//
// `reducedMotion="user"` makes every `m.*` honour prefers-reduced-motion by
// dropping transform animations to instant while keeping opacity; brand.css's global
// rule covers the CSS side. Together the app never becomes static — it becomes calm.

import { LazyMotion, MotionConfig, domAnimation } from "motion/react";

export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
