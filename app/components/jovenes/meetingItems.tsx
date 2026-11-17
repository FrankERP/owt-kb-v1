// A meeting as the cards of «Inicio» and the Calendario take it: ONE place builds the item for
// both pages, so a card can never say something different on each (2026-11-17, when `/jovenes`
// became two pages). The pages read (`readMinistryEvents`, member mode) and decide who may edit;
// this only shapes what they read.
//
// NEUTRAL — no hooks — so a Server Component calls it. It renders `ProgramEditor` (a client
// component) as JSX, which a server file may do; it never calls it.
import { mySeats } from "../../utils/agenda";
import { jovenesDayEntry } from "../../utils/calendarMinistry";
import { daysUntil, formatCountdown } from "../../utils/daysUntil";
import type { JovenesPerson } from "../../utils/jovenesPeople";
import { showsProgramEditor } from "../../utils/jovenesPlannerModel";
import type { MinistryEventView } from "../../utils/ministryEventReads";
import type { JovenesDayEntry } from "../CalendarView";
import type { MeetingCardEvent } from "./MeetingCard";
import ProgramEditor from "./ProgramEditor";

export type JovenesListItem = {
  event: MeetingCardEvent;
  entry: JovenesDayEntry;
  /** The reader's seats and program lines on this meeting, as labels. */
  mine: string[];
  /** «Hoy», «Mañana», «En 3 días», «Hace 3 días». */
  countdown: string;
  /** The program editor, when this reader may edit this meeting's program. */
  editor: React.ReactNode;
};

/** Does any of these meetings show its program editor to this reader? The page then reads the people to pick from. */
export function anyProgramEditor(events: readonly MinistryEventView[], isManager: boolean, today: string): boolean {
  return events.some((e) => e.date >= today && showsProgramEditor(e, isManager));
}

/**
 * The items, in the order the meetings came. «Editar programa» goes to an admin and to the
 * encargado or apoyo of a whole-ministry meeting (W3a) — cosmetic, the program PATCH decides again
 * on the stored event — and only on a meeting still to come: one already held is a record.
 */
export function jovenesMeetingItems(
  events: readonly MinistryEventView[],
  opts: { isManager: boolean; people: readonly JovenesPerson[]; today: string },
): JovenesListItem[] {
  return events.map((e) => {
    // One shape for the cards here and the Calendario's day sheet, and ONE answer to «what is
    // mine on this meeting» (the agenda's `mySeats`: seats and program lines, by member id).
    const entry = jovenesDayEntry(e);
    return {
      // Only what a card draws crosses to the browser; the whole view (member ids, the revision)
      // goes to `ProgramEditor` alone, for a meeting this reader may edit.
      event: { _id: e._id, date: e.date, time: e.time, arrival: e.arrival, place: e.place, title: e.title, kind: e.kind, audience: e.audience },
      entry,
      mine: mySeats({ jovenes: entry }, ""),
      countdown: formatCountdown(daysUntil(e.date)),
      editor: e.date >= opts.today && showsProgramEditor(e, opts.isManager) ? <ProgramEditor event={e} people={opts.people} /> : null,
    };
  });
}
