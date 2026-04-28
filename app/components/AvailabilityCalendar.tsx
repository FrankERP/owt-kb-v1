"use client";

import { useState, useCallback } from "react";

interface Props {
  initialDates: string[];
}

const MONTHS_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
const DAYS_ES = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function buildCalendar(year: number, month: number): (string | null)[] {
  const firstDay = new Date(year, month - 1, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month, 0).getDate();
  // Shift so Mon=0, Sun=6
  const offset = (firstDay + 6) % 7;
  const cells: (string | null)[] = Array(offset).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(isoDate(year, month, d));
  return cells;
}

export default function AvailabilityCalendar({ initialDates }: Props) {
  const [dates, setDates] = useState<Set<string>>(new Set(initialDates));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);

  const now = new Date();
  // Show 3 months starting this month
  const months = [0, 1, 2].map(offset => {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  });

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
    await fetch("/api/me/availability", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unavailableDates: Array.from(dates) }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  const todayIso = now.toLocaleDateString("sv", { timeZone: "America/Mexico_City" });

  return (
    <div className="space-y-4">
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

      {dates.size > 0 && (
        <p className="font-label text-[10px] uppercase tracking-widest text-orange-400">
          {dates.size} fecha{dates.size !== 1 ? "s" : ""} marcada{dates.size !== 1 ? "s" : ""} como no disponible
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {months.map(({ year, month }) => {
          const cells = buildCalendar(year, month);
          return (
            <div key={`${year}-${month}`} className="rounded-xl border border-[#00bfff]/15 bg-[#00bfff]/3 p-3">
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
                  const dayNum      = new Date(iso + "T12:00:00").getDate();
                  return (
                    <button
                      key={iso}
                      type="button"
                      onClick={() => !isPast && toggle(iso)}
                      disabled={isPast}
                      title={iso}
                      className={`rounded text-center py-1 font-body text-xs transition-colors ${
                        isPast
                          ? "text-gray-700 cursor-default"
                          : unavailable
                          ? "bg-orange-500/30 text-orange-300 border border-orange-500/50 hover:bg-orange-500/40"
                          : "text-gray-300 hover:bg-[#00bfff]/10 hover:text-[#00bfff]"
                      }`}
                    >
                      {dayNum}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
