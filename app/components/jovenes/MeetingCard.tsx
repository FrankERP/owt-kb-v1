"use client";

// One meeting on `/jovenes`, as a card (ADR-0087): the date as a calendar leaf, the meeting's
// name as the card's title, clock and place with their icons, who it is for as coloured chips,
// «Tú · …» in the app's one green, and a rail in the audience's colour. The NEXT meeting
// (`featured`) opens with its team, program and notes showing and takes the one light pass
// around its border (`.brand-lit-card`, the beam's site for a framed surface); the others fold to
// a summary — faces and whether there is a program — and open on a tap. That fold is what stops
// eight meetings from reading as one table: each is an object with an edge.
//
// The whole head is the disclosure's hit area (the round chevron's `after:` covers it), so the
// button stays a button and the heading stays a heading. That button gives up the house press
// (`active:!transform-none`): a transform makes an element the containing block of its own
// `::after`, so while pressed the stretched area shrank back to the 36 px circle and a tap on the
// title released OUTSIDE the button — no click, the card stayed folded (review, 2026-11-12).
// The heading carries the date for a screen reader (the leaf beside it is `decorative`), so a
// list of «Sábado de Jóvenes» can be told apart by heading navigation. `children` is the program
// editor, when the reader may edit this meeting's program (decided on the server).
import { useId, useState } from "react";
import Collapse from "@/app/components/ui/Collapse";
import Button from "@/app/components/ui/Button";
import { ChevronDownIcon, NoteIcon } from "@/app/components/ui/icons";
import type { MinistryEventView } from "@/app/utils/ministryEventReads";
import type { JovenesDayEntry } from "@/app/components/CalendarView";
import { audienceTone } from "@/app/utils/jovenesGroupStyle";
import { dayTitle } from "@/app/utils/agenda";
import { eventHeading } from "@/app/utils/jovenesEventView";
import { plural } from "@/app/utils/plural";
import AudienceChips from "./AudienceChips";
import AudienceRail from "./AudienceRail";
import DateTile from "./DateTile";
import JovenesMeetingBody from "./MeetingBody";
import MeetingMeta from "./MeetingMeta";
import PersonAvatar from "./PersonAvatar";

/** The «tú» chip, class for class the Calendario's and the Inicio row's: one signal everywhere. */
const MINE_CHIP =
  "rounded-full border border-positive-fg/35 bg-positive-fg/10 px-2.5 py-0.5 font-label text-[10px] uppercase tracking-widest text-positive-fg";
/** What the card draws of a meeting — the page sends only this to the browser, not the whole view
 *  (ids of every seat's member, the creator, the revision), which only the program editor needs. */
export type MeetingCardEvent = Pick<MinistryEventView, "_id" | "date" | "time" | "arrival" | "place" | "title" | "kind" | "audience">;

const COUNTDOWN_CHIP =
  "rounded-full border border-ink/[0.16] px-2.5 py-0.5 font-label text-[10px] uppercase tracking-widest text-ink-muted";

