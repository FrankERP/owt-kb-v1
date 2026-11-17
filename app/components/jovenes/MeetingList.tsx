"use client";

// Jóvenes' Calendario (`/jovenes/calendario`): every meeting to come, two ways. «Lista» is the
// meetings as folded cards under their month (ADR-0086; none is opened here, that is Inicio's) and
// «Mes» is a month grid with the day's meetings under it (`MonthBoard`). Over both, a filter when
// there is something to choose between («Todas», «Me toca», one chip per audience in its colour):
// it belongs to the page, not to a view, so switching the view never loses it. Filtering reflows
// the cards (`AnimatedList`: leavers fade, the others slide into place) instead of swapping the page.
//
// Until 2026-11-17 this list WAS `/jovenes`. Frank: everything sat on one screen; now «Inicio»
// shows what is next and this page holds the whole horizon.
//
// The rules — which filters exist, what one keeps, the rows — are `jovenesMeetingList.ts`'s; this
// only draws them. Every meeting was read in member mode, so a filter hides only what the reader
// may already see.
import { useState } from "react";
import AnimatedList from "@/app/components/ui/AnimatedList";
import Button from "@/app/components/ui/Button";
import { SHEET_TITLE } from "@/app/utils/homeHero";
import { applyFilter, filterOptions, listRows } from "@/app/utils/jovenesMeetingList";
import { revealProps } from "@/app/utils/reveal";
import SegmentedControl from "@/app/components/ui/SegmentedControl";
import JovenesMeetingCard from "./MeetingCard";
import JovenesMonthBoard from "./MonthBoard";
import type { JovenesListItem } from "./meetingItems";

export type { JovenesListItem } from "./meetingItems";

type Mode = "list" | "month";

export default function JovenesMeetingList({
  items,
  today,
}: {
  items: JovenesListItem[];
  /** CDMX today, `YYYY-MM-DD`, as the server computed it: the month grid's «hoy» and first month. */
  today: string;
}) {
  const [mode, setMode] = useState<Mode>("list");
  // Whether the reader ever changed the view: coming BACK to the list must not replay the stagger.
  const [switched, setSwitched] = useState(false);
  // `null` until the reader picks a filter. Until then the rows carry the route reveal's stagger;
  // after, they do not (nor after a change of view, which mounts the list again) — a row that re-enters under a filter would otherwise mount with
  // `[data-reveal]` again and wait out its stagger delay on top of `AnimatedList`'s own fade.
  const [picked, setPicked] = useState<string | null>(null);
  const filter = picked ?? "all";
  const reveal = (i: number) => (picked === null && !switched ? revealProps(i) : {});
  const listed = items.map((it) => ({ id: it.event._id, date: it.event.date, audience: it.event.audience, mine: it.mine.length > 0, item: it }));
  const options = filterOptions(listed);
  // A refresh can take the chosen audience away (its last meeting passed): back to everything.
  const active = options.some((o) => o.value === filter) ? filter : "all";
  const kept = applyFilter(listed, active);
  const rows = listRows(kept);

  return (
    <div>
      {/* The view, then the filter: on a phone the control sits alone on its line and the pills
          scroll under it; from `sm` they share one, the filter on the left. */}
      <div className="mb-6 sm:mb-8 sm:flex sm:items-start sm:justify-between sm:gap-6" {...revealProps(1)}>
        <SegmentedControl
          label="Vista"
          tone="filled"
          value={mode}
          onChange={(v) => {
            setSwitched(true);
            setMode(v);
          }}
          options={[
            { value: "list", label: "Lista" },
            { value: "month", label: "Mes" },
          ]}
          className="mb-4 sm:order-2 sm:mb-0 sm:shrink-0"
        />
        {options.length > 0 && (
          // One line that scrolls sideways on a phone (it bleeds to the screen's edge, so a cut
          // chip says «there is more»); it wraps from `sm`, where there is room.
          <div
            role="group"
            aria-label="Filtrar reuniones"
            className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] sm:order-1 sm:mx-0 sm:min-w-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden"
          >
            {options.map((o) => (
              <Button key={o.value} variant="pill" size="sm" active={active === o.value} onClick={() => setPicked(o.value)} className="shrink-0 whitespace-nowrap py-1.5">
                {o.tone && o.value !== "ministry" && <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${o.tone.solid}`} />}
                {o.label}
                <span className="tabular-nums opacity-70">{o.count}</span>
              </Button>
            ))}
          </div>
        )}
      </div>
      {mode === "month" ? (
        <JovenesMonthBoard items={kept.map((m) => m.item)} today={today} />
      ) : (
        <AnimatedList
          className="space-y-3"
          items={rows.map((row, i) =>
            row.kind === "label"
              ? {
                  key: row.key,
                  node: (
                    <h2 className={`${SHEET_TITLE} flex items-center gap-3 ${i === 0 ? "" : "pt-7"}`} {...reveal(2 + i)}>
                      {row.title}
                      <span aria-hidden="true" className="h-px flex-1 bg-ink/[0.10]" />
                      <span className="tabular-nums tracking-normal">{row.count}</span>
                    </h2>
                  ),
                }
              : {
                  key: row.key,
                  node: (
                    <div {...reveal(2 + i)}>
                      <JovenesMeetingCard event={row.meeting.item.event} entry={row.meeting.item.entry} mine={row.meeting.item.mine} countdown={row.meeting.item.countdown}>
                        {row.meeting.item.editor}
                      </JovenesMeetingCard>
                    </div>
                  ),
                },
          )}
        />
      )}
    </div>
  );
}
