"use client";

import { useEffect, useRef } from "react";
import { trapTabTarget } from "./focusTrap";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * WAI-ARIA dialog focus management. When `active` becomes true, moves focus into
 * the returned container ref, traps Tab / Shift+Tab within it, and restores focus
 * to the previously-focused element when it deactivates or unmounts.
 *
 * Attach the ref to the dialog container and give that container tabIndex={-1}
 * so it can receive focus as a fallback when it holds no focusable children.
 */
export function useFocusTrap<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (!container) return;

    const prevFocused = document.activeElement as HTMLElement | null;

    const focusables = (): HTMLElement[] =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );

    // Move focus into the dialog.
    (focusables()[0] ?? container).focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusables();
      const activeIndex = items.indexOf(document.activeElement as HTMLElement);
      const target = trapTabTarget(items.length, activeIndex, e.shiftKey);
      if (target !== null) {
        e.preventDefault();
        items[target]?.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      // Restore focus to whatever opened the dialog.
      prevFocused?.focus?.();
    };
  }, [active]);

  return ref;
}
