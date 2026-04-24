"use client";

import { useState, useEffect, useCallback } from "react";
import { DayCard } from "./DayCard";
import { Setlist } from "../utils/interface";

export type ActiveDay = {
  day: "Sábado" | "Domingo";
  date: string;
  setlist?: Setlist | null;
  leads?: string[];
  instruments?: Array<{ label: string; person: string }>;
  fohTeam?: Array<{ label: string; person: string }>;
  bgvs?: Array<{ member_name: string; alias?: string }>;
  chorus?: Array<{ member_name: string; alias?: string }>;
};

interface Props {
  activeDays: Record<string, ActiveDay>;
  todayStr: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
];
const DAY_HEADERS = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];

function toDateStr(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}
function firstDayOffset(year: number, month: number) {
  const dow = new Date(year, month, 1).getDay();
  return (dow + 6) % 7; // Monday-first
}

function getWeekends(activeDays: Record<string, ActiveDay>) {
  const map = new Map<string, { satDate?: string; sunDate?: string; sat?: ActiveDay; sun?: ActiveDay }>();

  Object.entries(activeDays).forEach(([dateStr, data]) => {
    if (data.day === "Domingo") {
      const prev = map.get(dateStr) ?? {};
      map.set(dateStr, { ...prev, sun: data, sunDate: dateStr });
    } else {
      const [y, m, d] = dateStr.split("-").map(Number);
      const sunKey = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
      const prev = map.get(sunKey) ?? {};
      map.set(sunKey, { ...prev, sat: data, satDate: dateStr });
    }
  });

  return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
}

// ─── Root component ───────────────────────────────────────────────────────────

