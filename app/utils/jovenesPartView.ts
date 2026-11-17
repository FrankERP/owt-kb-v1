// A Jóvenes meeting's fixed parts as its screens read them (ADR-0089; plan
// `docs/superpowers/plans/2026-11-17-jovenes-meeting-parts.md` U1, U3): for each part of
// `ministryParts.ts`, who answers for it, what they wrote, and whether the reader is one of them.
//
// NEUTRAL — types only from the reader — because the card on `/jovenes`, the Calendario's day
// sheet and the meeting's own page all build on it, so «Dinámica 1 is mine» has ONE answer. It
// decides nothing about access: the part PATCH judges the stored event again (W10).

import type { MinistryEventView } from "./ministryEventReads";
import { MEETING_PARTS, PLATICA_SEAT, hasFixedProgram, type PartId, type PartMusic } from "./ministryParts";

/** A meeting's URL token: its id after the dot. (The id's prefix is never spelled outside the one
 *  reader and the one writer — `ministryEventCoverage.test.ts`.) */
export function meetingToken(id: string): string {
  return id.slice(id.indexOf(".") + 1);
}

/** The page of ONE meeting: where «Llenar mi parte» lands. */
export function meetingPath(id: string): string {
  return `/jovenes/reunion/${meetingToken(id)}`;
}

export type PartPerson = { name: string | null; photo: string | null; mine: boolean };

export type PartView = {
  id: PartId;
  label: string;
  /** Its responsables, in order: the line's one or two people, or — Plática — the `comparte` seats. */
  people: PartPerson[];
  /** The description its responsable wrote (the line's `note`). */
  note: string | null;
  music: PartMusic | null;
  /** «Jóvenes que apoyan», one line of names. */
  helpers: string | null;
  /** The reader is one of its responsables, by member id (decided in the reader's query). */
  mine: boolean;
  /** Whether the meeting stores a line for this part yet. */
  stored: boolean;
};

type Event = Pick<MinistryEventView, "kind" | "seats" | "program">;

/**
 * A meeting's parts, in the order it runs them. The Saturday meeting has all four, stored or not
 * (`hasFixedProgram`). Any other meeting has only the ones it holds: a part with a stored line,
 * and Plática as soon as someone holds a `comparte` seat — the «Te toca» email asks whoever
 * shares for their topic on every meeting, so the form must exist where the link lands; and a
 * guest typed by name has no account, so whoever edits the program fills the topic for them
 * (`writableParts`). An unfilled Plática nobody of the readers holds stays off the cards
 * (`jovenesDayEntry` keeps a part that is stored or the reader's own).
 */
export function partViews(e: Event): PartView[] {
  const fixed = hasFixedProgram(e);
  const speaks = e.seats.some((s) => s.role === PLATICA_SEAT && (!!s.memberId || !!s.name));
  return MEETING_PARTS.filter(
    (spec) => fixed || e.program.some((l) => l.part === spec.id) || (spec.id === "platica" && speaks),
  ).map((spec) => {
    // The writer stores at most one line per part; the first is the one it reads too (W10).
    const line = e.program.find((l) => l.part === spec.id) ?? null;
    const people: PartPerson[] =
      spec.id === "platica"
        ? e.seats.filter((s) => s.role === PLATICA_SEAT && (s.memberId || s.name)).map((s) => ({ name: s.name, photo: s.photo, mine: s.mine }))
        : line
          ? [line, line.second]
              .filter((p): p is NonNullable<typeof p> => !!p && !!p.memberId)
              .map((p) => ({ name: p.name, photo: p.photo, mine: p.mine }))
          : [];
    return {
      id: spec.id,
      label: spec.label,
      people,
      note: line?.note ?? null,
      music: spec.music ? (line?.music ?? null) : null,
      helpers: spec.helpers ? (line?.helpers ?? null) : null,
      mine: people.some((p) => p.mine),
      stored: line !== null,
    };
  });
}

/** The program lines that are no part («Bienvenida», «Anuncios»), in their stored order. */
export function freeLines<L extends { part: string | null }>(program: readonly L[]): L[] {
  return program.filter((l) => !l.part);
}

/**
 * The parts whose «Mi parte» form the page offers this reader, mirroring the PATCH's rule (W10):
 * every part for whoever may edit the program; otherwise their OWN, and only on a PUBLISHED
 * meeting — a responsable writes while they can read the meeting as a member, and a draft a
 * leader sees in the planner is not that (the PATCH would answer 403). Cosmetic all the same: the
 * PATCH decides again on the stored event.
 */
export function writableParts(parts: readonly PartView[], reader: { editsProgram: boolean; published: boolean }): PartView[] {
  return parts.filter((p) => reader.editsProgram || (p.mine && reader.published));
}

/**
 * Does the reader still owe something on a part of theirs? Its music where it has one; its
 * description too — except Oración's, whose note is optional («Nota (opcional)» on the form), so
 * choosing the music is all it owes.
 */
export function partPending(p: PartView): boolean {
  if (!p.mine) return false;
  const spec = MEETING_PARTS.find((s) => s.id === p.id);
  return (p.id !== "oracion" && !p.note) || (!!spec?.music && !p.music);
}

/** «Pau» · «Pau y Mkz» · «Pau, Mkz y Lali». */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

/** How far back a meeting's page still opens (a page range, not access): the email's link outlives the day. */
export const MEETING_PAGE_BACK_DAYS = 30;

/**
 * Does `/jovenes/reunion/[token]` still open a meeting of this date? A screen that can show an
 * older one (the worship Calendario browses past months) offers no «mi parte» link there, or the
 * link would land on «not found». `today` is the server's CDMX day.
 */
export function meetingPageOpens(date: string, today: string): boolean {
  const from = new Date(`${today.slice(0, 10)}T12:00:00Z`);
  from.setUTCDate(from.getUTCDate() - MEETING_PAGE_BACK_DAYS);
  return date.slice(0, 10) >= from.toISOString().slice(0, 10);
}
