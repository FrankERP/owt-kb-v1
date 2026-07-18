"use client";

import React, { useEffect, useId, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { trapTabTarget } from "@/app/utils/focusTrap";
import { DismissReason, useCueDialogContext } from "./CueDialogProvider";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusables(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true",
  );
}

export default function CueDialog({
  open,
  title,
  label,
  children,
  onDismiss,
  restoreFocusRef,
  fallbackFocusRef,
  mode = "modal",
  size = "md",
}: {
  open: boolean;
  title?: React.ReactNode;
  label?: string;
  children: React.ReactNode;
  onDismiss: (reason: DismissReason) => void;
  restoreFocusRef?: React.RefObject<HTMLElement | null>;
  fallbackFocusRef?: React.RefObject<HTMLElement | null>;
  mode?: "modal" | "sheet";
  size?: "sm" | "md" | "lg";
}) {
  const id = useId();
  const titleId = useId();
  const shellRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const { portalNode, layers, registerLayer, isTopLayer } = useCueDialogContext();

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return registerLayer({
      id,
      opener: openerRef.current,
      restoreFocusRef,
      fallbackRef: fallbackFocusRef,
      shellRef,
    });
  }, [fallbackFocusRef, id, open, registerLayer, restoreFocusRef]);

  const top = isTopLayer(id);
  const layerIndex = layers.indexOf(id);
  const isLowerLayer = layerIndex >= 0 && layerIndex < layers.length - 1;

  useEffect(() => {
    if (!open || !top) return;
    const shell = shellRef.current;
    if (!shell) return;
    (focusables(shell)[0] ?? shell).focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTopLayer(id)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onDismiss("escape");
        return;
      }
      if (event.key !== "Tab") return;

      const items = focusables(shell);
      const activeIndex = items.indexOf(document.activeElement as HTMLElement);
      const target = trapTabTarget(items.length, activeIndex, event.shiftKey);
      if (target !== null) {
        event.preventDefault();
        items[target]?.focus({ preventScroll: true });
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [id, isTopLayer, onDismiss, open, top]);

  const sizeClass = useMemo(() => {
    if (size === "sm") return "max-w-lg";
    if (size === "lg") return "max-w-4xl";
    return "max-w-2xl";
  }, [size]);

  if (!open || !portalNode) return null;

  return createPortal(
    <div
      data-cue-layer={id}
      aria-hidden={isLowerLayer ? "true" : undefined}
      inert={isLowerLayer ? true : undefined}
      className="fixed inset-0 z-[90] flex items-start justify-center px-4 py-4 sm:items-center"
      style={{ paddingTop: "max(1rem, env(safe-area-inset-top))", paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
    >
      <button
        data-cue-backdrop=""
        type="button"
        aria-label="Cerrar"
        tabIndex={-1}
        onClick={() => top && onDismiss("backdrop")}
        className="absolute inset-0 cursor-default bg-black/68 backdrop-blur-md"
      />
      <div
        ref={shellRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={!title ? label : undefined}
        tabIndex={-1}
        className={`brand-facet-panel brand-surface relative z-10 flex w-full ${sizeClass} flex-col overflow-hidden border-brand-beam/25 shadow-2xl focus:outline-none ${
          mode === "sheet"
            ? "mt-auto max-h-[92svh] rounded-t-2xl sm:mt-0 sm:max-h-[min(86svh,52rem)] sm:rounded-2xl"
            : "max-h-[min(92svh,54rem)] rounded-2xl"
        }`}
      >
        {mode === "sheet" && (
          <div className="flex justify-center pb-1 pt-3 sm:hidden">
            <span className="h-1.5 w-12 rounded-full bg-brand-beam/25" />
          </div>
        )}
        {title && (
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-brand-beam/10 bg-brand-deck/35 px-5 py-5 sm:px-6">
            <div className="min-w-0">
              <p className="mb-1 font-label text-[9px] uppercase tracking-[0.24em] text-brand-beam/70">Cue</p>
              <h2 id={titleId} className="font-display text-2xl leading-tight text-brand-frost">
                {title}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => onDismiss("escape")}
              className="rounded-lg p-2 text-brand-steel transition-colors hover:bg-white/5 hover:text-brand-frost focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-beam/60"
              aria-label={label ? `Cerrar ${label}` : "Cerrar diálogo"}
            >
              <CloseIcon />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>,
    portalNode,
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
