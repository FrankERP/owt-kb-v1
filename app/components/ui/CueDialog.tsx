"use client";

import React, { useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, animate, useMotionValue } from "motion/react";
import * as m from "motion/react-m";
import { trapTabTarget } from "@/app/utils/focusTrap";
import { EASE_IN, EASE_OUT, EXIT_MS, MS, SHEET_DISMISS, SPRINGS } from "@/app/utils/motionPresets";
import Button from "./Button";
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

/**
 * ── Focus SATELLITES: controls this dialog owns that live outside its shell ──
 *
 * The trap builds its Tab ring from `shellRef`, and that is normally the whole
 * dialog. It is not always. A descendant may have to `createPortal` part of
 * itself out of the shell for reasons that have nothing to do with focus, and
 * the escape then costs it the Tab ring: reachable by mouse, unreachable by
 * keyboard, which is a real accessibility regression rather than a cosmetic one.
 *
 * **NO PRODUCTION CONSUMER REGISTERS A SATELLITE TODAY.** The case this was
 * built for was the Tablero's participation rail, which was `position: fixed`
 * in the page gutter and had to be portalled onto `document.body` because
 * WebKit refuses to PAINT a fixed descendant of `relative` + `isolation:
 * isolate` + `overflow: hidden` — exactly what the shell is. That surface was
 * retired; the same WebKit trap still governs `PlannerGrid`'s full-screen
 * overlay, and the bug is documented there in full.
 *
 * This is kept rather than deleted because the hazard is structural: the next
 * dialog descendant that portals a control out of the shell reintroduces the
 * mouse-only regression, and the fix for it is here and tested. It is dead
 * code in the sense of "no caller", not "no contract".
 *
 * A satellite is a container that a dialog's own subtree declares to be part of
 * that dialog for focus purposes, wherever it happens to be rendered. It is
 * registered from BELOW, through `useCueDialogFocusSatellite`, because the
 * component that owns the portal is typically a grandchild of the `<CueDialog>`
 * element and cannot hand it a prop. The context is provided around `children`,
 * so "the dialog I belong to" resolves to the nearest enclosing one and a
 * nested dialog shadows its parent — the same nesting the layer stack already
 * assumes.
 *
 * DEFAULT IS EXACTLY TODAY'S BEHAVIOUR. No consumer registers anything, the
 * set stays empty, and `focusRing` returns `focusables(shell)` — the same array
 * from the same call as before. The only difference for a dialog with no
 * satellites is one extra context provider around its children, which renders
 * no DOM.
 */
interface SatelliteRegistry {
  add: (node: HTMLElement) => void;
  remove: (node: HTMLElement) => void;
}

const SatelliteContext = React.createContext<SatelliteRegistry | null>(null);

/**
 * A callback ref to put on the portalled container. Attach registers it with
 * the enclosing dialog's Tab ring; detach (React calls a ref callback with
 * `null`) unregisters it. Each caller gets its own closure remembering the node
 * it last attached, because `null` alone does not say WHICH node left.
 *
 * Outside a `CueDialog` it is an inert no-op, so a component that is sometimes
 * in a dialog and sometimes not can call it unconditionally.
 */
export function useCueDialogFocusSatellite(): (node: HTMLElement | null) => void {
  const registry = useContext(SatelliteContext);
  const attached = useRef<HTMLElement | null>(null);
  return useCallback(
    (node: HTMLElement | null) => {
      if (attached.current) registry?.remove(attached.current);
      attached.current = node;
      if (node) registry?.add(node);
    },
    [registry],
  );
}

