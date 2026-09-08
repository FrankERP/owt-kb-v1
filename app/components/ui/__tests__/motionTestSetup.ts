// jsdom has no matchMedia and no layout, so: stub matchMedia (motion reads it for
// reducedMotion="user") and skip animations globally so assertions see FINAL state
// synchronously. Import and call once at the top of any primitive test.
import { MotionGlobalConfig } from "motion/react";

export function installMotionTestEnv() {
  if (typeof window !== "undefined" && !window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
  MotionGlobalConfig.skipAnimations = true;
}
