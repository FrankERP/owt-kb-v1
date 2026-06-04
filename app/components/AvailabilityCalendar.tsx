"use client";

import { useState, useCallback } from "react";

interface Props {
  initialDates: string[];
  serviceDates?: string[];
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
  const firstDay  = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const offset    = (firstDay + 6) % 7;
  const cells: (string | null)[] = Array(offset).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(isoDate(year, month, d));
  return cells;
}

export default function AvailabilityCalendar({ initialDates, serviceDates = [] }: Props) {
  const [dates, setDates]   = useState<Set<string>>(new Set(initialDates));
  const serviceSet = new Set(serviceDates);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [page, setPage]     = useState(0); // 0 = current month, 1 = +3, 2 = +6, …

  const now      = new Date();
  const todayIso = now.toLocaleDateString("sv", { timeZone: "America/Mexico_City" });

  // Only count dates from today onwards — past unavailability is no longer relevant
  const upcomingCount = Array.from(dates).filter(d => d >= todayIso).length;

  const allMonths = Array.from({ length: TOTAL_MONTHS }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  });

  const totalPages   = Math.ceil(TOTAL_MONTHS / PAGE_SIZE);
  const visibleMonths = allMonths.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const canPrev      = page > 0;
  const canNext      = page < totalPages - 1;

  const toggle = useCallback((iso: string) => {
    setDates(prev => {
      const next = new Set(prev);
      next.has(iso) ? next.delete(iso) : next.add(iso);
      return next;
    });
    setSaved(false);
  }, []);

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/me/availability", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unavailableDates: Array.from(dates) }),
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
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-[#003572] dark:bg-[#00bfff]/20 hover:bg-[#003572]/80 dark:hover:bg-[#00bfff]/30 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50"
        >
          {saving ? "Guardando..." : saved ? "Guardado ✓" : "Guardar"}
        </button>
      </div>

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
                  const hasService  = serviceSet.has(iso);
                  const dayNum      = new Date(iso + "T12:00:00").getDate();
                  return (
                    <button
                      key={iso}
                      type="button"
                      onClick={() => !isPast && toggle(iso)}
                      disabled={isPast}
                      title={iso}
                      className={`relative rounded text-center font-body text-xs transition-colors min-h-[44px] sm:min-h-0 sm:py-1 sm:pb-2 ${
                        isPast
                          ? "text-gray-700 cursor-default"
                          : unavailable
                          ? "bg-orange-500/30 text-orange-300 border border-orange-500/50 hover:bg-orange-500/40"
                          : "text-gray-300 hover:bg-[#00bfff]/10 hover:text-[#00bfff]"
                      }`}
                    >
                      {dayNum}
                      {hasService && (
                        <span className={`absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full ${unavailable ? "bg-orange-400/60" : isPast ? "bg-gray-600" : "bg-[#00bfff]/70"}`} />
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
