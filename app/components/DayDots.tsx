// app/components/DayDots.tsx
// The calendar's one colour device (ADR-0067): a day that carries a service shows a
// 5 px dot per service in the agenda's tone vocabulary (`TONE_RAIL`), under the
// number, on a NEUTRAL cell — never a tinted fill. The strip and the month grid
// both render this row, so the two views can never disagree about what a colour
// means, and a Sunday that also hosts a special shows two dots instead of a
// "several services" corner mark the legend had to explain.
//
// `mine` adds a fourth dot in the app's one green (the «millones» pass, 2026-10-24):
// the day the signed-in member serves used to paint its NUMBER positive, which made
// «tú» look like a second kind of day; as a dot it sits in the same row as the day's
// other facts, and the legend can name it («Te toca»).
// NEUTRAL module — no hooks — so a Server Component could render it.
import { TONE_RAIL, type Tone } from "../utils/agenda";

/** Past this many services the row stops growing — three same-day sets is the realistic ceiling. */
const MAX_DOTS = 3;

export default function DayDots({ tones, mine = false }: { tones: Tone[]; mine?: boolean }) {
  if (tones.length === 0 && !mine) return null;
  return (
    <span aria-hidden className="flex h-[5px] items-center justify-center gap-[3px]" data-testid="day-dots">
      {tones.slice(0, MAX_DOTS).map((tone, i) => (
        <span key={i} className={`h-[5px] w-[5px] rounded-full ${TONE_RAIL[tone]}`} />
      ))}
      {mine && <span className="h-[5px] w-[5px] rounded-full bg-positive-fg" data-mine="" />}
    </span>
  );
}

/** The day-number circle the strip and the grid share, so a day looks the same in both
 *  (the «millones» pass): the number in the display face, no card around it; the dots
 *  sit UNDER the circle, outside it, so a fill never recolours them. */
export const DAY_CELL_BASE =
  "relative flex items-center justify-center rounded-full font-display font-semibold leading-none tabular-nums transition-[color,background-color,box-shadow,transform] duration-fast ease-out-brand";
/** A day with a service: ink, pressable. */
export const DAY_CELL_LIT = "text-ink cursor-pointer hover:text-accent active:scale-[0.94]";
/** A day with a service the fetch already passed (a browsed month): still pressable, quieter. */
export const DAY_CELL_LIT_PAST = "text-ink-muted cursor-pointer hover:text-accent active:scale-[0.94]";
/** A day with nothing on it: just the number, not an affordance. */
export const DAY_CELL_EMPTY = "text-mono-400 cursor-default";
/** Today: a thin inset ink ring, whatever the day carries. */
export const DAY_CELL_TODAY = "ring-1 ring-inset ring-ink/70";
/** Today while SELECTED: an ink ring reads as a border on the accent fill, so it turns base. */
export const DAY_CELL_TODAY_ON_FILL = "ring-1 ring-inset ring-surface-base/70";
/** The grid's selected day: the accent fill. */
export const DAY_CELL_SELECTED = "bg-accent text-surface-base cursor-pointer active:scale-[0.94]";
