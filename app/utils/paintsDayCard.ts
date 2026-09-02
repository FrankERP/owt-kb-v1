/**
 * Whether a `DayCard` will paint anything, or render `null`.
 *
 * The home page needs this BEFORE rendering: it decides whether to show the
 * "Esta semana" heading over a grid or an empty state, and how many columns
 * that grid gets. It used to re-implement the guard by hand, which is a copy
 * that goes stale silently — a sixth seat array added below, or `instruments`
 * filtered by `person`, and the page would go back to heading-over-nothing with
 * every test still green.
 *
 * A published role whose seats were all cleared is a normal stored state, not a
 * corrupt one: person-less seats are dropped at write time.
 *
 * It lives HERE, not in `DayCard.tsx`, because `DayCard.tsx` is `"use client"`.
 * A server component importing a function out of a client module gets a client
 * reference, not the function — calling it throws "Attempted to call
 * paintsDayCard() from the server". That took the home page down in production
 * on 2026-09-02. Keep this module free of `"use client"` and of any import that
 * pulls one in.
 */
export function paintsDayCard(card: {
  setlist: { songs?: unknown[] } | null | undefined;
  leads: unknown[] | undefined;
  instruments: unknown[] | undefined;
  fohTeam: unknown[] | undefined;
  bgvs: unknown[] | undefined;
  chorus: unknown[] | undefined;
}): boolean {
  return !!(
    card.setlist?.songs?.length ||
    card.leads?.length ||
    card.instruments?.length ||
    card.fohTeam?.length ||
    card.bgvs?.length ||
    card.chorus?.length
  );
}
