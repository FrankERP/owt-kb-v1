// The Studio option list for `teamMembers.instruments`.
//
// Deliberately a module with NO imports: `sanity/schemas/*` never imports from
// `app/`, and `seatModel.test.ts` imports this constant to assert it equals
// `DEFAULT_INSTRUMENT_SEATS` (`app/components/admin/seatModel.ts`) — the two
// vocabularies must not drift, and a test is what holds them together.
export const INSTRUMENT_SEAT_OPTIONS = ["Bass", "Keys", "Drums", "EG", "AG"] as const;
