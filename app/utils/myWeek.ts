// The one line `/me` leads with (spec §12.4): which service is next, and which
// seat the member holds in it.
//
// NEUTRAL module — no "use client", no imports — because `app/(client)/me/page.tsx`
// is a Server Component and CALLS both functions (ADR-0028). `MeHeader`
// ("use client") only imports the types and renders the result.

/** The per-member seat flags every role-doc projection on `/me` carries. */
export type SeatDoc = {
  isLead?: boolean;
  myInstrument?: string;
  myFohRole?: string;
  isBGV?: boolean;
  isChorus?: boolean;
};

export type SeatAssignment = {
  /** `YYYY-MM-DD` — the service day. */
  dateKey: string;
  /** "Domingo", "Sábado", or a special service's own name. */
  day: string;
  /** `seatLabel(doc)`. Empty when the projection carries no seat flag at all. */
  seat: string;
};

/**
 * The member's own seat(s) in one service: Lead · instrument · FOH: role · BGV ·
 * Coro, always in that order. This was `myRoleLabel` inside the page; it moved
 * here because the header line and the `.ics` event body must name a seat the
 * same way, and because a Server Component may only call a neutral module.
 */
export function seatLabel(doc: SeatDoc): string {
  const seats: string[] = [];
  if (doc.isLead) seats.push("Lead");
  if (doc.myInstrument) seats.push(doc.myInstrument);
  if (doc.myFohRole) seats.push(`FOH: ${doc.myFohRole}`);
  if (doc.isBGV) seats.push("BGV");
  if (doc.isChorus) seats.push("Coro");
  return seats.join(" · ");
}

/**
 * The EARLIEST assignment, not `[0]`. The page happens to sort before calling
 * this, but the header is the page's one claim about what is next, so it reduces
 * rather than trusting the caller's order — a later read appended to the list
 * would otherwise announce the wrong service. Dates are `YYYY-MM-DD`, so a
 * lexical compare IS a chronological one, and a row with no usable date is
 * dropped exactly as the page drops it.
 */
export function nextSeatLine(assignments: SeatAssignment[]): SeatAssignment | null {
  let best: SeatAssignment | null = null;
  for (const a of assignments) {
    if (!a?.dateKey) continue;
    if (!best || a.dateKey.localeCompare(best.dateKey) < 0) best = a;
  }
  return best;
}
