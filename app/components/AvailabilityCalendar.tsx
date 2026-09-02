"use client";

import { useState, useEffect, useRef } from "react";
import { useTransientValue } from "@/app/utils/useTransientValue";

interface Props {
  /** The revision this page was rendered at — the save's `ifRevisionId` guard. */
  initialRev: string;
  initialDates: string[];
  serviceDates?: string[];
  initialNotes?: { date: string; note: string }[];
}

/** What the PATCH reports as the member's stored state — on 200 and on 409 alike. */
interface ServerState {
  _rev: string | null;
  unavailableDates: string[];
  unavailabilityNotes: { date: string; note: string }[];
}

const CONFLICT_MSG =
  "Tu disponibilidad cambió mientras esta página estaba abierta — tus cambios NO se guardaron. " +
  "El calendario ya muestra las fechas actuales: vuelve a marcarlas y guarda otra vez.";

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

// Stable fingerprint of the saved state, to detect unsaved changes.
function snapshot(dates: Set<string>, notes: Map<string, string>): string {
  const ds = Array.from(dates).sort();
  const ns = Array.from(notes.entries())
    .filter(([d, n]) => dates.has(d) && n.trim())
    .map(([d, n]) => [d, n.trim()] as [string, string])
    .sort((a, b) => a[0].localeCompare(b[0]));
  return JSON.stringify([ds, ns]);
}

interface Popover { iso: string; x: number; y: number; above: boolean }