export default function JovenesMeetingCard({
  event: e,
  entry,
  mine,
  countdown,
  featured = false,
  children,
}: {
  event: MeetingCardEvent;
  entry: JovenesDayEntry;
  /** The reader's seats and program lines on this meeting, as labels. */
  mine: string[];
  /** «Hoy», «Mañana», «En 3 días». */
  countdown: string;
  /** The next meeting: open at first, larger, lit once. */
  featured?: boolean;
  children?: React.ReactNode;
}) {
  const bodyId = useId();
  // `null` until the reader touches the fold, so the card follows `featured` — when a filter
  // makes another meeting the next one, that one opens without a second state to keep in step.
  const [toggled, setToggled] = useState<boolean | null>(null);
  // A meeting with only a note has nothing to unfold: the note shows on the card itself.
  const hasBody = entry.seats.length > 0 || entry.program.length > 0 || !!children;
  const open = hasBody && (toggled ?? featured);
  const tone = audienceTone(e.audience);
  const faces = entry.seats.filter((s) => s.name);

  const card = (
    <article
      aria-label={`${eventHeading(e)}, ${countdown.toLowerCase()}`}
      className="brand-surface relative overflow-hidden rounded-[var(--brand-radius-panel)] transition-[border-color] duration-fast ease-out-brand hover:border-ink/20"
    >
      <AudienceRail audience={e.audience} />
      <div className={`relative flex gap-3.5 py-4 pl-5 pr-4 ${featured ? "md:gap-5 md:py-5 md:pl-6 md:pr-5" : ""}`}>
        <DateTile date={e.date} tone={tone} size={featured ? "lg" : "md"} decorative />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <h3
              className={`min-w-0 break-words font-display font-semibold uppercase leading-none tracking-[0.02em] text-ink ${
                featured ? "pt-0.5 text-[22px] md:text-[32px]" : "pt-0.5 text-[22px] md:text-2xl"
              }`}
            >
              {eventHeading(e)}
              <span className="sr-only">, {dayTitle(e.date)}</span>
            </h3>
            {hasBody && (
              // The stretched `after:` makes the whole head the hit area; the ring stays here.
              <Button
                variant="round"
                aria-expanded={open}
                aria-controls={bodyId}
                aria-label={open ? "Ocultar detalles" : "Ver detalles"}
                onClick={() => setToggled(!open)}
                className="-mr-1 -mt-1 !h-9 !w-9 after:absolute after:inset-0 after:content-[''] active:!transform-none"
              >
                <ChevronDownIcon size={16} className={`transition-transform duration-base ease-out-brand ${open ? "rotate-180" : ""}`} />
              </Button>
            )}
          </div>
          <MeetingMeta time={e.time} arrival={e.arrival} place={e.place} />
          {/* One block, so the folded summary's gap closes with it: a closed Collapse is a
              zero-height child and a `space-y` parent would still reserve its gap. */}
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <AudienceChips audience={e.audience} />
              {featured && <span className={COUNTDOWN_CHIP}>{countdown}</span>}
              {mine.length > 0 && <span className={MINE_CHIP}>Tú · {mine.join(" · ")}</span>}
            </div>
            {/* Folded, the card still says who is on it and whether there is a program. */}
            {hasBody ? (
              <Collapse open={!open}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-2.5 font-body text-[14px] leading-snug text-ink-dim">
                  {faces.length > 0 && (
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <span className="flex -space-x-1.5">
                        {faces.slice(0, 4).map((s) => (
                          <PersonAvatar key={s.key} name={s.name} mine={s.mine} size="sm" className="ring-2 ring-surface-card" />
                        ))}
                      </span>
                      <span className="min-w-0 truncate">
                        {faces.length === 1 ? `${faces[0].label} · ${faces[0].name}` : faces.map((s) => s.name).join(", ")}
                      </span>
                    </span>
                  )}
                  {entry.program.length > 0 && <span className="whitespace-nowrap">Programa · {plural(entry.program.length, "parte", "partes")}</span>}
                  {entry.notes && (
                    <span className="inline-flex items-center gap-1 whitespace-nowrap">
                      <NoteIcon size={12} />
                      Nota
                    </span>
                  )}
                </div>
              </Collapse>
            ) : (
              entry.notes && <p className="whitespace-pre-line break-words pt-2.5 font-body text-[15px] leading-snug text-ink-muted">{entry.notes}</p>
            )}
          </div>
        </div>
      </div>
      {hasBody && (
        <Collapse open={open} id={bodyId}>
          <div className={`border-t border-ink/[0.08] pb-4 pl-5 pr-4 pt-4 ${featured ? "md:pb-5 md:pl-6 md:pr-5" : ""}`}>
            <JovenesMeetingBody entry={entry} teamTitle="Equipo" level={4} columns />
            {children && <div className="mt-4">{children}</div>}
          </div>
        </Collapse>
      )}
    </article>
  );

  // The lit wrapper clips and opens the 1 px gap the light shows through (`brand.css`); it eats
  // the card's own shadow, so only the next meeting — the one that matters today — wears it.
  return featured ? (
    <div className="brand-lit-card" data-lit="">
      {card}
    </div>
  ) : (
    card
  );
}
