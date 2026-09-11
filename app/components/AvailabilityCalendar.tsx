"use client";

import { useState, useEffect, useRef } from "react";
import { useAvailability } from "@/app/components/availability/useAvailability";
import Collapse from "@/app/components/ui/Collapse";
import Select from "@/app/components/ui/Select";

interface Props {
  /** The revision this page was rendered at — the save's `ifRevisionId` guard. */
  initialRev: string;
  initialDates: string[];
  serviceDates?: string[];
  initialNotes?: { date: string; note: string }[];
}

const MONTHS_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
const DAYS_ES = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];

const TOTAL_MONTHS = 12;
const PAGE_SIZE    = 3;

const WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function buildCalendar(year: number, month: number): (string | null)[] {
  const firstDay    = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const offset      = (firstDay + 6) % 7;
  const cells: (string | null)[] = Array(offset).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(isoDate(year, month, d));
  return cells;
}

function fmtDayLabel(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
}

interface Popover { iso: string; x: number; y: number; above: boolean }

/** Height the popover is laid out against; it has no measured height until it exists. */
const POPOVER_H = 160;
const POPOVER_W = 272;

/**
 * Where the note popover sits for a day cell, in viewport coordinates.
 *
 * Pure and exported so the placement can be tested without a layout engine —
 * jsdom reports every rect as zero, so the only way to prove the flip and the
 * clamps is to feed them rects directly.
 */
export function popoverPosition(
  rect: { top: number; bottom: number; left: number },
  viewportW: number,
  viewportH: number,
): { x: number; y: number; above: boolean } {
  const above = rect.bottom + POPOVER_H > viewportH - 16;
  return {
    // Clamped at both ends: the right clamp alone goes negative on a viewport
    // narrower than the popover.
    x: Math.max(8, Math.min(rect.left, viewportW - POPOVER_W)),
    y: above ? rect.top - POPOVER_H - 6 : rect.bottom + 6,
    above,
  };
}

