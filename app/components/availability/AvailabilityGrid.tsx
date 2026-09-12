"use client";

// The twelve-month availability grid — a CONTROLLED view behind «Ver
// calendario» on `/me` (R3). The weekend list is the default surface; this is
// what a member opens to mark a Tuesday, a holiday week, or anything the ten
// weekend rows cannot express.
//
// It owns paging AND the selection gesture (R3 F2): «Seleccionar fechas» turns
// the months into a drag surface, a drag marks the whole span at once, and the
// next month fades in as a "shadow" tile when the finger nears the bottom of
// the page — no auto-scroll, and no long-press anywhere (the mode is a button,
// so a slow tap can never arm a selection by accident).
//
// What it still does NOT own is the data: every edit, the dirty fingerprint and
// the revision-guarded save live in `useAvailability`, which the HOST
// (`availability/MyAvailabilityPanel`) calls once for both surfaces, and the
// note popover is the host's single `NotePopover` — the drag just asks it to
// open for a range. The selection arithmetic lives in `dragSelect.ts`, which is
// pure because jsdom has no layout.
//
// The Desde/Hasta date fields moved here from the panel in F2: they are the
// keyboard and VoiceOver path to the same range a drag expresses, so they
// belong beside it rather than two surfaces away.

import { useEffect, useMemo, useRef, useState } from "react";
import Button from "@/app/components/ui/Button";
import Collapse from "@/app/components/ui/Collapse";
import DateField from "@/app/components/ui/DateField";
import type { Availability } from "@/app/components/availability/useAvailability";
import { fmtDayLabel, isoFromPoint, isoRange, shadowOpacity } from "@/app/components/availability/dragSelect";
import { haptic } from "@/app/utils/haptics";

interface Props {
  /** The one `useAvailability` instance the panel shares between its surfaces. */
  state: Availability;
  serviceDates?: string[];
  /** Open the panel's note popover, anchored to a cell. `isos` = the whole dragged range. */
  openNote: (iso: string, anchor: HTMLElement, isos?: string[]) => void;
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

  // The selection gesture. `drag` is the live span (anchor = where the finger
  // went down, current = where it is now, either order); `shadow` is the next
  // month's opacity, 0 when it is not offered at all.
  const [selecting, setSelecting] = useState(false);
  const [drag, setDrag] = useState<{ anchor: string; current: string } | null>(null);
  const [shadow, setShadow] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastTileRef  = useRef<HTMLDivElement | null>(null);

