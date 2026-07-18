"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

type DismissReason = "escape" | "backdrop";

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

  useEffect(() => {
    const root = appRootRef.current;
    if (layers.length > 0) {
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
      return;
    }

    if (originalOverflow.current !== null) {
      document.body.style.overflow = originalOverflow.current;
      originalOverflow.current = null;
    }

    if (root && originalAppAttrs.current) {
      if (originalAppAttrs.current.ariaHidden === null) root.removeAttribute("aria-hidden");
      else root.setAttribute("aria-hidden", originalAppAttrs.current.ariaHidden);
      root.inert = originalAppAttrs.current.inert;
      originalAppAttrs.current = null;
    }
  }, [layers.length]);

  useEffect(() => {
    return () => {
      if (originalOverflow.current !== null) document.body.style.overflow = originalOverflow.current;
      const root = appRootRef.current;
      if (root && originalAppAttrs.current) {
        if (originalAppAttrs.current.ariaHidden === null) root.removeAttribute("aria-hidden");
        else root.setAttribute("aria-hidden", originalAppAttrs.current.ariaHidden);
        root.inert = originalAppAttrs.current.inert;
      }
      layersRef.current = [];
      setLayers([]);
    };
  }, []);

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
  }, []);

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