export default function AvailabilityCalendar({ initialRev, initialDates, serviceDates = [], initialNotes = [] }: Props) {
  const serviceSet = new Set(serviceDates);
  const [page, setPage]     = useState(0);

  const [popover, setPopover] = useState<Popover | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // The day button the open popover belongs to, so its position can be
  // recomputed rather than frozen at click time.
  const anchorRef = useRef<HTMLButtonElement | null>(null);

  // Every edit, the dirty fingerprint and the revision-guarded save live in the
  // hook; this component owns only what the grid itself draws.
  const {
    dates, notes, todayIso, upcomingCount,
    mark, remove, setNote, applyRecurring,
    save, saving, saved, dirty, saveError, conflict,
  } = useAvailability({
    initialRev, initialDates, initialNotes,
    // A conflict drops the pending edits, so the popover can be pinned to a date
    // that is gone — it closes in the same update the adoption lands in.
    onAdopt: () => setPopover(null),
  });

  const [recurOpen, setRecurOpen]         = useState(false);
  const [recurDow, setRecurDow]           = useState(0); // 0 = Domingo
  const [recurInterval, setRecurInterval] = useState(1);

  const now = new Date();

  const allMonths = Array.from({ length: TOTAL_MONTHS }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  });

  const totalPages    = Math.ceil(TOTAL_MONTHS / PAGE_SIZE);
  const visibleMonths = allMonths.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const canPrev       = page > 0;
  const canNext       = page < totalPages - 1;

  // Focus the input whenever popover opens
  useEffect(() => {
    if (popover) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [popover?.iso]);

  /**
   * Keep the popover attached to its day.
   *
   * It is `position: fixed` at coordinates captured on click, so anything that
   * scrolls leaves it floating over an unrelated part of the page while still
   * bound to the original date — the member then types a reason for the wrong
   * day, or gives up on one they meant to explain. On a phone this is the
   * common path, not the edge: the on-screen keyboard scrolls the page as they
   * reach for the note field.
   *
   * Closing on scroll is the tempting one-liner and it is WORSE — that same
   * keyboard fires scroll and resize, so the popover would vanish at the moment
   * it opened. Recompute from the anchor instead. Capture phase, because the
   * scroll may happen in an ancestor rather than the window.
   */
  const popoverOpen = !!popover;
  useEffect(() => {
    if (!popoverOpen) return;
    const reposition = () => {
      const el = anchorRef.current;
      // Paging months unmounts every day button; a detached node reports a
      // zero rect, which would snap the popover to the top-left corner.
      if (!el?.isConnected) return;
      const p = popoverPosition(el.getBoundingClientRect(), window.innerWidth, window.innerHeight);
      // Only write on a real move, or the state update re-arms this effect forever.
      setPopover(prev =>
        prev && (prev.x !== p.x || prev.y !== p.y || prev.above !== p.above) ? { ...prev, ...p } : prev,
      );
    };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [popoverOpen]);

  // Close popover on Escape
  useEffect(() => {
    if (!popover) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPopover(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [popover]);

  function handleDateClick(iso: string, e: React.MouseEvent<HTMLButtonElement>) {
    // Select the date (a no-op when it is already marked)
    mark(iso);
    // Open popover (whether newly selected or re-clicking to edit note)
    anchorRef.current = e.currentTarget;
    const pos = popoverPosition(e.currentTarget.getBoundingClientRect(), window.innerWidth, window.innerHeight);
    setPopover({ iso, ...pos });
  }

  function removeDate(iso: string) {
    remove(iso);
    setPopover(null);
  }

  function applySeries(add: boolean) {
    applyRecurring(recurDow, recurInterval, add);
    setRecurOpen(false);
  }

  const first = visibleMonths[0];
  const last  = visibleMonths[visibleMonths.length - 1];
  const rangeLabel =
    first.year === last.year
      ? `${MONTHS_ES[first.month - 1]} – ${MONTHS_ES[last.month - 1]} ${last.year}`
      : `${MONTHS_ES[first.month - 1]} ${first.year} – ${MONTHS_ES[last.month - 1]} ${last.year}`;

  return (
    <div className="space-y-4">
      {/* Header + the recurring panel it opens. They share a wrapper so the
          panel is not a child of `space-y-4`: a closed Collapse is a zero-height
          child, but the 16px gap around it would still be reserved. */}
      <div>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-display text-lg uppercase tracking-wide">Disponibilidad</h3>
            <p className="font-label text-xs uppercase tracking-widest text-mono-500 mt-0.5">
              Marca los días en que no puedes asistir
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setRecurOpen(v => !v)}
              aria-expanded={recurOpen}
              aria-controls="availability-recur"
              className={`px-3 py-2 rounded-lg border font-label text-xs uppercase tracking-widest transition-colors ${
                recurOpen
                  ? "border-accent text-accent"
                  : "border-surface-accent-30 text-mono-500 hover:border-accent dark:hover:border-surface-accent-30 hover:text-accent"
              }`}
            >
              Repetir…
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || !dirty}
              className={`px-4 py-2 rounded-lg font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50 ${
                dirty
                  ? "bg-surface-accent-solid text-on-fill hover:bg-accent-deep/80 dark:hover:bg-accent/30 ring-1 ring-warning-strong/50"
                  : "bg-surface-accent-solid text-on-fill"
              }`}
            >
              {saving ? "Guardando..." : saved ? "Guardado ✓" : dirty ? "Guardar •" : "Guardar"}
            </button>
          </div>
        </div>

        {/* Recurring pattern */}
        <Collapse open={recurOpen} id="availability-recur" className="mt-4 rounded-xl border border-accent/20 bg-accent/[0.04] p-4 space-y-3">
          <p className="font-label text-[11px] uppercase tracking-widest text-accent/70">
            Marcar un día recurrente como no disponible
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Select aria-label="Día de la semana" value={recurDow} onChange={e => setRecurDow(Number(e.target.value))}>
              {WEEKDAYS.map((w, i) => <option key={i} value={i} className="bg-surface-base">{w}</option>)}
            </Select>
            <Select aria-label="Cada cuántas semanas" value={recurInterval} onChange={e => setRecurInterval(Number(e.target.value))}>
              <option value={1} className="bg-surface-base">Cada semana</option>
              <option value={2} className="bg-surface-base">Cada 2 semanas</option>
              <option value={4} className="bg-surface-base">Cada 4 semanas</option>
            </Select>
            <button
              type="button"
              onClick={() => applySeries(true)}
              className="px-4 py-2 rounded-lg bg-surface-accent-solid text-on-fill hover:bg-accent-deep/80 dark:hover:bg-accent/30 font-label text-xs uppercase tracking-widest transition-colors"
            >
              Marcar
            </button>
            <button
              type="button"
              onClick={() => applySeries(false)}
              className="px-4 py-2 rounded-lg border border-surface-accent-l40-d20 font-label text-xs uppercase tracking-widest text-mono-400 hover:border-negative-strong/40 hover:text-negative-fg transition-colors"
            >
              Quitar serie
            </button>
          </div>
          <p className="font-body text-xs text-mono-500">
            <span className="text-mono-400">Marcar</span> agrega o <span className="text-mono-400">Quitar serie</span> borra ese día durante los próximos 12 meses. Puedes ajustar días sueltos después; recuerda <span className="text-mono-400">Guardar</span>.
          </p>
        </Collapse>
      </div>

      {upcomingCount > 0 && (
        <p className="font-label text-[11px] uppercase tracking-widest text-availability-strong">
          {upcomingCount} fecha{upcomingCount !== 1 ? "s" : ""} marcada{upcomingCount !== 1 ? "s" : ""} como no disponible
        </p>
      )}

      {dirty && !saving && (
        <p className="font-label text-[11px] uppercase tracking-widest text-warning-strong">
          Cambios sin guardar
        </p>
      )}

      {saveError && (
        <p className="font-label text-[11px] uppercase tracking-widest text-negative-fg">
          No se pudo guardar — {saveError}
        </p>
      )}

      {conflict && (
        <p
          role="status"
          className="rounded-xl border border-negative-strong/25 bg-negative-strong/5 px-4 py-2 font-body text-sm text-negative-fg"
        >
          {conflict}
        </p>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => { setPopover(null); setPage(p => p - 1); }}
          disabled={!canPrev}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-accent-deep/40 font-label text-[11px] uppercase tracking-widest text-mono-500 hover:border-accent/40 hover:text-accent disabled:opacity-20 disabled:cursor-default transition-colors"
        >
          <ChevronLeft /> Anterior
        </button>

        <span className="font-label text-[11px] uppercase tracking-widest text-mono-500">
          {rangeLabel}
        </span>

        <button
          type="button"
          onClick={() => { setPopover(null); setPage(p => p + 1); }}
          disabled={!canNext}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-accent-deep/40 font-label text-[11px] uppercase tracking-widest text-mono-500 hover:border-accent/40 hover:text-accent disabled:opacity-20 disabled:cursor-default transition-colors"
        >
          Siguiente <ChevronRight />
        </button>
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {visibleMonths.map(({ year, month }) => {
          const cells = buildCalendar(year, month);
          return (
            <div key={`${year}-${month}`} className="rounded-xl border border-accent/15 bg-accent/[0.04] p-3">
              <p className="font-label text-[11px] uppercase tracking-widest text-accent/70 mb-2 text-center">
                {MONTHS_ES[month - 1]} {year}
              </p>
              <div className="grid grid-cols-7 gap-0.5 mb-1">
                {DAYS_ES.map(d => (
                  <div key={d} className="font-label text-[10px] uppercase tracking-widest text-mono-400 text-center py-0.5">
                    {d}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-0.5">
                {cells.map((iso, i) => {
                  if (!iso) return <div key={i} />;
                  const isPast      = iso < todayIso;
                  const unavailable = dates.has(iso);
                  const isPopoverOpen = popover?.iso === iso;
                  const hasService  = serviceSet.has(iso);
                  const hasNote     = unavailable && notes.has(iso) && !!notes.get(iso)?.trim();
                  const dayNum      = new Date(iso + "T12:00:00").getDate();
                  return (
                    <button
                      key={iso}
                      type="button"
                      onClick={e => !isPast && handleDateClick(iso, e)}
                      disabled={isPast}
                      aria-label={`${fmtDayLabel(iso)}${unavailable ? ", no disponible" : ""}${hasService ? ", hay servicio" : ""}${hasNote ? ", con nota" : ""}`}
                      className={`relative rounded text-center font-body text-xs transition-colors min-h-[44px] sm:min-h-0 sm:py-1 sm:pb-2 ${
                        isPast
                          ? "text-mono-700 cursor-default"
                          : isPopoverOpen
                          ? "bg-availability-fg/50 text-availability-faint border border-availability-strong ring-1 ring-availability-strong/40"
                          : unavailable
                          ? "bg-availability-fg/30 text-availability-soft border border-availability-fg/50 hover:bg-availability-fg/40"
                          : "text-mono-300 hover:bg-accent/10 hover:text-accent"
                      }`}
                    >
                      {dayNum}
                      {hasService && (
                        <span className={`absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full ${unavailable ? "bg-availability-strong/60" : isPast ? "bg-mono-600" : "bg-accent/70"}`} />
                      )}
                      {hasNote && (
                        <span className="absolute top-0.5 right-0.5 w-1 h-1 rounded-full bg-surface-lift/50" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Page dots */}
      <div className="flex justify-center gap-1.5 pt-1">
        {Array.from({ length: totalPages }).map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => { setPopover(null); setPage(i); }}
            className={`w-1.5 h-1.5 rounded-full transition-colors ${
              i === page ? "bg-accent" : "bg-accent-deep/50 hover:bg-accent-deep"
            }`}
            aria-label={`Página ${i + 1}`}
          />
        ))}
      </div>

      {/* Floating note popover */}
      {popover && (
        <>
          {/* Backdrop — click outside to close */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setPopover(null)}
          />
          <div
            className="fixed z-50 w-64 rounded-xl border border-accent/20 bg-surface-base shadow-2xl shadow-elevation/60 p-4 space-y-3"
            style={{ top: popover.y, left: popover.x }}
            onClick={e => e.stopPropagation()}
          >
            {/* Date label + close */}
            <div className="flex items-start justify-between gap-2">
              <p className="font-label text-[11px] uppercase tracking-widest text-availability-strong leading-tight capitalize">
                {fmtDayLabel(popover.iso)}
              </p>
              <button
                type="button"
                onClick={() => setPopover(null)}
                aria-label="Cerrar"
                className="text-mono-400 hover:text-mono-300 transition-colors shrink-0 -mt-0.5"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Note input */}
            <input
              ref={inputRef}
              type="text"
              placeholder="Razón (opcional)..."
              value={notes.get(popover.iso) ?? ""}
              onChange={e => setNote(popover.iso, e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") setPopover(null); }}
              className="w-full rounded-lg border border-surface-accent-l50-d15 bg-surface-lift/5 px-3 py-2 font-body text-sm text-mono-200 placeholder:text-placeholder focus:outline-none focus:border-accent/40 dark:focus:border-surface-accent-l50-d15"
            />

            {/* Remove date */}
            <button
              type="button"
              onClick={() => removeDate(popover.iso)}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-negative-strong/20 font-label text-[11px] uppercase tracking-widest text-negative-fg/80 hover:border-negative-strong/40 hover:text-negative-fg transition-colors"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
              Quitar esta fecha
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ChevronLeft() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
