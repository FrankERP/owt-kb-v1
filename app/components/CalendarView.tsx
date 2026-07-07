"use client";

import { useState, useEffect, useCallback } from "react";
import { DayCard } from "./DayCard";
import { Setlist } from "../utils/interface";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MONTH_NAMES_ES, addMonths, monthLabel, scheduleHref } from "../utils/scheduleMonths";

export type ActiveDay = {
  day: string; // "Sábado" | "Domingo" | any special service name
  date: string;
  setlist?: Setlist | null;
  leads?: string[];
  instruments?: Array<{ label: string; person: string }>;
  fohTeam?: Array<{ label: string; person: string }>;
  bgvs?: Array<{ member_name: string; alias?: string }>;
  chorus?: Array<{ member_name: string; alias?: string }>;
};

interface Props {
  activeDays: Record<string, ActiveDay[]>;
  viewMonth?: string | null; // "YYYY-MM" in browse mode; undefined/null = default rolling view
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

type WeekGroup = {
  sunDate?: string;
  sun?: ActiveDay;
  sat?: ActiveDay;
  satDate?: string;
  specials: Array<{ dateStr: string; data: ActiveDay }>;
};

function getWeekends(activeDays: Record<string, ActiveDay[]>) {
  const map = new Map<string, WeekGroup>();

  const getOrCreate = (key: string): WeekGroup =>
    map.get(key) ?? { specials: [] };

  Object.entries(activeDays).forEach(([dateStr, entries]) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun
    const daysToSun = dow === 0 ? 0 : 7 - dow;
    const sunKey = new Date(Date.UTC(y, m - 1, d + daysToSun)).toISOString().slice(0, 10);

    entries.forEach((data) => {
      const prev = getOrCreate(sunKey);
      if (data.day === "Domingo") {
        map.set(sunKey, { ...prev, sun: data, sunDate: dateStr });
      } else if (data.day === "Sábado") {
        map.set(sunKey, { ...prev, sat: data, satDate: dateStr });
      } else {
        prev.specials.push({ dateStr, data });
        map.set(sunKey, prev);
      }
    });
  });

  return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
}

// ─── Root component ───────────────────────────────────────────────────────────

