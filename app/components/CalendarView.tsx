"use client";

import { useState, useCallback } from "react";
import { DayCard } from "./DayCard";
import { Setlist } from "../utils/interface";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MONTH_NAMES_ES, addMonths, monthRangeLabel, scheduleHref, windowMonths, WINDOW_MONTHS } from "../utils/scheduleMonths";
import CueDialog from "./ui/CueDialog";
import { themeColour } from "@/app/utils/themeColour";

export type ActiveDay = {
  day: string; // "Sábado" | "Domingo" | any special service name
  date: string;
  setlist?: Setlist | null;
  leads?: string[];
  instruments?: Array<{ label: string; person: string }>;
  fohTeam?: Array<{ label: string; person: string }>;
  bgvs?: Array<{ member_name: string; alias?: string }>;
  chorus?: Array<{ member_name: string; alias?: string }>;
  roleId?: string;
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
      if (data.roleId) {
        prev.specials.push({ dateStr, data });
        map.set(sunKey, prev);
      } else if (data.day === "Domingo") {
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

  const router = useRouter();
  const anchorMonth = viewMonth ?? todayStr.slice(0, 7);

  const [todayYear, todayMonth] = todayStr.split("-").map(Number);
  const months = viewMonth
    ? windowMonths(viewMonth, WINDOW_MONTHS).map((ym) => ({
        year: Number(ym.slice(0, 4)),
        month: Number(ym.slice(5, 7)) - 1,
      }))
    : [0, 1, 2].map((offset) => {
        const d = new Date(todayYear, todayMonth - 1 + offset, 1);
        return { year: d.getFullYear(), month: d.getMonth() };
      });

  const isEmpty = Object.keys(activeDays).length === 0;
  const emptyMessage = viewMonth
    ? `No hay servicios en ${monthRangeLabel(viewMonth, WINDOW_MONTHS)}.`
    : "No hay servicios próximos.";

  const selectedEntries = selected ? (activeDays[selected] ?? []) : [];
  const weekends = getWeekends(activeDays);

  return (
    <>
      {/* Month navigation */}
      <div className="flex items-center justify-center gap-4 mb-4">
        <Link
          href={scheduleHref(addMonths(anchorMonth, -WINDOW_MONTHS))}
          aria-label="Meses anteriores"
          className="px-3 py-2 rounded-lg border border-surface-accent-30 font-label text-xs uppercase tracking-widest text-mono-400 hover:text-ink-muted hover:border-accent/40 dark:hover:border-surface-accent-30 transition-colors"
        >
          ‹ Anterior
        </Link>
        <div className="text-center min-w-[13rem]">
          <p className="font-display text-base font-bold uppercase">{monthRangeLabel(anchorMonth, WINDOW_MONTHS)}</p>
          {!viewMonth && (
            <p className="font-label text-[11px] uppercase tracking-widest text-mono-500">Próximos</p>
          )}
        </div>
        <Link
          href={scheduleHref(addMonths(anchorMonth, WINDOW_MONTHS))}
          aria-label="Meses siguientes"
          className="px-3 py-2 rounded-lg border border-surface-accent-30 font-label text-xs uppercase tracking-widest text-mono-400 hover:text-ink-muted hover:border-accent/40 dark:hover:border-surface-accent-30 transition-colors"
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
            className="bg-transparent border border-surface-accent-30 rounded-lg px-3 py-1.5 font-label text-xs text-ink-muted"
          />
        </label>
        {viewMonth && (
          <Link
            href="/schedule"
            className="px-4 py-1.5 rounded-lg border border-accent/40 font-label text-xs uppercase tracking-widest text-accent hover:bg-accent-deep/40 transition-colors"
          >
            Hoy
          </Link>
        )}
      </div>

      {/* View toggle */}
      <div className="flex justify-center mb-8">
        <div className="flex rounded-lg border border-surface-accent-30 overflow-hidden">
          <button
            onClick={() => setView("calendar")}
            aria-pressed={view === "calendar"}
            className={`px-5 py-2 font-label text-xs uppercase tracking-widest transition-colors ${
              view === "calendar"
                ? "bg-surface-accent-solid text-on-fill"
                : "text-mono-500 hover:text-ink-muted"
            }`}
          >
            Calendario
          </button>
          <button
            onClick={() => setView("list")}
            aria-pressed={view === "list"}
            className={`px-5 py-2 font-label text-xs uppercase tracking-widest transition-colors border-l border-accent-deep/30 dark:border-accent/20 ${
              view === "list"
                ? "bg-surface-accent-solid text-on-fill"
                : "text-mono-500 hover:text-ink-muted"
            }`}
          >
            Lista
          </button>
        </div>
      </div>

      {/* Legend */}
      {!isEmpty && view === "calendar" && (
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 mb-8">
          {([
            ["--accent-rgb", "Domingo"],
            ["--warning-fg-rgb", "Sábado"],
            ["--info-fg-rgb", "Especial"],
          ] as const).map(([color, label]) => (
            <span key={label} className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-[4px] border" style={{ borderColor: themeColour(color, 0.502), background: themeColour(color, 0.2) }} />
              <span className="font-label text-[11px] uppercase tracking-widest text-mono-500">{label}</span>
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span className="relative w-3 h-3 rounded-[4px] border border-accent/50 bg-accent-deep/50">
              <span className="absolute top-0 right-0 w-1.5 h-1.5 rounded-full bg-accent" />
            </span>
            <span className="font-label text-[11px] uppercase tracking-widest text-mono-500">Varios servicios</span>
          </span>
        </div>
      )}

      {/* Empty state (owns both grid and list) */}
      {isEmpty && (
        <p className="text-center font-label text-sm text-mono-400 py-20">{emptyMessage}</p>
      )}

      {/* Calendar view */}
      {!isEmpty && view === "calendar" && (
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
                  <div className="flex-1 h-px bg-surface-accent-faint" />
                  <div className="text-center shrink-0">
                    <p className="font-display text-base md:text-lg font-bold uppercase">{label}</p>
                    <p className="font-label text-[11px] md:text-xs uppercase tracking-widest text-mono-500">{monthYear}</p>
                  </div>
                  <div className="flex-1 h-px bg-surface-accent-faint" />
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
                      roleId={data.roleId}
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
                      roleId={sat.roleId}
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
                      roleId={sun.roleId}
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
        <CueDialog open title="Detalle del día" label="Detalle del día" mode="sheet" size="md" onDismiss={dismiss}>
          <div className="max-h-[78svh] space-y-4 overflow-y-auto p-4 scrollbar-hide">
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
                roleId={d.roleId}
              />
            ))}
            <button
              onClick={dismiss}
              className="w-full font-label text-xs uppercase tracking-widest text-mono-500 hover:text-mono-300 transition-colors py-2"
            >
              Cerrar
            </button>
          </div>
        </CueDialog>
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
          <div key={h} className="font-label text-[11px] uppercase tracking-widest text-mono-500 text-center pb-2">
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
          const hasSat = entries?.some(e => !e.roleId && e.day === "Sábado");
          const hasSpecial = entries?.some(e => e.roleId || (e.day !== "Sábado" && e.day !== "Domingo"));
          const hasMultiple = entries && entries.length > 1;

          // Pick display color: if mixed, purple takes priority to signal "multiple"
          const colorKey = hasSpecial ? "special" : hasSat ? "sat" : "sun";

          let cls = "aspect-square flex flex-col items-center justify-center rounded-lg text-sm font-label transition-colors relative ";

          if (isSelected) {
            cls += colorKey === "sat" ? "bg-warning-fg text-surface-base font-bold"
                 : colorKey === "sun" ? "bg-accent text-surface-base font-bold"
                 : "bg-info-fg text-surface-base font-bold";
          } else if (hasActive) {
            cls += colorKey === "sat"
              ? "bg-warning-surface/50 border border-warning-fg/50 text-warning-fg cursor-pointer hover:bg-warning-surface/80 hover:border-warning-fg"
              : colorKey === "special"
              ? "bg-info-surface/50 border border-info-fg/50 text-info-fg cursor-pointer hover:bg-info-surface/80 hover:border-info-fg"
              : "bg-accent-deep/50 border border-accent/50 text-accent cursor-pointer hover:bg-accent-deep/80 hover:border-accent";
          } else {
            cls += "text-mono-400 dark:text-mono-400 cursor-default";
          }

          return (
            <button
              key={i}
              type="button"
              disabled={!hasActive}
              onClick={() => hasActive && onSelect(dateStr)}
              aria-current={isToday ? "date" : undefined}
              aria-label={`${new Date(dateStr + "T12:00:00").toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" })}${
                hasActive ? `, ${entries.map((e) => e.day).join(", ")}` : ""
              }`}
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
