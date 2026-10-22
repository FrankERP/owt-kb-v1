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
import { DOW_SHORT, monthStripDays, myNameFromSession, TONE_RAIL, type StripDay, type Tone } from "../utils/agenda";
import AgendaView from "./AgendaView";
import DayDots, { DAY_CELL_BASE, DAY_CELL_EMPTY, DAY_CELL_LIT, DAY_CELL_SELECTED, DAY_CELL_TODAY } from "./DayDots";
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

/** The legend's three dots, in the order the week runs (ADR-0067: a dot, not a swatch). */
const LEGEND: ReadonlyArray<readonly [Tone, string]> = [["sat", "Sábado"], ["sun", "Domingo"], ["special", "Especial"]];

function firstDayOffset(year: number, month: number) {
  const dow = new Date(year, month, 1).getDay();
  return (dow + 6) % 7; // Monday-first
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
              {/* Legend — only the grid needs one; the agenda names the day in words.
                  Three dots, no «varios servicios» entry: a day with two services
                  shows two dots, which needs no explaining. */}
              <div className="mb-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
                {LEGEND.map(([tone, label]) => (
                  <span key={tone} className="flex items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 rounded-full ${TONE_RAIL[tone]}`} />
                    <span className="font-label text-[11px] uppercase tracking-widest text-mono-500">{label}</span>
                  </span>
                ))}
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
                    myName={myName}
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
                time={d.time}
                setlist={d.setlist}
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
// grid's own state: the accent fill, with the dots turned base (`DayDots onFill`).
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
  const offset = firstDayOffset(year, month);
  const cells: (StripDay | null)[] = [...Array<null>(offset).fill(null), ...days];
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
        {cells.map((d, i) => {
          if (!d) return <div key={i} className="aspect-square" />;
          const entries = activeDays[d.date] ?? [];
          const isSelected = selected === d.date;

          // §5.2 press: the cell scales under a finger (`DAY_CELL_LIT`), and stays
          // OFF the disabled cells — a day with no service is not an affordance.
          const cls = `${DAY_CELL_BASE} aspect-square gap-px text-sm font-label ${
            isSelected ? DAY_CELL_SELECTED : d.tone ? DAY_CELL_LIT : DAY_CELL_EMPTY
          } ${d.today ? DAY_CELL_TODAY : ""}`;

          return (
            <button
              key={d.date}
              type="button"
              disabled={!d.tone}
              onClick={() => d.tone && onSelect(d.date)}
              aria-current={d.today ? "date" : undefined}
              aria-label={`${new Date(d.date + "T12:00:00").toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" })}${
                entries.length ? `, ${entries.map((e) => e.day).join(", ")}` : ""
              }${d.mine ? ", te toca" : ""}`}
              className={cls}
            >
              <span className={d.mine && !isSelected ? "text-positive-fg font-bold" : ""}>{d.num}</span>
              <DayDots tones={d.tones} onFill={isSelected} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
