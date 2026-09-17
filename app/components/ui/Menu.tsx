"use client";

// Anchored menu (spec §4, §19.4). Replaces three hand-rolled dropdowns. Real menu
// semantics — role=menu, roving focus with arrows, Escape back to the trigger —
// which is why the avatar dropdown, which deliberately avoided role=menu while it
// had no arrow navigation, can carry it now.
//
// Positioning is `position: fixed` in a PORTAL to `document.body`, measured from the
// trigger's `getBoundingClientRect()` when the menu opens (R5 Task 7 fix round 1).
// It used to be `absolute` inside the `relative` wrapper, which is clipped by any
// scrolling or `overflow-hidden` ancestor — on dev, `/biblioteca` → Filtros →
// Tonalidad showed two rows of a ten-row panel because `CueDialog`'s body is
// `overflow-y-auto`. A portal is the house answer to that (`Toast`, `NotePopover`,
// `CueDialog` itself), and it also escapes the transformed route-reveal host, which
// would otherwise be the containing block for a `fixed` descendant.
//
// The portal does NOT break the dialog contract: `CueDialog`'s Escape-yield check is
// `event.target.closest('[role="menu"]')`, which still matches the portalled panel, and
// the panel sits at `z-[92]` — above a dialog (`z-[90]`), below the toast stack
// (`z-[95]`). The panel is not a DOM descendant of the root any more, so outside-click
// and the scroll watcher both test it explicitly.

import React, { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { EASE_IN, EASE_OUT, EXIT_MS, MS } from "@/app/utils/motionPresets";

const MenuCtx = createContext<{ close: (refocus: boolean) => void } | null>(null);

/**
 * Forward `node` to a ref supplied as a prop. Kept as a free function (not a
 * closure over component state) so the ref-immutability lint, which flags
 * direct mutation of anything reachable from `props` inside a component body,
 * does not see this as mutating the trigger's own props.
 */
function setForwardedRef<T>(ref: React.Ref<T> | null | undefined, node: T | null) {
  if (typeof ref === "function") ref(node);
  else if (ref && "current" in ref) (ref as React.MutableRefObject<T | null>).current = node;
}

type TriggerProps = {
  ref: React.Ref<HTMLButtonElement>;
  "aria-haspopup": "menu";
  "aria-expanded": boolean;
  "aria-controls": string;
  onClick: (e: React.MouseEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
};

/** Where the portalled panel sits, in viewport coordinates. */
type Anchor = { top?: number; bottom?: number; left?: number; right?: number; minWidth: number; flipped: boolean };

const GAP = 8;
/** The room a panel wants below the trigger before it prefers to flip above it. */
const WANTED = 240;

function anchorFrom(rect: DOMRect, align: "start" | "end"): Anchor {
  const vw = typeof window === "undefined" ? 0 : window.innerWidth;
  const vh = typeof window === "undefined" ? 0 : window.innerHeight;
  const below = vh - rect.bottom - GAP;
  const above = rect.top - GAP;
  const flipped = below < WANTED && above > below;
  const side = align === "end" ? { right: Math.max(0, vw - rect.right) } : { left: Math.max(0, rect.left) };
  return {
    ...side,
    ...(flipped ? { bottom: Math.max(0, vh - rect.top + GAP) } : { top: rect.bottom + GAP }),
    minWidth: rect.width,
    flipped,
  };
}

export default function Menu({
  label,
  trigger,
  align = "end",
  className = "inline-block",
  children,
  onOpenChange,
}: {
  label: string;
  trigger: ReactElement<Record<string, unknown>>;
  align?: "start" | "end";
  /** Root wrapper classes, on top of `relative`. `Select`'s desktop trigger needs `block w-full`. */
  className?: string;
  children: React.ReactNode;
  onOpenChange?: (open: boolean) => void;
}) {
  const id = useId();
  const [open, setOpenState] = useState(false);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [portalNode, setPortalNode] = useState<HTMLElement | null>(null);
  const focusFirst = useRef(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { setPortalNode(document.body); }, []);

  const measure = useCallback(() => {
    const node = triggerRef.current;
    if (!node) return;
    setAnchor(anchorFrom(node.getBoundingClientRect(), align));
  }, [align]);

  const setOpen = useCallback((next: boolean) => {
    // Measured SYNCHRONOUSLY on the opening event, so the panel's first paint is
    // already in place — a layout effect would paint it at the origin first.
    if (next) {
      const node = triggerRef.current;
      if (node) setAnchor(anchorFrom(node.getBoundingClientRect(), align));
    }
    setOpenState(next);
    if (next !== open) onOpenChange?.(next);
  }, [align, open, onOpenChange]);
  const close = useCallback((refocus: boolean) => { setOpen(false); if (refocus) triggerRef.current?.focus(); }, [setOpen]);

  /** The panel is portalled: "inside" means the root OR the panel, never `contains` alone. */
  const inside = useCallback((target: Node | null) => {
    if (!target) return false;
    return Boolean(rootRef.current?.contains(target)) || Boolean(panelRef.current?.contains(target));
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => { if (!inside(e.target as Node)) close(false); };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open, close, inside]);

  // A fixed panel does not travel with its trigger, so any ancestor scroll closes it
  // (capture phase — scroll does not bubble). The panel's OWN scroll is exempt, or a
  // long option list would shut itself the moment it was scrolled.
  useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => { if (!panelRef.current?.contains(e.target as Node)) close(false); };
    const onResize = () => measure();
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, close, measure]);

  const items = () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []);
  /** Keyboard entry lands on the current option when there is one (`Select`), else the first. */
  const entry = () => { const list = items(); return list.find((el) => el.getAttribute("aria-current") === "true") ?? list[0]; };

  useEffect(() => {
    if (!open || !focusFirst.current) return;
    const list = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []);
    (list.find((el) => el.getAttribute("aria-current") === "true") ?? list[0])?.focus();
    focusFirst.current = false;
  }, [open]);

  const onPanelKeyDown = (e: React.KeyboardEvent) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    // `i < 0` covers focus landing outside the roving list — e.g. the panel
    // element itself (focusable via its own `tabIndex={-1}` below) — and both
    // arrows treat that as "one before the first item", so ArrowDown lands on
    // item 0 and ArrowUp wraps to the LAST item rather than nothing.
    if (e.key === "ArrowDown") { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); const prev = i < 0 ? list.length - 1 : (i - 1 + list.length) % list.length; list[prev]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); list[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); list[list.length - 1]?.focus(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === "Tab") { close(false); }
  };

  const triggerProps = trigger.props as {
    ref?: React.Ref<HTMLButtonElement>;
    onClick?: (e: React.MouseEvent) => void;
    onKeyDown?: (e: React.KeyboardEvent) => void;
  };

  // The trigger's own ref (if any) is merged with Menu's: both receive the DOM
  // node, so a consumer that needs to refocus its trigger (e.g. after an async
  // action) still can.
  const mergedTriggerRef = useCallback((node: HTMLButtonElement | null) => {
    triggerRef.current = node;
    setForwardedRef(triggerProps.ref, node);
  }, [triggerProps.ref]);

  const triggerEl = React.cloneElement(trigger, {
    ref: mergedTriggerRef,
    "aria-haspopup": "menu",
    "aria-expanded": open,
    "aria-controls": id,
    onClick: (e: React.MouseEvent) => { triggerProps.onClick?.(e); if (!e.defaultPrevented) setOpen(!open); },
    onKeyDown: (e: React.KeyboardEvent) => {
      triggerProps.onKeyDown?.(e);
      if (e.defaultPrevented) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        // Already open (e.g. opened by click/Enter/Space) — the `[open]` effect
        // below only fires on a false→true transition, so it never runs here.
        // Move focus into the panel directly instead of relying on it.
        if (open) {
          const list = items();
          if (e.key === "ArrowDown") entry()?.focus();
          else list[list.length - 1]?.focus();
        } else {
          focusFirst.current = true;
          setOpen(true);
        }
      }
      if (e.key === "Tab" && open) close(false);
      if (e.key === "Escape" && open) { e.preventDefault(); e.stopPropagation(); close(true); }
    },
  } satisfies Partial<TriggerProps>);

  const panel = (
    <AnimatePresence>
      {open && (
        <m.div
          key="menu"
          ref={panelRef}
          id={id}
          role="menu"
          aria-label={label}
          tabIndex={-1}
          onKeyDown={onPanelKeyDown}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1, transition: { duration: MS.base / 1000, ease: EASE_OUT } }}
          exit={{ opacity: 0, scale: 0.98, transition: { duration: EXIT_MS / 1000, ease: EASE_IN } }}
          style={{
            position: "fixed",
            ...(anchor ?? {}),
            transformOrigin: `${anchor?.flipped ? "bottom" : "top"} ${align === "end" ? "right" : "left"}`,
          }}
          // `max-h` + `overflow-y-auto` replaces the old `overflow-hidden`: a 30-option
          // `Select` (Persona, the pair roster) used to render a panel taller than the
          // viewport. A rounded box still clips its own corners while scrolling.
          className="z-[92] max-h-[min(20rem,60vh)] min-w-[13rem] overflow-y-auto rounded-xl border border-surface-accent-20 bg-surface-raised-alt py-1 shadow-2xl"
        >
          <MenuCtx.Provider value={{ close }}>{children}</MenuCtx.Provider>
        </m.div>
      )}
    </AnimatePresence>
  );

  return (
    <div ref={rootRef} className={`relative ${className}`.trim()}>
      {triggerEl}
      {portalNode ? createPortal(panel, portalNode) : null}
    </div>
  );
}

