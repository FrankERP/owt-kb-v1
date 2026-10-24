"use client";
// app/components/CalendarView.tsx
// The /schedule host (spec §12.3, R2 Task 4). Composition only:
//
//   ScheduleHeader (the month as the page title, arrows, the count line, jump-to-month)
//   DayStrip       (the week, swipeable — pages weeks client-side)
//   Agenda | Mes   (SegmentedControl, agenda by default)
//   AgendaView  ·or·  the month grid + legend
//   CueDialog      (the day sheet: the service as a run sheet, `DayCard hero`)
//
// The «Lista» mode and its `getWeekends` weekend-grouping are GONE: the agenda
// answers the same question (which days carry a service, who leads, how many songs)
// in one line per service instead of a stack of full cards, and the sheet still
// carries the full `DayCard` for whichever day is tapped.
//
// The day sheet (the «millones» pass, 2026-10-24) is the SAME run sheet Inicio opens
// on: the long date is the sheet's title, «11:00 · En 2 días» its one line, then
// `DayCard hero` — hairline setlist rows, the folding team, «Ensayar el setlist» —
// instead of the default card with its own uppercase header inside a sheet already
// titled «Detalle del día». Keys stay ink here, not rose: inside a day the date is
// the protagonist, not the song (ADR-0071).
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
import { calendarCountLine, calendarCounts, dayCellLabel, DOW_SHORT, monthStripDays, myNameFromSession, serviceClock, TONE_RAIL, type StripDay } from "../utils/agenda";
import { daysUntil, formatCountdown } from "../utils/daysUntil";
import { SHEET_TITLE } from "../utils/homeHero";
import AgendaView from "./AgendaView";
import DayDots, { DAY_CELL_BASE, DAY_CELL_EMPTY, DAY_CELL_LIT, DAY_CELL_LIT_PAST, DAY_CELL_SELECTED, DAY_CELL_TODAY, DAY_CELL_TODAY_ON_FILL } from "./DayDots";
import DayStrip from "./DayStrip";
import ScheduleHeader from "./ScheduleHeader";
import CueDialog from "./ui/CueDialog";
import Presence from "./ui/Presence";
import SegmentedControl from "./ui/SegmentedControl";

export type ActiveDay = {
  day: string; // "Sábado" | "Domingo" | any special service name
  date: string;
  time?: string | null;
  setlist?: Setlist | null;
  /** The service's «Mensaje del pastor», shown above the team note. */
  pastorMessage?: string | null;
  leads?: string[];
  instruments?: Array<{ label: string; person: string }>;
  fohTeam?: Array<{ label: string; person: string }>;
  bgvs?: Array<{ member_name: string; alias?: string }>;
  chorus?: Array<{ member_name: string; alias?: string }>;
  roleId?: string;
  /** The service document's `_id` (weekend role or special) — the DayCard's «Mensajes». */
  serviceId?: string;
};