export default function AvailabilityCalendar({ initialRev, initialDates, serviceDates = [], initialNotes = [] }: Props) {
  const [dates, setDates]   = useState<Set<string>>(new Set(initialDates));
  const serviceSet = new Set(serviceDates);
  const [saving, setSaving] = useState(false);
  const [saved, flashSaved, clearSaved] = useTransientValue(false, 2500);
  const [saveError, setSaveError] = useState<string | null>(null);
  // The conflict notice is HELD, never flashed: it reports a write that did NOT
  // land, and it must outlive the seconds a toast gets.
  const [conflict, , clearConflict, holdConflict] = useTransientValue<string | null>(null, 2500);
  // The revision every save is written against; refreshed from each reply.
  const [rev, setRev]       = useState(initialRev);
  const [page, setPage]     = useState(0);

  const [notes, setNotes]   = useState<Map<string, string>>(
    () => new Map(initialNotes.map(n => [n.date, n.note]))
  );
  const [popover, setPopover] = useState<Popover | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [recurOpen, setRecurOpen]         = useState(false);
  const [recurDow, setRecurDow]           = useState(0); // 0 = Domingo
  const [recurInterval, setRecurInterval] = useState(1);

  // Saved-state snapshot `dirty` compares against; reset after each successful save.
  const [initialSnap, setInitialSnap] = useState(() => snapshot(new Set(initialDates), new Map(initialNotes.map(n => [n.date, n.note]))));
  const dirty = snapshot(dates, notes) !== initialSnap;

  const now      = new Date();
  const todayIso = now.toLocaleDateString("sv", { timeZone: "America/Mexico_City" });

  const upcomingCount = Array.from(dates).filter(d => d >= todayIso).length;

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

  // Close popover on Escape
  useEffect(() => {
    if (!popover) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPopover(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [popover]);

  // Warn before leaving (tab close / refresh / external nav) with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  function handleDateClick(iso: string, e: React.MouseEvent<HTMLButtonElement>) {
    if (!dates.has(iso)) {
      // Select the date
      setDates(prev => { const n = new Set(prev); n.add(iso); return n; });
      clearSaved();
    }
    // Open popover (whether newly selected or re-clicking to edit note)
    const rect = e.currentTarget.getBoundingClientRect();
    const POPOVER_H = 160;
    const above = rect.bottom + POPOVER_H > window.innerHeight - 16;
    const x = Math.min(rect.left, window.innerWidth - 272);
    const y = above ? rect.top - POPOVER_H - 6 : rect.bottom + 6;
    setPopover({ iso, x, y, above });
  }

  function removeDate(iso: string) {
    setDates(prev => { const n = new Set(prev); n.delete(iso); return n; });
    setNotes(prev => { const m = new Map(prev); m.delete(iso); return m; });
    clearSaved();
    setPopover(null);
  }

  // Expand a recurring weekday pattern into concrete future dates (next 12 months),
  // then either mark (add) the whole run or clear (remove) it.
  function applyRecurring(add: boolean) {
    const cur = new Date();
    cur.setHours(12, 0, 0, 0);
    while (cur.getDay() !== recurDow) cur.setDate(cur.getDate() + 1);
    const end = new Date();
    end.setDate(end.getDate() + 365);

    const series: string[] = [];
    while (cur <= end) {
      const iso = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`;
      if (iso >= todayIso) series.push(iso);
      cur.setDate(cur.getDate() + 7 * recurInterval);
    }
    setDates(prev => { const n = new Set(prev); series.forEach(d => (add ? n.add(d) : n.delete(d))); return n; });
    if (!add) setNotes(prev => { const m = new Map(prev); series.forEach(d => m.delete(d)); return m; });
    clearSaved();
    setRecurOpen(false);
  }

  /** Adopt the server's arrays, dropping the pending edits with them. */
  function adopt(server: ServerState) {
    const serverDates = new Set(server.unavailableDates ?? []);
    const serverNotes = new Map((server.unavailabilityNotes ?? []).map(n => [n.date, n.note]));
    setDates(serverDates);
    setNotes(serverNotes);
    setInitialSnap(snapshot(serverDates, serverNotes));
    if (server._rev) setRev(server._rev);
    setPopover(null);
    clearSaved();
  }

  /**
   * The PATCH replaces BOTH arrays wholesale from a snapshot this page took when
   * it loaded, so it carries the revision it read at and the server refuses a
   * stale one. On that 409 the pending edits are DISCARDED, not retried:
   * re-sending a stale set against a fresh revision is the very deletion the
   * guard just stopped — the member re-marks the dates against real state.
   *
   * The one exception is a conflict where the server's availability is
   * BYTE-IDENTICAL to the base these edits were built on. That is not the race;
   * it is a sibling write to the same `teamMembers` document — `ProfilePanel`
   * sits on this same page and saves alias, email, photo, password and
   * notification prefs. Re-issuing the edits against the fresh revision then
   * cannot delete anything, so it happens once, silently, instead of throwing
   * the member's work away for a field they changed themselves seconds ago.
   */
  async function save() {
    setSaving(true);
    setSaveError(null);
    clearConflict();
    try {
      const notesPayload = Array.from(notes.entries())
        .filter(([d, n]) => dates.has(d) && n.trim())
        .map(([date, note]) => ({ date, note: note.trim() }));
      const baseSnap = initialSnap;

      let attemptRev = rev;
      // At most two attempts: the second can only be the sibling-write rebase,
      // and its own conflict is treated as a real one.
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await fetch("/api/me/availability", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            _rev: attemptRev,
            unavailableDates: Array.from(dates),
            unavailabilityNotes: notesPayload,
          }),
        });

        if (res.ok) {
          const server = (await res.json()) as ServerState;
          // Only the revision is adopted, not the arrays: the reply echoes what
          // was just sent, and overwriting local state here would delete a date
          // toggled while the request was in flight.
          if (server._rev) setRev(server._rev);
          setInitialSnap(snapshot(dates, notes));
          flashSaved(true);
          return;
        }
        if (res.status !== 409) throw new Error(`Server returned ${res.status}`);

        const server = (await res.json()) as ServerState;
        const serverSnap = snapshot(
          new Set(server.unavailableDates ?? []),
          new Map((server.unavailabilityNotes ?? []).map(n => [n.date, n.note])),
        );
        if (attempt === 0 && server._rev && serverSnap === baseSnap) {
          attemptRev = server._rev;
          continue;
        }
        adopt(server);
        holdConflict(CONFLICT_MSG);
        return;
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  const first = visibleMonths[0];
  const last  = visibleMonths[visibleMonths.length - 1];
  const rangeLabel =
    first.year === last.year
      ? `${MONTHS_ES[first.month - 1]} – ${MONTHS_ES[last.month - 1]} ${last.year}`
      : `${MONTHS_ES[first.month - 1]} ${first.year} – ${MONTHS_ES[last.month - 1]} ${last.year}`;

  return (
    <div className="space-y-4">
      {/* Header */}
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
      {recurOpen && (
        <div className="rounded-xl border border-accent/20 bg-accent/[0.04] p-4 space-y-3">
          <p className="font-label text-[11px] uppercase tracking-widest text-accent/70">
            Marcar un día recurrente como no disponible
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={recurDow}
              onChange={e => setRecurDow(Number(e.target.value))}
              className="rounded-lg border border-surface-accent-l40-d20 bg-surface-lift/5 px-3 py-2 font-body text-sm text-mono-200 focus:outline-none focus:border-accent/50 dark:focus:border-surface-accent-l40-d20"
            >
              {WEEKDAYS.map((w, i) => <option key={i} value={i} className="bg-surface-base">{w}</option>)}
            </select>
            <select
              value={recurInterval}
              onChange={e => setRecurInterval(Number(e.target.value))}
              className="rounded-lg border border-surface-accent-l40-d20 bg-surface-lift/5 px-3 py-2 font-body text-sm text-mono-200 focus:outline-none focus:border-accent/50 dark:focus:border-surface-accent-l40-d20"
            >
              <option value={1} className="bg-surface-base">Cada semana</option>
              <option value={2} className="bg-surface-base">Cada 2 semanas</option>
              <option value={4} className="bg-surface-base">Cada 4 semanas</option>
            </select>
            <button
              type="button"
              onClick={() => applyRecurring(true)}
              className="px-4 py-2 rounded-lg bg-surface-accent-solid text-on-fill hover:bg-accent-deep/80 dark:hover:bg-accent/30 font-label text-xs uppercase tracking-widest transition-colors"
            >
              Marcar
            </button>
            <button
              type="button"
              onClick={() => applyRecurring(false)}
              className="px-4 py-2 rounded-lg border border-surface-accent-l40-d20 font-label text-xs uppercase tracking-widest text-mono-400 hover:border-negative-strong/40 hover:text-negative-fg transition-colors"
            >
              Quitar serie
            </button>
          </div>
          <p className="font-body text-xs text-mono-500">
            <span className="text-mono-400">Marcar</span> agrega o <span className="text-mono-400">Quitar serie</span> borra ese día durante los próximos 12 meses. Puedes ajustar días sueltos después; recuerda <span className="text-mono-400">Guardar</span>.
          </p>
        </div>
      )}

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
          onClick={() => setPage(p => p - 1)}
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
          onClick={() => setPage(p => p + 1)}
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
                      aria-pressed={unavailable}
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
            onClick={() => setPage(i)}
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
              onChange={e => {
                const val = e.target.value;
                setNotes(prev => {
                  const m = new Map(prev);
                  if (val) m.set(popover.iso, val);
                  else m.delete(popover.iso);
                  return m;
                });
                clearSaved();
              }}
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
