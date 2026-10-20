"use client";

// «Pantalla completa» for the Servicios board: every service the month filter
// is showing, as the month editor's grid — dates across, seats down — and READ
// ONLY. The shape is `servicesOverviewModel.ts`; this file only paints it.
//
// It is NOT a `CueDialog`: the house dialog tops out at `max-w-4xl`, and the
// point of this view is the whole viewport. It follows the one full-screen
// surface the admin already has instead — `PlannerGrid`'s «Pantalla completa»
// (portalled to `body`, opaque, safe-area padding, siblings `inert`, body scroll
// locked, Escape and a visible exit). Mounted only while open, so all of that
// lives and dies with the component.
//
// Unlike the editor's full screen, the date track keeps a FLOOR (`COLUMN_MIN`)
// and scrolls past it: «Próximos» can hold two or three months, and dividing the
// viewport by twenty-odd columns would leave cells too narrow to read a name.

import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "@/app/utils/useFocusTrap";
import { buildServicesOverview } from "./servicesOverviewModel";
import { CARD_STYLE, type ServiceRole } from "./serviceCardModel";

/** The opener (`ServicesPanel`'s button) carries this attribute; focus returns to it on the way out. */
const OPENER_SELECTOR = "[data-services-overview-opener]";

const COLUMN_MIN = "96px";
const LABEL_MIN = "112px";

function monthTitle(ym: string): string {
  const text = new Date(`${ym}-01T12:00:00`).toLocaleDateString("es-MX", { month: "long", year: "numeric" });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export default function ServicesOverview({
  roles,
  title,
  onClose,
}: {
  /** Exactly the board's visible services — the filter is the board's. */
  roles: readonly ServiceRole[];
  /** What the filter is showing: «Próximos», «Nov 26», «2 meses». */
  title: string;
  onClose: () => void;
}) {
  const model = useMemo(() => buildServicesOverview(roles), [roles]);
  const overlayRef = useFocusTrap<HTMLDivElement>(true);
  // The effect below must run once per mount: re-running it would hand focus
  // back to the opener mid-view. So the latest `onClose` is read through a ref
  // instead of being a dependency.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Escape, body scroll lock and `inert` on the page behind — the same three
  // things, for the same reasons, as `PlannerGrid`'s full-screen effect. The
  // dialog and toast roots stay live: they are layers ABOVE this one.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };
    document.addEventListener("keydown", onKeyDown, true);

    const body = document.body;
    const priorOverflow = body.style.overflow;
    body.style.overflow = "hidden";

    const overlay = overlayRef.current;
    const inerted: HTMLElement[] = [];
    for (const child of Array.from(body.children)) {
      if (!(child instanceof HTMLElement)) continue;
      if (overlay && (child === overlay || child.contains(overlay))) continue;
      if (child.hasAttribute("data-cue-dialog-root")) continue;
      if (child.hasAttribute("data-toast-root")) continue;
      if (child.hasAttribute("inert")) continue;
      child.setAttribute("inert", "");
      inerted.push(child);
    }

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      body.style.overflow = priorOverflow;
      for (const el of inerted) el.removeAttribute("inert");
      // By attribute, after `inert` is gone: an inert opener refuses focus, and
      // `useFocusTrap`'s own restore may have run first.
      document.querySelector<HTMLElement>(OPENER_SELECTOR)?.focus();
    };
  }, [overlayRef]);

  const sticky = "sticky left-0 z-10 bg-surface-base";

  return createPortal(
    <div
      ref={overlayRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={`Servicios en pantalla completa · ${title}`}
      data-services-overview=""
      className="fixed inset-0 z-50 flex flex-col gap-3 bg-surface-base focus:outline-none pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-label text-xs uppercase tracking-widest text-accent">Servicios · {title}</p>
          <p className="font-body text-xs text-mono-500">
            {model.columns.length} servicio{model.columns.length === 1 ? "" : "s"} · solo lectura
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="min-h-[44px] rounded-lg border border-accent/20 px-3 font-label text-xs uppercase tracking-widest hover:border-accent"
        >
          Salir de pantalla completa (Esc)
        </button>
      </div>

      {model.columns.length === 0 ? (
        <p className="font-body text-sm text-mono-500 text-center py-12">No hay servicios en este filtro.</p>
      ) : (
        <div data-services-overview-scroller="" className="min-h-0 flex-1 overflow-auto">
          <div
            className="grid gap-1"
            style={{ gridTemplateColumns: `minmax(${LABEL_MIN}, max-content) repeat(${model.columns.length}, minmax(${COLUMN_MIN}, 1fr))` }}
          >
            {model.months.length > 1 && (
              <>
                <div className={sticky} />
                {model.months.map((band, i) => (
                  <div
                    key={band.month}
                    data-month-band={band.month}
                    style={{ gridColumn: `span ${band.span}` }}
                    className={`px-1 pb-1 font-label text-[11px] uppercase tracking-widest text-accent ${i > 0 ? "border-l-2 border-accent/40" : ""}`}
                  >
                    {monthTitle(band.month)}
                  </div>
                ))}
              </>
            )}

            <div className={sticky} />
            {model.columns.map((column) => {
              const date = new Date(`${column.date}T12:00:00`);
              return (
                <div key={column.id} data-overview-column={column.id} className="min-w-0 space-y-0.5 px-1 pb-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className="font-display text-base leading-none">{date.getDate()}</span>
                    <span className="font-label text-xs uppercase tracking-widest text-mono-500">
                      {date.toLocaleDateString("es-MX", { month: "short" })}
                    </span>
                  </div>
                  <span className="block font-label text-[11px] uppercase tracking-widest text-mono-500">
                    {column.typeLabel}
                    {column.time ? ` · ${column.time}` : ""}
                  </span>
                  {column.serviceName && (
                    <span className={`block font-body text-[11px] text-ink-muted/80 ${CARD_STYLE.longText}`}>
                      {column.serviceName}
                    </span>
                  )}
                  {column.draft && (
                    <span
                      data-overview-draft=""
                      className="inline-block rounded-full border border-warning-fg/40 px-1.5 py-0.5 font-label text-[10px] uppercase tracking-widest text-warning-strong"
                    >
                      Borrador
                    </span>
                  )}
                </div>
              );
            })}

            {model.rows.map((row) => (
              <OverviewRow key={row.id} rowId={row.id} label={row.label} model={model} stickyClass={sticky} />
            ))}
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

function OverviewRow({
  rowId,
  label,
  model,
  stickyClass,
}: {
  rowId: string;
  label: string;
  model: ReturnType<typeof buildServicesOverview>;
  stickyClass: string;
}) {
  return (
    <>
      <div className={`${stickyClass} flex items-center px-1 py-1`}>
        <span className="font-label text-sm uppercase tracking-widest text-ink-muted/70 break-words">{label}</span>
      </div>
      {model.columns.map((column) => {
        const names = model.names(column.id, rowId);
        if (names === null) return <div key={column.id} />;
        return (
          <div
            key={column.id}
            data-overview-cell={`${column.id}|${rowId}`}
            className="min-h-[40px] min-w-0 rounded-lg border border-accent/15 px-1.5 py-1"
          >
            {names.length === 0 ? (
              <span className="font-body text-xs italic text-mono-600">Sin asignar</span>
            ) : (
              <div className="flex flex-wrap gap-1">
                {names.map((name, i) => (
                  <span
                    key={`${name}-${i}`}
                    className={`rounded-full border border-accent/25 bg-accent/10 px-1.5 py-0.5 font-label text-xs text-ink-muted ${CARD_STYLE.longText}`}
                  >
                    {name}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
