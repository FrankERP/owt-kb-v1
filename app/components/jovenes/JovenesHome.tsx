// «Inicio» de Jóvenes (2026-11-17): the first page a pastor lands on. Frank: «la parte de Pastores
// de Jóvenes está muy simple y todo está en una sola pantalla; hace falta una parte principal donde
// muestre los eventos más recientes, y una de calendario donde se puedan ver todos los próximos».
// So this page is a GLANCE, top to bottom in the order a pastor asks:
//
//   1. «Próxima reunión» — the next one, open and lit, with its team, program and notes.
//   2. «Te toca»         — the reader's next turns, when there are more than that card's own chip.
//   3. «Lo que sigue»    — the few after it, folded, and the door to the Calendario for the rest.
//   4. «Reunión anterior» — the last one held, folded: what was said and who had it.
//
// The whole horizon, the filters and the month grid live in `/jovenes/calendario`. Which meeting
// lands in which block is `jovenesHomeModel.ts`'s; the cards are the Calendario's own
// (`MeetingCard`, ADR-0086), so a meeting looks the same on both pages.
//
// NEUTRAL — no hooks — so the page (a Server Component) renders it.
import Button from "../ui/Button";
import { ArrowRightIcon, CalendarOffIcon } from "../ui/icons";
import { JOVENES_CALENDAR_HREF } from "../navSections";
import { dayTitle } from "../../utils/agenda";
import { SHEET_TITLE } from "../../utils/homeHero";
import { eventHeading } from "../../utils/jovenesEventView";
import { audienceTone } from "../../utils/jovenesGroupStyle";
import type { HomeSections } from "../../utils/jovenesHomeModel";
import { plural } from "../../utils/plural";
import { revealProps } from "../../utils/reveal";
import DateTile from "./DateTile";
import JovenesMeetingCard from "./MeetingCard";
import type { JovenesListItem } from "./meetingItems";

/** The «tú» chip, class for class the meeting card's: one signal everywhere. */
const MINE_CHIP =
  "rounded-full border border-positive-fg/35 bg-positive-fg/10 px-2.5 py-0.5 font-label text-[10px] uppercase tracking-widest text-positive-fg";

function Label({ children, count = null, first = false, reveal }: { children: React.ReactNode; count?: number | null; first?: boolean; reveal: number }) {
  return (
    <h2 className={`${SHEET_TITLE} flex items-center gap-3 pb-3 ${first ? "" : "pt-10"}`} {...revealProps(reveal)}>
      {children}
      <span aria-hidden="true" className="h-px flex-1 bg-ink/[0.10]" />
      {count !== null && <span className="tabular-nums tracking-normal">{count}</span>}
    </h2>
  );
}

/**
 * The reader's next turns as ONE object with the app's green on its rail: each a date leaf, the
 * meeting, how soon, and what they hold there. A card, not rows on the page (ADR-0086): it is the
 * one block that is about the reader, and it has to be found without reading.
 */
function Turns({ turns }: { turns: JovenesListItem[] }) {
  return (
    // The green rail is the list's own `::before`: a `<span>` is not a child a `<ul>` may have.
    <ul className="brand-surface relative divide-y divide-ink/[0.08] overflow-hidden rounded-[var(--brand-radius-panel)] before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-positive-fg">
      {turns.map((t) => (
        <li key={t.event._id} className="flex items-center gap-3.5 py-3.5 pl-5 pr-4">
          <DateTile date={t.event.date} tone={audienceTone(t.event.audience)} decorative />
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="break-words font-display text-[20px] font-semibold uppercase leading-none tracking-[0.02em] text-ink">
              {eventHeading(t.event)}
              <span className="sr-only">, {dayTitle(t.event.date)}</span>
            </p>
            <p className="font-body text-[14px] leading-snug text-ink-dim">
              {t.countdown}
              {t.event.time && <> · {t.event.time}</>}
            </p>
            <p className="flex flex-wrap gap-1.5">
              {t.mine.map((label) => (
                <span key={label} className={MINE_CHIP}>
                  {label}
                </span>
              ))}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function JovenesHome({ sections }: { sections: HomeSections<JovenesListItem> }) {
  const { next, upcoming, later, turns, turnsTotal, previous } = sections;
  // The reveal steps in reading order; a block that is absent takes no step.
  let step = 1;
  const card = (it: JovenesListItem, opts: { featured?: boolean; held?: boolean } = {}) => (
    <div key={it.event._id} {...revealProps(step++)}>
      <JovenesMeetingCard event={it.event} entry={it.entry} mine={it.mine} countdown={it.countdown} {...opts}>
        {it.editor}
      </JovenesMeetingCard>
    </div>
  );

  return (
    <div>
      <Label first reveal={step++}>
        Próxima reunión
      </Label>
      {next ? (
        card(next, { featured: true })
      ) : (
        <div
          className="flex flex-col items-center gap-3 rounded-[var(--brand-radius-panel)] border border-dashed border-ink/[0.16] px-6 py-14 text-center"
          {...revealProps(step++)}
        >
          <CalendarOffIcon size={28} className="text-ink-dim" />
          {/* «Aún no hay» only when there is truly nothing: over «Reunión anterior» it would deny
              the meeting shown right under it. */}
          <p className="font-body text-base text-ink-muted">{previous ? "No hay próximas reuniones publicadas." : "Aún no hay reuniones publicadas."}</p>
        </div>
      )}

      {turns.length > 0 && (
        <>
          {/* The count is every turn ahead, not the three listed: «Te toca 8» is the truth, and the
              Calendario's «Me toca» filter holds the rest. */}
          <Label count={turnsTotal} reveal={step++}>
            Te toca
          </Label>
          <div {...revealProps(step++)}>
            <Turns turns={turns} />
          </div>
        </>
      )}

      {upcoming.length > 0 && (
        <>
          <Label reveal={step++}>Lo que sigue</Label>
          <div className="space-y-3">{upcoming.map((it) => card(it))}</div>
        </>
      )}

      {next && (
        // The door to the whole horizon. It says how many more there are, so «nothing else» and
        // «six more» are not the same button.
        <div className="pt-4" {...revealProps(step++)}>
          <Button href={JOVENES_CALENDAR_HREF} variant="secondary" size="md" className="w-full justify-center sm:w-auto">
            {later > 0 ? `Ver el calendario · ${plural(later, "reunión más", "reuniones más")}` : "Ver el calendario"}
            <ArrowRightIcon size={14} />
          </Button>
        </div>
      )}

      {previous && (
        <>
          <Label reveal={step++}>Reunión anterior</Label>
          {card(previous, { held: true })}
        </>
      )}
    </div>
  );
}
