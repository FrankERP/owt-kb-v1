"use client";
// app/components/CalendarView.tsx
// The /schedule host (spec §12.3, R2 Task 4). Composition only:
//
//   ScheduleHeader (month, arrows, jump-to-month)
//   DayStrip       (the week, swipeable — pages weeks client-side)
//   Agenda | Mes   (SegmentedControl, agenda by default)
//   AgendaView  ·or·  the month grid + legend
//   CueDialog      (the day sheet, unchanged)
//
// The «Lista» mode and its `getWeekends` weekend-grouping are GONE: the agenda
// answers the same question (which days carry a service, who leads, how many songs)
// in one line per service instead of a stack of full cards, and the sheet still
// carries the full `DayCard` for whichever day is tapped.
//
// The mode crossfade is the RECORDED FALLBACK, not the plan's stacked panels: a
// plain, enter-only fade. `Presence` is KEYED ON THE MODE, so switching unmounts
// one panel and mounts the other (no exit — the whole AnimatePresence goes with it).
// `appear` is `switched` — false until the reader actually flips the
// SegmentedControl — so first paint renders at rest: `Presence appear` above the
// fold is the one thing M0b forbids (ADR-0031), the crossfade exists for switches
// only. The stacked variant needs both panels absolutely positioned inside a host
// of known height, and neither panel here has one: the agenda is as tall as the
// fetch window has services and the grid is three months (one column on a phone),
// so any `min-h` big enough to hold the taller one would leave the shorter one
// sitting in a screenful of blank space. One fade, no height jump, nothing
// overlapping.
//
// `DayStrip` is keyed on `anchorMonth` because it seeds its own week state from the
// props once: a month change is a route push that re-renders this component with new
// props but does NOT remount it, and without the key the strip would keep showing
// the week it was on.
import { useCallback, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { DayCard } from "./DayCard";
import { Setlist } from "../utils/interface";
import { MONTH_NAMES_ES, monthRangeLabel, WINDOW_MONTHS, windowMonths } from "../utils/scheduleMonths";
import { myNameFromSession } from "../utils/agenda";
import AgendaView from "./AgendaView";
import DayStrip from "./DayStrip";
import ScheduleHeader from "./ScheduleHeader";
import CueDialog from "./ui/CueDialog";
import Presence from "./ui/Presence";
import SegmentedControl from "./ui/SegmentedControl";
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
  /** "Today" as the SERVER computed it (CDMX) — the same boundary the fetch used. */
  todayStr: string;
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

// ─── Root component ───────────────────────────────────────────────────────────

export default function CalendarView({ activeDays, viewMonth, todayStr }: Props) {
  const [mode, setMode] = useState<"agenda" | "month">("agenda");
  // `false` until the reader actually flips the SegmentedControl: first paint
  // renders at rest (M0b — never `appear` above the fold, ADR-0031), the
  // crossfade exists for switches only (ImpersonationBanner's `activeAtLoad`
  // precedent, `ImpersonationBanner.tsx`).
  const [switched, setSwitched] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Derived once here (F1) so `DayStrip`'s dot and `AgendaView`'s own pill (which
  // reads `useSession` directly, same as `DayCard`) can never disagree on who "you" is.
  const { data: session } = useSession();
  const myName = myNameFromSession(session?.user);

  const dismiss = useCallback(() => setSelected(null), []);

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

  // A swipe on the strip brings the agenda along: the first row on or after the new
  // week's Monday scrolls into view. `block: "nearest"` so a row already on screen
  // does not move, and the call is optional — jsdom has no `scrollIntoView` and the
  // gesture must never depend on it (nor on the Mes mode, where no row is rendered).
  const handleWeekChange = useCallback((mondayIso: string) => {
    const rows = panelRef.current?.querySelectorAll<HTMLElement>("[data-date]");
    const target = Array.from(rows ?? []).find((row) => (row.dataset.date ?? "") >= mondayIso);
    target?.scrollIntoView?.({ block: "nearest" });
  }, []);

  return (
    <>
      <ScheduleHeader anchorMonth={anchorMonth} viewMonth={viewMonth} />

      <DayStrip
        key={anchorMonth}
        anchorMonth={anchorMonth}
        activeDays={activeDays}
        todayStr={todayStr}
        onPick={setSelected}
        onWeekChange={handleWeekChange}
        myName={myName}
      />

      <div className="mb-6 flex justify-center">
        <SegmentedControl
          label="Vista"
          tone="filled"
          value={mode}
          onChange={(v) => { setSwitched(true); setMode(v); }}
          options={[
            { value: "agenda", label: "Agenda" },
            { value: "month", label: "Mes" },
          ]}
        />
      </div>

      <div ref={panelRef}>
        <Presence key={mode} show appear={switched} data-testid="mode-panel">
          {mode === "agenda" ? (
            <AgendaView
              activeDays={activeDays}
              todayStr={todayStr}
              onSelect={setSelected}
              emptyMessage={emptyMessage}
            />
          ) : isEmpty ? (
            <p className="py-20 text-center font-label text-sm text-mono-400">{emptyMessage}</p>
          ) : (
            <>
              {/* Legend — only the grid needs one; the agenda names the day in words. */}
              <div className="mb-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
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
            </>
          )}
        </Presence>
      </div>

      {/* Modal (both modes) */}
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

          // §5.2 press: the cell scales under a finger. `transform` joins the
          // transition list so it eases back out, and stays OFF the disabled cells —
          // a day with no service is not an affordance.
          let cls = "aspect-square flex flex-col items-center justify-center rounded-lg text-sm font-label transition-[color,background-color,border-color,transform] duration-fast ease-out-brand relative ";

          if (isSelected) {
            cls += colorKey === "sat" ? "bg-warning-fg text-surface-base font-bold active:scale-[0.94]"
                 : colorKey === "sun" ? "bg-accent text-surface-base font-bold active:scale-[0.94]"
                 : "bg-info-fg text-surface-base font-bold active:scale-[0.94]";
          } else if (hasActive) {
            cls += colorKey === "sat"
              ? "bg-warning-surface/50 border border-warning-fg/50 text-warning-fg cursor-pointer active:scale-[0.94] hover:bg-warning-surface/80 hover:border-warning-fg"
              : colorKey === "special"
              ? "bg-info-surface/50 border border-info-fg/50 text-info-fg cursor-pointer active:scale-[0.94] hover:bg-info-surface/80 hover:border-info-fg"
              : "bg-accent-deep/50 border border-accent/50 text-accent cursor-pointer active:scale-[0.94] hover:bg-accent-deep/80 hover:border-accent";
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
