// The GROQ the proposal notification layer reads with — the debounced admin
// email (`outboxSweep`) and the "Nueva propuesta" submit email
// (`proposalNotify`).
//
// A LEAF on purpose. These were previously module-private consts inside
// `outboxSweep.ts` and an inline template literal inside `proposalNotify.ts`,
// which made them impossible to execute in a test: both modules are
// `import "server-only"` guarded and pull the Sanity clients and the env
// assertions in with them, so a test wanting one query string had to mock the
// marker AND the client module. Query strings have no runtime dependencies;
// keeping them here means a test can run them against an in-memory dataset with
// `groq-js` and catch a projection drifting, which is the failure mode that
// hand-written fixtures cannot see.
//
// Nothing here touches a client. Do not add one.

import { LEAD_NOTE_MESSAGES } from "./proposalMessageWrite";

/**
 * The admin audience, written down ONCE for the notification layer.
 *
 * `proposalNotify` and `outboxSweep` each carried their own copy with no sync
 * guard; this is the shared definition, and `SUBMITTED_NOTIFY_QUERY` below
 * interpolates it rather than repeating the role list a third time.
 *
 * It carries no ministry or active-member filter. Inherited from both original
 * copies, not introduced here, and tracked as FrankERP/owt-kb-v1#8.
 */
export const ADMIN_RECIPIENTS_QUERY = `*[_type == "teamMembers" && role in ["super-admin","admin"]]._id`;

/**
 * The proposal the sweep classifies a `leadNotes` notice against.
 *
 * `lead_notes` is still projected: it is what `classifyLeadNotes` compares the
 * notice's `beforeNotes` snapshot against. Child B repoints this at the thread
 * and retires the field from here; until then the shape is unchanged, and
 * `leadNoteProjection.test.ts` executes it so that change cannot land silently.
 */
export const PROPOSAL_QUERY = `*[_type == "setlistProposal" && _id == $proposalId][0]{
  _id, status, lead_notes, service_date
}`;

/**
 * The one read behind the "Nueva propuesta" email: audience, lead name, and the
 * proposal content the email renders.
 *
 * `LEAD_NOTE_MESSAGES` is NOT interpolated yet — the notes source is still
 * `lead_notes`, and this phase changes no behaviour. Child B swaps it, and the
 * test that executes this query is what will show the swap actually happened.
 */
export const SUBMITTED_NOTIFY_QUERY = `{
  "admins": ${ADMIN_RECIPIENTS_QUERY},
  "lead": *[_type == "teamMembers" && _id == $leadId][0]{ alias, member_name },
  "proposal": *[_type == "setlistProposal" && _id == $proposalId][0]{ songs, lead_notes }
}`;

export interface SubmittedNotifyRow {
  admins: string[] | null;
  lead: { alias?: string; member_name?: string } | null;
  proposal: { songs?: unknown; lead_notes?: unknown } | null;
}

/**
 * Re-exported so a reader of this module sees the whole vocabulary the
 * notification queries are built from, and so Child B's narrowing has one
 * import site rather than two.
 */
export { LEAD_NOTE_MESSAGES };
