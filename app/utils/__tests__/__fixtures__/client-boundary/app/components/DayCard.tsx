"use client";

// Excerpt of `app/components/DayCard.tsx` at commit 103c935b — the deploy that
// was live during the 2026-09-02 outage. Trimmed to the directive and the
// export; the function body is verbatim.
//   Re-derive with:  git show '103c935b:app/components/DayCard.tsx'
//
// The `"use client"` on line 1 is the whole point: everything this module
// exports crosses the boundary, `paintsDayCard` included. Nothing here is
// compiled or rendered — the analyser only parses it.

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

export function DayCard() {
  return null;
}