interface Props {
  activeDays: Record<string, ActiveDay[]>;
  viewMonth?: string | null; // "YYYY-MM" in browse mode; undefined/null = default rolling view
  /** "Today" as the SERVER computed it (CDMX) — the same boundary the fetch used. */
  todayStr: string;
  /** The day sheet's faces and default-open sections — the same three viewer
   *  props home and /me hand `DayCard` (see `TeamSections`). */
  photos?: Record<string, string>;
  viewerTypes?: string[] | null;
  viewerName?: string;
  viewerIsAdmin?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Monday-first rotation of the strip's own weekday labels — one vocabulary. */
const DAY_HEADERS = [...DOW_SHORT.slice(1), DOW_SHORT[0]];

/** The legend's dots, in the order the week runs (ADR-0067: a dot, not a swatch),
 *  plus the green one for the days the reader serves. */
const LEGEND: ReadonlyArray<readonly [string, string]> = [
  [TONE_RAIL.sat, "Sábado"],
  [TONE_RAIL.sun, "Domingo"],
  [TONE_RAIL.special, "Especial"],
  ["bg-positive-fg", "Te toca"],
];

/** Local-noon render, never a bare `new Date(iso)` — the UTC day-flip rule. */
const fmt = (iso: string, options: Intl.DateTimeFormatOptions) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("es-MX", options);

/** «Domingo 25 de octubre» — es-MX gives the weekday in lowercase; a title starts with a capital. */
function sheetTitle(iso: string): string {
  const s = fmt(iso, { weekday: "long", day: "numeric", month: "long" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Root component ───────────────────────────────────────────────────────────

export default function CalendarView({ activeDays, viewMonth, todayStr, photos, viewerTypes, viewerName, viewerIsAdmin }: Props) {
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
  // `viewerName` covers first paint, before the client session arrives — the count
  // line is server-rendered, and «te toca en 3» must not appear a beat late.
  const { data: session } = useSession();
  const myName = myNameFromSession(session?.user) || viewerName || "";

  const dismiss = useCallback(() => setSelected(null), []);

  const anchorMonth = viewMonth ?? todayStr.slice(0, 7);
  const counts = calendarCountLine(calendarCounts(activeDays, todayStr, myName, !viewMonth), !!viewMonth);

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
  // The sheet's one line under its title, for a day with ONE service: the clock and
  // the countdown (upcoming days only — `todayStr` is the fetch's boundary, and
  // `formatCountdown` only floors a past date). Two same-day sets keep their own
  // identity line inside each card instead (`identity`), since they differ by the clock.
  const selectedDays = selected ? daysUntil(selected) : -1;
  const selectedLine =
    selected && selectedEntries.length === 1
      ? [serviceClock(selectedEntries[0]), selected >= todayStr && selectedDays >= 0 ? formatCountdown(selectedDays) : null].filter(Boolean).join(" · ")
      : "";

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
      <ScheduleHeader anchorMonth={anchorMonth} viewMonth={viewMonth} counts={counts} />

      <DayStrip
        key={anchorMonth}
        anchorMonth={anchorMonth}
        activeDays={activeDays}
        todayStr={todayStr}
        onPick={setSelected}
        onWeekChange={handleWeekChange}
        myName={myName}
      />

      <div className="mb-8 flex justify-center">
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
            <p className="py-20 text-center font-body text-base text-ink-muted">{emptyMessage}</p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-10 md:grid-cols-3">
                {months.map(({ year, month }) => (
                  <MonthGrid
                    key={`${year}-${month}`}
                    year={year}
                    month={month}
                    activeDays={activeDays}
                    todayStr={todayStr}
                    selected={selected}
                    onSelect={setSelected}
                    myName={myName}
                  />
                ))}
              </div>
              {/* Legend — only the grid needs one; the agenda names the day in words.
                  Four dots, no «varios servicios» entry: a day with two services
                  shows two dots, which needs no explaining. Under the months, where
                  the eye arrives after reading them. */}
              <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2">
                {LEGEND.map(([dot, label]) => (
                  <span key={label} className="flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
                    <span className="font-body text-[13px] text-ink-muted">{label}</span>
                  </span>
                ))}
              </div>
            </>
          )}
        </Presence>
      </div>

      {/* The day sheet (both modes): the run sheet, titled by the date. */}
      {selected && selectedEntries.length > 0 && (
        <CueDialog open title={sheetTitle(selected)} label={sheetTitle(selected)} mode="sheet" size="md" onDismiss={dismiss}>
          <div className="max-h-[78svh] space-y-10 overflow-y-auto px-5 pb-8 pt-1 scrollbar-hide">
            {selectedLine && <p className="font-body text-[17px] leading-snug text-ink-dim">{selectedLine}</p>}
            {selectedEntries.map((d, i) => (
              <DayCard
                key={i}
                day={d.day}
                date={d.date}
                time={d.time}
                setlist={d.setlist}
                pastorMessage={d.pastorMessage}
                leads={d.leads}
                instruments={d.instruments}
                fohTeam={d.fohTeam}
                bgvs={d.bgvs}
                chorus={d.chorus}
                roleId={d.roleId}
                serviceId={d.serviceId}
                photos={photos}
                viewerTypes={viewerTypes}
                viewerName={viewerName}
                viewerIsAdmin={viewerIsAdmin}
                hero
                identity={selectedEntries.length > 1}
              />
            ))}
          </div>
        </CueDialog>
      )}
    </>
  );
}

// ─── Month grid ───────────────────────────────────────────────────────────────

// The cells come from `monthStripDays` — the same derivation the week strip uses
// (`weekStripDays`), so tone priority, «tú» and today are decided once in
// `app/utils/agenda.ts` and the grid only lays them out. The selected day is the
// grid's own state: the accent fill on the number's circle; the dots under it keep
// their tones, since they sit outside the circle.
function MonthGrid({
  year, month, activeDays, todayStr, selected, onSelect, myName = "",
}: {
  year: number;
  month: number;
  activeDays: Record<string, ActiveDay[]>;
  todayStr: string;
  selected: string | null;
  onSelect: (d: string) => void;
  myName?: string;
}) {
  const ym = `${year}-${String(month + 1).padStart(2, "0")}`;
  const days = monthStripDays(ym, activeDays, todayStr, myName);
  // Leading blanks from the first day's own weekday label — the same UTC derivation
  // as every other cell fact, not a second local-clock `getDay()`.
  const offset = (DOW_SHORT.indexOf(days[0].dow) + 6) % 7; // Monday-first
  const cells: (StripDay | null)[] = [...Array<null>(offset).fill(null), ...days];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <section aria-label={`${MONTH_NAMES_ES[month]} ${year}`}>
      {/* The month is a section title — the sheet's small caps — not a display heading
          competing with the page title above. */}
      <h3 className={`${SHEET_TITLE} mb-4`}>
        {MONTH_NAMES_ES[month]} {year}
      </h3>
      <div className="grid grid-cols-7 gap-y-1">
        {DAY_HEADERS.map((h) => (
          <div key={h} className="pb-2 text-center font-label text-[11px] uppercase tracking-[0.12em] text-mono-500">
            {h}
          </div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const entries = activeDays[d.date] ?? [];
          const isSelected = selected === d.date;

          // §5.2 press: the circle scales under a finger (`DAY_CELL_LIT`), and stays
          // OFF the disabled cells — a day with no service is not an affordance. A
          // lit day the fetch already passed (a browsed month) is quieter.
          const cls = `${DAY_CELL_BASE} h-9 w-9 text-lg ${
            isSelected ? DAY_CELL_SELECTED : d.lit ? (d.date < todayStr ? DAY_CELL_LIT_PAST : DAY_CELL_LIT) : DAY_CELL_EMPTY
          } ${d.today ? (isSelected ? DAY_CELL_TODAY_ON_FILL : DAY_CELL_TODAY) : ""}`;

          return (
            <div key={d.date} className="flex flex-col items-center gap-0.5">
              <button
                type="button"
                disabled={!d.lit}
                onClick={() => d.lit && onSelect(d.date)}
                aria-current={d.today ? "date" : undefined}
                aria-label={dayCellLabel(d, entries)}
                className={cls}
              >
                {d.num}
              </button>
              <DayDots tones={d.tones} mine={d.mine} />
            </div>
          );
        })}
      </div>
    </section>
  );
}