export default function CalendarView({ activeDays, viewMonth }: Props) {
  // Pin "today" to Mexico City time so the highlight matches the server-fetched
  // schedule data (which is keyed to that timezone); otherwise a user in another
  // timezone near midnight sees the marker on the wrong day.
  const todayStr = new Date().toLocaleDateString("sv", { timeZone: "America/Mexico_City" });
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [selected, setSelected] = useState<string | null>(null);

  const dismiss = useCallback(() => setSelected(null), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") dismiss(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismiss]);

  const router = useRouter();
  const anchorMonth = viewMonth ?? todayStr.slice(0, 7);

  const [todayYear, todayMonth] = todayStr.split("-").map(Number);
  const months = viewMonth
    ? [{ year: Number(viewMonth.slice(0, 4)), month: Number(viewMonth.slice(5, 7)) - 1 }]
    : [0, 1, 2].map((offset) => {
        const d = new Date(todayYear, todayMonth - 1 + offset, 1);
        return { year: d.getFullYear(), month: d.getMonth() };
      });

  const isEmpty = Object.keys(activeDays).length === 0;
  const emptyMessage = viewMonth
    ? `No hay servicios en ${monthLabel(viewMonth)}.`
    : "No hay servicios próximos.";

  const selectedEntries = selected ? (activeDays[selected] ?? []) : [];
  const weekends = getWeekends(activeDays);

  return (
    <>
      {/* Month navigation */}
      <div className="flex items-center justify-center gap-4 mb-4">
        <Link
          href={scheduleHref(addMonths(anchorMonth, -1))}
          aria-label="Mes anterior"
          className="px-3 py-2 rounded-lg border border-[#003572]/30 dark:border-[#00bfff]/20 font-label text-xs uppercase tracking-widest text-gray-400 hover:text-[#C8D8EB] hover:border-[#00bfff]/40 transition-colors"
        >
          ‹ Anterior
        </Link>
        <div className="text-center min-w-[9rem]">
          <p className="font-display text-base font-bold uppercase">{monthLabel(anchorMonth)}</p>
          {!viewMonth && (
            <p className="font-label text-[10px] uppercase tracking-widest text-gray-500">Próximos</p>
          )}
        </div>
        <Link
          href={scheduleHref(addMonths(anchorMonth, 1))}
          aria-label="Mes siguiente"
          className="px-3 py-2 rounded-lg border border-[#003572]/30 dark:border-[#00bfff]/20 font-label text-xs uppercase tracking-widest text-gray-400 hover:text-[#C8D8EB] hover:border-[#00bfff]/40 transition-colors"
        >
          Siguiente ›
        </Link>
      </div>
      <div className="flex items-center justify-center gap-3 mb-8">
        <label className="flex items-center gap-2">
          <span className="sr-only">Ir al mes</span>
          <input
            type="month"
            value={anchorMonth}
            onChange={(e) => { if (e.target.value) router.push(scheduleHref(e.target.value)); }}
            className="bg-transparent border border-[#003572]/30 dark:border-[#00bfff]/20 rounded-lg px-3 py-1.5 font-label text-xs text-[#C8D8EB] [color-scheme:dark]"
          />
        </label>
        {viewMonth && (
          <Link
            href="/schedule"
            className="px-4 py-1.5 rounded-lg border border-[#00bfff]/40 font-label text-xs uppercase tracking-widest text-[#00bfff] hover:bg-[#003572]/40 transition-colors"
          >
            Hoy
          </Link>
        )}
      </div>

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

      {/* Legend */}
      {view === "calendar" && (
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 mb-8">
          {([
            ["#00bfff", "Domingo"],
            ["#f59e0b", "Sábado"],
            ["#a78bfa", "Especial"],
          ] as const).map(([color, label]) => (
            <span key={label} className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-[4px] border" style={{ borderColor: `${color}80`, background: `${color}33` }} />
              <span className="font-label text-[10px] uppercase tracking-widest text-gray-500">{label}</span>
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span className="relative w-3 h-3 rounded-[4px] border border-[#00bfff]/50 bg-[#003572]/50">
              <span className="absolute top-0 right-0 w-1.5 h-1.5 rounded-full bg-[#00bfff]" />
            </span>
            <span className="font-label text-[10px] uppercase tracking-widest text-gray-500">Varios servicios</span>
          </span>
        </div>
      )}

      {/* Empty state (owns both grid and list) */}
      {isEmpty && (
        <p className="text-center font-label text-sm text-gray-400 py-20">{emptyMessage}</p>
      )}

      {/* Calendar view */}
      {!isEmpty && view === "calendar" && (
        <div className={viewMonth ? "max-w-sm mx-auto" : "grid grid-cols-1 md:grid-cols-3 gap-10"}>
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
      {!isEmpty && view === "list" && (
        <div className="space-y-14">
          {weekends.map(([sundayKey, { sat, satDate, sun, sunDate, specials }]) => {
            const label = new Date(sundayKey + "T12:00:00").toLocaleDateString("es-ES", {
              month: "long", day: "numeric",
            });
            const monthYear = new Date(sundayKey + "T12:00:00").toLocaleDateString("es-ES", {
              year: "numeric", month: "long",
            });
            const totalCards = specials.length + (sat ? 1 : 0) + (sun ? 1 : 0);

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

                <div className={`grid grid-cols-1 gap-6 ${totalCards > 1 ? "md:grid-cols-2" : "max-w-xl mx-auto"}`}>
                  {specials.map(({ dateStr, data }) => (
                    <DayCard
                      key={dateStr + data.day}
                      day={data.day}
                      date={dateStr}
                      setlist={data.setlist}
                      leads={data.leads}
                      instruments={data.instruments}
                      fohTeam={data.fohTeam}
                      bgvs={data.bgvs}
                      chorus={data.chorus}
                    />
                  ))}
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
      {selectedEntries.length > 0 && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-overlay-in"
          onClick={dismiss}
        >
          <div
            className="w-full max-w-md max-h-[88vh] overflow-y-auto rounded-xl scrollbar-hide space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            {selectedEntries.map((d, i) => (
              <DayCard
                key={i}
                day={d.day}
                date={d.date}
                setlist={d.setlist}
                leads={d.leads}
                instruments={d.instruments}
                fohTeam={d.fohTeam}
                bgvs={d.bgvs}
                chorus={d.chorus}
              />
            ))}
            <button
              onClick={dismiss}
              className="w-full font-label text-xs uppercase tracking-widest text-gray-500 hover:text-gray-300 transition-colors py-2"
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
  activeDays: Record<string, ActiveDay[]>;
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
        {MONTH_NAMES_ES[month]} {year}
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
          const entries = activeDays[dateStr];
          const hasActive = entries && entries.length > 0;
          const isSelected = selected === dateStr;
          const isToday = dateStr === todayStr;

          // Determine color priority: special > sat > sun
          const hasSat = entries?.some(e => e.day === "Sábado");
          const hasSpecial = entries?.some(e => e.day !== "Sábado" && e.day !== "Domingo");
          const hasMultiple = entries && entries.length > 1;

          // Pick display color: if mixed, purple takes priority to signal "multiple"
          const colorKey = hasSpecial ? "special" : hasSat ? "sat" : "sun";

          let cls = "aspect-square flex flex-col items-center justify-center rounded-lg text-sm font-label transition-colors relative ";

          if (isSelected) {
            cls += colorKey === "sat" ? "bg-[#f59e0b] text-black font-bold"
                 : colorKey === "sun" ? "bg-[#00bfff] text-black font-bold"
                 : "bg-[#a78bfa] text-black font-bold";
          } else if (hasActive) {
            cls += colorKey === "sat"
              ? "bg-[#78350f]/50 border border-[#f59e0b]/50 text-[#f59e0b] cursor-pointer hover:bg-[#78350f]/80 hover:border-[#f59e0b]"
              : colorKey === "special"
              ? "bg-[#4c1d95]/50 border border-[#a78bfa]/50 text-[#a78bfa] cursor-pointer hover:bg-[#4c1d95]/80 hover:border-[#a78bfa]"
              : "bg-[#003572]/50 border border-[#00bfff]/50 text-[#00bfff] cursor-pointer hover:bg-[#003572]/80 hover:border-[#00bfff]";
          } else {
            cls += "text-gray-400 dark:text-gray-400 cursor-default";
          }

          return (
            <button
              key={i}
              disabled={!hasActive}
              onClick={() => hasActive && onSelect(dateStr)}
              className={cls}
            >
              {day}
              {isToday && (
                <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-current opacity-60" />
              )}
              {hasMultiple && !isSelected && (
                <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-current opacity-80" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
