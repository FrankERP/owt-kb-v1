"use client";

// Anchored menu (spec §4, §19.4). Replaces three hand-rolled dropdowns. Real menu
// semantics — role=menu, roving focus with arrows, Escape back to the trigger —
// which is why the avatar dropdown, which deliberately avoided role=menu while it
// had no arrow navigation, can carry it now.
//
// Positioning is `absolute` inside a `relative` wrapper: every consumer today
// anchors its menu to the trigger's corner, and a portal would break the inert
// contract of dialogs (a menu inside a dialog must stay inside its layer).

import React, { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactElement } from "react";
import Link from "next/link";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { EASE_IN, EASE_OUT, EXIT_MS, MS } from "@/app/utils/motionPresets";

const MenuCtx = createContext<{ close: (refocus: boolean) => void } | null>(null);

type TriggerProps = {
  ref: React.Ref<HTMLButtonElement>;
  "aria-haspopup": "menu";
  "aria-expanded": boolean;
  "aria-controls": string;
  onClick: (e: React.MouseEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
};

export default function Menu({
  label,
  trigger,
  align = "end",
  children,
  onOpenChange,
}: {
  label: string;
  trigger: ReactElement<Record<string, unknown>>;
  align?: "start" | "end";
  children: React.ReactNode;
  onOpenChange?: (open: boolean) => void;
}) {
  const id = useId();
  const [open, setOpenState] = useState(false);
  const [focusFirst, setFocusFirst] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const setOpen = useCallback((next: boolean) => { setOpenState(next); onOpenChange?.(next); }, [onOpenChange]);
  const close = useCallback((refocus: boolean) => { setOpen(false); if (refocus) triggerRef.current?.focus(); }, [setOpen]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) close(false); };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open, close]);

  const items = () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []);

  useEffect(() => {
    if (!open || !focusFirst) return;
    items()[0]?.focus();
    setFocusFirst(false);
  }, [open, focusFirst]);

  const onPanelKeyDown = (e: React.KeyboardEvent) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); list[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); list[list.length - 1]?.focus(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === "Tab") { close(false); }
  };

  const triggerProps = trigger.props as { onClick?: (e: React.MouseEvent) => void; onKeyDown?: (e: React.KeyboardEvent) => void };

  const triggerEl = React.cloneElement(trigger, {
    ref: triggerRef,
    "aria-haspopup": "menu",
    "aria-expanded": open,
    "aria-controls": id,
    onClick: (e: React.MouseEvent) => { triggerProps.onClick?.(e); if (!e.defaultPrevented) setOpen(!open); },
    onKeyDown: (e: React.KeyboardEvent) => {
      triggerProps.onKeyDown?.(e);
      if (e.defaultPrevented) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setOpen(true); setFocusFirst(true); }
      if (e.key === "Escape" && open) { e.preventDefault(); e.stopPropagation(); close(true); }
    },
  } satisfies Partial<TriggerProps>);

  return (
    <div ref={rootRef} className="relative inline-block">
      {triggerEl}
      <AnimatePresence>
        {open && (
          <m.div
            key="menu"
            ref={panelRef}
            id={id}
            role="menu"
            aria-label={label}
            onKeyDown={onPanelKeyDown}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1, transition: { duration: MS.base / 1000, ease: EASE_OUT } }}
            exit={{ opacity: 0, scale: 0.98, transition: { duration: EXIT_MS / 1000, ease: EASE_IN } }}
            style={{ transformOrigin: align === "end" ? "top right" : "top left" }}
            className={`absolute top-full z-50 mt-2 min-w-[13rem] overflow-hidden rounded-xl border border-surface-accent-20 bg-surface-raised-alt py-1 shadow-2xl ${align === "end" ? "right-0" : "left-0"}`}
          >
            <MenuCtx.Provider value={{ close }}>{children}</MenuCtx.Provider>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const ITEM =
  "flex w-full items-center gap-3 px-4 py-2.5 text-left font-label text-xs uppercase tracking-widest transition-colors duration-fast " +
  "text-mono-500 hover:bg-accent/10 hover:text-accent focus:outline-none focus-visible:bg-accent/10 focus-visible:text-accent aria-disabled:opacity-40 aria-disabled:pointer-events-none";

export function MenuItem({ onSelect, href, icon, danger = false, disabled = false, children }: {
  onSelect?: () => void; href?: string; icon?: React.ReactNode; danger?: boolean; disabled?: boolean; children: React.ReactNode;
}) {
  const ctx = useContext(MenuCtx);
  const cls = `${ITEM} ${danger ? "text-negative-fg hover:text-negative-fg" : ""}`;
  const pick = () => { if (disabled) return; ctx?.close(false); onSelect?.(); };
  if (href) return <Link role="menuitem" href={href} className={cls} aria-disabled={disabled || undefined} onClick={() => ctx?.close(false)} tabIndex={-1}>{icon}{children}</Link>;
  return <button type="button" role="menuitem" className={cls} aria-disabled={disabled || undefined} onClick={pick} tabIndex={-1}>{icon}{children}</button>;
}

export function MenuSeparator() {
  return <div role="separator" className="my-1 border-t border-edge-accent-subtle" />;
}

export function MenuHeader({ children }: { children: React.ReactNode }) {
  return <div role="presentation" className="border-b border-edge-accent-subtle px-4 py-3">{children}</div>;
}
