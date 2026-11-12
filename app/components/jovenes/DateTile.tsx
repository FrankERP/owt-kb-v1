// A meeting's date as a calendar leaf: the weekday on a band in the audience's colour, the day
// number in the display face, the month under it (ADR-0087). It is what lets eight meetings read
// as eight DAYS at a glance instead of eight lines of text, and it is the same object on `/jovenes`
// and in Planear Jóvenes. The full date is there for a screen reader; the three parts are drawn.
//
// NEUTRAL — no hooks — so either side of the boundary can render it.
import { DOW_SHORT, dayTitle } from "../../utils/agenda";
import type { AudienceTone } from "../../utils/jovenesGroupStyle";

const MONTH_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

const SIZE = {
  md: { box: "w-[58px]", band: "py-[3px] text-[10px]", day: "pt-1.5 text-[28px]", month: "pb-1.5 pt-0.5 text-[10px]" },
  // The featured card's leaf: `md` on a phone (the title beside it needs the width), larger from `md`.
  lg: {
    box: "w-[58px] md:w-[72px]",
    band: "py-[3px] text-[10px] md:py-1 md:text-[11px]",
    day: "pt-1.5 text-[28px] md:pt-2 md:text-[38px]",
    month: "pb-1.5 pt-0.5 text-[10px] md:pb-2 md:pt-1 md:text-[11px]",
  },
} as const;

export default function DateTile({
  date,
  tone,
  size = "md",
  empty = false,
  className = "",
}: {
  /** `YYYY-MM-DD`; read at UTC noon, so the day never slips. */
  date: string;
  tone: AudienceTone;
  size?: keyof typeof SIZE;
  /** A day with no meeting yet (the planner's free Saturday): an outline, no colour. */
  empty?: boolean;
  className?: string;
}) {
  const d = new Date(`${date}T12:00:00Z`);
  const s = SIZE[size];
  return (
    <time
      dateTime={date}
      className={`flex shrink-0 flex-col self-start overflow-hidden rounded-xl border text-center ${s.box} ${
        empty ? "border-dashed border-ink/20" : "border-ink/[0.12] bg-surface-base/60"
      } ${className}`}
    >
      <span className="sr-only">{dayTitle(date)}</span>
      <span aria-hidden="true" className={`font-label uppercase tracking-[0.16em] ${s.band} ${empty ? "text-ink-dim" : `${tone.wash} ${tone.ink}`}`}>
        {DOW_SHORT[d.getUTCDay()]}
      </span>
      <span aria-hidden="true" className={`font-display font-semibold leading-none tabular-nums ${s.day} ${empty ? "text-ink-dim" : "text-ink"}`}>
        {d.getUTCDate()}
      </span>
      <span aria-hidden="true" className={`font-label uppercase tracking-[0.16em] text-ink-dim ${s.month}`}>{MONTH_SHORT[d.getUTCMonth()]}</span>
    </time>
  );
}
