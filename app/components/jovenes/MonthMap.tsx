// Planear Jóvenes' month at a glance: a small calendar with a dot per meeting in its audience's
// colour — the accent for all of Jóvenes, a group's own for a group meeting, hollow while it is a
// draft —
// and a legend under it (ADR-0087). It is a PICTURE of the month, not a control: the cards below
// are where a meeting is opened, so the grid is one image to a screen reader, named by its count.
//
// NEUTRAL — no hooks.
import { audienceBadges, type AudienceTone } from "../../utils/jovenesGroupStyle";
import type { MinistryEventView } from "../../utils/ministryEventReads";
import { plural } from "../../utils/plural";

const HEADS = ["L", "M", "M", "J", "V", "S", "D"];

type Mark = { key: string; tone: AudienceTone; draft: boolean };

export default function MonthMap({
  month,
  events,
  today,
}: {
  /** `YYYY-MM`. */
  month: string;
  events: ReadonlyArray<Pick<MinistryEventView, "_id" | "date" | "audience" | "published">>;
  /** CDMX today, `YYYY-MM-DD`, as the server computed it. */
  today: string;
}) {
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const offset = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // Monday first, as the Calendario
  const marks = new Map<number, Mark[]>();
  const legend = new Map<string, { label: string; tone: AudienceTone }>();
  for (const e of events) {
    if (e.date.slice(0, 7) !== month) continue;
    const day = Number(e.date.slice(8, 10));
    const list = marks.get(day) ?? [];
    for (const b of audienceBadges(e.audience)) {
      list.push({ key: `${e._id}-${b.key}`, tone: b.tone, draft: !e.published });
      if (!legend.has(b.key)) legend.set(b.key, { label: b.label, tone: b.tone });
    }
    marks.set(day, list);
  }
  const cells: Array<number | null> = [...Array<null>(offset).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const count = events.filter((e) => e.date.slice(0, 7) === month).length;

  return (
    <div className="brand-surface rounded-[var(--brand-radius-panel)] p-4">
      <div role="img" aria-label={`Mapa del mes: ${plural(count, "reunión", "reuniones")}`} className="grid grid-cols-7 gap-y-1">
        {HEADS.map((h, i) => (
          <span key={i} className="pb-1 text-center font-label text-[10px] uppercase tracking-[0.12em] text-ink-dim">
            {h}
          </span>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <span key={`b${i}`} />;
          const list = marks.get(day) ?? [];
          const isToday = `${month}-${String(day).padStart(2, "0")}` === today;
          return (
            <span key={day} className="flex h-9 flex-col items-center justify-start gap-[3px]">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full font-body text-[13px] tabular-nums ${
                  list.length > 0 ? "font-semibold text-ink" : "text-ink-dim"
                } ${isToday ? "ring-1 ring-accent" : ""}`}
              >
                {day}
              </span>
              <span className="flex h-1.5 items-center gap-[3px]">
                {list.slice(0, 3).map((mark) => (
                  <span
                    key={mark.key}
                    className={`h-1.5 w-1.5 rounded-full ${mark.draft ? `border ${mark.tone.edge}` : mark.tone.solid}`}
                  />
                ))}
              </span>
            </span>
          );
        })}
      </div>
      {legend.size > 0 && (
        <ul className="mt-3 flex flex-wrap gap-x-3.5 gap-y-1.5 border-t border-ink/[0.08] pt-3 font-body text-[13px] leading-tight text-ink-muted">
          {[...legend.entries()].map(([key, l]) => (
            <li key={key} className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className={`h-2 w-2 rounded-full ${l.tone.solid}`} />
              {l.label}
            </li>
          ))}
          {events.some((e) => e.date.slice(0, 7) === month && !e.published) && (
            <li className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="h-2 w-2 rounded-full border border-ink-muted" />
              Borrador
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
