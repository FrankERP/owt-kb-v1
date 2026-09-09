"use client";
// The gallery mounts no Provider (themeGallery.test.ts pins that), so its fixtures
// had no motion features: an m.* element would sit at its initial values forever.
// This wrapper loads the features synchronously (a baseline capture must not race
// a chunk) and, under data-motion="off", skips animations so every frame is final.
import { LazyMotion, MotionGlobalConfig, domMax } from "motion/react";
import { useEffect } from "react";

export default function GalleryMotion({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    MotionGlobalConfig.skipAnimations = document.documentElement.dataset.motion === "off";
  }, []);
  return <LazyMotion features={domMax} strict>{children}</LazyMotion>;
}
