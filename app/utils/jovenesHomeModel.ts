// «Inicio» de Jóvenes as data (2026-11-17): what the page shows of the meetings it read, and in
// which block. Frank: the one screen held everything, and a pastor needs a first page that says
// what is NEXT and what is THEIRS, with the whole list one tap away in the Calendario. Pure and
// neutral, so the page (a Server Component) calls it; `jovenesHomeModel.test.ts` holds the rules.
//
// Nothing here decides access: every meeting came from `readMinistryEvents` in member mode.

/** What a block needs of a meeting to place it. The meetings arrive ordered by date. */
export type HomeMeeting = { date: string; mine: boolean };

/** How many meetings «Lo que sigue» shows after the next one: the page is a glance, not the list. */
export const HOME_UPCOMING = 3;
/** How many of the reader's own turns «Te toca» lists. */
export const HOME_TURNS = 3;
/** How far back the page looks for «Reunión anterior». A page range, not access. */
export const HOME_LOOKBACK_DAYS = 21;
/**
 * How far ahead Jóvenes' two member pages read. ONE number for both: «N reuniones más» on Inicio
 * counts what the Calendario lists, so the two windows may never drift. A page range, not access
 * (plan R8).
 */
export const JOVENES_HORIZON_DAYS = 365;

export type HomeSections<T> = {
  /** The next meeting from today on: the open, lit card. */
  next: T | null;
  /** The few after it. */
  upcoming: T[];
  /** Meetings beyond those, which only the Calendario lists. */
  later: number;
  /** The reader's next turns, when they say more than the next meeting's own «Tú» chip does. */
  turns: T[];
  /** Every turn the reader has ahead, the ones `turns` leaves out included: the block's count. */
  turnsTotal: number;
  /** The latest meeting already held, inside the page's look-back. */
  previous: T | null;
};

/**
 * The page's blocks. `today` is CDMX's date as the server computed it: a meeting dated today is
 * still the next one, whatever its clock says (a pastor opens the app on the way there). `of`
 * reads a meeting's date and whether it is the reader's, so the page passes its own card items.
 */
export function homeSections<T>(meetings: readonly T[], today: string, of: (m: T) => HomeMeeting): HomeSections<T> {
  const past = meetings.filter((m) => of(m).date < today);
  const future = meetings.filter((m) => of(m).date >= today);
  const [next = null, ...rest] = future;
  const upcoming = rest.slice(0, HOME_UPCOMING);
  const mine = future.filter((m) => of(m).mine);
  // One turn that IS the next meeting would repeat the chip the open card already wears.
  const turns = mine.length === 1 && mine[0] === next ? [] : mine.slice(0, HOME_TURNS);
  return { next, upcoming, later: rest.length - upcoming.length, turns, turnsTotal: mine.length, previous: past.at(-1) ?? null };
}

/**
 * The meetings Inicio draws as CARDS — the next one, the few after it, the last one held. «Te toca»
 * lists the reader's turns as lines, without a card's body, so a turn that is not also one of
 * these never shows its program editor: the page asks this before reading the people to pick from.
 */
export function homeCards<T>(sections: HomeSections<T>): T[] {
  return [sections.next, ...sections.upcoming, sections.previous].filter((m): m is T => m !== null);
}
