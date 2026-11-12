"use client";

// The list on `/jovenes`: a filter when there is something to choose between («Todas», «Me toca»,
// one chip per audience in its colour) and the meetings as cards under section labels — the next
// one first, the rest by month (ADR-0087). Filtering reflows the cards (`AnimatedList`: leavers
// fade, the others slide into place) instead of swapping the page.
//
// The rules — which filters exist, what one keeps, the rows — are `jovenesMeetingList.ts`'s; this
// only draws them. Every meeting was read in member mode, so a filter hides only what the reader
// may already see.
import { useState } from "react";
import AnimatedList from "@/app/components/ui/AnimatedList";
import Button from "@/app/components/ui/Button";
import type { JovenesDayEntry } from "@/app/components/CalendarView";
import { SHEET_TITLE } from "@/app/utils/homeHero";
import { applyFilter, filterOptions, listRows } from "@/app/utils/jovenesMeetingList";
import { revealProps } from "@/app/utils/reveal";
import JovenesMeetingCard, { type MeetingCardEvent } from "./MeetingCard";

export type JovenesListItem = {
  event: MeetingCardEvent;
  entry: JovenesDayEntry;
  mine: string[];
  countdown: string;
  /** The program editor, when this reader may edit this meeting's program. */
  editor: React.ReactNode;
};

export default function JovenesMeetingList({ items }: { items: JovenesListItem[] }) {
  // `null` until the reader picks a filter. Until then the rows carry the route reveal's stagger;
  // after, they do not — a row that re-enters under a filter would otherwise mount with
  // `[data-reveal]` again and wait out its stagger delay on top of `AnimatedList`'s own fade.
  const [picked, setPicked] = useState<string | null>(null);
  const filter = picked ?? "all";
  const reveal = (i: number) => (picked === null ? revealProps(i) : {});
  const listed = items.map((it) => ({ id: it.event._id, date: it.event.date, audience: it.event.audience, mine: it.mine.length > 0, item: it }));
  const options = filterOptions(listed);
  // A refresh can take the chosen audience away (its last meeting passed): back to everything.
  const active = options.some((o) => o.value === filter) ? filter : "all";
  const rows = listRows(applyFilter(listed, active));

  return (
    <div>
      {options.length > 0 && (
        // One line that scrolls sideways on a phone (it bleeds to the screen's edge, so a cut chip
        // says «there is more»); it wraps from `sm`, where there is room.
        <div
          role="group"
          aria-label="Filtrar reuniones"
          className="-mx-5 mb-8 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden"
          {...revealProps(1)}
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
      <AnimatedList
        className="space-y-3"
        items={rows.map((row, i) =>
          row.kind === "label"
            ? {
                key: row.key,
                node: (
                  <h2 className={`${SHEET_TITLE} flex items-center gap-3 ${i === 0 ? "" : "pt-7"}`} {...reveal(1 + i)}>
                    {row.title}
                    <span aria-hidden="true" className="h-px flex-1 bg-ink/[0.10]" />
                    {row.count !== null && <span className="tabular-nums tracking-normal">{row.count}</span>}
                  </h2>
                ),
              }
            : {
                key: row.key,
                node: (
                  <div {...reveal(1 + i)}>
                    <JovenesMeetingCard
                      event={row.meeting.item.event}
                      entry={row.meeting.item.entry}
                      mine={row.meeting.item.mine}
                      countdown={row.meeting.item.countdown}
                      featured={row.featured}
                    >
                      {row.meeting.item.editor}
                    </JovenesMeetingCard>
                  </div>
                ),
              },
        )}
      />
    </div>
  );
}
