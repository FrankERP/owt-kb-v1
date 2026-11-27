import "server-only";

// The admin's proposal list read: the GROQ of `GET /api/admin/proposals`, moved here so the native
// app's `GET /api/app/v1/admin/proposals` reads the same projection (A-W1 spec D2,
// `docs/superpowers/specs/2026-11-27-native-admin-proposal-review-design.md`). Both reads run on
// `operationalClient`, each with its own literal `_type` query so `protectedReadAudit` records a
// canonical read here (as W1 did for `proposalEditorRead.ts`).

import { operationalClient } from "@/sanity/lib/operationalClient";
import { THREAD_MESSAGES } from "@/app/utils/proposalMessageRead";
import { serviceThreadMessagesOf } from "@/app/utils/serviceThread";

// `_rev` plus the approval-input fingerprint fields (target, ordered songs,
// team notes) and the recorded approval/transition receipts are part of the
// contract (A2 §6): an admin transition must submit the revision it actually
// reviewed, and the panel must be able to tell an approved proposal with a
// verifiable receipt from a legacy one without one.
// `earlier_messages` is what admins wrote on the service before its proposal
// existed (ADR-0065), shown in the same thread; `null` when there was nothing.
const FIELDS = `
      _id,
      _rev,
      service_type,
      service_date,
      status,
      lead_notes,
      team_notes,
      pastor_message,
      admin_notes,
      submitted_at,
      reviewed_at,
      approval_receipt,
      last_transition,
      "service_ref": service_ref._ref,
      "lead_name": coalesce(lead->alias, lead->member_name),
      ${THREAD_MESSAGES},
      "earlier_messages": ${serviceThreadMessagesOf("^.service_ref._ref")},
      "lead_id": lead->_id,
      "contributors": contributors[]{ "id": person->_id, "name": coalesce(person->alias, person->member_name) },
      songs[] {
        _key,
        play_key,
        medley_tag,
        "song_id": song._ref,
        "title": song->title,
        "author": song->author,
        "key": song->key
      }`;

/** The projection `/admin`'s «Propuestas» reads, byte for byte what the route always sent. */
export const ADMIN_PROPOSAL_PROJECTION = `{${FIELDS}
    }`;

/** Every proposal, oldest service first: `GET /api/admin/proposals`, unchanged. */
export async function readAdminProposals(): Promise<unknown> {
  return operationalClient.fetch(`
    *[_type == "setlistProposal"] | order(service_date asc) ${ADMIN_PROPOSAL_PROJECTION}
  `);
}

/** One row of the app's read: the same fields, plus the special's name for its title. */
export interface AdminProposalRow {
  _id?: unknown;
  _rev?: unknown;
  service_type?: unknown;
  service_date?: unknown;
  status?: unknown;
  team_notes?: unknown;
  pastor_message?: unknown;
  service_name?: unknown;
  lead_name?: unknown;
  lead_id?: unknown;
  messages?: unknown;
  earlier_messages?: unknown;
  contributors?: unknown;
  songs?: unknown;
}

/**
 * The phone's read (D2): the review queue whatever its date, plus every other proposal whose
 * service is today or later in CDMX. `today` is `YYYY-MM-DD`.
 */
export async function readAdminProposalsForApp(today: string): Promise<AdminProposalRow[]> {
  const rows = await operationalClient.fetch<AdminProposalRow[] | null>(
    `*[_type == "setlistProposal" && (status in ["pending", "changes_requested"] || service_date >= $today)] | order(service_date asc) {${FIELDS},
      "service_name": service_ref->service_name
    }`,
    { today },
  );
  return Array.isArray(rows) ? rows : [];
}