export default function CalendarView({ activeDays, todayStr }: Props) {
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [selected, setSelected] = useState<string | null>(null);

  const dismiss = useCallback(() => setSelected(null), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") dismiss(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismiss]);

  const [todayYear, todayMonth] = todayStr.split("-").map(Number);
  const months = [0, 1, 2].map((offset) => {
    const d = new Date(todayYear, todayMonth - 1 + offset, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const selectedData = selected ? activeDays[selected] : null;
  const weekends = getWeekends(activeDays);

  return (
    <>
      {/* View toggle */}
      <div className="flex justify-center mb-8">
        <div className="flex rounded-lg border border-[#003572]/30 dark:border-[#00bfff]/20 overflow-hidden">
          <button
            onClick={() => setView("calendar")}
            className={`px-5 py-2 font-label text-xs uppercase tracking-widest transition-colors ${
              view === "calendar"
                ? "bg-[#003572] dark:bg-[#00bfff]/20 text-[#C8D8EB]"
                : "text-gray-500 hover:text-[#C8D8EB]"
            }`}
          >
            Calendario
          </button>
          <button
            onClick={() => setView("list")}
            className={`px-5 py-2 font-label text-xs uppercase tracking-widest transition-colors border-l border-[#003572]/30 dark:border-[#00bfff]/20 ${
              view === "list"
                ? "bg-[#003572] dark:bg-[#00bfff]/20 text-[#C8D8EB]"
                : "text-gray-500 hover:text-[#C8D8EB]"
            }`}
          >
            Lista
          </button>
        </div>
      </div>

      {/* Calendar view */}
      {view === "calendar" && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
          {months.map(({ year, month }) => (
            <MonthGrid
              key={`${year}-${month}`}
              year={year}
              month={month}
              activeDays={activeDays}
              todayStr={todayStr}
              selected={selected}
              onSelect={setSelected}
            />
          ))}
        </div>
      )}

      {/* List view */}
      {view === "list" && (
        <div className="space-y-14">
          {weekends.length === 0 && (
            <p className="text-center font-label text-sm text-gray-400 py-20">
              No hay roles asignados para los próximos tres meses.
            </p>
          )}
          {weekends.map(([sundayKey, { sat, satDate, sun, sunDate }]) => {
            const label = new Date(sundayKey + "T12:00:00").toLocaleDateString("es-ES", {
              month: "long", day: "numeric",
            });
            const monthYear = new Date(sundayKey + "T12:00:00").toLocaleDateString("es-ES", {
              year: "numeric", month: "long",
            });

            return (
              <div key={sundayKey}>
                <div className="flex items-center gap-4 mb-6">
                  <div className="flex-1 h-px bg-[#003572]/20 dark:bg-[#00bfff]/10" />
                  <div className="text-center shrink-0">
                    <p className="font-display text-base md:text-lg font-bold uppercase">{label}</p>
                    <p className="font-label text-[10px] md:text-xs uppercase tracking-widest text-gray-500">{monthYear}</p>
                  </div>
                  <div className="flex-1 h-px bg-[#003572]/20 dark:bg-[#00bfff]/10" />
                </div>

                <div className={`grid grid-cols-1 gap-6 ${sat ? "md:grid-cols-2" : "max-w-xl mx-auto"}`}>
                  {sat && satDate && (
                    <DayCard
                      day="Sábado"
                      date={satDate}
                      setlist={sat.setlist}
                      leads={sat.leads}
                      instruments={sat.instruments}
                      fohTeam={sat.fohTeam}
                      bgvs={sat.bgvs}
                      chorus={sat.chorus}
                    />
                  )}
                  {sun && sunDate && (
                    <DayCard
                      day="Domingo"
                      date={sunDate}
                      setlist={sun.setlist}
                      leads={sun.leads}
                      instruments={sun.instruments}
                      fohTeam={sun.fohTeam}
                      bgvs={sun.bgvs}
                      chorus={sun.chorus}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal (calendar view) */}
      {selectedData && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={dismiss}
        >
          <div
            className="w-full max-w-md max-h-[88vh] overflow-y-auto rounded-xl scrollbar-hide"
            onClick={(e) => e.stopPropagation()}
          >
            <DayCard
              day={selectedData.day}
              date={selectedData.date}
              setlist={selectedData.setlist}
              leads={selectedData.leads}
              instruments={selectedData.instruments}
              fohTeam={selectedData.fohTeam}
              bgvs={selectedData.bgvs}
              chorus={selectedData.chorus}
            />
            <button
              onClick={dismiss}
              className="mt-3 w-full font-label text-xs uppercase tracking-widest text-gray-500 hover:text-gray-300 transition-colors py-2"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Month grid ───────────────────────────────────────────────────────────────

function MonthGrid({
  year, month, activeDays, todayStr, selected, onSelect,
}: {
  year: number;
  month: number;
  activeDays: Record<string, ActiveDay>;
  todayStr: string;
  selected: string | null;
  onSelect: (d: string) => void;
}) {
  const daysInMonth = getDaysInMonth(year, month);
  const offset = firstDayOffset(year, month);

  const cells: (number | null)[] = [
    ...Array(offset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div>
      <h3 className="font-display text-base md:text-lg font-bold uppercase text-center mb-4 tracking-wide">
        {MONTH_NAMES[month]} {year}
      </h3>
      <div className="grid grid-cols-7 gap-1">
        {DAY_HEADERS.map((h) => (
          <div key={h} className="font-label text-[10px] uppercase tracking-widest text-gray-500 text-center pb-2">
            {h}
          </div>
        ))}
        {cells.map((day, i) => {
          if (!day) return <div key={i} className="aspect-square" />;

          const dateStr = toDateStr(year, month, day);
          const active = activeDays[dateStr];
          const isSelected = selected === dateStr;
          const isToday = dateStr === todayStr;
          const isSat = active?.day === "Sábado";

          let cls = "aspect-square flex flex-col items-center justify-center rounded-lg text-sm font-label transition-colors relative ";

          if (isSelected) {
            cls += isSat ? "bg-[#f59e0b] text-black font-bold" : "bg-[#00bfff] text-black font-bold";
          } else if (active) {
            cls += isSat
              ? "bg-[#78350f]/50 border border-[#f59e0b]/50 text-[#f59e0b] cursor-pointer hover:bg-[#78350f]/80 hover:border-[#f59e0b]"
              : "bg-[#003572]/50 border border-[#00bfff]/50 text-[#00bfff] cursor-pointer hover:bg-[#003572]/80 hover:border-[#00bfff]";
          } else {
            cls += "text-gray-600 dark:text-gray-600 cursor-default";
          }

          return (
            <button
              key={i}
              disabled={!active}
              onClick={() => active && onSelect(dateStr)}
              className={cls}
            >
              {day}
              {isToday && (
                <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-current opacity-60" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
