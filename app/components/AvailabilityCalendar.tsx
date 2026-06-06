"use client";

import { useState, useEffect, useRef } from "react";

interface Props {
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

export default function AvailabilityCalendar({ initialDates, serviceDates = [], initialNotes = [] }: Props) {
  const [dates, setDates]   = useState<Set<string>>(new Set(initialDates));
  const serviceSet = new Set(serviceDates);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [page, setPage]     = useState(0);

  const [notes, setNotes]   = useState<Map<string, string>>(
    () => new Map(initialNotes.map(n => [n.date, n.note]))
  );
  const [popover, setPopover] = useState<Popover | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [recurOpen, setRecurOpen]         = useState(false);
  const [recurDow, setRecurDow]           = useState(0); // 0 = Domingo
  const [recurInterval, setRecurInterval] = useState(1);

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

  function handleDateClick(iso: string, e: React.MouseEvent<HTMLButtonElement>) {
    if (!dates.has(iso)) {
      // Select the date
      setDates(prev => { const n = new Set(prev); n.add(iso); return n; });
      setSaved(false);
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
    setSaved(false);
    setPopover(null);
  }

  // Expand a recurring weekday pattern into concrete future dates (next 12 months).
  function applyRecurring() {
    const cur = new Date();
    cur.setHours(12, 0, 0, 0);
    while (cur.getDay() !== recurDow) cur.setDate(cur.getDate() + 1);
    const end = new Date();
    end.setDate(end.getDate() + 365);

    const added: string[] = [];
    while (cur <= end) {
      const iso = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`;
      if (iso >= todayIso) added.push(iso);
      cur.setDate(cur.getDate() + 7 * recurInterval);
    }
    setDates(prev => { const n = new Set(prev); added.forEach(d => n.add(d)); return n; });
    setSaved(false);
    setRecurOpen(false);
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const notesPayload = Array.from(notes.entries())
        .filter(([d, n]) => dates.has(d) && n.trim())
        .map(([date, note]) => ({ date, note: note.trim() }));

      const res = await fetch("/api/me/availability", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          unavailableDates: Array.from(dates),
          unavailabilityNotes: notesPayload,
        }),
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
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
          <p className="font-label text-xs uppercase tracking-widest text-gray-500 mt-0.5">
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
                ? "border-[#00bfff] text-[#00bfff]"
                : "border-[#003572]/30 dark:border-[#00bfff]/20 text-gray-500 hover:border-[#00bfff] hover:text-[#00bfff]"
            }`}
          >
            Repetir…
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-[#003572] dark:bg-[#00bfff]/20 hover:bg-[#003572]/80 dark:hover:bg-[#00bfff]/30 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50"
          >
            {saving ? "Guardando..." : saved ? "Guardado ✓" : "Guardar"}
          </button>
        </div>
      </div>

      {/* Recurring pattern */}
      {recurOpen && (
        <div className="rounded-xl border border-[#00bfff]/20 bg-[#00bfff]/[0.04] p-4 space-y-3">
          <p className="font-label text-[10px] uppercase tracking-widest text-[#00bfff]/70">
            Marcar un día recurrente como no disponible
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={recurDow}
              onChange={e => setRecurDow(Number(e.target.value))}
              className="rounded-lg border border-[#003572]/40 dark:border-[#00bfff]/20 bg-white/5 px-3 py-2 font-body text-sm text-gray-200 focus:outline-none focus:border-[#00bfff]/50"
            >
              {WEEKDAYS.map((w, i) => <option key={i} value={i} className="bg-[#010b17]">{w}</option>)}
            </select>
            <select
              value={recurInterval}
              onChange={e => setRecurInterval(Number(e.target.value))}
              className="rounded-lg border border-[#003572]/40 dark:border-[#00bfff]/20 bg-white/5 px-3 py-2 font-body text-sm text-gray-200 focus:outline-none focus:border-[#00bfff]/50"
            >
              <option value={1} className="bg-[#010b17]">Cada semana</option>
              <option value={2} className="bg-[#010b17]">Cada 2 semanas</option>
              <option value={4} className="bg-[#010b17]">Cada 4 semanas</option>
            </select>
            <button
              type="button"
              onClick={applyRecurring}
              className="px-4 py-2 rounded-lg bg-[#003572] dark:bg-[#00bfff]/20 hover:bg-[#003572]/80 dark:hover:bg-[#00bfff]/30 font-label text-xs uppercase tracking-widest transition-colors"
            >
              Aplicar
            </button>
          </div>
          <p className="font-body text-[11px] text-gray-500">
            Agrega esas fechas durante los próximos 12 meses. Puedes ajustar días sueltos después; recuerda <span className="text-gray-400">Guardar</span>.
          </p>
        </div>
      )}

      {upcomingCount > 0 && (
        <p className="font-label text-[10px] uppercase tracking-widest text-orange-400">
          {upcomingCount} fecha{upcomingCount !== 1 ? "s" : ""} marcada{upcomingCount !== 1 ? "s" : ""} como no disponible
        </p>
      )}

      {saveError && (
        <p className="font-label text-[10px] uppercase tracking-widest text-red-400">
          No se pudo guardar — {saveError}
        </p>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setPage(p => p - 1)}
          disabled={!canPrev}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#003572]/40 font-label text-[10px] uppercase tracking-widest text-gray-500 hover:border-[#00bfff]/40 hover:text-[#00bfff] disabled:opacity-20 disabled:cursor-default transition-colors"
        >
          <ChevronLeft /> Anterior
        </button>

        <span className="font-label text-[10px] uppercase tracking-widest text-gray-500">
          {rangeLabel}
        </span>

        <button
          type="button"
          onClick={() => setPage(p => p + 1)}
          disabled={!canNext}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#003572]/40 font-label text-[10px] uppercase tracking-widest text-gray-500 hover:border-[#00bfff]/40 hover:text-[#00bfff] disabled:opacity-20 disabled:cursor-default transition-colors"
        >
          Siguiente <ChevronRight />
        </button>
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {visibleMonths.map(({ year, month }) => {
          const cells = buildCalendar(year, month);
          return (
            <div key={`${year}-${month}`} className="rounded-xl border border-[#00bfff]/15 bg-[#00bfff]/[0.04] p-3">
              <p className="font-label text-[10px] uppercase tracking-widest text-[#00bfff]/70 mb-2 text-center">
                {MONTHS_ES[month - 1]} {year}
              </p>
              <div className="grid grid-cols-7 gap-0.5 mb-1">
                {DAYS_ES.map(d => (
                  <div key={d} className="font-label text-[9px] uppercase tracking-widest text-gray-600 text-center py-0.5">
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
                      className={`relative rounded text-center font-body text-xs transition-colors min-h-[44px] sm:min-h-0 sm:py-1 sm:pb-2 ${
                        isPast
                          ? "text-gray-700 cursor-default"
                          : isPopoverOpen
                          ? "bg-orange-500/50 text-orange-200 border border-orange-400 ring-1 ring-orange-400/40"
                          : unavailable
                          ? "bg-orange-500/30 text-orange-300 border border-orange-500/50 hover:bg-orange-500/40"
                          : "text-gray-300 hover:bg-[#00bfff]/10 hover:text-[#00bfff]"
                      }`}
                    >
                      {dayNum}
                      {hasService && (
                        <span className={`absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full ${unavailable ? "bg-orange-400/60" : isPast ? "bg-gray-600" : "bg-[#00bfff]/70"}`} />
                      )}
                      {hasNote && (
                        <span className="absolute top-0.5 right-0.5 w-1 h-1 rounded-full bg-white/50" />
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
              i === page ? "bg-[#00bfff]" : "bg-[#003572]/50 hover:bg-[#003572]"
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
            className="fixed z-50 w-64 rounded-xl border border-[#00bfff]/20 bg-[#010b17] shadow-2xl shadow-black/60 p-4 space-y-3"
            style={{ top: popover.y, left: popover.x }}
            onClick={e => e.stopPropagation()}
          >
            {/* Date label + close */}
            <div className="flex items-start justify-between gap-2">
              <p className="font-label text-[10px] uppercase tracking-widest text-orange-400/80 leading-tight capitalize">
                {fmtDayLabel(popover.iso)}
              </p>
              <button
                type="button"
                onClick={() => setPopover(null)}
                className="text-gray-600 hover:text-gray-300 transition-colors shrink-0 -mt-0.5"
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
                setSaved(false);
              }}
              onKeyDown={e => { if (e.key === "Enter") setPopover(null); }}
              className="w-full rounded-lg border border-[#003572]/50 dark:border-[#00bfff]/15 bg-white/5 px-3 py-2 font-body text-sm text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-[#00bfff]/40"
            />

            {/* Remove date */}
            <button
              type="button"
              onClick={() => removeDate(popover.iso)}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-red-500/20 font-label text-[10px] uppercase tracking-widest text-red-400/70 hover:border-red-500/40 hover:text-red-400 transition-colors"
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