/**
 * The Tab ring: the shell's focusables, unioned with every registered
 * satellite's, **sorted into document order**.
 *
 * Document order is not a stylistic choice here, it is a correctness one.
 * `trapTabTarget` only forces a move at the two ends of the ring and returns
 * `null` everywhere in between, deliberately letting the browser perform
 * ordinary interior steps. The browser steps in DOCUMENT order. So an `items`
 * array in any other order would disagree with what actually happens on the
 * interior moves, and the two ends would be computed against a ring the user is
 * not walking. Sorting makes the array a true description of the browser's own
 * sequence, whatever a future portal target turns out to be.
 *
 * For a satellite portalled to `document.body`, document order puts it LAST:
 * `body` holds the app root, then `[data-cue-dialog-root]` (created when the
 * provider mounts), then the satellite's portal (appended when the dialog
 * opens). That is also the order we would choose — it keeps the dialog's own
 * primary actions in the position a user already learned, and appends the
 * escaped control after them rather than ahead of Guardar/Cancelar.
 *
 * A satellite that is detached, that sits inside an `inert` subtree, or that is
 * somehow already inside the shell contributes nothing: the first two are not
 * focusable, and the third is already counted.
 */
function focusRing(shell: HTMLElement, satellites: Iterable<HTMLElement>): HTMLElement[] {
  const items = focusables(shell);
  const extra: HTMLElement[] = [];
  for (const node of satellites) {
    if (!node.isConnected || shell.contains(node) || node.closest("[inert]")) continue;
    if (node.matches(FOCUSABLE) && node.getAttribute("aria-hidden") !== "true") extra.push(node);
    extra.push(...focusables(node));
  }
  if (extra.length === 0) return items;
  return [...items, ...extra].sort((a, b) =>
    a === b ? 0 : a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
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

  // Held in a ref, never in state: registration happens during commit (a child's
  // ref callback), and re-rendering the whole dialog because a satellite arrived
  // would be both pointless and a loop. The keydown handler reads it live, so a
  // rail that appears later — the gutter only exists above 1380px and the admin
  // may drag the window there — joins the ring with no effect to re-run.
  const satellitesRef = useRef<Set<HTMLElement>>(new Set());
  const satelliteRegistry = useMemo<SatelliteRegistry>(
    () => ({
      add: (node) => void satellitesRef.current.add(node),
      remove: (node) => void satellitesRef.current.delete(node),
    }),
    [],
  );

  // Mounted = open OR exiting. Registration (focus capture, inert on the app root,
  // scroll lock) lives for the whole presence, so focus restores and inert lifts
  // AFTER the exit animation, not at its start. This is the "closing state" spec §4
  // asked for, held here rather than in the provider — the provider only ever sees
  // register/unregister.
  //
  // `exiting` goes true the moment the dialog OPENS and is cleared by
  // `onExitComplete`; while `open` is true it is redundant, which is the point —
  // `mounted` cannot flicker between the two flips and re-register the layer.
  const [exiting, setExiting] = useState(false);
  const mounted = open || exiting;
  useEffect(() => {
    if (open) setExiting(true);
    // Unreachable with the provider mounted; belt-and-braces. With no portal node
    // there is no `AnimatePresence` to fire `onExitComplete`, so `exiting` would
    // stay true forever and the layer would stay registered — inert app root,
    // locked scroll, no dialog. Clearing it here costs one comparison per close.
    else if (!portalNode && exiting) setExiting(false);
  }, [exiting, open, portalNode]);
  useEffect(() => {
    if (!mounted) return;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return registerLayer({
      id,
      opener: openerRef.current,
      restoreFocusRef,
      fallbackRef: fallbackFocusRef,
      shellRef,
    });
  }, [fallbackFocusRef, id, mounted, registerLayer, restoreFocusRef]);

  const top = isTopLayer(id);
  const layerIndex = layers.indexOf(id);
  const isLowerLayer = layerIndex >= 0 && layerIndex < layers.length - 1;

  useEffect(() => {
    if (!open || !top) return;
    const shell = shellRef.current;
    if (!shell) return;
    // Initial focus stays SHELL-ONLY, on purpose. A satellite is registered by
    // a child's ref callback, so it is already in the set by the time this
    // parent effect runs — using the full ring here would compile fine and, for
    // the rail specifically, land on the same element (the shell precedes the
    // rail in document order). But nothing guarantees that for a satellite
    // portalled somewhere earlier in the body, and a dialog that opens with
    // focus on a chart's view toggle instead of on its own close button is not
    // the behaviour any consumer asked for. The ring is for Tab; the entry
    // point is the dialog.
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

      const items = focusRing(shell, satellitesRef.current);
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

  // A `mode="sheet"` dialog is only a SHEET on a phone: the `sm:` classes below turn
  // it into the same centred card a modal renders at ≥640px. The motion has to follow
  // the layout, or a laptop gets a card that slides up from under the viewport and
  // drags closed by a handle CSS has already hidden. Read per render, with no state
  // and no listener, because a dialog never renders on the server — `portalNode` comes
  // from the provider's effect, so the first render that reaches this JSX is a client
  // one and there is no hydration to mismatch. A window resized across 640px while a
  // dialog is open keeps the variant it opened with, which is the same trade the
  // rest of the app's breakpoint-dependent behaviour makes.
  // Absent `matchMedia` — jsdom without a stub — falls back to the SHEET, which is
  // both the mode the consumer asked for and the behaviour every caller had before
  // this line existed.
  const sheetMotion =
    mode === "sheet" &&
    (typeof window === "undefined" ||
      typeof window.matchMedia !== "function" ||
      !window.matchMedia("(min-width: 640px)").matches);

  // Sheet drag-to-dismiss (spec §19.4). Pointer events by hand — no `drag` prop —
  // because the gesture is one-axis, downward only, with its own thresholds, and
  // because a `drag` element fights the sheet's own scroll region. touch-action:none
  // lives on the HANDLE so the sheet body still scrolls.
  const sheetY = useMotionValue(0);
  const dragRef = useRef<{ startY: number; startT: number; lastY: number; lastT: number } | null>(null);
  // The spring-back's controls, so a re-grab can stop it. `sheetY.set()` does NOT
  // interrupt a running animation — it writes a value the animation overwrites on the
  // next frame — so without this a finger that catches the sheet mid-flight drags
  // nothing.
  const springRef = useRef<{ stop: () => void } | null>(null);

  const springBack = useCallback(() => {
    springRef.current = animate(sheetY, 0, SPRINGS.sheet);
  }, [sheetY]);

  const onHandlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.isPrimary) return;
    springRef.current?.stop();
    dragRef.current = { startY: e.clientY, startT: performance.now(), lastY: e.clientY, lastT: performance.now() };
    // jsdom has no pointer capture; a real browser needs it so the gesture keeps
    // tracking once the finger leaves the 12px handle.
    if (typeof e.currentTarget.setPointerCapture === "function") e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onHandlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || !e.isPrimary) return;
    d.lastY = e.clientY;
    d.lastT = performance.now();
    sheetY.set(Math.max(0, e.clientY - d.startY));
  };
  const onHandlePointerUp = () => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    // Spring back on BOTH branches, before the threshold test. A consumer may REFUSE
    // the dismissal — `DayCard` and `ServicesPanel` both ignore it while a save is in
    // flight — and then nothing else would ever return the sheet to 0, leaving it
    // hanging where the finger left it. When the consumer ACCEPTS, the exit animation
    // starts on the same MotionValue and stops this one, so the spring is invisible.
    springBack();
    const travel = Math.max(0, d.lastY - d.startY);
    const dt = Math.max(1, d.lastT - d.startT);
    const velocity = travel / dt;
    if (travel > SHEET_DISMISS.distance || velocity > SHEET_DISMISS.velocity) onDismiss("drag");
  };
  // A cancelled pointer is not a released one: the OS took the gesture away (a system
  // edge swipe, an incoming call). It must never dismiss, however far the finger had
  // travelled — only put the sheet back.
  const onHandlePointerCancel = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    springBack();
  };

  if (!portalNode) return null;

  return createPortal(
    <AnimatePresence initial={false} onExitComplete={() => setExiting(false)}>
      {open && (
        <div
          key="layer"
          data-cue-layer={id}
          aria-hidden={isLowerLayer ? "true" : undefined}
          inert={isLowerLayer ? true : undefined}
          className="fixed inset-0 z-[90] flex items-start justify-center px-4 py-4 sm:items-center"
          style={{ paddingTop: "max(1rem, env(safe-area-inset-top))", paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
        >
          <m.button
            data-cue-backdrop=""
            type="button"
            aria-label="Cerrar"
            tabIndex={-1}
            onClick={() => top && open && onDismiss("backdrop")}
            className="absolute inset-0 cursor-default bg-scrim/[0.68] backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: MS.base / 1000, ease: EASE_OUT } }}
            exit={{ opacity: 0, transition: { duration: EXIT_MS / 1000, ease: EASE_IN } }}
          />
          <m.div
            ref={shellRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            aria-label={!title ? label : undefined}
            tabIndex={-1}
            style={{ y: sheetY }}
            initial={sheetMotion ? { y: "100%", opacity: 1 } : { scale: 0.96, opacity: 0 }}
            animate={
              sheetMotion
                ? { y: 0, opacity: 1, transition: SPRINGS.sheet }
                : { scale: 1, opacity: 1, transition: { duration: MS.slow / 1000, ease: EASE_OUT } }
            }
            // A sheet slides ALL the way out and keeps its opacity, the way an iOS
            // sheet does. The old `{ y: 24 }` was a recoil: a sheet dragged 100 px down
            // snapped back up to 24 px before fading, which reads as the gesture being
            // undone rather than completed.
            exit={
              sheetMotion
                ? { y: "100%", transition: { duration: EXIT_MS / 1000, ease: EASE_IN } }
                : { scale: 0.98, opacity: 0, transition: { duration: EXIT_MS / 1000, ease: EASE_IN } }
            }
            className={`brand-facet-panel brand-surface relative z-10 flex w-full ${sizeClass} flex-col overflow-hidden border-accent/25 shadow-2xl focus:outline-none ${
              mode === "sheet"
                ? "mt-auto max-h-[92svh] rounded-t-2xl sm:mt-0 sm:max-h-[min(86svh,52rem)] sm:rounded-2xl"
                : "max-h-[min(92svh,54rem)] rounded-2xl"
            }`}
          >
            {mode === "sheet" && (
              <div
                data-cue-handle=""
                // Handlers only on the phone side of the breakpoint: at ≥640px the
                // handle is `sm:hidden` and the dialog is a card, so a drag there would
                // dismiss a card by a grip nobody can see.
                {...(sheetMotion
                  ? {
                      onPointerDown: onHandlePointerDown,
                      onPointerMove: onHandlePointerMove,
                      onPointerUp: onHandlePointerUp,
                      onPointerCancel: onHandlePointerCancel,
                    }
                  : null)}
                className="flex cursor-grab touch-none justify-center pb-1 pt-3 active:cursor-grabbing sm:hidden"
              >
                <span className="h-1.5 w-12 rounded-full bg-accent/25" />
              </div>
            )}
            {title && (
              <div className="flex shrink-0 items-start justify-between gap-4 border-b border-accent/10 bg-surface-raised/35 px-5 py-5 sm:px-6">
                <h2 id={titleId} className="min-w-0 font-display text-2xl leading-tight text-ink">
                  {title}
                </h2>
                <Button
                  variant="icon"
                  onClick={() => onDismiss("escape")}
                  aria-label={label ? `Cerrar ${label}` : "Cerrar diálogo"}
                >
                  <CloseIcon />
                </Button>
              </div>
            )}
            <SatelliteContext.Provider value={satelliteRegistry}>{children}</SatelliteContext.Provider>
          </m.div>
        </div>
      )}
    </AnimatePresence>,
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
