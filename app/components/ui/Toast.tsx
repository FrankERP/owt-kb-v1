"use client";

// One toast stack for the app (spec §4, §19.4). Replaces the hand-rolled
// `fixed bottom-6` divs and keeps useTransientValue's two semantics: a new toast
// restarts the clock, and `hold` persists until something dismisses it.
//
// The viewport portals to its own node beside the dialog root, so a toast raised
// from inside a dialog is visible and readable while the app root is inert.
// z-[95] sits above dialogs (z-[90]) on purpose: "Guardado" after a dialog save
// must be seen. No `appear`-style trap here — toasts are only ever created after
// mount, and their exit is what needs motion.
//
// `initial` is NOT suppressed (no `initial={false}`) even though a toast can be
// created moments after hydration: a toast needs a user action first (a save, a
// dismiss, an error), and MotionProvider's feature chunk loads right behind
// hydration with nothing else competing for it, so by the time any toast fires
// the chunk has arrived and the enter animation actually plays. If that stops
// being true (a toast fired synchronously on mount, for instance) this needs a
// second look — see Task 5's coordinator ruling.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import Button from "./Button";
import { EASE_IN, EASE_OUT, EXIT_MS, MS } from "@/app/utils/motionPresets";

export type ToastTone = "ok" | "error" | "info";
export type ToastOptions = {
  message: string;
  tone?: ToastTone;
  duration?: number;
  hold?: boolean;
  action?: { label: string; onClick: () => void };
};
type ToastRecord = ToastOptions & { id: string; tone: ToastTone };

const MAX_VISIBLE = 3;
const DEFAULT_MS = 3000;

const ToastContext = createContext<{ toast: (o: ToastOptions) => string; dismiss: (id: string) => void } | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastRecord[]>([]);
  const [node, setNode] = useState<HTMLElement | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const seq = useRef(0);

  useEffect(() => {
    const el = document.createElement("div");
    el.setAttribute("data-toast-root", "");
    document.body.appendChild(el);
    setNode(el);
    return () => {
      el.remove();
      setNode(null);
      timers.current.forEach(clearTimeout);
      timers.current.clear();
    };
  }, []);

  const dismiss = useCallback((id: string) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    setItems((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const toast = useCallback((o: ToastOptions) => {
    const id = `toast-${++seq.current}`;
    const record: ToastRecord = { ...o, id, tone: o.tone ?? "ok" };
    setItems((prev) => {
      // Same message again: replace it (restart the clock), like useTransientValue's show.
      const kept = prev.filter((x) => x.message !== o.message);
      const next = [...kept, record];
      return next.slice(Math.max(0, next.length - MAX_VISIBLE));
    });
    if (!o.hold) {
      timers.current.set(id, setTimeout(() => dismiss(id), o.duration ?? DEFAULT_MS));
    }
    return id;
  }, [dismiss]);

  // Clear timers of toasts that left the list without dismiss() (replaced or evicted).
  useEffect(() => {
    const live = new Set(items.map((x) => x.id));
    for (const [id, t] of timers.current) if (!live.has(id)) { clearTimeout(t); timers.current.delete(id); }
  }, [items]);

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {node && createPortal(<ToastViewport items={items} onDismiss={dismiss} />, node)}
    </ToastContext.Provider>
  );
}

function ToastViewport({ items, onDismiss }: { items: ToastRecord[]; onDismiss: (id: string) => void }) {
  const lastError = [...items].reverse().find((t) => t.tone === "error");
  return (
    <div
      role="status"
      aria-live="polite"
      aria-relevant="additions"
      className="pointer-events-none fixed inset-x-0 z-[95] flex flex-col items-center gap-2 px-4"
      style={{ bottom: "calc(1.5rem + env(safe-area-inset-bottom) + var(--bottom-nav-h, 0px))" }}
    >
      {/* A region that exists before its text is what gets announced. Errors are
          mirrored into an assertive region that is likewise always mounted. */}
      <span role="alert" className="sr-only">{lastError?.message ?? ""}</span>
      <AnimatePresence>
        {items.map((t) => (
          <m.div
            key={t.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transition: { duration: MS.base / 1000, ease: EASE_OUT } }}
            exit={{ opacity: 0, transition: { duration: EXIT_MS / 1000, ease: EASE_IN } }}
            className={`pointer-events-auto flex max-w-md items-center gap-3 rounded-xl border bg-surface-raised-alt px-5 py-3 font-label text-xs uppercase tracking-widest text-ink shadow-xl ${
              t.tone === "error" ? "border-negative-border/60" : "border-accent/30"
            }`}
          >
            <span className="min-w-0">{t.message}</span>
            {t.action && (
              <Button variant="ghost" size="sm" onClick={() => { t.action?.onClick(); onDismiss(t.id); }}>
                {t.action.label}
              </Button>
            )}
          </m.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
