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
//
// `LEAD_NOTE_MESSAGES` (`./proposalMessageWrite`) is interpolated by
// `PROPOSAL_QUERY` below. `SUBMITTED_NOTIFY_QUERY` still reads `lead_notes`:
// repointing the SUBMIT email at the thread is a separate slice, and an import
// used by one query is not a claim about the other.

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
 * `lead_notes` is GONE from here. Nothing in the sweep reads it any more — the
 * legacy-tolerance branch included, which classifies a pre-Child-B notice
 * against the THREAD rather than against a field nothing writes. Reading it
 * would be reading a frozen value: `before` is written only by
 * `createIfNotExists` on a deterministic id, so a legacy notice keeps its shape
 * for its whole window while new code queues onto it, and comparing against the
 * frozen field would email the pre-release message and swallow every one
 * appended after.
 *
 * `status` and `service_date` must survive: the classifier needs `status` for
 * `reviewable`, and the live-date-wins rule needs `service_date`.
 *
 * `leadMessages` interpolates `LEAD_NOTE_MESSAGES` rather than restating the
 * predicate, so the filter exists exactly twice in the codebase (this fragment
 * and `isLeadNote`) and `leadNoteProjection.test.ts` cross-pins the two by
 * executing them over one fixture.
 *
 * Consumers must NOT re-filter: the array arrives pre-filtered, and a consumer
 * that filters again over a `{kind, body}` narrowing would still match — until
 * someone narrows it to `{body}`, at which point nothing matches and the
 * debounced email dies silently.
 */
export const PROPOSAL_QUERY = `*[_type == "setlistProposal" && _id == $proposalId][0]{
  _id, status, service_date,
  "leadMessages": ${LEAD_NOTE_MESSAGES}
}`;

/**
 * The one read behind the "Nueva propuesta" email: audience, lead name, and the
 * proposal content the email renders.
 *
 * The notes source is still `lead_notes` — this phase changes no behaviour.
 * Child B swaps in `LEAD_NOTE_MESSAGES`, and the test that executes this query
 * is what will show the swap actually happened.
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
