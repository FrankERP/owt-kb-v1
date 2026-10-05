"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

// "drag" is a sheet flicked closed on a phone (CueDialog owns the gesture); it
// means the same thing to a consumer as "backdrop" — a dismissal the user asked
// for without committing to anything.
type DismissReason = "escape" | "backdrop" | "drag";

interface LayerRecord {
  id: string;
  opener: HTMLElement | null;
  restoreFocusRef?: React.RefObject<HTMLElement | null>;
  fallbackRef?: React.RefObject<HTMLElement | null>;
  shellRef?: React.RefObject<HTMLElement | null>;
}

interface CueDialogContextValue {
  portalNode: HTMLElement | null;
  appRootRef: React.RefObject<HTMLDivElement | null>;
  layers: string[];
  registerLayer: (layer: LayerRecord) => () => void;
  isTopLayer: (id: string) => boolean;
  focusInsideLayer: (id: string) => void;
}

const CueDialogContext = createContext<CueDialogContextValue | null>(null);

export function useCueDialogContext() {
  const ctx = useContext(CueDialogContext);
  if (!ctx) throw new Error("CueDialog must be rendered inside CueDialogProvider");
  return ctx;
}

function focusTarget(target: HTMLElement | null | undefined) {
  if (!target || !target.isConnected) return false;
  if (target.hasAttribute("disabled") || target.getAttribute("aria-disabled") === "true") return false;
  target.focus({ preventScroll: true });
  return document.activeElement === target;
}

function findFirstFocusable(root: HTMLElement) {
  return root.querySelector<HTMLElement>(
    [
      "a[href]",
      "button:not([disabled])",
      "textarea:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      '[tabindex]:not([tabindex="-1"])',
    ].join(","),
  );
}

export function CueDialogProvider({ children }: { children: React.ReactNode }) {
  const appRootRef = useRef<HTMLDivElement>(null);
  const portalRef = useRef<HTMLElement | null>(null);
  const layersRef = useRef<LayerRecord[]>([]);
  const [layers, setLayers] = useState<string[]>([]);
  const [portalNode, setPortalNode] = useState<HTMLElement | null>(null);
  const originalOverflow = useRef<string | null>(null);
  const originalAppAttrs = useRef<{ ariaHidden: string | null; inert: boolean } | null>(null);

  useEffect(() => {
    const node = document.createElement("div");
    node.setAttribute("data-cue-dialog-root", "");
    document.body.appendChild(node);
    portalRef.current = node;
    setPortalNode(node);
    return () => {
      node.remove();
      portalRef.current = null;
      setPortalNode(null);
    };
  }, []);

  // The page lock: body scroll off, app root `aria-hidden` + `inert`. Both
  // halves are idempotent and keep what they found, so a dialog raised over a
  // surface that already locked the body (the full-screen planner) hands that
  // lock back intact.
  const engageLocks = useCallback(() => {
    const root = appRootRef.current;
    if (originalOverflow.current === null) originalOverflow.current = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    if (root && originalAppAttrs.current === null) {
      originalAppAttrs.current = {
        ariaHidden: root.getAttribute("aria-hidden"),
        inert: root.inert,
      };
    }
    if (root) {
      root.setAttribute("aria-hidden", "true");
      root.inert = true;
    }
  }, []);

  const releaseLocks = useCallback(() => {
    if (originalOverflow.current !== null) {
      document.body.style.overflow = originalOverflow.current;
      originalOverflow.current = null;
    }

    const root = appRootRef.current;
    if (root && originalAppAttrs.current) {
      if (originalAppAttrs.current.ariaHidden === null) root.removeAttribute("aria-hidden");
      else root.setAttribute("aria-hidden", originalAppAttrs.current.ariaHidden);
      root.inert = originalAppAttrs.current.inert;
      originalAppAttrs.current = null;
    }
  }, []);

  // Reconciles the lock with the registered layers after every change. It is the
  // release that does not wait on a frame (a hidden tab runs none), and it reads
  // `layersRef`. Keyed on `[layers]`, not `[layers.length]`: if a release lands
  // between a close and an open whose state updates React batches together, the
  // COUNT never changes, and only a run on the layers themselves re-takes the
  // lock. It moves no focus.
  useEffect(() => {
    if (layersRef.current.length > 0) engageLocks();
    else releaseLocks();
  }, [layers, engageLocks, releaseLocks]);

  useEffect(() => {
    return () => {
      releaseLocks();
      layersRef.current = [];
      setLayers([]);
    };
  }, [releaseLocks]);

  const focusInsideLayer = useCallback((id: string) => {
    const layer = layersRef.current.find((item) => item.id === id);
    const shell = layer?.shellRef?.current;
    if (!shell) return;
    (findFirstFocusable(shell) ?? shell).focus({ preventScroll: true });
  }, []);

  const registerLayer = useCallback((layer: LayerRecord) => {
    const existing = layersRef.current.filter((item) => item.id !== layer.id);
    layersRef.current = [...existing, layer];
    setLayers(layersRef.current.map((item) => item.id));

    return () => {
      const before = layersRef.current;
      const closing = before.find((item) => item.id === layer.id) ?? layer;
      const next = before.filter((item) => item.id !== layer.id);
      layersRef.current = next;
      setLayers(next.map((item) => item.id));

      const parent = next[next.length - 1];
      window.requestAnimationFrame(() => {
        // With no layer left, the frame lifts the lock itself before it moves
        // focus. The effect also releases it, after React commits `setLayers`,
        // but nothing orders that commit against this frame: when the frame won,
        // the app root was still `inert`, a browser ignored every `focus()`
        // below, and focus fell to <body>. Checked HERE, not in the unregister:
        // when one dialog unmounts and another mounts in the same commit, the
        // newcomer registers in that same passive flush, before any frame — a
        // release in the unregister would unlock the page under it until the
        // provider re-rendered. A nested close keeps the lock: the parent is
        // still registered, and its shell lives in the portal, outside the root.
        if (layersRef.current.length === 0) releaseLocks();

        if (parent) {
          const parentFallback = parent.fallbackRef?.current ?? parent.shellRef?.current ?? null;
          if (focusTarget(parentFallback)) return;
          if (parent.shellRef?.current) focusTarget(findFirstFocusable(parent.shellRef.current) ?? parent.shellRef.current);
          return;
        }

        const explicit = closing.restoreFocusRef?.current ?? null;
        if (focusTarget(explicit)) return;
        if (focusTarget(closing.opener)) return;
        focusTarget(document.querySelector<HTMLElement>("main[data-route-main]"));
      });
    };
    // `releaseLocks` is stable (`useCallback` with no deps), so `registerLayer`
    // keeps one identity for the provider's life. It must: CueDialog's layer
    // registration depends on it, and a new identity would re-run that effect —
    // whose cleanup is the unregister — and throw focus out of an open dialog
    // (ADR-0034).
  }, [releaseLocks]);

  const isTopLayer = useCallback((id: string) => layersRef.current[layersRef.current.length - 1]?.id === id, []);

  const value = useMemo(
    () => ({ portalNode, appRootRef, layers, registerLayer, isTopLayer, focusInsideLayer }),
    [portalNode, layers, registerLayer, isTopLayer, focusInsideLayer],
  );

  return (
    <CueDialogContext.Provider value={value}>
      <div ref={appRootRef} data-cue-app-root="">
        {children}
      </div>
    </CueDialogContext.Provider>
  );
}

export type { DismissReason };