const ITEM =
  "flex w-full items-center gap-3 px-4 py-2.5 text-left font-label text-xs uppercase tracking-widest transition-colors duration-fast " +
  "text-mono-500 hover:bg-accent/10 hover:text-accent focus:outline-none focus-visible:bg-accent/10 focus-visible:text-accent aria-disabled:opacity-40 aria-disabled:pointer-events-none";

export function MenuItem({ onSelect, href, icon, danger = false, disabled = false, selected = false, children }: {
  onSelect?: () => void; href?: string; icon?: React.ReactNode; danger?: boolean; disabled?: boolean;
  /** The row that is already the current value (`Select`). Marks it, and takes keyboard entry focus. */
  selected?: boolean; children: React.ReactNode;
}) {
  const ctx = useContext(MenuCtx);
  const cls = `${ITEM} ${danger ? "text-negative-fg hover:text-negative-fg" : selected ? "text-accent" : ""}`;
  const current = selected ? "true" : undefined;
  const pick = () => { if (disabled) return; ctx?.close(true); onSelect?.(); };
  if (href && !disabled) return <Link role="menuitem" href={href} className={cls} aria-current={current} aria-disabled={disabled || undefined} onClick={() => ctx?.close(false)} tabIndex={-1}>{icon}{children}</Link>;
  return <button type="button" role="menuitem" className={cls} aria-current={current} aria-disabled={disabled || undefined} onClick={pick} tabIndex={-1}>{icon}{children}</button>;
}

export function MenuSeparator() {
  return <div role="separator" className="my-1 border-t border-edge-accent-subtle" />;
}

export function MenuHeader({ children }: { children: React.ReactNode }) {
  return <div role="presentation" className="border-b border-edge-accent-subtle px-4 py-3">{children}</div>;
}
