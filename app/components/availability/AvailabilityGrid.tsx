"use client";

// The twelve-month availability grid — now a CONTROLLED view behind «Ver
// calendario» on `/me` (R3). The weekend list is the default surface; this is
// what a member opens to mark a Tuesday, a holiday week, or anything the ten
// weekend rows cannot express.
//
// It owns nothing but paging: every edit, the dirty fingerprint and the
// revision-guarded save live in `useAvailability`, which the HOST
// (`availability/MyAvailabilityPanel`) calls once for both surfaces, and the
// note popover is the host's single `NotePopover`.
//
// Moved here from `app/components/AvailabilityCalendar.tsx` (fix round 1) —
// the grid lives beside the rest of `/me`'s availability surfaces now.

import { useState } from "react";
import type { Availability } from "@/app/components/availability/useAvailability";
import { fmtDayLabel } from "@/app/components/availability/NotePopover";

interface Props {
  /** The one `useAvailability` instance the panel shares between its surfaces. */
  state: Availability;
  serviceDates?: string[];
  /** Open the panel's note popover for a day, anchored to the cell clicked. */
  openNote: (iso: string, anchor: HTMLElement) => void;
  /** Paging unmounts every day button, so the popover must close before it moves. */
  closeNote: () => void;
  /** The date whose note popover is open — the cell it belongs to reads lit. */
  noteIso?: string | null;
}

const MONTHS_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
const DAYS_ES = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];

const TOTAL_MONTHS = 12;
const PAGE_SIZE    = 3;

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

export default function AvailabilityGrid({ state, serviceDates = [], openNote, closeNote, noteIso = null }: Props) {
  const serviceSet = new Set(serviceDates);
  const [page, setPage] = useState(0);

  const { dates, notes, todayIso, mark } = state;

  const now = new Date();

  const allMonths = Array.from({ length: TOTAL_MONTHS }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  });

  const totalPages    = Math.ceil(TOTAL_MONTHS / PAGE_SIZE);
  const visibleMonths = allMonths.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const canPrev       = page > 0;
  const canNext       = page < totalPages - 1;

  function handleDateClick(iso: string, e: React.MouseEvent<HTMLButtonElement>) {
    // Select the date (a no-op when it is already marked)
    mark(iso);
    // Open the note popover (whether newly selected or re-clicking to edit note)
    openNote(iso, e.currentTarget);
  }

  function goTo(next: number) {
    closeNote();
    setPage(next);
  }

  const first = visibleMonths[0];
  const last  = visibleMonths[visibleMonths.length - 1];
  const rangeLabel =
    first.year === last.year
      ? `${MONTHS_ES[first.month - 1]} – ${MONTHS_ES[last.month - 1]} ${last.year}`
      : `${MONTHS_ES[first.month - 1]} ${first.year} – ${MONTHS_ES[last.month - 1]} ${last.year}`;

  return (
    <div className="space-y-4">
      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => goTo(page - 1)}
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
          onClick={() => goTo(page + 1)}
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
                  const isPopoverOpen = noteIso === iso;
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
            onClick={() => goTo(i)}
            className={`w-1.5 h-1.5 rounded-full transition-colors ${
              i === page ? "bg-accent" : "bg-accent-deep/50 hover:bg-accent-deep"
            }`}
            aria-label={`Página ${i + 1}`}
          />
        ))}
      </div>
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
