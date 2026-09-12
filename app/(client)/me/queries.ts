// The GROQ `/me` and its children share (R3 F3).
//
// NEUTRAL module — no "use client", and no import that pulls one in — so every
// Server Component under `app/(client)/me/**` may import AND CALL what is here
// (ADR-0028, `clientBoundary.test.ts`). Keep it that way: a single import of a
// client component would make `horizon()` a client reference and throw at render.
//
// The split that created this file put the availability calendar on its own page,
// which means two pages now need the same member projection and the same
// twelve-month horizon. One copy, so a projection edit cannot drift between them.

/**
 * The member's own availability document.
 *
 * `_rev` is LOAD-BEARING: it is the `ifRevisionId` precondition
 * `PATCH /api/me/availability` requires, because a Kids manager can write the
 * same two fields while the member's tab sits open. Drop it from the projection
 * and every save 400s with only "Server returned 400" on screen.
 */
export const MEMBER_AVAILABILITY_QUERY = `*[_type == "teamMembers" && _id == $id][0] {
      _id, _rev, member_name, alias,
      unavailableDates, unavailabilityNotes
    }`;

/**
 * Every published service day in the horizon, as a flat array of ISO dates — the
 * dots the calendar draws under a day ("there is a service that day").
 *
 * `published != false` is the worship draft-gating rule: these three types
 * predate the field, so an ABSENT `published` must read as visible.
 *
 * Deliberately NOT ministry-scoped: a kids volunteer marking a Saturday should
 * still see that the team has a service that day.
 */
export const SERVICE_DATES_QUERY = `[
        ...*[_type == "sunday_role"   && week >= $today && week <= $limit && published != false].week,
        ...*[_type == "saturday_role" && week >= $today && week <= $limit && published != false].week,
        ...*[_type == "special_role"  && date >= $today && date <= $limit && published != false].date,
      ]`;

/**
 * The CDMX window the service-date reads span: today, and a year out — the grid
 * offers twelve months, so a shorter horizon would leave its last tiles dotless.
 *
 * Pinned to `America/Mexico_City` via the `sv` locale (`YYYY-MM-DD`), which is
 * what Sanity `date` fields compare against.
 */
export function horizon(): { today: string; limit: string } {
  // A fresh per-request date is the intended behaviour: these pages are ISR with
  // `revalidate = 60`, not static. The two `react-hooks/purity` disable comments
  // that sat beside these expressions inside the page COMPONENT are not repeated
  // here — the rule does not fire in a plain module, and an unused directive is
  // itself a lint warning.
  const today = new Date().toLocaleDateString("sv", { timeZone: "America/Mexico_City" });
  const limit = new Date(Date.now() + 365 * 86400 * 1000)
    .toLocaleDateString("sv", { timeZone: "America/Mexico_City" });
  return { today, limit };
}
