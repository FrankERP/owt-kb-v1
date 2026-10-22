// app/components/DayDots.tsx
// The calendar's one colour device (ADR-0067): a day that carries a service shows a
// 5 px dot per service in the agenda's tone vocabulary (`TONE_RAIL`), under the
// number, on a NEUTRAL cell — never a tinted fill. The strip and the month grid
// both render this row, so the two views can never disagree about what a colour
// means, and a Sunday that also hosts a special shows two dots instead of a
// "several services" corner mark the legend had to explain.
//
// `onFill` is the selected cell (the grid's accent fill): every dot turns the
// base colour, since a tone dot on the accent would read as a fourth colour.
// NEUTRAL module — no hooks — so a Server Component could render it.
import { TONE_RAIL, type Tone } from "../utils/agenda";

/** Past this many services the row stops growing — three same-day sets is the realistic ceiling. */
const MAX_DOTS = 3;

export default function DayDots({ tones, onFill = false }: { tones: Tone[]; onFill?: boolean }) {
  if (tones.length === 0) return null;
  return (
    <span aria-hidden className="flex items-center justify-center gap-[3px]" data-testid="day-dots">
      {tones.slice(0, MAX_DOTS).map((tone, i) => (
        <span key={i} className={`h-[5px] w-[5px] rounded-full ${onFill ? "bg-surface-base" : TONE_RAIL[tone]}`} />
      ))}
    </span>
  );
}

/** The cell classes the strip and the grid share, so a lit day looks the same in both. */
export const DAY_CELL_BASE =
  "relative flex flex-col items-center justify-center rounded-lg transition-[color,background-color,border-color,box-shadow,transform] duration-fast ease-out-brand";
/** A day with a service: a raised, neutral surface that can be pressed. */
export const DAY_CELL_LIT =
  "bg-surface-card border border-ink/10 text-ink cursor-pointer active:scale-[0.94] hover:border-accent/60";
/** A day with nothing on it: just the number, not an affordance. */
export const DAY_CELL_EMPTY = "text-mono-400 cursor-default";
/** Today: a thin inset accent ring, whatever the day carries. */
export const DAY_CELL_TODAY = "ring-1 ring-inset ring-accent/50";
/** Today while SELECTED: an accent ring would vanish on the accent fill, so it turns base. */
export const DAY_CELL_TODAY_ON_FILL = "ring-1 ring-inset ring-surface-base/70";
/** The grid's selected day: the accent fill, with the dots turned base (`onFill`). */
export const DAY_CELL_SELECTED = "bg-accent text-surface-base font-bold cursor-pointer active:scale-[0.94]";