  // The date fields, moved here from `MyAvailabilityPanel` (F2).
  const [rangeOpen, setRangeOpen]   = useState(false);
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd]     = useState("");

  const { dates, notes, todayIso, mark, applyRange } = state;

  const now = new Date();

  const allMonths = Array.from({ length: TOTAL_MONTHS }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  });

  const totalPages    = Math.ceil(TOTAL_MONTHS / PAGE_SIZE);
  const visibleMonths = allMonths.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const canPrev       = page > 0;
  const canNext       = page < totalPages - 1;

  // The first month of the NEXT page — what the shadow tile shows.
  const shadowMonth        = canNext ? allMonths[(page + 1) * PAGE_SIZE] : undefined;
  const shadowMonthFirstIso = shadowMonth ? isoDate(shadowMonth.year, shadowMonth.month, 1) : null;

  // The live preview, memoised so a drag over 80 days does not rebuild it per cell.
  const pendingDays = useMemo(
    () => (drag ? isoRange(drag.anchor, drag.current, todayIso) : []),
    [drag, todayIso],
  );
  const pendingSet = useMemo(() => new Set(pendingDays), [pendingDays]);

  // Escape abandons a drag without committing. Listened for only while one is
  // live, so nothing else on `/me` has to share the key.
  useEffect(() => {
    if (!drag) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setDrag(null); setShadow(0); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drag]);

  function toggleSelecting() {
    // Both directions: the popover is anchored to a cell whose style is about to
    // change, and a half-finished drag must never survive the mode switch.
    closeNote();
    setDrag(null);
    setShadow(0);
    setSelecting(v => !v);
  }

  function handleDateClick(iso: string, e: React.MouseEvent<HTMLButtonElement>) {
    // Select the date (a no-op when it is already marked)
    mark(iso);
    // Open the note popover (whether newly selected or re-clicking to edit note)
    openNote(iso, e.currentTarget);
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!selecting || e.button !== 0) return;
    const iso = isoFromPoint(e.clientX, e.clientY);
    if (!iso || iso < todayIso) return;
    // Capture, so the rest of the gesture arrives here even as the finger leaves
    // the cell it started on. That is also why `isoFromPoint` exists: with the
    // pointer captured, the event target stops telling us which day is under it.
    try {
      if (typeof e.currentTarget.setPointerCapture === "function") {
        e.currentTarget.setPointerCapture(e.pointerId);
      }
    } catch {
      // jsdom has no pointer capture, and a device can refuse it. The gesture
      // still works through `elementFromPoint`; capture only keeps it smooth.
    }
    setDrag({ anchor: iso, current: iso });
    void haptic("medium");
    e.preventDefault();
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag) return;
    const iso = isoFromPoint(e.clientX, e.clientY);
    if (iso && iso !== drag.current) {
      setDrag({ ...drag, current: iso });
      void haptic("selection");
    }
    // How close the finger is to the bottom of the last VISIBLE month decides
    // how solid the next one looks — the page itself never scrolls.
    const tile = lastTileRef.current;
    if (canNext && tile) setShadow(shadowOpacity(tile.getBoundingClientRect().bottom - e.clientY));
    else setShadow(0);
  }

  function releaseCapture(e: React.PointerEvent<HTMLDivElement>) {
    try {
      if (typeof e.currentTarget.releasePointerCapture === "function") {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Same as the capture above: best effort.
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    releaseCapture(e);
    if (drag) {
      // The days FIRST: paging below re-renders the grid, and the span has to be
      // read from the drag that just ended, not from what is on screen after.
      const days = isoRange(drag.anchor, drag.current, todayIso);
      if (days.length) {
        applyRange(days[0], days[days.length - 1], true);
        // Ending inside the shadow month means the member meant to go there.
        if (shadowMonthFirstIso && drag.current >= shadowMonthFirstIso) setPage(page + 1);
        const first = days[0];
        // Next frame, so the anchor cell exists after a page turn.
        requestAnimationFrame(() => {
          const el =
            containerRef.current?.querySelector<HTMLElement>(`[data-iso="${first}"]`) ??
            containerRef.current;
          if (el) openNote(first, el, days);
        });
      }
    }
    setDrag(null);
    setShadow(0);
  }

  function onPointerCancel(e: React.PointerEvent<HTMLDivElement>) {
    releaseCapture(e);
    setDrag(null);
    setShadow(0);
  }

  function goTo(next: number) {
    closeNote();
    setPage(next);
  }

  function applySpan(add: boolean) {
    // Dropping a range can remove the very date the note popover is pinned to,
    // and this is the member's own edit, not a conflict `onAdopt` would catch.
    if (!add) closeNote();
    applyRange(rangeStart, rangeEnd, add);
    setRangeOpen(false);
  }

  const canApplyRange =
    rangeStart !== "" && rangeEnd !== "" && rangeEnd >= rangeStart && rangeEnd >= todayIso;

  const first = visibleMonths[0];
  const last  = visibleMonths[visibleMonths.length - 1];
  const rangeHeading =
    first.year === last.year
      ? `${MONTHS_ES[first.month - 1]} – ${MONTHS_ES[last.month - 1]} ${last.year}`
      : `${MONTHS_ES[first.month - 1]} ${first.year} – ${MONTHS_ES[last.month - 1]} ${last.year}`;

  function monthTile(
    { year, month }: { year: number; month: number },
    isLast: boolean,
    isShadow: boolean,
  ) {
    const cells = buildCalendar(year, month);
    return (
      <div
        key={`${year}-${month}${isShadow ? "-shadow" : ""}`}
        ref={isLast ? lastTileRef : undefined}
        data-shadow={isShadow ? "true" : undefined}
        data-solid={isShadow ? (shadow >= 1 ? "true" : "false") : undefined}
        aria-hidden={isShadow ? "true" : undefined}
        style={isShadow ? { opacity: shadow } : undefined}
        className="rounded-xl border border-accent/15 bg-accent/[0.04] p-3"
      >
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
            const isPending   = pendingSet.has(iso);
            const dayNum      = new Date(iso + "T12:00:00").getDate();
            return (
              <button
                key={iso}
                type="button"
                // Inside the mode the pointer flow owns the day: a click here
                // would mark it a second time and open a single-day popover over
                // the range's one.
                onClick={e => { if (!isPast && !selecting && !isShadow) handleDateClick(iso, e); }}
                disabled={isPast}
                tabIndex={isShadow ? -1 : undefined}
                // Every cell, past ones included — `isoRange` is what drops the
                // past, so the drag can cross them without losing the finger.
                data-iso={iso}
                aria-label={`${fmtDayLabel(iso)}${unavailable ? ", no disponible" : ""}${hasService ? ", hay servicio" : ""}${hasNote ? ", con nota" : ""}`}
                className={`relative rounded text-center font-body text-xs transition-colors min-h-[44px] sm:min-h-0 sm:py-1 sm:pb-2 ${
                  isPast
                    ? "text-mono-700 cursor-default"
                    : isPending
                    ? `bg-availability-fg/20 text-availability-soft ring-availability-strong/50 ${iso === pendingDays[0] ? "ring-2" : "ring-1"}`
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
  }

  return (
    <div className="space-y-4">
      {/* Selection mode + the keyboard path to the same range */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* A pill, for the one variant that publishes `aria-pressed` — the mode
              is a two-state toggle, and the availability tone is this surface's. */}
          <Button variant="pill" tone="availability" onClick={toggleSelecting} active={selecting}>
            {selecting ? "Listo" : "Seleccionar fechas"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => setRangeOpen(v => !v)}
            aria-expanded={rangeOpen}
            aria-controls="availability-range"
          >
            Rango por fechas
          </Button>
        </div>

        {selecting && (
          <p className="font-body text-xs text-mono-500">
            Arrastra sobre los días que no puedes. Suelta para escribir la razón.
          </p>
        )}

        {/* Date range — a special service mid-week the ten weekend rows can't say */}
        <Collapse open={rangeOpen} id="availability-range" className="mt-2 rounded-xl border border-accent/20 bg-accent/[0.04] p-4 space-y-3">
          <p className="font-label text-[11px] uppercase tracking-widest text-accent/70">
            Marcar varios días seguidos como no disponibles
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <DateField
              kind="date"
              aria-label="Desde"
              min={todayIso}
              value={rangeStart}
              onChange={e => {
                const v = e.target.value;
                setRangeStart(v);
                if (rangeEnd && rangeEnd < v) setRangeEnd(v);
              }}
            />
            <DateField
              kind="date"
              aria-label="Hasta"
              min={rangeStart || todayIso}
              value={rangeEnd}
              onChange={e => setRangeEnd(e.target.value)}
            />
            <Button variant="primary" onClick={() => applySpan(true)} disabled={!canApplyRange}>Marcar</Button>
            <Button onClick={() => applySpan(false)} disabled={!canApplyRange}>Quitar rango</Button>
          </div>
          <p className="font-body text-xs text-mono-500">
            <span className="text-mono-400">Marcar</span> agrega o <span className="text-mono-400">Quitar rango</span> borra cada día entre las dos fechas, incluyéndolas. Puedes ajustar días sueltos después; recuerda <span className="text-mono-400">Guardar</span>.
          </p>
        </Collapse>
      </div>

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
          {rangeHeading}
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

      {/* Calendar grid. While selecting, the container owns the gesture: no page
          scroll under the finger, no text selection, no iOS callout menu. */}
      <div
        id="availability-months"
        ref={containerRef}
        className="grid grid-cols-1 sm:grid-cols-3 gap-4"
        style={
          selecting
            ? { touchAction: "none", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }
            : undefined
        }
        onContextMenu={selecting ? (e => e.preventDefault()) : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        {/* `lastTileRef` stays on the last VISIBLE month — the shadow must not
            become the thing the shadow's own distance is measured from. */}
        {visibleMonths.map((m, i) => monthTile(m, i === visibleMonths.length - 1, false))}
        {shadowMonth && shadow > 0 && monthTile(shadowMonth, false, true)}
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
